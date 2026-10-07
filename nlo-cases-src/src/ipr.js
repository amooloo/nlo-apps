/* =====================================================================
   IPR Tracker link — reads the IPR Tracker's own records (nlo-inventory
   Realtime Database, nlo/ipr) for a chart # and builds the same chart
   note the IPR Tracker's "Chart note" tab makes ("lines" format), so the
   case gets it without copy and paste. Read-only; the IPR Tracker is not
   changed. Sign-in is the IPR Tracker's own Google sign-in, once per device.
   ===================================================================== */
const IPR_FB = {
  apiKey: "AIzaSyBFCmDgAKkdfZ4Cb81nK0KCKXtONiwMJy4",
  authDomain: "nlo-inventory.firebaseapp.com",
  databaseURL: "https://nlo-inventory-default-rtdb.firebaseio.com",
  projectId: "nlo-inventory",
  appId: "1:471691286148:web:b362a98186f648bd4914d1"
};
const IPR_URL = 'IPR_Tracker.html';
/* the IPR Tracker straight to a patient's new visit (Amir, 6 Oct 2026: "the step for IPR entry should open up the IPR tracker so they
   can upload it there instead of having to enter it in IPR tracker and then reconnect it in case tracker"): its #chart=…&ini=… link,
   which IPR_Tracker.html reads once (the patient's visits, or New patient filled in). Only the chart # and initials ride on it, in
   the part of the address that never leaves the computer. Coming back to NLO Cases reads the visit in by itself (iprBack, ui.js). */
function iprDeepUrl(chart, name) {
  const t = nameTokens(name), ini = t.length ? (t[0][0] + (t.length > 1 ? t[t.length - 1][0] : '')).toUpperCase() : '';
  return IPR_URL + (String(chart || '').trim() ? '#chart=' + encodeURIComponent(String(chart).trim()) + (ini ? '&ini=' + ini : '') : '');
}
const IPR_UPPER = ["UR7", "UR6", "UR5", "UR4", "UR3", "UR2", "UR1", "UL1", "UL2", "UL3", "UL4", "UL5", "UL6", "UL7"];
const IPR_LOWER = ["LR7", "LR6", "LR5", "LR4", "LR3", "LR2", "LR1", "LL1", "LL2", "LL3", "LL4", "LL5", "LL6", "LL7"];

