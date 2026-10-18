"""Start the NLO Tray Maker app on this computer and open it in the browser.

    python run_app.py            # http://127.0.0.1:8765
    python run_app.py --lan      # also reachable from other office computers on port 8765
"""
import sys, os, threading, webbrowser, time

# Be a light load on the lab PC: processing uses half the cores (numpy / scikit-learn / manifold
# thread pools read these before they start), and the whole process runs at low priority so the
# PC stays responsive - the Trimlign, Jump Desktop and the browser come first.
_half = max(1, (os.cpu_count() or 2) // 2)
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_v, str(_half))
if os.name == "nt":
    try:
        import ctypes
        _k = ctypes.windll.kernel32
        _k.SetPriorityClass(_k.GetCurrentProcess(), 0x4000)          # BELOW_NORMAL_PRIORITY_CLASS
    except Exception:
        pass


def _guard():
    """Friendly message when double-clicked before setup (missing components)."""
    import importlib.util, os, sys
    missing = [m for m in ("numpy", "trimesh", "shapely", "manifold3d", "sklearn", "fastapi", "uvicorn") if importlib.util.find_spec(m) is None]
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "trimlign_base_manifold.ply")
    if missing or not os.path.exists(base):
        print()
        print("  NLO Tray Maker is not set up on this computer yet.")
        if missing:
            print("  Missing components:", ", ".join(missing))
        if not os.path.exists(base):
            print("  The Trimlign base has not been imported yet.")
        print()
        print("  Double-click  install.bat  in this folder and follow the window. Then use start_watch.bat or start_app.bat.")
        print()
        try:
            input("  Press Enter to close this window.")
        except EOFError:
            pass
        sys.exit(1)


_guard()

import uvicorn

host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
port = 8765


def _open():
    time.sleep(1.5)
    webbrowser.open(f"http://127.0.0.1:{port}")


def _start_watcher():
    """If setup created watch_config.json, run the folder watcher inside this process too, so one
    autostarted window both watches the drop folder and serves the browser app to the office."""
    import os, json, datetime
    here = os.path.dirname(os.path.abspath(__file__))
    cfg_path = os.path.join(here, "watch_config.json")
    if not os.path.exists(cfg_path):
        print("  (no watch_config.json - folder watching is off; run install.bat to set it up)")
        return
    cfg = json.load(open(cfg_path))
    if not cfg.get("inbox"):
        return
    # a drop folder this PC cannot see (the share on another drive letter, the server off) must not take
    # the browser app down with it: say so and serve without the watcher
    try:
        os.makedirs(cfg["inbox"], exist_ok=True)
        logf = open(os.path.join(cfg["inbox"], "bleachtray.log"), "a", encoding="utf-8")
    except OSError as ex:
        print(f"  Drop folder {cfg['inbox']} is not reachable from this PC ({ex}) - folder watching is off.")
        print("  Fix the folder in watch_config.json (the office share may be on another drive letter here) and restart the app.")
        return

    def log(msg):
        line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
        print(line, flush=True); logf.write(line + "\n"); logf.flush()

    sys.path.insert(0, here)
    from bleachtray.watch import Watcher
    import app.server as srv   # same module uvicorn serves (single process), so cases land in its job list

    def on_result(ent, work, results):
        srv.register_watcher_result(ent, work, results, log=log)
    threading.Thread(target=Watcher(cfg, log=log, on_result=on_result).run_forever, daemon=True).start()


def _wait_for_port(seconds=40):
    """True once port is free. Right after an update the old copy may still be letting go of it;
    a second copy started by hand while one is already running never gets it."""
    import socket
    for i in range(seconds):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if os.name != "nt":   # Linux/mac: a port in TIME_WAIT is not "in use" (Windows handles that itself)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, port))
            s.close()
            return True
        except OSError:
            s.close()
            if i == 0:
                print(f"  Port {port} is still in use (the previous copy of the app is shutting down) - waiting...")
            time.sleep(1)
    return False


if __name__ == "__main__":
    import socket
    print(f"  NLO Tray Maker - browser app on this PC: http://127.0.0.1:{port}")
    if host == "0.0.0.0":
        print(f"  Other office computers:  http://{socket.gethostname()}:{port}")
    if not _wait_for_port():
        print("")
        print("  Another copy of the app is already running on this PC (look for a window called 'NLO Tray Maker').")
        print("  Nothing to do - that copy serves the app. This window can be closed.")
        print("  (If no such window exists, restart the PC, or run update again.)")
        sys.exit(0)
    _start_watcher()
    if "--no-browser" not in sys.argv:
        threading.Thread(target=_open, daemon=True).start()
    uvicorn.run("app.server:app", host=host, port=port, log_level="warning")
