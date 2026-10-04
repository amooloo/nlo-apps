/* =====================================================================
   Lab Rx — Specialty Appliances' Functional Rx (MKT-12, 10-23), filled in from the case: Dr. A's lower Schwarz
   Amir, 4 Oct 2026: the Schwarz goes to Specialty ("they still say partner dental solutions" — asked which lab: Specialty, on their
   Functional Rx, the form with "Schwarz – Transverse" and Arrow clasps), filled in the way we worked out for a Phase I Schwarz worn
   full-time for several months on teeth without much undercut (his Lab Rx page): delta clasps on the lower 6s (Preferred), ball
   clasps at the D–E contacts (Recommended), a midline screw, a lingual horseshoe, no labial bow, no occlusal acrylic (Specialty's
   Schwarz comes with it unless the Rx says otherwise), and the chairside steps before the scan (composite bumps on the 6s first).
   - Like the Herbst and Retainer Rx (rx.js, rxret.js): every part of the form is a tap; clasps and pontics also go on the teeth;
     the appliance draws itself on Specialty's arch diagram; the result is Specialty's own form as a PDF.
   - The form has no circle for a delta clasp: it's written out with its teeth in the special instructions, with where the ball and
     arrow clasps go (in the mixed dentition the primary canines and molars are lettered: the lower D–E contacts are S–T and K–L).
   - Specialty's Schwarz takes their standard colors only (their Schwarz page): the others are greyed out.
   - Prices: clasps, pontics, the bite plane, acrylic to the bow and colors as the Retainer Rx has them (Specialty's custom design
     options); the Schwarz and the other functional appliances aren't on the price list here, so they're named under the estimate
     until Dr. A enters a price (Team & security → Lab Rx).
   ===================================================================== */
const RXFF = RX_FORMS[RX_FUN];
/* the appliances that go on this form (with the lab set to Specialty) */
const RXF_APPL = ['Schwartz'];
const RXF_ARCH = ['U', 'L'];
/* the form's choices, in its order and words */
const RXF_O = {
  act: [['sag', 'Sagittal'], ['sag22', 'Sagittal to Advance Anterior 2-2'], ['sag3', '3-Way Sagittal'], ['schwarz', 'Schwarz – Transverse']],
  actU: [['nord', 'Nord Expander'], ['phase2', 'Phase II Appliance'], ['fan', 'Fan Expander'], ['acco', 'Acco – Cetlin']],
  exp: [['none', 'No Screws Required'], ['mid', 'Midline Screw Only'], ['mid2', '2 Midline Screws'], ['sag2', '2 Sagittal Screws'], ['fan', 'Fan Expansion Screw'], ['other', 'Other Screw Design']],
  clasp: [['delta', 'Delta Clasps'], ['ball', 'Ball Clasps'], ['adams', 'Adams Clasps'], ['arrowhead', 'Arrow Clasps'], ['c', 'C-Clasps']],
  xs: [['carve', 'Carve Brackets off Models'], ['pads', 'Labial Pads'], ['hg', 'HG Tubes .045']],
  ac: [['trimPost', 'Trim Posterior for Maximum Eruption'], ['trimDiag', 'Trim as Diagrammed'], ['occl', 'Occlusal Coverage'], ['abp', 'Anterior Bite Plane'], ['bowAcr', 'Acrylic to Bow']],
  fn: [['bionator', 'Bionator'], ['corrector', 'Corrector'], ['tbClark', 'Twin Block – Clark'], ['tbMcN', 'Twin Block – McNamara']],
  ad: [['open', 'Open the Bite'], ['close', 'Close the Bite'], ['maintain', 'Maintain the Bite']],
  dent: [['mixed', 'Mixed dentition'], ['perm', 'Permanent']]
};
const RXF_K = o => RXF_O[o].map(x => x[0]);
function rxfLbl(v, lists) { for (const o of lists || Object.keys(RXF_O)) { const x = RXF_O[o].find(y => y[0] === v); if (x) return x[1]; } return v; }
const RXF_SINGLE = ['fn', 'adU', 'adL', 'actU', 'actL', 'exp', 'dent'];
/* on the teeth: the clasps and pontics; the form's circle for each clasp (a delta clasp has none: it's written out) */
const RXF_CLASPS = RXF_K('clasp');
const RXF_TOOTH = RXF_CLASPS.concat(['pontic']);
const RXF_CIRCLE = { adams: 'adams', ball: 'ball', arrowhead: 'arrow', c: 'c' };
const RXF_TOOTH_L = { delta: 'Delta clasp', ball: 'Ball clasp (behind it)', adams: 'Adams clasp', arrowhead: 'Arrow clasp', c: 'C-clasp', pontic: 'Pontic' };
const RXF_TEETH = Object.keys(RXFF.teeth);
/* the primary teeth's letters (Universal) in the mixed dentition: canines and molars (C, D, E); incisors and 6s, 7s keep their numbers */
const RXF_PRIM = { UR5: 'A', UR4: 'B', UR3: 'C', UL3: 'H', UL4: 'I', UL5: 'J', LL5: 'K', LL4: 'L', LL3: 'M', LR3: 'R', LR4: 'S', LR5: 'T' };
const rxfNum = (id, rx) => rx.dent !== 'perm' && RXF_PRIM[id] ? RXF_PRIM[id] : rxrNum(id);
const rxfType = (id, rx) => rx.dent !== 'perm' && RXF_PRIM[id] ? ({ 3: 'C', 4: 'D', 5: 'E' })[id[2]] : id[2]; // the kind of tooth: C, D, E, 6 …
/* a ball clasp tapped on a tooth sits in the gap behind it: "S–T" (in Universal order) and the kind of contact, "D–E" (front to back) */
function rxfGap(id, rx) { const b = rxrNext(id, -1); if (!b) return [rxfNum(id, rx) + ' (distal)', '']; const two = [rxfNum(id, rx), rxfNum(b, rx)].sort((x, y) => rxrUni(x) - rxrUni(y));
  return [two.join('–'), rxfType(id, rx) + '–' + rxfType(b, rx)]; }
