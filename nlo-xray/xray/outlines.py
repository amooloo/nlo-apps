"""Outlines on a tracing - smooth curves through a few dots, the way tracing software draws them.

Each outline is a list of control dots. Some are the doctor's landmarks (Go, Me, Pog, ...): the curve passes through
them and follows them when they move. The rest are free dots in between, which he can drag to fit the curve to the
x-ray. The curve through the dots is a centripetal Catmull-Rom spline (no loops or overshoot at close dots), drawn by
the page; `spline` here is the same curve, for the tests.

Until a dot is moved by hand the free dots are placed automatically:
- the soft-tissue profile (forehead to chin) follows the skin's edge on the x-ray itself, from one soft-tissue point
  to the next: the cheapest path through the strongest edges with air in front of them (the skin, not the bone
  behind it) in a corridor round the line joining the points, then as few dots as keep the curve within half a
  millimetre of it. Where the x-ray shows no clear edge (a burnt-out profile, a rod across it) that stretch is a smooth
  curve through the points instead;
- the bones - mandible (ramus, coronoid, condyle, angle, lower border, chin), the inner side of the symphysis, maxilla
  and palate, sella turcica, the frontal and nasal bones, the orbit, the pterygomaxillary fissure and the ear rod -
  start as a textbook tracing carried onto the x-ray through the doctor's points: a thin-plate spline through the
  points a bone outline uses (it passes exactly through them and bends smoothly in between), the small cranial
  structures at their landmark at real size, turned with Frankfort horizontal (sella with S-N). Then the stretches
  where a bone shows a clear edge on the x-ray - sella, the back of the ramus and the lower border of the mandible,
  the inside of the symphysis, the front of the frontal bone - are pulled onto that edge (within 2-2.5 mm, on the
  side where the bone is: `snap`); where the mandible shows twice (its two sides), midway between the two lines.
  The condyle, coronoid and the outlines that overlap other bones keep the textbook shape; where the x-ray is
  different, the x-ray is right - drag the dots;
- the teeth (incisors and first molars) keep their shape: each is one piece, moved, turned and sized as a whole.
  An incisor is carried along its apex-tip axis at its length (the doctor's two points); a molar sits on the occlusal
  plane at real size until he moves it, then wherever he put its two handles (crown and root).
Once a dot of a bone outline is moved, that outline's dots are kept as he left them (case["contours"][key]: landmark
codes, and [x, y] image pixels for the free dots); a molar keeps its two handles there. "Redraw from the points"
forgets them.

Everything below works in the canonical frame (x forward, y up) and hands back image pixels.
"""
import math
import weakref

import numpy as np
from PIL import Image, ImageFilter

from . import geometry as g

SN_MM = 68.0                  # assumed S-N length for an x-ray without a pixel size
SN_TO_FH = 7.0                # textbook S-N to Frankfort, degrees (turns the cranial structures without Po or Or)

# ------------------------------------------------------------------------------------------------- the textbook tracing
# A textbook adolescent tracing, canonical mm (sella at the origin, x forward, y up, Frankfort horizontal level):
# SNA 80.5, SNB 78.7, FMA 25, gonial angle 128, U1-SN 103, IMPA 93, lower third 55 % of N-Me, occlusal plane 7° to FH.
# Its points are its own (consistent with the outlines drawn round them); the x-ray's points place it. The outlines
# were redrawn (1.8) after a real tracing: a wide ramus with the coronoid well forward of the condyle, a straight lower
# border, the palate's nasal floor rising behind ANS, the orbit as its back rim and floor, a narrow fissure.
DRAW = {
    "S": (0.0, 0.0), "N": (69.5, 8.5), "Or": (56.0, -22.0), "Po": (-18.0, -22.0), "Ar": (-13.0, -30.0),
    "PNS": (22.0, -43.0), "ANS": (72.0, -42.0), "A": (67.0, -48.0),
    "U1A": (61.5, -48.5), "U1T": (70.0, -71.5), "L1T": (67.5, -69.0), "L1A": (57.65, -87.54),
    "B": (62.2, -88.5), "Pog": (64.0, -96.5), "Gn": (61.5, -101.5), "Me": (57.0, -104.0),
    "Go": (-5.0, -72.0), "MPt": (3.0, -78.8), "MOL": (40.0, -66.5),
}

