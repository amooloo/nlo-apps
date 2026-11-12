/* =====================================================================
   The page: sign-in (same logins as NLO Cases), the letter builder,
   the doctor directory and the owner's settings.
   ===================================================================== */
let B = null; // backend: FB (live) or DEMO
const S = {
  demo: false, emu: false, lastLogin: '', loginPw: '', inApp: false, view: 'write',
  docs: new Map(), docsReady: false, docsErr: '', office: officeCfg(null), settings: { idleMin: 10 },
  draft: blankDraft('', null), docQ: '', q: '', typeF: '', showOff: false, lastAct: Date.now(), idleTimer: null, imp: null
};
const ACT = {}; // click actions: data-act="name" → ACT.name(target, event)
const CHG = {}; // change handlers: data-chg="name"

/* ---------- icons ---------- */
const IC = {
  pen: '<path d="M4 20h4l10.5-10.5-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  book: '<path d="M5 4.5h11a2.5 2.5 0 012.5 2.5v12.5H7.5A2.5 2.5 0 015 17z"/><path d="M5 17a2.5 2.5 0 012.5-2.5h11"/><path d="M9 8.5h6"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  print: '<path d="M7 9V4.5h10V9"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14.5h10v5H7z"/>',
  import: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.5 11h10a5 5 0 010 10h-3"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  /* one picture per letter */
  extraction: '<path d="M8 3.5c1.6 0 2.4.8 4 .8s2.4-.8 4-.8c2.2 0 3.5 1.9 3.5 4.2 0 2.6-1.3 4-1.8 6.2-.5 2.3-.6 6.6-2.4 6.6-1.5 0-1.3-4.5-3.3-4.5s-1.8 4.5-3.3 4.5c-1.8 0-1.9-4.3-2.4-6.600C5.8 11.7 4.5 10.3 4.5 7.7 4.5 5.4 5.8 3.5 8 3.5z"/><path d="M12 9.500v4.500M10 11.500l2-2 2 2"/>',
  hygiene: '<rect x="3.500" y="13" width="9" height="3.600" rx="1.800" transform="rotate(-45 8 14.800)"/><path d="M13.500 6.500l4 4M15 5l4 4M16.500 3.500l4 4"/><path d="M5 20l2.500-2.500"/>',
  exposure: '<path d="M8 3.5c1.6 0 2.4.8 4 .8s2.4-.8 4-.8c2.2 0 3.5 1.9 3.5 4.2 0 2.6-1.3 4-1.8 6.2-.5 2.3-.6 6.6-2.4 6.6-1.5 0-1.3-4.5-3.3-4.5s-1.8 4.5-3.3 4.5c-1.8 0-1.9-4.3-2.4-6.600C5.8 11.7 4.5 10.3 4.5 7.7 4.5 5.4 5.8 3.5 8 3.5z"/><path d="M3 8.500c3-3.500 6-5 9-5s6 1.500 9 5" stroke-dasharray="2.200 2"/>',
  orthognathic: '<path d="M9 3.500c4.500-.5 7.500 2.500 7.500 6 0 1.500-.3 2.300.3 3.300l1.200 2-1.800.7v2c0 1.300-1 2-2.200 2H11.500v1"/><path d="M9 3.500C6 4.500 4.500 7 4.500 10c0 3 2 4.500 2 7v3.500"/><path d="M11 15.500h5" stroke-dasharray="1.600 1.600"/>',
  bonding: '<path d="M8 3.5c1.6 0 2.4.8 4 .8s2.4-.8 4-.8c2.2 0 3.5 1.9 3.5 4.2 0 2.6-1.3 4-1.8 6.2-.5 2.3-.6 6.6-2.4 6.6-1.5 0-1.3-4.5-3.3-4.5s-1.8 4.5-3.3 4.5c-1.8 0-1.9-4.3-2.4-6.600C5.8 11.7 4.5 10.3 4.5 7.7 4.5 5.4 5.8 3.5 8 3.5z"/><path d="M17 2.500l.7 1.600 1.600.7-1.600.7-.7 1.600-.7-1.600-1.600-.7 1.600-.7z" fill="currentColor" stroke="none"/>',
  cavity: '<path d="M8 3.5c1.6 0 2.4.8 4 .8s2.4-.8 4-.8c2.2 0 3.5 1.9 3.5 4.2 0 2.6-1.3 4-1.8 6.2-.5 2.3-.6 6.6-2.4 6.6-1.5 0-1.3-4.5-3.3-4.5s-1.8 4.5-3.3 4.5c-1.8 0-1.9-4.3-2.4-6.600C5.8 11.7 4.5 10.3 4.5 7.7 4.5 5.4 5.8 3.5 8 3.5z"/><circle cx="14.500" cy="8.500" r="1.700" fill="currentColor"/>',
  radiolucency: '<rect x="3.500" y="4.500" width="17" height="15" rx="2"/><path d="M8.500 8.500c.8 0 1.200.4 2 .4s1.200-.4 2-.4c1.200 0 1.800 1 1.800 2.200 0 1.300-.6 2-.9 3.100-.2 1.100-.3 3.200-1.200 3.200-.7 0-.6-2.200-1.700-2.200s-1 2.200-1.700 2.200c-.9 0-1-2.100-1.200-3.200-.3-1.100-.9-1.800-.9-3.100 0-1.200.6-2.200 1.800-2.200z"/><circle cx="16.500" cy="15" r="1.900" stroke-dasharray="1.800 1.400"/>',
  tads: '<path d="M7.500 4.500h9l-1.500 3h-6z"/><path d="M10 7.500h4v3h-4z"/><path d="M10.300 10.500l1.700 10 1.700-10"/><path d="M9.800 13.500l4.400-1M10.300 16.500l3.400-.8"/>',
  marpe: '<path d="M4 9c0-3 3.500-5 8-5s8 2 8 5v9"/><path d="M4 9v9"/><rect x="8.500" y="10" width="7" height="5" rx="1.200"/><path d="M12 10v5"/><path d="M4 12.500h4.500M15.500 12.500H20"/><path d="M10 15v3.500M14 15v3.500"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || 3800);
}
function errText(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/no-user/.test(c)) return 'No login with that username.';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Username or password is incorrect.';
  if (/inactive/.test(c)) return 'This login has been turned off. Ask Dr. A.';
  if (/not-member/.test(c)) return 'That account isn’t part of the office.';
  if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a minute and try again.';
  if (/network|unavailable/.test(c)) return 'Can’t reach the server. Check the internet connection.';
  if (/weak-password/.test(c)) return 'Password needs at least 8 characters.';
  if (/boot-failed/.test(c)) return 'That temporary password didn’t work. Ask Dr. A to reissue your login.';
  if (/boot-stale/.test(c)) return 'This invite expired after a security update. Ask Dr. A to reissue your login.';
  if (/bad-code/.test(c)) return 'That recovery code didn’t work. Check it and try again.';
  if (/permission/.test(c)) return 'Not allowed. Your access may have changed.';
  if (/gone/.test(c)) return 'That doctor is no longer in the directory.';
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}

