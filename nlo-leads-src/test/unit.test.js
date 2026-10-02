/* Lead rules, tested on their own: office days, the five-attempt plan, logging/undo, duplicates, Asana import, results.
   Every name, phone and email below is made up. Run: node test/unit.test.js */
const assert = require('assert');
const { load } = require('./load');
const L = load(['core.js', 'leads.js']);
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n').slice(0, 4).join('\n       ') : e)); } }
// the app's code runs in a separate sandbox (its arrays have another prototype), so compare as plain JSON
const plain = x => x === undefined ? 'undefined' : JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const CFG = L.leadCfg({});
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 10, mi || 0).getTime();
const dues = l => l.steps.map(s => s.skip ? s.skip : s.doneAt ? 'done' : s.due);
const strip = l => JSON.parse(JSON.stringify(l, (k, v) => k === 'undo' ? undefined : v));
function fresh(over, receivedMs) {
  const l = Object.assign(L.blankLead(), { name: 'Pat Example', parent: 'Pam Example', phone: '352-555-0142', email: 'pam@example.com', message: 'Would like a consult' }, over || {});
  L.startLead(l, receivedMs || at(2026, 10, 5, 9), CFG); l.status = 'open'; return l;
}

console.log('\n# Office days');
t('Mon–Thu are office days, Fri–Sun are not', () => {
  eq([5, 6, 7, 8, 9, 10, 11].map(d => L.isOfficeDay('2026-10-' + String(d).padStart(2, '0'), CFG)), [true, true, true, true, false, false, false]);
});
t('Thanksgiving week: Wed, Thu and Fri are closed, so the next office day is Monday', () => {
  eq(L.nextOfficeDay('2026-11-25', CFG), '2026-11-30'); eq(L.nextOfficeDay('2026-11-24', CFG), '2026-11-24');
});
t('Christmas Day (a Friday in 2026) and New Year’s Day are skipped even if office days included Friday', () => {
  const all = L.leadCfg({ leads: { days: [1, 2, 3, 4, 5] } });
  eq(L.nextOfficeDay('2026-12-25', all), '2026-12-28'); eq(L.nextOfficeDay('2027-01-01', all), '2027-01-04');
});
t('day 0: a Friday request is worked on Monday', () => eq(L.dayZero(at(2026, 10, 2, 10), CFG), '2026-10-05'));
t('day 0: before 5 PM counts as today, from 5 PM as the next office day', () => {
  eq(L.dayZero(at(2026, 10, 5, 16, 59), CFG), '2026-10-05'); eq(L.dayZero(at(2026, 10, 5, 17, 0), CFG), '2026-10-06');
});
t('day 0: Thursday evening rolls past the weekend', () => eq(L.dayZero(at(2026, 10, 8, 19), CFG), '2026-10-12'));
t('day 0: a Sunday request is worked on Monday', () => eq(L.dayZero(at(2026, 10, 4, 12), CFG), '2026-10-05'));

