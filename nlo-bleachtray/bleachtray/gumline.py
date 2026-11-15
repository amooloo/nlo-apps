"""Sharper gum line and tooth borders on top of the first-pass tooth detection.

Three steps, each optional and each safe to skip (the first-pass labels are returned unchanged if anything fails):

1. refine_gumline - the classifier's tooth mask runs a little past the gum line onto gingiva. Sure-crown seeds (the top
   of each tooth) and sure-gum seeds (outside the mask) are separated by a minimum cut that is cheap along concave
   creases, so the line settles in the gingival sulcus.
2. split_at_creases - the border between two neighbouring teeth settles in the embrasure crease between them.
3. scanner_tooth_mask / add_scanner_map - AS Connect stores its own tooth / gum / other label for every point of a scan
   (storage/cases/<id>/model/<arch>.vertex_type next to <arch>.a3d). Where that file is found for the scan in hand,
   tooth surface the scanner saw and we missed is added to the nearest tooth.

Scored against Titan's own tooth shells on four checked cases (112 teeth): first pass + steps 1-2: 5 teeth under 0.85
overlap, gum line within 0.5 mm on 96.8% of its length; with step 3: 2 teeth under 0.85, 97.4%.
The .a3d / .vertex_type layout was worked out from the files themselves; it is not a published format, so every read is
checked (sizes must add up) and a mismatch simply means "no scanner map".
"""
import os, glob
import numpy as np
import scipy.sparse as sp
import scipy.sparse.csgraph as csg
from scipy.spatial import cKDTree

from .mesh_utils import smooth_field

# typical crown heights (mm) by position from the midline: central, lateral, canine, premolars, molars
CROWN_H = {"upper": [10.5, 9.0, 10.0, 8.0, 7.5, 7.0, 7.0, 7.0], "lower": [9.0, 9.0, 10.5, 8.0, 8.0, 7.0, 7.0, 7.0]}
AS_STORAGE = r"C:\Users\Public\Documents\Alliedstar\Connect\storage\cases"


def _edge_graph(V, A):
    e = sp.triu(A).tocoo()
    i, j = e.row, e.col
    L = np.linalg.norm(V[i] - V[j], axis=1)
    n = len(V)
    return i, j, L, sp.csr_matrix((np.r_[L, L], (np.r_[i, j], np.r_[j, i])), shape=(n, n))


def _min_cut(n, i, j, w, source_side, sink_side, scale=1e4, big=10 ** 7):
    """True for the vertices on the source side of the cheapest cut. scipy only (no extra package)."""
    c = np.maximum((w * scale).astype(np.int64), 1).astype(np.int32)
    s, t = n, n + 1
    src = np.where(source_side)[0]
    snk = np.where(sink_side)[0]
    rows = np.r_[i, j, np.full(len(src), s), snk]
    cols = np.r_[j, i, src, np.full(len(snk), t)]
    caps = np.r_[c, c, np.full(len(src), big), np.full(len(snk), big)].astype(np.int32)
    C = sp.csr_matrix((caps, (rows, cols)), shape=(n + 2, n + 2))
    res = csg.maximum_flow(C, s, t)
    R = C - res.flow          # what is left of every edge after the flow
    R.data = (R.data > 0).astype(np.int8)
    R.eliminate_zeros()
    reach = csg.breadth_first_order(R, s, directed=True, return_predecessors=False)
    out = np.zeros(n + 2, bool)
    out[reach] = True
    return out[:n]


def split_at_creases(V, G, Hs, labels, core_mm=1.3, crease_cost=25.0, k=5.0, h0=0.4):
    """Each tooth keeps its core (well away from any other tooth or gum); the rest of the tooth surface goes to whichever
    core reaches it first when crossing a concave crease is made expensive - so the borders settle in the embrasures."""
    n = len(V)
    tooth = labels > 0
    e = sp.triu(G).tocoo()
    i, j, L = e.row, e.col, e.data
    diff = labels[i] != labels[j]
    edge = np.zeros(n, bool)
    edge[i[diff]] = True
    edge[j[diff]] = True
    if not edge.any():
        return labels
    d = csg.dijkstra(G, indices=np.where(edge)[0], min_only=True, limit=core_mm + 0.5)
    core = tooth & (d >= core_mm)
    src = np.where(core)[0]
    if len(src) == 0:
        return labels
    ok = tooth[i] & tooth[j]
    conc = np.maximum(Hs[i], Hs[j])      # > 0 on a concave crease (convex is negative in this code base)
    w = L * (1.0 + crease_cost / (1.0 + np.exp(-k * (conc - h0))))
    Gt = sp.csr_matrix((np.r_[w[ok], w[ok]], (np.r_[i[ok], j[ok]], np.r_[j[ok], i[ok]])), shape=(n, n))
    _, _, srcs = csg.dijkstra(Gt, indices=src, min_only=True, return_predecessors=True)
    out = labels.copy()
    reach = tooth & (srcs >= 0)
    out[reach] = labels[srcs[reach]]
    return out


