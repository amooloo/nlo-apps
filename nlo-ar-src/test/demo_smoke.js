/* Clicks through the demo (?demo, made-up accounts) on a desktop and a phone screen: every screen, the account panel
   (log, undo, promise, ask Dr. A, resolve, reopen, an account that's on the list again, the refund checklist), the collections
   ladder (steps due, a step for many accounts at once, Dr. A signing, a certified letter, Maintenance Hold, a broken arrangement,
   the write-off at the end, a new round for an account past due again), closing
   accounts cleared in Edge, importing a made-up Edge export, Settings (who can use A/R, the numbers), downloading a list,
   and that every button on every screen has a handler. Needs a static server on :8766 serving dist/.
   Run: node test/demo_smoke.js  (screenshots go to shots/) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { routes, watch, CHROME } = require('./helpers');
const URL = 'http://127.0.0.1:' + (process.env.PORT || 8766) + '/nlo-ar.html?demo';
const SHOTS = path.join(__dirname, '..', 'shots');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const shot = (p, n, full) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: !!full });
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await routes(ctx);
  const page = await ctx.newPage(); watch(page, errs, 'desktop');
  const acts = new Set();
  const collect = async () => (await page.$$eval('[data-act]', els => els.map(e => e.dataset.act))).forEach(a => acts.add(a));
  const S_ = f => page.evaluate(f);
  const itemOf = key => page.evaluate(k => { const it = itemFor(k); return it && JSON.parse(JSON.stringify(it)); }, key);
  const toastHas = re => page.$$eval('.toast', (t, src) => t.some(x => new RegExp(src).test(x.textContent)), re.source);
  const closeDrawer = () => page.keyboard.press('Escape');

  await page.goto(URL);
  // while the reports open, the lists never show the new report with no accounts (that would call every worked account "cleared")
  await page.evaluate(() => { window.__maxCleared = 0; const t = setInterval(() => { try { if (S.inApp && S.rep) window.__maxCleared = Math.max(window.__maxCleared, counts().cleared); } catch (e) { } }, 5); setTimeout(() => clearInterval(t), 8000); });
  await page.click('#lgBtn');
  await page.waitForSelector('.tiles .tile');
  await page.waitForTimeout(300);
  await collect(); await shot(page, 'today', true);
  const c0 = await S_(() => counts());
  ok(await page.$$eval('.tiles .tile', t => t.length) === 7, 'Today: seven tiles (follow-ups, collection steps, 91+, chase now, credits, waiting for Dr. A, cleared)');
  ok(c0.due === 2 && c0.late === 1 && c0.drA === 2 && c0.cleared === 1 && c0.lad > 20, 'counts: 2 follow-ups (1 late), 2 for Dr. A (a refund, a letter to sign), 1 cleared, ' + c0.lad + ' collection steps: ' + JSON.stringify(c0));
  ok((await page.title()) === '(' + (c0.due + c0.lad) + ') NLO A/R', 'tab title counts follow-ups and collection steps due: ' + await page.title());
  ok((await page.evaluate(() => window.__maxCleared)) === 1, 'while opening, “Cleared in Edge” never counts more than the 1 really cleared');
  ok(await page.$$eval('#view details.help summary', s => s.some(x => /newly 91\+/.test(x.textContent))), '“Since the last report” lists newly 91+ accounts');
  ok(await page.isVisible('[data-act=closeCleared]'), '“Cleared in Edge” offers to close them');
  // the goals (handbook §19): counts of accounts from the newest full report
  const k0 = await S_(() => kpis(S.rep, S.cfg));
  ok(await page.$$eval('.goals .goal', g => g.length) === 2 && k0.pt.n === 34 && k0.pt.of === 422 && k0.ins.n === 14 && k0.ins.of === 204 && k0.from === 1 && k0.win === 60, 'Today: two goal gauges — patient 34 of 422, insurance 14 of 204 (over 60 days): ' + JSON.stringify(k0));
  ok(await page.$eval('.goals .goal', e => /8\.1%/.test(e.textContent) && /18 to go/.test(e.textContent) && /goal ≤ 4%/.test(e.textContent) && e.classList.contains('far')), 'the patient gauge reads 8.1% against 4%, 18 to go, in red');
  // the weekly report (due Mondays): this week's is in, so no banner and no badge
  ok(!(await page.$('.staleBox.wk')) && await page.$eval('#nav-reports .cnt', e => e.classList.contains('hidden')), 'this week’s report is in: no banner on Today, no badge on Reports');
  // pretend it's later: the first day this week's report would be due, then 9 days on (late)
  const wk = await page.evaluate(() => {
    const real = todayISO, newest = newestWeekly(), look = () => { renderNav(); renderView(); const b = document.querySelector('#view .staleBox.wk'), c = document.querySelector('#nav-reports .cnt');
      return { cls: b ? b.className : '', txt: b ? b.textContent : '', badge: c.classList.contains('hidden') ? '' : c.textContent, red: c.classList.contains('red'), amber: c.classList.contains('amber') }; };
    let d = real(); for (let i = 0; i < 14 && reportDue(newest, d, S.cfg.dueDay).state !== 'today'; i++) d = addDays(d, 1);
    todayISO = () => d; const due = look(); todayISO = () => addDays(real(), 9); const late = look(); todayISO = real; const back = look(); return { due, late, back, d };
  });
  ok(/staleBox wk today/.test(wk.due.cls) && /due today/.test(wk.due.txt) && wk.due.badge === 'Due' && wk.due.amber, 'on its due day (' + wk.d + '): an amber “due today” banner and Due on Reports');
  ok(/staleBox wk late/.test(wk.late.cls) && /late — it was due Monday/.test(wk.late.txt) && wk.late.badge === 'Late' && wk.late.red, 'after it: a red “late” banner and Late on Reports — ' + wk.late.txt);
  ok(!wk.back.cls && !wk.back.badge, 'back to today: no banner');

  // ---- focus mode
  const fs0 = await page.textContent('.focusBar');
  ok(/Do these first:/.test(fs0) && /urgent/.test(fs0) && /about \d/.test(fs0), 'Today: the “Do these first” line — ' + fs0.replace(/Focus mode$/, '').trim());
  await page.click('[data-act=focusOn]'); await page.waitForSelector('.fList .frow');
  const fl = await page.$$eval('.fList .frow', r => r.map(x => ({ cls: x.className.replace('frow ', ''), kind: x.dataset.kind, why: x.querySelector('.fWhy').textContent })));
  ok(!(await page.$('.tiles')) && fl.length > 10 && fl[0].cls === 'urgent' && fl.findIndex(x => x.cls !== 'urgent') > 0 && fl.slice(fl.findIndex(x => x.cls !== 'urgent')).every(x => x.cls !== 'urgent'), 'Focus mode: only the list — ' + fl.filter(x => x.cls === 'urgent').length + ' urgent first, then ' + fl.filter(x => x.cls === 'today').length + ' for today');
  ok(fl.some(x => x.kind === 'tf' && /Summit Dental PPO’s filing limit/.test(x.why)) && fl.some(x => x.kind === 'cross'), 'urgent: insurance near its carrier’s filing limit, an account about to reach day 90 or 120');
  ok(fl[0].kind === 'ob' && /open it, text each family on it today/.test(fl[0].why), 'first: OrthoBanc’s failed-payment report (it came on the 5th, nobody has checked it)');
  const fk = await page.$eval('.fList .frow[data-act=open]', e => e.dataset.key);
  await page.click('.fList .frow[data-act=open]'); await page.waitForSelector('#drawer');
  ok(await S_(() => S.openKey) === fk, 'tapping a line opens that account');
  await page.click('#drawer [data-act=closeDrawer]');
  ok(await page.evaluate(() => localStorage.getItem('nloAR.focus') === '1' && !Object.keys(localStorage).some(k => /^nloAR\.focus/.test(k) && !/^nloDemo/.test(k))) !== null, 'focus mode is remembered on this computer');
  await page.click('[data-act=focusOff]'); await page.waitForSelector('.tiles');
  ok(true, 'Show everything: back to the usual Today');
  // ---- OrthoBanc's failed-payment report (handbook §14, day 0)
  const obT = await page.textContent('.staleBox.ob');
  ok(/OrthoBanc’s failed-payment report for/.test(obT) && await page.$eval('.staleBox.ob a', a => a.href === 'https://www.orthobanc.com/providers/reports.aspx' && a.target === '_blank'), 'Today: the OrthoBanc reminder, with the link to the report');
  await page.click('.staleBox.ob [data-act=obCheck]'); await page.waitForSelector('#obN');
  ok(/Checked before:/.test(await page.textContent('#modalWrap')), 'the form shows when it was checked before');
  await page.fill('#obN', '2.5'); await page.click('[data-act=obSave]'); await page.waitForTimeout(150);
  ok(await page.isVisible('#obN') || await toastHas(/whole number/), 'the count has to be a number');
  await page.fill('#obN', '2'); await page.fill('#obNote', 'Texted both families'); await page.click('[data-act=obSave]'); await page.waitForTimeout(400);
  ok(!(await page.$('.staleBox.ob')) && await S_(() => { const x = S.book.ob[S.book.ob.length - 1]; return x.n === 2 && x.by === meSid() && !obState(S.book, todayISO()).due; }), 'Checked it: saved (2 failed payments), and the reminder is gone until the next report');

  for (const v of ['pd', 'ins', 'cr', 'sum', 'reports', 'settings', 'account']) {
    await page.click('#nav-' + v); await page.waitForTimeout(v === 'settings' ? 500 : 200);
    await collect(); await shot(page, v, true);
  }
  await page.click('#nav-sum'); await page.waitForSelector('.goalsCard .gTrend');
  ok(await page.$$eval('.goalsCard .gTrend path.tl', p => p.length) === 2 && await page.$eval('.goalsCard .gTrend text.gt', e => e.textContent === '4%'), 'Summary: both rates week by week, with the 4% goal line');
  ok(await page.$eval('.goalsCard .gHow', e => /anything past due/.test(e.textContent) && /more than 60 days past due/.test(e.textContent)), 'Summary: how the goals are counted');

  // ---- trends and the weekly brief (Summary)
  const tr = await page.$eval('.trendsCard', e => ({ stats: e.querySelectorAll('.tStat').length, txt: e.textContent, people: e.querySelectorAll('.actTbl tbody tr').length }));
  ok(tr.stats === 6 && /got current/.test(tr.txt) && /slid to an older bucket/.test(tr.txt) && /Patient goal \(4%\)/.test(tr.txt) && /moving away from 4%|under 4% around|flat/.test(tr.txt), 'Summary → Trends: week over week, and the pace to each goal');
  ok(tr.people >= 2 && /Jamie/.test(tr.txt), 'who did what in the last 7 days (' + tr.people + ' people)');
  await page.click('[data-act=brief]'); await page.waitForSelector('.briefTxt', { timeout: 10000 });
  ok(await page.$eval('.briefTxt', e => e.querySelectorAll('ol li').length === 3 && e.querySelector('b') !== null), 'the brief comes back from AISA and shows as text with a numbered list');
  const askedQ = (ctx.aisaAsked || []).slice(-1)[0] || '', names = await S_(() => { const n = new Set(); S.accts.forEach(a => { n.add(a.patient); n.add(rpName(a)); }); S.items.forEach(it => { if (it.name) n.add(it.name); }); return Array.from(n).filter(x => x && x.length > 3); });
  ok(/Past due: \$/.test(askedQ) && /Goals \(handbook §19/.test(askedQ) && names.every(n => !askedQ.includes(n)), 'what goes to AISA: totals only — none of the ' + names.length + ' names on the page');
  // tabs on each list
  for (const [v, tabs] of [['pd', ['91', '31', '0', 'all', 'lad']], ['ins', ['investigate', 'nofile', 'monitor', 'all', 'partly', 'chase']], ['cr', ['pre', 'all', 'work']]]) {
    await page.click('#nav-' + v);
    for (const t of tabs) { await page.click('[data-act=tab][data-t="' + t + '"]'); await page.waitForTimeout(80); await collect(); }
  }
  await page.click('#nav-pd'); await page.click('[data-act=tab][data-t="91"]');
  ok(await page.$$eval('tr.cut70', r => r.length) === 1, '91+: the dashed line marks 70% of the money');
  const n91 = await page.$$eval('#view tbody tr', r => r.length);
  await page.fill('#q', 'Samplesen'); await page.waitForTimeout(150);
  const nq = await page.$$eval('#view tbody tr', r => r.length);
  ok(nq > 0 && nq < n91, 'search narrows the list (' + n91 + ' → ' + nq + ')');
  await page.fill('#q', ''); await page.waitForTimeout(100);
  await page.selectOption('select[data-f=work]', 'new'); await page.waitForTimeout(100);
  ok(await S_(() => S.lastList.every(a => workState(a.key) === 'new')), 'filter “Not started” shows only accounts nobody has worked');
  await page.click('[data-act=clearF]');
  await page.click('[data-act=sort][data-k=days]'); await page.waitForTimeout(80);
  ok(await S_(() => { const d = S.lastList.map(a => a.days); return d.every((x, i) => !i || d[i - 1] >= x); }), 'sorting by Days works');
  await page.click('[data-act=tab][data-t="91"]');

  // ---- the account panel
  const k1 = await S_(() => list91(S.accts)[0].key); // being worked: voicemail, follow up today
  await page.click('tr[data-key="' + k1 + '"]'); await page.waitForSelector('#drawer .nowBox');
  await collect(); await shot(page, 'drawer');
  const before = await itemOf(k1);
  await page.click('#drawer [data-act=log][data-k=pt_noans]'); await page.waitForTimeout(250);
  const afterLog = await itemOf(k1);
  ok(afterLog.log.length === before.log.length + 1 && afterLog.stage === 'working' && afterLog.follow > before.follow, 'logging “no answer” adds it and moves the follow-up (' + before.follow + ' → ' + afterLog.follow + ')');
  ok(await toastHas(/Logged: No answer/), 'toast confirms the log, with Undo');
  await page.click('#drawer [data-act=undoLog]'); await page.waitForTimeout(250);
  const afterUndo = await itemOf(k1);
  ok(afterUndo.log.length === before.log.length && afterUndo.stage === before.stage && afterUndo.follow === before.follow, 'Undo puts it back exactly');
  // a promise needs a day
  await page.click('#drawer [data-act=log][data-k=pt_promise]'); await page.waitForSelector('#prDate');
  await page.click('#drawer [data-act=savePromise]'); await page.waitForTimeout(150);
  ok(await toastHas(/Pick the day/), 'a promise without a day is stopped');
  const payBy = await S_(() => nextOfficeDay(addDays(todayISO(), 3)));
  await page.fill('#prDate', payBy); await page.fill('#prAmt', '$150'); await page.click('#drawer [data-act=savePromise]'); await page.waitForTimeout(250);
  const pr = await itemOf(k1);
  ok(pr.stage === 'promise' && pr.follow === payBy && pr.log[pr.log.length - 1].amt === 150, 'promise saved: follow up on ' + payBy + ', $150 kept');
  await shot(page, 'drawer-promise');
  // assign, follow-up quick pick
  await page.selectOption('#drawer select[data-chg=assign]', 'taylor'); await page.waitForTimeout(200);
  ok((await itemOf(k1)).assignee === 'taylor', 'assigned to Taylor');
  await page.click('#drawer [data-act=setFollow] >> nth=1'); await page.waitForTimeout(200);
  ok((await itemOf(k1)).follow !== payBy, 'quick follow-up pick changes the day');
  await closeDrawer(); await page.waitForTimeout(100);
  ok(!(await page.$('#drawer')), 'Escape closes the panel');

  // a new account: ask Dr. A, he OKs it
  const k2 = await S_(() => list91(S.accts).find(a => !itemFor(a.key)).key);
  await page.evaluate(k => openDrawer(k), k2); await page.waitForSelector('#drawer .nowBox');
  ok(await page.$eval('#drawer #logBox', e => /Nothing logged yet/.test(e.textContent)), 'a fresh account has nothing logged');
  await page.click('#drawer [data-act=askDrA]'); await page.waitForSelector('#drQ');
  await page.fill('#drQ', 'OK to write off $40? Family moved away.'); await page.click('#drQok'); await page.waitForTimeout(300);
  const asked = await itemOf(k2);
  ok(asked && asked.drA === true && asked.log[0].k === 'drA_ask', 'asking Dr. A starts the account’s record and puts it on his Today');
  ok(await page.isVisible('#drawer .drABox [data-act=drAok]'), 'Dr. A sees OK / Not yet on it');
  await page.click('#drawer [data-act=drAok]'); await page.waitForTimeout(250);
  const oked = await itemOf(k2);
  ok(oked.drA === false && oked.log[oked.log.length - 1].k === 'drA_ok', 'his OK is logged and it leaves his queue');
  // resolve it, then reopen
  await page.click('#drawer [data-act=resolve]'); await page.waitForSelector('#rsPick');
  await collect();
  await page.click('#rsPick .pick[data-o=writeoff]'); await page.fill('#rsNote', 'Adjusted in Edge'); await page.click('#rsOk'); await page.waitForTimeout(300);
  const res = await itemOf(k2);
  ok(res.state === 'done' && res.outcome === 'writeoff', 'resolved as written off');
  ok(await page.isVisible('#drawer [data-act=reopen]'), 'a resolved account offers Reopen');
  await shot(page, 'drawer-resolved');
  await page.click('#drawer [data-act=reopen]'); await page.waitForTimeout(250);
  ok((await itemOf(k2)).state === 'open', 'reopened');
  await closeDrawer();

  // resolved before this report, but on the list again: logging reopens it
  const kb = await S_(() => { const it = Array.from(S.items.values()).find(x => isBack(x)); return it && it.key; });
  ok(!!kb, 'the demo has an account that’s on the list again');
  await page.evaluate(k => openDrawer(k), kb); await page.waitForSelector('#drawer .nowBox');
  ok(await page.$eval('#drawer .dBd', e => /Logging anything reopens it/.test(e.textContent)), 'its panel says so');
  await shot(page, 'drawer-back');
  await page.click('#drawer [data-act=log][data-k=pt_vm]'); await page.waitForTimeout(300);
  const back = await itemOf(kb);
  ok(back.state === 'open' && back.log.slice(-2).map(e => e.k).join(',') === 'reopen,pt_vm', 'logging a voicemail reopened it first: ' + back.log.slice(-2).map(e => e.k).join(','));
  ok(back.log[back.log.length - 2].fresh === true, 'as a new round (a collections ladder starts over)');
  await closeDrawer();

  // ---- the collections ladder (handbook §14)
  const lad = k => page.evaluate(k => { const l = ladFor(S.byKey.get(k)); return l && JSON.parse(JSON.stringify({ due: l.due && l.due.id, done: Object.keys(l.done), signed: Object.keys(l.signed), asked: l.asked, hold: !!l.hold, paused: l.paused, fin: !!l.fin })); }, k);
  const dueKey = (step, extra) => page.evaluate(([st, x]) => { const a = ladDueAccts().find(a => { const l = ladFor(a); return l.due.id === st && (x !== 'asked' || l.asked === st) && (x !== 'free' || (!l.asked && !l.signed[st])); }); return a && a.key; }, [step, extra || '']);
  await page.click('#nav-today'); await page.waitForSelector('.ladRow');
  ok(await page.$$eval('.ladRow', r => r.length) >= 8, 'Today lists the collection steps due, step by step');
  await page.click('.ladRow[data-step=l1]'); await page.waitForTimeout(150);
  ok(await S_(() => S.view === 'pd' && S.tab.pd === 'lad' && S.ladStep === 'l1' && S.lastList.length > 1 && S.lastList.every(a => ladFor(a).due.id === 'l1')), 'a step on Today opens the ladder at that step');
  await collect(); await shot(page, 'ladder-l1', true);
  const nL1 = await S_(() => S.lastList.length);
  await page.click('[data-act=ladBatch][data-m=done]'); await page.click('#cbYes'); await page.waitForTimeout(700);
  ok(await S_(() => !ladDueAccts().some(a => ladFor(a).due.id === 'l1')) && await toastHas(/Letter #1: \d+ accounts marked sent/), 'all ' + nL1 + ' Letter #1s marked sent at once (sent together from Edge)');
  ok(await S_(() => S.ladStep === '' && S.lastList.length === ladDueAccts().length), 'with none left at that step, the list shows every step again');
  // Letter #3 and the call, in one tap; undo
  const k3 = await dueKey('l3');
  await page.evaluate(k => openDrawer(k), k3); await page.waitForSelector('#drawer .ladNow');
  await collect(); await shot(page, 'drawer-ladder');
  await page.click('#drawer [data-act=ladDone][data-s=l3]'); await page.waitForTimeout(250);
  let L3 = await lad(k3);
  ok(L3.done.includes('l3') && !L3.due && await toastHas(/Recorded: Letter #3 sent \+ called/), 'Letter #3 + the call recorded in one tap; nothing due until day 60');
  await page.click('#drawer [data-act=undoLog]'); await page.waitForTimeout(250);
  ok((await lad(k3)).due === 'l3', 'Undo puts it back');
  await closeDrawer();
  // Letter #4: Dr. A signs it himself; Maintenance Hold on and off; sent
  const k4 = await dueKey('l4', 'free');
  await page.evaluate(k => openDrawer(k), k4); await page.waitForSelector('#drawer [data-act=ladSigned]');
  await page.click('#drawer [data-act=ladSigned][data-s=l4]'); await page.waitForTimeout(250);
  ok((await lad(k4)).signed.includes('l4') && await page.isVisible('#drawer .ladNow .badge.t-ok'), 'Dr. A: “I signed it” — the letter shows signed, ready to send');
  await page.click('#drawer [data-act=ladHold][data-on="1"]'); await page.waitForTimeout(250);
  ok((await lad(k4)).hold && await page.isVisible('#drawer .holdBox') && await toastHas(/yellow box/), 'put on Maintenance Hold (the reminder says: the yellow box in Edge, tell the clinical team)');
  await page.click('#drawer [data-act=ladDone][data-s=l4]'); await page.waitForTimeout(250);
  ok((await lad(k4)).done.includes('l4') && !(await lad(k4)).due, 'Letter #4 sent (not certified: no tracking number asked)');
  await page.click('#drawer [data-act=ladHold][data-on="0"]'); await page.waitForTimeout(250);
  ok(!(await lad(k4)).hold, 'hold lifted');
  await closeDrawer();
  // Letter #5 waiting for his signature: he signs it in the box; it goes certified with its tracking number
  const k5 = await dueKey('l5', 'asked');
  ok(!!k5, 'the demo has a certified letter waiting for Dr. A');
  await page.evaluate(k => openDrawer(k), k5); await page.waitForSelector('#drawer .drABox');
  ok(await page.$eval('#drawer .drABox', e => /Letter #5 — for you to sign/.test(e.textContent)) && await page.isVisible('#drawer .ladNow .waitTag') && !(await page.$('#drawer [data-act=ladSigned]')), 'he sees it as a letter to sign (one place to sign it)');
  await shot(page, 'drawer-sign');
  await page.click('#drawer .drABox [data-act=drAok]'); await page.waitForTimeout(250);
  ok((await lad(k5)).signed.includes('l5') && !(await itemOf(k5)).drA && await toastHas(/Signed — ready to send/), 'signed: it leaves his list');
  await page.click('#drawer [data-act=ladDone][data-s=l5]'); await page.waitForSelector('#ctNo');
  await page.fill('#ctNo', '9407 1112 0000 0000 0000 42'); await page.click('#ctOk'); await page.waitForTimeout(250);
  const it5 = await itemOf(k5), e5 = it5.log[it5.log.length - 1];
  ok(e5.k === 'ladder' && e5.step === 'l5' && /^Certified #9407/.test(e5.note), 'sent certified: the tracking number is kept with it');
  await closeDrawer();
  // staff: “Ask Dr. A to sign” (Letter #7)
  await page.evaluate(() => { B.me.role = 'staff'; });
  const k7 = await dueKey('l7', 'free');
  await page.evaluate(k => openDrawer(k), k7); await page.waitForSelector('#drawer [data-act=ladAsk]');
  await page.click('#drawer [data-act=ladAsk][data-s=l7]'); await page.waitForTimeout(250);
  ok((await lad(k7)).asked === 'l7' && (await itemOf(k7)).drA && await page.isVisible('#drawer .ladNow .waitTag'), 'staff: “Ask Dr. A to sign” puts Letter #7 on his list; the panel says it’s waiting');
  await page.evaluate(() => { B.me.role = 'owner'; }); await closeDrawer();
  // a broken arrangement: Letter #8 comes due
  const kp = await S_(() => { const a = S.accts.find(a => { const l = ladFor(a); return l && l.paused === 'plan'; }); return a && a.key; });
  await page.evaluate(k => openDrawer(k), kp); await page.waitForSelector('#drawer .ladSec .notice.info [data-act=ladAA]');
  await page.click('#drawer .ladSec [data-act=ladAA]'); await page.click('#cbYes'); await page.waitForTimeout(250);
  ok((await lad(kp)).due === 'aa' && (await itemOf(kp)).stage === 'working', 'a payment plan broken: Letter #8 (off the ladder) is due');
  await closeDrawer();
  // the last step: 30 days after Letter #7 — write it off
  const ke = await dueKey('end');
  await page.evaluate(k => openDrawer(k), ke); await page.waitForSelector('#drawer .ladNow [data-act=resolve]');
  await page.click('#drawer .ladNow [data-act=resolve]'); await page.click('#rsPick .pick[data-o=writeoff]'); await page.click('#rsOk'); await page.waitForTimeout(300);
  ok((await itemOf(ke)).outcome === 'writeoff' && !(await S_(() => ladDueAccts().some(a => ladFor(a).due.id === 'end'))), 'the 30 days are up: resolved as written off, it leaves the steps due');
  await closeDrawer();
  await page.click('#nav-pd'); await page.click('[data-act=tab][data-t=lad]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=csv]').then(() => page.click('#cbYes'))]);
  const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
  ok(/"Collections step"/.test(csv2) && /Day \d+: Letter #/.test(csv2), 'the downloaded steps list says each account’s step');
  await page.click('#nav-sum'); await page.waitForTimeout(200);
  ok(/Collections ladder/.test(await page.textContent('#view')) && /On Maintenance Hold/.test(await page.textContent('#view')), 'Summary: where the accounts are on the ladder');

  // credits: the refund checklist
  await page.click('#nav-cr'); await page.waitForSelector('#view tbody tr');
  const kc = await S_(() => listCredits(S.accts).find(a => !a.prepay && !itemFor(a.key)).key);
  await page.click('tr[data-key="' + kc + '"]'); await page.waitForSelector('#drawer .chkList');
  await collect(); await shot(page, 'drawer-credit');
  await page.check('#drawer .chkList input[data-k=fee]'); await page.waitForTimeout(250);
  const cr = await itemOf(kc);
  ok(cr && cr.kind === 'cr' && cr.checks.fee === true, 'ticking a refund check starts the record with it ticked');
  ok(await page.$eval('#drawer .sec h5', () => /1 of 8/.test(document.querySelector('#drawer').textContent)), 'checklist shows 1 of 8');
  await closeDrawer();

  // Today: close the accounts cleared in Edge
  await page.click('#nav-today'); await page.waitForSelector('[data-act=closeCleared]');
  await page.click('[data-act=closeCleared]'); await page.click('#cbYes'); await page.waitForTimeout(400);
  ok((await S_(() => counts())).cleared === 0 && await toastHas(/Closed 1 account/), 'closing “Cleared in Edge” resolves them');

  // download a list
  await page.click('#nav-pd'); await page.click('[data-act=tab][data-t="91"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=csv]').then(() => page.click('#cbYes'))]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/^﻿"Patient","Responsible party","Edge status"/.test(csv) && csv.split('\n').length === n91 + 1, 'Download list: a CSV with a heading row and one line per account (' + (csv.split('\n').length - 1) + ')');
  ok(/nlo-ar-past-due-91-\d{4}-\d{2}-\d{2}\.csv/.test(dl.suggestedFilename()), 'file name says which list: ' + dl.suggestedFilename());

  // ---- insurance carriers
  await page.click('#nav-ins'); await page.click('[data-act=tab][data-t=carriers]'); await page.waitForSelector('.carGrid');
  const cg = await page.evaluate(() => ({ cards: document.querySelectorAll('.carCard').length, untagged: document.querySelectorAll('.tagRow').length, first: document.querySelector('.carCard h3').textContent, tel: !!document.querySelector('.carCard a[href^="tel:"]') }));
  ok(cg.cards === 5 && cg.untagged === 3 && cg.tel, 'Insurance → Carriers: 5 carriers (most past due first: ' + cg.first + '), phone links, 3 accounts without a carrier');
  const tagKey = await page.$eval('.tagRow select', e => e.dataset.key);
  const gulf = await S_(() => S.book.carriers.find(c => c.name === 'Gulf Dental Group').id);
  await page.selectOption('.tagRow select[data-key="' + tagKey + '"]', gulf); await page.waitForTimeout(300);
  ok(await page.$$eval('.tagRow', r => r.length) === 2, 'setting the carrier from the list: 2 left without one');
  ok(await page.evaluate(k => carrierFor(k) && carrierFor(k).name === 'Gulf Dental Group', tagKey), 'the account is with Gulf Dental Group now');
  // a new carrier: a bad portal address is refused, a good one saved
  await page.click('[data-act=carrierNew]'); await page.waitForSelector('#carName');
  await page.fill('#carName', 'Test Plan (demo)'); await page.fill('#carPortal', 'not a link'); await page.click('[data-act=carrierSave]'); await page.waitForTimeout(150);
  ok(await toastHas(/web address/) && await page.isVisible('#carName'), 'a portal that isn’t a web address is refused (the form stays open)');
  await page.fill('#carPortal', 'https://provider.example.com/test'); await page.fill('#carPhone', '(800) 555-0111'); await page.fill('#carTf', '90'); await page.click('[data-act=carrierSave]'); await page.waitForTimeout(400);
  ok(await page.$$eval('.carCard', c => c.length) === 6 && await S_(() => S.book.carriers.some(c => c.name === 'Test Plan (demo)' && c.tf === 90)), 'a carrier added (6 now)');
  // call a carrier once about all its accounts
  const bay = await S_(() => { const c = S.book.carriers.find(x => x.name === 'Bayside Dental Plan'); return { id: c.id, keys: carrierStats(c).pd.map(a => a.key) }; });
  await page.click('[data-act=carrierCallAll][data-id="' + bay.id + '"]'); await page.fill('#callNote', 'Claims are in review'); await page.click('[data-act=carrierCallSave]');
  await page.waitForFunction(keys => keys.every(k => { const it = itemFor(k); return it && it.log.some(e => e.k === 'ins_call' && /Bayside Dental Plan: Claims are in review/.test(e.note)); }), bay.keys, { timeout: 10000 });
  ok(true, '“Called about all ' + bay.keys.length + '” logs the call (with the note) on each of Bayside’s accounts');
  // the carrier on an account's panel; the Carrier filter on the lists
  await page.click('[data-act=tab][data-t=all]'); await page.waitForTimeout(150);
  await page.selectOption('select[data-f=car]', bay.id); await page.waitForTimeout(150);
  ok(await page.$$eval('#view tbody tr', (r, n) => r.length > 0 && r.length <= n, bay.keys.length) && await S_(() => S.lastList.every(a => carrierFor(a.key) && carrierFor(a.key).name === 'Bayside Dental Plan')), 'the Carrier filter shows only that carrier’s accounts');
  await page.click('#view tbody tr'); await page.waitForSelector('#drawer .carBox');
  ok(await page.$eval('#drawer .carBox', e => /Bayside Dental Plan/.test(e.querySelector('select').selectedOptions[0].textContent) && !!e.querySelector('a[href^="tel:"]') && !!e.querySelector('a[target=_blank]') && /BDP01/.test(e.textContent)), 'the account’s panel: its carrier, with Call, Portal and the payer ID');
  await page.click('#drawer [data-act=closeDrawer]');
  await page.click('[data-act=clearF]').catch(() => { });
  // ---- the December credit audit
  await page.click('#nav-cr'); await page.click('[data-act=tab][data-t=audit]'); await page.waitForTimeout(150);
  ok(await page.$eval('#view', e => /The next audit starts/.test(e.textContent) && e.querySelectorAll('.aChk').length > 5), 'Credits → December audit (outside December): when it starts, and every credit listed');
  const dec = await page.evaluate(() => { const real = todayISO; todayISO = () => '2026-12-10'; ACT.nav({ dataset: { v: 'today' } }); const b = document.querySelector('.staleBox.audit'), r = { banner: b ? b.textContent : '' };
    S.focus = true; renderView(); r.audit = Array.from(document.querySelectorAll('.fList .frow')).filter(x => x.dataset.kind === 'creditaudit').length; S.focus = false; todayISO = real; renderView(); return r; });
  ok(/December credit audit: \d+ of \d+ credits reviewed/.test(dec.banner) && /by Wednesday, Mar 31/.test(dec.banner) && dec.audit > 3, 'in December: the audit line on Today (' + dec.banner.replace(/Open the audit$/, '').trim() + ') and the credits not reviewed in Focus');

  // ---- importing a made-up Edge export
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  const nRep = await S_(() => S.reports.length);
  await page.setInputFiles('#arFile', path.join(__dirname, 'fixtures', 'edge-full.xls'));
  await page.waitForSelector('#impSave');
  await collect(); await shot(page, 'import-preview', true);
  ok(await page.$eval('#view .chk.ok', e => /Matches Edge’s totals: 320 accounts/.test(e.textContent)), 'preview: the file matches Edge’s own totals');
  await page.click('#impSave'); await page.waitForFunction(n => S.reports.length === n + 1, nRep, { timeout: 10000 });
  await page.waitForTimeout(300);
  ok(await toastHas(/Report saved/), 'saved (sealed) — ' + (await S_(() => S.reports.length)) + ' reports');
  await page.click('#nav-reports'); await page.waitForSelector('[data-act=delReport]');
  const rid = await S_(() => S.reports.find(r => r.n > 100).id);
  await page.click('[data-act=delReport][data-id="' + rid + '"]'); await page.click('#cbYes'); await page.waitForFunction(n => S.reports.length === n, nRep, { timeout: 5000 });
  ok(true, 'the owner can delete a report');
  // a paste of a random table is refused with a reason
  await page.evaluate(() => { const pb = document.querySelector('#pasteBox'); const dt = new DataTransfer(); dt.setData('text/plain', 'Name\tPhone\nA\t1\n'); pb.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(150);
  ok(await page.$eval('#view .lockErr', e => /doesn’t look like/.test(e.textContent)).catch(() => false), 'pasting something that isn’t the report says so');
  await page.click('[data-act=nav][data-v=today] >> nth=0').catch(() => page.click('#nav-today'));

  // ---- Settings
  await page.click('#nav-settings'); await page.waitForSelector('#accessBox .accessRow');
  await page.waitForTimeout(300);
  ok(await page.$$eval('#accessBox .sw[aria-checked=true]', s => s.length) === 3, 'three people have A/R (Dr. A, Jamie, Taylor)');
  ok(await page.$eval('#accessBox', e => /Needs to sign in once/.test(e.textContent)), 'someone who hasn’t chosen a password yet can’t be given A/R yet');
  await page.click('#accessBox .sw[data-uid=u-morgan]'); await page.waitForTimeout(800);
  ok(await page.$eval('#accessBox .sw[data-uid=u-morgan]', e => e.getAttribute('aria-checked')) === 'true' && (await S_(() => S.team)).includes('morgan'), 'turning Morgan on gives her A/R (and she can be assigned accounts)');
  await page.click('#accessBox .sw[data-uid=u-jamie]'); await page.waitForSelector('#cbYes'); await page.click('#cbYes');
  await page.waitForSelector('#rotBar'); await shot(page, 'settings-rotating');
  await page.waitForFunction(() => !S.rotating && S.people && !S.people.grants.some(g => g.uid === 'u-jamie'), null, { timeout: 15000 });
  ok(await toastHas(/A\/R turned off for Jamie/) && await page.$eval('#keyBox', e => /#2/.test(e.textContent)), 'turning Jamie off makes a new A/R key (#2) and seals everything again');
  await page.fill('#cfgInst', '12.50'); await page.waitForTimeout(100);
  ok(/0 insurance accounts/.test(await page.textContent('#cfgPrev')), 'the preview shows what $12.50 would give with this report');
  await page.click('[data-act=saveCfg]'); await page.waitForTimeout(300);
  ok((await S_(() => S.cfg.inst)) === 12.5 && (await S_(() => counts().chase)) === 0, 'saved: the lists use $12.50 (no account is a multiple of it)');
  await page.click('[data-act=resetCfg]'); await page.click('#cbYes'); await page.waitForTimeout(300);
  ok((await S_(() => S.cfg.inst)) === 11.11, 'back to the usual numbers');
  await page.fill('#cfgT1', '50'); await page.click('[data-act=saveCfg]'); await page.waitForTimeout(150);
  ok(await toastHas(/more than the one before/), 'cutoffs out of order are refused');
  // the goals in Settings
  await page.fill('#cfgT1', '120'); await page.fill('#cfgGoalPt', '9'); await page.waitForTimeout(100);
  ok(/patient accounts past due <b>8\.1%<\/b> \(goal 9%\)/.test(await page.innerHTML('#cfgPrev')), 'the preview shows the patient rate against a 9% goal');
  await page.selectOption('#cfgKpiFrom', '31'); await page.click('[data-act=saveCfg]'); await page.waitForTimeout(300);
  const k9 = await S_(() => ({ cfg: [S.cfg.goalPt, S.cfg.kpiFrom], k: kpis(S.rep, S.cfg) }));
  ok(k9.cfg[0] === 9 && k9.cfg[1] === 31 && k9.k.pt.n < 34 && k9.k.pt.ok, 'saved: a 9% goal, counting from 31 days — ' + k9.k.pt.n + ' patient accounts, goal met');
  await page.click('#nav-today'); await page.waitForSelector('.goals .goal');
  ok(await page.$eval('.goals .goal', e => e.classList.contains('ok') && /Goal met/.test(e.textContent) && /30\+ days past due/.test(e.textContent)), 'Today: the patient gauge turns green, “Goal met”');
  await page.click('#nav-settings'); await page.waitForSelector('#cfgGoalPt'); await page.waitForTimeout(300);
  await page.click('[data-act=resetCfg]'); await page.click('#cbYes'); await page.waitForTimeout(300);
  ok(await S_(() => S.cfg.goalPt === 4 && S.cfg.goalIns === 4 && S.cfg.kpiFrom === 1), 'back to the usual numbers: 4%, 4%, from day 1');
  await page.fill('#cfgGoalIns', '0'); await page.click('[data-act=saveCfg]'); await page.waitForTimeout(150);
  ok(await toastHas(/between 0\.1% and 100%/) && await S_(() => S.cfg.goalIns === 4), 'a 0% goal is refused');
  await page.fill('#cfgGoalIns', '4'); await page.selectOption('#cfgDue', '4'); await page.click('[data-act=saveCfg]'); await page.waitForTimeout(300);
  ok(await S_(() => S.cfg.dueDay === 4), 'the weekly report can be due Thursdays instead');
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  ok(await page.$eval('.dueOk', e => /This week’s report is in/.test(e.textContent) && /due Thursday/.test(e.textContent)), 'Reports: this week’s is in, and the next one is due Thursday');
  await page.click('#nav-settings'); await page.waitForSelector('#cfgDue'); await page.waitForTimeout(300);
  await page.click('[data-act=resetCfg]'); await page.click('#cbYes'); await page.waitForTimeout(300);
  ok(await S_(() => S.cfg.dueDay === 1), 'back to Mondays');
  await page.click('[data-act=loadActivity]'); await page.waitForTimeout(400);
  ok(await page.$$eval('#actBox .hist', h => h.length) > 5, 'recent activity lists who did what');
  await collect(); await shot(page, 'settings-after', true);

  // ---- My account
  await page.click('#nav-account'); await page.fill('#pwCur', 'demo'); await page.fill('#pwN1', 'abcdefgh1'); await page.fill('#pwN2', 'abcdefgh2');
  await page.click('#pwForm button[type=submit]'); await page.waitForTimeout(150);
  ok(await toastHas(/don’t match/), 'password change: the two new passwords must match');

  // ---- every button has a handler
  const missing = await page.evaluate(list => list.filter(a => typeof ACT[a] !== 'function'), Array.from(acts));
  ok(missing.length === 0, 'every data-act has a handler (' + acts.size + ' seen)' + (missing.length ? ': missing ' + missing.join(', ') : ''));

  // ---- lock
  await page.click('[data-act=lock] >> nth=0'); await page.waitForSelector('#loginForm');
  ok(await S_(() => S.items.size === 0 && !S.rep), 'Lock clears everything from the page');

  // ---- phone
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await routes(ph);
  const p2 = await ph.newPage(); watch(p2, errs, 'phone');
  await p2.goto(URL); await p2.click('#lgBtn'); await p2.waitForSelector('.tiles .tile'); await p2.waitForTimeout(300);
  await p2.screenshot({ path: path.join(SHOTS, 'phone-today.png'), fullPage: true });
  const wide = async () => p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(await wide() <= 0, 'phone: Today fits the screen (no sideways scrolling)');
  for (const v of ['pd', 'ins', 'cr', 'sum', 'reports']) {
    await p2.click('#mnav-' + v); await p2.waitForTimeout(200);
    await p2.screenshot({ path: path.join(SHOTS, 'phone-' + v + '.png'), fullPage: true });
    ok(await wide() <= 0, 'phone: ' + v + ' fits the screen');
  }
  await p2.click('#mnav-pd'); await p2.click('#view tbody tr >> nth=0'); await p2.waitForSelector('#drawer .ladNow');
  await p2.screenshot({ path: path.join(SHOTS, 'phone-drawer.png'), fullPage: false });
  ok(await p2.$eval('#drawer', e => e.getBoundingClientRect().width <= window.innerWidth), 'phone: the account panel fits');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ':\n    ' + errs.join('\n    ') : ''));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
