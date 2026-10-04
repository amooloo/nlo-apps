// The new-user tour, hands-on in practice mode (Amir, 4 Oct 2026: "create a tutorial for new users … how the basic functions
// work"; he chose hands-on practice) — ?demo&tour=staff walked through like a new staff member, ?demo&tour=owner, phones
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const BASE = 'http://127.0.0.1:8765/nlo-cases.html';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await routes(ctx);
  // the real app's own settings on this computer (same web address), set before any page script runs: practice must leave them alone
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('seededReal')) { localStorage.setItem('seededReal', '1'); localStorage.setItem('nloCases.lastLogin', 'gwen.real'); localStorage.setItem('nloCases.hiddenCols', '["updated"]'); } } catch (e) { } });
  const p = await ctx.newPage(); watch(p, errs, 'practice');

  const step = () => p.evaluate(() => TOUR.on ? TOUR.steps[TOUR.i].id : 'off');
  const waitStep = (id, ms) => p.waitForFunction(id => TOUR.on && TOUR.steps[TOUR.i].id === id && !TOUR.okAt, id, { timeout: ms || 10000 }).then(() => true, () => false);
  const card = () => p.evaluate(() => { const c = document.getElementById('tourCard'); if (!c) return null; const r = c.getBoundingClientRect();
    return { h: (c.querySelector('h4') || {}).textContent, n: (c.querySelector('.tcN') || {}).textContent, act: (c.querySelector('.tcDo') || {}).textContent || '', ok: c.classList.contains('ok'), sheet: c.classList.contains('sheet'),
      r: { l: r.left, t: r.top, rt: r.right, b: r.bottom } }; });
  // the ring sits on what the step points at, and the card doesn't cover it
  const aimedNow = () => p.evaluate(() => { const st = TOUR.steps[TOUR.i], el = st.at && st.at(), ring = document.getElementById('tourRing'), c = document.getElementById('tourCard');
    if (!el || !ring || ring.hidden) return { ring: false };
    const a = el.getBoundingClientRect(), b = ring.getBoundingClientRect(), k = c.getBoundingClientRect();
    const on = Math.abs(b.left - (a.left - 6)) < 3 && Math.abs(b.top - (a.top - 6)) < 3 && Math.abs(b.width - (a.width + 12)) < 3;
    const overlap = !(k.right <= a.left || k.left >= a.right || k.bottom <= a.top || k.top >= a.bottom);
    const inView = k.left >= 0 && k.top >= 0 && k.right <= innerWidth && k.bottom <= innerHeight;
    return { ring: true, on, overlap, inView }; });
  const aimed = async () => { let a; for (let k = 0; k < 15; k++) { a = await aimedNow(); if (a.ring && a.on) { await p.waitForTimeout(150); return aimedNow(); } await p.waitForTimeout(150); } return a; };
  const shot = n => p.screenshot({ path: OUT + '/v39-' + n + '.png' });

  // ---------------- staff practice: opens signed in as a staff member, the tour starts by itself ----------------
  await p.goto(BASE + '?demo&tour=staff');
  check(await waitStep('hi'), 'practice mode opens signed in and the tour starts by itself');
  const who = await p.evaluate(() => ({ name: B.me.name, owner: isOwner(), admin: !!document.getElementById('nav-admin'), bar: document.getElementById('demoBar').textContent, sync: document.getElementById('syncLine').textContent }));
  check(who.name === 'Practice User' && !who.owner && !who.admin && /^Practice — made-up patients/.test(who.bar) && who.sync === 'Practice · nothing saved', 'signed in as a staff member (“Practice User”, no Team & security); the bar and the status line say Practice');
  let c = await card();
  const total = Number((c.n || '').split(' of ')[1]);
  check(c.h === 'Welcome to NLO Cases' && /^1 of \d+$/.test(c.n), 'step 1: Welcome (' + c.n + ')');
  await shot('1-welcome');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('today'), 'Start → Today');
  let a = await aimed(); check(a.ring && a.on && !a.overlap && a.inView, 'the ring is on the Today tiles and the card sits beside them, in view');
  await shot('2-today');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('new'), 'Next → Add a case');
  c = await card(); check(/Tap New case/.test(c.act) && !c.ok, 'it waits for “Tap New case.”');
  await shot('3-new');
  await p.click('.topBar [data-act=newCase]');
  check(await waitStep('type'), 'tapping New case moves the tour on by itself');
  a = await aimed(); check(a.ring && a.on && !a.overlap, 'Pick the kind of case: the ring is on the Oliv tile (inside the form)');
  await shot('4-type');
  // wandering off: closing the form sends the tour back to “Tap New case”
  await p.click('.modal [data-act=closeModal]');
  check(await waitStep('new'), 'closing the form mid-way: back to “Tap New case”');
  await p.click('.topBar [data-act=newCase]'); await waitStep('type');
  // Back on a step that's done already waits for Next
  await p.click('#tourCard [data-tour=back]');
  await p.waitForTimeout(900);
  c = await card(); check((await step()) === 'new' && c.ok && /Done already/.test(c.act), 'Back to a step already done: “Done already — tap Next”, no jumping ahead');
  await p.click('#tourCard [data-tour=next]'); await waitStep('type');
  await p.click('#ncForm .tt[data-tile=oliv]');
  check(await waitStep('name'), 'tapping Oliv → The patient');
  await p.fill('#cf-patient', 'Practice Patient');
  check(await waitStep('initial'), 'typing a name → What is this submission?');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  check(await waitStep('scanner'), 'Yes — first set → Scanner');
  check(/Allied Star is picked to start/.test(await p.textContent('#tourCard p')) && /already you/.test(await p.textContent('#tourCard p')) && await p.evaluate(() => !!document.querySelector('#ncForm .scanRow [aria-pressed=true]')), 'Scanner: Allied Star picked to start; staff: “The assistant above it is already you.”');
  a = await aimed(); check(a.ring && a.on, 'the ring is on the scanner tiles');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('instr'), 'Next → Dr. A’s instructions');
  a = await aimed(); check(a.ring && a.on, 'the ring is on Dr. A’s instructions');
  await shot('5-instr');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('dates'), 'Next → Dates');
  a = await aimed(); check(a.ring && a.on && a.inView, 'the ring is on the three dates (filled in from the scan date)');
  check(await p.evaluate(() => !!document.getElementById('cf-labDate').value && !!document.getElementById('cf-deliveryDate').value), 'lab completion and delivery appt are filled in');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('create'), 'Next → Create it');
  await shot('6-create');
  await p.click('#ncSave');
  check(await waitStep('board'), 'Create case → The Board');
  const mine = await p.evaluate(() => { const c = TOUR.id && S.cases.get(TOUR.id); return c ? { patient: c.patient, type: c.type, stage: c.stage, by: c.createdBy } : null; });
  check(mine && mine.patient === 'Practice Patient' && mine.type === 'oliv' && mine.stage === 'submit' && mine.by === 'practice', 'the practice case exists: Practice Patient, Oliv, To submit, created by the practice user');
  await p.click('#nav-board');
  const t1 = await Promise.race([waitStep('tab', 3000), waitStep('move', 3000)]);
  if ((await step()) === 'tab') await p.click('.boardTabs [data-k=outside]');
  check(t1 && await waitStep('move'), 'Board → (Outside aligners tab) → Move a case along');
  a = await aimed(); check(a.ring && a.on && !a.overlap, 'the ring is on the arrow of the trainee’s own card');
  await shot('7-move');
  await p.click('.kc[data-id="' + await p.evaluate(() => TOUR.id) + '"] .adv');
  check(await waitStep('open'), 'the arrow moves the case → Open a case');
  check(await p.evaluate(() => S.cases.get(TOUR.id).stage) === 'dra', 'the case moved to Dr. A action');
  await p.click('.kc[data-id="' + await p.evaluate(() => TOUR.id) + '"] .pt');
  check(await waitStep('panel'), 'tapping the card opens it → The case');
  a = await aimed(); check(a.ring && a.on && a.inView, 'the ring is on the case’s header');
  await shot('8-panel');
  for (const id of ['note', 'comments']) { await p.click('#tourCard [data-tour=next]'); check(await waitStep(id), 'Next → ' + id); a = await aimed(); check(a.ring && a.on && a.inView, '  …pointing at it, the card in view'); }
  await shot('9-comments');
  await p.click('#tourCard [data-tour=next]'); await waitStep('close');
  await p.click('#drawer [data-act=closeDrawer] >> nth=0');
  check(await waitStep('list'), 'closing the case → All open cases');
  await p.click('#nav-list');
  check(await waitStep('search'), 'All open cases → Search');
  await p.fill('#q', 'Practice');
  check(await waitStep('cols'), 'searching for the patient → Dates and progress');
  a = await aimed(); check(a.ring && a.on && !a.overlap, 'the ring is on the list’s headings');
  await shot('10-cols');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('lock'), 'Next → Lock when you step away');
  a = await aimed(); check(a.ring && a.on, 'the ring is on the Lock button');
  c = await card(); check(/Try it: tap Lock, then Sign in/.test(c.act) && !c.ok, 'it asks to try it: “tap Lock, then Sign in”');
  // Lock pauses the tour; signing back in (filled in, in practice) picks it up at the same step — which Lock just did
  await p.click('#side [data-act=lock]');
  await p.waitForSelector('#lockWrap:not(.hidden) #lgBtn');
  check(!(await p.$('#tourCard')) && !(await p.$('#tourRing')) && /tap Sign in and the tour carries on/.test(await p.textContent('#lockWrap .lockOk')) && (await p.textContent('#lgPracPw')).length > 0 && !(await p.$('#lockWrap input')),
    'Lock: the lock screen says “…tap Sign in and the tour carries on”, the password shown filled in (look-alike boxes, nothing for the browser to save); the tour waits');
  await shot('10b-locked');
  await p.click('#lgBtn');
  check(await waitStep('end'), 'Sign in → the tour picks up: Lock is done → You’re all set');
  check(await p.evaluate(() => !!TOUR.id && !!S.cases.get(TOUR.id) && S.cases.get(TOUR.id).patient === 'Practice Patient'), '…with the practice patient still there');
  c = await card(); check(c.n === total + ' of ' + total && !(await p.$('#tourCard [data-tour=end]')), 'the last step (' + c.n + '), no End button');
  await shot('11-end');
  await p.click('#tourCard [data-tour=next]'); await p.waitForTimeout(200);
  check(!(await p.$('#tourCard')) && !(await p.$('#tourRing')) && /Tour done/.test(await p.textContent('#toasts')), 'Finish: the card and ring go, “Tour done — close this tab …”');
  // My account in practice mode: start over
  await p.click('#nav-account'); await p.waitForSelector('[data-act=tourOpen]');
  check(/Start over/.test(await p.textContent('[data-act=tourOpen]')), 'My account (practice): “Start over”');
  await p.click('[data-act=tourOpen]');
  check(await waitStep('hi'), 'Start over begins again at Welcome');
  // Skip and End
  await p.click('#tourCard [data-tour=next]'); await waitStep('today'); await p.click('#tourCard [data-tour=next]'); await waitStep('new');
  await p.click('#tourCard [data-tour=next]');
  check(await waitStep('board', 3000), 'Skip on “Tap New case” jumps past the form’s steps to the Board');
  check(await p.evaluate(() => !!TOUR.id && S.cases.get(TOUR.id).type === 'oliv'), '…and borrows a made-up Oliv case for the next steps');
  await p.click('#tourCard [data-tour=end]'); await p.waitForTimeout(150);
  check(!(await p.$('#tourCard')) && /Tour ended/.test(await p.textContent('#toasts')), 'End tour: gone, “Tour ended — restart it from My account”');
  // practice mode doesn't lock by itself (nothing real to hide; a trainee called away comes back to the same step)
  await p.evaluate(() => { S.lastAct = Date.now() - 3600e3; }); await p.waitForTimeout(16000);
  check(await p.evaluate(() => S.inApp), 'an hour “without activity”: practice mode stays open');
  // Lock while the tour isn't running: signing back in doesn't start it by itself
  await p.click('#side [data-act=lock]'); await p.waitForSelector('#lockWrap:not(.hidden) #lgBtn');
  check(/^Locked\. Sign in to continue\.$/.test((await p.textContent('#lockWrap .lockOk')).trim()), 'Lock with no tour running: the ordinary lock message');
  await p.click('#lgBtn'); await p.waitForSelector('#app:not(.hidden) .topBar'); await p.waitForTimeout(900);
  check(!(await p.$('#tourCard')), '…and signing back in leaves the tour off');
  // practice kept its settings to itself: the real app's username and hidden columns are untouched
  // (reading a key as a property bypasses practice mode's getItem, so these are the raw stored values)
  const raw = await p.evaluate(() => { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage[k]; } return out; });
  check(raw['nloCases.lastLogin'] === 'gwen.real' && raw['nloCases.hiddenCols'] === '["updated"]' && raw['nloDemo.nloCases.lastLogin'] === 'practice', 'practice didn’t touch the real app’s settings (username, hidden columns): its own are kept as nloDemo.*');
  await p.close();

  // ---------------- Dr. A's practice: Team & security too ----------------
  const o = await ctx.newPage(); watch(o, errs, 'owner');
  await o.goto(BASE + '?demo&tour=owner');
  await o.waitForFunction(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 10000 });
  const ow = await o.evaluate(() => ({ name: B.me.name, owner: isOwner(), ids: TOUR.steps.map(s => s.id) }));
  check(ow.name === 'Dr. Akhavan' && ow.owner && ['admin', 'team', 'cost', 'mail'].every(k => ow.ids.includes(k)) && ow.ids.length === total + 4, 'owner practice: Dr. Akhavan, with Team & security, Team, aligner cost and Email updates (' + ow.ids.length + ' steps)');
  await o.evaluate(() => tourGo(TOUR.steps.findIndex(s => s.id === 'admin')));
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'admin');
  await o.click('#nav-admin');
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'team' && !TOUR.okAt, null, { timeout: 8000 });
  for (const id of ['team', 'cost', 'mail']) {
    await o.waitForFunction(id => TOUR.steps[TOUR.i].id === id && !TOUR.okAt, id, { timeout: 8000 });
    // (the admin page scrolls smoothly down to it first)
    const r = await o.waitForFunction(() => { const st = TOUR.steps[TOUR.i], el = st.at && st.at(), ring = document.getElementById('tourRing'); if (!el || ring.hidden) return false;
      const a = el.getBoundingClientRect(), b = ring.getBoundingClientRect(); return Math.abs(b.top - (a.top - 6)) < 2 && Math.abs(b.left - (a.left - 6)) < 2; }, null, { timeout: 4000 }).then(() => true, () => false);
    check(r, 'owner: ' + id + ' card pointed at');
    if (id === 'cost') await o.screenshot({ path: OUT + '/v39-12-owner-cost.png' });
    await o.click('#tourCard [data-tour=next]');
  }
  check(await o.evaluate(() => TOUR.steps[TOUR.i].id) === 'end', 'owner: then You’re all set');
  // the plain demo (no tour): nothing starts; My account offers the tour in a new tab
  await o.goto(BASE + '?demo'); await o.click('#lgBtn'); await o.waitForSelector('.tiles'); await o.waitForTimeout(800);
  check(!(await o.$('#tourCard')) && !(await o.$('#tourOffer')) && (await o.textContent('#syncLine')) === 'Demo · nothing saved', 'the plain demo: no tour by itself, no offer card, still “Demo · nothing saved”');
  await o.click('#nav-account'); await o.waitForSelector('[data-act=tourOpen]');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), o.click('[data-act=tourOpen]')]);
  check(/nlo-cases\.html\?demo&tour=owner$/.test(pop.url()), 'My account → Take the tour opens the practice tab (' + pop.url().replace(/^.*\//, '') + ')');
  await pop.close(); await o.close();

  // ---------------- phones: the card is a sheet at the bottom, nothing sideways ----------------
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await routes(ph);
  const m = await ph.newPage(); watch(m, errs, 'phone');
  await m.goto(BASE + '?demo&tour=staff');
  await m.waitForFunction(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 10000 });
  await m.click('#tourCard [data-tour=next]'); await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'today'); await m.click('#tourCard [data-tour=next]');
  await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'new' && !TOUR.okAt); await m.waitForTimeout(300);
  const mc = await m.evaluate(() => { const c = document.getElementById('tourCard').getBoundingClientRect(), ring = document.getElementById('tourRing'), st = TOUR.steps[TOUR.i], el = st.at && st.at();
    const r = el && el.getBoundingClientRect(); return { sheet: document.getElementById('tourCard').classList.contains('sheet'), inView: c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight && c.top >= 0,
      ring: !ring.hidden, target: !!r && r.width > 0 && r.right <= innerWidth, wide: document.documentElement.scrollWidth <= 390 }; });
  check(mc.sheet && mc.inView && mc.ring && mc.target && mc.wide, 'phone: the card is a sheet at the bottom, in view; the ring is on a New case button on screen; no sideways scrolling');
  await m.screenshot({ path: OUT + '/v39-13-phone.png' });
  await m.evaluate(() => TOUR.steps[TOUR.i].at().click()); // tap what the tour points at
  check(await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'type' && !TOUR.okAt, null, { timeout: 8000 }).then(() => true, () => false), 'phone: tapping New case moves the tour on');
  await ph.close();

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
