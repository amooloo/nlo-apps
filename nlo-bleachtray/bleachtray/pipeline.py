"""End-to-end: raw scan STL -> (model STL with Trimlign base, .pts trimline, report)."""
import os, time, json
import numpy as np
import trimesh
from .mesh_utils import load_scan, smooth_field
from .orient import rough_orient, refine_frame, symmetry_frame, yaw_of
from .segment import (predict_tooth_prob, clean_mask, split_teeth, split_teeth_arch, merge_small_teeth, resplit_elongated, drop_retromolar_pads,
                      order_teeth, margin_contour, resample_polyline, smooth_polyline, load_models,
                      bridge_embrasures, geodesic_dilate, cap_distal, round_distal, edentulous_gaps)
from .reservoir import reservoir_displacement, apply_displacement, smooth_periphery, root_exposure
from .solid import horseshoe_outline, build_body, add_base

# Titan/Trimlign placement convention measured from a Titan export (see notes):
FACIAL_MARGIN_Y_AT_MIDLINE = {"upper": 6.0, "lower": 4.5}   # facial gum line of the centrals, mm in front of the base's locating hole (measured from Titan exports)
FLOOR_BELOW_LOWEST_MARGIN = 3.0    # model floor is 3 mm below the lowest point of the trimline (validated in OrthoFactory 10/15/2026)
TRIMLINE_TILT_DEG = {"upper": 0.75, "lower": 2.75}   # Titan's up leans this much further forward than the facial gum-line plane's normal (8 raw/Titan pairs, 10/16/2026)

