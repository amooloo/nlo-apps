"""Cervical vertebral maturation from the traced C2-C4 points, by three methods.

The judgements every method starts from are measured on the tracing, and the doctor can overrule any of
them (a click on the picture in the CVM panel, like his phone app):
  - lower border of C2, C3, C4: flat or concave - the depth of the deepest point from the line joining the
    border's two corners, as a percentage of the border's length (scale-free; in mm too when calibrated);
  - body of C3, C4: trapezoid when the front height is clearly shorter than the back height, otherwise
    height / width decides rectangular horizontal, square or rectangular vertical.

Methods:
  Baccetti, Franchi & McNamara (2005) - CS1-CS6, the timing of the peak in mandibular growth:
    CS1  no concavity at C2, C3, C4; C3 and C4 trapezoid           peak on average 2 years after
    CS2  concavity at C2 only                                        peak on average 1 year after
    CS3  concavities at C2 and C3                                    peak during the year after
    CS4  concavities at C2, C3, C4; bodies rectangular horizontal   peak within the 1-2 years before
    CS5  ... at least one of C3/C4 square                            peak ended at least 1 year before
    CS6  ... at least one of C3/C4 rectangular vertical              peak ended at least 2 years before
  Hassel & Farman (1995) - CVMI 1-6 and the share of adolescent growth still to come:
    1 Initiation 80-100 %, 2 Acceleration 65-85 %, 3 Transition 25-65 %, 4 Deceleration 10-25 %,
    5 Maturation 5-10 %, 6 Completion - little or none. Read from the same judgements (C2 / C2+C3 /
    all three concave, then the C3-C4 bodies: rectangular horizontal, square, taller than wide).
  Mito, Sato & Mitani (2002) - cervical vertebral bone age, in years, from the C3 and C4 proportions:
    CVBA = -0.20 + 6.20 x AH3/AP3 + 5.90 x AH4/AP4 + 4.74 x AH4/PH4
    AH / PH = front / back height (upper corner to the line through the lower corners),
    AP = front-to-back depth at mid-height. Derived for girls.

The thresholds are settings. `fit_thresholds` tunes them to the doctor's own judgements on confirmed
tracings (only when that agrees with him more often than the defaults, judged leave-one-out), so the
measured judgements learn his eye.
"""
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
    "CS5": "Post-pubertal: the peak in mandibular growth ended at least 1 year ago.",
    "CS6": "Post-pubertal: the peak in mandibular growth ended at least 2 years ago.",
}

HASSEL_FARMAN = {
    1: ("Initiation", 80, 100, "Very significant adolescent growth to come (80-100 %)."),
    2: ("Acceleration", 65, 85, "Significant adolescent growth to come (65-85 %)."),
    3: ("Transition", 25, 65, "Moderate adolescent growth to come (25-65 %)."),
    4: ("Deceleration", 10, 25, "Small amount of adolescent growth to come (10-25 %)."),
    5: ("Maturation", 5, 10, "Insignificant adolescent growth to come (5-10 %)."),
    6: ("Completion", 0, 5, "Adolescent growth completed: little or none to come."),
}

SHAPES = ("trapezoid", "rect_h", "square", "rect_v")
SHAPE_NAMES = {"trapezoid": "trapezoid", "rect_h": "rectangular horizontal", "square": "square",
               "rect_v": "rectangular vertical"}
BORDERS = ("C2", "C3", "C4")
BODIES = ("C3", "C4")
MARK_KEYS = ("C2", "C3", "C4", "C3shape", "C4shape")


def thresholds_from(cfg=None):
    t = dict(DEFAULT_THRESHOLDS)
    for k, v in ((cfg or {}).get("thresholds") or {}).items():
        if k in t:
            try:
                t[k] = float(v)
            except (TypeError, ValueError):
                pass
    return t


# ---------------------------------------------------------------------------------------- measuring

def _perp(p, a, b):
    """Distance from p to the line a-b, and which side (+1 above, as the canonical frame has Y up)."""
    d = b - a
    L = float(np.hypot(*d))
    if L == 0:
        return None
    n = np.array([-d[1], d[0]]) / L
    if n[1] < 0:
        n = -n
    return float((p - a) @ n)


