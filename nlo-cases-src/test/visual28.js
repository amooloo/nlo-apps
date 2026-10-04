// Amir, 3 Oct 2026: the patient's CC. Morning: the learned buttons "kinda doesn't make sense … 'this is initial' is one of them" →
// a fixed list, "Patient's chief concern" on a first set and "CC from last visit" on later sets, an older "This is initial" not
// shown. Evening: "take out all the options and just write in exactly what they say, for example, my bite is not right" — one
// box for the patient's own words, no buttons — demo
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
  // an older case with "This is initial" typed in the CC box, and one saved from the fixed list that morning
  const [oldId, listId] = await p.evaluate(() => openCases().filter(c => c.type === 'oliv').slice(0, 2).map(c => c.id));
  await setCase(oldId, { cc: 'This is initial', initial: 'yes' }); await setCase(listId, { cc: 'Crowding, Midline', initial: 'yes' });
  const sec = () => p.evaluate(() => { const box = document.querySelector('#ncForm #cf-cc'), s = box && box.closest('.cfSec');
    return { title: document.querySelector('#ncForm #cf-ccTitle').textContent, note: (document.querySelector('#ncForm #cf-ccNote') || {}).textContent, tag: box && box.tagName,
      ph: box && box.placeholder, named: box && box.getAttribute('aria-labelledby').split(' ').every(id => document.getElementById(id)),
      buttons: s ? s.querySelectorAll('button, .pick').length : -1, shown: !!(s && s.offsetParent) }; });

  // ---- New case: one box for the patient's words, no buttons; the heading follows first set / later sets
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(120);
  let f = await sec(); console.log('   ' + JSON.stringify(f));
  check(f.shown && f.tag === 'TEXTAREA' && f.buttons === 0 && !(await p.$('#ncForm [data-cc]')), 'one box for the patient’s words — no buttons');
  check(f.title === 'Patient’s chief concern' && f.note === 'in the patient’s own words' && /My bite doesn’t feel right/.test(f.ph) && f.named, 'a new case: “Patient’s chief concern · in the patient’s own words”, an example in the box, and the box is named by the heading');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(80);
  check((await sec()).title === 'Patient’s CC from last visit', 'a refinement: “Patient’s CC from last visit”');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=mid]'); await p.waitForTimeout(80);
  check((await sec()).title === 'Patient’s CC from last visit', 'a mid-course correction too');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(80);
  check((await sec()).title === 'Patient’s chief concern', 'a first set: “Patient’s chief concern”');
  await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(100); f = await sec();
  check(f.shown && f.buttons === 0 && f.title === 'Patient’s chief concern', 'an appliance: the same box');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(100);
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  await (await p.$('#ncForm #cf-cc')).evaluate(e => e.closest('.cfSec').scrollIntoView({ block: 'center' })); await p.mouse.move(5, 5); await p.waitForTimeout(150);
  await (await p.evaluateHandle(() => document.querySelector('#ncForm #cf-cc').closest('.cfSec'))).screenshot({ path: OUT + '/v28-cc.png' });
  // typed as the patient said it; line breaks and extra spaces come out
  await p.fill('#ncForm #cf-cc', 'My bite is not right\n  and my front teeth  stick out?');
  await p.fill('#ncForm #cf-patient', 'Cora Concernly'); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }).catch(() => {});
  const nid = await p.evaluate(() => (openCases().find(c => c.patient === 'Cora Concernly') || {}).id);
  check(!!nid && await p.evaluate(id => DEMO.cases.get(id).cc, nid) === 'My bite is not right and my front teeth stick out?', 'saved in the patient’s words, on one line');

  // ---- the case: the words at the top; the chart note keeps the patient's own ending
  const box = () => p.evaluate(() => { const b = document.querySelector('#drawer .ccBox'); return b ? { k: b.querySelector('.ccK').textContent, v: b.querySelector('.ccV').textContent, none: b.classList.contains('none') } : null; });
  const note = id => p.evaluate(id => (chartNote(findCase(id)).split('\n').find(l => /^Pt's CC/.test(l)) || ''), id);
  await p.evaluate(id => openDrawer(id), nid); await p.waitForSelector('#drawer .ccBox');
  let b = await box();
  check(b && b.k === 'Patient’s chief concern' && b.v === 'My bite is not right and my front teeth stick out?', 'the case: “Patient’s chief concern — My bite is not right and my front teeth stick out?”');
  await (await p.$('#drawer .ccBox')).screenshot({ path: OUT + '/v28-case.png' });
  check(await note(nid) === "Pt's CC: My bite is not right and my front teeth stick out?", 'chart note: “Pt’s CC: My bite is not right and my front teeth stick out?” (no period added after the question mark)');
  await setCase(nid, { cc: 'my bite is not right', initial: 'no' }); await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, nid); await p.waitForSelector('#drawer .ccBox');
  b = await box();
  check(b && b.k === 'Patient’s chief concernfrom last visit' && b.v === 'my bite is not right', 'a refinement: “… from last visit”');
  check(await note(nid) === "Pt's CC: my bite is not right.", 'chart note: “Pt’s CC: my bite is not right.”');
  for (const t of ['none', 'No concerns', 'None.']) {
    await setCase(nid, { cc: t }); await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, nid); await p.waitForSelector('#drawer .ccBox');
    b = await box(); const n = await note(nid);
    check(b && b.none && b.v === 'None' && n === '', '“' + t + '” shows as a plain None (not highlighted), nothing in the chart note');
  }
  // ---- older cases: "This is initial" isn't shown; a list answer from this morning shows as saved; Edit shows the text in the box
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, oldId); await p.waitForSelector('#drawer .dsList');
  check(!(await p.$('#drawer .ccBox')) && !/Pt's CC/.test(await p.evaluate(id => chartNote(findCase(id)), oldId)) && await p.evaluate(id => DEMO.cases.get(id).cc, oldId) === 'This is initial', 'an older “This is initial”: no chief-concern box, nothing in the chart note, its saved text left alone');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-cc');
  check(await p.inputValue('#drawer #cf-cc') === 'This is initial', 'Edit shows it in the box (to clear if you like)');
  await p.click('#drawer [data-act=cancelEdit]');
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, listId); await p.waitForSelector('#drawer .ccBox');
  b = await box();
  check(b && b.v === 'Crowding, Midline' && await note(listId) === "Pt's CC: Crowding, Midline.", 'a case saved from the list this morning shows as it was saved');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-cc');
  check(await p.inputValue('#drawer #cf-cc') === 'Crowding, Midline' && !(await p.$('#drawer [data-cc]')), '… and Edit has it in the box, no buttons');
  await p.click('#drawer [data-act=cancelEdit]');
  // phones
  await p.evaluate(() => closeDrawer(true)); await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => newCaseModal()); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(150);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390 && document.querySelector('#ncForm #cf-cc').getBoundingClientRect().width > 250), 'phone: the box fits, no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
