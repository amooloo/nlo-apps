// Security rules for NLO Time Clock (the same rules file as NLO Cases, Leads, A/R and Time Off): every write the clock makes,
// and what someone else would try — a coworker, a manager on their own time, someone who left, a stranger, the time-clock
// computer going beyond a punch, the alert script going beyond the log. Made-up people only. Run inside the emulators:
//   npx firebase emulators:exec --only firestore --project demo-nlo-cases "node test/rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp, query, where } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const ok = (n, p) => t(n, p, true), no = (n, p) => t(n, p, false);
const is = (name, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : '  FAIL ') + name + (c ? '' : ' :: ' + JSON.stringify(extra))); };
const env = await initializeTestEnvironment({ projectId: 'demo-nlo-cases', firestore: { rules: readFileSync('dist/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
const as = uid => env.authenticatedContext(uid, { email: uid + '@example.com', email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const pinHash = (sid, pin) => createHash('sha256').update('nlo-tc-pin|' + sid + '|' + pin).digest('hex');
const pub = c => ({ kty: 'EC', crv: 'P-256', x: c.repeat(43), y: c.repeat(43) });
const sealed = () => ({ epk: { kty: 'EC', crv: 'P-256', x: 'E'.repeat(43), y: 'F'.repeat(43) }, iv: 'aXY=', ct: 'cmluZw==' });
let n = 0; const pid = () => 'p' + (++n).toString(16).padStart(24, '0'), fid = () => 'f' + (++n).toString(16).padStart(24, '0');
const now = () => Timestamp.now(), ago = m => Timestamp.fromMillis(Date.now() - m * 60000);
const SETTINGS = { wk: 0, ot: 40, thr: [36, 38], early: '07:30', late: '18:30', shift: 10, brk: 20, days: [1, 2, 3, 4], pay: '2026-09-27' };
const ALERTS = { emails: ['dr.test@example.com'], topic: 'nlo-clock-abc123', route: { ot: 3, thr: 3 }, digest: '', test: null };
const staff = (o) => Object.assign({ on: true, home: false, hdays: [], early: '', cap: 0, pinAt: null }, o || {});

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), T = Timestamp.now();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: T });
    await setDoc(doc(db, 'meta/keys'), { current: 1 });
    for (const [uid, sid, role, active] of [['owner', 'amir', 'owner', true], ['fc', 'sarah', 'staff', true], ['ca', 'gwen', 'staff', true], ['ca2', 'kim', 'staff', true], ['wfh', 'wila', 'staff', true], ['gone', 'lee', 'staff', false]]) {
      await setDoc(doc(db, 'members/' + uid), { staffId: sid, role, active, name: sid, pub: pub('A') });
      await setDoc(doc(db, 'roster/' + sid), { name: sid, initials: 'X', role, active, username: sid, gen: 0 });
    }
    await setDoc(doc(db, 'toAccess/fc'), { ring: sealed(), ringV: 1, pubX: 'A'.repeat(43), sid: 'sarah', by: 'owner', at: T }); // Sarah approves time off…
    await setDoc(doc(db, 'tcMgrs/sarah'), { at: T, by: 'owner' }); // …and Dr. A made her a time clock manager
    await setDoc(doc(db, 'members/hr2'), { staffId: 'tina', role: 'staff', active: true, name: 'tina', pub: pub('A') });
    await setDoc(doc(db, 'roster/tina'), { name: 'tina', initials: 'T', role: 'staff', active: true, username: 'tina', gen: 0 });
    await setDoc(doc(db, 'toAccess/hr2'), { ring: sealed(), ringV: 1, pubX: 'A'.repeat(43), sid: 'tina', by: 'owner', at: T }); // Tina approves time off only
    await setDoc(doc(db, 'tcKiosks/kiosk1'), { name: 'Front desk', at: T, by: 'owner' });
    await setDoc(doc(db, 'tcKiosks/kiosk2'), { name: 'Lab', at: T, by: 'owner' });
    await setDoc(doc(db, 'tcBots/bot1'), { email: 'clockbot@example.com', at: T });
    await setDoc(doc(db, 'meta/tc'), Object.assign({ at: T }, SETTINGS));
    await setDoc(doc(db, 'meta/tcAlerts'), Object.assign({ at: T }, ALERTS));
    for (const sid of ['gwen', 'kim', 'sarah', 'lee']) await setDoc(doc(db, 'tcStaff/' + sid), Object.assign(staff({ pinAt: T }), { at: T, by: 'owner' }));
    await setDoc(doc(db, 'tcStaff/wila'), Object.assign(staff({ home: true, hdays: [5], pinAt: T }), { at: T, by: 'owner' }));
    await setDoc(doc(db, 'tcStaff/amir'), Object.assign(staff({ on: false }), { at: T, by: 'owner' }));
    for (const sid of ['gwen', 'kim', 'sarah', 'wila', 'lee']) await setDoc(doc(db, 'tcPin/' + sid), { h: pinHash(sid, '1234'), at: T });
    // the office lock's pieces: the office check's login, the office's network, two approved laptops (Wila's — she's
    // allowed home — and one for Gwen, who isn't)
    await setDoc(doc(db, 'tcNetBot/netbot1'), { email: 'netbot@example.com', at: T });
    await setDoc(doc(db, 'tcOffice/' + OFFICE), { name: 'Office Wi-Fi', org: 'Cox Business', city: 'Gainesville, Florida', by: 'owner', at: T });
    await setDoc(doc(db, 'tcLaptops/lap1'), { name: 'Remote laptop', sids: ['wila'], at: T, by: 'owner' });
    await setDoc(doc(db, 'tcLaptops/lap2'), { name: 'Gwen’s laptop', sids: ['gwen'], at: T, by: 'owner' });
  });
}
const OFFICE = 'v4:203.0.113.10', OFFICE6 = 'v6:2600:1700:abcd:12', HOME = 'v4:198.51.100.7';
async function raw(path) { let d; await env.withSecurityRulesDisabled(async c => { const s = await getDoc(doc(c.firestore(), path)); d = s.exists() ? s.data() : null; }); return d; }
async function put(path, data) { await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), path), data); }); }

/* the time clock's steps for one person: a try (counted, with the hash of the PIN tried saved where nobody can read it, in
   the same save), the check (only with the right PIN), then the punch with the try used up */
async function tryDoc(db, sid, pin, nPrev, t0) {
  const cur = await raw('tcTry/' + sid), bad = cur ? (cur.bad || 0) + 1 : 1, b = writeBatch(db);
  b.set(doc(db, 'tcTry/' + sid), nPrev == null ? { n: 1, t0: serverTimestamp(), at: serverTimestamp(), ok: false, k: db._kioskUid, bad, u: '' }
    : { n: nPrev + 1, t0, at: serverTimestamp(), ok: false, k: db._kioskUid, bad, u: '' });
  b.set(doc(db, 'tcTryPh/' + sid), { ph: pinHash(sid, pin), at: serverTimestamp() });
  return b.commit();
}
/* the next try the way the time clock sends it: a fresh 10 minutes once the last tries are over, otherwise counting on */
async function nextTry(db, sid, pin) {
  const cur = await raw('tcTry/' + sid);
  if (!cur || Date.now() > cur.t0.toMillis() + 10 * 60000) return tryDoc(db, sid, pin);
  return tryDoc(db, sid, pin, cur.n, cur.t0);
}
async function wipe(path) { await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), path)); }); }
const check = (db, sid) => updateDoc(doc(db, 'tcTry/' + sid), { ok: true });
const cleared = u => ({ n: 0, t0: serverTimestamp(), at: serverTimestamp(), ok: false, k: '', bad: 0, u: u || '' });
function punchBatch(db, sid, kind, extra, id) {
  const b = writeBatch(db); id = id || pid();
  b.set(doc(db, 'tcPunch/' + id), Object.assign({ sid, kind, at: serverTimestamp(), src: 'kiosk', by: db._kioskUid, net: '' }, extra || {}));
  b.set(doc(db, 'tcTry/' + sid), cleared(id));
  return b.commit();
}
/* a seeded try (rules off): its record, and the hash it tried (same time) */
async function seedTry(sid, o, pin) {
  const at = o.at || ago(1);
  await put('tcTry/' + sid, Object.assign({ n: 1, t0: at, at, ok: false, k: 'kiosk1', bad: 1, u: '' }, o));
  if (pin) await put('tcTryPh/' + sid, { ph: pinHash(sid, pin), at });
}
function kiosk(uid) { const db = as(uid); db._kioskUid = uid; return db; }

