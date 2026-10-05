/* =====================================================================
   UI
   ===================================================================== */
const S = {
  demo: false, emu: false, cases: new Map(), closed: [], oldOff: new Set(), oldMonths: 3, oldNoDate: false, bulkBusy: '', closedDays: 90, roster: [], members: [], settings: { idleMin: 10 },
  view: 'today', boardFlow: 'outside', q: '', f: noFilters(), sort: { k: 'due', dir: 1 },
  openId: null, editing: false, editBase: null, lastLogin: '', tempPw: '', loginPw: '', lastAct: Date.now(), idleTimer: null,
  inApp: false, renderQ: false, firstLoad: true
};
let B = null;

/* ---------- icons ---------- */
const IC = {
  tour: '<circle cx="12" cy="12" r="8.5"/><path d="M10.3 8.7l5 3.3-5 3.3z"/>',
  truck: '<path d="M2.5 5.5h11v10h-11z"/><path d="M13.5 9h4.3l3.2 3.5v3h-7.5"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  video: '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.4l6-3.4v10l-6-3.4z"/>',
  ext: '<path d="M13.5 4.5h6v6M19.5 4.5L11 13"/><path d="M17 13.5v5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 014 18.5v-10A1.5 1.5 0 015.5 7h5"/>',
  print:'<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 15l2.2 2 4.8-4.5"/>',
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="15.5" y="4" width="5" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.4 5.2-5.2"/>',
  team: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.2 3.2-5 6-5s5.1 1.8 6 5"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.6c2.3.2 3.9 1.8 4.5 4.4"/>',
  import: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  shield: '<path d="M12 3l7 2.8v5.5c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.8z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  edit: '<path d="M4 20h4l10.5-10.5-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  cols: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15M14.5 4.5v15"/>',
  chat: '<path d="M5 5h14a1.5 1.5 0 011.5 1.5V15a1.5 1.5 0 01-1.5 1.5h-7.5L7 20v-3.5H5A1.5 1.5 0 013.5 15V6.5A1.5 1.5 0 015 5z"/><path d="M8 9.5h8M8 12.5h5"/>',
  expand: '<path d="M7 9l5-5 5 5M7 15l5 5 5-5"/>',
  collapse: '<path d="M7 4l5 5 5-5M7 20l5-5 5 5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.innerHTML = esc(msg) + (opt.action ? ' <button class="linkBtn" style="color:var(--mint);margin-left:10px;pointer-events:auto">' + esc(opt.action) + '</button>' : '');
  if (opt.action) el.querySelector('button').onclick = () => { opt.onAction(); el.remove(); };
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || (opt.action ? 7000 : 3800));
}
function errText(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/no-user/.test(c)) return 'No login with that username.';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Username or password is incorrect.';
  if (/inactive/.test(c)) return 'This login has been turned off. Ask Dr. A.';
  if (/not-member/.test(c)) return 'That account isn’t part of the office.';
  if (/no-setup/.test(c)) return 'The office hasn’t been set up yet.';
  if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a minute and try again.';
  if (/network|unavailable/.test(c)) return 'Can’t reach the server. Check the internet connection.';
  if (/email-already-in-use/.test(c)) return 'An account with that email already exists.';
  if (/weak-password/.test(c)) return 'Password needs at least 8 characters.';
  if (/invalid-email/.test(c)) return 'That email address doesn’t look right.';
  if (/boot-failed/.test(c)) return 'That temporary password didn’t work. Ask Dr. A to reissue your login.';
  if (/boot-stale/.test(c)) return 'This invite expired after a security update. Ask Dr. A to reissue your login.';
  if (/bad-code/.test(c)) return 'That recovery code didn’t work. Check it and try again.';
  if (/taken/.test(c)) return 'That username is already in use.';
  if (/bad-username/.test(c)) return 'Usernames are 2–30 letters or numbers (dots and dashes OK).';
  if (/permission/.test(c)) return 'Not allowed. Your access may have changed.';
  if (/gone/.test(c)) return 'That case no longer exists.';
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  if (/backup-bad/.test(c)) return 'That isn’t an NLO Cases backup (pick the nlo-cases-backup file).';
  if (/backup-newer/.test(c)) return 'That backup was made by a newer NLO Cases. Reload this page and try again.';
  if (/backup-browser/.test(c)) return 'This browser can’t open the backup. Use Chrome or Edge.';
  if (/backup-no-key/.test(c)) return 'That backup is from another office and can’t be opened here.';
  if (/backup-demo/.test(c)) return 'The demo only opens its own backups. Open the real backup in NLO Cases.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}

