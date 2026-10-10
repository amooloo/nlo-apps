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
