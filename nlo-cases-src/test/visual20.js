// Finishing aligners: an answer under In-house ("Initial submission?"), not its own tile any more — demo
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
  const opts = root => p.$$eval(root + ' .pickRow[data-g=initial] .pick', bs => bs.filter(b => b.offsetParent).map(b => b.textContent.trim()));
  const on = root => p.$$eval(root + ' .pickRow[data-g=initial] .pick[aria-pressed=true]', bs => bs.map(b => b.dataset.v).join(','));

  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  check(!(await p.$('#ncForm .tt[data-tile=finishing]')), 'no Finishing aligners tile');
  check(/finishing/i.test(await p.textContent('#ncForm .tt[data-tile=nla]')), 'the In-house tile says it covers finishing (' + (await p.textContent('#ncForm .tt[data-tile=nla] span:last-child')).trim() + ')');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(60);
  check((await opts('#ncForm')).join(' | ') === 'Yes — first set | No — refinement | Mid-course correction', 'Oliv: Yes / No / Mid-course only');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(60);
  check((await opts('#ncForm')).join(' | ') === 'Yes — first set | No — refinement | Mid-course correction | Finishing aligners', 'In-house: Finishing aligners is the fourth answer');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=fin]');
  check(await p.inputValue('#cf-detail') === 'Finishing aligners' && await on('#ncForm') === 'fin', 'picking it: what’s being made reads Finishing aligners');
  const sec = await p.$('#ncForm .pickRow[data-g=initial]'); await sec.scrollIntoViewIfNeeded(); const b = await sec.boundingBox();
  await p.screenshot({ path: OUT + '/v20-inhouse-finishing.png', clip: { x: Math.max(0, b.x - 30), y: Math.max(0, b.y - 160), width: 820, height: 230 } });
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(60);
  check(await on('#ncForm') === '' && await p.inputValue('#cf-detail') === 'Aligners (Oliv)', 'switching to Oliv lets Finishing go');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=fin]');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]');
  check(await p.inputValue('#cf-detail') === 'Finishing aligners (upper only)', 'with Upper only: Finishing aligners (upper only)');
  await p.fill('#cf-patient', 'Fern Finchley'); await p.click('#ncSave'); await p.waitForSelector('.toast:has-text("Case created")');
  const c = await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Fern Finchley'); return { id: c.id, type: c.type, variant: c.variant, initial: c.initial, detail: c.detail, set: (alignerSets(c, casePool()).find(s => s.me) || {}).l }; });
  check(c.type === 'nla' && c.variant === 'finishing' && !c.initial && c.detail === 'Finishing aligners (upper only)' && c.set === 'Finishing', 'saved as before: in-house, finishing (set labeled Finishing) — ' + JSON.stringify(c));
  await p.evaluate(id => openDrawer(id), c.id); await p.waitForSelector('#drawer .stepper');
  check(/for finishing aligners \(NL Lab\), upper arch only\./.test(await p.textContent('#noteTxt')), 'chart note: finishing aligners (NL Lab), upper arch only');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=initial]');
  check(await p.getAttribute('#drawer .tt[data-tile=nla]', 'aria-checked') === 'true' && await on('#drawer') === 'fin', 'Edit: In-house picked, Finishing aligners picked');
  await p.click('#drawer .pickRow[data-g=initial] .pick[data-v=no]'); await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('.toast:has-text("Saved")');
  const e = await p.evaluate(id => { const c = findCase(id); return { variant: c.variant || '', initial: c.initial, detail: c.detail }; }, c.id);
  check(e.variant === '' && e.initial === 'no' && e.detail === 'Aligners (In-House, upper only) – refinement', 'Edit → refinement: no longer finishing — ' + JSON.stringify(e));
  // an older finishing case (made with the old tile) edits the same way
  const oid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla' && x.stage === 'txp'); c.variant = 'finishing'; c.initial = ''; c.detail = 'Finishing aligners'; return c.id; });
  await p.evaluate(id => openDrawer(id), oid); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=initial]');
  const diff = await p.evaluate(() => { const now = readCaseForm(document.querySelector('#drawer')); return ['initial', 'detail', 'treatArch'].filter(k => !sameVal(now[k], S.editBase[k])).concat((now.variant || '') !== (S.editBase.variant || '') ? ['variant'] : []); });
  check(await on('#drawer') === 'fin' && !diff.length, 'an older finishing case opens with Finishing picked; its type, submission and detail read back unchanged' + (diff.length ? ' (differs: ' + diff.join(', ') + ')' : ''));
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
