/* End to end: the real built pages (NLO Cases to set up the office and its people, NLO A/R) against the Firebase
   emulators (auth 9099, firestore 8080) with the office's real rules. Every person, account and amount is made up
   (the report is test/fixtures/edge-full.xls from make_fixtures.py).
   Needs: a static server on :8767 serving nlo-ar.html (dist/) next to nlo-cases.html and logo-white.png, then
   NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/e2e.js" */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { routes, watch, CHROME, obReportTSV, insAgingTSV, edgeTasksTSV } = require('./helpers');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8767) + '/';
const CASES = BASE + 'nlo-cases.html?emu', AR = BASE + 'nlo-ar.html?emu';
const PROJECT = 'demo-nlo-cases';
const FX = path.join(__dirname, 'fixtures'), EXP = JSON.parse(fs.readFileSync(path.join(FX, 'expected.json'), 'utf8'));
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fsDocs(col) {
  const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${col}?pageSize=2000`, { headers: { Authorization: 'Bearer owner' } });
  return ((await r.json()).documents || []);
}
const fsDoc = async p => { const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${p}`, { headers: { Authorization: 'Bearer owner' } }); return r.ok ? r.json() : null; };
async function verifyEmail(email) {
  const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const codes = (r.oobCodes || []).filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL');
  if (!codes.length) throw new Error('no verify email for ' + email);
  await fetch(codes[codes.length - 1].oobLink);
}
async function newPage(browser, label, errs, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1360, height: 900 } });
  await routes(ctx); const p = await ctx.newPage(); watch(p, errs, label);
  return p;
}
async function signIn(p, url, user, pw) { await p.goto(url); await p.waitForSelector('#lgUser'); await p.fill('#lgUser', user); await p.fill('#lgPw', pw); await p.click('#lgBtn'); }
async function waitApp(p) { await p.waitForSelector('#app:not(.hidden) .topBar', { timeout: 30000 }); }
const arState = p => p.evaluate(() => S.arState);
// every change on this page has reached the database
const settled = p => p.waitForFunction(() => !FB.pending && !Object.keys(S.pend).length, null, { timeout: 30000 });
const waitState = (p, st, ms) => p.waitForFunction(st => S.arState === st, st, { timeout: ms || 30000 });
async function addPerson(owner, name, username) {
  await owner.click('#nav-admin'); await owner.click('[data-act=addStaff]');
  await owner.fill('#asName', name); await owner.fill('#asUser', username); await owner.click('#asForm button[type=submit]');
  await owner.waitForSelector('.modal .kv', { timeout: 30000 });
  const temp = (await owner.locator('.modal .kv .v').nth(1).textContent()).trim();
  await owner.click('.modal [data-act=closeModal]');
  return temp;
}
const itemByName = (p, name) => p.evaluate(n => { const it = Array.from(S.items.values()).find(x => x.name === n); return it ? JSON.parse(JSON.stringify(it)) : null; }, name);
// the page's CSP forbids eval, so each wait is one of these named checks (Playwright passes the name in)
const waitItem = (p, name, test, ms) => p.waitForFunction(([n, t]) => {
  const it = Array.from(S.items.values()).find(x => x.name === n); if (!it) return false;
  return ({
    working1: it.log.length === 1 && it.stage === 'working', log1: it.log.length === 1, log3: it.log.length === 3,
    drAok: !it.drA && it.log.some(e => e.k === 'drA_ok'), paid: it.state === 'done' && it.outcome === 'paid',
    open: it.state === 'open', cleared: it.state === 'done' && it.outcome === 'cleared',
    askSign: it.drA && it.log.some(e => e.k === 'drA_ask' && e.step), signed: !it.drA && it.log.some(e => e.k === 'drA_ok' && e.step), ladSent: it.log.some(e => e.k === 'ladder' && e.step)
  })[t];
}, [name, test], { timeout: ms || 30000 });
async function openAcct(p, name) { await p.evaluate(n => { const a = S.accts.find(x => x.patient === n); openDrawer(a.key); }, name); await p.waitForSelector('#drawer .dHd'); }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const OWNER_EMAIL = 'dr.test@example.com', OWNER_PW = 'Owner-Pass-123';

  console.log('\n# The office is set up in NLO Cases (the same logins open A/R)');
  const ownerC = await newPage(browser, 'ownerCases', errs);
  await ownerC.goto(CASES + '#setup'); await ownerC.waitForSelector('#setupForm');
  await ownerC.fill('#suEmail', OWNER_EMAIL); await ownerC.fill('#suPw1', OWNER_PW); await ownerC.fill('#suPw2', OWNER_PW);
  await ownerC.click('#setupForm button[type=submit]'); await ownerC.waitForSelector('#verifyForm', { timeout: 30000 });
  await verifyEmail(OWNER_EMAIL); await ownerC.click('#verifyForm button[type=submit]');
  await ownerC.waitForSelector('#recShow', { timeout: 30000 });
  const RECOVERY = (await ownerC.textContent('#recShow')).trim();
  await ownerC.check('#codeAck'); await ownerC.click('#codeDone'); await waitApp(ownerC);
  const jamieTemp = await addPerson(ownerC, 'Jamie Tester', 'jamie');
  const taylorTemp = await addPerson(ownerC, 'Taylor Tester', 'taylor');
  await addPerson(ownerC, 'Morgan Tester', 'morgan');
  check(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/.test(RECOVERY), 'office set up; Jamie, Taylor and Morgan added (Morgan never signs in)');

  console.log('\n# Dr. A opens A/R for the first time and sets it up');
  const owner = await newPage(browser, 'owner', errs);
  await signIn(owner, AR, OWNER_EMAIL, OWNER_PW); await waitApp(owner); await waitState(owner, 'setup');
  check(await owner.isVisible('[data-act=setupAR]'), 'A/R asks to be set up (its own key)');
  await owner.click('[data-act=setupAR]'); await waitState(owner, 'ok');
  const ownerUid = await owner.evaluate(() => FB.uid);
  const keys = await fsDoc('meta/arKeys'), grant = await fsDoc('arAccess/' + ownerUid), esc = await fsDoc('meta/arEscrow'), team = await fsDoc('meta/arTeam');
  check(keys && keys.fields.current.integerValue === '1' && grant && grant.fields.ring.mapValue && esc && esc.fields.ring.mapValue, 'A/R key #1 made: his copy sealed to his login, one copy sealed to the recovery code');
  check(team && team.fields.sids.arrayValue.values.length === 1, 'the A/R team list holds only staff ids');
  check(await owner.isVisible('#dropZone'), 'it opens on Reports, ready for the first Edge report');

  console.log('\n# Jamie hasn’t been given A/R: the page and the database both say no');
  const jamie = await newPage(browser, 'jamie', errs);
  await signIn(jamie, AR, 'jamie', jamieTemp); await jamie.waitForSelector('#firstForm', { timeout: 30000 });
  await jamie.fill('#fpw1', 'Jamie-Pass-2026'); await jamie.fill('#fpw2', 'Jamie-Pass-2026'); await jamie.click('#fBtn'); await waitApp(jamie);
  await waitState(jamie, 'none');
  check(/isn’t open to you yet/.test(await jamie.textContent('#view')), 'Jamie (first sign-in from A/R) is told A/R isn’t open to her yet');
  const jRead = await jamie.evaluate(async () => { try { await FB.db.collection('arReports').get(); return 'read'; } catch (e) { return e.code; } });
  check(jRead === 'permission-denied', 'the database refuses her: ' + jRead);
  check(!(await jamie.isVisible('#nav-settings')) && !(await jamie.isVisible('#nav-pd')), 'she sees no lists and no Settings');

  console.log('\n# Dr. A gives Jamie A/R; she presses Check again');
  await owner.click('#nav-settings'); await owner.waitForSelector('#accessBox .accessRow');
  await owner.waitForFunction(() => S.people && S.people.members && S.people.members.length >= 4);
  check(await owner.$eval('#accessBox', e => /Morgan Tester[\s\S]*Needs to sign in once/.test(e.textContent)), 'Morgan can’t be given A/R until she has signed in once');
  const jamieUid = await jamie.evaluate(() => FB.uid);
  await owner.click('#accessBox .sw[data-uid="' + jamieUid + '"]');
  await owner.waitForFunction(u => S.people && S.people.grants && S.people.grants.some(g => g.uid === u) && !S.accessBusy, jamieUid, { timeout: 30000 });
  check(!!(await fsDoc('arAccess/' + jamieUid)), 'Jamie’s copy of the A/R key is saved (sealed to her login)');
  await jamie.click('[data-act=retryOpen]'); await waitState(jamie, 'ok');
  check(await jamie.isVisible('#nav-pd') && !(await jamie.isVisible('#nav-settings')), 'Jamie now has the lists (not Settings)');

  console.log('\n# Jamie imports an older report by pasting from Excel; Dr. A sees it at once');
  // the made-up export, as of 28 Sep, with one more account that will have paid by the next report
  const tsv = fs.readFileSync(path.join(FX, 'edge-full.tsv'), 'utf8').replace('Monday, October 5, 2026', 'Monday, September 28, 2026')
    .split('\r\n').filter(l => !/^\(\d+ Patients\)/.test(l))
    .map(l => /^Edge v/.test(l) ? 'Extra Paidoff\tA-Comp Bra\tPat Paidoff\t\t(352) 555-0188\t\t500.00\t100.00\t100.00\t100.00\t200.00\t\t150\t\t2,500.00\t\t100.00\t5/1/2026\r\n' + l : l).join('\r\n');
  await jamie.click('#nav-reports'); await jamie.waitForSelector('#pasteBox');
  await jamie.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.querySelector('#pasteBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, tsv);
  await jamie.waitForSelector('#impSave');
  check(/As of September 28, 2026/.test(await jamie.textContent('#view')), 'the pasted report is read: as of September 28');
  await jamie.click('#impSave');
  await owner.waitForFunction(() => S.reports.length === 1 && S.rep && S.rep.asOf === '2026-09-28', null, { timeout: 30000 });
  await jamie.waitForFunction(() => S.rep && S.rep.asOf === '2026-09-28', null, { timeout: 30000 });
  check(true, 'saved sealed; both screens show it without reloading');
  // a September 28 report is older than this week's: the weekly report is due (on a Monday) or late, on both screens
  await owner.waitForFunction(() => /^(Late|Due)$/.test(document.querySelector('#nav-reports .cnt').textContent), null, { timeout: 10000 }).catch(() => { });
  const lateO = await owner.evaluate(() => [dueNow().state, document.querySelector('#nav-reports .cnt').textContent]), lateJ = await jamie.evaluate(() => dueNow().state);
  check(lateO[0] !== 'ok' && lateO[1] === (lateO[0] === 'late' ? 'Late' : 'Due') && lateJ === lateO[0], 'this week’s report isn’t in yet: ' + lateO[0] + ' on both screens, and Reports says ' + lateO[1]);
  const nRows = await owner.evaluate(() => S.rep.rows.length);
  check(nRows === EXP.full.rows.filter(r => r.due > 0.004 || r.bal < -0.004).length + 1, 'only the accounts past due or in credit were kept (' + nRows + ')');

  console.log('\n# Nothing readable in the database');
  const arDocs = [].concat(await fsDocs('arReports'), await fsDocs('arReportData'), await fsDocs('arAccess'), [await fsDoc('meta/arEscrow'), await fsDoc('meta/arTeam')]);
  const blob = JSON.stringify(arDocs);
  const leaks = EXP.full.rows.slice(0, 60).map(r => r.patient).concat(['Extra Paidoff', '(352) 555-01', '555-0188', 'A-Comp']).filter(s => blob.includes(s));
  check(leaks.length === 0, 'no patient name, phone or status appears in any A/R document' + (leaks.length ? ': ' + leaks.join(', ') : ''));
  const rIdx = (await fsDocs('arReports'))[0].fields;
  check(Object.keys(rIdx).sort().join(',') === 'asOf,at,n,sid,sum,uid,v', 'a report’s index holds only its date, count, who, and sealed totals: ' + Object.keys(rIdx).sort().join(','));

  console.log('\n# Jamie works an account; Dr. A sees it live, with its history');
  await jamie.click('#nav-pd'); await jamie.waitForSelector('#view tbody tr');
  await openAcct(jamie, 'Extra Paidoff');
  await jamie.fill('#nowNote', 'Mom says she paid online'); await jamie.click('#drawer [data-act=log][data-k=pt_spoke]');
  await waitItem(owner, 'Extra Paidoff', 'working1');
  check(true, 'Dr. A’s screen shows Jamie’s call without reloading');
  const top = await jamie.evaluate(() => list91(S.accts)[0].patient);
  await openAcct(jamie, top); await jamie.click('#drawer [data-act=log][data-k=pt_vm]');
  await waitItem(jamie, top, 'log1'); await settled(jamie);
  const items = await fsDocs('arItems'), logs = await fsDocs('arLog');
  check(items.length === 2 && items.every(d => /^a[0-9A-Za-z_-]{22}$/.test(d.name.split('/').pop())), 'two account records, named by a keyed hash (not the name)');
  check(logs.length === 2 && !JSON.stringify(items.concat(logs)).includes(top) && !JSON.stringify(items.concat(logs)).includes('paid online'), 'every save has its history entry; names and notes are sealed');

  console.log('\n# Both log on the same account at the same moment: both are kept');
  await openAcct(owner, top);
  await Promise.all([
    owner.evaluate(() => { document.querySelector('#nowNote').value = 'owner-note-race'; document.querySelector('#drawer [data-act=log][data-k=note]').click(); }),
    jamie.evaluate(() => { document.querySelector('#nowNote').value = 'jamie-note-race'; document.querySelector('#drawer [data-act=log][data-k=note]').click(); })
  ]);
  await waitItem(owner, top, 'log3'); await waitItem(jamie, top, 'log3');
  const race = await itemByName(owner, top);
  check(race.log.some(e => e.note === 'owner-note-race') && race.log.some(e => e.note === 'jamie-note-race'), 'both notes are in the account (neither overwrote the other)');
  await owner.keyboard.press('Escape');

  console.log('\n# Jamie asks Dr. A; he OKs it; she resolves the account; it stays resolved on both screens');
  await openAcct(jamie, 'Extra Paidoff');
  await jamie.click('#drawer [data-act=askDrA]'); await jamie.fill('#drQ', 'OK to waive the $25 late fee?'); await jamie.click('#drQok');
  await owner.waitForFunction(() => counts().drA === 1, null, { timeout: 30000 });
  check(await owner.evaluate(() => document.title.startsWith('(') || true) && (await owner.evaluate(() => counts().drA)) === 1, 'it’s on Dr. A’s Today');
  await openAcct(owner, 'Extra Paidoff'); await owner.click('#drawer [data-act=drAok]');
  await waitItem(jamie, 'Extra Paidoff', 'drAok');
  check(true, 'Jamie sees his OK');
  await owner.keyboard.press('Escape');
  await jamie.click('#drawer [data-act=resolve]'); await jamie.click('#rsPick .pick[data-o=paid]'); await jamie.click('#rsOk');
  await waitItem(owner, 'Extra Paidoff', 'paid');
  check(true, 'resolved as paid: it leaves the open list but stays on Dr. A’s screen as resolved (not dropped)');
  check(await owner.evaluate(() => workState(S.accts.find(a => a.patient === 'Extra Paidoff').key)) === 'done', 'its row shows Paid');
  // reopen and leave it open, so the next report can clear it
  await jamie.click('#drawer [data-act=reopen]'); await waitItem(owner, 'Extra Paidoff', 'open');
  await jamie.keyboard.press('Escape');

  console.log('\n# The next week’s report (.xls): Extra Paidoff has paid — it shows under Cleared in Edge');
  await owner.click('#nav-reports'); await owner.waitForSelector('#arFile', { state: 'attached' });
  await owner.setInputFiles('#arFile', path.join(FX, 'edge-full.xls')); await owner.waitForSelector('#impSave');
  check(/Matches Edge’s totals/.test(await owner.textContent('#view')) && /Since Sep 28: \d+ newly 91\+, 1 paid/.test(await owner.textContent('#view')), 'preview: adds up to Edge’s totals; 1 paid since Sep 28');
  await owner.click('#impSave');
  await jamie.waitForFunction(() => S.rep && S.rep.asOf === '2026-10-05' && S.prev && S.prev.asOf === '2026-09-28', null, { timeout: 30000 });
  await owner.waitForFunction(() => S.rep && S.rep.asOf === '2026-10-05' && counts().cleared === 1, null, { timeout: 30000 });
  check(true, 'both screens move to October 5; the account Jamie worked shows as cleared');
  const kj = await jamie.evaluate(() => { const k = kpis(S.rep, S.cfg); return k && { pt: [k.pt.n, k.pt.of], ins: k.ins && [k.ins.n, k.ins.of] }; });
  const ko = await owner.evaluate(() => { const k = kpis(S.rep, S.cfg); return k && { pt: [k.pt.n, k.pt.of], ins: k.ins && [k.ins.n, k.ins.of] }; });
  check(kj && kj.pt[1] > 0 && kj.ins && kj.ins[1] > 0 && JSON.stringify(kj) === JSON.stringify(ko), 'the goals are measured from the full report, the same on both screens: ' + JSON.stringify(kj));
  await owner.click('#nav-today'); await owner.click('[data-act=closeCleared]'); await owner.click('#cbYes');
  await waitItem(jamie, 'Extra Paidoff', 'cleared');
  check(true, '“Close all” resolves it as cleared in Edge');

  console.log('\n# The collections ladder: Jamie asks Dr. A to sign a letter, he signs it, she sends it certified');
  const lad = await jamie.evaluate(() => { const a = S.accts.find(x => { const l = ladFor(x); return l && l.due && l.due.dra && l.due.cert && !itemFor(x.key); }); return a && { name: a.patient, step: ladFor(a).due.id, day: ladFor(a).day }; });
  check(!!lad, 'a patient account is at a certified letter Dr. A signs: ' + (lad && lad.step + ', day ' + lad.day));
  await jamie.click('#nav-pd'); await jamie.waitForSelector('[data-act=tab][data-t=lad]');
  check(await jamie.evaluate(() => S.tab.pd === 'lad' && S.lastList.length === ladDueAccts().length && S.lastList.length > 0), 'Past due opens on the steps due');
  await openAcct(jamie, lad.name); await jamie.click('#drawer [data-act=ladAsk]');
  await waitItem(owner, lad.name, 'askSign');
  check((await owner.evaluate(() => counts().drA)) === 1 && /to sign/.test(await owner.evaluate(n => drAText(Array.from(S.items.values()).find(x => x.name === n)), lad.name)), 'it’s on Dr. A’s Today as a letter to sign');
  await openAcct(owner, lad.name); await owner.click('#drawer .drABox [data-act=drAok]');
  await waitItem(jamie, lad.name, 'signed');
  check(await jamie.evaluate(s => { const a = S.accts.find(x => x.patient === s.name); return !!ladFor(a).signed[s.step]; }, lad), 'Jamie sees it signed');
  await owner.keyboard.press('Escape');
  await jamie.click('#drawer [data-act=ladDone]'); await jamie.waitForSelector('#ctNo');
  await jamie.fill('#ctNo', '9407 1112 0000 0000 0000 99'); await jamie.click('#ctOk');
  await waitItem(owner, lad.name, 'ladSent');
  const sent = await owner.evaluate(s => { const a = S.accts.find(x => x.patient === s.name), l = ladFor(a); return { done: !!l.done[s.step], due: l.due && l.due.id, note: l.done[s.step] && l.done[s.step].note }; }, lad);
  check(sent.done && sent.due !== lad.step && /Certified #9407/.test(sent.note || ''), 'sent: Dr. A’s screen shows the step done with its tracking number');
  await settled(jamie);
  const ladBlob = JSON.stringify((await fsDocs('arItems')).concat(await fsDocs('arLog')));
  check(!/FC- #|Certified|9407|drA_ask|ladder/.test(ladBlob), 'the letters, the tracking number and the steps are sealed in the database');
  await jamie.keyboard.press('Escape');

  console.log('\n# Settings: the numbers are shared');
  await owner.click('#nav-settings'); await owner.waitForSelector('#cfgInst');
  await owner.selectOption('#cfgDue', '4'); await owner.fill('#cfgGoalPt', '5'); await owner.click('[data-act=saveCfg]');
  await jamie.waitForFunction(() => S.cfg.dueDay === 4 && S.cfg.goalPt === 5, null, { timeout: 30000 });
  check(true, 'a change to the weekly report’s due day and to the patient goal reaches Jamie’s screen');
  await jamie.click('#nav-today'); await jamie.waitForSelector('.goals .goal');
  check(await jamie.$eval('.goals .goal .gG', e => e.textContent === 'goal ≤ 5%'), 'Jamie’s patient gauge now measures against 5%');

  console.log('\n# Insurance carriers and the OrthoBanc reminder: shared, live, sealed');
  const insKey = await owner.evaluate(() => (S.accts.find(a => a.ins && a.pd > 0) || {}).key);
  check(!!insKey, 'there is an insurance account past due to put a carrier on');
  await owner.click('#nav-ins'); await owner.click('[data-act=tab][data-t=carriers]'); await owner.waitForSelector('[data-act=carrierNew]');
  await owner.click('[data-act=carrierNew]'); await owner.waitForSelector('#carName');
  await owner.fill('#carName', 'Zephyr Test Dental'); await owner.fill('#carPhone', '(800) 555-0188'); await owner.fill('#carPayer', 'ZTD77'); await owner.fill('#carTf', '180'); await owner.click('[data-act=carrierSave]');
  await jamie.waitForFunction(() => S.book && S.book.carriers.some(c => c.name === 'Zephyr Test Dental' && c.tf === 180), null, { timeout: 30000 });
  check(true, 'a carrier Dr. A adds shows on Jamie’s screen');
  const zid = await owner.evaluate(() => S.book.carriers.find(c => c.name === 'Zephyr Test Dental').id);
  await owner.selectOption('.tagRow select[data-key="' + insKey.replace(/"/g, '\\"') + '"]', zid).catch(async () => { await owner.evaluate(([k, id]) => setCarrier(k, id), [insKey, zid]); });
  await jamie.waitForFunction(k => carrierFor(k) && carrierFor(k).name === 'Zephyr Test Dental', insKey, { timeout: 30000 });
  check(true, 'the carrier set on an account reaches Jamie’s screen');
  // the OrthoBanc reminder: due on Jamie's Today until someone marks that report checked
  await jamie.click('#nav-today'); await jamie.waitForSelector('.staleBox.ob', { timeout: 15000 });
  await owner.click('#nav-today'); await owner.waitForSelector('.staleBox.ob [data-act=obCheck]'); await owner.click('.staleBox.ob [data-act=obCheck]');
  await owner.fill('#obN', '1'); await owner.click('[data-act=obSave]');
  await jamie.waitForFunction(() => !document.querySelector('.staleBox.ob'), null, { timeout: 30000 });
  check(true, 'OrthoBanc reminder: Dr. A marks the report checked and it leaves Jamie’s Today');
  // OrthoBanc's report file (made-up), pasted by Jamie on Reports: its own sealed record, live on Dr. A's screen; no account touched
  const obD = await jamie.evaluate(() => {
    const day = obCycle(todayISO()).cur.date, lf = n => { const w = n.split(' '); return w.slice(-1)[0] + ', ' + w.slice(0, -1).join(' '); };
    const pts = S.accts.filter(a => !a.ins && a.pd > 0 && !itemFor(a.key)).slice(0, 2);
    return { day, keys: pts.map(a => a.key), long: new Date(day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      rows: pts.map((a, i) => ({ ref: 'ob9300000' + (i + 1), acct: '3050' + (i + 1), patient: lf(a.patient), rp: lf(rpName(a).replace(/^(mr|mrs|ms|dr)\.?\s+/i, '')), amt: 175, why: 'Credit Card - Declined Insufficient Funds', when: '10/02/2026', bal: 1400 })) };
  });
  const obTsv = obReportTSV(obD.long, [{ ref: 'ob93000009', acct: '30509', patient: 'Zzyzx, Imaginary', rp: 'Zzyzx, Pat', amt: 125, why: 'Credit Card - Declined', when: '10/02/2026', bal: 500 }], obD.rows);
  await jamie.click('#nav-reports'); await jamie.waitForSelector('#pasteBox');
  await jamie.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.querySelector('#pasteBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, obTsv);
  await jamie.waitForSelector('#obSaveImp');
  check(/3 of 3|2 of 3/.test(await jamie.innerText('#modalWrap')) && /1\s+on HOLD/.test(await jamie.innerText('#modalWrap')), 'OrthoBanc’s report pasted on Reports opens its own preview (3 failed payments, 1 on HOLD)');
  await jamie.click('#obSaveImp'); await jamie.waitForSelector('#obListBox .obRow');
  await owner.waitForFunction(d => { const r = obRepFor(d); return r && r.rows.length === 3; }, obD.day, { timeout: 30000 });
  check(true, 'saved sealed; Dr. A’s screen has the list at once');
  await jamie.click('#obListBox .obTick >> nth=0');
  await owner.waitForFunction(d => { const r = obRepFor(d); return r && Object.keys(r.done).length === 1 && obProgress(r).holdLeft === 0; }, obD.day, { timeout: 30000 });
  check(true, 'Jamie ticks the family on HOLD as texted; Dr. A sees it');
  await jamie.click('#modalWrap [data-act=closeModal]');
  check(await jamie.evaluate(keys => keys.every(k => !itemFor(k)), obD.keys), 'importing and ticking added nothing to the accounts on the list');
  // Edge's Insurance Aging (made-up), pasted by Jamie on Reports: every insurance account's carrier, in the sealed carrier book, live on Dr. A's screen
  const iaD = await jamie.evaluate(() => {
    const ins = S.accts.filter(a => a.ins), row = (a, i) => ({ patient: a.patient, acct: '99-' + (9100 + i), sts: a.sts, rp: a.rp, home: a.home, due: a.due, b0: a.b0, b30: a.b30, b60: a.b60, b90: a.b90, days: a.days, bal: a.bal == null ? 0 : a.bal, lastAmt: a.lastAmt, recv: '' });
    return { keys: ins.map(a => a.key), hand: ins.filter(a => S.book && S.book.tags[a.key]).map(a => a.key), long: new Date(S.rep.asOf + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      groups: [{ line: 'Quokka Mutual Dental'.padEnd(53) + '-   (800) 555-0164', rows: ins.map(row) }] };
  });
  await jamie.click('#nav-reports'); await jamie.waitForSelector('#pasteBox');
  await jamie.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.querySelector('#pasteBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, insAgingTSV(iaD.long, iaD.groups));
  await jamie.waitForSelector('#iaSave');
  const iaPv = (await jamie.innerText('#modalWrap')).replace(/\s+/g, ' ');
  check(iaD.hand.length >= 1 && /insurance aging/i.test(iaPv) && /Matches Edge’s totals/.test(iaPv) && new RegExp(iaD.hand.length + ' accounts? set by hand (is|are) under another carrier in Edge').test(iaPv),
    'Edge’s Insurance Aging pasted on Reports opens its own preview (the ' + iaD.hand.length + ' Dr. A set by hand stay as set)' + (/Matches/.test(iaPv) ? '' : ' :: ' + iaPv));
  await jamie.click('#iaSave');
  await owner.waitForFunction(([keys, hand]) => S.book && S.book.edge && keys.every(k => { const a = S.byKey.get(k), s = carrierSrc(S.book, k, a); return hand.includes(k) ? s.hand && s.hand.name === 'Zephyr Test Dental' && s.edge && s.edge.name === 'Quokka Mutual Dental' : s.c && s.c.name === 'Quokka Mutual Dental' && !s.hand; }), [iaD.keys, iaD.hand], { timeout: 30000 });
  check(iaD.hand.includes(insKey), 'saved sealed: Dr. A’s screen has every insurance account’s carrier from Edge at once (' + iaD.keys.length + '), and the ' + iaD.hand.length + ' he set by hand are still his');
  const jSid = await jamie.evaluate(() => meSid());
  check(await owner.evaluate(sid => { const c = S.book.carriers.find(x => x.name === 'Quokka Mutual Dental'); return !!c && c.phone === '(800) 555-0164' && c.edge[0] === 'Quokka Mutual Dental' && S.book.edge.by === sid; }, jSid), 'the carrier came with Edge’s phone number; who imported it is kept');
  // Edge's task list (made-up), pasted by Jamie on Reports: each task on its account, sealed, live on Dr. A's screen
  const etD = await jamie.evaluate(() => {
    const two = a => a.patient.trim().split(/\s+/).length === 2 && S.accts.filter(x => x.patient === a.patient).length === 1;
    const free = S.accts.filter(a => !a.ins && a.pd > 0 && !itemFor(a.key) && two(a)).slice(0, 2);
    return { keys: free.map(a => a.key), tasks: [
      { title: 'LETTERS - ' + free[0].patient + ' LETTER RETURNED', due: '9/3/2026', desc: 'Quillfeather texted the reminder.\nSecond reminder texted.' },
      { title: 'AA MADE - ' + free[1].patient, due: '9/14/2026', desc: 'Quillfeather plan: $40.00 every other Friday' },
      { title: 'PT - Imaginary Nobodyton', due: '9/30/2026', desc: 'Not on the report.' }] };
  });
  await jamie.click('#nav-reports'); await jamie.waitForSelector('#pasteBox');
  await jamie.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.querySelector('#pasteBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, edgeTasksTSV('10/8/2026 6:45 AM', [{ op: 'Jamie', tasks: etD.tasks }]));
  await jamie.waitForSelector('#etSave');
  const etPv = (await jamie.innerText('#modalWrap')).replace(/\s+/g, ' ');
  check(/3 tasks read \(Jamie\)/.test(etPv) && /2 ready, on 2 accounts/.test(etPv) && /1 not on the/.test(etPv) && /Assign the accounts to Jamie/.test(etPv), 'Edge’s task list pasted on Reports opens its own preview (2 ready, 1 not on the report, to be assigned to Jamie)');
  await jamie.click('#etSave');
  await owner.waitForFunction(([keys, sid]) => keys.every(k => { const it = itemFor(k); return !!it && it.log.some(e => e.k === 'edgetask' && e.op === 'Jamie' && /Quillfeather/.test(e.note)) && !!it.follow && it.assignee === sid; }) && itemFor(keys[1]).stage === 'plan', [etD.keys, jSid], { timeout: 30000 });
  check(true, 'saved sealed: Dr. A’s screen has both tasks on their accounts at once — follow-ups set, assigned to Jamie, the “AA MADE” one on a payment plan');
  const bookBlob = JSON.stringify(await fsDocs('arItems')) + JSON.stringify(await fsDocs('arLog'));
  check(!/Zephyr|ZTD77|555-0188|Zzyzx|ob9300000|3050[19]|Insufficient|Quokka|555-0164|99-91\d\d|Quillfeather|LETTER RETURNED|edgetask|Nobodyton/.test(bookBlob), 'the carriers (Edge’s too), the OrthoBanc checks, the imported OrthoBanc list and the imported Edge tasks are sealed in the database');

  console.log('\n# Dr. A turns Jamie off: she’s locked out at once; a new A/R key; everything sealed again');
  await owner.click('#nav-settings'); await owner.waitForSelector('#accessBox .sw[data-uid="' + jamieUid + '"]');
  await owner.click('#accessBox .sw[data-uid="' + jamieUid + '"]'); await owner.click('#cbYes');
  await jamie.waitForSelector('#loginForm', { timeout: 30000 });
  check(/access to A\/R was turned off/.test(await jamie.textContent('#lockCard')), 'Jamie’s screen locks: “Your access to A/R was turned off.”');
  await owner.waitForFunction(() => !S.rotating && !S.accessBusy, null, { timeout: 60000 });
  const k2 = await fsDoc('meta/arKeys');
  const vs = (await fsDocs('arReports')).map(d => d.fields.v.integerValue).concat((await fsDocs('arReportData')).map(d => d.fields.v.integerValue), (await fsDocs('arItems')).map(d => d.fields.v.integerValue));
  check(k2.fields.current.integerValue === '2' && vs.every(v => v === '2'), 'A/R key #2; every report and account record re-sealed under it (' + vs.length + ')');
  check(!(await fsDoc('arAccess/' + jamieUid)), 'her copy of the key is gone');
  await signIn(jamie, AR, 'jamie', 'Jamie-Pass-2026'); await waitApp(jamie); await waitState(jamie, 'none');
  const jRead2 = await jamie.evaluate(async () => { try { await FB.db.collection('arItems').get(); return 'read'; } catch (e) { return e.code; } });
  check(jRead2 === 'permission-denied', 'signing in again: no A/R, and the database refuses her (' + jRead2 + ')');
  const jWrite = await jamie.evaluate(async () => { try { await FB.db.collection('arReports').doc().set({ v: 2, sum: { iv: 'x', ct: 'y' }, asOf: '2026-10-05', n: 0, uid: FB.uid, sid: FB.me.staffId, at: firebase.firestore.FieldValue.serverTimestamp() }); return 'wrote'; } catch (e) { return e.code; } });
  check(jWrite === 'permission-denied', 'and refuses her writes (' + jWrite + ')');
  const jCases = await jamie.evaluate(async () => { try { await FB.db.doc('meta/settings').get(); return 'ok'; } catch (e) { return e.code; } });
  check(jCases === 'ok', 'her login still works for the rest of the office');

  console.log('\n# Taylor, given A/R after the new key, reads everything (including what was saved under key #1)');
  const taylor = await newPage(browser, 'taylor', errs);
  await signIn(taylor, CASES, 'taylor', taylorTemp); await taylor.waitForSelector('#firstForm', { timeout: 30000 });
  await taylor.fill('#fpw1', 'Taylor-Pass-2026'); await taylor.fill('#fpw2', 'Taylor-Pass-2026'); await taylor.click('#fBtn'); await waitApp(taylor);
  const taylorUid1 = await taylor.evaluate(() => FB.uid);
  await owner.click('#nav-today'); await owner.click('#nav-settings'); await owner.waitForSelector('#accessBox .sw[data-uid="' + taylorUid1 + '"]:not([disabled])', { timeout: 30000 });
  await owner.click('#accessBox .sw[data-uid="' + taylorUid1 + '"]');
  await owner.waitForFunction(u => S.people && S.people.grants && S.people.grants.some(g => g.uid === u) && !S.accessBusy, taylorUid1, { timeout: 30000 });
  await signIn(taylor, AR, 'taylor', 'Taylor-Pass-2026'); await waitApp(taylor); await waitState(taylor, 'ok');
  await taylor.waitForFunction(() => S.rep && S.rep.asOf === '2026-10-05' && S.prev, null, { timeout: 30000 });
  await taylor.waitForFunction(() => S.doneLoaded && Array.from(S.items.values()).some(it => it.name === 'Extra Paidoff' && it.state === 'done'), null, { timeout: 30000 });
  check((await itemByName(taylor, top)).log.length === 3, 'Taylor reads the reports and the notes (including resolved accounts)');
  await taylor.waitForFunction(d => { const r = obRepFor(d); return r && r.rows.length === 3 && Object.keys(r.done).length === 1; }, obD.day, { timeout: 30000 });
  check(true, 'and the imported OrthoBanc list, with its tick (it was re-sealed under the new key too)');
  const versions = await owner.evaluate(async n => { const it = Array.from(S.items.values()).find(x => x.name === n); return (await B.itemVersions(it.id)).map(v => !!v.data); }, top);
  check(versions.length >= 3 && versions.every(Boolean), 'every earlier version of an account still opens after the key change (' + versions.length + ')');

  console.log('\n# Taylor’s login is reissued in NLO Cases: Dr. A turns A/R on for the new login');
  await ownerC.click('#nav-admin'); await ownerC.click('[data-act=reissue][data-sid=taylor]'); await ownerC.click('#cbYes');
  await ownerC.waitForSelector('.modal .kv', { timeout: 30000 });
  const taylorTemp2 = (await ownerC.locator('.modal .kv .v').nth(1).textContent()).trim(); await ownerC.click('.modal [data-act=closeModal]');
  await taylor.waitForSelector('#loginForm', { timeout: 30000 });
  check(true, 'Taylor’s open A/R locks when her old login is turned off');
  await signIn(taylor, AR, 'taylor', taylorTemp2); await taylor.waitForSelector('#firstForm', { timeout: 30000 });
  await taylor.fill('#fpw1', 'Taylor-Pass-2027'); await taylor.fill('#fpw2', 'Taylor-Pass-2027'); await taylor.click('#fBtn'); await waitApp(taylor);
  await waitState(taylor, 'none');
  check(true, 'her new login doesn’t have A/R by itself (a new login with that username could be someone new)');
  await owner.evaluate(() => ownerUpkeep());
  check(!(await fsDoc('arAccess/' + taylorUid1)) && (await fsDoc('meta/arKeys')).fields.current.integerValue === '3', 'when Dr. A opens A/R, the old login’s copy is deleted and A/R key #3 is made');
  check(await owner.$$eval('.toast', t => t.some(x => /Taylor Tester has a new login/.test(x.textContent))), 'and he’s told Taylor has a new login');
  const taylorUid2 = await taylor.evaluate(() => FB.uid);
  await owner.click('#nav-today'); await owner.click('#nav-settings'); await owner.waitForSelector('#accessBox .sw[data-uid="' + taylorUid2 + '"]:not([disabled])', { timeout: 30000 });
  await owner.click('#accessBox .sw[data-uid="' + taylorUid2 + '"]');
  await owner.waitForFunction(u => S.people && S.people.grants && S.people.grants.some(g => g.uid === u) && !S.accessBusy, taylorUid2, { timeout: 30000 });
  await taylor.click('[data-act=retryOpen]'); await waitState(taylor, 'ok');
  await taylor.waitForFunction(() => S.rep && S.rep.asOf === '2026-10-05', null, { timeout: 30000 });
  check(true, 'he turns A/R on for her new login; she presses Check again and reads everything');

  console.log('\n# Dr. A forgets his password: reset, recovery code — A/R opens again');
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ localId: ownerUid, password: 'Owner-Reset-999' }) });
  check(r.ok, 'password reset (emulator)');
  await owner.click('#side [data-act=lock]');
  await signIn(owner, AR, OWNER_EMAIL, 'Owner-Reset-999'); await owner.waitForSelector('#recForm', { timeout: 30000 });
  await owner.fill('#recCode', RECOVERY.toLowerCase().replace(/-/g, ' ')); await owner.click('#recForm button[type=submit]');
  await waitApp(owner); await waitState(owner, 'ok', 60000);
  await owner.waitForFunction(() => S.rep && S.rep.asOf === '2026-10-05', null, { timeout: 30000 });
  check(true, 'his A/R key came back from the recovery copy (no data lost)');

  console.log('\n# Removing someone in NLO Cases takes A/R off them and makes a new A/R key');
  await ownerC.goto(CASES); await ownerC.waitForSelector('#lgUser'); await ownerC.fill('#lgUser', OWNER_EMAIL); await ownerC.fill('#lgPw', 'Owner-Reset-999'); await ownerC.click('#lgBtn'); await waitApp(ownerC);
  await ownerC.click('#nav-admin'); await ownerC.click('[data-act=removeStaff][data-sid=taylor]'); await ownerC.click('#cbYes');
  await taylor.waitForSelector('#loginForm', { timeout: 30000 });
  check(true, 'Taylor’s A/R locks at once');
  await owner.evaluate(() => ownerUpkeep());
  check((await fsDoc('meta/arKeys')).fields.current.integerValue === '4' && !(await fsDoc('arAccess/' + taylorUid2)), 'when Dr. A opens A/R, her copy is deleted and A/R key #4 made');
  check(await owner.$$eval('.toast', t => t.some(x => /A\/R taken off Taylor Tester/.test(x.textContent))), 'and he’s told');

  console.log('\n# Two of Dr. A’s screens change the key at the same moment: one waits its turn, nothing is lost');
  const owner2 = await newPage(browser, 'owner2', errs);
  await signIn(owner2, AR, OWNER_EMAIL, 'Owner-Reset-999'); await waitApp(owner2); await waitState(owner2, 'ok');
  await owner2.waitForFunction(() => S.rep && S.rep.asOf === '2026-10-05', null, { timeout: 30000 });
  const vBefore = Number((await fsDoc('meta/arKeys')).fields.current.integerValue);
  // one screen is in the middle of a key change; the other tries to start one (once the key change before has let go of its lock)
  for (let i = 0; i < 60 && await fsDoc('meta/arKeyLock'); i++) await sleep(250);
  const hold = owner.evaluate(() => B.withKeyLock(() => new Promise(r => setTimeout(r, 2500))));
  await sleep(600);
  const r2 = await owner2.evaluate(async () => { try { await B.arRotate(); return 'ok'; } catch (e) { return e.code || e.message; } });
  await hold;
  check(r2 === 'busy', 'while one screen changes the key, the other is told to try again (' + r2 + ')');
  // both at the very same moment, for real: however they land, the result is consistent
  const res2 = await Promise.all([owner, owner2].map(p => p.evaluate(async () => { try { await B.arRotate(); return 'ok'; } catch (e) { return e.code || e.message; } })));
  const vAfter = Number((await fsDoc('meta/arKeys')).fields.current.integerValue), escv = Number((await fsDoc('meta/arEscrow')).fields.ringV.integerValue);
  const gv = (await fsDocs('arAccess')).map(d => Number(d.fields.ringV.integerValue));
  check(res2.every(r => r === 'ok' || r === 'busy') && vAfter === vBefore + res2.filter(r => r === 'ok').length, 'two at once: ' + res2.join(', ') + ' → key #' + vBefore + ' → #' + vAfter);
  check(escv === vAfter && gv.length > 0 && gv.every(v => v === vAfter), 'every copy of the key and the recovery copy are for the newest key (' + gv.join(',') + ' / recovery ' + escv + ')');
  let lockGone = false; for (let i = 0; i < 40 && !lockGone; i++) { lockGone = !(await fsDoc('meta/arKeyLock')); if (!lockGone) await sleep(250); } // (a screen's own check may still be finishing)
  check(lockGone, 'the lock is let go');
  for (const p of [owner, owner2]) await p.evaluate(() => B.arReload());
  const readable = await owner2.evaluate(async () => { let n = 0; for (const r of S.reports) { try { await B.loadReport(r.id); n++; } catch (e) { } } return n + '/' + S.reports.length; });
  check(/^(\d+)\/\1$/.test(readable), 'every report still opens (' + readable + ')');

  console.log('\n# The tour: offered once on Today; it opens a practice copy in its own tab');
  await owner.click('#nav-today'); await owner.waitForSelector('#tourOffer', { timeout: 15000 });
  check(/New to NLO A\/R\?/.test(await owner.textContent('#tourOffer')), 'Dr. A’s Today offers the hands-on tour');
  const [prac] = await Promise.all([owner.context().waitForEvent('page'), owner.click('#tourOffer [data-act=tourOpen]')]);
  await prac.waitForFunction(() => typeof TOUR !== 'undefined' && TOUR.on, null, { timeout: 20000 });
  check(/nlo-ar\.html\?demo&tour=owner$/.test(prac.url()) && await prac.evaluate(() => S.demo && B === DEMO && B.me.name === 'Dr. Akhavan' && S.accts.length > 0), 'Start the tour opens the practice copy (made-up accounts) in its own tab, as Dr. A');
  await owner.waitForTimeout(300);
  check(!(await owner.$('#tourOffer')) && await owner.evaluate(() => S.inApp && !S.demo && S.arState === 'ok'), 'his real A/R stays open, and the offer is put away');
  await prac.close();
  await owner.click('#nav-account'); await owner.waitForSelector('[data-act=tourOpen]');
  check(/Take the tour/.test(await owner.textContent('[data-act=tourOpen]')), 'My account: Take the tour, any time');
  await owner.click('#nav-today');

  console.log('\n# Another page can’t hold A/R in a frame');
  const framer = await newPage(browser, 'framer', errs);
  await framer.goto(BASE + 'logo-white.png');
  await framer.evaluate(() => { const f = document.createElement('iframe'); f.src = 'nlo-ar.html?emu'; document.body.appendChild(f); });
  await framer.waitForTimeout(1500);
  const inFrame = await framer.frames()[1].textContent('body');
  check(/opens in its own tab/.test(inFrame) && !/Sign in/.test(inFrame), 'inside a frame it only says it opens in its own tab');

  const unexpected = errs.filter(e => !/permission|insufficient permissions|Failed to load resource|net::ERR|status of 40[03]/i.test(e));
  check(unexpected.length === 0, 'no unexpected page errors' + (unexpected.length ? ':\n    ' + unexpected.slice(0, 8).join('\n    ') : ''));
  await browser.close();
  console.log('\n' + passes.length + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
