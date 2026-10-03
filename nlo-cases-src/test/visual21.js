// Lab logos: the Lab choices for appliances and MARPE, and appliance/MARPE cases on the board and lists — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const labs = () => p.$$eval('#ncForm .pickRow[data-g=lab] .pick', bs => bs.map(b => { const i = b.querySelector('img'); return { v: b.dataset.v, on: b.getAttribute('aria-pressed') === 'true', logo: i ? i.dataset.logo : '', ok: !!i && i.complete && i.naturalWidth > 0, h: i ? Math.round(i.getBoundingClientRect().height) : 0, text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor }; }));

  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(80);
  let L = await labs(); console.log('   ' + L.map(x => x.logo + (x.ok ? '' : ' NOT LOADED') + ' ' + x.h + 'px').join(' | '));
  check(L.length === 3 && L.every(x => x.ok && x.text === x.v) && L.map(x => x.logo).join(',') === 'lab-specialty,lab-partners,nlo', 'Appliance: the Lab choices are the Specialty, Partners and Next Level logos (names kept inside)');
  await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="MSE"]'); await p.waitForTimeout(60);
  L = await labs();
  check(L.find(x => x.on) && L.find(x => x.on).v === 'Specialty Orthodontic Lab' && L.find(x => x.on).bg === 'rgb(100, 244, 201)', 'MSE picks Specialty (shown picked, mint)');
  const row = await p.$('#ncForm .pickRow[data-g=lab]'); await row.scrollIntoViewIfNeeded(); const rb = await row.boundingBox();
  await p.screenshot({ path: OUT + '/v21-lab-choices.png', clip: { x: Math.max(0, rb.x - 24), y: Math.max(0, rb.y - 40), width: 700, height: 110 } });
  await p.click('#ncForm .pickRow[data-g=lab] .pick[data-v="Partners Dental Solutions"]'); await p.waitForTimeout(60);
  check((await labs()).find(x => x.on).v === 'Partners Dental Solutions', 'tapping the Partners logo picks Partners');
  await p.click('#ncForm .tt[data-tile=marpe]'); await p.waitForTimeout(80);
  check((await labs()).find(x => x.on).v === 'Partners Dental Solutions', 'MARPE: Partners picked, as its logo');
  await p.click('.modal [data-act=closeModal]');

  // lists and board: appliance cases show their lab's logo; no lab yet keeps the name
  await p.evaluate(() => { const ap = openCases().filter(c => c.type === 'appliance'); ap[0].lab = 'Specialty Orthodontic Lab'; ap[1].lab = 'In-house (NL Lab)'; ap[2].lab = ''; queueRender(); });
  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click'); await p.waitForTimeout(150);
  const marks = await p.$$eval('#listBody tr.click', rs => rs.map(r => { const c = findCase(r.dataset.id); if (c.type !== 'appliance' && c.type !== 'marpe') return null;
    const td = r.querySelector('td.hideM'), i = td.querySelector('img'); return { type: c.type, lab: c.lab || '', logo: i ? i.dataset.logo : '', ok: !!i && i.complete && i.naturalWidth > 0, alt: i ? i.alt : '', pill: !!td.querySelector('.badge') }; }).filter(Boolean));
  console.log('   ' + marks.map(m => m.type + '/' + (m.lab || 'no lab') + ' → ' + (m.logo || (m.pill ? 'name' : '?'))).join(' | '));
  check(marks.some(m => m.lab === 'Specialty Orthodontic Lab' && m.logo === 'lab-specialty' && m.ok && /Appliance · Specialty/.test(m.alt)), 'list: an appliance at Specialty shows the Specialty logo (alt says Appliance · Specialty…)');
  check(marks.some(m => m.lab === 'In-house (NL Lab)' && m.logo === 'nlo' && m.ok), 'list: an in-house appliance shows the Next Level logo');
  check(marks.some(m => m.type === 'appliance' && !m.lab && m.pill), 'list: an appliance with no lab yet keeps its name');
  check(marks.filter(m => m.type === 'marpe').every(m => m.logo === 'lab-partners' && m.ok), 'list: MARPE cases show the Partners logo');
  await p.screenshot({ path: OUT + '/v21-list.png', clip: { x: 232, y: 0, width: 1128, height: 700 } });
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=appliance]'); await p.waitForSelector('.kc'); await p.waitForTimeout(150);
  const kc = await p.$$eval('.kc .ft', fs => fs.map(f => { const i = f.querySelector('.tlogo img'); return i ? i.dataset.logo + (i.complete && i.naturalWidth > 0 ? '' : ' NOT LOADED') : (f.querySelector('.badge') ? 'name' : 'none'); }));
  console.log('   board (appliances):', kc.join(' | '));
  check(kc.includes('lab-specialty') && kc.includes('nlo') && !kc.some(x => /NOT LOADED/.test(x)), 'board (Appliances): the lab logos on the cards');
  await p.screenshot({ path: OUT + '/v21-board.png', clip: { x: 232, y: 60, width: 1128, height: 520 } });
  // phone: no sideways scrolling in the form's Lab row
  await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => newCaseModal()); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(100);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390 && Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=lab] .pick')).every(b => b.getBoundingClientRect().right <= window.innerWidth)), 'phone: the lab logos fit');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