def refine_gumline(mesh, labels, info, A, aux, p_tooth, arch, seed_frac=0.45, seed_frac_ant=0.30, k=5.0, h0=0.4, floor=0.03,
                   band_mm=0.8, cap_frac=1.35, seed_p=0.92, erode_mm=1.2, distal_slack=0.5, distal_max=11.8, min_area=40.0,
                   core_mm=1.3, crease_cost=25.0):
    """Returns (labels, info): the gum line cut along the sulcus, tooth borders along the embrasures, scraps dropped."""
    V, F = np.asarray(mesh.vertices), np.asarray(mesh.faces)
    A = A.tocsr()
    Hs = aux["Hs"]
    n = len(V)
    mask = labels > 0
    heights = CROWN_H["lower" if str(arch).startswith("lower") else "upper"]
    i, j, L, G = _edge_graph(V, A)
    # undecided band = the mask plus a thin ring outside it (the mask misses a little tooth on some lowers)
    d_out = csg.dijkstra(G, indices=np.where(mask)[0], min_only=True, limit=band_mm + 0.5)
    cand = d_out <= band_mm
    ps = smooth_field(A, p_tooth, 4)
    d_in = csg.dijkstra(G, indices=np.where(~mask)[0], min_only=True, limit=erode_mm + 0.5)   # depth inside the mask
    seed = np.zeros(n, bool)
    gum = ~cand
    for t, (s, pos) in info.items():
        m = labels == t
        if not m.any():
            continue
        idx = np.where(m)[0]
        z = V[m, 2]
        top = np.percentile(z, 98)
        H = heights[min(int(pos), 8) - 1]
        # front teeth: only the incisal third is a sure crown (their palatal gum stands high)
        seed[idx[z > top - (seed_frac_ant if pos <= 3 else seed_frac) * H]] = True
        gum[idx[z < top - cap_frac * H]] = True     # deeper than any crown: gum
    seed &= ~gum & (ps > seed_p) & (d_in >= erode_mm)
    # behind the last tooth of each side: a second molar is never longer than the molar in front of it plus a little,
    # measured from their contact. Past that is the pad / tuberosity: gum. The back of the allowed length is left
    # undecided so the crease decides where the crown ends.
    cents = {t: V[labels == t][:, :2].mean(0) for t in info if (labels == t).any()}
    for side in (-1, 1):
        seq = [t for pos, t in sorted((pos, t) for t, (sd, pos) in info.items() if sd == side and t in cents)]
        if len(seq) < 3:
            continue
        last, prev = seq[-1], seq[-2]
        d = cents[last] - cents[prev]
        d /= max(np.linalg.norm(d), 1e-6)
        pp = (V[labels == prev][:, :2] - cents[prev]) @ d
        m0 = np.percentile(pp, 97)
        wprev = m0 - np.percentile(pp, 3)
        cap = min(wprev + distal_slack, distal_max)
        proj = (V[:, :2] - cents[prev]) @ d
        lat = np.abs((V[:, :2] - cents[prev]) @ np.array([-d[1], d[0]]))
        zone = (proj > m0 + cap) & (lat < 12.0) & cand
        gum |= zone
        seed &= ~zone
        seed &= ~((labels == last) & (proj > m0 + 0.75 * min(wprev, 10.5)))
    if not seed.any() or not gum.any():
        return labels, info
    conc = np.maximum(Hs[i], Hs[j])
    w = L.mean() * (floor + 1.0 / (1.0 + np.exp(k * (conc - h0))))   # cheap through creases, dear across smooth enamel
    tooth = _min_cut(n, i, j, w, seed, gum & ~seed)
    new = np.where(tooth, labels, 0)
    todo = tooth & (new == 0)
    if todo.any():
        src = np.where(tooth & (new > 0))[0]
        if len(src):
            _, _, srcs = csg.dijkstra(G, indices=src, min_only=True, return_predecessors=True, limit=6.0)
            ok = todo & (srcs >= 0)
            new[ok] = labels[srcs[ok]]
    new = split_at_creases(V, G, Hs, new, core_mm=core_mm, crease_cost=crease_cost)
    # a "tooth" with almost no surface is a scrap of gum (a patch on the tuberosity), not a tooth
    fa = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1) / 2
    fl = new[F]
    fl = np.where(fl[:, 1] == fl[:, 2], fl[:, 1], fl[:, 0])
    info2 = dict(info)
    for t in list(info2):
        if fa[fl == t].sum() < min_area:
            new[new == t] = 0
            info2.pop(t)
    return new, info2


