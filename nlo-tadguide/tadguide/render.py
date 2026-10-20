"""Cross-sections of the CBCT as PNG images for the browser, with what matters drawn on them:
the scan's outline (coral), the guide's outline (blue), each TAD (yellow), and - for a TAD's own views - what the
app counted as root (red tint), so the doctor can see what the numbers are based on."""
import io
import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFont

from . import volume as V


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) + 1e-12)


def _section(mesh_v, mesh_f, origin, normal):
    """Segments where a mesh crosses a plane: (n, 2, 3)."""
    if mesh_v is None or not len(mesh_f):
        return np.zeros((0, 2, 3))
    d = (mesh_v - origin) @ normal
    s = np.sign(d)
    fs = s[mesh_f]
    cross = ~((fs[:, 0] == fs[:, 1]) & (fs[:, 1] == fs[:, 2]))
    F = mesh_f[cross]
    if not len(F):
        return np.zeros((0, 2, 3))
    segs = []
    for (a, b) in ((0, 1), (1, 2), (2, 0)):
        da, db = d[F[:, a]], d[F[:, b]]
        m = (da * db) < 0
        t = np.zeros(len(F))
        t[m] = da[m] / (da[m] - db[m])
        p = mesh_v[F[:, a]] + t[:, None] * (mesh_v[F[:, b]] - mesh_v[F[:, a]])
        segs.append((p, m))
    out = []
    pts = np.stack([s[0] for s in segs], axis=1)       # (n, 3 edges, 3)
    msk = np.stack([s[1] for s in segs], axis=1)       # (n, 3)
    two = msk.sum(axis=1) == 2
    pts, msk = pts[two], msk[two]
    order = np.argsort(~msk, axis=1, kind="stable")[:, :2]
    a = pts[np.arange(len(pts)), order[:, 0]]
    b = pts[np.arange(len(pts)), order[:, 1]]
    return np.stack([a, b], axis=1)


def plane(vol, levels, center, e1, e2, half=15.0, px=0.1, scan=None, guide=None, tads=(), roi=None, labels=None, sel=None):
    """PNG bytes of the plane through `center` spanned by e1 (image right) and e2 (image up)."""
    e1, e2 = unit(e1), unit(e2)
    n = int(round(2 * half / px))
    uu = (np.arange(n) + 0.5) * px - half
    g1, g2 = np.meshgrid(uu, uu[::-1], indexing="xy")            # row 0 = top of the image
    pts = center + g1.reshape(-1, 1) * e1 + g2.reshape(-1, 1) * e2
    I = V.sample(vol, pts).reshape(n, n)
    lo, hi = V.window(levels)
    g = np.clip((I - lo) * (255.0 / max(hi - lo, 1.0)), 0, 255).astype(np.uint8)
    rgb = np.dstack([g, g, g]).astype(np.float32)
    if roi is not None and roi.get("root") is not None:
        f = (pts - roi["c"] - roi["ax"][0]) / roi["step"]
        m = ndi.map_coordinates(roi["root"].astype(np.float32), [f[:, 0], f[:, 1], f[:, 2]], order=0, mode="constant", cval=0).reshape(n, n) > 0.5
        rgb[m] = rgb[m] * 0.55 + np.array([235.0, 60.0, 50.0]) * 0.45
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    dr = ImageDraw.Draw(img)
    nrm = unit(np.cross(e1, e2))

    def to_px(p):
        q = np.asarray(p) - center
        return ((q @ e1 + half) / px, (half - q @ e2) / px)

    for mesh, col, w in ((scan, (250, 98, 77), 2), (guide, (90, 150, 255), 2)):
        if mesh is None:
            continue
        segs = _section(mesh[0], mesh[1], center, nrm)
        for a, b in segs:
            pa, pb = to_px(a), to_px(b)
            if -5 < pa[0] < n + 5 and -5 < pa[1] < n + 5:
                dr.line([pa, pb], fill=col, width=w)
    for t in tads:
        H = np.asarray(t["head"], float)
        d = unit(t["dir"])
        D, L, c = float(t["diameter"]), float(t["length"]), float(t.get("collar", 1.5))
        col = (255, 214, 10) if (sel is None or t.get("id") == sel) else (255, 214, 10, 120)
        dist_axis = abs(np.dot(d, nrm))
        if dist_axis < 0.35:                                   # the screw lies (nearly) in the plane: outline
            side = unit(np.cross(nrm, d))
            off = np.dot(H - center, nrm)
            if abs(off) > D:
                continue
            tip = H + d * (c + L)
            poly = [H + side * D / 2, tip - d * D * 0.6 + side * D / 2, tip, tip - d * D * 0.6 - side * D / 2, H - side * D / 2]
            dr.line([to_px(p) for p in poly] + [to_px(poly[0])], fill=col, width=2)
            hd = [H + side * (D * 0.75 + 0.6), H - d * 1.6 + side * (D * 0.75 + 0.6), H - d * 1.6 - side * (D * 0.75 + 0.6), H - side * (D * 0.75 + 0.6)]
            dr.line([to_px(p) for p in hd] + [to_px(hd[0])], fill=col, width=1)
            dr.line([to_px(H + d * c + side * D / 2), to_px(H + d * c - side * D / 2)], fill=col, width=1)
        else:                                                   # crosses the plane: a circle where it does
            tt = np.dot(center - H, nrm) / np.dot(d, nrm)
            if -1.6 <= tt <= c + L:
                p = H + d * tt
                cx, cy = to_px(p)
                r = (D / 2) / px
                dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=2)
    # 5 mm scale bar and corner labels
    sb = 5.0 / px
    dr.line([(10, n - 12), (10 + sb, n - 12)], fill=(255, 255, 255), width=3)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    dr.text((12, n - 28), "5 mm", fill=(255, 255, 255), font=font)
    if labels:
        for (x, y), txt in labels:
            dr.text((x, y), txt, fill=(200, 230, 255), font=font)
    out = io.BytesIO()
    img.save(out, "PNG", optimize=False, compress_level=3)
    return out.getvalue()


def anatomical(axis):
    """(e1 = image right, e2 = image up) for the standard planes, in LPS millimetres. Facing the patient, as CS
    Imaging shows them: axial - patient's right on the left, anterior up; coronal - patient's right on the left,
    superior up; sagittal - face to the right (like a ceph), superior up."""
    if axis == "axial":
        return np.array([1.0, 0, 0]), np.array([0, -1.0, 0])
    if axis == "coronal":
        return np.array([1.0, 0, 0]), np.array([0, 0, 1.0])
    return np.array([0, -1.0, 0]), np.array([0, 0, 1.0])