await seed();
console.log('\n# settings and where alerts go');
await ok('Dr. A saves the clock settings', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS)));
await no('…not with a bad time', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({}, SETTINGS, { early: '7:30', at: serverTimestamp() })));
await no('…not with an extra field', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ x: 1, at: serverTimestamp() }, SETTINGS)));
await no('a manager can’t change them (Dr. A only)', setDoc(doc(as('fc'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS)));
await ok('staff can read them', getDoc(doc(as('ca'), 'meta/tc')));
await ok('the time clock reads them', getDoc(doc(kiosk('kiosk1'), 'meta/tc')));
await ok('the alert script reads them', getDoc(doc(as('bot1'), 'meta/tc')));
await no('a stranger can’t', getDoc(doc(as('stranger'), 'meta/tc')));
await no('nobody signed in can’t', getDoc(doc(anon(), 'meta/tc')));
await ok('Dr. A sets where alerts go', setDoc(doc(as('owner'), 'meta/tcAlerts'), Object.assign({ at: serverTimestamp() }, ALERTS)));
await ok('…and asks for a test', updateDoc(doc(as('owner'), 'meta/tcAlerts'), { test: serverTimestamp(), at: serverTimestamp() }));
await no('…not a bad push topic', updateDoc(doc(as('owner'), 'meta/tcAlerts'), { topic: 'has spaces/x', at: serverTimestamp() }));
await no('a manager can’t change where alerts go', updateDoc(doc(as('fc'), 'meta/tcAlerts'), { emails: ['x@example.com'], at: serverTimestamp() }));
await ok('a manager can see them (to subscribe to the push topic)', getDoc(doc(as('fc'), 'meta/tcAlerts')));
await ok('the alert script reads them', getDoc(doc(as('bot1'), 'meta/tcAlerts')));
await no('staff can’t', getDoc(doc(as('ca'), 'meta/tcAlerts')));
await no('the time clock can’t', getDoc(doc(kiosk('kiosk1'), 'meta/tcAlerts')));

console.log('\n# who manages the time clock: Dr. A, and whoever he adds');
await no('someone who approves time off isn’t a time clock manager (Tina reads no punches)', getDocs(collection(as('hr2'), 'tcPunch')));
await no('…or corrections', getDocs(collection(as('hr2'), 'tcFix')));
await no('…or where alerts go', getDoc(doc(as('hr2'), 'meta/tcAlerts')));
await ok('Dr. A makes Gwen a time clock manager', setDoc(doc(as('owner'), 'tcMgrs/gwen'), { at: serverTimestamp(), by: 'owner' }));
await ok('…then she reads everyone’s punches', getDocs(collection(as('ca'), 'tcPunch')));
await ok('…and takes it away again', deleteDoc(doc(as('owner'), 'tcMgrs/gwen')));
await no('…after which she reads only her own', getDocs(collection(as('ca'), 'tcPunch')));
await no('a manager can’t make someone a manager (Sarah, Kim)', setDoc(doc(as('fc'), 'tcMgrs/kim'), { at: serverTimestamp(), by: 'fc' }));
await no('…nor can staff make themselves one', setDoc(doc(as('ca2'), 'tcMgrs/kim'), { at: serverTimestamp(), by: 'ca2' }));
await no('…nor can someone who approves time off', setDoc(doc(as('hr2'), 'tcMgrs/tina'), { at: serverTimestamp(), by: 'hr2' }));
await no('Dr. A can’t add someone with no clock settings', setDoc(doc(as('owner'), 'tcMgrs/nobody'), { at: serverTimestamp(), by: 'owner' }));
await ok('staff can see whether they are one', getDoc(doc(as('ca'), 'tcMgrs/gwen')));
await no('…not the list', getDocs(collection(as('ca'), 'tcMgrs')));

console.log('\n# who is on the clock (tcStaff) and PINs');
await ok('Dr. A puts someone on the clock', setDoc(doc(as('owner'), 'tcStaff/kim'), Object.assign(staff({ home: true, hdays: [1, 5] }), { at: serverTimestamp(), by: 'owner' })));
await no('…by must be him', setDoc(doc(as('owner'), 'tcStaff/kim'), Object.assign(staff(), { at: serverTimestamp(), by: 'fc' })));
await ok('Dr. A marks someone salaried (hours kept for the record)', setDoc(doc(as('owner'), 'tcStaff/wila'), Object.assign(staff({ home: true, sal: true }), { at: serverTimestamp(), by: 'owner' })));
await no('…salaried is yes or no', setDoc(doc(as('owner'), 'tcStaff/wila'), Object.assign(staff({ home: true, sal: 'yes' }), { at: serverTimestamp(), by: 'owner' })));
await no('a manager can’t mark anyone salaried', updateDoc(doc(as('fc'), 'tcStaff/gwen'), { sal: true, at: serverTimestamp(), by: 'fc' }));
await no('a manager can’t put people on the clock or allow home', updateDoc(doc(as('fc'), 'tcStaff/gwen'), { home: true, at: serverTimestamp(), by: 'fc' }));
await no('staff can’t allow themselves home', updateDoc(doc(as('ca'), 'tcStaff/gwen'), { home: true, at: serverTimestamp(), by: 'ca' }));
await ok('staff read their own', getDoc(doc(as('ca'), 'tcStaff/gwen')));
await no('…not a coworker’s', getDoc(doc(as('ca'), 'tcStaff/kim')));
await ok('the time clock lists everyone', getDocs(collection(kiosk('kiosk1'), 'tcStaff')));
{
  const db = as('fc'), b = writeBatch(db);
  b.set(doc(db, 'tcPin/gwen'), { h: pinHash('gwen', '4321'), at: serverTimestamp() });
  b.update(doc(db, 'tcStaff/gwen'), { pinAt: serverTimestamp(), pinBy: 'mgr', at: serverTimestamp(), by: 'fc' });
  await ok('a manager sets a new PIN (the hash, when, and that a manager set it)', b.commit());
}
{
  const db = as('fc'), b = writeBatch(db);
  b.update(doc(db, 'tcStaff/gwen'), { pinAt: serverTimestamp(), pinBy: 'mgr', on: false, at: serverTimestamp(), by: 'fc' });
  b.set(doc(db, 'tcPin/gwen'), { h: pinHash('gwen', '4321'), at: serverTimestamp() });
  await no('…but nothing else with it', b.commit());
}
{
  const db = as('fc'), b = writeBatch(db);
  b.set(doc(db, 'tcPin/gwen'), { h: pinHash('gwen', '4322'), at: serverTimestamp() });
  b.update(doc(db, 'tcStaff/gwen'), { pinAt: serverTimestamp(), pinBy: 'self', at: serverTimestamp(), by: 'fc' });
  await no('…and it says a manager set it (not that she did)', b.commit());
}
await no('nobody reads a PIN’s hash — not Dr. A', getDoc(doc(as('owner'), 'tcPin/gwen')));
await no('…not a manager', getDoc(doc(as('fc'), 'tcPin/gwen')));
await no('…not the time clock', getDoc(doc(kiosk('kiosk1'), 'tcPin/gwen')));
await no('…not the alert script', getDoc(doc(as('bot1'), 'tcPin/gwen')));
await no('…not the person', getDoc(doc(as('ca'), 'tcPin/gwen')));
await no('staff can’t set their own PIN outside the time clock', setDoc(doc(as('ca'), 'tcPin/gwen'), { h: pinHash('gwen', '0000'), at: serverTimestamp() }));
await no('the time clock can’t set a PIN without the old one', setDoc(doc(kiosk('kiosk1'), 'tcPin/gwen'), { h: pinHash('gwen', '0000'), at: serverTimestamp() }));
await no('a PIN hash must be a hash', setDoc(doc(as('fc'), 'tcPin/kim'), { h: '1234', at: serverTimestamp() }));

await seed();
console.log('\n# at the time clock: try, check, punch');
const k1 = kiosk('kiosk1'), k2 = kiosk('kiosk2');
await no('a punch without a PIN', punchBatch(k1, 'gwen', 'in'));
await ok('a try (counted first)', tryDoc(k1, 'gwen', '1234'));
await no('the punch before the PIN is checked', punchBatch(k1, 'gwen', 'in'));
await no('another time clock can’t use this one’s try', check(k2, 'gwen'));
await ok('the check, with the right PIN', check(k1, 'gwen'));
await no('another time clock can’t punch with it', punchBatch(k2, 'gwen', 'in'));
{
  const b = writeBatch(k1); b.set(doc(k1, 'tcPunch/' + pid()), { sid: 'gwen', kind: 'in', at: serverTimestamp(), src: 'kiosk', by: 'kiosk1', net: '' });
  await no('a punch that doesn’t use up the try', b.commit());
}
await no('a punch with the device’s own time', punchBatch(k1, 'gwen', 'in', { at: Timestamp.fromMillis(Date.now() - 3600000) }));
await no('a punch for someone else on the same check', punchBatch(k1, 'kim', 'in'));
await no('a punch marked as from home', punchBatch(k1, 'gwen', 'in', { src: 'home' }));
await no('a punch of an unknown kind', punchBatch(k1, 'gwen', 'start'));
{
  const b = writeBatch(k1), a = pid(), z = pid();
  b.set(doc(k1, 'tcPunch/' + a), { sid: 'gwen', kind: 'in', at: serverTimestamp(), src: 'kiosk', by: 'kiosk1', net: '' });
  b.set(doc(k1, 'tcPunch/' + z), { sid: 'gwen', kind: 'out', at: serverTimestamp(), src: 'kiosk', by: 'kiosk1', net: '' });
  b.set(doc(k1, 'tcTry/gwen'), cleared(a));
  await no('one check, two punches in one save', b.commit());
}
await ok('the punch, using up the try', punchBatch(k1, 'gwen', 'in'));
await no('…and the same check can’t punch again', punchBatch(k1, 'gwen', 'out'));
is('a try’s record holds no hash of the PIN', !('ph' in (await raw('tcTry/gwen'))), await raw('tcTry/gwen'));
await no('nobody reads the hash of the PIN just tried — not Dr. A', getDoc(doc(as('owner'), 'tcTryPh/gwen')));
await no('…not a manager', getDocs(collection(as('fc'), 'tcTryPh')));
await no('…not the time clock', getDoc(doc(k1, 'tcTryPh/gwen')));
await no('…not the alert script', getDoc(doc(as('bot1'), 'tcTryPh/gwen')));
await no('the time clock can’t write a PIN’s hash without a try', setDoc(doc(k1, 'tcTryPh/gwen'), { ph: pinHash('gwen', '1234'), at: serverTimestamp() }));
await no('…nor a try without its hash', setDoc(doc(k1, 'tcTry/gwen'), { n: 1, t0: serverTimestamp(), at: serverTimestamp(), ok: false, k: 'kiosk1', bad: 1, u: '' }));
const T0 = (await raw('tcTry/gwen')).t0;
await ok('wrong PIN: the try is still counted', tryDoc(k1, 'gwen', '9999', 0, T0));
await no('…and the check refuses it', check(k1, 'gwen'));
let st = await raw('tcTry/gwen');
await ok('try 2 (wrong)', tryDoc(k1, 'gwen', '0000', st.n, st.t0));
st = await raw('tcTry/gwen'); await ok('try 3 (wrong)', tryDoc(k1, 'gwen', '1111', st.n, st.t0));
st = await raw('tcTry/gwen'); await ok('try 4 (wrong)', tryDoc(k1, 'gwen', '2222', st.n, st.t0));
st = await raw('tcTry/gwen'); await ok('try 5 (right)', tryDoc(k1, 'gwen', '1234', st.n, st.t0));
is('every try since the last right PIN is counted (bad)', (await raw('tcTry/gwen')).bad === 5, await raw('tcTry/gwen'));
st = await raw('tcTry/gwen'); await no('no 6th try within 10 minutes', tryDoc(k1, 'gwen', '1234', st.n, st.t0));
await no('…nor a count reset by hand', tryDoc(k1, 'gwen', '1234'));
await ok('…but the 5th, right PIN still checks', check(k1, 'gwen'));
await ok('…and punches', punchBatch(k1, 'gwen', 'out'));
is('…which starts the count again', (await raw('tcTry/gwen')).bad === 0);
await seedTry('kim', { n: 5, t0: ago(30), at: ago(29), bad: 5 }, '0000');
await ok('a fresh 10 minutes once the old tries are over', tryDoc(k1, 'kim', '1234'));
is('…still counted since the last right PIN (6)', (await raw('tcTry/kim')).bad === 6);
await seedTry('kim', { n: 5, t0: ago(3), at: ago(2), bad: 5 }, '0000');
await no('locked out (5 tries in the last 10 minutes)', tryDoc(k1, 'kim', '1234', 5, Timestamp.fromMillis(Date.now() - 180000)));
await ok('a manager clears the lockout', setDoc(doc(as('fc'), 'tcTry/kim'), cleared()));
await ok('…then the next try counts from 1', nextTry(k1, 'kim', '1234'));
await seedTry('kim', { n: 1, t0: ago(5), at: ago(3) }, '1234');
await no('a check more than 2 minutes after its try', check(k1, 'kim'));
await seedTry('kim', { n: 2, t0: ago(1), at: ago(0.2), bad: 2 });
await put('tcTryPh/kim', { ph: pinHash('kim', '1234'), at: ago(1) });
await no('a check against the hash of an earlier try', check(k1, 'kim'));
await seedTry('kim', { n: 1, t0: ago(7), at: ago(6), ok: true }, '1234');
await no('a punch more than 5 minutes after the PIN', punchBatch(k1, 'kim', 'in'));
await no('the time clock can’t clear tries that weren’t a right PIN', (async () => { await seedTry('kim', { n: 3, bad: 3 }, '0000'); return setDoc(doc(k1, 'tcTry/kim'), cleared()); })());
await ok('the time clock lets go of a right PIN nobody used (walked away)', (async () => { await seedTry('kim', { ok: true }, '1234'); return setDoc(doc(k1, 'tcTry/kim'), cleared()); })());
await no('staff can’t touch tries', setDoc(doc(as('ca'), 'tcTry/gwen'), cleared()));
await no('a stranger’s login can’t try a PIN', tryDoc(Object.assign(as('stranger'), { _kioskUid: 'stranger' }), 'gwen', '1234'));
await no('someone off the clock (Dr. A) can’t be tried', tryDoc(k1, 'amir', '1234'));
await no('someone who left can’t be tried', tryDoc(k1, 'lee', '1234'));
await ok('a manager sees tries (lockouts)', getDocs(collection(as('fc'), 'tcTry')));
await ok('the alert script sees tries', getDocs(collection(as('bot1'), 'tcTry')));
await no('staff don’t', getDocs(collection(as('ca'), 'tcTry')));

console.log('\n# changing a PIN at the time clock (after the old one)');
await wipe('tcTry/kim');
await nextTry(k1, 'kim', '1234'); await check(k1, 'kim');
{
  const b = writeBatch(k1);
  b.set(doc(k1, 'tcPin/kim'), { h: pinHash('kim', '5678'), at: serverTimestamp() });
  b.update(doc(k1, 'tcStaff/kim'), { pinAt: serverTimestamp(), pinBy: 'self', at: serverTimestamp(), by: 'kiosk1' });
  b.set(doc(k1, 'tcTry/kim'), cleared('pin'));
  await ok('new PIN, its date, her own, the try used up', b.commit());
}
{
  const b = writeBatch(k1);
  b.set(doc(k1, 'tcPin/kim'), { h: pinHash('kim', '9999'), at: serverTimestamp() });
  b.set(doc(k1, 'tcTry/kim'), cleared('pin'));
  await no('…not again without the PIN', b.commit());
}
await ok('the new PIN works', (async () => { await nextTry(k1, 'kim', '5678'); await check(k1, 'kim'); return punchBatch(k1, 'kim', 'in'); })());

console.log('\n# from home: no longer from any phone or computer (only an approved laptop, below)');
const home = (db, sid, uid, extra) => setDoc(doc(db, 'tcPunch/' + pid()), Object.assign({ sid, kind: 'in', at: serverTimestamp(), src: 'home', by: uid, net: '' }, extra || {}));
await no('Wila (allowed home) can’t clock in from her phone', home(as('wfh'), 'wila', 'wfh'));
await no('the time clock can’t punch “from home”', setDoc(doc(k1, 'tcPunch/' + pid()), { sid: 'wila', kind: 'in', at: serverTimestamp(), src: 'home', by: 'kiosk1', net: '' }));


console.log('\n# punches are kept as they are');
const someP = 'p' + 'a'.repeat(24);
await put('tcPunch/' + someP, { sid: 'gwen', kind: 'in', at: now(), src: 'kiosk', by: 'kiosk1' });
await no('Dr. A can’t change a punch', updateDoc(doc(as('owner'), 'tcPunch/' + someP), { kind: 'out' }));
await no('…or delete one', deleteDoc(doc(as('owner'), 'tcPunch/' + someP)));
await no('the time clock can’t either', deleteDoc(doc(k1, 'tcPunch/' + someP)));
await ok('staff read their own punches', getDocs(query(collection(as('ca'), 'tcPunch'), where('sid', '==', 'gwen'))));
await no('…not everyone’s', getDocs(collection(as('ca'), 'tcPunch')));
await no('…not a coworker’s', getDocs(query(collection(as('ca'), 'tcPunch'), where('sid', '==', 'kim'))));
await ok('a manager reads everyone’s', getDocs(collection(as('fc'), 'tcPunch')));
await ok('the time clock reads everyone’s (who’s in)', getDocs(collection(k1, 'tcPunch')));
await ok('the alert script reads everyone’s', getDocs(collection(as('bot1'), 'tcPunch')));
await no('a stranger can’t', getDocs(collection(as('stranger'), 'tcPunch')));
await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), 'tcKiosks/kiosk1')); });
await no('a time clock Dr. A removed reads nothing', getDocs(collection(k1, 'tcPunch')));
await no('…and can’t try a PIN', nextTry(k1, 'gwen', '1234'));

