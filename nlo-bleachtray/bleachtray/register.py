"""Rigid registration helpers (used for ground truth and for optional 'match Titan' checks)."""
import numpy as np
import trimesh
from trimesh.proximity import ProximityQuery


def kabsch(P, Q):
    """Rigid transform (4x4) mapping points P onto Q (least squares)."""
    pc, qc = P.mean(0), Q.mean(0)
    H = (P - pc).T @ (Q - qc)
    U, _, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = qc - R @ pc
    return T


def robust_icp(src_pts, target_mesh, T0, iters=30, n=15000, thresh_start=3.0, thresh_end=0.3, seed=0):
    """Point-to-surface ICP with a shrinking distance threshold for outlier rejection.

    Returns (T, final_median_distance) where T maps src_pts into the target frame.
    """
    rng = np.random.default_rng(seed)
    pq = ProximityQuery(target_mesh)
    T = T0.copy()
    sample = src_pts[rng.choice(len(src_pts), min(n, len(src_pts)), replace=False)]
    med = None
    for it in range(iters):
        thresh = thresh_start * (thresh_end / thresh_start) ** (it / max(iters - 1, 1))
        P = trimesh.transform_points(sample, T)
        closest, dist, _ = pq.on_surface(P)
        keep = dist < thresh
        if keep.sum() < 100:
            break
        dT = kabsch(P[keep], closest[keep])
        T = dT @ T
        med = float(np.median(dist[keep]))
    return T, med
