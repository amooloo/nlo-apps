// Retainers & whitening trays (Amir, 6 Oct 2026, afternoon: "please add the option 'scan on file' for retainers when you are submitting a
// case. Also the steps for retainers and whitening is To make > printing > milestones > Front desk pick up. So no picked up and no need for
// the prompt with text"). Demo, made-up patients.
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
  const st = id => p.evaluate(id => { const d = DEMO.cases.get(id); return d.status + ' ' + d.stage; }, id);
  const setCase = (id, o) => p.evaluate(([id, o]) => { Object.assign(DEMO.cases.get(id), JSON.parse(JSON.stringify(o))); DEMO.emit(DEMO.cases.get(id)); }, [id, o]);

  console.log('\n# The steps: To make → Printing → Milestones → Front desk pickup');
  check(await p.evaluate(() => FLOWS.retainer.stages.map(s => s[1]).join(' → ')) === 'To make → Printing → Milestones → Front desk pickup', 'no Sarah’s desk, no Picked up');
  const ids = await p.evaluate(() => ({ make: openCases().find(c => c.type === 'retainer' && c.stage === 'print').id, mil: openCases().find(c => c.type === 'retainer' && c.stage === 'milestones').id,
    desk: openCases().find(c => c.type === 'retainer' && c.stage === 'pickup').id }));
  // cases saved at a step that isn't one any more show at Front desk pickup
  await setCase(ids.desk, { stage: 'sarah' }); await p.waitForTimeout(100);
  const a = await p.evaluate(id => stageLabel(findCase(id)), ids.desk);
  await setCase(ids.desk, { stage: 'pickedup' }); await p.waitForTimeout(100);
  const b = await p.evaluate(id => stageLabel(findCase(id)), ids.desk);
  check(a === 'Front desk pickup' && b === 'Front desk pickup', 'a case saved On Sarah’s desk, or at Picked up (there for a few hours today), shows at Front desk pickup');
  await setCase(ids.desk, { stage: 'pickup' });
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=retainer]'); await p.waitForSelector('.board');
  const cols = await p.$$eval('.board section.col', s => s.map(x => x.getAttribute('aria-label')).join(' | '));
  check(cols === 'To make | Printing | Milestones | Front desk pickup', 'the board: ' + cols);
  check(await p.getAttribute('.kc[data-id="' + ids.make + '"] .adv', 'title') === 'Move to Printing', 'from To make, the arrow moves it to Printing');
  await p.click('.kc[data-id="' + ids.make + '"] .adv'); await p.waitForTimeout(250);
  check(await st(ids.make) === 'open printing' && !(await p.$('#modalWrap')), 'To make → Printing (nothing asked)');
  await p.screenshot({ path: OUT + '/v52-board.png' });
  // the last step is Front desk pickup again: it asks whether the case is done, like every kind of case — no note pops up
  await p.click('.kc[data-id="' + ids.mil + '"] .adv');
  await p.waitForSelector('#modalWrap h3', { timeout: 3000 }).catch(() => {});
  const q = await p.evaluate(() => ({ h: (document.querySelector('#modalWrap h3') || {}).textContent, note: !!document.querySelector('#puNote') }));
  check(q.h === 'Mark this case complete?' && !q.note, 'Milestones → Front desk pickup, the last step: “Mark this case complete?” (no chart-note pop-up)');
  await p.click('#cbYes'); await p.waitForTimeout(300);
  check(await st(ids.mil) === 'done pickup', 'Mark complete: completed at Front desk pickup');
  check(await p.evaluate(id => chartNote(findCase(id) || DEMO.cases.get(id), 'del').split('\n')[0], ids.desk) === "Delivered retainers: U/L TT's and WT's.", 'its delivery note as before: “Delivered retainers: …”');

  console.log('\n# New case: Scan on file');
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=retainer]'); await p.fill('#cf-patient', 'Sophie Scanfile');
  await p.click('#ncForm .pickRow[data-g=arches] .pick[data-v=Upper]'); await p.click('#ncForm .pickRow[data-g=arches] .pick[data-v=Lower]');
  await p.click('#ncForm .pickRow[data-g=retKinds] .pick[data-v="TT’s"]');
  const row = await p.evaluate(() => { const r = document.querySelector('#ncForm .pickRow[data-g=remake]'); return { opts: Array.from(r.querySelectorAll('.pick')).map(b => b.textContent).join(' | '), h: r.previousElementSibling.textContent }; });
  check(row.opts === 'Scan on file | Remake w/ model | Remake w/o model' && /^Scan on file or a remake\?/.test(row.h), 'with the remakes: Scan on file | Remake w/ model | Remake w/o model (' + row.h + ')');
  await p.click('#ncForm .pickRow[data-g=remake] .pick[data-v=file]');
  const f1 = await p.evaluate(() => { const o = readCaseForm(document.querySelector('#modalWrap')); return { scan: o.scanOnFile, remake: o.remake, detail: document.querySelector('#cf-detail').value }; });
  check(f1.scan === true && f1.remake === '' && f1.detail === 'U/L TT’s – scan on file', 'Scan on file: What’s being made says so (' + f1.detail + ')');
  await p.click('#ncForm .pickRow[data-g=remake] .pick[data-v=nomodel]');
  const f2 = await p.evaluate(() => { const o = readCaseForm(document.querySelector('#modalWrap')); return { scan: o.scanOnFile, remake: o.remake, detail: document.querySelector('#cf-detail').value }; });
  check(f2.scan === '' && f2.remake === 'nomodel' && f2.detail === 'U/L TT’s – remake w/o model', 'one or the other: Remake w/o model takes over');
  await p.click('#ncForm .pickRow[data-g=remake] .pick[data-v=file]');
  await p.screenshot({ path: OUT + '/v52-form.png' });
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const sid = await p.evaluate(() => (openCases().find(c => c.patient === 'Sophie Scanfile') || {}).id);
  check(!!sid && await p.evaluate(id => findCase(id).scanOnFile === true && findCase(id).remake === '' && findCase(id).stage === 'print', sid), 'saved: from the scan on file, at To make');
  await p.evaluate(id => openDrawer(id), sid); await p.waitForSelector('#drawer #dKind');
  check(await p.textContent('#dKind') === 'Retainers from Scan on File', 'its panel: “Retainers from Scan on File”');
  const n1 = await p.evaluate(id => chartNote(findCase(id), 'scan').split('\n')[0], sid);
  check(n1 === "Retainers from the scan on file (Allied Star): U/L TT's.", 'the scan note: “' + n1 + '” (no new scan)');
  check(await p.evaluate(id => chartNote(findCase(id), 'del').split('\n')[0], sid) === "Delivered retainers: U/L TT's.", 'the delivery note: “Delivered retainers: U/L TT\'s.”');
  // Edit: Remake w/ model instead
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=remake]');
  check(await p.evaluate(() => document.querySelector('#drawer .pickRow[data-g=remake] .pick[data-v=file]').getAttribute('aria-pressed')) === 'true', 'Edit shows Scan on file picked');
  await p.click('#drawer .pickRow[data-g=remake] .pick[data-v=model]'); await p.click('[data-act=saveEdit]');
  await p.waitForFunction(id => findCase(id).remake === 'model', sid, { timeout: 4000 }).catch(() => {});
  await p.waitForSelector('#drawer #dKind');
  check(await p.evaluate(id => findCase(id).scanOnFile === '' && findCase(id).remake === 'model', sid) && await p.textContent('#dKind') === 'Remake Retainers w/ Model', 'changed to Remake w/ model: “Remake Retainers w/ Model”, not from the scan any more');
  await p.evaluate(() => closeDrawer());
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=mouthguard]');
  check(!(await p.isVisible('#ncForm .pickRow[data-g=remake]')), 'mouthguards: no such row');
  await p.evaluate(() => closeModal());

  console.log('\n# Workload: a retainer made from a scan on file has no scan → entered time');
  await p.click('#nav-work'); await p.waitForFunction(() => WK.log && !WK.busy, null, { timeout: 8000 }).catch(() => {});
  const lag = await p.evaluate(async () => {
    const before = (wkStats().get('gwen') || { retLag: [] }).retLag.length;
    await B.createCase({ type: 'retainer', patient: 'Old Scan Retainer', stage: 'print', scanOnFile: true, scanDate: addDays(todayISO(), -40), arches: ['Upper'], retKinds: ['TT’s'], comments: [], createdAt: Date.now(), createdBy: 'gwen' });
    await B.createCase({ type: 'retainer', patient: 'New Scan Retainer', stage: 'print', scanDate: addDays(todayISO(), -1), arches: ['Upper'], retKinds: ['TT’s'], comments: [], createdAt: Date.now(), createdBy: 'gwen' });
    await new Promise(r => setTimeout(r, 200));
    const g = wkStats().get('gwen'); return { added: g.retLag.length - before, max: Math.max(...g.retLag) };
  });
  check(lag.added === 1 && lag.max < 40, 'of the two Gwen entered, only the one scanned yesterday counts (the scan on file from 40 days ago doesn’t)');
  // made = reached Milestones (past To make and Printing)
  const made = await p.evaluate(() => { const o = (wkStats().get('angelika') || {}).ret || 0; return o; });
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { staffId: 'angelika' }); });
  await p.evaluate(id => moveStage(id, 'milestones'), ids.make); await p.waitForTimeout(250); // (it's at Printing)
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { staffId: 'amir' }); });
  await p.click('.wkFilters [data-act=wkRefresh]'); await p.waitForFunction(() => !WK.busy, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(150);
  check(await p.evaluate(() => (wkStats().get('angelika') || {}).ret || 0) === made + 1, 'Printing → Milestones: one more retainer made, for whoever moved it');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
