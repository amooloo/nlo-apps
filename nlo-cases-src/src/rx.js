/* =====================================================================
   Lab Rx — Specialty Appliances' own Rx forms, filled in from the case
   Amir, 3 Oct 2026: "this is the form for herbst from specialty. can you include it in our case submission but the result
   would be on the paper that can be then exported. Also it could be customized more and basic information can be filled
   out" — then "I want diagrams to be drawn on the arches. kinda like how Easy Rx does it" and "add all the prices for all
   different pieces … so it would give me a total pricing at the end".
   Amir, 4 Oct 2026: "here is the Rx for hawley. do the same" — Specialty's Retainer Rx (MKT-7) works the same way (rxret.js).
   - This file is what both forms share (the editor, the arches, the paper, the PDF, the estimate, the hooks into New case,
     Edit, the case and Team & security) and the Herbst Rx itself; rxret.js adds the Retainer Rx. Each form is a "kind"
     (RXK below): its choices, prices, drawing and words.
   - Choices are tapped in the app (New case, Edit, or the case's Rx section). The result is Specialty's own form
     (rxdata.js: their PDF with its fill-in fields taken out), filled in and drawn on, as a PDF made in the browser — no
     library, and nothing leaves this computer. The case keeps the choices (encrypted with the rest of the case), so the
     PDF can be made again any time.
   - The appliance draws itself on Specialty's arch diagram from the choices; a pen, a line and an arrow add anything else
     (like EasyRx). Dr. A's details (account #, license #, signature line) come from Team & security → Lab Rx; the
     patient, date needed and scanner from the case.
   - Prices: Specialty's price list MKT-41 (Rev 01-26, updated 1-27-26), editable by Dr. A in Team & security. Each piece
     shows its price and the Rx ends with the estimate; anything the price list doesn't have is named, never guessed.
   ===================================================================== */
const RX_FORM = 'specialty-herbst', RX_RET = 'specialty-retainer';
const RXF = RX_FORMS[RX_FORM]; // the Herbst form
/* the forms: RXK[form id] = what's particular to each (the Herbst at the end of this file, the Retainer in rxret.js) */
const RXK = {};
function rxK(x) { const f = typeof x === 'string' ? x : x && x.form; return RXK[f] || RXK[RX_FORM]; }
function rxKind(key) { return Object.values(RXK).find(k => k.key === key) || RXK[RX_FORM]; }
function rxKinds() { return Object.values(RXK); }
/* the appliances that go on the Herbst form (with the lab set to Specialty) */
const RX_HERBST = ['Herbst with Rollo Band', 'Space Closing Herbst'];
/* the form's choices, in its order and words (® and ™ left off on screen) */
const RXO = {
  design: [['standard', 'Standard Herbst'], ['cantilever', 'Cantilever Herbst'], ['spaceclosing', 'Space Closing Herbst'], ['acryliclower', 'Band or Crown Upper / Acrylic Lower'], ['combination', 'Band / Crown Combination']],
  mech: [['m4', 'M4 MiniScope (4-part)'], ['miniscope', 'Specialty MiniScope (3-part)'], ['standard', 'Standard Herbst Mechanism'], ['hth', 'HTH Telescope Mechanism'], ['fliplock', 'Flip-Lock Mechanism']],
  bite: [['wax', 'Use enclosed wax bite for AP'], ['lines', 'Use lines on models for AP'], ['class1', 'Position for Class I molars'], ['e2e', 'Position anteriors edge to edge'], ['advance', 'Advance __ mm']],
  anch: [['band', 'Band'], ['crown', 'Crown'], ['roc', 'ROC'], ['onbrace', 'OnBRACE']],
  exp: [['mcU', 'Mini-Click · upper'], ['mcL', 'Mini-Click · lower'], ['csU', 'Click Screw · upper'], ['csL', 'Click Screw · lower']],
  wire: [['la', 'Lingual Arch: Lower'], ['tpa', 'Transpalatal Arch'], ['qh', 'Quad Helix: Upper']],
  restKind: [['ball', 'Ball clasps'], ['w032', '.032 wire'], ['w036', '.036 wire']],
  awtPos: [['occ', 'Occlusal'], ['cen', 'Center'], ['gin', 'Gingival']],
  crownOpt: [['roc', 'Remove Occlusal from Crowns (ROC)'], ['lugs', 'Lingual Seating Lugs'], ['vent', 'Vent Holes'], ['debond', 'Debonding Holes'], ['slits', 'Vertical Slits']]
};
const RX_KEYS = o => RXO[o].map(x => x[0]);
/* what each Herbst design and mechanism is, for the card under the choices (point at one, tab to it or tap it) and Compare all.
   Amir, 4 Oct 2026: "add details and information to each one of those options … refer to the specialty website … what the
   difference is between those options". From Specialty Appliances' own pages unless a note says otherwise (`src`). */
const RX_SRC = {
  herbst: ['Specialty: Herbst variations', 'https://specialtyappliances.com/herbst-appliance/'],
  mech: ['Specialty: Herbst mechanics', 'https://specialtyappliances.com/the-herbst-appliance/'],
  review: ['Specialty’s Herbst design review', 'https://orthopracticeus.com/herbst-appliance-update/'],
  m4: ['Specialty: M4 Herbst', 'https://specialtyappliances.com/product/specialty-m4-herbst/'],
  m4mech: ['Specialty: M4 mechanism', 'https://specialtyappliances.com/product/m4-herbst-mechanism/'],
  mini: ['Specialty: MiniScope Herbst', 'https://specialtyappliances.com/product/specialty-miniscope-herbst/'],
  minimech: ['Specialty: MiniScope mechanism', 'https://specialtyappliances.com/product/miniscope-herbst-mechanism/'],
  hth: ['Specialty (Ordont lab): HTH Herbst', 'https://ordont.specialtyappliances.com/product/hanks-telescoping-herbst'],
  flip: ['Specialty: Flip-Lock mechanism', 'https://specialtyappliances.com/product/flip-lock-mechanism/'],
  tpflip: ['TP Orthodontics: Flip-Lock Herbst', 'https://www.tportho.com/products/class-ii-correction/flip-lock-herbst-2/'],
  cant: ['Specialty: cantilever arms', 'https://specialtyappliances.com/product/telescoping-cantilever-arms/'],
  protr: ['Protraction Herbst study (Prog Orthod 2024)', 'https://link.springer.com/article/10.1186/s40510-024-00533-3']
};
const RX_INFO = {
  design: {
    standard: { pic: 'herbst-standard', short: 'Upper first molars to lower first premolars, with a lower lingual arch. The everyday Herbst.',
      sum: 'The classic layout: the Herbst runs from the upper first molars to the lower first premolars, with a lower lingual arch tying the lower anchorage together.',
      pts: ['The anchor teeth get bands, crowns or ROCs (tap them on the arches). Specialty includes the lower lingual arch (no loops).',
        'For Class II correction once the lower first premolars are in.',
        'Priced as the list’s Band/Crown/ROC Herbst.'],
      src: ['review', 'm4'] },
    cantilever: { pic: 'herbst-cantilever', short: 'Lower anchorage on the first molars only; an arm runs forward to the Herbst. No lower premolar bands.',
      sum: 'Crowns (or ROCs) on the lower first molars carry an arm forward along the cheek side to the premolar area, where the lower end of the Herbst attaches — no lower premolars are banded.',
      pts: ['Good when the lower premolars aren’t in, or aren’t good anchors (e.g. the mixed dentition).',
        'Specialty: when intrusion is wanted (a high-angle patient) the cantilever arm is set below the gum line to add a vertical force; otherwise the M4 runs parallel to the bite so it doesn’t intrude teeth.',
        'Specialty’s telescoping cantilever arms come right and left with .022 × .028 archwire tubes welded on.'],
      src: ['review', 'cant'] },
    spaceclosing: { short: 'The Herbst holds the lower front teeth while the lower molars come forward to close a space.',
      sum: 'Uses the Herbst as anchorage to bring the lower molars forward and close a space — typically a missing lower second premolar — while it corrects the Class II, without TADs.',
      pts: ['Usually the arms run from the upper first molars to the lower first premolars; the lower first molars slide forward along a lingual-arch extension, pulled by elastic chain from hooks on the premolar and molar bands.',
        'The Herbst keeps the lower incisors from tipping back as the molars come forward.',
        'Note the space to close in the special instructions.'],
      note: 'Specialty’s site doesn’t describe this design; this is how a space-closing (protraction) Herbst is usually built.',
      src: ['protr'] },
    acryliclower: { short: 'Bands or crowns on top; an acrylic splint over the lower teeth instead of lower bands or crowns.',
      sum: 'Bands or crowns on the upper molars; the lower is an acrylic splint over the lower teeth instead of lower bands or crowns.',
      pts: ['The splint spreads the Herbst’s force over the whole lower arch and covers the biting surfaces.',
        'An option when the lower teeth aren’t good to band or crown (e.g. the mixed dentition).',
        'Specialty’s history of the Herbst: the acrylic splint design goes back to Dr. Raymond Howe (1982).',
        'The pricier design on Specialty’s list.'],
      src: ['review'] },
    combination: { short: 'Bands on some anchor teeth, crowns on others — each tooth gets the anchorage that suits it.',
      sum: 'Mixes bands and crowns on the anchor teeth (for example bands on the upper molars and crowns on the lower), so each tooth gets the anchorage that suits it.',
      pts: ['Specialty: bands are easier to deliver chairside but harder to keep clean; crowns are more durable with better cement retention, and a little more work to deliver.',
        'ROC (a crown with the occlusal removed) is Specialty’s most popular anchorage: the strength of a crown with band-like removal.',
        'Tap Band, Crown or ROC tooth by tooth on the arches.'],
      src: ['herbst', 'review'] }
  },
  mech: {
    m4: { short: 'Specialty’s 4-part telescope: shortest (16/19 mm), opens to 64 mm, most side-to-side movement, least breakage. Their most popular.',
      sum: 'Specialty’s own 4-part telescope (2011) and the most popular mechanism they make — over 65% of their Herbst customers use it.',
      pts: ['Short (16 or 19 mm), so it sits in the masseter area away from the cheek muscles; the upper eyelet is angled forward to avoid tissue irritation.',
        'Opens up to 64 mm — more vertical opening than any other telescope, so patients don’t break it or pull the lower crowns off when they open wide.',
        'Runs parallel to the bite for the most side-to-side movement (up to 40° with AppleCore screws) without intruding teeth; the least breakage.',
        'Doesn’t come apart and is advanced in the mouth. Specialty recommends it with AppleCore screws and pivots.'],
      src: ['m4', 'm4mech', 'review'] },
    miniscope: { short: 'Specialty’s original 3-part mini telescope: slimmer than the traditional Herbst, in longer sizes (18–31 mm).',
      sum: 'Specialty’s original miniaturized telescope (2004): 3 parts, doesn’t come apart, and much slimmer than the traditional rod and tube.',
      pts: ['Up to 40° of side-to-side movement with AppleCore screws; it also works with traditional screws and pivots.',
        'Advanced without taking it out of the mouth.',
        'Comes in longer lengths (18–31 mm); the M4 is the newer, shorter 4-part version with more opening. The same price on Specialty’s list.'],
      src: ['mini', 'minimech', 'review'] },
    standard: { short: 'The traditional rod and tube: bulkier, less side-to-side movement, advanced with round shims.',
      sum: 'The traditional rod-and-tube Herbst — the classic Pancherz design, still used by some today.',
      pts: ['A separate rod and tube, attached with hex screws and advanced by crimping round shims onto the rod.',
        'Bulkier and longer than the telescopes, with limited side-to-side movement that can restrict speech and chewing and irritate the cheeks.',
        'No separate charge on Specialty’s list.'],
      src: ['herbst', 'review'] },
    hth: { pic: 'herbst-hth', short: 'Hanks Telescoping Herbst: ball and socket, screws built in, the bulkiest. Specialty recommends the M4 instead.',
      sum: 'The Hanks Telescoping Herbst (Dr. Steve Hanks, 2003): a telescoping mechanism with a ball-and-socket design and the screws built into it.',
      pts: ['Specialty calls it the bulkiest appliance on the market and recommends the M4 over it.',
        'Costs more than the M4 on Specialty’s list.'],
      src: ['hth', 'review'] },
    fliplock: { pic: 'herbst-fliplock', short: 'TP Orthodontics’ tube and piston with ball-and-swivel ends; snaps together; crimpable spacers. The priciest.',
      sum: 'TP Orthodontics’ Flip-Lock (Dr. Miller, 1996): a tube and piston with ball-and-swivel joints at both ends for more side-to-side movement.',
      pts: ['A patented lock snaps it together in seconds; no pins, screws or springs (TP Orthodontics).',
        'Advanced with crimpable spacers (1–5 mm).',
        'The upper arms are right/left specific; the lower rods are universal.',
        'The priciest mechanism on Specialty’s list.'],
      src: ['flip', 'tpflip', 'review'] },
    apple: { name: 'AppleCore® screws & pivots', short: 'Specialty’s swivel screws: up to 40° side to side, less breakage. Goes with the M4 or MiniScope.',
      sum: 'Specialty’s AppleCore® screw (2004) holds the telescope and lets it swivel up to 40° side to side.',
      pts: ['More natural function and much less breakage, because the mechanism follows the jaw’s side-to-side movements.',
        'Specialty recommends AppleCore screws and pivots with the M4; with the MiniScope their flexibility makes the whole appliance easier to insert.',
        'Goes with the mechanism you pick, not instead of it.'],
      src: ['review', 'm4', 'mini'] },
    shims: { name: 'Advancement shims', sum: 'Shims placed on the front part of the telescope advance the bite in steps during treatment.',
      pts: ['Give the size (mm) and how many to send.'], src: ['mech'] },
    mio: { name: 'MIO measurement', sum: 'The patient’s maximum incisal opening, in mm. Specialty uses it to size the mechanism so the patient can open fully without straining it.',
      pts: ['If the opening is limited, patients break the appliance or pull the lower crowns off (Specialty).'], src: ['mini', 'review'] }
  }
};
const RX_INFO_FLAG = { apple: 'mech', shims: 'mech', mio: 'mech' }; // on/off choices that explain themselves in the mechanism card
/* the teeth on Specialty's two tooth grids (anchorage, occlusal rests): 4s to 7s */
const RX_GRID = ['UR7', 'UR6', 'UR5', 'UR4', 'UL4', 'UL5', 'UL6', 'UL7', 'LR7', 'LR6', 'LR5', 'LR4', 'LL4', 'LL5', 'LL6', 'LL7'];
const RX_INK = '#14286E'; // what's filled in prints in a dark navy, like a pen
const RX_DRAW_COL = { b: '#1D4ED8', r: '#DC2626', k: '#111827' };
const RX_MAX_STROKES = 80, RX_MAX_PTS = 400; // drawings per Rx, points per pen stroke (a long stroke is simplified to fit)
const RX_SINGLE = ['design', 'mech', 'bite', 'restKind', 'awtU', 'awtL', 'awtPos']; // one answer each (the rest are lists or on/off)
const RX_METAL = '#2F5D9A'; // the appliance in steel blue, so it reads apart from Specialty's black outlines (dark grey in black & white)
const RX_DRAWS = ['pen', 'line', 'arrow'];

