/* =====================================================================
   NLO Time Clock — alerts (Google Apps Script)

   Every 5 minutes this script reads the office's time clock and tells Dr. A — and the people he added in
   Time Clock → Alerts — by email and/or phone push (the free ntfy app) when someone:
     • is getting close to overtime (the heads-up hours, 36 and 38) or reaches it (40 hours in the workweek),
     • passes the overtime approved ahead of time, or their own weekly cap,
     • clocks in too early, on a day the office is closed, or from home (on a day that isn't one of their home days),
     • punches at the time-clock computer while it isn't on the office network (moved, or the internet changed),
     • is still clocked in late, or works a long shift,
     • forgets to clock out, or never comes back from lunch,
     • asks a manager for a punch they missed (or leaves a note) at the time clock or on My time,
     • or when someone types 5 wrong PINs for a person at the time clock.
   On payroll Friday (7 AM) it emails each person's regular and overtime hours for the two weeks. The morning after a
   pay period ends, it emails that period's time cards as two spreadsheets (the same as the Payroll page's), so this
   Gmail account keeps a copy of every pay period without anyone downloading them.
   If Dr. A set a time for it, it also sends a daily summary. Each alert goes out once, even if this script
   ends up in two Gmail accounts by accident. Emails come from this Gmail account.

   It can only read the time clock, and write its own list of alerts sent and when it last checked:
   it can't change anyone's time. At night (10 PM to 5 AM) it checks every half hour instead.

   Turn on:  pick "setup" next to Run (top bar), press Run, and allow access.
   Turn off: pick "stop", press Run.
   ===================================================================== */
var VERSION = '2';
var CONFIG = /*TC_CONFIG*/null; // filled in by NLO Time Clock when you copy the script (Time Clock → Alerts → Get the script)

// where each kind of alert goes when Dr. A hasn't picked: 1 = email, 2 = phone push, 3 = both, 0 = not sent
var DEFAULT_ROUTE = TCE.ROUTE; // (the same defaults the page shows)
var APP_URL = 'https://amooloo.github.io/nlo-apps/nlo-timeclock.html';
var EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
var GEN_ = null; // which set of saved copies (cache) this setup uses — a new setup starts fresh ones

/* Run once: checks the login, turns on the 5-minute check, and checks right away. */
function setup() {
  if (!CONFIG || !CONFIG.apiKey || !CONFIG.projectId || !CONFIG.botEmail || !CONFIG.botPassword) {
    throw new Error('This copy has no NLO Time Clock login in it. Copy the script again: Time Clock → Alerts → Get the script.');
  }
  tz_();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('TC_CFG', JSON.stringify(CONFIG));
  props.setProperty('TC_FAILS', '0');
  GEN_ = String(Number(props.getProperty('TC_GEN') || 0) + 1);
  props.setProperty('TC_GEN', GEN_); // fresh copies of everything: the login, the people, the punches
  const cfg = cfg_(props);
  try { session_(cfg, true); }
  catch (e) { throw new Error(msg_(e) + ' Nothing was turned on.'); }
  stopTriggers_();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  let r;
  try { r = check_(true); }
  catch (e) {
    Logger.log('NLO Time Clock alerts are on for ' + mailbox_() + ', but the first check hit a problem: ' + msg_(e));
    throw e;
  }
  Logger.log('NLO Time Clock alerts are on for ' + mailbox_() + ' (' + r + '). It checks every 5 minutes (every half hour at night); Time Clock → Alerts shows each check.');
  return r;
}

/* Turns the 5-minute check off. */
function stop() {
  stopTriggers_();
  Logger.log('NLO Time Clock alerts are off for ' + mailbox_() + '. Run setup to turn them back on.');
}

/* Runs every 5 minutes (the timer setup turned on). */
function tick() { return check_(false); }

/* One check. force: check now even at night (setup). */
function check_(force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return 'busy'; // the last check is still running
  const props = PropertiesService.getScriptProperties();
  let cfg = null, s = null;
  try {
    tz_(); GEN_ = null;
    const now = Date.now(), p = TCE.parts(now);
    // at night, only the check in the first 5 minutes of each half hour does anything (nobody is clocking in; it saves reads)
    if (!force && (p.h >= 22 || p.h < 5) && p.mi % 30 >= 5) return 'night';
    cfg = cfg_(props);
    s = session_(cfg);
    const r = run_(cfg, s, props, now);
    props.setProperty('TC_FAILS', '0');
    Logger.log('NLO Time Clock alerts: ' + r.log);
    return r.said;
  } catch (e) {
    const n = Number(props.getProperty('TC_FAILS') || 0) + 1;
    props.setProperty('TC_FAILS', String(n));
    try { if (cfg && s) beat_(cfg, s, 0, msg_(e)); } catch (x) { } // (signed out: there's no way to check in)
    if (n >= 3) warn_(props, e);
    Logger.log('NLO Time Clock alerts: this check failed — ' + msg_(e));
    throw e;
  } finally { lock.releaseLock(); }
}

