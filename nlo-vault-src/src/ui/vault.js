/* The open vault: folders on the left, logins in the middle, the chosen login on the right. */
import { html, raw, setHTML, $, $$, ic, toast, errorText, openModal, confirmBox, fmtWhen, fmtDate, ago, copyText,
  startIdleLock, FOLDER_CLS, initials, meterHTML, hostOf, safeUrl, closeAllModals } from './common.js';
import * as S from '../store.js';
import { V } from '../store.js';
import { strength } from '../gen.js';
import { parseTotp, totpCode, totpLeft } from '../totp.js';
import { genChars, genWords } from '../gen.js';
import { LOGO } from '../assets.js';
import * as A from './admin.js';
import * as I from './import.js';

export const U = { view: 'all', q: '', sel: null, side: false, detail: false, revealed: new Set(), sort: 'name' };
const LIST_VIEWS = v => v === 'all' || v === 'fav' || v === 'ml' || v === 'trash' || v.startsWith('folder:');
const ML = 'Mari’s List';
const STATIC_VIEWS = ['import', 'backup', 'settings'];   // pages with typing in them: drawn once, not on every change
let lockedOut = false;

/* ---------- helpers ---------- */
const favs = () => new Set(V.prefs.favs || []);
const strengthCache = new Map();
export function pwStrength(p) {
  if (!p) return null;
  if (!strengthCache.has(p)) { if (strengthCache.size > 2000) strengthCache.clear(); strengthCache.set(p, strength(p)); }
  return strengthCache.get(p);
}
export function healthOf() {
  const items = Array.from(V.items.values()).filter(i => i.d && !i.del);
  const out = { bad: [], chg: [], weak: [], reused: [], old: [], nopw: [] };
  const byPw = new Map();
  const yearAgo = Date.now() - 365 * 86400000;
  for (const it of items) {
    const p = it.d.p || '';
    if (it.d.bad) out.bad.push(it);
    if (it.d.chg) out.chg.push(it);
    if (!p) { out.nopw.push(it); continue; }
    const st = pwStrength(p); if (st && st.score < 2) out.weak.push(it);
    if ((it.d.pwAt || it.cAt || Date.now()) < yearAgo) out.old.push(it);
    if (!byPw.has(p)) byPw.set(p, []); byPw.get(p).push(it);
  }
  for (const group of byPw.values()) if (group.length > 1) out.reused.push(group);
  out.count = new Set([].concat(out.bad, out.chg, out.weak, out.reused.flat(), out.old).map(i => i.id)).size;
  out.reusedIds = new Set(out.reused.flat().map(i => i.id));
  return out;
}
function title(it) { return it.d ? (it.d.t || hostOf(it.d.url) || it.d.u || 'Untitled') : S.untrusted(it) ? 'Locked with an unknown key' : it.err === 'locked' ? 'Waiting for the folder key…' : 'Can’t be opened'; }
function folderName(fid) { const f = V.folders.get(fid); return f ? f.name : '—'; }
function folderColor(fid) { const f = V.folders.get(fid); return f ? f.color : 'gray'; }
function matches(it, q) {
  if (!it.d) return false;
  const d = it.d;
  const r = d.rep || {};
  const hay = [d.t, d.ds, d.u, d.url, d.n, folderName(it.f), r.n, r.ph, r.em, d.ml ? 'mari’s list mari\'s list maris list' : '', d.bad ? 'not working ' + d.bad.why : ''].concat((d.fx || []).map(f => f.l + ' ' + (f.h ? '' : f.v))).join(' \n ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
function visibleItems() {
  const v = U.view, fv = favs();
  let list = Array.from(V.items.values());
  list = v === 'trash' ? list.filter(i => i.del) : list.filter(i => !i.del);
  if (v === 'fav') list = list.filter(i => fv.has(i.id));
  if (v === 'ml') list = list.filter(i => i.d && i.d.ml);
  if (v.startsWith('folder:')) { const fid = v.slice(7); list = list.filter(i => i.f === fid); }
  if (U.q.trim()) list = list.filter(i => matches(i, U.q));
  const t = it => title(it).toLowerCase();
  if (U.sort === 'recent') list.sort((a, b) => ((b.d && b.d.mAt) || b.at) - ((a.d && a.d.mAt) || a.at));
  else list.sort((a, b) => t(a).localeCompare(t(b), undefined, { numeric: true }));
  return list;
}
function viewTitle() {
  const v = U.view;
  if (v === 'all') return 'All logins';
  if (v === 'fav') return 'Favorites';
  if (v === 'ml') return ML;
  if (v === 'trash') return 'Trash';
  if (v.startsWith('folder:')) return folderName(v.slice(7));
  return { health: 'Needs attention', team: 'People & access', activity: 'Activity', import: 'Import', backup: 'Backup', settings: 'Settings' }[v] || '';
}
export function avatar(it, big) {
  const src = it.d ? logoSrc(logoOf(it)) : '';
  if (src) return html`<span class="av logo ${big ? 'big' : ''}" aria-hidden="true"><img src="${src}" alt=""></span>`;
  const c = it.d ? title(it) : '?';
  return html`<span class="av ${FOLDER_CLS(folderColor(it.f))} ${big ? 'big' : ''}" aria-hidden="true">${initials(c)}</span>`;
}

/* the vendor's rep: tap to call or email, or copy */
const telHref = s => { const t = String(s || '').replace(/[^0-9+]/g, ''); return t.replace(/\D/g, '').length >= 7 ? 'tel:' + t : ''; };
const mailHref = s => /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(String(s || '').trim()) ? 'mailto:' + String(s).trim() : '';
function repRows(it) {
  const r = it.d.rep || {};
  if (!r.n && !r.ph && !r.em) return '';
  const tel = telHref(r.ph), mail = mailHref(r.em);
  return html`${r.n ? html`<div class="f"><dt>Rep</dt><dd><span class="val">${r.n}</span><span class="fa"><button type="button" class="iconBtn" data-act="copy" data-k="repN" data-id="${it.id}" title="Copy">${ic('copy')}</button></span></dd></div>` : ''}
    ${r.ph ? html`<div class="f"><dt>Rep phone</dt><dd><span class="val">${tel ? html`<a href="${tel}">${r.ph}</a>` : r.ph}</span><span class="fa">${tel ? html`<a class="iconBtn" href="${tel}" title="Call">${ic('call')}</a>` : ''}<button type="button" class="iconBtn" data-act="copy" data-k="repPh" data-id="${it.id}" title="Copy">${ic('copy')}</button></span></dd></div>` : ''}
    ${r.em ? html`<div class="f"><dt>Rep email</dt><dd><span class="val">${mail ? html`<a href="${mail}">${r.em}</a>` : r.em}</span><span class="fa">${mail ? html`<a class="iconBtn" href="${mail}" title="Email">${ic('mail')}</a>` : ''}<button type="button" class="iconBtn" data-act="copy" data-k="repEm" data-id="${it.id}" title="Copy">${ic('copy')}</button></span></dd></div>` : ''}`;
}

/* "not working": what's wrong / what to do (optional) */
function notWorkingBox(name) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(html`<div class="mhead"><h2>${name}: not working</h2></div>
      <div class="mbody"><p>It gets a red “Not working” mark and shows under Needs attention until someone clicks “It works again” (or saves a new password).</p>
        <label class="fld"><span>What’s wrong, or what to do <span class="muted">(optional)</span></span><input id="nwWhy" maxlength="300" autocomplete="off" placeholder="e.g. Locked out — call the company to reset it"></label></div>
      <div class="mfoot"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn primary" data-yes>Mark as not working</button></div>`,
      { label: 'Not working', onClose: () => { if (!answered) resolve(null); } });
    m.el.querySelector('[data-no]').addEventListener('click', () => { answered = true; resolve(null); m.close(true); });
    m.el.querySelector('[data-yes]').addEventListener('click', () => { answered = true; resolve($('#nwWhy', m.el).value.replace(/\s+/g, ' ').trim()); m.close(true); });
  });
}

