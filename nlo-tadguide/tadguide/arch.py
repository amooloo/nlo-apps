"""The arch, once the scan sits on the CBCT: occlusal plane, the arch curve through the crowns, and where one
tooth ends and the next begins (so a site can be called 'UR 5/6').

Everything is measured on the matched scan in CBCT millimetres. Tooth numbers are 1-8 per quadrant from the
midline (the way the office writes U5/U6). They come from the dips in the crowns' outline at the contacts, fitted
to average tooth widths - a best guess the doctor can shift by one tooth per side in the app.
"""
import numpy as np
from scipy import ndimage as ndi

WIDTHS = {"upper": [8.5, 6.6, 7.6, 7.0, 6.6, 10.2, 9.2, 8.6], "lower": [5.3, 5.9, 6.9, 7.0, 7.1, 11.0, 10.5, 10.0]}


class Arch:
    def __init__(self, arch, O, n_occ, A, L, curve, cum, center2):
        self.arch = arch            # 'upper' / 'lower'
        self.O = O                  # origin on the occlusal plane (mm)
        self.n = n_occ              # unit, points occlusally (toward the opposing arch)
        self.A = A                  # unit, anterior, in the plane
        self.L = L                  # unit, patient left, in the plane
        self.curve = curve          # (K, 2) arch curve in (lateral u, anterior w) plane coordinates
        self.cum = cum              # (K,) arc length, 0 at the midline, + toward patient left
        self.center2 = center2
        self.bounds = {}            # side 'L'/'R' -> list of arc lengths of the boundaries (midline first)
        self.shift = {"L": 0, "R": 0}

    # -- plane coordinates
    def to_plane(self, p):
        d = np.asarray(p, float) - self.O
        return np.column_stack([d @ self.L, d @ self.A, d @ self.n]) if d.ndim == 2 else np.array([d @ self.L, d @ self.A, d @ self.n])

    def from_plane(self, u, w, h=0.0):
        return self.O + u * self.L + w * self.A + h * self.n

    def at(self, s):
        """(point on the curve at the occlusal plane, unit tangent toward +s, unit buccal) in mm."""
        s = float(np.clip(s, self.cum[0], self.cum[-1]))
        u = np.interp(s, self.cum, self.curve[:, 0])
        w = np.interp(s, self.cum, self.curve[:, 1])
        ds = 0.5
        u1, w1 = np.interp(s + ds, self.cum, self.curve[:, 0]), np.interp(s + ds, self.cum, self.curve[:, 1])
        u0, w0 = np.interp(s - ds, self.cum, self.curve[:, 0]), np.interp(s - ds, self.cum, self.curve[:, 1])
        t2 = np.array([u1 - u0, w1 - w0])
        t2 /= np.linalg.norm(t2) + 1e-12
        b2 = np.array([t2[1], -t2[0]])
        c = np.array([u, w])
        if np.dot(b2, c - self.center2) < 0:
            b2 = -b2
        p = self.from_plane(u, w, 0.0)
        tan = t2[0] * self.L + t2[1] * self.A
        buc = b2[0] * self.L + b2[1] * self.A
        return p, tan, buc

    def s_of(self, pts):
        """Arc length of the nearest curve point, and the signed in-plane distance (+ buccal) for points (N,3)."""
        q = self.to_plane(np.atleast_2d(pts))
        d2 = (q[:, None, 0] - self.curve[None, :, 0]) ** 2 + (q[:, None, 1] - self.curve[None, :, 1]) ** 2
        k = np.argmin(d2, axis=1)
        s = self.cum[k]
        c = self.curve[k]
        r_pt = np.linalg.norm(q[:, :2] - self.center2, axis=1)
        r_c = np.linalg.norm(c - self.center2, axis=1)
        return s, np.sign(r_pt - r_c) * np.sqrt(d2[np.arange(len(k)), k])

    def quad(self, side):
        return ("U" if self.arch == "upper" else "L") + side

    def tooth_at(self, s):
        """(quadrant, tooth number) at arc length s, using the detected boundaries."""
        side = "L" if s >= 0 else "R"
        b = self.bounds.get(side) or []
        a = abs(s)
        k = int(np.searchsorted(b, a, side="right"))
        return self.quad(side), int(np.clip(k + self.shift[side], 1, 8))

    def gap(self, side, between):
        """Arc length of the contact between tooth `between` and `between + 1` on a side, or None."""
        b = self.bounds.get(side) or []
        k = between - self.shift[side]
        if 1 <= k < len(b):
            return (b[k] if side == "L" else -b[k])
        return None

    def to_json(self):
        return dict(arch=self.arch, O=self.O.tolist(), n=self.n.tolist(), A=self.A.tolist(), L=self.L.tolist(),
                    bounds=self.bounds, shift=self.shift, s_range=[float(self.cum[0]), float(self.cum[-1])])


