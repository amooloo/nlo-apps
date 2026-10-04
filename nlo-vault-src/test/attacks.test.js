// Attack cases from the independent security review (3 Oct 2026). Same seed shape as test/rules.test.js. Run like rules.test.js.
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp, query, where, addDoc, deleteField } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const ok = (n, p) => t(n, p, true), no = (n, p) => t(n, p, false);
const OWNER_EMAIL = 'dr.test@example.com';
const rules = readFileSync('dist-test/firestore.rules', 'utf8');
if (!rules.includes(OWNER_EMAIL)) throw new Error('build dist-test first');
const env = await initializeTestEnvironment({ projectId: 'demo-nlo-vault', firestore: { rules, host: '127.0.0.1', port: 8080 } });

const B = { iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVydGV4dA==' };
const B2 = { iv: 'BBBBBBBBBBBBBBBB', ct: 'b3RoZXI=' };
const JWK = { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) };
const SEALED = { epk: JWK, iv: 'CCCCCCCCCCCCCCCC', ct: 'c2VhbGVk' };
const H = 'a'.repeat(64);
const past = Timestamp.fromMillis(1.7e12);
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    const S = (p, d) => setDoc(doc(db, p), d);
    await S('meta/setup', { owner: 'owner', at: past });
    await S('meta/settings', { lockMax: 10, at: past });
    await S('users/owner', { name: 'Dr. A', email: OWNER_EMAIL, role: 'owner', active: true, pub: JWK, n: 0, at: past, by: 'owner' });
    for (const [u, active] of [['sarah', true], ['gwen', true], ['kay', false]])
      await S('users/' + u, { name: u, username: u, role: 'staff', active, pub: JWK, n: 1, at: past, by: 'owner' });
    for (const u of ['owner', 'sarah', 'gwen']) await S('keys/' + u, { wrap: B, temp: false, at: past });
    await S('logins/' + H, { n: 1 });
    await S('folders/frontffff', { name: B, kv: 2, color: 'blue', order: 1, at: past, by: 'owner' });
    await S('folders/clinicccc', { name: B, kv: 1, color: 'coral', order: 2, at: past, by: 'owner' });
    await S('folders/draonlyyy', { name: B, kv: 1, color: 'navy', order: 0, at: past, by: 'owner' });
    const g = (u, f, role) => S('grants/' + u + '_' + f, { uid: u, fid: f, role, keys: { 1: SEALED }, by: 'owner', at: past });
    for (const f of ['frontffff', 'clinicccc', 'draonlyyy']) await g('owner', f, 'edit');
    await g('sarah', 'frontffff', 'edit'); await g('gwen', 'frontffff', 'view'); await g('gwen', 'clinicccc', 'edit');
    await S('items/item1front00', { f: 'frontffff', kv: 2, ...B, rev: 3, at: past, cAt: past, by: 'owner', del: false });
    await S('items/item2clinic00', { f: 'clinicccc', kv: 1, ...B, rev: 1, at: past, cAt: past, by: 'owner', del: false });
    await S('log/l1', { by: 'sarah', at: past, a: 'copy-pw', i: 'item1front00', f: 'frontffff' });
  });
}
const I1 = { f: 'frontffff', kv: 2, ...B, rev: 3, del: false };
const upd = (by, cur, extra) => Object.assign({ f: cur.f, kv: cur.kv, ...B2, rev: cur.rev + 1, at: serverTimestamp(), by, del: cur.del }, extra || {});
const goodVer = (id, cur, by) => ({ i: id, f: cur.f, kv: cur.kv, iv: cur.iv, ct: cur.ct, rev: cur.rev, del: cur.del, at: serverTimestamp(), by });

await seed();

