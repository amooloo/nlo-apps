"""The web app end to end: import, details, anchors, editing, confirm, settings, passcode, privacy headers."""
import importlib
import io
import os
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from xray.landmarks import CODES, codes_in_group


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NLO_XRAY_DATA", str(tmp_path))
    monkeypatch.setenv("NLO_XRAY_NO_NIGHTLY", "1")
    sys.modules.pop("app.server", None)
    srv = importlib.import_module("app.server")
    with TestClient(srv.app) as c:
        c.srv = srv
        yield c
    sys.modules.pop("app.server", None)


def png_bytes(seed=0, w=900, h=1100):
    from synth import render
    a, pts, facing, _ = render(np.random.default_rng(seed), w, h)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, format="PNG")
    return buf.getvalue(), pts, facing


def test_privacy_headers_and_no_outside_references(client):
    r = client.get("/")
    assert r.status_code == 200
    csp = r.headers["content-security-policy"]
    assert "default-src 'self'" in csp and "connect-src 'self'" in csp and "script-src 'self'" in csp
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "static")
    for name in ("index.html", "app.js", "style.css"):
        text = open(os.path.join(root, name), encoding="utf-8").read()
        for bad in ("googleapis", "gstatic", "cdn.", "unpkg", "jsdelivr", "<script src=\"http", "@import url(http"):
            assert bad not in text, (name, bad)
        # the only absolute URL anywhere is the plain link back to the NLO apps home page
        import re
        urls = set(re.findall(r"https?://[^\s\"')]+", text))
        assert urls <= {"https://amooloo.github.io/nlo-apps/"}, (name, urls)


def test_updates_reach_open_pages(client):
    """After an update the page asks for its script and styles under new names, and open pages can tell."""
    from xray import __version__
    build = client.srv.BUILD
    page = client.get("/")
    assert page.headers["cache-control"] == "no-cache"
    html = page.text
    assert f'/static/app.js?v={build}"' in html and f'/static/style.css?v={build}"' in html
    assert f'<meta name="build" content="{build}">' in html
    js = client.get(f"/static/app.js?v={build}")
    assert js.status_code == 200 and js.headers["cache-control"] == "no-cache"
    hello = client.get("/api/hello").json()
    assert hello["version"] == __version__ and hello["build"] == build
    assert client.get("/api/status").json()["build"] == build


