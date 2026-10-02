'use strict';
/* =====================================================================
   NLO Leads — encrypted new-lead tracker for Next Level Orthodontics
   - Same logins, office key and encryption as NLO Cases: every lead is
     sealed in the browser (AES-256-GCM) before it is stored; Firestore
     only holds ciphertext plus non-identifying flags.
   - Website requests arrive in a sealed inbox: the receiving service can
     lock a request to the office's intake PUBLIC key but cannot open it.
     Whoever is signed in opens it with the office key and files it as a lead.
   ===================================================================== */

/* ---------- Firebase project (same project as NLO Cases) ---------- */
const FB_CONFIG = {
  apiKey: "__API_KEY__",
  authDomain: "__AUTH_DOMAIN__",
  projectId: "__PROJECT_ID__",
  appId: "__APP_ID__"
};
/* Synthetic login addresses for staff usernames (no mail is ever sent to them). */
const STAFF_DOMAIN = 'staff.thenextlevelorthodontics.com';
const KDF_ITER = 600000;
const OFFICE_NAME = 'Next Level Orthodontics';

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid8() { return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join(''); }
function todayISO() { return isoOf(new Date()); }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return isoOf(dt); }
/* whole days from a to b (both YYYY-MM-DD); UTC maths so daylight-saving changes never skew it */
function daysBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); }
function dayDiff(iso) { if (!iso) return null; return daysBetween(todayISO(), iso); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); const opts = { month: 'short', day: 'numeric' }; if (y !== new Date().getFullYear()) opts.year = 'numeric'; return dt.toLocaleDateString(undefined, opts); }
function fmtDay(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
/* "9:30 AM" from "09:30" (what <input type=time> gives) */
function fmtClock(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return String(t || ''); const h = Number(m[1]); return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM'); }
function initials(name) { const p = String(name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
function firstName(n) { return String(n || '').replace(/^dr\.?\s+/i, '').split(/\s+/)[0] || ''; }
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
/* random characters without modulo bias (rejection sampling) */
function randChars(n) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', lim = 256 - (256 % A.length); let out = '';
  while (out.length < n) { for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) { if (b < lim && out.length < n) out += A[b % A.length]; } }
  return out;
}
function tempPassword() { return randChars(12).replace(/(.{4})(?=.)/g, '$1-'); }
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-'); }

/* ---------- office days (the office sees patients Monday–Thursday; handbook holidays are skipped) ---------- */
function officeHolidays(y) {
  const nth = (m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + (n - 1) * 7); return d; };
  const last = (m, wd) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - (d.getDay() - wd + 7) % 7); return d; };
  const thx = nth(10, 4, 4), near = k => { const d = new Date(thx); d.setDate(thx.getDate() + k); return d; };
  return [new Date(y, 0, 1), last(4, 1), new Date(y, 6, 4), nth(8, 1, 1), near(-1), thx, near(1), new Date(y, 11, 25)].map(isoOf);
}

/* ---------- crypto ---------- */
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
  /* key ring = { "1": base64(32 random bytes), "2": ... } */
  newRingKey() { return b64(rnd(32)); },
  async ringKeys(ring) {
    const out = {};
    for (const v of Object.keys(ring)) out[v] = await crypto.subtle.importKey('raw', unb64(ring[v]), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return out;
  },
  ringBytes(ring) { return TE.encode(JSON.stringify(ring)); },
  ringFrom(bytes) { return JSON.parse(TD.decode(bytes)); },
  async sha256hex(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(s))), b => b.toString(16).padStart(2, '0')).join(''); },
  /* a URL-safe random secret (43 characters = 256 bits) */
  newSecret() { return b64(rnd(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
};

/* ---------- CSV ---------- */
/* Minimal RFC-4180 CSV parser (quoted fields, embedded newlines, "" escapes). */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.replace(/^﻿/, '').trim());
  return rows.slice(1).filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}
/* spreadsheet-safe cell: a leading = + - @ (or tab/CR) would be run as a formula by Excel/Sheets */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
