/* The time clock's arithmetic (src/engine.js): days and weeks at the office, the clocks changing, lunches, missing
   punches, overtime and the heads-ups, every boundary, corrections, payroll weeks. Made-up people only.
     node test/unit.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ Intl, Date, Math, JSON, Object, Array, String, Number, Set, Map, console });
const TCE = vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'engine.js'), 'utf8') + '\nTCE', ctx);
// (a few of the page's small helpers, from core.js)
const core = vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8') + '\n({ devText, randInt })', vm.createContext({ TextEncoder, crypto: require('crypto').webcrypto, Uint32Array, Uint8Array, Math, String, Array, console }));
const { devText, randInt } = core;
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name + (ok ? '' : ' :: got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const yes = (name, c) => eq(name, !!c, true);
const H = 3600000, MIN = 60000;
const at = (iso, hm) => TCE.atTime(iso, hm);
let n = 0; const pid = () => 'p' + String(++n).padStart(24, '0'), fid = () => 'f' + String(++n).padStart(24, '0');
const P = (sid, kind, iso, hm, src) => ({ id: pid(), sid, kind, at: at(iso, hm), src: src || 'kiosk' });
const SET = TCE.settingsOf({ wk: 0, ot: 40, thr: [36, 38], early: '07:30', late: '18:30', shift: 10, brk: 20, days: [1, 2, 3, 4] });
const STAFF = TCE.staffOf({ on: true });
function wk(list, now, o) {
  o = o || {};
  const set = o.set || SET, iso = TCE.dayOf(now);
  return TCE.week({ sid: o.sid || 'gwen', list: TCE.entries(list, o.fixes || []), set, staff: o.staff || STAFF, wkIso: TCE.weekOf(iso, set.wk), now, approved: o.approved || 0 });
}
const keys = (w, o) => TCE.alertsFor(w, { name: 'Gwen', set: (o && o.set) || SET, now: (o && o.now) || Date.now() }).map(a => a.key.split('|')[0]);

console.log('\n# the office clock (Eastern), including the days the clocks change');
eq('midnight Oct 12 (EDT) is 04:00 UTC', new Date(TCE.dayStart('2026-10-12')).toISOString(), '2026-10-12T04:00:00.000Z');
eq('midnight Dec 1 (EST) is 05:00 UTC', new Date(TCE.dayStart('2026-12-01')).toISOString(), '2026-12-01T05:00:00.000Z');
eq('7:30 AM on the day DST starts (Mar 8, 2026)', new Date(at('2026-03-08', '07:30')).toISOString(), '2026-03-08T11:30:00.000Z');
eq('7:30 AM on the day DST ends (Nov 1, 2026)', new Date(at('2026-11-01', '07:30')).toISOString(), '2026-11-01T12:30:00.000Z');
eq('midnight on the day DST ends', new Date(TCE.dayStart('2026-11-01')).toISOString(), '2026-11-01T04:00:00.000Z');
eq('the day of 11:59 PM Eastern (already tomorrow in UTC)', TCE.dayOf(at('2026-10-12', '23:59')), '2026-10-12');
eq('workweek starting Sunday holds Thu Oct 15', TCE.weekOf('2026-10-15', 0), '2026-10-11');
eq('workweek starting Monday holds Sun Oct 18', TCE.weekOf('2026-10-18', 1), '2026-10-12');
eq('a workweek is 7 days long even with the clock change in it', (TCE.weekRange('2026-11-01')[1] - TCE.weekRange('2026-11-01')[0]) / H, 169);
eq('12-hour times', [TCE.hmText('07:05'), TCE.hmText('12:00'), TCE.hmText('00:30'), TCE.hmText('18:30')], ['7:05 AM', '12:00 PM', '12:30 AM', '6:30 PM']);

console.log('\n# a day: in, lunch, back, out');
const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', THU = '2026-10-15', FRI = '2026-10-16', SAT = '2026-10-17', SUN = '2026-10-11';
let w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'back', MON, '12:30'), P('gwen', 'out', MON, '17:00')], at(MON, '20:00'));
eq('8 to 5 with a 30-minute lunch = 8.5 h', TCE.h2(w.total), 8.5);
eq('Monday holds it all', TCE.h2(w.days[1].ms), 8.5);
eq('out now', w.state, 'out');
eq('nothing flagged', w.days[1].flags.map(f => f.type), []);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'back', MON, '12:12'), P('gwen', 'out', MON, '17:00')], at(MON, '20:00'));
eq('a 12-minute lunch counts as paid (under 20 min): 9 h', TCE.h2(w.total), 9);
eq('…and is noted', w.days[1].gaps.map(g => g.min), [12]);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'back', MON, '12:20'), P('gwen', 'out', MON, '17:00')], at(MON, '20:00'));
eq('a 20-minute lunch is unpaid (8.67 h)', TCE.h2(w.total), 8.67);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'out', MON, '12:01')], at(MON, '20:00'));
eq('left at lunch (lunch, then out): 4 h, no issue', [TCE.h2(w.total), w.issues.length], [4, 0]);

console.log('\n# clocked in right now');
w = wk([P('gwen', 'in', MON, '08:00')], at(MON, '11:30'));
eq('counts up to now: 3.5 h', TCE.h2(w.total), 3.5);
eq('state in, since 8:00', [w.state, TCE.timeText(w.since), w.clocked], ['in', '8:00 AM', true]);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00')], at(MON, '12:10'));
eq('at lunch: the lunch so far doesn’t count yet', [w.state, TCE.h2(w.total)], ['lunch', 4]);

console.log('\n# missing punches');
w = wk([P('gwen', 'in', THU, '08:00')], at(FRI, '09:00'));
eq('clocked in Thursday, never out: 0 h until fixed', TCE.h2(w.total), 0);
eq('…a missing clock-out', w.issues.map(x => x.type), ['missing-out']);
eq('…and Friday morning she shows as out', w.state, 'out');
w = wk([P('gwen', 'in', WED, '08:00'), P('gwen', 'in', THU, '07:55'), P('gwen', 'out', THU, '16:00')], at(THU, '18:00'));
eq('Wednesday’s missing clock-out doesn’t eat Thursday: 8.08 h', TCE.h2(w.total), 8.08);
eq('…Wednesday flagged', w.issues.filter(x => x.type === 'missing-out').map(x => x.day), [WED]);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'in', MON, '09:00'), P('gwen', 'out', MON, '12:00')], at(MON, '18:00'));
eq('a second clock-in the same day is ignored (4 h from the first)', [TCE.h2(w.total), w.issues.map(x => x.type)], [4, ['double-in']]);
w = wk([P('gwen', 'in', WED, '08:00'), P('gwen', 'lunch', WED, '12:00')], at(THU, '09:00'));
eq('went to lunch Wednesday and never came back', [TCE.h2(w.total), w.issues.map(x => x.type)], [4, ['no-return']]);
w = wk([P('gwen', 'out', MON, '17:00')], at(MON, '18:00'));
eq('a clock-out with no clock-in: a missing clock-in, not counted', [TCE.h2(w.total), w.issues.map(x => x.type)], [0, ['no-in']]);
eq('…and it alerts (as a missing punch)', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(MON, '18:00') }).map(a => [a.type, a.title]), [['miss', 'Gwen clocked out without clocking in']]);
w = wk([P('gwen', 'lunch', MON, '12:00'), P('gwen', 'back', MON, '12:30'), P('gwen', 'out', MON, '17:00')], at(MON, '18:00'));
eq('went to lunch without clocking in: the afternoon counts, the morning is missing', [TCE.h2(w.total), w.issues.map(x => [x.type, x.kind])], [4.5, [['no-in', 'lunch']]]);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'out', MON, '17:00'), P('gwen', 'out', MON, '17:01')], at(MON, '18:00'));
eq('clock out pressed twice: noted, nothing to fix, no alert', [TCE.h2(w.total), w.issues.map(x => x.type), keys(w, { now: at(MON, '18:00') })], [9, ['double-out'], []]);

console.log('\n# corrections');
const late = P('gwen', 'in', THU, '08:00');
const addOut = { id: fid(), sid: 'gwen', op: 'add', kind: 'out', t: at(THU, '16:30'), why: 'Forgot to clock out', by: 'mgr', at: at(FRI, '09:00') };
w = wk([late], at(FRI, '10:00'), { fixes: [addOut] });
eq('a manager adds the missing clock-out: 8.5 h, no issue', [TCE.h2(w.total), w.issues.length], [8.5, 0]);
const wrong = P('gwen', 'in', MON, '06:50');
const fixes = [{ id: fid(), sid: 'gwen', op: 'void', ref: wrong.id, kind: '', t: 0, why: 'Clocked in at home by mistake', by: 'mgr' },
  { id: fid(), sid: 'gwen', op: 'add', kind: 'in', t: at(MON, '07:45'), why: 'Arrived 7:45', by: 'mgr' }];
w = wk([wrong, P('gwen', 'out', MON, '16:45')], at(MON, '18:00'), { fixes });
eq('a punch taken out and a new time added: 9 h', TCE.h2(w.total), 9);
eq('…the original still listed (struck through)', w.days[1].entries.map(e => [e.kind, e.src, !!e.void]), [['in', 'kiosk', true], ['in', 'fix', false], ['out', 'kiosk', false]]);
eq('…a time a manager entered isn’t an early alert', keys(w, { now: at(MON, '18:00') }).filter(k => k === 'early'), []);
const add2 = { id: fid(), sid: 'gwen', op: 'add', kind: 'out', t: at(MON, '17:00'), why: 'x', by: 'mgr' };
w = wk([P('gwen', 'in', MON, '08:00')], at(MON, '18:00'), { fixes: [add2, { id: fid(), sid: 'gwen', op: 'void', ref: add2.id, kind: '', t: 0, why: 'wrong', by: 'mgr' }] });
eq('a correction taken back counts no more', [TCE.h2(w.total), w.state], [10, 'in']);

console.log('\n# overtime and the heads-ups (workweek Sun–Sat, overtime after 40 h)');
let list = [MON, TUE, WED].flatMap(d => [P('gwen', 'in', d, '07:30'), P('gwen', 'out', d, '17:30')]); // 30 h
list.push(P('gwen', 'in', THU, '07:30'));
w = wk(list, at(THU, '13:40')); // 36.17 h
eq('Thursday 1:40 PM: 36.17 h', TCE.h2(w.total), 36.17);
eq('heads-up at 36 only (and the 10-hour days noted as long)', keys(w), ['thr', 'long', 'long', 'long']);
eq('…says when 40 h comes', /Reaches 40 h at 5:30 PM today/.test(TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '13:40') })[0].text), true);
eq('ETA to overtime 5:30 PM', TCE.timeText(w.eta.ot), '5:30 PM');
w = wk(list, at(THU, '15:45'));
eq('3:45 PM (38.25 h): the 38 h heads-up (not 36 again)', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '15:45') }).filter(a => a.type === 'thr').map(a => a.key.split('|').pop()), ['38']);
w = wk(list, at(THU, '17:45'));
eq('5:45 PM (40.25 h): overtime', keys(w).filter(k => k === 'ot').length, 1);
eq('…and no heads-ups with it', keys(w).filter(k => k === 'thr').length, 0);
eq('…regular 40, overtime 0.25', [TCE.h2(w.reg), TCE.h2(w.ot)], [40, 0.25]);
w = wk(list, at(THU, '17:45'), { approved: 44 });
eq('approved up to 44 h: no heads-ups, no overtime alert', keys(w).filter(k => ['thr', 'ot', 'otx'].includes(k)), []);
w = wk(list, at(THU, '21:45'), { approved: 44 });
eq('past the 44 h approved: alert', keys(w).includes('otx'), true);
const over = [MON, TUE, WED].flatMap(d => [P('gwen', 'in', d, '07:00'), P('gwen', 'out', d, '20:30')]).concat([P('gwen', 'in', THU, '07:30')]); // 40.5 h by Wednesday night
w = wk(over, at(THU, '08:00'));
eq('clocking in again once in overtime (not approved): a manager hears at once', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '08:00') }).filter(a => a.key.startsWith('otin|')).map(a => a.title), ['Gwen clocked in while in overtime (not approved)']);
eq('…with the hours she already had', /with 40\.5 h already this workweek; overtime starts at 40 h and isn’t approved/.test(TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '08:00') }).find(a => a.key.startsWith('otin|')).text), true);
w = wk(over, at(THU, '08:00'), { approved: 48 });
eq('…none when overtime is approved for the week', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '08:00') }).filter(a => a.key.startsWith('otin|')).length, 0);
w = wk(over, at(THU, '08:00'), { approved: 40.25 });
eq('…but past what was approved, it says so', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '08:00') }).filter(a => a.key.startsWith('otin|')).map(a => a.title), ['Gwen clocked in while in overtime (past the 40.25 h approved)']);
w = wk(list, at(THU, '13:40'), { staff: TCE.staffOf({ on: true, cap: 32 }) });
eq('a weekly cap of 32 h', keys(w).includes('cap'), true);
eq('ETA to a cap already passed is none', w.eta.cap, null);

console.log('\n# boundaries');
w = wk([P('gwen', 'in', MON, '07:12')], at(MON, '09:00'));
eq('7:12 AM is before 7:30 AM: early', w.days[1].flags.map(f => f.type), ['early']);
eq('…alert once for that punch', keys(w, { now: at(MON, '09:00') }), ['early']);
w = wk([P('gwen', 'in', MON, '07:12')], at(MON, '09:00'), { staff: TCE.staffOf({ on: true, early: '07:00' }) });
eq('her own earliest (7:00 AM) wins', w.days[1].flags.map(f => f.type), []);
w = wk([P('gwen', 'in', MON, '07:12')], at(MON, '09:00'), { set: TCE.settingsOf({ early: '' }) });
eq('no earliest set: nothing', w.days[1].flags.map(f => f.type), []);
w = wk([P('gwen', 'in', FRI, '09:02'), P('gwen', 'out', FRI, '11:00')], at(FRI, '12:00'));
eq('Friday isn’t an office day', w.days[5].flags.map(f => f.type), ['offday']);
eq('…one alert for the day', keys(w, { now: at(FRI, '12:00') }), ['off']);
const homeStaff = TCE.staffOf({ on: true, home: true, hdays: [5] });
w = wk([P('gwen', 'in', TUE, '08:05', 'home'), P('gwen', 'out', TUE, '12:00', 'home')], at(TUE, '13:00'), { staff: homeStaff });
eq('from home on Tuesday (home days: Friday)', w.days[2].flags.map(f => f.type), ['home', 'homeday']);
eq('…alerts: home and the day', keys(w, { now: at(TUE, '13:00') }).sort(), ['home', 'homeday']);
w = wk([P('gwen', 'in', TUE, '08:05', 'home')], at(TUE, '13:00'), { staff: TCE.staffOf({ on: true, home: true }) });
eq('home on any day allowed: just noted', w.days[2].flags.map(f => f.type), ['home']);
w = wk([P('gwen', 'in', MON, '08:00')], at(MON, '18:45'));
eq('still clocked in at 6:45 PM (late at 6:30) and 10.75 h: late + long', w.days[1].flags.map(f => f.type), ['late', 'long']);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'out', MON, '18:40')], at(MON, '18:45'));
eq('clocked out at 6:40: long only (no longer in)', w.days[1].flags.map(f => f.type), ['long']);
w = wk([P('gwen', 'in', THU, '08:00')], at(FRI, '09:00'));
eq('a missing clock-out alerts', keys(w, { now: at(FRI, '09:00') }), ['miss']);

console.log('\n# a shift across the start of the workweek');
w = TCE.week({ sid: 'gwen', list: TCE.entries([P('gwen', 'in', SAT, '23:00'), P('gwen', 'out', '2026-10-18', '01:00')], []), set: SET, staff: STAFF, wkIso: '2026-10-11', now: at('2026-10-18', '09:00') });
eq('Saturday night’s hour stays in its own week', TCE.h2(w.total), 1);
w = TCE.week({ sid: 'gwen', list: TCE.entries([P('gwen', 'in', SAT, '23:00'), P('gwen', 'out', '2026-10-18', '01:00')], []), set: SET, staff: STAFF, wkIso: '2026-10-18', now: at('2026-10-18', '09:00') });
eq('…and Sunday’s in the next', TCE.h2(w.total), 1);
const ws = TCE.week({ sid: 'gwen', list: TCE.entries([P('gwen', 'in', '2026-03-07', '23:00'), P('gwen', 'out', '2026-03-08', '03:30')], []), set: TCE.settingsOf({ wk: 1 }), staff: STAFF, wkIso: '2026-03-02', now: at('2026-03-09', '09:00') });
eq('the night the clocks spring forward: 3.5 real hours', TCE.h2(ws.total), 3.5);

console.log('\n# when overtime would come: only today');
w = wk([MON, TUE, WED].flatMap(d => [P('gwen', 'in', d, '08:00'), P('gwen', 'out', d, '16:00')]).concat([P('gwen', 'in', THU, '20:00')]), at(THU, '21:00')); // 25 h at 9 PM
eq('15 hours to go at 9 PM: no time given (it would be tomorrow)', w.eta.ot, null);
w = wk([MON, TUE, WED].flatMap(d => [P('gwen', 'in', d, '07:00'), P('gwen', 'out', d, '18:00')]).concat([P('gwen', 'in', THU, '07:00')]), at(THU, '13:00')); // 39 h at 1 PM
eq('1 hour to go at 1 PM: 2:00 PM', TCE.timeText(w.eta.ot), '2:00 PM');
w = wk([P('gwen', 'in', TUE, '08:00'), P('gwen', 'lunch', TUE, '12:00'), P('gwen', 'back', TUE, '12:30')], at(WED, '09:00'));
const miss = TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(WED, '09:00') }).find(a => a.type === 'miss');
eq('a clock-out missing after lunch: says she came back from lunch', /Gwen came back from lunch at 12:30 PM on Tuesday/.test(miss.text) && /the time after lunch counts 0 hours/.test(miss.text), true);
eq('…the morning still counts', TCE.h2(w.total), 4);

console.log('\n# asking a manager to fix their time');
const ask = (ps, note, st, atMs) => ({ id: 'r' + String(++n).padStart(24, '0'), sid: 'gwen', ps, note: note || '', src: 'kiosk', at: atMs || at(THU, '12:02'), st: st || 'open' });
const forgotIn = ask([{ k: 'in', t: at(THU, '07:55') }], 'Got here at 7:55 and forgot');
let base = TCE.entries([P('gwen', 'lunch', THU, '12:05')], []);
w = TCE.week({ sid: 'gwen', list: base, set: SET, staff: STAFF, wkIso: TCE.weekOf(THU, 0), now: at(THU, '12:10') });
let wp = TCE.week({ sid: 'gwen', list: TCE.withReqs(base, [forgotIn]), set: SET, staff: STAFF, wkIso: TCE.weekOf(THU, 0), now: at(THU, '12:10') });
eq('forgot to clock in, asked for 7:55, went to lunch: her own screens see lunch', [wp.state, wp.issues.length], ['lunch', 0]);
eq('…but nothing counts until a manager approves it', [w.state, TCE.h2(w.total), w.issues.map(x => x.type)], ['out', 0, ['no-in']]);
eq('…and the missing clock-in doesn’t alert: her request does', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '12:10'), asks: [forgotIn] }).map(a => a.type), []);
eq('…unless the request isn’t waiting any more', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '12:10'), asks: [Object.assign({}, forgotIn, { st: 'no' })] }).map(a => a.type), ['miss']);
wp = TCE.week({ sid: 'gwen', list: TCE.withReqs(TCE.entries([], []), [forgotIn]), set: SET, staff: STAFF, wkIso: TCE.weekOf(THU, 0), now: at(THU, '12:10') });
eq('asked for a clock-in only: in since 7:55, marked as asked', [wp.state, TCE.timeText(wp.since), wp.src], ['in', '7:55 AM', 'req']);
eq('a request someone took back, or one answered, adds nothing', TCE.withReqs([], [ask([{ k: 'in', t: at(THU, '07:55') }], '', 'x'), ask([{ k: 'in', t: at(THU, '07:55') }], '', 'ok')]).length, 0);
eq('approved: the punch is a correction like any other (7:55 to 12:05 = 4.17 h)', TCE.h2(TCE.week({ sid: 'gwen', list: TCE.entries([P('gwen', 'lunch', THU, '12:05')], [{ id: fid(), sid: 'gwen', op: 'add', kind: 'in', t: at(THU, '07:55'), why: 'Asked by Gwen at the time clock', by: 'mgr' }]), set: SET, staff: STAFF, wkIso: TCE.weekOf(THU, 0), now: at(THU, '12:10') }).total), 4.17);
eq('what was asked for, in words', TCE.reqText(forgotIn), 'Clock in 7:55 AM, Thu, Oct 15');
eq('…a lunch (in time order)', TCE.reqText(ask([{ k: 'back', t: at(THU, '12:30') }, { k: 'lunch', t: at(THU, '12:00') }])), 'Out to lunch 12:00 PM and back from lunch 12:30 PM, Thu, Oct 15');
eq('…a note asks for no punch', TCE.reqText(ask([], 'Stayed late')), '');
const ra = TCE.reqAlert(forgotIn, 'Gwen');
eq('the alert: once per request, who, what, the note', [ra.key, ra.type, ra.title, /asked at the time clock \(12:02 PM on Thu, Oct 15\) for a punch they missed: Clock in 7:55 AM, Thu, Oct 15\. Note: “Got here at 7:55 and forgot”\./.test(ra.text)], ['req|' + forgotIn.id, 'req', 'Gwen asked for a missed punch', true]);
eq('…a note', TCE.reqAlert(ask([], 'Left at 1 for the dentist'), 'Gwen').title, 'Gwen left a note for the managers');
eq('requests go by email and push unless Dr. A picks', TCE.ROUTE.req, 3);
eq('a missing clock-out she asked for doesn’t alert either', TCE.alertsFor(wk([P('gwen', 'in', WED, '08:00')], at(THU, '09:00')), { name: 'Gwen', set: SET, now: at(THU, '09:00'), asks: [ask([{ k: 'out', t: at(WED, '17:00') }])] }).map(a => a.type), []);

console.log('\n# salaried: the hours kept for the record');
const SAL = TCE.staffOf({ on: true, home: true, sal: true, cap: 30 });
list = [MON, TUE, WED, THU].flatMap(d => [P('gwen', 'in', d, '07:00', 'home'), P('gwen', 'out', d, '18:30', 'home')]); // 46 h, from home, before 7:30, late
w = wk(list, at(THU, '18:45'), { staff: SAL });
eq('46 h counted, none of it overtime', [TCE.h2(w.total), TCE.h2(w.reg), TCE.h2(w.ot), w.sal], [46, 46, 0, true]);
eq('…no heads-ups, overtime, cap, early, home or long-shift alerts', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '18:45'), staff: SAL }).map(a => a.type), []);
eq('…no time given for overtime', w.eta, { ot: null, approved: null, cap: null });
w = wk([P('gwen', 'in', WED, '08:00', 'home')], at(THU, '09:00'), { staff: SAL });
eq('…but a missing clock-out still alerts (the record would be incomplete)', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(THU, '09:00'), staff: SAL }).map(a => a.type), ['miss']);
const pws = TCE.payWeeks(TCE.entries(list, []), SET, SAL, '2026-10-11', '2026-10-24', at('2026-10-24', '12:00'));
eq('…payroll: all regular hours', pws.map(x => [TCE.h2(x.reg), TCE.h2(x.ot)]), [[46, 0], [0, 0]]);

console.log('\n# settings stored badly are made sensible');
const s2 = TCE.settingsOf({ wk: 9, ot: 'x', thr: [38, 50, -1, 36], early: '7:30', late: '18:30', brk: 25.5, days: [1, 1, 9, 4] });
eq('defaults where wrong, thresholds below overtime, sorted', [s2.wk, s2.ot, s2.thr, s2.early, s2.late, s2.brk, s2.days], [0, 40, [36, 38], '07:30', '18:30', 20, [1, 4]]);
eq('a person with nothing set', TCE.staffOf(null), { on: false, home: false, hdays: [], early: '', cap: 0, sal: false, pin: false });

console.log('\n# payroll (two workweeks)');
list = [MON, TUE, WED, THU].flatMap(d => [P('gwen', 'in', d, '07:30'), P('gwen', 'out', d, '18:00')]); // 42 h
const nextMon = '2026-10-19';
list = list.concat([P('gwen', 'in', nextMon, '08:00'), P('gwen', 'out', nextMon, '16:30')]);
const pw = TCE.payWeeks(TCE.entries(list, []), SET, STAFF, '2026-10-11', '2026-10-24', at('2026-10-24', '12:00'));
eq('week 1: 40 regular + 2 overtime; week 2: 8.5 regular', pw.map(x => [x.wkIso, TCE.h2(x.reg), TCE.h2(x.ot), x.partial]), [['2026-10-11', 40, 2, false], ['2026-10-18', 8.5, 0, false]]);
eq('pay period from an anchor', TCE.payPeriodOf('2026-10-20', '2026-09-27'), ['2026-10-11', '2026-10-24']);
eq('pay period before the anchor', TCE.payPeriodOf('2026-09-20', '2026-09-27'), ['2026-09-13', '2026-09-26']);
const half = TCE.payWeeks(TCE.entries(list, []), SET, STAFF, '2026-10-14', '2026-10-27', at('2026-10-24', '12:00'));
eq('a period that doesn’t start on the workweek’s first day marks those weeks partial', half.map(x => x.partial), [true, false, true]);

console.log('\n# a workweek split between two pay periods (periods Friday to Thursday, workweek Sunday to Saturday)');
const split = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].flatMap(d => [P('gwen', 'in', d, '07:30'), P('gwen', 'out', d, '18:00')]); // 42 h Mon–Thu
const pA = TCE.payPeriod(TCE.entries(split, []), SET, STAFF, '2026-10-09', '2026-10-22', at('2026-11-06', '09:00'));
const pB = TCE.payPeriod(TCE.entries(split, []), SET, STAFF, '2026-10-23', '2026-11-05', at('2026-11-06', '09:00'));
eq('the period with the hours: 40 regular + 2 overtime', [TCE.h2(pA.reg), TCE.h2(pA.ot)], [40, 2]);
eq('…the next period pays nothing more for that week', [TCE.h2(pB.reg), TCE.h2(pB.ot)], [0, 0]);
const split2 = split.concat([P('gwen', 'in', '2026-10-23', '08:00'), P('gwen', 'out', '2026-10-23', '12:00')]); // + Friday 4 h (next period)
const pB2 = TCE.payPeriod(TCE.entries(split2, []), SET, STAFF, '2026-10-23', '2026-11-05', at('2026-11-06', '09:00'));
eq('Friday’s 4 h, past 40 for the week, are overtime in the next period', [TCE.h2(pB2.reg), TCE.h2(pB2.ot)], [0, 4]);

console.log('\n# lunch, then clock out hours later (forgot Back?)');
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'out', MON, '17:00')], at(MON, '18:00'));
eq('flagged, the afternoon not counted', [TCE.h2(w.total), w.issues.map(x => x.type)], [4, ['lunch-out']]);
eq('…and it alerts', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(MON, '18:00') }).map(a => a.title), ['Gwen clocked out from lunch']);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'out', MON, '12:20')], at(MON, '18:00'));
eq('left at lunch (out 20 minutes after): nothing to fix', w.issues.length, 0);
w = wk([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'out', MON, '17:00')], at(MON, '18:00'));
eq('…no alert when she asked for her Back from lunch', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(MON, '18:00'), asks: [{ id: 'r1', sid: 'gwen', st: 'open', ps: [{ k: 'back', t: at(MON, '12:30') }] }] }).length, 0);
w = wk([P('gwen', 'out', MON, '07:00')], at(MON, '08:00'), { fixes: [{ id: fid(), sid: 'gwen', op: 'add', kind: 'in', t: at(MON, '08:30'), why: 'starts 8:30', by: 'mgr' }] });
eq('a clock-in added a little ahead of now: open, not a missing clock-out', [w.state, w.issues.filter(x => x.type === 'missing-out').length, TCE.h2(w.total)], ['in', 0, 0]);

console.log('\n# the office lock: where a punch came from');
const PN = (kind, iso, hm, src, net, by) => Object.assign(P('gwen', kind, iso, hm, src), { net, by: by || 'dev1' });
let es = TCE.entries([PN('in', MON, '08:00', 'laptop', 'off', 'lap1'), PN('out', MON, '12:00', 'laptop', 'office', 'lap1'), PN('in', MON, '13:00', 'own', 'office', 'u1'), PN('out', MON, '17:00', 'kiosk', 'unk', 'k1'), P('gwen', 'in', TUE, '08:00', 'home')], []);
eq('a laptop away from the office is Home; at the office it isn’t', es.slice(0, 2).map(e => e.src + '/' + e.via + '/' + e.net), ['home/laptop/off', 'kiosk/laptop/office']);
eq('their own phone at the office; the time clock, unchecked', es.slice(2, 4).map(e => e.src + '/' + e.via + '/' + e.net + '/' + e.dev), ['kiosk/own/office/u1', 'kiosk/clock/unk/k1']);
eq('an older home punch is still Home', [es[4].src, es[4].via], ['home', 'own']);
eq('a punch that says nothing about the network: not checked', TCE.entries([P('gwen', 'in', MON, '08:00')], [])[0].net, '');
eq('the settings: the lock and the office check’s address', [SET.lock, SET.wurl, TCE.settingsOf({ lock: true, wurl: 'https://nlo-office-check.amir.workers.dev' }).wurl], [false, '', 'https://nlo-office-check.amir.workers.dev']);
eq('…not an address off workers.dev', [TCE.settingsOf({ wurl: 'https://evil.example.com' }).wurl, TCE.settingsOf({ wurl: 'http://x.y.workers.dev' }).wurl, TCE.settingsOf({ lock: 'yes' }).lock], ['', '', false]);
w = wk([PN('in', MON, '07:50', 'kiosk', 'off', 'k1'), PN('lunch', MON, '12:00', 'kiosk', 'off', 'k1'), PN('back', MON, '12:30', 'kiosk', 'office', 'k1'), PN('out', MON, '17:00', 'kiosk', 'unk', 'k1')], at(MON, '18:00'));
eq('the time clock off the office network is flagged (and unchecked, separately)', w.days[1].flags.map(f => f.type + (f.n ? ':' + f.n : '')), ['offnet:2', 'nonet:1']);
let al = TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(MON, '18:00') }).filter(a => a.type === 'net');
eq('…one alert a day for each person, off the network and couldn’t check each (keys: sent once)', al.map(a => a.key), ['net|gwen|' + MON, 'netx|gwen|' + MON]);
{
  const wk2 = wk([Object.assign(P('kim', 'in', MON, '08:10'), { net: 'off', by: 'k1' })], at(MON, '18:00'), { sid: 'kim' });
  const al2 = TCE.alertsFor(wk2, { name: 'Kim', set: SET, now: at(MON, '18:00') }).filter(a => a.type === 'net');
  eq('…a coworker at the same time clock that day gets her own (each punch off the network is seen)', al2.map(a => a.key), ['net|kim|' + MON]);
}
yes('…saying who, when, and what to do', /Gwen clocked in at 7:50 AM .* at the time-clock computer while it wasn’t on the office network.*Settings → Office network/.test(al[0].text) && al[0].title === 'The time clock is off the office network');
w = wk([PN('in', MON, '08:00', 'laptop', 'off', 'lap1'), PN('out', MON, '12:00', 'laptop', 'off', 'lap1')], at(MON, '18:00'));
eq('a laptop away from the office: Home, not “off the network”', w.days[1].flags.map(f => f.type), ['home']);
eq('…and its home alert', TCE.alertsFor(w, { name: 'Gwen', set: SET, now: at(MON, '18:00') }).map(a => a.type), ['home']);
w = wk([PN('in', MON, '08:00', 'laptop', 'off', 'lap1')], at(MON, '09:00'), { staff: TCE.staffOf({ on: true, home: true, hdays: [2, 4] }) });
eq('…on a day that isn’t one of her home days: flagged', w.days[1].flags.map(f => f.type), ['home', 'homeday']);
w = wk([PN('in', MON, '08:00', 'own', 'office', 'u1'), PN('out', MON, '16:00', 'laptop', 'office', 'lap1')], at(MON, '18:00'));
eq('her phone and a laptop at the office: nothing to flag', w.days[1].flags.map(f => f.type), []);
yes('the network alert is on the alert list (email and push)', TCE.ALERTS.some(a => a[0] === 'net') && TCE.ROUTE.net === 3);

console.log('\n# forgot to clock out one day, and to clock in the next');
w = wk([P('gwen', 'in', WED, '08:00'), P('gwen', 'out', THU, '17:00')], at(THU, '18:00'));
eq('not one 33-hour shift: both flagged, nothing counted until fixed', [TCE.h2(w.total), w.issues.map(x => x.type)], [0, ['missing-out', 'no-in']]);
w = wk([P('gwen', 'in', MON, '20:00'), P('gwen', 'out', TUE, '01:00')], at(TUE, '09:00'));
eq('…a late shift past midnight still pairs', [TCE.h2(w.total), w.issues.length], [5, 0]);

{
  // lunch Monday, never back; a clock-out Tuesday with no clock-in: not "out from lunch 29 hours later"
  const tl = TCE.timeline(TCE.entries([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'out', TUE, '17:00')], []), at(WED, '09:00'));
  eq('never back from lunch one day, a clock-out with no clock-in the next', tl.issues.map(i => [i.type, i.day]), [['no-return', MON], ['no-in', TUE]]);
}
console.log('\n# Paychex: the punch detail import');
const pxList = [
  P('gwen', 'in', MON, '07:58'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'back', MON, '12:30'), P('gwen', 'out', MON, '17:02'),
  P('gwen', 'in', TUE, '08:00'), P('gwen', 'out', TUE, '10:00'), P('gwen', 'in', TUE, '10:10'), P('gwen', 'lunch', TUE, '12:00'), P('gwen', 'back', TUE, '12:30'), P('gwen', 'out', TUE, '16:00'),
  P('gwen', 'in', WED, '08:00'),
  P('gwen', 'in', THU, '08:00'), P('gwen', 'out', THU, '13:00')];
const pxp = TCE.paychexLines(TCE.entries(pxList, []), SET, '2026-10-11', '2026-10-24', at('2026-10-23', '07:00'));
eq('a line a day with up to two pairs; a paid 10-minute break in the hours; a third pair on a line of its own', pxp.lines.map(l => [l.day, l.pairs.length, TCE.h2(l.ms)]), [[MON, 2, 8.57], [TUE, 2, 4], [TUE, 1, 3.5], [THU, 1, 5]]);
eq('…the day with no clock-out is left out, to fix first', pxp.fix, [WED]);
const pxc = TCE.paychexCsv('00123456', [{ wid: 'E104', lines: pxp.lines }]).split('\r\n');
eq('the header row, exactly as Paychex names the columns', pxc[0], 'Company ID,Worker ID,Punch/Apply Date,Punch Type 1,Punch Time 1,Punch Type 2,Punch Time 2,Punch Type 3,Punch Time 3,Punch Type 4,Punch Time 4,Check Seq Number,Total Hours');
eq('a day with lunch', pxc[1], '00123456,E104,10/12/2026,Clock In,07:58AM,Start Meal,12:00PM,End Meal,12:30PM,Clock Out,05:02PM,,8.57');
eq('two pairs, then the third on the next line', [pxc[2], pxc[3]], ['00123456,E104,10/13/2026,Clock In,08:00AM,Clock Out,10:00AM,Clock In,10:10AM,Start Meal,12:00PM,,4.00', '00123456,E104,10/13/2026,End Meal,12:30PM,Clock Out,04:00PM,,,,,,3.50']);
eq('…a line for every day worked, and the file ends with a line break (nothing before the header)', [pxc.length, pxc[4], pxc[5], pxc[0].charCodeAt(0)], [6, '00123456,E104,10/15/2026,Clock In,08:00AM,Clock Out,01:00PM,,,,,,5.00', '', 67]);
const pxFix = TCE.paychexLines(TCE.entries(pxList, [{ id: fid(), sid: 'gwen', op: 'add', ref: '', kind: 'out', t: at(WED, '16:30'), why: 'forgot', by: 'mgr' }]), SET, '2026-10-11', '2026-10-24', at('2026-10-23', '07:00'));
eq('once a manager adds the clock-out, that day is in', [pxFix.fix, pxFix.lines.filter(l => l.day === WED).map(l => TCE.h2(l.ms))], [[], [8.5]]);
const pxLate = TCE.paychexLines(TCE.entries([P('gwen', 'in', MON, '08:00'), P('gwen', 'lunch', MON, '12:00'), P('gwen', 'out', MON, '17:00')], []), SET, '2026-10-11', '2026-10-24', at('2026-10-23', '07:00'));
eq('out from lunch hours later (no Back): the morning is in, the day is to fix', [pxLate.lines.map(l => TCE.h2(l.ms)), pxLate.fix], [[4], [MON]]);
{
  const now = at(TUE, '14:00'), mk = l => TCE.paychexLines(TCE.entries(l, []), SET, '2026-10-11', '2026-10-24', now);
  const inNow = mk([P('gwen', 'in', MON, '08:00'), P('gwen', 'out', MON, '16:00'), P('gwen', 'in', TUE, '08:00'), P('gwen', 'lunch', TUE, '12:00'), P('gwen', 'back', TUE, '12:30')]);
  eq('clocked in right now: today’s morning is in, the rest of today isn’t over (not a day to fix)', [inNow.lines.map(l => [l.day, TCE.h2(l.ms)]), inNow.fix, inNow.open], [[[MON, 8], [TUE, 4]], [], [TUE]]);
  const atLunch = mk([P('gwen', 'in', TUE, '08:00'), P('gwen', 'lunch', TUE, '12:00')]);
  eq('…and at lunch right now', [atLunch.lines.map(l => [l.day, TCE.h2(l.ms)]), atLunch.fix, atLunch.open], [[[TUE, 4]], [], [TUE]]);
}
{
  const fixed = TCE.entries(pxList, [{ id: fid(), sid: 'gwen', op: 'add', ref: '', kind: 'out', t: at(WED, '16:30'), why: 'forgot', by: 'mgr' }]);
  const pp = TCE.payPeriod(fixed, SET, STAFF, '2026-10-11', '2026-10-24', at('2026-10-23', '07:00'));
  const fl = TCE.paychexLines(fixed, SET, '2026-10-11', '2026-10-24', at('2026-10-23', '07:00'));
  eq('the file’s hours add up to the Payroll page’s total for the period', TCE.h2(fl.lines.reduce((n, l) => n + l.ms, 0)), TCE.h2(pp.reg + pp.ot));
}
eq('each line’s hours add up to the total rounded once (three 20-minute pairs: 1.00, not 0.99)', [TCE.pxHundredths([20 * MIN, 20 * MIN, 20 * MIN]), TCE.pxHundredths([8 * H + 34 * MIN, 0]), TCE.pxHundredths([])], [[34, 33, 33], [857, 0], []]);
{
  // weeks of 38 h 20 min and 42 h 20 min: 78.33 regular + 2.33 overtime are paid (80.66), not 80 h 40 min rounded (80.67)
  const ls = [], add = (ms, n) => { for (let i = 0; i < n; i++) ls.push({ ms }); };
  add(8 * H + 4 * MIN, 10);
  const reg = 78 * H + 20 * MIN, ot = 2 * H + 20 * MIN, w = TCE.pxWant(ls, reg, ot), hs = TCE.pxHundredths(ls.map(l => l.ms), w);
  eq('the lines add up to the hours paid: regular and overtime, each rounded as entered (80.66, not 80.67)', [w, hs.reduce((n, x) => n + x, 0), hs.every(x => x === 806 || x === 807)], [8066, 8066, true]);
  eq('…only when the lines hold all of the time paid (someone on the clock now: their own total)', TCE.pxWant(ls.slice(1), reg, ot), undefined);
  eq('…and a total the lines can’t reach a hundredth each is ignored', TCE.pxHundredths([20 * MIN, 20 * MIN, 20 * MIN], 105), [34, 33, 33]);
}
{
  const t = l => ({ day: MON, pairs: [{ a: at(MON, l[0]), b: at(MON, l[1]), ak: 'in', bk: 'out' }], ms: at(MON, l[1]) - at(MON, l[0]) });
  const rows = TCE.paychexCsv('1234', [{ wid: '7', lines: [t(['08:00', '08:20']), t(['09:00', '09:20']), t(['10:00', '10:20'])] }]).split('\r\n').slice(1, 4);
  eq('…and so in the file (Paychex adds the lines up for the check stub)', rows.map(r => r.split(',').pop()), ['0.34', '0.33', '0.33']);
}
eq('Paychex IDs: up to 8 (company) and 10 (worker) letters or digits', [TCE.pxCidOk('00123456'), TCE.pxCidOk('123456789'), TCE.pxCidOk(''), TCE.pxWidOk('E104'), TCE.pxWidOk('E-104'), TCE.pxWidOk('12345678901'), TCE.pxWidOk(null)], [true, false, false, true, false, false, false]);
eq('times as Paychex reads them (noon, midnight, afternoon)', [TCE.pxTime(at(MON, '12:05')), TCE.pxTime(at(MON, '00:15')), TCE.pxTime(at(MON, '13:40'))], ['12:05PM', '12:15AM', '01:40PM']);

console.log('\n# small things the page uses');
eq('a laptop asking to be approved says what it is', [devText('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'),
  devText('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'),
  devText('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0'),
  devText('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'), devText('')],
  ['Chrome on Windows', 'Safari on a Mac', 'Edge on Windows', 'Chrome on a Chromebook', 'A browser']);
{
  const seen = new Set(); let lo = 9, hi = 0;
  for (let i = 0; i < 4000; i++) { const x = randInt(10); seen.add(x); lo = Math.min(lo, x); hi = Math.max(hi, x); }
  eq('a random whole number stays in range (the laptop’s code: 100000 + one under 900000)', [lo, hi, seen.size], [0, 9, 10]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
