"""Matching check on a phantom with a known answer.   python tools/test_register.py <phantom_dir>"""
import os, sys, json, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tadguide import dicomio, volume, register, meshio


def run(d, flip_normals=False):
    tr = json.load(open(os.path.join(d, "truth.json")))
    arch = tr["arch"]
    vol = dicomio.load([os.path.join(d, "cbct")])
    lv = volume.auto_levels(vol)
    v, f, _ = meshio.load_scan(os.path.join(d, f"scan_{arch}.stl"))
    if flip_normals:
        f = f[:, ::-1].copy()
    t = time.time()
    res = register.auto_register(vol, lv, v, f, arch, progress=lambda m: print("   ", m))
    Tt = np.array(tr["scan_to_cbct"])
    T = res["T"]
    err = np.linalg.norm(register.apply(T, v) - register.apply(Tt, v), axis=1)
    vn = register.vertex_normals(v, f) * res["normal_sign"]
    tgt, _info = register.cbct_target(vol, lv, arch)
    fit = register.fit_map(tgt, v, vn, T)
    teeth = register.tooth_labels(vol, lv, v, vn, T)
    sm = register.summary(fit, teeth)
    print(f"  {'flipped normals' if flip_normals else 'normal'}: method {res['method']} tried {res['tried']} in {time.time() - t:.1f}s;"
          f" true error mean {err.mean():.3f} max {err.max():.3f} mm; teeth {teeth.mean() * 100:.0f}% of vertices; {sm['text']} ({sm['level']})")
    return err.mean()


if __name__ == "__main__":
    e1 = run(sys.argv[1])
    e2 = run(sys.argv[1], flip_normals=True)
    assert e1 < 0.15 and e2 < 0.15, (e1, e2)
    print("OK")
