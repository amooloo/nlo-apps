'use strict';
/* =====================================================================
   NLO Cases — encrypted case tracker for Next Level Orthodontics
   - Every case is encrypted in the browser (AES-256-GCM) before it is
     stored; Firestore only holds ciphertext plus non-identifying flags.
   - Each person has their own login. The office key ring is sealed to
     each person's own key pair (ECDH P-256), whose private half is
     sealed with a key derived from their password (PBKDF2-SHA256 600k).
   - Removing someone deactivates them (rules cut access at once) and
     rotates the office key so later data is under a key they never had.
   ===================================================================== */

/* ---------- Firebase project (filled in after the project is created) ---------- */
const FB_CONFIG = {
  apiKey: "__API_KEY__",
  authDomain: "__AUTH_DOMAIN__",
  projectId: "__PROJECT_ID__",
  appId: "__APP_ID__"
};
/* Synthetic login addresses for staff usernames (no mail is ever sent to them). */
const STAFF_DOMAIN = 'staff.thenextlevelorthodontics.com';
const KDF_ITER = 600000;

/* ---------- Case types and the stages each one moves through ---------- */
const FLOWS = {
  outside: { label: 'Outside aligners & braces', stages: [
    ['submit', 'To submit'], ['dra', 'Dr. A action'], ['mfg', 'Manufacturing'],
    ['shipped', 'Shipped'], ['arrived', 'Arrived'], ['milestones', 'Checked into Milestones'] ] },
  appliance: { label: 'Appliances', stages: [
    ['submit', 'To submit'], ['hold', 'Hold (CBCT/Zoom)'], ['submitted', 'Submitted to lab'],
    ['mfg', 'Manufacturing'], ['shipped', 'Shipped'], ['milestones', 'Checked into Milestones'] ] },
  inhouse: { label: 'In-house lab', stages: [
    ['txp', 'TxP needed'], ['reset', 'Reset needed in 2 days'], ['fab', 'In fabrication'],
    ['pack', 'Made – needs packaging'], ['checkedin', 'Checked in'] ] },
  retainer: { label: 'Retainers & mouthguards', stages: [
    ['print', 'Printing'], ['milestones', 'Milestones'], ['sarah', 'On Sarah’s desk'], ['pickup', 'Front desk pickup'] ] },
  retreat: { label: 'Retreatment', stages: [
    ['intake', 'Intake & assessment'], ['review', 'Pending review'], ['proposal', 'Send proposal'],
    ['progress', 'In progress'], ['completed', 'Completed'] ] },
  misc: { label: 'Dr. A (misc.)', stages: [ ['todo', 'To do'], ['waiting', 'Waiting'] ] }
};
const TYPES = [
  { k: 'oliv', l: 'Oliv', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'angel', l: 'Angel Aligners', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'invisalign', l: 'Invisalign', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'ulab', l: 'uLab', flow: 'outside', cls: 't-aligner', aligner: true },
  { k: 'insmile', l: 'InSmile', flow: 'outside', cls: 't-aligner' },
  /* legacy: no longer offered for new cases (Amir, 1 Oct 2026); kept so imported or older InBrace cases still open and edit */
  { k: 'inbrace', l: 'InBrace', flow: 'outside', cls: 't-aligner', legacy: true },
  { k: 'nla', l: 'In-house aligners', flow: 'inhouse', cls: 't-lab', aligner: true },
  { k: 'appliance', l: 'Appliance', flow: 'appliance', cls: 't-appl' },
  { k: 'retainer', l: 'Retainers & whitening', flow: 'retainer', cls: 't-ret' },
  { k: 'mouthguard', l: 'Mouthguard', flow: 'retainer', cls: 't-ret' },
  { k: 'retreat', l: 'Retreatment', flow: 'retreat', cls: 't-retx' },
  { k: 'misc', l: 'Dr. A (misc.)', flow: 'misc', cls: 't-misc' }
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.k, t]));
/* types to offer in pickers: retired types only while some case still uses them (or one is already chosen) */
function typesShown(cases, chosen) { return TYPES.filter(t => !t.legacy || t.k === chosen || (cases || []).some(c => c.type === t.k)); }
const SCANNERS = ['Allied Star', 'iTero', 'Other'];
/* Stages that need the doctor, and stages where the case is in fabrication. */
const DR_STAGES = ['dra', 'txp', 'todo', 'review'];
const FAB_STAGES = ['mfg', 'fab', 'print', 'submitted'];

