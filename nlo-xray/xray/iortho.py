"""Importing a tracing made in iOrtho (iCeph): the doctor's past tracings become lessons for this app.

What goes in, for one patient:
  - the original ceph (the case's own image),
  - iOrtho's traced image (the x-ray with iOrtho's coloured tracing: red dots on the landmarks),
  - iOrtho's Excel report (the measurements iOrtho calculated from those dots).

What happens (all on this PC):
  1. the report is read (`read_report`);
  2. the red landmark dots are found on the traced image (`find_dots`);
  3. the traced image is laid over the original x-ray (`register`: scale and shift, found by normalised
     cross-correlation, iOrtho's coloured overlay left out of the comparison);
  4. the dots are named (`match`): this app's average tracing is fitted to the dot cloud, every landmark gets
     the dots near where it should be as candidates, and a search picks the combination that reproduces
     iOrtho's own numbers - SNA, SNB, U1-SN, FMA, IMPA, the saddle and gonial angles, the lips to the E-line
     and so on. A point that reproduces iOrtho's values is *verified*; one no value pins down is taken from
     the nearest dot and left for the doctor to check.

iOrtho does not trace the vertebrae, so an imported x-ray has no C2-C4 points.
"""
import io
import math
import re

import numpy as np
from PIL import Image

from . import geometry as g
from .landmarks import CODES, TEMPLATE

# the landmarks iOrtho traces too (everything but the vertebrae); MOL and PM are midpoints of cusp dots
DOT_CODES = ["S", "N", "A", "B", "ANS", "PNS", "U1T", "U1A", "L1T", "L1A", "Po", "Or", "Go", "Gn", "Pog", "MPt",
             "Me", "Ar", "Prn", "Pos", "Ls", "Li", "Sn"]
PAIR_CODES = ["MOL", "PM"]
# iOrtho dots the premolar cusps too; the app no longer traces a premolar point (its occlusal plane runs from the
# molars to the incisors, like iOrtho's), but the pair is still found so that its dots are not mistaken for others
_TPL = dict(TEMPLATE, PM=(50.2, -65.5))


class ImportError_(Exception):
    pass


# --------------------------------------------------------------------------------------------- the report

def _norm(s):
    s = str(s or "").lower().replace("（", "(").replace("）", ")")
    return re.sub(r"\s+", "", s)


def _date(v):
    """iOrtho writes MM-DD-YYYY (sometimes MM-YYYY)."""
    s = str(v or "").strip()
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", s)
    if m:
        return f"{int(m[3]):04d}-{int(m[1]):02d}-{int(m[2]):02d}"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    return m.group(0) if m else None


def read_report(data):
    """iOrtho's Excel report -> dict(patient=..., values={normalised name: value})."""
    try:
        import openpyxl
    except ImportError:  # pragma: no cover
        raise ImportError_("Reading Excel files needs the openpyxl component - run the update line once.")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as ex:
        raise ImportError_(f"That is not an Excel report this app can read ({ex.__class__.__name__}).")
    patient, values = {}, {}
    for ws in wb.worksheets:
        rows = [r for r in ws.iter_rows(values_only=True) if any(v is not None for v in r)]
        if not rows:
            continue
        if _norm(ws.title) == "patientinfo" and len(rows) >= 3:
            head = [_norm(h) for h in rows[1]]
            vals = rows[2]
            get = lambda k: vals[head.index(k)] if k in head and head.index(k) < len(vals) else None  # noqa: E731
            patient = dict(name=str(get("name") or "").strip(), sex=(str(get("gender") or "").strip()[:1].upper() or None),
                           dob=_date(get("dateofbirth")), taken=_date(get("x-rayfilmingdate")))
            continue
        for r in rows:
            if len(r) >= 4 and isinstance(r[3], (int, float)) and r[0]:
                values.setdefault(_norm(r[0]), float(r[3]))
    wb.close()
    if not values:
        raise ImportError_("The Excel file has no iOrtho measurements in it.")
    return dict(patient=patient, values=values)


def _value(values, *names):
    for n in names:
        v = values.get(_norm(n))
        if v is not None:
            return v
    return None


# --------------------------------------------------------------------------------------------- the dots

def _components(mask):
    """Connected components (8-neighbour) of a sparse boolean mask: list of (ys, xs) arrays."""
    ys, xs = np.nonzero(mask)
    todo = set(zip(ys.tolist(), xs.tolist()))
    out = []
    while todo:
        seed = todo.pop()
        stack, comp = [seed], [seed]
        while stack:
            y, x = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    q = (y + dy, x + dx)
                    if q in todo:
                        todo.remove(q)
                        stack.append(q)
                        comp.append(q)
        a = np.array(comp)
        out.append((a[:, 0], a[:, 1]))
    return out


def red_mask(rgb):
    r, gr, b = (rgb[..., i].astype(np.int16) for i in range(3))
    return (r > 170) & (gr < 100) & (b < 100) & (r - gr > 90)