def _concavity(p, lvl, mm):
    lp, d, la = (f"{lvl}lp", f"{lvl}d", f"{lvl}la")
    if not all(k in p for k in (lp, d, la)):
        return None
    L = float(np.hypot(*(p[la] - p[lp])))
    if L == 0:
        return None
    depth = _perp(p[d], p[lp], p[la])          # > 0: the border curves up into the body (concave)
    return dict(depth_px=depth, length_px=L, pct=100.0 * depth / L, depth_mm=None if not mm else depth * mm)


def _body(p, lvl, mm):
    up, ua, lp, la = (f"{lvl}{s}" for s in ("up", "ua", "lp", "la"))
    if not all(k in p for k in (up, ua, lp, la)):
        return None
    # heights as Mito measures them: from each upper corner to the line through the two lower corners
    ah = _perp(p[ua], p[lp], p[la])
    ph = _perp(p[up], p[lp], p[la])
    w = float(np.hypot(*(p[la] - p[lp])))
    ap = float(np.hypot(*((p[ua] + p[la]) / 2 - (p[up] + p[lp]) / 2)))       # depth at mid-height
    if not ph or ph <= 0 or w == 0 or ap == 0 or ah is None:
        return None
    h = (ah + ph) / 2.0
    return dict(ah_px=ah, ph_px=ph, width_px=w, ap_px=ap, front_back=ah / ph, h_w=h / w,
                ah_mm=None if not mm else ah * mm, ph_mm=None if not mm else ph * mm,
                width_mm=None if not mm else w * mm)


def features(p, mm=None):
    """The measured inputs: concavities of the C2-C4 lower borders and the C3/C4 bodies."""
    return dict(conc={lvl: _concavity(p, lvl, mm) for lvl in BORDERS},
                body={lvl: _body(p, lvl, mm) for lvl in BODIES})


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


def judge(f, t):
    """Measured judgements: {'C2': 'flat'/'concave'/None, ..., 'C3shape': 'trapezoid'/... or None}."""
    j = {}
    for lvl in BORDERS:
        c = f["conc"][lvl]
        j[lvl] = None if c is None else ("concave" if c["pct"] >= t["concavity_pct"] else "flat")
    for lvl in BODIES:
        j[f"{lvl}shape"] = _shape(f["body"][lvl], t)
    return j


def clean_marks(marks):
    """Only the overrides that make sense."""
    out = {}
    for k, v in (marks or {}).items():
        if k in BORDERS and v in ("flat", "concave"):
            out[k] = v
        elif k in ("C3shape", "C4shape") and v in SHAPES:
            out[k] = v
    return out


# ---------------------------------------------------------------------------------------- methods

def baccetti(j):
    """CS1-CS6 from judgements. Returns (stage or None, notes)."""
    notes = []
    c2, c3, c4 = (j.get(k) for k in BORDERS)
    shapes = [s for s in (j.get("C3shape"), j.get("C4shape")) if s]
    if c2 is None:
        return None, ["Trace the lower border of C2 to stage CVM."]
    if c2 == "flat":
        stage = "CS1"
        if "concave" in (c3, c4):
            notes.append("C3/C4 concave while C2 is flat - unusual, check the C2 points.")
    elif c3 != "concave":
        stage = "CS2"
        if c3 is None:
            notes.append("C3 not traced: CS2 or later.")
        elif c4 == "concave":
            notes.append("C4 concave while C3 is flat - unusual, check the C3 points.")
    elif c4 is None:
        stage = "CS3"
        notes.append("C4 not traced: CS3 or later.")
    elif c4 == "flat":
        stage = "CS3"
    elif "rect_v" in shapes:
        stage = "CS6"
    elif "square" in shapes:
        stage = "CS5"
    else:
        stage = "CS4"
        if shapes and all(s == "trapezoid" for s in shapes):
            notes.append("All three borders concave but the bodies still trapezoid - check the corners.")
    if stage in ("CS1", "CS2") and any(s in ("square", "rect_v") for s in shapes):
        notes.append("The bodies look older than the borders suggest - check the concavities.")
    return stage, notes


