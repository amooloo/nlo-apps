"""Tooth segmentation on an oriented scan: tooth mask, per-tooth labels, gingival-margin contour."""
import os
import numpy as np
import scipy.sparse as sp
import scipy.sparse.csgraph as csg
import joblib
from .mesh_utils import smooth_field, connected_components
from .features import compute_features

ASSET_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")


def load_models(path=None):
    return joblib.load(path or os.path.join(ASSET_DIR, "models.joblib"))


def predict_tooth_prob(mesh, models=None, feats=None):
    models = models or load_models()
    if feats is None:
        X, names, aux = compute_features(mesh, return_aux=True)
    else:
        X, names, aux = feats
    p_tooth = models["models"]["tooth"].predict_proba(X)[:, 1]
    p_ip = models["models"]["interprox"].predict_proba(X)[:, 1]
    return p_tooth, p_ip, aux


def clean_mask(mask, A, min_verts=400, fill_holes_max=1500):
    """Remove small tooth islands; fill small gingiva holes enclosed in teeth."""
    mask = mask.copy()
    lab = connected_components(mask, A)
    counts = np.bincount(lab[lab >= 0]) if (lab >= 0).any() else np.array([])
    for i, c in enumerate(counts):
        if c < min_verts:
            mask[lab == i] = False
    lab = connected_components(~mask, A)
    counts = np.bincount(lab[lab >= 0]) if (lab >= 0).any() else np.array([])
    for i, c in enumerate(counts):
        if c < fill_holes_max:
            mask[lab == i] = True
    return mask


def _edge_lengths_graph(mesh, A, mask):
    """Sparse graph with Euclidean edge lengths restricted to mask vertices."""
    e = mesh.edges_unique
    keep = mask[e[:, 0]] & mask[e[:, 1]]
    e = e[keep]
    w = np.linalg.norm(mesh.vertices[e[:, 0]] - mesh.vertices[e[:, 1]], axis=1)
    n = len(mask)
    G = sp.coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    return G


def geodesic_from_boundary(mesh, A, mask):
    """Graph-geodesic distance (mm) of every mask vertex from the mask boundary."""
    e = A.tocoo()
    boundary = np.zeros(len(mask), bool)
    cross = mask[e.row] & ~mask[e.col]
    boundary[e.row[cross]] = True
    G = _edge_lengths_graph(mesh, A, mask)
    src = np.where(boundary)[0]
    if len(src) == 0:
        return np.full(len(mask), np.inf)
    d = csg.dijkstra(G, directed=False, indices=src, min_only=True)
    d[~mask] = 0.0
    return d


def geodesic_dilate(mesh, A, mask, r):
    """Vertices within geodesic distance r of `mask` (measured across the complement)."""
    comp = ~mask
    e = A.tocoo()
    seed = np.zeros(len(mask), bool)
    cross = comp[e.row] & mask[e.col]
    seed[e.row[cross]] = True       # complement vertices adjacent to the mask
    G = _edge_lengths_graph(mesh, A, comp)
    src = np.where(seed)[0]
    if len(src) == 0:
        return mask.copy()
    d = csg.dijkstra(G, directed=False, indices=src, min_only=True)
    # seeds are one edge away from the mask; approximate that edge by the local mean edge length
    out = mask | (comp & (d <= r))
    return out


def morph_close(mesh, A, mask, r=1.5):
    """Morphological closing on the surface: bridges narrow notches (interproximal embrasures)
    narrower than ~2r while leaving the gum line elsewhere in place."""
    dil = geodesic_dilate(mesh, A, mask, r)
    dist_in = geodesic_from_boundary(mesh, A, dil)
    closed = dil & (dist_in > r)
    # never lose original tooth vertices
    return closed | mask


def split_teeth(mesh, tooth_mask, p_ip, A, aux, min_core=120, erode_mm=2.5, concave_cut=-0.6):
    """Assign a tooth id (1..N) to each tooth vertex.

    Cores = tooth vertices farther than `erode_mm` (geodesic) from the gum line and not strongly
    concave at the 1 mm scale (interproximal embrasures). Adjacent teeth only touch across a
    narrow contact bridge, so the erosion separates them. Every tooth vertex is then assigned to
    the nearest core by graph distance. Returns labels (0 = gingiva)."""
    H_s = smooth_field(A, aux["Hs"], 3)
    dist = geodesic_from_boundary(mesh, A, tooth_mask)
    core = tooth_mask & (dist > erode_mm) & (H_s > concave_cut) & (p_ip < 0.6)
    lab = connected_components(core, A)
    counts = np.bincount(lab[lab >= 0]) if (lab >= 0).any() else np.array([])
    keep_ids = [i for i, c in enumerate(counts) if c >= min_core]
    # merge cores that are tiny fragments of one tooth: handled later by size/adjacency
    seeds = np.full(len(tooth_mask), -1)
    for k, i in enumerate(keep_ids):
        seeds[lab == i] = k
    n_seed = len(keep_ids)
    if n_seed == 0:
        return (tooth_mask.astype(int)), aux
    G = _edge_lengths_graph(mesh, A, tooth_mask)
    # multi-source dijkstra: add a virtual source per seed set
    n = len(tooth_mask)
    rows, cols, vals = [], [], []
    for k in range(n_seed):
        idx = np.where(seeds == k)[0]
        rows.extend([n + k] * len(idx)); cols.extend(idx.tolist()); vals.extend([1e-6] * len(idx))
    S = sp.coo_matrix((vals, (rows, cols)), shape=(n + n_seed, n + n_seed))
    Gbig = sp.vstack([sp.hstack([G, sp.csr_matrix((n, n_seed))]), sp.csr_matrix((n_seed, n + n_seed))]).tocsr()
    Gbig = Gbig + S.tocsr() + S.T.tocsr()
    dist, pred, sources = csg.dijkstra(Gbig, directed=False, indices=np.arange(n, n + n_seed), return_predecessors=True, min_only=True)
    owner = sources[:n] - n
    labels = np.zeros(n, dtype=int)
    labels[tooth_mask] = owner[tooth_mask] + 1
    labels[(labels < 1) & tooth_mask] = 0
    return labels, aux


def _assign_by_cores(mesh, A, region, core_labels):
    """Assign every vertex in `region` to the nearest core (core_labels>=0) by graph distance."""
    n = len(region)
    seed_ids = np.unique(core_labels[core_labels >= 0])
    if len(seed_ids) == 0:
        return np.full(n, -1)
    G = _edge_lengths_graph(mesh, A, region)
    rows, cols, vals = [], [], []
    for k, sid in enumerate(seed_ids):
        idx = np.where(core_labels == sid)[0]
        rows.extend([n + k] * len(idx)); cols.extend(idx.tolist()); vals.extend([1e-6] * len(idx))
    S = sp.coo_matrix((vals, (rows, cols)), shape=(n + len(seed_ids), n + len(seed_ids)))
    Gbig = sp.vstack([sp.hstack([G, sp.csr_matrix((n, len(seed_ids)))]), sp.csr_matrix((len(seed_ids), n + len(seed_ids)))]).tocsr()
    Gbig = Gbig + S.tocsr() + S.T.tocsr()
    _, _, sources = csg.dijkstra(Gbig, directed=False, indices=np.arange(n, n + len(seed_ids)), return_predecessors=True, min_only=True)
    owner = sources[:n] - n
    out = np.full(n, -1)
    out[region] = owner[region]
    return out