def _outline(ys, xs):
    """The blob as a small mask (with its corner) and its outline pixels (x, y) in image coordinates."""
    y0, x0 = int(ys.min()) - 1, int(xs.min()) - 1
    m = np.zeros((int(ys.max()) - y0 + 2, int(xs.max()) - x0 + 2), bool)
    m[ys - y0, xs - x0] = True
    inner = m.copy()
    inner[1:-1, 1:-1] &= m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
    by, bx = np.nonzero(m & ~inner)
    return m, (y0, x0), np.stack([bx + x0, by + y0], 1).astype(np.float64)


def _fit_circles(B, C, rb, iters=8):
    """Centres C (k, 2) of circles of radius rb through the outline points B, by Gauss-Newton; each point belongs to
    the circle it lies closest to."""
    C = C.copy()
    for _ in range(iters):
        d = np.hypot(*(B[:, None, :] - C[None]).transpose(2, 0, 1))          # (n, k)
        lab = np.abs(d - rb).argmin(1)
        for j in range(len(C)):
            q = B[lab == j]
            if len(q) < 4:
                continue
            v = C[j] - q
            r = np.hypot(v[:, 0], v[:, 1]) + 1e-9
            J = v / r[:, None]
            step, *_ = np.linalg.lstsq(J, -(r - rb), rcond=None)
            C[j] += step
    return C


def _split(ys, xs, k, r, rb):
    """k touching or overlapping dots drawn as one blob. Each dot keeps an intact outer arc: circles of the dots'
    known radius are voted for by the outline (Hough), then fitted to it. Returns (centres, how well they explain
    the blob: intersection over union)."""
    m, (y0, x0), B = _outline(ys, xs)
    h, w = m.shape
    gy, gx = np.mgrid[0:h:0.5, 0:w:0.5]
    cand = np.stack([gx.ravel() + x0, gy.ravel() + y0], 1)
    inside = m[(cand[:, 1] - y0).round().astype(int).clip(0, h - 1), (cand[:, 0] - x0).round().astype(int).clip(0, w - 1)]
    cand = cand[inside]
    d = np.hypot(*(cand[:, None, :] - B[None]).transpose(2, 0, 1))
    votes = (np.abs(d - rb) < 0.75).sum(1).astype(float)
    C = []
    for _ in range(k):
        i = int(np.argmax(votes))
        C.append(cand[i])
        votes[np.hypot(*(cand - cand[i]).T) < 0.8 * r] = -1
    C = _fit_circles(B, np.array(C), rb)
    yy, xx = np.mgrid[0:h, 0:w]
    model = np.zeros((h, w), bool)
    for cx, cy in C:
        model |= np.hypot(xx + x0 - cx, yy + y0 - cy) <= r
    iou = (model & m).sum() / max(1, (model | m).sum())
    return [tuple(c) for c in C], float(iou)


def find_dots(rgb):
    """Centres of iOrtho's red landmark dots, image pixels (x, y), with their typical size (pixels)."""
    comps = [c for c in _components(red_mask(rgb)) if len(c[0]) >= 6]
    if not comps:
        return np.zeros((0, 2)), 0
    sizes = np.array([len(c[0]) for c in comps])
    med = float(np.median(sizes))
    r = math.sqrt(med / math.pi)
    # the outline's radius, measured on the round single dots
    rbs = []
    for ys, xs in comps:
        if 0.8 * med <= len(ys) <= 1.2 * med:
            _, _, B = _outline(ys, xs)
            rbs.append(np.hypot(B[:, 0] - xs.mean(), B[:, 1] - ys.mean()).mean())
    rb = float(np.median(rbs)) if rbs else r - 0.5
    # how red each pixel is: 1 inside a dot, the covered fraction on its smoothed edge (whatever the grey behind it)
    a = rgb[..., :3].astype(np.int16)
    redness = np.clip((a[..., 0] - np.maximum(a[..., 1], a[..., 2])) / 255.0, 0, 1)
    H, W = redness.shape
    pts = []
    for ys, xs in comps:
        n = len(ys)
        if n < 0.3 * med or n > 3.5 * med:
            continue
        far = np.hypot(xs - xs.mean(), ys - ys.mean()).max()
        if n <= 1.2 * med and far <= r + 1.5:          # one round dot: centre of its redness, edges included
            y0, y1 = max(0, int(ys.min()) - 2), min(H, int(ys.max()) + 3)
            x0, x1 = max(0, int(xs.min()) - 2), min(W, int(xs.max()) + 3)
            w = redness[y0:y1, x0:x1]
            yy, xx = np.mgrid[y0:y1, x0:x1]
            sw = w.sum()
            pts.append((float((w * xx).sum() / sw), float((w * yy).sum() / sw)))
            continue
        best = None
        for k in (1, 2, 3):                              # dots that touch or overlap: the fewest circles that explain it
            C, iou = _split(ys, xs, k, r, rb)
            if best is None or iou > best[1] + 0.02:
                best = (C, iou)
            if iou >= 0.88:
                break
        pts.extend(best[0])
    return np.array(pts), med


