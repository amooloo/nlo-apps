"""Cephalometric measurements, norms and the plain-language summary (skeletal class, vertical pattern,
incisors, lips). Pure geometry on the traced landmarks - no AI here.

Input: landmarks in image pixels {code: (x, y)}, the facing ('right'/'left', worked out from S and N
when not given) and mm per pixel (None when the x-ray is not calibrated: angles and ratios still work,
millimetre measurements come back as 'needs calibration').

Norms and cutoffs are defaults the doctor can change in Settings; `settings` overrides them per key.
"""
import math

import numpy as np

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
    # facial thirds, soft tissue: Legan & Burstone (1980) give the ratios (middle : lower third 1 : 1, upper lip :
    # lower lip and chin 1 : 2) and the lips (gap 2 ± 2 mm, upper incisor showing 2 ± 2 mm); the bands round the two
    # ratios (± 3 %) are the app's own - Settings -> Norms changes them
    "LowShareS": (50.0, 3.0), "LipShare": (33.3, 3.0), "Interlabial": (2.0, 2.0), "U1Expo": (2.0, 2.0),
    # Andrews: the upper incisor's FA point on the GALL line (the ± 2 mm band is the app's own)
    "U1_GALL": (0.0, 2.0),
}

# millimetre values with a direction (shown with + / -); the others are sizes
SIGNED = {"Wits", "U1_NA_mm", "L1_NB_mm", "E_Ls", "E_Li", "U1Expo", "U1_GALL"}

DEFAULT_CUTOFFS = {
    "anb_class2_above": 4.0,     # ANB above this -> Class II
    "anb_class3_below": 0.0,     # ANB below this -> Class III
    "wits_band": 2.0,            # Wits more than this above / below the norm for the sex -> Class II / III
    "fma_low_below": 20.0, "fma_high_above": 30.0,
    "sngogn_low_below": 27.0, "sngogn_high_above": 37.0,
    # Andrews' GALL: through the forehead's FA point, moved forward this much for each degree of forehead
    # inclination beyond gall_from_deg, never ahead of glabella (Andrews' Six Elements, Element II)
    "gall_from_deg": 7.0, "gall_mm_per_deg": 0.6,
}

