/* =====================================================================
   UI — sign-in, opening the A/R key, live updates, the app shell and
   the small pieces every screen uses. The screens are in views.js, the
   account panel in panel.js, Settings / My account in admin.js.
   ===================================================================== */
const S = {
  demo: false, emu: false, tour: '', inApp: false, arState: '', view: 'today', q: '',
  tab: { pd: 'lad', ins: 'chase', cr: 'work' }, f: { src: '', work: '', who: '' }, sort: { k: '', dir: 1 }, ladStep: '', ladVer: 0,
  settings: { idleMin: 10 }, cfg: arCfg({}), roster: [], team: [],
  reports: [], rep: null, repId: '', prev: null, prevId: '', accts: [], byKey: new Map(), diff: null,
  items: new Map(), itemByKey: new Map(), keyIds: new Map(), pend: {}, srv: {},
  openKey: '', ui: {}, imp: null, doneLoaded: false, people: null, accessBusy: '', rotating: null,
  lastLogin: '', loginPw: '', lastAct: Date.now(), idleTimer: null, renderQ: false, firstLoad: true, loadErr: ''
};
let B = null;
const ACT = Object.create(null); // click actions: data-act="name" → ACT.name(target, event)
const CHG = Object.create(null); // change handlers: data-chg="name"
const AR_RULES = ""; // the build puts the office's whole Firestore rules file here (for the owner's "publish the rules" card)

/* ---------- icons ---------- */
const IC = {
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 15l2.2 2 4.8-4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  shield: '<path d="M12 3l7 2.8v5.5c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.8z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 016.5 5H18v3"/><rect x="4" y="7.5" width="16.5" height="12" rx="2.5"/><path d="M16 13.5h2"/>',
  chart: '<path d="M4 20.5h16.5"/><path d="M6.5 17V11M11 17V6.5M15.5 17v-4M20 17V9"/>',
  import: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/><path d="M9 12h6M9 15.5h6"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.4 5.2-5.2"/>',
  call: '<path d="M6.2 3.8l2.6-.3 1.6 4.2-2 1.4a10.6 10.6 0 006.5 6.5l1.4-2 4.2 1.6-.3 2.6a2 2 0 01-2.1 1.7A16.5 16.5 0 014.5 5.9a2 2 0 011.7-2.1z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.5 11h10a5 5 0 010 10h-3"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  flag: '<path d="M6 21V4.5"/><path d="M6 4.5h11.5l-2.2 4 2.2 4H6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  note: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="M4 7l8 6 8-6"/>',
  text: '<path d="M5 5.5h14a1.5 1.5 0 011.5 1.5v8.5A1.5 1.5 0 0119 17H10l-4.5 3.5V17H5a1.5 1.5 0 01-1.5-1.5V7A1.5 1.5 0 015 5.5z"/><path d="M8 10h8M8 13h5"/>',
  sign: '<path d="M4 19.5h16"/><path d="M14.5 4.5l3 3-8.5 8.5H6v-3z"/>',
  ladder: '<path d="M7 3.5v17M17 3.5v17M7 7.5h10M7 12h10M7 16.5h10"/>',
  pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
  tour: '<circle cx="12" cy="12" r="8.5"/><path d="M10.3 8.7l5 3.3-5 3.3z"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.innerHTML = esc(msg) + (opt.action ? ' <button class="linkBtn" style="color:var(--mint);margin-left:10px;pointer-events:auto">' + esc(opt.action) + '</button>' : '');
  if (opt.action) el.querySelector('button').onclick = () => { opt.onAction(); el.remove(); };
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || (opt.action ? 8000 : 3800));
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
  if (/no-escrow/.test(c)) return 'There’s no recovery copy of the A/R key to restore from.';
  if (/need-date|need-note|bad-date|no-pub|too-big|not-ar|bad-file|pdf|step-done/.test(c)) return (e && e.message) || 'Check that and try again.';
  if (/nothing-to-undo/.test(c)) return 'Nothing to undo.';
  if (/permission/.test(c)) return 'Not allowed. Your access may have changed.';
  if (/gone/.test(c)) return 'That no longer exists.';
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}