/* ---------- prices: Specialty Appliances price list MKT-41, Rev 01-26 (updated 1-27-26) ----------
   The Herbst section of the list: the appliance, then "mechanisms & design options" added to it. Archwire tubes, the lingual
   holding arch and rests are included; crown customization (holes/slits) is free. Mini-Click and Click Screw aren't on the
   list by name, so they're priced as its RPE screw; the TPA and quad helix are on it only as appliances of their own.
   The Rx's other options have no price on the list: they start blank (named under the estimate, not added) and Dr. A can
   give them a price in Team & security → Lab Rx (e.g. from an invoice), which the estimate then adds. (The Retainer Rx's
   prices are in rxret.js.) */
const RX_PRICE_SRC = 'Specialty Appliances price list MKT-41 (Rev 01-26, updated 1-27-26)';
const RX_PRICES = [
  ['herbst', 'Band/Crown/ROC Cantilever Herbst', 220.50], ['herbstAcr', 'Band/Crown Upper / Acrylic Lower Herbst', 293.50],
  ['band', 'Bands provided and fit, each', 17.75], ['crown', 'Crowns provided and fit, each', 21.50],
  ['band3d', '3D print bands, each', 38.00], ['crown3d', '3D print crowns, each', 43.50],
  ['miniscope', 'Specialty MiniScope mechanisms (3-part)', 66.50], ['m4', 'M4 MiniScope mechanisms (4-part)', 66.50],
  ['hth', 'HTH mechanisms', 110.00], ['fliplock', 'Flip-Lock mechanism', 167.50], ['screw', 'RPE screw, each (Mini-Click, Click Screw)', 70.50],
  ['tpa', 'Transpalatal arch (its own appliance on the list)', 93.50], ['qh', 'Quad helix: fixed (its own appliance on the list)', 109.00],
  // not on the price list
  ['applecore', 'AppleCore screws', null], ['onbrace', 'OnBRACE, each', null], ['shims', 'Advancement shims', null],
  ['ball', 'Ball clasps on the rests, pair (the list prices ball clasps only for removables, $19.25/pr)', null],
  ['awtExt', 'Archwire tubes extended to the 2nd bicuspid', null], ['lugs', 'Lingual seating lugs', null]
];
/* on both forms: Specialty's fee for a case needed in under 10 business days — from their case scheduling page
   (https://specialtyappliances.com/case-scheduling/: "a $95 expedited manufacturing and shipping fee will be applied"),
   not the price list (until 4 Oct 2026 it was unpriced here) */
const RX_PRICES_BOTH = [['rush', 'Expedited manufacturing and shipping (needed in under 10 business days)', 95.00]];
const RX_LIST = {}; // the list's own price (null: not on it)
function rxAddPrices(list) { list.forEach(([k, , p]) => { RX_LIST[k] = p; }); }
rxAddPrices(RX_PRICES); rxAddPrices(RX_PRICES_BOTH);
function rxPrices() {
  const out = Object.assign({}, RX_LIST);
  let o = {}; try { o = JSON.parse((S.settings || {}).rxPrices || '{}') || {}; } catch (e) { }
  Object.keys(o).forEach(k => { if (k in out) out[k] = o[k] === '' || o[k] == null || isNaN(Number(o[k])) ? null : Number(o[k]); });
  return out;
}
/* the price on a choice: "$66.50" (or "+$66.50"), else "not on list" */
function rxTag(k, plus, unit) { const p = rxPrices()[k]; return p == null ? (RX_LIST[k] == null ? 'not on list' : 'no price') : (plus ? '+' : '') + money(p) + (unit || ''); }
/* money() is ui.js's ($1,234.50) */
/* the estimate's lines: add(label, price key, qty, note) when it has a price (else it's named under the total), inc(label, how) */
function rxEst() {
  const PR = rxPrices(), lines = [], missing = [];
  return { lines, missing,
    add(l, k, qty, note) {
      const p = PR[k], q = qty || 1; if (p == null) { missing.push(l); return; }
      const mine = RX_LIST[k] == null ? 'your price' : p !== RX_LIST[k] ? 'your price (list ' + money(RX_LIST[k]) + ')' : '';
      lines.push({ l, qty: q, each: p, amt: p * q, note: [note, mine].filter(Boolean).join('; ') });
    },
    inc(l, how) { lines.push({ l, inc: how || 'Included' }); },
    done() { return { lines, missing, total: lines.reduce((s, x) => s + (x.amt || 0), 0) }; } };
}

/* ---------- Dr. A's details on every Rx (Team & security → Lab Rx); the account # and license # are his to enter ---------- */
const RX_OFFICE0 = { doctor: 'Amir Akhavan, DMD, MS', acct: '', address: '320 NW 76th Drive', city: 'Gainesville', state: 'FL', zip: '32607', phone: '(352) 332-7466', email: '', license: '', licExp: '', sig: 's/ Amir Akhavan, DMD, MS' };
function rxOffice() { const o = (S.settings || {}).rxOffice; return Object.assign({}, RX_OFFICE0, o && typeof o === 'object' ? o : {}); }
function rxOfficeMissing() { const o = rxOffice(); return [['acct', 'account #'], ['license', 'license #'], ['licExp', 'license expiration']].filter(([k]) => !String(o[k] || '').trim()).map(x => x[1]); }

/* ---------- the Rx on a case (each form in its own field: rx = Herbst, rxRet = Retainer) ---------- */
function rxOfK(c, K) { const v = c && c[K.field]; return v && typeof v === 'object' ? v : null; }
function rxShowsK(c, K) { return !!rxOfK(c, K) || K.applies(c); }
function rxApplies(c) { return RXK[RX_FORM].applies(c); }
function rxOf(c) { return rxOfK(c, RXK[RX_FORM]); }
function rxShowsOn(c) { return rxShowsK(c, RXK[RX_FORM]); }
/* the same choices always save the same way (fixed key order, nothing empty), so Edit sees no change unless there is one */
function rxCanon(rx) { rx = rx || {}; return rxK(rx).canon(rx); }
/* the little helpers every form's canon uses */
function rxCanonKit(rx, o) {
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 60);
  return {
    str,
    one: (k, ok, n) => { const v = str(rx[k], n); if (v && (!ok || ok.includes(v))) o[k] = v; },
    num: k => { const v = str(rx[k], 8).replace(/[^\d.]/g, ''); if (v) o[k] = v; },
    list: (k, ok) => { const a = Array.isArray(rx[k]) ? rx[k] : []; const u = ok.filter(v => a.includes(v)); if (u.length) o[k] = u; },
    flag: k => { if (rx[k] === true) o[k] = true; }
  };
}
/* what both forms keep the same way, last: the dates, the special instructions, the drawings (inside the form's arch area) */
function rxCanonTail(rx, o, F) {
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 60);
  ['needed', 'shipped'].forEach(k => { const v = str(rx[k], 10); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) o[k] = v; });
  const notes = String(rx.notes || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{2,}/g, '\n').trim().slice(0, 600);
  if (notes) o.notes = notes;
  const [cx0, cy0, cw0, ch0] = F.clip, inArea = (v, i) => { const lo = (i % 2 ? cy0 : cx0) * 10, hi = lo + (i % 2 ? ch0 : cw0) * 10, n = Number(v); return Math.round(Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))); };
  const draw = (Array.isArray(rx.draw) ? rx.draw : []).filter(s => s && RX_DRAWS.includes(s.t) && ['b', 'r', 'k'].includes(s.c) && Array.isArray(s.p) && s.p.length >= 4 && s.p.length % 2 === 0)
    .slice(0, RX_MAX_STROKES).map(s => ({ t: s.t, c: s.c, p: s.p.slice(0, RX_MAX_PTS * 2).map(inArea) }));
  if (draw.length) o.draw = draw;
  if (rx.noAuto === true) o.noAuto = true;
}
function rxEmpty(rx) { return !rx || Object.keys(rxCanon(rx)).length <= 1; }
/* what the Rx says in one line: "Cantilever Herbst · M4 MiniScope · 4 bands, 2 crowns" */
function rxSummary(rx) { rx = rxCanon(rx); return rxK(rx).summary(rx); }

/* ---------- dates: needed by (Specialty: "at least 1 day before the appointment date") and sent ---------- */
function prevClinicDay(iso) {
  let d = iso;
  for (let i = 0; i < 30; i++) { d = addDays(d, -1); const [y, m, dd] = d.split('-').map(Number); const wd = new Date(y, m - 1, dd).getDay(); if (wd >= 1 && wd <= 4 && !officeHolidays(y).includes(d)) return d; }
  return addDays(iso, -1);
}
function addBusinessDays(iso, n) { let d = iso, left = n; while (left > 0) { d = addDays(d, 1); const [y, m, dd] = d.split('-').map(Number); const wd = new Date(y, m - 1, dd).getDay(); if (wd >= 1 && wd <= 5) left--; } return d; }
/* the date needed: what's typed on the Rx, else the case's lab completion date, else the office day before the delivery appt */
function rxNeedAuto(c) { return (c && c.labDate) || (c && c.deliveryDate ? prevClinicDay(c.deliveryDate) : ''); }
function rxNeeded(c, rx) { return (rx && rx.needed) || rxNeedAuto(c); }
const usDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return m + '/' + d + '/' + y; };

/* ---------- the estimate ---------- */
function rxEstimate(rx, c) { rx = rxCanon(rx); return rxK(rx).estimate(rx, c); } // (c: the case, for what the form fills from it)

/* ---------- the arch diagram: geometry (rxdata.js — Specialty's own tooth outlines, top-down points) ---------- */
let RXG = RXF; // the form whose arches are being drawn (rxAuto sets it; the forms' diagrams differ a little)
const rxT = id => RXG.teeth[id];
function rxPt(id, along, out) { const t = rxT(id); return [t.c[0] + t.m[0] * along + t.b[0] * out, t.c[1] + t.m[1] * along + t.b[1] * out]; }
function rxPoly(id, k) { const t = rxT(id), p = t.p, out = []; for (let i = 0; i < p.length; i += 2) out.push([t.c[0] + (p[i] - t.c[0]) * k, t.c[1] + (p[i + 1] - t.c[1]) * k]); return out; }
/* path ops: ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z'] */
const RXP = {
  poly(pts, close) { const d = pts.map((q, i) => [i ? 'L' : 'M', q[0], q[1]]); if (close) d.push(['Z']); return d; },
  line(a, b) { return [['M', a[0], a[1]], ['L', b[0], b[1]]]; },
  circle(cx, cy, r) { const k = .5523 * r; return [['M', cx + r, cy], ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r], ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy], ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r], ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy], ['Z']]; },
  ellipse(cx, cy, rx, ry) { const kx = .5523 * rx, ky = .5523 * ry; return [['M', cx + rx, cy], ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy], ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ['Z']]; },
  /* a smooth curve through the points (Catmull-Rom as cubic Béziers) */
  smooth(pts) { if (pts.length < 3) return RXP.poly(pts); const d = [['M', pts[0][0], pts[0][1]]];
    for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      d.push(['C', p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]]); }
    return d; },
  /* a small bar along `dir` (e.g. an archwire tube) */
  bar(c, dir, len, wid) { const [dx, dy] = dir, nx = -dy, ny = dx, a = len / 2, b = wid / 2;
    return RXP.poly([[c[0] - dx * a - nx * b, c[1] - dy * a - ny * b], [c[0] + dx * a - nx * b, c[1] + dy * a - ny * b], [c[0] + dx * a + nx * b, c[1] + dy * a + ny * b], [c[0] - dx * a + nx * b, c[1] - dy * a + ny * b]], true); }
};
/* hatching inside a polygon: parallel segments `gap` apart at `deg` */
function rxHatch(poly, deg, gap) {
  const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, d = [];
  const proj = poly.map(q => q[0] * nx + q[1] * ny), lo = Math.min(...proj), hi = Math.max(...proj);
  for (let s = lo + gap / 2; s < hi; s += gap) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], sp = p[0] * nx + p[1] * ny, sq = q[0] * nx + q[1] * ny;
      if ((sp - s) * (sq - s) < 0) { const t = (s - sp) / (sq - sp); xs.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
    xs.sort((m, n) => (m[0] * ux + m[1] * uy) - (n[0] * ux + n[1] * uy));
    for (let i = 0; i + 1 < xs.length; i += 2) d.push(['M', xs[i][0], xs[i][1]], ['L', xs[i + 1][0], xs[i + 1][1]]);
  }
  return d;
}
/* the appliance, drawn from the choices (a list of shapes, top-down points, on the Rx's own form) */
function rxAuto(rx, c) { rx = rxCanon(rx); const K = rxK(rx); RXG = RX_FORMS[K.form]; return K.auto(rx, c); }
/* the pen, line and arrow drawings (points ×10, top-down) */
function rxStrokes(rx) {
  return (rxCanon(rx).draw || []).map(s => { const pts = []; for (let i = 0; i < s.p.length; i += 2) pts.push([s.p[i] / 10, s.p[i + 1] / 10]);
    const col = RX_DRAW_COL[s.c], items = [];
    if (s.t === 'pen') items.push({ d: RXP.poly(pts), s: col, w: 1.3 });
    else { const a = pts[0], b = pts[pts.length - 1]; items.push({ d: RXP.line(a, b), s: col, w: 1.3 });
      if (s.t === 'arrow') { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = 4.2, wv = 2.3;
        items.push({ d: RXP.poly([b, [b[0] - ux * h - uy * wv, b[1] - uy * h + ux * wv], [b[0] - ux * h + uy * wv, b[1] - uy * h - ux * wv]], true), f: col }); } }
    return items; }).flat();
}
function rxArchList(rx, c) { return (rx && rx.noAuto ? [] : rxAuto(rx, c)).concat(rxStrokes(rx)); }

