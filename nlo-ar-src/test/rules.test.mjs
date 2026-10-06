// Security rules for NLO A/R (the same rules file as NLO Cases and NLO Leads): every request the app makes, and what
// someone without A/R — or a removed person — would try. Run inside the emulators:
//   npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp, query, where } from 'firebase/firestore';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const ok = (n, p) => t(n, p, true), no = (n, p) => t(n, p, false);

const env = await initializeTestEnvironment({ projectId: 'demo-nlo-cases', firestore: { rules: readFileSync('dist/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
const box = { iv: 'aXY=', ct: 'Y3Q=' };
const EPK = { kty: 'EC', crv: 'P-256', x: 'E'.repeat(43), y: 'F'.repeat(43) };
const sealed = { epk: EPK, iv: 'aXY=', ct: 'cmluZw==' };
const pub = c => ({ kty: 'EC', crv: 'P-256', x: c.repeat(43), y: c.repeat(43) });
const IID = 'a' + 'Q'.repeat(22), IID2 = 'a' + 'R'.repeat(21) + '_', IID3 = 'a' + 'S'.repeat(22);
async function seed(opts) {
  opts = opts || {};
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/keys'), { current: 3 });
    await setDoc(doc(db, 'meta/settings'), { idleMin: 10 });
    await setDoc(doc(db, 'meta/recovery'), { pub: pub('R'), priv: box, ring: sealed, ringV: 3 });
    await setDoc(doc(db, 'members/owner'), { staffId: 'amir', role: 'owner', active: true, name: 'Owner', pub: pub('O') });
    await setDoc(doc(db, 'members/fc'), { staffId: 'sarah', role: 'staff', active: true, name: 'Sarah', pub: pub('A') });
    await setDoc(doc(db, 'members/ca'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen', pub: pub('B') });
    await setDoc(doc(db, 'members/gone'), { staffId: 'kaylee', role: 'staff', active: false, name: 'Kaylee', pub: pub('C') });
    await setDoc(doc(db, 'members/newbie'), { staffId: 'wila', role: 'staff', active: true, name: 'Wila', mustSetup: true });
    if (opts.fresh) return;
    await setDoc(doc(db, 'meta/arKeys'), { current: 2 });
    await setDoc(doc(db, 'meta/arEscrow'), { ring: sealed, ringV: 2, recX: 'R'.repeat(43), by: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/arTeam'), { sids: ['amir', 'sarah'], at: Timestamp.now() });
    const g = (sid, x) => ({ ring: sealed, ringV: 2, pubX: x.repeat(43), sid, by: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'arAccess/owner'), g('amir', 'O'));
    await setDoc(doc(db, 'arAccess/fc'), g('sarah', 'A'));
    await setDoc(doc(db, 'arAccess/gone'), g('kaylee', 'C'));
    await setDoc(doc(db, 'arReports/r1'), { v: 2, sum: box, asOf: '2026-10-05', n: 120, uid: 'fc', sid: 'sarah', at: Timestamp.now() });
    await setDoc(doc(db, 'arReportData/r1'), { v: 2, ...box });
    await setDoc(doc(db, 'arReports/r2'), { v: 2, sum: box, asOf: '2026-09-28', n: 110, uid: 'fc', sid: 'sarah', at: Timestamp.fromMillis(Date.now() - 2 * 86400000) });
    await setDoc(doc(db, 'arReportData/r2'), { v: 2, ...box });
    await setDoc(doc(db, 'arItems/' + IID), { v: 2, ...box, status: 'open', rev: 2, by: 'fc', sid: 'sarah', createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'arLog/' + IID + '_2'), { itemId: IID, rev: 2, uid: 'fc', sid: 'sarah', at: Timestamp.now(), v: 2, ...box, prev: { v: 2, iv: 'b2xk', ct: 'b2xk' } });
  });
}
const as = uid => env.authenticatedContext(uid, { email: uid + '@example.com', email_verified: true }).firestore();
const PREV = { v: 2, ...box };
const grant = (sid, x, extra) => Object.assign({ ring: sealed, ringV: 2, pubX: x.repeat(43), sid, by: 'owner', at: serverTimestamp() }, extra || {});
const repIdx = (uid, sid, extra) => Object.assign({ v: 2, sum: box, asOf: '2026-10-05', n: 7, uid, sid, at: serverTimestamp() }, extra || {});
function saveReport(db, id, idx, data) {
  const b = writeBatch(db);
  if (idx) b.set(doc(db, 'arReports/' + id), idx);
  if (data) b.set(doc(db, 'arReportData/' + id), data);
  return b.commit();
}
function dropReport(db, id, idx, data) { const b = writeBatch(db); if (idx) b.delete(doc(db, 'arReports/' + id)); if (data) b.delete(doc(db, 'arReportData/' + id)); return b.commit(); }
const item = (uid, sid, extra) => Object.assign({ v: 2, ...box, status: 'open', rev: 3, by: uid, sid, createdAt: Timestamp.fromMillis(1e12), updatedAt: serverTimestamp() }, extra || {});
const hist = (uid, sid, itemId, rev, prev, extra) => Object.assign({ itemId, rev, uid, sid, at: serverTimestamp(), v: 2, ...box, prev }, extra || {});
function itemWrite(db, id, data, h, mode) {
  const b = writeBatch(db);
  if (mode === 'create') b.set(doc(db, 'arItems/' + id), data); else if (mode === 'delete') b.delete(doc(db, 'arItems/' + id)); else b.update(doc(db, 'arItems/' + id), data);
  if (h) b.set(doc(db, 'arLog/' + h.itemId + '_' + h.rev), h);
  return b.commit();
}

console.log('\n# Someone in the office without A/R (an NLO Cases login only)');
await seed();
{
  const db = as('ca');
  await ok('may look up their own A/R key (there is none)', getDoc(doc(db, 'arAccess/ca')));
  await no('can’t read someone else’s A/R key', getDoc(doc(db, 'arAccess/fc')));
  await no('can’t list who has A/R', getDocs(collection(db, 'arAccess')));
  await no('can’t read the A/R key version', getDoc(doc(db, 'meta/arKeys')));
  await no('can’t read the A/R team', getDoc(doc(db, 'meta/arTeam')));
  await no('can’t list reports', getDocs(collection(db, 'arReports')));
  await no('can’t read a report', getDoc(doc(db, 'arReportData/r1')));
  await no('can’t list worked accounts', getDocs(collection(db, 'arItems')));
  await no('can’t read a worked account', getDoc(doc(db, 'arItems/' + IID)));
  await no('can’t read account history', getDocs(collection(db, 'arLog')));
  await no('can’t read the recovery copy', getDoc(doc(db, 'meta/arEscrow')));
  await no('can’t import a report', saveReport(db, 'x1', repIdx('ca', 'gwen'), { v: 2, ...box }));
  await no('can’t create a worked account', itemWrite(db, IID2, item('ca', 'gwen', { rev: 1, createdAt: serverTimestamp() }), hist('ca', 'gwen', IID2, 1, null), 'create'));
  await no('can’t give themself A/R', setDoc(doc(db, 'arAccess/ca'), grant('gwen', 'B', { by: 'ca' })));
  await ok('reads the rules version like everyone in the office', getDoc(doc(db, 'meta/rules_ar_1')));
}

console.log('\n# A removed person whose A/R key was never taken away');
{
  const db = as('gone');
  await no('reads nothing (their login is turned off)', getDocs(collection(db, 'arReports')));
  await no('can’t read worked accounts', getDoc(doc(db, 'arItems/' + IID)));
  await no('can’t import', saveReport(db, 'x2', repIdx('gone', 'kaylee'), { v: 2, ...box }));
  await no('can’t even fetch their own sealed copy of the A/R key', getDoc(doc(db, 'arAccess/gone')));
}
{
  const db = env.unauthenticatedContext().firestore();
  await no('signed out: reads nothing', getDoc(doc(db, 'arReports/r1')));
  await no('signed out: no A/R keys', getDoc(doc(db, 'arAccess/fc')));
}

console.log('\n# Someone Dr. A gave A/R (the financial coordinator)');
{
  const db = as('fc');
  await ok('opens their own A/R key', getDoc(doc(db, 'arAccess/fc')));
  await no('can’t read another person’s A/R key', getDoc(doc(db, 'arAccess/owner')));
  await no('can’t list who has A/R', getDocs(collection(db, 'arAccess')));
  await ok('reads the A/R key version', getDoc(doc(db, 'meta/arKeys')));
  await ok('reads the A/R team', getDoc(doc(db, 'meta/arTeam')));
  await no('can’t read the recovery copy', getDoc(doc(db, 'meta/arEscrow')));
  await ok('lists reports', getDocs(collection(db, 'arReports')));
  await ok('reads a report', getDoc(doc(db, 'arReportData/r1')));
  await ok('lists open worked accounts', getDocs(query(collection(db, 'arItems'), where('status', '==', 'open'))));
  await ok('reads account history', getDocs(query(collection(db, 'arLog'), where('itemId', '==', IID))));
  await no('can’t give A/R to someone', setDoc(doc(db, 'arAccess/ca'), grant('gwen', 'B', { by: 'fc' })));
  await no('can’t change the A/R key version', updateDoc(doc(db, 'meta/arKeys'), { current: 3 }));
  await no('can’t change the A/R team', setDoc(doc(db, 'meta/arTeam'), { sids: ['sarah', 'gwen'], at: serverTimestamp() }));
  await no('can’t take A/R away from someone', deleteDoc(doc(db, 'arAccess/owner')));
}

console.log('\n# Importing a report');
{
  const db = as('fc');
  await ok('the report and its index, together', saveReport(db, 'n1', repIdx('fc', 'sarah'), { v: 2, ...box }));
  await no('the index alone', saveReport(db, 'n2', repIdx('fc', 'sarah'), null));
  await no('the report alone', saveReport(db, 'n3', null, { v: 2, ...box }));
  await no('sealed with an old A/R key', saveReport(db, 'n4', repIdx('fc', 'sarah', { v: 1 }), { v: 1, ...box }));
  await no('under someone else’s name', saveReport(db, 'n5', repIdx('owner', 'amir'), { v: 2, ...box }));
  await no('with a made-up date format', saveReport(db, 'n6', repIdx('fc', 'sarah', { asOf: 'Oct 5' }), { v: 2, ...box }));
  await no('with an extra plain field (e.g. a name)', saveReport(db, 'n7', repIdx('fc', 'sarah', { patient: 'Avery' }), { v: 2, ...box }));
  await no('with an extra plain field in the data', saveReport(db, 'n8', repIdx('fc', 'sarah'), { v: 2, ...box, total: 1000 }));
  await no('over an existing report', saveReport(db, 'r1', repIdx('fc', 'sarah'), { v: 2, ...box }));
  await no('can’t change a saved report', updateDoc(doc(db, 'arReportData/r1'), { ct: 'b3RoZXI=' }));
  await ok('takes back their own report the same day', dropReport(db, 'n1', true, true));
  await no('can’t take back an older one (2 days)', dropReport(db, 'r2', true, true));
  await no('can’t delete half of one', dropReport(db, 'r1', true, false));
}
{
  const db = as('owner');
  await ok('owner: deletes any report', dropReport(db, 'r2', true, true));
  await ok('owner: re-seals one (same report, new key version)', (async () => {
    await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'meta/arKeys'), { current: 3 }));
    const b = writeBatch(db); b.update(doc(db, 'arReports/r1'), { v: 3, sum: box }); b.set(doc(db, 'arReportData/r1'), { v: 3, ...box }); await b.commit();
  })());
  await no('owner: can’t change a report’s date while re-sealing', updateDoc(doc(db, 'arReports/r1'), { v: 3, sum: box, asOf: '2026-01-01' }));
}

console.log('\n# Working an account');
await seed();
{
  const db = as('fc');
  await ok('first save of an account, with its history entry', itemWrite(db, IID2, item('fc', 'sarah', { rev: 1, createdAt: serverTimestamp() }), hist('fc', 'sarah', IID2, 1, null), 'create'));
  await no('without a history entry', itemWrite(db, IID3, item('fc', 'sarah', { rev: 1, createdAt: serverTimestamp() }), null, 'create'));
  await no('an id that isn’t one of the app’s', itemWrite(db, 'patient-name', item('fc', 'sarah', { rev: 1, createdAt: serverTimestamp() }), hist('fc', 'sarah', 'patient-name', 1, null), 'create'));
  await ok('a later save keeps the copy it replaced', itemWrite(db, IID, item('fc', 'sarah'), hist('fc', 'sarah', IID, 3, PREV)));
  await no('a save claiming a different previous copy', itemWrite(db, IID, item('fc', 'sarah', { rev: 4 }), hist('fc', 'sarah', IID, 4, { v: 2, iv: 'x', ct: 'y' })));
  await no('a save skipping a version', itemWrite(db, IID, item('fc', 'sarah', { rev: 6 }), hist('fc', 'sarah', IID, 6, PREV)));
  await no('a save sealed with an old key', itemWrite(db, IID, item('fc', 'sarah', { rev: 4, v: 1 }), hist('fc', 'sarah', IID, 4, { v: 2, ...box })));
  await no('a save under someone else’s name', itemWrite(db, IID, item('owner', 'amir', { rev: 4 }), hist('owner', 'amir', IID, 4, { v: 2, ...box })));
  await no('a status other than open / done', itemWrite(db, IID, item('fc', 'sarah', { rev: 4, status: 'paid' }), hist('fc', 'sarah', IID, 4, { v: 2, ...box })));
  await no('an extra plain field', itemWrite(db, IID, item('fc', 'sarah', { rev: 4, amount: 50 }), hist('fc', 'sarah', IID, 4, { v: 2, ...box })));
  await no('history can’t be edited', updateDoc(doc(db, 'arLog/' + IID + '_2'), { ct: 'eA==' }));
  await no('history can’t be deleted', deleteDoc(doc(db, 'arLog/' + IID + '_2')));
  await no('a history entry sealed with an old key', itemWrite(db, IID, item('fc', 'sarah'), hist('fc', 'sarah', IID, 3, PREV, { v: 1 })));
  await no('a history entry with a malformed iv', itemWrite(db, IID, item('fc', 'sarah'), hist('fc', 'sarah', IID, 3, PREV, { iv: { big: 'x'.repeat(5000) } })));
  await no('a history entry without its account’s save', setDoc(doc(db, 'arLog/' + IID + '_3'), hist('fc', 'sarah', IID, 3, PREV)));
  await no('staff can’t delete an account’s record', itemWrite(db, IID, null, hist('fc', 'sarah', IID, 4, { v: 2, ...box }), 'delete'));
}
{
  const db = as('owner');
  await no('nobody deletes an account’s record, not even Dr. A (so its history can’t restart)', itemWrite(db, IID, null, hist('owner', 'amir', IID, 3, PREV), 'delete'));
  await no('… nor without a history entry', itemWrite(db, IID, null, null, 'delete'));
}

console.log('\n# Dr. A gives and takes away A/R');
await seed();
{
  const db = as('owner');
  await ok('gives it to someone in the office', setDoc(doc(db, 'arAccess/ca'), grant('gwen', 'B')));
  await no('with the wrong staff id', setDoc(doc(db, 'arAccess/fc'), grant('gwen', 'A')));
  await no('to a login that’s turned off', setDoc(doc(db, 'arAccess/gone'), grant('kaylee', 'C')));
  await no('to someone not in the office', setDoc(doc(db, 'arAccess/stranger'), grant('stranger', 'D')));
  await no('with an extra field', setDoc(doc(db, 'arAccess/ca'), grant('gwen', 'B', { note: 'x' })));
  await no('with a malformed sealed key', setDoc(doc(db, 'arAccess/ca'), grant('gwen', 'B', { ring: { iv: 'x', ct: 'y' } })));
  await ok('lists who has A/R', getDocs(collection(db, 'arAccess')));
  await ok('takes it away', deleteDoc(doc(db, 'arAccess/fc')));
  await ok('makes a new A/R key version (+1)', updateDoc(doc(db, 'meta/arKeys'), { current: 3 }));
  await no('can’t skip a version', updateDoc(doc(db, 'meta/arKeys'), { current: 9 }));
  await ok('updates the recovery copy', setDoc(doc(db, 'meta/arEscrow'), { ring: sealed, ringV: 3, recX: 'R'.repeat(43), by: 'owner', at: serverTimestamp() }));
  await ok('updates the A/R team', setDoc(doc(db, 'meta/arTeam'), { sids: ['amir', 'gwen'], at: serverTimestamp() }));
  await no('can’t delete the A/R key version', deleteDoc(doc(db, 'meta/arKeys')));
}
{
  const db = as('fc');
  await no('the person taken off reads nothing any more', getDocs(collection(db, 'arReports')));
  await no('… nor accounts', getDoc(doc(db, 'arItems/' + IID)));
}

console.log('\n# The lock that keeps two key changes from happening at once');
await seed();
{
  const db = as('owner');
  await ok('Dr. A takes it', setDoc(doc(db, 'meta/arKeyLock'), { by: 'owner:abc', at: serverTimestamp() }));
  await ok('… reads it', getDoc(doc(db, 'meta/arKeyLock')));
  await no('… not with anything else in it', setDoc(doc(db, 'meta/arKeyLock'), { by: 'owner:abc', at: serverTimestamp(), note: 'x' }));
  await ok('… and lets it go', deleteDoc(doc(db, 'meta/arKeyLock')));
}
{
  const db = as('fc');
  await no('staff can’t take it', setDoc(doc(db, 'meta/arKeyLock'), { by: 'fc:abc', at: serverTimestamp() }));
  await no('… or read it', getDoc(doc(db, 'meta/arKeyLock')));
}

console.log('\n# A new A/R key for a bigger team (12 people): written a few at a time, as the app does');
await seed();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  for (let i = 0; i < 12; i++) await setDoc(doc(db, 'members/m' + i), { staffId: 's' + i, role: 'staff', active: true, name: 'Staff ' + i, pub: pub(String.fromCharCode(71 + i)) });
});
{
  const db = as('owner'), ids = Array.from({ length: 12 }, (_, i) => i);
  const batchOf = list => { const b = writeBatch(db); list.forEach(i => b.set(doc(db, 'arAccess/m' + i), grant('s' + i, String.fromCharCode(71 + i), { ringV: 3 }))); return b.commit(); };
  await no('all 12 in one batch is more than the rules may look up', batchOf(ids));
  await ok('5 at a time: the first 5', batchOf(ids.slice(0, 5)));
  await ok('… the next 5', batchOf(ids.slice(5, 10)));
  await ok('… the last 2', batchOf(ids.slice(10)));
}

console.log('\n# Setting A/R up the first time');
await seed({ fresh: true });
{
  const fc = as('fc');
  await no('staff can’t set A/R up', setDoc(doc(fc, 'meta/arKeys'), { current: 1 }));
  const db = as('owner');
  await ok('owner: key version, own key, recovery copy and team, in one go', (async () => {
    const b = writeBatch(db);
    b.set(doc(db, 'meta/arKeys'), { current: 1 });
    b.set(doc(db, 'arAccess/owner'), grant('amir', 'O', { ringV: 1 }));
    b.set(doc(db, 'meta/arEscrow'), { ring: sealed, ringV: 1, recX: 'R'.repeat(43), by: 'owner', at: serverTimestamp() });
    b.set(doc(db, 'meta/arTeam'), { sids: ['amir'], at: serverTimestamp() });
    await b.commit();
  })());
  await no('can’t start the key over at 1', setDoc(doc(db, 'meta/arKeys'), { current: 1 }));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await env.clearFirestore(); // leave the emulator empty for the end-to-end test that runs next
await env.cleanup();
process.exit(fail ? 1 : 0);
