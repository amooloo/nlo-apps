"""Guide check on a phantom: two buccal TADs -> guide; watertight, one piece, holes clear, no tissue overlap.
   python tools/test_guide.py <phantom_dir> [out.stl]"""
import os, sys, json, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tadguide import dicomio, volume, register, meshio, arch as archmod, tads, guide


def main(d, out=None):
    tr = json.load(open(os.path.join(d, "truth.json")))
    arch = tr["arch"]
    vol = dicomio.load([os.path.join(d, "cbct")])
    lv = volume.auto_levels(vol)
    v, f, _ = meshio.load_scan(os.path.join(d, f"scan_{arch}.stl"))
    T = np.array(tr["scan_to_cbct"])
    P = register.apply(T, v)
    N = register.vertex_normals(P, f)
    teeth = register.tooth_labels(vol, lv, v, register.vertex_normals(v, f), T)
    A = archmod.build(arch, P, N, teeth)
    ctx = tads.Context(vol, lv, P, f, N, A, teeth)
    t1 = ctx.optimize("buccal", "R", A.gap("R", 5), 11.0, 25, 0, (1.6, 8, 1.5))
    t2 = ctx.optimize("buccal", "L", A.gap("L", 5), 11.0, 25, 0, (1.6, 8, 1.5))
    for tt in (t1, t2):
        print(tt["label"], tt["metrics"]["status"], tt["metrics"]["root_clearance"])
    t = time.time()
    GV, GF, info = guide.build(P, f, N, teeth, [t1, t2], A, progress=lambda m: print("   ", m))
    print("info", {k: info[k] for k in ("seconds", "voxel", "tilt_deg", "hidden_sleeves", "pieces", "watertight", "volume_ml", "faces")})
    holes = guide.check_holes(GV, GF, [t1, t2], 3.2)
    print("holes", holes)
    # no guide inside the teeth/gum: signed distance of guide vertices to the scan (+ = outside the tissue)
    from scipy.spatial import cKDTree
    d, k = cKDTree(P).query(GV)
    sgn = np.einsum("ij,ij->i", GV - P[k], N[k])
    inside = (sgn < -0.05) & (d < 1.0)
    print(f"guide vertices inside teeth/gum: {int(inside.sum())} of {len(GV)}; closest to the scan {d.min():.3f} mm")
    if out:
        Tinv = np.linalg.inv(T)
        meshio.write_stl(out, register.apply(Tinv, GV), GF)
        meshio.write_stl(out.replace(".stl", "_scan.stl"), v, f)
    assert info["watertight"] and info["pieces"] == 1 and all(h["clear"] for h in holes) and inside.sum() < 0.001 * len(GV)
    print("OK")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
