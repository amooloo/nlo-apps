#!/usr/bin/env python3
"""Lab Rx forms for NLO Cases: turns a lab's fillable Rx PDF into what the app needs.

    python3 tools/rxforms.py                      rebuild src/rxdata.js (and the previews) from rx/*-source.pdf
    python3 tools/rxforms.py herbst path/to.pdf   take in a new original of a form (slimmed into rx/), then rebuild
    python3 tools/rxforms.py retainer path/to.pdf
    python3 tools/rxforms.py metal path/to.pdf

The forms (Specialty Appliances):
  herbst    Herbst Appliance Rx (MKT-005, Rev 3-25; Amir, 3 Oct 2026)
  retainer  Retainer Rx (MKT-7, Rev 2-25; Amir, 4 Oct 2026: "here is the Rx for hawley. do the same")
  metal     Metal Rx (MKT-6, Rev 10-25; Amir, 4 Oct 2026: "Next lets use this") — expanders, distalizers, holding arches …

For each form it writes:
  rx/specialty-<form>-source.pdf  the form without Illustrator's private data (3.5 MB -> ~250 KB), kept so this can be re-run
  ../nlo-cases-rx-<form>.png      a grey picture of the blank first page for the on-screen paper preview (loaded only when needed)
and src/rxdata.js: each blank template (base64), where every blank, circle, tooth label and tooth outline is, and the three
standard fonts' character widths (for fitting text on the lines).

A template is the form with its fill-in fields taken out (their "REQUIRED", "s/", "mm/yy" placeholders would print), the first
page's drawing wrapped in q ... Q, three standard fonts added to that page, and an empty last content stream. The app writes the
filled-in Rx by appending a new version of that last stream (an incremental update), so the lab's own pages are untouched.
"""
import base64, io, json, math, os, pathlib, re, subprocess, sys, tempfile

import pikepdf, pdfplumber
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_JS = ROOT / 'src' / 'rxdata.js'


def r1(v): return round(float(v), 2)


