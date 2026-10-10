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

/* ---------- the time clock's arithmetic (the same file the page runs: src/engine.js) ---------- */
/* =====================================================================
   NLO Time Clock — the arithmetic. No screen, no database: punches and
   corrections in, the time worked out (by day and by workweek), lunch
   breaks, overtime and the heads-ups before it, and the boundaries (too
   early, a closed day, from home on a day not allowed, still clocked in
   late, a long shift, a missing clock-out, the time clock off the office
   network). The pages and the alert
   script both run this same file, so they always agree.

   Times are milliseconds. Days are 'YYYY-MM-DD' at the office (Eastern
   time, whatever clock the device or Google's server is on). Overtime is
   by workweek (federal rule: over 40 hours in the workweek), never by
   pay period or by day.
   ===================================================================== */
const TCE = (() => {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const KINDS = ['in', 'lunch', 'back', 'out'];
  const KIND_ORDER = { out: 0, lunch: 1, back: 2, in: 3 }; // same millisecond: an end before a start
  const OFFICE_TZ = 'America/New_York';
  const DEFAULTS = { wk: 0, ot: 40, thr: [36, 38], early: '07:30', late: '18:30', shift: 10, brk: 20, days: [1, 2, 3, 4], pay: '', lock: false, wurl: '' };
  const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // where each kind of alert goes when Dr. A hasn't picked (the page shows these, the script sends by them):
  // 1 = email, 2 = phone push, 3 = both, 0 = not sent
  const ROUTE = { thr: 3, ot: 3, otx: 3, cap: 3, early: 3, offday: 3, homeday: 3, home: 2, net: 3, late: 3, long: 3, miss: 3, noret: 3, req: 3, short: 0, pin: 3, digest: 1, payroll: 1, test: 3 };
  // the alerts Dr. A can send where he likes (Time Clock → Alerts), in the order they're listed: [type, name, when]
  const ALERTS = [
    ['thr', 'Getting close to overtime', 'At each heads-up hour, with when they’d reach overtime if they stay clocked in'],
    ['ot', 'Overtime started', 'Passed the overtime hours in the workweek without overtime approved ahead of time'],
    ['otx', 'Past the overtime approved', 'Passed the hours approved ahead of time for that week'],
    ['cap', 'Weekly cap reached', 'Reached the weekly cap set for that person'],
    ['early', 'Clocked in too early', 'Before the earliest clock-in time'],
    ['offday', 'Clocked in on a closed day', 'A punch on a day the office is closed'],
    ['home', 'Clocked in from home', 'The first clock-in from home each day (on an approved laptop)'],
    ['homeday', 'From home on another day', 'From home on a day that isn’t one of their home days'],
    ['net', 'Time clock off the office network', 'A punch at the time-clock computer while it wasn’t on the office network (moved, or the office’s internet changed), or while it couldn’t check: each once a day for each person'],
    ['late', 'Still clocked in late', 'Still clocked in after the late time (forgot to clock out?)'],
    ['long', 'Long shift', 'A day reaches the long-shift hours'],
    ['miss', 'Missing punch', 'A clock-in left open on an earlier day, or a clock-out (or lunch) with no clock-in before it'],
    ['noret', 'Never back from lunch', 'Clocked out for lunch and never back in or out'],
    ['req', 'Asked for a time fix', 'Someone asks a manager to add a punch they missed, or leaves a note (at the time clock or on My time)'],
    ['short', 'Short break (paid)', 'A break shorter than the paid-break minutes'],
    ['pin', 'Wrong PINs', '5 wrong PINs in a row for someone at the time clock, or 8 since their PIN last worked'],
    ['digest', 'Daily summary', 'Everyone’s hours and today’s flags, at the time set under Email'],
    ['payroll', 'Payroll numbers', 'Payroll Friday at 7 AM: each person’s regular and overtime hours for the two weeks, and anything to fix first']
  ];

  /* ---------- the office's clock ---------- */
  // tzParts(ms) → { y, mo, d, h, mi } at the office. The page uses the browser's Intl; the alert script passes Google's
  // Utilities.formatDate (setTZ), so both read the same wall clock.
  let tzParts = null;
  function intlParts() {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: OFFICE_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return ms => { const o = {}; f.formatToParts(new Date(ms)).forEach(x => { o[x.type] = x.value; }); return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute }; };
  }
  function setTZ(fn) { tzParts = fn; }
  function parts(ms) { if (!tzParts) tzParts = intlParts(); return tzParts(ms); }
  const pad = n => String(n).padStart(2, '0');
  function dayOf(ms) { const p = parts(ms); return p.y + '-' + pad(p.mo) + '-' + pad(p.d); }
  function minuteOf(ms) { const p = parts(ms); return p.h * 60 + p.mi; }
  function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s; }
  function ymd(iso) { return iso.split('-').map(Number); }
  function addDays(iso, n) { const [y, m, d] = ymd(iso), t = new Date(Date.UTC(y, m - 1, d + n)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  function dow(iso) { const [y, m, d] = ymd(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function daysBetween(a, b) { const [y1, m1, d1] = ymd(a), [y2, m2, d2] = ymd(b); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY); }
  // midnight at the office on a day (an hour earlier in UTC in summer)
  function dayStart(iso) {
    const [y, m, d] = ymd(iso), t = Date.UTC(y, m - 1, d, 5), p = parts(t); // 05:00 UTC is midnight EST / 1 AM EDT
    return t - (p.h * 60 + p.mi) * MIN;
  }
  // a wall-clock time on a day ('07:30' on '2026-10-12'), right on the days the clocks change too
  function atTime(iso, hm) {
    const [h, mi] = String(hm).split(':').map(Number), want = h * 60 + mi;
    let t = dayStart(iso) + want * MIN;
    const got = dayOf(t) === iso ? minuteOf(t) : (dayOf(t) > iso ? minuteOf(t) + 1440 : minuteOf(t) - 1440);
    return t + (want - got) * MIN;
  }
  const okHM = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  function hmText(hm) { if (!okHM(hm)) return ''; let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + pad(m) + ' ' + ap; }
  function timeText(ms) { const p = parts(ms); return hmText(pad(p.h) + ':' + pad(p.mi)); }
  function dayText(iso, long) { const [y, m, d] = ymd(iso); const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]; return (long ? WD[dow(iso)] : WD3[dow(iso)]) + ', ' + mon + ' ' + d; }
  // the first day of the workweek that holds a day (wk: 0 = the workweek starts Sunday … 6 = Saturday)
  function weekOf(iso, wk) { return addDays(iso, -((dow(iso) - wk + 7) % 7)); }
  function weekRange(wkIso) { return [dayStart(wkIso), dayStart(addDays(wkIso, 7))]; }
  // hours, for people: 38, 38.5, 7.25 (to the hundredth)
  function h2(ms) { return Math.round(ms / HOUR * 100) / 100; }
  function hText(ms) { const v = h2(ms); return String(Object.is(v, -0) ? 0 : v) + ' h'; } // (no Intl: the alert script runs this too)
  // hours and minutes, for a clock: "7 h 05 min", "45 min"
  function hmDur(ms) { const t = Math.max(0, Math.round(ms / MIN)), h = Math.floor(t / 60), m = t % 60; return h ? h + ' h ' + pad(m) + ' min' : m + ' min'; }

  /* ---------- settings (whatever is stored, made sensible) ---------- */
  function settingsOf(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, s = Object.assign({}, DEFAULTS);
    if (Number.isInteger(r.wk) && r.wk >= 0 && r.wk <= 6) s.wk = r.wk;
    if (typeof r.ot === 'number' && r.ot >= 20 && r.ot <= 80) s.ot = r.ot;
    if (Array.isArray(r.thr)) s.thr = r.thr.filter(x => typeof x === 'number' && x > 0 && x < s.ot).slice(0, 5).sort((a, b) => a - b);
    for (const k of ['early', 'late']) if (r[k] === '' || okHM(r[k])) s[k] = r[k];
    if (typeof r.shift === 'number' && r.shift >= 0 && r.shift <= 24) s.shift = r.shift;
    if (Number.isInteger(r.brk) && r.brk >= 0 && r.brk <= 60) s.brk = r.brk;
    if (Array.isArray(r.days)) s.days = Array.from(new Set(r.days.filter(x => Number.isInteger(x) && x >= 0 && x <= 6))).sort();
    if (r.pay === '' || isISO(r.pay)) s.pay = r.pay;
    // the office lock: on or off, and where the office check (the Cloudflare Worker) runs
    s.lock = r.lock === true;
    s.wurl = typeof r.wurl === 'string' && /^https:\/\/[a-z0-9-]{1,63}\.[a-z0-9-]{1,63}\.workers\.dev$/.test(r.wurl) ? r.wurl : '';
    return s;
  }
  function staffOf(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      on: r.on === true, home: r.home === true,
      hdays: Array.isArray(r.hdays) ? r.hdays.filter(x => Number.isInteger(x) && x >= 0 && x <= 6) : [],
      early: okHM(r.early) ? r.early : '', cap: typeof r.cap === 'number' && r.cap > 0 && r.cap <= 80 ? r.cap : 0,
      // salaried and exempt from overtime: the hours are kept for the record only (Dr. A, 9 Oct 2026: "I still want her
      // hours to be recorded for the record") — no overtime, and no alerts about hours or boundaries
      sal: r.sal === true,
      pin: !!r.pinAt
    };
  }

  /* ---------- punches + corrections → what counts ---------- */
  // where a punch came from (src as saved): 'kiosk' the time-clock computer, 'own' their own phone or computer at the
  // office, 'laptop' an approved laptop, 'home' (older punches) signed in from home. net: 'office' | 'off' | 'unk' | ''.
  // From home: a laptop away from the office network (or an older home punch).
  function homeP(p) { return p.src === 'home' || (p.src === 'laptop' && p.net !== 'office'); }
  const VIA = { kiosk: 'clock', own: 'own', laptop: 'laptop', home: 'own' };
  // punches: [{ id, sid, kind, at, src, net, by }]; fixes: [{ id, sid, op: 'add'|'void', ref, kind, t, why, by, at }]
  // → every entry in time order (voided ones too, marked, so a timesheet can show them struck through). An entry's src is
  // 'home' or 'kiosk' (anywhere else) for punches, 'fix' for corrections; via says which device: 'clock' (the time-clock
  // computer), 'own' (their own phone or computer), 'laptop'; dev: which time clock or laptop.
  function entries(punches, fixes) {
    const voids = new Map();
    for (const f of fixes || []) if (f && f.op === 'void' && f.ref) { if (!voids.has(f.ref)) voids.set(f.ref, f); }
    const out = [];
    for (const p of punches || []) {
      if (!p || !KINDS.includes(p.kind) || !(p.at > 0)) continue;
      out.push({ id: p.id, sid: p.sid, kind: p.kind, t: p.at, src: homeP(p) ? 'home' : 'kiosk', via: VIA[p.src] || 'clock', net: ['office', 'off', 'unk'].includes(p.net) ? p.net : '', dev: p.by || '', fix: null, void: voids.get(p.id) || null });
    }
    for (const f of fixes || []) {
      if (!f || f.op !== 'add' || !KINDS.includes(f.kind) || !(f.t > 0)) continue;
      out.push({ id: f.id, sid: f.sid, kind: f.kind, t: f.t, src: 'fix', fix: f, void: voids.get(f.id) || null });
    }
    return sortEntries(out);
  }
  function sortEntries(out) { return out.sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); }

  /* ---------- asking a manager to fix their time ----------
     A request: { id, sid, ps: [{ k: kind, t: ms }] (the punches they missed, at most 2; none = just a note), note, src
     ('kiosk' | 'laptop' | 'me'), at, st: 'open' | 'ok' (a manager approved it: the punches are corrections now) | 'no' | 'x' (taken back) }.
     While it waits, its punches show on the person's own screens and decide the time clock's next button (someone who
     forgot to clock in can still go to lunch), but they count no hours until a manager approves them. */
  const KWORD = { in: 'Clock in', lunch: 'Out to lunch', back: 'Back from lunch', out: 'Clock out' };
  function reqPunches(r) { return ((r && r.ps) || []).filter(p => p && KINDS.includes(p.k) && p.t > 0).slice(0, 2).sort((a, b) => a.t - b.t || KIND_ORDER[a.k] - KIND_ORDER[b.k]); }
  // a person's entries with their waiting requests' punches added in (marked src 'req')
  function withReqs(list, reqs) {
    const out = (list || []).slice();
    for (const r of reqs || []) {
      if (!r || r.st !== 'open') continue;
      reqPunches(r).forEach((p, i) => out.push({ id: r.id + '~' + i, sid: r.sid, kind: p.k, t: p.t, src: 'req', req: r, fix: null, void: null }));
    }
    return sortEntries(out);
  }
  // "Clock in 7:55 AM, Thu, Oct 8" · "Out to lunch 12:00 PM and back from lunch 12:30 PM, Thu, Oct 8" ('' for a note)
  function reqText(r) {
    const ps = reqPunches(r);
    if (!ps.length) return '';
    const days = Array.from(new Set(ps.map(p => dayOf(p.t))));
    return ps.map((p, i) => (i ? KWORD[p.k].toLowerCase() : KWORD[p.k]) + ' ' + timeText(p.t) + (days.length > 1 ? ' (' + dayText(dayOf(p.t)) + ')' : '')).join(' and ') +
      (days.length === 1 ? ', ' + dayText(days[0]) : '');
  }
  // the alert for a new request (the script sends each once)
  function reqAlert(r, name) {
    const n = name || 'Someone', what = reqText(r), where = r.src === 'kiosk' ? 'at the time clock' : r.src === 'laptop' ? 'on an approved laptop' : 'on My time';
    const asked = timeText(r.at) + ' on ' + dayText(dayOf(r.at)), note = r.note ? '“' + r.note + '”.' : '';
    if (!what) return { key: 'req|' + r.id, type: 'req', sid: r.sid, prio: 3, title: n + ' left a note for the managers', text: n + ' wrote ' + where + ' (' + asked + '): ' + note + ' Mark it done on the Now screen.' };
    return { key: 'req|' + r.id, type: 'req', sid: r.sid, prio: 3, title: n + ' asked for a missed punch',
      text: n + ' asked ' + where + ' (' + asked + ') for a punch they missed: ' + what + '.' + (note ? ' Note: ' + note : '') + ' It counts once a manager approves it on the Now screen.' };
  }

  /* One person's entries (in time order) → work segments, the state now, and anything that doesn't add up.
     A segment starts at a clock-in (or back from lunch) and ends at lunch or a clock-out. A clock-in left open on an
     earlier day is a missing clock-out: it counts 0 hours until a manager adds the clock-out. A clock-out (or lunch)
     with no clock-in before it is a missing clock-in ('no-in'), unless it's the same button pressed again within 15
     minutes ('double-out', 'double-lunch': nothing to fix). A clock-out more than an hour after going to lunch, with no
     Back in between, is 'lunch-out': they may have come back and forgotten to punch (the afternoon counts 0 until a
     manager adds the Back). */
  function timeline(list, now) {
    const live = (list || []).filter(e => !e.void);
    const segs = [], issues = [], today = dayOf(now);
    let state = 'out', cur = null, since = null, lunchE = null;
    const issue = (type, e, extra) => issues.push(Object.assign({ type, id: e.id, t: e.t, day: dayOf(e.t), kind: e.kind }, extra || {}));
    for (let i = 0; i < live.length; i++) {
      const e = live[i], d = dayOf(e.t), prev = i ? live[i - 1] : null;
      if (e.kind === 'in' || e.kind === 'back') {
        if (state === 'in') {
          if (dayOf(cur.t) !== d) { segs.push({ a: cur.t, b: null, aE: cur, bE: null, missing: true, day: dayOf(cur.t) }); issue('missing-out', cur); }
          else { issue('double-in', e); continue; }
        } else if (state === 'lunch' && lunchE && dayOf(lunchE.t) !== d) issue('no-return', lunchE);
        cur = e; state = 'in'; since = e.t; lunchE = null;
      } else { // lunch | out
        if (state === 'in') {
          segs.push({ a: cur.t, b: e.t, aE: cur, bE: e, day: dayOf(cur.t) });
          state = e.kind === 'lunch' ? 'lunch' : 'out'; since = e.t; lunchE = e.kind === 'lunch' ? e : null; cur = null;
        } else if (state === 'lunch' && e.kind === 'out') {
          if (lunchE && e.t - lunchE.t > HOUR) issue('lunch-out', e, { lunchT: lunchE.t });
          state = 'out'; since = e.t; lunchE = null;
        }
        else if (prev && prev.kind === e.kind && e.t - prev.t < 15 * MIN) issue(e.kind === 'out' ? 'double-out' : 'double-lunch', e);
        else issue('no-in', e);
      }
    }
    if (state === 'in') {
      // (a clock-in a manager added a little ahead of now is open too: it starts counting when its time comes)
      if (dayOf(cur.t) === today || cur.t > now) segs.push({ a: cur.t, b: null, aE: cur, bE: null, open: true, day: dayOf(cur.t) });
      else { segs.push({ a: cur.t, b: null, aE: cur, bE: null, missing: true, day: dayOf(cur.t) }); issue('missing-out', cur); state = 'out'; since = null; }
    }
    if (state === 'lunch' && lunchE && dayOf(lunchE.t) !== today) { issue('no-return', lunchE); state = 'out'; since = null; }
    return { segs, issues, state, since, src: state === 'in' && cur ? cur.src : '' };
  }

  // short breaks are paid: a gap shorter than brk minutes between two segments of the same day counts as worked
  function shortGaps(segs, brkMin) {
    const gaps = [];
    if (!(brkMin > 0)) return gaps;
    const closed = segs.filter(s => !s.missing);
    for (let i = 1; i < closed.length; i++) {
      const p = closed[i - 1], n = closed[i];
      if (p.b == null || p.day !== n.day) continue;
      const g = n.a - p.b;
      if (g > 0 && g < brkMin * MIN) gaps.push({ a: p.b, b: n.a, day: n.day, min: Math.round(g / MIN), aE: p.bE, bE: n.aE });
    }
    return gaps;
  }
  const overlap = (a, b, from, to) => Math.max(0, Math.min(b, to) - Math.max(a, from));
  // time worked inside [from, to): segments (an open one up to now) plus the short breaks
  function worked(tl, gaps, from, to, now) {
    let ms = 0;
    for (const s of tl.segs) {
      if (s.missing) continue;
      const end = s.b != null ? s.b : Math.max(s.a, now);
      ms += overlap(s.a, end, from, to);
    }
    for (const g of gaps) ms += overlap(g.a, g.b, from, to);
    return ms;
  }

  /* ---------- one person's workweek ----------
     o = { sid, list (entries for this person), set (settingsOf), staff (staffOf), wkIso, now, approved (hours or null) } */
  function week(o) {
    const set = o.set, st = o.staff || staffOf({}), now = o.now;
    const [from, to] = weekRange(o.wkIso), tl = timeline(o.list, now), gaps = shortGaps(tl.segs, set.brk);
    const total = worked(tl, gaps, from, to, now);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(o.wkIso, i), a = dayStart(iso), b = dayStart(addDays(iso, 1));
      const ents = (o.list || []).filter(e => e.t >= a && e.t < b);
      const dms = worked(tl, gaps, a, b, now), flags = dayFlags(iso, ents, dms, tl, now, set, st);
      days.push({ iso, ms: dms, entries: ents, segs: tl.segs.filter(s => s.day === iso), gaps: gaps.filter(g => g.day === iso),
        issues: tl.issues.filter(x => x.day === iso), flags });
    }
    const sal = !!st.sal, limit = set.ot * HOUR, appr = !sal && o.approved > 0 ? o.approved * HOUR : 0, cap = !sal && st.cap > 0 ? st.cap * HOUR : 0;
    const clocked = tl.state === 'in' && tl.segs.some(s => s.open);
    // when they'd reach it if they stay clocked in — only when that's still today (not "2 AM tomorrow")
    const eta = goal => (!sal && clocked && total < goal && now + (goal - total) < to && dayOf(now + (goal - total)) === dayOf(now)) ? now + (goal - total) : null;
    return {
      sid: o.sid, wkIso: o.wkIso, from, to, total, days, state: tl.state, since: tl.since, src: tl.src, clocked, sal,
      limit, approved: appr, cap, reg: sal ? total : Math.min(total, limit), ot: sal ? 0 : Math.max(0, total - limit),
      eta: { ot: eta(limit), approved: appr ? eta(appr) : null, cap: cap ? eta(cap) : null },
      issues: tl.issues.filter(x => x.t >= from - 7 * DAY && x.t < to), gaps, segs: tl.segs
    };
  }
  // what a day's punches crossed: too early, a closed day, from home (on a day not allowed), the time clock off the office
  // network (or it couldn't be checked), still in late, long
  function dayFlags(iso, ents, dms, tl, now, set, st) {
    const f = [], live = ents.filter(e => !e.void);
    const firstIn = live.find(e => e.kind === 'in' || e.kind === 'back');
    const early = st.early || set.early;
    if (firstIn && early && firstIn.t < atTime(iso, early)) f.push({ type: 'early', e: firstIn, limit: early });
    if (live.length && !set.days.includes(dow(iso))) f.push({ type: 'offday', e: live[0] });
    const home = live.filter(e => e.src === 'home');
    if (home.length) {
      f.push({ type: 'home', e: home[0] });
      if (st.hdays.length && !st.hdays.includes(dow(iso))) f.push({ type: 'homeday', e: home[0] });
    }
    const off = live.filter(e => e.via === 'clock' && e.net === 'off'), unk = live.filter(e => e.via === 'clock' && e.net === 'unk');
    if (off.length) f.push({ type: 'offnet', e: off[0], n: off.length });
    if (unk.length) f.push({ type: 'nonet', e: unk[0], n: unk.length });
    if (set.late && dayOf(now) === iso && tl.state === 'in' && tl.segs.some(s => s.open) && now >= atTime(iso, set.late)) f.push({ type: 'late', limit: set.late });
    if (set.shift > 0 && dms >= set.shift * HOUR) f.push({ type: 'long', ms: dms });
    return f;
  }

  /* ---------- alerts: what to tell the managers about one person's week (the script sends each once) ----------
     w = week(); ctx = { name, set, now, staff } → [{ key, type, sid, title, text, prio }] */
  function alertsFor(w, ctx) {
    const out = [], n = ctx.name || 'Someone', set = ctx.set, now = ctx.now, sid = w.sid, wk = w.wkIso;
    const add = (key, type, title, text, prio) => out.push({ key: key, type, sid, title, text, prio: prio || 3 });
    add.list = out;
    const tot = hText(w.total), lim = set.ot;
    const where = w.clocked ? 'Clocked in since ' + timeText(w.since) + (w.src === 'home' ? ' (home)' : '') + '.' : 'Not clocked in right now.';
    const reach = (goal, at) => at ? ' Reaches ' + goal + ' h at ' + timeText(at) + (dayOf(at) === dayOf(now) ? ' today' : ' ' + dayText(dayOf(at))) + ' if still clocked in.' : '';
    const approvedAll = w.approved >= w.limit;
    // someone salaried: only what leaves the record incomplete (a missing punch) — nothing about their hours
    if (w.sal) return missingAlerts(w, ctx, add, n);
    // the highest heads-up passed so far (one alert each time a new one is passed; none once overtime has started — that
    // alert says it, and a check that comes late doesn't send 36 and 38 at once)
    const passed = approvedAll || w.total >= w.limit ? [] : set.thr.filter(t => t < lim && w.total >= t * HOUR);
    if (passed.length) {
      const t = Math.max.apply(null, passed);
      add('thr|' + sid + '|' + wk + '|' + t, 'thr', n + ': ' + t + ' h this week', n + ' has ' + tot + ' this workweek (overtime after ' + lim + ' h). ' + where + reach(lim, w.eta.ot), 3);
    }
    if (w.total >= w.limit && !(w.approved > w.limit && w.total <= w.approved)) {
      add('ot|' + sid + '|' + wk, 'ot', 'Overtime: ' + n + ' is at ' + tot, n + ' passed ' + lim + ' h this workweek' + (w.approved ? ' (' + h2(w.approved) + ' h approved)' : ' without overtime approved ahead of time') + '. ' + where, 4);
    }
    // each clock-in (or back from lunch) once overtime has started without approval (or past what was approved): a manager
    // hears at once (Amir: only approved overtime lets them go over; the punch itself is never refused)
    const ceiling = w.approved > w.limit ? w.approved : w.limit;
    if (w.total >= ceiling) {
      for (const d of w.days) for (const e of d.entries) {
        if (e.void || e.src === 'fix' || e.src === 'req' || (e.kind !== 'in' && e.kind !== 'back')) continue;
        const before = worked({ segs: w.segs }, w.gaps, w.from, e.t, now);
        if (before >= ceiling) add('otin|' + e.id, 'ot', n + (e.kind === 'back' ? ' came back from lunch' : ' clocked in') + ' while in overtime ' + (w.approved > w.limit ? '(past the ' + h2(w.approved) + ' h approved)' : '(not approved)'),
          n + (e.kind === 'back' ? ' came back from lunch' : ' clocked in') + ' at ' + timeText(e.t) + ' on ' + dayText(d.iso) + (e.src === 'home' ? ' from home' : '') + ' with ' + hText(before) + ' already this workweek' +
          (w.approved > w.limit ? '; overtime was approved up to ' + h2(w.approved) + ' h.' : '; overtime starts at ' + lim + ' h and isn’t approved for this week.') + ' ' + where, 4);
      }
    }
    if (w.approved > w.limit && w.total > w.approved) add('otx|' + sid + '|' + wk, 'otx', n + ' passed the ' + h2(w.approved) + ' h approved', n + ' is at ' + tot + ' this workweek; overtime was approved up to ' + h2(w.approved) + ' h. ' + where, 4);
    if (w.cap && w.cap < w.limit && w.total >= w.cap) add('cap|' + sid + '|' + wk, 'cap', n + ' reached ' + h2(w.cap) + ' h (weekly cap)', n + ' is at ' + tot + ' this workweek; the cap set for ' + n + ' is ' + h2(w.cap) + ' h. ' + where, 3);
    for (const d of w.days) {
      for (const f of d.flags) {
        const e = f.e, punch = e && e.src !== 'fix'; // corrections a manager made don't alert (they made them)
        if (f.type === 'early' && punch) add('early|' + e.id, 'early', n + ' clocked in early: ' + timeText(e.t), n + ' clocked in at ' + timeText(e.t) + ' on ' + dayText(d.iso) + (e.src === 'home' ? ' from home' : '') + '. The earliest set is ' + hmText(f.limit) + '. Flagged on the timesheet.', 3);
        if (f.type === 'offday' && punch) add('off|' + sid + '|' + d.iso, 'offday', n + ' clocked in on a closed day', n + ' clocked ' + (e.kind === 'in' || e.kind === 'back' ? 'in' : e.kind === 'lunch' ? 'out for lunch' : 'out') + ' at ' + timeText(e.t) + ' on ' + dayText(d.iso, true) + (e.src === 'home' ? ' from home' : '') + ', which isn’t an office day. Flagged on the timesheet.', 3);
        if (f.type === 'home' && punch && (e.kind === 'in' || e.kind === 'back')) add('home|' + sid + '|' + d.iso, 'home', n + ' clocked in from home', n + ' clocked in from home at ' + timeText(e.t) + ' on ' + dayText(d.iso) + '.', 2);
        if (f.type === 'homeday' && punch) add('homeday|' + sid + '|' + d.iso, 'homeday', n + ' clocked in from home on ' + WD[dow(d.iso)], n + ' clocked in from home at ' + timeText(e.t) + ' on ' + dayText(d.iso, true) + ', which isn’t one of the home days set for ' + n + '. Flagged on the timesheet.', 3);
        // the time clock off the office network, or it couldn't be checked: each once a day for each person (a day that
        // starts with "couldn't check" still says so when the clock really is off it later)
        if ((f.type === 'offnet' || f.type === 'nonet') && punch) add((f.type === 'offnet' ? 'net|' : 'netx|') + sid + '|' + d.iso, 'net', f.type === 'offnet' ? 'The time clock is off the office network' : 'The time clock couldn’t check the office network',
          n + ' ' + punchWord(e.kind) + ' at ' + timeText(e.t) + ' on ' + dayText(d.iso, true) + ' at the time-clock computer while ' + (f.type === 'offnet' ? 'it wasn’t on the office network' : 'the office network couldn’t be checked (no answer from the office check)') +
          '. The punch is saved and flagged. If the office’s internet changed, save the new network: Time Clock → Settings → Office network. If the computer was moved, that’s where its punches come from now.', 3);
        if (f.type === 'late') add('late|' + sid + '|' + d.iso, 'late', n + ' is still clocked in at ' + hmText(f.limit), n + ' has been clocked in since ' + timeText(w.since) + ' (' + hText(d.ms) + ' today). Forgot to clock out? A manager can add the clock-out in Timesheets.', 4);
        if (f.type === 'long') add('long|' + sid + '|' + d.iso, 'long', n + ' has worked ' + h2(f.ms) + ' h today', n + ' is at ' + hText(f.ms) + ' on ' + dayText(d.iso) + ' (long-shift alert at ' + set.shift + ' h). ' + where, 3);
      }
      for (const g of d.gaps) add('short|' + sid + '|' + d.iso + '|' + g.a, 'short', n + '’s break was ' + g.min + ' min (paid)', n + ' clocked out at ' + timeText(g.a) + ' and back in at ' + timeText(g.b) + ' on ' + dayText(d.iso) + '. Breaks under ' + set.brk + ' minutes count as paid time.', 2);
    }
    return missingAlerts(w, ctx, add, n);
  }
  function punchWord(k) { return k === 'in' ? 'clocked in' : k === 'lunch' ? 'went to lunch' : k === 'back' ? 'came back from lunch' : 'clocked out'; }
  // a missing punch (unless the person has asked a manager for it: their request is the alert)
  function missingAlerts(w, ctx, add, n) {
    const sid = w.sid;
    const asked = (kinds, day) => (ctx.asks || []).some(r => r.sid === sid && r.st === 'open' && reqPunches(r).some(p => kinds.includes(p.k) && dayOf(p.t) === day));
    for (const x of w.issues) {
      if (x.type === 'missing-out' && asked(['out'], x.day)) continue;
      if (x.type === 'no-return' && asked(['back', 'out'], x.day)) continue;
      if (x.type === 'no-in' && asked(['in', 'back'], x.day)) continue;
      if (x.type === 'lunch-out' && asked(['back'], x.day)) continue;
      if (x.type === 'lunch-out') add('lout|' + x.id, 'miss', n + ' clocked out from lunch', n + ' clocked out at ' + timeText(x.t) + ' on ' + dayText(x.day, true) + ', ' + hText(x.t - x.lunchT) + ' after going to lunch at ' + timeText(x.lunchT) + ', without coming back from lunch. If ' + n + ' worked the afternoon, a manager can add Back from lunch in Timesheets (until then it counts 0 hours).', 3);
      if (x.type === 'no-in') add('noin|' + x.id, 'miss', n + (x.kind === 'out' ? ' clocked out' : ' went to lunch') + ' without clocking in', n + (x.kind === 'out' ? ' clocked out at ' : ' clocked out for lunch at ') + timeText(x.t) + ' on ' + dayText(x.day, true) + ' with no clock-in before it. Until a manager adds the clock-in, that time counts 0 hours.', 3);
      if (x.type === 'missing-out') add('miss|' + x.id, 'miss', n + ' didn’t clock out ' + dayText(x.day), n + (x.kind === 'back' ? ' came back from lunch at ' : ' clocked in at ') + timeText(x.t) + ' on ' + dayText(x.day, true) + ' and never clocked out. Until a manager adds the clock-out, ' + (x.kind === 'back' ? 'the time after lunch' : 'that shift') + ' counts 0 hours.', 4);
      if (x.type === 'no-return') add('noret|' + x.id, 'noret', n + ' never came back from lunch ' + dayText(x.day), n + ' clocked out for lunch at ' + timeText(x.t) + ' on ' + dayText(x.day, true) + ' and never clocked back in or out. If ' + n + ' worked after lunch, a manager can add it in Timesheets.', 3);
    }
    return add.list;
  }

  /* ---------- payroll: each workweek's regular and overtime hours for a pay period ----------
     A pay period should start on the workweek's first day so each week falls inside one period (Settings checks it). */
  function payWeeks(list, set, staff, fromIso, toIso, now, approvals) {
    const out = [];
    for (let wk = weekOf(fromIso, set.wk); wk <= toIso; wk = addDays(wk, 7)) {
      const w = week({ list, set, staff, wkIso: wk, now, approved: approvals ? approvals(wk) : 0 });
      const partial = wk < fromIso || addDays(wk, 6) > toIso;
      out.push({ wkIso: wk, total: w.total, reg: w.reg, ot: w.ot, partial, issues: w.issues.filter(x => x.t >= w.from && x.t < w.to), w });
    }
    return out;
  }
  function payPeriodOf(iso, anchor) { if (!isISO(anchor)) return null; const k = Math.floor(daysBetween(anchor, iso) / 14); const a = addDays(anchor, k * 14); return [a, addDays(a, 13)]; }
  /* one person's pay period [a, z]: each workweek's regular and overtime hours, and the two-week totals. A workweek that
     sticks out of the period counts its days inside it; its overtime goes with the period it ends in. */
  function payPeriod(list, set, staff, a, z, now, approvals) {
    const from = dayStart(a), to = dayStart(addDays(z, 1)), tl = timeline(list, now), gaps = shortGaps(tl.segs, set.brk);
    const weeks = payWeeks(list, set, staff, a, z, now, approvals).map(x => {
      if (!x.partial) return x;
      // a workweek split by the period: its hours in time order, the first 40 of the week regular and the rest overtime,
      // each paid in the period it was worked (so the two periods together pay the week exactly once)
      const lo = Math.max(from, x.w.from), hi = Math.min(to, x.w.to), limit = set.ot * HOUR;
      const before = worked(tl, gaps, x.w.from, lo, now), inside = worked(tl, gaps, lo, hi, now);
      const reg = x.w.sal ? inside : Math.max(0, Math.min(limit, before + inside) - Math.min(limit, before));
      return Object.assign({}, x, { reg, ot: inside - reg });
    });
    const issues = [];
    weeks.forEach(x => x.issues.forEach(i => { if (i.t >= from && i.t < to && ['missing-out', 'no-return', 'no-in', 'lunch-out'].includes(i.type)) issues.push(i); }));
    return { weeks, reg: weeks.reduce((n, x) => n + x.reg, 0), ot: weeks.reduce((n, x) => n + x.ot, 0), issues };
  }
  /* the Friday payroll is entered for a period that ends on z (Amir: "every other Friday"): the period's own last Friday
     when it ends Friday to Sunday (the office is closed then), otherwise the first Friday after it ends */
  function payDayOf(z) { const d = dow(z); return d === 5 ? z : d === 6 ? addDays(z, -1) : d === 0 ? addDays(z, -2) : addDays(z, 5 - d); }
  /* the pay period to enter on a day: the one whose payroll Friday hasn't passed yet (the one just ended, until its Friday) */
  function payPeriodToEnter(iso, anchor) {
    const cur = payPeriodOf(iso, anchor); if (!cur) return null;
    const prev = payPeriodOf(addDays(cur[0], -1), anchor);
    return payDayOf(prev[1]) >= iso ? prev : cur;
  }

  return {
    MIN, HOUR, DAY, KINDS, KWORD, OFFICE_TZ, DEFAULTS, WD, WD3, ROUTE, ALERTS,
    setTZ, parts, dayOf, minuteOf, isISO, addDays, dow, daysBetween, dayStart, atTime, okHM, hmText, timeText, dayText,
    weekOf, weekRange, h2, hText, hmDur, settingsOf, staffOf, homeP, entries, sortEntries, reqPunches, withReqs, reqText, reqAlert,
    timeline, shortGaps, worked, week, alertsFor, payWeeks, payPeriodOf, payPeriod, payDayOf, payPeriodToEnter
  };
})();

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
