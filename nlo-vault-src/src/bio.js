/* =====================================================================
   NLO Vault — Dr. A opens the vault without typing his password:
     • on his iPhone with Face ID (on an Android phone, fingerprint or face), and
     • on a computer by scanning the code the browser shows with his iPhone, then Face ID.

   Turning it on (Settings, after typing the vault password once):
     a passkey made just for this device (on a computer: saved on his iPhone through the code), checked with Face ID.
     The passkey's PRF secret — which the iPhone hands out only after Face ID or its own passcode, and over the code
     only when the iPhone is right next to the computer (Bluetooth) — locks a small copy kept only in this browser:
     the sign-in secret and the key that opens his folders (store.js deviceCopy). Not the password's master, not his
     signing key and not the lock key: so a session opened this way can use and edit logins, but changing people,
     access or folder keys, or his own key copy, still asks for the password.
   Unlocking: Face ID -> the secret -> the copy -> sign-in (store.js signInDevice).
   Nothing about it is saved in Firebase, the password always still works, and changing the password stops it working
   everywhere (the copies' sign-in secret no longer matches; each device forgets its copy the next time it's tried).
   Face ID on the device itself only on phones; on anything else (computers) it's the code and the iPhone.
   ===================================================================== */
import * as C from './crypto.js';

const KEY = 'nloVault.bio', DEV = 'nloVault.dev';
const getLS = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const putLS = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };
function err(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

/* each kind of device, with the words people know it by */
const KINDS = {
  ios: {
    kind: 'ios', route: 'phone', device: 'iPhone', name: 'Face ID', feature: 'Face ID', heading: 'Face ID',
    btn: 'Unlock with Face ID', onBtn: 'Turn on Face ID', dlg: 'Turn on Face ID', look: 'Look at your iPhone',
    how: 'Then look at your iPhone when it asks — twice: once to make the passkey, once to check it.',
    cancel: 'Face ID didn’t finish. Try again, or type your password.',
    cancelSetup: 'Face ID didn’t finish, so nothing changed. Try again when you’re ready.',
    cant: 'This iPhone can’t do it: it needs iOS 18 or newer, with the passkey saved in Apple’s Passwords (iCloud Keychain).'
  },
  android: {
    kind: 'android', route: 'phone', device: 'phone', name: 'fingerprint or face unlock', feature: 'fingerprint or face unlock',
    heading: 'Fingerprint or face unlock', btn: 'Unlock with fingerprint or face', onBtn: 'Turn it on', dlg: 'Turn on fingerprint or face unlock',
    look: 'Confirm on your phone', how: 'Then confirm on your phone when it asks — twice: once to make the passkey, once to check it.',
    cancel: 'That didn’t finish. Try again, or type your password.',
    cancelSetup: 'That didn’t finish, so nothing changed. Try again when you’re ready.',
    cant: 'This phone can’t do it: it needs an up-to-date Chrome with Google Password Manager.'
  },
  computer: {
    kind: 'computer', route: 'computer', device: 'computer', name: 'your iPhone', feature: 'unlocking with your iPhone',
    heading: 'Unlock with your iPhone', btn: 'Unlock with your iPhone', onBtn: 'Set up on this computer', dlg: 'Unlock with your iPhone',
    look: 'Scan the code with your iPhone',
    how: 'Then scan the code that appears with your iPhone’s camera and use Face ID — twice: once to save a passkey on your iPhone, once to check it.',
    cancel: 'That didn’t finish. Try again and scan the code with your iPhone (Bluetooth has to be on, here and on the iPhone), or type your password.',
    cancelSetup: 'That didn’t finish, so nothing changed. Check that Bluetooth is on (here and on your iPhone) and try again.',
    cant: 'This computer can’t do it with your iPhone. It works with an up-to-date Chrome or Edge (Windows 11 is the surest) or on a Mac, with iOS 18.4 or newer on the iPhone.'
  }
};

/* this device: iPhone or Android phone, or a computer; iPads and Android tablets get nothing */
export function bioDevice() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  if (/iPhone|iPod/.test(ua)) return KINDS.ios;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return null;   // (iPads can say "Macintosh")
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? KINDS.android : null;
  return KINDS.computer;
}
function computerName() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /Windows/.test(ua) ? 'Windows computer' : /Macintosh/.test(ua) ? 'Mac' : 'computer';
}