/* ---------- company logos ----------
   A logo is a small picture made here from a file or a pasted image and sealed inside the login like everything else.
   A login without one borrows the logo of another login for the same website (or with the same name). */
let logoMap = null;
const siteKey = u => { const h = hostOf(u || '').toLowerCase().replace(/^www\./, ''); return h ? h.split('.').slice(-2).join('.') : ''; };
function sharedLogos() {
  if (logoMap) return logoMap;
  logoMap = new Map();
  for (const x of V.items.values()) {
    const d = x.d; if (!d || !d.lg || x.del) continue;
    const h = siteKey(d.url), t = String(d.t || '').trim().toLowerCase();
    if (h && !logoMap.has('h:' + h)) logoMap.set('h:' + h, d.lg);
    if (t && !logoMap.has('t:' + t)) logoMap.set('t:' + t, d.lg);
  }
  return logoMap;
}
function logoOf(it) {
  const d = it.d; if (!d) return '';
  if (d.lg) return d.lg;
  const m = sharedLogos(), h = siteKey(d.url), t = String(d.t || '').trim().toLowerCase();
  return (h && m.get('h:' + h)) || (t && m.get('t:' + t)) || '';
}
/* shown through short blob: addresses instead of repeating the picture's text in every row */
const logoUrls = new Map();
function logoSrc(data) {
  if (!data || !S.okLogo(data)) return '';
  let u = logoUrls.get(data);
  if (!u) {
    const i = data.indexOf(','), bin = atob(data.slice(i + 1)), b = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) b[k] = bin.charCodeAt(k);
    u = URL.createObjectURL(new Blob([b], { type: data.slice(5, data.indexOf(';')) }));
    logoUrls.set(data, u);
  }
  return u;
}
/* a picture file -> a small logo (at most 128 px, transparent kept; WebP, or PNG where WebP can't be made) */
async function makeLogo(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('That isn’t a picture. Choose a PNG, JPG, WebP or SVG file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('That picture is too big (over 10 MB).');
  let src, w, h, done = () => { };
  try { const bmp = await createImageBitmap(file); src = bmp; w = bmp.width; h = bmp.height; done = () => bmp.close(); }
  catch (e) {
    const url = URL.createObjectURL(file), img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e2) { URL.revokeObjectURL(url); throw new Error('That picture couldn’t be read. Try a PNG or JPG.'); }
    src = img; w = img.naturalWidth || 256; h = img.naturalHeight || 256; done = () => URL.revokeObjectURL(url);
  }
  try {
    for (const size of [128, 96, 64, 48]) {
      const k = Math.min(1, size / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, cw, ch);
      let out = c.toDataURL('image/webp', 0.9);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      if (S.okLogo(out) && out.length <= 48000) return out;
    }
    throw new Error('That picture has too much detail to use as a logo. Try a simpler one.');
  } finally { done(); }
}

