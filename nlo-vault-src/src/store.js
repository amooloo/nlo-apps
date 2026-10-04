/* =====================================================================
   NLO Vault — Firebase layer. Everything readable is sealed in the browser before it is written;
   Firestore holds ciphertext plus plain bookkeeping (folder ids, key versions, revision numbers, who/when).
   ===================================================================== */
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, reload, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail,
  confirmPasswordReset, verifyPasswordResetCode, applyActionCode, signOut
} from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, memoryLocalCache, doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, collection, query,
  where, orderBy, limit as qlimit, writeBatch, serverTimestamp, onSnapshot, deleteField, addDoc, updateDoc, deleteDoc
} from 'firebase/firestore';
import * as C from './crypto.js';

/* ---------- build-time settings ---------- */
/* filled in by build.mjs (esbuild "define"); the production build has no emulator code at all */
export const FB_CONFIG = __VAULT_FB__;   // eslint-disable-line no-undef
export const EMU = __VAULT_EMU__;        // eslint-disable-line no-undef
const STAFF_DOMAIN = 'vault.thenextlevelorthodontics.com';
export const COLORS = ['navy', 'blue', 'sky', 'mint', 'coral', 'gold', 'gray'];
export const LOCK_CHOICES = [1, 2, 3, 5, 10, 15, 20, 30];
const DEFAULT_FOLDERS = [
  { name: 'Dr. A only', color: 'navy', def: null, priv: true },
  { name: 'Everyone', color: 'mint', def: 'view' },
  { name: 'Front office', color: 'blue', def: null },
  { name: 'Clinical & lab', color: 'coral', def: null }
];

function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
export const ms = t => (t && t.toMillis ? t.toMillis() : typeof t === 'number' ? t : 0);
export function slugUser(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 24); }
async function loginDocId(username) { return C.sha256hex('nlo-vault-login:' + slugUser(username)); }
const staffEmail = (username, n) => slugUser(username) + '.' + n + '@' + STAFF_DOMAIN;

/* ---------- state (memory only; a lock reloads the page so nothing lingers) ---------- */
export const V = {
  ready: false, app: null, auth: null, db: null,
  uid: null, me: null, login: '', priv: null, pub: null, owner: false,
  settings: { lockMax: 10 }, prefs: { favs: [], lock: 0, bk: 0 },
  folders: new Map(),   // fid -> { id, name, color, def, order, kv, rot, keys: Map(kv -> CryptoKey), raw: Map(kv -> bytes, owner only), role }
  rawFolders: new Map(),
  items: new Map(),     // iid -> { id, f, kv, rev, at, by, del, cAt, d (plaintext) | err }
  rawItems: new Map(),  // iid -> Firestore data (ciphertext), for writes
  users: new Map(), grants: new Map(),
  trust: { people: new Map(), grants: new Map() },   // Dr. A: whose signatures check out (for warnings on People & access)
  unsubs: [], folderUnsubs: new Map(), listeners: new Set(), loaded: false, failures: 0,
  _boot: null
};
export function onChange(fn) { V.listeners.add(fn); return () => V.listeners.delete(fn); }
let emitQueued = false;
function emit() {
  if (emitQueued) return; emitQueued = true;
  (globalThis.queueMicrotask || setTimeout)(() => { emitQueued = false; V.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); });
}

export function init() {
  if (V.ready) return true;
  if (!__VAULT_EMU__ && (!FB_CONFIG || !FB_CONFIG.apiKey)) return false; // eslint-disable-line no-undef
  const cfg = __VAULT_EMU__ ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-nlo-vault', appId: 'demo' } : FB_CONFIG;
  V.cfg = cfg;
  V.app = initializeApp(cfg);
  // in memory only: closing or reloading the tab signs you out, so nothing about the session stays on the computer
  V.auth = initializeAuth(V.app, { persistence: inMemoryPersistence });
  V.db = initializeFirestore(V.app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  if (__VAULT_EMU__) { // eslint-disable-line no-undef
    connectAuthEmulator(V.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(V.db, '127.0.0.1', 8080);
  }
  V.ready = true;
  return true;
}
const D = p => doc(V.db, p);
const ts = () => serverTimestamp();

/* ---------- signing in ---------- */
export function loginKind(login) { return String(login || '').includes('@') ? 'email' : 'user'; }
async function emailFor(login) {
  if (loginKind(login) === 'email') return C.loginId(login);
  const u = slugUser(login); if (!u) throw err('bad-login');
  const s = await getDoc(D('logins/' + await loginDocId(u)));
  if (!s.exists()) throw err('bad-login');
  return staffEmail(u, s.data().n);
}
function idFor(login) { return loginKind(login) === 'email' ? C.loginId(login) : slugUser(login); }

/* returns { state: 'ok' | 'first' (temporary password) | 'recover' (owner: key needs the recovery code) | 'broken' } */
export async function signIn(login, password) {
  const email = await emailFor(login).catch(e => { throw e.code === 'bad-login' ? err('bad-login') : e; });
  const m = await C.deriveMaster(password, idFor(login));
  let cred;
  try { cred = await signInWithEmailAndPassword(V.auth, email, m.authPw); }
  catch (e) { throw /invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(e.code || '') ? err('bad-login') : e; }
  return afterAuth(cred.user, login, m);
}
async function afterAuth(user, login, m) {
  V.uid = user.uid; V.login = idFor(login);
  const us = await getDoc(D('users/' + V.uid)).catch(e => { if (e.code === 'permission-denied') return null; throw e; });
  if (!us || !us.exists()) {
    // Dr. A part-way through first-time setup (account made, vault not created yet); the rules only let his address finish it
    if (loginKind(login) === 'email') { V._boot = { m, email: C.loginId(login) }; return { state: user.emailVerified ? 'setup' : 'verify' }; }
    await lockOut(); throw err('not-member');
  }
  const u = us.data();
  if (!u.active) { await lockOut(); throw err('inactive'); }
  V.me = Object.assign({ uid: V.uid }, u); V.owner = u.role === 'owner';
  const ks = await getDoc(D('keys/' + V.uid));
  if (!ks.exists()) { return { state: V.owner ? 'recover' : 'broken' }; }
  const k = ks.data();
  let raw = null, from = '';
  for (const [name, box] of [['wrap', k.wrap], ['next', k.next]]) {
    if (!box || raw) continue;
    try { raw = await C.open(m.wrapKey, box, C.AAD.priv(V.uid)); from = name; } catch (e) { }
  }
  V._m = m;
  if (!raw) return { state: V.owner ? 'recover' : 'broken' };
  let pk; try { pk = C.unpackKeys(raw); } catch (e) { return { state: V.owner ? 'recover' : 'broken' }; }
  V.priv = await C.importPriv(pk.e);
  V.spriv = pk.s ? await C.importSignPriv(pk.s) : null;
  pk.e.fill(0); if (pk.s) pk.s.fill(0);
  V.pub = u.pub;
  const st = await getDoc(D('meta/setup'));
  V.spk = st.exists() ? st.data().spk : null;   // Dr. A's signing key, fixed at setup: folder keys must carry his signature
  if (k.temp) { V._privRaw = raw; return { state: 'first' }; }
  raw.fill(0);
  // a password change that didn't finish: if the NEW password got us in, make it the key's lock; if the OLD one did,
  // the change never reached sign-in, so the half-made copy is dropped (promoting it would lock this person out)
  if (k.next) (from === 'next' ? promoteNext(k, m) : dropNext(k, m)).catch(e => console.warn('key copy not tidied', e && e.code));
  await start();
  return { state: 'ok' };
}
async function lockOut() { try { await signOut(V.auth); } catch (e) { } V.uid = null; }
export async function lock() { stop(); await lockOut(); }

/* staff: first sign-in with the temporary password -> choose their own */
export async function setOwnPassword(newPw) {
  if (!V._privRaw) throw err('no-session');
  const m2 = await C.deriveMaster(newPw, V.login);
  const box = await C.seal(m2.wrapKey, V._privRaw, C.AAD.priv(V.uid));
  // the new copy goes in 'next' first; whichever password sign-in ends up accepting, the next sign-in keeps the matching copy
  await updateDoc(D('keys/' + V.uid), { next: box });
  await changeAuthPw(V._m.authPw, m2.authPw);
  await updateDoc(D('keys/' + V.uid), { wrap: box, next: deleteField(), temp: false, at: ts() });
  V._privRaw.fill(0); V._privRaw = null; V._m = m2;
  await start();
}
async function changeAuthPw(oldAuth, newAuth) {
  const u = V.auth.currentUser;
  try { await updatePassword(u, newAuth); }
  catch (e) {
    if (!/requires-recent-login/.test(e.code || '')) throw e;
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldAuth));
    await updatePassword(u, newAuth);
  }
}
/* anyone: change their own password (needs the current one) */
export async function changePassword(curPw, newPw) {
  if (curPw === newPw) throw err('same-password');
  const cur = await C.deriveMaster(curPw, V.login);
  const u = V.auth.currentUser;
  try { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur.authPw)); }
  catch (e) { throw /invalid-credential|wrong-password|invalid-login/.test(e.code || '') ? err('bad-current') : e; }
  let k = await keysNow();
  const { raw, from } = await openOwn(k, cur.wrapKey);
  if (!raw) throw err('bad-current');
  // an earlier change already moved sign-in to this password: make its copy the main one before starting a new change
  if (from === 'next') { await promoteNext(k, cur); k = await keysNow(); }
  const nxt = await C.deriveMaster(newPw, V.login);
  const box = await C.seal(nxt.wrapKey, raw, C.AAD.priv(V.uid));
  raw.fill(0);
  // the new copy goes in 'next' first (Dr. A: with the token for the new password ready, his current one shown)
  await updateDoc(D('keys/' + V.uid), V.owner
    ? { next: box, npl: await LH(nxt.lockKey, 'next/' + (k.pc + 1)), nc: k.pc + 1, px: await T(cur.lockKey, k.pc), pl: await LH(cur.lockKey, k.pc + 1), pc: k.pc + 1, at: ts() }
    : { next: box });
  await updatePassword(u, nxt.authPw);   // if this fails, 'next' stays: the next sign-in keeps whichever copy matches
  await promoteNext(await keysNow(), nxt);
  V._m = nxt;
  log('pw-change');
}
/* ---------- a person's own key copy ---------- */
async function keysNow() { const s = await getDocFromServer(D('keys/' + V.uid)); if (!s.exists()) throw err('no-keys'); return s.data(); }
async function openOwn(k, wrapKey) {
  for (const [name, box] of [['wrap', k.wrap], ['next', k.next]]) {
    if (!box) continue;
    try { return { raw: await C.open(wrapKey, box, C.AAD.priv(V.uid)), from: name }; } catch (e) { }
  }
  return { raw: null, from: '' };
}
/* Dr. A's copy changes only with the current one-time token (crypto.js): pl/pc for his password, npl while a new
   password is waiting in 'next', rl/rc for his recovery code. The rules check them; nobody else can produce them. */
