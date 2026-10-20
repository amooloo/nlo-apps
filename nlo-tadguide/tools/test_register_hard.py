"""Harder matching checks on a phantom: the head tilted in the CBCT (patients never sit with the occlusal plane
level), a coloured PLY scan (teeth pale, gum pink) and a plain STL.   python tools/test_register_hard.py <phantom_dir>

The phantom's CBCT is resampled with the head turned about its centre, and the truth moved with it."""
import os, sys, json, time
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tadguide import dicomio, volume, register, meshio


def rot(pitch, roll, yaw):
    a, b, c = np.radians([pitch, roll, yaw])
    Rx = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
    Ry = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    Rz = np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def tilted(vol, R):
    """The same head turned by R about the volume centre (mm); returns the new volume and the 4x4 move."""
    A = vol.affine
    nz, ny, nx = vol.shape
    c = vol.index_to_mm(np.array([[(nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2]]))[0]
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = c - R @ c
    # new voxel (i,j,k) at mm x' samples the old volume at x = M^-1 x'
    Ai = np.linalg.inv(A)
    G = Ai @ np.linalg.inv(M) @ A                         # new index -> old index, (x, y, z) order
    P = np.array([[0, 0, 1, 0], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]], float)   # (x,y,z) <-> (z,y,x)
    Gz = P @ G @ P
    ov = vol.meta.get("outside_value")
    fill = float(ov if ov is not None else vol.data.min())        # what this CBCT has outside its field of view
    out = ndi.affine_transform(vol.data.astype(np.float32), Gz[:3, :3], offset=Gz[:3, 3], order=1, cval=fill)
    v2 = dicomio.Volume(np.rint(out).astype(np.int16), A.copy(), dict(vol.meta))
    return v2, M


def coloured(vol, lv, v, f, T):
    """Scanner-like colours from the truth: tooth where enamel / dentin lies right under the surface."""
    vn = register.vertex_normals(v, f)
    tooth = register.tooth_labels(vol, lv, v, vn, T)
    rng = np.random.default_rng(5)
    col = np.where(tooth[:, None], np.array([232, 226, 210]), np.array([205, 120, 128])).astype(float)
    col += rng.normal(0, 10, col.shape)
    return np.clip(col, 0, 255).astype(np.uint8)


def run(d, pitch, roll, yaw=0.0, colour=False, flip=False):
    tr = json.load(open(os.path.join(d, "truth.json")))
    arch = tr["arch"]
    vol0 = dicomio.load([os.path.join(d, "cbct")])
    R = rot(pitch, roll, yaw)
    vol, M = tilted(vol0, R) if (pitch or roll or yaw) else (vol0, np.eye(4))
    lv = volume.auto_levels(vol)
    v, f, _ = meshio.load_scan(os.path.join(d, f"scan_{arch}.stl"))
    if flip:
        f = f[:, ::-1].copy()
    Tt = M @ np.array(tr["scan_to_cbct"])
    col = coloured(vol, lv, v, f[:, ::-1] if flip else f, Tt) if colour else None
    t = time.time()
    res = register.auto_register(vol, lv, v, f, arch, colors=col, progress=lambda m: print("   ", m))
    err = np.linalg.norm(register.apply(res["T"], v) - register.apply(Tt, v), axis=1)
    print(f"  tilt {pitch:+.0f}/{roll:+.0f}/{yaw:+.0f}{' colour' if colour else ''}{' flipped' if flip else ''}: {res['method']} "
          f"in {time.time() - t:.1f}s; true error mean {err.mean():.3f} max {err.max():.3f} mm; quality {res.get('quality')}")
    return err.mean()


if __name__ == "__main__":
    d = sys.argv[1]
    cases = [(12, 6, 0, False, False), (12, 6, 0, True, False), (-18, -10, 8, False, True), (-18, -10, 8, True, False),
             (25, 0, -15, True, False)]
    errs = [run(d, *c) for c in cases]
    bad = [(c, round(e, 2)) for c, e in zip(cases, errs) if e > 0.3]
    assert not bad, bad
    print("OK")
