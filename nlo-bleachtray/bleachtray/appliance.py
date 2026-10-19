"""Brackets, archwire, ties, bands: finding fixed appliances on a coloured scan.

Two things give an appliance away. Its colour is not a mouth colour - enamel and gum live in a narrow
hue band from pink through ivory to yellow; metal comes out grey (iTero) or a cyan-blue sheen (AlliedStar),
elastic ties are green / purple / blue, bands and tubes the same metal. And it stands proud of the tooth:
a bracket is a 3-4 mm box 1-2 mm high on an otherwise smooth convex facial surface, the wire a ridge along
the arch. Neither alone is enough (shadows in embrasures are dark, incisal edges stick out), so the two
are combined the way the colour step does it: confident seeds from the rules train a small classifier on
this one scan, and the classifier decides the rest. Returns a per-vertex mask plus the pieces found."""
import numpy as np
from .mesh_utils import adjacency, smooth_field, connected_components
import scipy.sparse as sp


def _hsv(rgb):
    rgb = np.asarray(rgb, dtype=np.float64)
    if rgb.max() > 1.5:
        rgb = rgb / 255.0
    mx = rgb.max(1); mn = rgb.min(1); d = mx - mn
    h = np.zeros(len(rgb))
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    nz = d > 1e-9
    i = nz & (mx == r); h[i] = ((g[i] - b[i]) / d[i]) % 6
    i = nz & (mx == g) & (mx != r); h[i] = (b[i] - r[i]) / d[i] + 2
    i = nz & (mx == b) & (mx != r) & (mx != g); h[i] = (r[i] - g[i]) / d[i] + 4
    h = (h * 60.0) % 360.0
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0.0)
    return h, s, mx


def protrusion(mesh, A=None, iters=(40, 200)):
    """Signed height of each vertex above a Laplacian-smoothed copy of the surface (mm), at one or more
    smoothing scales: a bracket stands 1-2 mm proud at the coarse scale, a wire ~0.5-1 mm at the fine one."""
    A = adjacency(mesh) if A is None else A
    deg = np.asarray(A.sum(1)).ravel(); deg[deg == 0] = 1
    Dinv = sp.diags(1.0 / deg)
    v = np.asarray(mesh.vertices, dtype=np.float64).copy()
    out = []
    done = 0
    for it in iters:
        for _ in range(it - done):
            v = v + 0.5 * (Dinv @ (A @ v) - v)
        done = it
        import trimesh
        sm = trimesh.Trimesh(v, mesh.faces, process=False)
        out.append(((mesh.vertices - v) * sm.vertex_normals).sum(1))
    return out


def harmonic_fill(mesh, A, free, iters_cap=None):
    """Positions the `free` vertices would have if the surface were continued smoothly across them from
    their fixed surroundings (Laplace's equation with the rest of the mesh as boundary). Returns a
    (n,3) array equal to the mesh where fixed. The surface under a bracket, to first order."""
    from scipy.sparse.linalg import spsolve
    V = np.asarray(mesh.vertices, dtype=np.float64)
    out = V.copy()
    free = np.asarray(free, bool)
    if not free.any():
        return out
    deg = np.asarray(A.sum(1)).ravel()
    L = sp.diags(deg) - A
    L = L.tocsr()
    fi = np.where(free)[0]; bi = np.where(~free)[0]
    Lff = L[fi][:, fi].tocsc()
    Lfb = L[fi][:, bi]
    rhs = -Lfb @ V[bi]
    try:
        out[fi] = spsolve(Lff, rhs)
    except Exception:
        return out
    return out


def biharmonic_fill(mesh, A, free):
    """Like harmonic_fill but curvature-continuous: the filled patch carries the slope of its surroundings
    across (L^2 x = 0), so a crown keeps its convexity where a bracket was instead of going flat."""
    from scipy.sparse.linalg import spsolve
    V = np.asarray(mesh.vertices, dtype=np.float64)
    out = V.copy()
    free = np.asarray(free, bool)
    if not free.any():
        return out
    deg = np.asarray(A.sum(1)).ravel()
    Dinv = sp.diags(1.0 / np.maximum(deg, 1))
    L = (sp.eye(len(V)) - Dinv @ A).tocsr()        # normalised graph Laplacian
    M = (L.T @ L).tocsr()
    fi = np.where(free)[0]; bi = np.where(~free)[0]
    Mff = M[fi][:, fi].tocsc(); Mfb = M[fi][:, bi]
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            sol = spsolve(Mff, -Mfb @ V[bi])
        sol = np.asarray(sol).reshape(len(fi), 3)
        bad = ~np.isfinite(sol).all(1)
        if bad.any():          # an island of free vertices with no fixed neighbour: leave those where they are
            sol[bad] = V[fi][bad]
        out[fi] = sol
    except Exception:
        return harmonic_fill(mesh, A, free)
    return out


def _chain_loops(bedges):
    """Order boundary edges (m,2) into loops of vertex indices (open chains come back too)."""
    from collections import defaultdict
    nb = defaultdict(list)
    for a, b in bedges:
        nb[int(a)].append(int(b)); nb[int(b)].append(int(a))
    seen = set(); loops = []
    for start in list(nb):
        if start in seen:
            continue
        loop = [start]; seen.add(start); prev, cur = None, start
        while True:
            nxt = [x for x in nb[cur] if x != prev and x not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]; seen.add(cur); loop.append(cur)
        # closed if the last links back to the first
        closed = loop[0] in nb[loop[-1]] and len(loop) > 2
        loops.append((loop, closed))
    return loops