const T = (lk, label) => C.lockToken(lk, String(label));
const LH = async (lk, label) => C.lockHash(await T(lk, label));
/* make the 'next' copy (locked with the password sign-in now uses) the main one */
async function promoteNext(k, m) {
  const upd = { wrap: k.next, next: deleteField(), at: ts() };
  // (the parked token is labelled with the counter noted when it was parked, so other changes meanwhile don't matter)
  if (V.owner) Object.assign(upd, { npl: deleteField(), nc: deleteField(), px: await T(m.lockKey, 'next/' + (k.nc || k.pc)), pl: await LH(m.lockKey, k.pc + 1), pc: k.pc + 1 });
  await updateDoc(D('keys/' + V.uid), upd);
}
/* drop a 'next' copy that never took over (sign-in still uses the old password) */
async function dropNext(k, m) {
  const upd = { next: deleteField(), at: ts() };
  if (V.owner) Object.assign(upd, { npl: deleteField(), nc: deleteField(), px: await T(m.lockKey, k.pc), pl: await LH(m.lockKey, k.pc + 1), pc: k.pc + 1 });
  await updateDoc(D('keys/' + V.uid), upd);
}

/* ---------- Dr. A: first-time setup ---------- */
export async function setupAccount(email, password) {
  email = C.loginId(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('bad-email');
  const m = await C.deriveMaster(password, email);
  let cred;
  try { cred = await createUserWithEmailAndPassword(V.auth, email, m.authPw); }
  catch (e) {
    if (!/email-already-in-use/.test(e.code || '')) throw e;
    try { cred = await signInWithEmailAndPassword(V.auth, email, m.authPw); }
    catch (e2) { throw err('exists-other-password'); }
  }
  V.uid = cred.user.uid; V.login = email; V._boot = { m, email };
  // already set up? then this is just a sign-in
  const us = await getDoc(D('users/' + V.uid)).catch(() => null);
  if (us && us.exists()) return afterAuth(cred.user, email, m);
  if (!cred.user.emailVerified) { await sendEmailVerification(cred.user); return { state: 'verify' }; }
  return { state: 'setup' };
}
export async function resendVerification() { if (V.auth.currentUser) await sendEmailVerification(V.auth.currentUser); }
export async function emailVerifiedNow() {
  const u = V.auth.currentUser; if (!u) return false;
  await reload(u); if (!u.emailVerified) return false;
  await u.getIdToken(true);
  return true;
}
export async function setupVault(name) {
  const b = V._boot; if (!b) throw err('no-session');
  const uid = V.uid;
  const pair = await C.newPair(), pub = await C.pubJwk(pair), sp = await C.newSignPair(), spk = await C.pubJwk(sp);
  const raw = C.packKeys(await C.privBytes(pair), await C.privBytes(sp));
  const spriv = await C.importSignPriv(await C.privBytes(sp));
  const code = C.recoveryCode();
  const wrap = await C.seal(b.m.wrapKey, raw, C.AAD.priv(uid));
  const rec = await C.secretSeal(C.normCode(code), raw, C.AAD.rec(uid), C.REC_ITER);
  const clk = await C.codeLockKey(code, uid);
  const batch = writeBatch(V.db);
  batch.set(D('meta/setup'), { owner: uid, at: ts(), spk });
  // (only the practice owner's verified email is allowed to commit this; anyone else gets "permission denied")
  batch.set(D('users/' + uid), { name: String(name || 'Dr. A').trim().slice(0, 60) || 'Dr. A', role: 'owner', active: true, pub, n: 0, at: ts(), by: uid,
    ps: await C.signText(spriv, C.SIG.person(uid, pub)) });
  batch.set(D('keys/' + uid), { wrap, rec, temp: false, at: ts(), pl: await LH(b.m.lockKey, 0), pc: 0, rl: await LH(clk, 0), rc: 0 });
  batch.set(D('meta/settings'), { lockMax: 10, at: ts() });
  let order = 0;
  for (const f of DEFAULT_FOLDERS) {
    const fid = C.newId(12), key = C.rnd(32), k = await C.aesKey(key);
    const fdoc = { name: await C.sealJSON(k, folderMeta(f.name, f.def, f.priv), C.AAD.folder(fid, 1)), kv: 1, ks: { 1: await C.signFolderKey(spriv, fid, 1, key) }, color: f.color, order: order++, at: ts(), by: uid };
    batch.set(D('folders/' + fid), fdoc);
    batch.set(D('grants/' + uid + '_' + fid), { uid, fid, role: 'edit', keys: { 1: await C.sealTo(pub, key, C.AAD.grant(uid, fid, 1)) },
      gs: await C.signText(spriv, C.SIG.member(uid, fid, 'edit', 1)), by: uid, at: ts() });
  }
  try { await batch.commit(); }
  catch (e) { if (e.code === 'permission-denied') throw err('not-owner-email'); throw e; }
  raw.fill(0);
  V._boot = null;
  const res = await afterAuth(V.auth.currentUser, b.email, b.m);
  log('setup');
  return { code, state: res.state };
}

/* ---------- Dr. A: forgot password -> recovery code ---------- */
export async function sendReset(email) {
  email = C.loginId(email);
  if (!email.includes('@')) throw err('bad-email');
  const url = location.origin + location.pathname;
  await sendPasswordResetEmail(V.auth, email, { url, handleCodeInApp: false });
}
/* the reset link opened the vault itself (?mode=resetPassword&oobCode=…): Google never sees the new password */
export async function resetWithLink(oob, newPw, code) {
  const email = C.loginId(await verifyPasswordResetCode(V.auth, oob));
  const m = await C.deriveMaster(newPw, email);
  await confirmPasswordReset(V.auth, oob, m.authPw);
  const cred = await signInWithEmailAndPassword(V.auth, email, m.authPw);
  V.uid = cred.user.uid; V.login = email;
  await useRecovery(code, m);
  return afterAuth(cred.user, email, m);
}
/* the password was reset on Google's own page (so Google saw it): it is used once to sign in, never as the vault password.
   The recovery code re-locks the key under a brand-new vault password, and sign-in switches to that one. */
export async function resetWithGooglePage(email, googlePw, code, newPw) {
  email = C.loginId(email);
  let cred;
  try { cred = await signInWithEmailAndPassword(V.auth, email, googlePw); }
  catch (e) { throw /invalid-credential|wrong-password|user-not-found|invalid-login/.test(e.code || '') ? err('bad-login') : e; }
  V.uid = cred.user.uid; V.login = email;
  const m = await C.deriveMaster(newPw, email);
  await useRecovery(code, m);
  await updatePassword(cred.user, m.authPw);
  return afterAuth(cred.user, email, m);
}
/* signed in (password already changed), but the key is still locked with the old one */
export async function recoverSignedIn(code) {
  if (!V._m) throw err('no-session');
  await useRecovery(code, V._m);
  return afterAuth(V.auth.currentUser, V.login, V._m);
}
async function useRecovery(code, m) {
  const k = await keysNow().catch(() => null);
  if (!k || !k.rec) throw err('no-recovery');
  let raw;
  try { raw = await C.secretOpen(C.normCode(code), k.rec, C.AAD.rec(V.uid)); } catch (e) { throw err('bad-code'); }
  const wrap = await C.seal(m.wrapKey, raw, C.AAD.priv(V.uid));
  raw.fill(0);
  const clk = await C.codeLockKey(code, V.uid);
  await updateDoc(D('keys/' + V.uid), { wrap, next: deleteField(), npl: deleteField(), nc: deleteField(), at: ts(),
    px: await T(clk, k.rc), rl: await LH(clk, k.rc + 1), rc: k.rc + 1, pl: await LH(m.lockKey, k.pc + 1), pc: k.pc + 1 });
  log('recovered');
}
export async function verifyEmailLink(oob) { await applyActionCode(V.auth, oob); }
export async function newRecoveryCode(curPw) {
  const cur = await C.deriveMaster(curPw, V.login);
  const u = V.auth.currentUser;
  try { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur.authPw)); }
  catch (e) { throw err('bad-current'); }
  let k = await keysNow();
  const { raw, from } = await openOwn(k, cur.wrapKey);
  if (!raw) throw err('bad-current');
  if (from === 'next') { await promoteNext(k, cur); k = await keysNow(); }
  const code = C.recoveryCode();
  const rec = await C.secretSeal(C.normCode(code), raw, C.AAD.rec(V.uid), C.REC_ITER);
  raw.fill(0);
  const nlk = await C.codeLockKey(code, V.uid);
  await updateDoc(D('keys/' + V.uid), { rec, rl: await LH(nlk, k.rc + 1), rc: k.rc + 1,
    px: await T(cur.lockKey, k.pc), pl: await LH(cur.lockKey, k.pc + 1), pc: k.pc + 1, at: ts() });
  log('rec-code');
  return code;
}

