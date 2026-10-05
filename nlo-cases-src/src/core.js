'use strict';
/* =====================================================================
   NLO Cases — encrypted case tracker for Next Level Orthodontics
   - Every case is encrypted in the browser (AES-256-GCM) before it is
     stored; Firestore only holds ciphertext plus non-identifying flags.
   - Each person has their own login. The office key ring is sealed to
     each person's own key pair (ECDH P-256), whose private half is
     sealed with a key derived from their password (PBKDF2-SHA256 600k).
   - Removing someone deactivates them (rules cut access at once) and
     rotates the office key so later data is under a key they never had.
   ===================================================================== */

/* ---------- Firebase project (filled in after the project is created) ---------- */
const FB_CONFIG = {
  apiKey: "__API_KEY__",
  authDomain: "__AUTH_DOMAIN__",
  projectId: "__PROJECT_ID__",
  appId: "__APP_ID__"
};
/* Synthetic login addresses for staff usernames (no mail is ever sent to them). */
const STAFF_DOMAIN = 'staff.thenextlevelorthodontics.com';
const KDF_ITER = 600000;

/* ---------- Case types and the stages each one moves through ---------- */
const FLOWS = {
  /* labDone: from this stage on, the case's next date is its delivery date, not the lab date. Outside labs: once the case
     is in Manufacturing (Amir, 2 Oct 2026: "once it goes to manufacturing … it should be showing the delivery date") */
  outside: { label: 'Outside aligners & braces', labDone: 'mfg', stages: [
    ['submit', 'To submit'], ['dra', 'Dr. A action'], ['mfg', 'Manufacturing'],
    ['shipped', 'Shipped'], ['arrived', 'Arrived'], ['milestones', 'Checked into Milestones'] ] },
  appliance: { label: 'Appliances', labDone: 'mfg', stages: [
    ['submit', 'To submit'], ['hold', 'Hold (CBCT/Zoom)'], ['submitted', 'Submitted to lab'],
    ['mfg', 'Manufacturing'], ['shipped', 'Shipped'], ['milestones', 'Checked into Milestones'] ] },
  /* MARPE has its own steps (Amir, 2 Oct 2026): the STL scan and a CBCT of the upper and lower jaws on file first,
     then the lab, a Zoom call on a set date, design approval, delivery. The Zoom call is the case's next date until
     the design is approved; after that, the delivery date. */
  marpe: { label: 'MARPE', labDone: 'approved', zoomUntil: 'approved', stages: [
    ['records', 'Records: STL + CBCT'], ['submitted', 'Submitted to lab'], ['zoom', 'Zoom call scheduled'],
    ['approved', 'Design approved'], ['delivered', 'Delivered'] ] },
  /* in fabrication = the NL Lab checklist each Asana case carried as subtasks (Exported STLs → Final Wash and Dry);
     the board shows the seven steps as one "In fabrication" column */
  inhouse: { label: 'In-house lab', labDone: 'pack', stages: [
    ['txp', 'TxP needed'],
    // Amir, 3 Oct 2026: "add a middle step that says TxP completed or approved and it would still let me enter the U/L stages
    // because I may not be able to export them right away" — the plan is done and its counts are in, waiting to be exported
    ['txpok', 'TxP approved'],
    ['fab', 'Export STLs'], ['send', 'Send to printer'], ['print', 'Printing'], ['thermo', 'Thermoforming'], ['trim', 'Trimming'], ['polish', 'Polishing'], ['wash', 'Final wash & dry'],
    ['pack', 'Made – needs packaging'], ['checkedin', 'Checked in'] ],
    groups: [{ l: 'In fabrication', stages: ['fab', 'send', 'print', 'thermo', 'trim', 'polish', 'wash'] }] },
  retainer: { label: 'Retainers & mouthguards', labDone: 'milestones', stages: [
    ['print', 'Printing'], ['milestones', 'Milestones'], ['sarah', 'On Sarah’s desk'], ['pickup', 'Front desk pickup'] ] },
  models: { label: 'Study models', labDone: 'ready', stages: [ ['print', 'To print'], ['ready', 'Ready'] ] },
  retreat: { label: 'Retreatment', stages: [
    ['intake', 'Intake & assessment'], ['review', 'Pending review'], ['proposal', 'Send proposal'],
    ['progress', 'In progress'], ['completed', 'Completed'] ] },
  misc: { label: 'Other (misc.)', stages: [ ['todo', 'To do'], ['waiting', 'Waiting'] ] }
};
const TYPES = [
  { k: 'oliv', l: 'Oliv', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'angel', l: 'Angel Aligners', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'invisalign', l: 'Invisalign', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'ulab', l: 'uLab', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'insmile', l: 'InSmile', flow: 'outside', cls: 't-aligner' },
  /* legacy: no longer offered for new cases (Amir, 1 Oct 2026); kept so imported or older InBrace cases still open and edit */
  { k: 'inbrace', l: 'InBrace', flow: 'outside', cls: 't-aligner', legacy: true },
  { k: 'nla', l: 'In-house aligners', flow: 'inhouse', cls: 't-lab', aligner: true },
  { k: 'appliance', l: 'Appliance', flow: 'appliance', cls: 't-appl' },
  { k: 'marpe', l: 'MARPE', flow: 'marpe', cls: 't-appl' },
  { k: 'retainer', l: 'Retainers & whitening', flow: 'retainer', cls: 't-ret' },
  { k: 'mouthguard', l: 'Mouthguard', flow: 'retainer', cls: 't-ret' },
  { k: 'models', l: 'Study models', flow: 'models', cls: 't-misc' },
  /* legacy (Amir, 2 Oct 2026): Retreatment is no longer a case type, and "Dr. A (misc.)" became Study models;
     both stay so imported or older cases still open and edit (misc also catches Asana tasks that match no type) */
  { k: 'retreat', l: 'Retreatment', flow: 'retreat', cls: 't-retx', legacy: true },
  { k: 'misc', l: 'Other (misc.)', flow: 'misc', cls: 't-misc', legacy: true }
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.k, t]));
/* where each aligner company's cases are worked on (Amir, 2 Oct 2026; not for appliances or InSmile); in-house sets open
   Titan's web version, the released one and the early-access (beta) one — opening any of them copies the patient's name */
