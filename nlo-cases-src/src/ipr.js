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

/* Build the note for the newest visit of a patient's visit list (pure; used by tests too). */
function iprNoteFromVisits(visits) {
  const vs = visits.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const v = vs[0];
  const cum = (key, teeth) => vs.reduce((acc, x) => addContacts(acc, canonContacts(teeth, jp(x[key], null), "")), iprInit(teeth));
  return {
    date: v.date || '', assistant: v.assistant_initials || '', visits: vs.length,
    note: buildChartNote({
      upper: canonContacts(IPR_UPPER, jp(v.upper_ipr, null), ""), lower: canonContacts(IPR_LOWER, jp(v.lower_ipr, null), ""),
      upperSpaces: canonContacts(IPR_UPPER, jp(v.upper_spaces, null), ""), lowerSpaces: canonContacts(IPR_LOWER, jp(v.lower_spaces, null), ""),
      upperBT: canonContacts(IPR_UPPER, jp(v.upper_bt, null), false), lowerBT: canonContacts(IPR_LOWER, jp(v.lower_bt, null), false),
      incIPR: true, incCum: true, cumUpper: cum('upper_ipr', IPR_UPPER), cumLower: cum('lower_ipr', IPR_LOWER), visitCount: vs.length
    })
  };
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
      { date: addDays(todayISO(), -21), upper_ipr: { 'UR2|UR1': '0.2' }, lower_ipr: {}, upper_spaces: {}, lower_spaces: {}, upper_bt: {}, lower_bt: {} },
      { date: todayISO(), upper_ipr: {}, lower_ipr: { 'LR3|LR2': '0.2', 'LL1|LL2': '0.1' }, upper_spaces: { 'UR1|UL1': '0.3' }, lower_spaces: {}, upper_bt: { 'UR1|UL1': true }, lower_bt: {} }
    ]));
  },
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