/* ---------- live data ---------- */
function track(unsub) { V.unsubs.push(unsub); return unsub; }
function failed(e) { V.failures++; console.error(e); emit(); }
/* the first answer from each live source; the vault shows "Opening…" until all have answered */
let waiting = 0;
function firstOnce() {
  let done = false; waiting++; V.loaded = false;
  return () => { if (done) return; done = true; waiting--; if (waiting <= 0) { waiting = 0; V.loaded = true; } emit(); };
}
/* core = a source every member can always read; if it is refused, this person's access was switched off */
function live(ref, onData, opts) {
  opts = opts || {};
  const f1 = firstOnce();
  return onSnapshot(ref, async s => { try { await onData(s); } catch (e) { console.error(e); } f1(); emit(); }, e => {
    f1();
    if (e && e.code === 'permission-denied') {
      if (opts.core) { V.revoked = true; emit(); return; }
      if (opts.onDenied) { opts.onDenied(); emit(); return; }
    }
    failed(e);
  });
}
async function start() {
  stop(); waiting = 0; V.loaded = false;
  const core = { core: true };
  track(live(D('meta/settings'), s => { if (s.exists()) V.settings = Object.assign({ lockMax: 10 }, s.data()); }, core));
  track(live(collection(V.db, 'users'), s => {
    s.docChanges().forEach(ch => { if (ch.type === 'removed') V.users.delete(ch.doc.id); else V.users.set(ch.doc.id, Object.assign({ uid: ch.doc.id }, ch.doc.data())); });
    const me = V.users.get(V.uid);
    if (me) V.me = Object.assign({}, me);
    recheckTrust();
  }, core));
  track(live(D('prefs/' + V.uid), s => { V.prefs = Object.assign({ favs: [], lock: 0, bk: 0 }, s.exists() ? s.data() : {}); }, core));
  const gq = V.owner ? collection(V.db, 'grants') : query(collection(V.db, 'grants'), where('uid', '==', V.uid));
  track(live(gq, async s => { for (const ch of s.docChanges()) await grantChanged(ch); }, core));
  if (V.owner) {
    track(live(collection(V.db, 'folders'), async s => { for (const ch of s.docChanges()) await folderChanged(ch.doc.id, ch.type === 'removed' ? null : ch.doc); }, core));
    track(live(collection(V.db, 'items'), s => itemsChanged(s), core));
  }
  // so Dr. A can see who has started using the vault
  updateDoc(D('users/' + V.uid), { seen: ts() }).catch(() => { });
}
export function stop() {
  V.unsubs.forEach(u => { try { u(); } catch (e) { } }); V.unsubs = [];
  V.folderUnsubs.forEach(arr => arr.forEach(u => { try { u(); } catch (e) { } })); V.folderUnsubs.clear();
}
async function grantChanged(ch) {
  const g = Object.assign({ id: ch.doc.id }, ch.doc.data());
  if (ch.type === 'removed') {
    V.grants.delete(g.id);
    if (g.uid === V.uid) dropFolder(g.fid);
    recheckTrust(); emit(); return;
  }
  V.grants.set(g.id, g);
  recheckTrust();
  if (g.uid !== V.uid) return;
  // my own grant: open the folder keys it carries
  let f = V.folders.get(g.fid);
  if (!f) { f = { id: g.fid, name: '…', color: 'gray', kv: 0, keys: new Map(), raw: new Map(), role: g.role }; V.folders.set(g.fid, f); }
  f.role = V.owner ? 'edit' : g.role;
  for (const [kv, box] of Object.entries(g.keys || {})) {
    const n = Number(kv); if (f.keys.has(n) || (f.unverified && f.unverified.has(n))) continue;
    try {
      const raw = await C.openFrom(V.priv, box, C.AAD.grant(V.uid, g.fid, n));
      (f.unverified = f.unverified || new Map()).set(n, raw);
    } catch (e) { console.warn('grant did not open', g.fid, kv); }
  }
  await verifyKeys(g.fid);
  if (!V.owner && !V.folderUnsubs.has(g.fid)) {
    // taken out of the folder: its listeners are refused before the grant's removal arrives; just drop it
    const gone = { onDenied: () => dropFolder(g.fid) };
    V.folderUnsubs.set(g.fid, [
      live(D('folders/' + g.fid), s => folderChanged(g.fid, s.exists() ? s : null), gone),
      live(query(collection(V.db, 'items'), where('f', '==', g.fid)), s => itemsChanged(s), gone)
    ]);
  }
  // re-open anything that was waiting for these keys
  await refreshFolder(g.fid);
  emit();
}
function dropFolder(fid) {
  const u = V.folderUnsubs.get(fid); if (u) { u.forEach(x => { try { x(); } catch (e) { } }); V.folderUnsubs.delete(fid); }
  if (!V.owner) {
    V.folders.delete(fid); V.rawFolders.delete(fid);
    for (const [id, it] of V.items) if (it.f === fid) { V.items.delete(id); V.rawItems.delete(id); }
  }
}
async function folderChanged(fid, snap) {
  if (!snap) { V.rawFolders.delete(fid); if (V.owner) V.folders.delete(fid); emit(); return; }
  V.rawFolders.set(fid, snap.data());
  await refreshFolder(fid);
  emit();
}
/* a folder key is used only once Dr. A's signature on it checks out (signature missing yet = wait; wrong = never) */
async function verifyKeys(fid) {
  const f = V.folders.get(fid), d = V.rawFolders.get(fid);
  if (!f || !f.unverified || !f.unverified.size || !d) return;
  for (const [n, raw] of Array.from(f.unverified.entries())) {
    const sig = d.ks && d.ks[n];
    if (!sig) continue;
    f.unverified.delete(n);
    if (await C.verifyFolderKey(V.spk, sig, fid, n, raw)) {
      f.keys.set(n, await C.aesKey(raw));
      if (V.owner) f.raw.set(n, raw); else raw.fill(0);
      if (f.bad) f.bad.delete(n);
    } else { (f.bad = f.bad || new Set()).add(n); raw.fill(0); console.warn('folder key signature does not match', fid, n); }
  }
}
async function refreshFolder(fid) {
  const d = V.rawFolders.get(fid);
  let f = V.folders.get(fid);
  if (!f) { f = { id: fid, name: '…', color: 'gray', kv: 0, keys: new Map(), raw: new Map(), role: V.owner ? 'edit' : null }; V.folders.set(fid, f); }
  await verifyKeys(fid);
  if (d) {
    // a new key version: its key normally arrives with it; give it a moment before calling it missing
    if (f.kv !== d.kv) { f.kvAt = Date.now(); setTimeout(emit, KEY_GRACE + 200); }
    Object.assign(f, { color: d.color || 'gray', order: d.order || 0, kv: d.kv, rot: d.rot || null, gone: !!d.gone, at: ms(d.at) });
    const k = f.keys.get(d.kv);
    if (k) {
      try {
        // the name and "new people get this" live inside the sealed box, so nobody without the key can change them
        const nm = await C.openJSON(k, d.name, C.AAD.folder(fid, d.kv));
        f.name = str(nm.n).slice(0, 60) || 'Folder'; f.def = nm.def === 'view' || nm.def === 'edit' ? nm.def : null; f.priv = nm.priv === true; f.named = true; f.err = false;
      } catch (e) { f.err = true; }
    }
  }
  for (const [id, raw] of V.rawItems) if (raw.f === fid) await openItem(id, raw);
  recheckTrust();
}
async function itemsChanged(snap) {
  const work = [];
  snap.docChanges().forEach(ch => {
    if (ch.type === 'removed') { V.rawItems.delete(ch.doc.id); V.items.delete(ch.doc.id); return; }
    const raw = Object.assign({}, ch.doc.data(), { _pending: ch.doc.metadata.hasPendingWrites });
    V.rawItems.set(ch.doc.id, raw);
    work.push(openItem(ch.doc.id, raw));
  });
  await Promise.all(work);
}
async function openItem(id, raw) {
  const f = V.folders.get(raw.f);
  const base = { id, f: raw.f, kv: raw.kv, rev: raw.rev, at: ms(raw.at) || Date.now(), cAt: ms(raw.cAt), by: raw.by, del: !!raw.del };
  const key = f && f.keys.get(raw.kv);
  if (!key) { if (!V.items.has(id) || V.items.get(id).rev !== raw.rev) V.items.set(id, Object.assign(base, { d: null, err: 'locked' })); return; }
  const cur = V.items.get(id);
  if (cur && cur.d && cur.rev === raw.rev && cur.kv === raw.kv && cur.f === raw.f && cur._ct === raw.ct) { Object.assign(cur, base); return; }
  try {
    const d = normItem(await C.openJSON(key, { iv: raw.iv, ct: raw.ct }, C.AAD.item(id, raw.f, raw.kv)));
    V.items.set(id, Object.assign(base, { d, _ct: raw.ct }));
  } catch (e) { V.items.set(id, Object.assign(base, { d: null, err: 'unreadable' })); }
}