# ---------------------------------------------------------------- AS Connect's own tooth / gum map

def read_a3d(path):
    """AS Connect stored scan: 32-byte header (vertex and face counts at bytes 8-16), xyz float32, rgb float32, faces
    uint32 at the end. Returns (vertices, faces, colours 0-1) or None when the sizes do not add up."""
    a = open(path, "rb").read()
    if len(a) < 32:
        return None
    nv, nf = (int(x) for x in np.frombuffer(a[8:16], np.uint32))
    if nv <= 0 or nf <= 0 or len(a) != 32 + nv * 24 + nf * 12:
        return None
    V = np.frombuffer(a[32:32 + nv * 12], np.float32).reshape(-1, 3).astype(float)
    C = np.frombuffer(a[32 + nv * 12:32 + nv * 24], np.float32).reshape(-1, 3)
    F = np.frombuffer(a[len(a) - nf * 12:], np.uint32).reshape(-1, 3).astype(int)
    return V, F, C


def read_vertex_type(path):
    """One number per vertex: about 2 = tooth, about 1 = gum, about 0 = other (cheek, tongue). None if malformed."""
    v = open(path, "rb").read()
    if len(v) < 24:
        return None
    n = int(np.frombuffer(v[20:24], np.uint32)[0])
    if n <= 0 or len(v) < 24 + 4 * n:
        return None
    return np.frombuffer(v[24:24 + 4 * n], np.float32)


def _a3d_count(path):
    try:
        with open(path, "rb") as f:
            h = f.read(16)
        return int(np.frombuffer(h[8:12], np.uint32)[0]) if len(h) == 16 else -1
    except OSError:
        return -1


def scanner_tooth_mask(raw_vertices, storage=None, tol=0.02, log=None):
    """The scanner's tooth mask for these raw scan points (in the scan's own coordinates), or None. The stored scan of
    the same arch is found by content: same points, wherever the export was saved and whatever it was named."""
    # one folder or several (a list, or one string with ; between them): this PC's own AS Connect storage and, where
    # the office shares them, the storage folders of the other PCs people export from (read only - nothing is written)
    storage = storage or os.environ.get("NLO_AS_STORAGE") or AS_STORAGE
    folders = [f.strip() for f in (storage.split(";") if isinstance(storage, str) else list(storage)) if f and f.strip()]
    if AS_STORAGE not in folders:
        folders.append(AS_STORAGE)
    P = np.asarray(raw_vertices, float)
    probe = P[:: max(1, len(P) // 400)]
    files = []
    for folder in folders:
        try:
            if os.path.isdir(folder):
                files += glob.glob(os.path.join(folder, "*", "model", "*.a3d"))
        except OSError:
            pass          # a shared folder that is switched off or unreachable right now
    if not files:
        return None
    # most recent first: the scan in hand is usually one of the latest cases
    def _when(p):
        try:
            return -os.path.getmtime(p)
        except OSError:
            return 0.0
    files.sort(key=_when)
    for f in files:
        base = os.path.basename(f).lower()
        if base not in ("upper.a3d", "lower.a3d"):
            continue
        nv = _a3d_count(f)
        if nv < 0.6 * len(P) or nv > 4 * len(P):      # (our loader may have thinned a dense scan)
            continue
        vt = f[:-4] + ".vertex_type"
        if not os.path.isfile(vt):
            continue
        try:
            with open(f, "rb") as fh:
                fh.seek(32)
                head = np.frombuffer(fh.read(12 * min(nv, 3000)), np.float32).reshape(-1, 3)
        except OSError:
            continue
        # cheap first look: the stored scan's first points must lie on our scan
        if np.median(cKDTree(P).query(head[::10])[0]) > 1.0:
            continue
        got = read_a3d(f)
        ty = read_vertex_type(vt)
        if got is None or ty is None or len(ty) != len(got[0]):
            continue
        tree = cKDTree(got[0])
        if np.median(tree.query(probe)[0]) > tol:
            continue
        d, idx = tree.query(P)
        if log:
            log(f"scanner's own tooth/gum map found for this scan ({os.path.basename(os.path.dirname(os.path.dirname(f)))[:8]}..., {base[:-4]})")
        return (ty[idx] >= 1.5) & (d < 0.3)
    return None


def add_scanner_map(mesh, labels, scanner_mask, A, reach_mm=2.5, min_verts=400):
    """Tooth surface the scanner marked and we did not is added to the nearest tooth of ours (never further than
    `reach_mm`, so a whole tooth we did not find is not invented here)."""
    from .segment import clean_mask
    V = np.asarray(mesh.vertices)
    m = clean_mask(np.asarray(scanner_mask, bool), A, min_verts=min_verts)
    out = labels.copy()
    add = m & (labels == 0)
    src = np.where(labels > 0)[0]
    if not add.any() or len(src) == 0:
        return out, 0
    d, i = cKDTree(V[src]).query(V[add])
    ok = d < reach_mm
    idx = np.where(add)[0][ok]
    out[idx] = labels[src[i[ok]]]
    return out, int(len(idx))


def same_points(mesh, raw_vertices):
    """True when the mesh in hand is the raw scan point for point, only turned (not a cleaned or rebuilt copy)."""
    Vm, Pr = np.asarray(mesh.vertices), np.asarray(raw_vertices, float)
    if len(Vm) != len(Pr):
        return False
    k = slice(None, None, max(1, len(Pr) // 3000))
    a, b = Pr[k] - Pr[k].mean(0), Vm[k] - Vm[k].mean(0)
    U, _, Vt = np.linalg.svd(a.T @ b)
    R = Vt.T @ np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))]) @ U.T
    return bool(np.median(np.linalg.norm(a @ R.T - b, axis=1)) <= 0.01)