# ---------- Herbst Appliance Rx: what each circle is called in the app -> the form's own field name ----------
BOX_H = {
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
# the blank lines: app name -> the form field whose underline it is
TEXT_H = {
    'doctor': 'Doctor', 'acct': 'Acct Numb', 'address': 'Address', 'city': 'City', 'state': 'State', 'zip': 'Zip',
    'phone': 'Phone', 'email': 'Email', 'patient': 'Patient Name', 'shipped': 'Date Shipped', 'needed': 'Date Needed',
    'scanOther': 'Other Scan Type Text', 'expOther': 'Other type of Expan', 'shimsMm': 'Adv. Shims MM', 'shimsQty': 'Adv. Shims qty',
    'mioMm': 'MIO Measurement mm', 'advMm': 'Advance BR mm', 'sig': 'Signature', 'license': 'License Number', 'licExp': 'Expiration',
}


def grid_herbst(words, H):
    """the tooth labels in the two grids (anchorage, occlusal rests): 4s to 7s"""
    lab = lambda s: {'7': '7', '6': '6', '5/e': '5', '4/d': '4', 'd/4': '4', 'e/5': '5'}.get(s)
    grid = {'anch': {}, 'occl': {}}
    for w in words:
        if w['x0'] < 415 or w['x1'] > 566: continue
        y = H - w['bottom']; n = lab(w['text'])
        if not n or not (205 < y < 320): continue
        which = 'anch' if y > 280 else 'occl'
        upper = y > (300 if which == 'anch' else 220)
        side = 'R' if w['x0'] < 492 else 'L'
        grid[which][('U' if upper else 'L') + side + n] = [r1(w['x0']), r1(H - w['bottom']), r1(w['x1']), r1(H - w['top'])]
    for which in grid:
        if len(grid[which]) != 16: raise SystemExit('grid %s: %d boxes' % (which, len(grid[which])))
    return grid


# ---------- Retainer Rx ----------
# the form names a few circles oddly ("Flat Bow Hawley" is the lower one; the two Super Modified Spring Hawley circles carry each
# other's U/L; the upper wire circles read as "022 Braided U" — the ".022" splits the name) — the app goes by where the circle is,
# so those are mapped by column (checked below)
BOX_R = {
    'rush': 'Approval to Charge Exp',
    'scan.itero': 'iTero', 'scan.carestream': 'Carestream', 'scan.3m': '3M', 'scan.medit': 'Medit', 'scan.trios': 'Trios', 'scan.sirona': 'Sirona', 'scan.other': 'Other',
    'palate.horseshoe': 'HorseShoe', 'palate.full': 'Full Palate',
    'd.hawley.U': 'Hawley U', 'd.hawley.L': 'Hawley L', 'd.flatHawley.U': 'Flat Bow Hawley U', 'd.flatHawley.L': 'Flat Bow Hawley',
    'd.wrap.U': 'Standard Wraparound U', 'd.wrap.L': 'Standard Wraparound L', 'd.flatWrap.U': 'Flatbow Wrap U', 'd.flatWrap.L': 'Flatbow Wrap L',
    'd.tremont.U': 'Tremont Wrap U', 'd.tremont.L': 'Tremont Wrap L', 'd.specWrap.U': 'Specialty Wrap U', 'd.specWrap.L': 'Specialty Wrap L',
    'd.bowSold.U': 'Labial Bow Soldered to Clasps U', 'd.bowSold.L': 'Labial Bow Soldered to Clasps L',
    'd.flatSold.U': 'Flatbow Soldered to Clasps U', 'd.flatSold.L': 'Flatbow Soldered to Clasps L',
    'd.clearbow.U': 'Clearbow Hawley U', 'd.clearbow.L': 'Clearbow Hawley L', 'd.flipper.U': 'Flipper (no Bow) U', 'd.flipper.L': 'Flipper (no Bow) L',
    'd.spring3.U': 'Spring Hawley 3x3 U', 'd.spring3.L': 'Spring Hawley 3x3 L', 'd.spring4.U': 'Spring Hawley 4x4 U', 'd.spring4.L': 'Spring Hawley 4x4 L',
    'd.springSM.U': 'Super Modified Spring Hawley L', 'd.springSM.L': 'Super Modified Spring Hawley U',
    'rh.none': 'Do Not Reset Teeth', 'rh.ideal': 'Reset Teeth Ideal', 'rh.compromise': 'Compromise Reset', 'noStrip': 'Do Not Strip Teeth',
    'cl.c.U': 'C Clasps U', 'cl.c.L': 'C Clasps L', 'cl.adams.U': 'Adams Clasps U', 'cl.adams.L': 'Adams Clasps L',
    'cl.ball.U': 'Ball Clasps U', 'cl.ball.L': 'Ball Clasps L', 'cl.solc.U': 'Soldered C Clasps U', 'cl.solc.L': 'Soldered C Clasps L',
    'acc.finger.U': 'Finger Spring U', 'acc.finger.L': 'Finger Spring L', 'acc.solder.U': 'Soldered Spring U', 'acc.solder.L': 'Soldered Spring L',
    'acc.closing.U': 'Closing Spring U', 'acc.closing.L': 'Closing Spring L', 'acc.spurs.U': 'Holding Spurs U', 'acc.spurs.L': 'Holding Spurs L',
    'acc.helical.U': 'Helical Bow U', 'acc.helical.L': 'Helical Bow L', 'acc.cuspHook.U': 'Soldered Cuspid Hook U', 'acc.cuspHook.L': 'Soldered Cuspid Hook L',
    'acc.habit.U': 'Habit U', 'acc.habit.L': 'Habit L', 'habit.crib': 'Habit Crib', 'habit.spurs': 'Habit Spurs', 'habit.bluegrass': 'Bluegrass',
    'acr.bowAcr.U': 'Add Acrylic to Bow U', 'acr.bowAcr.L': 'Add Acrylic to Bow L', 'acr.abp.U': 'Anterior Bite Plane U', 'acr.abp.L': 'Anterior Bite Plane L',
    'acr.pbp.U': 'Posterior Bite Plane U', 'acr.pbp.L': 'Posterior Bite Plane L', 'acr.scallop.U': 'Scallop Anteriors U', 'acr.scallop.L': 'Scallop Anteriors L',
    'acr.saddle.U': 'Acrylic Saddle U', 'acr.saddle.L': 'Acrylic Saddle L', 'acr.pontic.U': 'Pontic Shade U', 'acr.pontic.L': 'Pontic Shade L',
    'acr.color.U': 'Acrylic Color U', 'acr.color.L': 'Acrylic Color L',
    'flr.cc.U': 'Central - Central U', 'flr.cc.L': 'Central - Central L', 'flr.ll.U': 'Lateral - Lateral U', 'flr.ll.L': 'Lateral - Lateral L',
    'flr.c3.U': 'Cuspid - Cuspid U', 'flr.c3.L': 'Cuspid - Cuspid L',
    'pads.compEach.U': 'Composite Pads on Each Tooth U', 'pads.compEach.L': 'Composite Pads on Each Tooth L',
    'pads.compDist.U': 'Composite Pads on Most Teeth U', 'pads.compDist.L': 'Composite Pads on Most Teeth L',
    'pads.meshEach.U': 'Msh Pads on Each Teeth - U', 'pads.meshEach.L': 'Msh Pads on Each Teeth - L',
    'pads.meshDist.U': 'Mesh Pads on Distal Most Teeth U', 'pads.meshDist.L': 'Mesh Pads on Distal Most Teeth L',
    'wire.r028.U': 'Round .028 U', 'wire.r028.L': 'Round .028 L', 'wire.braided.U': '022 Braided U', 'wire.braided.L': '016 x .022 Braided L',
    'wire.solid.U': '022 Solid Stainless Steel U', 'wire.solid.L': '016 x .022 Solid Stainless Steel L',
    'ir.single.U': 'Single Invisible Retainer U', 'ir.single.L': 'Single Invisible Retainer L', 'ir.g2.U': 'Guardian 2 U', 'ir.g2.L': 'Guardian 2 L',
    'ir.g3.U': 'Guardian 3 U', 'ir.g3.L': 'Guardian 3 L', 'ir.g4.U': 'Guardian 4 U', 'ir.g4.L': 'Guardian 4 L', 'ir.express.U': 'IR Express U', 'ir.express.L': 'IR Express L',
}
# "Other Clasping Opt" is the name of two blanks: the clasping Other (first) and the scanner Other (second, "#2")
TEXT_R = {
    'doctor': 'DOCTOR', 'acct': 'ACCT', 'address': 'ADDRESS', 'city': 'CITY', 'state': 'STATE', 'zip': 'ZIP',
    'phone': 'Phone', 'email': 'EMAIL', 'patient': 'PATIENT NAME', 'shipped': 'DATE SHIPPED', 'needed': 'Date Needed',
    'scanOther': 'Other Clasping Opt#2', 'claspOther': 'Other Clasping Opt',
    'fingerTxt': 'Finger Spring Text', 'solderTxt': 'Soldered Spring Text', 'closingTxt': 'Closing Spring Text', 'spursTxt': 'Holding Spurs',
    'screwTxt': 'Space Closing Screw Text', 'saddleTxt': 'Acrylic Saddle Text', 'ponticTxt': 'Pontic Shade Text',
    'colorU': 'Acrylic Color U Text', 'colorL': 'Acrylic Color L Text',
    'sig': 'Signature', 'license': 'License Number', 'licExp': 'Expiration',
}


def grid_retainer(words, H):
    """the reset grid (R 3 2 1 | 1 2 3 L, upper row over lower): each number's own extent"""
    nums = [w for w in words if w['text'] in ('1', '2', '3') and 45 < w['x0'] < 170 and 580 < w['top'] < 612]
    rows = {}
    for w in nums: rows.setdefault(round(w['top']), []).append(w)
    if len(rows) != 2 or any(len(v) != 6 for v in rows.values()): raise SystemExit('reset grid: %r' % {k: len(v) for k, v in rows.items()})
    grid = {'reset': {}}
    for arch, top in zip('UL', sorted(rows)):
        for w, side_n in zip(sorted(rows[top], key=lambda w: w['x0']), ['R3', 'R2', 'R1', 'L1', 'L2', 'L3']):
            if w['text'] != side_n[1]: raise SystemExit('reset grid order: %s at %s' % (w['text'], side_n))
            grid['reset'][arch + side_n] = [r1(w['x0']), r1(H - w['bottom']), r1(w['x1']), r1(H - w['top'])]
    return grid


def check_retainer(boxes):
    """every U circle sits in its section's U column, every L circle in the L column"""
    for k, (x, y) in boxes.items():
        if not re.search(r'\.[UL]$', k): continue
        col = {'d': (162.4, 183.9), 'cl': (344.7, 367.0), 'acc': (344.7, 367.0), 'acr': (344.7, 367.0)}.get(k.split('.')[0], (551.5, 573.0))
        want = col[0] if k.endswith('.U') else col[1]
        if abs(x - want) > 1.5: raise SystemExit('%s is at x=%s, not in its %s column (%s)' % (k, x, k[-1], want))


# ---------- Metal Rx ----------
# (several field names carry a trailing "." or an odd word — "Transpalatal Arch Lower." is the TPA, "Screw Tyoe" the screw blank;
# find_field matches them loosely)
BOX_M = {
    'rush': 'Charge Expidited Shipping',
    'scan.itero': 'iTero', 'scan.carestream': 'Carestream', 'scan.cerec': 'CEREC', 'scan.trios': 'TRIOS', 'scan.medit': 'Medit', 'scan.other': 'Other Scan Type',
    'exp.hyrax': 'Hyrax RPE', 'exp.haas': 'Haas RPE', 'exp.acrylic': 'Acrylic Bonded', 'exp.deluke': 'DeLuke', 'exp.exspider': 'Exspider', 'exp.lowerFixed': 'Lower Fixed',
    'exp.qh': 'Quad Helix', 'exp.earch': 'E-Arch', 'exp.warch': 'W-Arch',
    'dist.pendulum.R': 'Pendulum Right', 'dist.pendulum.L': 'Pendulum Left', 'dist.pendex.R': 'Pendex Right', 'dist.pendex.L': 'Pendex Left',
    'dist.trex.R': 'T Rex Right', 'dist.trex.L': 'T Rex Left', 'dist.phd.R': 'PHD Right', 'dist.phd.L': 'PHD Left', 'dist.mda.R': 'MDA Right', 'dist.mda.L': 'MDA Left',
    'dist.rmd.R': 'RMD Right', 'dist.rmd.L': 'RMD Left', 'dist.hsjet.R': 'HorseShoe Jet Right', 'dist.hsjet.L': 'Horseshoe Jet Left',
    'dist.djet.R': 'Distal Jet Right', 'dist.djet.L': 'Distal Jet Left', 'dist.halterman.R': 'Halterman Right', 'dist.halterman.L': 'Halterman Left',
    'dist.ipc.R': 'IPC Right', 'dist.ipc.L': 'IPC Left',
    'hold.tpa': 'Transpalatal Arch Lower', 'hold.lla': 'Lingual Arch Lower', 'hold.nance': 'Nance', 'hold.sm': 'Space Maintainer',
    'other.habit': 'Habit', 'habit.crib': 'Crib', 'habit.spurs': 'Spurs', 'habit.bluegrass': 'Blue Grass',
    'other.fbp': 'Fixed Bite Plane', 'other.xbow': 'Xbow', 'other.tandem': 'Tandem',
    'acc.awt': 'Archwire Tubes', 'awt.U': 'AT Upper', 'awt.L': 'AT lower', 'acc.hg': 'Headgear Tubes', 'acc.lb': 'Lip Bumper', 'acc.sheath': 'Lingual Sheaths',
    'acc.fm': 'Facemasks Hooks', 'acc.debondHoles': 'Debonding Holes', 'acc.vent': 'Vent Holes', 'acc.roc': 'ROC acc', 'acc.debondWires': 'Debonding Wires', 'acc.color': 'Acrylic Color',
    'provides': 'SA provides and fits', 'anch.band': 'Bands', 'anch.roc': 'ROCs anch', 'anch.crown': 'Crowns anch', 'anch.onbrace': 'OnBrace Anch',
    'enclosed': 'Bands or Crowns enclosed', 'printed3d': '3D Printed/Sintered option',
}
TEXT_M = {
    'doctor': 'Doctor', 'acct': 'Acct Numb', 'address': 'Address', 'city': 'City', 'state': 'State', 'zip': 'Zip',
    'phone': 'Phone', 'email': 'Email', 'patient': 'Patient Name', 'shipped': 'Date Shipped', 'needed': 'Date Needed',
    'scanOther': 'Other Scan Type Text', 'screw': 'Screw Tyoe', 'smTxt': 'Space Maintainer Text', 'fmTxt': 'Facemask Hooks', 'colorTxt': 'Acrylic color Text',
    'sig': 'Signature', 'license': 'License Number', 'licExp': 'Expiration',
}


def grid_metal(words, H):
    """the two tooth grids (anchorage, occlusal rests), 4s to 7s, as on the Herbst Rx but lower on the page"""
    lab = lambda s: {'7': '7', '6': '6', '5/e': '5', '4/d': '4', 'd/4': '4', 'e/5': '5'}.get(s)
    grid = {'anch': {}, 'occl': {}}
    for w in words:
        if w['x0'] < 415 or w['x1'] > 566: continue
        y = H - w['bottom']; n = lab(w['text'])
        if not n or not (225 < y < 335): continue
        which = 'anch' if y > 280 else 'occl'
        upper = y > (312 if which == 'anch' else 240)
        side = 'R' if w['x0'] < 490 else 'L'
        grid[which][('U' if upper else 'L') + side + n] = [r1(w['x0']), r1(H - w['bottom']), r1(w['x1']), r1(H - w['top'])]
    for which in grid:
        if len(grid[which]) != 16: raise SystemExit('grid %s: %d boxes' % (which, len(grid[which])))
    return grid


def check_metal(boxes):
    """each distalizer's Right circle is in the RIGHT column, its Left in the LEFT column"""
    for k, (x, y) in boxes.items():
        if k.startswith('dist.'):
            want = 164.1 if k.endswith('.R') else 187.6
            if abs(x - want) > 1.5: raise SystemExit('%s is at x=%s, not in its column (%s)' % (k, x, want))


FORMS = {
    'herbst': {
        'id': 'specialty-herbst', 'title': 'Herbst Appliance Rx', 'lab': 'Specialty Appliances', 'rev': 'MKT-005, Rev 3-25',
        'src': 'specialty-herbst-source.pdf', 'png': 'nlo-cases-rx-herbst.png', 'box': BOX_H, 'text': TEXT_H, 'grid': grid_herbst,
        # the arch diagram: where its outlines are (PDF y window) and the top-down y that splits upper | front upper | front lower | lower
        'arch_y': (400, 660), 'split': (792 - 548, 792 - 530, 792 - 505),
        'clip': [423, 140, 140, 236], 'vb': [408, 140, 166, 236],
    },
    'retainer': {
        'id': 'specialty-retainer', 'title': 'Retainer Rx', 'lab': 'Specialty Appliances', 'rev': 'MKT-7, Rev 2-25',
        'src': 'specialty-retainer-source.pdf', 'png': 'nlo-cases-rx-retainer.png', 'box': BOX_R, 'text': TEXT_R, 'grid': grid_retainer,
        'check': check_retainer, 'arch_y': (420, 660), 'split': (236, 258, 276),
        'clip': [414, 141, 164, 218], 'vb': [411, 141, 170, 218],
    },
    'metal': {
        'id': 'specialty-metal', 'title': 'Metal Rx', 'lab': 'Specialty Appliances', 'rev': 'MKT-6, Rev 10-25',
        'src': 'specialty-metal-source.pdf', 'png': 'nlo-cases-rx-metal.png', 'box': BOX_M, 'text': TEXT_M, 'grid': grid_metal,
        'check': check_metal, 'arch_y': (400, 640), 'split': (257, 279, 298), 'rl_y': (500, 512),
        'clip': [419, 152, 146, 240], 'vb': [410, 150, 162, 244],
    },
}


def slim_source(path, dest):
    """the original minus Illustrator's private data (fields kept, so the positions can be read again)"""
    pdf = pikepdf.open(path)
    for k in ['/Metadata']:
        if k in pdf.Root: del pdf.Root[k]
    for pg in pdf.pages:
        for k in ['/PieceInfo', '/LastModified', '/Metadata']:
            if k in pg.obj: del pg.obj[k]
    if '/Info' in pdf.trailer: del pdf.trailer['/Info']
    pdf.remove_unreferenced_resources()
    dest.parent.mkdir(exist_ok=True)
    pdf.save(dest, object_stream_mode=pikepdf.ObjectStreamMode.disable, compress_streams=True, recompress_flate=True)


def read_fields(path):
    """widgets by name (a name used twice: the second is "name#2"): their type and rectangle"""
    pdf = pikepdf.open(path)
    out = {}
    for a in pdf.pages[0].obj.Annots:
        par = a.get('/Parent')
        name = str(a.get('/T', '')) or ''
        pname = str(par.get('/T', '')) if par is not None else ''
        ft = str(a.get('/FT', '') or (par.get('/FT', '') if par is not None else ''))
        full = (pname + '.' + name).strip('.') if pname and name else (name or pname)
        key, n = full, 1
        while key in out: n += 1; key = full + '#' + str(n)
        x0, y0, x1, y1 = [float(v) for v in a.Rect]
        out[key] = {'ft': ft, 'rect': [r1(x0), r1(y0), r1(x1), r1(y1)]}
    return out


def find_field(fields, want):
    if want in fields: return fields[want]
    # child widgets ('018' under 'AW tubes ', '.018' variants): match loosely
    norm = lambda s: re.sub(r'[^a-z0-9#]', '', s.lower())
    hits = [k for k in fields if norm(k) == norm(want)]
    if len(hits) == 1: return fields[hits[0]]
    raise SystemExit('field not found: %r (close: %r)' % (want, [k for k in fields if norm(want)[:6] in norm(k)]))


def build(cfg):
    src = str(ROOT / 'rx' / cfg['src'])
    fields = read_fields(src)
    pl = pdfplumber.open(src); page = pl.pages[0]; H = float(page.height)
    # underlines: (x0, x1, y) in PDF coordinates
    lines = []
    for l in page.lines:
        if (l['x1'] - l['x0']) > 15 and abs(l['top'] - l['bottom']) < 0.5:
            lines.append((r1(l['x0']), r1(l['x1']), r1(H - l['bottom'])))
    boxes = {}
    for k, nm in cfg['box'].items():
        x0, y0, x1, y1 = find_field(fields, nm)['rect']
        boxes[k] = [r1((x0 + x1) / 2), r1((y0 + y1) / 2)]
    if cfg.get('check'): cfg['check'](boxes)
    text = {}
    for k, nm in cfg['text'].items():
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
    words = page.extract_words()
    grid = cfg['grid'](words, H)
    # the arch diagram: 40 tooth outlines (28 occlusal + the 12 front views in the middle), top-down coordinates
    ya, yb = cfg['arch_y']
    curves = [c for c in page.curves if c['x0'] > 415 and c['x1'] < 575 and (H - c['bottom']) > ya and (H - c['top']) < yb]
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
    s1, s2, s3 = cfg['split']
    up = [t for t in T if t['c'][1] < s1]            # occlusal upper arch (top of the diagram, incisors at the top)
    fu = [t for t in T if s1 <= t['c'][1] < s2]      # upper front teeth (middle row)
    fl = [t for t in T if s2 <= t['c'][1] < s3]      # lower front teeth
    lo = [t for t in T if t['c'][1] >= s3]           # occlusal lower arch (incisors at the bottom)
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
        ry0, ry1 = cfg.get('rl_y', (515, 535))
        if w['text'] in ('R', 'L') and ry0 < y < ry1 and w['x0'] > 400: rl[w['text']] = [r1(w['x0']), r1(w['top']), r1(w['x1']), r1(w['bottom'])]
    if set(rl) != {'R', 'L'}: raise SystemExit('R / L labels: %r' % rl)

    # ---------- the template ----------
    pdf = pikepdf.open(src)
    for k in ['/AcroForm', '/Metadata', '/Names', '/OpenAction', '/AA', '/Outlines', '/PageMode']:
        if k in pdf.Root: del pdf.Root[k]
    for p in pdf.pages:
        for k in ['/Annots', '/PieceInfo', '/LastModified', '/Metadata', '/AA']:
            if k in p.obj: del p.obj[k]
    if '/Info' in pdf.trailer: del pdf.trailer['/Info']
    pg = pdf.pages[0]
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
    print(cfg['id'], 'template', len(data), 'bytes; pages', len(chk.pages), '; overlay object', ov_num, 'startxref', sx, 'size', size, 'root', root)

    # ---------- the on-screen paper (grey, 8 shades, 2x for sharp screens; the first page) ----------
    png = ROOT.parent / cfg['png']
    with tempfile.TemporaryDirectory() as td:
        p = pathlib.Path(td) / 't.pdf'; p.write_bytes(data)
        subprocess.run(['pdftoppm', '-r', '144', '-gray', '-png', '-singlefile', str(p), str(pathlib.Path(td) / 'pv')], check=True)
        im = Image.open(pathlib.Path(td) / 'pv.png').convert('L')
        im.quantize(colors=8, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(png, optimize=True)
    print(cfg['id'], 'preview', png.name, os.path.getsize(png), 'bytes')

    return {
        'id': cfg['id'], 'title': cfg['title'], 'lab': cfg['lab'], 'rev': cfg['rev'],
        'pdf': {'b64': base64.b64encode(data).decode(), 'obj': ov_num, 'xref': sx, 'size': size, 'root': root,
                'id': (pid.group(1) + pid.group(2)) if pid else ''},
        'preview': png.name, 'boxes': boxes, 'text': text, 'notes': notes[:3], 'grid': grid,
        'teeth': teeth, 'front': front, 'rl': rl, 'clip': cfg['clip'], 'vb': cfg['vb'],
    }


def main():
    if len(sys.argv) > 2:
        which = sys.argv[1]
        if which not in FORMS: raise SystemExit('which form? ' + ', '.join(FORMS))
        dest = ROOT / 'rx' / FORMS[which]['src']
        slim_source(sys.argv[2], dest); print('slimmed source ->', dest, os.path.getsize(dest), 'bytes')
    forms = [build(cfg) for cfg in FORMS.values()]

    # ---------- the standard fonts' widths (WinAnsi, codes 32..255; 0 = no character) ----------
    from reportlab.pdfbase.pdfmetrics import stringWidth
    def widths(font):
        out = []
        for code in range(32, 256):
            try: ch = bytes([code]).decode('cp1252')
            except UnicodeDecodeError: out.append(0); continue
            out.append(int(round(stringWidth(ch, font, 1000))))
        return out

    js = ('/* generated by tools/rxforms.py from Specialty Appliances\' Herbst Rx (MKT-005, Rev 3-25), Retainer Rx (MKT-7, Rev 2-25) and\n'
          '   Metal Rx (MKT-6, Rev 10-25) — do not edit by hand. Each blank form (fields taken out), where everything on it is (PDF\n'
          '   points; the arch outlines top-down), and the standard fonts\' widths for fitting text on the lines. */\n'
          'const RX_FORMS = {\n' + ',\n'.join('  \'' + f['id'] + '\': ' + json.dumps(f, separators=(',', ':')) for f in forms) + '\n};\n'
          'const RX_FONT_W = ' + json.dumps({'H': widths('Helvetica'), 'B': widths('Helvetica-Bold'), 'T': widths('Times-Italic')}, separators=(',', ':')) + ';\n')
    OUT_JS.write_text(js)
    print('wrote', OUT_JS.name, len(js), 'chars')


if __name__ == '__main__':
    main()
