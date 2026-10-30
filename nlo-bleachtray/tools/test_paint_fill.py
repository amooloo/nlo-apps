"""Regression test for the painted block-out (bleachtray/fuse.paint_fill) on a synthetic arch segment - no patient data.

Two crowns side by side (the painted one and its neighbour, a contact between them), each on a narrower neck, so the
crown's bulge overhangs the cervical third all round; the gum comes up to the margin with a papilla in the embrasure,
and below the margin the buccal gum recedes and then bulges out again lower down - so a vertical under the crown's
bulge passes a tall run of air before it meets the gum: the "curtain" the old fill hung down to the floor (Santiago
Kemler's upper, 10/29/2026). The doctor's kind of stroke: a cervical band on the buccal, line angle to line angle, and
the gum margin under it.

Checks: the fill covers the MIDDLE of the band (the old one left it empty), stays within the painted band's heights
(no curtain below it, no climb up the embrasure to the contact above it), stays inside the silhouette (flush with the
contour, never proud of it), is one piece, and is watertight after fusing into the model.

    python tools/test_paint_fill.py
"""
import os
import sys

import numpy as np
import trimesh
from skimage import measure

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from bleachtray.fuse import paint_fill, fuse_many  # noqa: E402

CELL = 0.1
LO = np.array([-6.0, -7.0, -1.0]); HI = np.array([13.0, 7.0, 11.5])


def crown(x, y, z, cx):
    return ((x - cx) / 4.0) ** 2 + (y / 4.5) ** 2 + ((z - 7.0) / 3.0) ** 2 <= 1.0


def neck(x, y, z, cx):
    return ((x - cx) ** 2 + y ** 2 <= 3.0 ** 2) & (z <= 7.0)


def gum_top(x):
    return 4.6 + 0.6 * np.exp(-((x - 3.8) / 1.3) ** 2)          # the papilla in the embrasure


def gum_buccal(z):
    # the gum's buccal face: at y = 4.0 round the margin (inside the crowns' 4.5 mm bulge: the cervical undercut),
    # receding to 2.0 mm by z = 0.5, then bulging out to 5.5 below that (the vestibule's floor)
    return np.where(z >= 3.0, 4.0, np.where(z >= 0.5, 4.0 - (3.0 - z) * 0.8, 5.5))


def scene():
    xs = np.arange(LO[0], HI[0], CELL); ys = np.arange(LO[1], HI[1], CELL); zs = np.arange(LO[2], HI[2], CELL)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    teeth = crown(X, Y, Z, 0.0) | crown(X, Y, Z, 7.6) | neck(X, Y, Z, 0.0) | neck(X, Y, Z, 7.6)
    gum = (Z <= gum_top(X)) & (Y <= gum_buccal(Z)) & (Y >= -6.0) & (X >= -5.5) & (X <= 12.5) & (Z >= -0.5)
    occ = np.pad((teeth | gum).astype(np.float32), 1)
    v, f, _, _ = measure.marching_cubes(occ, 0.5, spacing=(CELL, CELL, CELL))
    # off the fill's own 0.1 mm grid (a scene made on that grid has vertical lines running exactly through shared corners,
    # counted once per triangle - a real scan's coordinates never line up like that)
    v = v - CELL + LO + np.array([0.0137, 0.0291, 0.0173])
    m = trimesh.Trimesh(v, f, process=True)
    m.fix_normals()
    return m


def main():
    m = scene()
    V = np.asarray(m.vertices)
    x, y, z = V.T
    on_crown = crown(x, y, z + 0.06, 0.0) | crown(x, y, z - 0.06, 0.0)          # vertices on the painted crown's surface
    band = on_crown & (y > 1.5) & (z >= 4.3) & (z <= 6.4) & (x > -3.6) & (x < 3.7)
    margin = ~on_crown & (y > 3.0) & (y < 4.8) & (z >= 3.9) & (z <= 5.2) & (x > -3.6) & (x < 3.7)
    paint = band | margin
    zlo, zhi = float(V[paint, 2].min()), float(V[paint, 2].max())
    fails = []

    def check(name, ok, extra=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
        if not ok:
            fails.append(name)

    check("scene: painted band of a few hundred vertices", 200 < paint.sum() < 20000, int(paint.sum()))
    fill, info = paint_fill(m, paint, log=print)
    check("a fill is made", fill is not None, info.get("error"))
    if fill is None:
        sys.exit(1)
    B = fill.bounds
    vols = sorted((abs(q.volume) for q in fill.split(only_watertight=False)), reverse=True)
    check("the band is one piece holding most of the fill (small extra pieces only where the band wraps a line angle)",
          len(vols) <= 4 and vols[0] >= 0.75 * sum(vols), [round(v, 2) for v in vols])
    check("no curtain: the fill ends within 1 mm under the painted band", B[0, 2] >= zlo - 1.0, f"fill from z {B[0, 2]:.2f}, paint from {zlo:.2f}")
    check("no climb: the fill ends within 0.6 mm over the painted band", B[1, 2] <= zhi + 0.6, f"fill to z {B[1, 2]:.2f}, paint to {zhi:.2f}")
    # the middle of the band: the cervical undercut under the bulge at x = 0, between the gum face (y 4.0) and the bulge
    mid = np.array([[0.0, 4.2, 4.9], [0.0, 4.3, 5.2], [-1.5, 4.15, 5.0], [1.5, 4.15, 5.0]])
    check("the middle of the band is filled", bool(fill.contains(mid).all()), fill.contains(mid))
    # nothing in the embrasure above the band (under the contact, z 6.06 .. at the top of the painted band + 0.6)
    emb = np.array([[3.8, 0.0, 7.4], [3.8, 0.5, 7.2]])
    check("the embrasure under the contact, above the band, is left alone", not fill.contains(emb).any(), fill.contains(emb))
    # flush with the contour: nothing outside the crowns' silhouette from above (4.5 mm bulge, a hair for the smoothing)
    fv = np.asarray(fill.vertices)
    r = np.minimum(np.hypot(fv[:, 0] / 4.0, fv[:, 1] / 4.5), np.hypot((fv[:, 0] - 7.6) / 4.0, fv[:, 1] / 4.5))
    check("flush: nothing proud of the contour", float(r.max()) <= 1.0 + 0.2 / 4.0, f"max {r.max():.3f}")
    fused, finfo = fuse_many(fill, m, radius=0.6, overlap=0.2, foot_mm=0.0)
    check("fused into the model, watertight", fused is not None and all(q.is_watertight for q in fused.split(only_watertight=False)), finfo)
    print("ALL OK" if not fails else f"{len(fails)} FAILED")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
