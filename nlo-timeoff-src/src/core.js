'use strict';
/* =====================================================================
   NLO Time Off — time-off requests, approvals, vacation and sick
   balances, and staff benefits, in one place.
   - Same logins as NLO Cases, NLO Leads and NLO A/R (same Firebase
     project, same usernames and passwords).
   - Requests are sealed in the browser before they're saved: one copy
     for the person who asked (sealed to their own key) and one for the
     people who approve (sealed to the HR key). The database only ever
     holds ciphertext plus who it belongs to and its status.
   - Balances aren't stored numbers a script overwrites: they're worked
     out from the policy, the person's hire date and their approved time
     off (policy.js), the same way on every screen.
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
const APP_NAME = 'NLO Time Off';

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid8() { return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join(''); }
function hexId(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join(''); }
function todayISO() { return isoOf(new Date()); }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseISO(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(iso, n) { const dt = parseISO(iso); dt.setDate(dt.getDate() + n); return isoOf(dt); }
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number), last = new Date(y, m - 1 + n + 1, 0).getDate();
  return isoOf(new Date(y, m - 1 + n, Math.min(d, last)));
}
function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(parseISO(s)) === s; }
/* whole days from a to b (both YYYY-MM-DD); UTC maths so daylight-saving changes never skew it */
function daysBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); }
function dayDiff(iso) { if (!iso) return null; return daysBetween(todayISO(), iso); }
function weekday(iso) { return parseISO(iso).getDay(); }
function lastOfMonth(iso) { const [y, m] = iso.split('-').map(Number); return isoOf(new Date(y, m, 0)); }
function isLastOfMonth(iso) { return lastOfMonth(iso) === iso; }
/* the office's time zone: a request's first day starts at midnight in Gainesville, whatever clock the device is on */
const OFFICE_TZ = 'America/New_York';
const TZ_FMT = new Intl.DateTimeFormat('en-US', { timeZone: OFFICE_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function tzParts(ms) { const o = {}; TZ_FMT.formatToParts(new Date(ms)).forEach(x => { o[x.type] = x.value; }); return o; }
/* midnight at the office on a day, in ms (the rules let someone cancel approved time off only before it starts) */
function dayStartMs(iso) {
  const [y, m, d] = iso.split('-').map(Number), t = Date.UTC(y, m - 1, d, 5); // midnight in winter (UTC−5)
  return t - Number(tzParts(t).hour) * 3600000;                           // an hour earlier in summer (UTC−4)
}
/* the office's date at a moment */
function isoOfMs(ms) {
  if (typeof ms !== 'number' || !(ms > 946684800000 && ms < 4102444800000)) return ''; // 2000 to 2100, or it isn't a day here
  const o = tzParts(ms); return o.year + '-' + o.month + '-' + o.day;
}
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); const opts = { month: 'short', day: 'numeric' }; if (y !== new Date().getFullYear()) opts.year = 'numeric'; return dt.toLocaleDateString('en-US', opts); }
function fmtDateLong(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
function fmtDay(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtDayY(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const o = { weekday: 'short', month: 'short', day: 'numeric' }; if (y !== new Date().getFullYear()) o.year = 'numeric'; return new Date(y, m - 1, d).toLocaleDateString('en-US', o); }
function fmtMonth(iso) { const [y, m] = iso.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function fmtAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
}
/* a range of days, short: "Oct 26 – 29", "Oct 30 – Nov 2", "Mon, Oct 26" */
function fmtRange(a, b) {
  if (!b || a === b) return fmtDay(a);
  const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number), cy = new Date().getFullYear();
  if (y1 === y2 && m1 === m2) return parseISO(a).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + Number(b.slice(8)) + (y1 !== cy ? ', ' + y1 : '');
  return fmtDate(a) + ' – ' + fmtDate(b);
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
/* hours on screen: 34, 4.25, 2.83 (at most two decimals, none when whole) */
function hrs(n) { const r = round2(n); return (Object.is(r, -0) ? 0 : r).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function initials(name) { const p = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/^dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
function firstName(n) { return String(n || '').replace(/^dr\.?\s+/i, '').split(/\s+/)[0] || ''; }
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
/* a request's sealed content makes sense (anything else is treated like one that can't be opened) */
function okContent(c) {
  return !!c && typeof c === 'object' && isISO(c.start) && isISO(c.end) && c.end >= c.start && daysBetween(c.start, c.end) <= 366
    && typeof c.type === 'string' && c.type.length <= 20 && (c.part == null || typeof c.part === 'string')
    && ['note', 'cover'].every(k => c[k] == null || (typeof c[k] === 'string' && c[k].length <= 5000))
    && (c.events == null || Array.isArray(c.events));
}
function money(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }

/* ---------- crypto (the same sealing as NLO Cases, Leads and A/R) ---------- */
const TE = new TextEncoder(), TD = new TextDecoder();
function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), CH = 0x8000;
  let s = ''; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function b64url(buf) { return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
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
  /* the public half of a private key (its x and y), to check it against the key a login's record names */
  async pubOfPriv(bytes) { const j = await crypto.subtle.exportKey('jwk', await crypto.subtle.importKey('pkcs8', bytes, Crypto.EC, true, ['deriveBits'])); return { x: j.x, y: j.y }; },
  async boxKey(bits, info) {
    const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: TE.encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  /* sealed to a public key: only the holder of its private half can open it */
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
  async sealJSONTo(pub, obj, info) { return Crypto.sealTo(pub, TE.encode(JSON.stringify(obj)), info); },
  async openJSONFrom(priv, box, info) { return JSON.parse(TD.decode(await Crypto.openFrom(priv, box, info))); },
  /* key ring = { "1": base64(32 random bytes), "2": ... } */
  newRingKey() { return b64(rnd(32)); },
  async ringKeys(ring) {
    const out = {};
    for (const v of Object.keys(ring)) out[v] = await crypto.subtle.importKey('raw', unb64(ring[v]), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return out;
  },
  async rawKey(b64key) { return crypto.subtle.importKey('raw', unb64(b64key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); },
  ringBytes(ring) { return TE.encode(JSON.stringify(ring)); },
  ringFrom(bytes) { return JSON.parse(TD.decode(bytes)); },
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
