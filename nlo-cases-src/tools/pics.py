"""Turn the case-type pictures Amir chose (pics/<tile>-source.jpg: the whole upper arch with the appliance) into
small JPEGs for the New case tiles and write src/pics.js (data: URLs, allowed by the app's CSP img-src).
Shown on a white plate like the company logos (Amir, 2 Oct 2026: "Use 1" — the whole picture).
Run: python3 tools/pics.py"""
import base64, io, json, pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
H = 138   # px of the stored image (shown 46 px tall, so it stays sharp on 3x screens)

# Amir's intraoral scanner pictures (3 Oct 2026: "use these icons for the scanner types"): the wand on a slant (tip up and
# to the right) in the middle of a small white circle, shown 36 px on the Scanner choices. The iTero's cable is cut short.
SCAN_S = 114          # px of the stored square (shown at 36–38 px)
SCAN_CUT = {'scan-itero': 1200}   # keep the source down to this row (the cable runs off the bottom of the picture)

# … and standing up for the Scanner drawers (3 Oct 2026: "have them halfway hidden and when you hover over them they will fully
# move up, almost like you are picking them from a drawer"): the whole wand, SCAN_V px tall (shown 120 px), key scanv-<name>
SCAN_V = 360

def wand(im, key):
    box = Image.eval(im.convert('L'), lambda v: 255 if v < 245 else 0).getbbox()
    return im.crop((max(box[0] - 4, 0), max(box[1] - 4, 0), min(box[2] + 4, im.width), min(box[3] + 4, SCAN_CUT.get(key, im.height))))

def scanner_v(im, key):
    im = wand(im, key)
    return im.resize((round(im.width * SCAN_V / im.height), SCAN_V), Image.LANCZOS)

def scanner(im, key):
    im = wand(im, key)
    im = im.rotate(-40, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
    im = im.crop(Image.eval(im.convert('L'), lambda v: 255 if v < 245 else 0).getbbox())
    s = SCAN_S * .84 / max(im.size)   # as big as it goes with its ends still inside the circle
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    c = Image.new('RGB', (SCAN_S, SCAN_S), (255, 255, 255)); c.paste(im, ((SCAN_S - im.width) // 2, (SCAN_S - im.height) // 2))
    return c

# Amir's pictures for Dr. A's instructions (3 Oct 2026: "replace all the icons for dr's instructions with new logos"):
# instr-<name>, trimmed and fitted in INSTR_BOX (shown in a 76 × 56 white plate on the tiles, smaller on the Maintain/Improve rows).
# Green arrows he asked to drop were painted out in the sources (open bite, IPR lower, deep bite); Active retention is the
# Retainers picture with a green check added in his arrows' green.
INSTR_BOX = (228, 168)
# … and for the No attachments / No IPR / No elastics tiles (3 Oct 2026: "use these icons for no attachment, no IPR and no
# elastics"): rx-<name>, fitted in RX_BOX (shown in an 84 × 56 white plate). The No attachments picture is a whole arch, much wider
# than tall, so its far sides are cropped to RX_MAX_ASPECT to keep the crossed-out attachment big enough to read.
RX_BOX = (252, 168)
RX_MAX_ASPECT = 1.6
# … and the Herbst Rx pictures (4 Oct 2026: "use these images in the RX sheet for herbst"): herbst-<design or mechanism key>, the
# Standard and Cantilever Herbst and the HTH and Flip-Lock mechanisms, fitted in HERBST_BOX and shown at half that size on the right
# of the option's card (smaller under its name in Compare all)
HERBST_BOX = (480, 260)

out = {}
for src in sorted((root / 'pics').glob('*-source.*')):
    key = src.name.split('-source')[0]
    im = Image.open(src).convert('RGB')
    if key.startswith('instr-') or key.startswith('rx-'):
        box = Image.eval(im.convert('L'), lambda v: 255 if v < 245 else 0).getbbox()
        pad = round(max(im.size) * .012)
        im = im.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width), min(box[3] + pad, im.height)))
        fit = INSTR_BOX
        if key.startswith('rx-'):
            fit = RX_BOX
            if im.width > im.height * RX_MAX_ASPECT:
                w = round(im.height * RX_MAX_ASPECT); x = (im.width - w) // 2; im = im.crop((x, 0, x + w, im.height))
        s = min(fit[0] / im.width, fit[1] / im.height)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=88, optimize=True, progressive=True)
        out[key] = {'src': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode(), 'w': round(im.width / 3), 'h': round(im.height / 3)}
        print(key, '%dx%d' % im.size, len(b.getvalue()), 'bytes')
        continue
    if key.startswith('herbst-'):
        box = Image.eval(im.convert('L'), lambda v: 255 if v < 245 else 0).getbbox()   # trims any white edge (the mouth photos have none)
        pad = round(max(im.size) * .012)
        if box: im = im.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width), min(box[3] + pad, im.height)))
        s = min(HERBST_BOX[0] / im.width, HERBST_BOX[1] / im.height)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=86, optimize=True, progressive=True)
        out[key] = {'src': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode(), 'w': round(im.width / 2), 'h': round(im.height / 2)}
        print(key, '%dx%d' % im.size, len(b.getvalue()), 'bytes')
        continue
    if key.startswith('scan-'):
        for k, pic in ((key, scanner(im, key)), (key.replace('scan-', 'scanv-'), scanner_v(im, key))):
            b = io.BytesIO(); pic.save(b, 'JPEG', quality=90, optimize=True, progressive=True)
            out[k] = {'src': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode(), 'w': round(pic.width / 3), 'h': round(pic.height / 3)}
            print(k, '%dx%d' % pic.size, len(b.getvalue()), 'bytes')
        continue
    # trim the white (and the faint reflection under the trays); the study model and the MARPE model are white themselves, so anything not pure white counts
    th = 252 if key in ('models', 'marpe') else 236
    box = Image.eval(im.convert('L'), lambda v: 255 if v < th else 0).getbbox()
    pad = round(im.width * .01)
    im = im.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, im.width), min(box[3] + pad, im.height)))
    if key == 'retainer':   # a clear tray on white: deepen its grey edges a little so it reads at tile size (white stays white)
        im = Image.eval(im, lambda v: max(0, round(255 - (255 - v) * 1.55)))
    w = round(im.width * H / im.height)
    im = im.resize((w, H), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=88, optimize=True, progressive=True)
    out[key] = {'src': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode(), 'w': round(w / 3), 'h': round(H / 3)}
    print(key, '%dx%d' % (w, H), len(b.getvalue()), 'bytes')

js = ('/* case-type, scanner, Dr. A\'s instruction, No IPR/attachments/elastics and Herbst Rx pictures (chosen by Amir, 2–4 Oct 2026); generated by tools/pics.py, do not edit by hand */\n'
      'const PICS = ' + json.dumps(out, separators=(',', ':')) + ';\n')
(root / 'src' / 'pics.js').write_text(js)
print('wrote src/pics.js', len(js), 'bytes')
