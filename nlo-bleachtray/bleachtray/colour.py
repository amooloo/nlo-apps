"""Scanner colour as a second opinion on tooth vs gum.

A scan exported as PLY carries a colour per vertex (AlliedStar, iTero, Medit, 3Shape). Teeth are pale
and nearly grey, gum is pink - but every scanner, light and mouth is different, so no fixed colour
rule works. Instead each scan teaches its own: the vertices the shape model is sure about (tooth
core, gum well away from the teeth) train a small colour classifier for this scan only, and that
classifier then votes in the band along the gum line where the shape model is unsure, and can veto
a patch of gum the shape model took for a tooth. Bad colour (a monochrome export, a scan where the
colour and shape disagree on the confident vertices) is noticed and ignored.
"""
import numpy as np
from .mesh_utils import smooth_field


def colour_features(A, rgb):
    """Per-vertex colour features, lighting-tolerant and a little de-noised across the mesh."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    s = c.sum(1) + 1e-6
    chroma = c / s[:, None]
    mx, mn = c.max(1), c.min(1)
    sat = (mx - mn) / (mx + 1e-6)
    med = np.median(c, 0)
    base = np.column_stack([chroma[:, 0], chroma[:, 1], sat, mx, c[:, 0] - c[:, 2], c[:, 1] - c[:, 2], c - med])
    sm2 = np.column_stack([smooth_field(A, base[:, k], 2) for k in range(base.shape[1])])
    sm6 = np.column_stack([smooth_field(A, base[:, k], 6) for k in range(4)])
    return np.column_stack([base, sm2, sm6])


def refine_with_colour(mesh, A, p_shape, rgb, band_mm=3.0, log=None, rng_seed=0):
    """Return (p_refined, info). p_shape: the shape model's tooth probability per vertex."""
    from .segment import geodesic_dilate
    info = dict(used=False)
    rgb = np.asarray(rgb)
    if rgb is None or len(rgb) != len(p_shape) or rgb.std() < 4:
        info["reason"] = "no usable colour"
        return p_shape, info
    X = colour_features(A, rgb)
    tooth_conf = p_shape > 0.85
    gum_conf = p_shape < 0.15
    if tooth_conf.sum() < 2000 or gum_conf.sum() < 2000:
        info["reason"] = "too few confident vertices"
        return p_shape, info
    rng = np.random.RandomState(rng_seed)
    it = np.where(tooth_conf)[0]; ig = np.where(gum_conf)[0]
    n = min(25000, len(it), len(ig))
    it = rng.choice(it, n, replace=False); ig = rng.choice(ig, n, replace=False)
    idx = np.concatenate([it, ig]); y = np.concatenate([np.ones(n, int), np.zeros(n, int)])
    perm = rng.permutation(len(idx)); idx, y = idx[perm], y[perm]
    k = int(0.8 * len(idx))
    from sklearn.ensemble import HistGradientBoostingClassifier
    # random_state: with >10k samples the booster holds out a random validation set for early stopping,
    # and an unseeded split made the same scan segment a little differently on every run
    clf = HistGradientBoostingClassifier(max_iter=120, learning_rate=0.1, max_leaf_nodes=31, random_state=rng_seed)
    clf.fit(X[idx[:k]], y[:k])
    acc = float((clf.predict(X[idx[k:]]) == y[k:]).mean())
    info["holdout_acc"] = round(acc, 3)
    if acc < 0.93:
        info["reason"] = f"colour and shape disagree on the confident vertices (acc {acc:.2f})"
        if log:
            log(f"colour not used: {info['reason']}")
        return p_shape, info
    clf.fit(X[idx], y)
    p_col = clf.predict_proba(X)[:, 1]
    # the band along the shape model's own boundary: colour and shape vote together there
    mask = p_shape > 0.5
    e = A.tocoo()
    edge = np.zeros(len(mask), bool)
    edge[e.row[mask[e.row] != mask[e.col]]] = True
    near = geodesic_dilate(mesh, A, edge, band_mm)
    p = p_shape.copy()
    p[near] = 0.5 * (p_shape[near] + p_col[near])
    # a patch the shape model called tooth that is plainly gum-coloured (a bit of palate, a flap)
    veto = ~near & (p_col < 0.05) & (p_shape < 0.95) & mask
    p[veto] = np.minimum(p[veto], 0.35)
    changed = int(((p > 0.5) != mask).sum())
    info.update(used=True, band_vertices=int(near.sum()), vetoed=int(veto.sum()), changed=changed)
    if log:
        log(f"colour used: {changed} vertices re-decided along the gum line ({int(veto.sum())} vetoed as gum), colour/shape agreement {acc:.2f}")
    return p, info
