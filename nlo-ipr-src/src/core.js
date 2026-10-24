'use strict';
/* =====================================================================
   NLO IPR Tracker 4 — interproximal reduction charting, on the NLO Cases
   platform (Amir, 23 Oct 2026: "if it has the same login as the patient
   tracker … can we just use the full name of the patients instead of
   having like initials?").
   - Same logins, office key and idle lock as NLO Cases. Every patient and
     every visit is sealed in the browser (AES-256-GCM, the office key)
     before it is saved; Firestore holds only ciphertext and a few plain
     fields that identify no one (backend.js).
   - Before 4.0 the records sat unencrypted in the nlo-inventory Realtime
     Database behind a Google sign-in, with initials only; move.js brings
     them over once (Dr. A), with each patient's full name from NLO Cases.
   ===================================================================== */

/* ---------- Firebase project (the NLO Cases project; build.py fills it in) ---------- */
const FB_CONFIG = {
  apiKey: "__API_KEY__",
  authDomain: "__AUTH_DOMAIN__",
  projectId: "__PROJECT_ID__",
  appId: "__APP_ID__"
};
/* the old IPR Tracker's database (read once by the move, then emptied by Dr. A's "Remove the old copy") */
const OLD_FB = {
  apiKey: "AIzaSyBFCmDgAKkdfZ4Cb81nK0KCKXtONiwMJy4",
  authDomain: "nlo-inventory.firebaseapp.com",
  databaseURL: "https://nlo-inventory-default-rtdb.firebaseio.com",
  projectId: "nlo-inventory",
  appId: "1:471691286148:web:b362a98186f648bd4914d1"
};
/* the old IPR Tracker, kept beside this one until the move (it sends everyone here once the records have moved) */
const OLD_URL = 'IPR_Tracker_old.html';
/* the shared rules (Dr. A's "publish the rules" card); build.py fills it in */
const IPR_RULES = "";
const APP_NAME = 'NLO IPR Tracker';
const KDF_ITER = 600000;

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
function firstName(n) { return String(n || '').replace(/^dr\.?\s+/i, '').split(/\s+/)[0] || ''; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-'); }
function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

/* ---------- patients: chart #s and names ---------- */
/* a chart # the way the IPR Tracker and NLO Cases' IPR link have always compared them: letters and digits only ("123-4567" = "1234567") */
const iprNorm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* NLO Cases' own (core.js there): spaces out, lower case — what its patient index keys a case's chart # by */
const normChart = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const normName = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
/* a name as it's shown: spaces tidied */
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
function nameInitials(name) { const p = cleanName(name).replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean); if (!p.length) return ''; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
/* does this name fit the initials an older record kept? The first letters match, and the last one is the start of a later part of
   the name: "JMD" fits "Jane Doe", "MSJ" fits "Mary Smith-Jones"; a name typed where the initials went ("JANE DOE") is compared
   by its own initials */
function fitsInitials(name, ini) {
  const parts = cleanName(name).replace(/[^\p{L}\s'-]/gu, '').split(/[\s-]+/).filter(Boolean).map(t => t[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
  let b = String(ini || '').trim(); if (/\s/.test(b)) b = nameInitials(b);
  b = b.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!b) return true; if (!parts.length) return false;
  return parts[0] === b[0] && (b.length === 1 || parts.slice(1).includes(b[b.length - 1]));
}

/* ---------- crypto (the same as NLO Cases) ---------- */
const TE = new TextEncoder(), TD = new TextDecoder();
function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), CH = 0x8000;
  let s = ''; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
const Crypto = {
  async pwKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', TE.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async seal(key, bytes, aad) {
    const iv = rnd(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, key, bytes);
    return { iv: b64(iv), ct: b64(ct) };
  },
  async open(key, box, aad) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: TE.encode(aad) }, key, unb64(box.ct));
    return new Uint8Array(pt);
  },
  async sealJSON(key, obj, aad) { return Crypto.seal(key, TE.encode(JSON.stringify(obj)), aad); },
  async openJSON(key, box, aad) { return JSON.parse(TD.decode(await Crypto.open(key, box, aad))); },
  async pwSeal(pw, bytes, aad, iter) {
    iter = iter || KDF_ITER; const salt = rnd(16);
    const k = await Crypto.pwKey(pw, salt, iter); const box = await Crypto.seal(k, bytes, aad);
    return { salt: b64(salt), iter, iv: box.iv, ct: box.ct };
  },
  async pwOpen(pw, box, aad) { const k = await Crypto.pwKey(pw, unb64(box.salt), box.iter || KDF_ITER); return Crypto.open(k, box, aad); },
  EC: { name: 'ECDH', namedCurve: 'P-256' },
  async newPair() { return crypto.subtle.generateKey(Crypto.EC, true, ['deriveBits']); },
  async pubJwk(pair) { const j = await crypto.subtle.exportKey('jwk', pair.publicKey); return { kty: j.kty, crv: j.crv, x: j.x, y: j.y }; },
  async privBytes(pair) { return new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)); },
  async importPriv(bytes) { return crypto.subtle.importKey('pkcs8', bytes, Crypto.EC, false, ['deriveBits']); },
  async boxKey(bits, info) {
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async sealTo(pub, bytes, info) {
    const pk = await crypto.subtle.importKey('jwk', { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, ext: true }, Crypto.EC, false, []);
    const eph = await Crypto.newPair();
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pk }, eph.privateKey, 256);
    const k = await Crypto.boxKey(bits, info); const box = await Crypto.seal(k, bytes, info);
    return { epk: await Crypto.pubJwk(eph), iv: box.iv, ct: box.ct };
  },
  async openFrom(priv, box, info) {
    const e = box.epk;
    const epk = await crypto.subtle.importKey('jwk', { kty: e.kty, crv: e.crv, x: e.x, y: e.y, ext: true }, Crypto.EC, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256);
    const k = await Crypto.boxKey(bits, info); return Crypto.open(k, box, info);
  },
  async ringKeys(ring) {
    const out = {};
    for (const v of Object.keys(ring)) out[v] = await crypto.subtle.importKey('raw', unb64(ring[v]), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return out;
  },
  ringBytes(ring) { return TE.encode(JSON.stringify(ring)); },
  ringFrom(bytes) { return JSON.parse(TD.decode(bytes)); },
  async sha256hex(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(s))), b => b.toString(16).padStart(2, '0')).join(''); }
};
/* the same JSON whatever order an object's keys came in (the old database hands them back sorted, the app writes them in
   tooth order): what the move's fingerprints and comparisons are made from */
function canonJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(canonJSON).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonJSON(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
