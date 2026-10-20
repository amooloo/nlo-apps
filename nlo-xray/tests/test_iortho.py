"""Importing iOrtho tracings: report, dots, registration, naming the dots, and the API."""
import importlib
import sys

import numpy as np
import pytest

from iortho_fake import make
from xray import iortho


@pytest.fixture(scope="module")
def fake():
    return make(seed=3)


def test_report_is_read(fake):
    rep = iortho.read_report(fake["report"])
    assert rep["patient"] == dict(name="Test Patient", sex="F", dob="2013-05-10", taken="2026-10-15")
    assert rep["values"]["sna"] > 70 and "s-n(lengthofanteriorcranialbasemm)" in rep["values"]
    with pytest.raises(iortho.ImportError_):
        iortho.read_report(b"not a spreadsheet")


def test_dots_and_overlay(fake):
    dots, size = iortho.find_dots(fake["traced_rgb"])
    assert len(dots) == len(iortho.DOT_CODES) + 4 + 5          # landmarks + cusp dots + decoys
    assert iortho.looks_traced(fake["traced_rgb"])
    plain = np.stack([fake["original_gray"]] * 3, -1)
    assert not iortho.looks_traced(plain)


def test_registration_finds_scale_and_shift(fake):
    reg = iortho.register(fake["traced_rgb"], fake["original_gray"])
    assert reg["s"] == pytest.approx(0.83, abs=0.004)
    assert reg["tx"] == pytest.approx(40, abs=1.5) and reg["ty"] == pytest.approx(25, abs=1.5)
    assert reg["score"] > 0.8


@pytest.mark.parametrize("facing_left", [False, True])
def test_whole_import_lands_on_the_true_points(facing_left):
    f = make(seed=5, scale=0.9, pad=(30, 50), facing_left=facing_left)
    rep = iortho.read_report(f["report"])
    res = iortho.import_tracing(f["original_gray"], f["traced_rgb"], rep)
    assert res["facing"] == ("left" if facing_left else "right")
    for c, p in f["truth"].items():
        got = np.array(res["points"][c])
        assert np.hypot(*(got - p)) < 2.0, (c, got, p)            # original pixels (0.24 mm each)
    assert set(res["verified"]) >= set(iortho.DOT_CODES) | {"MOL"}
    assert res["unverified"] == ["PM"]
    assert all(r["ok"] for r in res["checks"])


def test_a_wrong_traced_image_is_refused(fake):
    other = make(seed=8)
    with pytest.raises(iortho.ImportError_):
        iortho.register(other["traced_rgb"], np.rot90(fake["original_gray"]).copy())


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setenv("NLO_XRAY_DATA", str(tmp_path))
    monkeypatch.setenv("NLO_XRAY_NO_NIGHTLY", "1")
    sys.modules.pop("app.server", None)
    srv = importlib.import_module("app.server")
    with TestClient(srv.app) as c:
        yield c
    sys.modules.pop("app.server", None)


