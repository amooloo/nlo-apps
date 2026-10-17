"""Turn the open scan surface into a printable solid horseshoe, and add the Trimlign base."""
import os
import numpy as np
import trimesh
import manifold3d as m3
import mapbox_earcut as earcut
from shapely.geometry import Polygon, MultiPolygon, Point
from shapely.ops import unary_union

ASSET_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")


def horseshoe_outline(margin_xy, facial_offset=4.5, lingual_offset=4.0):
    """Horseshoe body outline as a shapely polygon from the closed margin loop (XY)."""
    P = Polygon(margin_xy)
    if not P.is_valid:
        P = P.buffer(0)
    # offset outward; lingual/facial use the same buffer, then we shave the inside if asked
    body = P.buffer(facial_offset, join_style=1, resolution=16)
    if lingual_offset < facial_offset:
        # shrink only the inner (palatal) edge: inner boundary = P.buffer(lingual_offset)'s holes
        inner = P.buffer(lingual_offset, join_style=1, resolution=16)
        holes = [Polygon(h) for h in inner.interiors] if isinstance(inner, Polygon) else []
        for h in holes:
            body = body.difference(h)
    body = body.simplify(0.15)
    if isinstance(body, MultiPolygon):
        body = max(body.geoms, key=lambda g: g.area)
    return body


def clip_surface(mesh, outline, z_floor):
    """Keep faces whose centroid is inside the outline and above the floor; return the open surface."""
    cent = mesh.triangles_center
    import shapely
    inside = shapely.contains_xy(outline, cent[:, 0], cent[:, 1])
    keep = inside & (cent[:, 2] > z_floor + 0.05)
    sub = mesh.submesh([np.where(keep)[0]], append=True)
    parts = sub.split(only_watertight=False)
    if len(parts) > 1:
        sub = max(parts, key=lambda p: p.area)
    # nothing may sit below the floor: clamp (faces that end up flat on the floor become degenerate
    # and are dropped; the skirt then starts at the floor there)
    V = sub.vertices.copy()
    V[:, 2] = np.maximum(V[:, 2], z_floor)
    sub = trimesh.Trimesh(V, sub.faces, process=True)
    sub.update_faces(sub.nondegenerate_faces(height=1e-6))
    sub.remove_unreferenced_vertices()
    trimesh.repair.fill_holes(sub)
    return sub


def boundary_loops(mesh):
    """Ordered boundary vertex loops (list of index arrays), longest first."""
    edges = mesh.edges_sorted
    import trimesh.grouping as tg
    idx = tg.group_rows(edges, require_count=1)
    be = edges[idx]
    from collections import defaultdict
    adj = defaultdict(list)
    for a, b in be:
        adj[a].append(b)
        adj[b].append(a)
    visited = set()
    loops = []
    for start in adj:
        if start in visited:
            continue
        loop = [start]
        visited.add(start)
        prev, cur = None, start
        while True:
            nxt = [k for k in adj[cur] if k != prev and k not in visited]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            visited.add(cur)
            loop.append(cur)
        loops.append(np.array(loop))
    loops.sort(key=lambda L: -len(L))
    return loops


def repair_boundary(surface, max_iter=12, log=None):
    """Make the outer boundary loop project to a simple (non-self-intersecting) XY polygon by
    deleting the few boundary faces that create zig-zags. Returns a new surface."""
    from shapely.validation import make_valid
    surf = surface
    for it in range(max_iter):
        loops = boundary_loops(surf)
        if not loops:
            return surf
        outer = loops[0]
        V = surf.vertices
        ring = Polygon(V[outer][:, :2])
        if ring.is_valid and len(loops) == 1:
            return surf
        bad = set()
        if not ring.is_valid:
            valid = make_valid(ring)
            # largest polygon piece of the valid geometry
            polys = [g for g in getattr(valid, "geoms", [valid]) if g.geom_type == "Polygon"]
            if not polys:
                return surf
            main = max(polys, key=lambda g: g.area)
            ext = main.exterior
            for i in outer:
                if ext.distance(Point(V[i, 0], V[i, 1])) > 1e-6:
                    bad.add(i)
        # also kill tiny extra loops (pinches / slivers) by removing their faces
        for L in loops[1:]:
            if len(L) < 40:
                bad.update(L.tolist())
        if not bad:
            return surf
        badv = np.array(sorted(bad))
        keep = ~np.isin(surf.faces, badv).any(1)
        surf = surf.submesh([np.where(keep)[0]], append=True)
        parts = surf.split(only_watertight=False)
        if len(parts) > 1:
            surf = max(parts, key=lambda p: p.area)
        trimesh.repair.fill_holes(surf)
        if log:
            log(f"boundary repair iter {it}: removed faces touching {len(badv)} vertices")
    return surf


