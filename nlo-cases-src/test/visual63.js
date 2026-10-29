// Amir, 29 Oct 2026: "in case tracker, for submitting aligners, it should ask for which stage they are in at the scan apointment.
// Also there should be a link to dentalmonitroing for all the oliv pts."
// 1. New case asks the stage (the aligner the patient is wearing) on every aligner set that isn't a first set — a refinement, a
//    mid-course correction, finishing aligners — one box per treated arch (the lower follows the upper until it's typed into), or
//    Not wearing aligners; New case won't go on without it. It shows on the case, the Review step, the chart note, the export.
// 2. Every Oliv patient has Dental Monitoring one click away: their row in the lists, their card on the board, the case panel —
//    it opens DM in a new tab and copies the name, without opening the case. Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
const DM = 'https://dental-monitoring.com/doctor/login';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, locale: 'en-US' }); await routes(ctx);
  // (Dental Monitoring itself isn't loaded: a stand-in page answers for it)
  let dmHits = 0; await ctx.route('https://dental-monitoring.com/**', r => { dmHits++; r.fulfill({ status: 200, contentType: 'text/html', body: '<title>DM stand-in</title>' }); });
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(URL); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });

  const F = '#ncForm ';
  const pick = (g, v) => p.click(F + '.pickRow[data-g=' + g + '] .pick[data-v="' + v + '"]');
  const st = () => p.evaluate(() => {
    const w = document.querySelector('#modalWrap #cf-stWrap') || document.querySelector('#drawer #cf-stWrap'), root = w && w.closest('#modalWrap, #drawer');
    if (!w) return null; const o = readCaseForm(root), q = s => w.querySelector(s), vis = el => !!el && !el.hidden && !!el.offsetParent;
    return { shown: vis(w), up: vis(q('#cf-stFU')), lo: vis(q('#cf-stFL')), u: q('#cf-scanStU').value, l: q('#cf-scanStL').value, dis: q('#cf-scanStU').disabled && q('#cf-scanStL').disabled,
      none: q('#cf-scanStNone').getAttribute('aria-pressed') === 'true', hint: q('#cf-stHint').textContent, bad: q('#cf-stHint').classList.contains('bad'), need: w.classList.contains('need'),
      o: { u: o.scanStU, l: o.scanStL, n: o.scanStNone }, step: root._wiz ? root._wiz.cur : '' };
  });
  const err = () => p.evaluate(() => ((document.querySelector('#ncErr') || {}).textContent || '').trim());
  const newCase = async (name, chart, tile) => {
    await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
    await p.fill(F + '#cf-patient', name); await p.fill(F + '#cf-chart', chart); await p.click(F + '.tt[data-tile=' + tile + ']');
    await p.click('#ncNext'); await p.waitForTimeout(120);
  };
  const toReview = async () => { for (let i = 0; i < 8 && !(await p.isVisible('#ncSave')); i++) { await p.click('#ncNext'); await p.waitForTimeout(100); if (await err()) return false; } return p.isVisible('#ncSave'); };
  const create = async () => {
    await p.click('#ncSave'); await p.waitForTimeout(300);
    if (await p.isVisible('#ncDupOk').catch(() => false)) { await p.click('#ncDupOk'); await p.waitForTimeout(200); }
    await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  };
  const saved = name => p.evaluate(n => { const c = openCases().filter(x => x.patient === n).sort((a, b) => b.createdAt - a.createdAt)[0];
    return c ? { id: c.id, u: c.scanStU, l: c.scanStL, n: c.scanStNone, note: chartNote(c, 'scan'), csv: caseToCSVRow(c) } : null; }, name);
  const badge = () => p.evaluate(() => { const b = document.querySelector('#drawer .dHd .sub .badge.t-stage'); return b ? b.textContent : ''; });
  const closeModal_ = () => p.evaluate(() => { if (document.querySelector('#modalWrap')) closeModal(); });

  console.log('\n# New case, Oliv: asked on a refinement, not on a first set');
  await newCase('Stella Stagewell', '61-0001', 'oliv');
  let s = await st();
  check(s && !s.shown, 'nothing picked yet: the stage isn’t asked');
  await pick('initial', 'yes'); s = await st();
  check(!s.shown, 'Yes — first set: not asked (a first set has no stage yet)');
  await pick('initial', 'no'); await p.waitForTimeout(80); s = await st();
  check(s.shown && s.up && s.lo && !s.none && s.u === '' && s.l === '', 'No — refinement: “Stage at the scan appointment”, an Upper and a Lower box, and Not wearing aligners');
  check(/Stage at the scan appointment/.test(await p.textContent('#cf-stLbl')) && /wearing today/.test(await p.textContent('#cf-stLbl')), 'it says what it means: the aligner the patient is wearing today');
  await p.screenshot({ path: OUT + '/v63-ask.png' });
  await p.click('#ncNext'); await p.waitForTimeout(150); s = await st();
  check(s.step === 'case' && s.need && /Enter the stage the patient is in at the scan \(upper and lower\), or tap Not wearing aligners\./.test(await err()), 'Next without it: stays on Case, outlined, and says what’s missing');
  check(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'cf-scanStU', '… with the Upper box ready to type in');
  await p.screenshot({ path: OUT + '/v63-need.png' });
  await p.keyboard.type('14'); await p.waitForTimeout(80); s = await st();
  check(s.u === '14' && s.l === '14' && /Lower filled in from upper/.test(s.hint), 'typing 14 in Upper fills Lower with 14, and says so');
  check(!s.need && !(await err()), 'the outline and the message go once it’s typed');
  await p.fill(F + '#cf-scanStL', '12'); await p.waitForTimeout(60); s = await st();
  check(s.l === '12' && !/Lower filled in/.test(s.hint) && s.o.u === 14 && s.o.l === 12, 'Lower changed to 12: it keeps its own number now (14 / 12)');
  await p.fill(F + '#cf-scanStU', '15'); await p.waitForTimeout(60); s = await st();
  check(s.u === '15' && s.l === '12', '… and no longer follows Upper (15 / 12)');
  await p.fill(F + '#cf-scanStU', '14');
  await p.fill(F + '#cf-scanStU', '140'); await p.waitForTimeout(60); s = await st();
  check(s.bad && /number from 1 to 99/.test(s.hint) && s.o.u === '', 'a stage past 99 isn’t taken (and the hint says so)');
  await p.fill(F + '#cf-scanStU', '14'); await p.waitForTimeout(60);
  check(await toReview(), 'with both stages in, it goes on to Review');
  const rv = await p.evaluate(() => Array.from(document.querySelectorAll('#wizSum .wsRow')).map(r => r.querySelector('.k').textContent + ': ' + r.querySelector('.v').textContent));
  check(rv.includes('Stage at scan: U 14 · L 12'), 'Review: “Stage at scan  U 14 · L 12”');
  await p.screenshot({ path: OUT + '/v63-review.png' });
  await create(); let c = await saved('Stella Stagewell');
  check(c && c.u === 14 && c.l === 12 && c.n === '', 'saved: scanStU 14, scanStL 12');
  await p.evaluate(id => openDrawer(id), c.id); await p.waitForSelector('#drawer .dHd'); await p.waitForTimeout(150);
  check(await badge() === 'Stage at scan: U 14 · L 12', 'the case: a badge under the name, “Stage at scan: U 14 · L 12”');
  const L = c.note.split('\n');
  check(/^Scanned with Allied Star for Oliv aligners - refinement 1\.$/.test(L[0]) && L[1] === 'Stage at scan: upper 14, lower 12.', 'the scan visit’s chart note, second line: “Stage at scan: upper 14, lower 12.”');
  check(c.csv.endsWith(',"U 14 · L 12"') || c.csv.endsWith(',U 14 · L 12'), 'the export’s last column: U 14 · L 12');
  check(await p.evaluate(id => !/U 14/.test(caseToCSVRow(Object.assign({}, findCase(id), { initial: 'yes' }))), c.id), '… and nothing there for a case that doesn’t ask it');
  await p.screenshot({ path: OUT + '/v63-panel.png', clip: { x: 760, y: 0, width: 600, height: 300 } });
  await p.evaluate(() => closeDrawer());

  console.log('\n# Upper only: just the upper box');
  await newCase('Uma Upperonly', '61-0002', 'oliv'); await pick('treatArch', 'U'); await pick('initial', 'no'); await p.waitForTimeout(60); s = await st();
  check(s.shown && s.up && !s.lo, 'Upper only: only the Upper box');
  await p.click('#ncNext'); await p.waitForTimeout(100);
  check(/\(upper\), or tap/.test(await err()), 'Next without it asks for the upper stage only');
  await p.fill(F + '#cf-scanStU', '9'); check(await toReview(), 'upper 9: on to Review');
  await create(); c = await saved('Uma Upperonly');
  check(c && c.u === 9 && c.l === '' && c.note.split('\n')[1] === 'Stage at scan: upper 9.', 'saved upper 9 only; chart note “Stage at scan: upper 9.”');
  await p.evaluate(id => openDrawer(id), c.id); await p.waitForSelector('#drawer .dHd'); await p.waitForTimeout(100);
  check(await badge() === 'Stage at scan: U 9', 'badge “Stage at scan: U 9”'); await p.evaluate(() => closeDrawer());

  console.log('\n# Switching arches after typing: the lower box that was copying the upper');
  await newCase('Ari Archswitch', '61-0008', 'oliv'); await pick('treatArch', 'U'); await pick('initial', 'no'); await p.fill(F + '#cf-scanStU', '14');
  await pick('treatArch', 'UL'); await p.waitForTimeout(60); s = await st();
  check(s.up && s.lo && s.u === '14' && s.l === '14' && /Lower filled in/.test(s.hint), 'Upper only, 14 typed, then Upper & lower: the lower box copies 14 (and says so)');
  await p.fill(F + '#cf-scanStU', '9'); await pick('treatArch', 'L'); await p.waitForTimeout(60); s = await st();
  check(!s.up && s.lo && s.l === '' && s.o.l === '', 'then Lower only: the copy nobody typed goes (the lower stage is asked for itself)');
  await p.fill(F + '#cf-scanStL', '7'); await pick('treatArch', 'UL'); await p.waitForTimeout(60); s = await st();
  check(s.l === '7' && s.o.l === 7, 'a lower stage typed by hand stays through a switch (7)');
  await p.fill(F + '#cf-scanStU', '14.5'); await p.waitForTimeout(60); s = await st();
  check(s.bad && /whole number from 1 to 99/.test(s.hint) && s.o.u === '', '14.5: the hint says whole numbers only, and it isn’t taken');
  await p.click('#ncNext'); await p.waitForTimeout(100);
  check(/Enter the stage the patient is in at the scan/.test(await err()), '… so Next still asks for it');
  await closeModal_();

  console.log('\n# Mid-course correction, not wearing aligners');
  await newCase('Noel Notwearing', '61-0003', 'angel'); await pick('initial', 'mid'); await p.waitForTimeout(60); s = await st();
  check(s.shown, 'a mid-course correction asks too (Angel)');
  await p.fill(F + '#cf-scanStU', '7'); await p.click(F + '#cf-scanStNone'); await p.waitForTimeout(60); s = await st();
  check(s.none && s.dis && s.o.n === true && s.o.u === '' && s.o.l === '', 'Not wearing aligners: the boxes set aside, nothing saved for them');
  await p.click(F + '#cf-scanStNone'); await p.waitForTimeout(60); s = await st();
  check(!s.none && !s.dis && s.u === '7' && s.o.u === 7, 'tapped again: the boxes come back with what was typed');
  await p.click(F + '#cf-scanStNone'); check(await toReview(), 'Not wearing aligners counts as the answer: on to Review');
  await create(); c = await saved('Noel Notwearing');
  check(c && c.n === true && c.u === '' && c.l === '' && c.note.split('\n')[1] === 'Not wearing aligners at the scan.', 'saved; chart note “Not wearing aligners at the scan.”');
  await p.evaluate(id => openDrawer(id), c.id); await p.waitForSelector('#drawer .dHd'); await p.waitForTimeout(100);
  check(await badge() === 'Stage at scan: not wearing aligners', 'badge “Stage at scan: not wearing aligners”');
  check(/,"?Not wearing aligners"?$/.test(c.csv), 'the export: Not wearing aligners'); await p.evaluate(() => closeDrawer());

  console.log('\n# In-house: the patient’s set before this one, to go by; finishing aligners asked too');
  const ip = await p.evaluate(() => { const c = openCases().find(x => x.type === 'nla' && x.initial === 'no' && x.chart); return { name: c.patient, chart: c.chart, id: c.id }; });
  await newCase(ip.name, ip.chart, 'nla'); await pick('initial', 'no'); await p.waitForTimeout(250); s = await st();
  check(s.shown && /^Last set on file \(Refinement 1\): 10 upper · 8 lower aligners\.$/.test(s.hint), 'a new refinement for ' + ip.name + ': “' + s.hint + '”');
  await p.fill(F + '#cf-scanStU', '8'); await p.waitForTimeout(60); s = await st();
  check(!s.bad && s.l === '8' && /Lower filled in/.test(s.hint), 'upper 8, lower follows: inside that set, no warning');
  await p.fill(F + '#cf-scanStU', '12'); await p.waitForTimeout(60); s = await st();
  check(s.bad && /The upper and lower stages are past the end of that set — check them\./.test(s.hint), '12 / 12 is past 10 / 8: it says to check them');
  await p.fill(F + '#cf-scanStL', '8'); await p.waitForTimeout(60); s = await st();
  check(s.bad && /The upper stage is past the end of that set — check it\./.test(s.hint), '12 / 8: only the upper one');
  await p.fill(F + '#cf-scanStU', '10'); await p.waitForTimeout(60); s = await st();
  check(!s.bad, '10 / 8: the end of that set, no warning');
  await p.screenshot({ path: OUT + '/v63-inhouse.png' });
  await pick('initial', 'fin'); await p.waitForTimeout(60); s = await st();
  check(s.shown && s.u === '10' && s.l === '8', 'Finishing aligners: asked too, the numbers kept');
  await pick('initial', 'yes'); await p.waitForTimeout(60); s = await st();
  check(!s.shown && s.o.u === '' && s.o.l === '' && s.o.n === '', 'switched to a first set: not asked, and nothing saved for it');
  await closeModal_();

  console.log('\n# In-house New case: no “Aligners in this set” — not known until the case is planned (Amir, 29 Oct 2026)');
  const alSec = () => p.evaluate(() => { const s = document.querySelector('#modalWrap #cf-alSec'), at = document.querySelector('#modalWrap .pickRow[data-g=atTemplates]');
    return { hidden: !s || s.hidden, alU: !!document.querySelector('#modalWrap #cf-alU') && !!document.querySelector('#modalWrap #cf-alU').offsetParent, at: !!at && !!at.offsetParent,
      note: (document.querySelector('#modalWrap #cf-alSecN') || {}).textContent || '', step: document.querySelector('#modalWrap')._wiz.cur }; });
  await newCase('Ivy Inhouse', '61-0005', 'nla'); let a = await alSec();
  check(a.hidden && !a.alU && !a.at, 'In-house, Case step: no aligner counts and no attachment templates asked');
  for (const v of ['yes', 'no', 'mid', 'fin']) { await pick('initial', v); await p.waitForTimeout(40); a = await alSec(); if (!(a.hidden && !a.alU && !a.at)) break; }
  check(a.hidden && !a.alU && !a.at, '… for a first set, a refinement, a mid-course correction or finishing aligners');
  await pick('initial', 'yes'); await p.screenshot({ path: OUT + '/v63-inhouse-case.png' });
  check(await toReview(), 'a first set goes on to Review without them');
  await p.evaluate(() => { const d = document.querySelector('#modalWrap details.cfMore'); if (d) d.open = true; });
  await p.selectOption('#modalWrap #cf-stage', 'txpok'); await p.waitForTimeout(60); a = await alSec();
  check(!a.hidden && /needed to start it at TxP approved/.test(a.note), 'started at TxP approved (More → Stage): the counts are needed, so they come back for it (“' + a.note + '”)');
  await p.click('#ncSave'); await p.waitForTimeout(250); a = await alSec();
  check(a.step === 'case' && a.alU && a.at && /under Aligners in this set to start it at TxP approved/.test(await err()), 'Create case without them: back on Case, where they are, saying so');
  await p.fill(F + '#cf-alU', '14'); await p.fill(F + '#cf-alL', '12'); await pick('atTemplates', 'none');
  await toReview(); await create(); c = await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Ivy Inhouse'); return c && { st: c.stage, u: c.alU, l: c.alL, at: c.atTemplates }; });
  check(c && c.st === 'txpok' && c.u === 14 && c.l === 12 && c.at === 'none', 'saved at TxP approved with U 14 · L 12');
  await newCase('Ira Inhouse', '61-0006', 'nla'); await pick('initial', 'yes'); await toReview();
  await p.evaluate(() => { const d = document.querySelector('#modalWrap details.cfMore'); if (d) d.open = true; });
  await p.selectOption('#modalWrap #cf-stage', 'txpok'); await p.selectOption('#modalWrap #cf-stage', 'txp'); await p.waitForTimeout(60);
  check((await alSec()).hidden, 'back to Uploaded to Titan: hidden again');
  await create();
  const ira = await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Ira Inhouse'); return c && { id: c.id, st: c.stage, u: c.alU, l: c.alL, at: c.atTemplates }; });
  check(ira && ira.st === 'txp' && ira.u === '' && ira.l === '' && ira.at === '', 'a new set at Uploaded to Titan: saved with no counts yet');
  await p.evaluate(id => openDrawer(id), ira.id); await p.waitForSelector('#drawer #alBox', { state: 'attached' });
  check(/asked when the TxP is approved/.test(await p.evaluate(() => document.querySelector('#drawer #alBox').textContent)), 'its Aligners box says the counts are asked when the TxP is approved');
  await p.click('#drawer .step[data-k=txpok]').catch(async () => { await p.click('#drawer .ds[data-ds=stage] .dsTg'); await p.click('#drawer .step[data-k=txpok]'); });
  await p.waitForSelector('#modalWrap #gAlU', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('#modalWrap #gAlU') && await p.inputValue('#modalWrap #gAlU') === '' && await p.isVisible('#modalWrap #gAlL'), 'moving it to TxP approved asks for the upper and lower aligners there (as before)');
  await p.evaluate(() => { if (document.querySelector('#modalWrap')) closeModal(); });
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-alSec', { state: 'attached' });
  check(await p.evaluate(() => { const s = document.querySelector('#drawer #cf-alSec'); return !s.hidden && !!document.querySelector('#drawer #cf-alU').offsetParent && !!document.querySelector('#drawer .pickRow[data-g=atTemplates]').offsetParent; }), 'Edit still has the counts and the attachment templates');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer());

  console.log('\n# Editing: shown with what’s saved; not required there; a change shows in the history');
  await p.evaluate(id => openDrawer(id), ip.id); await p.waitForSelector('#drawer .dHd'); await p.waitForTimeout(150);
  check(await badge() === 'Stage at scan: U 24 · L 20', 'the demo refinement (scanned in the initial set’s last aligners): “Stage at scan: U 24 · L 20”');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stWrap'); await p.waitForTimeout(250); s = await st();
  check(s.shown && s.u === '24' && s.l === '20' && /^Last set on file \(Initial\): 24 upper · 20 lower aligners\.$/.test(s.hint), 'Edit: 24 / 20 and the set before it (' + s.hint + ')');
  await p.fill('#drawer #cf-scanStU', '22'); await p.waitForTimeout(60); s = await st();
  check(s.l === '20', 'editing a saved case: the lower box keeps its own number');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('.toast:has-text("Saved")', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(300);
  check(await p.evaluate(id => findCase(id).scanStU, ip.id) === 22 && await badge() === 'Stage at scan: U 22 · L 20', 'saved: U 22 · L 20');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stWrap'); await p.fill('#drawer #cf-scanStU', '140'); await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(250);
  check(/whole number from 1 to 99/.test(await p.textContent('#drawerNotice')) && await p.evaluate(id => findCase(id).scanStU, ip.id) === 22 && await p.isVisible('#drawer #cf-scanStU'), 'Edit: a mistyped stage (140) is stopped with a note — the saved 22 isn’t lost');
  await p.click('#drawer [data-act=cancelEdit]'); await p.waitForTimeout(100);
  const lg = await p.evaluate(id => B.caseLog(id), ip.id), last = lg[lg.length - 1];
  // (the demo case's older fields — its aligner total, its typed instructions — are counted in the same edit, as for any older case)
  check(last && last.a === 'edit' && (last.fields || []).includes('scanStU') && !(last.fields || []).includes('scanStL'), 'the history: an edit of the stage (' + JSON.stringify(last && last.fields) + ')');
  await p.waitForFunction(() => /changed [^]*stage at scan/.test((document.querySelector('#histBox') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
  check(/changed [^]*stage at scan/.test(await p.evaluate(() => (document.querySelector('#histBox .hist') || {}).textContent || '')), '… which reads “changed … stage at scan”');
  // a refinement from before today, with no stage: Edit doesn't hold it up
  const old = await p.evaluate(() => { const c = openCases().find(x => x.type === 'oliv' && !x.initial && x.stage === 'mfg'); c.initial = 'no'; DEMO.cases.get(c.id).initial = 'no'; return c.id; });
  await p.evaluate(id => openDrawer(id), old); await p.waitForSelector('#drawer .dHd'); await p.waitForTimeout(100);
  check(await badge() === '', 'an older refinement with no stage: no badge');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stWrap'); await p.fill('#drawer #cf-notes', 'Edited without a stage');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('.toast:has-text("Saved")', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(200);
  check(await p.evaluate(id => findCase(id).notes, old) === 'Edited without a stage', 'Edit saves without it (only New case asks for it)');
  await p.evaluate(() => closeDrawer());

  console.log('\n# Quick add, then Finish details: asked there too');
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.fill(F + '#cf-patient', 'Quinn Quickadd'); await p.fill(F + '#cf-chart', '61-0004'); await p.click(F + '.tt[data-tile=oliv]');
  await p.click('#ncQuick'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const qid = await p.evaluate(() => (openCases().find(c => c.patient === 'Quinn Quickadd') || {}).id);
  check(!!qid, 'Quick add takes just the patient and the case type');
  await p.evaluate(id => openDrawer(id), qid); await p.waitForSelector('#drawer [data-act=quickFinish]'); await p.click('#drawer [data-act=quickFinish]');
  await p.waitForSelector('#drawer #cf-stWrap', { state: 'attached' }); await p.click('#drawer .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(80);
  await p.click('#dWizNext'); await p.waitForTimeout(150);
  check(/Enter the stage the patient is in at the scan/.test(await p.textContent('#drawerNotice')) && await p.evaluate(() => document.querySelector('#drawer #cf-stWrap').classList.contains('need')), 'Finish details stops at Case for it, outlined');
  await p.fill('#drawer #cf-scanStU', '11'); await p.waitForTimeout(60);
  check(!(await p.textContent('#drawerNotice')).trim() && await p.inputValue('#drawer #cf-scanStL') === '11', 'typed: the message goes, the lower follows');
  for (let i = 0; i < 6 && !(await p.isVisible('#dWizSave')); i++) { await p.click('#dWizNext'); await p.waitForTimeout(100); }
  await p.click('#dWizSave'); await p.waitForSelector('.toast:has-text("Details saved")', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(200);
  check(await p.evaluate(id => { const c = findCase(id); return c.scanStU === 11 && c.scanStL === 11 && !c.quick; }, qid) && await badge() === 'Stage at scan: U 11 · L 11', 'Save details: U 11 · L 11 on the case');
  await p.evaluate(() => closeDrawer());

  // an in-house set added with Quick add: Finish details goes through the New case steps, so no counts there either
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.fill(F + '#cf-patient', 'Iris Quickhouse'); await p.fill(F + '#cf-chart', '61-0007'); await p.click(F + '.tt[data-tile=nla]');
  await p.click('#ncQuick'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const iq = await p.evaluate(() => (openCases().find(c => c.patient === 'Iris Quickhouse') || {}).id);
  await p.evaluate(id => openDrawer(id), iq); await p.waitForSelector('#drawer [data-act=quickFinish]'); await p.click('#drawer [data-act=quickFinish]');
  await p.waitForSelector('#drawer #cf-alSec', { state: 'attached' }); await p.click('#drawer .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(60);
  check(await p.evaluate(() => document.querySelector('#drawer #cf-alSec').hidden && !document.querySelector('#drawer #cf-alU').offsetParent), 'Finish details (in-house): no aligner counts either');
  for (let i = 0; i < 6 && !(await p.isVisible('#dWizSave')); i++) { await p.click('#dWizNext'); await p.waitForTimeout(100); }
  await p.click('#dWizSave'); await p.waitForSelector('.toast:has-text("Details saved")', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(200);
  check(await p.evaluate(id => { const c = findCase(id); return !c.quick && c.initial === 'yes' && !c.alU && !c.alL; }, iq), '… and Save details saves without them');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-alSec', { state: 'attached' });
  check(await p.evaluate(() => { const s = document.querySelector('#drawer #cf-alSec'); return !s.hidden && !!document.querySelector('#drawer #cf-alU').offsetParent && !document.querySelector('#drawer .cf').classList.contains('wiz') && !!document.querySelector('#drawer #cf-patient').offsetParent; }), 'a plain Edit afterwards has them — the whole form on one page, not the steps Finish details left behind');
  await p.click('#drawer [data-act=cancelEdit]'); await p.evaluate(() => closeDrawer());

  // Finish details on an in-house set that already has an attachment-template answer: the section stays while it's changed
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.fill(F + '#cf-patient', 'Ada Answered'); await p.fill(F + '#cf-chart', '61-0010'); await p.click(F + '.tt[data-tile=nla]');
  await p.click('#ncQuick'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const aa = await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Ada Answered'); c.atTemplates = 'UL'; DEMO.cases.get(c.id).atTemplates = 'UL'; return c.id; });
  await p.evaluate(id => openDrawer(id), aa); await p.waitForSelector('#drawer [data-act=quickFinish]'); await p.click('#drawer [data-act=quickFinish]');
  await p.waitForSelector('#drawer #cf-alSec', { state: 'attached' }); await p.click('#drawer .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(60);
  check(await p.evaluate(() => !document.querySelector('#drawer #cf-alSec').hidden), 'Finish details on a set that already has an answer: the section is there');
  await p.click('#drawer .pickRow[data-g=atTemplates] .pick[data-v=UL]'); await p.waitForTimeout(60);
  check(await p.evaluate(() => !document.querySelector('#drawer #cf-alSec').hidden && !document.querySelector('#drawer .pickRow[data-g=atTemplates] .pick[aria-pressed=true]')), '… and stays while its answer is untapped, to pick another');
  // … and moved to TxP approved there without counts: back on Case, where they are
  for (let i = 0; i < 6 && !(await p.isVisible('#dWizSave')); i++) { await p.click('#dWizNext'); await p.waitForTimeout(100); }
  await p.evaluate(() => { const d = document.querySelector('#drawer details.cfMore'); if (d) d.open = true; });
  await p.selectOption('#drawer #cf-stage', 'txpok'); await p.click('#dWizSave'); await p.waitForTimeout(250);
  check(await p.evaluate(() => document.querySelector('#drawer')._wiz.cur) === 'case' && /pick Attachment templates before moving it to TxP approved/.test(await p.textContent('#drawerNotice')) && await p.isVisible('#drawer #cf-alU'), 'Finish details moved to TxP approved without the counts: back on Case with them, saying so');
  await p.click('#drawer [data-act=cancelEdit]').catch(() => {}); await p.evaluate(() => closeDrawer());

  console.log('\n# Dental Monitoring on every Oliv patient');
  await p.click('#nav-list'); await p.waitForSelector('#listBody'); await p.waitForTimeout(150);
  const rows = await p.evaluate(() => Array.from(document.querySelectorAll('#listBody tr[data-id]')).map(tr => { const c = findCase(tr.dataset.id), a = tr.querySelector('a.flag.dm');
    return { oliv: c.type === 'oliv', has: !!a, href: a ? a.href : '', tgt: a ? a.target : '', rel: a ? a.rel : '' }; }));
  const ol = rows.filter(r => r.oliv), other = rows.filter(r => !r.oliv);
  check(ol.length >= 5 && ol.every(r => r.has && r.href === DM && r.tgt === '_blank' && /noopener/.test(r.rel)), 'All open cases: every Oliv row (' + ol.length + ') has a Dental Monitoring link (new tab)');
  check(other.length > 5 && other.every(r => !r.has), '… and no other kind of case has one (' + other.length + ' rows)');
  const oid = await p.evaluate(() => { const tr = document.querySelector('#listBody tr[data-id] a.flag.dm').closest('tr'); return tr.dataset.id; });
  const oname = await p.evaluate(id => findCase(id).patient, oid);
  await p.evaluate(() => { window.__copied = null; });
  let [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), p.click('#listBody tr[data-id="' + oid + '"] a.flag.dm')]);
  await p.waitForTimeout(250);
  check(!!pop && pop.url() === DM, 'clicking it opens Dental Monitoring in a new tab (' + (pop ? pop.url() : 'none') + ')');
  check(await p.evaluate(() => !S.openId && !document.querySelector('#drawer.open')), '… and doesn’t open the case');
  check(await p.evaluate(() => window.__copied) === oname && (await p.textContent('#toasts')).includes('Copied “' + oname + '” — paste it in Dental Monitoring’s search'), 'it copies the patient’s name for DM’s search (' + oname + ')');
  if (pop) await pop.close();
  await p.screenshot({ path: OUT + '/v63-list.png' });
  await p.click('#nav-board'); await p.waitForSelector('.board'); await p.click('[data-act=flow][data-k=outside]').catch(() => {}); await p.waitForTimeout(150);
  const cards = await p.evaluate(() => Array.from(document.querySelectorAll('.board .kc[data-id]')).map(k => ({ oliv: findCase(k.dataset.id).type === 'oliv', has: !!k.querySelector('a.flag.dm[href="https://dental-monitoring.com/doctor/login"]') })));
  check(cards.filter(k => k.oliv).length >= 5 && cards.every(k => k.has === k.oliv), 'the board: every Oliv card has it, the others don’t (' + cards.filter(k => k.oliv).length + ' of ' + cards.length + ')');
  const kid = await p.evaluate(() => document.querySelector('.board .kc a.flag.dm').closest('.kc').dataset.id);
  [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), p.click('.board .kc[data-id="' + kid + '"] a.flag.dm')]);
  await p.waitForTimeout(200);
  check(!!pop && await p.evaluate(() => !S.openId), 'a card’s link opens DM, not the case');
  if (pop) await pop.close();
  await p.screenshot({ path: OUT + '/v63-board.png' });
  await p.click('#nav-done'); await p.waitForTimeout(400);
  const done = await p.evaluate(() => Array.from(document.querySelectorAll('.doneTbl tr[data-id]')).map(tr => { const c = findCase(tr.dataset.id); return { oliv: c && c.type === 'oliv', has: !!tr.querySelector('a.flag.dm') }; }));
  check(done.filter(r => r.oliv).length >= 1 && done.every(r => r.has === r.oliv), 'Completed: the Oliv patients have it too (' + done.filter(r => r.oliv).length + ')');
  await p.evaluate(id => openDrawer(id), oid); await p.waitForSelector('#drawer .portals');
  check(await p.evaluate(u => Array.from(document.querySelectorAll('#drawer .portals a')).some(a => a.href === u && /Open Dental Monitoring/.test(a.textContent)), DM), 'the case panel keeps Open Dental Monitoring');
  await p.evaluate(() => closeDrawer());

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#nav-list').catch(() => p.evaluate(() => { S.view = 'list'; renderNav(); renderView(); })); await p.waitForTimeout(250);
  check(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0 && await p.evaluate(() => { const a = document.querySelector('#listBody a.flag.dm'); return !!a && a.getBoundingClientRect().right <= innerWidth; }), 'phone: the list fits, the link on screen');
  await p.screenshot({ path: OUT + '/v63-phone-list.png' });
  await p.evaluate(() => newCaseModal()); await p.waitForSelector('#ncForm');
  await p.fill(F + '#cf-patient', 'Pia Phone'); await p.fill(F + '#cf-chart', '61-0009'); await p.click(F + '.tt[data-tile=oliv]'); await p.click('#ncNext'); await p.waitForTimeout(100);
  await pick('initial', 'no'); await p.waitForTimeout(60);
  const ph = await p.evaluate(() => { const w = document.querySelector('#cf-stWrap').getBoundingClientRect(), b = document.querySelector('#cf-scanStNone').getBoundingClientRect(); return { w: w.right, b: b.right, iw: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; });
  check(ph.w <= ph.iw && ph.b <= ph.iw && ph.over <= 0, 'phone: the stage boxes and Not wearing aligners fit');
  await p.locator('#cf-stWrap').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + '/v63-phone-form.png' });
  await closeModal_();

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
