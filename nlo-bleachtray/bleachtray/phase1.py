"""Phase I retainer (mixed dentition, the doctor 10/20/2026; AISA SOP-LAB-008 / 008A / 009).

It holds the corrected teeth while the permanent canines and premolars come in: the four incisors and the E/6
segments are covered, the primary canines and first molars (C, D) are not.

* COTT - Cut-Out TruTain, the office default: the trim line curves out round the chunk holding C and D on each
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


def _tidy(loop, mesh_f, step=0.5):
    from trimesh.proximity import ProximityQuery
    out = smooth_polyline(resample_polyline(np.asarray(loop, float), step), iters=4)
    cp, dd, _ = ProximityQuery(mesh_f).on_surface(out)
    snap = dd < 4.0
    out[snap] = cp[snap]
    return smooth_polyline(out, iters=2)


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


def scoop_cutouts(V, labels, info, sel, c, arch, collar_mm=1.0, ramp_mm=1.0, collar_cap_mm=0.8, below_mm=0.0, wide_mm=4.0):
    """COTT on the Trimlign (the doctor, 10/20/2026): the bur cannot get into the V between the 2 and the C (or the D
    and the E) to cut over the contact, so the model is scooped there - each run of chosen teeth (C-D on a side) is
    cut down to the height of its contacts with the teeth that stay (the 2 and the E): flat at the mesial contact's
    height, sloping to the distal one's. Nothing below that height changes (the C stays where the retainer ends at the
    contact in the mouth). Within collar_mm of the 2 / E the chosen tooth keeps its own surface up to collar_cap_mm
    over the contact (easing down to the cut over ramp_mm): the sheet bridges the embrasure there as it does over
    the real C, so the retainer's edge at the contact never sits where the real tooth is - and the bur still gets in
    (a steep lower C kept whole there stood 2 mm proud). A side whose neighbours stand more than wide_mm away needs no
    scoop (the bur reaches between them). Returns (new vertices, info)."""
    from scipy.spatial import cKDTree
    V = np.asarray(V, float)
    labels = np.asarray(labels)
    Vn = V.copy()
    sel = sorted(int(t) for t in sel)
    selm = np.isin(labels, sel)
    tooth = labels > 0
    others = tooth & ~selm
    d_other = cKDTree(V[others]).query(V)[0] if others.any() else np.full(len(V), np.inf)
    tv = np.where(tooth)[0]
    near = labels[tv[cKDTree(V[tv]).query(V)[1]]]
    by = {(int(s), int(p)): int(t) for t, (s, p) in info.items()}
    ang = _arch_angle(V[:, :2], c)
    out = []
    for side in (-1, 1):
        pos = sorted(int(info[t][1]) for t in info if int(t) in sel and int(info[t][0]) == side)
        runs = []
        for p in pos:
            if runs and p == runs[-1][-1] + 1:
                runs[-1].append(p)
            else:
                runs.append([p])
        for run in runs:
            teeth = [by[(side, p)] for p in run]
            name = "-".join(f"{patient_side(side, arch)}{p}" for p in run)
            ends = []
            for end_p, nb_p in ((run[0], run[0] - 1), (run[-1], run[-1] + 1)):
                b = by.get((side, nb_p)) if nb_p >= 1 else None
                ct = _contact(V, labels, by[(side, end_p)], b) if b is not None else None
                if ct is not None and ct["gap_mm"] > wide_mm:
                    ct = dict(ct, kind="wide")          # the bur gets in between: no limit from this side
                ends.append(ct)
            use = [e for e in ends if e is not None and e["kind"] != "wide"]
            rec = dict(teeth=name, ends=[None if e is None else dict(kind=e["kind"], gap_mm=e["gap_mm"]) for e in ends])
            if not use:
                rec["scooped"] = False
                out.append(rec)
                continue
            R = np.isin(labels, teeth) | (~tooth & np.isin(near, teeth))
            idx = np.where(R)[0]
            if len(use) == 2:
                a0, a1 = (float(_arch_angle(e["xy"][None], c)[0]) for e in use)
                t = np.clip((ang[idx] - a0) / (a1 - a0), 0.0, 1.0) if abs(a1 - a0) > 1e-3 else np.zeros(len(idx))
                floor = use[0]["z"] + t * (use[1]["z"] - use[0]["z"])
            else:
                floor = np.full(len(idx), use[0]["z"])
            floor = floor - below_mm
            s = np.clip((d_other[idx] - collar_mm) / max(ramp_mm, 1e-6), 0.0, 1.0)
            w = s * s * (3.0 - 2.0 * s)                   # 0 at the 2 / E, 1 from collar + ramp on
            allow = floor + collar_cap_mm * (1.0 - w)      # next to the 2 / E: the tooth's own surface, at most cap over the contact
            drop = np.maximum(V[idx, 2] - allow, 0.0)
            Vn[idx, 2] -= drop
            moved = drop > 0.05
            rec.update(scooped=True, floor_from=[e["kind"] for e in use], vertices=int(moved.sum()),
                       max_mm=round(float(drop.max()), 1) if len(drop) else 0.0)
            out.append(rec)
    return Vn, out


def phase1_trimline(mesh_f, A, labels, info, margin_f, edge_zone, ring_center, arch="upper", method="cott",
                    picks=None, buccal_mm=1.25, plate_mm=5.0, apex_shift_mm=0.0, open_round_mm=6.0, cut_palatal_mm=3.0, cut_lingual_mm=1.5, min_bridge=3.0,
                    keep_mm=0.6, notch_round_mm=2.0, crown_mm=4.5, bridge_mm=4.5, flange_inset=1.5, flange_min=4.0, flange_max=10.0,
                    frenum_depth=3.0, frenum_width=6.0, smooth=False, scoop=True, collar_mm=1.0, scoop_ramp_mm=1.0, log=None):
    """The Phase I retainer's line. Returns (cut_line, body_line, info, mesh): `cut_line` is what the Trimlign cuts
    (with the C/D cutouts on COTT); `body_line` is the same outline without them - the model is built round it, so the
    sheet forms over the whole arch as on the first trim (and BOTT cuts along it); `mesh` is the scan the model is
    built from - on COTT with the C/Ds scooped down to their contacts (scoop_cutouts), else mesh_f itself. Both lines
    lie on it. info['error'] when it fails."""
    import shapely
    from shapely.geometry import Polygon, box
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter1d, minimum_filter1d
    V = np.asarray(mesh_f.vertices)
    labels = np.asarray(labels)
    tooth = labels > 0
    c = np.asarray(ring_center, float)[:2]
    res = dict(method=method, arch=arch)
    try:
        facial_of, bin_of, r_lin, ok = _sides(np.asarray(margin_f, float), c)
    except ValueError as ex:
        return margin_f, margin_f, dict(error=str(ex)), mesh_f
    fac_v = facial_of(V[:, :2])
    ang_v = _arch_angle(V[:, :2], c); bv = bin_of(ang_v)
    dist = geodesic_from_boundary(mesh_f, A, ~tooth)
    dist = np.where(tooth, 0.0, dist)
    edge = np.asarray(edge_zone, bool)
    # --- the cheek side and round the last molars: the retainer's band, buccal_mm onto the gum
    covered = tooth | (~tooth & (dist <= buccal_mm))
    # --- tongue side
    cent = {int(t): V[labels == t].mean(0) for t in info}
    by = {}
    for t, (side, pos) in info.items():
        by[(int(side), int(pos))] = int(t)
    lin_v = ~tooth & ~fac_v
    # --- the cutouts (COTT): the chosen teeth and the gum that is theirs (nearest tooth), all of it on the cheek
    #     side, cut_palatal_mm onto the palate / lingual gum - less a keep_mm margin next to the teeth that stay
    #     (the distal wall of the 2, the mesial of the E); the notch's inside corners rounded so the bur reaches
    picks = DEFAULT_PICKS if picks is None else picks
    sel = pick_teeth(info, picks, arch)
    res["teeth"] = [f"{patient_side(info[t][0], arch)}{info[t][1]}" for t in sel]
    # a chosen position with no tooth in it (the C already lost, the canine on its way in): the space it left is cut
    # out too - the gum between the tooth in front of it and the one behind (seen from above, inside the hull of those
    # two crowns, and nearer to them than to any other tooth; the 2's distal wall itself stays covered: keep_mm). Not a
    # wedge of angles from the arch centre: that ran to the middle of the palate and the window grew a spur (10/20/2026)
    space = np.zeros(len(V), bool)
    tv_all = np.where(tooth)[0]
    near_all = labels[tv_all[cKDTree(V[tv_all]).query(V)[1]]] if len(tv_all) else np.zeros(len(V), int)
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
    # the windows, seen from above (COTT): each side's chosen crowns (the top crown_mm of their labels - a label can run
    # onto the gum) and the crest of any space, cut_palatal_mm out - one smooth curve from the 2 to the E (the doctor:
    # smooth edges; the gum's own distance scalloped round every tooth and zig-zagged over the rugae)
    selm = np.isin(labels, sel)
    crown = np.zeros(len(V), bool)
    for t in sel:
        m_ = labels == t
        crown |= m_ & (V[:, 2] >= float(np.percentile(V[m_, 2], 98)) - crown_mm)
    windows = []
    if method == "cott":
        from shapely.geometry import MultiPoint
        for side in (-1, 1):
            pts = [V[crown & (labels == t)][:, :2] for t in sel if int(info[t][0]) == side]
            crest = space & (np.sign(V[:, 0] - c[0]) == side) & ~fac_v & (dist <= 2.0)
            if crest.any():
                pts.append(V[crest][:, :2])
            pts = [p for p in pts if len(p)]
            if pts:
                windows.append(MultiPoint(np.vstack(pts)).convex_hull.buffer(cut_palatal_mm, join_style=1))
    if arch == "upper":
        # the palate inside the palatal gum line, seen from above (the line's lingual points in arch order, closed
        # straight across behind the last teeth), less a U-shaped opening: farther than plate_mm from that line
        # and behind the D/E contacts, its corners rounded
        lin_pts = np.asarray(margin_f, float)[~facial_of(np.asarray(margin_f, float)[:, :2])]
        order = np.argsort(_arch_angle(lin_pts[:, :2], c))
        P_lin = Polygon(lin_pts[order, :2])
        if not P_lin.is_valid:
            P_lin = P_lin.buffer(0)
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
        # the arms along the E/6 segments are plate_mm wide - never more than a fifth of the palate's width at the
        # apex (the office's own leave well over half of a child's 30 mm palate open, p2), never under 4 mm
        x0, y0, x1, y1 = P_lin.bounds
        at_apex = P_lin.intersection(box(x0 - 50, y_apex - 0.5, x1 + 50, y_apex + 0.5))
        width = float(at_apex.bounds[2] - at_apex.bounds[0]) if not at_apex.is_empty else float(x1 - x0)
        plate_eff = float(np.clip(min(plate_mm, 0.2 * width), 4.0, max(plate_mm, 4.0)))
        inner = P_lin.buffer(-plate_eff)
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
        covered |= lin_v & (in_lin | (dist <= cut_palatal_mm + 1.0) | in_w_all) & ~in_open
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
        covered |= lin_v & (dist <= depth[bv])
        flange_v = np.minimum(depth, avail - flange_inset)[bv]       # what the scan really holds (depth is held to flange_min)
        res["flange_mm"] = dict(min=round(float(depth.min()), 1), median=round(float(np.median(depth)), 1), max=round(float(depth.max()), 1))
    covered &= ~edge | tooth
    # no slivers: the plate / flange (beyond the cheek band) loses anything under 2 mm wide - a thin strip left
    # between the opening and the scan's edge made a small loop in the line
    far = covered & ~tooth & (dist > buccal_mm + 0.25)
    if far.any():
        opened = geodesic_dilate(mesh_f, A, ~geodesic_dilate(mesh_f, A, ~far, 1.0), 1.0) & far
        covered = (covered & ~far) | opened
    body = covered.copy()
    cut = body.copy()
    if method == "cott" and (sel or space.any()):
        others = tooth & ~selm
        near = near_all                                      # every vertex's nearest tooth
        gumlike = ~tooth | (selm & ~crown)
        mine = np.isin(near, sel) | space                    # gum that belongs to the window (nearest a chosen tooth, or the space)
        if arch == "upper":
            in_w = np.zeros(len(V), bool)
            for Wp in windows:
                in_w |= shapely.contains_xy(Wp, V[:, 0], V[:, 1])
            gum_sel = gumlike & mine & (fac_v | in_w)
        else:
            # on the tongue side the cut stops short enough to leave a bridge of flange under it (min_bridge mm): on a
            # lower the flange below the C/Ds is all that joins the incisors to the back teeth
            reach = np.minimum(np.full(len(V), float(cut_lingual_mm)), flange_v - min_bridge)
            # (reach from the label's edge as found, but never more than reach + 2 mm from the crown itself: a label
            # that ran onto the gum does not carry the window with it)
            d_crown = cKDTree(V[crown]).query(V)[0] if crown.any() else np.zeros(len(V))
            gum_sel = gumlike & mine & (fac_v | ((dist <= reach) & (d_crown <= reach + 2.0)))
        if arch != "upper":
            thin = float(np.percentile(flange_v[np.isin(near, sel) & lin_v], 10)) if (np.isin(near, sel) & lin_v).any() else 0.0
            if thin < min_bridge + 0.5:
                held = f"only {thin:.1f} mm of" if thin > 0.05 else "no"
                res.setdefault("warnings", []).append(
                    f"the scan holds {held} tongue-side gum under the C/Ds - too little flange to join the incisors to "
                    "the back teeth round the cutouts; scan deeper on the tongue side or use block-out (BOTT)")
        chunk = (crown | gum_sel)
        if others.any():
            d_other = cKDTree(V[others]).query(V)[0]
            chunk &= d_other > keep_mm
        cut = body & ~chunk
        cut = _close(mesh_f, A, cut, notch_round_mm) & body
        # ... and no slivers of plate / flange left beside a window (the window's edge meets the 2's gum band at a
        # shallow angle: a wedge of plate narrowing to nothing made a hairpin in the line, 10/20/2026): beyond the
        # cheek band, anything under 2 mm wide goes
        far = cut & ~tooth & (dist > buccal_mm + 0.25)
        if far.any():
            cut = (cut & ~far) | (geodesic_dilate(mesh_f, A, ~geodesic_dilate(mesh_f, A, ~far, 1.0), 1.0) & far)
        res["cutout"] = dict(teeth=res["teeth"], palatal_mm=cut_palatal_mm, keep_mm=keep_mm)
    elif method == "cott":
        res.setdefault("warnings", []).append("no teeth chosen for the cutouts - the line is the first trim, without windows")

    # the model: on COTT the C/Ds scooped down to their contacts so the bur reaches the line (scoop_cutouts); both
    # lines are traced on that surface (the regions above were found on the scan as it is)
    mesh_out = mesh_f
    if method == "cott" and sel and scoop:
        import trimesh
        try:
            Vs, srep = scoop_cutouts(V, labels, info, sel, c, arch, collar_mm=collar_mm, ramp_mm=scoop_ramp_mm)
            res["scoop"] = srep
            if any(r.get("scooped") for r in srep):
                mesh_out = trimesh.Trimesh(Vs, np.asarray(mesh_f.faces), process=False)
        except Exception as ex:  # noqa
            res.setdefault("warnings", []).append(f"the C/Ds could not be scooped ({str(ex)[:80]}) - the Trimlign may not reach the cutouts: check them")
    lines = {}
    for nm, region in (("body", body), ("cut", cut)):
        loops = _loop(mesh_out, A, region)
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
            res.setdefault("warnings", []).append(f"the outline came out in {len(loops)} pieces - check the scan")
        lines[nm] = _tidy(loops[0], mesh_out)
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
    if log:
        what = (f"cutouts round {', '.join(res['teeth'])}" if method == "cott" and sel else "block-out" if method == "bott" else "no cutouts")
        tongue = (f"palate plate {res['plate']['plate_mm']} mm, open behind y={res['plate']['u_apex_y']}" if arch == "upper"
                  else f"lingual flange {res['flange_mm']['min']}-{res['flange_mm']['max']} mm")
        log(f"phase I retainer ({method.upper()}): {what}; {tongue}")
        for r in res.get("scoop") or []:
            if r.get("scooped"):
                log(f"phase I: {r['teeth']} scooped down to their contacts ({' / '.join(r['floor_from'])}) - up to {r['max_mm']} mm off, {r['vertices']} vertices")
            else:
                log(f"phase I: {r['teeth']} not scooped (the bur reaches between the neighbours)")
    return lines["cut"], lines["body"], res, mesh_out


def block_outs(mesh_f, labels, sel, opposing_f=None, side_mm=1.0, max_mm=2.0, clear_mm=0.2, share=0.5, feather_mm=1.0,
               spacing=0.2, crown_mm=4.5, log=None):
    """BOTT: the block-outs built into the model - a smooth cap over each chosen tooth (`sel`, tooth labels) in place of
    the putty. On its cheek and tongue sides it stands `side_mm` off the tooth; on top it is as thick as the bite
    allows - share x (the gap to the opposing teeth less clear_mm), at most max_mm, never below 0 - so with the
    retainers in, the C/Ds are never the only contact (the doctor, 10/20/2026: "as large as possible without really
    being the only point of contact"; share 0.5 = both arches get block-outs over the same gap). It runs `feather_mm`
    down onto the gum and never onto a neighbouring tooth. Without the opposing arch (`opposing_f` in this model's
    frame) the top gets half of side_mm and a warning. Returns (solid or None, info)."""
    import trimesh
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter
    from skimage.measure import marching_cubes
    V = np.asarray(mesh_f.vertices); N = np.asarray(mesh_f.vertex_normals)
    labels = np.asarray(labels)
    sel = [int(t) for t in sel]
    info = dict(teeth=len(sel), side_mm=side_mm)
    if not sel:
        return None, dict(info, error="no teeth chosen")
    selm = np.isin(labels, sel)
    tooth = labels > 0
    # the crown is what stands within crown_mm of the tooth's top: a label that ran down the gum (a lower C's, 10/20/2026)
    # would have carried the cap down the cheek side with it
    crown = np.zeros(len(V), bool)
    for t in sel:
        m_ = labels == t
        if m_.any():
            crown |= m_ & (V[:, 2] >= float(np.percentile(V[m_, 2], 98)) - crown_mm)
    selm = crown
    # the surface the cap stands on: the chosen crowns and the gum within feather_mm of them (the cap thins to 0 there)
    kd_sel = cKDTree(V[selm])
    d_sel = kd_sel.query(V, distance_upper_bound=feather_mm + 0.5)[0]
    base = selm | (~crown & ~(tooth & ~np.isin(labels, sel)) & (d_sel <= feather_mm))
    bidx = np.where(base)[0]
    # wanted: side_mm on the cheek / tongue sides, up to max_mm on top (blended by how much the surface faces up),
    # thinning to 0 over the feather on the gum; then never more than the bite leaves: share x (gap - clear_mm)
    up = N[bidx, 2]
    w = np.clip((up - 0.3) / 0.5, 0, 1)
    h = np.where(selm[bidx], side_mm + w * (max_mm - side_mm), side_mm * np.clip(1.0 - d_sel[bidx] / feather_mm, 0, 1))
    top = selm[bidx] & (w > 0.5)
    if opposing_f is not None:
        gap = cKDTree(np.asarray(opposing_f.vertices)).query(V[bidx], distance_upper_bound=20.0)[0]
        gap = np.where(np.isfinite(gap), gap, 20.0)
        h = np.minimum(h, np.clip(share * (gap - clear_mm), 0.0, None))
        if top.any():
            info.update(top_mm=dict(min=round(float(h[top].min()), 2), median=round(float(np.median(h[top])), 2), max=round(float(h[top].max()), 2)),
                        gap_mm=dict(min=round(float(gap[top].min()), 2), median=round(float(np.median(gap[top])), 2)))
    else:
        h = np.where(top, np.minimum(h, 0.5 * side_mm), h)
        info["warning"] = "no opposing arch in the case: the block-out's top is a flat 0.5 mm - check the bite"
    # the cap as a solid: every point outside the surface within h of its nearest base point, plus a 0.3 mm skin
    # inside (so it fuses with the model), blurred and meshed; nothing nearer another tooth than a chosen one
    lo = V[bidx].min(0) - max_mm - 1.0; hi = V[bidx].max(0) + max_mm + 1.0
    shape = np.ceil((hi - lo) / spacing).astype(int) + 1
    if np.prod(shape) > 40e6:
        return None, dict(info, error="block-out region too large")
    gx, gy, gz = [lo[i] + spacing * np.arange(shape[i]) for i in range(3)]
    G = np.stack(np.meshgrid(gx, gy, gz, indexing="ij"), -1).reshape(-1, 3)
    kd = cKDTree(V[bidx])
    dd, jj = kd.query(G, distance_upper_bound=max(max_mm, side_mm) + 0.6)
    ok = np.isfinite(dd)
    occ = np.zeros(len(G), np.float32)
    gi = np.where(ok)[0]
    j = jj[gi]
    s = ((G[gi] - V[bidx][j]) * N[bidx][j]).sum(1)
    inside_skin = (s <= 0) & (dd[gi] <= 0.6)
    outside = (s > 0) & (dd[gi] <= h[j])
    keep = inside_skin | outside
    others = tooth & ~np.isin(labels, sel)
    if others.any():
        d_o = cKDTree(V[others]).query(G[gi], distance_upper_bound=3.0)[0]
        keep &= ~(d_o < np.minimum(dd[gi], 0.6) + 0.3)
    occ[gi[keep]] = 1.0
    occ = gaussian_filter(occ.reshape(shape), 0.4 / spacing)
    if occ.max() < 0.5:
        return None, dict(info, error="nothing to block out")
    verts, faces, _, _ = marching_cubes(occ, 0.5, spacing=(spacing, spacing, spacing))
    solid = trimesh.Trimesh(verts + lo, faces, process=True)
    solid.fix_normals()
    parts = [p for p in solid.split(only_watertight=False) if abs(p.volume) > 1.0]
    if not parts:
        return None, dict(info, error="nothing to block out")
    solid = trimesh.util.concatenate(parts)
    info.update(volume_ml=round(float(sum(abs(p.volume) for p in parts)) / 1000.0, 3), pieces=len(parts))
    if log:
        tm = info.get("top_mm")
        log(f"phase I block-out over {len(sel)} teeth: {side_mm:.1f} mm on the sides, "
            + (f"{tm['min']:.1f}-{tm['max']:.1f} mm on top from the bite (median {tm['median']:.1f})" if tm else "0.5 mm on top (no bite)")
            + f", {info['volume_ml']:.2f} mL")
    return solid, info