# key, label, group, unit, landmarks needed, needs mm, description
MEASURES = [
    ("SNA", "SNA", "Skeletal - front to back", DEG, ("S", "N", "A"), False,
     "Maxilla to the cranial base: angle S-N-A."),
    ("SNB", "SNB", "Skeletal - front to back", DEG, ("S", "N", "B"), False,
     "Mandible to the cranial base: angle S-N-B."),
    ("ANB", "ANB", "Skeletal - front to back", DEG, ("S", "N", "A", "B"), False,
     "SNA minus SNB: the jaws to each other. Positive when A lies ahead of B."),
    ("Wits", "Wits appraisal", "Skeletal - front to back", MM, ("A", "B", "MOL", "U1T", "L1T"), True,
     "A and B projected onto the occlusal plane (from the molar contact to the incisor overlap, midway between the "
     "upper and lower incisor tips): AO minus BO. Positive when AO is ahead of BO."),
    ("SN_FH", "SN to FH", "Skeletal - vertical", DEG, ("S", "N", "Po", "Or"), False,
     "Cant of the cranial base to Frankfort horizontal (Po-Or)."),
    ("FMA", "FMA (FH to MP)", "Skeletal - vertical", DEG, ("Po", "Or", "Go", "Me"), False,
     "Frankfort horizontal to the mandibular plane: menton to the lower-border point, the tangent to the lower "
     "border (Tweed)."),
    ("SN_GoGn", "SN to GoGn", "Skeletal - vertical", DEG, ("S", "N", "Go", "Gn"), False,
     "Cranial base to the mandibular plane (Go-Gn), Steiner."),
    ("PP_MP", "Palatal to mandibular plane", "Skeletal - vertical", DEG, ("ANS", "PNS", "Go", "Me"), False,
     "ANS-PNS to the mandibular plane (menton to the lower-border point)."),
    ("Gonial", "Gonial angle", "Skeletal - vertical", DEG, ("Ar", "Go", "Me"), False,
     "Angle Ar-Go-Me."),
    ("Jarabak", "Face height ratio (Jarabak)", "Skeletal - vertical", PCT, ("S", "Go", "N", "Me"), False,
     "Posterior face height S-Go over anterior face height N-Me. Lower = more vertical (clockwise) grower."),
    ("UFH", "Middle third (N-ANS)", "Facial thirds", MM, ("N", "ANS", "Po", "Or"), True,
     "Upper anterior face height, hard tissue: nasion to ANS, measured perpendicular to Frankfort horizontal."),
    ("LFH", "Lower third (ANS-Me)", "Facial thirds", MM, ("ANS", "Me", "Po", "Or"), True,
     "Lower anterior face height, hard tissue: ANS to menton, measured perpendicular to Frankfort horizontal."),
    ("LAFH", "Lower third share (ANS-Me / N-Me)", "Facial thirds", PCT, ("ANS", "Me", "N"), False,
     "Lower over total anterior face height, ANS-Me / N-Me, both measured perpendicular to Frankfort horizontal "
     "(Wylie): about 55 %, the lower third a little longer than the middle one."),
    ("UpS", "Upper third, soft tissue (Tr-G')", "Facial thirds", MM, ("Tr", "Gs", "S", "N"), True,
     "Top of the forehead (trichion) to soft-tissue glabella, measured perpendicular to the horizontal plane: with "
     "G'-Sn and Sn-Me' the three thirds of the face, ideally about equal."),
    ("MidS", "Middle third, soft tissue (G'-Sn)", "Facial thirds", MM, ("Gs", "Sn", "S", "N"), True,
     "Soft-tissue glabella to subnasale, measured perpendicular to the horizontal plane (through nasion at 7° to SN, "
     "Legan & Burstone 1980)."),
    ("LowS", "Lower third, soft tissue (Sn-Me')", "Facial thirds", MM, ("Sn", "Mes", "S", "N"), True,
     "Subnasale to soft-tissue menton, measured perpendicular to the horizontal plane (Legan & Burstone)."),
    ("LowShareS", "Lower third share, soft tissue", "Facial thirds", PCT, ("Gs", "Sn", "Mes", "S", "N"), False,
     "Sn-Me' over G'-Me', perpendicular to the horizontal plane. Legan & Burstone: middle and lower thirds equal "
     "(1 : 1), i.e. 50 %. Above = a long lower face, below = a short one."),
    ("LipShare", "Upper lip share of the lower third", "Facial thirds", PCT, ("Sn", "Stms", "Stmi", "Mes", "S", "N"),
     False, "Sn-Stms over Sn-Stms plus Stmi-Me', perpendicular to the horizontal plane. Legan & Burstone: upper lip to "
     "lower lip and chin 1 : 2, i.e. a third."),
    ("Interlabial", "Lips apart (Stms-Stmi)", "Facial thirds", MM, ("Stms", "Stmi", "S", "N"), True,
     "Gap between the lips at rest, measured vertically (perpendicular to the horizontal plane). Legan & Burstone: "
     "2 ± 2 mm."),
    ("U1Expo", "Upper incisor showing (Stms-U1)", "Facial thirds", MM, ("Stms", "U1T", "S", "N"), True,
     "How far the upper incisor tip reaches below the upper lip at rest, vertically; negative when it stays above the "
     "lip line. Legan & Burstone: 2 ± 2 mm."),
    ("FI", "Forehead inclination", "Incisors to the forehead (Andrews)", DEG, ("Tr", "Gs"), False,
     "The forehead (from its top to soft-tissue glabella) against the true vertical - the x-ray's own vertical, as "
     "the cephs are taken with the head upright. Positive: the forehead slopes back."),
    ("U1_GALL", "Upper incisor to GALL", "Incisors to the forehead (Andrews)", MM,
     ("Tr", "Gs", "U1A", "U1T"), True,
     "The upper incisor's FA point (the middle of the labial surface of the crown) to Andrews' GALL line: a true "
     "vertical through the forehead's FA point (half way up the forehead, between its top and glabella), moved forward "
     "0.6 mm for each degree of forehead inclination beyond 7°, never ahead of glabella (both numbers: Settings -> "
     "Norms). 0 = touching GALL, the goal; + = ahead of it."),
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
     "Lower incisor long axis to the mandibular plane (menton to the lower-border point, Tweed)."),
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


MP_KEYS = ("FMA", "PP_MP", "IMPA")


def _mp(p):
    """The back end of the mandibular plane: the lower-border point (the tangent to the lower border through
    menton, Tweed / Downs); gonion on tracings without it (Go-Me)."""
    return p["MPt"] if "MPt" in p else p["Go"]


def _up(p, frame):
    """Unit vector 'up' for vertical heights: perpendicular to Frankfort horizontal ('FH'), or to the horizontal plane
    of Legan & Burstone ('HP': through nasion at 7° to SN, turned toward FH)."""
    if frame == "FH":
        d = g.unit(g.vec(p["Po"], p["Or"]))
    else:
        a = math.radians(g.direction(p["S"], p["N"]) - 7.0)
        d = np.array([math.cos(a), math.sin(a)])
    n = np.array([-d[1], d[0]])
    return n if n[1] >= 0 else -n


