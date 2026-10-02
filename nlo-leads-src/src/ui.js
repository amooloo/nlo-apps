/* =====================================================================
   UI — sign-in, the main screens, live updates, and filing website
   requests as they arrive. The lead drawer and forms are in forms.js,
   settings / import / account in admin.js.
   ===================================================================== */
const S = {
  demo: false, emu: false, leads: new Map(), closed: [], closedLoaded: false, closedDays: 90, closedWhy: '', hist: null, histLoaded: false,
  roster: [], members: [], settings: { idleMin: 10 }, cfg: leadCfg({}),
  view: 'today', q: '', f: { who: '', due: '', src: '', step: '' }, sort: { k: 'due', dir: 1 },
  openId: null, editing: false, editBase: null, ui: {}, lastLogin: '', loginPw: '', lastAct: Date.now(), idleTimer: null,
  inApp: false, renderQ: false, firstLoad: true, loadErr: '',
  inbox: [], inboxBad: {}, intake: null, ingesting: false, filedHere: new Set(), seen: new Set(), pend: {}, srv: {}, res: null, resDays: 30
};
let B = null;
const ACT = {}; // click actions: data-act="name" → ACT.name(target, event)

/* ---------- icons ---------- */
const IC = {
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 15l2.2 2 4.8-4.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="15.5" y="4" width="5" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.5 2.4 5.2-5.2"/>',
  chart: '<path d="M4 20.5h16.5"/><path d="M6.5 17V11M11 17V6.5M15.5 17v-4M20 17V9"/>',
  gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  import: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  call: '<path d="M6.2 3.8l2.6-.3 1.6 4.2-2 1.4a10.6 10.6 0 006.5 6.5l1.4-2 4.2 1.6-.3 2.6a2 2 0 01-2.1 1.7A16.5 16.5 0 014.5 5.9a2 2 0 011.7-2.1z"/>',
  text: '<path d="M4.5 5.5h15a1 1 0 011 1v9a1 1 0 01-1 1h-8l-4.5 3.5v-3.5h-2.5a1 1 0 01-1-1v-9a1 1 0 011-1z"/><path d="M8 10h8M8 13h5"/>',
  email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  flag: '<path d="M6 21V4.5"/><path d="M6 4.5h11.5l-2.2 4 2.2 4H6"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5s1.2-5.9 3.6-8.5z"/>',
  undo: '<path d="M8.5 6.5L4 11l4.5 4.5"/><path d="M4.5 11h10a5 5 0 010 10h-3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  inbox: '<path d="M3.5 13.5l2.6-8h11.8l2.6 8v5a1.5 1.5 0 01-1.5 1.5h-14a1.5 1.5 0 01-1.5-1.5z"/><path d="M3.5 13.5h5l1.2 2.5h4.6l1.2-2.5h5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
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
  if (/not-pending/.test(c)) return 'That attempt was already logged — maybe by someone else. The lead is up to date now.';
  if (/need-date|bad-date/.test(c)) return (e && e.message) || 'Pick a day.';
  if (/nothing-to-undo/.test(c)) return 'Nothing to undo.';
  if (/permission/.test(c)) return 'Not allowed. Your access may have changed.';
  if (/gone/.test(c)) return 'That lead no longer exists.';
  if (/no-intake-key/.test(c)) return 'The website feed key can’t be opened on this computer.';
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}

/* ---------- boot ---------- */
function boot() {
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.demo = qs.has('demo'); S.emu = local && qs.has('emu');
  try { S.lastLogin = localStorage.getItem('nloLeads.lastLogin') || localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
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
      '<p class="desc">To look around with made-up leads, open the demo.</p><a class="btn btn-pri btn-block" href="?demo">Open the demo</a>';
  } else if (mode === 'login') {
    h = '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · new leads</div>' + err + ok +
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
      S.lastLogin = user; try { localStorage.setItem('nloLeads.lastLogin', user); } catch (x) { }
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
  Object.assign(S, { inApp: true, leads: new Map(), closed: [], closedLoaded: false, hist: null, histLoaded: false, histLoading: null, firstLoad: true, loadErr: '', lastAct: Date.now(),
    inbox: [], inboxBad: {}, inboxTry: {}, inboxWait: {}, intake: null, filedHere: new Set(), seen: new Set(), pend: {}, srv: {}, res: null, view: 'today', openId: null, editing: false, feed: null, showHook: false });
  $('#lockWrap').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderShell(); renderView();
  B.start({
    leads(up, gone) {
      const news = [];
      up.forEach(l => {
        if (S.pend[l.id]) { S.srv[l.id] = l; return; }
        if (!S.firstLoad && !S.seen.has(l.id) && !S.filedHere.has(l.id) && l.src && l.src.kind === 'website' && Date.now() - (l.createdAt || 0) < 180000) news.push(l);
        S.leads.set(l.id, l); S.seen.add(l.id);
      });
      gone.forEach(id => { if (S.pend[id]) { S.srv[id] = 'gone'; return; } S.leads.delete(id); });
      S.firstLoad = false; S.loadErr = ''; queueRender();
      news.forEach(l => toast('New website request: ' + shortName(l), { action: 'Open', onAction: () => openDrawer(l.id) }));
      if (S.openId && (up.some(l => l.id === S.openId) || gone.includes(S.openId))) refreshDrawer(gone.includes(S.openId));
    },
    leadsError(e) { S.firstLoad = false; S.loadErr = /permission/.test((e && e.code) || '') ? 'The office database isn’t ready for leads yet (Dr. A: publish the updated rules).' : errText(e); queueRender(); },
    roster(list) { S.roster = list; queueRender('team'); },
    members(list) { S.members = list; },
    settings(s) { S.settings = Object.assign({ idleMin: 10 }, s || {}); S.cfg = leadCfg(S.settings); queueRender('settings'); },
    inbox(list) { S.inbox = list; Object.keys(S.inboxBad).forEach(id => { if (!list.some(x => x.id === id)) delete S.inboxBad[id]; }); queueRender('inbox'); ingestSoon(); },
    intake(info) { S.intake = info; queueRender('inbox'); ingestSoon(); },
    revoked() { lockOut('Your access was turned off.'); },
    rekeyed() { if (S.inApp) setTimeout(resealIfNeeded, 1500); },
    error(e) { if (/permission/.test((e && e.code) || '')) lockOut('Your access changed. Sign in again.'); else toast(errText(e), { bad: true }); }
  });
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    const mins = Number(S.settings.idleMin) || 10;
    if (S.inApp && Date.now() - S.lastAct > mins * 60000) lockOut('Locked after ' + mins + ' minutes without activity.');
    else if (S.inApp) { updateTitle(); if (S.inbox.length) ingestSoon(); }
  }, 15000);
  ensureHist();
  if (isOwner()) setTimeout(resealIfNeeded, 5000);
}
async function lockOut(msg) {
  if (!S.inApp) return;
  S.inApp = false; clearInterval(S.idleTimer); clearTimeout(S.ingT); clearInterval(S.testT);
  closeModal(); closeDrawer(true);
  Object.assign(S, { leads: new Map(), closed: [], hist: null, histLoaded: false, members: [], roster: [], inbox: [], res: null, verList: null, delList: null, impList: null, editBase: null });
  $('#view').innerHTML = ''; document.title = 'NLO Leads';
  await B.signOut();
  lockScreen('login', { ok: msg });
}

