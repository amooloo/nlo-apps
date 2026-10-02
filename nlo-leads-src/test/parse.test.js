/* The receiving service's reading of website requests, and its sealing (checked against the app's own
   browser code). Every name, number and email is made up. Run: node test/parse.test.js */
const assert = require('assert');
const path = require('path');
const { parseBody, mapFields, fieldsOf } = require('../intake/parse');
const { sealTo, sha256hex, sameHex } = require('../intake/seal');
const { load } = require('./load');
const C = load(['core.js', 'leads.js']);
let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  const done = () => { pass++; console.log('  ok  ' + name); }, bad = e => { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n').slice(0, 5).join('\n       ') : e)); };
  try { const r = fn(); if (r && r.then) pending.push(r.then(done, bad)); else done(); } catch (e) { bad(e); }
}
const plain = x => JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const enc = o => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
const read = (text, ctype) => mapFields(parseBody(text, ctype || 'application/x-www-form-urlencoded'));

// what Elementor Pro's Webhook action sends with "Advanced Data" on (shape per field: id, type, title, value, raw_value, required)
const ADV = enc({
  'form[id]': 'a1b2c3d', 'form[name]': 'Request an Appointment',
  'fields[name][id]': 'name', 'fields[name][type]': 'text', 'fields[name][title]': 'Patient Name', 'fields[name][value]': 'avery sample', 'fields[name][raw_value]': 'avery sample', 'fields[name][required]': '1',
  'fields[field_2][id]': 'field_2', 'fields[field_2][type]': 'text', 'fields[field_2][title]': 'Parent Name', 'fields[field_2][value]': 'Jordan Sample', 'fields[field_2][raw_value]': 'Jordan Sample', 'fields[field_2][required]': '',
  'fields[email][id]': 'email', 'fields[email][type]': 'email', 'fields[email][title]': 'Email', 'fields[email][value]': 'jordan.sample@example.com', 'fields[email][raw_value]': 'jordan.sample@example.com', 'fields[email][required]': '1',
  'fields[field_4][id]': 'field_4', 'fields[field_4][type]': 'tel', 'fields[field_4][title]': 'Phone', 'fields[field_4][value]': '(352) 555-0101', 'fields[field_4][raw_value]': '(352) 555-0101', 'fields[field_4][required]': '1',
  'fields[message][id]': 'message', 'fields[message][type]': 'textarea', 'fields[message][title]': 'Message', 'fields[message][value]': 'Consult for braces please.\nAfternoons are best & thanks!', 'fields[message][raw_value]': 'x', 'fields[message][required]': '',
  'meta[date][title]': 'Date', 'meta[date][value]': 'October 2, 2026', 'meta[time][title]': 'Time', 'meta[time][value]': '10:15 am',
  'meta[page_url][title]': 'Page URL', 'meta[page_url][value]': 'https://thenextlevelorthodontics.com/request-an-appointment/',
  'meta[user_agent][title]': 'User Agent', 'meta[user_agent][value]': 'Mozilla/5.0 (made up)', 'meta[remote_ip][title]': 'Remote IP', 'meta[remote_ip][value]': '203.0.113.7',
  'meta[credit][title]': 'Powered by', 'meta[credit][value]': 'Elementor'
});
// the same form with "Advanced Data" off: labels as keys
const FLAT = enc({ 'Patient Name': 'Riley Demo', 'Parent Name': '', Email: 'riley.demo@example.com', Phone: '352.555.0102', Message: 'Clear aligners for me', Date: 'October 2, 2026', Time: '9:01 am', 'Page URL': 'https://thenextlevelorthodontics.com/request-an-appointment/', 'User Agent': 'Mozilla/5.0', 'Remote IP': '203.0.113.9', 'Powered by': 'Elementor', form_id: 'a1b2c3d', form_name: 'Request an Appointment' });

