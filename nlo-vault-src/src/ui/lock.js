/* The screens before the vault opens: sign in, Dr. A's first-time setup, a new person choosing their own
   password, and Dr. A's recovery-code flow. */
import { html, setHTML, $, ic, toast, errorText, meterHTML, download } from './common.js';
import * as S from '../store.js';
import { genWords, vaultPasswordProblem } from '../gen.js';
import { LOGO } from '../assets.js';
import { normCode } from '../crypto.js';

let done = null;   // called once the vault is unlocked
const REMEMBER = 'nloVault.login';
function remembered() { try { return localStorage.getItem(REMEMBER) || ''; } catch (e) { return ''; } }
function remember(v) { try { if (v) localStorage.setItem(REMEMBER, v); else localStorage.removeItem(REMEMBER); } catch (e) { } }

function page(card, o) {
  o = o || {};
  setHTML($('#root'), html`
  <div class="lockPage">
    <div class="lockCol">
      <div class="brand"><img src="${LOGO}" alt="Next Level Orthodontics"><div class="appName">${ic('lock')}<span>Vault</span></div></div>
      <div class="card lockCard ${o.wide ? 'wide' : ''}">${card}</div>
      <div class="lockMeta">${ic('shield')}<span>Locked on this device before it’s saved — not even Google can read it.</span></div>
    </div>
  </div>`);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}
function showErr(id, msg) { const el = $('#' + id); if (el) { el.textContent = msg || ''; el.classList.toggle('hidden', !msg); } }
function pwField(id, label, o) {
  o = o || {};
  return html`<label class="fld"><span>${label}</span>
    <span class="pwRow"><input id="${id}" type="password" autocomplete="${o.ac || 'off'}" spellcheck="false" autocapitalize="off" ${o.autofocus ? 'autofocus' : ''} maxlength="200">
    <button type="button" class="iconBtn" data-toggle="${id}" aria-label="Show password" title="Show">${ic('eye')}</button></span></label>`;
}
function wireToggles(root) {
  root.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const inp = $('#' + b.dataset.toggle); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    setHTML(b, ic(show ? 'eyeOff' : 'eye')); b.title = show ? 'Hide' : 'Show';
  }));
}
function wireMeter(inputId, meterId, ctx) {
  const inp = $('#' + inputId), m = $('#' + meterId);
  const up = () => setHTML(m, meterHTML(inp.value, ctx()));
  inp.addEventListener('input', up); up();
}
function codeText(c) { return 'NLO Vault recovery code\n\n' + c + '\n\nKeep this somewhere safe (for example the office safe). With your email, it is the only way back into the vault if you forget your password.\nCreated ' + new Date().toLocaleString() + '\n'; }

