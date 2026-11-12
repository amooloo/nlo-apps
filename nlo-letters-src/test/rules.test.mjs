// Security rules for NLO Letters (the same rules file as NLO Cases): every request the app makes, and what an attacker would try.
// Run inside the emulators: npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/rules.test.mjs"
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
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/keys'), { current: 2 });
    await setDoc(doc(db, 'members/owner'), { staffId: 'amir', role: 'owner', active: true, name: 'Owner' });
    await setDoc(doc(db, 'members/gwen'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen' });
    await setDoc(doc(db, 'members/kay'), { staffId: 'kaylee', role: 'staff', active: false, name: 'Kaylee' });
    await setDoc(doc(db, 'refDocs/d1'), { v: 2, ...box, rev: 3, by: 'owner', sid: 'amir', createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'refDocs/old'), { v: 1, ...box, rev: 1, by: 'owner', sid: 'amir', createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'refCfg/office'), { v: 2, ...box, by: 'owner', updatedAt: Timestamp.now() });
  });
}
const fresh = (uid, sid, extra) => Object.assign({ v: 2, ...box, rev: 1, by: uid, sid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, extra || {});
const next = (uid, sid, extra) => Object.assign({ v: 2, ...box, rev: 4, by: uid, sid, createdAt: Timestamp.fromMillis(1e12), updatedAt: serverTimestamp() }, extra || {});
const cfg = (uid, extra) => Object.assign({ v: 2, ...box, by: uid, updatedAt: serverTimestamp() }, extra || {});

await seed();
console.log('\n# Signed-out visitor');
let db = env.unauthenticatedContext().firestore();
await no('cannot read a doctor', getDoc(doc(db, 'refDocs/d1')));
await no('cannot list the directory', getDocs(collection(db, 'refDocs')));
await no('cannot read the letter settings', getDoc(doc(db, 'refCfg/office')));
await no('cannot add a doctor', setDoc(doc(db, 'refDocs/x'), fresh('x', 'x')));

console.log('\n# Stranger with an account (not a member)');
db = env.authenticatedContext('stranger').firestore();
await no('cannot list the directory', getDocs(collection(db, 'refDocs')));
await no('cannot add a doctor', setDoc(doc(db, 'refDocs/x'), fresh('stranger', 'x')));
await no('cannot change a doctor', setDoc(doc(db, 'refDocs/d1'), next('stranger', 'x')));
await no('cannot read the letter settings', getDoc(doc(db, 'refCfg/office')));

console.log('\n# Removed staff member (inactive)');
db = env.authenticatedContext('kay').firestore();
await no('cannot list the directory', getDocs(collection(db, 'refDocs')));
await no('cannot add a doctor', setDoc(doc(db, 'refDocs/x'), fresh('kay', 'kaylee')));
await no('cannot change a doctor', setDoc(doc(db, 'refDocs/d1'), next('kay', 'kaylee')));

console.log('\n# Active staff (Gwen)');
db = env.authenticatedContext('gwen').firestore();
await ok('reads the whole directory', getDocs(collection(db, 'refDocs')));
await ok('reads the letter settings', getDoc(doc(db, 'refCfg/office')));
await ok('adds a doctor', setDoc(doc(db, 'refDocs/g1'), fresh('gwen', 'gwen')));
await ok('corrects a doctor (the next version)', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'gwen')));
await no('cannot skip a version', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'gwen', { rev: 9 })));
await no('cannot re-use a version', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'gwen', { rev: 4 })));
await no('cannot sign a save as someone else', setDoc(doc(db, 'refDocs/d1'), next('owner', 'amir', { rev: 5 })));
await no('cannot sign with another staff id', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'amir', { rev: 5 })));
await no('cannot change when it was first added', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'gwen', { rev: 5, createdAt: Timestamp.fromMillis(5) })));
await no('cannot back-date a save', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'gwen', { rev: 5, updatedAt: Timestamp.fromMillis(5) })));
await no('cannot save under an old office key', setDoc(doc(db, 'refDocs/d1'), next('gwen', 'gwen', { rev: 5, v: 1 })));
await no('cannot add readable fields beside the sealed record', setDoc(doc(db, 'refDocs/g2'), fresh('gwen', 'gwen', { name: 'Dr. Plain Text' })));
await no('cannot store something huge', setDoc(doc(db, 'refDocs/g3'), fresh('gwen', 'gwen', { ct: 'x'.repeat(20001) })));
await no('cannot start a doctor at version 2', setDoc(doc(db, 'refDocs/g4'), fresh('gwen', 'gwen', { rev: 2 })));
await no('cannot delete a doctor (staff hide instead)', deleteDoc(doc(db, 'refDocs/d1')));
await ok('re-seals a record left under the old key', setDoc(doc(db, 'refDocs/old'), { v: 2, ...box, rev: 2, by: 'gwen', sid: 'gwen', createdAt: Timestamp.fromMillis(1e12), updatedAt: serverTimestamp() }));
await no('cannot change the letter settings', setDoc(doc(db, 'refCfg/office'), cfg('gwen')));
await no('cannot create other settings records', setDoc(doc(db, 'refCfg/mine'), cfg('gwen')));
await ok('imports five doctors in one batch (how the app imports)', (() => { const b = writeBatch(db); for (let i = 0; i < 5; i++) b.set(doc(db, 'refDocs/imp' + i), fresh('gwen', 'gwen')); return b.commit(); })());
await ok('finds records still under an older key', getDocs(query(collection(db, 'refDocs'), where('v', '<', 2))));

console.log('\n# Owner');
db = env.authenticatedContext('owner').firestore();
await ok('adds a doctor', setDoc(doc(db, 'refDocs/o1'), fresh('owner', 'amir')));
await ok('deletes a doctor', deleteDoc(doc(db, 'refDocs/o1')));
await ok('saves the letter settings', setDoc(doc(db, 'refCfg/office'), cfg('owner')));
await no('cannot save settings with readable fields', setDoc(doc(db, 'refCfg/office'), cfg('owner', { doctor: 'Plain Text' })));
await no('cannot create a settings record under another name', setDoc(doc(db, 'refCfg/other'), cfg('owner')));
await no('cannot delete the letter settings', deleteDoc(doc(db, 'refCfg/office')));
await no('cannot sign a doctor as someone else', setDoc(doc(db, 'refDocs/o2'), fresh('gwen', 'gwen')));

console.log('\nPASS ' + pass + '  FAIL ' + fail);
await env.cleanup();
process.exit(fail ? 1 : 0);
