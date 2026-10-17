"""Mesh helpers: loading/cleaning scans, graph Laplacian, field smoothing, curvature."""
import numpy as np
import scipy.sparse as sp
import trimesh


MAX_FACES = 200_000   # scans above this are decimated first (same detail as a ~10 MB scanner export)


_PLY_TYPES = {"char": "i1", "uchar": "u1", "uint8": "u1", "int8": "i1", "short": "<i2", "ushort": "<u2", "int16": "<i2", "uint16": "<u2",
              "int": "<i4", "uint": "<u4", "int32": "<i4", "uint32": "<u4", "float": "<f4", "float32": "<f4", "double": "<f8", "float64": "<f8"}


def read_ply(path):
    """Binary little-endian PLY -> (vertices (n,3) float64, faces (m,3) int64, rgb (n,3) uint8 or None).

    Reads just what the app needs, in one pass with numpy: positions, the colour per vertex when the
    scanner wrote one (AlliedStar, iTero, Medit, 3Shape all do) and the triangles. A texture image the
    header points at is ignored - iTero writes both, and the general loader would try to unwrap the
    texture per face, which triples the vertices and ran this PC out of memory on a 350k-face scan.
    Returns None for an ASCII or unusual file (the general loader takes those)."""
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            if not line or len(header) > 20000:
                return None
            header += line
        lines = header.decode("ascii", "replace").split("\n")
        if not any(l.strip() == "format binary_little_endian 1.0" for l in lines):
            return None
        elements, cur = [], None
        for l in lines:
            w = l.split()
            if not w:
                continue
            if w[0] == "element":
                cur = dict(name=w[1], count=int(w[2]), props=[]); elements.append(cur)
            elif w[0] == "property" and cur is not None:
                cur["props"].append(w[1:])
        ve = next((e for e in elements if e["name"] == "vertex"), None)
        fe = next((e for e in elements if e["name"] == "face"), None)
        if ve is None or fe is None or elements[0] is not ve or elements[1] is not fe:
            return None
        if any(p[0] == "list" for p in ve["props"]):
            return None
        vdt = np.dtype([(p[1], _PLY_TYPES[p[0]]) for p in ve["props"]])
        vbuf = f.read(ve["count"] * vdt.itemsize)
        if len(vbuf) < ve["count"] * vdt.itemsize:
            return None
        v = np.frombuffer(vbuf, dtype=vdt)
        xyz = np.column_stack([v["x"], v["y"], v["z"]]).astype(np.float64)
        rgb = np.column_stack([v["red"], v["green"], v["blue"]]).astype(np.uint8) if all(k in vdt.names for k in ("red", "green", "blue")) else None
        # faces: scalar properties plus list properties; assume triangles (count 3) and texcoords of 6,
        # then check the byte count - any other layout goes to the general loader
        fields, idx_field = [], None
        for i, p in enumerate(fe["props"]):
            if p[0] == "list":
                cnt_t, item_t, name = _PLY_TYPES[p[1]], _PLY_TYPES[p[2]], p[3]
                n_items = 3 if name in ("vertex_indices", "vertex_index") else 6 if "texcoord" in name else None
                if n_items is None:
                    return None
                fields.append((f"n{i}", cnt_t)); fields.append((name, item_t, (n_items,)))
                if name in ("vertex_indices", "vertex_index"):
                    idx_field = name
            else:
                fields.append((p[1], _PLY_TYPES[p[0]]))
        if idx_field is None:
            return None
        fdt = np.dtype(fields)
        fbuf = f.read(fe["count"] * fdt.itemsize)
        if len(fbuf) != fe["count"] * fdt.itemsize:
            return None
        fa = np.frombuffer(fbuf, dtype=fdt)
        counts = fa[[n for n, _ in [(x[0], None) for x in fields] if n.startswith("n")][0]]
        if not np.all(counts == 3):
            return None
        faces = np.asarray(fa[idx_field], dtype=np.int64)
        if faces.min() < 0 or faces.max() >= len(xyz):
            return None
    return xyz, faces, rgb


def load_scan(path, max_faces=MAX_FACES):
    """Load a raw intraoral scan STL/PLY, keep the largest connected component, clean it.
    Very dense scans are decimated to `max_faces` so processing time stays ~constant.
    A PLY with a colour per vertex keeps it: `mesh.metadata["rgb"]` (uint8 n x 3, aligned with the
    cleaned mesh's vertices) - shape processing is unchanged, the colour rides along."""
    raw_xyz = raw_rgb = None
    m = None
    if str(path).lower().endswith(".ply"):
        try:
            got = read_ply(path)
        except Exception:
            got = None
        if got is not None:
            raw_xyz, faces, raw_rgb = got
            m = trimesh.Trimesh(raw_xyz, faces, process=False)
            m.merge_vertices()
    if m is None:
        m = trimesh.load(path, force="mesh")
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    parts = m.split(only_watertight=False)
    if len(parts) > 1:
        m = max(parts, key=lambda p: p.area)
    m.remove_unreferenced_vertices()
    m = strip_flat_base(m)
    if max_faces and len(m.faces) > max_faces:
        m = decimate(m, max_faces)
    trimesh.repair.fix_normals(m)  # consistent winding; outward sign fixed in orient
    if raw_rgb is not None:
        from scipy.spatial import cKDTree
        _, j = cKDTree(raw_xyz).query(np.asarray(m.vertices))
        m.metadata["rgb"] = raw_rgb[j]
    return m


def strip_flat_base(m, min_frac=0.06, tol=0.35):
    """Closed-shell exports (iTero "with base", 3Shape solid models) have a large flat floor and a
    skirt. The floor would be taken for the occlusal surface, so it is removed here; the skirt is
    harmless (it reads as gum). A raw scan has no large planar facet and is returned unchanged."""
    try:
        facets = m.facets
        if len(facets) == 0:
            return m
        areas = m.facets_area
        i = int(np.argmax(areas))
        if areas[i] < min_frac * m.area:
            return m
        faces = facets[i]
        normal = m.face_normals[faces].mean(0); normal /= np.linalg.norm(normal)
        origin = m.triangles_center[faces].mean(0)
        # every face lying in that plane (the floor is often split into several facets)
        d = (m.triangles_center - origin) @ normal
        on_plane = (np.abs(d) < tol) & ((m.face_normals @ normal) > 0.9)
        if on_plane.sum() < 3:
            return m
        keep = np.where(~on_plane)[0]
        out = m.submesh([keep], append=True)
        out.remove_unreferenced_vertices()
        parts = out.split(only_watertight=False)
        if len(parts) > 1:
            out = max(parts, key=lambda p: p.area)
        out.metadata["flat_base_removed"] = True
        out.metadata["up_hint"] = (-normal).tolist()
        return out
    except Exception:
        return m


def decimate(m, target_faces):
    """Quadric decimation (deterministic). Needs the fast-simplification package; without it the
    mesh is returned unchanged (processing just takes longer)."""
    try:
        import fast_simplification
    except ImportError:
        return m
    v, f = fast_simplification.simplify(np.asarray(m.vertices, dtype=np.float32), np.asarray(m.faces, dtype=np.int32),
                                        target_reduction=1.0 - target_faces / len(m.faces), agg=5)
    out = trimesh.Trimesh(np.asarray(v, dtype=np.float64), np.asarray(f, dtype=np.int64), process=True)
    out.metadata.update(m.metadata)
    out.update_faces(out.nondegenerate_faces())
    out.remove_unreferenced_vertices()
    parts = out.split(only_watertight=False)
    if len(parts) > 1:
        out = max(parts, key=lambda p: p.area)
    return out


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
