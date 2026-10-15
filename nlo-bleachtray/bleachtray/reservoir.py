"""Bleaching reservoirs: raise the facial surfaces of selected teeth by a smooth, feathered bump."""
import numpy as np
from .mesh_utils import smooth_field
from .segment import geodesic_from_boundary


def _smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def reservoir_displacement(mesh, labels, info, aux, A, height=0.5, setback=1.0, feather=1.0,
                           max_position=5, edge_clearance=0.4, edge_feather=0.6, edge_normal_z=0.6,
                           edge_band=0.3, facial_only=True, exclude_occlusal=True):
    """Return per-vertex displacement magnitude (mm) along vertex normals.

    labels: per-vertex tooth id (0 = gingiva); info: id -> (side, position from midline)

    The bump covers the facial surface of each selected tooth and stops short of every rim of that
    surface: `setback` mm from the gum line, and `edge_clearance` mm from the incisal edge / cusp
    ridges, from the neighbouring teeth (interproximal) and from the facial-lingual transition.
    Full height is reached `feather` / `edge_feather` mm further in.
    """
    n = len(mesh.vertices)
    sel_ids = [tid for tid, (side, pos) in info.items() if pos <= max_position]
    sel = np.isin(labels, sel_ids)
    if not sel.any():
        return np.zeros(n)
    tooth_mask = labels > 0
    nrm = mesh.vertex_normals
    z = mesh.vertices[:, 2]
    out_dir = aux["out_dir"]
    n_out = (nrm[:, :2] * out_dir).sum(1)
    facial = n_out > 0.05 if facial_only else np.ones(n, bool)
    # incisal edge / cusp zone: surface facing up, plus the top band of each tooth (sharp edges have
    # few up-facing vertices, the band catches those)
    edge_zone = (nrm[:, 2] > edge_normal_z) if exclude_occlusal else np.zeros(n, bool)
    for tid in sel_ids:
        m = labels == tid
        if m.sum() < 10:
            continue
        top = np.percentile(z[m], 99.5)
        edge_zone |= m & (z > top - edge_band) & (nrm[:, 2] > 0.25)
    region = sel & facial & ~edge_zone
    # a tooth label sometimes drags in a patch of gingiva (classifier slip): keep only the main
    # facial patch of each tooth, and nothing clearly below its facial gum line
    from .mesh_utils import connected_components
    e = A.tocoo()
    gum_adjacent = np.zeros(n, bool)
    gum_adjacent[e.row[(labels[e.row] > 0) & (labels[e.col] == 0)]] = True
    for tid in sel_ids:
        m = region & (labels == tid)
        if m.sum() < 10:
            region &= ~m
            continue
        cerv = (labels == tid) & gum_adjacent & (n_out > 0.3)
        if cerv.sum() >= 10:
            z_cerv = np.median(z[cerv])
            region &= ~(m & (z < z_cerv - 1.5))
            m = region & (labels == tid)
        comp = connected_components(m, A)
        if (comp >= 0).any():
            keep = np.argmax(np.bincount(comp[comp >= 0]))
            region &= ~(m & (comp != keep))
    # distance, inside each tooth's own facial field, from its rim (gum line, neighbouring teeth,
    # incisal edge, facial-lingual transition)
    d_rim = np.zeros(n)
    for tid in sel_ids:
        m = region & (labels == tid)
        if m.sum() < 10:
            region &= ~m
            continue
        d = geodesic_from_boundary(mesh, A, m)
        d_rim[m] = d[m]
    d_gum = geodesic_from_boundary(mesh, A, tooth_mask)  # distance from the gum line, on teeth
    w = _smoothstep((d_rim - edge_clearance) / max(edge_feather, 1e-6))
    w *= _smoothstep((d_gum - setback) / max(feather, 1e-6))
    w[~region] = 0.0
    # smooth the weight field so the bump has no steps, renormalise its plateau, then re-impose the
    # clearances exactly (smoothing creeps a few edges outward)
    w = smooth_field(A, w, 3)
    pos = w[region & (w > 0)]
    w = np.clip(w / max(np.percentile(pos, 97) if len(pos) else 1.0, 1e-6), 0, 1)
    w[~region] = 0.0
    w[d_rim < edge_clearance] = 0.0
    w[d_gum < setback] = 0.0
    return height * w


def apply_displacement(mesh, d):
    out = mesh.copy()
    out.vertices = mesh.vertices + mesh.vertex_normals * d[:, None]
    return out


def smooth_periphery(mesh, labels, A, start=2.0, full=4.5, iters=30, lam=0.5, mu=-0.52):
    """Taubin-smooth the scan surface away from the teeth: weight 0 up to `start` mm from the gum
    line, 1 from `full` mm on. Removes scanner noise and ragged cheek/lip tissue at the periphery
    while leaving teeth and the gum line exactly as scanned."""
    import scipy.sparse as sp
    from .segment import geodesic_dilate
    import scipy.sparse.csgraph as csg
    from .segment import _edge_lengths_graph
    tooth = labels > 0
    comp = ~tooth
    e = A.tocoo()
    seed = np.zeros(len(tooth), bool)
    seed[e.row[comp[e.row] & tooth[e.col]]] = True
    G = _edge_lengths_graph(mesh, A, comp)
    src = np.where(seed)[0]
    if len(src) == 0:
        return mesh
    d = csg.dijkstra(G, directed=False, indices=src, min_only=True)
    d[tooth] = 0.0
    d[~np.isfinite(d)] = full + 10
    w = _smoothstep((d - start) / max(full - start, 1e-6))
    deg = np.asarray(A.sum(1)).ravel(); deg[deg == 0] = 1
    Dinv = sp.diags(1.0 / deg)
    V = mesh.vertices.copy()
    for _ in range(iters):
        V = V + (w * lam)[:, None] * (Dinv @ (A @ V) - V)
        V = V + (w * mu)[:, None] * (Dinv @ (A @ V) - V)
    out = mesh.copy(); out.vertices = V
    return out