console.log('\n# The five-attempt plan');
t('attempts fall on day 0, day 0, +1, +7, +14 (office days)', () => eq(dues(fresh()), ['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-12', '2026-10-19']));
t('a Thursday start rolls Friday’s call to Monday', () => eq(dues(fresh({}, at(2026, 10, 8, 9))), ['2026-10-08', '2026-10-08', '2026-10-12', '2026-10-15', '2026-10-22']));
t('contact method: call, text, call, email, call when both are on file', () => eq(fresh().steps.map(s => s.kind), ['call', 'text', 'call', 'email', 'call']));
t('no phone → everything by email', () => eq(fresh({ phone: '' }).steps.map(s => s.kind), ['email', 'email', 'email', 'email', 'email']));
t('no email → calls and texts', () => eq(fresh({ email: '' }).steps.map(s => s.kind), ['call', 'text', 'call', 'text', 'call']));
t('a bad phone number counts as no phone', () => {
  eq(L.phoneInfo('555-01').ok, false); eq(fresh({ phone: '555-01' }).steps[0].kind, 'email'); eq(fresh({ phone: '555-01', email: '' }).steps[0].kind, 'call');
});
t('changing the offsets changes the plan', () => {
  const c = L.leadCfg({ leads: { offsets: [0, 1, 2, 3, 4] } }); const l = L.blankLead(); l.phone = '352-555-0142'; L.startLead(l, at(2026, 10, 5, 9), c);
  eq(l.steps.map(s => s.due), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12']);
});
t('bad settings fall back to the defaults', () => {
  const c = L.leadCfg({ leads: { offsets: [1, 2], days: [], closeHour: 'x' } }); eq(c.offsets, [0, 0, 1, 7, 14]); eq(c.days, [1, 2, 3, 4]); eq(c.closeHour, 17);
});
t('phone numbers are read in the usual US forms', () => {
  eq(L.phoneInfo('(352) 555-0142').pretty, '352-555-0142'); eq(L.phoneInfo('+1 352.555.0142').tel, '+13525550142'); eq(L.phoneInfo('1-352-555-0142').ok, true); eq(L.phoneInfo('555-0142').ok, false);
});
t('names typed in all lower or upper case are tidied, normal ones are left alone', () => {
  eq(L.properName('maria o\'neil-smith'), 'Maria O\'Neil-Smith'); eq(L.properName('JOHN SMITH'), 'John Smith'); eq(L.properName('Jo McDonald'), 'Jo McDonald');
});
t('greeting uses the parent when there is one', () => { eq(L.leadFirst({ name: 'Pat Example', parent: 'Pam Example' }), 'Pam'); eq(L.leadFirst({ name: 'Pat Example' }), 'Pat'); eq(L.leadFirst({}), 'there'); });

console.log('\n# Logging an attempt');
t('voicemail on time: contacted, later steps stay put', () => {
  const l = fresh(); const r = L.applyResult(l, 0, 'vm', { by: 'sav' }, CFG, at(2026, 10, 5, 11));
  eq(r, null); eq(l.stage, 'contacted'); eq(dues(l), ['done', '2026-10-05', '2026-10-06', '2026-10-12', '2026-10-19']); eq(L.curStep(l), 1);
});
t('logged two days late: the rest of the plan keeps its gaps from that day', () => {
  const l = fresh(); L.applyResult(l, 0, 'none', {}, CFG, at(2026, 10, 7, 10));
  eq(dues(l), ['done', '2026-10-07', '2026-10-08', '2026-10-14', '2026-10-21']);
});
t('logged a day early: nothing moves earlier', () => {
  const l = fresh({}, at(2026, 10, 5, 9)); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 5, 9)); L.applyResult(l, 1, 'sent', {}, CFG, at(2026, 10, 5, 9));
  L.applyResult(l, 2, 'none', {}, CFG, at(2026, 10, 6, 10)); eq(dues(l), ['done', 'done', 'done', '2026-10-12', '2026-10-19']);
  L.applyResult(l, 3, 'sent', {}, CFG, at(2026, 10, 7, 10)); eq(dues(l), ['done', 'done', 'done', 'done', '2026-10-19']);
});
t('a late wave lands on office days only', () => {
  const l = fresh(); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 9, 10)); // Friday: step 2 same day → Monday
  eq(dues(l), ['done', '2026-10-12', '2026-10-12', '2026-10-19', '2026-10-26']);
});
t('appointment scheduled: remaining attempts are skipped, appointment kept', () => {
  const l = fresh(); const r = L.applyResult(l, 0, 'sched', { appt: '2026-10-14', apptTime: '09:30', note: 'Mom will bring forms' }, CFG, at(2026, 10, 5, 11));
  eq(r, null); eq(l.stage, 'scheduled'); eq(l.appt, '2026-10-14'); eq(l.apptTime, '09:30'); eq(dues(l), ['done', 'sched', 'sched', 'sched', 'sched']); eq(L.leadDue(Object.assign(l, { status: 'open' })), '');
  eq(l.steps[0].note, 'Mom will bring forms');
});
t('not interested closes the lead', () => {
  const l = fresh(); const r = L.applyResult(l, 0, 'no', {}, CFG, at(2026, 10, 5, 11));
  eq(r, 'done'); eq(l.closeWhy, 'notint'); eq(dues(l), ['done', 'closed', 'closed', 'closed', 'closed']);
});
t('follow up needed re-plans the remaining attempts from the chosen day', () => {
  const l = fresh(); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 5, 10));
  const r = L.applyResult(l, 1, 'follow', { follow: '2026-10-09' }, CFG, at(2026, 10, 5, 11)); // Friday → Monday 12th
  eq(r, null); eq(dues(l), ['done', 'done', '2026-10-12', '2026-10-19', '2026-10-26']); eq(l.stage, 'contacted');
});
t('follow up needs a day, and not one in the past', () => {
  const l = fresh(); assert.throws(() => L.applyResult(l, 0, 'follow', {}, CFG, at(2026, 10, 5, 10)), e => e.code === 'need-date');
  assert.throws(() => L.applyResult(l, 0, 'follow', { follow: '2026-10-01' }, CFG, at(2026, 10, 5, 10)), e => e.code === 'bad-date');
  eq(l.steps[0].doneAt, null, 'nothing was logged');
});
t('the last attempt without an answer closes the lead as no response', () => {
  const l = fresh(); [0, 1, 2, 3].forEach(i => L.applyResult(l, i, i % 2 ? 'sent' : 'vm', {}, CFG, at(2026, 10, 19, 10)));
  const r = L.applyResult(l, 4, 'none', {}, CFG, at(2026, 10, 19, 11)); eq(r, 'done'); eq(l.closeWhy, 'noresp');
});
t('follow up on the last attempt adds one more call and keeps the lead open', () => {
  const l = fresh(); [0, 1, 2, 3].forEach(i => L.applyResult(l, i, 'vm', {}, CFG, at(2026, 10, 19, 10)));
  const r = L.applyResult(l, 4, 'follow', { follow: '2026-10-22' }, CFG, at(2026, 10, 19, 11));
  eq(r, null); eq(l.steps.length, 6); eq(l.steps[5].extra, true); eq(l.steps[5].due, '2026-10-22'); eq(L.stepLabel(l, 5), 'Follow-up call'); eq(L.curStep(l), 5);
  const r2 = L.applyResult(l, 5, 'none', {}, CFG, at(2026, 10, 22, 10)); eq(r2, 'done'); eq(l.closeWhy, 'noresp');
});
t('a step already logged or skipped cannot be logged again', () => {
  const l = fresh(); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 5, 10));
  assert.throws(() => L.applyResult(l, 0, 'none', {}, CFG, at(2026, 10, 5, 10)), e => e.code === 'not-pending');
  const s = fresh(); L.applyResult(s, 0, 'sched', {}, CFG, at(2026, 10, 5, 10)); assert.throws(() => L.applyResult(s, 2, 'vm', {}, CFG, at(2026, 10, 5, 10)), e => e.code === 'not-pending');
});
t('an unknown result is refused', () => { const l = fresh(); assert.throws(() => L.applyResult(l, 0, 'banana', {}, CFG, at(2026, 10, 5, 10)), e => e.code === 'bad-result'); });
t('switching a message between text and email sticks, and calls cannot be switched', () => {
  const l = fresh(); L.setStepKind(l, 1, 'email'); eq(l.steps[1].kind, 'email'); L.setKinds(l); eq(l.steps[1].kind, 'email', 'kept after contact details change');
  L.setStepKind(l, 0, 'email'); eq(l.steps[0].kind, 'call');
});
t('adding a phone number later turns the email-only plan back into calls', () => {
  const l = fresh({ phone: '' }); eq(l.steps[0].kind, 'email'); l.phone = '352-555-0142'; L.setKinds(l); eq(l.steps.map(s => s.kind), ['call', 'text', 'call', 'email', 'call']);
});

