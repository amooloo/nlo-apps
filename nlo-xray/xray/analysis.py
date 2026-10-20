"""Cephalometric measurements, norms and the plain-language summary (skeletal class, vertical pattern,
incisors, lips). Pure geometry on the traced landmarks - no AI here.

Input: landmarks in image pixels {code: (x, y)}, the facing ('right'/'left', worked out from S and N
when not given) and mm per pixel (None when the x-ray is not calibrated: angles and ratios still work,
millimetre measurements come back as 'needs calibration').

Norms and cutoffs are defaults the doctor can change in Settings; `settings` overrides them per key.
"""
from . import geometry as g
from .cvm import stage as cvm_stage

DEG, MM, PCT = "°", "mm", "%"

DEFAULT_NORMS = {
    "SNA": (82.0, 3.0), "SNB": (80.0, 3.0), "ANB": (2.0, 2.0),
    "Wits_M": (-1.0, 2.0), "Wits_F": (0.0, 2.0), "Wits_U": (-0.5, 2.0),
    "SN_FH": (7.0, 3.0), "FMA": (25.0, 5.0), "SN_GoGn": (32.0, 5.0), "PP_MP": (25.0, 5.0),
    "Gonial": (130.0, 7.0), "Jarabak": (61.5, 2.0), "LAFH": (55.0, 2.0),
    "U1_SN": (103.0, 6.0), "U1_NA_deg": (22.0, 5.0), "U1_NA_mm": (4.0, 2.0),
    "L1_NB_deg": (25.0, 5.0), "L1_NB_mm": (4.0, 2.0), "IMPA": (90.0, 5.0), "Interincisal": (131.0, 6.0),
    "E_Ls": (-4.0, 2.0), "E_Li": (-2.0, 2.0),
}

DEFAULT_CUTOFFS = {
    "anb_class2_above": 4.0,     # ANB above this -> Class II
    "anb_class3_below": 0.0,     # ANB below this -> Class III
    "wits_band": 2.0,            # Wits more than this above / below the norm for the sex -> Class II / III
    "fma_low_below": 20.0, "fma_high_above": 30.0,
    "sngogn_low_below": 27.0, "sngogn_high_above": 37.0,
}

