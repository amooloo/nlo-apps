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
        out[fi] = spsolve(Mff, -Mfb @ V[bi])
    except Exception:
        return harmonic_fill(mesh, A, free)
    return out


def remove_appliances(mesh, A, mask, rings=2, log=None):
    """Take the brackets and wire off: the masked vertices, widened by `rings`, are moved onto a smooth
    continuation of the surrounding enamel (biharmonic, so the crown keeps its convexity). Where the
    wire crossed an embrasure in mid-air this leaves a thin web at wire height between the two teeth -
    the retainer then does not dip into that embrasure, like a black-triangle block-out; the gum line
    and everything the Trimlign cuts along are untouched. Vertex order is kept. Returns (mesh, info)."""
    import trimesh
    mask = np.asarray(mask, bool)
    free = mask.copy()
    for _ in range(rings):
        free |= (A @ free.astype(float) > 0)
    fill = biharmonic_fill(mesh, A, free)
    moved = np.linalg.norm(fill - np.asarray(mesh.vertices), axis=1)
    out = trimesh.Trimesh(fill, mesh.faces, process=False)
    out.metadata = dict(mesh.metadata)
    info = dict(vertices=int(mask.sum()), rebuilt=int(free.sum()), max_depth_mm=round(float(moved[free].max()) if free.any() else 0.0, 2))
    if log:
        log(f"appliances removed: {int(free.sum())} vertices rebuilt as smooth enamel (deepest {info['max_depth_mm']:.1f} mm)")
    return out, info


def bump_height(mesh, A, free):
    """How far each `free` vertex stands above the surface continued smoothly across it (mm, signed
    along the fill's normal)."""
    import trimesh
    fill = harmonic_fill(mesh, A, free)
    fm = trimesh.Trimesh(fill, mesh.faces, process=False)
    h = ((np.asarray(mesh.vertices) - fill) * fm.vertex_normals).sum(1)
    h[~free] = 0.0
    return h