/* ---------- derived data ---------- */
function meSid() { return B.me ? B.me.staffId : ''; }
function isOwner() { return B.isOwner(); }
function staff(sid) { return S.roster.find(r => r.sid === sid); }
function staffName(sid, fallback) { const r = staff(sid); return r ? r.name : (fallback || ''); }
function activeRoster() { return S.roster.filter(r => r.active).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.name.localeCompare(b.name)); }
function openLeads() { return Array.from(S.leads.values()).filter(l => !l.locked); }
/* who a message is from: \"Dr. Akhavan\" for the doctor, first names for everyone else */
function senderName(n) { n = String(n || '').trim(); if (/^dr\.?\s/i.test(n)) { const p = n.split(/\s+/); return 'Dr. ' + p[p.length - 1]; } return firstName(n); }
function shortName(l) { const p = leadName(l).split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0]; }
function matchesQ(l) {
  if (!S.q) return true; const q = S.q.toLowerCase(), digits = q.replace(/\D/g, '');
  return [l.name, l.parent, l.email, l.message, staffName(l.assignee, l.assigneeName)].some(x => String(x || '').toLowerCase().includes(q)) || (digits.length >= 3 && phoneInfo(l.phone).digits.includes(digits));
}
function bucket(l) { return bucketOf(leadDue(l), todayISO()); }
function byDue(a, b) { const x = leadDue(a) || '9999', y = leadDue(b) || '9999'; return x < y ? -1 : x > y ? 1 : receivedAt(a) - receivedAt(b); }
function counts() {
  const all = openLeads(), me = meSid(), t = todayISO();
  const b = l => bucketOf(leadDue(l), t);
  return {
    all: all.length, late: all.filter(l => b(l) === 'late').length, today: all.filter(l => b(l) === 'today').length,
    flagged: all.filter(l => l.flag).length, fresh: all.filter(l => !l.flag && !l.steps.some(s => s.doneAt)).length,
    mine: all.filter(l => l.assignee === me).length, week: all.filter(l => receivedAt(l) >= Date.now() - 7 * 86400000 && countable(l)).length
  };
}

