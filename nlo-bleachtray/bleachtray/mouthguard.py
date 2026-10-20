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


def appliance_shields(mesh_f, appliance, A, ring_center, clearance=1.0, skirt=1.5, chunk_mm=6.0, merge=True, log=None):
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
    # later instead of one per cap (merge=False: the convex caps themselves, for the band's rounding)
    if len(caps) > 1 and merge:
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


def _union(solids, log=None):
    """One solid from overlapping ones (manifold batch union); the list as it was when that fails."""
    if len(solids) < 2:
        return solids, None
    try:
        import manifold3d as m3
        from .solid import to_manifold, from_manifold
        mans = [m for m in (to_manifold(s) for s in solids) if m is not None]
        if mans:
            u = m3.Manifold.batch_boolean(mans, m3.OpType.Add)
            if u.status() == m3.Error.NoError:
                merged = from_manifold(u, drop_zero_volume=False)
                return [merged], float(merged.volume)
    except Exception as ex:  # noqa
        if log:
            log(f"block-out union skipped ({ex}); pieces added one by one")
    return solids, None


def _occupancy(solids, origin, shape, spacing):
    """Voxels (centres at origin + i*spacing) inside any of the convex `solids`. Column by column: along a
    vertical line a convex solid is one z-interval - the planes facing up bound it from above, those facing
    down from below, a vertical plane either keeps the column or not - so each solid costs (columns x planes),
    not (voxels x planes) (that took 20 s a band at 0.2 mm)."""
    occ = np.zeros(shape, bool)
    shp = np.asarray(shape)
    for h in solids:
        if not h.is_convex:
            raise ValueError("a block-out piece to round off is not convex")
        lo = np.clip(np.floor((h.bounds[0] - origin) / spacing).astype(int), 0, shp)
        hi = np.clip(np.ceil((h.bounds[1] - origin) / spacing).astype(int) + 1, 0, shp)
        if (hi - lo).min() <= 0:
            continue
        nrm = np.asarray(h.face_normals); off = (np.asarray(h.triangles)[:, 0] * nrm).sum(1)
        _, keep = np.unique(np.round(np.column_stack([nrm, off]), 5), axis=0, return_index=True)
        nrm, off = nrm[keep], off[keep]
        I, J = np.meshgrid(np.arange(lo[0], hi[0]), np.arange(lo[1], hi[1]), indexing="ij")
        I, J = I.ravel(), J.ravel()
        x = origin[0] + I * spacing; y = origin[1] + J * spacing
        rhs = off[None, :] - x[:, None] * nrm[None, :, 0] - y[:, None] * nrm[None, :, 1]     # n_z * z <= rhs
        nz = nrm[:, 2]
        up, down, flat = nz > 1e-9, nz < -1e-9, np.abs(nz) <= 1e-9
        zmax = (rhs[:, up] / nz[up]).min(1) if up.any() else np.full(len(I), np.inf)
        zmin = (rhs[:, down] / nz[down]).max(1) if down.any() else np.full(len(I), -np.inf)
        ok = zmin <= zmax
        if flat.any():
            ok &= (rhs[:, flat] >= -1e-9).all(1)
        if not ok.any():
            continue
        I, J, zmin, zmax = I[ok], J[ok], zmin[ok], zmax[ok]
        k0 = np.clip(np.ceil((zmin - origin[2]) / spacing).astype(int), lo[2], hi[2])
        k1 = np.clip(np.floor((zmax - origin[2]) / spacing).astype(int) + 1, lo[2], hi[2])
        ks = np.arange(lo[2], hi[2])
        fill = (ks[None, :] >= k0[:, None]) & (ks[None, :] < k1[:, None])
        ci, kk = np.nonzero(fill)
        occ[I[ci], J[ci], ks[kk]] = True
    return occ


