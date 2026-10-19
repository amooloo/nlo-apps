"""The Trimlign base as a clean manifold solid, rebuilt from Titan's own base, and the checks that keep it right.

Titan's base mesh is not watertight (separate islands, zero-area faces), so the app cannot use it in a boolean.
It is rebuilt by stacking exact horizontal cross-sections (every feature on the plate is vertical: the locating
holes, the slot, the pockets, the fiducials, the T-rail), `dz` apart.

What went wrong before (19 Oct 2026, "the holes on the base are shallow by a lot"): a cross-section is turned into
a solid region by even-odd nesting of its contours. In the lighter Titan exports (a ~17,000-face base instead of
~110,000) the plane at one height (1.875 mm) misses a single contour, the even-odd parity of everything inside it
flips, and that one slab came out solid across both locating holes - a 0.05 mm skin at 1.85 mm that the printer
prints, so the pins stopped at 1.85 mm instead of 3.5. Which Titan export the lab PC happened to import decided
whether its base had the skin. Now:
  * each slab is the majority of three sections a hair apart (a degenerate plane at one exact height loses),
  * a slab that differs from both neighbours where the neighbours agree with each other is an outlier and is
    replaced by the majority of the three (a run of bad sections loses too),
  * the result is checked against Titan's mesh with vertical rays on a grid (an independent test, no sectioning):
    no thin solid layer where Titan's base is open (a skin), and the two locating holes clear from the bottom to
    3.5 mm (Titan's: 3.51).
`ensure_base` runs this check on the app's base when the app starts and rebuilds a base that fails it.
"""
import os, json, hashlib, threading, time
import numpy as np
import trimesh

LOCATING_HOLES = [(7.47, -19.0), (-7.47, -19.0)]   # the Trimlign base's two locating holes (Titan's frame)
HOLE_DEPTH = 3.5                                    # clear from the bottom up to here (Titan's ceiling: 3.51 mm)
LOCK = threading.Lock()                             # held while the base is checked / rebuilt (load_base waits)


# ---------------------------------------------------------------- sections
def section_region(mesh, z):
    """The solid region at height z: a shapely (Multi)Polygon, contours nested even-odd (None when empty)."""
    from shapely.geometry import Polygon
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
    rings.sort(key=lambda r: -r.area)
    region = None
    for r in rings:
        region = r if region is None else region.symmetric_difference(r)
    return region


def _empty():
    from shapely.geometry import Polygon
    return Polygon()


def _majority(regs):
    """Point-wise majority of three regions (in at least two of them)."""
    from shapely.ops import unary_union
    a, b, c = [r if r is not None else _empty() for r in regs]
    return unary_union([a.intersection(b), a.intersection(c), b.intersection(c)])


def _sym(a, b):
    a = a if a is not None else _empty(); b = b if b is not None else _empty()
    return float(a.symmetric_difference(b).area)


def robust_region(mesh, z, off):
    """The majority of the sections at z - off, z, z + off: a plane that is degenerate at one exact height loses."""
    regs = [section_region(mesh, z + d) for d in (-off, 0.0, off)]
    if all(r is not None for r in regs) and _sym(regs[0], regs[1]) < 1e-3 and _sym(regs[1], regs[2]) < 1e-3:
        return regs[1]
    m = _majority(regs)
    return m if not m.is_empty else None


# ---------------------------------------------------------------- the rebuild
def rebuild(src, dz=0.05, log=print):
    """Titan's base mesh -> a manifold trimesh of the same solid (exact in XY, to within dz vertically)."""
    import manifold3d as m3
    from shapely.geometry import MultiPolygon
    zmin, zmax = float(src.bounds[0][2]), float(src.bounds[1][2])
    levels = np.arange(zmin + dz / 2, zmax, dz)
    regs = [robust_region(src, float(z), 0.24 * dz) for z in levels]
    # a slab unlike both neighbours where they agree with each other is a bad section: the majority of the three.
    # (A slope changes the region steadily, so the two differences add up to the one across: no outlier.)
    fixed = 0
    for k in range(1, len(regs) - 1):
        a, b, c = regs[k - 1], regs[k], regs[k + 1]
        d_ab, d_bc, d_ac = _sym(a, b), _sym(b, c), _sym(a, c)
        if d_ab + d_bc > 2.5 * d_ac + 0.5:
            m = _majority([a, b, c])
            regs[k] = m if not m.is_empty else None
            fixed += 1
    if fixed and log:
        log(f"base rebuild: {fixed} slab{'s' if fixed > 1 else ''} unlike both neighbours replaced (a bad section of Titan's mesh)")

    def to_manifold(region, z0, z1):
        polys = region.geoms if isinstance(region, MultiPolygon) else [region]
        cs = []
        for poly in polys:
            if poly.geom_type != "Polygon" or poly.area < 1e-4:
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
        return m3.Manifold.extrude(c, z1 - z0).translate([0, 0, z0])

    slabs = []
    for z, reg in zip(levels, regs):
        if reg is None or reg.area < 1e-3:
            continue
        reg = reg.buffer(0.01, join_style=2).simplify(0.002)   # 10 µm lateral overlap so adjacent slabs fuse without hairline gaps
        man = to_manifold(reg, z - dz / 2 - 0.002, z + dz / 2 + 0.002)
        if man is not None and man.status() == m3.Error.NoError:
            slabs.append(man)
    solid = m3.Manifold.batch_boolean(slabs, m3.OpType.Add)
    if hasattr(solid, "simplify"):
        solid = solid.simplify(0.01)
    mesh = solid.to_mesh()
    return trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=False)


