'use strict';
/* =====================================================================
   Reading what the website form sends. Elementor's "Webhook" action posts
   form-encoded data — either flat ("Patient Name=…&Email=…") or, with
   "Advanced Data" on, fields[<id>][title|type|value] plus form[…] and
   meta[…]. JSON is read too. Every field is matched by its label and type;
   anything not recognised is kept under "extra", so nothing is lost.
   Pure functions: no network, no storage. Tested with made-up requests.
   ===================================================================== */
const LIMIT = { keys: 500, depth: 6, name: 120, email: 200, phone: 60, message: 4000, extraN: 20, extraK: 80, extraV: 500, raw: 8000, page: 300 };
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EMAIL_CHARS = /^[^\s@<>?&=%#/\\:;,"'()[\]]+@[^\s@<>?&=%#/\\:;,"'()[\].]+(\.[^\s@<>?&=%#/\\:;,"'()[\].]+)+$/;
const emailOk = s => typeof s === 'string' && s.length <= 254 && EMAIL_CHARS.test(s) && /\.[^.]{2,}$/.test(s);

/* ---------- body ---------- */
function dec(s) { s = String(s).replace(/\+/g, ' '); try { return decodeURIComponent(s); } catch (e) { return s; } }
/* "fields[name][value]" → ['fields', 'name', 'value'] */
function splitKey(k) {
  const m = String(k).match(/^([^[\]]*)((?:\[[^[\]]*\])*)$/);
  if (!m) return [String(k)];
  return [m[1]].concat(Array.from(m[2].matchAll(/\[([^[\]]*)\]/g), x => x[1])).slice(0, LIMIT.depth);
}
function setPath(obj, path, v) {
  if (path.some(p => BAD_KEYS.has(p))) return;
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i] === '' ? String(Object.keys(o).length) : path[i];
    if (typeof o[p] !== 'object' || o[p] === null) { if (o[p] != null && o[p] !== '') return; o[p] = Object.create(null); }
    o = o[p];
  }
  const last = path[path.length - 1] === '' ? String(Object.keys(o).length) : path[path.length - 1];
  if (typeof o[last] === 'object' && o[last] !== null) return;
  // a repeated key (a list of ticked boxes) keeps every value
  o[last] = o[last] != null && o[last] !== '' ? (v === '' ? o[last] : o[last] + ', ' + v) : v;
}
/* "a[]=x&a[]=y" made {0:'x',1:'y'}: turn such numbered objects into lists */
function arrayify(o) {
  if (!o || typeof o !== 'object') return o;
  Object.keys(o).forEach(k => { o[k] = arrayify(o[k]); });
  const ks = Object.keys(o);
  return ks.length && ks.every((k, i) => k === String(i)) ? ks.map(k => o[k]) : o;
}
function parseForm(text) {
  const out = Object.create(null); let n = 0;
  for (const part of String(text).split('&')) {
    if (!part) continue; if (++n > LIMIT.keys) break;
    const eq = part.indexOf('=');
    setPath(out, splitKey(dec(eq < 0 ? part : part.slice(0, eq))), eq < 0 ? '' : dec(part.slice(eq + 1)));
  }
  const r = arrayify(out);
  return Array.isArray(r) ? { fields: r } : r;
}
/* only plain objects, lists and text survive; no prototype keys; limited depth and size */
function sanitize(x, d) {
  if (d > LIMIT.depth) return '';
  if (Array.isArray(x)) return x.slice(0, 100).map(y => sanitize(y, d + 1));
  if (x && typeof x === 'object') { const o = Object.create(null); Object.keys(x).slice(0, LIMIT.keys).forEach(k => { if (!BAD_KEYS.has(k)) o[k] = sanitize(x[k], d + 1); }); return o; }
  if (x == null) return '';
  return typeof x === 'string' ? x : (typeof x === 'number' || typeof x === 'boolean') ? String(x) : '';
}
function parseBody(text, ctype) {
  text = String(text || '').replace(/^﻿/, '').trim();
  if (!text) return Object.create(null);
  if (/json/i.test(ctype || '') || /^[[{]/.test(text)) { try { const j = sanitize(JSON.parse(text), 0); return Array.isArray(j) ? { fields: j } : j; } catch (e) { /* not JSON after all */ } }
  return parseForm(text);
}

/* ---------- fields ---------- */
const META = /^(date|time|page[ _-]?url|page[ _-]?title|user[ _-]?agent|remote[ _-]?ip|ip|powered[ _-]?by|credit|form[ _-]?(id|name)|referr?er(_title)?|post[ _-]?id|queried[ _-]?id|_?wpnonce|action|test|g-recaptcha-response|h-captcha-response)$/i;
const SKIP_TYPES = new Set(['recaptcha', 'recaptcha_v3', 'hcaptcha', 'html', 'step', 'hidden_meta', 'submit', 'button']);
function flat(v, max) {
  max = max || 5000;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => flat(x, max)).filter(Boolean).join(', ').slice(0, max);
  if (v == null || typeof v === 'object') return '';
  return String(v).slice(0, max).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
}
/* every filled-in field as {key, title, type, value} */
function fieldsOf(body) {
  const out = [];
  const add = (key, title, type, value) => { const v = flat(value); if (v === '') return; const k = flat(key, 200); out.push({ key: k, title: flat(title, 200) || k, type: flat(type, 40).toLowerCase(), value: v }); };
  const f = body && body.fields;
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    Object.keys(f).forEach(k => {
      const x = f[k];
      if (x && typeof x === 'object' && !Array.isArray(x)) add(x.id || k, x.title || x.label || x.name || k, x.type, x.value != null && flat(x.value) !== '' ? x.value : x.raw_value);
      else add(k, k, '', x);
    });
  } else if (Array.isArray(f)) {
    f.forEach((x, i) => { if (x && typeof x === 'object') add(x.id || x.name || i, x.title || x.label || x.name || 'Field ' + (i + 1), x.type, x.value != null ? x.value : x.raw_value); });
  }
  if (!out.length && body) {
    Object.keys(body).forEach(k => {
      if (k === 'fields' || k === 'meta' || k === 'form' || META.test(k)) return;
      const v = body[k]; if (v && typeof v === 'object' && !Array.isArray(v)) return;
      add(k, k, '', v);
    });
  }
  return out;
}
function kindOf(f) {
  const t = f.type, k = (f.title + ' ' + f.key).toLowerCase().replace(/[_-]+/g, ' ');
  if (t === 'honeypot') return 'honeypot';
  if (SKIP_TYPES.has(t)) return 'skip';
  if (t === 'email' || /e ?mail/.test(k)) return 'email';
  if (t === 'tel' || /phone|mobile|\bcell\b|\btel\b|telephone/.test(k)) return 'phone';
  if (/parent|guardian|mother|father|\bmom\b|\bdad\b|responsible party/.test(k)) return 'parent';
  if (/first ?name|\bfname\b|given name/.test(k)) return 'first';
  if (/last ?name|\blname\b|surname|family name/.test(k)) return 'last';
  if (/patient|child|student|\bname\b/.test(k)) return 'name';
  if (t === 'textarea' || /message|comment|question|note|detail|reason|concern|help|tell us|anything else|inquiry|enquiry/.test(k)) return 'message';
  return 'extra';
}
const digitsOf = s => String(s || '').replace(/\D/g, '');
const phoneOk = s => { let d = digitsOf(s); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10; };
const looksPhone = s => /^[\d\s().+\-]{7,25}$/.test(s) && digitsOf(s).length >= 10 && digitsOf(s).length <= 11;
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|xyz|info|biz|top|io|co)\b/i;
const clip = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) : s; };
function properName(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s || (/[a-z]/.test(s) && /[A-Z]/.test(s))) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’.])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

