"""Outlines on a tracing - smooth curves through a few dots, the way tracing software draws them.

Each outline is a list of control dots. Some are the doctor's landmarks (Go, Me, Pog, ...): the curve passes through
them and follows them when they move. The rest are free dots in between, which he can drag to fit the curve to the
x-ray. The curve through the dots is a centripetal Catmull-Rom spline (no loops or overshoot at close dots), drawn by
the page; `spline` here is the same curve, for the tests.

Until a dot is moved by hand the free dots are placed automatically:
- the soft-tissue profile (forehead to chin) follows the skin's edge on the x-ray itself, from one soft-tissue point
  to the next: the cheapest path through the strongest edges in a corridor round the line joining them, then as few
  dots as keep the curve within half a millimetre of it. Where the x-ray shows no clear edge (a burnt-out profile, a
  rod across it) that stretch is a smooth curve through the points instead;
- the anatomy - mandible (ramus, coronoid, condyle, angle, lower border, chin), the inner side of the symphysis,
  maxilla and palate, the upper and lower incisors, the first molars, sella turcica, the frontal and nasal bones, the
  orbit, the pterygomaxillary fissure and the ear rod - is a textbook tracing carried onto the x-ray through the
  doctor's points: a thin-plate spline through the points a bone outline uses (it passes exactly through them and
  bends smoothly in between), a tooth along its own axis at its own length, a molar on the occlusal plane at real
  size, the small cranial structures at their landmark, turned with S-N, at real size. These come from the points,
  not from the picture: where the bone shows a different shape, the x-ray is right - drag the dots.
Once a dot of an outline is moved, that outline's dots are kept as he left them (case["contours"][key]: landmark
codes, and [x, y] image pixels for the free dots); "Redraw from the points" forgets them.

Everything below works in the canonical frame (x forward, y up) and hands back image pixels.
"""
import math

import numpy as np
from PIL import Image, ImageFilter

from . import geometry as g

SN_MM = 68.0                  # assumed S-N length for an x-ray without a pixel size

# ------------------------------------------------------------------------------------------------- the textbook tracing
# A textbook adolescent tracing, canonical mm (sella at the origin, x forward, y up, Frankfort horizontal level):
# SNA 80.5, SNB 78.7, FMA 25, gonial angle 128, U1-SN 103, IMPA 93, lower third 55 % of N-Me, occlusal plane 7° to FH.
# Its points are its own (consistent with the outlines drawn round them); the x-ray's points place it.
DRAW = {
    "S": (0.0, 0.0), "N": (69.5, 8.5), "Or": (56.0, -22.0), "Po": (-18.0, -22.0), "Ar": (-13.0, -30.0),
    "PNS": (22.0, -43.0), "ANS": (72.0, -42.0), "A": (67.0, -48.0),
    "U1A": (61.5, -48.5), "U1T": (70.0, -71.5), "L1T": (67.5, -69.0), "L1A": (57.65, -87.54),
    "B": (62.2, -88.5), "Pog": (64.0, -96.5), "Gn": (61.5, -101.5), "Me": (57.0, -104.0),
    "Go": (-5.0, -72.0), "MPt": (3.0, -78.8), "MOL": (40.0, -66.5),
}

