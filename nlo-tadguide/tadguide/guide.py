"""The printable tooth-borne TAD guide.

Built as a distance field on a voxel grid in the guide's insertion frame (z = the way the guide comes off the
teeth), then turned into a watertight surface - no fragile mesh booleans:

    tissue    everything under the scan seen from the insertion direction (so undercuts are blocked out),
              raised by the fit gap (teeth) or the relief (gum)
    shell     the band from the tissue surface out to the shell thickness, only over the covered area
    sleeves   a tube per TAD standing off the gum, joined to the shell by a strut
    holes     a straight cylinder along each TAD axis through everything

Fit gap, relief, thickness and the sleeve hole come from the settings - which learn from Dr. A's fit feedback
(lessons.py). The STL comes out in the scan file's own coordinates, so it sits on the printed model / scan.
"""
import time
import numpy as np
from scipy import ndimage as ndi

DEFAULTS = dict(
    gap_teeth=0.10,       # mm between guide and enamel (print fit)
    gap_gum=0.30,         # mm relief over gum
    thickness=2.2,        # mm shell
    hole=3.2,             # mm sleeve hole (passes the TAD head and driver tip)
    sleeve_wall=1.6,      # mm
    sleeve_height=4.0,    # mm
    tissue_gap=0.5,       # mm between the sleeve's bottom and the gum
    voxel=0.2,            # mm
    teeth_each_side=2,    # teeth covered on each side of a TAD (auto coverage)
    tilt_search=True,     # look for an insertion direction that keeps the sleeves out of undercuts
)


def disk(r_mm, v):
    """Round footprint for the grey filters (a square one leaves boxy plateaus)."""
    r = max(1, int(round(r_mm / v)))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r + 0.5


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) + 1e-12)


def frame_for(u):
    """Rotation R with R @ u = +z."""
    z = unit(u)
    x = unit(np.cross([0, 1.0, 0], z)) if abs(z[1]) < 0.9 else unit(np.cross([1.0, 0, 0], z))
    y = np.cross(z, x)
    return np.vstack([x, y, z])


def sample_triangles(V, F, spacing):
    """Points densely covering every triangle (spacing ~ grid voxel / 2), with the triangle index."""
    tri = V[F]
    e = np.max(np.linalg.norm(tri[:, [1, 2, 0]] - tri, axis=2), axis=1)
    nsub = np.clip(np.ceil(e / spacing).astype(int), 1, 40)
    pts, tid = [V], [None]
    out_p, out_t = [], []
    for n in np.unique(nsub):
        sel = np.where(nsub == n)[0]
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        m = (i + j) <= n
        a = (i[m] / n)[:, None]
        b = (j[m] / n)[:, None]
        w = np.hstack([1 - a - b, a, b])                         # (k, 3)
        p = np.einsum("kj,tjd->tkd", w, tri[sel]).reshape(-1, 3)
        out_p.append(p)
        out_t.append(np.repeat(sel, len(w)))
    return np.vstack(out_p), np.concatenate(out_t)


def capped_cylinder_sdf(X, c0, c1, r):
    """SDF of a solid cylinder from c0 to c1 (radius r) at points X (..., 3)."""
    a = c1 - c0
    L = np.linalg.norm(a)
    a = a / L
    d = X - c0
    t = d @ a
    radial = np.linalg.norm(d - t[..., None] * a, axis=-1)
    dx = radial - r
    dy = np.abs(t - L / 2) - L / 2
    return np.minimum(np.maximum(dx, dy), 0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2)


def capsule_sdf(X, p0, p1, r):
    a = p1 - p0
    L2 = max(float(a @ a), 1e-12)
    t = np.clip(((X - p0) @ a) / L2, 0, 1)
    return np.linalg.norm(X - (p0 + t[..., None] * a), axis=-1) - r


def infinite_cylinder_dist(X, c, a):
    a = unit(a)
    d = X - c
    return np.linalg.norm(d - (d @ a)[..., None] * a, axis=-1)


