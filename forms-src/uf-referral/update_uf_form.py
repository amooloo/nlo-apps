"""Rebuild the UF Oral Surgery referral's data inside NLO_Financial_Suite.html ("Forms") from UF's PDF.

When UF sends a new revision of its Request for Consultation: save it here as uf-omfs-referral-source.pdf and run
    python3 update_uf_form.py            (needs: pikepdf, fonttools, pdfplumber, numpy, scipy, Pillow, pyoxipng, poppler's pdftoppm)
It rewrites only the UFR_* data lines in ../../NLO_Financial_Suite.html: UF's file (UFR_TPL), what an incremental update
to it needs (UFR_TPL_INFO), its preview picture (UFR_THUMB) and where every blank, name, tooth box and the X-ray blanks
are (read from the PDF). Then check it: fill a referral, tick every other tooth, and look at the PDF (see test/).
If UF changes the layout itself (new fields, surgeons, a different chart), the code needs a look, not just this script."""
import base64, io, json, pathlib, re, subprocess, sys, tempfile
import numpy as np, oxipng, pdfplumber, pikepdf
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import ttProgram
from PIL import Image
from scipy import ndimage

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / 'uf-omfs-referral-source.pdf'
SUITE = HERE.parent.parent / 'NLO_Financial_Suite.html'
tmp = pathlib.Path(tempfile.mkdtemp())


def template(src, dst):
    """UF's file kept as it is, minus what never prints (tags, XMP, font hinting); plus the page content fenced in q/Q,
    an empty last content stream for the filled-in text, and the two standard fonts it uses."""
    p = pikepdf.open(src)
    for k in ('/StructTreeRoot', '/MarkInfo', '/Metadata'):
        if k in p.Root: del p.Root[k]
    page = p.pages[0].obj
    for k in ('/StructParents', '/Tabs'):
        if k in page: del page[k]
    for f in page.Resources.Font.values():
        fd = f.get('/FontDescriptor'); ff = fd.get('/FontFile2') if fd is not None else None
        if ff is None: continue
        t = TTFont(io.BytesIO(ff.read_bytes()), recalcTimestamp=False)   # (no new timestamp: the same PDF in, the same file out)
        for tag in ('fpgm', 'prep', 'cvt ', 'hdmx', 'VDMX', 'LTSH', 'gasp', 'DSIG', 'kern', 'TSIV', 'TSI0', 'TSI1', 'TSI2', 'TSI3', 'TSI5', 'PCLT'):
            if tag in t: del t[tag]
        if 'glyf' in t:
            for g in t.getGlyphOrder():
                gl = t['glyf'][g]
                if hasattr(gl, 'program'): gl.program = ttProgram.Program(); gl.program.fromBytecode(b'')
        if 'maxp' in t:
            for a in ('maxSizeOfInstructions', 'maxFunctionDefs', 'maxInstructionDefs', 'maxStackElements', 'maxStorage', 'maxTwilightPoints', 'maxZones'):
                if hasattr(t['maxp'], a): setattr(t['maxp'], a, 1 if a == 'maxZones' else 0)
        out = io.BytesIO(); t.save(out); ff.write(out.getvalue()); ff.Length1 = len(out.getvalue())
    orig = page.Contents
    orig = list(orig) if isinstance(orig, pikepdf.Array) else [orig]
    page.Contents = pikepdf.Array([p.make_indirect(pikepdf.Stream(p, b'q\n'))] + orig +
                                  [p.make_indirect(pikepdf.Stream(p, b'\nQ\n')), p.make_indirect(pikepdf.Stream(p, b'% filled in by NLO Forms\n'))])
    p.remove_unreferenced_resources()
    fonts = page.Resources.Font
    for name, base in (('/NLOH', '/Helvetica'), ('/NLOB', '/Helvetica-Bold')):
        fonts[name] = p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name(base), Encoding=pikepdf.Name.WinAnsiEncoding))
    p.save(dst, object_stream_mode=pikepdf.ObjectStreamMode.disable, compress_streams=True, stream_decode_level=pikepdf.StreamDecodeLevel.generalized,
           recompress_flate=True, linearize=False, deterministic_id=True)
    t = pikepdf.open(dst); data = pathlib.Path(dst).read_bytes()
    xref = int(data[data.rindex(b'startxref') + 9:].split()[0]); assert data[xref:xref + 4] == b'xref'
    ov = list(t.pages[0].obj.Contents)[-1]; assert ov.objgen[1] == 0
    ids = t.trailer.get('/ID')
    return {'obj': ov.objgen[0], 'gen': 0, 'size': int(t.trailer.Size), 'xref': xref, 'root': '%d %d R' % t.Root.objgen,
            'id': '<%s> <%s>' % (bytes(ids[0]).hex(), bytes(ids[1]).hex()) if ids is not None else '',
            'info': ('%d %d R' % t.trailer.Info.objgen) if '/Info' in t.trailer else ''}


