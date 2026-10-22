// Forms: every Print asks "Do you need an additional copy?" - one copy unless they pick two.
// node e2e.js <url>   (serve the repo root, e.g. python3 -m http.server 8767,
//                      then http://127.0.0.1:8767/NLO_Financial_Suite.html)
const { chromium } = require('playwright');
const URL0 = process.argv[2];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const offsite = r => { const u = r.request().url(); return /^https?:\/\//.test(u) && !u.startsWith('http://127.0.0.1') ? r.abort() : r.continue(); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], nativeDialogs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => { nativeDialogs.push(d.message()); d.dismiss(); });
  await page.route('**/*', offsite);
  await page.goto(URL0);
  await page.waitForTimeout(400);

  // What reaches the printer is captured inside the stubbed print (the page tears its print copy down right after).
  await page.evaluate(() => {
    window.__prints = []; window.__asks = 0;
    const shown = d => { const l = d.querySelector('.copy-label'); return l && getComputedStyle(l).visibility !== 'hidden' ? l.textContent : null; };
    window.__stub = () => { window.print = () => window.__prints.push(Array.from(document.querySelectorAll('.print-doc.print-active'))
      .map(d => ({ id: d.id, label: shown(d) }))); };   // label: the copy label as printed (null = none, or left blank)
    window.__stub();
    const sm = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () { if (this.id === 'copiesDlg') window.__asks++; return sm.call(this); };
  });
  const reset = () => page.evaluate(() => { window.__prints = []; window.__asks = 0; });
  const state = async () => { await page.waitForTimeout(300); return page.evaluate(() => ({
    prints: window.__prints, asks: window.__asks, open: document.getElementById('copiesDlg').open,
    left: document.querySelectorAll('.print-doc.print-active, [id$="_copy2"], .copy-label').length })); };
  const isOpen = () => page.evaluate(() => document.getElementById('copiesDlg').open);

  // ---- a form's own Print button (Financial Responsibility)
  await page.fill('#fra_patientName', 'Jane Test');
  await reset();
  await page.click('#tab-fra .btn-print');
  ok(await isOpen(), 'Print opens the copies prompt');
  ok((await page.textContent('#copiesTitle')).trim() === 'Do you need an additional copy?', 'asks the question');
  const what = (await page.textContent('#copiesWhat')).trim();
  ok(what.length > 3 && !/Batch/.test(what), 'names the form: ' + what);
  ok(await page.evaluate(() => document.activeElement.id) === 'copiesOne', 'one copy is the highlighted default');
  ok((await page.textContent('#copiesTwoSub')).trim() === 'Next Level Copy + Patient / RP Copy', 'two-copy choice says what the copies are');
  ok(await page.evaluate(() => window.__prints.length) === 0, 'nothing prints until they answer');
  await page.keyboard.press('Enter');
  let s = await state();
  ok(same(s.prints, [[{ id: 'fra_printDoc', label: null }]]) && !s.open && s.left === 0, 'Enter: one copy, no copy label, cleaned up: ' + JSON.stringify(s));

  await reset(); await page.click('#tab-fra .btn-print'); await page.click('#copiesTwo');
  s = await state();
  ok(same(s.prints, [[{ id: 'fra_printDoc', label: 'Next Level Copy' }, { id: 'fra_printDoc_copy2', label: 'Patient / RP Copy' }]]) && s.left === 0,
    'Yes: Next Level Copy + Patient / RP Copy: ' + JSON.stringify(s.prints));

  await reset(); await page.click('#tab-fra .btn-print'); await page.click('#copiesOne');
  s = await state(); ok(same(s.prints, [[{ id: 'fra_printDoc', label: null }]]), 'No: one copy');

  await reset(); await page.click('#tab-fra .btn-print'); await page.keyboard.press('2');
  s = await state(); ok(s.prints.length === 1 && s.prints[0].length === 2, 'the 2 key: two copies');
  await reset(); await page.click('#tab-fra .btn-print'); await page.keyboard.press('1');
  s = await state(); ok(s.prints.length === 1 && s.prints[0].length === 1, 'the 1 key: one copy');
  await reset(); await page.click('#tab-fra .btn-print'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  s = await state(); ok(s.prints.length === 1 && s.prints[0].length === 2, 'Tab to two copies, Enter: two copies');

  // ---- nothing prints: Esc, Cancel, a click outside the box
  await reset(); await page.click('#tab-fra .btn-print'); await page.keyboard.press('Escape');
  s = await state(); ok(s.prints.length === 0 && !s.open && s.left === 0, 'Esc: nothing prints: ' + JSON.stringify(s));
  await reset(); await page.click('#tab-fra .btn-print'); await page.click('#copiesCancel');
  s = await state(); ok(s.prints.length === 0 && !s.open, 'Cancel: nothing prints');
  await reset(); await page.click('#tab-fra .btn-print'); await page.mouse.click(15, 450);
  s = await state(); ok(s.prints.length === 0 && !s.open, 'click outside the box: nothing prints');
  await reset(); await page.click('#tab-fra .btn-print'); await page.click('#copiesTitle');
  s = await state(); ok(s.open && s.prints.length === 0, 'a click inside the box (not on a choice) keeps it open');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('btn-print')), 'focus goes back to the Print button');

  // ---- the prompt only once, even when Print is pressed twice
  await reset();
  await page.evaluate(() => { fra_print(); fra_print(); });
  await page.click('#copiesOne');
  s = await state(); ok(s.asks === 1 && s.prints.length === 1, 'two Print calls: one prompt, one print: ' + JSON.stringify(s));

  // ---- every form: 1 copy and 2 copies
  const forms = await page.evaluate(() => BATCH_FORMS.map(f => ({ key: f.key, nameId: f.nameId })));
  for (const f of forms) {
    await page.evaluate(f => { const i = document.getElementById(f.nameId); i.value = 'Pat Test'; i.dispatchEvent(new Event('input')); }, f);
    for (const n of [1, 2]) {
      await reset();
      await page.evaluate(k => BATCH_FORMS.find(x => x.key === k).print(), f.key);
      ok(await isOpen(), f.key + ': prompt opens');
      await page.click(n === 1 ? '#copiesOne' : '#copiesTwo');
      s = await state();
      const p = s.prints[0] || [];
      const want = n === 1 ? 1 : 2;
      ok(s.prints.length === 1 && p.length === want && s.left === 0, f.key + ' x' + n + ': ' + JSON.stringify(s));
      if (n === 1) ok(p[0] && p[0].label === null, f.key + ': one copy has no copy label');
      if (n === 2) ok(p[0] && p[0].label === 'Next Level Copy' && p[1] && p[1].id === p[0].id + '_copy2', f.key + ': two copies, Next Level first');
    }
  }
  // the military letter's second copy stays unlabeled (the patient's original for the recruiter)
  await reset(); await page.evaluate(() => mil_print());
  ok((await page.textContent('#copiesTwoSub')).trim() === 'Next Level Copy + an unlabeled copy', 'military letter: the second copy is described as unlabeled');
  await page.click('#copiesTwo'); s = await state();
  ok(same(s.prints[0], [{ id: 'mil_printDoc', label: 'Next Level Copy' }, { id: 'mil_printDoc_copy2', label: null }]), 'military letter: Next Level Copy + unlabeled original');

  // ---- Batch Print: asked once for the whole job
  await page.click('#folderBtn-batch');
  await page.fill('#batch_patientName', 'Batch Pat');
  for (const k of ['fra', 'priv', 'crb']) await page.check('#batch_cb_' + k);
  await reset(); await page.click('#batchPrintBtn');
  ok(await isOpen(), 'Batch Print opens the prompt');
  ok((await page.textContent('#copiesWhat')).trim() === 'Batch Print · 3 forms for Batch Pat', 'batch: says how many forms and for whom: ' + (await page.textContent('#copiesWhat')));
  ok((await page.textContent('#copiesOneSub')).trim() === 'One of each form' && (await page.textContent('#copiesTwoSub')).trim() === 'Two of each form', 'batch wording');
  await page.keyboard.press('Enter');
  s = await state();
  ok(s.asks === 1 && s.prints.length === 1 && same(s.prints[0].map(d => d.id), ['fra_printDoc', 'crb_printDoc', 'priv_printDoc']) && s.prints[0].every(d => d.label === null) && s.left === 0,
    'batch, one copy: each form once, no labels: ' + JSON.stringify(s));
  await reset(); await page.click('#batchPrintBtn'); await page.click('#copiesTwo');
  s = await state();
  ok(s.asks === 1 && same(s.prints[0].map(d => d.id), ['fra_printDoc', 'fra_printDoc_copy2', 'crb_printDoc', 'crb_printDoc_copy2', 'priv_printDoc', 'priv_printDoc_copy2']) && s.left === 0,
    'batch, two copies: each form twice: ' + JSON.stringify(s.prints));
  await page.check('#batch_cb_mil');
  await reset(); await page.click('#batchPrintBtn');
  ok((await page.textContent('#copiesTwoSub')).trim() === 'Two of each form', 'batch with the military letter: same wording');
  await page.keyboard.press('Escape');
  s = await state(); ok(s.prints.length === 0 && s.asks === 1, 'batch, Esc: nothing prints');
  await page.evaluate(() => { BATCH_FORMS.forEach(f => { document.getElementById('batch_cb_' + f.key).checked = true; }); batchUpdateCount(); });
  await reset(); await page.click('#batchPrintBtn'); await page.click('#copiesOne');
  s = await state(); ok(s.asks === 1 && s.prints[0].length === forms.length && s.prints[0].every(d => d.label === null), 'batch, all ' + forms.length + ' forms, one copy each');
  await reset(); await page.click('#batchPrintBtn'); await page.click('#copiesTwo');
  s = await state(); ok(s.asks === 1 && s.prints[0].length === forms.length * 2, 'batch, all forms, two copies each');
  ok(await page.evaluate(() => window._batchCollect === null), 'batch collection switched off afterwards');

  // ---- one copy breaks across pages exactly like the labeled copy: same layout, the label row left blank
  // (taking the row out pulls a paragraph of 2-page forms into the foot of page 1, under the fixed footer)
  const ids = await page.evaluate(() => { window._batchCollect = []; BATCH_FORMS.forEach(f => f.print()); const ids = window._batchCollect.slice(); window._batchCollect = null; return ids; });
  ok(ids.length === forms.length, 'every form collected for the layout check');
  await page.setViewportSize({ width: 624, height: 900 });   // about the printed width (8.5in less 1in margins)
  await page.emulateMedia({ media: 'print' });
  for (const id of ids) {
    const h = await page.evaluate(async id => {
      const run = fn => new Promise(res => { window.print = () => res(Array.from(document.querySelectorAll('.print-doc.print-active')).map(d => Math.round(d.getBoundingClientRect().height * 100) / 100)); fn(id); });
      return { one: await run(printOneCopy), two: await run(printTwoCopies) };
    }, id);
    ok(h.one.length === 1 && h.two.length === 2 && h.one[0] === h.two[0] && h.one[0] > 100, id + ': one copy lays out exactly like the labeled copy: ' + JSON.stringify(h));
  }
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => window.__stub());
  ok(await page.evaluate(() => document.querySelectorAll('.print-doc.print-active, [id$="_copy2"], .copy-label').length) === 0, 'layout check left nothing behind');

  // ---- the prompt fits small screens; it never prints
  for (const [w, h] of [[1024, 700], [768, 1024], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.click('#folderBtn-start'); await page.click('.tab-btn[data-tab="fra"]');
    await page.click('#tab-fra .btn-print');
    const box = await page.evaluate(() => { const r = document.getElementById('copiesDlg').getBoundingClientRect(); const a = document.getElementById('copiesOne').getBoundingClientRect(), b = document.getElementById('copiesTwo').getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, stacked: b.top >= a.bottom - 1, oneH: a.height }; });
    ok(box.l >= 0 && box.r <= box.vw && box.t >= 0 && box.b <= box.vh && box.oneH >= 44 && Math.abs((box.l + box.r) / 2 - box.vw / 2) < 2, 'prompt fits ' + w + 'x' + h + ': ' + JSON.stringify(box));   // (the Forms page itself is wider than a phone; the prompt isn't)
    if (w <= 420) ok(box.stacked, 'choices stack at ' + w + 'px');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.getElementById('copiesDlg').showModal());
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('copiesDlg')).display) === 'none', 'the prompt never shows on paper');
  await page.evaluate(() => document.getElementById('copiesDlg').close('0'));
  await page.emulateMedia({ media: 'screen' });

  ok(nativeDialogs.length === 0, 'no browser alert/confirm boxes: ' + nativeDialogs.join(' | '));
  ok(errors.length === 0, 'no page errors: ' + errors.join(' || '));
  console.log('print copies: passed', pass, 'failed', fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
