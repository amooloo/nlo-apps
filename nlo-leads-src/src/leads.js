/* =====================================================================
   Lead logic — pure functions only (no screen, no database), so the
   follow-up rules can be tested on their own.

   A lead is plain data (it is sealed as a whole):
     name, parent, phone, email, message, extra{}        what they sent
     src{kind,receivedAt,page,raw,asana,test,how}        where it came from
     flag/flagWhy/dupOf                                  needs a look (spam, duplicate, test, check)
     assignee/assigneeName, stage, appt/apptTime, closeWhy, comments[]
     steps[]  the follow-up attempts:
       kind  call | text | email      due/plan  YYYY-MM-DD (plan = the schedule before any shifting)
       doneAt ms · res · by · note · skip ('sched' | 'closed') · undo (snapshot, so the last log can be undone)
   ===================================================================== */
const STEP_DEFS = [
  { t: 'call', label: 'Call the lead' },
  { t: 'msg', label: 'Text or email' },
  { t: 'call', label: 'Call again' },
  { t: 'msg', label: 'Text or email again' },
  { t: 'call', label: 'Final call + close out' }
];
/* what a logged attempt can end in */
const RES = {
  sched: { l: 'Appointment scheduled', s: 'Scheduled' },
  follow: { l: 'Follow up needed', s: 'Follow up' },
  vm: { l: 'Left voicemail', s: 'Voicemail' },
  none: { l: 'No answer', s: 'No answer' },
  sent: { l: 'Sent, no reply yet', s: 'Sent' },
  no: { l: 'Not interested', s: 'Not interested' },
  done: { l: 'Done', s: 'Done' }
};
const CLOSE_WHY = { sched: 'Appointment scheduled', notint: 'Not interested', noresp: 'No response', dup: 'Duplicate', spam: 'Spam', test: 'Test request', other: 'Other' };
const FLAG_LABEL = { spam: 'Looks like spam', dup: 'Possible duplicate', test: 'Test request', check: 'Please check' };

const DEFAULT_TPL = {
  text1: 'Hi {first}, this is {me} at {office}. We got your request for an appointment and tried to call. When is a good time to reach you? You can also call or text us at {phone}.',
  subj1: 'Your appointment request – {office}',
  email1: 'Hi {first},\n\nThank you for reaching out to {office}. We received your request for an appointment and tried to call you. What is a good time to reach you? You can also call or text us at {phone} and we will get you scheduled.\n\nThank you,\n{me}\n{office}\n{phone}',
  text2: 'Hi {first}, it is {me} at {office} again. We would still love to get your visit scheduled. Reply here or call or text {phone} whenever it works for you.',
  subj2: 'Still want to schedule? – {office}',
  email2: 'Hi {first},\n\nThis is {me} at {office}. We have been trying to reach you about your appointment request and would love to get you on the schedule. Reply to this email or call or text us at {phone} whenever it works for you.\n\nThank you,\n{me}\n{office}\n{phone}'
};
const DEFAULT_LEADS_CFG = {
  offsets: [0, 0, 1, 7, 14],      // calendar days after day 0 for each attempt (then rolled to an office day)
  days: [1, 2, 3, 4],             // office days: Monday–Thursday
  closeHour: 17,                  // requests after this hour count as the next day
  assignee: 'auto',               // '' = nobody, 'auto' = Savannah (as in Asana) when she has a login, or a staff id
  phone: '352-332-7466',
  feedUrl: '',
  tpl: DEFAULT_TPL
};
function leadCfg(settings) {
  const s = (settings && settings.leads) || {};
  const c = Object.assign({}, DEFAULT_LEADS_CFG, s);
  c.offsets = Array.isArray(s.offsets) && s.offsets.length === STEP_DEFS.length && s.offsets.every(n => Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 120) ? s.offsets.map(Number) : DEFAULT_LEADS_CFG.offsets.slice();
  c.days = Array.isArray(s.days) && s.days.length && s.days.every(d => Number.isInteger(Number(d)) && d >= 0 && d <= 6) ? s.days.map(Number) : DEFAULT_LEADS_CFG.days.slice();
  const ch = Number(s.closeHour); c.closeHour = s.closeHour != null && s.closeHour !== '' && Number.isFinite(ch) ? Math.min(24, Math.max(0, ch)) : DEFAULT_LEADS_CFG.closeHour;
  c.tpl = Object.assign({}, DEFAULT_TPL, s.tpl || {});
  return c;
}

