/* NLOSeal — seal bytes to a P-256 public key exactly the way NLO Cases' Crypto.sealTo does in the browser:
   ECDH on P-256 (the shared point's x) → HKDF-SHA256 (salt: 32 zero bytes) → AES-256-GCM (AAD = the same info).
   Written for Google Apps Script, which has no WebCrypto, TextEncoder or crypto.getRandomValues (and whose editor
   rejects BigInt literals): plain-JS libraries only — bn.js and elliptic's curve maths for P-256, aes-js for the AES
   block, hash.js for SHA-256/HMAC — and GCM written out here. Bundled by tools/build-mail.js; tested against
   WebCrypto and the app's own Crypto.openFrom in test/mail_script.js. */
'use strict';
var BN = require('bn.js');
var ShortCurve = require('elliptic/lib/elliptic/curve/short');
var SHA256 = require('hash.js/lib/hash/sha/256');
var Hmac = require('hash.js/lib/hash/hmac');
var aesjs = require('aes-js');

// NIST P-256 (secp256r1), the curve WebCrypto calls 'P-256'
var P256 = new ShortCurve({
  p: 'ffffffff 00000001 00000000 00000000 00000000 ffffffff ffffffff ffffffff',
  a: 'ffffffff 00000001 00000000 00000000 00000000 ffffffff ffffffff fffffffc',
  b: '5ac635d8 aa3a93e7 b3ebbd55 769886bc 651d06b0 cc53b0f6 3bce3c3e 27d2604b',
  n: 'ffffffff 00000000 ffffffff ffffffff bce6faad a7179e84 f3b9cac2 fc632551',
  g: ['6b17d1f2 e12c4247 f8bce6e5 63a440f2 77037d81 2deb33a0 f4a13945 d898c296',
    '4fe342e2 fe1a7f9b 8ee7eb4a 7c0f9e16 2bce3357 6b315ece cbb64068 37bf51f5'],
  gRed: false
});

/* ---------- bytes ---------- */
function utf8(s) { // like TextEncoder: lone surrogates become U+FFFD
  s = String(s); var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      var d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } else c = 0xfffd;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(bytes) {
  var s = '', i;
  for (i = 0; i + 2 < bytes.length; i += 3) { var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; }
  if (bytes.length - i === 1) { var m = bytes[i] << 16; s += B64[m >> 18 & 63] + B64[m >> 12 & 63] + '=='; }
  else if (bytes.length - i === 2) { var k = (bytes[i] << 16) | (bytes[i + 1] << 8); s += B64[k >> 18 & 63] + B64[k >> 12 & 63] + B64[k >> 6 & 63] + '='; }
  return s;
}
function b64url(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) { buf = (buf << 6) | B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
  return out;
}
function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); return s; }
function unhex(h) { var out = []; for (var i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16)); return out; }

/* ---------- SHA-256, HMAC, HKDF (RFC 5869) ---------- */
function sha256(bytes) { return new SHA256().update(bytes).digest(); }
function sha256hex(str) { return hex(sha256(utf8(str))); }
function hmac(key, msg) { return new Hmac(SHA256, key).update(msg).digest(); }
function hkdf(ikm, salt, info, len) {
  var prk = hmac(salt, ikm), out = [], t = [], n = 1;
  while (out.length < len) { t = hmac(prk, t.concat(info, [n++])); out = out.concat(t); }
  return out.slice(0, len);
}