/* --- copied unchanged from IPR_Tracker.html so the text matches exactly --- */
const NOTE_DASH = "–";
function iprInit(teeth) { const c = {}; for (let i = 0; i < teeth.length - 1; i++) c[`${teeth[i]}|${teeth[i + 1]}`] = ""; return c; }
function canonContacts(teeth, raw, blank) {
  const src = raw || {}; const c = {};
  for (let i = 0; i < teeth.length - 1; i++) { const k = `${teeth[i]}|${teeth[i + 1]}`; c[k] = src[k] === undefined || src[k] === null ? blank : src[k]; }
  return c;
}
function sumContacts(contacts) { return Object.values(contacts).reduce((s, v) => s + (parseFloat(v) || 0), 0); }
function jp(val, fallback) { if (!val) return fallback; if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return fallback; } } return val; }
function addContacts(a, b) { const result = {}; Object.keys(a).forEach(k => { result[k] = String((parseFloat(a[k]) || 0) + (parseFloat(b[k]) || 0)); }); return result; }
function noteRowsOf(obj) { return Object.entries(obj).filter(([, v]) => parseFloat(v) > 0); }
function noteBTsOf(obj) { return Object.entries(obj).filter(([, v]) => v).map(([k]) => k); }
function mm1(v) { return (parseFloat(v) || 0).toFixed(1); }
function ckLabel(k, dash) { return k.split("|").join(dash || NOTE_DASH); }
function listRows(rows, dash, terse) { return rows.map(([k, v]) => terse ? `${ckLabel(k, dash)} ${mm1(v).replace(/^0/, "")}` : `${ckLabel(k, dash)} ${mm1(v)}mm`).join(", "); }
function buildChartNote(o) {
  const uIPR = noteRowsOf(o.upper), lIPR = noteRowsOf(o.lower);
  const uSp = noteRowsOf(o.upperSpaces), lSp = noteRowsOf(o.lowerSpaces);
  const uBT = noteBTsOf(o.upperBT), lBT = noteBTsOf(o.lowerBT);
  const uIPRt = sumContacts(o.upper), lIPRt = sumContacts(o.lower);
  const uSpt = sumContacts(o.upperSpaces), lSpt = sumContacts(o.lowerSpaces);
  const hasIPR = uIPR.length > 0 || lIPR.length > 0;
  const hasSp = uSp.length > 0 || lSp.length > 0;
  const hasBT = uBT.length > 0 || lBT.length > 0;
  const showCum = !!(o.incCum && o.cumUpper && o.visitCount > 1);
  const cUt = o.cumUpper ? sumContacts(o.cumUpper) : 0;
  const cLt = o.cumLower ? sumContacts(o.cumLower) : 0;
  // "lines" format — the IPR Tracker's default
  const blocks = [];
  if (o.incIPR) {
    const s = ["IPR THIS VISIT"];
    if (hasIPR) {
      if (uIPR.length) s.push(`Upper: ${listRows(uIPR)} (${mm1(uIPRt)}mm)`);
      if (lIPR.length) s.push(`Lower: ${listRows(lIPR)} (${mm1(lIPRt)}mm)`);
      s.push(`Total: ${mm1(uIPRt + lIPRt)}mm`);
    } else s.push("None this visit");
    blocks.push(s.join("\n"));
  }
  const sp = ["SPACING"];
  if (hasSp) {
    if (uSp.length) sp.push(`Upper: ${listRows(uSp)} (${mm1(uSpt)}mm)`);
    if (lSp.length) sp.push(`Lower: ${listRows(lSp)} (${mm1(lSpt)}mm)`);
    sp.push(`Total: ${mm1(uSpt + lSpt)}mm`);
  } else sp.push("None noted");
  blocks.push(sp.join("\n"));
  const bt = ["BLACK TRIANGLES"];
  if (hasBT) {
    if (uBT.length) bt.push(`Upper: ${uBT.map(k => ckLabel(k)).join(", ")}`);
    if (lBT.length) bt.push(`Lower: ${lBT.map(k => ckLabel(k)).join(", ")}`);
    bt.push(`Total: ${uBT.length + lBT.length}`);
  } else bt.push("None noted");
  blocks.push(bt.join("\n"));
  if (showCum) blocks.push(`CUMULATIVE IPR (${o.visitCount} visits)\nUpper: ${mm1(cUt)}mm   Lower: ${mm1(cLt)}mm   Total: ${mm1(cUt + cLt)}mm`);
  return blocks.join("\n\n");
}
/* --- end of copied code --- */

/* --- the IPR Tracker's tooth outlines and sizes, copied unchanged from IPR_Tracker.html (toothPath, TW, TH) --- */
function iprToothPath(n) {
  if (n === 1) return "M 4,43 C 1,42 1,36 1,22 C 1,8 5,1 14,1 C 23,1 27,8 27,22 C 27,36 27,42 24,43 C 21,44 7,44 4,43 Z";
  if (n === 2) return "M 3,40 C 1,39 1,33 1,21 C 1,9 4,2 12,2 C 20,2 23,9 23,21 C 23,33 23,39 21,40 C 18,41 6,41 3,40 Z";
  if (n === 3) return "M 4,45 C 1,43 1,37 1,24 C 1,12 5,4 10,1 L 14,0 L 18,1 C 23,4 27,12 27,24 C 27,37 27,43 24,45 C 21,46 7,46 4,45 Z";
  if (n === 4 || n === 5) return "M 4,41 C 1,39 1,33 1,21 C 1,10 4,3 9,1 L 11.5,0 L 14,3 L 16.5,0 L 19,1 C 24,3 27,10 27,21 C 27,33 27,39 24,41 C 21,42 7,42 4,41 Z";
  return "M 5,39 C 2,37 2,32 2,21 C 2,10 5,3 9,1 L 12.5,0 L 15.5,3.5 L 20,3.5 L 23,0 L 26.5,1 C 31,3 34,10 34,21 C 34,32 34,37 31,39 C 28,40 8,40 5,39 Z";
}
const IPR_TW = { 7: 36, 6: 36, 5: 28, 4: 28, 3: 28, 2: 24, 1: 28 };
const IPR_TH = { 7: 48, 6: 48, 5: 42, 4: 42, 3: 46, 2: 41, 1: 44 };
/* --- end of copied code --- */

/* Build the note for the newest visit of a patient's visit list (pure; used by tests too).
   `d` keeps the numbers behind it (this visit's IPR, spaces and black triangles, IPR over all visits) for the diagram. */