def coverage(P, teeth, tads, arch, params):
    """Which scan vertices the guide covers: teeth around each TAD (auto), plus the gum between those teeth and
    each TAD head so the sleeve has something to stand on."""
    cov = np.zeros(len(P), bool)                 # crowns (by the teeth-each-side rule)
    gum = np.zeros(len(P), bool)                 # what the sleeves stand on: gum corridors, the palate around the heads
    s_all, off = arch.s_of(P)
    W = 8.0                                      # ~ one tooth
    k = params.get("teeth_each_side", 2)
    sides = {("L" if arch.s_of(np.asarray(t["head"], float)[None])[0][0] >= 0 else "R") for t in tads if t["site"] != "palate"}
    if len(sides) == 2:                          # both sides: one piece across the front teeth
        reach = max(abs(float(arch.s_of(np.asarray(t["head"], float)[None])[0][0])) for t in tads if t["site"] != "palate")
        cov |= teeth & (np.abs(s_all) <= reach + W * (k + 0.5))
    for t in tads:
        h = np.asarray(t["head"], float)
        if t["site"] == "palate":
            # palate screws: all teeth from canine to molars both sides + palate around the heads
            cov |= teeth & (np.abs(s_all) >= 12.0)
            gum |= np.linalg.norm(P - h, axis=1) <= 7.0
            continue
        s_h, _ = arch.s_of(h[None])
        s_h = float(s_h[0])
        cov |= teeth & (np.abs(s_all - s_h) <= W * (k + 0.5))
        # gum corridor: from the head toward the crowns, 3 mm wide
        crown = P[teeth & (np.abs(s_all - s_h) <= W)]
        if len(crown):
            near = crown[np.argmin(np.linalg.norm(crown - h, axis=1))]
            seg = near - h
            L2 = float(seg @ seg) or 1.0
            tt = np.clip(((P - h) @ seg) / L2, 0, 1)
            dist = np.linalg.norm(P - (h + tt[:, None] * seg), axis=1)
            gum |= dist <= 3.2
        gum |= np.linalg.norm(P - h, axis=1) <= 4.5
    return cov, gum


def insertion_direction(P, F, tads, n_occ, search=True):
    """The insertion direction: the occlusal direction, tilted (8-22 deg) toward the TAD side if that lets every
    sleeve's gum spot be reached straight on (not hidden under a crown bulge). A spot is hidden when a ray from it
    along the insertion direction hits the scan again. Returns (u, hidden_count, tilt)."""
    import trimesh
    m = trimesh.Trimesh(P, F, process=False)
    cands = [(unit(n_occ), 0.0)]
    if search and tads:
        out = np.zeros(3)
        for t in tads:
            out += -unit(t["dir"])                      # the way the screw comes out of the tissue
        out = out - (out @ n_occ) * n_occ
        if np.linalg.norm(out) > 1e-6 and len({t.get("side") for t in tads}) == 1:
            out = unit(out)
            for deg in (8, 15, 22):
                cands.append((unit(np.cos(np.radians(deg)) * n_occ + np.sin(np.radians(deg)) * out), float(deg)))
    best = None
    for u, deg in cands:
        O = np.array([np.asarray(t["head"], float) - unit(t["dir"]) * 0.4 + u * 0.3 for t in tads])
        D = np.repeat(u[None], len(tads), axis=0)
        hit = m.ray.intersects_any(O, D)
        hidden = int(np.sum(hit))
        key = (hidden, deg)
        if best is None or key < best[0]:
            best = (key, u, hidden, deg)
        if hidden == 0:
            break
    return best[1], best[2], best[3]