/* where each scanner's scans are (Amir, 3 Oct 2026: "link that back to the actual website for myitero.com or allied-star one in
   case if you need to log in and look at the scans"): MyiTero, and AlliedStar's AS Connect web app — its US & Canada site
   (Amir: "make sure the as connect link is for US and north america"; the address AlliedStar's own "Log in to AS Connect"
   gives for US & Canada); like the portals, opening one copies the patient's name */
const SCAN_SITE = { 'Allied Star': { l: 'AS Connect (US & Canada)', u: 'https://asconnect-us.allied-star.com/login' }, iTero: { l: 'MyiTero', u: 'https://myitero.com/' } };
const PORTALS = {
  nla: [{ l: 'Titan (web)', u: 'https://client.titandentaldesign.com/Live/index.html' }, { l: 'Titan beta (web)', u: 'https://client.titandentaldesign.com/EA/index.html' }],
  oliv: [{ l: 'Oliv portal', u: 'https://portal.olivortho.com/' }, { l: 'Dental Monitoring', u: 'https://dental-monitoring.com/doctor/login' }],
  invisalign: [{ l: 'Invisalign Doctor Site', u: 'https://vip.invisalign.com/' }],
  angel: [{ l: 'Angel iOrtho', u: 'https://iortho.angelalign.com/cas/login?service=https://iortho.angelalign.com/OPM/shiro-cas' }],
  ulab: [{ l: 'uDesign Cloud', u: 'https://udesign.cloud/' }]
};
/* types to offer in pickers: retired types only while some case still uses them (or one is already chosen) */
function typesShown(cases, chosen) { return TYPES.filter(t => !t.legacy || t.k === chosen || (cases || []).some(c => c.type === t.k)); }
const SCANNERS = ['Allied Star', 'iTero', 'Other'];
/* Stages that need the doctor, and stages where the case is in fabrication. */
const DR_STAGES = ['dra', 'txp', 'todo', 'review'];
const FAB_STAGES = ['mfg', 'fab', 'send', 'print', 'thermo', 'trim', 'polish', 'wash', 'submitted', 'approved'];
/* the patient's chief concern, written down in the patient's own words (Amir, 3 Oct 2026, evening: "take out all the options and
   just write in exactly what they say, for example, my bite is not right"; that morning it had become a fixed list to tap,
   replacing buttons learned from whatever was typed most, like "This is initial"). A first set asks for the chief concern,
   later sets for the CC from last visit; older text that was never a concern ("This is initial") isn't shown */