def resplit_elongated(mesh, labels, A, aux, ratio_thresh=1.6, min_core=120):
    """Second pass: a label whose footprint is much longer along the arch than it is wide is almost
    certainly two teeth sharing a broad contact. Re-split it alone with increasing erosion plus a
    concavity cut until it yields two cores."""
    labels = labels.copy()
    H_s = smooth_field(A, aux["Hs"], 3)
    next_id = labels.max() + 1
    for lid in np.unique(labels[labels > 0]):
        m = labels == lid
        P = mesh.vertices[m][:, :2]
        if len(P) < 50:
            continue
        w = np.linalg.eigvalsh(np.cov((P - P.mean(0)).T))
        ratio = np.sqrt(w[1] / max(w[0], 1e-9))
        if ratio < ratio_thresh:
            continue
        dist = geodesic_from_boundary(mesh, A, m)
        done = False
        for erode in [2.5, 3.0, 3.5, 4.0, 4.5, 5.0]:
            for cut in [-9, -0.4, -0.25]:
                core = m & (dist > erode) & (H_s > cut)
                lab = connected_components(core, A)
                counts = np.bincount(lab[lab >= 0]) if (lab >= 0).any() else np.array([])
                big = [i for i, c in enumerate(counts) if c >= min_core]
                if len(big) >= 2:
                    # keep the two largest cores
                    big = sorted(big, key=lambda i: -counts[i])[:2]
                    cl = np.full(len(labels), -1)
                    for k, i in enumerate(big):
                        cl[lab == i] = k
                    owner = _assign_by_cores(mesh, A, m, cl)
                    labels[m & (owner == 1)] = next_id
                    next_id += 1
                    done = True
                    break
            if done:
                break
    return labels


def merge_small_teeth(mesh, labels, A, min_area=12.0, max_teeth=16):
    """Merge fragments: any label whose surface area is < min_area mm² is merged into the
    neighbouring label it shares the longest border with. Also caps the count at max_teeth by
    merging the smallest into their best neighbour."""
    labels = labels.copy()
    e = A.tocoo()
    while True:
        ids = np.unique(labels[labels > 0])
        if len(ids) == 0:
            break
        # area per label (vertex-area proxy)
        va = np.zeros(len(mesh.vertices))
        fa = mesh.area_faces / 3
        for k in range(3):
            np.add.at(va, mesh.faces[:, k], fa)
        areas = {i: va[labels == i].sum() for i in ids}
        small = [i for i in ids if areas[i] < min_area]
        if not small and len(ids) <= max_teeth:
            break
        victim = min(ids, key=lambda i: areas[i]) if not small else min(small, key=lambda i: areas[i])
        m = (labels[e.row] == victim) & (labels[e.col] > 0) & (labels[e.col] != victim)
        if m.sum() == 0:
            labels[labels == victim] = 0
            continue
        nb = np.bincount(labels[e.col[m]])
        target = int(np.argmax(nb))
        labels[labels == victim] = target
    # renumber 1..N
    ids = np.unique(labels[labels > 0])
    remap = {old: i + 1 for i, old in enumerate(ids)}
    out = np.zeros_like(labels)
    for old, new in remap.items():
        out[labels == old] = new
    return out


def order_teeth(mesh, labels, aux):
    """Order teeth along the arch from the midline. Returns dict id -> (side, position) with side in
    {-1,+1} (sign of x) and position 1 = central incisor outward, plus the arch centre and the
    incisor contact point (xy)."""
    ids = np.unique(labels[labels > 0])
    cents = {i: mesh.vertices[labels == i].mean(0) for i in ids}
    c = aux["ring_center"]
    ang = {i: np.arctan2(cents[i][0] - c[0], cents[i][1] - c[1]) for i in ids}  # 0 = +y (anterior)
    order = sorted(ids, key=lambda i: ang[i])
    # split at the midline: the two teeth whose angles straddle 0
    left = [i for i in order if ang[i] < 0][::-1]   # from midline outward (negative x side)
    right = [i for i in order if ang[i] >= 0]
    info = {}
    for pos, i in enumerate(left, start=1):
        info[i] = (-1, pos)
    for pos, i in enumerate(right, start=1):
        info[i] = (+1, pos)
    if left and right:
        contact = 0.5 * (cents[left[0]][:2] + cents[right[0]][:2])
        # better: the closest pair of vertices between the two centrals
        a = mesh.vertices[labels == left[0]]
        b = mesh.vertices[labels == right[0]]
        if len(a) > 0 and len(b) > 0:
            sa = a[np.argsort(np.linalg.norm(a[:, :2] - contact, axis=1))[:200]]
            sb = b[np.argsort(np.linalg.norm(b[:, :2] - contact, axis=1))[:200]]
            d = np.linalg.norm(sa[:, None, :] - sb[None, :, :], axis=2)
            k = np.unravel_index(np.argmin(d), d.shape)
            contact = 0.5 * (sa[k[0]][:2] + sb[k[1]][:2])
    else:
        contact = np.array([0.0, c[1] + 30.0])
    return info, cents, np.asarray(c), np.asarray(contact)


def margin_contour(mesh, field, level=0.5):
    """Extract iso-contour polylines of a per-vertex scalar field on the mesh surface.
    Returns a list of (M,3) closed/open polylines sorted by length (longest first)."""
    f = mesh.faces
    v = mesh.vertices
    s = field - level
    segs = []
    sv = s[f]
    sign = sv > 0
    crossing = sign.any(1) & (~sign).any(1)
    fc = f[crossing]
    svc = sv[crossing]
    pts_a, pts_b, ekeys_a, ekeys_b = [], [], [], []
    for tri, val in zip(fc, svc):
        pts = []
        keys = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if (val[a] > 0) != (val[b] > 0):
                t = val[a] / (val[a] - val[b])
                pts.append(v[tri[a]] + t * (v[tri[b]] - v[tri[a]]))
                keys.append((min(tri[a], tri[b]), max(tri[a], tri[b])))
        if len(pts) == 2:
            segs.append((keys[0], keys[1], pts[0], pts[1]))
    # chain segments by shared edge keys
    from collections import defaultdict
    key_pts = {}
    adj = defaultdict(list)
    for k0, k1, p0, p1 in segs:
        key_pts[k0] = p0
        key_pts[k1] = p1
        adj[k0].append(k1)
        adj[k1].append(k0)
    visited = set()
    loops = []
    for start in adj:
        if start in visited:
            continue
        # walk to one end if open
        chain = [start]
        visited.add(start)
        cur, prev = start, None
        while True:
            nxt = [k for k in adj[cur] if k != prev and k not in visited]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            visited.add(cur)
            chain.append(cur)
        # walk the other direction
        cur, prev = start, chain[1] if len(chain) > 1 else None
        back = []
        while True:
            nxt = [k for k in adj[cur] if k != prev and k not in visited]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            visited.add(cur)
            back.append(cur)
        chain = back[::-1] + chain
        loops.append(np.array([key_pts[k] for k in chain]))
    loops.sort(key=lambda L: -len(L))
    return loops


