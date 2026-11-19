"""The reservoir's outline: one smooth line, a step that shows on the print, in small triangles.

The doctor, 11/19/2026: "the line for the reservoirs is not really super refined ... the part that goes towards the gums
needs to be as straight / smooth as possible ... the reservoir needs to be smooth all around ... when I cut the trays
afterwards I want to be able to see that line clearly. Right now I think the triangles are way too big."

    python tools/test_reservoir_outline.py            (the wall: seconds)
    python tools/test_reservoir_outline.py --arch     (plus a synthetic full arch through the whole pipeline: minutes)
"""
import os, sys, tempfile
import numpy as np, trimesh
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from bleachtray.reservoir import reservoir_displacement, refine_edge_band, refine_reservoir_edge, reservoir_profile
from bleachtray.mesh_utils import adjacency
from bleachtray.pipeline import DEFAULTS

fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        fails.append(name)

# a facial wall like a scan's: x along the arch, z up, facing -y; irregular triangles of about 0.3 mm (points scattered
# and triangulated - a scan is not a grid); three teeth 8 mm wide, 9 mm tall, over 4 mm of gum; the gum line is the
# vertices nearest a gently scalloped curve - a staircase, as on a scan
from scipy.spatial import Delaunay
rng = np.random.default_rng(int(os.environ.get("NLO_TEST_SEED", "7")))
h = 0.3
xs, zs = np.arange(-14, 14.01, h), np.arange(-4, 9.01, h)
X, Z = np.meshgrid(xs, zs, indexing="ij")
Xj = X + rng.uniform(-0.14, 0.14, X.shape); Zj = Z + rng.uniform(-0.14, 0.14, Z.shape)
Xj[[0, -1], :] = X[[0, -1], :]; Zj[:, [0, -1]] = Z[:, [0, -1]]
V = np.column_stack([Xj.ravel(), np.maximum(Zj.ravel() - 8.0, 0.0) * 1.2, Zj.ravel()])
F = Delaunay(V[:, [0, 2]]).simplices
mesh = trimesh.Trimesh(V, F, process=False)
mesh.fix_normals()
if mesh.vertex_normals[:, 1].mean() > 0:
    mesh.invert()
F = np.asarray(mesh.faces)
gum_line = lambda x: 1.5 * np.sin(np.pi * x / 8.0) ** 2          # the scallop: lowest at the middle of each tooth (x = -8, 0, 8), 1.5 mm higher at the papillae between them
_gx = np.arange(-14, 14.001, 0.01)
from scipy.spatial import cKDTree
_gum_tree = cKDTree(np.column_stack([_gx, gum_line(_gx)]))
to_gum = lambda P: _gum_tree.query(np.asarray(P)[:, [0, 2]])[0]      # true distance (mm, on the wall) from the gum line
labels = np.zeros(len(V), int)
for t, x0 in ((1, -12.0), (2, -4.0), (3, 4.0)):
    labels[(V[:, 0] >= x0) & (V[:, 0] < x0 + 8.0) & (V[:, 2] >= gum_line(V[:, 0]))] = t
info = {1: (-1, 2), 2: (-1, 1), 3: (1, 1)}
A = adjacency(mesh)
aux = dict(out_dir=np.tile(np.array([0.0, -1.0]), (len(V), 1)))
kw = dict(height=0.5, max_position=5, exclude_occlusal=False, setback=1.25, interprox=1.25)


def outline_points(Vv, Ff, s):
    """Where the outline (s = 0) crosses the triangles' edges."""
    E = np.vstack([Ff[:, [0, 1]], Ff[:, [1, 2]], Ff[:, [2, 0]]])
    E = np.unique(np.sort(E, axis=1), axis=0)
    a, b = s[E[:, 0]], s[E[:, 1]]
    c = (a > 0) != (b > 0)
    t = a[c] / (a[c] - b[c])
    return Vv[E[c, 0]] + (Vv[E[c, 1]] - Vv[E[c, 0]]) * t[:, None]