def smooth_solids(solids, sigma=1.25, spacing=0.2, keep_pts=None, pad=0.8, log=None):
    """One smooth surface round the union of convex `solids` (the band's windows): their union is filled into a
    `spacing` mm voxel grid, blurred with a Gaussian of `sigma` mm and taken at the half level (marching cubes) -
    flat stretches stay where they were, every edge and corner between the windows is rounded off over about
    2*sigma mm (the doctor, 10/19/2026: the band was very blocky). `keep_pts` (the appliance pushed out by the
    least room it must keep) stay inside: when blurring would round a corner in past one, the level is lowered
    until all are in. Returns (mesh, info) - mesh None when it cannot be made (the caller keeps the solids)."""
    import trimesh
    from scipy import ndimage
    from skimage import measure
    lo = np.min([s.bounds[0] for s in solids], axis=0) - (3 * sigma + 4 * spacing)
    hi = np.max([s.bounds[1] for s in solids], axis=0) + (3 * sigma + 4 * spacing)
    shape = tuple(int(x) for x in np.ceil((hi - lo) / spacing) + 1)
    occ = _occupancy(solids, lo, shape, spacing)
    if not occ.any():
        return None, dict(error="nothing to smooth")
    if keep_pts is not None and len(keep_pts) and pad > 0:
        # a ball of `pad` mm round every point that must stay inside: blurring thins whatever is thin (a stretch of
        # band over a tube and wire: a quarter of the appliance came out through it on one test arch); with the
        # balls the appliance is wrapped before it is rounded off
        seeds = np.zeros(shape, bool)
        q = np.clip(np.round((np.asarray(keep_pts) - lo) / spacing).astype(int), 0, np.array(shape) - 1)
        seeds[q[:, 0], q[:, 1], q[:, 2]] = True
        occ |= ndimage.distance_transform_edt(~seeds, sampling=spacing) <= pad
    F = ndimage.gaussian_filter(occ.astype(np.float32), sigma / spacing, mode="constant")
    level = 0.5
    info = dict(sigma_mm=sigma)
    if keep_pts is not None and len(keep_pts):
        q = (np.asarray(keep_pts) - lo) / spacing
        f = ndimage.map_coordinates(F, q.T, order=1, mode="constant")
        low = float(np.percentile(f, 0.5))
        if low < level:
            level = max(0.3, low - 0.02)
        info["level"] = round(level, 3); info["kept_inside"] = round(float((f >= level).mean()), 4)
    # where two stretches of the band just touch, the iso-surface can pinch to an edge shared by four faces (not
    # watertight - seen on one of four test arches at the half level); a hair lower level closes the pinch
    m = None
    for lv in (level, level - 0.03, level - 0.06, level + 0.03, level - 0.1):
        if lv <= 0.05:
            continue
        verts, faces, _, _ = measure.marching_cubes(F, level=lv, spacing=(spacing, spacing, spacing))
        cand = trimesh.Trimesh(verts + lo, faces, process=True)
        cand.update_faces(cand.nondegenerate_faces()); cand.remove_unreferenced_vertices()
        if cand.is_watertight:
            m = cand; info["level"] = round(lv, 3)
            break
    if m is None:
        return None, dict(info, error="not watertight")
    if m.volume < 0:
        m.invert()
    # far fewer, smoother triangles (marching cubes gives ~6 per voxel face of surface)
    try:
        import fast_simplification
        target = max(0.0, min(0.85, 1.0 - 20000.0 / max(len(m.faces), 1)))
        if target > 0:
            v2, f2 = fast_simplification.simplify(np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32), target_reduction=target)
            m2 = trimesh.Trimesh(v2, f2, process=True)
            if m2.is_watertight and abs(m2.volume - m.volume) < 0.02 * m.volume:
                m = m2
    except Exception:
        pass
    info.update(faces=int(len(m.faces)), watertight=bool(m.is_watertight), volume_ml=round(float(m.volume) / 1000.0, 2))
    if not m.is_watertight:
        return None, dict(info, error="not watertight")
    return m, info


