"""Label a raw scan per tooth from a Titan export of the same arch (Titan ships every tooth as its own shell).

    python tools/make_ground_truth.py <raw_scan.stl> <titan_export.stl> <out.npz> [--tol 0.3]

The raw scan is registered into the Titan frame (coarse init + robust point-to-surface ICP), then every raw
vertex within `tol` mm of a Titan tooth shell gets that tooth's index (1..N); everything else is 0 (gingiva).
Use the stage-0 ("- 0 -") export when you can; stage 1 is acceptable (teeth moved < 0.25 mm).

Output npz: T (raw->titan 4x4), labels (per vertex of bleachtray.mesh_utils.load_scan(raw)), tooth_centers,
raw_vertices_titan. The labels line up with load_scan(raw).vertices, which is what training uses.
"""
import sys, os, argparse
import numpy as np, trimesh
from trimesh.registration import icp
from trimesh.proximity import ProximityQuery
from trimesh.transformations import rotation_matrix

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bleachtray.mesh_utils import load_scan
from bleachtray.register import robust_icp

BASE_MIN, BASE_MAX = np.array([-23.79, -29.0, 0.0]), np.array([23.78, 3.0, 4.24])


def split_titan(titan):
    """-> (body, teeth) from a Titan export; the Trimlign base and small bits are dropped."""
    parts = sorted(titan.split(only_watertight=False), key=lambda c: -len(c.faces))
    keep = []
    for p in parts:
        if np.allclose(p.bounds[0], BASE_MIN, atol=0.2) and np.allclose(p.bounds[1], BASE_MAX, atol=0.2):
            continue  # the base
        keep.append(p)
    body = keep[0]
    teeth = [p for p in keep[1:] if len(p.faces) > 1000 and p.extents.max() < 16.0]
    return body, teeth


def build(raw_path, titan_path, out_path, tol=0.3, log=print):
    raw = load_scan(raw_path)
    titan = trimesh.load(titan_path, force="mesh")
    body, teeth = split_titan(titan)
    log(f"titan: {len(teeth)} tooth shells, body {len(body.faces)} faces")
    # training surface = gingiva body above the base top + the teeth (skirt/floor excluded)
    bz = body.vertices[:, 2]
    keep_f = (bz[body.faces] > 4.4).all(1) & (np.abs(body.face_normals[:, 2]) > 0.02)
    body_top = body.submesh([np.where(keep_f)[0]], append=True)
    target = trimesh.util.concatenate([body_top] + teeth)
    rng = np.random.default_rng(0)
    src = raw.vertices[rng.choice(len(raw.vertices), min(20000, len(raw.vertices)), replace=False)]
    dst = target.vertices[rng.choice(len(target.vertices), min(40000, len(target.vertices)), replace=False)]
    best = None
    inits = {"I": np.eye(4), "Rz180": rotation_matrix(np.pi, [0, 0, 1]), "Rx180": rotation_matrix(np.pi, [1, 0, 0]),
             "Ry180": rotation_matrix(np.pi, [0, 1, 0]), "Rx90": rotation_matrix(np.pi / 2, [1, 0, 0]),
             "Rx-90": rotation_matrix(-np.pi / 2, [1, 0, 0]), "Rx180Rz180": rotation_matrix(np.pi, [1, 0, 0]) @ rotation_matrix(np.pi, [0, 0, 1])}
    for name, R0 in inits.items():
        s = trimesh.transform_points(src, R0)
        T0 = np.eye(4); T0[:3, 3] = dst.mean(0) - s.mean(0)
        M, _, cost = icp(s, dst, initial=T0, threshold=1e-7, max_iterations=80, reflection=False, scale=False)
        if best is None or cost < best[0]:
            best = (cost, name, M @ R0)
    cost, name, T = best
    log(f"coarse init {name}: cost {cost:.4f}")
    T, med = robust_icp(raw.vertices, target, T, iters=40)
    raw_t = raw.copy(); raw_t.apply_transform(T)
    pq = ProximityQuery(target)
    samp = raw_t.vertices[rng.choice(len(raw_t.vertices), min(8000, len(raw_t.vertices)), replace=False)]
    _, d, _ = pq.on_surface(samp)
    log("residual to Titan surface: median %.3f mm, p90 %.3f mm, inliers<1mm %.1f%%" % (np.median(d), np.percentile(d, 90), 100 * (d < 1).mean()))
    if np.median(d) > 0.25:
        log("WARNING: registration looks poor; check this case")
    V = raw_t.vertices
    labels = np.zeros(len(V), dtype=np.int16)
    best_d = np.full(len(V), np.inf)
    centers = []
    for i, t in enumerate(teeth):
        lo, hi = t.bounds[0] - 1.0, t.bounds[1] + 1.0
        idx = np.where(np.all((V >= lo) & (V <= hi), axis=1))[0]
        centers.append(t.centroid)
        if len(idx) == 0:
            continue
        dd = ProximityQuery(t).vertex(V[idx])[0]
        closer = dd < best_d[idx]
        best_d[idx[closer]] = dd[closer]
        labels[idx[closer]] = i + 1
    labels[best_d > tol] = 0
    counts = np.bincount(labels)
    log(f"labels: {int((labels > 0).sum())} tooth vertices of {len(labels)} ({100 * (labels > 0).mean():.1f}%), teeth sizes {counts[1:].tolist()}")
    np.savez(out_path, T=T, labels=labels, tooth_centers=np.array(centers), raw_vertices_titan=V,
             residual_median=float(np.median(d)), raw=os.path.abspath(raw_path), titan=os.path.abspath(titan_path))
    log(f"saved {out_path}")
    return labels


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("raw"); ap.add_argument("titan"); ap.add_argument("out"); ap.add_argument("--tol", type=float, default=0.3)
    a = ap.parse_args()
    build(a.raw, a.titan, a.out, tol=a.tol)