await seed();
console.log('\n# corrections (who, when, why — never changed afterwards)');
const gP = 'p' + 'b'.repeat(24), kP = 'p' + 'c'.repeat(24), sP = 'p' + 'd'.repeat(24);
await put('tcPunch/' + gP, { sid: 'gwen', kind: 'in', at: ago(600), src: 'kiosk', by: 'kiosk1' });
await put('tcPunch/' + kP, { sid: 'kim', kind: 'in', at: ago(600), src: 'kiosk', by: 'kiosk1' });
await put('tcPunch/' + sP, { sid: 'sarah', kind: 'in', at: ago(600), src: 'kiosk', by: 'kiosk1' });
const fix = (o) => Object.assign({ sid: 'gwen', op: 'add', ref: '', kind: 'out', t: Date.now() - 60000, why: 'Forgot to clock out', by: 'fc', bsid: 'sarah', at: serverTimestamp() }, o || {});
await ok('a manager adds a missing clock-out', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix()));
await no('…with no reason', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ why: '' })));
await no('…more than an hour ahead', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ t: Date.now() + 2 * 3600000 })));
await no('…as someone else', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ by: 'owner', bsid: 'amir' })));
await no('…for someone not on the clock list', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ sid: 'nobody' })));
await ok('a manager takes out a punch', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ op: 'void', ref: gP, kind: '', t: 0 })));
await no('…not saying it’s someone else’s', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ op: 'void', ref: kP, kind: '', t: 0 })));
await no('…not one that doesn’t exist', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ op: 'void', ref: 'p' + 'e'.repeat(24), kind: '', t: 0 })));
const added = fid();
await setDoc(doc(as('fc'), 'tcFix/' + added), fix());
await ok('…or takes back a correction', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ op: 'void', ref: added, kind: '', t: 0 })));
await no('a manager can’t correct their own time (Sarah)', setDoc(doc(as('fc'), 'tcFix/' + fid()), fix({ sid: 'sarah' })));
await ok('Dr. A can correct anyone’s, his own included', setDoc(doc(as('owner'), 'tcFix/' + fid()), fix({ sid: 'sarah', by: 'owner', bsid: 'amir' })));
await no('staff can’t correct anything', setDoc(doc(as('ca'), 'tcFix/' + fid()), fix({ by: 'ca', bsid: 'gwen' })));
await no('the time clock can’t', setDoc(doc(kiosk('kiosk1'), 'tcFix/' + fid()), fix({ by: 'kiosk1', bsid: '' })));
await no('a correction can’t be changed', updateDoc(doc(as('owner'), 'tcFix/' + added), { why: 'other' }));
await no('…or deleted', deleteDoc(doc(as('owner'), 'tcFix/' + added)));
await ok('staff see the corrections to their own time', getDocs(query(collection(as('ca'), 'tcFix'), where('sid', '==', 'gwen'))));
await no('…not anyone else’s', getDocs(query(collection(as('ca'), 'tcFix'), where('sid', '==', 'kim'))));

