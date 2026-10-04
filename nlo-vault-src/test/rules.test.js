// Security-rules tests: everything the app needs to do, and what a stranger, a removed person, or a staff member
// with a login would try. Run inside the emulator:
//   npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-nlo-vault "node test/rules.test.js"
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp, query, where, deleteField, addDoc } from 'firebase/firestore';
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
if (!rules.includes(OWNER_EMAIL)) throw new Error('build dist-test first (node build.mjs --emu)');
const env = await initializeTestEnvironment({ projectId: 'demo-nlo-vault', firestore: { rules, host: '127.0.0.1', port: 8080 } });

const B = { iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVydGV4dA==' };
const B2 = { iv: 'BBBBBBBBBBBBBBBB', ct: 'b3RoZXI=' };
const JWK = { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) };
const SEALED = { epk: JWK, iv: 'CCCCCCCCCCCCCCCC', ct: 'c2VhbGVk' };
const H = 'a'.repeat(64);
const past = Timestamp.fromMillis(1.7e12);
// Dr. A's one-time tokens (the app derives them from his password / recovery code; here any 43-character strings)
const tok = label => (label + '-').padEnd(43, 'x');
const LH = label => createHash('sha256').update(tok(label), 'utf8').digest('hex');
const OWNER_LOCKS = { pl: LH('pw0'), pc: 0, rl: LH('rc0'), rc: 0 };
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    const S = (p, d) => setDoc(doc(db, p), d);
    await S('meta/setup', { owner: 'owner', at: past, spk: JWK });
    await S('meta/settings', { lockMax: 10, at: past });
    await S('users/owner', { name: 'Dr. A', role: 'owner', active: true, pub: JWK, n: 0, at: past, by: 'owner' });
    for (const [u, active] of [['sarah', true], ['gwen', true], ['kay', false]])
      await S('users/' + u, { name: u, username: u, role: 'staff', active, pub: JWK, n: 1, at: past, by: 'owner' });
    for (const u of ['sarah', 'gwen']) await S('keys/' + u, { wrap: B, temp: false, at: past });
    await S('keys/owner', Object.assign({ wrap: B, rec: { salt: 'c2FsdA==', iter: 100000, iv: B.iv, ct: B.ct }, temp: false, at: past }, OWNER_LOCKS));
    await S('logins/' + H, { n: 1 });
    await S('folders/frontffff', { name: B, kv: 2, ks: { 1: 'sig1', 2: 'sig2' }, color: 'blue', order: 1, at: past, by: 'owner' });
    await S('folders/clinicccc', { name: B, kv: 1, ks: { 1: 'sig1' }, color: 'coral', order: 2, at: past, by: 'owner' });
    await S('folders/draonlyyy', { name: B, kv: 1, ks: { 1: 'sig1' }, color: 'navy', order: 0, at: past, by: 'owner' });
    await S('items/item4stale000', { f: 'frontffff', kv: 2, ...B, rev: 2, at: past, cAt: past, by: 'owner', del: false });
    await S('versions/item4stale000_2', { i: 'item4stale000', f: 'frontffff', kv: 2, ...B2, rev: 2, del: false, at: past, by: 'owner' });
    const g = (u, f, role) => S('grants/' + u + '_' + f, { uid: u, fid: f, role, keys: { 1: SEALED }, by: 'owner', at: past });
    for (const f of ['frontffff', 'clinicccc', 'draonlyyy']) await g('owner', f, 'edit');
    await g('sarah', 'frontffff', 'edit'); await g('gwen', 'frontffff', 'view'); await g('gwen', 'clinicccc', 'edit'); await g('kay', 'frontffff', 'edit');
    await S('items/item1front00', { f: 'frontffff', kv: 2, ...B, rev: 3, at: past, cAt: past, by: 'owner', del: false });
    await S('items/item2clinic00', { f: 'clinicccc', kv: 1, ...B, rev: 1, at: past, cAt: past, by: 'owner', del: false });
    await S('items/item3draonly0', { f: 'draonlyyy', kv: 1, ...B, rev: 1, at: past, cAt: past, by: 'owner', del: false });
    await S('versions/item1front00_2', { i: 'item1front00', f: 'frontffff', kv: 2, ...B2, rev: 2, del: false, at: past, by: 'owner' });
    await S('log/l1', { by: 'sarah', at: past, a: 'copy-pw', i: 'item1front00', f: 'frontffff' });
  });
}
const itemNew = (by, f, kv, extra) => Object.assign({ f, kv, ...B2, rev: 1, at: serverTimestamp(), cAt: serverTimestamp(), by, del: false }, extra || {});
function itemUpdate(db, id, cur, next, ver) {
  const b = writeBatch(db);
  b.update(doc(db, 'items/' + id), next);
  if (ver !== null) b.set(doc(db, 'versions/' + id + '_' + cur.rev), ver || { i: id, f: cur.f, kv: cur.kv, iv: cur.iv, ct: cur.ct, rev: cur.rev, del: cur.del, at: serverTimestamp(), by: next.by });
  return b.commit();
}
const I1 = { f: 'frontffff', kv: 2, ...B, rev: 3, del: false };
const I2 = { f: 'clinicccc', kv: 1, ...B, rev: 1, del: false };
const upd = (by, cur, extra) => Object.assign({ f: cur.f, kv: cur.kv, ...B2, rev: cur.rev + 1, at: serverTimestamp(), by, del: cur.del }, extra || {});