/* ---------- rendering ---------- */
/* live updates redraw the lead screens; Settings, Import and My account keep what's being typed */
function queueRender(kind) {
  S.renderKinds = (S.renderKinds || new Set()); S.renderKinds.add(kind || 'leads');
  if (S.renderQ) return; S.renderQ = true;
  requestAnimationFrame(() => {
    S.renderQ = false; const kinds = S.renderKinds; S.renderKinds = new Set(); if (!S.inApp) return;
    renderNav(); updateTitle();
    if (S.view === 'settings') { if (kinds.has('inbox') || kinds.has('settings')) updateFeedStatus(); return; }
    if (S.view === 'import' || S.view === 'account') return;
    renderView();
  });
}
const NAV = [['today', 'Today', 'today'], ['board', 'Board', 'board'], ['list', 'All open leads', 'list'], ['mine', 'My leads', 'user'], ['closed', 'Closed', 'done'], ['results', 'Results', 'chart']];
function renderShell() {
  const owner = isOwner();
  const navBtns = mob => NAV.map(([k, l, i]) => '<button class="navBtn" data-act="nav" data-v="' + k + '" id="' + (mob ? 'm' : '') + 'nav-' + k + '">' + ic(i) + '<span>' + l + '</span><span class="cnt hidden"></span></button>').join('') +
    (mob ? '' : '<div class="navLbl">Office</div>') +
    (owner ? '<button class="navBtn" data-act="nav" data-v="settings" id="' + (mob ? 'm' : '') + 'nav-settings">' + ic('gear') + '<span>Settings</span><span class="cnt hidden"></span></button>' +
      '<button class="navBtn" data-act="nav" data-v="import" id="' + (mob ? 'm' : '') + 'nav-import">' + ic('import') + '<span>Import &amp; export</span></button>' : '') +
    '<button class="navBtn" data-act="nav" data-v="account" id="' + (mob ? 'm' : '') + 'nav-account">' + ic('key') + '<span>My account</span></button>';
  $('#side').innerHTML = '<div class="sideTop"><img src="logo-white.png" alt="Next Level Orthodontics"><div class="appTag">Leads</div></div>' +
    '<nav class="nav" aria-label="Main">' + navBtns(false) + '</nav>' +
    '<div class="sideFoot"><div class="whoBox"><span class="av">' + esc(initials(B.me.name)) + '</span><div><b>' + esc(B.me.name) + '</b>' + (owner ? 'Owner' : 'Staff') + '</div></div>' +
    '<a class="sideLink" href="nlo-cases.html">' + ic('next', 14) + 'Open NLO Cases</a>' +
    '<button class="sideLock" data-act="lock">' + ic('lock', 16) + 'Lock</button><div class="syncLine" id="syncLine"></div></div>';
  $('#mobTop').innerHTML = '<img src="logo-white.png" alt="NLO"><span class="appTag" style="font-size:11px;letter-spacing:.24em">Leads</span><span style="flex:1"></span>' +
    '<button class="iconBtn" style="color:#fff" data-act="newLead" aria-label="New lead">' + ic('plus') + '</button><button class="iconBtn" style="color:#fff" data-act="lock" aria-label="Lock">' + ic('lock') + '</button>';
  $('#mobNav').innerHTML = navBtns(true);
  renderSync(); renderNav();
}
function renderNav() {
  const c = counts();
  const set = (k, n, red) => ['nav-', 'mnav-'].forEach(p => { const el = $('#' + p + k + ' .cnt'); if (!el) return; el.textContent = n; el.classList.toggle('hidden', !n); el.classList.toggle('red', !!red); });
  set('today', c.late + c.today, c.late > 0); set('list', c.all); set('mine', c.mine);
  set('settings', feedProblem() ? '!' : 0, true);
  $$('.navBtn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
}
/* the tab title shows how many leads need someone now, so a pinned tab says when to look */
function updateTitle() {
  if (!S.inApp) return; const c = counts(); const n = c.late + c.today + c.flagged;
  document.title = (n ? '(' + n + ') ' : '') + 'NLO Leads';
}
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  let cls = 'ok', t = S.demo ? 'Demo · nothing saved' : 'Live · encrypted';
  if (!navigator.onLine) { cls = 'bad'; t = 'Offline'; }
  else if (B && B.pending) { cls = 'busy'; t = 'Saving…'; }
  el.innerHTML = '<span class="dot ' + cls + '"></span>' + t;
}
const TITLES = { today: 'Today', board: 'Board', list: 'All open leads', mine: 'My leads', closed: 'Closed', results: 'Results', settings: 'Settings', import: 'Import & export', account: 'My account' };
const LEAD_VIEWS = ['today', 'board', 'list', 'mine', 'closed'];
function topBar() {
  return '<div class="topBar"><h2>' + esc(TITLES[S.view]) + '</h2>' +
    (LEAD_VIEWS.includes(S.view) ? '<label class="searchBox">' + ic('search', 17) + '<span class="hidden">Search</span><input id="q" type="search" placeholder="Search name, phone, email…" value="' + esc(S.q) + '" aria-label="Search leads"></label>' : '<span style="flex:1"></span>') +
    '<button class="btn btn-teal" data-act="newLead">' + ic('plus', 16) + 'New lead</button></div>';
}
function renderView() {
  const v = $('#view'); const active = document.activeElement && document.activeElement.id === 'q';
  let h = '';
  if (S.view === 'today') h = viewToday();
  else if (S.view === 'board') h = viewBoard();
  else if (S.view === 'list') h = viewList(openLeads(), true);
  else if (S.view === 'mine') h = viewList(openLeads().filter(l => l.assignee === meSid()), false);
  else if (S.view === 'closed') h = viewClosed();
  else if (S.view === 'results') h = viewResults();
  else if (S.view === 'settings') h = isOwner() ? viewSettings() : '';
  else if (S.view === 'import') h = isOwner() ? viewImport() : '';
  else if (S.view === 'account') h = viewAccount();
  $('#topSlot').innerHTML = topBar();
  v.innerHTML = h;
  if (S.view === 'settings') updateFeedStatus();
  if (active) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

/* ---------- small pieces ---------- */
const KIND = { call: 'Call', text: 'Text', email: 'Email' };
function dueChip(l) {
  if (l.status === 'done') return '<span class="due none">' + esc(CLOSE_WHY[l.closeWhy] || 'Closed') + '</span>';
  if (l.flag) return '<span class="due flag">' + ic('flag', 13) + 'Needs a look</span>';
  if (l.stage === 'scheduled') return '<span class="due ok">Scheduled' + (l.appt ? ' ' + esc(fmtDate(l.appt)) : '') + '</span>';
  const due = leadDue(l); if (!due) return '<span class="due none">No step left</span>';
  const d = dayDiff(due), tip = ' title="' + esc('Due ' + fmtDay(due)) + '"';
  if (d < 0) return '<span class="due over"' + tip + '>' + ic('clock', 13) + (d === -1 ? '1 day late' : (-d) + ' days late') + '</span>';
  if (d === 0) return '<span class="due soon"' + tip + '>' + ic('clock', 13) + 'Today</span>';
  if (d === 1) return '<span class="due"' + tip + '>Tomorrow</span>';
  if (d <= 6) return '<span class="due"' + tip + '>' + esc(fmtDay(due).split(',')[0]) + '</span>';
  return '<span class="due"' + tip + '>' + esc(fmtDate(due)) + '</span>';
}
/* "Attempt 2 of 5 · Text" for the step a lead is on */
function stepMeta(l) {
  if (l.status === 'done') return CLOSE_WHY[l.closeWhy] || 'Closed';
  if (l.flag) return FLAG_LABEL[l.flag] || 'Needs a look';
  if (l.stage === 'scheduled') return 'Appointment scheduled';
  const i = curStep(l); if (i < 0) return 'No step left';
  return (i < STEP_DEFS.length ? 'Attempt ' + (i + 1) + ' of ' + STEP_DEFS.length : 'Extra follow-up') + ' · ' + KIND[l.steps[i].kind];
}
function avatar(l) {
  const r = staff(l.assignee);
  if (r) return '<span class="av" title="' + esc(r.name) + '">' + esc(r.initials || initials(r.name)) + '</span>';
  if (l.assigneeName) return '<span class="av none" title="' + esc(l.assigneeName) + '">' + esc(initials(l.assigneeName)) + '</span>';
  return '<span class="av none" title="Unassigned">–</span>';
}
function srcLabel(l) { const s = l.src || {}; return s.kind === 'website' ? 'Website' : s.kind === 'asana' ? 'Asana' : (s.how || 'Added by hand'); }
function srcBadge(l) { const s = l.src || {}; return '<span class="badge ' + (s.kind === 'website' ? 't-web' : s.kind === 'asana' ? 't-asana' : 't-hand') + '">' + (s.kind === 'website' ? ic('web', 12) : '') + esc(srcLabel(l)) + '</span>'; }
function flagBadge(l) { return l.flag ? '<span class="badge t-flag-' + esc(l.flag) + '">' + ic('flag', 12) + esc(FLAG_LABEL[l.flag] || l.flag) + '</span>' : ''; }
function contactLine(l) { const p = phoneInfo(l.phone); return [p.ok ? p.pretty : '', validEmail(l.email) ? l.email : ''].filter(Boolean).join(' · ') || 'No phone or email'; }
function leadRow(l, meta) {
  const i = curStep(l), k = i >= 0 && !l.flag && l.status !== 'done' && l.stage !== 'scheduled' ? l.steps[i].kind : '';
  return '<button class="row" data-act="open" data-id="' + esc(l.id) + '">' + avatar(l) +
    '<span class="grow"><span class="pt">' + esc(leadName(l)) + (l.parent && l.name ? '<span class="par"> · ' + esc(l.parent) + '</span>' : '') + '</span>' +
    '<span class="meta">' + (k ? '<span class="kd k-' + k + '">' + ic(k, 13) + '</span>' : '') + esc(meta != null ? meta : stepMeta(l) + ' · ' + contactLine(l)) + '</span></span>' + dueChip(l) + '</button>';
}

/* ---------- Today ---------- */
function viewToday() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (S.firstLoad && !S.demo) return '<div class="empty">Loading leads…</div>';
  const c = counts(), all = openLeads().filter(matchesQ), t = todayISO();
  const tile = (n, l, cls, f) => '<button class="tile ' + cls + '" data-act="tile" data-f="' + f + '"><span class="n">' + n + '</span><span class="l">' + l + '</span></button>';
  let h = '<div class="tiles">' + tile(c.late, 'Late', 'red', 'late') + tile(c.today, 'Due today', 'amber', 'today') + tile(c.fresh, 'Not contacted yet', 'blue', 'fresh') +
    tile(c.flagged, 'Need a look', 'coral', 'flag') + tile(c.mine, 'Assigned to me', '', 'mine') + tile(c.week, 'New this week', 'mint', 'week') + '</div>';
  h += feedBanner();
  const now = all.filter(l => ['late', 'today'].includes(bucketOf(leadDue(l), t))).sort(byDue);
  const left = '<div class="card"><div class="cardHd"><h3>To do now</h3><span class="sub">' + (now.length ? now.length + ' lead' + (now.length > 1 ? 's' : '') + ' to reach' : 'Late and due today') + '</span></div><div class="cardBd">' +
    (now.length ? now.map(l => leadRow(l)).join('') : '<div class="empty">' + (S.q ? 'No leads match.' : 'All caught up. Nothing due today.') + '</div>') + '</div></div>';
  // the next week, grouped by day
  const soon = all.filter(l => bucketOf(leadDue(l), t) === 'soon').sort(byDue), groups = [];
  soon.forEach(l => { const k = leadDue(l); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(l); });
  const coming = '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Coming up</h3><span class="sub">Next 7 days</span></div><div class="cardBd">' +
    (groups.length ? groups.map(g => '<div class="dueGrp"><h4>' + esc(dayDiff(g.k) === 1 ? 'Tomorrow' : fmtDay(g.k)) + ' · ' + g.items.length + '</h4>' + g.items.map(l => leadRow(l)).join('') + '</div>').join('') : '<div class="empty">Nothing planned for the next week.</div>') + '</div></div>';
  const flagged = all.filter(l => l.flag).sort((a, b) => receivedAt(b) - receivedAt(a));
  const look = '<div class="card"><div class="cardHd"><h3>Need a look</h3><span class="sub">Possible spam, repeats and tests wait here</span></div><div class="cardBd">' +
    (flagged.length ? flagged.map(l => leadRow(l, (FLAG_LABEL[l.flag] || '') + (l.flagWhy ? ' — ' + l.flagWhy : ''))).join('') : '<div class="empty">Nothing to check.</div>') + '</div></div>';
  return h + '<div class="twoCol"><div>' + left + coming + '</div><div>' + look + feedCardSmall() + '</div></div>';
}
/* the website feed on Today: what came in, and anything stuck */
function feedCardSmall() {
  const web = openLeads().filter(l => l.src && l.src.kind === 'website').map(receivedAt).sort((a, b) => b - a)[0];
  const line = !S.intake ? (isOwner() ? 'Not connected yet. Set it up in Settings → Website feed.' : 'Not connected yet.') :
    (web ? 'Last request ' + fmtAgo(web) + '.' : 'No open website requests right now.');
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Website requests</h3></div><div class="cardBd small">' +
    '<p>' + esc(line) + '</p><p class="muted" style="margin-top:6px">Requests from the website’s appointment form are added here automatically, sealed, with the five follow-up attempts planned.</p></div></div>';
}
function fmtAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
}
/* a problem with the feed that the owner should know about */
function feedProblem() {
  if (!S.inbox.length) return '';
  if (!S.intake) return 'Website requests are waiting, but the website feed key is missing.';
  if (S.intake.bad) return 'Website requests are waiting, but this login can’t open the website feed key.';
  const bad = Object.keys(S.inboxBad).length;
  return bad ? bad + ' website request' + (bad > 1 ? 's' : '') + ' couldn’t be opened.' : '';
}
function feedBanner() {
  const p = feedProblem();
  if (p) return '<div class="notice bad" style="margin-bottom:14px">' + esc(p) + (isOwner() ? ' <button class="linkBtn" data-act="nav" data-v="settings">Open Settings</button>' : ' Let Dr. A know.') + '</div>';
  if (S.inbox.length) return '<div class="notice info" style="margin-bottom:14px">' + ic('inbox', 15) + ' Adding ' + S.inbox.length + ' new website request' + (S.inbox.length > 1 ? 's' : '') + '…</div>';
  return '';
}