await seed();
console.log('\n# asking a manager to fix their time (a missed punch, or a note)');
let rn = 0; const rid = () => 'r' + (++rn).toString(16).padStart(24, '0');
const ask = (o) => Object.assign({ sid: 'gwen', ps: [{ k: 'in', t: Date.now() - 3 * 3600000 }], note: 'Forgot to clock in', src: 'kiosk', by: 'kiosk1', at: serverTimestamp(), st: 'open' }, o || {});
const kk = kiosk('kiosk1');
/* a request the way the page sends it: with its count (at most 10 in 24 hours for each person), in one save */
async function askB(db, id, data) {
  const cur = await raw('tcReqN/' + data.sid), fresh = !cur || Date.now() > cur.t0.toMillis() + 86400000, b = writeBatch(db);
  b.set(doc(db, 'tcReqN/' + data.sid), fresh ? { n: 1, t0: serverTimestamp(), at: serverTimestamp() } : { n: cur.n + 1, t0: cur.t0, at: serverTimestamp() });
  b.set(doc(db, 'tcReq/' + id), data);
  return b.commit();
}
await no('at the time clock, not without the person’s PIN', askB(kk, rid(), ask()));
await nextTry(kk, 'gwen', '1234'); await check(kk, 'gwen');
const R1 = rid();
await ok('right after the PIN: a missed clock-in', askB(kk, R1, ask()));
await ok('…and the PIN still punches (asking doesn’t use it up)', punchBatch(kk, 'gwen', 'lunch'));
await no('…but once the punch used it, nothing more', askB(kk, rid(), ask()));
await nextTry(kk, 'gwen', '1234'); await check(kk, 'gwen');
await no('…not for someone else', askB(kk, rid(), ask({ sid: 'kim' })));
await no('…not from another time clock', askB(kiosk('kiosk2'), rid(), ask({ by: 'kiosk2' })));
await no('…not marked as from My time', askB(kk, rid(), ask({ src: 'me' })));
await no('…not already answered', askB(kk, rid(), ask({ st: 'ok' })));
await no('…not with the device’s own time', askB(kk, rid(), ask({ at: Timestamp.fromMillis(Date.now() - 60000) })));
await no('…not three punches', askB(kk, rid(), ask({ ps: [{ k: 'in', t: Date.now() - 4 * 3600000 }, { k: 'lunch', t: Date.now() - 3 * 3600000 }, { k: 'back', t: Date.now() - 2 * 3600000 }] })));
await ok('…a lunch: out and back', askB(kk, rid(), ask({ ps: [{ k: 'lunch', t: Date.now() - 3 * 3600000 }, { k: 'back', t: Date.now() - 2.5 * 3600000 }], note: '' })));
await no('…not a kind that isn’t a punch', askB(kk, rid(), ask({ ps: [{ k: 'start', t: Date.now() - 3600000 }] })));
await no('…not a punch with anything else in it', askB(kk, rid(), ask({ ps: [{ k: 'in', t: Date.now() - 3600000, hrs: 9 }] })));
await no('…not hours ahead', askB(kk, rid(), ask({ ps: [{ k: 'out', t: Date.now() + 2 * 3600000 }] })));
await no('…not over a month back', askB(kk, rid(), ask({ ps: [{ k: 'out', t: Date.now() - 40 * 86400000 }] })));
await no('…not a time that isn’t a number', askB(kk, rid(), ask({ ps: [{ k: 'out', t: 'yesterday' }] })));
await ok('…just a note', askB(kk, rid(), ask({ ps: [], note: 'Stayed until 6 for the emergency patient' })));
await no('…not an empty one', askB(kk, rid(), ask({ ps: [], note: '' })));
await no('…not a note over 200 characters', askB(kk, rid(), ask({ note: 'x'.repeat(201) })));
await no('…not with anything extra', askB(kk, rid(), Object.assign(ask(), { hrs: 8 })));
await no('…not without its count', setDoc(doc(kk, 'tcReq/' + rid()), ask({ note: 'uncounted' })));
await no('…not under an id that isn’t one', askB(kk, 'x1', ask()));
await seedTry('gwen', { t0: ago(12), at: ago(11), ok: true }, '1234');
await no('…not 10 minutes after the PIN', askB(kk, rid(), ask()));
await seedTry('gwen', { t0: ago(7), at: ago(6), ok: true }, '1234');
await ok('…6 minutes after is fine (the form takes a moment)', askB(kk, rid(), ask({ note: 'second' })));
await no('…but a punch 6 minutes after the PIN isn’t', punchBatch(kk, 'gwen', 'out'));
await seedTry('lee', { ok: true }, '1234');
await no('…someone who left can’t ask', askB(kk, rid(), ask({ sid: 'lee' })));
const mine = (uid, o) => askB(as(uid), rid(), ask(Object.assign({ src: 'me', by: uid }, o || {})));
await ok('signed in: Kim asks for her own (she isn’t allowed home: asking is fine)', mine('ca2', { sid: 'kim' }));
await no('nobody uses up a coworker’s requests (Gwen, Kim’s count)', setDoc(doc(as('ca'), 'tcReqN/kim'), { n: 9, t0: serverTimestamp(), at: serverTimestamp() }));
await no('…nor the time clock without her PIN', setDoc(doc(kk, 'tcReqN/kim'), { n: 9, t0: serverTimestamp(), at: serverTimestamp() }));
await put('tcReqN/kim', { n: 10, t0: ago(60), at: ago(60) });
await no('the 11th request in 24 hours is refused', mine('ca2', { sid: 'kim', note: 'eleven' }));
await put('tcReqN/kim', { n: 10, t0: ago(25 * 60), at: ago(25 * 60) });
await ok('…a fresh 24 hours once those are over', mine('ca2', { sid: 'kim', note: 'fresh day' }));
await no('…not for a coworker', mine('ca2', { sid: 'gwen' }));
await no('…not marked as the time clock', mine('ca2', { sid: 'kim', src: 'kiosk' }));
await no('…not as someone else', askB(as('ca2'), rid(), ask({ sid: 'kim', src: 'me', by: 'ca' })));
await no('someone off the clock (Dr. A) has nothing to ask', mine('owner', { sid: 'amir' }));
await no('someone who left can’t ask signed in', mine('gone', { sid: 'lee' }));
await no('a stranger can’t', mine('stranger', { sid: 'gwen' }));
await no('the alert script can’t ask', askB(as('bot1'), rid(), ask({ by: 'bot1' })));

await ok('a manager reads them all', getDocs(collection(as('fc'), 'tcReq')));
await ok('the time clock reads them (who asked for what)', getDocs(collection(kk, 'tcReq')));
await ok('the alert script reads the waiting ones', getDocs(query(collection(as('bot1'), 'tcReq'), where('st', '==', 'open'))));
await ok('staff read their own', getDocs(query(collection(as('ca'), 'tcReq'), where('sid', '==', 'gwen'))));
await no('…not a coworker’s', getDocs(query(collection(as('ca'), 'tcReq'), where('sid', '==', 'kim'))));
await no('…not everyone’s', getDocs(collection(as('ca'), 'tcReq')));
await no('a stranger reads none', getDocs(collection(as('stranger'), 'tcReq')));