await seed();
console.log('\n# Signed-out visitor');
let db = env.unauthenticatedContext().firestore();
await ok('can look up one login number (needed to sign in)', getDoc(doc(db, 'logins/' + H)));
await no('cannot list logins', getDocs(collection(db, 'logins')));
for (const p of ['users/sarah', 'keys/sarah', 'folders/frontffff', 'grants/sarah_frontffff', 'items/item1front00', 'versions/item1front00_2', 'meta/setup', 'meta/settings', 'log/l1', 'prefs/sarah'])
  await no('cannot read ' + p, getDoc(doc(db, p)));
await no('cannot list items', getDocs(collection(db, 'items')));
await no('cannot write an item', setDoc(doc(db, 'items/xxxxxxxxxxxxx'), itemNew('anon', 'frontffff', 2)));

console.log('\n# Stranger with an account (not a member)');
db = env.authenticatedContext('stranger', { email: 'x@evil.test', email_verified: true }).firestore();
for (const p of ['users/sarah', 'keys/sarah', 'folders/frontffff', 'items/item1front00', 'meta/settings', 'log/l1', 'grants/sarah_frontffff'])
  await no('cannot read ' + p, getDoc(doc(db, p)));
await no('cannot list users', getDocs(collection(db, 'users')));
await no('cannot list grants', getDocs(collection(db, 'grants')));
await no('cannot make itself a member', setDoc(doc(db, 'users/stranger'), { name: 'X', username: 'xx', role: 'staff', active: true, pub: JWK, n: 1, at: serverTimestamp(), by: 'stranger' }));
await no('cannot make itself the owner', setDoc(doc(db, 'users/stranger'), { name: 'X', email: 'x@evil.test', role: 'owner', active: true, pub: JWK, n: 0 }));
await no('cannot give itself a grant', setDoc(doc(db, 'grants/stranger_frontffff'), { uid: 'stranger', fid: 'frontffff', role: 'edit', keys: { 1: SEALED }, by: 'stranger', at: serverTimestamp() }));
await no('cannot write activity', addDoc(collection(db, 'log'), { by: 'stranger', at: serverTimestamp(), a: 'copy-pw' }));
await no('cannot add a login number', setDoc(doc(db, 'logins/' + 'b'.repeat(64)), { n: 1 }));

console.log('\n# Removed person (still has an old grant)');
db = env.authenticatedContext('kay').firestore();
await no('cannot read an item in the folder they had', getDoc(doc(db, 'items/item1front00')));
await no('cannot list that folder', getDocs(query(collection(db, 'items'), where('f', '==', 'frontffff'))));
await no('cannot read the folder', getDoc(doc(db, 'folders/frontffff')));
await no('cannot read their old grant', getDoc(doc(db, 'grants/kay_frontffff')));
await no('cannot write an item', setDoc(doc(db, 'items/kayitem0000000'), itemNew('kay', 'frontffff', 2)));
await no('cannot switch themselves back on', updateDoc(doc(db, 'users/kay'), { active: true }));
await no('cannot note "seen"', updateDoc(doc(db, 'users/kay'), { seen: serverTimestamp() }));
await no('cannot write activity', addDoc(collection(db, 'log'), { by: 'kay', at: serverTimestamp(), a: 'reveal' }));