const CC_NOTE = /^(this is (an? )?|it'?s (an? )?|pt is )?(initial|first|new)( (set|case|submission|scan|start|tx|treatment|aligners?))?[.!]*$/i;
const CC_NONE = /^(none|n\/a|na|-|no concerns?|nothing)\.?$/i;
/* what a case shows as its CC: '' for nothing (or a note that was never a concern, like "This is initial"), 'None', or the words */
function ccShown(c) { const t = String((c && c.cc) || '').trim(); return !t || CC_NOTE.test(t) ? '' : CC_NONE.test(t) ? 'None' : t; }
/* a later set (refinement, mid-course, finishing, an InSmile DE) asks for the CC from last visit; a first set for the chief concern */
function ccLater(c) { return !!c && (c.initial === 'no' || c.initial === 'mid' || c.variant === 'finishing' || /^de\d$/.test(c.initial || '')); }
function ccTitle(c) { return ccLater(c) ? 'Patient’s CC from last visit' : 'Patient’s chief concern'; }
/* MARPE: both records have to be on file before the case goes to the lab (Amir, 2 Oct 2026) */
const MARPE_RECORDS = [['stl', 'STL scan', 'STL'], ['cbct', 'CBCT (upper & lower jaws)', 'CBCT']];
function recordsMissing(c) { const r = c.records || []; return MARPE_RECORDS.filter(([k]) => !r.includes(k)); }

function typeOf(c) { return TYPE[c.type] || TYPE.misc; }
function flowOf(c) { return FLOWS[typeOf(c).flow]; }
function stageLabel(c) { const k = liveStage(c), s = caseStages(c).find(x => x[0] === k) || flowOf(c).stages.find(x => x[0] === k); return s ? s[1] : (k || '—'); }
/* retired steps: a case saved at one shows (and moves on) from the step that replaced it; history keeps the old name.
   In-house "Reset needed in 2 days" (Amir, 3 Oct 2026: it was never a step after TxP — resets were one or two aligners
   needed in a couple of days, kept in a column of the NL Lab project — and "we are actually not doing resets any longer") */
const RETIRED_STAGES = { inhouse: { reset: { to: 'txp', l: 'Reset needed in 2 days' } } };
function liveStage(c) { const r = c && (RETIRED_STAGES[typeOf(c).flow] || {})[c.stage]; return r ? r.to : c && c.stage; }
function retiredStageLabel(c, k) { const r = (RETIRED_STAGES[typeOf(c).flow] || {})[k]; return r ? r.l : ''; }
function liveCases(list) { (list || []).forEach(c => { if (c) c.stage = liveStage(c); }); return list; }
/* Ship to patient (aligners): the case ends when it ships (Amir, 3 Oct 2026: "if the case is being shipped, the last stage
   is shipped (we still need to know the EXPECTED DELIVERY). so shipped status = complete"). Outside labs: Shipped is the
   last step (Arrived and Checked into Milestones don't apply); in-house: the last step reads "Shipped to patient" (it is
   "Checked in" for everyone else). Reaching it marks the case complete (moveStage, saveEdit, lab emails). */
function shipEnd(c) { if (!c || !c.shipToPatient || !(TYPE[c.type] || {}).aligner) return null; const fl = typeOf(c).flow; return fl === 'outside' ? 'shipped' : fl === 'inhouse' ? 'checkedin' : null; }
/* the steps this case goes through: its flow's, ending at Shipped for a case shipped to the patient */
function caseStages(c) {
  const st = flowOf(c).stages, e = shipEnd(c); if (!e) return st;
  return st.slice(0, st.findIndex(s => s[0] === e) + 1).map(s => s[0] === 'checkedin' ? ['checkedin', 'Shipped to patient'] : s);
}
/* the case's delivery date is the patient's delivery appointment (Amir, 3 Oct 2026: "change it to Delivery appt");
   a case shipped to the patient has no appointment, just the expected delivery */
function delWord(c) { return c && c.shipToPatient && (TYPE[c.type] || {}).aligner ? 'Expected delivery' : 'Delivery appt'; }
function stageIndex(c) { return flowOf(c).stages.findIndex(x => x[0] === c.stage); }
function firstStage(type) { return FLOWS[(TYPE[type] || TYPE.misc).flow].stages[0][0]; }
/* the stage group a stage belongs to (e.g. the in-house "In fabrication" steps), or null */
function stageGroup(flow, k) { return (flow.groups || []).find(g => g.stages.includes(k)) || null; }
/* what a stage move still needs first: MARPE records before the case reaches the lab, and a date to be "Zoom call scheduled";
   in-house aligners: the upper/lower aligner counts and any attachment templates as the case reaches TxP approved — or
   Export STLs or later when it skips that step (Amir, 2–3 Oct 2026; the move always asks, filled in with what the case has) */
function stageNeeds(c, to) {
  const fl = typeOf(c).flow, keys = flowOf(c).stages.map(s => s[0]), from = keys.indexOf(c.stage), ti = keys.indexOf(to), out = [];
  if (fl === 'inhouse') { const g = keys.includes('txpok') ? keys.indexOf('txpok') : keys.indexOf('fab'); if (g >= 0 && ti >= g && from < g) out.push('aligners'); return out; }
  if (fl !== 'marpe') return out;
  const sub = keys.indexOf('submitted');
  if (ti >= sub && from < sub && recordsMissing(c).length) out.push('records');
  if (to === 'zoom' && !c.zoomDate) out.push('zoom');
  return out;
}
/* lab names: Partner Dental Studios rebranded as Partners Dental Solutions (Amir, 3 Oct 2026). Cases saved before keep the old
   name in their data, so everything that shows or compares a lab goes through labName() */
const LAB_RENAMED = { 'Partner Dental Studios': 'Partners Dental Solutions' };
function labName(v) { return LAB_RENAMED[v] || v || ''; }
/* attachment templates on an in-house set: none, upper, lower or both ('' = not answered yet) */
const AT_OPTS = [{ v: 'none', l: 'None' }, { v: 'U', l: 'Upper' }, { v: 'L', l: 'Lower' }, { v: 'UL', l: 'Upper & Lower' }];
function atLabel(v) { const o = AT_OPTS.find(x => x.v === v); return o ? o.l : ''; }
function hasAT(c) { return ['U', 'L', 'UL'].includes(c.atTemplates); }
/* from TxP approved on, an in-house set needs its aligner counts and the attachment-template answer */
function alignersMissing(c) { return !((Number(c.alU) || 0) + (Number(c.alL) || 0) > 0) || !c.atTemplates; }
/* arches to treat, for aligners and InSmile: '' = upper & lower (the default, and every older case), 'U' = upper only,
   'L' = lower only (Amir, 2 Oct 2026: not every case treats both arches) */
const TREAT_OPTS = [{ v: 'UL', l: 'Upper & lower' }, { v: 'U', l: 'Upper only' }, { v: 'L', l: 'Lower only' }];
function oneArch(c) { return c && (c.treatArch === 'U' || c.treatArch === 'L') ? c.treatArch : ''; }
function treatArchLabel(v) { return v === 'U' ? 'Upper arch only' : v === 'L' ? 'Lower arch only' : ''; }
/* the attachment-template answers that fit the arches being treated, and an earlier answer moved onto them
   (upper only: Upper & Lower becomes Upper, a Lower-only answer has to be asked again) */
function atOptsFor(ta) { return ta === 'U' || ta === 'L' ? AT_OPTS.filter(o => o.v === 'none' || o.v === ta) : AT_OPTS; }
function atFor(at, ta) { at = at || ''; if (ta !== 'U' && ta !== 'L') return at; return at === 'UL' ? ta : (at === 'U' || at === 'L') && at !== ta ? '' : at; }
/* "the upper and lower aligners" / "the upper aligners", for the notes that ask for the counts */
function alAskText(c) { const a = oneArch(c); return a === 'U' ? 'the upper aligners' : a === 'L' ? 'the lower aligners' : 'the upper and lower aligners'; }
/* The date a case is working toward: its lab completion date until the lab work is done (outside labs and appliances:
   until the case is in Manufacturing), then its delivery date.
   (No separate due date any more — Amir, 2 Oct 2026. Older cases that only have one still use it.) */
function dueOf(c) { return labDueOf(c) || apptOf(c); }
/* The lists show the two sides of that in their own columns (Amir, 4 Oct 2026: "if the lab date is past due, I'm not seeing
   what is the appointment date"). The lab side, while it's still ahead: MARPE's Zoom call until the design is approved,
   else the lab completion date until the case is past the lab step. */
function labDueOf(c) {
  const f = flowOf(c), si = stageIndex(c), zu = f.zoomUntil ? f.stages.findIndex(s => s[0] === f.zoomUntil) : -1;
  if (c.zoomDate && f.zoomUntil && si < zu) return { d: c.zoomDate, k: 'zoom' };
  if (c.labDate && !labStepDone(c)) return { d: c.labDate, k: 'lab' };
  return null;
}
/* past the lab step: from the flow's labDone stage on (outside labs and appliances: Manufacturing; in-house: Made – needs packaging) */
function labStepDone(c) {
  const f = flowOf(c); if (!f.labDone) return false;
  const done = f.stages.findIndex(s => s[0] === f.labDone); return done >= 0 && stageIndex(c) >= done;
}
/* the appointment side: the delivery appt (a case shipped to the patient: the expected delivery); older cases with only a due date use it */
function apptOf(c) { return c.deliveryDate ? { d: c.deliveryDate, k: 'delivery' } : c.dueDate ? { d: c.dueDate, k: 'due' } : null; }
function dueDateOf(c) { const x = dueOf(c); return x ? x.d : ''; }
/* the time that goes with a date, if one was set (Zoom call, delivery appt) */
function timeOf(c, k) { return (k === 'zoom' ? c.zoomTime : k === 'delivery' ? c.deliveryTime : '') || ''; }
/* for sorting: the date, then its time (a date with no time sorts after the timed ones that day) */
function dateKey(d, t) { return d ? d + 'T' + (t || '24:00') : ''; }
function dueKeyOf(c) { const x = dueOf(c); return x ? dateKey(x.d, timeOf(c, x.k)) : ''; }
function labKeyOf(c) { const x = labDueOf(c); return x ? dateKey(x.d, timeOf(c, x.k)) : ''; }
function apptKeyOf(c) { const x = apptOf(c); return x ? dateKey(x.d, timeOf(c, x.k)) : ''; }
/* ---------- in-house aligner sets: how many aligners each case made, and the patient's total ---------- */
const normChart = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const normName = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
/* the same case under another id (one brought back from Deleted cases or a backup gets a new id): same patient, type and
   the time it was first made ('' when it doesn't say) */
function caseSig(d) { return d && d.createdAt ? normName(d.patient) + '|' + (d.type || '') + '|' + d.createdAt : ''; }
/* same patient: by chart # when both have one, otherwise by name */
function samePatient(a, b) {
  const ca = normChart(a.chart), cb = normChart(b.chart);
  if (ca && cb) return ca === cb;
  return !!normName(a.patient) && normName(a.patient) === normName(b.patient);
}
/* aligners in one in-house set: upper + lower (aligners, not stages) */
function alN(c) { return Number(c.aligners) || (Number(c.alU) || 0) + (Number(c.alL) || 0); }
/* this patient's in-house aligner cases, oldest first: Initial, Refinement 1, 2…, Mid-course correction, Finishing.
   `c` may be an unsaved form (no id); `pool` is every case we can see (open and completed). */
function alignerSets(c, pool) {
  const mine = (pool || []).filter(x => x && x.type === 'nla' && !x.locked && (!c.id || x.id !== c.id) && samePatient(x, c));
  const seen = new Set(); const list = mine.filter(x => !seen.has(x.id) && seen.add(x.id));
  if (c.type === 'nla') list.push(c);
  const when = x => (x.scanDate || '') + '|' + String(x.createdAt || (x === c && !c.id ? 9e15 : 0)).padStart(16, '0');
  list.sort((a, b) => when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0);
  // a refinement's own number when it has one (picked on the case, 5 Oct 2026), else the next after the one before
  let ref = 0;
  return list.map(x => ({ id: x.id || '', me: x === c, n: alN(x), done: x.status === 'done',
    l: x.variant === 'finishing' ? 'Finishing' : x.initial === 'yes' ? 'Initial' : x.initial === 'no' ? 'Refinement ' + (ref = Number(x.refN) || ref + 1) : x.initial === 'mid' ? 'Mid-course' : 'Set' }));
}

/* ---------- in-house aligner treatment: Start and Expected removal ----------
   Amir, 3 Oct 2026: "for initial cases, or additional cases that have this missing. allow Start and expected removal date.
   and based on that show a graph for each patient on where they are in treatment" — "this is only for IN HOUSE aligner cases".
   The dates are the patient's: entered on the initial set, or on a later set while the patient has none (or with Change, to
   update them). The patient's dates are the ones saved last (txAt; older entries by when the set was made). `c` is never
   counted as "another set": it's added back only when it has dates of its own. */
function txOf(c, pool) {
  const mine = (pool || []).filter(x => x && x.type === 'nla' && !x.locked && x.txStart && x.txEnd && !(c.id && x.id === c.id) && samePatient(x, c));
  if (c.type === 'nla' && c.txStart && c.txEnd) mine.push(c);
  if (!mine.length) return null;
  const when = m => m.txAt || m.createdAt || 0;
  const x = mine.sort((a, b) => when(b) - when(a))[0];
  return { start: x.txStart, end: x.txEnd, from: x };
}
function isoDate(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }
/* where the patient is: day and month counts against the expected removal (`today` = an ISO date, for tests) */
function txProgress(t, today) {
  const s = isoDate(t.start), e = isoDate(t.end), n = today ? isoDate(today) : isoDate(todayISO());
  const days = (a, b) => Math.round((b - a) / 864e5), total = Math.max(1, days(s, e)), el = days(s, n);
  const months = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0);
  return { total, el, pct: Math.max(0, Math.min(1, el / total)), month: months(s, n) + 1, ofMonths: Math.max(1, Math.round(total / 30.44)), left: days(n, e), before: el < 0, over: days(e, n) > 0 };
}
/* "Month 7 of 18 · 36% · 11 months left", "Starts Oct 9", "3 weeks past expected removal" */
function txText(p, t) {
  const span = d => d >= 60 ? Math.round(d / 30.44) + ' months' : d >= 14 ? Math.round(d / 7) + ' weeks' : d + (d === 1 ? ' day' : ' days');
  if (p.before) return 'Starts ' + fmtDate(t.start) + ' (in ' + span(-p.el) + ')';
  if (p.over) return span(-p.left) + ' past expected removal';
  return 'Month ' + Math.min(p.month, p.ofMonths) + ' of ' + p.ofMonths + ' · ' + Math.round(p.pct * 100) + '% · ' + (p.left ? span(p.left) + ' left' : 'removal today');
}
/* treatment time in whole months (Amir, 4 Oct 2026: "enter the date, pick 6 months treatment time > it will put the date as
   exactly 6 months from that day"): the same day that many months on — the month's last day when it's shorter (Aug 31 + 6
   months = Feb 28). Only for whole dates (a year still being typed, like 0202, gives nothing). */
