"""Mesh helpers: loading/cleaning scans, graph Laplacian, field smoothing, curvature."""
import numpy as np
import scipy.sparse as sp
import trimesh


def load_scan(path):
    """Load a raw intraoral scan STL/PLY, keep the largest connected component, clean it."""
    m = trimesh.load(path, force="mesh")
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    parts = m.split(only_watertight=False)
    if len(parts) > 1:
        m = max(parts, key=lambda p: p.area)
    m.remove_unreferenced_vertices()
    trimesh.repair.fix_normals(m)  # consistent winding; outward sign fixed in orient
    return m


def adjacency(mesh):
    """Symmetric sparse vertex adjacency (binary)."""
    e = mesh.edges_unique
    n = len(mesh.vertices)
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    A = (A + A.T).tocsr()
    A.data[:] = 1.0
    return A


def smooth_field(A, f, iters=5, lam=0.5):
    """Diffuse a per-vertex field over the mesh graph (umbrella operator)."""
    deg = np.asarray(A.sum(1)).ravel()
    deg[deg == 0] = 1
    Dinv = sp.diags(1.0 / deg)
    f = f.astype(np.float64).copy()
    for _ in range(iters):
        f = (1 - lam) * f + lam * (Dinv @ (A @ f))
    return f


def cot_laplacian(mesh):
    """Cotangent-weighted Laplacian L (n x n, symmetric, L = D - W) and mixed vertex areas."""
    v = mesh.vertices
    f = mesh.faces
    n = len(v)
    i0, i1, i2 = f[:, 0], f[:, 1], f[:, 2]
    e0 = v[i2] - v[i1]
    e1 = v[i0] - v[i2]
    e2 = v[i1] - v[i0]

    def cot(a, b):
        cr = np.linalg.norm(np.cross(a, b), axis=1)
        cr[cr < 1e-12] = 1e-12
        return (a * b).sum(1) / cr

    c0 = cot(-e1, e2)  # angle at i0, opposite edge e0 (i1-i2)
    c1 = cot(-e2, e0)  # angle at i1, opposite edge e1 (i2-i0)
    c2 = cot(-e0, e1)  # angle at i2, opposite edge e2 (i0-i1)
    rows = np.concatenate([i1, i2, i2, i0, i0, i1])
    cols = np.concatenate([i2, i1, i0, i2, i1, i0])
    vals = 0.5 * np.concatenate([c0, c0, c1, c1, c2, c2])
    W = sp.coo_matrix((vals, (rows, cols)), shape=(n, n)).tocsr()
    W.data = np.clip(W.data, -50, 50)
    D = sp.diags(np.asarray(W.sum(1)).ravel())
    L = D - W
    area = np.zeros(n)
    fa = mesh.area_faces / 3.0
    np.add.at(area, i0, fa)
    np.add.at(area, i1, fa)
    np.add.at(area, i2, fa)
    area[area < 1e-9] = 1e-9
    return L.tocsr(), area


def curvatures(mesh, L=None, area=None):
    """Per-vertex mean curvature H (signed: convex positive w.r.t. vertex normals) and Gaussian K."""
    if L is None:
        L, area = cot_laplacian(mesh)
    v = mesh.vertices
    Hn = (L @ v) / (2.0 * area[:, None])  # mean curvature normal, magnitude |H|
    nrm = mesh.vertex_normals
    H = -(Hn * nrm).sum(1)  # sign: Δx = -2H n for outward normals -> H>0 convex
    # Gaussian curvature via angle defect
    f = mesh.faces
    ang = trimesh.triangles.angles(mesh.triangles)
    defect = np.full(len(v), 2 * np.pi)
    np.add.at(defect, f[:, 0], -ang[:, 0])
    np.add.at(defect, f[:, 1], -ang[:, 1])
    np.add.at(defect, f[:, 2], -ang[:, 2])
    # boundary vertices have defect ~pi; damp them
    K = defect / area
    return H, K


def taubin_smooth_mesh(mesh, iters=10, lam=0.5, mu=-0.53):
    """Taubin smoothing (shrink-free). Returns a new mesh."""
    A = adjacency(mesh)
    deg = np.asarray(A.sum(1)).ravel()
    deg[deg == 0] = 1
    Dinv = sp.diags(1.0 / deg)
    v = mesh.vertices.copy()
    for _ in range(iters):
        v = v + lam * (Dinv @ (A @ v) - v)
        v = v + mu * (Dinv @ (A @ v) - v)
    return trimesh.Trimesh(v, mesh.faces, process=False)


def connected_components(mask, A):
    """Connected components of the sub-graph induced by boolean vertex mask. Returns labels (-1 outside)."""
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return np.full(len(mask), -1)
    sub = A[idx][:, idx]
    ncomp, lab = sp.csgraph.connected_components(sub, directed=False)
    out = np.full(len(mask), -1)
    out[idx] = lab
    return out
