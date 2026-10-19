"""Interproximal fills the way aligner labs do them (uLab's "digital fill"): one wedge under every contact,
by construction - not found by hunting for undercuts on the surface, which gave fins on the line angles of
crowns.

For each pair of neighbouring teeth: the contact (their closest points near the top of the embrasure) sets a
local frame; level by level below it, the two crowns' outlines in that level are taken from the surface and
the fill is the belt between them - the convex hull of both outlines minus each crown's own hull - so the
fill is flush with the buccal and lingual surfaces of both teeth and can never be a sheet on one of them.
Each side (buccal / lingual) stops where the papilla closes the space. `top` leaves that much free under the
contact; `proud` moves the belt's faces out (+) or in (-). The belts are stacked into a voxel solid, smoothed,
and handed to the body union.
"""
import numpy as np
import trimesh
from scipy.spatial import cKDTree
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.ops import unary_union


def _neighbour_pairs(labels, info, cents, max_mm=14.0):
    """Adjacent teeth: consecutive positions on a side, the two centrals across the midline; a pair whose
    centroids are far apart (a missing tooth between) is left to the bridge logic."""
    by = {}
    for t, (side, pos) in info.items():
        by[(int(side), int(pos))] = int(t)
    pairs = []
    for (side, pos), t in by.items():
        nxt = by.get((side, pos + 1))
        if nxt is not None:
            pairs.append((t, nxt))
    if (-1, 1) in by and (1, 1) in by:
        pairs.append((by[(-1, 1)], by[(1, 1)]))
    out = []
    for a, b in pairs:
        if a in cents and b in cents and np.linalg.norm(np.asarray(cents[a])[:2] - np.asarray(cents[b])[:2]) <= max_mm:
            out.append((a, b))
    return out


def _hull(pts2):
    if len(pts2) < 3:
        return None
    h = MultiPoint(pts2).convex_hull
    return h if h.geom_type == "Polygon" and h.area > 1e-4 else None


def _voxel_solid(belts, level, cell, frame):
    """Stacked level polygons (z, polygon) in a local (s, u, z) frame -> a smoothed watertight mesh in world
    coordinates. `frame` = (t, n, c): s along t, u along n, origin c."""
    t, n, c = frame
    zs = np.array([zl for zl, _ in belts])
    s_lo, s_hi = min(p.bounds[0] for _, p in belts) - 0.4, max(p.bounds[2] for _, p in belts) + 0.4
    u_lo, u_hi = min(p.bounds[1] for _, p in belts) - 0.4, max(p.bounds[3] for _, p in belts) + 0.4
    ns, nu = int(np.ceil((s_hi - s_lo) / cell)) + 2, int(np.ceil((u_hi - u_lo) / cell)) + 2
    z_lo = zs.min() - 0.4; nz = int(np.ceil((zs.max() + 0.4 - z_lo) / cell)) + 2
    occ = np.zeros((ns, nu, nz), bool)
    sg = s_lo + np.arange(ns) * cell; ug = u_lo + np.arange(nu) * cell
    SS, UU = np.meshgrid(sg, ug, indexing="ij")
    from shapely import vectorized
    for zl, poly in belts:
        m = vectorized.contains(poly, SS.ravel(), UU.ravel()).reshape(ns, nu)
        k0 = int(round((zl - level / 2 - z_lo) / cell)); k1 = int(round((zl + level / 2 - z_lo) / cell))
        occ[:, :, max(0, k0):max(1, k1) + 1] |= m[:, :, None]
    import scipy.ndimage as ndi
    occ = ndi.binary_closing(occ, iterations=1)
    if occ.sum() < 20:
        return None
    from skimage import measure
    pad = np.pad(occ, 1, constant_values=False)
    verts, faces, _, _ = measure.marching_cubes(pad.astype(np.float32), level=0.5, spacing=(cell, cell, cell))
    verts = verts - cell + np.array([s_lo, u_lo, z_lo])
    R = np.array([[t[0], n[0], 0.0], [t[1], n[1], 0.0], [0.0, 0.0, 1.0]])
    m = trimesh.Trimesh(verts @ R.T + c, faces, process=True)
    m.fix_normals()
    m = trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=10)
    if not m.is_watertight:
        m.fill_holes()
    return m


