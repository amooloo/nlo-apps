// Amir, 29 Oct 2026, on MARPE cases: "when you enter Zoom date, it should already move it to the step that says Zoom scheduled", and
// "is there any way I can like link my Zooms there? … you know how you can add it to your calendar so you can click from there. So in
// the future, I can just click on there and open up the Zoom."
// 1. Edit: the Zoom call's date moves the Stage menu to Zoom call scheduled (back again when it's taken out); saving moves the case,
//    still asking for both records first. A step picked by hand stays; a case past that step stays; opening Edit on a case that already
//    has a date at an earlier step leaves it where it is.
// 2. The Zoom link: pasted alone or as the whole invite (only the link goes in), refused when it isn't one. Join Zoom in the case's
//    header, the MARPE box, its card on the board and its row in the list — a new tab, nothing passed along — while the call is ahead;
//    gone after Design approved and once the case is complete.
// 3. The Zoom call window (Set up the Zoom call / Add the Zoom link / Change) and the step's own window (the board arrow) take the link.
// 4. New submission: a Zoom date starts the case at Zoom call scheduled (both records first — it goes back to the Case step to say so).
// 5. Phone width: the header's Join Zoom fits. Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch, panelsOpen, stepsAsOnePage } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const PAGE = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
const LINK = 'https://us02web.zoom.us/j/81234567890?pwd=AbCdEfGhIjKl.1';
const INVITE = 'Partners Dental Solutions is inviting you to a scheduled Zoom meeting.\n\nTopic: MARPE design review\n' +
  'Time: Nov 3, 2026 02:30 PM Eastern Time (US and Canada)\n\nJoin Zoom Meeting\n' + LINK + '\n\nMeeting ID: 812 3456 7890\nPasscode: 123456\n\n---\nOne tap mobile\n+13052241968,,81234567890#,,,,*123456# US\n';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' }); await routes(ctx); await panelsOpen(ctx);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(PAGE).origin });
  const p = await ctx.newPage(); watch(p, errs, 'demo'); stepsAsOnePage(p);
  await p.goto(PAGE); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await p.waitForTimeout(300);
  const caseOf = id => p.evaluate(id => { const c = findCase(id); return c ? JSON.parse(JSON.stringify(c)) : null; }, id);
  const idOf = name => p.evaluate(n => (Array.from(S.cases.values()).find(c => c.patient === n) || {}).id, name);
  const make = (o) => p.evaluate(o => B.createCase(Object.assign({ type: 'marpe', lab: 'Partners Dental Solutions', detail: 'MARPE', comments: [], createdAt: Date.now(), createdBy: meSid() }, o)), o);
  const day = n => p.evaluate(n => addDays(todayISO(), n), n);
  const closeAll = () => p.evaluate(() => { if (S.editing) { S.editing = false; S.editWiz = null; } closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  const board = async () => { await closeAll(); await p.click('#nav-board'); await p.fill('#q', ''); await p.click('[data-act=flow][data-k=marpe]'); await p.waitForTimeout(150); };
  const open = async id => { await board(); await p.click('.kc[data-id="' + id + '"]'); await p.waitForSelector('#drawer .dsList'); };
  const edit = async id => { await open(id); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-zoomDate'); };
  const pasteInto = async (sel, text) => { await p.evaluate(t => navigator.clipboard.writeText(t), text); await p.click(sel); await p.keyboard.press('Control+A'); await p.keyboard.press('Control+V'); await p.waitForTimeout(80); };
  const save = async () => { await p.click('#drawer [data-act=saveEdit] >> nth=0'); await p.waitForTimeout(250); };
  const joinOk = async sel => { const a = p.locator(sel).first(); return (await a.count()) > 0 && await a.getAttribute('href') === LINK && await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel')) && /noreferrer/.test(await a.getAttribute('rel')); };

  // ---- 1. Edit: the Zoom date moves the case (demo26: MARPE at Records, the STL on file, no CBCT)
  console.log('\n# Edit: entering the Zoom date moves it to Zoom call scheduled');
  const rid = 'demo26';
  await edit(rid);
  check(await p.inputValue('#cf-stage') === 'records' && (await p.textContent('#cf-zoomHint')) === '', 'Edit opens at Records, nothing said under the Zoom call');
  await p.fill('#cf-zoomDate', await day(5));
  check(await p.inputValue('#cf-stage') === 'zoom', 'entering the Zoom date moves the Stage menu to Zoom call scheduled');
  check(/Saving moves the case to “Zoom call scheduled”\. Tick the CBCT above first — both have to be on file before the lab\./.test(await p.textContent('#cf-zoomHint')), 'it says so under the Zoom call, and that the CBCT has to be ticked first');
  await p.fill('#cf-zoomDate', '');
  check(await p.inputValue('#cf-stage') === 'records' && (await p.textContent('#cf-zoomHint')) === '', 'taking the date out puts the Stage menu back at Records');
  await p.fill('#cf-zoomDate', await day(5)); await p.fill('#cf-zoomTime', '14:30');
  // the whole invite pasted into the link box: only the link goes in
  await pasteInto('#cf-zoomUrl', INVITE);
  check(await p.inputValue('#cf-zoomUrl') === LINK && /Took the meeting link out of the invite\./.test(await p.textContent('#cf-zoomHint')), 'pasting the lab’s whole invite puts just the meeting link in the box, and says so');
  await p.locator('#cf-zoomDate').scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + '/z65-edit-form.png' });
  await save();
  check(/Tick both records \(STL scan and CBCT\) under Records on file before moving it to Zoom call scheduled\./.test(await p.textContent('#drawerNotice')) && (await caseOf(rid)).stage === 'records',
    'saving without the CBCT says both records are needed first, and the case stays at Records');
  await p.click('#drawer .pickRow[data-g=records] .pick[data-v=cbct]');
  check(/^Saving moves the case to “Zoom call scheduled”\. Took the meeting link out of the invite\.$/.test(await p.textContent('#cf-zoomHint')), 'with the CBCT ticked, the note just says saving moves it');
  await save(); await p.waitForSelector('#drawer .dsList');
  let c = await caseOf(rid);
  check(c.stage === 'zoom' && c.zoomDate === await day(5) && c.zoomTime === '14:30' && c.zoomUrl === LINK && JSON.stringify(c.records) === '["stl","cbct"]', 'saved: Zoom call scheduled, with the date, time, link and both records');
  await p.waitForSelector('#histBox .hist:has-text("Zoom link")', { timeout: 5000 }).catch(() => { });
  check(/Zoom link/.test(await p.textContent('#histBox')) && /Zoom call/.test(await p.textContent('#histBox')), 'history says the Zoom call and the Zoom link were set');

  // ---- 2. Join Zoom: header, MARPE box, card, list row
  console.log('\n# Join Zoom: in the case’s header, its MARPE box, its card and its row');
  check(await joinOk('#dZoom a[data-act=zoomJoin]') && /^Join Zoom$/.test((await p.textContent('#dZoom a[data-act=zoomJoin]')).trim()), 'the case’s header: Join Zoom, opening the link in a new tab (nothing passed along)');
  check(/Zoom call .*2:30 PM/.test(await p.textContent('#dZoom')) && await p.isVisible('#dZoom [data-act=zoomSet]'), 'beside it: the day and time of the call, and Change');
  check(await joinOk('#mpBox a[data-act=zoomJoin]'), 'the MARPE box: Join Zoom beside the call');
  await p.screenshot({ path: OUT + '/z65-header.png' });
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), p.click('#dZoom a[data-act=zoomJoin]')]); await p.waitForTimeout(200);
  const popUrl = pop ? await pop.evaluate(() => location.href).catch(() => pop.url()) : '';
  check(!!pop && (pop.url() === LINK || popUrl === LINK || /zoom\.us/.test(pop.url())) && await p.isVisible('#drawer .dsList') && await p.evaluate(id => S.openId === id, rid),
    'clicking it opens the call in a new tab and leaves the case open as it was' + (pop ? '' : ' (no new tab)'));
  for (const t of ctx.pages()) if (t !== p) await t.close();
  await board();
  const card = '.kc[data-id="' + rid + '"]';
  check(await p.isVisible('section[aria-label="Zoom call scheduled"] ' + card) && await joinOk(card + ' a.flag.zm'), 'the board: the card is under Zoom call scheduled, with Join Zoom');
  await p.screenshot({ path: OUT + '/z65-board.png' });
  await p.click(card + ' a.flag.zm'); await p.waitForTimeout(400);
  check(!(await p.isVisible('#drawer .dsList')), 'Join Zoom on the card doesn’t open the case');
  for (const t of ctx.pages()) if (t !== p) await t.close();
  await p.click('#nav-list'); await p.fill('#q', 'Riley Testcase'); await p.waitForSelector('tr.click:has-text("Riley Testcase")');
  check(await joinOk('tr.click:has-text("Riley Testcase") a.flag.zm'), 'the list: Join Zoom on the case’s row');
  await p.fill('#q', '');

  // ---- 3. a step picked by hand stays; a case past Zoom call scheduled stays; a date already there with an earlier step stays on opening Edit
  console.log('\n# The Stage menu only follows the date being entered');
  const hid = await make({ patient: 'Hana Handpick', stage: 'records', records: ['stl', 'cbct'] });
  await edit(hid);
  await p.selectOption('#cf-stage', 'submitted'); await p.fill('#cf-zoomDate', await day(3));
  check(await p.inputValue('#cf-stage') === 'submitted' && !/Saving moves/.test(await p.textContent('#cf-zoomHint')), 'a step picked by hand (Submitted to lab) stays when the date goes in');
  await save(); c = await caseOf(hid); check(c.stage === 'submitted' && c.zoomDate === await day(3), '… and saves that way');
  await edit('demo28'); // Design approved, its Zoom call in the past
  await p.fill('#cf-zoomDate', await day(2));
  check(await p.inputValue('#cf-stage') === 'approved' && (await p.textContent('#cf-zoomHint')) === '', 'a case past Zoom call scheduled (Design approved) isn’t moved back by a new date');
  await closeAll();
  const lid = await make({ patient: 'Lena Legacy', stage: 'submitted', records: ['stl', 'cbct'], zoomDate: await day(4), zoomTime: '10:00' }); // (entered before 29 Oct)
  await edit(lid);
  check(await p.inputValue('#cf-stage') === 'submitted', 'opening Edit on a case that already has its date at an earlier step leaves it at that step');
  await p.fill('#cf-notes', 'just a note'); await save(); c = await caseOf(lid);
  check(c.stage === 'submitted' && c.notes === 'just a note', '… and saving something else doesn’t move it');

  // ---- 4. the Zoom call window: Set up the Zoom call (no date yet), the link refused when it isn't one, Change, taking the link off
  console.log('\n# The Zoom call window takes the link');
  const wid = await make({ patient: 'Wes Window', stage: 'submitted', records: ['stl', 'cbct'] });
  await open(wid);
  check(/Set up the Zoom call/.test(await p.textContent('#dZoom [data-act=zoomSet]')) && /No date for the Zoom call yet · paste the link from the lab’s invite/.test(await p.textContent('#dZoom')) && !(await p.isVisible('#dZoom a[data-act=zoomJoin]')),
    'at Submitted to lab with nothing yet, the header offers Set up the Zoom call');
  await p.click('#dZoom [data-act=zoomSet]'); await p.waitForSelector('#zmUrl');
  check(await p.isDisabled('#zmSave') && /Saving moves the case to “Zoom call scheduled”/.test(await p.textContent('#modalWrap')), 'the window: Save waits for the date; it says saving moves the case');
  await p.fill('#zmDate', await day(6)); await p.fill('#zmUrl', 'see the email'); await p.locator('#zmUrl').blur();
  check(await p.isDisabled('#zmSave') && /That isn’t a meeting link/.test(await p.textContent('#zmHint')), 'words that aren’t a link: Save is off and it says why');
  await pasteInto('#zmUrl', INVITE);
  check(!(await p.isDisabled('#zmSave')) && await p.inputValue('#zmUrl') === LINK && /Took the meeting link out of the invite/.test(await p.textContent('#zmHint')), 'the invite pasted over it: just the link, and Save is on');
  await p.screenshot({ path: OUT + '/z65-window.png' });
  await p.click('#zmSave'); await p.waitForFunction(id => findCase(id).stage === 'zoom', wid);
  c = await caseOf(wid); check(c.stage === 'zoom' && c.zoomUrl === LINK && c.zoomDate === await day(6) && !c.zoomTime, 'saved: moved to Zoom call scheduled with the date and the link');
  await p.waitForSelector('#dZoom a[data-act=zoomJoin]'); check(await joinOk('#dZoom a[data-act=zoomJoin]'), 'the header now has Join Zoom');
  await p.click('#dZoom [data-act=zoomSet]'); await p.waitForSelector('#zmUrl'); await p.fill('#zmUrl', ''); await p.click('#zmSave');
  await p.waitForFunction(id => !findCase(id).zoomUrl, wid);
  await p.waitForSelector('#dZoom [data-act=zoomSet]:has-text("Add the Zoom link")');
  check(!(await p.isVisible('#dZoom a[data-act=zoomJoin]')) && /Add the link/.test(await p.textContent('#mpBox [data-act=zoomSet]')) && /No link yet/.test(await p.textContent('#mpBox')),
    'the link taken out: the header offers Add the Zoom link, the MARPE box Add the link');
  await p.click('#dZoom [data-act=zoomSet]'); await p.waitForSelector('#zmUrl'); await p.fill('#zmUrl', 'us02web.zoom.us/j/81234567890?pwd=AbCdEfGhIjKl.1'); await p.click('#zmSave');
  await p.waitForFunction(id => !!findCase(id).zoomUrl, wid); c = await caseOf(wid);
  check(c.zoomUrl === LINK && c.stage === 'zoom', 'a Zoom link typed without https:// gets it; just the link changed, the case stays where it is');
  await p.waitForSelector('#histBox .hist:has-text("Zoom link")', { timeout: 5000 }).catch(() => { });
  check(/changed Zoom link/.test(await p.textContent('#histBox')), 'history: “changed Zoom link” (only what changed)');

  // ---- 5. the step's own window (the board arrow) takes the link too
  console.log('\n# Moving it to Zoom call scheduled from the board asks for the link too');
  const gid = await make({ patient: 'Gil Gatewise', stage: 'submitted', records: ['stl', 'cbct'] });
  await board(); await p.click('.kc[data-id="' + gid + '"] .adv'); await p.waitForSelector('#gZoomUrl');
  check(await p.isDisabled('#gGo') && /if you have it/.test(await p.textContent('label[for=gZoomUrl]')), 'the arrow asks for the date (needed) and the link (if they have it)');
  await p.fill('#gZoomDate', await day(2)); await p.fill('#gZoomTime', '09:15');
  check(!(await p.isDisabled('#gGo')), 'with the date, it can move without a link');
  await p.fill('#gZoomUrl', 'not a link'); await p.locator('#gZoomUrl').blur();
  check(await p.isDisabled('#gGo') && /That isn’t a meeting link/.test(await p.textContent('#gZoomHint')), 'but not with words that aren’t a link in the box');
  await pasteInto('#gZoomUrl', INVITE); check(!(await p.isDisabled('#gGo')) && await p.inputValue('#gZoomUrl') === LINK, 'the invite pasted: just its link');
  await p.click('#gGo'); await p.waitForFunction(id => findCase(id).stage === 'zoom', gid);
  c = await caseOf(gid); check(c.zoomUrl === LINK && c.zoomTime === '09:15', 'moved to Zoom call scheduled with the date, time and link');
  await p.waitForSelector('.kc[data-id="' + gid + '"] a.flag.zm'); check(await joinOk('.kc[data-id="' + gid + '"] a.flag.zm'), 'its card has Join Zoom');
  await open(gid); await p.waitForSelector('#histBox .hist:has-text("Zoom call scheduled")', { timeout: 5000 }).catch(() => { });
  check(/moved it to Zoom call scheduled \(and set Zoom call, Zoom link\)/.test(await p.textContent('#histBox')), 'history: moved it to Zoom call scheduled (and set Zoom call, Zoom link)');
  // after the call: Design approved — no Join Zoom anywhere
  await board(); await p.click('.kc[data-id="' + gid + '"] .adv'); await p.waitForFunction(id => findCase(id).stage === 'approved', gid); await p.waitForTimeout(200);
  check(!(await p.isVisible('.kc[data-id="' + gid + '"] a.flag.zm')), 'Design approved: the card’s Join Zoom is gone');
  await open(gid); check(!(await p.isVisible('#dZoom')) && !(await p.isVisible('#mpBox a[data-act=zoomJoin]')), '… and the header’s and the MARPE box’s');
  await closeAll();
  // a completed case shows none either
  check(await p.evaluate(id => { const c = Object.assign({}, findCase(id), { stage: 'zoom', status: 'done' }); return !zoomChip(c) && !zoomHdrHTML(c, true) && !/zoomJoin/.test(marpeBoxHTML(c, true)); }, gid), 'a completed case: no Join Zoom');

  // ---- 6. New submission: the Zoom date starts it at Zoom call scheduled
  console.log('\n# New submission: a Zoom date starts the case at Zoom call scheduled');
  await closeAll(); await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=marpe]'); await p.fill('#cf-patient', 'Nora Newmarpe'); await p.fill('#cf-chart', 'NM-1001');
  await p.click('#ncForm .pickRow[data-g=records] .pick[data-v=stl]');
  await p.fill('#cf-zoomDate', await day(8)); await p.fill('#cf-zoomTime', '11:00');
  check(await p.inputValue('#cf-stage') === 'zoom' && /It starts at “Zoom call scheduled”\. Tick the CBCT above first/.test(await p.textContent('#cf-zoomHint')), 'the date starts it at Zoom call scheduled, and says the CBCT is still needed');
  await pasteInto('#cf-zoomUrl', INVITE);
  await p.click('#ncSave'); await p.waitForTimeout(300);
  check(/Tick both records/.test(await p.textContent('#ncErr')) && await p.evaluate(() => document.querySelector('#modalWrap')._wiz.cur) === 'case' && await p.isVisible('#ncForm .pickRow[data-g=records]'),
    'Submit without the CBCT: it says both records are needed and shows the Case step with them');
  await p.click('#ncForm .pickRow[data-g=records] .pick[data-v=cbct]');
  // (Next through the steps to Review: it lists the Zoom call)
  for (let i = 0; i < 6 && !(await p.isVisible('#ncSave')); i++) { await p.click('#ncNext'); await p.waitForTimeout(80); }
  check(/Zoom call.*· link added/.test(await p.textContent('#wizSum')), 'Review lists the Zoom call, with “link added”');
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 10000 });
  const nid = await idOf('Nora Newmarpe'); c = await caseOf(nid);
  check(c && c.stage === 'zoom' && c.zoomUrl === LINK && c.zoomDate === await day(8) && c.zoomTime === '11:00', 'created at Zoom call scheduled, with the date, time and link');
  // a New submission without a date starts at Records as before
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=marpe]'); await p.fill('#cf-patient', 'Otis Nodate');
  check(await p.inputValue('#cf-stage') === 'records' && (await p.textContent('#cf-zoomHint')) === '', 'without a Zoom date a new MARPE still starts at Records');
  await closeAll();

  // ---- 7. phone width: the header's Join Zoom fits
  console.log('\n# Phone');
  const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 }); watch(ph, errs, 'phone');
  await ph.goto(PAGE); await ph.click('#lgBtn'); await ph.waitForSelector('.tiles');
  await ph.evaluate(() => openDrawer('demo27')); await ph.waitForSelector('#dZoom a[data-act=zoomJoin]');
  const fit = await ph.evaluate(() => { const r = document.querySelector('#dZoom a[data-act=zoomJoin]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  check(fit, 'on a phone the header’s Join Zoom fits, nothing scrolls sideways');
  await ph.screenshot({ path: OUT + '/z65-phone.png' });
  await ph.close();

  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