/* ---------- office days ---------- */
function isOfficeDay(iso, cfg) {
  const [y, m, d] = iso.split('-').map(Number); const wd = new Date(y, m - 1, d).getDay();
  return cfg.days.includes(wd) && !officeHolidays(y).includes(iso);
}
function nextOfficeDay(iso, cfg) { let d = iso; for (let i = 0; i < 400 && !isOfficeDay(d, cfg); i++) d = addDays(d, 1); return d; }
/* day 0 = the first office day the request can be worked: today if it came in before closing, else the next office day */
function dayZero(ms, cfg) {
  const d = new Date(ms); let iso = isoOf(d);
  if (d.getHours() >= cfg.closeHour) iso = addDays(iso, 1);
  return nextOfficeDay(iso, cfg);
}

/* ---------- contact details ---------- */
function phoneInfo(s) {
  const raw = String(s || '').trim(); let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  const ok = d.length === 10;
  return { raw, digits: d, ok, pretty: ok ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : raw, tel: ok ? '+1' + d : (d.length >= 7 ? d : '') };
}
/* a usable address: checked in one pass (no slow backtracking on odd input), and without ? & = % # / or quotes,
   which could slip extra recipients or headers into a mailto: link */
const EMAIL_OK = /^[^\s@<>?&=%#/\\:;,"'()[\]]+@[^\s@<>?&=%#/\\:;,"'()[\].]+(\.[^\s@<>?&=%#/\\:;,"'()[\].]+)+$/;
function validEmail(s) { s = String(s || '').trim(); return s.length <= 254 && EMAIL_OK.test(s) && /\.[^.]{2,}$/.test(s); }
/* "john smith" / "JOHN SMITH" → "John Smith"; names typed with normal capitals are left alone */
function properName(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s || (/[a-z]/.test(s) && /[A-Z]/.test(s))) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}
function leadName(l) { return l.name || l.parent || '(no name)'; }
/* who to greet in a message: the parent when there is one, else the patient */
function leadFirst(l) { const n = (l.parent || l.name || '').trim(); return n.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').split(/\s+/)[0] || 'there'; }
function receivedAt(l) { return (l.src && l.src.receivedAt) || l.createdAt || 0; }

/* ---------- planning ---------- */
function blankLead() {
  return { name: '', parent: '', phone: '', email: '', message: '', extra: {}, src: { kind: 'manual', receivedAt: 0 }, flag: '', flagWhy: '', dupOf: '', assignee: '', assigneeName: '', steps: [], stage: 'new', appt: '', apptTime: '', closeWhy: '', comments: [], createdAt: 0, createdBy: '' };
}
/* how to reach them on a given attempt: calls need a phone number; the first message is a text, the second an email */
function pickKind(l, i) {
  const def = STEP_DEFS[i], hasP = phoneInfo(l.phone).ok, hasE = validEmail(l.email);
  if (!def || def.t === 'call') return hasP || !hasE ? 'call' : 'email';
  if (i === 1) return hasP ? 'text' : hasE ? 'email' : 'text';
  return hasE ? 'email' : hasP ? 'text' : 'email';
}
function planSteps(day0, cfg) {
  return STEP_DEFS.map((def, i) => { const due = nextOfficeDay(addDays(day0, cfg.offsets[i]), cfg); return { kind: def.t === 'call' ? 'call' : 'text', due, plan: due, doneAt: null, res: '', by: '', note: '', skip: '' }; });
}
/* set every pending step's contact method from the details on file (steps someone switched by hand keep their choice) */
function setKinds(l) { l.steps.forEach((s, i) => { if (!s.doneAt && !s.skip && !s.km) s.kind = s.extra ? (phoneInfo(l.phone).ok || !validEmail(l.email) ? 'call' : 'email') : pickKind(l, i); }); }
function stepLabel(l, i) {
  const s = l.steps[i]; if (!s) return '';
  if (s.extra) return s.kind === 'call' ? 'Follow-up call' : 'Follow-up message';
  return STEP_DEFS[i] ? STEP_DEFS[i].label : 'Follow up';
}
/* a new lead with its full follow-up plan, ready to save */
function startLead(l, receivedMs, cfg) {
  l.src = Object.assign({ kind: 'manual' }, l.src, { receivedAt: receivedMs });
  l.steps = planSteps(dayZero(receivedMs, cfg), cfg); setKinds(l);
  l.stage = 'new'; return l;
}
function pickAssignee(cfg, roster) {
  const act = (roster || []).filter(r => r.active);
  if (!cfg.assignee) return '';
  if (cfg.assignee === 'auto') { const hit = act.find(r => firstName(r.name).toLowerCase() === 'savannah'); return hit ? hit.sid : ''; }
  return act.some(r => r.sid === cfg.assignee) ? cfg.assignee : '';
}

/* ---------- reading a lead's state ---------- */
const isPending = s => !s.doneAt && !s.skip;
function curStep(l) { return (l.steps || []).findIndex(isPending); }
function lastDone(l) { for (let i = (l.steps || []).length - 1; i >= 0; i--) if (l.steps[i].doneAt) return i; return -1; }
function lastAttempt(l) { const i = lastDone(l); return i < 0 ? null : Object.assign({ i }, l.steps[i]); }
function stepsLeft(l) { return (l.steps || []).filter(isPending).length; }
/* the date the lead is next due to be worked ('' when closed, scheduled or waiting on a review) */
function leadDue(l) {
  if (l.status === 'done' || l.flag || l.stage === 'scheduled') return '';
  const i = curStep(l); return i < 0 ? '' : l.steps[i].due;
}
/* where a lead sits relative to today: late | today | soon (next 7 days) | later | none */
function bucketOf(due, today) {
  if (!due) return 'none'; const d = daysBetween(today, due);
  return d < 0 ? 'late' : d === 0 ? 'today' : d <= 7 ? 'soon' : 'later';
}

/* ---------- changing a lead (each works on a copy the caller will save) ---------- */
/* an attempt was logged late: later steps keep their gaps from the date it really happened (never earlier than planned) */
function reflow(l, i, doneISO, cfg) {
  const base = l.steps[i].plan || l.steps[i].due;
  l.steps.forEach((s, j) => {
    if (j <= i || !isPending(s)) return;
    const gap = Math.max(0, daysBetween(base, s.plan || s.due));
    const want = nextOfficeDay(addDays(doneISO, gap), cfg);
    if (want > s.due) s.due = want;
  });
}
/* move the pending steps to start on `dateISO` (rolled to an office day), keeping their gaps; with none left, add a call */
function rebase(l, dateISO, cfg) {
  const pend = []; l.steps.forEach((s, j) => { if (isPending(s)) pend.push(j); });
  const first = nextOfficeDay(dateISO, cfg);
  if (!pend.length) { l.steps.push({ kind: pickKind(l, 0), due: first, plan: first, doneAt: null, res: '', by: '', note: '', skip: '', extra: true }); return; }
  const p0 = l.steps[pend[0]].plan || l.steps[pend[0]].due;
  pend.forEach((j, k) => {
    const s = l.steps[j]; const gap = Math.max(0, daysBetween(p0, s.plan || s.due));
    const d = k === 0 ? first : nextOfficeDay(addDays(first, gap), cfg);
    s.due = d; s.plan = d;
  });
}
function closeIn(l, why) { l.closeWhy = why; l.steps.forEach(s => { if (isPending(s)) s.skip = 'closed'; }); }
/* log the result of attempt i. Returns 'done' when that closed the lead. Throws 'not-pending' / 'need-date' / 'bad-date'. */
function applyResult(l, i, res, o, cfg, nowMs) {
  o = o || {}; const st = l.steps[i];
  if (!st || !isPending(st)) throw errCode('not-pending');
  if (!RES[res]) throw errCode('bad-result');
  const today = isoOf(new Date(nowMs));
  if (res === 'follow') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.follow || '')) throw errCode('need-date', 'Pick the day to follow up.');
    if (o.follow < today) throw errCode('bad-date', 'Pick today or a day ahead.');
  }
  st.undo = { stage: l.stage, appt: l.appt || '', apptTime: l.apptTime || '', closeWhy: l.closeWhy || '', len: l.steps.length, later: l.steps.slice(i + 1).map(s => [s.due, s.plan, s.skip || '']) };
  st.doneAt = nowMs; st.res = res; st.by = o.by || ''; st.note = String(o.note || '').trim();
  if (res === 'sched') {
    l.stage = 'scheduled'; l.appt = /^\d{4}-\d{2}-\d{2}$/.test(o.appt || '') ? o.appt : ''; l.apptTime = /^\d{1,2}:\d{2}$/.test(o.apptTime || '') ? o.apptTime : '';
    l.steps.forEach((s, j) => { if (j > i && isPending(s)) s.skip = 'sched'; });
    return null;
  }
  if (res === 'no') { l.stage = 'contacted'; closeIn(l, 'notint'); return 'done'; }
  l.stage = 'contacted';
  if (res === 'follow') { rebase(l, o.follow, cfg); return null; }
  reflow(l, i, today, cfg);
  if (!stepsLeft(l)) { closeIn(l, 'noresp'); return 'done'; }
  return null;
}
/* the last logged attempt can be taken back while the lead has not moved on since */
function canUndo(l) {
  const i = lastDone(l); if (i < 0 || !l.steps[i].undo) return false;
  if (!l.closeWhy) return true;
  const r = l.steps[i].res;
  return (l.closeWhy === 'notint' && r === 'no') || (l.closeWhy === 'sched' && r === 'sched') || (l.closeWhy === 'noresp' && ['vm', 'none', 'sent', 'done'].includes(r));
}
function undoStep(l) {
  const i = lastDone(l); if (i < 0 || !l.steps[i].undo) throw errCode('nothing-to-undo');
  const st = l.steps[i], u = st.undo;
  l.steps.length = Math.min(l.steps.length, u.len);
  u.later.forEach((t, k) => { const s = l.steps[i + 1 + k]; if (s) { s.due = t[0]; s.plan = t[1]; s.skip = t[2]; } });
  l.stage = u.stage; l.appt = u.appt; l.apptTime = u.apptTime; l.closeWhy = u.closeWhy;
  st.doneAt = null; st.res = ''; st.by = ''; st.note = ''; delete st.undo;
  return 'open';
}
/* close the lead by hand (or as the plan ends) */
function closeLead(l, why) { closeIn(l, why); return 'done'; }
/* bring a closed lead back: remaining steps start again from today (or one new call if none are left) */
function reopenLead(l, cfg, todayISO) {
  l.closeWhy = '';
  l.steps.forEach(s => { if (!s.doneAt && s.skip) s.skip = ''; });
  if (l.stage === 'scheduled') { l.stage = 'contacted'; l.appt = ''; l.apptTime = ''; }
  if (!l.steps.some(s => s.doneAt) && l.stage !== 'scheduled') l.stage = 'new';
  rebase(l, todayISO, cfg);
  return 'open';
}
/* a flagged lead was checked and is real: clear the flag; steps that fell overdue while it waited start again from today */
function clearFlag(l, cfg, todayISO) {
  l.flag = ''; l.flagWhy = ''; l.dupOf = '';
  const i = curStep(l);
  if (i >= 0 && l.steps[i].due < todayISO) rebase(l, todayISO, cfg);
}
/* switch a pending message step between text and email (a call step can't be switched) */
function setStepKind(l, i, kind) {
  const s = l.steps[i]; if (!s || !isPending(s)) return;
  if (!['text', 'email'].includes(kind) || s.kind === 'call') return;
  s.kind = kind; s.km = 1;
}