console.log('\n# Undo');
const undoCases = {
  'voicemail': (l, c) => L.applyResult(l, 0, 'vm', {}, c, at(2026, 10, 7, 10)),
  'scheduled': (l, c) => L.applyResult(l, 0, 'sched', { appt: '2026-10-14' }, c, at(2026, 10, 5, 10)),
  'not interested': (l, c) => L.applyResult(l, 0, 'no', {}, c, at(2026, 10, 5, 10)),
  'follow up': (l, c) => L.applyResult(l, 0, 'follow', { follow: '2026-10-13' }, c, at(2026, 10, 5, 10))
};
Object.keys(undoCases).forEach(k => t('undo after “' + k + '” restores the lead exactly', () => {
  const l = fresh(), before = strip(l); undoCases[k](l, CFG); assert.ok(L.canUndo(l)); const st = L.undoStep(l); eq(st, 'open'); eq(strip(l), before);
}));
t('undo after the final no-answer reopens the lead and drops nothing else', () => {
  const l = fresh(); [0, 1, 2, 3].forEach(i => L.applyResult(l, i, 'vm', {}, CFG, at(2026, 10, 19, 10)));
  const before = strip(l); L.applyResult(l, 4, 'none', {}, CFG, at(2026, 10, 19, 11)); eq(l.closeWhy, 'noresp'); assert.ok(L.canUndo(l)); L.undoStep(l); eq(strip(l), before);
});
t('undo after a follow-up on the last attempt removes the added call', () => {
  const l = fresh(); [0, 1, 2, 3].forEach(i => L.applyResult(l, i, 'vm', {}, CFG, at(2026, 10, 19, 10)));
  const before = strip(l); L.applyResult(l, 4, 'follow', { follow: '2026-10-22' }, CFG, at(2026, 10, 19, 11)); eq(l.steps.length, 6); L.undoStep(l); eq(strip(l), before);
});
t('only the latest attempt can be undone, one after another', () => {
  const l = fresh(), s0 = strip(l); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 5, 10)); const s1 = strip(l); L.applyResult(l, 1, 'sent', {}, CFG, at(2026, 10, 5, 11));
  L.undoStep(l); eq(strip(l), s1); L.undoStep(l); eq(strip(l), s0); assert.strictEqual(L.canUndo(l), false);
});
t('“scheduled” closes the lead right away (as in Asana) and can still be undone right after', () => {
  const l = fresh(), before = strip(l);
  L.applyResult(l, 0, 'sched', { appt: '2026-10-14', apptTime: '09:30' }, CFG, at(2026, 10, 5, 10)); eq(L.closeLead(l, 'sched'), 'done'); eq(l.closeWhy, 'sched');
  assert.ok(L.canUndo(l)); eq(L.undoStep(l), 'open'); eq(strip(l), before);
});
t('a lead closed by hand after an attempt cannot be silently undone', () => {
  const l = fresh(); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 5, 10)); L.closeLead(l, 'other'); assert.strictEqual(L.canUndo(l), false);
});

