"""Start the NLO Bleach Tray app on this computer and open it in the browser.

    python run_app.py            # http://127.0.0.1:8765
    python run_app.py --lan      # also reachable from other office computers on port 8765
"""
import sys, threading, webbrowser, time
def _guard():
    """Friendly message when double-clicked before setup (missing components)."""
    import importlib.util, os, sys
    missing = [m for m in ("numpy", "trimesh", "shapely", "manifold3d", "sklearn", "fastapi", "uvicorn") if importlib.util.find_spec(m) is None]
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "trimlign_base_manifold.ply")
    if missing or not os.path.exists(base):
        print()
        print("  NLO Bleach Tray is not set up on this computer yet.")
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


if __name__ == "__main__":
    threading.Thread(target=_open, daemon=True).start()
    uvicorn.run("app.server:app", host=host, port=port, log_level="warning")
