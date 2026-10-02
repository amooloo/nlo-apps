// Screenshots of MARPE steps, Ship to patient and tracking (demo data, made-up patients)
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await p.screenshot({ path: OUT + '/v9-today.png' });
  // New case: MARPE tile
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=marpe]'); await p.fill('#cf-patient', 'Test Marpe');
  await p.click('.pickRow[data-g=records] .pick[data-v=stl]');
  await p.screenshot({ path: OUT + '/v9-new-marpe.png', fullPage: false });
  const sec = await p.$('#ncForm .cfSec:has(.pickRow[data-g=records])'); await sec.scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/v9-new-marpe-records.png' });
  console.log('marpe stage', await p.inputValue('#cf-stage'), 'lab', (await p.locator('.pickRow[data-g=lab] .pick[aria-pressed=true]').allTextContents()).join('|'), 'detail', await p.inputValue('#cf-detail'), 'assignee', await p.inputValue('#cf-assignee'));
  // New case: Oliv with Ship to patient
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.click('#cf-ship');
  const ds = await p.$('#cf-ship'); await ds.scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/v9-new-ship.png' });
  await p.click('.modal [data-act=closeModal]');
  // Board: MARPE tab
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=marpe]'); await p.waitForSelector('.board');
  await p.screenshot({ path: OUT + '/v9-board-marpe.png' });
  await p.click('[data-act=flow][data-k=outside]'); await p.screenshot({ path: OUT + '/v9-board-outside.png' });
  // List
  await p.click('#nav-list'); await p.waitForSelector('table.tbl');
  await p.screenshot({ path: OUT + '/v9-list.png', fullPage: true });
  await p.click('[data-act=shipF]'); await p.screenshot({ path: OUT + '/v9-list-ship.png' });
  await p.click('[data-act=shipF]');
  // Drawer: the MARPE case still gathering records, then the check before Submitted to lab
  await p.fill('#q', 'MARPE'); await p.waitForTimeout(150);
  const rows = await p.locator('tr.click').count(); console.log('marpe rows', rows);
  await p.click('tr.click:has(.flag.rec)'); await p.waitForSelector('#mpBox');
  await p.screenshot({ path: OUT + '/v9-drawer-marpe.png' });
  await p.click('#drawer .step[data-k=submitted]'); await p.waitForSelector('#gGo');
  await p.screenshot({ path: OUT + '/v9-gate.png' });
  console.log('gate disabled before ticking', await p.isDisabled('#gGo'));
  await p.click('.modal [data-act=closeModal]');
  await p.click('#drawer .step[data-k=zoom]'); await p.waitForSelector('#gGo');
  await p.screenshot({ path: OUT + '/v9-gate-zoom.png' });
  await p.click('.modal [data-act=closeModal]'); await p.click('[data-act=closeDrawer] >> nth=0');
  // Drawer: ship to patient + tracking
  await p.fill('#q', ''); await p.click('[data-act=shipF]'); await p.click('tr.click:has(a.flag.trk)'); await p.waitForSelector('#drawer .notice.ship');
  await p.screenshot({ path: OUT + '/v9-drawer-ship.png' });
  await p.click('[data-act=closeDrawer] >> nth=0');
  // phone list
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await routes(m); const mp = await m.newPage(); watch(mp, errs, 'mobile');
  await mp.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await mp.click('#lgBtn'); await mp.waitForSelector('.tiles');
  await mp.click('#mnav-list'); await mp.waitForSelector('table.tbl'); await mp.screenshot({ path: OUT + '/v9-m-list.png', fullPage: true });
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
