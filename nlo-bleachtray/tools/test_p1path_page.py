"""End-to-end check of the Phase I tab's Cutout outline: the real server (app/server.py) with the synthetic case of
tools/test_pontics_page.py made a Phase I case (its two crowns on opposite sides), opened in headless Chromium.

Why it exists (11/10/2026): the outline's dots and line were counted but never shown - loading a scan cleared the
segmentation group and the outline's layer was not put back. Then the doctor asked for the outline to be a curve he can
shape ("vector like"), for a clear end to a side (it "kept jumping to the other side"), and to delete one dot at a time.

Drives the page the way the staff would: Shift-clicks dots on one side (a curve through them, on screen), then on the
other side (a second outline of its own - the first is untouched); deletes one dot with a Shift-click on it; drags a dot
(the curve's run changes); puts a dot in between with a Shift-click on the curve; Backspace and Undo last dot take one
dot each; Clear and Undo clear; a freehand Shift-drag becomes a few dots; Apply sends one run per side and the server
keeps them; the case re-opened shows them pale, a Shift-click on one makes it dots again and Apply replaces it. No page
errors allowed.

    python tools/test_p1path_page.py          (needs playwright + chromium; port 8798)
"""
import os, sys, time, threading, json, urllib.request

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
    for sc in job["scans"]:                      # a Phase I case: the tab is on for it; its two crowns on opposite sides
        sc["tag"] = "P1"; sc["preset"] = "phase1"
        sc["report"]["teeth"] = {1: dict(side=1, position=4), 2: dict(side=-1, position=4)}
    job["preset"] = "phase1"
    seen = {"n": 0}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["params"] = dict(params or {}); seen["n"] += 1
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
        page.on("console", lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" and "favicon" not in msg.text and "404" not in msg.text else None)

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
        st = S()
        check("the outline's layer is on the scan after the load (it used to be cleared away)", st["attached"] and st["visible"], st)
        rect = page.evaluate("(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
        # the middle of the model on screen (the tool box covers the middle of the canvas)
        c = page.evaluate("(() => { const m = window.__view.seg(); m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; const p = m.localToWorld(b.getCenter(b.min.clone())); return window.__view.project(p.x, p.y, p.z); })()")
        cx, cy = rect[0] + (c[0] + 1) / 2 * rect[2], rect[1] + (1 - c[1]) / 2 * rect[3]
        px = lambda d: (rect[0] + (d[0] + 1) / 2 * rect[2], rect[1] + (1 - d[1]) / 2 * rect[3])

        def sclick(x, y):
            page.keyboard.down("Shift"); page.mouse.click(x, y); page.keyboard.up("Shift"); time.sleep(0.15)

        def sdrag(pts):
            page.keyboard.down("Shift"); page.mouse.move(*pts[0]); page.mouse.down()
            for q in pts[1:]:
                page.mouse.move(*q); time.sleep(0.01)
            page.mouse.up(); page.keyboard.up("Shift"); time.sleep(0.15)
        # --- one side, dot by dot
        for dx in (-130, -95, -60):
            sclick(cx + dx, cy + 20)
        st = S(); sides = list(st["ctrl"].keys())
        check("three Shift-clicks on one side: one outline of three dots", len(sides) == 1 and len(st["ctrl"][sides[0]]) == 3, {k: len(v) for k, v in st["ctrl"].items()})
        A = sides[0] if sides else "?"
        check("... on screen: the curve and three dots", st["shown"] == 4 and st["attached"], st["shown"])
        check("... and it is one run for Apply already - nothing to finish", len(st["mine"]) == 1 and len(st["mine"][0]) >= 8, [len(r) for r in st["mine"]])
        page.mouse.click(cx - 80, cy + 30); time.sleep(0.1)
        check("a click without Shift adds nothing", len(S()["ctrl"][A]) == 3)
        # --- the other side is its own outline
        for dx in (60, 110):
            sclick(cx + dx, cy + 36)       # (clear of the crown: the curve between them lies on the flat)
        st = S(); B = next((k for k in st["ctrl"] if k != A), None)
        check("dots clicked on the other side start that side's own outline - the first one is left alone", B is not None and len(st["ctrl"][A]) == 3 and len(st["ctrl"][B]) == 2 and {A, B} == {"R", "L"}, {k: len(v) for k, v in st["ctrl"].items()})
        check("two runs for Apply, one per side", len(st["mine"]) == 2, len(st["mine"]))
        check("the panel names the sides and the colours", all(w in page.text_content("#fixcount") for w in ("Right: ", "Left: ", "amber = start, blue = end")), page.text_content("#fixcount"))
        page.screenshot(path="/tmp/p1path_two_sides.png")
        # --- bend: drag a dot
        run0 = [r for r in st["mine"]]
        d1 = px(st["dots"][A][1])
        sdrag([d1, (d1[0], d1[1] + 6), (d1[0], d1[1] + 14), (d1[0], d1[1] + 20)])
        st = S()
        check("Shift-drag a dot: it moves (still three dots), the curve bends with it", len(st["ctrl"][A]) == 3 and abs(px(st["dots"][A][1])[1] - (d1[1] + 20)) < 4 and st["mine"] != run0, (px(st["dots"][A][1]), d1))
        # --- a dot in between: a click on the curve
        b0, b1 = px(st["dots"][B][0]), px(st["dots"][B][1])
        sclick((b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2)
        st = S(); nb = [px(d) for d in st["dots"][B]]
        check("Shift-click on the curve: a dot in between (the ends stay the ends)", len(nb) == 3 and abs(nb[0][0] - b0[0]) < 2 and abs(nb[2][0] - b1[0]) < 2 and b0[0] < nb[1][0] < b1[0], nb)
        # --- one dot at a time
        sclick(*px(st["dots"][A][1]))
        st = S()
        check("Shift-click on a dot deletes that one dot only", len(st["ctrl"][A]) == 2 and len(st["ctrl"][B]) == 3, {k: len(v) for k, v in st["ctrl"].items()})
        sclick(cx + 150, cy + 30)                      # a fourth dot on side B, then take it back
        check("a dot at the end of side B", len(S()["ctrl"][B]) == 4)
        page.keyboard.press("Backspace"); time.sleep(0.1)
        check("Backspace takes the last dot back - one dot, not the outline", len(S()["ctrl"][B]) == 3 and len(S()["ctrl"][A]) == 2)
        page.click("#p1undo"); time.sleep(0.1)
        check("Undo last dot takes one more", len(S()["ctrl"][B]) == 2 and len(S()["ctrl"][A]) == 2)
        # --- Clear, and its Undo
        page.click("#clearfix"); time.sleep(0.1); page.click("#clearfix"); time.sleep(0.15)
        check("Clear (asked twice) takes every dot away", not S()["ctrl"] and not S()["mine"], S()["ctrl"])
        page.click("#clearfix"); time.sleep(0.15)
        st = S()
        check("Undo clear brings them back", len(st["ctrl"].get(A, [])) == 2 and len(st["ctrl"].get(B, [])) == 2 and len(st["mine"]) == 2, {k: len(v) for k, v in st["ctrl"].items()})
        # --- freehand: a stroke becomes a few dots
        page.click("#clearfix"); time.sleep(0.1); page.click("#clearfix"); time.sleep(0.15)
        sdrag([(cx - 135 + k * 3, cy + 22 + (10 if 10 < k < 20 else 0)) for k in range(0, 30)])
        st = S()
        n_free = len(st["ctrl"].get(A, []))
        check("a freehand Shift-drag becomes a handful of dots to adjust", 2 <= n_free <= 12 and len(st["mine"]) == 1, n_free)
        for dx in (60, 110):
            sclick(cx + dx, cy + 36)       # (clear of the crown: the curve between them lies on the flat)
        page.screenshot(path="/tmp/p1path_drawn.png")
        # --- Apply
        page.click("#rerun")
        t0 = time.time()
        while time.time() - t0 < 30 and "params" not in seen:
            time.sleep(0.2)
        runs = (seen.get("params") or {}).get("p1_path_idx") or []
        check("Apply: the server's run gets one run per side", len(runs) == 2 and all(len(r) >= 2 for r in runs), [len(r) for r in runs])
        t0 = time.time()
        while time.time() - t0 < 30 and srv.JOBS[JID]["status"] != "done":
            time.sleep(0.2)
        kept = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/jobs/{JID}/p1dots?scan=0")).get("path") or []
        check("the outlines are kept with the scan", len(kept) == 2, len(kept))
        open_case()
        st = S()
        check("the case re-opened shows them pale (applied), no dots of mine", len(st["applied"]) == 2 and not st["ctrl"] and not st["mine"] and st["shown"] == 6 and st["attached"], (len(st["applied"]), st["shown"], st["ctrl"]))
        # --- an applied outline is taken up again by a click on its side
        sclick(cx + 150, cy + 30)
        st = S()
        check("a Shift-click on a side with an applied outline: it is dots again, with the new one at its end; the other side stays applied",
              len(st["gone"]) == 1 and list(st["ctrl"].keys()) == [B] and len(st["ctrl"][B]) >= 3 and len(st["mine"]) == 2, (st["gone"], {k: len(v) for k, v in st["ctrl"].items()}, len(st["mine"])))
        n0 = seen["n"]; seen.pop("params", None)
        page.click("#rerun")
        t0 = time.time()
        while time.time() - t0 < 30 and seen["n"] == n0:
            time.sleep(0.2)
        runs2 = (seen.get("params") or {}).get("p1_path_idx") or []
        check("Apply again: still two runs - the changed side replaced, the other as it was", len(runs2) == 2 and sum(1 for r in runs2 if r in kept) == 1, [len(r) for r in runs2])
        check("no page errors", not errors, errors[:3])
        browser.close()
    print("\n" + ("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}"))
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
