"""CVM staging rules on constructed vertebrae (canonical frame: X anterior, Y up, mm)."""
import numpy as np

from xray.cvm import DEFAULT_THRESHOLDS, fit_thresholds, stage


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


def test_stages():
    assert stage(vertebrae(0, 0, 0, ("trap", "trap")))["stage"] == "CS1"
    assert stage(vertebrae(1.5, 0, 0, ("trap", "trap")))["stage"] == "CS2"
    assert stage(vertebrae(1.5, 1.5, 0, ("trap", "rh")))["stage"] == "CS3"
    assert stage(vertebrae(1.5, 1.5, 1.5, ("rh", "rh")))["stage"] == "CS4"
    assert stage(vertebrae(1.5, 1.5, 1.5, ("sq", "rh")))["stage"] == "CS5"
    assert stage(vertebrae(1.5, 1.5, 1.5, ("rv", "sq")))["stage"] == "CS6"


def test_features_are_reported_and_explained():
    r = stage(vertebrae(1.5, 1.5, 0, ("rh", "rh")), mm=1.0)
    f = {x["level"]: x for x in r["features"]}
    assert f["C2"]["concave"] and f["C3"]["concave"] and not f["C4"]["concave"]
    assert f["C2"]["concavity_mm"] == 1.5
    assert f["C3"]["shape"] == "rectangular horizontal"
    assert "coming year" in r["timing"]


def test_missing_c4_and_c2():
    p = vertebrae(1.5, 1.5, 0)
    for k in ("C4up", "C4ua", "C4lp", "C4d", "C4la"):
        del p[k]
    r = stage(p)
    assert r["stage"] == "CS3" and any("C4 not traced" in n for n in r["notes"])
    p = vertebrae()
    del p["C2d"]
    assert stage(p)["stage"] is None


def test_inconsistent_tracing_is_flagged():
    r = stage(vertebrae(0, 1.5, 0))
    assert r["stage"] == "CS1" and any("unusual" in n for n in r["notes"])


def test_borderline_flag_near_threshold():
    # 0.9 mm on a 15 mm border = 6.0 % = the default threshold
    r = stage(vertebrae(0.9, 0, 0))
    assert r["borderline"]


def test_fit_thresholds_learns_a_stricter_eye():
    """A doctor who only calls a border concave from ~1.3 mm (8.7 %) - the defaults (6 %) disagree on the
    0.95-1.2 mm cases; tuning should agree with him more often, judged leave-one-out."""
    ex = []
    rng = np.random.default_rng(3)
    for i in range(24):
        d2 = float(rng.uniform(0.3, 2.2))
        call = "CS2" if d2 >= 1.3 else "CS1"
        ex.append((vertebrae(d2, 0, 0, ("trap", "trap")), None, call))
    res = fit_thresholds(ex)
    assert res["n"] == 24
    assert res["accepted"], res["message"]
    assert res["thresholds"]["concavity_pct"] > DEFAULT_THRESHOLDS["concavity_pct"]
    assert res["loo_agree"] > res["default_agree"]


def test_fit_thresholds_needs_enough_calls():
    res = fit_thresholds([(vertebrae(), None, "CS1")] * 3)
    assert not res["accepted"] and "Needs 8" in res["message"]
