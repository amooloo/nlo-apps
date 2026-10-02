'use strict';
/* Seal bytes to a P-256 public key with the same scheme the app's browsers use to open them
   (ECDH with a one-time key → HKDF-SHA256 → AES-256-GCM, the "info" text bound in as extra data).
   It uses Node's built-in WebCrypto — the same algorithms, called the same way, as in the browser. */
const { webcrypto, createHash, timingSafeEqual } = require('crypto');
const subtle = webcrypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const TE = new TextEncoder();
const b64 = u => Buffer.from(u instanceof ArrayBuffer ? new Uint8Array(u) : u).toString('base64');

async function sealTo(pub, bytes, info) {
  const pk = await subtle.importKey('jwk', { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, ext: true }, EC, false, []);
  const eph = await subtle.generateKey(EC, true, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(info) }, key, bytes);
  const j = await subtle.exportKey('jwk', eph.publicKey);
  return { epk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, iv: b64(iv), ct: b64(ct) };
}
function sha256hex(s) { return createHash('sha256').update(String(s), 'utf8').digest('hex'); }
/* compare two hex digests without leaking where they differ */
function sameHex(a, b) { const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8'); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); }
module.exports = { sealTo, sha256hex, sameHex };