/* every decrypted login is reshaped to the fields the screens expect, with the right types — someone with edit rights could
   otherwise save a well-formed but odd item (say, a list where text belongs) that breaks the screen for everyone else */
const str = v => typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
const num = v => typeof v === 'number' && isFinite(v) ? v : 0;
export function normItem(d) {
  d = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  const out = {
    t: str(d.t).slice(0, 300), ds: str(d.ds).replace(/\s+/g, ' ').trim().slice(0, 140), lg: okLogo(d.lg) ? d.lg : '',
    u: str(d.u), p: str(d.p), url: str(d.url), n: str(d.n), totp: str(d.totp),
    fx: Array.isArray(d.fx) ? d.fx.filter(x => x && typeof x === 'object').slice(0, 50).map(x => ({ l: str(x.l).slice(0, 40), v: str(x.v), h: !!x.h })) : [],
    ph: Array.isArray(d.ph) ? d.ph.filter(x => x && typeof x === 'object').slice(0, 10).map(x => ({ p: str(x.p), at: num(x.at) })) : [],
    pwAt: num(d.pwAt), cAt: num(d.cAt), mAt: num(d.mAt), cBy: str(d.cBy), mBy: str(d.mBy)
  };
  if (d.chg && typeof d.chg === 'object') out.chg = { why: str(d.chg.why).slice(0, 120), at: num(d.chg.at) };
  // marked "not working" (with what's wrong / what to do), the vendor's rep, and Mari's List membership
  if (d.bad && typeof d.bad === 'object') out.bad = { why: str(d.bad.why).slice(0, 300), at: num(d.bad.at), by: str(d.bad.by).slice(0, 128) };
  const r = d.rep && typeof d.rep === 'object' && !Array.isArray(d.rep) ? d.rep : {};
  out.rep = { n: str(r.n).slice(0, 80), ph: str(r.ph).slice(0, 40), em: str(r.em).slice(0, 120) };
  out.ml = d.ml === true;
  return out;
}

/* a company logo is a small picture made in the browser and sealed inside the login (never a link to anywhere) */
const LOGO_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export function okLogo(s) { return typeof s === 'string' && s.length <= 60000 && LOGO_RE.test(s); }

/* ---------- helpers for the UI ---------- */
export function folderList() {
  // a deleted folder is only hidden, and only an empty one can be deleted: one that still holds logins stays in the list
  const full = new Set(); for (const it of V.items.values()) full.add(it.f);
  return Array.from(V.folders.values()).filter(f => V.rawFolders.has(f.id) && (!f.gone || full.has(f.id))).sort((a, b) => (a.order - b.order) || String(a.name).localeCompare(b.name));
}
export function canEdit(fid) { const f = V.folders.get(fid); return !!f && (V.owner || f.role === 'edit'); }
/* '' when the folder's current key is fine; 'unsigned' when it doesn't carry Dr. A's signature; 'missing' when this person
   wasn't given it. Either way nothing can be saved in the folder — only someone else using Dr. A's sign-in could cause it. */