# key, label, group, unit, landmarks needed, needs mm, description
MEASURES = [
    ("SNA", "SNA", "Skeletal - front to back", DEG, ("S", "N", "A"), False,
     "Maxilla to the cranial base: angle S-N-A."),
    ("SNB", "SNB", "Skeletal - front to back", DEG, ("S", "N", "B"), False,
     "Mandible to the cranial base: angle S-N-B."),
    ("ANB", "ANB", "Skeletal - front to back", DEG, ("S", "N", "A", "B"), False,
     "SNA minus SNB: the jaws to each other. Positive when A lies ahead of B."),
    ("Wits", "Wits appraisal", "Skeletal - front to back", MM, ("A", "B", "MOL", "PM"), True,
     "A and B projected onto the functional occlusal plane (molar to premolar contact): AO minus BO. "
     "Positive when AO is ahead of BO."),
    ("SN_FH", "SN to FH", "Skeletal - vertical", DEG, ("S", "N", "Po", "Or"), False,
     "Cant of the cranial base to Frankfort horizontal (Po-Or)."),
    ("FMA", "FMA (FH to MP)", "Skeletal - vertical", DEG, ("Po", "Or", "Go", "Me"), False,
     "Frankfort horizontal to the mandibular plane (Go-Me)."),
    ("SN_GoGn", "SN to GoGn", "Skeletal - vertical", DEG, ("S", "N", "Go", "Gn"), False,
     "Cranial base to the mandibular plane (Go-Gn), Steiner."),
    ("PP_MP", "Palatal to mandibular plane", "Skeletal - vertical", DEG, ("ANS", "PNS", "Go", "Me"), False,
     "ANS-PNS to Go-Me."),
    ("Gonial", "Gonial angle", "Skeletal - vertical", DEG, ("Ar", "Go", "Me"), False,
     "Angle Ar-Go-Me."),
    ("Jarabak", "Face height ratio (Jarabak)", "Skeletal - vertical", PCT, ("S", "Go", "N", "Me"), False,
     "Posterior face height S-Go over anterior face height N-Me. Lower = more vertical (clockwise) grower."),
    ("LAFH", "Lower face height ratio", "Skeletal - vertical", PCT, ("ANS", "Me", "N"), False,
     "ANS-Me over N-Me."),
    ("U1_SN", "U1 to SN", "Teeth", DEG, ("U1A", "U1T", "S", "N"), False,
     "Upper incisor long axis to the SN line (posterior-inferior angle)."),
    ("U1_NA_deg", "U1 to NA (angle)", "Teeth", DEG, ("U1A", "U1T", "N", "A"), False,
     "Upper incisor long axis to the NA line. Positive when the incisor is tipped ahead of NA."),
    ("U1_NA_mm", "U1 to NA (mm)", "Teeth", MM, ("U1T", "N", "A"), True,
     "Upper incisor tip to the NA line, positive when ahead of it (Steiner measures the most labial point of "
     "the crown; this uses the incisal tip)."),
    ("L1_NB_deg", "L1 to NB (angle)", "Teeth", DEG, ("L1A", "L1T", "N", "B"), False,
     "Lower incisor long axis to the NB line. Positive when the incisor is tipped ahead of NB."),
    ("L1_NB_mm", "L1 to NB (mm)", "Teeth", MM, ("L1T", "N", "B"), True,
     "Lower incisor tip to the NB line, positive when ahead of it (to the incisal tip)."),
    ("IMPA", "IMPA (L1 to MP)", "Teeth", DEG, ("L1A", "L1T", "Go", "Me"), False,
     "Lower incisor long axis to the mandibular plane (Go-Me)."),
    ("Interincisal", "Interincisal angle", "Teeth", DEG, ("U1A", "U1T", "L1A", "L1T"), False,
     "Between the upper and lower incisor long axes."),
    ("E_Ls", "Upper lip to E-line", "Soft tissue", MM, ("Ls", "Prn", "Pos"), True,
     "Upper lip to Ricketts' E-line (nose tip to soft-tissue chin). Negative = behind the line."),
    ("E_Li", "Lower lip to E-line", "Soft tissue", MM, ("Li", "Prn", "Pos"), True,
     "Lower lip to the E-line. Negative = behind the line."),
    ("len_SN", "S-N length", "Lengths", MM, ("S", "N"), True, "Anterior cranial base length."),
    ("len_PP", "ANS-PNS (palate)", "Lengths", MM, ("ANS", "PNS"), True, "Palatal length."),
    ("len_GoMe", "Go-Me (mandibular body)", "Lengths", MM, ("Go", "Me"), True, "Mandibular body length."),
    ("len_ArGo", "Ar-Go (ramus)", "Lengths", MM, ("Ar", "Go"), True, "Ramus height."),
    ("len_NMe", "N-Me (anterior face height)", "Lengths", MM, ("N", "Me"), True, "Total anterior face height."),
    ("len_ANSMe", "ANS-Me (lower face height)", "Lengths", MM, ("ANS", "Me"), True, "Lower anterior face height."),
    ("len_SGo", "S-Go (posterior face height)", "Lengths", MM, ("S", "Go"), True, "Posterior face height."),
]