def gap_fills(mesh, labels, info, gaps, centre_xy, retention=0.5, level=0.25, cell=0.2, log=print):
    """The fill against a tooth that faces an edentulous space: a straight vertical face, starting
    `retention` mm below the tooth's height of contour on that side (the top of the undercut stays, for
    grip) and running down to the ridge - the undercut between the face and the tooth is filled, flush with
    the crown's width. One per tooth flanking each gap. -> (list of meshes, [fill info])."""
    V = np.asarray(mesh.vertices, float)
    labels = np.asarray(labels)
    by = {(int(sd), int(ps)): int(t) for t, (sd, ps) in info.items()}
    cents = {int(t): V[labels == t].mean(0) for t in np.unique(labels) if t > 0 and (labels == t).sum() > 50}
    solids, made = [], []
    tree_all = cKDTree(V)
    for g in gaps or []:
        side, pos = int(g.get("side", 0)), int(g.get("after_position", 0))
        a = by.get((side, pos))
        behind = sorted(p for (sd, p) in by if sd == side and p > pos)
        b = by.get((side, behind[0])) if behind else None
        if a is None or b is None or a not in cents or b not in cents:
            continue
        for tooth, other in ((a, b), (b, a)):
            it = np.where(labels == tooth)[0]
            if len(it) < 50:
                continue
            ct = np.asarray(cents[tooth]); co = np.asarray(cents[other])
            t = (co[:2] - ct[:2]); t = t / max(np.linalg.norm(t), 1e-6)      # +s: towards the gap
            n = np.array([-t[1], t[0]])
            if np.dot(n, ct[:2] - np.asarray(centre_xy)[:2]) < 0:
                n = -n
            c = np.array([ct[0], ct[1], V[it, 2].max()])
            near = np.asarray(tree_all.query_ball_point(c, 16.0), dtype=int)
            rel = V[near] - c
            s = rel[:, :2] @ t; u = rel[:, :2] @ n; z = rel[:, 2]; lab = labels[near]
            # the crown's reach towards the gap, level by level: the height of contour is its maximum
            levels = np.arange(0.0, float(V[it, 2].min() - c[2] - 1.0), -level)
            sections = []
            for zl in levels:
                band = np.abs(z - zl) <= 0.6 * level + 0.05
                A = np.c_[s[band & (lab == tooth)], u[band & (lab == tooth)]]
                hA = _hull(A)
                if hA is None or hA.area < 1.5:
                    sections.append((zl, None, None)); continue
                sections.append((zl, hA, float(hA.bounds[2])))
            have = [(zl, hA, smax) for zl, hA, smax in sections if hA is not None]
            if len(have) < 4:
                continue
            k_hoc = int(np.argmax([smax for _, _, smax in have]))
            z_hoc, s_hoc = have[k_hoc][0], have[k_hoc][2]
            z_start = z_hoc - retention
            # the face: where the crown is at z_start (a little inside the height of contour); a crown that
            # widens all the way to the gum has its undercut in the ridge below - the face is then at its foot
            s_face = None
            for zl, hA, smax in have:
                if zl <= z_start + 1e-6:
                    s_face = smax; break
            if s_face is None:
                z_start, s_face = have[-1][0], have[-1][2]
            # below the face's start the gap-facing surface is the crown, then the ridge sloping away under it:
            # level by level, the surface is the furthest point towards the gap among tooth and gum within the
            # crown's width; the fill runs from a little inside that surface out to the face, and ends where the
            # ridge reaches the face
            u_lo, u_hi = have[k_hoc][1].bounds[1], have[k_hoc][1].bounds[3]
            belts = []
            for zl in levels:
                if zl > z_start + 1e-6:
                    continue
                band = np.abs(z - zl) <= 0.6 * level + 0.05
                # the proximal zone just inside the face: the surface there (crown, then ridge) and 2.5 mm of solid
                # behind it for the anchor; solid AT the face means the ridge has come up to it - the fill ends
                sel = band & (u >= u_lo) & (u <= u_hi) & (s <= s_face + 0.3) & (s >= s_face - 2.5)
                if sel.sum() < 3:
                    continue
                P = np.c_[s[sel], u[sel]]
                if (P[:, 0] >= s_face - 0.15).sum() >= 3:
                    break
                shadow = np.c_[np.full(len(P), s_face), P[:, 1]]
                poly = _hull(np.r_[P, shadow])
                if poly is None:
                    continue
                belts.append((zl, poly))
            if len(belts) < 2:
                continue
            m = _voxel_solid(belts, level, cell, (t, n, c))
            if m is None or abs(m.volume) > 400.0 or (belts[0][0] - belts[-1][0]) > 9.0:   # nothing this size is a gap fill
                continue
            solids.append(m)
            made.append(dict(tooth=int(tooth), gap_side=side, face_below_hoc_mm=retention, height_mm=round(float(belts[0][0] - belts[-1][0] + level), 2), volume_ml=round(float(abs(m.volume)) / 1000.0, 3)))
    if log and made:
        log(f"edentulous fill: {len(made)} tooth face{'s' if len(made) > 1 else ''} next to a gap filled straight down from {retention} mm below the height of contour")
    return solids, made