# The control dots of an outline, mm; a landmark code stands for that landmark. A dot (x, y, r) is pulled onto the
# x-ray's edge by up to r mm (instead of the outline's own range; 0: never moved).
_MANDIBLE = [
    (20.0, -58.0, 0), (19.5, -49.0, 0),                              # front of the ramus, from behind the molars
    (28.5, -31.5, 0), (20.5, -35.5, 0),                              # coronoid process
    (7.5, -39.0, 0),                                                 # sigmoid notch
    (-2.0, -33.0, 0), (-4.0, -25.0, 0), (-9.5, -25.5, 0),            # condyle
    "Ar", (-11.0, -43.0), (-11.0, -62.5), "Go", "MPt",               # back of the ramus, the angle
    (16.0, -86.0), (29.0, -93.0), (42.5, -99.5), (52.0, -102.5),     # lower border
    "Me", "Gn", "Pog", "B",                                          # chin
    (66.5, -78.5, 0),                                                # alveolar crest over the lower incisor
]
_SYMPHYSIS = [(58.5, -77.5, 0), (55.0, -85.0), (49.0, -93.0), (48.5, -99.0, 0.8)]
_MAXILLA = [
    (70.0, -60.5), (68.0, -52.5), "A", "ANS",                        # alveolar process, A point, the spine
    (66.0, -40.0), (60.5, -36.5), (56.5, -38.5), (47.5, -40.5), (39.0, -40.5), (30.0, -41.0), "PNS",   # nasal floor
    (33.5, -43.5), (47.5, -47.5), (55.0, -53.5), (61.0, -61.0),      # oral side of the palate
]
# A tooth: its apex and tip (landmarks) and dots at (mm from the apex along the axis, mm across it, + = labial), at
# the textbook tooth's length; carried along the doctor's axis at his length.
_U1 = dict(length=24.5, ctrl=["U1A", (5, 1.8), (12.5, 3.1), (17, 3.45), (21.5, 2.5), (23.8, 1.1), "U1T",
                              (23.3, -1.0), (20, -1.9), (16, -3.6), (12, -2.9), (5, -1.6)])
_L1 = dict(length=21.0, ctrl=["L1A", (5, 1.6), (11, 2.8), (15, 2.85), (18.8, 1.8), (20.5, 0.7), "L1T",
                              (19.8, -1.0), (16, -2.4), (13, -3.1), (9, -2.4), (4, -1.3)])
# The first molars round the molar contact: (mm forward along the occlusal plane, mm up from it), real size. The
# handles: the middle of the crown's chewing surface and the end of the roots - dragged to move, turn and size it.
_UPPER_MOLAR = dict(handles=((-4.3, 0.4), (-4.4, 17.5)), ctrl=[
    (0.0, 0.0), (-2.6, 0.9), (-5.4, 0.1), (-8.6, 1.4), (-9.6, 4.0), (-8.6, 7.2), (-8.0, 12.5), (-6.9, 17.0),
    (-5.6, 13.0), (-4.3, 9.6), (-3.0, 13.5), (-1.9, 18.0), (-0.4, 13.0), (0.4, 7.4), (1.2, 4.0), (0.8, 1.2)])
_LOWER_MOLAR = dict(handles=((-3.4, -0.4), (-4.3, -19.5)), ctrl=[
    (1.0, 0.0), (-1.8, -0.9), (-4.2, 0.0), (-6.8, -0.4), (-8.4, -1.6), (-9.2, -4.0), (-8.4, -7.6), (-8.2, -13.5),
    (-7.3, -19.0), (-5.8, -14.0), (-4.3, -10.0), (-2.8, -14.5), (-1.4, -20.0), (0.5, -14.0), (1.4, -7.8),
    (2.6, -4.0), (2.2, -1.3)])
# Small cranial structures round their landmark: (mm forward, mm up), real size - along S-N for sella, along
# Frankfort horizontal for the rest.
_SELLA = [(16.0, 5.0), (6.8, 3.6), (5.5, 0.0), (3.6, -4.0), (0.0, -5.5), (-3.8, -3.9), (-5.4, 0.0), (-4.9, 3.8),
          (-3.0, 5.9)]
