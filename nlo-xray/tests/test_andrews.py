"""Andrews' Six Elements read for surgery: the geometry on made-up points, and the card's switch through the app."""
import numpy as np
import pytest

from test_server import _traced_case, client  # noqa: F401
from xray import analysis as an

# canonical frame: the face looks to +X, up is +Y; 1 pixel = 1 mm
BASE = {
    "S": (0, 0), "N": (70, 0),
    "Tr": (78, 60), "Gs": (78, 10),                    # an upright forehead: GALL is the vertical x = 78
    "U1A": (70, -52), "U1T": (76, -75.7),              # upper incisor, about 104° to SN
    "L1A": (66, -95), "L1T": (73.5, -75),
    "MOL": (45, -72),
    "Stms": (82, -70), "Sn": (84, -45), "Mes": (70, -112),
    "Me": (62, -110), "MPt": (20, -98), "Go": (5, -85), "Pog": (68, -104), "Po": (-20, -22), "Or": (55, -25),
}


def six(pts, incisors="traced", **kw):
    p = {k: np.array(v, float) for k, v in pts.items()}
    g = an.andrews_gall(p, 1.0)
    return an.andrews_six(p, 1.0, g, incisors=incisors, **kw), g


def test_element_ii_follows_the_fa_point_and_the_overjet():
    A, g = six(BASE)
    assert g["x_gall"] == pytest.approx(78.0)
    assert A["e2_mx"] == pytest.approx(float(A["fa_u"][0]) - 78.0) == pytest.approx(g["dist"])
    # the whole maxilla 5 mm forward: 5 mm more ahead of GALL; the mandible's goal moves with it only through the overjet
    fwd = dict(BASE, U1A=(75, -52), U1T=(81, -75.7))
    B, _ = six(fwd)
    assert B["e2_mx"] - A["e2_mx"] == pytest.approx(5.0)
    assert B["overjet"] - A["overjet"] == pytest.approx(5.0)
    assert B["e2_md"] == pytest.approx(A["e2_md"])               # the lower incisors did not move
    # the mandible 4 mm back: 4 mm further behind its goal
    back = dict(BASE, L1A=(62, -95), L1T=(69.5, -75), Pog=(64, -104))
    C, _ = six(back)
    assert C["e2_md"] - A["e2_md"] == pytest.approx(-4.0) and C["e2_mx"] == pytest.approx(A["e2_mx"])
    # coupled incisors on GALL: both jaws on the goal
    ideal = A["overjet"] - 2.5
    D, _ = six(dict(BASE, U1A=(70 - A["e2_mx"], -52), U1T=(76 - A["e2_mx"], -75.7),
                    L1A=(66 - A["e2_mx"] + ideal, -95), L1T=(73.5 - A["e2_mx"] + ideal, -75)))
    assert D["e2_mx"] == pytest.approx(0, abs=1e-6) and D["e2_md"] == pytest.approx(0, abs=1e-6)


def test_element_iv_and_v():
    A, _ = six(BASE)
    # the FA point against the lip line: + = below it
    assert A["e4_mx"] == pytest.approx(-70 - float(A["fa_u"][1]))
    lower_lip = dict(BASE, Stms=(82, -64))
    assert six(lower_lip)[0]["e4_mx"] - A["e4_mx"] == pytest.approx(6.0)
    # the occlusal plane: molar (45, -72) to the incisor overlap (74.75, -75.35), lower in front
    assert A["op"] == pytest.approx(np.degrees(np.arctan2(3.35, 29.75)), abs=1e-6)
    # Will's plane is square to the occlusal plane through the lower FA point: pogonion moved along the occlusal
    # plane changes Element V by that much, moved along Will's plane not at all
    d = A["d"]
    n = np.array([-d[1], d[0]])
    pog = np.array(BASE["Pog"], float)
    assert six(dict(BASE, Pog=tuple(pog + 3 * d)))[0]["e5"] - A["e5"] == pytest.approx(3.0)
    assert six(dict(BASE, Pog=tuple(pog + 7 * n)))[0]["e5"] == pytest.approx(A["e5"])
    assert A["heights"] == dict(middle=pytest.approx(55.0), lower=pytest.approx(67.0), posterior=pytest.approx(63.0))


