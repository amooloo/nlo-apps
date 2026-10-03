// Appliance, MARPE, Retainers, Mouthguard and Study models tiles show Amir's pictures on a white plate — demo
// (Appliance: his 3 Oct picture of an RPE, Herbst arms and a removable plate, white-background version)
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const pic = (root, v) => p.evaluate(([root, v]) => { const t = document.querySelector(root + ' .tt[data-tile=' + v + ']'), i = t && t.querySelector('.tmed.pic img');
    if (!i) return null; const r = i.getBoundingClientRect(), m = t.querySelector('.tmed').getBoundingClientRect();
    return { ok: i.complete && i.naturalWidth > 0, w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= m.left - .5 && r.right <= m.right + .5 && r.top >= m.top - .5 && r.bottom <= m.bottom + .5, svg: !!t.querySelector('.tmed svg'), bg: getComputedStyle(t.querySelector('.tmed')).backgroundColor }; }, [root, v]);
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  const a = await pic('#ncForm', 'appliance'), m = await pic('#ncForm', 'marpe');
  console.log('   appliance', JSON.stringify(a), '\n   marpe', JSON.stringify(m));
  check(a && a.ok && a.h === 46 && a.inside && !a.svg && a.bg === 'rgb(255, 255, 255)' && a.w >= 70, 'New case: Appliance shows Amir’s 3 Oct picture (loaded, 46 px tall, inside its white plate, no drawing)');
  check(m && m.ok && m.h === 46 && m.inside && !m.svg && m.bg === 'rgb(255, 255, 255)', 'New case: MARPE shows the picture (white plate)');
  for (const [v, what] of [['retainer', 'Retainers shows the clear tray'], ['mouthguard', 'Mouthguard shows the mouthguard'], ['models', 'Study models shows the model']]) { const r = await pic('#ncForm', v); console.log('   ' + v, JSON.stringify(r));
    check(r && r.ok && r.h === 46 && r.inside && !r.svg, 'New case: ' + what); }
  check(await p.evaluate(() => !!document.querySelector('#ncForm .tt[data-tile=nla] .tmed svg') && !document.querySelector('#ncForm .tt[data-tile=finishing]')), 'In-house keeps the NL mark; Finishing aligners isn’t its own tile any more');
  await (await p.$('#ncForm .tileGrid')).screenshot({ path: OUT + '/v19-tiles.png' });
  await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(120);
  check(await p.evaluate(() => getComputedStyle(document.querySelector('#ncForm .tt[data-tile=appliance] .tmed')).boxShadow.includes('100, 244, 201')), 'picked: the mint ring shows around the picture');
  await (await p.$('#ncForm .tileGrid')).screenshot({ path: OUT + '/v19-tiles-picked.png' });
  await p.click('#ncForm .tt[data-tile=marpe]'); await p.waitForTimeout(80);
  check(await p.inputValue('#cf-detail') === 'MARPE', 'tapping the MARPE picture picks MARPE');
  await p.click('.modal [data-act=closeModal]');
  // Edit an appliance case: same picture
  const id = await p.evaluate(() => openCases().find(c => c.type === 'appliance').id);
  await p.evaluate(id => openDrawer(id), id); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .tt[data-tile=appliance]');
  const e = await pic('#drawer', 'appliance');
  check(e && e.ok && e.h === 46 && e.bg === 'rgb(255, 255, 255)', 'Edit: the Appliance tile shows the picture too');
  await p.click('#drawer [data-act=cancelEdit]');
  // phone: fits
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { closeDrawer(true); newCaseModal(); }); await p.waitForSelector('#ncForm');
  const ph = await pic('#ncForm', 'appliance');
  check(ph && ph.ok && ph.inside && await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: the picture fits its tile, no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