def test_full_flow(client):
    data, pts, facing = png_bytes()
    r = client.post("/api/cases", files=[("files", ("Jane_Doe_ceph_2026-10-15.png", data, "image/png"))])
    assert r.status_code == 200
    res = r.json()[0]
    assert not res["duplicate"]
    cid = res["id"]
    case = res["case"]
    assert case["patient"]["name"] == "Jane Doe" and case["taken"] == "2026-10-15"
    assert case["calibration"]["mm_per_px"] is None
    # the same file again is recognised
    again = client.post("/api/cases", files=[("files", ("copy.png", data, "image/png"))]).json()[0]
    assert again["duplicate"] and again["id"] == cid
    # details
    r = client.patch(f"/api/cases/{cid}", json={"patient": {"name": "Doe, Jane", "dob": "2013-01-02", "sex": "F"},
                                                 "details_confirmed": True})
    assert r.json()["analysis"]["age"] == pytest.approx(13.8, abs=0.1)
    # images are served, never cached
    img = client.get(f"/api/cases/{cid}/image")
    assert img.status_code == 200 and img.headers["cache-control"] == "no-store"
    assert client.get(f"/api/cases/{cid}/thumb").status_code == 200
    # no network yet
    assert client.post(f"/api/cases/{cid}/auto").status_code == 409
    # anchors -> every point
    r = client.post(f"/api/cases/{cid}/anchors", json={c: pts[c] for c in ("S", "N", "Me")})
    body = r.json()
    lm = body["case"]["landmarks"]
    assert len(lm) == len(CODES) and lm["S"]["by"] == "doctor" and lm["A"]["by"] == "template"
    assert body["case"]["status"] == "traced"
    assert body["case"]["facing"] == facing
    # move the real points in (as the doctor would)
    r = client.patch(f"/api/cases/{cid}", json={"landmarks": {c: {"x": v[0], "y": v[1], "by": "doctor"} for c, v in pts.items()}})
    a = r.json()["analysis"]
    assert a["progress"]["reviewed"] == a["progress"]["total"] == len(CODES)
    by = {m["key"]: m for m in a["measurements"]}
    assert by["ANB"]["value"] is not None and by["Wits"]["note"] == "needs calibration"
    # calibrate (0.24 mm per pixel in the synthetic cephs)
    r = client.patch(f"/api/cases/{cid}", json={"calibration": {"mm_per_px": 0.24, "source": "ruler"}})
    by = {m["key"]: m for m in r.json()["analysis"]["measurements"]}
    assert by["Wits"]["value"] is not None
    assert client.patch(f"/api/cases/{cid}", json={"calibration": {"mm_per_px": 9}}).status_code == 400
    # skip soft tissue -> those points go, progress shrinks; switch back on -> filled in
    r = client.patch(f"/api/cases/{cid}", json={"skipped": ["soft"]}).json()
    assert "Prn" not in r["case"]["landmarks"] and r["analysis"]["progress"]["total"] == len(CODES) - len(codes_in_group("soft"))
    client.patch(f"/api/cases/{cid}", json={"skipped": []})
    r = client.post(f"/api/cases/{cid}/fill").json()
    assert r["case"]["landmarks"]["Prn"]["by"] == "template"
    # the CVM panel: three methods, and the doctor's picks win
    cv = r["analysis"]["cvm"]
    assert set(cv["methods"]) == {"baccetti", "hassel_farman", "mito"}
    assert cv["methods"]["mito"]["age"] == pytest.approx(13.8, abs=0.1) or cv["methods"]["mito"]["age"] is None
    r = client.patch(f"/api/cases/{cid}", json={"cvm_marks": {"C2": "flat", "C3": "flat", "C4": "flat"}}).json()
    assert r["analysis"]["cvm"]["stage"] == "CS1" and r["analysis"]["cvm"]["overridden"]
    assert r["case"]["cvm"]["marks"] == {"C2": "flat", "C3": "flat", "C4": "flat"}
    r = client.patch(f"/api/cases/{cid}", json={"cvm_marks": {"C3": None, "bogus": "x"}}).json()
    assert r["case"]["cvm"]["marks"] == {"C2": "flat", "C4": "flat"}
    # confirm: all points become the doctor's; the CVM judgements and stage as shown are recorded
    r = client.patch(f"/api/cases/{cid}", json={"status": "confirmed"}).json()
    assert r["case"]["status"] == "confirmed" and r["case"]["confirmed_at"]
    assert all(v["by"] == "doctor" for v in r["case"]["landmarks"].values())
    cvc = r["case"]["cvm"]
    assert cvc["doctor"] == r["analysis"]["cvm"]["stage"] == "CS1"
    assert cvc["confirmed"]["C2"] == "flat" and cvc["confirmed"]["C4"] == "flat" and "C3shape" in cvc["confirmed"]
    rows = client.get("/api/cases").json()
    assert rows[0]["status"] == "confirmed" and rows[0]["name"] == "Doe, Jane"
    assert client.get("/api/cases?q=doe").json() and not client.get("/api/cases?q=zzz").json()
    st = client.get("/api/status").json()
    assert st["confirmed"] == 1 and st["model"] is None
    # a pick changed after confirming updates the lesson; back to the app's reading clears the picks
    before = r["case"]["confirmed_at"]
    r = client.patch(f"/api/cases/{cid}", json={"cvm_marks": {"C2": "concave"}}).json()
    assert r["case"]["cvm"]["doctor"] == r["analysis"]["cvm"]["stage"] != "CS1"
    assert r["case"]["cvm"]["confirmed"]["C2"] == "concave"
    assert r["case"]["confirmed_at"] >= before
    r = client.patch(f"/api/cases/{cid}", json={"cvm_marks": None}).json()
    assert r["case"]["cvm"]["marks"] == {} and not r["analysis"]["cvm"]["overridden"]
    # a point moved on the confirmed tracing: still confirmed, a new lesson, and on record
    before = r["case"]["confirmed_at"]
    a = r["case"]["landmarks"]["A"]
    r = client.patch(f"/api/cases/{cid}", json={"landmarks": {"A": dict(x=a["x"] + 3, y=a["y"], by="doctor")}}).json()
    assert r["case"]["status"] == "confirmed" and r["case"]["confirmed_at"] >= before
    assert r["case"]["history"][-1]["what"].startswith("A corrected on the confirmed tracing")
    # the vertebra points go by Baccetti's (2002) names on screen and in the history; the saved codes stay
    labels = {lm["code"]: lm["label"] for lm in client.get("/api/defs").json()["landmarks"]}
    assert [labels[c] for c in ("C2lp", "C2d", "C2la", "C3d", "C4d", "C3up", "Go")] == \
        ["C2p", "C2m", "C2a", "C3m", "C4m", "C3up", "Go"]
    d = r["case"]["landmarks"]["C2d"]
    r = client.patch(f"/api/cases/{cid}", json={"landmarks": {"C2d": dict(x=d["x"], y=d["y"] - 2, by="doctor")}}).json()
    assert "C2d" in r["case"]["landmarks"] and r["case"]["history"][-1]["what"].startswith("C2m corrected")
    # reopening forgets the confirmed judgements (taken again at the next confirm), keeps nothing stale
    r = client.patch(f"/api/cases/{cid}", json={"status": "reopen"}).json()
    assert "confirmed" not in r["case"]["cvm"] and "doctor" not in r["case"]["cvm"]
    r = client.patch(f"/api/cases/{cid}", json={"status": "confirmed"}).json()
    assert r["case"]["cvm"]["doctor"] == r["analysis"]["cvm"]["stage"]
    # delete -> moved aside, not erased
    assert client.delete(f"/api/cases/{cid}").status_code == 200
    assert client.get(f"/api/cases/{cid}").status_code == 404
    assert os.path.isdir(os.path.join(os.environ["NLO_XRAY_DATA"], "cases", "_deleted", cid))