/* ---------- messages ---------- */
function fillTpl(t, v) { return String(t || '').replace(/\{(first|me|office|phone)\}/g, (m, k) => v[k] == null ? '' : v[k]); }
/* the text or email for message attempt i, ready to copy or open */
function messageFor(l, i, cfg, me) {
  const s = l.steps[i]; const which = i >= 3 ? 2 : 1;
  const v = { first: leadFirst(l), me: me || '', office: OFFICE_NAME, phone: cfg.phone || '' };
  const isText = s && s.kind === 'text';
  return { kind: isText ? 'text' : 'email', subject: fillTpl(cfg.tpl['subj' + which], v), body: fillTpl(cfg.tpl[(isText ? 'text' : 'email') + which], v) };
}
function smsLink(phone, body) { const p = phoneInfo(phone); return p.tel ? 'sms:' + p.tel + '?&body=' + encodeURIComponent(body) : ''; }
function mailLink(email, subject, body) { return validEmail(email) ? 'mailto:' + String(email).trim() + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body) : ''; }
function telLink(phone) { const p = phoneInfo(phone); return p.tel ? 'tel:' + p.tel : ''; }

/* ---------- duplicates ---------- */
/* an earlier lead from the same phone number or email within the last `days` days (or null) */
function findDup(l, pool, days) {
  const p = phoneInfo(l.phone), e = validEmail(l.email) ? l.email.trim().toLowerCase() : '';
  if (!(p.ok || e)) return null;
  const at = receivedAt(l) || Date.now(), win = (days || 45) * 86400000;
  let best = null;
  (pool || []).forEach(o => {
    if (!o || (l.id && o.id === l.id) || o.locked) return;
    if (['spam', 'test', 'dup'].includes(o.closeWhy) || (o.src && o.src.test)) return;
    const oa = receivedAt(o); if (!oa || oa > at || at - oa > win) return;
    const same = (p.ok && phoneInfo(o.phone).digits === p.digits) || (e && validEmail(o.email) && o.email.trim().toLowerCase() === e);
    if (same && (!best || oa > receivedAt(best))) best = o;
  });
  return best;
}

