/* Unit tests: the policy — office days and closures, hours, tiers, the ledger (accruals, time off, shortfalls, year end,
   adjustments, orientation, part-time), previews, warnings and blocks, payroll, benefits, and the old Sheet's arithmetic.
   Made-up people only. Run: node test/unit.test.js */
const { load } = require('./load');
const A = load(['core.js', 'policy.js']);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : '\n       got      ' + JSON.stringify(a) + '\n       expected ' + JSON.stringify(b)));
const section = s => console.log('# ' + s);
const pol = A.policyOf({}), closed = A.makeClosed([]);
const R = (o) => Object.assign({ id: 'r' + Math.random().toString(36).slice(2, 8), status: 'approved', type: 'vac', paid: true, part: 'full' }, o);

section('Office days, holidays, closures');
eq(A.fixedHolidays(2026).map(h => h.date), ['2026-01-01', '2026-05-25', '2026-07-04', '2026-09-07', '2026-11-25', '2026-11-26', '2026-11-27', '2026-12-25'], '2026 handbook holidays');
eq(A.thanksgiving(2027), '2027-11-25', 'Thanksgiving 2027');
ok(A.isOfficeDay('2026-10-26', closed) && A.isOfficeDay('2026-10-29', closed), 'Mon and Thu are office days');
ok(!A.isOfficeDay('2026-10-30', closed) && !A.isOfficeDay('2026-10-31', closed) && !A.isOfficeDay('2026-11-01', closed), 'Fri, Sat, Sun are not');
ok(!A.isOfficeDay('2026-11-25', closed) && A.closed === undefined, 'the day before Thanksgiving is closed');
const cl2 = A.makeClosed([{ date: '2026-12-28', label: 'Christmas week' }]);
ok(!A.isOfficeDay('2026-12-28', cl2) && cl2('2026-12-28') === 'Christmas week' && A.isOfficeDay('2026-12-28', closed), 'a custom closure is skipped (and only where it’s set)');
eq(A.nextOfficeDay('2026-11-25', closed), '2026-11-30', 'next office day after the Wednesday before Thanksgiving is the Monday after');

section('Hours of a request (the review’s examples)');
eq(A.reqHours(R({ start: '2026-10-26', end: '2026-10-30' }), closed, pol), 34, 'a Mon–Fri week off: 4 office days = 34 h');
eq(A.oldScriptHours('2026-10-26', '2026-10-30', 'Full Day'), 42.5, '…the old 6 AM script took 42.5 h');
eq(A.reqHours(R({ start: '2026-11-23', end: '2026-11-27' }), closed, pol), 17, 'Thanksgiving week Mon–Fri: 17 h');
eq(A.oldScriptHours('2026-11-23', '2026-11-27', 'Full Day'), 42.5, '…the old script: 42.5 h');
eq(A.reqHours(R({ start: '2026-10-27', end: '2026-10-27', part: 'am' }), closed, pol), 4.25, 'one morning: 4.25 h');
eq(A.oldScriptHours('2026-10-27', '2026-10-27', 'Morning (AM)'), 8.5, '…the old script: 8.5 h');
eq(A.reqHours(R({ start: '2026-10-27', end: '2026-10-27', part: 'h2' }), closed, pol), 2, 'a 2-hour appointment: 2 h');
eq(A.oldScriptHours('2026-10-27', '2026-10-27', '2 Hours'), 8.5, '…the old script: 8.5 h');
eq(A.reqHours(R({ start: '2026-10-26', end: '2026-10-29', part: 'pm' }), closed, pol), 17, 'four afternoons: 17 h');
eq(A.reqHours(R({ start: '2026-10-30', end: '2026-11-01' }), closed, pol), 0, 'Fri–Sun: no office days');

section('Tiers and service');
eq(A.yearsOfService('2024-10-08', '2026-10-07'), 1, 'a day before the 2nd anniversary: 1 year');
eq(A.tierAt(pol, '2024-10-08', '2026-10-07').n, 1, '…Tier 1');
eq(A.tierAt(pol, '2024-10-08', '2026-10-08').n, 2, 'on the 2nd anniversary: Tier 2');
eq(A.tierAt(pol, '2021-10-08', '2026-10-08').n, 3, '5 years: Tier 3');
eq(A.oldScriptTier(1), 2, 'the old script put 1 year at Tier 2');
eq(A.nextTierDate(pol, '2025-03-15', '2026-10-08'), { n: 2, date: '2027-03-15', perMonth: 5.67, cap: 68 }, 'next tier date');
eq(A.nextTierDate(pol, '2019-01-02', '2026-10-08'), { n: 4, date: '2029-01-02', perMonth: 8.5, cap: 102 }, 'Gold (7 years): Platinum next, at 10 years — the same hours as Gold');
eq(A.nextTierDate(pol, '2010-01-02', '2026-10-08'), null, 'Double Platinum (16 years): no next tier');
eq([1, 2, 3, 4, 5, 6].map(A.tierName), ['Bronze', 'Silver', 'Gold', 'Platinum', 'Double Platinum', 'Tier 6'], 'the tiers’ names');
eq([A.tierAt(pol, '2016-10-08', '2026-10-08').n, A.tierAt(pol, '2011-10-08', '2026-10-08').n, A.tierAt(pol, '2011-10-09', '2026-10-08').n], [4, 5, 4], 'Platinum at 10 full years, Double Platinum at 15');
eq(A.nextTierDate(pol, '2024-02-29', '2025-01-01').date, '2026-02-28', 'a Feb 29 hire moves up on Feb 28 in a common year');
eq(A.orientEnd({ hire: '2026-08-15' }, pol), '2026-11-13', 'orientation ends 90 days after the hire date by default');
eq(A.orientEnd({ hire: '2026-08-15', orient: '2026-10-01' }, pol), '2026-10-01', '…or on the date set');