function typeOf(c) { return TYPE[c.type] || TYPE.misc; }
function flowOf(c) { return FLOWS[typeOf(c).flow]; }
function stageLabel(c) { const s = flowOf(c).stages.find(x => x[0] === c.stage); return s ? s[1] : (c.stage || '—'); }
function stageIndex(c) { return flowOf(c).stages.findIndex(x => x[0] === c.stage); }
function firstStage(type) { return FLOWS[(TYPE[type] || TYPE.misc).flow].stages[0][0]; }

/* ---------- small utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid8() { return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join(''); }
function todayISO() { const d = new Date(); return isoOf(d); }
function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return isoOf(dt); }
function dayDiff(iso) { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); const a = new Date(y, m - 1, d); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((a - t) / 86400000); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); const opts = { month: 'short', day: 'numeric' }; if (y !== new Date().getFullYear()) opts.year = 'numeric'; return dt.toLocaleDateString(undefined, opts); }
function fmtDay(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtWhen(ms) { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function initials(name) { const p = String(name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w.\-]+/g, '').replace(/_/g, '').slice(0, 30); }
/* random characters without modulo bias (rejection sampling) */
function randChars(n) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', lim = 256 - (256 % A.length); let out = '';
  while (out.length < n) { for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) { if (b < lim && out.length < n) out += A[b % A.length]; } }
  return out;
}
function tempPassword() { return randChars(12).replace(/(.{4})(?=.)/g, '$1-'); }
function recoveryCode() { return randChars(24).replace(/(.{4})(?=.)/g, '$1-'); }
function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-'); }

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
  ringFrom(bytes) { return JSON.parse(TD.decode(bytes)); }
};

