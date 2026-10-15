"""Per-vertex geometric features for tooth/gingiva classification.

All features are local and scale-free enough to transfer between patients. The mesh must already be
rough-oriented (occlusal +z, anterior +y).
"""
import numpy as np
import scipy.ndimage as ndi
from .mesh_utils import adjacency, cot_laplacian, curvatures, smooth_field, taubin_smooth_mesh

FEATURE_NAMES = []


def _neighbor_min(A, f):
    e = A.tocoo()
    out = f.copy()
    np.minimum.at(out, e.row, f[e.col])
    return out


def _neighbor_max(A, f):
    e = A.tocoo()
    out = f.copy()
    np.maximum.at(out, e.row, f[e.col])
    return out


def arch_ring(xy, z, n_bins=90):
    """Estimate the dental-arch ring centre and radius-vs-angle from the high points of the scan.
    Returns (center_xy, angles, radii) where radii[i] is the median radius of high points in bin i."""
    top = z > np.percentile(z, 70)
    P = xy[top]
    c = P.mean(0)
    ang = np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0])
    r = np.linalg.norm(P - c, axis=1)
    bins = np.linspace(-np.pi, np.pi, n_bins + 1)
    idx = np.clip(np.digitize(ang, bins) - 1, 0, n_bins - 1)
    radii = np.full(n_bins, np.nan)
    for i in range(n_bins):
        m = idx == i
        if m.sum() > 20:
            radii[i] = np.median(r[m])
    # fill empty bins (posterior gap) by nearest valid
    valid = ~np.isnan(radii)
    if valid.sum() < n_bins:
        xi = np.arange(n_bins)
        radii = np.interp(xi, xi[valid], radii[valid], period=n_bins)
    angles = 0.5 * (bins[:-1] + bins[1:])
    return c, angles, radii


def compute_features(mesh, return_aux=False):
    v = mesh.vertices
    A = adjacency(mesh)
    L, area = cot_laplacian(mesh)
    H, K = curvatures(mesh, L, area)
    H = np.clip(H, -5, 5)
    K = np.clip(K, -10, 10)
    # multi-scale via a smoothed copy of the mesh (captures the ~1 mm gingival crease)
    sm = taubin_smooth_mesh(mesh, iters=12)
    Hs, Ks = curvatures(sm)
    Hs = np.clip(Hs, -5, 5)
    Ks = np.clip(Ks, -10, 10)
    sm2 = taubin_smooth_mesh(sm, iters=25)
    Hs2, _ = curvatures(sm2)
    Hs2 = np.clip(Hs2, -5, 5)

    feats = {}
    feats["H"] = H
    feats["H_d3"] = smooth_field(A, H, 3)
    feats["H_d10"] = smooth_field(A, H, 10)
    feats["H_d30"] = smooth_field(A, H, 30)
    feats["Hs"] = Hs
    feats["Hs_d5"] = smooth_field(A, Hs, 5)
    feats["Hs_d20"] = smooth_field(A, Hs, 20)
    feats["Hs2"] = Hs2
    feats["Hs2_d10"] = smooth_field(A, Hs2, 10)
    feats["K_d3"] = smooth_field(A, K, 3)
    feats["Ks_d5"] = smooth_field(A, Ks, 5)
    feats["Hmin1"] = _neighbor_min(A, feats["H_d3"])
    feats["Hmin2"] = _neighbor_min(A, feats["Hmin1"])
    feats["Hsmin2"] = _neighbor_min(A, _neighbor_min(A, feats["Hs_d5"]))
    feats["Hmax2"] = _neighbor_max(A, _neighbor_max(A, feats["H_d3"]))

    n = mesh.vertex_normals
    feats["nz"] = n[:, 2]
    feats["nz_d10"] = smooth_field(A, n[:, 2], 10)

    # height below the local top (cusp/incisal level) using a 2D max-z grid
    xy = v[:, :2]
    z = v[:, 2]
    cell = 1.0
    lo = xy.min(0) - 2
    ij = np.floor((xy - lo) / cell).astype(int)
    shape = ij.max(0) + 3
    grid = np.full(shape, -np.inf)
    np.maximum.at(grid, (ij[:, 0], ij[:, 1]), z)
    grid[~np.isfinite(grid)] = np.nan
    # local top = max over a 5 mm radius neighbourhood
    g = np.nan_to_num(grid, nan=-1e3)
    top5 = ndi.maximum_filter(g, size=5)
    top9 = ndi.maximum_filter(g, size=9)
    feats["below_top5"] = top5[ij[:, 0], ij[:, 1]] - z
    feats["below_top9"] = top9[ij[:, 0], ij[:, 1]] - z
    # radial position relative to the arch ring (facial +, lingual -)
    c, angles, radii = arch_ring(xy, z)
    ang = np.arctan2(xy[:, 1] - c[1], xy[:, 0] - c[0])
    r = np.linalg.norm(xy - c, axis=1)
    ring_r = np.interp(ang, angles, radii, period=2 * np.pi)
    feats["radial"] = r - ring_r
    feats["radial_abs"] = np.abs(r - ring_r)
    # outward direction dot normal (facial-ness)
    out_dir = (xy - c) / np.maximum(r[:, None], 1e-6)
    feats["n_out"] = (n[:, :2] * out_dir).sum(1)

    names = list(feats.keys())
    X = np.column_stack([feats[k] for k in names]).astype(np.float32)
    X = np.nan_to_num(X)
    if return_aux:
        aux = dict(A=A, ring_center=c, ring_angles=angles, ring_radii=radii, out_dir=out_dir, H=H, Hs=Hs)
        return X, names, aux
    return X, names
