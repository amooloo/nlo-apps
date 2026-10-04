/* Dr. A: bring logins in from a spreadsheet or document, and encrypted backups. */
import { html, setHTML, $, $$, ic, toast, errorText, FOLDER_CLS, meterHTML, download, fmtDate, hostOf } from './common.js';
import { parseDoc } from '../html.js';
import * as S from '../store.js';
import { V, COLORS } from '../store.js';
import { FIELDS, parseDelimited, parseHtmlTables, guessColumns, rowsToItems, parseBlocks, sniff, looksLikeHeader, dupKey } from '../importer.js';
import { vaultPasswordProblem } from '../gen.js';
import { go, renderAll } from './vault.js';

let IMP = null;   // { kind: 'table'|'blocks', rows, map, hasHeader, sections, blocks, source }

export function renderImport(c) {
  if (!V.owner) return;
  setHTML(c, html`<div class="page narrow">
    <div class="pageHead"><h1>Import logins</h1>
      <p class="sub">From your spreadsheet or document. It’s read right here on this computer — nothing leaves it until each login is encrypted.</p></div>
    <section class="card pad" id="impStart">
      <h2><span class="stepN">1</span> Copy and paste it</h2>
      <ol class="steps small"><li>Open your spreadsheet (Excel, Google Sheets) or document (Word, Google Docs).</li>
        <li>Select everything (<kbd>Ctrl</kbd>+<kbd>A</kbd>, on a Mac <kbd>⌘</kbd>+<kbd>A</kbd>) and copy it (<kbd>Ctrl</kbd>+<kbd>C</kbd>).</li>
        <li>Click the box below and paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>).</li></ol>
      <div class="pasteBox" id="pasteBox" tabindex="0" role="textbox" aria-label="Paste your spreadsheet or document here" aria-multiline="true">
        ${ic('upload')}<span>Click here, then paste</span><span class="muted small">The passwords won’t be shown on screen.</span></div>
      <div class="or"><span>or</span></div>
      <label class="btn">${ic('folder')}<span>Choose a CSV file…</span><input type="file" id="impFile" accept=".csv,.tsv,.txt,text/csv,text/plain" class="visHidden"></label>
      <p class="muted small">Excel: File → Save As → “CSV”. Google Sheets: File → Download → “Comma-separated values”. Exports from Chrome, LastPass, Bitwarden or 1Password work too.</p>
    </section>
    <div id="impPreview"></div>
  </div>`);
  const box = $('#pasteBox', c);
  // the paste is read straight from the clipboard event; it is never put on the page
  box.addEventListener('paste', e => {
    e.preventDefault();
    const cd = e.clipboardData; if (!cd) return;
    const htmlText = cd.getData('text/html'), text = cd.getData('text/plain');
    let rows = null;
    if (htmlText && /<table/i.test(htmlText)) {
      const doc = parseDoc(htmlText);
      rows = parseHtmlTables(doc);
      if (rows.length < 1) rows = null;
    }
    loadSource(rows, text, 'pasted');
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toast('Now paste: Ctrl+V (⌘+V on a Mac)'); } });
  box.addEventListener('click', () => box.focus());
  $('#impFile', c).addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('That file is too big for a list of logins', { kind: 'bad' }); return; }
    const text = await f.text(); e.target.value = '';
    loadSource(null, text, f.name);
  });
  if (IMP) drawPreview();
}
function loadSource(rows, text, source) {
  if (rows) { IMP = tableState(rows, source); }
  else {
    const kind = sniff(text);
    if (kind === 'empty') { toast('Nothing was pasted. Copy the spreadsheet first, then paste.', { kind: 'warn' }); return; }
    if (kind === 'table') IMP = tableState(parseDelimited(text).rows, source);
    else IMP = { kind: 'blocks', blocks: parseBlocks(text), source, target: '', dup: 'skip' };
  }
  const pb = $('#pasteBox'); if (pb) setHTML(pb, html`${ic('check')}<span>${source === 'pasted' ? 'Pasted' : 'Read ' + source} — check below</span><span class="muted small">Paste again to replace it.</span>`);
  drawPreview();
}
function tableState(rows, source) {
  rows = rows.filter(r => r.some(c => c && c.trim()));
  const hasHeader = looksLikeHeader(rows[0]);
  const singles = rows.filter(r => r.filter(c => c && c.trim()).length === 1 && r.length > 1).length;
  const st = { kind: 'table', rows, hasHeader, map: guessColumns(rows, hasHeader), sections: singles >= 2, source, target: '', dup: 'skip' };
  st.useFolderCol = st.map.includes('folder') || st.sections;
  return st;
}
function currentItems() {
  if (!IMP) return [];
  return IMP.kind === 'table' ? rowsToItems(IMP.rows, IMP.map, { hasHeader: IMP.hasHeader, sections: IMP.sections }) : IMP.blocks;
}
function folderByName(name) {
  const n = String(name || '').trim().toLowerCase(); if (!n) return null;
  return S.folderList().find(f => String(f.name).trim().toLowerCase() === n) || null;
}
function plan() {
  const items = currentItems();
  const fallback = IMP.target || '';
  const newFolders = new Map();
  const existing = new Set(Array.from(V.items.values()).filter(i => i.d && !i.del).map(i => dupKey(i.f, i.d.t, i.d.u)));
  const seen = new Set();
  const rows = items.map(it => {
    let fid = fallback, newName = '';
    if (IMP.useFolderCol && it.folder) {
      const f = folderByName(it.folder);
      if (f) fid = f.id; else { newName = it.folder.trim(); fid = 'new:' + newName.toLowerCase(); newFolders.set(fid, newName); }
    }
    const key = dupKey(fid, it.t, it.u);
    const dup = existing.has(key) || seen.has(key); seen.add(key);
    return { it, fid, dup, newName };
  });
  return { rows, newFolders, dups: rows.filter(r => r.dup).length };
}
function drawPreview() {
  const el = $('#impPreview'); if (!el || !IMP) return;
  const p = plan(), items = p.rows;
  const editable = S.folderList();
  // logins with no folder of their own go to Dr. A's private folder unless he picks another
  if (!IMP.target) IMP.target = (S.privateFolder() || {}).id || '';
  const toImport = items.filter(r => !(r.dup && IMP.dup === 'skip'));
  const width = IMP.kind === 'table' ? Math.max(0, ...IMP.rows.map(r => r.length)) : 0;
  const body = IMP.kind === 'table' ? (IMP.hasHeader ? IMP.rows.slice(1) : IMP.rows) : [];
  const mask = (v, i) => IMP.kind === 'table' && (IMP.map[i] === 'pass' || IMP.map[i] === 'totp') && v ? '••••••' : v;
  const folderCounts = new Map(); toImport.forEach(r => folderCounts.set(r.fid, (folderCounts.get(r.fid) || 0) + 1));
  setHTML(el, html`
    <section class="card pad">
      <h2><span class="stepN">2</span> Check what was found</h2>
      ${IMP.kind === 'table' ? html`
        <p>${body.length} rows. Tell the vault what each column holds:</p>
        <div class="tblWrap"><table class="tbl preview"><thead><tr>${Array.from({ length: width }, (_, i) => html`<th><select data-col="${i}" aria-label="Column ${i + 1}">${FIELDS.map(([k, l]) => html`<option value="${k}" ${IMP.map[i] === k ? 'selected' : ''}>${l}</option>`)}</select>
          ${IMP.hasHeader && IMP.rows[0][i] ? html`<div class="muted small">“${IMP.rows[0][i]}”</div>` : ''}</th>`)}</tr></thead>
          <tbody>${body.slice(0, 8).map(r => html`<tr>${Array.from({ length: width }, (_, i) => html`<td class="${IMP.map[i] === 'skip' ? 'skipCol' : ''}">${mask(r[i] || '', i)}</td>`)}</tr>`)}</tbody></table></div>
        ${body.length > 8 ? html`<p class="muted small">…and ${body.length - 8} more rows.</p>` : ''}
        <label class="chk"><input type="checkbox" id="impHead" ${IMP.hasHeader ? 'checked' : ''}> The first row is headings (not a login)</label>
        <label class="chk"><input type="checkbox" id="impSec" ${IMP.sections ? 'checked' : ''}> A row with just one thing in it (like “FRONT OFFICE”) is a section heading</label>`
      : html`<p>Found <b>${IMP.blocks.length}</b> ${IMP.blocks.length === 1 ? 'login' : 'logins'} in the document (blocks with a username or password; other text is left out).</p>
        <ul class="plain small">${IMP.blocks.slice(0, 12).map(b => html`<li><b>${b.t}</b>${b.ds ? html` <span class="muted">— ${b.ds}</span>` : ''}${b.u ? html` · ${b.u}` : ''}${b.p ? ' · ••••' : html` · <span class="muted">no password</span>`}${b.url ? html` · <span class="muted">${hostOf(b.url)}</span>` : ''}${b.fx.length ? html` · <span class="muted">+${b.fx.length} field${b.fx.length > 1 ? 's' : ''}</span>` : ''}</li>`)}</ul>
        ${IMP.blocks.length > 12 ? html`<p class="muted small">…and ${IMP.blocks.length - 12} more.</p>` : ''}
        <p class="muted small">If a login is missing, check it has a line like “Username: …” or “Password: …”. You can always add or fix logins by hand afterwards.</p>`}
    </section>
    <section class="card pad">
      <h2><span class="stepN">3</span> Where they go</h2>
      ${(IMP.kind === 'table' && (IMP.map.includes('folder') || IMP.sections)) || items.some(r => r.it.folder) ? html`
        <label class="chk"><input type="checkbox" id="impUseCol" ${IMP.useFolderCol ? 'checked' : ''}> Put each login in the folder named in its ${IMP.sections && !IMP.map.includes('folder') ? 'section heading' : 'Folder column'}</label>` : ''}
      <label class="fld inline"><span>${IMP.useFolderCol ? 'Logins with no folder named go in' : 'Put them all in'}</span>
        <select id="impTarget">${IMP.target ? '' : html`<option value="" selected disabled>Choose a folder…</option>`}${editable.map(f => html`<option value="${f.id}" ${IMP.target === f.id ? 'selected' : ''}>${f.name}</option>`)}</select></label>
      ${p.newFolders.size && IMP.useFolderCol ? html`<p class="small">New folders will be made: ${Array.from(p.newFolders.values()).map(n => html`<span class="fchip fc-gray">${n}</span> `)} <span class="muted">(only you can open them until you share them)</span></p>` : ''}
      ${p.dups ? html`<label class="fld inline"><span>${p.dups} ${p.dups === 1 ? 'is' : 'are'} already in the vault (same name and username)</span>
        <select id="impDup"><option value="skip" ${IMP.dup === 'skip' ? 'selected' : ''}>Skip ${p.dups === 1 ? 'it' : 'them'}</option><option value="add" ${IMP.dup === 'add' ? 'selected' : ''}>Add anyway</option></select></label>` : ''}
      <ul class="plain small">${Array.from(folderCounts.entries()).map(([fid, n]) => html`<li>${!fid ? 'Not chosen yet' : fid.startsWith('new:') ? p.newFolders.get(fid) + ' (new)' : (V.folders.get(fid) || {}).name}: <b>${n}</b></li>`)}</ul>
      <p id="impErr" class="err hidden" role="alert"></p>
      <button type="button" class="btn primary" id="impGo" ${toImport.length ? '' : 'disabled'}>${ic('upload')}<span>Import ${toImport.length} ${toImport.length === 1 ? 'login' : 'logins'}</span></button>
      <button type="button" class="btn subtle" id="impCancel">Start over</button>
    </section>`);
  $$('select[data-col]', el).forEach(s => s.addEventListener('change', () => { IMP.map[+s.dataset.col] = s.value; if (s.value === 'folder') IMP.useFolderCol = true; drawPreview(); }));
  const on = (id, ev, fn) => { const x = $('#' + id, el); if (x) x.addEventListener(ev, fn); };
  on('impHead', 'change', e => { IMP.hasHeader = e.target.checked; IMP.map = guessColumns(IMP.rows, IMP.hasHeader); drawPreview(); });
  on('impSec', 'change', e => { IMP.sections = e.target.checked; if (IMP.sections) IMP.useFolderCol = true; drawPreview(); });
  on('impUseCol', 'change', e => { IMP.useFolderCol = e.target.checked; drawPreview(); });
  on('impTarget', 'change', e => { IMP.target = e.target.value; drawPreview(); });
  on('impDup', 'change', e => { IMP.dup = e.target.value; drawPreview(); });
  on('impCancel', 'click', () => { IMP = null; renderImport($('#content')); });
  on('impGo', 'click', () => runImport());
}
async function runImport() {
  const p = plan();
  const rows = p.rows.filter(r => !(r.dup && IMP.dup === 'skip'));
  if (rows.some(r => !r.fid)) {
    const x = $('#impErr'); if (x) { x.textContent = 'Choose which folder the logins go in.'; x.classList.remove('hidden'); }
    return;
  }
  const btn = $('#impGo'); btn.disabled = true;
  const prog = (t) => setHTML(btn, html`${ic('upload')}<span>${t}</span>`);
  try {
    // folders named in the sheet that don't exist yet
    const made = new Map(); let ci = 0;
    for (const [key, name] of p.newFolders) {
      if (!rows.some(r => r.fid === key)) continue;
      prog('Making folder ' + name + '…');
      const used = S.folderList().map(f => f.color);
      const color = COLORS.find(c => !used.includes(c) && c !== 'gray') || COLORS[ci++ % COLORS.length];
      made.set(key, await S.createFolder({ name, color, def: null }));
    }
    // folder keys arrive through the live listener; wait until each new folder can be written to
    for (const fid of made.values()) {
      for (let i = 0; i < 50 && !(V.folders.get(fid) && V.folders.get(fid).keys.get(1)); i++) await new Promise(r => setTimeout(r, 100));
    }
    const list = rows.map(r => {
      const it = r.it, d = { t: it.t, ds: it.ds || '', url: it.url || '', u: it.u || '', p: it.p || '', n: it.n || '', totp: it.totp || '', fx: it.fx || [], rep: it.rep || { n: '', ph: '', em: '' }, ml: !!it.ml };
      return { fid: made.get(r.fid) || r.fid, d };
    });
    const n = await S.addItems(list, (done, total) => prog('Encrypting and saving ' + done + ' of ' + total + '…'));
    S.log('import', { n });
    const folders = new Set(list.map(x => x.fid)).size;
    IMP = null;
    setHTML($('#content'), html`<div class="page narrow"><section class="card pad done">
      <h1>${ic('check')} Imported ${n} ${n === 1 ? 'login' : 'logins'}</h1>
      <p>Into ${folders} ${folders === 1 ? 'folder' : 'folders'}. Look through them, then:</p>
      <div class="callout hot">${ic('alert')}<div><b>Delete the original ${'spreadsheet or document'} now.</b> It still has every password in plain text. Delete it, then empty the Recycle Bin (or Google Drive’s Trash). Also delete any printed copies and emailed copies.</div></div>
      <p class="muted small">Staff only see a folder after you give them access (People &amp; access).</p>
      <div class="btnRow"><button type="button" class="btn primary" data-act="go" data-v="all">See all logins</button><button type="button" class="btn" data-act="go" data-v="team">People &amp; access</button><button type="button" class="btn" data-act="go" data-v="import">Import more</button></div>
    </section></div>`);
    renderAll(true);
  } catch (er) {
    btn.disabled = false; prog('Try again');
    const x = $('#impErr'); if (x) { x.textContent = errorText(er) + ' — logins already saved stay saved; importing again offers to skip them.'; x.classList.remove('hidden'); }
  }
}