def gum_side(P):
    """The gum-side line of the middle tooth's island, between x = -1 and 1 (clear of the island's rounded corners). -> (jaggedness: how far its points
    stray, rms mm, from an even curve drawn through them; its distance from the gum line, median and smallest, mm;
    number of points)."""
    m = (np.abs(P[:, 0]) < 1.0) & (P[:, 2] < 3.5)
    x, zz = P[m, 0], P[m, 2]
    jag = zz - np.polyval(np.polyfit(x, zz, 3), x)
    off = to_gum(P[m])
    return float(np.sqrt((jag ** 2).mean())), float(np.median(off)), float(off.min()), int(m.sum())

check("the defaults: a 0.3 mm step at the outline, triangles of 0.1 mm along it", DEFAULTS.get("reservoir_edge") == 0.3 and DEFAULTS.get("reservoir_edge_tri") == 0.1, (DEFAULTS.get("reservoir_edge"), DEFAULTS.get("reservoir_edge_tri")))
d_raw, s_raw = reservoir_displacement(mesh, labels, info, aux, A, outline_smooth=0, return_field=True, **kw)
d, s = reservoir_displacement(mesh, labels, info, aux, A, return_field=True, **kw)
check("without return_field the call returns the displacement alone, as before", np.allclose(reservoir_displacement(mesh, labels, info, aux, A, **kw), d))
j0, off0, var0, n0 = gum_side(outline_points(V, F, s_raw)); j1, off1, var1, n1 = gum_side(outline_points(V, F, s))
print(f"   gum-side line of the middle tooth: jagged by {j1:.3f} mm rms (unsmoothed: {j0:.3f}); {off1:.2f} mm from the gum line (closest {var1:.2f}; unsmoothed {off0:.2f} / {var0:.2f}); {n1} points")
check("the gum-side line is smooth: within 0.01 mm rms of an even curve, and at least four times as even as the raw one", n1 > 12 and j1 < 0.01 and j1 < 0.25 * j0, (j1, j0))
check("... and runs 1.25 mm from the gum line (within 0.2 mm; it is a little straighter than the gum line), nowhere closer than 1.15", abs(off1 - 1.25) < 0.2 and var1 >= 1.15, (off1, var1))
# all round the island: the side next to the neighbouring tooth and the incisal side are as even
def jag(P, m, along, across):
    u, v = P[m, along], P[m, across]
    r = v - np.polyval(np.polyfit(u, v, 3), u)
    return float(np.sqrt((r ** 2).mean())), int(m.sum())
P0, P1 = outline_points(V, F, s_raw), outline_points(V, F, s)
for what, sel in (("next to the neighbouring tooth", lambda P: (P[:, 0] > 1.5) & (P[:, 0] < 3.9) & (P[:, 2] > 3.2) & (P[:, 2] < 6.2)), ("incisal", lambda P: (np.abs(P[:, 0]) < 1.5) & (P[:, 2] > 5.5))):
    al, ac = (2, 0) if what.startswith("next") else (0, 2)
    (a0, _), (a1, k1) = jag(P0, sel(P0), al, ac), jag(P1, sel(P1), al, ac)
    print(f"   the {what} side: jagged by {a1:.3f} mm rms (unsmoothed {a0:.3f}); {k1} points")
    check(f"the {what} side of the outline is smooth too", k1 > 15 and a1 < 0.025 and a1 < 0.4 * a0, (a1, a0))
Pall = outline_points(V, F, s)
gd = to_gum(Pall[Pall[:, 2] < 7.5])
check(f"the whole outline keeps its distance from the gum line (closest {gd.min():.2f} mm)", float(gd.min()) >= 1.15, float(gd.min()))
check("... and still reaches its full height on every tooth", all(d[labels == t].max() > 0.49 for t in (1, 2, 3)))
# the step: full height within 0.3 mm of the outline, not a long slope
wall = (s > 0.0) & (s < 0.3)
check("the side is a step: full height 0.3 mm in from the outline", np.all(d[s >= 0.3] > 0.499) and np.all(d[s <= 0] == 0.0) and wall.any())