def overlay_mask(rgb):
    """Pixels that are iOrtho's drawing, not the x-ray: anything coloured, pure white dots, and a rim round them."""
    a = rgb.astype(np.int16)
    colourful = (a.max(-1) - a.min(-1)) > 40
    white = a.min(-1) > 246
    m = colourful | white
    for _ in range(2):                                   # grow by 2 px (anti-aliased edges)
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m


# --------------------------------------------------------------------------------------------- registration

def _resize(a, w, h):
    return np.asarray(Image.fromarray(np.ascontiguousarray(a, dtype=np.float32)).resize(
        (max(1, int(round(w))), max(1, int(round(h)))), Image.BILINEAR), dtype=np.float64)


def _fast_len(n):
    """The smallest length >= n with no prime factor above 5 (fast for the FFT)."""
    while True:
        m = n
        for p in (2, 3, 5):
            while m % p == 0:
                m //= p
        if m == 1:
            return n
        n += 1


def _masked_ncc(F, Mf, G, Mg, min_frac=0.25):
    """Masked normalised cross-correlation of every shift of G over F (Padfield 2012).

    Returns (ncc, (offset_y, offset_x)) where position (i, j) of the output means G's origin sits at
    (i - offset_y, j - offset_x) in F."""
    sh = (_fast_len(F.shape[0] + G.shape[0] - 1), _fast_len(F.shape[1] + G.shape[1] - 1))
    fft, ifft = np.fft.rfft2, np.fft.irfft2
    Gr, Mgr = G[::-1, ::-1], Mg[::-1, ::-1]
    F1, Fm, F2 = fft(F * Mf, sh), fft(Mf, sh), fft(F * F * Mf, sh)
    G1, Gm, G2 = fft(Gr * Mgr, sh), fft(Mgr, sh), fft(Gr * Gr * Mgr, sh)
    N = np.round(ifft(Fm * Gm, sh))
    sF, sG = ifft(F1 * Gm, sh), ifft(Fm * G1, sh)
    sFG = ifft(F1 * G1, sh)
    sF2, sG2 = ifft(F2 * Gm, sh), ifft(Fm * G2, sh)
    Nn = np.maximum(N, 1)
    num = sFG - sF * sG / Nn
    den = (sF2 - sF ** 2 / Nn) * (sG2 - sG ** 2 / Nn)
    ok = (N >= min_frac * min(Mf.sum(), Mg.sum())) & (den > 1e-9)
    out = np.full(sh, -1.0)
    out[ok] = num[ok] / np.sqrt(den[ok])
    return out, (G.shape[0] - 1, G.shape[1] - 1)


def _norm_img(a):
    a = a.astype(np.float64)
    return (a - a.mean()) / (a.std() + 1e-9)


def _coarse(tg, tmask, og, scales, work):
    """Best (score, s, tx, ty) over the given scales, comparing small copies (longest side `work`)."""
    Ht, Wt = tg.shape
    Ho, Wo = og.shape
    ft = work / max(Ht, Wt)
    T = _norm_img(_resize(tg, Wt * ft, Ht * ft))
    Tm = (_resize(tmask.astype(np.float64), Wt * ft, Ht * ft) > 0.99).astype(np.float64)
    out = []
    for s in scales:
        k = s * ft                                    # original px -> small traced px
        if Wo * k < 24 or Ho * k < 24:
            continue
        O = _norm_img(_resize(og, Wo * k, Ho * k))
        ncc, (oy, ox) = _masked_ncc(T, Tm, O, np.ones_like(O))
        i = np.unravel_index(np.argmax(ncc), ncc.shape)
        out.append((float(ncc[i]), float(s), (i[1] - ox) / ft, (i[0] - oy) / ft))
    return out


