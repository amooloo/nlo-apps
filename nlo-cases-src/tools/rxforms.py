#!/usr/bin/env python3
"""Lab Rx forms for NLO Cases: turns a lab's fillable Rx PDF into what the app needs.

    python3 tools/rxforms.py [path/to/original.pdf]

Specialty Appliances' Herbst Rx (MKT-005, Rev 3-25; Amir, 3 Oct 2026). From the form it writes:
  rx/specialty-herbst-source.pdf  the form without Illustrator's private data (3 MB -> ~240 KB), kept so this can be re-run
  src/rxdata.js                   the blank template (base64), where every blank, circle, tooth box and tooth outline is,
                                  and the three standard fonts' character widths (for fitting text on the lines)
  ../nlo-cases-rx-herbst.png      a grey picture of the blank page for the on-screen paper preview (loaded only when needed)

The template is the form with its fill-in fields taken out (their "REQUIRED", "s/", "mm/yy" placeholders would print), the
page's drawing wrapped in q ... Q, three standard fonts added to the page, and an empty last content stream. The app writes
the filled-in Rx by appending a new version of that last stream (an incremental update), so the lab's own page is untouched.
"""
import base64, io, json, math, os, pathlib, re, subprocess, sys, tempfile

import pikepdf, pdfplumber
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'rx' / 'specialty-herbst-source.pdf'
OUT_JS = ROOT / 'src' / 'rxdata.js'
OUT_PNG = ROOT.parent / 'nlo-cases-rx-herbst.png'


def slim_source(path):
    """the original minus Illustrator's private data (fields kept, so the positions can be read again)"""
    pdf = pikepdf.open(path)
    for k in ['/Metadata']:
        if k in pdf.Root: del pdf.Root[k]
    pg = pdf.pages[0].obj
    for k in ['/PieceInfo', '/LastModified', '/Metadata']:
        if k in pg: del pg[k]
    if '/Info' in pdf.trailer: del pdf.trailer['/Info']
    pdf.remove_unreferenced_resources()
    SRC.parent.mkdir(exist_ok=True)
    pdf.save(SRC, object_stream_mode=pikepdf.ObjectStreamMode.disable, compress_streams=True, recompress_flate=True)


def r1(v): return round(float(v), 2)


def read_fields(path):
    """widgets by name: buttons -> circle centers, text fields -> rects"""
    pdf = pikepdf.open(path)
    out = {}
    for a in pdf.pages[0].obj.Annots:
        par = a.get('/Parent')
        name = str(a.get('/T', '')) or ''
        pname = str(par.get('/T', '')) if par is not None else ''
        ft = str(a.get('/FT', '') or (par.get('/FT', '') if par is not None else ''))
        full = (pname + '.' + name).strip('.') if pname and name else (name or pname)
        x0, y0, x1, y1 = [float(v) for v in a.Rect]
        out[full] = {'ft': ft, 'rect': [r1(x0), r1(y0), r1(x1), r1(y1)]}
    return out


