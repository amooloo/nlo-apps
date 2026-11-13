"""The reservoir's margins and the bite check on a synthetic tooth row.

The doctor, 11/13/2026: reservoirs "about 1 to 1.5 mm from the gingival margin and the interproximals - that should be
the default"; "in the lower the reservoir should be a bit shorter because of the occlusion"; "check the occlusion making
sure the patient is not biting into the reservoirs".

    python tools/test_reservoir_margins.py
"""
import os, sys
import numpy as np, trimesh
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bleachtray.reservoir import reservoir_displacement, bite_keep_off
from bleachtray.segment import geodesic_from_boundary
from bleachtray.mesh_utils import adjacency
from bleachtray.pipeline import DEFAULTS

fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        fails.append(name)

# a facial wall: x along the arch, z up, facing -y; three teeth 8 mm wide and 9 mm tall over 4 mm of gum
xs, zs = np.arange(-14, 14.01, 0.25), np.arange(-4, 9.01, 0.25)
X, Z = np.meshgrid(xs, zs, indexing="ij")
V = np.column_stack([X.ravel(), np.maximum(Z.ravel() - 8.0, 0.0) * 1.2, Z.ravel()])      # the top millimetre leans back: the incisal edge
nx, nz = len(xs), len(zs)
idx = np.arange(X.size).reshape(nx, nz)
F = np.vstack([np.column_stack([idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()]),
               np.column_stack([idx[:-1, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()])])
mesh = trimesh.Trimesh(V, F, process=False)
if mesh.vertex_normals[:, 1].mean() > 0:
    mesh.invert()
labels = np.zeros(len(V), int)
for t, x0 in ((1, -12.0), (2, -4.0), (3, 4.0)):
    labels[(V[:, 0] >= x0) & (V[:, 0] < x0 + 8.0) & (V[:, 2] >= 0)] = t
info = {1: (-1, 2), 2: (-1, 1), 3: (1, 1)}
A = adjacency(mesh)
aux = dict(out_dir=np.tile(np.array([0.0, -1.0]), (len(V), 1)))
kw = dict(height=0.5, feather=0.6, max_position=5, exclude_occlusal=False)

check("the defaults: 1.25 mm off the gum line and off the next tooth", DEFAULTS["reservoir_setback"] == 1.25 and DEFAULTS["reservoir_interprox"] == 1.25, (DEFAULTS["reservoir_setback"], DEFAULTS["reservoir_interprox"]))
d0 = reservoir_displacement(mesh, labels, info, aux, A, setback=1.25, **kw)
d1 = reservoir_displacement(mesh, labels, info, aux, A, setback=1.25, interprox=1.25, **kw)
on0, on1 = d0 > 0.02, d1 > 0.02
mid = labels == 2
gap_x = lambda on: float(V[on & (labels == 3)][:, 0].min() - V[on & mid][:, 0].max())
check("the reservoir reaches its height on each tooth", all(d1[labels == t].max() > 0.45 for t in (1, 2, 3)), [round(float(d1[labels == t].max()), 2) for t in (1, 2, 3)])
check("... and starts 1.25 mm above the gum line", 1.2 <= float(V[on1][:, 2].min()) <= 1.6, float(V[on1][:, 2].min()))
check(f"between two teeth: {gap_x(on1):.2f} mm of bare tooth (was {gap_x(on0):.2f})", 2.4 <= gap_x(on1) <= 3.2 and gap_x(on0) < 1.5)
top = lambda d: float(V[(d > 0.02)][:, 2].max())
d2 = reservoir_displacement(mesh, labels, info, aux, A, setback=1.25, interprox=1.25, incisal=1.0, **kw)
check(f"a lower's reservoir stops further from the incisal edge (top at z {top(d2):.2f}, was {top(d1):.2f})", top(d2) <= top(d1) - 0.2)

# the bite: an opposing plate 1 mm in front of the top 3 mm of the middle tooth
ox, oz = np.meshgrid(np.arange(-4, 4.01, 0.2), np.arange(6, 9.01, 0.2), indexing="ij")
OV = np.column_stack([ox.ravel(), np.full(ox.size, -1.0), oz.ravel()])
oi = np.arange(ox.size).reshape(ox.shape)
OF = np.vstack([np.column_stack([oi[:-1, :-1].ravel(), oi[1:, :-1].ravel(), oi[1:, 1:].ravel()]), np.column_stack([oi[:-1, :-1].ravel(), oi[1:, 1:].ravel(), oi[:-1, 1:].ravel()])])
opp = trimesh.Trimesh(OV, OF, process=False)
if opp.vertex_normals[:, 1].mean() < 0:
    opp.invert()                                    # it faces the teeth (+y)
bm, bi = bite_keep_off(mesh, labels, opp, clear_mm=1.5)
check("an opposing arch in occlusion is used", bi.get("checked") is True and bm is not None and bm.any(), bi)
d3 = reservoir_displacement(mesh, labels, info, aux, A, setback=1.25, interprox=1.25, bite_off=bm, **kw)
check("no reservoir where the opposing teeth come within 1.5 mm", not (d3[bm] > 0.02).any() and (d1[bm] > 0.02).any())
check("... the rest of that tooth and the other teeth keep theirs", d3[mid].max() > 0.45 and abs(d3[labels == 1].max() - d1[labels == 1].max()) < 1e-6)
far = opp.copy(); far.apply_translation((0, -60.0, 0))
check("an opposing arch nowhere near: not checked, said so", bite_keep_off(mesh, labels, far)[1].get("checked") is False)
thru = opp.copy(); thru.apply_translation((0, 3.0, 0))            # 2 mm behind the teeth's surface
bm2, bi2 = bite_keep_off(mesh, labels, thru)
check("an opposing arch passing through the teeth (no bite scan): not used, said so", bm2 is None and bi2.get("checked") is False and "not in occlusion" in bi2.get("why", ""), bi2)
check("no opposing arch: not checked", bite_keep_off(mesh, labels, None)[1].get("checked") is False)
print("\nALL OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