function iprNoteFromVisits(visits) {
  const vs = visits.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const v = vs[0];
  const cum = (key, teeth) => vs.reduce((acc, x) => addContacts(acc, canonContacts(teeth, jp(x[key], null), "")), iprInit(teeth));
  const d = {
    upper: canonContacts(IPR_UPPER, jp(v.upper_ipr, null), ""), lower: canonContacts(IPR_LOWER, jp(v.lower_ipr, null), ""),
    upperSpaces: canonContacts(IPR_UPPER, jp(v.upper_spaces, null), ""), lowerSpaces: canonContacts(IPR_LOWER, jp(v.lower_spaces, null), ""),
    upperBT: canonContacts(IPR_UPPER, jp(v.upper_bt, null), false), lowerBT: canonContacts(IPR_LOWER, jp(v.lower_bt, null), false),
    incIPR: true, incCum: true, cumUpper: cum('upper_ipr', IPR_UPPER), cumLower: cum('lower_ipr', IPR_LOWER), visitCount: vs.length
  };
  return { date: v.date || '', assistant: v.assistant_initials || '', visits: vs.length, note: buildChartNote(d), d };
}

/* ---------- the IPR chart in the case panel ----------
   Amir, 3 Oct 2026: instead of the written IPR note, "a diagram … with lines and where the spacing is and black triangles".
   Amir, 6 Oct 2026: "make the diagram look nicer" — and it stays open even when the rest of the case is folded (ui.js).
   One chart instead of three stacked ones: both arches as seen from the front (upper teeth hang from the gums, lower teeth
   stand on theirs, in their real proportions), each amount outside its arch with a line to its contact, ▼ at a black triangle.
   Amir, 7 Oct 2026 (he picked "A" of three): IPR in red, and "IPR and spaces as 2 sides of a same toggle" — one switch picks what
   the amounts are: IPR this visit, IPR so far, or the spaces (drawn the same way, in blue); the switch carries every total, so
   nothing is hidden behind it. It opens on the spaces, with the black triangles, "because that's what's useful for tx planning".
   Plain SVG markup (numbers and fixed labels only). */
const IPR_COL = { visit: '#D92D20', cum: '#9B1C1C', sp: '#0369A1', bt: '#11203A' }; // red, dark red, blue, navy-900
/* crown sizes in mm (mesiodistal width, crown height) and shape, by tooth number — an average adult's */
const IPR_CROWN = {
  U: { 1: [8.6, 10.6, 'inc'], 2: [6.6, 9.0, 'inc'], 3: [7.6, 10.0, 'can'], 4: [7.0, 8.4, 'pm'], 5: [6.6, 7.8, 'pm'], 6: [10.0, 7.4, 'mol'], 7: [9.0, 7.0, 'mol'] },
  L: { 1: [5.4, 9.0, 'inc'], 2: [5.9, 9.4, 'inc'], 3: [6.8, 10.6, 'can'], 4: [7.0, 8.4, 'pm'], 5: [7.0, 8.0, 'pm'], 6: [11.0, 7.6, 'mol'], 7: [10.4, 7.2, 'mol'] }
};
/* a crown outline w × h with the biting edge at the bottom (y = h) and the gum line at the top (y = 0): narrower at the neck,
   widest at the contacts, then the edge — flat (incisors), a cusp tip (canines), a blunt cusp (premolars) or two cusps (molars) */
