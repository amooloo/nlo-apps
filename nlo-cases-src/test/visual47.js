// Which refinement (Amir, 5 Oct 2026: "when you pick refinement, it should allow you to pick which number refinement. 1, 2, etc.")
// and what the case is at the top of its panel ("what case it is should be on the top of the card. 'Initial Next Level Aligners'").
// Demo, made-up patients.
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
  const refPressed = () => p.$$eval('#ncForm .pickRow[data-g=refN] .pick[aria-pressed=true]', bs => bs.map(b => b.dataset.v).join(','));
  const form = () => p.evaluate(() => { const o = readCaseForm(document.querySelector('#modalWrap')); return { initial: o.initial, refN: o.refN, detail: document.querySelector('#cf-detail').value, hint: document.querySelector('#cf-refNHint').textContent, shown: !document.querySelector('#cf-refNWrap').hidden }; });
  const pt = await p.evaluate(() => openCases().find(c => c.type === 'nla' && c.initial === 'no').patient);

  console.log('\n# New case: which refinement');
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]');
  check(!(await form()).shown, 'the numbers stay out of the way until “No — refinement” is picked');
  await p.fill('#cf-patient', pt);
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(150);
  let f = await form();
  check(f.shown && await refPressed() === '2' && f.refN === 2, 'refinement: “Which refinement?” 1–5 and Other; 2 is picked — this patient already has refinement 1 (' + pt + ')');
  check(f.hint === 'Refinement 1 is the latest on file for this patient.', 'it says what’s on file (' + f.hint + ')');
  check(f.detail === 'Aligners (In-House) – refinement 2', 'What’s being made follows (' + f.detail + ')');
  await p.screenshot({ path: OUT + '/v47-form.png' });
  await p.click('#ncForm .pickRow[data-g=refN] .pick[data-v="3"]');
  f = await form();
  check(await refPressed() === '3' && f.refN === 3 && /refinement 3$/.test(f.detail), 'tapping 3 makes it refinement 3');
  await p.fill('#cf-refNOther', '7'); await p.waitForTimeout(100);
  f = await form();
  check(await refPressed() === '' && f.refN === 7 && /refinement 7$/.test(f.detail), 'Other: 7 (the taps let go)');
  await p.click('#ncForm .pickRow[data-g=refN] .pick[data-v="2"]');
  f = await form();
  check(await p.inputValue('#cf-refNOther') === '' && f.refN === 2, 'a tap again clears Other');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(80);
  f = await form();
  check(!f.shown && f.refN === '' && f.detail === 'Aligners (In-House)', 'first set: the numbers hide and nothing is saved for them');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(80);
  check(await refPressed() === '2', 'back to refinement: still 2 (picked by hand)');
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const nid = await p.evaluate(n => { const cs = openCases().filter(c => c.patient === n && c.type === 'nla' && c.refN === 2); return cs.length ? cs[0].id : null; }, pt);
  check(!!nid, 'saved as refinement 2');

  console.log('\n# The case: what it is, at the top');
  await p.evaluate(id => openDrawer(id), nid); await p.waitForSelector('#drawer #dKind');
  const hd = await p.evaluate(() => { const k = document.querySelector('#dKind'), h = document.querySelector('#drawer .dHd h3'), cs = getComputedStyle(k);
    return { t: k.textContent, above: !!(k.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING), tt: cs.textTransform, sub: document.querySelector('#drawer .dHd .sub').textContent }; });
  check(hd.t === 'Refinement 2 Next Level Aligners' && hd.above && hd.tt === 'uppercase', 'at the top, above the name: “Refinement 2 Next Level Aligners” (' + hd.t + ')');
  check(!/Refinement 2/.test(hd.sub) && !/Aligners \(In-House\)/.test(hd.sub), 'the line under the name doesn’t repeat it (' + hd.sub + ')');
  await p.screenshot({ path: OUT + '/v47-title.png', clip: { x: 800, y: 0, width: 560, height: 260 } });
  check(/^Scanned with \S+ \S* ?for in-house aligners \(NL Lab\) - refinement 2\.|for in-house aligners \(NL Lab\) - refinement 2\./.test(await p.evaluate(id => chartNote(findCase(id)), nid)), 'the chart note: “… in-house aligners (NL Lab) - refinement 2.”');
  check(await p.evaluate(id => labelSetType(findCase(id)), nid) === 'Refinement #2', 'the aligner labels say Refinement #2');
  check(await p.evaluate(id => alignerSets(findCase(id), casePool()).map(s => s.l).join(','), nid) === 'Initial,Refinement 1,Refinement 2', 'the patient’s sets: Initial, Refinement 1, Refinement 2');
  await p.evaluate(() => closeDrawer());

  console.log('\n# Another patient, another company');
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.fill('#cf-patient', 'Brand New Patient');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(150);
  f = await form();
  check(await refPressed() === '1' && f.hint === 'No earlier refinement on file for this patient with Oliv.', 'nothing on file: 1, and it says so (' + f.hint + ')');
  await p.click('#modalWrap [data-act=closeModal]').catch(() => {}); await p.evaluate(() => { if (document.querySelector('#modalWrap')) closeModal(); });

  console.log('\n# Editing a refinement from before');
  const old = await p.evaluate(() => openCases().find(c => c.type === 'nla' && c.initial === 'no' && !c.refN).id);
  await p.evaluate(id => openDrawer(id), old); await p.waitForSelector('#drawer #dKind');
  check(await p.textContent('#dKind') === 'Refinement Next Level Aligners', 'without a number: “Refinement Next Level Aligners”');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-refNWrap');
  const ed = await p.evaluate(() => ({ shown: !document.querySelector('#cf-refNWrap').hidden, on: Array.from(document.querySelectorAll('#drawer .pickRow[data-g=refN] .pick[aria-pressed=true]')).map(b => b.dataset.v).join(','), hint: document.querySelector('#cf-refNHint').textContent }));
  check(ed.shown && ed.on === '' && ed.hint === 'Refinement 2 is the latest on file for this patient.', 'Edit shows the numbers with none picked (a saved case isn’t changed for you), and what else is on file (' + ed.hint + ')');
  await p.click('#drawer .pickRow[data-g=refN] .pick[data-v="1"]'); await p.click('[data-act=saveEdit]');
  await p.waitForSelector('#drawer #dKind', { timeout: 5000 });
  await p.waitForFunction(() => /Refinement 1/.test((document.querySelector('#dKind') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
  check(await p.textContent('#dKind') === 'Refinement 1 Next Level Aligners' && await p.evaluate(id => findCase(id).refN, old) === 1, 'picked 1 and saved: “Refinement 1 Next Level Aligners”');
  await p.evaluate(() => closeDrawer());

  console.log('\n# Titles for the other kinds');
  const titles = await p.evaluate(() => { const T = x => caseTitle(Object.assign({ type: 'oliv' }, x));
    return [T({ type: 'nla', initial: 'yes' }), T({ type: 'nla', variant: 'finishing' }), T({ type: 'nla', initial: 'mid' }), T({ type: 'oliv', initial: 'yes' }), T({ type: 'angel', initial: 'no', refN: 3 }), T({ type: 'invisalign', initial: 'yes' }),
      T({ type: 'insmile', initial: 'de2' }), T({ type: 'appliance', appliances: ['Rapid Palatal Expander (RPE)', 'Schwartz'] }), T({ type: 'retainer', retKinds: ['TT’s', 'WT’s'] }), T({ type: 'retainer', retKinds: ['WT’s'] }), T({ type: 'marpe' }), T({ type: 'mouthguard' }), T({ type: 'models' })]; });
  const want = ['Initial Next Level Aligners', 'Finishing Next Level Aligners', 'Mid-course Correction Next Level Aligners', 'Initial Oliv Aligners', 'Refinement 3 Angel Aligners', 'Initial Invisalign',
    'DE 2 InSmile Braces', 'Rapid Palatal Expander (RPE) + Schwartz', 'Retainers & Whitening Trays', 'Whitening Trays', 'MARPE', 'Mouthguard', 'Study Models'];
  check(JSON.stringify(titles) === JSON.stringify(want), 'each kind of case has its title (' + titles.join(' | ') + ')');

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(id => openDrawer(id), nid); await p.waitForSelector('#drawer #dKind');
  const ph = await p.evaluate(() => { const k = document.querySelector('#dKind').getBoundingClientRect(); return { r: k.right, w: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; });
  check(ph.r <= ph.w && ph.over <= 0, 'phone: the title fits');
  await p.screenshot({ path: OUT + '/v47-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