console.log('\n# Sarah (edit: Front office only)');
db = env.authenticatedContext('sarah').firestore();
await ok('can list people (names)', getDocs(collection(db, 'users')));
await ok('can read her own key', getDoc(doc(db, 'keys/sarah')));
await no('cannot read Gwen\'s key', getDoc(doc(db, 'keys/gwen')));
await no('cannot read Dr. A\'s key (and recovery copy)', getDoc(doc(db, 'keys/owner')));
await ok('can read Front office', getDoc(doc(db, 'folders/frontffff')));
await no('cannot read Clinical', getDoc(doc(db, 'folders/clinicccc')));
await no('cannot read Dr. A only', getDoc(doc(db, 'folders/draonlyyy')));
await no('cannot list all folders', getDocs(collection(db, 'folders')));
await ok('can list her own grants', getDocs(query(collection(db, 'grants'), where('uid', '==', 'sarah'))));
await no('cannot list everyone\'s grants', getDocs(collection(db, 'grants')));
await no('cannot read Gwen\'s grant', getDoc(doc(db, 'grants/gwen_frontffff')));
await ok('can read a Front office item', getDoc(doc(db, 'items/item1front00')));
await no('cannot read a Clinical item', getDoc(doc(db, 'items/item2clinic00')));
await no('cannot read a Dr. A only item', getDoc(doc(db, 'items/item3draonly0')));
await ok('can list Front office items', getDocs(query(collection(db, 'items'), where('f', '==', 'frontffff'))));
await no('cannot list all items', getDocs(collection(db, 'items')));
await no('cannot list Clinical items', getDocs(query(collection(db, 'items'), where('f', '==', 'clinicccc'))));
await ok('can add an item to Front office', setDoc(doc(db, 'items/sarahitem00001'), itemNew('sarah', 'frontffff', 2)));
await no('cannot add one under the old key version', setDoc(doc(db, 'items/sarahitem00002'), itemNew('sarah', 'frontffff', 1)));
await no('cannot add one as someone else', setDoc(doc(db, 'items/sarahitem00003'), itemNew('gwen', 'frontffff', 2)));
await no('cannot add one to Clinical', setDoc(doc(db, 'items/sarahitem00004'), itemNew('sarah', 'clinicccc', 1)));
await no('cannot add extra plain fields', setDoc(doc(db, 'items/sarahitem00005'), itemNew('sarah', 'frontffff', 2, { title: 'Delta Dental' })));
await no('cannot start at revision 2', setDoc(doc(db, 'items/sarahitem00006'), itemNew('sarah', 'frontffff', 2, { rev: 2 })));
await no('cannot pick a bad id', setDoc(doc(db, 'items/X'), itemNew('sarah', 'frontffff', 2)));
await no('cannot change an item without saving its previous version', itemUpdate(db, 'item1front00', I1, upd('sarah', I1), null));
await no('cannot save a fake previous version', itemUpdate(db, 'item1front00', I1, upd('sarah', I1), { i: 'item1front00', f: 'frontffff', kv: 2, ...B2, rev: 3, del: false, at: serverTimestamp(), by: 'sarah' }));
await no('cannot skip a revision', itemUpdate(db, 'item1front00', I1, upd('sarah', I1, { rev: 5 })));
await no('cannot move it to a folder she can\'t edit', itemUpdate(db, 'item1front00', I1, upd('sarah', I1, { f: 'clinicccc', kv: 1 })));
await no('cannot change when it was created', itemUpdate(db, 'item1front00', I1, upd('sarah', I1, { cAt: serverTimestamp() })));
await no('cannot write a version on its own', setDoc(doc(db, 'versions/item1front00_3'), { i: 'item1front00', f: 'frontffff', kv: 2, ...B, rev: 3, del: false, at: serverTimestamp(), by: 'sarah' }));
await ok('can change an item (previous version saved with it)', itemUpdate(db, 'item1front00', I1, upd('sarah', I1)));
await no('cannot lean on an old, different saved version instead of saving the real one', itemUpdate(db, 'item4stale000', { f: 'frontffff', kv: 2, ...B, rev: 2, del: false }, upd('sarah', { f: 'frontffff', kv: 2, rev: 2, del: false }), null));
const I1b = { f: 'frontffff', kv: 2, ...B2, rev: 4, del: false };
await no('cannot overwrite a saved version', setDoc(doc(db, 'versions/item1front00_3'), { i: 'item1front00', f: 'frontffff', kv: 2, ...B2, rev: 3, del: false, at: serverTimestamp(), by: 'sarah' }));
await no('cannot read versions', getDoc(doc(db, 'versions/item1front00_3')));
await no('cannot delete a version', deleteDoc(doc(db, 'versions/item1front00_3')));
await ok('can move it to the trash (a change like any other)', itemUpdate(db, 'item1front00', I1b, upd('sarah', I1b, { del: true })));
await no('cannot delete an item for good', deleteDoc(doc(db, 'items/item1front00')));
await no('cannot give herself Clinical', setDoc(doc(db, 'grants/sarah_clinicccc'), { uid: 'sarah', fid: 'clinicccc', role: 'edit', keys: { 1: SEALED }, by: 'sarah', at: serverTimestamp() }));
await no('cannot change a person', updateDoc(doc(db, 'users/gwen'), { active: false }));
await no('cannot make herself owner', updateDoc(doc(db, 'users/sarah'), { role: 'owner' }));
await ok('can note when she last used the vault', updateDoc(doc(db, 'users/sarah'), { seen: serverTimestamp() }));
await no('cannot backdate it', updateDoc(doc(db, 'users/sarah'), { seen: past }));
await no('cannot change her name with it', updateDoc(doc(db, 'users/sarah'), { seen: serverTimestamp(), name: 'Boss' }));
await ok('can re-lock her own key (password change)', updateDoc(doc(db, 'keys/sarah'), { next: B2 }));
await no('cannot mark her key temporary again', updateDoc(doc(db, 'keys/sarah'), { temp: true }));
await no('cannot add a recovery copy', updateDoc(doc(db, 'keys/sarah'), { rec: { salt: 'c2FsdA==', iter: 100000, iv: B.iv, ct: B.ct } }));
await no('cannot replace Gwen\'s key', updateDoc(doc(db, 'keys/gwen'), { wrap: B2 }));
await ok('can log copying a password she can see', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'copy-pw', i: 'item1front00', f: 'frontffff' }));
await no('cannot log a made-up action', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'setup' }));
await no('cannot log an unknown action word', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'hacked-it' }));
await no('cannot log about an item without saying its folder', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'copy-pw', i: 'item2clinic00' }));
await no('cannot log about another folder\'s item under her folder', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'copy-pw', i: 'item2clinic00', f: 'frontffff' }));
await no('cannot name a person in a log entry', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'reveal', i: 'item1front00', f: 'frontffff', u: 'gwen' }));
await no('cannot log as someone else', addDoc(collection(db, 'log'), { by: 'gwen', at: serverTimestamp(), a: 'copy-pw' }));
await no('cannot backdate a log entry', addDoc(collection(db, 'log'), { by: 'sarah', at: past, a: 'copy-pw' }));
await no('cannot log about a folder she can\'t open', addDoc(collection(db, 'log'), { by: 'sarah', at: serverTimestamp(), a: 'copy-pw', i: 'item2clinic00', f: 'clinicccc' }));
await no('cannot read the activity log', getDocs(collection(db, 'log')));
await no('cannot change a log entry', updateDoc(doc(db, 'log/l1'), { a: 'edit' }));
await no('cannot delete a log entry', deleteDoc(doc(db, 'log/l1')));
await ok('can save her own preferences', setDoc(doc(db, 'prefs/sarah'), { favs: ['item1front00'], lock: 5 }));
await no('cannot write Gwen\'s preferences', setDoc(doc(db, 'prefs/gwen'), { favs: [], lock: 1 }));
await no('cannot change the office settings', updateDoc(doc(db, 'meta/settings'), { lockMax: 60, at: serverTimestamp() }));
await no('cannot change a folder', updateDoc(doc(db, 'folders/frontffff'), { color: 'gold', at: serverTimestamp(), by: 'sarah' }));
await no('cannot write login numbers', setDoc(doc(db, 'logins/' + H), { n: 2 }));
await no('cannot read another person\'s preferences', getDoc(doc(db, 'prefs/gwen')));

