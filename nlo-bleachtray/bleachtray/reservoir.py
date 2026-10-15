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
