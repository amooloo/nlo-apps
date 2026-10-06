/* =====================================================================
   New-user tour — hands-on practice, like NLO Cases' (Amir, 5 Oct 2026: "can you build in a tutorial like the one for case
   tracker?"). It runs in practice mode: the demo (made-up accounts, nothing saved; its settings kept apart from the real
   app's, see demoSandbox) opened as nlo-ar.html?demo&tour=staff — signed in as a staff member, so it looks like the financial
   coordinator's screens — or &tour=owner for Dr. A, who also signs a letter and sees Settings. Each step points at one part
   of the screen; most wait for the trainee to do it (tap a step, open the account, record the letter…) and move on by
   themselves. Offered once on Today, and any time from My account.
   ===================================================================== */
const TOUR = { on: false, kind: '', i: 0, steps: [], timer: null, key: '', name: '', step: '', signKey: '', signName: '', okAt: 0, hold: false, shown: -1, paused: null, backAt: '', ringEl: null };
/* the visible one of several (the side nav on a computer, the bottom nav on a phone) */
function tVis(...sels) { for (const s of sels) { const el = $$(s).find(e => e.getClientRects().length); if (el) return el; } return null; }
function tourGoView(v) { if (v === 'today' && S.focus) { S.focus = false; if (S.view === 'today') renderView(); } if (S.view === v) return; const b = tVis('#nav-' + v, '#mnav-' + v); if (b) b.click(); }
const tVal = x => (typeof x === 'function' ? x() : x);
/* the practice account: a patient account at a letter or text the trainee can record (not one waiting for Dr. A's signature),
   nobody's worked on yet — Letter #1 if there is one */