_NASION = [(3.5, 18.0), (1.5, 9.0), "N", (0.5, -7.0, 0), (2.5, -13.0, 0), (7.5, -21.0, 0)]
_ORBIT = [(-7.5, 30.5), (-9.5, 20.5), (-9.0, 12.0), (-6.0, 3.0), "Or", (5.5, 3.5)]
_PTM = [(-2.5, 9.5), (-1.0, 18.0), (-1.0, 24.0), (-2.5, 26.0), (-5.0, 23.5), (-4.5, 18.0), (-3.0, 13.0)]
_EAR = ["Po", (-3.0, -2.0), (-1.0, -5.0), (2.0, -3.0)]

# key, name, group (its colour), how it is placed, the points that place it, its dots, closed, snapping: (how the edge
# looks - "edge": the steepest change, "onset": where the bright side starts -, the side the bone is on - 1: left of
# the way the dots run, -1: right -, mm it may move[, "double": seen twice, the curve goes midway]) or None
STRUCTURES = [
    ("mandible", "Mandible", "mandible", "spline", ("Ar", "Go", "MPt", "Me", "Gn", "Pog", "B", "L1A", "L1T", "MOL"),
     _MANDIBLE, False, ("edge", 1, 2.5, "double")),
    ("symphysis", "Symphysis, inner side", "mandible", "spline", ("Me", "Gn", "Pog", "B", "L1A", "L1T", "MPt"),
     _SYMPHYSIS, False, ("edge", 1, 2.0)),
    ("maxilla", "Maxilla and palate", "maxilla", "spline", ("ANS", "A", "PNS", "U1A", "U1T", "MOL"), _MAXILLA, False,
     None),
    ("u1", "Upper incisor", "teeth", "tooth", ("U1A", "U1T"), _U1, True, None),
    ("l1", "Lower incisor", "teeth", "tooth", ("L1A", "L1T"), _L1, True, None),
    ("u6", "Upper first molar", "teeth", "molar", ("MOL", "U1T", "L1T"), _UPPER_MOLAR, True, None),
    ("l6", "Lower first molar", "teeth", "molar", ("MOL", "U1T", "L1T"), _LOWER_MOLAR, True, None),
    ("sella", "Sella turcica", "cranial", "cranial", ("S", "SN"), _SELLA, False, ("edge", 1, 2.0)),
    ("nasion", "Frontal and nasal bones", "cranial", "cranial", ("N", "FH"), _NASION, False, ("edge", -1, 2.0)),
    ("orbit", "Orbit", "cranial", "cranial", ("Or", "FH"), _ORBIT, False, None),
    ("ptm", "Pterygomaxillary fissure", "cranial", "cranial", ("PNS", "FH"), _PTM, True, None),
    ("ear", "Ear rod (porion)", "cranial", "cranial", ("Po", "FH"), _EAR, True, None),
]
PROFILE_KEY, PROFILE_NAME = "profile", "Soft-tissue profile"
NAMES = dict([(s[0], s[1]) for s in STRUCTURES] + [(PROFILE_KEY, PROFILE_NAME)])
CLOSED = {s[0]: s[6] for s in STRUCTURES}
CLOSED[PROFILE_KEY] = False
# the teeth are moved as a whole: an incisor by its two points, a molar by its two handles
UNITS = {s[0]: ("points" if s[3] == "tooth" else "handles") for s in STRUCTURES if s[3] in ("tooth", "molar")}


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


def _similarity(a0, b0, a1, b1):
    """The move, turn and size taking points a0, b0 to a1, b1 (any frame): f(points) -> points."""
    a0, b0, a1, b1 = (np.asarray(v, float) for v in (a0, b0, a1, b1))
    u, v = b0 - a0, b1 - a1
    s = g.norm(v) / max(g.norm(u), 1e-9)
    t = math.atan2(v[1], v[0]) - math.atan2(u[1], u[0])
    R = s * np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
    return lambda pts: (np.asarray(pts, float).reshape(-1, 2) - a0) @ R.T + a1


