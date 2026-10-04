# Makes the small images the vault page carries: the white office logo (shrunk) and the home-screen icons.
from PIL import Image, ImageDraw
import pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
src_logo = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'nlo-apps' / 'logo-white.png'
out = root / 'assets'; out.mkdir(exist_ok=True)
im = Image.open(src_logo).convert('RGBA')
bbox = im.getbbox(); im = im.crop(bbox)
w = 360; h = round(im.height * w / im.width)
im.resize((w, h), Image.LANCZOS).save(out / 'logo-white.png', optimize=True)

NAVY = (27, 47, 76, 255); MINT = (100, 244, 201, 255); WHITE = (255, 255, 255, 255)
def icon(size, path, pad=0.0):
    s = 4  # draw big, then shrink for smooth edges
    S = size * s
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.22) if pad == 0 else 0
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=NAVY)
    # padlock
    bw, bh = S * 0.46, S * 0.36
    bx, by = (S - bw) / 2, S * 0.46
    sw = S * 0.065
    sx0, sx1 = S * 0.36, S * 0.64
    d.arc([sx0, S * 0.24, sx1, S * 0.24 + (sx1 - sx0)], 180, 360, fill=MINT, width=int(sw))
    d.line([sx0 + sw / 2, S * 0.24 + (sx1 - sx0) / 2, sx0 + sw / 2, by + 2], fill=MINT, width=int(sw))
    d.line([sx1 - sw / 2, S * 0.24 + (sx1 - sx0) / 2, sx1 - sw / 2, by + 2], fill=MINT, width=int(sw))
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=int(S * 0.06), fill=WHITE)
    cx, cy = S / 2, by + bh * 0.45
    d.ellipse([cx - S * 0.04, cy - S * 0.04, cx + S * 0.04, cy + S * 0.04], fill=NAVY)
    d.rectangle([cx - S * 0.016, cy, cx + S * 0.016, cy + S * 0.09], fill=NAVY)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
icon(192, out / 'icon-192.png')
icon(512, out / 'icon-512.png')
icon(180, out / 'apple-touch-icon.png', pad=1)
icon(64, out / 'favicon.png')
for p in sorted(out.iterdir()): print(p.name, p.stat().st_size)