console.log('\n# Closing, reopening, flags');
t('closing skips what is left; reopening starts the rest again from today', () => {
  const l = fresh(); L.applyResult(l, 0, 'vm', {}, CFG, at(2026, 10, 5, 10)); L.closeLead(l, 'other'); eq(dues(l), ['done', 'closed', 'closed', 'closed', 'closed']);
  L.reopenLead(l, CFG, '2026-10-14'); eq(l.closeWhy, ''); eq(dues(l), ['done', '2026-10-14', '2026-10-15', '2026-10-21', '2026-10-28']);
});
t('reopening after the plan ran out adds one new call', () => {
  const l = fresh(); [0, 1, 2, 3, 4].forEach(i => L.applyResult(l, i, 'none', {}, CFG, at(2026, 10, 19, 10))); eq(l.closeWhy, 'noresp');
  L.reopenLead(l, CFG, '2026-10-20'); eq(l.steps.length, 6); eq(l.steps[5].due, '2026-10-20'); eq(L.curStep(l), 5);
});
t('reopening a scheduled lead (no-show) makes it contacted again', () => {
  const l = fresh(); L.applyResult(l, 0, 'sched', { appt: '2026-10-08' }, CFG, at(2026, 10, 5, 10)); L.closeLead(l, 'sched');
  L.reopenLead(l, CFG, '2026-10-12'); eq(l.stage, 'contacted'); eq(l.appt, ''); eq(dues(l), ['done', '2026-10-12', '2026-10-13', '2026-10-19', '2026-10-26']);
});
t('a flagged lead hides its steps until the flag is cleared; clearing late restarts overdue steps today', () => {
  const l = fresh(); l.flag = 'check'; l.flagWhy = 'x'; eq(L.leadDue(l), '');
  L.clearFlag(l, CFG, '2026-10-13'); eq(l.flag, ''); eq(dues(l), ['2026-10-13', '2026-10-13', '2026-10-14', '2026-10-20', '2026-10-27']);
});
t('clearing a flag in time leaves the plan alone', () => {
  const l = fresh(); l.flag = 'dup'; l.dupOf = 'x'; L.clearFlag(l, CFG, '2026-10-05'); eq(dues(l), ['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-12', '2026-10-19']); eq(l.dupOf, '');
});
t('buckets: late, today, soon, later', () => {
  eq([['2026-10-04'], ['2026-10-05'], ['2026-10-12'], ['2026-10-13'], ['']].map(([d]) => L.bucketOf(d, '2026-10-05')), ['late', 'today', 'soon', 'later', 'none']);
});