const TX_MONTHS = [3, 6, 9, 12, 15, 18, 24], TX_MAX_MONTHS = 60;
function txDateOk(iso) { return /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(iso || '')); }
function addMonthsTx(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1), last = new Date(y, m + n, 0).getDate();
  dt.setDate(Math.min(d, last)); return isoOf(dt);
}
/* the treatment time if the expected removal is a whole number of months after the start (as addMonthsTx counts), else 0 */
function txMonths(start, end) {
  if (!txDateOk(start) || !txDateOk(end) || end <= start) return 0;
  const [y1, m1] = start.split('-').map(Number), [y2, m2] = end.split('-').map(Number), n = (y2 - y1) * 12 + (m2 - m1);
  return n >= 1 && n <= TX_MAX_MONTHS && addMonthsTx(start, n) === end ? n : 0;
}

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid8() { return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join(''); }
function todayISO() { const d = new Date(); return isoOf(d); }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return isoOf(dt); }
function dayDiff(iso) { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); const a = new Date(y, m - 1, d); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((a - t) / 86400000); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); const opts = { month: 'short', day: 'numeric' }; if (y !== new Date().getFullYear()) opts.year = 'numeric'; return dt.toLocaleDateString(undefined, opts); }
function fmtDay(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtTime(t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; const h = +m[1]; return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM'); }
/* one-click tracking: the carrier's own page, from the number's shape (UPS 1Z…, USPS 20–22 digits starting
   with 9, FedEx 12/15/20/22 digits), else the carrier a lab email names */
const TRACK_URL = { ups: 'https://www.ups.com/track?tracknum=', fedex: 'https://www.fedex.com/fedextrack/?trknbr=', usps: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=', dhl: 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=' };
const CARRIER_NAME = { ups: 'UPS', fedex: 'FedEx', usps: 'USPS', dhl: 'DHL' };
function trackInfo(num, carrier) {
  const n = String(num || '').replace(/[\s-]+/g, '').toUpperCase(); if (!/^[A-Z0-9]{8,34}$/.test(n)) return null;
  let k = /^1Z[0-9A-Z]{16}$/.test(n) ? 'ups' : /^9\d{19,21}$/.test(n) ? 'usps' : /^(\d{12}|\d{15}|\d{20}|\d{22})$/.test(n) ? 'fedex' : '';
  if (!k) { k = String(carrier || '').toLowerCase().replace(/[^a-z]/g, ''); if (!TRACK_URL[k]) k = ''; }
  return { n, carrier: CARRIER_NAME[k] || '', url: k ? TRACK_URL[k] + encodeURIComponent(n) : '' };
}
/* a case can carry more than one number (spaces, commas or new lines between them) */
function trackList(c) { return String((c && c.tracking) || '').split(/[\s,;]+/).map(x => trackInfo(x, c.carrier)).filter(Boolean); }
/* a short fingerprint of a case's Notes text: who wrote the Notes (notesBy / notesAt) counts only while its notesH matches the
   text, so a change made by an older copy of the app (which doesn't record who) doesn't keep the earlier writer's name */
function noteHash(t) { t = String(t || '').trim(); let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function initials(name) { const p = String(name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
/* random characters without modulo bias (rejection sampling) */
function randChars(n) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', lim = 256 - (256 % A.length); let out = '';
  while (out.length < n) { for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) { if (b < lim && out.length < n) out += A[b % A.length]; } }
  return out;
}
function tempPassword() { return randChars(12).replace(/(.{4})(?=.)/g, '$1-'); }
function recoveryCode() { return randChars(24).replace(/(.{4})(?=.)/g, '$1-'); }
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-'); }

/* ---------- crypto ---------- */
const TE = new TextEncoder(), TD = new TextDecoder();
function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), CH = 0x8000;
  let s = ''; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
const Crypto = {
  async pwKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', TE.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async seal(key, bytes, aad) {
    const iv = rnd(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, key, bytes);
    return { iv: b64(iv), ct: b64(ct) };
  },
  async open(key, box, aad) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: TE.encode(aad) }, key, unb64(box.ct));
    return new Uint8Array(pt);
  },
  async sealJSON(key, obj, aad) { return Crypto.seal(key, TE.encode(JSON.stringify(obj)), aad); },
  async openJSON(key, box, aad) { return JSON.parse(TD.decode(await Crypto.open(key, box, aad))); },
  async pwSeal(pw, bytes, aad, iter) {
    iter = iter || KDF_ITER; const salt = rnd(16);
    const k = await Crypto.pwKey(pw, salt, iter); const box = await Crypto.seal(k, bytes, aad);
    return { salt: b64(salt), iter, iv: box.iv, ct: box.ct };
  },
  async pwOpen(pw, box, aad) { const k = await Crypto.pwKey(pw, unb64(box.salt), box.iter || KDF_ITER); return Crypto.open(k, box, aad); },
  EC: { name: 'ECDH', namedCurve: 'P-256' },
  async newPair() { return crypto.subtle.generateKey(Crypto.EC, true, ['deriveBits']); },
  async pubJwk(pair) { const j = await crypto.subtle.exportKey('jwk', pair.publicKey); return { kty: j.kty, crv: j.crv, x: j.x, y: j.y }; },
  async privBytes(pair) { return new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)); },
  async importPriv(bytes) { return crypto.subtle.importKey('pkcs8', bytes, Crypto.EC, false, ['deriveBits']); },
  async boxKey(bits, info) {
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async sealTo(pub, bytes, info) {
    const pk = await crypto.subtle.importKey('jwk', { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, ext: true }, Crypto.EC, false, []);
    const eph = await Crypto.newPair();
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256);
    const k = await Crypto.boxKey(bits, info); const box = await Crypto.seal(k, bytes, info);
    return { epk: await Crypto.pubJwk(eph), iv: box.iv, ct: box.ct };
  },
  async openFrom(priv, box, info) {
    const e = box.epk;
    const epk = await crypto.subtle.importKey('jwk', { kty: e.kty, crv: e.crv, x: e.x, y: e.y, ext: true }, Crypto.EC, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256);
    const k = await Crypto.boxKey(bits, info); return Crypto.open(k, box, info);
  },
  /* key ring = { "1": base64(32 random bytes), "2": ... } */
  newRingKey() { return b64(rnd(32)); },
  async ringKeys(ring) {
    const out = {};
    for (const v of Object.keys(ring)) out[v] = await crypto.subtle.importKey('raw', unb64(ring[v]), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return out;
  },
  ringBytes(ring) { return TE.encode(JSON.stringify(ring)); },
  ringFrom(bytes) { return JSON.parse(TD.decode(bytes)); }
};

