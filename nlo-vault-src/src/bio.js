/* =====================================================================
   NLO Vault — Dr. A opens the vault with Face ID on his own phone (iPhone; on an Android phone, fingerprint or face).

   Turning it on (Settings, after typing the vault password once):
     the phone makes a passkey just for this, checked with Face ID. The passkey's PRF secret — which the phone hands
     out only after Face ID or its own passcode — locks a small copy kept only in this browser on this phone:
     the sign-in secret and the key that opens his folders (store.js deviceCopy). Not the password's master, not
     his signing key and not the lock key: so a Face ID session can use and edit logins, but changing people,
     access or folder keys, or his own key copy, still asks for the password.
   Unlocking: Face ID -> the secret -> the copy -> sign-in (store.js signInDevice).
   Nothing about it is saved in Firebase, the password always still works, and changing the password switches it
   off (the copy's sign-in secret no longer matches). Phones only: computers and iPads in the office are shared.
   ===================================================================== */
import * as C from './crypto.js';

const KEY = 'nloVault.bio', DEV = 'nloVault.dev';
const getLS = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const putLS = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };
function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

/* phones only, with the name people know the unlock by */
export function bioDevice() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/iPhone|iPod/.test(ua)) return { kind: 'ios', name: 'Face ID', device: 'iPhone', look: 'Look at your iPhone' };
  if (/Android/.test(ua) && /Mobile/.test(ua)) return { kind: 'android', name: 'fingerprint or face unlock', device: 'phone', look: 'Confirm on your phone' };
  return null;
}

/* can this phone and browser do it? (a passkey kept on the phone itself, checked with Face ID or the like) */
export async function bioSupported() {
  const d = bioDevice();
  const P = typeof window !== 'undefined' ? window.PublicKeyCredential : null;
  if (!d || !P || !window.isSecureContext || !navigator.credentials) return null;
  try {
    if (P.getClientCapabilities) {
      const c = await P.getClientCapabilities();
      if (c && (c['extension:prf'] === false || c.userVerifyingPlatformAuthenticator === false)) return null;
    }
    return (await P.isUserVerifyingPlatformAuthenticatorAvailable()) ? d : null;
  } catch (e) { return null; }
}

/* what the phone keeps: { v, uid, login, name, id (the passkey), salt, box (the copy, locked), at } — nothing readable */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/, B64U = /^[A-Za-z0-9_-]+$/;
export function bioRecord() {
  try {
    const r = JSON.parse(getLS(KEY) || 'null');
    const ok = r && r.v === 1 && typeof r.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(r.uid)
      && typeof r.login === 'string' && r.login.length > 0 && r.login.length <= 120
      && typeof r.id === 'string' && r.id.length >= 16 && r.id.length <= 1400 && B64U.test(r.id)
      && typeof r.salt === 'string' && r.salt.length === 44 && B64.test(r.salt)
      && r.box && typeof r.box.iv === 'string' && r.box.iv.length === 16 && B64.test(r.box.iv)
      && typeof r.box.ct === 'string' && r.box.ct.length <= 8000 && B64.test(r.box.ct);
    return ok ? r : null;
  } catch (e) { return null; }
}
/* anything stored that isn't a good record (so the sign-in page can say so and clear it) */
export function bioJunk() { const s = getLS(KEY); return !!s && !bioRecord(); }
/* forget it on this phone, and ask the phone to delete the passkey too (newer iPhones and Chrome do; others ignore it) */
export function bioForget() {
  const r = bioRecord();
  putLS(KEY, null);
  if (r) dropPasskey(r.id);
}
function dropPasskey(id) {
  try {
    const P = window.PublicKeyCredential;
    if (P && P.signalUnknownCredential) P.signalUnknownCredential({ rpId: location.hostname, credentialId: id }).catch(() => { });
  } catch (e) { }
}

/* the same label for the same person on the same phone, so turning it on again replaces that phone's passkey
   instead of piling up new ones in the Passwords app */