function iprCrownPath(w, h, kind) {
  const r = v => Math.round(v * 100) / 100, n = w * .15, X = f => r(w * f), Y = f => r(h * f);
  let s = 'M' + r(n) + ',' + Y(.12) + ' Q' + X(.5) + ',' + Y(-.1) + ' ' + r(w - n) + ',' + Y(.12) +
    ' C' + r(w - n * .25) + ',' + Y(.28) + ' ' + r(w) + ',' + Y(.42) + ' ' + r(w) + ',' + Y(.6) +
    ' C' + r(w) + ',' + Y(.8) + ' ' + X(.98) + ',' + Y(.9) + ' ' + X(.92) + ',' + Y(.95);
  if (kind === 'inc') s += ' Q' + X(.5) + ',' + Y(1.03) + ' ' + X(.08) + ',' + Y(.95);
  else if (kind === 'can') s += ' Q' + X(.72) + ',' + Y(.96) + ' ' + X(.52) + ',' + Y(1.04) + ' Q' + X(.3) + ',' + Y(.95) + ' ' + X(.08) + ',' + Y(.9);
  else if (kind === 'pm') s += ' Q' + X(.72) + ',' + Y(1.01) + ' ' + X(.5) + ',' + Y(1.02) + ' Q' + X(.28) + ',' + Y(1.01) + ' ' + X(.08) + ',' + Y(.94);
  else s += ' Q' + X(.82) + ',' + Y(1.02) + ' ' + X(.68) + ',' + Y(1) + ' Q' + X(.56) + ',' + Y(.95) + ' ' + X(.5) + ',' + Y(.94) +
    ' Q' + X(.44) + ',' + Y(.95) + ' ' + X(.32) + ',' + Y(1) + ' Q' + X(.18) + ',' + Y(1.02) + ' ' + X(.08) + ',' + Y(.94);
  return s + ' C' + X(.02) + ',' + Y(.9) + ' 0,' + Y(.8) + ' 0,' + Y(.6) + ' C0,' + Y(.42) + ' ' + r(n * .25) + ',' + Y(.28) + ' ' + r(n) + ',' + Y(.12) + 'Z';
}
let IPR_SEQ = 0; // a fresh id for each chart's gradient
/* both arches with one layer of amounts (`ipr`: {upper, lower} contacts → mm — this visit's IPR, IPR so far, or the spaces;
   `kind` 'ipr' or 'sp'), coloured `col`, and the black triangles of `d`. Each tooth's number sits on the tooth, on one straight
   row per arch; each amount sits outside its arch with a line to its contact (Amir, 6 Oct 2026: "numbers of the teeth on the
   teeth and then lines connecting the values to the interproximal") — amounts too close to fit side by side go one row further out. */