/* ---------- one check: read the clock, work out the alerts, send the new ones ---------- */
function run_(cfg, s, props, now) {
  const al = getDoc_(cfg, s, 'meta/tcAlerts', 'where alerts go');
  if (!al) {
    beat_(cfg, s, 0, 'No alert settings yet');
    return { said: 'No alert settings yet', log: 'no alert settings yet (Time Clock → Alerts), so there is nothing to send.' };
  }
  const A = where_(plain_(al.fields));
  if (!A.emails.length && !A.topic) {
    const why = 'No email address or phone push set in Time Clock → Alerts';
    beat_(cfg, s, 0, why);
    return { said: why, log: why.toLowerCase() + ', so there is nowhere to send alerts.' };
  }
  const office = office_(cfg, s, now), set = TCE.settingsOf(office.set);
  const today = TCE.dayOf(now), wkIso = TCE.weekOf(today, set.wk);
  // payroll Friday, from 7 AM until the numbers have gone out: the whole pay period is needed
  const pay = payrollDue_(A, set, props, today, now);
  // the time cards of the pay period just over (for the records), until they've gone: that whole period too
  const rec = recordsDue_(A, set, props, today, now);
  // the punches that matter now: this workweek, and at least the last 3 days (a missing clock-out from last week)
  // (payroll: from the start of the workweek the period starts in, as that week's first 40 hours are regular)
  const from = Math.min(TCE.dayStart(wkIso), TCE.dayStart(TCE.addDays(today, -3)), pay ? TCE.dayStart(TCE.weekOf(pay[0], set.wk)) : Infinity,
    rec ? TCE.dayStart(TCE.weekOf(rec[0], set.wk)) : Infinity);
  const P = bySid_(window_(cfg, s, 'tcPunch', from, 'punches', punchOf_));
  // corrections made since an hour before that (one can add a time up to an hour ahead); a time added before the
  // window is left out, like the punches around it. ('fixes2': kept with who made each one; copies saved before that are
  // read again)
  const F = bySid_(window_(cfg, s, 'tcFix', from - TCE.HOUR, 'fixes2', fixOf_).filter(f => f.op !== 'add' || f.t >= from));
  const approved = approvals_(cfg, s, wkIso);

  // requests still waiting for a manager: an alert for each new one (from someone on the clock), and the daily summary lists them
  const onClock = {};
  office.people.forEach(p => { onClock[p.sid] = p.name; });
  const asks = openReqs_(cfg, s).filter(r => onClock[r.sid]);
  const weeks = [], alerts = [];
  office.people.forEach(p => {
    const staff = TCE.staffOf(p.staff);
    const w = TCE.week({ sid: p.sid, list: TCE.entries(P[p.sid] || [], F[p.sid] || []), set, staff, wkIso, now, approved: approved[p.sid] || 0 });
    weeks.push({ p, w });
    TCE.alertsFor(w, { name: p.name, set, now, staff, asks }).forEach(a => alerts.push(a));
  });
  lockouts_(cfg, s, office, now).forEach(a => alerts.push(a));
  pinStreaks_(cfg, s, office, now).forEach(a => alerts.push(a));
  asks.forEach(r => { if (r.at > now - TCE.DAY) alerts.push(TCE.reqAlert(r, onClock[r.sid])); });
  const test = testAlert_(A, props, now);
  if (test) alerts.push(test);
  if (A.digest && now >= TCE.atTime(today, A.digest)) alerts.push(digest_(weeks, today, now, asks, onClock));
  if (pay) alerts.push(payroll_(cfg, s, office, set, P, F, asks, pay, now));
  // (the time cards never hold up the alerts: a problem making them shows on the check-in, and the next check tries again)
  let recErr = '';
  if (rec) { try { const t = records_(cfg, s, props, office, set, P, F, asks, rec, now); if (t) alerts.push(t); } catch (e) { recErr = 'The time cards couldn’t be made: ' + cap_(msg_(e), 120); } }

  const r = deliver_(cfg, s, props, alerts, A, now);
  if (recErr) r.errs.push(recErr);
  if (test && r.fin[test.key]) props.setProperty('TC_TEST', String(test.ms));
  beat_(cfg, s, r.sent, r.errs.join(' · '));
  const said = r.sent + ' alert' + (r.sent === 1 ? '' : 's') + ' sent' + (r.errs.length ? ' — ' + r.errs.join(' · ') : '');
  const log = 'checked ' + office.people.length + ' ' + (office.people.length === 1 ? 'person' : 'people') + '; ' + said +
    (r.titles.length ? ' (' + r.titles.join('; ') + ')' : '') + '.';
  return { said, log: cap_(log, 1500) };
}

/* where alerts go (meta/tcAlerts), made sensible: at most 10 real-looking addresses, a valid ntfy topic or none */
function where_(f) {
  const seen = {}, emails = [];
  (Array.isArray(f.emails) ? f.emails : []).forEach(x => {
    const e = String(x == null ? '' : x).trim(), k = e.toLowerCase();
    if (EMAIL_RE.test(e) && !seen[k] && emails.length < 10) { seen[k] = 1; emails.push(e); }
  });
  return {
    emails,
    topic: typeof f.topic === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(f.topic) ? f.topic : '',
    route: f.route && typeof f.route === 'object' && !Array.isArray(f.route) ? f.route : {},
    digest: TCE.okHM(f.digest) ? f.digest : '',
    test: typeof f.test === 'number' && f.test > 0 ? f.test : 0
  };
}
function routeOf_(route, type) {
  const v = route[type];
  if (Number.isInteger(v) && v >= 0 && v <= 3) return v;
  return DEFAULT_ROUTE[type] != null ? DEFAULT_ROUTE[type] : 3;
}

/* the clock's settings, the names and who's on the clock: read again every 10 minutes (they rarely change).
   names: first names (the alerts); full: full names, "Dr. A" for the owner (the time cards, as the page shows them) */
function office_(cfg, s, now) {
  const hit = cacheGet_('office2');
  if (hit && hit.at <= now && now - hit.at < 10 * TCE.MIN) return hit;
  const tc = getDoc_(cfg, s, 'meta/tc', 'settings');
  const roster = query_(cfg, s, 'roster', [], null, ['name', 'active', 'role']).docs; // (not the photos)
  const staff = query_(cfg, s, 'tcStaff', [], null, null).docs;
  const names = {}, active = {}, full = {};
  roster.forEach(d => {
    const f = plain_(d.fields), sid = idOf_(d);
    names[sid] = firstName_(f.name); active[sid] = f.active === true;
    full[sid] = f.role === 'owner' ? 'Dr. A' : cap_(String(f.name || '').trim(), 80) || names[sid];
  });
  const people = [], all = [];
  staff.forEach(d => {
    const f = plain_(d.fields), sid = idOf_(d), p = { sid, name: names[sid] || 'Someone', staff: f, active: !!active[sid] };
    all.push(p); // (everyone with clock settings: payroll lists anyone with time in the period, even someone who left)
    if (f.on === true && active[sid]) people.push(p); // (someone who left, or off the clock: no alerts)
  });
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.sid < b.sid ? -1 : 1);
  people.sort(byName); all.sort(byName);
  const o = { at: now, set: tc ? plain_(tc.fields) : null, names, full, people, all };
  cachePut_('office2', o, 10 * 60);
  return o;
}
/* "Robin Tester" → "Robin"; "Dr. Riley Test" → "Riley" */
function firstName_(name) {
  const w = String(name || '').trim().replace(/^dr(\.\s*|\s+)/i, '').split(/\s+/)[0];
  return w || 'Someone';
}

/* Punches (or corrections) since `from`, kept between checks so each check only asks for the new ones: punches are never
   changed or deleted, so what was read stays right. The overlap of 2 minutes catches one saved just as the last check read. */
function window_(cfg, s, coll, from, name, conv) {
  let c = cacheGet_(name);
  if (c && c.from <= from && c.lastAt > 0 && Array.isArray(c.docs)) {
    const r = query_(cfg, s, coll, [ff_('at', 'GREATER_THAN', tsv_(c.lastAt - 2 * TCE.MIN))], 'at', null);
    const byId = {};
    c.docs.forEach(d => { if (d.at >= from) byId[d.id] = d; }); // (the window moves on each day: the oldest drop off)
    r.docs.forEach(d => { const x = conv(d); if (x.at >= from) byId[x.id] = x; });
    c = { from, docs: Object.keys(byId).map(k => byId[k]).sort((a, b) => a.at - b.at), lastAt: r.readTime };
  } else { // first check (or the saved copy is gone): read the whole window
    const r = query_(cfg, s, coll, [ff_('at', 'GREATER_THAN_OR_EQUAL', tsv_(from))], 'at', null);
    c = { from, docs: r.docs.map(conv), lastAt: r.readTime };
  }
  cachePut_(name, c, 6 * 3600);
  return c.docs;
}
function punchOf_(d) { const f = plain_(d.fields); return { id: idOf_(d), sid: f.sid, kind: f.kind, at: f.at, src: f.src, net: f.net || '', by: f.by || '' }; }
function fixOf_(d) {
  const f = plain_(d.fields);
  return { id: idOf_(d), sid: f.sid, op: f.op, ref: f.ref || '', kind: f.kind || '', t: Number(f.t) || 0, why: f.why || '', by: f.by || '', bsid: f.bsid || '', at: f.at };
}
function bySid_(list) { const o = {}; list.forEach(x => { (o[x.sid] = o[x.sid] || []).push(x); }); return o; }

