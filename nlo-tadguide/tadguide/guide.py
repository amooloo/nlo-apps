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


def build(P, F, N, teeth, tads, arch, params=None, progress=None):
    """One guide for all TADs - or, when TADs on both sides would leave a sleeve in an undercut with a straight
    occlusal seat (brackets, flared crowns), one guide per side, each with its own seating angle."""
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
                V1, F1, i1 = _build_one(P, F, N, teeth, sides[side], arch, p, say)
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
    return _build_one(P, F, N, teeth, tads, arch, p, say)


def _build_one(P, F, N, teeth, tads, arch, params=None, progress=None):
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
    # Loose bits of the scan (a flap, a speck) are left out: only pieces with >= 5 % of the largest's triangles.
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
            Fk = F[cnt[fl] >= 0.05 * cnt.max()]
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
    # spikes: a scan flap or stray sheet stands far above its neighbours in a cell or two - the shell would wrap
    # it in a thin tube. Where a cell is more than 1 mm above a 0.4 mm grey opening of the height map (real cusp
    # tips are never that steep at this scale), it takes the opening's value.
    valid = np.isfinite(H)
    k = max(3, int(round(0.4 / v)) * 2 + 1)
    if valid.any():
        er = ndi.minimum_filter(np.where(valid, H, np.inf), size=k)
        op = ndi.maximum_filter(np.where(np.isfinite(er), er, -np.inf), size=k)
        with np.errstate(invalid="ignore"):             # -inf - -inf where there is no scan: not a spike
            spike = valid & np.isfinite(op) & (H - op > 1.0)
        if spike.any():
            H[spike] = op[spike]
            say(f"{int(spike.sum())} spike cells in the scan levelled")
    # holes in the height map (scan holes, steep walls between samples): nearest neighbour - within 1 mm
    # everywhere, and without limit under the covered area (a column with no scan under the guide would let the
    # shell run straight down it)
    valid = np.isfinite(H)
    if (~valid).any() and valid.any():
        dist, (ii, jj) = ndi.distance_transform_edt(~valid, sampling=v, return_indices=True)
        cm0 = np.zeros(shape[:2], bool)
        cij0 = np.floor((Q[cov][:, :2] - lo[:2]) / v + 0.5).astype(int)
        ok0 = np.all((cij0 >= 0) & (cij0 < shape[:2]), axis=1)
        cm0[cij0[ok0, 0], cij0[ok0, 1]] = True
        cm0 = ndi.binary_dilation(ndi.binary_fill_holes(ndi.binary_closing(cm0, iterations=max(2, int(round(2.0 / v))))), iterations=max(1, int(round(1.5 / v))))
        fill = (~valid) & ((dist <= 1.0) | cm0)
        H[fill] = H[ii[fill], jj[fill]]
        gapmap[fill] = gapmap[ii[fill], jj[fill]]
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
    # coverage in 3D: the shell ends a little beyond the covered part of the scan, cut square to the surface. The
    # cut used to be the 2D coverage boundary carried straight down the insertion direction; on steep walls
    # (the palatal and buccal gingival margins) that wall met the shell at a grazing angle and the ragged
    # projection of the wall made a comb of tall teeth - a serrated edge. A distance to the covered surface
    # itself gives a rounded rim that follows the surface.
    cv = np.zeros(shape, bool)
    cijk = np.floor((Q[cov] - lo) / v + 0.5).astype(int)
    okv = np.all((cijk >= 0) & (cijk < np.asarray(shape)), axis=1)
    cv[cijk[okv, 0], cijk[okv, 1], cijk[okv, 2]] = True
    cv = ndi.binary_closing(cv, iterations=max(1, int(round(0.8 / v))))     # tooth / gum flicker at the margin
    d_cov = ndi.distance_transform_edt(~cv, sampling=v).astype(np.float32)
    say("shell")
    th = float(p["thickness"])
    phi = np.maximum(-sdF, sdF - th)
    # the rim: about 1.2 mm beyond the covered surface at the base, a little more at the top so the whole shell
    # stays over the covered area (a voxel at the top of the shell is thickness + gap + a vertex spacing from the
    # nearest covered vertex; the slack keeps the top smooth) - a rounded edge, near enough square to the surface
    phi = np.maximum(phi, d_cov - (1.0 + 0.8 * (np.clip(sdF, 0.0, th) + 0.3)))
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