/* ---------- parse Asana task text (Tally-style "Key: value" notes) ---------- */
const NOTE_KEYS = [
  ['patient', /^patient\s*:/i], ['appliance', /^appliance type\s*:/i], ['alignerType', /^aligner type\s*:/i],
  ['scanner', /^scanner\s*:/i], ['assistant', /^assistant\s*:/i], ['scanDate', /^scan date\s*:/i],
  ['labDate', /^lab completion date\s*:/i], ['deliveryDate', /^delivery date\s*:/i],
  ['instructions', /^dr\.?\s*a'?’?s instructions\s*:/i], ['cc', /^patient'?’?s cc( from last visit)?\s*:/i],
  ['ipr', /^ipr\s*(&|and)\s*spacing( tracker app)?\s*:?/i]
];
function parseNotes(notes) {
  const out = {}; const rest = []; let cur = null;
  String(notes || '').replace(/\r/g, '').split('\n').forEach(line => {
    const hit = NOTE_KEYS.find(([, re]) => re.test(line.trim()));
    if (hit) { cur = hit[0]; out[cur] = line.trim().replace(hit[1], '').trim(); return; }
    if (cur === 'ipr' || cur === 'instructions' || cur === 'cc') { out[cur] = (out[cur] ? out[cur] + '\n' : '') + line; return; }
    cur = null; if (line.trim()) rest.push(line);
  });
  Object.keys(out).forEach(k => { out[k] = out[k].trim(); if (/^(-|na|n\/a|none)$/i.test(out[k])) out[k] = ''; });
  out.rest = rest.join('\n').trim();
  return out;
}
function splitName(name) {
  const s = String(name || '').trim();
  let m = s.match(/^(.+?)\s+[-–]\s+(.+)$/); if (m) return [m[1].trim(), m[2].trim()];
  m = s.match(/^(.+?)\s*\((.+)$/); if (m) return [m[1].trim(), ('(' + m[2]).trim()];
  return [s, ''];
}
const PROJECT_TYPES = [
  [/oliv/i, 'oliv'], [/angel/i, 'angel'], [/invisalign/i, 'invisalign'], [/ulab/i, 'ulab'], [/insmile/i, 'insmile'], [/inbrace/i, 'inbrace'],
  [/nl lab|next level lab|in-?house/i, 'nla'], [/appliance/i, 'appliance'], [/retainer|whitening/i, 'retainer'], [/retreat/i, 'retreat']
];
function typeFromProject(p) { const hit = PROJECT_TYPES.find(([re]) => re.test(p || '')); return hit ? hit[1] : ''; }
function stageFromSection(type, section) {
  const s = String(section || '').toLowerCase();
  const flow = FLOWS[(TYPE[type] || TYPE.misc).flow].stages.map(x => x[0]);
  const pick = k => flow.includes(k) ? k : flow[0];
  if (type === 'retainer' || type === 'mouthguard') {
    if (/tt|wt/.test(s) && /-/.test(s)) return pick('print');
    if (/milestone/.test(s)) return pick('milestones');
    if (/sarah/.test(s)) return pick('sarah');
    if (/pick ?up|front desk/.test(s)) return pick('pickup');
    return flow[0];
  }
  if (type === 'nla' || type === 'misc') {
    if (/misc/.test(s)) return 'todo';
    if (/txp/.test(s)) return pick('txp');
    if (/reset/.test(s)) return pick('reset');
    if (/fabrication/.test(s)) return pick('fab');
    if (/package|made/.test(s)) return pick('pack');
    if (/checked in/.test(s)) return pick('checkedin');
    return flow[0];
  }
  if (type === 'retreat') {
    if (/intake/.test(s)) return 'intake'; if (/review/.test(s)) return 'review'; if (/proposal/.test(s)) return 'proposal';
    if (/progress/.test(s)) return 'progress'; if (/complete/.test(s)) return 'completed'; return flow[0];
  }
  if (/submit/.test(s) && /to submit/.test(s)) return pick('submit');
  if (/action/.test(s)) return pick('dra');
  if (/hold|cbct|zoom/.test(s)) return pick('hold');
  if (/submitted/.test(s)) return pick('submitted');
  if (/manufactur/.test(s)) return pick('mfg');
  if (/shipped/.test(s)) return pick('shipped');
  if (/arrived/.test(s)) return pick('arrived');
  if (/milestone/.test(s)) return pick('milestones');
  return flow[0];
}
/* Turn one Asana task into case data. `roster` maps first names to staff ids. */
function caseFromAsana(t, projectName, roster) {
  const sectionName = t.section || '';
  let type = typeFromProject(projectName);
  if (type === 'nla' && /misc/i.test(sectionName)) type = 'misc';
  if (type === 'retainer' && /mouth\s*guard/i.test(t.name || '')) type = 'mouthguard';
  if (!type) type = 'misc';
  const n = parseNotes(t.notes);
  const [pt, detail] = splitName(t.name);
  const findStaff = name => {
    const first = String(name || '').trim().split(/\s+/)[0].toLowerCase(); if (!first) return '';
    const hit = roster.find(r => String(r.name || '').toLowerCase().split(/\s+/)[0] === first);
    return hit ? hit.sid : '';
  };
  let assignee = findStaff(t.assignee);
  if ((type === 'retainer' || type === 'mouthguard') && /-\s*tt/i.test(sectionName)) assignee = findStaff(sectionName.split('-')[0]) || assignee;
  const iso = s => { s = String(s || '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); } return ''; };
  let detailText = detail;
  if (!detailText && n.appliance) detailText = n.appliance + (n.alignerType ? ' (' + n.alignerType + ')' : '');
  return {
    type, patient: (n.patient || pt || '').trim(), detail: detailText, stage: stageFromSection(type, sectionName),
    assignee, assigneeName: assignee ? '' : (t.assignee || ''),
    scanDate: iso(n.scanDate), dueDate: iso(t.due), labDate: iso(n.labDate), deliveryDate: iso(n.deliveryDate),
    scanner: n.scanner || '', assistant: findStaff(n.assistant) || '', assistantName: findStaff(n.assistant) ? '' : (n.assistant || ''),
    instructions: n.instructions || '', cc: n.cc || '', ipr: n.ipr || '', notes: n.rest || '',
    comments: [], src: { asana: String(t.gid || '') }, importedAt: Date.now(),
    _done: !!t.completed, _closedAt: t.completedAt ? Date.parse(t.completedAt) || null : null
  };
}
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
function asanaRowsFromCSV(text) {
  return parseCSV(text).filter(r => !r['Parent task']).map(r => ({
    gid: r['Task ID'] || '', name: r['Name'] || '', notes: r['Notes'] || '', due: r['Due Date'] || '',
    assignee: r['Assignee'] || '', section: r['Section/Column'] || '', project: r['Projects'] || '',
    completed: !!(r['Completed At'] || '').trim(), completedAt: r['Completed At'] || ''
  }));
}
/* spreadsheet-safe cell: a leading = + - @ (or tab/CR) would be run as a formula by Excel/Sheets */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function caseToCSVRow(c) {
  return [c.patient, typeOf(c).l, c.detail, stageLabel(c), c.status === 'done' ? 'Completed' : 'Open', c.dueDate, c.scanDate, c.labDate, c.deliveryDate, c.assigneeLabel || '', c.instructions, c.cc, c.ipr, c.notes, c.chart, c.titanUrl, (c.extras || []).join('; '), typeof submissionLabel === 'function' ? submissionLabel(c.initial) : '', c.lab || '', (c.teethNote || '').replace(/\n/g, '; ')]
    .map(csvCell).join(',');
}