/* ---------- sign in ---------- */
export function showSignIn(o) {
  o = o || {};
  const last = remembered();
  page(html`
    <h1>Sign in</h1>
    ${o.msg ? html`<p class="note ${o.kind || ''}">${o.msg}</p>` : ''}
    <form id="liForm" autocomplete="off" novalidate>
      <label class="fld"><span>Username</span><input id="liUser" autocomplete="username" spellcheck="false" autocapitalize="off" value="${last}" placeholder="Your username (Dr. A: your email)" ${last ? '' : 'autofocus'} maxlength="120"></label>
      ${pwField('liPw', 'Password', { autofocus: !!last, ac: 'off' })}
      <label class="chk"><input type="checkbox" id="liRemember" ${last || !o.first ? 'checked' : ''}> Remember my username on this computer</label>
      <p id="liErr" class="err hidden" role="alert"></p>
      <button class="btn primary block" id="liBtn" type="submit">${ic('unlock')}<span>Unlock</span></button>
    </form>
    <div class="lockLinks">
      <button type="button" class="link" id="liForgot">Forgot your password?</button>
      ${last && !o.setupLink ? '' : html`<button type="button" class="link small muted" id="liSetup">First time? Set up the vault (Dr. A)</button>`}
    </div>`);
  wireToggles($('#root'));
  if (last) setTimeout(() => $('#liPw') && $('#liPw').focus(), 30);
  $('#liForm').addEventListener('submit', async e => {
    e.preventDefault();
    const user = $('#liUser').value.trim(), pw = $('#liPw').value;
    showErr('liErr', '');
    if (!user || !pw) { showErr('liErr', 'Enter your username and password.'); return; }
    const btn = $('#liBtn'); busy(btn, true, 'Unlocking…');
    try {
      const r = await S.signIn(user, pw);
      remember($('#liRemember').checked ? user : '');
      $('#liPw').value = '';
      route(r, user);
    } catch (err) {
      busy(btn, false);
      const c = err.code || '';
      showErr('liErr', c === 'bad-login' ? 'That username and password don’t match. Check Caps Lock and try again.'
        : c === 'not-member' || c === 'inactive' ? 'This login has been turned off. Ask Dr. A.'
          : errorText(err));
      $('#liPw').select();
    }
  });
  $('#liForgot').addEventListener('click', () => {
    const u = $('#liUser').value.trim();
    if (u && !u.includes('@')) {
      page(html`<h1>Forgot your password?</h1>
        <p>Ask Dr. A to <b>reissue your login</b> (People &amp; access → your name → Reissue login). He’ll give you a new temporary password, and you’ll choose a new one when you sign in. Your folders stay the same.</p>
        <button type="button" class="btn block" id="fgBack">${ic('back')}<span>Back to sign in</span></button>`);
      $('#fgBack').addEventListener('click', () => showSignIn());
    } else showForgotOwner(u);
  });
  const su = $('#liSetup'); if (su) su.addEventListener('click', () => showSetup());
}
function route(r, login) {
  if (r.state === 'ok') return done();
  if (r.state === 'first') return showFirstPassword();
  if (r.state === 'recover') return showNeedCode();
  if (r.state === 'setup') return showVerify();
  if (r.state === 'verify') return showVerify();
  if (r.state === 'broken') return showSignIn({ msg: 'Your login works, but its key can’t be opened. Ask Dr. A to reissue your login.', kind: 'warn' });
}