/* overtime approved ahead of time for this workweek: { sid: hours } */
function approvals_(cfg, s, wkIso) {
  const out = {};
  query_(cfg, s, 'tcOT', [ff_('week', 'EQUAL', { stringValue: wkIso })], null, null).docs.forEach(d => {
    const f = plain_(d.fields);
    if (f.sid && f.hrs > 0) out[f.sid] = Number(f.hrs);
  });
  return out;
}

/* the requests to fix someone's time that are still waiting for a manager (a few at most: read each check) */
function openReqs_(cfg, s) {
  return query_(cfg, s, 'tcReq', [ff_('st', 'EQUAL', sv_('open'))], null, null).docs.map(d => {
    const f = plain_(d.fields);
    return { id: idOf_(d), sid: String(f.sid || ''), ps: (Array.isArray(f.ps) ? f.ps : []).map(p => ({ k: p && p.k, t: Number(p && p.t) || 0 })),
      note: cap_(String(f.note || ''), 200), src: f.src === 'kiosk' || f.src === 'laptop' ? f.src : 'me', at: Number(f.at) || 0, st: 'open' };
  }).sort((a, b) => a.at - b.at);
}

/* 5 wrong PINs for someone at the time clock (it's locked 10 minutes from the first of them) */
function lockouts_(cfg, s, office, now) {
  const out = [];
  query_(cfg, s, 'tcTry', [ff_('n', 'EQUAL', { integerValue: '5' })], null, null).docs.forEach(d => {
    const f = plain_(d.fields), sid = idOf_(d);
    // the 5th try was wrong: a right PIN is marked ok within a second (and must be within 2 minutes), so a try that
    // is still not ok after 2 minutes was wrong. Up to 40 minutes back (at night this checks every half hour).
    if (f.ok !== false || !(f.t0 > 0) || !(f.at > now - 40 * TCE.MIN) || f.at > now - 2 * TCE.MIN) return;
    const n = office.names[sid] || 'Someone', until = f.t0 + 10 * TCE.MIN;
    out.push({ key: 'pin|' + sid + '|' + f.t0, type: 'pin', sid, prio: 4,
      title: n + ': 5 wrong PINs at the time clock',
      text: 'Someone typed a wrong PIN for ' + n + ' 5 times in a row at the time clock (the last at ' + TCE.timeText(f.at) + '), so ' +
        (until > now ? 'it won’t take ' + n + '’s PIN until ' + TCE.timeText(until) : n + '’s PIN was locked for 10 minutes (until ' + TCE.timeText(until) + ')') +
        '. If it wasn’t ' + n + ', someone may be trying ' + n + '’s PIN. A manager can clear the lockout sooner.' });
  });
  return out;
}

/* someone keeps typing a wrong PIN for a person, slower than the lockout (8 tries or more since their last right PIN):
   once for each 10-minute stretch it goes on */
function pinStreaks_(cfg, s, office, now) {
  const out = [];
  query_(cfg, s, 'tcTry', [ff_('bad', 'GREATER_THAN_OR_EQUAL', { integerValue: '8' })], null, null).docs.forEach(d => {
    const f = plain_(d.fields), sid = idOf_(d);
    if (f.ok !== false || !(f.at > now - 40 * TCE.MIN) || f.at > now - 2 * TCE.MIN) return; // (the last try was wrong, and recent)
    const n = office.names[sid] || 'Someone';
    out.push({ key: 'pinbad|' + sid + '|' + f.t0, type: 'pin', sid, prio: 4,
      title: n + ': ' + f.bad + ' wrong PINs since the last right one',
      text: 'Someone has typed a wrong PIN for ' + n + ' ' + f.bad + ' times at the time clock since ' + n + '’s PIN last worked (the latest at ' + TCE.timeText(f.at) + '). If it isn’t ' + n + ', someone may be trying to guess it: a manager can give ' + n + ' a new PIN (People).' });
  });
  return out;
}

/* Dr. A pressed "Send a test" (a newer one than this script last sent; not one from days ago) */
function testAlert_(A, props, now) {
  const last = Number(props.getProperty('TC_TEST') || 0);
  if (!(A.test > last) || A.test < now - TCE.DAY) return null;
  return { key: 'test|' + A.test, type: 'test', sid: '', ms: A.test, prio: 3, title: 'Test alert from NLO Time Clock',
    text: 'Dr. A asked for a test at ' + TCE.timeText(A.test) + ' on ' + TCE.dayText(TCE.dayOf(A.test)) + '. If you’re reading this, the time clock’s alerts reach you here. (Sent by the alert script in ' + mailbox_() + '.)' };
}