function iprMapSVG(ipr, d, col, label, kind) {
  const NUMS = [7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7], MM = 4.2, GAPX = 1.2, PADX = 18, ROW = 19, BH = 16;
  const r = v => Math.round(v * 100) / 100, gid = 'iprG' + (++IPR_SEQ);
  const row = a => { const out = []; let x = 0; NUMS.forEach((t, i) => { const [w, h, kind] = IPR_CROWN[a][t]; out.push({ t, x, w: w * MM, h: h * MM, kind }); x += w * MM + (i < 13 ? GAPX : 0); }); return { teeth: out, w: x }; };
  const U = row('U'), L = row('L'), inner = Math.max(U.w, L.w), W = inner + PADX * 2;
  const ux = PADX + (inner - U.w) / 2, lx = PADX + (inner - L.w) / 2;
  const at = (arch, x0, i) => r(x0 + arch.teeth[i].x + arch.teeth[i].w + GAPX / 2); // contact i: between tooth i and tooth i+1
  const bw = txt => 8 + txt.length * 6.2;
  // the contacts of an arch in order (UR7|UR6 … UL6|UL7): contact i is between tooth i and tooth i+1 of the row
  const KEYS = { U: IPR_UPPER.slice(0, -1).map((t, i) => t + '|' + IPR_UPPER[i + 1]), L: IPR_LOWER.slice(0, -1).map((t, i) => t + '|' + IPR_LOWER[i + 1]) };
  // the amounts of one arch, each in the first row out where it doesn't run into its neighbour
  const place = (arch, x0, o, keys) => { const ends = [], out = [];
    keys.forEach((k, i) => { const v = parseFloat((o || {})[k]) || 0; if (!(v > 0)) return;
      const cx = at(arch, x0, i), t = mm1(v), w = bw(t); let rr = 0; while (ends[rr] != null && ends[rr] > cx - w / 2 - 3) rr++;
      ends[rr] = cx + w / 2; out.push({ cx, t, w, rr }); });
    return { list: out, rows: ends.length }; };
  const PU = place(U, ux, ipr.upper, KEYS.U), PL = place(L, lx, ipr.lower, KEYS.L);
  const TOP = PU.rows ? 8 + PU.rows * ROW : 6;               // room above the upper gums for its amounts
  const OCC_U = TOP + 56, OCC_L = OCC_U + 36;                  // the upper and lower biting edges
  const NUM_U = OCC_U - 21, NUM_L = OCC_L + 21, CT_U = OCC_U - 9, CT_L = OCC_L + 9; // number rows; where the contacts are
  const GUM_L = OCC_L + 24, H = GUM_L + 32 + (PL.rows ? 8 + PL.rows * ROW : 6);
  let s = '<svg class="iprSvg" viewBox="0 0 ' + r(W) + ' ' + r(H) + '" role="img" aria-label="' + esc(label) + '">' +
    '<defs><linearGradient id="' + gid + 'u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1F4F8"/></linearGradient>' +
    '<linearGradient id="' + gid + 'l" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1F4F8"/></linearGradient></defs>' +
    // the gums: a soft band behind the necks of each arch (it shows between the teeth like the papillae do)
    '<rect class="gum" x="' + r(PADX - 8) + '" y="' + TOP + '" width="' + r(inner + 16) + '" height="32" rx="14"/>' +
    '<rect class="gum" x="' + r(PADX - 8) + '" y="' + GUM_L + '" width="' + r(inner + 16) + '" height="32" rx="14"/>' +
    '<line class="mid" x1="' + r(W / 2) + '" y1="' + (TOP + 2) + '" x2="' + r(W / 2) + '" y2="' + (GUM_L + 30) + '"/>' +
    '<text class="side" x="' + r(PADX - 3) + '" y="' + (TOP + 16) + '" text-anchor="end">R</text><text class="side" x="' + r(W - PADX + 3) + '" y="' + (TOP + 16) + '">L</text>' +
    '<text class="side" x="' + r(PADX - 3) + '" y="' + (GUM_L + 16) + '" text-anchor="end">R</text><text class="side" x="' + r(W - PADX + 3) + '" y="' + (GUM_L + 16) + '">L</text>';
  const teeth = (arch, x0, upper) => arch.teeth.map(o => {
    const x = r(x0 + o.x), cx = r(x0 + o.x + o.w / 2);
    return '<path class="crown" fill="url(#' + gid + (upper ? 'u' : 'l') + ')" d="' + iprCrownPath(o.w, o.h, o.kind) + '" transform="translate(' + x + ',' + r(upper ? OCC_U - o.h : OCC_L + o.h) + ')' + (upper ? '' : ' scale(1,-1)') + '"/>' +
      '<text class="tn" x="' + cx + '" y="' + (upper ? NUM_U : NUM_L) + '">' + o.t + '</text>';
  }).join('');
  s += teeth(U, ux, true) + teeth(L, lx, false);
  const pill = (cx, cy, txt, cls, w) => '<g class="bdg ' + cls + '"><rect x="' + r(cx - w / 2) + '" y="' + r(cy - BH / 2) + '" width="' + r(w) + '" height="' + BH + '" rx="' + BH / 2 + '"/><text x="' + cx + '" y="' + r(cy + .5) + '">' + txt + '</text></g>';
  // each amount (IPR or a space) out past the gums, a line to the contact, a dot on it
  const amounts = (P, upper) => P.list.map(b => {
    const cy = upper ? TOP - 11 - b.rr * ROW : GUM_L + 32 + 11 + b.rr * ROW, y1 = upper ? cy + BH / 2 : cy - BH / 2, y2 = upper ? CT_U : CT_L;
    return '<g class="lead"><line x1="' + b.cx + '" y1="' + r(y1) + '" x2="' + b.cx + '" y2="' + r(y2) + '"/><circle cx="' + b.cx + '" cy="' + r(y2) + '" r="2.4"/></g>' + pill(b.cx, cy, b.t, kind === 'sp' ? 'sp' : 'ipr', b.w);
  }).join('');
  // ▼ in the gum-side gap of a black triangle, pointing to the contact
  const bts = (arch, x0, upper, btO) => KEYS[upper ? 'U' : 'L'].map((k, i) => {
    if (!(btO && btO[k])) return '';
    const cx = at(arch, x0, i), a = arch.teeth[i], b = arch.teeth[i + 1], neck = upper ? OCC_U - Math.min(a.h, b.h) + 3 : OCC_L + Math.min(a.h, b.h) - 3, dir = upper ? 1 : -1;
    return '<polygon class="bt" points="' + r(cx - 5) + ',' + r(neck) + ' ' + r(cx + 5) + ',' + r(neck) + ' ' + cx + ',' + r(neck + dir * 9) + '"/>';
  }).join('');
  s += '<g style="--bdg:' + col + '">' + amounts(PU, true) + amounts(PL, false) + '</g>' + bts(U, ux, true, d.upperBT) + bts(L, lx, false, d.lowerBT);
  return s + '</svg>';
}
/* what the chart shows for this reading: the side picked on its switch (S.iprLayer while the case is open; the New case form
   keeps its own), else the spaces (Amir, 7 Oct 2026: "default it to spacing … because that's what's useful for tx planning") —
   or, at a visit with no spaces, the IPR: this visit's when there is any, else all visits so far */
