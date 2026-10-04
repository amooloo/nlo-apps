/* Reading logins out of a spreadsheet or document that's pasted in (or a CSV file).
   Everything here runs on the device; nothing is sent anywhere. */

export const FIELDS = [
  ['title', 'Name'], ['desc', 'Description'], ['url', 'Website'], ['user', 'Username'], ['pass', 'Password'], ['notes', 'Notes'],
  ['totp', '2-step secret'], ['folder', 'Folder'], ['repN', 'Rep'], ['repPh', 'Rep phone'], ['repEm', 'Rep email'], ['ml', 'Mari’s List'],
  ['extra', 'Extra field'], ['skip', 'Skip']
];

/* ---------- spreadsheets: tab-, comma- or semicolon-separated text ---------- */
function splitRows(text, d) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function parseDelimited(text, delim) {
  const t = String(text || '').replace(/^﻿/, '');
  let d = delim;
  if (!d) {
    const head = t.split(/\r?\n/).slice(0, 20).join('\n');
    const count = ch => { let n = 0, q = false; for (const c of head) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
    const tabs = count('\t'), commas = count(','), semis = count(';');
    d = tabs > 0 && tabs >= commas / 4 ? '\t' : semis > commas ? ';' : ',';
  }
  const rows = splitRows(t, d).map(r => r.map(c => c.trim()));
  while (rows.length && rows[rows.length - 1].every(c => !c)) rows.pop();
  return { rows, delim: d };
}

/* ---------- tables copied from Excel, Google Sheets, Word or Google Docs (HTML on the clipboard) ---------- */
export function parseHtmlTables(doc) {
  const rows = [];
  if (!doc) return rows;
  doc.querySelectorAll('table').forEach(tb => {
    tb.querySelectorAll('tr').forEach(tr => {
      const r = [];
      tr.querySelectorAll('td,th').forEach(td => {
        // keep line breaks inside a cell as spaces, keep the text only
        const txt = (td.innerText !== undefined ? td.innerText : td.textContent) || '';
        r.push(txt.replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ').trim());
        const span = parseInt(td.getAttribute('colspan') || '1', 10);
        for (let k = 1; k < Math.min(span, 20); k++) r.push('');
      });
      if (r.length) rows.push(r);
    });
  });
  return rows;
}

/* ---------- headings -> what each column holds ---------- */
const HEAD = [
  ['ml', /mari'?s|marys list/],
  ['repEm', /^(rep|contact|sales rep|representative|account rep)('?s)? ?e-?mail( address)?$/],
  ['repPh', /^((rep|contact|sales rep|representative|account rep)('?s)? )?(phone|cell|mobile|tel|telephone|phone number)( ?(#|no\.?|number))?$/],
  ['repN', /^(rep|rep name|sales rep|representative|account rep|account manager|contact|contact name|contact person)$/],
  ['folder', /^(folder|category|group|grouping|type|department|dept|section|collection|tags?)$/],
  ['totp', /(totp|2fa|two[- ]?factor|otp|authenticator|mfa|otpauth)/],
  ['url', /(^|\b|_)(url|uri|urls|website|web ?site|web ?address|link|login ?page|portal ?url|domain|address)(\b|$)/],
  ['pass', /(^|\b|_)(pass|password|passwd|passcode|pwd|pw)(\b|$|word)/],
  ['user', /(^|\b|_)(user|username|user ?name|login|log ?in|user ?id|userid|e-?mail|account ?(#|no|number|id)|member ?id)(\b|$)/],
  ['desc', /^(description|desc|purpose|used for|use|what it'?s for|what for)$/],
  ['title', /^(name|title|account|site|service|vendor|company|portal|system|app|application|program|login for|item)$/],
  ['notes', /(^|\b)(notes?|comments?|memo|info|details|extra|other|remarks?)(\b|$)/]
];
const looksUrl = v => /^(https?:\/\/|www\.)/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v);
const looksEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function headKind(h) {
  const s = String(h || '').toLowerCase().replace(/^login_/, '').replace(/[_]+/g, ' ').trim();
  if (!s) return null;
  for (const [k, re] of HEAD) if (re.test(s)) return k;
  return null;
}
export function looksLikeHeader(row) {
  if (!row || row.length < 2) return false;
  const kinds = row.map(headKind).filter(Boolean);
  return kinds.length >= 2 || (kinds.length >= 1 && row.every(c => c.length < 30 && !looksUrl(c) && !looksEmail(c)));
}
export function guessColumns(rows, hasHeader) {
  const width = Math.max(0, ...rows.map(r => r.length));
  const map = new Array(width).fill(null);
  if (hasHeader && rows[0]) {
    rows[0].forEach((h, i) => { const k = headKind(h); if (k) map[i] = map.includes(k) ? 'extra' : k; });
    // a "Description" column with no name column is the name
    if (!map.includes('title') && map.includes('desc')) map[map.indexOf('desc')] = 'title';
  }
  const body = hasHeader ? rows.slice(1) : rows;
  const col = i => body.map(r => r[i] || '').filter(Boolean);
  for (let i = 0; i < width; i++) {
    if (map[i]) continue;
    const vals = col(i); if (!vals.length) { map[i] = hasHeader && rows[0] && rows[0][i] ? 'extra' : 'skip'; continue; }
    const frac = f => vals.filter(f).length / vals.length;
    if (!map.includes('url') && frac(looksUrl) > 0.6) map[i] = 'url';
    else if (!map.includes('user') && frac(looksEmail) > 0.6) map[i] = 'user';
  }
  // still-unknown columns, left to right: name, username, password, then notes
  const order = ['title', 'user', 'pass', 'notes'];
  for (let i = 0; i < width; i++) {
    if (map[i]) continue;
    const next = order.find(k => !map.includes(k));
    map[i] = next || (hasHeader && rows[0] && rows[0][i] ? 'extra' : 'skip');
  }
  return map;
}

/* ---------- rows -> logins ---------- */
function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
export function rowsToItems(rows, map, o) {
  o = Object.assign({ hasHeader: false, sections: false }, o || {});
  const heads = o.hasHeader ? rows[0] || [] : [];
  const out = []; let section = '';
  (o.hasHeader ? rows.slice(1) : rows).forEach((r, idx) => {
    const filled = r.map((c, i) => [c, i]).filter(([c]) => c && c.trim());
    if (!filled.length) return;
    // a row with just one thing in it is a heading ("FRONT OFFICE") when sections are on
    if (o.sections && filled.length === 1 && r.length > 1) { section = filled[0][0].replace(/[:\-–—]+$/, '').trim().slice(0, 60); return; }
    const it = { t: '', ds: '', url: '', u: '', p: '', n: '', totp: '', folder: '', fx: [], rep: { n: '', ph: '', em: '' }, ml: false, row: idx + (o.hasHeader ? 2 : 1) };
    r.forEach((c, i) => {
      const v = (c || '').trim(); if (!v) return;
      const k = map[i];
      if (k === 'title') it.t = it.t ? it.t + ' ' + v : v;
      else if (k === 'desc') it.ds = it.ds ? it.ds + ' ' + v : v;
      else if (k === 'repN') it.rep.n = it.rep.n || v.slice(0, 80);
      else if (k === 'repPh') it.rep.ph = it.rep.ph || v.slice(0, 40);
      else if (k === 'repEm') it.rep.em = it.rep.em || v.slice(0, 120);
      else if (k === 'ml') it.ml = /^(y|yes|x|✓|✔|true|1|member|on|on list)$/i.test(v);
      else if (k === 'url') it.url = it.url || v;
      else if (k === 'user') it.u = it.u || v;
      else if (k === 'pass') it.p = it.p || v;
      else if (k === 'notes') it.n = it.n ? it.n + '\n' + v : v;
      else if (k === 'totp') it.totp = v;
      else if (k === 'folder') it.folder = v.slice(0, 60);
      else if (k === 'extra') it.fx.push({ l: String(heads[i] || 'Field ' + (i + 1)).slice(0, 40), v, h: /pin|code|secret|answer|ssn|tax|account/i.test(String(heads[i] || '')) });
    });
    if (!it.folder && section) it.folder = section;
    if (!it.t) it.t = hostOf(it.url) || it.u || '';
    if (!it.t && !it.p && !it.u) return;
    if (!it.t) it.t = 'Untitled';
    it.t = it.t.slice(0, 120); it.ds = it.ds.slice(0, 140);
    out.push(it);
  });
  return out;
}

/* ---------- documents: "Name / Username: x / Password: y" blocks ---------- */
const KV_KEYS = [
  ['user', /^(user ?name|user ?id|user|login|log ?in|email|e-mail|id|account ?(#|no\.?|number)?)$/i],
  ['pass', /^(password|pass ?word|pass|passcode|pwd|pw|p\/w)$/i],
  ['url', /^(website|web ?site|url|link|site|address|web|portal|login page)$/i],
  ['notes', /^(notes?|comments?|memo)$/i],
  ['desc', /^(description|desc|purpose|used for)$/i],
  ['repN', /^(rep|sales rep|representative|account rep|rep name)$/i],
  ['repPh', /^(rep|sales rep|representative) ?(phone|cell|tel)$/i],
  ['repEm', /^(rep|sales rep|representative) ?e-?mail$/i],
  ['totp', /^(2fa|totp|authenticator|2-step|two[- ]factor)( secret| key)?$/i],
  ['folder', /^(folder|category|group|department)$/i]
];
function kvKind(k) { for (const [kind, re] of KV_KEYS) if (re.test(k.trim())) return kind; return null; }
export function parseBlocks(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = t.split(/\n\s*\n/);
  const out = [];
  blocks.forEach(b => {
    const lines = b.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const it = { t: '', ds: '', url: '', u: '', p: '', n: '', totp: '', folder: '', fx: [], rep: { n: '', ph: '', em: '' }, ml: false };
    const notes = [];
    lines.forEach((line, li) => {
      // several pairs on one line: "user: x  pass: y" or "user: x / pass: y"
      const pairs = [];
      const re = /([A-Za-z][A-Za-z #./'\-]{0,24}?)\s*[:=]\s*(.*?)(?=\s+(?:\/|\||,|;)?\s*[A-Za-z][A-Za-z #./'\-]{0,24}?\s*[:=]\s|$)/g;
      let m;
      if (!/^https?:\/\//i.test(line)) while ((m = re.exec(line)) && m[0]) { pairs.push([m[1], m[2].replace(/\s*[\/|,;]\s*$/, '')]); if (re.lastIndex >= line.length) break; }
      const known = pairs.filter(([k]) => kvKind(k));
      // a single "Label: value" line with a short label (Call rep: Mike, PIN: 4455) is an extra field
      const field = !known.length && pairs.length === 1 && pairs[0][0].trim().split(/\s+/).length <= 3 && li > 0 && String(pairs[0][1] || '').trim();
      if (known.length || field) {
        pairs.forEach(([k, v]) => {
          const kind = kvKind(k), val = String(v || '').trim();
          if (!val) return;
          if (kind === 'user') it.u = it.u || val;
          else if (kind === 'pass') it.p = it.p || val;
          else if (kind === 'url') it.url = it.url || val;
          else if (kind === 'notes') notes.push(val);
          else if (kind === 'desc') it.ds = (it.ds ? it.ds + ' ' : '') + val.slice(0, 140);
          else if (kind === 'repN') it.rep.n = it.rep.n || val.slice(0, 80);
          else if (kind === 'repPh') it.rep.ph = it.rep.ph || val.slice(0, 40);
          else if (kind === 'repEm') it.rep.em = it.rep.em || val.slice(0, 120);
          else if (kind === 'totp') it.totp = val;
          else if (kind === 'folder') it.folder = val.slice(0, 60);
          else it.fx.push({ l: k.trim().slice(0, 40), v: val, h: /pin|code|secret|answer|ssn|tax/i.test(k) });
        });
      } else if (looksUrl(line) && !it.url) it.url = line;
      else if (li === 0 && !it.t) {
        it.t = line.replace(/[:\-–—]+$/, '').trim();
      }
      else notes.push(line);
    });
    if (!it.u && !it.p) return; // not a login (just prose)
    it.n = notes.join('\n');
    if (!it.t) it.t = hostOf(it.url) || it.u || 'Untitled';
    it.t = it.t.slice(0, 120);
    out.push(it);
  });
  return out;
}

/* what kind of text was pasted */
export function sniff(text) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  const lines = t.split(/\r?\n/).filter(l => l.trim());
  if (lines.length >= 2) {
    const tabbed = lines.filter(l => l.includes('\t')).length;
    if (tabbed >= Math.ceil(lines.length * 0.6)) return 'table';
    const { rows } = parseDelimited(t);
    const widths = rows.filter(r => r.some(Boolean)).map(r => r.length);
    const multi = widths.filter(w => w >= 2).length;
    const kv = lines.filter(l => /^[A-Za-z][A-Za-z #./'\-]{0,24}\s*[:=]\s*\S/.test(l) && !/^https?:/i.test(l)).length;
    if (kv >= 2 && kv >= multi / 2) return 'blocks';
    if (multi >= Math.ceil(widths.length * 0.6)) return 'table';
  }
  return 'blocks';
}

export function dupKey(folderId, title, user) {
  return folderId + '\n' + String(title || '').trim().toLowerCase() + '\n' + String(user || '').trim().toLowerCase();
}