/* the pay period whose numbers go out now: on its payroll Friday from 7 AM, until they've gone (null otherwise) */
function payrollDue_(A, set, props, today, now) {
  const pay = set.pay ? TCE.payPeriodToEnter(today, set.pay) : null;
  if (!pay || TCE.payDayOf(pay[1]) !== today || now < TCE.atTime(today, '07:00')) return null;
  if (!(routeOf_(A.route, 'payroll') & ((A.emails.length ? 1 : 0) | (A.topic ? 2 : 0)))) return null; // (turned off)
  if (doneLoad_(props)[alertId_('payroll|' + pay[0]).slice(1, 17)]) return null; // (sent already)
  return pay;
}
/* the payroll numbers: each person's regular and overtime hours for the two weeks (overtime counted by workweek) */
function payroll_(cfg, s, office, set, P, F, asks, pay, now) {
  const a = pay[0], z = pay[1], to = TCE.dayStart(TCE.addDays(z, 1)), from = TCE.dayStart(a);
  const appr = {};
  for (let wk = TCE.weekOf(a, set.wk); wk <= z; wk = TCE.addDays(wk, 7)) appr[wk] = approvals_(cfg, s, wk);
  const lines = [], fix = [];
  const word = { 'missing-out': 'no clock-out', 'no-return': 'never back from lunch', 'no-in': 'no clock-in', 'lunch-out': 'clocked out from lunch (no Back)' };
  // everyone on the clock, and anyone else with time in the period (someone who left, or was taken off the clock)
  (office.all || office.people).forEach(p => {
    const staff = TCE.staffOf(p.staff), list = TCE.entries(P[p.sid] || [], F[p.sid] || []), current = p.staff.on === true && p.active;
    if (!current && !list.some(e => e.t >= from && e.t < to)) return;
    const pp = TCE.payPeriod(list, set, staff, a, z, now, wk => (appr[wk] && appr[wk][p.sid]) || 0), tot = pp.reg + pp.ot;
    const who = p.name + (!p.active ? ' (left)' : !current ? ' (off the clock)' : '');
    pp.issues.forEach(i => fix.push(who + ': ' + word[i.type] + ' ' + TCE.dayText(i.day)));
    if (!tot && !pp.issues.length) return; // (no time in this period)
    lines.push(staff.sal ? who + ' (salaried) — ' + TCE.hText(tot) + ', for the record'
      : who + ' — ' + TCE.hText(pp.reg) + ' regular, ' + TCE.hText(pp.ot) + ' overtime (' + TCE.hText(tot) + ' in all)' +
        (pp.ot ? ': ' + pp.weeks.filter(x => x.ot > 0).map(x => TCE.hText(x.ot) + ' the week of ' + TCE.dayText(x.wkIso)).join(', ') : ''));
  });
  const names = {}; office.people.forEach(p => { names[p.sid] = p.name; });
  (asks || []).forEach(r => { if (r.ps.some(q => q.t >= from && q.t < to)) fix.push(names[r.sid] + ' asked for a missed punch: ' + TCE.reqText(r) + ' (not approved yet)'); });
  const text = 'Pay period ' + TCE.dayText(a) + ' – ' + TCE.dayText(z) + '. The hours to enter (overtime is counted for each workweek, then added up):\n\n' +
    (lines.length ? lines.join('\n') : 'Nobody has time in this period.') +
    (fix.length ? '\n\nFix these first (on the Now screen, or in Timesheets):\n' + fix.join('\n') : '') +
    '\n\nThese are the hours as of ' + TCE.timeText(now) + (to > now ? ' (the period ends ' + TCE.dayText(z) + ')' : '') + '. The Payroll page always has the latest numbers.';
  return { key: 'payroll|' + a, type: 'payroll', sid: '', prio: 3, title: 'Payroll: ' + TCE.dayText(a) + ' – ' + TCE.dayText(z), text };
}

/* ---------- each pay period's time cards, for the records (Amir: "I definitely want to keep the data for at least 2
   years … automated so I don't have to") ----------
   The morning after a pay period ends (7 AM, and never before 8 PM on its payroll Friday, when that day's fixes are in):
   one email of its own with the period's time cards as two spreadsheets, the same as the Payroll page's "Totals" and
   "Every day" — each person's regular and overtime hours, and every day's punches, hours, flags and corrections (who made
   each, when, and why). Kept in this Gmail account, they're a copy of every pay period that nobody has to download.
   Email only, on the same setting as the payroll numbers. A period nobody has time in sends nothing. */
var KSHORT_ = { in: 'In', lunch: 'Lunch', back: 'Back', out: 'Out' };
var FLAG_ = { early: 'Early', offday: 'Closed day', home: 'Home', homeday: 'Home, other day', offnet: 'Off the office network', nonet: 'Network not checked', late: 'Still in late', long: 'Long shift' };
var ISSUE_ = { 'missing-out': 'No clock-out', 'no-return': 'Never back from lunch', 'no-in': 'No clock-in', 'lunch-out': 'Out from lunch, no Back', 'double-in': 'Clocked in twice', 'double-out': 'Clocked out twice', 'double-lunch': 'Lunch pressed twice' };
/* the pay period whose time cards go out now: the last one that's over, from its time for a week (then it's old news:
   the script was off), until they've gone — null otherwise */