console.log('\n# Gwen (view: Front office, edit: Clinical)');
db = env.authenticatedContext('gwen').firestore();
await ok('can read Front office', getDoc(doc(db, 'items/item1front00')));
const I1c = { f: 'frontffff', kv: 2, ...B2, rev: 5, del: true };
await no('cannot change a Front office item (view only)', itemUpdate(db, 'item1front00', I1c, upd('gwen', I1c, { del: false })));
await no('cannot add to Front office (view only)', setDoc(doc(db, 'items/gwenitem000001'), itemNew('gwen', 'frontffff', 2)));
await ok('can change a Clinical item', itemUpdate(db, 'item2clinic00', I2, upd('gwen', I2)));
await no('cannot move a Clinical item into Front office (view only there)', itemUpdate(db, 'item2clinic00', { ...I2, ...B2, rev: 2 }, upd('gwen', { ...I2, rev: 2 }, { f: 'frontffff', kv: 2 })));
await no('cannot upgrade herself to edit', updateDoc(doc(db, 'grants/gwen_frontffff'), { role: 'edit' }));

console.log('\n# Dr. A');
db = env.authenticatedContext('owner', { email: OWNER_EMAIL, email_verified: true }).firestore();
await ok('can list every item', getDocs(collection(db, 'items')));
await ok('can list every folder', getDocs(collection(db, 'folders')));
await ok('can list every grant', getDocs(collection(db, 'grants')));
await ok('can read versions', getDocs(query(collection(db, 'versions'), where('i', '==', 'item1front00'))));
await ok('can read the activity log', getDocs(collection(db, 'log')));
await no('cannot read Sarah\'s key', getDoc(doc(db, 'keys/sarah')));
await ok('can make a folder', setDoc(doc(db, 'folders/newfolder1'), { name: B, kv: 1, ks: { 1: 'sig' }, color: 'gold', order: 4, at: serverTimestamp(), by: 'owner' }));
await no('cannot make a folder without a key signature', setDoc(doc(db, 'folders/newfolder3'), { name: B, kv: 1, color: 'gold', order: 4, at: serverTimestamp(), by: 'owner' }));
await no('cannot make a folder at key version 2', setDoc(doc(db, 'folders/newfolder2'), { name: B, kv: 2, ks: { 1: 'sig' }, color: 'gold', order: 4, at: serverTimestamp(), by: 'owner' }));
await ok('can give a folder a new key (version +1, signed)', updateDoc(doc(db, 'folders/clinicccc'), { kv: 2, 'ks.2': 'sig2', name: B2, rot: { from: 1, to: 2, why: 'Kay left' }, at: serverTimestamp(), by: 'owner' }));
await no('cannot change a key signature once written', updateDoc(doc(db, 'folders/clinicccc'), { 'ks.1': 'forged', at: serverTimestamp(), by: 'owner' }));
await no('cannot drop key signatures', updateDoc(doc(db, 'folders/clinicccc'), { ks: { 2: 'sig2' }, at: serverTimestamp(), by: 'owner' }));
await no('cannot skip key versions (no huge version numbers)', updateDoc(doc(db, 'folders/clinicccc'), { kv: 9007199254740991, at: serverTimestamp(), by: 'owner' }));
await no('cannot lower the key version', updateDoc(doc(db, 'folders/clinicccc'), { kv: 1, at: serverTimestamp(), by: 'owner' }));
await no('cannot fill in the signature slot of a future version', updateDoc(doc(db, 'folders/clinicccc'), { 'ks.3': 'junk', at: serverTimestamp(), by: 'owner' }));
await no('cannot stuff the folder with signatures', updateDoc(doc(db, 'folders/clinicccc'), { kv: 3, 'ks.3': 's', 'ks.4': 's', 'ks.5': 's', at: serverTimestamp(), by: 'owner' }));
await no('cannot attach a giant signature', updateDoc(doc(db, 'folders/clinicccc'), { kv: 3, 'ks.3': 's'.repeat(201), at: serverTimestamp(), by: 'owner' }));
await no('cannot store an email in his people entry (staff can read it)', updateDoc(doc(db, 'users/owner'), { email: OWNER_EMAIL }));
await ok('can give Sarah Clinical (with his signature on her place)', setDoc(doc(db, 'grants/sarah_clinicccc'), { uid: 'sarah', fid: 'clinicccc', role: 'view', keys: { 1: SEALED, 2: SEALED }, gs: 'c2ln', by: 'owner', at: serverTimestamp() }));
await no('cannot attach an oversized signature', setDoc(doc(db, 'grants/gwen_draonlyyy'), { uid: 'gwen', fid: 'draonlyyy', role: 'view', keys: { 1: SEALED }, gs: 's'.repeat(201), by: 'owner', at: serverTimestamp() }));
await ok('a place for a removed person can be written…', setDoc(doc(db, 'grants/kay_clinicccc'), { uid: 'kay', fid: 'clinicccc', role: 'view', keys: { 1: SEALED }, by: 'owner', at: serverTimestamp() }));
await no('…but gives them nothing', getDoc(doc(env.authenticatedContext('kay').firestore(), 'items/item2clinic00')));
await no('cannot give an "admin" role', setDoc(doc(db, 'grants/gwen_draonlyyy'), { uid: 'gwen', fid: 'draonlyyy', role: 'admin', keys: { 1: SEALED }, by: 'owner', at: serverTimestamp() }));
await no('cannot file a grant under the wrong id', setDoc(doc(db, 'grants/gwen_xxx'), { uid: 'gwen', fid: 'draonlyyy', role: 'view', keys: { 1: SEALED }, by: 'owner', at: serverTimestamp() }));
await ok('can take Gwen out of Front office', deleteDoc(doc(db, 'grants/gwen_frontffff')));
{
  const b = writeBatch(db);
  b.set(doc(db, 'users/newbie'), { name: 'Newbie', username: 'newbie', role: 'staff', active: true, pub: JWK, ps: 'c2ln', n: 1, at: serverTimestamp(), by: 'owner' });
  b.set(doc(db, 'keys/newbie'), { wrap: B, temp: true, at: serverTimestamp() });
  b.set(doc(db, 'logins/' + 'c'.repeat(64)), { n: 1 });
  b.set(doc(db, 'grants/newbie_frontffff'), { uid: 'newbie', fid: 'frontffff', role: 'view', keys: { 2: SEALED }, by: 'owner', at: serverTimestamp() });
  await ok('can add a person (login, temporary key, folders) in one go', b.commit());
}
await no('cannot give a new person a non-temporary key', setDoc(doc(db, 'keys/newbie2'), { wrap: B, temp: false, at: serverTimestamp() }));
await no('cannot change the signature on a person', updateDoc(doc(db, 'users/newbie'), { ps: 'b3RoZXI=' }));
await no('cannot replace Sarah\'s key', updateDoc(doc(db, 'keys/sarah'), { wrap: B2 }));
await no('cannot add a second owner', setDoc(doc(db, 'users/boss2'), { name: 'Boss', email: 'b@x.test', role: 'owner', active: true, pub: JWK, n: 0, at: serverTimestamp(), by: 'owner' }));
await ok('can switch Sarah off', updateDoc(doc(db, 'users/sarah'), { active: false, removedAt: serverTimestamp() }));
await no('cannot switch Kay back on', updateDoc(doc(db, 'users/kay'), { active: true }));
await no('cannot switch himself off', updateDoc(doc(db, 'users/owner'), { active: false }));
await no('cannot make Gwen owner', updateDoc(doc(db, 'users/gwen'), { role: 'owner' }));
await no('cannot swap Gwen\'s public key', updateDoc(doc(db, 'users/gwen'), { pub: Object.assign({}, JWK, { x: 'z'.repeat(43) }) }));
await ok('can rename Gwen', updateDoc(doc(db, 'users/gwen'), { name: 'Gwen W.' }));
await ok('can set the office auto-lock', updateDoc(doc(db, 'meta/settings'), { lockMax: 5, at: serverTimestamp() }));
await no('cannot set auto-lock to 0', updateDoc(doc(db, 'meta/settings'), { lockMax: 0, at: serverTimestamp() }));
await no('cannot set auto-lock above 60', updateDoc(doc(db, 'meta/settings'), { lockMax: 61, at: serverTimestamp() }));
await no('cannot store a bad login number id', setDoc(doc(db, 'logins/sarah'), { n: 1 }));
await no('cannot delete an item for good without keeping its last version', deleteDoc(doc(db, 'items/item3draonly0')));
{
  const b = writeBatch(db);
  b.set(doc(db, 'versions/item3draonly0_1'), { i: 'item3draonly0', f: 'draonlyyy', kv: 1, ...B, rev: 1, del: false, at: serverTimestamp(), by: 'owner' });
  b.delete(doc(db, 'items/item3draonly0'));
  await ok('can delete an item for good, keeping its last version', b.commit());
}
await no('a new login can\'t reuse the id of one deleted for good', setDoc(doc(db, 'items/item3draonly0'), itemNew('owner', 'draonlyyy', 1)));
await no('cannot delete history, even as owner', deleteDoc(doc(db, 'versions/item1front00_2')));
await no('cannot change history, even as owner', updateDoc(doc(db, 'versions/item1front00_2'), { ct: 'eA==' }));
await no('cannot delete activity, even as owner', deleteDoc(doc(db, 'log/l1')));
await ok('can write owner-only activity', addDoc(collection(db, 'log'), { by: 'owner', at: serverTimestamp(), a: 'person-remove', u: 'sarah' }));
await no('cannot delete a folder (only hide it)', deleteDoc(doc(db, 'folders/newfolder1')));
await ok('can hide an empty folder', updateDoc(doc(db, 'folders/newfolder1'), { gone: true, at: serverTimestamp(), by: 'owner' }));
await no('cannot delete his own grant (it holds the keys)', deleteDoc(doc(db, 'grants/owner_frontffff')));
await no('cannot remove a key version from his own grant', updateDoc(doc(db, 'grants/owner_frontffff'), { keys: { 2: SEALED }, by: 'owner', at: serverTimestamp() }));
await no('cannot replace a key in his own grant', updateDoc(doc(db, 'grants/owner_frontffff'), { 'keys.1': Object.assign({}, SEALED, { ct: 'b3RoZXI=' }), by: 'owner', at: serverTimestamp() }));
await no('cannot add a key version to his grant without the folder moving to it', updateDoc(doc(db, 'grants/owner_frontffff'), { 'keys.3': SEALED, by: 'owner', at: serverTimestamp() }));
{
  const b = writeBatch(db);
  b.update(doc(db, 'folders/frontffff'), { kv: 3, 'ks.3': 'sig3', at: serverTimestamp(), by: 'owner' });
  b.update(doc(db, 'grants/owner_frontffff'), { 'keys.3': SEALED, by: 'owner', at: serverTimestamp() });
  await ok('his grant takes a new key version in the same write that moves the folder to it', b.commit());
}
{
  const b = writeBatch(db);
  b.update(doc(db, 'folders/frontffff'), { kv: 4, 'ks.4': 'sig4', at: serverTimestamp(), by: 'owner' });
  b.update(doc(db, 'grants/owner_frontffff'), { 'keys.4': Object.assign({}, SEALED, { ct: 'c'.repeat(101) }), by: 'owner', at: serverTimestamp() });
  await no('…but only a small sealed key', b.commit());
}
await no('a staff place can\'t hold more than 10 key versions', setDoc(doc(db, 'grants/gwen_draonlyyy'), { uid: 'gwen', fid: 'draonlyyy', role: 'view', keys: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), SEALED])), by: 'owner', at: serverTimestamp() }));
await ok('can still delete a staff grant', deleteDoc(doc(db, 'grants/gwen_clinicccc')));
await no('cannot change the setup record', updateDoc(doc(db, 'meta/setup'), { owner: 'sarah' }));
await no('cannot delete the setup record', deleteDoc(doc(db, 'meta/setup')));
const REC2 = { salt: 'c2FsdDI=', iter: 100000, iv: B.iv, ct: B2.ct };
await no('cannot change his own key copy without the one-time token', updateDoc(doc(db, 'keys/owner'), { wrap: B2, at: serverTimestamp() }));
await no('… or with a wrong token', updateDoc(doc(db, 'keys/owner'), { wrap: B2, px: tok('guess'), pl: LH('pw1'), pc: 1, at: serverTimestamp() }));
await no('cannot wipe his recovery copy without it', updateDoc(doc(db, 'keys/owner'), { rec: REC2, at: serverTimestamp() }));
await no('cannot drop the token checks', updateDoc(doc(db, 'keys/owner'), { pl: deleteField(), rl: deleteField(), at: serverTimestamp() }));
await no('cannot delete his key copy', deleteDoc(doc(db, 'keys/owner')));
await no('must set a new token (the one shown can\'t stay valid)', updateDoc(doc(db, 'keys/owner'), { wrap: B2, px: tok('pw0'), pl: LH('pw0'), pc: 0, at: serverTimestamp() }));
await ok('can change it with the current password token, setting the next', updateDoc(doc(db, 'keys/owner'), { wrap: B2, px: tok('pw0'), pl: LH('pw1'), pc: 1, at: serverTimestamp() }));
await no('a token already shown can\'t be used again', updateDoc(doc(db, 'keys/owner'), { wrap: B, px: tok('pw0'), pl: LH('pw2'), pc: 2, at: serverTimestamp() }));
await no('cannot keep a weak recovery copy', updateDoc(doc(db, 'keys/owner'), { rec: { salt: 'c2FsdA==', iter: 1000, iv: B.iv, ct: B.ct }, px: tok('pw1'), pl: LH('pw2'), pc: 2, at: serverTimestamp() }));
await ok('can make a new recovery copy (password token)', updateDoc(doc(db, 'keys/owner'), { rec: REC2, rl: LH('rc1'), rc: 1, px: tok('pw1'), pl: LH('pw2'), pc: 2, at: serverTimestamp() }));
await ok('the recovery-code token works when the password is forgotten', updateDoc(doc(db, 'keys/owner'), { wrap: B, px: tok('rc1'), rl: LH('rc2'), rc: 2, pl: LH('pw9'), pc: 9, at: serverTimestamp() }));
await ok('a password change parks the new copy with a token for the new password', updateDoc(doc(db, 'keys/owner'), { next: B2, npl: LH('nx'), px: tok('pw9'), pl: LH('pw10'), pc: 10, at: serverTimestamp() }));
await ok('… which the new password then uses to make it the main copy', updateDoc(doc(db, 'keys/owner'), { wrap: B2, next: deleteField(), npl: deleteField(), px: tok('nx'), pl: LH('pw11'), pc: 11, at: serverTimestamp() }));
await no('the parked token is gone afterwards', updateDoc(doc(db, 'keys/owner'), { wrap: B, px: tok('nx'), pl: LH('pw12'), pc: 12, at: serverTimestamp() }));
await no('cannot stuff his grant with many versions at once', updateDoc(doc(db, 'grants/owner_clinicccc'), Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['keys.' + (i + 10), SEALED]).concat([['by', 'owner'], ['at', serverTimestamp()]]))));
await no('a token change must move the counter on', updateDoc(doc(db, 'keys/owner'), { wrap: B, px: tok('pw11'), pl: LH('pw12'), pc: 11, at: serverTimestamp() }));
await ok('(with the counter moving on it works)', updateDoc(doc(db, 'keys/owner'), { wrap: B, px: tok('pw11'), pl: LH('pw12'), pc: 12, at: serverTimestamp() }));
await no('a new recovery check must move its counter on too', updateDoc(doc(db, 'keys/owner'), { wrap: B2, px: tok('pw12'), pl: LH('pw13'), pc: 13, rl: LH('rcX'), rc: 2, at: serverTimestamp() }));