# ---------------------------------------------------------------- checks (vertical rays: independent of the sectioning)
def crossings(mesh, pts, z0=-5.0):
    """For each (x, y): the sorted heights where a vertical ray from below crosses the surface."""
    from trimesh.ray.ray_triangle import RayMeshIntersector
    pts = np.asarray(pts, float)
    R = RayMeshIntersector(mesh)
    o = np.c_[pts, np.full(len(pts), z0)]
    d = np.tile([0.0, 0.0, 1.0], (len(pts), 1))
    locs, iray, _ = R.intersects_location(o, d, multiple_hits=True)
    out = [[] for _ in range(len(pts))]
    for l, r in zip(np.asarray(locs).reshape(-1, 3), iray):
        out[int(r)].append(float(l[2]))
    res = []
    for z in out:
        z = sorted(z); dd = []
        for v in z:                                  # a ray through an edge counts its crossing twice
            if not dd or v - dd[-1] > 0.02:
                dd.append(v)
        res.append(dd)
    return res


def _disc(cx, cy, r=1.8, rings=6):
    pts = [(cx, cy)]
    for rr in np.linspace(r / rings, r, rings):
        k = max(6, int(2 * np.pi * rr / 0.4))
        pts += [(cx + rr * np.cos(t), cy + rr * np.sin(t)) for t in np.linspace(0, 2 * np.pi, k, endpoint=False)]
    return pts


def hole_depths(mesh, holes=LOCATING_HOLES):
    """How far up each locating hole is clear from the bottom (the lowest first surface over a disc 1.8 mm round its
    centre). Titan's base: 3.51 mm. A skin across the hole shows as a smaller number."""
    out = []
    for (cx, cy) in holes:
        firsts = [c[0] if c else 99.0 for c in crossings(mesh, _disc(cx, cy))]
        out.append(round(min(firsts), 2))
    return out


def skins(src, out, step=0.5, thin=0.15):
    """Vertical rays on a grid over the base: thin solid layers (under `thin` mm, air above and below) in the rebuilt
    base where Titan's base is open - a skin like the one that blocked the locating holes. Titan's side is read by
    the parity of its crossings (its mesh is not watertight: a point where the parity does not work out is skipped).
    Returns {points, skins: [(x, y, z)...]}."""
    (x0, y0), (x1, y1) = src.bounds[0][:2], src.bounds[1][:2]
    xs = np.arange(x0 + 0.137, x1, step); ys = np.arange(y0 + 0.113, y1, step)
    pts = np.array([(x, y) for x in xs for y in ys])
    cs, co = crossings(src, pts), crossings(out, pts)
    found = []
    for p, s, o in zip(pts, cs, co):
        if len(o) % 2 or len(s) % 2:
            continue
        for a, b in zip(o[0::2], o[1::2]):
            if b - a < thin and a > 0.3:          # (the first 0.3 mm: the bottom's own chamfers, where a ray grazes an edge)
                zm = 0.5 * (a + b)
                if sum(1 for v in s if v < zm) % 2 == 0:          # Titan's base is open there
                    found.append((round(float(p[0]), 2), round(float(p[1]), 2), round(zm, 2)))
    return dict(points=int(len(pts)), skins=found)


def _largest_cluster(pts, step):
    """The size of the largest group of grid points that touch (8-neighbours)."""
    idx = {(int(round(x / step)), int(round(y / step))) for x, y in pts}
    seen, best = set(), 0
    for p in idx:
        if p in seen:
            continue
        stack, n = [p], 0
        seen.add(p)
        while stack:
            i, j = stack.pop(); n += 1
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    q = (i + di, j + dj)
                    if q in idx and q not in seen:
                        seen.add(q); stack.append(q)
        best = max(best, n)
    return best