def hassel_farman(stage_cs):
    """CVMI from the same judgements (the two six-stage systems step together on C2-C4)."""
    if not stage_cs:
        return None
    n = int(stage_cs[2:])
    name, lo, hi, text = HASSEL_FARMAN[n]
    return dict(cvmi=n, name=name, lo=lo, hi=hi, text=text)


def mito(f, age=None, sex=None):
    """Cervical vertebral bone age (Mito et al. 2002) from the C3 and C4 proportions."""
    b3, b4 = f["body"].get("C3"), f["body"].get("C4")
    if not b3 or not b4:
        return None
    r1, r2, r3 = b3["ah_px"] / b3["ap_px"], b4["ah_px"] / b4["ap_px"], b4["ah_px"] / b4["ph_px"]
    cvba = -0.20 + 6.20 * r1 + 5.90 * r2 + 4.74 * r3
    out = dict(bone_age=round(cvba, 1), ratios=dict(AH3_AP3=round(r1, 3), AH4_AP4=round(r2, 3), AH4_PH4=round(r3, 3)),
               age=age, diff=None, note="")
    if age is not None:
        out["diff"] = round(cvba - age, 1)
    s = (sex or "").upper()[:1]
    if s != "F":
        out["note"] = "Mito's formula was derived for girls" + ("." if s == "M" else " (sex not given).")
    return out


# ---------------------------------------------------------------------------------------- all together

def _margins(f, t):
    close = []
    for lvl, c in f["conc"].items():
        if c is not None and abs(c["pct"] - t["concavity_pct"]) < 1.5:
            close.append(f"{lvl} border")
    for lvl, b in f["body"].items():
        if b is None:
            continue
        if abs(b["front_back"] - t["trapezoid_ratio"]) < 0.04:
            close.append(f"{lvl} trapezoid or not")
        elif abs(b["h_w"] - t["square_low"]) < 0.04 or abs(b["h_w"] - t["square_high"]) < 0.04:
            close.append(f"{lvl} shape")
    return close


def stage(p, mm=None, cfg=None, marks=None, age=None, sex=None):
    """Everything the CVM panel shows. p: canonical points {code: np.array}. marks: the doctor's overrides."""
    t = thresholds_from(cfg)
    f = features(p, mm)
    auto = judge(f, t)
    marks = clean_marks(marks)
    eff = {k: marks.get(k, auto.get(k)) for k in MARK_KEYS}
    auto_stage, _ = baccetti(auto)
    st, notes = baccetti(eff)
    close = [] if marks else _margins(f, t)
    if close:
        notes.append("Close to a threshold: " + ", ".join(close) + " - worth a look.")
    judgements = {k: dict(auto=auto.get(k), mark=marks.get(k), value=eff.get(k)) for k in MARK_KEYS}
    feats = []
    for lvl in BORDERS:
        c = f["conc"][lvl]
        b = f["body"].get(lvl)
        feats.append(dict(level=lvl, concavity_pct=None if c is None else round(c["pct"], 1),
                          concavity_mm=None if c is None or c["depth_mm"] is None else round(c["depth_mm"], 2),
                          height_width=None if b is None else round(b["h_w"], 2),
                          front_back=None if b is None else round(b["front_back"], 2)))
    hf = hassel_farman(st)
    mi = mito(f, age, sex)
    return dict(
        stage=st, auto_stage=auto_stage, stage_label=st or "Not staged", timing=TIMING.get(st, ""),
        overridden=bool(marks), judgements=judgements, features=feats, notes=notes, borderline=bool(close),
        thresholds=t, methods=dict(baccetti=dict(stage=st, timing=TIMING.get(st, "")), hassel_farman=hf, mito=mi),
    )


# ---------------------------------------------------------------------------------------- learning his eye

