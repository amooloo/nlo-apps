/* =====================================================================
   NLO Vault — encryption (browser WebCrypto only, no outside code)

   How a password is turned into keys (same idea as Bitwarden):
     master = PBKDF2-SHA256(password, salt = SHA-256("nlo-vault/v1/salt/" + login), 600,000 rounds)
     authPw = HKDF(master, "nlo-vault/v1/auth")  -> the only thing Google's sign-in ever sees
     wrap   = HKDF(master, "nlo-vault/v1/wrap")  -> AES-256-GCM key that locks this person's private key
   The real password never leaves the device, and authPw can't be turned back into it or into wrap.

   Each person has an ECDH P-256 key pair. Each folder has its own random AES-256 key, sealed to the
   public key of every person allowed into the folder ("grant"). Each item is AES-256-GCM encrypted with
   its folder's key; the additional data binds the ciphertext to the item id, folder and key version, so
   ciphertext can't be swapped between items or folders.
   ===================================================================== */

export const TE = new TextEncoder();
export const TD = new TextDecoder();
export const KDF_ITER = 600000;
export const REC_ITER = 100000;   // the recovery code is already ~119 random bits
const subtle = () => globalThis.crypto.subtle;

export function rnd(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536)));
  return u;
}

/* base64 that works for any size (no spread into String.fromCharCode — see the Staff Hub silent-save bug) */
export function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), CH = 0x8000;
  let s = '';
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(String(s || ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function b64u(buf) { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function hex(buf) { return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join(''); }

export async function sha256(bytes) { return new Uint8Array(await subtle().digest('SHA-256', bytes)); }
export async function sha256hex(str) { return hex(await sha256(TE.encode(str))); }

/* random characters without modulo bias; no look-alike letters (0/O, 1/I/L) */
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randChars(n, alpha) {
  const A = alpha || CODE_ALPHA, lim = 256 - (256 % A.length);
  let out = '';
  while (out.length < n) {
    for (const b of rnd(n * 2)) if (b < lim && out.length < n) out += A[b % A.length];
  }
  return out;
}
export function randInt(max) {
  // uniform integer in [0, max) for max <= 2^32
  if (max <= 1) return 0;
  const lim = Math.floor(0x100000000 / max) * max;
  while (true) {
    const v = new DataView(rnd(4).buffer).getUint32(0);
    if (v < lim) return v % max;
  }
}
export function tempPassword() { return randChars(12).replace(/(.{4})(?=.)/g, '$1-'); }
export function recoveryCode() { return randChars(24).replace(/(.{4})(?=.)/g, '$1-'); }
export function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-'); }
export function newId(n) { return randChars(n || 20, 'abcdefghijkmnpqrstuvwxyz23456789'); }

/* login id: staff log in with a username, Dr. A with his email; both lower-cased */
export function loginId(s) { return String(s || '').trim().toLowerCase(); }

/* ---------- password -> keys ---------- */
export async function deriveMaster(password, login, iter) {
  const pw = String(password || '').normalize('NFC');
  const salt = await sha256(TE.encode('nlo-vault/v1/salt/' + loginId(login)));
  const base = await subtle().importKey('raw', TE.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter || KDF_ITER }, base, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const zero = new Uint8Array(32);
  const authBits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: TE.encode('nlo-vault/v1/auth') }, hk, 256);
  const wrapKey = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: TE.encode('nlo-vault/v1/wrap') }, hk,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const lockKey = await hmacKey(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: TE.encode('nlo-vault/v1/lock') }, hk, 256));
  return { authPw: 'nv1.' + b64u(authBits), wrapKey, lockKey };
}

/* ---------- one-time tokens that guard Dr. A's own key copy ----------
   The database keeps only SHA-256(token). Every change to his key copy must show the current token and set the next one.
   Tokens come from his password (or from his recovery code), so nobody else — even signed in as him, say through his
   email — can change or wipe his key copy. Counters only go up, so a token is never used twice. */
async function hmacKey(bits) { return subtle().importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); }
export async function codeLockKey(code, uid) {
  // as slow to guess as the recovery copy itself (the stored check shouldn't be a faster way to test codes)
  const base = await subtle().importKey('raw', TE.encode(normCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: await sha256(TE.encode('nlo-vault/v1/lock-rec/' + uid)), iterations: REC_ITER }, base, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveBits']);
  return hmacKey(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode('nlo-vault/v1/lock-rec') }, hk, 256));
}
export async function lockToken(lk, label) { return b64u(await subtle().sign('HMAC', lk, TE.encode('nlo-vault/v1/lock/' + label))); }
export async function lockHash(token) { return hex(await sha256(TE.encode(token))); }

/* ---------- AES-256-GCM ---------- */
export async function aesKey(raw, usages) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, usages || ['encrypt', 'decrypt']);
}
export async function seal(key, bytes, aad) {
  const iv = rnd(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, key, bytes);
  return { iv: b64(iv), ct: b64(ct) };
}
export async function open(key, box, aad) {
  if (!box || typeof box.iv !== 'string' || typeof box.ct !== 'string') throw new Error('bad-box');
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: TE.encode(aad) }, key, unb64(box.ct));
  return new Uint8Array(pt);
}
/* JSON, padded with trailing spaces to a multiple of 256 bytes so a ciphertext's size says little about what's inside */
export function padJSON(obj) {
  const s = JSON.stringify(obj);
  const len = TE.encode(s).length, target = Math.ceil((len + 1) / 256) * 256;
  return s + ' '.repeat(target - len);
}
export async function sealJSON(key, obj, aad) { return seal(key, TE.encode(padJSON(obj)), aad); }
export async function openJSON(key, box, aad) { return JSON.parse(TD.decode(await open(key, box, aad))); }