console.log('\n# Messages');
t('the first message is a text with the parent’s first name, the second an email', () => {
  const l = fresh(); const m1 = L.messageFor(l, 1, CFG, 'Savannah'); eq(m1.kind, 'text'); assert.ok(m1.body.startsWith('Hi Pam, this is Savannah at Next Level Orthodontics.'), m1.body); assert.ok(m1.body.includes('352-332-7466'));
  const m2 = L.messageFor(l, 3, CFG, 'Savannah'); eq(m2.kind, 'email'); assert.ok(m2.body.startsWith('Hi Pam,\n'), m2.body); assert.ok(m2.subject.includes('Next Level Orthodontics'));
});
t('links for tapping: tel, sms and mail are encoded; bad numbers give no link', () => {
  eq(L.telLink('(352) 555-0142'), 'tel:+13525550142'); eq(L.telLink('12'), '');
  assert.ok(L.smsLink('352-555-0142', 'Hi & bye').startsWith('sms:+13525550142?&body=Hi%20%26%20bye')); eq(L.smsLink('x', 'y'), '');
  assert.ok(L.mailLink('pam@example.com', 'A b', 'c\nd').includes('subject=A%20b&body=c%0Ad')); eq(L.mailLink('nope', 'a', 'b'), '');
});
t('custom message templates replace the defaults', () => {
  const c = L.leadCfg({ leads: { tpl: { text1: 'Hello {first} from {me}' } } }); eq(L.messageFor(fresh(), 1, c, 'Gwen').body, 'Hello Pam from Gwen');
});

console.log('\n# Duplicates');
t('same phone number (any format) or same email within 45 days', () => {
  const a = Object.assign(fresh({}, at(2026, 10, 1, 9)), { id: 'a' });
  const dupPhone = fresh({ name: 'Pat E', phone: '(352) 555-0142', email: 'other@example.com' }, at(2026, 10, 5, 9));
  const dupMail = fresh({ phone: '', email: 'PAM@example.com' }, at(2026, 10, 5, 9));
  const none = fresh({ phone: '352-555-0999', email: 'x@example.com' }, at(2026, 10, 5, 9));
  eq(L.findDup(dupPhone, [a]).id, 'a'); eq(L.findDup(dupMail, [a]).id, 'a'); eq(L.findDup(none, [a]), null);
});
t('old leads, spam and test requests do not count', () => {
  const old = Object.assign(fresh({}, at(2026, 8, 1, 9)), { id: 'o' }); const spam = Object.assign(fresh({}, at(2026, 10, 3, 9)), { id: 's', closeWhy: 'spam' });
  eq(L.findDup(fresh({}, at(2026, 10, 5, 9)), [old, spam]), null);
});
t('a lead is never its own duplicate', () => { const a = Object.assign(fresh(), { id: 'a' }); eq(L.findDup(a, [a]), null); });

