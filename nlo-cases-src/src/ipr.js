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

/* ---------- the IPR Tracker's printed chart, drawn in the case panel ----------
   Amir, 3 Oct 2026: instead of the written IPR note, "a diagram … with lines and where the spacing is and black triangles",
   like the IPR Tracker prints. Same layout as its PrintChart: the upper teeth in a row (UR7 … UL7, gums at the top), the
   lower teeth mirrored under them; at each contact with an amount, a line and the mm; ▼ at a black triangle. A panel is
   drawn only when it has something in it. Plain SVG markup (numbers and fixed labels only). */
const IPR_COL = { visit: '#1d4ed8', cum: '#7e22ce', space: '#0369a1' }; // the printed chart's colours
function iprArchSVG(up, lo, btU, btL, color, label) {
  const NUMS = [7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7], PAD = 6, CH = 48, GAP = 12;
  const lw = n => IPR_TW[n === 1 ? 2 : n]; // lower centrals are drawn with the lateral's narrower outline
  const xs = [], lx = []; let x = PAD; NUMS.forEach(n => { xs.push(x); x += IPR_TW[n]; }); const W = x + PAD;
  let y = PAD; NUMS.forEach(n => { lx.push(y); y += lw(n); }); const off = (W - (y + PAD)) / 2; // the lower row is centred
  // room for the amounts above the upper row / below the lower row only when that arch has any (keeps the panels short)
  const any = o => Object.values(o).some(v => parseFloat(v) > 0), ANN = any(up) ? 30 : 8, ANNB = any(lo) ? 30 : 8;
  const uBase = ANN + CH, lTop = uBase + GAP, lBot = lTop + CH, H = lBot + ANNB;
  const r = v => Math.round(v * 100) / 100;
  let s = '<svg class="iprSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' +
    '<line class="mid" x1="' + xs[7] + '" y1="' + (ANN - 2) + '" x2="' + xs[7] + '" y2="' + (lBot + 2) + '"/>' +
    '<line class="base" x1="' + PAD + '" y1="' + uBase + '" x2="' + (W - PAD) + '" y2="' + uBase + '"/><line class="base" x1="' + PAD + '" y1="' + lTop + '" x2="' + (W - PAD) + '" y2="' + lTop + '"/>';
  NUMS.forEach((n, i) => {
    s += '<path class="tooth" d="' + iprToothPath(n) + '" transform="translate(' + xs[i] + ',' + ANN + ')"/><text class="tn" x="' + r(xs[i] + IPR_TW[n] / 2) + '" y="' + r(ANN + IPR_TH[n] * .52) + '">' + n + '</text>';
    const dn = n === 1 ? 2 : n, h = IPR_TH[dn], l = r(lx[i] + off);
    s += '<path class="tooth" d="' + iprToothPath(dn) + '" transform="translate(' + l + ',' + (lTop + h) + ') scale(1,-1)"/><text class="tn" x="' + r(l + IPR_TW[dn] / 2) + '" y="' + r(lTop + h * .48) + '">' + n + '</text>';
  });
  // a contact: the amount on a short line outside the arch, and ▼ in the gum-side gap for a black triangle
  const mark = (cx, v, bt, upper) => {
    cx = r(cx); let m = '';
    if (v > 0) m += upper
      ? '<line x1="' + cx + '" y1="' + (ANN - 3) + '" x2="' + cx + '" y2="' + (ANN - 13) + '" stroke="' + color + '" stroke-width="1"/><text class="v" x="' + cx + '" y="' + (ANN - 16) + '" fill="' + color + '">' + mm1(v) + '</text>'
      : '<line x1="' + cx + '" y1="' + (lBot + 3) + '" x2="' + cx + '" y2="' + (lBot + 13) + '" stroke="' + color + '" stroke-width="1"/><text class="v" x="' + cx + '" y="' + (lBot + 24) + '" fill="' + color + '">' + mm1(v) + '</text>';
    if (bt) m += upper ? '<polygon class="bt" points="' + cx + ',' + (ANN + 10) + ' ' + (cx - 6) + ',' + (ANN + 1) + ' ' + (cx + 6) + ',' + (ANN + 1) + '"/>'
      : '<polygon class="bt" points="' + cx + ',' + (lBot - 10) + ' ' + (cx - 6) + ',' + (lBot - 1) + ' ' + (cx + 6) + ',' + (lBot - 1) + '"/>';
    return m;
  };
  Object.keys(up).forEach((k, i) => { s += mark(xs[i] + IPR_TW[NUMS[i]], parseFloat(up[k]) || 0, btU && btU[k], true); });
  Object.keys(lo).forEach((k, i) => { s += mark(lx[i] + off + lw(NUMS[i]), parseFloat(lo[k]) || 0, btL && btL[k], false); });
  return s + '</svg>';
}
/* the panels for one IPR Tracker reading (`d` from iprNoteFromVisits): IPR this visit, IPR over all visits (when there's
   more than one and it isn't the same picture), spaces & black triangles */
