"""Bleaching reservoirs: raise the facial surfaces of selected teeth by a smooth, feathered bump."""
import numpy as np
from .mesh_utils import smooth_field
from .segment import geodesic_from_boundary


def _smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# typical anatomic crown lengths (mm, Wheeler), by position from the midline; a facial clinical crown
# much longer than this is exposed root
TYPICAL_CROWN = {"upper": {1: 10.5, 2: 9.0, 3: 10.0, 4: 8.5, 5: 8.5, 6: 7.5, 7: 7.0, 8: 6.5},
                 "lower": {1: 9.0, 2: 9.5, 3: 11.0, 4: 8.5, 5: 8.0, 6: 7.5, 7: 7.0, 8: 6.5}}


def root_exposure(mesh, labels, info, aux, A, arch="upper", max_position=5, strip=0.6, step=0.25, log=None):
    """Per tooth, how much root is showing on the facial side (mm above the gum margin), two ways:

    1. the mid-facial profile: enamel climbs outward from the cervix; an exposed root is a stretch
       right above the margin that runs near-vertical (or inward) for at least 0.75 mm before the
       enamel takes over and climbs clearly faster. The tallest such stretch is the root height;
    2. the clinical crown (cusp tip / incisal edge down to the facial zenith) against the typical
       anatomic crown for that tooth plus 1 mm of natural variation: whatever is longer is root.

    Returns {tooth id: root height mm} for the teeth that get reservoirs (0 = none found), plus a
    detail dict. Erring high is cheap (a slightly smaller reservoir); erring low puts gel on root.
    Checked on 15 scans: 0-2 of 10 reservoir teeth flagged on young orthodontic patients, 7 of 10 on
    an adult with generalised recession.
    """
    V = mesh.vertices; z = V[:, 2]; nrm = mesh.vertex_normals
    out_dir = aux["out_dir"]; n_out = (nrm[:, :2] * out_dir).sum(1)
    e = A.tocoo(); gum_adj = np.zeros(len(V), bool)
    gum_adj[e.row[(labels[e.row] > 0) & (labels[e.col] == 0)]] = True
    typ = TYPICAL_CROWN.get(arch, TYPICAL_CROWN["upper"])
    out, detail = {}, {}
    k = np.array([1, 2, 1]) / 4.0
    for tid, (side, pos) in info.items():
        if pos > max_position:
            continue
        m = labels == tid; fac = m & (n_out > 0.2); fb = m & gum_adj & (n_out > 0.3)
        if fb.sum() < 5 or m.sum() < 50:
            continue
        cen = V[m].mean(0); od = out_dir[m].mean(0); od /= max(np.linalg.norm(od), 1e-9); tg = np.array([-od[1], od[0]])
        s = (V[:, :2] - cen[:2]) @ tg; r = (V[:, :2] - cen[:2]) @ od
        w = V[m, :2] @ tg; tw = np.percentile(w, 97) - np.percentile(w, 3)
        mid = fb & (np.abs(s) < tw / 6)
        zen = np.percentile(z[mid], 5) if mid.sum() >= 3 else np.percentile(z[fb], 5)
        top = float(np.percentile(z[m], 99.5) - zen)
        h_root = 0.0
        st = fac & (np.abs(s) < strip)
        h = z[st] - zen; rr = r[st]
        bins = np.arange(0, max(top - 0.5, step), step)
        prof = np.array([np.median(rr[(h >= b) & (h < b + step)]) if ((h >= b) & (h < b + step)).sum() >= 3 else np.nan for b in bins])
        ok = ~np.isnan(prof)
        if ok.sum() >= 6:
            hb = bins[ok] + step / 2; pr = prof[ok]
            ps = np.convolve(np.pad(pr, 1, mode="edge"), k, mode="valid")
            slope = np.gradient(ps, hb)
            lim = min(4.0, top * 0.6)
            for hc in hb:
                if hc < 0.75 or hc > lim:
                    continue
                rz = (hb >= 0.35) & (hb <= hc - 0.1); ez = (hb >= hc) & (hb <= hc + 1.0)
                if rz.sum() < 2 or ez.sum() < 2:
                    continue
                rs = float(slope[rz].mean()); es = float(slope[ez].mean()); gain = float(ps[ez].max() - ps[rz].min())
                if rs <= 0.15 and slope[rz].max() <= 0.35 and es - rs >= 0.3 and es >= 0.3 and gain >= 0.3:
                    h_root = float(hc)
        h_crown = max(0.0, top - (typ.get(pos, 7.0) + 1.0))
        h = max(h_root, h_crown)
        if h < 0.25:
            h = 0.0
        out[tid] = round(h, 2)
        detail[tid] = dict(side=side, position=pos, crown=round(top, 2), profile=round(h_root, 2), by_length=round(h_crown, 2))
    if log:
        hit = [f"{'L' if detail[t]['side'] < 0 else 'R'}{detail[t]['position']} {out[t]:.1f} mm" for t in out if out[t] > 0]
        log("exposed root on " + ", ".join(hit) if hit else "no exposed root found on the reservoir teeth")
    return out, detail