def scanner_outline(mesh, raw_vertices, A, first_mask, storage=None, log=print):
    """Phase I: the scanner's own tooth map as the tooth outline (it stays off the gum in the open spaces of a mixed
    dentition, where the detection does not). Returns the cleaned mask, or None when there is no map for this scan or
    it disagrees wildly with the detection (then the detection stands)."""
    from .segment import clean_mask
    try:
        if raw_vertices is None or not same_points(mesh, raw_vertices):
            return None
        sm = scanner_tooth_mask(raw_vertices, storage=storage, log=log)
        if sm is None:
            return None
        sm = clean_mask(sm, A)
        both = int((sm & first_mask).sum())
        if sm.sum() < 2000 or both < 0.5 * sm.sum() or sm.sum() < 0.4 * first_mask.sum():
            log("scanner's map does not match the detection on this scan - detection kept")
            return None
        return sm
    except Exception as ex:  # noqa
        log(f"scanner map skipped: {ex}")
        return None


def improve(mesh, labels, A, aux, p_tooth, arch, raw_vertices=None, storage=None, use_scanner=True, log=print):
    """First-pass labels in, improved labels out, plus a small report. Never raises: on any problem the labels that
    came in are returned."""
    from .segment import order_teeth, edentulous_gaps, number_by_type
    rep = dict(refined=False, scanner_map=False)
    quiet = lambda *a, **k: None   # noqa
    try:
        info = order_teeth(mesh, labels, aux)[0]
        _, _, info = edentulous_gaps(mesh, labels, info, log=quiet)
        info, _ = number_by_type(mesh, labels, info, "lower" if str(arch).startswith("lower") else "upper", log=quiet)
        new, _ = refine_gumline(mesh, labels, info, A, aux, p_tooth, arch)
        n0, n1 = int((labels > 0).sum()), int((new > 0).sum())
        if len(np.unique(new[new > 0])) >= max(1, len(np.unique(labels[labels > 0])) - 2) and n1 > 0.6 * n0:
            rep.update(refined=True, tooth_points_before=n0, tooth_points_after=n1)
            labels = new
            log(f"gum line refined along the sulcus ({n0 - n1:+d} points left the teeth)" if n1 <= n0 else f"gum line refined along the sulcus ({n1 - n0} points joined the teeth)")
        else:
            log("gum-line refinement changed too much - first-pass detection kept")
    except Exception as ex:  # noqa
        log(f"gum-line refinement skipped: {ex}")
    if use_scanner and raw_vertices is not None and len(raw_vertices) == len(labels):
        try:
            if not same_points(mesh, raw_vertices):
                raise ValueError("the mesh is no longer the scan point for point")
            sm = scanner_tooth_mask(raw_vertices, storage=storage, log=log)
            if sm is not None:
                labels, added = add_scanner_map(mesh, labels, sm, A)
                rep.update(scanner_map=True, scanner_points_added=added)
                log(f"scanner's map added {added} tooth points we had missed")
        except Exception as ex:  # noqa
            log(f"scanner map skipped: {ex}")
    return labels, rep
