"""The ruler on the cephalostat's nasion rod: small radiopaque marks a fixed distance apart. The rod rests on the
patient's nasion, so the marks lie in the midsagittal plane and their spacing gives the pixel size where the
measurements are made - magnification included.

On the office's Carestream ceph the marks that show on the x-ray are 10 mm apart: measured on a 12.8-year-old,
5 mm would make S-N 32 mm and N-Me 54 mm; 10 mm gives 64.9 and 107.2 mm, as iOrtho measured (65.1, 107.5).

find_ruler(grey) finds three or more small bright marks in a near-vertical line, evenly spaced, on the plain bar of
the rod, and measures their spacing to a fraction of a pixel."""
import math

import numpy as np
from PIL import Image, ImageFilter

MARK_MM = 10.0                   # distance between two neighbouring marks, as they show on the x-ray
MM_PER_PX = (0.05, 0.3)          # plausible pixel sizes of a ceph as stored here (up to 4096 px, down to a small export)
MAX_TILT_DEG = 12.0              # the rod is vertical on a lateral ceph
MIN_MARKS = 4                    # marks needed (the rod shows 4 on the office's cephs; 3 beads of a necklace can line up)
WORK = 1600                      # marks are looked for on a copy this size (longest side), measured at full size


def _u8(a):
    return Image.fromarray(np.clip(np.asarray(a, dtype=np.float64), 0, 255).astype(np.uint8))


def _bandpass(a):
    """Dot-sized detail: the bar, the bone and the soft-tissue gradients removed."""
    im = _u8(a)
    small = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float64)
    big = np.asarray(im.filter(ImageFilter.GaussianBlur(8.0)), dtype=np.float64)
    return small - big


def _window_sum(m, r):
    """Sum of m over the (2r + 1)-square round each pixel (summed-area table)."""
    c = np.pad(np.cumsum(np.cumsum(m if m.dtype.kind == "f" else m.astype(np.int64), 0), 1), ((1, 0), (1, 0)))
    H, W = m.shape
    y0 = np.clip(np.arange(H) - r, 0, H)
    y1 = np.clip(np.arange(H) + r + 1, 0, H)
    x0 = np.clip(np.arange(W) - r, 0, W)
    x1 = np.clip(np.arange(W) + r + 1, 0, W)
    return c[y1][:, x1] - c[y0][:, x1] - c[y1][:, x0] + c[y0][:, x0]


def _candidates(g, max_n=3000):
    """Small bright spots standing alone: (positions (x, y), contrast) of the isolated local maxima of the band-pass
    copy, and that copy. Text and bone texture make clusters of maxima; a ruler mark is a single one."""
    bp = _bandpass(g)
    noise = 1.4826 * np.median(np.abs(bp - np.median(bp))) + 1e-6
    thr = max(6.0 * noise, 4.0)
    H, W = bp.shape                                       # ties broken (a flat top is one spot, not two)
    bpt = bp + 1e-3 * (np.arange(H)[:, None] * W + np.arange(W)[None, :]) / (H * W)
    mx = bpt.copy()                                       # 5 x 5 maximum, one axis at a time
    for ax in (0, 1):
        m2 = mx.copy()
        for s in (-2, -1, 1, 2):
            np.maximum(m2, np.roll(mx, s, ax), out=m2)
        mx = m2
    m = (bp > thr) & (bpt >= mx)
    m[:3], m[-3:], m[:, :3], m[:, -3:] = False, False, False, False
    m &= _window_sum(m, 6) == 1                           # no other spot within 6 px (text and texture come in clusters)
    ys, xs = np.nonzero(m)
    if len(xs) > max_n:
        keep = np.argsort(-bp[ys, xs])[:max_n]
        ys, xs = ys[keep], xs[keep]
    # sub-pixel centres: the centroid of the positive band-pass in the 5 x 5 square round each spot
    w = np.clip(bp, 0, None)
    yy, xx = np.mgrid[0:H, 0:W]
    s0 = _window_sum(w, 2)[ys, xs] + 1e-9
    cx = _window_sum(w * xx, 2)[ys, xs] / s0
    cy = _window_sum(w * yy, 2)[ys, xs] / s0
    return np.stack([cx, cy], 1), bp[ys, xs], bp