console.log('\n# A key change for a folder the whole office shares fits within the rules\' limits');
await env.withSecurityRulesDisabled(async c => {
  const d0 = c.firestore();
  for (let i = 0; i < 40; i++) {
    await setDoc(doc(d0, 'users/staff' + i), { name: 'S' + i, username: 'staff' + i, role: 'staff', active: true, pub: JWK, n: 1, at: past, by: 'owner' });
    await setDoc(doc(d0, 'grants/staff' + i + '_bigfolder1'), { uid: 'staff' + i, fid: 'bigfolder1', role: 'view', keys: { 1: SEALED }, by: 'owner', at: past });
  }
  await setDoc(doc(d0, 'folders/bigfolder1'), { name: B, kv: 1, ks: { 1: 'sig1' }, color: 'mint', order: 9, at: past, by: 'owner' });
  await setDoc(doc(d0, 'grants/owner_bigfolder1'), { uid: 'owner', fid: 'bigfolder1', role: 'edit', keys: { 1: SEALED }, by: 'owner', at: past });
});
{
  const b = writeBatch(db);
  b.update(doc(db, 'folders/bigfolder1'), { kv: 2, 'ks.2': 'sig2', rot: { from: 1, to: 2, why: '' }, at: serverTimestamp(), by: 'owner' });
  b.update(doc(db, 'grants/owner_bigfolder1'), { 'keys.2': SEALED, by: 'owner', at: serverTimestamp() });
  for (let i = 0; i < 40; i++) b.set(doc(db, 'grants/staff' + i + '_bigfolder1'), { uid: 'staff' + i, fid: 'bigfolder1', role: 'view', keys: { 1: SEALED, 2: SEALED }, gs: 'c2ln', by: 'owner', at: serverTimestamp() });
  await ok('new key for 40 people in one write', b.commit());
}

