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


def _stepped(rows, w=400, h=600):
    """An x-ray whose brightness steps down its rows: [(from row, value), ...] - a bone's edge, or two."""
    a = np.zeros((h, w), np.uint8)
    for y0, v in rows:
        a[y0:, :] = v
    return a


@pytest.mark.parametrize("rows, expect", [
    ([(0, 40), (300, 200)], 300),                     # one edge: onto it
    ([(0, 40), (300, 120), (330, 200)], 315),         # the bone seen twice, 3 mm apart: midway between the lines
    ([(0, 40), (300, 180), (330, 200)], 300),         # a faint second line is not the bone seen twice
])
@pytest.mark.parametrize("sx", [1.0, -1.0])
def test_a_bone_outline_is_pulled_onto_its_edge(rows, expect, sx):
    img = _stepped(rows)
    # an outline 1 mm above the (first) edge (0.1 mm pixels), running forward with the bone below it (on its right)
    xy = [np.array([sx * x, -290.0]) for x in (50, 120, 190, 260, 330)]
    if sx < 0:
        xy = xy[::-1]                                     # forward is to the left on an x-ray facing left
        xy = [np.array([p[0], p[1]]) for p in xy]
    moved, found = O.snap(img, xy, [0, 2.5, 2.5, 2.5, 0], "edge", -1, sx, 0.1, double=True)
    assert [round(-p[1], 1) for p in (moved[0], moved[-1])] == [290.0, 290.0]      # range 0: stays
    assert all(abs(-p[1] - expect) <= 2.0 for p in moved[1:-1]), [round(-p[1], 1) for p in moved]
    assert found > 0.6
    # on the wrong side (polarity): no edge, the outline stays near its course
    moved, found = O.snap(img, xy, [2.5] * 5, "edge", 1, sx, 0.1)
    assert all(abs(-p[1] - 290) < 6 for p in moved) and found < 0.2


def test_teeth_are_moved_turned_and_sized_whole():
    _, pts, facing, _ = render(np.random.default_rng(5))
    res = {o["key"]: o for o in O.outlines(None, pts, facing, MM)}
    assert res["u1"]["unit"] == "points" and res["u1"]["handles"] == ["U1A", "U1T"]
    assert res["l1"]["unit"] == "points" and res["l1"]["handles"] == ["L1A", "L1T"]
    u6 = res["u6"]
    assert u6["unit"] == "handles" and len(u6["handles"]) == 2 and not u6["adjusted"]
    assert "unit" not in res["mandible"]
    # the doctor's handles: the same molar, moved, turned 15 degrees and 20 % bigger - every distance scaled alike
    c, r = np.array(u6["handles"], float)
    t = np.radians(15)
    turn = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    mine = [list(c + [12, -5]), list(c + [12, -5] + 1.2 * turn @ (r - c))]
    m = {o["key"]: o for o in O.outlines(None, pts, facing, MM, saved={"u6": mine})}["u6"]
    assert m["adjusted"] and np.allclose(m["handles"], mine, atol=0.06)
    a, b = np.array(u6["xy"], float), np.array(m["xy"], float)
    da = np.hypot(*(a[:, None] - a[None]).transpose(2, 0, 1))
    db = np.hypot(*(b[:, None] - b[None]).transpose(2, 0, 1))
    assert np.allclose(db, 1.2 * da, atol=0.4)
    # a molar's dots saved one by one (1.7) - or an incisor's - are not kept: the tooth is drawn whole again
    old = {o["key"]: o for o in O.outlines(None, pts, facing, MM, saved={"u6": u6["xy"], "u1": [[1, 2], [3, 4], [5, 6]]})}
    assert not old["u6"]["adjusted"] and old["u6"]["xy"] == u6["xy"] and old["u1"]["xy"] == res["u1"]["xy"]


def test_a_wrong_pixel_size_does_not_blow_the_outlines_up():
    """A calibration that makes S-N 34 mm (half the pixel size) would draw the molars and the cranial outlines twice
    their size: they are drawn at the size S-N gives instead."""
    img, pts, facing, _ = render(np.random.default_rng(7))
    right = {o["key"]: o for o in O.outlines(img, pts, facing, MM)}
    wrong = {o["key"]: o for o in O.outlines(img, pts, facing, MM / 2)}
    for key in ("l6", "u6", "orbit", "sella", "ptm"):
        a, b = np.array(right[key]["xy"], float), np.array(wrong[key]["xy"], float)
        assert _size(b) == pytest.approx(_size(a), rel=0.08), key


def _size(xy):
    return float(np.hypot(*(xy.max(0) - xy.min(0))))


def test_cranial_outlines_turn_with_frankfort():
    _, pts, facing, _ = render(np.random.default_rng(6))
    base = {o["key"]: o for o in O.outlines(None, pts, facing, MM)}
    # porion turned 10 degrees about orbitale: Frankfort turns, S-N does not
    t = np.radians(10)
    po, orb = np.array(pts["Po"], float), np.array(pts["Or"], float)
    turn = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    moved = dict(pts, Po=tuple(orb + turn @ (po - orb)))
    res = {o["key"]: o for o in O.outlines(None, moved, facing, MM)}
    a = np.array(base["orbit"]["xy"], float) - orb
    b = np.array(res["orbit"]["xy"], float) - orb
    assert np.allclose(b, a @ turn.T, atol=0.2)              # the orbit turned with FH, round orbitale
    assert res["sella"]["xy"] == base["sella"]["xy"]           # sella goes with S-N


def test_template_landmarks_have_drawing_positions():
    for key, name, group, how, uses, shape, closed, snap in O.STRUCTURES:
        if how == "spline":
            assert all(c in O.DRAW for c in uses), key
            assert all(c in O.DRAW for c in shape if isinstance(c, str)), key
        if snap:
            assert snap[0] in ("edge", "onset") and snap[1] in (1, -1) and 0 < snap[2] <= 3, key
    assert all(c in TEMPLATE for c in O.PROFILE)
