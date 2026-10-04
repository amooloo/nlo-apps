// Amir, 3 Oct 2026: "this is the form for herbst from specialty. can you include it in our case submission but the result would be
// on the paper that can be then exported. Also it could be customized more and basic information can be filled out" — then "I want
// diagrams to be drawn on the arches. kinda like how Easy Rx does it" and "add all the prices for all different pieces … so it would
// give me a total pricing at the end" — demo (made-up patients)
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-'));
  const today = await p.evaluate(() => todayISO());
  const rxNow = () => p.evaluate(() => JSON.parse(JSON.stringify(RXE.rx)));
  const est = () => p.evaluate(() => rxEstimate(RXE.rx).total);
  const tap = (g, v) => p.click('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]');
  const tooth = id => p.click('#rxArchBox .rxTooth[data-rxt=' + id + ']');
  const toastHas = re => p.evaluate(src => Array.from(document.querySelectorAll('.toast')).some(t => new RegExp(src).test(t.textContent)), re.source);
  const clearToasts = () => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const newAppliance = async () => { await p.evaluate(() => { closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); }); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(80); };
  const appl = v => p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="' + v + '"]');
  const rxShown = () => p.isVisible('#ncForm #cf-rxSec');
  const pdfText = file => has('pdftotext') ? execFileSync('pdftotext', ['-layout', file, '-']).toString() : null;

  // ---- New case: the Herbst Rx shows once a Herbst is going to Specialty
  await newAppliance();
  check(!(await rxShown()), 'New case, Appliance: no Herbst Rx before an appliance is tapped');
  await appl('MARA'); check(!(await rxShown()), 'MARA (Specialty, not a Herbst): no Herbst Rx');
  await appl('MARA'); await appl('Herbst with Rollo Band');
  check(await p.evaluate(() => pressed(document.querySelector('.modal'), 'lab')[0]) === 'Specialty Orthodontic Lab' && await rxShown() && /Fill out the Rx/i.test(await p.textContent('#cf-rxSec')), 'Herbst with Rollo Band → Specialty: the Herbst Rx shows (“Fill out the Rx”)');
  await p.click('#ncForm .pickRow[data-g=lab] .pick[data-v="Partners Dental Solutions"]'); check(!(await rxShown()), 'lab switched to Partners by hand: the Rx hides');
  await p.click('#ncForm .pickRow[data-g=lab] .pick[data-v="Specialty Orthodontic Lab"]'); check(await rxShown(), '… and back to Specialty: it shows again');
  const logoOk = await p.evaluate(() => { const i = document.querySelector('#cf-rxSec img[data-logo]'); return !!i && i.complete && i.naturalWidth > 0; });
  check(logoOk, 'the section carries Specialty’s logo');

  // ---- the Rx editor
  await p.fill('#ncForm #cf-patient', 'Harper Herbstman');
  const deliv = await p.evaluate(() => addDays(todayISO(), 6)); await p.fill('#ncForm #cf-deliveryDate', deliv);
  await p.click('#ncForm [data-rxform=edit]'); await p.waitForSelector('#rxWrap .rxArch.live');
  check(/Harper Herbstman/.test(await p.textContent('#rxWrap .rxHd')), 'the Rx opens over the form, with the patient’s name');
  check(await p.evaluate(() => document.querySelector('#app').inert && document.querySelector('#modalWrap').inert && !document.querySelector('#toasts').inert), 'while it’s open the page behind it is inert (toasts still work)');
  let outside = 0; for (let i = 0; i < 110; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && !a.closest('#rxWrap'); })) outside++; }
  check(outside === 0, 'Tab never leaves the Rx (110 presses)');
  const needAuto = await p.evaluate(d => prevClinicDay(d), deliv);
  check(await p.inputValue('#rxWrap [data-rxf=needed]') === needAuto && /office day before the delivery appt/.test(await p.textContent('#rxNeedHint')), 'Date needed filled in: the office day before the delivery appt (' + needAuto + ')');
  check(await p.inputValue('#rxWrap [data-rxf=shipped]') === today, 'Date shipped: today');
  check(await p.isVisible('#rxLead') && /10 business days/.test(await p.textContent('#rxLead')), 'needed in under 10 business days: a warning to tick the expedite approval');
  await tap('flag', 'rush'); check(!(await p.isVisible('#rxLead')), 'ticking the expedite approval clears the warning');
  await tap('design', 'cantilever'); await tap('mech', 'm4');
  check(Math.abs(await est() - 382) < .001 && /\$382\.00/.test(await p.textContent('#rxTot')), 'Cantilever Herbst $220.50 + M4 MiniScope $66.50 + the expedite fee $95 (Specialty’s case scheduling page) = est. $382.00 in the header');
  check(/\$220\.50/.test(await p.textContent('#rxWrap .rxB[data-rxg=design][data-v=cantilever]')) && /\+\$66\.50/.test(await p.textContent('#rxWrap .rxB[data-rxg=mech][data-v=m4]')), 'each choice shows its price ($220.50, +$66.50)');
  // what each design / mechanism is (Amir, 4 Oct 2026: "when they kind of hover over it or click on something, they can get more information")
  const card = g => p.evaluate(g => { const c = document.querySelector('#rxWrap .rxInfoCard[data-info=' + g + ']'), on = c.querySelector('.rxIc.on') || c; return { name: (on.querySelector('.rxIcHd b') || {}).textContent || '', peek: c.classList.contains('peek'), text: on.textContent, links: on.querySelectorAll('.rxIcSrc a[target=_blank]').length, h: c.getBoundingClientRect().height }; }, g);
  let cd = await card('design');
  check(cd.name === 'Cantilever Herbst' && !cd.peek && /lower first molars/.test(cd.text) && cd.links >= 1, 'the picked design is explained under the choices (Cantilever Herbst: the lower first molars carry the arm), with its sources');
  const h0 = cd.h; await p.hover('#rxWrap .rxB[data-rxg=design][data-v=acryliclower]'); cd = await card('design');
  check(cd.h === h0, 'the card keeps its height, so nothing moves under the pointer');
  check(cd.name === 'Band or Crown Upper / Acrylic Lower' && cd.peek && /acrylic splint/.test(cd.text), 'pointing at another design shows it instead (highlighted as a peek)');
  await p.hover('#rxArchBox'); cd = await card('design');
  check(cd.name === 'Cantilever Herbst' && !cd.peek, '… and moving away goes back to the picked one');
  await p.focus('#rxWrap .rxB[data-rxg=mech][data-v=hth]'); let cm = await card('mech');
  check(cm.name === 'HTH Telescope Mechanism' && /bulkiest/.test(cm.text), 'tabbing to a mechanism shows it too (HTH: Specialty calls it the bulkiest and recommends the M4)');
  await p.focus('#rxWrap [data-rxf=notes]'); cm = await card('mech');
  check(cm.name === 'M4 MiniScope (4-part)' && /64 mm/.test(cm.text), 'the M4 card: opens up to 64 mm …');
  // Amir's pictures (4 Oct 2026: "use these images in the RX sheet for herbst"): the Standard and Cantilever Herbst, the HTH and Flip-Lock
  const cardPic = g => p.evaluate(g => { const on = document.querySelector('#rxWrap .rxInfoCard[data-info=' + g + '] .rxIc.on'), i = on && on.querySelector('.rxIcPic img'); return i ? { pic: i.dataset.pic, ok: i.complete && i.naturalWidth > 0, w: Math.round(i.getBoundingClientRect().width) } : null; }, g);
  await p.focus('#rxWrap .rxB[data-rxg=design][data-v=standard]'); let pc = await cardPic('design');
  check(!!pc && pc.pic === 'herbst-standard' && pc.ok && pc.w === 240, 'the Standard Herbst card shows its picture, 240 px on the right');
  await p.focus('#rxWrap .rxB[data-rxg=design][data-v=spaceclosing]'); pc = await cardPic('design');
  check(pc === null, '… a design without a picture shows none');
  await p.focus('#rxWrap .rxB[data-rxg=mech][data-v=fliplock]'); pc = await cardPic('mech');
  check(!!pc && pc.pic === 'herbst-fliplock' && pc.ok, 'the Flip-Lock card shows its picture');
  check(await p.evaluate(() => ['standard', 'cantilever'].every(k => PICS[RX_INFO.design[k].pic]) && ['hth', 'fliplock'].every(k => PICS[RX_INFO.mech[k].pic])), 'pictures for the Standard and Cantilever Herbst and the HTH and Flip-Lock mechanisms');
  await p.focus('#rxWrap [data-rxf=notes]');
  check(await p.evaluate(() => RX_KEYS('design').every(k => RX_INFO.design[k].sum && RX_INFO.design[k].short && (RX_INFO.design[k].src || []).every(x => RX_SRC[x])) && RX_KEYS('mech').concat(['apple', 'shims', 'mio']).every(k => RX_INFO.mech[k] && RX_INFO.mech[k].sum && (RX_INFO.mech[k].src || []).every(x => RX_SRC[x]))), 'every design and mechanism (and AppleCore, shims, MIO) has its explanation and sources');
  await p.click('#rxWrap [data-rxa=cmp][data-g=design]');
  const cmpD = await p.evaluate(() => Array.from(document.querySelectorAll('#rxWrap .rxCmpBox[data-cmp=design] .rxCmpRow')).map(r => r.querySelector('b').textContent + '|' + r.querySelector('em').textContent));
  check(cmpD.length === 5 && cmpD[0] === 'Standard Herbst|$220.50' && cmpD[3] === 'Band or Crown Upper / Acrylic Lower|$293.50', 'Compare all: the five designs side by side with their prices');
  check(await p.evaluate(() => Array.from(document.querySelectorAll('#rxWrap .rxCmpBox[data-cmp=design] .rxCmpRow')).map(r => { const i = r.querySelector('.rxCmpPic img'); return i ? i.dataset.pic + (i.complete && i.naturalWidth > 0 ? '' : '!') : ''; }).join(',')) === 'herbst-standard,herbst-cantilever,,,', '… with the Standard and Cantilever pictures under their names');
  await p.click('#rxWrap [data-rxa=cmp][data-g=design]');
  check(!(await p.isVisible('#rxWrap .rxCmpBox[data-cmp=design]')), '… and it folds away again');
  await p.click('#rxWrap [data-rxa=cmp][data-g=mech]');
  check((await p.evaluate(() => document.querySelectorAll('#rxWrap .rxCmpBox[data-cmp=mech] .rxCmpRow').length)) === 6, 'Compare all for mechanisms: the five mechanisms and AppleCore screws');
  await (await p.evaluateHandle(() => document.querySelector('#rxWrap .rxInfoCard[data-info=mech]').closest('.rxS'))).screenshot({ path: OUT + '/v32-rx-mech-info.png' });
  await p.click('#rxWrap [data-rxa=cmp][data-g=mech]');
  // AppleCore screws go with the mechanism (separate boxes on Specialty's form)
  await tap('flag', 'apple');
  const ap = await p.evaluate(() => { const rx = RXE.rx, f = rxFill(RXE.c, rx); return { mech: rx.mech, apple: rx.apple, boxes: f.box.filter(b => /^mech\./.test(b)).sort().join(), sum: rxSummary(rx), miss: rxEstimate(rx).missing }; });
  check(ap.mech === 'm4' && ap.apple === true && ap.boxes === 'mech.applecore,mech.m4' && /M4 MiniScope \+ AppleCore screws/.test(ap.sum) && ap.miss.includes('AppleCore screws'), 'AppleCore screws go with the M4 (both circled on the form; summary “M4 MiniScope + AppleCore screws”; not priced)');
  await tap('flag', 'apple');
  check(JSON.stringify(await p.evaluate(() => rxCanon({ mech: 'applecore' }))) === '{"form":"specialty-herbst","apple":true}', 'an Rx saved with AppleCore as its mechanism reads as AppleCore screws');
  await tooth('UR6'); await tooth('UL6');
  check(JSON.stringify((await rxNow()).teeth) === '{"UR6":"band","UL6":"band"}' && /Bands:<\/b> UR6, UL6|Bands: UR6, UL6/.test(await p.innerHTML('#rxTeethSum')), 'tapping UR6 and UL6 bands them (“Bands: UR6, UL6”)');
  await tap('tool', 'crown'); await tooth('LR6'); await tooth('LL6');
  check(Math.abs(await est() - (382 + 2 * 17.75 + 2 * 21.5)) < .001, 'two bands ($17.75 ea) and two crowns ($21.50 ea) add up: est. $' + (382 + 35.5 + 43).toFixed(2));
  await tooth('LL6'); check(!(await rxNow()).teeth.LL6, 'tapping a crowned tooth again takes the crown off');
  await tooth('LL6');
  await clearToasts(); await tooth('UR1');
  check(await toastHas(/4s to 7s/) && !(await rxNow()).teeth.UR1, 'a front tooth isn’t on Specialty’s chart: it says so and changes nothing');
  await tap('tool', 'rest'); await tooth('UR5');
  check(JSON.stringify((await rxNow()).occl) === '["UR5"]' && /Occlusal rests:<\/b> UR5/.test(await p.innerHTML('#rxTeethSum')), 'Occlusal rest on UR5');
  await tap('tool', 'band'); await p.focus('#rxArchBox .rxTooth[data-rxt=LR4]'); await p.keyboard.press('Enter');
  check((await rxNow()).teeth.LR4 === 'band', 'keyboard: Enter on a focused tooth bands it');
  await tap('wire', 'la'); await tap('awt', 'U'); await tap('awtU', '022');
  await tap('flag', 'shims'); await p.fill('#rxWrap [data-rxf=shimsMm]', '2'); await p.press('#rxWrap [data-rxf=shimsMm]', 'Tab');
  check((await rxNow()).shimsMm === '2', 'Advancement shims: 2 mm');
  await tap('flag', 'shims'); await tap('flag', 'shims');
  check(!(await rxNow()).shimsMm && await p.inputValue('#rxWrap [data-rxf=shimsMm]') === '', 'shims off and on again: the 2 mm is gone from the Rx and from its box');
  await tap('flag', 'shims');
  await tap('awt', 'U'); await tap('awt', 'U');
  check(!(await rxNow()).awtU && await p.getAttribute('#rxWrap .rxB[data-rxg=awtU][data-v="022"]', 'aria-pressed') === 'false', 'upper tubes off and on: the .022 isn’t left showing');
  await tap('awtU', '022');
  check(!(await p.isVisible('#rxWrap .rxSub[data-show=rests]')), 'ball clasps / .032 / .036 wire show only once 2nd molar rests are picked');
  await tap('rests', 'U'); check(await p.isVisible('#rxWrap .rxSub[data-show=rests]'), '… and show with them'); await tap('rests', 'U');
  const drawn = await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path').length);
  check(drawn > 20, 'the appliance draws itself on the arches (' + drawn + ' shapes: bands, crowns, lingual arch, tubes, the Herbst)');
  await p.click('#rxWrap [data-rxa=auto]');
  check(await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path').length) === 0 && (await rxNow()).noAuto === true, '“Draw the appliance from the choices” off: the arches are left for drawing by hand');
  await p.click('#rxWrap [data-rxa=auto]');
  // drawing: pen, line, arrow; undo; clear (asks for a second tap)
  const box = await (await p.$('#rxArchBox svg')).boundingBox();
  const drag = async (pts) => { await p.mouse.move(box.x + box.width * pts[0][0], box.y + box.height * pts[0][1]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(box.x + box.width * q[0], box.y + box.height * q[1], { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(60); };
  await p.click('#rxWrap [data-rxtool=pen]'); await drag([[.30, .55], [.34, .58], [.38, .57], [.42, .60]]);
  await p.click('#rxWrap [data-rxtool=line]'); await drag([[.60, .55], [.70, .58]]);
  await p.click('#rxWrap [data-rxtool=arrow]'); await drag([[.25, .15], [.38, .28]]);
  let dr = (await rxNow()).draw || [];
  check(dr.map(s => s.t).join() === 'pen,line,arrow' && dr[0].p.length > 4 && dr[1].p.length === 4 && dr.every(s => s.c === 'r'), 'pen, line and arrow drawn (in red, the starting color)');
  check(await p.evaluate(() => document.querySelectorAll('#rxArchBox .rxDraw path[stroke="#DC2626"], #rxArchBox .rxDraw path[fill="#DC2626"]').length) >= 4, '… and shown on the arches (the arrow with its head)');
  await p.click('#rxWrap [data-rxcol=b]'); await drag([[.5, .5], [.55, .52]]);
  check(((await rxNow()).draw || []).slice(-1)[0].c === 'b', 'the blue pen draws in blue');
  await p.click('#rxWrap [data-rxa=undo]'); check(((await rxNow()).draw || []).length === 3, 'Undo takes back the last drawing');
  await p.click('#rxWrap [data-rxa=clearDraw]'); check(((await rxNow()).draw || []).length === 3 && /again/i.test(await p.textContent('#rxWrap [data-rxa=clearDraw]')), 'Clear drawing asks for a second tap first');
  await p.click('#rxWrap [data-rxa=clearDraw]'); check(!((await rxNow()).draw || []).length, '… then clears the drawings (the appliance stays)');
  await p.click('#rxWrap [data-rxcol=r]'); await p.click('#rxWrap [data-rxtool=arrow]'); await drag([[.25, .15], [.38, .28]]);
  await p.fill('#rxWrap [data-rxf=notes]', 'Please keep the cantilever arms low profile.');
  await p.mouse.move(5, 5); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/v32-rx-arches.png' });
  // the paper: Specialty's form with everything filled in
  await p.click('#rxWrap [data-rxtab=paper]'); await p.waitForSelector('#rxPaperBox .rxPaper img');
  await p.waitForFunction(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  const paper = await p.evaluate(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'), t = Array.from(document.querySelectorAll('#rxPaperBox svg text')).map(x => x.textContent);
    return { w: i.naturalWidth, h: i.naturalHeight, txt: t, dots: document.querySelectorAll('#rxPaperBox svg circle').length, rings: document.querySelectorAll('#rxPaperBox svg ellipse').length }; });
  console.log('   ' + JSON.stringify({ w: paper.w, h: paper.h, dots: paper.dots, rings: paper.rings }));
  check(paper.w === 1224 && paper.h === 1584, 'The paper: Specialty’s blank form (1224 × 1584 picture) loads under it');
  check(paper.txt.includes('Harper Herbstman') && paper.txt.includes('Amir Akhavan, DMD, MS') && paper.txt.includes('DEMO-0000') && paper.txt.includes(needAuto.slice(5, 7) + '/' + needAuto.slice(8) + '/' + needAuto.slice(0, 4)), '… patient, doctor, account # and the date needed are written on the lines');
  check(paper.txt.includes('Please keep the cantilever arms low profile.'), '… and the special instructions');
  check(paper.dots >= 10 && paper.rings === 6, '… the choices filled in (' + paper.dots + ' circles) and the anchorage/rest teeth circled on the grids (6)');
  await p.screenshot({ path: OUT + '/v32-rx-paper.png' });
  await p.click('#rxWrap [data-rxtab=arch]');
  // Esc doesn't throw the Rx (or the form under it) away
  await clearToasts(); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  check(await p.isVisible('#rxWrap') && await p.isVisible('#ncForm') && await toastHas(/Close without saving/), 'Esc with changes: asks first (the Rx and the New case form stay)');
  await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(await p.evaluate(() => !document.querySelector('#app').inert && !document.querySelector('#modalWrap').inert), 'closed: the page behind works again');
  const sum = await p.textContent('#cf-rxSum');
  check(/Cantilever Herbst · M4 MiniScope · 3 bands, 2 crowns/.test(sum) && /est\. \$/.test(sum) && /Edit the Rx/i.test(await p.textContent('#cf-rxSec')), 'Done: the form shows “Cantilever Herbst · M4 MiniScope · 3 bands, 2 crowns · est. $…” and Edit the Rx');
  await (await p.evaluateHandle(() => document.querySelector('#cf-rxSec'))).screenshot({ path: OUT + '/v32-rx-form.png' });
  await clearToasts(); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 });
  await p.waitForTimeout(500);
  check(await toastHas(/Herbst Rx ready for Specialty/), 'after Create: “Herbst Rx ready for Specialty — Download PDF”');
  const cid = await p.evaluate(() => (openCases().find(c => c.patient === 'Harper Herbstman') || {}).id);
  const saved = await p.evaluate(id => findCase(id).rx, cid);
  check(saved && saved.design === 'cantilever' && saved.mech === 'm4' && saved.teeth.LR4 === 'band' && saved.rush === true && saved.draw.length === 1 && saved.notes, 'the case keeps the Rx (choices, teeth, drawing, notes)');

  // ---- the case's Herbst Rx section
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rx]');
  const sec = await p.evaluate(() => { const s = document.querySelector('#drawer [data-ds=rx]'); return { t: s.querySelector('.dsT').textContent, sum: s.querySelector('.dsS').textContent, arch: s.querySelectorAll('.rxCaseArch .rxDraw path').length, tot: (s.querySelector('.rxTotRow') || {}).textContent, body: s.textContent }; });
  check(sec.t === 'Herbst Rx · Specialty' && /Cantilever Herbst/.test(sec.sum) && /est\. \$/.test(sec.sum), 'the case has “Herbst Rx · Specialty” with its summary and estimate');
  check(sec.arch > 10 && /Total\$/.test(sec.tot.replace(/\s/g, '')) && /Needed by/.test(sec.body), '… the drawn arches, the cost table with its total, and the date needed');
  await (await p.$('#drawer [data-ds=rx]')).screenshot({ path: OUT + '/v32-rx-case.png' });
  // Download PDF: Specialty's form, filled in
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#drawer [data-ds=rx] .pickRow [data-act=rxPdf]')]);
  check(dl.suggestedFilename() === 'Herbst Rx - Harper Herbstman - ' + today + '.pdf', 'Download PDF: “Herbst Rx - Harper Herbstman - ' + today + '.pdf”');
  const pdf = path.join(tmp, 'rx.pdf'); await dl.saveAs(pdf); const bytes = fs.readFileSync(pdf);
  const tail = bytes.slice(-80).toString('latin1'), sx = Number((tail.match(/startxref\s+(\d+)/) || [])[1]);
  check(bytes.slice(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(tail) && bytes.slice(sx, sx + 4).toString() === 'xref', 'the file is a PDF whose last cross-reference table is where it says');
  if (has('qpdf')) { let ok = true; try { execFileSync('qpdf', ['--check', pdf], { stdio: 'pipe' }); } catch (e) { ok = e.status === 3; } check(ok, 'qpdf --check: no errors'); }
  const txt = pdfText(pdf);
  if (txt != null) check(/Harper Herbstman/.test(txt) && /DEMO-0000/.test(txt) && /Gainesville/.test(txt) && txt.includes(needAuto.slice(5, 7) + '/' + needAuto.slice(8) + '/' + needAuto.slice(0, 4)) && /s\/ Amir Akhavan/.test(txt), 'the PDF’s text: patient, account #, address, date needed and the signature line');
  if (has('pdftoppm')) { execFileSync('pdftoppm', ['-r', '110', '-png', '-singlefile', pdf, OUT + '/v32-rx-pdf']); check(fs.existsSync(OUT + '/v32-rx-pdf.png'), 'the PDF renders (v32-rx-pdf.png)'); }
  // Open to print: a new tab with the PDF
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#drawer [data-ds=rx] [data-act=rxOpen]')]);
  check(/^blob:/.test(pop.url()), 'Open to print: the PDF opens in a new tab'); await pop.close();
  // Edit the Rx from the case
  await p.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await p.getAttribute('#rxWrap .rxB[data-rxg=mech][data-v=m4]', 'aria-pressed') === 'true', 'Edit the Rx opens with the saved choices');
  await tap('mech', 'hth'); await clearToasts(); await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' }); await p.waitForTimeout(400);
  check(await p.evaluate(id => findCase(id).rx.mech, cid) === 'hth' && await toastHas(/Herbst Rx saved/) && /HTH Telescope/.test(await p.textContent('#drawer [data-ds=rx] .dsS')), 'changed to HTH: saved, and the section shows it');
  check(await p.evaluate(() => /changed Herbst Rx/.test((document.querySelector('#histBox') || {}).textContent || '')), 'history: “changed Herbst Rx”');
  // × with no changes closes at once (nothing saved)
  await p.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap'); await p.click('#rxWrap [data-rxa=close]');
  check(!(await p.$('#rxWrap')), '× with nothing changed closes right away');
  // Edit the case: switching the lab away from Specialty drops the Rx
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .cf');
  check(await p.isVisible('#drawer #cf-rxSec') && /Edit the Rx/i.test(await p.textContent('#drawer #cf-rxSec')), 'Edit: the Herbst Rx is in the form');
  await p.click('#drawer .pickRow[data-g=lab] .pick[data-v="Partners Dental Solutions"]');
  check(!(await p.isVisible('#drawer #cf-rxSec')), 'Edit: lab → Partners hides it');
  await p.click('#drawer .pickRow[data-g=lab] .pick[data-v="Specialty Orthodontic Lab"]');
  await p.click('#drawer [data-act=cancelEdit]');

  // ---- Team & security → Lab Rx: Dr. A's details, prices, the usual Herbst
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin');
  check(await p.inputValue('#rxo-doctor') === 'Amir Akhavan, DMD, MS' && await p.inputValue('#rxo-address') === '320 NW 76th Drive', 'Lab Rx card: doctor and address filled in');
  await p.fill('#rxo-acct', 'DEMO-7777'); await p.press('#rxo-acct', 'Tab'); await p.waitForTimeout(200);
  check(await p.evaluate(() => S.settings.rxOffice.acct) === 'DEMO-7777', 'the account # saves (Team & security)');
  await p.fill('#rxo-license', ''); await p.press('#rxo-license', 'Tab'); await p.waitForTimeout(200);
  await p.fill('[data-rxprice=band]', '18.25'); await p.press('[data-rxprice=band]', 'Tab'); await p.waitForTimeout(200);
  check(JSON.parse(await p.evaluate(() => S.settings.rxPrices)).band === 18.25 && /\(list \$17\.75\)/.test(await p.textContent('#rxAdmin')), 'a price changed: $18.25, “(list $17.75)” next to it');
  await p.fill('[data-rxprice=shims]', '25'); await p.press('[data-rxprice=shims]', 'Tab'); await p.waitForTimeout(200);
  await (await p.$('#rxAdmin')).screenshot({ path: OUT + '/v32-rx-admin.png' });
  const e2 = await p.evaluate(() => rxEstimate({ design: 'standard', shims: true, teeth: { UR6: 'band', UL6: 'band' } }));
  check(Math.abs(e2.total - (220.5 + 25 + 2 * 18.25)) < .001 && e2.lines.some(l => /Advancement shims/.test(l.l) && /your price/.test(l.note)) && e2.lines.some(l => /Bands/.test(l.l) && /list \$17\.75/.test(l.note)), 'the estimate uses them: shims at “your price”, bands at $18.25 (list $17.75)');
  const e3 = await p.evaluate(() => rxEstimate({ design: 'standard', mech: 'applecore', teeth: { UR6: 'onbrace' }, crownOpt: ['lugs'] }));
  check(Math.abs(e3.total - 220.5) < .001 && e3.missing.join('|') === 'AppleCore screws|OnBRACE × 1|Lingual seating lugs', 'what has no price is named under the estimate and left out of the total');
  await p.click('#rxAdmin [data-act=rxPricesReset]'); await p.waitForTimeout(200);
  check(await p.evaluate(() => rxPrices().band) === 17.75 && await p.evaluate(() => rxPrices().shims) === null, 'Back to the price list');
  // the usual Herbst: saved from an Rx, new Rx start from it
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rx]');
  await p.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(/license #/.test(await p.textContent('#rxWrap .rxInfo .rxWarn')), 'no license # yet: the Rx says to add it once in Team & security');
  await tap('flag', 'mio'); await p.fill('#rxWrap [data-rxf=mioMm]', '45'); await p.press('#rxWrap [data-rxf=mioMm]', 'Tab');
  await clearToasts(); await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(200);
  const def = await p.evaluate(() => rxDefaults());
  check(def && def.mech === 'hth' && def.design === 'cantilever' && !def.notes && !def.draw && !def.rush && !def.mio && !def.mioMm && def.teeth.UR6 === 'band', '“Save as our usual Herbst”: the choices and teeth (not this patient’s MIO 45 mm, notes, drawing or rush)');
  await p.click('#rxWrap [data-rxa=close]'); await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' }); // (changed: × asks, then closes)
  check(await p.evaluate(id => !findCase(id).rx.mio, cid), '× twice: closed without saving the change');
  await newAppliance(); await appl('Herbst with Rollo Band'); await p.fill('#ncForm #cf-patient', 'Rowan Rolloband');
  await p.click('#ncForm [data-rxform=edit]'); await p.waitForSelector('#rxWrap');
  const st = await rxNow();
  check(st.design === 'cantilever' && st.mech === 'hth' && st.teeth.LR6 === 'crown' && !st.notes, 'a new Herbst Rx starts from the usual Herbst');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(await p.inputValue('#ncForm #cf-rx') === '', '… closed without Done: nothing is put on the case');
  await appl('Herbst with Rollo Band'); await appl('Space Closing Herbst');
  await p.click('#ncForm [data-rxform=edit]'); await p.waitForSelector('#rxWrap');
  check((await rxNow()).design === 'spaceclosing', 'Space Closing Herbst: its Rx starts on Space Closing Herbst');
  await p.click('#rxWrap [data-rxa=close]'); await p.evaluate(() => { const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin');
  check(/Cantilever Herbst · HTH Telescope/.test(await p.textContent('#rxAdmin')), 'Team & security shows the usual Herbst');
  await p.click('#rxAdmin [data-act=rxDefClear]'); await p.waitForTimeout(200);
  check(!(await p.evaluate(() => rxDefaults())), '… and Clear removes it');

  // ---- staff: no "Save as our usual Herbst"; the missing details are Dr. A's to add
  await p.evaluate(() => { DEMO._own = DEMO.isOwner; DEMO.isOwner = () => false; });
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rx]');
  await p.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(!(await p.$('#rxWrap [data-rxa=saveDef]')) && /Dr\. A still needs to add the license #/.test(await p.textContent('#rxWrap .rxInfo')), 'staff: no “Save as our usual Herbst”; “Dr. A still needs to add the license #”');
  await p.click('#rxWrap [data-rxa=close]'); await p.evaluate(() => { DEMO.isOwner = DEMO._own; });

  // ---- what goes on the paper: long text fits its line, accents print, a long note wraps
  const fit = await p.evaluate(() => {
    const c = { patient: 'Zoë Ñúñez-O’Brien Wolfeschlegelsteinhausenbergerdorff the Third', scanner: 'Allied Star', deliveryDate: addDays(todayISO(), 30), type: 'appliance', lab: LAB_SPEC, appliances: ['Herbst with Rollo Band'] };
    const f = rxFill(c, { design: 'standard', notes: 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(5) });
    const T = RXF.text, pt = f.txt.find(t => t.y === T.patient.y + 2.2), notes = f.txt.filter(t => t.x === 26);
    return { pz: pt.z, pw: rxWidth(pt.s, pt.font, pt.z), room: T.patient.x1 - T.patient.x0, ell: /…$/.test(pt.s), n: notes.length, nz: notes[0] && notes[0].z, nw: Math.max(...notes.map(t => rxWidth(t.s, 'H', t.z))), other: f.box.includes('scan.other') && f.txt.some(t => t.s === 'Allied Star'),
      str: rxPdfString('Zoë Ñúñez – O’Brien 字'), b64: (() => { const b = rxPdfBytes(f); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); })() };
  });
  check(fit.pw <= fit.room + .01 && fit.pz >= 6, 'a very long name shrinks (or is cut with …) to stay on its line (' + fit.pz + ' pt)');
  check(fit.n >= 4 && fit.n <= 7 && fit.nz >= 6.5 && fit.nw <= 556.01, 'a long special instruction wraps onto more, smaller lines inside the box (' + fit.n + ' lines at ' + fit.nz + ' pt)');
  check(fit.other, 'Allied Star isn’t on Specialty’s form: Other, with its name');
  const scans = await p.evaluate(() => ['iTero', 'TRIOS 5', 'Medit i700', 'Carestream', 'CEREC Primescan'].map(s => rxFill({ patient: 'X', scanner: s }, {}).box.filter(b => /^scan\./.test(b)).join()));
  check(scans.join() === 'scan.itero,scan.trios,scan.medit,scan.carestream,scan.cerec', 'scanners that are on the form get their own circle (iTero, TRIOS, Medit, Carestream, CEREC)');
  const nl = await p.evaluate(() => { const n = rxFill({ patient: 'X' }, { notes: Array.from({ length: 12 }, (_, i) => 'Line ' + (i + 1)).join('\n') }).txt.filter(t => t.x === 26), ys = n.map(t => t.y);
    const m = rxFill({ patient: 'X' }, { notes: Array.from({ length: 9 }, (_, i) => 'Instruction number ' + (i + 1) + ': keep everything exactly as the lab usually makes it for this kind of case').join('\n') }).txt.filter(t => t.x === 26), ms = m.map(t => t.y);
    return { n: n.length, first: n[0].s, m: m.length, gap: Math.min(...ms.slice(1).map((y, i) => ms[i] - y)), z: m[0].z }; });
  check(/^Line 1 · Line 2 · /.test(nl.first) && nl.n <= 7 && nl.m <= 7 && nl.gap >= nl.z, 'many short lines of instructions are joined with “·”; never more than 7 lines, none overlapping (' + nl.m + ' lines, ' + nl.gap.toFixed(1) + ' pt apart at ' + nl.z + ' pt)');
  const bad = await p.evaluate(() => { const rx = rxCanon({ draw: [{ t: 'pen', c: 'constructor', p: [4500, 2000, 4600, 2100] }, { t: 'line', c: 'r', p: [1e999, 'x', -5, 99999999] }] });
    const content = rxContent(rxFill({ patient: 'X' }, rx)); return { n: rx.draw.length, fin: rx.draw[0].p.every(Number.isFinite), ok: !/Infinity|NaN|e\+/.test(content) }; });
  check(bad.n === 1 && bad.fin && bad.ok, 'drawing data that isn’t right (an unknown color, Infinity, text) is dropped or kept inside the printed area; the PDF stays valid');
  const simp = await p.evaluate(() => { const line = [], wig = []; for (let i = 0; i < 500; i++) line.push(4300 + i, 2000 + i); for (let i = 0; i < 1500; i++) wig.push(4300 + i % 900, 2000 + Math.round(300 * Math.sin(i / 3))); return { line: rxSimplify(line, 2).length / 2, wig: rxSimplify(wig, 2).length / 2 }; });
  check(simp.line === 2 && simp.wig <= 400, 'a long pen stroke keeps its shape with fewer points (straight → 2 points; a 1,500-point squiggle → ' + simp.wig + ')');
  const vi = await p.evaluate(() => rxFill({ patient: 'Nguyễn Thị Ánh' }, {}).txt.find(t => t.y === RXF.text.patient.y + 2.2).s);
  check(vi === 'Nguyen Thi Ánh', 'letters the PDF’s fonts don’t have print as the plain letter (“Nguyễn Thị Ánh” → “Nguyen Thi Ánh”), the same on screen');
  check(fit.str === '(Zo\\353 \\321\\372\\361ez \\226 O\\222Brien ?)', 'accents and dashes print in the PDF’s own characters (a character it can’t print becomes “?”)');
  const lpdf = path.join(tmp, 'long.pdf'); fs.writeFileSync(lpdf, Buffer.from(fit.b64, 'base64'));
  const ltxt = pdfText(lpdf); if (ltxt != null) check(/Zoë Ñúñez-O’Brien/.test(ltxt) && /Allied Star/.test(ltxt), 'the PDF reads back “Zoë Ñúñez-O’Brien” and “Allied Star”');

  // ---- phone: the Rx fits (no sideways scrolling)
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rx]');
  check(await p.evaluate(() => document.querySelector('#drawer').scrollWidth <= document.querySelector('#drawer').clientWidth + 1), 'phone: the case’s Herbst Rx section fits');
  await p.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await p.evaluate(() => { const b = document.querySelector('#rxWrap .rxBox'), a = document.querySelector('#rxArchBox').getBoundingClientRect(), l = document.querySelector('#rxL').getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= 390 && a.top >= 0 && a.top < 600 && l.top > a.top; }), 'phone: the Rx editor fits, the arches first (in view), the choices under them');
  await p.screenshot({ path: OUT + '/v32-rx-phone.png' });
  await p.click('#rxWrap [data-rxa=close]');

  // ---- locking the app closes the Rx and forgets its case
  await p.setViewportSize({ width: 1440, height: 960 });
  await p.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  await p.evaluate(() => toast('Herbst Rx ready for Specialty', { action: 'Download PDF', ms: 12000, onAction: () => { } }));
  await p.evaluate(() => lockOut('Locked. Sign in to continue.')); await p.waitForSelector('#lockWrap:not(.hidden)');
  check(await p.evaluate(() => !document.querySelector('#rxWrap') && RXE.c === null && RXE.rx === null && !document.querySelector('#app').inert && !document.querySelectorAll('#toasts .toast').length && RX_URLS.size === 0), 'locking the app closes the Rx, forgets its case, and clears the toasts');

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  const real = errs;
  console.log('ERRORS:', real.length ? real.join('\n') : 'none');
  await browser.close();
  process.exit(fails || real.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