/* can this device and browser do it? phones: a passkey kept on the phone, checked with Face ID or the like.
   computers: a passkey on a phone nearby, through the code (needs Bluetooth: noBluetooth when the browser says it has none) */
export async function bioSupported() {
  const d = bioDevice();
  const P = typeof window !== 'undefined' ? window.PublicKeyCredential : null;
  if (!d || !P || !window.isSecureContext || !navigator.credentials) return null;
  try {
    const c = P.getClientCapabilities ? await P.getClientCapabilities() : null;
    if (c && c['extension:prf'] === false) return null;
    if (d.route === 'computer') return Object.assign({}, d, { noBluetooth: !!c && c.hybridTransport === false });
    if (c && c.userVerifyingPlatformAuthenticator === false) return null;
    return (await P.isUserVerifyingPlatformAuthenticatorAvailable()) ? d : null;
  } catch (e) { return null; }
}

/* what this browser keeps: { v, kind, uid, login, name, id (the passkey), tr, salt, box (the copy, locked), at } —
   nothing readable. Only a record made for this kind of device counts. */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/, B64U = /^[A-Za-z0-9_-]+$/;
const TRANSPORTS = ['hybrid', 'internal', 'usb', 'nfc', 'ble', 'smart-card'];
export function bioRecord() {
  try {
    const d = bioDevice();
    const r = JSON.parse(getLS(KEY) || 'null');
    const ok = !!d && r && r.v === 1 && r.kind === d.route && typeof r.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(r.uid)
      && typeof r.login === 'string' && r.login.length > 0 && r.login.length <= 120
      && typeof r.id === 'string' && r.id.length >= 16 && r.id.length <= 1400 && B64U.test(r.id)
      && Array.isArray(r.tr) && r.tr.length <= 6 && r.tr.every(t => TRANSPORTS.includes(t))
      && typeof r.salt === 'string' && r.salt.length === 44 && B64.test(r.salt)
      && r.box && typeof r.box.iv === 'string' && r.box.iv.length === 16 && B64.test(r.box.iv)
      && typeof r.box.ct === 'string' && r.box.ct.length <= 8000 && B64.test(r.box.ct);
    return ok ? r : null;
  } catch (e) { return null; }
}
/* anything stored that isn't a good record for this device (so the sign-in page can say so and clear it) */
export function bioJunk() { const s = getLS(KEY); return !!s && !bioRecord(); }
/* forget it in this browser, and ask the browser to delete this device's own passkey too (newer iPhones, Macs and
   Chrome do; the iPhone can't hear it through the code, so a computer's passkey may stay there — harmless) */
export function bioForget() {
  const r = bioRecord();   // (only a good record for this device names a passkey to delete; junk is just cleared)
  putLS(KEY, null);
  if (r) dropPasskey(r.id);
}
function dropPasskey(id) {
  try {
    const P = window.PublicKeyCredential;
    if (P && P.signalUnknownCredential) P.signalUnknownCredential({ rpId: location.hostname, credentialId: id }).catch(() => { });
  } catch (e) { }
}

/* the same label for the same person in the same browser, so turning it on again replaces that device's passkey
   instead of piling up new ones in the Passwords app (each computer and the phone get their own) */
