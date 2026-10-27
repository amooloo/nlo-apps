"""Fusing a block-out into the model - no floating pieces, no crevice, every edge a knife edge.

The fills (the wedge under a contact, the painted undercut, the face beside a gap, the Phase I block) are each built
as a solid of their own and unioned with the body. Built that way, a fill meets the model at an angle: its top
edge stood a little short of the tooth's height of contour and its foot on the gum as a step, the marching-cubes
surface pulled back a hair from the enamel it was meant to touch - and in the viewer, and on the print, the fills
read as pieces stuck on with a dark seam round them (the doctor, 10/27/2026: "the block-outs are still floating...
they need to be knifed-edge into the body of the model, with NO gap between the edges of the block-out and the model").

So every fill goes through `fuse_fill` before the union. On a fine voxel grid round the fill (0.1 mm):
  * the body's own occupancy is taken from the scan surface (column by column: the winding of the surface
    crossings above each voxel - inside a tooth, the air of an undercut, inside the gum below),
  * fill and body are closed together with a ball of `radius` mm (0.6): every concave corner between the two -
    the crevice under the height of contour, the step at the foot - is filled with a fillet that runs into the
    model's surface tangentially,
  * the fillets become a **collar** along the seams, carried `overlap` mm (0.2) into the fill and into the body on
    either side, so the union has volume to merge through (nothing coincident, no sliver of air between fill and
    model); the collar is meshed (marching cubes on the lightly blurred voxels, a few Taubin steps) and unioned with
    the fill itself, which keeps its own smooth surface - only the seams are re-made.
What the union then adds to the body is a shape whose every edge ends in the model's own surface: the top at the
height of contour, the foot feathered onto the gum. The printed fillet is 0.6 mm; the sheet runs over it without a
step. `avoid` (points, `avoid_mm`) keeps the fillets off a neighbouring tooth that the fill must not bridge to
(the Phase I block's 0.8 mm gap to the 2 and the E).
"""
import numpy as np
import trimesh
import scipy.ndimage as ndi


def _rasterize(V, F, lo, cell, nx, ny):
    """Every crossing of the faces with the vertical through each grid cell's centre: (i, j, z, sign of the face
    normal's z). Vectorised over all (face, cell) pairs within the faces' footprints."""
    V = np.asarray(V, float); F = np.asarray(F)
    tri = V[F]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    nz = n[:, 2] / np.maximum(np.linalg.norm(n, axis=1), 1e-12)
    # every face counts, the near-vertical ones too: a steep wall (the lingual flange) is made of them, and columns
    # under it with no crossing at all read as slits of air inside the body - which the closing then "filled" with
    # tall slivers hanging under a block's foot (10/27/2026)
    keep = np.abs(nz) > 1e-9
    tri, nz = tri[keep], nz[keep]
    if not len(tri):
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0), np.zeros(0)
    # cells whose centre lies in the face's xy box: centre_i = lo + (i + 0.5) cell
    mn = tri[:, :, :2].min(1); mx = tri[:, :, :2].max(1)
    i0 = np.ceil((mn[:, 0] - lo[0]) / cell - 0.5).astype(int); i1 = np.floor((mx[:, 0] - lo[0]) / cell - 0.5).astype(int)
    j0 = np.ceil((mn[:, 1] - lo[1]) / cell - 0.5).astype(int); j1 = np.floor((mx[:, 1] - lo[1]) / cell - 0.5).astype(int)
    i0 = np.clip(i0, 0, nx - 1); i1 = np.clip(i1, -1, nx - 1); j0 = np.clip(j0, 0, ny - 1); j1 = np.clip(j1, -1, ny - 1)
    ni = np.maximum(i1 - i0 + 1, 0); nj = np.maximum(j1 - j0 + 1, 0)
    cnt = ni * nj
    tot = int(cnt.sum())
    if tot == 0:
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0), np.zeros(0)
    face = np.repeat(np.arange(len(tri)), cnt)
    start = np.cumsum(cnt) - cnt
    off = np.arange(tot) - np.repeat(start, cnt)
    njf = nj[face]
    i = i0[face] + off // njf; j = j0[face] + off % njf
    px = lo[0] + (i + 0.5) * cell; py = lo[1] + (j + 0.5) * cell
    a, b, c = tri[face, 0], tri[face, 1], tri[face, 2]
    d = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])
    ok = np.abs(d) > 1e-12
    d = np.where(ok, d, 1.0)
    w1 = ((b[:, 0] - px) * (c[:, 1] - py) - (c[:, 0] - px) * (b[:, 1] - py)) / d
    w2 = ((c[:, 0] - px) * (a[:, 1] - py) - (a[:, 0] - px) * (c[:, 1] - py)) / d
    w3 = 1.0 - w1 - w2
    eps = -1e-6
    inside = ok & (w1 >= eps) & (w2 >= eps) & (w3 >= eps)
    z = w1 * a[:, 2] + w2 * b[:, 2] + w3 * c[:, 2]
    return i[inside], j[inside], z[inside], np.sign(nz[face[inside]])