/* a key from a separate secret (recovery code, backup password) with its own random salt */
export async function secretSeal(secret, bytes, aad, iter) {
  iter = iter || KDF_ITER;
  const salt = rnd(16);
  const k = await secretKey(secret, salt, iter);
  const box = await seal(k, bytes, aad);
  return { salt: b64(salt), iter, iv: box.iv, ct: box.ct };
}
export async function secretOpen(secret, box, aad) {
  if (!box || !box.salt) throw new Error('bad-box');
  const k = await secretKey(secret, unb64(box.salt), box.iter || KDF_ITER);
  return open(k, box, aad);
}
async function secretKey(secret, salt, iter) {
  const base = await subtle().importKey('raw', TE.encode(String(secret).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ---------- ECDH P-256 key pairs and sealed boxes ---------- */
const EC = { name: 'ECDH', namedCurve: 'P-256' };
export async function newPair() { return subtle().generateKey(EC, true, ['deriveBits']); }
export async function pubJwk(pair) {
  const j = await subtle().exportKey('jwk', pair.publicKey || pair);
  return { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
}
export async function privBytes(pair) { return new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey)); }
export async function importPriv(bytes) { return subtle().importKey('pkcs8', bytes, EC, false, ['deriveBits']); }
async function importPub(j) {
  if (!j || j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string') throw new Error('bad-pub');
  return subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, ext: true }, EC, true, []);
}
async function boxKey(bits, epkBytes, info) {
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  // the sender's one-time public key is the HKDF salt, the context string is both the HKDF info and the AES additional data
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epkBytes, info: TE.encode(info) }, hk,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/* the uncompressed point 04||x||y of a public JWK (used as the HKDF salt) */
function unb64u(s) { return unb64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); }
function jwkRaw(j) { const x = unb64u(j.x), y = unb64u(j.y), out = new Uint8Array(65); out[0] = 4; out.set(x, 1); out.set(y, 33); return out; }
export async function sealTo(pub, bytes, info) {
  const pk = await importPub(pub);
  const eph = await newPair();
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256);
  const epk = await pubJwk(eph);
  const k = await boxKey(bits, jwkRaw(epk), info);
  const box = await seal(k, bytes, info);
  return { epk, iv: box.iv, ct: box.ct };
}
export async function openFrom(priv, box, info) {
  if (!box || !box.epk) throw new Error('bad-box');
  const epk = await importPub(box.epk);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: epk }, priv, 256);
  const k = await boxKey(bits, jwkRaw(box.epk), info);
  return open(k, box, info);
}

/* ---------- Dr. A's signing key: every folder key he makes is signed, and every browser checks the signature
   before using a key, so nobody else (even someone who got into his sign-in) can slip in a key they know ---------- */
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
export async function newSignPair() { return subtle().generateKey(ECDSA, true, ['sign', 'verify']); }
export async function importSignPriv(bytes) { return subtle().importKey('pkcs8', bytes, ECDSA, false, ['sign']); }
let vCache = { j: null, k: null };
async function importVerify(j) {
  if (!j || j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string') throw new Error('bad-pub');
  if (vCache.j === j) return vCache.k;
  const k = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, ext: true }, ECDSA, false, ['verify']);
  vCache = { j, k };
  return k;
}
/* his signature on who may hold which folder key: his browser seals a key to someone only if he signed that person's
   public key (when he added them) and their place in the folder (view or edit) for its current key version */
export async function signText(spriv, text) { return b64(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, spriv, TE.encode(text))); }
export async function verifyText(spk, sig, text) {
  try {
    if (typeof sig !== 'string' || !sig) return false;
    return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, await importVerify(spk), unb64(sig), TE.encode(text));
  } catch (e) { return false; }
}
export const SIG = {
  person: (uid, pub) => 'nlo-vault/v1/person/' + uid + '/' + (pub ? pub.x + '/' + pub.y : ''),
  member: (uid, fid, role, kv) => 'nlo-vault/v1/member/' + uid + '/' + fid + '/' + role + '/' + kv
};
async function keyMsg(fid, kv, raw) { return TE.encode('nlo-vault/v1/fkey/' + fid + '/' + kv + '/' + hex(await sha256(raw))); }
export async function signFolderKey(spriv, fid, kv, raw) {
  return b64(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, spriv, await keyMsg(fid, kv, raw)));
}
export async function verifyFolderKey(spk, sig, fid, kv, raw) {
  try {
    if (typeof sig !== 'string' || !sig) return false;
    return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, await importVerify(spk), unb64(sig), await keyMsg(fid, kv, raw));
  } catch (e) { return false; }
}
/* what a person's password unlocks: their ECDH private key, and for Dr. A also his signing key */
export function packKeys(e, s) { return TE.encode(JSON.stringify(s ? { e: b64(e), s: b64(s) } : { e: b64(e) })); }
export function unpackKeys(bytes) { const j = JSON.parse(TD.decode(bytes)); return { e: unb64(j.e), s: j.s ? unb64(j.s) : null }; }

/* ---------- what each piece of ciphertext is bound to ---------- */
export const AAD = {
  priv: uid => 'nlo-vault/v1/priv/' + uid,
  rec: uid => 'nlo-vault/v1/rec/' + uid,
  grant: (uid, fid, kv) => 'nlo-vault/v1/grant/' + uid + '/' + fid + '/' + kv,
  folder: (fid, kv) => 'nlo-vault/v1/folder/' + fid + '/' + kv,
  item: (iid, fid, kv) => 'nlo-vault/v1/item/' + iid + '/' + fid + '/' + kv,
  backup: 'nlo-vault/v1/backup'
};
