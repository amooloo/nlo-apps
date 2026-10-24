/* =====================================================================
   The page around the app: sign-in and lock screens (the NLO Cases
   logins), the cards shown before the app opens (rules / not moved yet /
   the move), the idle lock, and this tab's sealed draft. The charting
   app itself (app.js, React) is mounted only once the office key is open
   and the records have moved; the lock reloads the page, so nothing
   about a patient stays in this tab's memory.
   ===================================================================== */
const S = {
  emu: false, inApp: false, gate: '', loadErr: '', lastLogin: '', loginPw: '', lastAct: Date.now(), idleTimer: null,
  settings: { idleMin: 10 }, deep: null, moved: null, removed: null, mounted: false
};
let B = null;
const ACT = {};          // click actions: data-act="name" → ACT.name(target, event)
const DRAFT_KEY = 'iprDraft.v4', LOCKMSG_KEY = 'iprLockMsg';
const IDLE_GRACE_MS = 120000;

/* ---------- icons (the lock screens and cards) ---------- */
const IC = {
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.3"/><path d="M8 10.5V7.8a4 4 0 018 0v2.7"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0014 4.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4 16.5v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.8H12v3.4h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.6-3.9 2.6-6.5z"/><path d="M12 21c2.4 0 4.4-.8 5.9-2.2L15 16.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0012 21z"/><path d="M7 13.8a5.4 5.4 0 010-3.5V8H4a9 9 0 000 8.1z"/><path d="M12 6.5c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 004 8l3 2.3c.7-2.1 2.7-3.8 5-3.8z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  shield: '<path d="M12 3l7 2.8v5.5c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.8z"/><path d="M9.2 12l2 2 3.6-3.8"/>'
};
function ic(n, s) { s = s || 18; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[n] || '') + '</svg>'; }

/* ---------- toasts and a confirm box (no browser dialogs on the lock and move cards) ---------- */
function toast(msg, opt) {
  opt = opt || {}; const el = document.createElement('div'); el.className = 'toast' + (opt.bad ? ' bad' : ''); el.setAttribute('role', 'status');
  el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), opt.ms || 3800);
}
function confirmBox(title, text, yes, danger) {
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'lkModal'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = '<div class="lkModalCard"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="btnRow"><button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-pri') + '" id="cbYes">' + esc(yes) + '</button><button type="button" class="btn btn-sec" id="cbNo">Cancel</button></div></div>';
    document.body.appendChild(w);
    const done = v => { w.remove(); res(v); };
    $('#cbYes', w).onclick = () => done(true); $('#cbNo', w).onclick = () => done(false);
    w.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
    $('#cbYes', w).focus();
  });
}
function errText(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/no-user/.test(c)) return 'No login with that username.';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Username or password is incorrect.';
  if (/inactive/.test(c)) return 'This login has been turned off. Ask Dr. A.';
  if (/not-member/.test(c)) return 'That account isn’t part of the office.';
  if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a minute and try again.';
  if (/network|unavailable/.test(c)) return (e && e.message && !/^Firebase/.test(e.message) && e.code === 'unavailable') ? e.message : 'Can’t reach the server. Check the internet connection.';
  if (/weak-password/.test(c)) return 'Password needs at least 8 characters.';
  if (/boot-failed/.test(c)) return 'That temporary password didn’t work. Ask Dr. A to reissue your login.';
  if (/boot-stale/.test(c)) return 'This invite expired after a security update. Ask Dr. A to reissue your login.';
  if (/bad-code/.test(c)) return 'That recovery code didn’t work. Check it and try again.';
  if (/popup-blocked/i.test(c)) return 'The browser blocked the sign-in window. Allow pop-ups for this page and try again.';
  if (/popup-closed|cancelled-popup/i.test(c)) return 'The sign-in window was closed before it finished.';
  if (/permission/.test(c)) return (e && e.message && !/^(Missing or insufficient|PERMISSION_DENIED|Firebase)/i.test(e.message) && e.code === 'permission-denied') ? e.message : 'Not allowed. Your access may have changed.';
  if (/requires-recent-login/.test(c)) return 'Please sign in again, then retry.';
  return (e && e.message) ? String(e.message).replace(/^Firebase:\s*/, '') : 'Something went wrong.';
}
function busyBtn(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
function idleMinutes() { const n = Number(S.settings && S.settings.idleMin); return n > 0 ? n : 10; }

/* ---------- start-up ---------- */
function boot() {
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  S.emu = local && qs.has('emu');
  // a link from NLO Cases (#chart=<chart #>): read once, kept in this tab's memory until the app opens, and taken out of the
  // address right away (older links carried &ini= too — not needed any more)
  try {
    const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const chart = String(h.get('chart') || '').trim().slice(0, 40);
    if (chart) S.deep = { chart };
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { }
  // IPR Tracker 3 kept the patient on screen (chart #, initials and the amounts) readable in this tab, and the recent patients'
  // chart #s and initials on this computer: gone (the draft is sealed now, the recent list keeps record ids only)
  try { Object.keys(sessionStorage).filter(k => /^ipr_/.test(k)).forEach(k => sessionStorage.removeItem(k)); } catch (e) { }
  try { localStorage.removeItem('ipr_recent'); } catch (e) { }
  try { S.lastLogin = localStorage.getItem('nloIpr.lastLogin') || localStorage.getItem('nloCases.lastLogin') || ''; } catch (e) { }
  let lockMsg = ''; try { lockMsg = sessionStorage.getItem(LOCKMSG_KEY) || ''; sessionStorage.removeItem(LOCKMSG_KEY); } catch (e) { }
  document.addEventListener('click', onClick);
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(ev => document.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true, capture: true }));
  B = FB;
  if (!FB.init(S.emu)) { lockScreen('unconfigured'); return; }
  FB.ready().then(() => lockScreen('login', lockMsg ? { ok: lockMsg } : {}));
}
function onClick(e) {
  const t = e.target.closest && e.target.closest('[data-act]');
  if (!t || !ACT[t.dataset.act]) return;
  if (t.tagName === 'A' && !t.getAttribute('href')) e.preventDefault();
  ACT[t.dataset.act](t, e);
}