/* ---------- encrypted backup ---------- */
let RESTORE = null;
export function renderBackup(c) {
  if (!V.owner) return;
  const n = Array.from(V.items.values()).filter(i => i.d && !i.del).length;
  setHTML(c, html`<div class="page narrow">
    <div class="pageHead"><h1>Backup</h1><p class="sub">An encrypted copy of every login (${n}), in case the online service is ever lost.</p></div>
    <section class="card pad"><h2>Download an encrypted backup</h2>
      <p>Choose a <b>backup password</b>. The file is useless without it — to anyone, including you — so write it down with your recovery code. Keep the file on a USB stick in the office safe, not on a shared computer.</p>
      <form id="bkForm" novalidate autocomplete="off">
        <label class="fld"><span>Backup password</span><input id="bkPw" type="password" autocomplete="new-password" maxlength="200"></label>
        <div id="bkMeter"></div>
        <label class="fld"><span>Again</span><input id="bkPw2" type="password" autocomplete="new-password" maxlength="200"></label>
        <p id="bkErr" class="err hidden" role="alert"></p>
        <button type="submit" class="btn primary" id="bkBtn">${ic('download')}<span>Download backup</span></button>
      </form></section>
    <section class="card pad"><h2>Restore from a backup</h2>
      <p class="muted">Adds the logins from a backup file back into the vault. Logins already here (same name and username in the same folder) are skipped.</p>
      <label class="fld"><span>Backup file</span><input type="file" id="rsFile" accept=".nlovault,.json,application/json"></label>
      <label class="fld"><span>Its backup password</span><input id="rsPw" type="password" autocomplete="off" maxlength="200"></label>
      <p id="rsErr" class="err hidden" role="alert"></p>
      <button type="button" class="btn" id="rsOpen">Open the backup</button>
      <div id="rsInfo"></div></section>
  </div>`);
  $('#bkPw', c).addEventListener('input', () => setHTML($('#bkMeter', c), meterHTML($('#bkPw', c).value, ['nlo', 'vault', 'backup'])));
  $('#bkForm', c).addEventListener('submit', async e => {
    e.preventDefault();
    const err = t => { const x = $('#bkErr', c); x.textContent = t; x.classList.toggle('hidden', !t); };
    err('');
    const pw = $('#bkPw', c).value;
    const prob = vaultPasswordProblem(pw, ['nlo', 'vault', 'backup']); if (prob) return err(prob);
    if (pw !== $('#bkPw2', c).value) return err('The two passwords don’t match.');
    const btn = $('#bkBtn', c); btn.disabled = true;
    try {
      const text = await S.backupFile(pw);
      const d = new Date(), stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      download('NLO-Vault-backup-' + stamp + '.nlovault', text, 'application/json');
      $('#bkForm', c).reset(); setHTML($('#bkMeter', c), '');
      toast('Backup downloaded — move it to the USB stick and delete it from Downloads');
    } catch (er) { err(errorText(er)); }
    btn.disabled = false;
  });
  $('#rsOpen', c).addEventListener('click', async () => {
    const err = t => { const x = $('#rsErr', c); x.textContent = t; x.classList.toggle('hidden', !t); };
    err('');
    const f = $('#rsFile', c).files && $('#rsFile', c).files[0];
    if (!f) return err('Choose the backup file first.');
    const btn = $('#rsOpen', c); btn.disabled = true; btn.textContent = 'Opening…';
    try {
      RESTORE = await S.readBackup(await f.text(), $('#rsPw', c).value);
      drawRestore();
    } catch (er) { err(er.code === 'bad-backup-password' ? 'That backup password doesn’t open this file.' : er.code === 'not-backup' ? 'That isn’t an NLO Vault backup file.' : errorText(er)); }
    btn.disabled = false; btn.textContent = 'Open the backup';
  });
}
function drawRestore() {
  const el = $('#rsInfo'); if (!el || !RESTORE) return;
  const byFolder = new Map();
  RESTORE.items.forEach(x => byFolder.set(x.f, (byFolder.get(x.f) || 0) + 1));
  const names = new Map(RESTORE.folders.map(f => [f.id, f.name]));
  const existing = new Set(Array.from(V.items.values()).filter(i => i.d && !i.del).map(i => dupKey(String((V.folders.get(i.f) || {}).name || '').toLowerCase(), i.d.t, i.d.u)));
  const fresh = RESTORE.items.filter(x => !existing.has(dupKey(String(names.get(x.f) || '').toLowerCase(), x.d.t, x.d.u)));
  setHTML(el, html`<div class="callout">${ic('info')}<div>Backup from <b>${fmtDate(RESTORE.at)}</b>${RESTORE.by ? ' by ' + RESTORE.by : ''}: ${RESTORE.items.length} logins in ${byFolder.size} folders.
    <b>${fresh.length}</b> aren’t in the vault now.</div></div>
    <ul class="plain small">${Array.from(byFolder.entries()).map(([fid, n]) => html`<li>${names.get(fid) || 'Folder'}: ${n}${folderByName(names.get(fid)) ? '' : html` <span class="muted">(folder will be made)</span>`}</li>`)}</ul>
    <button type="button" class="btn primary" id="rsGo" ${fresh.length ? '' : 'disabled'}>Add ${fresh.length} ${fresh.length === 1 ? 'login' : 'logins'} back</button>`);
  $('#rsGo', el).addEventListener('click', async () => {
    const btn = $('#rsGo', el); btn.disabled = true;
    try {
      const made = new Map();
      for (const [fid] of byFolder) {
        const name = names.get(fid) || 'Restored';
        const ex = folderByName(name);
        if (ex) made.set(fid, ex.id);
        else {
          const color = (RESTORE.folders.find(f => f.id === fid) || {}).color;
          const nf = await S.createFolder({ name, color, def: null }); made.set(fid, nf);
          for (let i = 0; i < 50 && !(V.folders.get(nf) && V.folders.get(nf).keys.get(1)); i++) await new Promise(r => setTimeout(r, 100));
        }
      }
      const list = fresh.map(x => ({ fid: made.get(x.f), d: Object.assign({}, x.d) }));
      const n = await S.addItems(list, (d, t) => { btn.textContent = 'Saving ' + d + ' of ' + t + '…'; });
      S.log('import', { n });
      RESTORE = null; toast('Added ' + n + ' logins back'); go('all');
    } catch (er) { btn.disabled = false; toast(errorText(er), { kind: 'bad' }); }
  });
}
export function onImportClick() { }
