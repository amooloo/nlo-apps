// Security rules for NLO Time Off (the same rules file as NLO Cases, NLO Leads and NLO A/R): every request the app makes,
// and what someone else would try — a coworker, someone who left, someone not in the office, nobody signed in. Run inside
// the emulators:
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
const EPK = { kty: 'EC', crv: 'P-256', x: 'E'.repeat(43), y: 'F'.repeat(43) };
const sealed = (c) => ({ epk: EPK, iv: 'aXY=', ct: (c || 'cmluZw==') });
const pub = c => ({ kty: 'EC', crv: 'P-256', x: c.repeat(43), y: c.repeat(43) });
const box = { iv: 'aXY=', ct: 'Y3Q=' };
const DAY = 86400000;
const Q1 = 'q' + 'a'.repeat(24), Q2 = 'q' + 'b'.repeat(24), Q3 = 'q' + 'c'.repeat(24), Q4 = 'q' + 'd'.repeat(24), QN = 'q' + 'e'.repeat(24), Q5 = 'q' + '5'.repeat(24), Q6 = 'q' + '6'.repeat(24);
const future = Date.now() + 20 * DAY, past = Date.now() - 3 * DAY;
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/keys'), { current: 3 });
    await setDoc(doc(db, 'meta/settings'), { idleMin: 10 });
    await setDoc(doc(db, 'members/owner'), { staffId: 'amir', role: 'owner', active: true, name: 'Owner', pub: pub('O') });
    await setDoc(doc(db, 'members/fc'), { staffId: 'sarah', role: 'staff', active: true, name: 'Sarah', pub: pub('A') });
    await setDoc(doc(db, 'members/ca'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen', pub: pub('B') });
    await setDoc(doc(db, 'members/ca2'), { staffId: 'kim', role: 'staff', active: true, name: 'Kim', pub: pub('K') });
    await setDoc(doc(db, 'members/gone'), { staffId: 'lee', role: 'staff', active: false, name: 'Lee', pub: pub('C') });
    await setDoc(doc(db, 'meta/toKeys'), { current: 2, pub: pub('H') });
    await setDoc(doc(db, 'toDrop/2'), { v: 2, ...box });
    await setDoc(doc(db, 'meta/toTeam'), { sids: ['amir', 'sarah'], at: Timestamp.now() });
    await setDoc(doc(db, 'toAccess/fc'), { ring: sealed(), ringV: 2, pubX: 'A'.repeat(43), sid: 'sarah', by: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'toAccess/gone'), { ring: sealed(), ringV: 2, pubX: 'C'.repeat(43), sid: 'lee', by: 'owner', at: Timestamp.now() });
    const req = (sid, status, startMs, extra) => Object.assign({ sid, status, rev: 2, by: 'ca', bsid: sid, v: 2, pub: pub('B'), startMs, hr: sealed(), me: sealed(), createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now() }, extra || {});
    await setDoc(doc(db, 'toReq/' + Q1), req('gwen', 'pending', future));                 // Gwen's, waiting
    await setDoc(doc(db, 'toReq/' + Q2), req('gwen', 'approved', future));                // Gwen's, approved, not started
    await setDoc(doc(db, 'toReq/' + Q3), req('gwen', 'approved', past));                  // Gwen's, approved, already started
    await setDoc(doc(db, 'toReq/' + Q4), req('sarah', 'pending', future, { by: 'fc', pub: pub('A') })); // Sarah's own, waiting
    await setDoc(doc(db, 'toReq/' + Q5), req('sarah', 'approved', future, { by: 'owner', bsid: 'amir', pub: pub('A') })); // Sarah's own, approved by Dr. A, not started
    await setDoc(doc(db, 'toReq/' + Q6), req('sarah', 'approved', past, { by: 'owner', bsid: 'amir', pub: pub('A') }));   // Sarah's own, approved, already started
    await setDoc(doc(db, 'toLog/' + Q1 + '_2'), { reqId: Q1, rev: 2, uid: 'ca', sid: 'gwen', osid: 'gwen', a: 'edit', at: Timestamp.now(), prev: { v: 2, hr: sealed('b2xk'), me: sealed('b2xk'), status: 'pending' } });
    await setDoc(doc(db, 'toOut/' + Q2), { v: 3, ...box, at: Timestamp.now() });
    await setDoc(doc(db, 'toHR/gwen'), { v: 2, ...box, rev: 1, by: 'owner', updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'toMine/gwen'), { box: sealed(), pubX: 'B'.repeat(43), at: Timestamp.now(), by: 'owner' });
    await setDoc(doc(db, 'toPeople/gwen'), { pub: pub('B'), uid: 'ca', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/toFeedKey'), { v: 3, ...box, at: Timestamp.now() });
    await setDoc(doc(db, 'toFeed/live'), { ...box, at: Timestamp.now() });
  });
}
const as = uid => env.authenticatedContext(uid, { email: uid + '@example.com', email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
async function cur(id) { let d; await env.withSecurityRulesDisabled(async c => { d = (await getDoc(doc(c.firestore(), 'toReq/' + id))).data(); }); return d; }
/* a save of a request: the request, its history entry (with the copy it replaced), and optionally its who's-out entry */
async function saveReq(db, uid, sid, id, next, opts) {
  opts = opts || {};
  const before = opts.create ? null : await cur(id), rev = before ? before.rev + 1 : 1;
  const b = writeBatch(db);
  const data = Object.assign({ rev, by: uid, bsid: sid, v: 2, pub: pub('B'), hr: sealed('bmV3'), me: sealed('bmV3'), updatedAt: serverTimestamp() },
    before ? { sid: before.sid, status: before.status, startMs: before.startMs, createdAt: before.createdAt } : { createdAt: serverTimestamp() }, next);
  if (opts.create) b.set(doc(db, 'toReq/' + id), data); else b.update(doc(db, 'toReq/' + id), data);
  if (!opts.noLog) b.set(doc(db, 'toLog/' + id + '_' + rev), Object.assign({ reqId: id, rev, uid, sid, osid: data.sid, a: opts.a || 'save', at: serverTimestamp(),
    prev: before ? { v: before.v, hr: before.hr, me: before.me, status: before.status } : null }, opts.log || {}));
  if (opts.out === 'set') b.set(doc(db, 'toOut/' + id), { v: 3, ...box, at: serverTimestamp() });
  if (opts.out === 'del') b.delete(doc(db, 'toOut/' + id));
  return b.commit();
}

console.log('\n# Gwen (staff, no HR key)');
await seed();
{
  const db = as('ca');
  await ok('reads the HR key’s public half (to seal a request to it)', getDoc(doc(db, 'meta/toKeys')));
  await no('can’t read the HR key’s private half', getDoc(doc(db, 'toDrop/2')));
  await no('can’t read who has the HR key', getDocs(collection(db, 'toAccess')));
  await ok('reads her own HR key grant (there is none)', getDoc(doc(db, 'toAccess/ca')));
  await ok('reads the rules level markers (the page asks for newer rules when it can’t)', getDoc(doc(db, 'meta/rules_to_2')));
  await ok('reads who approves', getDoc(doc(db, 'meta/toTeam')));
  await ok('reads her own request', getDoc(doc(db, 'toReq/' + Q1)));
  await no('can’t read Sarah’s request', getDoc(doc(db, 'toReq/' + Q4)));
  await ok('can look for a request that doesn’t exist yet (saving a new one reads it first)', getDoc(doc(db, 'toReq/' + 'q' + '9'.repeat(24))));
  await ok('lists her own requests', getDocs(query(collection(db, 'toReq'), where('sid', '==', 'gwen'))));
  await no('can’t list everyone’s requests', getDocs(collection(db, 'toReq')));
  await no('can’t list Sarah’s', getDocs(query(collection(db, 'toReq'), where('sid', '==', 'sarah'))));
  await ok('reads her own request’s history', getDocs(query(collection(db, 'toLog'), where('osid', '==', 'gwen'))));
  await no('can’t read Sarah’s history', getDocs(query(collection(db, 'toLog'), where('osid', '==', 'sarah'))));
  await ok('reads who’s out (sealed with the office key)', getDocs(collection(db, 'toOut')));
  await no('can’t read HR records', getDoc(doc(db, 'toHR/gwen')));
  await no('can’t list HR records', getDocs(collection(db, 'toHR')));
  await ok('reads her own copy of her HR record', getDoc(doc(db, 'toMine/gwen')));
  await no('can’t read Kim’s copy', getDoc(doc(db, 'toMine/kim')));
  await ok('reads the feed key (to update the feed)', getDoc(doc(db, 'meta/toFeedKey')));
  await ok('reads people’s public keys', getDocs(collection(db, 'toPeople')));
  await ok('registers her own public key', setDoc(doc(db, 'toPeople/gwen'), { pub: pub('B'), uid: 'ca', at: serverTimestamp() }));
  await no('…only the one her login holds', setDoc(doc(db, 'toPeople/gwen'), { pub: pub('Z'), uid: 'ca', at: serverTimestamp() }));
  await no('…and not as someone else', setDoc(doc(db, 'toPeople/kim'), { pub: pub('K'), uid: 'ca2', at: serverTimestamp() }));
  await no('…not her key under Kim’s name', setDoc(doc(db, 'toPeople/kim'), { pub: pub('B'), uid: 'ca', at: serverTimestamp() }));

  await ok('asks for time off (pending, with its history entry)', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'pending', startMs: future }, { create: true, a: 'submit' }));
  await seed();
  await no('…not without the history entry', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'pending', startMs: future }, { create: true, noLog: true }));
  await no('…not already approved', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'approved', startMs: future }, { create: true }));
  await no('…not for Kim', saveReq(db, 'ca', 'gwen', QN, { sid: 'kim', status: 'pending', startMs: future }, { create: true }));
  await no('…not with an odd id', saveReq(db, 'ca', 'gwen', 'zzz', { sid: 'gwen', status: 'pending', startMs: future }, { create: true }));
  await no('…not with a field the app doesn’t use', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'pending', startMs: future, type: 'Vacation' }, { create: true }));
  await no('…not under an old HR key', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'pending', startMs: future, v: 1 }, { create: true }));
  await no('…not claiming someone else saved it', saveReq(db, 'ca', 'kim', QN, { sid: 'gwen', status: 'pending', startMs: future }, { create: true }));
  await no('…not starting before 2000', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'pending', startMs: 9e11 }, { create: true }));
  await no('…not starting after 2100', saveReq(db, 'ca', 'gwen', QN, { sid: 'gwen', status: 'pending', startMs: 4.2e12 }, { create: true }));
  await no('…not moved past 2100 later', saveReq(db, 'ca', 'gwen', Q1, { startMs: 4.2e12 }, { a: 'edit' }));
  await ok('changes her request while it waits', saveReq(db, 'ca', 'gwen', Q1, { startMs: future + DAY }, { a: 'edit' }));
  await no('…not with a history entry that doesn’t hold the copy it replaced', saveReq(db, 'ca', 'gwen', Q1, {}, { log: { prev: { v: 2, hr: sealed('eA=='), me: sealed('eA=='), status: 'pending' } } }));
  await no('can’t approve her own request', saveReq(db, 'ca', 'gwen', Q1, { status: 'approved' }));
  await ok('cancels her request while it waits', saveReq(db, 'ca', 'gwen', Q1, { status: 'cancelled' }, { a: 'cancel' }));
  await ok('cancels approved time off before it starts (and its who’s-out entry goes)', saveReq(db, 'ca', 'gwen', Q2, { status: 'cancelled' }, { a: 'cancel', out: 'del' }));
  await seed();
  await no('…not once it has started', saveReq(db, 'ca', 'gwen', Q3, { status: 'cancelled' }, { out: 'del' }));
  await no('…not by moving its start date while cancelling', saveReq(db, 'ca', 'gwen', Q3, { status: 'cancelled', startMs: future }, { out: 'del' }));
  await no('can’t change approved time off (only cancel it)', saveReq(db, 'ca', 'gwen', Q2, { startMs: future + DAY }));
  await no('can’t put approved time off back to waiting', saveReq(db, 'ca', 'gwen', Q2, { status: 'pending' }));
  await no('can’t change Sarah’s request', saveReq(db, 'ca', 'gwen', Q4, { status: 'cancelled' }));
  await no('can’t delete a request', deleteDoc(doc(db, 'toReq/' + Q1)));
  await no('can’t add a who’s-out entry without approving its request', setDoc(doc(db, 'toOut/' + Q1), { v: 3, ...box, at: serverTimestamp() }));
  await no('can’t remove someone’s who’s-out entry on its own', deleteDoc(doc(db, 'toOut/' + Q2)));
  await no('can’t edit history', updateDoc(doc(db, 'toLog/' + Q1 + '_2'), { a: 'x' }));
  await no('can’t write HR records', setDoc(doc(db, 'toHR/kim'), { v: 2, ...box, rev: 1, by: 'ca', updatedAt: serverTimestamp() }));
  await no('can’t write her own copy', setDoc(doc(db, 'toMine/gwen'), { box: sealed(), pubX: 'B'.repeat(43), at: serverTimestamp(), by: 'ca' }));
  await no('can’t change the feed key', setDoc(doc(db, 'meta/toFeedKey'), { v: 3, ...box, at: serverTimestamp() }));
  await ok('updates the feed (sealed)', setDoc(doc(db, 'toFeed/live'), { ...box, at: serverTimestamp() }));
  await no('…only the one feed', setDoc(doc(db, 'toFeed/other'), { ...box, at: serverTimestamp() }));
  await no('…with nothing else in it', setDoc(doc(db, 'toFeed/live'), { ...box, names: ['x'], at: serverTimestamp() }));
  await no('can’t make a new HR key', updateDoc(doc(db, 'meta/toKeys'), { current: 3, pub: pub('I') }));
  await no('can’t give herself the HR key', setDoc(doc(db, 'toAccess/ca'), { ring: sealed(), ringV: 2, pubX: 'B'.repeat(43), sid: 'gwen', by: 'ca', at: serverTimestamp() }));
  await no('can’t change who approves', setDoc(doc(db, 'meta/toTeam'), { sids: ['gwen'], at: serverTimestamp() }));
}