def _point(p, code):
    if "+" in code:
        a, b = code.split("+")
        return (np.asarray(p[a], float) + np.asarray(p[b], float)) / 2.0 if a in p and b in p else None
    return np.asarray(p[code], float) if code in p else None


def _size(xy):
    xy = np.asarray(xy, float)
    return float(np.hypot(*(xy.max(0) - xy.min(0)))) or 1.0


def _xy(e):
    """A template dot's position (a dot may carry its snapping range as a third number)."""
    return (float(e[0]), float(e[1]))


def _range(e, default):
    return 0.0 if isinstance(e, str) else (float(e[2]) if len(e) > 2 else default)


def _place(entries, f, p):
    """Control dots -> [code | canonical (x, y)]: a landmark entry stays a code when the x-ray has that landmark."""
    out = []
    free = [_xy(e) for e in entries if not isinstance(e, str)]
    xy = iter(f(free)) if free else iter(())
    for e in entries:
        if isinstance(e, str):
            out.append(e if e in p else None)
        else:
            out.append(np.asarray(next(xy), float))
    return out


def _fh_direction(p):
    """Forward along Frankfort horizontal (Po -> Or); without them S-N turned down by the textbook 7 degrees."""
    if "Po" in p and "Or" in p and g.dist(p["Po"], p["Or"]) > 0:
        return np.asarray(p["Or"], float) - np.asarray(p["Po"], float)
    if "S" in p and "N" in p and g.dist(p["S"], p["N"]) > 0:
        d = np.asarray(p["N"], float) - np.asarray(p["S"], float)
        t = math.radians(-SN_TO_FH)
        return np.array([d[0] * math.cos(t) - d[1] * math.sin(t), d[0] * math.sin(t) + d[1] * math.cos(t)])
    return None


def molar_frame(p, px_per_mm):
    """The molars' frame: at the molar contact, along the occlusal plane, real size (None without the points)."""
    mol, front = _point(p, "MOL"), _point(p, "U1T+L1T")
    if mol is None or front is None or g.dist(mol, front) <= 0:
        return None
    return _frame(mol, front - mol, px_per_mm)


def anatomy(p, px_per_mm, handles=None):
    """The textbook outlines' control dots on canonical points p (pixels). px_per_mm: the x-ray's scale. handles:
    {molar key: (crown, root) canonical pixels} for the molars moved by hand.
    Returns [dict(key, name, group, closed, ctrl [code | canonical (x, y)], anchors, ranges (mm per dot), snap,
    handles (molars: crown and root, canonical))]."""
    out = []
    handles = handles or {}
    for key, name, group, how, uses, shape, closed, snap in STRUCTURES:
        ctrl, anchors, hd = None, [], None
        entries = shape["ctrl"] if isinstance(shape, dict) else shape
        if how == "spline":
            anchors = [c for c in uses if c in p and c in DRAW]
            if len(anchors) < 3:
                continue
            src, dst = [DRAW[c] for c in anchors], [p[c] for c in anchors]
            tmpl = np.array([DRAW[e] if isinstance(e, str) else _xy(e) for e in entries], float)
            try:
                warped, plain = tps(src, dst)(tmpl), _affine(src, dst)(tmpl)
            except (np.linalg.LinAlgError, ValueError):
                continue
            # a doctor's points far from any textbook shape (or two on top of each other) can fold the spline: then
            # the outline is only moved, turned and stretched to them
            if not np.all(np.isfinite(warped)) or np.abs(warped - plain).max() > 0.35 * _size(plain):
                warped = plain
            ctrl = [e if isinstance(e, str) and e in p else warped[i] for i, e in enumerate(entries)]
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
                    for e in entries]
            anchors = [a, t]
        elif how == "molar":
            f = molar_frame(p, px_per_mm)
            if f is None:
                continue
            c0, r0 = (np.asarray(h, float) for h in f(shape["handles"]))
            if key in handles:                        # where the doctor put it: the same tooth, moved, turned, sized
                c1, r1 = (np.asarray(h, float) for h in handles[key])
                if g.dist(c1, r1) > 0:
                    f = (lambda f0, m: (lambda pts: m(f0(pts))))(f, _similarity(c0, r0, c1, r1))
                    c0, r0 = c1, r1
            ctrl = [np.asarray(v, float) for v in f([_xy(e) for e in entries])]
            hd = [c0, r0]
            anchors = ["MOL", "U1T", "L1T"]
        elif how == "cranial":
            at, ref = uses
            if at not in p:
                continue
            if ref == "SN":
                d = (np.asarray(p["N"], float) - np.asarray(p["S"], float)) if "S" in p and "N" in p else None
                anchors = sorted({at, "S", "N"})
            else:
                d = _fh_direction(p)
                anchors = sorted({at} | ({"Po", "Or"} if "Po" in p and "Or" in p else {"S", "N"}))
            if d is None or g.norm(d) <= 0:
                continue
            ctrl = _place(entries, _frame(p[at], d, px_per_mm), p)
        if ctrl is None or any(c is None for c in ctrl):
            continue
        default = snap[2] if snap else 0.0
        out.append(dict(key=key, name=name, group=group, closed=closed, ctrl=ctrl, anchors=anchors,
                        ranges=[_range(e, default) if snap else 0.0 for e in entries], snap=snap, handles=hd))
    return out