/* ---------- boot ---------- */
/* leaving the page: nothing from A/R stays in the page the browser may keep for Back; coming back to it starts over */
window.addEventListener('pagehide', () => { if (S.inApp) { ['#view', '#topSlot', '#side', '#mobTop', '#mobNav'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; }); closeModal(); closeDrawer(); S.leftPage = true; } });
window.addEventListener('pageshow', e => { if (e.persisted && S.leftPage) location.reload(); });
function boot() {
  // A/R only runs as its own page: another page (even one of the office's) can't hold it in a frame and watch it
  if (window.top !== window.self) { document.body.innerHTML = '<p style="font:15px sans-serif;padding:24px">NLO A/R opens in its own tab. <a href="nlo-ar.html" target="_blank" rel="noopener">Open it</a>.</p>'; return; }
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = qs.has('demo'); S.emu = local && qs.has('emu');
  // practice mode for the new-user tour (tour.js): the demo, signed in as staff (or as Dr. A); the demo keeps its own settings
  S.tour = S.demo && ['staff', 'owner'].includes(qs.get('tour')) ? qs.get('tour') : '';
  if (S.demo) demoSandbox();
  let lockMsg = ''; try { lockMsg = sessionStorage.getItem('nloAR.lockMsg') || ''; sessionStorage.removeItem('nloAR.lockMsg'); } catch (e) { }
  try { S.lastLogin = localStorage.getItem('nloAR.lastLogin') || localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('#modalWrap')) closeModal(); else if (S.openKey) closeDrawer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.click[data-act], .dropZone')) { e.preventDefault(); e.target.click(); }
  });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  const first = lockMsg ? { ok: lockMsg } : {};
  if (S.demo) {
    B = DEMO; DEMO.practice = S.tour; $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo');
    if (S.tour) $('#demoBar').textContent = 'Practice — made-up accounts, nothing is saved';
    lockScreen('login', first);
    if (S.tour) setTimeout(() => { const b = $('#lgBtn'); if (b) b.click(); }, 60); // practice opens signed in
    return;
  }
  B = FB;
  if (!FB.init(S.emu)) { lockScreen('unconfigured'); return; }
  FB.onSync = renderSync;
  FB.ready().then(() => lockScreen('login', first));
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
      '<p class="desc">To look around with made-up accounts, open the demo.</p><a class="btn btn-pri btn-block" href="?demo">Open the demo</a>';
  } else if (mode === 'login') {
    h = '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · accounts receivable</div>' + err + ok +
      '<form id="loginForm" autocomplete="on" style="margin-top:16px">' +
      // practice mode (the tour): look-alike boxes, not real ones, so the browser never offers to save a "practice" password for this site
      (S.tour ? '<div class="field"><span class="flabel">Username</span><div class="inp" id="lgPracUser">practice</div></div>' +
        '<div class="field"><span class="flabel">Password</span><div class="inp" id="lgPracPw" aria-label="Password (filled in for practice)">••••••••</div></div>' :
      '<div class="field"><label for="lgUser">Username</label><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(S.demo ? 'demo' : S.lastLogin) + '" required></div>' +
      '<div class="field"><label for="lgPw">Password</label><input id="lgPw" type="password" autocomplete="current-password" ' + (S.demo ? 'value="demo"' : '') + ' required></div>') +
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
  const f = mode === 'login' && S.tour ? $('#lgBtn') : mode === 'login' && $('#lgUser').value ? $('#lgPw') : $('input:not([type=checkbox])', card);
  if (f) f.focus();
  bindLockForms();
}
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
function bindLockForms() {
  const lf = $('#loginForm');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const btn = $('#lgBtn'); const user = S.tour ? 'practice' : $('#lgUser').value.trim(); const pw = S.tour ? 'practice' : $('#lgPw').value;
    busyBtn(btn, true, 'Signing in…');
    try {
      const r = await B.signIn(user, pw);
      S.lastLogin = user; try { localStorage.setItem('nloAR.lastLogin', user); } catch (x) { }
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
async function enterApp() {
  Object.assign(S, {
    inApp: true, arState: 'opening', view: 'today', q: '', f: { src: '', work: '', who: '' }, sort: { k: '', dir: 1 }, ladStep: '', ladMemo: null,
    reports: [], rep: null, repId: '', prev: null, prevId: '', accts: [], byKey: new Map(), diff: null,
    items: new Map(), itemByKey: new Map(), keyIds: new Map(), pend: {}, srv: {}, openKey: '', ui: {}, imp: null, doneLoaded: false, people: null, accessBusy: '', rotating: null,
    firstLoad: true, loadErr: '', lastAct: Date.now(), team: [], roster: [], day: todayISO()
  });
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (S.inApp && !S.tour && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.'); // practice mode has nothing to hide
    else if (S.inApp) { updateTitle(); if (S.day !== todayISO()) { S.day = todayISO(); queueRender('day'); } } // a new day: day counts and the weekly report's banner move on
  }, 15000);
  let st;
  try { st = await B.arOpen(); } catch (e) { st = 'error'; S.loadErr = errText(e); }
  // the owner just used the recovery code to sign in: use it for the A/R key too
  if (st === 'stale' && isOwner() && B.lastCode) { try { await B.arRestore(B.lastCode); st = 'ok'; toast('A/R key restored with your recovery code'); } catch (e) { } }
  B.lastCode = '';
  if (!S.inApp) return;
  S.arState = st; renderShell();
  if (st === 'ok') startLive(); else renderView();
  // practice mode: the tour starts by itself once, and after Lock it picks up where it was
  if (S.tour && st === 'ok' && (!S.tourBegun || TOUR.paused)) { S.tourBegun = true; const from = TOUR.paused; TOUR.paused = null; setTimeout(() => { if (S.inApp && !TOUR.on) tourStart(S.tour, from); }, 600); }
}
function startLive() {
  S.arState = 'ok'; renderShell(); renderView();
  B.start({
    reports(list) { if (!S.inApp) return; list.forEach(r => { r.sum = normSum(r.sum); r.locked = r.locked || !r.sum; }); S.reports = list; loadLatest(); },
    items(up, gone) {
      if (!S.inApp) return;
      up.forEach(it => { it = normItem(it); if (S.pend[it.id]) { S.srv[it.id] = it; return; } S.items.set(it.id, it); });
      gone.forEach(id => { if (S.pend[id]) { S.srv[id] = 'gone'; return; } S.items.delete(id); });
      indexItems(); S.firstLoad = false; S.loadErr = ''; queueRender();
      if (S.openKey) refreshDrawer();
    },
    settings(s) { if (!S.inApp) return; S.settings = Object.assign({ idleMin: 10 }, s || {}); S.cfg = arCfg(S.settings); derive(); queueRender('settings'); },
    roster(list) { if (!S.inApp) return; S.roster = list; queueRender('team'); },
    team(sids) { if (!S.inApp) return; S.team = Array.isArray(sids) ? sids.filter(x => typeof x === 'string') : []; queueRender('team'); },
    revoked(kind) { lockOut(kind === 'ar' ? 'Your access to A/R was turned off.' : 'Your access was turned off.'); },
    rekeyed() { if (S.inApp && isOwner()) setTimeout(resealIfNeeded, 1500); },
    loadError(e) { S.firstLoad = false; S.loadErr = B.isPerm && B.isPerm(e) ? 'A/R can’t be read with this login (the rules may have changed — sign in again).' : errText(e); queueRender(); },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  });
  // accounts resolved in the last six months, so the lists show them as resolved (the live updates only carry open ones)
  B.loadDone(180).then(list => {
    if (!S.inApp) return;
    list.forEach(it => { if (!S.items.has(it.id) && !S.pend[it.id]) S.items.set(it.id, normItem(it)); });
    S.doneLoaded = true; indexItems(); queueRender(); if (S.openKey) refreshDrawer();
  }).catch(() => { });
  if (isOwner() && !S.demo) setTimeout(ownerUpkeep, 4000);
}
async function lockOut(msg) {
  if (!S.inApp) return;
  if (S.tour) { // practice mode: made-up accounts, so it locks in place — and signing back in picks the tour up again
    if (TOUR.on) msg = tourPause(msg);
    S.inApp = false; clearInterval(S.idleTimer); closeModal(); closeDrawer(true);
    ['#view', '#topSlot', '#side', '#mobTop', '#mobNav'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; });
    document.title = 'NLO A/R'; await B.signOut(); lockScreen('login', { ok: msg }); return;
  }
  S.inApp = false; clearInterval(S.idleTimer);
  closeModal(); closeDrawer(true);
  ['#view', '#topSlot', '#side', '#mobTop', '#mobNav'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; });
  document.title = 'NLO A/R';
  for (let i = 0; i < 30 && B.pending; i++) await new Promise(r => setTimeout(r, 100)); // let a save on its way finish
  await B.signOut();
  // start the page over, so nothing from A/R (names, balances, the key) is left in this tab's memory
  try { sessionStorage.setItem('nloAR.lockMsg', msg || ''); } catch (e) { }
  location.reload();
}