def _patch_loop(V, N, A, loop, clean=None):
    """A patch closing one hole: a ridge-regularised quadric fitted to the rim and the clean surface two
    rings round it (crown curvature), plus a harmonic interpolation of the rim's residuals (so the patch
    passes exactly through the rim and any tilt of the rim decays inward). Triangulated on the quadric's
    plane with interior points at the mesh's own spacing. Returns (points (m,3), faces (k,3) indexing V for
    the rim and len(V)+i for new points) or None when the rim does not project to a simple polygon."""
    from scipy.spatial import Delaunay
    from scipy.sparse.linalg import spsolve
    from shapely.geometry import Polygon
    import shapely
    loop = np.asarray(loop, int)
    P = V[loop]
    ring = np.zeros(len(V), bool); ring[loop] = True
    for _ in range(2):
        ring |= (A @ ring.astype(float) > 0)
    if clean is not None:
        ring &= clean | np.isin(np.arange(len(V)), loop)
    ri = np.where(ring)[0]
    nrm = N[ri].mean(0); nrm /= max(np.linalg.norm(nrm), 1e-9)
    c = P.mean(0)
    e1, e2, nn = _frame(nrm)
    Lr = V[ri] - c
    ur, wr, zr = Lr @ e1, Lr @ e2, Lr @ nn
    X = _poly_design(ur, wr, False)
    try:
        coef = _ridge_lstsq(X, zr, np.ones(len(ri)), 0.05 * len(ri))
    except Exception:
        return None
    uv = np.column_stack([(P - c) @ e1, (P - c) @ e2])
    poly = Polygon(uv)
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.geom_type != "Polygon" or poly.is_empty:
            return None
    sub = A[ri][:, ri].tocoo()
    el = np.linalg.norm(V[ri[sub.row]] - V[ri[sub.col]], axis=1)
    h = max(float(np.median(el)) if len(el) else 0.3, 0.15)
    inner = poly.buffer(-0.7 * h)
    pts = np.zeros((0, 2))
    if not inner.is_empty:
        x0, y0, x1, y1 = inner.bounds
        xs = np.arange(x0, x1 + h, h); ys = np.arange(y0, y1 + h * 0.866, h * 0.866)
        grid = np.array([(x + (0.5 * h if j % 2 else 0.0), y) for j, y in enumerate(ys) for x in xs])
        if len(grid):
            pts = grid[shapely.contains_xy(inner, grid[:, 0], grid[:, 1])]
    allp = np.vstack([uv, pts])
    try:
        tri = Delaunay(allp).simplices
    except Exception:
        return None
    cen = allp[tri].mean(1)
    tri = tri[shapely.contains_xy(poly, cen[:, 0], cen[:, 1])]
    if not len(tri):
        return None
    d = allp[tri[:, 1]] - allp[tri[:, 0]]; e = allp[tri[:, 2]] - allp[tri[:, 0]]
    cw = (d[:, 0] * e[:, 1] - d[:, 1] * e[:, 0]) < 0
    tri[cw] = tri[cw][:, [0, 2, 1]]
    k = len(loop); m = len(pts)
    # heights: quadric + harmonic interpolation of the rim residuals over the patch graph
    z_rim = (P - c) @ nn
    res_rim = z_rim - _poly_design(uv[:, 0], uv[:, 1], False) @ coef
    zq = _poly_design(pts[:, 0], pts[:, 1], False) @ coef if m else np.zeros(0)
    if m:
        nloc = k + m
        rows, cols = [], []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            rows += list(tri[:, a]); cols += list(tri[:, b]); rows += list(tri[:, b]); cols += list(tri[:, a])
        G = sp.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nloc, nloc)).tocsr(); G.data[:] = 1.0
        deg = np.asarray(G.sum(1)).ravel()
        Lap = (sp.diags(deg) - G).tocsr()
        fi = np.arange(k, nloc); bi = np.arange(k)
        try:
            r_in = np.asarray(spsolve(Lap[fi][:, fi].tocsc(), -Lap[fi][:, bi] @ res_rim)).ravel()
            if not np.isfinite(r_in).all():
                r_in = np.zeros(m)
        except Exception:
            r_in = np.zeros(m)
        z_in = zq + r_in
        P3 = c + pts[:, :1] * e1 + pts[:, 1:2] * e2 + z_in[:, None] * nn
    else:
        P3 = np.zeros((0, 3))
    newidx = np.r_[loop, len(V) + np.arange(m)]
    faces = newidx[tri]
    return P3, faces


def _split_at_waist(V, loop, min_sep=10, max_gap=2.0):
    """Split a rim loop in two where it pinches (a bracket hole joined to its wire channel): the pair of
    non-neighbouring rim vertices that are closest in space. None if it does not pinch."""
    from scipy.spatial import cKDTree
    loop = list(loop); n = len(loop)
    min_sep = max(min_sep, int(0.2 * n))
    if n < 2 * min_sep + 2:
        return None
    P = V[loop]
    tree = cKDTree(P)
    best = None
    for i, nb in enumerate(tree.query_ball_point(P, max_gap)):
        for j in nb:
            sep = min((j - i) % n, (i - j) % n)
            if sep < min_sep:
                continue
            d = float(np.linalg.norm(P[i] - P[j]))
            if best is None or d < best[0]:
                best = (d, i, j)
    if best is None:
        return None
    _, i, j = best
    if i > j:
        i, j = j, i
    return loop[i:j + 1], loop[j:] + loop[:i + 1]