console.log('\n# Website requests become leads');
t('a clean request: planned from when it arrived, no flag', () => {
  const l = L.leadFromInbox({ name: 'pat example', parent: 'PAM EXAMPLE', phone: '352-555-0142', email: 'pam@example.com', message: 'Hi', extra: { 'How did you hear?': 'Google' }, page: 'https://example.com/request', raw: 'raw', flags: [] }, at(2026, 10, 2, 22), CFG, 'sav', []);
  eq(l.name, 'Pat Example'); eq(l.parent, 'Pam Example'); eq(l.flag, ''); eq(l.assignee, 'sav'); eq(l.src.kind, 'website'); eq(l.src.receivedAt, at(2026, 10, 2, 22));
  eq(dues(l), ['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-12', '2026-10-19']); eq(l.extra['How did you hear?'], 'Google');
});
t('flags: test beats spam beats duplicate beats check; reasons are kept', () => {
  const prior = Object.assign(fresh({}, at(2026, 10, 1, 9)), { id: 'p' });
  const l = L.leadFromInbox({ name: 'x', phone: '352-555-0142', email: '', flags: [{ k: 'check', why: 'No email' }, { k: 'spam', why: 'Link in message' }] }, at(2026, 10, 5, 9), CFG, '', [prior]);
  eq(l.flag, 'spam'); assert.ok(l.flagWhy.includes('Link in message') && l.flagWhy.includes('Same phone number as Pat Example')); eq(l.dupOf, 'p');
  eq(L.leadFromInbox({ name: 'x', phone: '352-555-0142', flags: [{ k: 'test', why: 'Test request' }] }, at(2026, 10, 5, 9), CFG, '', [prior]).flag, 'test');
  eq(L.leadFromInbox({ name: 'x', phone: '352-555-0142' }, at(2026, 10, 5, 9), CFG, '', [prior]).flag, 'dup');
});
t('long or odd input is cut down', () => {
  const l = L.leadFromInbox({ name: 'a'.repeat(500), message: 'm'.repeat(9000), extra: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['k' + i, 'v'])) }, at(2026, 10, 5, 9), CFG, '', []);
  eq(l.name.length, 120); eq(l.message.length, 4000); eq(Object.keys(l.extra).length, 20);
});

console.log('\n# Reading the form’s email / Asana notes');
const NOTES = 'Patient Name: Pat Example\nParent Name: Pam Example\nEmail: pam@example.com\nPhone: (352) 555-0142\nMessage: Hi, we would like a consult for my son.\nHe is 12.\nThanks: Pam\n\n---\n\nDate: October 5, 2026\nTime: 9:14 am\nPage URL: https://example.com/request-an-appointment/\nUser Agent: Mozilla/5.0\nRemote IP: 192.0.2.1\nPowered by:  Elementor';
t('parseLeadText reads the labelled fields, a multi-line message and the page', () => {
  const p = L.parseLeadText(NOTES);
  eq(p.name, 'Pat Example'); eq(p.parent, 'Pam Example'); eq(p.email, 'pam@example.com'); eq(p.phone, '(352) 555-0142');
  eq(p.message, 'Hi, we would like a consult for my son.\nHe is 12.\nThanks: Pam'); eq(p.page, 'https://example.com/request-an-appointment/'); eq(p.date, 'October 5, 2026'); eq(p.extra, {});
});
t('unknown labels are kept as extra fields', () => {
  const p = L.parseLeadText('Patient Name: A B\nPreferred Day: Tuesday\nEmail: a@example.com'); eq(p.extra, { 'Preferred Day': 'Tuesday' });
});

