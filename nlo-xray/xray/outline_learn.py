"""Outlines that learn from the doctor: the dots he moved on his confirmed x-rays (case["contours"]) teach the shapes
the next x-rays start from.

Each outline he fixed is carried back to the frame its textbook shape lives in, through the same points that place it
on an x-ray:
- a bone outline (mandible, inner symphysis, maxilla): a thin-plate spline from his x-ray's points to the textbook's;
- a small cranial outline (sella, frontal and nasal bones, orbit, fissure, ear rod): its landmark's frame, turned with
  S-N or Frankfort, at real size;
- a molar: its two handles, in millimetres along and across the occlusal plane from the molar contact;
- a stretch of the soft-tissue profile between two of its points: along and across the line joining them, as a share
  of that line's length.
Dot by dot, the middle of his (the median) is the learned shape, and the outlines give way to it as x-rays come in:
n / (n + 2) of the way (outlines.learned_weight). Only confirmed x-rays count (his checked work), only outlines he
moved, and only those saved with the template's own dots (an outline saved by an older version keeps that version's
shape where he did not touch it); an x-ray whose pixel size makes S-N impossible is left out of the real-size ones
(cranial outlines, molars).
"""
import datetime as dt

import numpy as np

from . import geometry as g
from . import outlines as O

PER = 40                       # spline points between two dots
PROFILE_SAMPLES = 24           # a profile stretch is learned as this many + 1 points along it
VERSION = 1


def _arc(C):
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(np.asarray(C, float), axis=0).T))])


def _at(C, s, target):
    """The point at arc length `target` along polyline C (its cumulative arc lengths s)."""
    return np.array([np.interp(target, s, C[:, 0]), np.interp(target, s, C[:, 1])])


def _unplace(src, dst, entries, free):
    """The way back through the spline that places a bone outline (outlines.tps(src, dst): textbook points -> an
    x-ray's), or through its affine fit where that spline would fold, as outlines.anatomy decides from the same dots:
    for points on the x-ray, the textbook points carried there. Solved point by point by Newton steps from the
    textbook's free dots (`free`: their indices in `entries`), so a spline that is not one-to-one far from its points
    still gives the right one. Returns f(points) -> points, or None for points that do not settle."""
    f, fa = O.tps(src, dst), O._affine(src, dst)
    tmpl = np.array([O.DRAW[e] if isinstance(e, str) else O._xy(e) for e in entries], float)
    warped, plain = f(tmpl), fa(tmpl)
    if not np.all(np.isfinite(warped)) or np.abs(warped - plain).max() > 0.35 * O._size(plain):
        f = fa                                          # anatomy() draws it with the affine fit: undo that
    guess = tmpl[free]

    def inv(q):
        q = np.asarray(q, float).reshape(-1, 2)
        x = guess.copy()
        h = 1e-3
        for _ in range(40):                              # Newton: the spline's slope at each point
            fx = f(x)
            r = q - fx
            if np.abs(r).max() < 1e-4:
                break
            jx, jy = (f(x + [h, 0.0]) - fx) / h, (f(x + [0.0, h]) - fx) / h
            det = jx[:, 0] * jy[:, 1] - jx[:, 1] * jy[:, 0]
            if np.any(np.abs(det) < 1e-12):
                return None
            x = x + np.c_[(jy[:, 1] * r[:, 0] - jy[:, 0] * r[:, 1]) / det, (jx[:, 0] * r[:, 1] - jx[:, 1] * r[:, 0]) / det]
        return x if np.abs(q - f(x)).max() < 0.5 else None
    return inv


def _unframe(origin, d, up, px_per_mm):
    """Canonical pixels -> (forward, up) mm round origin: the inverse of outlines._frame."""
    M = np.vstack([d, up]).T
    return lambda q: (np.asarray(q, float).reshape(-1, 2) - np.asarray(origin, float)) @ M / px_per_mm


def _real_scale(can, mm_per_px):
    """Pixels per mm when the x-ray's pixel size makes S-N possible, else None."""
    if not mm_per_px or "S" not in can or "N" not in can:
        return None
    sn = g.dist(can["S"], can["N"]) * float(mm_per_px)
    return 1.0 / float(mm_per_px) if O.SN_PLAUSIBLE_MM[0] <= sn <= O.SN_PLAUSIBLE_MM[1] else None


def _textbook(shape):
    return shape["ctrl"] if isinstance(shape, dict) else shape


