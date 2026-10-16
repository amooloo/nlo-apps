"""Pack the starting training set into assets/base_training.npz: per arch the per-vertex FEATURES (not the scan),
up to 60k sampled rows, with the tooth / interproximal targets. No geometry, no names - just numbers the model
learns from - so it can ship with the app and 'Retrain now' works out of the box.

    python tools/make_base_pack.py cases.json   (same manifest as train_eval.py)
"""
import sys, os, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.train_eval import case_data, load_cases

ROWS = 60_000
rng = np.random.default_rng(0)
out = {}
for i, (raw, gt) in enumerate(load_cases(sys.argv[1:])):
    c = case_data(raw, gt)
    idx = np.where(c["valid"])[0]
    if len(idx) > ROWS:
        idx = np.sort(rng.choice(idx, ROWS, replace=False))
    arch = "lower" if "lower" in os.path.basename(raw) else "upper"
    k = f"base{i + 1:02d}_{arch}"
    out[k + "_X"] = c["X"][idx].astype(np.float16)
    out[k + "_tooth"] = c["y_tooth"][idx].astype(np.int8)
    out[k + "_ip"] = c["y_ip"][idx].astype(np.int8)
    print(k, len(idx), "rows")
    names = c["names"]
out["feature_names"] = np.array(names)
p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "base_training.npz")
np.savez_compressed(p, **out)
print("saved", p, round(os.path.getsize(p) / 1e6, 1), "MB")