def column_occupancy(V, F, lo, cell, shape, open_below=False):
    """Occupancy of the solid bounded by (V, F) on the grid: a voxel is inside when the winding of the surface
    crossings above it (up-facing +1, down-facing -1) is positive. Exact for a closed mesh. For the scan surface
    (`open_below`: an open shell, the body solid under it down to the floor) a voxel below a column's lowest
    crossing is inside whatever the winding says - a steep wall (the lingual flange) crosses a column with a sign
    that depends on its tilt, and the winding alone read the tissue under it as air in patches. Above that the
    winding reads a tooth as solid down to the underside of its bulge, the undercut below as air, the gum and all
    under it as solid - the body as it will be built."""
    nx, ny, nz = shape
    i, j, z, s = _rasterize(V, F, lo, cell, nx, ny)
    if not len(i):
        return np.zeros(shape, bool)
    # the first voxel centre below the crossing: all voxels from there down count it
    kc = np.floor((z - lo[2]) / cell - 0.5).astype(int)
    kc = np.minimum(kc, nz - 1)
    keep = kc >= 0
    delta = np.zeros(shape, np.int32)
    np.add.at(delta, (i[keep], j[keep], kc[keep]), s[keep].astype(np.int32))
    wind = np.cumsum(delta[:, :, ::-1], axis=2)[:, :, ::-1]
    occ = wind > 0
    if open_below:
        lowest = np.full((nx, ny), nz, np.int64)
        np.minimum.at(lowest, (i, j), np.maximum(kc, -1))
        below = np.arange(nz)[None, None, :] <= lowest[:, :, None]
        occ |= below & (lowest[:, :, None] < nz)
    return occ


def _to_manifold(m):
    import manifold3d as m3
    try:
        mm = m3.Mesh(np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.uint32))
        man = m3.Manifold(mm)
        return man if man.status() == m3.Error.NoError and not man.is_empty() else None
    except Exception:  # noqa
        return None


def _from_manifold(man):
    mm = man.to_mesh()
    return trimesh.Trimesh(np.asarray(mm.vert_properties)[:, :3], np.asarray(mm.tri_verts), process=False)


def _foot_to_body(Fo, O, foot_vox):
    """A fill standing on the model must reach it: under every column of the fill, the air between the fill's lowest
    voxel and the body's top below it is the fill's too (up to `foot_vox` deep). A contact wedge stood on the papilla's
    tip and its full-reach foot hung a millimetre or two over the gum sloping away on either side - a flat underside
    with a gap beneath, the "floating" piece (Anvalina Faltz's lower incisors, 10/27/2026)."""
    nx, ny, nz = Fo.shape
    col = Fo.any(axis=2)
    if not col.any():
        return Fo
    kz = np.arange(nz)[None, None, :]
    kF = np.where(col, np.argmax(Fo, axis=2), nz)                                   # the fill's lowest voxel per column
    O_below = O & (kz < kF[:, :, None])
    has = O_below.any(axis=2)
    kO = np.where(has, nz - 1 - np.argmax(O_below[:, :, ::-1], axis=2), -1)        # the body's highest voxel under it
    gap = kF - kO - 1
    ok = col & has & (gap > 0) & (gap <= foot_vox)
    add = ok[:, :, None] & (kz > kO[:, :, None]) & (kz < kF[:, :, None]) & ~O
    return Fo | add