def test_incisors_set_upright_reach_the_norms_about_the_root():
    flared = dict(BASE, U1T=(86, -72), L1T=(60, -76))        # upper proclined, lower retroclined
    p = {k: np.array(v, float) for k, v in flared.items()}
    T, _ = six(flared, "traced")
    E, _ = six(flared, "e1")
    assert T["turned"] == {} and set(E["turned"]) == {"upper", "lower"}
    q = E["q"]
    assert an._compute("U1_SN", q, None) == pytest.approx(103.0, abs=0.05)
    assert an._compute("IMPA", q, None) == pytest.approx(90.0, abs=0.05)
    assert E["turned"]["upper"]["way"] == "back" and E["turned"]["lower"]["way"] == "forward"
    for a, t in (("U1A", "U1T"), ("L1A", "L1T")):            # same length, same centre of resistance
        assert np.linalg.norm(q[t] - q[a]) == pytest.approx(np.linalg.norm(p[t] - p[a]))
        assert q[a] + 0.35 * (q[t] - q[a]) == pytest.approx(p[a] + 0.35 * (p[t] - p[a]))
    assert E["e2_mx"] < T["e2_mx"]                           # the upright upper incisor is less far ahead


def test_shorthand_and_report():
    A, _ = six(BASE)
    R = an.andrews_report(dict(A, e2_mx=-4.2, e2_md=-8.6, e5=1.0, e4_mx=3.4))
    by = {r["key"]: r for r in R["rows"]}
    assert by["e2_mx"]["code"] == "B4" and by["e2_mx"]["to_goal"] == "forward 4.2 mm"
    assert by["e2_md"]["code"] == "B9" and by["e5"]["code"] == "G" and by["e5"]["to_goal"] == ""
    assert by["e4_mx"]["code"] == "L3" and by["e4_mx"]["to_goal"] == "up 3.4 mm"
    assert R["shorthand"].startswith("Maxilla B4 · Mandible B9 · Chin G")


def test_the_card_through_the_app(client):
    cid, _ = _traced_case(client)
    r = client.get(f"/api/cases/{cid}").json()
    A = r["analysis"]["andrews"]
    assert A["incisors"] == "e1" and {x["key"] for x in A["rows"]} == {"e2_mx", "e2_md", "e5", "e4_mx", "op"}
    assert set(A["draw"]) >= {"fa_u", "fa_l", "wills", "lip"}
    by = {m["key"]: m for m in r["analysis"]["measurements"]}
    rows = {x["key"]: x for x in A["rows"]}
    assert by["A_E2_Mx"]["value"] == rows["e2_mx"]["value"] and by["A_E5"]["value"] == rows["e5"]["value"]
    assert by["A_E2_Mx"]["group"] == "Andrews - Six Elements"
    # as traced: the maxilla's distance is the upper incisor's to GALL; kept with the x-ray
    r = client.patch(f"/api/cases/{cid}", json={"andrews": {"incisors": "traced"}}).json()
    by = {m["key"]: m for m in r["analysis"]["measurements"]}
    assert r["case"]["andrews"] == {"incisors": "traced"} and r["analysis"]["andrews"]["turned"] == {}
    assert by["A_E2_Mx"]["value"] == pytest.approx(by["U1_GALL"]["value"], abs=0.05)
    assert client.patch(f"/api/cases/{cid}", json={"andrews": {"incisors": "bogus"}}).json()["case"]["andrews"] == {"incisors": "traced"}
    # no pixel size: no card, the rows say why
    r = client.patch(f"/api/cases/{cid}", json={"calibration": {"mm_per_px": None}})
    if r.status_code == 200:
        assert r.json()["analysis"]["andrews"] is None