/* ---------- the frame ---------- */
export function showVault() {
  lockedOut = false;
  setHTML($('#root'), html`
  <div class="app" id="app">
    <aside class="side" id="side" aria-label="Folders and tools"></aside>
    <div class="scrim" id="scrim"></div>
    <div class="mainCol">
      <header class="top">
        <button type="button" class="iconBtn mobOnly" data-act="menu" aria-label="Folders and tools">${ic('menu')}</button>
        <div class="searchBox">${ic('search')}<input id="q" type="search" placeholder="Search logins" autocomplete="off" spellcheck="false" aria-label="Search logins"></div>
        <button type="button" class="btn primary" id="newBtn" data-act="new">${ic('plus')}<span class="deskOnly">New login</span></button>
        <button type="button" class="lockBtn" data-act="lock" title="Lock the vault now">${ic('lock')}<span id="lockLeft">Lock</span></button>
      </header>
      <div id="banner"></div>
      <div class="content" id="content"></div>
    </div>
  </div>`);
  const q = $('#q');
  q.addEventListener('input', () => { U.q = q.value; if (!LIST_VIEWS(U.view)) { U.view = 'all'; } renderAll(); });
  q.addEventListener('keydown', e => { if (e.key === 'Escape') { q.value = ''; U.q = ''; renderAll(); } if (e.key === 'Enter') { const first = visibleItems()[0]; if (first) select(first.id); } });
  $('#root').addEventListener('click', onClick);
  $('#root').addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);
  S.onChange(scheduleRender);
  startIdleLock(() => lockNow('idle'), left => {
    const el = $('#lockLeft'); if (!el) return;
    const s = Math.ceil(left / 1000);
    el.textContent = s <= 60 ? 'Locks in ' + s + 's' : 'Lock';
    el.parentElement.classList.toggle('soon', s <= 60);
  });
  renderAll();
  setTimeout(resumeRotations, 1500);
}
let queued = false;
function scheduleRender() {
  if (queued) return; queued = true;
  requestAnimationFrame(() => { queued = false; renderAll(true); });
}
export function renderAll(fromData) {
  if (lockedOut) return;
  logoMap = null;
  if (V.revoked || (V.me && V.me.active === false)) { lockNow('removed'); return; }
  try { renderSide(); renderBanner(); } catch (e) { console.error(e); }
  if (fromData && STATIC_VIEWS.includes(U.view)) return;
  renderContent();
}
export function go(view) {
  U.view = view; U.side = false; U.detail = false;
  if (!LIST_VIEWS(view)) { U.q = ''; const q = $('#q'); if (q) q.value = ''; }
  renderAll();
  const c = $('#content'); if (c) c.scrollTop = 0;
}
function renderBanner() {
  const b = $('#banner'); if (!b) return;
  const rot = S.unfinishedRotations();
  if (V.failures > 0 && !navigator.onLine) setHTML(b, html`<div class="banner warn">${ic('alert')}<span>No internet connection — changes will save once it’s back.</span></div>`);
  else if (rot.length && !rotating) setHTML(b, html`<div class="banner warn">${ic('alert')}<span>A folder’s key change didn’t finish (the page was closed part-way).</span><button type="button" class="btn small" data-act="resumeRot">Finish now</button></div>`);
  else if (V.owner && V.loaded && U.view !== 'backup' && Array.from(V.items.values()).filter(i => !i.del).length >= 5 && Date.now() - (V.prefs.bk || 0) > 30 * 86400000)
    setHTML(b, html`<div class="banner">${ic('download')}<span>${V.prefs.bk ? 'Your last backup was ' + Math.floor((Date.now() - V.prefs.bk) / 86400000) + ' days ago.' : 'No backup yet.'} Keep an encrypted copy in the office safe.</span><button type="button" class="btn small" data-act="go" data-v="backup">Back up now</button></div>`);
  else setHTML(b, '');
}
function navBtn(view, icon, label, count, extra) {
  return html`<button type="button" class="nav ${U.view === view ? 'on' : ''} ${extra || ''}" data-act="go" data-v="${view}" ${U.view === view ? raw('aria-current="page"') : ''}>${icon}<span class="nl">${label}</span>${count !== undefined && count !== null ? html`<span class="cnt">${count}</span>` : ''}</button>`;
}
function renderSide() {
  const side = $('#side'); if (!side) return;
  const live = Array.from(V.items.values()).filter(i => !i.del);
  const counts = {}; live.forEach(i => { counts[i.f] = (counts[i.f] || 0) + 1; });
  const h = healthOf(), fv = favs();
  const trashN = Array.from(V.items.values()).filter(i => i.del).length;
  const me = V.me || {};
  setHTML(side, html`
    <div class="sideHead"><img src="${LOGO}" alt="Next Level Orthodontics" class="sideLogo"><div class="sideApp">${ic('lock')}<span>Vault</span></div></div>
    <nav class="sideNav">
      ${navBtn('all', ic('list'), 'All logins', live.length)}
      ${navBtn('fav', ic('star'), 'Favorites', live.filter(i => fv.has(i.id)).length || null)}
      ${live.some(i => i.d && i.d.ml) || U.view === 'ml' ? navBtn('ml', ic('tag'), ML, live.filter(i => i.d && i.d.ml).length || null) : ''}
      <div class="sideLabel">Folders</div>
      ${S.folderList().map(f => html`<button type="button" class="nav ${U.view === 'folder:' + f.id ? 'on' : ''}" data-act="go" data-v="folder:${f.id}">
        <span class="dot ${FOLDER_CLS(f.color)}"></span><span class="nl">${f.name}</span>${S.keyTrouble(f.id) ? html`<span class="ro warnMark" title="Problem with this folder’s key">⚠</span>` : !S.canEdit(f.id) ? html`<span class="ro" title="View only">view</span>` : ''}<span class="cnt">${counts[f.id] || 0}</span></button>`)}
      ${V.owner ? html`<button type="button" class="nav add" data-act="newFolder">${ic('plus')}<span class="nl">New folder</span></button>` : ''}
      <div class="sideLabel">Check-up</div>
      ${navBtn('health', ic('alert'), 'Needs attention', h.count || null, h.chg.length || h.bad.length ? 'hot' : '')}
      ${navBtn('trash', ic('trash'), 'Trash', trashN || null)}
      ${V.owner ? html`<div class="sideLabel">Dr. A</div>
        ${navBtn('team', ic('users'), 'People & access', S.untrustedCount() || null, S.untrustedCount() ? 'hot' : '')}
        ${navBtn('activity', ic('activity'), 'Activity')}
        ${navBtn('import', ic('upload'), 'Import')}
        ${navBtn('backup', ic('download'), 'Backup')}` : ''}
      ${navBtn('settings', ic('settings'), 'Settings')}
    </nav>
    <div class="sideFoot"><span class="me">${ic('user')}<span>${me.name || ''}</span></span>
      <button type="button" class="iconBtn" data-act="lock" title="Lock">${ic('logout')}</button></div>`);
  $('#app').classList.toggle('sideOpen', !!U.side);
}
function renderContent() {
  const c = $('#content'); if (!c) return;
  const v = U.view;
  try {
    if (LIST_VIEWS(v)) return renderListView(c);
    $('#app').classList.remove('detailOpen');
    if (v === 'health') return A.renderHealth(c);
    if (v === 'team') return A.renderTeam(c);
    if (v === 'activity') return A.renderActivity(c);
    if (v === 'settings') return A.renderSettings(c);
    if (v === 'import') return I.renderImport(c);
    if (v === 'backup') return I.renderBackup(c);
  } catch (e) {
    // never leave a blank screen: say so, and let them go elsewhere
    console.error(e);
    setHTML(c, html`<div class="empty">${ic('alert')}<p>This page couldn’t be shown (${String(e && e.message || e).slice(0, 120)}).</p><button type="button" class="btn" data-act="go" data-v="all">All logins</button></div>`);
  }
}