def _compute(key, p, mm):
    """One measurement on canonical points p (pixels). mm: mm per pixel or None. Returns a float."""
    k = mm or 1.0
    if key == "SNA":
        return g.angle_at(p["S"], p["N"], p["A"])
    if key == "SNB":
        return g.angle_at(p["S"], p["N"], p["B"])
    if key == "ANB":
        return g.angle_at(p["S"], p["N"], p["A"]) - g.angle_at(p["S"], p["N"], p["B"])
    if key == "Wits":
        d = g.unit(g.vec(p["MOL"], p["PM"]))
        if d[0] < 0:          # keep the occlusal-plane direction pointing forward
            d = -d
        return float((p["A"] - p["B"]) @ d) * k
    if key == "SN_FH":
        return g.line_angle(p["S"], p["N"], p["Po"], p["Or"])
    if key == "FMA":
        return g.line_angle(p["Po"], p["Or"], p["Go"], p["Me"])
    if key == "SN_GoGn":
        return g.line_angle(p["S"], p["N"], p["Go"], p["Gn"])
    if key == "PP_MP":
        return g.line_angle(p["ANS"], p["PNS"], p["Go"], p["Me"])
    if key == "Gonial":
        return g.angle_at(p["Ar"], p["Go"], p["Me"])
    if key == "Jarabak":
        return 100.0 * g.dist(p["S"], p["Go"]) / g.dist(p["N"], p["Me"])
    if key == "LAFH":
        return 100.0 * g.dist(p["ANS"], p["Me"]) / g.dist(p["N"], p["Me"])
    if key == "U1_SN":
        return g.angle_between(g.vec(p["U1T"], p["U1A"]), g.vec(p["S"], p["N"]))
    if key == "U1_NA_deg":
        return g.wrap(g.direction(p["U1A"], p["U1T"]) - g.direction(p["N"], p["A"]))
    if key == "U1_NA_mm":
        return g.signed_dist_anterior(p["U1T"], p["N"], p["A"]) * k
    if key == "L1_NB_deg":
        return g.wrap(g.direction(p["B"], p["N"]) - g.direction(p["L1A"], p["L1T"]))
    if key == "L1_NB_mm":
        return g.signed_dist_anterior(p["L1T"], p["N"], p["B"]) * k
    if key == "IMPA":
        return g.angle_between(g.vec(p["L1A"], p["L1T"]), g.vec(p["Me"], p["Go"]))
    if key == "Interincisal":
        return g.angle_between(g.vec(p["U1T"], p["U1A"]), g.vec(p["L1T"], p["L1A"]))
    if key == "E_Ls":
        return g.signed_dist_anterior(p["Ls"], p["Prn"], p["Pos"]) * k
    if key == "E_Li":
        return g.signed_dist_anterior(p["Li"], p["Prn"], p["Pos"]) * k
    pairs = {"len_SN": ("S", "N"), "len_PP": ("ANS", "PNS"), "len_GoMe": ("Go", "Me"), "len_ArGo": ("Ar", "Go"),
             "len_NMe": ("N", "Me"), "len_ANSMe": ("ANS", "Me"), "len_SGo": ("S", "Go")}
    if key in pairs:
        a, b = pairs[key]
        return g.dist(p[a], p[b]) * k
    raise KeyError(key)


def norms_from(settings=None):
    out = {k: dict(mean=m, sd=s) for k, (m, s) in DEFAULT_NORMS.items()}
    for k, v in ((settings or {}).get("norms") or {}).items():
        if k in out and isinstance(v, dict):
            for f in ("mean", "sd"):
                try:
                    out[k][f] = float(v[f])
                except (KeyError, TypeError, ValueError):
                    pass
    return out


def cutoffs_from(settings=None):
    out = dict(DEFAULT_CUTOFFS)
    for k, v in ((settings or {}).get("cutoffs") or {}).items():
        if k in out:
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                pass
    return out


def _wits_norm_key(sex):
    s = (sex or "").strip().upper()[:1]
    return "Wits_M" if s == "M" else "Wits_F" if s == "F" else "Wits_U"


