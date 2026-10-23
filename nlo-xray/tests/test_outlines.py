"""Outlines: curves through dots - the anatomy carried onto the doctor's points, the soft-tissue profile followed on
the x-ray, dots moved by hand kept."""
import numpy as np
import pytest

from synth import render
from xray import geometry as g
from xray import outlines as O
from xray.landmarks import TEMPLATE

MM = 0.24


def _seg_dist(q, a, b):
    a, b, q = (np.asarray(x, float) for x in (a, b, q))
    ab = b - a
    t = np.clip(((q - a) @ ab) / (ab @ ab), 0, 1)
    return float(np.hypot(*(a + t * ab - q)))


def test_the_curve_passes_through_its_dots():
    dots = [(0, 0), (10, 4), (20, 0), (30, 6), (30, 6), (40, 0)]          # a repeated dot (lips together) is fine
    c = O.spline(dots)
    for d in dots:
        assert min(np.hypot(*(c - d).T)) < 1e-6
    closed = O.spline(dots[:4], closed=True)
    assert np.allclose(closed[0], closed[-1]) and np.all(np.isfinite(closed))


def test_thin_plate_spline_is_exact_at_its_points():
    src = [(0, 0), (10, 0), (0, 10), (12, 13), (5, 4)]
    dst = [(1, 2), (14, 1), (2, 15), (18, 20), (6, 7)]
    f = O.tps(src, dst)
    assert np.allclose(f(src), dst, atol=1e-6)


@pytest.mark.parametrize("facing", ["right", "left"])
def test_anatomy_follows_the_points(facing):
    rng = np.random.default_rng(3)
    a, pts, f, _ = render(rng)
    while f != facing:
        a, pts, f, _ = render(rng)
    res = {o["key"]: o for o in O.outlines(None, pts, f, MM)}
    assert set(res) >= {"mandible", "symphysis", "maxilla", "u1", "l1", "u6", "l6", "sella", "nasion", "orbit", "ptm", "ear"}
    # the landmarks an outline names are its dots - it passes through the doctor's points, and follows them
    for key, codes in (("mandible", ("Ar", "Go", "MPt", "Me", "Gn", "Pog", "B")), ("maxilla", ("A", "ANS", "PNS")),
                       ("u1", ("U1A", "U1T")), ("l1", ("L1A", "L1T")), ("nasion", ("N",)), ("orbit", ("Or",)), ("ear", ("Po",))):
        o = res[key]
        assert all(c in o["ctrl"] for c in codes), key
        for c in codes:
            assert o["xy"][o["ctrl"].index(c)] == pytest.approx([round(pts[c][0], 1), round(pts[c][1], 1)], abs=0.06)
        assert not o["adjusted"]
    # a tooth is carried along its own axis at its length: the textbook incisor's 7 mm crown width at the doctor's scale
    u1 = np.array(res["u1"]["xy"], float)
    L = g.dist(pts["U1A"], pts["U1T"])
    ax = (np.array(pts["U1T"]) - pts["U1A"]) / L
    across = (u1 - pts["U1A"]) @ np.array([-ax[1], ax[0]])
    assert (across.max() - across.min()) == pytest.approx(7.05 * L / 24.5, rel=0.02)
    # the molars sit on the occlusal plane at real size: about 11 mm across the lower crown
    l6 = np.array(res["l6"]["xy"], float)
    assert 9 < g.dist(l6.min(0), l6.max(0)) * MM < 30
    # every dot is a number, and the outlines are closed where they should be
    for o in res.values():
        assert all(np.isfinite(v).all() for v in np.array(o["xy"], float))
    assert res["u1"]["closed"] and res["ptm"]["closed"] and not res["mandible"]["closed"]


def test_the_profile_follows_the_skin_on_the_xray():
    for seed in (0, 4):
        img, pts, facing, _ = render(np.random.default_rng(seed))
        prof = next(o for o in O.outlines(img, pts, facing, MM) if o["key"] == "profile")
        assert prof["traced"] == 1.0 and prof["ctrl"][0] == "Tr" and prof["ctrl"][-1] == "Mes"
        free = [c for c in prof["ctrl"] if not isinstance(c, str)]
        assert 1 <= len(free) <= 16                       # a few dots to drag, not hundreds
        # the skin synth drew: down the forehead (through G') to soft-tissue nasion, then through the soft-tissue points
        sx = 1 if facing == "right" else -1
        nv = (pts["N"][0] + sx * 8 / MM, pts["N"][1] - 2 / MM)
        skin = [pts["Tr"], nv, pts["Prn"], pts["Sn"], pts["Ls"], pts["Li"], pts["Pos"], pts["Mes"]]
        curve = O.spline(prof["xy"])
        off = [min(_seg_dist(q, skin[i], skin[i + 1]) for i in range(len(skin) - 1)) * MM for q in curve]
        assert np.median(off) < 0.5 and max(off) < 1.6, (seed, np.median(off), max(off))


def test_no_clear_edge_gives_a_curve_through_the_points():
    img, pts, facing, _ = render(np.random.default_rng(1))
    flat = np.full_like(img, 90)
    prof = next(o for o in O.outlines(flat, pts, facing, MM) if o["key"] == "profile")
    assert prof["traced"] < 0.2
    assert [c for c in prof["ctrl"] if isinstance(c, str)] == ["Tr", "Gs", "Prn", "Sn", "Ls", "Stms", "Stmi", "Li", "Pos", "Mes"]


def test_dots_moved_by_hand_are_kept_and_landmarks_still_follow():
    img, pts, facing, _ = render(np.random.default_rng(2))
    auto = {o["key"]: o for o in O.outlines(img, pts, facing, MM)}
    mine = list(auto["mandible"]["ctrl"])
    i = next(k for k, c in enumerate(mine) if not isinstance(c, str))
    mine[i] = [mine[i][0] + 15.0, mine[i][1] - 5.0]
    moved = dict(pts, Me=(pts["Me"][0] + 20, pts["Me"][1] + 10))          # and menton moved after
    res = {o["key"]: o for o in O.outlines(img, moved, facing, MM, saved={"mandible": mine})}
    m = res["mandible"]
    assert m["adjusted"] and m["ctrl"][i] == mine[i]
    assert m["xy"][m["ctrl"].index("Me")] == pytest.approx([round(moved["Me"][0], 1), round(moved["Me"][1], 1)], abs=0.06)
    assert not res["maxilla"]["adjusted"]


def test_template_landmarks_have_drawing_positions():
    for key, name, group, how, uses, shape, closed in O.STRUCTURES:
        if how == "spline":
            assert all(c in O.DRAW for c in uses), key
            assert all(c in O.DRAW for c in shape if isinstance(c, str)), key
    assert all(c in TEMPLATE for c in O.PROFILE)
