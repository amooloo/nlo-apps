"""Rebuild the Trimlign base as a clean manifold solid by stacking exact XY cross-sections.

Every feature on the plate is vertical (hole, slot, pockets, fiducials, T-rail), so the solid is
reproduced exactly in XY and to within `dz` vertically.  Output: assets/trimlign_base_manifold.stl
"""
import sys, numpy as np, trimesh
import manifold3d as m3
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union, polygonize

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/trimlign_base_titan.stl"
DZ = 0.05

base = trimesh.load(SRC, force="mesh")
zmin, zmax = base.bounds[0][2], base.bounds[1][2]
print("base z range", round(zmin, 3), round(zmax, 3))


def section_region(mesh, z):
    """Return a shapely (Multi)Polygon of the solid region at height z."""
    s = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None:
        return None
    rings = []
    for p in s.discrete:
        if len(p) >= 4:
            ring = Polygon(p[:, :2])
            if not ring.is_valid:
                ring = ring.buffer(0)
            if ring.area > 1e-4:
                rings.append(ring)
    if not rings:
        return None
    # even-odd: sort by area desc, a ring inside another is a hole
    rings.sort(key=lambda r: -r.area)
    region = None
    for r in rings:
        region = r if region is None else region.symmetric_difference(r)
    return region


def polygon_to_manifold(region, z0, z1):
    polys = region.geoms if isinstance(region, MultiPolygon) else [region]
    cs = []
    for poly in polys:
        if poly.area < 1e-4:
            continue
        loops = [np.array(poly.exterior.coords[:-1], dtype=np.float64)]
        for hole in poly.interiors:
            loops.append(np.array(hole.coords[:-1], dtype=np.float64))
        cs.append(m3.CrossSection(loops, fillrule=m3.FillRule.EvenOdd))
    if not cs:
        return None
    c = cs[0]
    for other in cs[1:]:
        c = c + other
    man = m3.Manifold.extrude(c, z1 - z0).translate([0, 0, z0])
    return man


levels = np.arange(zmin + DZ / 2, zmax, DZ)
slabs = []
prev_area = None
for z in levels:
    reg = section_region(base, z)
    if reg is None or reg.area < 1e-3:
        continue
    reg = reg.buffer(0.01, join_style=2).simplify(0.002)  # 10 µm lateral overlap so adjacent slabs fuse without hairline gaps
    man = polygon_to_manifold(reg, z - DZ / 2 - 0.002, z + DZ / 2 + 0.002)
    if man is not None and man.status() == m3.Error.NoError:
        slabs.append(man)
print("slabs:", len(slabs))

solid = m3.Manifold.batch_boolean(slabs, m3.OpType.Add)
print("status", solid.status(), "volume", round(solid.volume(), 2), "genus", solid.genus())
if hasattr(solid, "simplify"):
    solid = solid.simplify(0.01)
    print("after simplify: volume", round(solid.volume(), 2), "genus", solid.genus(), "tris", solid.num_tri())
mesh = solid.to_mesh()
out = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=False)
print("faces", len(out.faces), "watertight", out.is_watertight, "volume", round(out.volume, 2), "bounds", np.round(out.bounds, 3).tolist())
import os
dst = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "trimlign_base_manifold.ply")
out.export(dst)   # PLY keeps vertex connectivity; load with process=False
print("saved", dst)