/* ---------- what goes on the paper: text on the lines, filled circles, circled grid teeth, the drawings ---------- */
function rxWidth(s, font, size) { const W = RX_FONT_W[font]; let w = 0; for (const ch of s) { const b = rxByte(ch); w += (b >= 32 ? W[b - 32] || 556 : 556); } return w * size / 1000; }
/* WinAnsi (cp1252) byte for a character; '?' when the standard fonts don't have it */
const RX_CP = { 0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159 };
function rxByte(ch) { const u = ch.codePointAt(0); if (u >= 32 && u < 127) return u; if (u >= 160 && u <= 255) return u; return RX_CP[u] || 63; }
function rxText(s) { let o = ''; for (const ch of String(s == null ? '' : s)) { if (ch === '?' || rxByte(ch) !== 63) { o += ch; continue; } const b = ch.normalize('NFD').charAt(0); o += b && b !== ch && rxByte(b) !== 63 ? b : '?'; } return o; }
/* shrink to fit the line (down to 6 pt), then cut with … */
function rxFit(s, font, size, maxW) {
  s = rxText(String(s || '').replace(/\s+/g, ' ').trim()); let z = size;
  while (z > 6 && rxWidth(s, font, z) > maxW) z -= .25;
  if (rxWidth(s, font, z) > maxW) { while (s.length > 1 && rxWidth(s + '…', font, z) > maxW) s = s.slice(0, -1); s += '…'; }
  return { s, z };
}
/* the filled-in form: the header both forms share, then the form's own circles and blanks (K.fill), then the special
   instructions; circ = grid labels to ring ([grid, tooth]) */
function rxFill(c, rx) {
  rx = rxCanon(rx); const K = rxK(rx), F = RX_FORMS[K.form], o = rxOffice(), T = F.text, txt = [], box = new Set(), circ = [];
  const put = (k, v, font, size) => { v = String(v || '').trim(); if (!v || !T[k]) return; const f = rxFit(v, font || 'H', size || 10, T[k].x1 - T[k].x0); txt.push({ x: T[k].x0, y: T[k].y + 2.2, s: f.s, z: f.z, font: font || 'H' }); };
  put('doctor', o.doctor); put('acct', o.acct); put('address', o.address); put('city', o.city); put('state', o.state); put('zip', o.zip); put('phone', o.phone); put('email', o.email);
  put('patient', c.patient, 'B', 10.5);
  put('shipped', usDate(rx.shipped || todayISO())); put('needed', usDate(rxNeeded(c, rx)), 'B');
  put('sig', o.sig, 'T', 12); put('license', o.license); put('licExp', o.licExp);
  const sc = String(c.scanner || '').trim(), onForm = K.scanners.find(x => x[1].test(sc));
  if (onForm) box.add('scan.' + onForm[0]); else if (sc) { box.add('scan.other'); if (!/^other$/i.test(sc)) put('scanOther', sc, 'H', 9); } // Allied Star → Other: Allied Star
  if (rx.rush) box.add('rush');
  K.fill(c, rx, put, box, circ);
  // special instructions on the form's three lines (smaller and more lines if it's long)
  // (at most 7 lines: many short lines are joined with " · ", and what still doesn't fit ends in …)
  const notes = [];
  if (rx.notes) { const W = 556, L = F.notes;
    const wrap = (pars, z) => { const lines = []; pars.forEach(par => { let cur = ''; par.split(' ').forEach(w => { const t = cur ? cur + ' ' + w : w; if (rxWidth(t, 'H', z) <= W) cur = t; else { if (cur) lines.push(cur); cur = w; } }); lines.push(cur); }); return lines; };
    const lay = pars => { let z = 10, lines = wrap(pars, z); while (lines.length > 3 && z > 6.5) { z -= .5; lines = wrap(pars, z); } return { z, lines }; };
    const pars = rx.notes.split('\n').map(rxText); let { z, lines } = lay(pars);
    if (lines.length > 7) ({ z, lines } = lay([pars.join(' · ')]));
    if (lines.length > 7) { lines = lines.slice(0, 7); let l = lines[6]; while (l.length > 1 && rxWidth(l + ' …', 'H', z) > W) l = l.slice(0, -1); lines[6] = l + ' …'; }
    const n = lines.length, step = n <= 3 ? L[0] - L[1] : (L[0] - L[2] + 17.5) / n;
    lines.forEach((l, i) => notes.push({ x: 26, y: (n <= 3 ? L[i] : L[0] + 3 - i * step) + 2, s: rxFit(l, 'H', z, W).s, z, font: 'H' }));
  }
  return { form: K.form, txt: txt.concat(notes), box: Array.from(box).filter(k => F.boxes[k]), circ: circ.filter(([g, id]) => F.grid[g] && F.grid[g][id]), arch: rxArchList(rx, c) };
}

