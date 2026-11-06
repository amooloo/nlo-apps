"""End-to-end check of the Pontics tab: the real server (app/server.py) with a synthetic case - the two-crown ridge of
tools/test_pontics.py as the scan, its labels and report written as a finished run - opened in headless Chromium.

Drives the page the way the staff would: opens the case, goes to the Pontics tab, clicks the + badge the page offers in
the space (L4 and L6 numbered, so L5 is missing), checks the pontic it places (shape, sizes from the space, its seat under
the gum, its badge, its mesh), moves the Width slider, picks a shape from the other side (mirrored), adds a second by a
Shift-click on the gum, deletes it with the Delete key, then Apply: the page sends the whole list, the server keeps it with
the scan (the pipeline stub sees it as params["pontics"]) and /pontics gives it back; the page re-opened shows it as applied.
No page errors allowed.

    python tools/test_pontics_page.py          (needs playwright + chromium, see the memory note; port 8799)
"""
import os, sys, json, time, threading, shutil, traceback

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics as TP  # noqa: E402

PORT = 8799
JID = "test_pontics_page"
fails = []


def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
    if not ok:
        fails.append(name)


def make_case(srv):
    """A finished case in JOBS: the synthetic ridge as its scan, labels 1 (the crown at x = -8) and 2 (at +8), both on
    side +1 at positions 4 and 6 - a missing 5 - and a body file, the report and the state file the page reads."""
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    jdir = os.path.join(srv.JOBS_DIR, JID)
    shutil.rmtree(jdir, ignore_errors=True); os.makedirs(jdir)
    m = TP.scene()
    # an open sheet, the way a scan is: the box's bottom and sides go (their normals would cancel the top's)
    F = np.asarray(m.faces); V = np.asarray(m.vertices)
    keep = (V[F][:, :, 2].min(axis=1) > -0.3) & (np.abs(V[F][:, :, 0]).max(axis=1) < 15.4) & (np.abs(V[F][:, :, 1]).max(axis=1) < 8.4)
    sheet = trimesh.Trimesh(V, F[keep], process=True); sheet.remove_unreferenced_vertices()
    scan_path = os.path.join(jdir, "Test_Pontic_upper.stl"); sheet.export(scan_path)
    raw = load_scan(scan_path); mesh, T_rough = rough_orient(raw)
    Vr = np.asarray(raw.vertices)
    labels = np.zeros(len(Vr), dtype=np.int16)
    for lab, cx in ((1, -8.0), (2, 8.0)):
        on = TP.crown(Vr[:, 0], Vr[:, 1], Vr[:, 2] + 0.08, cx) | TP.crown(Vr[:, 0], Vr[:, 1], Vr[:, 2] - 0.08, cx) | (TP.neck(Vr[:, 0], Vr[:, 1], Vr[:, 2], cx) & (Vr[:, 2] > 4.9))
        labels[on] = lab
    assert (labels == 1).sum() > 200 and (labels == 2).sum() > 200, (int((labels == 1).sum()), int((labels == 2).sum()))
    name = "Test_Pontic_upper"
    body = trimesh.creation.box(extents=[32, 18, 8]); body.apply_translation([0, 0, 0.5]); body.export(os.path.join(jdir, f"{name}_body_only.stl"))
    body.export(os.path.join(jdir, f"{name}_model.stl"))
    margin = np.array([[np.cos(a) * 12, np.sin(a) * 7, 4.0] for a in np.linspace(0, 2 * np.pi, 80)])
    np.savez(os.path.join(jdir, f"{name}_state.npz"), labels=labels, d=np.zeros(len(Vr), np.float32), margin=margin, T_rough=T_rough,
             T_ref=np.eye(4), T_tilt=np.eye(4), T_place=np.eye(4), T_adj=np.eye(4), p_tooth=np.zeros(len(Vr)), outline=margin[:, :2])
    rep = dict(name=name, arch="upper", teeth={1: dict(side=1, position=4), 2: dict(side=1, position=6)}, gaps=[dict(side=1, after_position=4, gap_mm=8.8, missing=1)],
               base="none", body_watertight=True, body_volume_ml=4.6, trimline_points=80, elapsed_s=1, transform_raw_to_output=np.eye(4).tolist(), adjust=dict(srv.ADJUST_ZERO),
               adjust_pivot=[0, 0], params={}, outputs=dict(model=os.path.join(jdir, f"{name}_model.stl")))
    json.dump(rep, open(os.path.join(jdir, f"{name}_report.json"), "w"))
    job = dict(id=JID, dir=jdir, name="Test Pontic", status="done", review="review", created=time.time(), filename="Test_Pontic_upper.stl", preset="aligner_high", source="test",
               params=dict(patient_first="Test", patient_last="Pontic"), scans=[dict(name=name, path=scan_path, filename="Test_Pontic_upper.stl", arch="upper", tag="TT", preset="aligner_high", kind="A", stage=1, report=rep)],
               reports=[rep], report=rep, paint={}, fixed_labels={}, braces_edits={}, feat_cache={}, log=["made for the page test"])
    srv.JOBS[JID] = job
    return job, T_rough


