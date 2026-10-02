// Security-rules tests: every request the app should allow, and the ones an attacker would try.
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp, deleteField, query, where } from 'firebase/firestore';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const ok = (n, p) => t(n, p, true), no = (n, p) => t(n, p, false);

const env = await initializeTestEnvironment({ projectId: 'demo-nlo-cases', firestore: { rules: readFileSync('dist/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
const box = { iv: 'aXY=', ct: 'Y3Q=' };
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/keys'), { current: 2 });
    await setDoc(doc(db, 'meta/settings'), { idleMin: 10 });
    await setDoc(doc(db, 'meta/recovery'), { pub: {}, priv: box, ring: box, ringV: 2 });
    await setDoc(doc(db, 'members/owner'), { staffId: 'amir', role: 'owner', active: true, name: 'Owner' });
    await setDoc(doc(db, 'members/gwen'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen', username: 'gwen', mustSetup: false, pub: {}, priv: box, ring: box, ringV: 2 });
    await setDoc(doc(db, 'members/kay'), { staffId: 'kaylee', role: 'staff', active: false, name: 'Kaylee', username: 'kaylee' });
    await setDoc(doc(db, 'roster/gwen'), { name: 'Gwen', active: true });
    await setDoc(doc(db, 'logins/gwen'), { email: 'gwen.1@staff.example' });
    await setDoc(doc(db, 'cases/c1'), { v: 2, ...box, status: 'open', rev: 3, by: 'owner', sid: 'amir', createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now(), closedAt: null });
    await setDoc(doc(db, 'log/c1_3'), { caseId: 'c1', rev: 3, uid: 'owner', sid: 'amir', at: Timestamp.now(), v: 2, ...box, prev: { v: 2, iv: 'b2xk', ct: 'b2xk' } });
  });
}
const PREV = { v: 2, ...box };
const histDoc = (uid, sid, caseId, rev, prev, extra) => Object.assign({ caseId, rev, uid, sid, at: serverTimestamp(), v: 2, ...box, prev }, extra || {});
// write a case + its history entry in one batch, the way the app does
function caseWrite(db, id, data, hist, mode) {
  const b = writeBatch(db);
  if (mode === 'create') b.set(doc(db, 'cases/' + id), data); else if (mode === 'delete') b.delete(doc(db, 'cases/' + id)); else b.update(doc(db, 'cases/' + id), data);
  if (hist) b.set(doc(db, 'log/' + hist.caseId + '_' + hist.rev), hist);
  return b.commit();
}
const caseUpd = (uid, sid, extra) => Object.assign({ v: 2, ...box, status: 'open', rev: 4, by: uid, sid, createdAt: Timestamp.fromMillis(1e12), updatedAt: serverTimestamp(), closedAt: null }, extra || {});

await seed();
console.log('\n# Signed-out visitor');
let db = env.unauthenticatedContext().firestore();
await no('cannot read a case', getDoc(doc(db, 'cases/c1')));
await no('cannot list cases', getDocs(collection(db, 'cases')));
await no('cannot read members', getDoc(doc(db, 'members/gwen')));
await no('cannot read roster', getDocs(collection(db, 'roster')));
await no('cannot read the key version', getDoc(doc(db, 'meta/keys')));
await no('cannot read the history log', getDocs(collection(db, 'log')));
await ok('can look up one username (needed to sign in)', getDoc(doc(db, 'logins/gwen')));
await no('cannot list usernames', getDocs(collection(db, 'logins')));
await no('cannot write a case', caseWrite(db, 'x', caseUpd('anon', 'x', { rev: 1, createdAt: serverTimestamp() }), histDoc('anon', 'x', 'x', 1, null), 'create'));

console.log('\n# Stranger with an account (not a member)');
db = env.authenticatedContext('stranger').firestore();
await no('cannot read cases', getDocs(collection(db, 'cases')));
await no('cannot read roster', getDocs(collection(db, 'roster')));
await no('cannot read history', getDoc(doc(db, 'log/c1_3')));
await no('cannot make themself owner', setDoc(doc(db, 'members/stranger'), { staffId: 'x', role: 'owner', active: true }));
await no('cannot make themself staff', setDoc(doc(db, 'members/stranger'), { staffId: 'x', role: 'staff', active: true }));
await no('cannot overwrite the office setup', setDoc(doc(db, 'meta/setup'), { owner: 'stranger', at: serverTimestamp() }));
await no('cannot point a username at their account', setDoc(doc(db, 'logins/gwen'), { email: 'evil@example.com' }));
await no('cannot read the recovery record', getDoc(doc(db, 'meta/recovery')));
await no('cannot read who the owner is', getDoc(doc(db, 'meta/setup')));

console.log('\n# Removed staff member (inactive)');
db = env.authenticatedContext('kay').firestore();
await no('cannot read cases', getDocs(collection(db, 'cases')));
await no('cannot read history', getDocs(collection(db, 'log')));
await no('cannot write a case', caseWrite(db, 'c1', caseUpd('kay', 'kaylee'), histDoc('kay', 'kaylee', 'c1', 4, PREV)));
await no('cannot reactivate themself', updateDoc(doc(db, 'members/kay'), { active: true }));
await no('cannot even update their own key fields', updateDoc(doc(db, 'members/kay'), { lastLogin: serverTimestamp() }));

console.log('\n# Active staff (Gwen)');
db = env.authenticatedContext('gwen').firestore();
await ok('reads cases', getDocs(query(collection(db, 'cases'), where('status', '==', 'open'))));
await ok('reads history', getDocs(query(collection(db, 'log'), where('caseId', '==', 'c1'))));
await ok('reads roster', getDocs(collection(db, 'roster')));
await ok('reads key version', getDoc(doc(db, 'meta/keys')));
await ok('reads own member record', getDoc(doc(db, 'members/gwen')));
await no('cannot read someone else’s member record', getDoc(doc(db, 'members/owner')));
await no('cannot list member records', getDocs(collection(db, 'members')));
await no('cannot read the recovery record', getDoc(doc(db, 'meta/recovery')));
await ok('updates own key material', updateDoc(doc(db, 'members/gwen'), { ringV: 2, lastLogin: serverTimestamp(), privPrev: deleteField() }));
await no('cannot make themself owner', updateDoc(doc(db, 'members/gwen'), { role: 'owner' }));
await no('cannot rename their staff id', updateDoc(doc(db, 'members/gwen'), { staffId: 'amir' }));
await no('cannot create another login', setDoc(doc(db, 'members/newbie'), { staffId: 'n', role: 'staff', active: true }));
await no('cannot reactivate a removed person', updateDoc(doc(db, 'members/kay'), { active: true }));
await no('cannot edit the roster', setDoc(doc(db, 'roster/evil'), { name: 'x', active: true }));
await no('cannot change usernames', setDoc(doc(db, 'logins/gwen'), { email: 'x@example.com' }));
await no('cannot change the key version', updateDoc(doc(db, 'meta/keys'), { current: 3 }));
await no('cannot change settings', updateDoc(doc(db, 'meta/settings'), { idleMin: 600 }));
await ok('reads who the owner is', getDoc(doc(db, 'meta/setup')));
await ok('sets a valid public key', updateDoc(doc(db, 'members/gwen'), { pub: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) } }));
await no('cannot store a malformed public key', updateDoc(doc(db, 'members/gwen'), { pub: { kty: 'EC', crv: 'P-256', x: 'AAAA', y: 'AAAA' } }));
await no('cannot store a public key with extra fields', updateDoc(doc(db, 'members/gwen'), { pub: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43), d: 'secret' } }));
await no('cannot update a case without a history entry', updateDoc(doc(db, 'cases/c1'), caseUpd('gwen', 'gwen')));
await no('history entry must hold the real previous copy', caseWrite(db, 'c1', caseUpd('gwen', 'gwen'), histDoc('gwen', 'gwen', 'c1', 4, { v: 2, iv: 'eA==', ct: 'eA==' })));
await no('history entry must hold a previous copy at all', caseWrite(db, 'c1', caseUpd('gwen', 'gwen'), histDoc('gwen', 'gwen', 'c1', 4, null)));
await no('cannot roll the revision back', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { rev: 2 }), histDoc('gwen', 'gwen', 'c1', 2, PREV)));
await no('cannot skip a revision', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { rev: 9 }), histDoc('gwen', 'gwen', 'c1', 9, PREV)));
await no('cannot add a history entry without changing the case', setDoc(doc(db, 'log/c1_4'), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot write with the old key version', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { v: 1 }), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot write as someone else (by)', caseWrite(db, 'c1', caseUpd('owner', 'gwen'), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot write as someone else (sid)', caseWrite(db, 'c1', caseUpd('gwen', 'amir'), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot sign history as someone else', caseWrite(db, 'c1', caseUpd('gwen', 'gwen'), histDoc('owner', 'amir', 'c1', 4, PREV)));
await no('cannot add plaintext fields to a case', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { patient: 'Leak Example' }), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot add plaintext fields to history', caseWrite(db, 'c1', caseUpd('gwen', 'gwen'), histDoc('gwen', 'gwen', 'c1', 4, PREV, { patient: 'Leak Example' })));
await no('cannot backdate updatedAt', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { updatedAt: Timestamp.fromMillis(1) }), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot backdate history', caseWrite(db, 'c1', caseUpd('gwen', 'gwen'), histDoc('gwen', 'gwen', 'c1', 4, PREV, { at: Timestamp.fromMillis(1) })));
await no('cannot change createdAt', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { createdAt: Timestamp.fromMillis(5) }), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot mark done without a close time', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { status: 'done' }), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await no('cannot use an unknown status', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { status: 'archived' }), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await ok('updates a case with its history entry', caseWrite(db, 'c1', caseUpd('gwen', 'gwen'), histDoc('gwen', 'gwen', 'c1', 4, PREV)));
await ok('marks done with a close time', caseWrite(db, 'c1', caseUpd('gwen', 'gwen', { rev: 5, status: 'done', closedAt: serverTimestamp() }), histDoc('gwen', 'gwen', 'c1', 5, PREV)));
await no('cannot delete a case (even with history)', caseWrite(db, 'c1', null, histDoc('gwen', 'gwen', 'c1', 6, PREV), 'delete'));
await no('cannot create a case without history', setDoc(doc(db, 'cases/c2'), caseUpd('gwen', 'gwen', { rev: 1, createdAt: serverTimestamp() })));
await ok('creates a case with its first history entry', caseWrite(db, 'c2', caseUpd('gwen', 'gwen', { rev: 1, createdAt: serverTimestamp() }), histDoc('gwen', 'gwen', 'c2', 1, null), 'create'));
await no('cannot create with a fake createdAt', caseWrite(db, 'c3', caseUpd('gwen', 'gwen', { rev: 1, createdAt: Timestamp.fromMillis(5) }), histDoc('gwen', 'gwen', 'c3', 1, null), 'create'));
await no('first history entry cannot claim a previous copy', caseWrite(db, 'c4', caseUpd('gwen', 'gwen', { rev: 1, createdAt: serverTimestamp() }), histDoc('gwen', 'gwen', 'c4', 1, PREV), 'create'));
await no('history id must match case and revision', (async () => { const b = writeBatch(db); b.set(doc(db, 'cases/c5'), caseUpd('gwen', 'gwen', { rev: 1, createdAt: serverTimestamp() })); b.set(doc(db, 'log/c5_1'), histDoc('gwen', 'gwen', 'c5', 1, null)); b.set(doc(db, 'log/zzz'), histDoc('gwen', 'gwen', 'c5', 1, null)); return b.commit(); })());
await no('cannot edit history', updateDoc(doc(db, 'log/c1_3'), { ct: 'eA==' }));
await no('cannot delete history', deleteDoc(doc(db, 'log/c1_3')));

console.log('\n# Owner');
db = env.authenticatedContext('owner').firestore();
await ok('lists member records', getDocs(collection(db, 'members')));
await ok('reads the recovery record', getDoc(doc(db, 'meta/recovery')));
await ok('creates a staff login', setDoc(doc(db, 'members/newbie'), { staffId: 'newbie', role: 'staff', active: true, mustSetup: true }));
await no('cannot create a second owner', setDoc(doc(db, 'members/owner2'), { staffId: 'o2', role: 'owner', active: true }));
await ok('removes a person', updateDoc(doc(db, 'members/gwen'), { active: false }));
await no('cannot demote themself', updateDoc(doc(db, 'members/owner'), { role: 'staff' }));
await no('cannot deactivate themself', updateDoc(doc(db, 'members/owner'), { active: false }));
await no('cannot delete member records (kept for history)', deleteDoc(doc(db, 'members/kay')));
await ok('bumps the key version by one', updateDoc(doc(db, 'meta/keys'), { current: 3 }));
await no('cannot skip key versions', updateDoc(doc(db, 'meta/keys'), { current: 5 }));
await no('cannot move the key version back', updateDoc(doc(db, 'meta/keys'), { current: 2 }));
await no('cannot delete a case without keeping its last copy', deleteDoc(doc(db, 'cases/c2')));
await ok('deletes a case, keeping its last copy in history', caseWrite(db, 'c2', null, histDoc('owner', 'amir', 'c2', 2, PREV), 'delete'));
await ok('sets a username', setDoc(doc(db, 'logins/newbie'), { email: 'newbie.1@staff.example' }));
await no('cannot add extra fields to a username record', setDoc(doc(db, 'logins/newbie'), { email: 'a@b.c', note: 'x' }));
await no('cannot overwrite the office setup', setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: serverTimestamp() }));
await no('cannot edit history either', updateDoc(doc(db, 'log/c1_3'), { ct: 'eA==' }));

