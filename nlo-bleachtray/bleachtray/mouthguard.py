"""Sports mouthguard: the model keeps the brackets (under a smooth block-out shield), the trim line
runs deep into the vestibule - as deep as the scan goes - with rounded notches at the frena, and a short
flange onto the palate. Everything here works in the final frame (x across the arch, +y anterior, z up =
occlusal; the vestibule is towards the floor)."""
import numpy as np
from .segment import geodesic_from_boundary, margin_contour, resample_polyline, smooth_polyline


def _arch_angle(xy, c):
    return np.arctan2(xy[:, 0] - c[0], xy[:, 1] - c[1])      # 0 = anterior (+y), as the pipeline's arch ring


def vestibular_trimline(mesh_f, A, labels, info, margin_f, edge_zone, ring_center, arch="upper",
                        inset=1.5, min_depth=3.0, max_depth=14.0, palate=6.0, distal=2.5, notch_top=2.5, notch_width=6.0,
                        labial_notch=True, buccal_notches=True, log=None):
    """The mouthguard's trim line. Starts from one closed loop round the teeth: `palate` mm onto the palate
    (lingual), `distal` mm behind the last tooth on each side, and on the facial side follows the surface
    down into the vestibule to `inset` mm above the scan's own edge (never less than `min_depth` or more
    than `max_depth` below the gum line). Frena are found as places where the sulcus is suddenly shallow -
    the fold is tethered - and the line rises there in a rounded notch to `notch_top` mm below the gum
    line, `notch_width` mm wide; the labial frenum at the midline always gets one. Returns (polyline (n,3)
    on the surface, info)."""
    from trimesh.proximity import ProximityQuery
    from .mesh_utils import smooth_field
    V = np.asarray(mesh_f.vertices); N = np.asarray(mesh_f.vertex_normals)
    c = np.asarray(ring_center)[:2]
    tooth = labels > 0
    res = dict(frena=[])
    nb_ = 180
    bins = np.linspace(-np.pi, np.pi, nb_ + 1)
    def bin_of(a):
        return np.clip(np.digitize(a, bins) - 1, 0, nb_ - 1)
    def fill(arr, ok):
        return np.interp(np.arange(nb_), np.where(ok)[0], arr[ok])
    # --- 1. facial / lingual: the gum line crosses every arch angle twice (facial at the larger radius);
    #        a point is facial when it is nearer the facial crossing than the lingual one
    ang_m = _arch_angle(margin_f[:, :2], c); r_m = np.linalg.norm(margin_f[:, :2] - c, axis=1); bm = bin_of(ang_m)
    r_fac = np.full(nb_, np.nan); r_lin = np.full(nb_, np.nan); z_gum = np.full(nb_, np.nan)
    for b in range(nb_):
        s = bm == b
        if s.sum() >= 2 and r_m[s].max() - r_m[s].min() > 3.0:
            r_fac[b], r_lin[b] = r_m[s].max(), r_m[s].min()
            z_gum[b] = margin_f[s][r_m[s] > 0.5 * (r_fac[b] + r_lin[b])][:, 2].mean()
    ok = np.isfinite(r_fac)
    if ok.sum() < 10:
        return margin_f, dict(error="no facial gum line")
    r_mid = fill(0.5 * (r_fac + r_lin), ok)
    # the gum line scallops (papillae high, zeniths low); depths are measured from its running mean
    k5 = np.array([0.15, 0.2, 0.3, 0.2, 0.15])
    z_gum_i = np.convolve(np.pad(fill(z_gum, ok), 2, mode="edge"), k5, mode="valid")
    r_med = float(np.nanmedian(r_fac))
    bin_mm = 2 * np.pi / nb_ * r_med                                   # mm of arch per bin
    def facial_of(xy):
        a = _arch_angle(xy, c); r = np.linalg.norm(xy - c, axis=1)
        b = bin_of(a)
        return r > r_mid[b], a, b
    # the distal end of the last tooth on each side (arch angle); beyond it the loop hugs the tooth
    a_end = {}
    for side in (-1, 1):
        teeth = {t: pos for t, (sd, pos) in info.items() if sd == side}
        if teeth:
            term = max(teeth, key=teeth.get)
            mt = labels == term
            if mt.sum() >= 20:
                at = _arch_angle(V[mt][:, :2], c)
                a_end[side] = float(np.percentile(at, 98) if side > 0 else np.percentile(at, 2))
    taper = 4.0 / r_med                                                 # 4 mm of arch, in radians
    def behind(a, side):
        """how far (radians) an arch angle is behind the last tooth on `side` (+), restricted to that side"""
        ae = a_end[side]
        d = (a - ae) if side > 0 else (ae - a)
        own = (np.sign(a) == side) | (np.abs(a) > np.pi / 2)
        return np.where(own, d, -np.inf)
    # --- 2. the base loop: the region "teeth + gum within L mm of them", L = palate lingually, distal
    #        behind the last teeth (tapering over 4 mm), kept 1 mm inside the scan edge so it closes
    ang_v = _arch_angle(V[:, :2], c)
    L = np.full(len(V), palate)
    for side in a_end:
        d = behind(ang_v, side)
        L = np.where(d > 0, distal, L)
        t = np.clip((d + taper) / taper, 0, 1)
        L = np.where((d <= 0) & (d > -taper), palate + (distal - palate) * t, L)
    dist = geodesic_from_boundary(mesh_f, A, ~tooth)         # distance of every gum vertex from the gum line
    dist = np.where(tooth, 0.0, dist)
    inside = ((dist < L) | tooth) & ~edge_zone
    field = smooth_field(A, inside.astype(float), 2)
    loops = margin_contour(mesh_f, field, 0.5)
    if not loops:
        return margin_f, dict(error="no offset loop")
    base = resample_polyline(loops[0], 0.5)
    # --- 3. the vestibule per angle: facial, below the gum line, facing outward (not the inside of the lip),
    #        not on the ragged scan edge; its floor is the deepest such vertex
    out_dir = (V[:, :2] - c) / np.maximum(np.linalg.norm(V[:, :2] - c, axis=1), 1e-6)[:, None]
    n_out = (N[:, :2] * out_dir).sum(1)
    fac_v, _, bv = facial_of(V[:, :2])
    vest = fac_v & ~tooth & (V[:, 2] < z_gum_i[bv] - 0.5) & (n_out > -0.1) & ~edge_zone
    z_edge = np.full(nb_, np.nan)
    for b in range(nb_):
        s = vest & (bv == b)
        if s.sum() >= 3:
            z_edge[b] = np.percentile(V[s, 2], 2)
    oke = np.isfinite(z_edge)
    if oke.sum() < 10:
        return margin_f, dict(error="no vestibule captured")
    # the line must clear the shallowest bit of edge near it: running max over +-2 bins, then a 7 mm smooth
    ze = fill(z_edge, oke)
    ze_max = np.max(np.stack([np.roll(ze, k) for k in range(-2, 3)]), axis=0)
    k9 = np.array([0.04, 0.08, 0.12, 0.16, 0.2, 0.16, 0.12, 0.08, 0.04])
    z_edge_s = np.convolve(np.pad(ze_max, 4, mode="edge"), k9, mode="valid")
    z_edge_3 = np.convolve(np.pad(fill(z_edge, oke), 1, mode="edge"), np.array([0.25, 0.5, 0.25]), mode="valid")
    raw_depth = np.clip(z_gum_i - z_edge_3, 0, max_depth + 5)      # how deep the scan goes below the gum line
    depth = np.clip(z_gum_i - (z_edge_s + inset), min_depth, max_depth)
    # --- 4. frena: the sulcus is shallow for a few mm where the lip or cheek is tethered (the labial one
    #        often sits in a broad shallow stretch, so it is judged against a wider neighbourhood)
    cand = []
    for b in range(nb_):
        if not oke[b]:
            continue
        a_deg = abs(np.degrees(0.5 * (bins[b] + bins[b + 1])))
        half = max(1, int(round((10.0 if a_deg < 12 else 6.0) / bin_mm)))
        lo, hi = max(0, b - half), min(nb_, b + half + 1)
        nb = np.r_[raw_depth[lo:b], raw_depth[b + 1:hi]]
        if len(nb) < 4:
            continue
        prom = np.percentile(nb, 75) - raw_depth[b]
        if raw_depth[b] <= raw_depth[lo:hi].min() + 1e-9 and prom >= 1.5:
            cand.append((b, prom))
    runs = []
    for b, prom in cand:
        if runs and b - runs[-1][-1][0] <= 2:
            runs[-1].append((b, prom))
        else:
            runs.append([(b, prom)])
    found = []
    for run in runs:
        b, prom = min(run, key=lambda x: raw_depth[x[0]])
        a_deg = float(np.degrees(0.5 * (bins[b] + bins[b + 1])))
        found.append(dict(bin=int(b), angle_deg=round(a_deg, 1), prom=prom, sulcus_mm=round(float(raw_depth[b]), 1)))
    mid_bin = int(bin_of(0.0))
    notches = []
    lab = [f for f in found if abs(f["angle_deg"]) < 12]
    if labial_notch:
        if lab:
            f = max(lab, key=lambda f: f["prom"]); notches.append(dict(bin=f["bin"], angle_deg=f["angle_deg"], kind="labial", sulcus_mm=f["sulcus_mm"], found=True))
        else:
            notches.append(dict(bin=mid_bin, angle_deg=0.0, kind="labial", sulcus_mm=round(float(raw_depth[mid_bin]), 1), found=False))
    if buccal_notches:
        # one per side, in the canine / premolar region, and only a clear one (2 mm shallower than around it)
        for side in (-1, 1):
            bu = [f for f in found if 20 <= side * f["angle_deg"] <= 85 and f["prom"] >= 2.0]
            if bu:
                f = max(bu, key=lambda f: f["prom"]); notches.append(dict(bin=f["bin"], angle_deg=f["angle_deg"], kind="buccal", sulcus_mm=f["sulcus_mm"], found=True))
    w_bins = max(2.0, 0.5 * notch_width / bin_mm)                     # half-width in bins
    for nt in notches:
        for b in range(nb_):
            d = abs(b - nt["bin"]); d = min(d, nb_ - d)
            if d <= w_bins:
                t = 0.5 * (1 + np.cos(np.pi * d / w_bins))            # 1 at the centre, 0 at the edge
                depth[b] = min(depth[b], notch_top + (depth[b] - notch_top) * (1 - t))
    res["frena"] = [{k: v for k, v in nt.items() if k != "prom"} for nt in notches]
    # --- 5. one point per angle bin on the vestibular wall at the target height (the vertex nearest the
    #        bin's own radial line among those at that height); bins without one are interpolated
    fac_b, ang_b, bb = facial_of(base[:, :2])
    fade = np.ones(len(base))
    for side in a_end:
        d = behind(ang_b, side)
        fade = np.where(d > 0, 0.0, fade)
        fade = np.where((d <= 0) & (d > -taper), np.minimum(fade, -d / taper), fade)
    deep_bins = np.unique(bb[fac_b & (fade > 0)])
    P = np.full((nb_, 3), np.nan)
    vest_idx = np.where(vest)[0]
    for b in deep_bins:
        s = vest_idx[bv[vest_idx] == b]
        if len(s) == 0:
            continue
        target = z_gum_i[b] - depth[b]
        dz = np.abs(V[s, 2] - target)
        close = s[dz <= dz.min() + 0.3]
        a_c = 0.5 * (bins[b] + bins[b + 1])
        P[b] = V[close[np.argmin(np.abs(ang_v[close] - a_c))]]
    okp = np.isfinite(P[:, 0])
    if okp.sum() < 5:
        return margin_f, dict(error="no vestibular wall")
    for j in range(3):
        P[:, j] = fill(P[:, j], okp)
    # smooth along the arch (3 bins), only where the deep points are used
    Ps = P.copy()
    Ps[1:-1] = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
    out = base.copy()
    moved = np.zeros(len(base), bool)
    for i in range(len(base)):
        if not fac_b[i] or fade[i] <= 0:
            continue
        target = Ps[bb[i]]
        if target[2] >= base[i, 2] - 0.3:
            continue                                           # the loop is already as deep as allowed
        out[i] = fade[i] * target + (1 - fade[i]) * base[i]
        moved[i] = True
    # --- 6. tidy: resample, smooth, back on the surface
    out = smooth_polyline(resample_polyline(out, 0.5), iters=4)
    pq = ProximityQuery(mesh_f)
    closest, dmax, _ = pq.on_surface(out)
    snap = dmax < 4.0
    out[snap] = closest[snap]
    out = smooth_polyline(out, iters=2)
    fb = np.zeros(nb_, bool); fb[deep_bins] = True
    res.update(points=int(len(out)), moved=int(moved.sum()),
               depth_mm=dict(min=round(float(depth[fb].min()), 1), max=round(float(depth[fb].max()), 1), median=round(float(np.median(depth[fb])), 1)),
               sulcus_captured_mm=round(float(np.nanmedian(raw_depth[fb & oke])), 1), distal_end_deg={int(k): round(float(np.degrees(v)), 1) for k, v in a_end.items()})
    if log:
        fr = ", ".join(f"{nt['kind']} at {nt['angle_deg']:+.0f} deg" + ("" if nt["found"] else " (assumed)") for nt in notches) or "none"
        dm = res["depth_mm"]
        log(f"mouthguard line: {dm['min']:.0f}-{dm['max']:.0f} mm into the vestibule (median {dm['median']:.0f}; the scan holds {res['sulcus_captured_mm']:.0f}), "
            f"{palate:.0f} mm onto the palate, {distal:.1f} mm behind the last teeth; frenum notches: {fr}")
    return out, res


