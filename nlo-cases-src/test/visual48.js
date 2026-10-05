// Stage marks and retainer remakes (Amir, 5 Oct 2026: "when you look at the stage, can you put a mark for the date each step was moved
// and by who? keep it light and simple" — "For whitening and retainers, the option also should be remake w/ or w/o model and also
// the stages should be Scan on file or something similar because the first step right now says printing"). Demo, made-up patients.
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
  const day = ms => p.evaluate(ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), ms);
  const marks = () => p.$$eval('#drawer .step[data-k]', bs => bs.map(b => [b.dataset.k, (b.querySelector('.stWhen') || {}).textContent || '']));
  const openStage = async id => { await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .ds[data-ds=stage]');
    if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=stage]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=stage] .dsTg');
    await p.waitForFunction(() => S.history, null, { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(120); };

  console.log('\n# Each step: when, and who');
  const ret = await p.evaluate(() => openCases().find(c => c.type === 'retainer' && c.stage === 'print').id);
  const born = await p.evaluate(id => DEMO.logs.find(l => l.caseId === id && l.a === 'create').at, ret);
  await openStage(ret);
  let m = await marks();
  check(m[0][0] === 'print' && m[0][1] === (await day(born)) + ' · Dr. A' && m.slice(1).every(x => x[1] === ''), 'the step it started at: the day it was made and by whom; steps not reached: nothing (' + JSON.stringify(m) + ')');
  check(await p.textContent('#drawer .step[data-k=print]') === '1To make' + (await day(born)) + ' · Dr. A', 'retainers: the first step is “To make” (not “Printing”)');
  await p.click('#drawer .step[data-k=milestones]');
  const today0 = await day(Date.now());
  await p.waitForFunction(t => ((document.querySelector('#drawer .step[data-k=milestones] .stWhen') || {}).textContent || '') === t + ' · Dr. A', today0, { timeout: 4000 }).catch(() => {});
  m = await marks();
  const today = await day(Date.now());
  check(m.find(x => x[0] === 'milestones')[1] === today + ' · Dr. A' && m.find(x => x[0] === 'print')[1] === (await day(born)) + ' · Dr. A', 'moving it on: the new step gets today and who moved it; the earlier one keeps its date (' + JSON.stringify(m) + ')');
  const look = await p.evaluate(() => { const w = document.querySelector('#drawer .step[data-k=milestones] .stWhen'), cs = getComputedStyle(w), b = w.closest('.step').getBoundingClientRect(), r = w.getBoundingClientRect();
    return { fs: parseFloat(cs.fontSize), w: cs.fontWeight, right: Math.round(b.right - r.right), oneLine: r.height < 20, title: w.title }; });
  check(look.fs <= 12 && look.oneLine && look.right < 20 && /Dr\. A$/.test(look.title), 'light: small grey text at the end of the row, one line (the exact time on hover: ' + look.title + ')');
  await p.screenshot({ path: OUT + '/v48-stage.png', clip: { x: 800, y: 0, width: 560, height: 520 } });
  // a lab email that moved a case, and an older case brought in from Asana
  const ol = await p.evaluate(() => { const c = openCases().find(x => x.type === 'oliv' && x.stage === 'mfg'); const at = Date.now() - 3 * 864e5;
    DEMO.logs.push({ caseId: c.id, a: 'email', co: 'oliv', kind: 'mfg', from: 'dra', to: 'mfg', at, sid: 'mailbot' }); return { id: c.id, at }; });
  await openStage(ol.id);
  m = await marks();
  check(m.find(x => x[0] === 'mfg')[1] === (await day(ol.at)) + ' · lab email', 'a lab email that moved it: “· lab email”');

  console.log('\n# Retainers: remake with or without the model');
  await p.evaluate(() => closeDrawer());
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=retainer]'); await p.fill('#cf-patient', 'Remy Remake');
  await p.click('#ncForm .pickRow[data-g=arches] .pick[data-v=Upper]'); await p.click('#ncForm .pickRow[data-g=arches] .pick[data-v=Lower]');
  await p.click('#ncForm .pickRow[data-g=retKinds] .pick[data-v="TT’s"]');
  const rm = await p.evaluate(() => Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=remake] .pick')).map(b => b.textContent + (b.offsetParent ? '' : ' (hidden)')));
  check(rm.join(' | ') === 'Remake w/ model | Remake w/o model', 'under Making: Remake w/ model · Remake w/o model (' + rm.join(' | ') + ')');
  await p.click('#ncForm .pickRow[data-g=remake] .pick[data-v=model]');
  check(await p.inputValue('#cf-detail') === 'U/L TT’s – remake w/ model', 'What’s being made says so (' + await p.inputValue('#cf-detail') + ')');
  await p.screenshot({ path: OUT + '/v48-remake-form.png' });
  await p.click('#ncForm .pickRow[data-g=remake] .pick[data-v=model]');
  check(await p.evaluate(() => readCaseForm(document.querySelector('#modalWrap')).remake) === '' && await p.inputValue('#cf-detail') === 'U/L TT’s', 'tapping it again: not a remake');
  await p.click('#ncForm .pickRow[data-g=remake] .pick[data-v=model]');
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const rid = await p.evaluate(() => (openCases().find(c => c.patient === 'Remy Remake') || {}).id);
  check(!!rid && await p.evaluate(id => findCase(id).remake, rid) === 'model', 'saved as a remake with the model on file');
  await p.evaluate(id => openDrawer(id), rid); await p.waitForSelector('#drawer #dKind');
  check(await p.textContent('#dKind') === 'Remake Retainers w/ Model', 'its panel: “Remake Retainers w/ Model” at the top');
  const n1 = await p.evaluate(id => chartNote(findCase(id), 'scan').split('\n')[0], rid);
  check(n1 === "Retainer remake from the model on file: U/L TT's.", 'chart note: “' + n1 + '”');
  check(/^Delivered retainers \(remake\): U\/L TT's\./.test(await p.evaluate(id => chartNote(findCase(id), 'del'), rid)), 'the delivery note: “Delivered retainers (remake): U/L TT\'s.”');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=remake]');
  await p.click('#drawer .pickRow[data-g=remake] .pick[data-v=nomodel]'); await p.click('[data-act=saveEdit]');
  await p.waitForFunction(id => findCase(id).remake === 'nomodel', rid, { timeout: 4000 }).catch(() => {});
  await p.waitForSelector('#drawer #dKind');
  check(await p.textContent('#dKind') === 'Remake Retainers w/o Model' && (await p.evaluate(id => chartNote(findCase(id), 'scan').split('\n')[0], rid)) === "Scanned with Allied Star for retainers (remake): U/L TT's.", 'w/o model: “Remake Retainers w/o Model”; the note says it was scanned for the remake');
  await p.evaluate(() => closeDrawer());
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=mouthguard]');
  check(!(await p.isVisible('#ncForm .pickRow[data-g=remake]')), 'mouthguards: no remake choice');
  await p.evaluate(() => closeModal());
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=retainer]'); await p.waitForSelector('.board');
  check(await p.isVisible('section[aria-label="To make"]') && !(await p.$('section[aria-label="Printing"]')), 'the board’s first column: To make');

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await openStage(ret);
  const ph = await p.evaluate(() => { const st = document.querySelector('#drawer .stepper').getBoundingClientRect(), d = document.querySelector('#drawer .dBd');
    return { fits: st.right <= innerWidth, over: d.scrollWidth - d.clientWidth, one: Array.from(document.querySelectorAll('#drawer .step .stWhen')).filter(w => w.textContent).every(w => w.getBoundingClientRect().height < 20) }; });
  check(ph.fits && ph.over <= 0 && ph.one, 'phone: the marks fit on the step rows');
  await p.screenshot({ path: OUT + '/v48-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