const answer = (uid, sid, o) => Object.assign({ st: 'ok', rby: uid, rbsid: sid, rat: serverTimestamp(), rwhy: '', fx: [] }, o || {});
{
  const db = as('fc'), b = writeBatch(db), f = fid();
  b.set(doc(db, 'tcFix/' + f), fix({ kind: 'in', t: Date.now() - 3 * 3600000, why: 'Asked by Gwen at the time clock: Forgot to clock in' }));
  b.update(doc(db, 'tcReq/' + R1), answer('fc', 'sarah', { fx: [f] }));
  await ok('a manager approves: the correction and the answer in one save', b.commit());
}
{
  const RX = rid(); await put('tcReq/' + RX, Object.assign(ask(), { at: now() }));
  await no('…not “approved” without the correction it asks for', updateDoc(doc(as('fc'), 'tcReq/' + RX), answer('fc', 'sarah', { fx: [] })));
  await no('…nor with a correction that doesn’t exist', updateDoc(doc(as('fc'), 'tcReq/' + RX), answer('fc', 'sarah', { fx: ['f' + 'e'.repeat(24)] })));
  await no('…nor declined with corrections', updateDoc(doc(as('fc'), 'tcReq/' + RX), answer('fc', 'sarah', { st: 'no', fx: ['f' + 'e'.repeat(24)] })));
}
await no('…answered once (it isn’t waiting any more)', updateDoc(doc(as('owner'), 'tcReq/' + R1), answer('owner', 'amir', { st: 'no' })));
const RK = (await getDocs(query(collection(as('ca2'), 'tcReq'), where('sid', '==', 'kim')))).docs[0].id;
await no('staff can’t answer', updateDoc(doc(as('ca'), 'tcReq/' + RK), answer('ca', 'gwen')));
await no('the time clock can’t', updateDoc(doc(kk, 'tcReq/' + RK), answer('kiosk1', '')));
await no('the alert script can’t', updateDoc(doc(as('bot1'), 'tcReq/' + RK), answer('bot1', '')));
await no('a manager can’t change what was asked', updateDoc(doc(as('fc'), 'tcReq/' + RK), answer('fc', 'sarah', { ps: [] })));
await no('…or answer as someone else', updateDoc(doc(as('fc'), 'tcReq/' + RK), answer('owner', 'amir')));
await no('…or answer something other than yes or no', updateDoc(doc(as('fc'), 'tcReq/' + RK), answer('fc', 'sarah', { st: 'x' })));
await ok('a manager declines, with a note for her', updateDoc(doc(as('fc'), 'tcReq/' + RK), answer('fc', 'sarah', { st: 'no', rwhy: 'You clocked in at 8:30; see me' })));
const RS = rid();
await ok('Sarah (a manager) asks for her own missed punch', askB(as('fc'), RS, ask({ sid: 'sarah', src: 'me', by: 'fc' })));
await no('…she can’t approve it herself', updateDoc(doc(as('fc'), 'tcReq/' + RS), answer('fc', 'sarah')));
await ok('…Dr. A can', updateDoc(doc(as('owner'), 'tcReq/' + RS), answer('owner', 'amir', { st: 'no' })));
const RW = rid();
await mine('ca2', { sid: 'kim' }).catch(() => { });
await askB(as('ca2'), RW, ask({ sid: 'kim', src: 'me', by: 'ca2', note: 'take back' }));
await no('a coworker can’t take it back', updateDoc(doc(as('ca'), 'tcReq/' + RW), { st: 'x', rat: serverTimestamp() }));
await no('…nor can Kim change it', updateDoc(doc(as('ca2'), 'tcReq/' + RW), { note: 'other', rat: serverTimestamp() }));
await ok('Kim takes her own back while it waits', updateDoc(doc(as('ca2'), 'tcReq/' + RW), { st: 'x', rat: serverTimestamp() }));
await no('…once', updateDoc(doc(as('ca2'), 'tcReq/' + RW), { st: 'x', rat: serverTimestamp() }));
const RT = rid();
await nextTry(kk, 'gwen', '1234'); await check(kk, 'gwen');
await askB(kk, RT, ask({ note: 'at the clock' }));
await ok('at the time clock, right after the PIN, Gwen takes hers back', updateDoc(doc(kk, 'tcReq/' + RT), { st: 'x', rat: serverTimestamp() }));
const RT2 = rid();
await askB(kk, RT2, ask({ note: 'at the clock 2' }));
await setDoc(doc(kk, 'tcTry/gwen'), cleared());
await no('…not without the PIN', updateDoc(doc(kk, 'tcReq/' + RT2), { st: 'x', rat: serverTimestamp() }));
await no('nobody deletes a request (not Dr. A)', deleteDoc(doc(as('owner'), 'tcReq/' + RT2)));

console.log('\n# overtime approved ahead of time');
const ot = (o) => Object.assign({ sid: 'gwen', week: '2026-10-11', hrs: 44, why: 'Covering for Kim', by: 'fc', bsid: 'sarah', at: serverTimestamp() }, o || {});
await ok('a manager approves up to 44 h for a week', setDoc(doc(as('fc'), 'tcOT/gwen_2026-10-11'), ot()));
await no('…under the wrong id', setDoc(doc(as('fc'), 'tcOT/gwen_2026-10-18'), ot()));
await no('…their own (Sarah)', setDoc(doc(as('fc'), 'tcOT/sarah_2026-10-11'), ot({ sid: 'sarah' })));
await ok('Dr. A, anyone’s', setDoc(doc(as('owner'), 'tcOT/sarah_2026-10-11'), ot({ sid: 'sarah', by: 'owner', bsid: 'amir' })));
await no('staff can’t approve their own', setDoc(doc(as('ca'), 'tcOT/gwen_2026-10-11'), ot({ by: 'ca', bsid: 'gwen' })));
await ok('a manager takes an approval back', deleteDoc(doc(as('fc'), 'tcOT/gwen_2026-10-11')));
await ok('staff see their own approvals', getDocs(query(collection(as('ca'), 'tcOT'), where('sid', '==', 'gwen'))));

console.log('\n# the alert script: reads the clock, writes only its log and check-in');
const sent = (o) => Object.assign({ k: 'thr|gwen|2026-10-11|36', type: 'thr', sid: 'gwen', text: 'Gwen: 36 h this week', st: 'claim', ch: 0, at: serverTimestamp(), up: serverTimestamp() }, o || {});
const AID = 'a' + '1'.repeat(32);
await ok('the script claims an alert before sending it', setDoc(doc(as('bot1'), 'tcSent/' + AID), sent()));
await ok('…and marks it sent', updateDoc(doc(as('bot1'), 'tcSent/' + AID), { st: 'sent', ch: 3, up: serverTimestamp() }));
await no('…but can’t change what it was', updateDoc(doc(as('bot1'), 'tcSent/' + AID), { k: 'other', up: serverTimestamp() }));
await no('a claim must start as a claim', setDoc(doc(as('bot1'), 'tcSent/' + 'a' + '2'.repeat(32)), sent({ st: 'sent' })));
await no('staff can’t write the log', setDoc(doc(as('ca'), 'tcSent/' + 'a' + '3'.repeat(32)), sent()));
await ok('a manager reads the log', getDocs(collection(as('fc'), 'tcSent')));
await no('staff can’t', getDocs(collection(as('ca'), 'tcSent')));
await ok('the script checks in', setDoc(doc(as('bot1'), 'tcBeat/bot1'), { box: 'records@example.com', ver: '1', err: '', sent: 2, at: serverTimestamp() }));
await no('…only as itself', setDoc(doc(as('bot1'), 'tcBeat/bot2'), { box: 'x', ver: '1', err: '', sent: 0, at: serverTimestamp() }));
await ok('a manager sees the check-in', getDoc(doc(as('fc'), 'tcBeat/bot1')));
await no('the script can’t punch', setDoc(doc(as('bot1'), 'tcPunch/' + pid()), { sid: 'gwen', kind: 'in', at: serverTimestamp(), src: 'kiosk', by: 'bot1', net: '' }));
await no('…or correct time', setDoc(doc(as('bot1'), 'tcFix/' + fid()), fix({ by: 'bot1', bsid: '' })));
await no('…or change settings', updateDoc(doc(as('bot1'), 'meta/tcAlerts'), { emails: ['evil@example.com'], at: serverTimestamp() }));
await ok('the script reads names from the roster', getDocs(collection(as('bot1'), 'roster')));
await ok('the time clock reads names and photos from the roster', getDocs(collection(kiosk('kiosk2'), 'roster')));
await no('…but can’t change the roster', updateDoc(doc(kiosk('kiosk2'), 'roster/gwen'), { name: 'X' }));
await no('a stranger can’t read the roster', getDocs(collection(as('stranger'), 'roster')));
await ok('a member still reads the roster', getDocs(collection(as('ca'), 'roster')));