/* ---------- the reports: the latest one is what the lists show; the one before it says what changed ---------- */
async function loadLatest() {
  const L = S.reports.filter(r => !r.locked), cur = L[0] || null, seq = (S.loadSeq = (S.loadSeq || 0) + 1);
  const prev = cur ? L.find(r => r.id !== cur.id && r.asOf < cur.asOf) || null : null;
  // both reports are opened first, then shown together (the lists never mix a new report with the old one's accounts)
  let rep = S.rep, repId = S.repId, pv = S.prev, pvId = S.prevId;
  try {
    if (!cur) { rep = null; repId = ''; }
    else if (repId !== cur.id) { rep = normReport(await B.loadReport(cur.id)); repId = cur.id; }
    if (!prev) { pv = null; pvId = ''; }
    else if (pvId !== prev.id) { pv = normReport(await B.loadReport(prev.id)); pvId = prev.id; }
    if (!S.inApp || seq !== S.loadSeq) return; // signed out, or a newer list of reports came in meanwhile
    Object.assign(S, { rep, repId, prev: pv, prevId: pvId, loadErr: '' });
  } catch (e) { if (!S.inApp || seq !== S.loadSeq) return; S.loadErr = 'The latest report couldn’t be opened: ' + errText(e); }
  S.firstLoad = false; derive(); queueRender();
  if (S.openKey) refreshDrawer();
}
function derive() {
  S.accts = reportAccts(S.rep, S.cfg); S.byKey = new Map(S.accts.map(a => [a.key, a]));
  S.diff = S.rep && S.prev ? diffReports(S.rep, S.prev, S.cfg) : null; S.summ = null; S.ladVer++;
}
function indexItems() { S.itemByKey = new Map(); S.items.forEach(it => { if (it.key && !it.locked) S.itemByKey.set(it.key, it); }); S.ladVer++; }
function itemFor(key) { return S.itemByKey.get(key) || null; }