/* ---------- list + detail ---------- */
function renderListView(c) {
  let shell = $('#listPane', c);
  if (!shell) {
    setHTML(c, html`<div class="split"><section class="listPane" id="listPane" aria-label="Logins"></section><section class="detailPane" id="detailPane" aria-label="Login details"></section></div>`);
    shell = $('#listPane', c);
  }
  const list = visibleItems();
  if (U.sel && !V.items.has(U.sel)) { U.sel = null; U.detail = false; }
  const v = U.view, fid = v.startsWith('folder:') ? v.slice(7) : null;
  const f = fid ? V.folders.get(fid) : null;
  const h = healthOf(), fv = favs();
  const empty = !V.loaded ? html`<div class="empty">${ic('lock')}<p>Opening…</p></div>`
    : U.q ? html`<div class="empty">${ic('search')}<p>Nothing matches “${U.q}”.</p></div>`
      : v === 'trash' ? html`<div class="empty">${ic('trash')}<p>Trash is empty.</p></div>`
        : v === 'fav' ? html`<div class="empty">${ic('star')}<p>No favorites yet. Open a login and tap the star to keep it here.</p></div>`
          : html`<div class="empty">${ic('key')}<p>No logins here yet.</p>${(fid ? S.canEdit(fid) : S.folderList().some(x => S.canEdit(x.id))) ? html`<button type="button" class="btn primary" data-act="new">${ic('plus')}<span>Add a login</span></button>` : ''}
            ${V.owner && v === 'all' ? html`<button type="button" class="btn" data-act="go" data-v="import">${ic('upload')}<span>Import from a spreadsheet</span></button>` : ''}</div>`;
  const trouble = fid ? S.keyTrouble(fid) : '';
  setHTML(shell, html`
    ${!trouble ? '' : V.owner ? html`<div class="callout hot">${ic('alert')}<div><b>This folder’s key wasn’t made by you.</b> Someone else may have signed in as you (for example through your email). They can’t read the vault, but nothing can be saved here until the folder has a new key. First change your email password and your vault password, then
        <button type="button" class="link" data-act="repairKey" data-f="${fid}">give this folder a new key</button>.</div></div>`
      : trouble === 'unsigned' ? html`<div class="callout hot">${ic('alert')}<div><b>This folder’s key isn’t signed by Dr. A.</b> Nothing can be saved here until he fixes it. Tell Dr. A.</div></div>`
        : html`<div class="callout hot">${ic('alert')}<div><b>You don’t have this folder’s current key.</b> Nothing can be saved here until Dr. A fixes it. Tell Dr. A.</div></div>`}
    <div class="listHead">
      <div><h1>${viewTitle()}</h1>
        <div class="sub">${list.length} ${list.length === 1 ? 'login' : 'logins'}${f && !S.canEdit(fid) ? ' · you can view, not change' : ''}${v === 'trash' ? ' · deleted logins can be put back' : ''}</div>
        ${v === 'trash' && V.owner ? html`<button type="button" class="link small" data-act="deletedForGood">${ic('history')}<span>Logins deleted for good</span></button>` : ''}</div>
      <div class="listTools">
        <label class="sortSel">${ic('down')}<select data-ch="sort" aria-label="Sort"><option value="name" ${U.sort === 'name' ? 'selected' : ''}>A–Z</option><option value="recent" ${U.sort === 'recent' ? 'selected' : ''}>Recently changed</option></select></label>
        ${V.owner && f ? html`<button type="button" class="btn small" data-act="editFolder" data-f="${fid}">${ic('edit')}<span>Folder</span></button>` : ''}
      </div>
    </div>
    ${list.length ? html`<ul class="items" role="list">${list.map(it => {
      const d = it.d || {}, st = pwStrength(d.p);
      return html`<li><button type="button" class="row ${U.sel === it.id ? 'on' : ''}" data-act="sel" data-id="${it.id}">
        ${avatar(it)}<span class="rmain"><span class="rt">${title(it)}${fv.has(it.id) ? html`<span class="favMark" aria-label="favorite">${ic('star')}</span>` : ''}</span>
        <span class="rs">${d.ds ? html`<span class="rds">${d.ds}</span>${d.u ? ' · ' + d.u : ''}` : (d.u || (d.url ? hostOf(d.url) : ''))}</span></span>
        <span class="rbadges">
          ${d.bad ? html`<span class="badge hot" title="${d.bad.why || 'Not working'}">Not working</span>` : ''}
          ${d.chg ? html`<span class="badge hot" title="${d.chg.why}">Change</span>` : ''}
          ${d.ml ? html`<span class="badge ml" title="${ML}: member discount">${ML}</span>` : ''}
          ${st && st.score < 2 ? html`<span class="badge warn">Weak</span>` : ''}
          ${h.reusedIds.has(it.id) ? html`<span class="badge warn">Reused</span>` : ''}
          ${d.totp ? html`<span class="badge">2-step</span>` : ''}
          ${!fid ? html`<span class="fchip ${FOLDER_CLS(folderColor(it.f))}">${folderName(it.f)}</span>` : ''}
        </span></button>
        ${it.d && d.p && v !== 'trash' ? html`<button type="button" class="iconBtn quick" data-act="copyPw" data-id="${it.id}" title="Copy password" aria-label="Copy password for ${title(it)}">${ic('copy')}</button>` : ''}
      </li>`;
    })}</ul>` : empty}`);
  renderDetail();
  $('#app').classList.toggle('detailOpen', !!(U.detail && U.sel));
}
let totpTimer = null;
function renderDetail() {
  const pane = $('#detailPane'); if (!pane) return;
  clearInterval(totpTimer);
  const it = U.sel ? V.items.get(U.sel) : null;
  if (!it) { setHTML(pane, html`<div class="empty soft">${ic('key')}<p>Choose a login to see it.</p></div>`); return; }
  if (!it.d) {
    // still a way back on a phone, and a word on why it can't be shown
    const f0 = V.folders.get(it.f), why = S.untrusted(it)
      ? (V.owner ? 'Someone saved this with a key you didn’t make. Give the folder a new key (open the folder) to put back its last real version.' : 'It was saved with a key Dr. A didn’t make, so it isn’t shown. Tell Dr. A.')
      : it.err === 'locked' ? 'It opens as soon as the folder’s key arrives.' : 'It’s damaged and can’t be opened.';
    setHTML(pane, html`<div class="dHead"><button type="button" class="iconBtn mobOnly" data-act="back" aria-label="Back">${ic('back')}</button>
      ${avatar(it, true)}<div class="dTitle"><h2>${title(it)}</h2><div class="sub"><span class="fchip ${FOLDER_CLS(f0 ? f0.color : 'gray')}">${f0 ? f0.name : '—'}</span></div></div></div>
      <div class="empty soft">${ic('alert')}<p>${why}</p></div>`);
    return;
  }
  const d = it.d, f = V.folders.get(it.f), canEdit = S.canEdit(it.f), fv = favs().has(it.id);
  const st = pwStrength(d.p), rev = U.revealed.has(it.id), reused = healthOf().reusedIds.has(it.id);
  const totp = d.totp ? parseTotp(d.totp) : null;
  const url = safeUrl(d.url);
  setHTML(pane, html`
    <div class="dHead">
      <button type="button" class="iconBtn mobOnly" data-act="back" aria-label="Back">${ic('back')}</button>
      ${avatar(it, true)}
      <div class="dTitle"><h2>${title(it)}</h2>${d.ds ? html`<div class="dDesc">${d.ds}</div>` : ''}
        <div class="sub"><span class="fchip ${FOLDER_CLS(f ? f.color : 'gray')}">${f ? f.name : '—'}</span> · changed ${fmtWhen(d.mAt || it.at)} by ${S.userName(d.mBy || it.by)}</div></div>
      <div class="dActs">
        ${!it.del ? html`<button type="button" class="iconBtn ${fv ? 'starOn' : ''}" data-act="fav" data-id="${it.id}" title="${fv ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${fv ? 'true' : 'false'}">${ic('star')}</button>` : ''}
        ${canEdit && !it.del ? html`<button type="button" class="btn" data-act="edit" data-id="${it.id}">${ic('edit')}<span>Edit</span></button>` : ''}
      </div>
    </div>
    ${it.del ? html`<div class="callout warn">${ic('trash')}<div>In the trash since ${fmtDate(it.at)}. ${canEdit ? 'Put it back to use it again.' : ''}</div></div>` : ''}
    ${d.bad ? html`<div class="callout hot">${ic('broken')}<div><b>Not working.</b> ${d.bad.why || ''} <span class="muted">(${S.userName(d.bad.by)}, ${fmtDate(d.bad.at)})</span>${canEdit ? html` <button type="button" class="link" data-act="worksAgain" data-id="${it.id}">It works again</button>` : ''}</div></div>` : ''}
    ${d.ml ? html`<div class="callout ml">${ic('tag')}<div><b>On ${ML}.</b> We get a member discount from this vendor — mention it when ordering.</div></div>` : ''}
    ${d.chg ? html`<div class="callout hot">${ic('alert')}<div><b>Change this password.</b> ${d.chg.why} (${fmtDate(d.chg.at)}). Change it on the website, then edit this login with the new one.${canEdit ? html` <button type="button" class="link" data-act="clearChg" data-id="${it.id}">Already done</button>` : ''}</div></div>` : ''}
    <dl class="fields">
      ${d.url ? html`<div class="f"><dt>Website</dt><dd><span class="val">${url ? html`<a href="${url}" target="_blank" rel="noopener noreferrer" data-act="openUrl" data-id="${it.id}">${hostOf(d.url)}</a>` : d.url}</span>
        <span class="fa">${url ? html`<a class="iconBtn" href="${url}" target="_blank" rel="noopener noreferrer" data-act="openUrl" data-id="${it.id}" title="Open the website">${ic('ext')}</a>` : ''}<button type="button" class="iconBtn" data-act="copy" data-k="url" data-id="${it.id}" title="Copy">${ic('copy')}</button></span></dd></div>` : ''}
      ${d.u ? html`<div class="f"><dt>Username</dt><dd><span class="val mono">${d.u}</span><span class="fa"><button type="button" class="iconBtn" data-act="copy" data-k="u" data-id="${it.id}" title="Copy username">${ic('copy')}</button></span></dd></div>` : ''}
      ${d.p ? html`<div class="f"><dt>Password</dt><dd><span class="val mono pw ${rev ? 'shown' : ''}" id="pwVal">${rev ? pwSpans(d.p) : '••••••••••••'}</span>
        <span class="fa"><button type="button" class="iconBtn" data-act="reveal" data-id="${it.id}" title="${rev ? 'Hide' : 'Show'}" aria-pressed="${rev ? 'true' : 'false'}">${ic(rev ? 'eyeOff' : 'eye')}</button>
        <button type="button" class="iconBtn" data-act="big" data-id="${it.id}" title="Show big (to read it out)">${ic('text')}</button>
        <button type="button" class="iconBtn" data-act="copy" data-k="p" data-id="${it.id}" title="Copy password">${ic('copy')}</button></span></dd>
        <div class="fmeta">${st ? html`<span class="badge s${st.score}">${st.label}</span>` : ''}${reused ? html`<span class="badge warn">Used for another login too</span>` : ''}<span class="muted">changed ${ago(d.pwAt || it.cAt)}</span></div></div>` : ''}
      ${totp ? html`<div class="f"><dt>2-step code</dt><dd><span class="val mono totp" id="totpVal">······</span><span class="ttl" id="totpLeft"></span>
        <span class="fa"><button type="button" class="iconBtn" data-act="copyTotp" data-id="${it.id}" title="Copy code">${ic('copy')}</button></span></dd></div>` : d.totp ? html`<div class="f"><dt>2-step</dt><dd class="muted">The saved secret isn’t valid</dd></div>` : ''}
      ${(d.fx || []).map((x, i) => html`<div class="f"><dt>${x.l}</dt><dd><span class="val ${x.h ? 'mono' : ''}" ${x.h ? raw('data-hidden="1"') : ''} id="fx${i}">${x.h && !rev ? '••••••' : x.v}</span>
        <span class="fa">${x.h ? html`<button type="button" class="iconBtn" data-act="reveal" data-id="${it.id}" title="Show">${ic(rev ? 'eyeOff' : 'eye')}</button>` : ''}
        <button type="button" class="iconBtn" data-act="copy" data-k="fx${i}" data-id="${it.id}" title="Copy">${ic('copy')}</button></span></dd></div>`)}
      ${repRows(it)}
      ${d.n ? html`<div class="f notes"><dt>Notes</dt><dd><span class="val pre">${d.n}</span></dd></div>` : ''}
    </dl>
    <div class="dFoot">
      ${it.del ? html`${canEdit ? html`<button type="button" class="btn" data-act="restore" data-id="${it.id}">${ic('restore')}<span>Put back</span></button>` : ''}
        ${V.owner ? html`<button type="button" class="btn danger subtle" data-act="purge" data-id="${it.id}">${ic('trash')}<span>Delete for good</span></button>` : ''}`
      : html`${canEdit ? html`<button type="button" class="btn subtle" data-act="del" data-id="${it.id}">${ic('trash')}<span>Delete</span></button>` : ''}
        ${canEdit && !d.bad ? html`<button type="button" class="btn subtle" data-act="markBad" data-id="${it.id}">${ic('broken')}<span>Not working?</span></button>` : ''}`}
      ${V.owner ? html`<button type="button" class="btn subtle" data-act="history" data-id="${it.id}">${ic('history')}<span>History</span></button>` : ''}
      <span class="muted small">Added ${fmtDate(d.cAt || it.cAt)}${d.cBy ? ' by ' + S.userName(d.cBy) : ''}</span>
    </div>`);
  if (totp) {
    const tick = async () => {
      const el = $('#totpVal'), left = $('#totpLeft'); if (!el) { clearInterval(totpTimer); return; }
      const code = await totpCode(totp); el.textContent = code.slice(0, Math.ceil(code.length / 2)) + ' ' + code.slice(Math.ceil(code.length / 2));
      const l = totpLeft(totp); left.textContent = l + 's'; left.classList.toggle('soon', l <= 5);
    };
    tick(); totpTimer = setInterval(tick, 1000);
  }
}
function pwSpans(p) {
  return raw(Array.from(p).map(ch => {
    const cls = /[0-9]/.test(ch) ? 'cd' : /[a-zA-Z]/.test(ch) ? '' : 'cs';
    return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + (ch === ' ' ? '&nbsp;' : ch.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))) + '</span>';
  }).join(''));
}
function select(id) {
  if (U.sel !== id) U.revealed.clear();
  U.sel = id; U.detail = true;
  renderContent();
  const pane = $('#detailPane'); if (pane) pane.scrollTop = 0;
}

