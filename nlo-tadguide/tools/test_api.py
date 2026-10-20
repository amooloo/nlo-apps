"""End-to-end through the web API on a phantom (no browser): upload, match, accept, suggest, place, guide, files,
lesson, feedback.   python tools/test_api.py <phantom_dir>"""
import os, sys, json, time, glob, shutil, tempfile
import numpy as np
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)


def main(d):
    from fastapi.testclient import TestClient
    import app.server as srv
    cl = TestClient(srv.app)
    files = [("files", (os.path.basename(p), open(p, "rb"), "application/dicom")) for p in sorted(glob.glob(os.path.join(d, "cbct", "*.dcm")))]
    rel = [f"EXPORT/CBCT/{os.path.basename(p)}" for p in sorted(glob.glob(os.path.join(d, "cbct", "*.dcm")))]
    files.append(("files", ("Phantom_Test_20261020_upper.stl", open(os.path.join(d, "scan_upper.stl"), "rb"), "model/stl")))
    rel.append("Phantom_Test_20261020_upper.stl")
    r = cl.post("/api/cases", files=files, data=dict(relpaths=json.dumps(rel)))
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    print("case", cid, "arch", r.json()["arch"], "scanner", r.json()["scanner"])

    def wait(timeout=600):
        t = time.time()
        while time.time() - t < timeout:
            st = cl.get(f"/api/cases/{cid}").json()
            if not st["busy"]:
                return st
            time.sleep(0.5)
        raise RuntimeError("timeout")
    st = wait()
    assert not st.get("error"), st.get("error")
    print("stage", st["stage"], "|", st["registration"]["summary"]["text"], st["registration"]["method"])
    for m in ("bone", "teeth", "scan"):
        b = cl.get(f"/api/cases/{cid}/mesh/{m}")
        assert b.status_code == 200 and len(b.content) > 1000, m
    png = cl.get(f"/api/cases/{cid}/slice.png?view=coronal")
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    st = cl.post(f"/api/cases/{cid}/accept").json()
    print("accepted; arch bounds", {k: [round(x, 1) for x in v] for k, v in st["arch_info"]["bounds"].items()})
    cl.post(f"/api/cases/{cid}/suggest", json=dict(site="buccal", sides=["R", "L"]))
    st = wait()
    items = st["suggestions"]["items"]
    print("suggestions:", [(i["label"], i["metrics"]["status"], i["metrics"]["root_clearance"]) for i in items])
    st = cl.post(f"/api/cases/{cid}/tads", json=dict(suggestion=items[0]["id"])).json()
    # a TAD by clicking: a point on the left buccal gum near the 5/6 contact
    import app.server as s2
    c = s2.CASES[cid]
    A = c.arch
    p, tan, buc = A.at(A.gap("L", 5))
    hit = c.ctx.entry("buccal", "L", A.gap("L", 5), 11.0)
    st = cl.post(f"/api/cases/{cid}/tads", json=dict(site="buccal", point=hit.tolist())).json()
    tid = st["tads"][-1]["id"]
    st = cl.patch(f"/api/cases/{cid}/tads/{tid}", json=dict(ds=0.5, dalpha=5)).json()
    st = cl.post(f"/api/cases/{cid}/tads/{tid}/optimize").json()
    assert [t["hand"] for t in st["tads"]] == [False, False], [t.get("hand") for t in st["tads"]]   # suggestion; fine-tune
    assert st["tads"][0]["product"] == "tomas-sd-08", st["tads"][0].get("product")             # the kit's buccal default
    st = cl.patch(f"/api/cases/{cid}/tads/{tid}", json=dict(size=[1.6, 10.0, 1.5])).json()     # his change after the fine-tune
    assert [t["hand"] for t in st["tads"]] == [False, True], [t.get("hand") for t in st["tads"]]
    t1 = st["tads"][1]
    assert (t1["product"], t1["length"], t1["collar"]) == ("tomas-sd-10", 10.0, 1.5), t1        # same size: still a tomas-pin
    st = cl.patch(f"/api/cases/{cid}/tads/{tid}", json=dict(product="tomas-ep-08")).json()
    t1 = st["tads"][1]
    assert (t1["product"], t1["diameter"], t1["length"], t1["collar"]) == ("tomas-ep-08", 1.6, 8.0, 2.0), t1
    rep0 = cl.get(f"/api/cases/{cid}/file/report").text
    assert "tomas-pin SD 08" in rep0 and "tomas-pin EP 08" in rep0
    print("TADs:", [(t["label"], t["metrics"]["status"], t["metrics"]["root_clearance"], t["metrics"]["cortical"]) for t in st["tads"]])
    for v in ("tad_md", "tad_bl", "tad_x"):
        png = cl.get(f"/api/cases/{cid}/slice.png?view={v}&tad={tid}")
        assert png.status_code == 200 and png.content[:4] == b"\x89PNG", v
        open(os.path.join(d, f"api_{v}.png"), "wb").write(png.content)
    cl.post(f"/api/cases/{cid}/guide", json=dict(params=dict(voxel=0.25)))
    st = wait()
    assert not st.get("error"), st.get("error")
    gi = st["guide"]["info"]
    print("guide:", {k: gi[k] for k in ("watertight", "pieces", "volume_ml", "seconds")}, "holes", [h["clear"] for h in gi["holes"]])
    g = cl.get(f"/api/cases/{cid}/file/guide")
    assert g.status_code == 200 and len(g.content) > 10000
    open(os.path.join(d, "api_guide.stl"), "wb").write(g.content)
    rep = cl.get(f"/api/cases/{cid}/file/report")
    assert rep.status_code == 200 and "TAD plan" in rep.text
    open(os.path.join(d, "api_report.html"), "w").write(rep.text)
    st = cl.post(f"/api/cases/{cid}/finish").json()
    st = cl.post(f"/api/cases/{cid}/feedback", json=dict(fit="tight", sleeve="good")).json()
    les = next(x for x in s2.lessons.load_all() if x["id"] == st["lesson_id"])
    assert [t["hand"] for t in les["tads"]] == [False, True], les["tads"]       # only his own TAD teaches habits
    assert [t["product"] for t in les["tads"]] == ["tomas-sd-08", "tomas-ep-08"], les["tads"]
    name = s2.CASES[cid].state["patient"]
    assert les["feedback"]["fit"] == "tight" and name and name.lower() not in json.dumps(les).lower(), name   # no name in it
    print("lesson", st["lesson_id"], "learn:", cl.get("/api/learn").json())
    print("guide defaults now:", cl.get("/api/guide/defaults").json())
    print("cases:", [(x["patient"], x["stage"]) for x in cl.get("/api/cases").json()["cases"]])
    print("OK")
    return cid


if __name__ == "__main__":
    main(sys.argv[1])
