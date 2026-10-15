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
