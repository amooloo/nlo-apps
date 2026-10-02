// Security rules for NLO Leads (the same rules file as NLO Cases): every request the app makes, and what an attacker would try.
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
const PUB = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) };
const HASH = 'a'.repeat(64);
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'meta/setup'), { owner: 'owner', at: Timestamp.now() });
    await setDoc(doc(db, 'meta/keys'), { current: 2 });
    await setDoc(doc(db, 'meta/settings'), { idleMin: 10 });
    await setDoc(doc(db, 'members/owner'), { staffId: 'amir', role: 'owner', active: true, name: 'Owner' });
    await setDoc(doc(db, 'members/gwen'), { staffId: 'gwen', role: 'staff', active: true, name: 'Gwen' });
    await setDoc(doc(db, 'members/kay'), { staffId: 'kaylee', role: 'staff', active: false, name: 'Kaylee' });
    await setDoc(doc(db, 'leads/l1'), { v: 2, ...box, status: 'open', rev: 3, by: 'owner', sid: 'amir', createdAt: Timestamp.fromMillis(1e12), updatedAt: Timestamp.now(), closedAt: null });
    await setDoc(doc(db, 'leadLog/l1_3'), { leadId: 'l1', rev: 3, uid: 'owner', sid: 'amir', at: Timestamp.now(), v: 2, ...box, prev: { v: 2, iv: 'b2xk', ct: 'b2xk' } });
    await setDoc(doc(db, 'leadInbox/w1'), { at: Timestamp.now(), kid: 'k1', epk: PUB, ...box });
    await setDoc(doc(db, 'leadInbox/w2'), { at: Timestamp.now(), kid: 'k1', epk: PUB, ...box });
    await setDoc(doc(db, 'leadInbox/w3'), { at: Timestamp.now(), kid: 'k1', epk: PUB, ...box });
    await setDoc(doc(db, 'leadInbox/w4'), { at: Timestamp.now(), kid: 'k1', epk: PUB, ...box });
    await setDoc(doc(db, 'leads/w4'), { v: 2, ...box, status: 'open', rev: 1, by: 'gwen', sid: 'gwen', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), closedAt: null });
    await setDoc(doc(db, 'leadLog/w4_1'), { leadId: 'w4', rev: 1, uid: 'gwen', sid: 'gwen', at: Timestamp.now(), v: 2, ...box, prev: null });
    await setDoc(doc(db, 'meta/intake'), { kid: 'k1', pub: PUB, priv: { v: 2, ...box }, at: Timestamp.now() });
    await setDoc(doc(db, 'meta/intakeSecret'), { hash: HASH, box: { v: 2, ...box }, on: true, at: Timestamp.now() });
    await setDoc(doc(db, 'meta/intakeStats'), { okAt: Timestamp.now() });
  });
}
const PREV = { v: 2, ...box };
const hist = (uid, sid, leadId, rev, prev, extra) => Object.assign({ leadId, rev, uid, sid, at: serverTimestamp(), v: 2, ...box, prev }, extra || {});
const leadDoc = (uid, sid, extra) => Object.assign({ v: 2, ...box, status: 'open', rev: 4, by: uid, sid, createdAt: Timestamp.fromMillis(1e12), updatedAt: serverTimestamp(), closedAt: null }, extra || {});
const fresh = (uid, sid, extra) => leadDoc(uid, sid, Object.assign({ rev: 1, createdAt: serverTimestamp() }, extra || {}));
function leadWrite(db, id, data, h, mode) {
  const b = writeBatch(db);
  if (mode === 'create') b.set(doc(db, 'leads/' + id), data); else if (mode === 'delete') b.delete(doc(db, 'leads/' + id)); else b.update(doc(db, 'leads/' + id), data);
  if (h) b.set(doc(db, 'leadLog/' + h.leadId + '_' + h.rev), h);
  return b.commit();
}
/* filing a website request the way the app does: the lead (same id), its first history entry and removing the request, together */
function file(db, id, uid, sid, opt) {
  opt = opt || {};
  const b = writeBatch(db);
  b.set(doc(db, 'leads/' + id), fresh(uid, sid));
  b.set(doc(db, 'leadLog/' + id + '_1'), hist(uid, sid, id, 1, null));
  b.delete(doc(db, 'leadInbox/' + (opt.inboxId || id)));
  return b.commit();
}

