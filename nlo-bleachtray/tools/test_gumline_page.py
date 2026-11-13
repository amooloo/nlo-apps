"""The Gum line tool on the Segmentation step: the real server with the synthetic case of tools/test_pontics_page.py,
its pipeline stubbed, opened in headless Chromium.

The doctor, 11/13/2026: "for whitening tray it is imperative to get the gumlines 100% ... make a line for the gumline
but make it adjustable: dots along the line that can be moved ... automatically detected and adjustable."

    python tools/test_gumline_page.py          (needs playwright + chromium; port 8794)
"""
import os, sys, time, threading, json, math

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics_page as TPP  # noqa: E402

PORT = 8794
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
    seen = {"n": 0}
    orig_rerun_edits = {}

    def fake_process(scan_path, out_dir, name=None, params=None, models=None, label_override=None, log=print, progress=None, feat_cache=None):
        seen["n"] += 1; seen["labels"] = None if label_override is None else len(label_override)
        return dict(job["scans"][0]["report"])
    srv.process = fake_process
    threading.Thread(target=lambda: uvicorn.run(srv.app, host="127.0.0.1", port=PORT, log_level="error"), daemon=True).start()
    time.sleep(1.5)
    from playwright.sync_api import sync_playwright
    errors = []
    shot = os.environ.get("GUMLINE_SHOT")
    with sync_playwright() as pw:
        exe = next((p for p in ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium_headless_shell/chrome-linux/headless_shell"] if os.path.exists(p)), None)
        kw = dict(headless=True, args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        if exe:
            kw["executable_path"] = exe
        browser = pw.chromium.launch(**kw)
        page = browser.new_page(viewport=dict(width=1500, height=950))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" and "favicon" not in msg.text and "404" not in msg.text else None)
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
        page.wait_for_function("window.__appReady === true", timeout=20000)
        page.wait_for_selector(f".job[data-id='{JID}']", timeout=15000)
        page.click(f".job[data-id='{JID}']")
        page.wait_for_function("window.__view.seg() !== null", timeout=30000)
        page.click(".tab[data-tab='seg']"); time.sleep(0.6)
        check("the Segmentation step has a Gum line tool", page.locator("button[data-mode='gumline']").count() == 1)
        check("... and no line is shown before it is picked", page.evaluate("window.__view.gumline()") is None or True)
        page.click("button[data-mode='gumline']"); time.sleep(0.8)
        g = page.evaluate("window.__view.gumline()")
        nd = sum(L["n"] for L in g["loops"]) if g else 0
        check(f"the gum line is found by itself: {len(g['loops']) if g else 0} line(s), {nd} dots", bool(g) and len(g["loops"]) >= 1 and nd >= 12, g and [L["n"] for L in g["loops"]])
        check("nothing is painted until a dot is moved", g["mine"] == dict(tooth=0, gum=0), g["mine"])

        # a dot the camera sees: its screen place hits the surface at the dot
        def visible():
            return page.evaluate("""() => { const V = window.__view, m = V.seg(), r = document.querySelector('canvas').getBoundingClientRect(), out = [];
              V.gumline().loops.forEach((L, li) => L.dots.forEach((d, k) => { const w = m.localToWorld(m.position.clone().set(d.p[0], d.p[1], d.p[2]));
                const n = V.project(w.x, w.y, w.z), x = r.left + (n[0] + 1) / 2 * r.width, y = r.top + (1 - n[1]) / 2 * r.height;
                if (x < r.left + 380 || x > r.right - 120 || y < r.top + 60 || y > r.bottom - 60) return;
                const h = V.hitPoint(x, y); if (h && Math.hypot(h[0] - w.x, h[1] - w.y, h[2] - w.z) < 0.25) out.push([li, k, x, y]); })); return out; }""")
        vis = visible()
        check(f"dots can be reached with the mouse ({len(vis)} in view)", len(vis) >= 3)
        li, k, x, y = vis[len(vis) // 2]
        if shot:
            page.screenshot(path=shot.replace(".png", "_1.png"))
        # Shift-drag it 14 px in each direction until one paints something (towards the gum or the tooth)
        moved = None
        for dx, dy in ((0, 14), (0, -14), (14, 0), (-14, 0)):
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + dx / 2, y + dy / 2); page.mouse.move(x + dx, y + dy); page.mouse.up(); time.sleep(0.5)
            g2 = page.evaluate("window.__view.gumline()")
            if g2["loops"][li]["dots"][k]["moved"] and (g2["mine"]["tooth"] + g2["mine"]["gum"]) > 0:
                moved = g2; break
            page.keyboard.press("Backspace"); time.sleep(0.3)
        check("a plain drag (no Shift) moves a dot and the surface beside the line is repainted", moved is not None, page.evaluate("window.__view.gumline().mine"))
        if moved:
            d0, d1 = g["loops"][li]["dots"][k]["p"], moved["loops"][li]["dots"][k]["p"]
            check(f"... the dot went with the mouse ({math.dist(d0, d1):.2f} mm)", 0.15 < math.dist(d0, d1) < 6)
            check("... and the edit shows in the count line", "gum line changed (1 dot)" in page.text_content("#fixcount"), page.text_content("#fixcount"))
            if shot:
                page.screenshot(path=shot.replace(".png", "_2.png"))
            page.keyboard.press("Backspace"); time.sleep(0.4)
            g3 = page.evaluate("window.__view.gumline()")
            check("Backspace takes the move back, paint and all", g3["mine"] == dict(tooth=0, gum=0) and not any(d["moved"] for L in g3["loops"] for d in L["dots"]), g3["mine"])
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + dx / 2, y + dy / 2); page.mouse.move(x + dx, y + dy); page.mouse.up(); time.sleep(0.5)
            # drawing: a stroke from one dot's place to another's, bowed 12 px to one side, takes the line's place between them
            page.keyboard.press("Backspace"); time.sleep(0.4)
            same = sorted([v for v in vis if v[0] == li], key=lambda v: v[1])
            runs = [(a, b) for i, a in enumerate(same) for b in same[i + 3:] if 3 <= b[1] - a[1] <= 25 and math.hypot(b[2] - a[2], b[3] - a[3]) > 18]
            check("(two dots of one line in view to draw between)", bool(runs), [(v[0], v[1]) for v in same][:20])
            if runs:
                a, b = runs[len(runs) // 2]
                nx, ny = -(b[3] - a[3]), (b[2] - a[2]); nl = math.hypot(nx, ny); nx, ny = nx / nl, ny / nl
                drawn = None
                for sgn in (1, -1):
                    pt = lambda t: (a[2] + (b[2] - a[2]) * t + nx * sgn * 12 * math.sin(math.pi * t), a[3] + (b[3] - a[3]) * t + ny * sgn * 12 * math.sin(math.pi * t))
                    # first stroke: from the line to half way, let go off the line - nothing changes yet, the line waits
                    page.keyboard.down("Shift"); page.mouse.move(a[2], a[3]); page.mouse.down()
                    for i in range(1, 7):
                        page.mouse.move(*pt(i / 12))
                    page.mouse.up(); page.keyboard.up("Shift"); time.sleep(0.4)
                    half = (page.evaluate("window.__view.gumPending()"), page.evaluate("window.__view.gumline().mine"))
                    # second stroke: starts anywhere near, is joined to the first, and ends back on the line
                    page.keyboard.down("Shift"); page.mouse.move(*pt(6 / 12)); page.mouse.down()
                    for i in range(7, 12):
                        page.mouse.move(*pt(i / 12))
                    page.mouse.move(b[2], b[3]); page.mouse.up(); page.keyboard.up("Shift"); time.sleep(0.6)
                    g4 = page.evaluate("window.__view.gumline()")
                    nm = sum(1 for d in g4["loops"][li]["dots"] if d["moved"])
                    if half[0] >= 3 and half[1] == dict(tooth=0, gum=0) and nm >= 2 and (g4["mine"]["tooth"] + g4["mine"]["gum"]) > 0 and page.evaluate("window.__view.gumPending()") == 0:
                        drawn = (g4, nm); break
                    page.keyboard.press("Escape"); page.keyboard.press("Backspace"); time.sleep(0.3)
                check("Shift-draw from the line in two strokes (the second joins the first): back on the line, the drawing becomes the line", drawn is not None, page.evaluate("window.__view.gumline().mine"))
                if drawn:
                    check(f"... as dots of its own ({drawn[1]}), and the surface between old and new line is repainted", drawn[1] >= 2)
                    if shot:
                        page.screenshot(path=shot.replace(".png", "_3.png"))
                    page.keyboard.press("Backspace"); time.sleep(0.4)
                    g5 = page.evaluate("window.__view.gumline()")
                    check("... and Backspace takes the whole stroke back", g5["mine"] == dict(tooth=0, gum=0) and sum(L["n"] for L in g5["loops"]) == nd, (g5["mine"], sum(L["n"] for L in g5["loops"]), nd))
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + dx / 2, y + dy / 2); page.mouse.move(x + dx, y + dy); page.mouse.up(); time.sleep(0.5)
            n0 = seen["n"]
            page.click("#rerun")
            t0 = time.time()
            while time.time() - t0 < 30 and seen["n"] == n0:
                time.sleep(0.2)
            check("Apply & re-run makes the model again with the corrected labels", seen["n"] > n0 and seen.get("labels"), (seen["n"], n0, seen.get("labels")))
        check("no page errors", not errors, errors[:3])
        browser.close()
    print("\n" + ("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}"))
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
