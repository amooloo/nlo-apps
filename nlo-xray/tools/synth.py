"""Synthetic 'cephs' for testing the app without any patient data.

Each picture is a cartoon of a lateral ceph drawn around a randomly varied copy of the template tracing:
bone outlines, teeth, vertebral bodies (with lower-border concavities), a soft-tissue profile, ear rods,
noise and blur - enough structure for the landmark finder to have something to learn, so the whole
pipeline (import, tracing, training, checking) can be exercised end to end. They are not x-rays and say
nothing about how well the finder does on real ones.

    python tools/synth.py OUT_DIR [N] [--seed S]     writes N PNGs + truth.json (landmarks in pixels)
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from xray.landmarks import TEMPLATE  # noqa: E402


# The landmarks jittered, in the order the template had when these pictures were first made: keeping the order keeps
# every random draw - and so every synthetic picture - as it was. The premolar contact is still drawn (a tooth) but no
# longer traced; the facial-thirds points (Gs, Stms, Stmi, Mes) are put on the drawn skin outline afterwards.
_JITTER_ORDER = ["S", "N", "Or", "Po", "Ar", "PNS", "ANS", "A", "U1A", "U1T", "L1T", "L1A", "B", "Pog", "Gn", "Me", "Go",
                 "MPt", "MOL", "PM", "Prn", "Sn", "Ls", "Li", "Pos", "C2lp", "C2d", "C2la", "C3up", "C3ua", "C3lp", "C3d",
                 "C3la", "C4up", "C4ua", "C4lp", "C4d", "C4la"]
_EXTRA = {"PM": (50.2, -65.5)}
FOREHEAD_TOP = (40.0, 70.0)          # where the skin outline drawn by render() comes down the forehead from


def soft_on_skin(s):
    """The facial-thirds points on the skin outline render() draws (canonical mm): G' 12 mm and the top of the
    forehead 50 mm up the forehead edge, the stomia on the lip edge, Me' round the chin."""
    top, a = s["N"] + [8, 2], np.array(FOREHEAD_TOP)
    out = {"Gs": top + 12.0 / (a[1] - top[1]) * (a - top), "Tr": top + 50.0 / (a[1] - top[1]) * (a - top)}
    out["Stms"] = s["Ls"] + 0.45 * (s["Li"] - s["Ls"])
    out["Stmi"] = s["Ls"] + 0.55 * (s["Li"] - s["Ls"])
    out["Mes"] = s["Pos"] + 0.6 * np.array([-10.0, -18.0])
    return out


def varied_shape(rng):
    """Template + global rotation/scale + correlated 'class' and 'vertical' changes + jitter (mm, canonical)."""
    p = {k: np.array(TEMPLATE.get(k, _EXTRA.get(k)), float) for k in _JITTER_ORDER}
    # mandible forward/back (Class II/III-like) and its incisors with it
    dx = rng.uniform(-5, 5)
    for k in ("B", "Pog", "Gn", "Me", "L1T", "L1A", "Li", "Pos"):
        p[k] = p[k] + [dx, 0]
    # vertical: lower face longer/shorter
    dy = rng.uniform(-6, 6)
    for k in ("B", "Pog", "Gn", "Me", "L1A", "Pos"):
        p[k] = p[k] + [0, -dy]
    # vertebral maturity: deeper concavities and taller bodies
    m = rng.uniform(0, 1)
    for lvl, dep in (("C2", 2.2), ("C3", 2.0), ("C4", 1.8)):
        p[f"{lvl}d"] = p[f"{lvl}d"] + [0, m * dep]
    for lvl in ("C3", "C4"):
        p[f"{lvl}ua"] = p[f"{lvl}ua"] + [0, m * 1.5]
        p[f"{lvl}up"] = p[f"{lvl}up"] + [0, m * 2.5]
    ang = math.radians(rng.uniform(-6, 6))
    sc = rng.uniform(0.92, 1.08)
    R = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]]) * sc
    out = {k: R @ v + rng.normal(0, 0.8, 2) for k, v in p.items()}
    out.update(soft_on_skin(out))
    return out, m


