"""End-to-end check of the Phase I thin-flange choice on the Result panel: the real server (app/server.py) with the
synthetic case of tools/test_pontics_page.py made a Phase I case, opened in headless Chromium.

The doctor, 11/10/2026: under 5 mm of flange "still do the cutouts but also give that warning ... don't just
automatically switch to block-out. Give them an option ... they can either continue going forward or they can switch to
block-out." The pipeline stub reports cutouts with a thin flange; the page must show the strip with both buttons;
Switch this arch to block-out re-runs with p1.p1_method_by_arch = {arch: 'bott'} (the case's own p1_method untouched);
the arch then offers Back to cutouts, which takes the arch's entry away again; Keep the cutouts hides the strip and it
stays hidden when the case is opened again. No page errors allowed.

    python tools/test_p1choice_page.py          (needs playwright + chromium; port 8799)
"""
import os, sys, time, threading

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics_page as TPP  # noqa: E402

PORT = 8799
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
    thin = dict(method="cott", arch="upper", teeth=["R3", "R4"], thin_flange_mm=2.9, bridge_mm=2.9)
    plain = dict(method="cott", arch="upper", teeth=["R3", "R4"], bridge_mm=6.0)
    for sc in job["scans"]:
        sc["tag"] = "P1"; sc["preset"] = "phase1"
        sc["report"]["phase1"] = dict(thin)
        sc["report"]["warnings"] = ["Phase I retainer: only 2.9 mm of flange is left under the cutouts on the tongue side"]
    job["preset"] = "phase1"
    job["params"]["p1"] = dict(p1_method="cott", p1_teeth=["R3", "R4", "L3", "L4"])
    seen = {"n": 0}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["params"] = dict(params or {}); seen["n"] += 1
        rep = dict(job["scans"][0]["report"])
        how = (params.get("p1_method_by_arch") or {}).get("upper")
        rep["phase1"] = dict(method="bott", arch="upper", method_by_choice="bott") if how == "bott" else dict(thin if seen.get("thin", True) else plain)
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

        def open_case():
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
        open_case()
        check("cutouts with a thin flange: the strip is shown with the amount", page.locator("#p1choice").count() == 1 and "2.9 mm" in page.text_content("#p1choice"), page.text_content("#stats")[:200])
        check("... with Keep the cutouts, and the two ways side by side (Cutout TT marked)", page.locator("#p1keep").count() == 1 and page.is_enabled("#p1toBott") and page.is_disabled("#p1toCott") and "Cutout TT ✓" in page.text_content("#p1switch"), page.text_content("#stats")[-200:])
        n0 = seen["n"]
        page.click("#p1toBott"); wait_run(n0)
        p1p = seen.get("params") or {}
        check("Switch this arch to block-out: the arch is re-made with block-out for that arch only", (p1p.get("p1_method_by_arch") or {}).get("upper") == "bott" and p1p.get("p1_method") == "cott", (p1p.get("p1_method_by_arch"), p1p.get("p1_method")))
        check("the switched arch: Block-out TT marked, Cutout TT offered, no thin-flange strip", page.is_enabled("#p1toCott") and page.is_disabled("#p1toBott") and "Block-out TT ✓" in page.text_content("#p1switch") and page.locator("#p1keep").count() == 0, page.text_content("#stats")[-200:])
        n0 = seen["n"]
        page.click("#p1toCott"); wait_run(n0)
        p1p = seen.get("params") or {}
        check("Cutout TT: the arch is cutouts again", (p1p.get("p1_method_by_arch") or {}).get("upper") == "cott" and page.locator("#p1keep").count() == 1, p1p.get("p1_method_by_arch"))
        page.click("#p1keep"); time.sleep(0.2)
        check("Keep the cutouts: the strip goes away, the switch stays", page.locator("#p1choice").count() == 0 and page.locator("#p1switch").count() == 1)
        open_case()
        check("... and stays away when the case is opened again", page.locator("#p1choice").count() == 0 and page.locator("#p1switch").count() == 1)
        # an arch with enough flange has the switch too, back and forth
        seen["thin"] = False
        n0 = seen["n"]; page.click("#p1toBott"); wait_run(n0)
        check("with enough flange: to Block-out TT", (seen["params"].get("p1_method_by_arch") or {}).get("upper") == "bott" and page.is_disabled("#p1toBott"))
        n0 = seen["n"]; page.click("#p1toCott"); wait_run(n0)
        check("... and back to Cutout TT, no strip", (seen["params"].get("p1_method_by_arch") or {}).get("upper") == "cott" and page.is_disabled("#p1toCott") and page.locator("#p1choice").count() == 0)
        check("no page errors", not errors, errors[:3])
        browser.close()
    print("\n" + ("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}"))
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