def build(P, F, N, teeth, tads, arch, params=None, progress=None, attach=None):
    """One guide for all TADs - or, when TADs on both sides would leave a sleeve in an undercut with a straight
    occlusal seat (brackets, flared crowns), one guide per side, each with its own seating angle.
    attach: bool per scan vertex - the CBCT reads metal just under it (a bracket, the wire, a hook); None = no
    braces known, the arch is treated as bare."""
    say = progress or (lambda *_: None)
    p = dict(DEFAULTS)
    p.update(params or {})
    sides = {}
    for t in tads:
        sides.setdefault("palate" if t["site"] == "palate" else (t.get("side") or "R"), []).append(t)
    if len([k for k in sides if k in ("L", "R")]) == 2 and p.get("split", "auto") != "never" and "palate" not in sides:
        u0, hidden0, _ = insertion_direction(P, F, tads, arch.n, search=False)
        if hidden0 and p.get("tilt_search", True):
            say(f"{hidden0} sleeve spot(s) are under a crown bulge with a straight seat - making one guide per side")
            parts, infos = [], []
            for side in ("R", "L"):
                V1, F1, i1 = _build_one(P, F, N, teeth, sides[side], arch, p, say, attach=attach)
                parts.append((V1, F1))
                i1["side"] = side
                infos.append(i1)
            off = 0
            Vs, Fs = [], []
            for V1, F1 in parts:
                Vs.append(V1); Fs.append(F1 + off); off += len(V1)
            info = dict(infos[0])
            info.update(split=True, per_side=infos, pieces=sum(i["pieces"] for i in infos), watertight=all(i["watertight"] for i in infos),
                        volume_ml=round(sum(i["volume_ml"] for i in infos), 2), faces=int(sum(len(F1) for _, F1 in parts)),
                        hidden_sleeves=sum(i["hidden_sleeves"] for i in infos), tilt_deg=max(i["tilt_deg"] for i in infos),
                        sleeves=[s_ for i in infos for s_ in i["sleeves"]])
            info.pop("warning", None)
            if any(i.get("warning") for i in infos):
                info["warning"] = " / ".join(i["warning"] for i in infos if i.get("warning"))
            return np.vstack(Vs), np.vstack(Fs), info
    return _build_one(P, F, N, teeth, tads, arch, p, say, attach=attach)