console.log('\n# Sarah (approves: has the HR key)');
await seed();
{
  const db = as('fc');
  await ok('reads the HR key’s private half', getDoc(doc(db, 'toDrop/2')));
  await ok('lists everyone’s requests', getDocs(collection(db, 'toReq')));
  await ok('reads everyone’s history', getDocs(collection(db, 'toLog')));
  await ok('reads HR records', getDocs(collection(db, 'toHR')));
  await ok('reads someone’s copy', getDoc(doc(db, 'toMine/gwen')));
  await ok('approves Gwen’s request, with its who’s-out entry', saveReq(db, 'fc', 'sarah', Q1, { status: 'approved', pub: pub('B') }, { a: 'approve', out: 'set' }));
  await seed();
  await no('…not with a who’s-out entry for a request that isn’t approved', saveReq(db, 'fc', 'sarah', Q1, { status: 'denied' }, { out: 'set' }));
  await ok('denies Gwen’s request', saveReq(db, 'fc', 'sarah', Q1, { status: 'denied' }, { a: 'deny' }));
  await ok('takes back approved time off (and its who’s-out entry goes)', saveReq(db, 'fc', 'sarah', Q2, { status: 'archived' }, { a: 'archive', out: 'del' }));
  await seed();
  await no('can’t approve her own request', saveReq(db, 'fc', 'sarah', Q4, { status: 'approved', pub: pub('A') }));
  await no('can’t deny her own either', saveReq(db, 'fc', 'sarah', Q4, { status: 'denied', pub: pub('A') }));
  await ok('can change her own request while it waits', saveReq(db, 'fc', 'sarah', Q4, { startMs: future + DAY, pub: pub('A') }));
  // her own approved time off goes by the same rules as anyone's
  await no('can’t change her own approved time off (still “approved”, other days)', saveReq(db, 'fc', 'sarah', Q5, { startMs: future + 3 * DAY, pub: pub('A') }));
  await no('…or re-save it as it is (its sealed copies could hold anything)', saveReq(db, 'fc', 'sarah', Q5, { pub: pub('A') }, { a: 'rekey' }));
  await no('…or take it back', saveReq(db, 'fc', 'sarah', Q5, { status: 'archived', pub: pub('A') }, { out: 'del' }));
  await no('…or cancel it once it has started', saveReq(db, 'fc', 'sarah', Q6, { status: 'cancelled', pub: pub('A') }, { out: 'del' }));
  await ok('can cancel it before it starts, like anyone', saveReq(db, 'fc', 'sarah', Q5, { status: 'cancelled', pub: pub('A') }, { a: 'cancel', out: 'del' }));
  await seed();
  await ok('records a sick day for Gwen (approved)', saveReq(db, 'fc', 'sarah', QN, { sid: 'gwen', status: 'approved', startMs: past }, { create: true, a: 'record', out: 'set' }));
  await seed();
  await no('can’t record approved time off for herself', saveReq(db, 'fc', 'sarah', QN, { sid: 'sarah', status: 'approved', startMs: future, pub: pub('A') }, { create: true }));
  await ok('asks for her own (pending)', saveReq(db, 'fc', 'sarah', QN, { sid: 'sarah', status: 'pending', startMs: future, pub: pub('A') }, { create: true }));
  await no('can’t write HR records (Dr. A does)', setDoc(doc(db, 'toHR/kim'), { v: 2, ...box, rev: 1, by: 'fc', updatedAt: serverTimestamp() }));
  await no('can’t write someone’s copy', setDoc(doc(db, 'toMine/kim'), { box: sealed(), pubX: 'K'.repeat(43), at: serverTimestamp(), by: 'fc' }));
  await no('can’t give the HR key to someone', setDoc(doc(db, 'toAccess/ca'), { ring: sealed(), ringV: 2, pubX: 'B'.repeat(43), sid: 'gwen', by: 'fc', at: serverTimestamp() }));
  await no('can’t see who has the HR key', getDocs(collection(db, 'toAccess')));
  await no('can’t read the HR key’s recovery copy', getDoc(doc(db, 'meta/toEscrow')));
}

