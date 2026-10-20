"""Small 2-D helpers. Points are (x, y) tuples or numpy arrays.

The analysis works in the *canonical* frame: X = anterior (the face looks toward +X), Y = superior.
An x-ray's pixel coordinates (x right, y down) are turned into it with `to_canonical`, which mirrors
x when the patient faces left, so every sign convention below holds for both facings.
"""
import math
import numpy as np


def facing_of(points):
    """'right' when nasion lies to the right of sella in the image, else 'left'. None without both."""
    s, n = points.get("S"), points.get("N")
    if s is None or n is None:
        return None
    return "right" if n[0] >= s[0] else "left"


def to_canonical(points, facing):
    """Image pixels -> canonical frame (still in pixels). facing: 'right' or 'left'."""
    sx = 1.0 if facing != "left" else -1.0
    return {k: np.array([sx * float(p[0]), -float(p[1])]) for k, p in points.items() if p is not None}


def from_canonical(points, facing):
    sx = 1.0 if facing != "left" else -1.0
    return {k: (sx * float(p[0]), -float(p[1])) for k, p in points.items()}


def vec(a, b):
    return np.asarray(b, float) - np.asarray(a, float)


def norm(v):
    return float(np.hypot(v[0], v[1]))


def dist(a, b):
    return norm(vec(a, b))


def unit(v):
    n = norm(v)
    if n == 0:
        raise ValueError("zero-length vector")
    return np.asarray(v, float) / n


def angle_between(u, v):
    """Unsigned angle between two vectors, degrees in [0, 180]."""
    u, v = unit(u), unit(v)
    c = max(-1.0, min(1.0, float(u @ v)))
    return math.degrees(math.acos(c))


def angle_at(p, vertex, q):
    """Unsigned angle p-vertex-q, degrees."""
    return angle_between(vec(vertex, p), vec(vertex, q))


def line_angle(a1, a2, b1, b2):
    """Acute angle between line a1-a2 and line b1-b2, degrees in [0, 90]."""
    ang = angle_between(vec(a1, a2), vec(b1, b2))
    return min(ang, 180.0 - ang)


def direction(a, b):
    """Direction of a->b in degrees, (-180, 180], measured from +X toward +Y."""
    d = vec(a, b)
    return math.degrees(math.atan2(d[1], d[0]))


def wrap(deg):
    """Wrap an angle difference to (-180, 180]."""
    d = (deg + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def signed_dist_anterior(p, l1, l2):
    """Distance from p to the line l1-l2, positive when p lies anterior (+X side) of it.

    Meant for near-vertical reference lines (NA, NB, the E-line), where 'in front of' is unambiguous.
    """
    p, l1, l2 = (np.asarray(x, float) for x in (p, l1, l2))
    d = unit(l2 - l1)
    foot = l1 + d * float((p - l1) @ d)
    off = p - foot
    mag = norm(off)
    return mag if off[0] >= 0 else -mag


def project_on(p, origin, d):
    """Scalar position of p along the unit direction d from origin."""
    return float((np.asarray(p, float) - np.asarray(origin, float)) @ np.asarray(d, float))


def affine_fit(src, dst):
    """Least-squares 2-D affine (2x3) mapping src points onto dst points (needs >= 3, not collinear)."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    if len(src) < 3:
        raise ValueError("need at least 3 point pairs")
    A = np.hstack([src, np.ones((len(src), 1))])
    M, *_ = np.linalg.lstsq(A, dst, rcond=None)
    return M.T  # 2x3


def affine_apply(M, pts):
    pts = np.asarray(pts, float)
    return pts @ M[:, :2].T + M[:, 2]


def similarity_fit(src, dst):
    """Least-squares similarity (rotation, uniform scale, translation, no reflection) src -> dst.
    Returns (scale, R 2x2, t)."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    H = a.T @ b
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T)) or 1.0
    D = np.diag([1.0, d])
    R = Vt.T @ D @ U.T
    var = (a ** 2).sum()
    scale = float((S * np.diag(D)).sum() / var) if var > 0 else 1.0
    t = md - scale * (R @ ms)
    return scale, R, t
