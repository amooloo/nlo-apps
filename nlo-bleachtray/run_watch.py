"""Zero-click mode: drop scanner STLs into an inbox folder, finished OrthoFactory orders appear.

    python run_watch.py --inbox "S:\\clinical\\3D printing\\BleachTray" --titan "S:\\clinical\\3D printing\\Titan"

Options are remembered in watch_config.json next to this file, so after the first run plain
`python run_watch.py` is enough. Other options: --preset bleaching|bleaching_3_3|aligner_high|plain_model
--kind T|A --stage N --doctor "Dr. ..." --pair-wait SECONDS (how long to wait for the second arch).
"""
import os, sys, json, argparse, datetime

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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CFG_PATH = os.path.join(HERE, "watch_config.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inbox"); ap.add_argument("--titan"); ap.add_argument("--preset")
    ap.add_argument("--kind"); ap.add_argument("--stage", type=int); ap.add_argument("--doctor")
    ap.add_argument("--pair-wait", type=int, dest="pair_wait")
    args = vars(ap.parse_args())
    cfg = {}
    if os.path.exists(CFG_PATH):
        cfg = json.load(open(CFG_PATH))
    cfg.update({k: v for k, v in args.items() if v is not None})
    if not cfg.get("inbox"):
        print("Tell me where the inbox is:  python run_watch.py --inbox <folder> --titan <OrthoFactory input folder>")
        sys.exit(1)
    json.dump(cfg, open(CFG_PATH, "w"), indent=2)
    os.makedirs(cfg["inbox"], exist_ok=True)
    logf = open(os.path.join(cfg["inbox"], "bleachtray.log"), "a", encoding="utf-8")

    def log(msg):
        line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
        print(line, flush=True); logf.write(line + "\n"); logf.flush()

    from bleachtray.watch import Watcher
    Watcher(cfg, log=log).run_forever()


if __name__ == "__main__":
    main()
