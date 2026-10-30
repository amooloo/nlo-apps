// Amir, 29 Oct 2026, with Specialty's invoice for a printed Hyrax RPE (10/20/26: Printed Hyrax RPE Click $109, 15% discount,
// 3D Print Bands 2 × $17.75, Printed Model With Appliance/Arch $17, Digital Return Shipping $16.50 — balance $161.65): "make sure
// ... it has all the fees" on the Rx; "the upper 6 tubes should be standard" on an RPE; the discount: "not sure so don't include it".
// 1. Every Specialty Rx adds the printed model (per arch with an appliance) and the return shipping once something is picked; the
//    Retainer Rx's Guardian and two-or-more-retainers models are free, IR Express has no model and its shipping included.
// 2. 3D printed bands are $17.75 each, as billed (the price list said $38).
// 3. An RPE (Hyrax, Haas, Exspider) starts with archwire tubes on the upper 6s; taken off by hand they stay off (also in a saved
//    usual); a usual saved before gets them. The warranty's half price is half the estimate, as it says. Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch, panelsOpen, stepsAsOnePage } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo'); stepsAsOnePage(p);
  await p.goto(URL); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await p.waitForTimeout(300);
  const near = (a, b) => Math.abs(a - b) < .001;
  const rxNow = () => p.evaluate(() => JSON.parse(JSON.stringify(RXE.rx)));
  const estOf = () => p.evaluate(() => { const e = rxEstimate(RXE.rx, RXE.c); return { total: Math.round(e.total * 100) / 100, common: e.common,
    lines: e.lines.map(l => l.l + (l.amt != null ? ' = ' + l.amt : ' · ' + l.inc)), missing: e.missing }; });
  const est = () => estOf().then(e => e.total);
  const tap = (g, v) => p.click('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]');
  const on = (g, v) => p.getAttribute('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]', 'aria-pressed').then(x => x === 'true');
  const closeAll = () => p.evaluate(() => { if (document.querySelector('#rxWrap')) rxReset(); closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  const newRpe = async name => {
    await closeAll(); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
    await p.click('#ncForm .tt[data-tile=appliance]'); await p.fill('#cf-patient', name);
    await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="Rapid Palatal Expander (RPE)"]');
    await p.click('#ncForm [data-rxform=edit][data-kind=met]'); await p.waitForSelector('#rxWrap .rxArch.live');
  };

  // ---- 1. a new RPE: the Hyrax on 3D printed bands, with the upper 6 tubes; the estimate has every fee the invoice had
  await newRpe('Rhea Tubewell');
  let st = await rxNow();
  check(JSON.stringify(st.exp) === '["hyrax"]' && st.printed3d === true && JSON.stringify(st.teeth) === '{"UR6":"band","UL6":"band"}' && JSON.stringify(st.awt) === '["U"]' && JSON.stringify(st.stdA) === '["U"]',
    'a new RPE: the Hyrax on 3D printed bands on the 6s, with archwire tubes on the upper 6s (put on by the rule)');
  check(await on('awt', 'U') && !(await on('awt', 'L')) && await p.evaluate(() => { const s = document.querySelector('#rxWrap .rxFold[data-fold=acc]'); return s.classList.contains('open') && !s.querySelector('.rxFoldBody').hidden; }),
    'Accessories opens by itself with Upper archwire tubes ticked');
  await p.click('#rxWrap .rxFold[data-fold=acc] .rxFoldB');
  check(/Archwire tubes/.test(await p.textContent('#rxWrap .rxFold[data-fold=acc] .rxFoldSum')), '… folded, its heading says “Archwire tubes”');
  await p.click('#rxWrap .rxFold[data-fold=acc] .rxFoldB');
  let e = await estOf();
  check(e.lines.join('|') === 'Hyrax RPE = 109|3D printed bands × 2 = 35.5|Archwire tubes · upper × 1 pr = 27.5|Printed model with the appliance · upper = 17|Return shipping = 16.5' && near(e.total, 205.5) && near(e.common, 33.5),
    'estimate: Hyrax $109 + 3D printed bands 2 × $17.75 + upper tubes $27.50 + printed model (upper) $17 + return shipping $16.50 = $205.50 — ' + e.lines.join(' | '));
  check(/\$205\.50/.test(await p.textContent('#rxTot')) && /\$17\.75 ea/.test(await p.textContent('#rxWrap .rxB[data-rxg=tool][data-v=band] em')),
    'the header says Est. $205.50; the band tool says $17.75 ea (3D printed, as Specialty bills it)');
  const costTxt = await p.textContent('#rxCost');
  check(/Printed model with the appliance · upper/.test(costTxt) && /Specialty prints it from the scan to build on/.test(costTxt) && /Return shipping/.test(costTxt) &&
    /The printed model and return shipping are what Specialty charges on a digital case\. A discount, when Specialty gives one, isn’t taken off\./.test(costTxt) && !/zone and weight/.test(costTxt),
    'the cost table lists the printed model and the return shipping, and says a discount isn’t taken off');

  // ---- 2. the tubes taken off by hand stay off; put back by hand they're the doctor's
  await tap('awt', 'U'); st = await rxNow();
  check(!st.awt && !st.stdA && JSON.stringify(st.awtNo) === '["U"]' && near(await est(), 178),
    'upper tubes taken off by hand: $178.00 — the invoice before its discount ($109 + $35.50 + $17 + $16.50)');
  await tap('exp', 'haas'); st = await rxNow();
  check(JSON.stringify(st.exp) === '["haas"]' && !st.awt && near(await est(), 215), 'switched to the Haas: the tubes stay off (taken off by hand) — $146 + $35.50 + $17 + $16.50 = $215.00');
  await tap('exp', 'haas'); await tap('exp', 'hyrax'); st = await rxNow();
  check(JSON.stringify(st.exp) === '["hyrax"]' && !st.awt && JSON.stringify(st.awtNo) === '["U"]', 'the expander off and the Hyrax picked again: still no tubes');
  await tap('awt', 'U'); st = await rxNow();
  check(JSON.stringify(st.awt) === '["U"]' && !st.stdA && !st.awtNo && near(await est(), 205.5), 'ticked again by hand: on, and the doctor’s (not the rule’s) — $205.50');
  await tap('exp', 'acrylic'); st = await rxNow();
  check(JSON.stringify(st.exp) === '["acrylic"]' && JSON.stringify(st.awt) === '["U"]', 'the Acrylic Bonded RPE (no bands): tubes put on by hand stay');
  await closeAll();

  // ---- 3. the rule's tubes come off with the RPE that put them on, and back with the next one
  await newRpe('Remy Tubewell');
  await tap('exp', 'acrylic'); st = await rxNow();
  check(JSON.stringify(st.exp) === '["acrylic"]' && !st.awt && !st.stdA && !st.teeth && near(await est(), 191),
    'Acrylic Bonded RPE: the rule’s bands and tubes come off (nothing to put them on) — $157.50 + model $17 + shipping $16.50 = $191.00');
  await tap('exp', 'exspider'); st = await rxNow();
  check(JSON.stringify(st.awt) === '["U"]' && JSON.stringify(st.stdA) === '["U"]', 'the Exspider: upper tubes back on (a banded RPE)');
  await tap('exp', 'hyrax'); await tap('exp', 'lowerFixed'); e = await estOf();
  check(e.lines.includes('Printed model with the appliance · upper & lower = 34') && e.lines.includes('3D printed bands × 4 = 71') && e.missing.includes('Lower Fixed Expander') && near(e.total, 258),
    'with a Lower Fixed Expander: printed models of both arches 2 × $17 (the lower expander itself isn’t on the list, named) — $258.00');
  await tap('exp', 'lowerFixed');
  check(near(await est(), 205.5), '… taken off: one model again, $205.50');
  await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Hyrax RPE · 2 bands \(3D printed\)/.test(await p.textContent('#cf-rxMetSum')) && /est\. \$205\.50/.test(await p.textContent('#cf-rxMetSum')), 'Done: New case says “Hyrax RPE · 2 bands (3D printed) · est. $205.50”');
  await p.screenshot({ path: OUT + '/v64-newcase.png' }).catch(() => { });
  await closeAll();

  // ---- 4. a saved usual: one from before gets the tubes (its teeth as saved); one with them taken off doesn't; the MSE never does
  const us = await p.evaluate(() => {
    const keep = S.settings.rxDefaults, out = {};
    const old = { form: RX_MET, exp: ['hyrax'], teeth: { UR6: 'band', UL6: 'band', UR4: 'band', UL4: 'band' }, stdB: ['UR6', 'UL6'], printed3d: true };
    S.settings.rxDefaults = JSON.stringify({ [RXM_US.rpe]: old }); out.old = rxmStartFor(RXM_US.rpe);
    S.settings.rxDefaults = JSON.stringify({ [RXM_US.rpe]: Object.assign({}, old, { awtNo: ['U'] }) }); out.no = rxmStartFor(RXM_US.rpe);
    S.settings.rxDefaults = keep; out.mse = rxmStartFor(RXM_US.mse); out.rpe = rxmStartFor(RXM_US.rpe);
    out.fix = rxmFormFix({ appliances: ['MSE'] }, out.rpe, RXM_US.rpe); out.back = rxmFormFix({ appliances: ['Rapid Palatal Expander (RPE)'] }, out.mse, RXM_US.mse);
    return JSON.parse(JSON.stringify(out));
  });
  check(JSON.stringify(us.old.awt) === '["U"]' && JSON.stringify(us.old.stdA) === '["U"]' && Object.keys(us.old.teeth).length === 4, 'a usual RPE saved before (no tubes): new Rx get the upper tubes, its 4 bands as saved');
  check(!us.no.awt && JSON.stringify(us.no.awtNo) === '["U"]', 'a usual saved with the tubes taken off: none');
  check(us.mse.mse === true && !us.mse.awt && us.fix && us.fix.mse === true && !us.fix.awt && us.back && JSON.stringify(us.back.awt) === '["U"]',
    'the MSE starts without tubes; an untouched RPE Rx switched to MSE starts again as the MSE (no tubes), and back to the RPE (tubes)');

  // ---- 5. the other forms: Herbst (both arches), retainers (free models, IR Express), the lower Schwarz (not on the price list)
  const f = await p.evaluate(() => {
    const E = rx => { const e = rxEstimate(rx, {}); return { t: Math.round(e.total * 100) / 100, c: e.common, l: e.lines.map(x => x.l + (x.amt != null ? ' = ' + x.amt : ' · ' + x.inc)), say: rxEstSay(e) }; };
    const sch = rxfStart({ type: 'appliance', lab: LAB_SPEC, appliances: ['Schwartz'], acrylic: 'Pink' });
    return { herbst: E({ form: RX_FORM, design: 'cantilever' }), hawley: E({ form: RX_RET, designU: 'hawley' }), two: E({ form: RX_RET, designU: 'hawley', irU: 'single' }),
      guard: E({ form: RX_RET, irU: 'g2', irL: 'g2' }), irx: E({ form: RX_RET, irU: 'express' }), irxH: E({ form: RX_RET, irU: 'express', designL: 'hawley' }), sch: E(sch), empty: E({ form: RX_MET }) };
  });
  check(f.herbst.l.join('|') === 'Cantilever Herbst = 220.5|Printed model with the appliance · upper & lower = 34|Return shipping = 16.5' && near(f.herbst.t, 271), 'Herbst: printed models of both arches + shipping — $271.00');
  check(f.hawley.l.includes('Printed model with the appliance · upper = 17') && f.hawley.l.includes('Return shipping = 16.5'), 'an upper Hawley: its model and the shipping — ' + f.hawley.l.join(' | '));
  check(f.two.l.includes('Printed model · upper · Free with two or more retainers on the arch') && !f.two.l.some(l => /^Printed model with/.test(l)), 'a Hawley and an invisible retainer on the upper: the model is free');
  check(f.guard.l.includes('Printed model · upper · With the Guardian') && f.guard.l.includes('Printed model · lower · With the Guardian') && f.guard.l.includes('Return shipping = 16.5'), 'Guardian on both arches: models with it, shipping charged');
  check(near(f.irx.t, 29) && f.irx.l.includes('Return shipping · Included with IR Express') && !f.irx.l.some(l => /Printed model/.test(l)), 'IR Express alone: no printed model, shipping included — $29.00');
  check(f.irxH.l.includes('Printed model with the appliance · lower = 17') && f.irxH.l.includes('Return shipping = 16.5'), 'IR Express with a lower Hawley: the Hawley’s model and the shipping');
  check(f.sch.say === ' · <span class="muted">not on the price list yet</span>' && f.sch.l.includes('Printed model with the appliance · lower = 17') && near(f.sch.c, 33.5),
    'the lower Schwarz (not on the price list): still “not on the price list yet”, with its model and shipping in the table');
  check(f.empty.l.length === 0 && f.empty.t === 0 && f.empty.say === '', 'nothing picked yet: no model, no shipping, no estimate');

  // ---- 6. the warranty's half price is half the Rx estimate it shows (now with the model and shipping); Dr. A's prices for the new fees
  const w = await p.evaluate(() => wtyHalf({ type: 'appliance', lab: LAB_SPEC, appliances: ['Rapid Palatal Expander (RPE)'], rxMet: rxmStartFor(RXM_US.rpe) }));
  check(near(w, 102.75), 'a remake at half price: half the Rx estimate, $205.50 / 2 = $102.75');
  const adm = await p.evaluate(() => rxAdminCardHTML());
  check(/data-rxprice="model" value="17\.00"/.test(adm) && /data-rxprice="retShip" value="16\.50"/.test(adm) && /data-rxprice="band3d" value="17\.75"/.test(adm) && /from Specialty’s invoice of 10\/20\/26/.test(adm),
    'Team & security → Lab Rx: printed model $17.00 and return shipping $16.50 under Every form, 3D print bands $17.75, where they come from');
  const ov = await p.evaluate(() => {
    const keep = S.settings.rxPrices, rx = rxmStartFor(RXM_US.rpe), out = {};
    S.settings.rxPrices = JSON.stringify({ model: 20 }); let e = rxEstimate(rx, {}); out.a = { t: e.total, l: e.lines.find(l => /Printed model/.test(l.l)) };
    S.settings.rxPrices = JSON.stringify({ model: '', retShip: '' }); e = rxEstimate(rx, {}); out.b = { t: e.total, m: e.missing };
    S.settings.rxPrices = keep; return JSON.parse(JSON.stringify(out));
  });
  check(near(ov.a.t, 208.5) && /list \$17\.00/.test(ov.a.l.note), 'Dr. A’s own model price ($20): the estimate uses it, “(list $17.00)”');
  check(near(ov.b.t, 172) && ov.b.m.join('|') === 'Printed model with the appliance · upper|Return shipping', 'both blanked: named under the estimate, not added');

  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