async function userHandle(uid) {
  let d = getLS(DEV);
  if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) { d = C.b64u(C.rnd(16)); putLS(DEV, d); }
  return C.sha256(C.TE.encode('nlo-vault/v1/passkey/' + uid + '/' + d));
}
function webErr(e) {
  const n = (e && e.name) || '';
  if (n === 'NotAllowedError' || n === 'AbortError') return err('bio-cancel');
  if (n === 'NotSupportedError') return err('bio-no-prf');
  return err('bio-failed', 'That didn’t work on this device' + (n ? ' (' + n + ')' : '') + '.');
}
/* where the passkey answers from: on a phone, the phone itself only; on a computer, the iPhone through the code */
function reach(route, tr) {
  if (route === 'phone') return { transports: ['internal'], hints: ['client-device'] };
  return { transports: tr && tr.includes('hybrid') ? ['hybrid'] : (tr && tr.length ? tr : ['hybrid']), hints: ['hybrid'] };
}
/* Face ID -> the passkey's secret for this salt (32 bytes) */
async function prfOf(route, id, tr, salt) {
  const r = reach(route, tr);
  let a;
  try {
    a = await navigator.credentials.get({ publicKey: {
      challenge: C.rnd(32),
      allowCredentials: [{ type: 'public-key', id: C.unb64u(id), transports: r.transports }],
      userVerification: 'required', timeout: 120000, hints: r.hints,
      extensions: { prf: { eval: { first: salt } } }
    } });
  } catch (e) { throw webErr(e); }
  // on a phone, another device (the "use a phone or tablet" option) gives a different secret: not this phone's passkey
  if (route === 'phone' && a && a.authenticatorAttachment === 'cross-platform') throw err('bio-other-device');
  const ext = (a && a.getClientExtensionResults && a.getClientExtensionResults()) || {};
  const out = ext.prf && ext.prf.results && ext.prf.results.first;
  if (!out) throw err('bio-no-prf');
  return new Uint8Array(out);
}
const same = (x, y) => !!x && !!y && x.length === y.length && x.every((b, i) => b === y[i]);

/* turn it on. copy = { a: sign-in secret, e: folder-opening private key } from store.deviceCopy (caller zeroes e) */
export async function bioEnable({ uid, login, name, copy }) {
  if (!uid || !login || !copy || typeof copy.a !== 'string' || !(copy.e instanceof Uint8Array)) throw err('bad-copy');
  const d = bioDevice();
  if (!d) throw err('bio-no-prf');
  const route = d.route;
  login = C.loginId(login);
  const salt = C.rnd(32);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'NLO Vault' },
      user: { id: await userHandle(uid), name: login, displayName: (name || login) + ' · ' + (route === 'phone' ? d.device : computerName()) },
      challenge: C.rnd(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: route === 'phone' ? 'platform' : 'cross-platform', residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
      attestation: 'none', timeout: 120000, hints: reach(route).hints,
      extensions: { prf: { eval: { first: salt } } }
    } });
  } catch (e) { throw webErr(e); }
  if (!cred || !cred.rawId) throw err('bio-cancel');
  const id = C.b64u(cred.rawId);
  let out = null;
  try {
    let tr = [];
    try { tr = (cred.response && cred.response.getTransports ? cred.response.getTransports() : []).filter(t => TRANSPORTS.includes(t)).slice(0, 6); } catch (e) { }
    const ext = (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {};
    if (!ext.prf || ext.prf.enabled === false) throw err('bio-no-prf');
    const atCreate = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
    // use the new passkey once, exactly as unlocking will (iPhones only hand the secret out then). On a phone, if it
    // also came when the passkey was made, the two must agree; through the code only this way is ever used again
    // (some phones answer differently when a passkey is made), so that's the one that counts
    out = await prfOf(route, id, tr, salt);
    if (route === 'phone' && atCreate && !same(atCreate, out)) throw err('bio-no-prf');
    const key = await C.bioKey(out);
    const rec = { v: 1, kind: route, uid, login, name: String(name || '').slice(0, 60), id, tr, salt: C.b64(salt), at: Date.now(),
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
  const out = await prfOf(r.kind, r.id, r.tr, C.unb64(r.salt));
  let j;
  try { j = await C.openJSON(await C.bioKey(out), r.box, C.AAD.bio(r.uid, r.login, r.id)); }
  catch (e) { throw err('bio-broken'); }
  finally { out.fill(0); }
  if (!j || typeof j.a !== 'string' || !/^nv1\.[A-Za-z0-9_-]{43}$/.test(j.a) || typeof j.e !== 'string' || !B64.test(j.e)) throw err('bio-broken');
  return { uid: r.uid, login: r.login, copy: { a: j.a, e: C.unb64(j.e) } };
}