console.log('\n# Dr. A (owner)');
await seed();
{
  const db = as('owner');
  await ok('decides his own request', (async () => {
    await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'toReq/' + QN), { sid: 'amir', status: 'pending', rev: 1, by: 'owner', bsid: 'amir', v: 2, pub: pub('O'), startMs: future, hr: sealed(), me: sealed(), createdAt: Timestamp.now(), updatedAt: Timestamp.now() }); });
    return saveReq(db, 'owner', 'amir', QN, { status: 'approved', pub: pub('O') }, { out: 'set' });
  })());
  await ok('records approved time off for himself', saveReq(db, 'owner', 'amir', 'q' + 'f'.repeat(24), { sid: 'amir', status: 'approved', startMs: future, pub: pub('O') }, { create: true, out: 'set' }));
  await ok('gives Sarah… Kim the HR key', setDoc(doc(db, 'toAccess/ca2'), { ring: sealed(), ringV: 2, pubX: 'K'.repeat(43), sid: 'kim', by: 'owner', at: serverTimestamp() }));
  await no('…not to someone who left', setDoc(doc(db, 'toAccess/gone'), { ring: sealed(), ringV: 2, pubX: 'C'.repeat(43), sid: 'lee', by: 'owner', at: serverTimestamp() }));
  await no('…not with the wrong staff id', setDoc(doc(db, 'toAccess/ca'), { ring: sealed(), ringV: 2, pubX: 'B'.repeat(43), sid: 'kim', by: 'owner', at: serverTimestamp() }));
  await ok('takes it away', deleteDoc(doc(db, 'toAccess/fc')));
  await ok('makes the next HR key (version + 1, a public half)', updateDoc(doc(db, 'meta/toKeys'), { current: 3, pub: pub('I') }));
  await seed();
  await no('…not skipping a version', updateDoc(doc(db, 'meta/toKeys'), { current: 4, pub: pub('I') }));
  await no('…not without its public half', updateDoc(doc(db, 'meta/toKeys'), { current: 3, pub: { kty: 'EC' } }));
  await ok('stores the new version’s private half (sealed)', setDoc(doc(db, 'toDrop/3'), { v: 3, ...box }));
  await no('…never replaces one', setDoc(doc(db, 'toDrop/2'), { v: 2, iv: 'eHg=', ct: 'eHg=' }));
  await no('…under the right number only', setDoc(doc(db, 'toDrop/5'), { v: 4, ...box }));
  await ok('writes an HR record, with its history', (() => { const b = writeBatch(db); b.update(doc(db, 'toHR/gwen'), { v: 2, iv: 'bmV3', ct: 'bmV3', rev: 2, by: 'owner', updatedAt: serverTimestamp() }); b.set(doc(db, 'toHRLog/gwen_2'), { hsid: 'gwen', rev: 2, uid: 'owner', a: 'edit', at: serverTimestamp(), prev: { v: 2, ...box } }); return b.commit(); })());
  await seed();
  await no('…not without its history', updateDoc(doc(db, 'toHR/gwen'), { v: 2, iv: 'bmV3', ct: 'bmV3', rev: 2, by: 'owner', updatedAt: serverTimestamp() }));
  await no('…not with a history entry that doesn’t hold the copy it replaced', (() => { const b = writeBatch(db); b.update(doc(db, 'toHR/gwen'), { v: 2, iv: 'bmV3', ct: 'bmV3', rev: 2, by: 'owner', updatedAt: serverTimestamp() }); b.set(doc(db, 'toHRLog/gwen_2'), { hsid: 'gwen', rev: 2, uid: 'owner', a: 'edit', at: serverTimestamp(), prev: { v: 2, iv: 'eA==', ct: 'eA==' } }); return b.commit(); })());
  await ok('a new HR record (first version)', (() => { const b = writeBatch(db); b.set(doc(db, 'toHR/kim'), { v: 2, ...box, rev: 1, by: 'owner', updatedAt: serverTimestamp() }); b.set(doc(db, 'toHRLog/kim_1'), { hsid: 'kim', rev: 1, uid: 'owner', a: 'create', at: serverTimestamp(), prev: null }); return b.commit(); })());
  await no('can’t delete an HR record', deleteDoc(doc(db, 'toHR/gwen')));
  await ok('writes someone’s own copy (sealed to them)', setDoc(doc(db, 'toMine/kim'), { box: sealed(), pubX: 'K'.repeat(43), at: serverTimestamp(), by: 'owner' }));
  await ok('registers someone’s public key for them (from their login)', setDoc(doc(db, 'toPeople/kim'), { pub: pub('K'), uid: 'ca2', at: serverTimestamp() }));
  await no('…not a made-up one', setDoc(doc(db, 'toPeople/kim'), { pub: pub('Q'), uid: 'ca2', at: serverTimestamp() }));
  await ok('sets the feed key', setDoc(doc(db, 'meta/toFeedKey'), { v: 3, ...box, at: serverTimestamp() }));
  await ok('changes who approves', setDoc(doc(db, 'meta/toTeam'), { sids: ['amir', 'kim'], at: serverTimestamp() }));
  await ok('seals a who’s-out entry again (office key changed)', updateDoc(doc(db, 'toOut/' + Q2), { v: 4, ...box, at: serverTimestamp() }));
  await ok('takes the lock for a key change', setDoc(doc(db, 'meta/toKeyLock'), { by: 'owner:abc', at: serverTimestamp() }));
  await ok('keeps the HR key’s recovery copy', setDoc(doc(db, 'meta/toEscrow'), { ring: sealed(), ringV: 2, recX: 'R'.repeat(43), by: 'owner', at: serverTimestamp() }));
}