def shelf_solid(surface, outline, z_bottom, z_floor, slope=0.12, clearance=0.3, cell=0.5):
    """A manifold 'shelf' filling the whole outline: a heightfield whose top follows the lowest
    nearby scan surface (minus `clearance`) and slopes gently down with distance from the scan,
    extruded to z_bottom. Unioned with the main solid it adds gingiva wherever the scanner
    stopped short of the outline (distal to the last molars, facial of the incisors) without ever
    poking through the scanned surface."""
    from scipy.spatial import cKDTree, Delaunay
    import shapely
    V = surface.vertices
    minx, miny, maxx, maxy = outline.bounds
    xs = np.arange(minx - cell, maxx + 2 * cell, cell)
    ys = np.arange(miny - cell, maxy + 2 * cell, cell)
    gx, gy = np.meshgrid(xs, ys)
    G = np.column_stack([gx.ravel(), gy.ravel()])
    inside = shapely.contains_xy(outline.buffer(cell * 0.6), G[:, 0], G[:, 1])
    G = G[inside]
    ring = np.array(outline.exterior.coords[:-1])
    # densify the ring so the triangulation hugs the outline
    dense = []
    for a, b in zip(ring, np.roll(ring, -1, axis=0)):
        n = max(int(np.linalg.norm(b - a) / cell), 1)
        for t in np.linspace(0, 1, n, endpoint=False):
            dense.append(a + t * (b - a))
    dense = np.array(dense)
    pts = np.vstack([G, dense])
    tri = Delaunay(pts)
    cent = pts[tri.simplices].mean(1)
    keep = shapely.contains_xy(outline, cent[:, 0], cent[:, 1])
    F = tri.simplices[keep]
    used = np.unique(F)
    remap = -np.ones(len(pts), int); remap[used] = np.arange(len(used))
    F = remap[F]
    P2 = pts[used]
    # heights are carried outward from the scan's OPEN EDGE (where the scanner stopped): behind the
    # molars that edge is high on the gingiva, in front of proclined incisors it is low under the
    # crown. A 2 mm "lowest surface nearby" cap guarantees the shelf never rises into an undercut.
    # Computed on the regular grid and blurred so the skirt is smooth, then sampled at the mesh points.
    import scipy.ndimage as ndi
    loops_b = boundary_loops(surface)
    bidx = np.concatenate(loops_b) if loops_b else np.arange(len(V))
    btree = cKDTree(V[bidx][:, :2])
    tree = cKDTree(V[:, :2])
    Gall = np.column_stack([gx.ravel(), gy.ravel()])
    dist_g, jb = btree.query(Gall)
    z_edge = V[bidx][jb, 2]
    neigh = tree.query_ball_point(Gall, r=2.0)
    _, jn = tree.query(Gall)
    z_low = np.array([V[idx, 2].min() if len(idx) else V[jn[i], 2] for i, idx in enumerate(neigh)])
    # rounded falloff: gentle at the edge, steeper further out (reads as a bevel, not a ledge)
    fall = slope * dist_g + 0.015 * dist_g ** 2
    zg = np.minimum(z_edge - fall, z_low) - clearance
    zg = zg.reshape(gx.shape)
    zg = ndi.gaussian_filter(zg, sigma=1.5)   # 0.75 mm smoothing
    # sample at the mesh points (grid + ring)
    ii = np.clip(np.round((P2[:, 1] - ys[0]) / cell).astype(int), 0, zg.shape[0] - 1)
    jj = np.clip(np.round((P2[:, 0] - xs[0]) / cell).astype(int), 0, zg.shape[1] - 1)
    ztop = zg[ii, jj]
    # no paper-thin flakes: anything lower than 0.6 mm above the floor is dropped below the floor
    ztop = np.where(ztop < z_floor + 0.6, z_bottom + 0.5, ztop)
    top = np.column_stack([P2, ztop])
    bot = np.column_stack([P2, np.full(len(P2), z_bottom)])
    n = len(P2)
    Vs = np.vstack([top, bot])
    Ft = F.copy()
    Fb = (F + n)[:, ::-1]
    # walls along boundary edges of the kept triangulation
    import collections
    cnt = collections.Counter()
    for a, b, c in F:
        for e in ((a, b), (b, c), (c, a)):
            cnt[tuple(sorted(e))] += 1
    bnd = [e for e, c in cnt.items() if c == 1]
    # orient boundary edges consistently with the top faces (edge direction as it appears in the face)
    edge_dir = {}
    for a, b, c in F:
        for e in ((a, b), (b, c), (c, a)):
            if tuple(sorted(e)) in cnt and cnt[tuple(sorted(e))] == 1:
                edge_dir[tuple(sorted(e))] = e
    walls = []
    for e in bnd:
        a, b = edge_dir[e]
        walls.append([a, b, b + n]); walls.append([a, b + n, a + n])
    solid = trimesh.Trimesh(Vs, np.vstack([Ft, Fb, np.array(walls)]), process=False)
    trimesh.repair.fix_normals(solid)
    if solid.volume < 0:
        solid.invert()
    return solid


