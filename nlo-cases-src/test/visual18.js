// Arches to treat (aligners, in-house, InSmile): Upper & lower / Upper only / Lower only — demo
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ta = sel => p.$$eval(sel + ' .pickRow[data-g=treatArch] .pick[aria-pressed=true]', b => b.map(x => x.dataset.v).join(','));
  const vis = sel => p.isVisible(sel);
  const atShown = root => p.$$eval(root + ' .pickRow[data-g=atTemplates] .pick', b => b.filter(x => x.offsetParent).map(x => x.dataset.v).join(','));
  const atOn = root => p.$$eval(root + ' .pickRow[data-g=atTemplates] .pick[aria-pressed=true]', b => b.map(x => x.dataset.v).join(','));

  // ---------- New case: outside aligners ----------
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  check(!(await vis('#ncForm .pickRow[data-g=treatArch]')), 'no arch question before a type is tapped');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(80);
  check(await vis('#ncForm .pickRow[data-g=treatArch]') && await ta('#ncForm') === 'UL', 'Oliv: “Arches to treat” shows, Upper & lower picked to start');
  check(await p.inputValue('#cf-detail') === 'Aligners (Oliv)', 'both arches: what’s being made unchanged (Aligners (Oliv))');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]');
  check(await ta('#ncForm') === 'U' && await p.inputValue('#cf-detail') === 'Aligners (Oliv, upper only)', 'Upper only → Aligners (Oliv, upper only)');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]');
  check(await ta('#ncForm') === 'U', 'tapping the chosen one again keeps it (always an answer)');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=L]'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]');
  check(await p.inputValue('#cf-detail') === 'Aligners (Oliv, lower only) – refinement', 'Lower only + refinement → Aligners (Oliv, lower only) – refinement');
  const secY = await p.evaluate(() => { const s = document.querySelector('#ncForm .pickRow[data-g=treatArch]').closest('.cfSec'); s.scrollIntoView({ block: 'start' }); return true; });
  await p.waitForTimeout(100);
  const sec = await p.$('#ncForm .pickRow[data-g=treatArch]'); const bb = await sec.boundingBox();
  await p.screenshot({ path: OUT + '/v18-form-oliv.png', clip: { x: Math.max(0, bb.x - 30), y: Math.max(0, bb.y - 60), width: 760, height: 200 } });
  // retainers have their own Arch question; appliances none
  await p.click('#ncForm .tt[data-tile=retainer]'); await p.waitForTimeout(80);
  check(!(await vis('#ncForm .pickRow[data-g=treatArch]')) && await vis('#ncForm .pickRow[data-g=arches]'), 'Retainers: their own Arch question, not this one');
  await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(80);
  check(!(await vis('#ncForm .pickRow[data-g=treatArch]')), 'Appliance: not asked');

  // ---------- InSmile ----------
  await p.click('#ncForm .tt[data-tile=insmile]'); await p.waitForTimeout(80);
  check(await vis('#ncForm .pickRow[data-g=treatArch]'), 'InSmile: asked too');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]'); await p.click('#ncForm .pickRow[data-g=initialDE] .pick[data-v=de2]');
  check(await p.inputValue('#cf-detail') === 'InSmile braces (upper only) – DE2', 'InSmile upper only, DE 2 → InSmile braces (upper only) – DE2');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=UL]');
  check(await p.inputValue('#cf-detail') === 'InSmile braces – DE2', 'back to both → InSmile braces – DE2');

  // ---------- In-house: one count, templates that fit ----------
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(80);
  check(await ta('#ncForm') === 'UL' && await vis('#cf-alU') && await vis('#cf-alL') && await atShown('#ncForm') === 'none,U,L,UL', 'In-house, both arches: upper and lower counts, all four template answers');
  await p.click('#ncForm .pickRow[data-g=atTemplates] .pick[data-v=UL]');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]'); await p.waitForTimeout(60);
  check(await vis('#cf-alU') && !(await vis('#cf-alL')) && await atShown('#ncForm') === 'none,U' && await atOn('#ncForm') === 'U', 'Upper only: just the upper count; templates None / Upper (Upper & Lower became Upper)');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=L]'); await p.waitForTimeout(60);
  check(!(await vis('#cf-alU')) && await vis('#cf-alL') && await atShown('#ncForm') === 'none,L' && await atOn('#ncForm') === '', 'Lower only: just the lower count; an Upper template answer is asked again');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=U]');
  await p.fill('#cf-alU', '20'); // the lower field is hidden; a stray value left in it isn't saved
  await p.evaluate(() => { const i = document.querySelector('#cf-alL'); i.value = '9'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#ncForm .pickRow[data-g=atTemplates] .pick[data-v=U]'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); // (refinement was picked on Oliv)
  check(await p.inputValue('#cf-detail') === 'Aligners (In-House, upper only)', 'detail: Aligners (In-House, upper only)');
  check(/^20 aligners|\b20\b/.test(await p.textContent('#cf-alTotal')), 'the set’s total counts the upper arch only (20)');
  const al = await p.$('#ncForm .pickRow[data-g=treatArch]'); await al.scrollIntoViewIfNeeded();
  const ab = await (await p.$('#ncForm .pickRow[data-g=treatArch]')).boundingBox();
  await p.screenshot({ path: OUT + '/v18-form-inhouse.png', clip: { x: Math.max(0, ab.x - 30), y: Math.max(0, ab.y - 60), width: 780, height: 470 } });
  await p.fill('#cf-patient', 'Ursula Upperton'); await p.click('#ncSave'); await p.waitForSelector('.toast:has-text("Case created")');
  const u = await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Ursula Upperton'); return { id: c.id, ta: c.treatArch, alU: c.alU, alL: c.alL, n: c.aligners, at: c.atTemplates, d: c.detail, stage: c.stage }; });
  check(u.ta === 'U' && u.alU === 20 && u.alL === '' && u.n === 20 && u.at === 'U' && u.d === 'Aligners (In-House, upper only)', 'saved: upper only, U 20 (no lower), 20 aligners, Upper templates (' + JSON.stringify(u) + ')');

  // ---------- the case ----------
  await p.evaluate(id => openDrawer(id), u.id); await p.waitForSelector('#drawer .stepper');
  check(await vis('#drawer .badge.t-arch:has-text("Upper arch only")'), 'the case shows an “Upper arch only” badge');
  check(/20 aligners in this set \(U 20 · upper arch only\)/.test((await p.textContent('#alBox')).replace(/\s+/g, ' ')), 'Aligners box: 20 aligners in this set (U 20 · upper arch only)');
  const note = await p.textContent('#noteTxt');
  check(/for in-house aligners \(NL Lab\) - initial set, upper arch only\.$/m.test(note), 'chart note: “…for in-house aligners (NL Lab) - initial set, upper arch only.”');
  console.log('   note: ' + note.split('\n')[0].replace(/Ursula Upperton/g, '…'));
  await (await p.$('#drawer .dHd')).screenshot({ path: OUT + '/v18-badge.png' }); // the case badges sit under the name (3 Oct 2026)
  // Export STLs: only the upper count, templates None / Upper
  await p.click('#drawer .step[data-k=fab]'); await p.waitForSelector('#gAl');
  check(await vis('#gAlU') && !(await p.$('#gAlL')) && (await p.locator('.pickRow[data-g=gAt] .pick').count()) === 2 && /upper arch only/.test(await p.textContent('#gAl')), 'Export STLs asks for the upper aligners only, templates None / Upper');
  check(await p.inputValue('#gAlU') === '20' && await p.getAttribute('.pickRow[data-g=gAt] .pick[data-v=U]', 'aria-pressed') === 'true' && !(await p.isDisabled('#gGo')), '…filled in with the case’s count and answer, ready to move');
  await p.screenshot({ path: OUT + '/v18-gate.png', clip: { x: 300, y: 0, width: 760, height: 460 } });
  await p.fill('#gAlU', '21'); await p.click('#gGo'); await p.waitForTimeout(300);
  const g = await p.evaluate(id => { const c = findCase(id); return { stage: c.stage, alU: c.alU, alL: c.alL, n: c.aligners }; }, u.id);
  check(g.stage === 'fab' && g.alU === 21 && g.alL === '' && g.n === 21, 'moved to Export STLs with U 21, no lower');
  // labels: upper only
  await p.click('#alBox [data-act=labels]'); await p.waitForSelector('#lb-list .lbRow');
  check(await p.isChecked('#lb-uOn') && !(await p.isChecked('#lb-lOn')) && /^23 labels/.test(await p.textContent('#lb-count')), 'labels: upper only (box + template + 21 stages = ' + (await p.textContent('#lb-count')).trim() + ')');
  await p.click('[data-act=closeModal]');
  check(await p.evaluate(id => caseToCSVRow(findCase(id)).endsWith('"Upper only"'), u.id), 'export: Arches treated column says Upper only');
  await p.evaluate(() => closeDrawer(true));

  // ---------- Edit: an older both-arches case switches to one arch ----------
  const oid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'oliv' && x.stage === 'mfg'); return c.id; });
  await p.evaluate(id => openDrawer(id), oid); await p.waitForSelector('#drawer [data-act=edit]');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=treatArch]');
  check(await ta('#drawer') === 'UL', 'Edit (older case): Upper & lower picked');
  await p.click('#drawer .pickRow[data-g=treatArch] .pick[data-v=L]');
  check(await p.inputValue('#drawer #cf-detail') === 'Aligners (Oliv, lower only)', 'Edit: a what’s-being-made line nobody typed follows the taps');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('.toast:has-text("Saved")');
  const e1 = await p.evaluate(id => { const c = findCase(id); return { ta: c.treatArch, d: c.detail }; }, oid);
  check(e1.ta === 'L' && e1.d === 'Aligners (Oliv, lower only)' && await vis('#drawer .badge.t-arch:has-text("Lower arch only")'), 'Edit saved: lower only, badge on the case');
  check(/changed .*arches to treat/.test(await p.textContent('#histBox')), 'history: “changed arches to treat …”');
  // a typed detail stays as typed
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-detail');
  await p.fill('#drawer #cf-detail', 'Lower 3-3 only, Oliv'); await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('#drawer .stepper');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .pickRow[data-g=treatArch]');
  await p.click('#drawer .pickRow[data-g=treatArch] .pick[data-v=UL]');
  check(await p.inputValue('#drawer #cf-detail') === 'Lower 3-3 only, Oliv', 'a typed what’s-being-made line is left alone');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(300);
  check(await p.evaluate(id => findCase(id).treatArch === '', oid) && !(await vis('#drawer .badge.t-arch')), 'back to Upper & lower: saved as both (no badge)');
  await p.evaluate(() => closeDrawer(true));

  // ---------- demo: the lists show it ----------
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=inhouse]'); await p.waitForSelector('.kc');
  check((await p.locator('.kc .dt:has-text("upper only")').count()) > 0, 'board: the in-house card reads “Aligners (In-House, upper only)”');
  // phone: the question fits
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#mnav-list'); await p.waitForTimeout(150);
  await p.evaluate(() => newCaseModal()); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=nla]');
  await p.click('#ncForm .pickRow[data-g=treatArch] .pick[data-v=L]'); await p.waitForTimeout(100);
  const fits = await p.evaluate(() => { const r = document.querySelector('#ncForm .pickRow[data-g=treatArch]').getBoundingClientRect(); return r.right <= window.innerWidth && document.documentElement.scrollWidth <= 390; });
  check(fits, 'phone: Arches to treat fits, no sideways scrolling');
  const ph = await p.$('#ncForm .pickRow[data-g=treatArch]'); await ph.scrollIntoViewIfNeeded(); const pb = await ph.boundingBox();
  await p.screenshot({ path: OUT + '/v18-phone.png', clip: { x: 0, y: Math.max(0, pb.y - 50), width: 390, height: 330 } });
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