await seed();
console.log('\n# Signed-out visitor');
let db = env.unauthenticatedContext().firestore();
await no('cannot read a lead', getDoc(doc(db, 'leads/l1')));
await no('cannot list leads', getDocs(collection(db, 'leads')));
await no('cannot read lead history', getDocs(collection(db, 'leadLog')));
await no('cannot read website requests', getDocs(collection(db, 'leadInbox')));
await no('cannot drop a request into the inbox (only the function can)', setDoc(doc(db, 'leadInbox/x'), { at: serverTimestamp(), kid: 'k1', epk: PUB, ...box }));
await no('cannot read the feed key', getDoc(doc(db, 'meta/intake')));
await no('cannot read the feed secret', getDoc(doc(db, 'meta/intakeSecret')));
await no('cannot read the feed status', getDoc(doc(db, 'meta/intakeStats')));

console.log('\n# Stranger with an account (not a member)');
db = env.authenticatedContext('stranger').firestore();
await no('cannot read leads', getDocs(collection(db, 'leads')));
await no('cannot read website requests', getDocs(collection(db, 'leadInbox')));
await no('cannot create a lead', leadWrite(db, 'x', fresh('stranger', 'x'), hist('stranger', 'x', 'x', 1, null), 'create'));
await no('cannot remove a website request', deleteDoc(doc(db, 'leadInbox/w1')));
await no('cannot replace the feed key with their own', setDoc(doc(db, 'meta/intake'), { kid: 'evil', pub: PUB, priv: { v: 2, ...box }, at: serverTimestamp() }));

console.log('\n# Removed staff member (inactive)');
db = env.authenticatedContext('kay').firestore();
await no('cannot read leads', getDocs(collection(db, 'leads')));
await no('cannot read website requests', getDocs(collection(db, 'leadInbox')));
await no('cannot read the feed key', getDoc(doc(db, 'meta/intake')));
await no('cannot update a lead', leadWrite(db, 'l1', leadDoc('kay', 'kaylee'), hist('kay', 'kaylee', 'l1', 4, PREV)));
await no('cannot file a website request', file(db, 'w1', 'kay', 'kaylee'));

