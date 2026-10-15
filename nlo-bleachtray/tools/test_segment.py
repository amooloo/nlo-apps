"""Run segmentation on the GT scan, compare to Titan's trimline, render the result."""
import sys, time
sys.path.insert(0, ".")
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from bleachtray.mesh_utils import load_scan, smooth_field
from bleachtray.orient import rough_orient
from bleachtray.segment import (predict_tooth_prob, clean_mask, split_teeth, merge_small_teeth, order_teeth,
                                margin_contour, resample_polyline, smooth_polyline)

t0 = time.time()
raw = load_scan("samples/upper_raw.stl")
gt = np.load("samples/gt_upper.npz")
mesh, T = rough_orient(raw)
p_tooth, p_ip, aux = predict_tooth_prob(mesh)
A = aux["A"]
ps = smooth_field(A, p_tooth, 4)
mask = clean_mask(ps > 0.5, A)
labels, _ = split_teeth(mesh, mask, p_ip, A, aux)
labels = merge_small_teeth(mesh, labels, A)
info, cents, center, contact = order_teeth(mesh, labels, aux)
print("teeth found:", len(np.unique(labels[labels > 0])), " order:", sorted(info.values()))
print("incisor contact xy:", np.round(contact, 2), " arch center:", np.round(center, 2), " (%.1fs)" % (time.time() - t0))

# margin contour from the smoothed probability field (bridges interproximal gaps)
field = smooth_field(A, mask.astype(float), 3)
loops = margin_contour(mesh, field, 0.5)
print("contour loops:", [len(L) for L in loops[:5]])
margin = smooth_polyline(resample_polyline(loops[0], 0.5), iters=2)
print("margin points:", len(margin), " length %.1f mm" % np.linalg.norm(np.diff(np.vstack([margin, margin[:1]]), axis=0), axis=1).sum())

# compare to Titan trimline: bring Titan's line into our frame: titan = Tgt @ raw ; ours = T @ raw  => ours = T @ inv(Tgt) @ titan
Tgt = gt["T"]
tl = trimesh.transform_points(gt["trimline"], T @ np.linalg.inv(Tgt))
from scipy.spatial import cKDTree
d_ours_to_titan = cKDTree(tl).query(margin)[0]
d_titan_to_ours = cKDTree(margin).query(tl)[0]
print("margin vs Titan trimline: ours->titan median %.2f p90 %.2f max %.2f | titan->ours median %.2f p90 %.2f max %.2f mm"
      % (np.median(d_ours_to_titan), np.percentile(d_ours_to_titan, 90), d_ours_to_titan.max(),
         np.median(d_titan_to_ours), np.percentile(d_titan_to_ours, 90), d_titan_to_ours.max()))

# GT comparison of the tooth mask
gt_tooth = gt["labels"] > 0
tp = (mask & gt_tooth).sum(); fp = (mask & ~gt_tooth).sum(); fn = (~mask & gt_tooth).sum()
print("tooth mask vs GT: precision %.3f recall %.3f F1 %.3f" % (tp / (tp + fp), tp / (tp + fn), 2 * tp / (2 * tp + fp + fn)))

np.savez("samples/seg_result.npz", labels=labels, mask=mask, margin=margin, T=T)
# render
tri = mesh.vertices[mesh.faces]
fl = labels[mesh.faces]
fl = np.where(fl[:, 1] == fl[:, 2], fl[:, 1], fl[:, 0])
cmap = plt.get_cmap("tab20")
cols = np.array([(0.88, 0.88, 0.88, 1) if l == 0 else cmap((l * 7) % 20) for l in fl])
fig, axs = plt.subplots(1, 2, figsize=(20, 9))
for ax, idx, title, xl, yl in [(axs[0], [0, 1], "Our segmentation (top). Red = our margin, blue dashed = Titan trimline", (-40, 40), (-40, 30)),
                               (axs[1], [1, 2], "Side (YZ)", (-40, 30), (-14, 10))]:
    order = np.argsort(tri[:, :, 2].mean(1)) if idx == [0, 1] else np.argsort(tri[:, :, 0].mean(1))
    ax.add_collection(PolyCollection(tri[order][:, :, idx], facecolors=cols[order], edgecolors="none"))
    ax.plot(margin[:, idx[0]], margin[:, idx[1]], "r-", lw=1.2)
    ax.plot(tl[:, idx[0]], tl[:, idx[1]], "b--", lw=0.8)
    for i, (side, pos) in info.items():
        cx = cents[i]
        ax.text(cx[idx[0]], cx[idx[1]], f"{pos}", ha="center", va="center", fontsize=9, weight="bold")
    ax.set_aspect("equal"); ax.set_xlim(*xl); ax.set_ylim(*yl); ax.set_title(title); ax.grid(True, alpha=.3)
plt.tight_layout(); plt.savefig("samples/seg_result.png", dpi=90)
print("saved samples/seg_result.png")
