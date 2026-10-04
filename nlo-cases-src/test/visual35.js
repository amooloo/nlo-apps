// Amir, 4 Oct 2026: "Next lets use this" — Specialty's Metal Rx (MKT-6, Rev 10-25) the way the Herbst and Retainer Rx work
// (visual32, visual33), for RPE and MSE cases and a new "Other metal appliance" (Amir: "RPE, MSE + one new choice"); RPE cases go to
// Specialty now (Amir: "Switch to Specialty"); "all of our expanders except Herbst and MARA will have 3D printed bands" — demo
// (made-up patients)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const has = cmd => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, acceptDownloads: true }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rxm-'));
  const today = await p.evaluate(() => todayISO());
  const rxNow = () => p.evaluate(() => JSON.parse(JSON.stringify(RXE.rx)));
  const estOf = () => p.evaluate(() => { const e = rxEstimate(RXE.rx, RXE.c); return { total: Math.round(e.total * 100) / 100, lines: e.lines.map(l => l.l + (l.amt != null ? ' = ' + l.amt : ' · ' + l.inc) + (l.note ? ' (' + l.note + ')' : '')), missing: e.missing }; });
  const est = () => estOf().then(e => e.total);
  const tap = (g, v) => p.click('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]');
  const on = (g, v) => p.getAttribute('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]', 'aria-pressed').then(x => x === 'true');
  const tool = k => p.click('#rxWrap [data-rxtool=' + k + ']');
  const tooth = id => p.click('#rxArchBox .rxTooth[data-rxt=' + id + ']');
  const shown = sel => p.isVisible(sel);
  const toastHas = re => p.evaluate(src => Array.from(document.querySelectorAll('.toast')).some(t => new RegExp(src).test(t.textContent)), re.source);
  const clearToasts = () => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const closeAll = () => p.evaluate(() => { if (document.querySelector('#rxWrap')) rxReset(); closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  const newAppliance = async () => { await closeAll(); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(80); };
  const pick = (g, v) => p.click('#ncForm .pickRow[data-g=' + g + '] .pick[data-v="' + v + '"]');
  const labNow = () => p.evaluate(() => pressed(document.querySelector('.modal'), 'lab')[0] || '');
  const metShown = () => p.isVisible('#ncForm #cf-rxMetSec');
  const openRx = async () => { await p.click('#ncForm [data-rxform=edit][data-kind=met]'); await p.waitForSelector('#rxWrap .rxArch.live'); };
  const done = async () => { await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' }); };
  const pdfText = file => has('pdftotext') ? execFileSync('pdftotext', ['-layout', file, '-']).toString() : null;
  const near = (a, b) => Math.abs(a - b) < .001;
  const fold = g => p.evaluate(g => { const s = document.querySelector('#rxWrap .rxFold[data-fold=' + g + ']'), b = s.querySelector('.rxFoldB'), body = s.querySelector('.rxFoldBody'), cb = s.querySelector('.rxCmpBtn');
    return { open: b.getAttribute('aria-expanded') === 'true' && s.classList.contains('open'), shown: !body.hidden && body.getBoundingClientRect().height > 0, cmp: !!cb && !cb.hidden, sum: s.querySelector('.rxFoldSum').textContent }; }, g);
  const unfold = g => p.click('#rxWrap .rxFold[data-fold=' + g + '] .rxFoldB');
  const tag = (g, v) => p.textContent('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"] em');
  const settled = sel => p.evaluate(sel => new Promise(res => { let el = document.querySelector(sel), t = Date.now(); const t0 = t;
    const iv = setInterval(() => { const now = document.querySelector(sel); if (now !== el) { el = now; t = Date.now(); } else if (Date.now() - t > 400 || Date.now() - t0 > 5000) { clearInterval(iv); res(); } }, 40); }), sel);

  // ---- routing: RPE, MSE and Other metal appliance go to Specialty, with the Metal Rx right away
  await newAppliance();
  check(await p.isVisible('#ncForm .pickRow[data-g=appliances] .pick[data-v="Other metal appliance"]'), 'a new appliance choice: “Other metal appliance”');
  await pick('appliances', 'Rapid Palatal Expander (RPE)');
  check(await labNow() === 'Specialty Orthodontic Lab' && await metShown() && !(await shown('#cf-rxHint')) && !(await shown('#ncForm #cf-rxSec')) && !(await shown('#ncForm #cf-rxRetSec')),
    'RPE → Specialty (Amir: “Switch to Specialty”): the Metal Rx shows right away (not the Herbst or Retainer Rx)');
  check(/Metal Rx/.test(await p.textContent('#cf-rxMetSec')) && /Fill out the Rx/.test(await p.textContent('#cf-rxMetSec')) && await p.evaluate(() => { const i = document.querySelector('#cf-rxMetSec img[data-logo]'); return !!i && i.complete && i.naturalWidth > 0; }), '… “Metal Rx · Fill out the Rx”, with Specialty’s logo');
  await pick('lab', 'Partners Dental Solutions');
  check(!(await metShown()) && /Going to Specialty instead\? Tap Specialty Orthodontic Lab and its Metal Rx fills in from this case/.test(await p.textContent('#cf-rxHint')), 'tapped over to Partners: no Metal Rx, one line that it’s there for Specialty');
  await pick('lab', 'Specialty Orthodontic Lab');
  await pick('appliances', 'MSE');
  check(await labNow() === 'Specialty Orthodontic Lab' && await metShown() && await p.evaluate(() => pressed(document.querySelector('.modal'), 'appliances').join()) === 'MSE', 'MSE (switched from RPE: one per case) → Specialty, the Metal Rx');
  await pick('appliances', 'MSE'); await p.evaluate(() => { const r = document.querySelector('#ncForm .pickRow[data-g=lab]'); r.dataset.manual = ''; });
  await pick('appliances', 'Other metal appliance');
  check(await labNow() === 'Specialty Orthodontic Lab' && await metShown() && await p.inputValue('#ncForm #cf-detail') === 'Other metal appliance', 'Other metal appliance → Specialty, the Metal Rx; the detail reads “Other metal appliance” until the Rx says what it is');
  await pick('appliances', 'Herbst');
  check(await shown('#ncForm #cf-rxSec') && await metShown(), 'a Herbst and an other metal appliance on one case: the Herbst Rx and the Metal Rx both show (it goes with anything)');
  await pick('lab', 'Partners Dental Solutions');
  check(/its Herbst Rx and Metal Rx fill in from this case/.test(await p.textContent('#cf-rxHint')), '… both at Partners: “its Herbst Rx and Metal Rx fill in”');
  await pick('lab', 'Specialty Orthodontic Lab'); await pick('appliances', 'Herbst'); await pick('appliances', 'Hawley retainers');
  check(await shown('#ncForm #cf-rxRetSec') && await metShown(), 'Hawley retainers with it: the Retainer Rx and the Metal Rx');
  await closeAll();

  // ---- RPE ↔ MSE: an Rx still as it started follows the switch; one that was changed stays and says it doesn't match
  const formRx = () => p.inputValue('#ncForm #cf-rxMet').then(v => v ? JSON.parse(v) : null);
  await newAppliance(); await pick('appliances', 'Rapid Palatal Expander (RPE)'); await openRx(); await done();
  check(JSON.stringify((await formRx()).exp) === '["hyrax"]', 'an RPE’s Rx, Done as it started: a Hyrax');
  await pick('appliances', 'MSE'); let fr = await formRx();
  check(fr.mse === true && fr.mseMm === '10' && !fr.exp && /MSE 10 mm/.test(await p.textContent('#cf-rxMetSum')) && !(await shown('#cf-rxMetWarn')), 'switched to MSE: the untouched Rx starts again as the MSE (10 mm)');
  await pick('appliances', 'Rapid Palatal Expander (RPE)'); fr = await formRx();
  check(JSON.stringify(fr.exp) === '["hyrax"]' && !fr.mse, '… and back to RPE: the Hyrax again');
  await openRx(); await unfold('acc'); await tap('awt', 'U'); await done();
  await pick('appliances', 'MSE'); fr = await formRx();
  check(JSON.stringify(fr.exp) === '["hyrax"]' && await shown('#cf-rxMetWarn') && /This Metal Rx is for a Hyrax RPE, but the case is an MSE — edit the Rx\./.test(await p.textContent('#cf-rxMetWarn')),
    'a changed Rx (tubes added) stays when the case switches to MSE, and says it doesn’t match');
  await openRx(); await tap('flag', 'mse'); await done();
  check(!(await shown('#cf-rxMetWarn')), '… the MSE picked in it: the line goes');
  await closeAll();
  // a choice made in the Rx is kept (and flagged), never undone; an Rx without what the case is says so
  await newAppliance(); await pick('appliances', 'Rapid Palatal Expander (RPE)'); await openRx(); await tap('flag', 'mse'); await done(); fr = await formRx();
  check(fr.mse === true && !fr.exp && /This Metal Rx is for the MSE, but the case is an RPE — edit the Rx\./.test(await p.textContent('#cf-rxMetWarn')) && await shown('#cf-rxMetWarn'),
    'an RPE case whose Rx was switched to the MSE in the editor: kept as the MSE (not put back), and it says the case is an RPE');
  await openRx(); await tap('exp', 'hyrax'); await tap('exp', 'hyrax'); await done();
  check(/No RPE on this Metal Rx yet/.test(await p.textContent('#cf-rxMetWarn')), 'an RPE case’s Rx with no expander: “No RPE on this Metal Rx yet”');
  await pick('appliances', 'Rapid Palatal Expander (RPE)'); await pick('appliances', 'Other metal appliance');
  check(/No appliance picked on this Metal Rx yet/.test(await p.textContent('#cf-rxMetWarn')), 'an other metal appliance whose Rx has no appliance: “No appliance picked on this Metal Rx yet”');
  await openRx(); await unfold('hold'); await tap('hold', 'tpa'); await done();
  check(!(await shown('#cf-rxMetWarn')), '… a TPA picked: no line');
  await pick('appliances', 'Rapid Palatal Expander (RPE)');
  check(/No RPE on this Metal Rx yet/.test(await p.textContent('#cf-rxMetWarn')) && await p.inputValue('#ncForm #cf-detail') === 'Rapid Palatal Expander (RPE), Transpalatal Arch', 'RPE added to it: “No RPE on this Metal Rx yet” (the detail reads “Rapid Palatal Expander (RPE), Transpalatal Arch”)');
  await closeAll();

  // ---- an RPE: the Metal Rx starts as Specialty's standard Hyrax on 3D printed first-molar bands
  await newAppliance(); await pick('appliances', 'Rapid Palatal Expander (RPE)');
  await p.fill('#ncForm #cf-patient', 'Mona Expanderson');
  const deliv = await p.evaluate(() => addDays(todayISO(), 30)); await p.fill('#ncForm #cf-deliveryDate', deliv);
  await openRx();
  check(/Metal Rx/i.test(await p.textContent('#rxWrap #rxTitle')) && /Mona Expanderson/.test(await p.textContent('#rxWrap .rxHd')), 'the Metal Rx opens with the patient’s name');
  let st = await rxNow();
  check(JSON.stringify(st.exp) === '["hyrax"]' && JSON.stringify(st.teeth) === '{"UR6":"band","UL6":"band"}' && st.printed3d === true && await on('exp', 'hyrax') && await on('flag', 'printed3d'),
    'it starts as a Hyrax RPE on the first molars, 3D printed (Amir: “our expanders … will have 3D printed bands”)');
  check(near(await est(), 185) && /\$185\.00/.test(await p.textContent('#rxTot')), 'estimate: Hyrax $109 + 2 × 3D printed bands $38 = $185.00');
  check(await tag('tool', 'band') === '$38.00 ea' && await tag('tool', 'crown') === '$43.50 ea' && await tag('exp', 'deluke') === 'not on list' && await tag('flag', 'mse') === '$489.50', 'the prices on the choices: 3D printed band $38.00 ea, crown $43.50 ea; DeLuke not on the list; the MSE $489.50');
  check(await p.inputValue('#rxWrap [data-rxf=needed]') === await p.evaluate(d => prevClinicDay(d), deliv) && !(await shown('#rxLead')), 'date needed: the office day before the delivery appt');
  const dfl = await Promise.all(['dist', 'hold', 'other', 'acc'].map(fold));
  check(dfl.every(f => !f.open && !f.shown && !f.sum), 'Distalization, Holding, Other appliances and Accessories start folded (nothing in them)');
  // one upper expander at a time; the MSE is one too
  await tap('exp', 'haas'); st = await rxNow();
  check(JSON.stringify(st.exp) === '["haas"]' && !(await on('exp', 'hyrax')) && near(await est(), 222), 'Haas: the Hyrax comes off (one upper expander), $146 + $76 = $222.00');
  await tap('flag', 'mse'); st = await rxNow();
  check(st.mse === true && st.mseMm === '10' && !st.exp && await on('mseMm', '10') && await shown('#rxWrap .rxSub[data-show=mse]') && near(await est(), 565.5), 'MSE: the Haas comes off, 10 mm to start; the list’s MSE RPE TAD $489.50 + $76 = $565.50');
  check(/MSE expander \(TADs placed after delivery\), 10 mm screw\./.test(await p.textContent('#rxAutoNotes')), '… the special instructions say so (there’s no circle for the MSE on the form)');
  await tap('mseMm', '12'); check((await rxNow()).mseMm === '12', '12 mm');
  await p.fill('#rxWrap [data-rxf=screw]', 'Click'); await p.press('#rxWrap [data-rxf=screw]', 'Tab');
  const fillMse = await p.evaluate(() => rxFill(RXE.c, RXE.rx).txt.map(t => t.s));
  check(fillMse.includes('MSE 12 mm, Click'), 'the Screw Type blank: “MSE 12 mm, Click”');
  await tap('exp', 'hyrax'); st = await rxNow();
  check(JSON.stringify(st.exp) === '["hyrax"]' && !st.mse && !st.mseMm && !(await shown('#rxWrap .rxSub[data-show=mse]')) && near(await est(), 185), 'Hyrax again: the MSE comes off');
  await p.fill('#rxWrap [data-rxf=screw]', ''); await p.press('#rxWrap [data-rxf=screw]', 'Tab');
  // 3D printed or not
  await tap('flag', 'printed3d');
  check(near(await est(), 144.5) && await tag('tool', 'band') === '$17.75 ea' && /Bands provided and fit × 2/.test((await estOf()).lines.join('|')), '3D printed off: bands provided and fit, 2 × $17.75 ($144.50); the band price on the tool follows');
  await tap('flag', 'printed3d'); check(near(await est(), 185) && await tag('tool', 'band') === '$38.00 ea', '… on again: $185.00');
  await tap('flag', 'enclosed'); st = await rxNow();
  check(st.enclosed === true && !st.printed3d && near(await est(), 109) && (await estOf()).lines.some(l => /Bands \/ crowns enclosed with the case · No charge/.test(l)), 'Bands enclosed with the case: 3D printed comes off (the office sends them); no charge → $109.00');
  check(await p.evaluate(() => { const b = rxFill(RXE.c, RXE.rx).box; return b.includes('enclosed') && !b.includes('printed3d') && !b.includes('provides'); }), '… on the form: only “Bands or Crowns enclosed with case”');
  await tap('flag', 'printed3d'); st = await rxNow();
  check(st.printed3d === true && !st.enclosed && near(await est(), 185), '3D printed again: enclosed comes off ($185.00)');
  // the lower fixed expander goes with it, on its own standard bands
  await tap('exp', 'lowerFixed'); st = await rxNow(); let e = await estOf();
  check(JSON.stringify(st.exp) === '["hyrax","lowerFixed"]' && st.teeth.LR6 === 'band' && st.teeth.LL6 === 'band' && near(e.total, 261) && e.missing.includes('Lower Fixed Expander') && /not listed/.test(await p.textContent('#rxTot')),
    'Lower Fixed Expander with it: bands on the lower first molars (4 × $38 → $261.00); the expander isn’t on the list, so it’s named, not added');
  await tap('exp', 'lowerFixed'); st = await rxNow();
  check(!st.teeth.LR6 && !st.teeth.LL6 && near(await est(), 185), '… taken off: its bands come off with it');
  // teeth: tools
  await tool('band'); await tooth('UR4'); await tooth('UL4');
  check((await rxNow()).teeth.UR4 === 'band' && near(await est(), 261) && /Bands:<\/b> UR6, UR4, UL4, UL6/.test(await p.innerHTML('#rxTeethSum')), 'a 4-band RPE: bands on UR4 and UL4 too ($261.00)');
  await tooth('UR4'); await tooth('UL4');
  await tool('crown'); await tooth('UR6');
  check((await rxNow()).teeth.UR6 === 'crown' && near(await est(), 190.5), 'Crown on UR6: 3D printed crown $43.50 (→ $190.50)');
  await tool('band'); await tooth('UR6'); check((await rxNow()).teeth.UR6 === 'band' && near(await est(), 185), '… back to a band');
  await clearToasts(); await tooth('UR2');
  check(await toastHas(/4s to 7s/), 'a front tooth: Specialty’s chart is 4s to 7s, it says so');
  // accessories
  await unfold('acc'); await tap('awt', 'U');
  check(near(await est(), 212.5) && /Archwire tubes · upper × 1 pr/.test((await estOf()).lines.join('|')), 'archwire tubes, upper: $27.50 a pair (→ $212.50)');
  await tap('acc', 'fm');
  check(await shown('#rxWrap [data-rxf=fmTxt]') && (await estOf()).missing.includes('Facemask hooks'), 'Facemask Hooks: its “where” shows; not on the list, so named');
  await p.fill('#rxWrap [data-rxf=fmTxt]', 'at the canines'); await p.press('#rxWrap [data-rxf=fmTxt]', 'Tab');
  check((await rxNow()).fmTxt === 'at the canines', '… where: at the canines');
  await tap('acc', 'fm'); st = await rxNow();
  check(!(st.acc || []).includes('fm') && !st.fmTxt && !(await shown('#rxWrap [data-rxf=fmTxt]')), '… taken off: the hooks and their “where” both go');
  // what each option is
  const card = g => p.evaluate(g => { const c = document.querySelector('#rxWrap .rxInfoCard[data-info=' + g + ']'), o = c.querySelector('.rxIc.on') || c; return { name: (o.querySelector('.rxIcHd b') || {}).textContent || '', peek: c.classList.contains('peek'), text: o.textContent, links: o.querySelectorAll('.rxIcSrc a[target=_blank]').length, h: c.getBoundingClientRect().height }; }, g);
  let cd = await card('exp');
  check(cd.name === 'Hyrax RPE' && /no palatal acrylic/.test(cd.text) && cd.links >= 1, 'the Hyrax is explained under the expanders (Specialty’s page linked)');
  const h0 = cd.h; await p.hover('#rxWrap .rxB[data-rxg=flag][data-v=mse]'); cd = await card('exp');
  check(cd.name === 'MSE (TAD-supported)' && cd.peek && /TADs are placed/.test(cd.text) && cd.h === h0, 'pointing at the MSE shows it (TADs placed after delivery), the card keeping its height');
  await p.hover('#rxWrap .rxB[data-rxg=exp][data-v=acrylic]'); cd = await card('exp');
  check(cd.name === 'Acrylic Bonded RPE' && /Specialty has no page for it/.test(cd.text), 'the Acrylic Bonded RPE: Specialty has no page, so the card says whose description it is');
  await p.hover('#rxArchBox'); cd = await card('exp'); check(cd.name === 'Hyrax RPE' && !cd.peek, '… moving away goes back to the picked expander');
  check(await p.evaluate(() => ['exp', 'dist', 'hold', 'other', 'acc'].every(g => RXK[RX_MET].infoKeys(g).every(k => RXM_INFO[g][k] && RXM_INFO[g][k].sum && (RXM_INFO[g][k].src || []).every(x => RXM_SRC[x])) && (RXK[RX_MET].cmpKeys(g) || []).every(k => RXM_INFO[g][k].short))),
    'every option on the form has its explanation, its sources and (where compared) a one-line summary');
  await p.click('#rxWrap [data-rxa=cmp][data-g=exp]');
  const cmp = await p.evaluate(() => Array.from(document.querySelectorAll('#rxWrap .rxCmpBox[data-cmp=exp] .rxCmpRow')).map(r => r.querySelector('b').textContent + '|' + r.querySelector('em').textContent));
  check(cmp.length === 10 && cmp[0] === 'Hyrax RPE|$109.00' && cmp[3] === 'DeLuke Contoured RPE|not on list' && cmp[9] === 'MSE (TAD-supported)|$489.50', 'Compare all: the 9 expanders and the MSE side by side with their prices');
  await p.click('#rxWrap [data-rxa=cmp][data-g=exp]');
  // drawing
  const shapes = await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path').length);
  check(shapes >= 10, 'the Hyrax draws itself on Specialty’s arches (' + shapes + ' shapes: bands, arms, support bars, screw, tubes)');
  await p.click('#rxWrap [data-rxa=auto]');
  check(await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path').length) === 0, '“Draw the appliance from the choices” off: the arches are bare');
  await p.click('#rxWrap [data-rxa=auto]');
  const box = await (await p.$('#rxArchBox svg')).boundingBox();
  await tool('arrow'); await p.mouse.move(box.x + box.width * .3, box.y + box.height * .2); await p.mouse.down(); await p.mouse.move(box.x + box.width * .42, box.y + box.height * .3, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(80);
  check(((await rxNow()).draw || []).length === 1, 'an arrow drawn on the arches is kept with the Rx');
  await p.fill('#rxWrap [data-rxf=notes]', 'Please solder the arms to the 4s.');
  await p.mouse.move(5, 5); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/v35-rxm-editor.png' });
  await (await p.$('#rxArchBox')).screenshot({ path: OUT + '/v35-rxm-arches.png' });
  // the paper
  await p.click('#rxWrap [data-rxtab=paper]'); await p.waitForSelector('#rxPaperBox .rxPaper img');
  await p.waitForFunction(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  const paper = await p.evaluate(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'), t = Array.from(document.querySelectorAll('#rxPaperBox svg text')).map(x => x.textContent);
    return { src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight, txt: t, rings: document.querySelectorAll('#rxPaperBox svg ellipse').length }; });
  check(paper.src === 'nlo-cases-rx-metal.png' && paper.w === 1224 && paper.h === 1584, 'The paper: Specialty’s blank Metal Rx loads under it');
  check(paper.txt.includes('Mona Expanderson') && paper.txt.includes('Allied Star') && paper.txt.includes('Please solder the arms to the 4s.') && paper.txt.includes(await p.evaluate(d => usDate(prevClinicDay(d)), deliv)), '… the patient, the scanner (Other: Allied Star), the date needed and the special instructions on their lines');
  const boxes = (await p.evaluate(() => rxFill(RXE.c, RXE.rx).box.sort().join())).split(',');
  check(['exp.hyrax', 'acc.awt', 'awt.U', 'provides', 'anch.band', 'printed3d', 'scan.other'].every(k => boxes.includes(k)) && boxes.length === 7 && paper.rings === 2, 'the form’s circles: Hyrax RPE, Archwire Tubes · Upper, Specialty provides Band(s), 3D printed, scan Other — and UR6, UL6 ringed on the anchorage chart');
  await p.screenshot({ path: OUT + '/v35-rxm-paper.png' });
  await p.click('#rxWrap [data-rxtab=arch]');
  await clearToasts(); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  check(await shown('#rxWrap') && await toastHas(/Close without saving/), 'Esc with changes asks first');
  await done();
  check(/Hyrax RPE · 2 bands \(3D printed\)/.test(await p.textContent('#cf-rxMetSum')) && /est\. \$212\.50/.test(await p.textContent('#cf-rxMetSum')) && /Edit the Rx/.test(await p.textContent('#cf-rxMetSec')), 'Done: the form shows “Hyrax RPE · 2 bands (3D printed) · est. $212.50” and Edit the Rx');
  check(await p.inputValue('#ncForm #cf-detail') === 'Rapid Palatal Expander (RPE)', 'the detail stays “Rapid Palatal Expander (RPE)”');
  await clearToasts(); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }); await p.waitForTimeout(700);
  check(await toastHas(/Metal Rx ready for Specialty/), 'after Create: “Metal Rx ready for Specialty — Download PDF”');
  const cid = await p.evaluate(() => (openCases().find(c => c.patient === 'Mona Expanderson') || {}).id);
  const saved = await p.evaluate(id => findCase(id).rxMet, cid);
  check(saved && saved.form === 'specialty-metal' && JSON.stringify(saved.exp) === '["hyrax"]' && JSON.stringify(saved.awt) === '["U"]' && saved.printed3d === true && saved.draw.length === 1 && saved.notes && await p.evaluate(id => !findCase(id).rx && !findCase(id).rxRet && findCase(id).lab === LAB_SPEC, cid),
    'the case keeps the Metal Rx (and no Herbst or Retainer Rx), going to Specialty');

  // ---- the case's Metal Rx section
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxMet]');
  const sec = await p.evaluate(() => { const s = document.querySelector('#drawer [data-ds=rxMet]'); return { t: s.querySelector('.dsT').textContent, sum: s.querySelector('.dsS').textContent, arch: s.querySelectorAll('.rxCaseArch .rxDraw path').length, body: s.textContent, others: !!document.querySelector('#drawer [data-ds=rx], #drawer [data-ds=rxRet]') }; });
  check(sec.t === 'Metal Rx · Specialty' && /Hyrax RPE/.test(sec.sum) && /est\. \$212\.50/.test(sec.sum) && sec.arch >= 10 && /Needed by/.test(sec.body) && !sec.others, 'the case has “Metal Rx · Specialty”: summary, estimate, the drawn arches, the date needed');
  await (await p.$('#drawer [data-ds=rxMet]')).screenshot({ path: OUT + '/v35-rxm-case.png' });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#drawer [data-ds=rxMet] .pickRow [data-act=rxPdf]')]);
  check(dl.suggestedFilename() === 'Metal Rx - Mona Expanderson - ' + today + '.pdf', 'Download PDF: “Metal Rx - Mona Expanderson - ' + today + '.pdf”');
  const pdf = path.join(tmp, 'rxm.pdf'); await dl.saveAs(pdf); const bytes = fs.readFileSync(pdf);
  const tail = bytes.slice(-80).toString('latin1'), sx = Number((tail.match(/startxref\s+(\d+)/) || [])[1]);
  check(bytes.slice(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(tail) && bytes.slice(sx, sx + 4).toString() === 'xref', 'a PDF whose last cross-reference table is where it says');
  if (has('qpdf')) { let ok = true; try { execFileSync('qpdf', ['--check', pdf], { stdio: 'pipe' }); } catch (x) { ok = x.status === 3; } check(ok, 'qpdf --check: no errors'); }
  if (has('pdfinfo')) check(/Pages:\s+1/.test(execFileSync('pdfinfo', [pdf]).toString()), 'Specialty’s one page');
  const txt = pdfText(pdf);
  if (txt != null) check(/Mona Expanderson/.test(txt) && /DEMO-0000/.test(txt) && /Allied Star/.test(txt) && /s\/ Amir Akhavan/.test(txt) && /Please solder the arms/.test(txt) && /Metal Rx/.test(txt), 'the PDF’s text: patient, account #, scanner, signature, special instructions on Specialty’s Metal Rx');
  if (has('pdftoppm')) { execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, OUT + '/v35-rxm-pdf']); check(fs.existsSync(OUT + '/v35-rxm-pdf.png'), 'the PDF renders (v35-rxm-pdf.png)'); }
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#drawer [data-ds=rxMet] [data-act=rxOpen]')]);
  check(/^blob:/.test(pop.url()), 'Open to print: a new tab with the PDF'); await pop.close();
  await p.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await on('exp', 'hyrax') && await on('awt', 'U') && (await fold('acc')).open && !(await fold('dist')).open, 'Edit the Rx opens with the saved choices (Accessories open: it holds the tubes; Distalization folded)');
  await tap('acc', 'sheath'); await clearToasts(); await done(); await p.waitForTimeout(400);
  check(await p.evaluate(id => (findCase(id).rxMet.acc || []).includes('sheath'), cid) && await toastHas(/Metal Rx saved/) && await p.evaluate(() => /changed Metal Rx/.test((document.querySelector('#histBox') || {}).textContent || '')), 'lingual sheaths added: saved, “changed Metal Rx” in the history');
  check(await p.evaluate(id => /Scanned with Allied Star for Rapid Palatal Expander \(RPE\) \(Specialty Orthodontic Lab\)\./.test(chartNote(findCase(id))), cid), 'the chart note: “… for Rapid Palatal Expander (RPE) (Specialty Orthodontic Lab).”');

  // ---- usual RPE (Dr. A's): saved without this patient's notes and drawing; a new RPE starts from it as saved
  await p.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(/Save as our usual RPE/.test(await p.textContent('#rxWrap [data-rxa=saveDef]')), 'an RPE case’s button: “Save as our usual RPE”');
  await clearToasts(); await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(200);
  let def = await p.evaluate(() => rxDefaults(RX_MET + ':rpe'));
  check(def && JSON.stringify(def.exp) === '["hyrax"]' && JSON.stringify(def.awt) === '["U"]' && def.printed3d === true && !def.notes && !def.draw && !def.needed && !(await p.evaluate(() => rxDefaults(RX_MET + ':mse') || rxDefaults(RX_MET))) && await toastHas(/new RPE Rx start from it/),
    '“Save as our usual RPE”: the Hyrax, its bands and tubes, 3D printed — not this patient’s notes or drawing (the usual MSE and metal appliance untouched)');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  await newAppliance(); await pick('appliances', 'Rapid Palatal Expander (RPE)'); await p.fill('#ncForm #cf-patient', 'Ravi Rapidson'); await openRx();
  st = await rxNow(); check(JSON.stringify(st.awt) === '["U"]' && (st.acc || []).includes('sheath') && st.printed3d === true && !st.notes, 'a new RPE starts from our usual RPE (tubes, sheaths)');
  await tap('flag', 'printed3d'); await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(200);
  await p.click('#rxWrap [data-rxa=close]'); await p.click('#rxWrap [data-rxa=close]').catch(() => {}); await p.waitForSelector('#rxWrap', { state: 'detached' });
  await newAppliance(); await pick('appliances', 'Rapid Palatal Expander (RPE)'); await openRx();
  check(!(await rxNow()).printed3d && JSON.stringify((await rxNow()).exp) === '["hyrax"]', '… saved again without 3D printing: the next RPE starts that way (the usual as Dr. A saved it, not forced back)');
  await closeAll();
  await newAppliance(); await pick('appliances', 'MSE'); await p.fill('#ncForm #cf-patient', 'Milo Msewick'); await openRx();
  st = await rxNow();
  check(st.mse === true && st.mseMm === '10' && !st.exp && st.printed3d === true && JSON.stringify(st.teeth) === '{"UR6":"band","UL6":"band"}' && !st.awt, 'an MSE starts as the MSE (10 mm) on 3D printed first-molar bands — not from the usual RPE');
  check(/Save as our usual MSE/.test(await p.textContent('#rxWrap [data-rxa=saveDef]')), '… its button: “Save as our usual MSE”');
  await closeAll();

  // ---- Other metal appliance: holding arches, a space maintainer, the acrylic color; the detail line says what it is
  await newAppliance(); await pick('appliances', 'Other metal appliance'); await p.fill('#ncForm #cf-patient', 'Otto Holdwell');
  await openRx();
  check(JSON.stringify(await rxNow()) === '{"form":"specialty-metal"}' && /Pick the appliance/.test(await p.textContent('#rxCost')) && /Save as our usual metal appliance/.test(await p.textContent('#rxWrap [data-rxa=saveDef]')), 'an other metal appliance starts empty: “Pick the appliance — the prices add up here”');
  await unfold('hold'); await tap('hold', 'nance'); st = await rxNow();
  check(JSON.stringify(st.teeth) === '{"UR6":"band","UL6":"band"}' && !st.printed3d && near(await est(), 131.5), 'Nance: Specialty’s standard bands on the upper first molars, not 3D printed (not an expander): $96 + 2 × $17.75 = $131.50');
  await tap('hold', 'lla'); st = await rxNow();
  check(st.teeth.LR6 === 'band' && st.teeth.LL6 === 'band' && near(await est(), 244), 'Lingual Arch: Lower: the lower first molars banded (+$77 + 2 × $17.75 → $244.00)');
  await unfold('acc'); await p.fill('#rxWrap [data-rxf=colorTxt]', 'Blue'); await p.press('#rxWrap [data-rxf=colorTxt]', 'Tab');
  st = await rxNow(); e = await estOf();
  check((st.acc || []).includes('color') && near(e.total, 244) && e.lines.some(l => /Acrylic: Blue · Free/.test(l)), 'acrylic color Blue: Acrylic Color ticked, free (a Specialty color)');
  check(await p.evaluate(() => Array.from(document.querySelectorAll('#rxArchBox .rxDraw path')).some(x => x.getAttribute('fill') === rxrTint('Blue').f)), '… the Nance button drawn in a light blue');
  await tool('sm'); await clearToasts(); await tooth('UL7');
  check(await toastHas(/Tap the space: a missing 4, 5 or 6/), 'Space maintainer on a 7: it says to tap the space (a missing 4, 5 or 6)');
  await tooth('UL4'); st = await rxNow();
  check(JSON.stringify(st.sm) === '["UL4"]' && st.hold.includes('sm') && st.teeth.UL5 === 'band' && !st.teeth.UL4 && near(await est(), 337.75) && /UL4 space \(band UL5\)/.test(await p.innerHTML('#rxTeethSum')),
    'the space UL4 tapped: Space Maintainer ticked, the band on UL5 behind it (+$76 + $17.75 → $337.75)');
  const smLine = await p.evaluate(() => rxFill(RXE.c, RXE.rx).txt.map(t => t.s));
  check(smLine.includes('UL4 (band UL5)') && smLine.includes('Blue'), 'on the form’s short line: “UL4 (band UL5)”, and the color on its own');
  await tooth('UL4'); st = await rxNow();
  check(!st.sm && !(st.hold || []).includes('sm') && !st.teeth.UL5 && near(await est(), 244), '… tapped again: the space, its band and the tick come off');
  await tooth('LR5'); st = await rxNow();
  check(JSON.stringify(st.sm) === '["LR5"]' && st.teeth.LR6 === 'band' && near(await est(), 320), 'the space LR5: the band behind it is the lingual arch’s LR6 already (+$76 → $320.00)');
  await done();
  check(await p.inputValue('#ncForm #cf-detail') === 'Lingual Arch: Lower, Nance Appliance, Space Maintainer' || await p.inputValue('#ncForm #cf-detail') === 'Nance Appliance, Lingual Arch: Lower, Space Maintainer',
    'Done: the detail line follows the Metal Rx (“' + await p.inputValue('#ncForm #cf-detail') + '”)');
  await clearToasts(); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }); await p.waitForTimeout(500);
  const oid = await p.evaluate(() => (openCases().find(c => c.patient === 'Otto Holdwell') || {}).id);
  await p.evaluate(id => openDrawer(id), oid); await p.waitForSelector('#drawer [data-ds=rxMet]');
  const badge = await p.evaluate(() => Array.from(document.querySelectorAll('#drawer .badge.t-appl')).map(b => b.textContent).join('|'));
  check(/Nance Appliance/.test(badge) && /Lingual Arch: Lower/.test(badge) && !/Other metal appliance/.test(badge), 'the case’s badge says what it is (“' + badge + '”), not “Other metal appliance”');
  check(await p.evaluate(id => /for [^.]*Nance Appliance[^.]*\(Specialty Orthodontic Lab\)\./.test(chartNote(findCase(id))) && !/×/.test(chartNote(findCase(id))), oid), 'the chart note names the appliances (plain characters)');
  // the usual metal appliance keeps the space maintainer choice, not this patient's space or the band behind it
  await p.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  await tool('sm'); await tooth('UL4'); check((await rxNow()).teeth.UL5 === 'band', '(a second space, UL4: its band on UL5)');
  await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(200);
  def = await p.evaluate(() => rxDefaults(RX_MET));
  check(def && def.hold.includes('sm') && !def.sm && !def.teeth.UL5 && def.teeth.UR6 === 'band' && def.teeth.LR6 === 'band' && !def.colorTxt, '“Save as our usual metal appliance”: the Nance, lingual arch and space maintainer choice with their bands — not the spaces or the band behind UL4, or the color');
  await p.click('#rxWrap [data-rxa=close]'); await p.click('#rxWrap [data-rxa=close]').catch(() => {}); await p.waitForSelector('#rxWrap', { state: 'detached' });

  // ---- distalizers: one side or both, their standard bands and rests
  await newAppliance(); await pick('appliances', 'Other metal appliance'); await p.fill('#ncForm #cf-patient', 'Dana Distalwick');
  await p.click('#ncForm [data-rxform=edit][data-kind=met]'); await p.waitForSelector('#rxWrap .rxArch.live');
  st = await rxNow(); check((st.hold || []).join() === 'lla,nance,sm' && !st.sm && st.teeth.UR6 === 'band', 'it starts from our usual metal appliance (lingual arch, Nance, space maintainer — no spaces)');
  await tool('sm'); await tooth('UL4'); await tool('band'); await tooth('UR4');
  await p.click('#rxWrap [data-rxa=useDef]'); st = await rxNow();
  check(JSON.stringify(st.sm) === '["UL4"]' && st.teeth.UL5 === 'band' && !st.teeth.UL4 && !st.teeth.UR4, '“Start from our usual metal appliance” keeps this Rx’s space (UL4) and the band behind it (UL5); the extra band goes');
  await p.click('#rxWrap [data-rxa=clearAll]'); await p.click('#rxWrap [data-rxa=clearAll]');
  check(JSON.stringify(await rxNow()) === '{"form":"specialty-metal"}', 'Clear the Rx (tapped twice): empty');
  await tool('band'); await tooth('UR6'); await tooth('UL6');
  await unfold('hold'); await tap('hold', 'tpa'); await tap('hold', 'tpa'); await unfold('hold'); st = await rxNow();
  check(st.teeth.UR6 === 'band' && st.teeth.UL6 === 'band' && !st.hold, 'bands put on by hand stay when a TPA (which wants them) is picked and taken off again');
  await tooth('UR6'); await tooth('UL6'); check(!(await rxNow()).teeth, '(taken off again by hand)');
  await unfold('dist'); await tap('distR', 'pendulum'); st = await rxNow();
  check(st.distR === 'pendulum' && JSON.stringify(st.teeth) === '{"UR6":"band"}' && JSON.stringify(st.occl) === '["UR5","UR4","UL4","UL5"]' && near(await est(), 186.75), 'Pendulum · right: a band on UR6, occlusal rests on the 4s and 5s (the Nance’s anchorage): $169 + $17.75');
  await tap('distL', 'pendulum'); e = await estOf();
  check(e.lines[0] === 'Pendulum Original · right & left = 169' && near(e.total, 204.5) && (await fold('dist')).open, '… and left: one appliance, “Pendulum Original · right & left”, $169 + 2 bands');
  await tap('distL', 'trex'); e = await estOf();
  check(e.lines.some(l => /^T-Rex · left = 217/.test(l)) && near(e.total, 462) && !(await on('distL', 'pendulum')) && await on('distL', 'trex') && (await rxNow()).printed3d === true,
    'left changed to T-Rex: one choice per side, $217 — an expander too (its screw), so the bands go 3D printed: $169 + $217 + 2 × $38 = $462.00');
  await tap('distL', 'halterman'); st = await rxNow(); e = await estOf();
  check(st.teeth.UL5 === 'band' && !st.teeth.UL6 && e.missing.includes('Halterman Appliance · left') && (st.occl || []).length === 4, 'left changed to a Halterman: its band on the second primary molar (UL5), the UL6 band off; not on the list');
  await tap('distR', 'pendulum'); st = await rxNow();
  check(!st.distR && !st.teeth.UR6 && !(st.occl || []).length, 'the Pendulum taken off: its band and the rests go');
  await tap('distR', 'djet'); e = await estOf();
  check(e.missing.includes('Distal Jet · right') && !e.lines.some(l => /Distal Jet/.test(l)), 'a Distal Jet on one side: not on the list (its price is the bilateral one), so named, not added');
  await tap('distR', 'rmd'); st = await rxNow();
  check(st.teeth.UR4 === 'band' && st.teeth.UR6 === 'band', 'Rapid Molar Distalizer: bands on UR4 and UR6');
  check((await fold('dist')).sum === '', '(open: no summary on its heading)');
  await unfold('dist'); check((await fold('dist')).sum === 'Rapid Molar Distalizer, right · Halterman Appliance, left', 'folded: “Rapid Molar Distalizer, right · Halterman Appliance, left”');
  // other appliances
  await unfold('other'); await tap('other', 'xbow');
  check(await shown('#rxWrap .rxSub[data-show=xbow]') && (await rxNow()).teeth.LR6 === 'band', 'Xbow: its Gurin locks choice shows; the lower first molars banded too');
  await tap('flag', 'gurin'); e = await estOf();
  check(e.lines.some(l => /^Xbow with 2 Gurin locks = 386\.5/.test(l)) && /Xbow with 2 Gurin locks\./.test(await p.textContent('#rxAutoNotes')), '… with 2 Gurin locks: the list’s $386.50, and the special instructions say so');
  await tap('other', 'habit'); await tap('habit', 'bluegrass');
  check(await shown('#rxWrap .rxSub[data-show=habit]') && (await estOf()).lines.some(l => /^Bluegrass appliance = 140\.5/.test(l)), 'Habit · Bluegrass: the list’s Bluegrass Appliance ($140.50)');
  await tap('habit', 'bluegrass'); await tap('habit', 'crib');
  check((await estOf()).lines.some(l => /^Habit appliance \(crib\) = 103/.test(l)), 'Habit · Crib: the Habit Appliance ($103.00)');
  // spaces: next to an appliance's band, side by side, two at once
  await tool('sm'); await tooth('UR6'); st = await rxNow();
  check((st.sm || []).includes('UR6') && st.teeth.UR7 === 'band' && !st.teeth.UR6, 'a space at UR6 (banded for the RMD and Xbow): the band goes behind it, on UR7');
  await clearToasts(); await tooth('UR5');
  check(await toastHas(/UR6 is a space too/) && !(await rxNow()).sm.includes('UR5'), 'UR5 as a space too: not taken — UR6 behind it is a space (two missing side by side go in the special instructions)');
  await tooth('UR6'); st = await rxNow();
  check(!st.sm && st.teeth.UR6 === 'band' && !st.teeth.UR7, '… the UR6 space taken off: its band (the RMD’s and Xbow’s) is back, UR7’s goes');
  await tooth('LL5'); await clearToasts(); await tooth('LL6');
  check(await toastHas(/LL6 has the band for the LL5 space/) && JSON.stringify((await rxNow()).sm) === '["LL5"]', 'LL6 as a space while it holds the LL5 space’s band: not taken');
  await tooth('LR5');
  const n2 = await p.textContent('#rxAutoNotes'), f2 = await p.evaluate(() => rxFill(RXE.c, RXE.rx).txt.map(t => t.s));
  check(/Space maintainers: LR5 space, band on LR6; LL5 space, band on LL6\./.test(n2) && f2.includes('LR5, LL5'), 'two spaces: the form’s short line reads “LR5, LL5”; the special instructions spell out the bands');
  await p.screenshot({ path: OUT + '/v35-rxm-other.png' });
  await (await p.$('#rxArchBox')).screenshot({ path: OUT + '/v35-rxm-other-arches.png' });
  await closeAll();
  await p.evaluate(() => B.saveSettings({ rxDefaults: '' }));

  // ---- an Other metal appliance filled in later, from the case: what's being made follows (until someone types their own)
  await newAppliance(); await pick('appliances', 'Other metal appliance'); await p.fill('#ncForm #cf-patient', 'Olive Nancewell');
  await clearToasts(); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }); await p.waitForTimeout(400);
  const nid = await p.evaluate(() => (openCases().find(c => c.patient === 'Olive Nancewell') || {}).id);
  check(await p.evaluate(id => findCase(id).detail, nid) === 'Other metal appliance', 'created without its Rx: “Other metal appliance”');
  await p.evaluate(id => openDrawer(id), nid); await p.waitForSelector('#drawer [data-ds=rxMet]');
  await p.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  await unfold('hold'); await tap('hold', 'nance'); await done(); await p.waitForTimeout(400);
  check(await p.evaluate(id => findCase(id).detail, nid) === 'Nance Appliance' && await p.evaluate(() => /changed Metal Rx, detail/.test((document.querySelector('#histBox') || {}).textContent || '')),
    'the Rx filled in from the case (a Nance): the detail reads “Nance Appliance”; the history “changed Metal Rx, detail”');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .cf');
  check(await p.inputValue('#drawer #cf-detail') === 'Nance Appliance' && await p.evaluate(() => document.querySelector('#drawer #cf-detail').dataset.auto) === '1', 'Edit: the detail is still the automatic one');
  await p.click('#drawer [data-rxform=edit][data-kind=met]'); await p.waitForSelector('#rxWrap');
  check((await fold('hold')).open, '(its Holding section opens by itself: it holds the Nance)'); await tap('hold', 'tpa'); await done();
  check(await p.inputValue('#drawer #cf-detail') === 'Transpalatal Arch, Nance Appliance', '… a TPA added in Edit’s Rx: “Transpalatal Arch, Nance Appliance”');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(500);
  check(await p.evaluate(id => findCase(id).detail === 'Transpalatal Arch, Nance Appliance' && findCase(id).rxMet.hold.join() === 'tpa,nance', nid), '… saved');
  // a case whose detail is still "Other metal appliance" while its Rx says more (saved before the line followed): Edit picks it up
  const old = await p.evaluate(() => B.createCase({ type: 'appliance', patient: 'Ozzie Olderwell', stage: 'submit', lab: LAB_SPEC, appliances: ['Other metal appliance'], detail: 'Other metal appliance',
    rxMet: { form: RX_MET, distR: 'pendulum', distL: 'halterman', hold: ['tpa', 'lla', 'nance', 'sm'], sm: ['LR5'], other: ['habit', 'fbp', 'tandem'], habit: ['crib', 'spurs'], teeth: { UR6: 'band', UL5: 'band', LR6: 'band', LL6: 'band' } }, comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await p.waitForTimeout(300);
  const oldId = await p.evaluate(() => (openCases().find(c => c.patient === 'Ozzie Olderwell') || {}).id);
  await p.evaluate(id => openDrawer(id), oldId); await p.waitForSelector('#drawer [data-ds=rxMet]');
  check(await p.evaluate(() => { const d = document.querySelector('#drawer'); return d.scrollWidth <= d.clientWidth + 1; }) && await p.evaluate(() => Array.from(document.querySelectorAll('#drawer .badge.t-appl')).some(b => b.getBoundingClientRect().height > 30)),
    'a long appliance badge (all that Rx) wraps instead of widening the case panel');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .cf');
  check(await p.evaluate(() => document.querySelector('#drawer #cf-detail').dataset.auto) === '1', 'Edit of an older case still reading “Other metal appliance”: the line counts as automatic…');
  await p.click('#drawer .pickRow[data-g=scanner] .pick[data-v=iTero]');
  check(/^Pendulum Original \(right\), Halterman Appliance \(left\), Transpalatal Arch/.test(await p.inputValue('#drawer #cf-detail')), '… and follows the Rx at the next tap (“' + (await p.inputValue('#drawer #cf-detail')).slice(0, 60) + '…”)');
  await p.click('#drawer [data-act=cancelEdit]').catch(() => {}); await closeAll();

  // ---- Team & security: the Metal Rx prices and its usuals
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin'); await settled('#rxAdmin');
  const adm = await p.textContent('#rxAdmin');
  check(await p.inputValue('[data-rxprice=hyrax]') === '109.00' && await p.inputValue('[data-rxprice=mse]') === '489.50' && await p.inputValue('[data-rxprice=hsjet]') === '225.00' && await p.inputValue('[data-rxprice=deluke]') === '' && await p.inputValue('[data-rxprice=rush]') === '95.00' && /Metal Rx/.test(adm) && /Every form/.test(adm) && /metal appliances/.test(adm),
    'Lab Rx card: the Metal Rx prices (Hyrax $109, MSE $489.50, Horseshoe Jet $225, DeLuke blank) and the $95 expedite fee for every form');
  check(/Our usual RPE/.test(adm) && /Our usual MSE/.test(adm) && /Our usual metal appliance/.test(adm), '… and its three usuals: RPE, MSE, metal appliance');
  await p.fill('[data-rxprice=hyrax]', '115'); await p.press('[data-rxprice=hyrax]', 'Tab');
  await p.waitForFunction(() => rxPrices().hyrax === 115, null, { timeout: 5000 }).catch(() => {}); await settled('#rxAdmin');
  const e2 = await p.evaluate(() => rxEstimate({ form: RX_MET, exp: ['hyrax'] }));
  check(near(e2.total, 115) && /list \$109\.00/.test(e2.lines[0].note), 'a Metal Rx price changed ($115): the estimate uses it, “(list $109.00)”');
  await p.locator('#rxAdmin').screenshot({ path: OUT + '/v35-rxm-admin.png' });
  await p.click('#rxAdmin [data-act=rxPricesReset]'); await p.waitForTimeout(200);

  // ---- the form's own odds and ends
  const dw = await p.evaluate(() => rxEstimate({ form: RX_MET, acc: ['debondWires'] }));
  check(!dw.lines.length && dw.missing.join() === 'Debonding wires × 1 pr', 'debonding wires: not on the list by that name (it has loops and screws), so named under the estimate');
  const scans = await p.evaluate(() => ['iTero', 'TRIOS 5', 'Medit i700', 'Carestream CS 3800', 'Primescan (CEREC)', 'Allied Star'].map(s => rxFill({ patient: 'X', scanner: s }, { form: RX_MET }).box.filter(b => /^scan\./.test(b)).join()));
  check(scans.join('|') === 'scan.itero|scan.trios|scan.medit|scan.carestream|scan.cerec|scan.other', 'scanners on the form get their circle (Primescan → CEREC); Allied Star → Other');
  const junk = await p.evaluate(() => rxCanon({ form: RX_MET, exp: ['haas', 'hyrax', 'lowerFixed', 'zz'], mse: true, mseMm: '9', distR: 'pendulum', distL: 'nope', hold: ['tpa'], sm: ['LR5', 'UR3'], other: ['x'], habit: ['crib'], gurin: true, acc: ['zz'], fmTxt: 'x'.repeat(60), teeth: { UR6: 'band', UR3: 'band', LL6: 'zz' }, occl: ['UR4', 'UR2'] }));
  check(JSON.stringify(junk) === JSON.stringify({ form: 'specialty-metal', exp: ['lowerFixed'], mse: true, distR: 'pendulum', hold: ['tpa', 'sm'], sm: ['LR5'], acc: ['fm'], fmTxt: 'x'.repeat(40), teeth: { UR6: 'band' }, occl: ['UR4'] }),
    'an Rx with anything that isn’t on the form keeps only what is (no upper expander with the MSE; a space ticks Space Maintainer; same order every time)');
  const geo = await p.evaluate(() => {
    const rx = { form: RX_MET, exp: ['hyrax', 'lowerFixed'], distR: 'pendulum', distL: 'rmd', hold: ['tpa', 'lla', 'nance', 'sm'], sm: ['LR5', 'UL6'], other: ['habit', 'fbp', 'xbow', 'tandem'], habit: ['crib', 'spurs', 'bluegrass'], gurin: true, awt: ['U', 'L'],
      acc: ['hg', 'lb', 'sheath', 'fm', 'debondHoles', 'vent', 'roc', 'debondWires', 'color'], fmTxt: 'canine', colorTxt: 'Teal glitter', teeth: { UR6: 'band', UL7: 'crown', LR6: 'band', LL6: 'roc', UR4: 'onbrace', LR4: 'band' }, occl: ['UR5', 'LL7'], printed3d: true, rush: true };
    const all = [rx].concat(RXM_K('exp').map(k => ({ form: RX_MET, exp: [k] })), RXM_K('dist').map(k => ({ form: RX_MET, distR: k, distL: k })), [{ form: RX_MET, mse: true, mseMm: '8' }, { form: RX_MET }]);
    const [x, y, w, h] = RX_FORMS[RX_MET].clip; let out = 0, n = 0;
    all.forEach(r => { const list = rxAuto(r, {}); n += list.length; list.forEach(s => s.d.forEach(o => { for (let i = 1; i < o.length; i += 2) { if (o[i] < x - 3 || o[i] > x + w + 3 || o[i + 1] < y - 3 || o[i + 1] > y + h + 3 || !Number.isFinite(o[i]) || !Number.isFinite(o[i + 1])) out++; } })); });
    return { n, out, content: /NaN|Infinity/.test(rxContent(rxFill({ patient: 'X' }, rx))) }; });
  check(geo.n > 200 && geo.out === 0 && !geo.content, 'every expander, distalizer and part drawn (' + geo.n + ' shapes) stays inside the arch area, with no bad numbers in the PDF');
  check(await p.evaluate(() => { const c = Array.from(S.cases.values()).find(x => x.rxMet && x.patient !== 'Mona Expanderson' && x.patient !== 'Otto Holdwell'); return !!c && c.appliances.includes('Rapid Palatal Expander (RPE)') && c.lab === LAB_SPEC && rxSummary(c.rxMet) === 'Hyrax RPE · 2 bands (3D printed)'; }), 'the demo has an RPE at Specialty with its Metal Rx');

  // ---- phone: it fits
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxMet]');
  check(await p.evaluate(() => document.querySelector('#drawer').scrollWidth <= document.querySelector('#drawer').clientWidth + 1), 'phone: the case’s Metal Rx section fits');
  await p.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await p.evaluate(() => { const b = document.querySelector('#rxWrap .rxBox'), a = document.querySelector('#rxArchBox').getBoundingClientRect(), l = document.querySelector('#rxL').getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= 390 && a.top >= 0 && a.top < 600 && l.top > a.top; }), 'phone: the editor fits, the arches first, the choices under them');
  await unfold('dist');
  check(await p.evaluate(() => { const b = document.querySelector('#rxWrap .rxBox'); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= 390 && Array.from(document.querySelectorAll('#rxWrap .rxUL')).every(r => r.getBoundingClientRect().right <= 391); }), '… the distalizers’ Right / Left rows fit too');
  await p.evaluate(() => document.querySelector('#rxL .rxUL').scrollIntoView());
  await p.screenshot({ path: OUT + '/v35-rxm-phone.png' });
  await p.click('#rxWrap [data-rxa=close]');
  await p.setViewportSize({ width: 1440, height: 960 });

  // ---- staff see it too, without "Save as our usual RPE"
  await p.evaluate(() => { DEMO._own = DEMO.isOwner; DEMO.isOwner = () => false; });
  await p.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(!(await p.$('#rxWrap [data-rxa=saveDef]')), 'staff: no “Save as our usual RPE”');
  await p.click('#rxWrap [data-rxa=close]'); await p.evaluate(() => { DEMO.isOwner = DEMO._own; });

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
