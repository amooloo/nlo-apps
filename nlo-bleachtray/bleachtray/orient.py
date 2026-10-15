"""Rough automatic orientation of a raw arch scan.

Target frame (same as Titan/Trimlign): occlusal surfaces face +z, anterior is +y, midline is x=0,
origin roughly at the arch centre.  Refinement (midline through the central incisors) happens
after tooth segmentation in `pipeline.py`.
"""
import numpy as np
import trimesh


def _rot_from_axes(x, y, z):
    R = np.eye(4)
    R[:3, :3] = np.vstack([x, y, z])  # rows: new axes expressed in old coords
    return R


def rough_orient(mesh):
    """Return (oriented_mesh, T) with T the 4x4 transform applied (new = T @ old)."""
    v = mesh.vertices
    c = v.mean(0)
    # 1) up: area-weighted mean normal points from tissue into the mouth, i.e. the way the teeth point
    fn = mesh.face_normals
    fa = mesh.area_faces
    up_hint = (fn * fa[:, None]).sum(0)
    up_hint /= np.linalg.norm(up_hint)
    # occlusal plane normal from PCA (smallest variance), signed by the hint
    X = v - c
    cov = X.T @ X / len(X)
    w, U = np.linalg.eigh(cov)
    z = U[:, 0]
    if np.dot(z, up_hint) < 0:
        z = -z
    # 2) anterior: project the upper part of the scan (teeth) to the plane, find the open side of the U
    h = X @ z
    top = h > np.percentile(h, 55)
    P = X[top]
    # build in-plane basis
    tmp = U[:, 2] if abs(np.dot(U[:, 2], z)) < 0.9 else U[:, 1]
    a = tmp - np.dot(tmp, z) * z
    a /= np.linalg.norm(a)
    b = np.cross(z, a)
    pa, pb = P @ a, P @ b
    pc = np.array([pa.mean(), pb.mean()])
    ang = np.arctan2(pb - pc[1], pa - pc[0])
    hist, edges = np.histogram(ang, bins=72, range=(-np.pi, np.pi))
    # the posterior gap is the longest run of empty bins (circular)
    empty = hist < max(2, 0.02 * hist.max())
    best_len, best_start = 0, 0
    n = len(empty)
    for s in range(n):
        if not empty[s]:
            continue
        L = 0
        while L < n and empty[(s + L) % n]:
            L += 1
        if L > best_len:
            best_len, best_start = L, s
    if best_len == 0:
        # fallback: direction of lowest point density (ring is nearly closed)
        gap_angle = edges[np.argmin(hist)] + np.pi / 72
    else:
        mid = best_start + best_len / 2.0
        gap_angle = -np.pi + (mid + 0.5) * (2 * np.pi / n)
    post = np.cos(gap_angle) * a + np.sin(gap_angle) * b
    y = -post  # anterior
    y -= np.dot(y, z) * z
    y /= np.linalg.norm(y)
    x = np.cross(y, z)
    x /= np.linalg.norm(x)
    R = _rot_from_axes(x, y, z)
    T = np.eye(4)
    T[:3, :3] = R[:3, :3]
    T[:3, 3] = -R[:3, :3] @ c
    out = mesh.copy()
    out.apply_transform(T)
    # make sure face normals are outward (toward +z on average for the occlusal side)
    if (out.face_normals * out.area_faces[:, None]).sum(0)[2] < 0:
        out.invert()
    return out, T


def refine_frame(mesh, incisor_contact_xy, pair_vectors):
    """Rotate about z so the arch is symmetric about x=0 and translate the incisor contact to x=0.

    pair_vectors: list of XY vectors from a left tooth centroid to its mirror-image right tooth
    (centrals, laterals, canines...). Their mean defines the +x direction. Returns (mesh, T)."""
    pv = np.asarray(pair_vectors, dtype=float)
    if len(pv) == 0:
        return mesh.copy(), np.eye(4)
    xdir = pv.mean(0)
    xdir /= np.linalg.norm(xdir)
    theta = -np.arctan2(xdir[1], xdir[0])  # rotate so xdir aligns with +x
    Rz = trimesh.transformations.rotation_matrix(theta, [0, 0, 1])
    T = Rz.copy()
    # translate so contact x = 0 (y handled later by base placement)
    p = trimesh.transform_points(np.array([[incisor_contact_xy[0], incisor_contact_xy[1], 0.0]]), Rz)[0]
    T[0, 3] -= p[0]
    out = mesh.copy()
    out.apply_transform(T)
    return out, T
