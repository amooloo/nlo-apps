"""Train the tooth/gingiva and interproximal classifiers on all labelled cases.

    python tools/train_eval.py samples/cases.json            # manifest: [{"raw": ..., "gt": ...}, ...]
    python tools/train_eval.py raw1.stl gt1.npz raw2.stl gt2.npz ...

Leave-one-case-out: each case is scored by a model trained on the others (F1 of the smoothed tooth mask and
of the interproximal band), then the final models are fitted on everything and saved to assets/models.joblib.
Features are cached next to each gt file (<gt>.feat.npz) so re-runs are quick.
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np, joblib
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score
from bleachtray.mesh_utils import load_scan, adjacency, smooth_field
from bleachtray.orient import rough_orient
from bleachtray.features import compute_features

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_cases(argv):
    if len(argv) == 1 and argv[0].endswith(".json"):
        return [(c["raw"], c["gt"]) for c in json.load(open(argv[0]))]
    return list(zip(argv[0::2], argv[1::2]))


def case_data(raw_path, gt_path, log=print):
    cache = gt_path + ".feat.npz"
    gt = np.load(gt_path)
    labels = gt["labels"].astype(int)            # -1 = ignore, 0 = gum, 1..N teeth
    # tiny "teeth" (attachment bits, scraps of a cut-off tooth) are not useful as separate labels
    counts = np.bincount(labels[labels >= 0])
    for t in np.where(counts < 300)[0]:
        if t > 0:
            labels[labels == t] = -1
    if os.path.exists(cache):
        c = np.load(cache, allow_pickle=True)
        X, names, A_data = c["X"], list(c["names"]), c["A"]
        import scipy.sparse as sp
        A = sp.csr_matrix((A_data[0], A_data[1].astype(int), A_data[2].astype(int)), shape=(len(labels), len(labels)))
    else:
        t = time.time()
        raw = load_scan(raw_path)
        assert len(labels) == len(raw.vertices), f"{gt_path}: {len(labels)} labels vs {len(raw.vertices)} vertices"
        mesh, _ = rough_orient(raw)
        X, names, aux = compute_features(mesh, return_aux=True)
        A = aux["A"].tocsr()
        np.savez(cache, X=X, names=np.array(names), A=np.array([A.data, A.indices, A.indptr], dtype=object), allow_pickle=True)
        log(f"  features {os.path.basename(raw_path)}: {X.shape} in {time.time() - t:.0f}s")
    # interproximal band: tooth vertices next to a different tooth (2 rings), as before
    e = A.tocoo()
    diff = (labels[e.row] != labels[e.col]) & (labels[e.row] > 0) & (labels[e.col] > 0)
    ip = np.zeros(len(labels), bool); ip[e.row[diff]] = True
    ip = (smooth_field(A, ip.astype(float), 2) > 0.05) & (labels > 0)
    valid = labels >= 0
    return dict(X=X, names=names, A=A, y_tooth=(labels > 0).astype(int), y_ip=ip.astype(int), valid=valid, name=os.path.basename(raw_path))


def fit(X, y, iters=300):
    clf = HistGradientBoostingClassifier(max_iter=iters, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0)
    clf.fit(X, y)
    return clf


def main(argv):
    t0 = time.time()
    cases = [case_data(r, g) for r, g in load_cases(argv)]
    names = cases[0]["names"]
    for c in cases:
        assert c["names"] == names
    print(f"{len(cases)} cases, {sum(len(c['y_tooth']) for c in cases)} vertices")
    # leave-one-case-out
    for target in ("tooth", "ip"):
        scores = []
        for i, c in enumerate(cases):
            Xtr = np.vstack([d["X"][d["valid"]] for j, d in enumerate(cases) if j != i]); ytr = np.concatenate([d["y_" + target][d["valid"]] for j, d in enumerate(cases) if j != i])
            clf = fit(Xtr, ytr, iters=200)
            p = clf.predict_proba(c["X"])[:, 1]
            if target == "tooth":
                pred = (smooth_field(c["A"], p, 4) > 0.5).astype(int)
            else:
                pred = (p > 0.5).astype(int)
            v = c["valid"]
            f1 = f1_score(c["y_" + target][v], pred[v])
            scores.append(f1)
            print(f"  {target:5s} held out {c['name']:28s} F1 {f1:.4f}")
        print(f"{target}: mean held-out F1 {np.mean(scores):.4f}  (min {np.min(scores):.4f})")
    Xall = np.vstack([c["X"][c["valid"]] for c in cases])
    final = {"tooth": fit(Xall, np.concatenate([c["y_tooth"][c["valid"]] for c in cases]), iters=400),
             "interprox": fit(Xall, np.concatenate([c["y_ip"][c["valid"]] for c in cases]), iters=400)}
    out = os.path.join(ROOT, "assets", "models.joblib")
    joblib.dump(dict(models=final, feature_names=names, trained_on=[c["name"] for c in cases]), out)
    print(f"saved {out}  ({time.time() - t0:.0f}s total)")


if __name__ == "__main__":
    main(sys.argv[1:])
