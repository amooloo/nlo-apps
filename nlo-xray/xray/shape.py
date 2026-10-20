"""The average tracing: where every landmark sits relative to the others.

Before there are any confirmed tracings it is the textbook template (landmarks.TEMPLATE). After that it
is the mean of the doctor's own confirmed tracings (aligned for position, size and rotation), so each
new x-ray starts closer to where he puts the points.

Used for:
  - placing all points from the three clicked anchors (S, N, Me),
  - filling in any point the model is not yet trained for, from the points it did find.
"""
import numpy as np

from . import geometry as g
from .landmarks import ANCHORS, CODES, TEMPLATE

SN_MM = 68.0        # size used for tracings without a calibration


def _case_shape(points_px, facing, mm_per_px):
    """One tracing in the canonical frame, in mm (or SN-normalised when uncalibrated)."""
    p = g.to_canonical(points_px, facing or g.facing_of(points_px) or "right")
    if mm_per_px:
        k = float(mm_per_px)
    elif "S" in p and "N" in p and g.dist(p["S"], p["N"]) > 0:
        k = SN_MM / g.dist(p["S"], p["N"])
    else:
        return None
    return {c: v * k for c, v in p.items()}


def mean_shape(tracings, min_cases=3, iters=5):
    """tracings: list of (points_px, facing, mm_per_px). Returns (shape {code: np.array}, n_used).

    Generalised Procrustes on the landmarks each tracing has; a landmark nobody traced keeps the
    template position (moved into the mean's frame)."""
    shapes = [s for s in (_case_shape(*t) for t in tracings) if s and len(s) >= 6]
    tmpl = {c: np.array(v, float) for c, v in TEMPLATE.items()}
    if len(shapes) < min_cases:
        return tmpl, len(shapes)
    ref = dict(tmpl)
    for _ in range(iters):
        acc = {c: [] for c in CODES}
        for s in shapes:
            common = [c for c in s if c in ref]
            if len(common) < 3:
                continue
            sc, R, t = g.similarity_fit([s[c] for c in common], [ref[c] for c in common])
            for c, v in s.items():
                acc[c].append(sc * (R @ v) + t)
        new = {c: np.mean(v, axis=0) for c, v in acc.items() if v}
        # keep the frame anchored to the template (no drift of scale/rotation between iterations)
        common = [c for c in new if c in tmpl]
        sc, R, t = g.similarity_fit([new[c] for c in common], [tmpl[c] for c in common])
        new = {c: sc * (R @ v) + t for c, v in new.items()}
        for c in CODES:            # untraced landmarks: template, in this frame
            if c not in new:
                new[c] = tmpl[c]
        ref = new
    return ref, len(shapes)


def place_from_anchors(anchors_px, shape=None):
    """All landmarks in image pixels from the clicked anchors {S, N, Me: (x, y)} (three or more points)."""
    shape = shape or {c: np.array(v, float) for c, v in TEMPLATE.items()}
    used = [c for c in ANCHORS if c in anchors_px]
    extra = [c for c in anchors_px if c not in used and c in shape]
    used += extra
    if len(used) < 3:
        raise ValueError("click S, N and Me first")
    M = g.affine_fit([shape[c] for c in used], [anchors_px[c] for c in used])
    pts = g.affine_apply(M, [shape[c] for c in CODES])
    out = {c: (float(x), float(y)) for c, (x, y) in zip(CODES, pts)}
    for c in anchors_px:
        out[c] = tuple(float(v) for v in anchors_px[c])
    return out


def fill_missing(known_px, codes, shape=None, min_known=4):
    """Positions for `codes` from the known landmarks (least-squares affine of the average shape)."""
    shape = shape or {c: np.array(v, float) for c, v in TEMPLATE.items()}
    known = [c for c in known_px if c in shape]
    if len(known) < min_known:
        return {}
    M = g.affine_fit([shape[c] for c in known], [known_px[c] for c in known])
    pts = g.affine_apply(M, [shape[c] for c in codes])
    return {c: (float(x), float(y)) for c, (x, y) in zip(codes, pts)}