const rxfGapName = (id, rx) => { const [g, k] = rxfGap(id, rx); return g + (k && rx.dent !== 'perm' ? ' (' + k + ')' : ''); };
/* the teeth in Universal order */
const rxfSort = (ids, rx) => ids.slice().sort((a, b) => rxrUni(rxfNum(a, rx)) - rxrUni(rxfNum(b, rx)));
/* Dr. A's take on each clasp for a Schwarz (Amir, 4 Oct 2026, his Lab Rx: a Phase I Schwarz, few undercuts, worn full-time) */
const RXF_GUIDE = {
  delta: ['pref', 'Closed loops keep their grip through months of full-time wear on shallow undercuts.'],
  ball: ['rec', 'Uses the D–E contact, which is reliable in the mixed dentition.'],
  adams: ['alt', 'Works, but the arrowheads open and fatigue with repeated insertion.'],
  arrowhead: ['alt', 'Grips interdental undercuts, but can irritate papillae and open contacts.'],
  c: ['avoid', 'Needs a buccal cervical undercut these short crowns don’t have.']
};
const rxfSchwarz = rx => RXF_ARCH.some(A => rx['act' + A] === 'schwarz');
/* Dr. A's notes for the lab on a new Schwarz (his Lab Rx), as typed special instructions to change as needed */
const RXF_NOTES0 = 'Full-time wear for several months. Lingual horseshoe adapted into the lingual embrasures; block out only what insertion needs. No labial bow.';

const RXF_SRC = {
  schwarz: ['Specialty: The Schwarz', 'https://specialtyappliances.com/product/the-schwarz/'],
  rx: ['Specialty: Rx sheets (Functional Rx)', 'https://specialtyappliances.com/rx-sheets/']
};
const RXF_USUAL = 'Specialty’s site doesn’t describe it; this is the usual meaning.';
const RXF_INFO = {
  act: {
    schwarz: { name: 'Schwarz – Transverse', svg: typeof RX_SCHWARZ_PIC !== 'undefined' ? RX_SCHWARZ_PIC : '',
      short: 'A removable plate that widens the arch with a midline screw: Dr. A’s lower Schwarz for Phase I.',
      sum: 'Specialty’s Schwarz: a removable appliance for transverse expansion, upper or lower, with one midline screw (7–12 mm of activation) as standard — two where the upper has room — with or without occlusal acrylic.',
      pts: ['Specialty’s standard clasps: upper a pair of ball clasps and a pair of Adams; lower two pairs of ball clasps (fully customizable).',
        'Specialty’s standard colors only, no custom designs; standard with occlusal acrylic (left off, the special instructions say no occlusal acrylic).',
        'Dr. A’s lower Schwarz (picture): delta clasps on the 6s, ball clasps at the D–E contacts, the midline screw, a lingual horseshoe and no occlusal acrylic.'],
      src: ['schwarz'] },
    sag: { short: 'Screws set front to back: the plate lengthens the arch.', sum: 'An expansion plate whose screws open front to back (sagittally), to move front teeth forward or back teeth back.', note: RXF_USUAL },
    sag22: { name: 'Sagittal to advance anterior 2-2', short: 'A sagittal plate that brings the four incisors forward.', sum: 'A sagittal plate whose front section carries the incisors (2–2) forward.', note: RXF_USUAL },
    sag3: { name: '3-Way Sagittal', short: 'Expands across and lengthens at once (three sections).', sum: 'A three-way plate: screws widen the arch and open it front to back at the same time.', note: RXF_USUAL },
    nord: { short: 'An upper expansion plate (upper only on the form).', sum: 'An upper removable expansion plate; the form has it for the upper only.', note: RXF_USUAL },
    phase2: { name: 'Phase II appliance', short: 'Upper only on the form.', sum: 'Specialty’s form lists a Phase II appliance for the upper.', note: 'Specialty’s site doesn’t describe it.' },
    fan: { short: 'Widens the front of the arch more than the back, around a hinge.', sum: 'An upper fan expander: the screw sits forward and a hinge at the back, so the front of the arch opens more than the back.', note: RXF_USUAL },
    acco: { name: 'Acco – Cetlin', short: 'An upper acrylic appliance that moves molars back (Cetlin), worn with headgear.', sum: 'ACCO (acrylic cervical occipital): an upper removable appliance used to distalize molars, as in Cetlin’s technique.', note: RXF_USUAL }
  },
  clasp: {
    delta: RXC_INFO.delta, ball: RXR_INFO.clasp.ball, adams: RXR_INFO.clasp.adams,
    arrowhead: Object.assign({}, RXC_INFO.arrowhead, { name: 'Arrow (arrowhead) clasp' }), c: RXR_INFO.clasp.c
  },
  ac: {
    trimPost: { name: 'Trim posterior for maximum eruption', short: 'Acrylic trimmed off the back teeth so they can erupt.', sum: 'The acrylic is kept off the back teeth so they can come up (e.g. to level the bite).', note: RXF_USUAL },
    trimDiag: { name: 'Trim as diagrammed', short: 'Trim the acrylic where it’s drawn on the arches.', sum: 'The acrylic is trimmed as drawn on the arch diagram (use the pen).' },
    occl: { name: 'Occlusal coverage', short: 'Acrylic over the biting surfaces of the back teeth (standard on Specialty’s Schwarz).',
      sum: 'The acrylic covers the biting surfaces of the back teeth, which frees the bite while the arch widens.',
      pts: ['Specialty’s Schwarz comes with occlusal acrylic as standard, or without it on request (their page). Dr. A’s lower Schwarz goes without: left off, the special instructions say so.'], src: ['schwarz'] },
    abp: RXR_INFO.acr.abp, bowAcr: RXR_INFO.acr.bowAcr,
    color: { name: 'Acrylic color', short: 'Specialty’s standard colors only for the Schwarz.', sum: 'The plate’s color — the case’s color until another is tapped.',
      pts: ['Specialty’s Schwarz: “only the Specialty Appliances standard colors may be selected. No custom designs.”'], src: ['schwarz'] }
  },
  fn: {
    bionator: { short: 'A one-piece functional that holds the lower jaw forward.', sum: 'Balters’ bionator: a loose-fitting one-piece appliance that postures the mandible forward.', note: RXF_USUAL },
    corrector: { short: 'Specialty’s form lists it with the functionals.', sum: 'A functional corrector, as listed on Specialty’s form.', note: 'Specialty’s site doesn’t describe it.' },
    tbClark: { name: 'Twin Block – Clark', short: 'Clark’s two plates with bite blocks that meet on an incline and hold the jaw forward.', sum: 'Clark’s Twin Block: upper and lower plates with bite blocks whose inclined planes hold the mandible forward.', note: RXF_USUAL },
    tbMcN: { name: 'Twin Block – McNamara', short: 'The Twin Block in McNamara’s design.', sum: 'A Twin Block made to McNamara’s design, as listed on Specialty’s form.', note: 'Specialty’s site doesn’t describe it.' }
  }
};