# what each circle on the form is called in the app -> the form's own field name
BOX = {
    'rush': 'Charge Expidited Shipping',
    'scan.itero': 'iTero', 'scan.carestream': 'Carestream', 'scan.cerec': 'CEREC', 'scan.trios': 'TRIOS', 'scan.medit': 'Medit', 'scan.other': 'Other Scan Type',
    'design.standard': 'Standard Herbst', 'design.cantilever': 'Cantilever Herbst', 'design.spaceclosing': 'Space Closing Herbst',
    'design.acryliclower': 'Band or Crown Upper/Acrylic', 'design.combination': 'Band/Crown Combination',
    'mech.m4': 'M4 Miniscope 4-part', 'mech.miniscope': 'Specialty Miniscope 3-part', 'mech.applecore': 'Applecore Screws',
    'mech.standard': 'Standard Herbst Mechanism', 'mech.hth': 'HTH Telescope', 'mech.fliplock': 'Flip-lock mech',
    'shims': 'Advancement Shims', 'mio': 'MIO Measurement',
    'bite.wax': 'Use Enclosed wax bite', 'bite.lines': 'Use lines on models', 'bite.class1': 'Position for Class 1',
    'bite.e2e': 'Position Anteriors edge to edge', 'bite.advance': 'Advance BR',
    'exp.mcU': 'Mini click U', 'exp.mcL': 'Mini Click L', 'exp.csU': 'Click Screw U', 'exp.csL': 'Click Screw L',
    'la': 'Lingual Arch Lower', 'tpa': 'Transpalatal Arch', 'qh': 'Quad Helix Upper',
    'rests2': '2nd molar rests', 'restsU': '2nd Molar Rests U', 'restsL': '2nd Molar Rests L',
    'ball': '2nd Molar Rests ball clasps', 'w032': '032 wire', 'w036': '036 wire',
    'awtU': 'AW Tubes Upper', 'awtU018': '018', 'awtU022': 'AW tubes .022', 'awtExt': 'Extend AWT to 2nd bicuspid',
    'awtL': 'AW tubes Lower', 'awtL018': 'AW tubes L .018', 'awtL022': 'AW tubes L .022',
    'awtOcc': 'AW tubes L Occlusal', 'awtCen': 'AW tubes L Center', 'awtGin': 'AW Tubes lower gingival',
    'roc': 'remove occlusal from crowns', 'lugs': 'Lingual seating lugs', 'vent': 'Vent Holes', 'debond': 'Debonding Holes', 'slits': 'Vertical Slits',
    'provides': 'Specialty provides and fits: Anchorage', 'anch.band': 'Anchorage Bands', 'anch.roc': 'Anchorage ROCs',
    'anch.crown': 'Anchorage Crowns', 'anch.onbrace': 'OnBrace', 'enclosed': 'Bands or Crowns enclosed with case Anchorage',
    'printed3d': '3D printed/sintered',
}
# the blank lines: app name -> (form field name, the underline's x0, x1 and y — read off the page below)
TEXT = {
    'doctor': 'Doctor', 'acct': 'Acct Numb', 'address': 'Address', 'city': 'City', 'state': 'State', 'zip': 'Zip',
    'phone': 'Phone', 'email': 'Email', 'patient': 'Patient Name', 'shipped': 'Date Shipped', 'needed': 'Date Needed',
    'scanOther': 'Other Scan Type Text', 'expOther': 'Other type of Expan', 'shimsMm': 'Adv. Shims MM', 'shimsQty': 'Adv. Shims qty',
    'mioMm': 'MIO Measurement mm', 'advMm': 'Advance BR mm', 'sig': 'Signature', 'license': 'License Number', 'licExp': 'Expiration',
}


def find_field(fields, want):
    if want in fields: return fields[want]
    # child widgets ('018' under 'AW tubes ', '.018' variants): match on the parent + name loosely
    norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
    hits = [k for k in fields if norm(k) == norm(want)]
    if len(hits) == 1: return fields[hits[0]]
    raise SystemExit('field not found: %r (close: %r)' % (want, [k for k in fields if norm(want)[:6] in norm(k)]))


