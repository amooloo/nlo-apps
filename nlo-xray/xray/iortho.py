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
from .landmarks import TEMPLATE

# the landmarks iOrtho traces too (everything but the vertebrae); MOL and PM are midpoints of cusp dots
DOT_CODES = ["S", "N", "A", "B", "ANS", "PNS", "U1T", "U1A", "L1T", "L1A", "Po", "Or", "Go", "Gn", "Pog", "MPt",
             "Me", "Ar", "Prn", "Pos", "Ls", "Li", "Sn"]
PAIR_CODES = ["MOL", "PM"]


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


def find_dots(rgb):
    """Centres of iOrtho's red landmark dots, image pixels (x, y), with their typical size."""
    comps = [c for c in _components(red_mask(rgb)) if len(c[0]) >= 6]
    if not comps:
        return np.zeros((0, 2)), 0
    sizes = np.array([len(c[0]) for c in comps])
    med = float(np.median(sizes))
    pts = [(float(xs.mean()), float(ys.mean())) for ys, xs in comps if 0.3 * med <= len(ys) <= 3.5 * med]
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
    return np.asarray(Image.fromarray(a.astype(np.float32), mode="F").resize((max(1, int(round(w))), max(1, int(round(h)))),
                                                                             Image.BILINEAR), dtype=np.float64)


def _masked_ncc(F, Mf, G, Mg, min_frac=0.25):
    """Masked normalised cross-correlation of every shift of G over F (Padfield 2012).

    Returns (ncc, (offset_y, offset_x)) where position (i, j) of the output means G's origin sits at
    (i - offset_y, j - offset_x) in F."""
    sh = (F.shape[0] + G.shape[0] - 1, F.shape[1] + G.shape[1] - 1)
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


def register(traced_rgb, original):
    """Scale and shift taking original pixels to traced-image pixels: traced = s * original + t.

    Coarse: masked NCC over a range of scales on small copies. Fine: a dozen patches matched at full size,
    and a least-squares fit. Returns dict(s, tx, ty, score, residual_px)."""
    tg = traced_rgb[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])
    tmask = ~overlay_mask(traced_rgb)
    og = original.astype(np.float64)
    Ht, Wt = tg.shape
    Ho, Wo = og.shape
    # --- coarse
    work = 256.0
    ft = work / max(Ht, Wt)
    T = _resize(tg, Wt * ft, Ht * ft)
    Tm = _resize(tmask.astype(np.float64), Wt * ft, Ht * ft) > 0.99
    T = _norm_img(T)
    s_fit = min(Wt / Wo, Ht / Ho)
    best = None
    for s in s_fit * np.exp(np.linspace(math.log(0.55), math.log(1.6), 48)):
        k = s * ft                                    # original px -> small traced px
        if Wo * k < 24 or Ho * k < 24:
            continue
        O = _norm_img(_resize(og, Wo * k, Ho * k))
        ncc, (oy, ox) = _masked_ncc(T, Tm.astype(np.float64), O, np.ones_like(O))
        i = np.unravel_index(np.argmax(ncc), ncc.shape)
        if best is None or ncc[i] > best[0]:
            best = (float(ncc[i]), s, (i[1] - ox) / ft, (i[0] - oy) / ft)
    if best is None:
        raise ImportError_("Could not compare the two images (one of them is too small).")
    score, s, tx, ty = best
    if score < 0.45:
        raise ImportError_("The traced image does not look like this x-ray (they did not line up). "
                           "Check that the files belong to the same patient and x-ray.")
    # --- fine: patches of the original found in the traced image at full size
    src, dst = [], []
    gy, gx = np.gradient(og)
    energy = np.hypot(gx, gy)
    P = max(24, int(round(48 / max(s, 1e-6))))          # patch half-size in original px (~48 traced px)
    R = 10                                              # search radius, traced px
    for fy in np.linspace(0.15, 0.85, 5):
        for fx in np.linspace(0.15, 0.85, 5):
            cy, cx = int(fy * Ho), int(fx * Wo)
            y0, y1, x0, x1 = cy - P, cy + P, cx - P, cx + P
            if y0 < 0 or x0 < 0 or y1 >= Ho or x1 >= Wo or energy[y0:y1, x0:x1].mean() < np.percentile(energy, 60):
                continue
            patch = _resize(og[y0:y1, x0:x1], 2 * P * s, 2 * P * s)
            ph, pw = patch.shape
            ty0 = int(round(s * y0 + ty)) - R
            tx0 = int(round(s * x0 + tx)) - R
            if ty0 < 0 or tx0 < 0 or ty0 + ph + 2 * R > Ht or tx0 + pw + 2 * R > Wt:
                continue
            win = tg[ty0:ty0 + ph + 2 * R, tx0:tx0 + pw + 2 * R]
            wm = tmask[ty0:ty0 + ph + 2 * R, tx0:tx0 + pw + 2 * R].astype(np.float64)
            if wm.mean() < 0.6:
                continue
            ncc, (oy, ox) = _masked_ncc(win, wm, patch, np.ones_like(patch), min_frac=0.6)
            sub = ncc[ph - 1:ph - 1 + 2 * R + 1, pw - 1:pw - 1 + 2 * R + 1]      # shifts 0 .. 2R
            j = np.unravel_index(np.argmax(sub), sub.shape)
            if sub[j] < 0.6:
                continue
            dy, dx = float(j[0]), float(j[1])
            if 0 < j[0] < sub.shape[0] - 1:                 # sub-pixel (parabola)
                a, b, c = sub[j[0] - 1, j[1]], sub[j], sub[j[0] + 1, j[1]]
                dy += 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
            if 0 < j[1] < sub.shape[1] - 1:
                a, b, c = sub[j[0], j[1] - 1], sub[j], sub[j[0], j[1] + 1]
                dx += 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
            # the patch's centre: original (cx, cy) <-> traced
            src.append((cx, cy))
            dst.append((tx0 + dx + (cx - x0) * s, ty0 + dy + (cy - y0) * s))
    resid = None
    if len(src) >= 4:
        src, dst = np.array(src, float), np.array(dst, float)
        keep = np.ones(len(src), bool)
        for _ in range(3):                               # scale + shift by least squares, dropping outliers
            A = np.zeros((2 * keep.sum(), 3))
            A[0::2, 0], A[0::2, 1] = src[keep, 0], 1
            A[1::2, 0], A[1::2, 2] = src[keep, 1], 1
            bvec = dst[keep].reshape(-1)
            (s2, tx2, ty2), *_ = np.linalg.lstsq(A, bvec, rcond=None)
            r = np.hypot(src[:, 0] * s2 + tx2 - dst[:, 0], src[:, 1] * s2 + ty2 - dst[:, 1])
            keep = r < max(2.0, 3 * np.median(r[keep]))
            if keep.sum() < 4:
                break
        if keep.sum() >= 4 and abs(s2 / s - 1) < 0.05:
            s, tx, ty = float(s2), float(tx2), float(ty2)
            resid = float(np.median(r[keep]))
    return dict(s=s, tx=tx, ty=ty, score=round(score, 3), residual_px=resid)


