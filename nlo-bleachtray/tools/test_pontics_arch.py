"""The pontics through the whole pipeline on a synthetic full arch - no patient data.

The arch is built from the pontic library itself: the 14 upper shapes stood round their own arch (the library's
maxilla set is the same shapes translated, so lib.json's frames put them back in the arch: X along the arch, Y facial,
Z occlusal) on a horseshoe of gum, unioned into one solid and opened into a sheet the way a scan is; the second premolar
#13 (L5) is left out, so the arch has a space, and the vertex labels (tooth 1..13) are given as the corrected labels the
app would pass. pipeline.process() then makes a retainer (no base: the Trimlign base is not in the repo) with a pontic
in the space, placed as the page places it, and the result is checked: the pontic is in the model (its top inside the
body, no air under it), the body is watertight, the pontics file is written, the report names it, and the trim line
runs round the pontic without passing through it.

    python tools/test_pontics_arch.py        (a minute or two: the tooth model's features on ~150k vertices)
"""
import os, sys, json, time, tempfile

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from bleachtray.pontic import library, shape_mesh, slot_frame  # noqa: E402

fails = []


def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  ({extra})"))
    if not ok:
        fails.append(name)


ARCH_K = 17.0      # the arch line: y = 28 - x^2 / 17 (mm) - 55 mm between the second molars, 45 mm deep, the way an upper is
arch_y = lambda x: 28.0 - x * x / ARCH_K


def arch_positions():
    """Where each upper shape stands on the arch line, spaced by its own width along the arc: 9..15 (UL1..UL7) towards
    +x, 8..2 (UR1..UR7) towards -x (an upper's rough frame has the patient's left at +x)."""
    widths = {n: library()[n]["w0"] for n in range(2, 16)}
    xs = np.linspace(0, 45, 4000); arc = np.r_[0.0, np.cumsum(np.hypot(np.diff(xs), np.diff(arch_y(xs))))]
    x_of = lambda s_: float(np.interp(s_, arc, xs))
    pos = {}
    for side_teeth, sign in (([9, 10, 11, 12, 13, 14, 15], +1), ([8, 7, 6, 5, 4, 3, 2], -1)):
        s_ = 0.2
        for n in side_teeth:
            s_ += widths[n] / 2.0
            x = x_of(s_); pos[n] = (sign * x, arch_y(x))
            s_ += widths[n] / 2.0 + 0.2
    return pos


def gum_z(x, y):
    """The ridge: its crest along the arch line at z = 0, falling off 0.08 mm per mm^2 either side (a rounded ridge), the
    palate sloping away further in."""
    d = y - arch_y(x)            # the vertical offset from the arch line (close to the distance near the crest)
    return -0.08 * np.minimum(d * d, 60.0) - np.where(d < -5, (-d - 5) * 0.6, 0.0)


