"""Cervical vertebral maturation (CVM) stage from the traced C2-C4 points, by the Baccetti, Franchi &
McNamara (2005) rules:

    CS1  no concavity at the lower borders of C2, C3, C4; C3 and C4 bodies trapezoid
    CS2  concavity at C2 only; C3 and C4 trapezoid
    CS3  concavities at C2 and C3; C3/C4 trapezoid or rectangular horizontal
    CS4  concavities at C2, C3 and C4; C3 and C4 rectangular horizontal
    CS5  concavities at all three; at least one of C3/C4 square
    CS6  concavities at all three; at least one of C3/C4 rectangular vertical

The two judgements behind every stage are measured, so the call can be checked:
  - concavity: depth of the deepest point of a lower border from the line joining its two corners, as a
    percentage of the border's length (scale-free; shown in mm too when the x-ray is calibrated);
  - body shape (C3, C4): trapezoid when the front height is clearly shorter than the back height,
    otherwise height / width decides rectangular horizontal, square or rectangular vertical.

The thresholds are settings. `fit_thresholds` tunes them to the doctor's own stage calls (only when that
agrees with him more often than the defaults, judged leave-one-out), so the CVM call learns his eye.
"""
import itertools
import numpy as np

DEFAULT_THRESHOLDS = {
    "concavity_pct": 6.0,     # a lower border counts as concave when its depth is >= this % of its length
    "trapezoid_ratio": 0.80,  # front height / back height below this -> trapezoid
    "square_low": 0.90,       # height / width from square_low ...
    "square_high": 1.10,      # ... to square_high -> square; below -> rect. horizontal; above -> rect. vertical
}

TIMING = {
    "CS1": "Pre-pubertal: the peak in mandibular growth is on average about 2 years away.",
    "CS2": "Pre-pubertal: the peak in mandibular growth is on average about 1 year away.",
    "CS3": "Pubertal: the peak in mandibular growth is expected during the coming year.",
    "CS4": "Pubertal: the peak in mandibular growth happened within the last 1-2 years.",
    "CS5": "Post-pubertal: the peak ended at least 1 year ago.",
    "CS6": "Post-pubertal: the peak ended at least 2 years ago.",
}

SHAPE_NAMES = {"trapezoid": "trapezoid", "rect_h": "rectangular horizontal", "square": "square",
               "rect_v": "rectangular vertical"}


def thresholds_from(cfg=None):
    t = dict(DEFAULT_THRESHOLDS)
    for k, v in ((cfg or {}).get("thresholds") or {}).items():
        if k in t:
            try:
                t[k] = float(v)
            except (TypeError, ValueError):
                pass
    return t


def _concavity(p, lp, d, la, mm):
    """Depth of the lower-border concavity. Points in the canonical frame (Y up)."""
    if not all(k in p for k in (lp, d, la)):
        return None
    a, b, c = p[lp], p[la], p[d]
    base = b - a
    L = float(np.hypot(*base))
    if L == 0:
        return None
    n = np.array([-base[1], base[0]]) / L     # perpendicular to the border...
    if n[1] < 0:
        n = -n                                # ... pointing up, into the vertebral body
    depth = float((c - a) @ n)                # > 0: the border curves up (concave)
    return dict(depth_px=depth, length_px=L, pct=100.0 * depth / L,
                depth_mm=None if not mm else depth * mm)


def _body(p, lvl, mm):
    up, ua, lp, la = (f"{lvl}{s}" for s in ("up", "ua", "lp", "la"))
    if not all(k in p for k in (up, ua, lp, la)):
        return None
    hp = float(np.hypot(*(p[up] - p[lp])))
    ha = float(np.hypot(*(p[ua] - p[la])))
    w = float(np.hypot(*(p[la] - p[lp])))
    if hp == 0 or w == 0:
        return None
    h = (hp + ha) / 2.0
    return dict(h_back_px=hp, h_front_px=ha, width_px=w, front_back=ha / hp, h_w=h / w,
                h_back_mm=None if not mm else hp * mm, h_front_mm=None if not mm else ha * mm,
                width_mm=None if not mm else w * mm)


def _shape(body, t):
    if body is None:
        return None
    if body["front_back"] < t["trapezoid_ratio"]:
        return "trapezoid"
    if body["h_w"] < t["square_low"]:
        return "rect_h"
    if body["h_w"] > t["square_high"]:
        return "rect_v"
    return "square"


def features(p, mm=None):
    """The measured inputs to the stage: concavities of C2-C4 and the C3/C4 bodies."""
    return dict(
        conc={lvl: _concavity(p, f"{lvl}lp", f"{lvl}d", f"{lvl}la", mm) for lvl in ("C2", "C3", "C4")},
        body={lvl: _body(p, lvl, mm) for lvl in ("C3", "C4")},
    )


def _decide(f, t):
    """Stage from features with thresholds t. Returns (stage or None, notes, concave dict, shapes dict)."""
    concave = {lvl: (None if c is None else c["pct"] >= t["concavity_pct"]) for lvl, c in f["conc"].items()}
    shapes = {lvl: _shape(b, t) for lvl, b in f["body"].items()}
    notes = []
    c2, c3, c4 = concave["C2"], concave["C3"], concave["C4"]
    s = [x for x in (shapes["C3"], shapes["C4"]) if x]
    if c2 is None:
        return None, ["Trace the lower border of C2 to stage CVM."], concave, shapes
    if not c2:
        stage = "CS1"
        if c3 or c4:
            notes.append("C3/C4 look concave while C2 is flat - unusual, check the C2 points.")
    elif not c3:
        stage = "CS2"
        if c3 is None:
            stage = "CS2"
            notes.append("C3 not traced: CS2 or later.")
        elif c4:
            notes.append("C4 looks concave while C3 is flat - unusual, check the C3 points.")
    elif c4 is None:
        stage = "CS3"
        notes.append("C4 not traced: CS3 or later.")
    elif not c4:
        stage = "CS3"
    else:
        if "rect_v" in s:
            stage = "CS6"
        elif "square" in s:
            stage = "CS5"
        else:
            stage = "CS4"
            if s and all(x == "trapezoid" for x in s):
                notes.append("All three borders are concave but the bodies still look trapezoid - check the corners.")
    if stage in ("CS1", "CS2") and any(x in ("square", "rect_v") for x in s):
        notes.append("The bodies look older than the flat borders suggest - check the concavity points.")
    return stage, notes, concave, shapes


