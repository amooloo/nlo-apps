/* =====================================================================
   Reading the old Time-Off Google Sheet, in the browser: the whole Sheet
   downloaded as an Excel file (File → Download → Microsoft Excel), or
   its tabs downloaded one by one as CSV files. The file never leaves
   this computer. (The readers are NLO A/R's, kept to what's needed.)
   → { tabs: Map(tab name → rows of cells), date1904 }
   ===================================================================== */

/* ---------- .xlsx: a zip of XML files ---------- */
async function unzipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw errCode('bad-file', 'This file isn’t a readable Excel file.');
  const n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true), out = new Map();
  for (let i = 0, p = cdOff; i < n && p + 46 <= u8.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    out.set(TD.decode(u8.subarray(p + 46, p + 46 + nl)), { method, csize, lho });
    p += 46 + nl + xl + cl;
  }
  const get = async name => {
    const e = out.get(name); if (!e || e.lho + 30 > u8.length) return null;
    const p = e.lho, dataAt = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true), raw = u8.subarray(dataAt, dataAt + e.csize);
    if (e.method === 0) return TD.decode(raw);
    if (e.method === 8) return TD.decode(await inflateCapped(raw, 60 * 1024 * 1024));
    throw errCode('bad-file', 'This Excel file uses a compression the browser can’t open.');
  };
  return { names: Array.from(out.keys()), get };
}
async function inflateCapped(raw, cap) {
  const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    n += value.length; if (n > cap) { try { await rd.cancel(); } catch (e) { } throw errCode('bad-file', 'That file is far too big to be the Time-Off Sheet.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/* "<tag …>…</tag>" pieces of a big text, in one pass */
function pieces(text, open, close) {
  const out = [], lower = text.replace(/[A-Z]+/g, m => m.toLowerCase()), o = '<' + open, c = '</' + close + '>';
  let at = 0;
  for (;;) {
    let i = lower.indexOf(o, at); if (i < 0) break;
    const ch = lower[i + o.length]; if (ch !== '>' && ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' && ch !== '/') { at = i + 1; continue; }
    const gt = lower.indexOf('>', i); if (gt < 0) break;
    if (lower[gt - 1] === '/') { out.push({ attrs: text.slice(i + o.length, gt - 1), body: '' }); at = gt + 1; continue; }
    const end = lower.indexOf(c, gt); if (end < 0) break;
    out.push({ attrs: text.slice(i + o.length, gt), body: text.slice(gt + 1, end) }); at = end + c.length;
  }
  return out;
}
function tagAttrs(text, name) {
  const out = [], lower = text.replace(/[A-Z]+/g, m => m.toLowerCase()), o = '<' + name; let at = 0;
  for (;;) {
    const i = lower.indexOf(o, at); if (i < 0) break;
    const ch = lower[i + o.length]; if (ch !== ' ' && ch !== '>' && ch !== '/' && ch !== '\t' && ch !== '\n' && ch !== '\r') { at = i + 1; continue; }
    const gt = lower.indexOf('>', i); if (gt < 0) break;
    out.push(text.slice(i + o.length, gt)); at = gt + 1;
  }
  return out;
}
function xmlText(s) { return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e.toLowerCase()]); }
function colNum(ref) { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
/* only the old Sheet's own tabs are read, and no more rows than it could have */
const OLD_SHEET_TABS = ['requests', 'benefitsemployees', 'formerstaff', 'balancelog', 'holidays', 'blackouts'];
async function readXLSXTabs(u8) {
  const z = await unzipEntries(u8);
  const ssx = await z.get('xl/sharedStrings.xml');
  const sst = ssx ? pieces(ssx, 'si', 'si').map(si => pieces(si.body, 't', 't').map(t => xmlText(t.body)).join('')) : [];
  const wbx = (await z.get('xl/workbook.xml')) || '', rels = (await z.get('xl/_rels/workbook.xml.rels')) || '';
  const target = new Map(); for (const a of tagAttrs(rels, 'relationship')) { const id = /\bId="([^"]{1,200})"/.exec(a), t = /\bTarget="([^"]{1,300})"/.exec(a); if (id && t) target.set(id[1], t[1].replace(/^\/?xl\//, '').replace(/^\//, '')); }
  const list = tagAttrs(wbx, 'sheet').map(a => { const r = /\br:id="([^"]{1,200})"/.exec(a), nm = /\bname="([^"]{1,200})"/.exec(a); return r && nm && target.has(r[1]) ? { name: xmlText(nm[1]), path: 'xl/' + target.get(r[1]) } : null; }).filter(Boolean).slice(0, 40);
  const date1904 = /date1904="(1|true)"/.test(wbx), tabs = new Map();
  for (const { name, path } of list) {
    if (tabs.has(name) || !OLD_SHEET_TABS.includes(String(name).trim().toLowerCase())) continue;
    const x = await z.get(path); if (!x) continue;
    const grid = [];
    for (const row of pieces(x, 'row', 'row')) {
      const rn = /\br="(\d+)"/.exec(row.attrs); const r = rn ? Number(rn[1]) - 1 : grid.length;
      if (r < 0 || r > 50000 || row.body.length > 200000) continue;
      let ci = 0;
      for (const c of pieces(row.body, 'c', 'c')) {
        const ref = /\br="([A-Z]{1,3}\d+)"/.exec(c.attrs), t = /\bt="([^"]+)"/.exec(c.attrs);
        const col = ref ? colNum(ref[1]) : ci; ci = col + 1; if (col > 200) continue;
        const vp = pieces(c.body, 'v', 'v')[0], v = vp ? vp.body : null, typ = t ? t[1] : 'n'; let val = null;
        if (typ === 's') val = v != null ? (sst[Number(v)] != null ? sst[Number(v)] : '') : null;
        else if (typ === 'inlineStr') val = pieces(c.body, 't', 't').map(m => xmlText(m.body)).join('');
        else if (typ === 'str' || typ === 'e') val = v != null ? xmlText(v) : null;
        else if (typ === 'b') val = v != null ? Number(v) : null;
        else val = v != null && v !== '' ? Number(v) : null;
        if (val != null && val !== '') (grid[r] = grid[r] || [])[col] = val;
      }
    }
    tabs.set(name, grid);
  }
  return { tabs, date1904 };
}

/* ---------- CSV (a tab downloaded as .csv: "<Sheet name> - <Tab>.csv") ---------- */
function readCSV(text, sep, maxRows) {
  maxRows = maxRows || 50000;
  const rows = []; let row = [], f = '', q = false, quoted = false;
  const push = () => { row.push(quoted ? f : f.trim()); f = ''; quoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f.trim() === '') { q = true; quoted = true; f = ''; }
    else if (c === sep) push();
    else if (c === '\n') { push(); rows.push(row); row = []; if (rows.length >= maxRows) return rows.map(r => r.map(v => v === '' ? null : v)); }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { push(); rows.push(row); }
  return rows.map(r => r.map(v => v === '' ? null : v));
}
function csvTabName(fileName) {
  const base = String(fileName || '').replace(/\.(csv|tsv|txt)$/i, ''), i = base.lastIndexOf(' - ');
  return (i >= 0 ? base.slice(i + 3) : base).trim();
}

/* ---------- read what was dropped: one .xlsx, or one or more .csv files ---------- */
async function readOldSheet(files) {
  const tabs = new Map(); let date1904 = false, total = 0;
  for (const f of files) {
    total += f.size || 0; if (total > 40 * 1024 * 1024) throw errCode('bad-file', 'That’s far too much to be the Time-Off Sheet.');
    const u8 = new Uint8Array(await f.arrayBuffer());
    if (u8[0] === 0x50 && u8[1] === 0x4B) { const x = await readXLSXTabs(u8); x.tabs.forEach((g, n) => tabs.set(n, g)); date1904 = x.date1904; continue; }
    if (u8[0] === 0xD0 && u8[1] === 0xCF) throw errCode('bad-file', 'That’s an old-style .xls file. In the Google Sheet use File → Download → Microsoft Excel (.xlsx).');
    if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) throw errCode('bad-file', 'That’s a PDF. In the Google Sheet use File → Download → Microsoft Excel (.xlsx).');
    const text = TD.decode(u8).replace(/^﻿/, ''), first = text.split('\n').slice(0, 5).join('\n');
    tabs.set(csvTabName(f.name), readCSV(text, (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ','));
  }
  return { tabs, date1904 };
}

/* ---------- cells ---------- */
/* "$1,234.50", "(12.00)", "−5" → numbers; anything else → null */
function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim(); if (!s || s.length > 40) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[−–]/g, '-').replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s); return isFinite(n) ? (neg ? -n : n) : null;
}
/* an Excel date number (days since 1899-12-30, or 1904-01-01) or "10/26/2026", "2026-10-26", "2026-10-26 14:05:00",
   "Mon Oct 26 2026 …" → YYYY-MM-DD ('' when it isn't a date) */
function toISODate(v, date1904) {
  if (typeof v === 'number') {
    if (!(v > 1 && v < 2958465)) return '';
    const ms = Math.round((Math.floor(v + 1e-9) + (date1904 ? 1462 : 0) - 25569) * 86400000), d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const s = String(v == null ? '' : v).trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { const iso = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); return isISO(iso) ? iso : ''; }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))) { let y = Number(m[3]); if (y < 100) y += 2000; const iso = y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); return isISO(iso) ? iso : ''; }
  if (/^[A-Za-z]{3},? [A-Za-z]{3} \d{1,2},? \d{4}/.test(s) || /^[A-Za-z]{3,9} \d{1,2}, \d{4}/.test(s)) { const d = new Date(s); return isNaN(d) ? '' : isoOf(d); }
  return '';
}
/* the same, with the time of day (the old Sheet's timestamps are local office time) → ms, or 0 */
function toWhenMs(v, date1904) {
  if (typeof v === 'number' && v > 1 && v < 2958465) {
    const ms = Math.round((v + (date1904 ? 1462 : 0) - 25569) * 86400000), d = new Date(ms);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }
  const s = String(v == null ? '' : v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  const iso = toISODate(v, date1904); if (iso) return dayStartMs(iso) + 12 * 3600000;
  return 0;
}
