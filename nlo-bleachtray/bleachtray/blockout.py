"""Block-out of undercuts for thermoforming.

A retainer or tray is pulled down over the model along the occlusal axis (z). Wherever the surface
overhangs - the space under a bridge pontic, the concave emergence of an implant crown, an open
embrasure (black triangle) - the sheet would lock in or tear, so the lab fills those spaces with
block-out resin before forming. This does the same on the model: every vertical column that passes
through an overhang and then through free air before it meets a surface again gets filled from that
surface up to the overhang, when the undercut is deep enough (horizontally, measured from the
silhouette seen from above) or when the user painted it.

Everything is computed on a 2D grid (cell size `cell` mm) from the vertices alone - no ray casting -
and the fill comes back as one watertight heightfield solid to union with the body.
"""
import numpy as np
import trimesh
import scipy.ndimage as ndi


def _grid_fields(V, N, cell):
    """Per grid cell: silhouette top, and the largest AIR interval between consecutive surface
    crossings of the vertical through the cell - an interval is air (not the inside of a tooth) when
    the vertex above it faces down (an overhang's underside) and the vertex below it faces up (a
    surface to build on)."""
    z = V[:, 2]
    x0, y0 = V[:, 0].min() - 2 * cell, V[:, 1].min() - 2 * cell
    nx = int((V[:, 0].max() - x0) / cell) + 3
    ny = int((V[:, 1].max() - y0) / cell) + 3
    ci = ((V[:, 0] - x0) / cell).astype(int); cj = ((V[:, 1] - y0) / cell).astype(int)
    lin = ci * ny + cj
    ncell = nx * ny
    BIG = 1e9
    z_top = np.full(ncell, -BIG); np.maximum.at(z_top, lin, z)
    order = np.lexsort((z, lin))
    ls, zs, ns = lin[order], z[order], N[order, 2]
    same = ls[1:] == ls[:-1]
    # cervical slopes lean in only a few degrees: any downward component counts as an underside
    air = same & (ns[1:] < -0.02) & (ns[:-1] > 0.02)
    dz = np.where(air, zs[1:] - zs[:-1], 0.0)
    gmax = np.zeros(ncell); np.maximum.at(gmax, ls[:-1], dz)
    is_max = air & (dz > 0) & (dz >= gmax[ls[:-1]] - 1e-9)
    idx = np.where(is_max)[0]
    cells_g, first = np.unique(ls[idx], return_index=True)
    i = idx[first]
    gap_bot = np.full(ncell, np.nan); gap_top = np.full(ncell, np.nan)
    gap_bot[cells_g] = zs[i]; gap_top[cells_g] = zs[i + 1]
    # which way the overhang's underside faces, horizontally (a proclined crown's labial face vs the
    # proximal walls of an embrasure vs the underside of a pontic)
    nxy = np.zeros((ncell, 2)); nxy[cells_g] = N[order][i + 1][:, :2]
    shape = (nx, ny)
    f = lambda a: a.reshape(shape)
    has = ~np.isnan(gap_top)
    return dict(x0=x0, y0=y0, cell=cell, nx=nx, ny=ny, lin=lin, z_top=f(z_top), gap_bot=f(gap_bot), gap_top=f(gap_top),
                overhang=f(has), floor=f(has), over_nx=f(nxy[:, 0]), over_ny=f(nxy[:, 1]))


def _undercut_depth(z_top, gap_top, cell, step=0.25):
    """Horizontal distance (mm) from each cell to the edge of the silhouette at the height of its
    overhang: how far the sheet would have to reach in under the contour."""
    depth = np.zeros_like(z_top)
    has = ~np.isnan(gap_top)
    if not has.any():
        return depth
    levels = np.unique(np.round(gap_top[has] / step))
    for L in levels:
        zl = L * step
        sel = has & (np.round(gap_top / step) == L)
        covered = z_top >= zl - 0.05           # something above this height -> inside the silhouette
        dt = ndi.distance_transform_edt(covered) * cell
        depth[sel] = dt[sel]
    return depth