function iprLayerOf(d, picked) {
  const t = sumContacts, now = t(d.upper) + t(d.lower), cum = t(d.cumUpper) + t(d.cumLower), sp = t(d.upperSpaces) + t(d.lowerSpaces);
  const both = d.visitCount > 1 && cum > 0 && !(Object.keys(d.cumUpper).every(k => mm1(d.cumUpper[k]) === mm1(d.upper[k])) && Object.keys(d.cumLower).every(k => mm1(d.cumLower[k]) === mm1(d.lower[k])));
  const lay = picked === 'sp' || picked === 'visit' || (picked === 'cum' && both) ? picked : sp > 0 ? 'sp' : now > 0 || !both ? 'visit' : 'cum';
  return { lay, both, now, cum, sp };
}
/* the black triangles switch, remembered on this computer like the hidden list columns (not patient data); on unless turned off.
   (The 6 Oct 2026 IPR / spaces / black triangles switches were kept under 'nloCases.iprShow': gone with the one switch.) */
const IPR_BT_KEY = 'nloCases.iprBt';
function iprBtShown() { try { return localStorage.getItem(IPR_BT_KEY) !== 'off'; } catch (e) { return true; } }
function iprBtSet(on) { try { localStorage.setItem(IPR_BT_KEY, on ? 'on' : 'off'); localStorage.removeItem('nloCases.iprShow'); } catch (e) { } }
/* the chart for one IPR Tracker reading (`d` from iprNoteFromVisits): the one switch above it — IPR this visit · IPR so far ·
   Spaces, each with its total (just "IPR" when all the visits add up to this one) — and the black triangles on/off beside it;
   under it, the shown amounts per arch. `form`: the New case form's copy, whose switch acts on the form (ui.js iprPrevLayer/Tog). */
function iprPanelsHTML(d, picked, form) {
  if (!d) return '';
  const t = sumContacts, mm = v => mm1(v) + ' mm', list = o => { const r = noteRowsOf(o); return r.length ? listRows(r) : 'none'; };
  const { lay, both, now, cum, sp } = iprLayerOf(d, picked), btOn = iprBtShown();
  const bt = noteBTsOf(d.upperBT).concat(noteBTsOf(d.lowerBT)).map(k => ckLabel(k));
  if (!(now > 0) && !(cum > 0) && !(sp > 0) && !bt.length) return '<div class="small muted iprNone">No IPR, spaces or black triangles recorded at this visit.</div>';
  // (each side's total in mm without the unit, like the amounts on the chart, so the three fit on one line in the case panel)
  const seg = (v, l, n, tip) => '<button type="button" class="iprSegB" data-act="' + (form ? 'iprPrevLayer' : 'iprLayer') + '" data-v="' + v + '" aria-pressed="' + (lay === v) + '" title="' + esc(tip + ': ' + (n > 0 ? mm(n) : 'none')) + '">' +
    '<i style="background:' + IPR_COL[v] + '"></i>' + l + ' <b>' + (n > 0 ? mm1(n) : 'none') + '</b></button>';
  const head = '<div class="iprSeg" role="group" aria-label="What the chart shows">' +
      (both ? seg('visit', 'IPR this visit', now, 'IPR at this visit') + seg('cum', 'IPR so far', cum, 'IPR over all ' + d.visitCount + ' visits') : seg('visit', 'IPR', now, 'IPR at this visit')) +
      seg('sp', 'Spaces', sp, 'Spaces at this visit') + '</div>' +
    '<button type="button" class="iprTog" data-act="' + (form ? 'iprPrevTog' : 'iprTog') + '" data-k="bt" aria-pressed="' + btOn + '" title="' + (btOn ? 'Hide' : 'Show') + ' the black triangles on the chart">' +
      '<span class="sw bt" aria-hidden="true"></span>Black triangles <b>' + (bt.length ? bt.length : 'none') + '</b></button>';
  const vals = lay === 'sp' ? { upper: d.upperSpaces, lower: d.lowerSpaces } : lay === 'cum' ? { upper: d.cumUpper, lower: d.cumLower } : { upper: d.upper, lower: d.lower };
  const what = lay === 'sp' ? 'Spaces' : lay === 'cum' ? 'IPR over all ' + d.visitCount + ' visits' : 'IPR this visit';
  const label = what + '. Upper: ' + list(vals.upper) + '. Lower: ' + list(vals.lower) + '.' + (btOn ? ' Black triangles: ' + (bt.join(', ') || 'none') + '.' : '');
  const show = btOn ? d : Object.assign({}, d, { upperBT: {}, lowerBT: {} }), uT = t(vals.upper), lT = t(vals.lower);
  return '<div class="iprMap' + (form ? ' iprPrev' : '') + '" data-layer="' + lay + '"><div class="iprMapHd">' + head + '</div>' + iprMapSVG(vals, show, IPR_COL[lay], label, lay === 'sp' ? 'sp' : 'ipr') +
    (uT + lT > 0 ? '<div class="iprMapFt"><span>Upper <b>' + mm(uT) + '</b></span><span>Lower <b>' + mm(lT) + '</b></span></div>' : '') + '</div>';
}
/* the New case form's look at a reading: the same chart and switch as the case panel's */
function iprPreviewHTML(r, picked) { return r && r.d ? iprPanelsHTML(r.d, picked, true) : ''; }
/* one line for the folded IPR heading: "Oct 2 visit · IPR 0.3 mm · 0.5 mm so far · spaces 0.3 mm · 1 black triangle" */
function iprSumText(r) {
  const d = r.d, t = sumContacts; if (!d) return '';
  const ipr = t(d.upper) + t(d.lower), cum = t(d.cumUpper) + t(d.cumLower), sp = t(d.upperSpaces) + t(d.lowerSpaces);
  const bt = noteBTsOf(d.upperBT).length + noteBTsOf(d.lowerBT).length;
  return [(r.date ? fmtDate(r.date) + ' visit' : 'Latest visit'), ipr > 0 ? 'IPR ' + mm1(ipr) + ' mm' : 'no IPR',
    d.visitCount > 1 && cum > 0 && Math.abs(cum - ipr) > 1e-9 ? mm1(cum) + ' mm so far' : '', sp > 0 ? 'spaces ' + mm1(sp) + ' mm' : '',
    bt ? bt + ' black triangle' + (bt > 1 ? 's' : '') : ''].filter(Boolean).join(' · ');
}