/* ---------- website requests ---------- */
const FLAG_ORDER = ['test', 'spam', 'dup', 'check'];
function clip(s, n) { s = String(s == null ? '' : s).replace(/\u0000/g, '').trim(); return s.length > n ? s.slice(0, n) : s; }
/* a request the receiving service read (its fields mapped, its own flags attached) becomes a lead with its plan */
function leadFromInbox(p, receivedMs, cfg, assignee, pool) {
  const l = blankLead();
  l.name = properName(clip(p.name, 120)); l.parent = properName(clip(p.parent, 120));
  l.phone = clip(p.phone, 60); l.email = clip(p.email, 200); l.message = clip(p.message, 4000);
  l.extra = {}; Object.keys(p.extra || {}).filter(k => !['__proto__', 'constructor', 'prototype'].includes(k)).slice(0, 20).forEach(k => { l.extra[clip(k, 80)] = clip(p.extra[k], 500); });
  l.src = { kind: 'website', receivedAt: receivedMs, page: clip(p.page, 300), raw: clip(p.raw, 8000), test: !!p.test };
  const flags = (Array.isArray(p.flags) ? p.flags : []).filter(f => f && FLAG_ORDER.includes(f.k)).map(f => ({ k: f.k, why: clip(f.why, 160) }));
  startLead(l, receivedMs, cfg);
  l.assignee = assignee || '';
  const dup = flags.some(f => f.k === 'test') ? null : findDup(l, pool, 45);
  if (dup) { flags.push({ k: 'dup', why: 'Same ' + (phoneInfo(dup.phone).ok && phoneInfo(dup.phone).digits === phoneInfo(l.phone).digits ? 'phone number' : 'email') + ' as ' + leadName(dup) + (dup.status === 'done' ? ' (closed)' : '') }); l.dupOf = dup.id || ''; }
  if (flags.length) { l.flag = FLAG_ORDER.find(k => flags.some(f => f.k === k)); l.flagWhy = Array.from(new Set(flags.map(f => f.why).filter(Boolean))).join(' · '); }
  return l;
}