def build_arch(skip=(13,), seat_depth=2.0):
    """The teeth stood round the arch (each shape's seat `seat_depth` under the ridge crest, pointing up), unioned with a
    gum slab, opened into a sheet; returns (sheet mesh, labels per vertex: 1..n in arch order, info {label: (n, centre)})."""
    import manifold3d as m3
    from bleachtray.solid import to_manifold, from_manifold
    pos = arch_positions()
    # the gum: a heightfield slab over the horseshoe band
    xs = np.arange(-40, 40.1, 0.5); ys = np.arange(-30, 40.1, 0.5)
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    Z = gum_z(X, Y)
    # the slab as a closed mesh: top heightfield, bottom at z = -12, sides
    nx, ny = X.shape
    top = np.c_[X.ravel(), Y.ravel(), Z.ravel()]; bot = np.c_[X.ravel(), Y.ravel(), np.full(X.size, -12.0)]
    V = np.vstack([top, bot]); F = []
    idx = lambda i, j: i * ny + j
    for i in range(nx - 1):
        for j in range(ny - 1):
            a, b, c, d = idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)
            F += [[a, b, c], [a, c, d]]
            o = X.size
            F += [[a + o, c + o, b + o], [a + o, d + o, c + o]]
    o = X.size
    for i in range(nx - 1):       # the y = min / max sides
        a, b = idx(i, 0), idx(i + 1, 0); F += [[a, a + o, b], [b, a + o, b + o]]
        a, b = idx(i, ny - 1), idx(i + 1, ny - 1); F += [[a, b, a + o], [b, b + o, a + o]]
    for j in range(ny - 1):       # the x = min / max sides
        a, b = idx(0, j), idx(0, j + 1); F += [[a, b, a + o], [b, b + o, a + o]]
        a, b = idx(nx - 1, j), idx(nx - 1, j + 1); F += [[a, a + o, b], [b, a + o, b + o]]
    gum = trimesh.Trimesh(V, np.asarray(F), process=True); gum.fix_normals()
    man = to_manifold(gum); assert man is not None
    info = {}
    teeth = []
    for k, n in enumerate(list(range(2, 16))):
        if n in skip:
            continue
        x, y = pos[n]
        # the frame: X along the arch (the parabola's tangent), Y facial (outwards), Z up; seat under the crest
        t = np.array([1.0, -2.0 * x / ARCH_K, 0.0]); t /= np.linalg.norm(t)
        M = slot_frame([x, y, gum_z(x, y) - seat_depth], t, up=[0, 0, 1], outward=[x, y - 10.0, 0.0])
        m = shape_mesh(n).copy(); m.apply_transform(M)
        teeth.append((n, m, (x, y)))
    for n, m, c in teeth:
        mm = to_manifold(m)
        u = man + mm
        assert u.status() == m3.Error.NoError, n
        man = u
    solid = from_manifold(man)
    # the scan: the top sheet only (the slab's bottom and far sides go), like a scan of teeth and gum
    Vs = np.asarray(solid.vertices); Fs = np.asarray(solid.faces)
    keep = (Vs[Fs][:, :, 2].min(axis=1) > -11.5) & (np.abs(Vs[Fs][:, :, 0]).max(axis=1) < 39.5) & (Vs[Fs][:, :, 1].min(axis=1) > -29.5) & (Vs[Fs][:, :, 1].max(axis=1) < 39.5)
    sheet = trimesh.Trimesh(Vs, Fs[keep], process=True); sheet.remove_unreferenced_vertices()
    # labels: a vertex on a tooth = within 0.08 mm of that tooth's own surface and above the gum
    from scipy.spatial import cKDTree
    Vv = np.asarray(sheet.vertices); labels = np.zeros(len(Vv), dtype=np.int64)
    for lab, (n, m, c) in enumerate(teeth, start=1):
        near = np.linalg.norm(Vv[:, :2] - np.array(c), axis=1) < 9.0
        dist, _ = cKDTree(np.asarray(m.vertices)).query(Vv[near])
        hit = np.where(near)[0][(dist < 0.12) & (Vv[near][:, 2] > gum_z(Vv[near][:, 0], Vv[near][:, 1]) + 0.05)]
        labels[hit] = lab
        info[lab] = (n, c)
    return sheet, labels, info