def test_api_import_new_case_and_confirm(client, fake):
    files = [("files", ("Test_Patient_ceph.png", fake["original"], "image/png")),
             ("files", ("Test_Patient_traced.png", fake["traced"], "image/png")),
             ("files", ("Test_Patient_Cephalometry_Report.xlsx", fake["report"], "application/octet-stream"))]
    r = client.post("/api/import/iortho", files=files, data={"confirm": "false"}).json()
    assert not r["errors"] and len(r["results"]) == 1
    res = r["results"][0]
    assert res["verified"] == len(iortho.DOT_CODES) + 1 and res["unverified"] == ["PM"] and not res["confirmed"]
    case = client.get(f"/api/cases/{res['id']}").json()["case"]
    assert case["patient"]["name"] == "Patient, Test" and case["patient"]["dob"] == "2013-05-10"
    assert "cvm" in case["skipped"] and case["import"]["source"] == "iOrtho"
    assert case["calibration"]["mm_per_px"] == pytest.approx(0.24, abs=0.002)     # the fake's scale, from iOrtho's S-N
    assert "iOrtho" in case["calibration"]["source"]
    assert case["landmarks"]["S"]["by"] == "import" and case["landmarks"]["PM"]["conf"] < 1
    assert case["status"] == "traced"
    # the same three files again, confirming: the case is found again and confirmed
    r = client.post("/api/import/iortho", files=files, data={"confirm": "true"}).json()
    assert r["results"][0]["id"] == res["id"] and r["results"][0]["confirmed"]
    case = client.get(f"/api/cases/{res['id']}").json()["case"]
    assert case["status"] == "confirmed" and all(v["by"] == "doctor" for v in case["landmarks"].values())
    # a confirmed tracing is never overwritten by importing the same files again
    client.patch(f"/api/cases/{res['id']}", json={"landmarks": {"A": dict(x=500, y=500, by="doctor")}})
    r = client.post("/api/import/iortho", files=files, data={"confirm": "true"}).json()
    assert r["results"][0]["skipped"] and r["results"][0]["id"] == res["id"]
    case = client.get(f"/api/cases/{res['id']}").json()["case"]
    assert case["landmarks"]["A"]["x"] == 500 and case["status"] == "confirmed"
    bad = client.post(f"/api/cases/{res['id']}/iortho", files=files[1:])
    assert bad.status_code == 409 and "Reopen" in bad.json()["detail"]


def test_api_import_onto_an_open_case(client, fake):
    cid = client.post("/api/cases", files=[("files", ("x.png", fake["original"], "image/png"))]).json()[0]["id"]
    r = client.post(f"/api/cases/{cid}/iortho", files=[("files", ("t.png", fake["traced"], "image/png")),
                                                        ("files", ("r.xlsx", fake["report"], "application/octet-stream"))])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["verified"] >= len(iortho.DOT_CODES)
    assert body["case"]["landmarks"]["N"]["by"] == "import"
    bad = client.post(f"/api/cases/{cid}/iortho", files=[("files", ("t.png", fake["original"], "image/png")),
                                                          ("files", ("r.xlsx", fake["report"], "application/octet-stream"))])
    assert bad.status_code == 400 and "no iOrtho tracing" in bad.json()["detail"]


def test_api_import_reports_missing_files(client, fake):
    pdf = ("files", ("Test_Patient_Cephalometry_Report.pdf", b"%PDF-1.4 made up", "application/pdf"))
    r = client.post("/api/import/iortho", files=[("files", ("Test_Patient.xlsx", fake["report"], "application/octet-stream")),
                                                  pdf]).json()
    row = r["results"][0]
    assert "Still needed: iOrtho's traced image" in row["error"] and "the x-ray itself" in row["error"]
    assert row["waiting"] == ["Test_Patient.xlsx"]          # kept by the page for the next drop
    assert not r["errors"]                                   # the PDF next to the Excel report is simply not needed
    r = client.post("/api/import/iortho", files=[("files", ("a.png", fake["original"], "image/png")), pdf])
    assert r.status_code == 400 and "export the Excel one" in r.json()["detail"]


def test_api_import_two_patients_at_once(client, fake):
    other = make(seed=5, scale=0.9, pad=(30, 50), name="Maya Rivers")
    files = [("files", ("Test_Patient_ceph.png", fake["original"], "image/png")),
             ("files", ("Maya_Rivers_ceph.png", other["original"], "image/png")),
             ("files", ("Test_Patient_traced.png", fake["traced"], "image/png")),
             ("files", ("Maya Rivers traced.png", other["traced"], "image/png")),
             ("files", ("Test_Patient_Cephalometry_Report.xlsx", fake["report"], "application/octet-stream")),
             ("files", ("Maya_Rivers_Cephalometry_Report.xlsx", other["report"], "application/octet-stream"))]
    r = client.post("/api/import/iortho", files=files, data={"confirm": "false"}).json()
    assert not r["errors"]
    got = {x["name"]: x for x in r["results"]}
    assert set(got) == {"Patient, Test", "Rivers, Maya"}
    assert all(x["verified"] == len(iortho.DOT_CODES) + 1 for x in got.values())
    assert got["Patient, Test"]["id"] != got["Rivers, Maya"]["id"]