const KEY_GRACE = 4000;
export function keyTrouble(fid) {
  const f = V.folders.get(fid);
  if (!f || !f.kv || !V.rawFolders.has(fid)) return '';
  if (f.bad && f.bad.has(f.kv)) return 'unsigned';
  if (!f.keys.has(f.kv) && Date.now() - (f.kvAt || 0) > KEY_GRACE) return 'missing';
  return '';
}
/* a login locked with a key no signature vouches for */
export function untrusted(it) {
  const f = it && V.folders.get(it.f);
  return !!f && !it.d && it.err === 'locked' && ((f.bad && f.bad.has(it.kv)) || (it.kv === f.kv && !!keyTrouble(it.f)));
}
export function userName(uid) { const u = V.users.get(uid); return u ? u.name : uid === V.uid && V.me ? V.me.name : 'someone'; }
export function lockMinutes() {
  const max = Math.max(1, Math.min(60, V.settings.lockMax || 10));
  const mine = V.prefs.lock || 0;
  return mine && mine < max ? mine : max;
}
export function log(a, o) {
  if (!V.uid || !V.db) return;
  const d = Object.assign({ by: V.uid, at: ts(), a: String(a).slice(0, 16) }, o || {});
  addDoc(collection(V.db, 'log'), d).catch(e => console.warn('activity not saved', e && e.code));
}

/* ---------- items ---------- */
async function freshRaw(id) {
  const raw = V.rawItems.get(id);
  if (raw && !raw._pending) return raw;
  const s = await getDocFromServer(D('items/' + id));
  if (!s.exists()) throw err('gone');
  return s.data();
}
export async function saveItem(id, fid, data, opts) {
  opts = opts || {};
  const f = V.folders.get(fid);
  if (!f || !canEdit(fid)) throw err('no-edit');
  const key = f.keys.get(f.kv); if (!key) throw err('no-key');
  const now = Date.now();
  // a key change re-locks the login without changing it: keep who changed it last and when
  const d = Object.assign({}, data, opts.keepMeta ? {} : { mAt: now, mBy: V.uid });
  if (!id) {
    id = C.newId(20);
    d.cAt = now; d.cBy = V.uid; if (d.p) d.pwAt = now;
    const box = await C.sealJSON(key, d, C.AAD.item(id, fid, f.kv));
    const batch = writeBatch(V.db);
    batch.set(D('items/' + id), { f: fid, kv: f.kv, iv: box.iv, ct: box.ct, rev: 1, at: ts(), cAt: ts(), by: V.uid, del: false });
    await batch.commit();
    if (!opts.quiet) log('create', { i: id, f: fid });
    return id;
  }
  const cur = await freshRaw(id);
  if (opts.rev && cur.rev !== opts.rev) throw err('changed');
  const old = V.items.get(id);
  if (old && old.d) {
    if ((old.d.p || '') !== (d.p || '')) {
      d.pwAt = now; d.chg = null;
      // a new password also clears an earlier "not working" mark (one made in this same edit stays)
      if (d.bad && old.d.bad && d.bad.at === old.d.bad.at) d.bad = null;
      if (old.d.p) d.ph = [{ p: old.d.p, at: old.d.pwAt || old.d.mAt || now }].concat(old.d.ph || []).slice(0, 10);
    }
  }
  if (!d.chg) delete d.chg;
  if (!d.bad) delete d.bad;
  const box = await C.sealJSON(key, d, C.AAD.item(id, fid, f.kv));
  const batch = writeBatch(V.db);
  batch.update(D('items/' + id), { f: fid, kv: f.kv, iv: box.iv, ct: box.ct, rev: cur.rev + 1, at: ts(), by: V.uid, del: opts.del === undefined ? !!cur.del : !!opts.del });
  batch.set(D('versions/' + id + '_' + cur.rev), { i: id, f: cur.f, kv: cur.kv, iv: cur.iv, ct: cur.ct, rev: cur.rev, del: !!cur.del, at: ts(), by: V.uid });
  try { await batch.commit(); }
  catch (e) { if (e.code === 'permission-denied' && V.rawItems.get(id) && V.rawItems.get(id).rev !== cur.rev) throw err('changed'); throw e; }
  if (!opts.quiet) log(opts.act || (fid !== cur.f ? 'move' : 'edit'), { i: id, f: fid });
  return id;
}
/* many new items at once (import, restoring a backup): 100 per write */
export async function addItems(list, progress) {
  let done = 0;
  for (let i = 0; i < list.length; i += 100) {
    const batch = writeBatch(V.db);
    for (const { fid, d } of list.slice(i, i + 100)) {
      const f = V.folders.get(fid); if (!f || !canEdit(fid)) throw err('no-edit');
      const key = f.keys.get(f.kv); if (!key) throw err('no-key');
      const id = C.newId(20), now = Date.now();
      const dd = Object.assign({}, d, { cAt: now, cBy: V.uid, mAt: now, mBy: V.uid });
      if (dd.p && !dd.pwAt) dd.pwAt = now;
      const box = await C.sealJSON(key, dd, C.AAD.item(id, fid, f.kv));
      batch.set(D('items/' + id), { f: fid, kv: f.kv, iv: box.iv, ct: box.ct, rev: 1, at: ts(), cAt: ts(), by: V.uid, del: false });
    }
    await batch.commit();
    done = Math.min(list.length, i + 100);
    try { progress && progress(done, list.length); } catch (e) { }
  }
  return done;
}
export async function setDeleted(id, del) {
  const it = V.items.get(id); if (!it || !it.d) throw err('gone');
  await saveItem(id, it.f, it.d, { del, act: del ? 'delete' : 'restore', quiet: false });
}
export async function purgeItem(id) {
  if (!V.owner) throw err('owner-only');
  const cur = await freshRaw(id);
  const batch = writeBatch(V.db);
  // the last version is kept (encrypted, history can't be deleted), so even this can be undone from Trash
  batch.set(D('versions/' + id + '_' + cur.rev), { i: id, f: cur.f, kv: cur.kv, iv: cur.iv, ct: cur.ct, rev: cur.rev, del: !!cur.del, at: ts(), by: V.uid });
  batch.delete(D('items/' + id));
  await batch.commit();
  log('purge', { i: id, f: cur.f });
}
/* logins deleted for good: their last version is still in history (Dr. A) */
export async function deletedItems() {
  const s = await getDocs(collection(V.db, 'versions'));
  const byItem = new Map();
  s.docs.forEach(x => { const v = x.data(); if (V.rawItems.has(v.i)) return; if (!byItem.has(v.i)) byItem.set(v.i, []); byItem.get(v.i).push(v); });
  const out = [];
  for (const list of byItem.values()) {
    // the newest version a signed key opens (a last copy someone else slipped in can't hide the real one)
    list.sort((a, b) => b.rev - a.rev);
    let pick = list[0], d = null;
    for (const v of list) {
      const f = V.folders.get(v.f), k = f && f.keys.get(v.kv);
      if (!k) continue;
      try { d = normItem(await C.openJSON(k, { iv: v.iv, ct: v.ct }, C.AAD.item(v.i, v.f, v.kv))); pick = v; break; } catch (e) { }
    }
    out.push({ i: pick.i, f: pick.f, at: ms(list[0].at), by: list[0].by, d });
  }
  return out.sort((a, b) => b.at - a.at);
}
export async function undelete(entry) {
  // always back into the folder it was in (never into some other folder more people can open)
  const fid = entry.f, f = V.folders.get(fid);
  if (!f || !canEdit(fid)) throw err('no-folder', 'Its folder isn’t available to you.');
  if (f.gone) await updateDoc(D('folders/' + fid), { gone: false, at: ts(), by: V.uid });
  const id = await saveItem(null, fid, Object.assign({}, entry.d), { quiet: true });
  log('undelete', { i: id, f: fid });
  return { id, fid };
}
export async function savePrefs(p) {
  const d = Object.assign({}, V.prefs, p);
  const batch = writeBatch(V.db);
  batch.set(D('prefs/' + V.uid), { favs: (d.favs || []).slice(0, 500), lock: d.lock || 0, bk: d.bk || 0 });
  await batch.commit();
}

/* ---------- Dr. A: folders and who can open them ---------- */
/* what's sealed inside a folder's name box (nobody without the key can change it): its name, what new people get, and
   whether it is Dr. A's private folder (where new logins and imports go unless he picks another) */