def main():
    t0 = time.time()
    sheet, labels, info = build_arch(skip=(13,))
    check("arch: one sheet of gum with 13 teeth on it (the UL second premolar left out)", len(sheet.split(only_watertight=False)) == 1 and len(info) == 13 and all((labels == l).sum() > 300 for l in info), (len(info), min((labels == l).sum() for l in info)))
    out = tempfile.mkdtemp(prefix="nlo_pontic_arch_")
    scan = os.path.join(out, "synthetic_upper.stl"); sheet.export(scan)
    # the scan as the app loads it: load_scan keeps the largest piece and may decimate - the labels follow by nearest vertex
    from bleachtray.mesh_utils import load_scan
    from bleachtray.orient import rough_orient
    from scipy.spatial import cKDTree
    raw = load_scan(scan)
    j = cKDTree(np.asarray(sheet.vertices)).query(np.asarray(raw.vertices))[1]
    lab_raw = labels[j]
    mesh_r, T_rough = rough_orient(raw)
    # the pontic as the page would place it: between UL4 (#12) and UL6 (#14), seat 2 mm under the crest, sized to the space
    a = info[[l for l, (n, c) in info.items() if n == 12][0]][1]; b = info[[l for l, (n, c) in info.items() if n == 14][0]][1]
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    zc = gum_z(*mid)
    M_raw = slot_frame([mid[0], mid[1], zc - 2.0], [b[0] - a[0], b[1] - a[1], 0.0], up=[0, 0, 1], outward=[mid[0], mid[1] - 10.0, 0.0])
    s13 = library()[13]
    gap = float(np.hypot(b[0] - a[0], b[1] - a[1])) - (library()[12]["w0"] + library()[14]["w0"]) / 2.0
    spec = dict(id="p1", n=13, slot="L5", w=round(gap - 0.6, 1), h=round(s13["h0"] + 0.5, 1), t=round(s13["t0"], 1), sink=2.0, mirror=False, m=M_raw.tolist())
    print(f"arch built in {time.time() - t0:.0f} s; the space is {gap:.1f} mm, pontic {spec['w']} x {spec['h']} x {spec['t']} mm")
    from bleachtray.pipeline import process
    from bleachtray.segment import load_models
    from bleachtray.server_presets import PRESETS
    params = dict(PRESETS["aligner_high"]); params.update(arch="upper", add_base=False, engrave=False, tooth_mark=False, pontics=[spec], patient_first="Synthetic", patient_last="Arch")
    logs = []
    rep = process(scan, out, name="synthetic_upper", params=params, models=load_models(), label_override=lab_raw, log=lambda m: (logs.append(m), print(m)), feat_cache={})
    pi = rep.get("pontics") or {}
    check("report: one pontic made, named and sized as asked", pi.get("count") == 1 and pi["pontics"][0]["slot"] == "L5" and pi["pontics"][0]["shape"] == "UL second premolar" and abs(pi["pontics"][0]["w"] - spec["w"]) < 1e-6, pi)
    check("report: fused with a fillet", (pi.get("pontics") or [{}])[0].get("fused", {}).get("fused") == 1, pi)
    check("no pontic warning", not any("pontic" in w.lower() for w in rep.get("warnings") or []), rep.get("warnings"))
    pon_path = os.path.join(out, "synthetic_upper_pontics.stl")
    check("the pontics file is written, watertight", os.path.exists(pon_path) and trimesh.load(pon_path).is_watertight)
    body = trimesh.load(os.path.join(out, "synthetic_upper_body_only.stl"))
    check("the body is watertight", rep.get("body_watertight") and body.is_watertight)
    # the pontic in the model's frame: its top inside the body, air above it not, and no air under its silhouette
    T = np.asarray(rep["transform_raw_to_output"], float)
    pm = trimesh.load(pon_path)
    vt = np.asarray(pm.vertices)[np.argmax(np.asarray(pm.vertices)[:, 2])]
    tip = body.contains(np.array([[vt[0], vt[1], vt[2] - 0.6], [vt[0], vt[1], vt[2] + 0.6]]))
    check("the pontic's top is in the model, the air above it is not", bool(tip[0]) and not bool(tip[1]), tip.tolist())
    # nothing of a pontic hangs under the model's floor (z = 0), and behind the last molars the line is on their margin
    check("no pontic reaches under the model's floor", float(pm.bounds[0][2]) >= -1e-3, round(float(pm.bounds[0][2]), 2))
    gb = rep.get("gap_beams") or []
    print("   gap beams:", gb)
    check("the space that holds the pontic gets no beam", len(gb) >= 1 and all(b.get("skipped") for b in gb), gb)
    dr = [r for r in (rep.get("distal_round") or []) if not r.get("incomplete")]
    print("   distal:", [(r["side"], r.get("hug_points"), r.get("hug_mm")) for r in dr])
    check("behind a whole last molar the margin step ran without an error", all("hug_points" in r and "hug_error" not in r for r in dr), dr)
    seat = (T @ np.asarray(M_raw))[:3, 3]
    pts = []
    for dx in np.linspace(-0.35 * spec["w"], 0.35 * spec["w"], 6):
        for dy in np.linspace(-0.3 * spec["t"], 0.3 * spec["t"], 5):
            q = (T @ np.asarray(M_raw) @ np.array([dx, dy, 0.0, 1.0]))[:3]
            loc, _, _ = pm.ray.intersects_location([[q[0], q[1], q[2] - 6.0]], [[0.0, 0.0, 1.0]])
            if not len(loc):
                continue
            for z in np.arange(float(loc[:, 2].min()) - 2.5, float(loc[:, 2].min()) + 0.4, 0.3):
                pts.append([q[0], q[1], z])
    inside = body.contains(np.asarray(pts))
    check("no air under the pontic (the columns under it are solid down into the ridge)", inside.mean() > 0.97, f"{inside.mean():.3f} of {len(pts)}")
    # the trim line goes round the pontic, not through it: no line point inside the pontic solid
    st = np.load(os.path.join(out, "synthetic_upper_state.npz"))
    margin = np.asarray(st["margin"])
    inside_p = pm.contains(margin)
    check("the trim line does not pass through the pontic", inside_p.sum() <= 2, int(inside_p.sum()))
    near = np.linalg.norm(margin[:, :2] - seat[:2], axis=1) < 6.0
    check("... and runs past it on both sides (line points within 6 mm of its seat)", near.sum() >= 8, int(near.sum()))
    check("the teeth were counted as given: 13 teeth, one position gap on the left", len(rep.get("teeth") or {}) == 13, len(rep.get("teeth") or {}))
    print(f"done in {time.time() - t0:.0f} s; outputs in {out}")
    print()
    print("ALL OK" if not fails else f"{len(fails)} FAILED: {fails}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