/* ---------- Board: one column per attempt ---------- */
function viewBoard() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  const all = openLeads().filter(matchesQ);
  const cols = [{ k: 'flag', l: 'Need a look', items: all.filter(l => l.flag) }];
  STEP_DEFS.forEach((d, i) => cols.push({ k: 's' + i, l: (i + 1) + ' · ' + d.label, items: all.filter(l => !l.flag && l.stage !== 'scheduled' && curStep(l) === i) }));
  const extra = all.filter(l => !l.flag && l.stage !== 'scheduled' && curStep(l) >= STEP_DEFS.length);
  if (extra.length) cols.push({ k: 'x', l: 'Extra follow-up', items: extra });
  const sch = all.filter(l => !l.flag && l.stage === 'scheduled');
  if (sch.length) cols.push({ k: 'sch', l: 'Scheduled', items: sch });
  const stuck = all.filter(l => !l.flag && l.stage !== 'scheduled' && curStep(l) < 0);
  if (stuck.length) cols.push({ k: 'none', l: 'No step left', items: stuck });
  return '<div class="board">' + cols.map(c => '<section class="col' + (c.k === 'flag' ? ' flagCol' : '') + '" aria-label="' + esc(c.l) + '"><div class="colHd"><h4>' + esc(c.l) + '</h4><span class="c">' + c.items.length + '</span></div><div class="colBd">' +
    (c.items.sort(c.k === 'flag' ? (a, b) => receivedAt(b) - receivedAt(a) : byDue).map(kcard).join('') || '<div class="empty" style="padding:14px 4px">—</div>') + '</div></section>').join('') + '</div>';
}
function kcard(l) {
  const i = curStep(l), k = i >= 0 && !l.flag && l.stage !== 'scheduled' ? l.steps[i].kind : '';
  return '<div class="kc" data-act="open" data-id="' + esc(l.id) + '" role="button" tabindex="0">' +
    '<div class="pt">' + esc(leadName(l)) + '</div>' + (l.parent && l.name ? '<div class="dt">Parent: ' + esc(l.parent) + '</div>' : '') +
    '<div class="dt">' + (l.flag ? esc(l.flagWhy || FLAG_LABEL[l.flag]) : 'Received ' + esc(fmtWhen(receivedAt(l)))) + '</div>' +
    '<div class="ft">' + (k ? '<span class="kd k-' + k + '" title="' + KIND[k] + '">' + ic(k, 14) + '</span>' : '') + dueChip(l) + '<span style="flex:1"></span>' + avatar(l) + '</div></div>';
}