async function userHandle(uid) {
  let d = getLS(DEV);
  if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) { d = C.b64u(C.rnd(16)); putLS(DEV, d); }
  return C.sha256(C.TE.encode('nlo-vault/v1/passkey/' + uid + '/' + d));
}
function webErr(e) {
  const n = (e && e.name) || '';
  if (n === 'NotAllowedError' || n === 'AbortError') return err('bio-cancel');
  if (n === 'NotSupportedError') return err('bio-no-prf');
  return err('bio-failed', 'That didn’t work on this phone' + (n ? ' (' + n + ')' : '') + '.');
}
/* Face ID -> the passkey's secret for this salt (32 bytes), from this phone's own passkey only */
async function prfOf(id, salt) {
  let a;
  try {
    a = await navigator.credentials.get({ publicKey: {
      challenge: C.rnd(32),
      allowCredentials: [{ type: 'public-key', id: C.unb64u(id), transports: ['internal'] }],
      userVerification: 'required', timeout: 120000, hints: ['client-device'],
      extensions: { prf: { eval: { first: salt } } }
    } });
  } catch (e) { throw webErr(e); }
  // another device (the "use a phone or tablet" option) gives a different secret: not this phone's passkey
  if (a && a.authenticatorAttachment === 'cross-platform') throw err('bio-other-device');
  const ext = (a && a.getClientExtensionResults && a.getClientExtensionResults()) || {};
  const out = ext.prf && ext.prf.results && ext.prf.results.first;
  if (!out) throw err('bio-no-prf');
  return new Uint8Array(out);
}
const same = (x, y) => !!x && !!y && x.length === y.length && x.every((b, i) => b === y[i]);

/* turn it on. copy = { a: sign-in secret, e: folder-opening private key } from store.deviceCopy (caller zeroes e) */
export async function bioEnable({ uid, login, name, copy }) {
  if (!uid || !login || !copy || typeof copy.a !== 'string' || !(copy.e instanceof Uint8Array)) throw err('bad-copy');
  const d = bioDevice() || { device: 'phone' };
  login = C.loginId(login);
  const salt = C.rnd(32);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'NLO Vault' },
      user: { id: await userHandle(uid), name: login, displayName: (name || login) + ' · ' + d.device },
      challenge: C.rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
      attestation: 'none', timeout: 120000, hints: ['client-device'],
      extensions: { prf: { eval: { first: salt } } }
    } });
  } catch (e) { throw webErr(e); }
  if (!cred || !cred.rawId) throw err('bio-cancel');
  const id = C.b64u(cred.rawId);
  let out = null;
  try {
    const ext = (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {};
    if (!ext.prf || ext.prf.enabled === false) throw err('bio-no-prf');
    const atCreate = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
    // use the new passkey once, exactly as unlocking will (some iPhones only hand the secret out then); if the phone
    // also gave it when making the passkey, the two must agree
    out = await prfOf(id, salt);
    if (atCreate && !same(atCreate, out)) throw err('bio-no-prf');
    const key = await C.bioKey(out);
    const rec = { v: 1, uid, login, name: String(name || '').slice(0, 60), id, salt: C.b64(salt), at: Date.now(),
      box: await C.sealJSON(key, { a: copy.a, e: C.b64(copy.e) }, C.AAD.bio(uid, login, id)) };
    const old = bioRecord();
    if (!putLS(KEY, JSON.stringify(rec))) throw err('bio-storage');
    if (old && old.id !== id) dropPasskey(old.id);
    return rec;
  } catch (e) { dropPasskey(id); throw e; }
  finally { if (out) out.fill(0); }
}

/* unlock: Face ID -> { uid, login, copy: { a, e } } (the caller zeroes copy.e) */
export async function bioUnlock() {
  const r = bioRecord(); if (!r) throw err('bio-none');
  const out = await prfOf(r.id, C.unb64(r.salt));
  let j;
  try { j = await C.openJSON(await C.bioKey(out), r.box, C.AAD.bio(r.uid, r.login, r.id)); }
  catch (e) { throw err('bio-broken'); }
  finally { out.fill(0); }
  if (!j || typeof j.a !== 'string' || !/^nv1\.[A-Za-z0-9_-]{43}$/.test(j.a) || typeof j.e !== 'string' || !B64.test(j.e)) throw err('bio-broken');
  return { uid: r.uid, login: r.login, copy: { a: j.a, e: C.unb64(j.e) } };
}
