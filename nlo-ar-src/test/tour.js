/* The new-user tour, hands-on in practice mode (Amir, 5 Oct 2026: "can you build in a tutorial like the one for case
   tracker?") — ?demo&tour=staff walked through like the financial coordinator, ?demo&tour=owner (signing a letter, Settings),
   wandering off, Back, Skip, End, Lock and picking up again, no idle lock, storage kept apart from the real app, the plain
   demo unchanged, phones. Needs a static server on :8766 serving dist/. Run: node test/tour.js  (screenshots go to shots/) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { routes, watch, CHROME } = require('./helpers');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8766) + '/nlo-ar.html';
const SHOTS = path.join(__dirname, '..', 'shots');
let pass = 0, fail = 0;
const check = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await routes(ctx);
  // the real app's own settings on this computer (same web address), set before any page script runs: practice must leave them alone
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('seededReal')) { localStorage.setItem('seededReal', '1'); localStorage.setItem('nloAR.lastLogin', 'sarah.real'); localStorage.setItem('nloAR.tourOffer.sarah', '123'); } } catch (e) { } });
  const p = await ctx.newPage(); watch(p, errs, 'practice');
  const step = () => p.evaluate(() => (TOUR.on ? TOUR.steps[TOUR.i].id : 'off'));
  const waitStep = (id, ms) => p.waitForFunction(id => TOUR.on && TOUR.steps[TOUR.i].id === id && !TOUR.okAt, id, { timeout: ms || 10000 }).then(() => true, () => false);
  const card = () => p.evaluate(() => { const c = document.getElementById('tourCard'); if (!c) return null; const r = c.getBoundingClientRect();
    return { h: (c.querySelector('h4') || {}).textContent, p: (c.querySelector('p') || {}).textContent, n: (c.querySelector('.tcN') || {}).textContent, act: (c.querySelector('.tcDo') || {}).textContent || '', ok: c.classList.contains('ok'), sheet: c.classList.contains('sheet') }; });
  // the ring sits on what the step points at, and the card doesn't cover it
  const aimedNow = () => p.evaluate(() => { const st = TOUR.steps[TOUR.i], el = st.at && st.at(), ring = document.getElementById('tourRing'), c = document.getElementById('tourCard');
    if (!el || !ring || ring.hidden) return { ring: false };
    const a = el.getBoundingClientRect(), b = ring.getBoundingClientRect(), k = c.getBoundingClientRect();
    const on = Math.abs(b.left - (a.left - 6)) < 3 && Math.abs(b.top - (a.top - 6)) < 3 && Math.abs(b.width - (a.width + 12)) < 3;
    const overlap = !(k.right <= a.left || k.left >= a.right || k.bottom <= a.top || k.top >= a.bottom);
    const inView = k.left >= 0 && k.top >= 0 && k.right <= innerWidth && k.bottom <= innerHeight;
    return { ring: true, on, overlap, inView }; });
  const aimed = async () => { let a; for (let k = 0; k < 15; k++) { a = await aimedNow(); if (a.ring && a.on) { await p.waitForTimeout(150); return aimedNow(); } await p.waitForTimeout(150); } return a; };
  const next = () => p.click('#tourCard [data-tour=next]');
  const shot = n => p.screenshot({ path: path.join(SHOTS, 'tour-' + n + '.png') });

  // ---------------- staff practice: opens signed in as a staff member, the tour starts by itself ----------------
  await p.goto(BASE + '?demo&tour=staff');
  check(await waitStep('hi'), 'practice mode opens signed in and the tour starts by itself');
  const who = await p.evaluate(() => ({ name: B.me.name, owner: isOwner(), settings: !!document.getElementById('nav-settings'), bar: document.getElementById('demoBar').textContent, sync: document.getElementById('syncLine').textContent }));
  check(who.name === 'Practice User' && !who.owner && !who.settings && /^Practice — made-up accounts/.test(who.bar) && who.sync === 'Practice · nothing saved', 'signed in as a staff member (“Practice User”, no Settings); the bar and the status line say Practice');
  let c = await card(); const total = Number((c.n || '').split(' of ')[1]);
  check(c.h === 'Welcome to NLO A/R' && /^1 of \d+$/.test(c.n), 'step 1: Welcome (' + c.n + ')');
  await shot('1-welcome');
  await next();
  check(await waitStep('today'), 'Start → Today');
  let a = await aimed(); check(a.ring && a.on && !a.overlap && a.inView, 'the ring is on the Today tiles and the card sits beside them, in view');
  await next();
  check(await waitStep('ladrow'), 'Next → Collection steps due');
  const pr = await p.evaluate(() => ({ key: TOUR.key, name: TOUR.name, step: TOUR.step, worked: !!itemFor(TOUR.key) }));
  check(!!pr.key && pr.step === 'l1' && !pr.worked, 'a practice account is picked: ' + pr.name + ', at Letter #1, not worked yet');
  c = await card(); check(/Tap Letter #1/.test(c.act) && new RegExp(pr.name).test(c.p) && !c.ok, 'it names the account and waits for “Tap Letter #1.”');
  a = await aimed(); check(a.ring && a.on && a.inView, 'the ring is on the Letter #1 row of Today’s card');
  await shot('2-ladrow');
  await p.click('#view .ladRow[data-step=l1]');
  check(await waitStep('ladlist'), 'tapping it opens Past due → Steps due at Letter #1 → The ladder, step by step');
  check(await p.evaluate(() => S.view === 'pd' && S.tab.pd === 'lad' && S.ladStep === 'l1'), '…on Steps due, Letter #1 picked');
  await next();
  check(await waitStep('open'), 'Next → Open an account');
  a = await aimed(); check(a.ring && a.on && !a.overlap, 'the ring is on the practice account’s row');
  await shot('3-open');
  await p.evaluate(k => { const r = Array.from(document.querySelectorAll('#view tr[data-key]')).find(x => x.dataset.key === k); r.click(); }, pr.key);
  check(await waitStep('panel'), 'tapping the row opens the account → The account');
  a = await aimed(); check(a.ring && a.on && a.inView, 'the ring is on the account’s header');
  // wandering off: closing the account sends the tour back to “Open an account”
  await p.keyboard.press('Escape');
  check(await waitStep('open'), 'closing the account mid-way: back to “Open an account”');
  await p.evaluate(k => { const r = Array.from(document.querySelectorAll('#view tr[data-key]')).find(x => x.dataset.key === k); r.click(); }, pr.key);
  await waitStep('panel');
  // Back on a step that's done already waits for Next
  await p.click('#tourCard [data-tour=back]'); await p.waitForTimeout(900);
  c = await card(); check((await step()) === 'open' && c.ok && /Done already/.test(c.act), 'Back to a step already done: “Done already — tap Next”, no jumping ahead');
  await next(); await waitStep('panel');
  await next();
  check(await waitStep('ladnow'), 'Next → The step that’s due');
  a = await aimed(); check(a.ring && a.on && a.inView, 'the ring is on the step card in the account');
  await shot('4-ladnow');
  await next();
  check(await waitStep('sent'), 'Next → Record it');
  c = await card(); check(/Tap Sent/.test(c.act), 'it waits for “Tap Sent.”');
  await p.click('#drawer .ladNow [data-act=ladDone][data-s=l1]');
  check(await waitStep('ladall'), 'Sent → Every step');
  check(await p.evaluate(k => { const l = ladFor(S.byKey.get(k)); return !!l.done.l1 && !l.due; }, pr.key), 'Letter #1 is recorded on the practice account; nothing due until Letter #2');
  await next();
  check(await waitStep('logit'), 'Next → Log anything else');
  await p.click('#drawer [data-act=log][data-k=pt_vm]');
  check(await waitStep('work'), 'a voicemail logged → Who has it, and when to look again');
  a = await aimed(); check(a.ring && a.on && a.inView, 'the ring is on Status / Assigned to / Follow up');
  await shot('5-work');
  await next();
  check(await waitStep('close'), 'Next → Close it');
  await p.click('#drawer [data-act=closeDrawer]');
  check(await waitStep('batch'), 'closing it → Many at once');
  a = await aimed(); check(a.ring && a.on, 'the ring is on the bar that marks a step for many accounts');
  await next();
  check(await waitStep('p91'), 'Next → Biggest first');
  await p.click('#view [data-act=tab][data-t="91"]');
  check(await waitStep('ins'), 'tapping 91+ days → Insurance');
  await p.click('#nav-ins');
  check(await waitStep('cr'), 'Insurance → Credit balances');
  await p.click('#nav-cr');
  check(await waitStep('rep'), 'Credits → This week’s report');
  await p.click('#nav-reports');
  check(await waitStep('sum'), 'Reports → Summary');
  await p.click('#nav-sum');
  check(await waitStep('lock'), 'Summary → Lock when you step away');
  a = await aimed(); check(a.ring && a.on, 'the ring is on the Lock button');
  c = await card(); check(/Try it: tap Lock, then Sign in/.test(c.act) && !c.ok, 'it asks to try it: “tap Lock, then Sign in”');
  // Lock pauses the tour; signing back in (filled in, in practice) picks it up at the same step — which Lock just did
  await p.click('#side [data-act=lock]');
  await p.waitForSelector('#lockWrap:not(.hidden) #lgBtn');
  check(!(await p.$('#tourCard')) && !(await p.$('#tourRing')) && /tap Sign in and the tour carries on/.test(await p.textContent('#lockWrap .lockOk')) && (await p.textContent('#lgPracPw')).length > 0 && !(await p.$('#lockWrap input')),
    'Lock: the lock screen says “…tap Sign in and the tour carries on”, the password shown filled in (look-alike boxes, nothing for the browser to save); the tour waits');
  await shot('6-locked');
  await p.click('#lgBtn');
  check(await waitStep('end'), 'Sign in → the tour picks up: Lock is done → You’re all set');
  check(await p.evaluate(k => { const it = itemFor(k); return !!it && it.log.some(e => e.k === 'ladder' && e.step === 'l1') && it.log.some(e => e.k === 'pt_vm'); }, pr.key), '…with the practice account’s letter and voicemail still there');
  c = await card(); check(c.n === total + ' of ' + total && !(await p.$('#tourCard [data-tour=end]')), 'the last step (' + c.n + '), no End button');
  await shot('7-end');
  await next(); await p.waitForTimeout(200);
  check(!(await p.$('#tourCard')) && !(await p.$('#tourRing')) && /Tour done/.test(await p.textContent('#toasts')), 'Finish: the card and ring go, “Tour done — close this tab …”');
  // My account in practice mode: start over
  await p.click('#nav-account'); await p.waitForSelector('[data-act=tourOpen]');
  check(/Start over/.test(await p.textContent('[data-act=tourOpen]')), 'My account (practice): “Start over”');
  await p.click('[data-act=tourOpen]');
  check(await waitStep('hi'), 'Start over begins again at Welcome');
  // Skip and End
  await next(); await waitStep('today'); await next(); await waitStep('ladrow');
  const pr2 = await p.evaluate(() => ({ key: TOUR.key, step: TOUR.step }));
  check(!!pr2.key && pr2.key !== pr.key && pr2.step !== '', 'starting over picks a fresh practice account (' + pr2.step + ')');
  await p.click('#tourCard [data-tour=next]'); // Skip “Tap Letter #…”: past the steps that need the list and the account
  check(await waitStep('batch', 3000) && await p.evaluate(() => S.view === 'pd'), 'Skip on “Tap Letter #…” jumps past the account’s steps to “Many at once”, on Past due');
  await p.waitForTimeout(1200);
  check((await step()) === 'batch', '…and stays there (doesn’t bounce back)');
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
  // practice kept its settings to itself: the real app's username and tour offer are untouched
  // (reading a key as a property bypasses practice mode's getItem, so these are the raw stored values)
  const raw = await p.evaluate(() => { const out = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage[k]; } return out; });
  check(raw['nloAR.lastLogin'] === 'sarah.real' && raw['nloAR.tourOffer.sarah'] === '123' && raw['nloDemo.nloAR.lastLogin'] === 'practice' && !!raw['nloDemo.nloAR.tourDone'] && !raw['nloAR.tourDone'],
    'practice didn’t touch the real app’s settings (username, tour offer): its own are kept as nloDemo.*');
  await p.close();

  // ---------------- Dr. A's practice: sign a letter, Settings ----------------
  const o = await ctx.newPage(); watch(o, errs, 'owner');
  await o.goto(BASE + '?demo&tour=owner');
  await o.waitForFunction(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 10000 });
  const ow = await o.evaluate(() => ({ name: B.me.name, owner: isOwner(), ids: TOUR.steps.map(s => s.id) }));
  check(ow.name === 'Dr. Akhavan' && ow.owner && ['sign', 'signed', 'close2', 'settings', 'access', 'numbers'].every(k => ow.ids.includes(k)) && ow.ids.length === total + 6, 'owner practice: Dr. Akhavan, with a letter to sign and Settings (' + ow.ids.length + ' steps)');
  await o.evaluate(() => tourGo(TOUR.steps.findIndex(s => s.id === 'sign')));
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'sign' && !TOUR.okAt && S.view === 'today');
  const sk = await o.evaluate(() => ({ key: TOUR.signKey, name: TOUR.signName }));
  check(!!sk.key, 'a letter waiting for his signature is picked: ' + sk.name);
  const oa = await o.evaluate(() => { const st = TOUR.steps[TOUR.i], el = st.at && st.at(); return !!el && !!el.closest('.card') && /Waiting for your OK/.test(el.closest('.card').textContent); });
  check(oa, 'the ring is on its row under Waiting for your OK');
  await o.screenshot({ path: path.join(SHOTS, 'tour-8-owner-sign.png') });
  await o.evaluate(() => TOUR.steps[TOUR.i].at().click());
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'signed' && !TOUR.okAt, null, { timeout: 8000 });
  await o.click('#drawer .drABox [data-act=drAok]');
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'close2' && !TOUR.okAt, null, { timeout: 8000 });
  check(await o.evaluate(k => { const it = itemFor(k); return !it.drA && it.log.some(e => e.k === 'drA_ok' && e.step); }, sk.key), 'owner: Signed — the letter leaves his list, marked signed');
  await o.click('#drawer [data-act=closeDrawer]');
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'settings' && !TOUR.okAt, null, { timeout: 8000 });
  await o.click('#nav-settings');
  for (const id of ['access', 'numbers']) {
    await o.waitForFunction(id => TOUR.steps[TOUR.i].id === id && !TOUR.okAt, id, { timeout: 8000 });
    const r = await o.waitForFunction(() => { const st = TOUR.steps[TOUR.i], el = st.at && st.at(), ring = document.getElementById('tourRing'); if (!el || ring.hidden) return false;
      const a = el.getBoundingClientRect(), b = ring.getBoundingClientRect(); return Math.abs(b.top - (a.top - 6)) < 2 && Math.abs(b.left - (a.left - 6)) < 2; }, null, { timeout: 5000 }).then(() => true, () => false);
    check(r, 'owner: ' + id + ' card pointed at');
    if (id === 'access') await o.screenshot({ path: path.join(SHOTS, 'tour-9-owner-access.png') });
    await o.click('#tourCard [data-tour=next]');
  }
  check(await o.evaluate(() => TOUR.steps[TOUR.i].id) === 'end', 'owner: then You’re all set');
  // the plain demo (no tour): nothing starts, no offer; My account offers the tour in a new tab
  await o.goto(BASE + '?demo'); await o.click('#lgBtn'); await o.waitForSelector('.tiles'); await o.waitForTimeout(800);
  check(!(await o.$('#tourCard')) && !(await o.$('#tourOffer')) && (await o.textContent('#syncLine')) === 'Demo · nothing saved', 'the plain demo: no tour by itself, no offer card, still “Demo · nothing saved”');
  await o.click('#nav-account'); await o.waitForSelector('[data-act=tourOpen]');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), o.click('[data-act=tourOpen]')]);
  check(/nlo-ar\.html\?demo&tour=owner$/.test(pop.url()), 'My account → Take the tour opens the practice tab (' + pop.url().replace(/^.*\//, '') + ')');
  await pop.close(); await o.close();

  // ---------------- phones: the card is a sheet at the bottom, nothing sideways ----------------
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await routes(ph);
  const m = await ph.newPage(); watch(m, errs, 'phone');
  await m.goto(BASE + '?demo&tour=staff');
  await m.waitForFunction(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 10000 });
  await m.click('#tourCard [data-tour=next]'); await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'today'); await m.click('#tourCard [data-tour=next]');
  await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'ladrow' && !TOUR.okAt); await m.waitForTimeout(700);
  const mc = await m.evaluate(() => { const c = document.getElementById('tourCard').getBoundingClientRect(), ring = document.getElementById('tourRing'), st = TOUR.steps[TOUR.i], el = st.at && st.at();
    const r = el && el.getBoundingClientRect(); return { sheet: document.getElementById('tourCard').classList.contains('sheet'), inView: c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight && c.top >= 0,
      ring: !ring.hidden, target: !!r && r.width > 0 && r.right <= innerWidth, wide: document.documentElement.scrollWidth <= 390 }; });
  check(mc.sheet && mc.inView && mc.ring && mc.target && mc.wide, 'phone: the card is a sheet at the bottom, in view; the ring is on the step’s row; no sideways scrolling');
  await m.screenshot({ path: path.join(SHOTS, 'tour-10-phone.png') });
  await m.evaluate(() => TOUR.steps[TOUR.i].at().click()); // tap what the tour points at
  check(await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'ladlist' && !TOUR.okAt, null, { timeout: 8000 }).then(() => true, () => false), 'phone: tapping the step moves the tour on');
  await m.click('#tourCard [data-tour=next]'); await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'open' && !TOUR.okAt, null, { timeout: 8000 });
  await m.evaluate(() => TOUR.steps[TOUR.i].at().click());
  check(await m.waitForFunction(() => TOUR.steps[TOUR.i].id === 'panel' && !TOUR.okAt, null, { timeout: 8000 }).then(() => true, () => false), 'phone: opening the account moves it on');
  await m.waitForTimeout(400);
  const mp = await m.evaluate(() => { const ring = document.getElementById('tourRing'); return !ring.hidden && document.documentElement.scrollWidth <= 390; });
  check(mp, 'phone: the ring is on the account panel’s header, no sideways scrolling');
  await m.screenshot({ path: path.join(SHOTS, 'tour-11-phone-panel.png') });
  await ph.close();

  check(errs.length === 0, 'no page errors' + (errs.length ? ':\n    ' + errs.join('\n    ') : ''));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