def appliance_band(mesh_f, appliance, A, ring_center, clearance=1.0, skirt=1.0, window_mm=6.0, step_mm=2.0,
                   reach_mm=2.0, off_band_mm=6.0, smooth=1.25, uniform=True, uniform_pct=50.0, log=None):
    """One continuous block-out band over brackets, wire and tubes, from the last appliance on one side
    round to the last on the other - not a cap over each bracket with bare tooth between them (the doctor,
    10/19/2026: the mouthguard's block-out must be continuous). A spine runs through the bracket centres
    round the arch, as the wire does; along it, overlapping windows (`window_mm` long, every `step_mm`)
    each take the convex hull of: the appliance in the window pushed `clearance` mm out, the spine itself
    pushed out as far, and the tooth / gum surface within `reach_mm` of the spine plus a `skirt` round the
    appliance (pulled 0.15 mm in, so the band sits on the model). Over a bracket that is the cap it always
    was; between two brackets it is a smooth ridge at the wire's height bridging the embrasure; the hulls
    overlap, so their union is one band. Appliance more than `off_band_mm` from the spine (an expander's
    arms, a lingual wire) keeps caps of its own. Fewer than 3 pieces round the arch: caps, as before.
    `uniform` (the doctor, 10/19/2026: "it looks like giant bubbles that are connected together - thicken the thinner
    segments"): the brackets' reach round the spine - how far out, up and down each piece goes, the `uniform_pct`
    percentile over the pieces - is one cross-section swept along the whole spine, with the tooth / gum surface across
    its height, so the stretches over the wire are as thick and as tall as the caps over the brackets; a bracket bigger
    than that still gets its own room. Returns (list of solids, info)."""
    import trimesh
    from scipy.spatial import cKDTree
    from .mesh_utils import connected_components
    V = np.asarray(mesh_f.vertices)
    n = len(V)
    appliance = np.asarray(appliance, bool)
    if not appliance.any():
        return [], dict(caps=0)
    c = np.asarray(ring_center)[:2]
    def outward(P):
        d = P[:, :2] - c
        d = d / np.maximum(np.linalg.norm(d, axis=1), 1e-6)[:, None]
        return np.column_stack([d, np.zeros(len(P))])
    push = outward(V)
    labels = connected_components(appliance, A)
    pieces = [np.where(labels == k)[0] for k in np.unique(labels[labels >= 0])]
    pieces = [p for p in pieces if len(p) >= 20]
    def caps_only(why):
        caps, info = appliance_shields(mesh_f, appliance, A, ring_center, clearance=clearance, skirt=skirt, log=log)
        return caps, dict(info, band=False, why=why)
    # the spine runs on the cheek side, where the wire is: only pieces that mostly face out set it (an
    # expander's arms or a lingual wire face the palate / tongue - a spine through them would cut across the
    # teeth), and a piece that wraps round a tooth (a molar band) counts by its cheek-side part
    Nv = np.asarray(mesh_f.vertex_normals)
    facing = (Nv * push).sum(1)
    C = []
    for p in pieces:
        out_p = p[facing[p] > 0.3]
        if len(out_p) >= max(12, 0.35 * len(p)):
            C.append(V[out_p].mean(0))
    if len(C) < 3:
        return caps_only("fewer than 3 pieces of appliance on the cheek side")
    C = np.asarray(C)
    order = np.argsort(_arch_angle(C[:, :2], c))
    C = C[order]
    # the spine runs where the wire does: a centre well off the line through its neighbours is not on it
    good = np.ones(len(C), bool)
    for i in range(1, len(C) - 1):
        mid = 0.5 * (C[i - 1] + C[i + 1])
        if np.linalg.norm(C[i] - mid) > 4.0 and np.linalg.norm(C[i + 1] - C[i - 1]) < 22.0:
            good[i] = False
    S = C[good]
    if len(S) < 3:
        return caps_only("no line through the brackets")
    # Catmull-Rom through the centres, through the end ones too (mirrored phantom points)
    Pp = np.vstack([2 * S[0] - S[1], S, 2 * S[-1] - S[-2]])
    sp = []
    for i in range(1, len(Pp) - 2):
        p0, p1, p2, p3 = Pp[i - 1], Pp[i], Pp[i + 1], Pp[i + 2]
        seg = max(int(np.linalg.norm(p2 - p1) / 0.25), 2)
        for t in np.linspace(0.0, 1.0, seg, endpoint=False):
            t2, t3 = t * t, t * t * t
            sp.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    sp.append(S[-1])
    sp = np.asarray(sp)
    s_len = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(sp, axis=0), axis=1))])
    sp_push = outward(sp)
    tree = cKDTree(sp)
    d_all, j_all = tree.query(V)
    s_all = s_len[j_all]
    app_band = appliance & (d_all < off_band_mm)
    ring = app_band.copy()
    for _ in range(max(1, int(round(skirt / 0.3)))):
        ring |= (A @ ring.astype(float) > 0)
    surf = ~appliance & ((d_all < reach_mm) | (ring & (d_all < off_band_mm)))
    prof = None
    if uniform:
        # each piece's reach from its spine point: out along the push, up and down (z); a robust size per piece, then
        # the `uniform_pct` percentile over the pieces is the band's cross-section all the way round
        rel_all = V - sp[j_all]
        dn_all = (rel_all * sp_push[j_all]).sum(1); dz_all = rel_all[:, 2]
        outs, tops, bots = [], [], []
        for p in pieces:
            q = p[app_band[p] & (facing[p] > 0.0)]
            if len(q) < 12:
                continue
            outs.append(np.percentile(dn_all[q], 95)); tops.append(np.percentile(dz_all[q], 95)); bots.append(np.percentile(dz_all[q], 5))
        if len(outs) >= 3:
            prof = dict(out=float(np.percentile(outs, uniform_pct)) + clearance, top=float(np.percentile(tops, uniform_pct)) + clearance,
                        bottom=float(np.percentile(bots, 100.0 - uniform_pct)) - clearance)
            # the band sits on the teeth over its whole height: the cheek-side surface between its top and bottom (a
            # hair beyond, the skirt) - only what faces out and lies just inside the spine, never the far side of a tooth
            surf |= (~appliance & (facing > 0.3) & (d_all < off_band_mm + 2.0) & (dz_all >= prof["bottom"] - skirt)
                     & (dz_all <= prof["top"] + skirt) & (dn_all > -3.0) & (dn_all < prof["out"]))
    a_idx = np.where(app_band)[0]; f_idx = np.where(surf)[0]
    hulls = []
    half = 0.5 * window_mm
    for s0 in np.arange(0.0, float(s_len[-1]) + 1e-9, step_mm):
        lo, hi = s0 - half, s0 + half
        a_sel = a_idx[(s_all[a_idx] >= lo) & (s_all[a_idx] <= hi)]
        f_sel = f_idx[(s_all[f_idx] >= lo) & (s_all[f_idx] <= hi)]
        k_sel = (s_len >= lo) & (s_len <= hi)
        pts = [V[a_sel] + push[a_sel] * clearance, sp[k_sel] + sp_push[k_sel] * clearance, V[f_sel] - push[f_sel] * 0.15]
        if prof is not None and k_sel.any():
            # the cross-section at every spine point in the window: its outer face, top to bottom
            spk, nk = sp[k_sel], sp_push[k_sel]
            for dzv in (prof["bottom"], 0.5 * (prof["top"] + prof["bottom"]), prof["top"]):
                pts.append(spk + nk * prof["out"] + np.array([0.0, 0.0, dzv]))
        pts = np.vstack([p for p in pts if len(p)])
        if len(pts) < 12:
            continue
        try:
            hull = trimesh.convex.convex_hull(pts)
        except Exception:
            continue
        if hull.volume < 0.5:
            continue
        hulls.append(hull)
    if not hulls:
        return caps_only("no band could be built")
    vol = float(sum(h.volume for h in hulls))
    # appliance away from the wire line (an expander's arms, a lingual wire): caps of its own
    off = appliance & ~app_band
    extra = []
    if off.sum() >= 20:
        extra, _ = appliance_shields(mesh_f, off, A, ring_center, clearance=clearance, skirt=skirt, merge=False)
    sm = None
    if smooth and smooth > 0:
        # rounded off: the windows' flat faces and the edges between them read as blocks; the appliance keeps at
        # least 0.7 of its clearance everywhere (bracket corners are where blurring would round in)
        try:
            keep = V[appliance] + push[appliance] * (0.7 * clearance)
            # rounder is better, but never at the brackets' expense: a thin stretch (palatal caps, a lone tube) can
            # blur away - then a little less rounding, until 99 % of the appliance keeps its room
            for sg in (float(smooth), 0.8 * float(smooth), 0.6 * float(smooth)):
                sm, sinfo = smooth_solids(hulls + extra, sigma=sg, keep_pts=keep, log=log)
                if sm is not None and sinfo.get("kept_inside", 1.0) >= 0.99:
                    break
            if sm is not None and sinfo.get("kept_inside", 1.0) < 0.99:
                sm, sinfo = None, dict(sinfo, error=f"rounding would leave {100 * (1 - sinfo['kept_inside']):.0f} % of the appliance without its room")
        except Exception as ex:  # noqa
            sm, sinfo = None, dict(error=str(ex)[:120])
    if sm is not None:
        solids, uvol = [sm], float(sm.volume)
    else:
        solids, uvol = _union(hulls + extra, log=log)
    info = dict(caps=len(hulls) + len(extra), band=True, band_length_mm=round(float(s_len[-1]), 1), brackets_on_band=int(len(S)),
                separate_caps=len(extra), volume_ml=round((uvol if uvol is not None else vol) / 1000.0, 2), clearance_mm=clearance,
                uniform=({k: round(v, 2) for k, v in prof.items()} if prof else None),
                smooth=(sinfo if smooth and smooth > 0 else None))
    if uvol is not None:
        info["union_volume_ml"] = round(uvol / 1000.0, 2)
    if log:
        log(f"brackets and wire under one continuous band: {info['band_length_mm']:.0f} mm round the arch through {len(S)} brackets / tubes, "
            f"{clearance:.1f} mm clearance ({info['volume_ml']:.2f} mL)" + (f", one even cross-section {prof['out']:.1f} mm out, {prof['top'] - prof['bottom']:.1f} mm tall" if prof else "") + (f"; {len(extra)} cap{'s' if len(extra) != 1 else ''} over appliance away from the wire (palate / tongue side)" if extra else "")
            + (f"; rounded off over {2 * sinfo['sigma_mm']:.1f} mm" if sm is not None else (f"; not rounded off ({sinfo.get('error')})" if smooth and smooth > 0 else "")))
    return solids, info