# ------------------------------------------------------------------------------------------------- onto the x-ray's edges
SNAP_STEP_MM = 0.5            # samples along an outline
SNAP_DELTA_MM = 0.1           # ... and across it
SNAP_SLOPE = 1.5              # cost of bending away from the outline's own course (per sample, at a slope of 1)
SNAP_PRIOR = 0.15             # cost of moving 3 mm off the textbook course (per sample)
SNAP_MAX_SLOPE = 1.2          # the curve turns at most this much across per unit along, between two samples
DOUBLE_MM = (1.0, 5.0)        # a bone seen twice (left and right sides): two like edges this far apart...
DOUBLE_ALIKE = 0.5            # ... the weaker at least half the stronger: the curve goes midway between them
DOUBLE_WEIGHT = 1.5


class _Edges:
    """An x-ray made ready for snapping: lightly smoothed, with its typical strong edge (to compare edges against)."""

    def __init__(self, img, mm_per_px):
        self.mm = float(mm_per_px)
        im = Image.fromarray(np.ascontiguousarray(np.asarray(img, np.uint8)))
        self.a = np.asarray(im.filter(ImageFilter.GaussianBlur(radius=max(1.0, 0.3 / self.mm))), np.float64)
        sub = self.a[::4, ::4]
        gy, gx = np.gradient(sub)
        self.scale = float(np.percentile(np.hypot(gx, gy), 95)) / 4.0 or 1.0


_EDGES = {}                   # id(image) -> (weak reference to it, mm per pixel, _Edges): the last few x-rays


def _edges(img, mm_per_px):
    key = id(img)
    hit = _EDGES.get(key)
    if hit and hit[0]() is img and hit[1] == mm_per_px:
        return hit[2]
    e = _Edges(img, mm_per_px)
    if len(_EDGES) >= 6:
        _EDGES.pop(next(iter(_EDGES)))
    try:
        _EDGES[key] = (weakref.ref(img), mm_per_px, e)
    except TypeError:
        pass
    return e


def _bilinear(a, xs, ys):
    H, W = a.shape
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 2)
    fx, fy = np.clip(xs - x0, 0, 1), np.clip(ys - y0, 0, 1)
    v = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy
         + a[y0 + 1, x0 + 1] * fx * fy)
    inside = (xs >= 0) & (xs <= W - 1) & (ys >= 0) & (ys <= H - 1)
    return np.where(inside, v, 0.0)


def _samples(xy, step):
    """Points about `step` apart along the curve through dots xy (open); each dot is one of them. -> pts, dot index."""
    curve = spline(xy, False, per=40)                 # through dot k at index 40k
    pts, idx = [], []
    for k in range(len(xy) - 1):
        seg = curve[40 * k:40 * k + 41]
        s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(seg, axis=0).T))])
        m = max(1, int(round(s[-1] / step)))
        st = np.linspace(0.0, s[-1], m + 1)[:-1]
        idx.append(len(pts))
        pts.extend(np.c_[np.interp(st, s, seg[:, 0]), np.interp(st, s, seg[:, 1])])
    idx.append(len(pts))
    pts.append(np.asarray(xy[-1], float))
    return np.array(pts), idx