def _signed_from_mask(mesh, A, mask):
    """Signed surface distance (mm) from the edge of a painted / computed patch: positive outside it, negative inside,
    zero half-way along the edges that cross its border - so the border can be drawn between the vertices."""
    import scipy.sparse.csgraph as csg
    from .segment import _edge_lengths_graph
    mask = np.asarray(mask, bool)
    G = _edge_lengths_graph(mesh, A, np.ones(len(mask), bool))
    d_out = csg.dijkstra(G, directed=False, indices=np.where(mask)[0], min_only=True)
    d_in = csg.dijkstra(G, directed=False, indices=np.where(~mask)[0], min_only=True) if (~mask).any() else np.full(len(mask), 1e3)
    d_out[~np.isfinite(d_out)] = 1e3; d_in[~np.isfinite(d_in)] = 1e3
    return d_out - d_in


def _gum_distance(mesh, A, tooth_mask):
    """Distance (mm, along the tooth surface) from the gum line, on teeth. The gum line runs between the last tooth
    vertex and the first gum vertex, so the count starts half-way along the edges that cross it - not at the tooth
    vertices themselves, which stand anywhere from nothing to a whole triangle above the line (measured from them the
    reservoir's gum-side line took over that staircase)."""
    import scipy.sparse as sp
    import scipy.sparse.csgraph as csg
    n = len(tooth_mask)
    e = mesh.edges_unique
    w = np.linalg.norm(mesh.vertices[e[:, 0]] - mesh.vertices[e[:, 1]], axis=1)
    ta, tb = tooth_mask[e[:, 0]], tooth_mask[e[:, 1]]
    cross = ta != tb
    if not cross.any():
        return np.full(n, np.inf) * tooth_mask
    tv = np.where(ta[cross], e[cross, 0], e[cross, 1])           # the tooth end of every crossing edge
    seed = np.full(n, np.inf); np.minimum.at(seed, tv, 0.5 * w[cross])
    src = np.where(np.isfinite(seed))[0]
    both = ta & tb
    r = np.r_[e[both, 0], e[both, 1], np.full(len(src), n), src]
    c = np.r_[e[both, 1], e[both, 0], src, np.full(len(src), n)]
    G = sp.coo_matrix((np.r_[w[both], w[both], seed[src], seed[src]], (r, c)), shape=(n + 1, n + 1)).tocsr()
    d = csg.dijkstra(G, directed=False, indices=n)[:n]
    d[~tooth_mask] = 0.0
    return d