/* ---------- drawing it: SVG (screen) and PDF operators (the file) — the same shapes for both ---------- */
const rxN = v => Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '0';
function rxD(ops) { return ops.map(o => o[0] + o.slice(1).map(rxN).join(' ')).join(''); }
/* a shape: { d: path ops, f: fill, s: stroke, w: stroke width, dash: [on, off] } */
function rxSvgShapes(list) {
  return list.map(it => '<path d="' + rxD(it.d) + '" fill="' + (it.f || 'none') + '"' + (it.s && it.w ? ' stroke="' + it.s + '" stroke-width="' + it.w + '" stroke-linecap="round" stroke-linejoin="round"' + (it.dash ? ' stroke-dasharray="' + it.dash.map(rxN).join(' ') + '"' : '') : '') + '/>').join('');
}
const rxRgb = hex => [1, 3, 5].map(i => rxN(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
function rxPdfShapes(list) {
  return list.map(it => {
    const path = it.d.map(o => o[0] === 'M' ? rxN(o[1]) + ' ' + rxN(o[2]) + ' m' : o[0] === 'L' ? rxN(o[1]) + ' ' + rxN(o[2]) + ' l' : o[0] === 'C' ? o.slice(1).map(rxN).join(' ') + ' c' : 'h').join('\n');
    const dash = it.s && it.w && it.dash, st = it.s && it.w ? rxRgb(it.s) + ' RG ' + rxN(it.w) + ' w\n' + (dash ? '[' + it.dash.map(rxN).join(' ') + '] 0 d\n' : '') : '', fl = it.f ? rxRgb(it.f) + ' rg\n' : '';
    return st + fl + path + '\n' + (it.f && st ? 'B' : it.f ? 'f' : 'S') + (dash ? '\n[] 0 d' : '');
  }).join('\n');
}
/* the circles on the grid labels the form's teeth (a pen circling the tooth) */
function rxGridOval(rect) { const [x0, y0, x1, y1] = rect, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; return { cx, cy, rx: (x1 - x0) / 2 + 3.4, ry: 6.2 }; }
function rxPdfString(s) { let o = ''; for (const ch of s) { const b = rxByte(ch); o += b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b < 127 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0'); } return '(' + o + ')'; }
function rxContent(fill) {
  const F = RX_FORMS[fill.form] || RXF, ink = rxRgb(RX_INK), out = ['q', '1 J 1 j', ink + ' rg ' + ink + ' RG'];
  const font = { H: '/NLOH', B: '/NLOB', T: '/NLOT' };
  fill.txt.forEach(t => out.push('BT ' + font[t.font] + ' ' + rxN(t.z) + ' Tf 1 0 0 1 ' + rxN(t.x) + ' ' + rxN(t.y) + ' Tm ' + rxPdfString(t.s) + ' Tj ET'));
  fill.box.forEach(k => { const [cx, cy] = F.boxes[k]; out.push(rxPdfShapes([{ d: RXP.circle(cx, cy, 2.75), f: RX_INK }])); });
  fill.circ.forEach(([g, id]) => { const e = rxGridOval(F.grid[g][id]); out.push(rxPdfShapes([{ d: RXP.ellipse(e.cx, e.cy, e.rx, e.ry), s: RX_INK, w: 1.1 }])); });
  if (fill.arch.length) { const [x, y, w, h] = F.clip; out.push('q 1 0 0 -1 0 792 cm ' + [x, y, w, h].map(rxN).join(' ') + ' re W n', rxPdfShapes(fill.arch), 'Q'); }
  out.push('Q');
  return out.join('\n') + '\n';
}
/* Specialty's blank form + one appended object (the first page's last, empty content stream, now filled): an incremental update */
const RX_TPL = {};
function rxPdfBytes(fill) {
  const F = (RX_FORMS[fill.form] || RXF).pdf, tpl = RX_TPL[fill.form] || (RX_TPL[fill.form] = unb64(F.b64));
  const body = TE.encode(rxContent(fill)), head = TE.encode('\n' + F.obj + ' 0 obj\n<< /Length ' + body.length + ' >>\nstream\n'), tail = TE.encode('\nendstream\nendobj\n');
  const start = tpl.length + 1, xat = tpl.length + head.length + body.length + tail.length;
  const xref = TE.encode('xref\n0 1\n0000000000 65535 f \n' + F.obj + ' 1\n' + String(start).padStart(10, '0') + ' 00000 n \ntrailer\n<< /Size ' + F.size + ' /Root ' + F.root + ' /Prev ' + F.xref + (F.id ? ' /ID [' + F.id + ']' : '') + ' >>\nstartxref\n' + xat + '\n%%EOF\n');
  const out = new Uint8Array(tpl.length + head.length + body.length + tail.length + xref.length); let at = 0;
  [tpl, head, body, tail, xref].forEach(part => { out.set(part, at); at += part.length; });
  return out;
}
function rxFileName(c, rx) { return (rxK(rx).title + ' - ' + String(c.patient || 'patient').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + ' - ' + todayISO() + '.pdf'); }
const RX_URLS = new Set();
function rxBlobUrl(c, rx) { const u = URL.createObjectURL(new Blob([rxPdfBytes(rxFill(c, rx))], { type: 'application/pdf' })); RX_URLS.add(u); return u; }
function rxRevoke(u) { if (RX_URLS.delete(u)) URL.revokeObjectURL(u); }
function rxDownload(c, rx) {
  const url = rxBlobUrl(c, rx), a = document.createElement('a'), name = rxFileName(c, rx); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => rxRevoke(url), 60000);
  toast('Downloaded ' + name + ' — upload it to Specialty with the scan');
}
/* open it in a new tab to look at or print (if the browser blocks the tab, it downloads instead) */
function rxOpenPdf(c, rx) { const url = rxBlobUrl(c, rx), w = window.open(url, '_blank'); if (!w) { rxRevoke(url); rxDownload(c, rx); } else setTimeout(() => rxRevoke(url), 120000); }

/* ---------- the arch picture in the app (Specialty's own outlines; the appliance and drawings on top) ---------- */
function rxArchSVG(rx, opts) {
  opts = opts || {}; rx = rxCanon(rx); const K = rxK(rx), F = RX_FORMS[K.form], VB = F.vb, live = !!opts.live;
  let s = '<svg class="rxArch' + (live ? ' live' : '') + '" viewBox="' + VB.join(' ') + '" role="group" aria-label="Specialty’s arch diagram (R is the patient’s right)">';
  s += '<rect x="' + VB[0] + '" y="' + VB[1] + '" width="' + VB[2] + '" height="' + VB[3] + '" fill="#fff"/>';
  ['R', 'L'].forEach(k => { const r = F.rl[k]; if (r) s += '<text x="' + rxN((r[0] + r[2]) / 2) + '" y="' + rxN(r[3] - 2.5) + '" class="rxRL">' + k + '</text>'; });
  F.front.U.concat(F.front.L).forEach(d => { s += '<path class="rxTo" d="' + d + '"/>'; });
  Object.keys(F.teeth).forEach(id => { const g = K.tappable(id), tip = K.tip(id, rx);
    s += '<g class="rxTooth' + (g ? ' g' : '') + '" data-rxt="' + id + '"' + (live && g ? ' role="button" tabindex="0" aria-label="' + esc(tip) + '"' : '') + '><title>' + esc(tip) + '</title><path class="rxTo" d="' + F.teeth[id].d + '"/></g>'; });
  s += '<g class="rxDraw" pointer-events="none">' + rxSvgShapes(rxArchList(rx, opts.c)) + '</g><g class="rxLive" pointer-events="none"></g></svg>';
  return s;
}
/* the whole page: the grey picture of Specialty's blank form (loaded only now) with everything filled in on top. The picture's
   address is set after render (rxPaperPaint): Chrome's look-ahead scanner fetches any picture address written into an img tag in the page's script text */
function rxPaperHTML(c, rx) {
  const f = rxFill(c, rx), F = RX_FORMS[f.form], font = { H: 'Helvetica,Arial,sans-serif', B: 'Helvetica,Arial,sans-serif', T: '"Times New Roman",Times,serif' };
  let s = '<div class="rxPaper"><img class="rxPaperImg" data-form="' + f.form + '" alt="" width="612" height="792" draggable="false"><svg viewBox="0 0 612 792" aria-hidden="true">';
  f.txt.forEach(t => { s += '<text x="' + rxN(t.x) + '" y="' + rxN(792 - t.y) + '" font-size="' + rxN(t.z) + '" font-family=\'' + font[t.font] + '\'' + (t.font === 'B' ? ' font-weight="700"' : t.font === 'T' ? ' font-style="italic"' : '') + ' fill="' + RX_INK + '">' + esc(t.s) + '</text>'; });
  f.box.forEach(k => { const [cx, cy] = F.boxes[k]; s += '<circle cx="' + cx + '" cy="' + rxN(792 - cy) + '" r="2.75" fill="' + RX_INK + '"/>'; });
  f.circ.forEach(([g, id]) => { const e = rxGridOval(F.grid[g][id]); s += '<ellipse cx="' + rxN(e.cx) + '" cy="' + rxN(792 - e.cy) + '" rx="' + rxN(e.rx) + '" ry="' + e.ry + '" fill="none" stroke="' + RX_INK + '" stroke-width="1.1"/>'; });
  const [x, y, w, h] = F.clip;
  s += '<clipPath id="rxClip"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/></clipPath><g clip-path="url(#rxClip)">' + rxSvgShapes(f.arch) + '</g></svg></div>';
  return s;
}
function rxPaperPaint(box) { const im = box && $('img.rxPaperImg', box); if (im && !im.getAttribute('src')) im.src = (RX_FORMS[im.dataset.form] || RXF).preview; }

/* ---------- the Rx editor: tap the choices, tap teeth, draw; the paper and the estimate follow along ---------- */
const RXE = { rx: null, c: null, done: null, tool: 'band', col: 'r', tab: 'arch', stroke: null, clearArm: 0, k: null, F: null }; // hand drawings start in red
function rxDefaultsAll() { try { const o = JSON.parse((S.settings || {}).rxDefaults || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
/* Dr. A's usual choices for a form (Herbst unless asked), when he's saved some */
function rxDefaults(form) { form = form || RX_FORM; const o = rxDefaultsAll()[form]; return o && typeof o === 'object' ? rxCanon(Object.assign({}, o, { form })) : null; }
/* a new Rx for the case on a form (Herbst unless asked) */
function rxStart(c, form) { return rxK(form || RX_FORM).start(c); }
const rxBtn = (g, v, l, on, price) => '<button type="button" class="rxB" data-rxg="' + g + '" data-v="' + esc(v) + '" aria-pressed="' + !!on + '"><span>' + esc(l) + '</span>' + (price ? '<em>' + esc(price) + '</em>' : '') + '</button>';
const rxField = (k, l, type, extra) => '<label class="rxF"><span>' + l + '</span><input data-rxf="' + k + '" type="' + (type || 'text') + '"' + (extra || '') + '></label>';
function rxEditor(c, rx, onDone, form) {
  const K = rxK(form || (rx && rx.form) || RX_FORM);
  RXE.k = K; RXE.F = RX_FORMS[K.form]; RXE.c = c; RXE.rx = rxCanon(rx && !rxEmpty(rx) ? Object.assign({}, rx, { form: K.form }) : K.start(c)); RXE.done = onDone; RXE.tab = 'arch'; RXE.stroke = null; RXE.orig = JSON.stringify(RXE.rx);
  if (!K.tools.includes(RXE.tool) && !RX_DRAWS.includes(RXE.tool)) RXE.tool = K.tool0;
  RXE.ret = document.activeElement;
  const old = $('#rxWrap'); if (old) old.remove();
  const w = document.createElement('div'); w.id = 'rxWrap'; w.dataset.form = K.form;
  const lg = typeof LOGOS !== 'undefined' && LOGOS['lab-specialty'];
  w.innerHTML = '<div class="rxBox" role="dialog" aria-modal="true" aria-labelledby="rxTitle">' +
    '<div class="rxHd">' + (lg ? '<img class="rxLogo" data-logo="lab-specialty" alt="Specialty Appliances" width="' + lg.w + '" height="' + lg.h + '">' : '') +
      '<div class="rxHdT"><h3 id="rxTitle">' + esc(K.title) + '</h3><span>' + esc(c.patient || 'New case') + ' · fills in Specialty’s own form</span></div>' +
      '<span class="rxTot" id="rxTot"></span>' +
      '<button type="button" class="btn btn-sec btn-sm" data-rxa="open">' + ic('ext', 15) + 'Open PDF</button><button type="button" class="btn btn-sec btn-sm" data-rxa="dl">' + ic('download', 15) + 'Download</button>' +
      '<button type="button" class="btn btn-teal btn-sm" data-rxa="done">' + ic('done', 15) + 'Done</button><button type="button" class="iconBtn" data-rxa="close" aria-label="Close without saving">' + ic('x') + '</button></div>' +
    '<div class="rxBd"><div class="rxL" id="rxL">' + rxLeftHTML() + '</div>' +
      '<div class="rxR"><div class="rxTabs" role="tablist"><button type="button" role="tab" data-rxtab="arch" aria-selected="true">Arches</button><button type="button" role="tab" data-rxtab="paper" aria-selected="false">The paper</button></div>' +
        '<div class="rxPane" id="rxArchPane">' + rxToolsHTML() + '<div class="rxArchBox" id="rxArchBox" style="--ar:' + RXE.F.vb[2] + '/' + RXE.F.vb[3] + '"></div><div class="rxHint" id="rxHint"></div></div>' +
        '<div class="rxPane" id="rxPaperPane" hidden><div id="rxPaperBox"></div><div class="small muted" style="margin-top:6px">Exactly what the PDF shows. Click the page to open it.</div></div></div></div></div>';
  document.body.appendChild(w); logoPaint(w);
  RXE.inert = Array.from(document.body.children).filter(el => el !== w && el.id !== 'toasts' && !el.inert); RXE.inert.forEach(el => { el.inert = true; });
  w.addEventListener('click', rxOnClick); w.addEventListener('input', rxOnInput); w.addEventListener('change', rxOnInput);
  w.addEventListener('mouseover', rxInfoHover); w.addEventListener('focusin', rxInfoHover);
  w.addEventListener('keydown', e => { const g = e.target.closest && e.target.closest('.rxArch.live .rxTooth.g'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); rxTapTooth(g.dataset.rxt); } });
  rxSync(true);
  const f = $('.rxB', w); if (f) f.focus({ preventScroll: true }); // (on a phone the arches stay in view at the top)
}
/* locking the app (lockOut) closes the Rx and forgets the case it was for */
function rxUninert() { (RXE.inert || []).forEach(el => { el.inert = false; }); RXE.inert = null; }
function rxReset() { const w = $('#rxWrap'); if (w) w.remove(); rxUninert(); RX_URLS.forEach(u => URL.revokeObjectURL(u)); RX_URLS.clear(); Object.assign(RXE, { rx: null, c: null, done: null, stroke: null, orig: null, ret: null }); }
function rxClose(save) {
  const w = $('#rxWrap'); if (!w) return;
  const done = RXE.done, rx = rxEmpty(RXE.rx) ? '' : rxCanon(RXE.rx); w.remove(); rxUninert(); RXE.done = null;
  if (RXE.ret && RXE.ret.isConnected) try { RXE.ret.focus(); } catch (e) { }
  if (save && done) done(rx);
}
const rxToolBtn = (k, l, tip) => '<button type="button" class="rxTool" data-rxtool="' + k + '" title="' + esc(tip) + '"><i class="rxTi rxTi-' + k + '"></i>' + esc(l) + '</button>';
function rxToolsHTML() {
  const t = rxToolBtn;
  return '<div class="rxTools"><div class="rxTg"><span>Tap teeth</span>' + RXE.k.toolsHTML() + '</div>' +
    '<div class="rxTg"><span>Draw</span>' + t('pen', 'Pen', 'Draw freehand on the arches') + t('line', 'Line', 'A straight line') + t('arrow', 'Arrow', 'An arrow (where the line ends)') +
    Object.keys(RX_DRAW_COL).map(k => '<button type="button" class="rxCol" data-rxcol="' + k + '" style="--c:' + RX_DRAW_COL[k] + '" aria-label="' + ({ b: 'Blue', r: 'Red', k: 'Black' }[k]) + ' pen"></button>').join('') +
    '<button type="button" class="rxTool sm" data-rxa="undo" title="Take back the last drawing">Undo</button><button type="button" class="rxTool sm" data-rxa="clearDraw">Clear drawing</button></div>' +
    '<label class="rxAuto"><input type="checkbox" data-rxa="auto"> Draw the appliance from the choices</label></div>';
}
/* ---------- the cards that explain a form's options (point at one, tab to it or tap it), and Compare all ---------- */
function rxInfoName(g, v) { const K = RXE.k, it = K.info[g][v] || {}; return it.name || K.infoName(g, v); }
function rxInfoTag(g, v) { return RXE.k.infoTag(g, v); }
/* the option the card shows when nothing is pointed at: the one picked */
function rxInfoSel(g) { return RXE.k.infoSel(g, RXE.rx || {}); }
/* an option's picture (its `pic`, Amir's, 4 Oct 2026): on the right of its card and small under its name in Compare all; the
   image itself is set once the card is on the page (picPaint, like the tile pictures) */
function rxInfoPic(it, cls) {
  const pc = it && it.pic && typeof PICS !== 'undefined' && PICS[it.pic];
  return pc ? '<div class="' + cls + '"><img data-pic="' + esc(it.pic) + '" width="' + pc.w + '" height="' + pc.h + '" alt="" draggable="false"></div>' : '';
}
function rxInfoBody(g, v) {
  const K = RXE.k, it = K.info[g][v], tag = rxInfoTag(g, v);
  return rxInfoPic(it, 'rxIcPic') + '<div class="rxIcHd"><b>' + esc(rxInfoName(g, v)) + '</b>' + (tag ? '<em>' + esc(tag) + '</em>' : '') + '</div><p>' + esc(it.sum) + '</p>' +
    (it.pts ? '<ul>' + it.pts.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + (it.note ? '<div class="rxIcNote">' + esc(it.note) + '</div>' : '') +
    (it.src ? '<div class="rxIcSrc">' + it.src.map(k => '<a href="' + esc(K.src[k][1]) + '" target="_blank" rel="noopener noreferrer">' + esc(K.src[k][0]) + '</a>').join(' · ') + '</div>' : '');
}
/* every option's text sits in the card at once, stacked in one grid cell with only one shown: the card is always as tall as the
   longest, so pointing at another choice never moves the buttons under the pointer */
function rxInfoCardHTML(g) {
  const K = RXE.k;
  return '<div class="rxInfoCard" data-info="' + g + '" role="note">' + K.infoKeys(g).map(k => '<div class="rxIc" data-k="' + k + '">' + rxInfoBody(g, k) + '</div>').join('') +
    '<div class="rxIc" data-k=""><span class="muted">Point at ' + esc(K.infoPrompt(g)) + ' (or tap one) to see what it is and how it differs' + (K.cmpKeys(g) ? ' — or Compare all' : '') + '.</span></div></div>';
}
function rxInfoPaint(card, g, v, hover) {
  v = v && RXE.k.info[g][v] ? v : ''; card.dataset.hover = hover ? '1' : ''; card.dataset.show = v;
  if (v) card.classList.add('grown'); // (a card is one line until it first shows an option; from then on it keeps its full height)
  card.classList.toggle('peek', !!hover && v !== rxInfoSel(g));
  $$('.rxIc', card).forEach(x => x.classList.toggle('on', x.dataset.k === v));
}
/* pointing at (or tabbing to) a choice shows it; leaving goes back to the one picked; reading the card keeps it */
function rxInfoHover(e) {
  const K = RXE.k; if (!K || !e.target.closest || e.target.closest('.rxInfoCard, .rxCmpBox')) return;
  const row = e.target.closest('[data-rxinfo]'), b = e.target.closest('.rxB[data-rxg]');
  const hit = row ? row.dataset.rxinfo.split(':') : b ? K.infoOf(b) : null, hg = hit && K.info[hit[0]] && K.info[hit[0]][hit[1]] ? hit[0] : null, hv = hg ? hit[1] : '';
  $$('#rxWrap .rxInfoCard').forEach(card => { const g = card.dataset.info;
    if (g === hg) { if (card.dataset.show !== hv || card.dataset.hover !== '1') rxInfoPaint(card, g, hv, true); }
    else if (card.dataset.hover === '1') rxInfoPaint(card, g, rxInfoSel(g), false); });
}
function rxCmpHTML(g) {
  return '<div class="rxCmp">' + RXE.k.cmpKeys(g).map(k =>
    '<div class="rxCmpRow"><div class="rxCmpN"><b>' + esc(rxInfoName(g, k)) + '</b>' + rxInfoPic(RXE.k.info[g][k], 'rxCmpPic') + '</div><span>' + esc(RXE.k.info[g][k].short) + '</span><em>' + esc(rxInfoTag(g, k)) + '</em></div>').join('') + '</div>';
}
/* a section with Compare all on its heading (when the form has a comparison for it) and the card under its choices */
function rxInfoSec(g, title, choices, after) {
  return '<section class="rxS"><h5>' + esc(title) + (RXE.k.cmpKeys(g) ? '<button type="button" class="rxCmpBtn" data-rxa="cmp" data-g="' + g + '" aria-expanded="false">Compare all</button>' : '') + '</h5>' + choices +
    rxInfoCardHTML(g) + '<div class="rxCmpBox" data-cmp="' + g + '" hidden></div>' + (after || '') + '</section>';
}
function rxSec(title, body, note) { return '<section class="rxS"><h5>' + esc(title) + (note ? ' <span class="h5n">' + esc(note) + '</span>' : '') + '</h5>' + body + '</section>'; }
function rxLeftHTML() {
  const K = RXE.k, rx = RXE.rx, c = RXE.c, o = rxOffice(), miss = rxOfficeMissing();
  const need = rxNeedAuto(c);
  return '<div class="rxInfo"><div><b>' + esc(c.patient || 'Patient name') + '</b> · ' + esc(c.scanner ? 'Scanned with ' + c.scanner : 'No scanner picked') + (c.deliveryDate ? ' · Delivery appt ' + esc(fmtDay(c.deliveryDate)) : '') + '</div>' +
      '<div class="small">' + esc(o.doctor || 'Doctor') + ' · Acct # ' + esc(o.acct || '—') + ' · License # ' + esc(o.license || '—') + '</div>' +
      (miss.length ? '<div class="rxWarn small">' + (isOwner() ? 'Add the ' + esc(miss.join(', ')) + ' once in Team & security → Lab Rx; every Rx fills them in.' : 'Dr. A still needs to add the ' + esc(miss.join(', ')) + ' (Team & security → Lab Rx).') + '</div>' : '') + '</div>' +
    rxSec('Dates', '<div class="rxRow">' + rxField('needed', 'Date needed', 'date') + rxField('shipped', 'Date shipped', 'date') + '</div><div class="small muted" id="rxNeedHint">' + (need ? 'Filled in: ' + (c.labDate ? 'the case’s lab completion date' : 'the office day before the delivery appt') + ' (' + esc(fmtDay(need)) + ').' : 'Add the delivery appt to the case (or type the date) — Specialty needs it at least a day before the appointment.') + '</div><div class="rxWarn small" id="rxLead" hidden></div>' +
      '<div class="rxBs">' + rxBtn('flag', 'rush', 'Approval to charge expedited manufacturing and shipping', rx.rush, rxTag('rush', true)) + '</div>') +
    K.secHTML(rx, c) +
    rxSec('Special instructions', '<textarea data-rxf="notes" rows="3" maxlength="600" placeholder="Anything else for Specialty (three lines on the form)"></textarea>') +
    '<section class="rxS rxCost"><h5>Lab cost estimate <span class="h5n">' + esc(RX_PRICE_SRC) + '</span></h5><div id="rxCost"></div></section>' +
    '<div class="rxFt">' + (isOwner() ? '<button type="button" class="btn btn-sec btn-sm" data-rxa="saveDef" title="' + esc(K.saveDefTip) + '">Save as ' + esc(K.usual) + '</button>' : '') +
      (rxDefaults(K.form) ? '<button type="button" class="btn btn-ghost btn-sm" data-rxa="useDef">Start from ' + esc(K.usual) + '</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-rxa="clearAll" style="color:var(--coral-700)">Clear the Rx</button></div>';
}
function rxCostHTML(rx, c) {
  const e = rxEstimate(rx, c);
  if (!e.lines.length && !e.missing.length) return '<div class="small muted">' + esc(rxK(rx).costEmpty) + '</div>';
  return '<table class="rxTbl">' + e.lines.map(x => '<tr><td>' + esc(x.l) + (x.note ? '<span class="rxNote">' + esc(x.note) + '</span>' : '') + '</td><td>' + (x.inc ? '<span class="muted">' + esc(x.inc) + '</span>' : (x.qty > 1 ? '<span class="muted">' + x.qty + ' × ' + money(x.each) + '</span> ' : '') + money(x.amt)) + '</td></tr>').join('') +
    '<tr class="rxTotRow"><td>Total</td><td>' + money(e.total) + '</td></tr></table>' +
    (e.missing.length ? '<div class="small rxMiss">Not priced, so not in the total: ' + esc(e.missing.join('; ')) + '.</div><div class="small muted">Not on Specialty’s price list (or no price entered). Dr. A can add a price in Team & security → Lab Rx.</div>' : '') +
    '<div class="small muted">Shipping is billed by Specialty by zone and weight, so it isn’t included.</div>';
}
/* a box's value when the Rx hasn't one of its own: the date needed and shipped, and anything the form fills from the case */
function rxAutoVal(k, c, rx) { return k === 'needed' ? rxNeedAuto(c) : k === 'shipped' ? todayISO() : RXE.k && RXE.k.autoVal && RXE.k.autoVal[k] ? RXE.k.autoVal[k](c, rx) : ''; }
function rxIsAuto(k) { return k === 'needed' || k === 'shipped' || !!(RXE.k && RXE.k.autoVal && RXE.k.autoVal[k]); }
/* is a button on? on/off choices, one-answer groups, lists — or the form's own rule */
function rxPressed(g, v, rx) {
  const K = RXE.k, own = K.pressed && K.pressed(g, v, rx);
  return own != null ? own : g === 'flag' ? rx[v] === true : K.single.includes(g) ? rx[g] === v : (rx[g] || []).includes(v);
}
/* redraw everything that follows the choices (the left side's buttons stay put, so typing never loses its place) */
function rxSync(first) {
  const w = $('#rxWrap'); if (!w) return; const K = RXE.k, rx = RXE.rx = rxCanon(RXE.rx), c = RXE.c;
  if (first) picPaint(w); // the options' pictures in their cards
  $$('[data-rxf]', w).forEach(i => { if (!first && i === document.activeElement) return; const k = i.dataset.rxf; i.value = rx[k] || (rxIsAuto(k) ? rxAutoVal(k, c, rx) : ''); });
  if (first) $$('[data-rxtab]', w).forEach(b => b.setAttribute('aria-selected', String(b.dataset.rxtab === RXE.tab)));
  $$('.rxSub[data-show]', w).forEach(s => { s.hidden = !K.subShow(s.dataset.show, rx); });
  // the buttons and boxes always show what the Rx holds (turning a choice off drops what went with it); a box being typed in is left alone
  $$('.rxB[data-rxg]', w).forEach(b => { const g = b.dataset.rxg; if (g === 'tool') return; b.setAttribute('aria-pressed', String(!!rxPressed(g, b.dataset.v, rx))); });
  $$('.rxB[data-rxg="tool"]', w).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === RXE.tool)));
  $$('[data-rxtool]', w).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rxtool === RXE.tool)));
  $$('[data-rxcol]', w).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rxcol === RXE.col)));
  const au = $('[data-rxa="auto"]', w); if (au) au.checked = !rx.noAuto;
  const box = $('#rxArchBox', w); box.innerHTML = rxArchSVG(rx, { live: true, c }); const svg = $('svg', box);
  svg.classList.toggle('drawing', RX_DRAWS.includes(RXE.tool)); rxWireArch(svg);
  $('#rxHint', w).textContent = RX_DRAWS.includes(RXE.tool) ? 'Drag on the arches to draw. It prints on the PDF.' : K.hint(RXE.tool);
  const ts = $('#rxTeethSum', w); if (ts) ts.innerHTML = K.teethSum(rx);
  $('#rxCost', w).innerHTML = rxCostHTML(rx, c);
  $$('.rxInfoCard', w).forEach(card => { if (card.dataset.hover !== '1') rxInfoPaint(card, card.dataset.info, rxInfoSel(card.dataset.info), false); });
  const e = rxEstimate(rx, c); $('#rxTot', w).innerHTML = e.lines.length ? 'Est. <b>' + money(e.total) + '</b>' + (e.missing.length ? '<span>+ ' + e.missing.length + ' not listed</span>' : '') : '';
  // Specialty asks for 10 business days (some items less); sooner needs the expedite approval
  const days = K.leadDays(rx), need = rxNeeded(c, rx), lead = $('#rxLead', w), soon = need && need < addBusinessDays(todayISO(), days);
  lead.hidden = !soon || !!rx.rush; lead.textContent = soon ? 'Needed ' + fmtDay(need) + ' — sooner than the ' + days + ' business days Specialty asks for. Tick the expedite approval if it can’t wait.' : '';
  if (K.syncMore) K.syncMore(w, rx, c);
  if (RXE.tab === 'paper') { $('#rxPaperBox', w).innerHTML = rxPaperHTML(c, rx); rxPaperPaint($('#rxPaperBox', w)); }
  $('#rxArchPane', w).hidden = RXE.tab !== 'arch'; $('#rxPaperPane', w).hidden = RXE.tab !== 'paper';
}
function rxTapTooth(id) {
  if (!RXE.k.tap(id, RXE.rx, RXE.tool)) return;
  rxSync();
  const g = $('#rxArchBox .rxTooth[data-rxt="' + id + '"]'); if (g && document.activeElement === document.body) g.focus();
}
/* a pen stroke with fewer points that looks the same (Ramer–Douglas–Peucker, eps in tenths of a point), at most RX_MAX_PTS */
function rxSimplify(p, eps) {
  const n = p.length / 2; if (n <= 2) return p.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const st = [[0, n - 1]];
  while (st.length) { const [a, b] = st.pop(), ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1], L = Math.hypot(bx - ax, by - ay) || 1; let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - p[2 * i + 1]) - (ax - p[2 * i]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } }
    if (mi > 0 && md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  let q = []; for (let i = 0; i < n; i++) if (keep[i]) q.push(p[2 * i], p[2 * i + 1]);
  if (q.length > RX_MAX_PTS * 2) { const m = q.length / 2, r = []; for (let i = 0; i < RX_MAX_PTS; i++) { const j = Math.round(i * (m - 1) / (RX_MAX_PTS - 1)); r.push(q[2 * j], q[2 * j + 1]); } q = r; }
  return q;
}
/* drawing on the arches: pointer positions in the form's own points */
function rxWireArch(svg) {
  const [cx, cy, cw, ch] = RXE.F.clip, cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const pt = e => { const m = svg.getScreenCTM(); if (!m) return null; const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(m.inverse());
    return [Math.round(cl(q.x, cx + 1, cx + cw - 1) * 10), Math.round(cl(q.y, cy + 1, cy + ch - 1) * 10)]; };
  const liveG = $('.rxLive', svg);
  const paint = () => { const s = RXE.stroke; if (!s) { liveG.innerHTML = ''; return; } liveG.innerHTML = rxSvgShapes(rxStrokes({ form: RXE.k.form, draw: [s] })); };
  svg.addEventListener('pointerdown', e => {
    const tool = RXE.tool; if (!RX_DRAWS.includes(tool) || e.button > 0) return;
    const p = pt(e); if (!p) return; e.preventDefault(); try { svg.setPointerCapture(e.pointerId); } catch (x) { }
    RXE.stroke = { t: tool, c: RXE.col, p: p.concat(p) }; paint();
  });
  svg.addEventListener('pointermove', e => {
    const s = RXE.stroke; if (!s) return; const p = pt(e); if (!p) return;
    if (s.t === 'pen') { const n = s.p.length; if (Math.hypot(p[0] - s.p[n - 2], p[1] - s.p[n - 1]) >= 8) s.p.push(p[0], p[1]); }
    else { s.p[2] = p[0]; s.p[3] = p[1]; }
    paint();
  });
  const end = () => { const s = RXE.stroke; RXE.stroke = null; if (!s) return;
    const long = s.p.length > 4 || Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) > 15;
    if (long && (RXE.rx.draw || []).length >= RX_MAX_STROKES) toast('That’s as many drawings as one Rx holds (' + RX_MAX_STROKES + ') — Undo or Clear drawing first', { bad: true });
    else if (long) { s.p = s.t === 'pen' ? rxSimplify(s.p, 2) : s.p.slice(0, 4); RXE.rx.draw = (RXE.rx.draw || []).concat([s]); }
    rxSync(); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
}
function rxOnInput(e) {
  const i = e.target.closest('[data-rxf]'); if (!i) return; const k = i.dataset.rxf, rx = RXE.rx;
  // a box that fills itself (the dates; the acrylic color from the case) keeps nothing of its own while it says the same
  if (rxIsAuto(k)) rx[k] = i.value && i.value !== rxAutoVal(k, RXE.c, rx) ? i.value : '';
  else rx[k] = i.value;
  if (e.type === 'change' && !i.value && rxIsAuto(k)) i.value = rxAutoVal(k, RXE.c, rx);
  if (k === 'notes' || e.type === 'change' || k === 'needed' || k === 'shipped') rxSync(); else { RXE.rx = rxCanon(rx); if (rx[k]) RXE.rx[k] = rx[k]; rxSyncLight(); }
}
/* while typing: just the paper and the estimate (the inputs keep their cursor) */
function rxSyncLight() { const w = $('#rxWrap'); if (!w) return; if (RXE.tab === 'paper') { $('#rxPaperBox', w).innerHTML = rxPaperHTML(RXE.c, RXE.rx); rxPaperPaint($('#rxPaperBox', w)); } $('#rxCost', w).innerHTML = rxCostHTML(RXE.rx, RXE.c); }
function rxOnClick(e) {
  const w = $('#rxWrap'), rx = RXE.rx, K = RXE.k;
  const b = e.target.closest('.rxB[data-rxg]');
  if (b) { const g = b.dataset.rxg, v = b.dataset.v, on = b.getAttribute('aria-pressed') !== 'true', prev = rx[g];
    if (g === 'tool') { RXE.tool = v; rxSync(); return; }
    if (K.click && K.click(g, v, on, rx)) { rxSync(); return; } // the form's own rule (e.g. clasps go on teeth)
    if (g === 'flag') rx[v] = on ? true : '';
    else if (K.single.includes(g)) { rx[g] = on ? v : ''; $$('.rxB[data-rxg="' + g + '"]', w).forEach(x => x.setAttribute('aria-pressed', String(x === b && on))); }
    else { const s = new Set(rx[g] || []); if (on) s.add(v); else s.delete(v); rx[g] = Array.from(s); }
    if (g === 'flag' || !K.single.includes(g)) b.setAttribute('aria-pressed', String(on));
    if (K.after) K.after(g, v, on, prev, rx, w);
    rxSync(); return; }
  const tool = e.target.closest('[data-rxtool]'); if (tool) { RXE.tool = tool.dataset.rxtool; rxSync(); return; }
  const col = e.target.closest('[data-rxcol]'); if (col) { RXE.col = col.dataset.rxcol; if (!RX_DRAWS.includes(RXE.tool)) RXE.tool = 'pen'; rxSync(); return; }
  const tab = e.target.closest('[data-rxtab]'); if (tab) { RXE.tab = tab.dataset.rxtab; $$('[data-rxtab]', w).forEach(x => x.setAttribute('aria-selected', String(x === tab))); rxSync(); return; }
  if (e.target.closest('.rxPaper')) { rxOpenPdf(RXE.c, RXE.rx); return; }
  const th = e.target.closest('#rxArchBox .rxTooth'); if (th) { if (!RX_DRAWS.includes(RXE.tool)) rxTapTooth(th.dataset.rxt); return; }
  const a = e.target.closest('[data-rxa]'); if (!a) return;
  switch (a.dataset.rxa) {
    case 'done': rxClose(true); break;
    case 'cmp': { const box = $('.rxCmpBox[data-cmp="' + a.dataset.g + '"]', w), open = box.hidden; box.hidden = !open; if (open) { box.innerHTML = rxCmpHTML(a.dataset.g); picPaint(box); }
      a.setAttribute('aria-expanded', String(open)); a.textContent = open ? 'Hide the comparison' : 'Compare all'; break; }
    case 'close': if (JSON.stringify(rxCanon(RXE.rx)) === RXE.orig || a.dataset.sure === '1') rxClose(false); else { a.dataset.sure = '1'; toast('Close without saving the Rx? Click × again — or Done to keep it'); setTimeout(() => { a.dataset.sure = ''; }, 4000); } break;
    case 'open': rxOpenPdf(RXE.c, RXE.rx); break;
    case 'dl': rxDownload(RXE.c, RXE.rx); break;
    case 'undo': rx.draw = (rx.draw || []).slice(0, -1); rxSync(); break;
    case 'clearDraw': if (!(rx.draw || []).length) break; if (RXE.clearArm > Date.now()) { rx.draw = []; RXE.clearArm = 0; a.textContent = 'Clear drawing'; rxSync(); } else { RXE.clearArm = Date.now() + 3000; a.textContent = 'Tap again to clear'; setTimeout(() => { a.textContent = 'Clear drawing'; }, 3000); } break;
    case 'auto': rx.noAuto = a.checked ? '' : true; rxSync(); break;
    case 'saveDef': { const d = rxCanon(rx); // (the usual is kept with its teeth: the same for most cases of the kind)
      K.defDrop.concat(['draw', 'needed', 'shipped', 'notes', 'rush', 'noAuto']).forEach(k => delete d[k]); if (K.defClean) K.defClean(d);
      const all = rxDefaultsAll(); all[K.form] = rxCanon(d);
      act(() => B.saveSettings({ rxDefaults: JSON.stringify(all) }), 'Saved as ' + K.usual + ' — new ' + K.title + ' start from it'); break; }
    case 'useDef': { const d = rxDefaults(K.form); if (!d) break; const keep = {}; K.defDrop.concat(['needed', 'shipped', 'notes', 'draw']).forEach(k => { if (rx[k] != null && rx[k] !== '') keep[k] = rx[k]; });
      const next = Object.assign({}, d, keep); if (K.defKeep) K.defKeep(rx, next); RXE.rx = rxCanon(next); $('#rxL', w).innerHTML = rxLeftHTML(); rxSync(true); toast('Started from ' + K.usual); break; }
    case 'clearAll': if (a.dataset.sure !== '1') { a.dataset.sure = '1'; a.textContent = 'Tap again to clear everything'; setTimeout(() => { a.dataset.sure = ''; a.textContent = 'Clear the Rx'; }, 3000); break; }
      RXE.rx = rxCanon({ form: K.form }); $('#rxL', w).innerHTML = rxLeftHTML(); rxSync(true); break;
  }
}
/* Esc closes the Rx (not the New case form under it) */
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#rxWrap')) { e.stopPropagation(); e.preventDefault(); const x = $('#rxWrap [data-rxa="close"]'); if (x) x.click(); } }, true);