def register(traced_rgb, original):
    """Scale and shift taking original pixels to traced-image pixels: traced = s * original + t.

    Coarse: masked NCC over a range of scales on small copies, then finer steps on bigger copies. Fine: patches
    matched at full size and a least-squares fit. Returns dict(s, tx, ty, score, residual_px)."""
    tg = traced_rgb[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])
    tmask = ~overlay_mask(traced_rgb)
    og = original.astype(np.float64)
    Ht, Wt = tg.shape
    Ho, Wo = og.shape
    s_fit = min(Wt / Wo, Ht / Ho)
    # the traced image may show the whole x-ray (s near s_fit) or a crop of it (s larger)
    res = _coarse(tg, tmask, og, s_fit * np.exp(np.linspace(math.log(0.5), math.log(2.2), 44)), 200)
    if not res:
        raise ImportError_("Could not compare the two images (one of them is too small).")
    s1 = max(res)[1]
    res = _coarse(tg, tmask, og, s1 * np.exp(np.linspace(-0.03, 0.03, 9)), 360)
    score, s, tx, ty = max(res)
    if score < 0.45:
        raise ImportError_("The traced image does not look like this x-ray (they did not line up). "
                           "Check that the files belong to the same patient and x-ray.")
    # --- fine: patches of the original found in the traced image at full size, twice (wide search, then narrow)
    resid = None
    gy, gx = np.gradient(og)
    energy = np.hypot(gx, gy)
    for R in (int(max(12, 0.02 * max(Ht, Wt))), int(max(5, 0.006 * max(Ht, Wt)))):
        fit = _refine(tg, tmask, og, energy, s, tx, ty, R)
        if fit is None:
            break
        s, tx, ty, resid = fit
    sim = _similarity(tg, tmask, og, s, tx, ty)
    # the same x-ray: the pictures agree once aligned, and the patches agree with one scale and shift to a fraction of a
    # pixel (0.1-0.2 px; another patient's x-ray, even a similar one, is off by several pixels or does not fit at all)
    fits = resid <= max(1.5, 0.002 * max(Ht, Wt)) if resid is not None else sim >= 0.95
    if sim < SAME_XRAY or not fits:
        raise ImportError_("The traced image does not match this x-ray closely enough. "
                           "Check that the files belong to the same patient and the same x-ray.")
    return dict(s=float(s), tx=float(tx), ty=float(ty), score=round(score, 3), residual_px=resid, similarity=round(sim, 3))


SAME_XRAY = 0.85        # correlation of the two images once aligned (the same x-ray ~0.98-0.99)


def _similarity(tg, tmask, og, s, tx, ty, work=800):
    """Rank correlation between the traced image and the original laid onto it (where both show the x-ray)."""
    Ht, Wt = tg.shape
    f = min(1.0, work / max(Ht, Wt))
    W2, H2 = max(1, int(Wt * f)), max(1, int(Ht * f))
    # small-traced pixel (u, v) -> traced (u + .5) / f - .5 -> original (traced - t) / s
    a, c = 1 / (f * s), (0.5 / f - 0.5 - tx) / s
    e, k = 1 / (f * s), (0.5 / f - 0.5 - ty) / s
    im = Image.fromarray(np.ascontiguousarray(og, dtype=np.float32))
    warped = np.asarray(im.transform((W2, H2), Image.AFFINE, (a, 0, c, 0, e, k), Image.BILINEAR, fillcolor=-1.0),
                        np.float64)
    T = _resize(tg, W2, H2)
    M = (_resize(tmask.astype(np.float64), W2, H2) > 0.99) & (warped >= 0)
    if M.sum() < 0.1 * M.size:
        return 0.0
    x, y = T[M], warped[M]
    pearson = float(np.corrcoef(x, y)[0, 1])
    spearman = float(np.corrcoef(_ranks(x), _ranks(y))[0, 1])        # for a curve iOrtho may have applied
    return max(pearson, spearman)


def _ranks(v):
    """Ranks with ties sharing their mean rank."""
    u, inv, cnt = np.unique(np.round(v, 3), return_inverse=True, return_counts=True)
    mid = np.cumsum(cnt) - (cnt - 1) / 2.0
    return mid[inv]


def _peak(sub, j):
    """Sub-pixel offset of the peak at j along both axes (parabola through the neighbours)."""
    out = []
    for ax in (0, 1):
        if 0 < j[ax] < sub.shape[ax] - 1:
            lo, hi = list(j), list(j)
            lo[ax] -= 1
            hi[ax] += 1
            a, b, c = sub[tuple(lo)], sub[j], sub[tuple(hi)]
            d = a - 2 * b + c
            out.append(float(j[ax]) + (0.5 * (a - c) / d if d < 0 else 0.0))
        else:
            out.append(float(j[ax]))
    return out