def test_confirm_needs_every_point(client):
    data, pts, _ = png_bytes(1)
    cid = client.post("/api/cases", files=[("files", ("a.png", data, "image/png"))]).json()[0]["id"]
    client.patch(f"/api/cases/{cid}", json={"landmarks": {"S": {"x": 1, "y": 2}}})
    r = client.patch(f"/api/cases/{cid}", json={"status": "confirmed"})
    assert r.status_code == 400 and "points still to place" in r.json()["detail"]


def test_bad_files_are_reported(client):
    r = client.post("/api/cases", files=[("files", ("notes.txt", b"not an x-ray" * 50, "text/plain"))]).json()
    assert r[0]["error"]


def test_settings_validation_and_effect(client):
    s = client.get("/api/settings").json()
    assert s["calibration"]["magnification"] == 1.13 and s["passcode"] is False
    r = client.put("/api/settings", json={"norms": {"SNA": {"mean": 84, "sd": 2.5}}, "cutoffs": {"anb_class2_above": 5}})
    assert r.json()["norms"]["SNA"]["mean"] == 84
    assert client.put("/api/settings", json={"calibration": {"magnification": 3}}).status_code == 400
    assert client.put("/api/settings", json={"learning": {"window_start": 25}}).status_code == 400


def test_passcode(client):
    assert client.post("/api/settings/passcode", json={"code": "12"}).status_code == 400
    r = client.post("/api/settings/passcode", json={"code": "nlo-2026"})
    assert r.status_code == 200
    # this browser stays signed in
    assert client.get("/api/cases").status_code == 200
    # a new browser is not
    other = TestClient(client.srv.app)
    assert other.get("/api/cases").status_code == 401
    assert other.get("/api/hello").json()["passcode"] is True
    assert other.get("/").status_code == 200                       # the page itself (no patient data) loads
    assert other.post("/api/login", json={"code": "wrong"}).status_code == 403
    assert other.post("/api/login", json={"code": "nlo-2026"}).status_code == 200
    assert other.get("/api/cases").status_code == 200
    client.post("/api/settings/passcode", json={"code": ""})
    assert TestClient(client.srv.app).get("/api/cases").status_code == 200