console.log('\n# time-clock computers and the script’s login');
await ok('Dr. A sets up a time-clock computer', setDoc(doc(as('owner'), 'tcKiosks/kiosk3'), { name: 'Front desk', at: serverTimestamp(), by: 'owner' }));
await no('a manager can’t', setDoc(doc(as('fc'), 'tcKiosks/kiosk4'), { name: 'Front desk', at: serverTimestamp(), by: 'fc' }));
await ok('the time clock checks in', updateDoc(doc(kiosk('kiosk2'), 'tcKiosks/kiosk2'), { seen: serverTimestamp() }));
await no('…but can’t rename itself', updateDoc(doc(kiosk('kiosk2'), 'tcKiosks/kiosk2'), { name: 'Mine' }));
await no('…or check in as another', updateDoc(doc(kiosk('kiosk2'), 'tcKiosks/kiosk3'), { seen: serverTimestamp() }));
await ok('a manager lists them', getDocs(collection(as('fc'), 'tcKiosks')));
await no('staff can’t', getDocs(collection(as('ca'), 'tcKiosks')));
await ok('Dr. A removes one', deleteDoc(doc(as('owner'), 'tcKiosks/kiosk3')));
await ok('Dr. A makes the script’s login', setDoc(doc(as('owner'), 'tcBots/bot2'), { email: 'clockbot2@example.com', at: serverTimestamp() }));
await no('a manager can’t', setDoc(doc(as('fc'), 'tcBots/bot3'), { email: 'x@example.com', at: serverTimestamp() }));
await ok('the rules level is readable to the clock', getDoc(doc(kiosk('kiosk2'), 'meta/rules_tc_1')));
await ok('…and to staff', getDoc(doc(as('ca'), 'meta/rules_tc_1')));
await no('…not to a stranger', getDoc(doc(as('stranger'), 'meta/rules_tc_1')));
await ok('the new rules level (the office lock) is readable to the clock', getDoc(doc(kiosk('kiosk2'), 'meta/rules_tc_2')));
await ok('…and to staff', getDoc(doc(as('ca'), 'meta/rules_tc_2')));
await no('…not to a stranger', getDoc(doc(as('stranger'), 'meta/rules_tc_2')));
await no('the time clock reads nothing of NLO Cases', getDocs(collection(kiosk('kiosk2'), 'cases')));
await no('…or Time Off', getDocs(collection(kiosk('kiosk2'), 'toReq')));
await no('…or the members list', getDocs(collection(kiosk('kiosk2'), 'members')));
await no('the alert script reads nothing of Time Off', getDocs(collection(as('bot1'), 'toReq')));

await seed();
/* the office check (the Worker, under its own login) writes down which network a login was on, with the database's time
   and a one-time punch number (only the page that asked is told it: an "at the office" punch is saved under it) */
const netbot = () => as('netbot1');
const PIDS = {}; // the last punch number the office check gave each login
const seen = (uid, net, o) => { const p = (o && o.pid) || pid(); PIDS[uid] = p; return setDoc(doc(netbot(), 'tcNetSeen/' + uid), Object.assign({ net, office: false, org: 'Cox Business', city: 'Gainesville, Florida', pid: p, relay: false, at: serverTimestamp() }, o || {})); };
const seenAgo = (uid, net, m) => { const p = pid(); PIDS[uid] = p; return put('tcNetSeen/' + uid, { net, office: false, org: '', city: '', pid: p, relay: false, at: ago(m) }); };
const lockOn = on => put('meta/tc', Object.assign({ at: now() }, SETTINGS, { lock: on, wurl: 'https://nlo-office-check.amir.workers.dev' }));
const own = (uid, sid, extra, id) => setDoc(doc(as(uid), 'tcPunch/' + (id || PIDS[uid] || pid())), Object.assign({ sid, kind: 'in', at: serverTimestamp(), src: 'own', by: uid, net: 'office' }, extra || {}));

console.log('\n# the office check’s login (it writes down networks, nothing else)');
await ok('it writes down the network a login is on, with the database’s time and a punch number', seen('ca', OFFICE));
await ok('…an IPv6 network (the first half of the address)', seen('ca', OFFICE6));
await ok('…an address many people share, marked so (Private Relay, a VPN)', seen('ca', 'v4:172.225.10.4', { relay: true }));
await no('…not with its own time', seen('ca', OFFICE, { at: ago(1) }));
await no('…not something that isn’t a network', seen('ca', 'v4:203.0.113'));
await no('…not a whole IPv6 address', seen('ca', 'v6:2600:1700:abcd:12:1:2:3:4'));
await no('…not with anything extra', seen('ca', OFFICE, { ok: true }));
await no('…not without a punch number', setDoc(doc(netbot(), 'tcNetSeen/ca'), { net: OFFICE, office: true, org: '', city: '', relay: false, at: serverTimestamp() }));
await no('…not a punch number of another shape', seen('ca', OFFICE, { pid: 'p123' }));
await no('…“shared address” is yes or no', seen('ca', OFFICE, { relay: 'no' }));
await no('…nothing for a login that isn’t the office’s (anyone can make a login)', seen('stranger', OFFICE));
await ok('…for the time clock', seen('kiosk1', OFFICE));
await ok('…and an approved laptop', seen('lap1', HOME));
await no('staff can’t write down their own network', setDoc(doc(as('ca'), 'tcNetSeen/ca'), { net: OFFICE, office: true, org: '', city: '', pid: pid(), relay: false, at: serverTimestamp() }));
await no('…nor can the time clock', setDoc(doc(kiosk('kiosk1'), 'tcNetSeen/kiosk1'), { net: OFFICE, office: true, org: '', city: '', pid: pid(), relay: false, at: serverTimestamp() }));
await no('…nor the alert script', setDoc(doc(as('bot1'), 'tcNetSeen/ca'), { net: OFFICE, office: true, org: '', city: '', pid: pid(), relay: false, at: serverTimestamp() }));
await no('…nor Dr. A', setDoc(doc(as('owner'), 'tcNetSeen/owner'), { net: OFFICE, office: true, org: '', city: '', pid: pid(), relay: false, at: serverTimestamp() }));
await no('nobody reads their own punch number back (only the page that asked was told it)', getDoc(doc(as('ca'), 'tcNetSeen/ca')));
await no('…nor a coworker’s', getDoc(doc(as('ca2'), 'tcNetSeen/ca')));
await no('…nor the time clock its own', getDoc(doc(kiosk('kiosk1'), 'tcNetSeen/kiosk1')));
await no('…nor the office check (it only writes)', getDoc(doc(netbot(), 'tcNetSeen/ca')));
await ok('Dr. A reads where a time clock was', getDoc(doc(as('owner'), 'tcNetSeen/kiosk1')));
await ok('the office check reads the office’s networks', getDoc(doc(netbot(), 'tcOffice/' + OFFICE)));
await no('…but no punches', getDocs(collection(netbot(), 'tcPunch')));
await no('…no one’s clock settings', getDoc(doc(netbot(), 'tcStaff/gwen')));
await no('…not where alerts go', getDoc(doc(netbot(), 'meta/tcAlerts')));
await no('…nothing of NLO Cases', getDocs(collection(netbot(), 'cases')));
await no('…not the members', getDoc(doc(netbot(), 'members/ca')));
await no('…it can’t punch', setDoc(doc(netbot(), 'tcPunch/' + pid()), { sid: 'gwen', kind: 'in', at: serverTimestamp(), src: 'own', by: 'netbot1', net: 'office' }));
await no('…or save an office network', setDoc(doc(netbot(), 'tcOffice/' + HOME), { name: 'Home', org: '', city: '', by: 'netbot1', at: serverTimestamp() }));
await no('…or approve a laptop', setDoc(doc(netbot(), 'tcLaptops/netbot1'), { name: 'x', sids: ['gwen'], at: serverTimestamp(), by: 'netbot1' }));
await no('staff can’t see the office’s networks', getDocs(collection(as('ca'), 'tcOffice')));
await no('…nor can a manager (Dr. A’s setting)', getDocs(collection(as('fc'), 'tcOffice')));
await ok('Dr. A makes the office check’s login', setDoc(doc(as('owner'), 'tcNetBot/netbot2'), { email: 'netbot2@example.com', at: serverTimestamp() }));
await ok('…lists them (the old one stops once the new one answers)', getDocs(collection(as('owner'), 'tcNetBot')));
await ok('…and turns the old one off', deleteDoc(doc(as('owner'), 'tcNetBot/netbot2')));
await no('a manager can’t', setDoc(doc(as('fc'), 'tcNetBot/netbot3'), { email: 'x@example.com', at: serverTimestamp() }));
await ok('the office check reads the rules level', getDoc(doc(netbot(), 'meta/rules_tc_2')));

