"""End-to-end: raw scan STL -> (model STL with Trimlign base, .pts trimline, report)."""
import os, time, json
import numpy as np
import trimesh
from .mesh_utils import load_scan, smooth_field
from .orient import rough_orient, refine_frame
from .segment import (predict_tooth_prob, clean_mask, split_teeth, merge_small_teeth, resplit_elongated,
                      order_teeth, margin_contour, resample_polyline, smooth_polyline, load_models,
                      bridge_embrasures, geodesic_dilate, cap_distal)
from .reservoir import reservoir_displacement, apply_displacement, smooth_periphery
from .solid import horseshoe_outline, build_body, add_base

# Titan/Trimlign placement convention measured from a Titan export (see notes):
FACIAL_MARGIN_Y_AT_MIDLINE = {"upper": 6.0, "lower": 4.5}   # facial gum line of the centrals, mm in front of the base's locating hole (measured from Titan exports)
FLOOR_BELOW_LOWEST_MARGIN = 3.0    # model floor is 3 mm below the lowest point of the trimline (validated in OrthoFactory 10/15/2026)

DEFAULTS = dict(
    reservoir_height=0.5, reservoir_setback=1.0, reservoir_feather=1.0, reservoir_max_position=5,
    facial_offset=4.5, lingual_offset=4.0, trimline_spacing=0.5, add_base=True,
    trimline_offset=0.0,   # mm onto the gingiva: 0 = scalloped at the gum line (bleaching); 2-3 = "high" aligner line
    bridge_radius=3.0,     # straight bridges across papillae narrower than ~2x this
    trimline_smooth=4,
    scan_band=0.0,         # >0: keep real scan only this far beyond the gum line and fill the rest with a synthetic skirt (off: validated look)
    periphery_smooth=True, # smooth the scan surface beyond 2 mm from the gum line (ragged cheek/lip tissue)
    distal_cap_mm=0.0,     # >0: trimline stops this far in front of its most posterior point per side (Titan ~2.5); 0 = wrap the last molar (validated)
    patient_first="", patient_last="", stage=0, arch=None, export_folder="",
)


def write_pts(path, pts):
    """Trimlign/Titan polyline: CRLF line endings, 7 significant digits, exactly like Titan's export."""
    with open(path, "w", newline="") as f:
        f.write("BEGIN_Polyline\r\n")
        for p in pts:
            f.write(f"{p[0]:.7g} {p[1]:.7g} {p[2]:.7g}\r\n")
        f.write("END_Polyline\r\n")


def write_stl_titan_style(path, mesh):
    """Binary STL with an all-zero 80-byte header (Titan's exports look like this; it also avoids any
    parser mistaking a text header starting with 'solid' for ASCII STL)."""
    import struct
    tri = np.asarray(mesh.triangles, dtype=np.float32)
    nrm = np.asarray(mesh.face_normals, dtype=np.float32)
    n = len(tri)
    rec = np.zeros(n, dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])
    rec["n"] = nrm
    rec["v"] = tri
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", n))
        f.write(rec.tobytes())


def titan_basename(first, last, stage, arch):
    """Titan export name: First_Last_-_<stage>_-_<Maxilla|Mandible>"""
    clean = lambda s: "".join(c for c in str(s).strip() if c.isalnum() or c in "-_ ").replace(" ", "_")
    archname = "Maxilla" if arch == "upper" else "Mandible"
    return f"{clean(first)}_{clean(last)}_-_{int(stage)}_-_{archname}"


def detect_arch(mesh, filename=""):
    """'upper' or 'lower'. Filename hints first; otherwise an upper scan has a palate (lots of surface
    inside the arch ring), a lower scan does not."""
    fn = filename.lower()
    if any(k in fn for k in ("upper", "maxil", "_u.", "-u.", "upperjaw")):
        return "upper"
    if any(k in fn for k in ("lower", "mandib", "_l.", "-l.", "lowerjaw")):
        return "lower"
    from .features import arch_ring
    v = mesh.vertices
    c, angles, radii = arch_ring(v[:, :2], v[:, 2])
    ang = np.arctan2(v[:, 1] - c[1], v[:, 0] - c[0])
    r = np.linalg.norm(v[:, :2] - c, axis=1)
    ring_r = np.interp(ang, angles, radii, period=2 * np.pi)
    inside = (ring_r - r) > 8.0  # well inside the arch ring
    frac = inside.mean()
    return "upper" if frac > 0.12 else "lower"