function tourPick() {
  if (TOUR.key && S.byKey.get(TOUR.key)) return;
  const L = ladDueAccts(), at = id => L.find(a => ladFor(a).due.id === id && !itemFor(a.key));
  const a = ['l1', 'l2', 'l3', 'l6', 't8', 'c75'].map(at).find(Boolean) || L.find(a => { const s = ladFor(a).due; return !s.dra && own(LAD_BY, s.id); });
  if (a) Object.assign(TOUR, { key: a.key, name: a.patient, step: ladFor(a).due.id });
}
/* Dr. A's practice: a letter waiting for his signature */
function tourPickSign() {
  if (TOUR.signKey && itemFor(TOUR.signKey)) return;
  const it = openItems().find(x => { const q = x.drA && drAQuestion(x); return q && q.k === 'drA_ask' && own(LAD_BY, q.step); });
  if (it) Object.assign(TOUR, { signKey: it.key, signName: it.name });
}
/* the row for a key: in a list's table, or on Today (in a given card) */
function tRow(key, cardTitle) {
  if (!key) return null;
  const scope = cardTitle ? $$('#view .card').find(c => (((c.querySelector('h3') || {}).textContent) || '').trim() === cardTitle) : $('#view');
  return scope ? $$('[data-act=open][data-key]', scope).find(r => r.dataset.key === key && r.getClientRects().length) || null : null;
}
function tourSteps(kind) {
  const owner = kind === 'owner', acct = () => (TOUR.key ? S.byKey.get(TOUR.key) : null), lad = () => { const a = acct(); return a ? ladFor(a) : null; };
  const step = () => (own(LAD_BY, TOUR.step) ? LAD_BY[TOUR.step] : LAD_BY.l1);
  const onLad = { ok: () => S.view === 'pd' && S.tab.pd === 'lad', go: 'ladrow' }, onPd = { ok: () => S.view === 'pd', go: 'ladrow' };
  const inAcct = { ok: () => !!TOUR.key && S.openKey === TOUR.key, go: 'open' };
  const st = [
    { id: 'hi', t: 'Welcome to NLO A/R', b: 'This is practice mode: made-up accounts, and nothing you do here is saved. Most steps wait for you to do them, then move on by themselves. Click around anytime, go Back, or End the tour.' },
    { id: 'today', enter: () => tourGoView('today'), at: () => tVis('.tiles'), t: 'Today', b: 'Your starting page: follow-ups due, the collection letters, texts and calls due, the 91+ money, insurance to chase and credits to resolve. Each tile opens its list.' },
    { id: 'goals', enter: () => tourGoView('today'), at: () => $('#view .goals'), t: 'The goals',
      b: () => 'The office’s goals (handbook §19): no more than ' + S.cfg.goalPt + '% of patient accounts ' + (S.cfg.kpiFrom > 1 ? '30+ days past due' : 'past due') + ', and no more than ' + S.cfg.goalIns + '% of insurance accounts past their payment window. Each week’s report updates them; “to go” is how many accounts to bring current.' },
    { id: 'focus', enter: () => tourGoView('today'), at: () => $('#view .focusBar'), t: 'Do these first',
      b: 'Everything that needs doing today in one list, most urgent first: OrthoBanc’s failed-payment report on its days, a promise to pay whose day passed, an account about to reach day 90, insurance near its carrier’s filing limit, a letter waiting on Dr. A. Focus mode shows just that list, and how much is done today.' },
    { id: 'ladrow', enter: () => { tourGoView('today'); tourPick(); }, at: () => $('#view .ladRow[data-step="' + step().id + '"]'), t: 'Collection steps due',
      b: () => 'The office’s collections ladder (handbook §14): the letters, texts and calls due today, step by step. Your practice account' + (TOUR.name ? ', ' + TOUR.name + ',' : '') + ' is at ' + step().s + '.',
      act: () => 'Tap ' + step().s + '.', done: () => S.view === 'pd' && S.tab.pd === 'lad' && S.ladStep === step().id },
    { id: 'ladlist', need: onLad, at: () => $('#view .subChips'), t: 'The ladder, step by step', b: 'Past due opens here: every patient account past due, at the step its days past due call for. Each chip is a step with how many are due; Every step shows them all. “How the ladder works” (above) has the whole ladder.' },
    { id: 'open', need: onPd, enter: () => { if (!tRow(TOUR.key) && S.view === 'pd') { const l = lad(); if (l && !l.due) { S.tab.pd = 'all'; S.ladStep = ''; renderView(); } } }, at: () => tRow(TOUR.key),
      t: 'Open an account', b: () => 'Everything about it is one tap away. Your practice account is ' + (TOUR.name || 'the first one') + '.', act: () => 'Tap ' + (TOUR.name || 'an account') + '.', done: () => !!TOUR.key && S.openKey === TOUR.key },
    { id: 'panel', need: inAcct, at: () => $('#drawer .dHd'), t: 'The account', b: 'Who to call (tap the number to dial it), what’s owed in each aging bucket, the last payment, and why it’s on the list.' },
    { id: 'ladnow', need: inAcct, at: () => $('#drawer .ladNow'), t: 'The step that’s due',
      b: () => 'How ' + step().s + ' goes out, the Weave text to send with it (as written), any call, and what else to do in Edge. Letters Dr. A signs (#4, #5, #7, #8) have “Ask Dr. A to sign”, which puts them on his Today.' },
    { id: 'sent', need: inAcct, at: () => $('#drawer .ladNow [data-act=ladDone]'), t: 'Record it', b: 'Once it’s gone out, one tap records it — who and when. The next step comes due by itself on its day; a certified letter asks for its tracking number.',
      act: () => 'Tap ' + step().btn + '.', done: () => { const l = lad(); return !!l && !!l.done[step().id]; } },
    { id: 'ladall', need: inAcct, at: () => $('#drawer .ladAll summary'), t: 'Every step', b: 'The whole round for this account: what went out, who sent it and when, and the day each next step comes due. Tap it to open the list.' },
    { id: 'logit', need: inAcct, at: () => $('#drawer .nowBox'), t: 'Log anything else', b: 'A call, a voicemail, a text, a promise to pay or a payment plan: one tap, with a note if you like. It sets the next follow-up for you, on an office day.',
      act: 'Tap Called — left a voicemail.', done: () => { const it = TOUR.key && itemFor(TOUR.key); return !!it && (it.log || []).some(e => e.k === 'pt_vm'); } },
    { id: 'work', need: inAcct, at: () => $('#drawer .workRow'), t: 'Who has it, and when to look again', b: 'Assign it to someone, change its status, or pick the follow-up day. On that day it’s back on Today under Follow-ups due.' },
    { id: 'close', skip: () => !S.openKey, at: () => $('#drawer [data-act=closeDrawer]'), t: 'Close it', b: 'Back to the list.', act: 'Tap ✕ (or press Esc).', done: () => !S.openKey },
    { id: 'batch', enter: () => tourGoView('pd'), at: () => $('#view .batchBar') || $('#view .subChips'), t: 'Many at once', b: 'With one step picked, the bar above the list marks them all at once — e.g. this week’s Letter #2s, printed together from Edge. Letters Dr. A signs go to him together too.' },
    { id: 'p91', need: { ok: () => S.view === 'pd', go: 'batch' }, at: () => $('#view [data-act=tab][data-t="91"]'), t: 'Biggest first', b: '91+ days is ranked by the money at 91+ days; a dashed line marks where 70% of it is reached. 31–90 and 0–30 catch accounts before they age.',
      act: 'Tap 91+ days.', done: () => S.view === 'pd' && S.tab.pd === '91' },
    { id: 'ins', at: () => tVis('#nav-ins', '#mnav-ins'), t: 'Insurance', b: 'Insurance accounts where nothing has been paid: a past due that’s an exact multiple of the $11.11 instalment means that many untouched months. Triaged: monitor, chase now, investigate, never filed? The Carriers tab has each carrier’s phone, portal and payer ID, and who’s slow to pay.',
      act: 'Tap Insurance.', done: () => S.view === 'ins' },
    { id: 'cr', at: () => tVis('#nav-cr', '#mnav-cr'), t: 'Credit balances', b: 'Oldest first. Before a refund, each account has the checklist from the FC instructions — the credit often belongs on the family’s balance or a sibling instead. In December, the credit audit tab tracks every credit until the refunds are out (by March 31).',
      act: 'Tap Credits.', done: () => S.view === 'cr' },
    { id: 'rep', at: () => tVis('#nav-reports', '#mnav-reports'), t: 'This week’s report', b: 'Once a week, by ' + DUE_DAYS[S.cfg.dueDay - 1] + ': Edge → Reporting → Financial → Accounts Receivable Aging → Export → Excel, then drop the file here (the steps are on the page). It’s read on this computer and saved sealed. If it’s late, Today shows a red banner until it’s in.',
      act: 'Tap Reports.', done: () => S.view === 'reports' },
    { id: 'sum', at: () => tVis('#nav-sum', '#mnav-sum'), t: 'Summary', b: 'The whole picture: the goals, what moved since last week and who did what, a weekly brief from AISA, totals, aging, the ladder today, insurance with nothing paid, credits — and the Month-End numbers, ready to copy.',
      act: 'Tap Summary.', done: () => S.view === 'sum' },
    { id: 'lock', at: () => tVis('.sideLock', '#mobTop [data-act=lock]'), t: 'Lock when you step away', b: 'Tap Lock whenever you leave the computer: everything is wiped from the screen until you sign in again with your password. It also locks by itself after a few minutes without activity.',
      act: 'Try it: tap Lock, then Sign in.', done: () => TOUR.backAt === 'lock' }
  ];
  if (owner) st.push(
    { id: 'sign', enter: () => { tourGoView('today'); tourPickSign(); }, at: () => tRow(TOUR.signKey, 'Waiting for your OK'), t: 'Letters for you to sign',
      b: 'Letters #4, #5, #7 and #8 wait on your Today, under Waiting for your OK, with refunds and write-offs.', act: () => 'Tap ' + (TOUR.signName || 'the letter') + '.', done: () => !!TOUR.signKey && S.openKey === TOUR.signKey },
    { id: 'signed', need: { ok: () => !!TOUR.signKey && S.openKey === TOUR.signKey, go: 'sign' }, at: () => $('#drawer .drABox'), t: 'Sign it',
      b: 'Signed tells the FC it’s ready to go out; Not yet sends it back. On any letter of yours you can also tap “I signed it” without being asked.', act: 'Tap Signed.',
      done: () => { const it = TOUR.signKey && itemFor(TOUR.signKey); return !!it && !it.drA; } },
    { id: 'close2', skip: () => !S.openKey, at: () => $('#drawer [data-act=closeDrawer]'), t: 'Close it', b: 'Back to Today.', act: 'Tap ✕ (or press Esc).', done: () => !S.openKey },
    { id: 'settings', at: () => tVis('#nav-settings', '#mnav-settings'), t: 'Settings (Dr. A)', b: 'Only you see this page.', act: 'Tap Settings.', done: () => S.view === 'settings' },
    { id: 'access', need: { ok: () => S.view === 'settings', go: 'settings' }, at: () => { const b = $('#accessBox'); return b && b.closest('.card'); }, t: 'Who can use A/R',
      b: 'A/R holds patients’ balances, so you choose who opens it: switch the financial coordinator on here (she signs in to NLO Cases once first). Switching someone off makes a new A/R key at once.' },
    { id: 'numbers', need: { ok: () => S.view === 'settings', go: 'settings' }, at: () => { const i = $('#cfgInst'); return i && i.closest('.card'); }, t: 'The numbers',
      b: 'The $11.11 instalment, the insurance cutoffs, the write-off threshold, the day the weekly report is due and the goals — with a preview of what a change would do.' }
  );
  st.push({ id: 'end', t: 'You’re all set', b: 'That’s the basics. Close this tab to go back to NLO A/R — the real accounts were never touched. You can practice again any time from My account.' });
  return st;
}
/* `from`: picking up after Lock (tourPause) — the same step, the same practice account */
function tourStart(kind, from) {
  tourEnd(false, true);
  Object.assign(TOUR, { on: true, kind, i: 0, steps: tourSteps(kind), key: from ? from.key : '', name: from ? from.name : '', step: from ? from.step : '', signKey: from ? from.signKey : '', signName: from ? from.signName : '',
    okAt: 0, hold: false, shown: -1, backAt: from ? from.at : '', paused: null, ringEl: null });
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
/* practice mode: Lock pauses the tour, and signing back in (the practice password is filled in) picks it up at the same step —
   so "Try it: tap Lock" is safe. Returns the lock screen's message. */
function tourPause(msg) {
  const st = TOUR.steps[TOUR.i];
  TOUR.paused = { i: TOUR.i, key: TOUR.key, name: TOUR.name, step: TOUR.step, signKey: TOUR.signKey, signName: TOUR.signName, at: st ? st.id : '' }; tourEnd(false, true);
  return S.tour ? 'Locked. Your password opens it again — here it’s filled in, so tap Sign in and the tour carries on.' : msg;
}
function tourEnd(finished, quiet) {
  if (!TOUR.on && !$('#tourCard')) return;
  TOUR.on = false; clearInterval(TOUR.timer);
  if (TOUR.onMove) { window.removeEventListener('resize', TOUR.onMove); window.removeEventListener('scroll', TOUR.onMove, true); }
  ['#tourRing', '#tourCard'].forEach(s => { const el = $(s); if (el) el.remove(); });
  if (finished) { try { localStorage.setItem('nloAR.tourDone', String(Date.now())); } catch (e) { } }
  if (!quiet) toast(finished ? 'Tour done — close this tab to go back to NLO A/R' : 'Tour ended — restart it from My account', { ms: 6000 });
}
/* Next / Skip: on to the next step — past any that need something that isn't open (skipping "Tap the account" skips the panel's
   steps), and past "Close it" when nothing is open */
function tourNext() {
  const pass = s => (s.need && !s.need.ok()) || (s.skip && s.skip());
  let j = TOUR.i + 1; while (j < TOUR.steps.length - 1 && pass(TOUR.steps[j])) j++;
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
  // bring what it points at into view once (inside the account panel too)
  setTimeout(() => {
    if (TOUR.i !== i || !TOUR.on) return; const el = st.at && st.at();
    if (el && el.getClientRects().length) { const r = el.getBoundingClientRect(); if (r.top < 60 || r.bottom > innerHeight - 160) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    tourPlace();
  }, 120);
}
function tourCard() {
  const card = $('#tourCard'); if (!card) return; const st = TOUR.steps[TOUR.i], n = TOUR.steps.length, act = tVal(st.act);
  const ok = !!TOUR.okAt || TOUR.hold, last = TOUR.i === n - 1;
  card.classList.toggle('ok', ok); card.classList.toggle('act', !!act);
  card.innerHTML = '<div class="tcTop"><span class="tcN">' + (TOUR.i + 1) + ' of ' + n + '</span><span class="tcBar"><i style="width:' + Math.round((TOUR.i + 1) / n * 100) + '%"></i></span>' +
    (last ? '' : '<button type="button" class="tcEnd" data-tour="end">End tour</button>') + '</div>' +
    '<h4>' + esc(tVal(st.t)) + '</h4><p>' + esc(tVal(st.b)) + '</p>' +
    (act ? '<div class="tcDo">' + (ok ? ic('done', 16) + '<span>' + (TOUR.hold ? 'Done already — tap Next' : 'Nice!') + '</span>' : ic('next', 16) + '<span>' + esc(act) + '</span>') + '</div>' : '') +
    '<div class="tcBtns">' + (TOUR.i ? '<button type="button" class="btn btn-ghost btn-sm" data-tour="back">Back</button>' : '') + '<span style="flex:1"></span>' +
    (act && !ok ? '<button type="button" class="btn btn-ghost btn-sm" data-tour="next">Skip</button>' : '<button type="button" class="btn btn-teal btn-sm" data-tour="next">' + (last ? 'Finish' : TOUR.i ? 'Next' : 'Start') + '</button>') + '</div>';
  // info steps: the keyboard can carry on from the card; action steps leave the focus with the page
  if (!act && TOUR.shown !== TOUR.i) { const b = card.querySelector('[data-tour=next]'); if (b) b.focus({ preventScroll: true }); }
  TOUR.shown = TOUR.i;
}
function tourTick() {
  if (!TOUR.on) return; const st = TOUR.steps[TOUR.i]; if (!st) return;
  if (TOUR.hold && st.done && !st.done()) { TOUR.hold = false; tourCard(); }
  if (st.done && !TOUR.okAt && !TOUR.hold && st.done()) { TOUR.okAt = Date.now(); tourCard(); }
  if (TOUR.okAt) { if (Date.now() - TOUR.okAt > 700) { tourGo(TOUR.i + 1); return; } tourPlace(); return; }
  // the trainee wandered off (closed the account, left the list): back to the step that gets there again
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
/* the practice copy of this page, opened in its own tab: as staff, or as Dr. A (who also signs a letter and sees Settings) */
function tourUrl() { return location.pathname + '?demo&tour=' + (isOwner() ? 'owner' : 'staff'); }
function tourOpen() {
  if (S.tour) { tourStart(S.tour); return; } // already in practice: start over here
  tourOffered(); window.open(tourUrl(), '_blank', 'noopener');
  if ($('#tourOffer')) renderView();
}
function tourOffered() { try { localStorage.setItem('nloAR.tourOffer.' + meSid(), String(Date.now())); } catch (e) { } }
/* once per person on each computer, at the top of Today (not in the demo or practice itself) */
function tourOfferHTML() {
  if (S.demo || TOUR.on || S.arState !== 'ok') return '';
  try { if (localStorage.getItem('nloAR.tourOffer.' + meSid())) return ''; } catch (e) { return ''; }
  return '<div class="card tourOffer" id="tourOffer"><div class="cardBd"><span class="toIc">' + ic('tour', 22) + '</span><div class="toTx"><b>New to NLO A/R?</b> Take the 5-minute hands-on tour. ' +
    'It opens a practice copy with made-up accounts in its own tab, so nothing real changes.</div>' +
    '<button type="button" class="btn btn-teal btn-sm" data-act="tourOpen">Start the tour</button><button type="button" class="btn btn-ghost btn-sm" data-act="tourLater">Not now</button></div></div>';
}
/* My account: the tour any time (for anyone A/R is open to) */
function tourAccountHTML() {
  if (S.arState !== 'ok') return '';
  return '<div class="card" style="max-width:520px;margin-top:18px"><div class="cardHd"><h3>Tour &amp; practice</h3></div><div class="cardBd"><p class="small" style="margin-bottom:10px">' +
    (S.tour ? 'You’re in practice mode. Start the tour over from the beginning here.' : 'A 5-minute hands-on tour of NLO A/R, in a practice copy with made-up accounts (its own tab) — nothing real changes.') +
    '</p><button type="button" class="btn btn-sec btn-sm" data-act="tourOpen">' + ic('tour', 15) + (S.tour ? 'Start over' : 'Take the tour') + '</button></div></div>';
}
Object.assign(ACT, {
  tourOpen() { tourOpen(); },
  tourLater() { tourOffered(); renderView(); toast('You can take the tour any time from My account'); }
});
/* the demo and practice keep their own settings (the remembered username, the tour's "done"…): this page shares its web
   address — and so its browser storage — with the real app. It reads the real ones as a starting point, but what changes
   in the demo stays in the demo (stored under "nloDemo."). Installed before anything reads storage. */
function demoSandbox() {
  const P = 'nloDemo.', GONE = '\u0000gone', SP = Storage.prototype, get = SP.getItem, set = SP.setItem;
  SP.getItem = function (k) { const v = get.call(this, P + k); return v === GONE ? null : v !== null ? v : get.call(this, k); };
  SP.setItem = function (k, v) { return set.call(this, P + k, v); };
  SP.removeItem = function (k) { return set.call(this, P + k, GONE); };
}