# The control dots of a bone outline, textbook mm; a landmark code stands for that landmark.
_MANDIBLE = [
    (26.0, -65.2), (18.6, -57.0), (16.4, -42.0),                     # front of the ramus, from behind the molars
    (14.0, -32.0),                                                   # coronoid process
    (5.0, -38.2),                                                    # sigmoid notch
    (-4.8, -28.5), (-7.4, -21.4), (-10.3, -20.3), (-13.2, -23.0),    # condyle
    "Ar", (-10.4, -50.0), "Go", "MPt",                               # back of the ramus, the angle
    (22.0, -85.7), (42.0, -95.2),                                    # lower border
    "Me", "Gn", "Pog", "B",                                          # chin
    (64.9, -80.1),                                                   # alveolar crest over the lower incisor
]
_SYMPHYSIS = [(59.3, -77.7), (54.4, -86.5), (49.9, -94.8), (49.0, -99.2)]
_MAXILLA = [
    (68.9, -59.1), (67.4, -53.5), "A", (68.6, -44.4), "ANS",         # alveolar process, A point, the spine
    (63.0, -40.5), (45.0, -40.4), (30.0, -41.9), "PNS",              # nasal floor
    (28.0, -45.3), (41.0, -47.6), (52.0, -51.0), (58.5, -56.5), (62.7, -61.4),   # oral side of the palate
]
# A tooth: its apex and tip (landmarks) and dots at (mm from the apex along the axis, mm across it, + = labial), at
# the textbook tooth's length; carried along the doctor's axis at his length.
_U1 = dict(length=24.5, ctrl=["U1A", (5, 1.8), (12.5, 3.1), (17, 3.45), (21.5, 2.5), (23.8, 1.1), "U1T",
                              (23.3, -1.0), (20, -1.9), (16, -3.6), (12, -2.9), (5, -1.6)])
_L1 = dict(length=21.0, ctrl=["L1A", (5, 1.6), (11, 2.8), (15, 2.85), (18.8, 1.8), (20.5, 0.7), "L1T",
                              (19.8, -1.0), (16, -2.4), (13, -3.1), (9, -2.4), (4, -1.3)])
# The first molars round the molar contact: (mm forward along the occlusal plane, mm up from it), real size.
_LOWER_MOLAR = [(2.3, -7.2), (3.0, -3.2), (0.6, -0.05), (-2.6, -1.1), (-5.6, -0.05), (-8.3, -2.6), (-7.5, -7.2),
                (-6.9, -13.5), (-5.0, -19.3), (-3.7, -15.0), (-2.6, -11.2), (-1.6, -15.0), (-0.6, -19.9), (1.5, -14.0)]
_UPPER_MOLAR = [(0.9, 7.2), (1.6, 3.0), (-1.2, 0.05), (-4.0, 1.0), (-6.8, 0.05), (-9.2, 2.8), (-8.4, 7.2),
                (-7.7, 12.5), (-6.5, 17.8), (-5.1, 14.5), (-3.8, 10.6), (-2.5, 14.5), (-1.2, 18.2), (0.4, 12.5)]
# Small cranial structures round their landmark: (mm forward along S-N, mm up from it), real size.
_SELLA = [(16.0, 5.0), (6.8, 3.6), (5.5, 0.0), (3.6, -4.0), (0.0, -5.5), (-3.8, -3.9), (-5.4, 0.0), (-4.9, 3.8),
          (-3.0, 5.9)]
_NASION = [(-0.3, 22.0), (1.8, 11.0), (0.7, 3.5), "N", (1.6, -6.0), (4.6, -15.0), (7.4, -22.0)]
_ORBIT = [(6.25, 28.9), (-3.2, 30.5), (-10.8, 23.25), (-12.1, 11.5), (-7.2, 2.8), "Or", (7.2, 2.8), (12.1, 11.5),
          (11.7, 20.8)]
_PTM = [(-0.4, 2.5), (-3.6, 10.0), (-3.2, 19.0), (-0.5, 21.5), (2.3, 18.5), (2.0, 9.5)]
_EAR = ["Po", (-3.2, -2.05), (-3.2, -6.35), (0.5, -8.5), (4.2, -6.35), (4.2, -2.05)]

