"""The web app end to end: import, details, anchors, editing, confirm, settings, passcode, privacy headers."""
import importlib
import io
import os
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image


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
    assert len(lm) == 38 and lm["S"]["by"] == "doctor" and lm["A"]["by"] == "template"
    assert body["case"]["status"] == "traced"
    assert body["case"]["facing"] == facing
    # move the real points in (as the doctor would)
    r = client.patch(f"/api/cases/{cid}", json={"landmarks": {c: {"x": v[0], "y": v[1], "by": "doctor"} for c, v in pts.items()}})
    a = r.json()["analysis"]
    assert a["progress"]["reviewed"] == a["progress"]["total"] == 38
    by = {m["key"]: m for m in a["measurements"]}
    assert by["ANB"]["value"] is not None and by["Wits"]["note"] == "needs calibration"
    # calibrate (0.24 mm per pixel in the synthetic cephs)
    r = client.patch(f"/api/cases/{cid}", json={"calibration": {"mm_per_px": 0.24, "source": "ruler"}})
    by = {m["key"]: m for m in r.json()["analysis"]["measurements"]}
    assert by["Wits"]["value"] is not None
    assert client.patch(f"/api/cases/{cid}", json={"calibration": {"mm_per_px": 9}}).status_code == 400
    # skip soft tissue -> those points go, progress shrinks; switch back on -> filled in
    r = client.patch(f"/api/cases/{cid}", json={"skipped": ["soft"]}).json()
    assert "Prn" not in r["case"]["landmarks"] and r["analysis"]["progress"]["total"] == 33
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
