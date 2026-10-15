"""Shaded oblique renders of one or more model STLs (painter's algorithm, no GPU needed).

    python tools/render_oblique.py out.png model1.stl [model2.stl ...]
"""
import sys
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from scipy.spatial.transform import Rotation as R


def render(ax, mesh, elev=35, azim=-25, light=(0.3, -0.6, 0.75), color=(0.93, 0.78, 0.76)):
    rot = R.from_euler("zx", [azim, -(90 - elev)], degrees=True)   # yaw then tilt toward the viewer
    V = rot.apply(mesh.vertices)
    tri = V[mesh.faces]
    n = mesh.face_normals
    L = np.asarray(light, float); L /= np.linalg.norm(L)
    shade = 0.35 + 0.65 * np.clip(n @ L, 0, 1)
    cols = np.clip(np.array(color)[None, :] * shade[:, None], 0, 1)
    depth = tri[:, :, 2].mean(1)           # after rotation, +z toward the viewer
    order = np.argsort(depth)
    pc = PolyCollection(tri[order][:, :, :2], facecolors=cols[order], edgecolors="none", antialiased=False)
    ax.add_collection(pc)
    ax.set_aspect("equal"); ax.autoscale_view(); ax.axis("off")


if __name__ == "__main__":
    out, paths = sys.argv[1], sys.argv[2:]
    fig, axs = plt.subplots(1, len(paths), figsize=(9 * len(paths), 8))
    axs = np.atleast_1d(axs)
    for ax, p in zip(axs, paths):
        m = trimesh.load(p, force="mesh")
        render(ax, m)
        ax.set_title(p.split("/")[-1], fontsize=10)
    plt.tight_layout(); plt.savefig(out, dpi=80, facecolor="#1a1a1a")
    print("saved", out)