/* the request → what the app needs: name, parent, email, phone, message, extra{}, page, flags[{k,why}], raw, test */
function mapFields(body) {
  body = body || {};
  const fields = fieldsOf(body);
  const r = { name: '', parent: '', email: '', phone: '', message: '', extra: {}, page: '', flags: [], raw: '', test: false };
  const parts = { name: [], first: [], last: [], parent: [], msg: [] };
  let honey = false; const extras = [];
  fields.forEach(f => {
    const k = kindOf(f), v = f.value;
    if (k === 'skip') return;
    if (k === 'honeypot') { honey = true; return; }
    if (k === 'email') { if (!emailOk(r.email) && (emailOk(v) || !r.email)) { if (r.email) extras.push({ title: 'Email (other)', value: r.email }); r.email = v; } else extras.push(f); return; }
    if (k === 'phone') { if (!r.phone || (!phoneOk(r.phone) && phoneOk(v))) { if (r.phone) extras.push({ title: 'Phone (other)', value: r.phone }); r.phone = v; } else extras.push(f); return; }
    if (k === 'message') { parts.msg.push(f); return; }
    if (k === 'extra') { extras.push(f); return; }
    if (k === 'name') { parts.name.push(f); return; }
    parts[k].push(v);
  });
  if (parts.name.length) {
    // two name boxes ("Child's name", "Your name"): the patient's is the one saying so, the other is the parent's
    const pat = parts.name.find(f => /patient|child|student/i.test(f.title + ' ' + f.key)) || parts.name[0];
    r.name = pat.value;
    const rest = parts.name.filter(f => f !== pat);
    if (rest.length && !parts.parent.length) parts.parent.push(rest.shift().value);
    rest.forEach(f => extras.push(f));
    if (parts.first.length || parts.last.length) extras.push({ title: 'Name parts', value: parts.first.concat(parts.last).join(' ') });
  } else r.name = [parts.first.join(' '), parts.last.join(' ')].filter(Boolean).join(' ');
  r.parent = parts.parent.join(' ');
  r.message = parts.msg.length === 1 ? parts.msg[0].value : parts.msg.map(f => f.title + ': ' + f.value).join('\n');
  // nothing labelled the usual way: pick out an email, a phone number and up to two names from what's there
  if (!r.email || !r.phone || (!r.name && !r.parent)) {
    for (let i = 0; i < extras.length; i++) {
      const v = extras[i].value;
      if (!r.email && emailOk(v)) { r.email = v; extras.splice(i--, 1); }
      else if (!r.phone && looksPhone(v)) { r.phone = v; extras.splice(i--, 1); }
    }
    if (!r.name && !r.parent) {
      const names = extras.filter(f => /^[\p{L}'’.\- ]{2,60}$/u.test(f.value) && f.value.split(/\s+/).length <= 5);
      if (names[0]) { r.name = names[0].value; extras.splice(extras.indexOf(names[0]), 1); }
      if (names[1]) { r.parent = names[1].value; extras.splice(extras.indexOf(names[1]), 1); }
    }
  }
  const used = {};
  extras.slice(0, LIMIT.extraN).forEach(f => { let t = clip(f.title, LIMIT.extraK) || 'Field'; if (used[t]) t = clip(t, LIMIT.extraK - 4) + ' (' + (++used[t]) + ')'; else used[t] = 1; r.extra[t] = clip(f.value, LIMIT.extraV); });
  r.name = properName(clip(r.name, LIMIT.name)); r.parent = properName(clip(r.parent, LIMIT.name));
  r.email = clip(r.email, LIMIT.email); r.phone = clip(r.phone, LIMIT.phone); r.message = clip(r.message, LIMIT.message);
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const pg = meta.page_url && typeof meta.page_url === 'object' ? meta.page_url.value : meta.page_url;
  r.page = clip(flat(pg || body['Page URL'] || body.page_url || body.page || body.referrer || body.referer || ''), LIMIT.page);
  r.test = /^(true|1|yes)$/i.test(flat(body.test));
  r.raw = clip(fields.map(f => f.title + ': ' + f.value).join('\n'), LIMIT.raw);
  // reasons to have someone look before the follow-up starts
  const F = (k, why) => r.flags.push({ k, why });
  if (r.test) F('test', 'Test request sent from the app’s settings');
  if (honey) F('spam', 'The form’s hidden anti-spam box was filled in');
  if (LINK.test(r.name) || LINK.test(r.parent)) F('spam', 'Web link in the name');
  if ((r.message.match(/https?:\/\/|www\./gi) || []).length >= 3) F('spam', 'Several web links in the message');
  if (!fields.length) F('check', 'The form’s fields couldn’t be read — see the original');
  else {
    if (!phoneOk(r.phone) && !emailOk(r.email)) F('check', 'No working phone number or email');
    if (!r.name && !r.parent) F('check', 'No name');
    else if (/\d/.test(r.name + r.parent) || r.name.length > 60) F('check', 'The name looks odd');
  }
  return r;
}

module.exports = { parseBody, parseForm, fieldsOf, mapFields, kindOf, LIMIT };