def measure(landmarks, mm_per_px=None, facing=None, sex=None, settings=None):
    """All measurements. Returns a list of dicts (key, label, group, unit, value, norm, z, missing, note, desc)."""
    pts = {k: v for k, v in (landmarks or {}).items() if v is not None}
    facing = facing or g.facing_of(pts) or "right"
    p = g.to_canonical(pts, facing)
    norms = norms_from(settings)
    out = []
    for key, label, group, unit, needs, needs_mm, desc in MEASURES:
        row = dict(key=key, label=label, group=group, unit=unit, desc=desc, value=None, norm=None, z=None,
                   missing=[c for c in needs if c not in p], note="")
        nkey = _wits_norm_key(sex) if key == "Wits" else key
        if nkey in norms:
            row["norm"] = norms[nkey]
        if row["missing"]:
            row["note"] = "not traced"
        elif needs_mm and not mm_per_px:
            row["note"] = "needs calibration"
        else:
            try:
                row["value"] = round(_compute(key, p, mm_per_px if needs_mm else None), 1)
            except (ValueError, ZeroDivisionError):
                row["note"] = "points overlap"
            if row["value"] is not None and row["norm"] and row["norm"]["sd"] > 0:
                row["z"] = round((row["value"] - row["norm"]["mean"]) / row["norm"]["sd"], 2)
        out.append(row)
    return out


def _fmt(v, unit):
    if v is None:
        return "-"
    sign = "+" if unit == MM and v > 0 else ""
    return f"{sign}{v:.1f}{'' if unit == DEG else ' '}{unit}"


