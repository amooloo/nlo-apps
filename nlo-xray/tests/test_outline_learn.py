"""Outlines learn from the doctor: the dots he moved on confirmed x-rays become the shapes the next x-rays start from."""
import numpy as np
import pytest

from synth import render
from xray import geometry as g
from xray import outline_learn as OL
from xray import outlines as O

MM = 0.24
BONES = ("mandible", "symphysis", "maxilla", "sella", "nasion", "orbit", "ptm", "ear")


def _cases(seeds, change=None, img=False):
    """Synthetic confirmed x-rays whose outlines the 'doctor' saved - as drawn, or changed by change(key, outline,
    sx) -> dots."""
    out = []
    for seed in seeds:
        a, pts, facing, _ = render(np.random.default_rng(seed))
        auto = {o["key"]: o for o in O.outlines(a if img else None, pts, facing, MM)}
        sx = 1 if facing == "right" else -1
        con = {}
        for key, o in auto.items():
            dots = change(key, o, sx) if change else None
            if dots is not None:
                con[key] = dots
        out.append(dict(points=pts, facing=facing, mm_per_px=MM, contours=con))
    return out


def _moved(a, b, key, i):
    return (np.array(b[key]["xy"][i], float) - np.array(a[key]["xy"][i], float)) * MM


def test_outlines_saved_as_drawn_teach_the_textbook_back():
    learned = OL.learn(_cases(range(10, 15), lambda key, o, sx: o["ctrl"] if key in BONES else None))
    assert learned["cases"] == 5 and set(learned["shapes"]) == set(BONES)
    for key, name, group, how, uses, shape, closed, snap in O.STRUCTURES:
        if key not in BONES:
            continue
        L = learned["shapes"][key]
        assert L["n"] == 5 and L["sig"] == O.signature(shape)
        for i, e in enumerate(shape):
            if not isinstance(e, str):
                assert np.hypot(*(np.array(L["dots"][str(i)]) - O._xy(e))) < 0.05, (key, i)


def test_a_dot_he_moves_moves_on_the_next_xrays_a_step_at_a_time():
    def coronoid_forward(key, o, sx):
        if key != "mandible":
            return None
        m = [c if isinstance(c, str) else list(c) for c in o["ctrl"]]
        m[2] = [m[2][0] + sx * 3.0 / MM, m[2][1]]                 # the coronoid tip 3 mm forward
        return m
    _, pts, facing, _ = render(np.random.default_rng(99))
    sx = 1 if facing == "right" else -1
    before = {o["key"]: o for o in O.outlines(None, pts, facing, MM)}
    for n in (1, 5):
        learned = OL.learn(_cases(range(10, 10 + n), coronoid_forward))
        after = {o["key"]: o for o in O.outlines(None, pts, facing, MM, learned=learned)}
        d = _moved(before, after, "mandible", 2)
        assert d[0] * sx == pytest.approx(3.0 * n / (n + 2), abs=0.25) and abs(d[1]) < 0.4, n
        for i in (0, 5, 9, 13):                                    # the rest stays
            assert np.hypot(*_moved(before, after, "mandible", i)) < 0.1
    assert after["mandible"]["ctrl"][11] == "Go" and not after["mandible"]["adjusted"]


def test_molars_start_where_he_puts_them():
    def molar_back(key, o, sx):
        return [[h[0] - sx * 2.0 / MM, h[1]] for h in o["handles"]] if key == "u6" else None
    learned = OL.learn(_cases(range(10, 16), molar_back))
    assert learned["molars"]["u6"]["n"] == 6 and "l6" not in learned["molars"]
    _, pts, facing, _ = render(np.random.default_rng(98))
    before = {o["key"]: o for o in O.outlines(None, pts, facing, MM)}
    after = {o["key"]: o for o in O.outlines(None, pts, facing, MM, learned=learned)}
    occl = g.unit(np.array(pts["U1T"], float) - pts["MOL"])
    shift = (np.array(after["u6"]["handles"][0]) - before["u6"]["handles"][0]) @ occl * MM
    assert shift == pytest.approx(-2.0 * 6 / 8, abs=0.3)
    assert not after["u6"]["adjusted"] and after["l6"]["xy"] == before["l6"]["xy"]


def test_what_is_left_out():
    """Outlines saved with another version's dots, and the real-size ones on an x-ray with an impossible pixel size."""
    def older(key, o, sx):
        if key == "mandible":                                      # one dot fewer: another version's outline
            return [c for i, c in enumerate(o["ctrl"]) if i != 3]
        return o["ctrl"] if key in ("sella", "maxilla") else None
    cases = _cases(range(10, 13), older)
    learned = OL.learn(cases)
    assert "mandible" not in learned["shapes"] and {"sella", "maxilla"} <= set(learned["shapes"])
    for c in cases:
        c["mm_per_px"] = MM / 2                                    # S-N 34 mm: no real size to learn from
    learned = OL.learn(cases)
    assert "maxilla" in learned["shapes"] and "sella" not in learned["shapes"]
    # nonsense saved: nothing learned, nothing broken
    bad = [dict(points=cases[0]["points"], facing="right", mm_per_px=MM,
                contours={"mandible": ["Go", "x", [1]], "u6": [[1, 2]], "profile": [["a", "b"]], "sella": 7})]
    assert OL.learn(bad)["cases"] == 0 and OL.learn([])["shapes"] == {}


def test_the_profile_takes_his_course():
    def nose(key, o, sx):
        if key != O.PROFILE_KEY:
            return None
        c = o["ctrl"]
        i0, i1 = c.index("Gs"), c.index("Prn")
        mid = (np.array(o["xy"][i0], float) + o["xy"][i1]) / 2 + [sx * 2.0 / MM, 0]   # 2 mm in front of the line
        return c[:i0 + 1] + [list(mid)] + c[i1:]
    learned = OL.learn(_cases(range(20, 24), nose, img=True))
    assert learned["profile"]["Gs>Prn"]["n"] == 4 and OL.summary(learned)[O.PROFILE_KEY] == 4
    a, pts, facing, _ = render(np.random.default_rng(77))
    flat = np.full_like(a, 90)                                     # no edge to follow: his course
    prof = {o["key"]: o for o in O.outlines(flat, pts, facing, MM, learned=learned)}[O.PROFILE_KEY]
    c = O.spline(prof["xy"], False, 20)
    p0, p1 = np.array(pts["Gs"], float), np.array(pts["Prn"], float)
    d = (p1 - p0) / g.dist(p0, p1)
    t = (c - p0) @ d
    mid = c[(t > 0.4 * g.dist(p0, p1)) & (t < 0.6 * g.dist(p0, p1))]
    off = np.abs((mid - p0) @ np.array([-d[1], d[0]])).max() * MM
    assert off == pytest.approx(2.0, abs=0.35)
    # on the x-ray itself the skin still leads: the profile follows it, his course only breaks ties between edges
    prof = {o["key"]: o for o in O.outlines(a, pts, facing, MM, learned=learned)}[O.PROFILE_KEY]
    assert prof["traced"] == 1.0
