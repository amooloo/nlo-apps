// The search box read as an appointment day (Amir, 30 Oct 2026: "add to the search on the top to be able to search by appointment
// day. so if I want to know cases needing delivery next week. I can do that or on thursday. etc."). No browser: src/core.js in a
// sandbox, apptQuery / apptQueryText against fixed days, with every expected day worked out by hand.
//   node test/appt_search.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const ctx = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob, console, URL, ADMIN_ACTS: {}, window: {}, localStorage: { getItem: () => null, setItem: () => { } } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8'), ctx, { filename: 'core.js' });
const T = vm.runInContext('({ apptQuery, apptQueryText })', ctx);
const fmt = r => r ? r.from + (r.to !== r.from ? '..' + r.to : '') + (r.what ? ' (' + r.what + ')' : '') : 'null';
// q on `today` reads as from..to (one day when `to` is left out); `what`, when given, is how it says it read it
const is = (today, q, from, to, what) => {
  const r = T.apptQuery(q, today), want = from ? { from, to: to || from } : null;
  const ok = want ? !!r && r.from === want.from && r.to === want.to && (what === undefined || r.what === what) : r === null;
  check(ok, '“' + q + '” → ' + (want ? want.from + (want.to !== want.from ? '..' + want.to : '') + (what ? ' (' + what + ')' : '') : 'not a day') + (ok ? '' : '   got ' + fmt(r)));
};