console.log('\n# the office’s networks (This is the office)');
const office = (uid, net, o) => setDoc(doc(as(uid), 'tcOffice/' + net), Object.assign({ name: 'Office Wi-Fi', org: 'Cox Business', city: 'Gainesville, Florida', by: uid, at: serverTimestamp() }, o || {}));
await seen('owner', OFFICE6);
await ok('Dr. A saves the network he’s on right now', office('owner', OFFICE6));
await no('…not a network he isn’t on', office('owner', 'v4:203.0.113.99'));
await seenAgo('owner', 'v4:203.0.113.20', 6);
await no('…not one he was on more than 5 minutes ago', office('owner', 'v4:203.0.113.20'));
await seen('owner', 'v4:172.225.10.4', { relay: true });
await no('…never an address many people share (iCloud Private Relay, a VPN)', office('owner', 'v4:172.225.10.4'));
await seen('owner', 'v4:203.0.113.22');
await no('…not with a field the older page sent', office('owner', 'v4:203.0.113.22', { via: '' }));
await seen('kiosk1', 'v4:203.0.113.30');
await no('…not the one a time clock is on, from somewhere else (only where he is himself)', office('owner', 'v4:203.0.113.30'));
await seen('fc', 'v4:203.0.113.21');
await no('a manager can’t save one, even the one she’s on', office('fc', 'v4:203.0.113.21'));
await no('a name that isn’t a network', office('owner', 'office'));
await no('…a name too long', office('owner', OFFICE6, { name: 'x'.repeat(41) }));
await ok('Dr. A renames one', updateDoc(doc(as('owner'), 'tcOffice/' + OFFICE6), { name: 'Office (IPv6)' }));
await no('…but nothing else about it', updateDoc(doc(as('owner'), 'tcOffice/' + OFFICE6), { org: 'Somewhere' }));
await ok('…and removes one', deleteDoc(doc(as('owner'), 'tcOffice/' + OFFICE6)));
await ok('Dr. A turns the office lock on, with the office check’s address', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS, { lock: true, wurl: 'https://nlo-office-check.amir.workers.dev' })));
await no('…not an address that isn’t on workers.dev', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS, { lock: true, wurl: 'https://check.example.com' })));
await no('…nor a plain http one', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS, { wurl: 'http://nlo-office-check.amir.workers.dev' })));
await no('…nor one with a path', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS, { wurl: 'https://nlo-office-check.amir.workers.dev/x' })));
await no('…on is yes or no', setDoc(doc(as('owner'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS, { lock: 'on' })));
await no('a manager can’t turn it on', setDoc(doc(as('fc'), 'meta/tc'), Object.assign({ at: serverTimestamp() }, SETTINGS, { lock: true })));

await seed();
console.log('\n# on their own phone or computer, at the office');
await seen('ca', OFFICE);
await no('with the office lock off: not even on the office network', own('ca', 'gwen'));
await lockOn(true);
await ok('with it on, on the office network: Gwen clocks in on her phone (under the punch number the check gave)', own('ca', 'gwen'));
await no('…once: the same number can’t punch again', own('ca', 'gwen', { kind: 'lunch' }));
await no('…nor can another number (a check is good for one punch)', own('ca', 'gwen', { kind: 'lunch' }, pid()));
await seen('ca', OFFICE);
await ok('…a new check: she goes to lunch (everything at the office)', own('ca', 'gwen', { kind: 'lunch' }));
await seen('ca', OFFICE);
const oldPid = PIDS.ca;
await seen('ca', OFFICE);
await no('…a newer check replaces the number it gave before (another tab, say)', own('ca', 'gwen', { kind: 'back' }, oldPid));
await no('…not saying it wasn’t checked', own('ca', 'gwen', { net: '' }));
await no('…nor that it was another network', own('ca', 'gwen', { net: 'off' }));
await no('…not with her own time', own('ca', 'gwen', { at: Timestamp.fromMillis(Date.now() - 600000) }));
await no('…not for a coworker', own('ca', 'kim'));
await no('…not marked as the time clock', own('ca', 'gwen', { src: 'kiosk' }));
await no('…not marked as a laptop', own('ca', 'gwen', { src: 'laptop' }));
await no('someone the office check never saw can’t', own('ca2', 'kim', null, pid()));
await seen('ca2', HOME);
await no('Kim, on another network (home), can’t', own('ca2', 'kim'));
await seenAgo('ca2', OFFICE, 3);
await no('…nor on the office network 3 minutes ago (the check is right before the punch)', own('ca2', 'kim'));
await seen('ca2', OFFICE);
await no('…nor with a coworker’s punch number', own('ca2', 'kim', null, PIDS.ca));
await ok('Kim (not allowed home) clocks in on her phone at the office', own('ca2', 'kim'));
await put('tcOffice/' + OFFICE6, { name: 'Office (IPv6)', org: '', city: '', by: 'owner', at: now() });
await seen('fc', OFFICE6);
await ok('…an IPv6 office network works too (Sarah)', own('fc', 'sarah'));
await seen('wfh', HOME);
await no('Wila, allowed home, can’t clock in on her phone at home', own('wfh', 'wila'));
await put('tcNetSeen/gone', { net: OFFICE, office: true, org: '', city: '', pid: pid(), relay: false, at: now() });
await no('someone who left can’t, even seen at the office', own('gone', 'lee', null, (await raw('tcNetSeen/gone')).pid));
await put('tcNetSeen/stranger', { net: OFFICE, office: true, org: '', city: '', pid: pid(), relay: false, at: now() });
await no('a stranger can’t', own('stranger', 'gwen', null, (await raw('tcNetSeen/stranger')).pid));
await seen('owner', OFFICE);
await no('nor anyone off the clock (Dr. A)', own('owner', 'amir'));
await wipe('tcOffice/' + OFFICE);
await seen('ca', OFFICE);
await no('a network Dr. A removed isn’t the office any more', own('ca', 'gwen', { kind: 'out' }));
await lockOn(false);

await seed();
console.log('\n# the time clock and the network (never refused, flagged when off it)');
const kn = kiosk('kiosk1'), tryOk = async (db, sid) => { await nextTry(db, sid, '1234'); await check(db, sid); };
await tryOk(kn, 'gwen');
await ok('office lock off: not checked', punchBatch(kn, 'gwen', 'in'));
await lockOn(true);
await tryOk(kn, 'gwen');
await no('lock on: it has to say where it was', punchBatch(kn, 'gwen', 'out'));
await no('…not “at the office” without the office check', punchBatch(kn, 'gwen', 'out', { net: 'office' }));
await seen('kiosk1', OFFICE);
await no('…nor under another number than the check gave', punchBatch(kn, 'gwen', 'out', { net: 'office' }));
await ok('…“at the office” under the check’s number', punchBatch(kn, 'gwen', 'out', { net: 'office' }, PIDS.kiosk1));
await tryOk(kn, 'gwen');
await no('…once (the next one needs a new check)', punchBatch(kn, 'gwen', 'in', { net: 'office' }, PIDS.kiosk1));
await ok('…refused, the time clock saves it anyway, flagged (it couldn’t check)', punchBatch(kn, 'gwen', 'in', { net: 'unk' }));
await tryOk(kn, 'kim');
await ok('another network: it goes through (flagged)', punchBatch(kn, 'kim', 'in', { net: 'off' }));
await tryOk(kn, 'kim');
await ok('…and when it couldn’t check (flagged)', punchBatch(kn, 'kim', 'out', { net: 'unk' }));
await tryOk(kn, 'kim');
await no('…but nothing else', punchBatch(kn, 'kim', 'in', { net: 'home' }));
await seen('kiosk2', HOME);
const k2n = kiosk('kiosk2');
await tryOk(k2n, 'kim');
await no('a time clock on another network can’t say it’s at the office', punchBatch(k2n, 'kim', 'in', { net: 'office' }, PIDS.kiosk2));
await seen('kiosk1', OFFICE);
await no('…nor use the number another time clock was given', punchBatch(k2n, 'kim', 'in', { net: 'office' }, PIDS.kiosk1));
await lockOn(false);

await seed();
console.log('\n# approved laptops (for the people Dr. A picked; from home: in and out, marked Home)');
const lap = uid => kiosk(uid);
const L1 = lap('lap1'), L2 = lap('lap2');
const lapAsk = (uid, o) => setDoc(doc(as(uid), 'tcLapReq/' + uid), Object.assign({ code: '482913', dev: 'Chrome on Windows', at: serverTimestamp() }, o || {}));
const approve = (db, uid, o) => { const b = writeBatch(db); b.set(doc(db, 'tcLaptops/' + uid), Object.assign({ name: 'Wila’s laptop', sids: ['wila'], at: serverTimestamp(), by: 'owner' }, o || {})); b.delete(doc(db, 'tcLapReq/' + uid)); return b.commit(); };
await no('Dr. A can’t approve a laptop that didn’t ask', approve(as('owner'), 'lap3'));
await ok('a laptop asks to be approved (its own new login, with the code it shows)', lapAsk('lap3'));
await no('…not for another login', setDoc(doc(as('lap3'), 'tcLapReq/lap9'), { code: '482913', dev: 'Chrome on Windows', at: serverTimestamp() }));
await no('…not a code that isn’t 6 digits', lapAsk('lap5', { code: '12345' }));
await no('…not with anything extra', lapAsk('lap5', { sids: ['wila'] }));
await no('…not with its own time', lapAsk('lap5', { at: ago(1) }));
await no('…not words of its own to show Dr. A (it only says which browser)', lapAsk('lap5', { dev: 'Wila’s laptop – code 482 913' }));
await ok('…which browser, as the page says it', lapAsk('lap8', { dev: 'Safari on a Mac' }));
await no('staff can’t ask with their own login (a laptop has its own)', lapAsk('ca'));
await ok('the laptop reads its request', getDoc(doc(as('lap3'), 'tcLapReq/lap3')));
await ok('…and waits for its approval', getDoc(doc(as('lap3'), 'tcLaptops/lap3')));
await no('…but can’t change its request', updateDoc(doc(as('lap3'), 'tcLapReq/lap3'), { code: '111111' }));
await no('…approve itself', approve(as('lap3'), 'lap3', { by: 'lap3' }));
await no('…or read anything yet', getDoc(doc(as('lap3'), 'tcStaff/wila')));
await no('…nor take a PIN', tryDoc(kiosk('lap3'), 'wila', '1234'));
await no('…and the office check writes nothing down for it yet', seen('lap3', HOME));
await no('a coworker can’t read the request (its code)', getDoc(doc(as('ca'), 'tcLapReq/lap3')));
await no('…nor list them', getDocs(collection(as('ca'), 'tcLapReq')));
await no('…nor can a manager', getDocs(collection(as('fc'), 'tcLapReq')));
await ok('Dr. A lists them', getDocs(collection(as('owner'), 'tcLapReq')));
await no('a manager can’t approve one', approve(as('fc'), 'lap3', { by: 'fc' }));
await ok('Dr. A approves it (for Wila), and the request goes', approve(as('owner'), 'lap3'));
is('…its request is gone', !(await raw('tcLapReq/lap3')));
await ok('the laptop reads its approval', getDoc(doc(as('lap3'), 'tcLaptops/lap3')));
await lapAsk('lap4');
await no('…not for nobody', approve(as('owner'), 'lap4', { sids: [] }));
await no('…not for 5 people', approve(as('owner'), 'lap4', { sids: ['a', 'b', 'c', 'd', 'e'] }));
await no('…not with anything extra', approve(as('owner'), 'lap4', { home: true }));
await ok('Dr. A turns one down', deleteDoc(doc(as('owner'), 'tcLapReq/lap4')));
await lapAsk('lap6');
await no('a laptop can’t clear its own request (each login asks once; only Dr. A clears them)', deleteDoc(doc(as('lap6'), 'tcLapReq/lap6')));
await no('…nor ask again with the same login', lapAsk('lap6', { code: '111111' }));
await lapAsk('lap7');
await no('…nor clear someone else’s', deleteDoc(doc(as('lap6'), 'tcLapReq/lap7')));
await put('tcLapReq/lap9', { code: '246810', dev: 'Chrome on Windows', at: ago(31) });
await no('Dr. A can’t approve a request older than 30 minutes (its code ran out)', approve(as('owner'), 'lap9'));
await put('tcLapReq/lap9', { code: '246810', dev: 'Chrome on Windows', at: ago(29) });
await ok('…29 minutes old, yes', approve(as('owner'), 'lap9'));
await ok('the laptop reads the clock’s settings', getDoc(doc(L1, 'meta/tc')));
await ok('…and its own person’s clock settings', getDoc(doc(L1, 'tcStaff/wila')));
await no('…not anyone else’s', getDoc(doc(L1, 'tcStaff/gwen')));
await no('…nor the whole list', getDocs(collection(L1, 'tcStaff')));
await ok('…its person’s name and photo', getDoc(doc(L1, 'roster/wila')));
await no('…not anyone else’s', getDoc(doc(L1, 'roster/gwen')));
await no('…nor the whole roster', getDocs(collection(L1, 'roster')));
await ok('…its person’s punches', getDocs(query(collection(L1, 'tcPunch'), where('sid', '==', 'wila'))));
await no('…not anyone else’s', getDocs(query(collection(L1, 'tcPunch'), where('sid', '==', 'gwen'))));
await no('…nor everyone’s', getDocs(collection(L1, 'tcPunch')));
await ok('…its person’s corrections, overtime and requests', Promise.all(['tcFix', 'tcOT', 'tcReq'].map(c => getDocs(query(collection(L1, c), where('sid', '==', 'wila'))))));
await no('…not a coworker’s requests', getDocs(query(collection(L1, 'tcReq'), where('sid', '==', 'gwen'))));
await ok('…its person’s PIN tries', getDoc(doc(L1, 'tcTry/wila')));
await no('…not a coworker’s', getDoc(doc(L1, 'tcTry/gwen')));
await no('…nor where alerts go', getDoc(doc(L1, 'meta/tcAlerts')));
await no('…nor a PIN’s hash', getDoc(doc(L1, 'tcPin/wila')));
await no('…nor NLO Cases', getDocs(collection(L1, 'cases')));
await ok('…and the rules level', getDoc(doc(L1, 'meta/rules_tc_2')));
await ok('…and its own record (Dr. A changes who uses it)', getDoc(doc(L1, 'tcLaptops/lap1')));
await no('…not another laptop’s', getDoc(doc(L1, 'tcLaptops/lap2')));
await no('it can’t try a coworker’s PIN', tryDoc(L1, 'gwen', '1234'));
await tryOk(L1, 'wila');
await ok('at home: Wila clocks in on it with her PIN (marked Home)', punchBatch(L1, 'wila', 'in', { src: 'laptop', net: 'off' }));
await tryOk(L1, 'wila');
await no('…but no lunch from home', punchBatch(L1, 'wila', 'lunch', { src: 'laptop', net: 'off' }));
await no('…not marked as the time clock', punchBatch(L1, 'wila', 'out', { src: 'kiosk', net: 'off' }));
await no('…not “at the office” without the office check', punchBatch(L1, 'wila', 'out', { src: 'laptop', net: 'office' }));
await ok('…clocks out', punchBatch(L1, 'wila', 'out', { src: 'laptop', net: 'off' }));
await tryOk(L1, 'wila');
await ok('…also before the office check is set up (not checked)', punchBatch(L1, 'wila', 'in', { src: 'laptop', net: '' }));
await seen('lap1', OFFICE);
await tryOk(L1, 'wila');
await ok('at the office, everything (lunch too)', punchBatch(L1, 'wila', 'lunch', { src: 'laptop', net: 'office' }, PIDS.lap1));
await tryOk(L2, 'gwen');
await no('Gwen isn’t allowed home: not from home on her laptop', punchBatch(L2, 'gwen', 'in', { src: 'laptop', net: 'off' }));
await seen('lap2', OFFICE);
await ok('…but at the office, yes', punchBatch(L2, 'gwen', 'in', { src: 'laptop', net: 'office' }, PIDS.lap2));
await tryOk(L1, 'wila');
await ok('a missed punch asked on the laptop', askB(L1, rid(), ask({ sid: 'wila', src: 'laptop', by: 'lap1' })));
await no('…not marked as the time clock', askB(L1, rid(), ask({ sid: 'wila', src: 'kiosk', by: 'lap1' })));
{
  const b = writeBatch(L1);
  b.set(doc(L1, 'tcPin/wila'), { h: pinHash('wila', '8642'), at: serverTimestamp() });
  b.update(doc(L1, 'tcStaff/wila'), { pinAt: serverTimestamp(), pinBy: 'self', at: serverTimestamp(), by: 'lap1' });
  b.set(doc(L1, 'tcTry/wila'), cleared('pin'));
  await ok('she changes her PIN on it', b.commit());
}
{
  const b = writeBatch(L1);
  b.set(doc(L1, 'tcPin/gwen'), { h: pinHash('gwen', '8642'), at: serverTimestamp() });
  b.update(doc(L1, 'tcStaff/gwen'), { pinAt: serverTimestamp(), pinBy: 'self', at: serverTimestamp(), by: 'lap1' });
  b.set(doc(L1, 'tcTry/gwen'), cleared('pin'));
  await no('…not a coworker’s (not on this laptop)', b.commit());
}
await no('the time clock can’t punch as a laptop', (async () => { await tryOk(kn, 'gwen'); return punchBatch(kn, 'gwen', 'in', { src: 'laptop', net: 'off' }); })());
await seen('ca', OFFICE);
await no('nor can someone signed in', own('ca', 'gwen', { src: 'laptop' }));
await ok('the laptop checks in', updateDoc(doc(L1, 'tcLaptops/lap1'), { seen: serverTimestamp() }));
await no('…but can’t rename itself', updateDoc(doc(L1, 'tcLaptops/lap1'), { name: 'Mine' }));
await no('…or add people', updateDoc(doc(L1, 'tcLaptops/lap1'), { sids: ['wila', 'gwen'] }));
await ok('Dr. A changes who uses it', updateDoc(doc(as('owner'), 'tcLaptops/lap2'), { sids: ['gwen', 'kim'], name: 'Shared laptop' }));
await ok('a manager lists the laptops', getDocs(collection(as('fc'), 'tcLaptops')));
await no('staff can’t', getDocs(collection(as('ca'), 'tcLaptops')));
await ok('Dr. A takes one back (a lost laptop)', deleteDoc(doc(as('owner'), 'tcLaptops/lap1')));
await ok('…it still reads its own (missing) record, so it knows', getDoc(doc(L1, 'tcLaptops/lap1')));
await no('…then it reads nothing', getDoc(doc(L1, 'tcStaff/wila')));
await no('…and takes no PIN', tryDoc(L1, 'wila', '1234'));
await no('…and the office check writes nothing down for it', seen('lap1', OFFICE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await env.cleanup();
process.exit(fail ? 1 : 0);