def extend_ledge(surface, extend=6.0, slope=0.15, z_min=None):
    """Grow the open surface outward along its boundary: a gently sloping ledge of width `extend`
    (mm) added around the outer boundary loop, so the gingiva body reaches the full outline even
    where the scanner stopped right at the gum line (typically distal to the last molars).
    Returns (surface_with_ledge, new_outer_loop_indices)."""
    loops = boundary_loops(surface)
    if not loops:
        return surface, None
    outer = loops[0]
    V = surface.vertices
    P = V[outer][:, :2]
    n = len(outer)
    if n < 10:
        return surface, outer
    # polygon orientation -> outward normal direction
    ring = Polygon(P)
    ccw = ring.exterior.is_ccw
    tang = np.roll(P, -1, axis=0) - np.roll(P, 1, axis=0)
    tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-9)
    nrm = np.column_stack([tang[:, 1], -tang[:, 0]]) if ccw else np.column_stack([-tang[:, 1], tang[:, 0]])
    # smooth the normals along the loop so the ledge doesn't crease
    for _ in range(6):
        nrm = 0.25 * np.roll(nrm, 1, axis=0) + 0.5 * nrm + 0.25 * np.roll(nrm, -1, axis=0)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    for D in (extend, extend * 0.66, extend * 0.4, extend * 0.25):
        Q = P + nrm * D
        if Polygon(Q).is_valid:
            break
    else:
        return surface, outer
    z = V[outer][:, 2] - slope * D
    if z_min is not None:
        z = np.maximum(z, z_min)
    newV = np.column_stack([Q, z])
    n0 = len(V)
    Vn = np.vstack([V, newV])
    strip = []
    for k in range(n):
        a, b = outer[k], outer[(k + 1) % n]
        a2, b2 = n0 + k, n0 + (k + 1) % n
        strip.append([a, b, b2]); strip.append([a, b2, a2])
    F = np.vstack([surface.faces, np.array(strip)])
    out = trimesh.Trimesh(Vn, F, process=False)
    # orient the strip consistently with the surface
    trimesh.repair.fix_normals(out)
    return out, np.arange(n0, n0 + n)