DEFAULTS = dict(
    reservoir_height=0.5, reservoir_setback=1.0, reservoir_feather=0.6, reservoir_max_position=5,   # setback: the reservoir stops this far short of the gum line (was 0.5; 1 mm is the usual lab rule)
    recession_auto=True, recession_leeway=1.0,   # exposed root found on a tooth: the reservoir stays that much further up, plus this leeway
    blockout=False, blockout_depth=0.75,          # fill undercuts deeper than this (mm in from the contour) for thermoforming; presets switch it on for retainers
    engrave=True, engrave_text="", engrave_type="", tooth_mark=True,   # initials + W/R raised on a molar: shows on the tray
    facial_offset=3.0, lingual_offset=3.0, trimline_spacing=0.5, add_base=True,   # rim beyond the trim line (was 4.5/4.0; Titan's bodies hug the teeth - the real tissue reaches the floor by itself)
    trimline_offset=0.0,   # mm onto the gingiva: 0 = scalloped at the gum line (bleaching); 2-3 = "high" aligner line
    bridge_radius=3.0,     # straight bridges across papillae narrower than ~2x this
    trimline_smooth=4,
    scan_band=0.0,         # >0: keep real scan only this far beyond the gum line and fill the rest with a synthetic skirt (off: validated look)
    periphery_smooth=True, # smooth the scan surface beyond 2 mm from the gum line (ragged cheek/lip tissue)
    mouthguard=False,      # sports mouthguard: brackets stay under a smooth shield, the line runs into the vestibule with frenum notches, a flange onto the palate
    mg_inset=1.5, mg_min_depth=3.0, mg_max_depth=14.0, mg_palate=6.0, mg_distal=2.5, mg_notch_top=2.5, mg_notch_width=6.0, mg_clearance=1.0,
    distal_round=3.0,      # mm: corner radius of the trim line round the last tooth; it never goes past that tooth, dips behind it are lifted, and a tooth the scan cut through gets the line 2 mm short of the edge, over the tooth; 0 = off
    distal_cap_mm=0.0,     # >0: trimline stops this far in front of its most posterior point per side (Titan ~2.5); 0 = wrap the last molar (validated)
    distal_relief=2.0,     # mm: the model behind the last molar (retromolar pad / tuberosity) is lowered to this far below the trim line so the trimmer reaches the distal surface; 0 = off
    distal_keep=3.0,       # mm: the model ends this far behind the last tooth on each side (Titan ~3); 0 = carry the scan to the outline
    floor_below=3.0,       # mm: the model floor sits this far below the lowest point of the trim line (Titan: 3)
    level=True,            # pitch/roll the model so the facial gum line is level (Titan's basing): low, even walls
    tilt_deg=0.0,          # manual extra pitch (deg, + = front up) on top of the automatic levelling (Position on the base)
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


def distal_relief(mesh_f, labels, info, margin_f, drop=2.0, clearance=0.3, ramp=2.0, z_min=0.6, keep=0.0, tooth_end=None, log=print):
    """Lower everything behind the terminal tooth on each side to `drop` mm below the trim line there.
    The cut is a plane across the arch `clearance` mm behind the tooth's (and the trim line's) distal
    extent, so the line itself and the distal surface stay exactly as scanned; beyond it the surface
    ramps down over `ramp` mm to a flat ledge. With `keep` > 0 the model ends `keep` mm behind the
    tooth (everything further back is pushed under the floor and cut away) - Titan ends its models
    ~3 mm behind the last molar instead of carrying the tuberosity / retromolar pad along.
    `tooth_end` ({side: t}) caps the tooth's distal extent where the label ran onto the pad (from
    round_distal). Vertex order is kept (labels stay aligned)."""
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
        if tooth_end and side in tooth_end:
            t_tooth = min(t_tooth, float(tooth_end[side]))
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
        # the model ends `keep` mm behind the tooth - and never closer than 2 mm to the trim line
        plane = dict(c=[float(c[0]), float(c[1])], d=[float(d[0]), float(d[1])], t_end=float(max(t_tooth + keep, t_line + 2.0))) if keep > 0 else None
        if zone.sum() == 0:
            if plane:
                out.append(dict(side=int(side), vertices=0, plane=plane))
            continue
        # never higher than where the trim line crosses the distal surface, then down to the ledge
        z_cap = float(margin_f[near][:, 2].max()) + 0.3
        blend = np.clip((t[zone] - t_cut) / ramp, 0.0, 1.0)        # 0 at the cut, 1 from `ramp` mm on
        cap = z_ledge + (1.0 - blend) * max(z_cap - z_ledge, 0.0)
        V[zone, 2] = np.minimum(V[zone, 2], cap)
        ended = 0
        if keep > 0:
            end = zone & (t > plane["t_end"])
            V[end, 2] = np.minimum(V[end, 2], -3.0)       # under the floor: the body cut removes it
            ended = int(end.sum())
        out.append(dict(side=int(side), cut_mm_behind_tooth=round(float(t_cut - t_tooth), 2), ledge_z=round(z_ledge, 2), vertices=int(zone.sum()), ended_vertices=ended, plane=plane))
        log(f"distal relief {'right' if side > 0 else 'left'}: {int(zone.sum())} vertices behind the last tooth lowered to z={z_ledge:.1f} ({drop:.1f} mm below the trim line)")
    m = mesh_f.copy()
    m.vertices = V
    return m, out


def cut_outline_distal(outline, planes, reach=60.0, half_width=16.0):
    """Clip the body outline so it ends at each side's distal plane (t <= t_end along d from c).
    The cut is a strip `half_width` either side of that tooth's axis (the same zone distal_relief
    lowers), not a whole half-plane: a tilted plane extended across the arch would clip the other
    side's molar."""
    from shapely.geometry import Polygon, MultiPolygon
    for pl in planes or []:
        if not pl:
            continue
        c, d = np.array(pl["c"]), np.array(pl["d"]); n = np.array([-d[1], d[0]])
        p0 = c + d * pl["t_end"]
        drop = Polygon([p0 + n * half_width, p0 - n * half_width, p0 - n * half_width + d * reach, p0 + n * half_width + d * reach])
        cut = outline.difference(drop)
        if isinstance(cut, MultiPolygon):
            cut = max(cut.geoms, key=lambda g: g.area)
        if isinstance(cut, Polygon) and cut.area > 0.5 * outline.area:
            outline = cut
    return outline


def level_to_trimline(mesh_f, margin_f, cents_xy, arch, extra_pitch_deg=0.0, max_deg=12.0, log=print):
    """Pitch/roll the model so the plane through the FACIAL gum line is horizontal (plus Titan's small
    forward lean, TRIMLINE_TILT_DEG). Titan does this: with the gum line level, the floor - 3 mm under
    its lowest point - sits a few mm below the line everywhere, so the walls are low and even instead
    of 3 mm at the back and 10 mm at the front (and the cheek tissue behind the molars drops under the
    floor on its own). Measured on 8 raw/Titan pairs: this rule puts our frame within ~1 deg of Titan's.
    Rotation about the gum line's centroid; vertex order kept. Returns (mesh, margin, T, info)."""
    T = np.eye(4)
    info = dict(applied=False)
    if len(margin_f) < 10:
        return mesh_f, margin_f, T, info
    pts = margin_f
    if cents_xy is not None and len(cents_xy) >= 3:
        from scipy.spatial import cKDTree
        ac = cents_xy.mean(0)
        j = cKDTree(cents_xy).query(margin_f[:, :2])[1]
        facial = np.linalg.norm(margin_f[:, :2] - ac, axis=1) > np.linalg.norm(cents_xy[j] - ac, axis=1)
        if facial.sum() >= 30:
            pts = margin_f[facial]
    c = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    n = vt[2] * np.sign(vt[2][2] or 1.0)
    # Titan's up leans a touch further forward than this plane's normal: rotate n about x by -extra
    e = np.deg2rad(extra_pitch_deg)
    n = np.array([n[0], n[1] * np.cos(e) + n[2] * np.sin(e), -n[1] * np.sin(e) + n[2] * np.cos(e)])
    n /= np.linalg.norm(n)
    pitch = float(np.degrees(np.arctan2(n[1], n[2]))); roll = float(np.degrees(np.arctan2(-n[0], n[2])))
    info.update(pitch_deg=round(pitch, 2), roll_deg=round(roll, 2), facial_points=int(len(pts)))
    ang = float(np.degrees(np.arccos(np.clip(n[2], -1, 1))))
    if ang < 0.05:
        return mesh_f, margin_f, T, info
    if ang > max_deg:
        log(f"levelling skipped: gum-line plane is {ang:.1f} deg off (limit {max_deg}) - partial scan?")
        info["skipped"] = f"{ang:.1f} deg"
        return mesh_f, margin_f, T, info
    axis = np.cross(n, [0.0, 0.0, 1.0]); axis /= np.linalg.norm(axis)
    piv = margin_f.mean(0)
    T = trimesh.transformations.rotation_matrix(np.deg2rad(ang), axis, piv)
    m = mesh_f.copy(); m.apply_transform(T)
    info["applied"] = True
    log(f"levelled to the facial gum line: pitch {pitch:+.1f} deg, roll {roll:+.1f} deg")
    return m, trimesh.transform_points(margin_f, T), T, info


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
    from .features import compute_features
    # braces on (a scan at the eval appointment): find brackets, wire and ties by colour + shape and take
    # them off - the enamel underneath is rebuilt as a smooth continuation of the surrounding surface.
    # Only when asked for (remove_appliances=True - the app's "Braces on" box): the detector has taken
    # stained or shadowed enamel for a bracket on plain scans, so it never runs on its own
    appliance = np.zeros(len(mesh.vertices), bool)
    want = bool(P.get("remove_appliances", False))
    MG = bool(P.get("mouthguard"))
    feats_forced = None       # mouthguard: the features that go with the mesh the teeth are found on
    mesh_orig = None          # mouthguard: the scan as it is (brackets on) - the body is built from this one
    if MG:
        # the teeth are found on a cleaned copy (brackets confuse the segmentation); the appliance mask on
        # the original is what gets the shield
        mesh_orig = mesh
        ckey = (scan_path, "mg_clean")
        cached = feat_cache.get(ckey) if feat_cache is not None else None
        if cached is None and mesh.metadata.get("rgb") is not None:
            feats0 = compute_features(mesh, return_aux=True)
            try:
                from .appliance import take_off_appliances, detect_appliances
                appl_mask, _d = detect_appliances(mesh, feats0[2]["A"], mesh.metadata["rgb"], feats=feats0, log=lambda m: log(f"[{name}] {m}"))
                mesh2, ainfo, A2, feats2 = take_off_appliances(mesh, feats0[2]["A"], mesh.metadata["rgb"], feats0, log=None)
                cached = (mesh2 if ainfo.get("used") else mesh, appl_mask, ainfo, feats2 if ainfo.get("used") else feats0, feats0)
            except Exception as ex:  # noqa
                log(f"[{name}] appliance step skipped: {ex}")
                cached = (mesh, appliance, dict(used=False, error=str(ex)[:200]), feats0, feats0)
            if feat_cache is not None:
                feat_cache[ckey] = cached
        if cached is not None:
            mesh_c, appliance, ainfo, feats_clean, feats_orig = cached
            if ainfo.get("used"):
                rep["appliances"] = {k: v for k, v in ainfo.items() if k != "passes"}
            if feat_cache is not None:
                feat_cache[(scan_path, "orig_feats")] = feats_orig
            if label_override is not None and len(label_override) == len(mesh_orig.vertices):
                # the app's corrected labels are on the scan as it is: nothing to segment, stay on it
                feats_forced = feats_orig
            else:
                mesh = mesh_c
                feats_forced = feats_clean
        want = False
    # (the app does this itself before the run and hands over a cleaned scan; this is for a scan that
    # comes in by another route, e.g. the watch folder)
    if want and mesh.metadata.get("rgb") is not None and "_clean" not in os.path.basename(scan_path):
        ckey = (scan_path, "clean")
        cached = feat_cache.get(ckey) if feat_cache is not None else None
        if cached is None:
            feats0 = compute_features(mesh, return_aux=True)
            try:
                from .appliance import take_off_appliances
                mesh2, ainfo, A2, feats2 = take_off_appliances(mesh, feats0[2]["A"], mesh.metadata["rgb"], feats0, log=lambda m: log(f"[{name}] {m}"))
                if ainfo.get("used"):
                    mesh = mesh2
                    appliance = np.zeros(len(mesh.vertices), bool)
                cached = (mesh, appliance, ainfo, feats0 if not ainfo.get("used") else feats2)
            except Exception as ex:  # noqa
                log(f"[{name}] appliance step skipped: {ex}")
                cached = (mesh, appliance, dict(used=False, error=str(ex)[:200]), feats0)
            if feat_cache is not None:
                feat_cache[ckey] = cached
        mesh, appliance, ainfo, feats_pre = cached
        if ainfo.get("used"):
            rep["appliances"] = {k: v for k, v in ainfo.items() if k != "passes"}
        if feats_pre is not None and feat_cache is not None and scan_path not in feat_cache:
            feat_cache[scan_path] = feats_pre      # the features of the mesh the pipeline goes on with
    # features are the same for the same scan, so re-runs (brush fixes, base nudges) reuse them
    feats = feats_forced if feats_forced is not None else (feat_cache.get(scan_path) if feat_cache is not None else None)
    if feats is None or len(feats[0]) != len(mesh.vertices):
        feats = compute_features(mesh, return_aux=True)
        if feat_cache is not None and feats_forced is None:
            feat_cache[scan_path] = feats
    p_tooth, p_ip, aux = predict_tooth_prob(mesh, models, feats=feats)
    A = aux["A"]
    # a PLY with colour: the scan's own colours vote along the gum line and veto gum taken for tooth
    rgb = mesh.metadata.get("rgb")
    if rgb is not None and P.get("use_colour", True):
        from .colour import refine_with_colour
        try:
            p_tooth, cinfo = refine_with_colour(mesh, A, p_tooth, rgb, log=lambda m: log(f"[{name}] {m}"))
            rep["colour"] = cinfo
        except Exception as ex:  # noqa
            log(f"[{name}] colour step skipped: {ex}")
    prog(0.30, "separating the teeth")
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
    # a missing premolar / molar: carry the trim line across the ridge to the teeth behind, and keep
    # the missing tooth's position so the molar behind it is still treated as a molar
    ridge_mask, gaps, info = edentulous_gaps(mesh, labels, info, log=lambda m: log(f"[{name}] {m}"))
    if gaps:
        rep["gaps"] = gaps
    n_teeth = len(info)
    rep["teeth"] = {int(k): dict(side=int(v[0]), position=int(v[1])) for k, v in info.items()}
    rep["steps"].append(("segment", round(time.time() - t0, 2)))
    prog(0.42, "trim line and reservoirs")
    log(f"[{name}] teeth: {n_teeth} ({sum(1 for s,_ in info.values() if s<0)} left / {sum(1 for s,_ in info.values() if s>0)} right)")

    # trimline: gum line (tooth/gingiva boundary), optionally pushed `trimline_offset` mm onto the
    # gingiva (aligners/retainers), with straight bridges across the papillae
    line_mask = mask | ridge_mask
    if P["trimline_offset"] > 0:
        line_mask = geodesic_dilate(mesh, A, line_mask, P["trimline_offset"])
    # where the scan stops right at the teeth (common on the lingual of lowers) the gum line would
    # run off the edge of the mesh and the contour could not close: keep it ~1 mm inside the scan edge
    edge_zone = scan_edge_zone(mesh, A, 1.0)
    line_mask = line_mask & ~edge_zone
    field = smooth_field(A, line_mask.astype(float), 3)
    loops = margin_contour(mesh, field, 0.5)
    if len(loops) > 1 and len(loops[1]) > 0.5 * len(loops[0]):
        log(f"[{name}] note: gum line came out in {len(loops)} pieces; using the longest")
    margin = resample_polyline(loops[0], 0.25)
    if P["bridge_radius"] > 0:
        margin = bridge_embrasures(margin, mesh, radius=P["bridge_radius"])
    margin = smooth_polyline(resample_polyline(margin, P["trimline_spacing"]), iters=P["trimline_smooth"])

    # mouthguard: from here on the ORIGINAL scan (brackets on) is the surface; the teeth found on the
    # cleaned copy are carried over by position, the gum line is a point set and needs nothing
    mg_appliance = None
    if MG and mesh_orig is not None and mesh_orig is not mesh:
        from scipy.spatial import cKDTree
        from .mesh_utils import adjacency as _adj
        j = cKDTree(np.asarray(mesh.vertices)).query(np.asarray(mesh_orig.vertices))[1]
        labels = np.asarray(labels)[j]
        p_tooth = np.asarray(p_tooth)[j]
        mask = labels > 0
        mesh = mesh_orig
        A = _adj(mesh)
        mg_appliance = appliance if len(appliance) == len(mesh.vertices) else np.zeros(len(mesh.vertices), bool)
        edge_zone = scan_edge_zone(mesh, A, 1.0)
        fo = feat_cache.get((scan_path, "orig_feats")) if feat_cache is not None else None
        if fo is not None:
            aux = dict(fo[2]); aux["A"] = A
    elif MG:
        # already on the original scan (corrected labels from the app, or nothing was found to clean)
        mg_appliance = appliance if len(appliance) == len(mesh.vertices) else np.zeros(len(mesh.vertices), bool)
    # reservoirs - kept off exposed root (recession, a crown's emergence) and off anything the user painted
    extra_sb, keep_off, force_on = None, None, None
    if P["reservoir_height"] > 0 and P["reservoir_max_position"] > 0:
        if P.get("recession_auto", True):
            roots, rdet = root_exposure(mesh, labels, info, aux, A, arch=arch_hint, max_position=P["reservoir_max_position"], log=lambda m: log(f"[{name}] {m}"))
            lee = float(P.get("recession_leeway") or 0.0)
            extra_sb = {t: h + lee for t, h in roots.items() if h > 0}
            rep["recession"] = {int(t): dict(root_mm=roots[t], reservoir_from_gum_mm=round(float(P["reservoir_setback"]) + extra_sb[t], 2), **rdet[t]) for t in extra_sb}
        idx = np.asarray(P.get("keep_off_idx") or [], dtype=int)
        idx = idx[(idx >= 0) & (idx < len(mesh.vertices))]
        if len(idx):
            keep_off = np.zeros(len(mesh.vertices), bool); keep_off[idx] = True
            log(f"[{name}] no reservoir on the {len(idx)} painted vertices (and {float(P.get('recession_leeway') or 1.0):.1f} mm around them)")
        fidx = np.asarray(P.get("force_on_idx") or [], dtype=int)
        fidx = fidx[(fidx >= 0) & (fidx < len(mesh.vertices))]
        if len(fidx):
            force_on = np.zeros(len(mesh.vertices), bool); force_on[fidx] = True
            log(f"[{name}] reservoir added on the {len(fidx)} painted vertices ({int((force_on & (labels > 0)).sum())} on teeth)")
    if MG or P["reservoir_height"] <= 0:
        d = np.zeros(len(mesh.vertices))
    else:
        d = reservoir_displacement(mesh, labels, info, aux, A, height=P["reservoir_height"], setback=P["reservoir_setback"],
                                   feather=P["reservoir_feather"], max_position=P["reservoir_max_position"],
                                   setback_extra=extra_sb, keep_off=keep_off, keep_off_clearance=float(P.get("recession_leeway") or 1.0), force_on=force_on)
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
    arch = arch_hint
    # level: the facial gum line's plane becomes horizontal (plus Titan's small lean), so the floor is a
    # few mm below the line all the way round instead of deep under the front teeth
    T_tilt = np.eye(4)
    if P.get("level", True):
        cents_f = trimesh.transform_points(np.array([cents[t] for t in info]), T_ref)[:, :2] if len(info) else None
        mesh_f, margin_f, T_tilt, lev = level_to_trimline(mesh_f, margin_f, cents_f, arch, extra_pitch_deg=TRIMLINE_TILT_DEG.get(arch, 0.0) + float(P.get("tilt_deg") or 0.0),
                                                           log=lambda m: log(f"[{name}] {m}"))
        rep["level"] = lev
    # the back of the tray: round the line where it wraps the last tooth on each side (never past
    # the tooth, no flap dipping behind it; a tooth the scan cut through gets a short, curved end)
    tooth_end = None
    mg_info = None
    gum_line_f = None
    if MG:
        from .mouthguard import vestibular_trimline
        try:
            # the arch centre (from the features, rough frame) carried into the levelled frame
            rc = np.asarray(aux.get("ring_center", margin[:, :2].mean(0)), float)[:2]
            rc_f = trimesh.transform_points(np.array([[rc[0], rc[1], 0.0]]), T_tilt @ T_ref)[0, :2]
            mg_line, mg_info = vestibular_trimline(mesh_f, A, labels, info, margin_f, edge_zone, rc_f, arch=arch,
                                                   inset=float(P.get("mg_inset", 1.5)), min_depth=float(P.get("mg_min_depth", 3.0)), max_depth=float(P.get("mg_max_depth", 14.0)),
                                                   palate=float(P.get("mg_palate", 6.0)), distal=float(P.get("mg_distal", 2.5)), notch_top=float(P.get("mg_notch_top", 2.5)), notch_width=float(P.get("mg_notch_width", 6.0)),
                                                   log=lambda m: log(f"[{name}] {m}"))
            if "error" not in mg_info:
                gum_line_f = margin_f.copy()     # the model still sits on the base by its gum line, and the body covers the crowns by it
                margin_f = mg_line
            rep["mouthguard"] = mg_info
        except Exception as ex:  # noqa
            log(f"[{name}] mouthguard line failed ({ex}) - using the gum line")
    if P.get("distal_round", 0.0) > 0 and len(info) >= 4 and not MG:
        try:
            margin_f, dround = round_distal(margin_f, mesh_f, labels, info, edge_zone=edge_zone, radius=float(P["distal_round"]),
                                            log=lambda m: log(f"[{name}] {m}"))
            margin_f = smooth_polyline(resample_polyline(margin_f, P["trimline_spacing"]), iters=2)
            rep["distal_round"] = dround
            tooth_end = {r["side"]: r["t_tooth"] for r in dround}
        except Exception as ex:  # noqa
            log(f"[{name}] distal rounding skipped: {ex}")
    # y so the facial gum line at the midline is FACIAL_MARGIN_Y_AT_MIDLINE; z so floor = 0
    place_line = gum_line_f if (MG and gum_line_f is not None) else margin_f
    near_mid = np.abs(place_line[:, 0]) < 2.0
    facial_y = place_line[near_mid][:, 1].max() if near_mid.any() else place_line[:, 1].max()
    # floor 3 mm below the trim line's lowest point - unless that point is a stray dip (a flap, a
    # recession pocket, a bit of pad): then the floor follows the 10th percentile and the dip is
    # lifted to 0.8 mm above the floor instead of dragging the whole model 10 mm taller
    z_low, z_p10 = float(margin_f[:, 2].min()), float(np.percentile(margin_f[:, 2], 10))
    floor_below = float(P.get("floor_below") or FLOOR_BELOW_LOWEST_MARGIN)
    z_floor = max(z_low - floor_below, z_p10 - floor_below - 1.5)
    if MG:
        z_floor = z_low - floor_below        # the vestibular line is meant to be deep where the sulcus is
    low_pts = margin_f[:, 2] < z_floor + 0.8
    if low_pts.any():
        margin_f[low_pts, 2] = z_floor + 0.8
        log(f"[{name}] trim line: {int(low_pts.sum())} points sat {z_floor + 0.8 - z_low:.1f} mm below the rest - lifted to the floor (model height kept)")
    rep["floor"] = dict(lowest_trimline=round(z_low - z_floor, 2), p10_trimline=round(z_p10 - z_floor, 2), lifted_points=int(low_pts.sum()))
    rep["arch"] = arch
    T_place = np.eye(4)
    T_place[1, 3] = FACIAL_MARGIN_Y_AT_MIDLINE[arch] - facial_y
    T_place[2, 3] = -z_floor
    mesh_f.apply_transform(T_place)
    margin_f = trimesh.transform_points(margin_f, T_place)
    if gum_line_f is not None:
        gum_line_f = trimesh.transform_points(gum_line_f, T_place)
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
        if gum_line_f is not None:
            gum_line_f = trimesh.transform_points(gum_line_f, T_adj)
        log(f"[{name}] manual placement: yaw {adj['yaw_deg']:+.1f} deg, shift x {adj['dx']:+.2f} y {adj['dy']:+.2f} z {adj['dz']:+.2f} mm")
    # the tissue behind the last molar (retromolar pad, tuberosity) is lowered below the trim line so
    # the trimmer can get round the distal surface instead of hitting a wall of gum
    if P.get("distal_relief", 0.0) > 0:
        mesh_f, relief = distal_relief(mesh_f, labels, info, margin_f, drop=P["distal_relief"], keep=float(P.get("distal_keep") or 0.0),
                                       tooth_end=tooth_end, log=lambda m: log(f"[{name}] {m}"))
        rep["distal_relief"] = relief
    # Trimlign reach: cross over the last molars instead of wrapping behind them
    if P.get("distal_cap_mm", 0.0) > 0:
        margin_f = cap_distal(margin_f, mesh_f, keep_mm=P.get("distal_cap_mm", 0.0))
        margin_f = smooth_polyline(resample_polyline(margin_f, P["trimline_spacing"]), iters=2)
    T_total = T_adj @ T_place @ T_tilt @ T_ref @ T_rough
    rep["transform_raw_to_output"] = T_total.tolist()

    # solid horseshoe; it ends `distal_keep` mm behind the last tooth on each side, like Titan's
    outline = horseshoe_outline(margin_f[:, :2], P["facial_offset"], P["lingual_offset"])
    if gum_line_f is not None:
        # mouthguard: the vestibular line sits under the crowns of proclined teeth in plan, so the body
        # also covers the crowns the way a tray body does - a rim round the gum line
        outline = outline.union(horseshoe_outline(gum_line_f[:, :2], P["facial_offset"], P["lingual_offset"]))
        if hasattr(outline, "geoms"):
            outline = max(outline.geoms, key=lambda g: g.area)
    if P.get("distal_keep") and rep.get("distal_relief"):
        outline = cut_outline_distal(outline, [r.get("plane") for r in rep["distal_relief"]])
    # real scan kept only within scan_band of the gum line (cleans off ragged cheek/lip tissue);
    # the rest of the body is a smooth synthetic skirt
    scan_region = horseshoe_outline(margin_f[:, :2], P["scan_band"], P["scan_band"]) if P.get("scan_band") else None
    # block-out: the spaces under pontics, implant emergence profiles and open embrasures are filled so
    # the thermoformed sheet can seat and come off (retainers by default; also wherever the user painted)
    extra_solids = []
    bidx = np.asarray(P.get("blockout_idx") or [], dtype=int)
    bidx = bidx[(bidx >= 0) & (bidx < len(mesh_f.vertices))]
    if (P.get("blockout") and not MG) or len(bidx):
        from .blockout import undercut_fill
        paint = None
        if len(bidx):
            paint = np.zeros(len(mesh_f.vertices), bool); paint[bidx] = True
        try:
            # (a mouthguard keeps the vestibule as it is - the whole sulcus under flared crowns would count as
            # one big undercut; the brackets get their own shields below; painted areas still apply)
            fill, binfo = undercut_fill(mesh_f, z_floor=0.0, min_depth=float(P.get("blockout_depth") or 1.0), auto=bool(P.get("blockout")) and not MG,
                                        paint=paint, log=lambda m: log(f"[{name}] {m}"))
            rep["blockout"] = binfo
            if fill is not None:
                extra_solids.append(fill)
                fill.export(os.path.join(out_dir, f"{name}_blockout.stl"))
        except Exception as ex:  # noqa
            log(f"[{name}] block-out skipped: {ex}")
            rep["blockout"] = dict(error=str(ex))
    # mouthguard: the brackets stay on the model under smooth convex caps with `mg_clearance` mm of room, so
    # the sheet forms over a band instead of locking into the bracket undercuts (mesh_f keeps the scan's
    # vertex order, so the appliance mask applies as it is)
    if MG and mg_appliance is not None and len(mg_appliance) == len(mesh_f.vertices):
        sidx = np.asarray(P.get("shield_idx") or [], dtype=int)
        sidx = sidx[(sidx >= 0) & (sidx < len(mg_appliance))]
        if len(sidx):
            mg_appliance = mg_appliance.copy(); mg_appliance[sidx] = True
            log(f"[{name}] bracket shield: {len(sidx)} painted vertices added")
    if MG and mg_appliance is not None and mg_appliance.any() and len(mg_appliance) == len(mesh_f.vertices):
        from .mouthguard import appliance_shields
        try:
            rc = np.asarray(aux.get("ring_center", margin[:, :2].mean(0)), float)[:2]
            rc_f = trimesh.transform_points(np.array([[rc[0], rc[1], 0.0]]), T_adj @ T_place @ T_tilt @ T_ref)[0, :2]
            caps, sinfo = appliance_shields(mesh_f, mg_appliance, A, rc_f, clearance=float(P.get("mg_clearance", 1.0)), log=lambda m: log(f"[{name}] {m}"))
            rep["shields"] = sinfo
            if caps:
                extra_solids.extend(caps)
                trimesh.util.concatenate(caps).export(os.path.join(out_dir, f"{name}_shields.stl"))
        except Exception as ex:  # noqa
            log(f"[{name}] bracket shields skipped: {ex}")
            rep["shields"] = dict(error=str(ex))
    body, body_method = build_body(mesh_f, outline, 0.0, log=log, scan_region=scan_region, shelf=bool(P.get("shelf", True)), extra_solids=extra_solids)
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
    if P.get("engrave", True) and P.get("tooth_mark", True):
        from .engrave import emboss_on_tooth
        model, mark = emboss_on_tooth(model, mesh_f, labels, info, P, log=lambda m: log(f"[{name}] {m}"))
        rep["tooth_mark"] = mark
    # one piece: the model is body + base in one solid (two when the base could only be concatenated);
    # anything else - slivers from the booleans, tissue cut loose by the floor - would print as crumbs
    parts = model.split(only_watertight=False)
    if len(parts) > 1:
        parts = sorted(parts, key=lambda q: abs(q.volume), reverse=True)
        n_keep = 2 if (P["add_base"] and rep.get("base") == "concat") else 1
        keep, dropped = parts[:n_keep], parts[n_keep:]
        model = trimesh.util.concatenate(keep) if len(keep) > 1 else keep[0]
        rep["loose_pieces_dropped"] = len(dropped)
        if dropped:
            log(f"[{name}] {len(dropped)} loose piece{'s' if len(dropped) > 1 else ''} removed from the model ({', '.join(f'{abs(q.volume) / 1000:.2f} mL' for q in dropped[:4])}{'…' if len(dropped) > 4 else ''})")
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
        # the Titan-named pair is the same bytes as the model: a hard link where the disk allows it (NTFS does)
        for src, dst in ((stl_path, tstl), (pts_path, tpts)):
            if os.path.exists(dst):
                os.remove(dst)
            try:
                os.link(src, dst)
            except OSError:
                shutil.copyfile(src, dst)
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
             T_rough=T_rough, T_ref=T_ref, T_tilt=T_tilt, T_place=T_place, p_tooth=p_tooth,
             **({"rgb": np.asarray(mesh.metadata["rgb"], dtype=np.uint8)} if mesh.metadata.get("rgb") is not None else {}),
             **({"shield": np.asarray(mg_appliance, bool)} if MG and mg_appliance is not None and len(mg_appliance) == len(labels) else {}))
    prog(1.0, "done")
    log(f"[{name}] done in {rep['elapsed_s']} s -> {stl_path}")
    return rep