console.log('\n# Friday, Oct 30, 2026 (weeks run Monday to Sunday: this week is Oct 26 – Nov 1)');
let D = '2026-10-30';
is(D, 'today', '2026-10-30', null, 'today'); is(D, 'Today', '2026-10-30'); is(D, 'tonight', '2026-10-30');
is(D, 'tomorrow', '2026-10-31', null, 'tomorrow'); is(D, 'tmrw', '2026-10-31'); is(D, 'tommorow', '2026-10-31');
is(D, 'yesterday', '2026-10-29', null, 'yesterday'); is(D, 'the day after tomorrow', '2026-11-01', null, 'the day after tomorrow');
is(D, 'thursday', '2026-11-05', null, ''); is(D, 'Thursday', '2026-11-05'); is(D, 'thu', '2026-11-05'); is(D, 'thur', '2026-11-05'); is(D, 'thurs', '2026-11-05');
is(D, 'this thursday', '2026-11-05'); is(D, 'coming Thursday', '2026-11-05');
is(D, 'next thursday', '2026-11-05', null, 'next Thursday'); is(D, 'last thursday', '2026-10-29', null, 'last Thursday');
is(D, 'friday', '2026-10-30'); is(D, 'next friday', '2026-11-06'); is(D, 'last friday', '2026-10-23');
is(D, 'monday', '2026-11-02'); is(D, 'mon', '2026-11-02'); is(D, 'next monday', '2026-11-02'); is(D, 'last monday', '2026-10-26');
is(D, 'tue', '2026-11-03'); is(D, 'tues', '2026-11-03'); is(D, 'wed', '2026-11-04'); is(D, 'weds', '2026-11-04'); is(D, 'Wednesday', '2026-11-04');
is(D, 'sat', '2026-10-31'); is(D, 'sun', '2026-11-01'); is(D, 'sunday', '2026-11-01');
is(D, 'this week', '2026-10-26', '2026-11-01', 'this week'); is(D, 'next week', '2026-11-02', '2026-11-08', 'next week');
is(D, 'Next Week', '2026-11-02', '2026-11-08'); is(D, 'next wk', '2026-11-02', '2026-11-08'); is(D, 'coming week', '2026-11-02', '2026-11-08');
is(D, 'last week', '2026-10-19', '2026-10-25', 'last week'); is(D, 'the week after next', '2026-11-09', '2026-11-15', 'the week after next');
is(D, 'in 2 weeks', '2026-11-09', '2026-11-15', 'in 2 weeks'); is(D, 'in two weeks', '2026-11-09', '2026-11-15'); is(D, 'in a week', '2026-11-02', '2026-11-08', 'in a week');
is(D, 'in 3 days', '2026-11-02', null, 'in 3 days'); is(D, '3 days from now', '2026-11-02'); is(D, 'in one day', '2026-10-31', null, 'in a day');
is(D, 'next 10 days', '2026-10-30', '2026-11-08', 'in the next 10 days'); is(D, 'in the next 7 days', '2026-10-30', '2026-11-05');
is(D, 'next two weeks', '2026-10-30', '2026-11-12', 'in the next 2 weeks'); is(D, 'within 10 days', '2026-10-30', '2026-11-08');
is(D, 'last 7 days', '2026-10-24', '2026-10-30', 'in the last 7 days'); is(D, 'past 2 weeks', '2026-10-17', '2026-10-30');
is(D, 'thursday next week', '2026-11-05'); is(D, 'next week thursday', '2026-11-05'); is(D, 'monday this week', '2026-10-26'); is(D, 'friday last week', '2026-10-23');
is(D, 'this month', '2026-10-01', '2026-10-31', 'this month'); is(D, 'next month', '2026-11-01', '2026-11-30', 'next month'); is(D, 'last month', '2026-09-01', '2026-09-30', 'last month');
console.log('  (a month by its full name: the nearest — up to six months ahead, else the one before)');
is(D, 'november', '2026-11-01', '2026-11-30', ''); is(D, 'October', '2026-10-01', '2026-10-31'); is(D, 'september', '2026-09-01', '2026-09-30');
is(D, 'january', '2027-01-01', '2027-01-31'); is(D, 'march', '2027-03-01', '2027-03-31'); is(D, 'april', '2027-04-01', '2027-04-30');
is(D, 'may', '2026-05-01', '2026-05-31'); is(D, 'june', '2026-06-01', '2026-06-30'); is(D, 'december', '2026-12-01', '2026-12-31');
is(D, 'november 2027', '2027-11-01', '2027-11-30'); is(D, 'nov 2026', '2026-11-01', '2026-11-30'); is(D, 'sept 2026', '2026-09-01', '2026-09-30');
console.log('  (dates)');
is(D, '11/5', '2026-11-05', null, ''); is(D, '11/05', '2026-11-05'); is(D, '11/5/26', '2026-11-05'); is(D, '11/5/2026', '2026-11-05'); is(D, '2026-11-05', '2026-11-05');
is(D, '11/5/27', '2027-11-05'); is(D, 'nov 5', '2026-11-05'); is(D, 'Nov. 5', '2026-11-05'); is(D, 'November 5th', '2026-11-05'); is(D, 'november 5 2026', '2026-11-05');
is(D, 'November 5, 2026', '2026-11-05'); is(D, '5 nov', '2026-11-05'); is(D, '5th of November', '2026-11-05'); is(D, 'sept 3', '2026-09-03'); is(D, 'May 4th', '2026-05-04');
is(D, 'thu 11/5', '2026-11-05'); is(D, 'Thursday, Nov 5', '2026-11-05'); is(D, 'thursday the 5th', '2026-11-05');
is(D, '10/20', '2026-10-20'); is(D, '1/15', '2027-01-15'); is(D, '4/15', '2027-04-15'); is(D, '5/1', '2026-05-01'); is(D, '12/31', '2026-12-31');
is(D, 'the 5th', '2026-11-05'); is(D, '5th', '2026-11-05'); is(D, 'the 31st', '2026-10-31'); is(D, '30th', '2026-10-30'); is(D, 'the 2nd', '2026-11-02');
console.log('  (stretches of days)');
is(D, 'monday to thursday', '2026-11-02', '2026-11-05', ''); is(D, 'from mon to thu', '2026-11-02', '2026-11-05'); is(D, 'Monday through Thursday', '2026-11-02', '2026-11-05');
is(D, 'thursday to monday', '2026-11-05', '2026-11-09'); is(D, 'today to thursday', '2026-10-30', '2026-11-05');
is(D, '11/2 - 11/6', '2026-11-02', '2026-11-06'); is(D, '11/2-11/6', '2026-11-02', '2026-11-06'); is(D, '11/2–11/6', '2026-11-02', '2026-11-06');
is(D, 'between nov 2 and nov 6', '2026-11-02', '2026-11-06'); is(D, 'nov 2 to nov 6', '2026-11-02', '2026-11-06'); is(D, '12/28 to 1/3', '2026-12-28', '2027-01-03');
is(D, 'nov 5-6', '2026-11-05', '2026-11-06'); is(D, 'Nov 5 - 6', '2026-11-05', '2026-11-06'); is(D, 'nov 5–6', '2026-11-05', '2026-11-06'); is(D, 'nov 6-5', null);
is(D, 'the week of nov 9', '2026-11-09', '2026-11-15', ''); is(D, 'week of 11/4', '2026-11-02', '2026-11-08'); is(D, 'in 2 wks', '2026-11-09', '2026-11-15'); is(D, 'next 2 wks', '2026-10-30', '2026-11-12');
is(D, '2 weeks from now', '2026-11-09', '2026-11-15'); is(D, 'week', null); is(D, 'week of', null);
console.log('  (the words around a day are left out)');
is(D, 'deliveries next week', '2026-11-02', '2026-11-08'); is(D, 'delivery appts on Thursday', '2026-11-05'); is(D, 'cases needing delivery next week', '2026-11-02', '2026-11-08');
is(D, 'appointments tomorrow', '2026-10-31'); is(D, 'due tomorrow', '2026-10-31'); is(D, "Thursday's appointments", '2026-11-05'); is(D, 'Thursday’s appts', '2026-11-05');
is(D, 'appts for 11/5', '2026-11-05'); is(D, 'delivered last week', '2026-10-19', '2026-10-25'); is(D, 'next week?', '2026-11-02', '2026-11-08'); is(D, '  next   week  ', '2026-11-02', '2026-11-08');
console.log('  (not a day: the search finds words only, as before)');
['', '   ', 'Jane', 'jan', 'nov', 'sept', 'mar', 'Monica', 'Thuy', 'Sunny', 'Tom', 'Mayra', 'oliv', 'refinement', 'TxP needed', 'Delivered', 'delivery', 'appt', 'appts', 'due',
  'next', 'week', 'month', 'last', '2026', '12', '5', '13/5', '11/31', '2/29', '0/5', 'in 0 days', 'next 0 days', 'in 400 days', 'next 500 days', 'constructor', 'toString', '__proto__',
  'T-1234', '1Z999AA10123456784', 'Avery Sample', 'x'.repeat(90)].forEach(q => is(D, q, null));

