"""Start the NLO Bleach Tray app on this computer and open it in the browser.

    python run_app.py            # http://127.0.0.1:8765
    python run_app.py --lan      # also reachable from other office computers on port 8765
"""
import sys, threading, webbrowser, time
import uvicorn

host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
port = 8765


def _open():
    time.sleep(1.5)
    webbrowser.open(f"http://127.0.0.1:{port}")


if __name__ == "__main__":
    threading.Thread(target=_open, daemon=True).start()
    uvicorn.run("app.server:app", host=host, port=port, log_level="warning")