function folderMeta(name, def, priv) {
  const m = { n: String(name || '').trim().slice(0, 60) };
  if (def === 'view' || def === 'edit') m.def = def;
  if (priv) m.priv = true;
  return m;
}
export function privateFolder() { return folderList().find(f => f.priv && canEdit(f.id) && !keyTrouble(f.id) && f.keys.has(f.kv)) || null; }
async function sealGrant(uid, fid, pub, f, versions) {
  const keys = {};
  for (const v of versions) {
    const raw = f.raw.get(v); if (!raw) throw err('no-key');
    keys[v] = await C.sealTo(pub, raw, C.AAD.grant(uid, fid, v));
  }
  return keys;
}
function memberVersions(f) { return f.rot ? [f.rot.from, f.rot.to].filter(v => f.raw.has(v)) : [f.kv]; }
export async function createFolder({ name, color, def }) {
  if (!V.owner) throw err('owner-only');
  if (!V.spriv) throw err('no-sign-key');
  const fid = C.newId(12), raw = C.rnd(32), k = await C.aesKey(raw);
  const order = Math.max(0, ...folderList().map(f => f.order || 0)) + 1;
  const fdoc = { name: await C.sealJSON(k, folderMeta(name, def, false), C.AAD.folder(fid, 1)), kv: 1, ks: { 1: await C.signFolderKey(V.spriv, fid, 1, raw) },
    color: COLORS.includes(color) ? color : 'gray', order, at: ts(), by: V.uid };
  const batch = writeBatch(V.db);
  batch.set(D('folders/' + fid), fdoc);
  batch.set(D('grants/' + V.uid + '_' + fid), { uid: V.uid, fid, role: 'edit', keys: { 1: await C.sealTo(V.pub, raw, C.AAD.grant(V.uid, fid, 1)) }, gs: await memberSig(V.uid, fid, 'edit', 1), by: V.uid, at: ts() });
  await batch.commit();
  log('folder-new', { f: fid });
  return fid;
}
export async function updateFolder(fid, { name, color, def }) {
  const f = V.folders.get(fid), d = V.rawFolders.get(fid);
  const k = f.keys.get(d.kv);
  const upd = { name: await C.sealJSON(k, folderMeta(name, def, f.priv), C.AAD.folder(fid, d.kv)), color: COLORS.includes(color) ? color : 'gray', def: deleteField(), at: ts(), by: V.uid };
  await updateDoc(D('folders/' + fid), upd);
  log('folder-edit', { f: fid });
}
export async function moveFolder(fid, dir) {
  const list = folderList(), i = list.findIndex(f => f.id === fid), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  const batch = writeBatch(V.db);
  batch.update(D('folders/' + a.id), { order: b.order === a.order ? a.order + dir : b.order, at: ts(), by: V.uid });
  batch.update(D('folders/' + b.id), { order: a.order, at: ts(), by: V.uid });
  await batch.commit();
}
export async function deleteFolder(fid) {
  const n = Array.from(V.items.values()).filter(i => i.f === fid).length;
  if (n) throw err('not-empty');
  const batch = writeBatch(V.db);
  // staff lose it; the folder itself is only hidden (its keys stay with Dr. A, so its history stays readable)
  for (const g of V.grants.values()) if (g.fid === fid && g.uid !== V.uid) batch.delete(D('grants/' + g.id));
  batch.update(D('folders/' + fid), { gone: true, at: ts(), by: V.uid });
  await batch.commit();
  log('folder-del', { f: fid });
}
/* role: 'view' | 'edit' | null (no access) */
export async function setAccess(fid, uid, role, opts) {
  opts = opts || {};
  const f = V.folders.get(fid), u = V.users.get(uid), gid = uid + '_' + fid;
  if (!V.owner || !f || !u || uid === V.uid) throw err('bad-access');
  const had = V.grants.get(gid);
  if (role) {
    if (!u.active) throw err('inactive');
    if (!(await personOk(u))) throw err('unknown-person');
    // a change of role keeps the keys already sealed to them (if his signature on their place checks out); new access
    // gets the folder's key(s) sealed to their public key. Either way his signature covers their place and role.
    const kv = refKv(f);
    const keep = had && await memberOk(had, kv);
    // edit -> view happens in the same write that gives the folder a new key version, so his earlier "edit"
    // signature for them is never valid for the current version
    if (keep && had.role === 'edit' && role === 'view') {
      await rotateFolder(fid, '', opts.progress, [], { [uid]: 'view' });
      log('share', { f: fid, u: uid, n: 1 });
      return;
    }
    const keys = keep ? had.keys : await sealGrant(uid, fid, u.pub, f, memberVersions(f));
    const batch = writeBatch(V.db);
    batch.set(D('grants/' + gid), { uid, fid, role, keys, gs: await memberSig(uid, fid, role, kv), by: V.uid, at: ts() });
    await batch.commit();
    log('share', { f: fid, u: uid, n: role === 'edit' ? 2 : 1 });
    return;
  }
  if (!had) return;
  // their place goes in the same write that gives the folder a new key (and optionally flags its passwords to be changed),
  // so there's never a moment when their signed place is gone but the key it was signed for is still current
  await rotateFolder(fid, opts.flag ? (u.name + ' lost access') : '', opts.progress, [uid]);
  log('unshare', { f: fid, u: uid });
}

/* ---------- Dr. A's signature on who may hold which folder key ----------
   Someone signed in as him (say through his email) could add a "person" of their own or a place in a folder. His
   browser seals a key only to people whose public key he signed when he added them, in places he signed for the
   folder's current key version — so it never hands a real key to anyone he didn't choose. */
const memberSig = (uid, fid, role, kv) => C.signText(V.spriv, C.SIG.member(uid, fid, role, kv));
async function personOk(u) { return !!u && !!V.spk && await C.verifyText(V.spk, u.ps, C.SIG.person(u.uid, u.pub)); }
async function memberOk(g, kv) { return !!g && !!kv && !!V.spk && await C.verifyText(V.spk, g.gs, C.SIG.member(g.uid, g.fid, g.role, kv)); }
/* the newest key version of a folder that Dr. A signed (what its members' places are signed for) */
function refKv(f) { return f && f.raw && f.raw.size ? Math.max(...f.raw.keys()) : 0; }
/* for the warnings on People & access */
let trustTimer = null;
function recheckTrust() {
  if (!V.owner) return;
  clearTimeout(trustTimer);
  trustTimer = setTimeout(async () => {
    const people = new Map(), grants = new Map();
    try {
      for (const u of V.users.values()) if (u.role === 'staff') people.set(u.uid, await personOk(u));
      for (const g of V.grants.values()) if (g.uid !== V.uid) grants.set(g.id, await memberOk(g, refKv(V.folders.get(g.fid))));
    } catch (e) { console.warn('trust check', e); }
    V.trust = { people, grants }; emit();
  }, 150);
}
export function untrustedCount() {
  let n = 0;
  for (const [uid, ok] of V.trust.people) { const u = V.users.get(uid); if (!ok && u && u.active) n++; }
  for (const [gid, ok] of V.trust.grants) if (!ok && V.grants.has(gid)) n++;
  return n;
}