console.log('\n# Someone who left (login turned off; still had an HR key grant)');
await seed();
{
  const db = as('gone');
  await no('can’t read requests', getDocs(collection(db, 'toReq')));
  await no('…or look for one', getDoc(doc(db, 'toReq/' + 'q' + '9'.repeat(24))));
  await no('can’t read the HR key’s private half', getDoc(doc(db, 'toDrop/2')));
  await no('can’t read HR records', getDocs(collection(db, 'toHR')));
  await no('can’t read who’s out', getDocs(collection(db, 'toOut')));
  await no('can’t ask for time off', saveReq(db, 'gone', 'lee', QN, { sid: 'lee', status: 'pending', startMs: future }, { create: true }));
  await no('can’t write the feed', setDoc(doc(db, 'toFeed/live'), { ...box, at: serverTimestamp() }));
}

console.log('\n# Not in the office / not signed in');
await seed();
{
  const db = as('stranger');
  await no('a stranger can’t read anything', getDocs(collection(db, 'toOut')));
  await no('…or ask for time off', saveReq(db, 'stranger', 'x', QN, { sid: 'x', status: 'pending', startMs: future }, { create: true }));
  const a = anon();
  await ok('anyone may fetch the sealed feed (its key is only in the calendar’s and CADANCe’s settings)', getDoc(doc(a, 'toFeed/live')));
  await no('…but not list anything', getDocs(collection(a, 'toFeed')));
  await no('…or write it', setDoc(doc(a, 'toFeed/live'), { ...box, at: serverTimestamp() }));
  await no('…or read the feed key', getDoc(doc(a, 'meta/toFeedKey')));
  await no('…or the HR key’s public half', getDoc(doc(a, 'meta/toKeys')));
  await no('…or a request', getDoc(doc(a, 'toReq/' + Q1)));
  await no('…or look for one that doesn’t exist', getDoc(doc(a, 'toReq/' + 'q' + '9'.repeat(24))));
}