# key, name, group (its colour), how it is placed, the points that place it, its dots, closed
STRUCTURES = [
    ("mandible", "Mandible", "mandible", "spline", ("Ar", "Go", "MPt", "Me", "Gn", "Pog", "B", "L1A", "L1T", "MOL"), _MANDIBLE, False),
    ("symphysis", "Symphysis, inner side", "mandible", "spline", ("Me", "Gn", "Pog", "B", "L1A", "L1T", "MPt"), _SYMPHYSIS, False),
    ("maxilla", "Maxilla and palate", "maxilla", "spline", ("ANS", "A", "PNS", "U1A", "U1T", "MOL"), _MAXILLA, False),
    ("u1", "Upper incisor", "teeth", "tooth", ("U1A", "U1T"), _U1, True),
    ("l1", "Lower incisor", "teeth", "tooth", ("L1A", "L1T"), _L1, True),
    ("u6", "Upper first molar", "teeth", "occlusal", ("MOL", "U1T", "L1T"), _UPPER_MOLAR, True),
    ("l6", "Lower first molar", "teeth", "occlusal", ("MOL", "U1T", "L1T"), _LOWER_MOLAR, True),
    ("sella", "Sella turcica", "cranial", "cranial", ("S", "S", "N"), _SELLA, False),
    ("nasion", "Frontal and nasal bones", "cranial", "cranial", ("N", "S", "N"), _NASION, False),
    ("orbit", "Orbit", "cranial", "cranial", ("Or", "S", "N"), _ORBIT, False),
    ("ptm", "Pterygomaxillary fissure", "cranial", "cranial", ("PNS", "S", "N"), _PTM, True),
    ("ear", "Ear rod (porion)", "cranial", "cranial", ("Po", "S", "N"), _EAR, True),
]
PROFILE_KEY, PROFILE_NAME = "profile", "Soft-tissue profile"
NAMES = dict([(s[0], s[1]) for s in STRUCTURES] + [(PROFILE_KEY, PROFILE_NAME)])
CLOSED = {s[0]: s[6] for s in STRUCTURES}
CLOSED[PROFILE_KEY] = False


# ------------------------------------------------------------------------------------------------- the curve
def spline(xy, closed=False, per=10):
    """The curve the page draws through control dots: centripetal Catmull-Rom (dense points)."""
    P = [np.asarray(p, float) for p in xy]
    n = len(P)
    if n < 3:
        return np.array(P)
    if closed:
        ext = [P[-1]] + P + [P[0], P[1]]
    else:
        ext = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        d01, d12, d23 = (max(1e-6, math.sqrt(g.norm(b - a))) for a, b in ((p0, p1), (p1, p2), (p2, p3)))
        if g.norm(p2 - p1) < 1e-9:
            out.append(p1)
            continue
        t0, t1 = 0.0, d01
        t2, t3 = t1 + d12, t1 + d12 + d23
        for k in range(per):
            t = t1 + (t2 - t1) * k / per
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(P[0] if closed else P[-1])
    return np.array(out)