/* ---------- parse Asana task text (Tally-style "Key: value" notes) ---------- */
const NOTE_KEYS = [
  ['patient', /^patient\s*:/i], ['appliance', /^appliance type\s*:/i], ['alignerType', /^aligner type\s*:/i],
  ['scanner', /^scanner\s*:/i], ['assistant', /^assistant\s*:/i], ['scanDate', /^scan date\s*:/i],
  ['labDate', /^lab completion date\s*:/i], ['deliveryDate', /^delivery date\s*:/i],
  ['instructions', /^dr\.?\s*a'?’?s instructions\s*:/i], ['cc', /^patient'?’?s cc( from last visit)?\s*:/i],
  ['ipr', /^ipr\s*(&|and)\s*spacing( tracker app)?\s*:?/i]
];
function parseNotes(notes) {
  const out = {}; const rest = []; let cur = null;
  String(notes || '').replace(/\r/g, '').split('\n').forEach(line => {
    const hit = NOTE_KEYS.find(([, re]) => re.test(line.trim()));
    if (hit) { cur = hit[0]; out[cur] = line.trim().replace(hit[1], '').trim(); return; }
    if (cur === 'ipr' || cur === 'instructions' || cur === 'cc') { out[cur] = (out[cur] ? out[cur] + '\n' : '') + line; return; }
    cur = null; if (line.trim()) rest.push(line);
  });
  Object.keys(out).forEach(k => { out[k] = out[k].trim(); if (/^(-|na|n\/a|none)$/i.test(out[k])) out[k] = ''; });
  out.rest = rest.join('\n').trim();
  return out;
}
function splitName(name) {
  const s = String(name || '').trim();
  let m = s.match(/^(.+?)\s+[-–]\s+(.+)$/); if (m) return [m[1].trim(), m[2].trim()];
  m = s.match(/^(.+?)\s*\((.+)$/); if (m) return [m[1].trim(), ('(' + m[2]).trim()];
  return [s, ''];
}
const PROJECT_TYPES = [
  [/oliv/i, 'oliv'], [/angel/i, 'angel'], [/invisalign/i, 'invisalign'], [/ulab/i, 'ulab'], [/insmile/i, 'insmile'], [/inbrace/i, 'inbrace'],
  [/nl lab|next level lab|in-?house/i, 'nla'], [/appliance/i, 'appliance'], [/retainer|whitening/i, 'retainer'], [/retreat/i, 'retreat']
];
function typeFromProject(p) { const hit = PROJECT_TYPES.find(([re]) => re.test(p || '')); return hit ? hit[1] : ''; }
/* NL Lab cases in Asana carry the fabrication checklist as subtasks; the first unticked one is where the case is */
const FAB_SUBTASKS = [[/export/i, 'fab'], [/sent? to (the )?print/i, 'send'], [/print/i, 'print'], [/thermo/i, 'thermo'], [/trim/i, 'trim'], [/polish/i, 'polish'], [/wash|dry/i, 'wash']];
function fabStepFromSubtasks(subtasks) {
  const list = (subtasks || []).filter(x => x && FAB_SUBTASKS.some(([re]) => re.test(x.name || '')));
  if (!list.length) return '';
  const open = list.find(x => !x.completed); if (!open) return 'pack';
  return FAB_SUBTASKS.find(([re]) => re.test(open.name || ''))[1];
}
function stageFromSection(type, section, subtasks) {
  const s = String(section || '').toLowerCase();
  const flow = FLOWS[(TYPE[type] || TYPE.misc).flow].stages.map(x => x[0]);
  const pick = k => flow.includes(k) ? k : flow[0];
  if (type === 'retainer' || type === 'mouthguard') {
    if (/tt|wt/.test(s) && /-/.test(s)) return pick('print');
    if (/milestone/.test(s)) return pick('milestones');
    if (/sarah/.test(s)) return pick('sarah');
    if (/pick ?up|front desk/.test(s)) return pick('pickup');
    return flow[0];
  }
  if (type === 'nla' || type === 'misc') {
    if (/misc/.test(s)) return 'todo';
    if (/txp/.test(s)) return pick('txp');
    if (/reset/.test(s)) return pick('txp'); // resets are retired (3 Oct 2026): one still in that column lands at TxP needed
    if (/fabrication/.test(s)) return fabStepFromSubtasks(subtasks) || pick('fab');
    if (/package|made/.test(s)) return pick('pack');
    if (/checked in/.test(s)) return pick('checkedin');
    return flow[0];
  }
  if (type === 'marpe') { // from the Appliance project: on hold for the CBCT/Zoom (before it was submitted) = gathering records
    if (/submitted/.test(s)) return 'submitted';
    if (/zoom/.test(s) && !/hold/.test(s)) return 'zoom';
    if (/approv|manufactur|shipped|arrived|milestone/.test(s)) return 'approved';
    if (/deliver/.test(s)) return 'delivered';
    return 'records';
  }
  if (type === 'retreat') {
    if (/intake/.test(s)) return 'intake'; if (/review/.test(s)) return 'review'; if (/proposal/.test(s)) return 'proposal';
    if (/progress/.test(s)) return 'progress'; if (/complete/.test(s)) return 'completed'; return flow[0];
  }
  if (/submit/.test(s) && /to submit/.test(s)) return pick('submit');
  if (/action/.test(s)) return pick('dra');
  if (/hold|cbct|zoom/.test(s)) return pick('hold');
  if (/submitted/.test(s)) return pick('submitted');
  if (/manufactur/.test(s)) return pick('mfg');
  if (/shipped/.test(s)) return pick('shipped');
  if (/arrived/.test(s)) return pick('arrived');
  if (/milestone/.test(s)) return pick('milestones');
  return flow[0];
}
/* Turn one Asana task into case data. `roster` maps first names to staff ids. */
function caseFromAsana(t, projectName, roster) {
  const sectionName = t.section || '';
  const n = parseNotes(t.notes);
  let type = typeFromProject(projectName);
  if (type === 'nla' && /misc/i.test(sectionName)) type = 'misc';
  if (type === 'retainer' && /mouth\s*guard/i.test(t.name || '')) type = 'mouthguard';
  if (!type) type = 'misc';
  if (type === 'misc' && /\bmodels?\b/i.test(t.name || '')) type = 'models';
  // MARPE cases have their own steps now; in Asana they sat in the Appliance project
  if (type === 'appliance' && /\bmarpe\b/i.test((t.name || '') + ' ' + (n.appliance || ''))) type = 'marpe';
  const [pt, detail] = splitName(t.name);
  const findStaff = name => {
    const first = String(name || '').trim().split(/\s+/)[0].toLowerCase(); if (!first) return '';
    const hit = roster.find(r => String(r.name || '').toLowerCase().split(/\s+/)[0] === first);
    return hit ? hit.sid : '';
  };
  let assignee = findStaff(t.assignee);
  if ((type === 'retainer' || type === 'mouthguard') && /-\s*tt/i.test(sectionName)) assignee = findStaff(sectionName.split('-')[0]) || assignee;
  const iso = s => { s = String(s || '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); } return ''; };
  let detailText = detail;
  if (!detailText && n.appliance) detailText = n.appliance + (n.alignerType ? ' (' + n.alignerType + ')' : '');
  return {
    type, patient: (n.patient || pt || '').trim(), detail: detailText, stage: stageFromSection(type, sectionName, t.subtasks),
    assignee, assigneeName: assignee ? '' : (t.assignee || ''),
    scanDate: iso(n.scanDate), labDate: iso(n.labDate), deliveryDate: iso(n.deliveryDate) || iso(t.due),
    scanner: n.scanner || '', assistant: findStaff(n.assistant) || '', assistantName: findStaff(n.assistant) ? '' : (n.assistant || ''),
    instructions: n.instructions || '', cc: n.cc || '', ipr: n.ipr || '', notes: n.rest || '',
    notesBy: n.rest ? 'asana' : '', notesAt: n.rest ? Date.now() : 0, notesH: n.rest ? noteHash(n.rest) : '',
    comments: [], src: { asana: String(t.gid || '') }, importedAt: Date.now(),
    _done: !!t.completed, _closedAt: t.completedAt ? Date.parse(t.completedAt) || null : null
  };
}
/* Minimal RFC-4180 CSV parser (quoted fields, embedded newlines, "" escapes). */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.replace(/^﻿/, '').trim());
  return rows.slice(1).filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}
function asanaRowsFromCSV(text) {
  const rows = parseCSV(text), subs = {};
  // subtasks come as their own rows naming the parent; NL Lab cases keep their fabrication checklist this way
  rows.filter(r => r['Parent task']).forEach(r => { const k = r['Parent task']; (subs[k] = subs[k] || []).push({ name: r['Name'] || '', completed: !!(r['Completed At'] || '').trim() }); });
  return rows.filter(r => !r['Parent task']).map(r => ({
    gid: r['Task ID'] || '', name: r['Name'] || '', notes: r['Notes'] || '', due: r['Due Date'] || '',
    assignee: r['Assignee'] || '', section: r['Section/Column'] || '', project: r['Projects'] || '',
    completed: !!(r['Completed At'] || '').trim(), completedAt: r['Completed At'] || '', subtasks: subs[r['Name'] || ''] || null
  }));
}
/* spreadsheet-safe cell: a leading = + - @ (or tab/CR) would be run as a formula by Excel/Sheets */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function caseToCSVRow(c) {
  return [c.patient, typeOf(c).l, c.detail, stageLabel(c), c.status === 'done' ? 'Completed' : 'Open', c.scanDate, c.labDate, c.deliveryDate ? c.deliveryDate + (c.deliveryTime ? ' ' + c.deliveryTime : '') : '', c.assigneeLabel || '', c.instructions, c.cc, c.ipr, c.notes, c.chart, c.titanUrl, (c.extras || []).join('; '), typeof submissionLabel === 'function' ? submissionLabel(c.initial, c.refN) : '', labName(c.lab), (c.teethNote || '').replace(/\n/g, '; '), c.aligners || '',
    c.shipToPatient ? 'Yes' : '', MARPE_RECORDS.filter(([k]) => (c.records || []).includes(k)).map(x => x[1]).join('; '), c.zoomDate ? c.zoomDate + (c.zoomTime ? ' ' + c.zoomTime : '') : '', atLabel(c.atTemplates),
    oneArch(c) === 'U' ? 'Upper only' : oneArch(c) === 'L' ? 'Lower only' : typeOf(c).aligner || ['insmile', 'inbrace'].includes(c.type) ? 'Upper & lower' : '',
    c.txStart || '', c.txEnd || '']
    .map(csvCell).join(',');
}