# small triangles along the outline
N = np.asarray(mesh.vertex_normals)
V1, F1, s1, (N1,), levels = refine_edge_band(V, F, s, attrs=(N,), lo=-0.06, hi=0.36, max_edge=0.08)
def edge_use(Ff):
    E = np.sort(np.vstack([Ff[:, [0, 1]], Ff[:, [1, 2]], Ff[:, [2, 0]]]), axis=1)
    return np.unique(E, axis=0, return_counts=True)
E0, c0 = edge_use(F); E1, c1 = edge_use(F1)
check(f"the band is subdivided ({len(F)} -> {len(F1)} triangles, {levels} passes)", levels >= 2 and len(F1) > len(F))
check("the surface stays closed: no edge with more than two triangles, no new open edge inside", c1.max() == 2 and c0.max() == 2)
bl = lambda Vv, E, c: float(np.linalg.norm(Vv[E[c == 1][:, 0]] - Vv[E[c == 1][:, 1]], axis=1).sum())
check("... the open border is the scan's own, unchanged in length", abs(bl(V, E0, c0) - bl(V1, E1, c1)) < 1e-6, (bl(V, E0, c0), bl(V1, E1, c1)))
check("the scan's own vertices keep their numbers and places", np.array_equal(V1[:len(V)], V) and np.array_equal(s1[:len(V)], s))
m0 = trimesh.Trimesh(V, F, process=False); m1 = trimesh.Trimesh(V1, F1, process=False)
check("same surface: the area is unchanged and no triangle is flipped", abs(m0.area - m1.area) < 1e-6 * m0.area and float((m1.face_normals[:, 1]).max()) < 0.2, (m0.area, m1.area))
fs = s1[F1]; inband = (fs.min(1) < 0.30) & (fs.max(1) > 0.0)
L1 = np.linalg.norm(V1[F1[inband]][:, [0, 1, 2]] - V1[F1[inband]][:, [1, 2, 0]], axis=2)
check(f"every triangle on the side wall has edges of 0.08 mm or less (longest {L1.max():.3f})", L1.max() <= 0.0801)
ang = np.degrees(np.sort(m1.face_angles[inband], axis=1)[:, 0]); ang0 = np.degrees(np.sort(m0.face_angles, axis=1)[:, 0])
print(f"   smallest corner on the side wall: {ang.min():.1f} deg (the scan's own triangles: {ang0.min():.1f}); under 10 deg: {100 * (ang < 10).mean():.1f}% (scan {100 * (ang0 < 10).mean():.1f}%)")
check("... and the splitting makes few slivers (corners under 10 deg: under 3% of the wall's triangles)", (ang < 10).mean() < 0.03 and ang.min() > 0.3 * ang0.min(), (ang.min(), ang0.min()))
md = trimesh.Trimesh(V + N * d[:, None], F, process=False)
out, ri = refine_reservoir_edge(md, N, d, s, 0.5, edge=0.3, max_edge=0.08)
Vo = np.asarray(out.vertices)
moved = np.linalg.norm(Vo[:len(V)] - np.asarray(md.vertices), axis=1)
awayv = (s < -0.35) | (s > 0.65)
check(f"the model's surface: refined; the scan's vertices keep their order, stay put away from the outline and move at most {moved.max():.3f} mm on the side wall",
      ri.get("refined") and len(Vo) > len(V) and moved[awayv].max() < 1e-9 and moved.max() < 0.12, (ri, float(moved.max())))
# the refined wall is a step: flat below the outline, full height 0.3 mm in, and the outline on the small triangles is one curve
lift = -(Vo[:, 1] - np.r_[V[:, 1], V1[len(V):, 1]])          # the wall faces -y; the incisal lean has no reservoir on it
flat = np.r_[V[:, 2], V1[len(V):, 2]] < 7.0
s_all = np.r_[s, s1[len(V):]]
check("the side is a step on the small triangles too: nothing raised outside the outline, full height from 0.45 mm in", lift[flat & (s_all < -0.15)].max() < 1e-6 and lift[flat & (s_all > 0.45)].min() > 0.49,
      (float(lift[flat & (s_all < -0.15)].max()), float(lift[flat & (s_all > 0.45)].min())))