def _even_out(mesh, A, s, sigma=0.45, free=None):
    """Smooth the edge field by `sigma` mm along the surface (one implicit diffusion step with the cotangent Laplacian:
    it goes by the triangles' real sizes and angles, so an uneven triangulation does not drag the line about the way
    plain neighbour-averaging does). Only the vertices round the outline are solved for (or those of `free`); the
    rest keep their value."""
    import scipy.sparse as sp
    from scipy.sparse.linalg import spsolve
    from .mesh_utils import cot_laplacian
    n = len(s)
    if free is None:
        free = np.abs(s) < EDGE_CLIP - 1e-9
        if not free.any():
            return s
        for _ in range(4):                            # a few rings of the saturated field round them, so the band has room
            free = free | (A @ free.astype(float) > 0)
    elif not np.asarray(free).any():
        return s
    try:
        L, area = cot_laplacian(mesh)
        W = sp.diags(L.diagonal()) - L
        W.data = np.clip(W.data, 0.0, None)           # (an edge with a negative weight - two obtuse corners facing it - is left out)
        L = (sp.diags(np.asarray(W.sum(1)).ravel()) - W).tocsr()
        K = (sp.diags(area) + (0.5 * float(sigma) ** 2) * L).tocsr()
        fi = np.where(free)[0]; bi = np.where(~free)[0]
        rhs = area[fi] * s[fi] - K[fi][:, bi] @ s[bi]
        sol = np.asarray(spsolve(K[fi][:, fi].tocsc(), rhs)).ravel()
        if not np.isfinite(sol).all():
            raise ValueError("solve")
        out = s.copy(); out[fi] = np.clip(sol, -EDGE_CLIP, EDGE_CLIP)
        return out
    except Exception:  # noqa
        return smooth_field(A, s, 6) if A is not None else s


EDGE_CLIP = 1.5       # the edge field is kept within +-this (mm) of the outline: all the bump's profile needs


