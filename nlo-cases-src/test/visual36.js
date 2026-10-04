// Amir, 4 Oct 2026: the lower Schwarz goes to Specialty ("they still say partner dental solutions"; asked which lab: Specialty) on
// their Functional Rx, filled in with Dr. A's Schwarz from his Lab Rx — delta clasps on the 6s (Preferred), ball clasps at the D–E
// contacts (Recommended), the midline screw, no occlusal acrylic, the chairside steps; his clasp pictures and drawings; Specialty's
// standard colors only; a pontic's shade required — demo (made-up patients)
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rxf-'));
  const today = await p.evaluate(() => todayISO());
  const rxNow = () => p.evaluate(() => JSON.parse(JSON.stringify(RXE.rx)));
  const est = () => p.evaluate(() => rxEstimate(RXE.rx, RXE.c));
  const tap = (g, v) => p.click('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]');
  const on = (g, v) => p.getAttribute('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]', 'aria-pressed').then(x => x === 'true');
  const tool = k => p.click('#rxWrap [data-rxtool=' + k + ']');
  const tooth = id => p.click('#rxArchBox .rxTooth[data-rxt=' + id + ']');
  const notes = () => p.evaluate(() => rxNotesAll(RXE.rx));
  const toastHas = re => p.evaluate(src => Array.from(document.querySelectorAll('.toast')).some(t => new RegExp(src).test(t.textContent)), re.source);
  const clearToasts = () => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const newAppliance = async () => { await p.evaluate(() => { closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); }); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=appliance]'); await p.waitForTimeout(100); };
  const pick = (g, v) => p.click('#ncForm .pickRow[data-g=' + g + '] .pick[data-v="' + v + '"]');
  const funShown = () => p.isVisible('#ncForm #cf-rxFunSec');
  const pdfText = file => has('pdftotext') ? execFileSync('pdftotext', ['-layout', file, '-']).toString() : null;
  const settled = sel => p.evaluate(sel => new Promise(res => { let el = document.querySelector(sel), t = Date.now(); const t0 = t;
    const iv = setInterval(() => { const now = document.querySelector(sel); if (now !== el) { el = now; t = Date.now(); } else if (Date.now() - t > 400 || Date.now() - t0 > 5000) { clearInterval(iv); res(); } }, 40); }), sel);

  // ---- New case: the Schwarz goes to Specialty → the Functional Rx; Partners by hand → a line about Specialty instead
  await newAppliance();
  await pick('appliances', 'Schwartz'); await p.waitForTimeout(100);
  check(await p.evaluate(() => pressed(document.querySelector('.modal'), 'lab')[0]) === 'Specialty Orthodontic Lab' && await funShown() && !(await p.isVisible('#ncForm #cf-rxSec')) && !(await p.isVisible('#ncForm #cf-rxRetSec')),
    'Schwartz → Specialty (Amir, 4 Oct 2026; Partners before): the Functional Rx shows (not the Herbst or Retainer Rx)');
  check(/Functional Rx/.test(await p.textContent('#cf-rxFunSec')) && await p.evaluate(() => { const i = document.querySelector('#cf-rxFunSec img[data-logo]'); return !!i && i.complete && i.naturalWidth > 0; }), '… “Functional Rx” with Specialty’s logo');
  await pick('lab', 'Partners Dental Solutions');
  check(!(await funShown()) && /Going to Specialty instead\? Tap Specialty Orthodontic Lab and its Functional Rx fills in from this case/.test(await p.textContent('#cf-rxHint')), 'tapped over to Partners: no Functional Rx, one line that it’s there for Specialty');
  await pick('lab', 'Specialty Orthodontic Lab');
  // the color: Specialty's standard colors only for the Schwarz
  const pal = await p.evaluate(() => ({ off: document.querySelectorAll('#ncForm .acrS[aria-disabled=true]').length, forWho: document.querySelector('#ncForm #cf-acrFor').textContent }));
  check(pal.off === 24 && pal.forWho === 'for the Schwarz', 'Acrylic color “for the Schwarz”: glitter, glow, swirls and designs greyed out (24), Specialty’s standard colors to pick');
  await pick('acrylic', 'Teal'); await pick('scanner', 'iTero');
  await p.fill('#ncForm #cf-patient', 'Sasha Schwarzberg');
  const deliv = await p.evaluate(() => addDays(todayISO(), 30)); await p.fill('#ncForm #cf-deliveryDate', deliv);
  check(await p.inputValue('#ncForm #cf-detail') === 'Schwartz', 'what’s being made: “Schwartz”');

  // ---- the editor: Dr. A's lower Schwarz
  await p.click('#ncForm [data-rxform=edit][data-kind=fun]'); await p.waitForSelector('#rxWrap .rxArch.live');
  await p.waitForFunction(() => Array.from(document.querySelectorAll('#rxWrap .rxPc img')).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {});
  check(/Functional Rx/i.test(await p.textContent('#rxWrap #rxTitle')) && /Sasha Schwarzberg/.test(await p.textContent('#rxWrap .rxHd')), 'the Functional Rx opens with the patient’s name');
  let st = await rxNow();
  check(st.actL === 'schwarz' && !st.actU && st.exp === 'mid' && st.dent === 'mixed' && JSON.stringify(st.teeth) === '{"LR6":"delta","LR4":"ball","LL4":"ball","LL6":"delta"}' && /Full-time wear for several months/.test(st.notes),
    'it starts as Dr. A’s lower Schwarz: Schwarz – Transverse (lower), midline screw, delta clasps on the 6s, ball clasps behind the Ds, his notes for the lab');
  check(await p.evaluate(() => RXE.tool) === 'delta' && await on('actL', 'schwarz') && await on('exp', 'mid') && await on('claspL', 'delta') && await on('claspL', 'ball') && await on('dent', 'mixed'), '… the buttons say so (and the Delta tool is ready)');
  const pcs = await p.evaluate(() => Array.from(document.querySelectorAll('#rxWrap .rxPc')).map(b => b.dataset.v + ':' + ((b.querySelector('.rxSt:not([hidden])') || {}).textContent || '') + (b.querySelector('img') && b.querySelector('img').naturalWidth >= 300 ? '' : '(no picture)')));
  check(pcs.join() === 'delta:Preferred,ball:Recommended,adams:Alternative,arrowhead:Alternative,c:Not for this case', 'his clasps in pictures with his take for the Schwarz: Delta Preferred, Ball Recommended, Adams and Arrow Alternative, C Not for this case (' + pcs.join(' ') + ')');
  check(await p.evaluate(() => ['delta', 'ball', 'adams', 'arrowhead', 'c'].map(v => (document.querySelector('#rxWrap .rxUL[data-rxinfo="clasp:' + v + '"] .rxSt:not([hidden])') || {}).textContent).join()) === 'Preferred,Recommended,Alternative,Alternative,Not for this case', '… the same badges on the clasp rows');
  check(/Delta clasp:<\/b> #19, #30/.test(await p.innerHTML('#rxTeethSum')) && /Ball clasp \(behind it\):<\/b> K–L \(D–E\), S–T \(D–E\)/.test(await p.innerHTML('#rxTeethSum')), 'the teeth: “Delta clasp: #19, #30 · Ball clasp (behind it): K–L (D–E), S–T (D–E)” — the primary teeth lettered');
  let n = await notes();
  check(/^Delta clasps on #19 and #30 \(not on the form\): closed loops in the MB and DB undercuts, just gingival to the composite bumps/.test(n) && /Ball clasps at K–L and S–T \(the D–E contacts\): just gingival to the contact, clear of the papilla\./.test(n) && /No occlusal acrylic \(lower\)\./.test(n),
    'written into the special instructions: the delta clasps with their teeth (they aren’t on the form), the ball clasps at K–L and S–T (the D–E contacts), no occlusal acrylic');
  check(await p.evaluate(() => { const c = document.querySelector('#rxWrap .rxInfoCard[data-info=act] .rxIc.on'); return !!c && /Schwarz – Transverse/.test(c.textContent) && !!c.querySelector('.rxIcPic.svg svg'); }), 'the active design’s card: Specialty’s Schwarz, with the drawing of Dr. A’s lower Schwarz');
  await p.hover('#rxWrap .rxPc[data-v=delta]');
  check(await p.evaluate(() => { const o = document.querySelector('#rxWrap .rxInfoCard[data-info=clasp] .rxIc.on'); return !!o && /Preferred for this Schwarz: Closed loops keep their grip/.test(o.textContent) && !!o.querySelector('img[data-pic=clasp-delta]') && !!o.querySelector('.rxIcDraw svg'); }),
    'pointing at the Delta picture: “Preferred for this Schwarz: …”, his photo and the drawings');
  // the chairside steps
  const chk = await p.evaluate(() => Array.from(document.querySelectorAll('#rxChk .rxB')).map(b => b.textContent));
  check(await p.isVisible('#rxChk') && chk.length === 3 && /composite bumps at the MB and DB line angles of #19 and #30/.test(chk[0]) && /K–L \(D–E\), S–T \(D–E\)/.test(chk[1]) && /after the bumps are on/.test(chk[2]), 'Before the scan: the composite bumps on #19 and #30, the contacts the ball clasps cross, scan after the bumps (not on the form)');
  await p.click('#rxChk .rxB[data-v=bumps]');
  check(JSON.stringify((await rxNow()).chk) === '["bumps"]' && await p.evaluate(() => !rxFill(RXE.c, RXE.rx).txt.some(t => /composite bumps at/.test(t.s))), '… ticking one keeps it with the Rx (it doesn’t print)');
  // the estimate: the Schwarz isn't on the price list here; its standard clasps and screw come with it
  let e = await est();
  check(e.missing.includes('Schwarz – Transverse · lower') && e.missing.some(m => /^Delta clasps · lower × 1 pr/.test(m)) && e.lines.some(l => l.l === 'Ball clasps · lower × 1 pr' && /With the Schwarz/.test(l.inc)) && e.lines.some(l => l.l === 'Midline screw' && l.inc) && e.lines.some(l => l.l === 'Acrylic: Teal · lower' && /Free/.test(l.inc)),
    'estimate: the Schwarz and the delta clasps named as not on the list; a pair of ball clasps and the midline screw come with it; Teal is free');
  // permanent teeth: numbers, not letters
  await tap('dent', 'perm'); n = await notes();
  check(/Ball clasps at #20–#21 and #28–#29: just gingival/.test(n) && !/D–E/.test(n), 'Teeth named for the permanent dentition: the ball clasps at #20–#21 and #28–#29');
  await tap('dent', 'mixed');
  // occlusal coverage: the Schwarz comes with it unless the Rx says no
  await tap('acL', 'occl'); n = await notes(); e = await est();
  check(!/No occlusal acrylic/.test(n) && e.lines.some(l => l.l === 'Occlusal acrylic · lower' && /Standard on the Schwarz/.test(l.inc)) && !(await p.isVisible('#rxWrap .rxSub[data-show=noOccl]')), 'Occlusal Coverage · L: the “No occlusal acrylic” line goes (it’s standard on the Schwarz)');
  await tap('acL', 'occl');
  check(/No occlusal acrylic \(lower\)/.test(await notes()) && await p.isVisible('#rxWrap .rxSub[data-show=noOccl]'), '… off again: back in the special instructions, with the note why');
  // the color: the case's Teal; Specialty's standard colors only
  check(/Lower:\s*Teal\s*\(the case’s\)/.test(await p.textContent('#rxAcrNow')) && await on('acrFor', 'L') && await on('acrPick', 'Teal'), 'the color: the case’s Teal on the lower (the arch with the Schwarz)');
  check(await p.evaluate(() => document.querySelectorAll('#rxWrap .rxSw[aria-disabled=true]').length) === 24, 'glitter, glow, swirls and designs greyed out for the Schwarz');
  await clearToasts(); await p.click('#rxWrap .rxSw[data-v="Party mix glitter"]', { force: true });
  check(!(await rxNow()).colorL && await toastHas(/standard colors only/), '… tapping one says why and changes nothing');
  await tap('acrPick', 'Black cherry');
  check((await rxNow()).colorL === 'Black cherry' && /Black cherry/.test(await p.textContent('#rxAcrNow')), 'Black cherry tapped: the lower is Black cherry for this Rx');
  await tap('acrPick', 'Black cherry'); check(!(await rxNow()).colorL, '… tapped again: back to the case’s Teal');
  // a pontic: its shade is required
  await tool('pontic'); await tooth('LL3');
  check(await p.isVisible('#rxWrap .rxSub[data-show=pontic]') && await p.evaluate(() => document.querySelector('#rxWrap .rxShade').classList.contains('rxNeedOn')), 'a pontic on LL3: its shade shows, marked required');
  await clearToasts(); await p.click('#rxWrap [data-rxa=done]'); await p.waitForTimeout(150);
  check(await p.isVisible('#rxWrap') && await toastHas(/Add the pontic shade first/), 'Done waits for the shade');
  await tap('ponticShade', 'B1');
  check(/Pontic on M, shade B1\./.test(await notes()), '… B1 tapped: “Pontic on M, shade B1.” in the special instructions (the primary canine lettered)');
  await tooth('LL3'); check(!Object.values((await rxNow()).teeth).includes('pontic') && !(await rxNow()).ponticTxt, '… the pontic tapped off: the shade goes with it');
  // screws
  await tap('exp', 'other');
  check(await p.isVisible('#rxWrap [data-rxf=screwOther]'), 'Other Screw Design: its line to write it on');
  await p.fill('#rxWrap [data-rxf=screwOther]', 'Variety 8 mm'); await p.press('#rxWrap [data-rxf=screwOther]', 'Tab');
  let fill = await p.evaluate(() => rxFill(RXE.c, RXE.rx));
  check(fill.box.includes('exp.other') && fill.txt.some(t => t.s === 'Variety 8 mm') && (await est()).missing.includes('Screw: Variety 8 mm'), '… “Variety 8 mm” on the form’s line (not on the price list)');
  await tap('exp', 'mid');
  // drawn: the plate in Teal, the screw, the clasps
  const dr = await p.evaluate(() => { const d = rxAuto(RXE.rx, RXE.c); return { n: d.length, tint: d.some(x => x.f === rxrTint('Teal').f), screw: d.some(x => x.f === '#D5D9DE'), tri: d.filter(x => x.f === '#FFFFFF' && x.d.length === 4).length }; });
  check(dr.n > 8 && dr.tint && dr.screw && dr.tri === 4, 'drawn on Specialty’s arches: the lower plate in a tint of Teal, the midline screw, the two delta clasps’ closed loops and the ball clasps');
  await p.mouse.move(5, 5); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/v36-rxf-editor.png' });
  await (await p.$('#rxArchBox')).screenshot({ path: OUT + '/v36-rxf-arches.png' });
  // the paper
  await p.click('#rxWrap [data-rxtab=paper]'); await p.waitForSelector('#rxPaperBox .rxPaper img');
  await p.waitForFunction(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  const paper = await p.evaluate(() => { const i = document.querySelector('#rxPaperBox .rxPaper img'); return { src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight, txt: Array.from(document.querySelectorAll('#rxPaperBox svg text')).map(x => x.textContent) }; });
  check(paper.src === 'nlo-cases-rx-functional.png' && paper.w === 1224 && paper.h === 1584, 'The paper: Specialty’s blank Functional Rx loads under it');
  fill = await p.evaluate(() => rxFill(RXE.c, RXE.rx));
  const boxes = fill.box.slice().sort().join();
  check(['act.schwarz.L', 'exp.mid', 'wc.ball.L', 'color.L', 'scan.itero'].every(k => fill.box.includes(k)) && !fill.box.some(k => /delta|occl|bow/.test(k)), 'the form’s circles: Schwarz – Transverse L, Midline Screw Only, Ball Clasps L, Acrylic Color L, iTero (' + boxes + ')');
  check(paper.txt.includes('Sasha Schwarzberg') && paper.txt.includes('Teal'), '… the patient and Teal on their lines');
  const nl = await p.evaluate(() => { const F = RX_FORMS[RX_FUN], f = rxFill(RXE.c, RXE.rx), t = f.txt.filter(x => x.x === 26); return { n: t.length, onLines: t.every((x, i) => Math.abs(x.y - (F.notes[i] + 2)) < .01) }; });
  check(nl.n >= 2 && nl.n <= 4 && nl.onLines, 'the special instructions sit on the form’s four ruled lines (' + nl.n + ' lines)');
  await p.screenshot({ path: OUT + '/v36-rxf-paper.png' });
  await p.click('#rxWrap [data-rxtab=arch]');
  await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Schwarz – Transverse \(lower\) · Midline Screw Only · 2 delta, 2 ball clasps/.test(await p.textContent('#cf-rxFunSum')) && /not on the price list yet/.test(await p.textContent('#cf-rxFunSum')) && /Edit the Rx/.test(await p.textContent('#cf-rxFunSec')),
    'Done: “Schwarz – Transverse (lower) · Midline Screw Only · 2 delta, 2 ball clasps · not on the price list yet”, and Edit the Rx');
  await clearToasts(); await p.click('#ncSave'); await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }); await p.waitForTimeout(700);
  check(await toastHas(/Functional Rx ready for Specialty/), 'after Create: “Functional Rx ready for Specialty — Download PDF”');
  const cid = await p.evaluate(() => (openCases().find(c => c.patient === 'Sasha Schwarzberg') || {}).id);
  const saved = await p.evaluate(id => { const c = findCase(id); return { fun: c.rxFun, rx: c.rx, ret: c.rxRet, lab: c.lab, acr: c.acrylic }; }, cid);
  check(saved.fun && saved.fun.form === 'specialty-functional' && saved.fun.actL === 'schwarz' && saved.fun.teeth.LR6 === 'delta' && JSON.stringify(saved.fun.chk) === '["bumps"]' && !saved.rx && !saved.ret && saved.lab === 'Specialty Orthodontic Lab' && saved.acr === 'Teal',
    'the case keeps the Functional Rx (and no Herbst or Retainer Rx), Specialty and Teal');

  // ---- the case's Functional Rx section, the PDF
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxFun]');
  const sec = await p.evaluate(() => { const s = document.querySelector('#drawer [data-ds=rxFun]'); return { t: s.querySelector('.dsT').textContent, sum: s.querySelector('.dsS').textContent, arch: s.querySelectorAll('.rxCaseArch .rxDraw path').length, body: s.textContent }; });
  check(sec.t === 'Functional Rx · Specialty' && /Schwarz – Transverse \(lower\)/.test(sec.sum) && sec.arch > 8 && /Needed by/.test(sec.body) && /Delta clasps on #19 and #30/.test(sec.body), 'the case has “Functional Rx · Specialty”: summary, the drawn arches, the date needed, the special instructions');
  await (await p.$('#drawer [data-ds=rxFun]')).screenshot({ path: OUT + '/v36-rxf-case.png' });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#drawer [data-ds=rxFun] .pickRow [data-act=rxPdf]')]);
  check(dl.suggestedFilename() === 'Functional Rx - Sasha Schwarzberg - ' + today + '.pdf', 'Download PDF: “Functional Rx - Sasha Schwarzberg - ' + today + '.pdf”');
  const pdf = path.join(tmp, 'rxf.pdf'); await dl.saveAs(pdf); const bytes = fs.readFileSync(pdf);
  const tail = bytes.slice(-80).toString('latin1'), sx = Number((tail.match(/startxref\s+(\d+)/) || [])[1]);
  check(bytes.slice(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(tail) && bytes.slice(sx, sx + 4).toString() === 'xref', 'a PDF whose last cross-reference table is where it says');
  if (has('qpdf')) { let ok = true; try { execFileSync('qpdf', ['--check', pdf], { stdio: 'pipe' }); } catch (x) { ok = x.status === 3; } check(ok, 'qpdf --check: no errors'); }
  if (has('pdfinfo')) check(/Pages:\s+1/.test(execFileSync('pdfinfo', [pdf]).toString()), 'Specialty’s one-page form');
  const txt = pdfText(pdf);
  if (txt != null) check(/Sasha Schwarzberg/.test(txt) && /DEMO-0000/.test(txt) && /Teal/.test(txt) && /Delta clasps on #19 and #30/.test(txt) && /K–L and S–T/.test(txt) && /s\/ Amir Akhavan/.test(txt), 'the PDF’s text: patient, account #, Teal, the delta clasps and where the ball clasps go, the signature');
  if (has('pdftoppm')) { execFileSync('pdftoppm', ['-r', '110', '-png', '-singlefile', pdf, OUT + '/v36-rxf-pdf']); check(fs.existsSync(OUT + '/v36-rxf-pdf.png'), 'the PDF renders (v36-rxf-pdf.png)'); }
  await p.click('#drawer [data-ds=rxFun] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await on('actL', 'schwarz') && await on('claspL', 'delta') && await p.evaluate(() => RXE.tool) === 'delta', 'Edit the Rx opens with the saved choices');
  await tap('wcL', 'bow'); await clearToasts(); await p.click('#rxWrap [data-rxa=done]'); await p.waitForSelector('#rxWrap', { state: 'detached' }); await p.waitForTimeout(400);
  check(await p.evaluate(id => (findCase(id).rxFun.wcL || []).includes('bow'), cid) && await toastHas(/Functional Rx saved/), 'a lower labial bow added: saved');

  // ---- Team & security: the Functional Rx's prices and our usual Schwarz
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin'); await settled('#rxAdmin');
  check(/Functional Rx/.test(await p.textContent('#rxAdmin')) && await p.inputValue('[data-rxprice=schwarz]') === '' && /Herbst, retainers, metal appliances, Schwarz/.test(await p.textContent('#rxAdmin')), 'Lab Rx card: the Functional Rx’s prices (the Schwarz blank: not on the list)');
  await p.fill('[data-rxprice=schwarz]', '215'); await p.press('[data-rxprice=schwarz]', 'Tab');
  await p.waitForFunction(() => rxPrices().schwarz === 215, null, { timeout: 5000 }).catch(() => {}); await settled('#rxAdmin');
  const e2 = await p.evaluate(() => rxEstimate({ form: RX_FUN, actL: 'schwarz', exp: 'mid', teeth: { LR4: 'ball', LL4: 'ball' } }));
  check(e2.total === 215 && /your price/.test(e2.lines.find(l => /Schwarz/.test(l.l)).note), 'a Schwarz price entered ($215): the estimate adds it (“your price”)');
  await p.click('#rxAdmin [data-act=rxPricesReset]'); await p.waitForTimeout(200);
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxFun]');
  await p.click('#drawer [data-ds=rxFun] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  await tool('pontic'); await tooth('LR3'); await tap('ponticShade', 'A1');
  await clearToasts(); await p.click('#rxWrap [data-rxa=saveDef]'); await p.waitForTimeout(250);
  const def = await p.evaluate(() => rxDefaults(RX_FUN));
  check(def && def.actL === 'schwarz' && def.teeth.LR6 === 'delta' && !Object.values(def.teeth).includes('pontic') && !def.ponticTxt && !def.colorL && !def.notes && !def.chk, '“Save as our usual Schwarz”: the design and clasps — not this patient’s pontic, colors, notes or checklist');
  await p.click('#rxWrap [data-rxa=close]'); await p.waitForTimeout(100); await p.click('#rxWrap [data-rxa=close]').catch(() => {}); await p.waitForSelector('#rxWrap', { state: 'detached' });
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-admin'); await p.waitForSelector('#rxAdmin'); await settled('#rxAdmin');
  check(/Our usual Schwarz/.test(await p.textContent('#rxAdmin')), 'Team & security shows our usual Schwarz');
  await p.click('#rxAdmin [data-act=rxDefClear][data-slot=specialty-functional]'); await p.waitForTimeout(200);
  check(!(await p.evaluate(() => rxDefaults(RX_FUN))), '… and Clear removes it');

  // ---- the demo's Schwarz on hold has its Functional Rx
  const demo = await p.evaluate(() => (openCases().find(c => (c.appliances || []).includes('Schwartz') && c.rxFun) || {}).id);
  await p.evaluate(id => openDrawer(id), demo); await p.waitForSelector('#drawer [data-ds=rxFun]');
  check(/Schwarz – Transverse \(lower\)/.test(await p.textContent('#drawer [data-ds=rxFun]')) && /Pink/.test(await p.textContent('#drawer [data-ds=rxFun]')), 'the demo’s Schwarz shows its Functional Rx (Pink acrylic)');
  await p.evaluate(() => closeDrawer(true));

  // ---- odds and ends: anything not on the form is dropped; every part drawn stays in the arch area
  const junk = await p.evaluate(() => rxCanon({ form: RX_FUN, actL: 'nord', actU: 'nord', fn: 'zzz', exp: 'mid', teeth: { LR6: 'delta', LL6: 'x', ZZ9: 'ball' }, xsL: ['hg', 'pads'], xsU: ['hg'], acL: ['occl', 'nope'], dent: 'odd', chk: ['bumps', 'zz'], colorL: 'y'.repeat(60) }));
  check(JSON.stringify(junk) === JSON.stringify({ form: 'specialty-functional', actU: 'nord', exp: 'mid', teeth: { LR6: 'delta' }, xsU: ['hg'], xsL: ['pads'], acL: ['occl'], colorL: 'y'.repeat(40), chk: ['bumps'] }), 'an Rx with anything that isn’t on the form keeps only what is (Nord is upper only; HG tubes too)');
  const geo = await p.evaluate(() => { const rx = { form: RX_FUN, fn: 'tbClark', actU: 'fan', actL: 'schwarz', exp: 'sag2', wcU: ['bow'], wcL: ['bow'], xsU: ['hg', 'pads'], xsL: ['pads'], acU: ['occl', 'abp', 'bowAcr'], acL: ['occl'],
      teeth: { UR6: 'adams', UL6: 'delta', UR7: 'arrowhead', UL4: 'ball', LR6: 'c', LL6: 'delta', LR4: 'arrowhead', LR5: 'arrowhead', LL3: 'pontic' } };
    const out = []; ['none', 'mid', 'mid2', 'sag2', 'fan', 'other'].forEach(ex => { const list = rxAuto(Object.assign({}, rx, { exp: ex }), { acrylic: 'Red' }), [x, y, w, h] = RX_FORMS[RX_FUN].clip; let bad = 0;
      list.forEach(s => s.d.forEach(o => { for (let i = 1; i < o.length; i += 2) { if (o[i] < x - 3 || o[i] > x + w + 3 || o[i + 1] < y - 3 || o[i + 1] > y + h + 3 || !Number.isFinite(o[i]) || !Number.isFinite(o[i + 1])) bad++; } }));
      out.push({ n: list.length, bad, nan: /NaN|Infinity/.test(rxContent(rxFill({ patient: 'X' }, Object.assign({}, rx, { exp: ex })))) }); });
    return out; });
  check(geo.every(g => g.n > 40 && !g.bad && !g.nan), 'every part drawn at once, with each screw design (' + geo.map(g => g.n).join('/') + ' shapes), stays inside the arch area with no bad numbers in the PDF');

  // ---- phone: it fits
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer [data-ds=rxFun]');
  await p.click('#drawer [data-ds=rxFun] [data-act=rxEdit]'); await p.waitForSelector('#rxWrap');
  check(await p.evaluate(() => { const b = document.querySelector('#rxWrap .rxBox'); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= 390; }), 'phone: the Functional Rx fits');
  await p.evaluate(() => document.querySelector('#rxWrap .rxPcs').scrollIntoView());
  await p.screenshot({ path: OUT + '/v36-rxf-phone.png' });
  await p.click('#rxWrap [data-rxa=close]');
  await p.setViewportSize({ width: 1440, height: 960 });

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