def _refine(tg, tmask, og, energy, s, tx, ty, R):
    """Least-squares scale and shift from the most textured patches of the original, each found in the traced image
    within R traced px of where (s, tx, ty) puts it. Returns (s, tx, ty, median residual) or None."""
    Ht, Wt = tg.shape
    Ho, Wo = og.shape
    half = max(40.0, 0.04 * max(Ht, Wt))                  # patch half-size in traced px
    P = int(round(half / s))                              # ... in original px
    if 2 * P + 2 >= min(Ho, Wo):
        return None
    cands = []
    for fy in np.linspace(0.08, 0.92, 9):
        for fx in np.linspace(0.08, 0.92, 9):
            cy, cx = int(fy * Ho), int(fx * Wo)
            y0, x0 = cy - P, cx - P
            if y0 < 0 or x0 < 0 or y0 + 2 * P > Ho or x0 + 2 * P > Wo:
                continue
            cands.append((float(energy[y0:y0 + 2 * P, x0:x0 + 2 * P].mean()), x0, y0))
    if not cands:
        return None
    cands.sort(reverse=True)
    top = cands[0][0]
    src, dst = [], []
    for e, x0, y0 in cands[:30]:
        if e < 0.2 * top:
            break
        n = max(8, int(round(2 * P * s)))
        k = n / (2 * P)                                   # the patch's own scale after rounding
        patch = _resize(og[y0:y0 + 2 * P, x0:x0 + 2 * P], n, n)
        # patch pixel i covers original x0 + (i + 0.5) / k - 0.5; it should land at traced s * that + tx
        ex = s * (x0 + 0.5 / k - 0.5) + tx                # expected traced position of the patch's pixel 0
        ey = s * (y0 + 0.5 / k - 0.5) + ty
        wx0, wy0 = int(math.floor(ex)) - R, int(math.floor(ey)) - R
        if wx0 < 0 or wy0 < 0 or wx0 + n + 2 * R > Wt or wy0 + n + 2 * R > Ht:
            continue
        win = tg[wy0:wy0 + n + 2 * R, wx0:wx0 + n + 2 * R]
        wm = tmask[wy0:wy0 + n + 2 * R, wx0:wx0 + n + 2 * R].astype(np.float64)
        if wm.mean() < 0.6:
            continue
        ncc, _ = _masked_ncc(win, wm, patch, np.ones_like(patch), min_frac=0.6)
        sub = ncc[n - 1:n - 1 + 2 * R + 1, n - 1:n - 1 + 2 * R + 1]           # patch origin at wx0 + 0 .. 2R
        j = np.unravel_index(np.argmax(sub), sub.shape)
        if sub[j] < 0.7 or min(j) == 0 or max(j) == 2 * R:                    # weak, or the peak is at the edge
            continue
        dy, dx = _peak(sub, j)
        c = (P + 0.5) * k - 0.5                                               # original x0 + P in patch pixels
        src.append((x0 + P, y0 + P))
        dst.append((wx0 + dx + c, wy0 + dy + c))
    if len(src) < 5:
        return None
    src, dst = np.array(src, float), np.array(dst, float)
    keep = np.ones(len(src), bool)
    for _ in range(4):                                    # scale + shift by least squares, dropping outliers
        A = np.zeros((2 * keep.sum(), 3))
        A[0::2, 0], A[0::2, 1] = src[keep, 0], 1
        A[1::2, 0], A[1::2, 2] = src[keep, 1], 1
        (s2, tx2, ty2), *_ = np.linalg.lstsq(A, dst[keep].reshape(-1), rcond=None)
        r = np.hypot(src[:, 0] * s2 + tx2 - dst[:, 0], src[:, 1] * s2 + ty2 - dst[:, 1])
        new = r < max(1.0, 3 * np.median(r[keep]))
        if new.sum() < 5 or (new == keep).all():
            keep = new
            break
        keep = new
    if keep.sum() < 5 or abs(s2 / s - 1) > 0.05:
        return None
    sx, sy = src[keep].std(0)
    if sx < 0.1 * Wo or sy < 0.1 * Ho:                    # all in one place: the scale is not pinned down
        return None
    return float(s2), float(tx2), float(ty2), float(np.median(r[keep]))


# --------------------------------------------------------------------------------------------- naming the dots

def _umeyama(src, dst):
    sc, R, t = g.similarity_fit(src, dst)
    return sc, R, t


def fit_template(dots):
    """Our average tracing (the template, mm) fitted to the dot cloud by trimmed ICP. Returns the best fit:
    dict(facing, scale (px per mm), R, t, pred {code: px})."""
    codes = DOT_CODES + PAIR_CODES
    best = None
    c_d = dots.mean(0)
    r_d = np.sqrt(((dots - c_d) ** 2).sum(1).mean())
    for facing in ("right", "left"):
        sx = 1.0 if facing == "right" else -1.0
        tp = np.array([[sx * _TPL[c][0], -_TPL[c][1]] for c in codes])      # image orientation, mm
        c_t = tp.mean(0)
        r_t = np.sqrt(((tp - c_t) ** 2).sum(1).mean())
        for mult in (0.8, 0.95, 1.1):
            for rot in (-8.0, 0.0, 8.0):
                a = math.radians(rot)
                R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
                sc = mult * r_d / r_t
                t = c_d - sc * (R @ c_t)
                for _ in range(40):
                    cur = (sc * (R @ tp.T)).T + t
                    d2 = ((cur[:, None, :] - dots[None, :, :]) ** 2).sum(-1)
                    nn = d2.argmin(1)
                    dist = np.sqrt(d2[np.arange(len(tp)), nn])
                    keep = dist <= np.percentile(dist, 80)
                    sc, R, t = _umeyama(tp[keep], dots[nn[keep]])
                cur = (sc * (R @ tp.T)).T + t
                d = np.sqrt(((cur[:, None, :] - dots[None, :, :]) ** 2).sum(-1)).min(1)
                cost = float(np.sort(d)[: int(0.8 * len(d))].mean() / sc)              # mm
                if best is None or cost < best["cost"]:
                    best = dict(facing=facing, scale=float(sc), cost=cost,
                                pred={c: cur[i] for i, c in enumerate(codes)})
    return best


def _canon(p, facing):
    return np.array([p[0] if facing == "right" else -p[0], -p[1]], float)