console.log('\n# Reading the website form');
t('Elementor “Advanced Data”: every field lands in the right place', () => {
  const r = read(ADV);
  eq([r.name, r.parent, r.email, r.phone], ['Avery Sample', 'Jordan Sample', 'jordan.sample@example.com', '(352) 555-0101']);
  eq(r.message, 'Consult for braces please.\nAfternoons are best & thanks!');
  eq(r.page, 'https://thenextlevelorthodontics.com/request-an-appointment/'); eq(r.extra, {}); eq(r.flags, []); eq(r.test, false);
});
t('the visitor’s IP address and browser details are not kept', () => { const r = read(ADV); assert.ok(!/203\.0\.113|Mozilla/.test(JSON.stringify(r))); });
t('Elementor without “Advanced Data” (labels as keys) reads the same', () => {
  const r = read(FLAT);
  eq([r.name, r.parent, r.email, r.phone, r.message], ['Riley Demo', '', 'riley.demo@example.com', '352.555.0102', 'Clear aligners for me']);
  eq(r.extra, {}); eq(r.flags, []); assert.ok(!/203\.0\.113/.test(JSON.stringify(r)));
});
t('JSON bodies work too (the app’s test request)', () => {
  const r = read(JSON.stringify({ test: true, fields: { name: 'Test Request', email: 'test@example.com', phone: '352-555-0199', message: 'hello' } }), 'text/plain');
  eq([r.name, r.email, r.phone, r.message, r.test], ['Test Request', 'test@example.com', '352-555-0199', 'hello', true]); eq(r.flags.map(f => f.k), ['test']);
});
t('a list of {label, value} fields (other form tools)', () => {
  const r = read(JSON.stringify([{ label: 'Child’s name', value: 'Quinn Example' }, { label: 'Your name', value: 'Casey Example' }, { label: 'Mobile', value: '3525550103' }, { label: 'How did you hear about us?', value: 'Our dentist' }]), 'application/json');
  eq([r.name, r.parent, r.phone], ['Quinn Example', 'Casey Example', '3525550103']); eq(r.extra['How did you hear about us?'], 'Our dentist');
});
t('first and last name fields are joined; the parent’s are kept apart', () => {
  const r = read(enc({ 'First Name': 'harper', 'Last Name': 'testcase', "Parent/Guardian First Name": 'Morgan', "Parent/Guardian Last Name": 'Testcase', Email: 'morgan.t@example.com' }));
  eq([r.name, r.parent], ['Harper Testcase', 'Morgan Testcase']);
});
t('unknown fields are kept as extras, nothing is lost', () => {
  const r = read(enc({ Name: 'Rowan Placeholder', Email: 'rowan.p@example.com', 'Preferred office day': 'Tuesday', 'Insurance': 'None yet' }));
  eq(r.extra, { 'Preferred office day': 'Tuesday', Insurance: 'None yet' });
});
t('several message boxes are kept with their labels', () => {
  const r = mapFields({ fields: { a: { title: 'Message', type: 'textarea', value: 'First note' }, b: { title: 'Questions', type: 'textarea', value: 'Second note' }, e: { title: 'Email', type: 'email', value: 'x@example.com' }, n: { title: 'Name', type: 'text', value: 'Sam Sample' } } });
  eq(r.message, 'Message: First note\nQuestions: Second note');
});
t('ticked boxes with the same name are all kept', () => {
  const r = read('Name=Sam+Sample&Email=sam%40example.com&Interested+in%5B%5D=Braces&Interested+in%5B%5D=Aligners');
  eq(r.extra['Interested in'], 'Braces, Aligners');
});
t('no labels at all: email, phone and names are picked out by how they look', () => {
  const r = read(enc({ field_1: 'Skyler Mockley', field_2: 'Dana Mockley', field_3: 'dana.m@example.com', field_4: '352 555 0106', field_5: 'Hello there, we need help' }));
  eq([r.email, r.phone, r.name, r.parent], ['dana.m@example.com', '352 555 0106', 'Skyler Mockley', 'Dana Mockley']);
});
t('a second email or phone is kept as an extra', () => {
  const r = read(enc({ Name: 'Sam Sample', Email: 'sam@example.com', 'Work email': 'sam.work@example.com', Phone: '352-555-0110', 'Other phone': '352-555-0111' }));
  eq([r.email, r.phone], ['sam@example.com', '352-555-0110']); assert.ok(r.extra['Work email'] === 'sam.work@example.com' && r.extra['Other phone'] === '352-555-0111');
});
t('a broken email in the first box gives way to a working one', () => {
  const r = read(enc({ Name: 'Sam Sample', Email: 'sam at example', 'Confirm email': 'sam@example.com' })); eq(r.email, 'sam@example.com');
});

console.log('\n# Flags');
t('no working phone or email → please check', () => eq(read(enc({ Name: 'Pat Example', Email: 'pat@', Phone: '555' })).flags.map(f => f.k), ['check']));
t('a web link in the name → spam', () => eq(read(enc({ Name: 'Cheap followers www.example.com', Email: 'promo@example.com' })).flags.map(f => f.k), ['spam']));
t('three links in the message → spam', () => eq(read(enc({ Name: 'Pat Example', Email: 'pat@example.com', Message: 'see http://a.example http://b.example www.c.example' })).flags.map(f => f.k), ['spam']));
t('the hidden anti-spam box filled in → spam', () => eq(mapFields({ fields: { hp: { type: 'honeypot', title: '', value: 'gotcha' }, n: { title: 'Name', value: 'Bot' }, e: { title: 'Email', type: 'email', value: 'bot@example.com' } } }).flags.map(f => f.k), ['spam']));
t('nothing readable → please check, and the original is kept', () => { const r = read(''); eq(r.flags.map(f => f.k), ['check']); });
t('odd name (digits) → please check', () => eq(read(enc({ Name: 'Sam 12345', Email: 'sam@example.com' })).flags.map(f => f.k), ['check']));