/* ---------- prices: what the Retainer Rx has from Specialty's list (clasps, pontics, bite plane, acrylic to the bow, colors); the rest
   isn't on it here: named under the estimate until Dr. A enters a price ---------- */
const RXF_PRICES = [
  ['schwarz', 'Schwarz – Transverse, per arch', null], ['funAct', 'Sagittal, 3-Way, Nord, Fan, Phase II or Acco appliance, per arch', null],
  ['fun', 'Bionator, Corrector or Twin Block', null], ['funScrew', 'A second or other screw design', null], ['funBow', 'Hawley labial bow on a functional', null],
  ['funXs', 'Carve brackets off models, labial pads or HG tubes', null]
];
rxAddPrices(RXF_PRICES);

/* ---------- the Rx: one way to save it ---------- */
/* the arches with an appliance (a functional is on both) */
const rxfArches = rx => RXF_ARCH.filter(A => rx.fn || rx['act' + A] || rx['ad' + A] || (rx['wc' + A] || []).length || (rx['ac' + A] || []).length || Object.keys(rx.teeth || {}).some(id => id[0] === A));
function rxfColor(c, rx, A) { return rx['color' + A] || (rxfArches(rx).includes(A) ? rxrCaseColor(c) : ''); }
function rxfCanon(rx) {
  const o = { form: RX_FUN }, { one, list, flag } = rxCanonKit(rx, o);
  one('fn', RXF_K('fn'));
  RXF_ARCH.forEach(A => { one('ad' + A, RXF_K('ad')); one('act' + A, A === 'U' ? RXF_K('act').concat(RXF_K('actU')) : RXF_K('act')); });
  one('exp', RXF_K('exp')); if (o.exp === 'other') one('screwOther', null, 40);
  RXF_ARCH.forEach(A => list('wc' + A, ['bow']));
  const t = {}; RXF_TEETH.forEach(id => { const v = (rx.teeth || {})[id]; if (RXF_TOOTH.includes(v)) t[id] = v; }); if (Object.keys(t).length) o.teeth = t;
  RXF_ARCH.forEach(A => { list('xs' + A, A === 'U' ? RXF_K('xs') : ['carve', 'pads']); list('ac' + A, RXF_K('ac')); });
  RXF_ARCH.forEach(A => one('color' + A, null, 40));
  if (Object.values(t).includes('pontic')) one('ponticTxt', null, 20);
  one('dent', RXF_K('dent'));
  list('chk', ['bumps', 'contacts', 'scan']);
  flag('rush');
  rxCanonTail(rx, o, RXFF);
  return o;
}
/* "Schwarz – Transverse (lower) · Midline Screw Only · 2 delta, 2 ball clasps" */
function rxfSummary(rx) {
  const parts = [], t = rx.teeth || {};
  if (rx.fn) parts.push(rxfLbl(rx.fn, ['fn']));
  const u = rx.actU, l = rx.actL; if (u && u === l) parts.push(rxfLbl(u) + ' (U & L)'); else { if (u) parts.push(rxfLbl(u) + ' (upper)'); if (l) parts.push(rxfLbl(l) + ' (lower)'); }
  if (rx.exp && rx.exp !== 'none') parts.push(rx.exp === 'other' && rx.screwOther ? rx.screwOther : rxfLbl(rx.exp, ['exp']));
  const n = k => Object.values(t).filter(v => v === k).length, cl = RXF_CLASPS.filter(k => n(k)).map(k => n(k) + ' ' + ({ delta: 'delta', ball: 'ball', adams: 'Adams', arrowhead: 'arrow', c: 'C' })[k]);
  if (cl.length) parts.push(cl.join(', ') + ' clasps');
  if (n('pontic')) parts.push(n('pontic') + ' pontic' + (n('pontic') > 1 ? 's' : ''));
  return parts.join(' · ') || 'Nothing picked yet';
}
function rxfEstimate(rx, c) {
  const E = rxEst(), add = E.add, inc = E.inc, t = rx.teeth || {}, W = rxrArchWord;
  if (rx.fn) add(rxfLbl(rx.fn, ['fn']), 'fun');
  const acts = {}; RXF_ARCH.forEach(A => { const a = rx['act' + A]; if (a) (acts[a] = acts[a] || []).push(A); });
  Object.keys(acts).forEach(a => { const n = acts[a].length; add(rxfLbl(a) + ' · ' + (n === 2 ? 'upper & lower' : W(acts[a][0])), a === 'schwarz' ? 'schwarz' : 'funAct', n); });
  // screws: the Schwarz comes with its midline screw
  if (rx.exp === 'mid') inc('Midline screw', 'With the appliance');
  else if (rx.exp && rx.exp !== 'none') add(rx.exp === 'other' && rx.screwOther ? 'Screw: ' + rx.screwOther : rxfLbl(rx.exp, ['exp']), 'funScrew');
  // clasps by the pair; the Schwarz's standard ones come with it (Specialty: lower two pairs of ball clasps; upper a pair of ball and a pair of Adams)
  RXF_ARCH.forEach(A => { const w = W(A), cnt = k => Object.keys(t).filter(id => id[0] === A && t[id] === k).length, pr = x => Math.ceil(x / 2);
    const std = rx['act' + A] === 'schwarz' ? (A === 'L' ? { ball: 2 } : { ball: 1, adams: 1 }) : {};
    [['delta', 'Delta clasps', 'delta'], ['ball', 'Ball clasps', 'clasp'], ['adams', 'Adams clasps', 'adams'], ['arrowhead', 'Arrow clasps', 'clasp'], ['c', 'C-clasps', 'clasp']].forEach(([k, l, pk]) => {
      let n = pr(cnt(k)); if (!n) return; const incl = Math.min(n, std[k] || 0);
      if (incl) inc(l + ' · ' + w + ' × ' + incl + ' pr', 'With the Schwarz (Specialty’s standard clasps)');
      n -= incl; if (n) add(l + ' · ' + w + ' × ' + n + ' pr', pk, n); });
    if ((rx['wc' + A] || []).includes('bow')) add('Hawley labial bow · ' + w, 'funBow');
    const ac = rx['ac' + A] || [];
    if (ac.includes('occl')) { if (rx['act' + A] === 'schwarz') inc('Occlusal acrylic · ' + w, 'Standard on the Schwarz'); }
    if (ac.includes('abp')) add('Anterior bite plane · ' + w, 'abp');
    if (ac.includes('bowAcr')) add('Acrylic to labial bow · ' + w, 'acrBow');
    if ((rx['xs' + A] || []).length) add((rx['xs' + A] || []).map(k => rxfLbl(k, ['xs'])).join(', ') + ' · ' + w, 'funXs');
    const p = cnt('pontic'); if (p) add('Pontic' + (p > 1 ? 's' : '') + ' · ' + w + ' × ' + p, 'pontic', p);
    const col = rxfColor(c, rx, A); if (col) rxAcrCost(col, w, add, inc);
  });
  if (rx.rush) add('Expedited manufacturing and shipping', 'rush', 1, 'Specialty’s fee for under 10 business days');
  return E.done();
}