/* ---------- results ---------- */
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
/* a real request: not spam, a duplicate or a test, and not still waiting on a look */
function countable(l) { return !l.locked && !['spam', 'test', 'dup'].includes(l.closeWhy) && !(l.src && l.src.test) && !(l.flag && l.status !== 'done'); }
function leadStats(list, nowMs, days) {
  const since = nowMs - days * 86400000;
  const real = list.filter(l => receivedAt(l) >= since && countable(l));
  const r = { received: real.length, scheduled: 0, notint: 0, noresp: 0, other: 0, working: 0, noContact: 0, bySource: {}, medianHours: null };
  const hours = [];
  real.forEach(l => {
    const sched = l.stage === 'scheduled' || l.closeWhy === 'sched';
    if (sched) r.scheduled++;
    else if (l.closeWhy === 'notint') r.notint++;
    else if (l.closeWhy === 'noresp') r.noresp++;
    else if (l.status === 'done') r.other++;
    else r.working++;
    if (!l.steps.some(s => s.doneAt)) r.noContact++;
    const k = (l.src && l.src.kind) || 'manual'; r.bySource[k] = (r.bySource[k] || 0) + 1;
    const first = l.steps.filter(s => s.doneAt).map(s => s.doneAt).sort((a, b) => a - b)[0];
    if (first && receivedAt(l)) hours.push(Math.max(0, (first - receivedAt(l)) / 3600000));
  });
  r.medianHours = median(hours);
  return r;
}
function fmtHours(h) { if (h == null) return '—'; if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min'; if (h < 48) return Math.round(h) + ' h'; return Math.round(h / 24) + ' days'; }

/* ---------- Asana (the "New Leads – Appointment Requests" project) ---------- */
/* the "Label: value" text the website form emails (and Asana keeps as the task notes) */
function parseLeadText(text) {
  const out = { name: '', parent: '', email: '', phone: '', message: '', extra: {}, date: '', page: '' };
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const META = /^(date|time|page url|user agent|remote ip|powered by|credit)\s*:/i;
  const kindOf = k => /^(parent|guardian)/.test(k) ? 'parent' : /^(patient|child|name|full name|your name)/.test(k) ? 'name' : /e-?mail/.test(k) ? 'email'
    : /phone|mobile|cell|tel/.test(k) ? 'phone' : /message|comment|question|note|detail|help/.test(k) ? 'message' : 'extra';
  let cur = null, meta = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^-{3,}$/.test(line)) { meta = true; cur = null; continue; }
    const m = line.match(/^([^:]{1,40}):\s*(.*)$/);
    if (meta || (m && META.test(line))) {
      meta = true;
      if (m && /^date$/i.test(m[1].trim())) out.date = m[2].trim();
      if (m && /^page url$/i.test(m[1].trim())) out.page = m[2].trim();
      continue;
    }
    if (m) {
      const label = m[1].trim(), k = kindOf(label.toLowerCase()), v = m[2].trim();
      if (k === 'extra' && cur === 'message') { out.message += (out.message && !out.message.endsWith('\n') ? '\n' : '') + line; continue; } // "Thanks: Jane" inside a message
      if (k === 'extra') { out.extra[label] = v; cur = 'extra:' + label; } else { out[k] = v; cur = k; }
      continue;
    }
    if (!line) { if (cur === 'message' && out.message) out.message += '\n'; continue; }
    if (cur === 'message') out.message += (out.message && !out.message.endsWith('\n') ? '\n' : '') + line;
    else if (cur && cur.startsWith('extra:')) out.extra[cur.slice(6)] += ' ' + line;
  }
  out.message = out.message.trim();
  return out;
}
/* dates from Asana: a bare 2026-10-05 means that day (noon, so time zones can't move it); full timestamps are exact */
function parseWhen(x) {
  x = String(x || '').trim(); if (!x) return 0;
  const m = x.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  return Date.parse(x) || 0;
}
const ASANA_RES = [[/schedul/i, 'sched'], [/follow/i, 'follow'], [/voice\s*mail|\bvm\b/i, 'vm'], [/no answer|no response|didn.?t answer/i, 'none'], [/sent|no reply/i, 'sent'], [/not interested|declin/i, 'no']];
function asanaRes(text) { const hit = ASANA_RES.find(([re]) => re.test(text || '')); return hit ? hit[1] : ''; }
/* One Asana task (+ its "Attempt N" subtasks) → a lead, keeping what was already done. roster: [{sid,name,active}] */
function leadFromAsana(t, roster, cfg, nowMs) {
  const p = parseLeadText(t.notes);
  const l = blankLead();
  const nm = String(t.name || '').replace(/^website appointment request\s*[-–—:]\s*/i, '').trim();
  l.name = properName(clip(p.name || nm, 120)); l.parent = properName(clip(p.parent, 120)); l.phone = clip(p.phone, 60); l.email = clip(p.email, 200); l.message = clip(p.message, 4000);
  l.extra = {}; Object.keys(p.extra).filter(k => !['__proto__', 'constructor', 'prototype'].includes(k)).slice(0, 20).forEach(k => { l.extra[clip(k, 80)] = clip(p.extra[k], 500); });
  const created = parseWhen(t.createdAt) || parseWhen(p.date) || nowMs;
  l.src = { kind: 'asana', receivedAt: created, page: p.page, asana: String(t.gid || '') };
  l.createdAt = nowMs; l.createdBy = 'import';
  const first = String(t.assignee || '').trim().split(/\s+/)[0].toLowerCase();
  const hit = first && (roster || []).find(r => r.active && firstName(r.name).toLowerCase() === first);
  l.assignee = hit ? hit.sid : ''; l.assigneeName = hit ? '' : String(t.assignee || '');
  // the five attempts: due dates and ticks come from the subtasks; anything missing is planned fresh
  const base = planSteps(dayZero(created, cfg), cfg);
  const subs = (t.subtasks || []).map(s => ({ n: Number((String(s.name || '').match(/attempt\s*#?\s*(\d)/i) || [])[1]) || 0, s }));
  l.steps = base.map((st, i) => {
    const hitS = subs.find(x => x.n === i + 1); if (!hitS) return st;
    const s = hitS.s, due = /^\d{4}-\d{2}-\d{2}/.test(s.due || '') ? s.due.slice(0, 10) : st.due;
    st.due = due; st.plan = due;
    const hasT = /\btext\b|sms/i.test(s.name || ''), hasE = /e-?mail/i.test(s.name || '');
    if (STEP_DEFS[i].t === 'msg' && hasT !== hasE) { st.kind = hasT ? 'text' : 'email'; st.km = 1; }
    if (s.completed) { st.doneAt = parseWhen(s.completedAt) || nowMs; st.res = asanaRes(s.outcome) || 'done'; }
    return st;
  });
  setKinds(l);
  const sec = String(t.section || '');
  const outcome = asanaRes(t.outcome);
  const anyDone = l.steps.some(s => s.doneAt);
  l.stage = /schedul/i.test(sec) || outcome === 'sched' || l.steps.some(s => s.res === 'sched') ? 'scheduled' : anyDone || /contact|follow|progress/i.test(sec) ? 'contacted' : 'new';
  let status = 'open';
  if (l.stage === 'scheduled') l.steps.forEach(s => { if (isPending(s)) s.skip = 'sched'; });
  if (t.completed) {
    status = 'done';
    const why = l.stage === 'scheduled' ? 'sched' : outcome === 'no' || l.steps.some(s => s.res === 'no') ? 'notint' : stepsLeft(l) ? 'other' : 'noresp';
    closeIn(l, why);
  } else if (!stepsLeft(l) && l.stage !== 'scheduled') {
    status = 'done'; closeIn(l, 'noresp');
  }
  return { data: l, status, closedAt: status === 'done' ? (parseWhen(t.completedAt) || nowMs) : null };
}
/* Asana's CSV export: parent rows are leads; "Parent task" rows are their attempts (they follow the lead they belong to). Custom fields come as extra columns. */
function asanaLeadsFromCSV(text) {
  const rows = parseCSV(text), parents = [], last = {}, orphans = [];
  const pick = (r, ...names) => { for (const n of names) { const k = Object.keys(r).find(x => x.trim().toLowerCase() === n.toLowerCase()); if (k && r[k] != null && String(r[k]).trim()) return r[k]; } return ''; };
  rows.forEach(r => {
    if (!r['Parent task']) {
      const t = { gid: r['Task ID'] || '', name: r['Name'] || '', notes: r['Notes'] || '', assignee: r['Assignee'] || '', section: r['Section/Column'] || '',
        createdAt: r['Created At'] || '', completed: !!(r['Completed At'] || '').trim(), completedAt: r['Completed At'] || '', outcome: pick(r, 'Outcome'), subtasks: [] };
      parents.push(t); last[t.name] = t;
    } else {
      const sub = { name: r['Name'] || '', completed: !!(r['Completed At'] || '').trim(), completedAt: r['Completed At'] || '', due: r['Due Date'] || '', outcome: pick(r, 'Outcome') };
      const par = last[r['Parent task']]; if (par) par.subtasks.push(sub); else orphans.push([r['Parent task'], sub]);
    }
  });
  orphans.forEach(([n, sub]) => { const par = parents.find(p => p.name === n); if (par) par.subtasks.push(sub); });
  return parents.filter(t => /appointment request|new lead/i.test(t.name) || parseLeadText(t.notes).email || parseLeadText(t.notes).phone);
}

/* ---------- export ---------- */
function leadToCSVRow(l, who) {
  const a = lastAttempt(l);
  return [leadName(l), l.parent, l.phone, l.email, l.message, (l.src && l.src.kind) || '', l.src && l.src.receivedAt ? isoOf(new Date(l.src.receivedAt)) : '', l.status === 'done' ? 'Closed' : 'Open',
    l.status === 'done' ? (CLOSE_WHY[l.closeWhy] || l.closeWhy || '') : (l.stage || ''), l.appt || '', who || '', a ? (RES[a.res] || {}).l || a.res : '', String(l.steps.filter(s => s.doneAt).length)].map(csvCell).join(',');
}
const LEAD_CSV_HEAD = ['Name', 'Parent', 'Phone', 'Email', 'Message', 'Source', 'Received', 'Status', 'Stage / reason closed', 'Appointment', 'Assigned', 'Last result', 'Attempts made'].join(',');
