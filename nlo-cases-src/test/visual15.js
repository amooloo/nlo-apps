// In-house: moving to Export STLs asks for the upper/lower aligners and any attachment templates — demo
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const st = id => p.evaluate(id => { const c = findCase(id); return { stage: c.stage, alU: c.alU, alL: c.alL, aligners: c.aligners, at: c.atTemplates || '' }; }, id);

  // a case at "Reset needed in 2 days": the stepper's Export STLs asks first
  const rid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla' && x.stage === 'reset'); c.alU = ''; c.alL = ''; c.aligners = ''; c.atTemplates = ''; return c.id; });
  await p.evaluate(id => openDrawer(id), rid); await p.waitForSelector('#drawer .stepper');
  await p.click('#drawer .step[data-k=fab]'); await p.waitForSelector('#gAl');
  check(/Export STLs/.test(await p.textContent('#modalWrap h3')) && await p.isVisible('#gAlU') && await p.isVisible('#gAlL') && (await p.locator('.pickRow[data-g=gAt] .pick').count()) === 4, 'Export STLs asks: upper aligners, lower aligners, attachment templates (None / Upper / Lower / Upper & Lower)');
  check(await p.isDisabled('#gGo'), 'the move waits until the counts and the template answer are in');
  await p.fill('#gAlU', '18'); await p.fill('#gAlL', '16');
  check(await p.isDisabled('#gGo'), '…still waiting for the attachment-template answer');
  await p.click('.pickRow[data-g=gAt] .pick[data-v=UL]');
  await p.screenshot({ path: OUT + '/v15-gate.png', clip: { x: 300, y: 0, width: 760, height: 520 } });
  check(!(await p.isDisabled('#gGo')), 'counts + an answer → Move is ready');
  await p.click('#gGo'); await p.waitForTimeout(300);
  let s = await st(rid);
  check(s.stage === 'fab' && s.alU === 18 && s.alL === 16 && s.aligners === 34 && s.at === 'UL', 'moved to Export STLs with U 18 · L 16 (34) and Upper & Lower templates');
  const alTxt = (await p.textContent('#alBox')).replace(/\s+/g, ' ');
  check(/34 aligners in this set \(U 18 · L 16\)/.test(alTxt) && /Attachment templates: Upper & Lower/.test(alTxt), 'the case shows 34 aligners (U 18 · L 16) and Attachment templates: Upper & Lower');
  await (await p.$('#alBox')).screenshot({ path: OUT + '/v15-albox.png' });
  // within fabrication: no question
  await p.click('#drawer .step[data-k=send]'); await p.waitForTimeout(250);
  check((await st(rid)).stage === 'send' && !(await p.isVisible('#modalWrap')), 'moving on inside fabrication doesn’t ask again');
  // labels: the attachment-template label starts ticked
  await p.click('#alBox [data-act=labels]'); await p.waitForSelector('#lb-list .lbRow');
  check(await p.isChecked('#lb-at') && /^20 labels/.test(await p.textContent('#lb-count')), 'labels: the attachment-template label starts ticked (box + AT + 18 stages = ' + (await p.textContent('#lb-count')).trim() + ')');
  await p.click('[data-act=closeModal]');
  // back to the start and forward again: asks again, filled in with what the case has
  await p.click('#drawer .step[data-k=txp]'); await p.waitForTimeout(250);
  await p.click('#drawer .step[data-k=print]'); await p.waitForSelector('#gAl');
  check(await p.inputValue('#gAlU') === '18' && await p.inputValue('#gAlL') === '16' && await p.getAttribute('.pickRow[data-g=gAt] .pick[data-v=UL]', 'aria-pressed') === 'true', 'jumping past Export STLs asks too, filled in with the case’s counts and answer');
  await p.click('#modalWrap [data-act=closeModal]'); await p.waitForTimeout(150);
  check((await st(rid)).stage === 'txp', 'Cancel leaves the stage alone');
  await p.evaluate(() => closeDrawer(true));

  // board arrow: Reset needed → TxP approved asks (the step before Export STLs since 3 Oct 2026); None is a valid answer
  const bid = await p.evaluate(rid => { const c = openCases().find(x => x.type === 'nla' && x.stage === 'txp' && x.id !== rid); return c.id; }, rid);
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=inhouse]'); await p.waitForSelector('.kc');
  await p.evaluate(id => { const c = findCase(id); c.stage = 'reset'; queueRender(); }, bid); await p.waitForTimeout(150);
  await p.click('.kc[data-id="' + bid + '"] .adv'); await p.waitForSelector('#gAl');
  check(await p.inputValue('#gAlU') !== '' && await p.textContent('#modalWrap h3') === 'TxP approved', 'board arrow from Reset needed asks too, for TxP approved (counts filled in from the case)');
  await p.click('.pickRow[data-g=gAt] .pick[data-v=none]'); await p.click('#gGo'); await p.waitForTimeout(300);
  s = await st(bid); check(s.stage === 'txpok' && s.at === 'none', '“None” is an answer: moved to TxP approved');

  // Edit form: moving the stage there needs the counts and the answer in the form
  const eid = await p.evaluate(rid => { const c = openCases().find(x => x.type === 'nla' && x.stage === 'txp' && x.id !== rid) || findCase(rid); c.atTemplates = ''; return c.id; }, rid);
  await p.evaluate(id => openDrawer(id), eid); await p.waitForSelector('#drawer [data-act=edit]');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stage', { state: 'attached' });
  await p.evaluate(() => { const s = document.querySelector('#drawer #cf-stage'); s.value = 'fab'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(250);
  check(/pick Attachment templates before moving it to Export STLs/.test(await p.textContent('#drawerNotice')), 'Edit: moving it to Export STLs without the answer is stopped with a note');
  await p.click('#drawer .pickRow[data-g=atTemplates] .pick[data-v=L]'); await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('.toast:has-text("Saved")');
  s = await st(eid); check(s.stage === 'fab' && s.at === 'L', 'Edit: with the answer it saves (Lower templates)');
  await p.evaluate(() => closeDrawer(true));

  // New case: the template answer is optional at the scan; the form shows it under the aligner counts
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(100);
  check(await p.isVisible('#ncForm .pickRow[data-g=atTemplates]'), 'New case (in-house): Attachment templates sits under the aligner counts');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); // (New case asks what an in-house set is, 3 Oct 2026)
  await p.fill('#cf-patient', 'Atlas Templeton'); await p.click('#ncSave'); await p.waitForSelector('.toast:has-text("Case created")');
  check(await p.evaluate(() => openCases().find(c => c.patient === 'Atlas Templeton').atTemplates === ''), 'a new case can be saved without answering yet');
  // other types aren't asked
  const oid = await p.evaluate(() => openCases().find(c => typeOf(c).flow === 'outside' && c.stage === 'submit').id);
  await p.evaluate(id => openDrawer(id), oid); await p.waitForSelector('#drawer .stepper'); await p.click('#drawer .step[data-k=mfg]'); await p.waitForTimeout(250);
  check(!(await p.isVisible('#gAl')) && (await st(oid)).stage === 'mfg', 'outside aligner cases move without the question');
  // export column
  check(await p.evaluate(id => caseToCSVRow(findCase(id)).endsWith('"Lower","Upper & lower","",""'), eid), 'export: Attachment templates column (then Arches treated)');
  // Titan: the web version and its beta, from every in-house case (opening one copies the name)
  const tid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla'); c.titanUrl = 'https://client.titandentaldesign.com/Live/index.html#case-demo'; return c.id; });
  await p.evaluate(id => openDrawer(id), tid); await p.waitForSelector('#drawer .portals');
  const links = await p.$$eval('#drawer .portals a', as => as.map(a => a.textContent.trim() + ' → ' + a.getAttribute('href')));
  console.log('   ' + links.join('\n   '));
  check(links.some(l => /^Open Titan \(web\) → https:\/\/client\.titandentaldesign\.com\/Live\/index\.html$/.test(l)) && links.some(l => /^Open Titan beta \(web\) → https:\/\/client\.titandentaldesign\.com\/EA\/index\.html$/.test(l)) && /^Open this case in Titan/.test(links[0]), 'in-house: Open this case in Titan (when saved), Open Titan (web), Open Titan beta (web)');
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await p.evaluate(() => { const a = document.querySelector('#drawer .portals a[href*="/Live/index.html"]:not([href*="#"])'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); });
  await p.waitForTimeout(300);
  check(await p.evaluate(id => window.__copied === findCase(id).patient, tid), 'opening Titan copies the patient’s name');
  const pr = await p.$('#drawer .portals'); await pr.screenshot({ path: OUT + '/v15-titan.png' });
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