/* ---------- in New case / Edit: each form's Rx shows once its appliance is going to Specialty ---------- */
function rxFormSecHTML(c) { return rxKinds().map(K => rxFormSecK(c, K)).join('') + '<div class="hint small rxFormHint" id="cf-rxHint" hidden></div>'; }
function rxFormSecK(c, K) {
  const rx = rxOfK(c, K), id = 'cf-' + K.field, lg = typeof LOGOS !== 'undefined' && LOGOS['lab-specialty'];
  return '<div class="rxFormSec" id="' + id + 'Sec" data-rxkind="' + K.key + '" hidden><input type="hidden" id="' + id + '" value="' + esc(rx ? JSON.stringify(rxCanon(Object.assign({}, rx, { form: K.form }))) : '') + '">' +
    '<div class="rxFormHd">' + (lg ? '<img data-logo="lab-specialty" width="' + lg.w + '" height="' + lg.h + '" alt="">' : '') +
    '<div style="flex:1;min-width:220px"><b>' + esc(K.title) + '</b><span class="rxFormSum" id="' + id + 'Sum"></span></div>' +
    '<span class="rxFormBtns"><button type="button" class="btn btn-pri btn-sm" data-rxform="edit" data-kind="' + K.key + '">' + ic('edit', 15) + '<span id="' + id + 'BtnL">Fill out the Rx</span></button>' +
    '<button type="button" class="btn btn-sec btn-sm" data-rxform="pdf" data-kind="' + K.key + '" title="Open the filled-in form">' + ic('ext', 15) + 'PDF</button></span></div></div>';
}
function rxReadForm(root, K) { K = K || RXK[RX_FORM]; const i = $('#cf-' + K.field, root); if (!i || !i.value) return null; try { return rxCanon(Object.assign(JSON.parse(i.value), { form: K.form })); } catch (e) { return null; } }
/* the Rx to save with the case: kept while its appliance goes to Specialty ('' otherwise, see FORM_KEYS) */
function rxFromForm(root, o, form) { const K = rxK(form || RX_FORM), sec = $('#cf-' + K.field + 'Sec', root); if (!sec || !K.applies(o)) return ''; const rx = rxReadForm(root, K); return rx && !rxEmpty(rx) ? rx : ''; }
function rxFormRefresh(root, o) {
  // an appliance one of the forms is for, going to another lab: one line saying the form is here for Specialty
  const hint = $('#cf-rxHint', root), off = o.type === 'appliance' && labName(o.lab) !== LAB_SPEC ? rxKinds().filter(K => (o.appliances || []).some(a => K.appl.includes(a))) : [];
  if (hint) { hint.hidden = !off.length; hint.textContent = off.length ? 'Going to Specialty instead? Tap Specialty Orthodontic Lab and its ' + off.map(K => K.title).join(' and ') + ' fills in from this case.' : ''; }
  rxKinds().forEach(K => {
    const id = 'cf-' + K.field, sec = $('#' + id + 'Sec', root); if (!sec) return; const on = K.applies(o); sec.hidden = !on; if (!on) return;
    const rx = rxReadForm(root, K), e = rx ? rxEstimate(rx, o) : null;
    $('#' + id + 'Sum', root).innerHTML = rx && !rxEmpty(rx) ? esc(rxSummary(rx)) + (e.lines.length ? ' · est. <b>' + money(e.total) + '</b>' : '') : 'Specialty’s form, filled in from this case — tap through it now or later from the case';
    $('#' + id + 'BtnL', root).textContent = rx && !rxEmpty(rx) ? 'Edit the Rx' : 'Fill out the Rx';
    logoPaint(sec);
  });
}
/* the case the Rx is for, as the form has it right now */
function rxFormCase(root) { const o = readCaseForm(root); return { patient: o.patient, scanner: o.scanner, deliveryDate: o.deliveryDate, labDate: o.labDate, appliances: o.appliances, lab: o.lab, type: o.type, arches: o.arches, acrylic: o.acrylic, glitter: o.glitter }; }
function rxFormClick(e, root) {
  const b = e.target.closest('[data-rxform]'); if (!b || !root.contains(b)) return false;
  const K = rxKind(b.dataset.kind), c = rxFormCase(root), cur = rxReadForm(root, K);
  if (b.dataset.rxform === 'pdf') { rxOpenPdf(c, cur || K.start(c)); return true; }
  rxEditor(c, cur, rx => { $('#cf-' + K.field, root).value = rx ? JSON.stringify(rx) : ''; rxFormRefresh(root, readCaseForm(root)); }, K.form);
  return true;
}
/* after New case: the Rx is ready to go to Specialty */
function rxCreatedToast(data) {
  if (!data) return;
  rxKinds().filter(K => data[K.field]).forEach((K, i) => setTimeout(() => toast(K.title + ' ready for Specialty', { action: 'Download PDF', ms: 12000, onAction: () => rxDownload(data, data[K.field]) }), 400 + i * 150));
}