def _earclip(P, nrm):
    """Triangulate a closed 3D loop by clipping ears (smallest convex corner first, no other rim point
    inside). Returns (k-2, 3) index triples into P. Works for rims no plane can hold."""
    k = len(P)
    idx = list(range(k))
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 10 * k:
        guard += 1
        best = None
        m = len(idx)
        for t in range(m):
            ia, ib, ic = idx[t - 1], idx[t], idx[(t + 1) % m]
            a, b, c = P[ia], P[ib], P[ic]
            u, v = a - b, c - b
            cr = np.cross(v, u)
            convex = (cr @ nrm) > 0
            cosang = (u @ v) / max(np.linalg.norm(u) * np.linalg.norm(v), 1e-12)
            ang = float(np.arccos(np.clip(cosang, -1, 1)))
            if not convex:
                continue
            # no other remaining rim point inside the triangle (barycentric test in the triangle's plane)
            others = [idx[q] for q in range(m) if q not in (t - 1 if t > 0 else m - 1, t, (t + 1) % m)]
            if others:
                Q = P[others] - b
                e0, e1 = u, v
                d00, d01, d11 = e0 @ e0, e0 @ e1, e1 @ e1
                den = d00 * d11 - d01 * d01
                if den > 1e-12:
                    d20, d21 = Q @ e0, Q @ e1
                    w0 = (d11 * d20 - d01 * d21) / den; w1 = (d00 * d21 - d01 * d20) / den
                    # inside in the plane, and close to the plane
                    tn = cr / max(np.linalg.norm(cr), 1e-12)
                    inside = (w0 > 1e-6) & (w1 > 1e-6) & (w0 + w1 < 1 - 1e-6) & (np.abs(Q @ tn) < 0.5)
                    if inside.any():
                        continue
            if best is None or ang < best[0]:
                best = (ang, t)
        if best is None:        # no clean ear left: take the sharpest corner anyway
            angs = []
            for t in range(m):
                a, b, c = P[idx[t - 1]], P[idx[t]], P[idx[(t + 1) % m]]
                u, v = a - b, c - b
                angs.append(float(np.arccos(np.clip((u @ v) / max(np.linalg.norm(u) * np.linalg.norm(v), 1e-12), -1, 1))))
            best = (0.0, int(np.argmin(angs)))
        t = best[1]
        tris.append([idx[t - 1], idx[t], idx[(t + 1) % len(idx)]])
        idx.pop(t)
    if len(idx) == 3:
        tris.append(list(idx))
    return np.array(tris, int)


def _fan_loop(V, N, A, loop, rounds=2):
    """Fallback for a rim no plane can hold (one that wraps round a line angle): ear-clip it in 3D,
    subdivide the triangles so the patch has interior points, and relax those to continue the surface."""
    from scipy.sparse.linalg import spsolve
    loop = np.asarray(loop, int); k = len(loop)
    P = V[loop]
    nrm = N[loop].mean(0); nrm /= max(np.linalg.norm(nrm), 1e-9)
    tris = _earclip(P, nrm)
    if not len(tris):
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    # orient each ear with the rim normal
    d1 = P[tris[:, 1]] - P[tris[:, 0]]; d2 = P[tris[:, 2]] - P[tris[:, 0]]
    flip = (np.cross(d1, d2) @ nrm) < 0
    tris[flip] = tris[flip][:, [0, 2, 1]]
    # midpoint subdivision: local point list starts with the rim points
    pts = [P[i] for i in range(k)]
    faces = [list(t) for t in tris]
    for _ in range(rounds):
        mid = {}
        def m_of(a, b):
            key = (min(a, b), max(a, b))
            if key not in mid:
                mid[key] = len(pts); pts.append(0.5 * (pts[a] + pts[b]))
            return mid[key]
        nf = []
        for a, b, c in faces:
            ab, bc, ca = m_of(a, b), m_of(b, c), m_of(c, a)
            nf += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
        faces = nf
    pts = np.array(pts); faces = np.array(faces, int)
    # local index -> mesh index: rim points keep theirs, the rest are new
    m = len(pts) - k
    newpts = pts[k:]
    gmap = np.r_[loop, len(V) + np.arange(m)]
    gfaces = gmap[faces]
    if m == 0:
        return np.zeros((0, 3)), gfaces
    # relax the new points: rim + 2 rings fixed
    ring = np.zeros(len(V), bool); ring[loop] = True
    for _ in range(2):
        ring |= (A @ ring.astype(float) > 0)
    fixed_idx = np.where(ring)[0]; nf_ = len(fixed_idx)
    gi = -np.ones(len(V), int); gi[fixed_idx] = np.arange(nf_)
    sub = A[fixed_idx][:, fixed_idx].tocoo(); rows = list(sub.row); cols = list(sub.col)
    g = np.where(gfaces >= len(V), nf_ + (gfaces - len(V)), gi[np.clip(gfaces, 0, len(V) - 1)])
    for a, b in ((0, 1), (1, 2), (2, 0)):
        rows += list(g[:, a]); cols += list(g[:, b]); rows += list(g[:, b]); cols += list(g[:, a])
    G = sp.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(nf_ + m, nf_ + m)).tocsr(); G.data[:] = 1.0
    deg = np.asarray(G.sum(1)).ravel()
    L = (sp.eye(nf_ + m) - sp.diags(1.0 / np.maximum(deg, 1)) @ G).tocsr(); M = (L.T @ L).tocsr()
    X = np.vstack([V[fixed_idx], newpts]); fi = np.arange(nf_, nf_ + m); bi = np.arange(nf_)
    try:
        newpts = np.asarray(spsolve(M[fi][:, fi].tocsc(), -M[fi][:, bi] @ X[bi])).reshape(m, 3)
    except Exception:
        pass
    return newpts, gfaces


