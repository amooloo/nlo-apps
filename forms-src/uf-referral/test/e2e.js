// UF referral in Forms: boot, fill, preview, PDF (download + print path), clear, regressions.
// node e2e.js <url> [viewer]   — "viewer" runs full Chromium (new headless) where the browser's PDF viewer exists.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const URL0 = process.argv[2], VIEWER = process.argv[3] === 'viewer';
const OUT = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ufr-e2e-'));   // the downloaded PDFs (outside the repo)
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const offsite = r => { const u = r.request().url(); return /^https?:\/\//.test(u) && !u.startsWith('http://127.0.0.1') ? r.abort() : r.continue(); };

(async () => {
  const browser = VIEWER ? await chromium.launch({ channel: 'chromium' }) : await chromium.launch();   // the full browser has a PDF viewer; the headless shell doesn't
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/*', offsite);
  await page.goto(URL0);
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => navigator.pdfViewerEnabled) === VIEWER, 'pdf viewer as expected for this run: ' + VIEWER);

  ok(await page.title() === 'NLO Forms', 'title is NLO Forms');
  ok((await page.textContent('.app-header .app-title')).trim() === 'Forms', 'header says Forms');
  await page.click('#folderBtn-referrals');
  ok(await page.isVisible('#tab-ufr'), 'UF tab visible');
  const office = await page.evaluate(() => ['ufr_dr','ufr_dremail','ufr_contact','ufr_draddr','ufr_drcity','ufr_drzip','ufr_drphone','ufr_drfax'].map(id => document.getElementById(id).value));
  ok(JSON.stringify(office) === JSON.stringify(['Amir Akhavan, DMD, MS','Questions@thenextlevelorthodontics.com','Front Desk','320 NW 76th Drive','Gainesville, FL','32607','(352) 332-7466','(352) 332-4322']), 'office prefilled');
  ok(await page.$eval('#ufr_date', e => e.value) === await page.evaluate(() => todayStr), 'date defaults to today');
  ok(await page.$eval('#ufr_doc_first', e => e.checked) && await page.$eval('#ufr_xr_yes', e => e.checked), 'First Available + Radiographs Yes by default');
  await page.waitForTimeout(300);
  const img = await page.evaluate(() => { const im = document.querySelector('#ufr_paper image'); const bb = im.getBBox(); return { href: im.getAttribute('href').slice(0, 5), w: bb.width, h: bb.height, nat: 0 }; });
  ok(img.href === 'blob:' && img.w === 612 && img.h === 792, 'preview picture covers the page: ' + JSON.stringify(img));
  const inkStart = await page.$$eval('#ufr_paper .ufr-ink text', ts => ts.map(t => t.textContent));
  ok(inkStart.includes('Amir Akhavan, DMD, MS') && inkStart.includes('(352) 332-4322') && inkStart.includes('X') && inkStart.length === 10, 'office + date + X at start: ' + inkStart.join(' | '));
  ok(await page.$$eval('#ufr_paper .ufr-ink path', p => p.length) === 1, 'First Available ringed at start');

  // nothing prints or downloads without a patient name
  let dlCount = 0; page.on('download', () => dlCount++);
  await page.click('#tab-ufr .btn-bar .btn-print'); await page.waitForTimeout(300);
  await page.click('#tab-ufr .btn-bar .btn-save'); await page.waitForTimeout(300);
  ok(dlCount === 0 && !(await page.$('#ufr_printFrame')), 'no print/download without a name');
  ok((await page.textContent('#ufr_pnameErr')).includes('patient') && await page.$eval('#ufr_pname', e => e.classList.contains('input-error') && document.activeElement === e), 'name flagged and focused');

  // fill
  await page.fill('#ufr_pname', 'Maria José Nguyễn-Smith');
  ok((await page.textContent('#ufr_pnameErr')) === '', 'error clears on typing');
  await page.fill('#ufr_dob', '2012-04-09'); await page.selectOption('#ufr_mf', 'F');
  await page.fill('#ufr_addr1', '1234 SW 20th Avenue'); await page.fill('#ufr_addr2', 'Apt 5B');
  await page.fill('#ufr_city', 'Gainesville, FL'); await page.fill('#ufr_zip', '32608');
  await page.fill('#ufr_pemail', 'maria.parent.family@gmail.com');
  await page.fill('#ufr_hphone', '3525550101'); await page.press('#ufr_hphone', 'Tab');
  await page.fill('#ufr_cphone', '352-555-0199'); await page.fill('#ufr_guard', 'Ana Smith (mother)');
  await page.fill('#ufr_diag', 'Crowding; Class I malocclusion');
  await page.click('#ufr_teethPicks .ufr-pick[data-teeth="5,12"]');
  await page.click('#ufr_teethPicks .ufr-pick[data-teeth="21,28"]');
  await page.click('#ufr_chart .ufr-tooth[data-t="A"]');
  ok(await page.$eval('#ufr_chart .ufr-tooth[data-t="5"]', b => b.getAttribute('aria-pressed')) === 'true', 'tooth 5 pressed');
  ok((await page.textContent('#ufr_teethNote')).includes('#5, #12, #21, #28, #A'), 'teeth note sorted');
  await page.click('#ufr_reasonPicks .ufr-pick[data-reason="ext"]');
  ok(await page.$eval('#ufr_reason', e => e.value) === 'Extraction of #5, #12, #21, #28, #A for orthodontic treatment', 'reason from teeth');
  await page.click('#ufr_chart .ufr-tooth[data-t="A"]');
  ok(await page.$eval('#ufr_reason', e => e.value) === 'Extraction of #5, #12, #21, #28 for orthodontic treatment', 'reason follows the chart');
  await page.click('#ufr_reasonPicks .ufr-pick[data-reason="thirds"]');
  ok((await page.$eval('#ufr_reason', e => e.value)).endsWith('; Evaluation and extraction of third molars'), 'second reason appended');
  await page.fill('#ufr_reason', 'Extraction of #5, #12, #21, #28 for orthodontic treatment');
  await page.click('#ufr_chart .ufr-tooth[data-t="1"]');
  ok(await page.$eval('#ufr_reason', e => e.value) === 'Extraction of #5, #12, #21, #28 for orthodontic treatment', 'typed reason left alone');
  await page.click('#ufr_chart .ufr-tooth[data-t="1"]');
  await page.click('label.aging-chip:has(#ufr_doc_nessif)');
  await page.fill('#ufr_i1name', 'Florida Blue'); await page.fill('#ufr_i1phone', '8005551234'); await page.fill('#ufr_i1holder', 'Ana Smith');
  await page.fill('#ufr_i1rel', 'Mother'); await page.fill('#ufr_i1policy', 'XJH123456789'); await page.fill('#ufr_i1group', '00123'); await page.fill('#ufr_i1auth', 'A-998877');
  await page.click('#ufr_i2toggle');
  await page.fill('#ufr_i2name', 'Delta Dental'); await page.fill('#ufr_i2phone', '8005559876'); await page.fill('#ufr_i2holder', 'Carlos Smith');
  await page.fill('#ufr_i2rel', 'Father'); await page.fill('#ufr_i2policy', 'DD-55555'); await page.fill('#ufr_i2group', 'G-777'); await page.fill('#ufr_i2auth', 'B-112233');
  await page.waitForTimeout(150);
  const ink = await page.$$eval('#ufr_paper .ufr-ink text', ts => ts.map(t => t.textContent));
  const has = s => ink.includes(s);
  ok(has('Maria José Nguyen-Smith') && has('04/09/2012') && has('F') && has('(352) 555-0101') && has('Florida Blue') && has('Delta Dental') && has('(800) 555-9876') && has('B-112233'), 'values on the preview: ' + ink.join(' | '));
  ok(has('Teeth to extract: #5, #12, #21, #28') && has('X'), 'teeth list + radiographs X');
  ok(await page.$$eval('#ufr_paper .ufr-ink path', p => p.length) === 5, '4 tooth Xs + 1 ring');

  // the PDF: download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tab-ufr .btn-bar .btn-save')]);
  ok(/^UF Consult Request - Maria Jose Nguyen-Smith - \d{4}-\d{2}-\d{2}\.pdf$/.test(dl.suggestedFilename()), 'file name: ' + dl.suggestedFilename());
  await dl.saveAs(path.join(OUT, 'download' + (VIEWER ? '-v' : '') + '.pdf'));
  // the PDF starts with UF's file, byte for byte
  const tplOk = await page.evaluate(async () => { const b = ufr_pdfBytes(ufr_layout(ufr_state())), t = Uint8Array.from(atob(UFR_TPL), c => c.charCodeAt(0)); for (let i = 0; i < t.length; i++) if (b[i] !== t[i]) return false; return b.length > t.length; });
  ok(tplOk, 'the PDF is UF\'s file plus an appended update');

  // print
  if (VIEWER) {
    await page.click('#tab-ufr .btn-bar .btn-print');
    await page.waitForTimeout(1200);
    const fr = await page.evaluate(async () => { const f = document.getElementById('ufr_printFrame'); if (!f) return null;
      const b = new Uint8Array(await (await fetch(f.src)).arrayBuffer()); const ref = ufr_pdfBytes(ufr_layout(ufr_state()));
      const head = new TextDecoder().decode(b.slice(0, 8)); let same = b.length === ref.length; // (the dates in the bytes are the same: no timestamps in the update)
      if (same) for (let i = 0; i < b.length; i++) if (b[i] !== ref[i]) { same = false; break; }
      return { src: f.src.slice(0, 5), head, same, embed: !!(f.contentDocument && f.contentDocument.querySelector('embed[type="application/pdf"]')) }; });
    ok(fr && fr.src === 'blob:' && fr.head.startsWith('%PDF') && fr.same && fr.embed, 'print frame holds the same PDF in the viewer: ' + JSON.stringify(fr));
    ok(dlCount === 1, 'printing did not download anything (viewer present)');
  } else {
    const [pdl] = await Promise.all([page.waitForEvent('download'), page.click('#tab-ufr .btn-bar .btn-print')]);
    ok(/^UF Consult Request - /.test(pdl.suggestedFilename()) && await page.isVisible('#ufr_printNote'), 'no viewer: Print downloads the PDF and says so');
  }

  // enlarge
  await page.click('#ufr_paper'); await page.waitForTimeout(800);
  ok(await page.isVisible('#ufr_modal'), 'modal opens');
  if (VIEWER) ok(await page.isVisible('#ufr_modalPaper iframe.ufr-modal-pdf') && await page.$eval('#ufr_modalPaper .ufr-sheet', s => s.style.display === 'none'), 'modal shows the PDF in the viewer');
  else ok(await page.isVisible('#ufr_modalPaper .ufr-sheet') && !(await page.$('#ufr_modalPaper iframe')), 'modal shows the picture without a viewer');
  await page.keyboard.press('Escape');
  ok(await page.isHidden('#ufr_modal') && !(await page.$('#ufr_modalPaper iframe')), 'Esc closes and drops the PDF frame');

  // other forms still print as before
  await page.click('#folderBtn-letters'); await page.click('.tab-btn[data-tab="mil"]');
  await page.fill('#mil_patientName', 'Test Patient');
  await page.evaluate(() => { window.__dual = null; window.print = () => { window.__dual = Array.from(document.querySelectorAll('.print-doc.print-active')).map(d => d.id); }; mil_print(); });
  await page.click('#copiesTwo'); await page.waitForTimeout(300);   // "Do you need an additional copy?" - yes
  ok(JSON.stringify(await page.evaluate(() => window.__dual)) === JSON.stringify(['mil_printDoc', 'mil_printDoc_copy2']), 'military letter: two copies when asked for');
  await page.evaluate(() => { window.__dual = null; mil_print(); });
  await page.click('#copiesOne'); await page.waitForTimeout(300);   // no (the default)
  ok(JSON.stringify(await page.evaluate(() => window.__dual)) === JSON.stringify(['mil_printDoc']), 'military letter: one copy by default');
  for (const f of ['start', 'finish', 'dc', 'collection', 'referrals', 'letters', 'batch', 'tocalc']) {
    await page.click('#folderBtn-' + f);
    ok((await page.evaluate(() => document.querySelectorAll('.tab-content.active').length)) === 1, 'folder ' + f + ' shows one tab');
  }

  // clear
  await page.click('#folderBtn-referrals');
  await page.click('#tab-ufr .btn-clear');
  const after = await page.evaluate(() => ({ name: ufr_v('ufr_pname'), i2: document.getElementById('ufr_i2wrap').hidden, i2name: ufr_v('ufr_i2name'), teeth: UFR_SEL.size,
    doc: document.querySelector('input[name=ufr_doc]:checked').value, dr: ufr_v('ufr_dr'), fax: ufr_v('ufr_drfax'), frame: !!document.getElementById('ufr_printFrame'),
    ink: Array.from(document.querySelectorAll('.ufr-ink text')).map(t => t.textContent) }));
  ok(after.name === '' && after.i2 && after.i2name === '' && after.teeth === 0 && after.doc === 'first' && !after.frame, 'clear empties the patient and drops the print frame: ' + JSON.stringify(after));
  ok(after.dr === 'Amir Akhavan, DMD, MS' && after.fax === '(352) 332-4322', 'clear keeps the office');
  ok(!after.ink.some(s => /Maria|Florida|Delta|Smith|Teeth to extract/.test(s)), 'no patient text left on the sheets');

  // long text
  await page.fill('#ufr_pname', 'Test');
  await page.fill('#ufr_reason', 'Consultation for extraction of multiple teeth including impacted maxillary canines, supernumerary teeth in the anterior maxilla, and evaluation of a radiolucency distal to #31, plus third molar evaluation and anything else Dr. A thinks is relevant for this complicated case today');
  await page.fill('#ufr_diag', 'x'.repeat(200));
  await page.waitForTimeout(150);
  ok(await page.isVisible('#ufr_note') && /Reason for Referral/.test(await page.textContent('#ufr_note')) && /Referring diagnosis/.test(await page.textContent('#ufr_note')), 'cut note names the long boxes');
  const rl = await page.evaluate(() => { const lay = ufr_layout(ufr_state()), L = UFR_LINES.reason; return lay.text.filter(t => t.x === L[0] + 3).map(t => t.s); });
  ok(rl.length === 2 && rl[1].endsWith('…'), 'long reason wraps to two lines and is cut');
  await page.fill('#ufr_reason', 'y'.repeat(150)); await page.waitForTimeout(100);
  const one = await page.evaluate(() => { const lay = ufr_layout(ufr_state()), L = UFR_LINES.reason; const r = lay.text.filter(t => t.x === L[0] + 3); const maxW = L[1] - L[0] - 3 + Math.min(UFR_ROOM.reason, 30); return { n: r.length, ok: r.every(t => ufr_width(t.s, 'H', t.z) <= maxW + 0.01), last: r.length ? r[r.length - 1].s.slice(-1) : '' }; });
  ok(one.n === 1 && one.ok && one.last === '…', 'one huge word is cut on its line: ' + JSON.stringify(one));
  // nasty characters stay text (preview) and stay valid (PDF)
  await page.fill('#ufr_reason', 'Pt (age 12) says <b>"ouch"</b> & \\ ✓ 😀');
  await page.waitForTimeout(100);
  const nasty = await page.evaluate(() => ({ html: document.querySelector('#ufr_paper .ufr-ink').innerHTML.includes('<b>'), txt: Array.from(document.querySelectorAll('#ufr_paper .ufr-ink text')).map(t => t.textContent).find(s => s.startsWith('Pt ')) }));
  ok(!nasty.html && nasty.txt === 'Pt (age 12) says <b>"ouch"</b> & \\ ? ?', 'markup stays text; symbols outside the fonts print as ?: ' + JSON.stringify(nasty));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#tab-ufr .btn-bar .btn-save')]);
  await dl2.saveAs(path.join(OUT, 'nasty' + (VIEWER ? '-v' : '') + '.pdf'));
  await page.fill('#ufr_reason', ''); await page.fill('#ufr_diag', ''); await page.waitForTimeout(100);
  ok(await page.isHidden('#ufr_note'), 'cut note hides again');

  // narrow screens
  for (const w of [1024, 768, 390]) {
    await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok(ov.sw <= ov.iw, 'no sideways scroll at ' + w + 'px: ' + JSON.stringify(ov));
  }
  await page.setViewportSize({ width: 1366, height: 900 });

  // deep links
  const p2 = await ctx.newPage(); await p2.route('**/*', offsite);
  p2.on('pageerror', e => errors.push('p2 pageerror: ' + e.message));
  await p2.goto(URL0.split('#')[0] + '#ufr'); await p2.waitForTimeout(250);
  ok(await p2.isVisible('#tab-ufr'), 'deep link #ufr');
  await p2.goto(URL0.split('#')[0] + '#aaf'); await p2.reload(); await p2.waitForTimeout(250);
  ok(await p2.isVisible('#tab-aaf'), 'deep link #aaf');

  ok(errors.length === 0, 'no page errors: ' + errors.join(' || '));
  console.log((VIEWER ? '[viewer] ' : '[no viewer] ') + 'passed', pass, 'failed', fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