class _Grid:
    """Candidates bucketed by position, for 'which candidate is within tol of this point?'."""
    def __init__(self, P, cell):
        self.P, self.cell, self.d = P, max(1.0, cell), {}
        for i, (x, y) in enumerate(P):
            self.d.setdefault((int(x // self.cell), int(y // self.cell)), []).append(i)

    def nearest(self, x, y, tol):
        cx, cy = int(x // self.cell), int(y // self.cell)
        best, bd = -1, tol
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for i in self.d.get((gx, gy), ()):
                    dd = math.hypot(self.P[i][0] - x, self.P[i][1] - y)
                    if dd <= bd:
                        best, bd = i, dd
        return best


def _centroid(w, x0, y0):
    w = np.clip(w, 0, None)
    if w.sum() <= 0:
        return None
    yy, xx = np.mgrid[0:w.shape[0], 0:w.shape[1]]
    return float((w * xx).sum() / w.sum() + x0), float((w * yy).sum() / w.sum() + y0)


def _chain(P, grid, i, j, tol_frac=0.03):
    """Marks of the evenly spaced line through candidates i and j (neighbours): [(position in the row, index)] top to
    bottom, or None. Each next mark is looked for where the marks found so far put it; one mark lost in noise
    between two found ones is allowed."""
    step = math.hypot(*(P[j] - P[i]))
    tol = max(2.0, tol_frac * step)
    found = {0: i, 1: j}
    for direction in (1, -1):
        while len(found) < 40:
            ks = sorted(found)
            dd = (P[found[ks[-1]]] - P[found[ks[0]]]) / (ks[-1] - ks[0])
            end = ks[-1] if direction == 1 else ks[0]
            hit = None
            for jump in (1, 2):
                q = P[found[end]] + direction * jump * dd
                n = grid.nearest(q[0], q[1], tol)
                if n >= 0:
                    hit = (end + direction * jump, n)
                    break
            if hit is None or hit[1] in found.values():
                break
            found[hit[0]] = hit[1]
    k0 = min(found)
    return [(k - k0, found[k]) for k in sorted(found)]


def _fit_line(C, ks=None):
    """Spacing along the line through the marks (least squares on each mark's position in the row), the residuals
    along and across it."""
    n = len(C)
    k = np.arange(n, dtype=np.float64) if ks is None else np.asarray(ks, dtype=np.float64)
    mean = C.mean(0)
    _, _, vt = np.linalg.svd(C - mean)
    direction = vt[0] if vt[0][1] >= 0 else -vt[0]
    t = (C - mean) @ direction
    off = (C - mean) @ np.array([-direction[1], direction[0]])
    (spacing, t0), *_ = np.linalg.lstsq(np.stack([k, np.ones(n)], 1), t, rcond=None)
    return float(spacing), t - (k * spacing + t0), off


def _measure(g, bp, P, contrast, chain, lo, hi):
    """Check a chain of marks: regular spacing, one straight line, marks alike, nothing as bright in the gaps, a plain
    bar around them. Returns dict(spacing_px, points, ks, score) or None."""
    ks = [k for k, _ in chain]
    idx = [i for _, i in chain]
    c = contrast[idx]
    if c.min() < 0.4 * c.max():                           # marks alike
        return None
    spacing, resid, off = _fit_line(P[idx], ks)           # cheap first look on the whole-pixel positions
    if not (lo <= spacing <= hi) or np.abs(resid).max() > max(1.5, 0.03 * spacing) or \
            np.abs(off).max() > max(1.5, 0.03 * spacing):
        return None
    C = P[idx]
    n = len(C)
    spacing, resid, off = _fit_line(C, ks)
    if not (lo <= spacing <= hi):
        return None
    if np.abs(resid).max() > max(0.8, 0.025 * spacing) or np.abs(off).max() > max(1.0, 0.03 * spacing):
        return None
    for a in range(n - 1):                                # nothing as bright between the marks: a ruler, not texture
        if ks[a + 1] - ks[a] != 1:
            continue
        for f in (0.33, 0.5, 0.67):
            q = C[a] + f * (C[a + 1] - C[a])
            x, y = int(round(q[0])), int(round(q[1]))
            if 0 <= y < bp.shape[0] and 0 <= x < bp.shape[1]:
                if bp[max(0, y - 2):y + 3, max(0, x - 2):x + 3].max() > 0.5 * c.min():
                    return None
    ring = []                                             # a plain bar round the marks
    r = max(4, int(round(0.25 * spacing)))
    for x, y in C:
        for ang in np.linspace(0, 2 * np.pi, 16, endpoint=False):
            xx, yy = int(round(x + r * math.cos(ang))), int(round(y + r * math.sin(ang)))
            if 0 <= yy < g.shape[0] and 0 <= xx < g.shape[1]:
                ring.append(g[yy, xx])
    ring = np.array(ring)
    if len(ring) < 8 or ring.std() > 0.6 * float(np.median(c)):
        return None
    score = n * 10.0 - float(np.abs(resid).mean()) - float(ring.std()) / (float(np.median(c)) + 1e-6)
    return dict(spacing_px=spacing, points=C, ks=ks, score=score)


def _refine(g, x, y, spacing):
    """A mark's centre at full size: the centroid of the band-pass around the brightest spot near (x, y)."""
    H, W = g.shape
    R = max(8, int(round(0.2 * spacing)))
    x0, y0 = max(0, int(x) - R), max(0, int(y) - R)
    x1, y1 = min(W, int(x) + R + 1), min(H, int(y) + R + 1)
    bp = _bandpass(g[y0:y1, x0:x1])
    j = np.unravel_index(np.argmax(bp), bp.shape)
    r = max(2, int(round(0.04 * spacing)))
    cy, cx = j
    w = bp[max(0, cy - r):cy + r + 1, max(0, cx - r):cx + r + 1]
    c = _centroid(w, max(0, cx - r) + x0, max(0, cy - r) + y0)
    return c if c else (float(x), float(y))


def find_ruler(grey, mark_mm=MARK_MM):
    """The nasion-rod ruler on a lateral ceph. Returns dict(mm_per_px, spacing_px, points [(x, y)], n, mark_mm) or
    None when no ruler is found with confidence."""
    g = np.asarray(grey, dtype=np.float64)
    if g.ndim != 2 or min(g.shape) < 64 or not mark_mm or mark_mm <= 0:
        return None
    H, W = g.shape
    f = min(1.0, WORK / max(H, W))
    gw = g if f == 1.0 else np.asarray(_u8(g).resize((max(1, round(W * f)), max(1, round(H * f))), Image.BILINEAR),
                                       dtype=np.float64)
    lo, hi = mark_mm / MM_PER_PX[1] * f, mark_mm / MM_PER_PX[0] * f      # plausible spacing, working pixels
    P, contrast, bp = _candidates(gw)
    if len(P) < 3:
        return None
    grid = _Grid(P, max(2.0, 0.03 * hi * 1.1))
    tan = math.tan(math.radians(MAX_TILT_DEG))
    found, seen = [], set()
    for i in range(len(P)):
        d = P - P[i]
        ok = (d[:, 1] >= lo * 0.9 * math.cos(math.radians(MAX_TILT_DEG))) & (d[:, 1] <= hi * 1.1) & \
            (np.abs(d[:, 0]) <= tan * d[:, 1])                                        # the next mark: below, near-vertical
        for j in np.nonzero(ok)[0]:
            dist = math.hypot(d[j, 0], d[j, 1])
            if not (lo * 0.9 <= dist <= hi * 1.1):
                continue
            chain = _chain(P, grid, i, j)
            if not chain or len(chain) < MIN_MARKS or chain[0][1] != i:   # each chain once, from its top mark
                continue
            key = tuple(chain)
            if key in seen:
                continue
            seen.add(key)
            res = _measure(gw, bp, P, contrast, chain, lo, hi)
            if res:
                found.append(res)
    for best in sorted(found, key=lambda r: -r["score"])[:3]:     # the best that holds up at full size
        sp_full = best["spacing_px"] / f
        C = np.array([_refine(g, x / f, y / f, sp_full) for x, y in best["points"]])
        spacing, resid, _ = _fit_line(C, best["ks"])
        if np.abs(resid).max() <= max(1.0, 0.03 * spacing):
            return dict(mm_per_px=mark_mm / spacing, spacing_px=round(spacing, 3), n=len(C), mark_mm=mark_mm,
                        points=[(round(float(x), 2), round(float(y), 2)) for x, y in C])
    return None