def reservoir_displacement(mesh, labels, info, aux, A, height=0.5, setback=1.25, feather=1.0,
                           max_position=5, edge_clearance=0.4, edge_feather=0.6, edge_normal_z=0.6,
                           edge_band=0.3, facial_only=True, exclude_occlusal=True, setback_extra=None,
                           keep_off=None, keep_off_clearance=1.0, force_on=None, interprox=None, incisal=None, bite_off=None,
                           edge=0.3, outline_smooth=0.7, return_field=False):
    """Return per-vertex displacement magnitude (mm) along vertex normals.

    labels: per-vertex tooth id (0 = gingiva); info: id -> (side, position from midline)

    The bump covers the facial surface of each selected tooth and stops short of every rim of that
    surface: `setback` mm from the gum line (plus `setback_extra[tooth]` mm where root is exposed),
    and `edge_clearance` mm from the incisal edge / cusp ridges, from the neighbouring teeth
    (interproximal) and from the facial-lingual transition. `keep_off`: boolean per-vertex mask painted by the user (a
    recession, a restoration): no reservoir there nor within `keep_off_clearance` mm of it.
    `interprox`: the reservoir also stops this far (mm, along the surface) short of the neighbouring teeth - the line
    where two crowns meet - so every tooth carries its own island with twice that between two of them (the doctor,
    11/13/2026: "about 1 to 1.5 mm from the gingival margin and the interproximals"); None = `edge_clearance` only.
    `incisal`: the reservoir stops this far short of the incisal edge / the cusp ridges (None = `edge_clearance`): on a
    lower the upper teeth close over the top of the facial faces, so its reservoirs are kept shorter.
    `bite_off`: per-vertex mask of where the opposing teeth come too close (bite_keep_off) - no reservoir there;
    the doctor's own paint (`force_on`) wins over it.
    `force_on`: boolean per-vertex mask painted by the user: a reservoir HERE, on whatever tooth
    (beyond `max_position` too, on the part a recession set-back or a keep-off took away) - still
    `setback` mm off the gum line and `edge_clearance` off the incisal edge; paint on gingiva is ignored.

    The outline (the doctor, 11/19/2026: "the reservoir needs to be smooth all around ... when I cut the trays afterwards
    I want to be able to see that line clearly"): all the limits above are combined into ONE edge field - how far (mm,
    along the surface) a point lies inside the reservoir's outline, negative outside it. The field is smoothed
    (by `outline_smooth` mm along the surface), so the outline is one even curve instead of a staircase along the scan's triangles, and
    the bump rises to its full height within `edge` mm of that outline - a step that shows on the print, not a long
    feathered slope (`feather` / `edge_feather` are no longer used). `return_field` -> (displacement, edge field): the
    field is what refine_reservoir_edge resolves with small triangles.
    """
    n = len(mesh.vertices)
    tooth_mask = labels > 0
    force = None
    if force_on is not None and np.asarray(force_on).any():
        force = np.asarray(force_on, bool) & tooth_mask
        if not force.any():
            force = None
    sel_ids = [tid for tid, (side, pos) in info.items() if pos <= max_position]
    forced_ids = sorted(set(int(t) for t in np.unique(labels[force])) - {0}) if force is not None else []
    only_forced = [t for t in forced_ids if t not in sel_ids]
    sel_ids = sorted(set(sel_ids) | set(forced_ids))
    sel = np.isin(labels, sel_ids)
    if not sel.any():
        return (np.zeros(n), np.full(n, -EDGE_CLIP)) if return_field else np.zeros(n)
    nrm = mesh.vertex_normals
    z = mesh.vertices[:, 2]
    out_dir = aux["out_dir"]
    n_out = (nrm[:, :2] * out_dir).sum(1)
    facial = n_out > 0.05 if facial_only else np.ones(n, bool)
    # incisal edge / cusp zone: what faces up, judged against each tooth's own facial slope - an incisor's
    # face is near vertical, a lower premolar's buccal face leans in and already faces up ~35 deg, so a
    # fixed "faces up" cut would take most of a premolar's face (and leave it a sliver of reservoir).
    # Plus the top band of each tooth (sharp edges have few up-facing vertices, the band catches those).
    edge_zone = np.zeros(n, bool)
    for tid in sel_ids:
        m = labels == tid
        if m.sum() < 10:
            continue
        top = np.percentile(z[m], 99.5)
        edge_zone |= m & (z > top - edge_band) & (nrm[:, 2] > 0.25)
        if exclude_occlusal:
            low = m & (n_out > 0.3) & (z < np.percentile(z[m], 50))      # cervical half of the face: its slope, not the cusp
            fz = float(np.median(nrm[low, 2])) if low.sum() >= 20 else 0.0
            thr = float(np.clip(fz + 0.3, edge_normal_z, 0.92))           # never below the old cut, never the occlusal table itself
            edge_zone |= m & (nrm[:, 2] > thr)
    region = sel & facial & ~edge_zone
    if force is not None:
        # the painted patch itself, wherever it faces; a tooth selected only by paint gets nothing beyond it
        region |= force & ~edge_zone
        if only_forced:
            region &= ~(np.isin(labels, only_forced) & ~force)
    # a tooth label sometimes drags in a patch of gingiva (classifier slip): keep only the main
    # facial patch of each tooth, and nothing clearly below its facial gum line
    from .mesh_utils import connected_components
    e = A.tocoo()
    gum_adjacent = np.zeros(n, bool)
    gum_adjacent[e.row[(labels[e.row] > 0) & (labels[e.col] == 0)]] = True
    for tid in sel_ids:
        m = region & (labels == tid)
        if m.sum() < 10:
            region &= ~m
            continue
        cerv = (labels == tid) & gum_adjacent & (n_out > 0.3)
        if cerv.sum() >= 10:
            z_cerv = np.median(z[cerv])
            region &= ~(m & (z < z_cerv - 1.5))
            m = region & (labels == tid)
        comp = connected_components(m, A)
        if (comp >= 0).any():
            keep = np.argmax(np.bincount(comp[comp >= 0]))
            region &= ~(m & (comp != keep))
    # distance, inside each tooth's own facial field, from its rim (gum line, neighbouring teeth,
    # incisal edge, facial-lingual transition)
    d_rim = np.zeros(n)
    for tid in sel_ids:
        m = region & (labels == tid)
        if m.sum() < 10:
            region &= ~m
            continue
        d = geodesic_from_boundary(mesh, A, m)
        d_rim[m] = d[m]
    d_gum = _gum_distance(mesh, A, tooth_mask)  # distance from the gum line, on teeth
    # distance from the neighbouring teeth (over this tooth and the gum between them)
    d_nb = np.full(n, np.inf)
    if interprox:
        for tid in sel_ids:
            m = region & (labels == tid)
            if m.sum() < 10:
                continue
            d = geodesic_from_boundary(mesh, A, (labels == tid) | (labels == 0))
            d_nb[m] = d[m]
    sb = np.full(n, float(setback))
    for tid, extra in (setback_extra or {}).items():
        if extra and extra > 0:
            sb[labels == tid] += float(extra)
    if force is not None:
        sb[force] = float(setback)             # the paint overrides a recession set-back, never the gum line itself
        if keep_off is not None:
            keep_off = np.asarray(keep_off, bool) & ~force
    # the edge field: the tightest of the limits, each as "mm inside its own line"
    s = np.minimum(d_rim - edge_clearance, d_gum - sb)
    if incisal and float(incisal) > edge_clearance and edge_zone.any():
        d_inc = geodesic_from_boundary(mesh, A, ~edge_zone)      # distance from the incisal edge / cusp zone, outside it
        d_inc[edge_zone] = 0.0
        s = np.minimum(s, d_inc - float(incisal))
    if interprox:
        s = np.minimum(s, np.minimum(d_nb, 1e3) - float(interprox))
    hard_off = ~region
    if bite_off is not None and np.asarray(bite_off).any():
        bo = np.asarray(bite_off, bool)
        if force is not None:
            bo = bo & ~force
        if bo.any():
            s = np.minimum(s, _signed_from_mask(mesh, A, bo))
            hard_off = hard_off | bo
    if keep_off is not None and np.asarray(keep_off).any():
        off = np.asarray(keep_off, bool)
        s = np.minimum(s, _signed_from_mask(mesh, A, off) - keep_off_clearance)     # from the painted patch, outside it
        hard_off = hard_off | off
    s[~region] = -EDGE_CLIP
    s = np.clip(s, -EDGE_CLIP, EDGE_CLIP)
    # one even outline: the distances are measured along the scan's triangle edges and the gum line / the paint follow
    # its vertices, so the raw line wobbles by a triangle; smoothing the field evens it out (the field is clipped to
    # the same reach either side of the outline, so the line is evened where it is, not moved), never onto what is off limits.
    if outline_smooth and float(outline_smooth) > 0:
        s = _even_out(mesh, A, s, sigma=float(outline_smooth))
    s[hard_off] = np.minimum(s[hard_off], -1e-3)
    w = _smoothstep(s / max(float(edge), 1e-6))
    d_out = height * w
    return (d_out, s) if return_field else d_out


