"""Register the raw upper scan into the Titan v3 frame and label its vertices per tooth.

Outputs samples/gt_upper.npz with:
  T           4x4 raw->titan transform
  labels      per-raw-vertex int: 0 = gingiva/other, 1..N = tooth index (ordered later)
  tooth_centers  (N,3) centers of Titan tooth shells in the Titan frame
  trimline    Titan trimline (M,3) in Titan frame
"""
import numpy as np, trimesh
from trimesh.registration import icp
from trimesh.proximity import ProximityQuery
from trimesh.transformations import rotation_matrix

raw = trimesh.load("samples/upper_raw.stl", force="mesh")
v3 = trimesh.load("samples/maxilla_v3.stl", force="mesh")
parts = sorted(v3.split(only_watertight=False), key=lambda c: -len(c.faces))
body = parts[0]
teeth = [p for p in parts[2:] if len(p.faces) > 1000]
print("teeth shells:", len(teeth), " body faces:", len(body.faces))
target = trimesh.util.concatenate([body] + teeth)
trimline = np.loadtxt("samples/maxilla_v3.pts", skiprows=1, max_rows=410)

rng = np.random.default_rng(0)
src = raw.vertices[rng.choice(len(raw.vertices), 20000, replace=False)]
dst = target.vertices[rng.choice(len(target.vertices), 40000, replace=False)]

best = None
for name, R0 in {"Rz180": rotation_matrix(np.pi, [0, 0, 1]), "Rx180": rotation_matrix(np.pi, [1, 0, 0]),
                 "I": np.eye(4), "Ry180": rotation_matrix(np.pi, [0, 1, 0])}.items():
    s = trimesh.transform_points(src, R0)
    T0 = np.eye(4); T0[:3, 3] = dst.mean(0) - s.mean(0)
    M, _, cost = icp(s, dst, initial=T0, threshold=1e-7, max_iterations=120, reflection=False, scale=False)
    print(f"  init {name:6s} -> cost {cost:.4f}")
    if best is None or cost < best[0]:
        best = (cost, name, M @ R0)
cost, name, T = best
print("best init:", name, "cost", round(cost, 4))

# refine with robust point-to-surface ICP (outlier rejection so palate/vestibule don't pull the fit)
import sys; sys.path.insert(0, ".")
from bleachtray.register import robust_icp
T, med = robust_icp(raw.vertices, target, T, iters=40)
raw_t = raw.copy(); raw_t.apply_transform(T)
pq = ProximityQuery(target)
samp = raw_t.vertices[rng.choice(len(raw_t.vertices), 8000, replace=False)]
closest, d, _ = pq.on_surface(samp)
print("residual to Titan surface (all pts): median %.3f  p90 %.3f mm;  inliers<1mm: %.1f%%, their median %.3f mm"
      % (np.median(d), np.percentile(d, 90), 100 * (d < 1).mean(), np.median(d[d < 1])))
R = T[:3, :3]
ang = np.degrees([np.arctan2(R[2, 1], R[2, 2]), np.arcsin(-R[2, 0]), np.arctan2(R[1, 0], R[0, 0])])
print("raw->titan rotation xyz (deg):", np.round(ang, 2), "translation:", np.round(T[:3, 3], 3))

# label raw vertices by nearest tooth shell (surface distance), else gingiva
V = raw_t.vertices
labels = np.zeros(len(V), dtype=np.int16)
best_d = np.full(len(V), np.inf)
centers = []
for i, t in enumerate(teeth):
    pqt = ProximityQuery(t)
    # cheap prefilter by bounding box expanded 1 mm
    lo, hi = t.bounds[0] - 1.0, t.bounds[1] + 1.0
    m = np.all((V >= lo) & (V <= hi), axis=1)
    idx = np.where(m)[0]
    if len(idx) == 0:
        continue
    dd = pqt.vertex(V[idx])[0]
    closer = dd < best_d[idx]
    best_d[idx[closer]] = dd[closer]
    labels[idx[closer]] = i + 1
    centers.append(t.centroid)
TOL = 0.25
labels[best_d > TOL] = 0
counts = np.bincount(labels)
print("label counts (0=gingiva):", counts.tolist())
np.savez("samples/gt_upper.npz", T=T, labels=labels, tooth_centers=np.array(centers), trimline=trimline,
         raw_vertices_titan=V)
raw_t.export("samples/upper_raw_titan_frame.ply")
print("saved samples/gt_upper.npz and samples/upper_raw_titan_frame.ply")