Fo = np.asarray(out.faces)
half = lift - 0.25                                           # the outline as printed: the middle of the step
Ph = outline_points(np.column_stack([Vo[:, 0], np.zeros(len(Vo)), Vo[:, 2]]), Fo, half)
jf, _, _, nf = gum_side(Ph)
mh = (np.abs(Ph[:, 0]) < 1.0) & (Ph[:, 2] < 3.5); o_ = np.argsort(Ph[mh, 0]); Q = Ph[mh][o_][:, [0, 2]]
seg = np.diff(Q, axis=0); seg = seg[np.linalg.norm(seg, axis=1) > 1e-4]; turn = np.degrees(np.abs(np.diff(np.unwrap(np.arctan2(seg[:, 1], seg[:, 0])))))
print(f"   the step's mid-line on the small triangles, gum side: {nf} points, jagged by {jf:.4f} mm rms, sharpest turn between two pieces {turn.max():.0f} deg")
check("the printed line is one curve: under 0.015 mm rms off an even curve, no corner over 30 deg", nf > 100 and jf < 0.015 and turn.max() < 30, (nf, jf, float(turn.max())))
nw0 = int(((d > 0.02) & (d < 0.48)).sum()); nw1 = int(((lift > 0.02) & (lift < 0.48) & flat).sum())
print(f"   vertices on the side wall: {nw1} (the scan's own: {nw0})")
check("the side wall is carried by at least 8 times as many vertices as before", nw1 >= 8 * nw0, (nw1, nw0))
flatm = trimesh.Trimesh(V, F, process=False)
same, ri0 = refine_reservoir_edge(flatm, N, np.zeros(len(V)), s, 0.5)
check("no reservoir: the mesh is handed back untouched", same is flatm and not ri0.get("refined"))

if "--arch" in sys.argv:
    # a synthetic full upper arch (the pontic library's teeth on a gum ridge - no patient data) as a whitening tray
    sys.path.insert(0, HERE)
    from test_pontics_arch import build_arch
    from bleachtray.mesh_utils import load_scan
    from bleachtray.pipeline import process
    from bleachtray.segment import load_models
    from scipy.spatial import cKDTree
    sheet, lab, tinfo = build_arch(skip=())
    outd = tempfile.mkdtemp(prefix="nlo_res_outline_")
    scan = os.path.join(outd, "synthetic_upper.stl"); sheet.export(scan)
    raw = load_scan(scan)
    lab_raw = lab[cKDTree(np.asarray(sheet.vertices)).query(np.asarray(raw.vertices))[1]]
    params = dict(DEFAULTS); params.update(arch="upper", add_base=False, engrave=False, tooth_mark=False, patient_first="Synthetic", patient_last="Arch")
    rep = process(scan, outd, name="synthetic_upper", params=params, models=load_models(), label_override=lab_raw, log=print, feat_cache={})
    ro = rep.get("reservoir_outline") or {}
    print("   report:", ro, "reservoir vertices:", rep.get("reservoir_vertices"))
    check("arch: reservoirs made and their outline refined", rep.get("reservoir_vertices", 0) > 500 and ro.get("refined") and ro.get("faces_after", 0) > ro.get("faces_before", 0), ro)
    body = trimesh.load(os.path.join(outd, "synthetic_upper_body_only.stl"))
    check("arch: the model is watertight", bool(rep.get("body_watertight")) and body.is_watertight)
    check("arch: the model carries the small triangles", len(body.faces) > ro.get("faces_before", 0) + 0.5 * (ro.get("faces_after", 0) - ro.get("faces_before", 0)), len(body.faces))
    sr = trimesh.load(os.path.join(outd, "synthetic_upper_scan_with_reservoirs_NOBASE_not_for_trimlign.stl"))
    check("arch: the scan-with-reservoirs export is refined too", len(sr.faces) > len(raw.faces) + 1000, (len(sr.faces), len(raw.faces)))
    check("arch: no warning about the outline", not any("outline" in w.lower() for w in rep.get("warnings") or []), rep.get("warnings"))
    print("   output folder:", outd)

print("\nALL OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