console.log('\n# Safety');
t('__proto__ and constructor keys are ignored, nothing is polluted', () => {
  const r = read('__proto__%5Bpolluted%5D=yes&constructor%5Bprototype%5D%5Bx%5D=1&fields%5B__proto__%5D%5Bvalue%5D=z&Name=Sam+Sample&Email=sam%40example.com');
  assert.strictEqual({}.polluted, undefined); assert.strictEqual(Object.prototype.x, undefined); eq(r.name, 'Sam Sample');
  const j = read('{"__proto__":{"polluted":"yes"},"name":"Sam Sample","email":"sam@example.com"}', 'application/json');
  assert.strictEqual({}.polluted, undefined); eq(j.name, 'Sam Sample');
});
t('very long input is cut down to size', () => {
  const r = read(enc({ Name: 'A'.repeat(500), Email: 'a@example.com', Message: 'm'.repeat(9000), Notes2: 'x'.repeat(900) }));
  assert.ok(r.name.length <= 120 && r.message.length <= 4000 && r.raw.length <= 8000 && Object.values(r.extra).every(v => v.length <= 500));
});
t('deeply nested keys stop at a safe depth', () => { const k = 'a' + '[b]'.repeat(40); const b = parseBody(k + '=1'); let d = 0, o = b; while (o && typeof o === 'object') { o = o[Object.keys(o)[0]]; d++; } assert.ok(d <= 7); });
t('too many fields: only the first 500 are read', () => { const b = parseBody(Array.from({ length: 2000 }, (_, i) => 'f' + i + '=v').join('&')); assert.ok(Object.keys(b).length <= 500); });
t('the raw copy lists the form’s fields, not its metadata', () => { const r = read(ADV); assert.ok(/Patient Name: avery sample/.test(r.raw) && !/Remote IP|User Agent/.test(r.raw)); });
t('odd input that would slow the email check down is handled at once', () => {
  const t0 = Date.now(); read(enc({ Email: 'a@' + '.'.repeat(60000) + '@', Name: 'x' })); read(enc({ Name: 'a-'.repeat(30000) })); assert.ok(Date.now() - t0 < 200, (Date.now() - t0) + ' ms');
});
t('an “email” built to add hidden recipients is not treated as an email', () => {
  const r = read(enc({ Name: 'Sam Sample', Email: '?to=victim%40example.com&bcc=spy%40example.test&x=@example.com' }));
  eq(r.flags.map(f => f.k), ['check']); assert.ok(!C.validEmail(r.email) && C.mailLink(r.email, 's', 'b') === '');
});
t('field ids or types that are objects don’t break anything', () => {
  const r = mapFields({ fields: { a: { id: Object.create(null), type: Object.create(null), title: 'Name', value: 'Sam Sample' }, b: { id: ['x'], type: { t: 1 }, title: 'Email', value: 'sam@example.com' } } });
  eq([r.name, r.email], ['Sam Sample', 'sam@example.com']);
});

console.log('\n# Sealing');
t('a request sealed by the service opens in the app (same code the browsers run)', async () => {
  const pair = await C.Crypto.newPair(), pub = await C.Crypto.pubJwk(pair);
  const priv = await C.Crypto.importPriv(await C.Crypto.privBytes(pair));
  const payload = { v: 1, name: 'Avery Sample', message: 'Héllo — ünïcode ✓' };
  const box = await sealTo(pub, Buffer.from(JSON.stringify(payload)), 'inbox:abc123');
  const out = JSON.parse(new TextDecoder().decode(await C.Crypto.openFrom(priv, box, 'inbox:abc123')));
  eq(out, payload);
  // bound to its id: the same box under another id does not open
  await assert.rejects(C.Crypto.openFrom(priv, box, 'inbox:other'));
});
t('the stored box has only the one-time public key, nonce and ciphertext', async () => {
  const pair = await C.Crypto.newPair(), pub = await C.Crypto.pubJwk(pair);
  const box = await sealTo(pub, Buffer.from('{"name":"Avery Sample"}'), 'inbox:x');
  eq(Object.keys(box).sort(), ['ct', 'epk', 'iv']); eq(Object.keys(box.epk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.ok(!/Avery/.test(JSON.stringify(box)));
});
t('the secret’s hash matches the app’s, and comparing is exact', async () => {
  const s = C.Crypto.newSecret(); eq(sha256hex(s), await C.Crypto.sha256hex(s));
  assert.ok(sameHex(sha256hex(s), sha256hex(s)) && !sameHex(sha256hex(s), sha256hex(s + 'x')) && !sameHex('', '') && !sameHex(sha256hex(s), undefined));
});
t('what the service stores becomes a lead in the app with its plan', () => {
  const p = Object.assign({ v: 1, at: Date.now() }, read(ADV));
  const l = C.leadFromInbox(p, new Date(2026, 9, 5, 9).getTime(), C.leadCfg({}), 'savannah', []);
  eq([l.name, l.parent, l.src.kind, l.steps.length, l.assignee, l.flag], ['Avery Sample', 'Jordan Sample', 'website', 5, 'savannah', '']);
});

Promise.all(pending).then(() => { console.log('\nPASS ' + pass + '  FAIL ' + fail); process.exit(fail ? 1 : 0); });