/* ---------- boot ---------- */
function boot() {
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = qs.has('demo'); S.emu = local && qs.has('emu');
  // practice mode for the new-user tour (tour.js): the demo, signed in as staff (or as Dr. A); the demo keeps its own settings
  S.tour = S.demo && ['staff', 'owner'].includes(qs.get('tour')) ? qs.get('tour') : '';
  if (S.demo) demoSandbox();
  phInit();
  try { S.lastLogin = localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => {
    if (asgKey(e)) return; // the Assign to list (on the case list or the board)
    if (e.key === 'Escape') { if ($('#phWrap')) phClose(); else if ($('#modalWrap')) closeModal(); else if (S.openId) closeDrawer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.kc[data-act], tr.click[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  // the Assign to list follows its button when the page (or the board, or the table) scrolls, and closes once the button is
  // out of sight; it closes when the window changes size
  document.addEventListener('scroll', e => { if (S.asg && !(e.target && e.target.closest && e.target.closest('#asgMenu'))) asgFollow(); }, true);
  window.addEventListener('resize', () => { if (S.asg) asgClose(); });
  if (S.demo) {
    B = DEMO; DEMO.practice = S.tour; $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo');
    if (S.tour) $('#demoBar').textContent = 'Practice — made-up patients, nothing is saved';
    lockScreen('login');
    if (S.tour) setTimeout(() => { const b = $('#lgBtn'); if (b) b.click(); }, 60); // practice opens signed in
    return;
  }
  B = FB;
  if (!FB.init(S.emu)) { lockScreen('unconfigured'); return; }
  FB.onSync = renderSync;
  FB.ready().then(() => lockScreen(location.hash === '#setup' ? 'setup' : 'login'));
  window.addEventListener('online', renderSync); window.addEventListener('offline', renderSync);
}

/* ---------- lock screens ---------- */
function lockScreen(mode, info) {
  info = info || {};
  $('#lockWrap').classList.remove('hidden'); $('#app').classList.add('hidden');
  const card = $('#lockCard'); let h = '';
  const err = info.err ? '<div class="lockErr" role="alert">' + esc(info.err) + '</div>' : '';
  const ok = info.ok ? '<div class="lockOk" role="status">' + esc(info.ok) + '</div>' : '';
  if (mode === 'unconfigured') {
    h = '<h1>Almost ready</h1><div class="lsub">This copy isn’t connected to the office database yet.</div>' +
      '<p class="desc">Dr. A: finish the Firebase setup, then reload. To look around with made-up patients, open the demo.</p>' +
      '<a class="btn btn-pri btn-block" href="?demo">Open the demo</a>';
  } else if (mode === 'login') {
    h = '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · cases</div>' + err + ok +
      '<form id="loginForm" autocomplete="on" style="margin-top:16px">' +
      // practice mode (the tour): look-alike boxes, not real ones, so the browser never offers to save a "practice" password for this site
      (S.tour ? '<div class="field"><span class="flabel">Username</span><div class="inp" id="lgPracUser">practice</div></div>' +
        '<div class="field"><span class="flabel">Password</span><div class="inp" id="lgPracPw" aria-label="Password (filled in for practice)">••••••••</div></div>' :
      '<div class="field"><label for="lgUser">Username</label><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(S.demo ? 'demo' : S.lastLogin) + '" required></div>' +
      '<div class="field"><label for="lgPw">Password</label><input id="lgPw" type="password" autocomplete="current-password" ' + (S.demo ? 'value="demo"' : '') + ' required></div>') +
      '<button class="btn btn-pri btn-block" id="lgBtn" type="submit">Sign in</button></form>' +
      '<div class="lockFoot">Forgot your password? Ask Dr. A to reissue your login.' + (S.demo ? '' : '<br><button class="linkBtn" data-act="forgot" type="button">Dr. A: reset by email</button>') + '</div>';
  } else if (mode === 'first') {
    h = '<h1>Welcome, ' + esc(firstName(B.me && B.me.name)) + '</h1><div class="lsub">Choose your own password</div>' + err +
      '<p class="desc">Only you will know it. Use at least 8 characters. If you forget it, Dr. A can reissue your login.</p>' +
      '<form id="firstForm"><div class="field"><label for="fpw1">New password</label><input id="fpw1" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<div class="field"><label for="fpw2">Type it again</label><input id="fpw2" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<button class="btn btn-pri btn-block" id="fBtn" type="submit">Save and continue</button></form>';
  } else if (mode === 'recover') {
    h = '<h1>Unlock with your recovery code</h1><div class="lsub">Your password changed, so the office key needs your recovery code once.</div>' + err +
      '<form id="recForm" style="margin-top:16px"><div class="field"><label for="recCode">Recovery code</label><input id="recCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div>' +
      '<button class="btn btn-pri btn-block" type="submit">Unlock</button></form>' +
      '<div class="lockFoot"><button class="linkBtn" data-act="lockSignOut" type="button">Cancel</button></div>';
  } else if (mode === 'broken') {
    h = '<h1>Login needs a reset</h1><div class="lsub">Your password was changed outside the app.</div><p class="desc">Ask Dr. A to reissue your login from Team &amp; security. It takes a minute.</p>' +
      '<button class="btn btn-sec btn-block" data-act="lockSignOut">Back</button>';
  } else if (mode === 'forgot') {
    h = '<h1>Reset by email</h1><div class="lsub">For Dr. A’s email login</div>' + err + ok +
      '<form id="forgotForm" style="margin-top:16px"><div class="field"><label for="fgEmail">Your email</label><input id="fgEmail" type="email" autocomplete="email" required></div>' +
      '<button class="btn btn-pri btn-block" type="submit">Send reset link</button></form>' +
      '<p class="desc small" style="margin:14px 0 0">After you pick a new password, sign in with it. You’ll be asked for your recovery code once.</p>' +
      '<div class="lockFoot"><button class="linkBtn" data-act="toLogin" type="button">Back to sign in</button></div>';
  } else if (mode === 'setup') {
    h = '<h1>Set up the office</h1><div class="lsub">One time only · creates the owner account</div>' + err +
      '<form id="setupForm" style="margin-top:16px">' +
      '<div class="field"><label for="suName">Your name</label><input id="suName" autocomplete="name" value="Dr. Amir Akhavan" required></div>' +
      '<div class="field"><label for="suEmail">Your email</label><input id="suEmail" type="email" autocomplete="email" required><div class="hint">You’ll sign in with this. Password resets go here.</div></div>' +
      '<div class="field"><label for="suPw1">Password</label><input id="suPw1" type="password" autocomplete="new-password" minlength="10" required><div class="hint">At least 10 characters.</div></div>' +
      '<div class="field"><label for="suPw2">Type it again</label><input id="suPw2" type="password" autocomplete="new-password" minlength="10" required></div>' +
      '<button class="btn btn-pri btn-block" type="submit">Create office</button></form>';
  } else if (mode === 'verify') {
    h = '<h1>Check your email</h1><div class="lsub">One-time check that this is really you</div>' + err +
      '<p class="desc">We sent a link to <b>' + esc(S.setup ? S.setup.email : '') + '</b>. Open it, then come back here and press Continue.</p>' +
      '<form id="verifyForm"><button class="btn btn-pri btn-block" type="submit">Continue</button></form>' +
      '<div class="lockFoot">No email? Check spam, or <button class="linkBtn" data-act="resendVerify" type="button">send it again</button></div>';
  } else if (mode === 'code') {
    h = '<h1>Your recovery code</h1><div class="lsub">The only way back in if you forget your password</div>' +
      '<p class="desc">Print it or write it down and keep it somewhere safe, away from the computer. Nobody else has a copy — not even Claude or Google.</p>' +
      '<div class="codeBox" id="recShow">' + esc(info.code) + '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:14px"><button class="btn btn-sec btn-sm" data-act="copyCode" data-code="' + esc(info.code) + '">Copy</button><button class="btn btn-sec btn-sm" data-act="printCode">Print</button></div>' +
      '<label class="ackBox"><input type="checkbox" id="codeAck"><span>I saved my recovery code somewhere safe.</span></label>' +
      '<button class="btn btn-pri btn-block" data-act="codeDone" disabled id="codeDone">Open NLO Cases</button>';
  }
  card.innerHTML = h;
  // focus right away (never later, so it can't pull the cursor away from someone already typing)
  const f = mode === 'login' && S.tour ? $('#lgBtn') : mode === 'login' && $('#lgUser').value ? $('#lgPw') : $('input:not([type=checkbox])', card);
  if (f) f.focus();
  bindLockForms(mode);
}
async function finishSetup() {
  try {
    const code = await B.setupOwner(S.setup.name, S.setup.pw);
    S.lastLogin = S.setup.email; try { localStorage.setItem('nloCases.lastLogin', S.lastLogin); } catch (x) { }
    S.setup = null; history.replaceState(null, '', location.pathname + location.search);
    lockScreen('code', { code });
  } catch (x) {
    lockScreen('setup', { err: /permission/.test(x.code || '') ? 'Setup was refused: either this office is already set up, or that email isn’t the practice owner’s.' : errText(x) });
  }
}
function firstName(n) { return String(n || '').replace(/^dr\.?\s+/i, '').split(/\s+/)[0] || ''; }
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
function bindLockForms(mode) {
  const lf = $('#loginForm');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const btn = $('#lgBtn'); const user = S.tour ? 'practice' : $('#lgUser').value.trim(); const pw = S.tour ? 'practice' : $('#lgPw').value;
    busyBtn(btn, true, 'Signing in…');
    try {
      const r = await B.signIn(user, pw);
      S.lastLogin = user; try { localStorage.setItem('nloCases.lastLogin', user); } catch (x) { }
      S.loginPw = pw;
      if (r.state === 'ok') { S.loginPw = ''; enterApp(); }
      else lockScreen(r.state);
    } catch (x) { busyBtn(btn, false); lockScreen('login', { err: errText(x) }); }
  };
  const ff = $('#firstForm');
  if (ff) ff.onsubmit = async e => {
    e.preventDefault(); const a = $('#fpw1').value, b = $('#fpw2').value;
    if (a.length < 8) return lockScreen('first', { err: 'Use at least 8 characters.' });
    if (a !== b) return lockScreen('first', { err: 'The two passwords don’t match.' });
    if (a === S.loginPw) return lockScreen('first', { err: 'Pick something different from the temporary password.' });
    busyBtn($('#fBtn'), true, 'Saving…');
    try { await B.firstSetup(S.loginPw, a); S.loginPw = ''; enterApp(); }
    catch (x) { lockScreen('first', { err: errText(x) }); }
  };
  const rf = $('#recForm');
  if (rf) rf.onsubmit = async e => {
    e.preventDefault(); const btn = $('button[type=submit]', rf); busyBtn(btn, true, 'Unlocking…');
    try { await B.recover(S.loginPw, $('#recCode').value); S.loginPw = ''; toast('Unlocked. Your recovery code still works — keep it safe.'); enterApp(); }
    catch (x) { lockScreen('recover', { err: errText(x) }); }
  };
  const fg = $('#forgotForm');
  if (fg) fg.onsubmit = async e => {
    e.preventDefault();
    try { await B.sendReset($('#fgEmail').value.trim()); lockScreen('forgot', { ok: 'If that email has a login, a reset link is on its way.' }); }
    catch (x) { lockScreen('forgot', { err: errText(x) }); }
  };
  const sf = $('#setupForm');
  if (sf) sf.onsubmit = async e => {
    e.preventDefault(); const p1 = $('#suPw1').value, p2 = $('#suPw2').value;
    if (p1.length < 10) return lockScreen('setup', { err: 'Use at least 10 characters.' });
    if (p1 !== p2) return lockScreen('setup', { err: 'The two passwords don’t match.' });
    const btn = $('button[type=submit]', sf); busyBtn(btn, true, 'Creating…');
    S.setup = { name: $('#suName').value.trim(), email: $('#suEmail').value.trim().toLowerCase(), pw: p1 };
    try {
      const verified = await B.setupAccount(S.setup.email, p1);
      if (verified) await finishSetup(); else lockScreen('verify');
    } catch (x) { lockScreen('setup', { err: errText(x) }); }
  };
  const vf = $('#verifyForm');
  if (vf) vf.onsubmit = async e => {
    e.preventDefault(); const btn = $('button[type=submit]', vf); busyBtn(btn, true, 'Checking…');
    try { if (await B.setupVerified()) await finishSetup(); else lockScreen('verify', { err: 'Not verified yet. Open the link in the email, then press Continue.' }); }
    catch (x) { lockScreen('verify', { err: errText(x) }); }
  };
  const ack = $('#codeAck'); if (ack) ack.onchange = () => { $('#codeDone').disabled = !ack.checked; };
}

/* ---------- enter / leave ---------- */
function enterApp() {
  S.inApp = true; S.cases = new Map(); S.closed = []; histReset(); S.firstLoad = true; S.lastAct = Date.now(); S.settingsLoaded = false; S.rulesLv = null; S.idxRan = false; S.noteVisit = new Map();
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  S.h = {
    cases(up, gone) {
      // a stage move still being saved wins over an older copy arriving from the server (quick → → → clicks)
      // (a case saved at a retired step shows at the step that replaced it — see liveStage)
      up.forEach(c => { applNorm(c); c.stage = liveStage(c); const p = S.pend && S.pend[c.id]; if (p) { c.stage = p.to; if (p.extra) Object.assign(c, p.extra); } S.cases.set(c.id, c); }); gone.forEach(id => S.cases.delete(id));
      const first = S.firstLoad; S.firstLoad = false; queueRender();
      if (first) setTimeout(mailSync, 300); // lab emails that came in while nobody had the app open
      if (S.openId && (up.some(c => c.id === S.openId) || gone.includes(S.openId))) { const rd = () => { if (S.openId) refreshDrawer(gone.includes(S.openId)); }; if (!afterPress(rd)) rd(); }
    },
    inbox() { mailSync(); },
    mailbeat(list) { if (MAILS.state) MAILS.state.beats = list; if (S.view === 'admin') queueRender('team'); },
    roster(list) { S.roster = list; queueRender('team'); },
    members(list) { S.members = list; if (S.view === 'admin') queueRender('team'); },
    settings(s) {
      const first = !S.settingsLoaded; S.settings = Object.assign({ idleMin: 10 }, s || {}); S.settingsLoaded = true;
      if (S.view === 'admin') queueRender('team'); else if (first && S.view === 'today') queueRender(); // (Today's backup reminder)
      noteRefresh(); // (Dr. A reworded what patients are told: an open case's chart note follows)
      idxMaintain();
    },
    revoked() { lockOut('Your access to NLO Cases was turned off.'); },
    rekeyed() { },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  };
  B.start(S.h);
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (S.inApp && !S.tour && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.'); // practice mode has nothing to hide
  }, 15000);
  clearInterval(S.mailTimer); S.mailTimer = setInterval(mailSync, 180000); // also catches emails a case couldn't take yet
  S.rulesOld = false; rulesCheck();
  // practice mode: the tour starts by itself once, and after Lock it picks up where it was
  if (S.tour && (!S.tourBegun || TOUR.paused)) { S.tourBegun = true; const from = TOUR.paused; TOUR.paused = null; setTimeout(() => { if (S.inApp && !TOUR.on) tourStart(S.tour, from); }, 500); }
}
/* features that need newer security rules (patient photos, email updates) stay out of sight until the owner publishes them;
   the patient index and marked deletes (4 Oct 2026) wait for them too, while everything else works as before
   (S.rulesOld: photos / email updates wait; S.rulesIdx: only the index waits). true = all of them are live. */
async function rulesCheck() {
  const was = !!S.rulesOld;
  S.rulesOld = false; S.rulesIdx = false; document.body.classList.remove('phOff');
  if (!B.rulesLevel) return true;
  const lv = await B.rulesLevel(); if (!S.inApp) return lv >= 2;
  S.rulesLv = lv; S.rulesOld = lv < 1; S.rulesIdx = lv === 1; document.body.classList.toggle('phOff', lv < 1);
  if (lv < 2) queueRender('team');
  // just published: the live updates the older rules refused (lab inbox, mailbox check-ins) start again without signing in again
  if (lv >= 1 && was && S.h) { B.start(S.h); MAILS.state = null; queueRender('team'); }
  idxMaintain();
  return lv >= 2;
}
/* the owner's app keeps the patient index (see FB.idxFields): once the newer rules are live it indexes every case (once),
   then, at most every 6 hours, the cases saved since — an app opened before the update saves without the index */
async function idxMaintain() {
  if (!S.inApp || !isOwner() || S.rulesLv !== 2 || !S.settingsLoaded || S.idxRan || !B.indexCases) return;
  const last = Number(S.settings.pidx) || 0, t0 = Date.now(); if (last && t0 - last < 6 * 3600e3) return;
  S.idxRan = true;
  try {
    await B.indexCases(last ? last - 3600e3 : 0);
    if (!S.inApp) return;
    // (one refused because it raced a save was saved after this pass began, so the next pass looks at it again);
    // pidx0: when the first pass began — deletes are marked from then on (Deleted cases)
    await B.saveSettings(last ? { pidx: t0 } : { pidx: t0, pidx0: t0 });
    if (!last) { histReset(); queueRender(); }
  } catch (e) { S.idxRan = false; }
}
async function lockOut(msg) {
  if (!S.inApp) return;
  if (TOUR.on) msg = tourPause(msg); // practice mode: signing back in picks the tour up again
  S.inApp = false; clearInterval(S.idleTimer); clearInterval(S.mailTimer);
  closeModal(); closeDrawer(true);
  S.cases = new Map(); S.closed = []; histReset(); S.members = []; S.roster = []; S.iprCache = {}; S.verList = null; S.delList = null; S.impList = null; S.bk = null;
  Object.assign(MAILS, { list: [], unread: [], pick: {}, sig: '', state: null, stateAt: 0, script: '', gone: new Set(), goneFp: new Set(), hk: null, mem: null });
  phReset(); rxReset(); SH.data = null; SH.err = '';
  { const ts = $('#toasts'); if (ts) ts.innerHTML = ''; } // a toast's Copy chart note / Download PDF is for the case on screen
  try { await iprLink().disconnect(); } catch (e) { }
  $('#view').innerHTML = '';
  await B.signOut();
  lockScreen('login', { ok: msg });
}

/* ---------- derived data ---------- */
function meSid() { return B.me ? B.me.staffId : ''; }
function isOwner() { return B.isOwner(); }
function staff(sid) { return S.roster.find(r => r.sid === sid); }
function staffName(sid, fallback) { const r = staff(sid); return r ? r.name : (fallback || ''); }
function activeRoster() { return S.roster.filter(r => r.active).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.name.localeCompare(b.name)); }
function openCases() { return Array.from(S.cases.values()).filter(c => !c.locked); }
function matchesQ(c) {
  if (!S.q) return true; const q = S.q.toLowerCase();
  return [c.patient, c.chart, c.detail, typeOf(c).l, stageLabel(c), staffName(c.assignee, c.assigneeName), c.labRef, c.tracking].some(x => String(x || '').toLowerCase().includes(q));
}
function dueBucket(c) {
  const d = dayDiff(dueDateOf(c)); if (d === null) return 'none';
  if (d < 0) return 'over'; if (d === 0) return 'today'; if (d <= 6) return 'week'; if (d <= 14) return '14'; return 'later';
}
function byDue(a, b) {
  const x = dueKeyOf(a) || '9999', y = dueKeyOf(b) || '9999'; // the date, then its time (Zoom call, delivery)
  return x < y ? -1 : x > y ? 1 : String(a.patient).localeCompare(String(b.patient));
}
/* the list filters; del/delDay filter by the delivery date alone, not the lab date (Amir, 2 Oct 2026) */
function noFilters() { return { type: '', stage: '', who: '', due: '', del: '', delDay: '', grp: '', ship: '' }; }
const DEL_OPTS = [['all', 'All, sorted by delivery appt'], ['past', 'Delivery appt passed'], ['today', 'Delivery appt today'], ['tomorrow', 'Delivery appt tomorrow'],
  ['week', 'Delivery appt in the next 7 days'], ['14', 'Delivery appt in the next 14 days'], ['day', 'Delivery appt on a day…'], ['none', 'No delivery appt']];
function delMatch(c, f) {
  if (f.del === 'all') return true;
  if (f.del === 'day') return !f.delDay || c.deliveryDate === f.delDay;
  const d = dayDiff(c.deliveryDate);
  if (f.del === 'none') return d === null;
  if (d === null) return false;
  return f.del === 'past' ? d < 0 : f.del === 'today' ? d === 0 : f.del === 'tomorrow' ? d === 1 : f.del === 'week' ? d >= 0 && d <= 6 : f.del === '14' ? d >= 0 && d <= 14 : true;
}
/* the date (and time) the lists show and sort by: the next date, or the delivery date while they're filtered by delivery */
function listKey(c) { return (S.f.del ? dateKey(c.deliveryDate, c.deliveryTime) : dueKeyOf(c)) || ''; }
function byListDate(a, b) {
  const x = listKey(a) || '9999', y = listKey(b) || '9999';
  return x < y ? -1 : x > y ? 1 : String(a.patient).localeCompare(String(b.patient));
}
function counts() {
  const all = openCases(); const me = meSid();
  return {
    all: all.length,
    over: all.filter(c => dueBucket(c) === 'over').length,
    week: all.filter(c => ['today', 'week'].includes(dueBucket(c))).length,
    dr: all.filter(c => DR_STAGES.includes(c.stage)).length,
    fab: all.filter(c => FAB_STAGES.includes(c.stage)).length,
    arrived: all.filter(c => c.stage === 'arrived').length,
    mine: all.filter(c => c.assignee === me).length
  };
}

/* ---------- rendering ---------- */
/* live updates redraw data screens only; Team & security redraws for team/settings changes;
   screens holding typed input (import, account) keep their state */
/* a press in progress (mouse button or finger down) holds live redraws until its click has gone through: a redraw between press
   and release replaced the button under the pointer, and the click did nothing (found 3 Oct 2026 — now and then a board tab,
   a board arrow or a case's step ignored a click because someone's change arrived that instant). A press longer than 2 s
   (a drag, a scrollbar) doesn't hold anything. */
const PRESS = { down: false, at: 0, waiting: [], timer: 0 };
function afterPress(fn) {
  if (!PRESS.down || Date.now() - PRESS.at > 2000) return false;
  if (!PRESS.waiting.length) PRESS.timer = setTimeout(flushPress, 2100);
  PRESS.waiting.push(fn); return true;
}
function flushPress() { clearTimeout(PRESS.timer); PRESS.waiting.splice(0).forEach(f => f()); }
function pressEnd() { if (!PRESS.down) return; PRESS.down = false; if (PRESS.waiting.length) { clearTimeout(PRESS.timer); PRESS.timer = setTimeout(flushPress, 100); } }
document.addEventListener('pointerdown', () => { PRESS.down = true; PRESS.at = Date.now(); }, true);
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, pressEnd, true));
window.addEventListener('blur', pressEnd);
function queueRender(kind) {
  S.renderKinds = (S.renderKinds || new Set()); S.renderKinds.add(kind || 'cases');
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => {
    S.renderQ = false; if (!S.inApp) return;
    if (afterPress(() => queueRender())) return; // a click is half done: redraw once it's through (see PRESS)
    // someone is typing in a box on this screen (e.g. the aligner cost in Team & security): wait until they leave it, so a
    // live update arriving that moment doesn't redraw the box and lose what they typed
    const ae = document.activeElement;
    if (ae && ae.matches && ae.matches('#view input:not([type]), #view input[type=text], #view input[type=number], #view input[type=email], #view input[type=password], #view input[type=tel], #view input[type=url], #view textarea') && ae.value !== ae.defaultValue) {
      renderNav();
      if (S.renderWaitEl !== ae) { S.renderWaitEl = ae; ae.addEventListener('blur', () => { if (S.renderWaitEl === ae) S.renderWaitEl = null; queueRender(); }, { once: true }); }
      return;
    }
    const kinds = S.renderKinds; S.renderKinds = new Set();
    renderNav();
    if (S.view === 'import' || S.view === 'account') return;
    if (S.view === 'admin' && !kinds.has('team')) return;
    renderView();
  });
}
const NAV = [
  ['today', 'Today', 'today'], ['board', 'Board', 'board'], ['list', 'All open cases', 'list'], ['mine', 'My cases', 'user'], ['done', 'Completed', 'done']
];
function renderShell() {
  const owner = isOwner();
  const navBtns = mob => NAV.map(([k, l, i]) => '<button class="navBtn" data-act="nav" data-v="' + k + '" id="' + (mob ? 'm' : '') + 'nav-' + k + '">' + ic(i) + '<span>' + l + '</span><span class="cnt hidden"></span></button>').join('') +
    (mob ? '' : '<div class="navLbl">Office</div>') +
    (owner ? '<button class="navBtn" data-act="nav" data-v="admin" id="' + (mob ? 'm' : '') + 'nav-admin">' + ic('team') + '<span>Team &amp; security</span></button>' +
      '<button class="navBtn" data-act="nav" data-v="import" id="' + (mob ? 'm' : '') + 'nav-import">' + ic('import') + '<span>Import &amp; export</span></button>' : '') +
    '<button class="navBtn" data-act="nav" data-v="account" id="' + (mob ? 'm' : '') + 'nav-account">' + ic('key') + '<span>My account</span></button>';
  $('#side').innerHTML = '<div class="sideTop"><img src="logo-white.png" alt="Next Level Orthodontics"><div class="appTag">Cases</div></div>' +
    '<nav class="nav" aria-label="Main">' + navBtns(false) + '</nav>' +
    '<div class="sideFoot"><div class="whoBox"><span class="av" data-sav="' + esc(B.me.staffId || '') + '">' + esc(initials(B.me.name)) + '</span><div><b>' + esc(B.me.name) + '</b>' + (owner ? 'Owner' : 'Staff') + '</div></div>' +
    '<button class="sideLock" data-act="lock">' + ic('lock', 16) + 'Lock</button><div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img src="logo-white.png" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">Cases</span><span style="flex:1"></span>' +
    '<button class="iconBtn" style="color:#fff" data-act="newCase" aria-label="New case">' + ic('plus') + '</button><button class="iconBtn" style="color:#fff" data-act="lock" aria-label="Lock">' + ic('lock') + '</button>';
  $('#mobNav').innerHTML = navBtns(true);
  renderSync(); renderNav(); savPaint($('#side'));
}
function renderNav() {
  const c = counts();
  const set = (k, n, red) => ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + k + ' .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('red', !!red); });
  set('today', c.over, true); set('list', c.all); set('mine', c.mine);
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? (S.tour ? 'Practice' : 'Demo') + ' · nothing saved' : 'Live · encrypted';
  if (!navigator.onLine) { cls = 'bad'; t = 'Offline'; }
  else if (B && B.pending) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
const TITLES = { today: 'Today', board: 'Board', list: 'All open cases', mine: 'My cases', done: 'Completed', admin: 'Team & security', import: 'Import & export', account: 'My account' };
function topBar(extra) {
  return '<div class="topBar"><h2>' + esc(TITLES[S.view]) + '</h2>' +
    (['today', 'board', 'list', 'mine', 'done'].includes(S.view) ? '<label class="searchBox">' + ic('search', 17) + '<span class="hidden">Search</span><input id="q" type="search" placeholder="Search patient, type, stage…" value="' + esc(S.q) + '" aria-label="Search cases"></label>' : '<span style="flex:1"></span>') +
    (extra || '') + (['today', 'board', 'list', 'mine', 'done'].includes(S.view) && phAny() ? phHideBtn() : '') + '<button class="btn btn-teal" data-act="newCase">' + ic('plus', 16) + 'New case</button></div>';
}
function renderView() {
  // the search box keeps its cursor and selection through a redraw (it used to jump to the end, so a live update landing just
  // after someone selected their search to replace it made the next key add to it instead; found 3 Oct 2026)
  const v = $('#view'), qa = document.activeElement && document.activeElement.id === 'q' ? document.activeElement : null;
  const qSel = qa ? [qa.selectionStart, qa.selectionEnd, qa.selectionDirection] : null;
  // Team & security: a box just tapped into (after leaving another, whose save redraws the page) keeps the cursor
  const fa = S.view === 'admin' && document.activeElement, fid = fa && fa.id && v.contains(fa) ? fa.id : '';
  const fSel = fid && typeof fa.selectionStart === 'number' ? [fa.selectionStart, fa.selectionEnd] : null;
  let h = '';
  if (S.view === 'today') h = viewToday();
  else if (S.view === 'board') h = viewBoard();
  else if (S.view === 'list') h = viewList(listBase(), true);
  else if (S.view === 'mine') h = viewList(listBase(), false);
  else if (S.view === 'done') h = viewDone();
  else if (S.view === 'admin') h = isOwner() ? viewAdmin() : '';
  else if (S.view === 'import') h = isOwner() ? viewImport() : '';
  else if (S.view === 'account') h = viewAccount();
  $('#topSlot').innerHTML = topBar();
  v.innerHTML = h;
  if (qSel) { const q = $('#q'); if (q) { q.focus(); const n = q.value.length; try { q.setSelectionRange(Math.min(qSel[0], n), Math.min(qSel[1], n), qSel[2] || 'none'); } catch (e) { } } }
  if (fid) { const n = document.getElementById(fid); if (n && v.contains(n) && n !== document.activeElement) { n.focus({ preventScroll: true });
    if (fSel && typeof n.selectionStart === 'number') try { n.setSelectionRange(fSel[0], fSel[1]); } catch (e) { } } }
  phPaint(); savPaint(); logoPaint(v); picPaint(v); if (S.view === 'admin') shPaint();
  asgReanchor();
}
/* staff photos (brought in from Staff Hub, kept on the person's roster entry) on every staff avatar */
function savPaint(root) {
  $$('[data-sav]:not(.ph)', root || document).forEach(el => {
    const r = staff(el.dataset.sav); if (!r || !/^data:image\/jpeg;base64,/.test(r.photo || '')) return;
    el.textContent = ''; const im = document.createElement('img'); im.alt = ''; im.src = r.photo; el.appendChild(im); el.classList.add('ph');
  });
}

/* ---------- small pieces ---------- */
function typeBadge(c) { const t = typeOf(c); return '<span class="badge ' + t.cls + '">' + esc(t.l) + '</span>'; }
/* the board and the case lists show the company's logo instead of the name (Amir, 2 Oct 2026): Oliv, Angel, Invisalign,
   uLab, InSmile from logos.js; in-house sets the Next Level Orthodontics logo; appliances and MARPE their lab's logo (3 Oct);
   types with no company (retainers, mouthguards, models) keep the name. The picture is set after render (logoPaint),
   so no image data sits in this markup. */
function typeMark(c, small) {
  const t = typeOf(c), lg = typeof LOGOS !== 'undefined' && LOGOS[c.type], cls = 'tlogo' + (small ? ' sm' : '');
  if (lg) return '<span class="' + cls + ' lg-' + esc(c.type) + '" title="' + esc(t.l) + '"><img data-logo="' + esc(c.type) + '" width="' + lg.w + '" height="' + lg.h + '" alt="' + esc(t.l) + '" draggable="false"></span>';
  // in-house sets: the office's own Next Level Orthodontics logo (Amir's file, 2 Oct 2026), wide like the companies' logos
  if (c.type === 'nla') { const l = c.variant === 'finishing' ? 'Finishing aligners (in-house)' : t.l, nl = typeof LOGOS !== 'undefined' && LOGOS.nlo;
    return nl ? '<span class="' + cls + ' lg-nlo" title="' + esc(l) + '"><img data-logo="nlo" width="' + nl.w + '" height="' + nl.h + '" alt="' + esc(l) + '" draggable="false"></span>'
      : '<span class="' + cls + ' nl" title="' + esc(l) + '" role="img" aria-label="' + esc(l) + '">' + typeSvg('nl') + '</span>'; }
  // appliances and MARPE: the lab's logo (Specialty, Partners, or ours for in-house; Amir, 3 Oct 2026); no lab yet = the name
  const lk = (c.type === 'appliance' || c.type === 'marpe') && LAB_LOGO[labName(c.lab)], ll = lk && typeof LOGOS !== 'undefined' && LOGOS[lk];
  if (ll) { const l = t.l + ' · ' + labName(c.lab);
    return '<span class="' + cls + ' lg-' + esc(lk) + '" title="' + esc(l) + '"><img data-logo="' + esc(lk) + '" width="' + ll.w + '" height="' + ll.h + '" alt="' + esc(l) + '" draggable="false"></span>'; }
  // retainers and mouthguards: the New case tile's own picture instead of the name (Amir, 4 Oct 2026: "just add the photos on the
  // tile for retainers and also for mouthguard anywhere that it reads mouthguard or retainer on the open cases or board")
  const pc = TYPE_PIC.includes(c.type) && typeof PICS !== 'undefined' && PICS[c.type];
  if (pc) return '<span class="' + cls + ' tpic" title="' + esc(t.l) + '"><img data-pic="' + esc(c.type) + '" width="' + pc.w + '" height="' + pc.h + '" alt="' + esc(t.l) + '" draggable="false"></span>';
  return typeBadge(c);
}
const TYPE_PIC = ['retainer', 'mouthguard'];
/* the scanner in the case's Details: its picture and name, a link to where its scans are (SCAN_SITE) */
function scanLinkHTML(v) {
  const s = SCAN_SITE[v]; if (!s) return scanIc(v) + esc(v);
  return '<a class="scanLink" data-act="portal" href="' + esc(s.u) + '" target="_blank" rel="noopener noreferrer" title="Open ' + esc(s.l) + ' to look at the scans (copies the patient’s name)">' + scanIc(v) + '<span>' + esc(v) + '</span>' + ic('ext', 13) + '</a>';
}
function picPaint(root) { if (typeof PICS === 'undefined') return; $$('img[data-pic]:not([src])', root || document).forEach(i => { const pc = PICS[i.dataset.pic]; if (pc) i.src = pc.src; }); }
function logoPaint(root) { if (typeof LOGOS === 'undefined') return; $$('img[data-logo]:not([src])', root || document).forEach(i => { const lg = LOGOS[i.dataset.logo]; if (lg) i.src = lg.src; }); }
/* the case's next date: lab completion until the lab work is done, then delivery (see dueOf) */
function dueChip(c) { return dateChip(c, dueOf(c), 'No date'); }
/* the delivery date alone: the lists show this while they're filtered by delivery date */
function delChip(c) { return dateChip(c, c.deliveryDate ? { d: c.deliveryDate, k: 'delivery' } : null, 'No delivery appt'); }
/* the lists' two date columns side by side (Amir, 4 Oct 2026: a late lab date hid the appointment). Lab date: the lab
   completion date (MARPE: the Zoom call) while it's still ahead, a quiet ✓ once the case is past the lab step.
   Delivery appt: always the appointment (or the expected delivery, shipped to the patient). */
function labChip(c, cell) {
  const x = labDueOf(c); if (x) return cell ? dateCell(c, x, '') : dateChip(c, x, '');
  if (labStepDone(c)) return '<span class="due done" title="' + esc('Past the lab step' + (c.labDate ? ' — lab date was ' + fmtDay(c.labDate) : '')) + '">' + ic('done', 13) + 'Done</span>';
  return '<span class="due none">No lab date</span>';
}
function apptChip(c, cell) { const x = apptOf(c), none = 'No ' + delWord(c).toLowerCase(); return cell ? dateCell(c, x, none) : dateChip(c, x, none); }
/* in the date columns the time sits on its own small line under the chip, so both columns fit a laptop-width screen */
function dateCell(c, x, none) {
  const tm = x ? fmtTime(timeOf(c, x.k)) : '';
  return dateChip(c, x, none, true) + (tm && dayDiff(x.d) >= 0 ? '<div class="dueTm">' + esc(tm) + '</div>' : '');
}
function dateChip(c, x, none, split) {
  if (!x) return '<span class="due none">' + none + '</span>';
  const d = dayDiff(x.d), z = x.k === 'zoom', w = x.k === 'lab' ? 'Lab' : x.k === 'delivery' ? (delWord(c) === 'Delivery appt' ? 'Appt' : 'Expected delivery') : z ? 'Zoom' : 'Due';
  // split: the time stays out of the chip (the tooltip keeps it) — dateCell puts it on its own line
  const tm = fmtTime(timeOf(c, x.k)), at = tm && !split ? ' ' + tm : '', on = tm && !split ? ' · ' + tm : '', i = ic(z ? 'video' : 'clock', 13); // Zoom call and delivery times
  const tip = ' title="' + esc((x.k === 'lab' ? 'Lab completion' : x.k === 'delivery' ? delWord(c) : z ? 'Zoom call' : w) + ': ' + fmtDay(x.d) + (tm ? ', ' + tm : '')) + '"';
  // a Zoom call that has passed while the design isn't approved yet: someone should move the case on
  if (d < 0) return '<span class="due over"' + tip + '>' + i + w + ' ' + (z ? 'was ' + (d === -1 ? 'yesterday' : (-d) + ' days ago') : d === -1 ? '1 day late' : (-d) + ' days late') + '</span>';
  if (d === 0) return '<span class="due soon"' + tip + '>' + i + w + ' today' + esc(at) + '</span>';
  if (d === 1) return '<span class="due soon"' + tip + '>' + i + w + ' tomorrow' + esc(at) + '</span>';
  if (d <= 3) return '<span class="due soon"' + tip + '>' + i + w + ' ' + esc(fmtDay(x.d) + on) + '</span>';
  return '<span class="due"' + tip + '>' + (z ? i : '') + w + ' ' + esc(fmtDate(x.d) + on) + '</span>';
}
/* ---------- flags: ship to patient (an alert wherever the case shows), one-click tracking, MARPE records ---------- */
function shipFlag(c, short) { return c.shipToPatient ? '<span class="flag ship" title="Ship to patient">' + ic('truck', 13) + (short ? 'Ship' : 'Ship to patient') + '</span>' : ''; }
function trackLinks(c) {
  return trackList(c).filter(t => t.url).map(t => '<a class="flag trk" data-act="track" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer" title="Track ' + esc((t.carrier ? t.carrier + ' ' : '') + t.n) + '">' +
    ic('ext', 12) + 'Track' + (t.carrier ? ' ' + esc(t.carrier) : '') + '</a>').join('');
}
/* while a MARPE case is gathering its records: what's still missing, or that both are on file */
function recFlag(c) {
  if (typeOf(c).flow !== 'marpe' || stageIndex(c) > 0) return '';
  const miss = recordsMissing(c);
  return miss.length ? '<span class="flag rec" title="Needed before it goes to the lab">Needs ' + esc(miss.map(x => x[2]).join(' + ')) + '</span>'
    : '<span class="flag ready" title="STL scan and CBCT on file">' + ic('done', 13) + 'Records on file</span>';
}
/* the lab put the case on hold (the lab's daily email: Partners, Specialty); cleared by a later shipment or by hand */
function isHeld(c) { return !!(c.labHold && typeof c.labHold === 'object'); }
function holdText(c) { return 'On hold at the lab' + (c.labHold.date ? ' since ' + c.labHold.date : '') + (c.labHold.reason ? ': ' + c.labHold.reason : ''); }
function holdFlag(c) { return isHeld(c) ? '<span class="flag rec" title="' + esc(holdText(c)) + '">Lab hold</span>' : ''; }

/* ---------- chart note: the case entry written as a note to paste into the patient's chart ----------
   No assistant names (Dr. A doesn't record who saw the patient in chart notes). Plain ASCII punctuation so it
   pastes cleanly into Edge. Two visits (Amir, 5 Oct 2026: "it's missing some information for refinement aligners, it
   should say instructed pt to stay in the last set night time only. no elastics with aligners etc. that instruction will
   be different if it's initial delivery, refinement, appliance delivery so on so forth"): the scan visit's note, as
   before, and the delivery visit's — each with what the patient was told for that kind of case (NOTE_KINDS). */
function noteWhat(c) {
  const t = typeOf(c), sub = { yes: 'initial set', no: 'refinement', mid: 'mid-course correction' }[c.initial] || '';
  let what;
  if (c.type === 'nla') what = (c.variant === 'finishing' ? 'finishing aligners' : 'in-house aligners') + ' (NL Lab)' + (sub ? ' - ' + sub : '');
  else if (t.aligner) what = ({ oliv: 'Oliv', angel: 'Angel', invisalign: 'Invisalign', ulab: 'uLab' }[c.type] || t.l) + ' aligners' + (sub ? ' - ' + sub : '');
  else if (c.type === 'insmile') what = 'InSmile braces' + (/^de[123]$/.test(c.initial || '') ? ' - digital enhancement ' + c.initial.slice(2) : c.initial === 'yes' ? ' - initial' : '');
  else if (c.type === 'marpe') what = 'MARPE' + (c.lab ? ' (' + labName(c.lab) + ')' : '');
  else if (c.type === 'appliance') what = ((c.appliances || []).map(a => applText(c, a, true)).join(', ') || c.detail || 'appliance') + (c.lab ? ' (' + labName(c.lab) + ')' : '');
  else if (c.type === 'retainer') what = 'retainers' + (c.detail ? ': ' + c.detail : '');
  else if (c.type === 'mouthguard') what = 'a mouthguard' + ((c.arches || []).length ? ' (' + c.arches.join('/') + ')' : '');
  else if (c.type === 'models') what = 'study models';
  else what = c.detail || t.l;
  // aligners and InSmile treating one arch (Amir, 2 Oct 2026)
  if (oneArch(c) && (t.aligner || c.type === 'insmile' || (c.type === 'inbrace' && !/ only\b/i.test(what)))) what += ', ' + (oneArch(c) === 'U' ? 'upper' : 'lower') + ' arch only';
  return what;
}
function chartNote(c, visit) {
  const t = typeOf(c), L = [], what = noteWhat(c);
  const told = v => noteKindsOf(c).map(k => noteInstr(k, v)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i); // what the patient was told
  if (visit === 'del' && hasDelNote(c)) {
    if (shipEnd(c)) { const tr = trackList(c).map(x => (x.carrier ? x.carrier + ' ' : '') + x.n).join(', ');
      L.push('Shipped ' + what + ' to the patient' + (tr ? ' (' + tr + ')' : '') + '.'); }
    else {
      // in-house sets: how many aligners went out
      const u = Number(c.alU) || 0, l = Number(c.alL) || 0, n = c.type === 'nla' ? (u || l ? [u ? u + ' upper' : '', l ? l + ' lower' : ''].filter(Boolean).join(' and ') + ' aligners' : alN(c) ? alN(c) + ' aligners' : '') : '';
      L.push('Delivered ' + what + (n ? ': ' + n : '') + '.');
    }
    L.push.apply(L, told('del'));
    return noteAscii(L);
  }
  L.push((c.scanner ? 'Scanned with ' + c.scanner : 'Scanned') + ' for ' + what + '.');
  if (t.flow === 'marpe') { const r = MARPE_RECORDS.filter(x => (c.records || []).includes(x[0])).map(x => x[1]); if (r.length) L.push('Records on file: ' + r.join(', ') + '.'); }
  const end = s => String(s).trim().replace(/[.\s;]+$/, '') + '.';
  if (c.instructions) L.push("Dr. A's instructions: " + end(c.instructions));
  const rx = (c.extras || []).filter(x => x !== 'Mid-course correction');
  if (rx.length) L.push(rx.map(end).join(' '));
  if (c.teethNote) L.push(c.teethNote.split('\n').map(end).join(' '));
  if (c.ipr && c.ipr.trim()) L.push('IPR & spacing: ' + c.ipr.trim());
  const ccv = ccShown(c); if (ccv && ccv !== 'None') L.push("Pt's CC: " + (/[.!?]["”’']?$/.test(ccv) ? ccv : end(ccv))); // the patient's words, their own ending kept
  L.push.apply(L, told('scan'));
  if (c.shipToPatient) L.push('Aligners to be shipped to the patient.');
  return noteAscii(L);
}
function noteAscii(L) { return L.join('\n').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-'); }
/* study models aren't delivered to a patient: their note is the scan's only */
function hasDelNote(c) { return !!c && c.type !== 'models'; }
/* which visit's note the case panel shows (and Copy copies) unless it's switched: the delivery's once the case is complete, at
   its last step, or its delivery appointment has come; the scan's before that */
function noteVisitDef(c) {
  if (!hasDelNote(c)) return 'scan';
  if (c.status === 'done' || (c.deliveryDate && dayDiff(c.deliveryDate) <= 0)) return 'del';
  const st = caseStages(c); return st.length && c.stage === st[st.length - 1][0] ? 'del' : 'scan';
}
function noteVisitOf(c) { const v = c && S.noteVisit && S.noteVisit.get(c.id); return v && (v === 'scan' || hasDelNote(c)) ? v : noteVisitDef(c); }
function noteVisitName(c, v) { return v === 'del' ? (shipEnd(c) ? 'Shipped to patient' : 'Delivery visit') : 'Scan visit'; }
/* the Chart note section: its folded heading names the visit Copy copies; inside, the two visits to switch between, the note,
   and for Dr. A where its wording comes from */
function noteSumHTML(c) { return '<b>' + esc(noteVisitName(c, noteVisitOf(c))) + '</b> <span class="muted">· to paste into the patient’s chart</span>'; }
function noteBodyHTML(c) {
  const v = noteVisitOf(c), ks = noteKindsOf(c);
  return (hasDelNote(c) ? '<div class="noteTabs" role="group" aria-label="Which visit">' + ['scan', 'del'].map(x => '<button type="button" data-act="noteVisit" data-v="' + x + '" aria-pressed="' + (x === v) + '">' + esc(noteVisitName(c, x)) + '</button>').join('') + '</div>' : '') +
    '<div class="txt" id="noteTxt">' + esc(chartNote(c, v)) + '</div>' +
    (isOwner() && ks.length ? '<div class="noteFrom small muted">What the patient was told comes from <button type="button" class="linkBtn" data-act="niGo" data-nk="' + esc(ks[0]) + '">Team &amp; security → Chart note: ' + esc(noteKindLabel(NOTE_KIND[ks[0]])) + '</button></div>' : '');
}
/* after switching visits, or when the office's wording changes: the open case's note, in place */
function noteRefresh() {
  const c = S.openId && findCase(S.openId), sec = $('#drawer .ds[data-ds=note]'); if (!c || !sec) return;
  const s = $('#dsS-note', sec), bd = $('.dsBd', sec); if (s) s.innerHTML = noteSumHTML(c);
  if (bd) { const f = document.activeElement && bd.contains(document.activeElement) ? document.activeElement.dataset.v : null; bd.innerHTML = noteBodyHTML(c);
    if (f) { const b = $('[data-act=noteVisit][data-v="' + f + '"]', bd); if (b) b.focus(); } }
}

/* ---------- what the patient was told, by kind of case and visit ----------
   Suggested wording; Dr. A rewords any of it in Team & security → Chart note (noteInstr in the office settings; blank there =
   nothing added). The refinement's scan line is Amir's own; the rest is a starting point for him to word his way. */
const NI_FIXED = 'Reviewed appliance care with pt: brush around it carefully, avoid hard and sticky foods. Pt to call the office if anything comes loose or breaks.';
const NI_EXPAND = 'Showed pt/parent how to turn the expander with the key. Reviewed care: brush around it carefully, avoid hard and sticky foods. Pt to call the office if anything comes loose or breaks.';
const NI_REMOVABLE = 'Reviewed wear and care with pt: out only to eat and brush, clean it daily, keep it in its case when out.';
const NI_FUNC = n => 'Reviewed ' + n + ' care with pt: soft foods for the first few days, avoid hard and sticky foods, wax for any cheek irritation, brush around it carefully. Pt to call the office if anything comes loose or breaks.';
const NI_REFINED = 'Pt back to full-time wear with the new aligners. Reviewed aligner wear and care.';
const NI_RETAINER = 'Reviewed retainer care with pt: clean daily, keep in the case when out, away from heat and pets.';
const NOTE_GROUPS = [
  { g: 'al', l: 'Aligners', s: 'Oliv, Angel, Invisalign, uLab and in-house' }, { g: 'br', l: 'Braces' }, { g: 'ap', l: 'Appliances' },
  { g: 'mp', l: 'MARPE' }, { g: 'rt', l: 'Retainers & mouthguards' }
];
const NOTE_KINDS = [
  { k: 'al1', g: 'al', l: 'First set', scan: '', del: 'Reviewed aligner wear and care with pt: wear full time, out only to eat, drink anything but water, and brush. Brush before putting them back in. Use chewies to seat them. Keep them in the case when out.' },
  { k: 'alR', g: 'al', l: 'Refinement', scan: 'Instructed pt to stay in the last set, night time only. No elastics with aligners.', del: NI_REFINED },
  { k: 'alM', g: 'al', l: 'Mid-course correction', scan: 'Instructed pt to stay in the current aligner until the new set is delivered.', del: NI_REFINED },
  { k: 'alF', g: 'al', l: 'Finishing aligners (in-house)', scan: '', del: 'Reviewed wear and care of the finishing aligners with pt.' },
  { k: 'ins', g: 'br', l: 'InSmile (initial and DEs)', scan: '', del: 'Reviewed braces care with pt: brush and floss around the brackets, avoid hard and sticky foods, wax for any irritation. Pt to call the office if a bracket comes loose.' },
  { k: 'herbst', g: 'ap', a: 'Herbst', scan: '', del: NI_FUNC('Herbst') },
  { k: 'scherbst', g: 'ap', a: 'Space Closing Herbst', scan: '', del: NI_FUNC('Herbst') },
  { k: 'mara', g: 'ap', a: 'MARA', scan: '', del: NI_FUNC('MARA') },
  { k: 'mse', g: 'ap', a: 'MSE', scan: '', del: NI_EXPAND },
  { k: 'rpe', g: 'ap', a: 'Rapid Palatal Expander (RPE)', scan: '', del: NI_EXPAND },
  { k: 'd2', g: 'ap', a: 'D2 distalizer', scan: '', del: NI_FIXED },
  { k: 'finger', g: 'ap', a: 'Finger spring with no labial bow', scan: '', del: NI_REMOVABLE },
  { k: 'hawley', g: 'ap', a: 'Hawley retainers', scan: '', del: NI_RETAINER },
  { k: 'schwartz', g: 'ap', a: 'Schwartz', scan: '', del: 'Showed pt/parent how to turn the expansion screw with the key. ' + NI_REMOVABLE },
  { k: 'metal', g: 'ap', a: 'Other metal appliance', scan: '', del: NI_FIXED },
  { k: 'appl', g: 'ap', l: 'Any other appliance', s: 'older cases with an appliance not listed here', scan: '', del: NI_FIXED },
  { k: 'marpe', g: 'mp', l: 'MARPE', scan: '', del: 'Showed pt how to turn the MARPE with the key. Reviewed care: brush around it carefully, avoid hard and sticky foods. Pt to call the office if anything comes loose or breaks.' },
  { k: 'tt', g: 'rt', l: 'Retainers (TT’s)', scan: '', del: NI_RETAINER },
  { k: 'wt', g: 'rt', l: 'Whitening trays (WT’s)', scan: '', del: 'Reviewed whitening tray use with pt: a small drop of gel per tooth, wipe off any extra. Pt to stop and call if teeth get sensitive.' },
  { k: 'mg', g: 'rt', l: 'Mouthguard', scan: '', del: 'Reviewed mouthguard use and care with pt: wear it for sports, rinse after use, keep it in its case.' }
];
const NOTE_KIND = Object.fromEntries(NOTE_KINDS.map(x => [x.k, x]));
const APPL_NOTE = Object.fromEntries(NOTE_KINDS.filter(x => x.a).map(x => [x.a, x.k]).concat([['MARPE', 'marpe']]));
function noteKindLabel(x) { return x.a || x.l; }
/* the office's own wording (Team & security): a map of "kind.visit" → text ('' = nothing added; null or missing = the
   suggested wording), saved a box at a time (the settings save merges, so two boxes saved together don't undo each other) */
function noteInstrSaved() { const m = S.settings && S.settings.noteInstr; return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
function noteInstrClean(t) { return String(t || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean).join('\n'); }
function noteInstrDef(k, v) { const x = NOTE_KIND[k]; return x ? x[v] || '' : ''; }
function noteInstrOwn(k, v) { const s = noteInstrSaved()[k + '.' + v]; return typeof s === 'string'; }
function noteInstr(k, v) { const s = noteInstrSaved()[k + '.' + v]; return noteInstrClean(typeof s === 'string' ? s : noteInstrDef(k, v)); }
/* the kinds of case this one is, for its instructions (an appliance case: each appliance on it) */
function noteKindsOf(c) {
  if (!c) return [];
  if ((TYPE[c.type] || {}).aligner) {
    if (c.type === 'nla' && c.variant === 'finishing') return ['alF'];
    const ini = c.initial || ((c.extras || []).includes('Mid-course correction') ? 'mid' : '');
    return ini === 'yes' ? ['al1'] : ini === 'no' ? ['alR'] : ini === 'mid' ? ['alM'] : [];
  }
  if (c.type === 'insmile') return ['ins'];
  if (c.type === 'marpe') return ['marpe'];
  if (c.type === 'appliance') { const ks = (c.appliances || []).map(a => APPL_NOTE[a] || 'appl'); return ks.length ? ks.filter((x, i, a) => a.indexOf(x) === i) : ['appl']; }
  if (c.type === 'retainer') { const r = (c.retKinds || []).join(' '), ks = []; if (/\bTT/i.test(r) || !/\bWT/i.test(r)) ks.push('tt'); if (/\bWT/i.test(r)) ks.push('wt'); return ks; }
  if (c.type === 'mouthguard') return ['mg'];
  return [];
}
/* stage progress: a circle per stage (done, current, to come) joined by a line that fills in up to the current stage
   (Amir, 2 Oct 2026: circles connected with a line, not a row of rectangles); a stage group (In fabrication) sits in its own band */
function progHTML(c, only) {
  const f = flowOf(c), si = stageIndex(c), keys = only || caseStages(c).map(s => s[0]);
  let h = '', first = true;
  caseStages(c).forEach(([k, l], i) => {
    if (!keys.includes(k)) return;
    const g = !only && stageGroup(f, k);
    if (!first) h += '<b' + (i <= si ? ' class="d"' : '') + '></b>'; // the line into this stage: filled once the case has got here
    if (g && g.stages[0] === k) h += '<span class="pg" title="' + esc(g.l) + '">';
    h += '<i class="' + (i < si ? 'd' : i === si ? 'c' : '') + '" title="' + esc(l) + '"></i>';
    if (g && g.stages[g.stages.length - 1] === k) h += '</span>';
    first = false;
  });
  const n = keys.indexOf(c.stage) + 1;
  return '<span class="sprog' + (only ? ' sub' : '') + '" role="img" aria-label="' + esc((n ? 'Step ' + n + ' of ' + keys.length + ': ' : '') + stageLabel(c)) + '">' + h + '</span>';
}
/* every case we can see, for patient totals: open ones, then completed ones (loaded in the background) */
function casePool() { return Array.from(S.cases.values()).concat(S.closed || [], S.hist || []); }
/* patient history (Amir, 4 Oct 2026: "data gets large enough that something bad will happen"): the completed cases of the
   patients on screen, fetched by patient once the office is indexed (FB.idxFields) — so a sign-in doesn't download every
   completed case there has ever been. Until then (or in an office not indexed yet), every completed case once, as before. */
function histReset() { S.hist = null; S.histLoaded = false; S.histP = null; S.histKeys = new Set(); S.histAsk = new Map(); S.mailClosed = null; S.histGen = (S.histGen || 0) + 1; }
function histByPatient() { return !!(S.settings.pidx && B.idxOn && B.loadPatients); }
/* the keys a patient's cases are found by (samePatient: chart # when both have one, else name) — as FB.idxFields hashes them */
function histKeys(c) { const k = [], n = normName(c && c.patient), ch = normChart(c && c.chart); if (n) k.push('n:' + n); if (ch) k.push('c:' + ch); return k; }
function histReady(c) { return S.histLoaded || (histByPatient() && histKeys(c).every(k => S.histKeys.has(k))); }
/* list: the cases (or a New case form) whose patients' history is wanted; resolves true once all of it is in */
async function ensureHist(list) {
  // (right after sign-in the settings may not be in yet; they say whether the office is indexed)
  for (let i = 0; i < 40 && S.inApp && !S.settingsLoaded; i++) await new Promise(r => setTimeout(r, 100));
  if (!S.inApp) return false;
  if (!histByPatient()) return ensureHistAll();
  const keys = new Set(); (list || []).forEach(c => histKeys(c).forEach(k => keys.add(k)));
  const want = Array.from(keys).filter(k => !S.histKeys.has(k) && !S.histAsk.has(k)), gen = S.histGen;
  if (want.length) {
    const p = (async () => {
      let got; try { got = await B.loadPatients(want); } catch (e) { got = null; }
      if (gen !== S.histGen) return false; // locked or reset meanwhile: drop it
      want.forEach(k => S.histAsk.delete(k));
      if (!got) return false; // (asked again the next time it's wanted)
      const have = new Set((S.hist || []).map(c => c.id));
      S.hist = (S.hist || []).concat(liveCases(got.filter(c => c.status === 'done' && !have.has(c.id))));
      want.forEach(k => S.histKeys.add(k));
      histArrived(); return true;
    })();
    want.forEach(k => S.histAsk.set(k, p));
  }
  const pend = Array.from(new Set(Array.from(keys).map(k => S.histAsk.get(k)).filter(Boolean)));
  if (pend.length) await Promise.all(pend);
  return Array.from(keys).every(k => S.histKeys.has(k));
}
function ensureHistAll() {
  if (S.histLoaded) return Promise.resolve(true);
  if (!S.inApp) return Promise.resolve(false);
  if (!S.histP) {
    const gen = S.histGen;
    S.histP = (async () => {
      let h; try { h = await B.loadClosed(3650); } catch (e) { h = []; }
      if (gen !== S.histGen) return false; // locked or reset meanwhile: drop it
      S.histP = null; S.hist = liveCases(h); S.histLoaded = true;
      histArrived(); return true;
    })();
  }
  return S.histP;
}
function histArrived() {
  $$('.cf').forEach(cf => { if (cf._alTot) cf._alTot(); if (cf._syncTx) cf._syncTx(); });
  if (!S.editing && S.openId) renderDrawer();
  if (S.view === 'list' || S.view === 'mine') queueRender();
}
/* estimated cost of n aligners in one set: owner's settings (Team & security), per set + per aligner; null until set */
function alCost(n, sets) {
  const per = Number(S.settings.alPerAligner) || 0, fix = Number(S.settings.alPerSet) || 0;
  return per || fix ? (sets || 1) * fix + n * per : null;
}
const money = v => '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* "40 aligners in this set (U 20 · L 20) · est. $160 — Patient total: 64 aligners · est. $256 — Initial 40 · Refinement 1 24" */
function alignerTotalHTML(c, inForm) {
  const sets = alignerSets(c, casePool()); const me = sets.find(s => s.me) || { n: 0, l: 'This set' };
  const total = sets.reduce((s, x) => s + x.n, 0), missing = sets.filter(x => !x.n).length;
  const est = alCost(me.n), estAll = alCost(total, sets.length);
  const wait = !histReady(c) ? '<div class="small muted">Adding up earlier sets…</div>' : '';
  const parts = sets.map(s => '<span class="alSet' + (s.me ? ' me' : '') + '">' + esc(s.l) + ' <b>' + (s.n || '?') + '</b></span>').join('');
  // per arch: "(U 18 · L 16)", or just the one arch that's treated: "(U 18 · upper arch only)"
  const one = oneArch(c), arches = c.alU || c.alL ? ' (' + (one === 'U' ? 'U ' + (c.alU || 0) + ' · upper arch only' : one === 'L' ? 'L ' + (c.alL || 0) + ' · lower arch only' : 'U ' + (c.alU || 0) + ' · L ' + (c.alL || 0)) + ')' : '';
  const counts = one === 'U' ? 'the upper count' : one === 'L' ? 'the lower count' : 'the upper and lower counts';
  return '<div class="alThis">' + (me.n ? '<b>' + me.n + '</b> aligners in this set' + (inForm ? '' : arches + ' · ' + esc(me.l)) + (est != null ? ' <span class="alEst">est. ' + money(est) + '</span>' : '')
      : '<span class="muted">' + (inForm ? 'Enter ' + alAskText(c) + ' from Titan.' : 'Aligners in this set not entered yet — add ' + counts + ' from Titan with Edit.') + '</span>') + '</div>' +
    (inForm ? '' : '<div class="alAt">Attachment templates: ' + (c.atTemplates ? '<b>' + esc(atLabel(c.atTemplates)) + '</b>' : '<span class="muted">not answered yet — asked when the TxP is approved</span>') + '</div>') +
    '<div class="alSum"><span class="alT">Patient total: <b>' + total + '</b> aligners' + (estAll != null && total ? ' <span class="alEst">est. ' + money(estAll) + '</span>' : '') + '</span>' + (sets.length > 1 || inForm ? parts : '') + '</div>' +
    (missing ? '<div class="small muted">' + missing + ' set' + (missing > 1 ? 's have' : ' has') + ' no count yet, so the total may be low.</div>' : '') +
    (est == null && isOwner() && me.n ? '<div class="small muted">Set the cost per aligner in Team &amp; security to see an estimated cost.</div>' : '') + wait +
    (inForm ? '' : '<div class="alLbl"><button class="btn btn-sec btn-sm" data-act="labels"' + (me.n ? '' : ' disabled') + '>' + ic('print', 15) + 'Print labels</button>' +
      (me.n ? '<span class="small muted">The Label Maker’s labels, already filled in</span>' : '<span class="small muted">Available once ' + alAskText(c) + ' are entered (Edit)</span>') + '</div>');
}
function alignerMini(c) {
  if (c.type !== 'nla') return '';
  const n = alN(c), sets = histReady(c) ? alignerSets(c, casePool()) : null, total = sets ? sets.reduce((s, x) => s + x.n, 0) : 0;
  return n || total ? '<span class="alMini">' + (n ? n + ' aligners' : '') + (sets && sets.length > 1 && total ? (n ? ' · ' : '') + total + ' total' : '') + '</span>' : '';
}
function avatar(c) {
  const r = staff(c.assignee);
  if (r) return '<span class="av" data-sav="' + esc(r.sid) + '" title="' + esc(r.name) + '">' + esc(r.initials || initials(r.name)) + '</span>';
  if (c.assigneeName) return '<span class="av none" title="' + esc(c.assigneeName) + '">' + esc(initials(c.assigneeName)) + '</span>';
  return '<span class="av none" title="Unassigned">–</span>';
}
/* ---------- who it's assigned to, changed right from the list or the board (Amir, 5 Oct 2026: "when you are looking the open
   cases or tile view, can you just click on the assigned person and then pick another person from a drop down instead of click
   on it opening the card, editing going to the section and changing it") ----------
   The person is a button; it opens a short list of the team (with their photos) over the page, and picking one saves it the
   way the case panel's Assigned to does. The list sits outside the page's content, so a live update redrawing the list or the
   board doesn't close it. */
function asgBtnHTML(c, card) {
  const r = staff(c.assignee), who = r ? r.name : c.assigneeName || '';
  const lab = (who ? 'Assigned to ' + who : 'Unassigned') + ' (change)';
  return '<button type="button" class="asgBtn' + (card ? ' onCard' : '') + '" data-act="asgPick" data-id="' + esc(c.id) + '" aria-haspopup="menu" aria-expanded="' + !!(S.asg && S.asg.id === c.id) + '" title="' + esc(lab) + '" aria-label="' + esc(lab) + '">' +
    avatar(c).replace(/ title="[^"]*"/, '') + (card ? '' : '<span class="small' + (who ? '' : ' muted') + '">' + esc(who || 'Unassigned') + '</span>') + '<span class="asgCh" aria-hidden="true">' + ic('next', 12) + '</span></button>';
}
function asgOpen(btn) {
  const c = findCase(btn.dataset.id); if (!c) return;
  if (S.asg && S.asg.id === c.id) { asgClose(true); return; } // (its button again: closes it)
  asgClose();
  const cur = c.assignee || '', people = [null].concat(withSavedStaff(activeRoster(), c.assignee));
  const m = document.createElement('div'); m.className = 'asgMenu'; m.id = 'asgMenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Assign ' + (c.patient || 'this case') + ' to');
  m.innerHTML = '<div class="asgHd" aria-hidden="true">Assign to</div>' + people.map(r => { const v = r ? r.sid : '', on = v === cur;
    return '<button type="button" role="menuitemradio" aria-checked="' + on + '" data-act="asgSet" data-v="' + esc(v) + '" tabindex="-1">' +
      (r ? '<span class="av" data-sav="' + esc(r.sid) + '">' + esc(r.initials || initials(r.name)) + '</span>' : '<span class="av none">–</span>') +
      '<span class="nm">' + esc(r ? r.name : 'Nobody (unassigned)') + '</span>' + (on ? ic('done', 15) : '') + '</button>'; }).join('');
  document.body.appendChild(m); savPaint(m);
  S.asg = { id: c.id, btn }; btn.setAttribute('aria-expanded', 'true');
  asgPlace();
  const f = $('[aria-checked="true"]', m) || $('button', m); if (f) f.focus({ preventScroll: true });
}
/* under its button (above it when there's no room below), kept on screen */
function asgPlace() {
  const m = $('#asgMenu'), b = S.asg && S.asg.btn; if (!m || !b || !b.isConnected) return;
  const r = b.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight, vw = document.documentElement.clientWidth, vh = innerHeight;
  let top = r.bottom + 6; if (top + mh > vh - 8 && r.top - mh - 6 >= 8) top = r.top - mh - 6;
  m.style.left = Math.round(Math.max(8, Math.min(r.left, vw - mw - 8))) + 'px';
  m.style.top = Math.round(Math.max(8, Math.min(top, vh - mh - 8))) + 'px';
}
function asgFollow() {
  const b = S.asg && S.asg.btn; if (!b || !b.isConnected) return;
  const r = b.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) asgClose(); else asgPlace();
}
/* after a redraw: the new copy of its button */
function asgReanchor() {
  if (!S.asg) return; const b = $('[data-act=asgPick][data-id="' + CSS.escape(S.asg.id) + '"]');
  if (b) { S.asg.btn = b; b.setAttribute('aria-expanded', 'true'); }
}
function asgClose(back) {
  const m = $('#asgMenu'); if (m) m.remove();
  const a = S.asg; S.asg = null; if (!a) return;
  if (a.btn && a.btn.isConnected) { a.btn.setAttribute('aria-expanded', 'false'); if (back) a.btn.focus({ preventScroll: true }); }
}
function asgSet(v) {
  const a = S.asg; asgClose(true); if (!a) return;
  const c = findCase(a.id); if (!c || (c.assignee || '') === v) return;
  const name = c.patient || 'Case', to = v ? staffName(v) : '';
  act(() => B.mutateCase(a.id, d => { d.assignee = v; if (v) d.assigneeName = ''; }, { a: 'assign', to: v }), to ? name + ' assigned to ' + to : name + ' unassigned');
}
/* the menu's keys: arrows move, Home/End jump, Escape (or Tab) closes it */
function asgKey(e) {
  const m = $('#asgMenu'); if (!m || !S.asg) return false;
  if (e.key === 'Escape') { e.preventDefault(); asgClose(true); return true; }
  if (e.key === 'Tab') { asgClose(); return false; }
  if (!m.contains(document.activeElement)) return false;
  const items = $$('button', m), i = items.indexOf(document.activeElement);
  const go = j => { e.preventDefault(); const t = items[(j + items.length) % items.length]; if (t) t.focus(); };
  if (e.key === 'ArrowDown') { go(i + 1); return true; }
  if (e.key === 'ArrowUp') { go(i - 1); return true; }
  if (e.key === 'Home') { go(0); return true; }
  if (e.key === 'End') { go(items.length - 1); return true; }
  return false;
}
function row(c, meta) {
  return '<button class="row" data-act="open" data-id="' + esc(c.id) + '">' + ptAv(c, 36) +
    '<span class="grow"><span class="pt">' + esc(c.patient || '(no name)') + '</span><span class="meta">' + esc(meta != null ? meta : (typeOf(c).l + ' · ' + stageLabel(c) + (c.detail ? ' · ' + c.detail : ''))) + '</span></span>' + shipFlag(c, true) + dueChip(c) + avatar(c) + '</button>';
}

/* ---------- Today ---------- */
function viewToday() {
  const c = counts(); const all = openCases().filter(matchesQ);
  if (S.firstLoad && !S.demo) return '<div class="empty">Loading cases…</div>';
  const tile = (n, l, cls, act) => '<button class="tile ' + cls + '" data-act="tile" data-f="' + act + '"><span class="n">' + n + '</span><span class="l">' + l + '</span></button>';
  let h = tourOfferHTML() + '<div class="tiles">' + tile(c.over, 'Late', 'red', 'over') + tile(c.week, 'Lab or delivery appt in the next 7 days', 'amber', 'week') + tile(c.dr, 'Needs Dr. A', 'blue', 'dr') +
    tile(c.fab, 'In fabrication', '', 'fab') + tile(c.arrived, 'Arrived — check in', 'mint', 'arrived') + tile(c.mine, 'Assigned to me', '', 'mine') + '</div>';
  const soon = all.filter(x => dueDateOf(x) && dayDiff(dueDateOf(x)) <= 14).sort(byDue);
  const groups = [];
  soon.forEach(x => {
    const d = dayDiff(dueDateOf(x));
    const key = d < 0 ? 'Late' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : fmtDay(dueDateOf(x));
    let g = groups.find(g => g.k === key); if (!g) { g = { k: key, red: d < 0, items: [] }; groups.push(g); } g.items.push(x);
  });
  const left = '<div class="card"><div class="cardHd"><h3>Coming up</h3><span class="sub">Lab, delivery appt and Zoom dates: late and the next 14 days</span></div><div class="cardBd">' +
    (groups.length ? groups.map(g => '<div class="dueGrp"><h4 class="' + (g.red ? 'red' : '') + '">' + esc(g.k) + ' · ' + g.items.length + '</h4>' + g.items.map(x => row(x)).join('') + '</div>').join('') :
      '<div class="empty">No lab dates or delivery appts in the next two weeks.</div>') + '</div></div>';
  const dr = all.filter(x => DR_STAGES.includes(x.stage)).sort(byDue);
  const noDate = all.filter(x => !dueDateOf(x)).length;
  const right = '<div class="card"><div class="cardHd"><h3>Needs Dr. A</h3><span class="sub">' + dr.length + ' waiting</span></div><div class="cardBd">' +
    (dr.length ? dr.map(x => row(x)).join('') : '<div class="empty">Nothing waiting on Dr. A.</div>') + '</div></div>' +
    (noDate ? '<div class="card" style="margin-top:14px"><div class="cardBd" style="padding:14px 20px"><button class="linkBtn" data-act="tile" data-f="none">' + noDate + ' open case' + (noDate > 1 ? 's have' : ' has') + ' no lab date or delivery appt</button></div></div>' : '');
  return h + backupDueHTML() + mailCardHTML() + cleanupCardHTML(all) + '<div class="twoCol"><div>' + left + '</div><div>' + right + '</div></div>';
}

/* ---------- Board ---------- */
function viewBoard() {
  const open = openCases(), all = open.filter(matchesQ);
  // retired types (Retreatment, older misc) get a tab only while one of their cases is still open
  const flowsUsed = Object.keys(FLOWS).filter(k => TYPES.some(t => t.flow === k && !t.legacy) || open.some(c => typeOf(c).flow === k));
  if (!flowsUsed.includes(S.boardFlow)) S.boardFlow = flowsUsed[0];
  let h = '<div class="boardTabs" role="tablist">' + flowsUsed.map(k => {
    const n = all.filter(c => typeOf(c).flow === k).length;
    return '<button class="chip' + (S.boardFlow === k ? ' on' : '') + '" role="tab" aria-selected="' + (S.boardFlow === k) + '" data-act="flow" data-k="' + k + '">' + esc(FLOWS[k].label) + '<span class="c">' + n + '</span></button>';
  }).join('') + '</div>';
  const flow = FLOWS[S.boardFlow];
  const inFlow = all.filter(c => typeOf(c).flow === S.boardFlow);
  // one column per stage, except a stage group (e.g. the seven "In fabrication" steps) shares one column
  const cols = [];
  flow.stages.forEach(([sk, sl]) => { const g = stageGroup(flow, sk); if (!g) cols.push({ l: sl, keys: [sk] }); else if (g.stages[0] === sk) cols.push({ l: g.l, keys: g.stages, grp: true }); });
  const lastKey = flow.stages[flow.stages.length - 1][0];
  h += '<div class="board">' + cols.map((col, i) => {
    const items = inFlow.filter(c => col.keys.includes(c.stage) || (i === 0 && !flow.stages.some(s => s[0] === c.stage)))
      .sort((a, b) => col.grp ? (stageIndex(b) - stageIndex(a)) || byDue(a, b) : byDue(a, b));
    return '<section class="col' + (col.grp ? ' grp' : '') + '" aria-label="' + esc(col.l) + '"><div class="colHd"><h4>' + esc(col.l) + '</h4><span class="c">' + items.length + '</span></div><div class="colBd">' +
      (items.map(c => kcard(c, c.stage === lastKey || c.stage === shipEnd(c), col.grp ? col.keys : null)).join('') || '<div class="empty" style="padding:14px 4px">—</div>') + '</div></section>';
  }).join('') + '</div>';
  return h;
}
function kcard(c, last, steps) {
  const mixed = S.boardFlow === 'outside' || S.boardFlow === 'inhouse' || S.boardFlow === 'retainer';
  // appliances and MARPE: the lab's logo on every card (the lab differs from card to card even on their own tabs)
  const labbed = (c.type === 'appliance' || c.type === 'marpe') && !!LAB_LOGO[labName(c.lab)];
  const flags = shipFlag(c) + recFlag(c) + holdFlag(c);
  // the arrow names where it goes ("Move to TxP approved")
  const nx = last ? null : nextStage(c), shipsNext = !!nx && !!shipEnd(c) && nx === shipEnd(c);
  const tip = last ? 'Mark complete' : shipsNext ? 'Shipped to the patient — completes the case' : nx ? 'Move to ' + stageLabel(Object.assign({}, c, { stage: nx })) : 'Move to next stage';
  return '<div class="kc" data-act="open" data-id="' + esc(c.id) + '" role="button" tabindex="0">' +
    '<div class="kHd">' + ptAv(c, 32) + '<div class="pt">' + esc(c.patient || '(no name)') + '</div></div>' + (c.detail || alN(c) ? '<div class="dt">' + esc(c.detail || '') + alignerMini(c) + '</div>' : '') +
    (flags ? '<div class="flags">' + flags + '</div>' : '') +
    (steps ? '<div class="kstep">' + progHTML(c, steps) + '<div><b>' + esc(stageLabel(c)) + '</b><span>' + (steps.indexOf(c.stage) + 1) + ' of ' + steps.length + '</span></div></div>' : '') +
    '<div class="ft">' + (mixed || labbed ? typeMark(c, true) : '') + dueChip(c) + trackLinks(c) + asgBtnHTML(c, true) +
    '<button class="adv" data-act="' + (last ? 'complete' : 'advance') + '" data-id="' + esc(c.id) + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + ic(last ? 'done' : 'next', 17) + '</button></div></div>';
}

/* ---------- List ---------- */
function applyFilters(list) {
  const f = S.f;
  return list.filter(c => {
    if (!matchesQ(c)) return false;
    if (f.type && c.type !== f.type) return false;
    if (f.stage && c.stage !== f.stage) return false;
    if (f.who === '_none' && (c.assignee || c.assigneeName)) return false;
    if (f.who && f.who !== '_none' && c.assignee !== f.who) return false;
    if (f.due) { const b = dueBucket(c); if (f.due === 'week' ? !['today', 'week'].includes(b) : f.due === '14' ? !['today', 'week', '14'].includes(b) : b !== f.due) return false; }
    if (f.del && !delMatch(c, f)) return false;
    if (f.grp === 'dr' && !DR_STAGES.includes(c.stage)) return false;
    if (f.grp === 'fab' && !FAB_STAGES.includes(c.stage)) return false;
    if (f.grp === 'arrived' && c.stage !== 'arrived') return false;
    if (f.ship && !c.shipToPatient) return false;
    return true;
  });
}
function sortList(list) {
  const { k, dir } = S.sort;
  const val = c => k === 'patient' ? String(c.patient || '').toLowerCase() : k === 'type' ? typeOf(c).l : k === 'stage' ? stageIndex(c) : k === 'who' ? staffName(c.assignee, c.assigneeName) : k === 'updated' ? -(c.updatedAt || 0)
    : k === 'ship' ? (c.shipToPatient ? 0 : trackList(c).length ? 1 : 2) : k === 'lab' ? (labKeyOf(c) || '9999') : k === 'appt' ? (apptKeyOf(c) || '9999') : k === 'tx' ? txRatio(c) : k === 'cost' ? costKey(c) : k === 'notes' ? noteKey(c) : (listKey(c) || '9999');
  const memo = new Map(), v = c => { if (!memo.has(c)) memo.set(c, val(c)); return memo.get(c); };
  // a value of null (no treatment dates) sorts last whichever way the column is sorted
  return list.slice().sort((a, b) => { const x = v(a), y = v(b);
    if (x === null || y === null) return x === y ? byListDate(a, b) : x === null ? 1 : -1;
    return (x < y ? -1 : x > y ? 1 : byListDate(a, b)) * dir; });
}
/* the column the list is sorted by: filtered by delivery appt, the default order is the delivery appt's (listKey) */
function sortShown() { return S.sort.k === 'due' && S.f.del ? 'appt' : S.sort.k; }
/* ---------- Today: clean up old cases in bulk (e.g. leftovers from the Asana import; Amir, 2 Oct 2026) ---------- */
function ageOf(c) { return [c.deliveryDate, c.labDate, c.scanDate, c.dueDate].filter(Boolean).sort().pop() || ''; }
function addMonthsISO(iso, n) { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1 + n, d)); }
function oldCases(all) {
  const cut = addMonthsISO(todayISO(), -S.oldMonths);
  const old = all.filter(c => { const a = ageOf(c); return a && a < cut; }).sort((a, b) => ageOf(a) < ageOf(b) ? -1 : 1);
  const undated = all.filter(c => !ageOf(c) && c.importedAt); // imported with no dates at all: age unknown
  return { cut, old, undated, list: old.concat(S.oldNoDate ? undated : []) };
}
function cleanupCardHTML(all) {
  const o = oldCases(all); if (!o.old.length && !o.undated.length) return '';
  const n = o.list.filter(c => !S.oldOff.has(c.id)).length, busy = S.bulkBusy, off = busy ? ' disabled' : '';
  return '<div class="card cleanup" id="cleanCard"><div class="cardHd"><h3>Clean up old cases</h3><span class="sub">Open cases whose latest date (scan, lab or delivery appt) is before ' + esc(fmtDay(o.cut)) + '</span><span style="flex:1"></span>' +
    '<label class="small oldPick">Older than <select id="oldMonths"' + off + '>' + [1, 2, 3, 6, 12].map(m => '<option value="' + m + '"' + (S.oldMonths === m ? ' selected' : '') + '>' + m + (m === 1 ? ' month' : ' months') + '</option>').join('') + '</select></label></div><div class="cardBd">' +
    (o.undated.length ? '<label class="small oldNo"><input type="checkbox" id="oldNoDate"' + (S.oldNoDate ? ' checked' : '') + off + '> Also include ' + o.undated.length + ' imported case' + (o.undated.length > 1 ? 's' : '') + ' with no dates</label>' : '') +
    (o.list.length ? '<div class="oldList">' + o.list.map(c => '<label class="oldRow"><input type="checkbox" data-old="' + esc(c.id) + '"' + (S.oldOff.has(c.id) ? '' : ' checked') + off + '>' +
      '<span class="pt">' + esc(c.patient || '(no name)') + '</span><span class="small muted">' + esc(typeOf(c).l + ' · ' + stageLabel(c)) + '</span><span class="small oldD">' + esc(ageOf(c) ? fmtDate(ageOf(c)) : 'no date') + '</span></label>').join('') + '</div>'
      : '<div class="small muted" style="margin:6px 0 10px">No open cases older than that' + (o.undated.length ? ' with a date' : '') + '.</div>') +
    '<div class="oldAct"><b id="oldStatus">' + esc(busy || (n + ' of ' + o.list.length + ' ticked')) + '</b>' +
    (o.list.length ? '<button class="btn btn-ghost btn-sm" data-act="oldAll"' + off + '>Tick all</button><button class="btn btn-ghost btn-sm" data-act="oldNone"' + off + '>Untick all</button>' : '') + '<span style="flex:1"></span>' +
    '<button class="btn btn-mint btn-sm" data-act="oldDone"' + (n && !busy ? '' : ' disabled') + '>' + ic('done', 15) + '<span class="oldDoneL">Mark ' + n + ' complete</span></button>' +
    (isOwner() ? '<button class="btn btn-sec btn-sm" data-act="oldDel" style="color:var(--coral-700)"' + (n && !busy ? '' : ' disabled') + '>' + ic('trash', 15) + '<span class="oldDelL">Delete ' + n + '</span></button>' : '') +
    '</div></div></div>';
}
function oldTicked() { return $$('#cleanCard input[data-old]').filter(i => i.checked).map(i => i.dataset.old); }
function syncOld() {
  if (S.bulkBusy) return;
  const boxes = $$('#cleanCard input[data-old]'), n = oldTicked().length;
  const st = $('#oldStatus'); if (st) st.textContent = n + ' of ' + boxes.length + ' ticked';
  const d = $('#cleanCard [data-act=oldDone]'); if (d) { d.disabled = !n; $('.oldDoneL', d).textContent = 'Mark ' + n + ' complete'; }
  const x = $('#cleanCard [data-act=oldDel]'); if (x) { x.disabled = !n; $('.oldDelL', x).textContent = 'Delete ' + n; }
}
/* run one action over many cases, four at a time, with progress on the card */
async function bulkRun(ids, fn, verb) {
  const queue = ids.slice(), total = ids.length; const ok = [], bad = [];
  // while it runs the card shows progress and its controls stay off, even when the page redraws
  const label = () => { S.bulkBusy = verb + ' ' + (ok.length + bad.length) + ' of ' + total + '…'; const el = $('#oldStatus'); if (el) el.textContent = S.bulkBusy; };
  label(); $$('#cleanCard button, #cleanCard input, #cleanCard select').forEach(b => { b.disabled = true; });
  const worker = async () => { while (queue.length) { const id = queue.shift(); try { await fn(id); ok.push(id); } catch (e) { bad.push(id); } label(); } };
  try { await Promise.all([worker(), worker(), worker(), worker()]); } finally { S.bulkBusy = ''; }
  return { ok, bad };
}
async function bulkComplete(ids) {
  if (!ids.length) return;
  if (!(await confirmBox('Mark ' + ids.length + ' case' + (ids.length > 1 ? 's' : '') + ' complete?', 'They move to Completed. You can undo right after, or reopen any of them later.', 'Mark complete'))) return;
  const keep = ids.map(id => findCase(id)).filter(Boolean).map(c => Object.assign({}, c));
  const { ok, bad } = await bulkRun(ids, id => B.mutateCase(id, () => 'done', { a: 'close' }), 'Completing');
  if (S.hist) keep.filter(c => ok.includes(c.id)).forEach(c => S.hist.unshift(Object.assign(c, { status: 'done', closedAt: Date.now() })));
  S.oldOff.clear(); S.closedLoaded = false; queueRender();
  toast(ok.length + ' marked complete' + (bad.length ? ' · ' + bad.length + ' couldn’t be changed' : ''), { bad: !!bad.length, action: ok.length ? 'Undo' : '', ms: 9000,
    onAction: () => bulkRun(ok, id => B.mutateCase(id, () => 'open', { a: 'reopen' }), 'Reopening').then(r => { if (S.hist) S.hist = S.hist.filter(c => !r.ok.includes(c.id)); S.closedLoaded = false; queueRender(); toast(r.ok.length + ' reopened'); }) });
}
async function bulkDelete(ids) {
  if (!ids.length || !isOwner()) return;
  if (!(await confirmBox('Delete ' + ids.length + ' case' + (ids.length > 1 ? 's' : '') + '?', 'They leave every list. You can bring any of them back from Team & security → Deleted cases for 90 days. To finish cases normally, use “Mark complete” instead.', 'Delete', true))) return;
  const { ok, bad } = await bulkRun(ids, id => B.deleteCase(id), 'Deleting');
  S.oldOff.clear(); queueRender();
  toast(ok.length + ' deleted' + (bad.length ? ' · ' + bad.length + ' couldn’t be deleted' : ''), { bad: !!bad.length });
}
function viewList(base, showWho) {
  if (S.firstLoad && !S.demo) return '<div class="empty">Loading cases…</div>';
  const f = S.f;
  const stageOpts = f.type ? FLOWS[TYPE[f.type].flow].stages : [];
  const grpLabel = { dr: 'Needs Dr. A', fab: 'In fabrication', arrived: 'Arrived' }[f.grp];
  let h = '<div class="filters">' +
    '<select data-f="type" aria-label="Type"><option value="">All types</option>' + typesShown(Array.from(S.cases.values()), f.type).map(t => '<option value="' + t.k + '"' + (f.type === t.k ? ' selected' : '') + '>' + esc(t.l) + '</option>').join('') + '</select>' +
    (stageOpts.length ? '<select data-f="stage" aria-label="Stage"><option value="">All stages</option>' + stageOpts.map(([k, l]) => '<option value="' + k + '"' + (f.stage === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' : '') +
    (showWho ? '<select data-f="who" aria-label="Assigned to"><option value="">Anyone</option><option value="_none"' + (f.who === '_none' ? ' selected' : '') + '>Unassigned</option>' + activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (f.who === r.sid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>' : '') +
    '<select data-f="due" aria-label="Lab date, or the delivery appt once the case is past the lab step"><option value="">Any lab or appt date</option>' + [['over', 'Late'], ['today', 'Today'], ['week', 'Next 7 days'], ['14', 'Next 14 days'], ['none', 'No lab date or delivery appt']].map(([k, l]) => '<option value="' + k + '"' + (f.due === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<select data-f="del" aria-label="Delivery appt"' + (f.del ? ' class="on"' : '') + '><option value="">Any delivery appt</option>' + DEL_OPTS.map(([k, l]) => '<option value="' + k + '"' + (f.del === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    (f.del === 'day' ? '<input type="date" id="fDelDay" data-f="delDay" value="' + esc(f.delDay || '') + '" aria-label="Delivery appt day">' : '') +
    (grpLabel ? '<button class="chip on" data-act="clearGrp">' + esc(grpLabel) + ' ✕</button>' : '') +
    (base.some(c => c.shipToPatient) || f.ship ? '<button class="chip flt' + (f.ship ? ' on' : '') + '" data-act="shipF" aria-pressed="' + !!f.ship + '">' + ic('truck', 15) + 'Ship to patient<span class="c">' + base.filter(c => c.shipToPatient && matchesQ(c)).length + '</span></button>' : '') +
    ((f.type || f.stage || f.who || f.due || f.del || f.grp || f.ship) ? '<button class="btn btn-ghost" data-act="clearF">Clear filters</button>' : '') +
    colsControlHTML(LIST_COLS.map(x => x[0])) + '</div>';
  return h + '<div id="listBody">' + listBodyHTML(base) + '</div>';
}
/* the cases on All open cases / My cases (the delivery day box redraws just this, so typing a date isn't interrupted) */
function listBase() { return S.view === 'mine' ? openCases().filter(c => c.assignee === meSid()) : openCases(); }
/* columns anyone can hide on their computer (Amir, 2 Oct 2026: "can I just click it and make it hidden?"): the eye on a
   column's heading hides it, the Columns menu brings it back; remembered on this computer only (not patient data) */
/* (4 Oct 2026: the one "Next date" column became Lab date + Delivery appt; a hidden "Next date" ('due') isn't carried over) */
/* ---------- the case's latest note (Amir, 5 Oct 2026: "in the column view there should be one for notes. so the last note would
   show there. for example I wrote a note for a pt. Sent to printing, it should show there and who wrote it") ----------
   The newest comment, or the Notes field when it was written after it, with who wrote it. A Notes field saved from now on
   carries who and when (notesBy / notesAt, with notesH, see noteHash); one written before is looked up once on each computer
   in the case's history (the newest entry that set it) and remembered there by case — no patient details — as
   nloCases.noteAuth. Notes brought in from Asana say so. */
function notesStamp(x, at) {
  if (String(x.notes || '').trim()) { x.notesBy = meSid(); x.notesAt = at; x.notesH = noteHash(x.notes); } else { x.notesBy = ''; x.notesAt = 0; x.notesH = ''; }
}
function noteAuthCache() {
  if (!S.naCache) { try { const m = JSON.parse(localStorage.getItem('nloCases.noteAuth') || '{}'); S.naCache = m && typeof m === 'object' ? m : {}; } catch (e) { S.naCache = {}; } }
  return S.naCache;
}
function notesAuthor(c) {
  const t = String(c.notes || '').trim(); if (!t) return null;
  const h = noteHash(t); if (c.notesH === h) return { by: c.notesBy || '', at: c.notesAt || 0 };
  const k = noteAuthCache()[c.id]; return k && k.h === h ? { by: k.by || '', at: k.at || 0 } : null;
}
function lastNote(c) {
  const lc = (c.comments || []).filter(x => x && String(x.text || '').trim()).reduce((a, b) => (!a || (b.at || 0) >= (a.at || 0) ? b : a), null);
  const t = String(c.notes || '').trim(), au = t ? notesAuthor(c) : null;
  const nf = t ? { text: t, by: au ? au.by : '', at: au ? au.at : 0, field: true, known: !!au } : null;
  if (lc && (!nf || (lc.at || 0) >= nf.at)) return { text: String(lc.text).trim(), by: lc.by || '', at: lc.at || 0 };
  return nf;
}
function noteWho(n) { const r = n.by && staff(n.by); return n.by === 'asana' ? 'from Asana' : r && r.role === 'owner' ? 'Dr. A' : n.by ? firstName(staffName(n.by, n.by)) : ''; }
/* the Notes column: newest first (a note whose time isn't known after the dated ones), no note last */
function noteKey(c) { const n = lastNote(c); return n ? -(n.at || 1) : null; }
function noteCellHTML(c) {
  noteAuthNeed(c); const n = lastNote(c); if (!n) return '<span class="due none">No notes</span>';
  const w = noteWho(n), when = n.at ? fmtWhen(n.at) : '';
  return '<div class="noteCell" title="' + esc(n.text + (w || when ? '\n— ' + [w, when].filter(Boolean).join(', ') : '')) + '"><div class="nTxt">' + esc(n.text.replace(/\s+/g, ' ')) + '</div>' +
    (w || when ? '<div class="nBy">' + (w ? (n.by === 'asana' ? esc(w) : '<b>' + esc(w) + '</b>') : '') + (w && when ? ' · ' : '') + esc(when) + '</div>' : '') + '</div>';
}
/* phones: the latest note on one line under the name */
function noteMobHTML(c) {
  noteAuthNeed(c); const n = lastNote(c); if (!n) return '';
  const w = noteWho(n);
  return '<div class="nMob onlyM">' + ic('chat', 13) + '<span>' + (w && n.by !== 'asana' ? '<b>' + esc(w) + ':</b> ' : '') + esc(n.text.replace(/\s+/g, ' ')) + '</span></div>';
}
/* who wrote a Notes field from before: its case's history, once per computer, in the background — asked even while a comment
   is the newer-looking note, since the Notes' time only comes with its writer */
function noteAuthNeed(c) { if (String(c.notes || '').trim() && !notesAuthor(c)) noteAuthAsk(c); }
function noteAuthAsk(c) {
  const key = c.id + ':' + noteHash(c.notes); S.naAsk = S.naAsk || new Set(); if (S.naAsk.has(key)) return; S.naAsk.add(key);
  (S.naQ = S.naQ || []).push(c.id); noteAuthPump();
}
async function noteAuthPump() {
  if (S.naBusy) return; S.naBusy = true; let got = 0;
  try {
    while (S.naQ && S.naQ.length && S.inApp) {
      const id = S.naQ.shift(), c = findCase(id); if (!c || !String(c.notes || '').trim() || notesAuthor(c)) continue;
      let log; try { log = await B.caseLog(id); } catch (e) { continue; }
      noteAuthKeep(c, log); got++;
      if (got % 10 === 0) noteAuthDone();
    }
  } finally { S.naBusy = false; }
  if (got) noteAuthDone();
}
function noteAuthKeep(c, log) {
  const r = noteAuthFrom(log || []); noteAuthCache()[c.id] = { h: noteHash(c.notes), by: r.by, at: r.at, t: Date.now() };
  try { const m = noteAuthCache(), ks = Object.keys(m); if (ks.length > 800) ks.sort((a, b) => (m[a].t || 0) - (m[b].t || 0)).slice(0, ks.length - 800).forEach(k => delete m[k]);
    localStorage.setItem('nloCases.noteAuth', JSON.stringify(m)); } catch (e) { }
}
function noteAuthDone() { if (S.view === 'list' || S.view === 'mine') queueRender(); noteByPaint(); }
/* the newest history entry that set the Notes field: an edit (or a step move / lab email) that lists it, the creation, the
   Asana import; a restored version (or anything else) could have changed it without saying, so the writer isn't known */
const NOTE_KEEP_ACTS = ['edit', 'stage', 'email', 'photo', 'reopen', 'close', 'assign', 'comment', 'rekey'];
function noteAuthFrom(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const x = log[i] || {};
    if (['edit', 'stage', 'email'].includes(x.a) && (x.fields || []).includes('notes')) return { by: x.sid || '', at: x.at || 0 };
    if (x.a === 'create') return { by: x.sid || '', at: x.at || 0 };
    if (x.a === 'import') return { by: 'asana', at: x.at || 0 };
    if (!NOTE_KEEP_ACTS.includes(x.a)) break;
  }
  return { by: '', at: 0 };
}
/* the case panel's Notes: who wrote it and when, under the text */
function noteByHTML(c) {
  const au = notesAuthor(c); if (!au) return '<div class="small muted nAuth" id="dNoteBy"></div>';
  const w = noteWho({ by: au.by }), when = au.at ? fmtWhen(au.at) : '';
  return '<div class="small muted nAuth" id="dNoteBy">' + (w || when ? '— ' + (w ? (au.by === 'asana' ? esc(w) : '<b>' + esc(w) + '</b>') : '') + (w && when ? ', ' : '') + esc(when) : '') + '</div>';
}
function noteByPaint() { const el = $('#dNoteBy'), c = el && S.openId && findCase(S.openId); if (c) el.outerHTML = noteByHTML(c); }
const LIST_COLS = [['type', 'Type'], ['stage', 'Stage'], ['notes', 'Notes'], ['lab', 'Lab date'], ['appt', 'Delivery appt'], ['tx', 'Tx progress'], ['cost', 'Tx cost'], ['ship', 'Shipping'], ['who', 'Assigned'], ['updated', 'Updated']];
/* optional columns stay off until someone ticks them in Columns (Amir, 4 Oct 2026: "add an optional column for total cost per tx
   so far"); remembered on that computer as nloCases.shownCols. They don't count in "N hidden", and Show all leaves them be. */
const OPTIONAL_COLS = ['cost'];
function hiddenCols() {
  if (!S.hidCols) {
    const read = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    const shown = read('nloCases.shownCols');
    S.hidCols = new Set(read('nloCases.hiddenCols').filter(k => LIST_COLS.some(x => x[0] === k) && !OPTIONAL_COLS.includes(k)).concat(OPTIONAL_COLS.filter(k => !shown.includes(k))));
  }
  return S.hidCols;
}
function setColHidden(k, hide) {
  const h = hiddenCols(); if (k) { if (hide) h.add(k); else h.delete(k); }
  try { localStorage.setItem('nloCases.hiddenCols', JSON.stringify(Array.from(h).filter(x => !OPTIONAL_COLS.includes(x))));
    localStorage.setItem('nloCases.shownCols', JSON.stringify(OPTIONAL_COLS.filter(x => !h.has(x)))); } catch (e) { }
}
function colLabel(k) { return k === 'stage' && S.view === 'done' ? 'Last stage' : (LIST_COLS.find(x => x[0] === k) || [k, k])[1]; }
/* the Columns button and its menu (keys = the columns this table has) */
function colsControlHTML(keys) {
  const hid = hiddenCols(), n = keys.filter(k => hid.has(k) && !OPTIONAL_COLS.includes(k)).length, opt = keys.filter(k => OPTIONAL_COLS.includes(k));
  const box = k => '<label class="colOpt"><input type="checkbox" data-col="' + k + '"' + (hid.has(k) ? '' : ' checked') + '> ' + esc(colLabel(k)) + '</label>';
  return '<div class="colWrap"><button type="button" class="btn btn-ghost colBtn" data-act="colMenu" aria-expanded="' + !!S.colMenu + '" aria-haspopup="true">' + ic('cols', 16) + 'Columns' + (n ? '<span class="c">' + n + ' hidden</span>' : '') + '</button>' +
    (S.colMenu ? '<div class="colMenu" role="group" aria-label="Columns to show"><div class="colHd">Show these columns</div>' + keys.filter(k => !opt.includes(k)).map(box).join('') +
      (opt.length ? '<div class="colHd colOptHd">Optional</div>' + opt.map(box).join('') : '') +
      (n ? '<button type="button" class="linkBtn" data-act="showCols">Show all</button>' : '') + '<div class="small muted colNote">Saved on this computer</div></div>' : '') + '</div>';
}
function listBodyHTML(base) {
  const list = sortList(applyFilters(base));
  if (list.some(c => c.type === 'nla')) ensureHist(list.filter(c => c.type === 'nla'));
  if (!list.length) return '<div class="card"><div class="empty">' + (base.length ? 'No cases match.' : 'No open cases yet.') + '</div></div>';
  const hid = hiddenCols(), on = k => !hid.has(k);
  // a heading sorts; its eye hides the column (the Columns menu above the table brings it back)
  const th = (k, l, cls) => '<th class="' + (cls || '') + '"><span class="thIn"><button data-act="sort" data-k="' + k + '">' + l + (sortShown() === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button>' +
    (k === 'patient' ? '' : '<button class="thHide" data-act="hideCol" data-k="' + k + '" title="Hide this column" aria-label="Hide the ' + esc(l) + ' column">' + ic('eyeOff', 14) + '</button>') + '</span></th>';
  // Shipping: the Ship to patient alert and one-click tracking get their own column (on phones they sit under the name)
  // the lab date and the delivery appt each have a column (Amir, 4 Oct 2026); on phones both sit under the stage (or the
  // name, with Stage hidden) instead of in columns off to the side: the lab date while it's still ahead, the appt if there is one
  const dateM = c => {
    if (!on('lab') && !on('appt')) return '';
    const m = (on('lab') && labDueOf(c) ? labChip(c) : '') + (on('appt') && apptOf(c) ? apptChip(c) : '');
    return '<div class="flags onlyM">' + (m || '<span class="due none">No date</span>') + '</div>';
  };
  return '<div class="card tblWrap"><table class="tbl"><thead><tr>' + th('patient', 'Patient') + (on('type') ? th('type', 'Type', 'hideM') : '') + (on('stage') ? th('stage', 'Stage') : '') +
      (on('notes') ? th('notes', 'Notes', 'hideM noteCol') : '') + (on('lab') ? th('lab', 'Lab date', 'hideM dateCol') : '') + (on('appt') ? th('appt', 'Delivery appt', 'hideM dateCol') : '') + (on('tx') ? th('tx', 'Tx progress', 'hideM txCol') : '') + (on('cost') ? th('cost', 'Tx cost', 'hideM txCol') : '') +
      (on('ship') ? th('ship', 'Shipping', 'hideM') : '') + (on('who') ? th('who', 'Assigned', 'hideM') : '') + (on('updated') ? th('updated', 'Updated', 'hideM') : '') + '</tr></thead><tbody>' +
    list.map(c => { const g = stageGroup(flowOf(c), c.stage), ship = on('ship') ? shipFlag(c) + trackLinks(c) : '';
      return '<tr class="click" data-act="open" data-id="' + esc(c.id) + '" tabindex="0"><td><div class="ptCell">' + ptAv(c, 36) + '<div class="ptTxt"><div class="pt">' + esc(c.patient || '(no name)') + '</div><div class="small muted">' + esc(c.detail || '') + alignerMini(c) + '</div>' +
      (ship ? '<div class="flags onlyM">' + ship + '</div>' : '') + (on('stage') ? '' : dateM(c)) + (on('notes') ? noteMobHTML(c) : '') + '</div></div></td>' +
      (on('type') ? '<td class="hideM">' + typeMark(c) + '</td>' : '') +
      (on('stage') ? '<td class="stg">' + progHTML(c) + '<div class="small">' + esc(stageLabel(c)) + (g ? ' <span class="muted">· ' + esc(g.l.toLowerCase()) + ' ' + (g.stages.indexOf(c.stage) + 1) + '/' + g.stages.length + '</span>' : '') + '</div>' +
        (recFlag(c) || holdFlag(c) ? '<div class="flags">' + recFlag(c) + holdFlag(c) + '</div>' : '') + dateM(c) + '</td>' : '') +
      (on('notes') ? '<td class="hideM noteCol">' + noteCellHTML(c) + '</td>' : '') + // the latest note, next to the stage (5 Oct 2026)
      (on('lab') ? '<td class="hideM dateCol labCol">' + labChip(c, true) + '</td>' : '') +
      (on('appt') ? '<td class="hideM dateCol apptCol">' + apptChip(c, true) + '</td>' : '') +
      (on('tx') ? '<td class="hideM txCol">' + txCellHTML(c) + '</td>' : '') +
      (on('cost') ? '<td class="hideM txCol costCol">' + txCostHTML(c) + '</td>' : '') +
      (on('ship') ? '<td class="hideM shipCol">' + (ship ? '<div class="flags">' + ship + '</div>' : '') + '</td>' : '') +
      (on('who') ? '<td class="hideM asgCol">' + asgBtnHTML(c) + '</td>' : '') +
      (on('updated') ? '<td class="hideM small muted">' + esc(c.updatedAt ? fmtWhen(c.updatedAt) : '') + '</td>' : '') + '</tr>'; }).join('') +
    '</tbody></table></div><div class="small muted" style="margin-top:8px">' + list.length + ' case' + (list.length === 1 ? '' : 's') + '</div>';
}

/* ---------- Completed ---------- */
function viewDone() {
  if (!S.closedLoaded) { loadClosed(); return '<div class="empty">Loading completed cases…</div>'; }
  const list = S.closed.filter(matchesQ).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  let h = '<div class="filters"><span class="small muted">Completed in the last ' + S.closedDays + ' days</span>' +
    (S.closedDays < 3650 ? '<button class="btn btn-ghost" data-act="moreClosed">Show older</button>' : '') + colsControlHTML(['type', 'stage']) + '</div>';
  if (!list.length) return h + '<div class="card"><div class="empty">No completed cases' + (S.q ? ' match' : '') + '.</div></div>';
  const hid = hiddenCols(), on = k => !hid.has(k);
  const th = (k, l, cls) => '<th class="' + (cls || '') + '"><span class="thIn">' + l + '<button class="thHide" data-act="hideCol" data-k="' + k + '" title="Hide this column" aria-label="Hide the ' + esc(l) + ' column">' + ic('eyeOff', 14) + '</button></span></th>';
  return h + '<div class="card tblWrap"><table class="tbl"><thead><tr><th>Patient</th>' + (on('type') ? th('type', 'Type', 'hideM') : '') + '<th>Completed</th>' + (on('stage') ? th('stage', 'Last stage', 'hideM') : '') + '</tr></thead><tbody>' +
    list.map(c => '<tr class="click" data-act="openClosed" data-id="' + esc(c.id) + '" tabindex="0"><td><div class="ptCell">' + ptAv(c, 36) + '<div class="ptTxt"><div class="pt">' + esc(c.patient) + '</div><div class="small muted">' + esc(c.detail || '') + '</div></div></div></td>' +
      (on('type') ? '<td class="hideM">' + typeMark(c) + '</td>' : '') + '<td class="small">' + esc(fmtWhen(c.closedAt)) + '</td>' + (on('stage') ? '<td class="hideM small">' + esc(stageLabel(c)) + '</td>' : '') + '</tr>').join('') +
    '</tbody></table></div>';
}
async function loadClosed() {
  if (S.closedLoading) return; S.closedLoading = true;
  try { S.closed = liveCases(await B.loadClosed(S.closedDays)); S.closedLoaded = true; }
  catch (e) { toast(errText(e), { bad: true }); S.closedLoaded = true; S.closed = []; }
  S.closedLoading = false; if (S.view === 'done') renderView();
}

/* ---------- Drawer ---------- */
function findCase(id) { return S.cases.get(id) || S.closed.find(c => c.id === id); }
function openDrawer(id) {
  S.openId = id; S.editing = false; S.history = null; S.dsTog = new Map(); S.wtyRedraw = false; // each case opens folded (or all open, see dsAllMode)
  if (!$('#drawer')) {
    const scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.dataset.act = 'closeDrawer'; document.body.appendChild(scrim);
    const d = document.createElement('aside'); d.id = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Case'); document.body.appendChild(d);
  }
  renderDrawer(); loadHistory(id);
}
function closeDrawer(force) {
  if (!force && S.editing && editDirty() && !confirm('Discard your changes?')) return;
  wtyFlush(); S.wtyRedraw = false; // a Specialty invoice date typed and not yet saved (warranty.js)
  S.openId = null; S.editing = false; const d = $('#drawer'), s = $('#scrim'); if (d) d.remove(); if (s) s.remove();
}
function refreshDrawer(gone) {
  if (!S.openId) return;
  if (gone && !S.closed.some(c => c.id === S.openId)) {
    if (S.editing) { const n = $('#drawerNotice'); if (n) n.innerHTML = '<div class="notice bad">Someone just completed or deleted this case.</div>'; return; }
    closeDrawer(true); return;
  }
  if (S.editing) { const n = $('#drawerNotice'); if (n) n.innerHTML = '<div class="notice">Someone else just updated this case. Saving will keep their changes and apply yours on top.</div>'; return; }
  if (wtyHold()) return; // the Specialty invoice date is being typed: redraw once it's left (warranty.js)
  renderDrawer(); loadHistory(S.openId);
}
async function loadHistory(id) {
  // (two loads in flight: an answer older than the one on screen is dropped — a later load that fails leaves the earlier one)
  const seq = S.histSeq = (S.histSeq || 0) + 1;
  try { const h = await B.caseLog(id); if (S.openId === id && seq > (S.histShown || 0)) { S.histShown = seq; S.history = h; const el = $('#histBox'); if (el) el.innerHTML = historyHTML(findCase(id)); wtyRefresh(id);
    const c = findCase(id); if (c && String(c.notes || '').trim() && !notesAuthor(c)) { noteAuthKeep(c, h); noteByPaint(); } } } catch (e) { }
}
const FIELD_LABELS = { rx: 'Herbst Rx', rxRet: 'Retainer Rx', rxMet: 'Metal Rx', rxFun: 'Functional Rx', invDate: 'invoice date', noGuarantee: 'No Guarantee', photo: 'photo', labRef: 'lab case #', labHold: 'lab hold', planUrl: 'plan link', shipToPatient: 'ship to patient', records: 'records on file', zoomDate: 'Zoom call', zoomTime: 'Zoom call', tracking: 'tracking #', carrier: 'carrier', teeth: 'tooth chart', teethNote: 'tooth chart', chart: 'chart #', titanUrl: 'Titan link', initial: 'initial/refinement', appliances: 'appliance', lab: 'lab', arches: 'arch', retKinds: 'retainer type', goals: 'Dr. A’s instructions', instrPicks: 'Dr. A’s instructions', instrOther: 'Dr. A’s instructions', extras: 'extras', variant: 'case type', type: 'type', patient: 'patient name', detail: 'detail', stage: 'stage', assignee: 'assignee', assistant: 'assistant', scanner: 'scanner', scanDate: 'scan date', dueDate: 'due date', labDate: 'lab completion date', deliveryDate: 'delivery appt', deliveryTime: 'appt time', txStart: 'treatment start', txEnd: 'expected removal', acrylic: 'acrylic color', glitter: 'acrylic color', alU: 'aligners', alL: 'aligners', aligners: 'aligners', atTemplates: 'attachment templates', treatArch: 'arches to treat', instructions: 'Dr. A’s instructions', cc: 'patient’s CC', ipr: 'IPR & spacing', notes: 'notes' };
function historyHTML(c) {
  const h = S.history; if (!h) return '<div class="small muted">Loading…</div>'; if (!h.length) return '<div class="small muted">No history yet.</div>';
  const stageName = k => { const s = c && (caseStages(c).find(x => x[0] === k) || flowOf(c).stages.find(x => x[0] === k)); return s ? s[1] : (c && retiredStageLabel(c, k)) || k; };
  const shipped = x => x.close ? ' and marked it complete (shipped to the patient)' : '';
  return h.filter(x => x.a !== 'rekey' && x.a !== 'save').reverse().map(x => {
    let t = '';
    if (x.a === 'create') t = 'created the case'; else if (x.a === 'import') t = 'imported it from Asana';
    else if (x.a === 'stage') t = 'moved it to ' + stageName(x.to) + ((x.fields || []).length ? ' (and set ' + Array.from(new Set(x.fields.map(f => FIELD_LABELS[f] || f))).join(', ') + ')' : '') + shipped(x);
    else if (x.a === 'comment') t = 'added a comment';
    else if (x.a === 'close') t = 'marked it complete'; else if (x.a === 'reopen') t = 'reopened it';
    else if (x.a === 'assign') t = x.to ? 'assigned it to ' + staffName(x.to, x.to) : 'unassigned it';
    else if (x.a === 'edit') t = 'changed ' + Array.from(new Set((x.fields || []).filter(f => f !== 'instructions').map(f => FIELD_LABELS[f] || f))).join(', ') + shipped(x);
    else if (x.a === 'restore') t = 'restored an earlier version';
    else if (x.a === 'photo') t = { add: 'added a photo', change: 'changed the photo', remove: 'removed the photo', copy: 'added the photo from another of the patient’s cases', undo: 'put the earlier photo back' }[x.how] || 'changed the photo';
    else if (x.a === 'email') { // applied from a lab email (mail.js); shown as the email, not the person whose app applied it
      const f = Array.from(new Set((x.fields || []).filter(k => k !== 'mailIds').map(k => FIELD_LABELS[k] || k)));
      t = (x.to ? 'moved it to ' + stageName(x.to) + (f.length ? ' and saved the ' : '') : f.length ? 'saved the ' : 'updated it') + f.join(', ') + shipped(x);
    }
    else t = x.a;
    const who = x.a === 'email' ? ((MAIL_CO[x.co] || {}).l || 'Lab') + ' email' : (firstName(staffName(x.sid, x.sid)) || x.sid);
    return '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(who) + '</b> ' + esc(t) + '</span></div>';
  }).join('');
}
function renderDrawer() {
  const d = $('#drawer'); const c = findCase(S.openId); if (!d || !c) return;
  if (S.editing) { // the patient's name stays big at the top while editing (Amir), and follows the name field as it's typed
    d.innerHTML = '<div class="dHd dEdit">' + ptAv(c, 64) + '<div style="flex:1;min-width:0"><div class="dEditLbl">' + ic('edit', 13) + 'Editing case</div><h3 id="dEditName">' + esc(c.patient || '(no name)') + '</h3>' +
      '<div class="sub">' + typeBadge(c) + (c.detail ? '<span class="small muted">' + esc(c.detail) + '</span>' : '') + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' + caseFormHTML(S.editBase, false) + '</div>' +
    '<div class="dFt"><button class="btn btn-pri" data-act="saveEdit">Save changes</button><button class="btn btn-sec" data-act="cancelEdit">Cancel</button></div>';
    d.dataset.mode = 'edit'; wireCaseForm(d, false); phPaint(); savPaint(d);
    const nm = $('#cf-patient', d), hd = $('#dEditName', d); if (nm && hd) nm.addEventListener('input', () => { hd.textContent = nm.value.trim() || '(no name)'; });
    return; }
  if (c.locked) {
    d.innerHTML = '<div class="dHd"><div style="flex:1"><h3>Case can’t be opened</h3></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
      '<div class="dBd"><div class="notice bad">This case’s saved copy can’t be decrypted — it may have been damaged.</div>' +
      (isOwner() ? '<p class="small" style="margin-bottom:12px">Every earlier version is kept. Pick the last good one to restore it.</p><button class="btn btn-pri" data-act="versions">' + ic('clock', 16) + 'Restore a saved version</button>' : '<p class="small">Ask Dr. A — he can restore it from its saved versions.</p>') + '</div>';
    return;
  }
  const keepCmt = $('#cmtText') ? $('#cmtText').value : ''; const hadFocus = document.activeElement && document.activeElement.id === 'cmtText';
  const wKeep = wtyKeep(); // (the Specialty invoice date being typed: warranty.js)
  // a live update redraws the panel: keep it where it was scrolled to (same case, not coming back from Edit)
  const bd0 = $('.dBd', d), keepTop = bd0 && d.dataset.for === c.id && d.dataset.mode === 'view' ? bd0.scrollTop : 0;
  const done = c.status === 'done'; const flow = flowOf(c); const si = stageIndex(c);
  const kv = (k, v) => '<div><div class="k">' + k + '</div><div class="v">' + (v || '<span class="muted">—</span>') + '</div></div>';
  const txt = v => '<div class="txt">' + esc(v) + '</div>';
  const oneLine = v => esc(String(v || '').trim().replace(/\s*\n+\s*/g, ' · ')); // a section's text on its folded heading
  const cc = ccShown(c), ccNone = cc === 'None'; // (an older note like "This is initial" isn't a concern: not shown)
  const cmts = c.comments || [], lastC = cmts[cmts.length - 1];
  const who = c.assignee ? firstName(staffName(c.assignee, '')) || '—' : c.assigneeName ? c.assigneeName + ' (Asana)' : '';
  const nAl = alN(c), one = oneArch(c), hasTeeth = !!(c.teeth && Object.keys(c.teeth).length);
  // in-house aligners and retainers: Print labels in the header, never folded away (Amir, 5 Oct 2026: "I could not find the print
  // labels easily ... it should be clearly visible in the header") — the aligner labels once the set's counts are in; the
  // retainer bag label, which then offers to complete the case
  const lblBtn = c.type === 'nla' ? '<div class="dLbl" id="dLbl"><button type="button" class="btn btn-pri btn-sm" data-act="labels"' + (nAl ? '' : ' disabled') + '>' + ic('print', 15) + 'Print labels</button>' +
      (nAl ? '' : '<span class="small muted">once the aligner counts are in (Edit)</span>') + '</div>'
    : c.type === 'retainer' ? '<div class="dLbl" id="dLbl"><button type="button" class="btn btn-pri btn-sm" data-act="retLabels" title="The label for the bag: patient, upper/lower, retainers or whitening trays">' + ic('print', 15) + 'Print labels</button>' +
      (done ? '' : '<span class="small muted">for the bag — then it asks to mark the case complete</span>') + '</div>' : '';
  d.dataset.for = c.id; d.dataset.mode = 'view';
  d.innerHTML = '<div class="dHd"><button type="button" class="dPh" data-act="phEdit" title="' + (c.photo ? 'Change or remove the photo' : 'Add a photo of the patient') + '" aria-label="' + (c.photo ? 'Patient photo: change or remove' : 'Add a patient photo') + '">' + ptAv(c, 64) + '<span class="dPhCam">' + ic('camera', 13) + '</span></button>' +
    // what the case is (arch, appliances, lab, kind of submission, extras) sits under the name — it was its own "Case" section
    '<div style="flex:1;min-width:0"><h3>' + esc(c.patient || '(no name)') + '</h3><div class="sub">' + typeBadge(c) + (c.detail ? '<span class="small muted">' + esc(c.detail) + '</span>' : '') + caseBadges(c) + '</div>' + lblBtn + '</div>' +
    '<button type="button" class="btn btn-ghost dAll" data-act="dsAll"></button><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' +
    (done ? '<div class="notice info">Completed ' + esc(fmtWhen(c.closedAt)) + '</div>' : '') +
    (c.shipToPatient ? '<div class="notice ship" role="note">' + ic('truck', 18) + '<span><b>Ship to patient</b></span></div>' : '') +
    (isHeld(c) ? '<div class="notice bad mpOld" role="note"><span><b>' + esc(holdText(c)) + '</b></span>' + (done ? '' : '<button class="btn btn-sec btn-sm" data-act="clearHold">Hold is sorted out</button>') + '</div>' : '') +
    // a MARPE entered (or imported) as an appliance before MARPE had its own steps: one click moves it over
    (!done && isOldMarpe(c) ? '<div class="notice info mpOld"><span>MARPE has its own steps now: records, lab, Zoom call, design approval, delivery.</span><button class="btn btn-sec btn-sm" data-act="toMarpe">Switch to MARPE steps</button></div>' : '') +
    // the patient's chief concern stands out at the top, never folded (Amir, 3 Oct 2026: "needs to be a little bit highlighted more")
    (cc ? '<div class="ccBox' + (ccNone ? ' none' : '') + '" role="note" aria-label="Patient’s chief concern"><span class="ccIc">' + ic('chat', 20) + '</span><div class="ccB"><div class="ccK">Patient’s chief concern' + (ccLater(c) ? '<span>from last visit</span>' : '') + '</div><div class="ccV">' + esc(ccNone ? 'None' : cc) + '</div></div></div>' : '') +
    // the lab's own link to this patient's plan (from its email), then the company portals
    // in-house: the case's own Titan link first (when saved), then Titan's web version and its beta
    ((PORTALS[c.type] || []).length || safeUrl(c.planUrl) || safeUrl(c.titanUrl) ? '<div class="portals">' +
      (safeUrl(c.titanUrl) ? '<a class="btn btn-pri btn-sm" data-act="portal" href="' + esc(safeUrl(c.titanUrl)) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Open this case in Titan</a>' : '') +
      (safeUrl(c.planUrl) && okLabLink(c.type, c.planUrl) ? '<a class="btn btn-pri btn-sm" data-act="portal" href="' + esc(safeUrl(c.planUrl)) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'View treatment plan</a>' : '') + (PORTALS[c.type] || []).map(p => '<a class="btn btn-sec btn-sm" data-act="portal" href="' + esc(p.u) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Open ' + esc(p.l) + '</a>').join('') +
      '<span class="small muted">Opening a portal copies the patient’s name — paste it in the portal’s search.</span></div>' : '') +
    // every section folds to one line until it's tapped; Expand all opens them all (Amir, 3 Oct 2026)
    '<div class="dsList">' +
    dsec('stage', 'Stage', (done ? 'Completed · ' : '') + '<b>' + esc(stageLabel(c)) + '</b>' + progHTML(c),
      '<div class="stepper">' + caseStages(c).map(([k, l], i) => { const g = stageGroup(flow, k);
        return (g && g.stages[0] === k ? '<div class="stepGrp' + (i <= si ? ' d' : '') + '">' + esc(g.l) + '</div>' : '') +
        '<button class="step ' + (i < si ? 'past' : i === si ? 'cur' : '') + (g ? ' sub' : '') + '" data-act="setStage" data-k="' + k + '"' + (done ? ' disabled' : '') + ' aria-pressed="' + (i === si) + '"><span class="n">' + (i < si ? '✓' : i + 1) + '</span>' + esc(l) + '</button>'; }).join('') + '</div>') +
    (flow === FLOWS.marpe ? dsec('marpe', 'MARPE', marpeSum(c), marpeBoxHTML(c, done)) : '') +
    dsec('details', 'Details', (who ? 'Assigned to <b>' + esc(who) + '</b>' : 'Unassigned') + (!done && dueOf(c) ? ' · ' + dueChip(c) : c.deliveryDate ? ' · ' + delWord(c) + ' ' + esc(fmtDate(c.deliveryDate)) : ''),
      '<div class="kv">' +
      '<div style="grid-column:1/-1"><div class="k">Assigned to' + (!c.assignee && c.assigneeName ? ' <span class="muted" style="text-transform:none;letter-spacing:0">(Asana: ' + esc(c.assigneeName) + ')</span>' : '') + '</div>' +
        '<div class="staffRow dAssign" role="radiogroup" aria-label="Assigned to">' + [null].concat(withSavedStaff(activeRoster(), c.assignee)).map(r => staffTile(r, (c.assignee || '') === (r ? r.sid : ''), 'aTile', ' role="radio" data-act="assignTo"' + (done ? ' disabled' : ''))).join('') + '</div></div>' +
      kv('Scan date', esc(fmtDay(c.scanDate))) +
      kv('Lab completion', c.labDate ? esc(fmtDay(c.labDate)) + (!done && (dueOf(c) || {}).k === 'lab' ? ' ' + dueChip(c) : '') : '') +
      kv(delWord(c), c.deliveryDate ? esc(fmtDay(c.deliveryDate) + (c.deliveryTime ? ', ' + fmtTime(c.deliveryTime) : '')) + (!done && (dueOf(c) || {}).k === 'delivery' ? ' ' + dueChip(c) : '') : '') +
      (c.dueDate && !c.deliveryDate ? kv('Due (older case)', esc(fmtDay(c.dueDate))) : '') +
      (String(c.tracking || '').trim() ? kv('Tracking', trackList(c).length ? trackList(c).map(t => '<span class="trkLine">' + esc(t.n) + (t.carrier ? ' <span class="muted small">' + esc(t.carrier) + '</span>' : '') +
        (t.url ? ' <a class="flag trk" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' + ic('ext', 12) + 'Track</a>' : '') + '</span>').join('') : esc(c.tracking)) : '') +
      (c.labRef ? kv(esc(refLabel(c)), esc(c.labRef)) : '') +
      kv('Assistant', esc(staffName(c.assistant, c.assistantName))) + kv('Scanner', c.scanner ? scanLinkHTML(c.scanner) : '') + kv('Chart #', esc(c.chart || '')) +
      kv('Created', esc((c.createdAt ? fmtWhen(c.createdAt) : '') + (c.createdBy ? ' · ' + firstName(staffName(c.createdBy, '')) : ''))) + kv('Last update', esc(c.updatedAt ? fmtWhen(c.updatedAt) + (c.by ? ' · ' + firstName(staffName(c.by, '')) : '') : '')) +
      '</div>') +
    // a Herbst, Hawley retainers or a metal appliance (RPE, MSE…) going to Specialty: its Herbst / Retainer / Metal Rx, filled in from the case (rx.js, rxret.js, rxmetal.js)
    rxCaseSecsHTML(c, done) +
    // a Specialty case once it has shipped: Specialty's remake deadlines and how to claim one (warranty.js)
    wtySecHTML(c) +
    (c.type === 'nla' ? dsec('tx', 'Treatment', txSumHTML(c), '<div id="txBox">' + txBoxHTML(c) + '</div>') : '') +
    (c.type === 'nla' ? dsec('aligners', 'Aligners', nAl ? '<b>' + nAl + '</b> aligners in this set' + (c.alU || c.alL ? ' (' + (one === 'U' ? 'U ' + (c.alU || 0) + ' · upper only' : one === 'L' ? 'L ' + (c.alL || 0) + ' · lower only' : 'U ' + (c.alU || 0) + ' · L ' + (c.alL || 0)) + ')' : '') : 'Aligner counts not entered yet',
      '<div id="alBox">' + alignerTotalHTML(c, false) + '</div>') : '') +
    // (retainers & whitening trays: the bag label, which then offers to complete the case (Amir, 2 Oct 2026), is Print labels in the header)
    (c.instructions ? dsec('instr', 'Dr. A’s instructions', oneLine(c.instructions), txt(c.instructions)) : '') +
    (hasTeeth ? dsec('teeth', 'Tooth chart', oneLine(teethSummary(c.teeth)), '<div class="tc ro">' + toothChartHTML(c.teeth, true) + '</div><div class="txt" style="margin-top:8px">' + esc(teethSummary(c.teeth)) + '</div>') : '') +
    // one IPR section: the IPR Tracker's chart for this chart # (the typed "IPR & spacing" and "From the IPR Tracker" were the same thing twice)
    (iprLive(c) || String(c.ipr || '').trim() ? dsec('ipr', 'IPR & spacing', iprSumHTML(c), '<div id="iprBox">' + iprBoxHTML(c) + '</div>') : '') +
    (c.notes ? dsec('notes', 'Notes', oneLine(c.notes), txt(c.notes) + noteByHTML(c)) : '') + // (and who wrote it, 5 Oct 2026)
    dsec('comments', 'Comments', lastC ? (cmts.length > 1 ? cmts.length + ' · ' : '') + '<b>' + esc(firstName(staffName(lastC.by, lastC.by))) + ':</b> ' + esc(String(lastC.text || '').replace(/\s+/g, ' ')) : '<span class="muted">None yet</span>',
      (cmts.map(x => '<div class="cmt"><span class="av" data-sav="' + esc(x.by || '') + '">' + esc(initials(staffName(x.by, x.by))) + '</span><div><div class="w"><b>' + esc(firstName(staffName(x.by, x.by))) + '</b> · ' + esc(fmtWhen(x.at)) + '</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(x.text) + '</div></div></div>').join('') || '<div class="small muted" style="margin-bottom:6px">No comments yet.</div>') +
      (done ? '' : '<div class="field" style="margin-top:8px;margin-bottom:6px"><label for="cmtText" class="hidden">Add a comment</label><textarea id="cmtText" rows="2" placeholder="Add a comment…"></textarea></div><button class="btn btn-sec btn-sm" data-act="addCmt">Add comment</button>')) +
    // the chart note: further down and folded (Amir, 3 Oct 2026); Copy works without opening it. The scan visit's note or the
    // delivery visit's (5 Oct 2026), the heading says which one Copy copies
    dsec('note', 'Chart note', noteSumHTML(c), noteBodyHTML(c),
      '<button type="button" class="btn btn-sec btn-sm dsAct" data-act="copyNote">' + ic('copy', 14) + 'Copy</button>') +
    dsec('history', 'History', c.updatedAt ? 'Last change ' + esc(fmtWhen(c.updatedAt)) + (c.by && firstName(staffName(c.by, '')) ? ' · ' + esc(firstName(staffName(c.by, ''))) : '') : '', '<div id="histBox">' + historyHTML(c) + '</div>') +
    '</div></div>' +
    '<div class="dFt">' + (done ? '<button class="btn btn-sec" data-act="reopen">Reopen</button>' :
      '<button class="btn btn-mint" data-act="complete" data-id="' + esc(c.id) + '">' + ic('done', 16) + 'Mark complete</button><button class="btn btn-sec" data-act="edit">' + ic('edit', 16) + 'Edit</button>') +
    (isOwner() ? '<span style="flex:1"></span><button class="btn btn-ghost" data-act="versions">' + ic('clock', 16) + 'Versions</button><button class="btn btn-ghost" data-act="delCase" style="color:var(--coral-700)">' + ic('trash', 16) + 'Delete</button>' : '') + '</div>';
  const t = $('#cmtText'); if (t) { t.value = keepCmt; if (hadFocus) t.focus(); }
  wtyRestore(wKeep);
  if (keepTop) $('.dBd', d).scrollTop = keepTop;
  dsAllSync(); phPaint(); savPaint(d); phWireDrawer(d); picPaint(d);
  if (typeOf(c).aligner && c.chart && !done) iprAutoLoad(c);
  if (c.type === 'nla') ensureHist([c]);
}
/* ---------- in-house treatment timeline (Amir, 3 Oct 2026: "show a graph for each patient on where they are in treatment") ----------
   From the patient's Start and Expected removal (txOf): the bar is the treatment, mint up to today (coral past the expected
   removal), with the month marks, today, and each of the patient's in-house sets at its delivery appt (or scan date). */
/* the bar's colour as the end gets near (Amir, 3 Oct 2026: change colour near the end — "whatever makes more sense"): by the
   time left, not the percent, so it means the same on a 6- and a 24-month treatment — amber once it's down to "3 months left",
   coral at "4 weeks left", dark red past the expected removal. A short treatment stays mint until it's halfway. */
function txPhase(p) { return p.over ? 'sOver' : p.before || p.pct < .5 ? '' : p.left <= 31 ? 's1' : p.left <= 106 ? 's3' : ''; }
function txSumHTML(c) {
  const t = txOf(c, casePool()); if (!t) return '<span class="muted">No start and expected removal yet</span>';
  const p = txProgress(t), tx = txText(p, t), cut = !p.before && !p.over ? tx.lastIndexOf(' · ') : -1;
  // on a phone the folded line keeps "Month 4 of 18 · 19%" (the time left is in the open section)
  const ph = txPhase(p);
  return '<span class="txMini' + (ph ? ' ' + ph : '') + '" aria-hidden="true"><i style="width:' + Math.round((p.over ? 1 : p.pct) * 100) + '%"></i></span>' +
    '<b' + (p.over ? ' class="txOver"' : '') + '>' + (cut > 0 ? esc(tx.slice(0, cut)) + '<span class="txLeft">' + esc(tx.slice(cut)) + '</span>' : esc(tx)) + '</b>';
}
/* the lists' Tx progress column (Amir, 4 Oct 2026: "I would like to see a column with tx progress as well"): in-house sets
   with the patient's Start and Expected removal get the Treatment section's bar and colours, the percent beside it and
   "Month 4 of 18" under it (the whole line, with the time left, as the tooltip); an in-house set without the dates says so;
   other cases stay empty (treatment dates are only kept for in-house aligners) */
function txCellHTML(c) {
  if (c.type !== 'nla') return '';
  const t = txOf(c, casePool()); if (!t) return '<span class="due none">No tx dates</span>';
  const p = txProgress(t), ph = txPhase(p);
  const sub = p.before ? 'Starts ' + fmtDate(t.start) : p.over ? txText(p, t).replace(' expected removal', ' removal') : 'Month ' + Math.min(p.month, p.ofMonths) + ' of ' + p.ofMonths;
  return '<div class="txCell' + (p.over ? ' over' : '') + '" title="' + esc(txText(p, t)) + '"><span class="txMini' + (ph ? ' ' + ph : '') + '" aria-hidden="true"><i style="width:' + Math.round((p.over ? 1 : p.pct) * 100) + '%"></i></span>' +
    '<b>' + Math.round(p.pct * 100) + '%</b><div class="txSub">' + esc(sub) + '</div></div>';
}
/* the optional Tx cost column (Amir, 4 Oct 2026: "add an optional column for total cost per tx so far"): the patient's total for
   their in-house sets so far — the same estimate as "Patient total" in the case's Aligners box (Dr. A's per-aligner and per-set
   costs from Team & security, over every set with its counts: open and completed) */
function txCost(c) {
  if (c.type !== 'nla') return null;
  const sets = alignerSets(c, casePool()), total = sets.reduce((s, x) => s + x.n, 0), est = total ? alCost(total, sets.length) : null;
  return { sets, total, est };
}
function txCostHTML(c) {
  const x = txCost(c); if (!x) return '';
  if (!histReady(c)) return '<span class="due none">Adding up…</span>';
  if (!x.total) return '<span class="due none">No aligner counts</span>';
  if (x.est == null) return '<span class="due none" title="Dr. A enters the per-aligner cost in Team &amp; security">No cost set</span>';
  const tip = 'Patient total so far: ' + x.sets.map(s => s.l + ' ' + (s.n || '?')).join(' · ') + ' — ' + x.total + ' aligners, est. ' + money(x.est);
  return '<div class="costCell" title="' + esc(tip) + '"><b>' + esc(money(x.est)) + '</b><div class="txSub">' + x.total + ' aligners · ' + x.sets.length + (x.sets.length === 1 ? ' set' : ' sets') + '</div></div>';
}
function costKey(c) { const x = txCost(c); return x && x.est != null ? x.est : null; }
/* for sorting by Tx progress: how far along (past 1 = past the expected removal); null = nothing to sort by */
function txRatio(c) { if (c.type !== 'nla') return null; const t = txOf(c, casePool()); if (!t) return null; const p = txProgress(t); return p.el / p.total; }
function txBoxHTML(c) {
  const pool = casePool(), t = txOf(c, pool);
  if (!t) return '<div class="small muted">Add the patient’s treatment Start and Expected removal with Edit (on the initial set, or on this set while the patient has none) to see where they are in treatment.</div>';
  const p = txProgress(t);
  const marks = alignerSets(c, pool).map(s => { const x = s.me ? c : pool.find(y => y.id === s.id); const d = x && (x.deliveryDate || x.scanDate);
    return d ? { d, l: s.l.replace(/^Refinement /, 'Ref '), me: s.me, full: s.l + (s.me ? ' (this set)' : '') + ' · ' + (x.deliveryDate ? 'delivery ' : 'scanned ') + fmtDate(d) } : null; }).filter(Boolean);
  const mine = t.from === c || (c.id && t.from.id === c.id);
  // a wide graph for the computer, a narrow one for the phone (so the writing stays readable)
  return '<div class="txHead' + (p.over ? ' over' : '') + '">' + esc(txText(p, t)) + '</div>' + txGraphSVG(t, marks, p, 560, 'w') + txGraphSVG(t, marks, p, 360, 'n') +
    '<div class="txEnds"><span>Start <b>' + esc(fmtDate(t.start)) + '</b></span><span>Expected removal <b>' + esc(fmtDate(t.end)) + '</b></span></div>' +
    '<div class="small muted txFrom">' + (mine ? 'Dates saved on this set' : 'Dates from the patient’s ' + (t.from.initial === 'yes' ? 'initial set' : 'earlier set')) + ' — Edit to change them.</div>';
}
function txGraphSVG(t, marks, p, W, cls) {
  const L = 24, R = W - 24, Y = 50, H = 10, r = v => Math.round(v * 10) / 10;
  const s = isoDate(t.start).getTime(), e = isoDate(t.end).getTime(), n = isoDate(todayISO()).getTime(), dd = 864e5;
  // the sets that belong to this treatment (from a little before the start to a year past the end) stretch the scale to fit
  const ins = marks.map(m => isoDate(m.d).getTime()).filter(ms => ms >= s - 45 * dd && ms <= Math.max(e, n) + 365 * dd);
  const lo = Math.min(s, n, ...ins), hi = Math.max(e, n, ...ins), span = Math.max(dd, hi - lo), X = ms => L + (R - L) * (ms - lo) / span;
  const lab = marks.map(m => m.l + ' ' + fmtDate(m.d)).join(', ');
  const ph = txPhase(p);
  let g = '<svg class="txSvg ' + cls + (ph ? ' ' + ph : '') + '" viewBox="0 0 ' + W + ' 86" role="img" aria-label="' + esc(txText(p, t) + '. Start ' + fmtDate(t.start) + ', expected removal ' + fmtDate(t.end) + '.' + (lab ? ' Sets: ' + lab + '.' : '')) + '">';
  // the treatment (grey), done so far (mint; amber, coral, dark red near and past the end — txPhase), with a mark where it was due
  g += '<rect class="bg" x="' + r(X(s)) + '" y="' + Y + '" width="' + r(Math.max(2, X(e) - X(s))) + '" height="' + H + '" rx="5"/>';
  if (n > s) g += '<rect class="fill" x="' + r(X(s)) + '" y="' + Y + '" width="' + r(Math.max(2, X(Math.min(n, e)) - X(s))) + '" height="' + H + '" rx="5"/>';
  if (n > e) g += '<rect class="over" x="' + r(X(e)) + '" y="' + Y + '" width="' + r(Math.max(2, X(n) - X(e))) + '" height="' + H + '" rx="5"/><line class="due" x1="' + r(X(e)) + '" y1="' + (Y - 4) + '" x2="' + r(X(e)) + '" y2="' + (Y + H + 4) + '"/>';
  // today (under the labels, so their halo keeps it from running through them)
  const tx = X(n);
  g += '<line class="today" x1="' + r(tx) + '" y1="18" x2="' + r(tx) + '" y2="' + (Y + H + 4) + '"/>';
  // the first of each month, labelled every k months
  const d0 = new Date(lo), months = []; let d = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
  while (d.getTime() <= hi) { months.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  const k = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor((R - L) / 62))));
  let yr = 0; // the year on the first label and on the first label of each new year
  months.forEach((m, i) => { const x = r(X(m.getTime()));
    g += '<line class="tick" x1="' + x + '" y1="' + (Y + H + 3) + '" x2="' + x + '" y2="' + (Y + H + 7) + '"/>';
    if (i % k === 0) { const y = m.getFullYear(); g += '<text class="mo" x="' + x + '" y="' + (Y + H + 19) + '">' + esc(m.toLocaleDateString(undefined, { month: 'short' }) + (y !== yr ? ' ’' + String(y).slice(2) : '')) + '</text>'; yr = y; } });
  // the patient's sets on the bar, labels in two rows so neighbours don't collide
  let prev = -1e9, row = 0;
  marks.slice().sort((a, b) => a.d < b.d ? -1 : 1).forEach(m => { const ms = isoDate(m.d).getTime(); if (ms < lo || ms > hi) return; const x = X(ms);
    row = x - prev < 50 ? 1 - row : 0; prev = x; const ty = Y - 8 - row * 13, lx = r(Math.min(R - 22, Math.max(L + 22, x)));
    g += '<g class="set"><title>' + esc(m.full || m.l) + '</title><line class="stem" x1="' + r(x) + '" y1="' + (ty + 3) + '" x2="' + r(x) + '" y2="' + (Y - 1) + '"/><circle class="mk' + (m.me ? ' me' : '') + '" cx="' + r(x) + '" cy="' + (Y + H / 2) + '" r="5.5"/>' +
      '<text class="ml" x="' + lx + '" y="' + ty + '">' + esc(m.l) + '</text></g>'; });
  g += '<text class="tl" x="' + r(Math.min(R - 24, Math.max(L + 24, tx))) + '" y="13">Today</text>';
  return g + '</svg>';
}
/* what the case is, as badges under the patient's name: arch treated, appliances, lab, kind of submission, extras */
function caseBadges(c) {
  return (oneArch(c) ? '<span class="badge t-arch">' + esc(treatArchLabel(oneArch(c))) + '</span>' : '') + (c.appliances || []).map(x => '<span class="badge t-appl">' + (x === HAWLEY ? acrylicSw(c.acrylic) : '') + esc(applText(c, x)) + '</span>').join('') +
    (c.lab ? '<span class="badge">' + esc(labName(c.lab)) + '</span>' : '') + (c.initial ? '<span class="badge">' + esc(submissionLabel(c.initial)) + '</span>' : '') + (c.extras || []).map(x => '<span class="badge t-retx">' + esc(x) + '</span>').join('');
}
/* ---------- the case panel's sections: each folds to one line until it's tapped ----------
   Amir, 3 Oct 2026: "all of these headers would be just collapsed and you could be clicking on it to expand it or have an
   option for expand all". Expand all / Collapse all is remembered on this computer (like the hidden columns and the photo
   switch); a section opened or closed by hand stays that way while the case is open (live updates redraw the panel), and
   the next case opens the remembered way again. Folded sections stay in the page, just hidden. */
const DS_KEY = 'nloCases.panelOpen';
function dsAllMode() { if (S.dsAll == null) { try { S.dsAll = localStorage.getItem(DS_KEY) === 'all'; } catch (e) { S.dsAll = false; } } return S.dsAll; }
function dsSetAllMode(on) { S.dsAll = !!on; try { if (on) localStorage.setItem(DS_KEY, 'all'); else localStorage.removeItem(DS_KEY); } catch (e) { } }
function dsIsOpen(k) { return S.dsTog && S.dsTog.has(k) ? S.dsTog.get(k) : dsAllMode(); }
/* `title` is plain text; `sum` (the folded line) and `body` are markup; `act` = a button that works while folded (Copy) */
function dsec(k, title, sum, body, act) {
  const o = dsIsOpen(k);
  return '<section class="ds' + (o ? ' open' : '') + '" data-ds="' + k + '"><div class="dsHd"><button type="button" class="dsTg" data-act="dsTg" aria-expanded="' + o + '" aria-controls="ds-' + k + '">' +
    '<span class="dsCh">' + ic('next', 16) + '</span><span class="dsT">' + esc(title) + '</span><span class="dsS" id="dsS-' + k + '">' + (sum || '') + '</span></button>' + (act || '') + '</div>' +
    '<div class="dsBd" id="ds-' + k + '"' + (o ? '' : ' hidden') + '>' + body + '</div></section>';
}
/* a one-line section with nothing to open, just its button (the retainer label) */
function dline(k, title, sum, act, id) {
  return '<section class="ds line" data-ds="' + k + '"' + (id ? ' id="' + id + '"' : '') + '><div class="dsHd"><div class="dsTg"><span class="dsCh"></span><span class="dsT">' + esc(title) + '</span><span class="dsS">' + sum + '</span></div>' + act + '</div></section>';
}
function dsShow(sec, on) {
  sec.classList.toggle('open', on); const b = $('.dsTg', sec), bd = $('.dsBd', sec);
  if (b) b.setAttribute('aria-expanded', String(on)); if (bd) bd.hidden = !on;
}
/* the header button says what it will do: Expand all unless every section is already open */
function dsAllSync() {
  const d = $('#drawer'), b = d && $('.dAll', d); if (!b) return;
  const secs = $$('.ds:not(.line)', d), all = secs.length > 0 && secs.every(s => s.classList.contains('open'));
  b.innerHTML = ic(all ? 'collapse' : 'expand', 16) + '<span class="t">' + (all ? 'Collapse all' : 'Expand all') + '</span>';
  b.dataset.all = all ? '1' : '0'; b.setAttribute('aria-label', all ? 'Collapse all sections' : 'Expand all sections');
}
/* opening a section near the bottom scrolls just enough to show it (never past its heading) */
function dsReveal(sec) {
  const bd = sec.closest('.dBd'); if (!bd) return;
  const r = sec.getBoundingClientRect(), b = bd.getBoundingClientRect();
  if (r.bottom > b.bottom) bd.scrollTop += Math.min(r.bottom - b.bottom + 12, r.top - b.top - 8);
}
/* folded heading of the MARPE box: what's still missing, and the Zoom call */
function marpeSum(c) {
  const miss = recordsMissing(c);
  return (miss.length ? 'Needs ' + esc(miss.map(x => x[2]).join(' + ')) : 'Records on file') + ' · Zoom ' + (c.zoomDate ? '<b>' + esc(fmtDay(c.zoomDate) + (c.zoomTime ? ', ' + fmtTime(c.zoomTime) : '')) + '</b>' : 'not set');
}
/* ---------- MARPE: records on file and the Zoom call (drawer box, the check before a stage move, the Zoom date) ---------- */
function marpeBoxHTML(c, done) {
  const r = c.records || [], x = dueOf(c), dis = done ? ' disabled' : '';
  const when = c.zoomDate ? '<b>' + esc(fmtDay(c.zoomDate)) + (c.zoomTime ? ' · ' + esc(fmtTime(c.zoomTime)) : '') + '</b>' : '<span class="muted">Not set yet</span>';
  return '<div id="mpBox"><div class="mpGrid">' +
    '<div class="mpK">Records on file</div><div class="mpV">' + MARPE_RECORDS.map(([k, l]) =>
      '<button type="button" class="pick sm" data-act="rec" data-k="' + k + '" aria-pressed="' + r.includes(k) + '"' + dis + '>' + esc(l) + '</button>').join('') + '</div>' +
    '<div class="mpK">Zoom call</div><div class="mpV"><span class="mpWhen">' + ic('video', 16) + when + '</span>' + (x && x.k === 'zoom' && !done ? dueChip(c) : '') +
      (done ? '' : '<button type="button" class="btn btn-sec btn-sm" data-act="zoomSet">' + (c.zoomDate ? 'Change' : 'Set the date') + '</button>') + '</div></div>' +
    (recordsMissing(c).length && stageIndex(c) <= 0 && !done ? '<div class="small muted mpHint">Both have to be on file before it moves to Submitted to lab.</div>' : '') + '</div>';
}
/* before a stage move goes through, ask for what it needs (see stageNeeds); `extra` = fields already collected */
function stageGateModal(c, to, needs, extra) {
  const lbl = (flowOf(c).stages.find(s => s[0] === to) || [0, to])[1], r = extra.records || c.records || [], one = oneArch(c);
  openModal('<h3>' + esc(lbl) + '</h3><div class="lsub">' + esc((c.patient || '') + ' · ' + typeOf(c).l) + '</div>' +
    (needs.includes('records') ? '<div class="gate" id="gRecs"><b>Before it goes to the lab, both have to be on file:</b>' + MARPE_RECORDS.map(([k, l]) =>
      '<label class="gateRow"><input type="checkbox" data-rec="' + k + '"' + (r.includes(k) ? ' checked' : '') + '>' + esc(l) + '</label>').join('') + '</div>' : '') +
    (needs.includes('zoom') ? '<div class="gate"><b>When is the Zoom call?</b><div class="zoomRow"><div class="field"><label for="gZoomDate">Date</label><input type="date" id="gZoomDate"></div>' +
      '<div class="field"><label for="gZoomTime">Time</label><input type="time" id="gZoomTime"></div></div></div>' : '') +
    // in-house: the aligners in this set (from Titan) and any attachment templates, as it reaches TxP approved (or Export STLs)
    // (one arch only: just that arch's count, and the template answers that fit it)
    (needs.includes('aligners') ? '<div class="gate" id="gAl"><b>How many aligners in this set? <span class="h5n">from Titan' + (one ? ' · ' + esc(treatArchLabel(one).toLowerCase()) : '') + '</span></b><div class="alRow">' +
      (one === 'L' ? '' : '<div class="field"><label for="gAlU">Upper aligners</label><input id="gAlU" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="0" value="' + esc(c.alU || '') + '"></div>') +
      (one === 'U' ? '' : '<div class="field"><label for="gAlL">Lower aligners</label><input id="gAlL" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="0" value="' + esc(c.alL || '') + '"></div>') + '</div>' +
      '<b style="margin-top:6px">Any attachment templates?</b>' + pickRow('gAt', atOptsFor(one), atFor(c.atTemplates, one), false) + '</div>' : '') +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-pri" type="button" id="gGo">Move to “' + esc(lbl) + '”</button></div>', w => {
      const go = $('#gGo', w), zd = $('#gZoomDate', w), al = $('#gAl', w);
      const n = id => { const el = $(id, w); return el ? Math.min(99, Math.max(0, parseInt(el.value, 10) || 0)) : 0; }; // (an untreated arch has no field)
      const atV = () => (($('.pickRow[data-g=gAt] .pick[aria-pressed=true]', w) || {}).dataset || {}).v || '';
      const ok = () => $$('input[data-rec]', w).every(i => i.checked) && (!zd || !!zd.value) && (!al || (n('#gAlU') + n('#gAlL') > 0 && !!atV()));
      const sync = () => { go.disabled = !ok(); };
      w.addEventListener('change', sync); w.addEventListener('input', sync);
      w.addEventListener('click', e => { const b = e.target.closest('.pickRow[data-g=gAt] .pick'); if (!b) return; $$('.pickRow[data-g=gAt] .pick', w).forEach(x => x.setAttribute('aria-pressed', String(x === b))); sync(); });
      sync();
      go.onclick = () => {
        if (!ok()) return; const add = Object.assign({}, extra);
        if ($('#gRecs', w)) add.records = MARPE_RECORDS.map(x => x[0]);
        if (zd) { add.zoomDate = zd.value; add.zoomTime = $('#gZoomTime', w).value || ''; }
        if (al) { const u = n('#gAlU'), l = n('#gAlL'); add.alU = u || ''; add.alL = l || ''; add.aligners = u + l || ''; add.atTemplates = atV(); }
        closeModal(); moveStage(c.id, to, add, needs);
      };
    });
}
/* set or change the Zoom call; before that step, saving also moves the case to "Zoom call scheduled" */
function zoomModal(c) {
  const keys = flowOf(c).stages.map(s => s[0]), before = keys.indexOf(c.stage) < keys.indexOf('zoom');
  openModal('<h3>Zoom call</h3><div class="lsub">' + esc((c.patient || '') + ' · ' + typeOf(c).l) + '</div>' +
    '<div class="zoomRow"><div class="field"><label for="zmDate">Date</label><input type="date" id="zmDate" value="' + esc(c.zoomDate || '') + '"></div>' +
    '<div class="field"><label for="zmTime">Time</label><input type="time" id="zmTime" value="' + esc(c.zoomTime || '') + '"></div></div>' +
    (before ? '<div class="small muted" style="margin:-4px 0 12px">Saving moves the case to “Zoom call scheduled”.</div>' : '') +
    '<div class="mFt">' + (c.zoomDate ? '<button class="btn btn-ghost" type="button" id="zmClear" style="margin-right:auto">Clear the date</button>' : '') +
    '<button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-pri" type="button" id="zmSave">Save</button></div>', w => {
      const d = $('#zmDate', w), save = $('#zmSave', w), sync = () => { save.disabled = !d.value; };
      d.addEventListener('input', sync); d.addEventListener('change', sync); sync();
      save.onclick = () => {
        const z = { zoomDate: d.value, zoomTime: $('#zmTime', w).value || '' }; if (!z.zoomDate) return; closeModal();
        if (before) moveStage(c.id, 'zoom', z);
        else act(() => B.mutateCase(c.id, x => { Object.assign(x, z); }, { a: 'edit', fields: ['zoomDate', 'zoomTime'] }), 'Zoom call set for ' + fmtDay(z.zoomDate) + (z.zoomTime ? ', ' + fmtTime(z.zoomTime) : ''));
      };
      const clr = $('#zmClear', w);
      if (clr) clr.onclick = () => { closeModal(); act(() => B.mutateCase(c.id, x => { x.zoomDate = ''; x.zoomTime = ''; }, { a: 'edit', fields: ['zoomDate', 'zoomTime'] }), 'Zoom call date cleared'); };
    });
}
function isOldMarpe(c) { return c.type === 'appliance' && ((c.appliances || []).includes('MARPE') || /\bmarpe\b/i.test(c.detail || '')); }
/* an older appliance case that is a MARPE: same case, MARPE steps (its step carried over by name: Manufacturing → Design approved…) */
function toMarpe(c) {
  const to = stageFromSection('marpe', stageLabel(c));
  act(() => B.mutateCase(c.id, d => {
    d.type = 'marpe'; d.stage = to; d.appliances = (d.appliances || []).filter(a => a !== 'MARPE'); if (!d.lab) d.lab = LAB_PART;
  }, { a: 'edit', fields: ['type', 'stage'] }), 'Moved to the MARPE steps (' + FLOWS.marpe.stages.find(s => s[0] === to)[1] + ')');
}
/* tick a MARPE record on or off right from the case */
function toggleRecord(btn) {
  const c = findCase(S.openId); if (!c || c.status === 'done') return;
  const k = btn.dataset.k, on = btn.getAttribute('aria-pressed') !== 'true', prev = c.records, cid = c.id;
  const next = recs => { const r = (recs || []).filter(x => x !== k); if (on) r.push(k); const out = MARPE_RECORDS.map(x => x[0]).filter(x => r.includes(x)); return out.length ? out : ''; };
  btn.setAttribute('aria-pressed', String(on)); c.records = next(c.records); queueRender();
  B.mutateCase(cid, d => { d.records = next(d.records); }, { a: 'edit', fields: ['records'] })
    .catch(e => { const cur = findCase(cid); if (cur) { cur.records = prev; queueRender(); if (S.openId === cid) renderDrawer(); } toast(errText(e), { bad: true }); });
}
/* ---------- IPR & spacing: one section, the IPR Tracker's chart for the case's chart # ----------
   Amir, 3 Oct 2026: the typed "IPR & spacing" and "From the IPR Tracker" were the same thing twice, and the IPR Tracker's
   printed diagram says it better than words. Open aligner cases read the IPR Tracker live (its latest visit) and draw it
   (iprPanelsHTML in ipr.js). The IPR note saved on the case (New case's "Get from IPR Tracker", "Add to the chart note"
   here, or text from Tally/Asana) is what the chart note uses; it shows as text only when there's no live chart to show,
   or folded away as "an earlier IPR note" when it differs from the latest visit. */
function iprLive(c) { return !!(typeOf(c).aligner && c.status !== 'done'); }
function iprRead(c) {
  if (!iprLive(c)) return { k: 'off' };
  if (!c.chart) return { k: 'chart' };
  const L = iprLink(); if (!L.init()) return { k: 'unavail' };
  if (!L.user()) return { k: 'connect' };
  const r = (S.iprCache || {})[IPR.norm(c.chart)];
  if (!r) return { k: 'loading' };
  if (r.error) return { k: 'error', r };
  if (r.status === 'not-found') return { k: 'none' };
  if (r.status === 'no-visits') return { k: 'novisits' };
  return { k: 'ok', r };
}
/* the section's folded line */
function iprSumHTML(c) {
  const x = iprRead(c), saved = String(c.ipr || '').trim(), m = s => '<span class="muted">' + s + '</span>';
  const savedLine = saved ? esc(saved.replace(/\s*\n+\s*/g, ' · ')) : '';
  switch (x.k) {
    case 'ok': return esc(iprSumText(x.r));
    case 'chart': return savedLine || m('Add the chart # to show the IPR Tracker’s chart');
    case 'connect': return savedLine || m('Connect the IPR Tracker on this computer');
    case 'loading': return m('Reading the IPR Tracker…');
    case 'error': return m(esc(x.r.error));
    case 'none': return m('No IPR Tracker patient with chart # ' + esc(c.chart));
    case 'novisits': return m('No IPR Tracker visits yet');
    default: return savedLine || m('—');
  }
}
function iprBoxHTML(c) {
  const x = iprRead(c), saved = String(c.ipr || '').trim();
  const savedBox = saved ? '<div class="iprSaved"><div class="k">IPR note saved on the case <span>(used in the chart note)</span></div><div class="txt">' + esc(saved) + '</div></div>' : '';
  const open = '<a class="btn btn-ghost" href="' + IPR_URL + '" target="_blank" rel="noopener">' + ic('ext', 14) + 'Open IPR Tracker</a>';
  const msg = (t, plain) => '<div class="small' + (plain ? '' : ' muted') + ' iprMsg">' + t + '</div>';
  switch (x.k) {
    case 'off': return savedBox;
    case 'chart': return msg('Add the chart # (Edit) to show the IPR Tracker’s chart here.') + savedBox;
    case 'unavail': return msg('IPR link unavailable in this browser.') + savedBox;
    case 'connect': return msg('Connect this computer to the IPR Tracker once (same Google sign-in as the IPR Tracker).', 1) + '<div class="iprFoot"><button class="btn btn-sec btn-sm" data-act="iprConnect">Connect IPR Tracker</button>' + open + '</div>' + savedBox;
    case 'loading': return msg('Reading the IPR Tracker…') + savedBox;
    case 'error': return '<div class="small iprMsg" style="color:var(--coral-700)">' + esc(x.r.error) + '</div><div class="iprFoot"><button class="btn btn-ghost" data-act="iprRefresh">' + ic('refresh', 14) + 'Try again</button>' + open + '</div>' + savedBox;
    case 'none': return msg('No IPR Tracker patient with chart # ' + esc(c.chart) + '.') + '<div class="iprFoot">' + open + '</div>' + savedBox;
    case 'novisits': return msg('Patient found, but no visits recorded yet.') + '<div class="iprFoot">' + open + '</div>' + savedBox;
  }
  const r = x.r, same = saved === r.note.trim();
  return '<div class="iprMeta">Latest visit <b>' + esc(fmtDay(r.date)) + '</b>' + (r.assistant ? ' · ' + esc(r.assistant) : '') + ' · ' + r.visits + ' visit' + (r.visits === 1 ? '' : 's') + ' on file</div>' +
    iprPanelsHTML(r.d) +
    '<div class="iprFoot">' + (same ? '<span class="stat ok">' + ic('done', 14) + 'In the chart note</span>' : '<button class="btn btn-sec btn-sm" data-act="iprUse">' + (saved ? 'Use this visit in the chart note' : 'Add to the chart note') + '</button>') +
    '<button class="btn btn-ghost" data-act="iprRefresh">' + ic('refresh', 14) + 'Refresh</button>' + open + '</div>' +
    (saved && !same ? '<details class="iprOld"><summary>The chart note has an earlier IPR note</summary><div class="txt">' + esc(saved) + '</div></details>' : '');
}
/* redraw the IPR section (its folded line too) once the IPR Tracker answers */
function iprPaint(c) { const b = $('#iprBox'), s = $('#dsS-ipr'); if (b) b.innerHTML = iprBoxHTML(c); if (s) s.innerHTML = iprSumHTML(c); }
async function iprAutoLoad(c, force) {
  const L = iprLink(); if (!L.init()) return;
  if (!L.user()) { await L.waitUser(); if (!L.user()) return; }
  const k = IPR.norm(c.chart); S.iprCache = S.iprCache || {};
  const paint = () => { const cur = findCase(S.openId); if (cur && IPR.norm(cur.chart) === k) iprPaint(cur); };
  if (S.iprCache[k] && !force) { paint(); return; }
  if (S.iprLoading === k) return; S.iprLoading = k;
  paint(); // "Reading the IPR Tracker…" (it said Connect until the sign-in came back)
  try { S.iprCache[k] = await L.latest(c.chart); }
  catch (e) { S.iprCache[k] = { error: /permission|denied/i.test(String(e && (e.code || e.message))) ? 'This Google account can’t read the IPR Tracker.' : 'Couldn’t reach the IPR Tracker.' }; }
  S.iprLoading = null;
  paint();
}

/* ---------- modals ---------- */
function openModal(html, onReady) {
  closeModal();
  const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  // a stray click outside a case form must not throw away what was tapped in
  w.addEventListener('mousedown', e => { if (e.target === w && !w.querySelector('#ncForm')) closeModal(); });
  document.body.appendChild(w);
  const f = $('input:not([type=hidden]),select,textarea', w); if (f) f.focus();
  if (onReady) onReady(w);
  return w;
}
function closeModal() { const w = $('#modalWrap'); if (w) w.remove(); }
/* text is plain text (escaped here), never HTML */
/* danger: true = a red button; 'mint' = the brand mint (Mark complete, like everywhere else) */
function confirmBox(title, text, okLabel, danger, noLabel) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="lsub" style="font-size:13.5px;color:var(--grey-600)">' + esc(text) + '</p><div class="mFt"><button class="btn btn-sec" id="cbNo">' + esc(noLabel || 'Cancel') + '</button><button class="btn ' + (danger === 'mint' ? 'btn-mint' : danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel) + '</button></div>', w => {
      $('#cbNo', w).onclick = () => { closeModal(); res(false); }; $('#cbYes', w).onclick = () => { closeModal(); res(true); }; $('#cbYes', w).focus();
    });
  });
}
/* New case / edit form: fill the IPR box from the IPR Tracker using the chart # */
async function iprPull(btn) {
  const root = btn.closest('.modal') || $('#drawer'); const msg = $('#cf-iprMsg', root);
  const chart = ($('#cf-chart', root).value || '').trim();
  if (!chart) { msg.textContent = 'Enter the chart # first.'; return; }
  const L = iprLink(); if (!L.init()) { msg.textContent = 'IPR link unavailable in this browser.'; return; }
  try {
    if (!L.user()) await L.connect();
    msg.textContent = 'Reading the IPR Tracker…';
    const r = await L.latest(chart);
    if (r.status === 'not-found') { msg.textContent = 'No IPR Tracker patient with chart # ' + chart + '.'; return; }
    if (r.status === 'no-visits') { msg.textContent = 'Patient found, but no visits recorded yet.'; return; }
    $('#cf-ipr', root).value = r.note; msg.textContent = 'From the visit on ' + fmtDay(r.date) + (r.initials ? ' (' + r.initials + ')' : '') + '.';
  } catch (e) { msg.textContent = /popup/i.test(String(e && (e.code || e.message))) ? 'Allow pop-ups for this site, then try again.' : /permission|denied/i.test(String(e && (e.code || e.message))) ? 'This Google account can’t read the IPR Tracker.' : 'Couldn’t reach the IPR Tracker.'; }
}

/* ---------- saved versions (owner) ---------- */
async function versionsModal(id) {
  openModal('<h3>Saved versions</h3><div class="lsub">Every change keeps the copy it replaced. Restoring makes that copy current again (and keeps today’s too).</div><div id="verList"><div class="small muted">Loading…</div></div><div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button></div>');
  try {
    const list = await B.caseVersions(id); S.verList = list; S.verId = id;
    const how = { stage: 'moved', comment: 'commented', edit: 'edited', close: 'completed', reopen: 'reopened', assign: 'reassigned', restore: 'restored', save: 'saved', rekey: 'key change', delete: 'deleted', photo: 'photo changed', email: 'lab email' };
    $('#verList').innerHTML = list.length ? '<div class="tblWrap"><table class="tbl"><thead><tr><th>Version</th><th>Contents</th><th></th></tr></thead><tbody>' + list.map((v, i) =>
      '<tr><td class="small"><b>#' + v.rev + '</b><div class="muted">replaced ' + esc(fmtWhen(v.replacedAt)) + '<br>by ' + esc(firstName(staffName(v.replacedBy, v.replacedBy))) + (v.replacedHow ? ' (' + esc(how[v.replacedHow] || v.replacedHow) + ')' : '') + '</div></td>' +
      '<td class="small">' + (v.data ? '<b>' + esc(v.data.patient || '') + '</b><div class="muted">' + esc(typeOf(v.data).l + ' · ' + stageLabel(v.data) + (dueDateOf(v.data) ? ' · ' + fmtDate(dueDateOf(v.data)) : '')) + '</div>' : '<span style="color:var(--coral-700)">Can’t be read</span>') + '</td>' +
      '<td style="text-align:right">' + (v.data ? '<button class="btn btn-sec btn-sm" data-act="restoreVer" data-i="' + i + '">Restore</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="small muted">No earlier versions yet.</div>';
  } catch (x) { $('#verList').innerHTML = '<div class="lockErr">' + esc(errText(x)) + '</div>'; }
}
async function restoreVer(i) {
  const v = S.verList && S.verList[i]; if (!v || !v.data) return;
  try { await B.restoreVersion(S.verId, v.data); closeModal(); toast('Version #' + v.rev + ' restored'); if (S.openId === S.verId) { const c = findCase(S.verId); if (c) { c.locked = false; } loadHistory(S.verId); } }
  catch (x) { toast(errText(x), { bad: true }); }
}

/* ---------- actions ---------- */
/* copy text for pasting elsewhere (falls back to the older copy command if the clipboard API is blocked) */
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { }
  try {
    const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(errText(e), { bad: true }); } }
function nextStage(c) { const st = caseStages(c); const i = stageIndex(c); return i >= 0 && i < st.length - 1 ? st[i + 1][0] : null; }
/* `extra` = fields saved with the move (e.g. MARPE records, the Zoom call, aligner counts); a move that still needs something
   asks first; `asked` = what the asking window already collected */
async function moveStage(id, to, extra, asked) {
  const c = findCase(id); if (!c || c.stage === to) return;
  extra = extra || {};
  const needs = stageNeeds(Object.assign({}, c, extra), to).filter(x => !(asked || []).includes(x));
  if (needs.length) { stageGateModal(c, to, needs, extra); return; }
  const end = shipEnd(c), keys = flowOf(c).stages.map(s => s[0]);
  if (end && keys.indexOf(to) >= keys.indexOf(end)) return shipDone(c, end, extra);
  const from = c.stage, fields = Object.keys(extra), before = {}; fields.forEach(k => { before[k] = c[k]; });
  c.stage = to; Object.assign(c, extra); queueRender(); if (S.openId === id) renderDrawer();
  S.pend = S.pend || {}; const mine = S.pend[id] = { to, extra };
  try { await B.mutateCase(id, d => { d.stage = to; Object.assign(d, extra); }, Object.assign({ a: 'stage', from, to }, fields.length ? { fields } : {})); }
  catch (e) { const cur = findCase(id); if (cur && S.pend[id] === mine) { cur.stage = from; Object.assign(cur, before); queueRender(); if (S.openId === id) renderDrawer(); } toast(errText(e), { bad: true }); return; }
  finally { if (S.pend[id] === mine) delete S.pend[id]; }
  // the open case's history (and the Specialty warranty that counts from the day it shipped) shows the move
  if (S.openId === id && !S.editing) loadHistory(id);
  if (isLastStage(c, to)) offerComplete(id);
}
/* a case that reaches its last step is asked about once, by whoever moved it there (Amir, 3 Oct 2026: "when a case reaches the
   last checklist then user should get a prompt to move it to complete. like if you mark the case as checked in milestones …
   this is true for all the appliances") — every kind of case; "Not yet" leaves it at that step (✓ on its card or Mark complete
   later). A case shipped to the patient is already completed when it ships, so it isn't asked. */
function isLastStage(c, k) { const st = caseStages(c); return !!st.length && st[st.length - 1][0] === k; }
function offerComplete(id) {
  const c = findCase(id); if (!c || c.status === 'done' || c.stage !== caseStages(c).slice(-1)[0][0]) return;
  confirmBox('Mark this case complete?', (c.patient || 'This case') + ' is at its last step, ' + stageLabel(c) + '. Move it to Completed now? You can undo right after, or reopen it later.', 'Mark complete', 'mint', 'Not yet')
    .then(ok => { if (ok) completeCase(id); });
}
/* shipped to the patient = complete (Amir, 3 Oct 2026): one save moves it to its last step and completes it; Undo puts
   the step back and reopens it */
async function shipDone(c, end, extra) {
  const id = c.id, from = c.stage, fields = Object.keys(extra || {});
  try {
    await B.mutateCase(id, d => { d.stage = end; Object.assign(d, extra || {}); return 'done'; }, Object.assign({ a: 'stage', from, to: end, close: 1 }, fields.length ? { fields } : {}));
    if (S.hist) S.hist.unshift(Object.assign({}, c, extra || {}, { stage: end, status: 'done', closedAt: Date.now() }));
    if (S.openId === id) closeDrawer(true);
    S.closedLoaded = false;
    toast((c.patient || 'Case') + ' shipped to the patient — case complete', { action: 'Undo', onAction: () => act(() => B.mutateCase(id, d => { d.stage = from; return 'open'; }, { a: 'reopen' }), 'Reopened') });
  } catch (e) { toast(errText(e), { bad: true }); }
}
async function completeCase(id) {
  const c = findCase(id); if (!c) return;
  try {
    await B.mutateCase(id, () => 'done', { a: 'close' });
    if (S.hist) S.hist.unshift(Object.assign({}, c, { status: 'done', closedAt: Date.now() }));
    if (S.openId === id) closeDrawer(true);
    S.closedLoaded = false;
    toast((c.patient || 'Case') + ' marked complete', { action: 'Undo', onAction: () => act(() => B.mutateCase(id, () => 'open', { a: 'reopen' }), 'Reopened') });
  } catch (e) { toast(errText(e), { bad: true }); }
}
function onClick(e) {
  // a click anywhere outside the Columns menu closes it
  if (S.colMenu && !e.target.closest('.colWrap')) { S.colMenu = false; const m = $('.colMenu'); if (m) { const w = m.closest('.colWrap'); m.remove(); const bt = $('.colBtn', w); if (bt) bt.setAttribute('aria-expanded', 'false'); } }
  // … and outside the Assign to list closes that
  if (S.asg && !e.target.closest('#asgMenu') && !e.target.closest('[data-act=asgPick]')) asgClose();
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act; const id = t.dataset.id;
  if (t.tagName === 'SELECT') return;
  if (a === 'advance' || a === 'complete') { e.stopPropagation(); }
  switch (a) {
    case 'nav': S.view = t.dataset.v; if (S.view !== 'list') S.f = noFilters(); renderNav(); renderView(); window.scrollTo(0, 0); break;
    case 'tile': { const f = t.dataset.f; S.f = noFilters();
      if (f === 'mine') { S.view = 'mine'; } else { S.view = 'list'; if (['over', 'week', 'none'].includes(f)) S.f.due = f; else S.f.grp = f; }
      renderNav(); renderView(); break; }
    case 'flow': S.boardFlow = t.dataset.k; renderView(); break;
    case 'asgPick': asgOpen(t); break;
    case 'asgSet': asgSet(t.dataset.v || ''); break;
    case 'open': openDrawer(id); break;
    case 'openClosed': openDrawer(id); break;
    case 'closeDrawer': closeDrawer(); break;
    case 'dsTg': { const sec = t.closest('.ds'); if (!sec) break; const on = !sec.classList.contains('open'); dsShow(sec, on); (S.dsTog = S.dsTog || new Map()).set(sec.dataset.ds, on); dsAllSync(); if (on) dsReveal(sec); break; }
    case 'dsAll': { const on = t.dataset.all !== '1'; dsSetAllMode(on); S.dsTog = new Map(); $$('#drawer .ds:not(.line)').forEach(sec => dsShow(sec, on)); dsAllSync(); break; }
    case 'advance': { const c = findCase(id); const n = c && nextStage(c); if (n) moveStage(id, n); break; }
    case 'complete': completeCase(id); break;
    case 'setStage': moveStage(S.openId, t.dataset.k); break;
    case 'labels': { const c = findCase(S.openId); if (c && alN(c)) labelsModal(c); break; }
    case 'retLabels': { const c = findCase(S.openId); if (c && c.type === 'retainer') retLabelsModal(c); break; }
    case 'rec': toggleRecord(t); break;
    case 'copyNote': { const c = findCase(S.openId); if (!c) break; const v = noteVisitOf(c);
      copyText(chartNote(c, v)).then(ok => toast(ok ? 'Chart note copied (' + noteVisitName(c, v).toLowerCase() + ') — paste it into the patient’s chart' : 'Couldn’t copy — select the note and copy it', ok ? {} : { bad: true })); break; }
    case 'noteVisit': { const c = findCase(S.openId); if (!c) break; (S.noteVisit = S.noteVisit || new Map()).set(c.id, t.dataset.v === 'del' ? 'del' : 'scan'); noteRefresh(); break; }
    case 'niGo': { const k = t.dataset.nk; closeDrawer(); if (S.openId) break; S.view = 'admin'; (S.niOpen = S.niOpen || new Set()).add(k); renderNav(); renderView();
      const r = $('#niRow-' + k); if (r) { r.scrollIntoView({ block: 'center' }); const box = $('textarea', r); if (box) box.focus({ preventScroll: true }); } break; }
    case 'clearHold': { const cid = S.openId; act(() => B.mutateCase(cid, d => { if (!d.labHold) return 'skip'; d.labHoldSeen = (d.labHold.date || '') + '|' + (d.labHold.reason || ''); d.labHold = ''; }, { a: 'edit', fields: ['labHold'] }), 'Lab hold cleared'); break; }
    case 'toMarpe': { const c = findCase(S.openId); if (c && isOldMarpe(c)) toMarpe(c); break; }
    case 'zoomSet': { const c = findCase(S.openId); if (c) zoomModal(c); break; }
    case 'shipF': S.f.ship = S.f.ship ? '' : '1'; renderView(); break;
    case 'track': break; // the link itself opens the carrier's page in a new tab (and doesn't open the case)
    case 'portal': { const c = findCase(S.openId); // the link itself opens the portal in a new tab
      if (c && c.patient) copyText(c.patient).then(ok => toast(ok ? 'Copied “' + c.patient + '” — paste it in the portal’s search' : 'Couldn’t copy the name — type it in the portal', ok ? {} : { bad: true })); break; }
    case 'reopen': act(async () => { await B.mutateCase(S.openId, () => 'open', { a: 'reopen' }); S.closed = S.closed.filter(c => c.id !== S.openId); closeDrawer(true); }, 'Reopened'); break;
    case 'assignTo': { const to = t.dataset.v || '', id = S.openId, c = findCase(id); if (!c || (c.assignee || '') === to) break;
      $$('#drawer .dAssign .aTile').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
      act(() => B.mutateCase(id, d => { d.assignee = to; if (to) d.assigneeName = ''; }, { a: 'assign', to }), to ? 'Assigned to ' + staffName(to) : 'Unassigned'); break; }
    case 'addCmt': { const txt = ($('#cmtText').value || '').trim(); if (!txt) return; const cid = S.openId;
      $('#cmtText').value = ''; act(() => B.mutateCase(cid, d => { d.comments = (d.comments || []).concat([{ id: uid8(), at: Date.now(), by: meSid(), text: txt }]); }, { a: 'comment' })); break; }
    // (a lab saved under its old name counts as its new name, so opening Edit doesn't look like a change)
    case 'edit': { const c = findCase(S.openId); S.editBase = JSON.parse(JSON.stringify(c)); if (S.editBase.lab) S.editBase.lab = labName(S.editBase.lab); S.editing = true; renderDrawer(); break; }
    case 'cancelEdit': S.editing = false; renderDrawer(); break;
    case 'saveEdit': saveEdit(); break;
    case 'delCase': (async () => { const c = findCase(S.openId); if (await confirmBox('Delete this case?', 'This removes ' + c.patient + ' from every list. Dr. A can bring it back from Team & security for 90 days. To finish a case normally, use “Mark complete” instead.', 'Delete', true)) { const cid = S.openId; closeDrawer(true); act(() => B.deleteCase(cid), 'Case deleted'); } })(); break;
    case 'newCase': newCaseModal(); break;
    case 'tourOpen': tourOpen(); break;
    case 'tourLater': tourOffered(); renderView(); toast('You can take the tour any time from My account'); break;
    case 'closeModal': closeModal(); break;
    case 'clearF': S.f = noFilters(); renderView(); break;
    case 'colMenu': S.colMenu = !S.colMenu; renderView(); break;
    case 'hideCol': { const k = t.dataset.k, l = colLabel(k); e.stopPropagation(); setColHidden(k, true); renderView();
      toast('“' + l + '” column hidden — bring it back from Columns', { action: 'Undo', onAction: () => { setColHidden(k, false); renderView(); } }); break; }
    case 'showCols': { const h = hiddenCols(); Array.from(h).filter(k => !OPTIONAL_COLS.includes(k)).forEach(k => h.delete(k)); setColHidden('', false); S.colMenu = false; renderView(); break; }
    case 'oldDone': bulkComplete(oldTicked()); break;
    case 'oldDel': bulkDelete(oldTicked()); break;
    case 'oldAll': case 'oldNone': { const on = a === 'oldAll'; $$('#cleanCard input[data-old]').forEach(i => { i.checked = on; if (on) S.oldOff.delete(i.dataset.old); else S.oldOff.add(i.dataset.old); }); syncOld(); break; }
    case 'clearGrp': S.f.grp = ''; renderView(); break;
    case 'sort': { const k = t.dataset.k; S.sort = { k, dir: sortShown() === k ? -S.sort.dir : 1 }; renderView(); break; }
    case 'moreClosed': S.closedDays = S.closedDays < 365 ? 365 : 3650; S.closedLoaded = false; renderView(); break;
    case 'lock': lockOut('Locked. Sign in to continue.'); break;
    case 'lockSignOut': B.signOut().then(() => lockScreen('login')); break;
    case 'forgot': lockScreen('forgot'); break;
    case 'toLogin': lockScreen('login'); break;
    case 'copyCode': navigator.clipboard && navigator.clipboard.writeText(t.dataset.code).then(() => toast('Copied')); break;
    case 'printCode': printCode(); break;
    case 'codeDone': enterApp(); break;
    case 'resendVerify': B.resendVerify().then(() => toast('Sent again')).catch(x => toast(errText(x), { bad: true })); break;
    case 'versions': versionsModal(S.openId); break;
    case 'iprConnect': iprLink().connect().then(() => { const c = findCase(S.openId); if (c) { iprPaint(c); if (c.chart) iprAutoLoad(c, true); } if (S.view === 'account') renderView(); }).catch(x => toast(errText(x), { bad: true })); break;
    case 'iprDisconnect': iprLink().disconnect().then(() => { S.iprCache = {}; renderView(); toast('IPR Tracker disconnected on this computer'); }); break;
    case 'iprRefresh': { const c = findCase(S.openId); if (c) { (S.iprCache || {})[IPR.norm(c.chart)] = null; iprPaint(c); iprAutoLoad(c, true); } break; }
    case 'iprUse': { const c = findCase(S.openId); const r = c && (S.iprCache || {})[IPR.norm(c.chart)]; if (!r || !r.note) return;
      act(() => B.mutateCase(c.id, d => { d.ipr = r.note; }, { a: 'edit', fields: ['ipr'] }), 'IPR note added to the chart note'); break; }
    case 'iprPull': iprPull(t); break;
    case 'restoreVer': restoreVer(Number(t.dataset.i)); break;
    default: if (ADMIN_ACTS[a]) ADMIN_ACTS[a](t, e);
  }
}
function onChange(e) {
  const t = e.target;
  if (t.classList && t.classList.contains('mlSel')) { const x = MAILS.list.find(g => g.id === t.dataset.g); if (x) { MAILS.pick[x.id] = t.value; const b = $('[data-act=mailApply][data-g="' + CSS.escape(x.id) + '"]'); if (b) b.disabled = !t.value;
    const ph = $('[data-mlph="' + CSS.escape(x.id) + '"]'); if (ph) { ph.innerHTML = ptAv(t.value ? findCase(t.value) : null, 32); phPaint(); } } return; }
  if (t.matches && t.matches('input[data-old]')) { if (t.checked) S.oldOff.delete(t.dataset.old); else S.oldOff.add(t.dataset.old); syncOld(); return; }
  if (t.id === 'oldMonths') { S.oldMonths = Number(t.value) || 3; S.oldOff.clear(); renderView(); return; }
  if (t.id === 'oldNoDate') { S.oldNoDate = t.checked; renderView(); return; }
  if (t.dataset.col) { setColHidden(t.dataset.col, !t.checked); S.colMenu = true; renderView(); return; }
  if (t.dataset.f === 'delDay') { S.f.delDay = t.value; const lb = $('#listBody'); if (lb) { lb.innerHTML = listBodyHTML(listBase()); phPaint(); savPaint(lb); logoPaint(lb); picPaint(lb); } return; }
  if (t.dataset.f) { S.f[t.dataset.f] = t.value; if (t.dataset.f === 'type') S.f.stage = '';
    // "Delivery on a day…": start on today and open the date picker
    const pickDay = t.dataset.f === 'del' && t.value === 'day'; if (pickDay && !S.f.delDay) S.f.delDay = todayISO();
    renderView();
    if (pickDay) { const d = $('#fDelDay'); if (d) { d.focus(); try { d.showPicker(); } catch (e) { } } }
    return; }
  if (t.id === 'assignSel') {
    const to = t.value; const id = S.openId; const c = findCase(id); if (!c) return;
    act(() => B.mutateCase(id, d => { d.assignee = to; if (to) d.assigneeName = ''; }, { a: 'assign', to }), to ? 'Assigned to ' + staffName(to) : 'Unassigned');
    return;
  }
  if (t.dataset.setting) {
    const k = t.dataset.setting, isMoney = k === 'alPerAligner' || k === 'alPerSet';
    if (isMoney && t.value !== '' && !(Number(t.value) >= 0)) { toast('Enter a dollar amount, like 4.50', { bad: true }); return; }
    const v = k === 'idleMin' ? Number(t.value) : isMoney ? (t.value === '' ? null : Math.round(Number(t.value) * 100) / 100) : t.value;
    act(() => B.saveSettings({ [k]: v }), 'Saved');
  }
}
function onInput(e) { if (e.target.id === 'q') { S.q = e.target.value; renderView(); } }
async function saveEdit() {
  const d = $('#drawer'); const now = readCaseForm(d);
  if (!now.type || !now.patient) { $('#drawerNotice').innerHTML = '<div class="notice bad">Type and patient name are required.</div>'; return; }
  if (now.titanUrl && !safeUrl(now.titanUrl)) { $('#drawerNotice').innerHTML = '<div class="notice bad">The Titan link must start with https://</div>'; return; }
  const txBad = !!now.txStart !== !!now.txEnd ? 'Enter both the treatment start and the expected removal (or leave both empty).' : now.txStart && now.txEnd <= now.txStart ? 'The expected removal has to be after the treatment start.' : '';
  if (txBad) { $('#drawerNotice').innerHTML = '<div class="notice bad">' + txBad + '</div>'; $('#drawerNotice').scrollIntoView({ block: 'nearest' }); return; }
  const base = S.editBase; const changed = FORM_KEYS.filter(k => !sameVal(now[k], base[k])).concat((now.variant || '') !== (base.variant || '') ? ['variant'] : []);
  if (!changed.length) { S.editing = false; renderDrawer(); return; }
  // the same checks as moving the stage from the case: MARPE records before the lab, a date for the Zoom call
  // (in-house: the form has the aligner counts and attachment templates, so only missing ones stop the save)
  const needs = (changed.includes('stage') && !changed.includes('type') ? stageNeeds(Object.assign({}, base, now, { stage: base.stage }), now.stage) : [])
    .filter(x => x !== 'aligners' || alignersMissing(now));
  if (needs.length) { $('#drawerNotice').innerHTML = '<div class="notice bad">' + (needs.includes('records') ? 'Tick both records (STL scan and CBCT) under Records on file before moving it to ' + esc(stageLabel(now)) + '.' : needs.includes('aligners') ? 'Enter ' + alAskText(now) + ' and pick Attachment templates before moving it to ' + esc(stageLabel(now)) + '.' : 'Add the Zoom call date before moving it to Zoom call scheduled.') + '</div>'; $('#drawerNotice').scrollIntoView({ block: 'nearest' }); return; }
  const end = shipEnd(now), sk = FLOWS[TYPE[now.type].flow].stages.map(s => s[0]);
  const ships = !!end && (changed.includes('stage') || changed.includes('shipToPatient')) && sk.indexOf(now.stage) >= sk.indexOf(end);
  if (ships && now.stage !== end) { now.stage = end; if (!changed.includes('stage')) changed.push('stage'); }
  const btn = $('[data-act=saveEdit]', d); busyBtn(btn, true, 'Saving…');
  const id = S.openId, nAt = Date.now();
  try {
    const apply = x => {
      changed.forEach(k => { x[k] = Array.isArray(now[k]) ? now[k].slice() : now[k]; });
      if (changed.includes('assignee') && now.assignee) x.assigneeName = '';
      if (changed.includes('assistant') && now.assistant) x.assistantName = '';
      if (changed.includes('tracking')) x.carrier = ''; // a carrier named by a lab email belonged to the old number
      if (changed.includes('txStart') || changed.includes('txEnd')) x.txAt = Date.now(); // the patient's treatment dates are the ones saved last
      if (changed.includes('notes')) notesStamp(x, nAt); // who wrote the Notes, and when (the Notes column)
      if (changed.includes('type') && !FLOWS[TYPE[x.type].flow].stages.some(s => s[0] === x.stage)) x.stage = firstStage(x.type);
    };
    // (a step changed here is logged with where it went, like a move from the stepper: the Specialty warranty counts from Shipped)
    await B.mutateCase(id, x => { apply(x); if (ships) return 'done'; }, Object.assign({ a: 'edit', fields: changed }, changed.includes('stage') ? { from: base.stage, to: now.stage } : {}, ships ? { close: 1 } : {}));
    // show the saved copy right away (the live update from the server follows a moment later)
    const cur = findCase(id); if (cur) apply(cur);
    if (ships) { // shipped to the patient = complete
      if (S.hist && cur) S.hist.unshift(Object.assign({}, cur, { status: 'done', closedAt: Date.now() }));
      S.editing = false; closeDrawer(true); S.closedLoaded = false;
      toast((now.patient || 'Case') + ' shipped to the patient — case complete', { action: 'Undo', onAction: () => act(() => B.mutateCase(id, x => { x.stage = base.stage; return 'open'; }, { a: 'reopen' }), 'Reopened') });
      return;
    }
    S.editing = false; toast('Saved'); renderDrawer(); loadHistory(id);
    if (changed.includes('stage') && cur && isLastStage(cur, now.stage)) offerComplete(id); // reached its last step: done?
  } catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
}
function printCode() {
  const code = $('#recShow') ? $('#recShow').textContent : (S.shownCode || '');
  const w = window.open('', '_blank', 'width=600,height=400'); if (!w) return;
  w.document.write('<title>NLO Cases recovery code</title><body style="font-family:sans-serif;padding:40px"><h2>NLO Cases — recovery code</h2><p>Keep this somewhere safe. It unlocks the office’s case data if the owner password is forgotten.</p><pre style="font-size:26px;letter-spacing:2px">' + esc(code) + '</pre><p>Printed ' + esc(new Date().toLocaleString()) + '</p></body>');
  w.document.close(); w.focus(); w.print();
}
