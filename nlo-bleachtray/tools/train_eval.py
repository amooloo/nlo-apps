"""Train tooth/gingiva and interproximal-boundary classifiers on the ground-truth scan.

Spatial hold-out: train on x<0 half, test on x>0 half (and vice-versa) to get an honest score,
then fit the final models on everything and save to assets/models.joblib.
"""
import sys, time
sys.path.insert(0, ".")
import numpy as np, trimesh, joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score, accuracy_score
from bleachtray.mesh_utils import load_scan, adjacency, smooth_field
from bleachtray.orient import rough_orient
from bleachtray.features import compute_features

t0 = time.time()
raw = load_scan("samples/upper_raw.stl")
gt = np.load("samples/gt_upper.npz")
labels = gt["labels"]
assert len(labels) == len(raw.vertices), (len(labels), len(raw.vertices))
mesh, T = rough_orient(raw)
X, names, aux = compute_features(mesh, return_aux=True)
print("features:", X.shape, "in %.1fs" % (time.time() - t0))
y_tooth = (labels > 0).astype(int)

# interproximal boundary label: tooth vertex with a neighbour of a different tooth label (within 2 rings)
A = aux["A"]
e = A.tocoo()
diff = (labels[e.row] != labels[e.col]) & (labels[e.row] > 0) & (labels[e.col] > 0)
ip = np.zeros(len(labels), bool)
ip[e.row[diff]] = True
ip = smooth_field(A, ip.astype(float), 2) > 0.05
ip &= labels > 0
print("interproximal positives:", ip.sum())

x = mesh.vertices[:, 0]
for name, y in [("tooth", y_tooth), ("interprox", ip.astype(int))]:
    scores = []
    for side in [-1, 1]:
        tr = (x * side) < 0
        te = ~tr
        clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0)
        clf.fit(X[tr], y[tr])
        p_all = clf.predict_proba(X)[:, 1]
        pred_all = (smooth_field(A, p_all, 4) > 0.5).astype(int)  # same smoothing as inference
        pred, pred_raw = pred_all[te], (p_all[te] > 0.5).astype(int)
        f1 = f1_score(y[te], pred); f1r = f1_score(y[te], pred_raw); acc = accuracy_score(y[te], pred)
        scores.append(f1)
        print(f"  {name}: train side {side:+d} -> test F1 {f1:.4f} (unsmoothed {f1r:.4f}), acc {acc:.4f}")
    print(f"{name} mean held-out F1: {np.mean(scores):.4f}")

final = {}
for name, y in [("tooth", y_tooth), ("interprox", ip.astype(int))]:
    clf = HistGradientBoostingClassifier(max_iter=400, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0)
    clf.fit(X, y)
    final[name] = clf
joblib.dump(dict(models=final, feature_names=names), "assets/models.joblib")
print("saved assets/models.joblib  (%.1fs total)" % (time.time() - t0))
