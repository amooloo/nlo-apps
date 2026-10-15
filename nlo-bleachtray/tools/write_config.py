"""Used by install.bat: write watch_config.json for the watcher. Usage: write_config.py <inbox> <titan>"""
import json, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
inbox, titan = sys.argv[1], sys.argv[2]
cfg = dict(inbox=inbox, titan=titan, preset="both", kind="T", stage=0, doctor="Dr. Amir Akhavan", pair_wait=45)
with open(os.path.join(root, "watch_config.json"), "w") as f:
    json.dump(cfg, f, indent=2)
print("settings saved")