def main():
    if len(sys.argv) > 1:
        slim_source(sys.argv[1]); print('slimmed source ->', SRC, os.path.getsize(SRC), 'bytes')
    src = str(SRC)
    fields = read_fields(src)
    pl = pdfplumber.open(src); page = pl.pages[0]; H = float(page.height)
    # underlines: (x0, x1, y) in PDF coordinates
    lines = []
    for l in page.lines:
        if (l['x1'] - l['x0']) > 15 and abs(l['top'] - l['bottom']) < 0.5:
            lines.append((r1(l['x0']), r1(l['x1']), r1(H - l['bottom'])))
    boxes = {}
    for k, nm in BOX.items():
        x0, y0, x1, y1 = find_field(fields, nm)['rect']
        boxes[k] = [r1((x0 + x1) / 2), r1((y0 + y1) / 2)]
    text = {}
    for k, nm in TEXT.items():
        x0, y0, x1, y1 = find_field(fields, nm)['rect']
        # the underline inside this field's rectangle (the closest one by overlap)
        best = None
        for (lx0, lx1, ly) in lines:
            if y0 - 4 <= ly <= y1 and min(x1, lx1) - max(x0, lx0) > 0.6 * min(x1 - x0, lx1 - lx0):
                if best is None or abs(ly - y0) < abs(best[2] - y0): best = (lx0, lx1, ly)
        if not best: raise SystemExit('no underline for ' + k)
        text[k] = {'x0': max(x0, best[0]) + 1.5, 'x1': min(x1, best[1]) - 1, 'y': best[2]}
    # special instructions: the three ruled lines
    notes = sorted({ly for (lx0, lx1, ly) in lines if lx1 - lx0 > 500}, reverse=True)
    # the tooth boxes in the two grids (anchorage, occlusal rests): the label's own extent, from the page's words
    words = page.extract_words()
    lab = lambda s: {'7': '7', '6': '6', '5/e': '5', '4/d': '4', 'd/4': '4', 'e/5': '5'}.get(s)
    grid = {'anch': {}, 'occl': {}}
    for w in words:
        if w['x0'] < 415 or w['x1'] > 566: continue
        y = H - w['bottom']; n = lab(w['text'])
        if not n or not (205 < y < 320): continue
        which = 'anch' if y > 280 else 'occl'
        upper = y > (300 if which == 'anch' else 220)
        side = 'R' if w['x0'] < 492 else 'L'
        tid = ('U' if upper else 'L') + side + n
        grid[which][tid] = [r1(w['x0']), r1(H - w['bottom']), r1(w['x1']), r1(H - w['top'])]
    for which in grid:
        if len(grid[which]) != 16: raise SystemExit('grid %s: %d boxes' % (which, len(grid[which])))
    # the arch diagram: 40 tooth outlines (28 occlusal + the 12 front views in the middle), top-down coordinates
    curves = [c for c in page.curves if c['x0'] > 415 and c['x1'] < 575 and (H - c['bottom']) > 400 and (H - c['top']) < 660]
    if len(curves) != 40: raise SystemExit('expected 40 tooth outlines, got %d' % len(curves))
    def segs(c):
        out = []
        for op in c['path']:
            pts = [(r1(x), r1(y)) for (x, y) in op[1:]]  # pdfplumber gives top-down y already
            out.append((op[0], pts))
        return out
    def flatten(sg, n=8):
        pts = []; cur = None
        for k, p in sg:
            if k == 'm': cur = p[0]; pts.append(cur)
            elif k == 'l': cur = p[0]; pts.append(cur)
            elif k == 'c':
                (x1, y1), (x2, y2), (x3, y3) = p; (x0, y0) = cur
                for i in range(1, n + 1):
                    t = i / n; u = 1 - t
                    pts.append((u**3*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t**3*x3, u**3*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t**3*y3))
                cur = p[2]
        if len(pts) > 2 and math.dist(pts[0], pts[-1]) < 0.05: pts.pop()
        return pts
    def dstr(sg):
        out = ''
        for k, p in sg:
            if k == 'm': out += 'M%s %s' % p[0]
            elif k == 'l': out += 'L%s %s' % p[0]
            elif k == 'c': out += 'C' + ' '.join('%s %s' % q for q in p)
            elif k == 'h': out += 'Z'
        return out.replace('.0 ', ' ').replace('.0C', 'C')
    def centroid(poly):
        a = cx = cy = 0
        for i in range(len(poly)):
            x0, y0 = poly[i]; x1, y1 = poly[(i + 1) % len(poly)]
            cr = x0 * y1 - x1 * y0; a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr
        a /= 2
        return (cx / (6 * a), cy / (6 * a), abs(a))
    T = []
    for c in curves:
        sg = segs(c); poly = flatten(sg); cx, cy, area = centroid(poly)
        T.append({'sg': sg, 'poly': poly, 'c': (cx, cy), 'area': area})
    up = [t for t in T if t['c'][1] < 792 - 548]          # occlusal upper arch (top of the diagram)
    fu = [t for t in T if 792 - 548 <= t['c'][1] < 792 - 530]  # upper front teeth (middle row)
    fl = [t for t in T if 792 - 530 <= t['c'][1] < 792 - 505]  # lower front teeth
    lo = [t for t in T if t['c'][1] >= 792 - 505]         # occlusal lower arch
    assert (len(up), len(fu), len(fl), len(lo)) == (14, 6, 6, 14), (len(up), len(fu), len(fl), len(lo))
    mid = sum(t['c'][0] for t in up) / 14
    teeth = {}
    for arch, lst in (('U', up), ('L', lo)):
        right = sorted([t for t in lst if t['c'][0] < mid], key=lambda t: (t['c'][1] if arch == 'U' else -t['c'][1]))
        left = sorted([t for t in lst if t['c'][0] >= mid], key=lambda t: (t['c'][1] if arch == 'U' else -t['c'][1]))
        # upper: incisors at the top (small y) -> 1..7 by y ascending; lower: incisors at the bottom -> 1..7 by y descending
        assert len(right) == 7 and len(left) == 7
        seq = list(reversed(right)) + left   # R7 .. R1, L1 .. L7
        ids = [arch + 'R' + str(7 - i) for i in range(7)] + [arch + 'L' + str(i + 1) for i in range(7)]
        ys = {i: t['c'] for i, t in zip(ids, seq)}
        ref = (mid, (ys[arch + 'R5'][1] + ys[arch + 'R6'][1]) / 2)
        for k, (tid, t) in enumerate(zip(ids, seq)):
            a = seq[max(0, k - 1)]['c']; b = seq[min(13, k + 1)]['c']
            tx, ty = b[0] - a[0], b[1] - a[1]; L = math.hypot(tx, ty); tx, ty = tx / L, ty / L
            bx, by = -ty, tx
            if (t['c'][0] - ref[0]) * bx + (t['c'][1] - ref[1]) * by < 0: bx, by = -bx, -by
            mx, my = (tx, ty) if tid[1] == 'R' else (-tx, -ty)   # toward the midline along the arch
            teeth[tid] = {'d': dstr(t['sg']), 'c': [r1(t['c'][0]), r1(t['c'][1])], 'r': r1(math.sqrt(t['area'] / math.pi)),
                          'b': [round(bx, 3), round(by, 3)], 'm': [round(mx, 3), round(my, 3)],
                          'p': [v for pt in t['poly'] for v in (r1(pt[0]), r1(pt[1]))]}
    front = {'U': [dstr(t['sg']) for t in sorted(fu, key=lambda t: t['c'][0])], 'L': [dstr(t['sg']) for t in sorted(fl, key=lambda t: t['c'][0])]}
    # R / L labels beside the arches (top-down)
    rl = {}
    for w in words:
        y = H - w['bottom']
        if w['text'] in ('R', 'L') and 515 < y < 535: rl[w['text']] = [r1(w['x0']), r1(w['top']), r1(w['x1']), r1(w['bottom'])]

    # ---------- the template ----------
    pdf = pikepdf.open(src)
    for k in ['/AcroForm', '/Metadata', '/Names', '/OpenAction', '/AA']:
        if k in pdf.Root: del pdf.Root[k]
    pg = pdf.pages[0]
    for k in ['/Annots', '/PieceInfo', '/LastModified', '/Metadata', '/AA']:
        if k in pg.obj: del pg.obj[k]
    if '/Info' in pdf.trailer: del pdf.trailer['/Info']
    pg.contents_coalesce()
    body = pg.obj.Contents.read_bytes()
    orig = pdf.make_stream(b'q\n' + body + b'\nQ\n')
    overlay = pdf.make_stream(b'\n')
    pg.obj.Contents = pikepdf.Array([orig, overlay])
    pdf.remove_unreferenced_resources()
    # the fonts the filled-in text uses (added after the clean-up above, which would drop them as unused)
    fonts = pg.obj.Resources.Font
    for key, base in (('/NLOH', '/Helvetica'), ('/NLOB', '/Helvetica-Bold'), ('/NLOT', '/Times-Italic')):
        fonts[key] = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name(base), Encoding=pikepdf.Name.WinAnsiEncoding))
    tmp = io.BytesIO()
    pdf.save(tmp, object_stream_mode=pikepdf.ObjectStreamMode.disable, compress_streams=True, recompress_flate=True, linearize=False, fix_metadata_version=False, deterministic_id=True)
    data = tmp.getvalue()
    chk = pikepdf.open(io.BytesIO(data))
    cont = chk.pages[0].obj.Contents
    ov = cont[len(cont) - 1]
    ov_num = ov.objgen[0]
    tail = data[-1200:].decode('latin-1')
    sx = int(re.search(r'startxref\s+(\d+)\s+%%EOF\s*$', tail).group(1))
    trailer = data[sx:].decode('latin-1')
    size = int(re.search(r'/Size (\d+)', trailer).group(1))
    root = re.search(r'/Root (\d+ \d+ R)', trailer).group(1)
    pid = re.search(r'/ID \[\s*(<[0-9a-fA-F]+>)\s*(<[0-9a-fA-F]+>)\s*\]', trailer)
    assert data.startswith(b'%PDF-') and 'xref' in trailer, 'classic xref table expected'
    print('template', len(data), 'bytes; overlay object', ov_num, 'startxref', sx, 'size', size, 'root', root)

    # ---------- the on-screen paper (grey, 8 shades, 2x for sharp screens) ----------
    with tempfile.TemporaryDirectory() as td:
        p = pathlib.Path(td) / 't.pdf'; p.write_bytes(data)
        subprocess.run(['pdftoppm', '-r', '144', '-gray', '-png', '-singlefile', str(p), str(pathlib.Path(td) / 'pv')], check=True)
        im = Image.open(pathlib.Path(td) / 'pv.png').convert('L')
        im.quantize(colors=8, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(OUT_PNG, optimize=True)
    print('preview', OUT_PNG.name, os.path.getsize(OUT_PNG), 'bytes')

    # ---------- the standard fonts' widths (WinAnsi, codes 32..255; 0 = no character) ----------
    from reportlab.pdfbase.pdfmetrics import stringWidth
    def widths(font):
        out = []
        for code in range(32, 256):
            try: ch = bytes([code]).decode('cp1252')
            except UnicodeDecodeError: out.append(0); continue
            out.append(int(round(stringWidth(ch, font, 1000))))
        return out

    form = {
        'id': 'specialty-herbst', 'title': 'Herbst Appliance Rx', 'lab': 'Specialty Appliances', 'rev': 'MKT-005, Rev 3-25',
        'pdf': {'b64': base64.b64encode(data).decode(), 'obj': ov_num, 'xref': sx, 'size': size, 'root': root,
                'id': (pid.group(1) + pid.group(2)) if pid else ''},
        'preview': OUT_PNG.name, 'boxes': boxes, 'text': text, 'notes': notes[:3], 'grid': grid,
        'teeth': teeth, 'front': front, 'rl': rl, 'clip': [423, 140, 140, 236],
    }
    js = ('/* generated by tools/rxforms.py from Specialty Appliances\' Herbst Rx (MKT-005, Rev 3-25) — do not edit by hand.\n'
          '   The blank form (fields taken out), where everything on it is (PDF points; the arch outlines top-down), and the\n'
          '   standard fonts\' widths for fitting text on the lines. */\n'
          'const RX_FORMS = { \'specialty-herbst\': ' + json.dumps(form, separators=(',', ':')) + ' };\n'
          'const RX_FONT_W = ' + json.dumps({'H': widths('Helvetica'), 'B': widths('Helvetica-Bold'), 'T': widths('Times-Italic')}, separators=(',', ':')) + ';\n')
    OUT_JS.write_text(js)
    print('wrote', OUT_JS.name, len(js), 'chars')


if __name__ == '__main__':
    main()