# each check: name shown, report names, landmarks it needs, how to compute it (canonical points, mm per px), tolerance
def _ang_checks():
    A, L, B = g.angle_at, g.line_angle, g.angle_between
    return [
        ("SNA", ("SNA",), ("S", "N", "A"), lambda p, k: A(p["S"], p["N"], p["A"]), 0.35),
        ("SNB", ("SNB",), ("S", "N", "B"), lambda p, k: A(p["S"], p["N"], p["B"]), 0.35),
        ("SN-PP", ("S-N/ANS-PNS",), ("S", "N", "ANS", "PNS"), lambda p, k: L(p["S"], p["N"], p["ANS"], p["PNS"]), 0.4),
        ("U1-SN", ("U1-SN",), ("S", "N", "U1T", "U1A"), lambda p, k: B(g.vec(p["U1T"], p["U1A"]), g.vec(p["S"], p["N"])), 0.4),
        ("U1-NA", ("U1-NA",), ("N", "A", "U1T", "U1A"),
         lambda p, k: g.wrap(g.direction(p["U1A"], p["U1T"]) - g.direction(p["N"], p["A"])), 0.4),
        ("L1-NB", ("L1-NB",), ("N", "B", "L1T", "L1A"),
         lambda p, k: g.wrap(g.direction(p["B"], p["N"]) - g.direction(p["L1A"], p["L1T"])), 0.4),
        ("Interincisal", ("Interincisal angle", "U1-L1"), ("U1T", "U1A", "L1T", "L1A"),
         lambda p, k: B(g.vec(p["U1T"], p["U1A"]), g.vec(p["L1T"], p["L1A"])), 0.5),
        ("PP-FH", ("PP-FH (Maxillary Plane Angle)",), ("ANS", "PNS", "Po", "Or"),
         lambda p, k: L(p["ANS"], p["PNS"], p["Po"], p["Or"]), 0.4),
        ("SN-GoGn", ("S-N/Go-Gn", "GoGn-SN"), ("S", "N", "Go", "Gn"), lambda p, k: L(p["S"], p["N"], p["Go"], p["Gn"]), 0.4),
        ("Y-axis", ("SGn-FH (Y-axis Angle)", "Y-Axis(SGn-FH)"), ("S", "Gn", "Po", "Or"),
         lambda p, k: L(p["S"], p["Gn"], p["Po"], p["Or"]), 0.4),
        ("Facial angle", ("FH-NPo (Facial Angle)", "FH-NPo(Facial Angle)"), ("Po", "Or", "N", "Pog"),
         lambda p, k: L(p["Po"], p["Or"], p["N"], p["Pog"]), 0.4),
        ("FMA", ("FMA(FH-MP)", "FH-MP (Mandibular Plane Angle)"), ("Po", "Or", "MPt", "Me"),
         lambda p, k: L(p["Po"], p["Or"], p["MPt"], p["Me"]), 0.4),
        ("MP-SN", ("MP-SN",), ("S", "N", "MPt", "Me"), lambda p, k: L(p["S"], p["N"], p["MPt"], p["Me"]), 0.4),
        ("IMPA", ("IMPA(L1-MP)", "L1-MP (Lower Central Incisor-mandibular Plane Angle)"), ("L1T", "L1A", "MPt", "Me"),
         lambda p, k: B(g.vec(p["L1A"], p["L1T"]), g.vec(p["Me"], p["MPt"])), 0.5),
        ("Saddle angle", ("N-S-Ar (Saddle Angle)",), ("N", "S", "Ar"), lambda p, k: A(p["N"], p["S"], p["Ar"]), 0.4),
        ("Gonial angle", ("Ar-Go-Me",), ("Ar", "Go", "Me"), lambda p, k: A(p["Ar"], p["Go"], p["Me"]), 0.5),
    ]


def _mm_checks():
    sd = g.signed_dist_anterior
    return [
        ("U1-NA mm", ("U1-NA(mm)",), ("N", "A", "U1T"), lambda p, k: sd(p["U1T"], p["N"], p["A"]) * k, 0.3),
        ("L1-NB mm", ("L1-NB(mm)",), ("N", "B", "L1T"), lambda p, k: sd(p["L1T"], p["N"], p["B"]) * k, 0.3),
        ("Po-NB", ("Po-NB(mm)",), ("N", "B", "Pog"), lambda p, k: sd(p["Pog"], p["N"], p["B"]) * k, 0.3),
        ("N-Me", ("N-Me (Anterior Facial Height mm)",), ("N", "Me"), lambda p, k: g.dist(p["N"], p["Me"]) * k, 0.4),
        ("Upper lip to E-line", ("UL-EP (Upper Lip Position mm)", "UL-EP(mm)"), ("Prn", "Pos", "Ls"),
         lambda p, k: sd(p["Ls"], p["Prn"], p["Pos"]) * k, 0.3),
        ("Lower lip to E-line", ("LL-EP (Lower Lip Position mm)", "LL-EP(mm)"), ("Prn", "Pos", "Li"),
         lambda p, k: sd(p["Li"], p["Prn"], p["Pos"]) * k, 0.3),
        ("Sn to H line", ("Sn-H (Subnasale to H Line mm)",), ("Sn", "Ls", "Pos"),
         lambda p, k: abs(sd(p["Sn"], p["Ls"], p["Pos"])) * k, 0.4),
    ]