def _patch_any(V, N, A, loop, depth=0, clean=None):
    """Patch a closed rim loop: directly, else split at its waist and patch the halves, else a fan.
    Returns a list of (points, faces)."""
    per = float(np.linalg.norm(np.diff(V[list(loop) + [loop[0]]], axis=0), axis=1).sum())
    res = _patch_loop(V, N, A, loop, clean=clean) if per <= 55.0 else None
    if res is not None:
        return [res]
    halves = _split_at_waist(V, loop) if depth < 8 else None
    if halves is not None and all(len(h) >= 4 for h in halves):
        out = []
        for h in halves:
            sub = _patch_any(V, N, A, h, depth + 1, clean=clean)
            if sub is None:
                out = None
                break
            out += sub
        if out is not None:
            return out
    if per > 55.0:          # long but without a waist: try one patch anyway
        res = _patch_loop(V, N, A, loop, clean=clean)
        if res is not None:
            return [res]
    return None             # no clean patch: the caller smooths this region over in place instead


def _mid_air(mesh, A, mask, deep_mm=0.8, local_mm=1.5, tube=0.8):
    """Appliance vertices that are wire floating across an embrasure: nothing but appliance within
    `deep_mm` (a wire lying on enamel has the enamel right beside it) and locally one-dimensional (a
    bracket's body is deep too, but it is a flat face, not a tube)."""
    from scipy.spatial import cKDTree
    V = np.asarray(mesh.vertices)
    idx = np.where(mask)[0]
    out = np.zeros(len(V), bool)
    if len(idx) < 10 or (~mask).sum() < 10:
        return out
    d = cKDTree(V[~mask]).query(V[idx])[0]
    deep = idx[d > deep_mm]
    if not len(deep):
        return out
    mt = cKDTree(V[idx])
    for v, nb in zip(deep, mt.query_ball_point(V[deep], local_mm)):
        if len(nb) < 8:
            continue
        Q = V[idx[nb]]; Q = Q - Q.mean(0)
        w = np.linalg.svd(Q, compute_uv=False) ** 2
        if w[0] > 0 and 1.0 - w[1] / w[0] > tube:
            out[v] = True
    # the whole cross-section of the wire where it floats: widen within the appliance to the wire's radius
    grow = out.copy()
    for _ in range(3):
        grow |= (A @ grow.astype(float) > 0) & mask & (np.isin(np.arange(len(V)), idx))
    # ... but not back onto enamel: anything within deep_mm of plain surface stays
    near_plain = np.zeros(len(V), bool); near_plain[idx[d <= deep_mm * 0.75]] = True
    out = grow & ~near_plain
    lab = connected_components(out, A)
    for c in np.unique(lab[lab >= 0]):
        m = lab == c
        if m.sum() < 6:
            out[m] = False
    return out