# --------------------------------------------------------------------------------------------- naming the dots

def _umeyama(src, dst):
    sc, R, t = g.similarity_fit(src, dst)
    return sc, R, t


def fit_template(dots):
    """Our average tracing (TEMPLATE, mm) fitted to the dot cloud by trimmed ICP. Returns the best fit:
    dict(facing, scale (px per mm), R, t, pred {code: px})."""
    codes = DOT_CODES + PAIR_CODES
    best = None
    c_d = dots.mean(0)
    r_d = np.sqrt(((dots - c_d) ** 2).sum(1).mean())
    for facing in ("right", "left"):
        sx = 1.0 if facing == "right" else -1.0
        tp = np.array([[sx * TEMPLATE[c][0], -TEMPLATE[c][1]] for c in codes])      # image orientation, mm
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
    """True for an image with iOrtho-style tracing (many red dots), False for a plain grey x-ray."""
    small = np.asarray(Image.fromarray(rgb).resize((max(1, rgb.shape[1] // 4), max(1, rgb.shape[0] // 4))))
    return int(red_mask(small).sum()) > 40


def import_tracing(original_gray, traced_rgb, report):
    """Everything: register, find and name the dots, and map them onto the original x-ray's pixels."""
    reg = register(traced_rgb, original_gray)
    dots, _ = find_dots(traced_rgb)
    m = match(dots, report["values"])
    s, tx, ty = reg["s"], reg["tx"], reg["ty"]
    H, W = original_gray.shape
    pts = {}
    for c, (x, y) in m["points"].items():
        ox, oy = (x - tx) / s, (y - ty) / s
        if -20 <= ox <= W + 20 and -20 <= oy <= H + 20:
            pts[c] = (ox, oy)
    m["points"] = pts
    m["registration"] = reg
    return m
