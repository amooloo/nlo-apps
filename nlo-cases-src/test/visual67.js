// Design now (22 Nov 2026): an in-house set's panel opens Virtual Tech with the patient after the # of the address
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' })).catch(() => chromium.launch());
  const errs = []; let fails = 0; const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  const decode = (url) => { const m = /#new=([A-Za-z0-9_-]+)$/.exec(url || ''); if (!m) return null; return JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); };
  await p.evaluate(() => { window.__opened = []; window.open = (u, n) => { window.__opened.push('open:' + n + ':' + u); return { focus() { }, location: { set href(v) { window.__opened.push(v); } } }; }; });
  // the wiring: the button in two in-house sets' panels opens the tab and sends it to Virtual Tech with that case
  const ids = await p.evaluate(() => openCases().filter(c => c.type === 'nla').slice(0, 2).map(c => c.id));
  for (const [i, id] of ids.entries()) {
    await p.evaluate(() => { window.__opened = []; });
    await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer [data-act=vtDesign]');
    await p.waitForFunction(id => { const c = findCase(id); return !c.chart || !!(S.iprCache || {})[IPR.norm(c.chart)]; }, id, { timeout: 4000 }).catch(() => { });      // (the IPR section's reading)
    check(await p.isVisible('#drawer [data-act=vtDesign]'), 'case ' + (i + 1) + ': Design now in the panel header');
    await p.click('#drawer [data-act=vtDesign]'); await p.waitForTimeout(2200);
    const op = await p.evaluate(() => window.__opened.slice());
    check(op[0] === 'open:nlo-vtech:', 'opens the nlo-vtech tab at the click (' + op[0] + ')');
    check(/^http:\/\/lab:8768\/#new=/.test(op[1] || ''), 'no Tailscale here: the lab PC by name, http://lab:8768/');
    const d = decode(op[1]); const c = await p.evaluate(id => { const c = findCase(id); return { patient: c.patient, id: c.id }; }, id);
    check(d && d.case === c.id && (d.first + ' ' + d.last).trim() === String(c.patient).trim(), 'that case: its id and the patient\'s name (' + (d && d.first) + ' ' + (d && d.last) + ')');
    const ch_ = await p.evaluate(id => findCase(id).chart || '', id);
    if (ch_) check(d && d.ipr && d.ipr.bt.upper.join() === 'UR1|UL1' && d.ipr.bt.lower.join() === 'LR1|LL1' && d.ipr.sp.upper['UR1|UL1'] === 0.3 && d.ipr.sp.lower['LL3|LL4'] === 0.2 && /^\d{4}-\d{2}-\d{2}$/.test(d.ipr.date),
      'the IPR Tracker\'s latest visit goes with it: its black triangles and spaces (' + JSON.stringify(d && d.ipr) + ')');
    await p.click('[data-act=closeDrawer] >> nth=0');
  }
  // the IPR Tracker's latest visit, read by the case's IPR section as its panel opens, goes with it (25 Nov 2026: the black triangles)
  const wc = await p.evaluate(() => (openCases().find(c => c.type === 'nla' && c.chart) || {}).id || null);
  check(!!wc, 'a demo in-house set with a chart # (' + wc + ')');
  if (wc) {
    await p.evaluate(() => { window.__opened = []; });
    await p.evaluate(id => openDrawer(id), wc); await p.waitForSelector('#drawer [data-act=vtDesign]');
    await p.waitForFunction(id => !!(S.iprCache || {})[IPR.norm(findCase(id).chart)], wc, { timeout: 5000 }).catch(() => { });
    await p.click('#drawer [data-act=vtDesign]'); await p.waitForTimeout(2200);
    const d = decode((await p.evaluate(() => window.__opened.slice()))[1]);
    check(d && d.ipr && d.ipr.bt.upper.join() === 'UR1|UL1' && d.ipr.bt.lower.join() === 'LR1|LL1' && d.ipr.sp.upper['UR1|UL1'] === 0.3 && d.ipr.sp.lower['LL3|LL4'] === 0.2 && /^\d{4}-\d{2}-\d{2}$/.test(d.ipr.date),
      'the IPR Tracker\'s latest visit goes with it: its date, black triangles and spaces (' + JSON.stringify(d && d.ipr) + ')');
    await p.click('[data-act=closeDrawer] >> nth=0');
  }
  // what goes in it, from a first set and a refinement made up for this
  const A = await p.evaluate(() => vtPayload({ id: 'x1', type: 'nla', patient: 'Jane Q Testcase', chart: '12-345', initial: 'yes', instructions: 'Close spaces\nLevel the curve; Class I canines', teeth: { UR2: ['missing'], UL6: ['implant'], LL4: ['nomove', 'crown'], LR1: ['noatt'], UL2: ['pontic'] }, teethNote: 'UR2 congenitally missing' }));
  console.log('     payload:', JSON.stringify(A));
  check(A.first === 'Jane' && A.middle === 'Q' && A.last === 'Testcase' && A.chart === '12-345' && A.kind === 'initial' && A.case === 'x1', 'name, middle initial, chart #, initial, the case id');
  check(A.goals === 'Close spaces\nLevel the curve\nClass I canines', "Dr. A's instructions one line each");
  check(JSON.stringify(A.teeth) === JSON.stringify({ UR2: ['missing'], UL2: ['pontic'], UL6: ['implant'], LR1: ['noatt'], LL4: ['crown', 'nomove'] }) && A.teethNote === 'UR2 congenitally missing', 'the tooth chart and its note as on file');
  check(!A.stage && A.n === undefined, 'a first set: no stage, no number');
  const B = await p.evaluate(() => vtPayload({ id: 'x2', type: 'nla', patient: 'Sam Testcase', chart: '99-1', initial: 'no', refN: 2, scanStU: 14, scanStL: 12 }));
  check(B.kind === 'refinement' && B.n === 2 && B.stage && B.stage.upper === 14 && B.stage.lower === 12, 'refinement 2, the stage at the scan 14 / 12');
  const C = await p.evaluate(() => vtPayload({ id: 'x3', type: 'nla', patient: 'Ann Testcase', initial: 'mid', scanStNone: true }));
  check(C.kind === 'refinement' && C.n === undefined && C.stage && C.stage.none === true, 'a mid-course correction: a refinement, its number left to Virtual Tech, not wearing aligners');
  const H = await p.evaluate(() => vtHash({ id: 'x4', type: 'nla', patient: 'José Müller', chart: '1', initial: 'yes' }));
  check(/^#new=[A-Za-z0-9_-]+$/.test(H) && decode('x' + H).first === 'José' && decode('x' + H).last === 'Müller', 'accents come through (' + H.slice(0, 30) + '…)');
  require('fs').writeFileSync('/tmp/eng/vt_link_sample.txt', await p.evaluate(() => vtHash({ id: 'demoX', type: 'nla', patient: 'Case B', chart: 'T-1', initial: 'no', refN: 3, instructions: 'Close spaces\nLevel the curve', teeth: { UR2: ['missing'], LL4: ['nomove'], LR1: ['noatt'] }, scanStU: 14, scanStL: 12 })));
  // the black triangles kept on the case (iprSnap) when this computer has no reading of its own (25 Nov 2026)
  const K = await p.evaluate(() => vtPayload({ id: 'x5', type: 'nla', patient: 'Bea Triangle', chart: '55-1', initial: 'no', refN: 1,
    iprSnap: { chart: IPR.norm('55-1'), date: '2026-11-20', d: { upperBT: { 'UR1|UL1': true, 'UL1|UL2': false }, lowerBT: {}, upperSpaces: { 'UR2|UR1': '0.3', 'UL2|UL3': '0.8' }, lowerSpaces: {}, upper: { 'UR1|UL1': '0.2' } } } }));
  check(K.ipr && K.ipr.date === '2026-11-20' && JSON.stringify(K.ipr.bt) === JSON.stringify({ upper: ['UR1|UL1'], lower: [] }) && JSON.stringify(K.ipr.sp) === JSON.stringify({ upper: { 'UL2|UL3': 0.8, 'UR2|UR1': 0.3 }, lower: {} }),
    'no reading on this computer: the one kept on the case - black triangles marked, spaces (' + JSON.stringify(K.ipr) + ')');
  const K0 = await p.evaluate(() => vtPayload({ id: 'x6', type: 'nla', patient: 'No Ipr', chart: '', initial: 'yes' }));
  check(K0.ipr === undefined, 'no chart #: no IPR Tracker reading sent');
  const F = await p.evaluate(() => vtPayload({ id: 'x3', type: 'nla', variant: 'finishing', patient: 'Pat Finish', chart: '9', initial: 'no', refN: 3, instructions: '' }));
  check(F.kind === 'finishing' && F.n === undefined, 'a finishing set: Virtual Tech\'s Finishing, no refinement number (' + F.kind + ')');
  // a completed set: no Design now
  const doneId = await p.evaluate(() => { const x = openCases().filter(c => c.type === 'nla')[2]; if (!x) return null; const c = findCase(x.id); c.status = 'done'; return c.id; });
  if (doneId) { await p.evaluate(id => openDrawer(id), doneId); await p.waitForTimeout(300); check(!(await p.isVisible('#drawer [data-act=vtDesign]')), 'a completed set: no Design now'); }
  const real = errs.filter(e => !/ERR_NAME_NOT_RESOLVED|lab\.tail00bd21\.ts\.net|Failed to load resource/.test(e));
  console.log('ERRORS:', real.length ? real.join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'all passed');
  await browser.close();
})();
