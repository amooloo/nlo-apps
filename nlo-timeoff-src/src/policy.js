/* =====================================================================
   The time-off policy, worked out in one place (handbook §41 and Dr. A's
   settings). Pure functions — no screen, no database — so the request
   form, the approvals, each person's balance and statement, payroll and
   the year-end list all use the same arithmetic.

   How a balance is worked out (ledger):
   - It starts from the person's opening balance on a day (asOf).
   - Each office day of approved paid time off takes its hours from the
     vacation or sick balance, as much as there is; any hours more than
     the balance are unpaid.
   - On the last day of each month a full-time person past orientation
     earns vacation (by tier: years of service) and sick leave.
   - On January 1 what was left on December 31 is paid out (or lost, if
     Dr. A sets it so) and both balances start again at 0.
   - Dr. A's adjustments land on their day.
   Office days are Monday–Thursday; handbook holidays and the office's
   own closures are skipped.
   ===================================================================== */

/* ---------- kinds of time off ---------- */
/* b: which balance paid time off comes out of — vac, sick, or none (paid, but from no balance); plan: planned leave
   (the notice and blackout rules apply to it) */
const TYPES = [
  { k: 'vac', l: 'Vacation', b: 'vac', plan: true },
  { k: 'sick', l: 'Sick leave', b: 'sick' },
  { k: 'personal', l: 'Personal day', b: 'none', plan: true },
  { k: 'medical', l: 'Medical appointment', b: 'vac' },
  { k: 'family', l: 'Family emergency', b: 'vac' },
  { k: 'bereave', l: 'Bereavement', b: 'none' },
  { k: 'other', l: 'Other', b: 'vac', plan: true }
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.k, t]));
function typeLabel(k) { return (TYPE[k] && TYPE[k].l) || 'Time off'; }

/* how much of each day */
const PARTS = [
  { k: 'full', l: 'Full day', s: 'Full' }, { k: 'am', l: 'Morning (AM)', s: 'AM' }, { k: 'pm', l: 'Afternoon (PM)', s: 'PM' },
  { k: 'h2', l: '2 hours', s: '2 h', h: 2 }, { k: 'h4', l: '4 hours', s: '4 h', h: 4 }, { k: 'h6', l: '6 hours', s: '6 h', h: 6 }
];
const PART = Object.fromEntries(PARTS.concat([{ k: 'half', l: 'Half day', s: 'Half' }]).map(p => [p.k, p]));
function partLabel(k) { return (PART[k] && PART[k].l) || 'Full day'; }
function partShort(k) { return (PART[k] && PART[k].s) || 'Full'; }

/* ---------- the policy (Dr. A can change these in Settings) ---------- */
const POLICY = {
  day: 8.5,                       // hours in an office day
  tiers: [                        // vacation by full years of service (handbook §41): 1, 2 and 3 work weeks a year —
    { from: 0, perMonth: 2.83, cap: 34 },   // Bronze
    { from: 2, perMonth: 5.67, cap: 68 },   // Silver
    { from: 5, perMonth: 8.5, cap: 102 },   // Gold
    { from: 10, perMonth: 8.5, cap: 102 },  // Platinum (10 years) and Double Platinum (15): recognition, earning as Gold
    { from: 15, perMonth: 8.5, cap: 102 }
  ],
  sickPerMonth: 2.83,             // sick leave, everyone past orientation (4 days a year)
  orientDays: 90,                 // nothing is earned during orientation (when no end date is set: 90 days from the hire date)
  ptAccrues: false,               // part-time staff earn no paid vacation or sick leave (handbook §41)
  yearEnd: { vac: 'payout', sick: 'payout' }, // what's left on Dec 31: 'payout' (paid by Dec 31) or 'lose'; both start the year at 0
  bereaveDays: 3,                 // bereavement: up to 3 days (paid for full-time staff)
  noticeDays: 2,                  // more than this many office days in a row …
  noticeMonths: 3,                // … needs this much notice (a warning, not a block)
  route: { vac: 'vac', sick: 'sick', personal: 'none', medical: 'vac', family: 'vac', bereave: 'none', other: 'vac' }
};
/* the tiers' names (Dr. A, 9 Oct 2026) */
const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Double Platinum'];
function tierName(n) { return TIER_NAMES[n - 1] || 'Tier ' + n; }
/* the policy with Dr. A's settings over the defaults (anything odd in the settings falls back to the default).
   A change applies from a day (settings.to.policyFrom); the versions before it are kept (settings.to.policyOld:
   [{ until, policy }]) so the days before a change are still worked out as they were → p.prev, and polOn(p, day). */
