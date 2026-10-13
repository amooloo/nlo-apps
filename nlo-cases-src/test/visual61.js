// Amir, 12 Oct 2026 — three asks in one evening. Demo (practice mode), made-up patients:
//  1. "can you create a separate tab that is for things that need to go out to labs outside --- otherwords things that need to be
//     submitted to the lab thaht have not been submittted yet": To submit, with a Submitted to lab step for outside aligners
//     (he picked that, and to include appliances on Hold and MARPE cases gathering records);
//  2. "for completed cases, there should still be a way to sort and filter them and search";
//  3. "when you accdiently moving someting to the next stage and then move it back, it should not overwrite the prvious correct date".
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(URL); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  const cnt = sel => p.evaluate(s => { const e = document.querySelector(s); return e && !e.classList.contains('hidden') ? +e.textContent : 0; }, sel);
  const rows = () => p.$$eval('#listBody tr.click', rs => rs.map(r => ({ id: r.dataset.id, t: r.textContent.replace(/\s+/g, ' ').trim() })));
  const caseOf = id => p.evaluate(id => { const c = findCase(id); return c && { type: c.type, stage: c.stage, patient: c.patient, flow: typeOf(c).flow }; }, id);

  // (practice mode's made-up Oliv "setup is ready" email moves its Oliv case on to Dr. A action just after sign-in: settle first)
  await p.waitForFunction(() => !openCases().some(c => c.type === 'oliv' && c.stage === 'submit'), null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(300);
  console.log('\n# To submit: every case still to go out to a lab');
  const want = await p.evaluate(() => openCases().filter(c => (typeOf(c).flow === 'outside' && c.stage === 'submit') || (c.type === 'appliance' && ['submit', 'hold'].includes(c.stage)) || (c.type === 'marpe' && c.stage === 'records')).map(c => c.id).sort());
  check(want.length >= 4 && await cnt('#nav-submit .cnt') === want.length, 'the menu has To submit, counting ' + want.length + ' (' + await cnt('#nav-submit .cnt') + ')');
  await p.click('#nav-submit'); await p.waitForSelector('#listBody');
  check(await p.textContent('.topBar h2') === 'To submit to labs' && /Tap Submitted once a case has gone to the lab/.test(await p.textContent('.subIntro')), 'the page: “To submit to labs”, and a line saying what’s on it');
  let R = await rows();
  check(JSON.stringify(R.map(r => r.id).sort()) === JSON.stringify(want), 'it lists exactly those cases (' + R.length + ')');
  check(R.some(r => /Hold \(CBCT\/Zoom\)/.test(r.t)) && R.some(r => /Records: STL \+ CBCT/.test(r.t)) && R.filter(r => /To submit/.test(r.t)).length >= 2, 'outside aligners and appliances at To submit, the appliance on Hold, the MARPE gathering records');
  check((await p.$$('#listBody tr.click .subBtn')).length === R.length, 'each row has Submitted');
  check(!(await p.evaluate(() => openCases().some(c => typeOf(c).flow === 'inhouse' && document.querySelector('#listBody tr[data-id="' + c.id + '"]')))), 'nothing made here (in-house) is on it');
  await p.screenshot({ path: OUT + '/v61-submit.png' });

  console.log('\n# …with the open list’s search, filters and sorting');
  await p.selectOption('.filters select[data-f=type]', 'appliance'); await p.waitForTimeout(150);
  R = await rows();
  check(R.length === 2 && (await Promise.all(R.map(r => caseOf(r.id)))).every(c => c.type === 'appliance'), 'Type: Appliance → the 2 appliances (' + R.length + ')');
  await p.click('[data-act=clearF]'); await p.waitForTimeout(150);
  await p.click('#listBody th button[data-act=sort][data-k=patient]'); await p.waitForTimeout(150);
  const names = (await Promise.all((await rows()).map(r => caseOf(r.id)))).map(c => c.patient.toLowerCase());
  check(names.length === want.length && names.every((n, i) => !i || names[i - 1] <= n), 'sorted by patient, A to Z');
  const q = (await caseOf(want[0])).patient.split(' ')[0];
  await p.fill('#q', q); await p.waitForTimeout(150);
  check((await rows()).length >= 1 && (await rows()).every(r => r.t.toLowerCase().includes(q.toLowerCase())), 'searching “' + q + '” narrows it down');
  await p.fill('#q', ''); await p.waitForTimeout(150);

  console.log('\n# Submitted: the case moves to Submitted to lab and leaves the page (Undo puts it back)');
  const ol = await p.evaluate(() => openCases().find(c => typeOf(c).flow === 'outside' && c.stage === 'submit').id);
  await p.click('#listBody tr[data-id="' + ol + '"] .subBtn');
  await p.waitForFunction(id => !document.querySelector('#listBody tr[data-id="' + id + '"]'), ol, { timeout: 4000 }).catch(() => {});
  check((await caseOf(ol)).stage === 'submitted' && !(await p.$('#listBody tr[data-id="' + ol + '"]')) && await cnt('#nav-submit .cnt') === want.length - 1, 'the outside aligner case is at Submitted to lab, off the page, the menu says ' + (want.length - 1));
  await p.waitForSelector('#toasts .toast:has-text("Moved to Submitted to lab") button:has-text("Undo")', { timeout: 4000 }).catch(() => {});
  check(/Moved to Submitted to lab/.test(await p.textContent('#toasts')), 'a toast says so, with Undo');
  await p.click('#toasts .toast button:has-text("Undo")');
  await p.waitForSelector('#listBody tr[data-id="' + ol + '"]', { timeout: 4000 }).catch(() => {});
  check((await caseOf(ol)).stage === 'submit' && !!(await p.$('#listBody tr[data-id="' + ol + '"]')) && await cnt('#nav-submit .cnt') === want.length, 'Undo: back at To submit and on the page');
  const mp = await p.evaluate(() => openCases().find(c => c.type === 'marpe' && c.stage === 'records').id);
  await p.click('#listBody tr[data-id="' + mp + '"] .subBtn'); await p.waitForSelector('#gGo', { timeout: 4000 }).catch(() => {});
  check(!!(await p.$('#gGo')) && (await caseOf(mp)).stage === 'records', 'a MARPE asks for its records first (as its step does), and stays until then');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const ho = await p.evaluate(() => openCases().find(c => c.type === 'appliance' && c.stage === 'hold').id);
  await p.click('#listBody tr[data-id="' + ho + '"] .subBtn'); await p.waitForTimeout(400);
  check((await caseOf(ho)).stage === 'submitted' && !(await p.$('#listBody tr[data-id="' + ho + '"]')), 'the appliance on Hold: Submitted to lab');

  console.log('\n# Outside aligners have the Submitted to lab step (board and case panel)');
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=outside]'); await p.waitForTimeout(150);
  const cols = await p.$$eval('.board .col h4', hs => hs.map(h => h.textContent));
  check(cols.slice(0, 3).join(' | ') === 'To submit | Submitted to lab | Dr. A action', 'board, Outside aligners & braces: ' + cols.slice(0, 3).join(' | ') + ' …');
  await p.evaluate(id => openDrawer(id), ol); await p.waitForSelector('#drawer .step[data-k=submitted]');
  const steps = await p.$$eval('#drawer .stepper .step[data-k]', bs => bs.map(b => b.dataset.k));
  check(steps.slice(0, 3).join(',') === 'submit,submitted,dra', 'the case’s steps: To submit → Submitted to lab → Dr. A action');

  console.log('\n# A move put right keeps the date (submitted 10 days ago; Dr. A action by mistake; back to Submitted)');
  const ago = Date.now() - 10 * 864e5, agoDay = new Date(ago).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // (a case of its own, entered 12 days ago and moved to Submitted to lab by Sarah 10 days ago)
  const bk = await p.evaluate(async at => {
    const id = await B.createCase({ type: 'oliv', patient: 'Tessa Backstep', chart: '15-4242', stage: 'submit', detail: 'Aligners (Oliv)', comments: [], createdAt: at - 2 * 864e5, createdBy: 'sarah' });
    const L = DEMO.logs.find(l => l.caseId === id && l.a === 'create'); L.at = at - 2 * 864e5; L.sid = 'sarah';
    const c = DEMO.cases.get(id); c.stage = 'submitted'; c.rev++; DEMO.logs.push({ caseId: id, a: 'stage', from: 'submit', to: 'submitted', at, sid: 'sarah', rev: c.rev }); DEMO.emit(c);
    return id;
  }, ago);
  await p.waitForFunction(id => (findCase(id) || {}).stage === 'submitted', bk, { timeout: 4000 }).catch(() => {});
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, bk);
  await p.waitForFunction(() => /·/.test((document.querySelector('#drawer .step[data-k=submitted] .stWhen') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
  const when = () => p.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#drawer .step[data-k] .stWhen')).map(w => [w.closest('.step').dataset.k, w.textContent])));
  let w = await when();
  check(w.submitted === agoDay + ' · Sarah', 'before: Submitted to lab · ' + w.submitted);
  await p.click('#drawer .step[data-k=dra]');
  await p.waitForFunction(() => /·/.test((document.querySelector('#drawer .step[data-k=dra] .stWhen') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
  w = await when();
  check(w.dra === today + ' · Dr. A' && w.submitted === agoDay + ' · Sarah', 'moved on by mistake: Dr. A action · ' + w.dra + ' (Submitted keeps ' + w.submitted + ')');
  await p.click('#drawer .step[data-k=submitted]');
  await p.waitForFunction(id => findCase(id).stage === 'submitted' && !((document.querySelector('#drawer .step[data-k=dra] .stWhen') || {}).textContent || '').trim(), bk, { timeout: 4000 }).catch(() => {});
  w = await when();
  check(w.submitted === agoDay + ' · Sarah' && !String(w.dra || '').trim(), 'moved back: Submitted to lab still says ' + w.submitted + ' — not today — and Dr. A action has no date');
  check(await p.isVisible('#histBox .hist:has-text("moved it to Submitted to lab")'), 'the history still shows both moves');
  await p.screenshot({ path: OUT + '/v61-moved-back.png' });
  await p.click('#drawer .step[data-k=dra]'); await p.waitForTimeout(400);
  w = await when();
  check(w.dra === today + ' · Dr. A' && w.submitted === agoDay + ' · Sarah', 'moved on for real later: Dr. A action is dated then, Submitted keeps its date');
  await p.evaluate(() => closeDrawer(true));

  console.log('\n# Completed: how far back, type, who — and every heading sorts');
  await p.click('#nav-done'); await p.waitForSelector('#view .doneTbl');
  const done = () => p.$$eval('#view .doneTbl tbody tr', rs => rs.map(r => r.dataset.id));
  const all90 = await done();
  check(await p.$eval('.filters select[data-df=days]', s => s.options[s.selectedIndex].text) === 'Completed in the last 90 days' && !!(await p.$('.filters select[data-df=type]')) && !!(await p.$('.filters select[data-df=who]')), 'filters: Completed in the last 90 days, All types, Anyone (and Columns)');
  const heads = await p.$$eval('#view .doneTbl th button[data-act=dsort]', bs => bs.map(b => b.textContent.replace(/[↑↓]/g, '').trim()));
  check(['Patient', 'Type', 'Assigned', 'Delivery appt', 'Completed', 'Last stage'].every(h => heads.includes(h)) && /Completed\s*↓/.test(await p.textContent('#view .doneTbl thead')), 'headings Patient, Type, Assigned, Delivery appt, Completed, Last stage; newest completed first (Completed ↓)');
  const closedAt = ids => p.evaluate(ids => ids.map(id => findCase(id).closedAt), ids);
  let ca = await closedAt(all90);
  check(all90.length > 5 && ca.every((t, i) => !i || ca[i - 1] >= t), 'newest first (' + all90.length + ' cases)');
  await p.click('#view .doneTbl th button[data-k=patient]'); await p.waitForTimeout(150);
  let pn = await p.evaluate(ids => ids.map(id => findCase(id).patient.toLowerCase()), await done());
  check(pn.every((n, i) => !i || pn[i - 1] <= n) && /Patient\s*↑/.test(await p.textContent('#view .doneTbl thead')), 'Patient: A to Z');
  await p.click('#view .doneTbl th button[data-k=patient]'); await p.waitForTimeout(150);
  pn = await p.evaluate(ids => ids.map(id => findCase(id).patient.toLowerCase()), await done());
  check(pn.every((n, i) => !i || pn[i - 1] >= n), '…and again: Z to A');
  await p.click('#view .doneTbl th button[data-k=closed]'); await p.waitForTimeout(150);
  ca = await closedAt(await done());
  check(ca.every((t, i) => !i || ca[i - 1] >= t), 'Completed: newest first again');
  await p.selectOption('.filters select[data-df=type]', 'retainer'); await p.waitForTimeout(150);
  let ty = await p.evaluate(ids => ids.map(id => findCase(id).type), await done());
  check(ty.length > 0 && ty.every(t => t === 'retainer'), 'Type: Retainers & whitening → only those (' + ty.length + ')');
  await p.selectOption('.filters select[data-df=who]', 'sarah'); await p.waitForTimeout(150);
  ty = await p.evaluate(ids => ids.map(id => [findCase(id).type, findCase(id).assignee]), await done());
  check(ty.every(([t, a]) => t === 'retainer' && a === 'sarah'), '…and Assigned: Sarah → only hers (' + ty.length + ')');
  await p.click('[data-act=doneClear]'); await p.waitForTimeout(150);
  check((await done()).length === all90.length, 'Clear filters: all of them again');
  const one = await p.evaluate(id => findCase(id).patient, all90[3]), last = one.split(' ').slice(-1)[0];
  await p.fill('#q', one); await p.waitForTimeout(150);
  check((await done()).includes(all90[3]) && (await done()).length < all90.length, 'searching “' + one + '” finds that case');
  check(/Look through all completed cases/.test(await p.textContent('#view')), 'with a search on, it offers to look through all completed cases');
  await p.fill('#q', ''); await p.waitForTimeout(150);
  await p.selectOption('.filters select[data-df=days]', '30'); await p.waitForSelector('#view .doneTbl', { timeout: 4000 }).catch(() => {});
  const in30 = await done(); ca = await closedAt(in30);
  check(in30.length < all90.length && ca.every(t => Date.now() - t <= 30 * 864e5 + 6e4), 'Completed in the last 30 days: only those (' + in30.length + ' of ' + all90.length + ')');
  await p.selectOption('.filters select[data-df=days]', '3650'); await p.waitForSelector('#view .doneTbl', { timeout: 4000 }).catch(() => {});
  check((await done()).length > all90.length, 'All completed cases: older ones too (' + (await done()).length + ')');
  await p.screenshot({ path: OUT + '/v61-completed.png' });

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#mnav-submit'); await p.waitForSelector('#listBody .subBtn');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await p.isVisible('#listBody .subBtn'), 'To submit fits a phone, Submitted still on each row');
  await p.screenshot({ path: OUT + '/v61-phone.png' });
  await p.click('#mnav-done'); await p.waitForSelector('#view .doneTbl');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Completed fits a phone');

  const bad = errs.filter(e => !/favicon|fonts/.test(e));
  check(!bad.length, 'no page errors' + (bad.length ? ': ' + bad.join(' | ') : ''));
  await browser.close();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