console.log('\n# Active staff (Gwen)');
db = env.authenticatedContext('gwen').firestore();
await ok('reads open leads', getDocs(query(collection(db, 'leads'), where('status', '==', 'open'))));
await ok('reads closed leads by date', getDocs(query(collection(db, 'leads'), where('closedAt', '>=', Timestamp.fromMillis(0)))));
await ok('reads a lead’s history', getDocs(query(collection(db, 'leadLog'), where('leadId', '==', 'l1'))));
await ok('reads recent activity', getDocs(query(collection(db, 'leadLog'), where('at', '>=', Timestamp.fromMillis(0)))));
await ok('reads waiting website requests', getDocs(collection(db, 'leadInbox')));
await ok('reads the feed key (to open requests)', getDoc(doc(db, 'meta/intake')));
await no('cannot read the feed secret', getDoc(doc(db, 'meta/intakeSecret')));
await no('cannot read the feed status', getDoc(doc(db, 'meta/intakeStats')));
await no('cannot change the feed key', updateDoc(doc(db, 'meta/intake'), { kid: 'k2' }));
await no('cannot change the feed secret', setDoc(doc(db, 'meta/intakeSecret'), { hash: HASH, box: { v: 2, ...box }, on: true, at: serverTimestamp() }));
await no('cannot turn the feed off', updateDoc(doc(db, 'meta/intakeSecret'), { on: false, at: serverTimestamp() }));
await no('cannot change the follow-up settings', setDoc(doc(db, 'meta/settings'), { leads: { offsets: [0, 0, 0, 0, 0] } }, { merge: true }));
await no('cannot write to the inbox', setDoc(doc(db, 'leadInbox/x'), { at: serverTimestamp(), kid: 'k1', epk: PUB, ...box }));
await no('cannot edit a waiting request', updateDoc(doc(db, 'leadInbox/w1'), { ct: 'eA==' }));
await no('cannot just delete a waiting request', deleteDoc(doc(db, 'leadInbox/w1')));
await no('cannot delete a request by filing a lead under another id', file(db, 'zz9', 'gwen', 'gwen', { inboxId: 'w1' }));
await no('cannot make a request vanish by filing it as already closed', (async () => {
  const b = writeBatch(db);
  b.set(doc(db, 'leads/w3'), fresh('gwen', 'gwen', { status: 'done', closedAt: serverTimestamp() }));
  b.set(doc(db, 'leadLog/w3_1'), hist('gwen', 'gwen', 'w3', 1, null));
  b.delete(doc(db, 'leadInbox/w3'));
  return b.commit();
})());
await no('cannot remove a request by touching a lead that already had its id', (async () => {
  const b = writeBatch(db);
  b.update(doc(db, 'leads/w4'), leadDoc('gwen', 'gwen', { rev: 2 }));
  b.set(doc(db, 'leadLog/w4_2'), hist('gwen', 'gwen', 'w4', 2, { v: 2, ...box }));
  b.delete(doc(db, 'leadInbox/w4'));
  return b.commit();
})());
await ok('files a website request: lead + first history + request removed, together', file(db, 'w1', 'gwen', 'gwen'));
await no('a second computer filing the same request is refused (no double leads)', file(env.authenticatedContext('owner').firestore(), 'w1', 'owner', 'amir'));
await no('cannot update a lead without a history entry', updateDoc(doc(db, 'leads/l1'), leadDoc('gwen', 'gwen')));
await no('history entry must hold the real previous copy', leadWrite(db, 'l1', leadDoc('gwen', 'gwen'), hist('gwen', 'gwen', 'l1', 4, { v: 2, iv: 'eA==', ct: 'eA==' })));
await no('cannot roll the revision back', leadWrite(db, 'l1', leadDoc('gwen', 'gwen', { rev: 2 }), hist('gwen', 'gwen', 'l1', 2, PREV)));
await no('cannot write with the old key version', leadWrite(db, 'l1', leadDoc('gwen', 'gwen', { v: 1 }), hist('gwen', 'gwen', 'l1', 4, PREV)));
await no('cannot write as someone else', leadWrite(db, 'l1', leadDoc('owner', 'amir'), hist('gwen', 'gwen', 'l1', 4, PREV)));
await no('cannot sign history as someone else', leadWrite(db, 'l1', leadDoc('gwen', 'gwen'), hist('owner', 'amir', 'l1', 4, PREV)));
await no('cannot add readable fields to a lead (e.g. a name)', leadWrite(db, 'l1', leadDoc('gwen', 'gwen', { name: 'Leak Example' }), hist('gwen', 'gwen', 'l1', 4, PREV)));
await no('cannot add readable fields to history', leadWrite(db, 'l1', leadDoc('gwen', 'gwen'), hist('gwen', 'gwen', 'l1', 4, PREV, { phone: '352-555-0100' })));
await no('cannot backdate a change', leadWrite(db, 'l1', leadDoc('gwen', 'gwen', { updatedAt: Timestamp.fromMillis(1) }), hist('gwen', 'gwen', 'l1', 4, PREV)));
await no('cannot close without a close time', leadWrite(db, 'l1', leadDoc('gwen', 'gwen', { status: 'done' }), hist('gwen', 'gwen', 'l1', 4, PREV)));
await ok('updates a lead with its history entry', leadWrite(db, 'l1', leadDoc('gwen', 'gwen'), hist('gwen', 'gwen', 'l1', 4, PREV)));
await ok('closes a lead with a close time', leadWrite(db, 'l1', leadDoc('gwen', 'gwen', { rev: 5, status: 'done', closedAt: serverTimestamp() }), hist('gwen', 'gwen', 'l1', 5, PREV)));
await no('cannot delete a lead (only the owner can)', leadWrite(db, 'l1', null, hist('gwen', 'gwen', 'l1', 6, PREV), 'delete'));
await ok('adds a lead by hand with its first history entry', leadWrite(db, 'n1', fresh('gwen', 'gwen'), hist('gwen', 'gwen', 'n1', 1, null), 'create'));
await no('cannot add a lead without history', setDoc(doc(db, 'leads/n2'), fresh('gwen', 'gwen')));
await no('cannot add a lead with a fake creation time', leadWrite(db, 'n3', fresh('gwen', 'gwen', { createdAt: Timestamp.fromMillis(5) }), hist('gwen', 'gwen', 'n3', 1, null), 'create'));
await no('cannot edit lead history', updateDoc(doc(db, 'leadLog/l1_3'), { ct: 'eA==' }));
await no('cannot delete lead history', deleteDoc(doc(db, 'leadLog/l1_3')));
await no('lead history cannot be written into the cases log', setDoc(doc(db, 'log/l1_6'), { caseId: 'l1', rev: 6, uid: 'gwen', sid: 'gwen', at: serverTimestamp(), v: 2, ...box, prev: PREV }));

