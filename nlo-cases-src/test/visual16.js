// Company logos in place of the type name on the board and in the case lists — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  // the list: sorted by type so every company shows
  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  await p.click('#listBody th button[data-k=type]'); await p.waitForTimeout(200);
  const rows = await p.$$eval('#listBody tr.click', rs => rs.map(r => { const c = findCase(r.dataset.id), td = r.querySelector('td.hideM'), im = td.querySelector('img');
    return { type: c.type, img: im ? { ok: im.complete && im.naturalWidth > 0, alt: im.alt, w: Math.round(im.getBoundingClientRect().width), h: Math.round(im.getBoundingClientRect().height) } : null, nl: !!td.querySelector('.tlogo.nl svg'), pill: !!td.querySelector('.badge') }; }));
  const by = {}; rows.forEach(r => { by[r.type] = by[r.type] || r; });
  console.log('   ' + Object.values(by).map(r => r.type + ': ' + (r.img ? 'logo ' + r.img.w + '×' + r.img.h + (r.img.ok ? '' : ' NOT LOADED') : r.nl ? 'NL mark' : r.pill ? 'name pill' : '?')).join(' | '));
  check(['oliv', 'angel', 'invisalign', 'ulab', 'insmile'].filter(k => by[k]).every(k => by[k].img && by[k].img.ok && !by[k].pill), 'list: Oliv, Angel, Invisalign, uLab and InSmile show their logos (loaded, no pill)');
  check(by.nla && by.nla.img && by.nla.img.ok && /In-house/.test(by.nla.img.alt) && !by.nla.pill, 'list: in-house sets show the Next Level Orthodontics logo');
  check(['retainer', 'models', 'mouthguard'].filter(k => by[k]).every(k => by[k].pill), 'list: types with no company keep their name');
  check(by.marpe && by.marpe.img && by.marpe.img.ok && /Partner Dental Studios/.test(by.marpe.img.alt), 'list: MARPE cases show their lab’s logo (Partners)');
  check(rows.every(r => !r.img || r.img.alt), 'every logo has its company name for screen readers (alt)');
  await p.screenshot({ path: OUT + '/v16-list.png', clip: { x: 232, y: 0, width: 1128, height: 1000 } });
  // the board: outside aligners tab, in-house tab
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=outside]'); await p.waitForSelector('.kc');
  await p.waitForTimeout(200);
  const kc = await p.$$eval('.kc .ft', fs => fs.map(f => { const im = f.querySelector('.tlogo img'); return im ? (im.complete && im.naturalWidth > 0) : !!f.querySelector('.badge'); }));
  check(kc.length > 0 && kc.every(Boolean) && !(await p.locator('.kc .ft .badge').count()), 'board (outside aligners): each card shows the company logo, no pills (' + kc.length + ' cards)');
  await p.screenshot({ path: OUT + '/v16-board-outside.png', clip: { x: 232, y: 60, width: 1128, height: 600 } });
  await p.click('.boardTabs [data-k=inhouse]'); await p.waitForSelector('.kc'); await p.waitForTimeout(150);
  check((await p.locator('.kc .ft .tlogo.lg-nlo img').count()) > 0 && await p.evaluate(() => Array.from(document.querySelectorAll('.kc .ft .tlogo.lg-nlo img')).every(i => i.complete && i.naturalWidth > 0)), 'board (in-house): the Next Level Orthodontics logo on the cards');
  await p.screenshot({ path: OUT + '/v16-board-inhouse.png', clip: { x: 232, y: 60, width: 1128, height: 520 } });
  await p.click('.boardTabs [data-k=retainer]'); await p.waitForSelector('.kc'); await p.waitForTimeout(150);
  check((await p.locator('.kc .ft .badge').count()) > 0, 'board (retainers & mouthguards): names stay (no company)');
  // Completed and My cases
  await p.click('#nav-done'); await p.waitForSelector('tr.click'); await p.waitForTimeout(200);
  check((await p.locator('tr.click .tlogo img').count()) > 0 || (await p.locator('tr.click .tlogo.nl').count()) > 0 || (await p.locator('tr.click .badge').count()) > 0, 'Completed uses the same marks');
  // phone: the type column is hidden there anyway
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('#mnav-list'); await p.waitForSelector('#listBody tr.click');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