def _height(p, a, b, frame):
    """How far a lies above b, measured perpendicular to the frame's horizontal (canonical pixels)."""
    return float((p[a] - p[b]) @ _up(p, frame))


def andrews_gall(p, mm, profile=None, cut=None):
    """Andrews' Goal Anterior Limit Line on canonical points p (pixels; mm: mm per pixel). True vertical: the x-ray's
    own vertical - Andrews draws GALL along the true vertical with the head upright, the way these cephs are taken
    (not square to Po-Or, which tips it whenever FH is not quite level on the x-ray). FFA: the forehead's surface
    half way up between its top (Tr) and soft-tissue glabella - on the traced profile when there is one (canonical
    pixels), else the middle of the line joining them.
    GALL runs through FFA, moved forward cut['gall_mm_per_deg'] mm per degree of forehead inclination beyond
    cut['gall_from_deg'], never ahead of glabella. The upper incisor's FA point: the middle of the labial surface of
    its crown (the textbook incisor along the doctor's U1 axis). Returns dict or None."""
    if not mm or any(c not in p for c in ("Tr", "Gs", "U1A", "U1T")):
        return None
    cut = cut or DEFAULT_CUTOFFS
    try:
        ax = g.unit(g.vec(p["U1A"], p["U1T"]))
    except ValueError:
        return None
    h, v = np.array([1.0, 0.0]), np.array([0.0, 1.0])      # forward and up on the x-ray (canonical frame)
    tr, gs = np.asarray(p["Tr"], float), np.asarray(p["Gs"], float)
    d = tr - gs
    if d @ v <= 0:
        return None                                   # the top of the forehead must lie above glabella
    fi = math.degrees(math.atan2(-(d @ h), d @ v))   # + : the forehead slopes back from glabella
    mid = (tr + gs) / 2.0
    ffa = mid
    if profile is not None and len(profile) >= 3:
        P = np.asarray(profile, float)
        hv = P @ v - mid @ v
        best = None
        for i in range(len(P) - 1):
            if hv[i] == hv[i + 1] or hv[i] * hv[i + 1] > 0:
                continue
            q = P[i] + hv[i] / (hv[i] - hv[i + 1]) * (P[i + 1] - P[i])
            off = abs((q - mid) @ h)
            if off * mm < 15.0 and (best is None or off < best[0]):       # the forehead itself, not the nose
                best = (off, q)
        if best:
            ffa = best[1]
    shift = max(0.0, fi - cut["gall_from_deg"]) * cut["gall_mm_per_deg"]        # mm
    x_gall = float(ffa @ h) + shift / mm
    capped = x_gall > float(gs @ h)
    if capped:
        x_gall = float(gs @ h)
    lab = np.array([-ax[1], ax[0]])
    if lab[0] < 0:
        lab = -lab
    k = g.dist(p["U1A"], p["U1T"]) / 24.5
    fa = np.asarray(p["U1A"], float) + 19.25 * k * ax + 3.2 * k * lab
    return dict(fi=fi, ffa=ffa, fa=fa, x_gall=x_gall, shift=shift, capped=capped, dist=(float(fa @ h) - x_gall) * mm,
                h=h, v=v)