def process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print):
    """Run the whole pipeline. Returns a dict report. `label_override` lets the UI pass corrected
    per-vertex tooth labels (in the rough-oriented frame) to skip the classifier."""
    P = dict(DEFAULTS)
    if params:
        P.update(params)
    t0 = time.time()
    name = name or os.path.splitext(os.path.basename(scan_path))[0]
    os.makedirs(out_dir, exist_ok=True)
    rep = dict(name=name, params=P, steps=[])

    raw = load_scan(scan_path)
    mesh, T_rough = rough_orient(raw)
    rep["steps"].append(("load+orient", round(time.time() - t0, 2)))

    models = models or load_models()
    p_tooth, p_ip, aux = predict_tooth_prob(mesh, models)
    A = aux["A"]
    if label_override is not None:
        labels = np.asarray(label_override)
        mask = labels > 0
    else:
        mask = clean_mask(smooth_field(A, p_tooth, 4) > 0.5, A)
        labels, _ = split_teeth(mesh, mask, p_ip, A, aux, erode_mm=2.0, concave_cut=-9)
        labels = merge_small_teeth(mesh, labels, A)
        labels = resplit_elongated(mesh, labels, A, aux)
        labels = merge_small_teeth(mesh, labels, A)
    info, cents, center, contact = order_teeth(mesh, labels, aux)
    n_teeth = len(info)
    rep["teeth"] = {int(k): dict(side=int(v[0]), position=int(v[1])) for k, v in info.items()}
    rep["steps"].append(("segment", round(time.time() - t0, 2)))
    log(f"[{name}] teeth: {n_teeth} ({sum(1 for s,_ in info.values() if s<0)} left / {sum(1 for s,_ in info.values() if s>0)} right)")

    # trimline: gum line (tooth/gingiva boundary), optionally pushed `trimline_offset` mm onto the
    # gingiva (aligners/retainers), with straight bridges across the papillae
    line_mask = mask
    if P["trimline_offset"] > 0:
        line_mask = geodesic_dilate(mesh, A, mask, P["trimline_offset"])
    field = smooth_field(A, line_mask.astype(float), 3)
    loops = margin_contour(mesh, field, 0.5)
    margin = resample_polyline(loops[0], 0.25)
    if P["bridge_radius"] > 0:
        margin = bridge_embrasures(margin, mesh, radius=P["bridge_radius"])
    margin = smooth_polyline(resample_polyline(margin, P["trimline_spacing"]), iters=P["trimline_smooth"])

    # reservoirs
    d = reservoir_displacement(mesh, labels, info, aux, A, height=P["reservoir_height"], setback=P["reservoir_setback"],
                               feather=P["reservoir_feather"], max_position=P["reservoir_max_position"])
    mesh_r = apply_displacement(mesh, d)
    if P.get("periphery_smooth", True):
        mesh_r = smooth_periphery(mesh_r, labels, A, start=2.0, full=P["facial_offset"])
    rep["reservoir_vertices"] = int((d > 0.05).sum())
    rep["steps"].append(("reservoirs", round(time.time() - t0, 2)))
    # "scan with reservoirs" in the ORIGINAL scanner coordinates: drop-in replacement for the raw
    # scan in OrthoFactory / Titan (they do their own basing + trim path)
    scan_res = mesh_r.copy()
    scan_res.apply_transform(np.linalg.inv(T_rough))
    scan_res_path = os.path.join(out_dir, f"{name}_scan_with_reservoirs_NOBASE_not_for_trimlign.stl")
    scan_res.export(scan_res_path)

    # final frame: x-axis from mirror-image tooth pairs (1-1, 2-2, 3-3), x = 0 at the incisor contact
    by_pos = {}
    for tid, (side, pos) in info.items():
        by_pos.setdefault(pos, {})[side] = cents[tid][:2]
    pairs = [by_pos[p][1] - by_pos[p][-1] for p in (1, 2, 3) if p in by_pos and -1 in by_pos[p] and 1 in by_pos[p]]
    mesh_f, T_ref = refine_frame(mesh_r, contact, pairs)
    margin_f = trimesh.transform_points(margin, T_ref)
    # y so the facial gum line at the midline is FACIAL_MARGIN_Y_AT_MIDLINE; z so floor = 0
    near_mid = np.abs(margin_f[:, 0]) < 2.0
    facial_y = margin_f[near_mid][:, 1].max() if near_mid.any() else margin_f[:, 1].max()
    z_floor = margin_f[:, 2].min() - FLOOR_BELOW_LOWEST_MARGIN
    arch = P.get("arch") or detect_arch(mesh, os.path.basename(scan_path))
    rep["arch"] = arch
    T_place = np.eye(4)
    T_place[1, 3] = FACIAL_MARGIN_Y_AT_MIDLINE[arch] - facial_y
    T_place[2, 3] = -z_floor
    mesh_f.apply_transform(T_place)
    margin_f = trimesh.transform_points(margin_f, T_place)
    # Trimlign reach: cross over the last molars instead of wrapping behind them
    if P.get("distal_cap_mm", 0.0) > 0:
        margin_f = cap_distal(margin_f, mesh_f, keep_mm=P.get("distal_cap_mm", 0.0))
        margin_f = smooth_polyline(resample_polyline(margin_f, P["trimline_spacing"]), iters=2)
    T_total = T_place @ T_ref @ T_rough
    rep["transform_raw_to_output"] = T_total.tolist()

    # solid horseshoe
    outline = horseshoe_outline(margin_f[:, :2], P["facial_offset"], P["lingual_offset"])
    # real scan kept only within scan_band of the gum line (cleans off ragged cheek/lip tissue);
    # the rest of the body is a smooth synthetic skirt
    scan_region = horseshoe_outline(margin_f[:, :2], P["scan_band"], P["scan_band"]) if P.get("scan_band") else None
    body, body_method = build_body(mesh_f, outline, 0.0, log=log, scan_region=scan_region)
    rep["body_method"] = body_method
    rep["body_watertight"] = bool(body.is_watertight)
    rep["body_volume_ml"] = round(float(body.volume) / 1000.0, 2)
    rep["steps"].append(("solid", round(time.time() - t0, 2)))
    log(f"[{name}] body watertight={body.is_watertight} volume={rep['body_volume_ml']} mL")

    if P["add_base"]:
        model, how = add_base(body)
        rep["base"] = how
    else:
        model, how = body, "none"
    rep["model_faces"] = int(len(model.faces))
    rep["model_bounds"] = np.round(model.bounds, 2).tolist()

    stl_path = os.path.join(out_dir, f"{name}_model.stl")
    pts_path = os.path.join(out_dir, f"{name}_trimline.pts")
    write_stl_titan_style(stl_path, model)
    write_pts(pts_path, margin_f)
    body.export(os.path.join(out_dir, f"{name}_body_only.stl"))
    rep["outputs"] = dict(model=stl_path, trimline=pts_path, scan_with_reservoirs=scan_res_path)
    # Titan-style pair (what OrthoFactory expects to see), optionally copied into its watched folder
    if P.get("patient_first") and P.get("patient_last"):
        tb = titan_basename(P["patient_first"], P["patient_last"], P.get("stage", 0), rep["arch"])
        tstl, tpts = os.path.join(out_dir, tb + ".stl"), os.path.join(out_dir, tb + ".pts")
        import shutil
        shutil.copyfile(stl_path, tstl); shutil.copyfile(pts_path, tpts)
        rep["outputs"]["titan_stl"], rep["outputs"]["titan_pts"] = tstl, tpts
        rep["titan_basename"] = tb
        exp = P.get("export_folder")
        if exp:
            try:
                os.makedirs(exp, exist_ok=True)
                # write the .stl first, then the .pts, so a folder watcher sees the pair complete
                shutil.copyfile(stl_path, os.path.join(exp, tb + ".stl"))
                shutil.copyfile(pts_path, os.path.join(exp, tb + ".pts"))
                rep["exported_to"] = os.path.join(exp, tb)
                log(f"[{name}] exported {tb}.stl/.pts to {exp}")
            except Exception as ex:  # noqa
                rep["export_error"] = str(ex)
                log(f"[{name}] export to {exp} failed: {ex}")
    rep["trimline_points"] = int(len(margin_f))
    rep["elapsed_s"] = round(time.time() - t0, 2)
    with open(os.path.join(out_dir, f"{name}_report.json"), "w") as f:
        json.dump(rep, f, indent=2)
    # debug state for the UI / verification
    np.savez(os.path.join(out_dir, f"{name}_state.npz"), labels=labels, d=d, margin=margin_f,
             T_rough=T_rough, T_ref=T_ref, T_place=T_place, p_tooth=p_tooth)
    log(f"[{name}] done in {rep['elapsed_s']} s -> {stl_path}")
    return rep
