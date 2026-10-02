/* =====================================================================
   UI
   ===================================================================== */
const S = {
  demo: false, emu: false, cases: new Map(), closed: [], closedDays: 90, roster: [], members: [], settings: { idleMin: 10 },
  view: 'today', boardFlow: 'outside', q: '', f: { type: '', stage: '', who: '', due: '', grp: '' }, sort: { k: 'due', dir: 1 },
  openId: null, editing: false, editBase: null, lastLogin: '', tempPw: '', loginPw: '', lastAct: Date.now(), idleTimer: null,
  inApp: false, renderQ: false, firstLoad: true
};
let B = null;

/* ---------- icons ---------- */
const IC = {
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
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
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
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}

/* ---------- boot ---------- */
function boot() {
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = qs.has('demo'); S.emu = local && qs.has('emu');
  try { S.lastLogin = localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('#modalWrap')) closeModal(); else if (S.openId) closeDrawer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.kc[data-act], tr.click[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  if (S.demo) { B = DEMO; $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo'); lockScreen('login'); return; }
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
      '<div class="field"><label for="lgUser">Username</label><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(S.demo ? 'demo' : S.lastLogin) + '" required></div>' +
      '<div class="field"><label for="lgPw">Password</label><input id="lgPw" type="password" autocomplete="current-password" ' + (S.demo ? 'value="demo"' : '') + ' required></div>' +
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
  const f = mode === 'login' && $('#lgUser').value ? $('#lgPw') : $('input:not([type=checkbox])', card);
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
    e.preventDefault(); const btn = $('#lgBtn'); const user = $('#lgUser').value.trim(); const pw = $('#lgPw').value;
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
    S.setup = { name: $('#suName').value.trim(), email: $('#suEmail').value.trim(), pw: p1 };
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
  S.inApp = true; S.cases = new Map(); S.closed = []; S.firstLoad = true; S.lastAct = Date.now();
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  B.start({
    cases(up, gone) {
      up.forEach(c => S.cases.set(c.id, c)); gone.forEach(id => S.cases.delete(id));
      S.firstLoad = false; queueRender();
      if (S.openId && (up.some(c => c.id === S.openId) || gone.includes(S.openId))) refreshDrawer(gone.includes(S.openId));
    },
    roster(list) { S.roster = list; queueRender('team'); },
    members(list) { S.members = list; if (S.view === 'admin') queueRender('team'); },
    settings(s) { S.settings = Object.assign({ idleMin: 10 }, s || {}); if (S.view === 'admin') queueRender('team'); },
    revoked() { lockOut('Your access to NLO Cases was turned off.'); },
    rekeyed() { },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  });
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (S.inApp && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.');
  }, 15000);
}
async function lockOut(msg) {
  if (!S.inApp) return;
  S.inApp = false; clearInterval(S.idleTimer);
  closeModal(); closeDrawer(true);
  S.cases = new Map(); S.closed = []; S.members = []; S.roster = []; S.iprCache = {}; S.verList = null; S.delList = null; S.impList = null;
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
  return [c.patient, c.chart, c.detail, typeOf(c).l, stageLabel(c), staffName(c.assignee, c.assigneeName)].some(x => String(x || '').toLowerCase().includes(q));
}
function dueBucket(c) {
  const d = dayDiff(c.dueDate); if (d === null) return 'none';
  if (d < 0) return 'over'; if (d === 0) return 'today'; if (d <= 6) return 'week'; if (d <= 14) return '14'; return 'later';
}
function byDue(a, b) {
  const x = a.dueDate || '9999', y = b.dueDate || '9999';
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
function queueRender(kind) {
  S.renderKinds = (S.renderKinds || new Set()); S.renderKinds.add(kind || 'cases');
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => {
    S.renderQ = false; const kinds = S.renderKinds; S.renderKinds = new Set(); if (!S.inApp) return;
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
    '<div class="sideFoot"><div class="whoBox"><span class="av">' + esc(initials(B.me.name)) + '</span><div><b>' + esc(B.me.name) + '</b>' + (owner ? 'Owner' : 'Staff') + '</div></div>' +
    '<button class="sideLock" data-act="lock">' + ic('lock', 16) + 'Lock</button><div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img src="logo-white.png" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">Cases</span><span style="flex:1"></span>' +
    '<button class="iconBtn" style="color:#fff" data-act="newCase" aria-label="New case">' + ic('plus') + '</button><button class="iconBtn" style="color:#fff" data-act="lock" aria-label="Lock">' + ic('lock') + '</button>';
  $('#mobNav').innerHTML = navBtns(true);
  renderSync(); renderNav();
}
function renderNav() {
  const c = counts();
  const set = (k, n, red) => ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + k + ' .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('red', !!red); });
  set('today', c.over, true); set('list', c.all); set('mine', c.mine);
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? 'Demo · nothing saved' : 'Live · encrypted';
  if (!navigator.onLine) { cls = 'bad'; t = 'Offline'; }
  else if (B && B.pending) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
const TITLES = { today: 'Today', board: 'Board', list: 'All open cases', mine: 'My cases', done: 'Completed', admin: 'Team & security', import: 'Import & export', account: 'My account' };
function topBar(extra) {
  return '<div class="topBar"><h2>' + esc(TITLES[S.view]) + '</h2>' +
    (['today', 'board', 'list', 'mine', 'done'].includes(S.view) ? '<label class="searchBox">' + ic('search', 17) + '<span class="hidden">Search</span><input id="q" type="search" placeholder="Search patient, type, stage…" value="' + esc(S.q) + '" aria-label="Search cases"></label>' : '<span style="flex:1"></span>') +
    (extra || '') + '<button class="btn btn-teal" data-act="newCase">' + ic('plus', 16) + 'New case</button></div>';
}
function renderView() {
  const v = $('#view'); const active = document.activeElement && document.activeElement.id === 'q';
  let h = '';
  if (S.view === 'today') h = viewToday();
  else if (S.view === 'board') h = viewBoard();
  else if (S.view === 'list') h = viewList(openCases(), true);
  else if (S.view === 'mine') h = viewList(openCases().filter(c => c.assignee === meSid()), false);
  else if (S.view === 'done') h = viewDone();
  else if (S.view === 'admin') h = isOwner() ? viewAdmin() : '';
  else if (S.view === 'import') h = isOwner() ? viewImport() : '';
  else if (S.view === 'account') h = viewAccount();
  $('#topSlot').innerHTML = topBar();
  v.innerHTML = h;
  if (active) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

/* ---------- small pieces ---------- */
function typeBadge(c) { const t = typeOf(c); return '<span class="badge ' + t.cls + '">' + esc(t.l) + '</span>'; }
function dueChip(c) {
  if (!c.dueDate) return '<span class="due none">No due date</span>';
  const d = dayDiff(c.dueDate);
  if (d < 0) return '<span class="due over" title="' + esc(fmtDay(c.dueDate)) + '">' + ic('clock', 13) + (d === -1 ? '1 day late' : (-d) + ' days late') + '</span>';
  if (d === 0) return '<span class="due soon">' + ic('clock', 13) + 'Due today</span>';
  if (d === 1) return '<span class="due soon">' + ic('clock', 13) + 'Tomorrow</span>';
  if (d <= 3) return '<span class="due soon">' + ic('clock', 13) + esc(fmtDay(c.dueDate)) + '</span>';
  return '<span class="due">' + esc(fmtDate(c.dueDate)) + '</span>';
}
function avatar(c) {
  const r = staff(c.assignee);
  if (r) return '<span class="av" title="' + esc(r.name) + '">' + esc(r.initials || initials(r.name)) + '</span>';
  if (c.assigneeName) return '<span class="av none" title="' + esc(c.assigneeName) + '">' + esc(initials(c.assigneeName)) + '</span>';
  return '<span class="av none" title="Unassigned">–</span>';
}
function row(c, meta) {
  return '<button class="row" data-act="open" data-id="' + esc(c.id) + '">' + avatar(c) +
    '<span class="grow"><span class="pt">' + esc(c.patient || '(no name)') + '</span><span class="meta">' + esc(meta != null ? meta : (typeOf(c).l + ' · ' + stageLabel(c) + (c.detail ? ' · ' + c.detail : ''))) + '</span></span>' + dueChip(c) + '</button>';
}

/* ---------- Today ---------- */
function viewToday() {
  const c = counts(); const all = openCases().filter(matchesQ);
  if (S.firstLoad && !S.demo) return '<div class="empty">Loading cases…</div>';
  const tile = (n, l, cls, act) => '<button class="tile ' + cls + '" data-act="tile" data-f="' + act + '"><span class="n">' + n + '</span><span class="l">' + l + '</span></button>';
  let h = '<div class="tiles">' + tile(c.over, 'Overdue', 'red', 'over') + tile(c.week, 'Due in the next 7 days', 'amber', 'week') + tile(c.dr, 'Needs Dr. A', 'blue', 'dr') +
    tile(c.fab, 'In fabrication', '', 'fab') + tile(c.arrived, 'Arrived — check in', 'mint', 'arrived') + tile(c.mine, 'Assigned to me', '', 'mine') + '</div>';
  const soon = all.filter(x => x.dueDate && dayDiff(x.dueDate) <= 14).sort(byDue);
  const groups = [];
  soon.forEach(x => {
    const d = dayDiff(x.dueDate);
    const key = d < 0 ? 'Overdue' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : fmtDay(x.dueDate);
    let g = groups.find(g => g.k === key); if (!g) { g = { k: key, red: d < 0, items: [] }; groups.push(g); } g.items.push(x);
  });
  const left = '<div class="card"><div class="cardHd"><h3>Coming up</h3><span class="sub">Overdue and the next 14 days</span></div><div class="cardBd">' +
    (groups.length ? groups.map(g => '<div class="dueGrp"><h4 class="' + (g.red ? 'red' : '') + '">' + esc(g.k) + ' · ' + g.items.length + '</h4>' + g.items.map(x => row(x)).join('') + '</div>').join('') :
      '<div class="empty">Nothing due in the next two weeks.</div>') + '</div></div>';
  const dr = all.filter(x => DR_STAGES.includes(x.stage)).sort(byDue);
  const noDate = all.filter(x => !x.dueDate).length;
  const right = '<div class="card"><div class="cardHd"><h3>Needs Dr. A</h3><span class="sub">' + dr.length + ' waiting</span></div><div class="cardBd">' +
    (dr.length ? dr.map(x => row(x)).join('') : '<div class="empty">Nothing waiting on Dr. A.</div>') + '</div></div>' +
    (noDate ? '<div class="card" style="margin-top:14px"><div class="cardBd" style="padding:14px 20px"><button class="linkBtn" data-act="tile" data-f="none">' + noDate + ' open case' + (noDate > 1 ? 's have' : ' has') + ' no due date</button></div></div>' : '');
  return h + '<div class="twoCol"><div>' + left + '</div><div>' + right + '</div></div>';
}

/* ---------- Board ---------- */
function viewBoard() {
  const all = openCases().filter(matchesQ);
  const flowsUsed = Object.keys(FLOWS);
  let h = '<div class="boardTabs" role="tablist">' + flowsUsed.map(k => {
    const n = all.filter(c => typeOf(c).flow === k).length;
    return '<button class="chip' + (S.boardFlow === k ? ' on' : '') + '" role="tab" aria-selected="' + (S.boardFlow === k) + '" data-act="flow" data-k="' + k + '">' + esc(FLOWS[k].label) + '<span class="c">' + n + '</span></button>';
  }).join('') + '</div>';
  const flow = FLOWS[S.boardFlow];
  const inFlow = all.filter(c => typeOf(c).flow === S.boardFlow);
  h += '<div class="board">' + flow.stages.map(([sk, sl], i) => {
    const items = inFlow.filter(c => c.stage === sk || (i === 0 && !flow.stages.some(s => s[0] === c.stage))).sort(byDue);
    return '<section class="col" aria-label="' + esc(sl) + '"><div class="colHd"><h4>' + esc(sl) + '</h4><span class="c">' + items.length + '</span></div><div class="colBd">' +
      (items.map(c => kcard(c, i === flow.stages.length - 1)).join('') || '<div class="empty" style="padding:14px 4px">—</div>') + '</div></section>';
  }).join('') + '</div>';
  return h;
}
function kcard(c, last) {
  const mixed = S.boardFlow === 'outside' || S.boardFlow === 'inhouse' || S.boardFlow === 'retainer';
  return '<div class="kc" data-act="open" data-id="' + esc(c.id) + '" role="button" tabindex="0">' +
    '<div class="pt">' + esc(c.patient || '(no name)') + '</div>' + (c.detail ? '<div class="dt">' + esc(c.detail) + '</div>' : '') +
    '<div class="ft">' + (mixed ? typeBadge(c) : '') + dueChip(c) + avatar(c) +
    '<button class="adv" data-act="' + (last ? 'complete' : 'advance') + '" data-id="' + esc(c.id) + '" title="' + (last ? 'Mark complete' : 'Move to next stage') + '" aria-label="' + (last ? 'Mark complete' : 'Move to next stage') + '">' + ic(last ? 'done' : 'next', 17) + '</button></div></div>';
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
    if (f.grp === 'dr' && !DR_STAGES.includes(c.stage)) return false;
    if (f.grp === 'fab' && !FAB_STAGES.includes(c.stage)) return false;
    if (f.grp === 'arrived' && c.stage !== 'arrived') return false;
    return true;
  });
}
function sortList(list) {
  const { k, dir } = S.sort;
  const val = c => k === 'patient' ? String(c.patient || '').toLowerCase() : k === 'type' ? typeOf(c).l : k === 'stage' ? stageIndex(c) : k === 'who' ? staffName(c.assignee, c.assigneeName) : k === 'updated' ? -(c.updatedAt || 0) : (c.dueDate || '9999');
  return list.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : byDue(a, b)) * dir; });
}
function viewList(base, showWho) {
  if (S.firstLoad && !S.demo) return '<div class="empty">Loading cases…</div>';
  const f = S.f;
  const stageOpts = f.type ? FLOWS[TYPE[f.type].flow].stages : [];
  const grpLabel = { dr: 'Needs Dr. A', fab: 'In fabrication', arrived: 'Arrived' }[f.grp];
  let h = '<div class="filters">' +
    '<select data-f="type" aria-label="Type"><option value="">All types</option>' + TYPES.map(t => '<option value="' + t.k + '"' + (f.type === t.k ? ' selected' : '') + '>' + esc(t.l) + '</option>').join('') + '</select>' +
    (stageOpts.length ? '<select data-f="stage" aria-label="Stage"><option value="">All stages</option>' + stageOpts.map(([k, l]) => '<option value="' + k + '"' + (f.stage === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' : '') +
    (showWho ? '<select data-f="who" aria-label="Assigned to"><option value="">Anyone</option><option value="_none"' + (f.who === '_none' ? ' selected' : '') + '>Unassigned</option>' + activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (f.who === r.sid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>' : '') +
    '<select data-f="due" aria-label="Due"><option value="">Any due date</option>' + [['over', 'Overdue'], ['today', 'Due today'], ['week', 'Next 7 days'], ['14', 'Next 14 days'], ['none', 'No due date']].map(([k, l]) => '<option value="' + k + '"' + (f.due === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    (grpLabel ? '<button class="chip on" data-act="clearGrp">' + esc(grpLabel) + ' ✕</button>' : '') +
    ((f.type || f.stage || f.who || f.due || f.grp) ? '<button class="btn btn-ghost" data-act="clearF">Clear filters</button>' : '') + '</div>';
  const list = sortList(applyFilters(base));
  if (!list.length) return h + '<div class="card"><div class="empty">' + (base.length ? 'No cases match.' : 'No open cases yet.') + '</div></div>';
  const th = (k, l, cls) => '<th class="' + (cls || '') + '"><button data-act="sort" data-k="' + k + '">' + l + (S.sort.k === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  h += '<div class="card tblWrap"><table class="tbl"><thead><tr>' + th('patient', 'Patient') + th('type', 'Type', 'hideM') + th('stage', 'Stage') + th('due', 'Due') + th('who', 'Assigned', 'hideM') + th('updated', 'Updated', 'hideM') + '</tr></thead><tbody>' +
    list.map(c => '<tr class="click" data-act="open" data-id="' + esc(c.id) + '" tabindex="0"><td><div class="pt">' + esc(c.patient || '(no name)') + '</div><div class="small muted">' + esc(c.detail || '') + '</div></td>' +
      '<td class="hideM">' + typeBadge(c) + '</td><td>' + esc(stageLabel(c)) + '</td><td>' + dueChip(c) + '</td>' +
      '<td class="hideM">' + avatar(c) + ' <span class="small">' + esc(staffName(c.assignee, c.assigneeName)) + '</span></td><td class="hideM small muted">' + esc(c.updatedAt ? fmtWhen(c.updatedAt) : '') + '</td></tr>').join('') +
    '</tbody></table></div><div class="small muted" style="margin-top:8px">' + list.length + ' case' + (list.length === 1 ? '' : 's') + '</div>';
  return h;
}

/* ---------- Completed ---------- */
function viewDone() {
  if (!S.closedLoaded) { loadClosed(); return '<div class="empty">Loading completed cases…</div>'; }
  const list = S.closed.filter(matchesQ).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  let h = '<div class="filters"><span class="small muted">Completed in the last ' + S.closedDays + ' days</span>' +
    (S.closedDays < 3650 ? '<button class="btn btn-ghost" data-act="moreClosed">Show older</button>' : '') + '</div>';
  if (!list.length) return h + '<div class="card"><div class="empty">No completed cases' + (S.q ? ' match' : '') + '.</div></div>';
  return h + '<div class="card tblWrap"><table class="tbl"><thead><tr><th>Patient</th><th class="hideM">Type</th><th>Completed</th><th class="hideM">Last stage</th></tr></thead><tbody>' +
    list.map(c => '<tr class="click" data-act="openClosed" data-id="' + esc(c.id) + '" tabindex="0"><td><div class="pt">' + esc(c.patient) + '</div><div class="small muted">' + esc(c.detail || '') + '</div></td><td class="hideM">' + typeBadge(c) + '</td><td class="small">' + esc(fmtWhen(c.closedAt)) + '</td><td class="hideM small">' + esc(stageLabel(c)) + '</td></tr>').join('') +
    '</tbody></table></div>';
}
async function loadClosed() {
  if (S.closedLoading) return; S.closedLoading = true;
  try { S.closed = await B.loadClosed(S.closedDays); S.closedLoaded = true; }
  catch (e) { toast(errText(e), { bad: true }); S.closedLoaded = true; S.closed = []; }
  S.closedLoading = false; if (S.view === 'done') renderView();
}

/* ---------- Drawer ---------- */
function findCase(id) { return S.cases.get(id) || S.closed.find(c => c.id === id); }
function openDrawer(id) {
  S.openId = id; S.editing = false; S.history = null;
  if (!$('#drawer')) {
    const scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.dataset.act = 'closeDrawer'; document.body.appendChild(scrim);
    const d = document.createElement('aside'); d.id = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Case'); document.body.appendChild(d);
  }
  renderDrawer(); loadHistory(id);
}
function closeDrawer(force) {
  if (!force && S.editing && editDirty() && !confirm('Discard your changes?')) return;
  S.openId = null; S.editing = false; const d = $('#drawer'), s = $('#scrim'); if (d) d.remove(); if (s) s.remove();
}
function refreshDrawer(gone) {
  if (!S.openId) return;
  if (gone && !S.closed.some(c => c.id === S.openId)) {
    if (S.editing) { const n = $('#drawerNotice'); if (n) n.innerHTML = '<div class="notice bad">Someone just completed or deleted this case.</div>'; return; }
    closeDrawer(true); return;
  }
  if (S.editing) { const n = $('#drawerNotice'); if (n) n.innerHTML = '<div class="notice">Someone else just updated this case. Saving will keep their changes and apply yours on top.</div>'; return; }
  renderDrawer(); loadHistory(S.openId);
}
async function loadHistory(id) {
  try { const h = await B.caseLog(id); if (S.openId === id) { S.history = h; const el = $('#histBox'); if (el) el.innerHTML = historyHTML(findCase(id)); } } catch (e) { }
}
const FIELD_LABELS = { teeth: 'tooth chart', teethNote: 'tooth chart', chart: 'chart #', titanUrl: 'Titan link', initial: 'initial/refinement', appliances: 'appliance', lab: 'lab', arches: 'arch', retKinds: 'retainer type', instrPicks: 'Dr. A’s instructions', instrOther: 'Dr. A’s instructions', extras: 'extras', variant: 'case type', type: 'type', patient: 'patient name', detail: 'detail', stage: 'stage', assignee: 'assignee', assistant: 'assistant', scanner: 'scanner', scanDate: 'scan date', dueDate: 'due date', labDate: 'lab completion date', deliveryDate: 'delivery date', instructions: 'Dr. A’s instructions', cc: 'patient’s CC', ipr: 'IPR & spacing', notes: 'notes' };
function historyHTML(c) {
  const h = S.history; if (!h) return '<div class="small muted">Loading…</div>'; if (!h.length) return '<div class="small muted">No history yet.</div>';
  const stageName = k => { const s = c && flowOf(c).stages.find(x => x[0] === k); return s ? s[1] : k; };
  return h.filter(x => x.a !== 'rekey' && x.a !== 'save').reverse().map(x => {
    let t = '';
    if (x.a === 'create') t = 'created the case'; else if (x.a === 'import') t = 'imported it from Asana';
    else if (x.a === 'stage') t = 'moved it to ' + stageName(x.to); else if (x.a === 'comment') t = 'added a comment';
    else if (x.a === 'close') t = 'marked it complete'; else if (x.a === 'reopen') t = 'reopened it';
    else if (x.a === 'assign') t = x.to ? 'assigned it to ' + staffName(x.to, x.to) : 'unassigned it';
    else if (x.a === 'edit') t = 'changed ' + Array.from(new Set((x.fields || []).filter(f => f !== 'instructions').map(f => FIELD_LABELS[f] || f))).join(', ');
    else if (x.a === 'restore') t = 'restored an earlier version';
    else t = x.a;
    return '<div class="hist"><time>' + esc(fmtWhen(x.at)) + '</time><span><b>' + esc(firstName(staffName(x.sid, x.sid)) || x.sid) + '</b> ' + esc(t) + '</span></div>';
  }).join('');
}
function renderDrawer() {
  const d = $('#drawer'); const c = findCase(S.openId); if (!d || !c) return;
  if (S.editing) { d.innerHTML = '<div class="dHd"><div style="flex:1"><h3>Edit case</h3></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' + caseFormHTML(S.editBase, false) + '</div>' +
    '<div class="dFt"><button class="btn btn-pri" data-act="saveEdit">Save changes</button><button class="btn btn-sec" data-act="cancelEdit">Cancel</button></div>';
    wireCaseForm(d, false); return; }
  if (c.locked) {
    d.innerHTML = '<div class="dHd"><div style="flex:1"><h3>Case can’t be opened</h3></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
      '<div class="dBd"><div class="notice bad">This case’s saved copy can’t be decrypted — it may have been damaged.</div>' +
      (isOwner() ? '<p class="small" style="margin-bottom:12px">Every earlier version is kept. Pick the last good one to restore it.</p><button class="btn btn-pri" data-act="versions">' + ic('clock', 16) + 'Restore a saved version</button>' : '<p class="small">Ask Dr. A — he can restore it from its saved versions.</p>') + '</div>';
    return;
  }
  const keepCmt = $('#cmtText') ? $('#cmtText').value : ''; const hadFocus = document.activeElement && document.activeElement.id === 'cmtText';
  const done = c.status === 'done'; const flow = flowOf(c); const si = stageIndex(c);
  const kv = (k, v) => '<div><div class="k">' + k + '</div><div class="v">' + (v || '<span class="muted">—</span>') + '</div></div>';
  const txt = (k, v) => v ? '<div class="sec"><h5>' + k + '</h5><div class="txt">' + esc(v) + '</div></div>' : '';
  const assignSel = '<select class="inp" id="assignSel" data-act-change="assign" aria-label="Assigned to" style="min-height:36px;padding:6px 10px"' + (done ? ' disabled' : '') + '><option value="">Unassigned' + (c.assigneeName ? ' (Asana: ' + esc(c.assigneeName) + ')' : '') + '</option>' +
    activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + (c.assignee === r.sid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>';
  d.innerHTML = '<div class="dHd"><div style="flex:1;min-width:0"><h3>' + esc(c.patient || '(no name)') + '</h3><div class="sub">' + typeBadge(c) + (c.detail ? '<span class="small muted">' + esc(c.detail) + '</span>' : '') + '</div></div>' +
    '<button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' +
    (done ? '<div class="notice info">Completed ' + esc(fmtWhen(c.closedAt)) + '</div>' : '') +
    '<div class="sec" style="margin-top:4px"><h5>Stage</h5><div class="stepper">' + flow.stages.map(([k, l], i) =>
      '<button class="step ' + (i < si ? 'past' : i === si ? 'cur' : '') + '" data-act="setStage" data-k="' + k + '"' + (done ? ' disabled' : '') + ' aria-pressed="' + (i === si) + '"><span class="n">' + (i < si ? '✓' : i + 1) + '</span>' + esc(l) + '</button>').join('') + '</div></div>' +
    '<div class="sec"><h5>Details</h5><div class="kv">' +
    '<div style="grid-column:1/-1"><div class="k">Assigned to</div>' + assignSel + '</div>' +
    kv('Due', c.dueDate ? dueChip(c) + ' <span class="small muted">' + esc(fmtDay(c.dueDate)) + '</span>' : '') + kv('Scan date', esc(fmtDay(c.scanDate))) +
    kv('Lab completion', esc(fmtDay(c.labDate))) + kv('Delivery', esc(fmtDay(c.deliveryDate))) +
    kv('Assistant', esc(staffName(c.assistant, c.assistantName))) + kv('Scanner', esc(c.scanner)) + kv('Chart #', esc(c.chart || '')) +
    kv('Created', esc((c.createdAt ? fmtWhen(c.createdAt) : '') + (c.createdBy ? ' · ' + firstName(staffName(c.createdBy, '')) : ''))) + kv('Last update', esc(c.updatedAt ? fmtWhen(c.updatedAt) + (c.by ? ' · ' + firstName(staffName(c.by, '')) : '') : '')) +
    '</div></div>' +
    (safeUrl(c.titanUrl) ? '<div class="sec"><a class="btn btn-sec btn-sm" href="' + esc(safeUrl(c.titanUrl)) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Open in Titan</a></div>' : '') +
    ((c.appliances || []).length || c.lab || c.initial ? '<div class="sec"><h5>Case</h5><div class="pickRow">' + (c.appliances || []).map(x => '<span class="badge t-appl">' + esc(x) + '</span>').join('') + (c.lab ? '<span class="badge">' + esc(c.lab) + '</span>' : '') + (c.initial ? '<span class="badge">' + esc(submissionLabel(c.initial)) + '</span>' : '') + '</div></div>' : '') +
    txt('Dr. A’s instructions', c.instructions) +
    (c.teeth && Object.keys(c.teeth).length ? '<div class="sec"><h5>Tooth chart</h5><div class="tc ro">' + toothChartHTML(c.teeth, true) + '</div><div class="txt" style="margin-top:8px">' + esc(teethSummary(c.teeth)) + '</div></div>' : '') +
    ((c.extras || []).length ? '<div class="sec"><h5>Also</h5><div class="pickRow">' + c.extras.map(x => '<span class="badge t-retx">' + esc(x) + '</span>').join('') + '</div></div>' : '') +
    txt('Patient’s CC from last visit', c.cc) + txt('IPR & spacing', c.ipr) +
    (typeOf(c).aligner && !done ? '<div class="sec" id="iprBox">' + iprBoxHTML(c) + '</div>' : '') + txt('Notes', c.notes) +
    '<div class="sec"><h5>Comments</h5>' + ((c.comments || []).map(x => '<div class="cmt"><span class="av">' + esc(initials(staffName(x.by, x.by))) + '</span><div><div class="w"><b>' + esc(firstName(staffName(x.by, x.by))) + '</b> · ' + esc(fmtWhen(x.at)) + '</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(x.text) + '</div></div></div>').join('') || '<div class="small muted" style="margin-bottom:6px">No comments yet.</div>') +
    (done ? '' : '<div class="field" style="margin-top:8px;margin-bottom:6px"><label for="cmtText" class="hidden">Add a comment</label><textarea id="cmtText" rows="2" placeholder="Add a comment…"></textarea></div><button class="btn btn-sec btn-sm" data-act="addCmt">Add comment</button>') + '</div>' +
    '<div class="sec"><h5>History</h5><div id="histBox">' + historyHTML(c) + '</div></div></div>' +
    '<div class="dFt">' + (done ? '<button class="btn btn-sec" data-act="reopen">Reopen</button>' :
      '<button class="btn btn-mint" data-act="complete" data-id="' + esc(c.id) + '">' + ic('done', 16) + 'Mark complete</button><button class="btn btn-sec" data-act="edit">' + ic('edit', 16) + 'Edit</button>') +
    (isOwner() ? '<span style="flex:1"></span><button class="btn btn-ghost" data-act="versions">' + ic('clock', 16) + 'Versions</button><button class="btn btn-ghost" data-act="delCase" style="color:var(--coral-700)">' + ic('trash', 16) + 'Delete</button>' : '') + '</div>';
  const t = $('#cmtText'); if (t) { t.value = keepCmt; if (hadFocus) t.focus(); }
  if (typeOf(c).aligner && c.chart && !done) iprAutoLoad(c);
}
/* ---------- IPR Tracker box in the case drawer ---------- */
function iprBoxHTML(c) {
  const L = iprLink();
  const head = '<h5 style="display:flex;align-items:center;gap:8px">From the IPR Tracker<span style="flex:1"></span><a class="btn btn-ghost" href="' + IPR_URL + '" target="_blank" rel="noopener" style="min-height:28px;padding:2px 10px;font-size:12px">Open IPR Tracker</a></h5>';
  if (!c.chart) return head + '<div class="small muted">Add the chart # (Edit) to pull the latest IPR and spacing automatically.</div>';
  if (!L.init()) return head + '<div class="small muted">IPR link unavailable in this browser.</div>';
  if (!L.user()) return head + '<div class="small" style="margin-bottom:8px">Connect this computer to the IPR Tracker once (same Google sign-in as the IPR Tracker).</div><button class="btn btn-sec btn-sm" data-act="iprConnect">Connect IPR Tracker</button>';
  const r = (S.iprCache || {})[IPR.norm(c.chart)];
  if (!r) return head + '<div class="small muted">Loading…</div>';
  if (r.error) return head + '<div class="small" style="color:var(--coral-700)">' + esc(r.error) + '</div> <button class="btn btn-ghost" data-act="iprRefresh">Try again</button>';
  if (r.status === 'not-found') return head + '<div class="small muted">No IPR Tracker patient with chart # ' + esc(c.chart) + '.</div>';
  if (r.status === 'no-visits') return head + '<div class="small muted">Patient found, but no visits recorded yet.</div>';
  const same = String(c.ipr || '').trim() === r.note.trim();
  return head + '<div class="small muted" style="margin-bottom:6px">Latest visit ' + esc(fmtDay(r.date)) + (r.assistant ? ' · ' + esc(r.assistant) : '') + ' · ' + r.visits + ' visit' + (r.visits === 1 ? '' : 's') + ' on file</div>' +
    '<div class="txt">' + esc(r.note) + '</div><div style="margin-top:8px;display:flex;gap:8px">' +
    (same ? '<span class="stat ok">Saved on this case</span>' : '<button class="btn btn-sec btn-sm" data-act="iprUse">Use this on the case</button>') +
    '<button class="btn btn-ghost" data-act="iprRefresh">' + ic('refresh', 14) + 'Refresh</button></div>';
}
async function iprAutoLoad(c, force) {
  const L = iprLink(); if (!L.init()) return;
  if (!L.user()) { await L.waitUser(); if (!L.user()) return; }
  const k = IPR.norm(c.chart); S.iprCache = S.iprCache || {};
  if (S.iprCache[k] && !force) { const b = $('#iprBox'); if (b) b.innerHTML = iprBoxHTML(c); return; }
  if (S.iprLoading === k) return; S.iprLoading = k;
  try { S.iprCache[k] = await L.latest(c.chart); }
  catch (e) { S.iprCache[k] = { error: /permission|denied/i.test(String(e && (e.code || e.message))) ? 'This Google account can’t read the IPR Tracker.' : 'Couldn’t reach the IPR Tracker.' }; }
  S.iprLoading = null;
  const cur = findCase(S.openId); const b = $('#iprBox'); if (b && cur && IPR.norm(cur.chart) === k) b.innerHTML = iprBoxHTML(cur);
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
function confirmBox(title, text, okLabel, danger) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="lsub" style="font-size:13.5px;color:var(--grey-600)">' + esc(text) + '</p><div class="mFt"><button class="btn btn-sec" id="cbNo">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel) + '</button></div>', w => {
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
    const how = { stage: 'moved', comment: 'commented', edit: 'edited', close: 'completed', reopen: 'reopened', assign: 'reassigned', restore: 'restored', save: 'saved', rekey: 'key change', delete: 'deleted' };
    $('#verList').innerHTML = list.length ? '<div class="tblWrap"><table class="tbl"><thead><tr><th>Version</th><th>Contents</th><th></th></tr></thead><tbody>' + list.map((v, i) =>
      '<tr><td class="small"><b>#' + v.rev + '</b><div class="muted">replaced ' + esc(fmtWhen(v.replacedAt)) + '<br>by ' + esc(firstName(staffName(v.replacedBy, v.replacedBy))) + (v.replacedHow ? ' (' + esc(how[v.replacedHow] || v.replacedHow) + ')' : '') + '</div></td>' +
      '<td class="small">' + (v.data ? '<b>' + esc(v.data.patient || '') + '</b><div class="muted">' + esc(typeOf(v.data).l + ' · ' + stageLabel(v.data) + (v.data.dueDate ? ' · due ' + fmtDate(v.data.dueDate) : '')) + '</div>' : '<span style="color:var(--coral-700)">Can’t be read</span>') + '</td>' +
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
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(errText(e), { bad: true }); } }
function nextStage(c) { const st = flowOf(c).stages; const i = stageIndex(c); return i >= 0 && i < st.length - 1 ? st[i + 1][0] : null; }
async function moveStage(id, to) {
  const c = findCase(id); if (!c || c.stage === to) return;
  const from = c.stage; c.stage = to; queueRender(); if (S.openId === id) renderDrawer();
  try { await B.mutateCase(id, d => { d.stage = to; }, { a: 'stage', from, to }); }
  catch (e) { c.stage = from; queueRender(); if (S.openId === id) renderDrawer(); toast(errText(e), { bad: true }); }
}
async function completeCase(id) {
  const c = findCase(id); if (!c) return;
  try {
    await B.mutateCase(id, () => 'done', { a: 'close' });
    if (S.openId === id) closeDrawer(true);
    S.closedLoaded = false;
    toast((c.patient || 'Case') + ' marked complete', { action: 'Undo', onAction: () => act(() => B.mutateCase(id, () => 'open', { a: 'reopen' }), 'Reopened') });
  } catch (e) { toast(errText(e), { bad: true }); }
}
function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act; const id = t.dataset.id;
  if (t.tagName === 'SELECT') return;
  if (a === 'advance' || a === 'complete') { e.stopPropagation(); }
  switch (a) {
    case 'nav': S.view = t.dataset.v; if (S.view !== 'list') S.f = { type: '', stage: '', who: '', due: '', grp: '' }; renderNav(); renderView(); window.scrollTo(0, 0); break;
    case 'tile': { const f = t.dataset.f; S.f = { type: '', stage: '', who: '', due: '', grp: '' };
      if (f === 'mine') { S.view = 'mine'; } else { S.view = 'list'; if (['over', 'week', 'none'].includes(f)) S.f.due = f; else S.f.grp = f; }
      renderNav(); renderView(); break; }
    case 'flow': S.boardFlow = t.dataset.k; renderView(); break;
    case 'open': openDrawer(id); break;
    case 'openClosed': openDrawer(id); break;
    case 'closeDrawer': closeDrawer(); break;
    case 'advance': { const c = findCase(id); const n = c && nextStage(c); if (n) moveStage(id, n); break; }
    case 'complete': completeCase(id); break;
    case 'setStage': moveStage(S.openId, t.dataset.k); break;
    case 'reopen': act(async () => { await B.mutateCase(S.openId, () => 'open', { a: 'reopen' }); S.closed = S.closed.filter(c => c.id !== S.openId); closeDrawer(true); }, 'Reopened'); break;
    case 'addCmt': { const txt = ($('#cmtText').value || '').trim(); if (!txt) return; const cid = S.openId;
      $('#cmtText').value = ''; act(() => B.mutateCase(cid, d => { d.comments = (d.comments || []).concat([{ id: uid8(), at: Date.now(), by: meSid(), text: txt }]); }, { a: 'comment' })); break; }
    case 'edit': { const c = findCase(S.openId); S.editBase = JSON.parse(JSON.stringify(c)); S.editing = true; renderDrawer(); break; }
    case 'cancelEdit': S.editing = false; renderDrawer(); break;
    case 'saveEdit': saveEdit(); break;
    case 'delCase': (async () => { const c = findCase(S.openId); if (await confirmBox('Delete this case?', 'This removes ' + c.patient + ' from every list. Dr. A can bring it back from Team & security for 90 days. To finish a case normally, use “Mark complete” instead.', 'Delete', true)) { const cid = S.openId; closeDrawer(true); act(() => B.deleteCase(cid), 'Case deleted'); } })(); break;
    case 'newCase': newCaseModal(); break;
    case 'closeModal': closeModal(); break;
    case 'clearF': S.f = { type: '', stage: '', who: '', due: '', grp: '' }; renderView(); break;
    case 'clearGrp': S.f.grp = ''; renderView(); break;
    case 'sort': { const k = t.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : 1 }; renderView(); break; }
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
    case 'iprConnect': iprLink().connect().then(() => { const c = findCase(S.openId); if (c) { const b = $('#iprBox'); if (b) b.innerHTML = iprBoxHTML(c); iprAutoLoad(c, true); } if (S.view === 'account') renderView(); }).catch(x => toast(errText(x), { bad: true })); break;
    case 'iprDisconnect': iprLink().disconnect().then(() => { S.iprCache = {}; renderView(); toast('IPR Tracker disconnected on this computer'); }); break;
    case 'iprRefresh': { const c = findCase(S.openId); if (c) { (S.iprCache || {})[IPR.norm(c.chart)] = null; const b = $('#iprBox'); if (b) b.innerHTML = iprBoxHTML(c); iprAutoLoad(c, true); } break; }
    case 'iprUse': { const c = findCase(S.openId); const r = c && (S.iprCache || {})[IPR.norm(c.chart)]; if (!r || !r.note) return;
      act(() => B.mutateCase(c.id, d => { d.ipr = r.note; }, { a: 'edit', fields: ['ipr'] }), 'IPR note saved on the case'); break; }
    case 'iprPull': iprPull(t); break;
    case 'restoreVer': restoreVer(Number(t.dataset.i)); break;
    default: if (ADMIN_ACTS[a]) ADMIN_ACTS[a](t, e);
  }
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.f) { S.f[t.dataset.f] = t.value; if (t.dataset.f === 'type') S.f.stage = ''; renderView(); return; }
  if (t.id === 'assignSel') {
    const to = t.value; const id = S.openId; const c = findCase(id); if (!c) return;
    act(() => B.mutateCase(id, d => { d.assignee = to; if (to) d.assigneeName = ''; }, { a: 'assign', to }), to ? 'Assigned to ' + staffName(to) : 'Unassigned');
    return;
  }
  if (t.dataset.setting) { const v = t.dataset.setting === 'idleMin' ? Number(t.value) : t.value; act(() => B.saveSettings({ [t.dataset.setting]: v }), 'Saved'); }
}
function onInput(e) { if (e.target.id === 'q') { S.q = e.target.value; renderView(); } }
async function saveEdit() {
  const d = $('#drawer'); const now = readCaseForm(d);
  if (!now.type || !now.patient) { $('#drawerNotice').innerHTML = '<div class="notice bad">Type and patient name are required.</div>'; return; }
  if (now.titanUrl && !safeUrl(now.titanUrl)) { $('#drawerNotice').innerHTML = '<div class="notice bad">The Titan link must start with https://</div>'; return; }
  const base = S.editBase; const changed = FORM_KEYS.filter(k => !sameVal(now[k], base[k])).concat((now.variant || '') !== (base.variant || '') ? ['variant'] : []);
  if (!changed.length) { S.editing = false; renderDrawer(); return; }
  const btn = $('[data-act=saveEdit]', d); busyBtn(btn, true, 'Saving…');
  const id = S.openId;
  try {
    await B.mutateCase(id, x => {
      changed.forEach(k => { x[k] = Array.isArray(now[k]) ? now[k].slice() : now[k]; });
      if (changed.includes('assignee') && now.assignee) x.assigneeName = '';
      if (changed.includes('assistant') && now.assistant) x.assistantName = '';
      if (changed.includes('type') && !FLOWS[TYPE[x.type].flow].stages.some(s => s[0] === x.stage)) x.stage = firstStage(x.type);
    }, { a: 'edit', fields: changed });
    S.editing = false; toast('Saved'); renderDrawer(); loadHistory(id);
  } catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
}
function printCode() {
  const code = $('#recShow') ? $('#recShow').textContent : (S.shownCode || '');
  const w = window.open('', '_blank', 'width=600,height=400'); if (!w) return;
  w.document.write('<title>NLO Cases recovery code</title><body style="font-family:sans-serif;padding:40px"><h2>NLO Cases — recovery code</h2><p>Keep this somewhere safe. It unlocks the office’s case data if the owner password is forgotten.</p><pre style="font-size:26px;letter-spacing:2px">' + esc(code) + '</pre><p>Printed ' + esc(new Date().toLocaleString()) + '</p></body>');
  w.document.close(); w.focus(); w.print();
}
