"""Start the NLO TAD Guide app on this computer and open it in the browser.

    python run_app.py            # http://127.0.0.1:8767
    python run_app.py --lan      # also reachable from other office computers on port 8767

Everything runs on this PC: the CBCT, the scan and the plan never leave the office network.
"""
import sys, os, threading, webbrowser, time

# A light load on a shared PC: heavy steps use half the cores, and the process runs at low priority so the
# PC stays responsive (the Trimlign, Jump Desktop and the browser come first). Same as Tray Maker.
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

PORT = 8767


def _guard():
    """Friendly message when double-clicked before setup (missing components)."""
    import importlib.util
    need = ("numpy", "scipy", "trimesh", "skimage", "pydicom", "fastapi", "uvicorn")
    missing = [m for m in need if importlib.util.find_spec(m) is None]
    if missing:
        print()
        print("  NLO TAD Guide is not set up on this computer yet.")
        print("  Missing components:", ", ".join(missing))
        print()
        print("  Double-click  install.bat  in this folder and follow the window. Then use start_app.bat.")
        print()
        try:
            input("  Press Enter to close this window.")
        except EOFError:
            pass
        sys.exit(1)


def _wait_for_port(host, seconds=40):
    """True once the port is free. Right after an update the old copy may still be letting go of it."""
    import socket
    for i in range(seconds):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if os.name != "nt":
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, PORT))
            s.close()
            return True
        except OSError:
            s.close()
            if i == 0:
                print(f"  Port {PORT} is still in use (the previous copy of the app is shutting down) - waiting...")
            time.sleep(1)
    return False


if __name__ == "__main__":
    _guard()
    import socket
    import uvicorn
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)
    sys.path.insert(0, here)
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    print(f"  NLO TAD Guide - browser app on this PC: http://127.0.0.1:{PORT}")
    if host == "0.0.0.0":
        print(f"  Other office computers:  http://{socket.gethostname()}:{PORT}")
    print("  Patient CBCTs and scans stay on this PC (folder 'jobs'); nothing is sent anywhere.")
    if not _wait_for_port(host):
        print("")
        print("  Another copy of the app is already running on this PC (look for a window called 'NLO TAD Guide').")
        print("  Nothing to do - that copy serves the app. This window can be closed.")
        sys.exit(0)
    if "--no-browser" not in sys.argv:
        threading.Thread(target=lambda: (time.sleep(1.5), webbrowser.open(f"http://127.0.0.1:{PORT}")), daemon=True).start()
    uvicorn.run("app.server:app", host=host, port=PORT, log_level="warning")