def reservoir_profile(s, height, edge=0.3):
    """The bump's height (mm) for an edge-field value: 0 on the outline, full height `edge` mm inside it."""
    return float(height) * _smoothstep(np.asarray(s, float) / max(float(edge), 1e-6))


def refine_edge_band(V, F, s, attrs=(), lo=-0.06, hi=0.36, max_edge=0.08, max_levels=5, max_faces_added=600_000):
    """Small triangles where the reservoir's side wall is: every triangle that the band lo < s < hi passes through is
    split until its edges are no longer than `max_edge` mm (the scan's own triangles are 0.2-0.5 mm on a flat facial
    face - too big to hold a clean 0.3 mm step, the outline printed as a row of facets). Triangles next to a split one
    are divided to match, so the surface stays closed (no T-junctions). New vertices are appended: the first len(V)
    stay what and where they were, so everything indexed by the scan's vertices still applies.
    `attrs`: per-vertex arrays carried to the new vertices (averaged). -> V, F, s, attrs, levels done."""
    V = np.asarray(V, float); F = np.asarray(F, np.int64); s = np.asarray(s, float)
    attrs = [np.asarray(a, float) for a in attrs]
    f0 = len(F); levels = 0
    for _ in range(int(max_levels)):
        fs = s[F]
        band = (fs.min(1) < hi) & (fs.max(1) > lo)
        if not band.any():
            break
        E = np.stack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=1)             # (m, 3, 2)
        L = np.linalg.norm(V[E[:, :, 0]] - V[E[:, :, 1]], axis=2)
        todo = band & (L.max(1) > max_edge)
        if not todo.any() or len(F) + 3 * int(todo.sum()) - f0 > max_faces_added:
            break
        Es = np.sort(E.reshape(-1, 2), axis=1)
        key = Es[:, 0] * np.int64(len(V)) + Es[:, 1]
        uk, eid = np.unique(key, return_inverse=True)
        eid = eid.reshape(-1, 3)
        marked = np.zeros(len(uk), bool)
        marked[eid[todo].ravel()] = True
        while True:                                  # two split edges on a triangle: split its third too (keeps the shapes sound)
            cnt = marked[eid].sum(1)
            two = cnt == 2
            if not two.any():
                break
            marked[eid[two].ravel()] = True
        cnt = marked[eid].sum(1)
        ue = np.column_stack([uk // len(V), uk % len(V)])[marked]
        new_id = np.full(len(uk), -1, np.int64); new_id[marked] = len(V) + np.arange(int(marked.sum()))
        V = np.vstack([V, 0.5 * (V[ue[:, 0]] + V[ue[:, 1]])])
        s = np.concatenate([s, 0.5 * (s[ue[:, 0]] + s[ue[:, 1]])])
        attrs = [np.concatenate([a, 0.5 * (a[ue[:, 0]] + a[ue[:, 1]])]) for a in attrs]
        M = new_id[eid]                              # (m, 3) midpoint of each face edge, -1 = not split
        out = [F[cnt == 0]]
        r = cnt == 3
        if r.any():
            a, b, c = F[r, 0], F[r, 1], F[r, 2]; m0, m1, m2 = M[r, 0], M[r, 1], M[r, 2]
            out += [np.column_stack([a, m0, m2]), np.column_stack([m0, b, m1]), np.column_stack([m2, m1, c]), np.column_stack([m0, m1, m2])]
        for k in range(3):                           # one split edge: the triangle is cut in two through its far corner
            g = (cnt == 1) & (M[:, k] >= 0)
            if g.any():
                a, b, c = F[g, k], F[g, (k + 1) % 3], F[g, (k + 2) % 3]; mm = M[g, k]
                out += [np.column_stack([a, mm, c]), np.column_stack([mm, b, c])]
        F = np.vstack(out)
        levels += 1
    return V, F, s, attrs, levels


def refine_reservoir_edge(mesh_disp, normals, d, s, height, edge=0.3, max_edge=0.1, polish=0.15):
    """The model's surface with the reservoirs' side walls in small triangles.
    `mesh_disp`: the surface with the reservoirs already raised by `d` along `normals` (both per vertex, in that
    mesh's frame); `s`: the edge field from reservoir_displacement. The bump is taken off, the band round the outline
    is subdivided (refine_edge_band) and the bump put back from the field, now resolved on the small triangles.
    The field is then evened once more on the small triangles (`polish` mm): between the scan's vertices it was a
    straight-line blend, so the outline had a corner on every edge of the scan's triangles it crossed - 0.2 to 0.5 mm
    apart on a flat tooth face - and is now one curve.
    -> (trimesh, info). Vertices 0..n-1 are the scan's own, in their order; away from the outline they are exactly
    where they were in `mesh_disp`, on the reservoir's side wall they follow the evened field (hundredths of a mm)."""
    import trimesh
    V = np.asarray(mesh_disp.vertices, float); N = np.asarray(normals, float); d = np.asarray(d, float)
    if len(s) != len(V) or len(N) != len(V) or not (d > 1e-4).any():
        return mesh_disp, dict(refined=False)
    V0 = V - N * d[:, None]
    V1, F1, s1, (N1,), levels = refine_edge_band(V0, np.asarray(mesh_disp.faces), s, attrs=(N,), lo=-0.2 * edge, hi=1.2 * edge, max_edge=max_edge)
    if levels == 0:
        return mesh_disp, dict(refined=False)
    N1 = N1 / np.maximum(np.linalg.norm(N1, axis=1, keepdims=True), 1e-9)
    if polish and polish > 0:
        near = (s1 > -0.25 - 0.2 * edge) & (s1 < 0.25 + 1.2 * edge)
        s1 = _even_out(trimesh.Trimesh(V1, F1, process=False), None, s1, sigma=float(polish), free=near)
        s1[:len(V)][np.asarray(s) <= -1e-3 + 1e-12] = np.minimum(s1[:len(V)], s)[np.asarray(s) <= -1e-3 + 1e-12]   # what was off limits stays off
    d1 = reservoir_profile(s1, height, edge)
    far = np.ones(len(d1), bool); far[:len(V)] = ~((np.asarray(s) > -0.25 - 0.2 * edge) & (np.asarray(s) < 0.25 + 1.2 * edge))
    d1[:len(V)][far[:len(V)]] = d[far[:len(V)]]      # away from the outline the scan's vertices stay exactly where the rest of the work put them
    out = trimesh.Trimesh(V1 + N1 * d1[:, None], F1, process=False)
    return out, dict(refined=True, levels=int(levels), faces_before=int(len(mesh_disp.faces)), faces_after=int(len(F1)), edge_mm=float(max_edge))


def apply_displacement(mesh, d):
    out = mesh.copy()
    out.vertices = mesh.vertices + mesh.vertex_normals * d[:, None]
    return out


def smooth_periphery(mesh, labels, A, start=2.0, full=4.5, iters=30, lam=0.5, mu=-0.52):
    """Taubin-smooth the scan surface away from the teeth: weight 0 up to `start` mm from the gum
    line, 1 from `full` mm on. Removes scanner noise and ragged cheek/lip tissue at the periphery
    while leaving teeth and the gum line exactly as scanned."""
    import scipy.sparse as sp
    from .segment import geodesic_dilate
    import scipy.sparse.csgraph as csg
    from .segment import _edge_lengths_graph
    tooth = labels > 0
    comp = ~tooth
    e = A.tocoo()
    seed = np.zeros(len(tooth), bool)
    seed[e.row[comp[e.row] & tooth[e.col]]] = True
    G = _edge_lengths_graph(mesh, A, comp)
    src = np.where(seed)[0]
    if len(src) == 0:
        return mesh
    d = csg.dijkstra(G, directed=False, indices=src, min_only=True)
    d[tooth] = 0.0
    d[~np.isfinite(d)] = full + 10
    w = _smoothstep((d - start) / max(full - start, 1e-6))
    deg = np.asarray(A.sum(1)).ravel(); deg[deg == 0] = 1
    Dinv = sp.diags(1.0 / deg)
    V = mesh.vertices.copy()
    for _ in range(iters):
        V = V + (w * lam)[:, None] * (Dinv @ (A @ V) - V)
        V = V + (w * mu)[:, None] * (Dinv @ (A @ V) - V)
    out = mesh.copy(); out.vertices = V
    return out


def bite_keep_off(mesh, labels, opposing, clear_mm=1.5, through_mm=0.75):
    """Where the opposing teeth come within `clear_mm` of this arch's teeth: a reservoir there (0.5 mm of bump under a
    tray, the other arch in its own tray) is bitten into (the doctor, 11/13/2026: "check the occlusion making sure the
    patient is not biting into the reservoirs"). `opposing`: the case's other arch in this mesh's frame - the scanners
    export the two in occlusion, but only when a bite scan was taken: an opposing arch that passes more than
    `through_mm` through this one's teeth is not in occlusion with it and is not used.
    -> (mask or None, info)."""
    from scipy.spatial import cKDTree
    V = np.asarray(mesh.vertices, float)
    tooth = np.asarray(labels) > 0
    if opposing is None or not tooth.any():
        return None, dict(checked=False, why="no opposing arch in the case")
    O = np.asarray(opposing.vertices, float)
    ON = np.asarray(opposing.vertex_normals, float)
    lo, hi = V[tooth].min(0) - 6.0, V[tooth].max(0) + 6.0
    near = ((O >= lo) & (O <= hi)).all(1)
    O, ON = O[near], ON[near]
    if len(O) < 200:
        return None, dict(checked=False, why="the opposing arch is nowhere near this one - the two scans are not in occlusion (no bite scan)")
    idx = np.where(tooth)[0]
    d, j = cKDTree(O).query(V[idx])
    # a vertex inside the opposing arch: its nearest point there lies straight behind that surface (p - q along -n_q)
    along = ((V[idx] - O[j]) * ON[j]).sum(1)
    inside = (along < -through_mm) & (along < -0.7 * d)
    if inside.sum() > max(30, 0.003 * len(idx)):
        return None, dict(checked=False, through_mm=round(float(np.percentile(-along[inside], 90)), 1),
                          why="the upper and lower scans are not in occlusion with each other (no bite scan in the case)")
    mask = np.zeros(len(V), bool)
    mask[idx[d < clear_mm]] = True
    return mask, dict(checked=True, clear_mm=float(clear_mm), vertices=int(mask.sum()), closest_mm=round(float(d.min()), 2))