console.log('\n# Owner');
db = env.authenticatedContext('owner').firestore();
await ok('reads the feed secret', getDoc(doc(db, 'meta/intakeSecret')));
await ok('reads the feed status', getDoc(doc(db, 'meta/intakeStats')));
await no('cannot write the feed status (the function does)', setDoc(doc(db, 'meta/intakeStats'), { okAt: serverTimestamp() }));
await ok('changes the follow-up settings', setDoc(doc(db, 'meta/settings'), { leads: { offsets: [0, 0, 1, 7, 14], assignee: 'auto' } }, { merge: true }));
await ok('sets up the feed key and secret together', (async () => {
  const b = writeBatch(db);
  b.set(doc(db, 'meta/intake'), { kid: 'k2', pub: PUB, priv: { v: 2, ...box }, at: serverTimestamp() });
  b.set(doc(db, 'meta/intakeSecret'), { hash: HASH, box: { v: 2, ...box }, on: true, at: serverTimestamp() });
  return b.commit();
})());
await no('the feed key must be a real P-256 public key', setDoc(doc(db, 'meta/intake'), { kid: 'k3', pub: { kty: 'EC', crv: 'P-256', x: 'AA', y: 'BB' }, priv: { v: 2, ...box }, at: serverTimestamp() }));
await no('the feed key needs a public key at all', setDoc(doc(db, 'meta/intake'), { kid: 'k3', priv: { v: 2, ...box }, at: serverTimestamp() }));
await no('no extra fields next to the feed key', setDoc(doc(db, 'meta/intake'), { kid: 'k3', pub: PUB, priv: { v: 2, ...box }, at: serverTimestamp(), plain: 'oops' }));
await ok('re-seals the feed key under a newer office key', updateDoc(doc(db, 'meta/intake'), { priv: { v: 2, iv: 'bmV3', ct: 'bmV3' } }));
await no('the secret is stored only as a hash', setDoc(doc(db, 'meta/intakeSecret'), { hash: 'not-a-hash', box: { v: 2, ...box }, on: true, at: serverTimestamp() }));
await no('the secret record takes no extra fields (no plain secret)', setDoc(doc(db, 'meta/intakeSecret'), { hash: HASH, box: { v: 2, ...box }, on: true, at: serverTimestamp(), secret: 'abc' }));
await ok('turns the feed off and on', updateDoc(doc(db, 'meta/intakeSecret'), { on: false, at: serverTimestamp() }));
await ok('removes a request that can’t be opened', deleteDoc(doc(db, 'leadInbox/w2')));
await ok('removes a request whose lead already exists', deleteDoc(doc(db, 'leadInbox/w4')));
await no('cannot delete a lead without keeping its last copy', deleteDoc(doc(db, 'leads/n1')));
await ok('deletes a lead, keeping its last copy in history', leadWrite(db, 'n1', null, hist('owner', 'amir', 'n1', 2, PREV), 'delete'));
await no('cannot delete the feed key', deleteDoc(doc(db, 'meta/intake')));
await no('cannot delete the feed secret', deleteDoc(doc(db, 'meta/intakeSecret')));
await no('cannot edit lead history either', updateDoc(doc(db, 'leadLog/l1_3'), { ct: 'eA==' }));

console.log('\n# Importing in batches (five leads per batch, each with its history)');
db = env.authenticatedContext('gwen').firestore();
await ok('a batch of five new leads with their history entries goes through', (async () => {
  const b = writeBatch(db);
  for (let i = 0; i < 5; i++) { b.set(doc(db, 'leads/imp' + i), fresh('gwen', 'gwen')); b.set(doc(db, 'leadLog/imp' + i + '_1'), hist('gwen', 'gwen', 'imp' + i, 1, null)); }
  return b.commit();
})());

console.log('\nPASS ' + pass + '  FAIL ' + fail);
await env.cleanup();
process.exit(fail ? 1 : 0);