/* ---------- the arch diagram: the appliance drawn from the choices (RXG = this form while rxAuto draws) ---------- */
function rxfAuto(rx, c) {
  const out = [], teeth = rx.teeth || {}, S2 = ['R', 'L'];
  const stroke = (d, w, col, dash) => out.push(Object.assign({ d, s: col || RX_METAL, w }, dash ? { dash } : {}));
  const fill = (d, col, s, w) => out.push({ d, f: col, s: s || '', w: w || 0 });
  const wire = (pts, w) => stroke(RXP.smooth(pts), w || 1.1);
  const arches = rxfArches(rx), mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  // a screw: a small body across `dir` with its split line (the plate opens along `dir`)
  const screw = (p, dir) => { const [dx, dy] = dir, nx = -dy, ny = dx, a = 3.2, b = 1.7;
    fill(RXP.poly([[p[0] - dx * a - nx * b, p[1] - dy * a - ny * b], [p[0] + dx * a - nx * b, p[1] + dy * a - ny * b], [p[0] + dx * a + nx * b, p[1] + dy * a + ny * b], [p[0] - dx * a + nx * b, p[1] - dy * a + ny * b]], true), '#D5D9DE', '#69727C', .7);
    stroke(RXP.line([p[0] - nx * b, p[1] - ny * b], [p[0] + nx * b, p[1] + ny * b]), .6, '#69727C'); };
  arches.forEach(A => {
    // the plate: along the tongue side to the distal of the 6s (the 7s when they're clasped); a horseshoe on the lower, the palate covered on the upper
    const last = Object.keys(teeth).some(id => id[0] === A && id[2] === '7') ? 7 : 6, seq = [];
    for (let n = last; n >= 1; n--) seq.push(A + 'R' + n); for (let n = 1; n <= last; n++) seq.push(A + 'L' + n);
    const pts = [], nrm = [], push = (p, id) => { pts.push(p); const b = rxT(id).b; nrm.push([-b[0], -b[1]]); };
    push(rxrL(seq[0], .6, -rxT(seq[0]).r * .55), seq[0]); seq.forEach(id => push(rxrL(id, .6, 0), id)); push(rxrL(seq[seq.length - 1], .6, -rxT(seq[seq.length - 1]).r * .55), seq[seq.length - 1]);
    const tn = rxrTint(rxfColor(c, rx, A)), d = RXP.smooth(pts);
    if (A === 'U') { const a = pts[pts.length - 1], b = pts[0], i1 = rxT('UR1').c, i2 = rxT('UL1').c, mb = mid(rxT('UR' + last).c, rxT('UL' + last).c), ax = unit(mb, mid(i1, i2)), k = [(a[0] + b[0]) / 2 + ax[0] * 9, (a[1] + b[1]) / 2 + ax[1] * 9];
      d.push(['C', k[0], k[1], k[0], k[1], b[0], b[1]], ['Z']); }
    else { const inner = pts.map((p, i) => [p[0] + nrm[i][0] * 7, p[1] + nrm[i][1] * 7]).reverse(), back = RXP.smooth(inner); d.push(['L', inner[0][0], inner[0][1]]); back.slice(1).forEach(o => d.push(o)); d.push(['Z']); }
    fill(d, tn.f, tn.s, .6);
    // occlusal acrylic over the back teeth (canines to 6s)
    if ((rx['ac' + A] || []).includes('occl')) S2.forEach(s => [3, 4, 5, 6].forEach(n => { const p = rxPoly(A + s + n, 1.08); stroke(rxHatch(p, -45, 1.8), .35, '#8A94A3'); stroke(RXP.poly(p, true), .5, '#7B8594'); }));
    if ((rx['ac' + A] || []).includes('abp')) { const ids = ['R3', 'R2', 'R1', 'L1', 'L2', 'L3'].map(x => A + x), o = ids.map(id => rxrL(id, .7, 0)), i = ids.map(id => rxrL(id, 6.5, 0)).reverse(), poly = o.concat(i);
      stroke(rxHatch(poly, 45, 1.5), .35, '#7B8594'); stroke(RXP.poly(poly, true), .55, '#7B8594'); }
    // a twin block's bite blocks (upper over the premolars and 6s, lower over the premolars)
    if (rx.fn === 'tbClark' || rx.fn === 'tbMcN') S2.forEach(s => (A === 'U' ? [4, 5, 6] : [4, 5]).forEach(n => { const p = rxPoly(A + s + n, 1.12); fill(RXP.poly(p, true), tn.f, tn.s, .5); stroke(rxHatch(p, A === 'U' ? 30 : -30, 1.6), .35, tn.s); }));
    // the screws: where the plate is split
    const ex = rx.exp, f1 = mid(rxT(A + 'R1').c, rxT(A + 'L1').c), m6 = mid(rxT(A + 'R6').c, rxT(A + 'L6').c), ap = unit(f1, m6), tr = [-ap[1], ap[0]];
    const at = k => [f1[0] + (m6[0] - f1[0]) * k, f1[1] + (m6[1] - f1[1]) * k];
    if (ex && ex !== 'none') {
      const one = A === 'L' ? at(.24) : at(.5); // lower: lingual to the incisors; upper: mid-palate
      if (ex === 'mid' || ex === 'other') { stroke(RXP.line(at(A === 'L' ? .1 : .16), at(A === 'L' ? .4 : .9)), .7, '#9E2E5A'); screw(one, tr); }
      else if (ex === 'mid2') { stroke(RXP.line(at(.12), at(.9)), .7, '#9E2E5A'); screw(at(A === 'L' ? .24 : .32), tr); screw(at(A === 'L' ? .5 : .7), tr); }
      else if (ex === 'sag2') { const c3 = mid(rxT(A + 'R3').c, rxT(A + 'L3').c), cut = [rxrL(A + 'R3', 1.2, -.6 * rxT(A + 'R3').r), rxrL(A + 'L3', 1.2, -.6 * rxT(A + 'L3').r)];
        stroke(RXP.line(cut[0], cut[1]), .7, '#9E2E5A'); S2.forEach(sd => { const q = mid(c3, rxrL(A + sd + '4', 4, 0)); screw(q, ap); }); }
      else if (ex === 'fan') { stroke(RXP.line(at(.12), at(.86)), .7, '#9E2E5A'); screw(at(.3), tr); const h = at(.86); fill(RXP.circle(h[0], h[1], 1.4), '#FFFFFF', '#69727C', .7); }
    }
  });
  // the labial bow (canine to canine, U-loops at the canines), acrylic to the bow
  arches.forEach(A => { if (!(rx['wc' + A] || []).includes('bow')) return;
    const loopAt = id => { const r = rxT(id).r; return [rxrB(id, 1.0, -.5 * r), rxrB(id, 3.5, -.3 * r), rxrB(id, 5.2, -.12 * r), rxrB(id, 5.2, .12 * r), rxrB(id, 3.5, .3 * r), rxrB(id, 1.0, .5 * r)]; };
    const side = s => { const t = A + s + '3', b = A + s + '4'; return [rxrGap(t, b, -1, 1.3), rxrMid(t, b), rxrGap(t, b, 1, 1.0)].concat(loopAt(t)); };
    const R = side('R'), L = side('L').reverse(), mids = ['R2', 'R1', 'L1', 'L2'].map(x => rxrB(A + x, 1.0, 0)), front = [R[R.length - 1]].concat(mids, [L[0]]);
    wire(R.concat(mids, L));
    if ((rx['ac' + A] || []).includes('bowAcr')) { const tn = rxrTint(rxfColor(c, rx, A)); stroke(RXP.smooth(front), 5.2, tn.s); stroke(RXP.smooth(front), 4.2, tn.f); } });
  // HG tubes on the upper 6s; labial pads in front of the lower incisors
  if ((rx.xsU || []).includes('hg')) S2.forEach(s => { const id = 'U' + s + '6'; fill(RXP.bar(rxrB(id, 2.2, 0), rxT(id).m, 4.2, 1.8), '#C9D6EA', RX_METAL, .6); });
  RXF_ARCH.forEach(A => { if ((rx['xs' + A] || []).includes('pads')) S2.forEach(s => { const id = A + s + '2', p = rxrB(id, 4.2, .4 * rxT(id).r); fill(RXP.ellipse(p[0], p[1], 2.6, 1.6), '#F6DCE3', '#B4808F', .6); }); });
  // pontics, then the clasps (shared with the Retainer Rx)
  Object.keys(teeth).filter(id => teeth[id] === 'pontic').forEach(id => { fill(RXP.poly(rxPoly(id, 1), true), '#F1E8D6', RX_METAL, .8); stroke(RXP.poly(rxPoly(id, .55), true), .4); });
  rxrClaspShapes(Object.fromEntries(Object.entries(teeth).filter(([, k]) => RXF_CLASPS.includes(k)))).forEach(x => out.push(x));
  return out;
}

