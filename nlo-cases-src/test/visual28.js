// Amir, 3 Oct 2026: the patient's CC buttons ("kinda doesn't make sense … 'this is initial' is one of them") — a fixed list to tap
// (several at once, typing still works), "Patient's chief concern" on a first set and "CC from last visit" on later sets, and an
// older note like "This is initial" not shown as a concern — demo
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
  const setCase = (id, o) => p.evaluate(([id, o]) => { Object.assign(findCase(id), o); Object.assign(DEMO.cases.get(id), JSON.parse(JSON.stringify(o))); queueRender(); }, [id, o]);
  // several older cases with "This is initial" typed in the CC box (that's how it became a button before)
  const olds = await p.evaluate(() => openCases().filter(c => c.type === 'oliv').slice(0, 3).map(c => c.id));
  for (const id of olds) await setCase(id, { cc: 'This is initial', initial: 'yes' });
  const form = () => p.evaluate(() => ({ title: document.querySelector('#cf-ccTitle').textContent, btns: Array.from(document.querySelectorAll('.pickRow[data-cc] .pick[data-cc]')).filter(b => b.offsetParent).map(b => b.dataset.cc + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')), val: document.querySelector('#cf-cc').value }));
  const tap = async v => { await p.click('#ncForm .pickRow[data-cc] .pick[data-cc="' + v + '"]'); await p.waitForTimeout(60); };

  // ---- New case: the fixed list; the heading follows first set / refinement
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(120);
  let f = await form(); console.log('   ' + JSON.stringify(f));
  check(f.btns.join('|') === 'None|Spaces/gaps|Crowding|Front teeth|Rotated tooth|Deep bite|Overjet|Crossbite|Midline|Black triangles|Bite feels off|Aligners not fitting', 'the buttons are the fixed list (None, Spaces/gaps … Aligners not fitting) — nothing learned from typed text');
  check(!f.btns.some(b => /initial/i.test(b)), '“This is initial” isn’t a button, even with several cases saying it');
  check(f.title === 'Patient’s chief concern', 'a new case reads “Patient’s chief concern”');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(80);
  check((await form()).title === 'Patient’s CC from last visit', 'a refinement reads “Patient’s CC from last visit”');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=mid]'); await p.waitForTimeout(80);
  check((await form()).title === 'Patient’s CC from last visit', 'a mid-course correction too');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(80);
  check((await form()).title === 'Patient’s chief concern', 'a first set: “Patient’s chief concern”');
  // tapping several; tapping again takes one off; typing keeps the buttons in step; None stands alone
  await tap('Crowding'); await tap('Midline'); f = await form();
  check(f.val === 'Crowding, Midline' && f.btns.includes('Crowding*') && f.btns.includes('Midline*'), 'tap Crowding and Midline: “Crowding, Midline”, both lit');
  await tap('Crowding'); f = await form();
  check(f.val === 'Midline' && !f.btns.includes('Crowding*') && f.btns.includes('Midline*'), 'tap Crowding again: it comes off');
  await p.fill('#ncForm #cf-cc', 'Midline, wants the gap closed, Deep bite'); await p.waitForTimeout(60); f = await form();
  check(f.btns.includes('Midline*') && f.btns.includes('Deep bite*') && f.btns.filter(b => b.endsWith('*')).length === 2, 'typing keeps the buttons in step (Midline and Deep bite lit; the typed words kept)');
  await tap('None'); f = await form();
  check(f.val === 'None' && f.btns.filter(b => b.endsWith('*')).join() === 'None*', 'None: just “None”');
  await tap('Black triangles'); f = await form();
  check(f.val === 'Black triangles' && !f.btns.includes('None*'), 'a concern after None replaces it');
  await (await p.$('#ncForm .pickRow[data-cc]')).evaluate(e => e.closest('.cfSec').scrollIntoView({ block: 'center' }));
  await (await p.$('#ncForm #cf-ccTitle')).evaluate(e => e.closest('.cfSec').style.outline = 'none');
  await p.waitForTimeout(150); await (await p.$('#ncForm #cf-ccTitle')).evaluate(e => e.closest('.cfSec').scrollIntoView({ block: 'center' }));
  await (await p.evaluateHandle(() => document.querySelector('#ncForm #cf-ccTitle').closest('.cfSec'))).screenshot({ path: OUT + '/v28-cc.png' });
  // appliances: no "Aligners not fitting"
  await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(100);
  check(!(await form()).btns.some(b => b.startsWith('Aligners not fitting')), 'an appliance doesn’t offer “Aligners not fitting”');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(100);
  // saving keeps what was tapped
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  await p.fill('#ncForm #cf-cc', ''); await tap('Spaces/gaps'); await tap('Front teeth');
  await p.fill('#ncForm #cf-patient', 'Cora Concernly'); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }).catch(() => {});
  const nid = await p.evaluate(() => (openCases().find(c => c.patient === 'Cora Concernly') || {}).id);
  check(!!nid && await p.evaluate(id => DEMO.cases.get(id).cc, nid) === 'Spaces/gaps, Front teeth', 'saved as “Spaces/gaps, Front teeth”');

  // ---- the case: a first set says "Patient's chief concern"; a later set adds "from last visit"; an old "This is initial" isn't shown
  await p.evaluate(id => openDrawer(id), nid); await p.waitForSelector('#drawer .ccBox');
  const box = () => p.evaluate(() => { const b = document.querySelector('#drawer .ccBox'); return b ? { k: b.querySelector('.ccK').textContent, v: b.querySelector('.ccV').textContent } : null; });
  let b = await box();
  check(b && b.k === 'Patient’s chief concern' && b.v === 'Spaces/gaps, Front teeth', 'first set: “Patient’s chief concern — Spaces/gaps, Front teeth”');
  await setCase(nid, { initial: 'no' }); await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, nid); await p.waitForSelector('#drawer .ccBox');
  b = await box();
  check(b && b.k === 'Patient’s chief concernfrom last visit', 'refinement: “Patient’s chief concern · from last visit”');
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, olds[0]); await p.waitForSelector('#drawer .dsList');
  check(!(await p.$('#drawer .ccBox')) && !/Pt's CC/.test(await p.evaluate(id => chartNote(findCase(id)), olds[0])), 'an older case whose CC says “This is initial”: no chief-concern box, nothing in the chart note');
  check(await p.evaluate(id => DEMO.cases.get(id).cc, olds[0]) === 'This is initial', '… and its saved text is left alone');
  // Edit shows what's saved (so it can be cleared), with no button lit
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-cc');
  check(await p.inputValue('#drawer #cf-cc') === 'This is initial' && await p.evaluate(() => !document.querySelector('#drawer .pickRow[data-cc] .pick[aria-pressed=true]')), 'Edit shows the saved text (to clear if you like), no button lit');
  await p.click('#drawer [data-act=cancelEdit]');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
