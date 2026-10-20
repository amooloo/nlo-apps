"""Loading the intraoral scan, telling which scanner made it and which arch it is, writing STL."""
import os, re, struct
import numpy as np


def load_scan(path):
    """Returns (vertices (N,3) float, faces (M,3) int, colors (N,3) uint8 or None)."""
    import trimesh
    m = trimesh.load(path, force="mesh", process=False)
    if isinstance(m, trimesh.Scene):
        m = trimesh.util.concatenate(list(m.geometry.values()))
    col = None
    try:
        vc = m.visual.vertex_colors
        if vc is not None and len(vc) == len(m.vertices):
            vc = np.asarray(vc)[:, :3]
            if vc.std() > 1:            # not a uniform default colour
                col = vc.astype(np.uint8)
    except Exception:
        col = None
    m2 = trimesh.Trimesh(m.vertices, m.faces, vertex_colors=None, process=True)   # welds duplicate vertices
    if col is not None and len(m2.vertices) != len(col):
        # vertices were merged: carry colours over by nearest original vertex
        from scipy.spatial import cKDTree
        _, idx = cKDTree(np.asarray(m.vertices)).query(np.asarray(m2.vertices))
        col = col[idx]
    v = np.asarray(m2.vertices, float)
    f = np.asarray(m2.faces, int)
    if len(f) < 1000:
        raise ValueError("The scan has fewer than 1000 triangles - that is not a full-arch intraoral scan.")
    ext = float(np.max(v.max(axis=0) - v.min(axis=0)))
    if ext < 10:          # inches or metres would be tiny
        raise ValueError(f"The scan is only {ext:.1f} units across - it does not look like millimetres.")
    return v, f, col


def scanner_tag(path):
    """A short tag for the scanner/export: 'itero', 'alliedstar', 'trios', 'medit', or 'ply'/'stl'/'obj'."""
    name = os.path.basename(path).lower()
    ext = os.path.splitext(name)[1].lstrip(".")
    head = b""
    try:
        with open(path, "rb") as fh:
            head = fh.read(2048).lower()
    except Exception:
        pass
    for tag, keys in (("itero", (b"itero", b"align technology")), ("alliedstar", (b"alliedstar", b"allied star", b"as connect")),
                      ("trios", (b"3shape", b"trios")), ("medit", (b"medit",)), ("primescan", (b"dentsply", b"sirona", b"primescan"))):
        if any(k in head for k in keys):
            return tag
    if "occlusion" in name or "itero" in name:
        return "itero"
    if re.search(r"_\d{8}_\d{2}-\d{2}-\d{2}_", name):
        return "alliedstar"
    return ext or "scan"


def guess_arch(path):
    n = os.path.basename(path).lower()
    if re.search(r"(upper|maxill|_u\.|_u_|\bu\b|oberkiefer|_ok\b)", n):
        return "upper"
    if re.search(r"(lower|mandib|_l\.|_l_|\bl\b|unterkiefer|_uk\b)", n):
        return "lower"
    return None


def write_stl(path, verts, faces):
    """Binary STL."""
    v = np.asarray(verts, np.float32)
    f = np.asarray(faces, np.int64)
    tri = v[f]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    n = (n / np.where(ln > 0, ln, 1)).astype(np.float32)
    rec = np.zeros(len(f), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"] = n
    rec["v"] = tri
    with open(path, "wb") as fh:
        hdr = b"NLO TAD Guide".ljust(80, b" ")
        fh.write(hdr)
        fh.write(struct.pack("<I", len(f)))
        fh.write(rec.tobytes())


def mesh_bin(verts, faces, extra=None):
    """Compact binary for the browser: uint32 nv, uint32 nf, uint32 nextra, float32 xyz*nv, uint32 idx*3nf,
    float32 extra*nv (one value per vertex, e.g. fit distance) when given."""
    v = np.ascontiguousarray(verts, np.float32)
    f = np.ascontiguousarray(faces, np.uint32)
    e = np.ascontiguousarray(extra, np.float32) if extra is not None else np.zeros(0, np.float32)
    return struct.pack("<III", len(v), len(f), 1 if extra is not None else 0) + v.tobytes() + f.tobytes() + e.tobytes()
