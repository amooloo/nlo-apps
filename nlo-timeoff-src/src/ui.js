/* =====================================================================
   UI — sign-in, opening Time Off, live updates, the app shell and the
   small pieces every screen uses. The screens are in views.js; Settings,
   people's HR records and My account in admin.js; the move from the old
   app in importer.js.
   ===================================================================== */
const S = {
  demo: false, emu: false, as: '', inApp: false, st: '', view: 'home', tab: {}, q: '',
  settings: { idleMin: 10 }, pol: policyOf({}), scrubs: scrubsOf({}), closed: makeClosed([]), blackouts: blackoutsOf({}),
  roster: [], team: [], people: new Map(), reqs: new Map(), board: [], mine: undefined, hrRecs: new Map(),
  form: null, openId: '', openSid: '', month: '', lastLogin: '', loginPw: '', lastAct: Date.now(), idleTimer: null,
  renderQ: false, firstLoad: true, loadErr: '', ver: 0, startView: ''
};
let B = null;
const ACT = Object.create(null); // click actions: data-act="name" → ACT.name(target, event)
const CHG = Object.create(null); // change handlers: data-chg="name"
const TO_RULES = ""; // the build puts the office's whole Firestore rules file here (for the owner's "publish the rules" card)
const DEMO_ONLY = false; // the demo-only build (made-up office, nothing to sign in to) sets this
const LOGO = 'logo-white.png'; // the demo-only build carries the logo inside the page

/* ---------- icons ---------- */
const IC = {
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  check: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 15l2.2 2 4.8-4.5"/>',
  people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.8 19.5c.9-3.3 3.3-5 6.2-5s5.3 1.7 6.2 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.2 14.6c2.6-.2 4.4 1.2 5 4.4"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0112 7.3 4.3 4.3 0 0119.5 10c0 5.6-7.5 10-7.5 10z"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="17.5" r="1.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  next: '<path d="M9 6l6 6-6 6"/>', prev: '<path d="M15 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.4 5.2-5.2"/>',
  tick: '<path d="M5.5 12.5l4.2 4.2 8.8-9"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  import: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  warn: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17v.2"/>',
  block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
  med: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  note: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="M4 7l8 6 8-6"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9v6M17.5 9v6"/>',
  shield: '<path d="M12 3l7 2.8v5.5c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.8z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.5 11h10a5 5 0 010 10h-3"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  const acts = (opt.actions || []).filter(x => x && x.t).concat(opt.action ? [{ t: opt.action, fn: opt.onAction }] : []);
  el.innerHTML = esc(msg) + acts.map(x => ' <button class="linkBtn" style="color:var(--mint);margin-left:10px;pointer-events:auto">' + esc(x.t) + '</button>').join('');
  $$('button', el).forEach((b, i) => { b.onclick = () => { el.remove(); acts[i].fn(); }; });
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || (acts.length ? 8000 : 3800));
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
  if (/no-escrow/.test(c)) return 'There’s no recovery copy of the HR key to restore from.';
  if (/no-pub|busy|locked|bad|bad-file|need/.test(c)) return (e && e.message) || 'Check that and try again.';
  if (/permission/.test(c)) return 'Not allowed. Your access may have changed.';
  if (/gone/.test(c)) return 'That no longer exists.';
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  if (/no-key/.test(c)) return (e && e.message && e.message !== 'no-key') ? e.message : 'The key for this isn’t open on this login. Sign in again.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}