/* ---------- the collections ladder (handbook §14), worked out once per change for every patient account past due ---------- */
function ladAll() {
  const t = todayISO();
  if (S.ladMemo && S.ladMemo.v === S.ladVer && S.ladMemo.t === t) return S.ladMemo.m;
  const m = new Map();
  if (S.rep && S.rep.cover.pastDue) S.accts.forEach(a => {
    if (!onLadder(a)) return;
    const it = itemFor(a.key);
    if (it && it.state === 'done' && !isBack(it)) return; // resolved (it leaves the next report)
    m.set(a.key, ladState(a, isBack(it) ? null : it, S.rep.asOf, t));
  });
  S.ladMemo = { v: S.ladVer, t, m };
  return m;
}
function ladFor(a) { return a ? ladAll().get(a.key) || null : null; }
function ladDueAccts() { return S.accts.filter(a => { const l = ladFor(a); return l && l.due; }); }
function curRepMeta() { return S.reports.find(r => r.id === S.repId) || null; }

/* ---------- owner upkeep: logins reissued since, the recovery copy, anything under an older A/R key ---------- */
async function ownerUpkeep() {
  if (!S.inApp || !isOwner() || S.arState !== 'ok') return;
  try {
    const r = await B.arFixGrants();
    if (r.removed.length) toast('A/R taken off ' + r.removed.join(', ') + ' (no longer in the office) — a new A/R key was made', { ms: 7000 });
    if (r.relogin.length) toast(r.relogin.join(', ') + (r.relogin.length > 1 ? ' have' : ' has') + ' a new login (reissued in NLO Cases). Turn A/R on again in Settings if they should still have it.', { ms: 12000, action: 'Settings', onAction: () => ACT.nav({ dataset: { v: 'settings' } }) });
  } catch (e) { if (e.code !== 'busy') toast('Couldn’t finish checking who has A/R: ' + errText(e), { bad: true }); }
  resealIfNeeded();
}
async function resealIfNeeded() {
  if (!S.inApp || S.demo || !isOwner() || S.resealing || B.rotating || B.resealing || !B.ar) return;
  const old = S.reports.some(r => r.v < B.ar.curV) || Array.from(S.items.values()).some(it => it.v < B.ar.curV);
  if (!old) return;
  S.resealing = true;
  try { await B.arReseal(); } catch (e) { } finally { S.resealing = false; }
}