def _margins(f, t):
    """How close each judgement sits to its threshold (for a 'borderline' flag)."""
    close = []
    for lvl, c in f["conc"].items():
        if c is not None and abs(c["pct"] - t["concavity_pct"]) < 1.5:
            close.append(f"{lvl} concavity")
    for lvl, b in f["body"].items():
        if b is None:
            continue
        if abs(b["front_back"] - t["trapezoid_ratio"]) < 0.04:
            close.append(f"{lvl} trapezoid or not")
        elif abs(b["h_w"] - t["square_low"]) < 0.04 or abs(b["h_w"] - t["square_high"]) < 0.04:
            close.append(f"{lvl} shape")
    return close


def stage(p, mm=None, cfg=None):
    """CVM stage from canonical points p ({code: np.array}). cfg: settings['cvm'] (thresholds)."""
    t = thresholds_from(cfg)
    f = features(p, mm)
    st, notes, concave, shapes = _decide(f, t)
    if st is None:
        return dict(stage=None, stage_label="Not staged", timing="", notes=notes, features=_public(f, concave, shapes),
                    borderline=False, thresholds=t)
    close = _margins(f, t)
    label = st
    if close:
        notes.append("Close to a threshold: " + ", ".join(close) + ".")
    return dict(stage=st, stage_label=label, timing=TIMING[st], notes=notes, features=_public(f, concave, shapes),
                borderline=bool(close), thresholds=t)


def _public(f, concave, shapes):
    out = []
    for lvl in ("C2", "C3", "C4"):
        c = f["conc"][lvl]
        b = f["body"].get(lvl)
        row = dict(level=lvl, concave=concave.get(lvl), concavity_pct=None if c is None else round(c["pct"], 1),
                   concavity_mm=None if c is None or c["depth_mm"] is None else round(c["depth_mm"], 2),
                   shape=SHAPE_NAMES.get(shapes.get(lvl)) if lvl != "C2" else None,
                   height_width=None if b is None else round(b["h_w"], 2),
                   front_back=None if b is None else round(b["front_back"], 2))
        out.append(row)
    return out


# ---------------------------------------------------------------- learning the doctor's eye

GRID = dict(
    concavity_pct=[3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
    trapezoid_ratio=[0.70, 0.75, 0.80, 0.85, 0.90],
    square_low=[0.84, 0.88, 0.92, 0.96],
    square_high=[1.04, 1.08, 1.12, 1.16],
)
_NUM = {f"CS{i}": i for i in range(1, 7)}


def _score(feats, calls, t):
    exact, diff = 0, 0
    for f, c in zip(feats, calls):
        st = _decide(f, t)[0]
        if st is None:
            continue
        exact += st == c
        diff += abs(_NUM[st] - _NUM[c])
    return exact, -diff


def _best(feats, calls):
    best, best_t = None, None
    for combo in itertools.product(*GRID.values()):
        t = dict(zip(GRID.keys(), combo))
        if t["square_low"] >= t["square_high"]:
            continue
        sc = _score(feats, calls, t)
        # ties go to the thresholds nearest the defaults
        closeness = -sum(abs(t[k] - DEFAULT_THRESHOLDS[k]) / DEFAULT_THRESHOLDS[k] for k in t)
        key = (sc[0], sc[1], closeness)
        if best is None or key > best:
            best, best_t = key, t
    return best_t


def fit_thresholds(examples, min_cases=8):
    """examples: list of (canonical points, mm or None, doctor's stage 'CS1'..'CS6').

    Returns dict(accepted, thresholds, n, default_agree, fitted_agree, loo_agree, message). Accepted only when
    leave-one-out agreement with the doctor beats the defaults' agreement."""
    ex = [(features(p, mm), c) for p, mm, c in examples if c in _NUM]
    ex = [(f, c) for f, c in ex if f["conc"]["C2"] is not None]
    n = len(ex)
    base = dict(DEFAULT_THRESHOLDS)
    if n < min_cases:
        return dict(accepted=False, thresholds=base, n=n, default_agree=None, fitted_agree=None, loo_agree=None,
                    message=f"Needs {min_cases} x-rays with your own CVM call to tune itself ({n} so far).")
    feats = [f for f, _ in ex]
    calls = [c for _, c in ex]
    default_agree = _score(feats, calls, base)[0]
    loo = 0
    for i in range(n):
        t = _best(feats[:i] + feats[i + 1:], calls[:i] + calls[i + 1:])
        loo += _decide(feats[i], t)[0] == calls[i]
    t_all = _best(feats, calls)
    fitted_agree = _score(feats, calls, t_all)[0]
    accepted = loo > default_agree
    msg = (f"Agrees with your call on {default_agree}/{n} with the default thresholds; "
           f"tuned to your calls it agrees on {loo}/{n} when each x-ray is left out in turn")
    msg += " - using the tuned thresholds." if accepted else " - keeping the defaults (not better)."
    return dict(accepted=accepted, thresholds=t_all if accepted else base, n=n, default_agree=default_agree,
                fitted_agree=fitted_agree, loo_agree=loo, message=msg)