/* ---------- boot ---------- */
/* a link can open one screen once, after signing in: nlo-timeoff.html#approvals (CADANCe's link), #new, #out, #mine */
const START_VIEWS = { approvals: 'appr', appr: 'appr', new: 'new', out: 'out', mine: 'mine', team: 'team', benefits: 'ben', home: 'home' };
window.addEventListener('pagehide', () => { if (S.inApp) { ['#view', '#topSlot', '#side', '#mobTop', '#mobNav'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; }); closeModal(); closeDrawer(); S.leftPage = true; } });
window.addEventListener('pageshow', e => { if (e.persisted && S.leftPage) location.reload(); });
function boot() {
  if (!DEMO_ONLY && window.top !== window.self) { document.body.innerHTML = '<p style="font:15px sans-serif;padding:24px">NLO Time Off opens in its own tab. <a href="nlo-timeoff.html" target="_blank" rel="noopener">Open it</a>.</p>'; return; }
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = DEMO_ONLY || qs.has('demo'); S.emu = !DEMO_ONLY && local && qs.has('emu'); S.as = S.demo ? (['approver', 'staff'].includes(qs.get('as')) ? qs.get('as') : '') : '';
  if (DEMO_ONLY) $$('img[src="logo-white.png"]').forEach(i => { i.src = LOGO; });
  S.startView = START_VIEWS[String(location.hash || '').replace(/^#/, '').toLowerCase()] || '';
  if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } }
  let lockMsg = ''; try { lockMsg = sessionStorage.getItem('nloTO.lockMsg') || ''; sessionStorage.removeItem('nloTO.lockMsg'); } catch (e) { }
  try { S.lastLogin = localStorage.getItem('nloTO.lastLogin') || localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('#modalWrap')) closeModal(); else if (S.openId || S.openSid) closeDrawer(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.click[data-act], .dropZone, .reqRow[data-act], .outChip[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true }));
  const first = lockMsg ? { ok: lockMsg } : {};
  if (S.demo) {
    B = DEMO; DEMO.as = S.as; $('#demoBar').classList.remove('hidden'); document.body.classList.add('demo');
    const meta = $('.lockMeta'); if (meta) meta.textContent = 'Demo · made-up people · nothing is saved';
    lockScreen('login', first);
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
      '<p class="desc">To look around with made-up people, open the demo.</p><a class="btn btn-pri btn-block" href="?demo">Open the demo</a>';
  } else if (mode === 'login') {
    const demoPick = S.demo ? '<div class="field"><span class="flabel">Look at it as</span><div class="seg" role="group" style="display:flex">' +
      [['', 'Dr. A'], ['approver', 'Approver'], ['staff', 'Staff']].map(([k, l]) => '<button type="button" data-act="demoAs" data-as="' + k + '" aria-pressed="' + (S.as === k) + '" style="flex:1;justify-content:center">' + l + '</button>').join('') + '</div></div>' : '';
    h = S.demo ? '<h1>Try the demo</h1><div class="lsub">A made-up office · nothing is saved</div>' + err + ok +
      '<form id="loginForm" style="margin-top:16px">' + demoPick + '<button class="btn btn-pri btn-block" id="lgBtn" type="submit">Open the demo</button></form>' +
      '<div class="lockFoot">Dr. A sees everything; an approver sees Approvals and Team; staff see their own time off. Lock to switch — what you did stays until the page is reloaded.</div>'
      : '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · time off &amp; benefits</div>' + err + ok +
      '<form id="loginForm" autocomplete="on" style="margin-top:16px">' +
      '<div class="field"><label for="lgUser">Username</label><input id="lgUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(S.lastLogin) + '" required></div>' +
      '<div class="field"><label for="lgPw">Password</label><input id="lgPw" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn btn-pri btn-block" id="lgBtn" type="submit">Sign in</button></form>' +
      '<div class="lockFoot">Same username and password as NLO Cases. Forgot your password? Ask Dr. A to reissue your login.<br><button class="linkBtn" data-act="forgot" type="button">Dr. A: reset by email</button></div>';
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
  } else if (mode === 'broken' || mode === 'keymismatch') {
    h = '<h1>Login needs a reset</h1><div class="lsub">' + (mode === 'broken' ? 'Your password was changed outside the app.' : 'Your login’s key was changed outside NLO Cases, so Time Off won’t use it.') + '</div><p class="desc">Ask Dr. A to reissue your login from NLO Cases → Team &amp; security.</p>' +
      '<button class="btn btn-sec btn-block" data-act="lockSignOut">Back</button>';
  } else if (mode === 'forgot') {
    h = '<h1>Reset by email</h1><div class="lsub">For Dr. A’s email login</div>' + err + ok +
      '<form id="forgotForm" style="margin-top:16px"><div class="field"><label for="fgEmail">Your email</label><input id="fgEmail" type="email" autocomplete="email" required></div>' +
      '<button class="btn btn-pri btn-block" type="submit">Send reset link</button></form>' +
      '<p class="desc small" style="margin:14px 0 0">After you pick a new password, sign in with it. You’ll be asked for your recovery code once.</p>' +
      '<div class="lockFoot"><button class="linkBtn" data-act="toLogin" type="button">Back to sign in</button></div>';
  }
  card.innerHTML = h;
  const f = mode === 'login' && $('#lgUser') && $('#lgUser').value ? $('#lgPw') : $('input:not([type=checkbox])', card) || (mode === 'login' ? $('#lgBtn') : null);
  if (f) f.focus();
  bindLockForms();
}
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
function bindLockForms() {
  const lf = $('#loginForm');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const btn = $('#lgBtn'); const user = S.demo ? 'demo' : $('#lgUser').value.trim(), pw = S.demo ? 'demo' : $('#lgPw').value;
    busyBtn(btn, true, S.demo ? 'Opening…' : 'Signing in…');
    try {
      const r = await B.signIn(user, pw);
      S.lastLogin = user; if (!S.demo) { try { localStorage.setItem('nloTO.lastLogin', user); } catch (x) { } }
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
  const sv = S.startView; S.startView = '';
  Object.assign(S, {
    inApp: true, st: 'opening', view: 'home', tab: {}, q: '', roster: [], team: [], people: new Map(), reqs: new Map(), perks: new Map(), board: [], mine: undefined, hrRecs: new Map(),
    form: null, openId: '', openSid: '', month: todayISO().slice(0, 8) + '01', firstLoad: true, loadErr: '', lastAct: Date.now(), day: todayISO(), ver: S.ver + 1, gotReqs: false,
    imp: null, polEd: null, hrP: null, desk: null, feedInfo: null, accessBusy: '', rotating: null, benAs: '', scrubsMail: null
  });
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (busyNow()) S.lastAct = Date.now(); // a move from the old app or a new HR key still running counts as activity
    if (S.inApp && !S.demo && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.');
    else if (S.inApp) { updateTitle(); if (S.day !== todayISO()) { S.day = todayISO(); bump(); queueRender(); } }
  }, 15000);
  let st;
  try { st = await B.toOpen(); } catch (e) { st = 'error'; S.loadErr = errText(e); }
  if (st === 'stale' && isOwner() && B.lastCode) { try { await B.hrRestore(B.lastCode); st = 'hr'; toast('HR key restored with your recovery code'); } catch (e) { } }
  B.lastCode = '';
  if (!S.inApp) return;
  S.st = st;
  if (sv && (sv !== 'appr' && sv !== 'team' || st === 'hr')) S.view = sv;
  renderShell();
  if (st === 'hr' || st === 'staff') startLive(); else renderView();
}
function startLive() {
  renderShell(); renderView();
  B.start({
    settings(s) { if (!S.inApp) return; S.settings = Object.assign({ idleMin: 10 }, s || {}); S.pol = policyOf(S.settings); S.scrubs = scrubsOf(S.settings); S.closed = makeClosed(((S.settings.to || {}).closures) || []); S.blackouts = blackoutsOf(S.settings); bump(); queueRender('settings'); },
    roster(list) { if (!S.inApp) return; S.roster = list; bump(); queueRender('team'); const wb = $('#side .whoBox'); if (wb && wb.firstElementChild) { wb.firstElementChild.outerHTML = avatarHTML(meSid(), B.me && B.me.name); paintPhotos(wb); } },
    team(sids) { if (!S.inApp) return; S.team = Array.isArray(sids) ? sids.filter(x => typeof x === 'string') : []; queueRender('team'); },
    people(map) { if (!S.inApp) return; S.people = map; queueRender('team'); },
    board(list) { if (!S.inApp) return; S.board = list.filter(x => x && typeof x.sid === 'string' && isISO(x.start) && isISO(x.end)); bump(); queueRender(); },
    reqs(up, gone) {
      if (!S.inApp) return;
      up.forEach(r => { const o = S.reqs.get(r.id); if (o && o.rev > r.rev) return; S.reqs.set(r.id, normReq(r)); }); gone.forEach(id => S.reqs.delete(id)); // never an older copy over a newer one
      S.gotReqs = true; S.firstLoad = false; S.loadErr = ''; bump(); queueRender();
      if (S.openId) refreshDrawer();
    },
    mine(m) { if (!S.inApp) return; S.mine = m && !m.locked ? m : null; bump(); queueRender(); },
    perks(list) { if (!S.inApp) return; S.perks = new Map(list.filter(x => x && !x.locked).map(x => [x.id, x])); bump(); queueRender(); if (S.openSid) refreshDrawer(); },
    hr(list) { if (!S.inApp) return; S.hrRecs = new Map(list.filter(x => !x.locked).map(x => [x.sid, x])); bump(); queueRender(); if (S.openSid) refreshDrawer(); },
    access(kind) { if (kind === 'off') lockOut('Your approver access was turned off. Sign in again.'); else toast('You can approve time off now — sign in again to see Approvals.', { ms: 9000, action: 'Lock', onAction: () => lockOut('Sign in again to see Approvals.') }); },
    revoked() { lockOut('Your access was turned off.'); },
    rekeyed() { if (S.inApp && isOwner()) setTimeout(ownerUpkeep, 1500); },
    loadError(e) { S.firstLoad = false; S.loadErr = B.isPerm && B.isPerm(e) ? 'Time Off can’t be read with this login (the rules may have changed — sign in again).' : errText(e); queueRender(); },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  });
  if (!S.demo) setTimeout(upkeep, 3500);
}
async function lockOut(msg) {
  if (!S.inApp) return;
  S.inApp = false; clearInterval(S.idleTimer);
  closeModal(); closeDrawer(true); $('#toasts').innerHTML = '';
  ['#view', '#topSlot', '#side', '#mobTop', '#mobNav'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; });
  document.title = APP_NAME;
  for (let i = 0; i < 30 && B.pending; i++) await new Promise(r => setTimeout(r, 100));
  await B.signOut();
  if (S.demo) { lockScreen('login', { ok: msg }); return; }
  // start the page over, so nothing (names, hours, keys) is left in this tab's memory
  try { sessionStorage.setItem('nloTO.lockMsg', msg || ''); } catch (e) { }
  location.reload();
}

