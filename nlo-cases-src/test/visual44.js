// Chart note: what the patient was told, for the scan visit and the delivery visit (Amir, 5 Oct 2026: "it's missing some
// information for refinement aligners, it should say instructed pt to stay in the last set night time only. no elastics with
// aligners etc. that instruction will be different if it's initial delivery, refinement, appliance delivery so on so forth").
// Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const REF_SCAN = 'Instructed pt to stay in the last set, night time only. No elastics with aligners.';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const open = async id => { await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .ds[data-ds=note]'); };
  const sum = () => p.textContent('#dsS-note');
  const note = () => p.textContent('#noteTxt');
  const lines = async () => (await note()).split('\n');
  const openNote = async () => { if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=note]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=note] .dsTg'); };
  const pressed = () => p.$$eval('#drawer .noteTabs button', bs => bs.map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' | '));
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  const copy = async () => { await p.evaluate(() => { window.__copied = null; }); await p.click('#drawer .ds[data-ds=note] [data-act=copyNote]'); await p.waitForFunction(() => window.__copied, null, { timeout: 3000 }).catch(() => {}); return p.evaluate(() => window.__copied); };
  const find = (fn, a) => p.evaluate(fn, a);

  console.log('\n# A refinement, at the scan (in-house, at Thermoforming)');
  const ref = await find(() => openCases().find(c => c.type === 'nla' && c.initial === 'no').id);
  await open(ref);
  check(/^Scan visit · to paste into the patient’s chart$/.test((await sum()).trim()), 'the folded heading says Copy copies the scan visit’s note (' + (await sum()).trim() + ')');
  let L = await lines();
  check(/^Scanned with Allied Star for in-house aligners \(NL Lab\) - refinement\.$/.test(L[0]) && L.includes(REF_SCAN), 'the scan note says what the patient was told: “' + REF_SCAN + '”');
  check(L.indexOf(REF_SCAN) > L.findIndex(l => /^Dr\. A's instructions/.test(l)), '… after Dr. A’s instructions, at the end of the visit’s note');
  let cp = await copy();
  check(cp === await note() && cp.includes(REF_SCAN) && /\(scan visit\)/.test(await p.textContent('.toast')), 'Copy copies it (the message says scan visit)');
  await openNote();
  check(await pressed() === 'Scan visit* | Delivery visit', 'inside: Scan visit | Delivery visit, the scan’s chosen');
  await p.screenshot({ path: OUT + '/v44-scan.png' });

  console.log('\n# The same case, at delivery');
  await p.click('#drawer .noteTabs [data-v=del]');
  L = await lines();
  check(L[0] === 'Delivered in-house aligners (NL Lab) - refinement: 10 upper and 8 lower aligners.' && L[1] === 'Pt back to full-time wear with the new aligners. Reviewed aligner wear and care.' && L.length === 2, 'Delivery visit: what went out (10 upper, 8 lower) and what the patient was told — ' + JSON.stringify(L));
  check(await pressed() === 'Scan visit | Delivery visit*' && /^Delivery visit ·/.test((await sum()).trim()), 'the switch and the folded heading follow');
  cp = await copy();
  await p.waitForSelector('.toast:has-text("(delivery visit)")', { timeout: 3000 }).catch(() => {});
  check(cp === await note() && /^Delivered /.test(cp) && await p.isVisible('.toast:has-text("(delivery visit)")'), 'Copy copies the delivery visit’s note');
  await p.screenshot({ path: OUT + '/v44-delivery.png' });
  await p.evaluate(() => closeDrawer()); await open(ref);
  check(/^Delivery visit/.test((await sum()).trim()), 'closing and opening the case again keeps the visit picked');
  await p.evaluate(id => S.noteVisit.delete(id), ref);

  console.log('\n# Other kinds of case');
  const first = await find(() => openCases().find(c => c.type === 'nla' && c.initial === 'yes' && c.stage === 'txp').id);
  await open(first);
  const fs = await find(id => chartNote(findCase(id), 'scan'), first), fd = await find(id => chartNote(findCase(id), 'del'), first);
  check(!/Instructed pt|Reviewed/.test(fs) && /^Delivered in-house aligners \(NL Lab\) - initial set: \d+ upper and \d+ lower aligners\.\nReviewed aligner wear and care with pt: wear full time/.test(fd) && /Use chewies/.test(fd), 'first set: nothing extra at the scan; at delivery, wear and care (chewies, the case)');
  const hb = await find(() => openCases().find(c => c.type === 'appliance' && (c.appliances || []).includes('Herbst')).id);
  check(/^Delivered Herbst \(Specialty Orthodontic Lab\)\.\nReviewed Herbst care with pt: soft foods for the first few days/.test(await find(id => chartNote(findCase(id), 'del'), hb)), 'Herbst delivery: soft foods, wax, call if anything comes loose');
  const rp = await find(() => openCases().find(c => c.type === 'appliance' && (c.appliances || []).includes('Schwartz')).id);
  const rpd = await find(id => chartNote(findCase(id), 'del'), rp);
  check(/turn the expander with the key/.test(rpd) && /turn the expansion screw with the key/.test(rpd) && rpd.split('\n').length === 3, 'RPE + Schwarz: a line for each appliance — ' + JSON.stringify(rpd.split('\n')[0]));
  const ret = await find(() => openCases().find(c => c.type === 'retainer' && c.stage === 'pickup').id);
  await open(ret);
  L = await lines();
  // (retainers are picked up at the front desk: their delivery is the pickup — 6 Oct 2026)
  check(/^Picked up/.test((await sum()).trim()) && L[0] === 'Pt picked up retainers and whitening trays (U/L).' && /^Reviewed retainer care/.test(L[1]) && /^Reviewed whitening tray use/.test(L[2]), 'retainers at Front desk pickup open on the pickup’s note: retainer care, then whitening trays (' + L[0] + ')');
  const mg = await find(() => openCases().find(c => c.type === 'mouthguard').id);
  check(/\nReviewed mouthguard use and care with pt/.test(await find(id => chartNote(findCase(id), 'del'), mg)), 'mouthguard delivery: use and care');
  const ship = await find(() => openCases().find(c => c.type === 'oliv' && c.shipToPatient).id);
  await open(ship); await openNote();
  check(await pressed() === 'Scan visit | Shipped to patient*' && (await note()) === 'Shipped Oliv aligners to the patient (UPS 1Z999AA10123456784).', 'shipped to the patient (at Shipped): that note, with the tracking number');
  const mdl = await find(() => openCases().find(c => c.type === 'models').id);
  await open(mdl);
  check(!(await p.$('#drawer .noteTabs')) && /^Scan visit/.test((await sum()).trim()) && /^Scanned for study models\.$/.test(await note()), 'study models: the scan’s note only, no switch');
  const mp = await find(() => openCases().find(c => c.type === 'marpe' && c.stage === 'approved').id);
  check(/^Delivered MARPE \(Partners Dental Solutions\)\.\nShowed pt how to turn the MARPE with the key\./.test(await find(id => chartNote(findCase(id), 'del'), mp)), 'MARPE delivery: how to turn it');
  const done = await find(() => { const c = openCases().find(x => x.type === 'mouthguard'); return { def: noteVisitDef(Object.assign({}, c, { status: 'done' })), today: noteVisitDef(Object.assign({}, c, { deliveryDate: todayISO() })), later: noteVisitDef(c) }; });
  check(done.def === 'del' && done.today === 'del' && done.later === 'scan', 'a completed case, or one whose delivery appt is today, opens on the delivery visit; earlier, the scan');

  console.log('\n# Dr. A words it in Team & security');
  await open(ref); await openNote();
  check(/Team & security → Chart note: Refinement/.test(await p.textContent('#drawer .noteFrom')), 'the note says where its wording comes from (owner)');
  await p.click('#drawer .noteFrom [data-act=niGo]'); await p.waitForSelector('#niCard');
  check(await p.evaluate(() => !document.querySelector('#drawer') && S.view === 'admin' && document.querySelector('#niRow-alR').open && document.activeElement.id === 'ni-alR-scan'), 'the link opens Team & security at Refinement, its scan box ready to type in');
  const card = await p.evaluate(() => ({ groups: Array.from(document.querySelectorAll('#niCard .niGrp')).map(h => h.firstChild.textContent.trim()), rows: document.querySelectorAll('#niCard .niRow').length,
    alR: document.querySelector('#niRow-alR summary').textContent, al1: document.querySelector('#niRow-al1 summary').textContent }));
  check(card.groups.join(',') === 'Aligners,Braces,Appliances,MARPE,Retainers & mouthguards' && card.rows === 20, 'a row for each kind of case, in 5 groups (' + card.rows + ')');
  check(/^RefinementScan Instructed pt to stay in the last set/.test(card.alR) && /Delivery Pt back to full-time wear/.test(card.alR) && /Scan nothing added/.test(card.al1), 'folded, a row shows both visits’ lines');
  await p.screenshot({ path: OUT + '/v44-settings.png' });
  const mine = REF_SCAN + ' Bring the last set to the next visit.';
  await p.fill('#ni-alR-scan', mine); await p.keyboard.press('Tab');
  await p.waitForFunction(m => (S.settings.noteInstr || {})['alR.scan'] === m, mine, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(250);
  check(await p.evaluate(m => S.settings.noteInstr['alR.scan'] === m, mine) && await p.isVisible('#niRow-alR .niOwn'), 'leaving the box saves it (“your wording”)');
  check(await p.evaluate(() => document.querySelector('#niRow-alR').open && document.activeElement.id === 'ni-alR-del'), 'the redraw after saving keeps the row open and the cursor in the next box');
  await p.fill('#ni-alR-del', ''); await p.keyboard.press('Tab');
  await p.waitForFunction(() => (S.settings.noteInstr || {})['alR.del'] === '', null, { timeout: 3000 }).catch(() => {});
  await p.waitForFunction(() => /Delivery nothing added/.test(document.querySelector('#niRow-alR summary').textContent), null, { timeout: 3000 }).catch(() => {});
  check(await p.evaluate(() => S.settings.noteInstr['alR.del'] === '' && /Delivery nothing added/.test(document.querySelector('#niRow-alR summary').textContent)), 'an emptied box: nothing added at that visit');
  await open(ref);
  check((await find(id => chartNote(findCase(id), 'scan'), ref)).includes(mine) && await find(id => chartNote(findCase(id), 'del'), ref) === 'Delivered in-house aligners (NL Lab) - refinement: 10 upper and 8 lower aligners.', 'the case’s notes use the new wording (and nothing at delivery)');
  // someone else rewords it while a case is open: the open note follows
  await openNote();
  await p.evaluate(() => B.saveSettings({ noteInstr: { 'alR.scan': 'Instructed pt to stay in the last set, night time only.' } }));
  await p.waitForTimeout(200);
  check((await lines()).includes('Instructed pt to stay in the last set, night time only.'), 'a change made elsewhere shows in an open case’s note right away');
  await p.evaluate(() => closeDrawer()); await p.click('#nav-admin'); await p.waitForSelector('#niRow-alR');
  if (!(await p.evaluate(() => document.querySelector('#niRow-alR').open))) await p.click('#niRow-alR summary');
  await p.click('#niRow-alR [data-act=niReset]');
  await p.waitForFunction(() => (S.settings.noteInstr || {})['alR.scan'] === null, null, { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(250);
  check(await p.evaluate(r => noteInstr('alR', 'scan') === r && /^Pt back to full-time wear/.test(noteInstr('alR', 'del')) && !document.querySelector('#niRow-alR .niOwn') && document.querySelector('#ni-alR-scan').value === r, REF_SCAN), 'Back to the suggested wording: both visits, and the tag goes');
  await p.click('#niRow-al1 summary'); await p.fill('#ni-al1-scan', ''); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  check(await p.evaluate(() => !('al1.scan' in (S.settings.noteInstr || {}))), 'leaving a box unchanged saves nothing');

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('#niRow-rpe').scrollIntoView()); if (!(await p.evaluate(() => document.querySelector('#niRow-rpe').open))) await p.click('#niRow-rpe summary');
  const ph = await p.evaluate(() => { const r = document.querySelector('#niRow-rpe').getBoundingClientRect(), t = document.querySelector('#ni-rpe-del').getBoundingClientRect();
    return { over: document.documentElement.scrollWidth - innerWidth, r: r.right, t: t.right, w: innerWidth }; });
  check(ph.over <= 0 && ph.r <= ph.w && ph.t <= ph.w, 'phone: the Chart note rows and their boxes fit, no sideways scrolling');
  await p.screenshot({ path: OUT + '/v44-phone-settings.png' });
  await open(ret); await openNote();
  const pt = await p.evaluate(() => { const g = document.querySelector('#drawer .noteTabs').getBoundingClientRect(), d = document.querySelector('#drawer'); return { r: g.right, w: d.getBoundingClientRect().right, over: d.querySelector('.dBd').scrollWidth - d.querySelector('.dBd').clientWidth }; });
  check(pt.r <= pt.w && pt.over <= 0, 'phone: the visit switch fits the case panel');
  await p.screenshot({ path: OUT + '/v44-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
