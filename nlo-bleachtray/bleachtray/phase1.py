"""Phase I retainer (mixed dentition, the doctor 10/20/2026; AISA SOP-LAB-008 / 008A / 009).

It holds the corrected teeth while the permanent canines and premolars come in: the four incisors and the E/6
segments are covered, the primary canines and first molars (C, D) are not.

* CUTT - Cut-Out TruTain, the office default: the trim line curves out round the chunk holding C and D on each
  side, so the Trimlign's bur cuts the whole chunk away (the way Ortho-Automation does the cutouts) and leaves an
  open window where the permanent teeth erupt. The distal wall of the 2 and the mesial of the E stay covered.
* BOTT - Block-Out TruTain: no cutouts; the C/Ds are blocked out on the printed model instead (block_outs()), as
  thick as the bite allows without becoming the only contact (the doctor, 10/20/2026).

Upper: a plate behind the incisors joined to the E/6 segments, the back of the palate left open - a U behind the
Es, like the office's own retainers (the doctor chose it over "the full hard palate", 10/20/2026). Lower: a lingual
flange as deep as the scan goes, with a notch at the lingual frenum. Cheek side: the retainer's line, 1.25 mm onto
the gum.

Final frame throughout: x across the arch, +y anterior, z up = occlusal. A tooth's side in `info` is the sign of x:
on an upper +x is the patient's left, on a lower the patient's right (teeth up, seen from above)."""
import numpy as np
from .segment import geodesic_from_boundary, geodesic_dilate, margin_contour, resample_polyline, smooth_polyline
from .mesh_utils import smooth_field

NB = 180


def _arch_angle(xy, c):
    return np.arctan2(xy[:, 0] - c[0], xy[:, 1] - c[1])      # 0 = anterior (+y), as the pipeline's arch ring


def patient_side(side, arch):
    """info's side (sign of x) -> 'R' / 'L' (the patient's)."""
    if arch == "lower":
        return "R" if side > 0 else "L"
    return "L" if side > 0 else "R"


def pick_slots(picks, arch):
    """picks ('R3', 'L4', ...) -> {(info side, position)}."""
    out = set()
    for p in picks or []:
        p = str(p).strip().upper()
        if len(p) >= 2 and p[0] in "RL" and p[1:].isdigit():
            right = p[0] == "R"
            side = (1 if right else -1) if arch == "lower" else (-1 if right else 1)
            out.add((side, int(p[1:])))
    return out


def pick_teeth(info, picks, arch):
    """picks: ['R3', 'R4', 'L3', 'L4'] (side + position from the midline: 3 = C, 4 = D, 5 = E or the 5 under it) ->
    the tooth labels that carry them."""
    want = pick_slots(picks, arch)
    return sorted(int(t) for t, (side, pos) in info.items() if (int(side), int(pos)) in want)


DEFAULT_PICKS = ["R3", "R4", "L3", "L4"]


def drop_ghosts(V, labels, info, c, lingual_mm=3.0, low_mm=2.0, short_mm=3.5):
    """Mixed dentition: tooth labels that are not teeth - a patch of palatal gum beside the 2s that the tooth model
    took for a tooth (both sides of an upper Phase I scan, 10/20/2026). Counted from the midline it became the "3",
    so the C was a 4 and the D a 5 - and the cutouts went round the wrong teeth. Such a label stands well inside
    the arch (lingual_mm or more inside the line through its two neighbours' centres) and low (its top low_mm under
    both neighbours', or less than short_mm of crown). It is made gum again and the side counted afresh.
    `info` must be the count from the midline (order_teeth). Returns (labels, info, dropped labels)."""
    V = np.asarray(V); labels = np.asarray(labels).copy()
    c = np.asarray(c, float)[:2]
    cent, top, low = {}, {}, {}
    for t in info:
        z = V[labels == t]
        if len(z) < 10:
            continue
        cent[t] = z[:, :2].mean(0); top[t] = float(np.percentile(z[:, 2], 98)); low[t] = float(np.percentile(z[:, 2], 2))
    dropped = []
    for side in (-1, 1):
        seq = [t for p, t in sorted((p, t) for t, (s, p) in info.items() if s == side and t in cent)]
        for k in range(1, len(seq) - 1):
            a, t, b = seq[k - 1], seq[k], seq[k + 1]
            ab = cent[b] - cent[a]
            n = float(np.linalg.norm(ab))
            if n < 1e-6:
                continue
            cross = lambda p: (ab[0] * (p[1] - cent[a][1]) - ab[1] * (p[0] - cent[a][0])) / n
            inward = cross(cent[t]) * np.sign(cross(c))         # > 0: on the arch centre's side of the line
            if inward >= lingual_mm and (top[t] <= min(top[a], top[b]) - low_mm or top[t] - low[t] < short_mm):
                dropped.append(int(t))
    if not dropped:
        return labels, dict(info), []
    labels[np.isin(labels, dropped)] = 0
    new = {}
    for side in (-1, 1):
        seq = [t for p, t in sorted((p, t) for t, (s, p) in info.items() if s == side and t not in dropped)]
        for k, t in enumerate(seq):
            new[t] = (side, k + 1)
    return labels, new, dropped


def _sides(margin_f, c):
    """facial / lingual by arch angle: the line crosses every angle twice, facial at the larger radius."""
    bins = np.linspace(-np.pi, np.pi, NB + 1)

    def bin_of(a):
        return np.clip(np.digitize(a, bins) - 1, 0, NB - 1)
    ang = _arch_angle(margin_f[:, :2], c); r = np.linalg.norm(margin_f[:, :2] - c, axis=1); bm = bin_of(ang)
    r_fac = np.full(NB, np.nan); r_lin = np.full(NB, np.nan)
    for b in range(NB):
        s = bm == b
        if s.sum() >= 2 and r[s].max() - r[s].min() > 3.0:
            r_fac[b], r_lin[b] = r[s].max(), r[s].min()
    ok = np.isfinite(r_fac)
    if ok.sum() < 10:
        raise ValueError("no arch found in the line")
    r_mid = np.interp(np.arange(NB), np.where(ok)[0], (0.5 * (r_fac + r_lin))[ok])

    def facial_of(xy):
        a = _arch_angle(xy, c)
        return np.linalg.norm(xy - c, axis=1) > r_mid[bin_of(a)]
    return facial_of, bin_of, r_lin, ok


def _close(mesh, A, mask, r):
    """Closing on the surface: grow by r, shrink by r - rounds the inside corners of a region (the notch's)."""
    if r <= 0:
        return mask
    grown = geodesic_dilate(mesh, A, mask, r)
    return ~geodesic_dilate(mesh, A, ~grown, r)


def _loop(mesh, A, covered, iters=4):
    loops = margin_contour(mesh, smooth_field(A, covered.astype(float), iters), 0.5)
    return loops


def _tidy(loop, mesh_f, step=0.5, snap_mm=4.0):
    from trimesh.proximity import ProximityQuery
    out = smooth_polyline(resample_polyline(np.asarray(loop, float), step), iters=4)
    cp, dd, _ = ProximityQuery(mesh_f).on_surface(out)
    snap = dd < snap_mm
    out[snap] = cp[snap]
    return smooth_polyline(out, iters=2)


def _gauss_loop(L, sigma_mm, step=0.5):
    """Gaussian smoothing of a closed polyline (resampled every `step`) along its length."""
    from scipy.ndimage import gaussian_filter1d
    L = resample_polyline(np.asarray(L, float), step)
    if sigma_mm <= 0 or len(L) < 8:
        return L
    return gaussian_filter1d(L, sigma_mm / step, axis=0, mode="wrap")


def hairpins(L, gap_space=1.6, gap_along=6.0):
    """Where a closed line doubles back on itself: points far apart along it (> gap_along) but close in space
    (< gap_space) - a hairpin the bur cannot follow. Returns their xy (n, 2), empty when none."""
    from scipy.spatial import cKDTree
    L = np.asarray(L, float)
    if len(L) < 8:
        return np.zeros((0, 2))
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(L, axis=0), axis=1))])
    total = s[-1] + float(np.linalg.norm(L[0] - L[-1]))
    pairs = cKDTree(L).query_pairs(gap_space, output_type="ndarray")
    if len(pairs) == 0:
        return np.zeros((0, 2))
    ds = np.abs(s[pairs[:, 0]] - s[pairs[:, 1]])
    ds = np.minimum(ds, total - ds)
    bad = pairs[ds > gap_along]
    return L[bad[:, 0], :2] if len(bad) else np.zeros((0, 2))