console.log('\n# Scrubs (a yearly allowance, asked for with a reason and approved)');
await seed();
{
  const P1 = 'p' + 'a'.repeat(24), P2 = 'p' + 'b'.repeat(24), P3 = 'p' + 'c'.repeat(24), PN = 'p' + 'e'.repeat(24), Y = new Date().getUTCFullYear();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), perk = (sid, status, extra) => Object.assign({ sid, status, rev: 1, by: 'ca', bsid: sid, v: 2, pub: pub('B'), year: Y, hr: sealed(), me: sealed(), createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now() }, extra || {});
    await setDoc(doc(db, 'toPerk/' + P1), perk('gwen', 'pending'));                                   // Gwen's, waiting
    await setDoc(doc(db, 'toPerk/' + P2), perk('sarah', 'pending', { by: 'fc', pub: pub('A') }));     // Sarah's own, waiting
    await setDoc(doc(db, 'toPerk/' + P3), perk('gwen', 'approved', { by: 'fc', bsid: 'sarah' }));     // Gwen's, approved
  });
  const curP = async id => { let d; await env.withSecurityRulesDisabled(async c => { d = (await getDoc(doc(c.firestore(), 'toPerk/' + id))).data(); }); return d; };
  const savePerk = async (db, uid, sid, id, next, create) => {
    const before = create ? null : await curP(id);
    const data = Object.assign({ rev: before ? before.rev + 1 : 1, by: uid, bsid: sid, v: 2, pub: pub('B'), hr: sealed('bmV3'), me: sealed('bmV3'), updatedAt: serverTimestamp() },
      before ? { sid: before.sid, status: before.status, year: before.year, createdAt: before.createdAt } : { createdAt: serverTimestamp(), year: Y }, next);
    return create ? setDoc(doc(db, 'toPerk/' + id), data) : updateDoc(doc(db, 'toPerk/' + id), data);
  };
  const gw = as('ca'), sa = as('fc'), dr = as('owner'), kim = as('ca2');
  await ok('Gwen asks for scrubs (waiting)', savePerk(gw, 'ca', 'gwen', PN, { sid: 'gwen', status: 'pending' }, true));
  await no('…not already approved', savePerk(gw, 'ca', 'gwen', 'p' + 'f'.repeat(24), { sid: 'gwen', status: 'approved' }, true));
  await no('…not for Kim', savePerk(gw, 'ca', 'gwen', 'p' + 'f'.repeat(24), { sid: 'kim', status: 'pending' }, true));
  await no('…not with an odd id', savePerk(gw, 'ca', 'gwen', 'q' + 'f'.repeat(24), { sid: 'gwen', status: 'pending' }, true));
  await no('…not with a year that makes no sense', savePerk(gw, 'ca', 'gwen', 'p' + 'f'.repeat(24), { sid: 'gwen', status: 'pending', year: 1999 }, true));
  await no('…not counted against last year', savePerk(gw, 'ca', 'gwen', 'p' + 'f'.repeat(24), { sid: 'gwen', status: 'pending', year: Y - 1 }, true));
  await no('…or next year', savePerk(gw, 'ca', 'gwen', 'p' + 'f'.repeat(24), { sid: 'gwen', status: 'pending', year: Y + 1 }, true));
  await no('…not with a field the app doesn’t use', savePerk(gw, 'ca', 'gwen', 'p' + 'f'.repeat(24), { sid: 'gwen', status: 'pending', pairs: 2 }, true));
  await ok('she reads her own', getDoc(doc(gw, 'toPerk/' + P1)));
  await no('…not Sarah’s', getDoc(doc(gw, 'toPerk/' + P2)));
  await ok('…lists her own', getDocs(query(collection(gw, 'toPerk'), where('sid', '==', 'gwen'))));
  await no('…not everyone’s', getDocs(collection(gw, 'toPerk')));
  await no('she can’t approve her own', savePerk(gw, 'ca', 'gwen', P1, { status: 'approved' }));
  await no('…or move it to another year', savePerk(gw, 'ca', 'gwen', P1, { year: 2027 }));
  await ok('…she can change it while it waits', savePerk(gw, 'ca', 'gwen', P1, {}));
  await no('Kim can’t touch Gwen’s', savePerk(kim, 'ca2', 'kim', P1, { status: 'cancelled' }));
  await no('Gwen can’t cancel scrubs already approved', savePerk(gw, 'ca', 'gwen', P3, { status: 'cancelled' }));
  await ok('Sarah (approves) lists everyone’s', getDocs(collection(sa, 'toPerk')));
  await ok('…approves Gwen’s', savePerk(sa, 'fc', 'sarah', P1, { status: 'approved' }));
  await no('…but not her own', savePerk(sa, 'fc', 'sarah', P2, { status: 'approved', pub: pub('A') }));
  await ok('…she can cancel her own while it waits', savePerk(sa, 'fc', 'sarah', P2, { status: 'cancelled', pub: pub('A') }));
  await ok('Dr. A answers one', savePerk(dr, 'owner', 'amir', P3, { status: 'denied' }));
  await no('nobody deletes one', deleteDoc(doc(dr, 'toPerk/' + P3)));
  await no('nobody signed in can’t read one', getDoc(doc(anon(), 'toPerk/' + P1)));
  // where approved orders are emailed: Dr. A sets it; NLO Cases' email robot reads it
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'mailbots/robot'), { email: 'robot@example.com', at: Timestamp.now() }); });
  await ok('Dr. A sets where scrubs orders are emailed', setDoc(doc(dr, 'meta/toMail'), { scrubs: 'community@example.com', at: serverTimestamp() }));
  await ok('…or turns it off (blank)', setDoc(doc(dr, 'meta/toMail'), { scrubs: '', at: serverTimestamp() }));
  await no('…not something that isn’t an address', setDoc(doc(dr, 'meta/toMail'), { scrubs: 'everyone', at: serverTimestamp() }));
  await no('…not with anything else in it', setDoc(doc(dr, 'meta/toMail'), { scrubs: 'community@example.com', to: 'x@example.com', at: serverTimestamp() }));
  await no('Sarah (approves) can’t change it', setDoc(doc(sa, 'meta/toMail'), { scrubs: 'sarah@example.com', at: serverTimestamp() }));
  await no('Gwen can’t change it', setDoc(doc(gw, 'meta/toMail'), { scrubs: 'gwen@example.com', at: serverTimestamp() }));
  await ok('staff can read it (the app checks the order email is set up)', getDoc(doc(gw, 'meta/toMail')));
  await ok('the email robot can read it', getDoc(doc(as('robot'), 'meta/toMail')));
  await no('…but not the scrubs requests', getDoc(doc(as('robot'), 'toPerk/' + P1)));
  await no('nobody signed in can’t read it', getDoc(doc(anon(), 'meta/toMail')));
}

await env.cleanup();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