/* ---------- the form's circles and blanks ---------- */
function rxfFill(c, rx, put, box) {
  if (rx.fn) box.add('fn.' + rx.fn);
  RXF_ARCH.forEach(A => {
    if (rx['ad' + A]) box.add('ad.' + rx['ad' + A] + '.' + A); if (rx['act' + A]) box.add('act.' + rx['act' + A] + '.' + A);
    (rx['wc' + A] || []).forEach(k => box.add('wc.' + k + '.' + A)); (rx['xs' + A] || []).forEach(k => box.add('xs.' + k + '.' + A)); (rx['ac' + A] || []).forEach(k => box.add('ac.' + k + '.' + A));
    const col = rxfColor(c, rx, A); if (col) { box.add('color.' + A); put('color' + A, col, 'H', 8); }
  });
  if (rx.exp) box.add('exp.' + rx.exp); if (rx.exp === 'other') put('screwOther', rx.screwOther, 'H', 8);
  const t = rx.teeth || {}; Object.keys(t).forEach(id => { const k = RXF_CIRCLE[t[id]]; if (k) box.add('wc.' + k + '.' + id[0]); });
}
/* the special instructions the choices write: where each clasp goes (the delta clasp isn't on the form at all), no occlusal acrylic
   on a Schwarz without it, the pontic and its shade */
