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
     is in Manufacturing (Amir, 2 Oct 2026: "once it goes to manufacturing … it should be showing the delivery date").
     Submitted to lab (Amir, 12 Oct 2026, with the To submit page — "things that need to be submitted to the lab that have not
     been submitted yet"): staff tap it when they send the case, or the lab's "received" email moves it there; until then a
     case sent and waiting for the lab's setup sat at To submit too. A case saved at To submit stays there. */
  outside: { label: 'Outside aligners & braces', labDone: 'mfg', stages: [
    ['submit', 'To submit'], ['submitted', 'Submitted to lab'], ['dra', 'Dr. A action'], ['mfg', 'Manufacturing'],
    ['shipped', 'Shipped'], ['arrived', 'Arrived'], ['milestones', 'Checked into Milestones'] ] },
  appliance: { label: 'Appliances', labDone: 'mfg', stages: [
    ['submit', 'To submit'], ['hold', 'Hold (CBCT/Zoom)'], ['submitted', 'Submitted to lab'],
    ['mfg', 'Manufacturing'], ['shipped', 'Shipped'], ['milestones', 'Checked into Milestones'] ] },
  /* MARPE has its own steps (Amir, 2 Oct 2026): the STL scan and a CBCT of the upper and lower jaws on file first,
     then the lab, a Zoom call on a set date, design approval, delivery. The Zoom call is the case's next date until
     the design is approved; after that, the delivery date. */
  // every case ends at Checked into Milestones, and only then is it marked complete (Amir's staff, 7 Oct 2026; study models excepted)
  marpe: { label: 'MARPE', labDone: 'approved', zoomUntil: 'approved', stages: [
    ['records', 'Records: STL + CBCT'], ['submitted', 'Submitted to lab'], ['zoom', 'Zoom call scheduled'],
    ['approved', 'Design approved'], ['delivered', 'Delivered'], ['milestones', 'Checked into Milestones'] ] },
  /* in fabrication = the NL Lab checklist each Asana case carried as subtasks (Exported STLs → Final Wash and Dry);
     the board shows the seven steps as one "In fabrication" column */
  /* Amir, 6 Oct 2026: staff upload the scan into Titan for Dr. A ("All they do is upload the case into titan for me"); he does the
     movement, approves and exports, and the export shows up in the trimmer's software right away ("so export model becomes
     redundant"). Each step after that is one the lab PC can see in Ortho Factory and offers with one tap (lab.js) — Polishing and
     Final wash & dry are one step now, and Packaging is tapped by hand (its labels print from NLO Cases, not the trimmer). Same keys,
     so saved cases keep their place; a case saved at a step that went shows at the one that took it over (RETIRED_STAGES). */
  inhouse: { label: 'In-house lab', labDone: 'pack', stages: [
    ['txp', 'Uploaded to Titan'],
    // Amir, 3 Oct 2026: "add a middle step that says TxP completed or approved and it would still let me enter the U/L stages"
    ['txpok', 'TxP approved'],
    ['send', 'Ready to print'], ['print', 'Printing'], ['thermo', 'Thermoforming'], ['trim', 'Trimming'], ['polish', 'Polish, wash & dry'],
    // a set shipped to the patient: Shipped to patient, then Checked into Milestones like every other (staff, 7 Oct 2026)
    ['pack', 'Packaging'], ['shipped', 'Shipped to patient'], ['checkedin', 'Checked into Milestones'] ],
    shipOnly: ['shipped'], // (steps only a case shipped to the patient goes through: caseStages)
    groups: [{ l: 'In fabrication', stages: ['send', 'print', 'thermo', 'trim', 'polish'] }] },
  /* the first step says what's waiting (Amir, 5 Oct 2026: "the first step right now says printing which does not make sense"): to be
     made; then Printing, Milestones and the front desk (Amir, 6 Oct 2026: "the steps for retainers and whitening is To make >
     printing > milestones > Front desk pick up" — no Sarah's desk, and no Picked up step after it). The key 'print' is the old
     Printing step's, kept so cases saved at it stay at To make.
     Then (Amir's staff, 7 Oct 2026: "the last step of all the cases should be checked in Milestone and only then it will be marked
     as complete"): To make > Printing > Front desk pickup > Checked into Milestones. The Milestones step before pickup went (a
     case saved there shows at Front desk pickup: RETIRED_STAGES); the new last step has its own key.
     Then (staff via Amir, 14 Oct 2026: "it would be useful to have an intermediate step" between Printing and Front desk pickup):
     To make > Printing > Finishing > Front desk pickup > Checked into Milestones. Finishing = trimmed, polished and bagged, not at the
     desk yet; cases already at Printing or Front desk pickup stay where they are (nothing is renamed). */
  retainer: { label: 'Retainers & mouthguards', labDone: 'pickup', stages: [
    ['print', 'To make'], ['printing', 'Printing'], ['finishing', 'Finishing'], ['pickup', 'Front desk pickup'], ['checkedin', 'Checked into Milestones'] ] },
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
/* Dental Monitoring's doctor sign-in (its instructions for use: dental-monitoring.com/doctor). Every Oliv patient is on DM, so
   every Oliv case links to it — the case panel's portals, and the case's row in the lists and its card on the board (Amir,
   29 Oct 2026: "there should be a link to dentalmonitoring for all the oliv pts"); like the portals, it copies the patient's name */
const DM_URL = 'https://dental-monitoring.com/doctor/login';
function dmOn(c) { return !!c && c.type === 'oliv'; }
const PORTALS = {
  nla: [{ l: 'Titan (web)', u: 'https://client.titandentaldesign.com/Live/index.html' }, { l: 'Titan beta (web)', u: 'https://client.titandentaldesign.com/EA/index.html' }],
  oliv: [{ l: 'Oliv portal', u: 'https://portal.olivortho.com/' }, { l: 'Dental Monitoring', u: DM_URL }],
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
/* in fabrication (Today's tile, its filter): an outside aligner case at Submitted to lab (12 Oct 2026) isn't — the lab is making its
   setup for Dr. A, nothing is being made yet */
function inFab(c) { return !!c && FAB_STAGES.includes(c.stage) && !(c.stage === 'submitted' && typeOf(c).flow === 'outside'); }
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
/* MARPE: the Zoom call's link (Amir, 29 Oct 2026: "is there any way I can like link my Zooms there … so in the future, I can just
   click on there and open up the Zoom"). The link from the lab's invite is saved on the case (`zoomUrl`, encrypted with the rest
   of it) and opens with Join Zoom while the call is still ahead. Pasting the whole invite works too: the meeting link is picked out
   of it: a Zoom join link first (…/j/…, before Zoom's Register page), then any Zoom link, then another meeting link — the first one,
   or a later copy of the same meeting's link with its passcode in it. An email's
   own wrapper around the link (Outlook's Safe Links, Google's redirect) is taken off, and the invisible characters an email can leave
   inside a link (zero-width spaces, soft hyphens) are dropped — they'd end up in the passcode. A Zoom link pasted without https:// (or
   with http://) gets it; anything else that isn't an https:// link isn't kept. (Independent review, 29 Oct 2026.) */
const ZOOM_HOST = /(^|\.)(zoom\.us|zoom\.com|zoomgov\.com)$/i;
function zoomHost(u) { try { return ZOOM_HOST.test(new URL(u).hostname); } catch (e) { return false; } }
/* a join link (a meeting's /j/…, a webinar's /w/…, a personal room's /my/…, the web client's /wc/…) */
function zoomJoinPath(u) { try { return /^\/(j|w|s|my|wc)\//i.test(new URL(u).pathname); } catch (e) { return false; } }
/* the link inside an email's wrapper (Outlook's Safe Links, Google's redirect), or the link as it is */
function linkUnwrap(u) {
  try {
    const x = new URL(u), h = x.hostname.toLowerCase();
    const inner = /(^|\.)safelinks\.protection\.outlook\.com$/.test(h) ? x.searchParams.get('url')
      : /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) && x.pathname === '/url' ? x.searchParams.get('q') || x.searchParams.get('url') : '';
    return inner ? String(inner).trim() : u;
  } catch (e) { return u; }
}
/* the link as it's saved: https only (a Zoom link given with http:// gets https://), without a sign-in part, written the standard way */
function linkClean(u) {
  try {
    if (/^http:\/\//i.test(u) && zoomHost(u)) u = 'https://' + u.slice(7);
    const x = new URL(u); if (x.protocol !== 'https:' || !/\.[^.]+$/.test(x.hostname)) return '';
    x.username = ''; x.password = '';
    return /^https:\/\/[^\s<>"'`]+$/i.test(x.href) ? x.href : '';
  } catch (e) { return ''; }
}
function zoomLinkFrom(v) {
  // (invisible characters an email can leave inside a link — zero-width spaces and joiners, direction marks, soft hyphens, a BOM)
  const invis = x => x.replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
  const s = invis(String(v || '')).trim(); if (!s) return '';
  const cut = u => u.replace(/[.,;:!?'"’”)\]>*]+$/, ''); // (the sentence's punctuation after a link isn't part of it)
  // (wrappers inside wrappers — Google's redirect around a Safe Link — come off until the link stops changing; what comes out of a
  // wrapper is cleaned the same way, as it was written inside it percent-encoded)
  const peel = u => { for (let n = 0; n < 4; n++) { const x = cut(invis(linkUnwrap(u)).trim()); if (x === u) break; u = x; } return u; };
  const found = (s.match(/https:\/\/[^\s<>"'`]+/gi) || []).map(cut);
  // (a Zoom link written without https://, or with http://)
  for (const m of s.matchAll(/(?:^|[\s(<]|http:\/\/)((?:[a-z0-9-]+\.)*zoom(?:gov)?\.(?:us|com)\/[^\s<>"'`]+)/gi)) found.push('https://' + cut(m[1]));
  const all = Array.from(new Set(found.map(u => linkClean(peel(u))).filter(Boolean)));
  // a Zoom join link, then another Zoom link, then anything else; the first of them — or a later copy of the same meeting's link that
  // has its passcode in it (it opens without asking for one; a different meeting's passcode never wins)
  const rank = u => zoomHost(u) ? (zoomJoinPath(u) ? 2 : 1) : 0, pwd = u => /[?&]pwd=/.test(u);
  const same = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.host === y.host && x.pathname === y.pathname; } catch (e) { return false; } };
  return all.reduce((best, u) => rank(u) > rank(best) || (rank(u) === rank(best) && same(u, best) && pwd(u) && !pwd(best)) ? u : best, all[0] || '');
}
/* the case's Zoom link, ready to open: what's saved, read the way the form reads it — always a clean https:// link ('' when it has
   none, or no link in what's saved; a link saved inside a wrapper opens without it) */
function zoomLinkOf(c) { return zoomLinkFrom(c && c.zoomUrl); }
/* what its button says: a Zoom link joins the Zoom; another meeting link (Teams, Meet…) the call */
function zoomJoinWord(u) { return zoomHost(u) ? 'Join Zoom' : 'Join the call'; }
/* the Zoom call is still ahead: a MARPE case before its design is approved (as the case's next date: labDueOf) */
function zoomAhead(c) {
  const f = flowOf(c); if (!f.zoomUntil) return false;
  return stageIndex(c) < f.stages.findIndex(s => s[0] === f.zoomUntil);
}

function typeOf(c) { return TYPE[c.type] || TYPE.misc; }
function flowOf(c) { return FLOWS[typeOf(c).flow]; }
function stageLabel(c) { const k = liveStage(c), s = caseStages(c).find(x => x[0] === k) || flowOf(c).stages.find(x => x[0] === k); return s ? s[1] : (k || '—'); }
/* retired steps: a case saved at one shows (and moves on) from the step that replaced it; history keeps the old name.
   In-house "Reset needed in 2 days" (Amir, 3 Oct 2026: it was never a step after TxP — resets were one or two aligners
   needed in a couple of days, kept in a column of the NL Lab project — and "we are actually not doing resets any longer") */
const RETIRED_STAGES = { inhouse: { reset: { to: 'txp', l: 'Reset needed in 2 days' },
    // Export STLs and Final wash & dry (Amir, 6 Oct 2026): the export happens as the TxP is approved; washing goes with polishing
    fab: { to: 'txpok', l: 'Export STLs' }, wash: { to: 'polish', l: 'Final wash & dry' } },
  // retainers "On Sarah's desk" (Amir, 6 Oct 2026: "retainers are NOT placed on Sarah's desk. They are made and put on the front desk"),
  // and "Picked up", a last step for a few hours that day (completed cases there show at Front desk pickup)
  retainer: { sarah: { to: 'pickup', l: 'On Sarah’s desk' }, pickedup: { to: 'pickup', l: 'Picked up' },
    // Milestones before Front desk pickup (7 Oct 2026: Checked into Milestones is the last step now, after pickup)
    milestones: { to: 'pickup', l: 'Milestones' } } };
function liveStage(c) { const r = c && (RETIRED_STAGES[typeOf(c).flow] || {})[c.stage]; return r ? r.to : c && c.stage; }
function retiredStageLabel(c, k) { const r = (RETIRED_STAGES[typeOf(c).flow] || {})[k]; return r ? r.l : ''; }
/* completed cases as read: at the step that replaced a retired one — and without the ones removed as a duplicate (dupes.js: they
   aren't in Completed, the patient's history or the Workload page) */
function liveCases(list) { return (list || []).filter(c => c && !c.dup).map(c => { c.stage = liveStage(c); return c; }); }
/* Ship to patient (aligners): its Shipped step (we still need to know the EXPECTED DELIVERY — Amir, 3 Oct 2026), then Checked
   into Milestones like every case, and only then complete (Amir's staff, 7 Oct 2026; it used to complete on reaching Shipped).
   Outside labs skip Arrived (the set doesn't come to the office); in-house sets go Packaging > Shipped to patient. */
function shipStep(c) { return c && c.shipToPatient && (TYPE[c.type] || {}).aligner && ['outside', 'inhouse'].includes(typeOf(c).flow) ? 'shipped' : null; }
/* the steps this case goes through: its flow's, without the ones that aren't for it — Arrived for a case shipped to the patient,
   the shipped-only steps (in-house Shipped to patient) for one that isn't */
function caseStages(c) {
  const f = flowOf(c), ship = !!shipStep(c);
  return ship ? f.stages.filter(s => s[0] !== 'arrived') : f.shipOnly ? f.stages.filter(s => !f.shipOnly.includes(s[0])) : f.stages;
}
/* the step a case at `k` is at on its own steps: `k`, or — a step it skips (Ship to patient switched after it got there) — the
   next one of its own steps after it (the last one when none is) */
function pathStage(c, k) {
  const own = caseStages(c).map(s => s[0]); if (!k || own.includes(k)) return k;
  const all = flowOf(c).stages.map(s => s[0]), i = all.indexOf(k); if (i < 0) return k;
  return own.find(x => all.indexOf(x) > i) || own[own.length - 1];
}
/* the case's last step (Checked into Milestones for all but study models): Mark complete is only offered there */
function lastStageKey(c) { const st = caseStages(c); return st.length ? st[st.length - 1][0] : ''; }
function atLastStage(c) { return !!c && !!c.stage && pathStage(c, liveStage(c)) === lastStageKey(c); }
/* the case's delivery date is the patient's delivery appointment (Amir, 3 Oct 2026: "change it to Delivery appt");
   a case shipped to the patient has no appointment, just the expected delivery */
function delWord(c) { return c && c.shipToPatient && (TYPE[c.type] || {}).aligner ? 'Expected delivery' : 'Delivery appt'; }
/* where the case is on its own steps (caseStages: a case shipped to the patient skips some) */
function stageIndex(c) { const own = caseStages(c); return own.findIndex(x => x[0] === pathStage(c, c.stage)); }
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
/* past the lab step: from the flow's labDone stage on (outside labs and appliances: Manufacturing; in-house: Packaging) */
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

/* ---------- the stage the patient is in at the scan ----------
   Amir, 29 Oct 2026: "for submitting aligners, it should ask for which stage they are in at the scan appointment". Asked on
   every aligner set that isn't a first set — a refinement, a mid-course correction, finishing aligners: the aligner the patient
   is wearing that day, one number per treated arch (scanStU / scanStL, 1–99), or "Not wearing aligners" (scanStNone). It shows
   on the case (a badge under the name), in the New case review, the scan visit's chart note and the export. */
const ST_MAX = 99;
function scanStAsked(c) { return !!c && !!(TYPE[c.type] || {}).aligner && (c.initial === 'no' || c.initial === 'mid' || (c.type === 'nla' && c.variant === 'finishing')); }
/* a stage typed in a box: a whole number 1–99, else '' — and stBad: something typed that isn't one (the form's reading, its hint
   and Edit's save all go by these, so a box that says it's wrong is never saved quietly as empty) */
function stVal(t) { t = String(t == null ? '' : t).trim(); return /^\d{1,2}$/.test(t) && Number(t) >= 1 ? Number(t) : ''; }
function stBad(t) { t = String(t == null ? '' : t).trim(); return t !== '' && stVal(t) === ''; }
function scanStNums(c) { const n = v => { v = Number(v); return v >= 1 && v <= ST_MAX ? Math.floor(v) : 0; }; return { u: n(c && c.scanStU), l: n(c && c.scanStL) }; }
/* "U 14 · L 12", "U 14", "Not wearing aligners" — '' while nothing is saved */
function scanStText(c) {
  if (!c) return ''; if (c.scanStNone) return 'Not wearing aligners';
  const s = scanStNums(c); return [s.u ? 'U ' + s.u : '', s.l ? 'L ' + s.l : ''].filter(Boolean).join(' · ');
}
/* the chart note's line: "Stage at scan: upper 14, lower 12." */
function scanStNote(c) {
  if (!c) return ''; if (c.scanStNone) return 'Not wearing aligners at the scan.';
  const s = scanStNums(c), p = [s.u ? 'upper ' + s.u : '', s.l ? 'lower ' + s.l : ''].filter(Boolean);
  return p.length ? 'Stage at scan: ' + p.join(', ') + '.' : '';
}
/* in-house: the patient's set before this one that has its aligner counts (the stage at the scan is usually inside it) —
   { l: 'Initial', u, lo } or null */
function setBefore(c, pool) {
  if (!c || c.type !== 'nla') return null;
  const sets = alignerSets(c, pool), i = sets.findIndex(x => x.me);
  for (let j = i - 1; j >= 0; j--) {
    const x = (pool || []).find(y => y && y.id && y.id === sets[j].id);
    if (x && (Number(x.alU) > 0 || Number(x.alL) > 0)) return { l: sets[j].l, u: Number(x.alU) || 0, lo: Number(x.alL) || 0 };
  }
  return null;
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
/* ---------- the search box read as an appointment day (Amir, 30 Oct 2026: "add to the search on the top to be able to search by
   appointment day. so if I want to know cases needing delivery next week. I can do that or on thursday. etc.") ----------
   apptQuery(text, today) → { from, to, spans, what, rest }, or null when there's no day in it. spans: the days found, each
   { from, to } (yyyy-mm-dd, both ends included; one open at an end — "before Friday", "after Thursday" — runs from QD_MIN or to
   QD_MAX and says so in open / at); from, to: the first and the last; what: how they were read when the days alone don't say it
   ("next week", "today", else ''); rest: the other words searched with them ('' when it's only days). today: yyyy-mm-dd
   (todayISO() when left out).
   · today, tomorrow, yesterday, the day after tomorrow, the day before yesterday, in 3 days, 3 days from now, a week from Thursday
   · a weekday (Mon, Thurs, Thursday — any start of one from 3 letters, so it holds while it's typed): the next one, today included
     ("this Thursday", "this coming Thursday" too); "next Thursday" is the one in next week, "last Thursday" / "this past Thursday"
     the one before today, "Thursday after next" the one after the next; "Thursday next week"
   · this week, next week (this coming week), last week (this past week), the week after next, in 2 weeks, a week from today, the
     week of Nov 9: weeks run Monday to Sunday
   · the next 10 days, the next 2 weeks, in the next week (from today); the last 7 days (up to today)
   · this month, next month, last month; a month by its full name (November, November 2026, next May, last November)
   · 11/5, 11/5/26, 2026-11-05, Nov 5, November 5th, 5 Nov, the 5th, with the weekday before or after it or not; with no year, the
     nearest
   · stretches: Monday to Thursday, 11/2 - 11/6, between Nov 2 and Nov 6, Nov 2-6; open at one end: before Friday, after Thursday,
     by Friday; lists: Thursday and Friday, Mon or Wed (a weekday after another is the one on from it: Thursday and Friday = the
     Friday after that Thursday)
   The words around them are left out (delivery, deliveries, appt(s), appointment(s), due, cases, needing, on, for, the, of…), so
   "deliveries next week" and "appts on Thursday" read the same. A day at the start or the end can come with other words — "oliv
   next week", "retainers Thursday", "Gwen tomorrow" — which then narrow it down (rest), except words that can't narrow anything
   down (what, show me, this, in, morning, 2pm…); a day beside a word it couldn't take in (after, until, except, next…) isn't read
   as a day at all, rather than as the wrong one. Short ones that start names (Mon, Sat, Sun, Frida…) count as days too: the search
   still finds the names as well (matchesQ in ui.js adds the cases on those days to what the words find, never takes any away). */
const QD_WDN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const QD_WD = QD_WDN.reduce((o, w, i) => { const l = w.toLowerCase(); for (let k = 3; k <= l.length; k++) o[l.slice(0, k)] = i; return o; }, { weds: 2 });
const QD_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const QD_MAB = { jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const QD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, thirty: 30 };
const QD_SKIP = new Set(['delivery', 'deliveries', 'deliver', 'delivering', 'delivered', 'appt', 'appts', 'apt', 'apts', 'appointment', 'appointments', 'due', 'case', 'cases',
  'patient', 'patients', 'pt', 'pts', 'needing', 'need', 'needs', 'scheduled', 'on', 'for', 'the', 'of', 'at', 'all', 'any']);
/* beside a day, these can't narrow anything down: left out of the other words (so "what's due Thursday" is Thursday's) */
const QD_REST_SKIP = new Set(['what', 'which', 'who', 'how', 'many', 'show', 'me', 'list', 'find', 'see', 'get', 'give', 'please', 'is', 'are', 'was', 'were', 'do',
  'does', 'did', 'we', 'us', 'i', 'you', 'have', 'has', 'there', 'be', 'to', 'a', 'an', 'with', 'this', 'that', 'these', 'those', 'in', 'within', 'and', 'or', 'my',
  'our', 'it', 'its', 'they', 'them', 'from', 'by', 'coming', 'up', 'upcoming', 'around', 'about', 'morning', 'afternoon', 'evening', 'night', 'am', 'pm', 'booked',
  'going', 'out', 'so', 'far', '&', '+', '-', '–', '—']);
/* …and beside these, a day isn't read at all (they change which days are meant in a way that wasn't understood) */
const QD_BLOCK = new Set(['after', 'before', 'since', 'until', 'till', 'except', 'not', 'without', 'but', 'between', 'through', 'thru', 'next', 'last', 'past',
  'previous', 'following', 'earlier', 'later', 'than', 'no']);
const QD_MIN = '0000-01-01', QD_MAX = '9999-12-31';
const qdGet = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; // (so "constructor" isn't a weekday)
function qdAt(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function qdYmd(y, mo, d) { if (!(y >= 1900 && y <= 2200)) return null; const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? isoOf(dt) : null; }
function qdWd(iso) { return (qdAt(iso).getDay() + 6) % 7; } // 0 = Monday … 6 = Sunday
function qdMonth(w) { return QD_MONTHS.indexOf(w) + 1 || qdGet(QD_MAB, w) || 0; }
function qdMonthSpan(y, mo, what) { const from = qdYmd(y, mo, 1); return from ? { from, to: isoOf(new Date(y, mo, 0)), what } : null; }
function qdSpans(r) { return r.spans || [{ from: r.from, to: r.to, open: r.open || '', at: r.at || '' }]; }
/* several readings as one (a list of days, or a day plus another day beside it): in date order, each day once */
function qdUnion(rs) {
  const all = [].concat(...rs.map(qdSpans)).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  const spans = all.filter((s, i) => !all.slice(0, i).some(p => p.from === s.from && p.to === s.to));
  if (spans.length === 1) return Object.assign({ what: rs.length === 1 ? rs[0].what || '' : '' }, spans[0]);
  return { from: spans[0].from, to: spans.reduce((m, s) => s.to > m ? s.to : m, ''), spans, what: '' };
}
function apptQuery(text, today) {
  today = /^\d{4}-\d{2}-\d{2}$/.test(today || '') ? today : todayISO();
  const str = String(text == null ? '' : text); if (str.length > 80) return null;
  // each word as a day reads it (n: lower case, punctuation and 's off, wk = week) and as the rest of the search (r: as typed, only the
  // punctuation around it and 's off, so O'Brien stays O'Brien); the words around a day (delivery, appts, on…) are left out of both
  const toks = str.split(/\s+/).map(w => ({ n: w.toLowerCase().replace(/[.,!?;:()"“”]+$/, '').replace(/[’']s$/, '').replace(/[’'"“”.,!?;:()]+/g, '').replace(/^wks$/, 'weeks').replace(/^wk$/, 'week'),
    r: w.replace(/^[.,!?;:()"“”]+|[.,!?;:()"“”]+$/g, '').replace(/[’']s$/i, '') })).filter(t => t.n && !QD_SKIP.has(t.n));
  const read = a => a.length ? qdPhrase(a.map(t => t.n).join(' '), today) : null, n = toks.length;
  const out = (r, rest) => ({ from: r.from, to: r.to, spans: qdSpans(r), what: r.what || '', rest });
  let r = read(toks); if (r) return out(r, '');
  // a day at the end or the start, with other words ("oliv next week", "retainers thursday", "next week sarah"): the longest day that
  // reads, at the end before at the start
  for (let len = n - 1; len >= 1; len--) for (const [d, o, end] of [[toks.slice(n - len), toks.slice(0, n - len), 1], [toks.slice(0, len), toks.slice(len), 0]]) {
    if (!(r = read(d))) continue;
    // the other words: those that can narrow it down (a time, "2pm", narrows nothing here either — the list shows the times)
    const words = o.filter(t => !QD_REST_SKIP.has(t.n) && !/^\d{1,2}(:\d{2})?(am|pm)$|^\d{1,2}:\d{2}$/i.test(t.r));
    if (words.some(t => QD_BLOCK.has(t.n))) return null;
    // …another day ("11/5 Thursday", "Thursday Friday"): both, in the order typed
    const wt = words.map(t => t.n).join(' '), dt = d.map(t => t.n).join(' ');
    const both = words.length && read(words) && qdPhrase(end ? wt + ' and ' + dt : dt + ' and ' + wt, today);
    if (both) return out(both, '');
    return out(r, words.map(t => t.r).filter(Boolean).join(' '));
  }
  return null;
}
/* the days in a search with nothing else in it (the words around them already left out) */
function qdPhrase(s, today) {
  s = String(s || '').replace(/^from /, ''); if (!s) return null;
  let m = /^between (.+) and (.+)$/.exec(s), r;
  if (m && (r = qdRange(m[1], m[2], today))) return r;
  // a list: Thursday and Friday, Mon or Wed, 11/5 & 11/12, Monday Wednesday Thursday (a weekday or a date with no year after another
  // is the one on from it)
  const items = s.split(' ').length > 1 && s.split(' ').every(w => qdGet(QD_WD, w) != null) ? s.split(' ') : s.split(/ (?:and|or|&|\+|plus) /);
  if (items.length > 1) {
    const rs = [];
    for (const x of items) {
      let y = qdPhrase(x, today); const prev = rs[rs.length - 1];
      if (y && prev && y.from < prev.from && qdRel(x)) y = qdPhrase(x, prev.from);
      if (!y) break; rs.push(y);
    }
    if (rs.length === items.length) return qdUnion(rs);
  }
  m = /^(.+?) (?:to|through|thru|until|till|-) (.+)$/.exec(s) || /^(.+?) ?[–—] ?(.+)$/.exec(s) || /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)-(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/.exec(s);
  if (m && (r = qdRange(m[1], m[2], today))) return r;
  return qdOne(s, today);
}
/* read on from another day when it comes after it: a weekday, or a date with no year */
function qdRel(x) { return qdGet(QD_WD, x.replace(/^(this|coming|upcoming) /, '')) != null || /^\d{1,2}\/\d{1,2}$|^[a-z]+ \d{1,2}(st|nd|rd|th)?$|^\d{1,2}(st|nd|rd|th)?( [a-z]+)?$/.test(x); }
/* a stretch from one day to another: from the first one's start to the second one's end ("Thursday to Monday": the Monday after) */
function qdRange(x, y, today) {
  const a = qdOne(x, today); let b = a && qdOne(y, today);
  if (a && b && b.to < a.from && qdRel(y)) b = qdOne(y, a.from);
  return a && b && b.to >= a.from && a.from !== QD_MIN && b.to !== QD_MAX ? { from: a.from, to: b.to, what: '' } : null;
}
function qdOne(t, today) {
  const add = n => addDays(today, n), wd = qdWd(today), mon = add(-wd);
  const day = (d, what) => d ? { from: d, to: d, what: what || '' } : null, span = (a, b, what) => ({ from: a, to: b, what: what || '' });
  const num = x => /^\d{1,3}$/.test(x) ? +x : qdGet(QD_NUM, x) || 0, plural = (n, u) => n + ' ' + u + (n === 1 ? '' : 's');
  const inN = (n, u) => 'in ' + (n === 1 ? 'a ' + u : plural(n, u)); // in a week, in 3 days
  const off = k => /^(this|current)$/.test(k) ? 0 : /^(last|past|previous)$/.test(k) ? -1 : 1; // this / last / next (coming, following…)
  let m, n, w;
  t = t.replace(/^this (coming|upcoming|past) /, '$1 '); // (this coming Thursday = the coming one, this past week = last week)
  if (t === 'today' || t === 'tonight') return day(today, 'today');
  if (/^(tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow)$/.test(t)) return day(add(1), 'tomorrow');
  if (t === 'yesterday') return day(add(-1), 'yesterday');
  if (t === 'day after tomorrow') return day(add(2), 'the day after tomorrow');
  if (t === 'day before yesterday') return day(add(-2), 'the day before yesterday');
  // in 3 days, in two weeks, 3 days from now (a week: that whole week)
  if ((m = /^in (\w+) (day|week)s?$/.exec(t) || /^(\w+) (day|week)s? (?:from )?(?:now|today)$/.exec(t)) && (n = num(m[1]))) { // ("in next week": below)
    if (n > (m[2] === 'day' ? 366 : 52)) return null;
    if (m[2] === 'day') return day(add(n), inN(n, 'day'));
    w = addDays(mon, 7 * n); return span(w, addDays(w, 6), inN(n, 'week'));
  }
  // a week from today (that week), a week from Thursday, 3 days from tomorrow (that day)
  if ((m = /^(?:(\w+) )?(day|week)s? from (.+)$/.exec(t))) {
    n = m[1] ? num(m[1]) : 1; if (!n || n > (m[2] === 'day' ? 366 : 52)) return null;
    if (/^(now|today)$/.test(m[3])) { if (m[2] === 'day') return day(add(n), inN(n, 'day')); w = addDays(mon, 7 * n); return span(w, addDays(w, 6), inN(n, 'week')); }
    const b = qdOne(m[3], today); return b && b.from === b.to && b.from !== QD_MIN ? day(addDays(b.from, n * (m[2] === 'week' ? 7 : 1))) : null;
  }
  // the next 10 days, the next 2 weeks, within 10 days, in the next week (from today) · the last 7 days (up to today)
  if ((m = /^(?:in |within )?(next|coming|upcoming|last|past|previous) (\w+) (day|week)s?$/.exec(t) || /^()within (\w+) (day|week)s?$/.exec(t)) && (n = num(m[2]))) {
    const len = n * (m[3] === 'week' ? 7 : 1); if (len > 366) return null;
    return off(m[1]) < 0 ? span(add(1 - len), today, 'in the last ' + plural(n, m[3])) : span(today, add(len - 1), 'in the next ' + plural(n, m[3]));
  }
  if ((m = /^(?:in|within) (?:next|coming|upcoming) (week|month)$/.exec(t))) return m[1] === 'week' ? span(today, add(6), 'in the next 7 days') : span(today, add(29), 'in the next 30 days');
  // this week, next week, last week, the week after next (Monday to Sunday); "Thursday next week", "next week Thursday"
  if ((m = /^(this|current|next|coming|upcoming|following|last|past|previous) week$/.exec(t))) {
    const o = off(m[1]) * 7; return span(addDays(mon, o), addDays(mon, o + 6), o ? (o < 0 ? 'last week' : 'next week') : 'this week');
  }
  if (t === 'week after next') return span(addDays(mon, 14), addDays(mon, 20), 'the week after next');
  // the week of Nov 9 (the of and the are left out): that day's week
  if ((m = /^week (.+)$/.exec(t)) && (w = qdOne(m[1], today)) && w.from === w.to && w.from !== QD_MIN) { const a = addDays(w.from, -qdWd(w.from)); return span(a, addDays(a, 6)); }
  if ((m = /^([a-z]+) (this|current|next|coming|upcoming|following|last|past|previous) week$/.exec(t) || /^(this|current|next|coming|upcoming|following|last|past|previous) week ([a-z]+)$/.exec(t))) {
    const k = qdGet(QD_WD, m[1]) != null ? m[2] : m[1], x = qdGet(QD_WD, qdGet(QD_WD, m[1]) != null ? m[1] : m[2]);
    if (x != null) return day(addDays(mon, off(k) * 7 + x));
  }
  // before Friday, after Thursday, by (until) Friday: open at one end
  if ((m = /^(before|after|by|until|till) (.+)$/.exec(t)) && (w = qdOne(m[2], today)) && w.from !== QD_MIN && w.to !== QD_MAX) {
    if (m[1] === 'after') return { from: addDays(w.to, 1), to: QD_MAX, what: '', open: 'after', at: w.to };
    return m[1] === 'before' ? { from: QD_MIN, to: addDays(w.from, -1), what: '', open: 'before', at: w.from } : { from: QD_MIN, to: w.to, what: '', open: 'by', at: w.to };
  }
  // this month, next month, last month; a month by its full name (abbreviated only with its year): the nearest one — up to six
  // months ahead, else the one before; next May (the next one after this month), last November (the one before this month)
  if ((m = /^(this|current|next|coming|upcoming|following|last|past|previous) month$/.exec(t))) {
    const [y, mo] = today.split('-').map(Number), o = off(m[1]), d0 = new Date(y, mo - 1 + o, 1);
    return qdMonthSpan(d0.getFullYear(), d0.getMonth() + 1, o ? (o < 0 ? 'last month' : 'next month') : 'this month');
  }
  if ((m = /^([a-z]+)(?: (\d{4}))?$/.exec(t)) && (n = QD_MONTHS.indexOf(m[1]) + 1 || (m[2] ? qdGet(QD_MAB, m[1]) || 0 : 0))) {
    let y = +m[2] || 0;
    if (!y) { const [ty, tm] = today.split('-').map(Number), ahead = (n - tm + 12) % 12; y = ahead <= 6 ? (n >= tm ? ty : ty + 1) : (n <= tm ? ty : ty - 1); }
    return qdMonthSpan(y, n, '');
  }
  if ((m = /^(this|current|next|coming|upcoming|following|last|past|previous) ([a-z]+)$/.exec(t)) && (n = qdMonth(m[2]))) {
    const [ty, tm] = today.split('-').map(Number), o = off(m[1]);
    return qdMonthSpan(o === 0 ? ty : o > 0 ? (n > tm ? ty : ty + 1) : (n < tm ? ty : ty - 1), n, '');
  }
  // a weekday: the next one (today included), next week's ("next Thursday", "Thursday next"), the one before today, the one after
  // the next ("Thursday after next")
  if ((m = /^(?:(this|coming|upcoming|next|last|past|previous) )?([a-z]+)(?: (next|last|after next))?$/.exec(t)) && (w = qdGet(QD_WD, m[2])) != null && !(m[1] && m[3])) {
    const k = m[1] || m[3] || '';
    if (k === 'next') return day(addDays(mon, 7 + w), 'next ' + QD_WDN[w]);
    if (k === 'after next') return day(add(((w - wd + 7) % 7 || 7) + 7), QD_WDN[w] + ' after next');
    if (/^(last|past|previous)$/.test(k)) return day(add(-((wd - w + 7) % 7 || 7)), 'last ' + QD_WDN[w]);
    return day(add((w - wd + 7) % 7));
  }
  // a date; a weekday before or after it is only a reminder ("Thu 11/5", "Thursday, Nov 5th", "11/5 Thursday"): the date decides
  const ws = t.split(' '), lead = ws.length > 1 && qdGet(QD_WD, ws[0]) != null, trail = ws.length > 1 && qdGet(QD_WD, ws[ws.length - 1]) != null;
  return lead && qdDay(ws.slice(1).join(' '), today) || trail && qdDay(ws.slice(0, -1).join(' '), today) || qdDay(t, today);
}
/* one date: 11/5, 11/5/26, 2026-11-05, Nov 5, November 5th, 5 Nov, 5th of November (2026), the 5th. With no year: the nearest */
function qdDay(t, today) {
  let m, y = 0, mo = 0, d = 0;
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t))) { mo = +m[1]; d = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(t)) && qdMonth(m[1])) { mo = qdMonth(m[1]); d = +m[2]; y = +m[3] || 0; }
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(t)) && qdMonth(m[2])) { mo = qdMonth(m[2]); d = +m[1]; y = +m[3] || 0; }
  else if ((m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)? ?[-–—] ?(\d{1,2})(?:st|nd|rd|th)?$/.exec(t)) && qdMonth(m[1])) {
    // Nov 5-6: both days in that month (the nearest, as one date would be)
    const a = qdDay(m[1] + ' ' + m[2], today), b = a && qdYmd(+a.from.slice(0, 4), qdMonth(m[1]), +m[3]);
    return a && b && b >= a.from ? { from: a.from, to: b, what: '' } : null;
  }
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(t))) {
    // the 5th: the next one, today included (a month without that day is passed over: the 31st)
    const [ty, tm, td] = today.split('-').map(Number); d = +m[1];
    for (let i = d >= td ? 0 : 1; i <= 12; i++) { const x = new Date(ty, tm - 1 + i, 1), iso = qdYmd(x.getFullYear(), x.getMonth() + 1, d); if (iso) return { from: iso, to: iso, what: '' }; }
    return null;
  }
  else return null;
  if (y) { const iso = qdYmd(y, mo, d); return iso ? { from: iso, to: iso, what: '' } : null; }
  const ty = +today.slice(0, 4), t0 = qdAt(today); let best = null, bd = 0;
  [ty - 1, ty, ty + 1].forEach(yy => { const iso = qdYmd(yy, mo, d); if (!iso) return; const dd = Math.abs(Math.round((qdAt(iso) - t0) / 864e5)); if (best === null || dd < bd || (dd === bd && iso > best)) { best = iso; bd = dd; } });
  return best ? { from: best, to: best, what: '' } : null;
}
/* how a search was read, for the line under the search box: "next week · Mon, Nov 2 – Sun, Nov 8", "Thu, Nov 5", "in November",
   "Thu, Nov 5 and Fri, Nov 6", "before Fri, Nov 6" */
function apptQueryText(qd, today) {
  const ty = (today || todayISO()).slice(0, 4), yr = iso => iso.slice(0, 4) !== ty ? { year: 'numeric' } : {};
  const day = iso => qdAt(iso).toLocaleDateString(undefined, Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, yr(iso)));
  const isMonth = s => !s.open && s.from !== s.to && s.from.slice(8) === '01' && s.from.slice(0, 7) === s.to.slice(0, 7) && addDays(s.to, 1).slice(8) === '01';
  const one = s => s.open ? s.open + ' ' + day(s.at) : s.from === s.to ? day(s.from) : isMonth(s) ? qdAt(s.from).toLocaleDateString(undefined, Object.assign({ month: 'long' }, yr(s.from))) : day(s.from) + ' – ' + day(s.to);
  const spans = qdSpans(qd);
  if (spans.length > 1) { const xs = spans.map(one); return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  const when = one(spans[0]);
  return qd.what ? qd.what + ' · ' + when : isMonth(spans[0]) ? 'in ' + when : when;
}
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
// (the Asana checklist's Exported STLs and Final wash & dry are TxP approved and Polish, wash & dry now — 6 Oct 2026)
const FAB_SUBTASKS = [[/export/i, 'txpok'], [/sent? to (the )?print/i, 'send'], [/print/i, 'print'], [/thermo/i, 'thermo'], [/trim/i, 'trim'], [/polish/i, 'polish'], [/wash|dry/i, 'polish']];
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
    if (/milestone/.test(s)) return pick('pickup'); // (Asana's Milestones came before the front desk: made, waiting there now)
    if (/sarah/.test(s)) return pick('pickup'); // (no Sarah's desk any more: made retainers wait at the front desk)
    if (/pick ?up|front desk/.test(s)) return pick('pickup');
    return flow[0];
  }
  if (type === 'nla' || type === 'misc') {
    if (/misc/.test(s)) return 'todo';
    if (/txp/.test(s)) return pick('txp');
    if (/reset/.test(s)) return pick('txp'); // resets are retired (3 Oct 2026): one still in that column lands at TxP needed
    if (/fabrication/.test(s)) return fabStepFromSubtasks(subtasks) || pick('send');
    if (/package|made/.test(s)) return pick('pack');
    if (/checked in/.test(s)) return pick('checkedin');
    return flow[0];
  }
  if (type === 'marpe') { // from the Appliance project: on hold for the CBCT/Zoom (before it was submitted) = gathering records
    if (/submitted/.test(s)) return 'submitted';
    if (/zoom/.test(s) && !/hold/.test(s)) return 'zoom';
    if (/milestone/.test(s)) return 'milestones';
    if (/approv|manufactur|shipped|arrived/.test(s)) return 'approved';
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
  return [c.patient, typeOf(c).l, c.detail, stageLabel(c), c.dup ? 'Removed (duplicate)' : c.status === 'done' ? 'Completed' : 'Open', c.scanDate, c.labDate, c.deliveryDate ? c.deliveryDate + (c.deliveryTime ? ' ' + c.deliveryTime : '') : '', c.assigneeLabel || '', c.instructions, c.cc, c.ipr, c.notes, c.chart, c.titanUrl, (c.extras || []).join('; '), typeof submissionLabel === 'function' ? submissionLabel(c.initial, c.refN) : '', labName(c.lab), (c.teethNote || '').replace(/\n/g, '; '), c.aligners || '',
    c.shipToPatient ? 'Yes' : '', MARPE_RECORDS.filter(([k]) => (c.records || []).includes(k)).map(x => x[1]).join('; '), c.zoomDate ? c.zoomDate + (c.zoomTime ? ' ' + c.zoomTime : '') : '', atLabel(c.atTemplates),
    oneArch(c) === 'U' ? 'Upper only' : oneArch(c) === 'L' ? 'Lower only' : typeOf(c).aligner || ['insmile', 'inbrace'].includes(c.type) ? 'Upper & lower' : '',
    c.txStart || '', c.txEnd || '', scanStAsked(c) ? scanStText(c) : '']
    .map(csvCell).join(',');
}