def _labels(examples):
    """Per-judgement samples from (features, judgements) pairs: concavity (pct, concave?), bodies."""
    conc, trap, shape = [], [], []
    for i, (f, j) in enumerate(examples):
        for lvl in BORDERS:
            c, v = f["conc"].get(lvl), j.get(lvl)
            if c is not None and v in ("flat", "concave"):
                conc.append((i, c["pct"], v == "concave"))
        for lvl in BODIES:
            b, v = f["body"].get(lvl), j.get(f"{lvl}shape")
            if b is not None and v in SHAPES:
                trap.append((i, b["front_back"], v == "trapezoid"))
                if v != "trapezoid":
                    shape.append((i, b["h_w"], v))
    return conc, trap, shape


def _agree(conc, trap, shape, t, skip=None):
    n = 0
    for i, x, y in conc:
        if i != skip:
            n += (x >= t["concavity_pct"]) == y
    for i, x, y in trap:
        if i != skip:
            n += (x < t["trapezoid_ratio"]) == y
    for i, x, y in shape:
        if i != skip:
            got = "rect_h" if x < t["square_low"] else "rect_v" if x > t["square_high"] else "square"
            n += got == y
    return n


def _fit(conc, trap, shape, skip=None):
    """Best thresholds for the samples (leaving case `skip` out); ties go to the values nearest the defaults."""
    d = DEFAULT_THRESHOLDS

    def best_1d(samples, grid, pred, default):
        best = None
        for g in grid:
            s = sum(pred(x, g) == y for i, x, y in samples if i != skip)
            key = (s, -abs(g - default))
            if best is None or key > best[0]:
                best = (key, g)
        return best[1]

    ct = best_1d(conc, np.arange(2.0, 12.01, 0.25), lambda x, g: x >= g, d["concavity_pct"])
    tr = best_1d(trap, np.arange(0.60, 0.951, 0.01), lambda x, g: x < g, d["trapezoid_ratio"])
    best = None
    for lo in np.arange(0.75, 1.001, 0.01):
        for hi in np.arange(1.0, 1.301, 0.01):
            if hi <= lo:
                continue
            s = 0
            for i, x, y in shape:
                if i == skip:
                    continue
                got = "rect_h" if x < lo else "rect_v" if x > hi else "square"
                s += got == y
            key = (s, -abs(lo - d["square_low"]) - abs(hi - d["square_high"]))
            if best is None or key > best[0]:
                best = (key, lo, hi)
    return dict(concavity_pct=round(float(ct), 2), trapezoid_ratio=round(float(tr), 2),
                square_low=round(float(best[1]), 2), square_high=round(float(best[2]), 2))


def fit_thresholds(examples, min_cases=8):
    """examples: list of (features, judgements) - the judgements as confirmed by the doctor (his clicks on
    the pictures, and the measured ones he accepted). Returns dict(accepted, thresholds, n, default_agree,
    loo_agree, total, message). Accepted only when, leaving each x-ray out in turn, the tuned thresholds
    agree with him more often than the defaults."""
    ex = [(f, j) for f, j in examples if f["conc"].get("C2") is not None]
    n = len(ex)
    base = dict(DEFAULT_THRESHOLDS)
    if n < min_cases:
        return dict(accepted=False, thresholds=base, n=n, default_agree=None, loo_agree=None, total=None,
                    message=f"Needs {min_cases} confirmed x-rays with the vertebrae traced to tune itself to your eye "
                            f"({n} so far).")
    conc, trap, shape = _labels(ex)
    total = len(conc) + len(trap) + len(shape)
    default_agree = _agree(conc, trap, shape, base)
    loo = 0
    for i in range(n):
        t = _fit(conc, trap, shape, skip=i)
        loo += _agree([s for s in conc if s[0] == i], [s for s in trap if s[0] == i], [s for s in shape if s[0] == i], t)
    t_all = _fit(conc, trap, shape)
    accepted = loo > default_agree
    msg = (f"Your judgements on {n} x-rays: the default thresholds agree on {default_agree} of {total}; "
           f"tuned to you they agree on {loo} of {total} on x-rays left out in turn")
    msg += " - using the tuned ones." if accepted else " - keeping the defaults."
    return dict(accepted=accepted, thresholds=t_all if accepted else base, n=n, default_agree=default_agree,
                loo_agree=loo, total=total, message=msg)
