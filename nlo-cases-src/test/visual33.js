// Amir, 4 Oct 2026: "here is the Rx for hawley. do the same" — Specialty's Retainer Rx (MKT-7, Rev 2-25) the way the Herbst Rx
// works (visual32): filled in from the case, tapped through, drawn on the arches, priced, and their own form as the PDF — demo
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rxr-'));
  const today = await p.evaluate(() => todayISO());
  const rxNow = () => p.evaluate(() => JSON.parse(JSON.stringify(RXE.rx)));
  const est = () => p.evaluate(() => Math.round(rxEstimate(RXE.rx, RXE.c).total * 100) / 100);
  const tap = (g, v) => p.click('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]');
  const on = (g, v) => p.getAttribute('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]', 'aria-pressed').then(x => x === 'true');
  const tool = k => p.click('#rxWrap [data-rxtool=' + k + ']');
  const tooth = id => p.click('#rxArchBox .rxTooth[data-rxt=' + id + ']');
  const toastHas = re => p.evaluate(src => Array.from(document.querySelectorAll('.toast')).some(t => new RegExp(src).test(t.textContent)), re.source);
  const clearToasts = () => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const newAppliance = async () => { await p.evaluate(() => { closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); }); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(80); };
  const pick = (g, v) => p.click('#ncForm .pickRow[data-g=' + g + '] .pick[data-v="' + v + '"]');
  const retShown = () => p.isVisible('#ncForm #cf-rxRetSec');
  const pdfText = file => has('pdftotext') ? execFileSync('pdftotext', ['-layout', file, '-']).toString() : null;
  const near = (a, b) => Math.abs(a - b) < .001;
  // the fixed lingual and invisible retainers fold under their headings (Amir, 4 Oct 2026: "for retainer, collaps invisible retainer and fixed lingual retainer")
  const fold = g => p.evaluate(g => { const s = document.querySelector('#rxWrap .rxFold[data-fold=' + g + ']'), b = s.querySelector('.rxFoldB'), body = s.querySelector('.rxFoldBody'), cb = s.querySelector('.rxCmpBtn');
    return { open: b.getAttribute('aria-expanded') === 'true' && s.classList.contains('open'), shown: !body.hidden && body.getBoundingClientRect().height > 0, cmp: !!cb && !cb.hidden && cb.getBoundingClientRect().width > 0,
      sum: s.querySelector('.rxFoldSum').textContent, tip: b.title, h: Math.round(s.getBoundingClientRect().height) }; }, g);
  const unfold = g => p.click('#rxWrap .rxFold[data-fold=' + g + '] .rxFoldB');
  // Team & security draws itself again as the office roster and the mail state come in: wait until it has stayed put for 400 ms
  const settled = sel => p.evaluate(sel => new Promise(res => { let el = document.querySelector(sel), t = Date.now(); const t0 = t;
    const iv = setInterval(() => { const now = document.querySelector(sel); if (now !== el) { el = now; t = Date.now(); } else if (Date.now() - t > 400 || Date.now() - t0 > 5000) { clearInterval(iv); res(); } }, 40); }), sel);

  // ---- New case: Hawley retainers go to Specialty (the office routing since 4 Oct 2026) → the Retainer Rx right away; tapped over
  //      to Partners → a line about Specialty instead; back to Specialty → the Rx again
  await newAppliance();
  await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Upper'); await pick('hawleyArch', 'Lower'); await pick('acrylic', 'Party mix glitter');
  check(await p.evaluate(() => pressed(document.querySelector('.modal'), 'lab')[0]) === 'Specialty Orthodontic Lab' && await retShown() && !(await p.isVisible('#cf-rxHint')),
    'Hawley retainers → Specialty (the routing since 4 Oct 2026): the Retainer Rx shows right away');
  await pick('lab', 'Partners Dental Solutions');
  check(!(await retShown()) && await p.isVisible('#cf-rxHint') && /Going to Specialty instead\? Tap Specialty Orthodontic Lab and its Retainer Rx fills in from this case/.test(await p.textContent('#cf-rxHint')),
    'tapped over to Partners: no Retainer Rx, one line that it’s there for Specialty');
  await pick('lab', 'Specialty Orthodontic Lab');
  check(await retShown() && !(await p.isVisible('#cf-rxHint')) && !(await p.isVisible('#ncForm #cf-rxSec')) && /Retainer Rx/.test(await p.textContent('#cf-rxRetSec')) && /Fill out the Rx/.test(await p.textContent('#cf-rxRetSec')), 'Specialty tapped: the Retainer Rx shows (“Fill out the Rx”); the line and the Herbst Rx don’t');
  check(await p.evaluate(() => { const i = document.querySelector('#cf-rxRetSec img[data-logo]'); return !!i && i.complete && i.naturalWidth > 0; }), 'with Specialty’s logo');
  await p.fill('#ncForm #cf-patient', 'Rhea Retainerson');
  const deliv = await p.evaluate(() => addDays(todayISO(), 30)); await p.fill('#ncForm #cf-deliveryDate', deliv);

  // ---- the editor: filled in from the case
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap .rxArch.live');
  check(/Retainer Rx/i.test(await p.textContent('#rxWrap #rxTitle')) && /Rhea Retainerson/.test(await p.textContent('#rxWrap .rxHd')), 'the Retainer Rx opens with the patient’s name');
  let st = await rxNow();
  check(st.designU === 'hawley' && st.designL === 'hawley' && JSON.stringify(st.teeth) === '{"UR6":"adams","UL6":"adams","LR6":"adams","LL6":"adams"}', 'a Hawley on each arch the case picked, with Dr. A’s Adams clasps on the first molars (his Preferred)');
  check(/Upper & lower:\s*Party mix glitter\s*\(the case’s\)/.test(await p.textContent('#rxAcrNow')) && !st.colorU && !st.colorL && await on('acrPick', 'Party mix glitter'), 'the acrylic color comes from the case (Party mix glitter on both, its swatch picked), kept as the case’s');
  check(await p.inputValue('#rxWrap [data-rxf=needed]') === await p.evaluate(d => prevClinicDay(d), deliv) && !(await p.isVisible('#rxLead')), 'date needed: the office day before the delivery appt (30 days out: no rush warning)');
  check(near(await est(), 196) && /\$196\.00/.test(await p.textContent('#rxTot')), 'estimate: Hawley 2 × $61 + Adams 2 pairs × $27.50 + glitter 2 × $9.50 = $196.00');
  let fl = await fold('flr'), ir = await fold('ir');
  check(!fl.open && !fl.shown && !fl.cmp && !fl.sum && !ir.open && !ir.shown && !ir.cmp && !ir.sum && fl.h < 60 && ir.h < 60, 'the Fixed lingual retainers and Invisible retainers start folded: just their headings (' + fl.h + ' and ' + ir.h + ' px), no Compare all');
  check(await p.evaluate(() => ['flr', 'ir'].every(g => { const b = document.querySelector('#rxWrap .rxFold[data-fold=' + g + '] .rxFoldB'); return b.tagName === 'BUTTON' && b.getAttribute('aria-controls') === 'rxFold-' + g && !!document.getElementById('rxFold-' + g); })), '… each heading is a button that says it opens its section');
  check(/\$61\.00/.test(await p.textContent('#rxWrap .rxUL[data-rxinfo="design:hawley"]')) && /not on list/.test(await p.textContent('#rxWrap .rxUL[data-rxinfo="design:tremont"]')) && /\$76\.25/.test(await p.textContent('#rxWrap .rxUL[data-rxinfo="design:flatHawley"]')), 'each design shows its price (Hawley $61.00; Flat Bow Hawley $76.25 with the flat bow wire; Tremont not on the list)');

  // clasps: Upper / Lower puts them on the first molars; tools put them anywhere
  await tap('claspU', 'c');
  st = await rxNow();
  check(st.teeth.UR6 === 'c' && st.teeth.UL6 === 'c' && await on('claspU', 'c') && !(await on('claspU', 'adams')) && near(await est(), 168.5), 'C-Clasps · Upper: Specialty’s standard C-clasps on the upper first molars instead (they come with the Hawley → $168.50)');
  check(/C-clasps on the upper first molars/.test(await p.textContent('#rxCost')) && /With the Hawley/.test(await p.textContent('#rxCost')), '… the C-clasps listed as coming with the Hawley');
  await tap('claspU', 'adams');
  st = await rxNow();
  check(st.teeth.UR6 === 'adams' && st.teeth.UL6 === 'adams' && await on('claspU', 'adams') && !(await on('claspU', 'c')) && near(await est(), 196), 'Adams · Upper: back to Adams on the upper first molars (+$27.50 a pair → $196.00)');
  await tool('ball'); await tooth('UR4');
  check((await rxNow()).teeth.UR4 === 'ball' && await on('claspU', 'ball') && near(await est(), 215.25), 'Ball tool on UR4: a ball clasp (between the 4 and 5), Ball · U ticked, +$19.25 (→ $215.25)');
  await clearToasts(); await tool('reset'); await tooth('UR6');
  check(await toastHas(/3 to 3/) && !((await rxNow()).reset || []).length, 'Reset on a molar: it says the reset diagram is 3 to 3, and changes nothing');
  await tool('pontic'); await tooth('UL2');
  st = await rxNow();
  check(st.teeth.UL2 === 'pontic' && (st.acrU || []).includes('pontic') && near(await est(), 262.25) && /Pontic:<\/b> UL2 #10/.test(await p.innerHTML('#rxTeethSum')), 'Pontic tool on UL2: a pontic (#10), Pontic · U ticked, +$47 (→ $262.25)');
  // the pontic's shade is required (Amir, 4 Oct 2026): VITA shades to tap, marked until one is, and Done waits for it
  check(await p.isVisible('#rxWrap .rxShade[data-need=ponticTxt]') && await p.evaluate(() => document.querySelector('#rxWrap .rxShade[data-need=ponticTxt]').classList.contains('rxNeedOn')) && (await p.$$('#rxWrap .rxShade .rxB[data-rxg=ponticShade]')).length === 16 && !(await p.isVisible('#rxWrap [data-rxf=saddleTxt]')),
    'a pontic: its shade shows (the 16 VITA shades), marked required (the saddle’s blank doesn’t show until it’s picked)');
  await clearToasts(); await p.click('#rxWrap [data-rxa=done]'); await p.waitForTimeout(150);
  check(await p.isVisible('#rxWrap') && await toastHas(/Add the pontic shade first/), 'Done without the shade: the Rx stays open — “Add the pontic shade first”');
  await clearToasts(); await p.click('#rxWrap [data-rxa=dl]'); await p.waitForTimeout(150);
  check(await toastHas(/Add the pontic shade first/), '… and Download waits for it too');
  await tap('ponticShade', 'A2');
  check((await rxNow()).ponticTxt === 'A2' && await on('ponticShade', 'A2') && !(await p.evaluate(() => document.querySelector('#rxWrap .rxShade').classList.contains('rxNeedOn'))), 'A2 tapped: the shade is on the Rx and the mark goes');
  await tap('accU', 'finger');
  check(await p.evaluate(() => RXE.tool) === 'finger' && /finger spring/i.test(await p.textContent('#rxHint')), 'Finger Spring · U: ticked, and the tool is ready to tap the tooth');
  await tooth('UR2'); await p.fill('#rxWrap [data-rxf=fingerTxt]', 'tip labially'); await p.press('#rxWrap [data-rxf=fingerTxt]', 'Tab');
  check((await rxNow()).teeth.UR2 === 'finger' && near(await est(), 277.5), '… on UR2: +$15.25 (→ $277.50)');
  // resets: the diagram's numbers; Do Not Reset Teeth clears them
  await tap('reset', 'UR1'); await tap('reset', 'UL1'); await tap('resetHow', 'ideal');
  check(JSON.stringify((await rxNow()).reset) === '["UR1","UL1"]' && near(await est(), 305), 'reset UR1 and UL1 ideally: 2 × $13.75 (→ $305.00)');
  await tap('resetHow', 'none');
  check(!(await rxNow()).reset && !(await on('reset', 'UR1')) && near(await est(), 277.5), 'Do Not Reset Teeth clears the teeth to reset');
  await tap('resetHow', 'none'); await tap('reset', 'UR1'); await tap('resetHow', 'ideal');
  check(near(await est(), 291.25) && await on('resetHow', 'ideal'), 'reset UR1 ideally again: $13.75 (→ $291.25)');
  // a fixed lingual retainer and clear retainers
  await unfold('flr'); fl = await fold('flr');
  check(fl.open && fl.shown && fl.cmp && !fl.sum && !(await fold('ir')).open, 'tapping Fixed lingual retainers opens it, with its Compare all (the invisible retainers stay folded)');
  await tap('flrL', 'c3');
  check(near(await est(), 375.25) && /Fixed lingual retainer · lower 3–3, composite pads on each tooth/.test(await p.textContent('#rxCost')) && /Specialty’s standard pads/.test(await p.textContent('#rxCost')), 'lower FLR cuspid to cuspid: Specialty’s standard composite pads on each tooth, the list’s 6 Pads $84 (→ $375.25)');
  await tap('flrPadsL', 'meshEach'); await tap('flrWireL', 'braided');
  check(await p.isVisible('#rxFlrWarn') && /braided/.test(await p.textContent('#rxFlrWarn')), 'mesh pads with braided wire: Specialty can’t — it says so');
  await tap('flrWireL', 'solid'); check(!(await p.isVisible('#rxFlrWarn')), '… solid stainless steel: the warning goes');
  await unfold('ir'); await tap('irU', 'express');
  check(await p.isVisible('#rxIrWarn') && /pontics, a bonded retainer/.test(await p.textContent('#rxIrWarn')), 'IR Express with a pontic and a bonded retainer: Specialty’s exclusions are named');
  await tap('irU', 'g2'); await tap('irL', 'g2');
  const e1 = await p.evaluate(() => rxEstimate(RXE.rx, RXE.c));
  check(!(await p.isVisible('#rxIrWarn')) && e1.lines.some(l => l.l === 'Guardian 2 · upper & lower' && l.amt === 90 && /dual arch/.test(l.note)), 'Guardian 2 on both arches: the list’s dual-arch price ($90)');
  await p.click('#rxWrap [data-rxa=cmp][data-g=ir]'); check(await p.isVisible('#rxWrap .rxCmpBox[data-cmp=ir] .rxCmpRow'), 'the invisible retainers’ Compare all opens');
  await unfold('ir'); ir = await fold('ir');
  check(!ir.open && !ir.shown && !ir.cmp && ir.sum === 'Guardian 2, upper & lower' && ir.tip === ir.sum, 'folded again while it holds Guardian 2 on both: the heading says “Guardian 2, upper & lower”');
  await unfold('ir'); ir = await fold('ir');
  check(ir.open && !ir.sum && await p.evaluate(() => document.querySelector('#rxWrap .rxCmpBox[data-cmp=ir]').hidden && document.querySelector('#rxWrap [data-rxa=cmp][data-g=ir]').textContent === 'Compare all'), '… opened again: the summary goes, and the comparison folded away with it');
  await tap('irU', 'g2'); await tap('irL', 'g2');
  await p.focus('#rxWrap .rxFold[data-fold=flr] .rxFoldB'); await p.keyboard.press('Enter'); fl = await fold('flr');
  check(!fl.open && fl.sum === 'Lower 3–3, mesh pads on each tooth, solid SS .016 × .022', 'keyboard: Enter on the heading folds the FLR, which then reads “Lower 3–3, mesh pads on each tooth, solid SS .016 × .022”');
  await p.keyboard.press('Space'); fl = await fold('flr'); check(fl.open && fl.shown, '… and Space opens it again');
  await unfold('flr'); await unfold('ir'); ir = await fold('ir'); check(!ir.open && !ir.sum, 'the invisible retainers, emptied and folded: no summary');
  // what each option is
  const card = g => p.evaluate(g => { const c = document.querySelector('#rxWrap .rxInfoCard[data-info=' + g + ']'), o = c.querySelector('.rxIc.on') || c; return { name: (o.querySelector('.rxIcHd b') || {}).textContent || '', peek: c.classList.contains('peek'), text: o.textContent, links: o.querySelectorAll('.rxIcSrc a[target=_blank]').length, h: c.getBoundingClientRect().height }; }, g);
  let cd = await card('design');
  check(cd.name === 'Hawley' && /\.032/.test(cd.text) && cd.links >= 1, 'the Hawley is explained under the designs (.032 bow, Specialty’s page linked)');
  const h0 = cd.h; await p.hover('#rxWrap .rxUL[data-rxinfo="design:specWrap"] .rxULn'); cd = await card('design');
  check(cd.name === 'Specialty Wrap Design' && cd.peek && /clear labial bow/.test(cd.text) && cd.h === h0, 'pointing at Specialty Wrap Design shows it (clear bow, no wires crossing), the card keeping its height');
  await p.hover('#rxWrap .rxB[data-rxg=designU][data-v=tremont]'); cd = await card('design');
  check(cd.name === 'Tremont Wraparound' && /ODL and Accutech/.test(cd.text), 'the Tremont: Specialty doesn’t describe it, so the card says whose description it is');
  await p.hover('#rxArchBox'); cd = await card('design'); check(cd.name === 'Hawley' && !cd.peek, '… moving away goes back to the picked design');
  check(await p.evaluate(() => Object.keys(RXR_INFO).every(g => RXK[RX_RET].infoKeys(g).every(k => RXR_INFO[g][k] && RXR_INFO[g][k].sum && (RXR_INFO[g][k].src || []).every(x => RXR_SRC[x])) && (RXK[RX_RET].cmpKeys(g) || []).every(k => RXR_INFO[g][k].short))), 'every option on the form has its explanation, its sources and (where compared) a one-line summary');
  await p.click('#rxWrap [data-rxa=cmp][data-g=design]');
  const cmp = await p.evaluate(() => Array.from(document.querySelectorAll('#rxWrap .rxCmpBox[data-cmp=design] .rxCmpRow')).map(r => r.querySelector('b').textContent + '|' + r.querySelector('em').textContent));
  check(cmp.length === 13 && cmp[0] === 'Hawley|$61.00' && cmp[4] === 'Tremont Wraparound|not on list' && cmp[12] === 'Super Modified Spring Hawley|$133.50', 'Compare all: the 13 designs and spring designs side by side with their prices');
  await p.click('#rxWrap [data-rxa=cmp][data-g=design]');
  const acc = await card('acc'); check(acc.name === 'Finger Spring', 'the accessories card shows the finger spring picked');
  // a design changed: an arch's own clasps stay; a design's standard clasps go with it
  await tap('designU', 'wrap');
  check((await rxNow()).teeth.UR6 === 'adams', 'Hawley → Standard Wraparound on the upper: the clasps picked by hand stay');
  await tap('designU', 'hawley');
  // drawing: the retainer draws itself
  const shapes = await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path').length);
  check(shapes > 30, 'the retainer draws itself on Specialty’s arches (' + shapes + ' shapes: plates, bows, clasps, pontic, spring, FLR)');
  check(await p.evaluate(() => { const ps = Array.from(document.querySelectorAll('#rxArchBox .rxDraw path')); return ps.some(x => x.getAttribute('fill') === '#F1E8D6') && ps.some(x => x.getAttribute('fill') === rxrTint('Party mix glitter').f); }), '… the pontic in tooth color, the plates in a light tint of the acrylic color');
  await p.click('#rxWrap [data-rxa=auto]');
  check(await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path').length) === 0, '“Draw the appliance from the choices” off: the arches are bare for drawing by hand');
  await p.click('#rxWrap [data-rxa=auto]');
  const box = await (await p.$('#rxArchBox svg')).boundingBox();
  await tool('arrow'); await p.mouse.move(box.x + box.width * .3, box.y + box.height * .2); await p.mouse.down(); await p.mouse.move(box.x + box.width * .42, box.y + box.height * .3, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(80);
  check(((await rxNow()).draw || []).length === 1, 'an arrow drawn on the arches is kept with the Rx');
  await p.fill('#rxWrap [data-rxf=notes]', 'Please make the pontic match the neighbours.');
  await p.mouse.move(5, 5); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/v33-rxr-editor.png' });
  await (await p.$('#rxArchBox')).screenshot({ path: OUT + '/v33-rxr-arches.png' });
  // the paper
  await p.click('#rxWrap [data-rxtab=paper]'); await p.waitForSelector('#rxPaperBox .rxPaper img');
  await p.waitForFunction(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  const paper = await p.evaluate(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'), t = Array.from(document.querySelectorAll('#rxPaperBox svg text')).map(x => x.textContent);
    return { src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight, txt: t, dots: document.querySelectorAll('#rxPaperBox svg circle').length, rings: document.querySelectorAll('#rxPaperBox svg ellipse').length }; });
  console.log('   ' + JSON.stringify({ src: paper.src, w: paper.w, dots: paper.dots, rings: paper.rings }));
  check(paper.src === 'nlo-cases-rx-retainer.png' && paper.w === 1224 && paper.h === 1584, 'The paper: Specialty’s blank Retainer Rx loads under it');
  check(paper.txt.includes('Rhea Retainerson') && paper.txt.includes('Party mix glitter') && paper.txt.includes('A2 (#10)') && paper.txt.includes('#7 tip labially') && paper.txt.includes('Please make the pontic match the neighbours.'), '… the patient, the acrylic color, “A2 (#10)” (the shade first), “#7 tip labially” and the special instructions on their lines');
  const boxes = await p.evaluate(() => rxFill(RXE.c, RXE.rx).box.sort().join());
  check(['d.hawley.U', 'd.hawley.L', 'cl.adams.U', 'cl.ball.U', 'acc.finger.U', 'acr.pontic.U', 'acr.color.U', 'acr.color.L', 'flr.c3.L', 'pads.meshEach.L', 'wire.solid.L', 'rh.ideal'].every(k => boxes.split(',').includes(k)) && paper.rings === 1, 'the form’s circles: Hawley U & L, Adams and Ball U, finger spring, pontic, both colors, the FLR’s placement, pads and wire, reset ideally — and UR1 ringed on the reset diagram');
  await p.screenshot({ path: OUT + '/v33-rxr-paper.png' });
  await p.click('#rxWrap [data-rxtab=arch]');
  await clearToasts(); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  check(await p.isVisible('#rxWrap') && await toastHas(/Close without saving/), 'Esc with changes asks first');
  await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Hawley \(U & L\) · FLR 3–3 \(lower\) · 1 pontic/.test(await p.textContent('#cf-rxRetSum')) && /est\. \$/.test(await p.textContent('#cf-rxRetSum')) && /Edit the Rx/.test(await p.textContent('#cf-rxRetSec')), 'Done: the form shows “Hawley (U & L) · FLR 3–3 (lower) · 1 pontic · est. $…” and Edit the Rx');
  await clearToasts(); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }); await p.waitForTimeout(700);
  check(await toastHas(/Retainer Rx ready for Specialty/), 'after Create: “Retainer Rx ready for Specialty — Download PDF”');
  const cid = await p.evaluate(() => (openCases().find(c => c.patient === 'Rhea Retainerson') || {}).id);
  const saved = await p.evaluate(id => findCase(id).rxRet, cid);
  check(saved && saved.form === 'specialty-retainer' && saved.designU === 'hawley' && saved.teeth.UL2 === 'pontic' && saved.ponticTxt === 'A2' && saved.flrL === 'c3' && saved.draw.length === 1 && saved.notes && !saved.colorU && await p.evaluate(id => !findCase(id).rx, cid), 'the case keeps the Retainer Rx (and no Herbst Rx)');

  // ---- the case's Retainer Rx section
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxRet]');
  const sec = await p.evaluate(() => { const s = document.querySelector('#drawer [data-ds=rxRet]'); return { t: s.querySelector('.dsT').textContent, sum: s.querySelector('.dsS').textContent, arch: s.querySelectorAll('.rxCaseArch .rxDraw path').length, body: s.textContent, herbst: !!document.querySelector('#drawer [data-ds=rx]') }; });
  check(sec.t === 'Retainer Rx · Specialty' && /Hawley \(U & L\)/.test(sec.sum) && /est\. \$/.test(sec.sum) && sec.arch > 20 && /Needed by/.test(sec.body) && !sec.herbst, 'the case has “Retainer Rx · Specialty”: summary, estimate, the drawn arches, the date needed (no Herbst section)');
  await (await p.$('#drawer [data-ds=rxRet]')).screenshot({ path: OUT + '/v33-rxr-case.png' });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#drawer [data-ds=rxRet] .pickRow [data-act=rxPdf]')]);
  check(dl.suggestedFilename() === 'Retainer Rx - Rhea Retainerson - ' + today + '.pdf', 'Download PDF: “Retainer Rx - Rhea Retainerson - ' + today + '.pdf”');
  const pdf = path.join(tmp, 'rxr.pdf'); await dl.saveAs(pdf); const bytes = fs.readFileSync(pdf);
  const tail = bytes.slice(-80).toString('latin1'), sx = Number((tail.match(/startxref\s+(\d+)/) || [])[1]);
  check(bytes.slice(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(tail) && bytes.slice(sx, sx + 4).toString() === 'xref', 'a PDF whose last cross-reference table is where it says');
  if (has('qpdf')) { let ok = true; try { execFileSync('qpdf', ['--check', pdf], { stdio: 'pipe' }); } catch (e) { ok = e.status === 3; } check(ok, 'qpdf --check: no errors'); }
  if (has('pdfinfo')) check(/Pages:\s+2/.test(execFileSync('pdfinfo', [pdf]).toString()), 'both of Specialty’s pages (page 2: their IR Express notes)');
  const txt = pdfText(pdf);
  if (txt != null) check(/Rhea Retainerson/.test(txt) && /DEMO-0000/.test(txt) && /Party mix glitter/.test(txt) && /A2 \(#10\)/.test(txt) && /s\/ Amir Akhavan/.test(txt) && /IR EXPRESS/.test(txt), 'the PDF’s text: patient, account #, acrylic color, pontic shade, signature — and Specialty’s page 2');
  if (has('pdftoppm')) { execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, OUT + '/v33-rxr-pdf']); check(fs.existsSync(OUT + '/v33-rxr-pdf.png'), 'the PDF renders (v33-rxr-pdf.png)'); }
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#drawer [data-ds=rxRet] [data-act=rxOpen]')]);
  check(/^blob:/.test(pop.url()), 'Open to print: a new tab with the PDF'); await pop.close();
  await p.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await on('designU', 'hawley') && await on('flrL', 'c3') && await on('ponticShade', 'A2'), 'Edit the Rx opens with the saved choices');
  fl = await fold('flr'); ir = await fold('ir');
  check(fl.open && fl.shown && !ir.open && !ir.shown, '… the fixed lingual retainer open by itself (it holds the lower 3–3), the empty invisible retainers folded');
  await tap('acrL', 'abp'); await clearToasts(); await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' }); await p.waitForTimeout(400);
  check(await p.evaluate(id => (findCase(id).rxRet.acrL || []).includes('abp'), cid) && await toastHas(/Retainer Rx saved/) && await p.evaluate(() => /changed Retainer Rx/.test((document.querySelector('#histBox') || {}).textContent || '')), 'a lower anterior bite plane added: saved, “changed Retainer Rx” in the history');

  // ---- Team & security: the retainer prices and the usual retainer
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin'); await settled('#rxAdmin');
  check(await p.inputValue('[data-rxprice=hawley]') === '61.00' && await p.inputValue('[data-rxprice=g2d]') === '90.00' && await p.inputValue('[data-rxprice=tremont]') === '' && await p.inputValue('[data-rxprice=rush]') === '95.00' && /Retainer Rx/.test(await p.textContent('#rxAdmin')), 'Lab Rx card: the Retainer Rx prices (Hawley $61, Guardian 2 both arches $90, Tremont blank) and the $95 expedite fee for both forms');
  await p.fill('[data-rxprice=hawley]', '64'); await p.press('[data-rxprice=hawley]', 'Tab');
  await p.waitForFunction(() => rxPrices().hawley === 64, null, { timeout: 5000 }).catch(() => {}); await settled('#rxAdmin');
  const e2 = await p.evaluate(() => rxEstimate({ form: RX_RET, designU: 'hawley' }));
  check(near(e2.total, 64) && /list \$61\.00/.test(e2.lines[0].note), 'a retainer price changed ($64): the estimate uses it, “(list $61.00)”');
  await p.locator('#rxAdmin').screenshot({ path: OUT + '/v33-rxr-admin.png' });
  await p.click('#rxAdmin [data-act=rxPricesReset]'); await p.waitForTimeout(200);
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxRet]');
  await p.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  await clearToasts(); await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(200);
  const def = await p.evaluate(() => rxDefaults(RX_RET));
  check(def && def.designU === 'hawley' && def.teeth.UR6 === 'adams' && !def.teeth.UL2 && !def.teeth.UR2 && !def.reset && !def.ponticTxt && !def.fingerTxt && !def.notes && !def.draw && def.flrL === 'c3' && !(def.accU || []).includes('finger') && !(def.acrU || []).includes('pontic') && !(await p.evaluate(() => rxDefaults())),
    '“Save as our usual retainer”: designs, clasps, FLR — not this patient’s pontic, finger spring, resets, notes or drawing (and the usual Herbst untouched)');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  // a lower-only Hawley starts from the usual retainer on the lower only (its bonded retainer stays)
  await newAppliance(); await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Lower'); await p.fill('#ncForm #cf-patient', 'Lorna Loweronly'); // (Specialty: the routing)
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap');
  st = await rxNow();
  check(!st.designU && st.designL === 'hawley' && !Object.keys(st.teeth || {}).some(id => id[0] === 'U') && st.flrL === 'c3' && !st.colorU, 'a lower-only Hawley: the usual retainer on the lower only (no upper design or clasps; the bonded retainer stays)');
  check((await fold('flr')).open && !(await fold('ir')).open, '… its fixed lingual retainer (from the usual) shows open');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(await p.inputValue('#ncForm #cf-rxRet') === '', '… closed without Done: nothing put on the case');
  await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin'); await settled('#rxAdmin');
  check(/Our usual retainer/.test(await p.textContent('#rxAdmin')) && /Hawley \(U & L\)/.test(await p.textContent('#rxAdmin')), 'Team & security shows our usual retainer');
  await p.click('#rxAdmin [data-act=rxDefClear][data-slot=specialty-retainer]'); await p.waitForTimeout(200);
  check(!(await p.evaluate(() => rxDefaults(RX_RET))), '… and Clear removes it');
  // the finger spring appliance: a flipper with a finger spring to start
  await newAppliance(); await pick('appliances', 'Finger spring with no labial bow'); await pick('lab', 'Specialty Orthodontic Lab'); await p.fill('#ncForm #cf-patient', 'Finn Fingerspring');
  check(await retShown(), 'Finger spring with no labial bow → Specialty: the Retainer Rx is there too');
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap');
  st = await rxNow(); check(st.designU === 'flipper' && (st.accU || []).includes('finger') && !st.designL, '… it starts as an upper Flipper (no bow) with a finger spring');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  // a Herbst and Hawleys on one case: both forms
  await pick('appliances', 'Finger spring with no labial bow'); await pick('appliances', 'Herbst'); await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Upper');
  check(await p.isVisible('#ncForm #cf-rxSec') && await retShown(), 'a Herbst and Hawley retainers to Specialty on one case: the Herbst Rx and the Retainer Rx both show');
  await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });

  // ---- what we built on Dr. A's Lab Rx, on this form (Amir, 4 Oct 2026): his Hawley and clasp pictures, the badges, delta and
  //      arrowhead clasps written out, spurs facing distal or mesial, Specialty's colors as swatches
  await newAppliance(); await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Upper'); await pick('acrylic', 'Teal'); await p.fill('#ncForm #cf-patient', 'Penny Pictures');
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap .rxArch.live');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#rxWrap .rxPc img')).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {});
  const pcs = await p.evaluate(() => Array.from(document.querySelectorAll('#rxWrap .rxPc')).map(b => ({ g: b.dataset.rxg, v: b.dataset.v, img: !!b.querySelector('img') && b.querySelector('img').naturalWidth >= 300 && /^nlo-cases-pics\//.test(b.querySelector('img').getAttribute('src')),
    st: (b.querySelector('.rxSt:not([hidden])') || {}).textContent || '', on: b.getAttribute('aria-pressed') === 'true' })));
  console.log('   ' + JSON.stringify(pcs.map(x => x.v + ':' + x.st + (x.on ? '*' : '') + (x.img ? '' : '(no picture)'))));
  check(pcs.filter(x => x.g === 'designPick').map(x => x.v).join() === 'hawley,clearbow,wrap' && pcs.every(x => x.img) && pcs.find(x => x.v === 'hawley').on,
    'Dr. A’s three Hawleys in pictures over the designs (Hawley picked), every picture loaded from nlo-cases-pics/');
  check(pcs.filter(x => x.g === 'claspPick').map(x => x.v + ':' + x.st).join() === 'adams:Preferred,ball:Optional,c:Alternative,delta:Alternative,arrowhead:Not for this case',
    'his five clasps in pictures with his take for a Hawley: Adams Preferred, Ball Optional, C-clasp and Delta Alternative, Arrowhead Not for this case');
  check(await p.evaluate(() => ['c', 'adams', 'ball', 'delta', 'arrowhead'].map(v => (document.querySelector('#rxWrap .rxUL[data-rxinfo="clasp:' + v + '"] .rxSt:not([hidden])') || {}).textContent).join()) === 'Alternative,Preferred,Optional,Alternative,Not for this case', '… the same badges on the clasp rows');
  await p.hover('#rxWrap .rxPc[data-rxg=claspPick][data-v=delta]'); let cc = await card('clasp');
  check(cc.name === 'Delta clasp' && /Alternative for this Hawley: Holds its shape longer/.test(cc.text) && await p.evaluate(() => { const o = document.querySelector('#rxWrap .rxInfoCard[data-info=clasp] .rxIc.on'); return !!o.querySelector('.rxIcPic img[data-pic=clasp-delta]') && !!o.querySelector('.rxIcDraw svg.clasp-drawing'); }),
    'pointing at the Delta picture: its card says “Alternative for this Hawley: …”, with his photo and the buccal and occlusal drawings');
  await p.click('#rxWrap .rxPc[data-rxg=designPick][data-v=wrap]'); st = await rxNow();
  check(st.designU === 'wrap' && !Object.keys(st.teeth || {}).length && await p.evaluate(() => (document.querySelector('#rxWrap .rxPc[data-v=adams] .rxSt:not([hidden])') || {}).textContent) === 'Not for this case' && await p.evaluate(() => (document.querySelector('#rxWrap .rxPc[data-v=ball] .rxSt:not([hidden])') || {}).textContent) === 'Optional',
    'the Standard Wraparound picture tapped: the upper is a wraparound, its Adams clasps go (the bow replaces them), and the badges follow (Adams Not for this case, Ball Optional)');
  await p.click('#rxWrap .rxPc[data-rxg=designPick][data-v=hawley]'); st = await rxNow();
  check(st.designU === 'hawley' && JSON.stringify(st.teeth) === '{"UR6":"adams","UL6":"adams"}', '… the Hawley picture: back to a Hawley with the Adams clasps');
  // delta and arrowhead clasps: tools, drawn, written out with their teeth (the form has no circle for them), priced
  await p.click('#rxWrap .rxPc[data-rxg=claspPick][data-v=delta]');
  check(await p.evaluate(() => RXE.tool) === 'delta' && /delta clasp/.test(await p.textContent('#rxHint')), 'a clasp picture tapped picks it for tapping teeth');
  await tooth('UR7'); await tool('arrowhead'); await tooth('UL5'); await tooth('UL4');
  st = await rxNow(); let fill = await p.evaluate(() => rxFill(RXE.c, RXE.rx));
  const other = fill.txt.map(t => t.s).find(x => /^Delta /.test(x)), notes = await p.evaluate(() => rxNotesAll(RXE.rx));
  check(st.teeth.UR7 === 'delta' && st.teeth.UL5 === 'arrowhead' && st.teeth.UL4 === 'arrowhead' && other === 'Delta #2; Arrowhead #12, #13' && !fill.box.some(b => /delta|arrowhead/.test(b)),
    'Delta on UR7 and arrowheads on UL4–UL5: written out on the Other clasping line (“' + other + '”), no circle for them');
  check(/Delta clasps on #2 \(no circle on the form\): closed triangular loops/.test(notes) && /Arrowhead \(Schwarz\) clasps on #12, #13: arrows in the buccal embrasures/.test(notes), '… and spelled out in the special instructions');
  const e3 = await p.evaluate(() => rxEstimate(RXE.rx, RXE.c));
  check(e3.missing.some(m => /^Delta clasps · upper × 1 pr/.test(m)) && e3.lines.some(l => /^Arrowhead clasps · upper × 1 pr/.test(l.l) && l.amt === 19.25), 'priced: arrowheads as the list’s arrows ($19.25 a pair); delta clasps named as not on the list');
  const sh = await p.evaluate(() => { const d = rxAuto(RXE.rx, RXE.c); return { tri: d.filter(x => x.f === '#FFFFFF' && x.d.length === 4).length, dia: d.filter(x => x.f === '#FFFFFF' && x.d.length === 5).length }; });
  check(sh.tri === 2 && sh.dia === 3, 'drawn: the delta’s two closed loops (' + sh.tri + ') and the arrowheads’ three arrows, one shared between the two teeth (' + sh.dia + ')');
  // holding spurs: tap once facing distal, again facing mesial, a third time off
  await tool('spur'); await tooth('UR3'); st = await rxNow();
  check(st.teeth.UR3 === 'spur' && (st.accU || []).includes('spurs'), 'Spur on UR3: a holding spur facing distal (Holding Spurs · U ticked)');
  await tooth('UR3'); st = await rxNow(); fill = await p.evaluate(() => rxFill(RXE.c, RXE.rx));
  check(st.teeth.UR3 === 'spurM' && fill.txt.some(t => t.s === '#6 mesial') && /Holding spurs: #6 facing mesial/.test(await p.evaluate(() => rxNotesAll(RXE.rx))) && /Holding spur, facing mesial/.test(await p.textContent('#rxTeethSum')),
    '… tapped again: facing mesial — “#6 mesial” on the spurs line, spelled out in the special instructions');
  const spurD = await p.evaluate(() => { const a = rxAuto(Object.assign({}, RXE.rx, { teeth: { UR3: 'spur' } }), RXE.c), b = rxAuto(Object.assign({}, RXE.rx, { teeth: { UR3: 'spurM' } }), RXE.c); return JSON.stringify(a) !== JSON.stringify(b); });
  check(spurD, '… and it’s drawn the other way round on the arches');
  await tooth('UR3'); st = await rxNow();
  check(!st.teeth.UR3 && !(st.accU || []).includes('spurs'), '… a third tap takes it off (and the box with it)');
  // Specialty's colors in the Rx: the case's Teal; Blue glitter tapped for the upper only
  check(/Upper:\s*Teal\s*\(the case’s\)/.test(await p.textContent('#rxAcrNow')) && await on('acrFor', 'U') && await on('acrPick', 'Teal'), 'the color: the case’s Teal on the upper (the arch with a Hawley), its swatch picked');
  await tap('acrPick', 'Blue glitter'); st = await rxNow();
  check(st.colorU === 'Blue glitter' && /Acrylic: Blue glitter · upper/.test(await p.textContent('#rxCost')) && /Blue glitter/.test(await p.textContent('#rxAcrNow')), 'Blue glitter tapped: the upper is Blue glitter (+ the glitter price)');
  await tap('acrPick', 'Blue glitter'); st = await rxNow();
  check(!st.colorU && /Teal/.test(await p.textContent('#rxAcrNow')), '… tapped again: back to the case’s Teal');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForTimeout(100); await p.click('#rxWrap [data-rxa=close]').catch(() => {}); await p.waitForSelector('#rxWrap', { state: 'detached' });
  await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });

  // ---- the form's own odds and ends
  const scans = await p.evaluate(() => ['iTero', '3M True Definition', 'Medit i700', 'TRIOS 5', 'Primescan (CEREC)', 'Allied Star'].map(s => rxFill({ patient: 'X', scanner: s }, { form: RX_RET }).box.filter(b => /^scan\./.test(b)).join()));
  check(scans.join('|') === 'scan.itero|scan.3m|scan.medit|scan.trios|scan.sirona|scan.other', 'scanners on the form get their circle (CEREC / Primescan → Sirona); Allied Star → Other');
  const junk = await p.evaluate(() => rxCanon({ form: RX_RET, designU: 'bogus', designL: 'hawley', teeth: { UR6: 'x', UL6: 'adams', ZZ9: 'c' }, reset: ['UR7', 'UL1'], flrU: 'c3', irL: 'g9', accU: ['habit', 'nope'], habit: ['crib', 'zzz'], colorU: 'x'.repeat(90) }));
  check(JSON.stringify(junk) === JSON.stringify({ form: 'specialty-retainer', designL: 'hawley', teeth: { UL6: 'adams' }, reset: ['UL1'], accU: ['habit'], habit: ['crib'], flrU: 'c3', colorU: 'x'.repeat(40) }), 'an Rx with anything that isn’t on the form keeps only what is (same order every time)');
  const geo = await p.evaluate(() => { const rx = { form: RX_RET, designU: 'wrap', designL: 'tremont', palate: 'full', teeth: { UR7: 'delta', UR6: 'adams', UL4: 'ball', UL6: 'arrowhead', UL7: 'arrowhead', LR6: 'solc', LR4: 'arrowhead', LL2: 'pontic', LR2: 'finger', UL3: 'spur', UR3: 'spurM', LR7: 'spurM' }, reset: ['UR1'], accU: ['helical', 'cuspHook', 'habit'], habit: ['crib', 'spurs', 'bluegrass'], acrU: ['bowAcr', 'abp', 'scallop'], acrL: ['pbp'], flrL: 'll', flrPadsL: 'meshDist', flrWireL: 'braided', irU: 'single' };
    const list = rxAuto(rx, { acrylic: 'Teal' }), [x, y, w, h] = RX_FORMS[RX_RET].clip; let out = 0;
    list.forEach(s => s.d.forEach(o => { for (let i = 1; i < o.length; i += 2) { if (o[i] < x - 3 || o[i] > x + w + 3 || o[i + 1] < y - 3 || o[i + 1] > y + h + 3 || !Number.isFinite(o[i]) || !Number.isFinite(o[i + 1])) out++; } }));
    return { n: list.length, out, content: /NaN|Infinity/.test(rxContent(rxFill({ patient: 'X' }, rx))) }; });
  check(geo.n > 60 && geo.out === 0 && !geo.content, 'every kind of part drawn at once (' + geo.n + ' shapes) stays inside the arch area, with no bad numbers in the PDF');

  // ---- phone: it fits
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxRet]');
  check(await p.evaluate(() => document.querySelector('#drawer').scrollWidth <= document.querySelector('#drawer').clientWidth + 1), 'phone: the case’s Retainer Rx section fits');
  await p.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await p.evaluate(() => { const b = document.querySelector('#rxWrap .rxBox'), a = document.querySelector('#rxArchBox').getBoundingClientRect(), l = document.querySelector('#rxL').getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= 390 && a.top >= 0 && a.top < 600 && l.top > a.top; }), 'phone: the editor fits, the arches first, the choices under them');
  await p.evaluate(() => document.querySelector('#rxL .rxUL').scrollIntoView());
  await p.screenshot({ path: OUT + '/v33-rxr-phone.png' });
  await p.click('#rxWrap [data-rxa=close]');
  await p.setViewportSize({ width: 1440, height: 960 });

  // ---- staff see it too, without "Save as our usual retainer"
  await p.evaluate(() => { DEMO._own = DEMO.isOwner; DEMO.isOwner = () => false; });
  await p.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(!(await p.$('#rxWrap [data-rxa=saveDef]')), 'staff: no “Save as our usual retainer”');
  await p.click('#rxWrap [data-rxa=close]'); await p.evaluate(() => { DEMO.isOwner = DEMO._own; });

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