/* ---------- the data, made ready for the screens ---------- */
function normReq(r) {
  const o = Object.assign({}, r);
  if (!TYPE[o.type]) o.type = o.type ? 'other' : o.type;
  if (!PART[o.part]) o.part = 'full';
  o.paid = o.paid !== false;
  o.events = Array.isArray(o.events) ? o.events.filter(e => e && typeof e.a === 'string') : [];
  return o;
}
function bump() { S.ver++; S.memo = null; }
function isOwner() { return B.isOwner(); }
function isHR() { return S.st === 'hr'; }
function meSid() { return B.me ? B.me.staffId : ''; }
function staff(sid) { return S.roster.find(r => r.sid === sid); }
function staffName(sid, fallback) { const r = staff(sid); return r ? (r.role === 'owner' ? 'Dr. A' : r.name) : (fallback || sid || ''); }
function shortName(sid) { const n = staffName(sid, sid); return n === 'Dr. A' ? n : firstName(n); }
function activeStaff() { return S.roster.filter(r => r.active).sort((a, b) => (a.role === 'owner' ? 1 : 0) - (b.role === 'owner' ? 1 : 0) || String(a.name).localeCompare(String(b.name))); }
function allReqs() { return Array.from(S.reqs.values()).filter(r => !r.locked); }
function reqsOf(sid) { return allReqs().filter(r => r.sid === sid); }
/* a person's HR record: everyone's for the people who approve, my own copy for me */
function personOf(sid) {
  if (isHR() && S.hrRecs.has(sid)) return S.hrRecs.get(sid);
  if (sid === meSid() && S.mine) return S.mine;
  return null;
}
/* balances and the statement, worked out once per change of anything they depend on */
function ledgerOf(sid, to) {
  const t = to || todayISO(), key = sid + '|' + t;
  if (!S.memo || S.memo.v !== S.ver) S.memo = { v: S.ver, m: new Map() };
  if (S.memo.m.has(key)) return S.memo.m.get(key);
  const p = personOf(sid), L = p ? ledger(p, reqsOf(sid), S.pol, S.closed, t) : null;
  S.memo.m.set(key, L); return L;
}
function busyNow() { return !!((S.imp && S.imp.st === 'moving') || S.rotating || (B && (B.rotating || B.resealing))); }
function pendingAll() { return allReqs().filter(r => r.status === 'pending'); }
/* requests waiting for me to decide (not my own, unless I'm Dr. A) */
function waitingForMe() { return isHR() ? pendingAll().filter(r => isOwner() || r.sid !== meSid()) : []; }
/* scrubs requests (and any other benefit asked for) */
function allPerks() { return Array.from((S.perks || new Map()).values()); }
function perksOf(sid) { return allPerks().filter(x => x.sid === sid); }
function perksWaitingForMe() { return isHR() ? allPerks().filter(x => x.status === 'pending' && (isOwner() || x.sid !== meSid())) : []; }
function deptOf(sid) { const p = S.hrRecs.get(sid); return p && p.dept ? p.dept : ''; }

