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
    shape = (nx, ny)
    f = lambda a: a.reshape(shape)
    has = ~np.isnan(gap_top)
    return dict(x0=x0, y0=y0, cell=cell, nx=nx, ny=ny, lin=lin, z_top=f(z_top), gap_bot=f(gap_bot), gap_top=f(gap_top),
                overhang=f(has), floor=f(has))


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


def undercut_fill(mesh, z_floor=0.0, min_depth=1.0, min_gap=0.3, cell=0.3, auto=True, paint=None,
                  paint_min_depth=0.15, log=print):
    """Return (solid or None, info). `paint`: per-vertex bool mask of areas the user asked to block
    out (filled whatever their depth, down to the model floor if no surface shows under them)."""
    V = np.asarray(mesh.vertices); N = np.asarray(mesh.vertex_normals)
    g = _grid_fields(V, N, cell)
    gap = g["gap_top"] - g["gap_bot"]
    has = ~np.isnan(gap)
    depth = _undercut_depth(g["z_top"], g["gap_top"], cell)
    region = np.zeros_like(has)
    if auto:
        region |= has & (gap >= min_gap) & g["overhang"] & g["floor"] & (depth >= min_depth)
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
        small = np.isin(lab, 1 + np.where(sizes < 4)[0])
        region &= ~small
    if not region.any():
        return None, dict(cells=0, spots=0)
    ztop = np.where(has, g["gap_top"], np.nan)
    zbot = np.where(has & g["floor"], g["gap_bot"], z_floor)
    # the top of the fill follows the overhang's underside; a 3x3 median then mean within each spot
    # takes out single-column outliers (a column that grazes a contact area reads 5 mm taller than
    # its neighbours) so the fill is a smooth wedge, not a row of spikes
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        zr = np.where(region, ztop, np.nan)
        zmed = ndi.generic_filter(zr, np.nanmedian, size=3, mode="constant", cval=np.nan)
        far = region & ~np.isnan(zmed) & (np.abs(ztop - zmed) > 1.5)
        region &= ~far
        ztop = np.where(np.isnan(zmed), ztop, np.minimum(ztop, zmed))
    lab, nlab = ndi.label(region)
    if nlab:
        sizes = ndi.sum(region, lab, index=np.arange(1, nlab + 1))
        region &= ~np.isin(lab, 1 + np.where(sizes < 4)[0])
    # two cells touching only at a corner would pinch the solid: make such pairs 4-connected
    for _ in range(4):
        a = region[:-1, :-1] & region[1:, 1:] & ~region[1:, :-1] & ~region[:-1, 1:]
        b = region[1:, :-1] & region[:-1, 1:] & ~region[:-1, :-1] & ~region[1:, 1:]
        if not (a.any() or b.any()):
            break
        fix = a | b
        region[:-1, :-1] |= fix; region[1:, 1:] |= fix; region[1:, :-1] |= fix; region[:-1, 1:] |= fix
    if not region.any():
        return None, dict(cells=0, spots=0)
    # heights averaged over each cell's neighbours in the spot (cells added by the tidying get theirs
    # from the neighbours too), pushed 0.3 mm into the overhang above and the surface below so the
    # union leaves no sliver
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        zs = ndi.generic_filter(np.where(region, ztop, np.nan), np.nanmean, size=3, mode="constant", cval=np.nan)
        zb = ndi.generic_filter(np.where(region, zbot, np.nan), np.nanmean, size=3, mode="constant", cval=np.nan)
    ztop = np.where(np.isnan(zs), z_floor, zs) + 0.3
    zbot = np.maximum(np.where(np.isnan(zb), z_floor, zb) - 0.3, z_floor - 0.5)
    solid = _slab_from_grid(region, ztop, zbot, g["x0"], g["y0"], cell)
    lab, nlab = ndi.label(region)
    vol = float(abs(solid.volume)) / 1000.0
    info = dict(cells=int(region.sum()), spots=int(nlab), volume_ml=round(vol, 3),
                deepest_mm=round(float(np.nanmax(np.where(region, depth, 0))), 2), painted_cells=int((painted & region).sum()))
    if log:
        log(f"block-out: {nlab} undercut{'s' if nlab != 1 else ''} filled ({vol:.2f} mL, deepest {info['deepest_mm']} mm in from the contour)")
    return solid, info
