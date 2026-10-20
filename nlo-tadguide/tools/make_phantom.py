"""A synthetic upper + lower jaw CBCT and a matching intraoral 'scan' with a known answer - for testing the app
without patient data. Not used by the app itself.

    python tools/make_phantom.py <out_dir> [--brackets] [--jpegll] [--arch upper|lower] [--seed N]

Writes <out_dir>/cbct/IMG0001.dcm ... (HU-like values like the CS 8200: -1000 outside the field of view, soft
tissue ~40, cancellous ~450, cortical ~1400, dentin ~2000, enamel ~2900, brackets 9000),
<out_dir>/scan_<arch>.stl (moved by a random rigid transform), and <out_dir>/truth.json with that transform
(scan file -> CBCT patient mm), the tooth centres, the root axes and the gap centres between roots.
"""
import os, sys, json, argparse
import numpy as np
from scipy import ndimage as ndi

VOX = 0.35
X0, X1, Y0, Y1, Z0, Z1 = -45.0, 45.0, -45.0, 40.0, -40.0, 50.0

UP = dict(w=[8.6, 6.6, 7.6, 7.0, 6.6, 10.2, 9.2], d=[7.0, 6.2, 8.0, 9.0, 9.0, 11.0, 10.5],
          h=[10.5, 9.0, 10.0, 8.0, 7.5, 7.0, 6.5], L=[13, 13, 17, 14, 14, 13, 12], y0=-30.0, a=0.05, occ=0.25, sgn=1.0)
LO = dict(w=[5.4, 5.9, 6.9, 7.0, 7.1, 11.0, 10.4], d=[5.8, 6.2, 7.5, 7.5, 8.0, 10.5, 10.0],
          h=[9.0, 9.5, 10.5, 8.0, 7.5, 7.5, 7.0], L=[12.5, 14, 16, 14, 14.5, 14, 13], y0=-27.5, a=0.056, occ=-0.25, sgn=-1.0)


def arch_xy(arch, s):
    """Point on the arch and the unit tangent pointing distally (away from the midline), at arc length s (mm)
    from the midline; s > 0 = patient left (+x), s < 0 = patient right."""
    xs = np.linspace(0, 45, 4501)
    ys = arch["y0"] + arch["a"] * xs ** 2
    cum = np.concatenate([[0], np.cumsum(np.hypot(np.diff(xs), np.diff(ys)))])
    side = 1.0 if s >= 0 else -1.0
    x = float(np.interp(abs(s), cum, xs))
    y = arch["y0"] + arch["a"] * x * x
    t = np.array([side, 2 * arch["a"] * x])
    return np.array([side * x, y]), t / np.linalg.norm(t)


def teeth_of(arch, name):
    out = []
    inside = np.array([0.0, arch["y0"] + 20.0])
    for side in (1, -1):
        s = 0.0
        for k in range(7):
            w = arch["w"][k]
            c, t = arch_xy(arch, side * (s + w / 2))
            b = np.array([t[1], -t[0]])
            if np.dot(b, c - inside) < 0:          # buccal = away from the inside of the arch
                b = -b
            quad = ("U" if name == "upper" else "L") + ("L" if side > 0 else "R")
            out.append(dict(quad=quad, num=k + 1, c=c, t=t, b=b, w=w, d=arch["d"][k], h=arch["h"][k], L=arch["L"][k],
                            s=side * (s + w / 2), s0=side * s, s1=side * (s + w), cej=arch["occ"] + arch["sgn"] * arch["h"][k]))
            s += w
    return out


def grid():
    xs = np.arange(X0, X1 + 1e-6, VOX)
    ys = np.arange(Y0, Y1 + 1e-6, VOX)
    zs = np.arange(Z0, Z1 + 1e-6, VOX)
    return xs, ys, zs


def sub(xs, ys, zs, lo, hi):
    ix = slice(max(0, int((lo[0] - X0) / VOX)), min(len(xs), int((hi[0] - X0) / VOX) + 2))
    iy = slice(max(0, int((lo[1] - Y0) / VOX)), min(len(ys), int((hi[1] - Y0) / VOX) + 2))
    iz = slice(max(0, int((lo[2] - Z0) / VOX)), min(len(zs), int((hi[2] - Z0) / VOX) + 2))
    Z, Y, X = np.meshgrid(zs[iz], ys[iy], xs[ix], indexing="ij")
    return (iz, iy, ix), X, Y, Z