console.log('\n# INVARIANT: previous ciphertext must be preserved exactly');
let db = env.authenticatedContext('sarah').firestore();
{ // version carries the NEW ct instead of the old -> must fail
  const b = writeBatch(db);
  b.update(doc(db, 'items/item1front00'), upd('sarah', I1));
  b.set(doc(db, 'versions/item1front00_3'), { i: 'item1front00', f: 'frontffff', kv: 2, ...B2, rev: 3, del: false, at: serverTimestamp(), by: 'sarah' });
  await no('editor cannot overwrite item while version stores the NEW ciphertext', b.commit());
}
{ // version carries old ct but wrong iv
  const b = writeBatch(db);
  b.update(doc(db, 'items/item1front00'), upd('sarah', I1));
  b.set(doc(db, 'versions/item1front00_3'), { i: 'item1front00', f: 'frontffff', kv: 2, iv: B2.iv, ct: B.ct, rev: 3, del: false, at: serverTimestamp(), by: 'sarah' });
  await no('editor cannot overwrite item while version stores a different iv', b.commit());
}
{ // correct version -> succeeds
  const b = writeBatch(db);
  b.update(doc(db, 'items/item1front00'), upd('sarah', I1));
  b.set(doc(db, 'versions/item1front00_3'), goodVer('item1front00', I1, 'sarah'));
  await ok('editor CAN overwrite item when version stores the exact old ciphertext', b.commit());
}
await seed();
{ // try to pre-create a bogus version standalone (no item bump)
  const b = writeBatch(db);
  b.set(doc(db, 'versions/item1front00_3'), goodVer('item1front00', I1, 'sarah'));
  await no('editor cannot create a version doc not tied to an item bump', b.commit());
}

console.log('\n# ACTIVITY LOG forging / integrity');
db = env.authenticatedContext('sarah').firestore();
await no('member can forge a fabricated "setup" activity entry about themselves', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'setup' }));
await no('member can log an arbitrary item id they cannot even read (no canRead on i)', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'copy-pw', i: 'item2clinic00' }));
await no('member can stuff an arbitrary 128-char u string into the log', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'share', u: 'Z'.repeat(128) }));
await no('member still cannot log about a folder they cannot read (f is checked)', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'copy-pw', i: 'item2clinic00', f: 'clinicccc' }));

console.log('\n# ESCALATION attempts (should all fail)');
await no('editor cannot grant themselves another folder', setDoc(doc(db, 'grants/sarah_clinicccc'), { uid: 'sarah', fid: 'clinicccc', role: 'edit', keys: { 1: SEALED }, by: 'sarah', at: serverTimestamp() }));
await no('editor cannot upgrade their own grant role', updateDoc(doc(db, 'grants/sarah_frontffff'), { role: 'edit', by: 'owner', at: serverTimestamp() }));
await no('editor cannot flip their own role to owner', updateDoc(doc(db, 'users/sarah'), { role: 'owner' }));
await no('editor cannot read versions of items in their own folder', getDoc(doc(db, 'versions/item1front00_2')));
await no('editor cannot list versions', getDocs(query(collection(db, 'versions'), where('i', '==', 'item1front00'))));
await no('gwen (view Front) cannot create a version doc for a Front-office item', (async () => {
  const g = env.authenticatedContext('gwen').firestore();
  const b = g.batch ? g.batch() : writeBatch(g);
  b.update(doc(g, 'items/item1front00'), upd('gwen', I1));
  b.set(doc(g, 'versions/item1front00_3'), goodVer('item1front00', I1, 'gwen'));
  return b.commit();
})());

console.log('\n# DoS surface: oversized ciphertext an editor may store');
await ok('editor may store a ~300KB ciphertext item (within limit)', setDoc(doc(db, 'items/bigitem000001'), { f: 'frontffff', kv: 2, iv: B.iv, ct: 'Q'.repeat(300000), rev: 1, at: serverTimestamp(), cAt: serverTimestamp(), by: 'sarah', del: false }));
await no('editor cannot exceed the 300KB ciphertext limit', setDoc(doc(db, 'items/bigitem000002'), { f: 'frontffff', kv: 2, iv: B.iv, ct: 'Q'.repeat(300001), rev: 1, at: serverTimestamp(), cAt: serverTimestamp(), by: 'sarah', del: false }));