def snap(img, xy, ranges, mode, polarity, sx, mm_per_px, iters=2, double=False):
    """Pull an open outline's dots onto the x-ray's edge. xy: dots (canonical pixels); ranges: how far each may move
    (mm; 0 keeps it - a landmark, or a stretch that overlaps other bones); mode "edge" (the steepest change) or
    "onset" (where the bright side begins: the inside of a fossa); polarity 1 when the bone is on the left of the
    way the dots run, -1 on the right; sx: -1 for an x-ray facing left. The curve is the cheapest path across the
    edges (dynamic programming), kept smooth and near its course. double: the bone may show twice (the two sides of
    the mandible): where two like edges run side by side, the curve goes midway between them, as the doctor traces
    it. Returns the dots moved and the share of the outline that found an edge."""
    E = _edges(img, mm_per_px)
    mm = E.mm
    xy = [np.asarray(p, float) for p in xy]
    rng = np.asarray(ranges, float)
    found = 0.0
    for it in range(iters):
        pts, idx = _samples(xy, SNAP_STEP_MM / mm)
        n = len(pts)
        t = np.gradient(pts, axis=0)
        t /= np.maximum(np.hypot(*t.T), 1e-9)[:, None]
        nrm = np.c_[-t[:, 1], t[:, 0]]                # left of the way the dots run (canonical: y up)
        r_dot = rng * (1.0 if it == 0 else 0.6)
        r = np.zeros(n)
        for k in range(len(xy) - 1):
            a, b = idx[k], idx[k + 1]
            r[a:b] = r_dot[k] + (r_dot[k + 1] - r_dot[k]) * np.arange(b - a) / max(b - a, 1)
        r[-1] = r_dot[-1]
        if r.max() <= 0:
            return xy, 0.0
        M = int(math.ceil(r.max() / SNAP_DELTA_MM))
        Mx = M + int(math.ceil(((DOUBLE_MM[1] / 2 if double else 0.0) + 0.7) / SNAP_DELTA_MM))   # looked at
        off = np.arange(-Mx, Mx + 1) * SNAP_DELTA_MM / mm         # pixels across
        X = pts[:, 0:1] + nrm[:, 0:1] * off[None]
        Y = pts[:, 1:2] + nrm[:, 1:2] * off[None]
        V = _bilinear(E.a, sx * X, -Y)
        dpx = SNAP_DELTA_MM / mm
        w = max(1, int(round(0.6 / SNAP_DELTA_MM)))
        S = np.zeros_like(V)
        if mode == "onset":                            # bright starts right after, flat right before
            if polarity > 0:
                rise, before = V[:, 2 * w:] - V[:, w:-w], V[:, w:-w] - V[:, :-2 * w]
            else:
                rise, before = V[:, :-2 * w] - V[:, w:-w], V[:, w:-w] - V[:, 2 * w:]
            S[:, w:-w] = (np.maximum(rise, 0) - np.abs(before)) / (w * dpx)
        else:
            S[:, 1:-1] = polarity * (V[:, 2:] - V[:, :-2]) / (2 * dpx)
        S = np.maximum(S, 0) / E.scale                 # 1: as strong as this x-ray's strong edges
        strength = lambda v: 1.5 * v / (v + 0.5)        # noqa: E731 - levels off, but its peak stays the peak
        if double:                                     # midway between two like edges
            S2 = np.zeros_like(S)
            for h in range(int(round(DOUBLE_MM[0] / 2 / SNAP_DELTA_MM)), int(round(DOUBLE_MM[1] / 2 / SNAP_DELTA_MM)) + 1):
                lo, hi = S[:, :-2 * h], S[:, 2 * h:]
                weak, strong = np.minimum(lo, hi), np.maximum(lo, hi)
                S2[:, h:-h] = np.maximum(S2[:, h:-h], np.where(weak >= DOUBLE_ALIKE * strong, weak, 0.0))
            S = np.maximum(strength(S), DOUBLE_WEIGHT * strength(S2))
        else:
            S = strength(S)
        S, off = S[:, Mx - M:Mx + M + 1], off[Mx - M:Mx + M + 1]   # where the curve may go
        tmm = off * mm
        U = -S + SNAP_PRIOR * (tmm / 3.0) ** 2
        U[np.abs(tmm)[None, :] > r[:, None] + 1e-9] = np.inf
        K = max(1, int(math.floor(SNAP_MAX_SLOPE * SNAP_STEP_MM / SNAP_DELTA_MM)))
        cost = U[0].copy()
        back = np.zeros((n, 2 * M + 1), np.int16)
        pen = [SNAP_SLOPE * (d * SNAP_DELTA_MM / SNAP_STEP_MM) ** 2 for d in range(-K, K + 1)]
        for q in range(1, n):
            best = np.full(2 * M + 1, np.inf)
            arg = np.zeros(2 * M + 1, np.int16)
            for d, pd in zip(range(-K, K + 1), pen):
                if d > 0:
                    c = np.full(2 * M + 1, np.inf)
                    c[d:] = cost[:-d]
                elif d < 0:
                    c = np.full(2 * M + 1, np.inf)
                    c[:d] = cost[-d:]
                else:
                    c = cost
                c = c + pd
                better = c < best
                best[better], arg[better] = c[better], d
            cost = best + U[q]
            back[q] = arg
        j = int(np.argmin(cost))
        if not np.isfinite(cost[j]):
            return [np.asarray(p, float) for p in xy], 0.0
        js = [j]
        for q in range(n - 1, 0, -1):
            j -= int(back[q, j])
            js.append(j)
        js = np.array(js[::-1])
        moved = pts + nrm * off[js][:, None]
        ok = r > 0
        found = float((S[np.arange(n), js][ok] > 0.5).mean()) if ok.any() else 0.0
        xy = [moved[i] if rng[k] > 0 else xy[k] for k, i in enumerate(idx)]
    return xy, found