/* ---------- Dr. A: people ---------- */
async function createAuthLogin(email, authPw) {
  const app2 = initializeApp(V.cfg, 'creator-' + C.newId(8));
  const a2 = initializeAuth(app2, { persistence: inMemoryPersistence });
  if (__VAULT_EMU__) connectAuthEmulator(a2, 'http://127.0.0.1:9099', { disableWarnings: true }); // eslint-disable-line no-undef
  try { const cred = await createUserWithEmailAndPassword(a2, email, authPw); return cred.user.uid; }
  finally { try { await signOut(a2); } catch (e) { } try { await deleteApp(app2); } catch (e) { } }
}
async function newLogin(username, startN) {
  const temp = C.tempPassword();
  const m = await C.deriveMaster(temp, username);
  let n = startN, uid = null;
  for (let tries = 0; tries < 5 && !uid; tries++, n++) {
    try { uid = await createAuthLogin(staffEmail(username, n), m.authPw); }
    catch (e) { if (!/email-already-in-use/.test(e.code || '')) throw e; }
    if (uid) break;
  }
  if (!uid) throw err('login-failed');
  const pair = await C.newPair(), pub = await C.pubJwk(pair), raw = C.packKeys(await C.privBytes(pair));
  const wrap = await C.seal(m.wrapKey, raw, C.AAD.priv(uid));
  raw.fill(0);
  return { uid, n, temp, pub, wrap };
}
export async function usernameFree(username) {
  const u = slugUser(username); if (!u) return false;
  const s = await getDoc(D('logins/' + await loginDocId(u)));
  return !s.exists();
}
export async function addPerson({ name, username, access }) {
  if (!V.owner) throw err('owner-only');
  const un = slugUser(username);
  if (!un || un.length < 2) throw err('bad-username');
  if (!(await usernameFree(un))) throw err('username-taken');
  const L = await newLogin(un, 1);
  const batch = writeBatch(V.db);
  batch.set(D('users/' + L.uid), { name: String(name).trim().slice(0, 60), username: un, role: 'staff', active: true, pub: L.pub, n: L.n, at: ts(), by: V.uid,
    ps: await C.signText(V.spriv, C.SIG.person(L.uid, L.pub)) });
  batch.set(D('keys/' + L.uid), { wrap: L.wrap, temp: true, at: ts() });
  batch.set(D('logins/' + await loginDocId(un)), { n: L.n });
  for (const [fid, role] of Object.entries(access || {})) {
    if (role !== 'view' && role !== 'edit') continue;
    const f = V.folders.get(fid); if (!f) continue;
    batch.set(D('grants/' + L.uid + '_' + fid), { uid: L.uid, fid, role, keys: await sealGrant(L.uid, fid, L.pub, f, memberVersions(f)), gs: await memberSig(L.uid, fid, role, refKv(f)), by: V.uid, at: ts() });
  }
  await batch.commit();
  log('person-add', { u: L.uid });
  return { uid: L.uid, username: un, temp: L.temp };
}
/* forgot password: a fresh login for the same person (same folders); the old login stops working */
export async function reissue(oldUid) {
  if (!V.owner) throw err('owner-only');
  const u = V.users.get(oldUid); if (!u || u.role !== 'staff') throw err('bad-person');
  if (!(await personOk(u))) throw err('unknown-person');
  const ls = await getDoc(D('logins/' + await loginDocId(u.username)));
  const n0 = Math.max(u.n || 1, ls.exists() ? ls.data().n : 1) + 1;
  const L = await newLogin(u.username, n0);
  const batch = writeBatch(V.db);
  batch.set(D('users/' + L.uid), { name: u.name, username: u.username, role: 'staff', active: true, pub: L.pub, n: L.n, at: ts(), by: V.uid, replaces: oldUid,
    ps: await C.signText(V.spriv, C.SIG.person(L.uid, L.pub)) });
  batch.set(D('keys/' + L.uid), { wrap: L.wrap, temp: true, at: ts() });
  batch.update(D('users/' + oldUid), { active: false, replacedBy: L.uid, removedAt: ts() });
  batch.set(D('logins/' + await loginDocId(u.username)), { n: L.n });
  for (const g of Array.from(V.grants.values()).filter(g => g.uid === oldUid)) {
    const f = V.folders.get(g.fid); if (!f) continue;
    batch.delete(D('grants/' + g.id));
    // only places Dr. A gave them carry over
    if (!(await memberOk(g, refKv(f)))) continue;
    batch.set(D('grants/' + L.uid + '_' + g.fid), { uid: L.uid, fid: g.fid, role: g.role, keys: await sealGrant(L.uid, g.fid, L.pub, f, memberVersions(f)), gs: await memberSig(L.uid, g.fid, g.role, refKv(f)), by: V.uid, at: ts() });
  }
  await batch.commit();
  log('reissue', { u: L.uid });
  return { uid: L.uid, username: u.username, temp: L.temp };
}
/* someone leaves: locked out at once, then every folder they could open gets a new key and its passwords are flagged */
export async function removePerson(uid, opts) {
  opts = opts || {};
  const u = V.users.get(uid); if (!V.owner || !u || u.role !== 'staff') throw err('bad-person');
  const theirs = Array.from(V.grants.values()).filter(g => g.uid === uid);
  const batch = writeBatch(V.db);
  batch.update(D('users/' + uid), { active: false, removedAt: ts() });
  const ls = await getDoc(D('logins/' + await loginDocId(u.username)));
  if (ls.exists() && ls.data().n === u.n) batch.delete(D('logins/' + await loginDocId(u.username)));
  theirs.forEach(g => batch.delete(D('grants/' + g.id)));
  await batch.commit();
  log('person-remove', { u: uid });
  const why = opts.flag === false ? '' : (u.name + ' left');
  for (const g of theirs) await rotateFolder(g.fid, why, opts.progress, [uid]);
  return theirs.length;
}
/* new key for a folder: re-seal its name, give remaining members both keys, re-encrypt every item, then drop the old key.
   One key change per folder at a time. */
const rotations = new Map();
/* drop: people to leave out; roles: { uid: 'view' } changes made in the same write; meta: { name, priv } when the
   folder's name couldn't be read (its current version was made by someone else) */
