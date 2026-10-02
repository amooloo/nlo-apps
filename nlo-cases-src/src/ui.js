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
  cols: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15M14.5 4.5v15"/>'
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
  phInit();
  try { S.lastLogin = localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('#phWrap')) phClose(); else if ($('#modalWrap')) closeModal(); else if (S.openId) closeDrawer(); }
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
  S.inApp = true; S.cases = new Map(); S.closed = []; S.hist = null; S.histLoaded = false; S.firstLoad = true; S.lastAct = Date.now();
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  S.h = {
    cases(up, gone) {
      // a stage move still being saved wins over an older copy arriving from the server (quick → → → clicks)
      up.forEach(c => { const p = S.pend && S.pend[c.id]; if (p) { c.stage = p.to; if (p.extra) Object.assign(c, p.extra); } S.cases.set(c.id, c); }); gone.forEach(id => S.cases.delete(id));
      const first = S.firstLoad; S.firstLoad = false; queueRender();
      if (first) setTimeout(mailSync, 300); // lab emails that came in while nobody had the app open
      if (S.openId && (up.some(c => c.id === S.openId) || gone.includes(S.openId))) refreshDrawer(gone.includes(S.openId));
    },
    inbox() { mailSync(); },
    mailbeat(list) { if (MAILS.state) MAILS.state.beats = list; if (S.view === 'admin') queueRender('team'); },
    roster(list) { S.roster = list; queueRender('team'); },
    members(list) { S.members = list; if (S.view === 'admin') queueRender('team'); },
    settings(s) { S.settings = Object.assign({ idleMin: 10 }, s || {}); if (S.view === 'admin') queueRender('team'); },
    revoked() { lockOut('Your access to NLO Cases was turned off.'); },
    rekeyed() { },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  };
  B.start(S.h);
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (S.inApp && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.');
  }, 15000);
  clearInterval(S.mailTimer); S.mailTimer = setInterval(mailSync, 180000); // also catches emails a case couldn't take yet
  S.rulesOld = false; rulesCheck();
}
/* features that need newer security rules (patient photos, email updates) stay out of sight until the owner publishes them */
async function rulesCheck() {
  const was = !!S.rulesOld;
  S.rulesOld = false; document.body.classList.remove('phOff');
  if (!B.rulesCurrent) return true;
  const ok = await B.rulesCurrent(); if (!S.inApp) return ok;
  S.rulesOld = !ok; document.body.classList.toggle('phOff', !ok);
  if (!ok) queueRender('team');
  // just published: the live updates the older rules refused (lab inbox, mailbox check-ins) start again without signing in again
  if (ok && was && S.h) { B.start(S.h); MAILS.state = null; queueRender('team'); }
  return ok;
}
async function lockOut(msg) {
  if (!S.inApp) return;
  S.inApp = false; clearInterval(S.idleTimer); clearInterval(S.mailTimer);
  closeModal(); closeDrawer(true);
  S.cases = new Map(); S.closed = []; S.hist = null; S.histLoaded = false; S.members = []; S.roster = []; S.iprCache = {}; S.verList = null; S.delList = null; S.impList = null;
  Object.assign(MAILS, { list: [], unread: [], pick: {}, sig: '', state: null, stateAt: 0, script: '', gone: new Set(), goneFp: new Set(), hk: null, mem: null });
  phReset(); SH.data = null; SH.err = '';
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
const DEL_OPTS = [['all', 'All, sorted by delivery date'], ['past', 'Delivery date passed'], ['today', 'Delivery today'], ['tomorrow', 'Delivery tomorrow'],
  ['week', 'Delivery in the next 7 days'], ['14', 'Delivery in the next 14 days'], ['day', 'Delivery on a day…'], ['none', 'No delivery date']];
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
function queueRender(kind) {
  S.renderKinds = (S.renderKinds || new Set()); S.renderKinds.add(kind || 'cases');
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => {
    S.renderQ = false; if (!S.inApp) return;
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
  let cls = 'ok', t = S.demo ? 'Demo · nothing saved' : 'Live · encrypted';
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
  const v = $('#view'); const active = document.activeElement && document.activeElement.id === 'q';
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
  if (active) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  phPaint(); savPaint(); logoPaint(v); if (S.view === 'admin') shPaint();
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
   uLab, InSmile from logos.js; in-house sets the office NL mark; types with no company (retainers, appliances, MARPE,
   models) keep the name. The picture is set after render (logoPaint), so no image data sits in this markup. */
function typeMark(c, small) {
  const t = typeOf(c), lg = typeof LOGOS !== 'undefined' && LOGOS[c.type], cls = 'tlogo' + (small ? ' sm' : '');
  if (lg) return '<span class="' + cls + ' lg-' + esc(c.type) + '" title="' + esc(t.l) + '"><img data-logo="' + esc(c.type) + '" width="' + lg.w + '" height="' + lg.h + '" alt="' + esc(t.l) + '" draggable="false"></span>';
  if (c.type === 'nla') { const l = c.variant === 'finishing' ? 'Finishing aligners (in-house)' : t.l; return '<span class="' + cls + ' nl" title="' + esc(l) + '" role="img" aria-label="' + esc(l) + '">' + typeSvg('nl') + '</span>'; }
  return typeBadge(c);
}
function logoPaint(root) { if (typeof LOGOS === 'undefined') return; $$('img[data-logo]:not([src])', root || document).forEach(i => { const lg = LOGOS[i.dataset.logo]; if (lg) i.src = lg.src; }); }
/* the case's next date: lab completion until the lab work is done, then delivery (see dueOf) */
function dueChip(c) { return dateChip(c, dueOf(c), 'No date'); }
/* the delivery date alone: the lists show this while they're filtered by delivery date */
function delChip(c) { return dateChip(c, c.deliveryDate ? { d: c.deliveryDate, k: 'delivery' } : null, 'No delivery date'); }
function dateChip(c, x, none) {
  if (!x) return '<span class="due none">' + none + '</span>';
  const d = dayDiff(x.d), z = x.k === 'zoom', w = x.k === 'lab' ? 'Lab' : x.k === 'delivery' ? 'Delivery' : z ? 'Zoom' : 'Due';
  const tm = fmtTime(timeOf(c, x.k)), at = tm ? ' ' + tm : '', on = tm ? ' · ' + tm : '', i = ic(z ? 'video' : 'clock', 13); // Zoom call and delivery times
  const tip = ' title="' + esc((x.k === 'lab' ? 'Lab completion' : z ? 'Zoom call' : w) + ': ' + fmtDay(x.d) + (tm ? ', ' + tm : '')) + '"';
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
/* the lab put the case on hold (Partners' daily email); cleared by a later shipment or by hand */
function isHeld(c) { return !!(c.labHold && typeof c.labHold === 'object'); }
function holdText(c) { return 'On hold at the lab' + (c.labHold.date ? ' since ' + c.labHold.date : '') + (c.labHold.reason ? ': ' + c.labHold.reason : ''); }
function holdFlag(c) { return isHeld(c) ? '<span class="flag rec" title="' + esc(holdText(c)) + '">Lab hold</span>' : ''; }

/* ---------- chart note: the case entry written as a note to paste into the patient's chart ----------
   No assistant names (Dr. A doesn't record who saw the patient in chart notes). Plain ASCII punctuation so it
   pastes cleanly into Edge. */
function chartNote(c) {
  const t = typeOf(c), L = [], sub = { yes: 'initial set', no: 'refinement', mid: 'mid-course correction' }[c.initial] || '';
  let what;
  if (c.type === 'nla') what = (c.variant === 'finishing' ? 'finishing aligners' : 'in-house aligners') + ' (NL Lab)' + (sub ? ' - ' + sub : '');
  else if (t.aligner) what = ({ oliv: 'Oliv', angel: 'Angel', invisalign: 'Invisalign', ulab: 'uLab' }[c.type] || t.l) + ' aligners' + (sub ? ' - ' + sub : '');
  else if (c.type === 'insmile') what = 'InSmile braces' + (/^de[123]$/.test(c.initial || '') ? ' - digital enhancement ' + c.initial.slice(2) : c.initial === 'yes' ? ' - initial' : '');
  else if (c.type === 'marpe') what = 'MARPE' + (c.lab ? ' (' + c.lab + ')' : '');
  else if (c.type === 'appliance') what = ((c.appliances || []).join(', ') || c.detail || 'appliance') + (c.lab ? ' (' + c.lab + ')' : '');
  else if (c.type === 'retainer') what = 'retainers' + (c.detail ? ': ' + c.detail : '');
  else if (c.type === 'mouthguard') what = 'a mouthguard' + ((c.arches || []).length ? ' (' + c.arches.join('/') + ')' : '');
  else if (c.type === 'models') what = 'study models';
  else what = c.detail || t.l;
  L.push((c.scanner ? 'Scanned with ' + c.scanner : 'Scanned') + ' for ' + what + '.');
  if (t.flow === 'marpe') { const r = MARPE_RECORDS.filter(x => (c.records || []).includes(x[0])).map(x => x[1]); if (r.length) L.push('Records on file: ' + r.join(', ') + '.'); }
  const end = s => String(s).trim().replace(/[.\s;]+$/, '') + '.';
  if (c.instructions) L.push("Dr. A's instructions: " + end(c.instructions));
  const rx = (c.extras || []).filter(x => x !== 'Mid-course correction');
  if (rx.length) L.push(rx.map(end).join(' '));
  if (c.teethNote) L.push(c.teethNote.split('\n').map(end).join(' '));
  if (c.ipr && c.ipr.trim()) L.push('IPR & spacing: ' + c.ipr.trim());
  if (c.cc && !/^(none|n\/a|na|-)$/i.test(c.cc.trim())) L.push("Pt's CC: " + end(c.cc));
  if (c.shipToPatient) L.push('Aligners to be shipped to the patient.');
  return L.join('\n').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
}
/* stage progress: a circle per stage (done, current, to come) joined by a line that fills in up to the current stage
   (Amir, 2 Oct 2026: circles connected with a line, not a row of rectangles); a stage group (In fabrication) sits in its own band */
function progHTML(c, only) {
  const f = flowOf(c), si = stageIndex(c), keys = only || f.stages.map(s => s[0]);
  let h = '', first = true;
  f.stages.forEach(([k, l], i) => {
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
/* every case we can see, for patient totals: open ones first, then completed (loaded once, in the background) */
function casePool() { return Array.from(S.cases.values()).concat(S.closed || [], S.hist || []); }
async function ensureHist() {
  if (S.histLoaded || S.histLoading || !S.inApp) return; S.histLoading = true;
  let h; try { h = await B.loadClosed(3650); } catch (e) { h = []; }
  S.histLoading = false; if (!S.inApp) return; // locked meanwhile: drop it
  S.hist = h; S.histLoaded = true;
  $$('.cf').forEach(cf => cf._alTot && cf._alTot());
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
  const wait = !S.histLoaded ? '<div class="small muted">Adding up earlier sets…</div>' : '';
  const parts = sets.map(s => '<span class="alSet' + (s.me ? ' me' : '') + '">' + esc(s.l) + ' <b>' + (s.n || '?') + '</b></span>').join('');
  const arches = c.alU || c.alL ? ' (U ' + (c.alU || 0) + ' · L ' + (c.alL || 0) + ')' : '';
  return '<div class="alThis">' + (me.n ? '<b>' + me.n + '</b> aligners in this set' + (inForm ? '' : arches + ' · ' + esc(me.l)) + (est != null ? ' <span class="alEst">est. ' + money(est) + '</span>' : '')
      : '<span class="muted">' + (inForm ? 'Enter the upper and lower aligners from Titan.' : 'Aligners in this set not entered yet — add the upper and lower counts from Titan with Edit.') + '</span>') + '</div>' +
    (inForm ? '' : '<div class="alAt">Attachment templates: ' + (c.atTemplates ? '<b>' + esc(atLabel(c.atTemplates)) + '</b>' : '<span class="muted">not answered yet — asked when it moves to Export STLs</span>') + '</div>') +
    '<div class="alSum"><span class="alT">Patient total: <b>' + total + '</b> aligners' + (estAll != null && total ? ' <span class="alEst">est. ' + money(estAll) + '</span>' : '') + '</span>' + (sets.length > 1 || inForm ? parts : '') + '</div>' +
    (missing ? '<div class="small muted">' + missing + ' set' + (missing > 1 ? 's have' : ' has') + ' no count yet, so the total may be low.</div>' : '') +
    (est == null && isOwner() && me.n ? '<div class="small muted">Set the cost per aligner in Team &amp; security to see an estimated cost.</div>' : '') + wait +
    (inForm ? '' : '<div class="alLbl"><button class="btn btn-sec btn-sm" data-act="labels"' + (me.n ? '' : ' disabled') + '>' + ic('print', 15) + 'Print labels</button>' +
      (me.n ? '<span class="small muted">The Label Maker’s labels, already filled in</span>' : '<span class="small muted">Available once the upper and lower aligners are entered (Edit)</span>') + '</div>');
}
function alignerMini(c) {
  if (c.type !== 'nla') return '';
  const n = alN(c), sets = S.histLoaded ? alignerSets(c, casePool()) : null, total = sets ? sets.reduce((s, x) => s + x.n, 0) : 0;
  return n || total ? '<span class="alMini">' + (n ? n + ' aligners' : '') + (sets && sets.length > 1 && total ? (n ? ' · ' : '') + total + ' total' : '') + '</span>' : '';
}
function avatar(c) {
  const r = staff(c.assignee);
  if (r) return '<span class="av" data-sav="' + esc(r.sid) + '" title="' + esc(r.name) + '">' + esc(r.initials || initials(r.name)) + '</span>';
  if (c.assigneeName) return '<span class="av none" title="' + esc(c.assigneeName) + '">' + esc(initials(c.assigneeName)) + '</span>';
  return '<span class="av none" title="Unassigned">–</span>';
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
  let h = '<div class="tiles">' + tile(c.over, 'Late', 'red', 'over') + tile(c.week, 'Lab or delivery in the next 7 days', 'amber', 'week') + tile(c.dr, 'Needs Dr. A', 'blue', 'dr') +
    tile(c.fab, 'In fabrication', '', 'fab') + tile(c.arrived, 'Arrived — check in', 'mint', 'arrived') + tile(c.mine, 'Assigned to me', '', 'mine') + '</div>';
  const soon = all.filter(x => dueDateOf(x) && dayDiff(dueDateOf(x)) <= 14).sort(byDue);
  const groups = [];
  soon.forEach(x => {
    const d = dayDiff(dueDateOf(x));
    const key = d < 0 ? 'Late' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : fmtDay(dueDateOf(x));
    let g = groups.find(g => g.k === key); if (!g) { g = { k: key, red: d < 0, items: [] }; groups.push(g); } g.items.push(x);
  });
  const left = '<div class="card"><div class="cardHd"><h3>Coming up</h3><span class="sub">Lab, delivery and Zoom dates: late and the next 14 days</span></div><div class="cardBd">' +
    (groups.length ? groups.map(g => '<div class="dueGrp"><h4 class="' + (g.red ? 'red' : '') + '">' + esc(g.k) + ' · ' + g.items.length + '</h4>' + g.items.map(x => row(x)).join('') + '</div>').join('') :
      '<div class="empty">No lab or delivery dates in the next two weeks.</div>') + '</div></div>';
  const dr = all.filter(x => DR_STAGES.includes(x.stage)).sort(byDue);
  const noDate = all.filter(x => !dueDateOf(x)).length;
  const right = '<div class="card"><div class="cardHd"><h3>Needs Dr. A</h3><span class="sub">' + dr.length + ' waiting</span></div><div class="cardBd">' +
    (dr.length ? dr.map(x => row(x)).join('') : '<div class="empty">Nothing waiting on Dr. A.</div>') + '</div></div>' +
    (noDate ? '<div class="card" style="margin-top:14px"><div class="cardBd" style="padding:14px 20px"><button class="linkBtn" data-act="tile" data-f="none">' + noDate + ' open case' + (noDate > 1 ? 's have' : ' has') + ' no lab or delivery date</button></div></div>' : '');
  return h + mailCardHTML() + cleanupCardHTML(all) + '<div class="twoCol"><div>' + left + '</div><div>' + right + '</div></div>';
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
      (items.map(c => kcard(c, c.stage === lastKey, col.grp ? col.keys : null)).join('') || '<div class="empty" style="padding:14px 4px">—</div>') + '</div></section>';
  }).join('') + '</div>';
  return h;
}
function kcard(c, last, steps) {
  const mixed = S.boardFlow === 'outside' || S.boardFlow === 'inhouse' || S.boardFlow === 'retainer';
  const flags = shipFlag(c) + recFlag(c) + holdFlag(c);
  return '<div class="kc" data-act="open" data-id="' + esc(c.id) + '" role="button" tabindex="0">' +
    '<div class="kHd">' + ptAv(c, 32) + '<div class="pt">' + esc(c.patient || '(no name)') + '</div></div>' + (c.detail || alN(c) ? '<div class="dt">' + esc(c.detail || '') + alignerMini(c) + '</div>' : '') +
    (flags ? '<div class="flags">' + flags + '</div>' : '') +
    (steps ? '<div class="kstep">' + progHTML(c, steps) + '<div><b>' + esc(stageLabel(c)) + '</b><span>' + (steps.indexOf(c.stage) + 1) + ' of ' + steps.length + '</span></div></div>' : '') +
    '<div class="ft">' + (mixed ? typeMark(c, true) : '') + dueChip(c) + trackLinks(c) + avatar(c) +
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
    : k === 'ship' ? (c.shipToPatient ? 0 : trackList(c).length ? 1 : 2) : (listKey(c) || '9999');
  return list.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : byListDate(a, b)) * dir; });
}
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
  return '<div class="card cleanup" id="cleanCard"><div class="cardHd"><h3>Clean up old cases</h3><span class="sub">Open cases whose latest date (scan, lab or delivery) is before ' + esc(fmtDay(o.cut)) + '</span><span style="flex:1"></span>' +
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
    '<select data-f="due" aria-label="Next date (lab, then delivery)"><option value="">Any next date</option>' + [['over', 'Late'], ['today', 'Today'], ['week', 'Next 7 days'], ['14', 'Next 14 days'], ['none', 'No lab or delivery date']].map(([k, l]) => '<option value="' + k + '"' + (f.due === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<select data-f="del" aria-label="Delivery date"' + (f.del ? ' class="on"' : '') + '><option value="">Any delivery date</option>' + DEL_OPTS.map(([k, l]) => '<option value="' + k + '"' + (f.del === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    (f.del === 'day' ? '<input type="date" id="fDelDay" data-f="delDay" value="' + esc(f.delDay || '') + '" aria-label="Delivery day">' : '') +
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
const LIST_COLS = [['type', 'Type'], ['stage', 'Stage'], ['due', 'Next date'], ['ship', 'Shipping'], ['who', 'Assigned'], ['updated', 'Updated']];
function hiddenCols() {
  if (!S.hidCols) { try { S.hidCols = new Set(JSON.parse(localStorage.getItem('nloCases.hiddenCols') || '[]').filter(k => LIST_COLS.some(x => x[0] === k))); } catch (e) { S.hidCols = new Set(); } }
  return S.hidCols;
}
function setColHidden(k, hide) {
  const h = hiddenCols(); if (hide) h.add(k); else h.delete(k);
  try { localStorage.setItem('nloCases.hiddenCols', JSON.stringify(Array.from(h))); } catch (e) { }
}
function colLabel(k) { return k === 'due' && S.f.del ? 'Delivery' : k === 'stage' && S.view === 'done' ? 'Last stage' : (LIST_COLS.find(x => x[0] === k) || [k, k])[1]; }
/* the Columns button and its menu (keys = the columns this table has) */
function colsControlHTML(keys) {
  const hid = hiddenCols(), n = keys.filter(k => hid.has(k)).length;
  return '<div class="colWrap"><button type="button" class="btn btn-ghost colBtn" data-act="colMenu" aria-expanded="' + !!S.colMenu + '" aria-haspopup="true">' + ic('cols', 16) + 'Columns' + (n ? '<span class="c">' + n + ' hidden</span>' : '') + '</button>' +
    (S.colMenu ? '<div class="colMenu" role="group" aria-label="Columns to show"><div class="colHd">Show these columns</div>' + keys.map(k => '<label class="colOpt"><input type="checkbox" data-col="' + k + '"' + (hid.has(k) ? '' : ' checked') + '> ' + esc(colLabel(k)) + '</label>').join('') +
      (n ? '<button type="button" class="linkBtn" data-act="showCols">Show all</button>' : '') + '<div class="small muted colNote">Saved on this computer</div></div>' : '') + '</div>';
}
function listBodyHTML(base) {
  const f = S.f, list = sortList(applyFilters(base));
  if (list.some(c => c.type === 'nla')) ensureHist();
  if (!list.length) return '<div class="card"><div class="empty">' + (base.length ? 'No cases match.' : 'No open cases yet.') + '</div></div>';
  const hid = hiddenCols(), on = k => !hid.has(k);
  // a heading sorts; its eye hides the column (the Columns menu above the table brings it back)
  const th = (k, l, cls) => '<th class="' + (cls || '') + '"><span class="thIn"><button data-act="sort" data-k="' + k + '">' + l + (S.sort.k === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button>' +
    (k === 'patient' ? '' : '<button class="thHide" data-act="hideCol" data-k="' + k + '" title="Hide this column" aria-label="Hide the ' + esc(l) + ' column">' + ic('eyeOff', 14) + '</button>') + '</span></th>';
  // Shipping: the Ship to patient alert and one-click tracking get their own column (on phones they sit under the name)
  // on phones the date sits under the stage (or the name, with Stage hidden) instead of in a column off to the side
  const chip = c => f.del ? delChip(c) : dueChip(c), dateM = c => on('due') ? '<div class="flags onlyM">' + chip(c) + '</div>' : '';
  return '<div class="card tblWrap"><table class="tbl"><thead><tr>' + th('patient', 'Patient') + (on('type') ? th('type', 'Type', 'hideM') : '') + (on('stage') ? th('stage', 'Stage') : '') + (on('due') ? th('due', colLabel('due'), 'hideM') : '') +
      (on('ship') ? th('ship', 'Shipping', 'hideM') : '') + (on('who') ? th('who', 'Assigned', 'hideM') : '') + (on('updated') ? th('updated', 'Updated', 'hideM') : '') + '</tr></thead><tbody>' +
    list.map(c => { const g = stageGroup(flowOf(c), c.stage), ship = on('ship') ? shipFlag(c) + trackLinks(c) : '';
      return '<tr class="click" data-act="open" data-id="' + esc(c.id) + '" tabindex="0"><td><div class="ptCell">' + ptAv(c, 36) + '<div class="ptTxt"><div class="pt">' + esc(c.patient || '(no name)') + '</div><div class="small muted">' + esc(c.detail || '') + alignerMini(c) + '</div>' +
      (ship ? '<div class="flags onlyM">' + ship + '</div>' : '') + (on('stage') ? '' : dateM(c)) + '</div></div></td>' +
      (on('type') ? '<td class="hideM">' + typeMark(c) + '</td>' : '') +
      (on('stage') ? '<td class="stg">' + progHTML(c) + '<div class="small">' + esc(stageLabel(c)) + (g ? ' <span class="muted">· ' + esc(g.l.toLowerCase()) + ' ' + (g.stages.indexOf(c.stage) + 1) + '/' + g.stages.length + '</span>' : '') + '</div>' +
        (recFlag(c) || holdFlag(c) ? '<div class="flags">' + recFlag(c) + holdFlag(c) + '</div>' : '') + dateM(c) + '</td>' : '') +
      (on('due') ? '<td class="hideM">' + chip(c) + '</td>' : '') +
      (on('ship') ? '<td class="hideM shipCol">' + (ship ? '<div class="flags">' + ship + '</div>' : '') + '</td>' : '') +
      (on('who') ? '<td class="hideM">' + avatar(c) + ' <span class="small">' + esc(staffName(c.assignee, c.assigneeName)) + '</span></td>' : '') +
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
const FIELD_LABELS = { photo: 'photo', labRef: 'lab case #', labHold: 'lab hold', planUrl: 'plan link', shipToPatient: 'ship to patient', records: 'records on file', zoomDate: 'Zoom call', zoomTime: 'Zoom call', tracking: 'tracking #', carrier: 'carrier', teeth: 'tooth chart', teethNote: 'tooth chart', chart: 'chart #', titanUrl: 'Titan link', initial: 'initial/refinement', appliances: 'appliance', lab: 'lab', arches: 'arch', retKinds: 'retainer type', goals: 'Dr. A’s instructions', instrPicks: 'Dr. A’s instructions', instrOther: 'Dr. A’s instructions', extras: 'extras', variant: 'case type', type: 'type', patient: 'patient name', detail: 'detail', stage: 'stage', assignee: 'assignee', assistant: 'assistant', scanner: 'scanner', scanDate: 'scan date', dueDate: 'due date', labDate: 'lab completion date', deliveryDate: 'delivery date', deliveryTime: 'delivery time', alU: 'aligners', alL: 'aligners', aligners: 'aligners', atTemplates: 'attachment templates', instructions: 'Dr. A’s instructions', cc: 'patient’s CC', ipr: 'IPR & spacing', notes: 'notes' };
function historyHTML(c) {
  const h = S.history; if (!h) return '<div class="small muted">Loading…</div>'; if (!h.length) return '<div class="small muted">No history yet.</div>';
  const stageName = k => { const s = c && flowOf(c).stages.find(x => x[0] === k); return s ? s[1] : k; };
  return h.filter(x => x.a !== 'rekey' && x.a !== 'save').reverse().map(x => {
    let t = '';
    if (x.a === 'create') t = 'created the case'; else if (x.a === 'import') t = 'imported it from Asana';
    else if (x.a === 'stage') t = 'moved it to ' + stageName(x.to) + ((x.fields || []).length ? ' (and set ' + Array.from(new Set(x.fields.map(f => FIELD_LABELS[f] || f))).join(', ') + ')' : '');
    else if (x.a === 'comment') t = 'added a comment';
    else if (x.a === 'close') t = 'marked it complete'; else if (x.a === 'reopen') t = 'reopened it';
    else if (x.a === 'assign') t = x.to ? 'assigned it to ' + staffName(x.to, x.to) : 'unassigned it';
    else if (x.a === 'edit') t = 'changed ' + Array.from(new Set((x.fields || []).filter(f => f !== 'instructions').map(f => FIELD_LABELS[f] || f))).join(', ');
    else if (x.a === 'restore') t = 'restored an earlier version';
    else if (x.a === 'photo') t = { add: 'added a photo', change: 'changed the photo', remove: 'removed the photo', copy: 'added the photo from another of the patient’s cases', undo: 'put the earlier photo back' }[x.how] || 'changed the photo';
    else if (x.a === 'email') { // applied from a lab email (mail.js); shown as the email, not the person whose app applied it
      const f = Array.from(new Set((x.fields || []).filter(k => k !== 'mailIds').map(k => FIELD_LABELS[k] || k)));
      t = (x.to ? 'moved it to ' + stageName(x.to) + (f.length ? ' and saved the ' : '') : f.length ? 'saved the ' : 'updated it') + f.join(', ');
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
    wireCaseForm(d, false); phPaint(); savPaint(d);
    const nm = $('#cf-patient', d), hd = $('#dEditName', d); if (nm && hd) nm.addEventListener('input', () => { hd.textContent = nm.value.trim() || '(no name)'; });
    return; }
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
  d.innerHTML = '<div class="dHd"><button type="button" class="dPh" data-act="phEdit" title="' + (c.photo ? 'Change or remove the photo' : 'Add a photo of the patient') + '" aria-label="' + (c.photo ? 'Patient photo: change or remove' : 'Add a patient photo') + '">' + ptAv(c, 64) + '<span class="dPhCam">' + ic('camera', 13) + '</span></button><div style="flex:1;min-width:0"><h3>' + esc(c.patient || '(no name)') + '</h3><div class="sub">' + typeBadge(c) + (c.detail ? '<span class="small muted">' + esc(c.detail) + '</span>' : '') + '</div></div>' +
    '<button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div>' +
    '<div class="dBd"><div id="drawerNotice"></div>' +
    (done ? '<div class="notice info">Completed ' + esc(fmtWhen(c.closedAt)) + '</div>' : '') +
    (c.shipToPatient ? '<div class="notice ship" role="note">' + ic('truck', 18) + '<span><b>Ship to patient</b></span></div>' : '') +
    (isHeld(c) ? '<div class="notice bad mpOld" role="note"><span><b>' + esc(holdText(c)) + '</b></span>' + (done ? '' : '<button class="btn btn-sec btn-sm" data-act="clearHold">Hold is sorted out</button>') + '</div>' : '') +
    // a MARPE entered (or imported) as an appliance before MARPE had its own steps: one click moves it over
    (!done && isOldMarpe(c) ? '<div class="notice info mpOld"><span>MARPE has its own steps now: records, lab, Zoom call, design approval, delivery.</span><button class="btn btn-sec btn-sm" data-act="toMarpe">Switch to MARPE steps</button></div>' : '') +
    // the lab's own link to this patient's plan (from its email), then the company portals
    // in-house: the case's own Titan link first (when saved), then Titan's web version and its beta
    ((PORTALS[c.type] || []).length || safeUrl(c.planUrl) || safeUrl(c.titanUrl) ? '<div class="portals">' +
      (safeUrl(c.titanUrl) ? '<a class="btn btn-pri btn-sm" data-act="portal" href="' + esc(safeUrl(c.titanUrl)) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Open this case in Titan</a>' : '') +
      (safeUrl(c.planUrl) && okLabLink(c.type, c.planUrl) ? '<a class="btn btn-pri btn-sm" data-act="portal" href="' + esc(safeUrl(c.planUrl)) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'View treatment plan</a>' : '') + (PORTALS[c.type] || []).map(p => '<a class="btn btn-sec btn-sm" data-act="portal" href="' + esc(p.u) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Open ' + esc(p.l) + '</a>').join('') +
      '<span class="small muted">Opening a portal copies the patient’s name — paste it in the portal’s search.</span></div>' : '') +
    '<div class="sec" style="margin-top:4px"><h5>Stage</h5><div class="stepper">' + flow.stages.map(([k, l], i) => { const g = stageGroup(flow, k);
      return (g && g.stages[0] === k ? '<div class="stepGrp' + (i <= si ? ' d' : '') + '">' + esc(g.l) + '</div>' : '') +
      '<button class="step ' + (i < si ? 'past' : i === si ? 'cur' : '') + (g ? ' sub' : '') + '" data-act="setStage" data-k="' + k + '"' + (done ? ' disabled' : '') + ' aria-pressed="' + (i === si) + '"><span class="n">' + (i < si ? '✓' : i + 1) + '</span>' + esc(l) + '</button>'; }).join('') + '</div></div>' +
    (flow === FLOWS.marpe ? marpeBoxHTML(c, done) : '') +
    '<div class="sec"><h5>Details</h5><div class="kv">' +
    '<div style="grid-column:1/-1"><div class="k">Assigned to' + (!c.assignee && c.assigneeName ? ' <span class="muted" style="text-transform:none;letter-spacing:0">(Asana: ' + esc(c.assigneeName) + ')</span>' : '') + '</div>' +
      '<div class="staffRow dAssign" role="radiogroup" aria-label="Assigned to">' + [null].concat(withSavedStaff(activeRoster(), c.assignee)).map(r => staffTile(r, (c.assignee || '') === (r ? r.sid : ''), 'aTile', ' role="radio" data-act="assignTo"' + (done ? ' disabled' : ''))).join('') + '</div></div>' +
    kv('Scan date', esc(fmtDay(c.scanDate))) +
    kv('Lab completion', c.labDate ? esc(fmtDay(c.labDate)) + (!done && (dueOf(c) || {}).k === 'lab' ? ' ' + dueChip(c) : '') : '') +
    kv('Delivery', c.deliveryDate ? esc(fmtDay(c.deliveryDate) + (c.deliveryTime ? ', ' + fmtTime(c.deliveryTime) : '')) + (!done && (dueOf(c) || {}).k === 'delivery' ? ' ' + dueChip(c) : '') : '') +
    (c.dueDate && !c.deliveryDate ? kv('Due (older case)', esc(fmtDay(c.dueDate))) : '') +
    (String(c.tracking || '').trim() ? kv('Tracking', trackList(c).length ? trackList(c).map(t => '<span class="trkLine">' + esc(t.n) + (t.carrier ? ' <span class="muted small">' + esc(t.carrier) + '</span>' : '') +
      (t.url ? ' <a class="flag trk" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' + ic('ext', 12) + 'Track</a>' : '') + '</span>').join('') : esc(c.tracking)) : '') +
    (c.labRef ? kv(esc(refLabel(c)), esc(c.labRef)) : '') +
    kv('Assistant', esc(staffName(c.assistant, c.assistantName))) + kv('Scanner', esc(c.scanner)) + kv('Chart #', esc(c.chart || '')) +
    kv('Created', esc((c.createdAt ? fmtWhen(c.createdAt) : '') + (c.createdBy ? ' · ' + firstName(staffName(c.createdBy, '')) : ''))) + kv('Last update', esc(c.updatedAt ? fmtWhen(c.updatedAt) + (c.by ? ' · ' + firstName(staffName(c.by, '')) : '') : '')) +
    '</div></div>' +
    ((c.appliances || []).length || c.lab || c.initial || (c.extras || []).length ? '<div class="sec"><h5>Case</h5><div class="pickRow">' + (c.appliances || []).map(x => '<span class="badge t-appl">' + esc(x) + '</span>').join('') + (c.lab ? '<span class="badge">' + esc(c.lab) + '</span>' : '') + (c.initial ? '<span class="badge">' + esc(submissionLabel(c.initial)) + '</span>' : '') + (c.extras || []).map(x => '<span class="badge t-retx">' + esc(x) + '</span>').join('') + '</div></div>' : '') +
    (c.type === 'nla' ? '<div class="sec" id="alBox"><h5>Aligners</h5>' + alignerTotalHTML(c, false) + '</div>' : '') +
    // retainers & whitening trays: a label for the bag, then it offers to complete the case (Amir, 2 Oct 2026)
    (c.type === 'retainer' ? '<div class="sec" id="retLblBox"><h5>Label</h5><div class="alLbl"><button class="btn btn-sec btn-sm" data-act="retLabels">' + ic('print', 15) + 'Print label</button>' +
      '<span class="small muted">For the bag: patient, upper/lower, retainers or whitening trays' + (done ? '' : ' — then it asks to mark the case complete') + '</span></div></div>' : '') +
    txt('Dr. A’s instructions', c.instructions) +
    (c.teeth && Object.keys(c.teeth).length ? '<div class="sec"><h5>Tooth chart</h5><div class="tc ro">' + toothChartHTML(c.teeth, true) + '</div><div class="txt" style="margin-top:8px">' + esc(teethSummary(c.teeth)) + '</div></div>' : '') +
    txt('Patient’s CC from last visit', c.cc) + txt('IPR & spacing', c.ipr) +
    '<div class="sec"><h5 class="noteHd">Chart note<span class="small muted">to paste into the patient’s chart</span><span style="flex:1"></span><button class="btn btn-sec btn-sm" data-act="copyNote">Copy</button></h5><div class="txt" id="noteTxt">' + esc(chartNote(c)) + '</div></div>' +
    (typeOf(c).aligner && !done ? '<div class="sec" id="iprBox">' + iprBoxHTML(c) + '</div>' : '') + txt('Notes', c.notes) +
    '<div class="sec"><h5>Comments</h5>' + ((c.comments || []).map(x => '<div class="cmt"><span class="av" data-sav="' + esc(x.by || '') + '">' + esc(initials(staffName(x.by, x.by))) + '</span><div><div class="w"><b>' + esc(firstName(staffName(x.by, x.by))) + '</b> · ' + esc(fmtWhen(x.at)) + '</div><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(x.text) + '</div></div></div>').join('') || '<div class="small muted" style="margin-bottom:6px">No comments yet.</div>') +
    (done ? '' : '<div class="field" style="margin-top:8px;margin-bottom:6px"><label for="cmtText" class="hidden">Add a comment</label><textarea id="cmtText" rows="2" placeholder="Add a comment…"></textarea></div><button class="btn btn-sec btn-sm" data-act="addCmt">Add comment</button>') + '</div>' +
    '<div class="sec"><h5>History</h5><div id="histBox">' + historyHTML(c) + '</div></div></div>' +
    '<div class="dFt">' + (done ? '<button class="btn btn-sec" data-act="reopen">Reopen</button>' :
      '<button class="btn btn-mint" data-act="complete" data-id="' + esc(c.id) + '">' + ic('done', 16) + 'Mark complete</button><button class="btn btn-sec" data-act="edit">' + ic('edit', 16) + 'Edit</button>') +
    (isOwner() ? '<span style="flex:1"></span><button class="btn btn-ghost" data-act="versions">' + ic('clock', 16) + 'Versions</button><button class="btn btn-ghost" data-act="delCase" style="color:var(--coral-700)">' + ic('trash', 16) + 'Delete</button>' : '') + '</div>';
  const t = $('#cmtText'); if (t) { t.value = keepCmt; if (hadFocus) t.focus(); }
  phPaint(); savPaint(d); phWireDrawer(d);
  if (typeOf(c).aligner && c.chart && !done) iprAutoLoad(c);
  if (c.type === 'nla') ensureHist();
}
/* ---------- MARPE: records on file and the Zoom call (drawer box, the check before a stage move, the Zoom date) ---------- */
function marpeBoxHTML(c, done) {
  const r = c.records || [], x = dueOf(c), dis = done ? ' disabled' : '';
  const when = c.zoomDate ? '<b>' + esc(fmtDay(c.zoomDate)) + (c.zoomTime ? ' · ' + esc(fmtTime(c.zoomTime)) : '') + '</b>' : '<span class="muted">Not set yet</span>';
  return '<div class="sec" id="mpBox"><h5>MARPE</h5><div class="mpGrid">' +
    '<div class="mpK">Records on file</div><div class="mpV">' + MARPE_RECORDS.map(([k, l]) =>
      '<button type="button" class="pick sm" data-act="rec" data-k="' + k + '" aria-pressed="' + r.includes(k) + '"' + dis + '>' + esc(l) + '</button>').join('') + '</div>' +
    '<div class="mpK">Zoom call</div><div class="mpV"><span class="mpWhen">' + ic('video', 16) + when + '</span>' + (x && x.k === 'zoom' && !done ? dueChip(c) : '') +
      (done ? '' : '<button type="button" class="btn btn-sec btn-sm" data-act="zoomSet">' + (c.zoomDate ? 'Change' : 'Set the date') + '</button>') + '</div></div>' +
    (recordsMissing(c).length && stageIndex(c) <= 0 && !done ? '<div class="small muted mpHint">Both have to be on file before it moves to Submitted to lab.</div>' : '') + '</div>';
}
/* before a stage move goes through, ask for what it needs (see stageNeeds); `extra` = fields already collected */
function stageGateModal(c, to, needs, extra) {
  const lbl = (flowOf(c).stages.find(s => s[0] === to) || [0, to])[1], r = extra.records || c.records || [];
  openModal('<h3>' + esc(lbl) + '</h3><div class="lsub">' + esc((c.patient || '') + ' · ' + typeOf(c).l) + '</div>' +
    (needs.includes('records') ? '<div class="gate" id="gRecs"><b>Before it goes to the lab, both have to be on file:</b>' + MARPE_RECORDS.map(([k, l]) =>
      '<label class="gateRow"><input type="checkbox" data-rec="' + k + '"' + (r.includes(k) ? ' checked' : '') + '>' + esc(l) + '</label>').join('') + '</div>' : '') +
    (needs.includes('zoom') ? '<div class="gate"><b>When is the Zoom call?</b><div class="zoomRow"><div class="field"><label for="gZoomDate">Date</label><input type="date" id="gZoomDate"></div>' +
      '<div class="field"><label for="gZoomTime">Time</label><input type="time" id="gZoomTime"></div></div></div>' : '') +
    // in-house: the aligners in this set (from Titan) and any attachment templates, as it reaches Export STLs
    (needs.includes('aligners') ? '<div class="gate" id="gAl"><b>How many aligners in this set? <span class="h5n">from Titan</span></b><div class="alRow">' +
      '<div class="field"><label for="gAlU">Upper aligners</label><input id="gAlU" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="0" value="' + esc(c.alU || '') + '"></div>' +
      '<div class="field"><label for="gAlL">Lower aligners</label><input id="gAlL" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="0" value="' + esc(c.alL || '') + '"></div></div>' +
      '<b style="margin-top:6px">Any attachment templates?</b>' + pickRow('gAt', AT_OPTS, c.atTemplates || '', false) + '</div>' : '') +
    '<div class="mFt"><button class="btn btn-sec" type="button" data-act="closeModal">Cancel</button><button class="btn btn-pri" type="button" id="gGo">Move to “' + esc(lbl) + '”</button></div>', w => {
      const go = $('#gGo', w), zd = $('#gZoomDate', w), al = $('#gAl', w);
      const n = id => Math.min(99, Math.max(0, parseInt($(id, w).value, 10) || 0));
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
function confirmBox(title, text, okLabel, danger, noLabel) {
  return new Promise(res => {
    openModal('<h3>' + esc(title) + '</h3><p class="lsub" style="font-size:13.5px;color:var(--grey-600)">' + esc(text) + '</p><div class="mFt"><button class="btn btn-sec" id="cbNo">' + esc(noLabel || 'Cancel') + '</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(okLabel) + '</button></div>', w => {
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
function nextStage(c) { const st = flowOf(c).stages; const i = stageIndex(c); return i >= 0 && i < st.length - 1 ? st[i + 1][0] : null; }
/* `extra` = fields saved with the move (e.g. MARPE records, the Zoom call, aligner counts); a move that still needs something
   asks first; `asked` = what the asking window already collected */
async function moveStage(id, to, extra, asked) {
  const c = findCase(id); if (!c || c.stage === to) return;
  extra = extra || {};
  const needs = stageNeeds(Object.assign({}, c, extra), to).filter(x => !(asked || []).includes(x));
  if (needs.length) { stageGateModal(c, to, needs, extra); return; }
  const from = c.stage, fields = Object.keys(extra), before = {}; fields.forEach(k => { before[k] = c[k]; });
  c.stage = to; Object.assign(c, extra); queueRender(); if (S.openId === id) renderDrawer();
  S.pend = S.pend || {}; const mine = S.pend[id] = { to, extra };
  try { await B.mutateCase(id, d => { d.stage = to; Object.assign(d, extra); }, Object.assign({ a: 'stage', from, to }, fields.length ? { fields } : {})); }
  catch (e) { const cur = findCase(id); if (cur && S.pend[id] === mine) { cur.stage = from; Object.assign(cur, before); queueRender(); if (S.openId === id) renderDrawer(); } toast(errText(e), { bad: true }); }
  finally { if (S.pend[id] === mine) delete S.pend[id]; }
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
    case 'open': openDrawer(id); break;
    case 'openClosed': openDrawer(id); break;
    case 'closeDrawer': closeDrawer(); break;
    case 'advance': { const c = findCase(id); const n = c && nextStage(c); if (n) moveStage(id, n); break; }
    case 'complete': completeCase(id); break;
    case 'setStage': moveStage(S.openId, t.dataset.k); break;
    case 'labels': { const c = findCase(S.openId); if (c && alN(c)) labelsModal(c); break; }
    case 'retLabels': { const c = findCase(S.openId); if (c && c.type === 'retainer') retLabelsModal(c); break; }
    case 'rec': toggleRecord(t); break;
    case 'copyNote': { const c = findCase(S.openId); if (c) copyText(chartNote(c)).then(ok => toast(ok ? 'Chart note copied — paste it into the patient’s chart' : 'Couldn’t copy — select the note and copy it', ok ? {} : { bad: true })); break; }
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
    case 'edit': { const c = findCase(S.openId); S.editBase = JSON.parse(JSON.stringify(c)); S.editing = true; renderDrawer(); break; }
    case 'cancelEdit': S.editing = false; renderDrawer(); break;
    case 'saveEdit': saveEdit(); break;
    case 'delCase': (async () => { const c = findCase(S.openId); if (await confirmBox('Delete this case?', 'This removes ' + c.patient + ' from every list. Dr. A can bring it back from Team & security for 90 days. To finish a case normally, use “Mark complete” instead.', 'Delete', true)) { const cid = S.openId; closeDrawer(true); act(() => B.deleteCase(cid), 'Case deleted'); } })(); break;
    case 'newCase': newCaseModal(); break;
    case 'closeModal': closeModal(); break;
    case 'clearF': S.f = noFilters(); renderView(); break;
    case 'colMenu': S.colMenu = !S.colMenu; renderView(); break;
    case 'hideCol': { const k = t.dataset.k, l = colLabel(k); e.stopPropagation(); setColHidden(k, true); renderView();
      toast('“' + l + '” column hidden — bring it back from Columns', { action: 'Undo', onAction: () => { setColHidden(k, false); renderView(); } }); break; }
    case 'showCols': hiddenCols().clear(); setColHidden('', false); S.colMenu = false; renderView(); break;
    case 'oldDone': bulkComplete(oldTicked()); break;
    case 'oldDel': bulkDelete(oldTicked()); break;
    case 'oldAll': case 'oldNone': { const on = a === 'oldAll'; $$('#cleanCard input[data-old]').forEach(i => { i.checked = on; if (on) S.oldOff.delete(i.dataset.old); else S.oldOff.add(i.dataset.old); }); syncOld(); break; }
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
  if (t.classList && t.classList.contains('mlSel')) { const x = MAILS.list.find(g => g.id === t.dataset.g); if (x) { MAILS.pick[x.id] = t.value; const b = $('[data-act=mailApply][data-g="' + CSS.escape(x.id) + '"]'); if (b) b.disabled = !t.value;
    const ph = $('[data-mlph="' + CSS.escape(x.id) + '"]'); if (ph) { ph.innerHTML = ptAv(t.value ? findCase(t.value) : null, 32); phPaint(); } } return; }
  if (t.matches && t.matches('input[data-old]')) { if (t.checked) S.oldOff.delete(t.dataset.old); else S.oldOff.add(t.dataset.old); syncOld(); return; }
  if (t.id === 'oldMonths') { S.oldMonths = Number(t.value) || 3; S.oldOff.clear(); renderView(); return; }
  if (t.id === 'oldNoDate') { S.oldNoDate = t.checked; renderView(); return; }
  if (t.dataset.col) { setColHidden(t.dataset.col, !t.checked); S.colMenu = true; renderView(); return; }
  if (t.dataset.f === 'delDay') { S.f.delDay = t.value; const lb = $('#listBody'); if (lb) { lb.innerHTML = listBodyHTML(listBase()); phPaint(); savPaint(lb); logoPaint(lb); } return; }
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
  const base = S.editBase; const changed = FORM_KEYS.filter(k => !sameVal(now[k], base[k])).concat((now.variant || '') !== (base.variant || '') ? ['variant'] : []);
  if (!changed.length) { S.editing = false; renderDrawer(); return; }
  // the same checks as moving the stage from the case: MARPE records before the lab, a date for the Zoom call
  // (in-house: the form has the aligner counts and attachment templates, so only missing ones stop the save)
  const needs = (changed.includes('stage') && !changed.includes('type') ? stageNeeds(Object.assign({}, base, now, { stage: base.stage }), now.stage) : [])
    .filter(x => x !== 'aligners' || alignersMissing(now));
  if (needs.length) { $('#drawerNotice').innerHTML = '<div class="notice bad">' + (needs.includes('records') ? 'Tick both records (STL scan and CBCT) under Records on file before moving it to ' + esc(stageLabel(now)) + '.' : needs.includes('aligners') ? 'Enter the upper and lower aligners and pick Attachment templates before moving it to ' + esc(stageLabel(now)) + '.' : 'Add the Zoom call date before moving it to Zoom call scheduled.') + '</div>'; $('#drawerNotice').scrollIntoView({ block: 'nearest' }); return; }
  const btn = $('[data-act=saveEdit]', d); busyBtn(btn, true, 'Saving…');
  const id = S.openId;
  try {
    const apply = x => {
      changed.forEach(k => { x[k] = Array.isArray(now[k]) ? now[k].slice() : now[k]; });
      if (changed.includes('assignee') && now.assignee) x.assigneeName = '';
      if (changed.includes('assistant') && now.assistant) x.assistantName = '';
      if (changed.includes('tracking')) x.carrier = ''; // a carrier named by a lab email belonged to the old number
      if (changed.includes('type') && !FLOWS[TYPE[x.type].flow].stages.some(s => s[0] === x.stage)) x.stage = firstStage(x.type);
    };
    await B.mutateCase(id, apply, { a: 'edit', fields: changed });
    // show the saved copy right away (the live update from the server follows a moment later)
    const cur = findCase(id); if (cur) apply(cur);
    S.editing = false; toast('Saved'); renderDrawer(); loadHistory(id);
  } catch (x) { busyBtn(btn, false); toast(errText(x), { bad: true }); }
}
function printCode() {
  const code = $('#recShow') ? $('#recShow').textContent : (S.shownCode || '');
  const w = window.open('', '_blank', 'width=600,height=400'); if (!w) return;
  w.document.write('<title>NLO Cases recovery code</title><body style="font-family:sans-serif;padding:40px"><h2>NLO Cases — recovery code</h2><p>Keep this somewhere safe. It unlocks the office’s case data if the owner password is forgotten.</p><pre style="font-size:26px;letter-spacing:2px">' + esc(code) + '</pre><p>Printed ' + esc(new Date().toLocaleString()) + '</p></body>');
  w.document.close(); w.focus(); w.print();
}