console.log('\n# OWNER can erase history (noted, acceptable), but cannot forge it');
db = env.authenticatedContext('owner', { email: OWNER_EMAIL, email_verified: true }).firestore();
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'versions/item2clinic00_1'), { i: 'item2clinic00', f: 'clinicccc', kv: 1, ...B, rev: 1, del: false, at: past, by: 'owner' }); });
await no('owner can delete a history version', deleteDoc(doc(db, 'versions/item2clinic00_1')));
await no('owner cannot forge a standalone history version', setDoc(doc(db, 'versions/item2clinic00_9'), { i: 'item2clinic00', f: 'clinicccc', kv: 1, ...B, rev: 9, del: false, at: serverTimestamp(), by: 'owner' }));

console.log('\n# SOMEONE SIGNED IN AS DR. A (e.g. reset through his email) can\'t wreck his key');
{
  const tok = l => (l + '-').padEnd(43, 'x'), LH = l => createHash('sha256').update(tok(l), 'utf8').digest('hex');
  // the state after one real change: token pw0 was shown (it stays readable in the doc), pw1 is the current one
  await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'keys/owner'), { wrap: B, rec: { salt: 'c2FsdA==', iter: 100000, iv: B.iv, ct: B.ct }, temp: false, at: past, px: tok('pw0'), pl: LH('pw1'), pc: 1, rl: LH('rc0'), rc: 0 }); });
  const o = env.authenticatedContext('owner', { email: OWNER_EMAIL, email_verified: true }).firestore();
  await no('cannot overwrite his key copy with junk', updateDoc(doc(o, 'keys/owner'), { wrap: B2, at: serverTimestamp() }));
  await no('cannot wipe his recovery copy', updateDoc(doc(o, 'keys/owner'), { rec: deleteField(), at: serverTimestamp() }));
  await no('cannot put in token checks of their own', updateDoc(doc(o, 'keys/owner'), { pl: LH('mine'), rl: LH('mine2'), at: serverTimestamp() }));
  await no('cannot replay the token shown last time (it is readable)', updateDoc(doc(o, 'keys/owner'), { wrap: B2, px: tok('pw0'), pl: LH('mine'), pc: 2, at: serverTimestamp() }));
  await no('cannot replace the whole document', setDoc(doc(o, 'keys/owner'), { wrap: B2, temp: false, at: serverTimestamp() }));
  await no('cannot delete it', deleteDoc(doc(o, 'keys/owner')));
}

console.log('\n# …nor block key changes for good');
{
  await env.withSecurityRulesDisabled(async c => {
    const d0 = c.firestore();
    await setDoc(doc(d0, 'meta/setup'), { owner: 'owner', at: past, spk: JWK });
    await setDoc(doc(d0, 'folders/frontffff'), { name: B, kv: 2, ks: { 1: 's1', 2: 's2' }, color: 'blue', order: 1, at: past, by: 'owner' });
  });
  const o = env.authenticatedContext('owner', { email: OWNER_EMAIL, email_verified: true }).firestore();
  await no('cannot set the key version to 2^53 − 1 (the next one couldn\'t be written)', updateDoc(doc(o, 'folders/frontffff'), { kv: 9007199254740991, at: serverTimestamp(), by: 'owner' }));
  await no('cannot pre-fill the next signature slot', updateDoc(doc(o, 'folders/frontffff'), { 'ks.3': 'junk', at: serverTimestamp(), by: 'owner' }));
  await no('cannot pre-fill Dr. A\'s next key slot', updateDoc(doc(o, 'grants/owner_frontffff'), { 'keys.3': SEALED, at: serverTimestamp(), by: 'owner' }));
  await no('cannot stuff signatures in one go', updateDoc(doc(o, 'folders/frontffff'), Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['ks.' + (i + 3), 'x'.repeat(200)]).concat([['kv', 3], ['at', serverTimestamp()], ['by', 'owner']]))));
}

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