function rxfNotes(rx) {
  const t = rx.teeth || {}, ids = k => rxfSort(RXF_TEETH.filter(id => t[id] === k), rx), num = id => rxfNum(id, rx), out = [];
  const list = a => a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const d = ids('delta'); if (d.length) out.push('Delta clasps on ' + list(d.map(num)) + ' (not on the form): closed loops in the MB and DB undercuts' + (rxfSchwarz(rx) ? ', just gingival to the composite bumps; keep the loops closed and snug under the bumps' : '') +
    '; bridge about 1 mm off the buccal. Scrape the cast up to 0.5 mm at the MB and DB gingival margins only if the loops can’t otherwise reach the undercut.');
  // ball clasps: where (all at one kind of contact: "at K–L and S–T (the D–E contacts)")
  const b = ids('ball').sort((x, y) => rxrUni(rxfGap(x, rx)[0].split('–')[0]) - rxrUni(rxfGap(y, rx)[0].split('–')[0])), kinds = Array.from(new Set(b.map(id => rxfGap(id, rx)[1])));
  if (b.length) out.push('Ball clasps at ' + (kinds.length === 1 && kinds[0] && rx.dent !== 'perm' ? list(b.map(id => rxfGap(id, rx)[0])) + ' (the ' + kinds[0] + ' contacts)' : list(b.map(id => rxfGapName(id, rx)))) + ': just gingival to the contact, clear of the papilla.');
  const ah = ids('arrowhead'); if (ah.length) out.push('Arrow clasps on ' + list(ah.map(num)) + ': arrows in the buccal embrasures on both sides.');
  [['adams', 'Adams clasps'], ['c', 'C-clasps']].forEach(([k, l]) => { const x = ids(k); if (x.length) out.push(l + ' on ' + list(x.map(num)) + '.'); });
  RXF_ARCH.forEach(A => { if (rx['act' + A] === 'schwarz' && !(rx['ac' + A] || []).includes('occl')) out.push('No occlusal acrylic (' + rxrArchWord(A) + ').'); });
  const p = ids('pontic'); if (p.length) out.push('Pontic' + (p.length > 1 ? 's' : '') + ' on ' + list(p.map(num)) + (rx.ponticTxt ? ', shade ' + rx.ponticTxt : '') + '.');
  return out;
}

/* ---------- a new Functional Rx: Dr. A's usual (when he's saved one), else his lower Schwarz ---------- */
function rxfStart(c) {
  const d = rxDefaults(RX_FUN);
  if (d) return rxCanon(Object.assign({ notes: RXF_NOTES0 }, JSON.parse(JSON.stringify(d)), { form: RX_FUN }));
  return rxCanon({ form: RX_FUN, actL: 'schwarz', exp: 'mid', dent: 'mixed', teeth: { LR6: 'delta', LL6: 'delta', LR4: 'ball', LL4: 'ball' }, notes: RXF_NOTES0 });
}
/* the chairside steps before the scan (his Lab Rx), for the clasps picked: [key, words] */
function rxfChecks(rx) {
  const t = rx.teeth || {}, d = rxfSort(RXF_TEETH.filter(id => t[id] === 'delta'), rx), b = rxfSort(RXF_TEETH.filter(id => t[id] === 'ball'), rx), out = [];
  if (d.length) out.push(['bumps', 'Bond small composite bumps at the MB and DB line angles of ' + d.map(id => rxfNum(id, rx)).join(' and ') + ' (the delta loops sit just under them)']);
  if (b.length) out.push(['contacts', 'Check that the contacts the ball clasps cross (' + b.map(id => rxfGapName(id, rx)).join(', ') + ') are tight on the model; keep a ball clasp only where it is']);
  if (d.length) out.push(['scan', 'Scan the upper, lower and bite after the bumps are on']);
  return out;
}

/* ---------- the editor's left side ---------- */
/* a row of the form: the option, then Upper / Lower (or Upper only, as on the paper) */
function rxfRow(g, v, label, tag, arches, st, info) {
  return '<div class="rxUL" data-rxinfo="' + (info || g) + ':' + v + '"><span class="rxULn">' + esc(label) + (st ? rxStBadge(st, v) : '') + (tag ? '<em>' + esc(tag) + '</em>' : '') + '</span>' +
    RXF_ARCH.map(A => (arches || RXF_ARCH).includes(A) ? '<button type="button" class="rxB rxU" data-rxg="' + g + A + '" data-v="' + v + '" aria-pressed="false" aria-label="' + esc(label) + ', ' + rxrArchWord(A) + '"><span>' + A + '</span></button>' : '<span class="rxUx"></span>').join('') + '</div>';
}
const RXF_PICS_C = [['delta', 'Delta', 'clasp-delta', 'clasp'], ['ball', 'Ball', 'clasp-ball', 'clasp'], ['adams', 'Adams', 'clasp-adams', 'clasp'], ['arrowhead', 'Arrowhead', 'clasp-arrowhead', 'clasp'], ['c', 'C-clasp', 'clasp-c', 'clasp']];
function rxfSecs(rx) {
  const tag = (k, unit) => rxTag(k, false, unit);
  return rxInfoSec('act', 'Active designs', rxrHead() + RXF_O.act.map(([k, l]) => rxfRow('act', k, l, k === 'schwarz' ? tag('schwarz') : tag('funAct'))).join('') +
      '<div class="rxULs">Upper only</div>' + RXF_O.actU.map(([k, l]) => rxfRow('act', k, l, tag('funAct'), ['U'])).join('')) +
    rxSec('Expansion options', '<div class="rxBs">' + RXF_O.exp.map(([k, l]) => rxBtn('exp', k, l, rx.exp === k, k === 'mid' ? 'with the Schwarz' : k === 'none' ? '' : tag('funScrew'))).join('') + '</div>' +
      '<div class="rxRow rxSub" data-show="screwOther">' + rxField('screwOther', 'Other screw design', 'text', ' maxlength="40"') + '</div>') +
    rxInfoSec('clasp', 'Wire / clasps', rxPicCards('claspPick', RXF_PICS_C, 'Dr. A’s clasps') +
      '<div class="small muted" style="margin-bottom:4px">Tap a clasp’s picture, then the teeth over the arches — or Upper / Lower for the usual teeth (delta, Adams and C on the 6s; ball clasps behind the Ds; arrows on the Es). The delta clasp isn’t on Specialty’s form: it’s written out with its teeth.</div>' +
      rxrHead() + rxfRow('wc', 'bow', 'Hawley Labial Bow', tag('funBow'), null, '', 'wc') +
      RXF_O.clasp.map(([k, l]) => rxfRow('clasp', k, l, tag(k === 'adams' ? 'adams' : k === 'delta' ? 'delta' : 'clasp', '/pr'), null, 'clasp')).join('') +
      '<div class="rxBs"><span class="rxLbl">Teeth named for</span>' + RXF_O.dent.map(([k, l]) => rxBtn('dent', k, l, (rx.dent || 'mixed') === k)).join('') + '<span class="small muted">(mixed: the primary C, D, E lettered)</span></div>' +
      '<div class="rxTeeth small" id="rxTeethSum"></div>') +
    rxInfoSec('ac', 'Acrylic design options', rxrHead() + RXF_O.ac.map(([k, l]) => rxfRow('ac', k, l, k === 'abp' ? tag('abp') : k === 'bowAcr' ? tag('acrBow') : k === 'occl' ? 'standard on the Schwarz' : '')).join('') +
      '<div class="small muted rxSub" data-show="noOccl">Specialty’s Schwarz comes with occlusal acrylic unless the Rx says otherwise, so the special instructions say “No occlusal acrylic” while it’s off.</div>' +
      '<div class="rxSub" data-show="pontic"><div class="rxULs">Pontic</div>' + rxShadeHTML('Tap the missing teeth with Pontic; the pontic and its shade go into the special instructions.') + '</div>' +
      '<div class="rxUL" data-rxinfo="ac:color"><span class="rxULn">Acrylic Colors <em>Specialty’s color guide</em></span></div>' + rxAcrHTML()) +
    rxSec('Accessories', rxrHead() + RXF_O.xs.map(([k, l]) => rxfRow('xs', k, l, tag('funXs'), k === 'hg' ? ['U'] : null, '', 'xs')).join('')) +
    rxInfoSec('fn', 'Functionals', '<div class="rxBs">' + RXF_O.fn.map(([k, l]) => rxBtn('fn', k, l, rx.fn === k, tag('fun'))).join('') + '</div>' +
      '<div class="rxULs">Appliance design</div>' + rxrHead() + RXF_O.ad.map(([k, l]) => rxfRow('ad', k, l, '', null, '', 'ad')).join(''), '', !!(rx.fn || rx.adU || rx.adL)) +
    '<section class="rxS rxSub" data-show="chk"><h5>Before the scan <span class="h5n">chairside, for these clasps — not on the form</span></h5><div class="rxChk" id="rxChk"></div></section>';
}
function rxfTeethSum(rx) {
  const t = rx.teeth || {}, by = {}; Object.keys(t).forEach(id => { (by[t[id]] = by[t[id]] || []).push(id); });
  return RXF_TOOTH.filter(k => by[k]).map(k => '<b>' + esc(RXF_TOOTH_L[k]) + ':</b> ' + esc(rxfSort(by[k], rx).map(id => k === 'ball' ? rxfGapName(id, rx) : rxfNum(id, rx)).join(', '))).join(' · ') || '<span class="muted">Nothing on the teeth yet.</span>';
}
function rxfTap(id, rx, tool) {
  if (!RXF_TOOTH.includes(tool)) return false;
  const t = rx.teeth = Object.assign({}, rx.teeth); if (t[id] === tool) delete t[id]; else t[id] = tool;
  return true;
}
/* Upper / Lower on a clasp row puts the clasps on their usual teeth (delta, Adams, C on the 6s; ball behind the 4s, the Ds; arrows on
   the 5s, the Es) or takes that arch's off; the pictures pick the clasp to tap; the colors and the shade */
