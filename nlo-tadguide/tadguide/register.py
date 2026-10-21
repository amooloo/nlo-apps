"""Putting the intraoral scan onto the CBCT (rigid), without clicks when possible.

1. Where the crowns are in the CBCT: the densest cluster of enamel, split upper / lower (volume.find_dentition).
2. Target: the CBCT tooth surface (iso-surface at the 'dense' level) around that arch's crowns.
3. Start poses: the scan's occlusal axis turned onto the CBCT's (upper crowns face down, lower face up), every
   20 degrees around it, both ways up (in case the scan file's normals are inside-out), plus the poses learned
   from earlier cases with the same scanner. The scan's crowns are moved onto the CBCT crowns.
4. Each start is refined with ICP that only pairs points whose surfaces face the same way (so an upper scan
   cannot lock onto the lower crowns it bites on), trimmed, point-to-plane. The best fit wins.
3-point matching (click the same three spots on the scan and on the CBCT) is the fallback; ICP refines it.
"""
import time
import numpy as np
from scipy.spatial import cKDTree

from . import volume as V


# ---------------------------------------------------------------- small geometry helpers

def rodrigues(w):
    th = float(np.linalg.norm(w))
    if th < 1e-12:
        return np.eye(3)
    k = w / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def rot_a_to_b(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        if c > 0:
            return np.eye(3)
        p = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
        ax = np.cross(a, p)
        return rodrigues(ax / np.linalg.norm(ax) * np.pi)
    s = np.linalg.norm(v)
    return rodrigues(v / s * np.arctan2(s, c))


def make_T(R, t):
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = t
    return T


def apply(T, p):
    return np.asarray(p, float) @ T[:3, :3].T + T[:3, 3]


def kabsch(src, dst, w=None):
    """Rigid T with T(src) ~ dst (least squares)."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    w = np.ones(len(src)) if w is None else np.asarray(w, float)
    w = w / w.sum()
    cs, cd = (src * w[:, None]).sum(0), (dst * w[:, None]).sum(0)
    H = ((src - cs) * w[:, None]).T @ (dst - cd)
    U, _S, Vt = np.linalg.svd(H)
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    return make_T(R, cd - R @ cs)


def face_normals(v, f):
    n = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    a = np.linalg.norm(n, axis=1)
    return n / np.where(a > 0, a, 1)[:, None], a / 2


def vertex_normals(v, f):
    fn, fa = face_normals(v, f)
    vn = np.zeros_like(v)
    for k in range(3):
        np.add.at(vn, f[:, k], fn * fa[:, None])
    ln = np.linalg.norm(vn, axis=1, keepdims=True)
    return vn / np.where(ln > 0, ln, 1)


def sample_surface(v, f, n, rng, weights=None):
    """Area-weighted random points with face normals; weights (per face) restrict / bias the sampling."""
    fn, fa = face_normals(v, f)
    p = fa if weights is None else fa * weights
    if p.sum() <= 0:
        p = fa
    idx = rng.choice(len(f), size=n, p=p / p.sum())
    r1, r2 = rng.random(n), rng.random(n)
    s = np.sqrt(r1)
    a, b, c = 1 - s, s * (1 - r2), s * r2
    tri = v[f[idx]]
    pts = tri[:, 0] * a[:, None] + tri[:, 1] * b[:, None] + tri[:, 2] * c[:, None]
    return pts, fn[idx]


# ---------------------------------------------------------------- the scan's own frame

def scan_axes(v, f):
    """Occlusal axis of an arch scan (unit, pointing out of the teeth toward the opposing arch), its signed
    confidence, and the per-vertex height along it."""
    fn, fa = face_normals(v, f)
    mean_n = (fn * fa[:, None]).sum(0)
    c = v.mean(0)
    w, U = np.linalg.eigh(np.cov((v - c).T))
    ax = U[:, 0]                                    # least spread = occlusal axis
    conf = float(np.dot(ax, mean_n) / (np.linalg.norm(mean_n) + 1e-9))
    if conf < 0:
        ax, conf = -ax, -conf
    return ax, conf


def crown_band(v, axis, depth=7.0):
    h = (v - v.mean(0)) @ axis
    return h >= h.max() - depth


def _adjacency(nv, f):
    import scipy.sparse as sps
    i = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
    j = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
    A = sps.coo_matrix((np.ones(len(i), np.float32), (i, j)), shape=(nv, nv)).tocsr()
    A.data[:] = 1.0
    return A


def _smooth(A, x, k):
    deg = np.asarray(A.sum(axis=1)).ravel() + 1.0
    for _ in range(k):
        x = (A @ x + x) / deg
    return x


def tooth_by_colour(v, f, col):
    """Teeth vs gum from the scanner's colour (a PLY carries it): teeth are pale and nearly grey, gum and palate
    pink. Each scan sets its own split (Otsu on a pinkness score smoothed over the surface), so lighting and
    scanner do not matter. None when the colour does not split cleanly (a monochrome export)."""
    if col is None or len(col) != len(v):
        return None
    c = np.asarray(col, np.float64)[:, :3]
    s = c.sum(axis=1) + 1.0
    pink = (c[:, 0] - 0.5 * (c[:, 1] + c[:, 2])) / s
    sat = (c.max(axis=1) - c.min(axis=1)) / (c.max(axis=1) + 1.0)
    A = _adjacency(len(v), f)
    x = _smooth(A, pink + 0.5 * sat, 3)
    from skimage.filters import threshold_otsu
    try:
        t = float(threshold_otsu(x))
    except Exception:
        return None
    tooth = x < t
    a, b = x[tooth], x[~tooth]
    if not len(a) or not len(b):
        return None
    sep = (b.mean() - a.mean()) / (np.sqrt(0.5 * (a.var() + b.var())) + 1e-9)
    frac = float(tooth.mean())
    if sep < 1.5 or not 0.08 <= frac <= 0.85:
        return None
    return _smooth(A, tooth.astype(np.float64), 2) > 0.5


def scan_crowns(v, f, col=None):
    """The crowns of the scan, for matching: (vertex mask or None, source, occlusal axis, confidence).
    From colour when the scan has it; otherwise None here and the band nearest the occlusal end is used per pose.
    The axis: least-spread direction of the crowns (or of the whole scan), on the side the surface faces."""
    tooth = tooth_by_colour(v, f, col)
    if tooth is not None and tooth.sum() >= 500:
        p = v[tooth]
        c = p.mean(axis=0)
        _w, U = np.linalg.eigh(np.cov((p - c).T))
        ax = U[:, 0]
        fn, fa = face_normals(v, f)
        ft = tooth[f].all(axis=1)
        mean_n = (fn[ft] * fa[ft, None]).sum(axis=0)
        conf = float(np.dot(ax, mean_n) / (np.linalg.norm(mean_n) + 1e-9))
        if conf < 0:
            ax, conf = -ax, -conf
        return tooth, "colour", ax, conf
    ax, conf = scan_axes(v, f)
    # one round on the band itself: the crowns' own plane is a better occlusal axis than the whole scan's
    band = crown_band(v, ax)
    if band.sum() > 500:
        p = v[band]
        _w, U = np.linalg.eigh(np.cov((p - p.mean(axis=0)).T))
        a2 = U[:, 0] if np.dot(U[:, 0], ax) > 0 else -U[:, 0]
        if np.dot(a2, ax) > np.cos(np.radians(30)):
            ax = a2
    return None, "shape", ax, conf


# ---------------------------------------------------------------- the CBCT target

class Target:
    def __init__(self, pts, nrm):
        self.p = np.asarray(pts, float)
        self.n = np.asarray(nrm, float)
        self.tree = cKDTree(self.p)


def cbct_target(vol, levels, arch, dent=None, step_mm=0.35, progress=None, reach=4.5):
    """The CBCT surface of one arch's crowns (+ outward normals): the tooth-level iso-surface around the crowns,
    kept only within `reach` mm of that arch's enamel and nearer to it than to the other arch's - so the scan's
    gum and palate have no bone to stick to and its crowns cannot take the opposing crowns."""
    dent, groups = V.find_dentition(vol, levels, with_points=True)
    if not dent or not dent.get(arch) or arch not in groups:
        raise ValueError(f"Could not find the {arch} crowns in the CBCT.")
    a = dent[arch]
    E = groups[arch]
    other = groups.get("lower" if arch == "upper" else "upper")
    lo, hi = E.min(axis=0) - (reach + 1.0), E.max(axis=0) + (reach + 1.0)
    bb = V.bbox_mm_to_index(vol, lo, hi)
    pts, faces, nrm = V.surface(vol, levels["dense"], step_mm=step_mm, bbox=bb, smooth=0.5)
    if len(pts):
        d_own, _ = cKDTree(E).query(pts, distance_upper_bound=reach)
        keep = np.isfinite(d_own)
        if other is not None and len(other):
            d_oth, _ = cKDTree(other).query(pts, distance_upper_bound=reach + 2.0)
            keep &= d_own < d_oth
        pts, nrm = pts[keep], nrm[keep]
    if len(pts) < 500:
        raise ValueError("The CBCT tooth surface around the crowns is too small to match against.")
    occl = np.array(a.get("occlusal") or ([0, 0, -1.0] if arch == "upper" else [0, 0, 1.0]))
    return Target(pts, nrm), dict(arch=arch, centroid=pts.mean(axis=0).tolist(), occlusal=occl.tolist(), bbox=list(bb), dent=dent,
                                  tilt_deg=a.get("tilt_deg"))


# ---------------------------------------------------------------- ICP

def icp(src_p, src_n, tgt, T, schedule=((3.0, 8), (1.5, 8), (0.8, 10), (0.5, 12)), trim=0.85, min_dot=0.5, huber=0.3):
    """Normal-compatible, trimmed, point-to-plane ICP. Returns T and stats at the last stage."""
    T = T.copy()
    stats = {}
    for dmax, iters in schedule:
        for _ in range(iters):
            R, t = T[:3, :3], T[:3, 3]
            P = src_p @ R.T + t
            N = src_n @ R.T
            d, idx = tgt.tree.query(P, distance_upper_bound=dmax)
            ok = np.isfinite(d)
            if ok.sum() < 30:
                break
            idx_ok = idx[ok]
            dot = np.einsum("ij,ij->i", N[ok], tgt.n[idx_ok])
            good = dot >= min_dot
            sel = np.where(ok)[0][good]
            if len(sel) < 30:
                break
            dd = d[sel]
            if trim < 1.0 and len(sel) > 50:
                keep = dd <= np.quantile(dd, trim)
                sel = sel[keep]
            Pq = P[sel]
            Q = tgt.p[idx[sel]]
            Nq = tgt.n[idx[sel]]
            r = np.einsum("ij,ij->i", Pq - Q, Nq)
            k = max(huber, dmax / 4)
            w = np.minimum(1.0, k / (np.abs(r) + 1e-9))
            c = Pq.mean(0)
            A = np.hstack([np.cross(Pq - c, Nq), Nq])
            AtW = A.T * w
            x = np.linalg.solve(AtW @ A + 1e-6 * np.eye(6), -AtW @ r)
            Rd = rodrigues(x[:3])
            Rn = Rd @ R
            tn = Rd @ (t - c) + c + x[3:]
            T = make_T(Rn, tn)
            if np.linalg.norm(x[:3]) < 2e-5 and np.linalg.norm(x[3:]) < 2e-4:
                break
        # stats for this stage
        P = src_p @ T[:3, :3].T + T[:3, 3]
        N = src_n @ T[:3, :3].T
        d, idx = tgt.tree.query(P, distance_upper_bound=max(dmax, 1.0))
        ok = np.isfinite(d)
        dot = np.zeros(len(P))
        dot[ok] = np.einsum("ij,ij->i", N[ok], tgt.n[idx[ok]])
        inl = ok & (dot >= min_dot) & (d <= 1.0)
        r = np.zeros(len(P))
        r[ok] = np.einsum("ij,ij->i", P[ok] - tgt.p[idx[ok]], tgt.n[idx[ok]])
        stats = dict(inlier_frac=float(inl.mean()), rms=float(np.sqrt(np.mean(r[inl] ** 2))) if inl.any() else 9.9,
                     mean_abs=float(np.mean(np.abs(r[inl]))) if inl.any() else 9.9, within_03=float((inl & (np.abs(r) <= 0.3)).mean()))
    return T, stats


# ---------------------------------------------------------------- automatic matching

def _crown_weights(verts, faces, crowns, direction):
    """Per-face sampling weight on the scan's crowns: the colour mask, or the band nearest the occlusal end
    of the given direction (scan coordinates) when there is no colour."""
    m = crowns if crowns is not None else crown_band(verts, direction)
    return m[faces].all(axis=1).astype(float), m


def crown_quality(tgt, p, n, T, min_dot=0.5):
    """Fraction of the scan's crown sample within 0.5 / 1.0 mm of the CBCT crowns (facing the same way)."""
    P = apply(T, p)
    N = n @ T[:3, :3].T
    d, idx = tgt.tree.query(P, distance_upper_bound=1.0)
    ok = np.isfinite(d)
    dot = np.zeros(len(P))
    dot[ok] = np.einsum("ij,ij->i", N[ok], tgt.n[idx[ok]])
    ok &= dot >= min_dot
    r = np.full(len(P), np.inf)
    r[ok] = np.abs(np.einsum("ij,ij->i", P[ok] - tgt.p[idx[ok]], tgt.n[idx[ok]]))
    return dict(within_05=float((r <= 0.5).mean()), within_10=float((r <= 1.0).mean()),
                median=float(np.median(r[ok])) if ok.any() else 9.9)


def auto_register(vol, levels, verts, faces, arch, priors=(), progress=None, seed=0, target=None, colors=None):
    """Returns dict(T scan->CBCT mm, stats, method, quality, normal_sign, crowns ('colour' / 'shape'), ...).

    Crowns to crowns only: the scan's crowns (by colour, or the band nearest the occlusal end) onto the CBCT's
    crown surface of that arch. Start poses: the scan's crown plane turned onto the CBCT's (each arch's own
    plane, so a tilted head does not matter), every 15 degrees around it, both ways up and with the surface
    normals both ways (scan files differ), plus the poses learned from earlier cases; each refined by ICP; the
    best few refined further; the winner is the one with the most of the crowns on the CBCT crowns."""
    say = progress or (lambda *_: None)
    t0 = time.time()
    rng = np.random.default_rng(seed)
    tgt, info = target or cbct_target(vol, levels, arch)
    occl = np.array(info["occlusal"])
    crowns, source, ax, conf = scan_crowns(verts, faces, colors)
    say(f"scan crowns from {'the colour' if source == 'colour' else 'the shape'}"
        + (f" ({crowns.mean() * 100:.0f}% of the surface)" if crowns is not None else "")
        + f"; CBCT {arch} crowns at {np.round(info['centroid'], 1).tolist()}"
        + (f", bite plane tilted {info['tilt_deg']:.0f} deg" if info.get("tilt_deg") is not None else ""))
    cb_c = tgt.p.mean(axis=0)
    cands = []
    for pr in priors or ():
        Rp = np.asarray(pr["R"], float)
        for yaw in (0, -12, 12, -25, 25):
            cands.append(("learned", rodrigues(occl * np.radians(yaw)) @ Rp, float(pr.get("nsign", 1.0))))
    for sgn in (1.0, -1.0):
        R0 = rot_a_to_b(sgn * ax, occl)
        for yaw in range(0, 360, 15):
            R = rodrigues(occl * np.radians(yaw)) @ R0
            for ns in (sgn, -sgn):
                cands.append(("search", R, ns))
    cache = {}

    def sample_for(R, n_pts):
        """Crown sample for a pose: the colour mask, or the band seen from the occlusal direction R implies."""
        d = R.T @ occl
        key = (n_pts, None if crowns is not None else tuple(np.round(d, 1)))
        if key not in cache:
            fw, m = _crown_weights(verts, faces, crowns, d)
            p, n = sample_surface(verts, faces, n_pts, rng, weights=fw + 0.02)
            cache[key] = (p, n, verts[m].mean(axis=0) if m.any() else verts.mean(axis=0))
        return cache[key]
    results = []
    tried = 0
    for kind, R, nsign in cands:
        p, n, cen = sample_for(R, 2000)
        T, st = icp(p, n * nsign, tgt, make_T(R, cb_c - R @ cen), schedule=((8.0, 6), (4.0, 6), (2.0, 6)), trim=0.8)
        tried += 1
        results.append((st["inlier_frac"] - 0.2 * min(st["rms"], 2.0), T, st, kind, nsign))
        if kind == "learned" and st["inlier_frac"] > 0.6 and st["rms"] < 0.5:
            break                                   # the learned pose landed: no need to search
    results.sort(key=lambda r: -r[0])
    say(f"{tried} starting poses tried; refining the best {min(4, len(results))}")
    best = None
    for score, T, st, kind, nsign in results[:4]:
        p, n, _c = sample_for(T[:3, :3], 8000)
        T2, st2 = icp(p, n * nsign, tgt, T, schedule=((2.0, 10), (1.0, 10), (0.6, 12), (0.4, 15)), trim=0.85)
        q = crown_quality(tgt, p, n * nsign, T2)
        sc = q["within_10"] + q["within_05"] - 0.2 * min(st2["rms"], 2.0)
        if best is None or sc > best[0]:
            best = (sc, T2, st2, kind, nsign, q)
    sc, T, st, kind, nsign, q = best
    say(f"matched: {q['within_05'] * 100:.0f}% of the scan's crowns within 0.5 mm of the CBCT crowns, "
        f"{q['within_10'] * 100:.0f}% within 1 mm ({time.time() - t0:.1f}s)")
    return dict(T=T, stats=st, quality=q, method="auto-" + kind, normal_sign=nsign, crowns=source, tried=tried,
                seconds=round(time.time() - t0, 1), target_info={k: v for k, v in info.items() if k != "dent"}, dentition=info.get("dent"))


def refine(vol, levels, verts, faces, arch, T, target=None, seed=1, nsign=1.0, colors=None):
    tgt, info = target or cbct_target(vol, levels, arch)
    rng = np.random.default_rng(seed)
    crowns = scan_crowns(verts, faces, colors)[0]
    d = T[:3, :3].T @ np.array(info["occlusal"])          # the occlusal direction as the scan sits now
    fw, _m = _crown_weights(verts, faces, crowns, d)
    p, n = sample_surface(verts, faces, 9000, rng, weights=fw + 0.02)
    T2, st = icp(p, n * nsign, tgt, T, schedule=((2.5, 10), (1.2, 10), (0.6, 12), (0.4, 15)), trim=0.85)
    return dict(T=T2, stats=st, quality=crown_quality(tgt, p, n * nsign, T2), method="refined")


def landmarks(scan_pts, cbct_pts):
    """3+ pairs -> T scan->CBCT (and the residual at each pair)."""
    s, c = np.asarray(scan_pts, float), np.asarray(cbct_pts, float)
    if len(s) < 3 or len(s) != len(c):
        raise ValueError("Click at least 3 matching points on the scan and the same ones on the CBCT.")
    T = kabsch(s, c)
    res = np.linalg.norm(apply(T, s) - c, axis=1)
    return T, res


# ---------------------------------------------------------------- after matching: fit map and tooth / gum

def fit_map(tgt, verts, vnorm, T, max_d=3.0):
    """Signed distance of each scan vertex (moved by T) to the CBCT tooth surface (+ = outside the tooth),
    NaN where no compatible tooth surface is within max_d (gum, palate, brackets)."""
    P = apply(T, verts)
    N = vnorm @ T[:3, :3].T
    d, idx = tgt.tree.query(P, distance_upper_bound=max_d)
    out = np.full(len(P), np.nan)
    ok = np.isfinite(d)
    dot = np.einsum("ij,ij->i", N[ok], tgt.n[idx[ok]])
    s = np.einsum("ij,ij->i", P[ok] - tgt.p[idx[ok]], tgt.n[idx[ok]])
    o = np.where(ok)[0]
    out[o[dot > 0.3]] = s[dot > 0.3]
    return out


def tooth_labels(vol, levels, verts, vnorm, T):
    """True where the scan surface is tooth (enamel / dentin right beneath it in the CBCT), False for gum."""
    P = apply(T, verts)
    N = vnorm @ T[:3, :3].T
    vals = np.maximum.reduce([V.sample(vol, P - N * dd) for dd in (0.4, 0.8, 1.2)])
    return vals >= 0.5 * (levels["dense"] + levels["enamel"]) - 0.25 * (levels["enamel"] - levels["dense"])


def summary(fit, teeth, crowns=None):
    """Numbers for the doctor, on the scan's crowns (colour, or the band nearest the occlusal end): how much of
    them lies on the CBCT crowns - points with no CBCT crown near count as off, so a scan resting on the wrong
    structure cannot score well. Without a crown mask, the part of the scan with tooth under it."""
    base = crowns if crowns is not None and int(crowns.sum()) >= 200 else (teeth & np.isfinite(fit))
    n = int(base.sum())
    if n < 50:
        return dict(ok=False, level="poor", teeth_points=n, within_05=0.0,
                    text="Too little of the scan landed on CBCT teeth - match by 3 points.")
    a = np.abs(fit[base])
    fin = np.isfinite(a)
    w03 = float((a[fin] <= 0.3).sum() / n)
    w05 = float((a[fin] <= 0.5).sum() / n)
    w10 = float((a[fin] <= 1.0).sum() / n)
    med = float(np.median(a[fin])) if fin.any() else 9.9
    level = "good" if (w05 >= 0.6 and med <= 0.25) else ("check" if w10 >= 0.45 else "poor")
    text = f"{w05 * 100:.0f}% of the scan's crowns within 0.5 mm of the CBCT crowns (median {med:.2f} mm)"
    if level == "poor":
        text = f"Only {w10 * 100:.0f}% of the scan's crowns lie on the CBCT crowns - the match is off: match by 3 points."
    return dict(ok=level != "poor", level=level, median=round(med, 3), within_03=round(w03, 3), within_05=round(w05, 3),
                within_10=round(w10, 3), teeth_points=n, text=text)


def crown_mask(verts, faces, colors, T, occlusal):
    """The scan's crowns at pose T: by colour, or the band nearest the occlusal end as the scan sits now."""
    crowns = tooth_by_colour(verts, faces, colors)
    if crowns is not None and crowns.sum() >= 500:
        return crowns
    return crown_band(verts, T[:3, :3].T @ np.asarray(occlusal, float))
