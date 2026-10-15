"""Bleaching reservoirs: raise the facial surfaces of selected teeth by a smooth, feathered bump."""
import numpy as np
from .mesh_utils import smooth_field
from .segment import geodesic_from_boundary


def _smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def reservoir_displacement(mesh, labels, info, aux, A, height=0.5, setback=1.0, feather=1.0,
                           max_position=5, facial_only=True, exclude_occlusal=True):
    """Return per-vertex displacement magnitude (mm) along vertex normals.

    labels: per-vertex tooth id (0 = gingiva); info: id -> (side, position from midline)
    """
    n = len(mesh.vertices)
    sel = np.zeros(n, bool)
    for tid, (side, pos) in info.items():
        if pos <= max_position:
            sel |= labels == tid
    if not sel.any():
        return np.zeros(n)
    tooth_mask = labels > 0
    dist = geodesic_from_boundary(mesh, A, tooth_mask)  # distance from gum line, on teeth
    w = _smoothstep((dist - setback) / max(feather, 1e-6))
    w[~sel] = 0.0
    nrm = mesh.vertex_normals
    if facial_only:
        out_dir = aux["out_dir"]
        n_out = (nrm[:, :2] * out_dir).sum(1)
        w *= _smoothstep((n_out - 0.05) / 0.35)
    if exclude_occlusal:
        w *= _smoothstep((0.80 - nrm[:, 2]) / 0.25)
    # smooth the weight field so the bump has no steps, then renormalise its plateau
    w = smooth_field(A, w, 4)
    w = np.clip(w / max(np.percentile(w[sel], 97), 1e-6), 0, 1)
    w[~tooth_mask] = 0.0
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