function recordsDue_(A, set, props, today, now) {
  if (!set.pay || !A.emails.length || !(routeOf_(A.route, 'payroll') & 1)) return null; // (no address, or turned off)
  const cur = TCE.payPeriodOf(today, set.pay);
  if (!cur) return null;
  const rec = TCE.payPeriodOf(TCE.addDays(cur[0], -1), set.pay);
  const due = Math.max(TCE.atTime(TCE.addDays(rec[1], 1), '07:00'), TCE.atTime(TCE.payDayOf(rec[1]), '20:00'));
  if (now < due || now > due + 7 * TCE.DAY) return null;
  if (doneLoad_(props)[alertId_('records|' + rec[0]).slice(1, 17)]) return null; // (sent already, or nothing to send)
  return rec;
}
function records_(cfg, s, props, office, set, P, F, asks, rec, now) {
  const a = rec[0], z = rec[1], from = TCE.dayStart(a), to = TCE.dayStart(TCE.addDays(z, 1)), key = 'records|' + a;
  const full = office.full || {}, nameOf = sid => full[sid] || office.names[sid] || 'Someone';
  const asked = (asks || []).filter(r => r.ps.some(q => q.t >= from && q.t < to));
  // everyone on the clock, and anyone else with time in the period (someone who left, or was taken off the clock)
  const who = (office.all || office.people).map(p => ({ p, list: TCE.entries(P[p.sid] || [], F[p.sid] || []) }))
    .filter(x => (x.p.staff.on === true && x.p.active) || x.list.some(e => e.t >= from && e.t < to));
  if (!who.some(x => x.list.some(e => e.t >= from && e.t < to)) && !asked.length) {
    // nobody has any time in the period (the first one, before the time clock was in use, say): nothing to keep
    const done = doneLoad_(props), stamp = Math.floor(now / TCE.MIN);
    done[alertId_(key).slice(1, 17)] = stamp; doneSave_(props, done, stamp);
    return null;
  }
  const appr = {};
  for (let wk = TCE.weekOf(a, set.wk); wk <= z; wk = TCE.addDays(wk, 7)) appr[wk] = approvals_(cfg, s, wk);
  const rows = who.map(x => {
    const staff = TCE.staffOf(x.p.staff), pp = TCE.payPeriod(x.list, set, staff, a, z, now, wk => (appr[wk] && appr[wk][x.p.sid]) || 0);
    const issues = pp.issues.map(i => (ISSUE_[i.type] || i.type) + ' ' + TCE.dayText(i.day));
    asked.forEach(r => { if (r.sid === x.p.sid) issues.push('Asked for a missed punch (not approved yet)'); });
    return { name: nameOf(x.p.sid), sal: staff.sal, pp, issues };
  }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  const weekCols = rows.length ? rows[0].pp.weeks : [];
  const totals = [['Employee', 'Period start', 'Period end', 'Regular hours', 'Overtime hours', 'Total hours', 'Pay type', 'To check']
    .concat(flat_(weekCols.map(x => ['Week of ' + x.wkIso + ' regular', 'Week of ' + x.wkIso + ' overtime'])))]
    .concat(rows.map(r => [r.name, a, z, hNum_(r.pp.reg), hNum_(r.pp.ot), hNum_(r.pp.reg + r.pp.ot), r.sal ? 'Salaried (hours for the record)' : 'Hourly', r.issues.join('; ')]
      .concat(flat_(r.pp.weeks.map(x => [hNum_(x.reg), hNum_(x.ot)])))));
  const days = [['Employee', 'Date', 'Day', 'Punches', 'Hours', 'Flags', 'Corrections']];
  rows.forEach(r => r.pp.weeks.forEach(x => x.w.days.forEach(d => {
    if (d.iso < a || d.iso > z || (!d.entries.length && !d.ms)) return;
    const live = d.entries.filter(e => !e.void);
    const fixes = d.entries.filter(e => e.fix || e.void).map(e => {
      const f = e.void || e.fix;
      return (e.void ? 'Took out ' : 'Added ') + KSHORT_[e.kind] + ' ' + TCE.timeText(e.t) + ' (' + nameOf(f.bsid) + (f.at > 0 ? ', ' + TCE.dayText(TCE.dayOf(f.at)) : '') + ': ' + f.why + ')';
    });
    days.push([r.name, d.iso, TCE.WD[TCE.dow(d.iso)], live.map(e => KSHORT_[e.kind] + ' ' + TCE.timeText(e.t) + whereText_(e)).join('; '), hNum_(d.ms),
      d.flags.map(f => FLAG_[f.type] || f.type).concat(d.issues.map(i => ISSUE_[i.type] || i.type)).concat(d.gaps.map(g => g.min + '-min break paid')).join('; '), fixes.join('; ')]);
  })));
  const lines = rows.filter(r => r.pp.reg + r.pp.ot > 0 || r.issues.length).map(r => r.name + ' — ' + (r.sal ? TCE.hText(r.pp.reg + r.pp.ot) + ' (salaried, for the record)'
    : TCE.hText(r.pp.reg) + ' regular, ' + TCE.hText(r.pp.ot) + ' overtime') + (r.issues.length ? ' · to check: ' + r.issues.join('; ') : ''));
  const name1 = 'time-clock-' + a + '-to-' + z + '.csv', name2 = 'time-clock-days-' + a + '-to-' + z + '.csv';
  const text = 'The time cards for the pay period ' + TCE.dayText(a) + ' – ' + TCE.dayText(z) + ', as they stand ' + TCE.dayText(TCE.dayOf(now)) + ' at ' + TCE.timeText(now) + '. Attached:\n' +
    '• ' + name1 + ': each person’s regular and overtime hours (overtime is counted for each workweek)\n' +
    '• ' + name2 + ': every day: the punches, the hours, anything flagged, and each correction (who made it, when, and why)\n\n' +
    lines.join('\n') + '\n\n' +
    'Keep this email: it’s this pay period’s record. The Time Clock keeps every punch and correction too, and anything changed later shows there as a correction.';
  return { key, type: 'payroll', sid: '', prio: 2, title: 'Time cards: ' + TCE.dayText(a) + ' – ' + TCE.dayText(z) + ' (for your records)', text,
    files: [{ name: name1, text: csvOf_(totals) }, { name: name2, text: csvOf_(days) }] };
}
/* where a punch came from, as the Payroll page's spreadsheet says it */
function whereText_(e) {
  return e.src === 'home' ? ' (home)' : e.via === 'own' ? ' (own phone/computer)' : e.via === 'clock' && e.net === 'off' ? ' (off the office network)' : e.via === 'clock' && e.net === 'unk' ? ' (network not checked)' : '';
}
/* hours for a spreadsheet: "38.5" (two decimals at most) */
function hNum_(ms) { const v = TCE.h2(ms); return String(Object.is(v, -0) ? 0 : v); }
function flat_(lists) { return [].concat.apply([], lists); }
/* a spreadsheet file, as the page downloads it: every cell quoted, a leading = + - @ (or tab/CR) made plain text (so a
   spreadsheet never runs it as a formula), lines ending in CR LF, and a byte-order mark so Excel reads it as UTF-8 */
function csvCell_(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function csvOf_(rows) { return '\uFEFF' + rows.map(r => r.map(csvCell_).join(',')).join('\r\n') + '\r\n'; }

/* the daily summary: each person who clocked in this week, then anything flagged today */
function digest_(weeks, today, now, asks, names) {
  const rows = [], flags = [];
  weeks.forEach(x => {
    const w = x.w, n = x.p.name;
    if (!w.days.some(d => d.entries.some(e => !e.void))) return; // nobody to report: no punches this week
    const d = w.days.find(y => y.iso === today) || { ms: 0, flags: [], issues: [] };
    const state = w.clocked ? 'clocked in since ' + TCE.timeText(w.since) + (w.src === 'home' ? ' (from home)' : '')
      : w.state === 'lunch' && w.since ? 'at lunch since ' + TCE.timeText(w.since)
        : w.since && TCE.dayOf(w.since) === today ? 'clocked out at ' + TCE.timeText(w.since) : 'not clocked in today';
    rows.push(n + (w.sal ? ' (salaried)' : '') + ' — today ' + TCE.hText(d.ms) + ' · week ' + TCE.hText(w.total) + ' · ' + state);
    d.flags.forEach(f => {
      if (f.type === 'early') flags.push(n + ' clocked in early (' + TCE.timeText(f.e.t) + '; the earliest set is ' + TCE.hmText(f.limit) + ')' + (f.e.src === 'fix' ? ' — a correction' : ''));
      if (f.type === 'offday') flags.push(n + ' clocked in on a closed day');
      if (f.type === 'home') flags.push(n + ' clocked in from home');
      if (f.type === 'homeday') flags.push(n + ' clocked in from home on a day that isn’t one of their home days');
      if (f.type === 'offnet') flags.push(n + ' punched at the time clock while it wasn’t on the office network');
      if (f.type === 'nonet') flags.push(n + ' punched at the time clock while the office network couldn’t be checked');
      if (f.type === 'late') flags.push(n + ' is still clocked in after ' + TCE.hmText(f.limit));
      if (f.type === 'long') flags.push(n + ' worked ' + TCE.hText(f.ms) + ' (a long shift)');
    });
    d.issues.forEach(i => {
      const t = { 'missing-out': ' didn’t clock out (counts 0 until a manager adds the clock-out)', 'no-return': ' never came back from lunch',
        'no-in': i.kind === 'out' ? ' clocked out without clocking in (counts 0 until a manager adds the clock-in)' : ' went to lunch without clocking in (counts 0 until a manager adds the clock-in)',
        'double-in': ' clocked in twice', 'double-out': ' pressed clock out twice', 'double-lunch': ' pressed lunch twice' }[i.type];
      if (t) flags.push(n + t + ' (' + TCE.timeText(i.t) + ')');
    });
  });
  const waiting = (asks || []).map(r => names[r.sid] + ': ' + (TCE.reqText(r) || 'a note') + (r.note ? ' (“' + r.note + '”)' : '') + ' — asked ' + TCE.timeText(r.at) + ' ' + TCE.dayText(TCE.dayOf(r.at)));
  const text = (rows.length ? rows.join('\n') + (flags.length ? '\n\nFlagged today:\n' + flags.join('\n') : '') : 'Nobody clocked in today.') +
    (waiting.length ? '\n\nWaiting for a manager (approve on the Now screen):\n' + waiting.join('\n') : '');
  return { key: 'digest|' + today, type: 'digest', sid: '', prio: 2, title: 'Time clock summary: ' + TCE.dayText(today), text };
}

/* ---------- sending: each alert once, whichever copy of this script gets there first ----------
   Each alert has a fixed id (from its key). Before sending, the script claims it in the time clock's list of alerts sent
   (tcSent): a new entry can only be made once, so a second copy of this script finds it there and leaves it. After sending
   it marks the entry sent, with the channels that went (1 email, 2 push). A channel that didn't go is tried again on a
   later check (after 10 minutes, for up to 6 hours), and only that channel. */
function deliver_(cfg, s, props, alerts, A, now) {
  const done = doneLoad_(props), stamp = Math.floor(now / TCE.MIN);
  const can = (A.emails.length ? 1 : 0) | (A.topic ? 2 : 0);
  const errs = [], work = [], fin = {}, seen = {};
  const list = alerts.slice().sort((a, b) => (b.prio || 3) - (a.prio || 3)); // the most important first (the email's subject)
  for (const a of list) {
    const want = (a.type === 'test' ? 3 : routeOf_(A.route, a.type)) & can & (a.files ? 1 : 3); // (a test goes everywhere; files only by email)
    if (!want) continue; // not sent (Dr. A's choice), or nowhere to send it
    const id = alertId_(a.key), k = id.slice(1, 17);
    if (seen[id]) continue;
    seen[id] = 1;
    if (done[k]) { fin[a.key] = 1; continue; } // sent before (known here: no need to ask the database)
    const c = claim_(cfg, s, a, id, now);
    if (c.err) { errs.push(c.err); continue; }
    if (c.over) { done[k] = stamp; fin[a.key] = 1; continue; } // already sent (maybe by the other copy), or too old to send now
    if (!c.mine) continue; // the other copy is sending it right now
    work.push({ a, id, k, want, had: c.had, need: want & ~c.had, got: c.had });
  }
  // email: one for everything this check found — except one with files (the time cards), which goes in an email of its
  // own, easy to find later
  const mail = work.filter(w => w.need & 1), batch = mail.filter(w => !w.a.files);
  if (batch.length) {
    try { email_(cfg, A.emails, batch.map(w => w.a)); batch.forEach(w => { w.got |= 1; }); }
    catch (e) { errs.push('Email didn’t go: ' + cap_(msg_(e), 120)); }
  }
  mail.filter(w => w.a.files).forEach(w => {
    try { email_(cfg, A.emails, [w.a]); w.got |= 1; }
    catch (e) { errs.push('Email didn’t go: ' + cap_(msg_(e), 120)); }
  });
  // phone push: one per alert, or one for all when there are more than 4
  const push = work.filter(w => w.need & 2);
  if (push.length > 4) {
    try {
      push_(cfg, A.topic, push.length + ' time clock alerts', push.map(w => w.a.title).join('\n'), Math.max.apply(null, push.map(w => w.a.prio || 3)));
      push.forEach(w => { w.got |= 2; });
    } catch (e) { errs.push('Phone push didn’t go: ' + cap_(msg_(e), 120)); }
  } else {
    let bad = '';
    push.forEach(w => { try { push_(cfg, A.topic, w.a.title, w.a.text, w.a.prio); w.got |= 2; } catch (e) { bad = msg_(e); } });
    if (bad) errs.push('Phone push didn’t go: ' + cap_(bad, 120));
  }
  let sent = 0;
  const titles = [];
  work.forEach(w => {
    if (w.got !== w.had) { sent++; titles.push(w.a.title); }
    if ((w.got & w.want) === w.want) { done[w.k] = stamp; fin[w.a.key] = 1; }
  });
  doneSave_(props, done, stamp); // first: even if noting them below fails, this copy won't send them again
  let unnoted = 0;
  work.forEach(w => { if (!mark_(cfg, s, w.id, (w.got & w.want) === w.want ? 'sent' : 'fail', w.got)) unnoted++; });
  if (unnoted) errs.push('Couldn’t note ' + unnoted + ' alert' + (unnoted === 1 ? '' : 's') + ' as sent');
  return { sent, errs, fin, titles };
}

/* claim an alert: { mine, had } to send it (had: channels already sent), { over } when it's done, {} to leave it, { err } */
function claim_(cfg, s, a, id, now) {
  const name = docName_(cfg, 'tcSent/' + id), text = cap_(a.title + '\n' + a.text, 600);
  const r = commit_(cfg, s, [{
    update: { name, fields: { k: sv_(cap_(a.key, 160)), type: sv_(cap_(a.type, 20)), sid: sv_(cap_(a.sid || '', 40)), text: sv_(text), st: sv_('claim'), ch: iv_(0) } },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'up', setToServerValue: 'REQUEST_TIME' }]
  }]);
  if (r.code === 200) return { mine: true, had: 0 };
  // it's there already (sent before, or the other copy of this script claimed it): look at it
  const g = fs_(cfg, s, 'get', cfg.fsBase + '/' + name, null);
  if (g.code === 404) return { err: 'The time clock refused an alert (' + why_(r) + ')' };
  if (g.code !== 200 || !g.json || !g.json.fields) return { err: 'Couldn’t check an alert (' + why_(g) + ')' };
  const f = plain_(g.json.fields);
  if (f.st === 'sent') return { over: true };
  if (!(f.at > now - 6 * TCE.HOUR)) return { over: true }; // never went, and it's old news now
  if (!(f.up < now - 10 * TCE.MIN)) return {}; // being sent right now (or it just failed: try again in a while)
  // claimed over 10 minutes ago and never finished, or it failed: take it over — unless someone else just did
  // (the save only goes through if the entry is still exactly as read)
  const u = commit_(cfg, s, [{
    update: { name, fields: { st: sv_('claim'), text: sv_(text) } }, updateMask: { fieldPaths: ['st', 'text'] },
    currentDocument: { updateTime: g.json.updateTime },
    updateTransforms: [{ fieldPath: 'up', setToServerValue: 'REQUEST_TIME' }]
  }]);
  if (u.code === 200) return { mine: true, had: (Number(f.ch) || 0) & 3 };
  return {};
}
function mark_(cfg, s, id, st, ch) {
  const r = commit_(cfg, s, [{
    update: { name: docName_(cfg, 'tcSent/' + id), fields: { st: sv_(st), ch: iv_(ch) } }, updateMask: { fieldPaths: ['st', 'ch'] },
    currentDocument: { exists: true },
    updateTransforms: [{ fieldPath: 'up', setToServerValue: 'REQUEST_TIME' }]
  }]);
  return r.code === 200;
}