console.log('  (a day at the start or the end, with other words: they narrow it down)');
const isr = (today, q, from, to, rest) => {
  const r = T.apptQuery(q, today), ok = !!r && r.from === from && r.to === (to || from) && r.rest === rest;
  check(ok, '“' + q + '” → ' + from + (to && to !== from ? '..' + to : '') + ' with “' + rest + '”' + (ok ? '' : '   got ' + fmt(r) + (r ? ' with “' + r.rest + '”' : '')));
};
isr(D, 'oliv next week', '2026-11-02', '2026-11-08', 'oliv'); isr(D, 'Oliv cases next week', '2026-11-02', '2026-11-08', 'Oliv'); isr(D, 'retainers thursday', '2026-11-05', null, 'retainers');
isr(D, 'next week sarah', '2026-11-02', '2026-11-08', 'sarah'); isr(D, "Sarah's appts tomorrow", '2026-10-31', null, 'Sarah'); isr(D, 'avery sample 11/5', '2026-11-05', null, 'avery sample');
isr(D, 'avery, thursday', '2026-11-05', null, 'avery'); isr(D, "O'Brien's Thursday", '2026-11-05', null, "O'Brien"); isr(D, 'T-1234 tomorrow', '2026-10-31', null, 'T-1234');
isr(D, 'oliv monday to thursday', '2026-11-02', '2026-11-05', 'oliv'); isr(D, 'between nov 2 and nov 6 oliv', '2026-11-02', '2026-11-06', 'oliv'); isr(D, 'thursday 11/5 oliv', '2026-11-05', null, 'oliv');
isr(D, 'Sun Lee', '2026-11-01', null, 'Lee'); isr(D, 'Jordan Sun', '2026-11-01', null, 'Jordan'); // (names: the words still find Sun Lee and Jordan Sunderland too — matchesQ)
// (a time narrows nothing: the list shows the times; sometime, end of… narrow nothing either)
isr(D, 'thursday 2pm', '2026-11-05', null, ''); isr(D, 'Thursday at 10:30', '2026-11-05', null, '');
isr(D, 'next week sometime', '2026-11-02', '2026-11-08', ''); isr(D, 'november 30-31', '2026-11-01', '2026-11-30', '30-31');
check(T.apptQuery('next week', D).rest === '' && T.apptQuery('thursday', D).rest === '', 'a day on its own has no other words');