def bridge_embrasures(loop, mesh, radius=3.0, snap_tol=1.5):
    """Replace interproximal notches of a closed 3D margin loop with straight bridges across the papilla.

    Works on the XY footprint: morphological closing of the loop polygon with `radius` removes
    concavities narrower than ~2*radius (the embrasure V's) while keeping the tooth margins.
    New bridge points get z interpolated between the two rim points and are snapped onto the
    model surface so Trimlign cuts on the plastic. Returns a resampled closed loop (M,3)."""
    from shapely.geometry import Polygon, LineString
    from scipy.spatial import cKDTree
    from trimesh.proximity import ProximityQuery
    P = Polygon(loop[:, :2])
    if not P.is_valid:
        P = P.buffer(0)
    Pc = P.buffer(radius, join_style=1, resolution=24).buffer(-radius, join_style=1, resolution=24)
    if Pc.geom_type == "MultiPolygon":
        Pc = max(Pc.geoms, key=lambda g: g.area)
    ring = LineString(Pc.exterior.coords)
    n = max(int(ring.length / 0.25), 64)
    new_xy = np.array([ring.interpolate(t, normalized=True).coords[0] for t in np.linspace(0, 1, n, endpoint=False)])
    tree = cKDTree(loop[:, :2])
    d, j = tree.query(new_xy)
    anchor = d < 0.08
    if anchor.sum() < 10:  # degenerate: fall back to the original loop
        return loop
    z = np.full(n, np.nan)
    z[anchor] = loop[j[anchor], 2]
    xy = new_xy.copy()
    xy[anchor] = loop[j[anchor], :2]
    # interpolate z along the loop for bridge points (circular)
    idx = np.arange(n)
    an = np.where(anchor)[0]
    # arc-length parameter
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([xy, xy[:1]]), axis=0), axis=1))]
    s_pts, s_total = s[:-1], s[-1]
    s_an = np.r_[s_pts[an], s_pts[an[0]] + s_total]
    z_an = np.r_[z[an], z[an[0]]]
    z_all = np.interp(np.where(s_pts < s_pts[an[0]], s_pts + s_total, s_pts), s_an, z_an)
    z[~anchor] = z_all[~anchor]
    out = np.column_stack([xy, z])
    # snap bridge points to the surface
    if (~anchor).any():
        pq = ProximityQuery(mesh)
        closest, dist, _ = pq.on_surface(out[~anchor])
        ok = dist < snap_tol
        tmp = out[~anchor]
        tmp[ok] = closest[ok]
        out[~anchor] = tmp
    return out


def cap_distal(loop, mesh, keep_mm=2.5, snap_tol=2.0):
    """Trimlign cannot reach around the distal of the last molars: cut the loop's posterior tips
    off with a straight line `keep_mm` in front of the loop's most posterior point on each side,
    so the path crosses over the last molar instead of wrapping behind it (what Titan does).
    Posterior is -y in the output frame. Points on the cut are snapped onto the model surface."""
    from shapely.geometry import Polygon, LineString, box
    from scipy.spatial import cKDTree
    from trimesh.proximity import ProximityQuery
    P = Polygon(loop[:, :2])
    if not P.is_valid:
        P = P.buffer(0)
    out_xy = []
    # treat each side separately: left (x<0) and right (x>0) halves, cut each at its own y level
    minx, miny, maxx, maxy = P.bounds
    parts = []
    for sign in (-1, 1):
        half = P.intersection(box(0 if sign > 0 else minx - 1, miny - 1, maxx + 1 if sign > 0 else 0, maxy + 1))
        if half.is_empty:
            continue
        y_cut = half.bounds[1] + keep_mm
        parts.append(half.intersection(box(minx - 1, y_cut, maxx + 1, maxy + 1)))
    if not parts:
        return loop
    from shapely.ops import unary_union
    Pc = unary_union(parts).buffer(0.01).buffer(-0.01)
    if Pc.geom_type == "MultiPolygon":
        Pc = max(Pc.geoms, key=lambda g: g.area)
    ring = LineString(Pc.exterior.coords)
    n = max(int(ring.length / 0.25), 64)
    new_xy = np.array([ring.interpolate(t, normalized=True).coords[0] for t in np.linspace(0, 1, n, endpoint=False)])
    tree = cKDTree(loop[:, :2])
    d, j = tree.query(new_xy)
    anchor = d < 0.08
    z = np.full(n, np.nan)
    z[anchor] = loop[j[anchor], 2]
    # non-anchor (the straight cuts): z from nearest original points, then snapped to the surface
    if (~anchor).any():
        z[~anchor] = loop[j[~anchor], 2]
    out = np.column_stack([new_xy, z])
    out[anchor, :2] = loop[j[anchor], :2]
    if (~anchor).any():
        pq = ProximityQuery(mesh)
        closest, dist, _ = pq.on_surface(out[~anchor])
        ok = dist < snap_tol
        tmp = out[~anchor]; tmp[ok] = closest[ok]; out[~anchor] = tmp
    return out


def edentulous_gaps(mesh, labels, info, min_gap=3.0, renumber_gap=5.0, tooth_width=7.0, log=None):
    """Missing posterior teeth. Where two neighbouring teeth on a side have a gap between them (a
    missing premolar or molar), the gum-line contour would close round the teeth in front of the gap
    and drop everything behind it. Returns
      * a bool per vertex marking the ridge between the two teeth (inside the hull of the two crowns
        in plan view, from the neighbours' cervical level up - or the top 2 mm of the ridge when it
        has resorbed below that), to be treated as tooth when the trim line is drawn, so the line
        runs across the ridge to the teeth behind;
      * the list of gaps;
      * `info` renumbered so a missing tooth keeps its position (one position per ~`tooth_width` mm
        of gap): the molar behind a missing premolar stays a molar for reservoirs, marks, crown
        sizes."""
    import shapely
    from scipy.spatial import cKDTree
    from shapely.geometry import MultiPoint
    V = np.asarray(mesh.vertices)
    ridge = np.zeros(len(V), bool)
    gaps = []
    new_info = dict(info)
    for side in (-1, 1):
        teeth = sorted((pos, t) for t, (sd, pos) in info.items() if sd == side)
        shift = 0
        for (pa, a), (pb, b) in zip(teeth, teeth[1:]):
            if shift:
                new_info[b] = (side, pb + shift)
            ma, mb = labels == a, labels == b
            if ma.sum() < 50 or mb.sum() < 50:
                continue
            gap = float(cKDTree(V[ma][:, :2]).query(V[mb][:, :2])[0].min())
            if gap < min_gap:
                continue
            missing = max(1, int(round(gap / tooth_width))) if gap >= renumber_gap else 0   # a small gap: an erupting tooth, a diastema
            hull = MultiPoint(np.vstack([V[ma][:, :2], V[mb][:, :2]])).convex_hull
            x0, y0, x1, y1 = hull.bounds
            cand = np.where((labels == 0) & (V[:, 0] >= x0) & (V[:, 0] <= x1) & (V[:, 1] >= y0) & (V[:, 1] <= y1))[0]
            if len(cand):
                cand = cand[shapely.contains_xy(hull, V[cand, 0], V[cand, 1])]
            n_ridge = 0
            if len(cand):
                ca, cb = V[ma][:, :2].mean(0), V[mb][:, :2].mean(0)
                d = cb - ca
                L = max(float(np.linalg.norm(d)), 1e-6)
                d /= L
                za, zb = float(np.percentile(V[ma][:, 2], 5)), float(np.percentile(V[mb][:, 2], 5))
                u = np.clip(((V[cand, :2] - ca) @ d) / L, 0.0, 1.0)
                level = za + (zb - za) * u
                crest = float(np.percentile(V[cand, 2], 95))
                keep = V[cand, 2] >= np.minimum(level, crest - 2.0)
                ridge[cand[keep]] = True
                n_ridge = int(keep.sum())
            gaps.append(dict(side=int(side), after_position=int(pa + shift), gap_mm=round(gap, 1), missing=missing, ridge_vertices=n_ridge))
            shift += missing
            new_info[b] = (side, pb + shift)
            if log:
                what = "gap" if missing == 0 else ("missing tooth" if missing == 1 else f"{missing} missing teeth")
                log(f"{what} on the {'right' if side > 0 else 'left'} behind position {pa}: {gap:.0f} mm - trim line carried across the ridge ({n_ridge} vertices)")
    return ridge, gaps, new_info


