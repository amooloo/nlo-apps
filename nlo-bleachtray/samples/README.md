Training data lives here on the lab computer only (patient scans are never committed).

- `upper_raw.stl` + `gt_upper.npz` — the first training case (raw scan + per-vertex tooth labels taken from Titan's segmented export).
- Add more with `python tools/make_ground_truth.py` (edit the paths at the top) and retrain with `python tools/train_eval.py`.