def remove_appliances(mesh, A, mask, rings=2, log=None):
    """Take the appliance off: every face touching a masked vertex (widened by `rings` for the adhesive
    flash) is cut out - a wire floating across an embrasure is then simply gone - and each hole this
    leaves in the enamel or gum is closed with a smooth patch that continues the surface round it (flat
    patch bent by a biharmonic solve; a rim no plane can hold is ear-clipped and relaxed). Returns a
    NEW mesh (its own vertex order, colours carried over) and info."""
    import trimesh
    mask = np.asarray(mask, bool)
    V = np.asarray(mesh.vertices, dtype=np.float64); N = np.asarray(mesh.vertex_normals); F = np.asarray(mesh.faces)
    rgb = mesh.metadata.get("rgb")
    # the bracket's base pad and the adhesive flash round it are a low ledge (0.2-0.5 mm) that the bump
    # test does not see once the region is tight: continue the enamel (biharmonic, so a crown's curvature
    # carries across) over the appliance plus a band round it and take with it whatever in that band
    # still stands above that continuation and touches the appliance
    import trimesh
    band = mask.copy()
    for _ in range(8):
        band |= (A @ band.astype(float) > 0)
    inner = mask.copy()
    for _ in range(5):
        inner |= (A @ inner.astype(float) > 0)
    hgt = mls_height(mesh, band & ~mask, ~inner)      # fitted to enamel at least ~1 mm from the appliance
    hgt = np.nan_to_num(hgt, nan=0.0)
    ledge = band & ~mask & (hgt > 0.1)               # above the enamel: the pad, the flash
    grow = mask.copy()
    for _ in range(5):
        nxt = grow | ((A @ grow.astype(float) > 0) & ledge)
        if (nxt == grow).all():
            break
        grow = nxt
    wide = grow.copy()
    for _ in range(rings):
        wide |= (A @ wide.astype(float) > 0)
    def bedges(faces):
        e = np.sort(faces[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2), axis=1)
        u, c = np.unique(e, axis=0, return_counts=True)
        return u[c == 1]
    old_b = set(map(tuple, bedges(F)))
    # cut; where two holes touch at one rim vertex (boundary degree 4) cut that vertex too, so every rim is a
    # simple loop; a leftover island of appliance with nothing plain in it goes as well
    for _ in range(5):
        gone_f = wide[F].any(1)
        F2 = F[~gone_f]
        bk = bedges(F2)
        new_b = np.array([tuple(e) not in old_b for e in bk], bool) if len(bk) else np.zeros(0, bool)
        if new_b.any():
            vv, cc = np.unique(bk[new_b].ravel(), return_counts=True)
            bad = vv[cc != 2]
        else:
            bad = np.zeros(0, int)
        if not len(bad):
            break
        wide[bad] = True
    m2 = trimesh.Trimesh(V, F2, process=False)
    comps = trimesh.graph.connected_components(m2.face_adjacency, nodes=np.arange(len(F2)))
    if len(comps) > 1:
        areas = np.array([m2.area_faces[c].sum() for c in comps])
        keep_f = np.zeros(len(F2), bool)
        for c, a in zip(comps, areas):
            if a >= 0.02 * areas.max():
                keep_f[c] = True
        F2 = F2[keep_f]
        bk = bedges(F2)
        new_b = np.array([tuple(e) not in old_b for e in bk], bool) if len(bk) else np.zeros(0, bool)
    loops = _chain_loops(bk[new_b]) if new_b.any() else []
    patches_V, patches_F = [], []
    nV = len(V); filled = skipped = 0
    fallback_rim = np.zeros(len(V), bool)
    for loop, closed in loops:
        if len(loop) < 3:
            continue
        if not closed and np.linalg.norm(V[loop[0]] - V[loop[-1]]) < 1.0:
            closed = True
        if closed and len(loop) == 3:          # a pinhole: one triangle, oriented with the surface
            tri = np.array(loop)
            if np.cross(V[tri[1]] - V[tri[0]], V[tri[2]] - V[tri[0]]) @ N[tri].mean(0) < 0:
                tri = tri[[0, 2, 1]]
            patches_V.append(np.zeros((0, 3))); patches_F.append(tri[None, :]); filled += 1
            continue
        # a long rim is a band of cut-out wire + brackets running over several teeth: _patch_any splits it
        # at its waists (the embrasures) into one hole per tooth before patching
        res = _patch_any(V, N, A, loop, clean=~wide) if closed else None
        if res is None:
            fallback_rim[loop] = True; skipped += 1
            continue
        for P3, faces in res:
            faces = faces.copy(); faces[faces >= len(V)] += (nV - len(V))
            patches_V.append(P3); patches_F.append(faces); nV += len(P3)
        filled += 1
    # regions whose rim could not be patched cleanly (an open rim against the scan edge, a hole that wraps
    # round a corner): their cut faces are put back and the vertices moved onto a smooth continuation
    F_restore = np.zeros((0, 3), int)
    if fallback_rim.any():
        reg = (A @ fallback_rim.astype(float) > 0) & wide
        for _ in range(60):
            nxt = reg | ((A @ reg.astype(float) > 0) & wide)
            if (nxt == reg).all():
                break
            reg = nxt
        rimv = np.zeros(len(V), bool); rimv[np.unique(F2)] = True
        F_restore = F[gone_f & reg[F].any(1)]
        F_restore = F_restore[(reg | rimv)[F_restore].all(1)]
        if len(F_restore):
            m_tmp = trimesh.Trimesh(V, np.vstack([F2, F_restore]), process=False)
            from .mesh_utils import adjacency as _adj
            fill = biharmonic_fill(m_tmp, _adj(m_tmp), reg)
            V = np.where(reg[:, None], fill, V)
    Vout = np.vstack([V] + patches_V) if patches_V else V
    Fout = np.vstack([F2, F_restore] + patches_F) if patches_F else np.vstack([F2, F_restore])
    rgb_out = None
    if rgb is not None:
        rgb = np.asarray(rgb)
        extra = []
        for P3, faces in zip(patches_V, patches_F):
            rimv = np.unique(faces[faces < len(V)])
            extra.append(np.tile(np.median(rgb[rimv], axis=0) if len(rimv) else np.array([205, 195, 175]), (len(P3), 1)))
        rgb_out = np.vstack([rgb] + extra) if extra else rgb
    ref = np.zeros(len(Vout), bool); ref[np.unique(Fout)] = True
    remap = -np.ones(len(Vout), int); remap[ref] = np.arange(int(ref.sum()))
    out = trimesh.Trimesh(Vout[ref], remap[Fout], process=False)
    # soften the seam: the new points, the rim and one ring round it are relaxed together (a few
    # shrink-free Taubin steps on the final mesh), the rest stays put
    if patches_V:
        from .mesh_utils import adjacency as _adj
        Ao = _adj(out)
        isnew = np.zeros(len(Vout), bool); isnew[len(V):] = True
        rimv = np.zeros(len(Vout), bool)
        for faces in patches_F:
            rimv[faces[faces < len(V)]] = True
        soft = (isnew | rimv)[ref]
        soft |= (Ao @ soft.astype(float) > 0)
        deg = np.asarray(Ao.sum(1)).ravel(); deg[deg == 0] = 1
        X = np.asarray(out.vertices, dtype=np.float64).copy()
        for _ in range(6):
            for w in (0.5, -0.53):
                d = (Ao @ X) / deg[:, None] - X
                X[soft] += w * d[soft]
        out = trimesh.Trimesh(X, out.faces, process=False)
    if rgb_out is not None:
        out.metadata["rgb"] = np.asarray(rgb_out[ref], dtype=np.uint8)
    for k, v in mesh.metadata.items():
        if k != "rgb":
            out.metadata[k] = v
    info = dict(vertices=int(mask.sum()), ledge=int((grow & ~mask).sum()), cut_out=int(wide.sum()), holes_patched=filled, smoothed_in_place=skipped, new_vertices=int(sum(len(p) for p in patches_V)))
    if log:
        log(f"appliances removed: {int(wide.sum())} vertices cut out, {filled} hole{'s' if filled != 1 else ''} in the enamel closed with new surface"
            + (f", {skipped} smoothed over in place" if skipped else ""))
    return out, info


