/* =====================================================================
   New-user tour — hands-on practice (Amir, 4 Oct 2026: "create a tutorial for new users … show different parts of the app
   and how the basic functions work"; he chose hands-on practice with made-up patients).
   It runs in practice mode: the demo (made-up patients, nothing saved; its settings kept apart from the real app's, see
   demoSandbox) opened as nlo-cases.html?demo&tour=staff — signed in as a staff member, so it looks like a staff member's
   screens — or &tour=owner for Dr. A, who also gets Team & security. Each step points at one part of the screen; most wait
   for the trainee to do it (tap New case, pick Oliv, …) and move on by themselves. Offered once at first sign-in (Today),
   and any time from My account.
   ===================================================================== */
const TOUR = { on: false, kind: '', i: 0, steps: [], timer: null, id: '', name: '', okAt: 0, hold: false, st0: '', shown: -1, paused: null, backAt: '', ringEl: null };
/* the visible one of several (the side nav on a computer, the bottom nav on a phone) */
function tVis(...sels) { for (const s of sels) { const el = $$(s).find(e => e.getClientRects().length); if (el) return el; } return null; }
function tourMine() { return TOUR.id ? S.cases.get(TOUR.id) : null; }
function tourGoView(v) { if (S.view === v) return; const b = tVis('#nav-' + v, '#mnav-' + v); if (b) b.click(); }
function tourSteps(kind) {
  const owner = kind === 'owner', form = () => $('#ncForm'), mine = tourMine;
  const inForm = { ok: () => !!form(), go: 'new' }, onBoard = { ok: () => S.view === 'board', go: 'board' };
  const inCase = { ok: () => !!mine() && S.openId === TOUR.id, go: 'open' }, onList = { ok: () => S.view === 'list', go: 'list' };
  const card = () => mine() && $('.kc[data-id="' + TOUR.id + '"]');
  const st = [
    { id: 'hi', t: 'Welcome to NLO Cases', b: 'This is practice mode: made-up patients, and nothing you do here is saved. Most steps wait for you to do them, then move on by themselves. Click around anytime, go Back, or End the tour.' },
    { id: 'today', enter: () => tourGoView('today'), at: () => tVis('.tiles'), t: 'Today', b: 'Your starting page: what’s late, what’s due in the next 7 days, what needs Dr. A and what’s being made. Tap a tile any time to see those cases.' },
    { id: 'new', at: () => tVis('.topBar [data-act=newCase]', '#mobTop [data-act=newCase]'), t: 'Add a case', b: 'Every case starts here, right after the scan.', act: 'Tap New case.', done: () => !!form() },
    { id: 'type', need: inForm, at: () => $('#ncForm .tt[data-tile=oliv]'), t: 'Pick the kind of case', b: 'One tile for each kind of case. For practice, make an Oliv case.', act: 'Tap Oliv.',
      done: () => { const t = $('#ncForm .tt[data-tile=oliv]'); return !!t && t.getAttribute('aria-checked') === 'true'; } },
    { id: 'name', need: inForm, at: () => $('#cf-patient'), t: 'The patient', b: 'The only thing you type. Use a made-up name here, like Practice Patient.', act: 'Type a name.',
      track: () => { const i = $('#cf-patient'); if (i) TOUR.name = i.value.trim(); }, done: () => { const i = $('#cf-patient'); return !!i && i.value.trim().length >= 3; } },
    { id: 'initial', need: inForm, at: () => $('#ncForm .pickRow[data-g=initial]'), t: 'What is this submission?', b: 'First set, refinement, mid-course correction — so the lab knows.', act: 'Tap Yes — first set.',
      done: () => !!$('#ncForm .pickRow[data-g=initial] [aria-pressed=true]') },
    { id: 'scanner', need: inForm, at: () => $('#ncForm .scanRow'), t: 'Scanner', b: 'Allied Star is picked to start — tap iTero if that’s the one that took the scans.' + (owner ? '' : ' The assistant above it is already you.') },
    { id: 'instr', need: inForm, at: () => { const g = $('#ncForm .goalGrid'); return g && g.closest('.cfSec'); }, t: 'Dr. A’s instructions', b: 'Tap what Dr. A asked for instead of typing it: Maintain or Improve for midline and overbite, and a picture tile for each instruction. They all go into the case and its chart note.' },
    { id: 'dates', need: inForm, at: () => { const d = $('#cf-scanDate'); return d && d.closest('.grid3'); }, t: 'Dates', b: 'The scan date is today, and the lab completion (3 weeks) and delivery appt (4 weeks) fill in from it — change them to the real ones. They’re what the Lab date and Delivery appt columns show.' },
    { id: 'create', need: inForm, at: () => $('#ncSave'), t: 'Create it', b: 'It’s encrypted before it leaves the computer. If something’s missing, the form says what.', act: 'Tap Create case.',
      track: () => { const i = $('#cf-patient'); if (i) TOUR.name = i.value.trim(); },
      done: () => { if (form()) return false; const c = Array.from(S.cases.values()).filter(x => x.patient === TOUR.name && x.status === 'open').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        if (c) TOUR.id = c.id; return !!c; } },
    { id: 'board', enter: () => { if (!mine()) { const c = openCases().find(x => x.type === 'oliv' && x.stage === 'submit') || openCases().find(x => x.type === 'oliv'); if (c) { TOUR.id = c.id; TOUR.name = c.patient; } } },
      at: () => tVis('#nav-board', '#mnav-board'), t: 'The Board', b: 'Every open case by kind and by step — the way the lab sees the work.', act: 'Tap Board.', done: () => S.view === 'board' },
    { id: 'tab', need: onBoard, at: () => $('.boardTabs [data-k=outside]'), t: 'One tab per kind of case', b: 'Oliv, Angel, uLab and Invisalign cases are under Outside aligners & braces.', act: 'Tap Outside aligners & braces.',
      done: () => S.view === 'board' && S.boardFlow === 'outside' },
    { id: 'move', need: onBoard, enter: () => { const c = mine(); TOUR.st0 = c ? c.stage : ''; }, at: () => { const k = card(); return k && k.querySelector('.adv'); },
      t: 'Move a case along', b: 'Each column is a step. Once you’ve submitted it in Oliv’s portal, the arrow on its card moves it to the next step (here, Dr. A action).', act: 'Tap the arrow on your card.',
      done: () => { const c = mine(); return !!c && !!TOUR.st0 && c.stage !== TOUR.st0; } },
    { id: 'open', need: onBoard, at: card, t: 'Open a case', b: 'Everything about the case is one tap away.', act: 'Tap your card.', done: () => !!TOUR.id && S.openId === TOUR.id },
    { id: 'panel', need: inCase, at: () => $('#drawer .dHd'), t: 'The case', b: 'Each section folds to one line: tap a heading to open it, or Expand all. The steps, Details, Edit and the patient’s photo are all here.' },
    { id: 'note', need: inCase, at: () => $('#drawer [data-ds=note] .dsHd'), t: 'Chart note', b: 'Copy (on its heading) puts the note on the clipboard, ready to paste into the patient’s chart. Open it to switch between the scan visit’s note and the delivery visit’s, each with what the patient was told.' },
    { id: 'comments', need: inCase, at: () => $('#drawer [data-ds=comments] .dsHd'), t: 'Comments', b: 'Notes for the team about this case. Everyone sees them, with who wrote them and when.' },
    { id: 'close', at: () => $('#drawer [data-act=closeDrawer]'), t: 'Close it', b: 'Back to where you were.', act: 'Tap ✕ (or press Esc).', done: () => !S.openId },
    { id: 'list', at: () => tVis('#nav-list', '#mnav-list'), t: 'All open cases', b: 'Every open case in one table. My cases is the same list, just yours.', act: 'Tap All open cases.', done: () => S.view === 'list' },
    { id: 'search', need: onList, at: () => $('#q'), t: 'Search', b: 'Type part of a name, chart #, kind of case or step.', act: 'Search for your patient.',
      done: () => S.view === 'list' && String(S.q || '').trim().length >= 2 && !!TOUR.id && !!$('#listBody tr[data-id="' + TOUR.id + '"]') },
    { id: 'cols', need: onList, at: () => $('#listBody thead'), t: 'Notes, dates and progress', b: 'Notes shows each case’s latest note and who wrote it; Lab date and Delivery appt sit side by side, and Tx progress is there for in-house patients. Tap a heading to sort; its eye hides the column, and Columns brings it back.' },
    { id: 'lock', at: () => tVis('.sideLock', '#mobTop [data-act=lock]'), t: 'Lock when you step away', b: 'Tap Lock whenever you leave the computer: the cases are wiped from the screen until you sign in again with your password. It also locks by itself after a few minutes without activity.',
      act: 'Try it: tap Lock, then Sign in.', done: () => TOUR.backAt === 'lock' }
  ];
  if (owner) st.push(
    { id: 'admin', at: () => tVis('#nav-admin', '#mnav-admin'), t: 'Team & security (Dr. A)', b: 'Only you see this page.', act: 'Tap Team & security.', done: () => S.view === 'admin' },
    { id: 'team', need: { ok: () => S.view === 'admin', go: 'admin' }, at: () => $$('#view .card').find(c => /^Team$/.test(((c.querySelector('h3') || {}).textContent || '').trim())),
      t: 'Team', b: 'Add people from Staff Hub (each gets a temporary password from you), reissue a login when someone forgets theirs, and remove someone who has left.' },
    { id: 'cost', need: { ok: () => S.view === 'admin', go: 'admin' }, at: () => { const i = $('#alPer'); return i && i.closest('.card'); },
      t: 'In-house aligner cost', b: 'What an aligner (and a set) costs: the estimates on in-house cases and the optional Tx cost column use it.' },
    { id: 'mail', need: { ok: () => S.view === 'admin', go: 'admin' }, at: () => $('#mailAdmin'), t: 'Email updates', b: 'Lab emails (uLab, Partners, Oliv, Angel) move cases along on their own, and anything that doesn’t match a case waits on Today.' }
  );
  st.push({ id: 'end', t: 'You’re all set', b: 'That’s the basics. Close this tab to go back to NLO Cases — your real cases were never touched. You can practice again any time from My account.' });
  return st;
}
/* `from`: picking up after Lock (tourPause) — the same step, the same practice patient */
function tourStart(kind, from) {
  tourEnd(false, true);
  Object.assign(TOUR, { on: true, kind, i: 0, steps: tourSteps(kind), id: from ? from.id : '', name: from ? from.name : '', okAt: 0, hold: false, st0: '', shown: -1, backAt: from ? from.at : '', paused: null, ringEl: null });
  const ring = document.createElement('div'); ring.id = 'tourRing'; ring.hidden = true; document.body.appendChild(ring);
  const card = document.createElement('div'); card.id = 'tourCard'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Tour'); document.body.appendChild(card);
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-tour]'); if (!b) return; e.stopPropagation();
    const a = b.dataset.tour;
    if (a === 'next') tourNext(); else if (a === 'back') tourGo(Math.max(0, TOUR.i - 1), true); else if (a === 'end') tourEnd(false);
  });
  TOUR.onMove = () => tourPlace();
  window.addEventListener('resize', TOUR.onMove); window.addEventListener('scroll', TOUR.onMove, true);
  TOUR.timer = setInterval(tourTick, 200);
  tourGo(from ? Math.min(from.i, TOUR.steps.length - 1) : 0);
}
/* practice mode: Lock pauses the tour, and signing back in (enterApp; the practice password is filled in) picks it up at the
   same step — so "Try it: tap Lock" is safe. Returns the lock screen's message. */