def _op_checks():
    def op(p):
        return p["MOL"], (p["U1T"] + p["L1T"]) / 2.0
    return [
        ("OP-FH", ("OP-FH", "OP angle (OP-FH)", "OP-FH (Occlusal Plane Angle)"), ("MOL", "U1T", "L1T", "Po", "Or"),
         lambda p, k: g.line_angle(*op(p), p["Po"], p["Or"]), 0.5),
        ("OP-SN", ("OP-SN",), ("MOL", "U1T", "L1T", "S", "N"), lambda p, k: g.line_angle(*op(p), p["S"], p["N"]), 0.5),
    ]


DOT_SIGMA_PX = 0.3      # how far a dot's centre may be from iOrtho's point, traced-image pixels


def _spread(f, p, k, codes):
    """Standard deviation of a check's value when each dot is off by DOT_SIGMA_PX (finite differences)."""
    if any(c not in p for c in codes):
        return 0.0
    var, e = 0.0, 0.5
    try:
        for c in set(codes):
            for ax in (0, 1):
                hi, lo = dict(p), dict(p)
                d = np.zeros(2)
                d[ax] = e
                hi[c], lo[c] = p[c] + d, p[c] - d
                var += ((f(hi, k or 0.0) - f(lo, k or 0.0)) / (2 * e)) ** 2
    except (ValueError, ZeroDivisionError):
        return 0.0
    return math.sqrt(var) * DOT_SIGMA_PX