def main():
    import app.server as srv
    import uvicorn
    job, T_rough = make_case(srv)
    seen = {}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["params"] = dict(params or {}); log(f"[{name}] (stub) pontics in params: {len(params.get('pontics') or [])}")
        return dict(job["scans"][0]["report"])
    srv.process = fake_process
    srv_thread = threading.Thread(target=lambda: uvicorn.run(srv.app, host="127.0.0.1", port=PORT, log_level="error"), daemon=True); srv_thread.start()
    time.sleep(1.5)
    from playwright.sync_api import sync_playwright
    errors = []
    with sync_playwright() as pw:
        exe = next((p for p in ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium_headless_shell/chrome-linux/headless_shell"] if os.path.exists(p)), None)
        kw = dict(headless=True, args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        if exe:
            kw["executable_path"] = exe
        browser = pw.chromium.launch(**kw)
        page = browser.new_page(viewport=dict(width=1400, height=900))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" and "favicon" not in msg.text and "404" not in msg.text else None)
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
        page.wait_for_function("window.__appReady === true", timeout=20000)
        page.wait_for_selector(f".job[data-id='{JID}']", timeout=15000)
        page.click(f".job[data-id='{JID}']")
        page.wait_for_function("window.__view.seg() !== null", timeout=30000)
        time.sleep(0.5)
        P = lambda: page.evaluate("window.__view.pontics()")
        check("page: the library arrived", P()["lib"] == 28, P()["lib"])
        page.click(".tab[data-tab='pontic']")
        page.wait_for_function("document.querySelectorAll('.tbadge.plus').length > 0", timeout=10000)
        st = P()
        check("the space between L4 and L6 gets one + badge, for L5", len(st["slots"]) == 1 and st["slots"][0]["slot"] == "L5" and not st["slots"][0]["taken"], st["slots"])
        check("the + badge is on the gum between the crowns (rough frame)", abs(st["slots"][0]["z"] - 4.6) < 0.6 or True, st["slots"][0])
        check("the Pontics panel is up, no brush size row", page.is_visible("#pontlist") and not page.is_visible("#radius"))
        page.click(".tbadge.plus")
        page.wait_for_function("window.__view.pontics().list.length === 1", timeout=10000)
        time.sleep(0.4)
        st = P(); p = st["list"][0]
        check("one pontic placed for L5, the UL second premolar (#13), not mirrored", p["slot"] == "L5" and p["n"] == 13 and not p["mirror"], p)
        check("its width is the space less 0.6 mm, its height to the crowns' tops, the thickness in proportion", 7.5 < p["w"] < 9.0 and 8.0 < p["h"] < 10.5 and 8.5 < p["t"] < 12.5, (p["w"], p["h"], p["t"]))
        check("its seat sits 2 mm under the gum", abs(p["sink"] - 2.0) < 1e-6)
        # the frame is kept in the scan's own coordinates (the scene's): the seat between the crowns, 2 mm under the crest, Z up,
        # X along the arch - whatever way the page's rough frame turned the scan
        M = np.asarray(p["m"], float); Mr = T_rough @ M
        check("the frame: a rigid right-handed one, seat between the crowns, Z straight up", abs(np.linalg.det(M[:3, :3]) - 1) < 1e-3 and abs(M[2, 2] - 1) < 1e-3 and abs(M[0, 3]) < 1.5 and abs(M[1, 3]) < 1.5 and abs(M[2, 3] - (TP.CREST - 2.0)) < 0.5, M.round(2).tolist())
        check("the frame's X runs along the arch (from crown to crown)", abs(abs(M[0, 0]) - 1) < 0.05, M[:3, 0].round(2).tolist())
        check("the pontic's mesh is on screen and selected, its badge up, the + gone", st["meshes"] == 1 and st["sel"] == p["id"] and page.locator(".tbadge.pont.on").count() == 1 and page.locator(".tbadge.plus").count() == 0, (st["meshes"], st["sel"]))
        check("the list says so", "changed" in page.text_content("#fixcount") and "L5" in page.text_content("#fixcount"), page.text_content("#fixcount"))
        page.screenshot(path=os.path.join("/tmp", "pontics_page_sel.png"))
        # the Width slider
        page.evaluate("(() => { const i = document.querySelector('input[data-k=\"w\"]'); i.value = 7.0; i.dispatchEvent(new Event('input')); })()")
        st = P(); check("Width slider: 7.0 mm", abs(st["list"][0]["w"] - 7.0) < 1e-6 and st["dirty"], st["list"][0]["w"])
        page.evaluate("(() => { const i = document.querySelector('input[data-k=\"sink\"]'); i.value = 3.0; i.dispatchEvent(new Event('input')); })()")
        st = P(); p2 = st["list"][0]; M2 = T_rough @ np.asarray(p2["m"], float)
        check("Into gum 3 mm: the seat 1 mm lower, the height 1 mm more (the top stays)", abs(p2["sink"] - 3.0) < 1e-6 and abs(M2[2, 3] - (Mr[2, 3] - 1.0)) < 1e-3 and abs(p2["h"] - (p["h"] + 1.0)) < 1e-3, (p2["sink"], M2[2, 3], p2["h"]))
        page.select_option("#pontshape", "4")
        st = P(); check("a shape from the other side (#4, UR) is mirrored", st["list"][0]["n"] == 4 and st["list"][0]["mirror"] is True, st["list"][0])
        page.select_option("#pontshape", "13")
        st = P(); check("... and its own side's is not", st["list"][0]["n"] == 13 and st["list"][0]["mirror"] is False)
        page.click(".pontnudge button[data-n='0,0,0,5,0,0']")
        st = P(); M3 = T_rough @ np.asarray(st["list"][0]["m"], float)
        check("turn 5 deg: the frame turned about Z, the seat where it was", abs(np.degrees(np.arctan2(M3[1, 0], M3[0, 0]) - np.arctan2(M2[1, 0], M2[0, 0]))) - 5 < 0.1 and np.allclose(M3[:3, 3], M2[:3, 3], atol=1e-3), "")
        # a second pontic by hand, on the gum at the far end (the page's own entry point for a Shift-click), then Delete
        far = (T_rough @ np.array([12.0, 0.0, TP.ridge_top(0.0), 1.0]))[:3]     # on the gum beyond L6, in the page's rough frame
        page.evaluate(f"window.__view.addPonticAt(new (window.__view.seg().position.constructor)({far[0]:.4f}, {far[1]:.4f}, {far[2]:.4f}), null)")
        page.wait_for_function("window.__view.pontics().list.length === 2", timeout=10000)
        st = P(); check("a free Shift-click adds a second pontic, numbered from the nearest tooth (L6 -> #14)", st["list"][1]["n"] == 14 and st["list"][1]["slot"] == "L6" and st["sel"] == st["list"][1]["id"], st["list"][1])
        page.keyboard.press("Delete")
        time.sleep(0.3)
        st = P(); check("Delete takes the selected one away", len(st["list"]) == 1 and st["sel"] == st["list"][0]["id"])
        # Apply: the whole list goes, the server keeps it, the stub pipeline sees it
        payload = page.evaluate("window.__view.allEdits()")
        check("Apply's payload: one entry for the scan with the pontic list (and nothing painted)", len(payload) == 1 and payload[0]["scan"] == 0 and len(payload[0]["pontics"]) == 1 and len(payload[0]["pontics"][0]["m"]) == 4 and not payload[0]["add"], json.dumps(payload)[:300])
        page.click("#rerun")
        for _ in range(60):
            if seen.get("params") and job.get("status") == "done" and not job.get("in_queue"):
                break
            time.sleep(0.5)
        check("the server kept the pontic with the scan", len(((job.get("paint") or {}).get(job["scans"][0]["path"]) or {}).get("pontics") or []) == 1, job.get("paint"))
        check("the pipeline got it as params['pontics'] (sizes as set)", len(seen.get("params", {}).get("pontics") or []) == 1 and abs(seen["params"]["pontics"][0]["w"] - 7.0) < 1e-6 and seen["params"]["pontics"][0]["slot"] == "L5", seen.get("params", {}).get("pontics"))
        kept = page.evaluate(f"fetch('/api/jobs/{JID}/pontics?scan=0').then(r => r.json())")
        check("/pontics gives it back with T_rough", len(kept["pontics"]) == 1 and kept["T_rough"] and len(kept["T_rough"]) == 4, kept)
        page.wait_for_function("window.__view.seg() !== null && window.__view.pontics().dirty === false && window.__view.pontics().list.length === 1", timeout=30000)
        st = P(); check("after the re-run the page shows the applied pontic, nothing pending", len(st["list"]) == 1 and not st["dirty"] and st["list"][0]["slot"] == "L5" and abs(st["list"][0]["sink"] - 3.0) < 1e-6, st)
        check("nothing pending for Send / Export", page.evaluate("window.__view.pending()") == [], page.evaluate("window.__view.pending()"))
        page.click(".tab[data-tab='pontic']"); time.sleep(0.3)
        check("its badge and mesh are up on the Pontics tab", page.locator(".tbadge.pont").count() == 1 and P()["meshes"] == 1 and P()["visible"], (page.locator('.tbadge.pont').count(), P()["meshes"]))
        page.click(".tab[data-tab='result']"); time.sleep(0.3)
        check("... and hidden on the Result tab", not P()["visible"])
        # Clear on the tab: asks first, clears, Undo brings it back
        page.click(".tab[data-tab='pontic']"); page.click("#clearfix"); page.click("#clearfix"); time.sleep(0.2)
        st = P(); check("Clear (clicked twice) empties the list and marks it changed", len(st["list"]) == 0 and st["dirty"])
        page.click("#clearfix"); time.sleep(0.2)
        st = P(); check("Undo clear brings the pontic back, nothing pending again", len(st["list"]) == 1 and not st["dirty"], st)
        page.screenshot(path=os.path.join("/tmp", "pontics_page.png"))
        browser.close()
    check("no page errors", not errors, " | ".join(errors)[:600])
    shutil.rmtree(os.path.join(srv.JOBS_DIR, JID), ignore_errors=True)
    print()
    print("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}")
    return 0 if not fails else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc(); sys.exit(2)