def round_line(line, mesh_f, V, labels, keep_teeth, c, facial_of, strong_mm=2.5, light_mm=1.0, step=0.5, snap_mm=4.0):
    """No sharp turns (the doctor, 10/20/2026: "minimize sharp turns ... it's not adapted tightly to the teeth, so it
    doesn't need to be semi-scalloped - only the buccal of 2-2 and the buccal of the 6s and E/5s"). The line is
    smoothed along its length with a Gaussian of `strong_mm` everywhere - round the windows' corners, behind the last
    tooth, on the palate / tongue side - except on the cheek side of the teeth that stay (`keep_teeth`), where a
    light `light_mm` keeps a gentle scallop; the weight itself fades over a few mm, the result is put back onto the
    surface, eased once more and put back again."""
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter1d
    from trimesh.proximity import ProximityQuery
    L = resample_polyline(np.asarray(line, float), step)
    if len(L) < 12:
        return L
    keep_teeth = [int(t) for t in keep_teeth]
    km = np.isin(labels, keep_teeth)
    if not km.any():
        return _tidy(_gauss_loop(L, strong_mm, step), mesh_f, step, snap_mm=snap_mm)
    kd_keep = cKDTree(V[km]); kd_other = cKDTree(V[(labels > 0) & ~km]) if ((labels > 0) & ~km).any() else None
    d_keep = kd_keep.query(L)[0]
    d_other = kd_other.query(L)[0] if kd_other is not None else np.full(len(L), np.inf)
    # the cheek side of a tooth that stays: facial, nearer that tooth than any other by 2 mm, and not behind the last
    # tooth on its side (farther from the arch centre, by angle, than its centre's angle)
    fac = facial_of(L[:, :2])
    ang = _arch_angle(L[:, :2], c)
    last = {}
    for sd in (-1, 1):
        ts = [t for t in keep_teeth if (labels == t).any() and np.sign(V[labels == t][:, 0].mean() - c[0]) == sd]
        if ts:
            t_last = max(ts, key=lambda t: abs(float(np.mean(_arch_angle(V[labels == t][:, :2], c)))))
            last[sd] = float(np.percentile(sd * _arch_angle(V[labels == t_last][:, :2], c), 85))
    behind = np.zeros(len(L), bool)
    for sd, a_last in last.items():
        behind |= (np.sign(L[:, 0] - c[0]) == sd) & (sd * ang > a_last)
    light = fac & (d_keep <= 3.0) & (d_other > d_keep + 2.0) & ~behind
    w = gaussian_filter1d(light.astype(float), 3.0 / step, mode="wrap")      # 1 = light, 0 = strong; fades over ~3 mm
    Ls = _gauss_loop(L, strong_mm, step); Ll = _gauss_loop(L, light_mm, step)
    n = min(len(Ls), len(Ll), len(L))
    out = w[:n, None] * Ll[:n] + (1.0 - w[:n, None]) * Ls[:n]
    pq = ProximityQuery(mesh_f)
    cp, dd, _ = pq.on_surface(out)
    out[dd < snap_mm] = cp[dd < snap_mm]
    out = _gauss_loop(out, 0.6, step)
    cp, dd, _ = pq.on_surface(out)
    out[dd < snap_mm] = cp[dd < snap_mm]
    return out


def _contact(V, labels, a, b, touch_mm=1.0):
    """Where tooth `a` meets its neighbour `b`: dict(z, xy, gap_mm, kind) or None (either tooth too small to tell).
    Touching (closer than touch_mm): z is the top of their junction - the contact point, the bottom of the embrasure
    the line crosses. Apart: z is the top of the gum between them (the papilla), where the line crosses instead."""
    from scipy.spatial import cKDTree
    ia = np.where(labels == a)[0]; ib = np.where(labels == b)[0]
    if len(ia) < 30 or len(ib) < 30:
        return None
    d, _ = cKDTree(V[ib]).query(V[ia])
    dmin = float(d.min())
    near = d <= dmin + 0.35
    P = V[ia[near]]
    z_top = float(np.percentile(P[:, 2], 90))
    xy = P[P[:, 2] >= z_top - 0.6][:, :2].mean(0)
    if dmin <= touch_mm:
        return dict(z=z_top, xy=xy, gap_mm=round(dmin, 2), kind="contact")
    gum = np.where(labels == 0)[0]
    lo = np.minimum(V[ia].min(0), V[ib].min(0)) - 2.0; hi = np.maximum(V[ia].max(0), V[ib].max(0)) + 2.0
    gum = gum[np.all((V[gum] >= lo) & (V[gum] <= hi), axis=1)]
    if len(gum):
        da = cKDTree(V[ia]).query(V[gum])[0]; db = cKDTree(V[ib]).query(V[gum])[0]
        gap = gum[(da <= dmin + 1.0) & (db <= dmin + 1.0)]
        if len(gap) >= 3:
            return dict(z=float(np.percentile(V[gap, 2], 95)), xy=V[gap, :2].mean(0), gap_mm=round(dmin, 2), kind="space")
    return dict(z=z_top - 3.0, xy=xy, gap_mm=round(dmin, 2), kind="space")


def crown_of(V, labels, teeth, crown_mm=4.5, crown_r_mm=5.5):
    """The crowns of `teeth` (labels): what stands within crown_mm of each tooth's top and within crown_r_mm, seen from
    above, of the centre of its top - a label on these scans can run a few mm onto the gum (a C's label was 12 mm
    across, its palatal spill as high as its cingulum: by height alone it was all crown, 10/20/2026)."""
    V = np.asarray(V); labels = np.asarray(labels)
    crown = np.zeros(len(V), bool)
    for t in teeth:
        m_ = labels == t
        if m_.sum() < 10:
            continue
        top = float(np.percentile(V[m_, 2], 98))
        cap = m_ & (V[:, 2] >= top - 2.0)
        ctr = V[cap][:, :2].mean(0) if cap.any() else V[m_][:, :2].mean(0)
        crown |= m_ & (V[:, 2] >= top - crown_mm) & (np.linalg.norm(V[:, :2] - ctr, axis=1) <= crown_r_mm)
    return crown


def scoop_trough(V, labels, trough, keep_mask, floor_z, keep_mm=0.6, ramp_mm=2.0):
    """CUTT on the Trimlign (the doctor, 10/21/2026: "the gums in that area need to be scooped out as well, to allow
    for the passage of the tool head"): the whole window region `trough` - the chosen crowns and the gum that is theirs,
    on the cheek side and out to the window's edge on the tongue side - is cut down to a floor `floor_z` (per vertex),
    so the Trimlign's head and shank have room to reach the line round the window from inside it. Nothing rises; the
    teeth that stay keep their surface (their walls facing the trough are the trough's walls); the kept gum beside it
    (`keep_mask`) keeps its height, the trough's floor easing up to it over ramp_mm from keep_mm off it. Returns (new
    vertices, how many moved, the deepest cut)."""
    from scipy.spatial import cKDTree
    V = np.asarray(V, float)
    Vn = V.copy()
    idx = np.where(trough)[0]
    if not len(idx):
        return Vn, 0, 0.0
    # the fillet at the trough's foot is against the kept gum only (seen from above): a chosen crown's wall next to a
    # kept crown drops whole - measured against the 2's crown a C's mesial face stayed up as a wall beside the 2
    fz = np.asarray(floor_z, float)
    fz = fz[idx] if fz.shape == (len(V),) else np.full(len(idx), float(fz))
    target = fz.copy()
    if keep_mask.any():
        kv = np.where(keep_mask)[0]
        d_keep, j = cKDTree(V[kv][:, :2]).query(V[idx, :2])
        s = np.clip((d_keep - keep_mm) / max(ramp_mm, 1e-6), 0.0, 1.0)
        w = s * s * (3.0 - 2.0 * s)                   # 0 at the kept gum, 1 from keep + ramp on
        # the slope: from the kept gum's own height at its edge down to the floor (a chosen crown standing over it is
        # cut down to the slope, never left as a wall)
        z_k = V[kv[j], 2]
        target = fz + (1.0 - w) * np.maximum(z_k - fz, 0.0)
    drop = np.maximum(V[idx, 2] - target, 0.0)
    Vn[idx, 2] -= drop
    return Vn, int((drop > 0.05).sum()), float(drop.max()) if len(drop) else 0.0


