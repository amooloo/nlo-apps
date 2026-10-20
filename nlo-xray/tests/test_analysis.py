"""Measurements on the template tracing, checked against values worked out by hand."""
import math

import pytest

from xray.analysis import analyze, measure
from xray.landmarks import TEMPLATE

MM = 0.1


def template_px(facing="right", mm=MM):
    """Template (canonical mm, Y up) as image pixels (y down)."""
    out = {}
    for k, (X, Y) in TEMPLATE.items():
        x = X / mm + 500 if facing == "right" else 2500 - X / mm
        out[k] = (x, -Y / mm + 300)
    return out


def by_key(rows):
    return {r["key"]: r for r in rows}


EXPECTED = {   # from the template coordinates, by hand
    "SNA": 81.0, "SNB": 78.0, "ANB": 3.0, "SN_FH": 7.0, "FMA": 25.0, "Gonial": 126.0,
    "U1_SN": 103.3, "U1_NA_deg": 22.3, "L1_NB_deg": 23.2, "IMPA": 93.2, "Interincisal": 131.6,
    "Wits": 1.2, "len_SN": 68.0, "len_GoMe": 68.0, "len_ArGo": 42.0,
}


def test_template_values():
    rows = by_key(measure(template_px(), mm_per_px=MM))
    for k, v in EXPECTED.items():
        assert rows[k]["value"] == pytest.approx(v, abs=0.15), k


def test_mirror_image_gives_the_same_numbers():
    a = by_key(measure(template_px("right"), mm_per_px=MM))
    b = by_key(measure(template_px("left"), mm_per_px=MM))
    for k in a:
        assert a[k]["value"] == b[k]["value"], k


def test_angles_do_not_need_calibration_but_mm_do():
    rows = by_key(measure(template_px(), mm_per_px=None))
    assert rows["ANB"]["value"] == pytest.approx(3.0, abs=0.15)
    assert rows["Jarabak"]["value"] is not None
    assert rows["Wits"]["value"] is None and rows["Wits"]["note"] == "needs calibration"
    assert rows["E_Li"]["value"] is None


def test_linear_values_follow_the_pixel_size():
    a = by_key(measure(template_px(mm=0.1), mm_per_px=0.1))
    b = by_key(measure(template_px(mm=0.05), mm_per_px=0.05))
    for k in ("Wits", "len_SN", "E_Ls", "U1_NA_mm"):
        assert a[k]["value"] == pytest.approx(b[k]["value"], abs=0.11), k


def test_missing_points_are_reported():
    pts = template_px()
    del pts["B"]
    rows = by_key(measure(pts, mm_per_px=MM))
    assert rows["SNB"]["value"] is None and "B" in rows["SNB"]["missing"]
    assert rows["SNA"]["value"] is not None


def test_signs_proclined_lower_incisor_and_class_ii():
    pts = template_px()
    # tip the lower incisor forward: move its tip 3 mm anteriorly
    x, y = pts["L1T"]
    pts["L1T"] = (x + 30, y)
    base = by_key(measure(template_px(), mm_per_px=MM))
    rows = by_key(measure(pts, mm_per_px=MM))
    assert rows["IMPA"]["value"] > base["IMPA"]["value"] + 5
    assert rows["L1_NB_deg"]["value"] > base["L1_NB_deg"]["value"] + 5
    assert rows["L1_NB_mm"]["value"] > base["L1_NB_mm"]["value"] + 2
    # mandible back by 6 mm -> ANB up, Wits up, Class II
    pts = template_px()
    for k in ("B", "Pog", "Gn", "Me"):
        x, y = pts[k]
        pts[k] = (x - 60, y)
    a = analyze(pts, mm_per_px=MM, sex="M")
    rows = by_key(a["measurements"])
    assert rows["ANB"]["value"] > 6
    assert rows["Wits"]["value"] > 5
    sag = next(s for s in a["summary"] if s["key"] == "sagittal")
    assert sag["call"] == "Class II"


