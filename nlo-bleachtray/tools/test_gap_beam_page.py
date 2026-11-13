"""The Beam / No beam switch on the Result panel: the real server with the synthetic case of tools/test_pontics_page.py,
its pipeline stubbed to report a beam over a missing tooth's space, opened in headless Chromium.

The doctor, 11/12/2026: the edentulous area "becomes the weak part of the retainer ... fill it / reinforce it with a
beam"; "sometimes pontic is not the best option". The beam is made by itself; No beam re-makes the case with
gap_beam = false, Beam puts it back. No page errors allowed.

    python tools/test_gap_beam_page.py          (needs playwright + chromium; port 8796)
"""
import os, sys, time, threading

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics_page as TPP  # noqa: E402

PORT = 8796
fails = []


def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
    if not ok:
        fails.append(name)


def main():
    import app.server as srv
    import uvicorn
    job, _ = TPP.make_case(srv)
    JID = TPP.JID
    beam = [dict(side=-1, after_position=6, length_mm=3.9, width_mm=4.7, height_mm=1.8, top_under_teeth_mm=1.5, volume_ml=0.14)]
    for sc in job["scans"]:
        sc["report"]["gap_beams"] = list(beam)
        sc["report"].setdefault("params", {})["gap_beam"] = True
    seen = {"n": 0}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["params"] = dict(params or {}); seen["n"] += 1
        rep = dict(job["scans"][0]["report"])
        on = params.get("gap_beam", True) is not False
        rep["params"] = dict(rep.get("params") or {}, gap_beam=on)
        rep["gap_beams"] = list(beam) if on else []
        return rep
    srv.process = fake_process
    threading.Thread(target=lambda: uvicorn.run(srv.app, host="127.0.0.1", port=PORT, log_level="error"), daemon=True).start()
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
        time.sleep(0.6)

        def wait_run(n0):
            t0 = time.time()
            while time.time() - t0 < 30 and seen["n"] == n0:
                time.sleep(0.2)
            t0 = time.time()
            while time.time() - t0 < 30 and srv.JOBS[JID]["status"] != "done":
                time.sleep(0.2)
            page.wait_for_function("window.__view.seg() !== null", timeout=30000); time.sleep(1.0)
        check("a model with a beam: the switch is shown, Beam marked, with its size", page.locator("#beamswitch").count() == 1 and page.is_disabled("#beamOn") and page.is_enabled("#beamOff") and "3.9 mm long" in page.text_content("#beamswitch"), page.text_content("#stats")[:200])
        check("... and the result line names it", "beam across the missing tooth" in page.text_content("#stats"), page.text_content("#stats")[:300])
        n0 = seen["n"]; page.click("#beamOff"); wait_run(n0)
        check("No beam: the case is re-made with gap_beam off", (seen.get("params") or {}).get("gap_beam") is False, (seen.get("params") or {}).get("gap_beam"))
        check("... the switch stays, No beam marked", page.locator("#beamswitch").count() == 1 and page.is_disabled("#beamOff") and page.is_enabled("#beamOn") and "switched off" in page.text_content("#beamswitch"))
        n0 = seen["n"]; page.click("#beamOn"); wait_run(n0)
        check("Beam: re-made with it again", (seen.get("params") or {}).get("gap_beam") is True and page.is_disabled("#beamOn"), (seen.get("params") or {}).get("gap_beam"))
        check("no page errors", not errors, errors[:3])
        browser.close()
    print("\n" + ("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}"))
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