console.log('  (everyday phrasings — from the independent review, 30 Oct 2026)');
// sp: the days found, as from..to strings in date order (open ends as 0000-01-01 / 9999-12-31)
const isS = (today, q, sp, rest) => {
  const r = T.apptQuery(q, today), got = r ? r.spans.map(x => x.from + '..' + x.to) : null;
  const ok = !!r && JSON.stringify(got) === JSON.stringify(sp) && (rest === undefined || r.rest === rest);
  check(ok, '“' + q + '” → ' + sp.join(' + ') + (rest ? ' with “' + rest + '”' : '') + (ok ? '' : '   got ' + (got ? got.join(' + ') + ' with “' + r.rest + '”' : 'null')));
};
const d1 = x => [x + '..' + x];
isS(D, 'this coming Thursday', d1('2026-11-05'), ''); isS(D, 'this coming week', ['2026-11-02..2026-11-08'], ''); isS(D, 'this past Monday', d1('2026-10-26'), '');
isS(D, 'this past week', ['2026-10-26..2026-11-01'], ''); // (from Friday on, the past week is this one: Mon–Thu are done)
 isS(D, 'in the next week', ['2026-10-30..2026-11-05'], ''); isS(D, 'within the next week', ['2026-10-30..2026-11-05'], '');
isS(D, 'in the next month', ['2026-10-30..2026-11-28'], ''); isS(D, 'deliveries Thursday and Friday', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], '');
isS(D, '11/5 Thursday', d1('2026-11-05'), ''); isS(D, 'Nov 5 Thursday', d1('2026-11-05'), ''); isS(D, "what's due Thursday", d1('2026-11-05'), '');
isS(D, 'show me deliveries next week', ['2026-11-02..2026-11-08'], ''); isS(D, 'tomorrow morning', d1('2026-10-31'), ''); isS(D, 'Thursday afternoon', d1('2026-11-05'), '');
isS(D, 'Thursday after next', d1('2026-11-12'), ''); isS(D, 'Thursday next', d1('2026-11-05'), ''); isS(D, 'the day before yesterday', d1('2026-10-28'), '');
isS(D, 'next May', ['2027-05-01..2027-05-31']); isS(D, 'last November', ['2025-11-01..2025-11-30']); isS(D, 'this May', ['2026-05-01..2026-05-31']);
isS(D, 'next November', ['2026-11-01..2026-11-30']); isS(D, 'next October', ['2027-10-01..2027-10-31']); isS(D, 'last October', ['2025-10-01..2025-10-31']);
isS(D, 'week from today', ['2026-11-02..2026-11-08'], ''); isS(D, 'a week from today', ['2026-11-02..2026-11-08']); isS(D, 'week from tomorrow', d1('2026-11-07'));
isS(D, 'a week from Thursday', d1('2026-11-12')); isS(D, '3 days from tomorrow', d1('2026-11-03')); isS('2026-11-01', 'week from today', ['2026-11-02..2026-11-08']);
console.log('  (open at one end, lists, and the start of a weekday)');
isS(D, 'before friday', ['0000-01-01..2026-10-29'], ''); isS(D, 'after thursday', ['2026-11-06..9999-12-31'], ''); isS(D, 'by friday', ['0000-01-01..2026-10-30'], '');
isS(D, 'until Friday', ['0000-01-01..2026-10-30']); isS(D, 'before next week', ['0000-01-01..2026-11-01']); isS(D, 'oliv before friday', ['0000-01-01..2026-10-29'], 'oliv');
isS(D, 'monday or wednesday', ['2026-11-02..2026-11-02', '2026-11-04..2026-11-04']); isS(D, 'mon & wed', ['2026-11-02..2026-11-02', '2026-11-04..2026-11-04']);
isS(D, 'today and tomorrow', ['2026-10-30..2026-10-30', '2026-10-31..2026-10-31']); isS(D, 'thursday friday', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], '');
isS(D, 'monday, wednesday and thursday', ['2026-11-02..2026-11-02', '2026-11-04..2026-11-04', '2026-11-05..2026-11-05']); isS(D, 'monday to wednesday and friday', ['2026-11-02..2026-11-04', '2026-11-06..2026-11-06']);
isS(D, 'thursd', d1('2026-11-05')); isS(D, 'wednes', d1('2026-11-04')); isS(D, 'saturd', d1('2026-10-31')); isS(D, 'sunda', d1('2026-11-01')); isS(D, 'frida', d1('2026-10-30'));
isS(D, 'deliveries from Oliv next week', ['2026-11-02..2026-11-08'], 'Oliv'); isS(D, 'Thursday at 2:30pm', d1('2026-11-05'), '');
console.log('  (a day beside a word it can’t take in isn’t read as a day)');
['friday until', 'next week except oliv', 'thursday not oliv', 'after', 'before', 'by', 'next week next week', 'since monday'].forEach(q => is(D, q, null));
isS(D, 'thursday or', d1('2026-11-05'), ''); isS(D, 'monday wednesday thursday', ['2026-11-02..2026-11-02', '2026-11-04..2026-11-04', '2026-11-05..2026-11-05'], ''); // (a list as it's typed: Thursday holds)