def occlusal_plane(p):
    """The occlusal plane: from the molar contact to the incisor overlap (midway between the incisor tips)."""
    return p["MOL"], (np.asarray(p["U1T"], float) + np.asarray(p["L1T"], float)) / 2.0


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
        d = g.unit(g.vec(*occlusal_plane(p)))
        if d[0] < 0:          # keep the occlusal-plane direction pointing forward
            d = -d
        return float((p["A"] - p["B"]) @ d) * k
    if key == "UFH":
        return _height(p, "N", "ANS", "FH") * k
    if key == "LFH":
        return _height(p, "ANS", "Me", "FH") * k
    if key == "UpS":
        return _height(p, "Tr", "Gs", "HP") * k
    if key == "MidS":
        return _height(p, "Gs", "Sn", "HP") * k
    if key == "LowS":
        return _height(p, "Sn", "Mes", "HP") * k
    if key == "LowShareS":
        mid, low = _height(p, "Gs", "Sn", "HP"), _height(p, "Sn", "Mes", "HP")
        return 100.0 * low / (mid + low)
    if key == "LipShare":
        up, low = _height(p, "Sn", "Stms", "HP"), _height(p, "Stmi", "Mes", "HP")
        return 100.0 * up / (up + low)
    if key == "Interlabial":
        return _height(p, "Stms", "Stmi", "HP") * k
    if key == "U1Expo":
        return _height(p, "Stms", "U1T", "HP") * k
    if key == "SN_FH":
        return g.line_angle(p["S"], p["N"], p["Po"], p["Or"])
    if key == "FMA":
        return g.line_angle(p["Po"], p["Or"], _mp(p), p["Me"])
    if key == "SN_GoGn":
        return g.line_angle(p["S"], p["N"], p["Go"], p["Gn"])
    if key == "PP_MP":
        return g.line_angle(p["ANS"], p["PNS"], _mp(p), p["Me"])
    if key == "Gonial":
        return g.angle_at(p["Ar"], p["Go"], p["Me"])
    if key == "Jarabak":
        return 100.0 * g.dist(p["S"], p["Go"]) / g.dist(p["N"], p["Me"])
    if key == "LAFH":
        if "Po" in p and "Or" in p:                   # heights perpendicular to FH, as Wylie measured them
            u = g.unit(g.vec(p["Po"], p["Or"]))
            n = (-u[1], u[0])
            h = lambda a, b: abs(float((p[b][0] - p[a][0]) * n[0] + (p[b][1] - p[a][1]) * n[1]))  # noqa: E731
            return 100.0 * h("ANS", "Me") / h("N", "Me")
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
        return g.angle_between(g.vec(p["L1A"], p["L1T"]), g.vec(p["Me"], _mp(p)))
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


def measure(landmarks, mm_per_px=None, facing=None, sex=None, settings=None, profile=None):
    """All measurements. Returns a list of dicts (key, label, group, unit, value, norm, z, missing, note, desc).
    profile: the soft-tissue profile, image pixels (for the forehead's FA point)."""
    pts = {k: v for k, v in (landmarks or {}).items() if v is not None}
    facing = facing or g.facing_of(pts) or "right"
    p = g.to_canonical(pts, facing)
    norms = norms_from(settings)
    prof = None
    if profile is not None and len(profile) >= 3:
        sx = 1.0 if facing != "left" else -1.0
        prof = np.array([[sx * float(x), -float(y)] for x, y in profile])
    gall = andrews_gall(p, mm_per_px, prof, cutoffs_from(settings))
    out = []
    for key, label, group, unit, needs, needs_mm, desc in MEASURES:
        row = dict(key=key, label=label, group=group, unit=unit, desc=desc, value=None, norm=None, z=None,
                   missing=[c for c in needs if c not in p], note="", signed=key in SIGNED)
        nkey = _wits_norm_key(sex) if key == "Wits" else key
        if nkey in norms:
            row["norm"] = norms[nkey]
        if row["missing"]:
            row["note"] = "not traced"
        elif needs_mm and not mm_per_px:
            row["note"] = "needs calibration"
        elif key in ("FI", "U1_GALL"):
            if gall is None:
                row["note"] = "forehead top below glabella" if mm_per_px else "needs calibration"
            else:
                row["value"] = round(gall["fi"] if key == "FI" else gall["dist"], 1)
        else:
            try:
                row["value"] = round(_compute(key, p, mm_per_px if needs_mm else None), 1)
            except (ValueError, ZeroDivisionError):
                row["note"] = "points overlap"
            if key in MP_KEYS and "MPt" not in p and row["value"] is not None:
                row["desc"] += " Go-Me used here: the lower-border point is not traced."
                row["note"] = "Go-Me"
            if key == "LAFH" and not ("Po" in p and "Or" in p) and row["value"] is not None:
                row["desc"] += " Straight distances here: Frankfort horizontal is not traced."
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

    # --- facial thirds: the lower third against the middle one, hard and soft tissue ---
    th, tev = [], []
    for key, word, a, b in (("LAFH", "hard tissue", "UFH", "LFH"), ("LowShareS", "soft tissue", "MidS", "LowS")):
        r = by.get(key)
        if not r or r["value"] is None or not r["norm"]:
            continue
        m, s = r["norm"]["mean"], r["norm"]["sd"]
        c = "long" if r["value"] > m + s else "short" if r["value"] < m - s else "in proportion"
        th.append((word, c))
        mm = f"{val(a):.0f} : {val(b):.0f} mm, " if val(a) is not None and val(b) is not None else ""
        names = "N-ANS : ANS-Me" if key == "LAFH" else "G'-Sn : Sn-Me'"
        tev.append(f"{word.capitalize()} {names} {mm}lower third {r['value']:.0f} % (norm {m:g}±{s:g})")
    lip = by.get("LipShare")
    if th and lip and lip["value"] is not None:
        tev.append(f"upper lip {lip['value']:.0f} % of the lower third (ideal a third)")
    if th:
        kinds = {c for _, c in th}
        if len(kinds) == 1:
            c = kinds.pop()
            call = "Middle and lower thirds in proportion" if c == "in proportion" else f"Lower third {c}"
            items.append(dict(key="thirds", title="Facial thirds", call=call, level="ok" if c == "in proportion" else "warn",
                              detail=" · ".join(tev), borderline=False))
        else:
            who = ", ".join(f"{w} {c}" for w, c in th)
            items.append(dict(key="thirds", title="Facial thirds", call=f"Borderline ({who})", level="warn",
                              detail=" · ".join(tev), borderline=True))

    # --- the upper incisors to the forehead (Andrews' GALL) ---
    r = by.get("U1_GALL")
    if r and r["value"] is not None and r["norm"]:
        m, sd = r["norm"]["mean"], r["norm"]["sd"]
        v = r["value"]
        call = ("Upper incisors ahead of GALL" if v > m + sd else "Upper incisors behind GALL" if v < m - sd
                else "Upper incisors at the GALL line")
        fi = val("FI")
        det = f"FA point {abs(v):.1f} mm {'ahead of' if v > 0 else 'behind'} GALL (goal: on it, ±{sd:g} mm)"
        if fi is not None:
            det += f" · forehead inclination {fi:.0f}°"
        items.append(dict(key="gall", title="Incisors to the forehead (Andrews)", call=call,
                          level="ok" if abs(v - m) <= sd else "info", detail=det, borderline=False))

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

    # --- growth (CVM): Baccetti, Hassel & Farman, Mito ---
    if cvm and cvm.get("stage"):
        m = cvm.get("methods") or {}
        hf, mi = m.get("hassel_farman"), m.get("mito")
        call = cvm["stage"] + (f" · CVMI {hf['cvmi']} {hf['name']}" if hf else "")
        parts = [f"Baccetti: {cvm.get('timing', '')}"]
        if hf:
            parts.append(f"Hassel & Farman: {hf['text']}")
        if mi:
            age = f" (age {mi['age']:.1f} y, {mi['diff']:+.1f} y)" if mi.get("age") is not None else ""
            parts.append(f"Mito: cervical vertebral bone age {mi['bone_age']:.1f} y{age}")
        items.append(dict(key="cvm", title="Growth (CVM)", call=call, level="info", detail=" · ".join(parts),
                          borderline=bool(cvm.get("borderline"))))
    return items