/* ---------- boot ---------- */
function boot() {
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = qs.has('demo'); S.emu = local && qs.has('emu');
  try { S.lastLogin = localStorage.getItem('nloLetters.lastLogin') || localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modalWrap')) closeModal(); });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'));
  if (S.demo) { B = DEMO; $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo'); lockScreen('login'); return; }
  B = FB;
  if (!FB.init(S.emu)) { lockScreen('unconfigured'); return; }
  FB.onSync = renderSync;
  FB.ready().then(() => lockScreen('login'));
  window.addEventListener('online', renderSync); window.addEventListener('offline', renderSync);
}

/* ---------- lock screens (same logins as NLO Cases) ---------- */
function lockScreen(mode, info) {
  info = info || {};
  $('#lockWrap').classList.remove('hidden'); $('#app').classList.add('hidden');
  const card = $('#lockCard'); let h = '';
  const err = info.err ? '<div class="lockErr" role="alert">' + esc(info.err) + '</div>' : '';
  const ok = info.ok ? '<div class="lockOk" role="status">' + esc(info.ok) + '</div>' : '';
  if (mode === 'unconfigured') {
    h = '<h1>Almost ready</h1><div class="lsub">This copy isn’t connected to the office database yet.</div>' +
      '<p class="desc">To look around with made-up doctors, open the demo.</p><a class="btn btn-pri btn-block" href="?demo">Open the demo</a>';
  } else if (mode === 'login') {
    h = '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · referral letters</div>' + err + ok +
      '<form id="loginForm" autocomplete="on" style="margin-top:16px">' +
      '<div class="field"><label for="lgUser">Username</label><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(S.demo ? 'demo' : S.lastLogin) + '" required></div>' +
      '<div class="field"><label for="lgPw">Password</label><input id="lgPw" type="password" autocomplete="current-password" ' + (S.demo ? 'value="demo"' : '') + ' required></div>' +
      '<button class="btn btn-pri btn-block" id="lgBtn" type="submit">Sign in</button></form>' +
      '<div class="lockFoot">Same login as NLO Cases. Forgot your password? Ask Dr. A to reissue your login.' + (S.demo ? '' : '<br><button class="linkBtn" data-act="forgot" type="button">Dr. A: reset by email</button>') + '</div>';
  } else if (mode === 'first') {
    h = '<h1>Welcome, ' + esc(firstName(B.me && B.me.name)) + '</h1><div class="lsub">Choose your own password</div>' + err +
      '<p class="desc">Only you will know it. Use at least 8 characters. It’s also your NLO Cases password.</p>' +
      '<form id="firstForm"><div class="field"><label for="fpw1">New password</label><input id="fpw1" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<div class="field"><label for="fpw2">Type it again</label><input id="fpw2" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<button class="btn btn-pri btn-block" id="fBtn" type="submit">Save and continue</button></form>';
  } else if (mode === 'recover') {
    h = '<h1>Unlock with your recovery code</h1><div class="lsub">Your password changed, so the office key needs your recovery code once.</div>' + err +
      '<form id="recForm" style="margin-top:16px"><div class="field"><label for="recCode">Recovery code</label><input id="recCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div>' +
      '<button class="btn btn-pri btn-block" type="submit">Unlock</button></form>' +
      '<div class="lockFoot"><button class="linkBtn" data-act="lockSignOut" type="button">Cancel</button></div>';
  } else if (mode === 'broken') {
    h = '<h1>Login needs a reset</h1><div class="lsub">Your password was changed outside the app.</div><p class="desc">Ask Dr. A to reissue your login from NLO Cases → Team &amp; security.</p>' +
      '<button class="btn btn-sec btn-block" data-act="lockSignOut">Back</button>';
  } else if (mode === 'forgot') {
    h = '<h1>Reset by email</h1><div class="lsub">For Dr. A’s email login</div>' + err + ok +
      '<form id="forgotForm" style="margin-top:16px"><div class="field"><label for="fgEmail">Your email</label><input id="fgEmail" type="email" autocomplete="email" required></div>' +
      '<button class="btn btn-pri btn-block" type="submit">Send reset link</button></form>' +
      '<p class="desc small" style="margin:14px 0 0">After you pick a new password, sign in with it. You’ll be asked for your recovery code once.</p>' +
      '<div class="lockFoot"><button class="linkBtn" data-act="toLogin" type="button">Back to sign in</button></div>';
  }
  card.innerHTML = h;
  const f = mode === 'login' && $('#lgUser').value ? $('#lgPw') : $('input:not([type=checkbox])', card);
  if (f) f.focus();
  bindLockForms();
}
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
function bindLockForms() {
  const lf = $('#loginForm');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const btn = $('#lgBtn'); const user = $('#lgUser').value.trim(); const pw = $('#lgPw').value;
    busyBtn(btn, true, 'Signing in…');
    try {
      const r = await B.signIn(user, pw);
      S.lastLogin = user; try { localStorage.setItem('nloLetters.lastLogin', user); } catch (x) { }
      S.loginPw = pw;
      if (r.state === 'ok') { S.loginPw = ''; enterApp(); } else lockScreen(r.state);
    } catch (x) { busyBtn(btn, false); lockScreen('login', { err: errText(x) }); }
  };
  const ff = $('#firstForm');
  if (ff) ff.onsubmit = async e => {
    e.preventDefault(); const a = $('#fpw1').value, b = $('#fpw2').value;
    if (a.length < 8) return lockScreen('first', { err: 'Use at least 8 characters.' });
    if (a !== b) return lockScreen('first', { err: 'The two passwords don’t match.' });
    if (a === S.loginPw) return lockScreen('first', { err: 'Pick something different from the temporary password.' });
    busyBtn($('#fBtn'), true, 'Saving…');
    try { await B.firstSetup(S.loginPw, a); S.loginPw = ''; enterApp(); } catch (x) { lockScreen('first', { err: errText(x) }); }
  };
  const rf = $('#recForm');
  if (rf) rf.onsubmit = async e => {
    e.preventDefault(); busyBtn($('button[type=submit]', rf), true, 'Unlocking…');
    try { await B.recover(S.loginPw, $('#recCode').value); S.loginPw = ''; toast('Unlocked. Your recovery code still works — keep it safe.'); enterApp(); }
    catch (x) { lockScreen('recover', { err: errText(x) }); }
  };
  const fg = $('#forgotForm');
  if (fg) fg.onsubmit = async e => {
    e.preventDefault();
    try { await B.sendReset($('#fgEmail').value.trim()); lockScreen('forgot', { ok: 'If that email has a login, a reset link is on its way.' }); }
    catch (x) { lockScreen('forgot', { err: errText(x) }); }
  };
}