def _build_one(P, F, N, teeth, tads, arch, params=None, progress=None, attach=None):
    """Returns dict(vertices, faces (CBCT mm), info) - the guide surface, watertight."""
    say = progress or (lambda *_: None)
    t0 = time.time()
    p = dict(DEFAULTS)
    p.update(params or {})
    v = float(p["voxel"])
    if not tads:
        raise ValueError("Place at least one TAD first.")
    u, hidden, tilt = insertion_direction(P, F, tads, arch.n, search=p["tilt_search"])
    R = frame_for(u)
    say(f"insertion direction: {'occlusal' if tilt == 0 else f'tilted {tilt:.0f} deg toward the TADs'}"
        + (f" - {hidden} sleeve spot(s) sit under a crown bulge" if hidden else ""))
    Q = P @ R.T
    cov_teeth, cov_gum = coverage(P, teeth, tads, arch, p)
    # Braces: brackets, the wire and hooks sit on the crowns but are not 'teeth' to the colour classifier. The
    # guide goes over them, so the crown coverage spreads 2.5 mm along the surface onto what reads metal in the
    # CBCT just under the scan - never onto the gum, and never further apically than the crown it is next to.
    attach = np.zeros(len(P), bool) if attach is None else np.asarray(attach, bool)
    if cov_teeth.any() and (attach & ~teeth).any():
        from scipy.spatial import cKDTree
        h_all = -(P - arch.O) @ arch.n                         # apical distance from the occlusal plane
        src = np.where(cov_teeth)[0]
        cand = np.where(attach & ~teeth)[0]
        dist, j = cKDTree(P[src]).query(P[cand], distance_upper_bound=2.5)
        okj = np.isfinite(dist) & (h_all[cand] <= h_all[src[np.minimum(j, len(src) - 1)]] + 0.3)
        cov_teeth = cov_teeth.copy()
        cov_teeth[cand[okj]] = True
    # gum is covered only down to the TAD heads: the apron needs to reach the sleeve, not the vestibule beyond it
    # (the scan's fold there is thin and noisy, and the shell would wrap it in fins)
    zh = [float((R @ np.asarray(t["head"], float))[2]) for t in tads if t["site"] != "palate"]
    if zh:
        keep = Q[:, 2] >= min(zh) - 1.5
        for t in tads:
            if t["site"] == "palate":
                keep |= np.linalg.norm(P - np.asarray(t["head"], float), axis=1) <= 7.5
        cov_gum &= keep
    cov = cov_teeth | cov_gum
    if cov.sum() < 50:
        raise ValueError("Nothing to rest the guide on near the TADs (no teeth found there).")
    # TADs in the frame
    T_in = []
    for t in tads:
        h = R @ np.asarray(t["head"], float)
        a = R @ unit(t["dir"])
        T_in.append((h, a, t))
    r_out = p["hole"] / 2 + p["sleeve_wall"]
    # grid bounds: covered area + sleeves, with margins
    pts = [Q[cov]]
    for h, a, t in T_in:
        pts.append(np.array([h - a * (p["tissue_gap"] + p["sleeve_height"]) , h]))
    allp = np.vstack(pts)
    m = p["thickness"] + r_out + 2.0
    lo = allp.min(0) - m
    hi = allp.max(0) + m
    lo[2] = Q[cov][:, 2].min() - 2.0
    shape = np.ceil((hi - lo) / v).astype(int) + 1
    nvox = int(np.prod(shape))
    if nvox > 45_000_000:
        v = v * (nvox / 45_000_000) ** (1 / 3)
        shape = np.ceil((hi - lo) / v).astype(int) + 1
        say(f"large guide: grid coarsened to {v:.2f} mm")
    say(f"grid {shape[0]}x{shape[1]}x{shape[2]} at {v:.2f} mm")
    # height map of the whole scan seen along the insertion direction; tooth/gum of the top-most point.
    # Loose bits of the scan far from the guide (a flap, a speck) are left out: only pieces with >= 5 % of the
    # largest's triangles - unless the piece touches the covered area: a wire segment or a bracket scanned as
    # its own piece sits right where the guide goes and must be in the block-out.
    Fk = F
    try:
        import scipy.sparse as sps
        nv = len(Q)
        e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        g = sps.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv))
        ncomp, lab = sps.csgraph.connected_components(g, directed=False)
        if ncomp > 1:
            fl = lab[F[:, 0]]
            cnt = np.bincount(fl, minlength=ncomp)
            touch = np.bincount(lab[cov], minlength=ncomp) > 0
            Fk = F[(cnt[fl] >= 0.05 * cnt.max()) | touch[fl]]
    except Exception:
        Fk = F
    S, tid = sample_triangles(Q, Fk, v * 0.5)
    ij = np.floor((S[:, :2] - lo[:2]) / v + 0.5).astype(int)
    ok = np.all((ij >= 0) & (ij < shape[:2]), axis=1)
    S, tid, ij = S[ok], tid[ok], ij[ok]
    cell = ij[:, 0] * shape[1] + ij[:, 1]
    order = np.lexsort((S[:, 2], cell))
    cell_s = cell[order]
    last = np.r_[cell_s[1:] != cell_s[:-1], True]
    top_cells = cell_s[last]
    top_idx = order[last]
    H = np.full(shape[0] * shape[1], -np.inf)
    H[top_cells] = S[top_idx, 2]
    # Crowns are covered down to their height of contour, not into the undercut below it: a rigid guide cannot
    # engage the undercut, the block-out there only adds bulk, and ending at the bulge is where a tray's edge
    # belongs. (The gum the sleeves stand on is kept whatever lies above it.) A vertex is in the undercut when the
    # scan stands more than 0.6 mm above it in its own column, seen along the insertion direction.
    cq = np.floor((Q[:, :2] - lo[:2]) / v + 0.5).astype(int)
    okq = np.all((cq >= 0) & (cq < shape[:2]), axis=1)
    above = np.full(len(Q), 0.0)
    above[okq] = H[cq[okq, 0] * shape[1] + cq[okq, 1]] - Q[okq, 2]
    under = np.isfinite(above) & (above > 0.6)
    cov = (cov_teeth & ~under) | cov_gum
    say(f"coverage: {int((cov_teeth & ~under).sum())} crown vertices above the height of contour, {int(cov_gum.sum())} on the gum")
    tooth_face = teeth[Fk].mean(axis=1) >= 0.5
    gapmap = np.full(shape[0] * shape[1], p["gap_gum"])
    gapmap[top_cells] = np.where(tooth_face[tid[top_idx]], p["gap_teeth"], p["gap_gum"])
    H = H.reshape(shape[:2])
    gapmap = gapmap.reshape(shape[:2])
    def grey_open(A, win):
        er = ndi.minimum_filter(np.where(np.isfinite(A), A, np.inf), size=win)
        return ndi.maximum_filter(np.where(np.isfinite(er), er, -np.inf), size=win)
    # spikes: a scan flap or stray sheet stands far above its neighbours in a cell or two - the shell would wrap
    # it in a thin tube. A cell more than 1 mm above a 1 mm grey opening of the height map is levelled to the
    # opening - but only when the raised patch is a small blob: an archwire is just as narrow and just as high
    # above the tooth between the brackets, and it is long, and the guide must go over it, not through it.
    valid = np.isfinite(H)
    k = max(3, int(round(0.4 / v)) * 2 + 1)
    if valid.any():
        op = grey_open(H, k)
        with np.errstate(invalid="ignore"):             # -inf - -inf where there is no scan: not a spike
            raised = valid & np.isfinite(op) & (H - op > 0.5)
            high = valid & np.isfinite(op) & (H - op > 1.0)
        spike = np.zeros_like(high)
        if high.any():
            lab, nl = ndi.label(raised)
            blob = np.zeros(nl + 1, bool)
            for i, sl in enumerate(ndi.find_objects(lab)):
                if sl is not None and (sl[0].stop - sl[0].start) * v <= 1.6 and (sl[1].stop - sl[1].start) * v <= 1.6:
                    blob[i + 1] = True
            spike = high & blob[lab]
        if spike.any():
            H[spike] = op[spike]
            say(f"{int(spike.sum())} spike cells in the scan levelled")
    # Braces: what reads metal in the CBCT just under the scan - brackets, the wire, hooks, buttons - is kept in
    # the block-out (the guide goes over it) with 0.5 mm of relief on top and 0.5 mm around, so the guide never
    # bears on it (scans of metal are noisy, and brackets move between scan and surgery).
    valid = np.isfinite(H)
    relief = np.zeros(shape[:2], bool)
    dbg = {}
    stand = np.zeros(shape[:2], np.float32)            # how far an attachment stands off the surface it sits on
    proud = np.zeros(shape[:2], bool)
    if attach.any():
        ca = np.floor((Q[attach][:, :2] - lo[:2]) / v + 0.5).astype(int)
        oka = np.all((ca >= 0) & (ca < shape[:2]), axis=1)
        proud[ca[oka, 0], ca[oka, 1]] = True
        proud &= valid
        proud = ndi.binary_closing(proud, iterations=max(1, int(round(0.4 / v))))
    if proud.any():
        # how far they stand off the crown: the median surface of a 7 mm window is the crown under a bracket
        k3 = int(round(3.5 / v)) * 2 + 1
        med = ndi.median_filter(np.where(valid, H, np.nanmin(H[valid])), size=k3, mode="nearest")
        with np.errstate(invalid="ignore"):
            st = np.where(proud, H - med, 0.0)
        Hd = ndi.maximum_filter(np.where(proud, H, -np.inf), footprint=disk(0.5, v))
        widen = np.isfinite(Hd) & (Hd > np.where(valid, H, -np.inf))
        H = np.where(widen, Hd, H)
        relief = proud | widen
        gapmap[relief] = np.maximum(gapmap[relief], 0.5)
        stand = ndi.maximum_filter(np.where(np.isfinite(st), st, 0.0), footprint=disk(2.0, v)).astype(np.float32)
        say(f"braces / attachments: {int(proud.sum())} cells of metal on the crowns - blocked out with 0.5 mm relief")
    # holes in the height map (the scanner sees nothing under a wire or behind a bracket; steep walls between
    # samples): bridged with the highest valid neighbour within 1.5 mm - never the nearest one, which under a
    # wire is the gum far below and would let the shell drop a pillar into the pit. Beyond that, the nearest
    # within 1 mm anywhere, and without limit under the covered area (an unfilled column under the guide would let
    # the shell run straight down it).
    valid = np.isfinite(H)
    bridged = np.zeros(shape[:2], bool)
    near_att = ndi.binary_dilation(relief, iterations=max(1, int(round(4.0 / v)))) if relief.any() else np.zeros(shape[:2], bool)
    if (~valid).any() and valid.any() and relief.any():
        bridge = ndi.maximum_filter(np.where(valid, H, -np.inf), footprint=disk(1.5, v))
        gb = ndi.maximum_filter(np.where(valid, gapmap, 0.0), footprint=disk(1.5, v))
        fillb = (~valid) & np.isfinite(bridge) & near_att
        H[fillb] = bridge[fillb]
        gapmap[fillb] = np.maximum(gapmap[fillb], gb[fillb])
        bridged = fillb
        valid = np.isfinite(H)
    if (~valid).any() and valid.any():
        # the rest: the nearest valid neighbour - within 1 mm anywhere, without limit under the covered area (a
        # column with no scan under the guide would let the shell run straight down it) and around attachments
        # (an empty column beside a bracket's plateau would make its block-out a wall down to the bottom of the
        # grid, and the shell would wrap that as a tall fin)
        dist, (ii, jj) = ndi.distance_transform_edt(~valid, sampling=v, return_indices=True)
        cm0 = np.zeros(shape[:2], bool)
        cij0 = np.floor((Q[cov][:, :2] - lo[:2]) / v + 0.5).astype(int)
        ok0 = np.all((cij0 >= 0) & (cij0 < shape[:2]), axis=1)
        cm0[cij0[ok0, 0], cij0[ok0, 1]] = True
        cm0 = ndi.binary_dilation(ndi.binary_fill_holes(ndi.binary_closing(cm0, iterations=max(2, int(round(2.0 / v))))), iterations=max(1, int(round(1.5 / v))))
        fill = (~valid) & ((dist <= 1.0) | cm0 | near_att)
        H[fill] = H[ii[fill], jj[fill]]
        gapmap[fill] = gapmap[ii[fill], jj[fill]]
    # narrow pits beside attachments are blocked out: the embrasure under a wire, the gap beside a bracket - a
    # grey closing over 2 mm fills any pit narrower than that up to the level of its rim (within 3 mm of an
    # attachment only, so an arch without braces keeps its fissures). The shell would otherwise drape down into
    # the pit as a thin fin; a rigid guide wants the block-out.
    if relief.any():
        fp = disk(1.0, v)
        Hc = ndi.minimum_filter(ndi.maximum_filter(np.where(np.isfinite(H), H, -np.inf), footprint=fp), footprint=fp)
        with np.errstate(invalid="ignore"):
            raised = np.isfinite(H) & np.isfinite(Hc) & (Hc > H + 0.05) & ndi.binary_dilation(relief, iterations=max(1, int(round(3.0 / v))))
        if raised.any():
            gc = ndi.maximum_filter(gapmap, footprint=fp)
            gapmap[raised] = np.maximum(gapmap[raised], gc[raised])
            H = np.where(raised, Hc, H)
            say(f"{int(raised.sum())} cells of narrow pits blocked out")
    Hg = H + gapmap
    zc = lo[2] + np.arange(shape[2]) * v
    Fm = zc[None, None, :] < Hg[:, :, None]                      # tissue (+ gap), undercuts included
    say("distance field")
    d_out = ndi.distance_transform_edt(~Fm, sampling=v).astype(np.float32)
    d_in = ndi.distance_transform_edt(Fm, sampling=v).astype(np.float32)
    sdF = np.where(Fm, -(d_in - 0.5 * v), d_out - 0.5 * v)
    del d_out, d_in
    vert = zc[None, None, :] - Hg[:, :, None]                    # vertical distance: exact on flat parts
    vert = np.where(np.isfinite(vert), vert, 1e3).astype(np.float32)
    sdF = (np.sign(sdF) * np.minimum(np.abs(sdF), np.abs(vert))).astype(np.float32)
    del vert
    # Coverage in 3D: the shell ends a little beyond the covered part of the scan, cut square to the surface. The
    # cut used to be the 2D coverage boundary carried straight down the insertion direction; on steep walls
    # (the palatal and buccal gingival margins) that wall met the shell at a grazing angle and the ragged
    # projection of the wall made a comb of tall teeth - a serrated edge. A distance to the covered surface
    # itself gives a rounded rim that follows the surface. Covered: the covered scan vertices, and at the
    # attachments the whole top of their block-out with its walls down to the crown they sit on - a bracket's
    # front, the drop beside the wire - so the guide wraps them rather than stopping at their edge.
    cv = np.zeros(shape, bool)
    cijk = np.floor((Q[cov] - lo) / v + 0.5).astype(int)
    okv = np.all((cijk >= 0) & (cijk < np.asarray(shape)), axis=1)
    cv[cijk[okv, 0], cijk[okv, 1], cijk[okv, 2]] = True
    cv = ndi.binary_closing(cv, iterations=max(1, int(round(0.8 / v))))     # tooth / gum flicker at the margin
    cm = np.zeros(shape[:2], bool)
    cm[cijk[okv, 0], cijk[okv, 1]] = True
    cm_src = cm.copy()
    if relief.any():
        att = (relief | (bridged & ndi.binary_dilation(relief, iterations=max(1, int(round(1.5 / v)))))) & np.isfinite(Hg)
        Hmin = ndi.minimum_filter(np.where(np.isfinite(Hg), Hg, np.inf), size=3)
        Hmin = np.maximum(Hmin, Hg - np.clip(stand + 0.3, 1.5, 3.5))
        cv |= att[:, :, None] & (zc[None, None, :] >= (Hmin - v)[:, :, None]) & (zc[None, None, :] <= (Hg + 0.5 * v)[:, :, None])
        cm |= att
    else:
        Hmin = Hg
    d_cov = ndi.distance_transform_edt(~cv, sampling=v).astype(np.float32)
    say("shell")
    th = float(p["thickness"])
    phi = np.maximum(-sdF, sdF - th)
    # the rim: about 1.2 mm beyond the covered surface at the base, a little more at the top so the whole shell
    # stays over the covered area (a voxel at the top of the shell is thickness + gap + a vertex spacing from the
    # nearest covered vertex; the slack keeps the top smooth) - a rounded edge, near enough square to the surface
    phi = np.maximum(phi, d_cov - (1.0 + 0.8 * (np.clip(sdF, 0.0, th) + 0.3)))
    if p.get("_dump"):                                            # debugging aid: the 2D fields and the frame
        np.savez_compressed(p["_dump"], Hg=Hg, H=H, gapmap=gapmap, cm=cm, cm_src=cm_src, relief=relief, bridged=bridged, stand=stand, lo=lo, v=v, R=R, shape=np.asarray(shape), cv=cv, zc=zc, dbg_op3=dbg.get("op3"), dbg_Hmax6=dbg.get("Hmax6"), dbg_proud0=dbg.get("proud0"), dbg_gate=dbg.get("gate"), dbg_H0=dbg.get("H0"))
    if p.get("_probe") is not None:                               # debugging aid: the fields at given CBCT points
        for name, pt in p["_probe"]:
            q = R @ np.asarray(pt, float)
            ijk = np.round((q - lo) / v).astype(int)
            if np.all((ijk >= 0) & (ijk < np.asarray(shape))):
                i, j, kk = ijk
                say(f"probe {name}: z={q[2]:.2f} Hg={Hg[i, j]:.2f} H={H[i, j]:.2f} gap={gapmap[i, j]:.2f} sdF={sdF[i, j, kk]:.2f} d_cov={d_cov[i, j, kk]:.2f} phi={phi[i, j, kk]:.2f} cm={bool(cm[i, j])} src={bool(cm_src[i, j])} relief={bool(relief[i, j])} bridged={bool(bridged[i, j])} cv-col={int(cv[i, j].sum())} Hmin={Hmin[i, j]:.2f}")
    del d_cov, cv
    # sleeves, struts, holes (evaluated on the voxel centres)
    gx = lo[0] + np.arange(shape[0]) * v
    gy = lo[1] + np.arange(shape[1]) * v
    covQ = Q[cov]
    info_sleeves = []
    for h, a, t in T_in:
        top = h - a * (p["tissue_gap"] + p["sleeve_height"])
        bot = h - a * p["tissue_gap"]
        # the struts reach to the nearest covered tooth (in the frame)
        tq = Q[cov & teeth] if (cov & teeth).any() else covQ
        mid = (top + bot) / 2
        near = tq[np.argmin(np.linalg.norm(tq - mid, axis=1))]
        box_lo = np.minimum.reduce([top, bot, near]) - r_out - 2.5
        box_hi = np.maximum.reduce([top, bot, near]) + r_out + 2.5
        i0, i1 = [int(np.clip(np.floor((box_lo[k] - lo[k]) / v), 0, shape[k] - 1)) for k in range(3)], [int(np.clip(np.ceil((box_hi[k] - lo[k]) / v) + 1, 1, shape[k])) for k in range(3)]
        X = np.stack(np.meshgrid(gx[i0[0]:i1[0]], gy[i0[1]:i1[1]], zc[i0[2]:i1[2]], indexing="ij"), axis=-1)
        sl = phi[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]]
        s_sdf = capped_cylinder_sdf(X, bot, top, r_out)
        strut = capsule_sdf(X, mid, near, 1.7)
        sl = np.minimum(sl, np.minimum(s_sdf, strut))
        phi[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]] = sl
        info_sleeves.append(dict(label=t.get("label", ""), stop_mm=round(p["tissue_gap"] + p["sleeve_height"], 2)))
    # nothing inside the tissue
    phi = np.maximum(phi, -sdF)
    # holes: straight through along each axis
    X = None
    for h, a, t in T_in:
        r_h = p["hole"] / 2
        # bounding box of the hole through the grid (only voxels near the axis)
        far = 12.0 + p["sleeve_height"]
        p0, p1 = h - a * far, h + a * 3.0
        box_lo = np.minimum(p0, p1) - r_h - 1
        box_hi = np.maximum(p0, p1) + r_h + 1
        i0 = [int(np.clip(np.floor((box_lo[k] - lo[k]) / v), 0, shape[k] - 1)) for k in range(3)]
        i1 = [int(np.clip(np.ceil((box_hi[k] - lo[k]) / v) + 1, 1, shape[k])) for k in range(3)]
        X = np.stack(np.meshgrid(gx[i0[0]:i1[0]], gy[i0[1]:i1[1]], zc[i0[2]:i1[2]], indexing="ij"), axis=-1)
        dist = infinite_cylinder_dist(X, h, a)
        sl = phi[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]]
        phi[i0[0]:i1[0], i0[1]:i1[1], i0[2]:i1[2]] = np.maximum(sl, r_h - dist)
    del sdF
    phi = ndi.gaussian_filter(phi, 0.5)
    say("surface")
    from skimage import measure
    if phi.min() >= 0:
        raise ValueError("The guide came out empty - check the coverage and the TAD positions.")
    pad = np.pad(-phi, 1, mode="constant", constant_values=-10.0)
    verts, faces, _n, _ = measure.marching_cubes(pad, 0.0, spacing=(v, v, v), gradient_direction="descent")
    verts = verts - v + lo                      # undo the pad, back to frame coordinates
    W = verts @ R                               # frame -> CBCT mm (R orthonormal)
    import trimesh
    mesh = trimesh.Trimesh(W, faces, process=True)
    parts = mesh.split(only_watertight=False)
    if len(parts) > 1:
        big = max(len(q.faces) for q in parts)
        parts = [q for q in parts if len(q.faces) >= 0.05 * big]
        mesh = trimesh.util.concatenate(parts)
    if mesh.volume < 0:
        mesh.invert()
    info = dict(seconds=round(time.time() - t0, 1), voxel=round(v, 3), insertion=u.tolist(), tilt_deg=tilt, hidden_sleeves=hidden,
                pieces=len(parts), watertight=bool(mesh.is_watertight), volume_ml=round(float(abs(mesh.volume)) / 1000, 2),
                faces=int(len(mesh.faces)), sleeves=info_sleeves, params={k: p[k] for k in DEFAULTS})
    if len(parts) > 1:
        info["warning"] = f"The guide came out in {len(parts)} pieces - a sleeve is not connected. Widen the coverage."
    say(f"guide: {len(mesh.faces)} triangles, {info['volume_ml']} mL, watertight {info['watertight']} ({info['seconds']} s)")
    return np.asarray(mesh.vertices), np.asarray(mesh.faces), info


def check_holes(V, F, tads, hole):
    """For each TAD: does a ray along the axis inside the hole radius stay clear of the guide? (min clearance)"""
    import trimesh
    m = trimesh.Trimesh(V, F, process=False)
    out = []
    for t in tads:
        h, a = np.asarray(t["head"], float), unit(t["dir"])
        e1 = unit(np.cross(a, [1, 0, 0] if abs(a[0]) < 0.9 else [0, 1, 0]))
        e2 = np.cross(a, e1)
        origins, dirs = [], []
        for rr in (0.0, hole / 2 - 0.15):
            for ang in np.linspace(0, 2 * np.pi, 8, endpoint=False):
                o = h - a * 20 + rr * (np.cos(ang) * e1 + np.sin(ang) * e2)
                origins.append(o)
                dirs.append(a)
        loc, ri, _ = m.ray.intersects_location(np.array(origins), np.array(dirs))
        blocked = 0
        for k in range(len(origins)):
            d = [np.dot(l - origins[k], dirs[k]) for l, r in zip(loc, ri) if r == k]
            if any(0 < x < 20.0 for x in d):
                blocked += 1
        out.append(dict(label=t.get("label", ""), clear=blocked == 0, blocked_rays=blocked))
    return out