def detect_appliances(mesh, A, rgb, feats=None, log=None, rng_seed=0):
    """Per-vertex appliance mask on a coloured scan. `feats` = the pipeline's geometric feature matrix
    (compute_features), reused when given. Returns (mask, info)."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    n = len(mesh.vertices)
    info = dict(used=False)
    if rgb is None or len(rgb) != n:
        return np.zeros(n, bool), info
    h, s, val = _hsv(rgb)
    # hue distance from the mouth's own colours (pink ... ivory ... yellow, centred near 20 deg)
    dh = np.abs(((h - 20.0) + 180.0) % 360.0 - 180.0)
    off_hue = np.clip((dh - 50.0) / 40.0, 0, 1) * np.clip((s - 0.15) / 0.2, 0, 1)      # cyan / blue / green / purple
    grey = np.clip((0.30 - s) / 0.10, 0, 1) * np.clip((0.84 - val) / 0.12, 0, 1)        # unsaturated (enamel is ivory, s 0.35-0.5; metal 0.1-0.25) and not bright (pale incisal enamel, highlights)
    dark = np.clip((0.55 - val) / 0.15, 0, 1) * np.clip((0.6 - s) / 0.2, 0, 1)           # metal in shadow comes out dark grey-brown; enamel and gum are never that dark except in creases, which lie sunk
    p40, p200 = protrusion(mesh, A)
    colour_score = np.maximum.reduce([off_hue, grey, dark])
    cs = smooth_field(A, colour_score, 2)
    ps = smooth_field(A, np.clip(p200, -2, 3), 2)
    X = [np.cos(np.deg2rad(h)), np.sin(np.deg2rad(h)), s, val, dh / 180.0, smooth_field(A, s, 4), smooth_field(A, val, 4),
         p40, p200, ps, smooth_field(A, p40, 4), np.asarray(mesh.vertex_normals)[:, 2]]
    radial = below = H = None
    if feats is not None:
        F = feats[0] if isinstance(feats, tuple) else feats
        X.append(F)
        if isinstance(feats, tuple) and len(feats) > 1:
            names = list(feats[1])
            if "radial" in names:
                radial = F[:, names.index("radial")]
            if "below_top5" in names:
                below = F[:, names.index("below_top5")]
            if len(feats) > 2 and isinstance(feats[2], dict):
                H = feats[2].get("H")
    if H is None:
        from .mesh_utils import curvatures
        H = np.clip(curvatures(mesh)[0], -5, 5)
    # a bracket is all edges - its body, wings and slot are within a millimetre of a sharp crease;
    # pale enamel below the incisal edge is grey-ish and a little proud too, but smooth
    sharp = smooth_field(A, (np.abs(H) > 1.0).astype(float), 3)
    X.append(sharp)
    # the open edge of the scan (ragged, often grey) is never an appliance
    import trimesh as _tm
    edges = mesh.edges_sorted
    single = _tm.grouping.group_rows(edges, require_count=1)
    on_edge = np.zeros(n, bool)
    if len(single):
        on_edge[np.unique(edges[single])] = True
    near_edge = smooth_field(A, on_edge.astype(float), 12) > 0.02
    # incisal edges and cusps are convex on their own and often pale: not candidates. Only on the teeth
    # themselves - on the palate every point is its own local top, and an expander's arms live there
    top = (below < 1.5) if below is not None else np.zeros(n, bool)
    if radial is not None:
        top &= np.abs(radial) < 7.0
    outside = (radial > 9) if radial is not None else np.zeros(n, bool)      # cheek / lip in the vestibule
    # candidates: anything appliance-coloured or standing a little proud, widened; the surface is then
    # continued smoothly across them from their surroundings and the real bump height measured. A
    # bracket stands 1-2 mm above that surface, a wire ~0.5 mm; pale enamel and shadows do not.
    # (colour only: a free set that also took in every gentle bulge of gum would be continued flat across
    # the whole alveolar process and the process itself would read as a bump)
    cand = (cs > 0.3) & ~top & ~near_edge & ~outside
    # close the candidate region (dilate, then erode) so a bracket whose wings and slot edges have the
    # colour but whose flat faces read as enamel-ish is taken in whole - otherwise its own body would
    # anchor the fill at bracket height and no bump would be measured
    allowed = ~top & ~near_edge & ~outside
    grown = cand.copy()
    for _ in range(7):
        grown |= (A @ grown.astype(float) > 0)
    shrunk = grown.copy()
    for _ in range(7):
        shrunk &= ~((A @ (~shrunk).astype(float)) > 0)
    cand = (cand | shrunk) & allowed
    for _ in range(3):
        cand |= (A @ cand.astype(float) > 0) & allowed
    bump = bump_height(mesh, A, cand)
    core = bump > 0.45
    # second pass: widen round what stood out, so a bracket's base and flash are inside the free set
    cand2 = cand.copy()
    grow = core.copy()
    for _ in range(3):
        grow = (A @ grow.astype(float) > 0) | grow
    cand2 |= grow & ~top & ~near_edge & ~outside
    bump = bump_height(mesh, A, cand2)
    bs = smooth_field(A, bump, 2)
    info["bump_p99"] = round(float(np.percentile(bs, 99.5)), 2)
    # decision: a real bump with an appliance colour or sharp edges; the classifier arbitrates the rest
    pos = (bs > 0.6) & ((cs > 0.35) | (sharp > 0.15))
    neg = (bs < 0.15) | ((cs < 0.08) & (bs < 0.35) & (sharp < 0.05)) | near_edge | top | outside
    neg &= ~pos
    if pos.sum() < 150:
        info["reason"] = f"only {int(pos.sum())} vertices stand proud with an appliance look"
        return np.zeros(n, bool), info
    X.append(bump); X.append(bs)
    X = np.column_stack([x if x.ndim == 2 else x[:, None] for x in X]).astype(np.float32)
    rng = np.random.RandomState(rng_seed)
    ip = np.where(pos)[0]; ineg = np.where(neg)[0]
    ip = rng.choice(ip, min(len(ip), 20000), replace=False); ineg = rng.choice(ineg, min(len(ineg), 40000), replace=False)
    idx = np.r_[ip, ineg]; y = np.r_[np.ones(len(ip)), np.zeros(len(ineg))]
    perm = rng.permutation(len(idx)); idx, y = idx[perm], y[perm]
    k = int(0.8 * len(idx))
    clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, max_leaf_nodes=31, random_state=rng_seed)
    clf.fit(X[idx[:k]], y[:k])
    acc = float((clf.predict(X[idx[k:]]) == y[k:]).mean())
    p = clf.predict_proba(X)[:, 1]
    p = smooth_field(A, p, 3)
    mask = (p > 0.5) & (bs > 0.25) & ~top & ~near_edge & ~outside
    # grow onto the adhesive flash and bracket base: neighbours that still stand proud
    for _ in range(6):
        ring = (A @ mask.astype(float) > 0) & ~mask & (bs > 0.3) & ~top
        if not ring.any():
            break
        mask |= ring
    # pieces: drop specks, describe the rest
    labels = connected_components(mask, A)
    pieces = []
    V = np.asarray(mesh.vertices)
    area_v = np.full(n, 0.0)
    fa = mesh.area_faces / 3.0
    np.add.at(area_v, mesh.faces.ravel(), np.repeat(fa, 3))
    keep = np.zeros(n, bool)
    for c in np.unique(labels[labels >= 0]):
        m = labels == c
        a = float(area_v[m].sum())
        if a < 1.5:
            continue
        # a dark flap of cheek or lip far outside the arch, or a pale incisal edge, is not an appliance
        if radial is not None and float(np.median(radial[m])) > 9.0:
            continue
        if below is not None and float(np.median(below[m])) < 1.0:
            continue
        if float(near_edge[m].mean()) > 0.5:
            continue
        # it has to stand proud: pale, translucent enamel below the incisal edge is grey-ish too, but flat
        hb = float(np.percentile(bs[m], 90))
        if hb < 0.5:
            continue
        keep |= m
        ext = V[m].max(0) - V[m].min(0)
        pieces.append(dict(area_mm2=round(a, 1), height_mm=round(hb, 2), centre=[round(float(x), 2) for x in V[m].mean(0)], extent_mm=[round(float(x), 1) for x in ext], vertices=int(m.sum())))
    info.update(used=True, holdout_acc=round(acc, 3), seeds=dict(appliance=int(pos.sum()), tissue=int(neg.sum())), vertices=int(keep.sum()),
                area_mm2=round(float(area_v[keep].sum()), 1), pieces=sorted(pieces, key=lambda d: -d["area_mm2"]), bump=bs)
    if log:
        log(f"appliances: {len(pieces)} piece{'s' if len(pieces) != 1 else ''}, {info['area_mm2']:.0f} mm2 on {int(keep.sum())} vertices (classifier holdout {acc:.3f})")
    return keep, info
