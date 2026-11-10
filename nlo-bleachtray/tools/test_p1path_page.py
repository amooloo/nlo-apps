"""End-to-end check of the Phase I tab's Cutout outline: the real server (app/server.py) with the synthetic case of
tools/test_pontics_page.py made a Phase I case, opened in headless Chromium.

Why it exists (11/10/2026): the outline's dots and line were counted but never shown - loading a scan cleared the
segmentation group and the outline's layer was not put back - so "nothing happens" on a Shift-click. And the doctor
asked to draw the cutout instead of clicking it dot by dot.

Drives the page the way the staff would: opens the case, goes to the Phase I tab, Shift-clicks three dots (they must be
on screen, on the scan's group), Enter finishes the outline; then holds Shift and drags a line across the model - the
line follows the mouse and letting go finishes a second outline; a third is clicked and left open, and Apply takes it
along. The page sends every outline, the server keeps them with the scan (the pipeline stub sees them as
params["p1_path_idx"]) and /p1dots gives them back; the case re-opened shows them as applied. No page errors allowed.

    python tools/test_p1path_page.py          (needs playwright + chromium; port 8798)
"""
import os, sys, time, threading

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics_page as TPP  # noqa: E402

PORT = 8798
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
    for sc in job["scans"]:                      # a Phase I case: the tab is on for it
        sc["tag"] = "P1"; sc["preset"] = "phase1"
    job["preset"] = "phase1"
    seen = {}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["params"] = dict(params or {}); log(f"[{name}] (stub) outlines in params: {len(params.get('p1_path_idx') or [])}")
        return dict(job["scans"][0]["report"])
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
        page.on("console", lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" and "favicon" not in msg.text and "404" not in msg.text and "too short to be a cutout" not in msg.text else None)

        def open_case():
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
            page.wait_for_function("window.__appReady === true", timeout=20000)
            page.wait_for_selector(f".job[data-id='{JID}']", timeout=15000)
            page.click(f".job[data-id='{JID}']")
            page.wait_for_function("window.__view.seg() !== null", timeout=30000)
            time.sleep(0.5)
            page.click(".tab[data-tab='p1']"); time.sleep(0.3)
        open_case()
        S = lambda: page.evaluate("window.__view.p1path()")
        check("the Phase I tab is on, Cutout outline is its tool", "on" in (page.get_attribute(".tab[data-tab='p1']", "class") or ""))
        st = S()
        check("the outline's layer is on the scan after the load (it used to be cleared away)", st["attached"] and st["visible"], st)
        rect = page.evaluate("(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
        # the middle of the model on screen (the tool box covers the middle of the canvas)
        c = page.evaluate("(() => { const m = window.__view.seg(); m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; const p = m.localToWorld(b.getCenter(b.min.clone())); return window.__view.project(p.x, p.y, p.z); })()")
        cx, cy = rect[0] + (c[0] + 1) / 2 * rect[2], rect[1] + (1 - c[1]) / 2 * rect[3]
        # dot by dot
        page.keyboard.down("Shift")
        for dx in (-90, -30, 40):
            page.mouse.click(cx + dx, cy + 20); time.sleep(0.15)
        page.keyboard.up("Shift")
        st = S()
        check("three Shift-clicks: three dots in the open outline", st["cur"] is not None and len(st["cur"]) == 3, st["cur"])
        check("... and they are on screen: a line and three dots", st["shown"] == 4 and st["attached"], st["shown"])
        page.mouse.click(cx + 100, cy + 20); time.sleep(0.1)
        check("a click without Shift leaves the outline as it was", len(S()["cur"] or []) == 3, S()["cur"])
        page.keyboard.press("Enter"); time.sleep(0.1)
        st = S()
        check("Enter finishes it: one outline traced", st["cur"] is None and len(st["mine"]) == 1 and len(st["mine"][0]) == 3, st)
        page.screenshot(path="/tmp/p1path_clicked.png")
        # drawn: Shift held, one drag across the model
        page.keyboard.down("Shift")
        page.mouse.move(cx - 110, cy + 29); page.mouse.down()
        mid = None
        for k in range(1, 45):
            page.mouse.move(cx - 110 + k * 5, cy + 29 + (4 if 15 < k < 30 else 0)); time.sleep(0.01)
            if k == 22:
                mid = S()
        check("while drawing the line grows under the mouse", mid and mid["cur"] and len(mid["cur"]) >= 4 and mid["shown"] > 6, mid and (mid["cur"] and len(mid["cur"]), mid["shown"]))
        page.mouse.up(); page.keyboard.up("Shift"); time.sleep(0.15)
        st = S()
        check("letting go finishes the drawn outline: two outlines now", st["cur"] is None and len(st["mine"]) == 2, (st["cur"], len(st["mine"])))
        drawn = st["mine"][1] if len(st["mine"]) == 2 else []
        check("the drawn one is a run of many points, none twice in a row", len(drawn) >= 8 and all(a != b for a, b in zip(drawn, drawn[1:])), len(drawn))
        check("the panel says so", "2 cutout outlines traced" in page.text_content("#fixcount"), page.text_content("#fixcount"))
        page.screenshot(path="/tmp/p1path_drawn.png")
        # a short tug is not an outline
        page.keyboard.down("Shift"); page.mouse.move(cx + 120, cy + 22); page.mouse.down(); page.mouse.move(cx + 127, cy + 22); page.mouse.up(); page.keyboard.up("Shift"); time.sleep(0.1)
        check("a drag too short to be a line adds no outline", len(S()["mine"]) == 2 and S()["cur"] is None, S())
        # Backspace takes the last outline back; then it is drawn again
        page.keyboard.press("Backspace"); time.sleep(0.1)
        check("Backspace takes the last outline back", len(S()["mine"]) == 1)
        page.keyboard.down("Shift"); page.mouse.move(cx - 110, cy + 29); page.mouse.down()
        for k in range(1, 45):
            page.mouse.move(cx - 110 + k * 5, cy + 29)
        page.mouse.up(); page.keyboard.up("Shift"); time.sleep(0.15)
        check("drawn again", len(S()["mine"]) == 2)
        # an outline clicked and left open goes with the Apply
        page.keyboard.down("Shift")
        for dx in (-80, 0, 80):
            page.mouse.click(cx + dx, cy + 38); time.sleep(0.12)
        page.keyboard.up("Shift")
        check("a third outline, left open (3 dots)", len(S()["cur"] or []) == 3, S()["cur"])
        page.click("#rerun")
        t0 = time.time()
        while time.time() - t0 < 30 and "params" not in seen:
            time.sleep(0.2)
        runs = (seen.get("params") or {}).get("p1_path_idx") or []
        check("Apply: the server's run gets all three outlines, the open one too", len(runs) == 3 and all(len(r) >= 2 for r in runs), [len(r) for r in runs])
        import urllib.request, json as _json
        t0 = time.time()
        while time.time() - t0 < 30 and srv.JOBS[JID]["status"] != "done":
            time.sleep(0.2)
        kept = _json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/jobs/{JID}/p1dots?scan=0")).get("path") or []
        check("the outlines are kept with the scan", len(kept) == 3, len(kept))
        open_case()
        st = S()
        check("the case re-opened shows them as applied, on screen", len(st["applied"]) == 3 and not st["mine"] and st["shown"] >= 3 and st["attached"], (len(st["applied"]), st["shown"]))
        page.screenshot(path="/tmp/p1path_applied.png")
        check("no page errors", not errors, errors[:3])
        browser.close()
    print("\n" + ("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}"))
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