/* one email, from this Gmail account, with every alert of this check (and any files they carry, attached) */
function email_(cfg, emails, list) {
  const subject = list[0].title + (list.length > 1 ? ' (+' + (list.length - 1) + ' more)' : '');
  const body = list.map(a => a.title + '\n' + a.text + '\n').join('\n') +
    '\n—\nNLO Time Clock: ' + cfg.appUrl + '\nChange these alerts: Time Clock → Alerts\n';
  let left = null;
  try { left = MailApp.getRemainingDailyQuota(); } catch (e) { }
  if (left != null && left < emails.length) throw new Error('this Gmail account’s daily email limit is used up (it resets within a day)');
  const msg = { to: emails.join(','), subject: cap_(subject, 250), body: cap_(body, 20000), name: 'NLO Time Clock' };
  const files = flat_(list.map(a => (a.files || []).map(f => Utilities.newBlob(f.text, 'text/csv', f.name))));
  if (files.length) msg.attachments = files;
  MailApp.sendEmail(msg);
}
/* a phone push through ntfy (the free app: subscribe to the topic shown in Time Clock → Alerts) */
function push_(cfg, topic, title, message, prio) {
  const body = { topic, title: cap_(title, 200), message: cap_(message, 3500), priority: Math.max(1, Math.min(5, Math.round(prio) || 3)), tags: ['alarm_clock'], click: cfg.appUrl };
  let r;
  try { r = UrlFetchApp.fetch(cfg.ntfyBase + '/', { method: 'post', contentType: 'application/json', payload: ascii_(JSON.stringify(body)), muteHttpExceptions: true }); }
  catch (e) { throw new Error('couldn’t reach ntfy (' + cap_(msg_(e), 80) + ')'); }
  const code = r.getResponseCode();
  if (code !== 200) throw new Error('ntfy answered ' + code + (code === 429 ? ' (too many messages just now)' : ''));
}