function policyOf(settings) {
  const to = (settings && settings.to) || {}, p = normPolicy(to.policy);
  p.from = isISO(to.policyFrom) ? to.policyFrom : '';
  p.prev = (Array.isArray(to.policyOld) ? to.policyOld : []).filter(x => x && isISO(x.until) && (!p.from || x.until < p.from))
    .map(x => ({ until: x.until, p: normPolicy(x.policy) })).sort((a, b) => a.until < b.until ? -1 : 1);
  return p;
}
/* the version of the policy in force on a day */
function polOn(pol, iso) { if (pol && pol.prev && iso) for (const x of pol.prev) if (iso <= x.until) return x.p; return pol; }
function normPolicy(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}, p = JSON.parse(JSON.stringify(POLICY));
  const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
  if (num(s.day, 1, 24)) p.day = s.day;
  if (Array.isArray(s.tiers) && s.tiers.length >= 1 && s.tiers.length <= 6 && s.tiers.every((t, i) => t && num(t.from, 0, 60) && num(t.perMonth, 0, 100) && num(t.cap, 0, 2000) && (i === 0 ? t.from === 0 : t.from > s.tiers[i - 1].from)))
    p.tiers = s.tiers.map(t => ({ from: t.from, perMonth: t.perMonth, cap: t.cap }));
  if (num(s.sickPerMonth, 0, 100)) p.sickPerMonth = s.sickPerMonth;
  if (num(s.orientDays, 0, 366)) p.orientDays = s.orientDays;
  if (typeof s.ptAccrues === 'boolean') p.ptAccrues = s.ptAccrues;
  if (s.yearEnd && typeof s.yearEnd === 'object') ['vac', 'sick'].forEach(b => { if (['payout', 'lose'].includes(s.yearEnd[b])) p.yearEnd[b] = s.yearEnd[b]; });
  if (num(s.bereaveDays, 0, 30)) p.bereaveDays = s.bereaveDays;
  if (num(s.noticeDays, 0, 30)) p.noticeDays = s.noticeDays;
  if (num(s.noticeMonths, 0, 12)) p.noticeMonths = s.noticeMonths;
  if (s.route && typeof s.route === 'object') TYPES.forEach(t => { if (['vac', 'sick', 'none'].includes(s.route[t.k])) p.route[t.k] = s.route[t.k]; });
  return p;
}
function partHours(part, pol) {
  if (part === 'am' || part === 'pm' || part === 'half') return round2(pol.day / 2);
  const p = PART[part]; if (p && p.h) return Math.min(p.h, pol.day);
  return pol.day;
}
/* which balance a request's hours come from: vac, sick, none (paid, from no balance) or unpaid */
function bucketOf(r, pol) { if (!r.paid) return 'unpaid'; const P = polOn(pol, r.start); return P.route[r.type] || (TYPE[r.type] ? TYPE[r.type].b : 'vac'); }