def solidify(surface, z_floor, outline=None, snap=True):
    """Close an open surface into a solid: snap its outer boundary onto the outline, drop a vertical
    skirt to z_floor, cap the floor. Inner holes are filled flat. Returns trimesh (hopefully manifold)."""
    surf = surface.copy()
    loops = boundary_loops(surf)
    if not loops:
        return surf
    outer = loops[0]
    V = surf.vertices.copy()
    if snap and outline is not None:
        ring = outline.exterior
        for i in outer:
            p = Point(V[i, 0], V[i, 1])
            q = ring.interpolate(ring.project(p))
            V[i, 0], V[i, 1] = q.x, q.y
    # fill remaining (inner) holes flat
    F = surf.faces.copy()
    extra_faces = []
    for L in loops[1:]:
        if len(L) < 3:
            continue
        pts = V[L]
        # triangulate in the best-fit plane via earcut on 2D projection
        c = pts.mean(0)
        u, s, vt = np.linalg.svd(pts - c)
        P2 = (pts - c) @ vt[:2].T
        tri = earcut.triangulate_float64(P2, np.array([len(P2)], dtype=np.uint32)).reshape(-1, 3)
        extra_faces.append(L[tri])
    if extra_faces:
        F = np.vstack([F] + extra_faces)
    # skirt: duplicate outer loop at the floor
    n0 = len(V)
    floor_pts = V[outer].copy()
    floor_pts[:, 2] = z_floor
    V = np.vstack([V, floor_pts])
    m = len(outer)
    skirt = []
    for k in range(m):
        a, b = outer[k], outer[(k + 1) % m]
        a2, b2 = n0 + k, n0 + (k + 1) % m
        skirt.append([a, b, b2])
        skirt.append([a, b2, a2])
    skirt = np.array(skirt)
    # floor cap
    P2 = floor_pts[:, :2]
    tri = earcut.triangulate_float64(P2, np.array([len(P2)], dtype=np.uint32)).reshape(-1, 3)
    cap = n0 + tri
    cap = cap[:, ::-1]  # will be fixed by fix_normals anyway
    F = np.vstack([F, skirt, cap])
    solid = trimesh.Trimesh(V, F, process=True)
    solid.update_faces(solid.nondegenerate_faces())
    solid.update_faces(solid.unique_faces())
    solid.remove_unreferenced_vertices()
    trimesh.repair.fix_normals(solid)
    if solid.volume < 0:
        solid.invert()
    return solid


def to_manifold(mesh):
    mm = m3.Mesh(vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
                 tri_verts=np.asarray(mesh.faces, dtype=np.uint32))
    man = m3.Manifold(mm)
    return man if man.status() == m3.Error.NoError else None


def from_manifold(man, drop_zero_volume=True):
    mesh = man.to_mesh()
    out = trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3], np.asarray(mesh.tri_verts), process=False)
    if drop_zero_volume:
        parts = out.split(only_watertight=False)
        if len(parts) > 1:
            keep = [p for p in parts if abs(p.volume) > 0.01]   # zero-thickness sheets left by booleans
            if keep:
                out = trimesh.util.concatenate(keep) if len(keep) > 1 else keep[0]
    return out


class BaseMissing(RuntimeError):
    pass


def load_base(manifold=True):
    fn = "trimlign_base_manifold.ply" if manifold else "trimlign_base_titan.stl"
    path = os.path.join(ASSET_DIR, fn)
    if not os.path.exists(path):
        raise BaseMissing("Trimlign base not imported yet. Run once:  python tools/import_base.py \"<any Titan export .stl that has the base>\"")
    return trimesh.load(path, force="mesh", process=False) if manifold else trimesh.load(path, force="mesh")


def outline_prism(outline, z0, z1):
    """Manifold prism of a shapely polygon between z0 and z1."""
    polys = outline.geoms if isinstance(outline, MultiPolygon) else [outline]
    cs = None
    for poly in polys:
        loops = [np.array(poly.exterior.coords[:-1], dtype=np.float64)]
        loops += [np.array(h.coords[:-1], dtype=np.float64) for h in poly.interiors]
        c = m3.CrossSection(loops, fillrule=m3.FillRule.EvenOdd)
        cs = c if cs is None else cs + c
    return m3.Manifold.extrude(cs, z1 - z0).translate([0, 0, z0])


