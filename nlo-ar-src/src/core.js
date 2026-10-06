'use strict';
/* =====================================================================
   NLO A/R — past-due accounts, insurance that hasn't paid, and credit
   balances, worked from Edge's Accounts Receivable Aging report.
   - Same logins as NLO Cases and NLO Leads (same Firebase project).
   - A/R has its own key, given only to the people Dr. A picks: every
     report and every note is sealed in the browser (AES-256-GCM) before
     it is stored, so the database only ever holds ciphertext.
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
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); const opts = { month: 'short', day: 'numeric' }; if (y !== new Date().getFullYear()) opts.year = 'numeric'; return dt.toLocaleDateString('en-US', opts); }
function fmtDateLong(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
function fmtDay(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function fmtAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
}
/* $1,234 / $1,234.56 (cents only when asked) */
function money(n, cents) {
  if (n == null || !isFinite(n)) return '—';
  const neg = n < 0, a = Math.abs(n);
  const s = cents ? a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(a).toLocaleString('en-US');
  return (neg ? '−$' : '$') + s;
}
function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function initials(name) { const p = String(name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
function firstName(n) { return String(n || '').replace(/^dr\.?\s+/i, '').split(/\s+/)[0] || ''; }
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

/* ---------- office days (the office sees patients Monday–Thursday; handbook holidays are skipped) ---------- */
function officeHolidays(y) {
  const nth = (m, wd, n) => { const d = new Date(y, m, 1); d.setDate(1 + (wd - d.getDay() + 7) % 7 + (n - 1) * 7); return d; };
  const last = (m, wd) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - (d.getDay() - wd + 7) % 7); return d; };
  const thx = nth(10, 4, 4), near = k => { const d = new Date(thx); d.setDate(thx.getDate() + k); return d; };
  return [new Date(y, 0, 1), last(4, 1), new Date(y, 6, 4), nth(8, 1, 1), near(-1), thx, near(1), new Date(y, 11, 25)].map(isoOf);
}
const OFFICE_DAYS = [1, 2, 3, 4];
/* the first office day on or after iso */
function nextOfficeDay(iso) {
  let d = iso;
  for (let i = 0; i < 30; i++) {
    const [y, m, dd] = d.split('-').map(Number), wd = new Date(y, m - 1, dd).getDay();
    if (OFFICE_DAYS.includes(wd) && !officeHolidays(y).includes(d)) return d;
    d = addDays(d, 1);
  }
  return iso;
}

/* ---------- crypto ---------- */
const TE = new TextEncoder(), TD = new TextDecoder();
function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), CH = 0x8000;
  let s = ''; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function b64url(buf) { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
/* gzip (the browser's own CompressionStream) — reports compress to a fraction of their size before sealing */
async function streamBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
async function gzip(bytes) { return streamBytes(bytes, new CompressionStream('gzip')); }
async function gunzip(bytes) { return streamBytes(bytes, new DecompressionStream('gzip')); }
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
  /* a whole report: JSON → gzip → AES-GCM */
  async sealBig(key, obj, aad) { return Crypto.seal(key, await gzip(TE.encode(JSON.stringify(obj))), aad); },
  async openBig(key, box, aad) { return JSON.parse(TD.decode(await gunzip(await Crypto.open(key, box, aad)))); },
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
  /* the key that turns an account into its document id: from the FIRST A/R key, so ids never change when the key does */
  async idxKey(ring) {
    const hk = await crypto.subtle.importKey('raw', unb64(ring['1']), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode('nlo-ar-index') }, hk, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  },
  async hmac(key, s) { return new Uint8Array(await crypto.subtle.sign('HMAC', key, TE.encode(s))); },
  async sha256hex(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(s))), b => b.toString(16).padStart(2, '0')).join(''); }
};
function recoveryCodeNorm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-'); }

/* ---------- CSV out ---------- */
/* spreadsheet-safe cell: a leading = + - @ (or tab/CR) would be run as a formula by Excel/Sheets */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
