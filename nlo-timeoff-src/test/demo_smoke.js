/* Clicks through the demo (?demo, made-up people) on a desktop and a phone screen, as Dr. A, as someone who approves and as
   staff: Home, approving and not approving (with the front-desk email), recording time off for someone, a request's history,
   Who's out, Team (an HR record, an adjustment, payroll, year end), Settings (who approves and the new HR key, a policy change
   that applies from a day, blackouts, closures, the front-desk switch, the feed), moving from the old app (the made-up Sheet:
   the check, the three choices, Replace, moving again changes nothing), what someone who approves can and can't do, and staff
   (balances, the statement, a request blocked by a blackout, sending, changing and cancelling one, cancelling approved time
   off). Every button on every screen has a handler, nothing scrolls sideways on a phone, and no page errors.
   Needs a static server on :8770 serving dist/. Run: node test/demo_smoke.js  (screenshots go to shots/) */
process.env.TZ = 'America/New_York';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { routes, watch, CHROME } = require('./helpers');
const URL = 'http://127.0.0.1:' + (process.env.PORT || 8770) + '/nlo-timeoff.html?demo';
const SHOTS = path.join(__dirname, '..', 'shots');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [], acts = new Set();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true, timezoneId: 'America/New_York' });
  await routes(ctx);
  const page = await ctx.newPage(); watch(page, errs, 'desktop');
  const shot = (n, full) => page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: !!full });
  const collect = async () => (await page.$$eval('[data-act]', els => els.map(e => e.dataset.act))).forEach(a => acts.add(a));
  const E = (f, a) => page.evaluate(f, a);
  const toastHas = async re => { for (let i = 0; i < 20; i++) { if (await page.$$eval('.toast', (t, src) => t.some(x => new RegExp(src).test(x.textContent)), re.source)) return true; await page.waitForTimeout(100); } return false; };
  const settle = () => page.waitForTimeout(450);
  const nav = async v => { await page.click('#side [data-act=nav][data-v=' + v + ']'); await page.waitForTimeout(200); await collect(); };
  /* sign in; on a page already open (locked), "Look at it as" someone else — the demo keeps what was done */
  const signIn = async (as, pg, again) => {
    pg = pg || page;
    if (again) await pg.click('[data-act=demoAs][data-as="' + (as || '') + '"]'); else await pg.goto(URL + (as ? '&as=' + as : ''));
    await pg.click('#lgBtn'); await pg.waitForSelector('#side .navBtn[data-v=home]', { state: 'attached' }); await pg.waitForTimeout(500);
  };
  const lock = async () => { await page.click('#side [data-act=lock]'); await page.waitForSelector('#lgBtn'); };
  const reqOf = (sid, st, type) => E(([sid, st, type]) => { const r = allReqs().find(x => x.sid === sid && x.status === st && (!type || x.type === type)); return r ? JSON.parse(JSON.stringify(r)) : null; }, [sid, st, type]);
  const bal = sid => E(sid => { const L = ledgerOf(sid); return L ? { vac: L.vac, sick: L.sick } : null; }, sid);
  // copies go here instead of the system clipboard
  const clipOn = () => E(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: s => { window.__clip.push(s); return Promise.resolve(); } } }); });

  /* =================== Dr. A =================== */
  console.log('# Dr. A');
  await signIn('');
  await clipOn(); await collect(); await shot('owner-home', true);
  ok(/4 requests waiting for you/.test(await page.textContent('.callout')), 'Home: “4 requests waiting for you”');
  ok(/2 scrubs requests waiting for you/.test(await page.textContent('#view')), 'Home: “2 scrubs requests waiting for you” too');
  ok((await page.title()) === '(6) NLO Time Off', 'the tab counts them all: ' + await page.title());
  ok((await page.textContent('#nav-appr .cnt')) === '6', 'Approvals shows 6');
  ok(/No HR record for you/.test(await page.textContent('.balCard')), 'Dr. A has no HR record: no balances, a line saying so');
  // ---- approvals
  await nav('appr'); await shot('owner-approvals', true);
  ok(await page.$$eval('.apCard', c => c.length) === 6 && await page.$$eval('.subH', h => h.some(x => x.textContent === 'Scrubs')), 'Approvals: 4 time-off requests and 2 for scrubs waiting');
  const rileyP = await reqOf('riley', 'pending'), morganP = await reqOf('morgan', 'pending'), jordanP = await reqOf('jordan', 'pending'), caseyP = await reqOf('casey', 'pending');
  const card = id => page.$eval('.apCard:has([data-id="' + id + '"])', e => e.textContent);
  const rc = await card(rileyP.id);
  ok(/3 months’ notice/.test(rc) && /Taylor is off 2 of these days .* same department/.test(rc), 'Riley’s week: short notice, and Taylor (same department) is off then');
  ok(/Unpaid/.test(rc), '…and more than her vacation by then: part would be unpaid');
  ok(/Part-time staff don’t earn paid vacation/.test(await card(morganP.id)), 'Morgan (part-time): paid vacation would be unpaid');
  ok(await page.$('.apCard [data-act=approve][data-id="' + jordanP.id + '"]') !== null, 'Dr. A can decide Jordan’s (an approver’s) own request');
  const out0 = await E(() => DEMO.outbox.length);
  await page.click('[data-act=approve][data-id="' + rileyP.id + '"]');
  ok(await toastHas(/Approved — Riley sees it now/), 'Approve → “Approved — Riley sees it now”');
  await settle();
  const rA = await E(id => { const r = S.reqs.get(id); return { st: r.status, d: r.decision, board: S.board.some(o => o.id === id) }; }, rileyP.id);
  ok(rA.st === 'approved' && rA.d.by === 'amir' && rA.board, '…approved, decided by Dr. A, on Who’s out');
  const mail = await E(() => DEMO.outbox[DEMO.outbox.length - 1]);
  ok((await E(() => DEMO.outbox.length)) === out0 + 1 && /^Schedule block needed: Riley, /.test(mail.subject) && !/vacation|wedding|Denver/i.test(mail.subject + mail.text), 'the front desk is emailed to block the schedule — name and days only: ' + mail.subject);
  ok((await page.title()) === '(5) NLO Time Off', 'the tab now counts 5 (3 time off, 2 scrubs)');
  await page.click('[data-act=deny][data-id="' + morganP.id + '"]'); await page.waitForSelector('#nbYes');
  await page.click('#nbYes'); ok(await toastHas(/Add a short note first/), 'Not approved needs a note');
  await page.fill('#nbTxt', 'Part-time — could we make it unpaid?'); await page.click('#nbYes');
  ok(await toastHas(/Answered — Morgan sees it now/), '…with one: “Answered — Morgan sees it now”');
  await settle();
  const mD = await E(id => S.reqs.get(id), morganP.id);
  ok(mD.status === 'denied' && mD.decision.note === 'Part-time — could we make it unpaid?', '…not approved, with the note');
  // a request in full
  await page.click('.apCard:has([data-id="' + caseyP.id + '"]) [data-act=openReq]'); await page.waitForSelector('#drawer');
  await page.waitForTimeout(250); await collect(); await shot('owner-request');
  const dr = await page.textContent('#drawer');
  ok(/Car inspection/.test(dr) && /asked for it/.test(dr) && /Afternoon \(PM\)/.test(dr), 'the request: its note, the afternoon, its history');
  await page.keyboard.press('Escape');
  // record time off for someone (a sick call-in: sick leave is only ever today or earlier)
  const day = await E(() => { let d = todayISO(); for (let i = 0; i < 10 && !isOfficeDay(d, S.closed); i++) d = addDays(d, -1); return d; });
  await page.click('[data-act=recordFor]'); await page.waitForSelector('#fFor');
  await page.selectOption('#fFor', 'morgan'); await page.waitForTimeout(150); await page.click('[data-act=fType][data-k=bereave]'); await page.waitForTimeout(100);
  ok(/Unpaid — the handbook doesn’t pay bereavement for part-time staff/.test(await page.textContent('#fPaidBox')) && !(await page.$('#fPaidBox [data-act=fPaid]')) && /Unpaid \(part-time\)/.test(await page.textContent('[data-act=fType][data-k=bereave]')), 'bereavement for part-time Morgan: unpaid, as the handbook says (no choice to make)');
  await page.selectOption('#fFor', 'taylor'); await page.waitForTimeout(150);
  await page.click('[data-act=fType][data-k=sick]'); await page.fill('#fStart', day); await page.fill('#fEnd', day); await page.dispatchEvent('#fEnd', 'input');
  await page.waitForTimeout(150); await collect(); await shot('owner-record');
  ok(/Record it \(approved\)/.test(await page.textContent('[data-act=fSend]')), 'the form records it as approved');
  await page.click('[data-act=fSend]');
  ok(await toastHas(/Recorded for Taylor/), 'Recorded for Taylor');
  await settle();
  const tR = await E(d => allReqs().find(r => r.sid === 'taylor' && r.start === d && r.type === 'sick'), day);
  ok(tR && tR.status === 'approved' && tR.events[0].a === 'record' && tR.decision.by === 'amir', '…approved, recorded by Dr. A');
  // ---- My benefits: Dr. A has no HR record of his own, so he sees each person's page as they see it
  await nav('ben'); await page.waitForTimeout(150); await shot('owner-benefits');
  const benTxt = await page.textContent('#view');
  ok(!!(await page.$('#benAs')) && /Your time off/.test(benTxt) && /Bronze|Silver|Gold|Platinum/.test(benTxt) && /Celebrate Primary Care/.test(benTxt) && /401\(k\)/.test(benTxt), 'My benefits for Dr. A (no record of his own): a staff member’s page, as they see it');
  await page.selectOption('#benAs', 'riley'); await page.waitForTimeout(150);
  ok(/March 13, 2023/.test(await page.textContent('#view')), '…and Riley’s, picked from the list');
  // ---- who's out
  await nav('out'); await shot('owner-out');
  ok(await page.$$eval('.calDay', d => d.length) >= 28, 'Who’s out: the month');
  for (let i = 0; i < 3 && !(await E(id => !!document.querySelector('.outChip[data-id="' + id + '"]'), rileyP.id)); i++) { await page.click('[data-act=mon][data-n="1"]'); await page.waitForTimeout(120); }
  ok(await E(id => document.querySelectorAll('.outChip[data-id="' + id + '"]').length === 4, rileyP.id), 'Riley’s approved week shows on each of its 4 days');
  await page.click('[data-act=mon][data-n="0"]').catch(() => { });
  // ---- team
  await nav('team'); await shot('owner-team', true);
  ok(await page.$$eval('#view tbody tr', r => r.length) === 7, 'Team: everyone who works here (7, Dr. A included)');
  ok(/No HR record yet/.test(await page.textContent('#view tr[data-sid=drew]')), 'Drew (new) has no HR record yet');
  ok(/Part-time/.test(await page.textContent('#view tr[data-sid=morgan] td:nth-child(2)')), 'Morgan shows Part-time instead of a tier');
  // ---- Staff Hub (a made-up roster): start dates, full-/part-time and last days come from it
  ok(await E(() => S.hrRecs.get('morgan').emp === 'Part-time' && ['riley', 'casey', 'morgan', 'taylor'].every(s => (S.hrRecs.get(s).sh || {}).id === 'demo-' + s && S.hrRecs.get(s).sh.f.join() === 'hire,type,left') && S.hrRecs.get('sam').sh.f.join() === 'left'),
    'where Staff Hub and the records agree, the records are marked as Staff Hub’s by themselves (Riley, Casey, Morgan, Taylor; for Sam, whose login was removed, only his last day)');
  ok(await E(() => S.hrRecs.get('jordan').hire === '2010-06-03' && !S.hrRecs.get('jordan').sh && SH.pending.length === 1 && SH.pending[0].sid === 'jordan'), '…Jordan’s start date there differs: it waits for Dr. A, and nothing changes until then');
  ok(await toastHas(/Staff Hub has changes for Jordan — nothing changes here until you bring them in/), '…and Dr. A is told so when he opens Time Off');
  await page.waitForSelector('#shTeam .accessRow', { timeout: 5000 }).catch(() => { });
  const shT = await page.textContent('#shTeam');
  ok(/No login yet[\s\S]*Avery \(demo\)[\s\S]*starts/.test(shT) && /Not linked to Staff Hub[\s\S]*Drew \(demo\)/.test(shT) && /Staff Hub has changes for Jordan/.test(shT), 'Team: Avery is on Staff Hub with no login yet (starting soon); Drew isn’t linked to Staff Hub; Jordan’s change waits in Settings');
  await page.click('#view tr[data-sid=morgan]'); await page.waitForSelector('#drawer [data-act=editHR]');
  ok((await page.$$eval('#drawer .sug.blue', e => e.length)) === 2, 'Morgan’s record: her hire date and part-time marked “Staff Hub”');
  await page.click('#drawer [data-act=editHR]'); await page.waitForSelector('#hrSave'); await collect();
  ok(await E(() => ['hrHire', 'hrType', 'hrLeft'].every(id => document.getElementById(id).disabled)) && /From Staff Hub \(its start date\) — change it there/.test(await page.textContent('.modal')), '…her HR record: hire date, employment and last day can’t be changed here (“From Staff Hub — change it there”)');
  await page.fill('#hrNotes', 'Prefers mornings'); await page.click('#hrSave'); ok(await toastHas(/^Saved/), '…the rest can');
  await settle();
  ok(await E(() => { const m = S.hrRecs.get('morgan'); return m.notes === 'Prefers mornings' && m.hire === '2024-09-09' && m.type === 'PT' && m.emp === 'Part-time' && m.sh.id === 'demo-morgan'; }), '…and Staff Hub’s stay as they were');
  await page.keyboard.press('Escape');
  await page.click('#view tr[data-sid=drew]'); await page.waitForSelector('#drawer [data-act=editHR]');
  await page.click('#drawer [data-act=editHR]'); await page.waitForSelector('#hrSave');
  await page.click('#hrSave'); ok(await toastHas(/Add the hire date/), 'an HR record needs the hire date');
  const drewHire = await E(() => addDays(todayISO(), -40));
  await page.fill('#hrHire', drewHire); await page.fill('#hrDept', 'Front office'); await collect();
  await page.click('#hrSave'); ok(await toastHas(/^Saved/), 'Drew’s record saved');
  await settle();
  const drewRec = await E(() => S.hrRecs.get('drew'));
  ok(drewRec && drewRec.hire === drewHire && drewRec.dept === 'Front office' && !drewRec.open, '…hire date and department; no opening balance (from 0 on the hire date)');
  await page.keyboard.press('Escape');
  await page.click('#shTeam [data-act=shLink][data-sid=drew]'); await page.waitForSelector('#shPick'); await collect();
  ok(await E(() => Array.from(document.querySelectorAll('#shPick option')).map(o => o.value).join()) === ',demo-avery,demo-sam,-', 'Link…: Drew can be linked to someone on Staff Hub no current login is linked to (Avery; Sam, whose login was removed — a rehire’s new login would be linked so), or marked as not on it');
  await page.selectOption('#shPick', '-'); await page.click('#shPickSave'); ok(await toastHas(/Drew \(demo\): not on Staff Hub/), '…marked as not on Staff Hub');
  await page.waitForFunction(() => !/Drew/.test((document.querySelector('#shTeam') || {}).textContent || 'Drew'), null, { timeout: 8000 }).catch(() => { });
  ok(await E(() => staff('drew').rid === '-' && !/Not linked to Staff Hub/.test(document.querySelector('#shTeam').textContent)), '…and Team no longer asks about him (his hire date is kept here)');
  await page.click('#view tr[data-sid=riley]'); await page.waitForSelector('#drawer [data-act=addAdj]'); await collect(); await shot('owner-person', true);
  ok(/Statement/.test(await page.textContent('#drawer')) && /Opening balance/.test(await page.textContent('#drawer')), 'Riley’s panel: balances, HR record, statement');
  const rb0 = await bal('riley');
  await page.click('#drawer [data-act=addAdj]'); await page.waitForSelector('#adSave');
  await page.fill('#adH', '4'); await page.dispatchEvent('#adH', 'input');
  ok(/Vacation .* → .* h now/.test(await page.textContent('#adPrev')), 'an adjustment shows what it does before it’s saved: ' + await page.textContent('#adPrev'));
  await page.click('#adSave'); ok(await toastHas(/Add the reason/), '…and needs a reason');
  await page.fill('#adNote', 'Covered the Saturday event'); await page.click('#adSave'); ok(await toastHas(/Adjustment added/), 'Adjustment added');
  await settle();
  const rb1 = await bal('riley');
  ok(Math.abs(rb1.vac - rb0.vac - 4) < 0.001 && rb1.sick === rb0.sick, 'Riley’s vacation +4 h (' + rb0.vac + ' → ' + rb1.vac + ')');
  ok(/Covered the Saturday event/.test(await page.textContent('#drawer')), '…listed in her panel and statement');
  const adjId = await E(() => S.hrRecs.get('riley').adj.find(a => a.note === 'Covered the Saturday event').id);
  await page.click('#drawer [data-act=rmAdj][data-id="' + adjId + '"]'); await page.click('#cbYes'); ok(await toastHas(/Removed/), 'an adjustment can be removed');
  await settle();
  ok((await bal('riley')).vac === rb0.vac, '…and the balance is back');
  await page.keyboard.press('Escape');
  // payroll and year end
  await page.click('[data-act=tab][data-t=pay]'); await page.waitForTimeout(150); await collect();
  const from = await E(() => addDays(todayISO(), -120)), to = await E(() => addDays(todayISO(), 60));
  await page.fill('#pfFrom', from); await page.dispatchEvent('#pfFrom', 'change'); await page.fill('#pfTo', to); await page.dispatchEvent('#pfTo', 'change'); await page.waitForTimeout(200); await collect();
  await shot('owner-payroll');
  ok(await page.$$eval('#view tbody tr', r => r.length) >= 4, 'Payroll: approved time off by person for a pay period');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=payCSV]')]);
  const csvTxt = fs.readFileSync(await dl.path(), 'utf8');
  ok(dl.suggestedFilename() === 'time-off-payroll.csv' && /^Time off /.test(csvTxt) && /"Vacation hours"/.test(csvTxt), 'Download CSV: time-off-payroll.csv');
  await page.click('[data-act=payCopy]'); ok(/\tVacation hours\t/.test(await E(() => window.__clip.pop() || '')), 'Copy for Paychex: tab-separated');
  await page.click('[data-act=tab][data-t=year]'); await page.waitForTimeout(150); await collect();
  ok(/year end/i.test(await page.textContent('#view .cardHd h3')), 'Year end: what’s left on Dec 31');
  // ---- settings
  await nav('settings'); await page.waitForSelector('#apprBox .accessRow'); await page.waitForTimeout(300); await collect(); await shot('owner-settings', true);
  // Staff Hub: connected; changes wait for Dr. A, with what they do to the balance
  await page.waitForSelector('#shBox [data-act=shRefresh]');
  const shB = await page.textContent('#shBox');
  ok(/Waiting for you \(1\)[\s\S]*Jordan \(demo\)[\s\S]*start date Jun 3, 2010 → Jun 1, 2010[\s\S]*Balances today stay as they are/.test(shB) && /5 of 6 people with a login/.test(shB) && /no login yet\s*Avery \(demo\)/i.test(shB),
    'Settings → Staff Hub: Jordan’s start date waits, with what it does to the balance (nothing today); 5 of 6 linked; Avery has no login yet');
  await page.click('#shBox [data-act=shApplyOne][data-sid=jordan]'); ok(await toastHas(/Brought in from Staff Hub — Jordan \(demo\): start date Jun 3, 2010 → Jun 1, 2010/), 'Bring in: Jordan’s start date');
  await settle();
  ok(await E(() => S.hrRecs.get('jordan').hire === '2010-06-01' && S.hrRecs.get('jordan').sh.id === 'demo-jordan' && !SH.pending.length), '…in the record, marked as Staff Hub’s; nothing else waits');
  const tb0 = await bal('taylor');
  await E(() => { DEMO.shData.people['demo-taylor'].employment = 'PRN / Temp'; });
  await page.click('#shBox [data-act=shRefresh]'); await page.waitForSelector('#shBox [data-act=shApplyOne][data-sid=taylor]', { timeout: 5000 });
  ok(/Taylor \(demo\)[\s\S]*PRN \/ Temp from/.test(await page.textContent('#shBox')) && await E(() => S.hrRecs.get('taylor').type === 'FT'), 'Taylor made PRN in Staff Hub: “Read it again” shows it waiting (“PRN / Temp from today”) — her record unchanged until it’s brought in');
  await page.click('#shBox [data-act=shApplyOne][data-sid=taylor]'); ok(await toastHas(/Taylor \(demo\): PRN \/ Temp from/), '…brought in');
  await settle();
  ok(await E(() => { const r = S.hrRecs.get('taylor'); return r.type === 'PT' && r.emp === 'PRN / Temp' && r.typeWas.length === 1 && r.typeWas[0].type === 'FT' && r.typeWas[0].until === addDays(todayISO(), -1); }) && (await E(() => isLastOfMonth(todayISO())) || JSON.stringify(await bal('taylor')) === JSON.stringify(tb0)),
    '…PRN from today: what she has earned stays (full-time through yesterday)');
  ok(/Last brought in, .*Taylor \(demo\): PRN \/ Temp from/.test(await page.textContent('#shBox')), '…and the card says what was brought in last');
  await E(() => { DEMO.shData.people['demo-taylor'].employment = 'Full-time'; });
  await page.click('#shBox [data-act=shRefresh]'); await page.waitForSelector('#shBox [data-act=shApplyOne][data-sid=taylor]', { timeout: 5000 });
  await page.click('#shBox [data-act=shApplyOne][data-sid=taylor]'); ok(await toastHas(/Taylor \(demo\): full-time from/), '…and back to full-time');
  await settle();
  ok(await E(() => S.hrRecs.get('taylor').type === 'FT') && JSON.stringify(await bal('taylor')) === JSON.stringify(tb0), '…her balance as it was');
  const sw = uid => '#apprBox [data-act=toggleHR][data-uid="' + uid + '"]';
  ok(await page.$eval(sw('u-casey'), e => e.disabled) && /sign in once/.test(await page.textContent('#apprBox .accessRow:has([data-uid="u-casey"])')), 'Who approves: Casey can’t be turned on until she has signed in once');
  ok(await page.$eval(sw('u-jordan'), e => e.getAttribute('aria-checked')) === 'true', 'Jordan approves');
  await page.click(sw('u-taylor')); await page.click('#cbYes'); ok(await toastHas(/Taylor approves time off now/), 'turn Taylor on');
  await page.waitForTimeout(500);
  ok(await page.$eval(sw('u-taylor'), e => e.getAttribute('aria-checked')) === 'true' && (await E(() => S.team)).includes('taylor'), '…on, and in the list of who approves');
  const v0 = await E(() => B.hr.curV);
  await page.click(sw('u-taylor')); await page.click('#cbYes');
  ok(await toastHas(/Approving turned off for Taylor/), 'turn Taylor off: a new HR key, everything sealed again');
  ok((await E(() => B.hr.curV)) === v0 + 1 && !(await E(() => S.team)).includes('taylor'), '…key #' + (v0 + 1));
  // a policy change from today: balances before it stay as they were
  const cb0 = await bal('casey');
  await page.fill('[data-tier="0"][data-f=perMonth]', '3'); await page.click('[data-act=tierAdd]'); await page.waitForTimeout(150);
  ok(await page.$$eval('[data-tier][data-f=from]', e => e.length) === 6 && await page.$eval('[data-tier="0"][data-f=perMonth]', e => e.value) === '3', 'Add a tier keeps what was typed (Bronze, Silver, Gold, Platinum, Double Platinum + 1)');
  await page.click('.tierEd [data-act=tierRm][data-i="3"]'); await page.waitForTimeout(150);
  await page.click('[data-act=savePolicy]'); await page.click('#cbYes'); ok(await toastHas(/Policy saved/), 'Policy saved (from today)');
  await page.waitForTimeout(500);
  const pol = await E(() => ({ t0: S.pol.tiers[0].perMonth, from: S.pol.from, prev: S.pol.prev.length, until: S.pol.prev[0] && S.pol.prev[0].until }));
  ok(pol.t0 === 3 && pol.prev === 1 && pol.until === await E(() => addDays(todayISO(), -1)), 'Tier 1 is 3 h a month from today; the earlier policy is kept up to yesterday');
  ok(JSON.stringify(await bal('casey')) === JSON.stringify(cb0), 'Casey (Tier 1): today’s balance hasn’t changed — earlier months stay as they were');
  ok(/3 h on /.test(await E(() => { const n = nextAccrual(S.hrRecs.get('casey'), S.pol, todayISO()); return hrs(n.vac) + ' h on '; })), '…her next month-end earns 3 h');
  await page.click('[data-act=handbookPolicy]'); await page.click('#cbYes'); ok(await toastHas(/Back to the handbook/), 'Back to the handbook');
  await page.waitForTimeout(500);
  ok((await E(() => S.pol.tiers[0].perMonth)) === 2.83, '…2.83 h a month again');
  // blackouts
  const bf = await E(() => addMonths(todayISO(), 4)), bt = await E(() => addDays(addMonths(todayISO(), 4), 6));
  await page.fill('#bkLabel', 'Spring rush'); await page.fill('#bkFrom', bf); await page.fill('#bkTo', bt); await page.click('[data-act=addBlk]');
  ok(await toastHas(/Blackout added/), 'Blackout added'); await page.waitForTimeout(450);
  ok((await E(() => S.blackouts.map(b => b.label))).join() === 'January,Thanksgiving week,Spring rush', '…next to January and Thanksgiving week');
  // closures: a closed day comes back to everyone's balance
  const rOct = await reqOf('riley', 'approved'), riley3 = await E(() => allReqs().find(r => r.sid === 'riley' && r.status === 'approved' && r.start > todayISO()));
  const h0 = await E(id => reqHours(S.reqs.get(id), S.closed, S.pol), riley3.id);
  await page.fill('#clDate', riley3.start); await page.fill('#clLabel', 'Water main repair'); await page.click('[data-act=addClos]');
  ok(await toastHas(/is closed/), 'a closure added'); await page.waitForTimeout(450);
  const h1 = await E(id => reqHours(S.reqs.get(id), S.closed, S.pol), riley3.id);
  ok(h1 === h0 - 8.5, 'Riley’s approved time off that day no longer counts (' + h0 + ' → ' + h1 + ' h)');
  await page.click('[data-act=rmClos][data-d="' + riley3.start + '"]'); await page.click('#cbYes'); await page.waitForTimeout(450);
  ok((await E(id => reqHours(S.reqs.get(id), S.closed, S.pol), riley3.id)) === h0, '…removed again');
  ok(rOct !== null, '(Riley has approved time off)');
  // front desk, feed
  await page.waitForSelector('#deskBox .sug'); ok(/frontdesk@example\.com/.test(await page.textContent('#deskBox')), 'Front-desk emails: on, and where they go');
  await page.click('[data-act=toggleDesk]'); await page.waitForTimeout(400);
  ok((await E(() => S.settings.to.frontDesk)) === false, 'turned off');
  await page.click('[data-act=toggleDesk]'); await page.waitForTimeout(400);
  await page.click('[data-act=feedNow]'); ok(await toastHas(/The feed is up to date/), 'the feed for CADANCe and the calendar: updated');
  await page.waitForTimeout(300);
  const feed = await E(() => DEMO.feed);
  const fj = JSON.stringify(feed);
  ok(feed.timeOff.length > 3 && feed.timeOff.every(o => o.sid && o.employeeName && o.start && o.end && o.hours) && feed.pending === 2, 'the feed: who, days, how much of the day; 2 waiting');
  ok(!/"type"|"note"|"paid"|Vacation|Sick|wedding|inspection|Bereave/i.test(fj.replace(/"hours":"[^"]*"/g, '')), '…never the kind of time off or notes');
  ok(feed.holidays.some(h => h.label === 'Staff training day' && h.source === 'custom'), '…and the office’s closures');
  // ---- moving from the old app (the made-up Sheet)
  await page.click('[data-act=nav][data-v=import]'); await page.waitForSelector('[data-act=imDemo]'); await collect();
  await page.click('[data-act=imDemo]'); await page.waitForSelector('.imPerson'); await page.waitForTimeout(200); await collect(); await shot('owner-import', true);
  const rows = await E(() => S.imp.rows.map(r => ({ n: r.p.name, sid: r.sid })));
  ok(JSON.stringify(rows.map(r => r.sid)) === JSON.stringify(['casey', 'drew', 'jordan', 'morgan', 'riley', 'taylor', 'sam', '']), 'every old name matched to its login (Pat Gone, no login: Don’t move): ' + rows.map(r => r.n + '→' + (r.sid || '–')).join(', '));
  ok(!(await page.$eval('#view', e => e.innerHTML)).includes('NOT-A-REAL'), 'no password or passcode anywhere on the screen');
  const iT = rows.findIndex(r => r.sid === 'taylor'), iM = rows.findIndex(r => r.sid === 'morgan'), iR = rows.findIndex(r => r.sid === 'riley'), iD = rows.findIndex(r => r.sid === 'drew'), iC = rows.findIndex(r => r.sid === 'casey');
  const shNotes = await page.$$eval('.imPerson', e => e.map(x => (x.querySelector('.imSh') || {}).textContent || '')), iJ = rows.findIndex(r => r.sid === 'jordan');
  ok(/Staff Hub: started Jun 1, 2010 \(the Sheet: Jun 3, 2010\) — the move uses Staff Hub’s/.test(shNotes[iJ]) && /Not linked to Staff Hub/.test(shNotes[iD]) && shNotes[iR] === '' && /Hired Jun 1, 2010/.test(await E(i => document.querySelectorAll('.imPerson')[i].textContent, iJ)),
    'the move uses Staff Hub’s dates: Jordan’s start date there isn’t the Sheet’s (said so); Drew isn’t linked to Staff Hub (the Sheet’s); Riley’s agree (nothing to say)');
  ok(/Handbook: −/.test(await E(i => document.querySelectorAll('.imPerson')[i].textContent, iT)), 'Taylor: the handbook gives less (Tier 2 too early, a week Mon–Fri, hours typed in)');
  ok(/Already has a record here/.test(await E(i => document.querySelectorAll('.imPerson')[i].textContent, iR)) && /Already has a record/.test(await E(i => document.querySelectorAll('.imPerson')[i].textContent, iC)) && !(await E(i => document.querySelectorAll('.imPerson')[i].querySelector('.imNums'), iR)), 'people with a record here already are skipped unless Replace is ticked');
  for (const i of [iR, iT, iM, iD]) { await page.check('[data-chg=imReplace][data-i="' + i + '"]'); await page.waitForTimeout(80); } // (Drew's record was made above)
  await page.click('.imPerson >> nth=' + iT + ' >> summary'); await page.waitForTimeout(100); await shot('owner-import-why', true);
  const why = await E(i => document.querySelectorAll('.imPerson')[i].querySelector('.imWhy').textContent, iT);
  ok(/higher tier/.test(why) && /counted differently/.test(why) && /More in the Sheet than its own log/.test(why), 'why: tiers, Fridays and partial days, and hours typed into the Sheet');
  await page.click('[data-act=imPick][data-i="' + iT + '"][data-k=hand]');
  await page.click('[data-act=imPick][data-i="' + iM + '"][data-k=typed]'); await page.fill('[data-inp=imTyped][data-i="' + iM + '"][data-b=vac]', '10'); await page.dispatchEvent('[data-inp=imTyped][data-i="' + iM + '"][data-b=vac]', 'input');
  await page.fill('[data-inp=imTyped][data-i="' + iM + '"][data-b=sick]', '0'); await page.dispatchEvent('[data-inp=imTyped][data-i="' + iM + '"][data-b=sick]', 'input');
  const recJSON = sid => E(sid => { const r = Object.assign({}, S.hrRecs.get(sid)); delete r.v; delete r.rev; delete r.updatedAt; return JSON.stringify(r); }, sid);
  const before = { casey: await recJSON('casey'), n: await E(() => allReqs().length) };
  const want = await E(() => { const r = k => S.imp.rows.find(x => x.sid === k); return { riley: r('riley').audit.old, taylor: r('taylor').audit.hand, drew: r('drew').audit.old, reqs: impReqCount(S.imp.rows.filter(x => x.sid && !x.off)) }; });
  await page.click('[data-act=imMove]'); await page.click('#cbYes');
  await page.waitForSelector('.prevGrid', { state: 'attached' }); await page.waitForFunction(() => S.imp && S.imp.st === 'done', null, { timeout: 30000 });
  await page.waitForTimeout(300); await collect(); await shot('owner-import-done');
  const res = await E(() => S.imp.result);
  ok(res.people === 4 && res.skipped === 3 && res.reqs === want.reqs && !res.failed.length, 'moved: 4 people (Casey, Jordan and Sam skipped — no Replace), ' + res.reqs + ' requests, nothing failed');
  const after = await E(() => { const o = k => (S.hrRecs.get(k) || {}).open || {}; return { riley: o('riley'), taylor: o('taylor'), morgan: o('morgan'), drew: o('drew'), n: allReqs().length, mt: S.hrRecs.get('morgan').type }; });
  after.casey = await recJSON('casey');
  ok(after.riley.vac === want.riley.vac && after.riley.sick === want.riley.sick && after.riley.asOf === await E(() => todayISO()), 'Riley starts from the old app’s balance (the default), as of today');
  ok(after.taylor.vac === want.taylor.vac && after.taylor.from.pick === 'hand', 'Taylor from the handbook’s');
  ok(after.morgan.vac === 10 && after.morgan.sick === 0 && after.mt === 'PT', 'Morgan from the numbers typed (and part-time)');
  ok(await E(() => ['riley', 'taylor', 'morgan'].every(s => (S.hrRecs.get(s).sh || {}).id === 'demo-' + s) && !S.hrRecs.get('drew').sh), '…Staff Hub’s start dates and full-/part-time for Riley, Taylor and Morgan (marked as Staff Hub’s); Drew’s from the Sheet');
  ok(after.n === before.n + res.reqs, 'the requests are here');
  const leg = await E(() => allReqs().filter(r => r.legacy).map(r => ({ id: r.id, sid: r.sid, st: r.status, ded: r.legacy.ded, took: r.legacy.took, ev: r.events.map(e => e.a).join() })));
  // Casey has no Replace: her record stays as it was, except that it now lists the moved requests the old app took off
  // (so a later Replace from the old app's balance doesn't take them off twice); her balance isn't touched
  const cAfter = JSON.parse(after.casey), cDed = leg.filter(r => r.sid === 'casey' && r.ded).map(r => r.id).sort(), cOld = (cAfter.oldDed || []).slice().sort();
  delete cAfter.oldDed;
  const caseyOK = JSON.stringify(cAfter) === before.casey && cDed.length > 0 && JSON.stringify(cOld) === JSON.stringify(cDed) && !cAfter.settled;
  ok(after.drew.vac === want.drew.vac && caseyOK, 'Drew moved; Casey left as she was (her record only lists what the old app took off: ' + cDed.length + ')' + (after.drew.vac === want.drew.vac && caseyOK ? '' : ' — ' + JSON.stringify([after.drew, want.drew, after.casey, before.casey, cDed])));
  const settledOf = sid => E(sid => (S.hrRecs.get(sid).settled || []).slice().sort(), sid);
  ok(JSON.stringify(await settledOf('riley')) === JSON.stringify(leg.filter(r => r.sid === 'riley' && r.ded).map(r => r.id).sort()) && (await settledOf('riley')).length === 4 && (await settledOf('taylor')).length === 0,
    'what the old app took off is listed in the HR record: Riley’s 4 (her balance is the old app’s), none for Taylor (the handbook’s counts them)');
  ok(leg.some(r => r.sid === 'riley' && r.st === 'pending') && leg.some(r => r.st === 'denied') && leg.some(r => r.st === 'cancelled'), 'statuses come over (one still waits for approval here)');
  ok(leg.every(r => /import$/.test(r.ev)), 'each says it was brought over from the old app');
  ok((await bal('riley')).vac === want.riley.vac, 'Riley’s balance today is exactly the old app’s');
  ok(!JSON.stringify(await E(() => [Array.from(DEMO.recs.values()), Array.from(DEMO.reqs.values())])).includes('NOT-A-REAL'), 'no password or passcode saved anywhere');
  const blk = await E(() => S.blackouts.map(b => b.label)), clo = await E(() => Array.from(S.closed.custom.keys()));
  ok(blk.includes('Holiday rush') && clo.some(d => /-12-24$/.test(d)), 'the Sheet’s own blackout and closure came over');
  // again: nothing twice
  await page.click('[data-act=imReset]'); await page.click('[data-act=imDemo]'); await page.waitForSelector('.imPerson');
  const again = await E(() => impReqCount(S.imp.rows.filter(x => x.sid)));
  ok(again === 0, 'moving the same Sheet again: no request would move twice');
  await page.click('[data-act=imMove]'); await page.click('#cbYes'); await page.waitForFunction(() => S.imp && S.imp.st === 'done', null, { timeout: 30000 });
  const res2 = await E(() => S.imp.result);
  ok(res2.people === 0 && res2.reqs === 0 && res2.skipped === 7, '…and nobody is replaced without Replace');
  ok((await E(() => allReqs().length)) === after.n, '…the requests are as they were');
  await nav('team'); await page.click('[data-act=tab][data-t=people]'); await page.click('#view tr[data-sid=riley]'); await page.waitForSelector('#drawer');
  ok(/From the old Time-Off app/.test(await page.textContent('#drawer')), 'Riley’s opening balance says where it came from');
  await page.keyboard.press('Escape');
  await page.click('#view tr[data-sid=taylor]'); await page.waitForSelector('#drawer');
  const tLeg = await E(() => allReqs().find(r => r.sid === 'taylor' && r.legacy && r.legacy.ded && r.part === 'h2'));
  await page.click('#drawer .reqRow[data-id="' + tLeg.id + '"]'); await page.waitForSelector('#reqHist'); await page.waitForTimeout(250);
  const tl = await page.textContent('#drawer');
  ok(/Old Time-Off app request/.test(tl) && /brought it over from the old app/.test(tl), 'a moved request shows its old id and that it was brought over');
  await page.keyboard.press('Escape');
  await lock();

  /* =================== Jordan (approves) =================== */
  console.log('# Jordan (approves)');
  await signIn('approver', page, true); await collect(); await shot('approver-home', true);
  ok(!(await page.$('#side [data-v=settings]')) && await page.$('#side [data-v=appr]') && await page.$('#side [data-v=team]'), 'Approvals and Team, no Settings');
  await nav('appr');
  const own = await reqOf('jordan', 'pending');
  ok(/Your own request — Dr. A decides it/.test(await page.textContent('.apCard:has([data-id="' + own.id + '"])')) && !(await page.$('[data-act=approve][data-id="' + own.id + '"]')), 'their own request: “Dr. A decides it”, no Approve');
  const self = await E(id => B.saveReq(id, () => ({ status: 'approved' }), { a: 'approve' }).then(() => 'saved', e => e.code), own.id);
  ok(self === 'permission-denied', 'and approving it anyway is refused (as the database refuses it)');
  await nav('team'); await page.click('#view tr[data-sid=riley]'); await page.waitForSelector('#drawer');
  ok(!(await page.$('#drawer [data-act=editHR]')) && !(await page.$('#drawer [data-act=addAdj]')), 'sees Riley’s balance and statement, but only Dr. A changes HR records');
  await page.keyboard.press('Escape');
  const hrW = await E(() => B.putHR('riley', d => { d.hire = '2000-01-01'; }, 'edit').then(() => 'saved', e => e.code));
  ok(hrW === 'permission-denied', '…and saving one anyway is refused');
  const ownOld = await reqOf('jordan', 'approved', 'bereave');
  const moved = await E(id => B.saveReq(id, c => { c.start = addDays(c.start, 7); c.end = addDays(c.end, 7); }, { a: 'rekey' }).then(() => 'saved', e => e.code), ownOld.id);
  const undone = await E(id => B.saveReq(id, () => ({ status: 'archived' }), { a: 'takeback' }).then(() => 'saved', e => e.code), ownOld.id);
  ok(moved === 'permission-denied' && undone === 'permission-denied', 'their own approved time off can’t be changed or taken back by them');
  // scrubs
  await nav('appr');
  const tP = await E(() => allPerks().find(x => x.sid === 'taylor' && x.status === 'pending'));
  const tCard = await page.$eval('.apCard:has([data-act=approvePerk][data-id="' + tP.id + '"])', e => e.textContent);
  ok(/2 pairs/.test(tCard) && /Still wearing the one set/.test(tCard) && /2 of 2 pairs/.test(tCard), 'Taylor’s scrubs: 2 pairs, the reason, 2 of 2 this year with it');
  const ownCard = (await page.$$eval('.apCard', cs => cs.map(c => c.textContent))).find(x => /My top faded/.test(x)) || '';
  ok(/Your own request — Dr. A decides it/.test(ownCard), 'their own scrubs: “Dr. A decides it”');
  const jP = await E(() => allPerks().find(x => x.sid === 'jordan' && x.status === 'pending'));
  ok((await E(id => B.savePerk(id, () => ({ status: 'approved' }), { a: 'approve' }).then(() => 'saved', e => e.code), jP.id)) === 'permission-denied', '…and approving it anyway is refused');
  ok(/Teal · top and bottom · S · petite/.test(tCard) && /Black · top and bottom · S · petite/.test(tCard), '…each pair: color, top and bottom, size, petite');
  const ob0 = await E(() => DEMO.outbox.length);
  await page.click('[data-act=approvePerk][data-id="' + tP.id + '"]'); ok(await toastHas(/Approved — Taylor sees it now, and the order is on its way/), 'approves Taylor’s scrubs — the order is emailed'); await settle();
  const om = await E(() => DEMO.outbox[DEMO.outbox.length - 1]);
  ok((await E(() => DEMO.outbox.length)) === ob0 + 1 && om.kind === 'scrubs' && om.to === 'community@thenextlevelorthodontics.com' && /Pair 1: Teal · top and bottom · S · petite/.test(om.text) && !/Still wearing/.test(om.text + om.subject),
    '…to community@thenextlevelorthodontics.com: who and each pair, never the reason');
  ok((await E(id => S.perks.get(id).status, tP.id)) === 'approved', '…approved');
  await lock();

  /* =================== Riley (staff) =================== */
  console.log('# Riley (staff)');
  await signIn('staff', page, true); await collect(); await shot('staff-home', true);
  ok(!(await page.$('#side [data-v=appr]')) && !(await page.$('#side [data-v=team]')) && !(await page.$('#side [data-v=settings]')), 'no Approvals, Team or Settings');
  ok(await page.$$eval('.balCard', c => c.length) === 3 && /Silver/.test(await page.textContent('.balCard.vac')), 'Home: vacation (Silver — 2 to 5 years), sick leave, days off this year');
  ok((await E(() => allReqs().every(r => r.sid === 'riley'))), 'she has only her own requests');
  await nav('mine'); await page.click('[data-act=tab][data-t=stmt]'); await page.waitForTimeout(150); await collect(); await shot('staff-statement', true);
  const stTxt = await page.textContent('#view');
  ok(/Opening balance/.test(stTxt) && /From the old Time-Off app/.test(stTxt), 'Statement: from the opening balance the move set' + (/From the old Time-Off app/.test(stTxt) ? '' : ' — ' + stTxt.slice(0, 400)));
  await page.click('[data-act=tab][data-t=req]');
  // a blackout
  await nav('new');
  const jan = await E(() => { const y = Number(todayISO().slice(0, 4)) + 1; return nextOfficeDay(y + '-01-12', S.closed); });
  await page.click('[data-act=fType][data-k=vac]'); await page.fill('#fStart', jan); await page.dispatchEvent('#fStart', 'input'); await page.waitForTimeout(150);
  ok(/January is a blackout period for vacation/.test(await page.textContent('#fSum')) && await page.$eval('[data-act=fSend]', b => b.disabled), 'January: “a blackout period for vacation”, and it can’t be sent');
  await page.click('[data-act=fType][data-k=sick]'); await page.waitForTimeout(100);
  const skTxt = await page.textContent('#fSum'), skMax = await page.$eval('#fStart', e => e.max);
  ok(!/blackout/.test(skTxt) && /can’t be asked for ahead of time/.test(skTxt) && await page.$eval('[data-act=fSend]', b => b.disabled) && skMax === await E(() => todayISO()),
    'sick leave isn’t blacked out — but next January hasn’t come yet, so it can’t be sent (the date picker stops at today)');
  const pastDay = await E(() => { let d = addDays(todayISO(), -1); for (let i = 0; i < 10 && !isOfficeDay(d, S.closed); i++) d = addDays(d, -1); return d; });
  await page.fill('#fStart', pastDay); await page.fill('#fEnd', pastDay); await page.dispatchEvent('#fEnd', 'input'); await page.waitForTimeout(150);
  ok(!/ahead of time/.test(await page.textContent('#fSum')) && !(await page.$eval('[data-act=fSend]', b => b.disabled)), '…a sick day already past can');
  await page.click('[data-act=fType][data-k=bereave]'); await page.waitForTimeout(100);
  ok(/Paid — bereavement for someone in the immediate family is paid/.test(await page.textContent('#fPaidBox')) && !(await page.$('#fPaidBox [data-act=fPaid]')) && /Paid · up to 3 days/.test(await page.textContent('[data-act=fType][data-k=bereave]')), 'bereavement: paid (immediate family), no paid/unpaid choice');
  await page.click('[data-act=fType][data-k=vac]'); await page.waitForTimeout(100);
  ok(!!(await page.$('#fPaidBox [data-act=fPaid]')), '…vacation has the paid/unpaid choice again');
  // send one, change it, cancel it
  const d1 = await E(() => nextOfficeDay(addDays(todayISO(), 9), S.closed));
  await page.click('[data-act=fType][data-k=medical]'); await page.fill('#fStart', d1); await page.fill('#fEnd', d1); await page.dispatchEvent('#fEnd', 'input');
  await page.click('[data-act=fPart][data-k=h2]'); await page.fill('#fNote', 'Dentist'); await page.dispatchEvent('#fNote', 'input'); await page.waitForTimeout(150); await collect(); await shot('staff-form');
  ok(/2 h/.test(await page.textContent('#fSum .sumBig')) && /From vacation/.test(await page.textContent('#fSum')), 'a 2-hour appointment: 2 h from vacation');
  await page.click('[data-act=fSend]'); ok(await toastHas(/^Sent/), 'Sent');
  await settle();
  const mine = await E(d => allReqs().find(r => r.start === d && r.type === 'medical'), d1);
  ok(mine && mine.status === 'pending' && mine.note === 'Dentist' && mine.part === 'h2', '…waiting for approval, with her note');
  await page.click('.reqRow[data-id="' + mine.id + '"]'); await page.waitForSelector('#drawer [data-act=editReq]'); await collect();
  await page.click('#drawer [data-act=editReq]'); await page.waitForSelector('#fSum');
  await page.click('[data-act=fPart][data-k=am]'); await page.click('[data-act=fSend]'); ok(await toastHas(/Changed — it still waits/), 'changed: a morning instead');
  await settle();
  ok((await E(id => S.reqs.get(id).part, mine.id)) === 'am', '…saved');
  await page.click('.reqRow[data-id="' + mine.id + '"]'); await page.waitForSelector('#drawer [data-act=cancelReq]');
  await page.click('#drawer [data-act=cancelReq]'); await page.click('#cbYes'); ok(await toastHas(/Cancelled/), 'and cancelled');
  await settle();
  ok((await E(id => S.reqs.get(id).status, mine.id)) === 'cancelled', '…cancelled');
  // approved time off that hasn't started can be cancelled (the front desk is told)
  const appr = await E(() => allReqs().find(r => r.status === 'approved' && r.start > todayISO()));
  const o1 = await E(() => DEMO.outbox.length);
  await page.click('[data-act=nav][data-v=mine]'); await page.click('.reqRow[data-id="' + appr.id + '"]'); await page.waitForSelector('#drawer [data-act=cancelReq]');
  await page.click('#drawer [data-act=cancelReq]'); await page.click('#cbYes'); ok(await toastHas(/Cancelled/), 'approved time off that hasn’t started: cancelled');
  await settle();
  const m2 = await E(() => DEMO.outbox[DEMO.outbox.length - 1]);
  ok((await E(() => DEMO.outbox.length)) === o1 + 1 && /no longer needed/.test(m2.subject), '…the front desk is told the block isn’t needed');
  const stf = await E(id => B.saveReq(id, () => ({ status: 'approved' }), { a: 'approve' }).then(() => 'saved', e => e.code), (await reqOf('riley', 'pending')).id);
  ok(stf === 'permission-denied', 'staff can’t approve (refused as the database refuses it)');
  await nav('out'); await page.waitForTimeout(150);
  const chips = await page.$$eval('.outChip', c => c.map(x => x.textContent).join(' '));
  ok(chips.length > 0 && !/Vacation|Sick|Medical|Personal|Bereave/.test(chips), 'Who’s out: names and morning/afternoon, never why');
  await nav('ben'); await collect(); await shot('staff-benefits');
  ok(/Celebrate Primary Care/.test(await page.textContent('#view')) && /401\(k\)/.test(await page.textContent('#view')), 'My benefits: time off, Celebrate Primary Care, 401(k)');
  const hds = await page.$$eval('#view .cardHd', hs => hs.map(h => h.textContent)), hd = re => hds.find(x => re.test(x)) || '';
  ok(/Enrolled/.test(hd(/Celebrate/)) && !/Not enrolled/.test(hd(/Celebrate/)) && /Not enrolled/.test(hd(/401/)), 'enrolled in Celebrate Primary Care (a check), not in the 401(k)');
  const bnT = await page.textContent('#view');
  ok(/Eligible after 1 year of employment/.test(bnT) && /Yes — since Mar 13, 2024/.test(bnT) && /To enroll, talk to/.test(bnT) && /100% of the first 4%/.test(bnT), '401(k): eligible after a year (since Mar 13, 2024), how to enroll, the 4% match');
  ok(/1 pair left in \d{4}/.test(bnT) && /The knee tore/.test(bnT), 'Scrubs: 1 of the 2 pairs left (one approved earlier this year)');
  await page.click('[data-act=askScrubs]'); await page.waitForSelector('#skWhy');
  ok(await page.$$eval('[data-pairs]', b => b.length) === 0 && /1 pair left/.test(await page.textContent('.modal')) && await page.$$eval('#skItems .skItem', b => b.length) === 1, 'asking: 1 pair left, so one pair to describe (no “how many”)');
  ok(await page.$$eval('#skItems [data-sk=color]', b => b.map(x => x.textContent).join()) === 'Navy,Gray,Teal,Black' && await page.$$eval('#skItems [data-sk=piece]', b => b.map(x => x.textContent).join()) === 'Top and bottom,Top,Bottom' && !!(await page.$('#skItems [data-sk=petite]')),
    'the form: navy, gray, teal or black; top and bottom, top or bottom; about what size; petite');
  await page.click('#skSend'); ok(await toastHas(/Pick a color and a size/), '…a color and a size are needed');
  await page.click('#skItems [data-sk=color][data-v=navy]'); await page.click('#skItems [data-sk=piece][data-v=top]'); await page.selectOption('#skSize0', 'M'); await page.check('#skItems [data-sk=petite]');
  await page.click('#skSend'); ok(await toastHas(/Say why/), '…and a reason');
  await page.fill('#skWhy', 'Bleach spot on the top'); await page.click('#skSend');
  ok(await toastHas(/Sent — it waits for approval/), 'Sent'); await settle();
  const bnT2 = await page.textContent('#view');
  ok(/All asked for in \d{4}/.test(bnT2) && !(await page.$('[data-act=askScrubs]')) && /Bleach spot/.test(bnT2) && /Navy · top · M · petite/.test(bnT2), '…saved as navy, top, M, petite; the year’s pairs are all asked for: no more asking');
  ok(/Ask by December 15/.test(bnT2), 'the card says to ask by December 15');
  await nav('account'); await collect();
  ok(/Change password/.test(await page.textContent('#view')), 'My account: change password (the NLO Cases one)');

  /* =================== Dr. A again: an order that can't be emailed =================== */
  console.log('# Dr. A again: an order that can’t be emailed');
  await lock(); await signIn('', page, true);
  const rP = await E(() => { const x = allPerks().find(p => p.sid === 'riley' && p.status === 'pending'); return x ? x.id : null; });
  await E(() => { DEMO.toMail = ''; });
  await nav('appr'); await page.waitForSelector('[data-act=approvePerk][data-id="' + rP + '"]');
  await page.click('[data-act=approvePerk][data-id="' + rP + '"]');
  ok(await toastHas(/couldn’t be emailed \(Settings → Scrubs says why\), so order these by hand/), 'the order can’t be emailed: approved, and it says to order these by hand'); await settle();
  ok((await E(id => S.perks.get(id).status + '/' + S.perks.get(id).decision.mailed, rP)) === 'approved/false', '…and the request keeps that it wasn’t emailed');
  await nav('ben'); await page.selectOption('#benAs', 'riley'); await page.waitForTimeout(200);
  ok(/Not emailed — order these by hand/.test(await page.textContent('#view')), '…which Riley’s scrubs show the people who approve (not just for a moment)');
  await page.selectOption('#benAs', 'taylor'); await page.waitForTimeout(200);
  ok(/Order emailed/.test(await page.textContent('#view')) && !/order these by hand/.test(await page.textContent('#view')), '…and Taylor’s, approved earlier, show the order was emailed');
  await E(() => { DEMO.toMail = SCRUBS.to; });

  /* ---- changing an opening balance asks first, then saves (the question replaces the form: what it said is kept) ---- */
  console.log('# Dr. A: an opening balance changed, and salary');
  await nav('team'); await page.click('[data-act=tab][data-t=people]'); await page.click('#view tr[data-sid=taylor]'); await page.waitForSelector('#drawer [data-act=editHR]');
  const tOpen = await E(() => JSON.parse(JSON.stringify(S.hrRecs.get('taylor').open || null)));
  await page.click('#drawer [data-act=editHR]'); await page.waitForSelector('#hrVac');
  await page.fill('#hrAsOf', tOpen ? tOpen.asOf : await E(() => addDays(todayISO(), -1))); await page.fill('#hrVac', String(Math.round(((tOpen ? tOpen.vac : 0) + 1) * 100) / 100)); await page.fill('#hrSick', String(tOpen ? tOpen.sick : 0));
  await page.check('#hrCel'); await page.click('#hrSave'); await page.waitForSelector('#cbYes');
  ok(/Change Taylor’s balance\?/.test(await page.textContent('#modalWrap')), 'a different opening balance asks first');
  await page.click('#cbYes'); await settle();
  const tAfter = await E(() => S.hrRecs.get('taylor'));
  ok(tAfter.open && Math.abs(tAfter.open.vac - ((tOpen ? tOpen.vac : 0) + 1)) < 0.011 && tAfter.ben && tAfter.ben.celebrate === true, '…and once you say so, it’s saved with what the form said (vacation +1 h, Celebrate ticked)');
  await page.click('#drawer [data-act=closeDrawer]').catch(() => { });

  /* ---- salary: no balance (Drew isn't on Staff Hub, so it's set here) ---- */
  await page.click('#view tr[data-sid=drew]'); await page.waitForSelector('#drawer [data-act=editHR]');
  const drewBefore = await bal('drew'), dh = await E(b => [hrs(b.vac), hrs(b.sick)], drewBefore);
  await page.click('#drawer [data-act=editHR]'); await page.waitForSelector('#hrType');
  ok(await page.$$eval('#hrType option', o => o.map(x => x.value).join()) === 'FT,PT,SAL', 'the HR record offers Full-time, Part-time and Salary');
  await page.selectOption('#hrType', 'SAL'); await page.click('#hrSave'); await page.waitForSelector('#cbYes'); await collect();
  ok(/Put Drew \(demo\) on salary\?/.test(await page.textContent('#modalWrap')) && (await page.textContent('#modalWrap')).includes(dh[0] + ' h vacation and ' + dh[1] + ' h sick leave close, not paid out'), 'putting Drew on salary says what closes: ' + (await page.textContent('#modalWrap')).slice(0, 160));
  await page.click('#cbYes'); await settle();
  ok(await E(() => S.hrRecs.get('drew').type) === 'SAL', '…and his record is salary');
  const teamTxt = await page.textContent('#view');
  ok(!(await page.$('#view tr[data-sid=drew]')) && /On salary, so no balance: Drew \(demo\)/.test(teamTxt), 'Team: Drew isn’t in the balances table; a line under it says he’s on salary');
  await page.click('#drawer [data-act=closeDrawer]'); await page.waitForTimeout(250);
  await page.click('#view .salLine [data-act=openPerson][data-sid=drew]'); await page.waitForSelector('#drawer .balEmpty');
  const dTxt = await page.textContent('#drawer');
  const kv = await page.$$eval('#drawer .kvRow', r => r.map(x => x.textContent.trim()));
  ok(/On salary/.test(dTxt) && kv.some(x => /^Employment\s*Salary/.test(x)) && !(await page.$('#drawer [data-act=addAdj]')) && !kv.some(x => /^Opening balance/.test(x)), 'his panel: “On salary”, no balance, no adjustments, no opening balance' + ' — ' + kv.join(' | ').slice(0, 200));
  ok(/On salary from today — no balance from here on/.test(dTxt), '…and his statement says from when, and what closed');
  await shot('owner-salary-drawer');
  ok(await E(() => ledgerOf('drew', addDays(todayISO(), 1)).vac === 0 && nextAccrual(S.hrRecs.get('drew'), S.pol, todayISO()) === null), '…and from tomorrow there’s no balance and nothing to earn');
  await page.click('#drawer [data-act=closeDrawer]');
  await page.click('[data-act=tab][data-t=pay]'); await page.waitForTimeout(150);
  ok(!/Drew/.test(await page.textContent('#view')), 'payroll: Drew isn’t listed');
  await page.click('[data-act=tab][data-t=year]'); await page.waitForTimeout(150);
  ok(!/Drew/.test(await page.textContent('#view')), 'year end: nothing to pay Drew');
  await page.click('[data-act=tab][data-t=people]'); await page.waitForTimeout(100);
  await lock();

  /* =================== phone =================== */
  console.log('# Phone');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/New_York' });
  await routes(mctx);
  const mp = await mctx.newPage(); watch(mp, errs, 'phone');
  for (const as of ['', 'approver', 'staff']) {
    await signIn(as, mp);
    const views = await mp.evaluate(() => navList().map(x => x[0]).concat(isOwner() ? ['settings', 'import'] : []).concat(['account']));
    const wide = [];
    for (const v of views) {
      await mp.evaluate(v => { S.view = v; renderNav(); renderView(); window.scrollTo(0, 0); }, v); await mp.waitForTimeout(200);
      const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (over > 0) wide.push(v + ' +' + over + 'px');
      if (v === 'home' || v === 'out' || v === 'appr') await mp.screenshot({ path: path.join(SHOTS, 'phone-' + (as || 'owner') + '-' + v + '.png'), fullPage: true });
    }
    ok(!wide.length, 'phone, ' + (as || 'Dr. A') + ': ' + views.length + ' screens, none wider than the screen' + (wide.length ? ' — ' + wide.join(', ') : ''));
  }
  await mp.evaluate(() => { S.view = 'mine'; renderView(); }); await mp.waitForTimeout(150);
  await mp.click('.reqRow'); await mp.waitForSelector('#drawer');
  ok(await mp.evaluate(() => document.querySelector('#drawer').getBoundingClientRect().width <= window.innerWidth), 'phone: a request opens full width');
  await mp.screenshot({ path: path.join(SHOTS, 'phone-staff-request.png') });

  // every button that was on a screen has something it does
  const missing = await page.evaluate(a => a.filter(x => typeof ACT[x] !== 'function'), Array.from(acts));
  ok(!missing.length, 'every one of the ' + acts.size + ' kinds of button has a handler' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));
  ok(!errs.length, 'no page errors' + (errs.length ? ':\n    ' + errs.join('\n    ') : ''));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