section('The ledger: accruals');
{
  const eve = { hire: '2020-01-05', type: 'FT', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  const L = A.ledger(eve, [], pol, closed, '2026-03-31');
  eq([L.vac, L.sick], [25.5, 8.49], 'Tier 3 from Jan 1: Jan, Feb, Mar = 25.5 h vacation, 8.49 h sick');
  eq(L.entries.filter(e => e.k === 'accrue').map(e => e.date), ['2026-01-31', '2026-02-28', '2026-03-31'], 'accrues on the last day of each month');
  const L2 = A.ledger(eve, [], pol, closed, '2026-03-30');
  eq(L2.vac, 17, 'not before the month’s last day');
}
{
  const t1 = { hire: '2025-06-02', orient: '2025-08-31', type: 'FT', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  const L = A.ledger(t1, [], pol, closed, '2026-12-31');
  eq(L.vac, 33.96, 'Tier 1 a whole year: 12 × 2.83 = 33.96 (under the 34 cap)');
  const t1b = { hire: '2025-06-02', orient: '2025-08-31', type: 'FT', open: { asOf: '2026-09-30', vac: 33, sick: 0 } };
  const L2 = A.ledger(t1b, [], pol, closed, '2026-10-31');
  eq(L2.vac, 34, 'the cap: 33 + 2.83 stops at 34');
  ok(L2.entries.find(e => e.k === 'accrue').capped === true && L2.entries.find(e => e.k === 'accrue').addVac === 1, 'and says it was capped (only 1 h added)');
}
{
  // a tier change mid-year: hired 2024-05-20 → Tier 2 from 2026-05-20, so May 31 accrues at Tier 2
  const p = { hire: '2024-05-20', orient: '2024-08-18', type: 'FT', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  const L = A.ledger(p, [], pol, closed, '2026-06-30');
  eq(L.entries.filter(e => e.k === 'accrue').map(e => e.tier), [1, 1, 1, 1, 2, 2], 'Tier 1 through April, Tier 2 from the May 31 accrual');
  eq(L.vac, 4 * 2.83 + 2 * 5.67, '…4 × 2.83 + 2 × 5.67 = ' + L.vac);
}
{
  const n = { hire: '2026-08-15', type: 'FT' };
  const L = A.ledger(n, [], pol, closed, '2026-12-30');
  eq(L.entries.filter(e => e.k === 'accrue').map(e => e.date), ['2026-11-30'], 'orientation: nothing until it ends (Nov 13), then the Nov 30 accrual');
  eq(L.open.asOf, '2026-08-14', 'with no opening balance, it starts the day before the hire date at 0');
  const pt = { hire: '2024-01-08', type: 'PT', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  eq([A.ledger(pt, [], pol, closed, '2026-12-30').vac, A.ledger(pt, [], pol, closed, '2026-12-30').sick], [0, 0], 'part-time: nothing earned');
  const pol2 = A.policyOf({ to: { policy: { ptAccrues: true } } });
  ok(A.ledger(pt, [], pol2, closed, '2026-01-31').vac === 5.67, 'unless Dr. A turns that on (2 years in: Tier 2)');
  const left = { hire: '2020-01-05', type: 'FT', left: '2026-03-12', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  eq(A.ledger(left, [], pol, closed, '2026-06-30').vac, 17, 'someone who left: nothing after their last day');
}

section('The ledger: time off, shortfalls, year end, adjustments');
{
  const p = { hire: '2020-01-05', type: 'FT', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  const r1 = R({ id: 'feb', start: '2026-02-02', end: '2026-02-05' });
  const L = A.ledger(p, [r1], pol, closed, '2026-02-28');
  eq([L.byReq.feb.hours, L.byReq.feb.vac, L.byReq.feb.unpaid], [34, 8.5, 25.5], 'Feb 2–5 with only January’s 8.5 h: 8.5 paid, 25.5 unpaid');
  eq(L.vac, 8.5, '…then Feb 28 adds 8.5 back');
  const sick = R({ id: 's', type: 'sick', start: '2026-03-03', end: '2026-03-03', part: 'am' });
  const L2 = A.ledger(p, [sick], pol, closed, '2026-03-03');
  eq([L2.byReq.s.sick, L2.sick], [4.25, round2(5.66 - 4.25)], 'a sick morning comes out of sick leave');
  const pers = R({ id: 'pd', type: 'personal', start: '2026-03-03', end: '2026-03-03' });
  const L3 = A.ledger(p, [pers], pol, closed, '2026-03-03');
  eq([L3.byReq.pd.free, L3.vac, L3.sick], [8.5, 17, 5.66], 'a personal day is paid but taken from no balance');
  const unp = R({ id: 'u', paid: false, start: '2026-03-03', end: '2026-03-04' });
  eq(A.ledger(p, [unp], pol, closed, '2026-03-04').byReq.u.unpaid, 17, 'unpaid time off: unpaid, balances untouched');
  const pend = R({ id: 'p', status: 'pending', start: '2026-03-03', end: '2026-03-03' });
  eq(A.ledger(p, [pend], pol, closed, '2026-03-04').vac, 17, 'a pending request takes nothing');
  const fut = R({ id: 'f', start: '2026-03-30', end: '2026-04-02' });
  const L4 = A.ledger(p, [fut], pol, closed, '2026-03-31');
  eq([L4.byReq.f.vac, L4.byReq.f.future], [17, 17], 'only days up to the date asked for are taken (the rest are “future”)');
  const set = R({ id: 'old', start: '2026-01-05', end: '2026-01-08' });
  const Ls = A.ledger(Object.assign({}, p, { settled: ['old'] }), [set], pol, closed, '2026-01-31'), Lr = A.ledger(p, [Object.assign({}, set, { settled: true })], pol, closed, '2026-01-31');
  eq([Ls.byReq.old.before, Ls.byReq.old.unpaid], [34, 0], 'time off the old Sheet already took (listed in the HR record) is not taken again');
  eq([Lr.byReq.old.before, Lr.byReq.old.unpaid], [0, 34], '…a request saying so itself counts for nothing (whoever asks could write that)');
}
function round2(n) { return Math.round(n * 100) / 100; }
{
  const p = { hire: '2020-01-05', type: 'FT', open: { asOf: '2026-11-30', vac: 40, sick: 10 } };
  const L = A.ledger(p, [], pol, closed, '2027-01-31');
  eq(L.payouts, [{ year: 2026, vac: 48.5, sick: 12.83, lostVac: 0, lostSick: 0 }], 'Dec 31: what’s left (after December’s accrual) is paid out');
  eq([L.vac, L.sick], [8.5, 2.83], 'January starts at 0, then January’s accrual');
  const pl = A.policyOf({ to: { policy: { yearEnd: { vac: 'payout', sick: 'lose' } } } });
  eq(A.ledger(p, [], pl, closed, '2027-01-01').payouts, [{ year: 2026, vac: 48.5, sick: 0, lostVac: 0, lostSick: 12.83 }], 'sick leave “use it or lose it” when set so');
  const adj = Object.assign({}, p, { adj: [{ id: 'a1', date: '2026-12-10', b: 'vac', h: 5, note: 'correction' }, { id: 'a2', date: '2026-12-11', b: 'sick', h: -50, note: 'too much' }] });
  const L2 = A.ledger(adj, [], pol, closed, '2026-12-11');
  eq([L2.vac, L2.sick], [45, 0], 'adjustments land on their day; a balance never goes below 0');
  const a2 = L2.entries.find(e => e.id === 'a2'); eq([a2.h, a2.want], [-10, -50], '…and the entry says only 10 h could come off');
}

section('Preview of a request and the warnings');
{
  const p = { hire: '2020-01-05', type: 'FT', open: { asOf: '2026-09-30', vac: 30, sick: 6 } };
  const r = { type: 'vac', paid: true, part: 'full', start: '2026-11-02', end: '2026-11-05' };
  const pv = A.preview(p, [], r, pol, closed, '2026-10-08');
  eq([pv.hours, pv.vac, pv.unpaid, pv.after.vac], [34, 34, 0, 4.5], '30 h now + Oct 31 accrual 8.5 = 38.5 by Nov 2 → 34 paid, 4.5 left (Nov 30 accrual not yet)');
  const other = R({ id: 'x', start: '2026-10-26', end: '2026-10-29' });
  const pv2 = A.preview(p, [other], r, pol, closed, '2026-10-08');
  eq([pv2.vac, pv2.unpaid], [8.5, 25.5], 'with another approved week first (Oct 26–29 uses the 30 h), only the Oct 31 accrual is left: 8.5 paid, 25.5 unpaid');
  const ctx = { pol, closed, blackouts: A.blackoutsOf({}), today: '2026-10-08', person: p, reqs: [other], others: [] };
  const c = A.checkRequest(r, ctx);
  eq(c.blocks, [], 'no blocks');
  ok(c.warns.some(w => w.k === 'short' && w.unpaid === 25.5 && /25.5 of the 34 hours/.test(w.msg)), 'warns that 25.5 h would be unpaid');
  ok(c.warns.some(w => w.k === 'notice'), 'warns about notice (4 days in a row, less than 3 months ahead)');
  const c2 = A.checkRequest(Object.assign({}, r, { start: '2027-02-01', end: '2027-02-04' }), Object.assign({}, ctx, { reqs: [] }));
  ok(!c2.warns.some(w => w.k === 'notice'), 'no notice warning 3+ months ahead');
  const two = A.checkRequest(Object.assign({}, r, { start: '2026-10-26', end: '2026-10-27' }), Object.assign({}, ctx, { reqs: [] }));
  ok(!two.warns.some(w => w.k === 'notice'), 'two days don’t need the notice');
}
{
  const ctx = { pol, closed, blackouts: A.blackoutsOf({}), today: '2026-10-08', person: null, reqs: [], others: [] };
  const jan = A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2027-01-11', end: '2027-01-12' }, ctx);
  ok(jan.blocks.some(b => b.k === 'blackout' && /January/.test(b.msg)), 'vacation in January is blocked: ' + JSON.stringify(jan.blocks));
  const janSick = A.checkRequest({ type: 'sick', paid: true, part: 'full', start: '2027-01-11', end: '2027-01-11' }, Object.assign({}, ctx, { today: '2027-01-14' }));
  eq(janSick.blocks, [], 'sick leave in January is not (recorded after the fact, as sick leave always is)');
  const janMed = A.checkRequest({ type: 'medical', paid: true, part: 'h2', start: '2027-01-11', end: '2027-01-11' }, ctx);
  eq(janMed.blocks, [], 'nor a medical appointment');
  const thx = A.checkRequest({ type: 'personal', paid: true, part: 'full', start: '2026-11-23', end: '2026-11-23' }, ctx);
  ok(thx.blocks.some(b => /Thanksgiving/.test(b.msg) && /Nov 23/.test(b.msg) && /Nov 29/.test(b.msg)), 'a personal day the Monday of Thanksgiving week is blocked (Nov 23 – 29)');
  const span = A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2026-12-28', end: '2027-01-04' }, ctx);
  ok(span.blocks.some(b => /January/.test(b.msg)), 'a December–January request runs into January');
  const own = A.blackoutsOf({ to: { blackouts: [{ id: 'x', label: 'Move week', kind: 'dates', from: '2026-12-07', to: '2026-12-10', types: ['vac'] }] } });
  ok(A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2026-12-09', end: '2026-12-09' }, Object.assign({}, ctx, { blackouts: own })).blocks.length === 1, 'Dr. A’s own dates block too');
  ok(A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2027-01-11', end: '2027-01-11' }, Object.assign({}, ctx, { blackouts: own })).blocks.length === 0, '…and replace the defaults when set');
  const closedOnly = A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2026-11-25', end: '2026-11-27' }, Object.assign({}, ctx, { blackouts: [] }));
  ok(closedOnly.blocks.some(b => b.k === 'closed'), 'all-closed days are refused');
  const back = A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2026-10-05', end: '2026-10-01' }, ctx);
  ok(back.blocks.some(b => b.k === 'dates'), 'end before start is refused');
  const br = A.checkRequest({ type: 'bereave', paid: true, part: 'full', start: '2026-10-12', end: '2026-10-19' }, Object.assign({}, ctx, { person: { type: 'PT', hire: '2024-01-01' } }));
  ok(br.warns.filter(w => w.k === 'bereave').length === 2, 'bereavement over 3 days, and paid for part-time: two warnings');
  // sick leave: today or days already past, never ahead of time (the only kind that can't be planned)
  const sk = (start, end, type) => A.checkRequest({ type: type || 'sick', paid: true, part: 'full', start, end }, Object.assign({}, ctx, { blackouts: [] }));
  ok(sk('2026-10-12', '2026-10-12').blocks.some(b => b.k === 'sickAhead' && /can’t be asked for ahead of time/.test(b.msg)), 'sick leave for next Monday: refused');
  eq(sk('2026-10-08', '2026-10-08').blocks, [], '…today is fine');
  eq(sk('2026-10-05', '2026-10-06').blocks, [], '…and so are days already past');
  ok(sk('2026-10-07', '2026-10-12').blocks.some(b => b.k === 'sickAhead'), '…but not running on into days to come');
  eq(['vac', 'medical', 'personal', 'family', 'bereave', 'other'].map(t => sk('2026-10-12', '2026-10-12', t).blocks.length), [0, 0, 0, 0, 0, 0], 'every other kind can be asked for ahead of time');
  const ov = A.checkRequest({ type: 'vac', paid: true, part: 'full', start: '2026-12-07', end: '2026-12-10' }, Object.assign({}, ctx, { others: [{ sid: 'gwen', name: 'Gwen', status: 'approved', sameDept: true, start: '2026-12-09', end: '2026-12-14' }, { sid: 'eve', name: 'Eve', status: 'pending', sameDept: false, start: '2026-12-01', end: '2026-12-07' }] }));
  ok(ov.warns.some(w => w.k === 'dept' && /Gwen is off 2 of these days/.test(w.msg)), 'same department off: ' + JSON.stringify(ov.warns.map(w => w.msg)));
  ok(ov.warns.some(w => w.k === 'overlap' && /Eve has asked for Mon, Dec 7/.test(w.msg)), 'someone else has asked: ' + JSON.stringify(ov.warns.map(w => w.msg)));
}

section('Settings over the policy');
{
  const p = A.policyOf({ to: { policy: { day: 8, tiers: [{ from: 0, perMonth: 3, cap: 36 }, { from: 3, perMonth: 6, cap: 72 }], sickPerMonth: 'x', route: { medical: 'sick', other: 'nope' } } } });
  eq([p.day, p.tiers.length, p.tiers[1].from, p.sickPerMonth, p.route.medical, p.route.other], [8, 2, 3, 2.83, 'sick', 'vac'], 'good values used, bad ones fall back');
  const bad = A.policyOf({ to: { policy: { tiers: [{ from: 1, perMonth: 3, cap: 36 }] } } });
  eq(bad.tiers.length, 5, 'tiers that don’t start at 0 years are ignored (the default five)');
  eq(A.partHours('am', p), 4, 'half of an 8-hour day');
  eq(A.bucketOf({ type: 'medical', paid: true }, p), 'sick', 'a medical appointment from sick leave when set so');
  eq(A.bucketOf({ type: 'medical', paid: false }, p), 'unpaid', 'unpaid is unpaid');
}

section('Benefits and payroll');
eq(A.k401Entry('2025-03-15'), '2026-03-15', '401(k): eligible after 1 year of employment (the first anniversary)');
eq(A.k401Entry('2024-02-29'), '2025-03-01', '…a Feb 29 hire: the day after Feb 28');
// scrubs: 2 pairs a year by default; waiting and approved requests count, denied and cancelled don't; each year on its own
const P = (sid, pairs, status, year) => ({ sid, kind: 'scrubs', pairs, status, year, reason: 'x' });
const pk = [P('gwen', 1, 'approved', 2026), P('gwen', 1, 'denied', 2026), P('gwen', 2, 'approved', 2025), P('kim', 1, 'pending', 2026)];
eq([A.scrubsOf({}).perYear, A.scrubsUsed(pk, 'gwen', 2026), A.scrubsLeft(2, pk, 'gwen', 2026), A.scrubsLeft(2, pk, 'gwen', 2027), A.scrubsLeft(2, pk, 'kim', 2026)], [2, 1, 1, 2, 1], 'scrubs: used and left by person and year (nothing carries over)');
eq([A.scrubsOf({ to: { scrubs: { perYear: 1, byDay: 10 } } }), A.scrubsOf({ to: { scrubs: { perYear: 1.5, byDay: 40 } } }), A.scrubsOf({})], [{ perYear: 1, byDay: 10 }, { perYear: 2, byDay: 15 }, { perYear: 2, byDay: 15 }], 'scrubs settings: Dr. A’s whole numbers (0–10 pairs, December 1–31), else 2 pairs by December 15');
eq(['2026-12-15', '2026-12-16', '2026-12-31', '2027-01-01', '2026-11-30'].map(d => A.scrubsOpen(d, 15)), [true, false, false, true, true], 'asking closes after December 15 and opens again on January 1');
const IT = (color, piece, size, petite) => ({ color, piece, size, petite });
const okP = (items, extra) => A.okPerk(Object.assign({ kind: 'scrubs', items, pairs: items.length, reason: 'Torn' }, extra || {}));
eq([okP([IT('navy', 'set', 'M', false)]), okP([IT('teal', 'top', 'S', true), IT('black', 'bottom', '2XL', false)]), okP([IT('red', 'set', 'M', false)]), okP([IT('navy', 'shirt', 'M', false)]), okP([IT('navy', 'set', 'Medium', false)]),
  okP([IT('navy', 'set', 'M')]), okP([]), okP([IT('navy', 'set', 'M', false)], { pairs: 2 }), A.okPerk({ kind: 'scrubs', items: [IT('navy', 'set', 'M', false)], pairs: 1 })],
  [true, true, false, false, false, false, false, false, false], 'a scrubs request: navy, gray, teal or black; top, bottom or both; a listed size; petite or not; a reason');
eq(A.scrubItemText(IT('teal', 'set', 'S', true)) + ' | ' + A.scrubItemText(IT('gray', 'bottom', 'XL', false)), 'Teal · top and bottom · S · petite | Gray · bottom · XL', 'how a pair reads');
const sm = A.scrubsMail('Riley Example', [IT('navy', 'set', 'M', true), IT('teal', 'top', 'M', false)], 'Dr. A');
ok(sm.kind === 'scrubs' && sm.subject === 'Scrubs order: Riley Example — 2 pairs' && /Pair 1: Navy · top and bottom · M · petite\nPair 2: Teal · top · M/.test(sm.text) && /approved by Dr\. A/.test(sm.text), 'the order email: who, each pair — ' + JSON.stringify(sm));
eq(A.CELEBRATE.pays, [10, 32.5, 65], 'Celebrate Primary Care: what the practice pays by tier');
{
  const p = { hire: '2020-01-05', type: 'FT', open: { asOf: '2026-09-30', vac: 10, sick: 4 } };
  const L = A.ledger(p, [R({ id: 'a', start: '2026-10-05', end: '2026-10-06' }), R({ id: 'b', type: 'sick', start: '2026-10-07', end: '2026-10-07' }), R({ id: 'c', type: 'personal', start: '2026-10-08', end: '2026-10-08' }), R({ id: 'd', paid: false, start: '2026-10-12', end: '2026-10-12', part: 'h4' })], pol, closed, '2026-10-31');
  eq(A.payPeriod(L, '2026-10-01', '2026-10-15'), { vac: 10, sick: 4, free: 8.5, unpaid: 7 + 4.5 + 4, days: 5 }, 'Oct 1–15: 10 vac + 7 short, 4 sick + 4.5 short, 8.5 personal, 4 unpaid');
  eq(A.payPeriod(L, '2026-10-16', '2026-10-31'), { vac: 0, sick: 0, free: 0, unpaid: 0, days: 0 }, 'nothing in the second half');
}

section('The old Sheet’s rows');
eq([A.legacyType('Sick Leave'), A.legacyType('Personal Day'), A.legacyType('Medical Appointment'), A.legacyType('Jury Duty')], ['sick', 'personal', 'medical', 'other'], 'types');
eq([A.legacyPart('Full Day'), A.legacyPart('Morning (AM)'), A.legacyPart('Afternoon (PM)'), A.legacyPart('6 Hours'), A.legacyPart('Half Day'), A.legacyPart('')], ['full', 'am', 'pm', 'h6', 'half', 'full'], 'hours');
eq([A.legacyStatus('Approved'), A.legacyStatus('Canceled'), A.legacyStatus('weird')], ['approved', 'cancelled', 'pending'], 'statuses');
eq([A.legacyPaid('Paid Time Off'), A.legacyPaid('Unpaid Time Off'), A.legacyPaid('')], [true, false, true], 'paid / unpaid');


section('The office’s time zone');
eq([new Date(A.dayStartMs('2026-07-01')).toISOString(), new Date(A.dayStartMs('2026-12-01')).toISOString()], ['2026-07-01T04:00:00.000Z', '2026-12-01T05:00:00.000Z'], 'a day starts at midnight in Gainesville, summer and winter');
eq([A.isoOfMs(A.dayStartMs('2026-11-01')), A.isoOfMs(A.dayStartMs('2026-03-08') + 22.5 * 3600000), A.isoOfMs(A.dayStartMs('2026-03-08') + 23.5 * 3600000)], ['2026-11-01', '2026-03-08', '2026-03-09'], '…including the days the clocks change (Mar 8 has 23 hours)');
ok(A.okContent({ start: '2026-10-05', end: '2026-10-06', type: 'vac', note: 'x', events: [] }) && !A.okContent({ start: 5, end: '2026-10-06', type: 'vac' }) && !A.okContent({ start: '2026-10-07', end: '2026-10-06', type: 'vac' }) && !A.okContent(null), 'a request’s content is checked before it’s shown');

section('A policy change applies from its day');
{
  const st = { to: { policy: { day: 8, tiers: [{ from: 0, perMonth: 4, cap: 50 }, { from: 2, perMonth: 6, cap: 72 }, { from: 5, perMonth: 8, cap: 96 }] }, policyFrom: '2026-07-01',
    policyOld: [{ until: '2026-06-30', policy: {} }, { until: '2026-08-31', policy: { day: 9 } }] } };
  const p = A.policyOf(st);
  eq([p.from, p.prev.length, A.polOn(p, '2026-06-30').tiers[0].perMonth, A.polOn(p, '2026-07-01').tiers[0].perMonth, A.polOn(p, '2026-07-01').day], ['2026-07-01', 1, 2.83, 4, 8], 'before Jul 1 the earlier version; a version kept past the change is ignored');
  const person = { hire: '2025-06-02', type: 'FT', open: { asOf: '2025-12-31', vac: 0, sick: 0 } };
  const L = A.ledger(person, [], p, closed, '2026-09-30');
  eq(L.vac, A.round2(6 * 2.83 + 3 * 4), 'Jan–Jun earn 2.83 a month, Jul–Sep 4 (the new tiers)');
  eq(A.reqHours(R({ start: '2026-06-29', end: '2026-07-02' }), closed, p), 8.5 * 2 + 8 * 2, 'a day is 8.5 h before the change and 8 h after');
  eq(A.bucketOf({ type: 'medical', paid: true, start: '2026-06-01' }, A.policyOf({ to: { policy: { route: { medical: 'sick' } }, policyFrom: '2026-07-01', policyOld: [{ until: '2026-06-30', policy: {} }] } })), 'vac', 'a request goes where the policy on its first day sends it');
  const ye = A.policyOf({ to: { policy: { yearEnd: { vac: 'payout', sick: 'payout' } }, policyFrom: '2027-01-01', policyOld: [{ until: '2026-12-31', policy: { yearEnd: { vac: 'lose', sick: 'payout' } } }] } });
  const L2 = A.ledger({ hire: '2020-01-06', type: 'FT', open: { asOf: '2026-12-30', vac: 20, sick: 5 } }, [], ye, closed, '2027-01-02');
  eq(L2.payouts[0], { year: 2026, vac: 0, sick: 7.83, lostVac: 28.5, lostSick: 0 }, 'Dec 31 (after its accrual) follows the policy in force that year (vacation not carried over), not the new one');
  eq(A.policyOf({}).prev, [], 'no versions: just the policy');
}

/* the made-up old Sheet: demoOldSheet in demo.js simulates the old 6 AM script day by day (Fridays and holidays counted,
   partial days as full, tiers at 1 and 3 years, part-time and orientation ignored, never below 0) */
const M = load(['core.js', 'policy.js', 'reader.js', 'demo.js', 'importer.js'], 'var S = { roster: [], settings: {} }, ACT = {}, CHG = {};');
const T0 = '2026-10-08', OLD = M.demoOldSheet(T0), D = M.parseOldSheet(OLD), mpol = M.policyOf({}), mclosed = M.makeClosed(D.closures);
const person = n => D.people.find(p => p.name === n);
section('The old Sheet: reading its tabs');
eq(D.people.map(p => p.name), ['Jordan Sample', 'Riley Example', 'Taylor Mock', 'Morgan Test', 'Casey Demo', 'Drew Newhire', 'Sam Former', 'Pat Gone'], 'everyone: BenefitsEmployees, FormerStaff, then a name only on requests');
eq([person('Morgan Test').type, person('Riley Example').hire, person('Riley Example').vac, person('Riley Example').sick, person('Sam Former').former, person('Sam Former').moved, person('Pat Gone').noRow],
  ['PT', '2023-03-13', 51, 22.64, true, '2026-08-09', true], 'type, hire date, balances; FormerStaff with the day they moved; a name only on requests');
ok(!JSON.stringify(D).includes('NOT-A-REAL') && !JSON.stringify(D).toLowerCase().includes('passcode'), 'the Password and Passcode columns are never read');
eq(M.headMap(['Name', 'Passcode', 'Password', 'SickLeaveBalance', 'VacationBalance', 'PersonalDaysBalance'], M.OLD_EMP_HEAD), { name: 0, sick: 3, vac: 4 }, 'headings: password columns never mapped, personal days ignored');
eq([D.reqs.length, D.bad.length, D.bad[0].why], [18, 1, 'no start date'], '18 requests; a row with no start date is reported, not moved');
const rq = (n, t) => D.reqs.filter(r => r.name === n && (!t || r.typeRaw === t));
eq(rq('Riley Example', 'Medical Appointment')[0].part, 'am', 'Morning (AM) → a morning');
eq(rq('Taylor Mock', 'Other')[0].part, 'h2', '2 Hours → 2 hours');
eq(rq('Drew Newhire')[0].part + ' ' + rq('Drew Newhire')[0].status, 'pm pending', 'Afternoon (PM), pending');
eq(rq('Casey Demo', 'Vacation')[0].ded, '', 'approved, but the 6 AM script never took it off: no DeductedOn');
eq(rq('Riley Example', 'Sick Leave')[0].ded, rq('Riley Example', 'Sick Leave')[0].start, 'DeductedOn kept');
eq(D.reqs.map(r => r.status).sort().filter((x, i, a) => a.indexOf(x) === i), ['approved', 'cancelled', 'denied', 'pending'], 'statuses');
eq(rq('Riley Example', 'Personal Day')[0].type + ' ' + rq('Jordan Sample', 'Bereavement')[0].type, 'personal bereave', 'kinds');
eq([D.log.length, D.log.filter(l => l.kind === 'manual').length, D.log.filter(l => l.kind === 'reset').length], [120, 1, 10], 'balance log: 120 lines, 1 by hand, the Jan 1 resets (not for this year’s two new hires)');
eq(D.log.find(l => l.kind === 'manual'), { date: '2026-07-16', name: 'Jordan Sample', b: 'vac', h: 8.5, kind: 'manual', reason: 'Worked the Saturday open house', by: 'Amir Akhavan' }, 'a hand adjustment (6 columns)');
eq(D.closures, [{ date: '2026-07-04', label: 'Independence Day' }, { date: '2026-12-24', label: 'Christmas Eve' }], 'Holidays tab');
eq(D.blackouts.map(M.usualBlackout), [true, true, false], 'Blackouts: January and Thanksgiving week are the usual ones; a third isn’t');
eq([M.oldStatus('Approved'), M.oldStatus('canceled'), M.oldStatus('Rejected'), M.oldStatus('???')], ['approved', 'cancelled', 'denied', ''], 'an unknown status isn’t guessed');

section('The old Sheet: matching names to logins');
{
  const roster = [{ sid: 'riley', name: 'Riley (demo)', username: 'riley' }, { sid: 'amir', name: 'Dr. Akhavan' }, { sid: 'bri', name: 'Bri Brower', username: 'bri' }, { sid: 'gwen', name: 'Gwen Smith', username: 'gwen' }, { sid: 'gwenj', name: 'Gwen Jones', username: 'gwenj' }, { sid: 'eve', name: 'Eve Adams', username: 'eve' }];
  eq([M.matchSid('Riley Example', roster), M.matchSid('Amir Akhavan', roster), M.matchSid('bri  brower', roster), M.matchSid('Gwen', roster), M.matchSid('Gwen S.', roster), M.matchSid('Eve', roster), M.matchSid('Pat Gone', roster)],
    ['riley', 'amir', 'bri', '', 'gwen', 'eve', ''], 'username, last name, whole name; two Gwens need a last initial; nobody → none');
}

section('The old Sheet: the check against the handbook');
const audit = n => M.auditOld(person(n), D.reqs, D.log, mpol, mclosed, T0);
for (const p of D.people.filter(p => !p.noRow)) {
  const a = audit(p.name);
  ['vac', 'sick'].forEach(b => ok(Math.abs(a.lines.filter(l => l.b === b).reduce((s, l) => s + l.d, 0) - (a.hand[b] - a.old[b])) < 0.011, p.name + ' (' + b + '): the lines add up to the difference'));
}
{
  const r = audit('Riley Example');
  eq([r.old, r.hand], [{ vac: 51, sick: 22.64 }, { vac: 35.44, sick: 22.64 }], 'Riley: the old app 51 h vacation, the handbook 35.44 h');
  eq(r.lines.map(l => [l.b, l.d]), [['vac', -19.81], ['vac', 4.25]], '…7 months at Tier 3 from 3 years (−19.81), a morning taken as a full day (+4.25)');
  ok(/7 months at a higher tier/.test(r.lines[0].why) && /2 requests counted differently/.test(r.lines[1].why), '…with the reasons');
  eq(M.oldReplay(D.log.filter(l => l.name === 'Riley Example' && l.date >= '2026-01-01'), 'vac'), { acc: 70.84, took: 19.84, man: 0, other: 0, hand: 0, end: 51 }, 'the old log replayed by balance: a week off with 11.34 h left took 11.34, not the 42.5 the row says');
  ok(r.notes.some(x => /22\.66 h/.test(x)), '…and 22.66 h of that week would have been unpaid under the handbook');
  const t = audit('Taylor Mock');
  eq(t.lines.map(l => l.d), [-25.56, 20.71, -4.25], 'Taylor: Tier 2 at 1 year (−25.56), a week Mon–Fri and 2 hours as a full day (+20.71), 4.25 h typed into the Sheet (−4.25)');
  ok(/More in the Sheet than its own log/.test(t.lines[2].title), '…the typed-in hours found');
  const m = audit('Morgan Test');
  eq([m.hand, m.lines.map(l => l.d)], [{ vac: 0, sick: 0 }, [-51.03, 17, -25.47]], 'Morgan (part-time): the handbook gives no paid time off');
  ok(/part-time/.test(m.lines[0].why), '…because part-time');
  const c = audit('Casey Demo');
  ok(/3 months added during orientation \(it ends Aug 9\)/.test(c.lines[0].why) && /never taken off by the old app: Thu, Oct 1/.test(c.lines[1].why), 'Casey: earned during orientation; a day off the old app never took');
  eq(audit('Drew Newhire').hand, { vac: 0, sick: 0 }, 'Drew: still in orientation');
  const s = audit('Sam Former');
  eq([s.hand.sick, s.old.sick], [19.81, 19.81], 'Sam (left): nothing earned after the day they left');
  const j = audit('Jordan Sample');
  eq([j.lines.length, j.notes.length], [0, 1], 'Jordan: the same balance both ways (one note: a week bigger than the balance)');
}

section('The old Sheet: the downloaded files');
(async () => {
  const fs = require('fs'), path = require('path'), FX = path.join(__dirname, 'fixtures');
  const file = n => { const b = fs.readFileSync(path.join(FX, n)); return { name: n, size: b.length, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const json = JSON.parse(fs.readFileSync(path.join(FX, 'old-sheet.json'), 'utf8'));
  const fromJSON = M.parseOldSheet({ tabs: new Map(Object.entries(json.tabs)), date1904: false });
  const same = (x, m) => { eq(JSON.stringify(x.people), JSON.stringify(fromJSON.people), m + ': people'); eq(JSON.stringify(x.reqs), JSON.stringify(fromJSON.reqs), m + ': requests'); eq(JSON.stringify(x.log), JSON.stringify(fromJSON.log), m + ': balance log'); eq(JSON.stringify([x.closures, x.blackouts]), JSON.stringify([fromJSON.closures, fromJSON.blackouts]), m + ': closures, blackouts'); };
  eq(JSON.stringify(fromJSON.people), JSON.stringify(D.people), 'the fixture is the made-up Sheet as of Oct 8');
  const xl = await M.readOldSheet([file('old-sheet.xlsx')]);
  eq(Array.from(xl.tabs.keys()), ['Requests', 'BenefitsEmployees', 'FormerStaff', 'BalanceLog', 'Holidays', 'Blackouts'], '.xlsx: every tab, by name');
  same(M.parseOldSheet(xl), '.xlsx (dates and times as Excel numbers)');
  const csv = await M.readOldSheet(fs.readdirSync(FX).filter(n => n.endsWith('.csv')).map(file));
  eq(Array.from(csv.tabs.keys()).sort(), ['BalanceLog', 'BenefitsEmployees', 'Blackouts', 'FormerStaff', 'Holidays', 'Requests'], 'CSV files: the tab from each file’s name');
  same(M.parseOldSheet(csv), 'CSV');
  let e1 = ''; try { M.parseOldSheet({ tabs: new Map([['Sheet1', [['a', 'b']]]]) }); } catch (e) { e1 = e.message; }
  ok(/doesn’t look like the old Time-Off Sheet/.test(e1), 'some other file: “doesn’t look like the old Time-Off Sheet”');
  let e2 = ''; try { await M.readOldSheet([{ name: 'x.pdf', size: 10, arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2]).buffer }]); } catch (e) { e2 = e.message; }
  ok(/PDF/.test(e2), 'a PDF: told to download the .xlsx');
  eq([M.toISODate(46303), M.toISODate('10/8/2026'), M.toISODate('2026-10-08 14:05:00'), M.toISODate('nope'), M.toISODate('2026-02-30')], ['2026-10-08', '2026-10-08', '2026-10-08', '', ''], 'dates: Excel numbers, US and ISO text; not-dates are blank');
  eq(new Date(M.toWhenMs(46303.5)).toString().slice(16, 21), '12:00', 'an Excel date-time is office (local) time');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

