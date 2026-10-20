"""Arch + site finder check on a phantom (true roots known).   python tools/test_sites.py <phantom_dir>"""
import os, sys, json, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tadguide import dicomio, volume, register, meshio, arch as archmod, tads


def main(d):
    tr = json.load(open(os.path.join(d, "truth.json")))
    arch = tr["arch"]
    vol = dicomio.load([os.path.join(d, "cbct")])
    lv = volume.auto_levels(vol)
    v, f, _ = meshio.load_scan(os.path.join(d, f"scan_{arch}.stl"))
    T = np.array(tr["scan_to_cbct"])
    P = register.apply(T, v)
    N = register.vertex_normals(P, f)
    teeth = register.tooth_labels(vol, lv, v, register.vertex_normals(v, f), T)
    t = time.time()
    A = archmod.build(arch, P, N, teeth)
    print(f"arch in {time.time() - t:.1f}s; bounds L {np.round(A.bounds.get('L', []), 1).tolist()}  R {np.round(A.bounds.get('R', []), 1).tolist()}")
    # truth: contacts along the arch for the scanned arch
    true_s = {}
    for g in tr["gaps"]:
        s, _ = A.s_of(np.array([g["point"]]))
        true_s[(g["quad"][-1], g["between"][0])] = float(s[0])
    errs = []
    for (side, k), s_true in sorted(true_s.items()):
        s_est = A.gap(side, k)
        if s_est is not None:
            errs.append(abs(abs(s_est) - abs(s_true)))
            print(f"  {side} {k}/{k + 1}: true s {s_true:6.1f}  found {s_est:6.1f}")
    print(f"contact error mean {np.mean(errs):.2f} mm max {np.max(errs):.2f} ({len(errs)} contacts)")
    ctx = tads.Context(vol, lv, P, f, N, A, teeth)
    for site in ("buccal", "palatal", "palate"):
        t = time.time()
        res = ctx.suggest(site)
        print(f"{site}: {len(res)} sites in {time.time() - t:.1f}s")
        for r in res:
            m = r["metrics"]
            # distance of the thread's midpoint from the true gap point (buccal/palatal only)
            print(f"   {r['label']:22s} {m['status']:7s} clear {m['root_clearance']:.2f}  cort {m['cortical']:.2f}  soft {m['soft_tissue']:.2f}  bone {m['bone_fraction']:.2f}  air {m['air_len']:.1f}  a {r['a']:.1f} al {r['alpha']:.0f} be {r['beta']:.0f}  score {r['score']:.2f}")
    return ctx


if __name__ == "__main__":
    main(sys.argv[1])
