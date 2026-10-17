'use strict';
/* =====================================================================
   NLO Inventory — supplies, the cart, orders, receiving and the supply
   budget for Next Level Orthodontics.
   - Since 5.0 (Oct 2026) it lives on the NLO Cases platform: the same
     Firebase project (nlo-cases, Firestore), the same logins and roster,
     and the same lock after the office's idle minutes as NLO Cases,
     Time Off and the Time Clock. Every step is stamped with the person
     signed in and the time.
   - Its records moved over once from its own Realtime Database
     (nlo-inventory, nlo/*), which the alert script keeps a copy of for
     Staff Meeting's spending card and AISA's stock answers.
   ===================================================================== */

const APP_VERSION = '5.0.1';
const APP_NAME = 'NLO Inventory';
const DEMO_ONLY = false;          // the demo page sets this (build.py)
const LOGO = 'logo-white.png';     // the demo page carries the logo inside it
/* the NLO Cases project's web config (public by design; the database's rules decide who reads and writes what). build.py fills it in. */
const FB_CONFIG = {
  apiKey: "__API_KEY__",
  authDomain: "__AUTH_DOMAIN__",
  projectId: "__PROJECT_ID__",
  appId: "__APP_ID__"
};
/* the old Inventory's project (nlo-inventory), only for the one-time move: the same web config the IPR Tracker, NLO Cases and
   Time Off use for the office roster (a second sign-in named 'ipr', shared by those pages on this site) */
const OLD_FB = {
  apiKey: 'AIzaSyBFCmDgAKkdfZ4Cb81nK0KCKXtONiwMJy4',
  authDomain: 'nlo-inventory.firebaseapp.com',
  databaseURL: 'https://nlo-inventory-default-rtdb.firebaseio.com',
  projectId: 'nlo-inventory'
};
const OLD_URL = 'https://nlo-inventory.web.app';
const APPS_HOME = 'https://amooloo.github.io/nlo-apps/';
const APP_URL = 'https://amooloo.github.io/nlo-apps/nlo-inventory.html';
const SCRIPT_FILE = 'nlo-inventory-alerts.gs';   // the alert script, published beside the page (Settings → Email alerts fills in its login)
const ALERT_SCRIPT_URL = 'https://script.google.com/home/projects/1wwUm4vUhGrabEA4LGRFfvk4NxjH7r9_GtozvrQNCYrZ66spTrWSckdNw/edit';
/* synthetic login addresses (no mail is ever sent to them), as NLO Cases issues them */
const STAFF_DOMAIN = 'staff.thenextlevelorthodontics.com';
const INV_RULES = ""; // the build puts the office's whole Firestore rules file here (Dr. A's "publish the rules" card)
const IDLE_GRACE_MS = 120000;     // a save still on its way holds the lock off this much longer, no more
const IDLE_MIN = 10;               // the lock after this many minutes without activity, unless NLO Cases sets another (meta/settings.idleMin)

/* ---------- app state ---------- */
const S = {
  demo: false, emu: false, inApp: false, gate: 'opening', view: 'home', q: '', people: [], online: true, loadErr: '', cases: {}, lastAct: Date.now(), idleTimer: null, lastLogin: '',
  D: { items: [], orders: [], vendors: [], log: [], cart: [], cartOk: {}, bracketOrder: {}, budget: { monthly: 8000, categories: {}, history: [] }, expenses: [], elastoPrices: {}, roster: null },
  loaded: {}, denied: {}, settings: {}, ui: {}, drawer: null, renderQ: false, imgCache: new Map(), moved: null
};
/* the backend in use (FB, on the real or the demo database) and the screens' registries: clicks (data-act), changes (data-chg),
   typing (data-inp), screens and drawers. Declared first, since every file adds to them. */
