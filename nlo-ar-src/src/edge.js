/* =====================================================================
   Reading Edge's Accounts Receivable Aging report, in the browser.
   Edge (Reporting → Financial → Accounts Receivable Aging → Export ▾ →
   Excel) saves an .xls file. It is read right here — the file never
   leaves the computer — into one row per account.
   Also takes .xlsx (Excel's own format), .csv / .txt, and a copy-paste
   straight out of Excel.
   ===================================================================== */

/* ---------- a grid: rows of cells, cells by column number ---------- */
/* every reader below hands back { sheets: [ [ [cell, cell…], … ] ] }, a cell being a string, a number or null */

/* ---------- .xls: an OLE2 "compound file" holding a BIFF8 workbook ---------- */
const CFB_SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
function isCFB(u8) { return u8.length > 512 && CFB_SIG.every((b, i) => u8[i] === b); }
function cfbStream(u8, wanted) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const secSize = 1 << dv.getUint16(30, true), miniSize = 1 << dv.getUint16(32, true);
  if (secSize !== 512 && secSize !== 4096) throw errCode('bad-file', 'This file isn’t a readable Excel file.');
  const nFat = dv.getUint32(44, true), dirStart = dv.getInt32(48, true), miniCutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getInt32(60, true), difatStart = dv.getInt32(68, true);
  const secOff = s => (s + 1) * secSize;
  const okSec = s => s >= 0 && secOff(s) + secSize <= u8.length;
  // the sector table (FAT): its sectors are listed in the header, then in a chain of DIFAT sectors
  // (never more of it than the file could need: a damaged or hostile header can't make it huge)
  const fileSecs = Math.ceil(u8.length / secSize), maxFat = Math.min(nFat, Math.ceil(fileSecs / (secSize / 4)) + 1), fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < maxFat; i++) { const s = dv.getInt32(76 + i * 4, true); if (okSec(s)) fatSecs.push(s); }
  for (let d = difatStart, g = 0; okSec(d) && fatSecs.length < maxFat && g < fileSecs; g++) {
    const off = secOff(d), per = secSize / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < maxFat; i++) { const s = dv.getInt32(off + i * 4, true); if (okSec(s)) fatSecs.push(s); }
    d = dv.getInt32(off + secSize - 4, true);
  }
  const per = secSize / 4, fat = new Int32Array(fatSecs.length * per);
  fatSecs.forEach((s, k) => { if (!okSec(s)) return; const off = secOff(s); for (let i = 0; i < per; i++) fat[k * per + i] = dv.getInt32(off + i * 4, true); });
  const chain = (start, table, limit) => { const out = []; for (let s = start, g = 0; s >= 0 && s < table.length && g < limit; g++) { out.push(s); s = table[s]; } return out; };
  const readChain = (start, size) => {
    const secs = chain(start, fat, Math.ceil(u8.length / secSize) + 2), buf = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => { if (okSec(s)) buf.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize); });
    return size != null ? buf.subarray(0, Math.min(size, buf.length)) : buf;
  };
  const dir = readChain(dirStart), dd = new DataView(dir.buffer, dir.byteOffset, dir.byteLength), entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dd.getUint16(off + 64, true); let name = '';
    for (let i = 0; i + 1 < Math.min(nameLen, 64) - 1; i += 2) name += String.fromCharCode(dd.getUint16(off + i, true));
    entries.push({ name, type: dir[off + 66], start: dd.getInt32(off + 116, true), size: dd.getUint32(off + 120, true) });
  }
  const names = wanted.map(n => n.toLowerCase());
  const e = entries.find(x => x.type === 2 && names.includes(x.name.toLowerCase()));
  if (!e) return null;
  if (e.size >= miniCutoff) return readChain(e.start, e.size);
  // small streams live in the "mini stream" (inside the root entry), with their own table
  const root = entries[0], mini = readChain(root.start, root.size), mf = readChain(miniFatStart);
  const mfd = new DataView(mf.buffer, mf.byteOffset, mf.byteLength), miniFat = new Int32Array(mf.length / 4);
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = mfd.getInt32(i * 4, true);
  const secs = chain(e.start, miniFat, Math.ceil(mini.length / miniSize) + 2), buf = new Uint8Array(secs.length * miniSize);
  secs.forEach((s, i) => buf.set(mini.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
  return buf.subarray(0, e.size);
}
/* Windows-1252 characters that differ from Latin-1 (8-bit strings in old Excel files) */
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ' };
function chr8(b) { return CP1252[b] || String.fromCharCode(b); }
/* a value stored as an "RK" number (30 bits of a double or of an integer, maybe ×100) */
function rkNum(v) {
  let n;
  if (v & 2) n = v >> 2;
  else { const t = new DataView(new ArrayBuffer(8)); t.setUint32(0, 0, true); t.setUint32(4, (v & 0xFFFFFFFC) >>> 0, true); n = t.getFloat64(0, true); }
  return v & 1 ? n / 100 : n;
}
/* the strings of a workbook: an SST record plus CONTINUE records; a string's characters can run on into the next record,
   which then starts with one byte saying whether they are 8- or 16-bit */
function readSST(segs) {
  const out = []; if (!segs.length || segs[0].length < 8) return out;
  const total = new DataView(segs[0].buffer, segs[0].byteOffset, segs[0].byteLength).getUint32(4, true);
  let si = 0, off = 8;
  const more = () => { while (si < segs.length && off >= segs[si].length) { si++; off = 0; } return si < segs.length; };
  const u8 = () => { if (!more()) throw errCode('bad-file'); return segs[si][off++]; };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  for (let k = 0; k < total; k++) {
    if (!more()) break;
    const cch = u16(), flags = u8(); const rich = flags & 8 ? u16() : 0, ext = flags & 4 ? u32() : 0;
    let hi = flags & 1, left = cch, s = '';
    while (left > 0) {
      if (off >= segs[si].length) { si++; off = 0; if (si >= segs.length) break; hi = segs[si][off++] & 1; }
      const seg = segs[si], n = Math.min(left, hi ? (seg.length - off) >> 1 : seg.length - off);
      if (n <= 0) { off = seg.length; continue; }
      if (hi) { for (let i = 0; i < n; i++) s += String.fromCharCode(seg[off + 2 * i] | (seg[off + 2 * i + 1] << 8)); off += 2 * n; }
      else { for (let i = 0; i < n; i++) s += chr8(seg[off + i]); off += n; }
      left -= n;
    }
    let skip = rich * 4 + ext;
    while (skip > 0 && more()) { const n = Math.min(skip, segs[si].length - off); off += n; skip -= n; }
    out.push(s);
  }
  return out;
}
/* XLUnicodeString inside a record: 2-byte length, 1 flag byte, then the characters */
function xlStr(u8, off) {
  const cch = u8[off] | (u8[off + 1] << 8), flags = u8[off + 2]; let p = off + 3, s = '';
  if (flags & 8) p += 2; if (flags & 4) p += 4;
  if (flags & 1) { for (let i = 0; i < cch && p + 1 < u8.length; i++, p += 2) s += String.fromCharCode(u8[p] | (u8[p + 1] << 8)); }
  else { for (let i = 0; i < cch && p < u8.length; i++, p++) s += chr8(u8[p]); }
  return s;
}
function readXLS(u8) {
  const wb = cfbStream(u8, ['Workbook', 'Book']);
  if (!wb) throw errCode('bad-file', 'This Excel file has no workbook inside.');
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  const sheets = [], stack = []; let cur = null, sstSegs = null, sst = [], date1904 = false, pend = null;
  const put = (r, c, v) => { if (!cur) return; (cur[r] = cur[r] || [])[c] = v; };
  for (let pos = 0; pos + 4 <= wb.length;) {
    const type = dv.getUint16(pos, true), len = dv.getUint16(pos + 2, true), p = pos + 4; pos = p + len;
    if (pos > wb.length) break;
    if (sstSegs && type !== 0x003C) { sst = readSST(sstSegs); sstSegs = null; }
    switch (type) {
      case 0x0809: { // BOF: the workbook part, a worksheet, or something inside one (a chart) — EOF goes back out
        const dt = len >= 4 ? dv.getUint16(p + 2, true) : 0;
        stack.push(cur); cur = null;
        if (dt === 0x0010) { cur = []; sheets.push(cur); }
        break;
      }
      case 0x000A: cur = stack.length ? stack.pop() : null; break; // EOF
      case 0x0022: if (len >= 2) date1904 = dv.getUint16(p, true) === 1; break; // DATEMODE
      case 0x00FC: sstSegs = [wb.subarray(p, p + len)]; break; // SST
      case 0x003C: if (sstSegs) sstSegs.push(wb.subarray(p, p + len)); break; // CONTINUE
      case 0x00FD: if (len >= 10) put(dv.getUint16(p, true), dv.getUint16(p + 2, true), sst[dv.getUint32(p + 6, true)] != null ? sst[dv.getUint32(p + 6, true)] : ''); break; // LABELSST
      case 0x0204: case 0x00D6: if (len >= 9) put(dv.getUint16(p, true), dv.getUint16(p + 2, true), xlStr(wb.subarray(0, p + len), p + 6)); break; // LABEL, RSTRING
      case 0x0203: if (len >= 14) put(dv.getUint16(p, true), dv.getUint16(p + 2, true), dv.getFloat64(p + 6, true)); break; // NUMBER
      case 0x027E: if (len >= 10) put(dv.getUint16(p, true), dv.getUint16(p + 2, true), rkNum(dv.getInt32(p + 6, true))); break; // RK
      case 0x00BD: { // MULRK
        if (len < 6) break; const r = dv.getUint16(p, true), c0 = dv.getUint16(p + 2, true), n = Math.floor((len - 6) / 6);
        for (let i = 0; i < n; i++) put(r, c0 + i, rkNum(dv.getInt32(p + 4 + i * 6 + 2, true)));
        break;
      }
      case 0x0006: { // FORMULA: the cached result
        if (len < 14) break; const r = dv.getUint16(p, true), c = dv.getUint16(p + 2, true);
        if (dv.getUint16(p + 12, true) === 0xFFFF) { const k = wb[p + 6]; if (k === 0) pend = { r, c }; else if (k === 1) put(r, c, wb[p + 8] ? 1 : 0); }
        else put(r, c, dv.getFloat64(p + 6, true));
        break;
      }
      case 0x0207: if (pend) { put(pend.r, pend.c, xlStr(wb.subarray(0, p + len), p)); pend = null; } break; // STRING (a formula's text result)
      default: break;
    }
  }
  if (sstSegs) sst = readSST(sstSegs);
  return { sheets: sheets.filter(s => s.length), date1904 };
}

/* ---------- .xlsx: a zip of XML files ---------- */
async function unzipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw errCode('bad-file', 'This file isn’t a readable Excel file.');
  const n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true), out = new Map();
  for (let i = 0, p = cdOff; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = TD.decode(u8.subarray(p + 46, p + 46 + nl));
    out.set(name, { method, csize, lho });
    p += 46 + nl + xl + cl;
  }
  const get = async name => {
    const e = out.get(name); if (!e) return null;
    const p = e.lho, dataAt = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true), raw = u8.subarray(dataAt, dataAt + e.csize);
    if (e.method === 0) return TD.decode(raw);
    if (e.method === 8) return TD.decode(await inflateCapped(raw, 150 * 1024 * 1024));
    throw errCode('bad-file', 'This Excel file uses a compression the browser can’t open.');
  };
  return { names: Array.from(out.keys()), get };
}
async function inflateCapped(raw, cap) {
  const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    n += value.length; if (n > cap) { try { await rd.cancel(); } catch (e) { } throw errCode('bad-file', 'That file is far too big to be an A/R report.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/* "<tag …>…</tag>" pieces of a big text, in one pass (a lazy regex over a damaged file could take minutes) */
function pieces(text, open, close) {
  // (ASCII-only lowercase, so positions in it match the text exactly)
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
/* the attributes of each "<name …>" tag, in one pass */
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
async function readXLSX(u8) {
  const z = await unzipEntries(u8);
  const ssx = await z.get('xl/sharedStrings.xml');
  const sst = ssx ? pieces(ssx, 'si', 'si').map(si => pieces(si.body, 't', 't').map(t => xmlText(t.body)).join('')) : [];
  // sheets in workbook order
  const wbx = (await z.get('xl/workbook.xml')) || '', rels = (await z.get('xl/_rels/workbook.xml.rels')) || '';
  const target = new Map(); for (const a of tagAttrs(rels, 'relationship')) { const id = /\bId="([^"]{1,200})"/.exec(a), t = /\bTarget="([^"]{1,300})"/.exec(a); if (id && t) target.set(id[1], t[1].replace(/^\/?xl\//, '').replace(/^\//, '')); }
  let paths = tagAttrs(wbx, 'sheet').map(a => { const r = /\br:id="([^"]{1,200})"/.exec(a); return r && target.has(r[1]) ? 'xl/' + target.get(r[1]) : null; }).filter(Boolean);
  paths = Array.from(new Set(paths)).slice(0, 30); // each sheet once (a damaged file could list one many times)
  if (!paths.length) paths = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  const date1904 = /date1904="(1|true)"/.test(wbx);
  const sheets = [];
  for (const path of paths) {
    const x = await z.get(path); if (!x) continue;
    const grid = [];
    for (const row of pieces(x, 'row', 'row')) {
      const rn = /\br="(\d+)"/.exec(row.attrs); const r = rn ? Number(rn[1]) - 1 : grid.length;
      if (r < 0 || r > 1048575 || row.body.length > 2000000) continue; // Excel's own limits
      let ci = 0;
      for (const c of pieces(row.body, 'c', 'c')) {
        const attrs = c.attrs, body = c.body, ref = /\br="([A-Z]{1,3}\d+)"/.exec(attrs), t = /\bt="([^"]+)"/.exec(attrs);
        const col = ref ? colNum(ref[1]) : ci; ci = col + 1; if (col > 16383) continue;
        const vp = pieces(body, 'v', 'v')[0], v = vp ? [null, vp.body] : null; let val = null;
        const typ = t ? t[1] : 'n';
        if (typ === 's') val = v ? (sst[Number(v[1])] != null ? sst[Number(v[1])] : '') : null;
        else if (typ === 'inlineStr') val = pieces(body, 't', 't').map(m => xmlText(m.body)).join('');
        else if (typ === 'str' || typ === 'e') val = v ? xmlText(v[1]) : null;
        else if (typ === 'b') val = v ? Number(v[1]) : null;
        else val = v && v[1] !== '' ? Number(v[1]) : null;
        if (val != null && val !== '') (grid[r] = grid[r] || [])[col] = val;
      }
    }
    if (grid.length) sheets.push(grid);
  }
  return { sheets, date1904 };
}

/* ---------- text: CSV, tab-separated (a copy from Excel), or an HTML table (a copy from Excel, Edge's Html export) ---------- */
function readCSV(text, sep) {
  const rows = []; let row = [], f = '', q = false, quoted = false;
  const push = () => { row.push(quoted ? f : f.trim()); f = ''; quoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f.trim() === '') { q = true; quoted = true; f = ''; }
    else if (c === sep) push();
    else if (c === '\n') { push(); rows.push(row); row = []; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { push(); rows.push(row); }
  return rows.map(r => r.map(v => v === '' ? null : v));
}
function htmlText(s) {
  // tags out (a <br> is a space), in one pass
  s = String(s); let out = '', at = 0;
  for (;;) {
    const i = s.indexOf('<', at); if (i < 0) { out += s.slice(at); break; }
    const gt = s.indexOf('>', i); if (gt < 0) { out += s.slice(at); break; }
    out += s.slice(at, i) + (/^<br\b/i.test(s.slice(i, i + 4)) ? ' ' : ''); at = gt + 1;
  }
  return xmlText(out.replace(/&nbsp;/gi, ' ')).replace(/\s+/g, ' ').trim();
}
function readHTMLTables(html) {
  const sheets = [];
  for (const t of pieces(String(html), 'table', 'table')) {
    const grid = [], spanDown = [];
    for (const tr of pieces(t.body, 'tr', 'tr')) {
      const row = [], r = grid.length; let c = 0;
      // cells: <td> or <th>, in order
      const cells = pieces(tr.body.replace(/<(\/?)th\b/gi, '<$1td'), 'td', 'td');
      for (const td of cells) {
        if (c > 2000) break; // no report is that wide
        while (spanDown[c] && spanDown[c] > r) c++;
        const cs = Math.min(100, Number((/colspan\s*=\s*"?(\d{1,4})/i.exec(td.attrs) || [])[1] || 1) || 1), rs = Math.min(10000, Number((/rowspan\s*=\s*"?(\d{1,6})/i.exec(td.attrs) || [])[1] || 1) || 1);
        const v = htmlText(td.body);
        row[c] = v === '' ? null : v;
        for (let k = 0; k < cs; k++) if (rs > 1) spanDown[c + k] = r + rs;
        c += cs;
      }
      grid.push(row);
    }
    if (grid.length) sheets.push(grid);
  }
  return { sheets };
}

/* ---------- pick the reader by what the file is ---------- */
async function readGridFile(name, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isCFB(u8)) return Object.assign(readXLS(u8), { kind: 'xls' });
  if (u8[0] === 0x50 && u8[1] === 0x4B) return Object.assign(await readXLSX(u8), { kind: 'xlsx' });
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) throw errCode('pdf', 'That’s a PDF. In Edge, use Export ▾ → Excel instead (the PDF can’t be read reliably).');
  const text = TD.decode(u8).replace(/^﻿/, '');
  return Object.assign(readGridText(text), { kind: 'text' });
}
function readGridText(text) {
  if (text.length > 40 * 1024 * 1024) throw errCode('bad-file', 'That’s far too much to be an A/R report.');
  if (/<table\b/i.test(text)) return readHTMLTables(text);
  const first = text.split('\n').slice(0, 30).join('\n');
  const tabs = (first.match(/\t/g) || []).length, commas = (first.match(/,/g) || []).length;
  return { sheets: [readCSV(text, tabs >= commas / 2 && tabs ? '\t' : ',')] };
}

/* =====================================================================
   The report itself: find the column headings, read each account row,
   and the lines above them (date, options, subgroup) and Edge's total.
   ===================================================================== */
const AR_HEAD = [
  ['patient', /^(patient|patientname|name|pt|ptname)$/],
  ['acct', /^(id|acct|acctno|acctnum|account|accountno|accountnum|accountnumber|patientid|ptid)$/],
  ['sts', /^(sts|status|ptstatus|patientstatus)$/],
  ['rp', /^(responsibleparty|respparty|responsible|resp|rp|guarantor|party)$/],
  ['home', /^(homeph|homephone|home|phone|ph)$/],
  ['work', /^(workph|workphone|work|cellph|cell|mobile)$/],
  ['due', /^(amtdue|amountdue|totaldue|due|pastdue|totalpastdue|amtpastdue)$/],
  ['b0', /^(030|0to30|130|current|030days)$/],
  ['b30', /^(3160|31to60|3160days)$/],
  ['b60', /^(6190|61to90|6190days)$/],
  ['b90', /^(91|91plus|91over|over90|90|91days|90plus)$/],
  ['days', /^(days|dayspastdue|age|daysold)$/],
  ['bal', /^(balance|contractbalance|bal|contractbal|totalbalance|acctbalance)$/],
  ['lastAmt', /^(lastamt|lastamount|lastpaymentamount|lastpmt|lastpaid|lastpayment)$/],
  ['recv', /^(received|recieved|datereceived|daterecieved|lastpaymentdate|lastpaiddate|lastreceived|lastrecieved|lastpmtdate|paymentdate)$/] // Edge v8 spells it "Recieved"
];
const NUM_KEYS = ['due', 'b0', 'b30', 'b60', 'b90', 'days', 'bal', 'lastAmt'];
function headKey(v) {
  const n = String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!n) return '';
  const hit = AR_HEAD.find(([, re]) => re.test(n)); return hit ? hit[0] : '';
}
/* "$1,234.50", "(12.00)", "12.00-", "−5" → numbers; anything else → null */
function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim(); if (!s || s.length > 40) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/[−–]/g, '-').replace(/[$,\s]/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s); return isFinite(n) ? (neg ? -n : n) : null;
}
/* an Excel date (days since 1899-12-30, or 1904-01-01) or "12/19/2023" / "2023-12-19" → YYYY-MM-DD */
function toISODate(v, date1904) {
  if (typeof v === 'number' && v > 1 && v < 2958465) {
    const ms = Math.round((Math.floor(v + 1e-9) + (date1904 ? 1462 : 0) - 25569) * 86400000);
    const d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) { let y = Number(m[3]); if (y < 100) y += y < 70 ? 2000 : 1900; return y + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0'); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/* "Tuesday, November 5, 2024  Office: All, Doctor: All" → 2024-11-05 */
function reportDate(s) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(s || ''));
  if (m) { const mi = MONTHS.indexOf(m[1].toLowerCase()); if (mi >= 0) return m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0'); }
  const d = toISODate(String(s || '').replace(/^.*?(\d{1,2}\/\d{1,2}\/\d{4}).*$/, '$1')); return d || '';
}
function rowText(row) { return (row || []).filter(v => v != null && String(v).trim() !== '').map(v => String(v).trim()); }
/* find the heading row: "Patient" and at least four more of the report's columns */
function findHeader(grid) {
  for (let r = 0; r < Math.min(grid.length, 400); r++) {
    const row = grid[r] || [], cols = {};
    row.forEach((v, c) => { const k = headKey(v); if (k && cols[k] == null) cols[k] = c; });
    if (cols.patient != null && Object.keys(cols).length >= 5) return { r, cols };
  }
  return null;
}
function fitsKey(k, v, date1904) { return NUM_KEYS.includes(k) ? toNum(v) != null : k === 'recv' ? !!toISODate(v, date1904) : true; }
/* "(95 Patients)"; Edge v8 ends a grouped report with "(329 Total Patients)" */
const TOTAL_RE = /^\(?\s*\d[\d,]*\s+(?:total\s+)?(patients?|accounts?|records?)\s*\)?$/i;
/* Read one sheet of the report. Each value sits under its heading; Excel exports sometimes shift a value a column to the right
   (merged cells), so a cell belongs to the nearest heading at or to the left of it. A cell past a heading that already has its
   value (Edge puts the account's billing note there, with no heading) is kept as the note. */
function parseARGrid(grid, date1904) {
  const hd = findHeader(grid); if (!hd) return null;
  const heads = Object.keys(hd.cols).map(k => ({ k, c: hd.cols[k] })).sort((a, b) => a.c - b.c);
  const meta = { title: '', dateLine: '', asOf: '', options: '', subgroup: '', edge: '', stamp: '' };
  for (let r = 0; r < hd.r; r++) {
    for (const t of rowText(grid[r])) {
      if (t.length > 300) continue; // the lines above the columns are short
      if (/aging/i.test(t) && !meta.title) meta.title = t;
      if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(t) || /office:|doctor:/i.test(t)) { if (!meta.dateLine) { meta.dateLine = t; meta.asOf = reportDate(t); } }
      if (/exclude|include/i.test(t) && !meta.options) meta.options = t;
      const sg = /^subgroup:\s*(.*)$/i.exec(t); if (sg) meta.subgroup = sg[1].trim();
    }
    // the time the report was run (Edge puts it on the title line as an Excel date-time)
    for (const v of grid[r] || []) if (typeof v === 'number' && v > 36526 && v < 73051 && !meta.stamp) meta.stamp = toISODate(v, date1904);
  }
  if (!meta.asOf && meta.stamp) meta.asOf = meta.stamp;
  const rows = [], at = []; let total = null;
  for (let r = hd.r + 1; r < grid.length; r++) {
    const row = grid[r]; if (!row) continue;
    const texts = rowText(row); if (!texts.length) continue;
    const first = String(row.find(v => v != null && String(v).trim() !== '') || '').trim();
    const ev = texts.find(t => /^edge\s+v\d/i.test(t)); if (ev) { meta.edge = ev.replace(/^edge\s+v/i, ''); continue; }
    const o = {}, extra = [];
    row.forEach((v, c) => {
      if (v == null || String(v).trim() === '') return;
      let h = null; for (const x of heads) { if (x.c <= c) h = x; else break; }
      if (!h) return; // left of the first heading
      // a shifted value only counts for its heading if it's the right kind (a note never becomes an amount or a date)
      if (o[h.k] == null && (h.c === c || (!heads.some(x => x.c === c) && fitsKey(h.k, v, date1904)))) o[h.k] = v;
      else extra.push(String(v).trim());
    });
    // Edge's total line, "(95 Patients)"
    if (TOTAL_RE.test(first)) { total = { n: Number(first.replace(/\D/g, '')) || 0 }; NUM_KEYS.forEach(k => { const n = toNum(o[k]); if (n != null) total[k] = n; }); continue; }
    // page headings repeated inside a long export, and anything else that isn't an account
    if (headKey(o.patient) === 'patient' || /^(accounts receivable|subgroup:|page \d)/i.test(first)) continue;
    const patient = String(o.patient == null ? '' : o.patient).trim();
    const nums = {}; NUM_KEYS.forEach(k => { nums[k] = toNum(o[k]); });
    if (!patient || (nums.due == null && nums.bal == null && nums.b0 == null && nums.b90 == null)) continue;
    const bucketSum = round2((nums.b0 || 0) + (nums.b30 || 0) + (nums.b60 || 0) + (nums.b90 || 0)), acct = String(o.acct == null ? '' : o.acct).trim().slice(0, 20);
    rows.push(Object.assign({
      patient, sts: String(o.sts == null ? '' : o.sts).trim(), rp: String(o.rp == null ? '' : o.rp).trim(),
      home: String(o.home == null ? '' : o.home).trim(), work: String(o.work == null ? '' : o.work).trim(),
      due: nums.due != null ? round2(nums.due) : bucketSum,
      b0: round2(nums.b0 || 0), b30: round2(nums.b30 || 0), b60: round2(nums.b60 || 0), b90: round2(nums.b90 || 0),
      days: nums.days != null ? Math.round(nums.days) : null, bal: nums.bal != null ? round2(nums.bal) : null,
      lastAmt: nums.lastAmt != null ? round2(nums.lastAmt) : null, recv: o.recv != null ? toISODate(o.recv, date1904) : '',
      note: extra.join(' · ').slice(0, 300)
    }, acct ? { acct } : {})); // Edge's account ID, when the report has that column (Edge v8's insurance aging does)
    at.push(r);
  }
  return { meta, rows, total, cols: heads.map(h => h.k), at };
}
/* the file → { meta, rows, total, check } (check: Edge's own totals against the rows read) */
async function readEdgeAR(name, bytes) {
  const g = await readGridFile(name, bytes);
  return edgeFromGrid(g, name);
}
function edgeFromGrid(g, name) {
  let best = null;
  for (const sheet of g.sheets) { const p = parseARGrid(sheet, g.date1904); if (p && (!best || p.rows.length > best.rows.length)) best = p; }
  if (!best) throw errCode('not-ar', 'This doesn’t look like Edge’s Accounts Receivable Aging report (no “Patient … Amt Due … Balance” columns).');
  best.name = name || ''; best.kind = g.kind || 'text';
  best.check = checkTotals(best);
  return best;
}
/* do the rows add up to Edge's own total line? */
function checkTotals(p) {
  const t = p.total; if (!t) return { ok: null, why: 'No total line in this file to check against.' };
  const sum = k => round2(p.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
  const bad = [];
  if (t.n && t.n !== p.rows.length) bad.push(p.rows.length + ' accounts read, Edge says ' + t.n);
  [['due', 'Amt Due'], ['b0', '0-30'], ['b30', '31-60'], ['b60', '61-90'], ['b90', '91+'], ['bal', 'Balance']].forEach(([k, l]) => {
    if (t[k] != null && Math.abs(sum(k) - t[k]) > 0.05) bad.push(l + ' adds up to ' + money(sum(k), true) + ', Edge says ' + money(t[k], true));
  });
  return bad.length ? { ok: false, why: bad.join('; ') } : { ok: true, why: 'Matches Edge’s totals: ' + plural(p.rows.length, 'account') + (t.due != null ? ', ' + money(t.due, true) + ' due' : '') + (t.bal != null ? ', ' + money(t.bal, true) + ' balance' : '') + '.' };
}

/* =====================================================================
   OrthoBanc's "Failed Transaction Report" (FailedTransactions.xls, from
   OrthoBanc's Reports page). Each failed draft takes two lines:
     status · OB Reference # · Your Acct # (Edge's) · patient "Last, First"
       · responsible "Last, First" · the amount
     "Return Reason:" · the reason · "10/02/2026 Pmt" · the balance
   in two sections: "** Action On Your Part Is Needed **" (two drafts or
   more failed: OrthoBanc put the account on HOLD and asks the office to
   help) and "** No Action Required On Your Part **" (OrthoBanc contacts
   them itself). Read on this computer, like the A/R report.
   ===================================================================== */
const OB_REF = /^ob\d{4,}$/i;
/* "Last, First Middle" → "First Middle Last"; a name without a comma stays as it is */
function obName(s) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const m = /^([^,]+),\s*(.+)$/.exec(s); return m ? (m[2] + ' ' + m[1]).trim() : s;
}
function obCells(row) { const out = []; (row || []).forEach((v, c) => { if (v != null && String(v).trim() !== '') out.push({ c, v: typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v }); }); return out; }
function isOBSheet(grid) {
  const t = grid.slice(0, 16).map(r => rowText(r).join(' ')).join(' ');
  return /orthobanc/i.test(t) && /failed\s+transaction/i.test(t);
}
/* the report, or null when the file is something else */
function obFromGrid(g) {
  let grid = null;
  for (const sh of (g && g.sheets) || []) { const gr = Array.from(sh || [], r => r || []); if (isOBSheet(gr)) { grid = gr; break; } }
  if (!grid) return null;
  const rows = []; let asOf = '', hold = null, head = false, cur = null;
  for (const row of grid) {
    const cells = obCells(row); if (!cells.length) continue;
    const txt = cells.map(x => String(x.v)).join(' ');
    if (/action on your part is needed/i.test(txt)) { hold = true; continue; }
    if (/no action required/i.test(txt)) { hold = false; continue; }
    if (/^status\b/i.test(String(cells[0].v)) && /reference/i.test(txt)) { head = true; continue; }
    if (!head && hold === null) { if (!asOf) asOf = reportDate(txt); continue; } // the title lines: the report's date
    const ri = cells.findIndex(x => OB_REF.test(String(x.v)));
    if (ri >= 0) { // first line: who, and how much
      const after = cells.slice(ri + 1);
      const amt = after.length && toNum(after[after.length - 1].v) != null && !/[a-z]/i.test(String(after[after.length - 1].v)) ? toNum(after.pop().v) : null;
      const names = after.filter(x => /[a-z]/i.test(String(x.v))), acct = after.filter(x => !/[a-z]/i.test(String(x.v))).map(x => String(x.v)).join(' ');
      cur = { ref: String(cells[ri].v).toLowerCase(), status: cells.slice(0, ri).map(x => String(x.v)).join(' ').slice(0, 20), acct: acct.slice(0, 20),
        patient: obName(names[0] ? names[0].v : '').slice(0, 80), rp: obName(names[1] ? names[1].v : '').slice(0, 80), amt: amt == null ? null : round2(amt),
        hold: hold === true, reason: '', date: '', how: '', bal: null };
      rows.push(cur); continue;
    }
    if (cur && /return reason/i.test(txt)) { // second line: why it failed, when it was drafted, the balance
      const rest = cells.map(x => typeof x.v === 'string' ? Object.assign({}, x, { v: x.v.replace(/return reason\s*:?\s*/i, '').trim() }) : x).filter(x => String(x.v) !== '');
      const bal = rest.length && toNum(rest[rest.length - 1].v) != null && !/[a-z]/i.test(String(rest[rest.length - 1].v)) ? toNum(rest.pop().v) : null;
      const dc = rest.find(x => /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(String(x.v)));
      Object.assign(cur, { reason: rest.filter(x => x !== dc).map(x => String(x.v)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120),
        date: dc ? toISODate(dc.v) : '', how: dc ? String(dc.v).replace(/^\S+\s*/, '').slice(0, 30) : '', bal: bal == null ? null : round2(bal) });
      cur = null;
    }
  }
  const noWhy = rows.filter(r => !r.reason).length;
  return { ob: true, asOf, rows, check: noWhy ? { ok: false, why: plural(noWhy, 'failed payment') + ' without its reason line — check the whole report was exported.' } : { ok: true, why: plural(rows.length, 'failed payment') + ' read, each with its reason.' } };
}
async function readOBFailed(name, bytes) {
  const g = await readGridFile(name, bytes), p = obFromGrid(g);
  if (!p) throw errCode('not-ob', 'This isn’t OrthoBanc’s Failed Transaction Report.');
  return Object.assign(p, { name: name || '', kind: g.kind || 'text' });
}
/* =====================================================================
   Edge's "Insurance Accounts Receivable Aging" (6 Oct 2026). The A/R
   Aging's columns plus the account ID, insurance contracts only, grouped
   by carrier: each group starts with a line "Carrier name   -   phone"
   (just the name when Edge has no phone for it) and ends "(N Patients)";
   the last line, "(N Total Patients)", has the totals. The app reads it
   for one thing: which carrier each insurance account is with.
   ===================================================================== */
const INS_AGING_RE = /insurance\s+accounts?\s+receivable\s+aging/i;
function isInsAgingSheet(grid) { return grid.slice(0, 10).some(r => rowText(r).some(t => t.length < 200 && INS_AGING_RE.test(t))); }
/* "Delta Dental - MA      -   (800) 872-0500" → { name: 'Delta Dental - MA', phone: '(800) 872-0500' }; "Humana PPO" → no phone */
function edgeCarrierLine(t) {
  const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(), m = /^(.*\S)\s+-\s*([(+\d][\d\s().+-]*)$/.exec(s);
  if (m && (m[2].match(/\d/g) || []).length >= 7) return { name: m[1].trim().slice(0, 80), phone: m[2].trim().slice(0, 30) };
  return { name: s.replace(/\s+-\s*$/, '').trim().slice(0, 80), phone: '' };
}
/* the report, or null when the file is something else: { insAging, meta, asOf, rows (each with its carrier), groups, total, check } */
function insAgingFromGrid(g) {
  let best = null, seen = false;
  for (const sh of (g && g.sheets) || []) {
    const grid = Array.from(sh || [], r => r || []);
    if (!isInsAgingSheet(grid)) continue;
    seen = true;
    const p = parseARGrid(grid, g.date1904); if (!p) continue;
    const hd = findHeader(grid), dueCol = hd.cols.due != null ? hd.cols.due : Infinity, acctRow = new Set(p.at);
    // the lines between the accounts: a carrier's name (and phone), or the "(N Patients)" closing its group
    const heads = [], foots = [];
    for (let r = hd.r + 1; r < grid.length; r++) {
      if (acctRow.has(r)) continue;
      const cells = []; (grid[r] || []).forEach((v, c) => { if (v != null && String(v).trim() !== '') cells.push({ c, v }); });
      if (!cells.length) continue;
      const first = String(cells[0].v).trim();
      if (TOTAL_RE.test(first)) { if (!/total/i.test(first)) foots.push({ r, n: Number(first.replace(/\D/g, '')) || 0 }); continue; }
      if (cells.length > 2 || cells[0].c >= dueCol || cells.some(x => typeof x.v === 'number')) continue;
      const t = cells.map(x => String(x.v).trim()).join(' - ');
      if (/^edge\s+v\d/i.test(t) || INS_AGING_RE.test(t) || /accounts\s+receivable|^subgroup:|^page\s+\d|office:|doctor:|^(exclude|include)\b/i.test(t) || headKey(cells[0].v) === 'patient') continue;
      heads.push(Object.assign({ r, n: 0 }, edgeCarrierLine(t)));
    }
    // each account goes with the carrier line above it
    let hi = -1, loose = 0;
    const rows = p.rows.map((row, i) => {
      while (hi + 1 < heads.length && heads[hi + 1].r < p.at[i]) hi++;
      const h = heads[hi]; if (h) h.n++; else loose++;
      return Object.assign({}, row, { carrier: h ? h.name : '', cphone: h ? h.phone : '' });
    });
    // every group against its own "(N Patients)", and the whole report against Edge's total line
    const probs = [], tot = checkTotals(p);
    if (tot.ok === false) probs.push(tot.why);
    if (loose) probs.push(plural(loose, 'account') + ' above the first carrier line');
    heads.forEach((h, i) => { const end = i + 1 < heads.length ? heads[i + 1].r : Infinity, f = foots.filter(x => x.r > h.r && x.r < end).pop(); if (f && f.n !== h.n) probs.push(h.name + ': ' + h.n + ' read, Edge says ' + f.n); });
    const check = probs.length ? { ok: false, why: probs.slice(0, 4).join('; ') + (probs.length > 4 ? '; and ' + (probs.length - 4) + ' more' : '') }
      : tot.ok ? { ok: true, why: tot.why.replace(/\.$/, '') + ' — ' + plural(heads.length, 'carrier group') + ', each matching Edge’s count.' } : tot;
    const out = { insAging: true, meta: p.meta, asOf: p.meta.asOf, rows, groups: heads.map(h => ({ name: h.name, phone: h.phone, n: h.n })), total: p.total, check };
    if (!best || rows.length > best.rows.length) best = out;
  }
  if (seen && !best) throw errCode('bad-insaging', 'This looks like Edge’s Insurance Aging, but its columns (Patient … Amt Due … Balance) couldn’t be found.');
  return best;
}
async function readInsAging(name, bytes) {
  const g = await readGridFile(name, bytes), p = insAgingFromGrid(g);
  if (!p) throw errCode('not-insaging', 'This isn’t Edge’s Insurance Aging report.');
  return Object.assign(p, { name: name || '', kind: g.kind || 'text' });
}
/* =====================================================================
   Edge's task list, "Upcoming and Overdue Tasks" (8 Oct 2026) — how the
   FC kept her A/R work: grouped by operator (a line with the name), then
   one row per task: Task (a title with the patient's name in it), Due
   Date, Category, Creator, Description (a running log). Read here; the
   tasks are matched to accounts in ar.js (taskMatch).
   ===================================================================== */
const TASK_HEAD = [['title', /^(task|tasks|tasktitle|subject)$/], ['due', /^(duedate|due|date)$/], ['cat', /^(category|type)$/], ['creator', /^(creator|createdby|author)$/], ['desc', /^(description|notes|note|details)$/], ['op', /^(operator|assignedto|assignee|staff)$/]];
function taskHead(v) { const n = String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, ''); const h = TASK_HEAD.find(([, re]) => re.test(n)); return h ? h[0] : ''; }
/* the task list, or null when the file is something else: { edgeTasks, asOf, tasks: [{ op, title, due, cat, creator, desc }], check } */
function edgeTasksFromGrid(g) {
  for (const sh of (g && g.sheets) || []) {
    const grid = Array.from(sh || [], r => r || []);
    const top = grid.slice(0, 10).map(r => rowText(r).join(' ')).join(' ');
    let hr = -1, cols = null;
    for (let r = 0; r < Math.min(grid.length, 40) && hr < 0; r++) {
      const c = {}; (grid[r] || []).forEach((v, i) => { const k = taskHead(v); if (k && c[k] == null) c[k] = i; });
      if (c.title != null && c.due != null && (c.desc != null || c.creator != null)) { hr = r; cols = c; }
    }
    if (hr < 0 || !/task/i.test(top)) continue;
    let asOf = '';
    for (let r = 0; r < hr && !asOf; r++) for (const v of grid[r] || []) if (typeof v === 'number' && v > 36526 && v < 73051) { asOf = toISODate(v, g.date1904); break; }
    if (!asOf) for (let r = 0; r < hr && !asOf; r++) asOf = reportDate(rowText(grid[r]).join(' '));
    const txt = v => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const tasks = []; let op = '', odd = 0;
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r]; const texts = rowText(row); if (!texts.length) continue;
      const title = txt(row[cols.title]).replace(/\s+/g, ' ');
      if (/^edge\s+v\d/i.test(texts[0])) continue;
      const due = cols.due != null && row[cols.due] != null && String(row[cols.due]).trim() !== '' ? toISODate(row[cols.due], g.date1904) : '';
      const desc = cols.desc != null ? txt(row[cols.desc]) : '', creator = cols.creator != null ? txt(row[cols.creator]).slice(0, 60) : '';
      // a line with just a name: the operator the tasks below belong to
      if (title && !due && !desc && !creator && texts.length === 1) { op = title.slice(0, 60); continue; }
      if (!title) { odd++; continue; }
      if (cols.op != null && row[cols.op] != null && String(row[cols.op]).trim()) op = txt(row[cols.op]).slice(0, 60);
      tasks.push({ op, title: title.slice(0, 300), due, cat: cols.cat != null ? txt(row[cols.cat]).slice(0, 60) : '', creator, desc: desc.slice(0, 1800) });
    }
    const noDue = tasks.filter(t => !t.due).length, ops = Array.from(new Set(tasks.map(t => t.op).filter(Boolean)));
    const check = !tasks.length ? { ok: false, why: 'No tasks in this file.' } : noDue || odd ? { ok: false, why: plural(tasks.length, 'task') + ' read' + (noDue ? '; ' + noDue + ' without a due date' : '') + (odd ? '; ' + plural(odd, 'line') + ' without a task' : '') + '.' }
      : { ok: true, why: plural(tasks.length, 'task') + ' read' + (ops.length ? ' (' + ops.join(', ') + ')' : '') + ', each with its due date.' };
    return { edgeTasks: true, asOf, tasks, ops, check };
  }
  return null;
}
async function readEdgeTasks(name, bytes) {
  const g = await readGridFile(name, bytes), p = edgeTasksFromGrid(g);
  if (!p) throw errCode('not-tasks', 'This isn’t Edge’s task list (Upcoming and Overdue Tasks).');
  return Object.assign(p, { name: name || '', kind: g.kind || 'text' });
}
/* a file dropped on Reports: OrthoBanc's failed-payment report, Edge's Insurance Aging, Edge's task list, or Edge's A/R report */
async function readReportFile(name, bytes) {
  const g = await readGridFile(name, bytes), ob = obFromGrid(g);
  if (ob) return Object.assign(ob, { name: name || '', kind: g.kind || 'text' });
  const ia = insAgingFromGrid(g);
  if (ia) return Object.assign(ia, { name: name || '', kind: g.kind || 'text' });
  const et = edgeTasksFromGrid(g);
  return et ? Object.assign(et, { name: name || '', kind: g.kind || 'text' }) : edgeFromGrid(g, name);
}