# ------------------------------------------------------------------------------------------------- the skin's edge
PROFILE = ("Tr", "Gs", "Prn", "Sn", "Ls", "Stms", "Stmi", "Li", "Pos", "Mes")
WORK_MM = 0.2                 # the profile is followed on a copy of the x-ray at about this many mm a pixel
EDGE_CONTRAST = 3.0           # a stretch counts as followed when its edge is this many times the corridor's typical
CURVE_TOL_MM = 0.6            # the curve through the profile's dots stays this close to the edge it followed
DOT_GAP_MM = 3.0              # ... with its free dots at least this far apart (fewer dots to drag)
AIR_MM = 1.2                  # the skin has air within this distance (the bone's edge behind it has skin)


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


def _darkest(a, r):
    """The darkest value within r pixels (a square), for every pixel."""
    from numpy.lib.stride_tricks import sliding_window_view
    p = np.pad(a, r, mode="edge")
    m = sliding_window_view(p, 2 * r + 1, axis=1).min(-1)
    return sliding_window_view(m, 2 * r + 1, axis=0).min(-1)


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
    blur = crop.filter(ImageFilter.GaussianBlur(radius=max(1.0, 0.4 / (mm * work))))
    a = np.asarray(blur, np.float64)
    gy, gx = np.gradient(a)
    grad = np.hypot(gx, gy)
    # the skin is the edge with air in front of it: the darkest the x-ray gets within AIR_MM is air there, soft
    # tissue at the bone's edge behind the skin (forehead, nose) - an edge without air counts a fifth
    air, mid = float(np.percentile(a, 2)), float(np.percentile(a, 50))
    if mid - air > 8:
        darkest = _darkest(a, max(1, int(round(AIR_MM / (mm * work)))))
        lo, hi = air + 0.15 * (mid - air), air + 0.45 * (mid - air)
        grad = grad * np.clip((hi - darkest) / (hi - lo), 0.2, 1.0)
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


