/* Dr. A's pages (people & access, folders, activity, history) and everyone's Needs attention and Settings. */
import { html, raw, setHTML, $, $$, ic, toast, errorText, openModal, confirmBox, fmtWhen, fmtDate, fmtTime, ago, FOLDER_CLS, hostOf, meterHTML, download, initials } from './common.js';
import * as S from '../store.js';
import { V, COLORS, LOCK_CHOICES } from '../store.js';
import { vaultPasswordProblem } from '../gen.js';
import { U, go, renderAll, healthOf, pwStrength } from './vault.js';
import { showRecoveryCode } from './lock.js';

const fname = fid => { const f = V.folders.get(fid); return f ? f.name : 'a deleted folder'; };
const people = () => Array.from(V.users.values()).filter(u => u.role === 'staff' && u.active).sort((a, b) => a.name.localeCompare(b.name));
const grantOf = (uid, fid) => V.grants.get(uid + '_' + fid);
function ititle(id) { const it = V.items.get(id); return it && it.d ? (it.d.t || hostOf(it.d.url) || 'Untitled') : 'a deleted login'; }

/* ---------- Needs attention ---------- */
export function renderHealth(c) {
  const h = healthOf();
  const row = it => html`<li><button type="button" class="row" data-act="openItem" data-id="${it.id}"><span class="av ${FOLDER_CLS((V.folders.get(it.f) || {}).color)}">${initials(it.d.t || hostOf(it.d.url))}</span>
    <span class="rmain"><span class="rt">${it.d.t || hostOf(it.d.url)}</span><span class="rs">${fname(it.f)}${it.d.u ? ' · ' + it.d.u : ''}</span></span>${raw('')}</button></li>`;
  const byName = l => l.slice().sort((a, b) => String(a.d.t).localeCompare(String(b.d.t)));
  const sec = (title, why, list, cls) => (list = byName(list)).length ? html`<section class="hsec ${cls || ''}"><h2>${title} <span class="cnt">${list.length}</span></h2><p class="muted">${why}</p><ul class="items">${list.map(row)}</ul></section>` : '';
  setHTML(c, html`<div class="page">
    <div class="pageHead"><h1>Needs attention</h1><p class="sub">Only logins you can open are checked.</p></div>
    ${!h.count && !h.nopw.length ? html`<div class="empty">${ic('shield')}<p>Nothing needs attention. Nice.</p></div>` : ''}
    ${sec('Change these passwords', 'Someone who could see them no longer can (they left or lost access). Change each one on its website, then save the new password here.', h.chg, 'hot')}
    ${sec('Weak passwords', 'Easy to guess. Make a new one with the wand button when you edit the login.', h.weak)}
    ${h.reused.length ? html`<section class="hsec"><h2>Same password on more than one login <span class="cnt">${h.reused.length}</span></h2><p class="muted">If one of these websites leaks it, the others are open too.</p>
      ${h.reused.map(g => html`<ul class="items group">${g.map(row)}</ul>`)}</section>` : ''}
    ${sec('Not changed in over a year', 'Worth changing, especially for banking and payroll.', h.old)}
    ${sec('No password saved', 'These logins have no password in the vault.', h.nopw, 'soft')}
  </div>`);
}

