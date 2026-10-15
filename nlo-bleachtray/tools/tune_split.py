"""Sweep erosion distance for the per-tooth split and score against GT tooth ids."""
import sys
sys.path.insert(0, ".")
import numpy as np
from sklearn.metrics import adjusted_rand_score
from bleachtray.mesh_utils import load_scan, smooth_field
from bleachtray.orient import rough_orient
from bleachtray.segment import predict_tooth_prob, clean_mask, split_teeth, merge_small_teeth

raw = load_scan("samples/upper_raw.stl")
gt = np.load("samples/gt_upper.npz")
mesh, T = rough_orient(raw)
p_tooth, p_ip, aux = predict_tooth_prob(mesh)
A = aux["A"]
mask = clean_mask(smooth_field(A, p_tooth, 4) > 0.5, A)
gtl = gt["labels"]
both = mask & (gtl > 0)
for erode in [1.5, 2.0, 2.5, 3.0, 3.5]:
    for cut in [-9, -0.6, -0.3]:
        labels, _ = split_teeth(mesh, mask, p_ip, A, aux, erode_mm=erode, concave_cut=cut)
        labels = merge_small_teeth(mesh, labels, A)
        n = len(np.unique(labels[labels > 0]))
        ari = adjusted_rand_score(gtl[both], labels[both])
        # per GT tooth: purity of the dominant predicted label
        pur = []
        for g in np.unique(gtl[both]):
            m = both & (gtl == g)
            pl = labels[m]
            pur.append(np.bincount(pl).max() / len(pl))
        print(f"erode={erode} cut={cut:5}: teeth={n:2d}  ARI={ari:.3f}  mean purity={np.mean(pur):.3f}  min purity={np.min(pur):.3f}")