def test_api_import_onto_the_xray_already_here(client, fake):
    """Only iOrtho's two files: the x-ray already in the app (same patient, same picture) is used."""
    other = make(seed=5, scale=0.9, pad=(30, 50), name="Maya Rivers")
    cid = client.post("/api/cases", files=[("files", ("ceph.png", fake["original"], "image/png"))]).json()[0]["id"]
    client.patch(f"/api/cases/{cid}", json={"patient": {"name": "Test Patient"}, "details_confirmed": True})
    oid = client.post("/api/cases", files=[("files", ("x.png", other["original"], "image/png"))]).json()[0]["id"]
    client.patch(f"/api/cases/{oid}", json={"patient": {"name": "Test Patient"}, "details_confirmed": True})  # same name, other x-ray
    two = [("files", ("traced.png", fake["traced"], "image/png")),
           ("files", ("Test_Patient_Cephalometry_Report.xlsx", fake["report"], "application/octet-stream"))]
    r = client.post("/api/import/iortho", files=two, data={"confirm": "false"}).json()
    row = r["results"][0]
    assert row["id"] == cid and row["verified"] == len(iortho.DOT_CODES) + 1, row
    assert len(client.get("/api/cases").json()) == 2                   # nothing new added
    assert client.get(f"/api/cases/{oid}").json()["case"]["landmarks"] == {}
    # not in the app at all: asked for, and the two files are kept for the next drop
    r = client.post("/api/import/iortho", files=[("files", ("t.png", other["traced"], "image/png")),
                                                 ("files", ("Maya_Rivers_Cephalometry_Report.xlsx", other["report"],
                                                            "application/octet-stream"))]).json()
    row = r["results"][0]
    assert "the x-ray itself" in row["error"] and set(row["waiting"]) == {"t.png", "Maya_Rivers_Cephalometry_Report.xlsx"}


def test_api_replace_a_confirmed_tracing_only_when_asked(client, fake):
    files = [("files", ("Test_Patient_ceph.png", fake["original"], "image/png")),
             ("files", ("Test_Patient_traced.png", fake["traced"], "image/png")),
             ("files", ("Test_Patient_Cephalometry_Report.xlsx", fake["report"], "application/octet-stream"))]
    cid = client.post("/api/import/iortho", files=files, data={"confirm": "true"}).json()["results"][0]["id"]
    client.patch(f"/api/cases/{cid}", json={"landmarks": {"A": dict(x=500, y=500, by="doctor")}})
    r = client.post("/api/import/iortho", files=files[1:], data={"confirm": "true"}).json()["results"][0]
    assert r["skipped"] and r["replaceable"] and set(r["files"]) == {"Test_Patient_traced.png", "Test_Patient_Cephalometry_Report.xlsx"}
    assert client.get(f"/api/cases/{cid}").json()["case"]["landmarks"]["A"]["x"] == 500
    r = client.post(f"/api/cases/{cid}/iortho", files=files[1:], data={"confirm": "true", "replace": "true"})
    assert r.status_code == 200, r.text
    case = r.json()["case"]
    assert case["status"] == "confirmed" and case["landmarks"]["A"]["x"] != 500
    assert any("replaced with iOrtho" in h["what"] for h in case["history"])
    # the wrong picture never reopens a confirmed tracing
    other = make(seed=8)
    bad = client.post(f"/api/cases/{cid}/iortho", files=[("files", ("t.png", other["traced"], "image/png")), files[2]],
                      data={"replace": "true"})
    assert bad.status_code == 400 and client.get(f"/api/cases/{cid}").json()["case"]["status"] == "confirmed"


def test_an_xray_with_a_red_label_is_not_a_traced_image(fake):
    rgb = np.stack([fake["original_gray"]] * 3, -1).copy()
    rgb[40:90, 40:300] = (230, 20, 20)                      # a red label or ruler mark from the x-ray software
    rgb[200:206, 100:106] = (230, 20, 20)
    assert not iortho.looks_traced(rgb)
    assert iortho.looks_traced(fake["traced_rgb"])