def verify(src, out, log=print):
    """-> (ok, summary) for a rebuilt base against Titan's: the locating holes clear, no skins, watertight."""
    depths = hole_depths(out)
    sk = skins(src, out)
    holes_ok = all(d >= HOLE_DEPTH - 0.15 for d in depths)
    # a skin covers an area: dozens of neighbouring grid points (one across a locating hole: ~58). A ray grazing a
    # wall gives a point here and there - isolated points are not a skin
    at = sorted({(x, y) for x, y, _ in sk["skins"]})
    biggest = _largest_cluster(at, 0.5)
    summary = dict(hole_depths=depths, grid_points=sk["points"], skins=len(sk["skins"]), skin_points=len(at), skin_cluster=biggest,
                   skin_sample=sk["skins"][:8], watertight=bool(out.is_watertight),
                   ok=bool(holes_ok and biggest < 4 and len(at) <= 12 and out.is_watertight))
    if log:
        log(f"base check: locating holes clear to {', '.join(f'{d:.2f}' for d in depths)} mm (Titan: 3.51), "
            f"thin layers where Titan's base is open at {len(at)} of {sk['points']} grid points (largest patch {biggest}), "
            f"watertight {out.is_watertight} -> {'OK' if summary['ok'] else 'NOT OK'}")
    return summary["ok"], summary


# ---------------------------------------------------------------- the app's base: checked once, rebuilt when it fails
def _md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def asset_paths(root):
    a = os.path.join(root, "assets")
    return os.path.join(a, "trimlign_base_titan.stl"), os.path.join(a, "trimlign_base_manifold.ply"), os.path.join(a, "trimlign_base_manifold.ok")


def ensure_base(root, log=print, force=False):
    """Check the app's manifold base once (cached by its checksum in assets/trimlign_base_manifold.ok); when its
    locating holes are not clear, rebuild it from Titan's base with the fixed rebuild and check that. Returns a
    status dict. Holds LOCK meanwhile, so no model is finished with a base that is being replaced."""
    titan, man, okf = asset_paths(root)
    with LOCK:
        if not (os.path.exists(titan) and os.path.exists(man)):
            return dict(ok=None, note="no base imported yet")
        sig = _md5(man)
        try:
            prev = json.load(open(okf)) if os.path.exists(okf) else None
        except Exception:  # noqa
            prev = None
        if prev and prev.get("sig") == sig and prev.get("ok") and not force:
            return dict(prev, cached=True)
        t0 = time.time()
        cur = trimesh.load(man, force="mesh", process=False)
        depths = hole_depths(cur)
        if all(d >= HOLE_DEPTH - 0.15 for d in depths) and not force:
            st = dict(ok=True, sig=sig, hole_depths=depths, checked=time.time(), rebuilt=False)
            json.dump(st, open(okf, "w"))
            log(f"Trimlign base: locating holes clear to {', '.join(f'{d:.2f}' for d in depths)} mm - OK")
            return st
        log(f"Trimlign base: the locating holes are blocked at {', '.join(f'{d:.2f}' for d in depths)} mm (should be clear to 3.5) - rebuilding it from Titan's base")
        src = trimesh.load(titan, force="mesh")
        out = rebuild(src, log=log)
        ok, summ = verify(src, out, log=log)
        if not ok:
            log("Trimlign base: the rebuilt base did not pass its check - the old one is kept; re-import it (tools/import_base.py with a full Titan export)")
            st = dict(ok=False, sig=sig, hole_depths=depths, rebuilt=False, check=summ, checked=time.time())
            json.dump(st, open(okf, "w"))
            return st
        tmp = man + ".tmp.ply"
        out.export(tmp)
        os.replace(tmp, man)
        sig2 = _md5(man)
        st = dict(ok=True, sig=sig2, hole_depths=summ["hole_depths"], rebuilt=True, was=depths, check=summ, checked=time.time(),
                  seconds=round(time.time() - t0, 1))
        json.dump(st, open(okf, "w"))
        log(f"Trimlign base rebuilt in {st['seconds']} s: locating holes now clear to {', '.join(f'{d:.2f}' for d in summ['hole_depths'])} mm. "
            "Models made before this keep the old base until they are sent again (Send re-makes them with this one)")
        return st


def base_problem(root):
    """A sentence when the app's base is known to be wrong (its check failed and it could not be rebuilt), else None."""
    _, man, okf = asset_paths(root)
    try:
        st = json.load(open(okf))
    except Exception:  # noqa
        return None
    if st.get("ok") is False and st.get("sig") == base_sig(root):
        d = st.get("hole_depths") or []
        return ("the Trimlign base failed its check" + (f" (locating holes clear only to {min(d):.2f} mm, should be 3.5)" if d else "")
                + " - re-import it from a full Titan export before printing")
    return None


_SIG = {"key": None, "sig": None}


def base_sig(root):
    """The checksum of the app's manifold base (which base a model was finished with)."""
    _, man, _ = asset_paths(root)
    try:
        st = os.stat(man)
    except OSError:
        return None
    key = (st.st_mtime_ns, st.st_size)
    if _SIG["key"] != key:
        _SIG.update(key=key, sig=_md5(man))
    return _SIG["sig"]