def tooth_fields(tt, arch, X, Y, Z):
    """crown q (<=1 inside), enamel mask, root mask for one tooth on a sub-grid."""
    sg = arch["sgn"]
    occ = arch["occ"]
    u = (X - tt["c"][0]) * tt["t"][0] + (Y - tt["c"][1]) * tt["t"][1]          # mesiodistal
    v = (X - tt["c"][0]) * tt["b"][0] + (Y - tt["c"][1]) * tt["b"][1]          # buccolingual
    zz = (Z - occ) * sg                                                           # 0 at the occlusal plane, + apical
    ch = 0.62 * tt["h"]
    q = (u / (tt["w"] / 2)) ** 2 + (v / (tt["d"] / 2)) ** 2 + ((zz - ch) / ch) ** 2
    crown = (q <= 1.0) & (zz <= tt["h"])
    a_min = min(tt["w"], tt["d"]) / 2
    enamel = crown & (q >= (1 - 1.0 / a_min) ** 2) & (zz <= tt["h"] - 1.5)
    # root(s): from the CEJ (zz = h) to the apex, tapering, apex 1 mm distal
    f = np.clip((zz - tt["h"]) / tt["L"], 0, 1)
    dist_off = 1.0 * f
    molar = tt["num"] >= 6
    root = np.zeros_like(crown)
    inside_len = (zz >= tt["h"] - 1.0) & (zz <= tt["h"] + tt["L"])
    if molar:
        for m in (-1, 1):
            cu = m * tt["w"] * 0.24 * np.clip((zz - tt["h"]) / 3.0, 0, 1) + dist_off
            ra = tt["w"] * 0.18 * (1 - f) + 0.5 * f
            rb = tt["d"] * 0.38 * (1 - f) + 0.6 * f
            root |= inside_len & (((u - cu) / ra) ** 2 + (v / rb) ** 2 <= 1)
    else:
        ra = tt["w"] * 0.33 * (1 - f) + 0.5 * f
        rb = tt["d"] * 0.40 * (1 - f) + 0.6 * f
        root |= inside_len & (((u - dist_off) / ra) ** 2 + (v / rb) ** 2 <= 1)
    return crown, enamel, root, u, v, zz