def contact_fills(mesh, labels, info, centre_xy, top=20.0, proud=0.0, reach=1.25, reach_lingual=None, max_gap=1.5, half_width=4.5, depth_n=7.0,
                  level=0.25, cell=0.2, min_belt=0.35, log=print):
    """-> (fill mesh or None, info). `mesh`: the arch in the output frame (floor at z=0, crowns up);
    `labels`: tooth id per vertex (0 = gum); `info`: {tooth: (side, position)}; `centre_xy`: a point inside
    the arch (the ring centre) - 'buccal' points away from it. `reach` (buccal) / `reach_lingual`: how far
    out of the embrasure the fill goes - the notch between the two crowns is filled where it is narrower
    than twice this (uLab's Buccal / Lingual sliders), with a flat face across its mouth; `top`: how tall
    the wedge is above the papilla (uLab's Top) - it tapers to nothing there."""
    if reach_lingual is None:
        reach_lingual = reach
    V = np.asarray(mesh.vertices, float)
    labels = np.asarray(labels)
    cents = {int(t): V[labels == t].mean(0) for t in np.unique(labels) if t > 0 and (labels == t).sum() > 50}
    pairs = _neighbour_pairs(labels, info, cents)
    tree_all = cKDTree(V)
    solids, spots, skipped = [], [], []
    vol = 0.0
    for a, b in pairs:
        ia, ib = np.where(labels == a)[0], np.where(labels == b)[0]
        if len(ia) < 50 or len(ib) < 50:
            continue
        # the contact: the closest pair of points in the upper half of the two crowns
        za, zb = np.percentile(V[ia, 2], 50), np.percentile(V[ib, 2], 50)
        ua, ub = ia[V[ia, 2] >= za], ib[V[ib, 2] >= zb]
        d, j = cKDTree(V[ub]).query(V[ua])
        k = int(np.argmin(d))
        if d[k] > max_gap:
            skipped.append(dict(pair=(a, b), why=f"open contact {d[k]:.1f} mm"))
            continue
        pa, pb = V[ua[k]], V[ub[j[k]]]
        c = 0.5 * (pa + pb)
        t = np.asarray(cents[b])[:2] - np.asarray(cents[a])[:2]
        t = t / max(np.linalg.norm(t), 1e-6)
        n = np.array([-t[1], t[0]])
        if np.dot(n, c[:2] - np.asarray(centre_xy)[:2]) < 0:    # n points buccally (away from the arch centre)
            n = -n
        # the slab round the contact: local coordinates s (along the arch), u (buccal +), z
        near = tree_all.query_ball_point(c, half_width + depth_n)
        near = np.asarray(near, dtype=int)
        rel = V[near] - c
        s = rel[:, :2] @ t; u = rel[:, :2] @ n; z = rel[:, 2]
        inslab = (np.abs(s) <= half_width) & (np.abs(u) <= depth_n) & (z <= 1.0)
        near, s, u, z = near[inslab], s[inslab], u[inslab], z[inslab]
        lab = labels[near]
        # levels from the contact down to the gum: at each, the notch between the two crown outlines on each
        # side; the papilla (gum on the notch's axis reaching the notch's mouth) marks the bottom of the fill
        z_bottom = float(max(min(V[ia, 2].min(), V[ib, 2].min()) - c[2] - 1.0, -12.0))
        levels = np.arange(0.0, z_bottom, -level)
        notch = {1: [], -1: []}          # per side: (z, part polygon, mouth u) from the top down
        papilla = {1: None, -1: None}    # per side: the level the gum closes the notch
        for zl in levels:
            band = np.abs(z - zl) <= 0.6 * level + 0.05
            A = np.c_[s[band & (lab == a)], u[band & (lab == a)]]
            B = np.c_[s[band & (lab == b)], u[band & (lab == b)]]
            hA, hB = _hull(A), _hull(B)
            if hA is None or hB is None or hA.area < 1.5 or hB.area < 1.5:   # no real crown section at this level
                continue
            hAB = _hull(np.r_[A, B])
            if hAB is None:
                continue
            both = hA.union(hB)
            G = np.c_[s[band & (lab == 0)], u[band & (lab == 0)]]
            for side_sign, r in ((1, reach), (-1, reach_lingual)):
                if r <= 0 or papilla[side_sign] is not None:
                    continue
                side_box = Polygon([(-half_width, 0), (half_width, 0), (half_width, side_sign * depth_n), (-half_width, side_sign * depth_n)])
                lens = hA.buffer(r).intersection(hB.buffer(r)).intersection(hAB).intersection(side_box)
                if lens.is_empty or lens.area < 1e-3:
                    continue
                part = lens.convex_hull.difference(both).intersection(side_box)
                if part.is_empty or part.area < 1e-3:
                    continue
                u_face = part.bounds[3] if side_sign > 0 else part.bounds[1]
                if len(G):
                    axis = G[np.abs(G[:, 0]) <= 0.7]
                    if len(axis):
                        u_gum = axis[:, 1].max() if side_sign > 0 else axis[:, 1].min()
                        if (u_face - u_gum if side_sign > 0 else u_gum - u_face) < 0.35:
                            papilla[side_sign] = zl
                            continue
                notch[side_sign].append((zl, part, hA, hB, hAB, side_box))
        # the fill on each side: a wedge standing on the papilla, `top` mm tall, full reach at its foot and
        # tapering to nothing at its top (so the sheet runs over it without a step); where no gum closes the
        # notch within the crowns, it stands on the lowest level found
        belts = []
        for side_sign, r in ((1, reach), (-1, reach_lingual)):
            rows = notch[side_sign]
            if not rows or r <= 0 or top <= 0:
                continue
            z_foot = papilla[side_sign] if papilla[side_sign] is not None else rows[-1][0]
            z_foot = z_foot + level           # the first level above the gum
            H = min(float(top), max(-z_foot, level))     # the triangle's height: to the contact, or `top` above the gum
            # the wedge is not laid over the surface: it reaches `r` into both crowns (and a step into the gum at
            # its foot), so the union with the body makes one solid - nothing thin sits on the outside
            by_z = {zl: (hA, hB, hAB, side_box) for zl, part, hA, hB, hAB, side_box in rows}
            for zl in sorted(by_z, reverse=True):
                hA, hB, hAB, side_box = by_z[zl]
                h = zl - z_foot
                if h < -2 * level - 1e-6 or h > H:
                    continue
                # a triangle: full reach at the gum, a point at the top; the fill is the hull of the region within
                # reach of both crowns - a flat face across the notch's mouth, and the crowns' own slices inside it,
                # so the fill goes INTO both teeth and its edges are inside them
                rr = max(0.12, r * (1.0 - max(h, 0.0) / H))
                lens = hA.buffer(rr).intersection(hB.buffer(rr)).intersection(hAB.buffer(max(proud, 0.0))).intersection(side_box)
                if lens.is_empty or lens.area < 1e-3:
                    continue
                wedge = lens.convex_hull
                if proud < 0:
                    wedge = wedge.buffer(proud, join_style=1).union(hA.union(hB).intersection(lens.convex_hull))
                wedge = wedge.intersection(side_box.union(hA).union(hB))
                if wedge.is_empty or wedge.area < 1e-3:
                    continue
                belts.append((zl, wedge))
        if not belts:
            skipped.append(dict(pair=(a, b), why="no room under the contact"))
            continue
        thick = max(2.0 * p.area / max(p.length, 1e-6) for _, p in belts)      # about the widest the wedge gets
        if thick < min_belt:
            skipped.append(dict(pair=(a, b), why=f"wedge only {thick:.2f} mm thick"))
            continue
        # voxelise the stacked belts in the local frame, close small gaps, marching cubes, smooth
        zs = np.array([zl for zl, _ in belts])
        s_lo, s_hi = min(p.bounds[0] for _, p in belts) - 0.4, max(p.bounds[2] for _, p in belts) + 0.4
        u_lo, u_hi = min(p.bounds[1] for _, p in belts) - 0.4, max(p.bounds[3] for _, p in belts) + 0.4
        ns, nu = int(np.ceil((s_hi - s_lo) / cell)) + 2, int(np.ceil((u_hi - u_lo) / cell)) + 2
        z_lo = zs.min() - 0.4; nz = int(np.ceil((zs.max() + 0.4 - z_lo) / cell)) + 2
        occ = np.zeros((ns, nu, nz), bool)
        sg = s_lo + np.arange(ns) * cell; ug = u_lo + np.arange(nu) * cell
        SS, UU = np.meshgrid(sg, ug, indexing="ij")
        from shapely import vectorized
        for zl, poly in belts:
            m = vectorized.contains(poly, SS.ravel(), UU.ravel()).reshape(ns, nu)
            k0 = int(round((zl - level / 2 - z_lo) / cell)); k1 = int(round((zl + level / 2 - z_lo) / cell))
            occ[:, :, max(0, k0):max(1, k1) + 1] |= m[:, :, None]
        import scipy.ndimage as ndi
        occ = ndi.binary_closing(occ, iterations=1)
        if occ.sum() < 20:
            skipped.append(dict(pair=(a, b), why="fill too small"))
            continue
        from skimage import measure
        pad = np.pad(occ, 1, constant_values=False)
        verts, faces, _, _ = measure.marching_cubes(pad.astype(np.float32), level=0.5, spacing=(cell, cell, cell))
        verts = verts - cell + np.array([s_lo, u_lo, z_lo])
        # local (s, u, z) -> world
        R = np.array([[t[0], n[0], 0.0], [t[1], n[1], 0.0], [0.0, 0.0, 1.0]])
        W = verts @ R.T + c
        m = trimesh.Trimesh(W, faces, process=True)
        m.fix_normals()
        m = trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=10)
        if not m.is_watertight:
            m.fill_holes()
        solids.append(m)
        vol += float(abs(m.volume))
        spots.append(dict(pair=(int(a), int(b)), contact=np.round(c, 2).tolist(), levels=len(belts), height_mm=round(float(zs.max() - zs.min() + level), 2),
                          thick_mm=round(float(thick), 2), gap_mm=round(float(d[k]), 2), foot_below_contact_mm=round(float(-zs.min()), 2),
                          papilla=dict(buccal=papilla[1], lingual=papilla[-1])))
    info_out = dict(spots=len(spots), volume_ml=round(vol / 1000.0, 3), contacts=len(pairs), skipped=skipped, fills=spots, top_mm=top, proud_mm=proud, method="contacts")
    if log:
        log(f"interproximal fill: {len(spots)} of {len(pairs)} contacts filled ({info_out['volume_ml']} mL)" + (f"; {len(skipped)} left: " + ", ".join(sorted(set(q['why'].split(' ')[0] + ' ' + q['why'].split(' ')[1] for q in skipped))) if skipped else ""))
    if not solids:
        return None, info_out
    return trimesh.util.concatenate(solids), info_out