/* ---------- lock screens (the same logins as NLO Cases) ---------- */
function lockScreen(mode, info) {
  info = info || {};
  $('#lockWrap').classList.remove('hidden'); $('#gateWrap').classList.add('hidden'); $('#root').classList.add('hidden');
  const card = $('#lockCard'); let h = '';
  const err = info.err ? '<div class="lockErr" role="alert">' + esc(info.err) + '</div>' : '';
  const ok = info.ok ? '<div class="lockOk" role="status">' + esc(info.ok) + '</div>' : '';
  if (mode === 'unconfigured') {
    h = '<h1>Almost ready</h1><div class="lsub">This copy can’t reach the office database.</div>';
  } else if (mode === 'login') {
    h = '<h1>Sign in</h1><div class="lsub">Next Level Orthodontics · IPR Tracker</div>' + err + ok +
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
function bindLockForms() {
  const lf = $('#loginForm');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); const btn = $('#lgBtn'); const user = $('#lgUser').value.trim(); const pw = $('#lgPw').value;
    busyBtn(btn, true, 'Signing in…');
    try {
      const r = await B.signIn(user, pw);
      S.lastLogin = user; try { localStorage.setItem('nloIpr.lastLogin', user); } catch (x) { }
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
ACT.forgot = () => lockScreen('forgot');
ACT.toLogin = () => lockScreen('login');
ACT.lockSignOut = async () => { await B.signOut(); S.loginPw = ''; lockScreen('login'); };

/* ---------- in and out ---------- */
async function enterApp() {
  S.inApp = true; S.gate = 'opening'; S.loadErr = ''; S.lastAct = Date.now();
  $('#lockWrap').classList.add('hidden');
  renderGate();
  clearInterval(S.idleTimer);
  S.idleTimer = setInterval(() => {
    if (!S.inApp) return;
    // a save still on its way (or the move) holds the lock off two more minutes at most: with no internet a save can wait for
    // good, and a computer at the chair mustn't stay signed in that long
    const mins = idleMinutes(), waiting = (B && B.pending > 0) || MV.busy;
    if (Date.now() - S.lastAct > mins * 60000 + (waiting ? IDLE_GRACE_MS : 0))
      lockOut('Locked after ' + mins + ' minutes without activity.' + (B && B.pending > 0 ? ' A change was still waiting for the internet, so it may not have been saved.' : ''));
  }, 15000);
  // the idle lock's minutes (NLO Cases → Team & security), before the app opens too
  B.db.doc('meta/settings').get().then(s => { if (s.exists) S.settings = Object.assign({ idleMin: 10 }, s.data()); }).catch(() => { });
  let r;
  try { r = await B.open(); } catch (e) { r = { st: 'error' }; S.loadErr = errText(e); }
  if (!S.inApp) return;
  S.moved = r.moved || null; S.removed = r.removed || null;
  if (r.st === 'ready') startApp(); else { S.gate = r.st; renderGate(); }
}
ACT.retryOpen = async () => {
  S.gate = 'opening'; renderGate(); let r;
  try { r = await B.open(); } catch (e) { r = { st: 'error' }; S.loadErr = errText(e); }
  if (!S.inApp) return;
  S.moved = r.moved || null; S.removed = r.removed || null;
  if (r.st === 'ready') startApp(); else { S.gate = r.st; renderGate(); }
};
/* the records may be opened: the live listeners, then the app with this tab's draft (if it's this person's) */
async function startApp() {
  S.gate = 'ready';
  $('#gateWrap').classList.add('hidden');
  B.start({
    settings(s) { S.settings = Object.assign({ idleMin: 10 }, s || {}); },
    roster(list) { if (typeof iprRosterApply === 'function') iprRosterApply(list || []); },
    patients() { IP_SUBS.forEach(f => { try { f(); } catch (e) { } }); },
    revoked() { lockOut('Your access was turned off.'); },
    error(e) { if (B.isPerm(e)) lockOut('Your access changed. Sign in again.'); else console.warn(e); }
  });
  let draft = null;
  try { const s = sessionStorage.getItem(DRAFT_KEY); if (s) draft = await B.openDraft(s); } catch (e) { draft = null; }
  if (!draft) { try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { } }
  if (!S.inApp) return;
  S.mounted = true;
  mountApp(draft, S.deep); S.deep = null;
}
/* the app hears about patients changing (another computer saved one) */
const IP_SUBS = new Set();
/* locked: the page starts over, so nothing is left in this tab's memory (the sealed draft stays for the same person) */
async function lockOut(msg) {
  if (!S.inApp || S.locking) return;
  S.locking = true; clearInterval(S.idleTimer);
  $('#root').classList.add('hidden'); $('#gateWrap').classList.add('hidden'); $$('.lkModal').forEach(m => m.remove());
  $('#lockCard').innerHTML = '<div class="lsub" style="text-align:center">Locking…</div>'; $('#lockWrap').classList.remove('hidden');
  // what was on screen goes in the draft, and a change still waiting to autosave is saved (a few seconds at most)
  if (S.mounted && APP_HOOKS.flush) await Promise.race([APP_HOOKS.flush().catch(() => { }), new Promise(r => setTimeout(r, 5000))]);
  if (S.mounted) await draftFlush().catch(() => { });
  S.inApp = false;
  document.title = APP_NAME;
  for (let i = 0; i < 30 && B.pending; i++) await new Promise(r => setTimeout(r, 100));
  await B.signOut();
  try { sessionStorage.setItem(LOCKMSG_KEY, msg || ''); } catch (e) { }
  location.reload();
}
async function appLock() {
  if (B.pending && !(await confirmBox('Lock now?', 'A change is still being saved (is the internet connected?). Locking now may lose it.', 'Lock anyway', true))) return;
  lockOut('Locked. Sign in to continue.');
}
ACT.lock = () => appLock();

/* ---------- this tab's draft: what's on screen, sealed for whoever is signed in (backend.js) ---------- */
let DRAFT_PENDING = null, DRAFT_RUN = null;
function draftSave(obj) {
  DRAFT_PENDING = obj;
  if (!DRAFT_RUN) DRAFT_RUN = (async () => {
    let ok = false;
    try {
      while (DRAFT_PENDING) {
        const o = DRAFT_PENDING; DRAFT_PENDING = null;
        if (!B || !B.keys || !S.inApp) break;
        const s = await B.sealDraft(o);
        if (!S.inApp || !B.keys) break;
        try { sessionStorage.setItem(DRAFT_KEY, s); ok = true; } catch (e) { }
      }
    } catch (e) { } finally { DRAFT_RUN = null; }
    return ok;
  })();
  return DRAFT_RUN;
}
async function draftFlush() { if (DRAFT_RUN) await DRAFT_RUN; }
function draftClear() { DRAFT_PENDING = null; try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { } }

/* ---------- the cards shown before the app opens ---------- */
function gateTop() {
  const me = B.me || {};
  return '<div class="gateWho"><span>' + ic('shield', 14) + 'Signed in as <b>' + esc(firstName(me.name) || me.staffId || '') + '</b></span><button type="button" class="btn btn-ghost lkGhost" data-act="lock">' + ic('lock', 15) + 'Lock</button></div>';
}
function renderGate() {
  if (!S.inApp) return;
  $('#gateWrap').classList.remove('hidden'); $('#root').classList.add('hidden');
  const g = S.gate, card = (title, body) => '<div class="card gateCard"><div class="cardHd"><h3>' + title + '</h3></div><div class="cardBd">' + body + '</div></div>';
  const again = '<button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button>';
  const oldBtn = '<a class="btn btn-sec btn-sm" href="' + OLD_URL + (S.deep ? '#chart=' + encodeURIComponent(S.deep.chart) : '') + '">Open the old IPR Tracker</a>';
  let h = '';
  if (g === 'opening') h = '<div class="card gateCard loadCard"><span class="spin"></span><div style="margin-top:10px">Opening the IPR Tracker…</div></div>';
  else if (g === 'error') h = card('Couldn’t open the IPR Tracker', '<p class="small">' + esc(S.loadErr || 'Something went wrong.') + '</p><div class="btnRow">' + again + '</div>');
  else if (g === 'rules') h = B.isOwner() ? rulesCardHTML(true) : card('The IPR Tracker isn’t ready yet', '<p class="small">The office database needs an update from Dr. A first. Until then, keep using the old IPR Tracker.</p><div class="btnRow">' + oldBtn + again + '</div>');
  else if (g === 'notyet') h = card('The IPR Tracker is moving to your NLO Cases login', '<p class="small">Dr. A is moving the patients and their visits over. Until he’s done, keep using the old IPR Tracker.</p><div class="btnRow">' + oldBtn + again + '</div>');
  else if (g === 'move') h = moveCardHTML();
  $('#gateCard').innerHTML = gateTop() + h;
  if (g === 'move') moveAfter();
}
function rulesText() { return IPR_RULES.replace('__OWNER_EMAIL__', String((B.me && B.me.email) || '').toLowerCase()); }
function rulesCardHTML(first) {
  return '<div class="card rulesBox gateCard"><div class="cardHd"><h3>' + (first ? 'One step before the IPR Tracker can open' : 'Database rules') + '</h3></div><div class="cardBd">' +
    '<p class="small">The office database needs its updated rules — they add the IPR Tracker and keep everything NLO Cases, Leads, A/R, Time Off, the Time Clock and Inventory already have. It’s the same card those apps show when they need newer rules.</p>' +
    '<ol class="steps small"><li>Press <b>Copy the new rules</b>.</li><li>Open the <b>Firebase console</b> → <b>Firestore Database</b> (left menu) → <b>Rules</b> tab.</li><li>Select everything there (Ctrl+A), paste over it, and press <b>Publish</b>.</li><li>Come back and press <b>Check again</b>.</li></ol>' +
    '<div class="btnRow"><button class="btn btn-pri btn-sm" data-act="copyRules">' + ic('copy', 15) + 'Copy the new rules</button>' +
    '<a class="btn btn-sec btn-sm" href="https://console.firebase.google.com/project/nlo-cases/firestore/rules" target="_blank" rel="noopener noreferrer">Open the Firebase console</a>' +
    '<button class="btn btn-ghost" data-act="retryOpen">' + ic('refresh', 15) + 'Check again</button></div>' +
    '<details class="help"><summary>See the rules</summary><textarea readonly id="rulesTxt">' + esc(rulesText()) + '</textarea></details></div></div>';
}
ACT.copyRules = () => { navigator.clipboard.writeText(rulesText()).then(() => toast('Rules copied — paste them over everything in the Firebase console and press Publish.', { ms: 7000 }), () => toast('Couldn’t copy — open “See the rules” and copy them by hand.', { bad: true })); };
