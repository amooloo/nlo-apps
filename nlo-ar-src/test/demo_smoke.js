/* Clicks through the demo (?demo, made-up accounts) on a desktop and a phone screen: every screen, the account panel
   (log, undo, promise, ask Dr. A, resolve, reopen, an account that's on the list again, the refund checklist), the collections
   ladder (steps due, a step for many accounts at once, Dr. A signing, a certified letter, Maintenance Hold, a broken arrangement,
   the write-off at the end, a new round for an account past due again), closing
   accounts cleared in Edge, importing a made-up Edge export, Settings (who can use A/R, the numbers), downloading a list,
   and that every button on every screen has a handler. Needs a static server on :8766 serving dist/.
   Run: node test/demo_smoke.js  (screenshots go to shots/) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { routes, watch, CHROME, obReportTSV, insAgingTSV, edgeTasksTSV } = require('./helpers');
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
  ok(await page.$$eval('.goals .goal', g => g.length) === 2 && k0.pt.n === 25 && k0.pt.of === 422 && k0.ins.n === 14 && k0.ins.of === 204 && k0.from === 31 && k0.win === 60, 'Today: two goal gauges — patient 25 of 422 (30+ days past due, the usual), insurance 14 of 204 (over 60 days): ' + JSON.stringify(k0));
  ok(await page.$eval('.goals .goal', e => /5\.9%/.test(e.textContent) && /9 to go/.test(e.textContent) && /goal ≤ 4%/.test(e.textContent) && /30\+ days past due/.test(e.textContent) && e.classList.contains('near')), 'the patient gauge reads 5.9% (30+ days) against 4%, 9 to go, in amber');
  // the weekly report (due Tuesdays): this week's is in, so no banner and no badge
  ok(!(await page.$('.staleBox.wk')) && await page.$eval('#nav-reports .cnt', e => e.classList.contains('hidden')), 'this week’s report is in: no banner on Today, no badge on Reports');
  // pretend it's later: the first day this week's report would be due, then 9 days on (late)
  const wk = await page.evaluate(() => {
    const real = todayISO, newest = newestWeekly(), look = () => { renderNav(); renderView(); const b = document.querySelector('#view .staleBox.wk'), c = document.querySelector('#nav-reports .cnt');
      return { cls: b ? b.className : '', txt: b ? b.textContent : '', badge: c.classList.contains('hidden') ? '' : c.textContent, red: c.classList.contains('red'), amber: c.classList.contains('amber') }; };
    let d = real(); for (let i = 0; i < 14 && reportDue(newest, d, S.cfg.dueDay).state !== 'today'; i++) d = addDays(d, 1);
    todayISO = () => d; const due = look(); todayISO = () => addDays(real(), 9); const late = look(); todayISO = real; const back = look(); return { due, late, back, d };
  });
  ok(/staleBox wk today/.test(wk.due.cls) && /due today/.test(wk.due.txt) && wk.due.badge === 'Due' && wk.due.amber, 'on its due day (' + wk.d + '): an amber “due today” banner and Due on Reports');
  ok(/staleBox wk late/.test(wk.late.cls) && /late — it was due Tuesday/.test(wk.late.txt) && wk.late.badge === 'Late' && wk.late.red, 'after it: a red “late” banner and Late on Reports — ' + wk.late.txt);
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

  // ---- OrthoBanc's report file, imported (optional — it never changes an account)
  const OBD = await S_(() => {
    const O = obState(S.book, todayISO(), obDays()), prev = Array.from(S.obReps.values()).find(r => r.day < O.cur.date), r0 = prev.rows[0], used = new Set(prev.rows.map(r => r.patient));
    const more = S.accts.filter(a => !a.ins && a.pd > 0 && !a.inactive && !used.has(a.patient)).slice(4, 6);
    const lf = n => { const w = n.split(' '); return w.slice(-1)[0] + ', ' + w.slice(0, -1).join(' '); }, plain = a => rpName(a).replace(/^(mr|mrs|ms|dr)\.?\s+/i, '');
    return { day: O.cur.date, prev: prev.day, long: new Date(O.cur.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), keys: more.map(a => a.key),
      before: JSON.stringify(more.map(a => itemFor(a.key) || null)), check: JSON.stringify(S.book.ob),
      hold: [{ ref: r0.ref, acct: r0.acct, patient: lf(r0.patient), rp: lf(r0.rp), amt: 175, why: 'Credit Card - Declined Insufficient Funds', when: '10/02/2026', bal: 1225 }],
      other: more.map((a, i) => ({ ref: 'ob9100000' + i, acct: String(20500 + i), patient: i ? a.patient : lf(a.patient), rp: lf(plain(a)), amt: 150 + i * 50, why: i ? 'Credit Card  - Blocked by issuer' : 'Credit Card - Card Number Error', when: '10/02/2026', how: i ? 'OnLine Pmt' : 'Pmt', bal: 900 }))
        .concat([{ ref: 'ob91000099', acct: '20599', patient: 'Zzyzx, Imaginary', rp: 'Zzyzx, Pat', amt: 125, why: 'Credit Card - Declined', when: '10/02/2026', bal: 500 }]) };
  });
  const obFile = { name: 'FailedTransactions.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(obReportTSV(OBD.long, OBD.hold, OBD.other)) };
  await page.evaluate(() => ACT.obCheck()); await page.waitForSelector('#obN');
  const [obFc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#modalWrap [data-act=obPick]')]);
  await obFc.setFiles(obFile); await page.waitForSelector('#obSaveImp');
  const obPv = (await page.innerText('#modalWrap')).replace(/\s+/g, ' ');
  ok(/OrthoBanc failed payments/i.test(obPv) && /4 failed payments/.test(obPv) && /\$650 not drafted/.test(obPv) && /1 on HOLD/.test(obPv) && /3 of 4 on the A\/R report/.test(obPv) && /1 family failed on an earlier report too/.test(obPv) && /doesn’t change any account/.test(obPv),
    '“Checked it” → Or import its file: the preview — 4 failed payments, $650, 1 on HOLD, 3 on the A/R report, 1 failed before; nothing changes any account' );
  await shot(page, 'ob-preview');
  await page.click('#obSaveImp'); await page.waitForSelector('#obListBox .obRow');
  const obL = await page.$$eval('#obListBox .obRow', r => r.map(x => ({ who: x.querySelector('.obWho b').textContent, hold: !!x.querySelector('.obHold'), tel: !!x.querySelector('a[href^="tel:"]'), open: !!x.querySelector('[data-act=obOpen]'), before: (x.querySelector('.obRep') || {}).textContent || '', not: /Not on the/.test(x.textContent) })));
  ok(obL.length === 4 && obL[0].hold && !obL.slice(1).some(x => x.hold) && /Failed before: /.test(obL[0].before) && obL.filter(x => x.tel && x.open).length === 3 && obL[3].not && !obL[3].open,
    'saved: the list — on HOLD first (failed before ' + obL[0].before.replace('Failed before: ', '') + '), the phone number and the account for the 3 on the A/R report, the 4th to find in Edge');
  ok(await S_(() => { const r = obRepFor(obCycle(todayISO()).cur.date); return r && r.rows.length === 4 && r.by === meSid() && Object.keys(r.done).length === 0 && !obState(S.book, todayISO(), obDays()).due; }), 'saved sealed in its own record (none ticked yet); the report counts as checked');
  await shot(page, 'ob-list', true);
  await page.click('#obListBox .obTick >> nth=1'); await page.waitForTimeout(300);
  ok(/1 of 4/.test(await page.textContent('#obListBox .obTop')) && await page.$eval('#obListBox .obTick >> nth=1', b => b.getAttribute('aria-pressed') === 'true') && await page.$eval('#obListBox .obTick[aria-pressed=true]', b => /Texted · /.test(b.closest('.obRow').textContent)), 'tick a family: 1 of 4 texted, who and when');
  await page.click('#modalWrap [data-act=closeModal]'); await page.waitForTimeout(250);
  const obB = (await page.innerText('.staleBox.ob')).replace(/\s+/g, ' ');
  ok(/4 failed payments \(1 on HOLD\) — 1 of 4 texted/.test(obB) && await page.isVisible('.staleBox.ob [data-act=obList]'), 'Today: “4 failed payments (1 on HOLD) — 1 of 4 texted”, with the list a tap away');
  ok(await S_(() => JSON.stringify(S.book.ob)) === OBD.check, 'her “Checked it” (count and note) is left exactly as it was');
  ok(await page.evaluate(keys => JSON.stringify(keys.map(k => itemFor(k) || null)), OBD.keys) === OBD.before, 'the accounts on the list are untouched: no note, follow-up or step was added');
  await page.click('[data-act=focusOn]'); await page.waitForSelector('.fList .frow');
  const obF = await page.$$eval('.fList .frow[data-kind=ob]', r => r.map(x => ({ cls: x.className, txt: x.textContent })));
  ok(obF.length === 1 && /urgent/.test(obF[0].cls) && /OrthoBanc: 3 families to text/.test(obF[0].txt) && /1 on HOLD/.test(obF[0].txt), 'Focus: one line for the whole list (not one per family) — urgent while someone on HOLD is left');
  await page.click('.fList .frow[data-kind=ob]'); await page.waitForSelector('#obListBox');
  await page.click('#obListBox [data-act=obOpen] >> nth=1'); await page.waitForSelector('#drawer .obBox');
  const obPn = (await page.innerText('#drawer .obBox')).replace(/\s+/g, ' ');
  ok(/draft failed/.test(obPn) && /report/.test(obPn) && !(await page.isVisible('#modalWrap')), 'Account → its panel: the failed draft, the reason, whether it was ticked — ' + obPn.slice(0, 90));
  await page.click('#drawer [data-act=closeDrawer]');
  await page.click('.fList .frow[data-kind=ob]'); await page.waitForSelector('#obListBox');
  await page.click('#obListBox [data-act=obTickAll]'); await page.waitForTimeout(300);
  ok(/4 of 4/.test(await page.textContent('#obListBox .obTop')) && !(await page.$('#obListBox [data-act=obTickAll]')), 'Mark all texted: 4 of 4');
  await page.click('#modalWrap [data-act=closeModal]'); await page.waitForTimeout(250);
  ok(!(await page.$('.fList .frow[data-kind=ob]')), 'Focus: the line is gone once everyone is ticked');
  await page.click('[data-act=focusOff]'); await page.waitForSelector('.tiles');
  ok(!(await page.$('.staleBox.ob')), 'Today: the banner is gone too');
  // the same file again, dropped on Reports: the list is replaced, the ticks stay
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  await page.setInputFiles('#arFile', obFile); await page.waitForSelector('#obSaveImp');
  ok(/was imported before/.test(await page.textContent('#modalWrap')) && /stay ticked/.test(await page.textContent('#modalWrap')) && !(await S_(() => !!(S.imp && S.imp.files && S.imp.files.length))), 'Reports takes OrthoBanc’s file too (not as an A/R report): it says it was imported before and the ticks stay');
  await page.click('#obSaveImp'); await page.waitForSelector('#obListBox');
  ok(/4 of 4/.test(await page.textContent('#obListBox .obTop')), 'imported again: still 4 of 4 ticked');
  await page.click('#obListBox .obTick >> nth=0'); await page.waitForTimeout(300);
  ok(/3 of 4/.test(await page.textContent('#obListBox .obTop')) && await S_(() => obProgress(obRepFor(obCycle(todayISO()).cur.date)).holdLeft === 1), 'untick one: 3 of 4, the one on HOLD left');
  await page.click('#modalWrap [data-act=closeModal]'); await page.click('#nav-today'); await page.waitForSelector('.tiles');

  for (const v of ['pd', 'ins', 'cr', 'sum', 'reports', 'settings', 'account']) {
    await page.click('#nav-' + v); await page.waitForTimeout(v === 'settings' ? 500 : 200);
    await collect(); await shot(page, v, true);
  }
  await page.click('#nav-sum'); await page.waitForSelector('.goalsCard .gTrend');
  ok(await page.$$eval('.goalsCard .gTrend path.tl', p => p.length) === 2 && await page.$eval('.goalsCard .gTrend text.gt', e => e.textContent === '4%'), 'Summary: both rates week by week, with the 4% goal line');
  ok(await page.$eval('.goalsCard .gHow', e => /30 or more days past due/.test(e.textContent) && /more than 60 days past due/.test(e.textContent)), 'Summary: how the goals are counted (patient: 30 or more days past due)');

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

  // ---- Edge's Insurance Aging: every insurance account's carrier (a made-up export of the demo's insurance accounts)
  const IA = await S_(() => {
    const ins = S.accts.filter(a => a.ins), src = a => carrierSrc(S.book, a.key, a), un = ins.filter(a => !src(a).c), bay = ins.filter(a => (src(a).hand || {}).name === 'Bayside Dental Plan');
    const row = (a, i) => ({ patient: a.patient, acct: '99-' + (8100 + i), sts: a.sts, rp: a.rp, home: a.home, due: a.due, b0: a.b0, b30: a.b30, b60: a.b60, b90: a.b90, days: a.days, bal: a.bal == null ? 0 : a.bal, lastAmt: a.lastAmt, recv: '' });
    const by = { pel: [], gulf: [], bay: [], other: {} };
    ins.forEach((a, i) => { const s = src(a); if (!s.c || a.key === bay[0].key) by.pel.push(row(a, i)); else if (s.c.name === 'Bayside Dental Plan') by.bay.push(row(a, i)); else if (s.c.name === 'Gulf Dental Group') by.gulf.push(row(a, i)); else (by.other[s.c.name] = by.other[s.c.name] || []).push(row(a, i)); });
    const extra = [{ patient: 'Imaginary Testerton', acct: '99-8990', sts: 'A-Comp Bra', rp: 'INS: Pat Testerton', home: '', due: 0, b0: 0, b30: 0, b60: 0, b90: 0, days: 0, bal: 700, lastAmt: 175, recv: '9/15/2026' },
      { patient: 'Notreal Placeholder', acct: '99-8991', sts: 'A-Comp Bra', rp: 'INS: Lee Placeholder', home: '', due: 0, b0: 0, b30: 0, b60: 0, b90: 0, days: 0, bal: 450, lastAmt: 150, recv: '9/20/2026' }];
    const groups = [{ line: 'Bayside Dental Plan'.padEnd(53) + '-   (800) 555-0142            ', rows: by.bay }, { line: 'Gulf Dental Group   -   8005550123', rows: by.gulf },
      { line: 'Old Heron Life   -   8005550100', rows: extra }, { line: 'Pelican Coast Dental'.padEnd(53) + '-   (800) 555-0161', rows: by.pel.slice(0, -1) }, { line: 'PELICAN COAST DENTAL', rows: by.pel.slice(-1) }]
      .concat(Object.keys(by.other).sort().map(n => ({ line: n + '   -   (800) 555-0190', rows: by.other[n] })));
    return { groups, n: ins.length + 2, un: un.map(a => a.key), diff: bay[0].key, agree: bay[1].key, nCar: S.book.carriers.length, reps: S.reports.length, tags: Object.keys(S.book.tags).length,
      long: new Date(S.rep.asOf + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) };
  });
  const iaFile = { name: 'in_aging.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(insAgingTSV(IA.long, IA.groups)) };
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  ok(/Insurance Aging/.test(await page.textContent('#view')), 'Reports says Edge’s Insurance Aging can be dropped there too (with how to export it)');
  await page.setInputFiles('#arFile', iaFile); await page.waitForSelector('#iaSave');
  const iaPv = (await page.innerText('#modalWrap')).replace(/\s+/g, ' ');
  ok(/insurance aging/i.test(iaPv) && new RegExp(IA.n + ' insurance accounts in Edge').test(iaPv) && new RegExp((IA.nCar + 2) + ' carriers · 2 new').test(iaPv) && /Edge’s carriers \(7\)/.test(iaPv) && new RegExp((IA.n - 2) + ' of ' + (IA.n - 2) + ' insurance accounts on the .* A/R report with a carrier · ' + IA.un.length + ' getting one now').test(iaPv) && /1 account set by hand is under another carrier in Edge/.test(iaPv) && /never changed/.test(iaPv) && /each matching Edge’s count/.test(iaPv),
    'dropped on Reports: its own preview — ' + IA.n + ' accounts, Edge’s 8 carrier lines as 7 carriers (Pelican’s two lines as one), 2 of them new, every insurance account on the A/R report with a carrier, ' + IA.un.length + ' getting one now, 1 set by hand that Edge has elsewhere');
  ok(!(await S_(() => !!(S.imp && S.imp.files && S.imp.files.length))), 'it isn’t taken for an A/R report');
  await shot(page, 'ia-preview');
  await page.click('#iaSave'); await page.waitForSelector('.iaLine');
  const iaT = await S_(() => ({ view: S.view, tab: S.tab.ins, line: document.querySelector('.iaLine').textContent, untagged: document.querySelectorAll('#untagged .tagRow').length, differ: document.querySelectorAll('#carDiffer .tagRow').length,
    car: S.book.carriers.length, gulf: S.book.carriers.filter(c => /gulf/i.test(c.name)).length, gulfEdge: (S.book.carriers.find(c => c.name === 'Gulf Dental Group') || {}).edge, edge: S.book.edge, tags: Object.keys(S.book.tags).length, reps: S.reports.length }));
  ok(iaT.view === 'ins' && iaT.tab === 'carriers' && /From Edge’s Insurance Aging of/.test(iaT.line) && iaT.untagged === 0 && iaT.differ === 1, 'saved: on to Insurance → Carriers — “From Edge’s Insurance Aging of …”, no account without a carrier, 1 set by hand that Edge has elsewhere');
  ok(iaT.car === IA.nCar + 2 && iaT.gulf === 1 && JSON.stringify(iaT.gulfEdge) === '["Gulf Dental Group"]' && iaT.edge.n === IA.n && iaT.tags === IA.tags && iaT.reps === IA.reps,
    'the carriers already in the list are matched by name (no second Gulf Dental Group), 2 added; the hand-set ones untouched (' + iaT.tags + '); no A/R report added');
  await shot(page, 'ia-carriers', true);
  // an account that had no carrier: Edge's, with Edge's phone
  await page.evaluate(k => openDrawer(k), IA.un[0]); await page.waitForSelector('#drawer .carBox');
  const unBox = await page.$eval('#drawer .carBox', e => ({ sel: e.querySelector('select').selectedOptions[0].textContent, src: (e.querySelector('.carSrc') || {}).textContent || '', tel: (e.querySelector('a[href^="tel:"]') || {}).textContent || '' }));
  ok(unBox.sel === 'Edge: Pelican Coast Dental' && /From Edge’s Insurance Aging of/.test(unBox.src) && /555-0161/.test(unBox.tel), 'its panel: “Edge: Pelican Coast Dental”, Call (800) 555-0161 — ' + unBox.src);
  await shot(page, 'ia-panel');
  await page.click('#drawer [data-act=closeDrawer]');
  // set by hand, Edge has it elsewhere: kept, with Edge's a tap away
  await page.evaluate(k => openDrawer(k), IA.diff); await page.waitForSelector('#drawer .carBox .notice');
  ok(/Set by hand\. Edge’s Insurance Aging .* has this account under Pelican Coast Dental/.test((await page.innerText('#drawer .carBox .notice')).replace(/\s+/g, ' ')) && /Bayside Dental Plan/.test(await page.$eval('#drawer .carBox select', e => e.selectedOptions[0].textContent)),
    'set by hand but under another carrier in Edge: Bayside stays, and the panel says Edge has it under Pelican Coast Dental');
  await page.click('#drawer [data-act=carrierUseEdge]'); await page.waitForTimeout(400);
  ok(await page.evaluate(k => carrierFor(k).name === 'Pelican Coast Dental' && !S.book.tags[k], IA.diff) && await page.$eval('#drawer .carBox', e => /^Edge: /.test(e.querySelector('select').selectedOptions[0].textContent)), '“Use Edge’s”: the hand-set carrier comes off and Edge’s shows');
  await page.click('#drawer [data-act=closeDrawer]');
  ok(await page.evaluate(k => !!S.book.tags[k] && carrierFor(k).name === 'Bayside Dental Plan' && !carrierSrc(S.book, k, S.byKey.get(k)).differs, IA.agree), 'a carrier set by hand that Edge agrees with stays set by hand');
  ok(!(await page.$('#carDiffer')), 'nothing left where Edge and a hand-set carrier disagree');
  // Edge's carriers with nothing past due are in a short list; merging one into another
  ok(await page.$eval('.carRest summary', e => /1 more carrier from Edge/.test(e.textContent)), 'Edge’s carriers with nothing past due or in credit are in a short list (Old Heron Life)');
  await page.click('.carRest summary'); await page.click('.carRest [data-act=carrierEdit]'); await page.waitForSelector('#carMergeInto', { state: 'attached' });
  ok(/In Edge’s Insurance Aging as “Old Heron Life”/.test(await page.textContent('#modalWrap')), 'its form says what Edge calls it');
  const coastal = await S_(() => S.book.carriers.find(c => c.name === 'Coastal Benefits').id);
  await page.click('.mergeBox summary'); await page.selectOption('#carMergeInto', coastal); await page.click('[data-act=carrierMerge]'); await page.click('#cbYes'); await page.waitForTimeout(400);
  ok(await S_(() => !S.book.carriers.some(c => c.name === 'Old Heron Life') && S.book.carriers.find(c => c.name === 'Coastal Benefits').edge.includes('Old Heron Life')), 'Merge into Coastal Benefits: Old Heron Life is gone, and Edge’s name for it now lands on Coastal Benefits');
  // the same file again, from the Carriers tab: nothing new, nothing merged comes back
  const [iaFc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.iaLine [data-act=iaPick]')]);
  await iaFc.setFiles(iaFile); await page.waitForSelector('#iaSave');
  const iaPv2 = (await page.innerText('#modalWrap')).replace(/\s+/g, ' ');
  ok(new RegExp((IA.nCar + 1) + ' carriers').test(iaPv2) && !/carriers · \d+ new/.test(iaPv2) && /0 getting one now/.test(iaPv2), 'imported again (Import a newer one): no new carriers, nothing new to fill in');
  await page.click('#iaSave'); await page.waitForSelector('.iaLine'); await page.waitForTimeout(300);
  ok(await S_(() => !S.book.carriers.some(c => c.name === 'Old Heron Life') && S.book.carriers.length) === IA.nCar + 1 && await page.evaluate(k => carrierFor(k).name === 'Pelican Coast Dental', IA.diff), 'saved again: the merged carrier stays merged, and the account set back to Edge’s stays Edge’s');
  ok(await S_(() => (S.book.edge && S.book.edge.by) === meSid()), 'who imported it is kept');
  await page.click('[data-act=tab][data-t=all]').catch(() => { });

  // ---- Edge's task list: the FC's Edge tasks, each on its account (a made-up list about the demo's accounts, Jamie's in Edge)
  const ET = await S_(() => {
    const t = todayISO(), md = iso => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };
    const plain = s => String(s || '').replace(/^(mr|mrs|ms|dr)\.?\s+/i, ''), words = a => a.patient.trim().split(/\s+/);
    const uses = n => S.accts.filter(x => x.patient === n || plain(rpName(x)) === n).length;
    const fine = a => words(a).length === 2 && words(a).every(w => w.length >= 4) && uses(a.patient) === 1;
    const free = S.accts.filter(a => !a.ins && a.pd > 0 && !itemFor(a.key) && fine(a));
    const worked = S.accts.find(a => !a.ins && a.pd > 0 && fine(a) && (it => !!it && it.state === 'open' && !!it.follow && !!it.stage && !!it.assignee)(itemFor(a.key)));
    const ins = S.accts.find(a => a.ins && a.pd > 0 && !itemFor(a.key) && fine(a));
    // a parent with two or more children on the report, and no account of their own
    const byRp = new Map(); S.accts.filter(a => !a.ins && a.pd > 0).forEach(a => { const r = plain(rpName(a)); if (!byRp.has(r)) byRp.set(r, []); byRp.get(r).push(a); });
    const sib = Array.from(byRp.entries()).find(([r, l]) => l.length >= 2 && r.split(' ').length === 2 && !S.accts.some(x => x.patient === r));
    const [A1, B1, D1] = free, typo = w => w.slice(0, 2) + (w[2] === 'x' ? 'z' : 'x') + w.slice(3), later = addDays(t, 20);
    const tasks = [
      { title: 'LETTERS - ' + A1.patient + ' LETTER RETURNED', due: '9/3/2026', desc: 'Reminder texted to the parent.\nSecond reminder texted; parent asked for a call on Friday.\n\n9/20/2026 letter mailed and emailed.' },
      { title: 'AA MADE - ' + B1.patient, due: '9/14/2026', desc: 'AA MADE: $40.00 every other Friday' },
      { title: 'PT - ' + worked.patient, due: '9/21/2026', desc: 'Call about the balance.' },
      { title: 'PT - ' + typo(words(D1)[0]) + ' ' + words(D1)[1], due: '9/22/2026', desc: 'First name a letter off.' },
      { title: 'INS MetLife Questionnaire ' + ins.patient, due: '9/25/2026', desc: 'Questionnaire sent.' },
      { title: 'LETTERS - ' + sib[0], due: '9/28/2026', desc: 'Named after the parent.' },
      { title: 'PT - Imaginary Nobodyton', due: '9/30/2026', desc: 'Not on the A/R report.' },
      { title: 'LETTERS - ' + A1.patient, due: md(later), desc: 'A second task for the same account.' }];
    return { tasks, K: { A: A1.key, B: B1.key, C: worked.key, D: D1.key, E: ins.key, sib: sib[1].map(a => a.key) }, C0: JSON.parse(JSON.stringify(itemFor(worked.key))), P0f: (it => (it && it.state === 'open' && it.follow) || '')(itemFor(sib[1][0].key)),
      done0: focusDoneToday().size, week0: JSON.stringify(weekActivity()), later, run: md(t) + ' 6:45 AM', me: meSid() };
  });
  const etFile = { name: 'Jamies_task.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(edgeTasksTSV(ET.run, [{ op: 'Jamie', tasks: ET.tasks }])) };
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  ok(/Upcoming and Overdue Tasks/.test(await page.textContent('#view')), 'Reports says Edge’s task list can be dropped there too');
  await page.setInputFiles('#arFile', etFile); await page.waitForSelector('#etSave');
  const etPv = (await page.innerText('#modalWrap')).replace(/\s+/g, ' ');
  ok(/Jamie’s Edge tasks · 8 tasks/i.test(etPv) && /8 tasks read \(Jamie\)/.test(etPv) && /5 ready, on 4 accounts/.test(etPv) && /2 to check/.test(etPv) && /1 not on the .*A\/R report/.test(etPv),
    'dropped on Reports: its own preview — 8 tasks read (Jamie’s), 5 ready on 4 accounts (two on one), 2 to check, 1 not on the A/R report');
  ok(!(await S_(() => !!(S.imp && S.imp.files && S.imp.files.length))), 'it isn’t taken for an A/R report');
  ok(/7 tasks are overdue in Edge/.test(etPv) && /“AA MADE” \(1\)/.test(etPv) && /Assign the accounts to Jamie/.test(etPv) && await page.$eval('#etAssign', e => e.checked) && await page.$eval('#etAA', e => e.checked),
    'the options: overdue ones followed up ' + (await page.$eval('#etOverdue', e => e.selectedOptions[0].textContent)) + ', “AA MADE” → payment plan, assigned to Jamie (the operator in Edge)');
  ok(/Add 5 tasks to 4 accounts/.test(await page.textContent('#etSave')), 'the button: Add 5 tasks to 4 accounts');
  ok(await page.$eval('#etOverdue option[value=spread]', o => /^Spread over the next 2 weeks, oldest first \(about 1 account a day\)$/.test(o.textContent)) && await page.$eval('#etOverdue', e => e.value) === 'today', 'a short list: overdue ones all followed up today; or spread over the next 2 weeks');
  await page.selectOption('#etOverdue', 'spread'); await page.waitForTimeout(100);
  ok(await S_(() => S.etImp.o.overdue) === 'spread' && await page.$eval('#etOverdue', e => e.value) === 'spread', 'spreading them can be chosen');
  await page.selectOption('#etOverdue', 'today'); await page.waitForTimeout(100);
  const longDefault = await S_(() => { const keep = S.etImp, t = addDays(todayISO(), -30), p = { tasks: Array.from({ length: 11 }, (_, i) => ({ op: 'Jamie', title: 'PT - Imaginary Person' + 'abcdefghijk'[i], due: t, cat: '', creator: 'Jamie', desc: '' })), ops: ['Jamie'], check: { ok: true, why: '' } };
    S.etImp = null; edgeTasksPreview(p); const v = S.etImp.o.overdue; S.etImp = keep; document.querySelector('#etBox').innerHTML = etBoxHTML(); return v; });
  ok(longDefault === 'spread', 'a long list (more than 10 overdue): spread by default');
  const etChk = await page.$$eval('#etBox details[open] .etRow', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
  ok(etChk.length === 2 && etChk.some(x => /First name a letter off|the name is spelled differently/.test(x)) && etChk.some(x => /more than one account fits/.test(x) && /Skip it/.test(x)), 'to check: a first name a letter off (a tick), a parent with two children on the report (which one?)');
  await page.check('#etBox input[type=checkbox][data-chg=etPick]'); await page.waitForTimeout(100);
  await page.selectOption('#etBox select[data-chg=etPick]', ET.K.sib[0]); await page.waitForTimeout(100);
  ok(/Add 7 tasks to 6 accounts/.test(await page.textContent('#etSave')), 'ticked and picked: Add 7 tasks to 6 accounts');
  await page.click('#etBox details:not([open]) summary >> nth=0').catch(() => { });
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); await collect(); await shot(page, 'et-preview');
  await page.click('#etSave'); await page.waitForFunction(() => !S.etImp, null, { timeout: 10000 }); await page.waitForTimeout(300);
  ok(await toastHas(/Added 7 tasks to 6 accounts/) && await S_(() => S.view) === 'today', 'saved (sealed): “Added 7 tasks to 6 accounts”, on to Today');
  const ER = await page.evaluate(K => {
    const g = k => JSON.parse(JSON.stringify(itemFor(k) || null)), et = it => (it ? it.log.filter(e => e.k === 'edgetask') : []);
    const A = g(K.A), B = g(K.B), C = g(K.C), D = g(K.D), E = g(K.E), P = g(K.sib[0]), lb = ladFor(S.byKey.get(K.B));
    return { A, B, C, aEt: et(A), n: { B: et(B).length, C: et(C).length, D: et(D).length, E: et(E).length, P: et(P).length, sib2: et(g(K.sib[1])).length },
      follow: { D: D.follow, E: E.follow, P: P.follow }, next: nextOfficeDay(todayISO()), bLad: lb ? lb.paused : '?', done: focusDoneToday().size, week: JSON.stringify(weekActivity()) };
  }, ET.K);
  ok(ER.aEt.length === 2 && JSON.stringify(ER.aEt.map(e => e.date)) === JSON.stringify(['2026-09-03', ET.later]) && ER.aEt.every(e => e.op === 'Jamie' && e.by === ET.me && /^t[0-9a-z]+$/.test(e.et)) && ER.A.follow === ER.next && ER.A.assignee === 'jamie' && ER.A.stage === '',
    'two tasks on one account: an “Edge task” entry each (Jamie’s, with Edge’s due date); the overdue one makes the follow-up ' + ER.A.follow + '; assigned to Jamie');
  ok(/^LETTERS - .* LETTER RETURNED\nReminder texted to the parent\.\nSecond reminder texted; parent asked for a call on Friday\.\n\n9\/20\/2026 letter mailed and emailed\./.test(ER.aEt[0].note), 'the entry keeps the title and Edge’s running description, line breaks and all');
  ok(ER.B.stage === 'plan' && ER.bLad === 'plan' && ER.B.follow === ER.next, '“AA MADE”: the account is on a payment plan — its collections ladder pauses');
  ok(ER.C.follow === ET.C0.follow && ER.C.stage === ET.C0.stage && ER.C.assignee === ET.C0.assignee && ER.n.C === 1 && ER.C.log.length === ET.C0.log.length + 1, 'an account already being worked: the task is added, its follow-up (' + ER.C.follow + '), stage and who has it stay');
  ok(ER.n.D === 1 && ER.n.E === 1 && ER.n.P === 1 && ER.n.sib2 === 0 && ER.follow.D === ER.next && ER.follow.E === ER.next && ER.follow.P === (ET.P0f || ER.next),
    'the ticked one, the insurance task (on the insurance account) and the picked child: one entry each, followed up ' + ER.next + (ET.P0f ? ' (the child’s own follow-up, ' + ET.P0f + ', kept)' : '') + '; the other child untouched');
  ok(ER.done === ET.done0 && ER.week === ET.week0, 'imported tasks aren’t work done: Focus’s “done today” and the week’s who-did-what don’t change');
  await page.evaluate(k => openDrawer(k), ET.K.A); await page.waitForSelector('#drawer .logRow');
  const etLog = await page.$$eval('#drawer .logRow', r => r.map(x => x.innerText));
  ok(etLog.some(x => /Edge task \(Jamie\) · due Sep 3(, 2026)? in Edge/.test(x) && /Reminder texted to the parent\.\nSecond reminder texted/.test(x)), 'its panel: “Edge task (Jamie) · due Sep 3 in Edge”, the description on its own lines');
  await page.waitForFunction(() => S.history != null, null, { timeout: 5000 }).catch(() => { });
  ok(await page.$eval('#drawer', e => /added 2 tasks from Edge/.test(e.textContent)), 'and its history: “added 2 tasks from Edge”');
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); const b = document.querySelector('#logBox'); if (b) b.closest('.sec').scrollIntoView({ block: 'start' }); }); await page.waitForTimeout(100);
  await shot(page, 'et-panel');
  await page.click('#drawer [data-act=closeDrawer]');
  // the same list again: everything is “added before”, nothing to check, nothing to add
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  await page.setInputFiles('#arFile', etFile); await page.waitForSelector('#etSave');
  const etPv2 = (await page.innerText('#modalWrap')).replace(/\s+/g, ' ');
  ok(/7 added before/.test(etPv2) && /0 ready/.test(etPv2) && /0 to check/.test(etPv2) && await page.$eval('#etSave', b => b.disabled), 'the same list again: 7 added before (the ticked and the picked ones too), nothing to check, nothing to add');
  await page.click('#modalWrap [data-act=closeModal]');

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
  ok(/patient accounts past due <b>5\.9%<\/b> \(goal 9%\)/.test(await page.innerHTML('#cfgPrev')), 'the preview shows the patient rate (30+ days) against a 9% goal');
  await page.selectOption('#cfgKpiFrom', '1'); await page.waitForTimeout(100);
  ok(/patient accounts past due <b>8\.1%<\/b> \(goal 9%\)/.test(await page.innerHTML('#cfgPrev')), 'counting from day 1 instead, the preview shows 8.1%');
  await page.click('[data-act=saveCfg]'); await page.waitForTimeout(300);
  const k9 = await S_(() => ({ cfg: [S.cfg.goalPt, S.cfg.kpiFrom], k: kpis(S.rep, S.cfg) }));
  ok(k9.cfg[0] === 9 && k9.cfg[1] === 1 && k9.k.pt.n === 34 && k9.k.pt.ok, 'saved: a 9% goal, counting from day 1 — ' + k9.k.pt.n + ' patient accounts, goal met');
  await page.click('#nav-today'); await page.waitForSelector('.goals .goal');
  ok(await page.$eval('.goals .goal', e => e.classList.contains('ok') && /Goal met/.test(e.textContent) && /34 of 422 active patient accounts past due/.test(e.textContent)), 'Today: the patient gauge turns green, “Goal met” (34 of 422 past due)');
  await page.click('#nav-settings'); await page.waitForSelector('#cfgGoalPt'); await page.waitForTimeout(300);
  await page.click('[data-act=resetCfg]'); await page.click('#cbYes'); await page.waitForTimeout(300);
  ok(await S_(() => S.cfg.goalPt === 4 && S.cfg.goalIns === 4 && S.cfg.kpiFrom === 31), 'back to the usual numbers: 4%, 4%, counted from 31 days');
  await page.fill('#cfgGoalIns', '0'); await page.click('[data-act=saveCfg]'); await page.waitForTimeout(150);
  ok(await toastHas(/between 0\.1% and 100%/) && await S_(() => S.cfg.goalIns === 4), 'a 0% goal is refused');
  await page.fill('#cfgGoalIns', '4'); await page.selectOption('#cfgDue', '4'); await page.click('[data-act=saveCfg]'); await page.waitForTimeout(300);
  ok(await S_(() => S.cfg.dueDay === 4), 'the weekly report can be due Thursdays instead');
  await page.click('#nav-reports'); await page.waitForSelector('#dropZone');
  ok(await page.$eval('.dueOk', e => /This week’s report is in/.test(e.textContent) && /due Thursday/.test(e.textContent)), 'Reports: this week’s is in, and the next one is due Thursday');
  await page.click('#nav-settings'); await page.waitForSelector('#cfgDue'); await page.waitForTimeout(300);
  await page.click('[data-act=resetCfg]'); await page.click('#cbYes'); await page.waitForTimeout(300);
  ok(await S_(() => S.cfg.dueDay === 2), 'back to the usual: due Tuesdays');
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

  // ---- a link opens A/R on one screen (the FC's checklist in CADANCe): once, after signing in; the address loses the #
  {
    const lc = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(lc); // its own storage: a fresh browser, as from CADANCe
    const pl = await lc.newPage(); watch(pl, errs, 'link');
    const open = async h => {
      // a fresh page each time, as a link from CADANCe opens one
      await pl.goto('about:blank'); await pl.goto(URL + h); await pl.click('#lgBtn'); await pl.waitForFunction(() => S.arState === 'ok' && S.rep && !S.renderQ, null, { timeout: 15000 }); await pl.waitForTimeout(150);
      return pl.evaluate(() => ({ view: S.view, focus: S.focus, hash: location.hash, href: location.href, bar: !!document.querySelector('#view .focusHd'), drop: !!document.querySelector('#dropZone'), on: (document.querySelector('.navBtn.on') || {}).id }));
    };
    let r = await open('#reports');
    ok(r.view === 'reports' && r.drop && r.on === 'nav-reports' && r.hash === '' && /nlo-ar\.html\?demo$/.test(r.href), 'nlo-ar.html#reports opens on Reports, and the address loses the # (' + r.href.replace(/^.*\//, '') + ')');
    r = await open('#cr'); ok(r.view === 'cr' && r.on === 'nav-cr', '#cr opens Credits');
    await pl.evaluate(() => localStorage.setItem('nloAR.focus', '0'));
    r = await open('#FOCUS'); ok(r.view === 'today' && r.focus && r.bar, '#focus opens Today in Focus mode' + (r.bar ? '' : ' ' + JSON.stringify(r)));
    ok(await pl.evaluate(() => localStorage.getItem('nloAR.focus')) === '1', '…and stays on, as if Focus mode was tapped');
    await pl.evaluate(() => localStorage.setItem('nloAR.focus', '0'));
    r = await open('#settings'); ok(r.view === 'today' && !r.focus, 'anything else (#settings) opens Today');
    r = await open('#pd'); ok(r.view === 'pd', '#pd opens Past due');
    await pl.click('[data-act=lock] >> nth=0'); await pl.waitForSelector('#loginForm'); await pl.click('#lgBtn'); await pl.waitForFunction(() => S.arState === 'ok' && S.rep, null, { timeout: 15000 });
    ok(await pl.evaluate(() => S.view) === 'today', 'after Lock and signing in again: Today, as usual');
    await lc.close();
  }

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
  await p2.evaluate(() => ACT.obList({ dataset: { day: Array.from(S.obReps.values())[0].day } })); await p2.waitForSelector('#obListBox .obRow');
  await p2.screenshot({ path: path.join(SHOTS, 'phone-ob-list.png'), fullPage: false });
  ok(await p2.$eval('#modalWrap .modal', m => m.getBoundingClientRect().right <= window.innerWidth + 1) && await p2.$$eval('#obListBox .obRow', r => r.every(x => x.scrollWidth <= x.clientWidth + 1)), 'phone: the OrthoBanc list fits');
  await p2.click('#modalWrap [data-act=closeModal]');
  await p2.evaluate(async s => edgeTasksPreview(await readReportFile('t.xls', new TextEncoder().encode(s).buffer)), edgeTasksTSV(ET.run, [{ op: 'Jamie', tasks: ET.tasks }])); await p2.waitForSelector('#etSave');
  await p2.screenshot({ path: path.join(SHOTS, 'phone-et.png'), fullPage: false });
  ok(await p2.$eval('#modalWrap .modal', m => m.getBoundingClientRect().right <= window.innerWidth + 1) && await p2.$$eval('#etBox .etRow, #etBox select', r => r.every(x => x.getBoundingClientRect().right <= window.innerWidth + 1)), 'phone: the task list’s preview fits');
  await p2.click('#modalWrap [data-act=closeModal]');
  await p2.click('#mnav-pd'); await p2.click('#view tbody tr >> nth=0'); await p2.waitForSelector('#drawer .ladNow');
  await p2.screenshot({ path: path.join(SHOTS, 'phone-drawer.png'), fullPage: false });
  ok(await p2.$eval('#drawer', e => e.getBoundingClientRect().width <= window.innerWidth), 'phone: the account panel fits');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ':\n    ' + errs.join('\n    ') : ''));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