export function rotateFolder(fid, why, progress, drop, roles, meta) {
  const run = (rotations.get(fid) || Promise.resolve()).catch(() => { }).then(() => rotateNow(fid, why, progress, new Set(drop || []), roles || {}, meta || null));
  rotations.set(fid, run);
  return run;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* the folder's places, fresh from the server (a cached copy could lag behind a write made a moment ago) */
async function placesNow(fid) {
  const s = await getDocsFromServer(query(collection(V.db, 'grants'), where('fid', '==', fid)));
  return s.docs.map(x => Object.assign({ id: x.id }, x.data()));
}
/* who may get the folder's key: an active person Dr. A added, in a place he signed for key version kv */
async function rightful(g, kv, drop) {
  const u = V.users.get(g.uid);
  return u && u.active && !drop.has(g.uid) && await personOk(u) && await memberOk(g, kv) ? u : null;
}
async function rotateNow(fid, why, progress, drop, roles, meta) {
  const f = V.folders.get(fid);
  const fsnap = await getDocFromServer(D('folders/' + fid));
  if (!f || !fsnap.exists()) return;
  const d = fsnap.data();
  const report = (done, total) => { try { progress && progress(fid, done, total); } catch (e) { } };
  let from = d.kv, to;
  // finish a key change Dr. A started (only if its new key is one he signed)
  const resumed = !!(d.rot && d.kv === d.rot.to && f.keys.has(d.rot.to));
  if (resumed) { from = d.rot.from; to = d.rot.to; why = why || d.rot.why || ''; }
  else {
    if (!V.spriv) throw err('no-sign-key');
    // repairing a folder whose current key Dr. A never signed: carry its logins over from the newest key he did sign
    if (!f.raw.has(from)) from = refKv(f) || from;
    const places = await placesNow(fid), mine = places.find(g => g.uid === V.uid);
    to = d.kv + 1;   // (the rules only let a slot be filled by the write that moves the folder to it, so it's free)
    const raw = C.rnd(32), k = await C.aesKey(raw);
    if (meta) { f.name = String(meta.name || '').trim().slice(0, 60) || 'Folder'; f.priv = !!meta.priv; f.named = true; }
    if (!f.named) throw err('name-unknown');
    f.raw.set(to, raw); f.keys.set(to, k);   // (needed to seal it; taken back out below if the write is refused)
    try {
      const batch = writeBatch(V.db);
      batch.update(D('folders/' + fid), { kv: to, ['ks.' + to]: await C.signFolderKey(V.spriv, fid, to, raw), name: await C.sealJSON(k, folderMeta(f.name, f.def, f.priv), C.AAD.folder(fid, to)),
        rot: { from, to, why: String(why || '').slice(0, 80) }, at: ts(), by: V.uid });
      const mineBox = await C.sealTo(V.pub, raw, C.AAD.grant(V.uid, fid, to));
      if (mine) batch.update(D('grants/' + mine.id), { ['keys.' + to]: mineBox, at: ts(), by: V.uid });
      else batch.set(D('grants/' + V.uid + '_' + fid), { uid: V.uid, fid, role: 'edit', keys: { [to]: mineBox }, gs: await memberSig(V.uid, fid, 'edit', to), by: V.uid, at: ts() });
      for (const g of places) {
        if (g.uid === V.uid) continue;
        const u = await rightful(g, from, drop);
        if (!u) { batch.delete(D('grants/' + g.id)); continue; }   // someone leaving, or a place Dr. A never gave
        const role = roles[g.uid] || g.role;
        batch.set(D('grants/' + g.id), { uid: g.uid, fid, role, keys: await sealGrant(g.uid, fid, u.pub, f, [from, to].filter(v => f.raw.has(v))),
          gs: await memberSig(g.uid, fid, role, to), by: V.uid, at: ts() });
      }
      await batch.commit();
    } catch (e) { f.raw.delete(to); f.keys.delete(to); throw e; }
    V.rawFolders.set(fid, Object.assign({}, d, { kv: to, rot: { from, to, why } }));
    f.kv = to; f.rot = { from, to, why };
  }
  // re-encrypt every item still under the old key (in small parallel groups)
  const todo = Array.from(V.rawItems.entries()).filter(([, r]) => r.f === fid && r.kv !== to).map(([id]) => id);
  let done = 0; report(0, todo.length);
  const runOne = async id => {
    let ok = false;
    for (let attempt = 0; attempt < 40 && !ok; attempt++) {
      const raw = V.rawItems.get(id), it = V.items.get(id);
      if (!raw) { ok = true; break; }                                       // deleted meanwhile
      // no key Dr. A signed opens it (only someone else using his sign-in could have saved that): put back its last good version
      if ((it && it.err === 'unreadable' && it.rev === raw.rev && it.kv === raw.kv) || (!f.keys.has(raw.kv) && attempt >= 3)) {
        try { await replaceUntrusted(id, fid, why); ok = true; } catch (e) { if (e.code !== 'changed') throw e; await sleep(400); }
        continue;
      }
      if (raw.kv === to && (!why || (it && it.d && it.d.chg))) { ok = true; break; }   // someone already saved it under the new key
      if (!it || !it.d || it.rev !== raw.rev) { await sleep(300); continue; }   // still opening
      const dd = Object.assign({}, it.d);
      if (why) dd.chg = { why, at: Date.now() };
      try { await saveItem(id, fid, dd, { quiet: true, rev: it.rev, keepMeta: true }); ok = true; }
      catch (e) { if (e.code !== 'changed') throw e; await sleep(400); }
    }
    if (!ok) throw err('rotation-incomplete', 'A login in this folder couldn’t be re-locked yet. Try again in a minute.');
    done++; report(done, todo.length);
  };
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(runOne));
  // finish: members keep only the new key (checked again: nobody added since gets it unless Dr. A signed their place)
  const batch = writeBatch(V.db);
  batch.update(D('folders/' + fid), { rot: deleteField(), at: ts(), by: V.uid });
  for (const g of await placesNow(fid)) {
    if (g.uid === V.uid) continue;
    const u = await rightful(g, to, drop);
    if (!u) { batch.delete(D('grants/' + g.id)); continue; }
    batch.set(D('grants/' + g.id), { uid: g.uid, fid, role: g.role, keys: await sealGrant(g.uid, fid, u.pub, f, [to]), gs: g.gs, by: V.uid, at: ts() });
  }
  await batch.commit();
  f.rot = null;
  log('rekey', { f: fid, n: todo.length });
  // someone to leave out (or to move to view) joined a change that was already under way: change the key once more
  if (resumed && (drop.size || Object.keys(roles).length)) return rotateNow(fid, why, progress, drop, roles, meta);
}
/* a login that no key Dr. A signed opens — only someone else using his sign-in could have saved it. Put back its newest
   version that does open; if it never had one (it was slipped in), delete it for good (that copy stays in history). */
async function replaceUntrusted(id, fid, why) {
  const cur = await freshRaw(id);
  // only a version that lived in this same folder: content never moves into a folder other people can open
  const good = (await itemHistory(id)).find(v => v.d && v.f === fid);
  try {
    if (!good) await purgeItem(id);
    else {
      const d = Object.assign({}, good.d);
      if (why) d.chg = { why, at: Date.now() };
      await saveItem(id, fid, d, { quiet: true, rev: cur.rev, keepMeta: true, del: !!good.del });
    }
  } catch (e) {
    if (e.code === 'changed') throw e;
    console.warn('left as it was', id, e && e.code);   // it stays unreadable; it can't hurt anything
  }
}
/* folders left half-way through a key change (the page was closed) */
export function unfinishedRotations() { return V.owner ? folderList().filter(f => f.rot) : []; }
export async function saveSettings(s) {
  const lockMax = Math.max(1, Math.min(60, s.lockMax | 0 || 10));
  await updateDoc(D('meta/settings'), { lockMax, at: ts() });
  log('settings');
}

/* ---------- Dr. A: history, activity ---------- */
export async function itemHistory(id) {
  const s = await getDocs(query(collection(V.db, 'versions'), where('i', '==', id)));
  const out = [];
  for (const docu of s.docs) {
    const v = docu.data();
    const f = V.folders.get(v.f); const k = f && f.keys.get(v.kv);
    let d = null;
    if (k) { try { d = normItem(await C.openJSON(k, { iv: v.iv, ct: v.ct }, C.AAD.item(id, v.f, v.kv))); } catch (e) { } }
    out.push({ rev: v.rev, at: ms(v.at), by: v.by, f: v.f, del: v.del, d });
  }
  return out.sort((a, b) => b.rev - a.rev);
}
export async function activity(n) {
  const s = await getDocs(query(collection(V.db, 'log'), orderBy('at', 'desc'), qlimit(n || 400)));
  return s.docs.map(x => Object.assign({ id: x.id }, x.data(), { at: ms(x.data().at) }));
}

/* ---------- Dr. A: encrypted backup file ---------- */
export function snapshotAll() {
  const folders = folderList().map(f => ({ id: f.id, name: f.name, color: f.color }));
  const items = Array.from(V.items.values()).filter(i => i.d && !i.del).map(i => ({ f: i.f, d: i.d }));
  return { app: 'nlo-vault', v: 1, at: Date.now(), by: V.me ? V.me.name : '', folders, items };
}
export async function backupFile(password) {
  const data = C.TE.encode(JSON.stringify(snapshotAll()));
  const box = await C.secretSeal(password, data, C.AAD.backup, C.KDF_ITER);
  log('backup', { n: Array.from(V.items.values()).filter(i => i.d && !i.del).length });
  savePrefs({ bk: Date.now() }).catch(() => { });
  return JSON.stringify({ format: 'nlo-vault-backup', v: 1, kdf: 'PBKDF2-SHA256', box }, null, 1);
}
export async function readBackup(text, password) {
  let j; try { j = JSON.parse(text); } catch (e) { throw err('not-backup'); }
  if (!j || j.format !== 'nlo-vault-backup' || !j.box) throw err('not-backup');
  let bytes; try { bytes = await C.secretOpen(password, j.box, C.AAD.backup); } catch (e) { throw err('bad-backup-password'); }
  const data = JSON.parse(C.TD.decode(bytes));
  if (!data || data.app !== 'nlo-vault' || !Array.isArray(data.items) || !Array.isArray(data.folders)) throw err('not-backup');
  data.folders = data.folders.filter(f => f && typeof f === 'object').map(f => ({ id: str(f.id), name: str(f.name).slice(0, 60) || 'Restored', color: COLORS.includes(f.color) ? f.color : 'gray' }));
  data.items = data.items.filter(x => x && typeof x === 'object').map(x => ({ f: str(x.f), d: normItem(x.d) }));
  data.at = num(data.at); data.by = str(data.by).slice(0, 60);
  return data;
}