let B = null;
const ACT = {}, CHG = {}, INP = {}, VIEWS = {}, DRAWERS = {};

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
/* same id shape as the old app's uid(), so ids sort roughly by time either way */
function uid() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 6); }
function num(v, d) { const n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
function round2(v) { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function money(n, opt) {
  const v = Number(n) || 0, neg = v < 0, a = Math.abs(v);
  const s = a.toLocaleString('en-US', { minimumFractionDigits: opt && opt.whole ? 0 : 2, maximumFractionDigits: opt && opt.whole ? 0 : 2 });
  return (neg ? '−$' : '$') + s;
}
function moneyK(n) { const v = Math.abs(Number(n) || 0); return (n < 0 ? '−' : '') + (v >= 10000 ? '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : money(v, { whole: true })); }
function qtyFmt(n) { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100); }
function initials(name) { const p = String(name || '').replace(/^dr\.?\s+/i, 'Dr ').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; if (/^dr$/i.test(p[0]) && p.length > 1) return 'D' + (p[1][0] || '').toUpperCase(); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function firstName(n) { return String(n || '').replace(/^dr\.?\s+/i, '').split(/\s+/)[0] || ''; }
function plainText(s, max) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return max && s.length > max ? s.slice(0, max - 1) + '…' : s; }
function hexId(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join(''); }
/* a web address that's safe to open from a link (http or https only), else '' */
function webUrl(u) { u = String(u == null ? '' : u).trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
/* a long random password for a login only a script uses */
function randomPassword() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(28)), b => a[b % a.length]).join(''); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function debounce(fn, ms) { let t; return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, a), ms); }; }
/* Firebase refuses a whole write when any field is undefined; a JSON round trip drops them */
function fbSafe(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
/* a Firebase key can't hold . # $ / [ ] */
function fbKey(s) { return String(s).replace(/[.#$\/\[\]]/g, '_'); }
/* Firebase stores arrays as objects with number keys, and drops empty ones */
function listOf(v) { if (!v) return []; if (Array.isArray(v)) return v.filter(x => x != null); if (typeof v === 'object') return Object.keys(v).map(k => v[k]).filter(x => x != null); return []; }

/* ---------- dates ----------
   Dates the app writes:
   - day-only fields (an order's dateOrdered, an expense's date): 'YYYY-MM-DD' on this computer's calendar
   - moments (dateReceived, addedAt, log dates, stamps): ISO strings
   Bare 'YYYY-MM-DD' strings are read at local noon, so they never slip to the day before. */
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function todayISO() { return isoOf(new Date()); }
function nowISO() { return new Date().toISOString(); }
function parseDateLocal(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T12:00:00');
  return new Date(d);
}
function validDate(d) { return d instanceof Date && !isNaN(d.getTime()); }
function msOf(d) { if (!d) return 0; if (typeof d === 'number') return d; const x = parseDateLocal(d); return validDate(x) ? x.getTime() : 0; }
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return isoOf(dt); }
function daysBetween(a, b) { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); }
function dayOf(v) { const ms = msOf(v); return ms ? isoOf(new Date(ms)) : ''; }
/* "Oct 13" (adds the year when it isn't this year) */
function fmtDate(v) {
  const ms = msOf(v); if (!ms) return '';
  const d = new Date(ms), o = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('en-US', o);
}
/* "Tue, Oct 13" */
function fmtDay(v) { const ms = msOf(v); if (!ms) return ''; const d = new Date(ms); const o = { weekday: 'short', month: 'short', day: 'numeric' }; if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric'; return d.toLocaleDateString('en-US', o); }
function fmtClock(v) { const ms = msOf(v); return ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; }
/* the stamp people read on a cart line or an order step: "Today 9:41 AM", "Yesterday 3:05 PM", "Tue, Oct 13 · 9:41 AM" */
function fmtWhen(v) {
  const ms = msOf(v); if (!ms) return '';
  const day = isoOf(new Date(ms)), t = todayISO();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return day === t ? 'Today' : day === addDays(t, -1) ? 'Yesterday' : fmtDay(v);
  if (day === t) return 'Today ' + fmtClock(ms);
  if (day === addDays(t, -1)) return 'Yesterday ' + fmtClock(ms);
  return fmtDay(ms) + ' · ' + fmtClock(ms);
}
/* "just now", "12 min ago", "3 h ago", "2 days ago", then the date */
function fmtAgo(v) {
  const ms = msOf(v); if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  const days = daysBetween(dayOf(ms), todayISO());
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  return fmtDate(ms);
}
function daysAgo(v) { const ms = msOf(v); return ms ? daysBetween(dayOf(ms), todayISO()) : null; }
function monthKey(v) { const ms = msOf(v); if (!ms) return ''; const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function monthLabel(key, long) { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 15).toLocaleDateString('en-US', long ? { month: 'long', year: 'numeric' } : { month: 'short' }); }
function monthStart(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1, 0, 0, 0, 0); }
function monthEnd(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0, 23, 59, 59, 999); }
function shiftMonth(key, n) { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

/* ---------- search ----------
   Wire sizes match however they're typed: ".016×.022", ".016x.022", "016 x 022" and "16x22" all become "16x22"; ".016" and "016" become "16". */
function normSearch(s) {
  return String(s || '').toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\.?0*(\d{2})\s*x\s*\.?0*(\d{2})/g, '$1x$2')
    .replace(/\.0+(\d{2})\b/g, '$1')
    .replace(/\b0+(\d{2})\b/g, '$1');
}
function matchesAll(text, q) { const t = normSearch(text); return normSearch(q).split(/\s+/).filter(Boolean).every(w => t.includes(w)); }

/* ---------- names ---------- */
const UNIT_PLURALS = { box: 'boxes', case: 'cases', pack: 'packs', pkg: 'pkgs', bag: 'bags', bottle: 'bottles', roll: 'rolls', set: 'sets', tube: 'tubes', jug: 'jugs', kit: 'kits', each: 'each', ea: 'ea', carton: 'cartons', canister: 'canisters', container: 'containers', syringe: 'syringes', pouch: 'pouches', sleeve: 'sleeves', sheet: 'sheets', bracket: 'brackets', wire: 'wires', strip: 'strips', disc: 'discs', cartridge: 'cartridges', tip: 'tips', unit: 'units', gallon: 'gallons', bundle: 'bundles', pair: 'pairs', spool: 'spools', vial: 'vials', can: 'cans', cup: 'cups', jar: 'jars', pad: 'pads', piece: 'pieces', pc: 'pcs', dozen: 'dozen' };
function unitWord(u, n) {
  u = String(u || 'ea').trim(); const low = u.toLowerCase();
  if (Number(n) === 1) return u;
  if (UNIT_PLURALS[low]) return UNIT_PLURALS[low];
  if (/s$/i.test(u)) return u;
  return u + 's';
}
function qtyUnit(n, u) { return qtyFmt(n) + ' ' + unitWord(u, n); }

function dataUrlToBlob(d) {
  const m = String(d).match(/^data:([^;,]+)(;base64)?,/); const body = String(d).slice(String(d).indexOf(',') + 1);
  const bin = m && m[2] ? atob(body) : decodeURIComponent(body); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: m ? m[1] : 'application/octet-stream' });
}
