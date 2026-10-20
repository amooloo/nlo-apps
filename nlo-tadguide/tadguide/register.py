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


# ---------------------------------------------------------------- the CBCT target

class Target:
    def __init__(self, pts, nrm):
        self.p = np.asarray(pts, float)
        self.n = np.asarray(nrm, float)
        self.tree = cKDTree(self.p)


def cbct_target(vol, levels, arch, dent=None, step_mm=0.35, progress=None):
    """Tooth-surface points (+ outward normals) around one arch's crowns."""
    dent = dent or V.find_dentition(vol, levels)
    if not dent or not dent.get(arch):
        raise ValueError(f"Could not find the {arch} crowns in the CBCT.")
    a = dent[arch]
    lo, hi = np.array(a["lo"]), np.array(a["hi"])
    sup = np.array([0, 0, 1.0])
    # crowns +-: 8 mm around in the plane, 4 mm toward the occlusal side, 9 mm toward the roots
    occl = -sup if arch == "upper" else sup
    lo2, hi2 = lo - 8, hi + 8
    if arch == "upper":
        lo2[2], hi2[2] = lo[2] - 4, hi[2] + 9
    else:
        lo2[2], hi2[2] = lo[2] - 9, hi[2] + 4
    bb = V.bbox_mm_to_index(vol, lo2, hi2)
    pts, faces, nrm = V.surface(vol, levels["dense"], step_mm=step_mm, bbox=bb, smooth=0.5)
    if len(pts) < 500:
        raise ValueError("The CBCT tooth surface around the crowns is too small to match against.")
    return Target(pts, nrm), dict(arch=arch, centroid=a["centroid"], occlusal=occl.tolist(), bbox=list(bb), dent=dent)


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

def auto_register(vol, levels, verts, faces, arch, priors=(), progress=None, seed=0, target=None):
    """Returns dict(T scan->CBCT mm, stats, method, candidates_tried, target_info)."""
    say = progress or (lambda *_: None)
    t0 = time.time()
    rng = np.random.default_rng(seed)
    tgt, info = target or cbct_target(vol, levels, arch)
    occl = np.array(info["occlusal"])
    ax, conf = scan_axes(verts, faces)
    say(f"scan occlusal axis found (confidence {conf:.2f}); CBCT {arch} crowns at {np.round(info['centroid'], 1).tolist()}")
    cb_c = np.array(info["centroid"])
    cands = []
    # learned starting rotations first (same scanner + arch in earlier cases): dict(R=3x3 scan->CBCT, nsign=+-1)
    for pr in priors or ():
        Rp = np.asarray(pr["R"], float)
        for yaw in (0, -12, 12, -25, 25):
            cands.append(("learned", rodrigues(occl * np.radians(yaw)) @ Rp, float(pr.get("nsign", 1.0))))
    for sgn in (1.0, -1.0):
        R0 = rot_a_to_b(sgn * ax, occl)
        for yaw in range(0, 360, 20):
            cands.append(("search", rodrigues(occl * np.radians(yaw)) @ R0, sgn))
    coarse_n = 2500
    results = []
    tried = 0
    band_cache = {}

    def band_for(R):
        """Crown band seen from the occlusal direction this pose implies (cached per rounded direction)."""
        d = R.T @ occl
        key = tuple(np.round(d, 1))
        if key not in band_cache:
            bv = crown_band(verts, d)
            band_cache[key] = (verts[bv].mean(0), bv[faces].all(axis=1).astype(float))
        return band_cache[key]
    for kind, R, nsign in cands:
        cen, fw = band_for(R)
        p, n = sample_surface(verts, faces, coarse_n, rng, weights=fw + 0.05)
        n = n * nsign
        t = cb_c - R @ cen
        T, st = icp(p, n, tgt, make_T(R, t), schedule=((6.0, 6), (3.0, 6), (1.5, 6)), trim=0.8)
        tried += 1
        results.append((st["inlier_frac"] - 0.2 * min(st["rms"], 2.0), T, st, kind, nsign))
        if kind == "learned" and st["inlier_frac"] > 0.55 and st["rms"] < 0.5:
            break                                   # the learned pose landed: no need to search
    results.sort(key=lambda r: -r[0])
    say(f"{tried} starting poses tried; refining the best {min(3, len(results))}")
    best = None
    for score, T, st, kind, nsign in results[:3]:
        p, n = sample_surface(verts, faces, 9000, rng, weights=band_for(T[:3, :3])[1] + 0.05)
        T2, st2 = icp(p, n * nsign, tgt, T, schedule=((2.0, 10), (1.0, 10), (0.6, 12), (0.4, 15)), trim=0.85)
        sc = st2["inlier_frac"] - 0.3 * min(st2["rms"], 2.0)
        if best is None or sc > best[0]:
            best = (sc, T2, st2, kind, nsign)
    sc, T, st, kind, nsign = best
    say(f"matched: {st['inlier_frac'] * 100:.0f}% of the crown sample within 1 mm, rms {st['rms']:.2f} mm ({time.time() - t0:.1f}s)")
    return dict(T=T, stats=st, method="auto-" + kind, normal_sign=nsign, tried=tried, seconds=round(time.time() - t0, 1),
                target_info={k: v for k, v in info.items() if k != "dent"}, dentition=info.get("dent"))


def refine(vol, levels, verts, faces, arch, T, target=None, seed=1, nsign=1.0):
    tgt, info = target or cbct_target(vol, levels, arch)
    rng = np.random.default_rng(seed)
    ax, _ = scan_axes(verts, faces)
    band_v = crown_band(verts, nsign * ax, depth=9.0)
    fw = band_v[faces].all(axis=1).astype(float) + 0.05
    p, n = sample_surface(verts, faces, 9000, rng, weights=fw)
    T2, st = icp(p, n * nsign, tgt, T, schedule=((2.5, 10), (1.2, 10), (0.6, 12), (0.4, 15)), trim=0.85)
    return dict(T=T2, stats=st, method="refined")


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


def summary(fit, teeth):
    """Numbers for the doctor: on the tooth part of the scan."""
    sel = teeth & np.isfinite(fit)
    if sel.sum() < 50:
        return dict(ok=False, teeth_points=int(sel.sum()), text="Too little of the scan landed on CBCT teeth - match by 3 points.")
    a = np.abs(fit[sel])
    w03 = float((a <= 0.3).mean())
    w05 = float((a <= 0.5).mean())
    med = float(np.median(a))
    level = "good" if (w05 >= 0.85 and med <= 0.2) else ("check" if w05 >= 0.6 else "poor")
    return dict(ok=level != "poor", level=level, median=round(med, 3), within_03=round(w03, 3), within_05=round(w05, 3),
                teeth_points=int(sel.sum()),
                text=f"{w05 * 100:.0f}% of the tooth surface within 0.5 mm of the CBCT (median {med:.2f} mm)")