def phase1_trimline(mesh_f, A, labels, info, margin_f, edge_zone, ring_center, arch="upper", method="cott",
                    picks=None, buccal_mm=1.25, plate_mm=0.0, apex_shift_mm=0.0, open_round_mm=6.0, cut_palatal_mm=1.25, cut_lingual_mm=1.5, min_bridge=5.0,
                    keep_mm=0.0, notch_round_mm=2.0, crown_mm=4.5, bridge_mm=5.0, flange_inset=1.5, flange_min=4.0, flange_max=10.0,
                    frenum_depth=3.0, frenum_width=6.0, smooth=False, scoop=True, scoop_depth_mm=1.0, scoop_ramp_mm=2.0, window_start_mm=0.0, window_e_frac=0.3,
                    round_mm=2.5, scallop_mm=1.0, span_idx=None, end_idx=None, six_idx=None, log=None):
    """The Phase I retainer's line. Returns (cut_line, body_line, info, mesh): `cut_line` is what the Trimlign cuts
    (with the C/D cutouts on CUTT); `body_line` is the same outline without them - the model is built round it, so the
    sheet forms over the whole arch as on the first trim (and BOTT cuts along it); `mesh` is the scan the model is
    built from - on CUTT with the windows scooped to a trough (scoop_trough), else mesh_f itself. Both lines
    lie on it. info['error'] when it fails."""
    import shapely
    from shapely.geometry import Polygon, box
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter1d, minimum_filter1d
    V = np.asarray(mesh_f.vertices)
    labels = np.asarray(labels)
    c = np.asarray(ring_center, float)[:2]
    res = dict(method=method, arch=arch)
    # the doctor's "6 is here" dot (the Phase I tab, 10/21/2026): the tooth under it is the 6 on its side and the side's
    # count moves with it - a diastema counted as a tooth already gone had made the 6 a "7" and the retainer cut it off
    info = {int(t): (int(s_), int(p_)) for t, (s_, p_) in info.items()}
    six = np.asarray(six_idx if six_idx is not None else [], dtype=int)
    six = six[(six >= 0) & (six < len(V))]
    if len(six) and info:
        tv = np.where(labels > 0)[0]
        kd6 = cKDTree(V[tv]) if len(tv) else None
        for i in six:
            t = int(labels[i])
            if t == 0 and kd6 is not None:
                d6, j = kd6.query(V[i])
                t = int(labels[tv[j]]) if d6 <= 3.0 else 0
            if t not in info:
                res.setdefault("warnings", []).append("a '6 is here' dot is not on a tooth - ignored")
                continue
            sd, p = info[t]
            shift = 6 - p
            if shift:
                for u, (s_, p_) in list(info.items()):
                    if s_ == sd:
                        info[u] = (s_, p_ + shift)
                res.setdefault("renumbered_by_dot", []).append(f"{patient_side(sd, arch)}: the tooth the app had as {p} is the 6")
        res["positions"] = {int(t): [int(s_), int(p_)] for t, (s_, p_) in info.items()}
    # the chosen teeth's labels run a few mm onto the gum on these scans (a C's label was 12 mm across): for the line
    # their crown is the tooth (crown_of) and the spill is gum - the gum line then hugs the real cervical, where the
    # block-out ends and the trough's floor is measured (10/21/2026: the line sat 2-5 mm below the C/Ds' cervical)
    picks0 = DEFAULT_PICKS if picks is None else picks
    sel0 = pick_teeth(info, picks0, arch)
    if sel0:
        spill = np.isin(labels, sel0) & ~crown_of(V, labels, sel0, crown_mm=crown_mm)
        if spill.any():
            labels = np.where(spill, 0, labels)
            res["label_spill_vertices"] = int(spill.sum())
    tooth = labels > 0
    try:
        facial_of, bin_of, r_lin, ok = _sides(np.asarray(margin_f, float), c)
    except ValueError as ex:
        return margin_f, margin_f, dict(error=str(ex)), mesh_f
    ang_v = _arch_angle(V[:, :2], c); bv = bin_of(ang_v)
    dist = geodesic_from_boundary(mesh_f, A, ~tooth)
    dist = np.where(tooth, 0.0, dist)
    edge = np.asarray(edge_zone, bool)
    # cheek side / tongue side of every vertex: farther from the arch centre than its nearest tooth's centre, or
    # nearer (the line's own radii fail round the arch's corner, where the C's palatal gum stands farther out than the
    # line's lingual pass and the window ran across the palate to the 2, 10/20/2026)
    tv_all = np.where(tooth)[0]
    near_all = labels[tv_all[cKDTree(V[tv_all]).query(V)[1]]] if len(tv_all) else np.zeros(len(V), int)
    r_cent = {int(t): float(np.linalg.norm(V[labels == t][:, :2].mean(0) - c)) for t in np.unique(labels[tooth])}
    r_near = np.array([r_cent.get(int(t), 0.0) for t in near_all]) if len(tv_all) else np.zeros(len(V))
    fac_v = np.linalg.norm(V[:, :2] - c, axis=1) > r_near
    # --- the cheek side and round the last molars: the retainer's band, buccal_mm onto the gum
    covered = tooth | (~tooth & (dist <= buccal_mm))
    # --- tongue side
    cent = {int(t): V[labels == t].mean(0) for t in info}
    by = {}
    for t, (side, pos) in info.items():
        by[(int(side), int(pos))] = int(t)
    lin_v = ~tooth & ~fac_v
    # --- the cutouts (CUTT): the chosen teeth and the gum that is theirs (nearest tooth), all of it on the cheek
    #     side, cut_palatal_mm onto the palate / lingual gum - less a keep_mm margin next to the teeth that stay
    #     (the distal wall of the 2, the mesial of the E); the notch's inside corners rounded so the bur reaches
    picks = DEFAULT_PICKS if picks is None else picks
    sel = pick_teeth(info, picks, arch)
    res["teeth"] = [f"{patient_side(info[t][0], arch)}{info[t][1]}" for t in sel]
    # never the 12-year molars (the doctor, 10/20/2026: "we're waiting for teeth to erupt in, I don't want anything
    # blocking them - the retainer should only rely on the 6s, the Es or the second bicuspids"): on a Phase I the
    # retainer ends at the 6's distal wall; a 7 (or anything behind it) and its gum are left out, by cutouts and
    # block-out alike, and the model is scooped there like a cutout so the bur runs along the foot of the 6's wall
    seven = sorted(int(t) for t, (sd, p) in info.items() if int(p) >= 7)
    if seven:
        res["uncovered"] = [f"{patient_side(info[t][0], arch)}{info[t][1]}" for t in seven]
    # the cutout's extent is fixed, whatever teeth stand in it (the doctor, 10/21/2026: "right next to the lateral,
    # half a millimetre after it - that's the space for the canine, whether the tooth is there already or not - all
    # the way to a quarter into the crown of the E; that is the extent of the cutout at any given time"): round the
    # arch (by angle from the arch centre) from window_start_mm past the 2's distal to window_e_frac of the E's
    # width into the E (the 5 in its place; without one, the 6's mesial). Without a 2 the 1's distal
    r_arch = float(np.median(np.linalg.norm(V[tooth][:, :2] - c, axis=1))) if tooth.any() else 20.0
    segs = {}
    for sd in (-1, 1):
        a_t = by.get((sd, 2)) or by.get((sd, 1))
        e_t = by.get((sd, 5))
        frac = window_e_frac
        if e_t is None:
            e_t = by.get((sd, 6)); frac = 0.0
        if a_t is None or e_t is None:
            continue
        ma, me = labels == a_t, labels == e_t
        if ma.sum() < 30 or me.sum() < 30:
            continue
        th_a = float(np.percentile(sd * ang_v[ma], 98))
        e_lo, e_hi = (float(np.percentile(sd * ang_v[me], q)) for q in (2, 98))
        segs[sd] = dict(start=th_a + window_start_mm / r_arch, end=e_lo + frac * (e_hi - e_lo), tooth_a=int(a_t), tooth_e=int(e_t),
                        e_edge=e_lo + frac * (e_hi - e_lo) + 0.3 / r_arch)
    res["window"] = {patient_side(sd, arch): (f"{window_start_mm:.1f} mm past the {info[g['tooth_a']][1]}'s distal to " if window_start_mm > 0 else f"the {info[g['tooth_a']][1]}'s distal face to ")
                     + f"{int(round(100 * (window_e_frac if by.get((sd, 5)) else 0.0)))} % into the {'E/5' if by.get((sd, 5)) else '6'}" for sd, g in segs.items()}
    # the doctor's own dots (the Phase I tab, 10/21/2026: "I can identify the width of the cutouts by 2 clicks - the
    # mesio-distal span"): two or more dots on a side make the cutout run from the nearest to the farthest of them
    # round the arch, whatever stands there - no 2, no E needed. One dot alone is not enough and says so.
    manual = {}
    si = np.asarray(span_idx if span_idx is not None else [], dtype=int)
    si = si[(si >= 0) & (si < len(V))]
    for sd in (-1, 1):
        d = si[np.sign(V[si, 0] - c[0]) == sd]
        if len(d) >= 2:
            a = np.sort(sd * ang_v[d])
            start, end = float(a[0]), float(a[-1])
            if end - start < 1.0 / r_arch:
                res.setdefault("warnings", []).append(f"the two cutout dots on the {'right' if patient_side(sd, arch) == 'R' else 'left'} are on top of each other - the automatic extent used there")
                continue
            segs[sd] = dict(start=start, end=end, tooth_a=None, tooth_e=None, e_edge=end + 0.3 / r_arch, manual=True)
            manual[sd] = int(len(d))
            d_near, d_far = d[np.argmin(sd * ang_v[d])], d[np.argmax(sd * ang_v[d])]
            res.setdefault("window", {})[patient_side(sd, arch)] = f"between your dots ({np.linalg.norm(V[d_near, :2] - V[d_far, :2]):.1f} mm apart)"
        elif len(d) == 1:
            res.setdefault("warnings", []).append(f"one cutout dot on the {'right' if patient_side(sd, arch) == 'R' else 'left'} - two are needed (the near and the far end of the cutout): the automatic extent used there")
    if manual:
        res["manual_sides"] = [patient_side(sd, arch) for sd in manual]
    # ... and where the retainer ends ("Ends here", one dot per side): nothing is covered behind the dot, the 7 rule
    # aside - the teeth standing behind it count as uncovered, by both methods
    end_ang = {}
    ei = np.asarray(end_idx if end_idx is not None else [], dtype=int)
    ei = ei[(ei >= 0) & (ei < len(V))]
    for sd in (-1, 1):
        d = ei[np.sign(V[ei, 0] - c[0]) == sd]
        if len(d):
            end_ang[sd] = float(np.min(sd * ang_v[d]))
    if end_ang:
        for t, (sd, p) in info.items():
            t = int(t)
            if sd in end_ang and t not in seven and (labels == t).any():
                if float(np.median(sd * ang_v[labels == t])) > end_ang[sd]:
                    seven.append(t)
        seven = sorted(set(seven))
        if seven:
            res["uncovered"] = [f"{patient_side(info[t][0], arch)}{info[t][1]}" for t in seven]
        res["ends_at_dot"] = [patient_side(sd, arch) for sd in end_ang]
    # the teeth a manual span covers (a block-out over them on BOTT): the crowns whose middle lies in the span
    if manual:
        res["span_labels"] = sorted(int(t) for t, (sd, p) in info.items() if sd in manual and (labels == int(t)).any()
                                    and segs[sd]["start"] <= float(np.median(sd * ang_v[labels == int(t)])) <= segs[sd]["end"])
    # a chosen position with no tooth in it (the C already lost, the canine on its way in): the space it left is cut
    # out too - the gum between the tooth in front of it and the one behind (seen from above, inside the hull of those
    # two crowns, and nearer to them than to any other tooth; the 2's distal wall itself stays covered: keep_mm). Not a
    # wedge of angles from the arch centre: that ran to the middle of the palate and the window grew a spur (10/20/2026)
    space = np.zeros(len(V), bool)
    for side, pos in sorted(pick_slots(picks, arch)):
        if (side, pos) in by:
            continue
        mes = [p for (s, p) in by if s == side and p < pos]
        dis = [p for (s, p) in by if s == side and p > pos]
        if not mes or not dis:
            continue
        a, b = by[(side, max(mes))], by[(side, min(dis))]
        ma, mb = labels == a, labels == b
        if ma.sum() < 30 or mb.sum() < 30:
            continue
        from shapely.geometry import MultiPoint
        hull = MultiPoint(np.vstack([V[ma][:, :2], V[mb][:, :2]])).convex_hull
        # ... and round the arch strictly past the one and short of the other (by arch angle): the 2's own palatal gum
        # band lies inside that hull too (the chord between an incisor and a molar cuts across the arch's corner), and
        # a window that took it ran a finger along the 2's palatal side
        lo_ = float(np.percentile(side * ang_v[ma], 97)); hi_ = float(np.percentile(side * ang_v[mb], 3))
        if hi_ - lo_ < 0.02:
            continue
        between = (~tooth & np.isin(near_all, [a, b]) & shapely.contains_xy(hull, V[:, 0], V[:, 1])
                   & (side * ang_v > lo_) & (side * ang_v < hi_))
        if between.sum() < 20:
            continue
        space |= between
        res.setdefault("spaces", []).append(f"{patient_side(side, arch)}{pos}")
    covered |= space          # the body spans the space as the first trim does (the window is cut out of it)
    # the windows, seen from above (CUTT): each side's chosen crowns (the top crown_mm of their labels - a label can run
    # onto the gum) and the crest of any space, cut_palatal_mm out - where the plate must reach and what the opening
    # keeps its bridge from (the window's own edge on the palate hugs the gum, below)
    windows = []
    in_seg = np.zeros(len(V), bool)
    span_of = {}; wedge_of = {}
    r_v = np.linalg.norm(V[:, :2] - c, axis=1)
    ridge = ~tooth & (np.abs(r_v - r_near) <= 3.0)       # the alveolar crest band: within 3 mm, in and out, of the teeth's centre line
    for sd, g in segs.items():
        wedge_of[int(sd)] = (np.sign(V[:, 0] - c[0]) == sd) & (sd * ang_v >= g["start"]) & (sd * ang_v <= g["end"])
        in_seg |= wedge_of[int(sd)]
        span_of[int(sd)] = wedge_of[int(sd)] & (tooth | ridge)
    # each side's window for the block-out (BOTT): the teeth and the crest band in it, and the whole wedge from the arch
    # centre for the block's feather; not for the report
    res["_span"] = span_of; res["_wedge"] = wedge_of
    if method == "cott":
        from shapely.geometry import MultiPoint
        for sd in segs:
            m_ = in_seg & (np.sign(V[:, 0] - c[0]) == sd) & (tooth | (dist <= 2.0))
            if m_.sum() >= 20:
                windows.append(MultiPoint(V[m_][:, :2]).convex_hull.buffer(cut_palatal_mm, join_style=1))
    if arch == "upper":
        # the palate inside the palatal gum line, seen from above (the line's lingual points in arch order, closed
        # straight across behind the last teeth), less a U-shaped opening: farther than plate_mm from that line
        # and behind the D/E contacts, its corners rounded
        # (the lingual pass in the line's own order - the longest run of lingual points round the loop - closed straight
        # across the back; sorted by angle from the arch centre it cut chords across the concavities round the D's
        # palatal bulge and left a bare strip between the gum band and the plate, which made a hairpin in the line)
        Mf = np.asarray(margin_f, float)
        isl = ~facial_of(Mf[:, :2])
        n_m = len(Mf)
        if isl.all():
            lin_pts = Mf
        else:
            start = int(np.argmin(isl))                           # a facial point; walk from it so a run never wraps
            idx = (start + np.arange(n_m)) % n_m
            best, cur = [], []
            for i in idx:
                if isl[i]:
                    cur.append(i)
                else:
                    if len(cur) > len(best):
                        best = cur
                    cur = []
            if len(cur) > len(best):
                best = cur
            lin_pts = Mf[best] if len(best) >= 10 else Mf[isl]
        P_lin = Polygon(lin_pts[:, :2])
        if not P_lin.is_valid:
            P_lin = P_lin.buffer(0)
            if hasattr(P_lin, "geoms"):
                P_lin = max(P_lin.geoms, key=lambda g: g.area)
        ys = []
        for side in (-1, 1):
            d_, e_ = by.get((side, 4)), by.get((side, 5))
            if d_ is not None and e_ is not None:
                ys.append(0.5 * (cent[d_][1] + cent[e_][1]))
            elif d_ is not None:
                ys.append(cent[d_][1] - 4.0)
        if not ys:
            return margin_f, margin_f, dict(error="the C/D/E teeth could not be found - check the tooth split"), mesh_f
        y_apex = float(np.mean(ys)) + float(apex_shift_mm)
        # along the E/6 segments the line hugs the gingival margin like the first trim (the doctor, 10/20/2026: "it
        # just needs to hug the teeth ... dropping it down into the palate makes the retainer weaker"): plate_mm = 0.
        # With plate_mm > 0 arms that wide run along them, never more than a fifth of the palate's width at the apex
        x0, y0, x1, y1 = P_lin.bounds
        at_apex = P_lin.intersection(box(x0 - 50, y_apex - 0.5, x1 + 50, y_apex + 0.5))
        width = float(at_apex.bounds[2] - at_apex.bounds[0]) if not at_apex.is_empty else float(x1 - x0)
        plate_eff = float(max(0.0, min(plate_mm, 0.2 * width)))
        inner = P_lin.buffer(-plate_eff) if plate_eff > 0 else P_lin
        if not inner.is_empty:
            # open at the back, as the office's own (p2): the opening runs from its apex straight out past the end of the
            # scan - plate_mm in from the teeth on each side, no strip of plate left across the back of the palate
            # (P_lin is closed straight across behind the last teeth; shrunk, that edge stood plate_mm inside the scan)
            from shapely.affinity import translate
            reach = (y1 - y0) + 10.0
            inner = shapely.union_all([translate(inner, 0.0, -k) for k in np.arange(0.0, reach, 0.5)])
        opening = inner.intersection(box(x0 - 50, y0 - 50, x1 + 50, y_apex)) if not inner.is_empty else inner
        if not opening.is_empty and windows:
            # a bridge of plate at least bridge_mm wide stays between each window and the opening - it is what joins the
            # front plate to the arms (the office's own run 4-5 mm of plate past the D's palatal side, p2)
            opening = opening.difference(shapely.union_all([w.buffer(bridge_mm, join_style=1) for w in windows]))
            if hasattr(opening, "geoms"):
                opening = max(opening.geoms, key=lambda g: g.area) if len(opening.geoms) else opening
        if not opening.is_empty:
            b = opening.bounds
            r = min(open_round_mm, 0.3 * min(b[2] - b[0], b[3] - b[1]))
            rounded = opening.buffer(-r).buffer(r) if r > 0.5 else opening
            if not rounded.is_empty and rounded.area > 0.5 * opening.area:
                opening = rounded
        in_lin = shapely.contains_xy(P_lin, V[:, 0], V[:, 1])
        in_open = shapely.contains_xy(opening, V[:, 0], V[:, 1]) if not opening.is_empty else np.zeros(len(V), bool)
        # the plate reaches at least cut_palatal_mm + 1 from the teeth, and covers every window's extent, whatever the
        # first-trim line did there (round a space it stands off the teeth - the ridge is bridged - and a strip of
        # bare palate between the plate and the window put a hairpin in the line, 10/20/2026)
        in_w_all = np.zeros(len(V), bool)
        for Wp in windows:
            in_w_all |= shapely.contains_xy(Wp, V[:, 0], V[:, 1])
        covered |= lin_v & (in_lin | (dist <= buccal_mm) | in_w_all) & ~in_open
        res["plate"] = dict(plate_mm=round(plate_eff, 1), palate_width_mm=round(width, 1), u_apex_y=round(y_apex, 1), opening_mm2=round(float(opening.area), 0))
        if opening.is_empty:
            res.setdefault("warnings", []).append("no room for an opening behind the plate - the palate is covered: check the line")
    else:
        # the lingual flange: as deep as the scan goes (flange_inset short of its edge), flange_min..flange_max mm
        # below the gum line, eased round the arch; a notch at the lingual frenum (the midline)
        avail = np.full(NB, np.nan)
        for b in range(NB):
            s = lin_v & ~edge & (bv == b)
            if s.sum() >= 5:
                avail[b] = np.percentile(dist[s], 98)
        okb = np.isfinite(avail)
        if okb.sum() < 10:
            return margin_f, margin_f, dict(error="no lingual side in the scan"), mesh_f
        avail = np.interp(np.arange(NB), np.where(okb)[0], avail[okb])
        depth = np.clip(avail - flange_inset, flange_min, flange_max)
        depth = gaussian_filter1d(minimum_filter1d(depth, 5, mode="wrap"), 2.0, mode="wrap")
        r_med = float(np.nanmedian(r_lin[ok])) if ok.any() else 15.0
        half = 0.5 * frenum_width / max(r_med, 5.0)
        ang_b = np.linspace(-np.pi, np.pi, NB + 1)[:-1] + np.pi / NB
        t = np.clip(np.abs(ang_b) / half, 0, 1)
        depth = np.where(t < 1, np.minimum(depth, frenum_depth + (depth - frenum_depth) * (0.5 - 0.5 * np.cos(np.pi * t))), depth)
        # the flange ends with the teeth: behind the last tooth on each side it eases from its depth to the gum band
        # over 4 mm of arch, so the line wraps the last tooth's distal as the first trim does (on one scan the pad
        # behind a 6 was scanned 12 mm back and the flange ran out along it - a lobe of retainer behind the molar,
        # 10/21/2026)
        depth_v = depth[bv].astype(float)
        r_lin_med = float(np.nanmedian(r_lin[ok])) if ok.any() else 15.0
        for sd in (-1, 1):
            ts = [t for t, (s_, p_) in info.items() if s_ == sd and (labels == int(t)).any()]
            if not ts:
                continue
            t_last = max(ts, key=lambda t: info[t][1])
            a_end = float(np.percentile(sd * ang_v[labels == int(t_last)], 97))
            if sd in end_ang:
                a_end = min(a_end, end_ang[sd])
            on_side = np.sign(V[:, 0] - c[0]) == sd
            over_mm = np.clip(sd * ang_v - a_end, 0.0, None) * r_lin_med
            w = np.clip(over_mm / 4.0, 0.0, 1.0)
            depth_v = np.where(on_side, depth_v * (1.0 - w) + buccal_mm * w, depth_v)
        covered |= lin_v & (dist <= depth_v)
        flange_v = np.minimum(depth, avail - flange_inset)[bv]       # what the scan really holds (depth is held to flange_min)
        res["flange_mm"] = dict(min=round(float(depth.min()), 1), median=round(float(np.median(depth)), 1), max=round(float(depth.max()), 1))
    covered &= ~edge | tooth
    # no slivers: the plate / flange (beyond the cheek band) loses anything under 2 mm wide - a thin strip left
    # between the opening and the scan's edge made a small loop in the line
    far = covered & ~tooth & (dist > buccal_mm + 0.25)
    if far.any():
        opened = geodesic_dilate(mesh_f, A, ~geodesic_dilate(mesh_f, A, ~far, 1.0), 1.0) & far
        covered = (covered & ~far) | opened
    # no slits: a bare strip narrower than 3 mm between two covered parts (the plate and a gum band) is covered too -
    # the line round it was a hairpin (10/21/2026)
    covered = _close(mesh_f, A, covered, 1.5) & (~edge | tooth)
    # one piece: the retainer is the largest connected part of that region. On one lower the gum behind the last molar
    # was cut off from the rest by the scan's edge zone - the model was built round the main part, but the cut line
    # (its region closed 2 mm, which bridged the gap) went round the stray part too, 12 mm off the model in the air
    # (10/21/2026). Whatever is not joined to the main part is left out of both lines, and the case says so.
    from .mesh_utils import connected_components
    comp = connected_components(covered, A)
    if comp.max() > 0:
        sizes = np.bincount(comp[comp >= 0])
        main = int(np.argmax(sizes))
        stray = covered & (comp != main)
        if stray.any():
            n_big = int((sizes >= 0.05 * sizes[main]).sum()) - 1
            covered = covered & ~stray
            if n_big:
                res.setdefault("warnings", []).append(
                    f"the outline came out in {n_big + 1} pieces - the {'smaller one is' if n_big == 1 else 'smaller ones are'} left out of the retainer: check the scan")
            res["outline_pieces_dropped"] = int(stray.sum())
    body = covered.copy()
    cut = body.copy()
    # the 12-year molars and their gum (all of it: cheek side, tongue side, the pad behind) come out of the line, right
    # up to the 6's own surface (keep_mm = 0: a strip of gum kept beside the 6 stood as a ledge in the trough under the
    # line, in the bur's way) - by both methods
    chunk7 = np.zeros(len(V), bool)
    if seven or end_ang:
        chunk7 = np.isin(labels, seven) | (~tooth & np.isin(near_all, seven))
        for sd, a_e in end_ang.items():
            chunk7 |= (np.sign(V[:, 0] - c[0]) == sd) & (sd * ang_v > a_e)
        keep6 = tooth & ~chunk7
        if keep6.any():
            chunk7 &= cKDTree(V[keep6]).query(V)[0] > keep_mm
        cut = body & ~chunk7
        cut = _close(mesh_f, A, cut, notch_round_mm) & body
    window = np.zeros(len(V), bool)        # what the line goes round (the cutout)
    trough = np.zeros(len(V), bool)        # what is scooped (the cutout and the strip beside the 2)
    if method == "cott" and segs and arch != "upper":
        # the bridge of flange under the windows must be min_bridge wide (the doctor, 10/20/2026: "min 5 mm - if below
        # that reject the cutouts and just do block-out"): what the scan holds below the window's edge on the tongue
        # side, over the 10th percentile along the window
        zone = in_seg & lin_v
        held = float(np.percentile(flange_v[zone], 10)) if zone.any() else 0.0
        bridge_avail = max(0.0, held - cut_lingual_mm)
        res["bridge_mm"] = round(bridge_avail, 1)
        if bridge_avail < min_bridge:
            res["cutout_rejected"] = (f"only {bridge_avail:.1f} mm of flange would be left under the cutouts on the tongue side "
                                      f"({min_bridge:.0f} mm needed) - made with block-out instead")
            res.setdefault("warnings", []).append(res["cutout_rejected"])
            method = "bott"
            res["method"] = "bott"
            res["method_asked"] = "cott"
    if method == "cott" and segs:
        for sd, g in segs.items():
            on_side = np.sign(V[:, 0] - c[0]) == sd
            ta = g["tooth_a"]
            # the segment on the tongue side reaches the window's edge: the gum line (cut_palatal_mm / cut_lingual_mm
            # onto the gum) - on a lower no further than the flange less its bridge
            reach = float(cut_palatal_mm if arch == "upper" else cut_lingual_mm)
            inner = dist <= (reach if arch == "upper" else np.minimum(reach, flange_v - min_bridge))
            if ta is None:
                # the doctor's span: the dots are the walls, whatever stands there (a crown is cut at the dot as the
                # E is at its 30 %); the line lies 0.3 mm beyond each wall on what stays
                base_ = on_side & (tooth | fac_v | inner)
                trough |= base_ & (sd * ang_v >= g["start"]) & (sd * ang_v <= g["end"])
                window |= base_ & (sd * ang_v >= g["start"] - 0.3 / r_arch) & (sd * ang_v <= g["e_edge"])
                continue
            d_a = cKDTree(V[labels == ta]).query(V)[0]
            deep = on_side & (sd * ang_v >= g["start"]) & (labels != ta) & (tooth | fac_v | inner)
            # the trough: everything in the segment right up to the 2's own surface and to the E's cut - nothing stands
            # in the trough beside the 2's wall (a 0.5 mm strip of gum kept at its height there was a ledge under the
            # line, where the bur would crash - the doctor, 10/21/2026); the trough's wall is the 2's distal face down to
            # the floor and the line lies on the 2's rim
            trough |= deep & (sd * ang_v <= g["end"]) & (d_a > keep_mm)
            # the window the line goes round: the 2's surface (window_start_mm = 0), and 0.3 mm short of the E's cut on
            # the E's crown - so the line lies on the 2's distal face and on the E's own surface beside the cut, where
            # the bur reaches from inside the trough
            window |= deep & (sd * ang_v <= g["e_edge"]) & (d_a > window_start_mm)
        window &= body
        cut = body & ~window & ~chunk7
        cut = _close(mesh_f, A, cut, notch_round_mm) & body
        # ... and no slivers of plate / flange left beside a window (a wedge of plate narrowing to nothing where the
        # window's edge met the 2's gum band made a hairpin in the line, 10/20/2026): beyond the cheek band, anything
        # under 2 mm wide goes
        far = cut & ~tooth & (dist > buccal_mm + 0.25)
        if far.any():
            cut = (cut & ~far) | (geodesic_dilate(mesh_f, A, ~geodesic_dilate(mesh_f, A, ~far, 1.0), 1.0) & far)
        res["teeth"] = sorted({f"{patient_side(info[int(t)][0], arch)}{info[int(t)][1]}" for t in np.unique(labels[trough & tooth]) if int(t) in info})
        res["cutout"] = dict(window=res.get("window"), teeth=res["teeth"], palatal_mm=cut_palatal_mm, keep_mm=keep_mm)
    elif method == "cott":
        res.setdefault("warnings", []).append("the 2 and the E could not be found on either side - the line is the first trim, without windows")

    # the model: on CUTT the windows scooped to a trough so the tool head reaches the line round them (scoop_trough);
    # both lines are traced on that surface (the regions above were found on the scan as it is)
    mesh_out = mesh_f
    trough = (trough if method == "cott" else np.zeros(len(V), bool)) | chunk7
    if trough.any() and scoop:
        import trimesh
        try:
            # the trough's floor: scoop_depth_mm below the lowest point of the first-trim line on the cheek side of the
            # window (the gum line there), per side - the window's line never sits below the floor's edge
            Mf = np.asarray(margin_f, float)
            m_fac = facial_of(Mf[:, :2])
            floor_z = np.full(len(V), np.nan)
            for sd in (-1, 1):
                tr_s = trough & (np.sign(V[:, 0] - c[0]) == sd)
                if not tr_s.any():
                    continue
                a_lo, a_hi = np.percentile(sd * ang_v[tr_s], [3, 97])
                sel_m = m_fac & (np.sign(Mf[:, 0] - c[0]) == sd) & (sd * _arch_angle(Mf[:, :2], c) >= a_lo - 0.05) & (sd * _arch_angle(Mf[:, :2], c) <= a_hi + 0.05)
                z_ref = float(np.percentile(Mf[sel_m, 2], 5)) if sel_m.sum() >= 3 else float(np.percentile(V[tr_s & ~tooth, 2], 5)) if (tr_s & ~tooth).any() else float(V[tr_s, 2].min())
                floor_z[tr_s] = z_ref - float(scoop_depth_mm)
            floor_z = np.where(np.isfinite(floor_z), floor_z, V[:, 2])
            keep_mask = ~tooth & ~trough & ~edge                  # the kept gum beside the trough
            Vs, n_moved, deepest = scoop_trough(V, labels, trough, keep_mask, floor_z, keep_mm=0.0, ramp_mm=scoop_ramp_mm)
            res["scoop"] = dict(vertices=n_moved, max_mm=round(deepest, 1), depth_below_gum_line_mm=float(scoop_depth_mm))
            if n_moved:
                mesh_out = trimesh.Trimesh(Vs, np.asarray(mesh_f.faces), process=False)
        except Exception as ex:  # noqa
            res.setdefault("warnings", []).append(f"the windows could not be scooped ({str(ex)[:80]}) - the Trimlign may not reach the line round them: check")
    # the lines are traced on the scan as it is and put onto the scooped surface after: traced on it, a contour that
    # crosses an edge of the trough's wall (a chosen crown's dropped rim next to the E's kept crown, 9 mm apart in
    # height after the scoop) sat part-way down the wall and the line dived 5 mm into the trough and back (the hairpin
    # at the E's cut edge, 10/21/2026); the nearest point of the scooped surface to the contour on the scan is the rim
    lines = {}
    for nm, region in (("body", body), ("cut", cut)):
        loops = _loop(mesh_f, A, region)
        if not loops:
            return margin_f, margin_f, dict(error=f"the {nm} outline did not close"), mesh_f
        if len(loops) > 1 and len(loops[1]) > 0.25 * len(loops[0]):
            if nm == "cut":
                # the windows cut the retainer apart (too little plate / flange between them and the scan's edge): one
                # line cannot cut that - the first trim instead, and the cutouts by hand or block-out (on the scan as
                # it is: nothing scooped for a cut the Trimlign does not make)
                res.setdefault("warnings", []).append(
                    "the cutouts would cut the retainer into pieces (too little " + ("palate" if arch == "upper" else "tongue-side gum")
                    + " in the scan between the windows and its edge) - the line is the first trim without windows: cut the C/Ds by hand, use block-out (BOTT), or scan deeper")
                res["cutout_failed"] = True
                if mesh_out is not mesh_f:
                    mesh_out = mesh_f
                    res.pop("scoop", None)
                    lines["body"] = _tidy(_loop(mesh_f, A, body)[0], mesh_f)
                lines["cut"] = lines["body"]
                continue
            res.setdefault("warnings", []).append(f"the {nm} outline came out in {len(loops)} loops - check the scan")
        # onto the scooped surface whatever the drop under a point (the body line over a scooped 7 hung 5.6 mm in the
        # air with the usual 4 mm snap; the model is built round it)
        lines[nm] = _tidy(loops[0], mesh_out, snap_mm=25.0)
    # no sharp turns: the lines rounded, a gentle scallop only on the cheek side of the teeth that stay
    keep_teeth = [int(t) for t in info if int(t) not in sel and int(t) not in seven]
    for nm in list(lines):
        try:
            lines[nm] = round_line(lines[nm], mesh_out, V, labels, keep_teeth, c, facial_of, strong_mm=round_mm, light_mm=scallop_mm, snap_mm=25.0)
        except Exception as ex:  # noqa
            res.setdefault("warnings", []).append(f"the {nm} line was not rounded ({str(ex)[:60]})")
    if smooth:
        # smooth from every side, as the mouthguard's palatal stretch (rides over the rugae; the cheek side, the
        # teeth and what touches them keep their place)
        from .mouthguard import _taut_palatal
        for nm in ("body", "cut"):
            try:
                ln = lines[nm]
                lines[nm], _ = _taut_palatal(ln, mesh_out, labels, edge, dist, facial_of(ln[:, :2]), sigma_mm=3.0)
            except Exception as ex:  # noqa
                res.setdefault("warnings", []).append(f"line not smoothed ({str(ex)[:80]})")
    res.update(points=int(len(lines["cut"])))
    hp = hairpins(lines["cut"])
    if len(hp):
        res["hairpins"] = int(len(hp))
        side_txt = patient_side(1 if hp[0, 0] > c[0] else -1, arch)
        res.setdefault("warnings", []).append(
            f"the line doubles back on itself on the {'right' if side_txt == 'R' else 'left'} ({len(hp)} spots) - check it before cutting")
    if log:
        what = (f"cutouts round {', '.join(res['teeth'])}" if method == "cott" and sel else "block-out" if method == "bott" else "no cutouts")
        if seven:
            what += f"; nothing over {', '.join(res['uncovered'])}"
        tongue = (f"palate plate {res['plate']['plate_mm']} mm, open behind y={res['plate']['u_apex_y']}" if arch == "upper"
                  else f"lingual flange {res['flange_mm']['min']}-{res['flange_mm']['max']} mm")
        log(f"phase I retainer ({'CUTT' if method == 'cott' else method.upper()}): {what}; {tongue}")
        sc = res.get("scoop")
        if sc:
            log(f"phase I: the windows scooped to a trough {sc['depth_below_gum_line_mm']:.0f} mm below the gum line - up to {sc['max_mm']} mm off, "
                f"{sc['vertices']} vertices; window " + "; ".join(f"{k}: {v}" for k, v in (res.get("window") or {}).items()))
    return lines["cut"], lines["body"], res, mesh_out