/* ---------- derived bits ---------- */
function meSid() { return B.me ? B.me.staffId : ''; }
function isOwner() { return B.isOwner(); }
function staff(sid) { return S.roster.find(r => r.sid === sid); }
function staffName(sid, fallback) { const r = staff(sid); return r ? (r.role === 'owner' ? 'Dr. A' : r.name) : (fallback || ''); }
/* a first name for lists (“Dr. A” stays whole) */
function shortName(sid) { const n = staffName(sid, sid); return n === 'Dr. A' ? n : firstName(n); }
/* the people accounts can be given to: everyone with A/R */
function arPeople() {
  const team = new Set(S.team.concat([meSid()]));
  return S.roster.filter(r => r.active && (team.has(r.sid) || r.role === 'owner')).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.name.localeCompare(b.name));
}
function matchesQ(a) {
  if (!S.q) return true; const q = S.q.toLowerCase().trim(), digits = q.replace(/\D/g, '');
  return [a.patient, a.rp, a.sts].some(x => String(x || '').toLowerCase().includes(q)) || (digits.length >= 3 && String((a.home || '') + ' ' + (a.work || '')).replace(/\D/g, '').includes(digits));
}
/* an open account record whose account isn't past due / in credit any more in the latest report (paid or fixed in Edge) */
function isCleared(it) {
  if (!S.rep || it.state !== 'open') return false;
  const a = S.byKey.get(it.key);
  if (it.src === 'ins' && !S.rep.cover.ins) return false;
  if (it.kind === 'cr') return S.rep.cover.credit && !(a && a.credit > 0);
  return S.rep.cover.pastDue && !(a && a.pd > 0);
}
/* resolved before the latest report was run, yet past due or in credit in it again: it needs working again */
function isBack(it) {
  if (!it || it.state !== 'done' || !S.rep || !S.byKey.has(it.key)) return false;
  return isoOf(new Date(it.resolvedAt || it.updatedAt || 0)) < S.rep.asOf;
}
function openItems() { return Array.from(S.items.values()).filter(it => !it.locked && it.state === 'open'); }
function dueItems() { const t = todayISO(); return openItems().filter(it => it.follow && it.follow <= t && !isCleared(it)); }
function counts() {
  const A = S.accts, t = todayISO(), due = dueItems();
  return {
    due: due.length, late: due.filter(it => it.follow < t).length,
    n91: A.filter(a => a.bucket === '91').length, chase: A.filter(a => a.tier === 'chase').length,
    cr: A.filter(a => a.credit > 0 && !a.prepay).length, drA: openItems().filter(it => it.drA).length,
    cleared: openItems().filter(isCleared).length, lad: ladDueAccts().length
  };
}