/* ---------- People & access ---------- */
export function renderTeam(c) {
  if (!V.owner) { setHTML(c, ''); return; }
  const ppl = people(), folders = S.folderList();
  const removed = Array.from(V.users.values()).filter(u => u.role === 'staff' && !u.active && !u.replacedBy).sort((a, b) => S.ms(b.removedAt) - S.ms(a.removedAt));
  // places and people that don't carry Dr. A's signature (someone else signed in as him added them): flagged, never given keys
  const badG = g => !!g && V.trust.grants.get(g.id) === false, badP = uid => V.trust.people.get(uid) === false;
  const sel = (fid, uid) => {
    const g = grantOf(uid, fid), v = g ? g.role : '';
    return html`<span class="accCell"><select class="acc acc-${v || 'none'} ${badG(g) ? 'acc-bad' : ''}" data-acc="${fid}|${uid}" aria-label="${(V.users.get(uid) || {}).name} – ${fname(fid)}">
      <option value="" ${!v ? 'selected' : ''}>—</option><option value="view" ${v === 'view' ? 'selected' : ''}>View</option><option value="edit" ${v === 'edit' ? 'selected' : ''}>Edit</option></select>${badG(g) ? html`<span class="warnTag" title="You didn’t give this. Choose — to remove it, or choose View or Edit to give it yourself.">⚠</span>` : ''}</span>`;
  };
  const nBad = S.untrustedCount();
  setHTML(c, html`<div class="page">
    <div class="pageHead"><h1>People &amp; access</h1><p class="sub">Each person has their own login and opens only the folders you give them. <b>View</b> = see and copy. <b>Edit</b> = also add, change and delete.</p>
      <button type="button" class="btn primary" data-act="addPerson">${ic('plus')}<span>Add a person</span></button></div>
    ${nBad ? html`<div class="callout hot">${ic('alert')}<div><b>${nBad === 1 ? 'One entry below wasn’t' : nBad + ' entries below weren’t'} made by you</b> (marked ⚠). The vault never gives them any keys. Someone else may have signed in as you, for example through your email: change your email password and your vault password, then remove what you don’t recognize.</div></div>` : ''}
    <section class="card pad">
      <h2>People</h2>
      <table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Last used the vault</th><th>Folders</th><th></th></tr></thead><tbody>
        <tr><td><b>${(V.me || {}).name}</b> <span class="badge">Owner</span></td><td class="mono small">${V.login || ''}</td><td>you</td><td>all</td><td></td></tr>
        ${ppl.map(u => {
          const gs = Array.from(V.grants.values()).filter(g => g.uid === u.uid);
          return html`<tr class="${badP(u.uid) ? 'badRow' : ''}"><td><b>${u.name}</b>${badP(u.uid) ? html` <span class="badge hot" title="No signature from you: the vault gives this person nothing">⚠ Not added by you</span>` : ''}</td><td class="mono">${u.username}</td>
            <td>${u.seen ? fmtWhen(S.ms(u.seen)) : html`<span class="badge warn">Hasn’t signed in yet</span>`}</td>
            <td class="small">${gs.length ? gs.map(g => html`<span class="fchip ${FOLDER_CLS((V.folders.get(g.fid) || {}).color)}">${fname(g.fid)}${g.role === 'edit' ? ' ✎' : ''}${badG(g) ? ' ⚠' : ''}</span>`) : html`<span class="muted">none</span>`}</td>
            <td class="acts"><button type="button" class="btn small" data-act="personFolders" data-u="${u.uid}">${ic('folder')}<span>Folders</span></button>
              <button type="button" class="btn small" data-act="reissue" data-u="${u.uid}">${ic('key')}<span>Reissue login</span></button>
              <button type="button" class="btn small danger subtle" data-act="removePerson" data-u="${u.uid}">${ic('x')}<span>Remove</span></button></td></tr>`;
        })}
      </tbody></table>
      ${!ppl.length ? html`<p class="muted">No one else yet. Add a person to give them their own login.</p>` : ''}
    </section>
    <section class="card pad">
      <div class="secHead"><h2>Folders and who can open them</h2><button type="button" class="btn small" data-act="newFolder">${ic('plus')}<span>New folder</span></button></div>
      <div class="tblWrap"><table class="tbl matrix"><thead><tr><th>Folder</th>${ppl.map(u => html`<th>${u.name}${badP(u.uid) ? ' ⚠' : ''}<div class="thUser">${u.username}</div></th>`)}<th></th></tr></thead><tbody>
        ${folders.map((f, i) => html`<tr><td><span class="dot ${FOLDER_CLS(f.color)}"></span><b>${f.name}</b>${f.def ? html` <span class="muted small" title="New people get this">· new people: ${f.def}</span>` : ''}</td>
          ${ppl.map(u => html`<td>${sel(f.id, u.uid)}</td>`)}
          <td class="acts"><button type="button" class="iconBtn" data-act="folderUp" data-f="${f.id}" title="Move up" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button>
          <button type="button" class="iconBtn" data-act="folderDown" data-f="${f.id}" title="Move down" ${i === folders.length - 1 ? 'disabled' : ''}>${ic('down')}</button>
          <button type="button" class="iconBtn" data-act="editFolder" data-f="${f.id}" title="Rename, color, delete">${ic('edit')}</button></td></tr>`)}
      </tbody></table></div>
      <p class="muted small">Taking someone out of a folder gives that folder a new key straight away, so anything added later is locked with a key they never had.</p>
    </section>
    ${removed.length ? html`<section class="card pad"><h2>Removed</h2><ul class="plain">${removed.map(u => html`<li class="remRow"><span><b>${u.name}</b> <span class="muted">(${u.username}) · removed ${fmtDate(S.ms(u.removedAt))}</span></span>
      <button type="button" class="btn small" data-act="rehire" data-u="${u.uid}">${ic('key')}<span>New login</span></button></li>`)}</ul>
      <p class="muted small">A new login starts with no folders; choose them after.</p></section>` : ''}
  </div>`);
  $$('select[data-acc]', c).forEach(s => s.addEventListener('change', () => accessChanged(s)));
}
async function accessChanged(s) {
  const [fid, uid] = s.dataset.acc.split('|'), role = s.value || null;
  const u = V.users.get(uid);
  if (!role) {
    const box = await confirmAccessRemoval(u, [fid]);
    if (!box) { renderAll(); return; }
    await withProgress('Taking ' + u.name + ' out of ' + fname(fid), p => S.setAccess(fid, uid, null, { flag: box.flag, progress: p }));
  } else {
    const g = grantOf(uid, fid);
    if (g && g.role === 'edit' && role === 'view') {
      // going down to view gives the folder a new key (so the earlier "edit" can't be put back)
      if (await withProgress(u.name + ': view only in ' + fname(fid), p => S.setAccess(fid, uid, role, { progress: p }).then(() => true)) === null) { renderAll(); return; }
    } else {
      try { await S.setAccess(fid, uid, role); toast(u.name + ' can now ' + (role === 'edit' ? 'edit' : 'view') + ' ' + fname(fid)); }
      catch (er) { toast(errorText(er), { kind: 'bad' }); }
    }
  }
  renderAll();
}
function confirmAccessRemoval(u, fids, leaving) {
  const n = Array.from(V.items.values()).filter(i => fids.includes(i.f) && !i.del).length;
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(html`<div class="mhead"><h2>${leaving ? 'Remove ' + u.name + '?' : 'Take ' + u.name + ' out of ' + fname(fids[0]) + '?'}</h2></div>
      <div class="mbody">
        ${leaving ? html`<p>${u.name} is locked out right away${fids.length ? html` and the ${fids.length === 1 ? 'folder' : fids.length + ' folders'} they could open (${fids.map(fname).join(', ')}) get new keys` : ''}. Their history stays in Activity.</p>`
          : html`<p>They lose access right away, and the folder gets a new key.</p>`}
        ${n ? html`<label class="chk"><input type="checkbox" id="flagChg" ${leaving ? 'checked' : ''}> Flag the ${n} ${n === 1 ? 'password' : 'passwords'} they could see as <b>Change this password</b></label>
        <p class="muted small">${u.name} could have copied or written them down, so the safe thing is to change them on each website. They’ll be listed under Needs attention.</p>` : ''}
      </div>
      <div class="mfoot"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn danger" data-yes>${leaving ? 'Remove' : 'Take out'}</button></div>`, { onClose: () => { if (!answered) resolve(null); } });
    m.el.querySelector('[data-no]').addEventListener('click', () => { answered = true; resolve(null); m.close(true); });
    m.el.querySelector('[data-yes]').addEventListener('click', () => { const f = m.el.querySelector('#flagChg'); answered = true; resolve({ flag: f ? f.checked : false }); m.close(true); });
  });
}
async function withProgress(label, fn) {
  const m = openModal(html`<div class="mhead"><h2>${label}</h2></div><div class="mbody"><p id="pgMsg">Working…</p><div class="prog"><i id="pgBar"></i></div><p class="muted small">Keep this page open until it’s done.</p></div>`, { sticky: true });
  const names = {};
  try {
    const r = await fn((fid, done, total) => {
      names[fid] = fname(fid);
      const msg = $('#pgMsg', m.el), bar = $('#pgBar', m.el);
      if (msg) msg.textContent = 'Re-locking ' + names[fid] + ': ' + done + ' of ' + total;
      if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 100) + '%';
    });
    m.close(true); toast('Done');
    return r;
  } catch (er) { m.close(true); toast(errorText(er), { kind: 'bad', ms: 9000 }); return null; }
}
function accessRows(o) {
  return html`${S.folderList().map(f => {
    const v = o.get(f.id) || '';
    return html`<div class="accRow"><span class="dot ${FOLDER_CLS(f.color)}"></span><span class="an">${f.name}</span>
      <select data-af="${f.id}" aria-label="${f.name}"><option value="" ${!v ? 'selected' : ''}>No access</option><option value="view" ${v === 'view' ? 'selected' : ''}>View</option><option value="edit" ${v === 'edit' ? 'selected' : ''}>Edit</option></select></div>`;
  })}`;
}
function addPersonDialog() {
  const init = new Map(S.folderList().filter(f => f.def).map(f => [f.id, f.def]));
  const m = openModal(html`<form id="apForm" novalidate autocomplete="off">
    <div class="mhead"><h2>Add a person</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody">
      <label class="fld"><span>Name (as everyone will see it)</span><input id="apName" maxlength="60" placeholder="e.g. Sarah B." autofocus></label>
      <label class="fld"><span>Username (what they type to sign in)</span><input id="apUser" maxlength="24" spellcheck="false" autocapitalize="off" placeholder="e.g. sarah"></label>
      <h3>Folders they can open</h3>
      <div class="accList">${accessRows(init)}</div>
      <p id="apErr" class="err hidden" role="alert"></p>
    </div>
    <div class="mfoot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" id="apBtn">Create login</button></div></form>`, { label: 'Add a person' });
  const el = m.el;
  let userTouched = false;
  $('#apUser', el).addEventListener('input', () => { userTouched = true; });
  $('#apName', el).addEventListener('input', () => { if (!userTouched) $('#apUser', el).value = S.slugUser(($('#apName', el).value.trim().split(/\s+/)[0] || '')); });
  $('#apForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const err = t => { const x = $('#apErr', el); x.textContent = t; x.classList.toggle('hidden', !t); };
    err('');
    const name = $('#apName', el).value.trim(), username = S.slugUser($('#apUser', el).value);
    if (!name) return err('Enter their name.');
    if (!username || username.length < 2) return err('Enter a username: letters and numbers only, at least 2.');
    const access = {}; $$('select[data-af]', el).forEach(s => { if (s.value) access[s.dataset.af] = s.value; });
    const btn = $('#apBtn', el); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const r = await S.addPerson({ name, username, access });
      showTempCard(m, name, r.username, r.temp, false);
    } catch (er) {
      btn.disabled = false; btn.textContent = 'Create login';
      err(er.code === 'username-taken' ? 'That username is taken. Try adding a last initial (e.g. ' + username + 'b).' : errorText(er));
    }
  });
}
function vaultAddress() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
function showTempCard(m, name, username, temp, again) {
  const text = 'NLO Vault login for ' + name + '\n\nWeb address: ' + vaultAddress() + '\nUsername: ' + username + '\nTemporary password: ' + temp +
    '\n\nYou’ll choose your own password the first time you sign in; then this temporary one stops working.\nOn a shared office computer, if the browser offers to save your password, choose Never.\nThrow this paper away once you’ve signed in.\n';
  m.set(html`<div class="mhead"><h2>${again ? 'New login for ' + name : name + ' is added'}</h2></div>
    <div class="mbody">
      <p>Give ${name} these <b>in person</b> (not by text or email):</p>
      <div class="kv"><span>Web address</span><b class="mono">${vaultAddress()}</b><span>Username</span><b class="mono" id="tmpUser">${username}</b><span>Temporary password</span><b class="mono big" id="tmpPw">${temp}</b></div>
      <p class="muted small">It works until ${name} chooses their own password at their first sign-in, then it stops working. ${again ? 'Their old password no longer works. ' : ''}You won’t be able to see this temporary password again.</p>
      <div class="btnRow"><button type="button" class="btn" id="tmpPrint">${ic('print')}<span>Print</span></button><button type="button" class="btn" id="tmpCopy">${ic('copy')}<span>Copy</span></button></div>
    </div>
    <div class="mfoot"><button type="button" class="btn primary" data-close>Done</button></div>`);
  $('#tmpCopy', m.el).addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { } });
  $('#tmpPrint', m.el).addEventListener('click', () => {
    const w = window.open('', '_blank', 'width=520,height=420'); if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.title = 'NLO Vault login';
    const pre = w.document.createElement('pre'); pre.textContent = text; pre.style.font = '16px/1.6 monospace'; pre.style.whiteSpace = 'pre-wrap'; pre.style.padding = '24px';
    w.document.body.appendChild(pre); w.focus(); w.print();
  });
  m.guard = null;
}
function personFoldersDialog(uid) {
  const u = V.users.get(uid); if (!u) return;
  const cur = new Map(Array.from(V.grants.values()).filter(g => g.uid === uid).map(g => [g.fid, g.role]));
  const m = openModal(html`<div class="mhead"><h2>${u.name}’s folders</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody"><div class="accList">${accessRows(cur)}</div><p class="muted small">Changes save straight away.</p></div>
    <div class="mfoot"><button type="button" class="btn primary" data-close>Done</button></div>`, { label: u.name + '’s folders' });
  $$('select[data-af]', m.el).forEach(s => s.addEventListener('change', async () => {
    const fid = s.dataset.af, role = s.value || null;
    if (!role) {
      const box = await confirmAccessRemoval(u, [fid]);
      if (!box) { s.value = cur.get(fid) || ''; return; }
      await withProgress('Taking ' + u.name + ' out of ' + fname(fid), p => S.setAccess(fid, uid, null, { flag: box.flag, progress: p }));
    } else if (cur.get(fid) === 'edit' && role === 'view') {
      if (await withProgress(u.name + ': view only in ' + fname(fid), p => S.setAccess(fid, uid, role, { progress: p }).then(() => true)) === null) { s.value = cur.get(fid) || ''; return; }
    } else { try { await S.setAccess(fid, uid, role); toast('Saved'); } catch (er) { toast(errorText(er), { kind: 'bad' }); s.value = cur.get(fid) || ''; return; } }
    cur.set(fid, role); renderAll();
  }));
}
export function folderDialog(fid) {
  const f = fid ? V.folders.get(fid) : null;
  const items = fid ? Array.from(V.items.values()).filter(i => i.f === fid).length : 0;
  let color = f ? f.color : 'blue';
  const m = openModal(html`<form id="fdForm" novalidate autocomplete="off">
    <div class="mhead"><h2>${f ? 'Folder: ' + f.name : 'New folder'}</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody">
      <label class="fld"><span>Name</span><input id="fdName" value="${f ? f.name : ''}" maxlength="60" placeholder="e.g. Insurance portals" autofocus></label>
      <div class="fld"><span>Color</span><div class="swatches" role="radiogroup" aria-label="Color">${COLORS.map(cn => html`<button type="button" class="sw ${FOLDER_CLS(cn)} ${cn === color ? 'on' : ''}" data-c="${cn}" role="radio" aria-checked="${cn === color ? 'true' : 'false'}" aria-label="${cn}"></button>`)}</div></div>
      <label class="fld"><span>New people get</span><select id="fdDef"><option value="" ${!f || !f.def ? 'selected' : ''}>No access (you choose)</option><option value="view" ${f && f.def === 'view' ? 'selected' : ''}>View</option><option value="edit" ${f && f.def === 'edit' ? 'selected' : ''}>Edit</option></select></label>
      ${f ? html`<p class="muted small">${items} ${items === 1 ? 'login' : 'logins'} in this folder${items ? ' (including the trash). Move or delete them before deleting the folder.' : '.'}</p>` : ''}
      <p id="fdErr" class="err hidden" role="alert"></p>
    </div>
    <div class="mfoot">${f ? html`<button type="button" class="btn danger subtle" id="fdDel" ${items ? 'disabled' : ''}>${ic('trash')}<span>Delete folder</span></button>` : ''}<span class="grow"></span>
      <button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" id="fdSave">${f ? 'Save' : 'Create'}</button></div></form>`, { label: 'Folder' });
  const el = m.el;
  $$('.sw', el).forEach(b => b.addEventListener('click', () => { color = b.dataset.c; $$('.sw', el).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); }); }));
  $('#fdForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#fdName', el).value.trim();
    const err = t => { const x = $('#fdErr', el); x.textContent = t; x.classList.remove('hidden'); };
    if (!name) return err('Give the folder a name.');
    const btn = $('#fdSave', el); btn.disabled = true;
    try {
      if (f) await S.updateFolder(fid, { name, color, def: $('#fdDef', el).value });
      else { const nf = await S.createFolder({ name, color, def: $('#fdDef', el).value }); U.view = 'folder:' + nf; }
      m.close(true); toast(f ? 'Saved' : 'Folder created'); renderAll();
    } catch (er) { btn.disabled = false; err(errorText(er)); }
  });
  const del = $('#fdDel', el);
  if (del) del.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'Delete “' + f.name + '”?', body: 'The empty folder is removed for everyone.', yes: 'Delete', danger: true }))) return;
    try { await S.deleteFolder(fid); m.close(true); if (U.view === 'folder:' + fid) U.view = 'all'; toast('Folder deleted'); renderAll(); }
    catch (er) { toast(er.code === 'not-empty' ? 'The folder still has logins in it (check the trash too).' : errorText(er), { kind: 'bad' }); }
  });
}
export async function onAdminClick(act, b) {
  const uid = b.dataset.u, u = uid ? V.users.get(uid) : null;
  switch (act) {
    case 'openItem': { const it = V.items.get(b.dataset.id); if (!it) return; U.view = 'all'; U.q = ''; U.sel = it.id; U.detail = true; renderAll(); break; }
    case 'addPerson': addPersonDialog(); break;
    case 'repairKey': {
      const fid = b.dataset.f, f = V.folders.get(fid);
      const what = 'The folder gets a new key that you sign. Every login is locked again with it; any login saved with the key you didn’t make goes back to its last version you can vouch for, and anything slipped in is removed (a copy stays in its history). Do this after you’ve changed your email password and your vault password.';
      let meta = null;
      if (f && !f.named) {
        // its name (and whether it's his private folder) was sealed with the key he didn't make: ask again
        meta = await new Promise(resolve => {
          let answered = false;
          const m = openModal(html`<div class="mhead"><h2>Give this folder a new key?</h2></div>
            <div class="mbody"><p>${what}</p><p>Its name couldn’t be read (it was locked with the key you didn’t make), so type it again:</p>
              <label class="fld"><span>Folder name</span><input id="rkName" maxlength="60" autocomplete="off"></label>
              <label class="chk"><input type="checkbox" id="rkPriv"> This is my private folder (new logins and imports go here)</label>
              <p id="rkErr" class="err hidden" role="alert"></p></div>
            <div class="mfoot"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn primary" data-yes>Make a new key</button></div>`,
            { label: 'New key', onClose: () => { if (!answered) resolve(null); } });
          m.el.querySelector('[data-no]').addEventListener('click', () => { answered = true; resolve(null); m.close(true); });
          m.el.querySelector('[data-yes]').addEventListener('click', () => {
            const name = $('#rkName', m.el).value.trim();
            if (!name) { const x = $('#rkErr', m.el); x.textContent = 'Type the folder’s name.'; x.classList.remove('hidden'); return; }
            answered = true; resolve({ name, priv: $('#rkPriv', m.el).checked }); m.close(true);
          });
        });
        if (!meta) return;
      } else if (!(await confirmBox({ title: 'Give ' + fname(fid) + ' a new key?', body: what, yes: 'Make a new key' }))) return;
      await withProgress('New key for ' + (meta ? meta.name : fname(fid)), p => S.rotateFolder(fid, '', p, [], {}, meta));
      renderAll();
      break;
    }
    case 'personFolders': personFoldersDialog(uid); break;
    case 'folderUp': case 'folderDown': try { await S.moveFolder(b.dataset.f, act === 'folderUp' ? -1 : 1); } catch (er) { toast(errorText(er), { kind: 'bad' }); } break;
    case 'reissue': {
      if (!u) return;
      if (!(await confirmBox({ title: 'Reissue ' + u.name + '’s login?', body: 'Use this when they forgot their password. They get a new temporary password and keep the same folders. Their old password stops working.', yes: 'Reissue login' }))) return;
      const m = openModal(html`<div class="mbody"><p>Making a new login…</p></div>`, { sticky: true });
      try { const r = await S.reissue(uid); showTempCard(m, u.name, r.username, r.temp, true); }
      catch (er) { m.close(true); toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'removePerson': {
      if (!u) return;
      const fids = Array.from(V.grants.values()).filter(g => g.uid === uid).map(g => g.fid);
      const box = await confirmAccessRemoval(u, fids, true);
      if (!box) return;
      await withProgress('Removing ' + u.name, p => S.removePerson(uid, { flag: box.flag, progress: p }));
      renderAll();
      break;
    }
    case 'rehire': {
      if (!u) return;
      if (!(await confirmBox({ title: 'Give ' + u.name + ' a new login?', body: 'They get a new temporary password and no folders until you choose them.', yes: 'Make a login' }))) return;
      const m = openModal(html`<div class="mbody"><p>Making a new login…</p></div>`, { sticky: true });
      try { const r = await S.reissue(uid); showTempCard(m, u.name, r.username, r.temp, true); renderAll(); }
      catch (er) { m.close(true); toast(errorText(er), { kind: 'bad' }); }
      break;
    }
    case 'deletedForGood': deletedDialog(); break;
    case 'actRefresh': loadActivity(); break;
    case 'restoreVer': await restoreVersion(b); break;
    case 'newCode': newCodeDialog(); break;
  }
}

/* ---------- Activity ---------- */
const ACT = {
  setup: 'set up the vault', create: 'added', edit: 'changed', move: 'moved', delete: 'moved to the trash', restore: 'put back', purge: 'deleted for good',
  reveal: 'looked at the password of', 'copy-pw': 'copied the password of', 'copy-user': 'copied the username of', 'copy-2fa': 'copied a 2-step code for',
  'copy-field': 'copied a field of', open: 'opened the website of', share: 'gave access to', unshare: 'took away access to', 'person-add': 'added a person:',
  'person-remove': 'removed', reissue: 'reissued a login for', rekey: 'gave a new key to', 'folder-new': 'made the folder', 'folder-edit': 'changed the folder',
  'folder-del': 'deleted a folder', import: 'imported', backup: 'downloaded an encrypted backup', 'pw-change': 'changed their own password',
  recovered: 'used the recovery code', 'rec-code': 'made a new recovery code', settings: 'changed the settings', restoreVer: 'restored an earlier version of',
  undelete: 'brought back a login deleted for good:'
};
let actData = null, actFilter = { who: '', what: '' };
export function renderActivity(c) {
  if (!V.owner) return;
  setHTML(c, html`<div class="page">
    <div class="pageHead"><h1>Activity</h1><p class="sub">Who opened, copied or changed what. Only you can see this, and nobody can edit or delete it.</p>
      <button type="button" class="btn" data-act="actRefresh">${ic('refresh')}<span>Refresh</span></button></div>
    <div class="filters"><label>Person <select id="afWho"><option value="">Everyone</option>${Array.from(V.users.values()).sort((a, b) => a.name.localeCompare(b.name)).map(u => html`<option value="${u.uid}" ${actFilter.who === u.uid ? 'selected' : ''}>${u.name}${u.active ? '' : ' (removed)'}</option>`)}</select></label>
      <label>What <select id="afWhat"><option value="">Everything</option><option value="copy" ${actFilter.what === 'copy' ? 'selected' : ''}>Copied or looked at a password</option><option value="change" ${actFilter.what === 'change' ? 'selected' : ''}>Added, changed or deleted</option><option value="admin" ${actFilter.what === 'admin' ? 'selected' : ''}>People, folders and access</option></select></label></div>
    <div id="actList"><p class="muted">Loading…</p></div></div>`);
  $('#afWho', c).addEventListener('change', e => { actFilter.who = e.target.value; drawActivity(); });
  $('#afWhat', c).addEventListener('change', e => { actFilter.what = e.target.value; drawActivity(); });
  if (actData) drawActivity();
  loadActivity();
}
async function loadActivity() {
  try { actData = await S.activity(500); drawActivity(); }
  catch (er) { const el = $('#actList'); if (el) setHTML(el, html`<p class="err">${errorText(er)}</p>`); }
}
function drawActivity() {
  const el = $('#actList'); if (!el || !actData) return;
  const groups = { copy: ['reveal', 'copy-pw', 'copy-user', 'copy-2fa', 'copy-field', 'open'], change: ['create', 'edit', 'move', 'delete', 'restore', 'purge', 'import', 'restoreVer'] };
  const list = actData.filter(a => (!actFilter.who || a.by === actFilter.who)
    && (!actFilter.what || (actFilter.what === 'admin' ? ![].concat(groups.copy, groups.change).includes(a.a) : groups[actFilter.what].includes(a.a))));
  let day = '';
  setHTML(el, list.length ? html`<ul class="act">${list.map(a => {
    const d = fmtDate(a.at), head = d !== day ? (day = d, html`<li class="day">${d}</li>`) : '';
    const target = a.i ? html` <b>${ititle(a.i)}</b>${a.f ? html` <span class="muted">(${fname(a.f)})</span>` : ''}`
      : a.f ? html` <b>${fname(a.f)}</b>` : '';
    const who2 = a.u ? html` <b>${S.userName(a.u)}</b>` : '';
    const extra = a.a === 'share' ? html` (${a.n === 2 ? 'edit' : 'view'})` : a.a === 'import' || a.a === 'backup' ? html` ${a.n || 0} logins` : a.a === 'rekey' ? html` (${a.n || 0} logins re-locked)` : '';
    return html`${head}<li><span class="t">${fmtTime(a.at)}</span><span><b>${S.userName(a.by)}</b> ${ACT[a.a] || a.a}${who2}${a.a === 'share' || a.a === 'unshare' ? html` <span class="muted">→</span>` : ''}${target}${extra}</span></li>`;
  })}</ul>` : html`<p class="muted">Nothing yet.</p>`);
}

/* ---------- History of one login (Dr. A) ---------- */
let histCache = null;
export async function historyDialog(it) {
  const m = openModal(html`<div class="mhead"><h2>History: ${it.d.t}</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div><div class="mbody"><p class="muted">Loading…</p></div>`, { wide: true, label: 'History' });
  try {
    const vs = await S.itemHistory(it.id); histCache = { it, vs, m };
    const field = (l, v, secret) => v ? html`<div class="hf"><span>${l}</span><span class="${secret ? 'mono blur' : ''}" ${secret ? raw('tabindex="0" title="Hover or focus to see"') : ''}>${v}</span></div>` : '';
    m.set(html`<div class="mhead"><h2>History: ${it.d.t}</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
      <div class="mbody">${vs.length ? html`<p class="muted small">Each entry is how the login looked before a change. Passwords are blurred until you point at them.</p><ol class="hist">${vs.map(v => html`<li>
        <div class="hh"><b>Before the change on ${fmtWhen(v.at)}</b> by ${S.userName(v.by)}${v.del ? html` <span class="badge">in trash</span>` : ''}
          ${v.d ? html`<button type="button" class="btn small" data-act="restoreVer" data-rev="${v.rev}">${ic('restore')}<span>Restore this version</span></button>` : html`<span class="muted small">can’t be opened</span>`}</div>
        ${v.d ? html`${field('Name', v.d.t)}${field('Folder', fname(v.f))}${field('Website', v.d.url)}${field('Username', v.d.u)}${field('Password', v.d.p, true)}${field('Notes', v.d.n)}` : ''}
      </li>`)}</ol>` : html`<p class="muted">No earlier versions — this login hasn’t been changed since it was added.</p>`}</div>
      <div class="mfoot"><button type="button" class="btn primary" data-close>Close</button></div>`);
    m.el.addEventListener('click', e => { const b = e.target.closest('[data-act=restoreVer]'); if (b) restoreVersion(b); });
  } catch (er) { m.set(html`<div class="mbody"><p class="err">${errorText(er)}</p></div><div class="mfoot"><button class="btn" data-close>Close</button></div>`); }
}
async function restoreVersion(b) {
  if (!histCache) return;
  const { it, vs, m } = histCache;
  const v = vs.find(x => x.rev === +b.dataset.rev); if (!v || !v.d) return;
  if (!(await confirmBox({ title: 'Restore this version?', body: 'The login goes back to how it was before the change on ' + fmtWhen(v.at) + '. The current version is kept in History too.', yes: 'Restore' }))) return;
  const cur = V.items.get(it.id); if (!cur) return;
  const fid = V.folders.has(v.f) && S.canEdit(v.f) ? v.f : cur.f;
  try { await S.saveItem(it.id, fid, Object.assign({}, v.d), { rev: cur.rev, act: 'restoreVer' }); m.close(true); toast('Restored'); renderAll(); }
  catch (er) { toast(errorText(er), { kind: 'bad' }); }
}

/* ---------- logins deleted for good (Dr. A): their last version is still in history ---------- */
async function deletedDialog() {
  const m = openModal(html`<div class="mhead"><h2>Deleted for good</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div><div class="mbody"><p class="muted">Looking…</p></div>`, { wide: true, label: 'Deleted for good' });
  let list;
  try { list = await S.deletedItems(); } catch (er) { m.set(html`<div class="mbody"><p class="err">${errorText(er)}</p></div>`); return; }
  const draw = () => m.set(html`<div class="mhead"><h2>Deleted for good</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody">${list.length ? html`<p class="muted small">These were removed from the vault, but an encrypted copy stays in its history, so they can be brought back.</p>
      <ul class="plain">${list.map((x, n) => html`<li class="remRow"><span><b>${x.d ? x.d.t || hostOf(x.d.url) || 'Untitled' : 'Can’t be opened'}</b> <span class="muted">· ${fname(x.f)} · deleted ${fmtDate(x.at)} by ${S.userName(x.by)}</span></span>
        ${x.d ? html`<button type="button" class="btn small" data-undel="${n}">${ic('restore')}<span>Bring back</span></button>` : ''}</li>`)}</ul>` : html`<p class="muted">Nothing has been deleted for good.</p>`}</div>
    <div class="mfoot"><button type="button" class="btn primary" data-close>Close</button></div>`);
  draw();
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-undel]'); if (!b) return;
    b.disabled = true;
    try { const x = list[+b.dataset.undel]; const r = await S.undelete(x); list.splice(+b.dataset.undel, 1); draw(); toast('Brought back into ' + fname(r.fid)); renderAll(); }
    catch (er) { b.disabled = false; toast(errorText(er), { kind: 'bad' }); }
  });
}

