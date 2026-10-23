"""CVM: the measured judgements, the three methods, the doctor's picks and tuning to his eye
(canonical frame: X anterior, Y up, mm)."""
import numpy as np
import pytest

from xray.cvm import DEFAULT_THRESHOLDS, features, fit_thresholds, judge, mito, stage


def vertebrae(c2=0.0, c3=0.0, c4=0.0, body=("trap", "trap"), width=15.0):
    """C2-C4 points. cN = concavity depth (mm). body: shape of C3, C4: trap / rh / sq / rv."""
    p = {}

    def border(lvl, y, depth):
        p[f"{lvl}lp"] = np.array([0.0, y])
        p[f"{lvl}la"] = np.array([width, y])
        p[f"{lvl}d"] = np.array([width / 2, y + depth])

    border("C2", 0.0, c2)
    y = -3.0
    for lvl, shape, dep in (("C3", body[0], c3), ("C4", body[1], c4)):
        h = {"trap": 11.0, "rh": 10.0, "sq": 15.0, "rv": 18.5}[shape]
        front = h * (0.65 if shape == "trap" else 1.0)
        p[f"{lvl}up"] = np.array([0.0, y])
        p[f"{lvl}ua"] = np.array([width, y - (h - front)])
        border(lvl, y - h, dep)
        y = y - h - 3.0
    return p


def test_baccetti_stages():
    assert stage(vertebrae(0, 0, 0, ("trap", "trap")))["stage"] == "CS1"
    assert stage(vertebrae(1.5, 0, 0, ("trap", "trap")))["stage"] == "CS2"
    assert stage(vertebrae(1.5, 1.5, 0, ("trap", "rh")))["stage"] == "CS3"
    assert stage(vertebrae(1.5, 1.5, 1.5, ("rh", "rh")))["stage"] == "CS4"
    assert stage(vertebrae(1.5, 1.5, 1.5, ("sq", "rh")))["stage"] == "CS5"
    assert stage(vertebrae(1.5, 1.5, 1.5, ("rv", "sq")))["stage"] == "CS6"


def test_hassel_farman_follows_the_same_judgements():
    names = {1: "Initiation", 2: "Acceleration", 3: "Transition", 4: "Deceleration", 5: "Maturation", 6: "Completion"}
    cases = [vertebrae(0, 0, 0), vertebrae(1.5, 0, 0), vertebrae(1.5, 1.5, 0, ("trap", "rh")),
             vertebrae(1.5, 1.5, 1.5, ("rh", "rh")), vertebrae(1.5, 1.5, 1.5, ("sq", "rh")),
             vertebrae(1.5, 1.5, 1.5, ("rv", "sq"))]
    for i, p in enumerate(cases, start=1):
        hf = stage(p)["methods"]["hassel_farman"]
        assert hf["cvmi"] == i and hf["name"] == names[i]
    hf = stage(cases[0])["methods"]["hassel_farman"]
    assert (hf["lo"], hf["hi"]) == (80, 100)
    hf = stage(cases[4])["methods"]["hassel_farman"]
    assert (hf["lo"], hf["hi"]) == (5, 10)


def test_mito_bone_age_by_hand():
    p = vertebrae(1.5, 1.5, 1.5, ("sq", "sq"))     # C3, C4 square: AH = PH = 15, AP = 15
    r = mito(features(p), age=12.0, sex="F")
    assert r["bone_age"] == pytest.approx(-0.20 + 6.20 + 5.90 + 4.74, abs=0.05)
    assert r["diff"] == pytest.approx(r["bone_age"] - 12.0, abs=0.05)
    assert r["note"] == ""
    p = vertebrae(0, 0, 0, ("trap", "trap"))       # AH = 7.15, PH = 11, AP = 15
    r = mito(features(p), sex="M")
    want = -0.20 + 6.20 * 7.15 / 15 + 5.90 * 7.15 / 15 + 4.74 * 7.15 / 11
    assert r["bone_age"] == pytest.approx(want, abs=0.05)
    assert "girls" in r["note"] and r["diff"] is None
    del p["C4la"]
    assert mito(features(p)) is None


def test_judgements_are_reported_and_explained():
    r = stage(vertebrae(1.5, 1.5, 0, ("rh", "rh")), mm=1.0)
    j = r["judgements"]
    assert j["C2"]["auto"] == "concave" and j["C3"]["auto"] == "concave" and j["C4"]["auto"] == "flat"
    assert j["C3shape"]["auto"] == "rect_h"
    f = {x["level"]: x for x in r["features"]}
    assert f["C2"]["concavity_mm"] == 1.5
    assert "coming year" in r["timing"]


