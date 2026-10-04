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
    return { type: c.type, img: im ? { ok: im.complete && im.naturalWidth > 0, alt: im.alt, pic: im.dataset.pic || '', w: Math.round(im.getBoundingClientRect().width), h: Math.round(im.getBoundingClientRect().height) } : null, nl: !!td.querySelector('.tlogo.nl svg'), pill: !!td.querySelector('.badge') }; }));
  const by = {}; rows.forEach(r => { by[r.type] = by[r.type] || r; });
  const TYPES_L = await p.evaluate(() => Object.fromEntries(TYPES.map(t => [t.k, t.l])));
  console.log('   ' + Object.values(by).map(r => r.type + ': ' + (r.img ? 'logo ' + r.img.w + '×' + r.img.h + (r.img.ok ? '' : ' NOT LOADED') : r.nl ? 'NL mark' : r.pill ? 'name pill' : '?')).join(' | '));
  check(['oliv', 'angel', 'invisalign', 'ulab', 'insmile'].filter(k => by[k]).every(k => by[k].img && by[k].img.ok && !by[k].pill), 'list: Oliv, Angel, Invisalign, uLab and InSmile show their logos (loaded, no pill)');
  check(by.nla && by.nla.img && by.nla.img.ok && /In-house/.test(by.nla.img.alt) && !by.nla.pill, 'list: in-house sets show the Next Level Orthodontics logo');
  // retainers and mouthguards show their New case tile's picture since 4 Oct 2026 (Amir); study models keep their name
  check(['retainer', 'mouthguard'].every(k => by[k] && by[k].img && by[k].img.ok && by[k].img.pic === k && by[k].img.h === 34 && by[k].img.alt === TYPES_L[k] && !by[k].pill), 'list: Retainers & whitening and Mouthguard show their tile pictures, 34 px tall (' + ['retainer', 'mouthguard'].map(k => by[k] && by[k].img ? k + ' ' + by[k].img.w + '×' + by[k].img.h : k + ' none').join(', ') + ')');
  check(by.models && by.models.pill && !by.models.img, 'list: study models keep their name');
  check(by.marpe && by.marpe.img && by.marpe.img.ok && /Partners Dental Solutions/.test(by.marpe.img.alt), 'list: MARPE cases show their lab’s logo (Partners)');
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
  const rk = await p.$$eval('.kc', ks => ks.map(k => { const c = findCase(k.dataset.id), i = k.querySelector('.ft .tlogo img'); return { type: c.type, pic: i ? i.dataset.pic || '' : '', ok: !!i && i.complete && i.naturalWidth > 0, h: i ? Math.round(i.getBoundingClientRect().height) : 0, pill: !!k.querySelector('.ft .badge') }; }));
  check(['retainer', 'mouthguard'].every(t => rk.some(x => x.type === t)) && rk.every(x => x.pic === x.type && x.ok && x.h === 24 && !x.pill), 'board (retainers & mouthguards): every card shows its tile picture, 24 px tall, no names (' + rk.length + ' cards)');
  await p.screenshot({ path: OUT + '/v16-board-retainer.png', clip: { x: 232, y: 60, width: 1128, height: 560 } });
  // the New case Retainers tile keeps Amir's clear-tray picture (Amir, 4 Oct 2026: "I actually like the picture of the retainer on the tiles")
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  check(await p.evaluate(() => { const t = document.querySelector('#ncForm .tt[data-tile=retainer]'), i = t && t.querySelector('img[data-pic=retainer]'); return !!i && i.complete && i.naturalWidth > 0 && !t.querySelector('img[data-logo]'); }), 'New case: the Retainers tile keeps its clear-tray picture (not the logo)');
  await p.click('.modal [data-act=closeModal]');
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