/* ---------- owner (and approver) upkeep: keys, everyone's public key, copies sealed to people, the feed ---------- */
async function upkeep() {
  if (!S.inApp || S.demo) return;
  if (isOwner() && isHR()) {
    try {
      const r = await B.hrFixGrants();
      if (r.removed.length) toast('Approving taken off ' + r.removed.join(', ') + ' (no longer in the office) — a new HR key was made', { ms: 7000 });
      if (r.relogin.length) toast(r.relogin.join(', ') + (r.relogin.length > 1 ? ' have' : ' has') + ' a new login (reissued in NLO Cases). Turn approving on again in Settings if they should still approve.', { ms: 12000 });
      if (r.keyChanged.length) toast(keyChangedMsg(r.keyChanged), { bad: true, ms: 20000 });
    } catch (e) { if (e.code !== 'busy') toast('Couldn’t finish checking who approves: ' + errText(e), { bad: true }); }
    try { await B.publishPeople(); } catch (e) { }
    try { const kc = await B.checkKeys(); if (kc.length) toast(staffKeyMsg(kc), { bad: true, ms: 20000 }); } catch (e) { }
    await ownerUpkeep();
  }
  if (isHR()) await syncFeed(true).catch(() => { });
}
async function ownerUpkeep() {
  if (!S.inApp || S.demo || !isOwner() || !isHR()) return;
  // anything under an older HR key, sealed again
  if (allReqs().some(r => r.v < B.hr.curV) || Array.from(S.hrRecs.values()).some(x => x.v < B.hr.curV) || allPerks().some(x => x.v < B.hr.curV)) { try { await B.hrReseal(); } catch (e) { } }
  // the person's copy of a request, or of their HR record, sealed to the key their login holds now (never to a key that
  // changed in place — see B.checkKeys)
  for (const r of allReqs()) {
    const pub = B.trustedPub(r.sid); if (!pub || r.pubX === pub.x) continue;
    try { await B.saveReq(r.id, () => { }, { a: 'reseal' }); } catch (e) { }
  }
  for (const x of allPerks()) {
    const pub = B.trustedPub(x.sid); if (!pub || x.pubX === pub.x) continue;
    try { await B.savePerk(x.id, () => { }, { a: 'reseal' }); } catch (e) { }
  }
  let mineX = new Map(); try { mineX = await B.mineXs(); } catch (e) { }
  for (const [sid, rec] of S.hrRecs) {
    const pub = B.trustedPub(sid); if (!pub || mineX.get(sid) === pub.x) continue;
    try { await B.writeMine(sid, rec); } catch (e) { }
  }
}
function staffKeyMsg(names) { return names.join(', ') + (names.length > 1 ? '’ logins' : '’s login') + ' changed its key without a reissue, so nothing new is sealed to it. If that’s expected, reissue the login in NLO Cases (Team & security); their copies are sealed to the new login the next time you open Time Off.'; }
/* the who's-out feed CADANCe and the office calendar read: names, dates, morning/afternoon, closures and how many requests wait */
function feedHours(part) { return { full: 'Full Day', am: 'Morning (AM)', pm: 'Afternoon (PM)', h2: '2 Hours', h4: '4 Hours', h6: '6 Hours', half: 'Half Day' }[part] || 'Full Day'; }
function buildFeed(pending) {
  const t = todayISO(), lo = addDays(t, -60), hi = addDays(t, 400), y = Number(t.slice(0, 4));
  const timeOff = S.board.filter(o => o.end >= lo && o.start <= hi).map(o => { const r = staff(o.sid) || {}; return { id: o.id, sid: o.sid, rid: r.rid || '', employeeName: r.name || o.sid, start: o.start, end: o.end, hours: feedHours(o.part), part: o.part || 'full' }; })
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1);
  const holidays = [];
  [y - 1, y, y + 1].forEach(yy => fixedHolidays(yy).forEach(h => holidays.push({ date: h.date, label: h.label, source: 'fixed' })));
  S.closed.custom.forEach((label, date) => holidays.push({ date, label, source: 'custom' }));
  holidays.sort((a, b) => a.date < b.date ? -1 : 1);
  return { v: 1, ok: true, timeOff, holidays, pending: pending, syncedAt: new Date().toISOString() };
}
/* write the feed if it says something different. full: the people who approve know exactly how many wait; anyone else moves
   the count by delta (their own request sent or taken back) */