def test_the_doctors_picks_win():
    p = vertebrae(0, 0, 0)                        # the tracing reads CS1
    r = stage(p, marks={"C2": "concave"})
    assert r["stage"] == "CS2" and r["auto_stage"] == "CS1" and r["overridden"]
    assert r["judgements"]["C2"] == dict(auto="flat", mark="concave", value="concave")
    r = stage(vertebrae(1.5, 1.5, 1.5, ("rh", "rh")), marks={"C3shape": "square"})
    assert r["stage"] == "CS5"
    r = stage(p, marks={"C2": "wobbly", "C9": "concave", "C3shape": "round"})      # nonsense is ignored
    assert r["stage"] == "CS1" and not r["overridden"]


def test_missing_c4_and_c2():
    p = vertebrae(1.5, 1.5, 0)
    for k in ("C4up", "C4ua", "C4lp", "C4d", "C4la"):
        del p[k]
    r = stage(p)
    assert r["stage"] == "CS3" and any("C4 not traced" in n for n in r["notes"])
    p = vertebrae()
    del p["C2d"]
    r = stage(p)
    assert r["stage"] is None and r["methods"]["hassel_farman"] is None


def test_inconsistent_tracing_is_flagged():
    r = stage(vertebrae(0, 1.5, 0))
    assert r["stage"] == "CS1" and any("unusual" in n for n in r["notes"])


def test_borderline_flag_near_threshold():
    # 0.9 mm on a 15 mm border = 6.0 % = the default threshold
    assert stage(vertebrae(0.9, 0, 0))["borderline"]


def _ex(p, j):
    return features(p), j


def test_fit_thresholds_learns_a_stricter_eye():
    """A doctor who only calls a border concave from ~1.3 mm (8.7 %): the defaults (6 %) disagree on the
    0.95-1.25 mm borders; tuned thresholds should agree with him more often, judged leave-one-out."""
    rng = np.random.default_rng(3)
    ex = []
    for i in range(24):
        d2 = float(rng.uniform(0.3, 2.2))
        p = vertebrae(d2, 0, 0, ("trap", "trap"))
        j = judge(features(p), DEFAULT_THRESHOLDS)
        j["C2"] = "concave" if d2 >= 1.3 else "flat"
        ex.append(_ex(p, j))
    res = fit_thresholds(ex)
    assert res["n"] == 24 and res["accepted"], res["message"]
    assert 7.0 < res["thresholds"]["concavity_pct"] <= 9.0          # his line is at 8.7 %
    assert res["loo_agree"] > res["default_agree"]


def test_fit_thresholds_keeps_the_defaults_when_he_agrees():
    ex = []
    for d in np.linspace(0.2, 2.0, 10):
        p = vertebrae(float(d), 0, 0)
        ex.append(_ex(p, judge(features(p), DEFAULT_THRESHOLDS)))
    res = fit_thresholds(ex)
    assert not res["accepted"] and res["thresholds"] == DEFAULT_THRESHOLDS


def test_fit_thresholds_needs_enough_cases():
    p = vertebrae()
    res = fit_thresholds([_ex(p, judge(features(p), DEFAULT_THRESHOLDS))] * 3)
    assert not res["accepted"] and "Needs 8" in res["message"]


def test_vertebra_points_that_make_no_vertebra_are_flagged_not_measured():
    import numpy as np
    from xray.cvm import stage
    from xray.landmarks import TEMPLATE
    p = {k: np.array(v, float) for k, v in TEMPLATE.items()}
    good = stage(p, 0.1, age=10.9, sex="F")
    assert good["methods"]["mito"] and 4 < good["methods"]["mito"]["bone_age"] < 25
    p["C4la"] = np.array([-31.0, -86.0])           # the front-lower corner of C4 put up and behind (as seen at the office)
    bad = stage(p, 0.1, age=10.9, sex="F")
    assert bad["methods"]["mito"] is None                                  # no "-94 years" bone age
    note = bad["notes"][0]
    assert note.startswith("Check the vertebra points") and "C4ua is not above the lower border" in note
    assert bad["judgements"]["C4shape"]["auto"] is None