/* when this script last checked, which Gmail account it's in, and any problem (Time Clock → Alerts shows it) */
function beat_(cfg, s, sent, err) {
  const r = commit_(cfg, s, [{
    update: { name: docName_(cfg, 'tcBeat/' + s.uid), fields: { box: sv_(cap_(mailbox_(), 120)), ver: sv_(VERSION), err: sv_(cap_(err || '', 300)), sent: iv_(sent || 0) } },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }]
  }]);
  if (r.code !== 200) throw new Error('Couldn’t check in with the time clock (' + why_(r) + ').');
}

/* ---------- NLO Time Clock's database (Firebase) ---------- */
function cfg_(props) {
  const c = JSON.parse(props.getProperty('TC_CFG') || 'null') || CONFIG;
  if (!c || !c.apiKey || !c.projectId || !c.botEmail || !c.botPassword) throw new Error('Not set up yet: pick “setup” next to Run and press Run.');
  c.authBase = c.authBase || 'https://identitytoolkit.googleapis.com/v1';
  c.fsBase = c.fsBase || 'https://firestore.googleapis.com/v1';
  c.appUrl = c.appUrl || APP_URL;
  c.ntfyBase = String(c.ntfyBase || 'https://ntfy.sh').replace(/\/+$/, '');
  return c;
}
function http_(cfg, method, url, body, tok) {
  const opt = { method, muteHttpExceptions: true, headers: { Referer: cfg.referer || cfg.appUrl } };
  if (tok) opt.headers.Authorization = 'Bearer ' + tok;
  if (body != null) { opt.contentType = 'application/json'; opt.payload = ascii_(JSON.stringify(body)); }
  const r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), text = r.getContentText();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { }
  return { code, json, text };
}
/* sign in with the script's own login (made by Dr. A); kept for 45 minutes (it lasts an hour) */
function session_(cfg, fresh) {
  if (!fresh) {
    const c = cacheGet_('login');
    if (c && c.tok && c.uid) return { tok: c.tok, uid: c.uid, fresh: false };
  }
  const a = http_(cfg, 'post', cfg.authBase + '/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey), { email: cfg.botEmail, password: cfg.botPassword, returnSecureToken: true });
  if (a.code !== 200 || !a.json || !a.json.idToken || !a.json.localId) {
    throw new Error('Couldn’t sign in to NLO Time Clock (' + why_(a) + '). If the script’s login was turned off or changed, copy the script again: Time Clock → Alerts → Get the script, paste it over this one, and run setup again.');
  }
  const s = { tok: a.json.idToken, uid: a.json.localId, fresh: true };
  cachePut_('login', { tok: s.tok, uid: s.uid }, 45 * 60);
  return s;
}
/* a database call; if the saved login was refused, sign in again once and retry */
function fs_(cfg, s, method, url, body) {
  let r = http_(cfg, method, url, body, s.tok);
  if ((r.code === 401 || r.code === 403) && !s.fresh) {
    const s2 = session_(cfg, true);
    s.tok = s2.tok; s.uid = s2.uid; s.fresh = true;
    r = http_(cfg, method, url, body, s.tok);
  }
  return r;
}
function commit_(cfg, s, writes) { return fs_(cfg, s, 'post', root_(cfg) + ':commit', { writes }); }
function root_(cfg) { return cfg.fsBase + '/projects/' + cfg.projectId + '/databases/(default)/documents'; }
function docName_(cfg, path) { return 'projects/' + cfg.projectId + '/databases/(default)/documents/' + path; }
/* one document, or null when there isn't one */
function getDoc_(cfg, s, path, what) {
  const r = fs_(cfg, s, 'get', root_(cfg) + '/' + path, null);
  if (r.code === 404) return null;
  if (r.code !== 200 || !r.json) throw new Error(readErr_(what, r));
  return r.json;
}
/* a query: { docs, readTime } (readTime: the database's own clock when it read them) */
function query_(cfg, s, coll, filters, order, select) {
  const q = { from: [{ collectionId: coll }] };
  if (filters.length === 1) q.where = filters[0];
  else if (filters.length > 1) q.where = { compositeFilter: { op: 'AND', filters } };
  if (order) q.orderBy = [{ field: { fieldPath: order }, direction: 'ASCENDING' }];
  if (select) q.select = { fields: select.map(f => ({ fieldPath: f })) };
  const r = fs_(cfg, s, 'post', root_(cfg) + ':runQuery', { structuredQuery: q });
  if (r.code !== 200 || !Array.isArray(r.json)) throw new Error(readErr_(coll, r));
  let readTime = 0;
  r.json.forEach(x => { if (x && x.readTime) readTime = Math.max(readTime, tsMs_(x.readTime)); });
  return { docs: r.json.filter(x => x && x.document).map(x => x.document), readTime: readTime || Date.now() };
}
function readErr_(what, r) {
  return 'Couldn’t read the time clock (' + what + ': ' + why_(r) + ').' +
    (r.code === 403 ? ' If Dr. A turned off this script’s login, copy the script again: Time Clock → Alerts → Get the script.' : '');
}
function why_(r) { return r.code + ((r.json && r.json.error && (' ' + (r.json.error.status || r.json.error.message || ''))) || ''); }

/* Firestore's typed values ⇄ plain values (timestamps become milliseconds) */
function val_(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return String(v.stringValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue === true;
  if ('timestampValue' in v) return tsMs_(v.timestampValue);
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(val_);
  if ('mapValue' in v) return plain_((v.mapValue && v.mapValue.fields) || {});
  return null; // null, and nothing else the time clock stores
}
function plain_(fields) { const o = {}; Object.keys(fields || {}).forEach(k => { o[k] = val_(fields[k]); }); return o; }
function sv_(s) { return { stringValue: String(s) }; }
function iv_(n) { return { integerValue: String(Math.round(Number(n) || 0)) }; }
function tsv_(ms) { return { timestampValue: new Date(ms).toISOString() }; }
function ff_(field, op, value) { return { fieldFilter: { field: { fieldPath: field }, op, value } }; }
function idOf_(d) { return String(d.name || '').split('/').pop(); }
/* "2026-10-15T17:40:12.123456Z" → milliseconds (the database gives microseconds) */
function tsMs_(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(String(s || ''));
  if (!m) { const t = Date.parse(s); return isNaN(t) ? 0 : t; }
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +(m[7] + '00').slice(0, 3) : 0);
  if (m[8] !== 'Z') t -= (m[8][0] === '-' ? -1 : 1) * (+m[8].slice(1, 3) * 60 + +m[8].slice(4, 6)) * TCE.MIN;
  return t;
}

/* ---------- this script's own memory ----------
   Saved copies (CacheService, a few hours at most, may vanish any time — then it just reads again): the login, the
   people, the punches. Kept in pieces small enough for the cache, each piece tagged so a mix of two saves is never used. */
function ck_(name) {
  if (GEN_ == null) GEN_ = PropertiesService.getScriptProperties().getProperty('TC_GEN') || '0';
  return 'tc' + GEN_ + '_' + name;
}
function cachePut_(name, obj, secs) {
  const cache = CacheService.getScriptCache(), key = ck_(name), text = JSON.stringify(obj), size = 25000;
  const tag = String(Utilities.getUuid()).replace(/[^0-9a-f]/gi, '').slice(0, 8), n = Math.max(1, Math.ceil(text.length / size)), parts = {};
  for (let i = 0; i < n; i++) parts[key + '#' + i] = tag + text.slice(i * size, (i + 1) * size);
  parts[key] = tag + n;
  try { cache.putAll(parts, secs); } catch (e) { try { cache.remove(key); } catch (x) { } } // too big to keep: read again next time
}
function cacheGet_(name) {
  const cache = CacheService.getScriptCache(), key = ck_(name), head = cache.get(key);
  if (!head || head.length < 9) return null;
  const tag = head.slice(0, 8), n = Number(head.slice(8)), keys = [];
  if (!(n >= 1 && n <= 200)) return null;
  for (let i = 0; i < n; i++) keys.push(key + '#' + i);
  const got = cache.getAll(keys) || {};
  let text = '';
  for (let i = 0; i < n; i++) {
    const v = got[keys[i]];
    if (typeof v !== 'string' || v.slice(0, 8) !== tag) return null;
    text += v.slice(8);
  }
  try { return JSON.parse(text); } catch (e) { return null; }
}
/* The alerts this copy has finished (script properties: { first 16 hex of the id: minute it finished }), the last 10 days.
   Only a shortcut — the database's list of alerts sent is what makes each alert go once. */
function doneLoad_(props) {
  try { const d = JSON.parse(props.getProperty('TC_DONE') || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
}
function doneSave_(props, done, stamp) {
  const cut = stamp - 10 * 24 * 60;
  const keep = Object.keys(done).filter(k => done[k] > cut).sort((a, b) => done[b] - done[a]).slice(0, 300); // (a property holds 9 KB)
  const o = {};
  keep.forEach(k => { o[k] = done[k]; });
  props.setProperty('TC_DONE', JSON.stringify(o));
}

/* ---------- helpers ---------- */
/* the office's clock (Eastern), from Google's own date formatting: the arithmetic needs no browser-only tools */
function tz_() {
  const memo = {};
  TCE.setTZ(ms => {
    const m = Math.floor(ms / 60000);
    if (memo[m]) return memo[m];
    const p = Utilities.formatDate(new Date(m * 60000), TCE.OFFICE_TZ, 'yyyy-MM-dd-HH-mm').split('-');
    return (memo[m] = { y: +p[0], mo: +p[1], d: +p[2], h: +p[3] % 24, mi: +p[4] });
  });
}
function alertId_(key) { return 'a' + sha256hex_(key).slice(0, 32); }
function sha256hex_(s) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  let h = '';
  for (let i = 0; i < d.length; i++) h += ((d[i] & 255) + 256).toString(16).slice(1);
  return h;
}
/* JSON with every non-ASCII character written as \uXXXX: the same bytes whatever encoding the request goes out in */
function ascii_(json) { return json.replace(/[\u007f-\uffff]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4)); }
function mailbox_() { try { return Session.getEffectiveUser().getEmail() || 'this account'; } catch (e) { return 'this account'; } }
/* at most n characters (as the database counts them: UTF-16 units), never cutting an emoji in half */
function cap_(s, n) { s = String(s == null ? '' : s); if (s.length <= n) return s; let k = n; const c = s.charCodeAt(k - 1); if (c >= 0xD800 && c <= 0xDBFF) k--; return s.slice(0, k); }
function msg_(e) { return String((e && e.message) || e); }
function stopTriggers_() { ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); }); }
/* after 3 failed checks in a row: one email a day to this Gmail account, saying what to do */
function warn_(props, e) {
  const last = Number(props.getProperty('TC_WARNED') || 0);
  if (Date.now() - last < TCE.DAY) return;
  props.setProperty('TC_WARNED', String(Date.now()));
  try {
    MailApp.sendEmail(mailbox_(), 'NLO Time Clock: alerts need a look',
      'The NLO Time Clock alert script in this Gmail account has failed 3 times in a row, so overtime heads-ups and the other time clock alerts are not going out.\n\n' +
      'Error: ' + cap_(msg_(e), 300) + '\n\n' +
      'To fix it: Time Clock → Alerts → Get the script, paste it over this one, and run setup again.\n' +
      'To turn it off instead: open script.google.com, open this project, pick "stop" and press Run.', { name: 'NLO Time Clock' });
  } catch (x) { }
}