/* ---------- office days and closures ---------- */
function thanksgiving(y) { const d = new Date(y, 10, 1); d.setDate(1 + (4 - d.getDay() + 7) % 7 + 21); return isoOf(d); }
/* the handbook's paid holidays (the office is closed) */
function fixedHolidays(y) {
  const nth = (m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + (n - 1) * 7); return isoOf(d); };
  const last = (m, wd) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - (d.getDay() - wd + 7) % 7); return isoOf(d); };
  const thx = thanksgiving(y);
  return [
    { date: y + '-01-01', label: 'New Year’s Day' }, { date: last(4, 1), label: 'Memorial Day' }, { date: y + '-07-04', label: 'Independence Day' },
    { date: nth(8, 1, 1), label: 'Labor Day' }, { date: addDays(thx, -1), label: 'Day before Thanksgiving' }, { date: thx, label: 'Thanksgiving' },
    { date: addDays(thx, 1), label: 'Day after Thanksgiving' }, { date: y + '-12-25', label: 'Christmas Day' }
  ];
}
/* closed(iso) → the reason the office is closed that day ('' when it's open as usual); custom = Dr. A's own closures */
function makeClosed(custom) {
  const cm = new Map((custom || []).filter(c => c && isISO(c.date)).map(c => [c.date, String(c.label || 'Office closed')])), cache = {};
  const fn = iso => {
    if (cm.has(iso)) return cm.get(iso);
    const y = Number(iso.slice(0, 4)); if (!cache[y]) cache[y] = new Map(fixedHolidays(y).map(h => [h.date, h.label]));
    return cache[y].get(iso) || '';
  };
  fn.custom = cm; return fn;
}
function isOfficeDay(iso, closed) { const wd = weekday(iso); return wd >= 1 && wd <= 4 && !closed(iso); }
/* the first office day on or after iso */
function nextOfficeDay(iso, closed) { let d = iso; for (let i = 0; i < 60; i++) { if (isOfficeDay(d, closed)) return d; d = addDays(d, 1); } return iso; }
/* the office days a request covers, with the hours of each */
function reqDays(r, closed, pol) {
  const out = []; if (!r || !isISO(r.start) || !isISO(r.end) || r.end < r.start) return out;
  for (let d = r.start, g = 0; d <= r.end && g < 400; d = addDays(d, 1), g++) if (isOfficeDay(d, closed)) out.push({ date: d, h: partHours(r.part, polOn(pol, d)) });
  return out;
}
function reqHours(r, closed, pol) { return round2(reqDays(r, closed, pol).reduce((s, d) => s + d.h, 0)); }

/* ---------- service, tiers, orientation ---------- */
function yearsOfService(hire, iso) {
  if (!isISO(hire) || !isISO(iso) || iso < hire) return 0;
  const [y1, m1, d1] = hire.split('-').map(Number), [y2, m2, d2] = iso.split('-').map(Number);
  let y = y2 - y1; if (m2 < m1 || (m2 === m1 && d2 < d1)) y--; return Math.max(0, y);
}
function tierAt(pol, hire, iso) {
  const yrs = yearsOfService(hire, iso); let i = 0;
  pol.tiers.forEach((t, k) => { if (yrs >= t.from) i = k; });
  return Object.assign({ n: i + 1, years: yrs }, pol.tiers[i]);
}
/* the anniversary that moves someone up a tier, if there is one to come */
function nextTierDate(pol, hire, iso) {
  if (!isISO(hire)) return null;
  const cur = tierAt(pol, hire, iso), next = pol.tiers[cur.n]; if (!next) return null;
  const [y, m, d] = hire.split('-').map(Number), dt = new Date(y + next.from, m - 1, d);
  if (dt.getMonth() !== m - 1) dt.setDate(0); // Feb 29 hire → Feb 28
  return { n: cur.n + 1, date: isoOf(dt), perMonth: next.perMonth, cap: next.cap };
}
function orientEnd(p, pol) { return isISO(p.orient) ? p.orient : isISO(p.hire) ? addDays(p.hire, pol.orientDays) : ''; }
/* does this person earn time off at the month-end d? */
function accruesOn(p, pol, d) {
  if (!isISO(p.hire) || p.hire > d) return false;
  if (isISO(p.left) && d > p.left) return false;
  if (p.type === 'PT' && !pol.ptAccrues) return false;
  const oe = orientEnd(p, pol); return !oe || oe <= d;
}
/* the next month-end accrual from day iso on (what it'll be), or null when nothing more is earned */
function nextAccrual(p, pol, iso) {
  let d = lastOfMonth(iso);
  for (let i = 0; i < 18; i++) { const P = polOn(pol, d); if (accruesOn(p, P, d)) { const t = tierAt(P, p.hire, d); return { date: d, vac: t.perMonth, sick: P.sickPerMonth, tier: t.n }; } d = lastOfMonth(addDays(d, 1)); }
  return null;
}

