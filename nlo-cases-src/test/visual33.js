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

  // ---- New case: Hawley retainers to Partners (the office routing) → a line about Specialty; to Specialty → the Retainer Rx
  await newAppliance();
  await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Upper'); await pick('hawleyArch', 'Lower'); await pick('acrylic', 'Purple'); await pick('glitter', 'yes');
  check(await p.evaluate(() => pressed(document.querySelector('.modal'), 'lab')[0]) === 'Partners Dental Solutions' && !(await retShown()) && /Going to Specialty instead\? Tap Specialty Orthodontic Lab and its Retainer Rx fills in from this case/.test(await p.textContent('#cf-rxHint')),
    'Hawley retainers → Partners (the routing): no Retainer Rx, one line that it’s there for Specialty');
  await pick('lab', 'Specialty Orthodontic Lab');
  check(await retShown() && !(await p.isVisible('#cf-rxHint')) && !(await p.isVisible('#ncForm #cf-rxSec')) && /Retainer Rx/.test(await p.textContent('#cf-rxRetSec')) && /Fill out the Rx/.test(await p.textContent('#cf-rxRetSec')), 'Specialty tapped: the Retainer Rx shows (“Fill out the Rx”); the line and the Herbst Rx don’t');
  check(await p.evaluate(() => { const i = document.querySelector('#cf-rxRetSec img[data-logo]'); return !!i && i.complete && i.naturalWidth > 0; }), 'with Specialty’s logo');
  await p.fill('#ncForm #cf-patient', 'Rhea Retainerson');
  const deliv = await p.evaluate(() => addDays(todayISO(), 30)); await p.fill('#ncForm #cf-deliveryDate', deliv);

  // ---- the editor: filled in from the case
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap .rxArch.live');
  check(/Retainer Rx/i.test(await p.textContent('#rxWrap #rxTitle')) && /Rhea Retainerson/.test(await p.textContent('#rxWrap .rxHd')), 'the Retainer Rx opens with the patient’s name');
  let st = await rxNow();
  check(st.designU === 'hawley' && st.designL === 'hawley' && JSON.stringify(st.teeth) === '{"UR6":"c","UL6":"c"}', 'a Hawley on each arch the case picked, with Specialty’s standard C-clasps on the upper first molars');
  check(await p.inputValue('#rxWrap [data-rxf=colorU]') === 'Purple glitter' && await p.inputValue('#rxWrap [data-rxf=colorL]') === 'Purple glitter' && !st.colorU, 'the acrylic color comes from the case (Purple glitter on both), kept as the case’s');
  check(await p.inputValue('#rxWrap [data-rxf=needed]') === await p.evaluate(d => prevClinicDay(d), deliv) && !(await p.isVisible('#rxLead')), 'date needed: the office day before the delivery appt (30 days out: no rush warning)');
  check(near(await est(), 141) && /\$141\.00/.test(await p.textContent('#rxTot')), 'estimate: Hawley 2 × $61 + glitter 2 × $9.50 = $141.00 (the standard C-clasps come with the Hawley)');
  check(/C-clasps on the upper first molars/.test(await p.textContent('#rxCost')) && /With the Hawley/.test(await p.textContent('#rxCost')), '… the C-clasps listed as coming with the Hawley');
  check(/\$61\.00/.test(await p.textContent('#rxWrap .rxUL[data-rxinfo="design:hawley"]')) && /not on list/.test(await p.textContent('#rxWrap .rxUL[data-rxinfo="design:tremont"]')) && /\$76\.25/.test(await p.textContent('#rxWrap .rxUL[data-rxinfo="design:flatHawley"]')), 'each design shows its price (Hawley $61.00; Flat Bow Hawley $76.25 with the flat bow wire; Tremont not on the list)');

  // clasps: Upper / Lower puts them on the first molars; tools put them anywhere
  await tap('claspU', 'adams');
  st = await rxNow();
  check(st.teeth.UR6 === 'adams' && st.teeth.UL6 === 'adams' && await on('claspU', 'adams') && !(await on('claspU', 'c')) && near(await est(), 168.5), 'Adams · Upper: Adams on the upper first molars instead of the C-clasps (+$27.50 a pair → $168.50)');
  await tool('ball'); await tooth('UR4');
  check((await rxNow()).teeth.UR4 === 'ball' && await on('claspU', 'ball') && near(await est(), 187.75), 'Ball tool on UR4: a ball clasp (between the 4 and 5), Ball · U ticked, +$19.25 (→ $187.75)');
  await clearToasts(); await tool('reset'); await tooth('UR6');
  check(await toastHas(/3 to 3/) && !((await rxNow()).reset || []).length, 'Reset on a molar: it says the reset diagram is 3 to 3, and changes nothing');
  await tool('pontic'); await tooth('UL2');
  st = await rxNow();
  check(st.teeth.UL2 === 'pontic' && (st.acrU || []).includes('pontic') && near(await est(), 234.75) && /Pontic:<\/b> UL2 #10/.test(await p.innerHTML('#rxTeethSum')), 'Pontic tool on UL2: a pontic (#10), Pontic · U ticked, +$47 (→ $234.75)');
  check(await p.isVisible('#rxWrap [data-rxf=ponticTxt]') && !(await p.isVisible('#rxWrap [data-rxf=saddleTxt]')), 'the pontic’s shade blank shows once there’s a pontic (the saddle’s doesn’t until it’s picked)');
  await p.fill('#rxWrap [data-rxf=ponticTxt]', 'A2'); await p.press('#rxWrap [data-rxf=ponticTxt]', 'Tab');
  await tap('accU', 'finger');
  check(await p.evaluate(() => RXE.tool) === 'finger' && /finger spring/i.test(await p.textContent('#rxHint')), 'Finger Spring · U: ticked, and the tool is ready to tap the tooth');
  await tooth('UR2'); await p.fill('#rxWrap [data-rxf=fingerTxt]', 'tip labially'); await p.press('#rxWrap [data-rxf=fingerTxt]', 'Tab');
  check((await rxNow()).teeth.UR2 === 'finger' && near(await est(), 250), '… on UR2: +$15.25 (→ $250.00)');
  // resets: the diagram's numbers; Do Not Reset Teeth clears them
  await tap('reset', 'UR1'); await tap('reset', 'UL1'); await tap('resetHow', 'ideal');
  check(JSON.stringify((await rxNow()).reset) === '["UR1","UL1"]' && near(await est(), 277.5), 'reset UR1 and UL1 ideally: 2 × $13.75 (→ $277.50)');
  await tap('resetHow', 'none');
  check(!(await rxNow()).reset && !(await on('reset', 'UR1')) && near(await est(), 250), 'Do Not Reset Teeth clears the teeth to reset');
  await tap('resetHow', 'none'); await tap('reset', 'UR1'); await tap('resetHow', 'ideal');
  check(near(await est(), 263.75) && await on('resetHow', 'ideal'), 'reset UR1 ideally again: $13.75 (→ $263.75)');
  // a fixed lingual retainer and clear retainers
  await tap('flrL', 'c3');
  check(near(await est(), 347.75) && /Fixed lingual retainer · lower 3–3, composite pads on each tooth/.test(await p.textContent('#rxCost')) && /Specialty’s standard pads/.test(await p.textContent('#rxCost')), 'lower FLR cuspid to cuspid: Specialty’s standard composite pads on each tooth, the list’s 6 Pads $84 (→ $347.75)');
  await tap('flrPadsL', 'meshEach'); await tap('flrWireL', 'braided');
  check(await p.isVisible('#rxFlrWarn') && /braided/.test(await p.textContent('#rxFlrWarn')), 'mesh pads with braided wire: Specialty can’t — it says so');
  await tap('flrWireL', 'solid'); check(!(await p.isVisible('#rxFlrWarn')), '… solid stainless steel: the warning goes');
  await tap('irU', 'express');
  check(await p.isVisible('#rxIrWarn') && /pontics, a bonded retainer/.test(await p.textContent('#rxIrWarn')), 'IR Express with a pontic and a bonded retainer: Specialty’s exclusions are named');
  await tap('irU', 'g2'); await tap('irL', 'g2');
  const e1 = await p.evaluate(() => rxEstimate(RXE.rx, RXE.c));
  check(!(await p.isVisible('#rxIrWarn')) && e1.lines.some(l => l.l === 'Guardian 2 · upper & lower' && l.amt === 90 && /dual arch/.test(l.note)), 'Guardian 2 on both arches: the list’s dual-arch price ($90)');
  await tap('irU', 'g2'); await tap('irL', 'g2');
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
  check(await p.evaluate(() => { const ps = Array.from(document.querySelectorAll('#rxArchBox .rxDraw path')); return ps.some(x => x.getAttribute('fill') === '#F1E8D6') && ps.some(x => x.getAttribute('fill') === rxrTint('Purple glitter').f); }), '… the pontic in tooth color, the plates in a light tint of the acrylic color');
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
  check(paper.txt.includes('Rhea Retainerson') && paper.txt.includes('Purple glitter') && paper.txt.includes('#10 shade A2') && paper.txt.includes('#7 tip labially') && paper.txt.includes('Please make the pontic match the neighbours.'), '… the patient, the acrylic color, “#10 shade A2”, “#7 tip labially” and the special instructions on their lines');
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
  if (txt != null) check(/Rhea Retainerson/.test(txt) && /DEMO-0000/.test(txt) && /Purple glitter/.test(txt) && /#10 shade A2/.test(txt) && /s\/ Amir Akhavan/.test(txt) && /IR EXPRESS/.test(txt), 'the PDF’s text: patient, account #, acrylic color, pontic shade, signature — and Specialty’s page 2');
  if (has('pdftoppm')) { execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, OUT + '/v33-rxr-pdf']); check(fs.existsSync(OUT + '/v33-rxr-pdf.png'), 'the PDF renders (v33-rxr-pdf.png)'); }
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#drawer [data-ds=rxRet] [data-act=rxOpen]')]);
  check(/^blob:/.test(pop.url()), 'Open to print: a new tab with the PDF'); await pop.close();
  await p.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await on('designU', 'hawley') && await on('flrL', 'c3') && await p.inputValue('#rxWrap [data-rxf=ponticTxt]') === 'A2', 'Edit the Rx opens with the saved choices');
  await tap('acrL', 'abp'); await clearToasts(); await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' }); await p.waitForTimeout(400);
  check(await p.evaluate(id => (findCase(id).rxRet.acrL || []).includes('abp'), cid) && await toastHas(/Retainer Rx saved/) && await p.evaluate(() => /changed Retainer Rx/.test((document.querySelector('#histBox') || {}).textContent || '')), 'a lower anterior bite plane added: saved, “changed Retainer Rx” in the history');

  // ---- Team & security: the retainer prices and the usual retainer
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin');
  check(await p.inputValue('[data-rxprice=hawley]') === '61.00' && await p.inputValue('[data-rxprice=g2d]') === '90.00' && await p.inputValue('[data-rxprice=tremont]') === '' && await p.inputValue('[data-rxprice=rush]') === '95.00' && /Retainer Rx/.test(await p.textContent('#rxAdmin')), 'Lab Rx card: the Retainer Rx prices (Hawley $61, Guardian 2 both arches $90, Tremont blank) and the $95 expedite fee for both forms');
  await p.fill('[data-rxprice=hawley]', '64'); await p.press('[data-rxprice=hawley]', 'Tab'); await p.waitForTimeout(200);
  const e2 = await p.evaluate(() => rxEstimate({ form: RX_RET, designU: 'hawley' }));
  check(near(e2.total, 64) && /list \$61\.00/.test(e2.lines[0].note), 'a retainer price changed ($64): the estimate uses it, “(list $61.00)”');
  await (await p.$('#rxAdmin')).screenshot({ path: OUT + '/v33-rxr-admin.png' });
  await p.click('#rxAdmin [data-act=rxPricesReset]'); await p.waitForTimeout(200);
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxRet]');
  await p.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  await clearToasts(); await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(200);
  const def = await p.evaluate(() => rxDefaults(RX_RET));
  check(def && def.designU === 'hawley' && def.teeth.UR6 === 'adams' && !def.teeth.UL2 && !def.teeth.UR2 && !def.reset && !def.ponticTxt && !def.fingerTxt && !def.notes && !def.draw && def.flrL === 'c3' && !(def.accU || []).includes('finger') && !(def.acrU || []).includes('pontic') && !(await p.evaluate(() => rxDefaults())),
    '“Save as our usual retainer”: designs, clasps, FLR — not this patient’s pontic, finger spring, resets, notes or drawing (and the usual Herbst untouched)');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  // a lower-only Hawley starts from the usual retainer on the lower only (its bonded retainer stays)
  await newAppliance(); await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Lower'); await pick('lab', 'Specialty Orthodontic Lab'); await p.fill('#ncForm #cf-patient', 'Lorna Loweronly');
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap');
  st = await rxNow();
  check(!st.designU && st.designL === 'hawley' && !Object.keys(st.teeth || {}).some(id => id[0] === 'U') && st.flrL === 'c3' && !(await p.inputValue('#rxWrap [data-rxf=colorU]')), 'a lower-only Hawley: the usual retainer on the lower only (no upper design or clasps; the bonded retainer stays)');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(await p.inputValue('#ncForm #cf-rxRet') === '', '… closed without Done: nothing put on the case');
  await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin');
  check(/Our usual retainer/.test(await p.textContent('#rxAdmin')) && /Hawley \(U & L\)/.test(await p.textContent('#rxAdmin')), 'Team & security shows our usual retainer');
  await p.click('#rxAdmin [data-act=rxDefClear][data-form=specialty-retainer]'); await p.waitForTimeout(200);
  check(!(await p.evaluate(() => rxDefaults(RX_RET))), '… and Clear removes it');
  // the finger spring appliance: a flipper with a finger spring to start
  await newAppliance(); await pick('appliances', 'Finger spring with no labial bow'); await pick('lab', 'Specialty Orthodontic Lab'); await p.fill('#ncForm #cf-patient', 'Finn Fingerspring');
  check(await retShown(), 'Finger spring with no labial bow → Specialty: the Retainer Rx is there too');
  await p.click('#ncForm [data-rxform=edit][data-kind=ret]'); await p.waitForSelector('#rxWrap');
  st = await rxNow(); check(st.designU === 'flipper' && (st.accU || []).includes('finger') && !st.designL, '… it starts as an upper Flipper (no bow) with a finger spring');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  // a Herbst and Hawleys on one case: both forms
  await pick('appliances', 'Finger spring with no labial bow'); await pick('appliances', 'Herbst with Rollo Band'); await pick('appliances', 'Hawley retainers'); await pick('hawleyArch', 'Upper');
  check(await p.isVisible('#ncForm #cf-rxSec') && await retShown(), 'a Herbst and Hawley retainers to Specialty on one case: the Herbst Rx and the Retainer Rx both show');
  await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });

  // ---- the form's own odds and ends
  const scans = await p.evaluate(() => ['iTero', '3M True Definition', 'Medit i700', 'TRIOS 5', 'Primescan (CEREC)', 'Allied Star'].map(s => rxFill({ patient: 'X', scanner: s }, { form: RX_RET }).box.filter(b => /^scan\./.test(b)).join()));
  check(scans.join('|') === 'scan.itero|scan.3m|scan.medit|scan.trios|scan.sirona|scan.other', 'scanners on the form get their circle (CEREC / Primescan → Sirona); Allied Star → Other');
  const junk = await p.evaluate(() => rxCanon({ form: RX_RET, designU: 'bogus', designL: 'hawley', teeth: { UR6: 'x', UL6: 'adams', ZZ9: 'c' }, reset: ['UR7', 'UL1'], flrU: 'c3', irL: 'g9', accU: ['habit', 'nope'], habit: ['crib', 'zzz'], colorU: 'x'.repeat(90) }));
  check(JSON.stringify(junk) === JSON.stringify({ form: 'specialty-retainer', designL: 'hawley', teeth: { UL6: 'adams' }, reset: ['UL1'], accU: ['habit'], habit: ['crib'], flrU: 'c3', colorU: 'x'.repeat(40) }), 'an Rx with anything that isn’t on the form keeps only what is (same order every time)');
  const geo = await p.evaluate(() => { const rx = { form: RX_RET, designU: 'wrap', designL: 'tremont', palate: 'full', teeth: { UR6: 'adams', UL4: 'ball', LR6: 'solc', LL2: 'pontic', LR2: 'finger', UL3: 'spur' }, reset: ['UR1'], accU: ['helical', 'cuspHook', 'habit'], habit: ['crib', 'spurs', 'bluegrass'], acrU: ['bowAcr', 'abp', 'scallop'], acrL: ['pbp'], flrL: 'll', flrPadsL: 'meshDist', flrWireL: 'braided', irU: 'single' };
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