def test_summary_class_iii_and_borderline():
    pts = template_px()
    for k in ("B", "Pog", "Gn", "Me"):
        x, y = pts[k]
        pts[k] = (x + 70, y)
    a = analyze(pts, mm_per_px=MM)
    sag = next(s for s in a["summary"] if s["key"] == "sagittal")
    assert sag["call"] == "Class III"
    # settings move the cutoff so ANB 3 counts as Class II while Wits stays Class I -> borderline
    a = analyze(template_px(), mm_per_px=MM, settings={"cutoffs": {"anb_class2_above": 2.5}})
    sag = next(s for s in a["summary"] if s["key"] == "sagittal")
    assert sag["borderline"] and sag["call"].startswith("Borderline (ANB Class II, Wits Class I")


def test_norm_overrides_apply():
    rows = by_key(measure(template_px(), mm_per_px=MM, settings={"norms": {"SNA": {"mean": 85, "sd": 2}}}))
    assert rows["SNA"]["norm"] == {"mean": 85.0, "sd": 2.0}
    assert rows["SNA"]["z"] == pytest.approx((81.0 - 85) / 2, abs=0.05)


def test_wits_norm_by_sex():
    m = by_key(measure(template_px(), mm_per_px=MM, sex="M"))["Wits"]["norm"]["mean"]
    f = by_key(measure(template_px(), mm_per_px=MM, sex="F"))["Wits"]["norm"]["mean"]
    assert (m, f) == (-1.0, 0.0)


def test_vertical_calls():
    pts = template_px()
    # open the mandibular plane: drop menton/gnathion 15 mm
    for k in ("Me", "Gn", "Pog"):
        x, y = pts[k]
        pts[k] = (x, y + 150)
    a = analyze(pts, mm_per_px=MM)
    v = next(s for s in a["summary"] if s["key"] == "vertical")
    assert "High angle" in v["call"]
    assert by_key(a["measurements"])["FMA"]["value"] > 30
    assert math.isfinite(by_key(a["measurements"])["Jarabak"]["value"])


def test_mandibular_plane_is_the_tangent_through_menton():
    """FMA, IMPA and PP-MP use menton to the lower-border point (Tweed); Go-Me only when that point is missing."""
    pts = template_px()
    base = by_key(measure(pts, mm_per_px=MM))
    # the template's lower-border point lies on Go-Me: same numbers
    no_mpt = dict(pts)
    del no_mpt["MPt"]
    fallback = by_key(measure(no_mpt, mm_per_px=MM))
    for k in ("FMA", "IMPA", "PP_MP"):
        assert base[k]["value"] == pytest.approx(fallback[k]["value"], abs=0.15), k
        assert "Go-Me used" in fallback[k]["desc"] and "Go-Me used" not in base[k]["desc"]
    # drop the lower-border point 2 mm below Go-Me (an antegonial notch): the plane flattens - FMA and
    # PP-MP fall, IMPA rises - while SN-GoGn (Steiner, Go-Gn) does not move
    x, y = pts["MPt"]
    pts["MPt"] = (x, y + 20)
    moved = by_key(measure(pts, mm_per_px=MM))
    assert moved["FMA"]["value"] < base["FMA"]["value"] - 1
    assert moved["PP_MP"]["value"] < base["PP_MP"]["value"] - 1
    assert moved["IMPA"]["value"] > base["IMPA"]["value"] + 1
    assert moved["SN_GoGn"]["value"] == base["SN_GoGn"]["value"]


def test_lower_face_height_is_measured_perpendicular_to_fh():
    # FH level; N at the top, ANS 50 mm and Me 110 mm below it, Me well forward of N
    pts = {"Po": (0, 0), "Or": (800, 0), "N": (1000, -300), "ANS": (1050, 200), "Me": (1400, 800)}
    rows = by_key(measure(pts, mm_per_px=MM))
    assert rows["LAFH"]["value"] == pytest.approx(100 * 600 / 1100, abs=0.06)       # vertical heights only
    del pts["Po"]
    rows = by_key(measure(pts, mm_per_px=MM))
    straight = 100 * math.hypot(350, 600) / math.hypot(400, 1100)
    assert rows["LAFH"]["value"] == pytest.approx(straight, abs=0.06)
    assert "Straight distances" in rows["LAFH"]["desc"]