/* ---------- the case's own Rx sections ---------- */
function rxCaseSecsHTML(c, done) { return rxKinds().filter(K => rxShowsK(c, K)).map(K => rxCaseSecK(c, done, K)).join(''); }
function rxCaseSecHTML(c, done) { return rxCaseSecK(c, done, RXK[RX_FORM]); }
function rxCaseSecK(c, done, K) {
  const rx0 = rxOfK(c, K), rx = rx0 ? rxCanon(Object.assign({}, rx0, { form: K.form })) : null, e = rx ? rxEstimate(rx, c) : null, kd = K.key === 'herbst' ? '' : ' data-kind="' + K.key + '"';
  const sum = rx ? esc(rxSummary(rx)) + (e.lines.length ? ' · est. <b>' + money(e.total) + '</b>' : '') : '<span class="muted">Not filled in yet</span>';
  const hdBtn = rx ? '<button type="button" class="btn btn-sec btn-sm dsAct" data-act="rxPdf"' + kd + ' title="Download the filled-in Rx">' + ic('download', 14) + 'PDF</button>' : '';
  const body = rx ? '<div class="rxCase"><div class="rxCaseArch">' + rxArchSVG(rx, { c }) + '</div><div class="rxCaseR"><div class="small">' + esc(rxSummary(rx)) + '</div>' +
      '<div class="small muted">' + (rxNeeded(c, rx) ? 'Needed by <b>' + esc(fmtDay(rxNeeded(c, rx))) + '</b>' : '<b class="rxNoDate">No date needed yet</b> — add the delivery appt, or a date in the Rx') + (rx.rush ? ' · expedited' : '') + '</div>' + (rx.notes ? '<div class="small" style="white-space:pre-wrap">' + esc(rx.notes) + '</div>' : '') +
      '<div class="rxCaseCost">' + rxCostHTML(rx, c) + '</div></div></div>' +
      '<div class="pickRow" style="margin-top:10px">' + (done ? '' : '<button type="button" class="btn btn-pri btn-sm" data-act="rxEdit"' + kd + '>' + ic('edit', 15) + 'Edit the Rx</button>') +
      '<button type="button" class="btn btn-sec btn-sm" data-act="rxOpen"' + kd + '>' + ic('ext', 15) + 'Open to print</button><button type="button" class="btn btn-sec btn-sm" data-act="rxPdf"' + kd + '>' + ic('download', 15) + 'Download PDF</button></div>'
    : '<div class="small muted" style="margin-bottom:8px">' + esc(K.caseIntro) + '</div>' +
      (done ? '' : '<button type="button" class="btn btn-pri btn-sm" data-act="rxEdit"' + kd + '>' + ic('edit', 15) + 'Fill out the Rx</button>');
  return dsec(K.ds, K.title + ' · Specialty', sum, body, hdBtn);
}
Object.assign(ADMIN_ACTS, {
  rxEdit(t) { const K = rxKind(t && t.dataset && t.dataset.kind), c = findCase(S.openId); if (!c) return; const id = c.id;
    rxEditor(c, rxOfK(c, K), rx => { const cur = findCase(id); if (!cur) return; const was = rxOfK(cur, K); if (JSON.stringify(rx || '') === JSON.stringify(was ? rxCanon(Object.assign({}, was, { form: K.form })) : '')) return;
      act(async () => { await B.mutateCase(id, d => { d[K.field] = rx || ''; }, { a: 'edit', fields: [K.field] }); const c2 = findCase(id); if (c2) c2[K.field] = rx || ''; if (S.openId === id && !S.editing) { renderDrawer(); loadHistory(id); } }, rx ? K.title + ' saved' : K.title + ' cleared'); }, K.form); },
  rxPdf(t) { const K = rxKind(t && t.dataset && t.dataset.kind), c = findCase(S.openId), rx = c && rxOfK(c, K); if (rx) rxDownload(c, Object.assign({}, rx, { form: K.form })); },
  rxOpen(t) { const K = rxKind(t && t.dataset && t.dataset.kind), c = findCase(S.openId), rx = c && rxOfK(c, K); if (rx) rxOpenPdf(c, Object.assign({}, rx, { form: K.form })); },
  rxPricesReset() { act(() => B.saveSettings({ rxPrices: '' }), 'Prices back to Specialty’s price list'); },
  rxDefClear(t) { const K = rxK((t && t.dataset && t.dataset.form) || RX_FORM), all = rxDefaultsAll(); delete all[K.form];
    act(() => B.saveSettings({ rxDefaults: Object.keys(all).length ? JSON.stringify(all) : '' }), K.usual.charAt(0).toUpperCase() + K.usual.slice(1) + ' cleared'); }
});