/* ---------- enter / leave ---------- */
function enterApp() {
  Object.assign(S, { inApp: true, docs: new Map(), docsReady: false, docsErr: '', office: officeCfg(null), view: 'write', docQ: '', q: '', typeF: '', showOff: false, lastAct: Date.now(), imp: null });
  S.draft = blankDraft('', S.office);
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  B.start({
    docs(up, gone) {
      up.forEach(d => S.docs.set(d.id, d)); gone.forEach(id => S.docs.delete(id));
      S.docsReady = true; S.docsErr = '';
      if (S.draft.docId && S.docs.has(S.draft.docId)) S.draft.doc = S.docs.get(S.draft.docId);
      if (S.view === 'doctors') renderView(); else if (S.view === 'write' && S.draft.letter) { renderDocPick(); updatePaper(); }
      renderNav();
    },
    docsError(e) {
      S.docsReady = true;
      S.docsErr = /permission/.test((e && e.code) || '') ? 'The office database isn’t ready for the doctor directory yet (Dr. A: publish the updated rules). You can still write a letter by adding the doctor by hand.' : errText(e);
      if (S.view === 'doctors' || (S.view === 'write' && S.draft.letter)) renderView();
    },
    office(saved) {
      const before = S.office; S.office = officeCfg(saved);
      if (!S.draft.letter) { S.draft.letterhead = S.office.letterhead; S.draft.notation = S.office.notation; }
      if (S.view === 'settings' && !$('#setForm:focus-within')) renderView();
      else if (S.view === 'write' && S.draft.letter && JSON.stringify(before) !== JSON.stringify(S.office)) { regenText(); updatePaper(); }
    },
    settings(s) { S.settings = Object.assign({ idleMin: 10 }, s || {}); },
    revoked() { lockOut('Your access was turned off.'); },
    rekeyed() { if (S.inApp && isOwner()) setTimeout(() => B.resealOld().catch(() => { }), 1500); },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  });
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (S.inApp && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.');
  }, 15000);
  if (isOwner()) setTimeout(() => { if (S.inApp) B.resealOld().catch(() => { }); }, 6000);
}
async function lockOut(msg) {
  if (!S.inApp) return;
  S.inApp = false; clearInterval(S.idleTimer); closeModal();
  // the letter in progress (the only place a patient's name ever is) goes with the lock
  Object.assign(S, { docs: new Map(), docsReady: false, draft: blankDraft('', null), imp: null, docQ: '', q: '' });
  $('#view').innerHTML = ''; $('#topSlot').innerHTML = '';
  await B.signOut();
  lockScreen('login', { ok: msg });
}
function isOwner() { return B.isOwner(); }
function liveDocs() { return Array.from(S.docs.values()).filter(d => !d.locked); }