def _slab_from_grid(region, ztop, zbot, x0, y0, cell):
    """Watertight heightfield solid over the region cells: top at ztop, bottom at zbot (per cell,
    averaged onto the cell corners), vertical walls where the region ends."""
    nx, ny = region.shape
    # corner heights = mean of the region cells touching the corner
    def corner_mean(field):
        acc = np.zeros((nx + 1, ny + 1)); cnt = np.zeros((nx + 1, ny + 1))
        vals = np.where(region, field, 0.0); w = region.astype(float)
        for di in (0, 1):
            for dj in (0, 1):
                acc[di:di + nx, dj:dj + ny] += vals; cnt[di:di + nx, dj:dj + ny] += w
        return acc / np.maximum(cnt, 1e-9)
    ct, cb = corner_mean(ztop), corner_mean(zbot)
    cb = np.minimum(cb, ct - 0.25)
    cid = -np.ones((nx + 1, ny + 1), int)
    used = np.zeros((nx + 1, ny + 1), bool)
    ii, jj = np.where(region)
    for di in (0, 1):
        for dj in (0, 1):
            used[ii + di, jj + dj] = True
    ui, uj = np.where(used)
    cid[ui, uj] = np.arange(len(ui))
    nC = len(ui)
    xy = np.column_stack([x0 + ui * cell, y0 + uj * cell])
    Vt = np.column_stack([xy, ct[ui, uj]]); Vb = np.column_stack([xy, cb[ui, uj]])
    Vs = np.vstack([Vt, Vb])
    c00 = cid[ii, jj]; c10 = cid[ii + 1, jj]; c11 = cid[ii + 1, jj + 1]; c01 = cid[ii, jj + 1]
    top = np.vstack([np.column_stack([c00, c10, c11]), np.column_stack([c00, c11, c01])])
    bot = np.vstack([np.column_stack([c00, c11, c10]), np.column_stack([c00, c01, c11])]) + nC
    walls = []
    pad = np.pad(region, 1, constant_values=False)
    # neighbour (di, dj) missing -> wall along the cell edge shared with it; corners listed so the
    # outward normal is right-handed with the top face
    for (di, dj), (a, b) in (((1, 0), (c10, c11)), ((-1, 0), (c01, c00)), ((0, 1), (c11, c01)), ((0, -1), (c00, c10))):
        miss = ~pad[ii + 1 + di, jj + 1 + dj]
        aa, bb = a[miss], b[miss]
        walls.append(np.column_stack([aa, bb, bb + nC])); walls.append(np.column_stack([aa, bb + nC, aa + nC]))
    F = np.vstack([top, bot] + walls)
    solid = trimesh.Trimesh(Vs, F, process=False)
    trimesh.repair.fix_normals(solid, multibody=True)
    return solid


def _nearest_fill(mask, field):
    """`field` where it is known (finite and inside `mask`), the nearest known value elsewhere."""
    known = mask & np.isfinite(field)
    if not known.any():
        return np.zeros_like(field)
    idx = ndi.distance_transform_edt(~known, return_indices=True)[1]
    return field[idx[0], idx[1]]


def _blur_in(mask, field, sigma):
    """Gaussian blur of `field` restricted to `mask` (normalised convolution: cells outside the mask
    neither count nor pull), so a fill's heights are smooth without bending toward anything outside it."""
    if sigma <= 0:
        return field
    w = mask.astype(float)
    num = ndi.gaussian_filter(np.where(mask, field, 0.0), sigma)
    den = ndi.gaussian_filter(w, sigma)
    out = np.where(den > 1e-6, num / np.maximum(den, 1e-6), field)
    return np.where(mask, out, field)


def _unpinch(region):
    """Two cells touching only at a corner would pinch the solid: make such pairs 4-connected."""
    for _ in range(4):
        a = region[:-1, :-1] & region[1:, 1:] & ~region[1:, :-1] & ~region[:-1, 1:]
        b = region[1:, :-1] & region[:-1, 1:] & ~region[:-1, :-1] & ~region[1:, 1:]
        if not (a.any() or b.any()):
            break
        fix = a | b
        region[:-1, :-1] |= fix; region[1:, 1:] |= fix; region[1:, :-1] |= fix; region[:-1, 1:] |= fix
    return region