console.log('\n# First-time office setup');
await env.clearFirestore();
const OWNER = { email: 'dr.test@example.com', email_verified: true };
const setupBatch = (uid, tok) => {
  const d = env.authenticatedContext(uid, tok || OWNER).firestore(); const b = writeBatch(d);
  b.set(doc(d, 'members/' + uid), { staffId: 'amir', role: 'owner', active: true });
  b.set(doc(d, 'meta/setup'), { owner: uid, at: serverTimestamp() });
  b.set(doc(d, 'meta/keys'), { current: 1 });
  b.set(doc(d, 'meta/settings'), { idleMin: 10 });
  b.set(doc(d, 'meta/recovery'), { pub: {}, priv: box, ring: box, ringV: 1 });
  b.set(doc(d, 'roster/amir'), { name: 'Amir', active: true });
  return b.commit();
};
{
  const d = env.authenticatedContext('first', OWNER).firestore();
  await no('setup record alone is refused', setDoc(doc(d, 'meta/setup'), { owner: 'first', at: serverTimestamp() }));
  await no('owner record alone is refused', setDoc(doc(d, 'members/first'), { staffId: 'a', role: 'owner', active: true }));
  const b = writeBatch(d);
  b.set(doc(d, 'members/first'), { staffId: 'a', role: 'owner', active: true });
  b.set(doc(d, 'meta/setup'), { owner: 'someoneElse', at: serverTimestamp() });
  await no('cannot name someone else as owner', b.commit());
}
await no('a stranger cannot claim the empty office', setupBatch('stranger', { email: 'attacker@example.com', email_verified: true }));
await no('the owner email alone is not enough without verifying it', setupBatch('squatter', { email: 'dr.test@example.com', email_verified: false }));
await ok('the owner (verified email) sets up the office', setupBatch('first'));
await no('a second setup is refused', setupBatch('second'));
await no('a setup claiming key version 5 is refused', (async () => {
  await env.clearFirestore();
  const d = env.authenticatedContext('third', OWNER).firestore(); const b = writeBatch(d);
  b.set(doc(d, 'members/third'), { staffId: 'a', role: 'owner', active: true });
  b.set(doc(d, 'meta/setup'), { owner: 'third', at: serverTimestamp() });
  b.set(doc(d, 'meta/keys'), { current: 5 });
  return b.commit();
})());

console.log('\nPASS ' + pass + '  FAIL ' + fail);
await env.cleanup();
process.exit(fail ? 1 : 0);