async function syncFeed(full, delta) {
  if (!B.writeFeed) return;
  let cur = null; try { cur = await B.readFeed(); } catch (e) { }
  const pending = full && isHR() ? pendingAll().length : Math.max(0, ((cur && cur.pending) || 0) + (delta || 0));
  const next = buildFeed(pending), same = cur && JSON.stringify(Object.assign({}, cur, { syncedAt: '' })) === JSON.stringify(Object.assign({}, next, { syncedAt: '' }));
  if (!same) await B.writeFeed(next);
}

/* ---------- rendering ---------- */
function queueRender(kind) {
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => {
    S.renderQ = false; if (!S.inApp) return;
    renderNav(); updateTitle();
    if (S.view === 'settings' || S.view === 'account' || S.view === 'import') return;
    const a = document.activeElement; if (a && a.matches && a.matches('#view input:not(#q), #view textarea, #view select')) return;
    renderView();
  });
}
function navList() {
  const L = [['home', 'Home', 'home'], ['new', 'Request time off', 'plus'], ['mine', 'My time off', 'list'], ['out', 'Who’s out', 'cal'], ['ben', 'My benefits', 'heart']];
  if (isHR()) L.splice(1, 0, ['appr', 'Approvals', 'check'], ['team', 'Team', 'people']);
  return L;
}
function renderShell() {
  const owner = isOwner(), live = S.st === 'hr' || S.st === 'staff';
  const navBtns = mob => (live ? navList().map(([k, l, i]) => '<button class="navBtn" data-act="nav" data-v="' + k + '" id="' + (mob ? 'm' : '') + 'nav-' + k + '">' + ic(i) + '<span>' + l + '</span><span class="cnt hidden"></span></button>').join('') : '') +
    (mob ? '' : '<div class="navLbl">Office</div>') +
    (owner && S.st === 'hr' ? '<button class="navBtn" data-act="nav" data-v="settings" id="' + (mob ? 'm' : '') + 'nav-settings">' + ic('gear') + '<span>Settings</span></button>' : '') +
    '<button class="navBtn" data-act="nav" data-v="account" id="' + (mob ? 'm' : '') + 'nav-account">' + ic('key') + '<span>My account</span></button>';
  $('#side').innerHTML = '<div class="sideTop"><img src="' + LOGO + '" alt="Next Level Orthodontics"><div class="appTag">Time Off</div></div>' +
    '<nav class="nav" aria-label="Main">' + navBtns(false) + '</nav>' +
    '<div class="sideFoot"><div class="whoBox">' + avatarHTML(meSid(), B.me && B.me.name) + '<div><b>' + esc(B.me.name) + '</b>' + (owner ? 'Owner' : S.st === 'hr' ? 'Approves time off' : 'Staff') + '</div></div>' +
    '<a class="sideLink" href="nlo-cases.html">' + ic('next', 14) + 'Open NLO Cases</a>' +
    '<button class="sideLock" data-act="lock">' + ic('lock', 16) + 'Lock</button><div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img src="' + LOGO + '" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">Time Off</span><span style="flex:1"></span>' +
    (live ? '<button class="iconBtn" style="color:#fff" data-act="nav" data-v="new" aria-label="Request time off">' + ic('plus') + '</button>' : '') + '<button class="iconBtn" style="color:#fff" data-act="lock" aria-label="Lock">' + ic('lock') + '</button>';
  $('#mobNav').innerHTML = navBtns(true);
  renderSync(); renderNav(); paintPhotos($('#side'));
}
function renderNav() {
  const set = (k, n, red) => ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + k + ' .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('red', !!red); });
  if (S.st === 'hr' || S.st === 'staff') {
    const w = waitingForMe().length + perksWaitingForMe().length; set('appr', w, w > 0);
    const mineWait = reqsOf(meSid()).filter(r => r.status === 'pending').length; set('mine', mineWait, false);
  }
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
function updateTitle() { if (!S.inApp) return; const n = waitingForMe().length + perksWaitingForMe().length; document.title = (n ? '(' + n + ') ' : '') + APP_NAME; }
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? 'Demo · nothing saved' : 'Live · encrypted';
  if (!navigator.onLine) { cls = 'bad'; t = 'Offline'; }
  else if (B && B.pending) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
const TITLES = { home: 'Home', new: 'Request time off', mine: 'My time off', out: 'Who’s out', ben: 'My benefits', appr: 'Approvals', team: 'Team', settings: 'Settings', account: 'My account', import: 'Move from the old app' };
function topBar() {
  const live = S.st === 'hr' || S.st === 'staff';
  return '<div class="topBar"><h2>' + esc(S.view === 'new' && S.form && S.form.editId ? 'Change a request' : TITLES[S.view] || 'Time Off') + '</h2><span style="flex:1"></span>' +
    (live && S.view !== 'new' ? '<button class="btn btn-teal" data-act="nav" data-v="new">' + ic('plus', 16) + 'Request time off</button>' : '') + '</div>';
}
function renderView() {
  const v = $('#view'); let h = '';
  const live = S.st === 'hr' || S.st === 'staff';
  if (!live && S.view !== 'account') h = gateHTML();
  else if (S.view === 'home') h = viewHome();
  else if (S.view === 'new') h = viewForm();
  else if (S.view === 'mine') h = viewMine();
  else if (S.view === 'out') h = viewOut();
  else if (S.view === 'ben') h = viewBenefits();
  else if (S.view === 'appr') h = isHR() ? viewApprovals() : '';
  else if (S.view === 'team') h = isHR() ? viewTeam() : '';
  else if (S.view === 'settings') h = isOwner() && isHR() ? viewSettings() : '';
  else if (S.view === 'import') h = isOwner() && isHR() ? viewImport() : '';
  else if (S.view === 'account') h = viewAccount();
  $('#topSlot').innerHTML = topBar();
  v.innerHTML = h;
  paintPhotos(v);
  if (S.view === 'new') afterForm();
  if (S.view === 'settings') afterSettings();
  if (S.view === 'import') afterImport();
}

/* ---------- before Time Off is open ---------- */
function gateHTML() {
  const st = S.st, card = (title, body) => '<div class="card" style="max-width:640px"><div class="cardHd"><h3>' + title + '</h3></div><div class="cardBd">' + body + '</div></div>';
  const again = '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>';
  if (st === 'opening') return '<div class="empty">Opening Time Off…</div>';
  if (st === 'error') return card('Couldn’t open Time Off', '<p class="small">' + esc(S.loadErr || 'Something went wrong.') + '</p>' + again);
  if (st === 'notyet') return card('Time Off isn’t ready yet', '<p class="small">Dr. A hasn’t switched it on yet. Until then, keep using the old Time-Off app.</p>' + again);
  if (st === 'rules') return isOwner() ? rulesCardHTML(true) : card('Time Off isn’t ready yet', '<p class="small">The office database needs an update from Dr. A first. Until then, keep using the old Time-Off app.</p>' + again);
  if (st === 'setup') return card('Set up Time Off', '<p class="small">Time Off gets an HR key of its own: only you and the people you choose to approve requests can open everyone’s requests and records. Each person can always open their own. Your recovery code keeps a copy, so the key can’t be lost.</p>' +
    '<ol class="steps small"><li>Press <b>Set up Time Off</b>.</li><li>Choose who else approves (Settings → Who approves) — e.g. Sarah.</li><li>Move everyone’s records over from the old app (Settings → Move from the old app).</li></ol>' +
    '<button class="btn btn-pri" data-act="setupTO">' + ic('key', 16) + 'Set up Time Off</button>');
  if (st === 'stale' && !isOwner()) return card('Your key needs renewing', '<p class="small">Your login was renewed since Dr. A gave you approving. It renews itself the next time Dr. A opens Time Off — ask him to open it once, then press Check again.</p>' + again);
  if (st === 'stale') return card('Restore the HR key', '<p class="small">Your password was reset, so your copy of the HR key needs your <b>recovery code</b> once (the one from NLO Cases).</p>' +
    '<form id="hrRestoreForm" style="margin-top:12px"><div class="field"><label for="hrCode">Recovery code</label><input id="hrCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required></div>' +
    '<button class="btn btn-pri" type="submit">Restore</button></form>');
  return '';
}
function rulesText() { return TO_RULES.replace('__OWNER_EMAIL__', String((B.me && B.me.email) || '').toLowerCase()); }
function rulesCardHTML(first) {
  return '<div class="card rulesBox" style="max-width:720px"><div class="cardHd"><h3>' + (first ? 'One step before Time Off can open' : 'Database rules') + '</h3></div><div class="cardBd">' +
    '<p class="small">The office database needs its updated rules — they add Time Off and keep everything NLO Cases, NLO Leads and NLO A/R already have. It’s the same card NLO Cases shows when it needs newer rules.</p>' +
    '<ol class="steps small"><li>Press <b>Copy the new rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> (left menu) → <b>Rules</b> tab.</li><li>Select everything there, paste, and press <b>Publish</b>.</li><li>Come back and press <b>Check again</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button>' +
    '<a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore" target="_blank" rel="noopener noreferrer">Open the Firebase console</a>' +
    '<button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>' +
    '<details class="help"><summary>See the rules</summary><textarea readonly id="rulesTxt">' + esc(rulesText()) + '</textarea></details></div></div>';
}

/* ---------- small pieces ---------- */
function avatarHTML(sid, fallbackName, lg) {
  const r = staff(sid), cls = 'av' + (lg ? ' lg' : '');
  if (r && r.photo && /^data:image\//.test(r.photo)) return '<span class="' + cls + '" title="' + esc(staffName(sid)) + '"><img alt="" data-photo="' + esc(sid) + '"></span>';
  const name = r ? r.name : fallbackName;
  return '<span class="' + cls + (name ? '' : ' none') + '" title="' + esc(name || 'Nobody') + '">' + esc(name ? (r && r.initials) || initials(name) : '–') + '</span>';
}
function paintPhotos(root) { $$('img[data-photo]', root || document).forEach(img => { const r = staff(img.dataset.photo); if (r && r.photo && /^data:image\//.test(r.photo)) img.src = r.photo; }); }
const STATUS = { pending: ['Waiting', 'wait'], approved: ['Approved', 'ok'], denied: ['Not approved', 'bad'], cancelled: ['Cancelled', 'off'], archived: ['Taken back', 'off'] };
function statusChip(s) { const x = STATUS[s] || [s, 'off']; return '<span class="stat ' + x[1] + '">' + esc(x[0]) + '</span>'; }
function typeChip(k) { return '<span class="badge ty-' + esc(k || 'other') + '">' + esc(typeLabel(k)) + '</span>'; }
function partNote(r) { return r.part && r.part !== 'full' ? ' · ' + esc(partLabel(r.part).replace(' (AM)', '').replace(' (PM)', '')) + (reqDays(r, S.closed, S.pol).length > 1 ? ' each day' : '') : ''; }
/* "2 days · 17 h" */
function sizeTxt(r) { const d = reqDays(r, S.closed, S.pol), h = round2(d.reduce((s, x) => s + x.h, 0)); return plural(d.length, 'office day') + ' · ' + hrs(h) + ' h'; }
function daysTxt(h) { const d = round2(h / S.pol.day); return d ? '≈ ' + hrs(d) + ' day' + (d === 1 ? '' : 's') : ''; }

/* ---------- modal / drawer ---------- */
function openModal(html, wide) {
  closeModal();
  const w = document.createElement('div'); w.id = 'modalWrap';
  w.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  w.addEventListener('mousedown', e => { if (e.target === w) closeModal(); });
  document.body.appendChild(w); const f = $('input,textarea,select,button.btn-pri', w); if (f) f.focus();
  return w;
}
function closeModal() { const m = $('#modalWrap'); if (m) m.remove(); }
function confirmBox(title, body, okLabel, danger) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="small" style="margin:8px 0 16px">' + esc(body) + '</p><div class="mFt"><button class="btn btn-sec btn-sm" id="cbNo">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + ' btn-sm" id="cbYes">' + esc(okLabel || 'OK') + '</button></div>');
    $('#cbNo').onclick = () => { closeModal(); res(false); }; $('#cbYes').onclick = () => { closeModal(); res(true); };
  });
}
/* a note to go with a decision (optional unless asked) */
function noteBox(title, body, okLabel, need, danger) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="small" style="margin:8px 0 12px">' + esc(body) + '</p><div class="field"><label for="nbTxt">Note' + (need ? '' : ' (optional)') + '</label><textarea id="nbTxt" maxlength="500"></textarea></div>' +
      '<div class="mFt"><button class="btn btn-sec btn-sm" id="nbNo">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + ' btn-sm" id="nbYes">' + esc(okLabel) + '</button></div>');
    $('#nbNo').onclick = () => { closeModal(); res(null); };
    $('#nbYes').onclick = () => { const t = $('#nbTxt').value.trim(); if (need && !t) { $('#nbTxt').focus(); toast('Add a short note first.', { bad: true }); return; } closeModal(); res(t); };
  });
}
function openDrawerHTML(html) {
  closeDrawer(true);
  const sc = document.createElement('div'); sc.id = 'scrim'; sc.onclick = () => closeDrawer();
  const d = document.createElement('aside'); d.id = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.innerHTML = html;
  document.body.appendChild(sc); document.body.appendChild(d); paintPhotos(d);
  const f = $('button,a', d); if (f) f.focus();
}
function closeDrawer(quiet) { const d = $('#drawer'), s = $('#scrim'); if (d) d.remove(); if (s) s.remove(); if (!quiet) { S.openId = ''; S.openSid = ''; } }
function refreshDrawer() { if (S.openId) openReqDrawer(S.openId, true); else if (S.openSid) openPersonDrawer(S.openSid, true); }

