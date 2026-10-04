// Found 3 Oct 2026 while testing: a live update arriving between press and release redrew the screen, and the click did nothing
// (a board tab, a board arrow, a case's step). A press now holds live redraws until its click has gone through; and the search box
// keeps its cursor and selection through a redraw (a clear right after a live update used to do nothing) — demo
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  // someone else's change arriving (the live listener), to a case other than `skip`
  const otherChange = skip => p.evaluate(skip => { const c = Array.from(DEMO.cases.values()).find(x => x.status === 'open' && x.id !== skip); c.notes = 'live ' + Date.now(); c.rev++; DEMO.emit(c); return c.id; }, skip);
  const pressOn = async sel => { await p.waitForTimeout(120); const r = await p.locator(sel).boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); };
  const stage = id => p.evaluate(id => DEMO.cases.get(id).stage, id);

  // ---- a board tab: a live update lands mid-click
  await p.click('#nav-board'); await p.waitForSelector('.boardTabs');
  await pressOn('.boardTabs [data-k=inhouse]'); await otherChange(); await frames();
  const heldTab = await p.evaluate(() => document.querySelector('.boardTabs [data-k=outside]').getAttribute('aria-selected'));
  await p.mouse.up(); await p.waitForTimeout(250);
  check(heldTab === 'true' && await p.evaluate(() => S.boardFlow) === 'inhouse' && await p.getAttribute('.boardTabs [data-k=inhouse]', 'aria-selected') === 'true', 'board tab: a live update in the middle of the click no longer swallows it (the redraw waits for the release)');

  // ---- a board arrow: the card moves on, and the change that arrived mid-click shows right after
  await p.click('.boardTabs [data-k=outside]'); await p.waitForTimeout(150);
  const aid = await p.evaluate(() => (openCases().find(c => c.type === 'oliv' && c.stage === 'dra' && !c.shipToPatient) || {}).id);
  if (aid) {
    await pressOn('.kc[data-id="' + aid + '"] .adv'); const oid = await otherChange(aid); await frames(); await p.mouse.up(); await p.waitForTimeout(400);
    check(await stage(aid) === 'mfg', 'board arrow: the card moves on (Dr. A action → Manufacturing) though a live update came in mid-click');
    check(await p.evaluate(id => findCase(id).notes === DEMO.cases.get(id).notes, oid), '… and the update that came in is on screen right after');
  } else check(false, 'an Oliv case at Dr. A action in the demo');

  // ---- a case's step: an update to that same case lands mid-click (the case panel redraws on it)
  const sid = await p.evaluate(() => (openCases().find(c => c.type === 'oliv' && c.stage === 'mfg' && !c.shipToPatient) || {}).id);
  await p.evaluate(id => openDrawer(id), sid); await p.waitForSelector('#drawer .stepper');
  await pressOn('#drawer .step[data-k=shipped]');
  await p.evaluate(id => { const c = DEMO.cases.get(id); c.notes = 'same case, live'; c.rev++; DEMO.emit(c); }, sid); await frames();
  await p.mouse.up(); await p.waitForTimeout(400);
  check(await stage(sid) === 'shipped' && await p.evaluate(() => !!document.querySelector('#drawer .step.cur[data-k=shipped]')), 'case step: Shipped takes even with an update to the same case arriving mid-click');
  check(/same case, live/.test(await p.textContent('#drawer')), '… and the case shows that update too');
  await p.evaluate(() => closeDrawer(true));

  // ---- a long press (a drag, a scrollbar) doesn't hold anything; without a press, updates show at once
  await p.click('.boardTabs [data-k=outside]'); await p.waitForTimeout(150);
  const mv = await p.evaluate(() => (openCases().find(c => c.type === 'oliv' && c.stage === 'mfg' && !c.shipToPatient) || {}).id);
  await p.mouse.move(700, 8); await p.mouse.down(); await p.waitForTimeout(2200);
  await p.evaluate(id => { const c = DEMO.cases.get(id); c.stage = 'shipped'; c.rev++; DEMO.emit(c); }, mv); await frames(); await p.waitForTimeout(150);
  check(await p.isVisible('section[aria-label="Shipped"] .kc[data-id="' + mv + '"]'), 'a press held over 2 s doesn’t hold the board (the update shows while it’s still down)');
  await p.mouse.up();
  await p.evaluate(id => { const c = DEMO.cases.get(id); c.stage = 'arrived'; c.rev++; DEMO.emit(c); }, mv); await frames(); await p.waitForTimeout(100);
  check(await p.isVisible('section[aria-label="Arrived"] .kc[data-id="' + mv + '"]'), 'no press: an update shows at once');
  // ---- the search box keeps its cursor and selection through a live redraw (Playwright's fill('') is select-all + Delete)
  await p.click('#nav-list'); await p.fill('#q', 'Shelby'); await p.waitForTimeout(100);
  await p.evaluate(() => { const q = document.querySelector('#q'); q.focus(); q.select(); }); await otherChange(); await frames();
  await p.keyboard.press('Delete'); await p.waitForTimeout(100);
  check(await p.evaluate(() => S.q) === '' && await p.inputValue('#q') === '', 'search: select it all, a live update redraws, Delete still clears it');
  await p.fill('#q', 'Shelby'); await p.evaluate(() => { const q = document.querySelector('#q'); q.focus(); q.setSelectionRange(2, 2); }); await otherChange(); await frames();
  await p.keyboard.type('X'); await p.waitForTimeout(100);
  check(await p.inputValue('#q') === 'ShXelby', 'typing in the middle of the search: a live update doesn’t move the cursor to the end');
  await p.fill('#q', '');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
