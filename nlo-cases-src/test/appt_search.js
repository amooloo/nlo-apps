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
is(D, 'in 2 weeks', '2026-11-09', '2026-11-15', 'in 2 weeks'); is(D, 'in two weeks', '2026-11-09', '2026-11-15'); is(D, 'in a week', '2026-11-02', '2026-11-08', 'in 1 week');
is(D, 'in 3 days', '2026-11-02', null, 'in 3 days'); is(D, '3 days from now', '2026-11-02'); is(D, 'in one day', '2026-10-31', null, 'in 1 day');
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
isr(D, 'thursday 2pm', '2026-11-05', null, '2pm'); isr(D, 'next week sometime', '2026-11-02', '2026-11-08', 'sometime'); isr(D, 'november 30-31', '2026-11-01', '2026-11-30', '30-31');
check(T.apptQuery('next week', D).rest === '' && T.apptQuery('thursday', D).rest === '', 'a day on its own has no other words');

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