def _largest(geom):
    if geom.geom_type == "MultiPolygon":
        return max(geom.geoms, key=lambda g: g.area)
    return geom


def round_distal(loop, mesh, labels, info, edge_zone=None, radius=3.0, window=6.0, inset=0.5,
                 z_sigma=2.0, max_dip=1.0, short_by=2.0, snap_tol=3.0, log=None):
    """Smooth, rounded distal ends: the trim line wraps the last tooth on each side as a gentle U and
    never goes past it.

    What the patient feels at the back of a tray is a sharp turn here - the gum line following the
    tooth label down the distal root or out onto the tuberosity / retromolar pad (a flap of tray behind
    the molar), or hard corners at the disto-buccal and disto-lingual line angles. Per side:
      * plan view: the line is clipped at the crown's distal extent (minus `inset`) and the corners in
        the last `window` mm are rounded with `radius` - a morphological opening restricted to that
        window, so the line only ever moves inwards onto the tooth, never out onto the gum;
      * height: within the window the height is smoothed along the line (`z_sigma` mm) and never dips
        more than `max_dip` below the straight between the window's ends;
      * a terminal tooth the scan did not capture whole (its crown runs into the scan edge) gets the
        tray cut shorter instead: the line crosses over the tooth `short_by` mm in front of the scan
        edge, with the same rounded corners, riding on the tooth surface;
      * every point that moved is put back on the surface.
    `labels` must be aligned with mesh.vertices; `edge_zone` (bool per vertex: within ~1 mm of the
    open edge of the scan) enables the short-cut rule. Returns (loop, per-side info)."""
    from shapely.geometry import Polygon, LineString
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter1d
    from trimesh.proximity import ProximityQuery
    V = np.asarray(mesh.vertices)
    P = Polygon(loop[:, :2])
    if not P.is_valid:
        P = P.buffer(0)
    P = _largest(P)
    sides = []
    for side in (-1, 1):
        teeth = {t: pos for t, (sd, pos) in info.items() if sd == side}
        if len(teeth) < 2:
            continue
        term = max(teeth, key=teeth.get)
        prev = max((t for t in teeth if t != term), key=teeth.get)
        mt, mp = labels == term, labels == prev
        if mt.sum() < 50 or mp.sum() < 50:
            continue
        c = V[mt][:, :2].mean(0)
        d = c - V[mp][:, :2].mean(0)
        if np.linalg.norm(d) < 1e-6:
            continue
        d /= np.linalg.norm(d)
        n = np.array([-d[1], d[0]])
        tv = (V[mt][:, :2] - c) @ d
        wv = (V[mt][:, :2] - c) @ n
        zv = V[mt][:, 2]
        t_min, t_max = float(tv.min()), float(tv.max())
        # where does the crown end? Its footprint is a wide round blob; a label that leaked onto the
        # tuberosity / retromolar pad trails off behind it as a narrower tail, so walk distally from
        # the widest point until the footprint has narrowed to 60 % (a round end is ~1 mm further)
        step = 0.25
        bins = np.arange(t_min, t_max + step, step)
        bi = np.clip(np.digitize(tv, bins) - 1, 0, len(bins) - 1)
        width = np.zeros(len(bins))
        z_low = np.full(len(bins), np.nan)
        edge_frac = np.zeros(len(bins))
        counts = np.bincount(bi, minlength=len(bins))
        for b in range(len(bins)):
            sel = bi == b
            if sel.sum() >= 3:
                width[b] = np.percentile(wv[sel], 95) - np.percentile(wv[sel], 5)
                z_low[b] = np.percentile(zv[sel], 5)
                if edge_zone is not None:
                    edge_frac[b] = float(edge_zone[mt][sel].mean())
        if len(width) >= 5:
            width = np.array([np.median(width[max(0, i - 1):i + 2]) for i in range(len(width))])
            z_low = np.array([np.nanmedian(zz) if np.isfinite(zz).any() else np.nan for zz in (z_low[max(0, i - 1):i + 2] for i in range(len(z_low)))])
        half = bins >= -2.0
        if not half.any():
            continue
        b_max = int(np.where(half)[0][np.argmax(width[half])])
        w_max = float(width[b_max])
        narrow = np.where(width[b_max:] < 0.6 * w_max)[0]
        rules = {}
        if len(narrow):
            t60 = float(bins[b_max + narrow[0]])
            t_tooth = min(t60 + 0.1 * w_max, t_max)
            incomplete = False
            rules["width"] = round(t_tooth - t_max, 2)
        else:
            t_tooth = t_max                            # still wide at the end: the footprint was cut off
            incomplete = True
        # a crown reaches down to the gum line on both sides; where the label's lowest points climb
        # well above that level there is no cervical wall any more - it has run onto the pad
        mid = np.abs(bins) <= 2.0
        if mid.any() and np.isfinite(z_low[mid]).any():
            z_gum = float(np.nanmedian(z_low[mid]))
            climbed = np.where(z_low[b_max:] > z_gum + 2.5)[0]
            if len(climbed):
                rules["gum"] = round(float(bins[b_max + climbed[0]]) - t_max, 2)
                t_tooth = min(t_tooth, float(bins[b_max + climbed[0]]))
        # and no tooth is longer than the molar in front of it (or ~13 mm along this axis, which is
        # what a complete first molar measures here, papilla and projection included)
        tp = (V[mp][:, :2] - V[mp][:, :2].mean(0)) @ d
        prev_len = float(tp.max() - tp.min())
        max_len = min(13.0, prev_len + 1.0) if prev_len >= 10.5 else 13.0   # a molar in front of it
        rules["length"] = round(t_min + max_len - t_max, 2)
        t_tooth = min(t_tooth, t_min + max_len)
        # the scan edge running through a still-wide crown = a partly captured tooth (stragglers in
        # the last fraction of a millimetre are ignored)
        populated = counts >= max(10, 0.2 * np.median(counts[counts > 0]))
        t_end_eff = float(bins[populated].max()) + step if populated.any() else t_max
        last = populated & (bins >= t_end_eff - 1.0 - step)
        cut = int((edge_zone[mt] & (tv >= t_end_eff - 1.0 - step)).sum()) if edge_zone is not None else 0
        if edge_zone is not None and last.any():
            incomplete = incomplete or (width[last].mean() > 0.5 * w_max and edge_frac[last].mean() > 0.3)
        rel = loop[:, :2] - c
        t, w = rel @ d, rel @ n
        near = np.abs(w) < 9.0
        if near.sum() < 5:
            continue
        t_line = float(t[near].max())
        if incomplete:
            t_cap = max(t_max - short_by, t_min + 2.0)
        else:
            t_cap = t_tooth - inset
        sides.append(dict(side=int(side), c=c, d=d, n=n, t_cap=t_cap, t_line=t_line, t_tooth=t_tooth, label_mm=round(t_max - t_min, 1), rules=rules,
                          incomplete=bool(incomplete), edge_vertices=cut, t_thr=min(t_cap, t_line) - window))
    if not sides:
        return loop, []

    # ---- plan view: never past the tooth, then rounded corners (only within the distal windows)
    far = 40.0
    for S in sides:
        c, d, n = S["c"], S["d"], S["n"]
        if S["t_line"] > S["t_cap"]:
            beyond = Polygon([c + d * S["t_cap"] + n * 12, c + d * (S["t_cap"] + far) + n * 12,
                              c + d * (S["t_cap"] + far) - n * 12, c + d * S["t_cap"] - n * 12])
            P = _largest(P.difference(beyond))
    # (the erosion splits the horseshoe where it is thin - keep every piece, the molar ends are what matter)
    P_open = P.buffer(-radius, join_style=1, resolution=24).buffer(radius, join_style=1, resolution=24)
    for S in sides:
        if P_open.is_empty:
            break
        c, d, n = S["c"], S["d"], S["n"]
        t1 = S["t_cap"] + 5.0
        t0 = S["t_cap"] - (radius + 1.5)          # corners live in the last few mm; the straights stay as scanned
        rect = Polygon([c + d * t0 + n * 12, c + d * t1 + n * 12, c + d * t1 - n * 12, c + d * t0 - n * 12])
        sliver = P.difference(P_open).intersection(rect)
        if not sliver.is_empty:
            P = _largest(P.difference(sliver.buffer(0.02)))
    P = _largest(P.buffer(0.01).buffer(-0.01))
    ring = LineString(P.exterior.coords)
    m = max(int(ring.length / 0.25), 64)
    new_xy = np.array([ring.interpolate(k / m, normalized=True).coords[0] for k in range(m)])
    dense = resample_polyline(loop, 0.05)          # match against the original line, not just its vertices
    tree = cKDTree(dense[:, :2])
    dist, j = tree.query(new_xy)
    anchor = dist < 0.08
    if anchor.sum() < 10:
        return loop, []
    xy = new_xy.copy()
    xy[anchor] = dense[j[anchor], :2]
    z = np.full(m, np.nan)
    z[anchor] = dense[j[anchor], 2]
    # heights of the new points: interpolated along the loop between the anchors (circular)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([xy, xy[:1]]), axis=0), axis=1))]
    s_pts, s_total = s[:-1], s[-1]
    an = np.where(anchor)[0]
    s_an = np.r_[s_pts[an], s_pts[an[0]] + s_total]
    z_an = np.r_[z[an], z[an[0]]]
    z_all = np.interp(np.where(s_pts < s_pts[an[0]], s_pts + s_total, s_pts), s_an, z_an)
    z[~anchor] = z_all[~anchor]
    moved = ~anchor
    on_top = np.zeros(m, bool)

    # top surface (for the line riding over a partly captured tooth): highest vertex within 0.35 mm
    vt = cKDTree(V[:, :2])

    def top_surface(q):
        out = np.empty(len(q))
        near = vt.query_ball_point(q, 0.35)
        _, jn = vt.query(q)
        for i, nb in enumerate(near):
            out[i] = V[nb, 2].max() if len(nb) else V[jn[i], 2]
        return out

    def run_around(mask, t):
        """Contiguous (circular) run of masked points containing the one furthest distal."""
        i0 = int(np.where(mask)[0][np.argmax(t[mask])])
        fwd = [i0]
        k = i0
        while mask[(k + 1) % m] and (k + 1) % m != i0 and len(fwd) < m:
            k = (k + 1) % m
            fwd.append(k)
        back = []
        k = i0
        while mask[(k - 1) % m] and (k - 1) % m not in fwd and len(back) < m:
            k = (k - 1) % m
            back.append(k)
        return np.array(back[::-1] + fwd)

    # ---- heights within the distal windows
    for S in sides:
        c, d, n = S["c"], S["d"], S["n"]
        rel = xy - c
        t, w = rel @ d, rel @ n
        inwin = (t > S["t_thr"]) & (np.abs(w) < 10.0)
        if inwin.sum() < 4:
            continue
        run = run_around(inwin, t)
        if len(run) < 4:
            continue
        if S["incomplete"]:
            mv = run[moved[run]]
            if len(mv):
                z[mv] = top_surface(xy[mv])
                on_top[mv] = True
            S["crossing_points"] = int(len(mv))
            continue
        zr = z[run].copy()
        steps = np.linalg.norm(np.diff(xy[run], axis=0), axis=1)
        spacing = float(np.median(steps)) if len(steps) else 0.25
        zs = gaussian_filter1d(zr, sigma=max(z_sigma / max(spacing, 1e-3), 0.5), mode="nearest")
        k_end = min(4, len(run) // 3)
        za, zb = float(zr[:k_end].mean()), float(zr[-k_end:].mean())
        sr = np.r_[0, np.cumsum(steps)]
        chord = za + (zb - za) * (sr / max(sr[-1], 1e-6))
        S["dip_before_mm"] = round(float(np.max(chord - zr)), 2)
        S["peak_before_mm"] = round(float(np.max(zr - chord)), 2)
        zs = np.maximum(zs, chord - max_dip)
        ramp = np.clip(np.minimum(sr, sr[-1] - sr) / 2.0, 0.0, 1.0)
        ramp = ramp * ramp * (3 - 2 * ramp)
        znew = zr + ramp * (zs - zr)
        changed = np.abs(znew - zr) > 0.05
        z[run] = znew
        moved[run[changed]] = True
        S["dip_after_mm"] = round(float(np.max(chord - znew)), 2)
        S["lifted_points"] = int(changed.sum())
        S["max_lift_mm"] = round(float(np.max(znew - zr)), 2)
    out = np.column_stack([xy, z])
    # ---- back onto the surface
    snap = moved & ~on_top
    if snap.any():
        pq = ProximityQuery(mesh)
        closest, dist, _ = pq.on_surface(out[snap])
        ok = dist < snap_tol
        tmp = out[snap]
        tmp[ok] = closest[ok]
        out[snap] = tmp
    res = []
    far_tree = cKDTree(loop)
    for S in sides:
        clipped = max(S["t_line"] - S["t_cap"], 0.0)
        rel = out[:, :2] - S["c"]
        inwin = ((rel @ S["d"]) > S["t_thr"]) & (np.abs(rel @ S["n"]) < 10.0)
        moved_mm = float(far_tree.query(out[inwin])[0].max()) if inwin.any() else 0.0
        r = dict(side=S["side"], incomplete=S["incomplete"], edge_vertices=S["edge_vertices"], moved_mm=round(moved_mm, 2), label_mm=S["label_mm"], rules=S["rules"],
                 t_tooth=round(float(S["t_tooth"]), 3),
                 clipped_mm=round(float(clipped), 2), past_tooth_mm=round(float(S["t_line"] - S["t_tooth"]), 2))
        for k in ("dip_before_mm", "dip_after_mm", "peak_before_mm", "lifted_points", "max_lift_mm", "crossing_points"):
            if k in S:
                r[k] = S[k]
        res.append(r)
        if log:
            name = "right" if S["side"] > 0 else "left"
            if S["incomplete"]:
                log(f"distal {name}: last tooth not fully in the scan ({S['edge_vertices']} crown vertices on the scan edge) - tray cut {short_by:.0f} mm short of the edge, over the tooth")
            else:
                bits = []
                if clipped > 0.2:
                    bits.append(f"pulled {clipped:.1f} mm forward onto the tooth")
                if S.get("dip_before_mm", 0) > max_dip + 0.2:
                    bits.append(f"{S['dip_before_mm']:.1f} mm dip behind the molar lifted to {S['dip_after_mm']:.1f}")
                log(f"distal {name}: corners rounded (r {radius:.0f} mm)" + (" - " + ", ".join(bits) if bits else ""))
    return out, res


def resample_polyline(P, spacing=0.5, closed=True):
    if closed and np.linalg.norm(P[0] - P[-1]) > 1e-6:
        P = np.vstack([P, P[:1]])
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    n = max(int(d[-1] / spacing), 8)
    t = np.linspace(0, d[-1], n, endpoint=not closed)
    out = np.column_stack([np.interp(t, d, P[:, k]) for k in range(3)])
    return out


def smooth_polyline(P, iters=2, closed=True):
    P = P.copy()
    for _ in range(iters):
        prev = np.roll(P, 1, axis=0)
        nxt = np.roll(P, -1, axis=0)
        Q = 0.25 * prev + 0.5 * P + 0.25 * nxt
        if not closed:
            Q[0], Q[-1] = P[0], P[-1]
        P = Q
    return P


# ---------------------------------------------------------------------------------------------
# Footprint watershed: tooth separation that does not depend on the papilla height or on
# curvature thresholds. Seen from above, every crown is a convex-ish blob, so the outline of the
# tooth mask pinches at every contact. The 2D distance transform of that footprint therefore has
# one mountain per tooth with a saddle at each contact; a watershed from the mountain tops
# separates the teeth, and the mesh watershed makes the boundary follow the pinch in 3D.
# ---------------------------------------------------------------------------------------------
def split_teeth_footprint(mesh, tooth_mask, A, px=0.1, min_peak=1.2, peak_sep_mm=2.5, merge_ratio=0.7,
                          neighbour_mm=9.0, min_verts=120):
    """Tooth ids (1..N, 0 = gingiva) from a watershed of the crown footprint. Returns (labels, n_peaks)."""
    from scipy import ndimage as ndi
    import heapq
    V = mesh.vertices
    idx = np.where(tooth_mask)[0]
    if len(idx) < min_verts:
        return tooth_mask.astype(int), 0
    xy = V[idx, :2]
    lo = xy.min(0) - 1.0
    ij = np.floor((xy - lo) / px).astype(int)
    H, W = ij[:, 1].max() + 12, ij[:, 0].max() + 12
    img = np.zeros((H, W), bool)
    img[ij[:, 1], ij[:, 0]] = True
    # close the point raster into a solid footprint (vertex spacing ~0.25 mm -> 2-3 px)
    r = max(2, int(round(0.3 / px)))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disk = (xx * xx + yy * yy) <= r * r
    img = ndi.binary_closing(ndi.binary_dilation(img, disk), disk)
    img = ndi.binary_fill_holes(img)
    dt = ndi.distance_transform_edt(img) * px
    # peaks = tooth centres
    sep = max(3, int(round(peak_sep_mm / px)))
    mx = ndi.maximum_filter(dt, size=2 * sep + 1)
    pk = np.argwhere((dt == mx) & (dt >= min_peak))
    if len(pk) == 0:
        return tooth_mask.astype(int), 0
    # drop duplicate plateau peaks, then merge peaks that lie on one ridge (no pinch between them)
    pk = pk[np.lexsort((pk[:, 1], pk[:, 0]))]
    keep = []
    for p in pk:
        if all(np.hypot(*(p - q)) > sep for q in keep):
            keep.append(p)
    pk = np.array(keep)
    n = len(pk)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a

    for a in range(n):
        for b in range(a + 1, n):
            d = np.hypot(*(pk[a] - pk[b])) * px
            if d > neighbour_mm:
                continue
            m = int(np.ceil(d / px)) + 1
            line = np.linspace(pk[a], pk[b], m)
            prof = dt[np.round(line[:, 0]).astype(int), np.round(line[:, 1]).astype(int)]
            if prof.min() > merge_ratio * min(dt[tuple(pk[a])], dt[tuple(pk[b])]):
                parent[find(a)] = find(b)
    groups = {}
    for a in range(n):
        groups.setdefault(find(a), []).append(a)
    seeds2d = [np.array([pk[a] for a in g]) for g in groups.values()]
    # per-vertex height = footprint distance at the vertex's pixel; seeds = vertices nearest each peak
    h = dt[ij[:, 1], ij[:, 0]]
    labels_t = np.zeros(len(idx), int)
    for k, s in enumerate(seeds2d):
        for p in s:
            d2 = (ij[:, 1] - p[0]) ** 2 + (ij[:, 0] - p[1]) ** 2
            near = d2 <= sep * sep
            labels_t[near] = k + 1
    # priority-flood watershed on the tooth sub-graph, descending height
    sub = A[idx][:, idx].tocsr()
    indptr, indices = sub.indptr, sub.indices
    heap = [(-h[i], i) for i in np.where(labels_t > 0)[0]]
    heapq.heapify(heap)
    while heap:
        _, i = heapq.heappop(heap)
        li = labels_t[i]
        for j in indices[indptr[i]:indptr[i + 1]]:
            if labels_t[j] == 0:
                labels_t[j] = li
                heapq.heappush(heap, (-h[j], j))
    labels = np.zeros(len(tooth_mask), int)
    labels[idx] = labels_t
    return labels, len(seeds2d)


# ---------------------------------------------------------------------------------------------
# Arch-profile tooth separation. Three 1-D profiles along the arch (incisal/occlusal height,
# crown-footprint half-width, facial concavity) are combined into a "boundary score"; its peaks
# are the contacts. Segment widths are sanity-checked against the expected tooth width at that
# arch position (so a flat row of crowded lower incisors still gets split, and a molar is not).
# Teeth are then flooded from each segment's centre band downhill along z, so the boundaries
# settle into the embrasures. Robust to flat papillae and broad contacts, unlike erosion.
# ---------------------------------------------------------------------------------------------
EXPECTED_WIDTH = {   # (|s| upper bound along the arch from the midline, mesiodistal width) in mm
    "upper": [(8.5, 8.5), (15.0, 6.5), (22.5, 7.5), (36.5, 7.0), (99.0, 10.0)],
    "lower": [(5.5, 5.5), (11.5, 6.0), (18.5, 7.0), (32.5, 7.0), (99.0, 11.0)],
}


def expected_width(s, arch):
    for hi, w in EXPECTED_WIDTH["lower" if arch == "lower" else "upper"]:
        if abs(s) < hi:
            return w
    return 10.0


def arch_coordinate(xy, weight=None):
    """Arc-length position along a parabola fitted to the arch (0 at the parabola axis = midline).
    `weight` (e.g. footprint half-width) concentrates the fit on the crown centre-line, so that
    positions are not compressed near the front of the arch."""
    from .orient import symmetry_frame
    import trimesh
    from scipy.spatial import cKDTree
    T, _, _ = symmetry_frame(xy)
    Q = trimesh.transform_points(np.c_[xy, np.zeros(len(xy))], T)[:, :2]
    if weight is not None:
        sel = weight >= 0.6 * np.percentile(weight, 95)
        if sel.sum() > 200:
            Q = Q[sel]
    # even quartic: follows tapered (V-shaped) arches that a parabola rounds off at the front
    X = np.c_[Q[:, 0] ** 4, Q[:, 0] ** 2, np.ones(len(Q))]
    cf = np.linalg.lstsq(X, Q[:, 1], rcond=None)[0]
    coef = np.array([cf[0], 0.0, cf[1], 0.0, cf[2]])
    Q = trimesh.transform_points(np.c_[xy, np.zeros(len(xy))], T)[:, :2]
    xs = np.linspace(Q[:, 0].min() - 2, Q[:, 0].max() + 2, 3000)
    ys = np.polyval(coef, xs)
    arc = np.r_[0, np.cumsum(np.hypot(np.diff(xs), np.diff(ys)))]
    s0 = np.interp(0, xs, arc)
    s = arc[cKDTree(np.c_[xs, ys]).query(Q)[1]] - s0
    return s


def footprint_halfwidth(xy, px=0.1):
    """Per-vertex distance from the edge of the crown footprint seen from above (mm)."""
    from scipy import ndimage as ndi
    lo = xy.min(0) - 1.0
    ij = np.floor((xy - lo) / px).astype(int)
    H, W = ij[:, 1].max() + 12, ij[:, 0].max() + 12
    img = np.zeros((H, W), bool)
    img[ij[:, 1], ij[:, 0]] = True
    r = max(2, int(round(0.3 / px)))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disk = (xx * xx + yy * yy) <= r * r
    img = ndi.binary_fill_holes(ndi.binary_closing(ndi.binary_dilation(img, disk), disk))
    dt = ndi.distance_transform_edt(img) * px
    return dt[ij[:, 1], ij[:, 0]]


def arch_boundaries(s, z, hw, conc_facial, arch, p_ip=None, b=0.25, prominence=0.6, min_score=2.2, min_gap=3.0, edge=2.5, log=None):
    """Contact positions along the arch from the combined boundary score. Returns (bounds, sgrid, score)."""
    from scipy import ndimage as ndi
    from scipy.signal import find_peaks
    sb = np.round(s / b).astype(int); k0 = sb.min(); sb = sb - k0; n = sb.max() + 1
    sgrid = (np.arange(n) + k0) * b
    zmax = np.full(n, np.nan); wmax = np.full(n, np.nan); conc = np.full(n, np.nan); ipp = np.full(n, np.nan)
    order = np.argsort(sb); sb_sorted = sb[order]
    starts = np.searchsorted(sb_sorted, np.arange(n)); ends = np.searchsorted(sb_sorted, np.arange(n), side="right")
    for k in range(n):
        ii = order[starts[k]:ends[k]]
        if len(ii) >= 3:
            zmax[k] = np.percentile(z[ii], 97); wmax[k] = hw[ii].max()
            c = conc_facial[ii]; c = c[np.isfinite(c)]
            if len(c) >= 3:
                conc[k] = np.percentile(c, 85)   # mean curvature: positive = concave in this code
            if p_ip is not None:
                ipp[k] = np.percentile(p_ip[ii], 85)

    def fill(v):
        ok = np.isfinite(v)
        return np.interp(sgrid, sgrid[ok], v[ok]) if ok.sum() >= 2 else np.zeros(n)
    sig = 0.4 / b
    zs = ndi.gaussian_filter1d(fill(zmax), sig); ws = ndi.gaussian_filter1d(fill(wmax), sig); cs = ndi.gaussian_filter1d(fill(conc), sig)
    def dip(v, mm=7.0):
        """Two-sided dip depth: how far v sits below the lower of the maxima to its left and right."""
        k = int(mm / b)
        left = ndi.maximum_filter1d(v, k, origin=k // 2 - (0 if k % 2 else 1))   # max over [s-mm, s]
        right = ndi.maximum_filter1d(v, k, origin=-(k // 2))                      # max over [s, s+mm]
        return np.clip(np.minimum(left, right) - v, 0, None)
    ips = ndi.gaussian_filter1d(fill(ipp), sig) if p_ip is not None else np.zeros(n)
    # the interproximal classifier is the sharpest cue; height dips next; width / concavity help
    # where the classifier is unsure (crowded incisors, unusual scans)
    score = 3.0 * ips + dip(zs) / 1.0 + 0.5 * dip(ws) + np.clip(cs, 0, None) / 1.0
    # min height 1.4: a concave groove alone (molar fissure / buccal groove) is not a contact
    pk, _ = find_peaks(score, prominence=prominence, height=min_score, distance=int(min_gap / b))
    lo, hi = sgrid[0], sgrid[-1]
    bounds = [sgrid[p] for p in pk if lo + edge < sgrid[p] < hi - edge]
    # width sanity: split segments far too wide for their position, merge ones far too narrow
    tried = set()
    for _ in range(20):
        edges = [lo] + bounds + [hi]
        changed = False
        for i in range(len(edges) - 1):
            a, c = edges[i], edges[i + 1]
            mid = 0.5 * (a + c); w = c - a; ew = expected_width(mid, arch)
            # a split must leave two plausible teeth, never a sliver (that just gets merged back)
            lo_w = 0.55 * min(ew, expected_width(a + 0.3 * w, arch), expected_width(c - 0.3 * w, arch))
            inner = (sgrid > a + max(edge, lo_w)) & (sgrid < c - max(edge, lo_w))
            key = (round(a, 1), round(c, 1))
            if w > 1.45 * ew and inner.any() and key not in tried:
                tried.add(key)
                j = np.argmax(np.where(inner, score, -np.inf))
                bounds = sorted(bounds + [sgrid[j]]); changed = True
                if log: log(f"  split {w:.1f} mm segment at s={mid:+.1f} (expected {ew} mm) -> boundary at {sgrid[j]:+.1f}")
                break
        if changed:
            continue
        # a weak boundary inside what could be one tooth (molar fissure, buccal groove): drop it
        for i in range(1, len(edges) - 1):
            a, c = edges[i - 1], edges[i + 1]
            sc = score[np.argmin(np.abs(sgrid - edges[i]))]
            mid = 0.5 * (a + c)
            limit = 1.25 * expected_width(mid, arch)
            if abs(mid) >= 20:       # back teeth: any single tooth is at most ~12 mm, whatever the count
                limit = max(limit, 12.0)
            if sc < 3.2 and (c - a) <= limit:
                if log: log(f"  drop weak boundary at s={edges[i]:+.1f} (score {sc:.1f}) inside a {c - a:.1f} mm span")
                bounds.pop(i - 1); changed = True
                break
        if changed:
            continue
        for i in range(1, len(edges) - 1):   # interior boundaries only
            a, c = edges[i - 1], edges[i + 1]
            wl, wr = edges[i] - a, c - edges[i]
            for w, mid in ((wl, 0.5 * (a + edges[i])), (wr, 0.5 * (edges[i] + c))):
                if w < 0.5 * expected_width(mid, arch) and i - 1 < len(bounds):
                    # drop the weaker of this segment's two boundaries (never the arch ends)
                    cand = [j for j in (i - 1, i) if 0 <= j < len(bounds)]
                    j = min(cand, key=lambda j: score[np.argmin(np.abs(sgrid - bounds[j]))])
                    if log: log(f"  merge {w:.1f} mm segment at s={mid:+.1f} (expected {expected_width(mid, arch)} mm)")
                    bounds.pop(j); changed = True
                    break
            if changed:
                break
        if not changed:
            break
    return np.array(bounds), sgrid, score


def split_teeth_arch(mesh, tooth_mask, A, aux, arch="upper", log=None):
    """Tooth ids (1..N, 0 = gingiva) from arch-profile boundaries + downhill flood along z."""
    import heapq
    idx = np.where(tooth_mask)[0]
    if len(idx) < 200:
        return tooth_mask.astype(int), np.array([])
    V = mesh.vertices
    xy = V[idx, :2]; z = V[idx, 2]
    hw = footprint_halfwidth(xy)
    s = arch_coordinate(xy, weight=hw)
    nrm = mesh.vertex_normals[idx]
    n_out = (nrm[:, :2] * aux["out_dir"][idx]).sum(1)
    H_s = smooth_field(A, aux["Hs"], 3)[idx]
    conc = np.where(n_out > 0.3, H_s, np.nan)
    p_ip = aux.get("p_ip")
    bounds, sgrid, score = arch_boundaries(s, z, hw, conc, arch, p_ip=(p_ip[idx] if p_ip is not None else None), log=log)
    edges = np.r_[s.min() - 1, bounds, s.max() + 1]
    seg = np.searchsorted(bounds, s)            # segment index per vertex
    centers = 0.5 * (edges[:-1] + edges[1:])
    # seeds: the centre band of each segment
    labels_t = np.zeros(len(idx), int)
    for k, c in enumerate(centers):
        band = (seg == k) & (np.abs(s - c) <= 1.0)
        if band.sum() < 5:
            band = (seg == k) & (np.abs(s - c) <= 2.0)
        labels_t[band] = k + 1
    # priority flood downhill along z within the tooth sub-graph
    h = z
    sub = A[idx][:, idx].tocsr()
    indptr, indices = sub.indptr, sub.indices
    heap = [(-h[i], i) for i in np.where(labels_t > 0)[0]]
    heapq.heapify(heap)
    while heap:
        _, i = heapq.heappop(heap)
        li = labels_t[i]
        for j in indices[indptr[i]:indptr[i + 1]]:
            if labels_t[j] == 0:
                labels_t[j] = li
                heapq.heappush(heap, (-h[j], j))
    labels = np.zeros(len(tooth_mask), int)
    labels[idx] = labels_t
    return labels, bounds


def refine_mask_crease(mesh, mask, A, aux, tau=0.6, band_mm=5.0, col_mm=0.5, facial_min=0.2, keep_mm=0.3):
    """Pull the tooth mask back to the gingival crease on the facial side.

    On smooth, convex attached gingiva the classifier sometimes labels a band below the cervical
    line as tooth. The cervical line is a strong concave crease (mean curvature > tau; positive =
    concave in this code). Column by column along the arch, the strongest crease near the mask
    edge is taken as the gum line and facial mask vertices below it are dropped."""
    H = smooth_field(A, aux["Hs"], 2)
    nrm = mesh.vertex_normals
    n_out = (nrm[:, :2] * aux["out_dir"]).sum(1)
    dist = geodesic_from_boundary(mesh, A, mask)
    idx = np.where(mask)[0]
    if len(idx) < 500:
        return mask
    s = arch_coordinate(mesh.vertices[idx, :2])
    z = mesh.vertices[idx, 2]
    facial = n_out[idx] > facial_min
    near = dist[idx] < band_mm
    cre = facial & near & (H[idx] > tau)
    col = np.round(s / col_mm).astype(int)
    z_cut = {}
    for c in np.unique(col[cre]):
        m = cre & (col == c)
        zz = z[m]; hh = H[idx][m]
        order = np.argsort(zz); zz = zz[order]; hh = hh[order]
        # cluster crease vertices by z (gap > 0.8 mm), keep the strongest cluster
        cuts = np.where(np.diff(zz) > 0.8)[0] + 1
        best, best_h = None, -1
        for grp in np.split(np.arange(len(zz)), cuts):
            if len(grp) < 3:
                continue
            hm = hh[grp].mean()
            if hm > best_h:
                best_h, best = hm, np.median(zz[grp])
        if best is not None:
            z_cut[c] = best
    if len(z_cut) < 5:
        return mask
    cols = np.array(sorted(z_cut)); zc = np.array([z_cut[c] for c in cols])
    # light smoothing along the arch (the gum line is scalloped, so only 1 column each side)
    zs = zc.copy()
    for i in range(len(zc)):
        lo, hi = max(0, i - 1), min(len(zc), i + 2)
        zs[i] = np.median(zc[lo:hi])
    zcol = np.interp(col, cols, zs)
    has = np.isin(col, cols) | ((col > cols.min()) & (col < cols.max()))
    drop = facial & near & has & (z < zcol - keep_mm)
    out = mask.copy()
    out[idx[drop]] = False
    return clean_mask(out, A)


def drop_retromolar_pads(mesh, labels, arch="lower", min_s=42.0, narrow=0.5, rise=1.5, log=None):
    """The last 'tooth' on a side, behind the molars, that is far too narrow for a molar and rises well
    above its neighbour is the retromolar pad / ascending tissue the classifier mistook for enamel:
    a real third molar is molar-sized and sits at or below the second molar's level. Those labels
    become gingiva (a half-scanned molar is molar-height, so it stays)."""
    idx = np.where(labels > 0)[0]
    if len(idx) < 200:
        return labels
    s = arch_coordinate(mesh.vertices[idx, :2])
    z = mesh.vertices[idx, 2]
    lab = labels[idx]
    info = {}
    for L in np.unique(lab):
        m = lab == L
        med = float(np.median(s[m]))
        info[L] = dict(n=int(m.sum()), lo=np.percentile(s[m], 5), hi=np.percentile(s[m], 95), z95=float(np.percentile(z[m], 95)), med=med)
    out = labels.copy()
    for side in (-1, 1):
        on_side = {L: a for L, a in info.items() if np.sign(a["med"]) == side}
        if len(on_side) < 3:
            continue
        last = max(on_side, key=lambda L: abs(on_side[L]["med"]))
        a = on_side[last]
        if abs(a["med"]) < min_s:
            continue
        rest = {L: b for L, b in on_side.items() if L != last}
        prev = max(rest, key=lambda L: abs(rest[L]["med"]))
        b = rest[prev]
        width = a["hi"] - a["lo"]
        if width < narrow * expected_width(a["med"], arch) and a["z95"] > b["z95"] + rise:
            out[labels == last] = 0
            if log:
                log(f"  dropped tooth {last} behind the last molar: only {width:.1f} mm along the arch and {a['z95'] - b['z95']:.1f} mm above tooth {prev} - soft tissue, not a tooth")
    return out