def fuse_fill(fill, surface, cell=0.1, radius=0.6, overlap=0.2, pad=1.0, avoid=None, avoid_mm=0.0, max_voxels=3.0e6,
              smooth_vox=0.7, taubin=8, foot_mm=3.0, log=None):
    """`fill`: a closed mesh (one piece); `surface`: the scan the body is built from, same frame. The fill itself is
    kept as it was made (its own smooth surface); what is added is a **collar** along every seam between fill and
    body - the fillets of the closing, carried `overlap` mm into both the fill and the body - and the two are unioned
    into one solid. Returns (fused mesh or None, info)."""
    info = dict(cell=cell, radius=radius, overlap=overlap)
    if fill is None or len(fill.faces) < 4:
        return None, dict(info, error="no fill")
    lo = np.asarray(fill.bounds[0], float) - (radius + pad)
    hi = np.asarray(fill.bounds[1], float) + (radius + pad)
    ext = hi - lo
    nvox = np.prod(np.ceil(ext / cell))
    if nvox > max_voxels:
        cell = float(cell * (nvox / max_voxels) ** (1.0 / 3.0))
        cell = float(np.ceil(cell * 200.0) / 200.0)          # to 0.005
        info["cell"] = cell
    shape = tuple(int(x) for x in np.ceil(ext / cell).astype(int) + 1)
    r_vox = radius / cell; o_vox = max(overlap / cell, 2.0)
    # the two occupancies
    SV = np.asarray(surface.vertices, float); SF = np.asarray(surface.faces)
    inbox = np.all((SV[:, :2] >= lo[:2] - cell) & (SV[:, :2] <= hi[:2] + cell), axis=1)
    fsel = inbox[SF].any(axis=1)
    O = column_occupancy(SV, SF[fsel], lo, cell, shape, open_below=True) if fsel.any() else np.zeros(shape, bool)
    O = ndi.binary_closing(O, iterations=1) | O        # (a one-voxel slit left by a column the surface missed is body, not a crevice)
    Fo = column_occupancy(np.asarray(fill.vertices, float), np.asarray(fill.faces), lo, cell, shape)
    Fo_orig = Fo
    if not Fo.any():
        return None, dict(info, error="the fill is thinner than the grid")
    if not O.any():
        return None, dict(info, error="no model surface round the fill")
    # the fill's foot reaches the body under it (no flat underside hanging over the gum)
    foot_added = 0
    if foot_mm and foot_mm > 0:
        F2 = _foot_to_body(Fo, O, int(round(foot_mm / cell)))
        foot_added = int(F2.sum() - Fo.sum())
        Fo = F2
    U = O | Fo
    # closing of fill + body with a ball of `radius`: the fillets at every concave seam, and every slit of air
    # narrower than 2 x radius between the two
    dist_U = ndi.distance_transform_edt(~U)
    dil = dist_U <= r_vox
    dist_in = ndi.distance_transform_edt(dil)
    closed = U | (dist_in >= r_vox)
    near_F = ndi.distance_transform_edt(~Fo) <= r_vox + 1.0
    add = closed & ~U & near_F
    foot = Fo & ~Fo_orig if foot_added else np.zeros(shape, bool)
    if avoid is not None and avoid_mm > 0 and add.any():
        from scipy.spatial import cKDTree
        P = np.asarray(avoid, float)
        if len(P):
            idx = np.argwhere(add)
            ctr = lo + (idx + 0.5) * cell
            d, _ = cKDTree(P).query(ctr, distance_upper_bound=avoid_mm)
            add[tuple(idx[np.isfinite(d)].T)] = False
    # only fillets that touch both the fill and the body are seams (a pocket of the fill's own shape is left alone)
    lab, nlab = ndi.label(add)
    if nlab:
        touchO = ndi.binary_dilation(O, iterations=1); touchF = ndi.binary_dilation(Fo, iterations=1)
        keep = np.zeros(nlab + 1, bool)
        keep[np.intersect1d(np.unique(lab[touchO & add]), np.unique(lab[touchF & add]))] = True
        keep[0] = False
        add = keep[lab]
    add = add | foot
    if not add.any():
        info.update(added_mm3=0.0, volume_ml=round(float(abs(fill.volume)) / 1000.0, 3), watertight=bool(fill.is_watertight), collar=False)
        return fill, info
    # the collar: the fillets (and the foot), carried `overlap` into the fill and into the body on either side of the seam
    near_add = ndi.distance_transform_edt(~add) <= o_vox
    deep_O = ndi.distance_transform_edt(O) > o_vox
    deep_F = ndi.distance_transform_edt(Fo_orig) > o_vox
    C = add | (near_add & (O | Fo_orig) & ~deep_O & ~deep_F)
    occ = ndi.gaussian_filter(C.astype(np.float32), smooth_vox) if smooth_vox > 0 else C.astype(np.float32)
    occ = np.pad(occ, 1, constant_values=0.0)
    from skimage import measure
    try:
        verts, faces, _, _ = measure.marching_cubes(occ, level=0.5, spacing=(cell, cell, cell))
    except Exception as ex:  # noqa
        return None, dict(info, error=f"meshing failed: {ex}")
    verts = verts - cell + (lo + 0.5 * cell)      # voxel (0,0,0) is centred at lo + cell/2; the pad shifts one voxel
    collar = trimesh.Trimesh(verts, faces, process=True)
    collar.fix_normals()
    if taubin > 0:
        try:
            c2 = trimesh.smoothing.filter_taubin(collar.copy(), lamb=0.5, nu=-0.53, iterations=int(taubin))
            if c2.is_watertight or not collar.is_watertight:
                collar = c2
        except Exception:  # noqa
            pass
    if not collar.is_watertight:
        collar.fill_holes()
    pieces = [q for q in collar.split(only_watertight=False) if abs(q.volume) > 0.02]
    if not pieces:
        return fill, dict(info, added_mm3=0.0, collar=False, volume_ml=round(float(abs(fill.volume)) / 1000.0, 3))
    # one solid: fill + collar (manifold union; the pieces are kept side by side if that fails - the body union
    # takes each watertight piece on its own)
    import manifold3d as m3
    mf = _to_manifold(fill)
    out = None
    if mf is not None:
        acc = mf
        for q in pieces:
            mq = _to_manifold(q)
            if mq is None:
                continue
            u = acc + mq
            if u.status() == m3.Error.NoError and not u.is_empty():
                acc = u
        out = _from_manifold(acc)
    if out is None or len(out.faces) < 4:
        out = trimesh.util.concatenate([fill] + pieces)
        info["union"] = "concatenated"
    info.update(added_mm3=round(float(add.sum()) * cell ** 3, 2), foot_mm3=round(float(foot_added) * cell ** 3, 2), collar=True, collar_pieces=len(pieces),
                volume_ml=round(float(abs(out.volume)) / 1000.0, 3), watertight=bool(out.is_watertight))
    if log:
        log(f"fused into the model: {info['added_mm3']:.1f} mm3 of fillet ({radius} mm) along the seams, {overlap} mm into fill and body")
    return out, info


