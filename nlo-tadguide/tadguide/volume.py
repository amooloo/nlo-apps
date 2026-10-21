"""CBCT intensity levels, the display copy of the volume, surfaces, sampling, and where the teeth are.

Levels (all in the export's own units - HU-like on the CS 8200, raw grey values on other machines):
    air     below = air (sinus, nasal cavity, airway)
    soft    the soft-tissue peak
    bone    bone surface (the bone mesh)
    dense   teeth / cortical plates (registration target, root check)
    enamel  crowns (finding the dentition)
    metal   brackets, bands, wire, restorations
"""
import numpy as np
from scipy import ndimage as ndi

# Built-in starting levels for machines we know (the CS 8200 values come from a real NLO export, Oct 2026:
# bone 600-800, teeth > 1500, enamel/dentin core > 2500, archwire ~1900, metal cores > 5000).
KNOWN = {
    "carestream cs 8200": dict(air=-500.0, bone=700.0, dense=1500.0, enamel=2500.0, metal=4500.0),
}
# any export in HU-like units (air about -1000, soft tissue about 0) starts from the same levels: they are what
# bone, dentin and enamel read in such units, whatever the machine
HU_PROFILE = dict(air=-500.0, bone=700.0, dense=1500.0, enamel=2500.0, metal=4500.0)


def _valid_sample(vol, step=2):
    s = vol.data[::step, ::step, ::step].ravel()
    ov = vol.meta.get("outside_value")
    if ov is not None:
        s = s[s != ov]
    return s.astype(np.float32)