def undercut_fill(mesh, z_floor=0.0, min_depth=1.0, min_gap=0.3, cell=0.3, auto=True, paint=None,
                  paint_min_depth=0.15, proud=0.0, bevel=0.5, upsample=3, near=None, near_mm=1.5, below_mm=2.0, centre=None, log=print):
    """Return (solid or None, info). `paint`: per-vertex bool mask of areas the user asked to block
    out (filled whatever their depth). `near`: per-vertex bool mask (the teeth): an automatic fill
    only goes under an overhang within `near_mm` of it - the vestibule's own overhangs (the scan's
    rolled edge, a frenum) are not the tray's business - and only where a real surface shows under
    the overhang, never down to the floor.

    The fill is what a technician's block-out resin is: every column under an overhang is filled from
    the surface below up to the overhang's underside, out to the tooth's contour seen from above -
    so the crown's widest line continues straight down to the gum (a vertical wall, with a short
    bevel where it meets the gum). `proud` moves that wall: > 0 mm out beyond the contour (more
    block-out), < 0 mm in from it (that much of the undercut is left for grip)."""
    V = np.asarray(mesh.vertices); N = np.asarray(mesh.vertex_normals)
    g = _grid_fields(V, N, cell)
    gap = g["gap_top"] - g["gap_bot"]
    has = ~np.isnan(gap)
    depth = _undercut_depth(g["z_top"], g["gap_top"], cell)
    region = np.zeros_like(has)
    if auto:
        region |= has & (gap >= min_gap) & g["overhang"] & g["floor"] & (depth >= min_depth)
        region &= g["gap_bot"] > z_floor + 0.5                       # something to build on, not the model's floor
        if near is not None and np.asarray(near).any():
            nmask = np.asarray(near, bool)
            nm = np.zeros(g["nx"] * g["ny"], bool); nm[g["lin"][nmask]] = True
            region &= ndi.binary_dilation(nm.reshape(g["nx"], g["ny"]), iterations=max(1, int(round(near_mm / cell))))
            # ... and not further down the gum than the tray reaches: the fill stands on a surface no more
            # than `below_mm` under the gum line - taken as the lowest tooth point within 3 mm (the cervical
            # margins round about); the root prominence's hollow further down is below the trim line,
            # nothing for the sheet to catch on. A papilla in a black triangle is above that level
            tl = np.full(g["nx"] * g["ny"], np.inf); np.minimum.at(tl, g["lin"][nmask], V[nmask, 2])
            tl = ndi.minimum_filter(tl.reshape(g["nx"], g["ny"]), size=2 * int(round(3.0 / cell)) + 1, mode="nearest")
            region &= ~np.isfinite(tl) | (g["gap_bot"] > tl - below_mm)
        # ... and never the facial or lingual face of a crown itself: a proclined incisor's labial face leans
        # out over the gum and reads as an undercut along the pull, but that is the tooth, not a space to fill
        # (filling it would put a flat wall on the whole labial). An overhang whose underside faces outward
        # or inward across the arch is such a face; the proximal walls of an embrasure face along the arch
        # and a pontic's underside faces down, those stay
        if centre is not None:
            cx = g["x0"] + np.arange(g["nx"])[:, None] * cell; cy = g["y0"] + np.arange(g["ny"])[None, :] * cell
            rx, ry = cx - float(centre[0]), cy - float(centre[1]); rn = np.hypot(rx, ry) + 1e-9
            hx, hy = g["over_nx"], g["over_ny"]; hn = np.hypot(hx, hy)
            radial = np.abs(hx * rx + hy * ry) / (rn * np.maximum(hn, 1e-9))
            faces_across = (hn > 0.45) & (radial > 0.75)
            region &= ~faces_across
    painted = np.zeros_like(has)
    if paint is not None and np.asarray(paint).any():
        pm = np.zeros(g["nx"] * g["ny"], bool); pm[g["lin"][np.asarray(paint, bool)]] = True
        painted = ndi.binary_dilation(pm.reshape(g["nx"], g["ny"]), iterations=1)
        region |= painted & has & (gap >= 0.2) & g["overhang"] & (depth >= paint_min_depth)
    # tidy: close one-cell holes (only where a gap exists), drop specks
    region = ndi.binary_closing(region, iterations=1) & has & g["overhang"]
    lab, nlab = ndi.label(region)
    if nlab:
        sizes = ndi.sum(region, lab, index=np.arange(1, nlab + 1))
        region &= ~np.isin(lab, 1 + np.where(sizes < 4)[0])
    if not region.any():
        return None, dict(cells=0, spots=0, painted_cells=0)
    # top = the overhang's underside, bottom = the surface under it. A 3x3 median takes out single
    # columns that graze a contact area (they read millimetres taller than their neighbours)
    import warnings
    ztop = np.where(region, g["gap_top"], np.nan); zbot = np.where(region, g["gap_bot"], np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        zmed = ndi.generic_filter(ztop, np.nanmedian, size=3, mode="constant", cval=np.nan)
        far = region & ~np.isnan(zmed) & (np.abs(ztop - zmed) > 1.5)
        region &= ~far
        ztop = np.where(np.isnan(zmed), ztop, np.minimum(ztop, zmed))
    lab, nlab = ndi.label(region)
    if nlab:
        sizes = ndi.sum(region, lab, index=np.arange(1, nlab + 1))
        region &= ~np.isin(lab, 1 + np.where(sizes < 4)[0])
    core = region.copy()
    # the amount: the wall moves `proud` mm out past the contour (the ring keeps the top height of
    # the nearest filled column and stands on the surface there) or in from it
    n_pr = int(round(abs(proud) / cell)) if proud else 0
    if proud > 0 and n_pr:
        grown = ndi.binary_dilation(region, iterations=n_pr)
        ring = grown & ~region
        # the ring continues the wall at the height of the fill's own edge (its outermost cells), never
        # above an overhang the ring column itself has
        edge = region & ~ndi.binary_erosion(region, iterations=1)
        carried = _nearest_fill(edge, np.where(edge, ztop, np.nan))
        surf = np.where(g["z_top"] > -1e8, g["z_top"], np.nan)
        # only where that height is in the open: nothing in the column above it (in front of the tooth,
        # the fill stands on the gum), or it falls in the column's own air gap (under a neighbouring
        # overhang); a column inside a crown at that height is the crown's, not the fill's
        free = ring & np.isfinite(surf) & (surf <= carried + 0.1)
        in_gap = ring & has & (g["gap_bot"] < carried - 0.2) & (g["gap_top"] >= carried - 0.3)
        ztop = np.where(free | in_gap, np.where(in_gap, np.minimum(carried, g["gap_top"]), carried), ztop)
        zbot = np.where(in_gap, g["gap_bot"], np.where(free, surf, zbot))
        region = region | free | in_gap
    elif proud < 0 and n_pr:
        region = ndi.binary_erosion(region, iterations=n_pr)
        core = region.copy()
    region = _unpinch(region)
    if not region.any():
        return None, dict(cells=0, spots=0, painted_cells=int((painted & core).sum()))
    # every filled column needs both heights: gaps from the nearest known, then a light smoothing
    # within the fill (nothing outside it pulls on the edge heights)
    ztop = np.where(region, _nearest_fill(region, ztop), np.nan); zbot = np.where(region, _nearest_fill(region, zbot), np.nan)
    ztop = _blur_in(region, ztop, 1.0); zbot = _blur_in(region, zbot, 1.0)
    # the fill is built on a finer grid than the one the undercuts were found on (the detection needs a
    # few scan vertices per cell; the surface wants small steps): a rounded outline, heights interpolated
    fine = cell / upsample
    if upsample > 1:
        region_f = ndi.gaussian_filter(ndi.zoom(region.astype(float), upsample, order=1), upsample * 0.6) > 0.5   # no cell corners on the outline
        region_f = ndi.binary_opening(region_f, iterations=1) | ndi.binary_erosion(region_f, iterations=1)
        ztop_f = ndi.zoom(_nearest_fill(region, ztop), upsample, order=1); zbot_f = ndi.zoom(_nearest_fill(region, zbot), upsample, order=1)
        ztop_f = _blur_in(region_f, ztop_f, upsample * 0.8); zbot_f = _blur_in(region_f, zbot_f, upsample * 0.8)
    else:
        region_f, ztop_f, zbot_f = region, ztop, zbot
    region_f = _unpinch(region_f)
    if not region_f.any():
        return None, dict(cells=0, spots=0, painted_cells=int((painted & core).sum()))
    # the wall: full height from the surface up to the overhang (pushed 0.3 mm into it so the union
    # leaves no sliver); over the outer `bevel` mm the top eases down to the surface - resin wiped
    # against the gum, not a machined block. The foot sits 0.3 mm into the surface, never under the floor
    dist = ndi.distance_transform_edt(region_f) * fine
    s = np.clip(dist / max(bevel, 1e-6), 0.0, 1.0); s = s * s * (3 - 2 * s)
    zb = np.where(np.isfinite(zbot_f), zbot_f, z_floor)
    zt = np.where(np.isfinite(ztop_f), ztop_f, zb)
    ztop_f = zb + s * np.maximum(zt + 0.3 - zb, 0.0)
    zbot_f = np.maximum(zb - 0.3, z_floor + 0.05)
    ztop_f = np.maximum(ztop_f, zbot_f + 0.35)
    solid = _slab_from_grid(region_f, ztop_f, zbot_f, g["x0"], g["y0"], fine)
    lab, nlab = ndi.label(core)
    vol = float(abs(solid.volume)) / 1000.0
    info = dict(cells=int(core.sum()), spots=int(nlab), volume_ml=round(vol, 3), proud_mm=float(proud or 0.0),
                deepest_mm=round(float(np.nanmax(np.where(core, depth, 0))), 2), painted_cells=int((painted & core).sum()))
    if log:
        log(f"block-out: {nlab} undercut{'s' if nlab != 1 else ''} filled ({vol:.2f} mL, deepest {info['deepest_mm']} mm in from the contour{f', wall {proud:+.2f} mm from it' if proud else ''})")
    return solid, info
