/* "Make it clear" on the New case form and its card in Team & security (ai.js), in the real built page (?demo) with a made-up AISA Worker.
   Serve dist/ first:  python3 -m http.server 8765 --directory dist        then:  node test/ai_form.js
   Checks what leaves the form (no patient name, chart #, date or phone), what the preview does (Use this / Keep mine / Put my words back),
   every message the helper can show, the preferences card (save, clear, Try it), and that the saved case reads the steps like any instruction.
   The real Worker + Gemini are not touched (the Worker's side is test/ai_worker.mjs). */
const { chromium } = require('playwright');
const fs = require('fs');
const { routes, watch, stepsAsOnePage } = require('./helpers');
const URL0 = 'http://127.0.0.1:8765/nlo-cases.html?demo';
const WORKER = 'https://aisa-worker.akhavan-ak.workers.dev/rewrite-instructions';
const SHOTS = process.env.SHOTS || '';
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (p, name, opt) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot(Object.assign({ path: SHOTS + '/' + name + '.png' }, opt || {})); } };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await routes(ctx);

  // ---- a made-up Worker ----
  let mode = 'ok', sent = [], gate = null;
  const GOOD = { ok: true, items: [{ t: 'Close the remaining lower spaces', pref: false }, { t: 'IPR on the lower anterior contacts, 0.2 mm per contact', pref: true }, { t: 'Do not move 16, 26', pref: false }], check: ['Which arch should the IPR go in?'] };
  await ctx.route(WORKER, async route => {
    const req = route.request(), cors = { 'Access-Control-Allow-Origin': '*' };
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) { }
    sent.push(body);
    if (gate) await gate; // (a slow answer, held until the test lets it go)
    if (mode === 'down') return route.abort('failed');
    if (mode === 'old') return route.fulfill({ status: 200, headers: cors, contentType: 'text/plain', body: 'NLO Worker is Running!' });
    if (mode === 'err') return route.fulfill({ status: 429, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'You’ve used up today’s AI limit. Try again tomorrow.' }) });
    if (mode === 'empty') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, items: [], check: ['The note has no instructions I can turn into steps.'] }) });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(GOOD) });
  });

  const page = await ctx.newPage(); watch(page, errs, 'demo'); stepsAsOnePage(page);
  await page.goto(URL0);
  await page.click('#lgBtn');
  await page.waitForSelector('.tiles');

  // ---- New case → Oliv aligners, with some tiles ticked ----
  await page.click('.topBar [data-act=newCase]'); await page.waitForSelector('#ncForm');
  await page.click('#ncForm .tt[data-tile=oliv]');
  await page.fill('#cf-patient', 'Jane Doe'); await page.fill('#cf-chart', '99-0007');
  await page.click('.pickRow[data-g="goal_midline"] .pick[data-v="improve"]');
  await page.click('.itile[data-v="Lower IPR"]');
  check(await page.isVisible('#cf-aiBtn'), 'the Make it clear button is under Other instructions');
  check(/Make it clear/.test(await page.textContent('#cf-aiBtn')), 'the button says Make it clear');
  check(/never the patient/.test(await page.textContent('.aiBar')), 'the button explains that the name and chart # are not sent');
  check(await page.isHidden('#cf-aiOut'), 'nothing shows until it is used');

  // an empty box: asks for the note first, sends nothing
  await page.click('#cf-aiBtn');
  check(/Type the note in the box first/.test(await page.textContent('#cf-aiOut')) && sent.length === 0, 'empty note → says to type it first; nothing is sent');

  // ---- a real note, with things that must not leave ----
  const NOTE = 'Jane Doe needs lower spaces closed, dont move 16 26. chart 99-0007 seen 10/9/2026, mom Jane 352-555-0142 jdoe@example.com';
  await page.fill('#cf-instrOther', NOTE);
  mode = 'ok'; sent = [];
  await page.click('#cf-aiBtn');
  await page.waitForSelector('#cf-aiOut .aiRow');
  check(sent.length === 1, 'one request goes out');
  const body = sent[0] || {}, wire = JSON.stringify(sent);
  check(!/Jane|Doe|99-0007|10\/9\/2026|352-555-0142|jdoe@example\.com/i.test(wire), 'no name, chart #, date, phone or e-mail in anything sent');
  check(/\[patient\]/.test(body.note) && /\[chart #\]/.test(body.note) && /\[date\]/.test(body.note) && /\[removed\]/.test(body.note), 'the note says [patient] [chart #] [date] [removed] where they were');
  check(/dont move 16 26/.test(body.note) && /lower spaces closed/.test(body.note), 'the clinical words are untouched');
  check(body.kind === 'Aligners (Oliv)', 'the kind of case goes along: ' + body.kind);
  check(Array.isArray(body.chosen) && body.chosen.includes('Improve midline') && body.chosen.includes('Lower IPR'), 'what is already ticked goes along: ' + JSON.stringify(body.chosen));
  check(body.prefs === '', 'no preferences yet → none sent');
  check(Object.keys(body).sort().join() === 'chosen,kind,note,prefs,teeth', 'only those five things are sent: ' + Object.keys(body).join());

  // ---- the preview ----
  check(await page.isVisible('#cf-aiOut'), 'the preview shows');
  const rows = await page.$$eval('#cf-aiOut .aiRow', els => els.map(e => ({ t: e.textContent, box: !!e.querySelector('input:checked'), tag: !!e.querySelector('.aiTag') })));
  check(rows.length === 3 && rows.every(r => r.box), 'three steps, each ticked');
  check(rows[1].tag && !rows[0].tag && !rows[2].tag, 'only the step that used a preference is tagged');
  check(/Worth checking/.test(await page.textContent('#cf-aiOut')) && /Which arch/.test(await page.textContent('#cf-aiOut')), 'the question to check shows');
  check(await page.inputValue('#cf-instrOther') === NOTE, 'the box is not changed yet');
  check(await page.$eval('#cf-aiOut', e => document.activeElement && e.contains(document.activeElement)), 'focus moves into the preview');
  check(await page.$eval('#cf-aiOut', e => { const r = e.getBoundingClientRect(), w = e.closest('.modal, #drawer').getBoundingClientRect(); return r.top >= w.top - 1 && r.bottom <= w.bottom + 1; }), 'the whole preview is on screen without scrolling by hand');
  await shot(page, 'form-preview', { fullPage: false });

  // Keep mine
  await page.click('#cf-aiOut [data-act=aiKeep]');
  check(await page.isHidden('#cf-aiOut') && await page.inputValue('#cf-instrOther') === NOTE, 'Keep mine closes it and leaves the note');

  // Use this, with one step unticked
  await page.click('#cf-aiBtn'); await page.waitForSelector('#cf-aiOut .aiRow');
  await page.uncheck('#cf-aiOut input[data-ai="1"]');
  await page.click('#cf-aiOut [data-act=aiUse]');
  const used = await page.inputValue('#cf-instrOther');
  check(used === 'Close the remaining lower spaces; Do not move 16, 26', 'Use this puts the ticked steps in the box, joined with "; ": ' + used);
  check(/Put my words back/.test(await page.textContent('#cf-aiOut')), 'it offers Put my words back');
  await page.click('#cf-aiOut [data-act=aiUndo]');
  check(await page.inputValue('#cf-instrOther') === NOTE && await page.isHidden('#cf-aiOut'), 'Put my words back restores the note exactly');

  // Use this with nothing ticked → asks to tick one, the box stays
  await page.click('#cf-aiBtn'); await page.waitForSelector('#cf-aiOut .aiRow');
  for (const i of [0, 1, 2]) await page.uncheck('#cf-aiOut input[data-ai="' + i + '"]');
  await page.click('#cf-aiOut [data-act=aiUse]');
  check(await page.inputValue('#cf-instrOther') === NOTE && /Tick at least one step/.test(await page.textContent('#toasts, .toast, body')), 'Use this with nothing ticked → says so; the note stays');
  await page.click('#cf-aiOut [data-act=aiKeep]');

  // ---- the messages ----
  const msg = async () => (await page.textContent('#cf-aiOut')).trim();
  mode = 'old'; await page.click('#cf-aiBtn'); await page.waitForSelector('#cf-aiOut .aiMsg');
  check(/isn’t switched on yet/.test(await msg()), 'an old Worker (plain text answer) → "isn’t switched on yet"');
  mode = 'err'; await page.click('#cf-aiBtn'); await page.waitForFunction(() => /used up/.test(document.querySelector('#cf-aiOut').textContent));
  check(/used up today’s AI limit/.test(await msg()) && await page.isVisible('#cf-aiOut .aiMsg.bad'), 'the Worker’s own error is shown in the error style');
  mode = 'down'; await page.click('#cf-aiBtn'); await page.waitForFunction(() => /reach the AI/.test(document.querySelector('#cf-aiOut').textContent));
  check(/Couldn’t reach the AI helper/.test(await msg()), 'no connection → says so');
  mode = 'empty'; await page.click('#cf-aiBtn'); await page.waitForFunction(() => /Nothing to turn into steps/.test(document.querySelector('#cf-aiOut').textContent));
  check(/no instructions I can turn into steps/.test(await msg()) && await page.isHidden('#cf-aiOut [data-act=aiUse]') && /Close/.test(await page.textContent('#cf-aiOut [data-act=aiKeep]')), 'a note with no steps → the question, and only Close');
  await page.click('#cf-aiOut [data-act=aiKeep]');
  check(await page.inputValue('#cf-instrOther') === NOTE, 'the note is never lost by an error');
  const longNote = 'x'.repeat(1501); await page.fill('#cf-instrOther', longNote); sent = []; await page.click('#cf-aiBtn');
  check(/long \(1501 characters\)/.test(await msg()) && sent.length === 0, 'a note over 1500 characters → says to shorten it; nothing is sent');
  await page.fill('#cf-instrOther', NOTE);

  // ---- a slow answer: the button waits; typing meanwhile throws the answer away ----
  mode = 'ok'; sent = []; let release; gate = new Promise(r => { release = r; });
  await page.click('#cf-aiBtn');
  await page.waitForFunction(() => /Writing/.test(document.querySelector('#cf-aiBtn').textContent));
  check(await page.isDisabled('#cf-aiBtn'), 'while it works the button is off and says Writing…');
  await page.fill('#cf-instrOther', NOTE + ' and more');
  release(); gate = null;
  await page.waitForFunction(() => /changed while the AI was working/.test(document.querySelector('#cf-aiOut').textContent));
  check(await page.inputValue('#cf-instrOther') === NOTE + ' and more' && !(await page.isDisabled('#cf-aiBtn')), 'a note edited meanwhile is kept, the answer is dropped, the button is back');
  await page.fill('#cf-instrOther', NOTE);

  // ---- Use this, then save the case: the steps read like any instruction ----
  mode = 'ok'; await page.click('#cf-aiBtn'); await page.waitForSelector('#cf-aiOut .aiRow');
  await page.click('#cf-aiOut [data-act=aiUse]');
  for (let i = 0; i < 9 && !(await page.isVisible('#ncSave')); i++) { await page.click('#ncNext'); await page.waitForTimeout(100); }
  await page.click('#ncSave'); await page.waitForTimeout(400);
  const saved = await page.evaluate(() => { const c = openCases().find(x => x.patient === 'Jane Doe'); return c && { instrOther: c.instrOther, instructions: c.instructions }; });
  check(!!saved && saved.instrOther === 'Close the remaining lower spaces; IPR on the lower anterior contacts, 0.2 mm per contact; Do not move 16, 26', 'the saved case keeps the steps in Other instructions');
  check(!!saved && saved.instructions === 'Improve midline; Lower IPR; Close the remaining lower spaces; IPR on the lower anterior contacts, 0.2 mm per contact; Do not move 16, 26', 'and in the instructions the chart note reads: ' + (saved && saved.instructions));

  const note = await page.evaluate(() => { const c = openCases().find(x => x.patient === 'Jane Doe'); try { const n = chartNote(c, 'scan'); return typeof n === 'string' ? n : JSON.stringify(n); } catch (e) { return 'ERR ' + e.message; } });
  check(/Close the remaining lower spaces/.test(note) && /Do not move 16, 26/.test(note), 'the chart note carries the steps: ' + note.replace(/\s+/g, ' ').slice(0, 220));

  // ---- Team & security → AI instruction helper ----
  await page.click('#nav-admin'); await page.waitForSelector('#aiCard');
  check(await page.isVisible('#aiPrefs') && !(await page.getAttribute('#aiPrefs', 'readonly') != null), 'the owner sees the preferences box, editable');
  check(/optional/i.test(await page.textContent('#aiCard')) && /still makes every note clearer/.test(await page.textContent('#aiCard')), 'the card says the helper works without preferences');
  const PREFS = 'IPR: 0.2 mm per contact, never more than 0.3 mm\n\n  Keep the back teeth locked unless I say otherwise  ';
  await page.fill('#aiPrefs', PREFS); await page.click('#aiTry'); // (leaving the box saves it)
  await page.waitForFunction(() => S.settings && S.settings.aiPrefs);
  const savedPrefs = await page.evaluate(() => S.settings.aiPrefs);
  check(savedPrefs === 'IPR: 0.2 mm per contact, never more than 0.3 mm\nKeep the back teeth locked unless I say otherwise', 'the preferences are saved, tidied one rule per line');

  // Try it: uses what is typed in the preferences box right now. The click also leaves that box, which saves it and redraws this page
  // while the answer is on its way — the answer must still land (and the button must come back)
  await page.fill('#aiTry', 'close lower spaces, some ipr, keep post locked');
  await page.fill('#aiPrefs', savedPrefs + '\nNever IPR the upper laterals');
  sent = []; mode = 'ok'; let go; gate = new Promise(r => { go = r; });
  await page.click('[data-act=aiTry]');
  await page.waitForFunction(() => S.settings.aiPrefs.includes('upper laterals')); // (the save and the redraw have happened)
  await page.waitForFunction(() => /Writing/.test(document.querySelector('#aiCard [data-act=aiTry]').textContent) && document.querySelector('#aiCard [data-act=aiTry]').disabled);
  check(true, 'after the redraw the Try it button still says Writing… and is off');
  go(); gate = null;
  await page.waitForSelector('#aiTryOut .aiRow');
  const tb = sent[0] || {};
  check(sent.length === 1 && tb.note === 'close lower spaces, some ipr, keep post locked' && /made-up note/.test(tb.kind) && tb.chosen.length === 0, 'Try it sends the made-up note with no case behind it');
  check(/Never IPR the upper laterals/.test(tb.prefs) && /0\.2 mm per contact/.test(tb.prefs), 'Try it sends the preferences as typed, saved or not');
  check((await page.$$('#aiTryOut .aiRow.ro')).length === 3 && (await page.$$('#aiTryOut input')).length === 0, 'Try it shows the steps read-only (no ticks, no Use this)');
  check(await page.isVisible('#aiTryOut .aiTag'), 'Try it shows which step used a preference');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator('#aiCard').screenshot({ path: SHOTS + '/admin-card.png' }); }

  // the card re-draws when the page does; the made-up note and its result stay
  await page.click('#nav-board'); await page.click('#nav-admin'); await page.waitForSelector('#aiCard');
  check(await page.inputValue('#aiTry') === 'close lower spaces, some ipr, keep post locked' && (await page.$$('#aiTryOut .aiRow')).length === 3, 'leaving and coming back keeps the made-up note and its steps');
  check((await page.inputValue('#aiPrefs')) === savedPrefs + '\nNever IPR the upper laterals', 'the preferences box shows what was saved');

  // New case again: the saved preferences go with a note
  await page.click('#nav-list'); await page.click('.topBar [data-act=newCase]'); await page.waitForSelector('#ncForm');
  await page.click('#ncForm .tt[data-tile=oliv]');
  await page.fill('#cf-instrOther', 'some ipr lower ant'); sent = [];
  await page.click('#cf-aiBtn'); await page.waitForSelector('#cf-aiOut .aiRow');
  check(sent[0] && sent[0].prefs === savedPrefs + '\nNever IPR the upper laterals', 'a note goes with the saved preferences');
  check(await page.isVisible('#cf-aiOut .aiTag'), 'a step that used a preference is tagged on the case form');
  await page.click('[data-act=closeModal], .modal [data-act=close]').catch(() => { });
  await page.keyboard.press('Escape');

  // clearing the preferences
  await page.click('#nav-admin'); await page.waitForSelector('#aiCard');
  await page.fill('#aiPrefs', ''); await page.click('#aiTry');
  await page.waitForFunction(() => S.settings && S.settings.aiPrefs === '');
  check(await page.evaluate(() => S.settings.aiPrefs) === '', 'clearing the box clears the preferences');
  await page.click('#nav-list'); await page.click('.topBar [data-act=newCase]'); await page.waitForSelector('#ncForm');
  await page.click('#ncForm .tt[data-tile=oliv]'); await page.fill('#cf-instrOther', 'close spaces'); sent = [];
  await page.click('#cf-aiBtn'); await page.waitForSelector('#cf-aiOut .aiRow');
  check(sent[0] && sent[0].prefs === '' && (await page.$$('#cf-aiOut .aiRow')).length === 3, 'with no preferences it still works, and sends none');

  // ---- a phone ----
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await routes(m);
  await m.route(WORKER, r => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(GOOD) }));
  const mp = await m.newPage(); watch(mp, errs, 'mobile'); stepsAsOnePage(mp);
  await mp.goto(URL0); await mp.click('#lgBtn'); await mp.waitForSelector('.tiles');
  await mp.click('.topBar [data-act=newCase], #fab, [data-act=newCase]'); await mp.waitForSelector('#ncForm');
  await mp.click('#ncForm .tt[data-tile=oliv]');
  await mp.fill('#cf-instrOther', 'close lower spaces, dont move 16 26');
  await mp.click('#cf-aiBtn'); await mp.waitForSelector('#cf-aiOut .aiRow');
  const sw = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, out: (() => { const r = document.querySelector('#cf-aiOut').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; })() }));
  check(sw.sw <= sw.iw + 1 && sw.out.l >= 0 && sw.out.r <= sw.iw, 'on a phone the preview fits the screen: ' + JSON.stringify(sw));
  await mp.locator('#cf-aiOut').scrollIntoViewIfNeeded(); await shot(mp, 'm-preview');

  // (the two the browser logs by itself for the 429 and the dropped connection this test makes on purpose are not problems)
  const bad = errs.filter(e => !/status of 429|net::ERR_FAILED/.test(e));
  check(bad.length === 0 && !errs.some(e => /Content Security Policy|Refused to/i.test(e)), 'no page errors, no console errors, no CSP refusals: ' + (bad.join(' | ') || 'none'));
  await browser.close();
  console.log('\n' + passes.length + ' passed, ' + fails.length + ' failed');
  if (fails.length) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
