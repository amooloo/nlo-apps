"""The Seal groove card in Settings (a test option, off by default): the real server opened in headless Chromium.

The doctor, 11/19/2026: "would it theoretically get a better seal if you add a bit of indentation into the model around
the edges of the reservoir?" ... "yes, add that option". Off: nothing is sent as on. On: the whitening tray's settings
carry reservoir_groove with its width and depth, the Settings summary says so, and it is remembered. No page errors.

    python tools/test_seal_groove_page.py          (needs playwright + chromium; port 8797)
"""
import os, sys, time, threading

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
os.environ.setdefault("NLO_WORKERS", "1")
import test_pontics_page as TPP  # noqa: E402

PORT = 8797
fails = []


def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
    if not ok:
        fails.append(name)


def main():
    import app.server as srv
    import uvicorn
    TPP.make_case(srv)
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
        ctx = browser.new_context(viewport=dict(width=1400, height=900))
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda msg: errors.append(f"console.{msg.type}: {msg.text}") if msg.type == "error" and "favicon" not in msg.text and "404" not in msg.text else None)
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
        page.wait_for_function("window.__appReady === true", timeout=20000)
        st = page.evaluate("() => ({v: document.getElementById('res_groove').value, w: document.getElementById('res_groove_w').value, d: document.getElementById('res_groove_d').value, wt: window.__view.params().wt, tt: window.__view.params().tt})")
        check("the card is there, Off by default, 0.5 mm wide and 0.25 mm deep", st["v"] == "0" and float(st["w"]) == 0.5 and float(st["d"]) == 0.25, st)
        check("off: the whitening tray is sent without a groove", st["wt"].get("reservoir_groove") is False, st["wt"])
        check("a retainer never gets one", "reservoir_groove" not in st["tt"], st["tt"])
        page.evaluate("() => { const e = document.getElementById('res_groove'); e.value = '1'; e.dispatchEvent(new Event('change', {bubbles: true})); e.dispatchEvent(new Event('input', {bubbles: true})); const w = document.getElementById('res_groove_w'); w.value = '0.6'; w.dispatchEvent(new Event('change', {bubbles: true})); w.dispatchEvent(new Event('input', {bubbles: true})); if (typeof saveSettings === 'function') saveSettings(); if (typeof summarizeSettings === 'function') summarizeSettings(); }")
        st = page.evaluate("() => ({wt: window.__view.params().wt, sum: document.getElementById('setsum').textContent, saved: localStorage.getItem('nlo.bleachtray.settings')})")
        check("on: sent with its width and depth", st["wt"].get("reservoir_groove") is True and st["wt"].get("reservoir_groove_width") == 0.6 and st["wt"].get("reservoir_groove_depth") == 0.25, st["wt"])
        check("on: the Settings summary says so", "seal groove ON" in (st["sum"] or ""), st["sum"])
        check("on: remembered", '"res_groove":"1"' in (st["saved"] or ""), (st["saved"] or "")[:200])
        page.reload(wait_until="load"); page.wait_for_function("window.__appReady === true", timeout=20000)
        st = page.evaluate("() => ({v: document.getElementById('res_groove').value, w: document.getElementById('res_groove_w').value})")
        check("after a reload it is still on (until switched off)", st["v"] == "1" and float(st["w"]) == 0.6, st)
        page.evaluate("() => document.getElementById('setDefaults').click()")
        st = page.evaluate("() => ({v: document.getElementById('res_groove').value, wt: window.__view.params().wt})")
        check("Defaults switches it off again", st["v"] == "0" and st["wt"].get("reservoir_groove") is False, st)
        check("no page errors", not errors, errors[:3])
        browser.close()
    print("\nALL OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
    os._exit(1 if fails else 0)


if __name__ == "__main__":
    main()