def appliance_shields(mesh_f, appliance, A, ring_center, clearance=1.0, skirt=1.5, chunk_mm=6.0, log=None):
    """Smooth block-out over brackets, wire and tubes for thermoforming: the appliance is covered in
    overlapping convex caps, each the hull of a ~`chunk_mm` stretch of appliance pushed out `clearance`
    mm facially plus a skirt of surface `skirt` mm round it, so the sheet forms over a smooth band
    instead of locking into bracket undercuts. Returns a list of manifold caps and info."""
    import trimesh
    from .mesh_utils import connected_components
    V = np.asarray(mesh_f.vertices)
    n = len(V)
    appliance = np.asarray(appliance, bool)
    if not appliance.any():
        return [], dict(caps=0)
    c = np.asarray(ring_center)[:2]
    out_dir = (V[:, :2] - c) / np.maximum(np.linalg.norm(V[:, :2] - c, axis=1), 1e-6)[:, None]
    push = np.column_stack([out_dir, np.zeros(n)])
    labels = connected_components(appliance, A)
    caps = []
    vol = 0.0
    for comp in np.unique(labels[labels >= 0]):
        idx = np.where(labels == comp)[0]
        if len(idx) < 20:
            continue
        ang = _arch_angle(V[idx][:, :2], c)
        r_med = float(np.median(np.linalg.norm(V[idx][:, :2] - c, axis=1)))
        order = np.argsort(ang)
        idx, ang = idx[order], ang[order]
        span = float((ang[-1] - ang[0]) * r_med)
        step = chunk_mm / max(r_med, 1e-6)
        starts = np.arange(ang[0], ang[-1] + 1e-9, step * 0.5) if span > chunk_mm else np.array([ang[0]])
        for a0 in starts:
            sel = idx[(ang >= a0) & (ang <= a0 + step)] if span > chunk_mm else idx
            if len(sel) < 12:
                continue
            ring = np.zeros(n, bool); ring[sel] = True
            for _ in range(max(1, int(round(skirt / 0.3)))):
                ring |= (A @ ring.astype(float) > 0)
            skirt_v = ring & ~appliance
            pts = np.vstack([V[sel] + push[sel] * clearance, V[skirt_v] - push[skirt_v] * 0.15])
            try:
                hull = trimesh.convex.convex_hull(pts)
            except Exception:
                continue
            if hull.volume < 1.0:
                continue
            caps.append(hull); vol += float(hull.volume)
    info = dict(caps=len(caps), volume_ml=round(vol / 1000.0, 2), clearance_mm=clearance)
    # one solid: the caps overlap, so their union is a smooth band; a single boolean against the body
    # later instead of one per cap
    if len(caps) > 1:
        try:
            import manifold3d as m3
            from .solid import to_manifold, from_manifold
            mans = [m for m in (to_manifold(c) for c in caps) if m is not None]
            if mans:
                u = m3.Manifold.batch_boolean(mans, m3.OpType.Add)
                if u.status() == m3.Error.NoError:
                    merged = from_manifold(u, drop_zero_volume=False)
                    info["union_volume_ml"] = round(float(merged.volume) / 1000.0, 2)
                    caps = [merged]
        except Exception as ex:  # noqa
            if log:
                log(f"shield union skipped ({ex}); caps added one by one")
    if log:
        log(f"brackets shielded: {info['caps']} smooth caps over the appliance, {clearance:.1f} mm clearance ({info.get('union_volume_ml', vol / 1000.0):.2f} mL)")
    return caps, info