def build(out, brackets=False, seed=0, arch_name="upper"):
    rng = np.random.default_rng(seed)
    xs, ys, zs = grid()
    shape = (len(zs), len(ys), len(xs))
    vol = np.full(shape, 40.0, np.float32)                  # soft tissue
    Zg, Yg, Xg = zs[:, None, None], ys[None, :, None], xs[None, None, :]
    head = np.broadcast_to(((Xg / 44.0) ** 2 + ((Yg - 2) / 42.0) ** 2) <= 1.0, shape)
    truth = dict(teeth=[], gaps=[])
    teeth_all = {}
    tooth_mask = np.zeros(shape, bool)
    root_mask = np.zeros(shape, bool)
    enamel_mask = np.zeros(shape, bool)
    bracket_mask = np.zeros(shape, bool)
    for name, arch in (("upper", UP), ("lower", LO)):
        tl = teeth_of(arch, name)
        teeth_all[name] = tl
        for tt in tl:
            r = max(tt["w"], tt["d"]) / 2 + 2
            zlo = arch["occ"] - 1 if arch["sgn"] > 0 else arch["occ"] - tt["h"] - tt["L"] - 1
            zhi = arch["occ"] + tt["h"] + tt["L"] + 1 if arch["sgn"] > 0 else arch["occ"] + 1
            idx, X, Y, Z = sub(xs, ys, zs, (tt["c"][0] - r - 2, tt["c"][1] - r - 2, zlo), (tt["c"][0] + r + 2, tt["c"][1] + r + 2, zhi))
            crown, enamel, root, u, v, zz = tooth_fields(tt, arch, X, Y, Z)
            tooth_mask[idx] |= crown | root
            root_mask[idx] |= root & ~crown
            enamel_mask[idx] |= enamel
            if brackets and name == arch_name and tt["num"] <= 6:
                bz = (zz > tt["h"] * 0.35) & (zz < tt["h"] * 0.35 + 3.0)
                q = (u / (tt["w"] / 2)) ** 2 + (v / (tt["d"] / 2)) ** 2 + ((zz - 0.62 * tt["h"]) / (0.62 * tt["h"])) ** 2
                outer = (q > 1.0) & (q < 1.55) & (v > 0) & (np.abs(u) < 1.6) & bz
                bracket_mask[idx] |= outer
            ax0 = np.array([tt["c"][0], tt["c"][1], arch["occ"] + arch["sgn"] * tt["h"]])
            ax1 = ax0 + np.array([tt["t"][0], tt["t"][1], 0]) * 1.0 + np.array([0, 0, arch["sgn"] * tt["L"]])
            truth["teeth"].append(dict(arch=name, quad=tt["quad"], num=tt["num"], crown_center=[float(tt["c"][0]), float(tt["c"][1]), float(arch["occ"] + arch["sgn"] * tt["h"] * 0.5)],
                                       cej=ax0.tolist(), apex=ax1.tolist(), s=float(tt["s"])))
    # bone: alveolar ridges around the roots, cortical shell, palate, mandibular body
    bone = np.zeros(shape, bool)
    for name, arch in (("upper", UP), ("lower", LO)):
        sel = (zs > 2) if arch["sgn"] > 0 else (zs < -2)
        foot = root_mask[sel].any(axis=0)
        dist, (iy, ix) = ndi.distance_transform_edt(~foot, sampling=VOX, return_indices=True)
        ridge2d = ndi.binary_closing(dist <= 2.3, iterations=int(4 / VOX))
        # crest 1.5 mm apical to the CEJ of the nearest tooth
        tl = teeth_all[name]
        cxy = np.array([tt["c"] for tt in tl])
        px = xs[ix]; py = ys[iy]
        near = np.argmin((px[..., None] - cxy[:, 0]) ** 2 + (py[..., None] - cxy[:, 1]) ** 2, axis=-1)
        cej = np.array([tt["cej"] for tt in tl])[near]
        crest = cej + arch["sgn"] * 1.5
        if arch["sgn"] > 0:
            b3 = (zs[:, None, None] >= crest[None]) & (zs[:, None, None] <= 32)
        else:
            b3 = (zs[:, None, None] <= crest[None]) & (zs[:, None, None] >= -36)
        bone |= ridge2d[None, :, :] & b3
    # palate: a vaulted plate inside the upper arch
    inside_up = (Yg > UP["y0"] + UP["a"] * Xg ** 2 + 4.0) & (Yg < 22)
    pal_oral = 10.0 + 9.0 * np.clip(1 - (Xg / 20.0) ** 2, 0, 1) * np.clip((Yg - UP["y0"] - 4) / 14.0, 0, 1)
    palate = inside_up & (Zg >= pal_oral) & (Zg <= pal_oral + 4.0 - 1.5 * np.clip((Yg + 5) / 25, 0, 1))
    bone |= palate
    # mandibular body below the lower ridge
    inside_lo = (Yg > LO["y0"] + LO["a"] * Xg ** 2 - 6.0) & (Yg < LO["y0"] + LO["a"] * Xg ** 2 + 6.0) & (Yg < 24)
    bone |= inside_lo & (Zg <= -26) & (Zg >= -38)
    bone &= ~(tooth_mask)
    # cortex: 1.2 mm under the OUTER bone surface (bone + teeth together), a thin lamina dura round the roots
    outer = ndi.binary_fill_holes(bone | tooth_mask)
    depth = ndi.distance_transform_edt(outer, sampling=VOX)
    pdl = ndi.binary_dilation(root_mask, iterations=1) & ~root_mask & bone
    lam = ndi.binary_dilation(root_mask, iterations=2) & ~root_mask & ~pdl & bone
    vol[bone] = 450.0
    tex = ndi.gaussian_filter(rng.normal(0, 1, shape).astype(np.float32), 1.2)
    vol[bone] += 330.0 * tex[bone]
    vol[bone & (depth <= 1.2)] = 1400.0
    vol[lam & (depth > 1.2)] = 900.0
    vol[pdl] = 150.0
    # sinus and nose: air
    for sx in (-1, 1):
        sin = ((Xg - sx * 21) / 10.0) ** 2 + ((Yg - 6) / 13.0) ** 2 + ((Zg - 37) / 11.5) ** 2 <= 1.0
        vol[sin & ~tooth_mask] = -980.0
    nose = (np.abs(Xg) < 11) & (Yg > -24) & (Yg < 25) & (Zg > pal_oral + 4.3) & (Zg < 48)
    vol[nose & ~bone] = -970.0
    vol[tooth_mask] = 2000.0
    vol[enamel_mask] = 2900.0
    vol[bracket_mask] = 9000.0
    vol = ndi.gaussian_filter(vol, 0.7 / VOX * 0.6)
    vol += rng.normal(0, 55.0, shape).astype(np.float32)
    vol[~head] = -1000.0
    # ---- DICOM: axial slices, z inferior -> superior
    os.makedirs(os.path.join(out, "cbct"), exist_ok=True)
    write_dicom(os.path.join(out, "cbct"), vol, (VOX, VOX, VOX), (X0, Y0, Z0))
    # ---- the scan: crowns + gingiva + palate soft tissue of one arch, open like a real scan
    arch = UP if arch_name == "upper" else LO
    scan_v, scan_f = make_scan(arch_name, arch, tooth_mask, bracket_mask, bone, palate, xs, ys, zs)
    # random rigid move: the scan file's own coordinates
    ang = rng.uniform(-np.pi, np.pi, 3)
    R = rot(*ang)
    t = rng.uniform(-40, 40, 3)
    v_file = scan_v @ R.T + t
    import trimesh
    m = trimesh.Trimesh(v_file, scan_f, process=False)
    m.export(os.path.join(out, f"scan_{arch_name}.stl"))
    # truth: file -> CBCT  is  p = R^T (q - t)
    T = np.eye(4)
    T[:3, :3] = R.T
    T[:3, 3] = -R.T @ t
    truth["scan_to_cbct"] = T.tolist()
    truth["arch"] = arch_name
    # gaps between neighbouring roots of the scanned arch, at mid-root depth
    tl = teeth_all[arch_name]
    for side in ("L", "R"):
        q = [tt for tt in tl if tt["quad"].endswith(side)]
        for k in range(len(q) - 1):
            a_, b_ = q[k], q[k + 1]
            s_mid = (a_["s1"] + b_["s0"]) / 2
            c, tg = arch_xy(arch, s_mid)
            zmid = arch["occ"] + arch["sgn"] * (a_["h"] + 5.0)
            truth["gaps"].append(dict(quad=a_["quad"], between=[a_["num"], b_["num"]], point=[float(c[0]), float(c[1]), float(zmid)]))
    json.dump(truth, open(os.path.join(out, "truth.json"), "w"), indent=1)
    return truth


