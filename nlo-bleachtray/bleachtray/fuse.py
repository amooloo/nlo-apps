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


def fuse_fill(fill, surface, cell=0.1, radius=0.6, overlap=0.2, pad=1.0, avoid=None, avoid_mm=0.0, max_voxels=3.0e6,
              smooth_vox=0.7, taubin=8, log=None):
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
    if not Fo.any():
        return None, dict(info, error="the fill is thinner than the grid")
    if not O.any():
        return None, dict(info, error="no model surface round the fill")
    U = O | Fo
    # closing of fill + body with a ball of `radius`: the fillets at every concave seam, and every slit of air
    # narrower than 2 x radius between the two
    dist_U = ndi.distance_transform_edt(~U)
    dil = dist_U <= r_vox
    dist_in = ndi.distance_transform_edt(dil)
    closed = U | (dist_in >= r_vox)
    near_F = ndi.distance_transform_edt(~Fo) <= r_vox + 1.0
    add = closed & ~U & near_F
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
    if not add.any():
        info.update(added_mm3=0.0, volume_ml=round(float(abs(fill.volume)) / 1000.0, 3), watertight=bool(fill.is_watertight), collar=False)
        return fill, info
    # the collar: the fillets, carried `overlap` into the fill and into the body on either side of the seam
    near_add = ndi.distance_transform_edt(~add) <= o_vox
    deep_O = ndi.distance_transform_edt(O) > o_vox
    deep_F = ndi.distance_transform_edt(Fo) > o_vox
    C = add | (near_add & U & ~deep_O & ~deep_F)
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
    info.update(added_mm3=round(float(add.sum()) * cell ** 3, 2), collar=True, collar_pieces=len(pieces),
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