console.log('  (the second review, 30 Oct 2026)');
// a modifier on the last or first weekday of a list goes with each (on Monday, Nov 2)
const M2 = '2026-11-02';
isS(M2, 'Thursday and Friday next week', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13'], ''); isS(M2, 'Mon and Tue next week', ['2026-11-09..2026-11-09', '2026-11-10..2026-11-10']);
isS(M2, 'Thursday and Friday after next', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13']); isS(M2, 'next week Thursday and Friday', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13']);
isS(M2, 'last Thursday and Friday', ['2026-10-29..2026-10-29', '2026-10-30..2026-10-30']);
// more days of the month after a date; spoken times
isS(D, 'Nov 5 and 6', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], ''); isS(D, '11/5 & 6', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], '');
isS(D, 'Nov 5, 6', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], ''); isS(D, 'the 5th and 6th', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], '');
isS(D, 'Thursday at 2 p.m.', d1('2026-11-05'), ''); isS(D, 'tomorrow at 10', d1('2026-10-31'), ''); isS(D, '11/5 at 10:30', d1('2026-11-05'), '');
// a day beside a day open at one end isn't guessed at
['Monday after next week', 'Thursday by next week', 'Monday before Thursday'].forEach(q => is(D, q, null));
// names: a non-standard start of a weekday is a name beside other words; a short weekday beside another day is a name
isS(M2, 'Frida Thursday', d1('2026-11-05'), 'Frida'); isS(M2, 'Frida 11/5', d1('2026-11-05'), 'Frida'); isS(M2, 'Frida next week', ['2026-11-09..2026-11-15'], 'Frida');
isS(M2, 'Sun tomorrow', d1('2026-11-03'), 'Sun'); isS(M2, 'tomorrow Sun', d1('2026-11-03'), 'Sun'); isS(M2, 'frida', d1('2026-11-06'), ''); isS(M2, 'next frid', d1('2026-11-13'), '');
isS(M2, 'monday to thursd', ['2026-11-02..2026-11-05'], ''); isS(M2, 'thu fri', ['2026-11-05..2026-11-05', '2026-11-06..2026-11-06'], '');
// words that narrow nothing; the rest of a week or month; a couple / a few; either of two words
isS(D, 'sometime next week', ['2026-11-02..2026-11-08'], ''); isS(D, 'end of next week', ['2026-11-02..2026-11-08'], ''); isS(D, 'throughout next week', ['2026-11-02..2026-11-08'], '');
isS(D, 'rest of this week', ['2026-10-30..2026-11-01'], ''); isS(D, 'rest of the month', ['2026-10-30..2026-10-31'], ''); isS(D, 'a couple of weeks from now', ['2026-11-09..2026-11-15'], '');
isS(D, 'in a couple of weeks', ['2026-11-09..2026-11-15'], ''); isS(D, 'next few days', ['2026-10-30..2026-11-01'], '');
{ const r = T.apptQuery('Oliv and Angel next week', D); check(!!r && JSON.stringify(r.restAny) === '[["Oliv"],["Angel"]]' && r.rest === 'Oliv or Angel', '“Oliv and Angel next week”: either word (' + (r && r.rest) + ')'); }
{ const r = T.apptQuery('Avery Sample tomorrow', D); check(!!r && JSON.stringify(r.restAny) === '[["Avery","Sample"]]', '“Avery Sample tomorrow”: both words of the name'); }
// the coming week is this one on a Monday; the past week this one on a Sunday; in the past week = the last 7 days
isS('2026-11-01', 'this past week', ['2026-10-26..2026-11-01'], ''); isS(M2, 'this coming week', ['2026-11-02..2026-11-08'], ''); isS(D, 'in the past week', ['2026-10-24..2026-10-30'], '');
isS('2026-11-01', 'last week', ['2026-10-19..2026-10-25']);
// list order: a later month is read on from the one before; the 1st isn't
isS(D, 'Thursday and the 1st', ['2026-11-01..2026-11-01', '2026-11-05..2026-11-05'], ''); isS('2026-06-15', 'December and January', ['2026-12-01..2026-12-31', '2027-01-01..2027-01-31'], '');
console.log('  (the third review, 30 Oct 2026)');
// short weekday pairs and runs keep their modifier (Monday, Nov 2)
isS(M2, 'Thu Fri next week', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13'], ''); isS(M2, 'Tue Thu next week', ['2026-11-10..2026-11-10', '2026-11-12..2026-11-12'], '');
isS(M2, 'Mon Wed next week', ['2026-11-09..2026-11-09', '2026-11-11..2026-11-11'], ''); isS(M2, 'thu, fri next week', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13'], '');
isS(M2, 'next week thu fri', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13'], ''); isS(M2, 'thu fri after next', ['2026-11-12..2026-11-12', '2026-11-13..2026-11-13'], '');
const mwf = ['2026-11-09..2026-11-09', '2026-11-11..2026-11-11', '2026-11-13..2026-11-13'];
isS(M2, 'Mon, Wed and Fri next week', mwf, ''); isS(M2, 'Monday, Wednesday, Friday next week', mwf, ''); isS(M2, 'next week Mon, Wed and Fri', mwf, ''); isS(M2, 'next week mon wed fri', mwf, '');
// last Thursday and Friday is a pair; so is last Monday and Tuesday on a Tuesday
isS(D, 'last Thursday and Friday', ['2026-10-29..2026-10-29', '2026-10-30..2026-10-30'], ''); isS('2026-11-03', 'last Monday and Tuesday', ['2026-11-02..2026-11-02', '2026-11-03..2026-11-03'], '');
// a number after a date: the next one after it (into the next month), only after a comma or and; a time after a weekday or tomorrow
isS(D, 'the 31st and 1st', ['2026-10-31..2026-10-31', '2026-11-01..2026-11-01'], ''); isS(D, 'Oct 31 and 1', ['2026-10-31..2026-10-31', '2026-11-01..2026-11-01'], '');
isS(D, 'Friday and the 1st', ['2026-10-30..2026-10-30', '2026-11-01..2026-11-01'], ''); isS(D, '11/30 and 1', ['2026-11-30..2026-11-30', '2026-12-01..2026-12-01'], '');
isS(D, 'Nov 30, 1', ['2026-11-30..2026-11-30', '2026-12-01..2026-12-01'], ''); isS(D, 'the 30th and 1st', ['2026-10-30..2026-10-30', '2026-11-01..2026-11-01'], '');
isS(D, 'Thursday 2', d1('2026-11-05'), ''); isS(D, 'tomorrow 3', d1('2026-10-31'), ''); isS(D, '11/5 12', d1('2026-11-05'), '12'); isS(D, 'Nov 5 6', d1('2026-11-05'), '6');
// a weekday that is that very day is a reminder; a short one that isn't is a name
const W4 = '2026-11-04';
isS(W4, 'tomorrow Thu', d1('2026-11-05'), ''); isS(W4, 'Thu tomorrow', d1('2026-11-05'), ''); isS(D, 'today Fri', d1('2026-10-30'), ''); isS(D, 'Fri today', d1('2026-10-30'), '');
isS(D, 'Sun 11/5', d1('2026-11-05'), 'Sun'); isS(D, 'Thu 11/5', d1('2026-11-05'), ''); isS(D, '11/5 Sun', d1('2026-11-05'), 'Sun');
// the past week from Friday on is this one (Saturday too)
isS('2026-10-31', 'the past week', ['2026-10-26..2026-11-01'], ''); isS('2026-10-29', 'the past week', ['2026-10-19..2026-10-25'], '');
console.log('\n# Monday, Nov 2, 2026');
D = '2026-11-02';
is(D, 'monday', '2026-11-02'); is(D, 'thursday', '2026-11-05'); is(D, 'next thursday', '2026-11-12'); is(D, 'last thursday', '2026-10-29');
is(D, 'next monday', '2026-11-09'); is(D, 'last monday', '2026-10-26'); is(D, 'sunday', '2026-11-08');
is(D, 'this week', '2026-11-02', '2026-11-08'); is(D, 'next week', '2026-11-09', '2026-11-15'); is(D, 'last week', '2026-10-26', '2026-11-01');
is(D, 'thursday next week', '2026-11-12'); is(D, 'thursday this week', '2026-11-05'); is(D, 'monday to thursday', '2026-11-02', '2026-11-05');
is(D, 'the 2nd', '2026-11-02'); is(D, 'the 1st', '2026-12-01');

console.log('\n# Sunday, Nov 1, 2026: next week starts tomorrow');
D = '2026-11-01';
is(D, 'this week', '2026-10-26', '2026-11-01'); is(D, 'next week', '2026-11-02', '2026-11-08'); is(D, 'thursday', '2026-11-05'); is(D, 'next thursday', '2026-11-05');
is(D, 'sunday', '2026-11-01'); is(D, 'last sunday', '2026-10-25'); is(D, 'tomorrow', '2026-11-02');

console.log('\n# Thursday, Dec 31, 2026: across the new year');
D = '2026-12-31';
is(D, 'tomorrow', '2027-01-01'); is(D, 'next week', '2027-01-04', '2027-01-10'); is(D, 'this week', '2026-12-28', '2027-01-03'); is(D, 'next month', '2027-01-01', '2027-01-31');
is(D, '1/5', '2027-01-05'); is(D, 'january', '2027-01-01', '2027-01-31'); is(D, 'december', '2026-12-01', '2026-12-31'); is(D, 'jan 4', '2027-01-04');
is(D, 'thursday', '2026-12-31'); is(D, 'next thursday', '2027-01-07'); is(D, 'the 2nd', '2027-01-02'); is(D, '12/30 to 1/2', '2026-12-30', '2027-01-02');

console.log('\n# Leap years and short months');
is('2028-02-28', '2/29', '2028-02-29'); is('2028-02-28', 'the 29th', '2028-02-29'); is('2028-02-28', 'the 30th', '2028-03-30'); is('2028-02-28', 'feb 29', '2028-02-29');
is('2028-02-28', 'this month', '2028-02-01', '2028-02-29'); is('2027-02-10', 'this month', '2027-02-01', '2027-02-28'); is('2027-02-10', '2/29/2028', '2028-02-29');
is('2027-02-10', '2/29/2027', null); is('2027-01-31', 'the 31st', '2027-01-31'); is('2027-01-31', 'the 30th', '2027-03-30'); is('2027-01-31', 'next month', '2027-02-01', '2027-02-28');
is('2026-03-31', 'last month', '2026-02-01', '2026-02-28'); is('2026-03-31', 'in 1 week', '2026-04-06', '2026-04-12');

console.log('\n# How it reads under the search box');
const txt = (q, today, want) => { const r = T.apptQuery(q, today), got = r ? T.apptQueryText(r, today) : ''; check(got === want, '“' + q + '” reads “Delivery appts ' + want + '”' + (got === want ? '' : '   got “' + got + '”')); };
D = '2026-10-30';
txt('today', D, 'today · Fri, Oct 30'); txt('tomorrow', D, 'tomorrow · Sat, Oct 31'); txt('thursday', D, 'Thu, Nov 5'); txt('next thursday', D, 'next Thursday · Thu, Nov 5');
txt('next week', D, 'next week · Mon, Nov 2 – Sun, Nov 8'); txt('this week', D, 'this week · Mon, Oct 26 – Sun, Nov 1'); txt('11/5', D, 'Thu, Nov 5');
txt('november', D, 'in November'); txt('january', D, 'in January 2027'); txt('this month', D, 'this month · October'); txt('next 10 days', D, 'in the next 10 days · Fri, Oct 30 – Sun, Nov 8');
txt('monday to thursday', D, 'Mon, Nov 2 – Thu, Nov 5'); txt('1/15', D, 'Fri, Jan 15, 2027'); txt('in 2 weeks', D, 'in 2 weeks · Mon, Nov 9 – Sun, Nov 15');
txt('next week', '2026-12-31', 'next week · Mon, Jan 4, 2027 – Sun, Jan 10, 2027');
txt('thursday and friday', D, 'Thu, Nov 5 and Fri, Nov 6'); txt('monday, wednesday and thursday', D, 'Mon, Nov 2, Wed, Nov 4 and Thu, Nov 5');
txt('before friday', D, 'before Fri, Oct 30'); txt('after thursday', D, 'after Thu, Nov 5'); txt('by friday', D, 'by Fri, Oct 30');
txt('in the next week', D, 'in the next 7 days · Fri, Oct 30 – Thu, Nov 5'); txt('week from today', D, 'in a week · Mon, Nov 2 – Sun, Nov 8');
txt('Thursday after next', D, 'Thursday after next · Thu, Nov 12'); txt('next May', D, 'in May 2027');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
