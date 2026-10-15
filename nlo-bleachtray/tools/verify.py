"""Verify an output against the Titan v3 export: placement, trimline agreement, reservoir profile."""
import sys
sys.path.insert(0, ".")
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from scipy.spatial import cKDTree
from bleachtray.register import robust_icp


def read_pts(p):
    return np.array([l.split() for l in open(p) if len(l.split()) == 3], float)


name = sys.argv[1] if len(sys.argv) > 1 else "ArmanShetty_upper"
model = trimesh.load(f"out/{name}_model.stl", force="mesh")
body = trimesh.load(f"out/{name}_body_only.stl", force="mesh")
ours = read_pts(f"out/{name}_trimline.pts")
v3 = trimesh.load("samples/maxilla_v3.stl", force="mesh")
parts = sorted(v3.split(only_watertight=False), key=lambda c: -len(c.faces))
titan_arch = trimesh.util.concatenate([parts[0]] + [p for p in parts[2:] if len(p.faces) > 1000])
titan_tl = read_pts("samples/maxilla_v3.pts")

# 1) placement: how far is our arch from Titan's arch placement (both relative to the same base frame)?
T, med = robust_icp(body.vertices[body.vertices[:, 2] > 4], titan_arch, np.eye(4), iters=30)
R = T[:3, :3]
ang = np.degrees([np.arctan2(R[2, 1], R[2, 2]), np.arcsin(-R[2, 0]), np.arctan2(R[1, 0], R[0, 0])])
print("placement vs Titan: rotation xyz %s deg, translation %s mm (ICP inlier median %.3f mm)" % (np.round(ang, 2), np.round(T[:3, 3], 2), med))

# 2) trimline agreement, facial side only (y > arch-centre line approximated per point by comparing radial position)
ours_in_titan = trimesh.transform_points(ours, T)
tree_t = cKDTree(titan_tl)
d_facial = []
c = titan_arch.vertices[:, :2].mean(0)
for p in ours_in_titan:
    d, j = tree_t.query(p)
    d_facial.append((d, p))
d_all = np.array([d for d, _ in d_facial])
# facial points: our margin points whose radius from the arch centre is larger than the local Titan line's inner radius -> use outer half
r_ours = np.linalg.norm(ours_in_titan[:, :2] - c, axis=1)
ang_o = np.arctan2(ours_in_titan[:, 1] - c[1], ours_in_titan[:, 0] - c[0])
facial = np.zeros(len(ours), bool)
for k in range(len(ours)):
    same = np.abs(((ang_o - ang_o[k] + np.pi) % (2 * np.pi)) - np.pi) < 0.05
    facial[k] = r_ours[k] >= np.median(r_ours[same])
print("trimline vs Titan (same frame): FACIAL median %.2f p90 %.2f max %.2f mm | LINGUAL median %.2f p90 %.2f mm"
      % (np.median(d_all[facial]), np.percentile(d_all[facial], 90), d_all[facial].max(),
         np.median(d_all[~facial]), np.percentile(d_all[~facial], 90)))

# 3) reservoir profile: cross-section through a central incisor (x = +4) and a premolar
fig, axs = plt.subplots(1, 3, figsize=(24, 8))
ax = axs[0]
tri = model.vertices[model.faces]; zc = tri[:, :, 2].mean(1); order = np.argsort(zc)
pc = PolyCollection(tri[order][:, :, :2], array=zc[order], cmap="viridis", edgecolors="none"); ax.add_collection(pc)
ax.plot(ours[:, 0], ours[:, 1], "r-", lw=1.2, label="our trimline")
tt = trimesh.transform_points(titan_tl, np.linalg.inv(T))
ax.plot(tt[:, 0], tt[:, 1], "w--", lw=0.8, label="Titan trimline (aligned)")
ax.set_aspect("equal"); ax.set_xlim(-45, 45); ax.set_ylim(-55, 15); ax.legend(loc="lower center"); ax.set_title("Output model (top), base unioned")
ax.axvline(4.5, color="orange", lw=0.8, ls=":"); ax.axvline(21.5, color="orange", lw=0.8, ls=":")

st = np.load(f"out/{name}_state.npz")
for ax, x0, title in [(axs[1], 4.5, "Section x=4.5 (central incisor)"), (axs[2], 21.5, "Section x=21.5 (premolar/molar)")]:
    s = model.section(plane_origin=[x0, 0, 0], plane_normal=[1, 0, 0])
    if s is not None:
        for path in s.discrete:
            ax.plot(path[:, 1], path[:, 2], "k-", lw=0.8)
    # reference: same section without reservoirs (undisplaced surface) is not stored; show the displacement field instead
    ax.set_aspect("equal"); ax.set_title(title); ax.grid(True, alpha=.3); ax.set_xlabel("y (mm)"); ax.set_ylabel("z (mm)")
plt.tight_layout(); plt.savefig(f"out/{name}_verify.png", dpi=85)
print("saved out/%s_verify.png" % name)
