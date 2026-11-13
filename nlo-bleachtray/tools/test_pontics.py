"""Regression test for the pontics (bleachtray/pontic.py) on a synthetic arch segment - no patient data.

Two crowns 16 mm apart on a gum ridge (a rounded ridge along x, its crest 4.6 mm up, sloping down to the vestibule
and the palate): a missing premolar's space. A library pontic (#4, UR second premolar) is stood in the space the way the
page places it - the seat 2 mm under the ridge crest, the top level with the crowns, the width the space less 0.6 mm -
through a raw-frame matrix and a raw-to-model transform (a yaw and a shift, like a real case's), fused into the surface
and unioned into a solid body the way build_body does.

Checks: the shape scales to the asked width / height / thickness, the fused pontic is watertight, it unions into the
body as one watertight solid, the pontic stands on the ridge with no air under it (every column under its footprint is
solid from the gum up into the pontic), its top is where the crowns' tops are, and a mirrored shape is the mirror image.

    python tools/test_pontics.py
"""
import os
import sys

import numpy as np
import trimesh
from skimage import measure

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from bleachtray.pontic import library, shape_mesh, norm_spec, pontic_mesh, build_pontics, slot_frame  # noqa: E402

CELL = 0.12
LO = np.array([-16.0, -9.0, -1.0]); HI = np.array([16.0, 9.0, 12.0])
CREST = 4.6


def crown(x, y, z, cx):
    return ((x - cx) / 3.6) ** 2 + (y / 4.2) ** 2 + ((z - 8.0) / 3.5) ** 2 <= 1.0


def neck(x, y, z, cx):
    return ((x - cx) ** 2 + y ** 2 <= 2.8 ** 2) & (z <= 8.0)


def ridge_top(y):
    return CREST - 0.12 * y ** 2          # a rounded ridge along x: 4.6 at the crest, ~2.7 mm lower 4 mm out


def scene():
    xs = np.arange(LO[0], HI[0], CELL); ys = np.arange(LO[1], HI[1], CELL); zs = np.arange(LO[2], HI[2], CELL)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    teeth = crown(X, Y, Z, -8.0) | crown(X, Y, Z, 8.0) | neck(X, Y, Z, -8.0) | neck(X, Y, Z, 8.0)
    gum = (Z <= ridge_top(Y)) & (Z >= -0.5) & (np.abs(Y) <= 8.5) & (np.abs(X) <= 15.5)
    occ = np.pad((teeth | gum).astype(np.float32), 1)
    v, f, _, _ = measure.marching_cubes(occ, 0.5, spacing=(CELL, CELL, CELL))
    v = v - CELL + LO + np.array([0.0137, 0.0291, 0.0173])
    m = trimesh.Trimesh(v, f, process=True)
    m.fix_normals()
    return m