def test_examples_from_confirmed_tracings(client):
    """Where a point goes, shown on this office's confirmed x-rays: a close-up with the point at its centre."""
    import base64
    assert client.get("/api/examples/S").json() == {"examples": [], "total": 0}
    assert client.get("/api/examples/XX").status_code == 404
    data, pts, facing = png_bytes(seed=2)
    cid = client.post("/api/cases", files=[("files", ("a.png", data, "image/png"))]).json()[0]["id"]
    lm = {k: dict(x=float(v[0]), y=float(v[1]), by="doctor") for k, v in pts.items()}
    client.patch(f"/api/cases/{cid}", json={"landmarks": lm, "facing": facing,
                                           "calibration": {"mm_per_px": 0.24, "source": "set by hand"}})
    assert client.get("/api/examples/S").json()["total"] == 0                  # not confirmed yet
    client.patch(f"/api/cases/{cid}", json={"status": "confirmed"})
    r = client.get("/api/examples/S?exclude=other").json()
    assert r["total"] == 1 and len(r["examples"]) == 1
    ex = r["examples"][0]
    assert ex["img"].startswith("data:image/jpeg;base64,") and len(base64.b64decode(ex["img"].split(",", 1)[1])) > 1000
    assert ex["points"]["S"] == pytest.approx([ex["size"] / 2, ex["size"] / 2], abs=2)
    assert ex["facing"] == facing
    cv = client.get("/api/examples/C3d").json()["examples"][0]
    assert {c for c in cv["points"] if c[:2] in ("C2", "C3", "C4")} == {c for c in pts if c[:2] in ("C2", "C3", "C4")}
    assert client.get(f"/api/examples/S?exclude={cid}").json()["total"] == 0  # never the x-ray being traced
    client.patch(f"/api/cases/{cid}", json={"status": "reopen"})
    client.patch(f"/api/cases/{cid}", json={"skipped": ["cvm"]})
    client.patch(f"/api/cases/{cid}", json={"status": "confirmed"})
    assert client.get("/api/examples/C3d").json()["total"] == 0              # vertebrae skipped there
    assert client.get("/api/examples/S").json()["total"] == 1


def _traced_case(client, seed=0, name="Doe, Jane", dob="2013-01-02", taken=None, confirm=True):
    """A case with every point where synth put it (as the doctor would), optionally confirmed."""
    data, pts, facing = png_bytes(seed)
    cid = client.post("/api/cases", files=[("files", (f"x{seed}.png", data, "image/png"))]).json()[0]["id"]
    body = {"patient": {"name": name, "dob": dob, "sex": "F"}, "details_confirmed": True,
            "calibration": {"mm_per_px": 0.24, "source": "set by hand"},
            "landmarks": {c: {"x": v[0], "y": v[1], "by": "doctor"} for c, v in pts.items()}}
    if taken:
        body["taken"] = taken
    client.patch(f"/api/cases/{cid}", json=body)
    if confirm:
        r = client.patch(f"/api/cases/{cid}", json={"status": "confirmed"})
        assert r.status_code == 200, r.text
    return cid, pts


def test_facial_thirds_points_are_optional_on_older_tracings(client):
    cid, pts = _traced_case(client, confirm=False)
    old = ("Gs", "Stms", "Stmi", "Mes")
    # an x-ray traced before these points existed (or imported from iOrtho): complete without them
    r = client.patch(f"/api/cases/{cid}", json={"landmarks": {c: None for c in old}}).json()
    assert r["case"]["status"] == "traced" and r["analysis"]["progress"]["placed"] == r["analysis"]["progress"]["total"]
    assert client.patch(f"/api/cases/{cid}", json={"status": "confirmed"}).status_code == 200
    by = {m["key"]: m for m in client.get(f"/api/cases/{cid}").json()["analysis"]["measurements"]}
    assert by["LAFH"]["value"] is not None and by["LowShareS"]["note"] == "not traced"
    # adding them: placed from the average tracing to check - the confirmed tracing is reopened for that
    r = client.post(f"/api/cases/{cid}/fill?optional=true").json()
    lm = r["case"]["landmarks"]
    assert all(lm[c]["by"] == "template" for c in old) and r["case"]["status"] != "confirmed"
    assert any("added from the average tracing" in h["what"] for h in r["case"]["history"])
    # now they are part of the tracing: confirming needs them placed
    assert set(old) <= set(r["analysis"]["progress"] and lm)