def build(arch, P, N, teeth):
    """P, N: matched scan vertices / normals (mm); teeth: bool per vertex (tooth vs gum)."""
    occ0 = np.array([0, 0, -1.0]) if arch == "upper" else np.array([0, 0, 1.0])
    T = P[teeth] if teeth.sum() > 500 else P
    # occlusal plane: fit to the most occlusal crown points
    h = T @ occ0
    top = T[h >= np.percentile(h, 70)]
    c = top.mean(0)
    _w, U = np.linalg.eigh(np.cov((top - c).T))
    n = U[:, 0] if np.dot(U[:, 0], occ0) > 0 else -U[:, 0]
    if np.dot(n, occ0) < 0.7:          # a tilted fit (few teeth): stay with the CBCT's up/down
        n = occ0
    A = np.array([0, -1.0, 0]) - np.dot([0, -1.0, 0], n) * n          # LPS anterior = -y
    A /= np.linalg.norm(A)
    L = np.cross(n, A)
    if L[0] < 0:
        L = -L
    O = T.mean(0)
    O = O - np.dot(O - c, n) * n                                         # onto the occlusal plane
    d = T - O
    u, w = d @ L, d @ A
    # polar profile around a centre inside the U
    cu = float(np.median(u))
    cw = float(w.min() + 0.40 * (w.max() - w.min()))
    th = np.degrees(np.arctan2(u - cu, w - cw))
    r = np.hypot(u - cu, w - cw)
    bins = np.arange(-160, 161, 2.0)
    rad = np.full(len(bins), np.nan)
    for k, b in enumerate(bins):
        sel = np.abs(th - b) < 1.5
        if sel.sum() >= 15:
            rad[k] = np.median(r[sel])
    ok = np.isfinite(rad)
    if ok.sum() < 20:
        raise ValueError("Could not trace the arch on the matched scan.")
    k0, k1 = np.where(ok)[0][[0, -1]]
    bins, rad = bins[k0:k1 + 1], rad[k0:k1 + 1]
    good = np.isfinite(rad)
    rad = np.interp(bins, bins[good], rad[good])
    rad = ndi.median_filter(rad, 5, mode="nearest")
    rad = ndi.gaussian_filter1d(rad, 1.5, mode="nearest")
    cu2 = cu + rad * np.sin(np.radians(bins))
    cw2 = cw + rad * np.cos(np.radians(bins))
    # densify and arc-length (0 at the midline angle 0)
    t = np.linspace(0, 1, len(bins))
    tt = np.linspace(0, 1, 1200)
    cu3, cw3 = np.interp(tt, t, cu2), np.interp(tt, t, cw2)
    bb = np.interp(tt, t, bins)
    seg = np.hypot(np.diff(cu3), np.diff(cw3))
    cum = np.concatenate([[0], np.cumsum(seg)])
    cum -= np.interp(0.0, bb, cum)
    curve = np.column_stack([cu3, cw3])
    if bb[0] > bb[-1]:
        curve, cum = curve[::-1], cum[::-1]
    # +s must run toward patient left (+u)
    if curve[-1, 0] < curve[0, 0]:
        curve, cum = curve[::-1], -cum[::-1]
    a = Arch(arch, O, n, A, L, curve, cum, np.array([cu, cw]))
    _boundaries(a, P, teeth)
    return a


def _boundaries(a, P, teeth, step=0.25):
    """Contacts between teeth: dips of the crowns' occlusal outline along the arch, fitted to average widths."""
    T = P[teeth] if teeth.sum() > 500 else P
    s, off = a.s_of(T)
    q = a.to_plane(T)
    hgt = q[:, 2]
    near = np.abs(off) < 5.0
    s, hgt = s[near], hgt[near]
    grid = np.arange(a.cum[0], a.cum[-1] + step, step)
    prof = np.full(len(grid), np.nan)
    idx = np.clip(np.round((s - grid[0]) / step).astype(int), 0, len(grid) - 1)
    order = np.argsort(idx)
    idx_s, h_s = idx[order], hgt[order]
    starts = np.searchsorted(idx_s, np.arange(len(grid)))
    ends = np.searchsorted(idx_s, np.arange(len(grid)), side="right")
    for k in range(len(grid)):
        if ends[k] - starts[k] >= 3:
            prof[k] = np.percentile(h_s[starts[k]:ends[k]], 90)
    good = np.isfinite(prof)
    if good.sum() < 10:
        return
    prof = np.interp(grid, grid[good], prof[good])
    prof = ndi.gaussian_filter1d(prof, 0.6 / step)
    widths = WIDTHS[a.arch]
    for side, sg in (("L", 1), ("R", -1)):
        gs = grid * sg
        sel = gs >= -2.0
        g, p = gs[sel], prof[sel]
        order = np.argsort(g)
        g, p = g[order], p[order]
        # candidate dips with their depth below the neighbouring maxima within +-3 mm
        cand = []
        win = int(3.0 / step)
        for i in range(1, len(g) - 1):
            if p[i] <= p[i - 1] and p[i] <= p[i + 1]:
                lo, hi = max(0, i - win), min(len(g), i + win + 1)
                depth = min(p[lo:i].max(initial=p[i]), p[i + 1:hi].max(initial=p[i])) - p[i]
                if depth > 0.15:
                    cand.append((g[i], depth))
        if not cand:
            a.bounds[side] = [0.0]
            continue
        cs = np.array([c[0] for c in cand])
        cd = np.array([c[1] for c in cand])
        # midline: the dip nearest 0 within 3 mm (else 0)
        m0 = 0.0
        near0 = np.where(np.abs(cs) <= 3.0)[0]
        if len(near0):
            m0 = float(cs[near0[np.argmax(cd[near0] - 0.2 * np.abs(cs[near0]))]])
        # greedy-with-lookahead DP: each next contact about one tooth width further on
        bounds = [m0]
        cur = m0
        for k in range(8):
            w = widths[k]
            lo, hi = cur + 0.62 * w, cur + 1.42 * w
            opts = np.where((cs > lo) & (cs < hi))[0]
            if not len(opts):
                if cur + w <= g.max() - 1.0:
                    cur = cur + w
                    bounds.append(cur)
                    continue
                break
            score = cd[opts] - 0.35 * np.abs(cs[opts] - cur - w) / w * 3
            j = opts[int(np.argmax(score))]
            cur = float(cs[j])
            bounds.append(cur)
            if cur >= g.max() - 1.0:
                break
        a.bounds[side] = [float(abs(b)) if side == "L" else float(abs(b)) for b in bounds]