def main():
    fails = []

    def check(name, ok, extra=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
        if not ok:
            fails.append(name)

    lib = library()
    check("library: 28 shapes, all four quadrants", len(lib) == 28 and {s["arch"] + s["side"] for s in lib.values()} == {"upperR", "upperL", "lowerR", "lowerL"}, len(lib))
    for n, s in lib.items():
        m = shape_mesh(n)
        ext = m.bounds[1] - m.bounds[0]
        if not (m.is_watertight and abs(ext[0] - s["w0"]) < 0.05 and abs(ext[2] - s["h0"]) < 0.05 and abs(m.bounds[0][2]) < 1e-3):
            check(f"shape #{n} watertight, sized as lib.json says, seat at z = 0", False, f"{ext.round(2)} vs {s['w0']} x {s['t0']} x {s['h0']}, zmin {m.bounds[0][2]:.3f}")
            break
    else:
        check("every shape watertight, sized as lib.json says, seat at z = 0", True)

    # the scene in the model's frame, and the scan's own frame = the model's turned 20 deg and shifted (T_total takes raw -> model)
    surf = scene()
    T_total = trimesh.transformations.rotation_matrix(np.deg2rad(20.0), [0, 0, 1]) @ trimesh.transformations.translation_matrix([3.0, -2.0, 1.5])
    T_inv = np.linalg.inv(T_total)
    # the slot: the seat under the ridge crest between the crowns, the arch running along x, facial +y
    seat_model = np.array([0.0, 0.0, CREST - 2.0])
    M_model = slot_frame(seat_model, [1.0, 0.0, 0.0], up=[0.0, 0.0, 1.0], outward=[0.0, 1.0, 0.0])
    M_raw = T_inv @ M_model
    top = 8.0 + 3.5                                   # the crowns' tops
    w, h, t = 16.0 - 2 * 3.6 - 0.6, top - seat_model[2], 8.5
    spec = dict(id="p1", n=4, slot="R5", w=w, h=h, t=t, m=M_raw.tolist())
    sp = norm_spec(spec)
    check("norm_spec: accepts the page's entry", sp is not None and sp["n"] == 4 and sp["slot"] == "R5", sp)
    check("norm_spec: refuses a shape that is not in the library / a size out of range / a left-handed frame",
          norm_spec(dict(spec, n=1)) is None and norm_spec(dict(spec, w=30)) is None and norm_spec(dict(spec, m=(M_raw @ np.diag([-1, 1, 1, 1])).tolist())) is None)
    pm = pontic_mesh(sp, T_total)
    ext = pm.bounds[1] - pm.bounds[0]
    check("pontic_mesh: scaled to width / thickness / height", abs(ext[0] - w) < 0.05 and abs(ext[1] - t) < 0.05 and abs(ext[2] - h) < 0.05, ext.round(2))
    check("pontic_mesh: seat on the ridge, top level with the crowns", abs(pm.bounds[0][2] - seat_model[2]) < 0.05 and abs(pm.bounds[1][2] - top) < 0.05, (pm.bounds[0][2], pm.bounds[1][2]))
    check("pontic_mesh: centred between the crowns", abs(pm.vertices[:, 0].mean()) < 1.2 and pm.is_watertight, pm.vertices[:, 0].mean())
    pm_m = pontic_mesh(dict(sp, mirror=True), T_total)
    check("mirror: the mirror image, same size, still closed with outward normals",
          pm_m.is_watertight and pm_m.volume > 0 and np.allclose(pm_m.bounds[1] - pm_m.bounds[0], ext, atol=0.05)
          and abs(float(np.percentile(pm.vertices[:, 0], 90)) + float(np.percentile(pm_m.vertices[:, 0], 10))) < 0.3, "")

    fused, info = build_pontics([spec, dict(spec, id="bad", n=99)], T_total, surf, log=print)
    check("build_pontics: one made, the unknown shape dropped and named", fused is not None and info["count"] == 1 and info.get("dropped") == ["bad"], info)
    check("build_pontics: watertight after fusing, with a collar and a foot", fused.is_watertight and info["pontics"][0]["fused"].get("fused") == 1, info["pontics"][0].get("fused"))
    check("build_pontics: the entry says what it is", info["pontics"][0]["shape"] == "UR second premolar" and info["pontics"][0]["slot"] == "R5", info["pontics"][0])
    # a build-up (11/13/2026): the same crown marked `bu` stands over a tooth - kept through norm_spec, counted as a
    # build-up, and joined without the foot a pontic gets (nothing filled down to the gum under it)
    bsp = norm_spec(dict(spec, id="b1", bu=True, tooth=7))
    check("norm_spec: a build-up keeps its mark and its tooth; a pontic has neither", bsp is not None and bsp.get("bu") is True and bsp.get("tooth") == 7 and "bu" not in sp, bsp)
    fb, ib = build_pontics([dict(spec, id="b1", bu=True, tooth=7)], T_total, surf, log=print)
    check("build_pontics: a build-up is made, counted and named as one", fb is not None and ib["count"] == 1 and ib["buildups"] == 1 and ib["pontics"][0].get("bu") is True and info["buildups"] == 0, ib)
    check("... without a pontic's foot under it (less volume than the same crown as a pontic)", abs(fb.volume) < abs(fused.volume) - 1.0, (round(abs(fb.volume), 1), round(abs(fused.volume), 1)))

    # into a body the way build_body does: the surface closed below the floor, the pontic unioned in
    import manifold3d as m3
    from bleachtray.solid import solidify, to_manifold, from_manifold
    body = solidify(surf, -3.0, outline=None, snap=False)
    man = to_manifold(body)
    check("scene: the synthetic body is a manifold solid", man is not None)
    u = man + to_manifold(fused)
    check("union: pontic + body is one solid", u.status() == m3.Error.NoError and u.num_vert() > 0)
    out = from_manifold(u)
    check("union: watertight, one piece", out.is_watertight and len(out.split(only_watertight=False)) == 1, (out.is_watertight, len(out.split(only_watertight=False))))
    # no air under the pontic: every column under its footprint is solid from the gum up into the pontic (its underside
    # per column from a ray up through the pontic alone)
    xs = np.linspace(-0.4 * w, 0.4 * w, 9); ys = np.linspace(-0.4 * t, 0.4 * t, 7)
    pts, cols = [], 0
    for x in xs:
        for y in ys:
            loc, _, _ = pm.ray.intersects_location([[x, y, -5.0]], [[0.0, 0.0, 1.0]])
            if not len(loc):
                continue            # outside the pontic's (rounded) footprint
            cols += 1
            for z in np.arange(ridge_top(y) - 0.6, float(loc[:, 2].min()) + 0.5, 0.25):
                pts.append([x, y, z])
    inside = out.contains(np.asarray(pts))
    check("no air under the pontic: the columns under it are solid from the gum into the pontic", cols > 30 and inside.all(), f"{int((~inside).sum())} of {len(pts)} points in {cols} columns are air")
    vt = np.asarray(pm.vertices)[np.argmax(np.asarray(pm.vertices)[:, 2])]
    tip = out.contains(np.array([[vt[0], vt[1], vt[2] - 0.6], [vt[0], vt[1], vt[2] + 0.6]]))
    check("the pontic's top is in the model, the air above it is not", bool(tip[0]) and not bool(tip[1]))
    print()
    print("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
