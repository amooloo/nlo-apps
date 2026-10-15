"""End-to-end: raw scan STL -> (model STL with Trimlign base, .pts trimline, report)."""
import os, time, json
import numpy as np
import trimesh
from .mesh_utils import load_scan, smooth_field
from .orient import rough_orient, refine_frame, symmetry_frame, yaw_of
from .segment import (predict_tooth_prob, clean_mask, split_teeth, split_teeth_arch, merge_small_teeth, resplit_elongated, drop_retromolar_pads,
                      order_teeth, margin_contour, resample_polyline, smooth_polyline, load_models,
                      bridge_embrasures, geodesic_dilate, cap_distal)
from .reservoir import reservoir_displacement, apply_displacement, smooth_periphery
from .solid import horseshoe_outline, build_body, add_base

# Titan/Trimlign placement convention measured from a Titan export (see notes):
FACIAL_MARGIN_Y_AT_MIDLINE = {"upper": 6.0, "lower": 4.5}   # facial gum line of the centrals, mm in front of the base's locating hole (measured from Titan exports)
FLOOR_BELOW_LOWEST_MARGIN = 3.0    # model floor is 3 mm below the lowest point of the trimline (validated in OrthoFactory 10/15/2026)

DEFAULTS = dict(
    reservoir_height=0.5, reservoir_setback=0.5, reservoir_feather=0.6, reservoir_max_position=5,
    engrave=True, engrave_text="", engrave_type="",
    facial_offset=4.5, lingual_offset=4.0, trimline_spacing=0.5, add_base=True,
    trimline_offset=0.0,   # mm onto the gingiva: 0 = scalloped at the gum line (bleaching); 2-3 = "high" aligner line
    bridge_radius=3.0,     # straight bridges across papillae narrower than ~2x this
    trimline_smooth=4,
    scan_band=0.0,         # >0: keep real scan only this far beyond the gum line and fill the rest with a synthetic skirt (off: validated look)
    periphery_smooth=True, # smooth the scan surface beyond 2 mm from the gum line (ragged cheek/lip tissue)
    distal_cap_mm=0.0,     # >0: trimline stops this far in front of its most posterior point per side (Titan ~2.5); 0 = wrap the last molar (validated)
    distal_relief=2.0,     # mm: the model behind the last molar (retromolar pad / tuberosity) is lowered to this far below the trim line so the trimmer reaches the distal surface; 0 = off
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


def scan_edge_zone(mesh, A, mm=1.0):
    """Vertices within `mm` (geodesic) of the open edge of the scan."""
    import trimesh
    edges = mesh.edges_sorted
    single = trimesh.grouping.group_rows(edges, require_count=1)
    on_edge = np.zeros(len(mesh.vertices), bool)
    if len(single):
        on_edge[np.unique(edges[single])] = True
    return geodesic_dilate(mesh, A, on_edge, mm)


def separate_teeth(mesh, mask, p_ip, A, aux, arch, log=print):
    """Per-tooth labels: arch-profile boundaries (contacts from the interproximal classifier, incisal
    height dips, footprint pinches, facial grooves) + downhill flood. Falls back to the older
    gum-line erosion split if that yields fewer than 6 teeth."""
    aux = dict(aux); aux["p_ip"] = p_ip
    labels, bounds = split_teeth_arch(mesh, mask, A, aux, arch=arch, log=log)
    labels = merge_small_teeth(mesh, labels, A)
    labels = drop_retromolar_pads(mesh, labels, arch, log=log)
    n = len(np.unique(labels[labels > 0]))
    if n < 6:
        log(f"  arch-profile split found only {n} teeth - falling back to erosion split")
        labels, _ = split_teeth(mesh, mask, p_ip, A, aux, erode_mm=2.0, concave_cut=-9)
        labels = merge_small_teeth(mesh, labels, A)
        labels = resplit_elongated(mesh, labels, A, aux)
        labels = merge_small_teeth(mesh, labels, A)
    return labels


def distal_relief(mesh_f, labels, info, margin_f, drop=2.0, clearance=0.3, ramp=2.0, z_min=0.6, log=print):
    """Lower everything behind the terminal tooth on each side to `drop` mm below the trim line there.
    The cut is a plane across the arch `clearance` mm behind the tooth's (and the trim line's) distal
    extent, so the line itself and the distal surface stay exactly as scanned; beyond it the surface
    ramps down over `ramp` mm to a flat ledge. Vertex order is kept (labels stay aligned)."""
    V = mesh_f.vertices.copy()
    out = []
    for side in (-1, 1):
        teeth = {t: pos for t, (sd, pos) in info.items() if sd == side}
        if len(teeth) < 2:
            continue
        term = max(teeth, key=lambda t: teeth[t])
        prev = max((t for t in teeth if t != term), key=lambda t: teeth[t])
        mt, mp = labels == term, labels == prev
        if mt.sum() < 50 or mp.sum() < 50:
            continue
        c = V[mt][:, :2].mean(0)
        d = c - V[mp][:, :2].mean(0)
        if np.linalg.norm(d) < 1e-6:
            continue
        d /= np.linalg.norm(d)
        n = np.array([-d[1], d[0]])
        t_tooth = ((V[mt][:, :2] - c) @ d).max()
        tl = margin_f[:, :2] - c
        near = (np.abs(tl @ n) < 9.0) & ((tl @ d) > -2.0)
        if near.sum() < 3:
            continue
        t_line = (tl[near] @ d).max()
        t_cut = max(t_tooth, t_line) + clearance
        z_ledge = max(z_min, float(margin_f[near][:, 2].min()) - drop)
        rel = V[:, :2] - c
        t = rel @ d; w = np.abs(rel @ n)
        zone = (t > t_cut) & (w < 16.0)
        if zone.sum() == 0:
            continue
        # never higher than where the trim line crosses the distal surface, then down to the ledge
        z_cap = float(margin_f[near][:, 2].max()) + 0.3
        blend = np.clip((t[zone] - t_cut) / ramp, 0.0, 1.0)        # 0 at the cut, 1 from `ramp` mm on
        cap = z_ledge + (1.0 - blend) * max(z_cap - z_ledge, 0.0)
        V[zone, 2] = np.minimum(V[zone, 2], cap)
        out.append(dict(side=int(side), cut_mm_behind_tooth=round(float(t_cut - t_tooth), 2), ledge_z=round(z_ledge, 2), vertices=int(zone.sum())))
        log(f"distal relief {'right' if side > 0 else 'left'}: {int(zone.sum())} vertices behind the last tooth lowered to z={z_ledge:.1f} ({drop:.1f} mm below the trim line)")
    m = mesh_f.copy()
    m.vertices = V
    return m, out


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


def process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
    """Run the whole pipeline. Returns a dict report. `label_override` lets the UI pass corrected
    per-vertex tooth labels (in the rough-oriented frame) to skip the classifier."""
    P = dict(DEFAULTS)
    if params:
        P.update(params)
    t0 = time.time()
    name = name or os.path.splitext(os.path.basename(scan_path))[0]
    os.makedirs(out_dir, exist_ok=True)
    rep = dict(name=name, params=P, steps=[])

    def prog(frac, label):
        if progress is not None:
            try:
                progress(frac, label)
            except Exception:
                pass
    prog(0.02, "loading the scan")

    raw = load_scan(scan_path)
    mesh, T_rough = rough_orient(raw)
    rep["steps"].append(("load+orient", round(time.time() - t0, 2)))
    prog(0.08, "finding teeth and gum")

    models = models or load_models()
    arch_hint = P.get("arch") or detect_arch(mesh, os.path.basename(scan_path))
    # features are the same for the same scan, so re-runs (brush fixes, base nudges) reuse them
    feats = feat_cache.get(scan_path) if feat_cache is not None else None
    if feats is None:
        from .features import compute_features
        feats = compute_features(mesh, return_aux=True)
        if feat_cache is not None:
            feat_cache[scan_path] = feats
    p_tooth, p_ip, aux = predict_tooth_prob(mesh, models, feats=feats)
    prog(0.30, "separating the teeth")
    A = aux["A"]
    # the tooth split is the same for the same scan + arch, so the retainer made right after the
    # whitening tray (and a base nudge later) reuses it
    lkey = (scan_path, "labels", arch_hint)
    if label_override is not None:
        labels = np.asarray(label_override)
        mask = labels > 0
    elif feat_cache is not None and lkey in feat_cache:
        labels = feat_cache[lkey]
        mask = labels > 0
        log("tooth separation reused from the previous run")
    else:
        mask = clean_mask(smooth_field(A, p_tooth, 4) > 0.5, A)
        labels = separate_teeth(mesh, mask, p_ip, A, aux, arch_hint, log=log)
        mask = labels > 0          # separation may have dropped soft tissue mistaken for a tooth
        if feat_cache is not None:
            feat_cache[lkey] = labels
    info, cents, center, contact = order_teeth(mesh, labels, aux)
    n_teeth = len(info)
    rep["teeth"] = {int(k): dict(side=int(v[0]), position=int(v[1])) for k, v in info.items()}
    rep["steps"].append(("segment", round(time.time() - t0, 2)))
    prog(0.42, "trim line and reservoirs")
    log(f"[{name}] teeth: {n_teeth} ({sum(1 for s,_ in info.values() if s<0)} left / {sum(1 for s,_ in info.values() if s>0)} right)")

    # trimline: gum line (tooth/gingiva boundary), optionally pushed `trimline_offset` mm onto the
    # gingiva (aligners/retainers), with straight bridges across the papillae
    line_mask = mask
    if P["trimline_offset"] > 0:
        line_mask = geodesic_dilate(mesh, A, mask, P["trimline_offset"])
    # where the scan stops right at the teeth (common on the lingual of lowers) the gum line would
    # run off the edge of the mesh and the contour could not close: keep it ~1 mm inside the scan edge
    line_mask = line_mask & ~scan_edge_zone(mesh, A, 1.0)
    field = smooth_field(A, line_mask.astype(float), 3)
    loops = margin_contour(mesh, field, 0.5)
    if len(loops) > 1 and len(loops[1]) > 0.5 * len(loops[0]):
        log(f"[{name}] note: gum line came out in {len(loops)} pieces; using the longest")
    margin = resample_polyline(loops[0], 0.25)
    if P["bridge_radius"] > 0:
        margin = bridge_embrasures(margin, mesh, radius=P["bridge_radius"])
    margin = smooth_polyline(resample_polyline(margin, P["trimline_spacing"]), iters=P["trimline_smooth"])

    # reservoirs
    d = reservoir_displacement(mesh, labels, info, aux, A, height=P["reservoir_height"], setback=P["reservoir_setback"],
                               feather=P["reservoir_feather"], max_position=P["reservoir_max_position"])
    mesh_r = apply_displacement(mesh, d)
    if P.get("periphery_smooth", True):
        mesh_r = smooth_periphery(mesh_r, labels, A, start=2.0, full=P["facial_offset"], iters=int(P.get("periphery_iters", 30)), mu=float(P.get("periphery_mu", -0.52)))
    rep["reservoir_vertices"] = int((d > 0.05).sum())
    rep["steps"].append(("reservoirs", round(time.time() - t0, 2)))
    prog(0.55, "building the solid model")
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
    # cross-check against the midline of the arch SHAPE (needs no tooth numbering): if the two
    # disagree badly, a tooth was mis-numbered and the shape midline is the safer one
    T_sym, yaw_sym, _ = symmetry_frame(margin[:, :2])
    d_yaw = abs(np.degrees((yaw_of(T_ref) - yaw_sym + np.pi) % (2 * np.pi) - np.pi))
    x_sym = trimesh.transform_points(np.array([[contact[0], contact[1], 0.0]]), T_sym)[0, 0]
    rep["midline_check"] = dict(pairs=len(pairs), yaw_diff_deg=round(float(d_yaw), 1), contact_x_in_shape_frame=round(float(x_sym), 2))
    if not pairs or d_yaw > 8.0 or abs(x_sym) > 4.0:
        log(f"[{name}] WARNING midline from tooth pairs looks wrong ({len(pairs)} pairs, {d_yaw:.1f} deg off the arch "
            f"shape, contact {x_sym:+.1f} mm off its axis) - using the arch-shape midline instead")
        rep["midline_check"]["used"] = "arch_shape"
        T_ref = T_sym
        mesh_f = mesh_r.copy(); mesh_f.apply_transform(T_ref)
    else:
        rep["midline_check"]["used"] = "tooth_pairs"
    margin_f = trimesh.transform_points(margin, T_ref)
    # y so the facial gum line at the midline is FACIAL_MARGIN_Y_AT_MIDLINE; z so floor = 0
    near_mid = np.abs(margin_f[:, 0]) < 2.0
    facial_y = margin_f[near_mid][:, 1].max() if near_mid.any() else margin_f[:, 1].max()
    z_floor = margin_f[:, 2].min() - FLOOR_BELOW_LOWEST_MARGIN
    arch = arch_hint
    rep["arch"] = arch
    T_place = np.eye(4)
    T_place[1, 3] = FACIAL_MARGIN_Y_AT_MIDLINE[arch] - facial_y
    T_place[2, 3] = -z_floor
    mesh_f.apply_transform(T_place)
    margin_f = trimesh.transform_points(margin_f, T_place)
    # manual correction of the placement on the base (from the app): rotate about the trimline
    # centroid, then shift. Zero by default; the app's Reset puts it back to the automatic placement.
    pivot = margin_f[:, :2].mean(0)
    rep["adjust_pivot"] = [round(float(pivot[0]), 3), round(float(pivot[1]), 3)]
    adj = dict(yaw_deg=0.0, dx=0.0, dy=0.0, dz=0.0)
    adj.update({k: float(v or 0.0) for k, v in (P.get("adjust") or {}).items() if k in adj})
    rep["adjust"] = adj
    T_adj = np.eye(4)
    if any(abs(v) > 1e-9 for v in adj.values()):
        R = trimesh.transformations.rotation_matrix(np.deg2rad(adj["yaw_deg"]), [0, 0, 1], [pivot[0], pivot[1], 0.0])
        T_adj = R.copy(); T_adj[:3, 3] += [adj["dx"], adj["dy"], adj["dz"]]
        mesh_f.apply_transform(T_adj)
        margin_f = trimesh.transform_points(margin_f, T_adj)
        log(f"[{name}] manual placement: yaw {adj['yaw_deg']:+.1f} deg, shift x {adj['dx']:+.2f} y {adj['dy']:+.2f} z {adj['dz']:+.2f} mm")
    # the tissue behind the last molar (retromolar pad, tuberosity) is lowered below the trim line so
    # the trimmer can get round the distal surface instead of hitting a wall of gum
    if P.get("distal_relief", 0.0) > 0:
        mesh_f, relief = distal_relief(mesh_f, labels, info, margin_f, drop=P["distal_relief"], log=lambda m: log(f"[{name}] {m}"))
        rep["distal_relief"] = relief
    # Trimlign reach: cross over the last molars instead of wrapping behind them
    if P.get("distal_cap_mm", 0.0) > 0:
        margin_f = cap_distal(margin_f, mesh_f, keep_mm=P.get("distal_cap_mm", 0.0))
        margin_f = smooth_polyline(resample_polyline(margin_f, P["trimline_spacing"]), iters=2)
    T_total = T_adj @ T_place @ T_ref @ T_rough
    rep["transform_raw_to_output"] = T_total.tolist()

    # solid horseshoe
    outline = horseshoe_outline(margin_f[:, :2], P["facial_offset"], P["lingual_offset"])
    # real scan kept only within scan_band of the gum line (cleans off ragged cheek/lip tissue);
    # the rest of the body is a smooth synthetic skirt
    scan_region = horseshoe_outline(margin_f[:, :2], P["scan_band"], P["scan_band"]) if P.get("scan_band") else None
    body, body_method = build_body(mesh_f, outline, 0.0, log=log, scan_region=scan_region, shelf=scan_region is not None or bool(P.get("shelf", False)))
    rep["body_method"] = body_method
    rep["body_watertight"] = bool(body.is_watertight)
    rep["body_volume_ml"] = round(float(body.volume) / 1000.0, 2)
    rep["steps"].append(("solid", round(time.time() - t0, 2)))
    prog(0.85, "adding the base and engraving")
    log(f"[{name}] body watertight={body.is_watertight} volume={rep['body_volume_ml']} mL")

    if P["add_base"]:
        model, how = add_base(body)
        rep["base"] = how
        if P.get("engrave", True):
            from .engrave import engrave_model
            model, placed = engrave_model(model, P, outline=outline, log=lambda m: log(f"[{name}] {m}"))
            rep["engraved"] = placed
    else:
        model, how = body, "none"
    # tiny slivers left by the booleans would print as floating specks
    parts = model.split(only_watertight=False)
    if len(parts) > 1:
        keep = [q for q in parts if len(q.faces) >= 20]
        if keep and len(keep) < len(parts):
            model = trimesh.util.concatenate(keep) if len(keep) > 1 else keep[0]
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
    prog(1.0, "done")
    log(f"[{name}] done in {rep['elapsed_s']} s -> {stl_path}")
    return rep