def render(rng, w=900, h=1100, mm_px=0.24):
    shape, maturity = varied_shape(rng)
    facing = "right" if rng.random() < 0.7 else "left"
    ox, oy = w * 0.42 + rng.uniform(-30, 30), h * 0.30 + rng.uniform(-30, 30)

    def px(v):
        x = v[0] / mm_px
        if facing == "left":
            x = -x
        return (ox + x, oy - v[1] / mm_px)

    P = {k: px(v) for k, v in shape.items()}
    img = Image.new("L", (w, h), 18)
    d = ImageDraw.Draw(img)
    # skull / face soft-tissue mass
    skin = [px((-60, 60)), px(FOREHEAD_TOP), px(shape["N"] + [8, 2]), px(shape["Prn"]), px(shape["Sn"]),
            px(shape["Ls"]), px(shape["Li"]), px(shape["Pos"]), px(shape["Pos"] + [-10, -18]), px((-10, -120)),
            px((-70, -120))]
    d.polygon(skin, fill=58)
    # cranial vault and base
    d.polygon([px((-60, 55)), px((30, 62)), px(shape["N"] + [2, 6]), px(shape["N"]), px(shape["S"] + [10, -6]),
               px(shape["Po"] + [-20, 0]), px((-62, 0))], fill=96)
    # sella turcica: a dark rounded pit with a bright rim
    s = P["S"]
    r = 5.0 / mm_px
    d.ellipse([s[0] - r, s[1] - r * 0.8, s[0] + r, s[1] + r * 0.8], fill=40, outline=170, width=3)
    # maxilla and palate
    d.polygon([P["PNS"], P["ANS"], P["A"], px(shape["A"] + [1.5, -9]), px(shape["U1A"] + [-8, -14]),
               px(shape["PNS"] + [0, -6])], fill=128)
    d.line([P["PNS"], P["ANS"]], fill=190, width=5)
    # mandible
    mand = [P["Ar"], px(shape["Ar"] + [6, 2]), px(shape["Go"] + [10, 14]), px(shape["B"] + [-4, 4]), P["B"],
            P["Pog"], P["Gn"], P["Me"], P["Go"]]
    d.polygon(mand, fill=124)
    d.line(mand + [P["Ar"]], fill=185, width=3)
    # teeth: tapered bright rods
    for a, b in (("U1A", "U1T"), ("L1A", "L1T")):
        d.line([P[a], P[b]], fill=235, width=int(5.5 / mm_px))
        d.ellipse([P[a][0] - 6, P[a][1] - 6, P[a][0] + 6, P[a][1] + 6], fill=200)
    for k, sz in (("MOL", 5.5), ("PM", 3.8)):
        x, y = P[k]
        rr = sz / mm_px
        d.ellipse([x - rr, y - rr * 1.8, x + rr, y - rr * 0.1], fill=225)
        d.ellipse([x - rr, y + rr * 0.1, x + rr, y + rr * 1.8], fill=215)
    # orbit floor and ear rod
    o = P["Or"]
    d.arc([o[0] - 40, o[1] - 70, o[0] + 40, o[1] + 2], 20, 160, fill=200, width=4)
    po = P["Po"]
    d.ellipse([po[0] - 18, po[1], po[0] + 18, po[1] + 30], outline=250, width=6)
    # vertebrae
    for lvl in ("C3", "C4"):
        poly = [P[f"{lvl}up"], P[f"{lvl}ua"], P[f"{lvl}la"], P[f"{lvl}d"], P[f"{lvl}lp"]]
        d.polygon(poly, fill=150, outline=205)
    c2 = [px(shape["C2lp"] + [0, 16]), px(shape["C2la"] + [0, 12]), P["C2la"], P["C2d"], P["C2lp"]]
    d.polygon(c2, fill=150, outline=205)
    # soft-tissue profile edge
    d.line([P["Prn"], P["Sn"], P["Ls"], P["Li"], P["Pos"]], fill=95, width=3)

    img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.8, 1.8)))
    a = np.asarray(img, np.float32)
    a = a + rng.normal(0, rng.uniform(4, 10), a.shape)
    a = np.clip(a * rng.uniform(0.85, 1.15) + rng.uniform(-10, 10), 0, 255).astype(np.uint8)
    pts = {k: [float(v[0]), float(v[1])] for k, v in P.items()}
    return a, pts, facing, maturity


def main():
    out = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else 20
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 0
    rng = np.random.default_rng(seed)
    os.makedirs(out, exist_ok=True)
    truth = {}
    for i in range(n):
        a, pts, facing, m = render(rng)
        name = f"Synthetic_Patient{i:03d}_ceph.png"
        Image.fromarray(a).save(os.path.join(out, name))
        truth[name] = dict(points=pts, facing=facing, mm_per_px=0.24, maturity=m)
    with open(os.path.join(out, "truth.json"), "w") as f:
        json.dump(truth, f)
    print(f"wrote {n} synthetic cephs to {out}")


if __name__ == "__main__":
    main()