/* ---------- clicks ---------- */
async function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || !$('#root').contains(b)) return;
  const act = b.dataset.act, id = b.dataset.id, it = id ? V.items.get(id) : null;
  switch (act) {
    case 'go': go(b.dataset.v); break;
    case 'menu': U.side = !U.side; $('#app').classList.toggle('sideOpen', U.side); break;
    case 'sel': select(id); break;
    case 'back': U.detail = false; $('#app').classList.remove('detailOpen'); break;
    case 'lock': lockNow('button'); break;
    case 'new': openEditor(null); break;
    case 'edit': if (it) openEditor(it); break;
    case 'newFolder': A.folderDialog(null); break;
    case 'editFolder': A.folderDialog(b.dataset.f); break;
    case 'resumeRot': resumeRotations(true); break;
    case 'fav': {
      const s = favs(); if (s.has(id)) s.delete(id); else s.add(id);
      try { await S.savePrefs({ favs: Array.from(s) }); } catch (er) { toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'reveal': {
      if (!it) break;
      if (U.revealed.has(id)) U.revealed.delete(id);
      else { U.revealed.add(id); S.log('reveal', { i: id, f: it.f }); setTimeout(() => { if (U.revealed.delete(id) && U.sel === id) renderDetail(); }, 30000); }
      renderDetail(); break;
    }
    case 'big': if (it) showBig(it); break;
    case 'copy': {
      if (!it || !it.d) break;
      const k = b.dataset.k, d = it.d;
      if (k === 'p') await copyText(d.p, 'Password', { a: 'copy-pw', o: { i: id, f: it.f }, secret: true });
      else if (k === 'u') await copyText(d.u, 'Username', { a: 'copy-user', o: { i: id, f: it.f } });
      else if (k === 'url') await copyText(d.url, 'Website', null);
      else if (k === 'repN' || k === 'repPh' || k === 'repEm') { const r = d.rep || {}; await copyText(k === 'repN' ? r.n : k === 'repPh' ? r.ph : r.em, k === 'repN' ? 'Rep' : k === 'repPh' ? 'Rep phone' : 'Rep email', null); }
      else if (k.startsWith('fx')) { const x = (d.fx || [])[+k.slice(2)]; if (x) await copyText(x.v, x.l, { a: 'copy-field', o: { i: id, f: it.f }, secret: !!x.h }); }
      break;
    }
    case 'copyPw': if (it && it.d) await copyText(it.d.p, 'Password', { a: 'copy-pw', o: { i: id, f: it.f }, secret: true }); break;
    case 'copyTotp': {
      if (!it || !it.d) break;
      const cfg = parseTotp(it.d.totp); if (!cfg) break;
      await copyText(await totpCode(cfg), '2-step code', { a: 'copy-2fa', o: { i: id, f: it.f }, secret: true });
      break;
    }
    case 'openUrl': if (it) S.log('open', { i: id, f: it.f }); break;
    case 'worksAgain': {
      if (!it || !it.d) break;
      const d = Object.assign({}, it.d); delete d.bad;
      try { await S.saveItem(id, it.f, d, { rev: it.rev }); toast('Marked as working'); } catch (er) { toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'markBad': {
      if (!it || !it.d) break;
      const why = await notWorkingBox(title(it)); if (why === null) break;
      const cur = V.items.get(id); if (!cur || !cur.d) break;
      try { await S.saveItem(id, cur.f, Object.assign({}, cur.d, { bad: { why, at: Date.now(), by: V.uid } }), { rev: cur.rev }); toast('Marked as not working'); }
      catch (er) { toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'clearChg': {
      if (!it || !it.d) break;
      const d = Object.assign({}, it.d); delete d.chg;
      try { await S.saveItem(id, it.f, d, { rev: it.rev }); toast('Marked as changed'); } catch (er) { toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'del': {
      if (!it) break;
      try { await S.setDeleted(id, true); toast('Moved to the trash', { action: 'Undo', onAction: () => S.setDeleted(id, false).catch(er => toast(errorText(er), { kind: 'bad' })) }); }
      catch (er) { toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'restore': try { await S.setDeleted(id, false); toast('Put back in ' + folderName(it.f)); } catch (er) { toast(errorText(er), { kind: 'bad' }); } break;
    case 'purge': {
      if (!(await confirmBox({ title: 'Delete for good?', body: '“' + title(it) + '” disappears for everyone, trash included. An encrypted copy stays in its history, so you can still bring it back (Trash → Logins deleted for good).', yes: 'Delete for good', danger: true }))) break;
      try { await S.purgeItem(id); U.sel = null; toast('Deleted'); } catch (er) { toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'history': if (it) A.historyDialog(it); break;
    default: A.onAdminClick && A.onAdminClick(act, b, e); I.onImportClick && I.onImportClick(act, b, e);
  }
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.ch === 'sort') { U.sort = t.value; renderContent(); }
}
function onKey(e) {
  if (document.querySelector('.modalWrap')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag)) { e.preventDefault(); const q = $('#q'); if (q) q.focus(); }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && LIST_VIEWS(U.view) && !['input', 'textarea', 'select'].includes(tag)) {
    const list = visibleItems(); if (!list.length) return;
    const i = list.findIndex(x => x.id === U.sel);
    const n = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    e.preventDefault(); select(list[n].id);
    const row = document.querySelector('.row.on'); if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

/* ---------- the big view: one character per box, numbered, for reading out loud ---------- */
function showBig(it) {
  S.log('reveal', { i: it.id, f: it.f });
  const p = it.d.p || '';
  const name = ch => /[0-9]/.test(ch) ? 'number' : /[a-z]/.test(ch) ? 'lower' : /[A-Z]/.test(ch) ? 'CAPITAL' : ch === ' ' ? 'space' : 'symbol';
  openModal(html`<div class="mhead"><h2>${title(it)}</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody"><div class="bigPw">${Array.from(p).map((ch, i) => html`<span class="bc ${/[0-9]/.test(ch) ? 'cd' : /[a-zA-Z]/.test(ch) ? '' : 'cs'}"><b>${ch === ' ' ? '␣' : ch}</b><i>${i + 1}</i><em>${name(ch)}</em></span>`)}</div></div>
    <div class="mfoot"><button type="button" class="btn primary" data-close>Done</button></div>`, { wide: true, label: 'Password, large' });
}

/* ---------- add / edit a login ---------- */
export function openEditor(it, presetFid) {
  const editable = S.folderList().filter(f => S.canEdit(f.id) && !S.keyTrouble(f.id) && f.keys.has(f.kv));
  if (!editable.length) { toast('You can view these folders but not add to them. Ask Dr. A.', { kind: 'warn' }); return; }
  const cur = U.view.startsWith('folder:') ? U.view.slice(7) : null;
  // outside a folder, Dr. A's new logins go to his private folder unless he picks another (never "whichever is first")
  const priv = V.owner ? S.privateFolder() : null;
  const fid0 = it ? it.f : presetFid || (cur && S.canEdit(cur) && editable.some(f => f.id === cur) ? cur : V.owner ? (priv ? priv.id : '') : editable[0].id);
  const d = it ? Object.assign({}, it.d) : { t: '', url: '', u: '', p: '', n: '', totp: '', fx: [] };
  const fx = (d.fx || []).map(x => Object.assign({}, x));
  const rev0 = it ? it.rev : 0;
  let dirty = false;
  const m = openModal(html``, {
    wide: true, label: it ? 'Edit login' : 'New login',
    guard: async () => !dirty || confirmBox({ title: 'Discard changes?', body: 'Your changes to this login haven’t been saved.', yes: 'Discard', danger: true })
  });
  const draw = () => m.set(html`
    <form id="edForm" novalidate autocomplete="off">
    <div class="mhead"><h2>${it ? 'Edit login' : 'New login'}</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody grid2">
      <label class="fld span2"><span>Name</span><input id="edT" value="${d.t || ''}" maxlength="120" placeholder="e.g. Delta Dental provider portal" autofocus></label>
      <label class="fld span2"><span>Description <span class="muted">(optional — shown under the name)</span></span><input id="edDs" value="${d.ds || ''}" maxlength="140" placeholder="e.g. Claims, ERA and eligibility"></label>
      <div class="fld span2"><span>Logo <span class="muted">(optional)</span></span>
        <div class="logoRow"><span class="logoBox" id="lgBox" title="Drop a picture here"></span>
          <span class="logoActs"><button type="button" class="btn small" id="lgPick">${ic('upload')}<span>Choose a picture…</span></button>
          <button type="button" class="link small" id="lgDel">Remove</button>
          <span class="muted small">or paste a copied picture (Ctrl+V / ⌘V). Other logins for the same website use it too.</span></span>
          <input type="file" id="lgFile" accept="image/*" class="hidden"></div>
        <span id="lgErr" class="err small hidden" role="alert"></span></div>
      <label class="fld"><span>Folder</span><select id="edF">${fid0 ? '' : html`<option value="" selected disabled>Choose a folder…</option>`}${editable.map(f => html`<option value="${f.id}" ${f.id === fid0 ? 'selected' : ''}>${f.name}</option>`)}</select></label>
      <label class="fld"><span>Website</span><input id="edUrl" value="${d.url || ''}" maxlength="500" placeholder="deltadentalins.com" spellcheck="false" autocapitalize="off"></label>
      <label class="fld"><span>Username or email</span><input id="edU" value="${d.u || ''}" maxlength="300" spellcheck="false" autocapitalize="off" autocomplete="off"></label>
      <div class="fld"><span>Password</span>
        <span class="pwRow"><input id="edP" type="password" value="${d.p || ''}" maxlength="500" spellcheck="false" autocapitalize="off" autocomplete="new-password" class="mono">
        <button type="button" class="iconBtn" id="edShow" title="Show">${ic('eye')}</button>
        <button type="button" class="iconBtn" id="edGen" title="Make a strong password">${ic('wand')}</button></span>
        <span id="edMeter"></span></div>
      <div class="genBox hidden span2" id="genBox"></div>
      <label class="fld span2"><span>2-step secret <span class="muted">(optional — only if the office shares this account’s authenticator)</span></span>
        <input id="edTotp" value="${d.totp || ''}" maxlength="500" spellcheck="false" autocapitalize="off" placeholder="Secret key or otpauth:// link" class="mono"><span id="edTotpOk" class="small"></span></label>
      <div class="span2 fxList" id="fxList"></div>
      <div class="span2"><button type="button" class="link" id="fxAdd">${ic('plus')}<span>Add a field (PIN, account #, security question…)</span></button></div>
      <div class="span2 edSec">Vendor and rep <span class="muted">(optional)</span></div>
      <label class="fld"><span>Rep</span><input id="edRepN" value="${(d.rep || {}).n || ''}" maxlength="80" placeholder="Name" autocomplete="off"></label>
      <label class="fld"><span>Rep phone</span><input id="edRepPh" value="${(d.rep || {}).ph || ''}" maxlength="40" inputmode="tel" placeholder="(352) 555-1234" autocomplete="off"></label>
      <label class="fld span2"><span>Rep email</span><input id="edRepEm" value="${(d.rep || {}).em || ''}" maxlength="120" inputmode="email" placeholder="name@company.com" spellcheck="false" autocapitalize="off" autocomplete="off"></label>
      <label class="chk span2"><input type="checkbox" id="edMl" ${d.ml ? 'checked' : ''}><span>On <b>Mari’s List</b> — we get a member discount from this vendor</span></label>
      <label class="chk span2"><input type="checkbox" id="edBad" ${d.bad ? 'checked' : ''}><span><b>Not working</b> right now (for example the company has to reset it)</span></label>
      <label class="fld span2 ${d.bad ? '' : 'hidden'}" id="edBadBox"><span>What’s wrong, or what to do</span><input id="edBadWhy" value="${d.bad ? d.bad.why : ''}" maxlength="300" placeholder="e.g. Locked out — call the company to reset it" autocomplete="off"></label>
      <label class="fld span2"><span>Notes</span><textarea id="edN" rows="3" maxlength="20000">${d.n || ''}</textarea></label>
      <p class="muted small span2">Never put patient information in the vault.</p>
      <p id="edErr" class="err hidden span2" role="alert"></p>
    </div>
    <div class="mfoot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" id="edSave">Save</button></div>
    </form>`);
  const drawFx = () => {
    setHTML($('#fxList', m.el), html`${fx.map((x, i) => html`<div class="fxRow" data-i="${i}">
      <input class="fxL" value="${x.l}" maxlength="40" placeholder="Label (e.g. PIN)" aria-label="Field label">
      <input class="fxV ${x.h ? 'mono' : ''}" type="${x.h ? 'password' : 'text'}" value="${x.v}" maxlength="2000" placeholder="Value" aria-label="Field value" autocomplete="off">
      <label class="chk small"><input type="checkbox" class="fxH" ${x.h ? 'checked' : ''}> Hidden</label>
      <button type="button" class="iconBtn fxDel" title="Remove field">${ic('x')}</button></div>`)}`);
  };
  draw(); drawFx();
  const el = m.el;
  let lg = d.lg || '';
  const drawLogo = () => {
    const src = logoSrc(lg);
    setHTML($('#lgBox', el), src ? html`<img src="${src}" alt="Logo">` : html`<span class="muted small">No logo</span>`);
    $('#lgDel', el).classList.toggle('hidden', !lg);
  };
  const useLogo = async file => {
    const e1 = $('#lgErr', el); e1.classList.add('hidden');
    try { lg = await makeLogo(file); dirty = true; drawLogo(); }
    catch (er) { e1.textContent = er.message; e1.classList.remove('hidden'); }
  };
  drawLogo();
  $('#lgPick', el).addEventListener('click', () => $('#lgFile', el).click());
  $('#lgFile', el).addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) useLogo(f); });
  $('#lgDel', el).addEventListener('click', () => { lg = ''; dirty = true; drawLogo(); });
  // a copied picture pasted anywhere in the form becomes the logo (pasting text still works as usual)
  el.addEventListener('paste', e => {
    const f = Array.from((e.clipboardData && e.clipboardData.files) || []).find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); useLogo(f); }
  });
  const box0 = $('#lgBox', el);
  box0.addEventListener('dragover', e => { e.preventDefault(); box0.classList.add('drag'); });
  box0.addEventListener('dragleave', () => box0.classList.remove('drag'));
  box0.addEventListener('drop', e => { e.preventDefault(); box0.classList.remove('drag'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) useLogo(f); });
  const meter = () => setHTML($('#edMeter', el), $('#edP', el).value ? meterHTML($('#edP', el).value, [$('#edT', el).value, $('#edU', el).value]) : '');
  // a new password usually means the login works again: "Not working" unticks itself (once; tick it again to keep it)
  let badAuto = false;
  const pwTouched = () => {
    if (badAuto || !it || !it.d.bad || $('#edP', el).value === (it.d.p || '')) return;
    badAuto = true;
    const b = $('#edBad', el); if (b.checked) { b.checked = false; $('#edBadBox', el).classList.add('hidden'); }
  };
  const totpOk = () => { const v = $('#edTotp', el).value.trim(); const o = $('#edTotpOk', el); o.textContent = !v ? '' : parseTotp(v) ? '✓ Codes will show on the login' : 'That doesn’t look like an authenticator secret'; o.className = 'small ' + (!v ? '' : parseTotp(v) ? 'good' : 'err'); };
  meter(); totpOk();
  el.addEventListener('input', e => {
    dirty = true;
    if (e.target.id === 'edP') { meter(); pwTouched(); }
    if (e.target.id === 'edTotp') totpOk();
    const row = e.target.closest('.fxRow');
    if (row) { const x = fx[+row.dataset.i]; if (e.target.classList.contains('fxL')) x.l = e.target.value; if (e.target.classList.contains('fxV')) x.v = e.target.value; }
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'edBad') { $('#edBadBox', el).classList.toggle('hidden', !e.target.checked); dirty = true; if (e.target.checked) $('#edBadWhy', el).focus(); }
    if (e.target.id === 'edMl') dirty = true;
    const row = e.target.closest('.fxRow');
    if (row && e.target.classList.contains('fxH')) { fx[+row.dataset.i].h = e.target.checked; const v = row.querySelector('.fxV'); v.type = e.target.checked ? 'password' : 'text'; v.classList.toggle('mono', e.target.checked); dirty = true; }
  });
  el.addEventListener('click', e => {
    if (e.target.closest('#edShow')) { const p = $('#edP', el); const show = p.type === 'password'; p.type = show ? 'text' : 'password'; setHTML($('#edShow', el), ic(show ? 'eyeOff' : 'eye')); }
    if (e.target.closest('#edGen')) toggleGen();
    if (e.target.closest('#fxAdd')) { fx.push({ l: '', v: '', h: false }); drawFx(); dirty = true; const rows = $$('.fxRow .fxL', el); if (rows.length) rows[rows.length - 1].focus(); }
    const del = e.target.closest('.fxDel'); if (del) { fx.splice(+del.closest('.fxRow').dataset.i, 1); drawFx(); dirty = true; }
  });
  let gen = { mode: 'chars', len: 20, symbols: true, words: 4 };
  function toggleGen() {
    const box = $('#genBox', el);
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden'); drawGen();
  }
  function drawGen() {
    const box = $('#genBox', el);
    const val = gen.mode === 'chars' ? genChars(gen.len, { symbols: gen.symbols }) : genWords(gen.words, { capNum: true });
    setHTML(box, html`<div class="genTop"><div class="seg" role="group" aria-label="Kind">
        <button type="button" class="${gen.mode === 'chars' ? 'on' : ''}" data-g="chars">Characters</button><button type="button" class="${gen.mode === 'words' ? 'on' : ''}" data-g="words">Words</button></div>
      ${gen.mode === 'chars' ? html`<label class="small">Length <input type="range" id="gLen" min="10" max="40" value="${gen.len}"> <b>${gen.len}</b></label>
        <label class="chk small"><input type="checkbox" id="gSym" ${gen.symbols ? 'checked' : ''}> Symbols</label>`
        : html`<label class="small">Words <input type="range" id="gWords" min="3" max="8" value="${gen.words}"> <b>${gen.words}</b></label>`}</div>
      <div class="genVal mono" id="gVal">${val}</div>
      <div class="genBtns"><button type="button" class="btn small" id="gAgain">${ic('refresh')}<span>Another</span></button><button type="button" class="btn small primary" id="gUse">Use this password</button></div>
      <p class="muted small">Some websites limit length or symbols — use Characters without symbols, or fewer characters, if a site refuses it.</p>`);
    box.querySelectorAll('[data-g]').forEach(x => x.addEventListener('click', () => { gen.mode = x.dataset.g; drawGen(); }));
    const len = $('#gLen', box); if (len) len.addEventListener('input', () => { gen.len = +len.value; drawGen(); });
    const sym = $('#gSym', box); if (sym) sym.addEventListener('change', () => { gen.symbols = sym.checked; drawGen(); });
    const w = $('#gWords', box); if (w) w.addEventListener('input', () => { gen.words = +w.value; drawGen(); });
    $('#gAgain', box).addEventListener('click', drawGen);
    $('#gUse', box).addEventListener('click', () => { const p = $('#edP', el); p.value = $('#gVal', box).textContent; p.type = 'text'; dirty = true; meter(); pwTouched(); box.classList.add('hidden'); });
  }
  $('#edForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const err = msg => { const x = $('#edErr', el); x.textContent = msg; x.classList.remove('hidden'); };
    const out = Object.assign({}, it ? it.d : {}, {
      t: $('#edT', el).value.trim(), ds: $('#edDs', el).value.replace(/\s+/g, ' ').trim(), lg, url: $('#edUrl', el).value.trim(), u: $('#edU', el).value.trim(), p: $('#edP', el).value,
      totp: $('#edTotp', el).value.trim(), n: $('#edN', el).value, fx: fx.filter(x => x.l.trim() || x.v).map(x => ({ l: x.l.trim().slice(0, 40) || 'Field', v: x.v, h: !!x.h }))
    });
    out.rep = { n: $('#edRepN', el).value.trim(), ph: $('#edRepPh', el).value.trim(), em: $('#edRepEm', el).value.trim() };
    out.ml = $('#edMl', el).checked;
    const why = $('#edBadWhy', el).value.replace(/\s+/g, ' ').trim();
    // the same mark stays as it was; ticked again with a new password, it's a new mark (so the new password doesn't clear it)
    const pwNew = !!it && out.p !== (it.d.p || '');
    out.bad = !$('#edBad', el).checked ? null : it && it.d.bad && it.d.bad.why === why && !pwNew ? it.d.bad : { why, at: Date.now(), by: V.uid };
    if (!out.bad) delete out.bad;
    if (!out.t) out.t = hostOf(out.url) || out.u;
    if (!out.t) { err('Give it a name (for example the company or website).'); return; }
    if (out.rep.em && !mailHref(out.rep.em)) { err('The rep’s email doesn’t look right.'); return; }
    if (out.totp && !parseTotp(out.totp)) { err('The 2-step secret isn’t valid. Paste the secret key from the website’s setup page, or leave it empty.'); return; }
    const fid = $('#edF', el).value;
    if (!fid) { err('Choose which folder it goes in.'); return; }
    const btn = $('#edSave', el); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const id = await S.saveItem(it ? it.id : null, fid, out, it ? { rev: rev0 } : {});
      dirty = false; m.close(true);
      U.sel = id; U.detail = true;
      if (!it && U.view !== 'all' && U.view !== 'folder:' + fid) U.view = 'folder:' + fid;
      toast(it ? 'Saved' : 'Added to ' + folderName(fid));
      renderAll();
    } catch (er) { btn.disabled = false; btn.textContent = 'Save'; err(errorText(er)); }
  });
}

/* ---------- lock ---------- */
export async function lockNow(why) {
  if (lockedOut) return; lockedOut = true;
  closeAllModals();
  try { await S.lock(); } catch (e) { }
  // a fresh page: nothing from this session stays in memory
  const q = why === 'idle' ? '?locked=idle' : why === 'removed' ? '?locked=removed' : '';
  location.replace(location.pathname + q);
}

/* ---------- a key change that didn't finish ---------- */
let rotating = false;
async function resumeRotations(ask) {
  const list = S.unfinishedRotations();
  if (!list.length || rotating) return;
  if (!ask) { renderBanner(); return; }
  rotating = true; renderBanner();
  const m = openModal(html`<div class="mhead"><h2>Finishing the key change…</h2></div><div class="mbody"><p id="rotMsg">Starting…</p><div class="prog"><i id="rotBar"></i></div><p class="muted small">Keep this page open.</p></div>`, { sticky: true });
  try {
    for (const f of list) await S.rotateFolder(f.id, '', (fid, done, total) => {
      const msg = $('#rotMsg', m.el), bar = $('#rotBar', m.el);
      if (msg) msg.textContent = f.name + ': ' + done + ' of ' + total;
      if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 100) + '%';
    });
    m.close(true); toast('Done');
  } catch (er) { m.close(true); toast(errorText(er), { kind: 'bad' }); }
  rotating = false; renderAll();
}