def thumbnail(pdf):
    subprocess.run(['pdftoppm', '-r', '90', '-png', '-singlefile', str(pdf), str(tmp / 'thumb')], check=True)
    q = Image.open(tmp / 'thumb.png').convert('RGB').quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    b = io.BytesIO(); q.save(b, format='PNG', optimize=True)
    return oxipng.optimize_from_memory(b.getvalue(), level=6, strip=oxipng.StripChunks.all())


def geometry(pdf):
    pg = pdfplumber.open(pdf).pages[0]
    assert (pg.width, pg.height) == (612, 792), 'expected a Letter page'
    words = pg.extract_words(use_text_flow=True)
    blanks = [(r['x0'], r['x1'], r['top']) for r in pg.rects if r['height'] < 1.0 and r['x1'] - r['x0'] > 8] + \
             [(l['x0'], l['x1'], l['top']) for l in pg.lines if abs(l['top'] - l['bottom']) < 1 and l['x1'] - l['x0'] < 300]
    def word(text, near):
        ws = sorted([w for w in words if w['text'] == text], key=lambda w: abs(w['top'] - near[1]) + abs(w['x0'] - near[0]))
        assert ws, 'label not found on the form: ' + text
        return ws[0]
    L = {}
    def field(key, text, near):
        w = word(text, near)
        c = sorted([b for b in blanks if b[0] >= w['x1'] - 2 and abs(b[2] - (w['bottom'] + 1)) < 13], key=lambda b: b[0])
        assert c, 'no blank after ' + text
        L[key] = [round(v, 2) for v in c[0]]
    for args in [('date', 'Referral:', (80, 137)), ('reason', 'Referral:', (274, 137)), ('pname', 'Name:', (82, 234)), ('dob', 'DOB:', (268, 236)),
                 ('mf', 'M/F:', (487, 236)), ('addr1', 'Address:', (53, 255)), ('city', 'State:', (278, 256)), ('zip', ':', (500, 256)),
                 ('pemail', 'Email:', (260, 278)), ('hphone', 'Phone:', (77, 299)), ('cphone', 'Phone:', (276, 300)),
                 ('guard', 'Guardian/Parent:', (430, 298)), ('diag', 'diagnosis:', (166, 329)), ('refdr', 'Dr.', (98, 479)),
                 ('refemail', 'Email:', (286, 482)), ('contact', 'Contact', (479, 484)), ('refaddr', 'Address', (64, 507)),
                 ('refcity', 'State', (305, 505)), ('refzip', 'Zip', (487, 507)), ('refphone', 'Phone', (64, 532)), ('reffax', 'Fax', (286, 532)),
                 ('i1name', 'Insurance', (84, 567)), ('i1phone', 'Phone', (290, 567)), ('i1holder', 'name', (105, 600)),
                 ('i1policy', 'Number', (310, 600)), ('i1group', '#', (494, 600)), ('i1rel', 'patient', (100, 618)), ('i1auth', '#', (333, 618)),
                 ('i2name', 'Insurance', (91, 645)), ('i2phone', 'Phone', (290, 645)), ('i2holder', 'name', (106, 666)),
                 ('i2policy', 'Number', (310, 666)), ('i2group', '#', (496, 666)), ('i2rel', 'Patient', (100, 697)), ('i2auth', '#', (333, 697))]:
        field(*args)
    b2 = sorted([b for b in blanks if L['addr1'][2] + 12 < b[2] < L['addr1'][2] + 30 and b[0] < 150], key=lambda b: b[0])
    L['addr2'] = [round(v, 2) for v in b2[0]]
    assert len({tuple(v) for v in L.values()}) == len(L), 'two fields on one blank'
    room = {}
    for k, (x0, x1, top) in L.items():
        nxt = [w['x0'] for w in words if w['x0'] > x1 - 1 and w['bottom'] > top - 13 and w['top'] < top + 1]
        room[k] = round(max(0, (min(nxt) if nxt else 588) - x1 - 6), 1)
    no_w, yes_w = word('No', (144, 447)), word('Yes', (171, 447))
    xb = sorted([b for b in blanks if abs(b[2] - no_w['bottom']) < 6], key=lambda b: b[0])
    xray = {'no': [round(v, 2) for v in [b for b in xb if b[0] >= no_w['x1'] - 1][0]], 'yes': [round(v, 2) for v in [b for b in xb if b[0] >= yes_w['x1'] - 1][0]]}
    def name_box(first, last, near):
        a = word(first, near); z = sorted([w for w in words if abs(w['top'] - a['top']) < 2 and w['x0'] >= a['x0'] and w['text'] == last], key=lambda w: w['x0'])[0]
        return [round(a['x0'], 2), round(min(a['top'], z['top']), 2), round(z['x1'], 2), round(max(a['bottom'], z['bottom']), 2)]
    docs = {'dolwick': ('M. Franklin Dolwick, DMD, PhD', name_box('M.', 'PhD,', (119, 185))), 'nessif': ('Richard J. Nessif, DDS', name_box('Richard', 'DDS', (279, 185))),
            'freburg': ('Danielle Freburg-Hoffmeister, DDS, MD', name_box('Danielle', 'MD', (442, 185))), 'buschman': ('Jason A. Buschman, DDS, MEd', name_box('Jason', 'MEd', (119, 204))),
            'patel': ('Anand R. Patel, DMD, MD', name_box('Anand', 'MD', (280, 204))), 'first': ('First Available', name_box('First', 'Available', (442, 204)))}
    docs = {k: {'name': n, 'box': b} for k, (n, b) in docs.items()}
    # the tooth chart is a picture: find its 52 boxes and place them on the page
    chart = max(pg.images, key=lambda im: (im['x1'] - im['x0']) * (im['bottom'] - im['top']))
    pw, ph = chart['srcsize']
    doc = pikepdf.open(pdf)
    x = doc.pages[0].Resources.XObject.get('/' + chart['name'].lstrip('/'))
    img = pikepdf.PdfImage(x).as_pil_image().convert('L') if x is not None else None
    assert img is not None and img.size == (pw, ph), 'tooth chart picture not found'
    a = np.array(img) < 140
    lab, _ = ndimage.label(a, structure=np.ones((3, 3)))
    found = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        lo, hi = round(0.0604 * ph), round(0.0793 * ph)          # the boxes are 16-21 px on UF's 265-px-tall chart; letters are narrower
        if lo <= h <= hi and lo <= w <= hi and (lab[sl] == i + 1)[h // 4:h - h // 4, w // 4:w - w // 4].mean() == 0:
            found.append((sl[0].start, sl[1].start, h, w))
    rows = []
    for y, xx, h, w in sorted(found):
        if rows and abs(rows[-1][0][1] - y) < 8: rows[-1].append((xx, y, w, h))
        else: rows.append([(xx, y, w, h)])
    rows = [sorted(r) for r in rows]
    assert [len(r) for r in rows] == [16, 16, 10, 10], 'tooth chart changed: ' + str([len(r) for r in rows])
    sx, sy = (chart['x1'] - chart['x0']) / pw, (chart['bottom'] - chart['top']) / ph
    labels = [[str(i) for i in range(1, 17)], [str(i) for i in range(32, 16, -1)], list('ABCDEFGHIJ'), list('TSRQPONMLK')]
    teeth = {t: [round(chart['x0'] + xx * sx, 2), round(chart['top'] + y * sy, 2), round(w * sx, 2), round(h * sy, 2)]
             for row, labs in zip(rows, labels) for (xx, y, w, h), t in zip(row, labs)}
    dn, do = word('"All":', (109, 365)), word('DO', (55, 365))
    return {'LINES': L, 'ROOM': room, 'XRAY': xray, 'DOCS': docs, 'TEETH': teeth,
            'LIST': [round(do['x0'], 2), round(dn['bottom'] + 13, 2), round(chart['x0'] - 6, 2), 4]}


tpl_path = tmp / 'uf-template.pdf'
info = template(SRC, tpl_path)
geo = geometry(tpl_path)
thumb = thumbnail(tpl_path)
j = lambda o: json.dumps(o, separators=(',', ':'))
new = {'UFR_LINES': j(geo['LINES']), 'UFR_ROOM': j(geo['ROOM']), 'UFR_TEETH': j(geo['TEETH']), 'UFR_DOCS': j(geo['DOCS']),
       'UFR_XRAY': j(geo['XRAY']), 'UFR_LIST': j(geo['LIST']), 'UFR_TPL_INFO': j(info),
       'UFR_TPL': "'" + base64.b64encode(tpl_path.read_bytes()).decode() + "'", 'UFR_THUMB': "'" + base64.b64encode(thumb).decode() + "'"}
s = SUITE.read_text(encoding='utf-8')
for name, value in new.items():
    pat = re.compile(r'^(  const ' + name + r' = )(.*?)(;(?:   //.*)?)$', re.M)
    m = pat.findall(s)
    assert len(m) == 1, name + ' found %d times' % len(m)
    s = pat.sub(lambda mm: mm.group(1) + value + mm.group(3), s, count=1)
if '--check' in sys.argv:
    print('up to date' if s == SUITE.read_text(encoding='utf-8') else 'CHANGED'); sys.exit(0)
SUITE.write_text(s, encoding='utf-8')
print('updated', SUITE.name, '- template', len(tpl_path.read_bytes()), 'bytes, preview', len(thumb), 'bytes')