def rot(a, b, c):
    ca, sa, cb, sb, cc, sc = np.cos(a), np.sin(a), np.cos(b), np.sin(b), np.cos(c), np.sin(c)
    Rx = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    Ry = np.array([[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]])
    Rz = np.array([[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def make_scan(name, arch, tooth_mask, bracket_mask, bone, palate, xs, ys, zs):
    from skimage import measure
    sg = arch["sgn"]
    # gingiva: bone dilated 1.8 mm, from the gingival margin to the vestibule; palate soft tissue 2.5 mm
    zsel = (zs * sg >= -2) & (zs * sg <= 26)
    k0, k1 = np.where(zsel)[0][[0, -1]]
    T = tooth_mask[k0:k1 + 1] | bracket_mask[k0:k1 + 1]
    B = bone[k0:k1 + 1]
    zz = zs[k0:k1 + 1][:, None, None] * sg
    G = ndi.distance_transform_edt(~B, sampling=VOX) <= 1.8         # bone + 1.8 mm of gingiva over it
    solid = (T & (zz <= 26)) | (G & (zz >= 5.0))
    if name == "upper":
        pal = palate[k0:k1 + 1]
        has = pal.any(axis=0)
        oral = np.where(has, np.argmax(pal, axis=0), 10 ** 6)        # first palate voxel from below
        kk = np.arange(pal.shape[0])[:, None, None]
        solid |= has[None] & (kk >= oral[None] - int(round(2.5 / VOX)))
    solid = ndi.binary_closing(solid, iterations=2)
    f = ndi.gaussian_filter(solid.astype(np.float32), 0.8)
    v, faces, _n, _ = measure.marching_cubes(f, 0.5, spacing=(VOX, VOX, VOX))
    # (z, y, x) -> mm
    v = v[:, ::-1] + np.array([X0, Y0, zs[k0]])
    v[:, :] = np.column_stack([v[:, 0], v[:, 1], v[:, 2]])
    faces = faces[:, ::-1]
    # open it like a scan: cut at the vestibule depth and behind the last molars
    cz = v[faces].mean(axis=1)
    keep = (cz[:, 2] * sg <= 19.0) & (cz[:, 1] <= 21.0)
    if name == "upper":
        keep |= (cz[:, 2] * sg <= 25.0) & (cz[:, 1] <= 21.0) & (np.abs(cz[:, 0]) < 16)
    import trimesh
    m = trimesh.Trimesh(v, faces[keep], process=True)
    parts = m.split(only_watertight=False)
    m = max(parts, key=lambda p: len(p.faces))
    if len(m.faces) > 260000:
        import fast_simplification
        vv, ff = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32), target_reduction=1 - 260000 / len(m.faces))
        m = trimesh.Trimesh(vv, ff, process=True)
    nrm = m.vertex_normals
    # mean normal must face the mouth (occlusal side): flip if the surface came out inside-out
    if np.dot(nrm.mean(axis=0), np.array([0, 0, -sg])) < 0:
        m.invert()
    return np.asarray(m.vertices), np.asarray(m.faces)


def write_dicom(folder, vol, spacing, origin, jpegll=False):
    """vol (nz, ny, nx) float; spacing (dx, dy, dz); origin LPS of voxel (0,0,0)."""
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid, CTImageStorage
    nz, ny, nx = vol.shape
    study, series, frame = generate_uid(), generate_uid(), generate_uid()
    data = np.clip(np.rint(vol), -1024, 30000).astype(np.int16)
    for k in range(nz):
        fm = FileMetaDataset()
        fm.MediaStorageSOPClassUID = CTImageStorage
        fm.MediaStorageSOPInstanceUID = generate_uid()
        fm.TransferSyntaxUID = ExplicitVRLittleEndian
        ds = Dataset()
        ds.file_meta = fm
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
        ds.PatientName = "Phantom^Test"
        ds.PatientID = "PHANTOM"
        ds.StudyDate = "20261020"
        ds.Modality = "CT"
        ds.Manufacturer = "NLO test phantom"
        ds.ManufacturerModelName = "Phantom"
        ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame
        ds.InstanceNumber = k + 1
        ds.ImagePositionPatient = [float(origin[0]), float(origin[1]), float(origin[2] + k * spacing[2])]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.PixelSpacing = [float(spacing[1]), float(spacing[0])]
        ds.SliceThickness = float(spacing[2])
        ds.Rows, ds.Columns = ny, nx
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
        ds.RescaleIntercept, ds.RescaleSlope = 0, 1
        ds.PixelData = data[k].tobytes()
        p = os.path.join(folder, f"IMG{k + 1:04d}.dcm")
        ds.save_as(p, enforce_file_format=True)
        if jpegll:
            to_jpeg_lossless(p)


def to_jpeg_lossless(path):
    import gdcm
    r = gdcm.ImageReader()
    r.SetFileName(path)
    if not r.Read():
        raise RuntimeError("gdcm read failed")
    ch = gdcm.ImageChangeTransferSyntax()
    ch.SetTransferSyntax(gdcm.TransferSyntax(gdcm.TransferSyntax.JPEGLosslessProcess14_1))
    ch.SetInput(r.GetImage())
    if not ch.Change():
        raise RuntimeError("gdcm transcode failed")
    w = gdcm.ImageWriter()
    w.SetFileName(path)
    w.SetFile(r.GetFile())
    w.SetImage(ch.GetOutput())
    if not w.Write():
        raise RuntimeError("gdcm write failed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--brackets", action="store_true")
    ap.add_argument("--jpegll", action="store_true")
    ap.add_argument("--arch", default="upper")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    t = build(a.out, brackets=a.brackets, seed=a.seed, arch_name=a.arch)
    if a.jpegll:
        for f in sorted(os.listdir(os.path.join(a.out, "cbct"))):
            to_jpeg_lossless(os.path.join(a.out, "cbct", f))
    print("phantom written to", a.out, "-", len(t["teeth"]), "teeth")