def gall_drawing(landmarks, mm_per_px=None, facing=None, settings=None, profile=None):
    """The GALL line, the forehead's FA point and the incisor's FA point in image pixels, for the viewer (or None)."""
    pts = {k: v for k, v in (landmarks or {}).items() if v is not None}
    facing = facing or g.facing_of(pts) or "right"
    p = g.to_canonical(pts, facing)
    sx = 1.0 if facing != "left" else -1.0
    prof = np.array([[sx * float(x), -float(y)] for x, y in profile]) if profile is not None and len(profile) >= 3 else None
    G = andrews_gall(p, mm_per_px, prof, cutoffs_from(settings))
    if G is None:
        return None
    h, v = G["h"], G["v"]
    low = min(float(np.asarray(p[c], float) @ v) for c in ("Mes", "Pos", "Me", "U1T") if c in p)
    ends = [G["x_gall"] * h + float(p["Tr"] @ v) * v, G["x_gall"] * h + (low - 0.08 * abs(float(p["Tr"] @ v) - low)) * v]
    img = lambda q: [round(sx * float(q[0]), 1), round(-float(q[1]), 1)]       # noqa: E731
    return dict(line=[img(e) for e in ends], ffa=img(G["ffa"]), fa=img(G["fa"]), fi=round(G["fi"], 1),
                shift=round(G["shift"], 1), capped=G["capped"], dist=round(G["dist"], 1))


def analyze(landmarks, mm_per_px=None, facing=None, sex=None, settings=None, cvm_marks=None, age=None, profile=None):
    """Everything the case view shows: measurements, CVM (three methods), the summary, the GALL line."""
    pts = {k: v for k, v in (landmarks or {}).items() if v is not None}
    facing = facing or g.facing_of(pts) or "right"
    rows = measure(pts, mm_per_px, facing, sex, settings, profile)
    cvm = cvm_stage(g.to_canonical(pts, facing), mm_per_px, (settings or {}).get("cvm"), cvm_marks, age, sex)
    return dict(facing=facing, measurements=rows, cvm=cvm, summary=summarize(rows, sex, settings, cvm),
                gall=gall_drawing(pts, mm_per_px, facing, settings, profile))