def build_body(mesh_final, outline, z_floor=0.0, overhang=1.2, log=print, shelf=False, scan_region=None, extra_solids=None):
    """Printable solid horseshoe: clip the surface (to `scan_region` if given, else loosely to the
    outline), close it below the floor, union a smooth synthetic skirt out to the outline, then cut
    with the outline prism so walls and floor are exact. Returns (trimesh body, method)."""
    loose = outline.buffer(overhang, join_style=1)
    region = scan_region.intersection(loose) if scan_region is not None else loose
    surf = clip_surface(mesh_final, region, z_floor - 0.5)
    surf = repair_boundary(surf, log=log)
    raw_solid = solidify(surf, z_floor - 3.0, outline=None, snap=False)
    man = to_manifold(raw_solid)
    # gingiva shelf filling the outline wherever the scan stopped short (distal to the last molars,
    # facial of the incisors): a separate manifold heightfield unioned in
    if man is not None and shelf:
        try:
            sh = shelf_solid(surf, outline, z_floor - 3.0, z_floor)
            msh = to_manifold(sh)
            if msh is not None:
                u = man + msh
                if u.status() == m3.Error.NoError:
                    man = u
                else:
                    log("shelf union failed; continuing without shelf")
            else:
                log("shelf not manifold; continuing without shelf")
        except Exception as ex:  # noqa
            log(f"shelf skipped: {ex}")
    # block-out fills and the like: unioned in before the outline cut
    for i, ex in enumerate(extra_solids or []):
        if man is None or ex is None:
            continue
        try:
            mex = to_manifold(ex)
            if mex is None:
                log(f"extra solid {i + 1} not manifold; skipped"); continue
            u = man + mex
            if u.status() == m3.Error.NoError:
                man = u
            else:
                log(f"extra solid {i + 1} union failed; skipped")
        except Exception as ex2:  # noqa
            log(f"extra solid {i + 1} skipped: {ex2}")
    if man is None:
        # try a light repair before giving up on booleans
        try:
            import pymeshfix
            mf = pymeshfix.MeshFix(raw_solid.vertices.copy(), raw_solid.faces.copy())
            mf.repair()
            fixed = trimesh.Trimesh(np.asarray(mf.mesh.points), np.asarray(mf.mesh.faces).reshape(-1, 4)[:, 1:], process=False)
            man = to_manifold(fixed)
        except Exception as ex:  # noqa
            log(f"meshfix failed: {ex}")
    if man is None:
        log("body: could not make a manifold solid; falling back to tight clip + skirt (no boolean)")
        surf = clip_surface(mesh_final, outline, z_floor)
        body = solidify(surf, z_floor, outline=None, snap=False)
        return body, "skirt-only"
    prism = outline_prism(outline, z_floor, z_floor + 80.0)
    cut = man ^ prism
    if cut.status() != m3.Error.NoError or cut.volume() < 100:
        log("body: prism intersection failed; using uncut solid")
        return from_manifold(man), "uncut"
    return largest_piece(from_manifold(cut), log=log), "boolean"


def largest_piece(mesh, log=None, what="body"):
    """One solid, not a solid plus crumbs: cheek or lip tissue that the floor and the outline cut
    loose from the arch would otherwise print as little slabs lying around the model."""
    parts = mesh.split(only_watertight=False)
    if len(parts) <= 1:
        return mesh
    parts = sorted(parts, key=lambda q: abs(q.volume), reverse=True)
    dropped = parts[1:]
    if log and dropped:
        log(f"{what}: {len(dropped)} loose piece{'s' if len(dropped) > 1 else ''} dropped ({', '.join(f'{abs(q.volume) / 1000:.2f} mL' for q in dropped[:4])}{'…' if len(dropped) > 4 else ''})")
    return parts[0]


def add_base(body, base_manifold=None):
    """Union the body with the Trimlign base (both in the final frame). Falls back to concatenation."""
    base = base_manifold if base_manifold is not None else load_base(manifold=True)
    mb = to_manifold(body)
    mbase = to_manifold(base)
    if mb is not None and mbase is not None:
        u = mb + mbase
        if u.status() == m3.Error.NoError:
            out = from_manifold(u)
            return out, "union"
    return trimesh.util.concatenate([body, load_base(manifold=False)]), "concat"