console.log('\n# Asana import');
const CSV = [
  'Task ID,Created At,Completed At,Name,Section/Column,Assignee,Due Date,Notes,Parent task,Outcome',
  '"1001","2026-10-05","","Website Appointment Request - Pat Example","Contacted","Savannah Tester","","' + NOTES.replace(/"/g, '""') + '","",""',
  '"1002","2026-10-05","2026-10-05","Attempt 1 - Call","","Savannah Tester","2026-10-05","","Website Appointment Request - Pat Example","Left voicemail"',
  '"1003","2026-10-05","","Attempt 2 - Text/Email","","Savannah Tester","2026-10-05","","Website Appointment Request - Pat Example",""',
  '"1004","2026-10-05","","Attempt 3 - Call","","Savannah Tester","2026-10-06","","Website Appointment Request - Pat Example",""',
  '"1005","2026-10-05","","Attempt 4 - Text/Email","","Savannah Tester","2026-10-12","","Website Appointment Request - Pat Example",""',
  '"1006","2026-10-05","","Attempt 5 - Final call + close out","","Savannah Tester","2026-10-19","","Website Appointment Request - Pat Example",""',
  '"2001","2026-09-20","2026-09-25","Website Appointment Request - Sam Sample","Scheduled","Savannah Tester","","Patient Name: Sam Sample\nEmail: sam@example.com\nPhone: 352-555-0188\nMessage: hello","","Appointment scheduled"',
  '"2002","2026-09-20","2026-09-21","Attempt 1 - Call","","Savannah Tester","2026-09-21","","Website Appointment Request - Sam Sample","Appointment scheduled"',
  '"3001","2026-09-01","","Buy printer paper","To do","","","not a lead","",""'
].join('\n');
const ROSTER = [{ sid: 'savannah', name: 'Savannah Tester', active: true }, { sid: 'amir', name: 'Dr. Akhavan', active: true }];
t('CSV: leads and their attempts are matched; other tasks are ignored', () => {
  const rows = L.asanaLeadsFromCSV(CSV); eq(rows.map(r => r.name), ['Website Appointment Request - Pat Example', 'Website Appointment Request - Sam Sample']); eq(rows[0].subtasks.length, 5); eq(rows[1].subtasks.length, 1);
});
t('an open lead keeps its ticked attempts and due dates', () => {
  const r = L.leadFromAsana(L.asanaLeadsFromCSV(CSV)[0], ROSTER, CFG, at(2026, 10, 6, 12)); const l = r.data;
  eq(r.status, 'open'); eq(l.name, 'Pat Example'); eq(l.parent, 'Pam Example'); eq(l.assignee, 'savannah'); eq(l.stage, 'contacted'); eq(l.src.asana, '1001'); eq(l.src.kind, 'asana');
  eq(dues(l), ['done', '2026-10-05', '2026-10-06', '2026-10-12', '2026-10-19']); eq(l.steps[0].res, 'vm'); eq(l.src.receivedAt, at(2026, 10, 5, 12));
});
t('a completed, scheduled lead closes as scheduled', () => {
  const r = L.leadFromAsana(L.asanaLeadsFromCSV(CSV)[1], ROSTER, CFG, at(2026, 10, 6, 12)); eq(r.status, 'done'); eq(r.data.closeWhy, 'sched'); eq(r.data.stage, 'scheduled');
});
t('a person without a login keeps their name as plain text', () => {
  const r = L.leadFromAsana(L.asanaLeadsFromCSV(CSV)[0], [{ sid: 'amir', name: 'Dr. Akhavan', active: true }], CFG, at(2026, 10, 6, 12)); eq(r.data.assignee, ''); eq(r.data.assigneeName, 'Savannah Tester');
});

console.log('\n# Results');
t('counts, outcomes and time to first contact; spam, tests and duplicates are left out', () => {
  const now = at(2026, 10, 30, 12), mk = (o, st) => { const l = fresh(o, now - 3 * 86400000); l.status = 'open'; (st || (() => { }))(l); return l; };
  const list = [
    mk({}, l => L.applyResult(l, 0, 'sched', { appt: '2026-10-30' }, CFG, now - 2 * 86400000)),
    mk({}, l => { L.applyResult(l, 0, 'no', {}, CFG, now - 3 * 86400000 + 7200000); l.status = 'done'; }),
    mk({}), mk({}, l => { l.flag = 'spam'; }), mk({ src: { kind: 'website', test: true } }),
    mk({}, l => { L.closeLead(l, 'spam'); l.status = 'done'; })
  ];
  const s = L.leadStats(list, now, 30); eq(s.received, 3); eq(s.scheduled, 1); eq(s.notint, 1); eq(s.working, 1); eq(s.noContact, 1); eq(s.bySource.manual, 3);
  eq(s.medianHours, 13); // 24 h and 2 h
  eq(L.fmtHours(0.2), '12 min'); eq(L.fmtHours(5), '5 h'); eq(L.fmtHours(72), '3 days'); eq(L.fmtHours(null), '—');
});
t('CSV export cells that start like formulas are neutralised', () => {
  eq(L.csvCell('=1+1'), '"\'=1+1"'); eq(L.csvCell('a"b'), '"a""b"');
  const row = L.leadToCSVRow(Object.assign(fresh({ name: '=cmd' }), { status: 'open' }), 'Sav'); assert.ok(row.startsWith('"\'=cmd"'), row);
});

console.log('\nPASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