/* ---------- Settings ---------- */
export function renderSettings(c) {
  const max = Math.max(1, Math.min(60, V.settings.lockMax || 10));
  const mine = V.prefs.lock || 0;
  setHTML(c, html`<div class="page narrow">
    <div class="pageHead"><h1>Settings</h1><p class="sub">Signed in as <b>${(V.me || {}).name}</b>${V.me && V.me.username ? html` (${V.me.username})` : ''}.</p></div>
    <section class="card pad"><h2>Auto-lock</h2>
      <label class="fld inline"><span>Lock the vault after</span><select id="stLock">${LOCK_CHOICES.filter(n => n <= max).map(n => html`<option value="${n}" ${(mine || max) === n ? 'selected' : ''}>${n} minute${n === 1 ? '' : 's'} without use</option>`)}</select></label>
      <p class="muted small">It also locks when you close the tab. Shared office computers: keep this short.</p>
      ${V.owner ? html`<label class="fld inline"><span>Office limit: everyone’s vault locks after at most</span><select id="stMax">${LOCK_CHOICES.map(n => html`<option value="${n}" ${max === n ? 'selected' : ''}>${n} minutes</option>`)}</select></label>` : ''}
    </section>
    <section class="card pad"><h2>Change my password</h2>
      <form id="cpForm" novalidate autocomplete="off">
        <label class="fld"><span>Current password</span><input id="cpCur" type="password" autocomplete="off" maxlength="200"></label>
        <label class="fld"><span>New password</span><input id="cpNew" type="password" autocomplete="new-password" maxlength="200"></label>
        <div id="cpMeter"></div>
        <label class="fld"><span>New password again</span><input id="cpNew2" type="password" autocomplete="new-password" maxlength="200"></label>
        <p id="cpErr" class="err hidden" role="alert"></p>
        <button type="submit" class="btn primary" id="cpBtn">Change password</button>
      </form>
    </section>
    ${V.owner ? html`<section class="card pad"><h2>Recovery code</h2>
      <p>Your recovery code is the only way back in if you forget your password. If you’ve lost it, or someone else may have seen it, make a new one — the old one then stops working.</p>
      <button type="button" class="btn" data-act="newCode">${ic('key')}<span>Make a new recovery code</span></button></section>` : ''}
    <section class="card pad"><h2>How the vault protects passwords</h2>
      <ul class="plain small">
        <li>Everything is encrypted on this device (AES-256) before it’s saved. Google stores only scrambled data.</li>
        <li>Your password never leaves this device — not even Google’s sign-in sees it. That’s why nobody can reset it for you${V.owner ? ' (you have your recovery code)' : ' (Dr. A can reissue your login)'}.</li>
        <li>Each folder has its own key. You only ever get the keys of folders Dr. A gives you.</li>
        <li>Copied passwords clear from the clipboard after 30 seconds, and the vault locks itself when no one is using it.</li>
        <li>Every change keeps the earlier version, and every copy or look is recorded in Activity.</li>
        <li><b>Never put patient information in the vault.</b></li>
      </ul></section>
  </div>`);
  $('#stLock', c).addEventListener('change', async e => { try { await S.savePrefs({ lock: +e.target.value }); toast('Saved'); } catch (er) { toast(errorText(er), { kind: 'bad' }); } });
  const sm = $('#stMax', c); if (sm) sm.addEventListener('change', async e => { try { await S.saveSettings({ lockMax: +e.target.value }); toast('Saved'); } catch (er) { toast(errorText(er), { kind: 'bad' }); } });
  const me = V.me || {};
  const ctx = [me.name, me.username, 'nlo', 'vault'].concat(String(me.name || '').split(' '));
  $('#cpNew', c).addEventListener('input', () => setHTML($('#cpMeter', c), meterHTML($('#cpNew', c).value, ctx)));
  $('#cpForm', c).addEventListener('submit', async e => {
    e.preventDefault();
    const err = t => { const x = $('#cpErr', c); x.textContent = t; x.classList.toggle('hidden', !t); };
    err('');
    const cur = $('#cpCur', c).value, n1 = $('#cpNew', c).value, n2 = $('#cpNew2', c).value;
    if (!cur) return err('Enter your current password.');
    const prob = vaultPasswordProblem(n1, ctx); if (prob) return err(prob);
    if (n1 !== n2) return err('The new passwords don’t match.');
    const btn = $('#cpBtn', c); btn.disabled = true; btn.textContent = 'Changing…';
    try { await S.changePassword(cur, n1); $('#cpForm', c).reset(); setHTML($('#cpMeter', c), ''); toast('Password changed'); }
    catch (er) { err(er.code === 'bad-current' ? 'Your current password isn’t right.' : errorText(er)); }
    btn.disabled = false; btn.textContent = 'Change password';
  });
}
function newCodeDialog() {
  const m = openModal(html`<form id="ncForm" novalidate autocomplete="off"><div class="mhead"><h2>New recovery code</h2><button type="button" class="iconBtn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="mbody"><label class="fld"><span>Your vault password</span><input id="ncPw" type="password" autocomplete="off" autofocus></label><p id="ncErr" class="err hidden"></p></div>
    <div class="mfoot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" id="ncBtn">Make a new code</button></div></form>`, { label: 'New recovery code' });
  $('#ncForm', m.el).addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#ncBtn', m.el); btn.disabled = true;
    try { const code = await S.newRecoveryCode($('#ncPw', m.el).value); showRecoveryCode(code, false, { modal: m, after: () => { m.close(true); toast('New recovery code saved'); } }); }
    catch (er) { btn.disabled = false; const x = $('#ncErr', m.el); x.textContent = er.code === 'bad-current' ? 'That isn’t your password.' : errorText(er); x.classList.remove('hidden'); }
  });
}