# ------------------------------------------------------------------------------------------------- carrying it over
def tps(src, dst):
    """Thin-plate spline through point pairs src -> dst (exact at the points). Returns f(points) -> points."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    n = len(src)

    def U(r2):
        with np.errstate(divide="ignore", invalid="ignore"):
            v = r2 * np.log(r2)
        return np.nan_to_num(v)

    P = np.hstack([np.ones((n, 1)), src])
    A = np.zeros((n + 3, n + 3))
    A[:n, :n] = U(((src[:, None, :] - src[None, :, :]) ** 2).sum(-1))
    A[:n, n:], A[n:, :n] = P, P.T
    b = np.zeros((n + 3, 2))
    b[:n] = dst
    sol = np.linalg.lstsq(A, b, rcond=None)[0]
    w, a = sol[:n], sol[n:]

    def f(pts):
        pts = np.asarray(pts, float).reshape(-1, 2)
        return U(((pts[:, None, :] - src[None, :, :]) ** 2).sum(-1)) @ w + np.hstack([np.ones((len(pts), 1)), pts]) @ a
    return f


def _affine(src, dst):
    M = g.affine_fit(src, dst)
    return lambda pts: g.affine_apply(M, np.asarray(pts, float).reshape(-1, 2))


def _frame(origin, direction, scale):
    """Local (forward, up) mm -> canonical pixels: origin, a forward direction, pixels per mm."""
    d = g.unit(direction)
    up = np.array([-d[1], d[0]])
    if up[1] < 0:
        up = -up
    o = np.asarray(origin, float)
    return lambda pts: o + scale * (np.asarray(pts, float).reshape(-1, 2) @ np.vstack([d, up]))


def _point(p, code):
    if "+" in code:
        a, b = code.split("+")
        return (np.asarray(p[a], float) + np.asarray(p[b], float)) / 2.0 if a in p and b in p else None
    return np.asarray(p[code], float) if code in p else None


def _size(xy):
    xy = np.asarray(xy, float)
    return float(np.hypot(*(xy.max(0) - xy.min(0)))) or 1.0


def _place(entries, f, p):
    """Control dots -> [code | canonical (x, y)]: a landmark entry stays a code when the x-ray has that landmark."""
    out = []
    free = [e for e in entries if not isinstance(e, str)]
    xy = iter(f(free)) if free else iter(())
    for e in entries:
        if isinstance(e, str):
            out.append(e if e in p else None)
        else:
            out.append(np.asarray(next(xy), float))
    return out


def anatomy(p, px_per_mm):
    """The textbook outlines' control dots on canonical points p (pixels). px_per_mm: the x-ray's scale.
    Returns [dict(key, name, group, closed, ctrl [code | canonical (x, y)], anchors)]."""
    out = []
    for key, name, group, how, uses, shape, closed in STRUCTURES:
        ctrl, anchors = None, []
        if how == "spline":
            anchors = [c for c in uses if c in p and c in DRAW]
            if len(anchors) < 3:
                continue
            src, dst = [DRAW[c] for c in anchors], [p[c] for c in anchors]
            tmpl = np.array([DRAW[e] if isinstance(e, str) else e for e in shape], float)
            try:
                warped, plain = tps(src, dst)(tmpl), _affine(src, dst)(tmpl)
            except (np.linalg.LinAlgError, ValueError):
                continue
            # a doctor's points far from any textbook shape (or two on top of each other) can fold the spline: then
            # the outline is only moved, turned and stretched to them
            if not np.all(np.isfinite(warped)) or np.abs(warped - plain).max() > 0.35 * _size(plain):
                warped = plain
            ctrl = [e if isinstance(e, str) and e in p else warped[i] for i, e in enumerate(shape)]
        elif how == "tooth":
            a, t = uses
            if a not in p or t not in p:
                continue
            axis = np.asarray(p[t], float) - np.asarray(p[a], float)
            L = g.norm(axis)
            if L <= 0:
                continue
            ax = axis / L
            lab = np.array([-ax[1], ax[0]])
            if lab[0] < 0:                            # the labial side faces forward
                lab = -lab
            k = L / shape["length"]                   # the tooth at the doctor's length
            ctrl = [e if isinstance(e, str) else np.asarray(p[a], float) + e[0] * k * ax + e[1] * k * lab
                    for e in shape["ctrl"]]
            anchors = [a, t]
        elif how == "occlusal":
            mol, front = _point(p, "MOL"), _point(p, "U1T+L1T")
            if mol is None or front is None or g.dist(mol, front) <= 0:
                continue
            ctrl = _place(shape, _frame(mol, front - mol, px_per_mm), p)
            anchors = ["MOL", "U1T", "L1T"]
        elif how == "cranial":
            at, s, n = uses
            if at not in p or s not in p or n not in p or g.dist(p[s], p[n]) <= 0:
                continue
            # turned with S-N (the textbook's S-N is 7° to FH like most x-rays') and at the x-ray's own scale
            ctrl = _place(shape, _frame(p[at], np.asarray(p[n], float) - np.asarray(p[s], float), px_per_mm), p)
            anchors = sorted({at, s, n})
        if ctrl is None or any(c is None for c in ctrl):
            continue
        out.append(dict(key=key, name=name, group=group, closed=closed, ctrl=ctrl, anchors=anchors))
    return out


# ------------------------------------------------------------------------------------------------- the skin's edge
PROFILE = ("Tr", "Gs", "Prn", "Sn", "Ls", "Stms", "Stmi", "Li", "Pos", "Mes")
WORK_MM = 0.2                 # the profile is followed on a copy of the x-ray at about this many mm a pixel
EDGE_CONTRAST = 3.0           # a stretch counts as followed when its edge is this many times the corridor's typical
CURVE_TOL_MM = 0.6            # the curve through the profile's dots stays this close to the edge it followed
DOT_GAP_MM = 3.0              # ... with its free dots at least this far apart (fewer dots to drag)


def _bilinear(a, xs, ys):
    H, W = a.shape
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 2)
    fx, fy = np.clip(xs - x0, 0, 1), np.clip(ys - y0, 0, 1)
    v = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy
         + a[y0 + 1, x0 + 1] * fx * fy)
    inside = (xs >= 0) & (xs <= W - 1) & (ys >= 0) & (ys <= H - 1)
    return np.where(inside, v, 0.0)


def _path(grad, p0, p1, half_px, k=3, smooth=0.08):
    """The cheapest path from p0 to p1 through strong edges, as offsets across the chord (a column per pixel along
    it). Returns (points (n, 2) in grad pixels, the edge along it against the corridor's typical gradient: about 1-2
    for noise, well above 3 for a real edge)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    L = g.dist(p0, p1)
    n = max(8, int(math.ceil(L)))
    a = (p1 - p0) / L
    b = np.array([-a[1], a[0]])
    m = max(3, int(round(half_px)))
    us = np.linspace(0.0, L, n + 1)
    vs = np.arange(-m, m + 1, dtype=float)
    X = p0[0] + us[:, None] * a[0] + vs[None, :] * b[0]
    Y = p0[1] + us[:, None] * a[1] + vs[None, :] * b[1]
    G = _bilinear(grad, X, Y)
    ref = float(np.percentile(G, 92)) or 1.0
    C = 1.0 / (1.0 + (G / ref) ** 2)                     # cheap on strong edges
    INF = 1e18
    E = np.full(2 * m + 1, INF)
    E[m] = C[0, m]
    back = np.zeros((n + 1, 2 * m + 1), np.int8)
    du = L / n
    for i in range(1, n + 1):
        best = np.full(2 * m + 1, INF)
        arg = np.zeros(2 * m + 1, np.int8)
        for d in range(-k, k + 1):
            prev = np.full(2 * m + 1, INF)
            if d >= 0:
                prev[d:] = E[:2 * m + 1 - d] if d else E
            else:
                prev[:d] = E[-d:]
            step = (C[i] + np.roll(C[i - 1], d)) / 2 * math.hypot(du, d) + smooth * d * d
            cand = prev + step
            better = cand < best
            best[better], arg[better] = cand[better], d
        E, back[i] = best, arg
    j = m                                                 # ends on p1
    js = [j]
    for i in range(n, 0, -1):
        j -= int(back[i, j])
        js.append(j)
    js = np.array(js[::-1])
    path = np.stack([X[np.arange(n + 1), js], Y[np.arange(n + 1), js]], 1)
    contrast = float(G[np.arange(n + 1), js].mean() / (np.median(G) + 1e-6))
    return path, contrast