def fuse_many(fill, surface, log=None, keep_failed=True, **kw):
    """`fill` may hold several pieces (the contact fills come as one mesh): each is fused on its own grid. A piece
    the fuse cannot handle is kept as it was (`keep_failed`) rather than lost. Returns (one mesh or None, info)."""
    out, infos, failed = [], [], 0
    pieces = fill.split(only_watertight=False) if fill is not None else []
    if fill is not None and not pieces:
        pieces = [fill]
    for q in pieces:
        if len(q.faces) < 4:
            continue
        try:
            m, inf = fuse_fill(q, surface, log=None, **kw)
        except Exception as ex:  # noqa
            m, inf = None, dict(error=str(ex)[:120])
        infos.append(inf)
        if m is not None:
            out.append(m)
        else:
            failed += 1
            if keep_failed:
                out.append(q)
    info = dict(pieces=len(pieces), fused=len(pieces) - failed, failed=failed, fillet_mm3=round(sum(i.get("added_mm3", 0.0) for i in infos), 1),
                radius=kw.get("radius", 0.6), overlap=kw.get("overlap", 0.2))
    if failed:
        info["errors"] = sorted({i.get("error", "?") for i in infos if "error" in i})
    if log and pieces:
        log(f"block-out: {info['fused']} of {len(pieces)} piece{'s' if len(pieces) != 1 else ''} fused into the model - {info['fillet_mm3']:.1f} mm3 of fillet "
            f"({info['radius']} mm) at the seams, {info['overlap']} mm into the body" + (f"; {failed} left as made ({', '.join(info['errors'])})" if failed else ""))
    return (trimesh.util.concatenate(out) if len(out) > 1 else out[0]) if out else None, info