/* =====================================================================
   The ledger: one person's balances, day by day, from their opening
   balance through day `to`.
   person: { hire, orient, type: 'FT'|'PT', left, open: { asOf, vac, sick }, adj: [{ id, date, b, h, note }] }
   reqs:   [{ id, status, type, paid, start, end, part }]
   person.settled: ids of requests the old Time-Off app already took off (part of an opening balance carried over from it) —
   kept in the HR record Dr. A writes, never in a request (whoever asks could write that)
   → { vac, sick, asOf, entries, byReq, payouts }
     entries: { date, k: open|take|free|unpaid|adjust|accrue|yearend, … , vac, sick (balances after) }
     byReq[id]: { days, hours, vac, sick, free, unpaid, future } (future: hours after `to`, not worked out yet)
   ===================================================================== */
function ledger(person, reqs, pol, closed, to) {
  const p = person || {}, open = p.open && isISO(p.open.asOf) ? p.open : { asOf: isISO(p.hire) ? addDays(p.hire, -1) : addDays(to, -1), vac: 0, sick: 0 };
  const settled = new Set(Array.isArray(p.settled) ? p.settled : []);
  const bal = { vac: round2(Math.max(0, Number(open.vac) || 0)), sick: round2(Math.max(0, Number(open.sick) || 0)) };
  const E = [{ date: open.asOf, k: 'open', vac: bal.vac, sick: bal.sick, note: open.note || '' }], byReq = {}, payouts = [];
  const onDay = new Map(), push = (d, x) => { const a = onDay.get(d); if (a) a.push(x); else onDay.set(d, [x]); };
  for (const r of reqs || []) {
    if (!r || !r.id) continue;
    const st = byReq[r.id] = { days: 0, hours: 0, vac: 0, sick: 0, free: 0, unpaid: 0, future: 0, before: 0 };
    if (r.status !== 'approved') continue;
    const b = bucketOf(r, pol);
    for (const d of reqDays(r, closed, pol)) {
      st.days++; st.hours = round2(st.hours + d.h);
      if (settled.has(r.id) || d.date <= open.asOf) { st.before = round2(st.before + d.h); continue; } // already in the opening balance
      if (d.date > to) { st.future = round2(st.future + d.h); continue; }
      push(d.date, { id: r.id, b, h: d.h, type: r.type });
    }
  }
  for (const a of p.adj || []) if (a && isISO(a.date) && a.date > open.asOf && a.date <= to && (a.b === 'vac' || a.b === 'sick') && isFinite(a.h)) push(a.date, { adj: a });
  const after = () => ({ vac: bal.vac, sick: bal.sick });
  for (let d = addDays(open.asOf, 1), g = 0; d <= to && g < 25000; d = addDays(d, 1), g++) {
    if (d.slice(5) === '01-01') { // what was left on Dec 31
      const y = Number(d.slice(0, 4)) - 1, po = { year: y, vac: 0, sick: 0, lostVac: 0, lostSick: 0 };
      const YP = polOn(pol, addDays(d, -1));
      ['vac', 'sick'].forEach(b => { const left = bal[b]; if (YP.yearEnd[b] === 'payout') po[b] = left; else po[b === 'vac' ? 'lostVac' : 'lostSick'] = left; bal[b] = 0; });
      if (po.vac || po.sick || po.lostVac || po.lostSick) { payouts.push(po); E.push(Object.assign({ date: d, k: 'yearend', year: y, pay: { vac: po.vac, sick: po.sick }, lost: { vac: po.lostVac, sick: po.lostSick } }, after())); }
    }
    for (const x of onDay.get(d) || []) {
      if (x.adj) {
        const a = x.adj, want = round2(a.h), got = round2(Math.max(-bal[a.b], want)); bal[a.b] = round2(bal[a.b] + got);
        E.push(Object.assign({ date: d, k: 'adjust', b: a.b, h: got, want, note: a.note || '', id: a.id || '' }, after())); continue;
      }
      const st = byReq[x.id];
      if (x.b === 'vac' || x.b === 'sick') {
        const t = round2(Math.max(0, Math.min(x.h, bal[x.b]))), short = round2(x.h - t);
        bal[x.b] = round2(bal[x.b] - t); st[x.b] = round2(st[x.b] + t); st.unpaid = round2(st.unpaid + short);
        E.push(Object.assign({ date: d, k: 'take', b: x.b, h: x.h, paid: t, unpaid: short, id: x.id, type: x.type }, after()));
      } else if (x.b === 'none') { st.free = round2(st.free + x.h); E.push(Object.assign({ date: d, k: 'free', h: x.h, id: x.id, type: x.type }, after())); }
      else { st.unpaid = round2(st.unpaid + x.h); E.push(Object.assign({ date: d, k: 'unpaid', h: x.h, id: x.id, type: x.type }, after())); }
    }
    const P = polOn(pol, d);
    if (isLastOfMonth(d) && accruesOn(p, P, d)) {
      const t = tierAt(P, p.hire, d), add = round2(Math.max(0, Math.min(t.perMonth, t.cap - bal.vac)));
      bal.vac = round2(bal.vac + add); bal.sick = round2(bal.sick + P.sickPerMonth);
      E.push(Object.assign({ date: d, k: 'accrue', vac: bal.vac, sick: bal.sick, addVac: add, addSick: P.sickPerMonth, tier: t.n, capped: add < t.perMonth }));
    }
  }
  return { vac: bal.vac, sick: bal.sick, asOf: to, open, entries: E, byReq, payouts };
}
/* the same, through today */
function balanceNow(person, reqs, pol, closed, today) { return ledger(person, reqs, pol, closed, today || todayISO()); }

