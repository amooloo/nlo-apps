"""A made-up 'iOrtho export' for tests: a synthetic ceph, the same x-ray scaled and framed with an iOrtho-style
coloured tracing (cyan lines, red landmark dots plus decoys, white contour dots), and an Excel report whose values
follow iOrtho's definitions. No patient data anywhere."""
import io

import numpy as np
from PIL import Image, ImageDraw

from xray import iortho
from xray.iortho import DOT_CODES


def make(seed=0, scale=0.83, pad=(40, 25), facing_left=False, name="Test Patient", dob="05-10-2013"):
    from synth import render
    rng = np.random.default_rng(seed)
    a, pts, facing, _ = render(rng)
    while (facing == "left") != facing_left:
        a, pts, facing, _ = render(rng)
    H, W = a.shape
    orig = Image.fromarray(a)
    pts = {k: np.array(v, float) for k, v in pts.items()}
    sx = 1.0 if facing == "right" else -1.0
    # cusp dots: upper and lower first molar / first premolar cusps, 1.1 mm above and below the contact
    mm = 0.24
    cusp = {}
    for code in ("MOL", "PM"):
        cusp[code] = (pts[code] + [0, -1.1 / mm], pts[code] + [0, 1.1 / mm])
    # the traced image: scaled, framed in white, contrast changed
    tw, th = int(W * scale) + 2 * pad[0], int(H * scale) + 2 * pad[1]
    small = orig.resize((int(W * scale), int(H * scale)), Image.BILINEAR)
    arr = np.asarray(small, np.float64)
    arr = np.clip((arr / 255.0) ** 0.85 * 255 * 1.05, 0, 255).astype(np.uint8)
    canvas = Image.new("RGB", (tw, th), (235, 235, 235))
    canvas.paste(Image.fromarray(arr).convert("RGB"), pad)
    d = ImageDraw.Draw(canvas)
    # original pixel centre u lands at traced scale * u + (scale - 1) / 2 + pad (how the resize maps pixel centres)
    T = lambda p: (p[0] * scale + (scale - 1) / 2 + pad[0], p[1] * scale + (scale - 1) / 2 + pad[1])  # noqa: E731
    # cyan contour lines through some landmarks, with white control dots on them
    for chain in (("Prn", "Sn", "Ls", "Li", "Pos"), ("Ar", "Go", "MPt", "Me", "Gn", "Pog", "B"), ("PNS", "ANS"), ("U1A", "U1T"),
                  ("L1A", "L1T"), ("Po", "Or")):
        xy = [T(pts[c]) for c in chain]
        d.line(xy, fill=(0, 174, 239), width=3)
        for i in range(len(xy) - 1):
            mx, my = (xy[i][0] + xy[i + 1][0]) / 2, (xy[i][1] + xy[i + 1][1]) / 2
            d.ellipse([mx - 5, my - 5, mx + 5, my + 5], fill=(255, 255, 255))
    r = 4
    dots = [T(pts[c]) for c in DOT_CODES] + [T(p) for c in ("MOL", "PM") for p in cusp[c]]
    # decoys like iOrtho's other landmarks: soft-tissue nasion, a symphysis centre, a ramus point, a pterygoid point
    dmm = 1 / mm
    decoys = [pts["N"] + [sx * 6 * dmm, -1 * dmm], pts["L1A"] + [-sx * 1.5 * dmm, 6 * dmm],
              pts["Go"] + [sx * 2 * dmm, -14 * dmm], pts["PNS"] + [-sx * 1 * dmm, -6 * dmm], pts["Prn"] + [-sx * 6 * dmm, -12 * dmm]]
    dots += [T(p) for p in decoys]
    # pure red dots with smooth edges, like iOrtho's: drawn 4x larger and shrunk
    q = 4
    layer = Image.new("RGBA", (tw * q, th * q), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    for x, y in dots:
        X, Y = q * (x + 0.5) - 0.5, q * (y + 0.5) - 0.5
        dl.ellipse([X - q * r, Y - q * r, X + q * r, Y + q * r], fill=(255, 0, 0, 255))
    layer = layer.resize((tw, th), Image.BOX)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), layer).convert("RGB")
    # the report: iOrtho's numbers, from the true points (its definitions), at 0.24 mm per original pixel
    canon = {c: np.array([sx * v[0], -v[1]]) for c, v in pts.items()}
    k = mm
    values = {}
    for _check, names, codes, f, tol in iortho._ang_checks() + iortho._mm_checks() + iortho._op_checks():
        if all(c in canon for c in codes):
            values[names[0]] = round(float(f(canon, k)), 2)
    sn_mm = round(float(np.hypot(*(pts["S"] - pts["N"])) * mm), 2)
    rows = [("Measurement", "Normal", "Standard Deviation", "Value", "Description")]
    rows += [(n, 0, 1, v, "") for n, v in values.items()]
    rows += [("S-N(Length of Anterior Cranial Base mm)", 69.7, 7.5, sn_mm, "")]
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Patient Info"
    ws.append(["Patient Info"])
    ws.append(["Name", "Gender", "Analysis Standard", "Date of Birth", "X-ray Filming Date"])
    ws.append([name, "Female", "Caucasian Norms", dob, "10-15-2026"])
    ws2 = wb.create_sheet("Steiner")
    ws2.append(["Steiner"])
    for row in rows:
        ws2.append(list(row))
    xb = io.BytesIO()
    wb.save(xb)
    ob, tb = io.BytesIO(), io.BytesIO()
    orig.save(ob, format="PNG")
    canvas.save(tb, format="PNG")
    truth = {c: pts[c] for c in DOT_CODES}
    truth["MOL"], truth["PM"] = pts["MOL"], pts["PM"]
    return dict(original=ob.getvalue(), traced=tb.getvalue(), report=xb.getvalue(), truth=truth, facing=facing,
                original_gray=a, traced_rgb=np.asarray(canvas))