def auto_levels(vol):
    """Levels from the histogram: Otsu for air/tissue, the soft-tissue peak, multi-Otsu for bone / teeth, Otsu
    inside the dense class for enamel. Machines with a known profile use that profile when the export is in
    HU-like units.

    Metal first: brackets, bands and wires are a thin tail of huge values (up to 32767 on the CS 8200, with
    bone at 700 and enamel at 2500). Left in, that tail stretches every histogram Otsu looks at, and the
    thresholds land one class too high - air at +700, 'bone' at 6500, 'teeth' at 11700 - so the app saw only
    metal and nothing matched (the first real NLO case, 10/20/2026). So the levels are found on the values
    below the 99.9th percentile, and metal is the tail above them."""
    from skimage.filters import threshold_otsu, threshold_multiotsu
    s = _valid_sample(vol)
    if s.size > 4_000_000:
        s = s[:: s.size // 4_000_000 + 1]
    cap = float(np.percentile(s, 99.9))
    body = s[s <= cap]
    # air | soft tissue | hard tissue in one go: a two-class Otsu would split soft from hard (the far, small
    # mode) and call the soft tissue air
    t_air, t_hard = (float(x) for x in threshold_multiotsu(body, classes=3))
    tissue = body[body > t_air]
    mid = body[(body > t_air) & (body <= t_hard)]
    hist, edges = np.histogram(mid if mid.size > 1000 else tissue, bins=256)
    soft = float(edges[int(np.argmax(hist))] + (edges[1] - edges[0]) / 2)
    p999 = float(np.percentile(tissue, 99.9))
    p9997 = float(np.percentile(tissue, 99.97))
    above = tissue[tissue > soft + 0.15 * (p999 - soft)]
    if above.size < 1000:
        above = tissue[tissue > t_hard]
    bone, dense = (float(x) for x in threshold_multiotsu(np.clip(above, None, p9997), classes=3))
    top = tissue[tissue > dense]
    hi = float(np.percentile(top, 99.0)) if top.size > 100 else dense * 1.5
    enamel = float(threshold_otsu(np.clip(top, None, hi))) if top.size > 100 else dense * 1.4
    enamel = max(enamel, dense + 0.25 * (dense - soft))
    metal = max(enamel * 1.5, float(np.percentile(s, 99.995)))
    lv = dict(air=t_air, soft=soft, bone=bone, dense=dense, enamel=enamel, metal=metal, source="auto")
    key = (" ".join([vol.meta.get("manufacturer", ""), vol.meta.get("model", "")])).lower()
    hu_like = (-250 < soft < 350) and t_air < -200          # the profile is in HU-like units: only then
    if hu_like:
        lv.update(HU_PROFILE)
        lv["source"] = "HU profile"
        for k, prof in KNOWN.items():
            name, model = k.split(" ", 1)
            if name in key and model.replace("cs ", "") in key.replace("cs ", ""):
                lv.update(prof)
                lv["source"] = "profile:" + k
                break
    return {k: (round(v, 1) if isinstance(v, float) else v) for k, v in lv.items()}


def window(levels):
    lo = levels["air"] if levels["air"] > levels["soft"] - 3 * (levels["bone"] - levels["soft"]) else levels["soft"] - 1.2 * (levels["bone"] - levels["soft"])
    hi = levels["enamel"] + 0.6 * (levels["enamel"] - levels["dense"])
    return float(lo), float(hi)


def valid_bbox(vol):
    """Index bounding box (z0, z1, y0, y1, x0, x1) of the part of the volume that is not padding."""
    ov = vol.meta.get("outside_value")
    if ov is None:
        nz, ny, nx = vol.shape
        return 0, nz, 0, ny, 0, nx
    m = vol.data[:, ::2, ::2] != ov
    zz = np.where(m.any(axis=(1, 2)))[0]
    yy = np.where(m.any(axis=(0, 2)))[0]
    xx = np.where(m.any(axis=(0, 1)))[0]
    if not len(zz):
        nz, ny, nx = vol.shape
        return 0, nz, 0, ny, 0, nx
    return int(zz[0]), int(zz[-1]) + 1, int(yy[0]) * 2, min(vol.shape[1], int(yy[-1]) * 2 + 2), int(xx[0]) * 2, min(vol.shape[2], int(xx[-1]) * 2 + 2)


def block_mean(a, f):
    """Integer downsampling by block mean; a (nz, ny, nx)."""
    if f == 1:
        return a.astype(np.float32)
    nz, ny, nx = (s // f * f for s in a.shape)
    a = a[:nz, :ny, :nx].astype(np.float32)
    return a.reshape(nz // f, f, ny // f, f, nx // f, f).mean(axis=(1, 3, 5))


def display_volume(vol, levels, max_voxels=48_000_000, bbox=None):
    """uint8 copy for the browser (windowed), cropped to the field of view and block-averaged if large.
    Returns (array (nz, ny, nx) uint8, affine 4x4 from (col,row,slice) of that array to mm)."""
    z0, z1, y0, y1, x0, x1 = bbox or valid_bbox(vol)
    n = (z1 - z0) * (y1 - y0) * (x1 - x0)
    f = 1
    while n / f ** 3 > max_voxels:
        f += 1
    sub = vol.data[z0:z1, y0:y1, x0:x1]
    lo, hi = window(levels)
    if f == 1:
        a = sub.astype(np.float32)
    else:
        a = block_mean(sub, f)
    a = np.clip((a - lo) * (255.0 / max(hi - lo, 1.0)), 0, 255).astype(np.uint8)
    aff = vol.affine.copy()
    aff[:3, :3] = vol.affine[:3, :3] * f
    # block (0,0,0) centre sits at index (x0 + (f-1)/2, ...) of the full grid
    aff[:3, 3] = vol.index_to_mm([x0 + (f - 1) / 2, y0 + (f - 1) / 2, z0 + (f - 1) / 2])
    return a, aff, dict(lo=lo, hi=hi, factor=f, bbox=[z0, z1, y0, y1, x0, x1])


def sample(vol, pts_mm, order=1, cval=None):
    """Values at points (N, 3) in mm (trilinear)."""
    ijk = vol.mm_to_index(pts_mm)
    coords = np.vstack([ijk[:, 2], ijk[:, 1], ijk[:, 0]])
    c = vol.meta.get("outside_value")
    c = float(c) if c is not None else (float(vol.data.min()) if cval is None else cval)
    return ndi.map_coordinates(vol.data, coords, order=order, mode="constant", cval=c, prefilter=False)


def surface(vol, level, step_mm=0.4, bbox=None, smooth=0.5, max_faces=None, keep_largest=0):
    """Iso-surface (vertices in mm, faces, outward normals) at `level`, on a block-averaged copy.
    bbox: index box (z0, z1, y0, y1, x0, x1). keep_largest: keep only the N biggest pieces (0 = all)."""
    from skimage import measure
    z0, z1, y0, y1, x0, x1 = bbox or valid_bbox(vol)
    sp = min(vol.spacing)
    f = max(1, int(round(step_mm / sp)))
    a = block_mean(vol.data[z0:z1, y0:y1, x0:x1], f)
    if smooth:
        a = ndi.gaussian_filter(a, smooth)
    if a.max() <= level or a.min() >= level:
        return np.zeros((0, 3)), np.zeros((0, 3), int), np.zeros((0, 3))
    v, faces, nrm, _ = measure.marching_cubes(a, level, gradient_direction="descent", allow_degenerate=False)
    # (z, y, x) block index -> full index (col, row, slice) -> mm
    idx = np.column_stack([v[:, 2] * f + x0 + (f - 1) / 2, v[:, 1] * f + y0 + (f - 1) / 2, v[:, 0] * f + z0 + (f - 1) / 2])
    pts = vol.index_to_mm(idx)
    # normals: gradient in index space -> mm space (rotate with the affine's direction part)
    R = vol.affine[:3, :3] / np.linalg.norm(vol.affine[:3, :3], axis=0)
    n = np.column_stack([nrm[:, 2], nrm[:, 1], nrm[:, 0]]) @ R.T
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    faces = orient_faces(pts, faces, n)
    if keep_largest:
        pts, faces, n = _largest(pts, faces, n, keep_largest)
    if max_faces and len(faces) > max_faces:
        pts, faces, n = decimate(pts, faces, max_faces)
    return pts, faces, n


def orient_faces(pts, faces, nrm):
    """Wind the triangles so their right-hand normal agrees with the (outward) vertex normals."""
    if not len(faces):
        return faces
    fn = np.cross(pts[faces[:, 1]] - pts[faces[:, 0]], pts[faces[:, 2]] - pts[faces[:, 0]])
    vn = nrm[faces].sum(axis=1)
    if np.mean(np.sum(fn * vn, axis=1) < 0) > 0.5:
        faces = faces[:, ::-1]
    return np.ascontiguousarray(faces)


def _largest(pts, faces, nrm, k):
    import scipy.sparse as sp
    nv = len(pts)
    e = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    g = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv))
    ncomp, lab = sp.csgraph.connected_components(g, directed=False)
    if ncomp <= k:
        return pts, faces, nrm
    sizes = np.bincount(lab[faces[:, 0]], minlength=ncomp)
    keep = np.argsort(sizes)[::-1][:k]
    fm = np.isin(lab[faces[:, 0]], keep)
    faces = faces[fm]
    used = np.unique(faces)
    remap = -np.ones(nv, int)
    remap[used] = np.arange(len(used))
    return pts[used], remap[faces], nrm[used]


def decimate(pts, faces, max_faces):
    try:
        import fast_simplification
        v2, f2 = fast_simplification.simplify(pts.astype(np.float32), faces.astype(np.int32), target_reduction=float(1 - max_faces / len(faces)))
        import trimesh
        m = trimesh.Trimesh(v2, f2, process=False)
        return np.asarray(v2, float), np.asarray(f2, int), np.asarray(m.vertex_normals)
    except Exception:
        return pts, faces, np.zeros_like(pts)


def _plane(p, ref):
    """Centroid and unit normal (least-spread direction, on ref's side) of a point cloud; ref when the cloud is
    too small or the fit leans more than 35 degrees from ref (a partial arch does not define a plane)."""
    c = p.mean(axis=0)
    if len(p) < 30:
        return c, ref
    _w, U = np.linalg.eigh(np.cov((p - c).T))
    n = U[:, 0]
    if np.dot(n, ref) < 0:
        n = -n
    return c, (n if np.dot(n, ref) > np.cos(np.radians(35)) else ref)


def find_dentition(vol, levels, with_points=False):
    """Where the crowns are: the densest cluster of enamel-level voxels (metal excluded), split into upper and
    lower crowns across the occlusal plane fitted to that enamel - not a horizontal cut, because the head is
    never level in a CBCT: with the occlusal plane pitched or rolled by 10-20 degrees a horizontal cut puts the
    molars of one arch with the incisors of the other. Each arch then gets its own plane: 'occlusal' is the unit
    direction from that arch toward the other (what its crowns face). Returns dict with 'upper'/'lower':
    centroid, lo/hi (mm, 1st/99th percentile), n, occlusal; plus 'normal' (the superior side of the bite) and
    'split_z'. with_points: (dict, {'upper': enamel points mm, 'lower': ...})."""
    sp = np.array(vol.spacing)
    f = max(1, int(round(1.0 / sp.min())))                     # ~1 mm blocks
    a = block_mean(vol.data, f) if f > 1 else vol.data.astype(np.float32)
    en = (a >= levels["enamel"]) & (a < levels["metal"])
    metal = a >= levels["metal"]
    if metal.any():
        en &= ~ndi.binary_dilation(metal, iterations=1)
    if en.sum() < 50:
        en = (a >= levels["dense"]) & (a < levels["metal"])
    # the densest 70 x 60 x 30 mm box of enamel
    bs = f * sp
    size = (max(3, int(30 / bs[2])), max(3, int(60 / bs[1])), max(3, int(70 / bs[0])))
    dens = ndi.uniform_filter(en.astype(np.float32), size=size, mode="constant")
    c = np.unravel_index(int(np.argmax(dens)), dens.shape)
    lo = [max(0, c[i] - size[i] // 2 - 2) for i in range(3)]
    hi = [min(en.shape[i], c[i] + size[i] // 2 + 3) for i in range(3)]
    box = en[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    lab, n = ndi.label(ndi.binary_dilation(box, iterations=1))
    if n == 0:
        return (None, {}) if with_points else None
    sizes = ndi.sum(box, lab, index=np.arange(1, n + 1))
    keep = np.isin(lab, 1 + np.where(sizes >= max(8, 0.01 * sizes.max()))[0]) & box
    kk, jj, ii = np.nonzero(keep)
    idx = np.column_stack([(ii + lo[2]) * f + (f - 1) / 2, (jj + lo[1]) * f + (f - 1) / 2, (kk + lo[0]) * f + (f - 1) / 2])
    pts = vol.index_to_mm(idx)
    from skimage.filters import threshold_otsu
    sup = np.array([0, 0, 1.0])                                   # LPS +z = superior
    c0, nrm = _plane(pts, sup)
    if np.dot(nrm, sup) < 0.5:                                    # more than 60 degrees off: not a bite plane
        nrm = sup
    h = (pts - c0) @ nrm
    try:
        th = float(threshold_otsu(h))
    except Exception:
        th = float(np.median(h))
    up = h > th
    # each arch its own plane (curve of Spee, a slanted bite): every point goes to the nearer one - only while
    # the arches stand apart (a CBCT taken on the bite block); with the teeth together the cut across stays
    for _ in range(4):
        if up.sum() < 30 or (~up).sum() < 30:
            break
        cu, nu = _plane(pts[up], nrm)
        cl, nl = _plane(pts[~up], nrm)
        if np.dot(cu - cl, nrm) < 3.0:
            break
        new = np.abs((pts - cu) @ nu) < np.abs((pts - cl) @ nl)
        if (new == up).all():
            break
        up = new
    out = dict(split_z=float(c0[2] + th * nrm[2]), normal=nrm.tolist(), n_voxels=int(len(pts)))
    groups = {}
    for name, sel in (("upper", up), ("lower", ~up)):
        p = pts[sel]
        if len(p) < 20:
            out[name] = None
            continue
        _c, na = _plane(p, nrm)
        occl = -na if name == "upper" else na
        out[name] = dict(centroid=p.mean(axis=0).tolist(), lo=np.percentile(p, 1, axis=0).tolist(), hi=np.percentile(p, 99, axis=0).tolist(),
                         n=int(len(p)), occlusal=occl.tolist(), tilt_deg=round(float(np.degrees(np.arccos(min(1.0, abs(na[2]))))), 1))
        groups[name] = p
    return (out, groups) if with_points else out


def bbox_mm_to_index(vol, lo_mm, hi_mm, margin_mm=0.0):
    """Index box (z0, z1, y0, y1, x0, x1) covering a mm box (any orientation)."""
    lo, hi = np.asarray(lo_mm, float) - margin_mm, np.asarray(hi_mm, float) + margin_mm
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
    ijk = vol.mm_to_index(corners)
    a = np.floor(ijk.min(axis=0)).astype(int)
    b = np.ceil(ijk.max(axis=0)).astype(int) + 1
    nz, ny, nx = vol.shape
    return (max(0, a[2]), min(nz, b[2]), max(0, a[1]), min(ny, b[1]), max(0, a[0]), min(nx, b[0]))