/* ---------- Dr. A: first-time setup ---------- */
export function showSetup() {
  page(html`
    <h1>Set up NLO Vault</h1>
    <p class="muted">For Dr. A, once. Staff get their logins from you afterwards.</p>
    <form id="suForm" autocomplete="off" novalidate>
      <label class="fld"><span>Your email</span><input id="suEmail" type="email" autocomplete="email" spellcheck="false" autocapitalize="off" maxlength="120" autofocus></label>
      <label class="fld"><span>Your name as staff will see it</span><input id="suName" value="Dr. A" maxlength="60"></label>
      ${pwField('suPw', 'Choose your vault password', { ac: 'new-password' })}
      <div id="suMeter"></div>
      <button type="button" class="link small" id="suSuggest">${ic('wand')}<span>Suggest an easy-to-type password</span></button>
      <p id="suSuggestion" class="suggest hidden"></p>
      ${pwField('suPw2', 'Type it again', { ac: 'new-password' })}
      <div class="callout">${ic('info')}<div><b>Nobody can reset this password for you.</b> It never leaves this computer — not even Google sees it — so it can’t be emailed back. You’ll get a <b>recovery code</b> next; keep it somewhere safe.</div></div>
      <p id="suErr" class="err hidden" role="alert"></p>
      <button class="btn primary block" id="suBtn" type="submit">Create the vault</button>
    </form>
    <div class="lockLinks"><button type="button" class="link" id="suBack">${ic('back')}<span>Back to sign in</span></button></div>`);
  wireToggles($('#root'));
  wireMeter('suPw', 'suMeter', () => ['akhavan', 'nlo', 'vault']);
  $('#suBack').addEventListener('click', () => showSignIn());
  $('#suSuggest').addEventListener('click', () => {
    const w = genWords(5);
    const p = $('#suSuggestion'); p.classList.remove('hidden');
    setHTML(p, html`<span class="mono big">${w}</span> <button type="button" class="btn small" id="suUse">Use it</button><br><span class="muted small">Five random words. Write it down until you know it by heart.</span>`);
    $('#suUse').addEventListener('click', () => { $('#suPw').value = w; $('#suPw2').value = w; $('#suPw').type = 'text'; $('#suPw').dispatchEvent(new Event('input')); });
  });
  $('#suForm').addEventListener('submit', async e => {
    e.preventDefault(); showErr('suErr', '');
    const pw = $('#suPw').value, pw2 = $('#suPw2').value, email = $('#suEmail').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('suErr', 'Enter your email address.'); return; }
    const prob = vaultPasswordProblem(pw, ['akhavan', 'nlo', 'vault', email.split('@')[0]]);
    if (prob) { showErr('suErr', prob); return; }
    if (pw !== pw2) { showErr('suErr', 'The two passwords don’t match.'); return; }
    const btn = $('#suBtn'); busy(btn, true, 'Creating…');
    try {
      setupName = $('#suName').value.trim() || 'Dr. A';
      ownerEmail = email;
      const r = await S.setupAccount(email, pw);
      remember(email);
      if (r.state === 'ok') return done();
      if (r.state === 'verify') return showVerify();
      if (r.state === 'setup') return finishSetup();
      route(r);
    } catch (err) {
      busy(btn, false);
      showErr('suErr', err.code === 'exists-other-password' ? 'There’s already an account for this email with a different password. Sign in instead (or use “Forgot your password?”).' : errorText(err));
    }
  });
}
let setupName = 'Dr. A', ownerEmail = '';
function showVerify() {
  page(html`
    <h1>Check your email</h1>
    <p>We sent a link to <b>${ownerEmail || 'your email'}</b>. Click it to confirm it’s your address, then come back here and press Continue.</p>
    <p id="vfErr" class="err hidden" role="alert"></p>
    <button type="button" class="btn primary block" id="vfBtn">Continue</button>
    <div class="lockLinks"><button type="button" class="link" id="vfResend">Send the link again</button></div>`);
  $('#vfBtn').addEventListener('click', async () => {
    const btn = $('#vfBtn'); busy(btn, true, 'Checking…'); showErr('vfErr', '');
    try {
      if (!(await S.emailVerifiedNow())) { busy(btn, false); showErr('vfErr', 'Not confirmed yet — open the email and click the link first.'); return; }
      await finishSetup();
    } catch (err) { busy(btn, false); showErr('vfErr', errorText(err)); }
  });
  $('#vfResend').addEventListener('click', async () => { try { await S.resendVerification(); toast('Sent again'); } catch (err) { toast(errorText(err), { kind: 'bad' }); } });
}
async function finishSetup() {
  page(html`<h1>Creating the vault…</h1><p class="muted">Making your keys and the starting folders.</p>`);
  try {
    const r = await S.setupVault(setupName);
    showRecoveryCode(r.code, true);
  } catch (err) {
    if (err.code === 'not-owner-email') { page(html`<h1>Not the owner’s email</h1><p>Only the practice owner’s email address can set up this vault. Staff get their logins from Dr. A.</p><button class="btn block" id="rback">Back to sign in</button>`); $('#rback').addEventListener('click', async () => { await S.lock(); showSignIn(); }); return; }
    page(html`<h1>Setup didn’t finish</h1><p class="err">${errorText(err)}</p><button class="btn block" id="rtry">Try again</button>`); $('#rtry').addEventListener('click', finishSetup);
  }
}
/* shown at setup and whenever Dr. A makes a new one in Settings */
export function showRecoveryCode(code, first, onDone) {
  const body = html`
    <h1>${first ? 'Your recovery code' : 'Your new recovery code'}</h1>
    <p>If you ever forget your vault password, this code — with your email — is the <b>only</b> way back in. Keep it somewhere safe, away from this computer (the office safe is good).${first ? '' : html` <b>Your old code no longer works.</b>`}</p>
    <div class="codeBox mono" id="rcCode">${code}</div>
    <div class="btnRow"><button type="button" class="btn" id="rcPrint">${ic('print')}<span>Print</span></button>
      <button type="button" class="btn" id="rcDl">${ic('download')}<span>Download</span></button>
      <button type="button" class="btn" id="rcCopy">${ic('copy')}<span>Copy</span></button></div>
    <label class="fld"><span>To be sure it’s saved, type its last four characters</span><input id="rcConfirm" maxlength="4" autocomplete="off" spellcheck="false" autocapitalize="characters"></label>
    <p id="rcErr" class="err hidden" role="alert"></p>
    <button type="button" class="btn primary block" id="rcBtn">${first ? 'Open the vault' : 'Done'}</button>`;
  if (onDone) { onDone.modal.set(html`<div class="mbody">${body}</div>`); } else page(body);
  const root = onDone ? onDone.modal.el : $('#root');
  root.querySelector('#rcPrint').addEventListener('click', () => {
    const w = window.open('', '_blank', 'width=600,height=500');
    if (!w) { toast('Allow pop-ups to print, or use Download'); return; }
    w.document.title = 'NLO Vault recovery code';
    const pre = w.document.createElement('pre'); pre.textContent = codeText(code);
    pre.style.font = '18px/1.6 monospace'; pre.style.whiteSpace = 'pre-wrap'; pre.style.padding = '24px';
    w.document.body.appendChild(pre); w.focus(); w.print();
  });
  root.querySelector('#rcDl').addEventListener('click', () => download('NLO-Vault-recovery-code.txt', codeText(code), 'text/plain'));
  root.querySelector('#rcCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(code); toast('Copied — paste it somewhere safe, then clear it'); } catch (e) { } });
  root.querySelector('#rcBtn').addEventListener('click', () => {
    const t = normCode(root.querySelector('#rcConfirm').value).replace(/-/g, '');
    if (t !== normCode(code).replace(/-/g, '').slice(-4)) { const er = root.querySelector('#rcErr'); er.textContent = 'That isn’t the end of the code. Look again.'; er.classList.remove('hidden'); return; }
    if (onDone) onDone.after(); else done();
  });
}

/* ---------- a new person: choose your own password ---------- */
function showFirstPassword() {
  const me = S.V.me || {};
  page(html`
    <h1>Welcome${me.name ? ', ' + me.name.split(' ')[0] : ''}</h1>
    <p>Choose your own password. Only you will know it — Dr. A can’t see it, and the temporary one stops working.</p>
    <form id="fpForm" autocomplete="off" novalidate>
      ${pwField('fpPw', 'Your new password', { ac: 'new-password', autofocus: true })}
      <div id="fpMeter"></div>
      <button type="button" class="link small" id="fpSuggest">${ic('wand')}<span>Suggest an easy-to-type password</span></button>
      <p id="fpSuggestion" class="suggest hidden"></p>
      ${pwField('fpPw2', 'Type it again', { ac: 'new-password' })}
      <p class="muted small">At least 12 characters. A few ordinary words in a row (“maple river cocoa lamp”) is strong and easy to remember. Don’t reuse a password from anywhere else.</p>
      <p id="fpErr" class="err hidden" role="alert"></p>
      <button class="btn primary block" id="fpBtn" type="submit">Save and open the vault</button>
    </form>`);
  wireToggles($('#root'));
  const ctx = () => [me.name, me.username, 'nlo', 'vault'].concat(String(me.name || '').split(' '));
  wireMeter('fpPw', 'fpMeter', ctx);
  $('#fpSuggest').addEventListener('click', () => {
    const w = genWords(5);
    const p = $('#fpSuggestion'); p.classList.remove('hidden');
    setHTML(p, html`<span class="mono big">${w}</span> <button type="button" class="btn small" id="fpUse">Use it</button>`);
    $('#fpUse').addEventListener('click', () => { $('#fpPw').value = w; $('#fpPw2').value = w; $('#fpPw').type = 'text'; $('#fpPw').dispatchEvent(new Event('input')); });
  });
  $('#fpForm').addEventListener('submit', async e => {
    e.preventDefault(); showErr('fpErr', '');
    const pw = $('#fpPw').value, pw2 = $('#fpPw2').value;
    const prob = vaultPasswordProblem(pw, ctx()); if (prob) { showErr('fpErr', prob); return; }
    if (pw !== pw2) { showErr('fpErr', 'The two passwords don’t match.'); return; }
    const btn = $('#fpBtn'); busy(btn, true, 'Saving…');
    try { await S.setOwnPassword(pw); done(); }
    catch (err) { busy(btn, false); showErr('fpErr', errorText(err)); }
  });
}

/* ---------- Dr. A: forgot password ---------- */
function showForgotOwner(email) {
  page(html`
    <h1>Forgot your password? (Dr. A)</h1>
    <ol class="steps">
      <li>We email you a link to set a new password.</li>
      <li>Then you’ll need your <b>24-character recovery code</b>.</li>
    </ol>
    <label class="fld"><span>Your email</span><input id="foEmail" type="email" value="${email || ''}" autocomplete="email" spellcheck="false" autocapitalize="off" maxlength="120" ${email ? '' : 'autofocus'}></label>
    <p id="foErr" class="err hidden" role="alert"></p>
    <button type="button" class="btn primary block" id="foSend">Send the email</button>
    <div class="lockLinks">
      <button type="button" class="link" id="foGoogle">I already set a new password from the email</button>
      <button type="button" class="link" id="foBack">${ic('back')}<span>Back to sign in</span></button>
    </div>
    <p class="muted small">Staff: ask Dr. A to reissue your login instead.</p>`);
  $('#foBack').addEventListener('click', () => showSignIn());
  $('#foGoogle').addEventListener('click', () => showGoogleReset($('#foEmail').value.trim()));
  $('#foSend').addEventListener('click', async () => {
    const em = $('#foEmail').value.trim();
    if (!em.includes('@')) { showErr('foErr', 'Enter your email address.'); return; }
    const btn = $('#foSend'); busy(btn, true, 'Sending…'); showErr('foErr', '');
    try {
      await S.sendReset(em);
      page(html`<h1>Email sent</h1>
        <p>Open the email from NLO Vault and click the link.</p>
        <ul class="steps"><li>If the link opens the vault, it will ask for your new password and recovery code.</li>
        <li>If it opens a Google page instead, set your new password there, then come back and choose <b>I already set a new password</b>.</li></ul>
        <button type="button" class="btn block" id="foG2">I already set a new password</button>
        <div class="lockLinks"><button type="button" class="link" id="foB2">${ic('back')}<span>Back to sign in</span></button></div>`);
      $('#foG2').addEventListener('click', () => showGoogleReset(em));
      $('#foB2').addEventListener('click', () => showSignIn());
    } catch (err) { busy(btn, false); showErr('foErr', errorText(err)); }
  });
}
function recoveryForm(id, withEmail, withNewPw, title, intro, act) {
  page(html`
    <h1>${title}</h1><p>${intro}</p>
    <form id="${id}Form" autocomplete="off" novalidate>
      ${withEmail ? html`<label class="fld"><span>Your email</span><input id="${id}Email" type="email" value="${withEmail === true ? '' : withEmail}" autocomplete="email" spellcheck="false" autocapitalize="off" maxlength="120"></label>` : ''}
      ${id === 'rg' ? pwField('rgGoogle', 'The password you set on Google’s page', { ac: 'off', autofocus: true }) : ''}
      ${withNewPw ? html`${pwField(id + 'Pw', withNewPw, { ac: 'new-password', autofocus: id !== 'rg' })}<div id="${id}Meter"></div>${pwField(id + 'Pw2', 'Type it again', { ac: 'new-password' })}` : ''}
      <label class="fld"><span>Recovery code</span><input id="${id}Code" class="mono" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" ${withNewPw ? '' : 'autofocus'}></label>
      <p id="${id}Err" class="err hidden" role="alert"></p>
      <button class="btn primary block" id="${id}Btn" type="submit">Unlock</button>
    </form>
    <div class="lockLinks"><button type="button" class="link" id="${id}Back">${ic('back')}<span>Back to sign in</span></button></div>`);
  wireToggles($('#root'));
  if (withNewPw) wireMeter(id + 'Pw', id + 'Meter', () => ['akhavan', 'nlo', 'vault']);
  $('#' + id + 'Back').addEventListener('click', () => { history.replaceState(null, '', location.pathname); showSignIn(); });
  $('#' + id + 'Form').addEventListener('submit', async e => {
    e.preventDefault(); showErr(id + 'Err', '');
    const btn = $('#' + id + 'Btn'); busy(btn, true, 'Unlocking…');
    try { const r = await act(); history.replaceState(null, '', location.pathname); route(r); }
    catch (err) {
      busy(btn, false);
      const c = err.code || '';
      showErr(id + 'Err', c === 'bad-code' ? 'That recovery code doesn’t match. Check each character.' : c === 'bad-login' ? 'That password doesn’t match what was set on the Google page.' : c === 'weak' ? err.message : /expired|invalid-action-code/.test(c) ? 'This reset link has expired or was already used. Send a new email.' : errorText(err));
    }
  });
}
/* the reset link opened the vault (best: Google never sees the new password) */
export function showResetLink(oob) {
  recoveryForm('rl', false, 'Choose a new vault password', 'Set a new password (Dr. A)', 'Choose a new password, then enter your recovery code to unlock the vault with it.', async () => {
    const pw = $('#rlPw').value;
    const prob = vaultPasswordProblem(pw, ['akhavan', 'nlo', 'vault']); if (prob) { const e = new Error(prob); e.code = 'weak'; throw e; }
    if (pw !== $('#rlPw2').value) { const e = new Error('The two passwords don’t match.'); e.code = 'weak'; throw e; }
    return S.resetWithLink(oob, pw, $('#rlCode').value);
  });
}
function showGoogleReset(email) {
  recoveryForm('rg', email || true, 'Choose your new vault password', 'Unlock with your recovery code',
    'Google saw the password you typed on its page, so it only signs you in this once. Choose a different password for the vault itself.', async () => {
    const g = $('#rgGoogle').value, pw = $('#rgPw').value, em = $('#rgEmail').value.trim();
    const fail = t => { const e = new Error(t); e.code = 'weak'; throw e; };
    if (!em.includes('@')) fail('Enter your email address.');
    if (g.length < 6) fail('Enter the password you set on Google’s page.');
    const prob = vaultPasswordProblem(pw, ['akhavan', 'nlo', 'vault', em.split('@')[0]]); if (prob) fail(prob);
    if (pw !== $('#rgPw2').value) fail('The two new passwords don’t match.');
    if (pw === g) fail('Choose a vault password different from the one you typed on Google’s page.');
    return S.resetWithGooglePage(em, g, $('#rgCode').value, pw);
  });
}
/* signed in with a new password, but the key still needs the recovery code */
function showNeedCode() {
  recoveryForm('rc2', false, '', 'Enter your recovery code', 'Your password changed, so your vault key needs your recovery code once to switch over.', () => S.recoverSignedIn($('#rc2Code').value));
}

export function initLock(onUnlocked) { done = onUnlocked; }
export function notConfigured() {
  page(html`<h1>Not connected yet</h1><p>This copy of NLO Vault isn’t linked to its Firebase project yet. Finish the setup steps, then reload.</p>`);
}
export function showEmailVerified(ok, msg) {
  showSignIn({ msg: ok ? 'Email confirmed. Go back to the setup tab and press Continue — or sign in here.' : (msg || 'That link didn’t work. It may have expired.'), kind: ok ? 'good' : 'warn' });
}