/* ---------- lists ---------- */
function applyFilters(list) {
  const f = S.f, t = todayISO();
  return list.filter(l => {
    if (!matchesQ(l)) return false;
    if (f.who === '_none' && (l.assignee || l.assigneeName)) return false;
    if (f.who && f.who !== '_none' && l.assignee !== f.who) return false;
    if (f.due) {
      const b = bucketOf(leadDue(l), t);
      if (f.due === 'now' ? !['late', 'today'].includes(b) : f.due === 'flag' ? !l.flag : f.due === 'fresh' ? (l.flag || l.steps.some(s => s.doneAt)) : f.due === 'week' ? !(receivedAt(l) >= Date.now() - 7 * 86400000) : b !== f.due) return false;
    }
    if (f.src && ((l.src && l.src.kind) || 'manual') !== f.src) return false;
    if (f.step !== '' && f.step != null && String(curStep(l)) !== f.step) return false;
    return true;
  });
}
function sortList(list) {
  const { k, dir } = S.sort;
  const val = l => k === 'name' ? leadName(l).toLowerCase() : k === 'step' ? curStep(l) : k === 'recv' ? -receivedAt(l) : k === 'who' ? staffName(l.assignee, l.assigneeName) : k === 'updated' ? -(l.updatedAt || 0) : (leadDue(l) || '9999');
  return list.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : byDue(a, b)) * dir; });
}
function viewList(base, showWho) {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (S.firstLoad && !S.demo) return '<div class="empty">Loading leads…</div>';
  const f = S.f, sel = (k, cur) => k === cur ? ' selected' : '';
  let h = '<div class="filters">' +
    (showWho ? '<select data-f="who" aria-label="Assigned to"><option value="">Anyone</option><option value="_none"' + sel('_none', f.who) + '>Unassigned</option>' + activeRoster().map(r => '<option value="' + esc(r.sid) + '"' + sel(r.sid, f.who) + '>' + esc(r.name) + '</option>').join('') + '</select>' : '') +
    '<select data-f="due" aria-label="When"><option value="">Any time</option>' + [['now', 'Late or today'], ['late', 'Late'], ['today', 'Today'], ['soon', 'Next 7 days'], ['fresh', 'Not contacted yet'], ['flag', 'Need a look'], ['week', 'Received this week']].map(([k, l]) => '<option value="' + k + '"' + sel(k, f.due) + '>' + l + '</option>').join('') + '</select>' +
    '<select data-f="step" aria-label="Attempt"><option value="">Any attempt</option>' + STEP_DEFS.map((d, i) => '<option value="' + i + '"' + sel(String(i), f.step) + '>Attempt ' + (i + 1) + '</option>').join('') + '</select>' +
    '<select data-f="src" aria-label="Source"><option value="">Any source</option>' + [['website', 'Website'], ['manual', 'Added by hand'], ['asana', 'Asana']].map(([k, l]) => '<option value="' + k + '"' + sel(k, f.src) + '>' + l + '</option>').join('') + '</select>' +
    ((f.who || f.due || f.src || f.step) ? '<button class="btn btn-ghost" data-act="clearF">Clear filters</button>' : '') + '</div>';
  const list = sortList(applyFilters(base));
  if (!list.length) return h + '<div class="card"><div class="empty">' + (base.length ? 'No leads match.' : 'No open leads.') + '</div></div>';
  const th = (k, l, cls) => '<th class="' + (cls || '') + '"><button data-act="sort" data-k="' + k + '">' + l + (S.sort.k === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  h += '<div class="card tblWrap"><table class="tbl"><thead><tr>' + th('name', 'Lead') + th('step', 'Attempt') + th('due', 'Next') + th('recv', 'Received', 'hideM') + th('who', 'Assigned', 'hideM') + '</tr></thead><tbody>' +
    list.map(l => '<tr class="click" data-act="open" data-id="' + esc(l.id) + '" tabindex="0"><td><div class="pt">' + esc(leadName(l)) + '</div><div class="small muted">' + esc(contactLine(l)) + '</div></td>' +
      '<td>' + progHTML(l) + '<div class="small">' + esc(stepMeta(l)) + '</div></td><td>' + dueChip(l) + '</td>' +
      '<td class="hideM small muted">' + esc(fmtWhen(receivedAt(l))) + '<div>' + srcBadge(l) + '</div></td><td class="hideM">' + avatar(l) + ' <span class="small">' + esc(staffName(l.assignee, l.assigneeName)) + '</span></td></tr>').join('') +
    '</tbody></table></div><div class="small muted" style="margin-top:8px">' + list.length + ' lead' + (list.length === 1 ? '' : 's') + '</div>';
  return h;
}
/* one mark per attempt: mint = done, navy = now, grey = to come */
function progHTML(l) {
  const n = Math.max(STEP_DEFS.length, l.steps.length), cur = curStep(l);
  let h = ''; for (let i = 0; i < n; i++) { const s = l.steps[i]; h += '<i class="' + (s && s.doneAt ? 'd' : i === cur && !l.flag ? 'c' : s && s.skip ? 's' : '') + '"></i>'; }
  return '<span class="sprog" aria-hidden="true">' + h + '</span>';
}

/* ---------- Closed ---------- */
function viewClosed() {
  if (!S.closedLoaded) { loadClosed(); return '<div class="empty">Loading closed leads…</div>'; }
  const list = S.closed.filter(l => matchesQ(l) && (!S.closedWhy || l.closeWhy === S.closedWhy)).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  let h = '<div class="filters"><select id="closedWhy" aria-label="Reason"><option value="">Any reason</option>' + Object.keys(CLOSE_WHY).map(k => '<option value="' + k + '"' + (S.closedWhy === k ? ' selected' : '') + '>' + esc(CLOSE_WHY[k]) + '</option>').join('') + '</select>' +
    '<span class="small muted">Closed in the last ' + S.closedDays + ' days</span>' + (S.closedDays < 3650 ? '<button class="btn btn-ghost" data-act="moreClosed">Show older</button>' : '') + '</div>';
  if (!list.length) return h + '<div class="card"><div class="empty">No closed leads' + (S.q || S.closedWhy ? ' match' : '') + '.</div></div>';
  return h + '<div class="card tblWrap"><table class="tbl"><thead><tr><th>Lead</th><th>Outcome</th><th>Closed</th><th class="hideM">Attempts</th><th class="hideM">Assigned</th></tr></thead><tbody>' +
    list.map(l => '<tr class="click" data-act="open" data-id="' + esc(l.id) + '" tabindex="0"><td><div class="pt">' + esc(leadName(l)) + '</div><div class="small muted">' + esc(contactLine(l)) + '</div></td>' +
      '<td><span class="badge ' + (l.closeWhy === 'sched' ? 't-ok' : '') + '">' + esc(CLOSE_WHY[l.closeWhy] || 'Closed') + '</span>' + (l.appt ? '<div class="small muted">Appt ' + esc(fmtDay(l.appt)) + (l.apptTime ? ' ' + esc(fmtClock(l.apptTime)) : '') + '</div>' : '') + '</td>' +
      '<td class="small">' + esc(fmtWhen(l.closedAt)) + '</td><td class="hideM small">' + l.steps.filter(s => s.doneAt).length + '</td><td class="hideM">' + avatar(l) + '</td></tr>').join('') +
    '</tbody></table></div>';
}
async function loadClosed() {
  if (S.closedLoading) return; S.closedLoading = true;
  try { S.closed = await B.loadClosed(S.closedDays); } catch (e) { toast(errText(e), { bad: true }); S.closed = []; }
  S.closedLoaded = true; S.closedLoading = false; if (S.view === 'closed') renderView();
}
/* closed leads of the last two months, so a repeat request is spotted even after the first one was closed */
function ensureHist() {
  if (S.histLoaded || !S.inApp) return Promise.resolve();
  if (!S.histLoading) S.histLoading = B.loadClosed(60).then(h => { if (S.inApp) { S.hist = h; S.histLoaded = true; } }, () => { S.hist = []; S.histLoaded = true; }).then(() => { S.histLoading = null; });
  return S.histLoading;
}
function leadPool() {
  const m = new Map(); (S.hist || []).concat(S.closed || []).forEach(l => m.set(l.id, l)); openLeads().forEach(l => m.set(l.id, l));
  return Array.from(m.values());
}

/* ---------- Results ---------- */
function viewResults() {
  const days = S.resDays;
  if (!S.res || S.res.days !== days) { loadResults(days); return resultsHead() + '<div class="empty">Adding up…</div>'; }
  if (S.res.err) return resultsHead() + '<div class="card"><div class="empty">' + esc(S.res.err) + '</div></div>';
  const m = new Map(); S.res.closed.forEach(l => m.set(l.id, l)); openLeads().forEach(l => m.set(l.id, l));
  const list = Array.from(m.values()), now = Date.now(), since = now - days * 86400000;
  const r = leadStats(list, now, days), pct = n => r.received ? Math.round(n / r.received * 100) + '%' : '—';
  const notCounted = list.filter(l => receivedAt(l) >= since && !countable(l));
  const nc = {}; notCounted.forEach(l => { const k = l.flag && l.status !== 'done' ? 'waiting on a look' : l.closeWhy === 'dup' ? 'duplicates' : l.closeWhy === 'spam' ? 'spam' : 'tests'; nc[k] = (nc[k] || 0) + 1; });
  const tile = (n, l, cls, sub) => '<div class="tile static ' + (cls || '') + '"><span class="n">' + n + '</span><span class="l">' + l + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</div>';
  let h = resultsHead() + '<div class="tiles">' + tile(r.received, 'Requests', '') + tile(r.scheduled, 'Scheduled', 'mint', pct(r.scheduled)) + tile(r.working, 'Still working', 'blue', pct(r.working)) +
    tile(r.noresp, 'No response', 'amber', pct(r.noresp)) + tile(r.notint, 'Not interested', 'red', pct(r.notint)) + tile(fmtHours(r.medianHours), 'Typical time to first contact', '', 'median') + '</div>';
  // received and scheduled per week (per month for a year)
  const real = list.filter(l => receivedAt(l) >= since && countable(l));
  const byMonth = days > 120, buckets = [];
  const keyOf = ms => { const d = new Date(ms); if (byMonth) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); const iso = isoOf(d); return addDays(iso, -((d.getDay() + 6) % 7)); };
  let k = keyOf(since);
  for (let i = 0; i < 60 && k <= keyOf(now); i++) {
    buckets.push({ k, n: 0, s: 0 });
    if (byMonth) { const [y, mo] = k.split('-').map(Number); k = mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); } else k = addDays(k, 7);
  }
  real.forEach(l => { const b = buckets.find(x => x.k === keyOf(receivedAt(l))); if (b) { b.n++; if (l.stage === 'scheduled' || l.closeWhy === 'sched') b.s++; } });
  const max = Math.max(1, ...buckets.map(b => b.n));
  const lbl = b => byMonth ? new Date(Number(b.k.slice(0, 4)), Number(b.k.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'short' }) : fmtDate(b.k);
  h += '<div class="twoCol"><div class="card"><div class="cardHd"><h3>' + (byMonth ? 'By month' : 'By week') + '</h3><span class="sub"><span class="lg n"></span>Requests <span class="lg s"></span>Scheduled</span></div><div class="cardBd"><div class="bars">' +
    buckets.map(b => '<div class="bar" title="' + esc(lbl(b) + ': ' + b.n + ' requests, ' + b.s + ' scheduled') + '"><div class="bv"><i class="n" style="height:' + (b.n / max * 100) + '%"></i><i class="s" style="height:' + (b.s / max * 100) + '%"></i></div><span>' + esc(lbl(b)) + '</span></div>').join('') + '</div></div></div>';
  const src = Object.keys(r.bySource).sort((a, b) => r.bySource[b] - r.bySource[a]);
  h += '<div class="card"><div class="cardHd"><h3>Where they came from</h3></div><div class="cardBd">' +
    (src.length ? src.map(s => '<div class="kvRow"><span>' + esc({ website: 'Website', manual: 'Added by hand', asana: 'Asana (imported)' }[s] || s) + '</span><b>' + r.bySource[s] + '</b></div>').join('') : '<div class="small muted">No requests in this period.</div>') +
    '<div class="kvRow"><span>Never reached yet</span><b>' + r.noContact + '</b></div>' +
    (Object.keys(nc).length ? '<p class="small muted" style="margin-top:10px">Not counted: ' + esc(Object.keys(nc).map(x => nc[x] + ' ' + x).join(', ')) + '.</p>' : '') + '</div></div></div>';
  return h;
}
function resultsHead() {
  return '<div class="filters">' + [[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([d, l]) => '<button class="chip' + (S.resDays === d ? ' on' : '') + '" data-act="resDays" data-d="' + d + '">' + l + '</button>').join('') + '</div>';
}
async function loadResults(days) {
  if (S.resLoading === days) return; S.resLoading = days;
  let res;
  try { res = { days, closed: await B.loadClosed(days + 1) }; } catch (e) { res = { days, closed: [], err: errText(e) }; }
  S.resLoading = null; if (!S.inApp) return; S.res = res; if (S.view === 'results') renderView();
}

/* ---------- website requests: open each one and file it as a lead ---------- */
/* the person new leads go to files them first (the owner when nobody is set); any other open computer waits a few
   seconds and steps in only if the request is still waiting, so two computers rarely try the same one */
function ingestSoon() {
  clearTimeout(S.ingT); if (!S.inApp || !S.inbox.length) return;
  const who = pickAssignee(S.cfg, S.roster), first = who ? who === meSid() : isOwner();
  S.ingT = setTimeout(ingest, S.demo ? 400 : first ? 300 + Math.random() * 700 : 4000 + Math.random() * 4000);
}
async function ingest() {
  if (!S.inApp || S.ingesting || !S.inbox.length || S.firstLoad) { if (S.inApp && S.inbox.length && !S.ingesting) ingestSoon(); return; }
  if (!B.canIngest()) { queueRender('inbox'); return; }
  S.ingesting = true; const filed = [];
  try {
    await Promise.race([ensureHist(), new Promise(r => setTimeout(r, 8000))]);
    for (const item of S.inbox.slice()) {
      if (!S.inApp) break;
      if (S.inboxBad[item.id] || !S.inbox.some(x => x.id === item.id) || Date.now() < (S.inboxWait[item.id] || 0)) continue;
      try {
        const { payload, at } = await B.openInbox(item.id);
        const l = leadFromInbox(payload, at, S.cfg, pickAssignee(S.cfg, S.roster), leadPool());
        l.createdAt = Date.now(); l.createdBy = meSid();
        S.filedHere.add(item.id);
        await B.commitIntake(item.id, l);
        filed.push(Object.assign(l, { id: item.id }));
      } catch (e) {
        if (e.code === 'gone') continue;
        if (e.code === 'no-intake-key') break;
        if (e.code === 'unreadable') { S.inboxBad[item.id] = e.message || 'Couldn’t be opened'; continue; }
        if (await B.leadExists(item.id).catch(() => false)) {
          // another computer filed it first (that same save normally removes the request too)
          console.info('NLO Leads: another computer filed this website request first');
          if (S.inbox.some(x => x.id === item.id)) { if (isOwner()) await B.dismissInbox(item.id).catch(() => { }); else S.inboxBad[item.id] = 'Already added as a lead'; }
          continue;
        }
        // anything else (a dropped connection, the office key changing that moment): try again a little later
        const n = S.inboxTry[item.id] = (S.inboxTry[item.id] || 0) + 1;
        if (n >= 4) S.inboxBad[item.id] = 'Couldn’t be added: ' + errText(e); else S.inboxWait[item.id] = Date.now() + n * 15000;
      }
    }
  } finally { S.ingesting = false; queueRender('inbox'); }
  filed.forEach(l => toast((l.flag ? 'Website request (needs a look): ' : 'New website request: ') + shortName(l), { action: 'Open', onAction: () => openDrawer(l.id) }));
  // more to do: right away, or when the next one that failed is due another try
  const left = S.inbox.filter(x => !S.inboxBad[x.id] && !filed.some(f => f.id === x.id));
  if (left.length) { clearTimeout(S.ingT); S.ingT = setTimeout(ingest, Math.max(1500, Math.min(...left.map(x => (S.inboxWait[x.id] || 0) - Date.now())))); }
}
/* owner: after the office key changed in NLO Cases, re-seal leads (and the feed's keys) under the newest key */
async function resealIfNeeded(tries) {
  if (!S.inApp || S.demo || !isOwner() || S.resealing) return;
  // the new key arrives before the office switches to it: wait until it has
  if (B.ringV && B.curV < B.ringV) { if ((tries || 0) < 40) setTimeout(() => resealIfNeeded((tries || 0) + 1), 1500); return; }
  S.resealing = true;
  try {
    const n = await B.oldCount(); const old = S.intake && S.intake.v && S.intake.v < B.curV;
    if (n || old) { const r = await B.resealAll(); if (r.leads) toast('Re-sealed ' + r.leads + ' lead' + (r.leads > 1 ? 's' : '') + ' under the current office key'); }
  } catch (e) { } finally { S.resealing = false; }
}

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
  nav(t) { if (S.view === 'settings' && t.dataset.v !== 'settings') { S.feed = null; S.showHook = false; clearInterval(S.testT); } S.view = t.dataset.v; if (!['list', 'mine'].includes(S.view)) S.f = { who: '', due: '', src: '', step: '' }; closeDrawer(true); renderNav(); renderView(); window.scrollTo(0, 0); },
  tile(t) {
    const f = t.dataset.f; S.f = { who: '', due: '', src: '', step: '' };
    if (f === 'mine') S.view = 'mine'; else { S.view = 'list'; S.f.due = f; } // late · today · fresh · flag · week
    renderNav(); renderView();
  },
  open(t) { openDrawer(t.dataset.id); },
  closeDrawer() { closeDrawer(); },
  closeModal() { closeModal(); },
  clearF() { S.f = { who: '', due: '', src: '', step: '' }; renderView(); },
  sort(t) { const k = t.dataset.k; S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : 1 }; renderView(); },
  moreClosed() { S.closedDays = S.closedDays < 365 ? 365 : 3650; S.closedLoaded = false; renderView(); },
  resDays(t) { S.resDays = Number(t.dataset.d) || 30; renderView(); },
  lock() { lockOut('Locked. Sign in to continue.'); },
  lockSignOut() { B.signOut().then(() => lockScreen('login')); },
  forgot() { lockScreen('forgot'); },
  toLogin() { lockScreen('login'); },
  copyVal(t) { copyText(t.dataset.v).then(ok => toast(ok ? 'Copied' : 'Couldn’t copy — select it and copy by hand', ok ? {} : { bad: true })); }
});
function onClick(e) {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'button' && t.type !== 'submit')) return;
  const a = t.dataset.act;
  if (ACT[a]) ACT[a](t, e);
}
function onChange(e) {
  const t = e.target;
  if (t.dataset && t.dataset.f) { S.f[t.dataset.f] = t.value; renderView(); return; }
  if (t.id === 'closedWhy') { S.closedWhy = t.value; renderView(); return; }
  if (t.dataset && t.dataset.chg && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e);
}
const CHG = {}; // change handlers: data-chg="name"
function onInput(e) { if (e.target.id === 'q') { S.q = e.target.value; renderView(); } }