console.log('\n# First-time setup');
async function setupBatch(db, uid, email, noKey, noLocks) {
  const b = writeBatch(db);
  b.set(doc(db, 'meta/setup'), noKey ? { owner: uid, at: serverTimestamp() } : { owner: uid, at: serverTimestamp(), spk: JWK });
  b.set(doc(db, 'users/' + uid), { name: 'Dr. A', role: 'owner', active: true, pub: JWK, n: 0, at: serverTimestamp(), by: uid });
  b.set(doc(db, 'keys/' + uid), Object.assign({ wrap: B, rec: { salt: 'c2FsdA==', iter: 100000, iv: B.iv, ct: B.ct }, temp: false, at: serverTimestamp() }, noLocks ? {} : OWNER_LOCKS));
  b.set(doc(db, 'meta/settings'), { lockMax: 10, at: serverTimestamp() });
  b.set(doc(db, 'folders/firstfold1'), { name: B, kv: 1, ks: { 1: 'sig' }, color: 'navy', order: 0, at: serverTimestamp(), by: uid });
  b.set(doc(db, 'grants/' + uid + '_firstfold1'), { uid, fid: 'firstfold1', role: 'edit', keys: { 1: SEALED }, by: uid, at: serverTimestamp() });
  return b.commit();
}
await env.clearFirestore();
await no('someone else (verified email) cannot set up the vault', setupBatch(env.authenticatedContext('eve', { email: 'eve@evil.test', email_verified: true }).firestore(), 'eve', 'eve@evil.test'));
await no('Dr. A\'s email, not yet verified, cannot', setupBatch(env.authenticatedContext('o1', { email: OWNER_EMAIL, email_verified: false }).firestore(), 'o1', OWNER_EMAIL));
await no('setup without a signing key is refused', setupBatch(env.authenticatedContext('o1b', { email: OWNER_EMAIL, email_verified: true }).firestore(), 'o1b', OWNER_EMAIL, true));
await no('setup without the key-copy token checks is refused', setupBatch(env.authenticatedContext('o1c', { email: OWNER_EMAIL, email_verified: true }).firestore(), 'o1c', OWNER_EMAIL, false, true));
await ok('Dr. A\'s verified email can', setupBatch(env.authenticatedContext('o2', { email: OWNER_EMAIL, email_verified: true }).firestore(), 'o2', OWNER_EMAIL));
await no('nobody can set it up a second time', setupBatch(env.authenticatedContext('o3', { email: OWNER_EMAIL, email_verified: true }).firestore(), 'o3', OWNER_EMAIL));
await no('the signing key can never be swapped', updateDoc(doc(env.authenticatedContext('o2', { email: OWNER_EMAIL, email_verified: true }).firestore(), 'meta/setup'), { spk: Object.assign({}, JWK, { x: 'q'.repeat(43) }) }));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
