'use strict';
/* =====================================================================
   NLO Time Clock — clocking in and out, overtime heads-ups and the
   office's boundaries, on the NLO Cases platform (same Firebase
   project, same logins, same staff list).
   - At the office: the time-clock computer (its own login, set up by
     Dr. A on that computer). Tap your photo, type your PIN, punch.
     With the office lock on, also on their own phone or computer, but
     only on the office's internet (the office check, a small
     Cloudflare Worker, tells the database where a login is).
   - From home: only on a laptop Dr. A approved, for the people he
     picked (with their PIN): clock in and out, marked Home.
   - Every punch takes the server's time and is never changed: a
     correction is a new record (who, when, why), so the original
     always shows.
   - Alerts (email and phone push) come from a small Google Apps Script
     with its own login (Time Clock → Alerts).
   ===================================================================== */

/* ---------- Firebase project (the same one as NLO Cases and Time Off) ---------- */
const FB_CONFIG = {
  apiKey: "__API_KEY__",
  authDomain: "__AUTH_DOMAIN__",
  projectId: "__PROJECT_ID__",
  appId: "__APP_ID__"
};
/* Synthetic login addresses (no mail is ever sent to them): staff usernames, the time-clock computers, the alert script */
const STAFF_DOMAIN = 'staff.thenextlevelorthodontics.com';
const APP_NAME = 'NLO Time Clock';
const APP_URL = 'https://amooloo.github.io/nlo-apps/nlo-timeclock.html';
const SCRIPT_FILE = 'nlo-timeclock-alerts.gs';
const CHECK_FILE = 'nlo-timeclock-check.js'; // the office check (a Cloudflare Worker), published beside the page

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hexId(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join(''); }
function errCode(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
function firstName(n) { return String(n || '').trim().replace(/^dr(\.\s*|\s+)/i, '').split(/\s+/)[0] || ''; }
function initials(name) {
  const p = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/^dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
const TE = new TextEncoder();
async function sha256hex(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode(s))), b => b.toString(16).padStart(2, '0')).join(''); }
/* a PIN's hash, as the rules compare it (nobody can read the stored one) */
function pinHash(sid, pin) { return sha256hex('nlo-tc-pin|' + sid + '|' + pin); }
function okPin(pin) { return /^\d{4}$/.test(String(pin || '')); }
/* PINs nobody should use: one digit four times, or a straight run */
function weakPin(pin) { return /^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin); }
/* a 4-digit starter PIN that isn't a weak one */
function randomPin() { for (;;) { const p = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0'); if (!weakPin(p)) return p; } }
/* a long random password for a login only a script or a time-clock computer uses */
function randomPassword() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(28)), b => a[b % a.length]).join(''); }
/* a whole number from 0 to n - 1, evenly */
function randInt(n) { const a = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n; do { crypto.getRandomValues(a); } while (a[0] >= lim); return a[0] % n; }
/* this browser in a few words, for Dr. A to recognize a laptop asking to be approved ("Chrome on Windows") */
function devText(ua) {
  ua = String(ua == null ? (typeof navigator !== 'undefined' ? navigator.userAgent : '') : ua);
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'a Chromebook' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'a Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return (br + (os ? ' on ' + os : '')).slice(0, 80);
}
/* an ntfy topic nobody can guess */
function newTopic() { return 'nlo-clock-' + hexId(10); }
/* a save that doesn't answer in time: rejected with code 'timeout' (the save itself may still go through later) */
function withTimeout(p, ms) { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(errCode('timeout', 'No answer from the server.')), ms); })]).finally(() => clearTimeout(t)); }
function okEmail(s) { return /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(String(s || '').trim()); }

/* ---------- CSV ---------- */
/* spreadsheet-safe cell: a leading = + - @ (or tab/CR) would be run as a formula by Excel/Sheets */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function csvOf(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
function download(name, text, type) {
  const blob = new Blob(['﻿' + text], { type: type || 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { } ta.remove(); return ok;
  }
}

/* ---------- time at the office (the engine does the arithmetic; these are for forms) ---------- */
/* 'HH:MM' at the office for a moment (for a time box) */
function hmOf(ms) { const p = TCE.parts(ms); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); }
/* a short "Thu 2:40 PM" / "2:40 PM" (today) */
function whenText(ms, now) { return (TCE.dayOf(ms) === TCE.dayOf(now) ? '' : TCE.dayText(TCE.dayOf(ms)) + ', ') + TCE.timeText(ms); }
function agoText(ms, now) {
  const m = Math.round((now - ms) / 60000);
  if (m < 2) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
}
/* hours for a table: "38.5" (two decimals at most) */
function hNum(ms) { const v = TCE.h2(ms); return String(Object.is(v, -0) ? 0 : v); }