def block_outs(mesh_f, labels, sel, opposing_f=None, clearance_mm=2.0, max_mm=2.0, clear_mm=0.2, share=0.5, flat_mm=0.5,
               full_mm=2.0, keep_mm=0.8, spacing=0.2, crown_mm=4.5, line=None, line_gap_mm=0.3, span=None, wedge=None, log=None):
    """BOTT: the block-out built into the model in place of the putty - one solid block over each side's run of chosen
    teeth (`sel`, tooth labels), not shaped to the teeth under it (the doctor, 10/20/2026: "a solid block, almost like a
    blob that is smoothed out on the top ... don't try to match the anatomy"), with room round the teeth as the
    mouthguard's band has round the brackets: "clearance on the buccal, on the lingual ... so if the teeth are coming
    in sideways they're not hitting the tray". The block is the convex hull of the run's crowns pushed out on every
    side and lifted on top by what the bite allows - share x (the gap to the opposing teeth less clear_mm), at most
    max_mm. The push is the full clearance_mm from the top down to full_mm below each crown's top, then **tapers to
    nothing at the trim line** (line_gap_mm above it), the gum between the cervical and the line taken into the hull -
    so the block's sides run down into the model like putty feathered onto the gum, its foot on the gum right at the
    line: no shelf, no gap under a foot, the line matches the block, and the sheet's edge at the line points apically,
    not at the cheek (the doctor, 10/21/2026: "edges that are overhanging with a space under them are where the
    patient's lip gets irritated - a smooth transition apically into the model; the edges of the retainer should not be
    pointing towards the cheeks or the lips"). Under its footprint the block is filled down to the model's surface, the
    undercuts under the crowns filled down to the gum as putty does. Never onto a neighbouring tooth (keep_mm). Without
    the opposing arch (`opposing_f`, in this model's frame) the lift is flat_mm and a warning; without `line` the gum
    line is the crowns' lowest 3 %.
    `span` ({side sign: bool mask over the vertices} - each side's window, the cutout's own extent: from the 2's distal
    face to a quarter into the E, or between the doctor's dots): given, the block stands over that stretch whatever is in
    it - the C and D, the space where they were (the premolars come in there), the E's mesial quarter - and ends at its
    ends, not at the end of a tooth (the doctor, 10/21/2026: a dot a quarter into the E put the block over the whole E,
    and a side whose C and D were already gone got no block at all). The stretch's surface above the trim line is the
    block's seed in place of the crowns - the teeth in it by their crowns and the crest band of its gum (the ridge
    where the C and D were); the room round it and the lift on top are as for the crowns, and the feather over the gum
    down to the line stays within the window's wedge (`wedge`, {side sign: mask}: the stretch round the arch, out to
    the cheek and in to the tongue). A side without a window falls back to the chosen teeth on it. Returns (solid or
    None, info)."""
    import trimesh
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter
    from skimage.measure import marching_cubes
    V = np.asarray(mesh_f.vertices); N = np.asarray(mesh_f.vertex_normals)
    z_line = None
    if line is not None and len(line) > 3:
        Lxy = np.asarray(line, float)
        kd_l = cKDTree(Lxy[:, :2])
        z_line = lambda P: Lxy[kd_l.query(np.asarray(P)[:, :2])[1], 2]
    labels = np.asarray(labels)
    sel = [int(t) for t in sel]
    info = dict(teeth=len(sel), clearance_mm=clearance_mm)
    tooth = labels > 0
    above = (V[:, 2] >= z_line(V) + line_gap_mm) if z_line is not None else np.ones(len(V), bool)
    # one block per side: its seed region - the window's surface above the line (teeth by their crowns, the gum and
    # the ridge as they stand), or without a window the chosen teeth's crowns on that side
    regions = {}
    under_t = set()                                 # the teeth under a block (their crowns in a region)
    for sd, m in (span or {}).items():
        m = np.asarray(m, bool)
        if m.sum() < 30:
            continue
        # the teeth in the stretch: by their crowns, and only a tooth with a real part of its crown in it (the E's
        # mesial quarter, yes; the 2 whose last vertices touch the window's start, no - it stays a neighbour kept clear)
        in_t = [int(t) for t in np.unique(labels[m & tooth])]
        cr = crown_of(V, labels, in_t, crown_mm=crown_mm) if in_t else np.zeros(len(V), bool)
        for t in in_t:
            ct = cr & (labels == t)
            if ct.sum() < 30 or (ct & m).sum() < 0.12 * ct.sum():
                cr &= labels != t
        reg = (m & above & ~tooth) | (m & cr)
        if reg.sum() >= 30:
            regions[int(sd)] = reg
            under_t |= {int(t) for t in np.unique(labels[reg & tooth])}
    crown_sel = crown_of(V, labels, sel, crown_mm=crown_mm) if sel else np.zeros(len(V), bool)
    windowed = set(regions)
    for t in sel:
        m_ = crown_sel & (labels == t)
        if m_.any():
            sd = int(np.sign(V[m_][:, 0].mean()) or 1)
            if sd not in windowed:
                regions[sd] = regions.get(sd, np.zeros(len(V), bool)) | m_
                under_t.add(int(t))
    if not regions:
        return None, dict(info, error="no window and no teeth chosen" if span is not None else ("no teeth chosen" if not sel else "no crowns found under the chosen teeth"))
    region_all = np.zeros(len(V), bool)
    for reg in regions.values():
        region_all |= reg
    crown = region_all & tooth                      # the crown part of the seeds (the undercut fill, the thickness)
    info["labels_under"] = sorted(under_t)
    others = tooth & ~np.isin(labels, sorted(under_t))
    kd_other = cKDTree(V[others]) if others.any() else None
    # the lift above the crowns: what the bite allows over the cusps - share of (the gap to the opposing teeth less
    # clear_mm), at most max_mm; one lift for the whole block (the 10th percentile over the crowns' top 2 mm: a tight
    # bite gives a thin block, not a dented one). Without the bite, flat_mm
    # the opposing surface straight above every crown vertex (the opposing arch's lowest point in a 0.5 mm cell)
    zo_at = None
    if opposing_f is not None:
        Vo = np.asarray(opposing_f.vertices)
        Vr = V[region_all]
        o_lo = Vr[:, :2].min(0) - 2.0; o_n = np.ceil((Vr[:, :2].max(0) + 2.0 - o_lo) / 0.5).astype(int) + 1
        zo = np.full(tuple(o_n), np.inf)
        ij = np.floor((Vo[:, :2] - o_lo) / 0.5).astype(int)
        okk = (ij[:, 0] >= 0) & (ij[:, 0] < o_n[0]) & (ij[:, 1] >= 0) & (ij[:, 1] < o_n[1]) & (Vo[:, 2] > Vr[:, 2].min() - 2.0)
        np.minimum.at(zo, (ij[okk, 0], ij[okk, 1]), Vo[okk, 2])
        from scipy.ndimage import minimum_filter
        zo = minimum_filter(zo, size=3, mode="nearest")
        def zo_at(Pq):
            ij = np.clip(np.floor((np.asarray(Pq)[:, :2] - o_lo) / 0.5).astype(int), 0, np.asarray(o_n) - 1)
            return zo[ij[:, 0], ij[:, 1]]
        gap = zo_at(Vr) - Vr[:, 2]
        info["gap_mm"] = dict(min=round(float(np.nanmin(np.where(np.isfinite(gap), gap, np.nan))), 2)) if np.isfinite(gap).any() else None
        lift = float(max_mm)              # the hull is built, then let down to what the bite allows (below)
    else:
        lift = float(flat_mm)
        info["warning"] = f"no opposing arch in the case: the block-out stands a flat {flat_mm:.1f} mm over the C/Ds - check the bite"
    info["lift_mm"] = round(lift, 2)
    def hull_top(h, Pq):
        """the hull's top over the points Pq (x, y): the lowest of its upward faces' planes"""
        Fn = np.asarray(h.face_normals); Fc = h.triangles_center
        up_f = Fn[:, 2] > 1e-6
        if not up_f.any():
            return np.full(len(Pq), -np.inf)
        n = Fn[up_f]; c0 = Fc[up_f]
        return (c0[None, :, 2] - ((Pq[:, None, 0] - c0[None, :, 0]) * n[None, :, 0] + (Pq[:, None, 1] - c0[None, :, 1]) * n[None, :, 1]) / n[None, :, 2]).min(axis=1)

    def build(reg, lift_, wdg=None):
        cm = reg
        if cm.sum() < 30:
            return None
        P = V[cm]; Nh = N[cm].copy(); Nh[:, 2] = 0.0
        nn = np.linalg.norm(Nh, axis=1); ok = nn > 0.2
        Nh[ok] /= nn[ok, None]; Nh[~ok] = 0.0
        # the push: the full clearance from each crown's top (a ridge's crest) down to full_mm below it, tapering to
        # nothing at the gum line (line_gap_mm above the trim line; without a line, the seeds' lowest 3 %)
        z_lo = (z_line(P) + line_gap_mm) if z_line is not None else np.full(len(P), float(np.percentile(P[:, 2], 3)))
        z_hi = np.zeros(len(P)); z_cerv = z_lo.copy()
        lab_c = labels[cm]
        gum_c = lab_c == 0
        if gum_c.any():
            z_hi[gum_c] = float(np.percentile(P[gum_c, 2], 98)) - full_mm    # the ridge: from its crest
        for t in np.unique(lab_c[~gum_c]):
            m_ = lab_c == t
            top_t = float(np.percentile(V[labels == t][:, 2], 98))
            z_hi[m_] = top_t - full_mm
            z_cerv[m_] = top_t - crown_mm - 0.5
        z_lo = np.minimum(z_lo, z_cerv)                               # (never above the crown's cervical)
        z_hi = np.maximum(z_hi, z_lo + 1.0)
        s_ = np.clip((P[:, 2] - z_lo) / (z_hi - z_lo), 0.0, 1.0)
        # (a seed at the line - a window's gum - is pulled 0.15 mm into the model and neither pushed nor lifted: the
        # block's foot lies on the surface at the line, no lip)
        P0 = P - (0.15 * (1.0 - s_))[:, None] * N[cm]
        pushed = P0 + (clearance_mm * s_)[:, None] * Nh               # the room on every side
        pushed[:, 2] = np.minimum(pushed[:, 2], P[:, 2] + lift_ * s_)
        lifted = P0 + np.column_stack([np.zeros(len(P)), np.zeros(len(P)), lift_ * s_])   # the room on top
        if kd_other is not None:                                     # never pushed into a neighbouring tooth
            pushed = pushed[kd_other.query(pushed)[0] > keep_mm]
        # the feather runs on past the cervical over the gum down to the trim line (line_gap_mm above it): the gum
        # within band_mm of the crowns, no lower than that, not another tooth's - pulled 0.15 mm into the model, so
        # the block's foot lies on the gum right at the line, as putty feathered onto the gum does. A window's seed
        # already holds its gum down to the line: the feather stays within the window, so the block ends at its ends
        band_mm = 2.0
        d_c = cKDTree(P).query(V, distance_upper_bound=band_mm + 0.5)[0]
        ring = (~tooth) & np.isfinite(d_c) & (d_c <= band_mm)
        if wdg is not None:
            ring &= wdg
        if z_line is not None:
            ring &= V[:, 2] >= z_line(V) + line_gap_mm
        else:
            ring &= V[:, 2] >= float(np.percentile(P[:, 2], 3)) - 1.5
        if kd_other is not None:
            ring &= kd_other.query(V)[0] > keep_mm + 0.5
        R = V[ring] - 0.15 * N[ring]
        pts = np.vstack([pushed, lifted, R]) if len(R) else np.vstack([pushed, lifted])
        try:
            return trimesh.convex.convex_hull(pts)
        except Exception:
            return None
    solids = []
    for side, reg in regions.items():
        wdg = np.asarray(wedge[side], bool) if wedge and side in wedge else None
        h = build(reg, lift, wdg)
        if h is None:
            continue
        if zo_at is not None:
            # the bite: over every seed vertex the block's top may take at most `share` of the room up to the opposing
            # tooth (less clear_mm) - so with both retainers in the C/Ds are never the only contact. The flat top is
            # let down by the worst excess, once; never under 0.3 mm over the cusps themselves
            cm = reg
            z_v = V[cm][:, 2]; zo_c = zo_at(V[cm])
            allow = z_v + share * np.clip(zo_c - z_v - clear_mm, 0.0, None)
            fin = np.isfinite(allow)
            if fin.any():
                excess = float(np.max(hull_top(h, V[cm][fin]) - allow[fin]))
                if excess > 0.02:
                    lift_s = max(0.3, lift - excess)              # never under 0.3 mm: the cusp tips stay covered
                    h2 = build(reg, lift_s, wdg)
                    if h2 is not None:
                        h = h2
                    info.setdefault("lift_by_side", {})[("R" if side > 0 else "L")] = round(lift_s, 2)
                    # with the top down on the cusps the opposing teeth may still dip into the block over the fossae
                    # (a deep bite): say by how much, for the doctor to judge on the occlusion
                    left = float(np.max(hull_top(h, V[cm][fin]) - allow[fin]))
                    if left > 0.3:
                        info.setdefault("bite_mm", {})[("R" if side > 0 else "L")] = round(left, 1)
        solids.append((reg, h))
    if not solids:
        return None, dict(info, error="no block could be made over the window" if span else "no block could be made over the chosen teeth")
    if info.get("lift_by_side"):
        info["lift_mm"] = round(min(info["lift_by_side"].values()), 2)
    if info.get("bite_mm"):
        worst = max(info["bite_mm"].values())
        info["warning"] = (f"the bite is tight over the C/Ds: with the block-out's top at the cusps the opposing teeth still take up to "
                           f"{worst:.1f} mm of its top over the fossae - judge it on the occlusion before cutting")
    # each block on its own voxel grid: inside the hull, or (under a crown) from the gum under its bulge up to the
    # hull's top in that column - the undercuts filled as putty does; never within keep_mm of a neighbouring tooth;
    # blurred a little and meshed. Inside a convex hull = on the inner side of every face plane
    parts = []
    for reg, h in solids:
        lo = h.bounds[0] - 1.0; hi = h.bounds[1] + 1.0
        cm = reg & tooth                                              # the crown columns: filled down to the gum under the bulge
        lo[2] = min(lo[2], float(V[reg][:, 2].min()) - 3.5)
        shape = np.ceil((hi - lo) / spacing).astype(int) + 1
        if np.prod(shape) > 12e6:
            info.setdefault("skipped", []).append("block-out region too large")
            continue
        gx, gy, gz = [lo[k] + spacing * np.arange(shape[k]) for k in range(3)]
        nx, ny, nz = shape
        G2 = np.stack(np.meshgrid(gx, gy, indexing="ij"), -1).reshape(-1, 2)
        # the hull's top and bottom over every cell: the planes' heights at (x, y) - a convex hull's top is the lowest
        # of its upward faces' planes, its bottom the highest of the downward faces' (restricted to each face's own
        # footprint by the plane test on the others; a point is inside when below every up face and above every down
        # face, which is what min / max give)
        Fn = np.asarray(h.face_normals); Fc = h.triangles_center
        up_f = Fn[:, 2] > 1e-6; dn_f = Fn[:, 2] < -1e-6
        def plane_z(mask):
            n = Fn[mask]; c0 = Fc[mask]
            # z on the plane at (x, y): z = c_z - (n_x (x - c_x) + n_y (y - c_y)) / n_z
            return c0[None, :, 2] - ((G2[:, None, 0] - c0[None, :, 0]) * n[None, :, 0] + (G2[:, None, 1] - c0[None, :, 1]) * n[None, :, 1]) / n[None, :, 2]
        top = plane_z(up_f).min(axis=1) if up_f.any() else np.full(len(G2), -np.inf)
        bot = plane_z(dn_f).max(axis=1) if dn_f.any() else np.full(len(G2), np.inf)
        # (a vertical face plays no part: the footprint is where top >= bot)
        has = top >= bot
        top = top.reshape(nx, ny); bot = bot.reshape(nx, ny); has = has.reshape(nx, ny)
        def field(Pp, how):
            f = np.full((nx, ny), -np.inf if how == "max" else np.inf, float)
            ij = np.floor((Pp[:, :2] - lo[:2]) / spacing).astype(int)
            okk = (ij[:, 0] >= 0) & (ij[:, 0] < nx) & (ij[:, 1] >= 0) & (ij[:, 1] < ny)
            (np.maximum if how == "max" else np.minimum).at(f, (ij[okk, 0], ij[okk, 1]), Pp[okk, 2])
            return f
        zc_min = field(V[cm], "min") if cm.any() else np.full((nx, ny), np.inf); zg_top = field(V[~crown], "max")
        under = np.isfinite(zc_min) & np.isfinite(zg_top) & (zg_top < zc_min)
        floor = np.where(under, zg_top, zc_min)
        floor = np.where(np.isfinite(zc_min), np.maximum(floor, zc_min - 3.0), np.inf)
        if z_line is not None:                                        # ... and never below the trim line
            floor = np.maximum(floor, z_line(np.column_stack([G2, np.zeros(len(G2))])).reshape(nx, ny) - 0.2)
        # under its footprint the block is filled down to the model's surface (a crown column: down to the gum under
        # the bulge) - no gap under its foot
        from scipy.ndimage import distance_transform_edt
        zs = field(V, "max")
        have_s = np.isfinite(zs)
        if have_s.any():
            _, (si, sj) = distance_transform_edt(~have_s, return_indices=True)
            zs = zs[si, sj]
        else:
            zs = np.full((nx, ny), np.inf)
        # (a gap of up to fill_gap under the hull's bottom is closed - the embrasures, the gum right under the foot; a
        # drop further than that is the vestibule under the block's tapered side, which stays open)
        fill_gap = 2.0
        base = np.where(np.isfinite(zc_min), floor, np.where(bot - zs <= fill_gap, zs, bot)) - 0.4
        bottom = np.where(has, np.minimum(bot, base), np.inf)
        ceiling = np.where(has, top, -np.inf)
        occ = ((gz[None, None, :] >= bottom[:, :, None]) & (gz[None, None, :] <= ceiling[:, :, None])).astype(np.float32)
        if kd_other is not None and occ.any():
            idx = np.where(occ.reshape(-1) > 0)[0]
            Gp = np.column_stack([G2[idx // nz], gz[idx % nz]])
            d_o = kd_other.query(Gp, distance_upper_bound=keep_mm + 0.01)[0]
            occ.reshape(-1)[idx[np.isfinite(d_o)]] = 0.0
        occ = gaussian_filter(occ, 0.5 / spacing)                       # (the hull's facets eased)
        if occ.max() < 0.5:
            continue
        verts, faces, _, _ = marching_cubes(occ, 0.5, spacing=(spacing, spacing, spacing))
        sol = trimesh.Trimesh(verts + lo, faces, process=True)
        sol.fix_normals()
        ps = [q for q in sol.split(only_watertight=False) if abs(q.volume) > 1.0]
        if ps:
            parts.append(max(ps, key=lambda q: abs(q.volume)))      # the block, not crumbs at its feet
    if not parts:
        return None, dict(info, error="nothing to block out")
    solid = trimesh.util.concatenate(parts)
    # how thick it stands over the crowns (the hull's top over each crown vertex)
    hits = []
    for reg, h in solids:
        cm = (reg & tooth) if (reg & tooth).any() else reg            # (a block over a bare ridge: over the ridge)
        hits.append(hull_top(h, V[cm]) - V[cm][:, 2])
    thick = np.concatenate(hits) if hits else np.array([lift])
    info.update(top_mm=dict(min=round(float(thick.min()), 2), median=round(float(np.median(thick)), 2), max=round(float(thick.max()), 2)),
                volume_ml=round(float(sum(abs(p.volume) for p in parts)) / 1000.0, 3), pieces=len(parts))
    if log:
        tm = info["top_mm"]
        what = (f"one block per side over the window ({len(under_t)} teeth under them)" if span else f"one block per side over {len(sel)} teeth")
        log(f"phase I block-out: {what}, {clearance_mm:.1f} mm of room round them, {tm['min']:.1f}-{tm['max']:.1f} mm over "
            f"the crowns (median {tm['median']:.1f}; " + (f"lift {info['lift_mm']:.1f} mm from the bite" if opposing_f is not None else f"a flat {flat_mm:.1f} mm, no bite")
            + f"), {info['volume_ml']:.2f} mL")
    return solid, info
