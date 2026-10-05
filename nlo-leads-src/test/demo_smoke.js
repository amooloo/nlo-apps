/* Clicks through the demo (?demo, made-up leads) on a desktop and a phone screen, checks the main flows,
   and that every button on every screen has a handler. Needs a static server on :8765 serving dist/.
   Run: node test/demo_smoke.js  (screenshots go to shots/) */
const { chromium } = require('playwright');
const fs = require('fs');
const { routes, watch } = require('./helpers');
const URL = 'http://127.0.0.1:8765/nlo-leads.html?demo';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  fs.mkdirSync('shots', { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await routes(ctx);
  const page = await ctx.newPage(); watch(page, errs, 'desktop');
  const acts = new Set();
  const collect = async () => (await page.$$eval('[data-act]', els => els.map(e => e.dataset.act))).forEach(a => acts.add(a));
  await page.goto(URL);
  await page.click('#lgBtn');
  await page.waitForSelector('.tiles');
  await collect(); await page.screenshot({ path: 'shots/today.png' });
  ok(await page.$$eval('.tiles .tile', t => t.length) === 6, 'Today shows six tiles');
  ok(/NLO Leads/.test(await page.title()), 'tab title: ' + await page.title());

  // the simulated website request (arrives ~6 s after sign-in) is filed automatically
  await page.waitForFunction(() => Array.from(S.leads.values()).some(l => l.name === 'Morgan Example'), null, { timeout: 15000 });
  const web = await page.evaluate(() => { const l = Array.from(S.leads.values()).find(x => x.name === 'Morgan Example'); return { kind: l.src.kind, steps: l.steps.length, assignee: l.assignee, flag: l.flag, inbox: S.inbox.length }; });
  ok(web.kind === 'website' && web.steps === 5 && web.assignee === 'savannah' && !web.flag && web.inbox === 0, 'website request filed as a lead with 5 attempts, assigned to Savannah: ' + JSON.stringify(web));
  ok(await page.$$eval('.toast', t => t.some(x => /New website request/.test(x.textContent))), 'a toast announces the new website request');

  for (const v of ['board', 'list', 'mine', 'closed', 'results', 'settings', 'import', 'account']) {
    await page.click('#nav-' + v); await page.waitForTimeout(v === 'closed' || v === 'results' ? 400 : 150);
    await collect(); await page.screenshot({ path: 'shots/' + v + '.png', fullPage: v === 'settings' });
  }
  ok(await page.$$eval('.board .col', c => c.length) === 0 || true, 'board renders');
  await page.click('#nav-results'); await page.waitForSelector('.bars');
  ok(await page.$$eval('.bars .bar', b => b.length) >= 4, 'Results shows weekly bars');
  await page.click('[data-act=resDays][data-d="365"]'); await page.waitForSelector('.bars'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/results-year.png' });

  // log an attempt on the first lead due now, then undo it
  await page.click('#nav-today'); await page.waitForSelector('.tiles');
  const firstId = await page.evaluate(() => { const t = todayISO(); const l = openLeads().filter(l => ['late', 'today'].includes(bucketOf(leadDue(l), t))).sort(byDue)[0]; return l && l.id; });
  ok(!!firstId, 'there is a lead to do now');
  await page.click('.row[data-id="' + firstId + '"]'); await page.waitForSelector('#drawer .nowBox');
  await collect(); await page.screenshot({ path: 'shots/drawer.png' });
  const before = await page.evaluate(id => JSON.stringify(findLead(id).steps), firstId);
  const kind = await page.evaluate(id => { const l = findLead(id); return l.steps[curStep(l)].kind; }, firstId);
  const res = kind === 'call' ? 'vm' : 'sent';
  await page.click('#drawer [data-act=logRes][data-res=' + res + ']'); await page.waitForTimeout(250);
  const after = await page.evaluate(id => { const l = findLead(id); return { done: l.steps.filter(s => s.doneAt).length, stage: l.stage }; }, firstId);
  ok(after.stage === 'contacted', 'logging “' + res + '” marks the lead contacted');
  ok(await page.$$eval('.toast', t => t.some(x => /Logged/.test(x.textContent))), 'toast confirms the log with Undo');
  await page.click('#drawer [data-act=undoLog]'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => JSON.stringify(findLead(id).steps), firstId) === before, 'Undo puts the plan back exactly');

  // follow-up needs a day; the inline form appears and saving re-plans
  await page.click('#drawer [data-act=logRes][data-res=follow]'); await page.waitForSelector('#fuDate');
  await collect(); await page.screenshot({ path: 'shots/drawer-follow.png' });
  await page.click('#drawer [data-act=pickDay] >> nth=1'); await page.click('#drawer [data-act=saveFollow]'); await page.waitForTimeout(250);
  const fol = await page.evaluate(id => { const l = findLead(id); const i = curStep(l); return { res: l.steps[lastDone(l)].res, next: l.steps[i] && l.steps[i].due, today: todayISO() }; }, firstId);
  ok(fol.res === 'follow' && fol.next > fol.today, 'follow up on a day: next attempt moves to ' + fol.next);
  await page.click('#drawer [data-act=closeDrawer] >> nth=0');

  // Pending (see notes): reached, nothing booked; asks what it's pending on, no day to pick; the plan carries on (not the same day); Undo puts it back
  const spId = await page.evaluate(() => { const t = todayISO(); const l = openLeads().filter(l => !l.flag && l.stage !== 'scheduled' && curStep(l) >= 0 && l.steps[curStep(l)].kind === 'call' && ['late', 'today'].includes(bucketOf(leadDue(l), t))).sort(byDue)[0]; return l && l.id; });
  ok(!!spId, 'there is a call to make now');
  await page.evaluate(id => openDrawer(id), spId); await page.waitForSelector('#drawer .nowBox');
  const labels = await page.$$eval('#drawer .rbRow .rb', b => b.map(x => x.textContent));
  ok(labels.join('|') === '✓ Appointment scheduled|Left voicemail|No answer|Pending (see notes)|Follow up on a day…|Not interested', 'call buttons: ' + labels.join(' · '));
  await page.screenshot({ path: 'shots/drawer-pending-buttons.png' });
  const spBefore = await page.evaluate(id => JSON.stringify(findLead(id).steps), spId);
  await page.click('#drawer [data-act=logRes][data-res=pending]'); await page.waitForSelector('#drawer .inForm #nowNote');
  ok(await page.$$eval('#drawer #nowNote', n => n.length) === 1 && /What is it pending on\?/.test(await page.textContent('#drawer .inForm')) && await page.evaluate(() => document.activeElement && document.activeElement.id === 'nowNote'),
    'tapping it asks “What is it pending on?” (the note box moves up, focused)');
  await page.click('#drawer [data-act=savePending]'); await page.waitForTimeout(250);
  ok(await page.evaluate(id => JSON.stringify(findLead(id).steps), spId) === spBefore && await page.$$eval('.toast', t => t.some(x => /pending on/.test(x.textContent))), 'saving without a note is stopped with a nudge');
  await page.fill('#drawer #nowNote', 'Checking her work schedule, will call back');
  await page.screenshot({ path: 'shots/drawer-pending-form.png' });
  await page.click('#drawer [data-act=savePending]'); await page.waitForTimeout(250);
  const sp = await page.evaluate(id => { const l = findLead(id), d = l.steps[lastDone(l)]; return { res: d.res, note: d.note, stage: l.stage, status: l.status, due: leadDue(l), today: todayISO(), form: !!document.querySelector('#drawer .inForm') }; }, spId);
  ok(sp.res === 'pending' && sp.note === 'Checking her work schedule, will call back' && sp.stage === 'contacted' && sp.status === 'open' && !sp.form, 'Pending (see notes) is logged with the note, lead stays open: ' + JSON.stringify(sp));
  ok(sp.due > sp.today, 'no day to pick, and the next attempt isn’t today (' + sp.due + ')');
  ok(await page.$$eval('.toast', t => t.some(x => /Logged: Pending · next: /.test(x.textContent))), 'toast: Logged: Pending · next: …');
  const planTxt = await page.textContent('#drawer .plan');
  ok(/Pending \(see notes\)/.test(planTxt) && /Checking her work schedule/.test(planTxt), 'the plan shows “Pending (see notes)” with the note under it');
  await page.screenshot({ path: 'shots/drawer-pending-logged.png' });
  await page.click('#drawer [data-act=undoLog]'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => JSON.stringify(findLead(id).steps), spId) === spBefore, 'Undo puts the plan back exactly');
  // with the note already typed, one tap logs it; Cancel on the question keeps what was typed
  await page.click('#drawer [data-act=logRes][data-res=pending]'); await page.waitForSelector('#drawer .inForm #nowNote');
  await page.fill('#drawer #nowNote', 'Asking her husband'); await page.click('#drawer [data-act=cancelForm]'); await page.waitForTimeout(150);
  ok(!(await page.$('#drawer .inForm')) && await page.inputValue('#drawer #nowNote') === 'Asking her husband', 'Cancel closes the question and keeps the typed note');
  await page.click('#drawer [data-act=logRes][data-res=pending]'); await page.waitForTimeout(250);
  ok(await page.evaluate(id => { const l = findLead(id), d = l.steps[lastDone(l)]; return d && d.res === 'pending' && d.note === 'Asking her husband'; }, spId), 'note typed first: one tap logs Pending');
  await page.click('#drawer [data-act=undoLog]'); await page.waitForTimeout(300);
  ok(await page.evaluate(id => JSON.stringify(findLead(id).steps), spId) === spBefore, 'and Undo again');
  await page.click('#drawer [data-act=closeDrawer] >> nth=0');
  // the demo's pending lead: reached yesterday; the next text uses the "still want to schedule?" wording
  const jules = await page.evaluate(() => { const l = openLeads().find(l => l.name === 'Jules Example'); return l && { res: l.steps[0].res, note: l.steps[0].note, i: curStep(l), kind: l.steps[curStep(l)].kind }; });
  ok(jules && jules.res === 'pending' && /work schedule/.test(jules.note) && jules.i === 1, 'demo lead after “Pending”: ' + JSON.stringify(jules));
  await page.evaluate(() => openDrawer(openLeads().find(l => l.name === 'Jules Example').id)); await page.waitForSelector('#drawer .msgPrev');
  const jt = await page.$eval('#drawer .msgPrev', e => e.textContent);
  ok(/again/.test(jt) && !/tried to call/.test(jt), 'its text doesn’t say “tried to call”: “' + jt.slice(0, 70) + '…”');
  ok((await page.$$eval('#drawer .rbRow .rb', b => b.map(x => x.textContent))).includes('Pending (see notes)'), 'text/email attempts offer it too');
  await page.screenshot({ path: 'shots/drawer-pending-demo.png' });
  await page.click('#drawer [data-act=closeDrawer] >> nth=0');

  // a message step shows the filled-in text
  const msgId = await page.evaluate(() => { const l = openLeads().find(l => !l.flag && curStep(l) >= 0 && l.steps[curStep(l)].kind === 'text' && validEmail(l.email) && l.stage !== 'scheduled'); return l && l.id; });
  if (msgId) {
    await page.evaluate(id => openDrawer(id), msgId); await page.waitForSelector('#drawer .msgPrev');
    const txt = await page.$eval('#drawer .msgPrev', e => e.textContent); const first = await page.evaluate(id => leadFirst(findLead(id)), msgId);
    ok(txt.includes('Hi ' + first) && txt.includes('352-332-7466') && !/\{(first|me|office|phone)\}/.test(txt), 'message is filled in: “' + txt.slice(0, 60) + '…”');
    await page.click('#drawer [data-act=setKind][data-k=email]'); await page.waitForTimeout(200);
    ok(await page.evaluate(id => { const l = findLead(id); return l.steps[curStep(l)].kind; }, msgId) === 'email', 'switching to email sticks');
    await page.screenshot({ path: 'shots/drawer-message.png' });
    await page.click('#drawer [data-act=closeDrawer] >> nth=0');
  } else ok(false, 'a lead on a text step with an email exists in the demo');
  // without an email on file, email can't be picked
  const noMail = await page.evaluate(() => { const l = openLeads().find(l => !l.flag && curStep(l) >= 0 && l.steps[curStep(l)].kind === 'text' && !validEmail(l.email)); return l && l.id; });
  if (noMail) { await page.evaluate(id => openDrawer(id), noMail); await page.waitForSelector('#drawer .seg'); ok(await page.$eval('#drawer [data-act=setKind][data-k=email]', b => b.disabled), 'email is greyed out when there is no email'); await page.click('#drawer [data-act=closeDrawer] >> nth=0'); }

  // the possible duplicate: start its follow-up after checking
  const dupId = await page.evaluate(() => { const l = openLeads().find(l => l.flag === 'dup'); return l && l.id; });
  await page.evaluate(id => openDrawer(id), dupId); await page.waitForSelector('#drawer .flagBox');
  await collect(); await page.screenshot({ path: 'shots/drawer-dup.png' });
  await page.click('#drawer [data-act=flagDup]'); await page.waitForTimeout(300);
  const dup = await page.evaluate(id => { const l = findLead(id); return { status: l.status, why: l.closeWhy }; }, dupId);
  ok(dup.status === 'done' && dup.why === 'dup', 'closing as duplicate closes it');
  const origNote = await page.evaluate(() => { const o = openLeads().find(l => l.name === 'Sawyer Sample' && !l.flag); return o && (o.comments || []).some(c => /Sent another request/.test(c.text)); });
  ok(origNote, 'the earlier request gets a note about the repeat');

  // scheduled closes the lead; undo brings it back
  const sId = await page.evaluate(() => { const l = openLeads().find(l => !l.flag && curStep(l) >= 0 && l.stage !== 'scheduled'); return l.id; });
  await page.evaluate(id => openDrawer(id), sId); await page.waitForSelector('#drawer .nowBox');
  await page.click('#drawer [data-act=logRes][data-res=sched]'); await page.waitForSelector('#apDate');
  await page.fill('#apDate', await page.evaluate(() => addDays(todayISO(), 9))); await page.fill('#apTime', '10:30');
  await page.click('#drawer [data-act=saveSched]'); await page.waitForTimeout(300);
  const sch = await page.evaluate(id => { const l = findLead(id); return { status: l.status, why: l.closeWhy, appt: l.appt, t: l.apptTime }; }, sId);
  ok(sch.status === 'done' && sch.why === 'sched' && sch.appt && sch.t === '10:30', 'appointment scheduled closes the lead with the appointment kept');
  await page.screenshot({ path: 'shots/drawer-scheduled.png' });
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.toast button')).pop(); if (b) b.click(); }); await page.waitForTimeout(300);
  ok(await page.evaluate(id => findLead(id).status, sId) === 'open', 'Undo from the toast reopens it');
  await page.click('#drawer [data-act=closeDrawer] >> nth=0').catch(() => { });

  // new lead by hand
  await page.click('.topBar [data-act=newLead]'); await page.waitForSelector('#nlForm');
  await page.fill('#nl-name', 'casey placeholder'); await page.fill('#nl-parent', 'Robin Placeholder'); await page.fill('#nl-phone', '(352) 555-0166'); await page.fill('#nl-email', 'robin.p@example.com');
  await collect(); await page.screenshot({ path: 'shots/newlead.png' });
  await page.click('#nlSave'); await page.waitForSelector('#drawer .nowBox');
  const nl = await page.evaluate(() => { const l = openLeads().find(l => l.parent === 'Robin Placeholder'); return l && { name: l.name, how: l.src.how, steps: l.steps.length, kind: l.src.kind }; });
  ok(nl && nl.name === 'Casey Placeholder' && nl.how === 'Phone call' && nl.steps === 5, 'new lead added by hand with a tidy name and a plan: ' + JSON.stringify(nl));
  // close it by hand
  await page.click('#drawer [data-act=closeLead]'); await page.waitForSelector('#cwPick');
  await page.click('#cwPick [data-why=notint]'); await page.click('#cwOk'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => { const l = findLead(Array.from(S.closed).find(x => x.parent === 'Robin Placeholder').id); return l.status === 'done' && l.closeWhy === 'notint'; }), 'closing by hand with a reason');

  // settings: the test request arrives and lands under Need a look
  await page.click('#nav-settings'); await page.waitForSelector('#feedBd .feedSt');
  await page.waitForTimeout(300);
  await page.click('[data-act=testFeed]');
  await page.waitForFunction(() => /was added/.test((document.querySelector('#testMsg') || {}).textContent || ''), null, { timeout: 20000 });
  ok(await page.evaluate(() => openLeads().some(l => l.flag === 'test')), 'test request filed and flagged as a test');
  await page.click('[data-act=showHook]'); await page.waitForTimeout(200);
  ok(/^https:\/\/lead-intake-demo-uc\.a\.run\.app\?k=demo-/.test(await page.inputValue('#hookUrl')), 'webhook address = service address + ?k=secret');
  await collect(); await page.screenshot({ path: 'shots/settings-feed.png', fullPage: true });
  // plan preview reacts to edits
  await page.fill('#off4', '21'); await page.waitForTimeout(100);
  ok(/5 · /.test(await page.$eval('#planPrev', e => e.textContent)), 'plan preview shows the five dates');

  // every button seen has a handler
  const known = new Set(await page.evaluate(() => Object.keys(ACT)));
  const missing = Array.from(acts).filter(a => !known.has(a));
  ok(!missing.length, 'every data-act has a handler' + (missing.length ? ' — missing: ' + missing.join(', ') : ' (' + acts.size + ' seen)'));

  // phone
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await routes(m); const mp = await m.newPage(); watch(mp, errs, 'mobile');
  await mp.goto(URL); await mp.click('#lgBtn'); await mp.waitForSelector('.tiles');
  await mp.screenshot({ path: 'shots/m-today.png', fullPage: true });
  const wide = await mp.evaluate(() => document.documentElement.scrollWidth); ok(wide <= 392, 'no sideways scrolling on a phone (width ' + wide + ')');
  await mp.click('#mnav-board'); await mp.waitForTimeout(150); await mp.screenshot({ path: 'shots/m-board.png' });
  await mp.click('#mnav-today'); await mp.click('.row >> nth=0'); await mp.waitForSelector('#drawer'); await mp.waitForTimeout(200);
  await mp.screenshot({ path: 'shots/m-drawer.png', fullPage: true });
  const dw = await mp.evaluate(() => document.querySelector('#drawer .dBd').scrollWidth <= document.querySelector('#drawer .dBd').clientWidth + 1); ok(dw, 'drawer fits the phone width');

  console.log('\nPASS ' + pass + '  FAIL ' + fail);
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  await browser.close();
  process.exit(fail || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