/* ---------- rendering ---------- */
/* live updates redraw the list screens; Settings, Reports (while importing) and My account keep what's being typed */
function queueRender(kind) {
  S.renderKinds = (S.renderKinds || new Set()); S.renderKinds.add(kind || 'data');
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => {
    S.renderQ = false; const kinds = S.renderKinds; S.renderKinds = new Set(); if (!S.inApp) return;
    renderNav(); updateTitle();
    if (S.view === 'settings' || S.view === 'account') return;
    if (S.view === 'reports' && S.imp) return;
    const a = document.activeElement; if (a && a.matches && a.matches('#view input:not(#q), #view textarea, #view select')) return;
    renderView();
  });
}
const NAV = [['today', 'Today', 'today'], ['pd', 'Past due', 'clock'], ['ins', 'Insurance', 'shield'], ['cr', 'Credits', 'wallet'], ['sum', 'Summary', 'chart'], ['reports', 'Reports', 'import']];
function renderShell() {
  const owner = isOwner(), live = S.arState === 'ok';
  const navBtns = mob => (live ? NAV.map(([k, l, i]) => '<button class="navBtn" data-act="nav" data-v="' + k + '" id="' + (mob ? 'm' : '') + 'nav-' + k + '">' + ic(i) + '<span>' + l + '</span><span class="cnt hidden"></span></button>').join('') : '') +
    (mob ? '' : '<div class="navLbl">Office</div>') +
    (owner && live ? '<button class="navBtn" data-act="nav" data-v="settings" id="' + (mob ? 'm' : '') + 'nav-settings">' + ic('gear') + '<span>Settings</span></button>' : '') +
    '<button class="navBtn" data-act="nav" data-v="account" id="' + (mob ? 'm' : '') + 'nav-account">' + ic('key') + '<span>My account</span></button>';
  $('#side').innerHTML = '<div class="sideTop"><img src="logo-white.png" alt="Next Level Orthodontics"><div class="appTag">A/R</div></div>' +
    '<nav class="nav" aria-label="Main">' + navBtns(false) + '</nav>' +
    '<div class="sideFoot"><div class="whoBox">' + avatarHTML(meSid(), B.me && B.me.name) + '<div><b>' + esc(B.me.name) + '</b>' + (owner ? 'Owner' : 'Staff') + '</div></div>' +
    '<a class="sideLink" href="nlo-cases.html">' + ic('next', 14) + 'Open NLO Cases</a>' +
    '<button class="sideLock" data-act="lock">' + ic('lock', 16) + 'Lock</button><div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img src="logo-white.png" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">A/R</span><span style="flex:1"></span>' +
    (live ? '<button class="iconBtn" style="color:#fff" data-act="nav" data-v="reports" aria-label="Import a report">' + ic('import') + '</button>' : '') + '<button class="iconBtn" style="color:#fff" data-act="lock" aria-label="Lock">' + ic('lock') + '</button>';
  $('#mobNav').innerHTML = navBtns(true);
  renderSync(); renderNav(); paintPhotos($('#side'));
}
function renderNav() {
  if (S.arState !== 'ok') { $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view)); return; }
  const c = counts();
  const set = (k, n, red) => ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + k + ' .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('red', !!red); });
  set('today', c.due + (isOwner() ? c.drA : 0), c.late > 0 || (isOwner() && c.drA > 0)); set('pd', c.lad, c.lad > 0); set('ins', c.chase, c.chase > 0); set('cr', c.cr);
  // the weekly report: Due on its day, Late after it, until it's imported
  const d = dueNow(), dt = d && d.state === 'late' ? 'Late' : d && d.state === 'today' ? 'Due' : '';
  set('reports', dt, dt === 'Late'); ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + 'reports .cnt'); if (el) el.classList.toggle('amber', dt === 'Due'); });
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
/* the tab title shows how many follow-ups and collection steps are due, so a pinned tab says when to look */
function updateTitle() {
  if (!S.inApp) return; const c = S.arState === 'ok' ? counts() : null, n = c ? c.due + c.lad : 0;
  document.title = (n ? '(' + n + ') ' : '') + 'NLO A/R';
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? (S.tour ? 'Practice' : 'Demo') + ' · nothing saved' : 'Live · encrypted';
  if (!navigator.onLine) { cls = 'bad'; t = 'Offline'; }
  else if (B && B.pending) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
const TITLES = { today: 'Today', pd: 'Past due', ins: 'Insurance', cr: 'Credit balances', sum: 'Summary', reports: 'Reports', settings: 'Settings', account: 'My account' };
const LIST_VIEWS = ['today', 'pd', 'ins', 'cr'];
function topBar() {
  return '<div class="topBar"><h2>' + esc(TITLES[S.view] || 'A/R') + '</h2>' +
    (S.arState === 'ok' && LIST_VIEWS.includes(S.view) ? '<label class="searchBox">' + ic('search', 17) + '<span class="hidden">Search</span><input id="q" type="search" placeholder="Search patient, family, phone…" value="' + esc(S.q) + '" aria-label="Search accounts"></label>' : '<span style="flex:1"></span>') +
    (S.arState === 'ok' && S.view !== 'reports' ? '<button class="btn btn-teal" data-act="nav" data-v="reports">' + ic('import', 16) + 'Import report</button>' : '') + '</div>';
}
function renderView() {
  const v = $('#view'); const active = document.activeElement && document.activeElement.id === 'q';
  let h = '';
  if (S.arState !== 'ok' && S.view !== 'account') h = gateHTML();
  else if (S.view === 'today') h = viewToday();
  else if (S.view === 'pd') h = viewPastDue();
  else if (S.view === 'ins') h = viewIns();
  else if (S.view === 'cr') h = viewCredits();
  else if (S.view === 'sum') h = viewSummary();
  else if (S.view === 'reports') h = viewReports();
  else if (S.view === 'settings') h = isOwner() ? viewSettings() : '';
  else if (S.view === 'account') h = viewAccount();
  $('#topSlot').innerHTML = topBar();
  v.innerHTML = h;
  paintPhotos(v);
  if (S.view === 'settings') afterSettings();
  if (S.view === 'reports') afterReports();
  if (active) { const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
}

/* ---------- before A/R is open: set it up, no access yet, restore the key, or publish the rules ---------- */
function gateHTML() {
  const st = S.arState, card = (title, body) => '<div class="card" style="max-width:640px"><div class="cardHd"><h3>' + title + '</h3></div><div class="cardBd">' + body + '</div></div>';
  if (st === 'opening') return '<div class="empty">Opening A/R…</div>';
  if (st === 'error') return card('Couldn’t open A/R', '<p class="small">' + esc(S.loadErr || 'Something went wrong.') + '</p><div class="btnRow"><button class="btn btn-pri btn-sm" data-act="retryOpen">' + ic('refresh', 15) + 'Try again</button></div>');
  const again = '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>';
  if (st === 'none') return card('A/R isn’t open to you yet', '<p class="small">A/R holds patients’ balances, so Dr. A chooses who can use it. Ask him to turn it on for you (A/R → Settings → Who can use A/R), then press Check again.</p><p class="small muted" style="margin-top:8px">Your login works for NLO Cases and NLO Leads as usual.</p>' + again);
  if (st === 'stale' && !isOwner()) return card('Your A/R key needs renewing', '<p class="small">Your login was renewed since Dr. A gave you A/R. It renews itself the next time Dr. A opens A/R — ask him to open it once, then press Check again.</p>' + again);
  if (st === 'setup') return card('Set up A/R', '<p class="small">A/R gets its own key, separate from the office key: only you, and the people you choose, can open the reports and notes in it. Your recovery code keeps a copy, so the key can’t be lost.</p>' +
    '<ol class="steps small"><li>Press <b>Set up A/R</b>.</li><li>Import this week’s <b>Accounts Receivable Aging</b> report from Edge (Reports).</li><li>Choose who else can use it (Settings → Who can use A/R) — e.g. the financial coordinator.</li></ol>' +
    '<button class="btn btn-pri" data-act="setupAR">' + ic('key', 16) + 'Set up A/R</button>');
  if (st === 'stale') return card('Restore the A/R key', '<p class="small">Your password was reset, so your copy of the A/R key needs your <b>recovery code</b> once (the one from NLO Cases).</p>' +
    '<form id="arRestoreForm" style="margin-top:12px"><div class="field"><label for="arCode">Recovery code</label><input id="arCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div>' +
    '<button class="btn btn-pri" type="submit">Restore</button></form>');
  if (st === 'rules') return rulesCardHTML(true);
  return '';
}
/* the owner publishes the updated rules himself (Claude never changes the project's security settings) */
function rulesText() { return AR_RULES.replace('__OWNER_EMAIL__', String((B.me && B.me.email) || '').toLowerCase()); }
function rulesCardHTML(first) {
  return '<div class="card rulesBox" style="max-width:720px"><div class="cardHd"><h3>' + (first ? 'One step before A/R can open' : 'Database rules') + '</h3></div><div class="cardBd">' +
    '<p class="small">The office database needs its updated rules — they add A/R and keep everything NLO Cases and NLO Leads already had. This is the same card NLO Cases shows when it needs newer rules.</p>' +
    '<ol class="steps small"><li>Press <b>Copy the new rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> (left menu) → <b>Rules</b> tab.</li><li>Select everything there, paste, and press <b>Publish</b>.</li><li>Come back and press <b>Check again</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button>' +
    '<a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore" target="_blank" rel="noopener noreferrer">Open the Firebase console</a>' +
    '<button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>' +
    '<details class="help"><summary>See the rules</summary><textarea readonly id="rulesTxt">' + esc(rulesText()) + '</textarea></details></div></div>';
}

/* ---------- small pieces ---------- */
function avatarHTML(sid, fallbackName) {
  const r = staff(sid);
  if (r && r.photo && /^data:image\//.test(r.photo)) return '<span class="av" title="' + esc(staffName(sid)) + '"><img alt="" data-photo="' + esc(sid) + '"></span>';
  const name = r ? r.name : fallbackName;
  return '<span class="av' + (name ? '' : ' none') + '" title="' + esc(name || 'Nobody') + '">' + esc(name ? (r && r.initials) || initials(name) : '–') + '</span>';
}
/* staff photos are set after render (no image data inside HTML strings) */
function paintPhotos(root) { $$('img[data-photo]', root || document).forEach(img => { const r = staff(img.dataset.photo); if (r && r.photo && /^data:image\//.test(r.photo)) img.src = r.photo; }); }
function srcBadge(a) { return '<span class="badge ' + (a.ins ? 's-ins' : 's-pt') + '">' + (a.ins ? 'Insurance' : 'Patient') + '</span>'; }
function stsBadge(a) { return a.sts ? '<span class="badge' + (a.inactive ? ' s-inact' : a.prepay ? ' s-pre' : '') + '" title="Edge status">' + esc(a.sts) + '</span>' : ''; }
function sugChip(s, short) { return s && s.l ? '<span class="sug ' + esc(s.tone || 'grey') + '"' + (short && s.s ? ' title="' + esc(s.l) + '">' + esc(s.s) : '>' + esc(s.l)) + '</span>' : ''; }
function tierChip(a) { const T = TIERS[a.tier]; return T ? '<span class="sug ' + T.tone + '" title="' + esc(T.l) + '">' + T.n + ' · ' + esc(T.s) + '</span>' : ''; }
/* a step of the collections ladder */
function ladChip(s) { return s ? '<span class="sug lad ' + esc(s.tone || 'grey') + '" title="' + esc(s.l) + '">' + esc(s.s) + '</span>' : ''; }
function followChip(d) {
  if (!d) return '';
  const n = dayDiff(d), tip = ' title="' + esc('Follow up ' + fmtDay(d)) + '"';
  if (n < 0) return '<span class="due over"' + tip + '>' + ic('clock', 13) + (n === -1 ? '1 day late' : (-n) + ' days late') + '</span>';
  if (n === 0) return '<span class="due soon"' + tip + '>' + ic('clock', 13) + 'Today</span>';
  if (n === 1) return '<span class="due"' + tip + '>Tomorrow</span>';
  if (n <= 6) return '<span class="due"' + tip + '>' + esc(fmtDay(d).split(',')[0]) + '</span>';
  return '<span class="due"' + tip + '>' + esc(fmtDate(d)) + '</span>';
}
/* the "Work" column: what's been done on the account */
function workCell(key) {
  const it = itemFor(key);
  if (!it) return '<span class="small muted">Not started</span>';
  if (isBack(it)) return '<span class="sug amber" title="' + esc('Resolved ' + fmtDate(isoOf(new Date(it.resolvedAt || it.updatedAt || 0))) + ' (' + (OUTCOMES[it.outcome] || 'resolved') + '), but still on the ' + fmtDate(S.rep.asOf) + ' report') + '">On the list again</span>';
  if (it.state === 'done') return '<span class="sug mint">' + ic('done', 13) + esc(OUTCOMES[it.outcome] || 'Resolved') + '</span>';
  const last = lastLog(it);
  return '<span class="workCell">' + (it.drA ? '<span class="sug amber">Needs Dr. A</span>' : '') + followChip(it.follow) +
    '<span class="small" title="' + esc(last ? logLabel(last) + ' · ' + fmtWhen(last.at) : '') + '">' + esc(last ? logLabel(last) : STAGES[it.stage || ''] || '') + '</span>' +
    (it.assignee ? avatarHTML(it.assignee) : '') + '</span>';
}
function workState(key) { const it = itemFor(key); if (!it || isBack(it)) return 'new'; if (it.state === 'done') return 'done'; if (it.follow && it.follow <= todayISO()) return 'due'; return 'working'; }
function phoneTxt(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); if (d.length === 11 && d[0] === '1') return phoneTxt(d.slice(1)); return String(p || '').trim(); }
function telHref(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 7 ? 'tel:' + (d.length === 10 ? '+1' + d : d) : ''; }

/* ---------- events ---------- */
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { }
  try {
    const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(errText(e), { bad: true }); return false; } }
Object.assign(ACT, {
  nav(t) {
    const v = t.dataset.v; if (!v) return;
    if (S.view === 'reports' && v !== 'reports' && S.imp && S.imp.files && S.imp.files.length && !confirm('Leave without saving this report?')) return;
    if (v !== 'reports') S.imp = null;
    S.view = v; if (t.dataset.tab) S.tab[v] = t.dataset.tab;
    S.f = { src: '', work: '', who: '' }; S.sort = { k: '', dir: 1 }; S.ladStep = t.dataset.step || '';
    closeDrawer(true); renderNav(); renderView(); window.scrollTo(0, 0);
  },
  tab(t) { S.tab[S.view] = t.dataset.t; S.sort = { k: '', dir: 1 }; S.ladStep = ''; renderView(); },
  clearF() { S.f = { src: '', work: '', who: '' }; renderView(); },
  sort(t) { const k = t.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (t.dataset.d === 'asc' ? 1 : -1) }; renderView(); },
  open(t) { openDrawer(t.dataset.key); },
  closeDrawer() { closeDrawer(); },
  closeModal() { closeModal(); },
  async lock() {
    if (B.pending && !(await confirmBox('Lock now?', 'A change is still being saved (is the internet connected?). Locking now may lose it.', 'Lock anyway', true))) return;
    lockOut('Locked. Sign in to continue.');
  },
  lockSignOut() { S.loginPw = ''; B.signOut().then(() => lockScreen('login')); },
  forgot() { lockScreen('forgot'); },
  toLogin() { lockScreen('login'); },
  copyVal(t) { copyText(t.dataset.v).then(ok => toast(ok ? 'Copied' : 'Couldn’t copy — select it and copy by hand', ok ? {} : { bad: true })); },
  async retryOpen() { S.arState = 'opening'; renderView(); let st; try { st = await B.arOpen(); } catch (e) { st = 'error'; S.loadErr = errText(e); } S.arState = st; renderShell(); if (st === 'ok') startLive(); else renderView(); },
  async setupAR(t) { busyBtn(t, true, 'Setting up…'); try { await B.arSetup(); toast('A/R is set up — import a report next'); S.view = 'reports'; startLive(); } catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); } },
  copyRules() { copyText(rulesText()).then(ok => toast(ok ? 'Rules copied — paste them in the Firebase console and press Publish' : 'Couldn’t copy — open “See the rules” and copy by hand', ok ? { ms: 6000 } : { bad: true })); }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'arRestoreForm') return; e.preventDefault();
  const btn = $('button[type=submit]', e.target); busyBtn(btn, true, 'Restoring…');
  try { await B.arRestore($('#arCode').value); toast('A/R key restored'); startLive(); } catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
});
function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button' && t.type !== 'submit' && t.type !== 'checkbox')) return;
  const a = t.dataset.act;
  if (ACT[a]) ACT[a](t, e);
}
function onChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.f) { S.f[t.dataset.f] = t.value; renderView(); return; }
  if (t.dataset && t.dataset.chg && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e);
}
function onInput(e) { if (e.target.id === 'q') { S.q = e.target.value; renderView(); } }