function tourPause(msg) {
  const st = TOUR.steps[TOUR.i];
  TOUR.paused = { i: TOUR.i, id: TOUR.id, name: TOUR.name, at: st ? st.id : '' }; tourEnd(false, true);
  return S.tour ? 'Locked. Your password opens it again — here it’s filled in, so tap Sign in and the tour carries on.' : msg;
}
function tourEnd(finished, quiet) {
  if (!TOUR.on && !$('#tourCard')) return;
  TOUR.on = false; clearInterval(TOUR.timer);
  if (TOUR.onMove) { window.removeEventListener('resize', TOUR.onMove); window.removeEventListener('scroll', TOUR.onMove, true); }
  ['#tourRing', '#tourCard'].forEach(s => { const el = $(s); if (el) el.remove(); });
  if (finished) { try { localStorage.setItem('nloCases.tourDone', String(Date.now())); } catch (e) { } }
  if (!quiet) toast(finished ? 'Tour done — close this tab to go back to NLO Cases' : 'Tour ended — restart it from My account', { ms: 6000 });
}
/* Next / Skip: on to the next step — past any that need something that isn't open (skipping "Tap New case" skips the form's steps) */
function tourNext() {
  let j = TOUR.i + 1; while (j < TOUR.steps.length - 1 && TOUR.steps[j].need && !TOUR.steps[j].need.ok()) j++;
  tourGo(j);
}
/* go to step i; `manual` (Back): an action step that's already done waits for Next instead of moving on by itself */
function tourGo(i, manual) {
  if (!TOUR.on) return;
  if (i >= TOUR.steps.length) { tourEnd(true); return; }
  TOUR.i = i; TOUR.okAt = 0; const st = TOUR.steps[i];
  if (st.enter) st.enter();
  TOUR.hold = !!(manual && st.done && st.done());
  tourCard(); tourTick();
  // bring what it points at into view once (inside the New case form or the case panel too)
  setTimeout(() => { if (TOUR.i !== i || !TOUR.on) return; const el = st.at && st.at(); if (el && el.getClientRects().length) { const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight - 160) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } tourPlace(); }, 120);
}
function tourCard() {
  const card = $('#tourCard'); if (!card) return; const st = TOUR.steps[TOUR.i], n = TOUR.steps.length;
  const ok = !!TOUR.okAt || TOUR.hold, last = TOUR.i === n - 1;
  card.classList.toggle('ok', ok); card.classList.toggle('act', !!st.act);
  card.innerHTML = '<div class="tcTop"><span class="tcN">' + (TOUR.i + 1) + ' of ' + n + '</span><span class="tcBar"><i style="width:' + Math.round((TOUR.i + 1) / n * 100) + '%"></i></span>' +
    (last ? '' : '<button type="button" class="tcEnd" data-tour="end">End tour</button>') + '</div>' +
    '<h4>' + esc(st.t) + '</h4><p>' + esc(st.b) + '</p>' +
    (st.act ? '<div class="tcDo">' + (ok ? ic('done', 16) + '<span>' + (TOUR.hold ? 'Done already — tap Next' : 'Nice!') + '</span>' : ic('next', 16) + '<span>' + esc(st.act) + '</span>') + '</div>' : '') +
    '<div class="tcBtns">' + (TOUR.i ? '<button type="button" class="btn btn-ghost btn-sm" data-tour="back">Back</button>' : '') + '<span style="flex:1"></span>' +
    (st.act && !ok ? '<button type="button" class="btn btn-ghost btn-sm" data-tour="next">Skip</button>' : '<button type="button" class="btn btn-teal btn-sm" data-tour="next">' + (last ? 'Finish' : TOUR.i ? 'Next' : 'Start') + '</button>') + '</div>';
  // info steps: the keyboard can carry on from the card; action steps leave the focus with the page (e.g. typing the name)
  if (!st.act && TOUR.shown !== TOUR.i) { const b = card.querySelector('[data-tour=next]'); if (b) b.focus({ preventScroll: true }); }
  TOUR.shown = TOUR.i;
}
function tourTick() {
  if (!TOUR.on) return; const st = TOUR.steps[TOUR.i]; if (!st) return;
  if (st.track) st.track();
  if (TOUR.hold && st.done && !st.done()) { TOUR.hold = false; tourCard(); }
  if (st.done && !TOUR.okAt && !TOUR.hold && st.done()) { TOUR.okAt = Date.now(); tourCard(); }
  if (TOUR.okAt) { if (Date.now() - TOUR.okAt > 700) { tourGo(TOUR.i + 1); return; } tourPlace(); return; }
  // the trainee wandered off (closed the form, the case, the page): back to the step that gets there again
  if (st.need && !st.need.ok()) { const j = TOUR.steps.findIndex(s => s.id === st.need.go); if (j >= 0 && j < TOUR.i) { tourGo(j); return; } }
  tourPlace();
}
/* the ring around what the step points at (it dims the rest; clicks go through to the page), and the card beside it */
function tourPlace() {
  const ring = $('#tourRing'), card = $('#tourCard'); if (!ring || !card) return;
  const st = TOUR.steps[TOUR.i], el = st && st.at ? st.at() : null;
  const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null, vis = !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  if (vis) {
    // the same thing as last time (the page scrolling, a tick): stay right on it; something new: glide over to it
    ring.classList.toggle('glide', !(TOUR.ringEl === el && !ring.hidden)); TOUR.ringEl = el;
    const p = 6; Object.assign(ring.style, { left: (r.left - p) + 'px', top: (r.top - p) + 'px', width: (r.width + p * 2) + 'px', height: (r.height + p * 2) + 'px' }); ring.hidden = false;
  } else { ring.hidden = true; TOUR.ringEl = null; }
  const vw = document.documentElement.clientWidth, vh = innerHeight, phone = vw < 640;
  card.classList.toggle('sheet', phone);
  if (phone) { card.style.left = ''; card.style.top = ''; return; }
  const cw = card.offsetWidth, ch = card.offsetHeight, m = 14, foot = 44;
  let x, y;
  if (vis) {
    if (r.bottom + 14 + ch < vh - foot) { y = r.bottom + 14; x = r.left; }
    else if (r.top - 14 - ch > m) { y = r.top - 14 - ch; x = r.left; }
    else if (r.right + 14 + cw < vw - m) { x = r.right + 14; y = r.top; }
    else { x = r.left - 14 - cw; y = r.top; }
  } else { x = vw - cw - 28; y = vh - ch - foot - 16; }
  x = Math.max(m, Math.min(x, vw - cw - m)); y = Math.max(m, Math.min(y, vh - ch - foot));
  card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
}
/* ---------- where the tour is offered ---------- */
/* the practice copy of this page, opened in its own tab: as staff, or as Dr. A (who also gets Team & security) */
function tourUrl() { return location.pathname + '?demo&tour=' + (isOwner() ? 'owner' : 'staff'); }
function tourOpen() {
  if (S.tour) { tourStart(S.tour); return; } // already in practice: start over here
  tourOffered(); window.open(tourUrl(), '_blank', 'noopener');
  if ($('#tourOffer')) renderView();
}
function tourOffered() { try { localStorage.setItem('nloCases.tourOffer.' + meSid(), String(Date.now())); } catch (e) { } }
/* once per person on each computer, at the top of Today (not in practice mode itself) */
function tourOfferHTML() {
  if (S.demo || TOUR.on) return '';
  try { if (localStorage.getItem('nloCases.tourOffer.' + meSid())) return ''; } catch (e) { return ''; }
  return '<div class="card tourOffer" id="tourOffer"><div class="cardBd"><span class="toIc">' + ic('tour', 22) + '</span><div class="toTx"><b>New to NLO Cases?</b> Take the 5-minute hands-on tour. ' +
    'It opens a practice copy with made-up patients in its own tab, so nothing real changes.</div>' +
    '<button type="button" class="btn btn-teal btn-sm" data-act="tourOpen">Start the tour</button><button type="button" class="btn btn-ghost btn-sm" data-act="tourLater">Not now</button></div></div>';
}
/* My account: the tour any time */
function tourAccountHTML() {
  return '<div class="card" style="max-width:520px;margin-top:18px"><div class="cardHd"><h3>Tour &amp; practice</h3></div><div class="cardBd"><p class="small" style="margin-bottom:10px">' +
    (S.tour ? 'You’re in practice mode. Start the tour over from the beginning here.' : 'A 5-minute hands-on tour of NLO Cases, in a practice copy with made-up patients (its own tab) — nothing real changes.') +
    '</p><button type="button" class="btn btn-sec btn-sm" data-act="tourOpen">' + ic('tour', 15) + (S.tour ? 'Start over' : 'Take the tour') + '</button></div></div>';
}
/* practice mode keeps its own settings (hidden columns, Expand all, Hide photos, the remembered username…): this page shares
   its web address — and so its browser storage — with the real app. It reads the real ones as a starting point, but what
   changes in practice stays in practice (stored under "nloDemo."). Installed before anything reads storage. */
function demoSandbox() {
  const P = 'nloDemo.', GONE = '\u0000gone', SP = Storage.prototype, get = SP.getItem, set = SP.setItem, del = SP.removeItem;
  SP.getItem = function (k) { const v = get.call(this, P + k); return v === GONE ? null : v !== null ? v : get.call(this, k); };
  SP.setItem = function (k, v) { return set.call(this, P + k, v); };
  SP.removeItem = function (k) { return set.call(this, P + k, GONE); };
  void del;
}
