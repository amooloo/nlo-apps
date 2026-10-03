// Amir, 3 Oct 2026: "use these icons for the scanner types" — his Allied Star and iTero pictures on the Scanner choices
// (a small white circle, the wand on a slant) and before the scanner's name in the case's Details — demo
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
  const row = root => p.$$eval(root + ' .pickRow[data-g=scanner] .pick', bs => bs.map(b => { const i = b.querySelector('img.scanIc'), r = i && i.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { v: b.dataset.v, text: b.textContent.trim(), on: b.getAttribute('aria-pressed'), k: i && i.dataset.pic, ok: !!i && i.complete && i.naturalWidth > 0, w: r && Math.round(r.width), h: r && Math.round(r.height), round: i && getComputedStyle(i).borderRadius, inside: !!r && r.top >= br.top && r.bottom <= br.bottom && r.left >= br.left, bh: Math.round(br.height) }; }));

  // ---- New case: both scanner choices show their picture (Allied Star picked by default for a scan)
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(120);
  let r = await row('#ncForm'); console.log('   ' + JSON.stringify(r));
  check(r.length === 2 && r.map(x => x.text).join('|') === 'Allied Star|iTero', 'the Scanner choices keep their names (Allied Star, iTero)');
  check(r[0].k === 'scan-allied' && r[1].k === 'scan-itero' && r.every(x => x.ok && x.w === 36 && x.h === 36 && x.round === '50%' && x.inside), 'each shows its picture, loaded, in a 36 px circle inside the button');
  check(r[0].on === 'true' && r[1].on === 'false', 'a new aligner case starts on Allied Star (as before)');
  const sr = await p.$('#ncForm .pickRow[data-g=scanner]'); await sr.scrollIntoViewIfNeeded(); const b = await sr.boundingBox();
  await p.screenshot({ path: OUT + '/v25-scanner-allied.png', clip: { x: b.x - 16, y: b.y - 34, width: 420, height: b.height + 50 } });
  await p.click('#ncForm .pickRow[data-g=scanner] .pick[data-v=iTero]'); await p.waitForTimeout(80);
  r = await row('#ncForm');
  check(r[0].on === 'false' && r[1].on === 'true' && await p.evaluate(() => readCaseForm(document.querySelector('.modal')).scanner) === 'iTero', 'tapping the iTero picks iTero');
  await p.screenshot({ path: OUT + '/v25-scanner-itero.png', clip: { x: b.x - 16, y: b.y - 34, width: 420, height: b.height + 50 } });
  // the pictures are photos on white, so the circle stays white on the picked (mint) button
  check(await p.evaluate(() => getComputedStyle(document.querySelector('#ncForm .pick[data-v=iTero] .scanIc')).backgroundColor) === 'rgb(255, 255, 255)', 'the circle stays white on the picked button');
  await p.click('.modal [data-act=closeModal]');

  // ---- the case's Details: the picture before the scanner's name; Edit shows the choices with pictures too
  const id = await p.evaluate(() => openCases().find(c => c.scanner === 'Allied Star').id);
  await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .kv');
  const det = await p.evaluate(() => { const v = Array.from(document.querySelectorAll('#drawer .kv > div')).find(d => d.querySelector('.k').textContent === 'Scanner').querySelector('.v'), i = v.querySelector('img.scanIc');
    return { text: v.textContent, k: i && i.dataset.pic, ok: !!i && i.complete && i.naturalWidth > 0, h: i && Math.round(i.getBoundingClientRect().height) }; });
  check(det.text === 'Allied Star' && det.k === 'scan-allied' && det.ok && det.h === 22, 'Details: a small Allied Star picture before “Allied Star”');
  const kvd = await p.evaluateHandle(() => Array.from(document.querySelectorAll('#drawer .kv > div')).find(d => d.querySelector('.k').textContent === 'Scanner'));
  await kvd.screenshot({ path: OUT + '/v25-details.png' });
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=scanner]');
  r = await row('#drawer');
  check(r.every(x => x.ok) && r[0].on === 'true', 'Edit: the same pictures, the case’s scanner picked');
  await p.click('#drawer [data-act=cancelEdit]');
  // a case with no scanner: just the dash
  const none = await p.evaluate(() => (openCases().find(c => !c.scanner) || {}).id);
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, none); await p.waitForSelector('#drawer .kv');
  check(await p.evaluate(() => { const v = Array.from(document.querySelectorAll('#drawer .kv > div')).find(d => d.querySelector('.k').textContent === 'Scanner').querySelector('.v'); return !v.querySelector('img') && v.textContent === '—'; }), 'no scanner: no picture, just “—”');

  // ---- phone: the choices fit
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { closeDrawer(true); newCaseModal(); }); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(120);
  r = await row('#ncForm');
  check(r.every(x => x.ok && x.inside) && await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: both choices with pictures fit, no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