function rxfClick(g, v, on, rx) {
  if (g === 'claspPick') { RXE.tool = v; return true; }
  if (rxAcrClick(g, v, rx) || rxShadeClick(g, v, rx)) return true;
  const m = /^clasp([UL])$/.exec(g); if (!m) return false;
  const A = m[1], t = rx.teeth = Object.assign({}, rx.teeth);
  if (!on) Object.keys(t).forEach(id => { if (id[0] === A && t[id] === v) delete t[id]; });
  else { (v === 'ball' ? ['R4', 'L4'] : v === 'arrowhead' ? ['R5', 'L5'] : ['R6', 'L6']).forEach(s => { if (t[A + s] !== 'pontic') t[A + s] = v; }); RXE.tool = v; }
  return true;
}
/* the chairside steps for the clasps picked; IR-style warnings: none */
function rxfMore(w, rx) {
  const box = $('#rxChk', w); if (!box) return; const ch = rxfChecks(rx), done = rx.chk || [];
  const key = ch.map(x => x[0] + x[1]).join('|'); if (box.dataset.key !== key) { box.dataset.key = key; box.innerHTML = ch.map(([k, l]) => rxBtn('chk', k, l, done.includes(k))).join(''); }
  $$('.rxB', box).forEach(b => b.setAttribute('aria-pressed', String(done.includes(b.dataset.v))));
}
RXK[RX_FUN] = {
  form: RX_FUN, key: 'fun', field: 'rxFun', ds: 'rxFun', title: 'Functional Rx', usual: 'our usual Schwarz',
  saveDefTip: 'New Functional Rx start from these choices and clasps (not this patient’s dates, colors, pontics, notes or drawings)',
  caseIntro: 'Specialty’s Functional Rx, filled in from this case with Dr. A’s lower Schwarz: tap the design, screw, clasps (and the teeth) and color, and it gives the PDF to upload with the scan, and the lab cost.',
  costEmpty: 'Pick the appliance — the prices add up here.',
  priceNote: 'Clasps, pontics, the bite plane, acrylic to the bow and colors are priced as on the Retainer Rx (Specialty’s custom design options). The Schwarz comes with its midline screw, occlusal acrylic and standard clasps (lower: two pairs of ball clasps; upper: a pair of ball and a pair of Adams).',
  prices: RXF_PRICES, appl: RXF_APPL,
  applies: c => !!c && c.type === 'appliance' && labName(c.lab) === LAB_SPEC && (c.appliances || []).some(a => RXF_APPL.includes(a)),
  scanners: [['itero', /itero/i], ['trios', /trios/i], ['medit', /medit/i], ['carestream', /carestream/i], ['cerec', /cerec|primescan|sirona/i]],
  canon: rxfCanon, summary: rxfSummary, estimate: rxfEstimate, auto: rxfAuto, fill: rxfFill, start: rxfStart,
  single: RXF_SINGLE, tools: ['delta', 'ball', 'adams', 'arrowhead', 'c', 'pontic'], tool0: 'delta', toolReset: true,
  defDrop: ['colorU', 'colorL', 'ponticTxt', 'screwOther', 'chk'],
  defClean: d => { d.teeth = Object.fromEntries(Object.entries(d.teeth || {}).filter(([, k]) => RXF_CLASPS.includes(k))); },
  defKeep: (cur, next) => { const own = Object.entries(cur.teeth || {}).filter(([, k]) => k === 'pontic'); if (own.length) next.teeth = Object.assign({}, next.teeth, Object.fromEntries(own)); },
  secHTML: rxfSecs, teethSum: rxfTeethSum, tap: rxfTap, tappable: () => true, click: rxfClick, syncMore: rxfMore,
  pressed: (g, v, rx) => /^clasp[UL]$/.test(g) ? Object.keys(rx.teeth || {}).some(id => id[0] === g.slice(-1) && rx.teeth[id] === v) : g === 'claspPick' ? RXE.tool === v
    : g === 'dent' ? (rx.dent || 'mixed') === v : rxAcrPressed(g, v, rx),
  status: (g, v, rx) => g === 'clasp' && rxfSchwarz(rx) ? RXF_GUIDE[v] || null : null,
  stFor: () => 'Schwarz',
  // the Schwarz takes Specialty's standard colors only
  off: (g, v, rx) => g === 'acrPick' && rxfSchwarz(rx) && !acrylicStd(v) ? ACR_STD_ONLY : '',
  needs: (rx, c) => { const n = [];
    if (Object.values(rx.teeth || {}).includes('pontic') && !rx.ponticTxt) n.push(['the pontic shade', 'ponticTxt']);
    if (rxfSchwarz(rx) && RXF_ARCH.some(A => !acrylicStd(rxfColor(c || RXE.c, rx, A)))) n.push(['a standard acrylic color (the Schwarz comes in Specialty’s standard colors only)', 'acr']);
    return n; },
  autoNotes: rxfNotes,
  acrArches: rxfArches, colorOf: rxfColor,
  autoVal: { colorU: (c, rx) => rxfArches(rx).includes('U') ? rxrCaseColor(c) : '', colorL: (c, rx) => rxfArches(rx).includes('L') ? rxrCaseColor(c) : '' },
  toolsHTML: () => rxToolBtn('delta', 'Delta', 'Delta clasp on the tooth (written out on the form)') + rxToolBtn('ball', 'Ball', 'Ball clasp behind the tooth') + rxToolBtn('adams', 'Adams', 'Adams clasp on the tooth') +
    rxToolBtn('arrowhead', 'Arrowhead', 'Arrow clasp: arrows in the embrasures on both sides of the tooth') + rxToolBtn('c', 'C-clasp', 'C-clasp on the tooth') + rxToolBtn('pontic', 'Pontic', 'A pontic in the space'),
  hint: tool => ({ delta: 'Tap the teeth that get a delta clasp (written out with their numbers in the special instructions).', ball: 'Tap the tooth in front of the gap: the ball goes between it and the tooth behind it (a D: the D–E contact).',
    adams: 'Tap the teeth that get an Adams clasp.', arrowhead: 'Tap a tooth: arrows go in the embrasures on both sides of it. Tap the next tooth to run the clasp on.',
    c: 'Tap the teeth that get a C-clasp.', pontic: 'Tap the missing teeth: each gets a pontic (and the shade is required).' })[tool] || '',
  tip: (id, rx) => { const k = (rx.teeth || {})[id]; return rxfNum(id, rx) + ' (' + id + ')' + (k ? ': ' + RXF_TOOTH_L[k] : ''); },
  subShow: (k, rx) => k === 'screwOther' ? rx.exp === 'other' : k === 'pontic' ? Object.values(rx.teeth || {}).includes('pontic') : k === 'noOccl' ? RXF_ARCH.some(A => rx['act' + A] === 'schwarz' && !(rx['ac' + A] || []).includes('occl'))
    : k === 'chk' ? rxfChecks(rx).length > 0 : false,
  foldSum: (g, rx) => g === 'fn' ? [rx.fn ? rxfLbl(rx.fn, ['fn']) : '', rx.adU ? rxfLbl(rx.adU, ['ad']) + ' (upper)' : '', rx.adL ? rxfLbl(rx.adL, ['ad']) + ' (lower)' : ''].filter(Boolean).join(' · ') : '',
  leadDays: () => 10,
  info: RXF_INFO, src: Object.assign({}, RXR_SRC, RXF_SRC),
  infoKeys: g => ({ act: RXF_K('act').concat(RXF_K('actU')), clasp: RXF_CLASPS, ac: RXF_K('ac').concat(['color']), fn: RXF_K('fn') })[g] || [],
  infoName: (g, v) => rxfLbl(v),
  infoTag: (g, v) => g === 'act' ? rxTag(v === 'schwarz' ? 'schwarz' : 'funAct') : g === 'clasp' ? rxTag(v === 'adams' ? 'adams' : v === 'delta' ? 'delta' : 'clasp', false, '/pr')
    : g === 'fn' ? rxTag('fun') : g === 'ac' ? ({ abp: rxTag('abp'), bowAcr: rxTag('acrBow'), occl: 'standard on the Schwarz', color: 'standard colors free' })[v] || '' : '',
  infoSel: (g, rx) => g === 'act' ? rx.actL || rx.actU || '' : g === 'clasp' ? RXF_CLASPS.find(k => Object.values(rx.teeth || {}).includes(k)) || '' : g === 'fn' ? rx.fn || ''
    : g === 'ac' ? (rx.acL || [])[0] || (rx.acU || [])[0] || '' : '',
  infoOf: b => { const g = b.dataset.rxg, v = b.dataset.v; if (g === 'claspPick') return ['clasp', v]; if (g === 'acrPick' || g === 'acrFor') return ['ac', 'color']; if (g === 'ponticShade') return null; if (g === 'fn') return ['fn', v];
    const m = /^(act|clasp|ac)[UL]$/.exec(g); return m ? [m[1], v] : null; },
  infoPrompt: g => ({ act: 'a design', clasp: 'a clasp', ac: 'an acrylic option', fn: 'a functional' })[g] || 'an option',
  cmpKeys: g => ({ act: RXF_K('act').concat(RXF_K('actU')), clasp: RXF_CLASPS, fn: RXF_K('fn') })[g] || null
};
