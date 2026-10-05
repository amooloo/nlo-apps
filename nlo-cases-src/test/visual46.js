// Reassign from the list or the board (Amir, 5 Oct 2026: "when you are looking the open cases or tile view, can you just click on the
// assigned person and then pick another person from a drop down instead of click on it opening the card, editing going to the
// section and changing it"). Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const menu = () => p.evaluate(() => { const m = document.querySelector('#asgMenu'); if (!m) return null; const r = m.getBoundingClientRect();
    return { role: m.getAttribute('role'), items: Array.from(m.querySelectorAll('button')).map(b => b.querySelector('.nm').textContent.trim() + (b.getAttribute('aria-checked') === 'true' ? '*' : '')),
      focus: document.activeElement && m.contains(document.activeElement) ? document.activeElement.querySelector('.nm').textContent.trim() : null, fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, photos: m.querySelectorAll('.av').length }; });
  const asg = id => p.evaluate(id => (openCases().find(c => c.id === id) || {}).assignee || '', id);
  const btnSel = id => '[data-act=asgPick][data-id="' + id + '"]';

  console.log('\n# All open cases: the Assigned person opens the team');
  await p.click('#nav-list'); await p.waitForSelector('.tbl tbody tr');
  const c1 = await p.evaluate(() => openCases().find(c => c.assignee === 'sarah' && c.type === 'oliv').id);
  check(await p.getAttribute('tr.click[data-id="' + c1 + '"] td.asgCol button', 'aria-haspopup') === 'menu', 'the Assigned cell is a button (aria-haspopup=menu)');
  await p.click(btnSel(c1));
  let m = await menu();
  check(m && m.role === 'menu' && m.items[0] === 'Nobody (unassigned)' && m.items.includes('Sarah (demo)*') && m.items.length >= 5 && m.photos === m.items.length, 'a list opens: Nobody, then the team, each with their picture; Sarah ticked (' + (m && m.items.join(' | ')) + ')');
  check(m.focus === 'Sarah (demo)' && m.fits, 'the ticked person has the focus; the list is on screen');
  check(!(await p.$('#drawer')) && await p.getAttribute(btnSel(c1), 'aria-expanded') === 'true', 'the case did not open');
  await p.screenshot({ path: OUT + '/v46-list-menu.png' });
  await p.click('#asgMenu button:has-text("Gwen (demo)")');
  await p.waitForFunction(id => (openCases().find(c => c.id === id) || {}).assignee === 'gwen', c1, { timeout: 4000 }).catch(() => {});
  check(await asg(c1) === 'gwen' && !(await p.$('#asgMenu')) && !(await p.$('#drawer')), 'picking Gwen saves it; the list closes; no case opened');
  await p.waitForSelector('.toast:has-text("assigned to Gwen (demo)")', { timeout: 4000 }).catch(() => {});
  check(await p.isVisible('.toast:has-text("assigned to Gwen (demo)")'), 'the message names the patient and Gwen');
  await p.waitForFunction(id => /Gwen/.test((document.querySelector('tr.click[data-id="' + id + '"] td.asgCol') || {}).textContent || ''), c1, { timeout: 4000 }).catch(() => {});
  check(/Gwen \(demo\)/.test(await p.textContent('tr.click[data-id="' + c1 + '"] td.asgCol')), 'the row shows Gwen');
  const hist = await p.evaluate(id => DEMO.logs.filter(l => l.caseId === id && l.a === 'assign').map(l => l.to), c1);
  check(hist.includes('gwen'), 'saved like the case’s own Assigned to (its history says who it was reassigned to)');

  console.log('\n# Keys, Escape, clicking elsewhere');
  await p.focus(btnSel(c1)); await p.keyboard.press('Enter'); await p.waitForSelector('#asgMenu');
  check((await menu()).focus === 'Gwen (demo)', 'Enter opens it, on the ticked person');
  await p.keyboard.press('Escape'); await p.waitForTimeout(60);
  check(!(await p.$('#asgMenu')) && await p.evaluate(sel => document.activeElement === document.querySelector(sel), btnSel(c1)), 'Escape closes it and goes back to the button');
  await p.keyboard.press('Enter'); await p.waitForSelector('#asgMenu');
  await p.keyboard.press('Home'); await p.keyboard.press('ArrowDown'); // Nobody → first person
  const want = (await menu()).focus;
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  check(want && (await p.evaluate(id => staffName((openCases().find(c => c.id === id) || {}).assignee), c1)) === want, 'arrows move through the team and Enter picks (' + want + ')');
  await p.click(btnSel(c1)); await p.waitForSelector('#asgMenu');
  await p.click('h2'); await p.waitForTimeout(60);
  check(!(await p.$('#asgMenu')), 'a click elsewhere closes it');
  await p.click(btnSel(c1)); await p.waitForSelector('#asgMenu');
  await p.click('#asgMenu button:has-text("Nobody")'); await p.waitForTimeout(400);
  check(await asg(c1) === '' && /Unassigned/.test(await p.textContent('tr.click[data-id="' + c1 + '"] td.asgCol')), 'Nobody: unassigned, and the row says so');
  await p.click('tr.click[data-id="' + c1 + '"] td.stg'); await p.waitForSelector('#drawer .dsList');
  check(true, 'clicking the row anywhere else still opens the case');
  await p.evaluate(() => closeDrawer());

  console.log('\n# The board');
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=inhouse]'); await p.waitForSelector('.kc');
  const c2 = await p.evaluate(() => { const k = document.querySelector('.kc [data-act=asgPick]'); return k.dataset.id; });
  const before = await asg(c2);
  await p.click('.kc ' + btnSel(c2));
  m = await menu();
  check(m && m.fits && !(await p.$('#drawer')), 'the person on a card opens the same list (the card doesn’t open)');
  await p.screenshot({ path: OUT + '/v46-board-menu.png' });
  const pick = before === 'kaylee' ? 'Angelika (demo)' : 'Kaylee (demo)';
  await p.click('#asgMenu button:has-text("' + pick + '")'); await p.waitForTimeout(400);
  check(await p.evaluate(id => staffName((openCases().find(c => c.id === id) || {}).assignee), c2) === pick && !(await p.$('#drawer')), 'picking someone reassigns the card (' + pick + ')');
  await p.waitForFunction(([id, n]) => (document.querySelector('[data-act=asgPick][data-id="' + id + '"]') || {}).title === 'Assigned to ' + n + ' (change)', [c2, pick], { timeout: 4000 }).catch(() => {});
  check(await p.getAttribute(btnSel(c2), 'title') === 'Assigned to ' + pick + ' (change)', 'the card shows the new person');
  await p.click(btnSel(c2)); await p.waitForSelector('#asgMenu');
  const y0 = await p.evaluate(() => document.querySelector('#asgMenu').getBoundingClientRect().top);
  await p.mouse.move(700, 600); await p.mouse.wheel(0, 40); await p.waitForTimeout(200);
  const y1 = await p.evaluate(() => { const m = document.querySelector('#asgMenu'); return m ? m.getBoundingClientRect().top : null; });
  const sc = await p.evaluate(() => window.scrollY);
  check(sc === 0 || (y1 !== null && Math.abs((y0 - y1) - sc) <= 2), 'a little scroll: the list moves with its button (' + y0 + ' → ' + y1 + ', page scrolled ' + sc + ')');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(200);
  const gone = await p.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.bottom < 0 || b.top > innerHeight; }, btnSel(c2));
  check(!gone || !(await p.$('#asgMenu')), 'scrolled away from its button: the list closes');
  await p.evaluate(() => { if (S.asg) asgClose(); window.scrollTo(0, 0); });

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
  await p.evaluate(() => window.scrollTo(0, 0));
  const c3 = await p.evaluate(() => document.querySelector('.kc [data-act=asgPick]').dataset.id);
  await p.click(btnSel(c3)); await p.waitForSelector('#asgMenu');
  m = await menu();
  const tap = await p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return Math.round(r.height); }, btnSel(c3));
  check(m.fits && tap >= 34 && !(await p.$('#drawer')), 'phone: the list fits the screen; the button is a comfortable tap (' + tap + 'px)');
  await p.screenshot({ path: OUT + '/v46-phone.png' });
  await p.keyboard.press('Escape');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