/* what a request would come to if it were approved (others as they are): hours from each balance, unpaid, and the
   balances right after it */
function preview(person, reqs, r, pol, closed, today) {
  const t = today || todayISO(), mine = Object.assign({}, r, { id: r.id || '__new', status: 'approved' });
  const all = (reqs || []).filter(x => x.id !== mine.id).concat([mine]);
  const end = isISO(mine.end) && mine.end > t ? mine.end : t;
  const L = ledger(person, all, pol, closed, end), st = L.byReq[mine.id] || { days: 0, hours: 0, vac: 0, sick: 0, free: 0, unpaid: 0, before: 0 };
  return Object.assign({ bucket: bucketOf(mine, pol), after: { vac: L.vac, sick: L.sick }, end }, st);
}

/* ---------- warnings and blocks on a request ---------- */
/* the handbook asks for 3 months' notice for more than 2 days in a row of planned time off */
function noticeShort(r, pol, closed, today) {
  const t = TYPE[r.type]; if (!t || !t.plan || !pol.noticeMonths) return null;
  const n = reqDays(r, closed, pol).length; if (n <= pol.noticeDays) return null;
  const need = addMonths(today || todayISO(), pol.noticeMonths); if (r.start >= need) return null;
  return { days: n, months: pol.noticeMonths, by: need };
}
/* blackout periods (Dr. A's list): every January, Thanksgiving week, or set dates; each for some kinds of time off */
const BLACKOUTS = [
  { id: 'jan', label: 'January', kind: 'month', month: 1, types: ['vac', 'personal', 'other'] },
  { id: 'thx', label: 'Thanksgiving week', kind: 'thanksgiving', types: ['vac', 'personal', 'other'] }
];
function blackoutsOf(settings) {
  const b = settings && settings.to && Array.isArray(settings.to.blackouts) ? settings.to.blackouts : BLACKOUTS;
  return b.filter(x => x && typeof x.id === 'string' && ['month', 'thanksgiving', 'dates'].includes(x.kind) && Array.isArray(x.types));
}
function blackoutRange(b, y) {
  if (b.kind === 'month') { const m = String(Math.min(12, Math.max(1, Number(b.month) || 1))).padStart(2, '0'); return [y + '-' + m + '-01', lastOfMonth(y + '-' + m + '-01')]; }
  if (b.kind === 'thanksgiving') { const t = thanksgiving(y); return [addDays(t, -3), addDays(t, 3)]; }
  if (b.kind === 'dates' && isISO(b.from) && isISO(b.to)) return [b.from, b.to];
  return null;
}
/* the blackouts a request runs into: [{ b, from, to }] */
function blackoutHits(r, list) {
  const out = []; if (!isISO(r.start) || !isISO(r.end)) return out;
  for (const b of list || []) {
    if (!b.types.includes(r.type)) continue;
    const years = b.kind === 'dates' ? [0] : Array.from(new Set([Number(r.start.slice(0, 4)), Number(r.end.slice(0, 4))]));
    for (const y of years) { const rg = blackoutRange(b, y); if (rg && r.start <= rg[1] && r.end >= rg[0]) out.push({ b, from: rg[0], to: rg[1] }); }
  }
  return out;
}
function blackoutText(b) {
  if (b.kind === 'month') return 'every ' + new Date(2000, (Number(b.month) || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  if (b.kind === 'thanksgiving') return 'Thanksgiving week, Monday to Sunday, every year';
  return fmtDate(b.from) + (b.to !== b.from ? ' – ' + fmtDate(b.to) : '');
}
/* the office days two requests share */
function sharedDays(a, b, closed, pol) {
  if (!isISO(a.start) || !isISO(b.start) || a.end < b.start || b.end < a.start) return [];
  const lo = a.start > b.start ? a.start : b.start, hi = a.end < b.end ? a.end : b.end, out = [];
  for (let d = lo, g = 0; d <= hi && g < 400; d = addDays(d, 1), g++) if (isOfficeDay(d, closed)) out.push(d);
  return out;
}
/* checks a request before it's sent or approved → { blocks: [...], warns: [...] } (each { k, msg }) */
function checkRequest(r, ctx) {
  const { pol, closed, blackouts, today, person, reqs, others } = ctx, blocks = [], warns = [];
  if (!TYPE[r.type]) blocks.push({ k: 'type', msg: 'Pick what kind of time off it is.' });
  if (!isISO(r.start) || !isISO(r.end)) blocks.push({ k: 'dates', msg: 'Pick the first and last day.' });
  else if (r.end < r.start) blocks.push({ k: 'dates', msg: 'The last day is before the first day.' });
  else if (daysBetween(r.start, r.end) > 120) blocks.push({ k: 'dates', msg: 'That’s more than four months — split it into shorter requests.' });
  if (blocks.length) return { blocks, warns, days: [] };
  const days = reqDays(r, closed, pol);
  if (!days.length) blocks.push({ k: 'closed', msg: 'The office is closed every day in that range (it’s open Monday to Thursday).' });
  for (const h of blackoutHits(r, blackouts)) blocks.push({ k: 'blackout', msg: h.b.label + ' is a blackout period for ' + typeLabel(r.type).toLowerCase() + ' (' + fmtDate(h.from) + ' – ' + fmtDate(h.to) + ').', b: h.b });
  // sick leave is only ever after the fact: today or days already past, never ahead of time (Dr. A, 9 Oct 2026) — the
  // one kind that can't be planned; a planned appointment is a medical appointment
  if (r.type === 'sick' && r.end > (today || todayISO())) blocks.push({ k: 'sickAhead', msg: 'Sick leave is only for today or days already past — it can’t be asked for ahead of time. For a planned appointment, choose Medical appointment.' });
  if (r.start < (today || todayISO()) && TYPE[r.type] && TYPE[r.type].plan) warns.push({ k: 'past', msg: 'It starts in the past.' });
  const n = noticeShort(r, pol, closed, today);
  if (n) warns.push({ k: 'notice', msg: 'The handbook asks for ' + n.months + ' months’ notice for more than ' + pol.noticeDays + ' days in a row (' + n.days + ' office days here).' });
  if (r.type === 'bereave') {
    if (days.length > pol.bereaveDays) warns.push({ k: 'bereave', msg: 'Bereavement is up to ' + pol.bereaveDays + ' days; this is ' + days.length + '.' });
    if (person && person.type === 'PT' && r.paid) warns.push({ k: 'bereave', msg: 'For part-time staff bereavement is unpaid.' });
  }
  if (person && r.paid && ['vac', 'sick'].includes(bucketOf(r, pol))) {
    const pv = preview(person, reqs || [], r, pol, closed, today);
    if (pv.unpaid > 0) warns.push({ k: 'short', msg: hrs(pv.unpaid) + ' of the ' + hrs(pv.hours) + ' hours would be unpaid — there isn’t enough ' + (pv.bucket === 'sick' ? 'sick leave' : 'vacation') + ' by then.', unpaid: pv.unpaid });
  }
  if (person && person.type === 'PT' && r.paid && ['vac', 'sick'].includes(bucketOf(r, pol)) && !pol.ptAccrues) warns.push({ k: 'pt', msg: 'Part-time staff don’t earn paid vacation or sick leave, so this would be unpaid.' });
  // others off the same days: someone in the same department is a coverage problem (handbook §41)
  for (const o of others || []) {
    const sd = sharedDays(r, o, closed, pol); if (!sd.length) continue;
    warns.push({ k: o.sameDept ? 'dept' : 'overlap', msg: (o.name || 'Someone') + (o.status === 'pending' ? ' has asked for ' : ' is off ') + (sd.length === 1 ? fmtDay(sd[0]) : sd.length + ' of these days (' + fmtRange(sd[0], sd[sd.length - 1]) + ')') + (o.sameDept ? ' — same department.' : '.'), sid: o.sid, sameDept: !!o.sameDept });
  }
  return { blocks, warns, days };
}

/* ---------- benefits (the Benefits page) ---------- */
const CELEBRATE = { monthly: 65, pays: [10, 32.5, 65] }; // Celebrate Primary Care: the practice's share by tier
/* the 401(k): eligible after 1 year of employment (Dr. A, 9 Oct 2026) — the first anniversary of the hire date */
function k401Entry(hire) {
  if (!isISO(hire)) return '';
  const [y, m, d] = hire.split('-').map(Number);
  return isoOf(new Date(y + 1, m - 1, d));
}
/* ---------- scrubs: a yearly allowance (Dr. A, 9 Oct 2026) — asked for by Dec 15 with a reason, approved like time off, and
   the order emailed to community@; what's not asked for doesn't carry over ---------- */
const SCRUBS = { perYear: 2, byDay: 15, to: 'community@thenextlevelorthodontics.com' };
const SCRUB_COLORS = [['navy', 'Navy'], ['gray', 'Gray'], ['teal', 'Teal'], ['black', 'Black']];
const SCRUB_PIECES = [['set', 'Top and bottom'], ['top', 'Top'], ['bottom', 'Bottom']];
const SCRUB_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
/* Dr. A's settings over the defaults: pairs a year (0–10) and the last day of December to ask (1–31) */
function scrubsOf(settings) {
  const s = (settings && settings.to && settings.to.scrubs) || {}, int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  return { perYear: int(s.perYear, 0, 10) ? s.perYear : SCRUBS.perYear, byDay: int(s.byDay, 1, 31) ? s.byDay : SCRUBS.byDay };
}
/* whether scrubs can still be asked for this year (closed after Dec 15 until Jan 1) */
function scrubsOpen(iso, byDay) { return !(Number(iso.slice(5, 7)) === 12 && Number(iso.slice(8, 10)) > byDay); }
function scrubsUsed(perks, sid, year) { return perks.filter(x => x.sid === sid && x.kind === 'scrubs' && x.year === year && (x.status === 'pending' || x.status === 'approved')).reduce((s, x) => s + (Number(x.pairs) || 0), 0); }
function scrubsLeft(perYear, perks, sid, year) { return Math.max(0, (perYear || 0) - scrubsUsed(perks, sid, year)); }
function scrubLabel(list, k) { const x = list.find(p => p[0] === k); return x ? x[1] : k; }
/* "Navy · top and bottom · M · petite" */
function scrubItemText(it) { return [scrubLabel(SCRUB_COLORS, it.color), scrubLabel(SCRUB_PIECES, it.piece).toLowerCase(), it.size, it.petite ? 'petite' : ''].filter(Boolean).join(' · '); }
/* a scrubs request's sealed content, checked before it's shown or saved */
function okPerk(c) {
  return !!c && typeof c === 'object' && c.kind === 'scrubs' && Array.isArray(c.items) && c.items.length >= 1 && c.items.length <= 10 && c.pairs === c.items.length
    && c.items.every(it => it && typeof it === 'object' && SCRUB_COLORS.some(x => x[0] === it.color) && SCRUB_PIECES.some(x => x[0] === it.piece) && SCRUB_SIZES.includes(it.size) && typeof it.petite === 'boolean')
    && typeof c.reason === 'string' && c.reason.length <= 1000 && (c.events == null || Array.isArray(c.events));
}
/* the order email (to community@): who, and what to order — not why */
function scrubsMail(name, items, by) {
  return { kind: 'scrubs', subject: 'Scrubs order: ' + name + ' — ' + plural(items.length, 'pair'),
    text: name + '’s scrubs were approved' + (by ? ' by ' + by : '') + '. Please order:\n\n' + items.map((it, i) => (items.length > 1 ? 'Pair ' + (i + 1) + ': ' : '') + scrubItemText(it)).join('\n') + '\n\nSizes are approximate.' };
}

/* ---------- payroll: what each person's approved time off comes to in a pay period ---------- */
function payPeriod(L, from, to) {
  const o = { vac: 0, sick: 0, free: 0, unpaid: 0, days: new Set() };
  for (const e of L.entries) {
    if (e.date < from || e.date > to) continue;
    if (e.k === 'take') { o[e.b] = round2(o[e.b] + e.paid); o.unpaid = round2(o.unpaid + e.unpaid); o.days.add(e.date); }
    else if (e.k === 'free') { o.free = round2(o.free + e.h); o.days.add(e.date); }
    else if (e.k === 'unpaid') { o.unpaid = round2(o.unpaid + e.h); o.days.add(e.date); }
  }
  o.days = o.days.size; return o;
}

/* =====================================================================
   The old Time-Off app (Google Sheet): reading its rows, and what its
   6 AM script took off, so the move can say exactly what changes.
   ===================================================================== */
const LEGACY_TYPE = { 'vacation': 'vac', 'sick leave': 'sick', 'sick': 'sick', 'personal day': 'personal', 'personal': 'personal', 'medical appointment': 'medical', 'family emergency': 'family', 'bereavement': 'bereave', 'other': 'other' };
function legacyType(s) { return LEGACY_TYPE[String(s || '').trim().toLowerCase()] || 'other'; }
function legacyPart(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v || v === 'full day') return 'full';
  if (v.startsWith('morning')) return 'am'; if (v.startsWith('afternoon')) return 'pm';
  if (v === '2 hours') return 'h2'; if (v === '4 hours') return 'h4'; if (v === '6 hours') return 'h6';
  if (v.includes('half')) return 'half';
  return 'full';
}
function legacyStatus(s) { const v = String(s || '').trim().toLowerCase(); return ['pending', 'approved', 'denied', 'cancelled', 'archived'].includes(v) ? v : v === 'canceled' ? 'cancelled' : 'pending'; }
function legacyPaid(s) { const v = String(s || '').toLowerCase(); return !v.includes('unpaid'); }
/* the old 6 AM script's hours (BenefitsSync.calculateHours_): Monday–Friday, holidays not skipped, a full day unless "half" */
function oldScriptHours(start, end, hoursStr) {
  if (!isISO(start)) return 0; const e = isISO(end) && end >= start ? end : start; let n = 0;
  for (let d = start, g = 0; d <= e && g < 400; d = addDays(d, 1), g++) { const wd = weekday(d); if (wd !== 0 && wd !== 6) n++; }
  return round2(n * (/half/i.test(String(hoursStr || '')) ? 4.25 : 8.5));
}
/* the old script's tiers (BenefitsSync.tierFor_): 1 and 3 years, not the handbook's 2 and 5 */
function oldScriptTier(years) { return years >= 3 ? 3 : years >= 1 ? 2 : 1; }