/* ---------- Team & security → Lab Rx: Dr. A's details on every Rx, the prices, the usual choices ---------- */
function rxPriceRows(P2, listed, list) {
  const rows = (list || RX_PRICES).filter(([, , p0]) => (p0 != null) === listed); if (!rows.length) return '';
  return '<div class="rxPriceGrid">' + rows.map(([k, l, p0]) => '<label class="rxPl"><span>' + esc(l) + (p0 != null && P2[k] !== p0 ? ' <em>(list ' + money(p0) + ')</em>' : '') + '</span>' +
    '<input type="number" min="0" step="0.01" inputmode="decimal" data-rxprice="' + k + '" value="' + (P2[k] == null ? '' : P2[k].toFixed(2)) + '"' + (listed ? '' : ' placeholder="—"') + ' aria-label="' + esc(l) + ' ($)"></label>').join('') + '</div>';
}
function rxAdminCardHTML() {
  const o = rxOffice(), P2 = rxPrices();
  const f = (k, l, ph, wide) => '<div class="field"' + (wide ? ' style="grid-column:1/-1"' : '') + '><label for="rxo-' + k + '">' + l + '</label><input id="rxo-' + k + '" data-rxoff="' + k + '" value="' + esc(o[k] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' autocomplete="off"></div>';
  const sub = t => '<div class="rxPh">' + esc(t) + '</div>';
  return '<div class="card" style="margin-top:18px" id="rxAdmin"><div class="cardHd"><h3>Lab Rx</h3><span class="sub">Filled in on every Rx for Specialty (Herbst, retainers)</span></div><div class="cardBd">' +
    '<div class="grid2">' + f('doctor', 'Doctor') + f('acct', 'Specialty account #', 'Your account number with Specialty') + f('address', 'Address', '', true) + f('city', 'City') +
      '<div class="grid2" style="gap:10px">' + f('state', 'State') + f('zip', 'ZIP') + '</div>' + f('phone', 'Phone') + f('email', 'Email', 'Where Specialty should write') +
      f('license', 'License #', 'Required on the Rx') + f('licExp', 'License expiration (mm/yy)', 'mm/yy') + f('sig', 'Signature line', 'Leave empty to sign by hand', true) + '</div>' +
    '<div class="small muted" style="margin:-2px 0 14px">The signature line prints as typed (e.g. “s/ Amir Akhavan, DMD, MS”); empty leaves the line for a pen.</div>' +
    '<h5 style="margin:6px 0 8px">Prices <span class="h5n">' + esc(RX_PRICE_SRC) + '</span></h5>' +
    rxKinds().map(K => sub(K.title) + rxPriceRows(P2, true, K.prices) + (K.priceNote ? '<div class="small muted" style="margin:6px 0 4px">' + esc(K.priceNote) + '</div>' : '')).join('') +
    sub('Both forms') + rxPriceRows(P2, true, RX_PRICES_BOTH) + '<div class="small muted" style="margin:6px 0 12px">The expedite fee is from Specialty’s case scheduling page (needed in under 10 business days), not the price list.</div>' +
    '<h5 style="margin:6px 0 8px">Not on the price list <span class="h5n">blank = named under the estimate, not added; add a price (e.g. from an invoice) to count it</span></h5>' +
    rxKinds().map(K => { const r = rxPriceRows(P2, false, K.prices); return r ? sub(K.title) + r : ''; }).join('') +
    '<div class="pickRow" style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-act="rxPricesReset">' + ic('refresh', 15) + 'Back to the price list</button></div>' +
    rxKinds().map(K => { const def = rxDefaults(K.form), U = K.usual.charAt(0).toUpperCase() + K.usual.slice(1);
      return '<h5 style="margin:16px 0 6px">' + esc(U) + '</h5><div class="small">' + (def ? esc(rxSummary(def)) + ' <button type="button" class="btn btn-ghost btn-sm" data-act="rxDefClear" data-form="' + K.form + '">Clear</button>' : '<span class="muted">Not set. In any ' + esc(K.title) + ', tap “Save as ' + esc(K.usual) + '” and new ones start from it.</span>') + '</div>'; }).join('') +
    '</div></div>';
}
document.addEventListener('change', e => {
  const t = e.target; if (!t || !t.dataset) return;
  if (t.dataset.rxoff) { const o = rxOffice(); o[t.dataset.rxoff] = String(t.value || '').trim().slice(0, 80); act(() => B.saveSettings({ rxOffice: o }), 'Saved'); }
  if (t.dataset.rxprice) {
    if (t.value !== '' && !(Number(t.value) >= 0)) { toast('Enter a dollar amount, like 17.75', { bad: true }); return; }
    let cur = {}; try { cur = JSON.parse(S.settings.rxPrices || '{}') || {}; } catch (x) { }
    cur[t.dataset.rxprice] = t.value === '' ? '' : Math.round(Number(t.value) * 100) / 100;
    act(() => B.saveSettings({ rxPrices: JSON.stringify(cur) }), 'Saved');
  }
});

/* =====================================================================
   The Herbst Rx (Specialty's MKT-005, Rev 3-25)
   ===================================================================== */
function rxCanonH(rx) {
  const o = { form: RX_FORM }, { one, num, list, flag } = rxCanonKit(rx, o);
  one('design', RX_KEYS('design')); one('mech', RX_KEYS('mech'));
  if (rx.apple === true || rx.mech === 'applecore') o.apple = true; // AppleCore screws (a mechanism choice until 4 Oct 2026)
  flag('shims'); if (o.shims) { num('shimsMm'); num('shimsQty'); }
  flag('mio'); if (o.mio) num('mioMm');
  one('bite', RX_KEYS('bite')); if (o.bite === 'advance') num('advMm');
  list('exp', RX_KEYS('exp')); one('expOther');
  list('wire', RX_KEYS('wire'));
  list('rests', ['U', 'L']); if (o.rests) one('restKind', RX_KEYS('restKind')); // ball clasps / wire go with the rests
  list('awt', ['U', 'L']); if ((o.awt || []).includes('U')) one('awtU', ['018', '022']); if ((o.awt || []).includes('L')) one('awtL', ['018', '022']);
  if (o.awt) { flag('awtExt'); one('awtPos', RX_KEYS('awtPos')); } // the extension and position go with the tubes
  list('crownOpt', RX_KEYS('crownOpt'));
  const t = {}; RX_GRID.forEach(id => { const v = (rx.teeth || {})[id]; if (RX_KEYS('anch').includes(v)) t[id] = v; }); if (Object.keys(t).length) o.teeth = t;
  list('occl', RX_GRID);
  flag('enclosed'); flag('printed3d'); flag('rush');
  rxCanonTail(rx, o, RXF);
  return o;
}
function rxSummaryH(rx) {
  const lab = (k, v) => ((RXO[k].find(x => x[0] === v) || [])[1] || '').replace(/ \(.*\)$/, '');
  const n = {}; Object.values(rx.teeth || {}).forEach(v => { n[v] = (n[v] || 0) + 1; });
  const anch = RXO.anch.filter(([k]) => n[k]).map(([k, l]) => n[k] + ' ' + (k === 'onbrace' ? 'OnBRACE' : k === 'roc' ? 'ROC' + (n[k] > 1 ? 's' : '') : l.toLowerCase() + (n[k] > 1 ? 's' : ''))).join(', ');
  const mech = [rx.mech ? lab('mech', rx.mech) : '', rx.apple ? 'AppleCore screws' : ''].filter(Boolean).join(' + ');
  return [rx.design ? lab('design', rx.design) : '', mech, anch].filter(Boolean).join(' · ') || 'Nothing picked yet';
}
function rxEstimateH(rx) {
  const E = rxEst(), add = E.add, inc = E.inc, missing = E.missing;
  const lab = (k, v) => (RXO[k].find(x => x[0] === v) || [])[1] || v;
  if (rx.design) add(lab('design', rx.design), rx.design === 'acryliclower' ? 'herbstAcr' : 'herbst', 1, ['standard', 'spaceclosing', 'combination'].includes(rx.design) ? 'priced as the list’s Band/Crown/ROC Cantilever Herbst' : '');
  if (rx.mech === 'standard') inc(lab('mech', 'standard'), 'No separate charge listed');
  else if (rx.mech) add(lab('mech', rx.mech), rx.mech);
  if (rx.apple) add('AppleCore screws', 'applecore');
  if (rx.shims) add('Advancement shims', 'shims');
  const n = { band: 0, crown: 0, roc: 0, onbrace: 0 }; Object.values(rx.teeth || {}).forEach(v => { n[v]++; });
  if (rx.enclosed && (n.band || n.crown || n.roc)) inc('Bands / crowns enclosed with the case', 'No charge');
  else {
    const d3 = rx.printed3d;
    if (n.band) add((d3 ? '3D printed bands' : 'Bands provided and fit') + ' × ' + n.band, d3 ? 'band3d' : 'band', n.band);
    if (n.crown + n.roc) add((d3 ? '3D printed crowns' : 'Crowns provided and fit') + ' × ' + (n.crown + n.roc) + (n.roc ? ' (' + n.roc + ' ROC)' : ''), d3 ? 'crown3d' : 'crown', n.crown + n.roc);
  }
  if (n.onbrace) add('OnBRACE × ' + n.onbrace, 'onbrace', n.onbrace);
  (rx.exp || []).forEach(k => add(lab('exp', k), 'screw', 1, 'priced as the list’s RPE screw'));
  if (rx.expOther) missing.push('Expansion: ' + rx.expOther);
  if ((rx.wire || []).includes('la')) inc('Lingual arch: lower (lingual holding arch)');
  if ((rx.wire || []).includes('tpa')) add('Transpalatal arch', 'tpa', 1, 'its own appliance on the list');
  if ((rx.wire || []).includes('qh')) add('Quad helix: upper', 'qh', 1, 'its own appliance on the list');
  if ((rx.rests || []).length) inc('2nd molar rests');
  if (rx.restKind === 'ball') { const pr = (rx.rests || []).length; add('Ball clasps × ' + pr + ' pair' + (pr > 1 ? 's' : ''), 'ball', pr); } // (only with rests)
  if ((rx.occl || []).length) inc('Occlusal rests × ' + rx.occl.length);
  if ((rx.awt || []).length) inc('Archwire tubes');
  if (rx.awtExt) add('Archwire tubes extended to the 2nd bicuspid', 'awtExt');
  const cust = (rx.crownOpt || []).filter(k => k !== 'lugs');
  if (cust.length) inc(cust.map(k => lab('crownOpt', k).replace(/ \(ROC\)/, '')).join(', '), 'Free (crown customization)');
  if ((rx.crownOpt || []).includes('lugs')) add('Lingual seating lugs', 'lugs');
  if (rx.rush) add('Expedited manufacturing and shipping', 'rush', 1, 'Specialty’s fee for under 10 business days');
  return E.done();
}
/* the tooth an appliance part hangs from on each side: the furthest-back anchored tooth among `from` (else the first) */
function rxAnchorOn(rx, arch, side, from) { const t = rx.teeth || {}; const hit = from.find(n => t[arch + side + n]); return arch + side + (hit || from[0]); }
function rxAutoH(rx) {
  const out = [], teeth = rx.teeth || {}, S2 = ['R', 'L'];
  const stroke = (d, w, col) => out.push({ d, s: col || RX_METAL, w });
  const fill = (d, col, s, w) => out.push({ d, f: col, s: s || '', w: w || 0 });
  const lingual = (id, gap) => rxPt(id, 0, -(rxT(id).r + (gap || 1)));
  const buccal = (id, gap, along) => rxPt(id, along || 0, rxT(id).r + (gap || 1));
  // acrylic lower (design): hatched over the lower teeth
  if (rx.design === 'acryliclower') ['R', 'L'].forEach(s => [1, 2, 3, 4, 5, 6, 7].forEach(n => { const p = rxPoly('L' + s + n, 1.14); out.push({ d: rxHatch(p, -45, 1.9), s: '#8A94A3', w: .35 }); out.push({ d: RXP.poly(p, true), s: '#7B8594', w: .5 }); }));
  // anchorage: band = a ring, crown = filled, ROC = crown with the occlusal open, OnBRACE = hatched
  Object.keys(teeth).forEach(id => { const k = teeth[id], r = rxT(id).r;
    if (k === 'band') stroke(RXP.poly(rxPoly(id, (r + .9) / r), true), 1.6);
    else if (k === 'crown' || k === 'roc') { fill(RXP.poly(rxPoly(id, 1.05), true), '#C9D6EA', RX_METAL, 1.1); if (k === 'roc') fill(RXP.poly(rxPoly(id, .48), true), '#FFFFFF', RX_METAL, .6); }
    else if (k === 'onbrace') { const p = rxPoly(id, 1.05); out.push({ d: rxHatch(p, 45, 1.5), s: RX_METAL, w: .5 }); stroke(RXP.poly(p, true), 1.15); }
  });
  // crown options, on the crowned teeth
  const co = rx.crownOpt || [];
  Object.keys(teeth).filter(id => teeth[id] === 'crown' || teeth[id] === 'roc').forEach(id => { const t = rxT(id), r = t.r;
    if (co.includes('lugs')) fill(RXP.bar(rxPt(id, 0, -r * .86), t.m, 2.6, 1.3), RX_METAL);
    if (co.includes('vent') && teeth[id] !== 'roc') fill(RXP.circle(...rxPt(id, -r * .22, -r * .1), .75), '#FFFFFF', RX_METAL, .5);
    if (co.includes('debond')) fill(RXP.circle(...rxPt(id, 0, r * .6), .75), '#FFFFFF', RX_METAL, .5);
    if (co.includes('slits')) stroke(RXP.line(rxPt(id, 0, r * .66), rxPt(id, 0, r * 1.02)), .7);
  });
  const wire = rx.wire || [];
  // lingual arch (lower): along the lingual of the lower teeth, molar to molar
  if (wire.includes('la')) {
    const mR = rxAnchorOn(rx, 'L', 'R', [6, 7]), mL = rxAnchorOn(rx, 'L', 'L', [6, 7]);
    const pts = [lingual(mR, 1.4)].concat([5, 4, 3, 2, 1].map(n => lingual('LR' + n, 1.6)), [1, 2, 3, 4, 5].map(n => lingual('LL' + n, 1.6)), [lingual(mL, 1.4)]);
    stroke(RXP.smooth(pts), 1.2); fill(RXP.circle(...pts[0], 1.2), RX_METAL); fill(RXP.circle(...pts[pts.length - 1], 1.2), RX_METAL);
  }
  // transpalatal arch: molar to molar across the palate, with its loop at the middle
  if (wire.includes('tpa')) {
    const a = lingual(rxAnchorOn(rx, 'U', 'R', [6, 7]), 1.2), b = lingual(rxAnchorOn(rx, 'U', 'L', [6, 7]), 1.2), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + 2;
    stroke([['M', a[0], a[1]], ['L', mx - 4, my], ['C', mx - 4, my - 9, mx + 4, my - 9, mx + 4, my], ['L', b[0], b[1]]], 1.2);
    fill(RXP.circle(...a, 1.2), RX_METAL); fill(RXP.circle(...b, 1.2), RX_METAL);
  }
  // quad helix (upper): outer arms along the premolars, a helix behind each molar and two by the premolars, the bridge between
  if (wire.includes('qh')) {
    const side = s => { const m = rxAnchorOn(rx, 'U', s, [6, 7]), t = rxT(m), at = lingual(m, 1.2);
      return { arm: [lingual('U' + s + '3', 1.4), lingual('U' + s + '4', 1.4), lingual('U' + s + '5', 1.4), at], at,
        hp: [at[0] - t.b[0] * 4 - t.m[0] * 3.5, at[1] - t.b[1] * 4 - t.m[1] * 3.5], ha: rxPt('U' + s + '4', 0, -(rxT('U' + s + '4').r + 9)) }; };
    const R = side('R'), L = side('L');
    stroke(RXP.smooth(R.arm), 1.2); stroke(RXP.smooth(L.arm), 1.2);
    stroke(RXP.line(R.at, R.hp), 1.2); stroke(RXP.line(L.at, L.hp), 1.2);
    stroke(RXP.line(R.hp, R.ha), 1.2); stroke(RXP.line(L.hp, L.ha), 1.2);
    const my = Math.min(R.ha[1], L.ha[1]) - 3; stroke([['M', R.ha[0], R.ha[1]], ['C', R.ha[0] + 6, my, L.ha[0] - 6, my, L.ha[0], L.ha[1]]], 1.2);
    [R.hp, R.ha, L.hp, L.ha].forEach(h => fill(RXP.circle(h[0], h[1], 2.1), '#FFFFFF', RX_METAL, 1));
    fill(RXP.circle(...R.at, 1.2), RX_METAL); fill(RXP.circle(...L.at, 1.2), RX_METAL);
  }
  // expansion screws: the body in the middle, arms to the anchored teeth
  const exp = rx.exp || [];
  [['U', exp.includes('mcU') || exp.includes('csU')], ['L', exp.includes('mcL') || exp.includes('csL')]].forEach(([A, on]) => { if (!on) return;
    const mR = rxAnchorOn(rx, A, 'R', [6, 7]), mL = rxAnchorOn(rx, A, 'L', [6, 7]);
    const fR = rxAnchorOn(rx, A, 'R', [4, 5]), fL = rxAnchorOn(rx, A, 'L', [4, 5]);
    const cx = (rxT(mR).c[0] + rxT(mL).c[0]) / 2, cy = A === 'U' ? (rxT(A + 'R5').c[1] + rxT(A + 'R6').c[1]) / 2 : (rxT(A + 'R4').c[1] + rxT(A + 'R5').c[1]) / 2;
    const w = 11, h = 7, arms = [mR, mL].concat(teeth[fR] ? [fR] : [], teeth[fL] ? [fL] : []);
    arms.forEach(id => { const p = lingual(id, 1); stroke(RXP.line([cx + (p[0] < cx ? -w / 2 : w / 2), cy + (p[1] < cy ? -h / 2 + 1 : h / 2 - 1)], p), 1.2); fill(RXP.circle(...p, 1.1), RX_METAL); });
    fill(RXP.poly([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], true), '#E5E7EB', RX_METAL, 1);
    stroke(RXP.line([cx - 3.4, cy], [cx + 3.4, cy]), .7);
    fill(RXP.poly([[cx - 4.6, cy], [cx - 2.8, cy - 1.3], [cx - 2.8, cy + 1.3]], true), RX_METAL); fill(RXP.poly([[cx + 4.6, cy], [cx + 2.8, cy - 1.3], [cx + 2.8, cy + 1.3]], true), RX_METAL);
  });
  // archwire tubes on the buccal of the anchored molars (extended to the 2nd bicuspid when asked)
  (rx.awt || []).forEach(A => S2.forEach(s => { const id = rxAnchorOn(rx, A, s, [6, 7]), t = rxT(id), c = buccal(id, .9);
    fill(RXP.bar(c, t.m, 5.6, 2.2), RX_METAL);
    if (rx.awtExt) stroke(RXP.line([c[0] + t.m[0] * 2.8, c[1] + t.m[1] * 2.8], buccal(A + s + '5', 1)), .9);
  }));
  // 2nd molar rests (from the 6 onto the 7), ball clasps between them
  (rx.rests || []).forEach(A => S2.forEach(s => { const r7 = rxT(A + s + '7').r, p = rxPt(A + s + '7', r7 * .35, 0), q = rxPt(A + s + '6', -rxT(A + s + '6').r * .55, 0);
    stroke(RXP.line(q, p), .9); fill(RXP.circle(p[0], p[1], 1.5), RX_METAL);
    if (rx.restKind === 'ball') { const t6 = rxT(A + s + '6'), t7 = rxT(A + s + '7'); const mx = (t6.c[0] + t7.c[0]) / 2 + (t6.b[0] + t7.b[0]) / 2 * ((t6.r + t7.r) / 2 + .6), my = (t6.c[1] + t7.c[1]) / 2 + (t6.b[1] + t7.b[1]) / 2 * ((t6.r + t7.r) / 2 + .6); fill(RXP.circle(mx, my, 1.2), RX_METAL); }
  }));
  // occlusal rests on the teeth tapped
  (rx.occl || []).forEach(id => { const r = rxT(id).r, p = rxPt(id, r * .42, 0); stroke(RXP.line(p, rxPt(id, r * .42, -r * .95)), .8); fill(RXP.circle(p[0], p[1], 1.5), RX_METAL); });
  // the Herbst: the tube from the upper molar, the rod to the lower premolar (or the cantilever arm's end), each on its pivot
  if (rx.design || rx.mech) {
    const pivot = p => { fill(RXP.circle(p[0], p[1], 1.9), '#FFFFFF', RX_METAL, 1); fill(RXP.circle(p[0], p[1], .6), RX_METAL); };
    S2.forEach(s => {
      const u = rxAnchorOn(rx, 'U', s, [6, 7]), tu = rxT(u), pu = buccal(u, 2.4, -tu.r * .3);
      stroke(RXP.line(pu, [pu[0] + tu.m[0] * 12 + tu.b[0] * .4, pu[1] + tu.m[1] * 12 + tu.b[1] * .4]), 2.4); pivot(pu);
      let pl, tl;
      if (rx.design === 'cantilever') {
        const m = rxAnchorOn(rx, 'L', s, [6, 7]); tl = rxT('L' + s + '4');
        const arm = [buccal(m, 1.3), buccal('L' + s + '5', 2.2), buccal('L' + s + '4', 2.6)]; stroke(RXP.smooth(arm), 1.4); pl = arm[2];
      } else { const id = rx.design === 'acryliclower' ? 'L' + s + '4' : rxAnchorOn(rx, 'L', s, [4, 5, 6]); tl = rxT(id); pl = buccal(id, 2.3, tl.r * .2); }
      stroke(RXP.line(pl, [pl[0] - tl.m[0] * 10 + tl.b[0] * .4, pl[1] - tl.m[1] * 10 + tl.b[1] * .4]), 1.5); pivot(pl);
    });
  }
  return out;
}
function rxFillH(c, rx, put, box, circ) {
  if (rx.design) box.add('design.' + rx.design); if (rx.mech) box.add('mech.' + rx.mech); if (rx.apple) box.add('mech.applecore');
  if (rx.shims) { box.add('shims'); put('shimsMm', rx.shimsMm, 'H', 9); put('shimsQty', rx.shimsQty, 'H', 9); }
  if (rx.mio) { box.add('mio'); put('mioMm', rx.mioMm, 'H', 9); }
  if (rx.bite) { box.add('bite.' + rx.bite); if (rx.bite === 'advance') put('advMm', rx.advMm, 'H', 9); }
  (rx.exp || []).forEach(k => box.add('exp.' + k)); put('expOther', rx.expOther, 'H', 9);
  (rx.wire || []).forEach(k => box.add(k));
  if ((rx.rests || []).length) { box.add('rests2'); rx.rests.forEach(a => box.add('rests' + a)); }
  if (rx.restKind) box.add(rx.restKind);
  (rx.awt || []).forEach(a => { box.add('awt' + a); const z = rx['awt' + a]; if (z) box.add('awt' + a + z); });
  if (rx.awtExt) box.add('awtExt'); if (rx.awtPos) box.add({ occ: 'awtOcc', cen: 'awtCen', gin: 'awtGin' }[rx.awtPos]);
  (rx.crownOpt || []).forEach(k => box.add(k));
  const kinds = new Set(Object.values(rx.teeth || {}));
  if (kinds.size) { if (rx.enclosed) box.add('enclosed'); else { box.add('provides'); kinds.forEach(k => box.add('anch.' + k)); } }
  if (rx.printed3d) box.add('printed3d');
  Object.keys(rx.teeth || {}).forEach(id => circ.push(['anch', id])); (rx.occl || []).forEach(id => circ.push(['occl', id]));
}
/* a new Herbst Rx starts from Dr. A's usual Herbst (when he's saved one), with the case's own Herbst picked */
function rxStartH(c) {
  const rx = rxDefaults(RX_FORM) || { form: RX_FORM };
  if ((c.appliances || []).includes('Space Closing Herbst')) rx.design = 'spaceclosing';
  return rxCanon(rx);
}
function rxSecsH(rx) {
  return rxInfoSec('design', 'Herbst design', '<div class="rxBs">' + RXO.design.map(([k, l]) => rxBtn('design', k, l, rx.design === k, rxTag(k === 'acryliclower' ? 'herbstAcr' : 'herbst'))).join('') + '</div>') +
    rxInfoSec('mech', 'Herbst mechanism', '<div class="rxBs">' + RXO.mech.map(([k, l]) => rxBtn('mech', k, l, rx.mech === k, k === 'standard' ? 'no extra' : rxTag(k, true))).join('') + '</div>' +
      '<div class="rxBs"><span class="rxLbl">With</span>' + rxBtn('flag', 'apple', 'AppleCore® screws & pivots', rx.apple, rxTag('applecore', true)) + '</div>',
      '<div class="rxBs">' + rxBtn('flag', 'shims', 'Advancement shims', rx.shims, rxTag('shims', true)) + '<span class="rxSub" data-show="shims">' + rxField('shimsMm', 'mm', 'text', ' inputmode="decimal" maxlength="6"') + rxField('shimsQty', 'qty', 'text', ' inputmode="numeric" maxlength="4"') + '</span></div>' +
      '<div class="rxBs">' + rxBtn('flag', 'mio', 'MIO measurement', rx.mio) + '<span class="rxSub" data-show="mio">' + rxField('mioMm', 'mm', 'text', ' inputmode="decimal" maxlength="6"') + '</span></div>') +
    rxSec('Bite relationship', '<div class="rxBs">' + RXO.bite.map(([k, l]) => rxBtn('bite', k, k === 'advance' ? 'Advance' : l, rx.bite === k)).join('') + '<span class="rxSub" data-show="advance">' + rxField('advMm', 'mm', 'text', ' inputmode="decimal" maxlength="6"') + '</span></div>') +
    rxSec('Anchorage', '<div class="small muted" style="margin-bottom:6px">Pick one, then tap the teeth on the arches (4s to 7s, as on Specialty’s chart). Tap a tooth again to take it off.</div><div class="rxBs">' +
      RXO.anch.map(([k, l]) => rxBtn('tool', k, l, RXE.tool === k, rxTag(k === 'band' ? (rx.printed3d ? 'band3d' : 'band') : k === 'onbrace' ? 'onbrace' : (rx.printed3d ? 'crown3d' : 'crown'), false, ' ea'))).join('') + rxBtn('tool', 'rest', 'Occlusal rest', RXE.tool === 'rest', 'included') + '</div>' +
      '<div class="rxTeeth small" id="rxTeethSum"></div><div class="rxBs">' + rxBtn('flag', 'printed3d', '3D printed / sintered bands, ROCs and crowns', rx.printed3d) + rxBtn('flag', 'enclosed', 'Bands or crowns enclosed with case', rx.enclosed, 'no charge') + '</div>') +
    rxSec('Expansion', '<div class="rxBs">' + RXO.exp.map(([k, l]) => rxBtn('exp', k, l, (rx.exp || []).includes(k), rxTag('screw', true))).join('') + '</div><div class="rxRow">' + rxField('expOther', 'Other type', 'text', ' maxlength="40"') + '</div>') +
    rxSec('Wire', '<div class="rxBs">' + rxBtn('wire', 'la', 'Lingual arch: lower', (rx.wire || []).includes('la'), 'included') + rxBtn('wire', 'tpa', 'Transpalatal arch', (rx.wire || []).includes('tpa'), rxTag('tpa', true)) + rxBtn('wire', 'qh', 'Quad helix: upper', (rx.wire || []).includes('qh'), rxTag('qh', true)) + '</div>') +
    rxSec('Rests', '<div class="rxBs"><span class="rxLbl">2nd molar rests</span>' + rxBtn('rests', 'U', 'Upper', (rx.rests || []).includes('U'), 'included') + rxBtn('rests', 'L', 'Lower', (rx.rests || []).includes('L'), 'included') + '</div>' +
      '<div class="rxBs rxSub" data-show="rests"><span class="rxLbl">Made with</span>' + RXO.restKind.map(([k, l]) => rxBtn('restKind', k, l, rx.restKind === k, k === 'ball' ? rxTag('ball', true, '/pr') : '')).join('') + '</div>') +
    rxSec('Archwire tubes', '<div class="rxBs"><span class="rxLbl">Upper</span>' + rxBtn('awt', 'U', 'Upper tubes', (rx.awt || []).includes('U'), 'included') + '<span class="rxSub" data-show="awtU">' + rxBtn('awtU', '018', '.018', rx.awtU === '018') + rxBtn('awtU', '022', '.022', rx.awtU === '022') + '</span></div>' +
      '<div class="rxBs"><span class="rxLbl">Lower</span>' + rxBtn('awt', 'L', 'Lower tubes', (rx.awt || []).includes('L'), 'included') + '<span class="rxSub" data-show="awtL">' + rxBtn('awtL', '018', '.018', rx.awtL === '018') + rxBtn('awtL', '022', '.022', rx.awtL === '022') + '</span></div>' +
      '<div class="rxBs rxSub" data-show="awtAny">' + rxBtn('flag', 'awtExt', 'Extend tubes to 2nd bicuspid', rx.awtExt, rxTag('awtExt', true)) + '<span class="rxLbl">Position</span>' + RXO.awtPos.map(([k, l]) => rxBtn('awtPos', k, l, rx.awtPos === k)).join('') + '</div>') +
    rxSec('Crown options', '<div class="rxBs">' + RXO.crownOpt.map(([k, l]) => rxBtn('crownOpt', k, l, (rx.crownOpt || []).includes(k), k === 'lugs' ? rxTag('lugs', true) : 'free')).join('') + '</div>');
}
function rxTeethSumH(rx) {
  const t = rx.teeth || {}, by = {}; Object.keys(t).forEach(id => { (by[t[id]] = by[t[id]] || []).push(id); });
  const parts = RXO.anch.filter(([k]) => by[k]).map(([k, l]) => '<b>' + esc(l) + (by[k].length > 1 && k !== 'onbrace' ? 's' : '') + ':</b> ' + esc(by[k].join(', ')));
  if ((rx.occl || []).length) parts.push('<b>Occlusal rests:</b> ' + esc(rx.occl.join(', ')));
  return parts.join(' · ') || '<span class="muted">No teeth picked yet.</span>';
}
function rxTapH(id, rx, k) {
  if (!RX_GRID.includes(id)) { toast('Specialty’s chart takes bands, crowns and rests on the 4s to 7s'); return false; }
  if (k === 'rest') { const o = new Set(rx.occl || []); if (o.has(id)) o.delete(id); else o.add(id); rx.occl = Array.from(o); }
  else if (RX_KEYS('anch').includes(k)) { rx.teeth = Object.assign({}, rx.teeth); if (rx.teeth[id] === k) delete rx.teeth[id]; else rx.teeth[id] = k; }
  return true;
}
RXK[RX_FORM] = {
  form: RX_FORM, key: 'herbst', field: 'rx', ds: 'rx', title: 'Herbst Rx', usual: 'our usual Herbst',
  saveDefTip: 'New Herbst Rx start from these choices and teeth (not this patient’s dates, measurements, notes or drawings)',
  caseIntro: 'Specialty’s Herbst Rx, filled in from this case: tap the choices and the teeth, and it gives the PDF to upload with the scan, and the lab cost.',
  costEmpty: 'Pick the design, mechanism and anchorage — the prices add up here.',
  priceNote: 'Included on the list: archwire tubes, lingual holding arch, rests; crown holes and slits are free.',
  prices: RX_PRICES, appl: RX_HERBST,
  applies: c => !!c && c.type === 'appliance' && labName(c.lab) === LAB_SPEC && (c.appliances || []).some(a => RX_HERBST.includes(a)),
  scanners: [['itero', /itero/i], ['trios', /trios/i], ['medit', /medit/i], ['carestream', /carestream/i], ['cerec', /cerec/i]],
  canon: rxCanonH, summary: rxSummaryH, estimate: rxEstimateH, auto: rxAutoH, fill: rxFillH, start: rxStartH,
  single: RX_SINGLE, tools: ['band', 'crown', 'roc', 'onbrace', 'rest'], tool0: 'band',
  defDrop: ['mio', 'mioMm', 'advMm', 'shimsMm', 'shimsQty', 'expOther'], // (this patient's measurements)
  secHTML: rxSecsH, teethSum: rxTeethSumH, tap: rxTapH, tappable: id => RX_GRID.includes(id),
  toolsHTML: () => rxToolBtn('band', 'Band', 'Tap a tooth (4s to 7s) to band it') + rxToolBtn('crown', 'Crown', 'Tap a tooth to crown it') + rxToolBtn('roc', 'ROC', 'Crown with the occlusal removed') + rxToolBtn('onbrace', 'OnBRACE', 'OnBRACE on the tooth') + rxToolBtn('rest', 'Rest', 'Occlusal rest on the tooth'),
  hint: tool => tool === 'rest' ? 'Tap the teeth that get an occlusal rest.' : 'Tap the teeth that get a ' + ((RXO.anch.find(x => x[0] === tool) || [])[1] || tool) + '.',
  tip: (id, rx) => { const t = rx.teeth || {}, oc = rx.occl || []; return id + (t[id] ? ': ' + (RXO.anch.find(x => x[0] === t[id]) || [])[1] : '') + (oc.includes(id) ? (t[id] ? ', ' : ': ') + 'occlusal rest' : ''); },
  subShow: (k, rx) => k === 'advance' ? rx.bite === 'advance' : k === 'awtU' ? (rx.awt || []).includes('U') : k === 'awtL' ? (rx.awt || []).includes('L') : k === 'rests' ? !!rx.rests : k === 'awtAny' ? !!rx.awt : !!rx[k],
  // the anchorage prices follow the 3D-printed switch
  after: (g, v, on, prev, rx, w) => { if (g === 'flag' && v === 'printed3d') $$('.rxB[data-rxg="tool"]', w).forEach(x => { const em = $('em', x); if (!em || x.dataset.v === 'onbrace' || x.dataset.v === 'rest') return; em.textContent = rxTag(x.dataset.v === 'band' ? (on ? 'band3d' : 'band') : (on ? 'crown3d' : 'crown'), false, ' ea'); }); },
  leadDays: () => 10,
  info: RX_INFO, src: RX_SRC,
  infoKeys: g => g === 'design' ? RX_KEYS('design') : RX_KEYS('mech').concat(['apple', 'shims', 'mio']),
  infoName: (g, v) => ((RXO[g] || []).find(x => x[0] === v) || [])[1] || v,
  infoTag: (g, v) => g === 'design' ? rxTag(v === 'acryliclower' ? 'herbstAcr' : 'herbst') : v === 'standard' ? 'no separate charge' : v === 'apple' ? rxTag('applecore', true) : v === 'shims' ? rxTag('shims', true) : v === 'mio' ? '' : rxTag(v, true),
  infoSel: (g, rx) => g === 'design' ? rx.design || '' : rx.mech || (rx.apple ? 'apple' : ''),
  infoOf: b => { const g = b.dataset.rxg, v = b.dataset.v; return g === 'flag' ? (RX_INFO_FLAG[v] ? [RX_INFO_FLAG[v], v] : null) : RX_INFO[g] ? [g, v] : null; },
  infoPrompt: g => g === 'design' ? 'a design' : 'a mechanism',
  cmpKeys: g => g === 'design' ? RX_KEYS('design') : RX_KEYS('mech').concat(['apple'])
};