def _saved_handles(entries):
    """A molar's saved handles: exactly two [x, y] (image pixels), else None."""
    if not isinstance(entries, (list, tuple)) or len(entries) != 2:
        return None
    try:
        out = [[float(e[0]), float(e[1])] for e in entries]
    except (TypeError, ValueError, IndexError):
        return None
    return out if all(np.isfinite(out).ravel()) and out[0] != out[1] else None


_SNAPPED = {}                 # (image, outline, its points, scale) -> dots on the x-ray's edges: the last few


def _snapped(img, mm, o, sx):
    dots = tuple((round(float(c[0]), 1), round(float(c[1]), 1)) for c in o["xy_can"])
    key = (id(img), o["key"], sx, round(mm, 6), dots)
    hit = _SNAPPED.get(key)
    if hit and hit[0]() is img:
        return hit[1]
    mode, pol = o["snap"][:2]
    try:
        xy, found = snap(img, o["xy_can"], o["ranges"], mode, pol, sx, mm, double="double" in o["snap"][3:])
    except (ValueError, FloatingPointError, IndexError):
        xy, found = o["xy_can"], 0.0
    if len(_SNAPPED) >= 96:
        _SNAPPED.pop(next(iter(_SNAPPED)))
    try:
        _SNAPPED[key] = (weakref.ref(img), (xy, found))
    except TypeError:
        pass
    return xy, found


def outlines(img, pts_px, facing, mm_per_px, saved=None):
    """Every outline for an x-ray: [dict(key, name, group, closed, ctrl [code | [x, y] image pixels], xy (every dot,
    image pixels), adjusted (dots placed by hand), anchors, traced, unit ("points": moved as a whole by its two
    landmarks, "handles": by its two handles), handles)]. saved: {key: dots} moved by hand ({molar: [crown, root]})."""
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
    to_img = lambda c: (sx * float(c[0]), -float(c[1]))        # noqa: E731

    def item(key, name, group, ctrl, anchors, adjusted, traced=None, handles=None):
        ctrl = [c if isinstance(c, str) else [round(float(c[0]), 1), round(float(c[1]), 1)] for c in ctrl]
        xy = [[round(float(pts[c][0]), 1), round(float(pts[c][1]), 1)] if isinstance(c, str) else c for c in ctrl]
        out = dict(key=key, name=name, group=group, closed=CLOSED.get(key, False), ctrl=ctrl, xy=xy,
                   adjusted=adjusted, anchors=anchors, traced=traced)
        if key in UNITS:
            out["unit"] = UNITS[key]
            out["handles"] = (list(anchors) if UNITS[key] == "points"
                              else [[round(float(h[0]), 1), round(float(h[1]), 1)] for h in handles])
        return out

    hand = {}
    for key, kind in UNITS.items():
        h = _saved_handles(saved.get(key)) if kind == "handles" else None
        if h:
            hand[key] = [np.array([sx * h[0][0], -h[0][1]]), np.array([sx * h[1][0], -h[1][1]])]
    out = []
    for o in anatomy(can, px_per_mm, hand):
        key = o["key"]
        if key in UNITS:                                 # a tooth: one piece, never its dots one by one
            ctrl = [c if isinstance(c, str) else to_img(c) for c in o["ctrl"]]
            hd = [to_img(h) for h in o["handles"]] if o["handles"] else None
            out.append(item(key, o["name"], o["group"], ctrl, o["anchors"], key in hand, handles=hd))
            continue
        mine = _clean_saved(saved.get(key), pts)
        if mine:
            out.append(item(key, o["name"], o["group"], mine, o["anchors"], True))
            continue
        ctrl, traced = o["ctrl"], None
        if o["snap"] and img is not None and not o["closed"] and max(o["ranges"]) > 0:
            o["xy_can"] = [can[c] if isinstance(c, str) else c for c in ctrl]
            xy, traced = _snapped(img, float(mm_per_px or 1.0 / px_per_mm), o, sx)
            ctrl = [c if isinstance(c, str) else xy[i] for i, c in enumerate(ctrl)]
            traced = round(traced, 2)
        ctrl = [c if isinstance(c, str) else to_img(c) for c in ctrl]   # back to the image
        out.append(item(key, o["name"], o["group"], ctrl, o["anchors"], False, traced))
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