def paint_fill(surface, paint, cell=0.1, pad=2.0, grow_mm=0.4, taper_foot=0.65, taper_start=0.0, min_thick=0.3, min_depth=0.15,
               proud=0.0, max_voxels=4.0e6, smooth_vox=0.7, taubin=6, log=None):
    """The painted block-out, built in 3D (10/27/2026). The space under an overhang that the doctor marked out is the
    air that has body above it and body below it in its column - the undercut between a crown's bulge (or a pontic,
    an implant crown's emergence) and the gum under it. That is the fill: every such voxel within the painted footprint
    (`grow_mm` round the painted vertices), out to the crown's own silhouette - a wall straight down from the height of
    contour, flush with the contour, standing on the gum. Nothing is ever placed over gum that has no body above it,
    and nothing is thinner than the grid.

    This replaces the column heightfield of blockout.undercut_fill for painted areas: on a lingually leaning molar the
    "overhang" is the crown's own lingual face, and a heightfield whose top had to follow that steep face came out as
    a lace of slivers lying on the enamel and the gum (Anvalina Faltz's lower, 10/27/2026 - the doctor: "distorts it
    and makes it unusable"). A 3D occupancy has no such top: the fill is the air itself.

    `taper_foot` > 0 gives the sloped face of the doctor's sketch (a pontic, an implant crown): the face starts
    `taper_start` under the height of contour at the contour and runs straight down and in to the gum, its foot
    `taper_foot` of the undercut's depth in from the contour; 0 = the vertical wall. Pieces whose horizontal depth is
    under `min_depth` mm everywhere (no real undercut) or thinner than `min_thick` mm are dropped and named.
    Returns (mesh or None, info)."""
    V = np.asarray(surface.vertices, float); F = np.asarray(surface.faces)
    pm = np.asarray(paint, bool)
    info = dict(cell=cell, painted_vertices=int(pm.sum()), pieces=0, dropped=[])
    if pm.sum() < 3:
        return None, dict(info, error="nothing painted")
    P = V[pm]
    lo = P.min(0) - pad; hi = P.max(0) + pad
    lo[2] -= 4.0; hi[2] += 4.0                        # the overhang above and the gum below may lie outside the painted band
    ext = hi - lo
    nvox = np.prod(np.ceil(ext / cell))
    if nvox > max_voxels:
        cell = float(np.ceil(cell * (nvox / max_voxels) ** (1.0 / 3.0) * 200.0) / 200.0)
        info["cell"] = cell
    shape = tuple(int(x) for x in np.ceil(ext / cell).astype(int) + 1)
    nx, ny, nz = shape
    inbox = np.all((V[:, :2] >= lo[:2] - cell) & (V[:, :2] <= hi[:2] + cell), axis=1)
    fsel = inbox[F].any(axis=1)
    if not fsel.any():
        return None, dict(info, error="no surface round the painted area")
    O = column_occupancy(V, F[fsel], lo, cell, shape, open_below=True)
    O = ndi.binary_closing(O, iterations=1) | O
    # air with body above it and body below it in the same column: the undercut
    above = np.cumsum(O[:, :, ::-1], axis=2)[:, :, ::-1] > 0          # any body at or above this voxel
    above = np.roll(above, -1, axis=2); above[:, :, -1] = False       # strictly above
    below = np.cumsum(O, axis=2) > 0
    below = np.roll(below, 1, axis=2); below[:, :, 0] = False          # strictly below
    air = ~O & above & below
    # within the painted footprint, grown a little (the brush is rough)
    ij = np.floor((P[:, :2] - lo[:2]) / cell).astype(int)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < nx) & (ij[:, 1] >= 0) & (ij[:, 1] < ny)
    foot = np.zeros((nx, ny), bool); foot[ij[ok, 0], ij[ok, 1]] = True
    foot = ndi.binary_dilation(foot, iterations=max(1, int(round(grow_mm / cell))))
    Fo = air & foot[:, :, None]
    if not Fo.any():
        return None, dict(info, error="no undercut under the painted area")
    # the Block-out amount (Settings): the wall `proud` mm out past the contour (into the air beside the fill, at each
    # height, standing on body) or in from it
    n_pr = int(round(abs(proud) / cell)) if proud else 0
    if n_pr:
        hstruct = np.zeros((3, 3, 1), bool); hstruct[:, :, 0] = True
        if proud > 0:
            Fo |= ndi.binary_dilation(Fo, structure=hstruct, iterations=n_pr) & ~O & below & foot[:, :, None]
        else:
            Fo = ndi.binary_erosion(Fo, structure=hstruct, iterations=n_pr)
        if not Fo.any():
            return None, dict(info, error="no undercut under the painted area")
    # the sloped face (per connected piece of the footprint): the contour is where the fill's ceiling is highest
    if taper_foot and taper_foot > 0:
        col = Fo.any(axis=2)
        kz = np.arange(nz)[None, None, :]
        z_top = np.where(col, np.max(np.where(Fo, kz, -1), axis=2), -1).astype(float)      # the overhang's underside (voxel index)
        z_bot = np.where(col, np.min(np.where(Fo, kz, nz + 1), axis=2), nz + 1).astype(float)
        lab, nlab = ndi.label(col)
        keep = np.ones(shape, bool)
        for k in range(1, nlab + 1):
            cm = lab == k
            if cm.sum() < 4:
                continue
            edge = cm & ~ndi.binary_erosion(cm, iterations=1)
            zt_max = z_top[cm].max()
            contour = edge & (z_top >= zt_max - 0.5 / cell)          # the outer edge, where the ceiling is at the height of contour
            if not contour.any():
                continue
            din = ndi.distance_transform_edt(~contour) * cell       # how far in from the contour each column is
            D = max(float(din[cm].max()), 2 * cell)
            top0 = (z_top[cm].max() * cell) - taper_start            # the face's start: at the contour, taper_start under the ceiling
            zb = z_bot * cell
            plane = top0 - np.clip(din, 0, None) * np.maximum(top0 - zb, 0.0) / max(taper_foot * D, 2 * cell)
            kplane = plane / cell
            keep &= ~(cm[:, :, None] & (kz < kplane[:, :, None]))
        Fo &= keep
    # pieces: drop what has no real undercut (horizontal depth under min_depth) or is thinner than min_thick
    lab, nlab = ndi.label(Fo)
    if not nlab:
        return None, dict(info, error="no undercut under the painted area")
    keep = np.zeros(nlab + 1, bool)
    dist_in = ndi.distance_transform_edt(Fo) * cell                  # half-thickness inside the fill
    for k in range(1, nlab + 1):
        m = lab == k
        n_vox = int(m.sum())
        thick = 2.0 * float(dist_in[m].max())
        col_k = m.any(axis=2)
        depth = float(ndi.distance_transform_edt(col_k).max()) * cell * 2.0   # the footprint's width = how far in from the contour it reaches
        if n_vox * cell ** 3 < 0.02:
            continue
        if thick < min_thick or depth < min_depth:
            info["dropped"].append(f"{n_vox * cell ** 3:.2f} mm3 ({thick:.2f} mm thick, {depth:.2f} mm deep)")
            continue
        keep[k] = True
    Fo = keep[lab]
    if not Fo.any():
        return None, dict(info, error="the painted undercut is too shallow or too thin to print" + (f" ({len(info['dropped'])} slivers dropped)" if info["dropped"] else ""))
    occ = ndi.gaussian_filter(Fo.astype(np.float32), smooth_vox) if smooth_vox > 0 else Fo.astype(np.float32)
    occ = np.pad(occ, 1, constant_values=0.0)
    from skimage import measure
    verts, faces, _, _ = measure.marching_cubes(occ, level=0.5, spacing=(cell, cell, cell))
    verts = verts - cell + (lo + 0.5 * cell)
    m = trimesh.Trimesh(verts, faces, process=True)
    m.fix_normals()
    if taubin > 0:
        try:
            m2 = trimesh.smoothing.filter_taubin(m.copy(), lamb=0.5, nu=-0.53, iterations=int(taubin))
            if m2.is_watertight or not m.is_watertight:
                m = m2
        except Exception:  # noqa
            pass
    if not m.is_watertight:
        m.fill_holes()
    pieces = [q for q in m.split(only_watertight=False) if abs(q.volume) > 0.02]
    if not pieces:
        return None, dict(info, error="nothing left of the painted fill after meshing")
    out = trimesh.util.concatenate(pieces) if len(pieces) > 1 else pieces[0]
    info.update(pieces=len(pieces), volume_ml=round(float(sum(abs(q.volume) for q in pieces)) / 1000.0, 3), spots=len(pieces),
                deepest_mm=round(float(max(ndi.distance_transform_edt(Fo.any(axis=2)).max() * cell * 2.0, 0.0)), 2))
    if log:
        log(f"painted block-out: {len(pieces)} undercut{'s' if len(pieces) != 1 else ''} filled in 3D ({info['volume_ml']:.3f} mL, "
            f"{'sloped face' if taper_foot else 'wall'} from the contour to the gum)" + (f"; {len(info['dropped'])} sliver{'s' if len(info['dropped']) != 1 else ''} too thin to print left out" if info["dropped"] else ""))
    return out, info