def _simplify(pts, tol):
    """Douglas-Peucker: the indices kept (the end points always)."""
    pts = np.asarray(pts, float)
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        L = math.hypot(*ab)
        seg = pts[i + 1:j]
        d = np.hypot(*(seg - a).T) if L == 0 else np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / L
        k = int(np.argmax(d))
        if d[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return np.flatnonzero(keep)


def _dist_to_curve(pts, curve):
    """For each point, its distance to the polyline `curve`."""
    pts, curve = np.asarray(pts, float), np.asarray(curve, float)
    a, b = curve[:-1], curve[1:]
    ab = b - a
    L2 = np.maximum((ab ** 2).sum(1), 1e-12)
    t = np.clip((((pts[:, None, :] - a[None]) * ab[None]).sum(-1)) / L2[None], 0, 1)
    foot = a[None] + t[..., None] * ab[None]
    return np.sqrt(((pts[:, None, :] - foot) ** 2).sum(-1)).min(1)


def soft_profile(img, pts_px, mm_per_px):
    """The skin's edge from the top of the forehead to soft-tissue menton (whichever of those points are on the
    x-ray). img: greyscale array. Returns dict(ctrl [code | (x, y) image pixels], dense (the edge followed, image
    pixels), traced: share of the length followed on the x-ray, anchors) or None."""
    chain = [c for c in PROFILE if c in pts_px]
    if len(chain) < 2:
        return None
    P = {c: np.asarray(pts_px[c], float) for c in chain}
    H, W = img.shape
    mm = float(mm_per_px or 0.1)
    work = max(1.0, WORK_MM / mm)                         # original pixels per work pixel
    xy = np.array(list(P.values()))
    pad = 14.0 / mm
    x0, y0 = int(max(0, xy[:, 0].min() - pad)), int(max(0, xy[:, 1].min() - pad))
    x1, y1 = int(min(W, xy[:, 0].max() + pad)), int(min(H, xy[:, 1].max() + pad))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    crop = Image.fromarray(np.ascontiguousarray(img[y0:y1, x0:x1]))
    if work > 1.0:
        crop = crop.resize((max(8, round((x1 - x0) / work)), max(8, round((y1 - y0) / work))), Image.BILINEAR)
    kx, ky = crop.size[0] / (x1 - x0), crop.size[1] / (y1 - y0)
    a = np.asarray(crop.filter(ImageFilter.GaussianBlur(radius=max(1.0, 0.4 / (mm * work)))), np.float64)
    gy, gx = np.gradient(a)
    grad = np.hypot(gx, gy)
    to_w = lambda q: np.array([(q[0] - x0 + 0.5) * kx - 0.5, (q[1] - y0 + 0.5) * ky - 0.5])       # noqa: E731
    from_w = lambda q: np.stack([(q[:, 0] + 0.5) / kx - 0.5 + x0, (q[:, 1] + 0.5) / ky - 0.5 + y0], 1)   # noqa: E731
    px_mm = 1.0 / (mm * work)                             # work pixels per mm
    segs, followed, total = [], 0.0, 0.0
    for c0, c1 in zip(chain, chain[1:]):
        p0, p1 = P[c0], P[c1]
        L_mm = g.dist(p0, p1) * mm
        total += L_mm
        if (c0, c1) == ("Stms", "Stmi") or L_mm < 1.5:   # across the gap between the lips (or too short to follow)
            segs.append(None)
            followed += L_mm
            continue
        half = min(10.0, max(3.0, 0.35 * L_mm)) * px_mm
        path, contrast = _path(grad, to_w(p0), to_w(p1), half)
        if contrast >= EDGE_CONTRAST:
            seg = from_w(path)
            seg[0], seg[-1] = p0, p1
            segs.append(seg)
            followed += L_mm
        else:                                            # no clear edge here: the curve through the points alone
            segs.append(None)
    # the dots: the points, and between two of them as few as keep the curve on the edge followed
    def spaced(seg, idx):
        """Dots no closer than DOT_GAP_MM to each other or to the segment's ends."""
        keep, last = [], seg[0]
        for j in idx:
            if g.dist(seg[j], last) * mm >= DOT_GAP_MM and g.dist(seg[j], seg[-1]) * mm >= DOT_GAP_MM:
                keep.append(j)
                last = seg[j]
        return keep
    inner = [spaced(seg, [int(j) for j in _simplify(seg, 0.45 / mm)[1:-1]]) if seg is not None and len(seg) > 2 else []
             for seg in segs]

    def build():
        ctrl = [chain[0]]
        for i, seg in enumerate(segs):
            ctrl += [seg[j] for j in inner[i]]
            ctrl.append(chain[i + 1])
        return ctrl

    def xy_of(c):
        return P[c] if isinstance(c, str) else c
    for _ in range(8):                                   # where the curve strays from the edge, a dot more there
        curve = spline([xy_of(c) for c in build()])
        worst = None
        for i, seg in enumerate(segs):
            if seg is None:
                continue
            d = _dist_to_curve(seg, curve)
            j = int(np.argmax(d))
            if d[j] * mm > CURVE_TOL_MM and j not in inner[i] and 0 < j < len(seg) - 1 and (worst is None or d[j] > worst[0]):
                worst = (d[j], i, j)
        if worst is None:
            break
        i, j = worst[1], worst[2]
        seg = segs[i]
        if any(g.dist(seg[j], seg[k]) * mm < 0.5 * DOT_GAP_MM for k in inner[i] + [0, len(seg) - 1]):
            break                                        # dots already close by: good enough
        inner[i] = sorted(inner[i] + [j])
    dense = [s for s in segs if s is not None]
    return dict(ctrl=build(), dense=np.vstack(dense) if dense else None,
                traced=round(followed / total, 2) if total else 0.0, anchors=chain)


# ------------------------------------------------------------------------------------------------- everything
def _clean_saved(entries, pts, w=None, h=None):
    """Saved dots: landmark codes the x-ray has, and [x, y] numbers. None when not usable."""
    out = []
    for e in entries or []:
        if isinstance(e, str):
            if e in pts:
                out.append(e)
        elif isinstance(e, (list, tuple)) and len(e) == 2:
            try:
                out.append([float(e[0]), float(e[1])])
            except (TypeError, ValueError):
                continue
    return out if len(out) >= 2 else None


def outlines(img, pts_px, facing, mm_per_px, saved=None):
    """Every outline for an x-ray: [dict(key, name, group, closed, ctrl [code | [x, y] image pixels], xy (every dot,
    image pixels), adjusted (dots placed by hand), anchors, traced)]. saved: {key: dots} moved by hand."""
    pts = {k: v for k, v in (pts_px or {}).items() if v is not None}
    if not pts:
        return []
    saved = saved or {}
    facing = facing or g.facing_of(pts) or "right"
    can = g.to_canonical(pts, facing)
    if mm_per_px:
        px_per_mm = 1.0 / float(mm_per_px)
    elif "S" in can and "N" in can and g.dist(can["S"], can["N"]) > 0:
        px_per_mm = g.dist(can["S"], can["N"]) / SN_MM
    else:
        px_per_mm = 10.0
    sx = 1.0 if facing != "left" else -1.0

    def item(key, name, group, ctrl, anchors, adjusted, traced=None):
        ctrl = [c if isinstance(c, str) else [round(float(c[0]), 1), round(float(c[1]), 1)] for c in ctrl]
        xy = [[round(float(pts[c][0]), 1), round(float(pts[c][1]), 1)] if isinstance(c, str) else c for c in ctrl]
        return dict(key=key, name=name, group=group, closed=CLOSED.get(key, False), ctrl=ctrl, xy=xy,
                    adjusted=adjusted, anchors=anchors, traced=traced)

    out = []
    for o in anatomy(can, px_per_mm):
        mine = _clean_saved(saved.get(o["key"]), pts)
        if mine:
            out.append(item(o["key"], o["name"], o["group"], mine, o["anchors"], True))
            continue
        ctrl = [c if isinstance(c, str) else (sx * float(c[0]), -float(c[1])) for c in o["ctrl"]]   # back to the image
        out.append(item(o["key"], o["name"], o["group"], ctrl, o["anchors"], False))
    mine = _clean_saved(saved.get(PROFILE_KEY), pts)
    if mine:
        out.append(item(PROFILE_KEY, PROFILE_NAME, "soft", mine, [c for c in mine if isinstance(c, str)], True))
    elif img is not None:
        try:
            sp = soft_profile(img, pts, mm_per_px or (1.0 / px_per_mm))
        except (ValueError, FloatingPointError, np.linalg.LinAlgError):
            sp = None
        if sp:
            out.append(item(PROFILE_KEY, PROFILE_NAME, "soft", sp["ctrl"], sp["anchors"], False, sp["traced"]))
    return out