const IPR = {
  app: null, auth: null, db: null, emu: false,
  init() {
    if (IPR.app) return true;
    if (typeof firebase === 'undefined' || !firebase.initializeApp || !firebase.database) return false;
    IPR.emu = !!(typeof S !== 'undefined' && S.emu);
    const cfg = IPR.emu ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-cases', databaseURL: 'https://demo-nlo-cases.firebaseio.com', appId: 'demo' } : IPR_FB;
    IPR.app = firebase.initializeApp(cfg, 'ipr');
    IPR.auth = IPR.app.auth(); IPR.db = IPR.app.database();
    if (IPR.emu) { IPR.auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); IPR.db.useEmulator('127.0.0.1', 9000); }
    // stays connected on this computer, like the IPR Tracker itself (Amir, 6 Oct 2026: staff had to reconnect after every lock);
    // Team & security → Disconnect now signs it out
    try { IPR.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) { }
    return true;
  },
  user() { return IPR.auth && IPR.auth.currentUser; },
  waitUser() { return new Promise(res => { const off = IPR.auth.onAuthStateChanged(u => { off(); res(u); }); }); },
  async connect() {
    if (IPR.emu) return IPR.auth.signInAnonymously();
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    return IPR.auth.signInWithPopup(p);
  },
  async disconnect() { if (IPR.auth) await IPR.auth.signOut(); },
  norm(id) { return String(id || '').toLowerCase().replace(/[^a-z0-9]/g, ''); },
  /* { status: 'not-found' | 'no-visits' | 'ok', note, date, visits, assistant, initials } */
  async latest(chart) {
    const n = IPR.norm(chart); if (!n) return { status: 'not-found' };
    const snap = await IPR.db.ref('nlo/ipr/patients').once('value');
    const pts = Object.values(snap.val() || {}).filter(p => IPR.norm(p.patient_id) === n);
    if (!pts.length) return { status: 'not-found' };
    let visits = [];
    for (const p of pts) { const s = await IPR.db.ref('nlo/ipr/visits/' + p.id).once('value'); visits = visits.concat(Object.values(s.val() || {})); }
    if (!visits.length) return { status: 'no-visits', initials: pts[0].name || '' };
    return Object.assign({ status: 'ok', initials: pts[0].name || '' }, iprNoteFromVisits(visits));
  },
  /* every chart # at once (Amir, 5 Oct 2026: "can it be synced for all the pt. at once instead of individual basis?"): the patient
     list read once, then each matching patient's visits, a few at a time — Map(normalized chart # → the same answer as latest) */
  async latestMany(charts) {
    const want = new Set((charts || []).map(IPR.norm).filter(Boolean)), out = new Map(); if (!want.size) return out;
    const snap = await IPR.db.ref('nlo/ipr/patients').once('value'), byN = new Map();
    Object.values(snap.val() || {}).forEach(p => { const n = IPR.norm(p && p.patient_id); if (want.has(n)) { if (!byN.has(n)) byN.set(n, []); byN.get(n).push(p); } });
    const list = Array.from(want);
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async n => {
      const pts = byN.get(n) || []; if (!pts.length) { out.set(n, { status: 'not-found' }); return; }
      let visits = []; for (const p of pts) { const s = await IPR.db.ref('nlo/ipr/visits/' + p.id).once('value'); visits = visits.concat(Object.values(s.val() || {})); }
      out.set(n, visits.length ? Object.assign({ status: 'ok', initials: pts[0].name || '' }, iprNoteFromVisits(visits)) : { status: 'no-visits', initials: pts[0].name || '' });
    }));
    return out;
  },
  /* Staff Hub's office roster (same database; Staff Hub writes it, Cadence, the IPR Tracker and this app read it):
     { v, source, updatedAt, people: { id: { id, name, first, last, nick, short, title, chairside, active, end?, photo? } } } */
  async roster() { const s = await IPR.db.ref('nlo/cadence/roster').once('value'); return s.val(); }
};
/* demo mode: a made-up visit so the link can be tried without the real database */
const IPR_DEMO = {
  user() { return { email: 'demo' }; }, async connect() { }, async disconnect() { }, init() { return true; }, waitUser: async () => ({ email: 'demo' }),
  async latest(chart) {
    if (!IPR.norm(chart)) return { status: 'not-found' };
    return Object.assign({ status: 'ok', initials: 'DM' }, iprNoteFromVisits([
      { date: addDays(todayISO(), -21), upper_ipr: { 'UR2|UR1': '0.2', 'UL1|UL2': '0.2' }, lower_ipr: { 'LR2|LR1': '0.1' }, upper_spaces: {}, lower_spaces: {}, upper_bt: {}, lower_bt: {} },
      { date: todayISO(), upper_ipr: {}, lower_ipr: { 'LR3|LR2': '0.2', 'LL1|LL2': '0.1' }, upper_spaces: { 'UR1|UL1': '0.3' }, lower_spaces: { 'LL3|LL4': '0.2' }, upper_bt: { 'UR1|UL1': true }, lower_bt: { 'LR1|LL1': true } }
    ]));
  },
  async latestMany(charts) { const out = new Map(); for (const ch of charts || []) { const n = IPR.norm(ch); if (n && !out.has(n)) out.set(n, await IPR_DEMO.latest(ch)); } return out; },
  /* a made-up office roster: the demo's staff, one new hire without a login, one who has left */
  async roster() {
    const face = async n => 'data:image/jpeg;base64,' + b64(await demoFace(n)); // drawn faces, like the demo's patients
    const p = (id, first, last, title, extra) => Object.assign({ id, name: first + (last ? ' ' + last : ''), first, last, nick: first, short: first, title, chairside: true, active: true }, extra || {});
    return { v: 1, source: 'staff-hub', updatedAt: Date.now() - 3600e3, people: {
      s_amir: p('s_amir', 'Amir', 'Akhavan', 'Orthodontist / Owner', { name: 'Dr. Amir Akhavan', nick: 'Dr. A', short: 'Dr. A' }),
      s_sarah: p('s_sarah', 'Sarah', '', 'Treatment coordinator', { chairside: false, photo: await face(103) }), s_angelika: p('s_angelika', 'Angelika', '', 'Lab lead', { photo: await face(104) }),
      s_gwen: p('s_gwen', 'Gwen', '', 'Orthodontic assistant', { photo: await face(101) }), s_kaylee: p('s_kaylee', 'Kaylee', '', 'Orthodontic assistant', { active: false, end: addDays(todayISO(), -2), photo: await face(102) }),
      s_nora: p('s_nora', 'Nora', 'Newhire', 'Orthodontic assistant', { photo: await face(105) }), s_lena: p('s_lena', 'Lena', 'Leaveson', 'Front desk', { chairside: false, end: addDays(todayISO(), 9) }) } };
  }
};
function iprLink() { return S.demo ? IPR_DEMO : IPR; }