def _one_case(points, facing, mm_per_px, contours, acc):
    """Adds what one confirmed x-ray teaches to acc. True when it taught anything."""
    pts = {k: v for k, v in (points or {}).items() if v is not None}
    if not pts or not contours:
        return False
    facing = facing or g.facing_of(pts) or "right"
    sx = 1.0 if facing != "left" else -1.0
    can = g.to_canonical(pts, facing)
    px_per_mm = _real_scale(can, mm_per_px)
    taught = False
    for key, name, group, how, uses, shape, closed, snap in O.STRUCTURES:
        saved = contours.get(key)
        if not saved:
            continue
        if how == "molar":
            h = O._saved_handles(saved)
            mol, front = O._point(can, "MOL"), O._point(can, "U1T+L1T")
            if not h or px_per_mm is None or mol is None or front is None or g.dist(mol, front) <= 0:
                continue
            d = g.unit(front - mol)
            up = np.array([-d[1], d[0]])
            if up[1] < 0:
                up = -up
            hc = [np.array([sx * q[0], -q[1]]) for q in h]
            acc["molars"].setdefault(key, []).append([[float((q - mol) @ d / px_per_mm), float((q - mol) @ up / px_per_mm)]
                                                      for q in hc])
            taught = True
            continue
        if how not in ("spline", "cranial"):
            continue                                       # the incisors: carried by their two points, no dots
        entries = _textbook(shape)
        codes = O.signature(entries)
        ctrl = O._clean_saved(saved, pts)
        if not ctrl:
            continue
        if [c if isinstance(c, str) else None for c in ctrl] != codes:
            continue           # saved with another version's dots: its untouched part would be that version's shape
        xy = np.array([can[c] if isinstance(c, str) else np.array([sx * c[0], -c[1]]) for c in ctrl], float)
        free = [i for i, c in enumerate(codes) if not c]
        # the way back from this x-ray to the template's frame: undoing how the template is placed on it
        if how == "spline":
            anchors = [c for c in uses if c in can and c in O.DRAW]
            if len(anchors) < 3:
                continue
            try:
                back_f = _unplace([O.DRAW[c] for c in anchors], [can[c] for c in anchors], entries, free)
            except (np.linalg.LinAlgError, ValueError):
                continue
        else:
            at, ref = uses
            d = O.cranial_direction(can, ref)
            if px_per_mm is None or at not in can or d is None or g.norm(d) <= 0:
                continue
            d = g.unit(d)
            up = np.array([-d[1], d[0]])
            if up[1] < 0:
                up = -up
            back_f = _unframe(can[at], d, up, px_per_mm)
        back = back_f(xy[free])                            # his dots, carried back to the template's frame
        if back is None or not np.all(np.isfinite(back)):
            continue                                       # points that fold the spline: not a shape to learn
        dots = {i: back[k] for k, i in enumerate(free)}
        acc["shapes"].setdefault(key, []).append(dots)
        taught = True
    # the soft-tissue profile, stretch by stretch
    ctrl = O._clean_saved(contours.get(O.PROFILE_KEY), pts)
    if ctrl:
        xy = [can[c] if isinstance(c, str) else np.array([sx * c[0], -c[1]]) for c in ctrl]
        C = O.spline(xy, False, PER)
        marks = [(k, c) for k, c in enumerate(ctrl) if isinstance(c, str)]
        for (k0, c0), (k1, c1) in zip(marks, marks[1:]):
            if (c0, c1) == ("Stms", "Stmi") or k1 <= k0:
                continue
            seg = C[PER * k0:PER * k1 + 1]
            p0, p1 = seg[0], seg[-1]
            L = g.dist(p0, p1)
            if L <= 0 or len(seg) < 2:
                continue
            d = (p1 - p0) / L
            n = np.array([-d[1], d[0]])
            s = _arc(seg)
            q = np.stack([_at(seg, s, t) for t in np.linspace(0.0, s[-1], PROFILE_SAMPLES + 1)])
            acc["profile"].setdefault(f"{c0}>{c1}", []).append(np.c_[(q - p0) @ d / L, (q - p0) @ n / L])
            taught = True
    return taught


def learn(cases):
    """cases: [dict(points {code: (x, y) image pixels}, facing, mm_per_px, contours)] - the confirmed x-rays.
    Returns the learned shapes, JSON-ready: dict(version, at, cases, shapes {key: dict(n, sig, dots {index: [x, y]})},
    molars {key: dict(n, handles)}, profile {"c0>c1": dict(n, uv)})."""
    acc = dict(shapes={}, molars={}, profile={})
    used = 0
    for c in cases:
        try:
            used += bool(_one_case(c.get("points"), c.get("facing"), c.get("mm_per_px"), c.get("contours") or {}, acc))
        except (ValueError, FloatingPointError, np.linalg.LinAlgError, KeyError, TypeError, IndexError):
            continue
    sig = {s[0]: O.signature(_textbook(s[5])) for s in O.STRUCTURES}
    shapes = {}
    for key, lst in acc["shapes"].items():
        idx = sorted(lst[0])
        shapes[key] = dict(n=len(lst), sig=sig[key],
                           dots={str(i): [round(float(v), 2) for v in np.median([d[i] for d in lst], axis=0)] for i in idx})
    molars = {key: dict(n=len(lst), handles=np.round(np.median(np.array(lst, float), axis=0), 2).tolist())
              for key, lst in acc["molars"].items()}
    profile = {k: dict(n=len(lst), uv=np.round(np.median(np.stack(lst), axis=0), 4).tolist())
               for k, lst in acc["profile"].items()}
    return dict(version=VERSION, at=dt.datetime.now().replace(microsecond=0).isoformat(), cases=used,
                shapes=shapes, molars=molars, profile=profile)


def summary(learned):
    """How many x-rays each outline was learned from: {key: n} (profile: its most-taught stretch)."""
    out = {k: v["n"] for k, v in (learned or {}).get("shapes", {}).items()}
    out.update({k: v["n"] for k, v in (learned or {}).get("molars", {}).items()})
    prof = [v["n"] for v in (learned or {}).get("profile", {}).values()]
    if prof:
        out[O.PROFILE_KEY] = max(prof)
    return out