def match(dots, report_values, radius_mm=13.0, k_cand=5):
    """Name iOrtho's dots. dots: (n, 2) traced-image pixels. Returns dict(points {code: (x, y)}, verified,
    unverified, checks [...], facing)."""
    if len(dots) < 15:
        raise ImportError_(f"Found only {len(dots)} red landmark dots on the traced image - is it iOrtho's traced image?")
    fit = fit_template(dots)
    facing, ppm = fit["facing"], fit["scale"]
    rad = radius_mm * ppm
    cands = {}
    for c in DOT_CODES:
        d = np.hypot(*(dots - fit["pred"][c]).T)
        order = [int(i) for i in np.argsort(d)[:k_cand] if d[i] <= rad]
        cands[c] = order or [int(np.argmin(d))]
    # report values present, and the scale iOrtho used (from its S-N length) for the mm checks
    sn_mm = _value(report_values, "S-N(Length of Anterior Cranial Base mm)", "S-N(Anterior Cranial Base)(mm)")
    checks = [(n, v, codes, f, tol) for n, names, codes, f, tol in _ang_checks() + _mm_checks() + _op_checks()
              for v in [_value(report_values, *names)] if v is not None]
    # on a small export a dot's position is less exact against a short line (the incisor axes): allow for it
    pred = {c: _canon(v, facing) for c, v in fit["pred"].items()}
    k_pred = sn_mm / g.dist(pred["S"], pred["N"]) if sn_mm else None
    checks = [(n, v, codes, f, max(tol, 2.5 * _spread(f, pred, k_pred, codes))) for n, v, codes, f, tol in checks]
    by_code = {}
    for ch in checks:
        for c in ch[2]:
            by_code.setdefault(c, []).append(ch)

    def scale_of(p):
        if sn_mm and "S" in p and "N" in p:
            return sn_mm / g.dist(p["S"], p["N"])
        return None

    def eval_checks(p, newc):
        """Failures among the checks completed by assigning newc (None = not checkable yet)."""
        k = scale_of(p)
        fails, done = 0, 0
        for n, v, codes, f, tol in by_code.get(newc, []):
            if not all(c in p for c in codes):
                continue
            if n in [x[0] for x in _mm_checks()] and k is None:
                continue
            try:
                got = f(p, k)
            except (ValueError, ZeroDivisionError):
                fails += 1
                continue
            done += 1
            if abs(got - v) > tol:
                fails += 1
        return fails, done

    order = DOT_CODES
    best = {"key": None, "assign": None}
    budget_steps = [0]

    def dfs(i, assign, used, fails, dist):
        budget_steps[0] += 1
        if budget_steps[0] > 200000:
            return
        if best["key"] is not None and (fails, dist) >= best["key"]:
            return
        if i == len(order):
            best["key"], best["assign"] = (fails, dist), dict(assign)
            return
        c = order[i]
        for j in cands[c]:
            if j in used:
                continue
            assign[c] = j
            p = {cc: _canon(dots[jj], facing) for cc, jj in assign.items()}
            f, _ = eval_checks(p, c)
            if fails + f <= max_fail[0]:
                used.add(j)
                dfs(i + 1, assign, used, fails + f, dist + float(np.hypot(*(dots[j] - fit["pred"][c]))) / ppm)
                used.discard(j)
            del assign[c]

    max_fail = [0]
    for mf in range(0, 6):
        max_fail[0] = mf
        budget_steps[0] = 0
        dfs(0, {}, set(), 0, 0.0)
        if best["assign"] is not None:
            break
    if best["assign"] is None:
        raise ImportError_("Could not work out which iOrtho dot is which landmark.")
    assign = best["assign"]
    pts = {c: dots[j].copy() for c, j in assign.items()}
    canon = {c: _canon(v, facing) for c, v in pts.items()}

    # MOL: the pair of cusp dots (upper and lower first molar) whose midpoint gives iOrtho's occlusal plane
    used = set(assign.values())
    pair_note = {}
    for code in PAIR_CODES:
        near = [int(i) for i in np.argsort(np.hypot(*(dots - fit["pred"][code]).T))[:6]
                if int(i) not in used and np.hypot(*(dots[i] - fit["pred"][code])) <= rad]
        pairs = []
        for a in range(len(near)):
            for b in range(a + 1, len(near)):
                pa, pb = dots[near[a]], dots[near[b]]
                if abs(pa[1] - pb[1]) < 0.4 * ppm or abs(pa[1] - pb[1]) > 6 * ppm or abs(pa[0] - pb[0]) > 5 * ppm:
                    continue                       # one cusp above the other, close together
                mid = (pa + pb) / 2
                pairs.append((float(np.hypot(*(mid - fit["pred"][code]))), near[a], near[b], mid))
        pairs.sort(key=lambda x: x[0])
        chosen = None
        if code == "MOL":
            for _, a, b, mid in pairs:
                p = dict(canon, MOL=_canon(mid, facing))
                f, d = eval_checks(p, "MOL")
                if d and f == 0:
                    chosen = (a, b, mid, True)
                    break
        if chosen is None and pairs:
            chosen = (pairs[0][1], pairs[0][2], pairs[0][3], False)
        if chosen:
            pts[code] = chosen[2]
            canon[code] = _canon(chosen[2], facing)
            used.update((chosen[0], chosen[1]))
            pair_note[code] = chosen[3]

    # every check, for the record; a landmark is verified when all its checks pass and it has at least one
    k = scale_of(canon)
    table = []
    failed_codes = set()
    checked_codes = set()
    for n, v, codes, f, tol in checks:
        if not all(c in canon for c in codes):
            continue
        is_mm = n in [x[0] for x in _mm_checks()]
        if is_mm and k is None:
            continue
        try:
            got = float(f(canon, k))
        except (ValueError, ZeroDivisionError):
            got = None
        ok = got is not None and abs(got - v) <= tol
        table.append(dict(name=n, iortho=round(v, 2), here=None if got is None else round(got, 2), ok=ok))
        (checked_codes if ok else failed_codes).update(codes)
    verified = sorted(c for c in pts if c in checked_codes and c not in failed_codes)
    unverified = sorted(c for c in pts if c not in verified)
    return dict(points={c: (float(v[0]), float(v[1])) for c, v in pts.items()}, verified=verified,
                unverified=unverified, checks=table, facing=facing, scale_mm=k)


# --------------------------------------------------------------------------------------------- all together

def load_rgb(data):
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as ex:
        raise ImportError_(f"The traced image could not be read ({ex.__class__.__name__}).")
    return np.asarray(im.convert("RGB"))


def looks_traced(rgb):
    """True for an image with iOrtho's tracing on it (many red landmark dots); False for a plain x-ray, even one with
    a red mark, ruler or label on it."""
    small = np.asarray(Image.fromarray(rgb).resize((max(1, rgb.shape[1] // 4), max(1, rgb.shape[0] // 4))))
    if int(red_mask(small).sum()) <= 40:
        return False
    return len(find_dots(rgb)[0]) >= 10


def import_tracing(original_gray, traced_rgb, report, reg=None):
    """Everything: register (unless already done), find and name the dots, and map them onto the original x-ray's
    pixels."""
    reg = reg or register(traced_rgb, original_gray)
    dots, _ = find_dots(traced_rgb)
    m = match(dots, report["values"])
    s, tx, ty = reg["s"], reg["tx"], reg["ty"]
    H, W = original_gray.shape
    pts = {}
    for c, (x, y) in m["points"].items():
        ox, oy = (x - tx) / s, (y - ty) / s
        if c in CODES and -20 <= ox <= W + 20 and -20 <= oy <= H + 20:      # the app's own landmarks only
            pts[c] = (ox, oy)
    m["points"] = pts
    m["verified"] = [c for c in m["verified"] if c in pts]
    m["unverified"] = [c for c in m["unverified"] if c in pts]
    m["registration"] = reg
    m["mm_per_px"] = m["scale_mm"] * s if m.get("scale_mm") else None      # iOrtho's own scale, original pixels
    return m
