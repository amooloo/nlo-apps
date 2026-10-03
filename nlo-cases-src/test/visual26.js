// Amir, 3 Oct 2026: in-house "add a middle step that says TxP completed or approved and it would still let me enter the U/L
// stages because I may not be able to export them right away" — TxP needed → TxP approved (asks the aligners and attachment
// templates) → Export STLs (no second question) — demo
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
  const st = id => p.evaluate(id => { const c = DEMO.cases.get(id); return { stage: c.stage, alU: c.alU, alL: c.alL, aligners: c.aligners, at: c.atTemplates || '' }; }, id);
  const setCase = (id, o) => p.evaluate(([id, o]) => { Object.assign(findCase(id), o); Object.assign(DEMO.cases.get(id), JSON.parse(JSON.stringify(o))); queueRender(); }, [id, o]);

  // ---- the steps: TxP needed, TxP approved, then In fabrication ("Reset needed in 2 days" retired the same day: resets aren't done any more)
  check(await p.evaluate(() => FLOWS.inhouse.stages.map(s => s[0]).join(',')) === 'txp,txpok,fab,send,print,thermo,trim,polish,wash,pack,checkedin' && await p.evaluate(() => FLOWS.inhouse.stages.find(s => s[0] === 'txpok')[1]) === 'TxP approved', 'in-house steps: TxP needed → TxP approved → Export STLs … → Made – needs packaging → Checked in (no Reset needed in 2 days)');
  // ---- the board: its own column, before In fabrication (the demo has one approved plan waiting to be exported)
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=inhouse]'); await p.waitForSelector('.kc');
  const cols = await p.$$eval('section[aria-label]', ss => ss.map(s => s.getAttribute('aria-label')));
  check(cols.join(' | ') === 'TxP needed | TxP approved | In fabrication | Made – needs packaging | Checked in', 'board: TxP needed, TxP approved, In fabrication, … — no Reset column (' + cols.join(' | ') + ')');
  const okId = await p.evaluate(() => openCases().find(c => c.type === 'nla' && c.stage === 'txpok').id);
  check(await p.isVisible('section[aria-label="TxP approved"] .kc[data-id="' + okId + '"]'), 'the demo’s approved plan sits in it');
  await (await p.$('.board')).screenshot({ path: OUT + '/v26-board.png' }).catch(async () => { await p.screenshot({ path: OUT + '/v26-board.png' }); });

  // ---- TxP needed: the board arrow goes to TxP approved (not Reset needed) and asks for the aligners and templates
  const tid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla' && x.stage === 'txp'); c.alU = ''; c.alL = ''; c.aligners = ''; c.atTemplates = ''; return c.id; });
  await setCase(tid, { alU: '', alL: '', aligners: '', atTemplates: '' }); await p.waitForTimeout(150);
  check(/TxP approved/.test(await p.getAttribute('.kc[data-id="' + tid + '"] .adv', 'title') || ''), 'the arrow on a TxP needed card says TxP approved (' + await p.getAttribute('.kc[data-id="' + tid + '"] .adv', 'title') + ')');
  await p.click('.kc[data-id="' + tid + '"] .adv'); await p.waitForSelector('#gAl');
  check(await p.textContent('#modalWrap h3') === 'TxP approved' && await p.isVisible('#gAlU') && await p.isVisible('#gAlL') && (await p.locator('.pickRow[data-g=gAt] .pick').count()) === 4 && await p.isDisabled('#gGo'), 'it asks: “TxP approved” — upper and lower aligners from Titan, attachment templates; Move waits for them');
  await p.click('#modalWrap [data-act=closeModal]'); await p.waitForTimeout(150);
  check((await st(tid)).stage === 'txp', 'Cancel leaves it at TxP needed');
  await p.click('.kc[data-id="' + tid + '"] .adv'); await p.waitForSelector('#gAl');
  await p.fill('#gAlU', '22'); await p.fill('#gAlL', '19'); await p.click('.pickRow[data-g=gAt] .pick[data-v=U]');
  await p.screenshot({ path: OUT + '/v26-ask.png', clip: { x: 300, y: 0, width: 760, height: 520 } });
  await p.click('#gGo'); await p.waitForTimeout(300);
  let s = await st(tid);
  check(s.stage === 'txpok' && s.alU === 22 && s.alL === 19 && s.aligners === 41 && s.at === 'U', 'moved to TxP approved with U 22 · L 19 (41) and Upper templates');
  check(await p.isVisible('section[aria-label="TxP approved"] .kc[data-id="' + tid + '"]'), 'the card moves to the TxP approved column');
  // the case: the step in its stepper, the counts in its Aligners box, labels ready to print
  await p.evaluate(id => openDrawer(id), tid); await p.waitForSelector('#drawer .stepper');
  const steps = await p.evaluate(() => Array.from(document.querySelectorAll('#drawer .stepper .step')).map(b => b.dataset.k + (b.classList.contains('cur') ? '*' : '')).join(','));
  check(/^txp,txpok\*,fab,/.test(steps), 'the case’s steps show TxP approved as where it is (' + steps.split(',').slice(0, 4).join(',') + '…)');
  check(/41 aligners in this set \(U 22 · L 19\)/.test((await p.textContent('#alBox')).replace(/\s+/g, ' ')) && !(await p.isDisabled('#alBox [data-act=labels]')), 'its Aligners box has the counts, and Print labels is ready (before the export)');
  const stp = await p.$('#drawer .ds[data-ds=stage]'); if (stp) await stp.screenshot({ path: OUT + '/v26-stepper.png' });
  // on to Export STLs: no second question
  await p.click('#drawer .step[data-k=fab]'); await p.waitForTimeout(300);
  check(!(await p.isVisible('#modalWrap')) && (await st(tid)).stage === 'fab', 'TxP approved → Export STLs: no question again (the counts are in)');
  // skipping TxP approved still asks (filled in with what the case has)
  await p.click('#drawer .step[data-k=txp]'); await p.waitForTimeout(250);
  await p.click('#drawer .step[data-k=send]'); await p.waitForSelector('#gAl');
  check(await p.textContent('#modalWrap h3') === 'Send to printer' && await p.inputValue('#gAlU') === '22' && await p.inputValue('#gAlL') === '19' && await p.getAttribute('.pickRow[data-g=gAt] .pick[data-v=U]', 'aria-pressed') === 'true', 'jumping from TxP needed past TxP approved still asks, filled in');
  await p.click('#modalWrap [data-act=closeModal]'); await p.waitForTimeout(150);
  await p.evaluate(() => closeDrawer(true));

  // ---- a case still saved at the retired "Reset needed in 2 days" (e.g. from the Asana import) shows at TxP needed
  const rid = await p.evaluate(() => openCases().find(x => x.type === 'nla' && x.stage === 'txp').id);
  await p.evaluate(id => { const d = DEMO.cases.get(id); d.stage = 'reset'; DEMO.logs.push({ caseId: id, a: 'stage', from: 'txp', to: 'reset', at: Date.now() - 86400e3, sid: 'angelika' }); DEMO.emit(d); }, rid); await p.waitForTimeout(200);
  const old = await p.evaluate(id => ({ stored: DEMO.cases.get(id).stage, shown: findCase(id).stage, label: stageLabel(findCase(id)), raw: stageLabel(DEMO.cases.get(id)), dr: openCases().filter(c => DR_STAGES.includes(c.stage)).some(c => c.id === id) }), rid);
  check(old.stored === 'reset' && old.shown === 'txp' && old.label === 'TxP needed' && old.raw === 'TxP needed' && old.dr, 'a case saved at Reset needed shows as TxP needed (and counts as needing Dr. A); nothing is rewritten');
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=inhouse]'); await p.waitForSelector('.kc[data-id="' + rid + '"]');
  check(await p.isVisible('section[aria-label="TxP needed"] .kc[data-id="' + rid + '"]'), 'on the board it sits in TxP needed');
  const hist = await p.evaluate(async id => { S.history = await B.caseLog(id); return historyHTML(findCase(id)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }, rid);
  check(/moved it to Reset needed in 2 days/.test(hist), 'its history still names the old step (“moved it to Reset needed in 2 days”)');
  await p.click('.kc[data-id="' + rid + '"] .adv'); await p.waitForSelector('#gAl');
  check(await p.textContent('#modalWrap h3') === 'TxP approved', 'its arrow asks for TxP approved');
  await p.click('.pickRow[data-g=gAt] .pick[data-v=none]'); await p.click('#gGo'); await p.waitForTimeout(300);
  check((await st(rid)).stage === 'txpok', '… and moves it there (saved as TxP approved)');
  check(await p.evaluate(() => stageFromSection('nla', 'Reset needed in 2 days', null)) === 'txp', 'Asana import: a task still in “Reset needed in 2 days” lands at TxP needed');
  // the approved plan's arrow goes to Export STLs without asking
  await p.click('.kc[data-id="' + okId + '"] .adv'); await p.waitForTimeout(300);
  check(!(await p.isVisible('#modalWrap')) && (await st(okId)).stage === 'fab', 'TxP approved → the arrow moves it to In fabrication (Export STLs) with no question');

  // ---- Edit: putting a case at TxP approved needs the counts and the answer; the date chip is the lab date as before
  const eid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla' && x.stage === 'txp'); return c && c.id; });
  if (eid) {
    await setCase(eid, { alU: '', alL: '', aligners: '', atTemplates: '' });
    await p.evaluate(id => openDrawer(id), eid); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stage', { state: 'attached' });
    await p.evaluate(() => { const s = document.querySelector('#drawer #cf-stage'); s.value = 'txpok'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(250);
    check(/before moving it to TxP approved/.test(await p.textContent('#drawerNotice')), 'Edit → TxP approved without the counts is stopped with a note');
    await p.click('#drawer [data-act=cancelEdit]');
  } else check(false, 'a TxP needed case for the Edit check');
  check(await p.evaluate(() => (dueOf({ type: 'nla', stage: 'txpok', labDate: '2026-10-05', deliveryDate: '2026-10-12' }) || {}).k) === 'lab', 'TxP approved shows the lab date (like the rest of fabrication)');
  // the form's note
  check(await p.evaluate(() => /asked again when the TxP is approved/.test(caseFormHTML({ type: 'nla' }, true))), 'the form says attachment templates are asked when the TxP is approved');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