def test_outlines_come_with_the_case_and_dots_moved_by_hand_stay(client):
    cid, pts = _traced_case(client, confirm=True)
    a = client.get(f"/api/cases/{cid}").json()["analysis"]
    ol = {o["key"]: o for o in a["outlines"]}
    assert {"profile", "mandible", "maxilla", "u1", "l1", "sella"} <= set(ol)
    assert ol["profile"]["traced"] == 1.0 and not ol["mandible"]["adjusted"]
    mine = [c if isinstance(c, str) else [c[0] + 6, c[1]] for c in ol["mandible"]["ctrl"]]
    r = client.patch(f"/api/cases/{cid}", json={"contours": {"mandible": mine, "nope": [[1, 2], [3, 4]]}}).json()
    assert r["case"]["status"] == "confirmed" and "nope" not in r["case"]["contours"]
    m = next(o for o in r["analysis"]["outlines"] if o["key"] == "mandible")
    assert m["adjusted"] and m["ctrl"] == [c if isinstance(c, str) else [round(c[0], 1), round(c[1], 1)] for c in mine]
    # back to drawn from the points: one outline, then all
    r = client.patch(f"/api/cases/{cid}", json={"contours": {"mandible": None}}).json()
    assert not next(o for o in r["analysis"]["outlines"] if o["key"] == "mandible")["adjusted"]
    # a molar: moved whole by its two handles
    u6 = next(o for o in r["analysis"]["outlines"] if o["key"] == "u6")
    assert u6["unit"] == "handles" and not u6["adjusted"]
    hs = [[h[0] + 20, h[1] - 8] for h in u6["handles"]]
    r = client.patch(f"/api/cases/{cid}", json={"contours": {"u6": hs}}).json()
    m = next(o for o in r["analysis"]["outlines"] if o["key"] == "u6")
    assert m["adjusted"] and m["handles"] == [[round(h[0], 1), round(h[1], 1)] for h in hs]
    assert m["xy"][0] == pytest.approx([u6["xy"][0][0] + 20, u6["xy"][0][1] - 8], abs=0.2)
    client.patch(f"/api/cases/{cid}", json={"contours": {"maxilla": [[10, 10], "ANS", [30, 30]]}})
    r = client.patch(f"/api/cases/{cid}", json={"contours": None}).json()
    assert r["case"]["contours"] == {} and not any(o["adjusted"] for o in r["analysis"]["outlines"])


def test_a_patients_xrays_over_time_and_the_comparison(client):
    a, _ = _traced_case(client, seed=0, taken="2024-03-01")
    b, _ = _traced_case(client, seed=4, taken="2026-03-01")
    other, _ = _traced_case(client, seed=2, name="Roe, Rick", dob="2012-05-05", taken="2025-01-01")
    rows = client.get(f"/api/cases/{b}/series").json()
    assert [r["id"] for r in rows] == [a, b]                      # oldest first; not the other patient
    assert [r["id"] for r in client.get(f"/api/cases/{other}/series").json()] == [other]
    cmp = client.get(f"/api/compare?ids={b},{a}").json()
    assert [d["id"] for d in cmp] == [a, b]
    d = cmp[0]
    assert d["mm_per_px"] == pytest.approx(0.24) and d["facing"] in ("left", "right") and d["age"] == pytest.approx(11.2, abs=0.1)
    assert "S" in d["points"] and any(o["key"] == "profile" for o in d["outlines"])
    assert any(m["key"] == "SNA" and m["value"] is not None for m in d["measurements"])
    assert client.get("/api/compare?ids=nope").status_code == 404