def summarize(rows, sex=None, settings=None, cvm=None):
    """Plain-language calls from the measurements: skeletal class, vertical pattern, jaws, incisors, lips."""
    by = {r["key"]: r for r in rows}
    cut = cutoffs_from(settings)
    norms = norms_from(settings)
    val = lambda k: by.get(k, {}).get("value")  # noqa: E731
    items = []

    # --- skeletal class (ANB + Wits) ---
    anb, wits = val("ANB"), val("Wits")
    calls, ev = [], []
    if anb is not None:
        c = "II" if anb > cut["anb_class2_above"] else "III" if anb < cut["anb_class3_below"] else "I"
        calls.append(("ANB", c))
        ev.append(f"ANB {_fmt(anb, DEG)} (Class I from {cut['anb_class3_below']:g} to {cut['anb_class2_above']:g}°)")
    if wits is not None:
        wn = norms[_wits_norm_key(sex)]["mean"]
        hi, lo = wn + cut["wits_band"], wn - cut["wits_band"]
        c = "II" if wits > hi else "III" if wits < lo else "I"
        calls.append(("Wits", c))
        ev.append(f"Wits {_fmt(wits, MM)} (Class I from {lo:+g} to {hi:+g} mm)")
    if calls:
        kinds = {c for _, c in calls}
        if len(kinds) == 1:
            k = kinds.pop()
            items.append(dict(key="sagittal", title="Skeletal class", call=f"Class {k}",
                              level="ok" if k == "I" else "warn", detail=" · ".join(ev), borderline=False))
        else:
            who = ", ".join(f"{m} Class {c}" for m, c in calls)
            items.append(dict(key="sagittal", title="Skeletal class", call=f"Borderline ({who})",
                              level="warn", detail=" · ".join(ev) +
                              ". ANB depends on the cranial base, Wits on the occlusal plane - check SN and the occlusal plane.",
                              borderline=True))

    # --- vertical pattern (FMA + SN-GoGn) ---
    vcalls, vev = [], []
    for key, lo_k, hi_k, name in (("FMA", "fma_low_below", "fma_high_above", "FMA"),
                                  ("SN_GoGn", "sngogn_low_below", "sngogn_high_above", "SN-GoGn")):
        v = val(key)
        if v is None:
            continue
        c = "high" if v > cut[hi_k] else "low" if v < cut[lo_k] else "average"
        vcalls.append(c)
        vev.append(f"{name} {_fmt(v, DEG)} (average {cut[lo_k]:g}-{cut[hi_k]:g}°)")
    if vcalls:
        names = {"high": "High angle (hyperdivergent)", "low": "Low angle (hypodivergent)", "average": "Average angle"}
        if len(set(vcalls)) == 1:
            c = vcalls[0]
            items.append(dict(key="vertical", title="Vertical pattern", call=names[c],
                              level="ok" if c == "average" else "warn", detail=" · ".join(vev), borderline=False))
        else:
            says = {"high": "high", "low": "low", "average": "average"}
            who = ", ".join(f"{n} {says[c]}" for n, c in zip(("FMA", "SN-GoGn"), vcalls))
            items.append(dict(key="vertical", title="Vertical pattern", call=f"Borderline ({who})", level="warn",
                              detail=" · ".join(vev), borderline=True))

    # --- jaws (SNA / SNB) ---
    def pos_call(key, word, lo_word, hi_word):
        r = by.get(key)
        if not r or r["value"] is None or not r["norm"]:
            return None
        m, s = r["norm"]["mean"], r["norm"]["sd"]
        c = hi_word if r["value"] > m + s else lo_word if r["value"] < m - s else "within norms"
        return f"{word} {c} ({r['label']} {_fmt(r['value'], DEG)}, norm {m:g}±{s:g})"

    jaw = [x for x in (pos_call("SNA", "Maxilla", "retrusive", "protrusive"),
                       pos_call("SNB", "Mandible", "retrusive", "protrusive")) if x]
    if jaw:
        level = "ok" if all("within" in x for x in jaw) else "info"
        items.append(dict(key="jaws", title="Jaws", call="; ".join(x.split(" (")[0] for x in jaw),
                          level=level, detail=" · ".join(jaw), borderline=False))

    # --- incisors ---
    inc = []
    for key, word in (("U1_SN", "Upper incisors"), ("IMPA", "Lower incisors")):
        r = by.get(key)
        if not r or r["value"] is None or not r["norm"]:
            continue
        m, s = r["norm"]["mean"], r["norm"]["sd"]
        c = "proclined" if r["value"] > m + s else "retroclined" if r["value"] < m - s else "within norms"
        inc.append((word, c, f"{r['label']} {_fmt(r['value'], DEG)} (norm {m:g}±{s:g})"))
    if inc:
        items.append(dict(key="incisors", title="Incisors", call="; ".join(f"{w} {c}" for w, c, _ in inc),
                          level="ok" if all(c == "within norms" for _, c, _ in inc) else "info",
                          detail=" · ".join(e for _, _, e in inc), borderline=False))

    # --- lips to the E-line ---
    lips = []
    for key, word in (("E_Ls", "Upper lip"), ("E_Li", "Lower lip")):
        r = by.get(key)
        if not r or r["value"] is None or not r["norm"]:
            continue
        m, s = r["norm"]["mean"], r["norm"]["sd"]
        c = "protrusive" if r["value"] > m + s else "retrusive" if r["value"] < m - s else "within norms"
        lips.append((word, c, f"{r['label']} {_fmt(r['value'], MM)} (norm {m:+g}±{s:g})"))
    if lips:
        items.append(dict(key="lips", title="Lips (E-line)", call="; ".join(f"{w} {c}" for w, c, _ in lips),
                          level="ok" if all(c == "within norms" for _, c, _ in lips) else "info",
                          detail=" · ".join(e for _, _, e in lips), borderline=False))

    # --- growth (CVM) ---
    if cvm and cvm.get("stage"):
        items.append(dict(key="cvm", title="Growth (CVM)", call=cvm["stage_label"], level="info",
                          detail=cvm.get("timing", ""), borderline=bool(cvm.get("borderline"))))
    return items


def analyze(landmarks, mm_per_px=None, facing=None, sex=None, settings=None):
    """Everything the case view shows: measurements, CVM and the summary."""
    pts = {k: v for k, v in (landmarks or {}).items() if v is not None}
    facing = facing or g.facing_of(pts) or "right"
    rows = measure(pts, mm_per_px, facing, sex, settings)
    cvm = cvm_stage(g.to_canonical(pts, facing), mm_per_px, (settings or {}).get("cvm"))
    return dict(facing=facing, measurements=rows, cvm=cvm, summary=summarize(rows, sex, settings, cvm))