/* ---------- AES-256-GCM (NIST SP 800-38D), 96-bit IV, 128-bit tag appended like WebCrypto ---------- */
function words(b) { var w = []; for (var i = 0; i < 16; i += 4) w.push(((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0); return w; }
function unwords(w) { var b = []; for (var i = 0; i < 4; i++) b.push((w[i] >>> 24) & 255, (w[i] >>> 16) & 255, (w[i] >>> 8) & 255, w[i] & 255); return b; }
// multiply in GF(2^128) with GCM's bit order (Algorithm 1)
function gmul(X, Y) {
  var Z0 = 0, Z1 = 0, Z2 = 0, Z3 = 0, V0 = Y[0], V1 = Y[1], V2 = Y[2], V3 = Y[3];
  for (var i = 0; i < 128; i++) {
    if ((X[i >>> 5] >>> (31 - (i & 31))) & 1) { Z0 ^= V0; Z1 ^= V1; Z2 ^= V2; Z3 ^= V3; }
    var lsb = V3 & 1;
    V3 = (V3 >>> 1) | ((V2 & 1) << 31); V2 = (V2 >>> 1) | ((V1 & 1) << 31); V1 = (V1 >>> 1) | ((V0 & 1) << 31); V0 = V0 >>> 1;
    if (lsb) V0 ^= 0xe1000000;
  }
  return [Z0 >>> 0, Z1 >>> 0, Z2 >>> 0, Z3 >>> 0];
}
function ghash(H, aad, ct) {
  var X = [0, 0, 0, 0];
  function absorb(bytes) {
    for (var off = 0; off < bytes.length; off += 16) {
      var blk = bytes.slice(off, off + 16); while (blk.length < 16) blk.push(0);
      var w = words(blk); X = gmul([(X[0] ^ w[0]) >>> 0, (X[1] ^ w[1]) >>> 0, (X[2] ^ w[2]) >>> 0, (X[3] ^ w[3]) >>> 0], H);
    }
  }
  absorb(aad); absorb(ct);
  var la = aad.length * 8, lc = ct.length * 8;
  var L = [Math.floor(la / 4294967296) >>> 0, la >>> 0, Math.floor(lc / 4294967296) >>> 0, lc >>> 0];
  X = gmul([(X[0] ^ L[0]) >>> 0, (X[1] ^ L[1]) >>> 0, (X[2] ^ L[2]) >>> 0, (X[3] ^ L[3]) >>> 0], H);
  return unwords(X);
}
function gcm(key, iv, pt, aad) {
  if (iv.length !== 12) throw new Error('GCM IV must be 12 bytes');
  var aes = new aesjs.AES(key), H = words(aes.encrypt([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  var J0 = iv.concat([0, 0, 0, 1]), ctr = J0.slice(), ct = new Array(pt.length);
  for (var off = 0; off < pt.length; off += 16) {
    for (var i = 15; i >= 12; i--) { ctr[i] = (ctr[i] + 1) & 255; if (ctr[i]) break; } // inc32
    var ks = aes.encrypt(ctr);
    for (var j = 0; j < 16 && off + j < pt.length; j++) ct[off + j] = pt[off + j] ^ ks[j];
  }
  var S = ghash(H, aad, ct), E = aes.encrypt(J0), tag = [];
  for (var t = 0; t < 16; t++) tag.push(E[t] ^ S[t]);
  return ct.concat(tag);
}

/* ---------- ECDH (P-256) ---------- */
function pubPoint(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('The office key is not a P-256 key');
  var Q = P256.point(hex(unb64(jwk.x)), hex(unb64(jwk.y)));
  if (!Q.validate()) throw new Error('The office key is not on the P-256 curve');
  return Q;
}
function ecdhX(privHex, jwk) { return pubPoint(jwk).mul(new BN(privHex, 16)).getX().toArray('be', 32); }
function pubOf(privHex) { var E = P256.g.mul(new BN(privHex, 16)); return { kty: 'EC', crv: 'P-256', x: b64url(E.getX().toArray('be', 32)), y: b64url(E.getY().toArray('be', 32)) }; }

/* sealTo(pub, bytes, info, rand) → { epk, iv, ct } — rand(n) must return n random bytes */
function sealTo(pub, bytes, info, rand) {
  var Q = pubPoint(pub), d;
  do { d = new BN(rand(32)); } while (d.isZero() || d.cmp(P256.n) >= 0);
  var E = P256.g.mul(d), z = Q.mul(d).getX().toArray('be', 32);
  var inf = utf8(info), key = hkdf(z, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], inf, 32), iv = rand(12);
  return {
    epk: { kty: 'EC', crv: 'P-256', x: b64url(E.getX().toArray('be', 32)), y: b64url(E.getY().toArray('be', 32)) },
    iv: b64(iv), ct: b64(gcm(key, iv, bytes, inf))
  };
}

module.exports = { sealTo: sealTo, utf8: utf8, b64: b64, b64url: b64url, unb64: unb64, hex: hex, unhex: unhex, sha256hex: sha256hex, hkdf: hkdf, gcm: gcm, ecdhX: ecdhX, pubOf: pubOf };