/* ---------- events ---------- */
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) { }
  try { const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
}
async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(errText(e), { bad: true }); return false; } }
Object.assign(ACT, {
  async nav(t) {
    const v = t.dataset.v; if (!v) return;
    if (S.view === 'new' && v !== 'new' && formDirty() && !(await confirmBox('Leave without sending this request?', 'What you’ve filled in so far will be lost.', 'Leave', true))) return;
    if (v === 'new' && (S.view !== 'new' || t.dataset.fresh)) S.form = null;
    S.view = v; if (t.dataset.tab) S.tab[v] = t.dataset.tab;
    closeDrawer(); renderNav(); renderView(); window.scrollTo(0, 0);
  },
  tab(t) { S.tab[S.view] = t.dataset.t; renderView(); },
  closeDrawer() { closeDrawer(); },
  closeModal() { closeModal(); },
  async lock() {
    if (B.pending && !(await confirmBox('Lock now?', 'A change is still being saved (is the internet connected?). Locking now may lose it.', 'Lock anyway', true))) return;
    lockOut('Locked. Sign in to continue.');
  },
  lockSignOut() { S.loginPw = ''; B.signOut().then(() => lockScreen('login')); },
  forgot() { lockScreen('forgot'); },
  toLogin() { lockScreen('login'); },
  demoAs(t) { S.as = t.dataset.as || ''; DEMO.as = S.as; $$('[data-act=demoAs]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.as === S.as))); },
  copyVal(t) { copyText(t.dataset.v).then(ok => toast(ok ? 'Copied' : 'Couldn’t copy — select it and copy by hand', ok ? {} : { bad: true })); },
  async retryOpen() { S.st = 'opening'; renderView(); let st; try { st = await B.toOpen(); } catch (e) { st = 'error'; S.loadErr = errText(e); } S.st = st; renderShell(); if (st === 'hr' || st === 'staff') startLive(); else renderView(); },
  async setupTO(t) { busyBtn(t, true, 'Setting up…'); try { await B.toSetup(); S.st = 'hr'; toast('Time Off is set up — choose who approves, then move everyone’s records over'); S.view = 'settings'; startLive(); setTimeout(upkeep, 1500); } catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); } },
  copyRules() { copyText(rulesText()).then(ok => toast(ok ? 'Rules copied — paste them in the Firebase console and press Publish' : 'Couldn’t copy — open “See the rules” and copy by hand', ok ? { ms: 6000 } : { bad: true })); }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'hrRestoreForm') return; e.preventDefault();
  const btn = $('button[type=submit]', e.target); busyBtn(btn, true, 'Restoring…');
  try { await B.hrRestore($('#hrCode').value); toast('HR key restored'); S.st = 'hr'; renderShell(); startLive(); } catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
});
function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button' && t.type !== 'submit' && t.type !== 'checkbox' && t.type !== 'radio')) return;
  const a = t.dataset.act;
  if (ACT[a]) ACT[a](t, e);
}
function onChange(e) { const t = e.target; if (t.dataset && t.dataset.chg && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e); }
function onInput(e) { const t = e.target; if (t.dataset && t.dataset.inp && CHG[t.dataset.inp]) CHG[t.dataset.inp](t, e); }