/* ---------- shell ---------- */
const NAV = [['write', 'Write a letter', 'pen'], ['doctors', 'Doctors', 'book']];
const TITLES = { write: 'Write a letter', doctors: 'Doctors', settings: 'Settings' };
function renderShell() {
  const owner = isOwner();
  const navBtns = mob => NAV.map(([k, l, i]) => '<button class="navBtn" data-act="nav" data-v="' + k + '" id="' + (mob ? 'm' : '') + 'nav-' + k + '">' + ic(i) + '<span>' + l + '</span><span class="cnt hidden"></span></button>').join('') +
    (owner ? (mob ? '' : '<div class="navLbl">Office</div>') + '<button class="navBtn" data-act="nav" data-v="settings" id="' + (mob ? 'm' : '') + 'nav-settings">' + ic('gear') + '<span>Settings</span></button>' : '');
  $('#side').innerHTML = '<div class="sideTop"><img src="logo-white.png" alt="Next Level Orthodontics"><div class="appTag">Letters</div></div>' +
    '<nav class="nav" aria-label="Main">' + navBtns(false) + '</nav>' +
    '<div class="sideFoot"><div class="whoBox"><span class="av">' + esc(initials(B.me.name)) + '</span><div><b>' + esc(B.me.name) + '</b>' + (owner ? 'Owner' : 'Staff') + '</div></div>' +
    '<a class="sideLink" href="nlo-cases.html">' + ic('next', 14) + 'Open NLO Cases</a>' +
    '<button class="sideLock" data-act="lock">' + ic('lock', 16) + 'Lock</button><div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img src="logo-white.png" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">Letters</span><span style="flex:1"></span>' +
    '<button class="iconBtn" style="color:#fff" data-act="lock" aria-label="Lock">' + ic('lock') + '</button>';
  $('#mobNav').innerHTML = navBtns(true);
  renderSync(); renderNav();
}
function renderNav() {
  const n = liveDocs().filter(d => !d.off).length;
  ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + 'doctors .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); });
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? 'Demo · nothing saved' : 'Live · encrypted';
  if (!navigator.onLine) { cls = 'bad'; t = 'Offline'; }
  else if (B && B.pending) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
function renderView() {
  if (!S.inApp) return;
  const letter = letterById(S.draft.letter);
  let right = '';
  if (S.view === 'doctors') right = '<div class="searchBox">' + ic('search', 16) + '<input id="q" type="search" placeholder="Search doctors, offices, cities" value="' + esc(S.q) + '" aria-label="Search doctors"></div>';
  $('#topSlot').innerHTML = '<div class="topBar"><h2>' + esc(S.view === 'write' && letter ? letter.label + ' letter' : TITLES[S.view]) + '</h2>' + right + '</div>';
  const v = $('#view');
  if (S.view === 'write') { v.innerHTML = letter ? builderHTML() : pickHTML(); if (letter) { renderDocPick(); updatePaper(); } }
  else if (S.view === 'doctors') { v.innerHTML = doctorsHTML(); const q = $('#q'); if (q && S.qFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  else if (S.view === 'settings') v.innerHTML = isOwner() ? settingsHTML() : '';
  renderNav();
}

/* ---------- step 0: pick a letter ---------- */
function pickHTML() {
  return '<p class="lead">Which letter are you sending?</p><div class="ltGrid">' +
    LETTERS.map(l => '<button class="ltTile" data-act="pickLetter" data-id="' + l.id + '"><span class="ltIc">' + ic(l.id, 34) + '</span><b>' + esc(l.label) + '</b><span>' + esc(l.blurb) + '</span></button>').join('') +
    '</div><p class="small muted" style="margin-top:18px">' + ic('lock', 13) + ' The patient’s name and date of birth are never saved. They are gone when you start over, lock, or close the page.</p>';
}

/* ---------- the builder ---------- */
function builderHTML() {
  const d = S.draft, letter = letterById(d.letter);
  const sec = (n, title, body, extra) => '<section class="bSec"' + (extra || '') + '><h4><span class="bNum">' + n + '</span>' + esc(title) + '</h4>' + body + '</section>';
  let n = 0;
  const patient = '<div class="grid2"><div class="field"><label for="ptFirst">First name</label><input id="ptFirst" data-d="first" autocomplete="off" value="' + esc(d.first) + '"></div>' +
    '<div class="field"><label for="ptLast">Last name</label><input id="ptLast" data-d="last" autocomplete="off" value="' + esc(d.last) + '"></div></div>' +
    '<div class="grid2"><div class="field"><label for="ptDob">Date of birth</label><input id="ptDob" data-d="dob" type="date" max="' + todayISO() + '" value="' + esc(d.dob) + '"></div>' +
    '<div class="field"><label for="ptRp">Responsible party phone <span class="opt">optional</span></label><input id="ptRp" data-d="rpPhone" type="tel" autocomplete="off" placeholder="(352) 555-0100" value="' + esc(d.rpPhone) + '"></div></div>';
  const opts = letter.opts.map(o => '<div class="optGrp"><div class="flabel">' + esc(o.label) + (o.multi ? ' <span class="opt">pick any</span>' : '') + '</div><div class="chips">' +
    o.choices.map(ch => '<button type="button" class="chip' + (isPicked(o, ch[0]) ? ' on' : '') + '" data-act="opt" data-k="' + o.key + '" data-c="' + ch[0] + '" aria-pressed="' + isPicked(o, ch[0]) + '">' + esc(ch[1]) + '</button>').join('') + '</div></div>').join('');
  const text = '<div class="field" style="margin-bottom:6px"><textarea id="ltText" rows="11" spellcheck="true" aria-label="Letter wording">' + esc(d.text) + '</textarea>' +
    '<div class="hint">Change anything you like. <button type="button" class="linkBtn' + (d.edited ? '' : ' hidden') + '" id="resetText" data-act="resetText">Put the suggested wording back</button></div></div>';
  const look = '<div class="lhGrid">' + LETTERHEADS.map(l => '<button type="button" class="lhOpt' + (d.letterhead === l[0] ? ' on' : '') + '" data-act="letterhead" data-v="' + l[0] + '" aria-pressed="' + (d.letterhead === l[0]) + '"><span class="lhPic lh-' + l[0] + '"><i></i><i></i></span><b>' + esc(l[1]) + '</b></button>').join('') + '</div>' +
    '<div class="field" style="margin-top:12px"><label for="ltDate">Date on the letter</label><input id="ltDate" data-d="date" type="date" value="' + esc(d.date || todayISO()) + '" style="max-width:200px"></div>' +
    '<div class="flabel">X-rays or photos to print with the letter <span class="opt">optional</span></div><div id="imgList" class="imgList">' + imagesHTML() + '</div>';
  return '<div class="bWrap"><div class="formCol">' +
    '<button class="btn-ghost btn" data-act="startOver" style="margin:0 0 8px -8px">' + ic('back', 15) + 'Different letter</button>' +
    sec(++n, 'Patient', patient) +
    sec(++n, 'Doctor it goes to', '<div id="docPick"></div>') +
    (letter.teeth === TEETH_NONE ? '' : sec(++n, letter.teeth === TEETH_REQUIRED ? 'Teeth' : 'Teeth (if it involves specific teeth)', chartHTML())) +
    sec(++n, 'Details', opts) +
    sec(++n, 'Wording', text) +
    sec(++n, 'Look', look) +
    '</div><div class="paperCol"><div class="paperBar"><div id="probs" class="probs"></div>' +
    '<button class="btn btn-pri" data-act="print" id="printBtn">' + ic('print', 17) + 'Print or save as PDF</button></div>' +
    '<div class="paperScroll"><div id="paper" class="paper"></div></div></div></div>';
}
function isPicked(o, c) { const v = S.draft.opt[o.key]; return o.multi ? Array.isArray(v) && v.includes(c) : v === c; }
function chartHTML() {
  const d = S.draft;
  const tooth = id => { const t = TEETH[id]; const kind = t.name.split(' ').slice(-1)[0];
    return '<button type="button" class="tooth t-' + kind + (t.upper ? ' up' : ' lo') + (d.teeth.includes(id) ? ' on' : '') + '" data-act="tooth" data-id="' + id + '" title="' + esc(capFirst(t.name)) + '" aria-label="' + esc(t.name) + '" aria-pressed="' + d.teeth.includes(id) + '"><span>' + esc(d.notation === 'fdi' ? t.fdi : t.id) + '</span></button>'; };
  const row = (ids, cls) => '<div class="tRow ' + cls + '">' + ids.map((id, i) => (i === ids.length / 2 ? '<span class="mid"></span>' : '') + tooth(id)).join('') + '</div>';
  return '<div class="chart" id="chart"><div class="sideLbl"><span>Patient’s right</span><b>Upper teeth</b><span>Patient’s left</span></div>' +
    row(CHART_ROWS.upper, 'perm') + row(CHART_ROWS.upperPrimary, 'prim') + '<div class="arch"><span></span></div>' + row(CHART_ROWS.lowerPrimary, 'prim') + row(CHART_ROWS.lower, 'perm') +
    '<div class="sideLbl" style="padding:6px 4px 0"><span></span><b>Lower teeth</b><span></span></div></div>' +
    '<div class="chartFt"><div id="teethSay" class="teethSay">' + teethSay() + '</div>' +
    '<div class="seg" role="group" aria-label="Tooth numbering"><button type="button" class="' + (d.notation === 'universal' ? 'on' : '') + '" data-act="notation" data-v="universal">1–32 / A–T</button><button type="button" class="' + (d.notation === 'fdi' ? 'on' : '') + '" data-act="notation" data-v="fdi">FDI</button></div></div>';
}
function teethSay() { const t = sortTeeth(S.draft.teeth); return t.length ? '<b>' + t.length + ' picked:</b> ' + esc(teethText(t, S.draft.notation)) + ' <button type="button" class="linkBtn" data-act="clearTeeth">Clear</button>' : '<span class="muted">' + esc((letterById(S.draft.letter) || {}).teethHint || 'Click the teeth. Small letters in the middle rows are baby teeth.') + '</span>'; }
function imagesHTML() {
  return S.draft.images.map((im, i) => '<div class="imgChip"><img src="' + im.src + '" alt=""><span>' + esc(im.name) + '</span><button type="button" class="iconBtn" data-act="rmImage" data-i="' + i + '" aria-label="Remove ' + esc(im.name) + '">' + ic('x', 15) + '</button></div>').join('') +
    '<label class="btn btn-sec btn-sm imgAdd">' + ic('image', 15) + 'Add an image<input type="file" id="imgFile" accept="image/png,image/jpeg" multiple hidden></label>';
}

/* the doctor picker: search the directory, or add someone new */
function renderDocPick() {
  const el = $('#docPick'); if (!el) return;
  const d = S.draft, letter = letterById(d.letter);
  if (d.doc) {
    const doc = d.doc, lines = docBlock(doc);
    el.innerHTML = '<div class="docCard"><div class="grow"><b>' + esc(lines[0] || '') + '</b>' + lines.slice(1).map(l => '<span>' + esc(l) + '</span>').join('') +
      (validEmail(doc.email) ? '<span class="docMail">' + ic('email', 14) + esc(doc.email) + ' <button type="button" class="linkBtn" data-act="copyVal" data-v="' + esc(doc.email) + '">Copy</button></span>' : '<span class="docMail none">No email on file — print and fax or mail this one</span>') +
      '</div><div class="docBtns"><button type="button" class="btn btn-sec btn-sm" data-act="changeDoc">Change</button>' + (d.docId ? '<button type="button" class="btn-ghost btn" data-act="editDoc" data-id="' + esc(d.docId) + '">Edit</button>' : '<button type="button" class="btn-ghost btn" data-act="editHandDoc">Edit</button>') + '</div></div>';
    return;
  }
  const all = liveDocs().filter(x => !x.off);
  const fit = x => letter.to.includes(x.type) ? 0 : 1;
  const hits = sortDocs(all.filter(x => docMatches(x, S.docQ))).sort((a, b) => fit(a) - fit(b)).slice(0, 7);
  const keep = document.activeElement && document.activeElement.id === 'docQ';
  el.innerHTML = (S.docsErr ? '<div class="note amber">' + esc(S.docsErr) + '</div>' : '') +
    '<div class="searchBox" style="max-width:none;margin:0 0 8px">' + ic('search', 16) + '<input id="docQ" type="search" autocomplete="off" placeholder="' + (all.length ? 'Type a doctor, office or city' : 'No doctors in the directory yet') + '" value="' + esc(S.docQ) + '" aria-label="Find a doctor"' + (all.length ? '' : ' disabled') + '></div>' +
    '<div class="docHits" id="docHits">' + (!S.docsReady ? '<div class="small muted" style="padding:8px">Opening the directory…</div>' :
      hits.map(x => '<button type="button" class="docHit" data-act="pickDoc" data-id="' + esc(x.id) + '"><b>' + esc(docListName(x)) + '</b><span>' + esc([x.practice, x.city].filter(Boolean).join(' · ')) + '</span><span class="badge t-misc">' + esc(x.type) + '</span></button>').join('') ||
      (all.length ? '<div class="small muted" style="padding:8px">Nobody matches “' + esc(S.docQ) + '”.</div>' : '')) + '</div>' +
    '<button type="button" class="btn btn-sec btn-sm" data-act="newDoc" style="margin-top:8px">' + ic('plus', 15) + 'Add a doctor who isn’t listed</button>';
  if (keep) { const q = $('#docQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

/* ---------- the letter on paper ---------- */
function paperHTML(d, cfg) {
  const letter = letterById(d.letter); if (!letter) return '';
  const paras = String(d.text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const name = [d.first, d.last].map(s => (s || '').trim()).filter(Boolean).join(' ');
  const blank = t => '<span class="blank">' + esc(t) + '</span>';
  let head = '';
  if (d.letterhead === 'logo') head = '<div class="lh lh-logo"><img src="nlo-logo-wide.png" alt="' + esc(cfg.practice) + '"><div>' + esc([cfg.addr1, cfg.addr2, cfg.phone].join('  ·  ')) + '</div></div>';
  else if (d.letterhead === 'side') head = '<div class="lh lh-side"><img src="nlo-logo-wide.png" alt="' + esc(cfg.practice) + '"><div>' + esc(cfg.addr1) + '<br>' + esc(cfg.addr2) + '<br>' + esc(cfg.phone) + '</div></div>';
  else head = '<div class="lh lh-plain"><span>Blank here for your pre-printed letterhead</span></div>';
  const to = d.doc ? docBlock(d.doc) : [];
  return head +
    '<div class="pDate">' + esc(fmtLong(d.date || todayISO())) + '</div>' +
    '<div class="pTo">' + (to.length ? to.map(esc).join('<br>') : blank('Doctor’s name and address')) + '</div>' +
    '<div class="pRe"><div>RE: <b>' + (name ? esc(name) : blank('Patient name')) + '</b></div><div>DOB: ' + (d.dob && validDob(d.dob) ? esc(fmtDob(d.dob)) : blank('date of birth')) + '</div>' +
    ((d.rpPhone || '').trim() ? '<div>Responsible Party Phone: ' + esc(d.rpPhone.trim()) + '</div>' : '') + '</div>' +
    '<div class="pSub">Subject: ' + esc(letter.subject) + '</div>' +
    '<div class="pDear">' + esc(docSalute(d.doc)) + ',</div>' +
    paras.map(p => '<p>' + esc(p).replace(/\[choose the teeth\]/g, '<span class="blank">choose the teeth</span>').replace(/\n/g, '<br>') + '</p>').join('') +
    '<div class="pSign"><div>Sincerely,</div><div class="sigGap"></div><div>' + esc(cfg.doctor) + '</div><div>' + esc(cfg.practice) + '</div>' +
    (d.images.length ? '<div class="pEncl">Enclosure' + (d.images.length > 1 ? 's (' + d.images.length + ')' : '') + '</div>' : '') + '</div>' +
    d.images.map(im => '<div class="pImg"><img src="' + im.src + '" alt="' + esc(im.name) + '"><div>' + esc(name) + (d.dob && validDob(d.dob) ? ' · DOB ' + esc(fmtDob(d.dob)) : '') + '</div></div>').join('');
}
function updatePaper() {
  const p = $('#paper'); if (!p) return;
  p.innerHTML = paperHTML(S.draft, S.office);
  const probs = draftProblems(S.draft), el = $('#probs');
  if (el) el.innerHTML = probs.length ? '<span class="probN">' + probs.length + '</span>' + esc(probs[0]) : '<span class="probOk">' + ic('check', 15) + 'Ready to print</span>';
}
/* the suggested wording follows the clicks until someone types in the box */
function regenText() {
  const d = S.draft; if (d.edited) return;
  d.text = letterText(d, S.office);
  const ta = $('#ltText'); if (ta && ta.value !== d.text) ta.value = d.text;
}

/* ---------- Doctors ---------- */
function doctorsHTML() {
  const all = liveDocs(), shown = sortDocs(all.filter(d => (S.showOff || !d.off) && (!S.typeF || d.type === S.typeF) && docMatches(d, S.q)));
  const types = DOC_TYPES.filter(t => all.some(d => d.type === t));
  const noMail = all.filter(d => !d.off && !validEmail(d.email)).length;
  let h = (S.docsErr ? '<div class="note amber">' + esc(S.docsErr) + '</div>' : '') +
    '<div class="filters"><select data-chg="typeF" aria-label="Type"><option value="">All types</option>' + types.map(t => '<option' + (S.typeF === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
    '<label class="chk"><input type="checkbox" data-chg="showOff"' + (S.showOff ? ' checked' : '') + '> Show hidden</label><span style="flex:1"></span>' +
    (isOwner() ? '<button class="btn btn-sec btn-sm" data-act="importDocs">' + ic('import', 15) + 'Import from Edge</button>' : '') +
    (all.length ? '<button class="btn btn-sec btn-sm" data-act="exportDocs">' + ic('download', 15) + 'Export</button>' : '') +
    '<button class="btn btn-pri btn-sm" data-act="newDoc" ' + (S.docsErr ? 'disabled' : '') + '>' + ic('plus', 15) + 'Add a doctor</button></div>';
  if (!S.docsReady) return h + '<div class="card"><div class="empty">Opening the directory…</div></div>';
  if (!all.length) return h + '<div class="card"><div class="empty"><b>No doctors yet.</b><br>' + (isOwner() ? 'Use “Import from Edge” to bring in the list exported from Edge, or add them one at a time.' : 'Dr. A can import the list from Edge, or you can add doctors one at a time.') + '</div></div>';
  h += '<div class="small muted" style="margin:0 2px 8px">' + shown.length + ' of ' + all.length + ' shown' + (noMail ? ' · ' + noMail + ' have no email' : '') + '</div>';
  h += '<div class="card"><div class="tblWrap"><table class="tbl"><thead><tr><th>Doctor</th><th>Office</th><th>City</th><th>Email</th><th>Type</th></tr></thead><tbody>' +
    (shown.slice(0, 400).map(d => '<tr class="click' + (d.off ? ' offRow' : '') + '" data-act="editDoc" data-id="' + esc(d.id) + '" tabindex="0"><td class="pt">' + esc(docListName(d)) + (d.off ? ' <span class="badge t-misc">Hidden</span>' : '') + '</td><td>' + esc(d.practice) + '</td><td>' + esc(d.city) + '</td><td>' +
      (validEmail(d.email) ? esc(d.email) : '<span class="badge t-retx">No email</span>') + '</td><td><span class="badge t-misc">' + esc(d.type) + '</span></td></tr>').join('') || '<tr><td colspan="5"><div class="empty">Nobody matches.</div></td></tr>') +
    '</tbody></table></div></div>' + (shown.length > 400 ? '<div class="small muted" style="margin-top:8px">Showing the first 400. Search to narrow it down.</div>' : '');
  return h;
}
function docModal(id, opt) {
  opt = opt || {};
  const cur = id ? S.docs.get(id) : (opt.doc || blankDoc()); if (!cur) return;
  const f = (k, label, extra) => '<div class="field"><label for="dc-' + k + '">' + label + '</label><input id="dc-' + k + '" data-k="' + k + '" autocomplete="off" value="' + esc(cur[k] || '') + '" ' + (extra || '') + '></div>';
  openModal('<h3>' + (id ? 'Edit doctor' : 'Add a doctor') + '</h3><div class="lsub">' + (opt.hand ? 'The directory isn’t available yet, so this doctor is used for this letter only.' : 'Saved to the office’s doctor directory (encrypted).') + '</div>' +
    '<form id="docForm"><div class="grid3"><div class="field"><label for="dc-type">Type</label><select id="dc-type" data-k="type">' + DOC_TYPES.map(t => '<option' + (cur.type === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></div>' +
    f('first', 'First name') + f('last', 'Last name') + '</div>' +
    f('practice', 'Office name') + '<div class="grid2">' + f('addr1', 'Address') + f('addr2', 'Suite / line 2') + '</div>' +
    '<div class="grid2">' + f('city', 'City, state and zip', 'placeholder="Gainesville, FL 32607"') + f('phone', 'Phone', 'type="tel"') + '</div>' +
    '<div class="grid2">' + f('email', 'Email', 'type="email" inputmode="email"') + f('salute', 'Greeting <span class="opt">optional</span>', 'placeholder="Dear Dr. ' + esc(cur.last || 'Smith') + '"') + '</div>' +
    '<div class="field"><label for="dc-note">Note for the office <span class="opt">never printed</span></label><input id="dc-note" data-k="note" autocomplete="off" value="' + esc(cur.note || '') + '"></div>' +
    (id ? '<label class="chk" style="margin-bottom:6px"><input type="checkbox" id="dc-off"' + (cur.off ? ' checked' : '') + '> Hide this doctor from the picker (retired, moved, duplicate)</label>' : '') +
    '<div class="mFt">' + (id && isOwner() ? '<button type="button" class="btn-ghost btn" data-act="delDoc" data-id="' + esc(id) + '" style="margin-right:auto;color:var(--coral-700)">' + ic('trash', 15) + 'Delete</button>' : '') +
    '<button type="button" class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" type="submit">' + (id ? 'Save' : opt.use ? 'Add and use' : 'Add') + '</button></div></form>', w => {
      $('#docForm', w).onsubmit = async e => {
        e.preventDefault(); const data = blankDoc();
        $$('[data-k]', w).forEach(i => { data[i.dataset.k] = i.value; });
        if ($('#dc-off', w)) data.off = $('#dc-off', w).checked;
        const clean = cleanDoc(data);
        if (!clean.last && !clean.practice) return toast('Type a last name or an office name.', { bad: true });
        if (clean.email && !validEmail(clean.email)) return toast('That email doesn’t look right.', { bad: true });
        const btn = $('button[type=submit]', w); busyBtn(btn, true, 'Saving…');
        try {
          if (opt.hand) { S.draft.doc = clean; S.draft.docId = ''; closeModal(); renderDocPick(); updatePaper(); return; }
          if (id) { await B.saveDoc(id, clean); toast('Saved'); }
          else {
            const dupe = liveDocs().find(x => docKey(x) === docKey(clean));
            if (dupe) { busyBtn(btn, false); return toast(docListName(dupe) + ' is already in the directory.', { bad: true }); }
            const nid = await B.addDoc(clean); toast('Added to the directory');
            if (opt.use) { S.draft.docId = nid; S.draft.doc = Object.assign({ id: nid }, clean); }
          }
          closeModal();
          if (S.view === 'write') { if (id && S.draft.docId === id) S.draft.doc = Object.assign({ id }, clean); renderDocPick(); updatePaper(); } else renderView();
        } catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
      };
    });
}

/* import the list made from Edge's Professional List report (owner) */
function importModal() {
  S.imp = null;
  openModal('<h3>Import doctors from Edge</h3><div class="lsub">Choose the file <b>NLO_Provider_Directory_from_Edge.csv</b>. Doctors already in the directory are skipped, so it is safe to run again.</div>' +
    '<label class="btn btn-sec">' + ic('import', 16) + 'Choose the file<input type="file" id="impFile" accept=".csv,text/csv" hidden></label>' +
    '<div id="impInfo" style="margin-top:14px"></div><div class="mFt"><button type="button" class="btn btn-sec" data-act="closeModal">Close</button><button type="button" class="btn btn-pri" id="impGo" data-act="runImport" disabled>Import</button></div>');
}
function impInfo() {
  const el = $('#impInfo'); if (!el || !S.imp) return;
  const i = S.imp;
  el.innerHTML = i.err ? '<div class="note amber">' + esc(i.err) + '</div>' :
    '<div class="impNums"><div><b>' + i.fresh.length + '</b>new</div><div><b>' + i.have + '</b>already here</div><div><b>' + i.skipped + '</b>blank or repeated</div><div><b>' + i.fresh.filter(d => !d.email).length + '</b>new without email</div></div>' +
    (i.busy ? '<div class="bar"><i id="impBar" style="width:0"></i></div>' : '');
  const go = $('#impGo'); if (go) go.disabled = !!i.err || !i.fresh.length || !!i.busy;
}

/* ---------- Settings (owner) ---------- */
function settingsHTML() {
  const o = S.office;
  const f = (k, label, hint) => '<div class="field"><label for="st-' + k + '">' + label + '</label><input id="st-' + k + '" data-k="' + k + '" autocomplete="off" value="' + esc(o[k]) + '">' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  return '<div class="card" style="max-width:720px"><div class="cardHd"><h3>What every letter says</h3></div><div class="cardBd"><form id="setForm">' +
    '<div class="grid2">' + f('doctor', 'Signed by') + f('practice', 'Practice name') + '</div>' +
    '<div class="grid2">' + f('addr1', 'Address') + f('addr2', 'City, state and zip') + '</div>' +
    '<div class="grid2">' + f('phone', 'Phone') + f('records', 'Where reports should be sent', 'Printed in every letter’s “please send your report to” sentence.') + '</div>' +
    '<div class="grid2"><div class="field"><label for="st-letterhead">Letterhead to start with</label><select id="st-letterhead" data-k="letterhead">' + LETTERHEADS.map(l => '<option value="' + l[0] + '"' + (o.letterhead === l[0] ? ' selected' : '') + '>' + esc(l[1]) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="st-notation">Tooth numbering to start with</label><select id="st-notation" data-k="notation"><option value="universal"' + (o.notation === 'universal' ? ' selected' : '') + '>Universal (1–32, A–T)</option><option value="fdi"' + (o.notation === 'fdi' ? ' selected' : '') + '>FDI (11–48, 51–85)</option></select><div class="hint">Either way the letter also spells the tooth out in words.</div></div></div>' +
    '<div class="mFt" style="justify-content:flex-start"><button class="btn btn-pri" type="submit">Save</button></div></form></div></div>';
}

/* ---------- modals ---------- */
function openModal(html, onReady) {
  closeModal();
  const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(w);
  const f = $('input:not([type=hidden]):not([type=file]),select,textarea', w); if (f) f.focus();
  if (onReady) onReady(w);
  return w;
}
function closeModal() { const w = $('#modalWrap'); if (w) w.remove(); }
function confirmBox(title, text, okLabel, danger) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="lsub" style="font-size:13.5px;color:var(--grey-600)">' + esc(text) + '</p><div class="mFt"><button class="btn btn-sec" id="cbNo">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel) + '</button></div>', w => {
      $('#cbNo', w).onclick = () => { closeModal(); res(false); }; $('#cbYes', w).onclick = () => { closeModal(); res(true); }; $('#cbYes', w).focus();
    });
  });
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { }
  try { const t = document.createElement('textarea'); t.value = s; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch (e) { return false; }
}
function draftTouched() { const d = S.draft; return !!(d.first || d.last || d.dob || d.doc || d.teeth.length || d.edited || d.images.length || Object.keys(d.opt).length); }
/* a picture is shrunk in the browser before it goes on the page: big enough to read, small enough to print quickly */
function readImage(file) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onerror = () => rej(new Error('Couldn’t read ' + file.name));
    r.onload = () => { const im = new Image(); im.onerror = () => rej(new Error(file.name + ' isn’t a picture this page can open.'));
      im.onload = () => { const max = 2000, k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res({ name: file.name, src: c.toDataURL('image/jpeg', 0.9) }); };
      im.src = r.result; };
    r.readAsDataURL(file);
  });
}

/* ---------- actions ---------- */
Object.assign(ACT, {
  nav(t) { S.view = t.dataset.v; S.q = ''; S.qFocus = false; closeModal(); renderView(); window.scrollTo(0, 0); },
  pickLetter(t) { const keep = S.draft; S.draft = Object.assign(blankDraft(t.dataset.id, S.office), { first: keep.first, last: keep.last, dob: keep.dob, rpPhone: keep.rpPhone, docId: keep.docId, doc: keep.doc }); S.docQ = ''; regenText(); renderView(); window.scrollTo(0, 0); },
  async startOver() {
    if (draftTouched() && !(await confirmBox('Start a different letter?', 'What you picked for this letter is cleared. The patient and the doctor stay filled in.', 'Different letter'))) return;
    const k = S.draft; S.draft = Object.assign(blankDraft('', S.office), { first: k.first, last: k.last, dob: k.dob, rpPhone: k.rpPhone, docId: k.docId, doc: k.doc }); renderView(); window.scrollTo(0, 0);
  },
  opt(t) {
    const letter = letterById(S.draft.letter), o = letter.opts.find(x => x.key === t.dataset.k), c = t.dataset.c, d = S.draft;
    if (o.multi) { const a = Array.isArray(d.opt[o.key]) ? d.opt[o.key].slice() : []; const i = a.indexOf(c); if (i < 0) a.push(c); else a.splice(i, 1); d.opt[o.key] = o.choices.map(ch => ch[0]).filter(k => a.includes(k)); }
    else d.opt[o.key] = d.opt[o.key] === c ? '' : c;
    $$('.chip[data-k="' + o.key + '"]').forEach(b => { const on = isPicked(o, b.dataset.c); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    regenText(); updatePaper();
  },
  tooth(t) {
    const d = S.draft, id = t.dataset.id, i = d.teeth.indexOf(id);
    if (i < 0) d.teeth.push(id); else d.teeth.splice(i, 1);
    t.classList.toggle('on', i < 0); t.setAttribute('aria-pressed', i < 0);
    $('#teethSay').innerHTML = teethSay(); regenText(); updatePaper();
  },
  clearTeeth() { S.draft.teeth = []; $$('.tooth.on').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }); $('#teethSay').innerHTML = teethSay(); regenText(); updatePaper(); },
  notation(t) {
    S.draft.notation = t.dataset.v; const sec = $('#chart').closest('.bSec'); const h4 = sec.querySelector('h4').outerHTML; sec.innerHTML = h4 + chartHTML();
    regenText(); updatePaper(); if (S.draft.edited) toast('The numbers in your edited wording were left as you typed them.');
  },
  letterhead(t) { S.draft.letterhead = t.dataset.v; $$('.lhOpt').forEach(b => { const on = b.dataset.v === t.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); updatePaper(); },
  resetText() { S.draft.edited = false; regenText(); $('#resetText').classList.add('hidden'); updatePaper(); },
  pickDoc(t) { const doc = S.docs.get(t.dataset.id); if (!doc) return; S.draft.docId = doc.id; S.draft.doc = doc; S.docQ = ''; renderDocPick(); updatePaper(); },
  changeDoc() { S.draft.docId = ''; S.draft.doc = null; renderDocPick(); updatePaper(); const q = $('#docQ'); if (q) q.focus(); },
  newDoc() {
    const hand = !!S.docsErr && S.view === 'write';
    const seed = blankDoc(); const letter = letterById(S.draft.letter); if (S.view === 'write' && letter) seed.type = letter.to[0];
    docModal(null, { use: S.view === 'write', hand, doc: seed });
  },
  editDoc(t) { docModal(t.dataset.id); },
  editHandDoc() { docModal(null, { hand: true, doc: S.draft.doc }); },
  async delDoc(t) {
    const d = S.docs.get(t.dataset.id); if (!d) return;
    if (!(await confirmBox('Delete ' + docListName(d) + '?', 'This removes the doctor from the directory for everyone. To keep the record but stop offering it, use “Hide” instead.', 'Delete', true))) return;
    try { await B.deleteDoc(d.id); if (S.draft.docId === d.id) { S.draft.docId = ''; S.draft.doc = null; } toast('Deleted'); renderView(); } catch (e) { toast(errText(e), { bad: true }); }
  },
  importDocs() { importModal(); },
  async runImport() {
    const i = S.imp; if (!i || !i.fresh.length || i.busy) return;
    i.busy = true; impInfo();
    try {
      await B.addDocs(i.fresh, (n, tot) => { const b = $('#impBar'); if (b) b.style.width = Math.round(n / tot * 100) + '%'; });
      toast(i.fresh.length + ' doctors added'); closeModal(); S.imp = null; renderView();
    } catch (e) { i.busy = false; i.err = errText(e) + ' Some doctors may have been added; choose the file again to add the rest.'; impInfo(); }
  },
  exportDocs() {
    const blob = new Blob(['﻿' + docsToCSV(liveDocs())], { type: 'text/csv' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'NLO_doctor_directory_' + todayISO() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  rmImage(t) { S.draft.images.splice(Number(t.dataset.i), 1); $('#imgList').innerHTML = imagesHTML(); updatePaper(); },
  async print() {
    const probs = draftProblems(S.draft);
    if (probs.length && !(await confirmBox('Print it anyway?', probs.join(' '), 'Print anyway'))) return;
    document.body.classList.add('printing');
    const title = document.title; document.title = [letterById(S.draft.letter).label + ' letter', (S.draft.last || '').trim(), (S.draft.first || '').trim()].filter(Boolean).join(' - ');
    const imgs = $$('#paper img'); await Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    window.print(); document.title = title;
    setTimeout(() => document.body.classList.remove('printing'), 500);
  },
  closeModal() { closeModal(); },
  lock() { lockOut('Locked. Sign in to continue.'); },
  lockSignOut() { B.signOut().then(() => lockScreen('login')); },
  forgot() { lockScreen('forgot'); },
  toLogin() { lockScreen('login'); },
  copyVal(t) { copyText(t.dataset.v).then(ok => toast(ok ? 'Copied' : 'Couldn’t copy — select it and copy by hand', ok ? {} : { bad: true })); }
});
Object.assign(CHG, {
  typeF(t) { S.typeF = t.value; S.qFocus = false; renderView(); },
  showOff(t) { S.showOff = t.checked; S.qFocus = false; renderView(); }
});
function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button' && t.type !== 'submit')) return;
  if (ACT[t.dataset.act]) ACT[t.dataset.act](t, e);
}
async function onChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.chg && CHG[t.dataset.chg]) return CHG[t.dataset.chg](t, e);
  if (t.id === 'imgFile') {
    for (const f of Array.from(t.files || []).slice(0, 6 - S.draft.images.length)) { try { S.draft.images.push(await readImage(f)); } catch (x) { toast(x.message, { bad: true }); } }
    t.value = ''; if ($('#imgList')) { $('#imgList').innerHTML = imagesHTML(); updatePaper(); } return;
  }
  if (t.id === 'impFile' && t.files && t.files[0]) {
    try {
      const r = docsFromCSV(await t.files[0].text()); const have = new Set(liveDocs().map(docKey));
      const fresh = r.docs.filter(d => !have.has(docKey(d)));
      S.imp = { fresh, have: r.docs.length - fresh.length, skipped: r.skipped, err: r.docs.length ? '' : 'No doctors were found in that file. It should be the CSV with the columns Type, Last, First, Practice, Address, City/State/Zip, Email, Phone.' };
    } catch (x) { S.imp = { fresh: [], have: 0, skipped: 0, err: 'That file couldn’t be read.' }; }
    impInfo();
  }
}
function onInput(e) {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; S.qFocus = true; renderView(); return; }
  if (t.id === 'docQ') { S.docQ = t.value; renderDocPick(); return; }
  if (t.id === 'ltText') { S.draft.text = t.value; S.draft.edited = t.value !== letterText(S.draft, S.office); $('#resetText').classList.toggle('hidden', !S.draft.edited); updatePaper(); return; }
  if (t.dataset && t.dataset.d && $('#paper')) { S.draft[t.dataset.d] = t.value; if (t.dataset.d === 'first') regenText(); updatePaper(); }
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'setForm') return;
  e.preventDefault(); const cfg = {}; $$('[data-k]', e.target).forEach(i => { cfg[i.dataset.k] = i.value.trim(); });
  if (!validEmail(cfg.records)) return toast('“Where reports should be sent” needs to be an email address.', { bad: true });
  const btn = $('button[type=submit]', e.target); busyBtn(btn, true, 'Saving…');
  try { await B.saveOffice(officeCfg(cfg)); toast('Saved'); } catch (x) { toast(errText(x), { bad: true }); }
  busyBtn(btn, false);
});
