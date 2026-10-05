// Hide / show list columns (remembered on the computer); outside labs show the delivery date from Manufacturing on — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const heads = () => p.$$eval('#listBody thead th', ths => ths.map(t => t.textContent.replace(/[↑↓]/g, '').trim()));
  const cells = () => p.$$eval('#listBody tbody tr:first-child > td', tds => tds.length);

  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  console.log('   columns:', (await heads()).join(' | '));
  // hide Type from its heading
  await p.hover('#listBody th:has([data-k=type])'); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/v17-head-hover.png', clip: { x: 232, y: 120, width: 1128, height: 90 } });
  await p.click('#listBody th [data-act=hideCol][data-k=type]'); await p.waitForTimeout(150);
  let h = await heads();
  check(!h.includes('Type') && (await cells()) === h.length && /hidden/.test(await p.textContent('.toast')), 'the eye on “Type” hides the column (heading and cells), with a note and Undo');
  check((await p.textContent('.colBtn')).includes('1 hidden'), 'the Columns button says 1 hidden');
  // hide two more from the Columns menu
  await p.click('.colBtn'); await p.waitForSelector('.colMenu');
  await p.uncheck('.colMenu input[data-col=updated]'); await p.uncheck('.colMenu input[data-col=ship]'); await p.waitForTimeout(150);
  check(await p.isVisible('.colMenu'), 'the menu stays open while ticking');
  await p.screenshot({ path: OUT + '/v17-menu.png', clip: { x: 232, y: 60, width: 1128, height: 420 } });
  h = await heads();
  check(!h.includes('Updated') && !h.includes('Shipping') && h.includes('Stage') && (await cells()) === h.length, 'Updated and Shipping hidden from the menu (' + h.join(' | ') + ')');
  await p.click('h2'); await p.waitForTimeout(100);
  check(!(await p.isVisible('.colMenu')), 'clicking elsewhere closes the menu');
  // remembered on this computer: reload, sign in again
  await p.reload(); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  h = await heads();
  check(!h.includes('Type') && !h.includes('Updated') && !h.includes('Shipping'), 'remembered on this computer after a reload');
  // My cases uses the same choice; Completed respects Type
  await p.click('#nav-mine'); await p.waitForSelector('#listBody tr.click, #listBody .empty');
  check(!(await heads()).includes('Type'), 'My cases: same columns');
  await p.click('#nav-done'); await p.waitForSelector('tr.click'); await p.waitForTimeout(150);
  check(!(await p.$$eval('thead th', t => t.map(x => x.textContent.trim()))).includes('Type') && (await p.locator('tr.click .tlogo').count()) === 0, 'Completed: Type hidden too (it has its own Columns button)');
  // Show all
  await p.click('#nav-list'); await p.click('.colBtn'); await p.click('.colMenu [data-act=showCols]'); await p.waitForTimeout(150);
  check((await heads()).length === 10, 'Show all brings every column back'); // Lab date + Delivery appt + Tx progress since 4 Oct 2026, Notes since 5 Oct (Tx cost is optional)
  // Undo on the toast
  await p.click('#listBody th [data-act=hideCol][data-k=who]'); await p.waitForTimeout(100);
  await p.click('.toast [data-act], .toast button'); await p.waitForTimeout(150);
  check((await heads()).includes('Assigned'), 'Undo brings a just-hidden column back');
  // hiding Stage keeps the date visible on phones (under the name)
  await p.click('#listBody th [data-act=hideCol][data-k=stage]'); await p.waitForTimeout(100);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250);
  check(await p.locator('#listBody tr.click:first-child .ptTxt .onlyM .due').first().isVisible() && await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone with Stage hidden: the date shows under the name, no sideways scrolling');
  await p.setViewportSize({ width: 1360, height: 900 }); await p.click('.colBtn'); await p.click('.colMenu [data-act=showCols]'); await p.waitForTimeout(100);

  // outside labs: lab date before Manufacturing, delivery date from Manufacturing on
  const r = await p.evaluate(() => {
    const out = [];
    for (const [type, stages] of [['oliv', ['submit', 'dra', 'mfg', 'shipped', 'arrived']], ['appliance', ['submit', 'hold', 'submitted', 'mfg', 'shipped']], ['nla', ['txp', 'fab', 'pack', 'checkedin']], ['marpe', ['submitted', 'zoom', 'approved']]]) {
      for (const st of stages) { const c = { type, stage: st, labDate: '2026-10-05', deliveryDate: '2026-10-12', zoomDate: type === 'marpe' ? '2026-10-07' : '' }; out.push(type + ':' + st + '→' + (dueOf(c) || {}).k); }
    }
    return out;
  });
  console.log('   ' + r.join('  '));
  check(r.includes('oliv:dra→lab') && r.includes('oliv:mfg→delivery') && r.includes('oliv:shipped→delivery'), 'outside aligners: lab date until Dr. A approves; from Manufacturing on, the delivery date');
  check(r.includes('appliance:submitted→lab') && r.includes('appliance:mfg→delivery'), 'appliances: from Manufacturing on, the delivery date');
  check(r.includes('nla:fab→lab') && r.includes('nla:pack→delivery') && r.includes('marpe:zoom→zoom') && r.includes('marpe:approved→delivery'), 'in-house and MARPE unchanged');
  // on the board: an Oliv case in Manufacturing shows Delivery, not Lab
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=outside]'); await p.waitForSelector('section[aria-label="Manufacturing"] .kc');
  const mf = await p.$$eval('section[aria-label="Manufacturing"] .kc .ft .due', ds => ds.map(d => d.textContent.trim()));
  console.log('   Manufacturing column chips:', mf.join(' / '));
  check(mf.length && mf.every(t => !/^Lab /.test(t)), 'board: no lab dates in the Manufacturing column');
  await p.screenshot({ path: OUT + '/v17-board.png', clip: { x: 232, y: 60, width: 1128, height: 560 } });
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