def _frame(nrm):
    nrm = nrm / max(np.linalg.norm(nrm), 1e-12)
    a = np.array([1.0, 0, 0]) if abs(nrm[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(nrm, a); e1 /= np.linalg.norm(e1); e2 = np.cross(nrm, e1)
    return e1, e2, nrm


def _poly_design(u, w, cubic):
    cols = [np.ones_like(u), u, w, u * u, u * w, w * w]
    if cubic:
        cols += [u ** 3, u * u * w, u * w * w, w ** 3]
    return np.column_stack(cols)


def _ridge_lstsq(X, z, sw, lam):
    """Weighted least squares with a ridge on the curvature terms (columns 3..): a quadric fitted to an
    annulus must not extrapolate a wild curvature into the hole it surrounds."""
    Xw = X * sw[:, None]; zw = z * sw
    G = Xw.T @ Xw; b = Xw.T @ zw
    pen = np.zeros(X.shape[1]); pen[3:] = lam
    return np.linalg.solve(G + np.diag(pen), b)


def mls_height(mesh, region, clean, radius=3.0, sigma=1.4, min_pts=40, normals=None, lam=0.05):
    """Height of every `region` vertex above the enamel round it: a weighted quadric is fitted to the
    `clean` vertices within `radius` (Gaussian weights, same-facing only), in the frame of those
    vertices, and the vertex's signed offset from it along that frame's normal is returned. Vertices
    with too few clean neighbours get nan. Geometry-aware, unlike a graph continuation."""
    from scipy.spatial import cKDTree
    V = np.asarray(mesh.vertices); N = np.asarray(mesh.vertex_normals) if normals is None else normals
    ri = np.where(region)[0]; ci = np.where(clean)[0]
    h = np.full(len(V), np.nan)
    if len(ri) == 0 or len(ci) < min_pts:
        return h
    tree = cKDTree(V[ci])
    nbrs = tree.query_ball_point(V[ri], radius)
    for v, nb in zip(ri, nbrs):
        if len(nb) < min_pts:
            continue
        q = ci[nb]
        # same-facing clean surface only (not the far side of a thin incisor)
        nv = N[v]
        Q = V[q]; NQ = N[q]
        d = np.linalg.norm(Q - V[v], axis=1)
        wgt = np.exp(-0.5 * (d / sigma) ** 2)
        nbar = (NQ * wgt[:, None]).sum(0); nbar /= max(np.linalg.norm(nbar), 1e-9)
        if nbar @ nv < -0.2:
            nbar = -nbar
        keep = (NQ @ nbar) > 0.0
        if keep.sum() < min_pts:
            continue
        Q, wgt = Q[keep], wgt[keep]
        c = (Q * wgt[:, None]).sum(0) / wgt.sum()
        e1, e2, nn = _frame(nbar)
        L = Q - c
        u, w, z = L @ e1, L @ e2, L @ nn
        X = _poly_design(u, w, False)
        sw = np.sqrt(wgt)
        try:
            lamw = lam * float(wgt.sum())
            coef = _ridge_lstsq(X, z, sw, lamw)
            # one robust pass: drop the worst-fitting (a stray bit of appliance in the clean set)
            res = z - X @ coef
            s_ = max(float(np.median(np.abs(res))) * 1.48, 0.03)
            good = np.abs(res) < 3.0 * s_
            if good.sum() >= min_pts and (~good).any():
                coef = _ridge_lstsq(X[good], z[good], sw[good], lamw)
        except Exception:
            continue
        Lv = V[v] - c
        uv, wv, zv = Lv @ e1, Lv @ e2, Lv @ nn
        h[v] = zv - float((_poly_design(np.array([uv]), np.array([wv]), False) @ coef)[0])
    return h


def bump_height(mesh, A, free):
    """How far each `free` vertex stands above the surface continued smoothly across it (mm, signed
    along the fill's normal)."""
    import trimesh
    fill = harmonic_fill(mesh, A, free)
    fm = trimesh.Trimesh(fill, mesh.faces, process=False)
    h = ((np.asarray(mesh.vertices) - fill) * fm.vertex_normals).sum(1)
    h[~free] = 0.0
    return h


def detect_appliances(mesh, A, rgb, feats=None, log=None, rng_seed=0, thr=0.35):
    """Per-vertex appliance mask on a coloured scan. `feats` = the pipeline's geometric feature matrix
    (compute_features, with aux), reused when given. Returns (mask, info).

    Candidates come from colour; whether a candidate is really an appliance is decided by its height
    above the surface continued across the candidate region (bump). That continuation is only honest
    when the free region is tight - a wide one on a convex crown reads the crown's own bulge as a bump -
    so the bump is measured, the region shrunk to what stood proud, and measured again, four times."""
    n = len(mesh.vertices)
    info = dict(used=False)
    if rgb is None or len(rgb) != n:
        return np.zeros(n, bool), info
    h, s, val = _hsv(rgb)
    dh = np.abs(((h - 20.0) + 180.0) % 360.0 - 180.0)
    off_hue = np.clip((dh - 50.0) / 40.0, 0, 1) * np.clip((s - 0.15) / 0.2, 0, 1)      # cyan / blue / green / purple
    grey = np.clip((0.30 - s) / 0.10, 0, 1) * np.clip((0.84 - val) / 0.12, 0, 1)        # unsaturated and not bright
    dark = np.clip((0.55 - val) / 0.15, 0, 1) * np.clip((0.6 - s) / 0.2, 0, 1)           # metal in shadow
    colour_score = np.maximum.reduce([off_hue, grey, dark])
    cs = smooth_field(A, colour_score, 2)
    radial = below = H = None
    if feats is not None and isinstance(feats, tuple) and len(feats) > 1:
        F = feats[0]; names = list(feats[1])
        if "radial" in names:
            radial = F[:, names.index("radial")]
        # the incisal / occlusal band is measured against the highest point within 4.5 mm (below_top9), not 2.5 mm:
        # a bracket or tube that stands out past the tooth's own outline is the highest thing in a small column
        # round it, so its upper half read as "top of the tooth" and was never a candidate - on a lower with
        # lingually tipped molars and premolars (iTero, 10/19/2026) most of the premolar brackets and both molar
        # tubes stayed on. Over 26 coloured arches: +10-50 % appliance area on the braces scans, all of it on
        # brackets, tubes and wire; nothing new on the 9 plain ones
        key = "below_top9" if "below_top9" in names else "below_top5"
        if key in names:
            below = F[:, names.index(key)]
        if len(feats) > 2 and isinstance(feats[2], dict):
            H = feats[2].get("H")
    if H is None:
        from .mesh_utils import curvatures
        H = np.clip(curvatures(mesh)[0], -5, 5)
    sharp = smooth_field(A, (np.abs(H) > 1.0).astype(float), 3)
    # never candidates: the open edge of the scan, the incisal / occlusal band of the teeth, the vestibule
    import trimesh as _tm
    edges = mesh.edges_sorted
    single = _tm.grouping.group_rows(edges, require_count=1)
    on_edge = np.zeros(n, bool)
    if len(single):
        on_edge[np.unique(edges[single])] = True
    near_edge = smooth_field(A, on_edge.astype(float), 12) > 0.02
    top = (below < 1.5) if below is not None else np.zeros(n, bool)
    if radial is not None:
        top &= np.abs(radial) < 7.0
    outside = (radial > 9) if radial is not None else np.zeros(n, bool)
    allowed = ~top & ~near_edge & ~outside
    # candidates: appliance colour, closed so a whole bracket is taken in (its flat faces can read as enamel)
    cand = (cs > 0.3) & allowed
    grown = cand.copy()
    for _ in range(7):
        grown |= (A @ grown.astype(float) > 0)
    shrunk = grown.copy()
    for _ in range(7):
        shrunk &= ~((A @ (~shrunk).astype(float)) > 0)
    free = (cand | shrunk) & allowed
    for _ in range(2):
        free |= (A @ free.astype(float) > 0) & allowed
    if free.sum() < 100:
        info["reason"] = "no appliance-coloured region"
        return np.zeros(n, bool), info
    # iterate: bump against the continuation, keep what stands proud (or is unmistakably coloured), widen by one
    bs = np.zeros(n)
    core = free.copy()
    for it in range(4):
        bump = bump_height(mesh, A, free)
        bs = smooth_field(A, bump, 1)
        core = free & ((bs > thr) | ((cs > 0.6) & (bs > 0.12)))
        nxt = core.copy()
        nxt |= (A @ nxt.astype(float) > 0) & allowed
        if it < 3 and (nxt == free).all():
            break
        free = nxt
    mask = core & allowed
    # the adhesive flash and bracket base: one more ring where it still stands a little proud
    for _ in range(2):
        ring = (A @ mask.astype(float) > 0) & ~mask & (bs > 0.2) & allowed
        if not ring.any():
            break
        mask |= ring
    # pieces
    labels = connected_components(mask, A)
    V = np.asarray(mesh.vertices)
    area_v = np.zeros(n)
    np.add.at(area_v, mesh.faces.ravel(), np.repeat(mesh.area_faces / 3.0, 3))
    keep = np.zeros(n, bool); pieces = []; dropped = []
    for c in np.unique(labels[labels >= 0]):
        m = labels == c
        a = float(area_v[m].sum())
        hb = float(np.percentile(bs[m], 90))
        if a < 1.5 or hb < 0.45:
            dropped.append(m)
            continue
        keep |= m
        ext = V[m].max(0) - V[m].min(0)
        pieces.append(dict(area_mm2=round(a, 1), height_mm=round(hb, 2), centre=[round(float(x), 2) for x in V[m].mean(0)],
                           extent_mm=[round(float(x), 1) for x in ext], vertices=int(m.sum()), colour=round(float(cs[m].mean()), 2)))
    # a speck of tie or wire right next to a kept piece is part of it
    if dropped and keep.any():
        from scipy.spatial import cKDTree
        kt = cKDTree(V[keep])
        for m in dropped:
            if float(kt.query(V[m])[0].min()) < 1.0 and float(bs[m].max()) > 0.25:
                keep |= m
    # the archwire runs through every bracket slot: trace a smooth path through the bracket centres and
    # take what is on it, so the thin stretches between brackets that colour alone misses come too
    ring_c = feats[2].get("ring_center") if (isinstance(feats, tuple) and len(feats) > 2 and isinstance(feats[2], dict)) else None
    wire = np.zeros(n, bool); winfo = {}
    try:
        wire, winfo = trace_wire(mesh, A, keep, pieces, cs, radial, below, ring_c, ~allowed)
    except Exception as ex:  # noqa
        winfo = dict(error=str(ex)[:120])
    keep |= wire
    info.update(used=True, vertices=int(keep.sum()), area_mm2=round(float(area_v[keep].sum()), 1),
                pieces=sorted(pieces, key=lambda d: -d["area_mm2"]), wire=winfo, bump=bs)
    if log:
        log(f"appliances: {len(pieces)} piece{'s' if len(pieces) != 1 else ''}, {info['area_mm2']:.0f} mm2 on {int(keep.sum())} vertices"
            + (f", wire traced through {winfo['brackets']} brackets ({winfo.get('added', 0)} more vertices)" if winfo.get("added") else ""))
    return keep, info


def trace_wire(mesh, A, mask, pieces, cs, radial, below, ring_c, forbidden):
    """A smooth path through the bracket centres, ordered round the arch, is where the archwire is. Vertices
    within the wire's own radius of it are wire; a little further out they are wire if they stand proud of
    the surface continued across them or carry the appliance colour. Returns (mask of added vertices, info)."""
    V = np.asarray(mesh.vertices)
    n = len(V)
    cand = [p for p in pieces if 4.0 <= p["area_mm2"] <= 80.0 and p["height_mm"] >= 0.7]
    if radial is not None:
        cand = [p for p in cand if True]
    if len(cand) < 3:
        return np.zeros(n, bool), dict(brackets=len(cand))
    C = np.array([p["centre"] for p in cand])
    c0 = np.asarray(ring_c)[:2] if ring_c is not None else V[:, :2].mean(0)
    ang = np.arctan2(C[:, 0] - c0[0], C[:, 1] - c0[1])            # 0 = anterior, as the arch ring
    order = np.argsort(ang)
    C = C[order]
    # drop a centre that sits well off the line through its neighbours (a turbo, a band, a stray piece)
    good = np.ones(len(C), bool)
    for i in range(1, len(C) - 1):
        mid = 0.5 * (C[i - 1] + C[i + 1])
        if np.linalg.norm(C[i] - mid) > 4.0 and np.linalg.norm(C[i + 1] - C[i - 1]) < 22.0:
            good[i] = False
    C = C[good]
    if len(C) < 3:
        return np.zeros(n, bool), dict(brackets=len(C))
    # Catmull-Rom through the centres, extended a little past the end brackets
    P = np.vstack([C[0] + (C[0] - C[1]) * 0.6, C, C[-1] + (C[-1] - C[-2]) * 0.6])
    pts = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        seg = max(int(np.linalg.norm(p2 - p1) / 0.2), 2)
        for t in np.linspace(0, 1, seg, endpoint=False):
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts = np.array(pts)
    from scipy.spatial import cKDTree
    d = cKDTree(pts).query(V)[0]
    near = (d < 1.4) & ~forbidden
    core = (d < 0.6) & ~forbidden
    # what stands proud near the path (free set = mask + the band round the path)
    add = core | (near & (cs > 0.3))
    # keep it connected to what we already have: pieces of the addition that touch neither the mask nor the core go
    lab = connected_components(add & ~mask, A)
    touch = np.zeros(lab.max() + 1 if lab.max() >= 0 else 0, bool)
    if len(touch):
        nb = (A @ (mask | core).astype(float) > 0)
        for c in np.unique(lab[lab >= 0]):
            m = lab == c
            touch[c] = bool((m & (nb | core)).any())
        add &= ~((lab >= 0) & ~touch[np.clip(lab, 0, None)]) | mask
    added = add & ~mask
    return added, dict(brackets=int(len(C)), added=int(added.sum()), path_mm=round(float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()), 1))


def take_off_appliances(mesh, A, rgb, feats, log=None, passes=2):
    """Detect and remove, then look again: what a bracket leaves behind at its base (a low lip of pad or
    ligature that sat under the first pass's threshold) stands clear of the new smooth enamel and comes
    off on the second pass. Returns (mesh, info, A, feats) - mesh, adjacency and features all for the same (new) mesh when anything was removed."""
    from .features import compute_features
    from .mesh_utils import adjacency
    info = dict(used=False, passes=[])
    total_area = 0.0; pieces = 0
    for k in range(passes):
        thr = 0.35 if k == 0 else 0.25
        mask, dinfo = detect_appliances(mesh, A, rgb, feats=feats, log=log if k == 0 else None, thr=thr)
        if not mask.any():
            break
        if k > 0 and log:
            log(f"second look: {len(dinfo.get('pieces') or [])} small remnant{'s' if len(dinfo.get('pieces') or []) != 1 else ''} ({dinfo.get('area_mm2', 0):.0f} mm2) taken off")
        mesh, rinfo = remove_appliances(mesh, A, mask, log=log if k == 0 else None)
        total_area += float(dinfo.get("area_mm2", 0.0)); pieces += len(dinfo.get("pieces") or [])
        rec = {kk: vv for kk, vv in dinfo.items() if kk not in ("pieces", "bump", "vertices")}
        rec.update(rinfo); rec["pass"] = k + 1; rec["pieces"] = len(dinfo.get("pieces") or [])
        info["passes"].append(rec)
        info.update(used=True, area_mm2=round(total_area, 1), pieces=pieces, vertices=int(sum(p.get("vertices", 0) for p in info["passes"])))
        rgb = mesh.metadata.get("rgb")
        # the mesh changed: adjacency and features go with it (the caller segments on these)
        A = adjacency(mesh)
        feats = compute_features(mesh, return_aux=True)
    return mesh, info, A, feats