function iprPanelsHTML(d) {
  if (!d) return '';
  const t = sumContacts, mm = v => mm1(v) + ' mm', same = (a, b) => Object.keys(a).every(k => mm1(a[k]) === mm1(b[k]));
  const list = o => { const r = noteRowsOf(o); return r.length ? listRows(r) : 'none'; };
  const bts = (u, l) => noteBTsOf(u).concat(noteBTsOf(l)).map(k => ckLabel(k));
  const panel = (k, col, title, totals, svg) => '<div class="iprP" data-p="' + k + '"><div class="iprPH"><b style="color:' + col + '">' + title + '</b><span>' + totals + '</span></div>' + svg + '</div>';
  const uI = t(d.upper), lI = t(d.lower), uS = t(d.upperSpaces), lS = t(d.lowerSpaces), cU = t(d.cumUpper), cL = t(d.cumLower), bt = bts(d.upperBT, d.lowerBT);
  let h = '';
  if (uI + lI > 0) h += panel('visit', IPR_COL.visit, 'IPR this visit', 'Upper ' + mm(uI) + ' · Lower ' + mm(lI) + ' · Total ' + mm(uI + lI),
    iprArchSVG(d.upper, d.lower, null, null, IPR_COL.visit, 'IPR this visit. Upper: ' + list(d.upper) + '. Lower: ' + list(d.lower) + '.'));
  if (d.visitCount > 1 && cU + cL > 0 && !(same(d.cumUpper, d.upper) && same(d.cumLower, d.lower)))
    h += panel('cum', IPR_COL.cum, 'IPR so far · ' + d.visitCount + ' visits', 'Upper ' + mm(cU) + ' · Lower ' + mm(cL) + ' · Total ' + mm(cU + cL),
      iprArchSVG(d.cumUpper, d.cumLower, null, null, IPR_COL.cum, 'IPR over all ' + d.visitCount + ' visits. Upper: ' + list(d.cumUpper) + '. Lower: ' + list(d.cumLower) + '.'));
  if (uS + lS > 0 || bt.length) h += panel('space', IPR_COL.space, 'Spaces &amp; black triangles',
    (uS + lS > 0 ? 'Upper ' + mm(uS) + ' · Lower ' + mm(lS) : 'No spaces') + (bt.length ? ' · ' + bt.length + ' black triangle' + (bt.length > 1 ? 's' : '') + ' <i class="btKey" aria-hidden="true"></i>' : ''),
    iprArchSVG(d.upperSpaces, d.lowerSpaces, d.upperBT, d.lowerBT, IPR_COL.space, 'Spaces. Upper: ' + list(d.upperSpaces) + '. Lower: ' + list(d.lowerSpaces) + '. Black triangles: ' + (bt.join(', ') || 'none') + '.'));
  if (!h) return '<div class="small muted">No IPR, spaces or black triangles recorded at this visit.</div>';
  return (uI + lI > 0 ? '' : '<div class="small muted iprNone">No IPR at this visit.</div>') + h;
}
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
    // this tab only, and signed out whenever NLO Cases locks (so it never outlives the person's session)
    try { IPR.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION); } catch (e) { }
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
