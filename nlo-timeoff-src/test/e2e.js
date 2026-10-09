/* End to end: the real built pages (NLO Cases to set up the office and its people, NLO Time Off) against the Firebase
   emulators (auth 9099, firestore 8080) with the office's whole rules file. Every person and date is made up (the old
   Sheet is test/fixtures/old-sheet.xlsx from make_fixture.js/.py).
   Needs: a static server on :8771 serving nlo-timeoff.html (dist/) next to nlo-cases.html and logo-white.png, then
   NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/e2e.js" */
process.env.TZ = 'America/New_York';
const { chromium } = require('playwright');
const path = require('path');
const { routes, watch, CHROME } = require('./helpers');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8771) + '/';
const CASES = BASE + 'nlo-cases.html?emu', TO = BASE + 'nlo-timeoff.html?emu';
const PROJECT = 'demo-nlo-cases';
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/`;
async function fsDocs(col) { const r = await fetch(FS + col + '?pageSize=2000', { headers: { Authorization: 'Bearer owner' } }); return ((await r.json()).documents || []); }
const fsDoc = async p => { const r = await fetch(FS + p, { headers: { Authorization: 'Bearer owner' } }); return r.ok ? r.json() : null; };
const idOf = d => d.name.split('/').pop();
async function verifyEmail(email) {
  const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const codes = (r.oobCodes || []).filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL');
  if (!codes.length) throw new Error('no verify email for ' + email);
  await fetch(codes[codes.length - 1].oobLink);
}
async function newPage(browser, label, errs, vp, tz) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1360, height: 900 }, timezoneId: tz || 'America/New_York' });
  await routes(ctx); const p = await ctx.newPage(); watch(p, errs, label);
  return p;
}
async function signIn(p, url, user, pw) { await p.goto(url); await p.waitForSelector('#lgUser'); await p.fill('#lgUser', user); await p.fill('#lgPw', pw); await p.click('#lgBtn'); }
async function firstPw(p, pw) { await p.waitForSelector('#firstForm', { timeout: 30000 }); await p.fill('#fpw1', pw); await p.fill('#fpw2', pw); await p.click('#fBtn'); }
async function waitApp(p) { await p.waitForSelector('#app:not(.hidden) .topBar', { timeout: 30000 }); }
const waitSt = (p, st, ms) => p.waitForFunction(st => S.st === st, st, { timeout: ms || 30000 });
const saved = p => p.waitForFunction(() => !B.pending, null, { timeout: 30000 });
async function addPerson(owner, name, username) {
  await owner.click('#nav-admin'); await owner.click('[data-act=addStaff]');
  await owner.fill('#asName', name); await owner.fill('#asUser', username); await owner.click('#asForm button[type=submit]');
  await owner.waitForSelector('.modal .kv', { timeout: 30000 });
  const temp = (await owner.locator('.modal .kv .v').nth(1).textContent()).trim();
  await owner.click('.modal [data-act=closeModal]');
  return temp;
}
const toast = async (p, re) => { for (let i = 0; i < 40; i++) { if (await p.$$eval('.toast', (t, s) => t.some(x => new RegExp(s).test(x.textContent)), re.source)) return true; await sleep(100); } return false; };
const tryIt = (p, fnName, arg) => p.evaluate(([f, a]) => window.__try[f](a).then(() => 'ok', e => e.code || e.message), [fnName, arg]);
/* adversarial attempts, run inside a signed-in page with its own login (the page's CSP forbids eval, so they're named) */
async function arm(p) {
  await p.evaluate(() => {
    window.__try = {
      approve: id => B.saveReq(id, c => { c.decision = { s: 'approved', by: meSid(), at: Date.now(), note: '' }; return { status: 'approved' }; }, { a: 'approve' }),
      cancel: id => B.saveReq(id, () => ({ status: 'cancelled' }), { a: 'cancel' }),
      listReqs: () => FB.db.collection('toReq').get(),
      readHR: sid => FB.doc('toHR/' + sid).get(),
      readDrop: () => FB.db.collection('toDrop').get(),
      readMine: sid => FB.doc('toMine/' + sid).get(),
      outForPending: id => FB.doc('toOut/' + id).set({ v: FB.curV, iv: 'aXY=', ct: 'Y3Q=', at: FB.ts() }),
      putHR: sid => B.putHR(sid, d => { d.hire = '2000-01-01'; }, 'edit'),
      approvePerk: id => B.savePerk(id, c => { c.decision = { s: 'approved', by: meSid(), at: Date.now(), note: '' }; return { status: 'approved' }; }, { a: 'approve' })
    };
  });
}
const nextOffice = (p, from) => p.evaluate(f => nextOfficeDay(addDays(todayISO(), f), S.closed), from);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const errs = [];
  const OWNER_EMAIL = 'dr.test@example.com', OWNER_PW = 'Owner-Pass-123';

  console.log('\n# The office is set up in NLO Cases (the same logins open Time Off)');
  const ownerC = await newPage(browser, 'ownerCases', errs);
  await ownerC.goto(CASES + '#setup'); await ownerC.waitForSelector('#setupForm');
  await ownerC.fill('#suEmail', OWNER_EMAIL); await ownerC.fill('#suPw1', OWNER_PW); await ownerC.fill('#suPw2', OWNER_PW);
  await ownerC.click('#setupForm button[type=submit]'); await ownerC.waitForSelector('#verifyForm', { timeout: 30000 });
  await verifyEmail(OWNER_EMAIL); await ownerC.click('#verifyForm button[type=submit]');
  await ownerC.waitForSelector('#recShow', { timeout: 30000 });
  await ownerC.check('#codeAck'); await ownerC.click('#codeDone'); await waitApp(ownerC);
  const sarahTemp = await addPerson(ownerC, 'Sarah Tester', 'sarah');
  const rileyTemp = await addPerson(ownerC, 'Riley Tester', 'riley');
  const morganTemp = await addPerson(ownerC, 'Morgan Tester', 'morgan');
  // the front desk's notices go out through NLO Cases' email robot: switch them on with a key this test holds
  const desk = await ownerC.evaluate(async () => {
    const pair = await Crypto.newPair(), pub = await Crypto.pubJwk(pair), priv = b64(await Crypto.privBytes(pair));
    const box = 'b' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    await firebase.firestore().doc('meta/inbox').set({ pub, kid: 'k1', senders: [], at: firebase.firestore.FieldValue.serverTimestamp(), notify: { on: true, to: 'frontdesk@example.com', box, pub, names: false } });
    return { priv };
  });
  check(!!desk.priv, 'office set up; Sarah, Riley and Morgan added; the front desk’s emails switched on');

  console.log('\n# Before Dr. A sets it up, Time Off says so');
  const riley = await newPage(browser, 'riley', errs, null, 'America/Los_Angeles'); // on another clock: her days still start at the office's midnight
  await signIn(riley, TO, 'riley', rileyTemp); await firstPw(riley, 'Riley-Pass-2026'); await waitApp(riley); await waitSt(riley, 'notyet');
  check(/isn’t ready yet/.test(await riley.textContent('#view')), 'Riley (first sign-in, from Time Off): “Time Off isn’t ready yet”');

  console.log('\n# Dr. A sets it up');
  const owner = await newPage(browser, 'owner', errs);
  await signIn(owner, TO, OWNER_EMAIL, OWNER_PW); await waitApp(owner); await waitSt(owner, 'setup');
  await owner.click('[data-act=setupTO]'); await waitSt(owner, 'hr');
  const ownerUid = await owner.evaluate(() => FB.uid);
  const keys = await fsDoc('meta/toKeys'), drop = await fsDoc('toDrop/1'), grant = await fsDoc('toAccess/' + ownerUid), esc = await fsDoc('meta/toEscrow'), team = await fsDoc('meta/toTeam'), fk = await fsDoc('meta/toFeedKey');
  check(keys && keys.fields.current.integerValue === '1' && keys.fields.pub.mapValue && drop && grant && esc && fk, 'HR key #1: its public half for everyone, the private half sealed with the key, his copy, the recovery copy, the feed’s key');
  check(team && team.fields.sids.arrayValue.values.map(v => v.stringValue).join() === 'amir' || (team && team.fields.sids.arrayValue.values.length === 1), 'who approves: just Dr. A');
  check(await owner.evaluate(() => S.view) === 'settings', 'it opens Settings (who approves, moving from the old app)');

  console.log('\n# Riley and Sarah open it');
  await riley.click('[data-act=retryOpen]'); await waitSt(riley, 'staff');
  let rp = null; for (let i = 0; i < 50 && !rp; i++) { rp = await fsDoc('toPeople/riley'); if (!rp) await sleep(200); }
  const rm = await fsDoc('members/' + await riley.evaluate(() => FB.uid));
  check(rp && rp.fields.pub.mapValue.fields.x.stringValue === rm.fields.pub.mapValue.fields.x.stringValue, 'Riley’s public key is where the people who approve can seal her copies to it');
  check(/balances aren’t set up yet/.test(await riley.textContent('#view')), 'no balances yet (no HR record)');
  const sarah = await newPage(browser, 'sarah', errs);
  await signIn(sarah, TO, 'sarah', sarahTemp); await firstPw(sarah, 'Sarah-Pass-2026'); await waitApp(sarah); await waitSt(sarah, 'staff');
  check(!(await sarah.$('#side [data-v=appr]')), 'Sarah: staff until she’s given approving');

  console.log('\n# Dr. A: Sarah approves');
  await owner.waitForSelector('#apprBox .accessRow');
  const sarahUid = await sarah.evaluate(() => FB.uid);
  for (let i = 0; i < 60; i++) { await owner.evaluate(() => loadHRPeople()); await sleep(300); if (await owner.evaluate(u => !!(S.hrP && S.hrP.members && S.hrP.members.some(m => m.uid === u && m.pub)), sarahUid)) break; }
  check(/Morgan Tester[\s\S]*sign in once/.test(await owner.textContent('#apprBox')), 'Morgan can’t approve until she has signed in once');
  await owner.click('#apprBox .sw[data-uid="' + sarahUid + '"]'); await owner.click('#cbYes');
  await owner.waitForFunction(u => S.hrP && S.hrP.grants && S.hrP.grants.some(g => g.uid === u) && !S.accessBusy, sarahUid, { timeout: 30000 });
  check(!!(await fsDoc('toAccess/' + sarahUid)), 'her copy of the HR key is saved (sealed to her login)');
  check(await toast(sarah, /You can approve time off now/), 'Sarah’s page says so at once');
  await sarah.click('#side [data-act=lock]'); await sarah.waitForSelector('#lgUser');
  await signIn(sarah, TO, 'sarah', 'Sarah-Pass-2026'); await waitApp(sarah); await waitSt(sarah, 'hr');
  check(!!(await sarah.$('#side [data-v=appr]')) && !(await sarah.$('#side [data-v=settings]')), 'signed in again: Approvals and Team, no Settings');

  console.log('\n# Riley asks for time off');
  await arm(riley); await arm(sarah); await arm(owner);
  const d1 = await nextOffice(riley, 21), d1e = await riley.evaluate(d => addDays(d, 2), d1);
  await riley.click('#side [data-act=nav][data-v=new]'); await riley.waitForSelector('[data-act=fType][data-k=vac]');
  await riley.click('[data-act=fType][data-k=vac]'); await riley.fill('#fStart', d1); await riley.fill('#fEnd', d1e); await riley.dispatchEvent('#fEnd', 'input');
  await riley.fill('#fNote', 'Beach trip with my sister'); await riley.dispatchEvent('#fNote', 'input'); await riley.fill('#fCover', 'Sarah'); await riley.dispatchEvent('#fCover', 'input');
  await riley.click('[data-act=fSend]'); const sent = await toast(riley, /^Sent/); check(sent, 'Sent' + (sent ? '' : ' — ' + await riley.$$eval('.toast', t => t.map(x => x.textContent).join(' | ')))); await saved(riley);
  const reqs1 = await fsDocs('toReq'), rq = reqs1[0], rid = idOf(rq);
  check(reqs1.length === 1 && /^q[0-9a-f]{24}$/.test(rid), 'one request saved');
  check(Object.keys(rq.fields).sort().join() === 'bsid,by,createdAt,hr,me,pub,rev,sid,startMs,status,updatedAt,v', 'in the database: whose, status, revision, the day it starts and two sealed copies — nothing else: ' + Object.keys(rq.fields).sort().join());
  check(!/Beach|sister|vac|Vacation/.test(JSON.stringify(rq)), '…no kind of time off and no notes in plain form');
  check(!!(await fsDoc('toLog/' + rid + '_1')) && !(await fsDoc('toOut/' + rid)), 'its history line is saved; nothing on Who’s out yet');
  await riley.waitForFunction(id => S.reqs.has(id) && S.reqs.get(id).note === 'Beach trip with my sister', rid);
  check(true, 'Riley sees it, opened with her own key');
  check(await tryIt(riley, 'approve', rid) === 'permission-denied', 'Riley approving it herself: refused by the database');
  check(await tryIt(riley, 'listReqs') === 'permission-denied', 'Riley listing everyone’s requests: refused');
  check(await tryIt(riley, 'readDrop') === 'permission-denied' && await tryIt(riley, 'readHR', 'riley') === 'permission-denied', 'the HR key’s private half and HR records: refused');
  check(await tryIt(riley, 'outForPending', rid) === 'permission-denied', 'putting a waiting request on Who’s out: refused');

  // a request sealed by hand with content that makes no sense (bypassing the app): it must not break anyone's screens
  const badId = await riley.evaluate(async () => {
    const id = B.newReqId(), c = { sid: meSid(), start: 5, end: 'x', type: 'vac' }, pk = FB.me.pub;
    const hr = await Crypto.sealJSONTo(FB.hrPub, c, 'toreq:' + id), me = await Crypto.sealJSONTo(pk, c, 'toreqme:' + id), b = FB.db.batch();
    b.set(FB.doc('toReq/' + id), { sid: meSid(), status: 'pending', rev: 1, by: FB.uid, bsid: meSid(), v: FB.hrV, pub: { kty: pk.kty, crv: pk.crv, x: pk.x, y: pk.y }, startMs: Date.now() + 30 * 864e5, hr, me, createdAt: FB.ts(), updatedAt: FB.ts() });
    b.set(FB.doc('toLog/' + id + '_1'), { reqId: id, rev: 1, uid: FB.uid, sid: meSid(), osid: meSid(), a: 'submit', at: FB.ts(), prev: null });
    await b.commit(); return id;
  });
  check(!!(await fsDoc('toReq/' + badId)), '(a request with nonsense inside is written by hand)');

  console.log('\n# Sarah approves it');
  await sarah.waitForFunction(id => S.reqs.has(id) && !S.reqs.get(id).locked, rid, { timeout: 30000 });
  await sarah.click('#side [data-act=nav][data-v=appr]'); await sarah.waitForSelector('.apCard');
  await sarah.waitForFunction(id => S.reqs.has(id), badId, { timeout: 30000 });
  await sarah.evaluate(() => renderView()); await sleep(200);
  check(/Can’t be opened/.test(await sarah.textContent('#view')) && await sarah.$$eval('.apCard', c => c.length) === 1, 'the nonsense one is listed apart (“Can’t be opened”), never counted; the real one is there to decide');
  await sarah.click('[data-act=takeBackBad][data-id="' + badId + '"]'); await sarah.click('#cbYes'); await toast(sarah, /^Taken back/); await saved(sarah);
  check((await fsDoc('toReq/' + badId)).fields.status.stringValue === 'archived', 'Sarah takes it back (its history kept)');
  check(await sarah.evaluate(id => B.archiveUnreadable(id).then(() => 'ok', e => e.code), rid) === 'opens', 'taking back one that opens, as if it couldn’t be: refused (“it opens now”)');
  const card = await sarah.textContent('.apCard');
  check(/Beach trip with my sister/.test(card) && /Covering:/.test(card), 'Sarah sees the kind, the note and who covers (opened with the HR key)');
  const outbox0 = (await fsDocs('outbox')).length;
  await sarah.click('[data-act=approve][data-id="' + rid + '"]'); check(await toast(sarah, /Approved — Riley sees it now/), 'Approved'); await saved(sarah);
  const r2 = await fsDoc('toReq/' + rid), out = await fsDoc('toOut/' + rid);
  check(r2.fields.status.stringValue === 'approved' && r2.fields.rev.integerValue === '2' && !!out && !!(await fsDoc('toLog/' + rid + '_2')), 'approved (revision 2, history kept); on Who’s out');
  check(!/Riley|Beach|vac/.test(JSON.stringify(out)), 'the Who’s-out entry is sealed with the office key (no name, no dates in plain form)');
  const ob = await fsDocs('outbox');
  check(ob.length === outbox0 + 1, 'a note for the front desk is waiting for NLO Cases’ email robot');
  const mail = await owner.evaluate(async ([doc, priv]) => {
    const f = doc.fields, id = doc.name.split('/').pop(), e = f.epk.mapValue.fields;
    const key = await Crypto.importPriv(unb64(priv));
    return JSON.parse(TD.decode(await Crypto.openFrom(key, { epk: { kty: e.kty.stringValue, crv: e.crv.stringValue, x: e.x.stringValue, y: e.y.stringValue }, iv: f.iv.stringValue, ct: f.ct.stringValue }, 'outbox:' + id)));
  }, [ob.find(d => !d.fields.__seen), desk.priv]);
  check(/^Schedule block needed: Riley, /.test(mail.subject) && /Please block the schedule for Riley/.test(mail.text) && !/Beach|sister|vacation/i.test(mail.subject + mail.text), 'the robot can open it: “' + mail.subject + '” — name and days only');
  await riley.waitForFunction(id => S.reqs.get(id).status === 'approved' && S.board.some(o => o.id === id), rid, { timeout: 30000 });
  check(true, 'Riley sees it approved, and on Who’s out');
  check(await sarah.evaluate(() => S.board.length) === 1 && await owner.waitForFunction(() => S.board.length === 1).then(() => true), 'everyone’s Who’s out shows it');

  console.log('\n# Dr. A adds Riley’s HR record');
  const yest = await owner.evaluate(() => addDays(todayISO(), -1));
  await owner.click('#side [data-act=nav][data-v=team]'); await owner.waitForSelector('#view tr[data-sid=riley]');
  await owner.click('#view tr[data-sid=riley]'); await owner.click('#drawer [data-act=editHR]'); await owner.waitForSelector('#hrSave');
  await owner.fill('#hrHire', '2023-03-13'); await owner.fill('#hrDept', 'Clinical'); await owner.fill('#hrAsOf', yest); await owner.fill('#hrVac', '40'); await owner.fill('#hrSick', '10');
  await owner.fill('#hrNotes', 'Private note: wants more Saturdays'); await owner.check('#hrCel'); await owner.click('#hrSave');
  check(await toast(owner, /^Saved/), 'saved'); await saved(owner); await owner.keyboard.press('Escape');
  const hrDoc = await fsDoc('toHR/riley'), mineDoc = await fsDoc('toMine/riley');
  check(hrDoc && mineDoc && !/2023|Clinical|Saturdays/.test(JSON.stringify(hrDoc) + JSON.stringify(mineDoc)), 'her HR record (HR key) and her own copy (sealed to her) — nothing in plain form');
  await riley.waitForFunction(() => S.mine && S.mine.hire === '2023-03-13', null, { timeout: 30000 });
  const rb = await riley.evaluate(() => ({ L: ledgerOf(meSid()), notes: S.mine.notes, dept: S.mine.dept, ben: S.mine.ben }));
  check(rb.L && rb.L.vac >= 40 && rb.notes === undefined && rb.dept === undefined, 'Riley sees her balances at once (vacation ' + (rb.L && rb.L.vac) + ' h) — not Dr. A’s note or department');
  check(rb.ben && rb.ben.celebrate === true && !rb.ben.k401, '…and that she’s enrolled in Celebrate Primary Care (not the 401(k))');
  check(await tryIt(riley, 'readMine', 'riley') === 'ok' && await tryIt(riley, 'readMine', 'sarah') === 'permission-denied', 'her own copy opens; someone else’s is refused');
  check(await tryIt(sarah, 'putHR', 'riley') === 'permission-denied', 'Sarah changing an HR record: refused (Dr. A only)');

  console.log('\n# Riley cancels her approved time off (it hasn’t started)');
  await riley.click('#side [data-act=nav][data-v=mine]'); await riley.click('.reqRow[data-id="' + rid + '"]'); await riley.waitForSelector('#drawer [data-act=cancelReq]');
  await riley.click('#drawer [data-act=cancelReq]'); await riley.click('#cbYes'); check(await toast(riley, /^Cancelled/), 'Cancelled'); await saved(riley);
  check((await fsDoc('toReq/' + rid)).fields.status.stringValue === 'cancelled' && !(await fsDoc('toOut/' + rid)), 'cancelled; off Who’s out');
  check((await fsDocs('outbox')).length === outbox0 + 2, 'the front desk is told the block isn’t needed');
  // time off that has started can't be cancelled by the person
  const yd = await owner.evaluate(() => { let d = addDays(todayISO(), -1); for (let i = 0; i < 10 && !isOfficeDay(d, S.closed); i++) d = addDays(d, -1); return d; });
  const sickId = await owner.evaluate(async d => { const id = B.newReqId(); await B.saveReq(id, c => { Object.assign(c, { type: 'sick', paid: true, start: d, end: d, part: 'full', cover: '', note: '', at: Date.now(), events: [{ a: 'record', by: meSid(), at: Date.now() }], decision: { s: 'approved', by: meSid(), at: Date.now(), note: '' } }); return { status: 'approved' }; }, { create: { sid: 'riley' }, a: 'record' }); return id; }, yd);
  await riley.waitForFunction(id => S.reqs.has(id) && S.reqs.get(id).status === 'approved', sickId, { timeout: 30000 });
  check(true, 'Dr. A records a sick day for Riley (yesterday) — she sees it');
  check(await tryIt(riley, 'cancel', sickId) === 'permission-denied', 'Riley cancelling time off that has started: refused');

  console.log('\n# Nobody decides their own request but Dr. A');
  const d2 = await nextOffice(sarah, 30);
  const sarahReq = await sarah.evaluate(async d => { const id = B.newReqId(); await B.saveReq(id, c => { Object.assign(c, { type: 'personal', paid: true, start: d, end: d, part: 'full', cover: '', note: '', at: Date.now(), events: [{ a: 'submit', by: meSid(), at: Date.now() }] }); return { status: 'pending' }; }, { create: { sid: meSid() }, a: 'submit' }); return id; }, d2);
  await sarah.waitForFunction(id => S.reqs.has(id), sarahReq);
  await sarah.click('#side [data-act=nav][data-v=appr]'); await sarah.waitForSelector('.apCard');
  check(/Your own request — Dr. A decides it/.test(await sarah.textContent('.apCard:has([data-id="' + sarahReq + '"])')), 'Sarah’s own request: “Dr. A decides it”');
  check(await tryIt(sarah, 'approve', sarahReq) === 'permission-denied', 'Sarah approving it anyway: refused by the database');
  await owner.waitForFunction(id => S.reqs.has(id), sarahReq, { timeout: 30000 });
  check(await tryIt(owner, 'approve', sarahReq) === 'ok', 'Dr. A approves it');
  await sarah.waitForFunction(id => S.reqs.get(id) && S.reqs.get(id).status === 'approved', sarahReq, { timeout: 30000 });
  const moved = await sarah.evaluate(id => B.saveReq(id, c => { c.start = addDays(c.start, 7); c.end = c.start; }, { a: 'rekey' }).then(() => 'ok', e => e.code), sarahReq);
  const undone = await sarah.evaluate(id => B.saveReq(id, () => ({ status: 'archived' }), { a: 'takeback' }).then(() => 'ok', e => e.code), sarahReq);
  check(moved === 'permission-denied' && undone === 'permission-denied', 'Sarah can’t move or take back her own approved day (only cancel it before it starts, like anyone)');

  console.log('\n# Scrubs: Riley asks, Sarah approves');
  const pid = await riley.evaluate(async () => { const id = B.newPerkId(), y = Number(todayISO().slice(0, 4)), now = Date.now(), items = [{ color: 'navy', piece: 'set', size: 'M', petite: false }, { color: 'teal', piece: 'top', size: 'M', petite: true }]; await B.savePerk(id, c => { Object.assign(c, { kind: 'scrubs', items, pairs: 2, reason: 'Old ones are worn through', at: now, events: [{ a: 'ask', by: meSid(), at: now }] }); return { status: 'pending' }; }, { create: { sid: meSid(), year: y }, a: 'ask' }); return id; });
  const pd = await fsDoc('toPerk/' + pid);
  check(pd && Object.keys(pd.fields).sort().join() === 'bsid,by,createdAt,hr,me,pub,rev,sid,status,updatedAt,v,year' && !/worn|Old ones/.test(JSON.stringify(pd)), 'Riley asks for 2 pairs: whose, the status and the year in plain form; the reason sealed');
  check(await tryIt(riley, 'approvePerk', pid) === 'permission-denied', 'Riley approving her own: refused by the database');
  await sarah.waitForFunction(id => S.perks.has(id), pid, { timeout: 30000 });
  await sarah.click('#side [data-act=nav][data-v=appr]'); await sarah.waitForSelector('[data-act=approvePerk][data-id="' + pid + '"]');
  check(/Old ones are worn through/.test(await sarah.textContent('.apCard:has([data-id="' + pid + '"])')), 'Sarah sees the reason (opened with the HR key)');
  // NLO Cases' email robot (script v3) sends the front-desk notes from this mailbox: scrubs orders go to Time Off's address
  const deskN = (await fsDoc('meta/inbox')).fields.notify.mapValue.fields, deskBox = deskN.box.stringValue, deskPub = deskN.pub.mapValue.fields, toMail = await fsDoc('meta/toMail');
  check(toMail && toMail.fields.scrubs.stringValue === 'community@thenextlevelorthodontics.com', 'scrubs orders go to community@thenextlevelorthodontics.com unless Dr. A changes it (set when Time Off was set up)');
  // the robot's check-in: its script version, its key, and when it last checked
  const beat = (ver, x, at) => fetch(FS + 'mailbeat/' + deskBox, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { box: { stringValue: 'records@example.com' }, ver: { stringValue: ver }, seen: { integerValue: '0' }, sent: { integerValue: '0' }, err: { stringValue: '' },
    pub: { mapValue: { fields: { kty: { stringValue: 'EC' }, crv: { stringValue: 'P-256' }, x: { stringValue: x }, y: { stringValue: deskPub.y.stringValue } } } }, at: { timestampValue: new Date(at).toISOString() } } }) });
  const mailState = () => sarah.evaluate(() => B.scrubsMailState().then(m => [m.ok, m.ver, m.keyOk, m.fresh].join()));
  await beat('2', deskPub.x.stringValue, Date.now()); const ms1 = await mailState();
  await beat('3', 'AAAA' + deskPub.x.stringValue.slice(4), Date.now()); const ms2 = await mailState();
  await beat('3', deskPub.x.stringValue, Date.now() - 41 * 60000); const ms3 = await mailState();
  check(ms1 === 'false,2,true,true' && ms2 === 'false,3,false,true' && ms3 === 'false,3,true,false', 'no order email while the robot has the old script, has a key NLO Cases hasn’t picked up, or hasn’t checked in for 40 minutes (' + [ms1, ms2, ms3].join(' | ') + ')');
  await beat('3', deskPub.x.stringValue, Date.now());
  check((await mailState()) === 'true,3,true,true', '…and it’s on once the robot has v3, the key NLO Cases seals to, and checked in lately');
  const outP = (await fsDocs('outbox')).length;
  await sarah.click('[data-act=approvePerk][data-id="' + pid + '"]'); check(await toast(sarah, /Approved — Riley sees it now, and the order is on its way/), 'Sarah approves it — the order goes out'); await saved(sarah);
  const obP = await fsDocs('outbox');
  check(obP.length === outP + 1, 'a note for the email robot is waiting');
  const orders = await owner.evaluate(async ([docs, priv]) => {
    const key = await Crypto.importPriv(unb64(priv)), out = [];
    for (const doc of docs) { const f = doc.fields, id = doc.name.split('/').pop(), e = f.epk.mapValue.fields; try { out.push(JSON.parse(TD.decode(await Crypto.openFrom(key, { epk: { kty: e.kty.stringValue, crv: e.crv.stringValue, x: e.x.stringValue, y: e.y.stringValue }, iv: f.iv.stringValue, ct: f.ct.stringValue }, 'outbox:' + id)))); } catch (x) { } }
    return out.filter(m => m.kind === 'scrubs');
  }, [obP, desk.priv]);
  check(orders.length === 1 && orders[0].subject === 'Scrubs order: Riley Tester — 2 pairs' && /Pair 1: Navy · top and bottom · M/.test(orders[0].text) && /Pair 2: Teal · top · M · petite/.test(orders[0].text) && !/worn through/.test(orders[0].text),
    'the robot can open it: “' + (orders[0] || {}).subject + '” — each pair, never the reason');
  check((await fsDoc('toPerk/' + pid)).fields.status.stringValue === 'approved' && (await sarah.evaluate(id => S.perks.get(id).decision.mailed, pid)) === true, '…saved, and the request keeps that the order was emailed');
  await riley.waitForFunction(id => S.perks.get(id) && S.perks.get(id).status === 'approved', pid, { timeout: 30000 });
  check(true, 'Riley sees it approved');

  console.log('\n# The feed for CADANCe and the office calendar');
  await owner.evaluate(() => syncFeed(true)); await saved(owner);
  const feedKey = await owner.evaluate(() => B.feedKeyB64());
  const raw = await (await fetch(FS + 'toFeed/live')).json();   // no sign-in: it can be fetched, but it's sealed
  const feed = await owner.evaluate(async ([doc, k]) => { const key = await Crypto.rawKey(k); return Crypto.openJSON(key, { iv: doc.fields.iv.stringValue, ct: doc.fields.ct.stringValue }, 'tofeed'); }, [raw, feedKey]);
  check(raw.fields && raw.fields.ct && !/Riley|Sarah/.test(JSON.stringify(raw)), 'the feed can be fetched without signing in, but it’s sealed');
  check(feed.timeOff.length === 2 && feed.timeOff.some(o => o.employeeName === 'Riley Tester' && o.start === yd) && feed.timeOff.some(o => o.employeeName === 'Sarah Tester'), 'opened with its key: Riley’s sick day and Sarah’s day off, by name');
  check(!/sick|personal|Beach|"type"|"note"/i.test(JSON.stringify(feed.timeOff)), '…never the kind of time off or notes');
  const fr = await (await fetch(FS + 'toFeed?pageSize=10')).json().catch(() => ({}));
  check(!fr.documents, 'listing the feed collection without signing in: refused');

  console.log('\n# Dr. A turns Sarah off: a new HR key');
  await owner.click('#side [data-act=nav][data-v=settings]'); await owner.waitForSelector('#apprBox .sw[data-uid="' + sarahUid + '"]');
  await owner.waitForFunction(u => S.hrP && S.hrP.grants && S.hrP.grants.some(g => g.uid === u), sarahUid);
  await owner.click('#apprBox .sw[data-uid="' + sarahUid + '"]'); await owner.click('#cbYes');
  check(await toast(owner, /Approving turned off for Sarah/), 'turned off'); await saved(owner);
  const k2 = await fsDoc('meta/toKeys'), reqs2 = await fsDocs('toReq'), hrs2 = await fsDocs('toHR');
  check(k2.fields.current.integerValue === '2' && !(await fsDoc('toAccess/' + sarahUid)), 'HR key #2; her copy is gone');
  check(reqs2.every(d => d.fields.v.integerValue === '2') && hrs2.every(d => d.fields.v.integerValue === '2'), 'every request and HR record sealed again under it (' + reqs2.length + ' + ' + hrs2.length + ')');
  check((await fsDocs('toPerk')).every(d => d.fields.v.integerValue === '2'), '…and the scrubs requests');
  await sarah.waitForSelector('#lgUser', { timeout: 30000 });
  check(/approver access was turned off/i.test(await sarah.textContent('#lockCard')), 'Sarah’s open page locks: “Your approver access was turned off”');
  await signIn(sarah, TO, 'sarah', 'Sarah-Pass-2026'); await waitApp(sarah); await waitSt(sarah, 'staff');
  check(await sarah.evaluate(() => allReqs().every(r => r.sid === 'sarah')), 'signed in again: staff — only her own requests');
  await riley.waitForFunction(id => S.reqs.get(id) && !S.reqs.get(id).locked && S.reqs.get(id).rev >= 4, rid, { timeout: 30000 });
  check(true, 'Riley still opens her (re-sealed) requests');

  console.log('\n# Moving from the old app (a made-up Sheet)');
  await owner.click('#side [data-act=nav][data-v=settings]'); await owner.click('[data-act=nav][data-v=import]'); await owner.waitForSelector('#imFile', { state: 'attached' });
  await owner.setInputFiles('#imFile', path.join(__dirname, 'fixtures', 'old-sheet.xlsx'));
  await owner.waitForSelector('.imPerson', { timeout: 30000 });
  await owner.fill('#imAsOf', '2026-10-08'); await owner.dispatchEvent('#imAsOf', 'change'); await sleep(300);
  const rows = await owner.evaluate(() => S.imp.rows.map(r => r.p.name + '→' + (r.sid || '')));
  check(rows.includes('Riley Example→riley') && rows.includes('Morgan Test→morgan') && rows.includes('Taylor Mock→'), 'names matched to logins (Riley, Morgan; nobody here for the others): ' + rows.join(', '));
  const iR = await owner.evaluate(() => S.imp.rows.findIndex(r => r.sid === 'riley'));
  await owner.check('[data-chg=imReplace][data-i="' + iR + '"]'); await sleep(150);
  // as if an earlier move stopped after its first request: one of Riley's old requests (one the old app took off) is here already
  const pre = await owner.evaluate(async () => {
    const q = (S.imp.data.byName.get(normName('Riley Example')) || []).find(x => x.ded), id = await B.importReqId(q.lid);
    await B.saveReq(id, c => {
      Object.assign(c, { type: q.type, paid: q.paid, start: q.start, end: q.end, part: q.part, cover: '', note: '', at: 0, events: [{ a: 'import', by: meSid(), at: Date.now() }], legacy: { id: q.lid, ded: q.ded, took: null, by: '', type: q.typeRaw, hours: q.hoursStr } });
      if (q.status === 'approved' || q.status === 'denied') c.decision = { s: q.status, by: '', at: 0, note: '' };
      return { status: q.status };
    }, { create: { sid: 'riley' }, fresh: true, a: 'import' });
    return { id, again: await B.importReqId(q.lid), all: S.imp.data.reqs.map(r => r.lid) };
  });
  await owner.waitForFunction(id => S.reqs.has(id), pre.id, { timeout: 30000 });
  check(pre.id === pre.again && /^q[0-9a-f]{24}$/.test(pre.id), '(a move that stopped after one request) — a moved request’s id is the same every time');
  const want = await owner.evaluate(() => { const r = S.imp.rows.find(x => x.sid === 'riley'); return { old: r.audit.old, reqs: impReqCount(S.imp.rows.filter(x => x.sid)), all: S.imp.rows.filter(x => x.sid).reduce((n, x) => n + (S.imp.data.byName.get(normName(x.p.name)) || []).length, 0) }; });
  check(want.reqs === want.all - 1, 'run again, it would move the other ' + want.reqs + ' (the one already here isn’t counted)');
  await owner.click('[data-act=imMove]'); await owner.click('#cbYes');
  await owner.waitForFunction(() => S.imp && S.imp.st === 'done', null, { timeout: 60000 }); await saved(owner);
  const res = await owner.evaluate(() => S.imp.result);
  check(res.people === 2 && res.reqs === want.reqs && !res.failed.length, 'moved: Riley and Morgan, ' + res.reqs + ' requests' + (res.failed.length ? ' — failed: ' + res.failed.join('; ') : ''));
  const rHR = await owner.evaluate(() => S.hrRecs.get('riley').open);
  check(rHR.asOf === '2026-10-08' && rHR.vac === want.old.vac && rHR.sick === want.old.sick, 'Riley starts from the old app’s balance as of Oct 8 (' + rHR.vac + ' h vacation)');
  const rSet = await owner.evaluate(() => S.hrRecs.get('riley').settled || []);
  check(rSet.length === 4 && rSet.includes(pre.id), 'her record lists the 4 requests the old app already took off (so they aren’t taken again) — the one moved earlier too');
  const legacy = (await fsDocs('toReq')).length;
  check(legacy === reqs2.length + res.reqs + 1, 'the requests are in the database (sealed like any other), none twice');
  const ih = await owner.evaluate(([p, r]) => Promise.all([B.importedHere(p, 'riley'), B.importedHere(p, 'morgan'), B.importedHere(r, 'riley')]), [pre.id, rid]);
  check(ih[0] && !ih[1] && !ih[2], 'a request counts as already moved only if the import made it, for the same person');
  const stJSON = JSON.stringify(await fsDoc('meta/settings'));
  check(!/movedIds/.test(stJSON) && pre.all.every(l => !stJSON.includes(l)), 'the office settings (which everyone can read) list nothing from the Sheet');
  const allDocs = JSON.stringify(await fsDocs('toReq')) + JSON.stringify(await fsDocs('toHR')) + JSON.stringify(await fsDocs('toMine')) + JSON.stringify(await fsDocs('toLog'));
  check(!/NOT-A-REAL|Spring trip|Notary|Riley Example|Clinical Assistant/.test(allDocs), 'nothing from the Sheet in plain form — and no password or passcode anywhere');
  await riley.waitForFunction(() => allReqs().filter(r => r.legacy).length === 6 && S.mine && S.mine.open && S.mine.open.asOf === '2026-10-08', null, { timeout: 30000 });
  check(true, 'Riley sees her 6 old requests and her new opening balance, opened with her own key');
  const mDocs = (await fsDocs('toReq')).filter(d => d.fields.sid.stringValue === 'morgan');
  check(mDocs.length === 1 && mDocs.every(d => d.fields.me.nullValue === null || d.fields.me.nullValue !== undefined) && !(await fsDoc('toMine/morgan')), 'Morgan hasn’t signed in yet: her copies wait for her key');

  console.log('\n# Morgan signs in for the first time; Dr. A’s next visit seals her copies to her');
  const morgan = await newPage(browser, 'morgan', errs);
  await signIn(morgan, TO, 'morgan', morganTemp); await firstPw(morgan, 'Morgan-Pass-2026'); await waitApp(morgan); await waitSt(morgan, 'staff');
  check(!!(await fsDoc('toPeople/morgan')), 'her public key is published');
  await owner.reload(); await owner.waitForSelector('#lgUser'); await owner.fill('#lgUser', OWNER_EMAIL); await owner.fill('#lgPw', OWNER_PW); await owner.click('#lgBtn'); await waitApp(owner); await waitSt(owner, 'hr');
  await morgan.waitForFunction(() => S.mine && S.mine.type === 'PT' && allReqs().length === 1 && !allReqs()[0].locked, null, { timeout: 45000 });
  check(true, 'Morgan sees her balance (part-time) and her old request');
  check(/Part-time/.test(await morgan.textContent('#view')), '…“Part-time: no paid vacation” on her Home');

  console.log('\n# A login whose key changes without a reissue loses approving (and can’t be given it again)');
  await owner.click('#side [data-act=nav][data-v=settings]'); await owner.waitForSelector('#apprBox .sw[data-uid="' + sarahUid + '"]');
  await owner.waitForFunction(() => S.hrP && S.hrP.members && !S.accessBusy && !S.rotating, null, { timeout: 30000 });
  await owner.click('#apprBox .sw[data-uid="' + sarahUid + '"]'); await owner.click('#cbYes');
  await owner.waitForFunction(u => S.hrP && S.hrP.grants && S.hrP.grants.some(g => g.uid === u) && !S.accessBusy, sarahUid, { timeout: 30000 });
  check(!!(await fsDoc('toAccess/' + sarahUid)), 'Sarah approves again (a copy sealed to her login’s key)');
  await sarah.context().close();
  const newPub = await owner.evaluate(async () => { const j = await Crypto.pubJwk(await Crypto.newPair()); return { x: j.x, y: j.y }; });
  const sm = await fsDoc('members/' + sarahUid), pf = sm.fields.pub.mapValue.fields;
  pf.x = { stringValue: newPub.x }; pf.y = { stringValue: newPub.y };
  const pr = await fetch(FS + 'members/' + sarahUid + '?updateMask.fieldPaths=pub', { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { pub: sm.fields.pub } }) });
  check(pr.ok, '(her login’s public key is swapped by hand, as if someone changed it without a reissue)');
  await owner.evaluate(() => upkeep());
  check(await toast(owner, /changed its key without a reissue/), 'Dr. A’s next check says so');
  const k3 = await fsDoc('meta/toKeys'), st3 = await fsDoc('meta/settings');
  const kf = st3 && st3.fields.to && st3.fields.to.mapValue.fields.keyFlags;
  check(!(await fsDoc('toAccess/' + sarahUid)) && k3.fields.current.integerValue === '3' && !!(kf && kf.mapValue.fields[sarahUid]), 'her copy is deleted (never sealed to the new key), HR key #3 is made, and the login is marked');
  await owner.evaluate(() => loadHRPeople());
  await owner.waitForFunction(u => S.hrP && S.hrP.grants && !S.hrP.grants.some(g => g.uid === u) && !S.accessBusy && !S.rotating, sarahUid, { timeout: 30000 });
  await owner.click('#apprBox .sw[data-uid="' + sarahUid + '"]'); await owner.click('#cbYes');
  check(await toast(owner, /key changed without a reissue/), 'turning approving on for that login again: refused until it’s reissued in NLO Cases');
  check(!(await fsDoc('toAccess/' + sarahUid)), '…and no copy is made');
  await riley.waitForFunction(id => S.reqs.get(id) && !S.reqs.get(id).locked, rid, { timeout: 30000 });
  check(true, 'Riley still opens her requests under the new key');
  const sOwn = await fsDoc('toReq/' + sarahReq);
  check(sOwn.fields.pub.nullValue !== undefined && sOwn.fields.me.nullValue !== undefined, 'Sarah’s own request, sealed again under the new key: no copy for the changed key');

  console.log('\n# A staff login whose key changes without a reissue: nothing new is sealed to it');
  const morganUid = await morgan.evaluate(() => FB.uid);
  const mReq = idOf((await fsDocs('toReq')).find(d => d.fields.sid.stringValue === 'morgan'));
  const mx0 = (await fsDoc('toReq/' + mReq)).fields.pub.mapValue.fields.x.stringValue, tm0 = (await fsDoc('toMine/morgan')).fields.pubX.stringValue;
  const mPub = await owner.evaluate(async () => { const j = await Crypto.pubJwk(await Crypto.newPair()); return { x: j.x, y: j.y }; });
  const mm = await fsDoc('members/' + morganUid), mf = mm.fields.pub.mapValue.fields;
  mf.x = { stringValue: mPub.x }; mf.y = { stringValue: mPub.y };
  const mr = await fetch(FS + 'members/' + morganUid + '?updateMask.fieldPaths=pub', { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { pub: mm.fields.pub } }) });
  check(mr.ok, '(Morgan’s login’s public key is swapped by hand)');
  await owner.evaluate(() => upkeep());
  check(await toast(owner, /changed its key without a reissue, so nothing new is sealed to it/), 'Dr. A’s next check says so');
  const st4 = await fsDoc('meta/settings'), kf4 = st4.fields.to.mapValue.fields.keyFlags;
  const tp = await fsDoc('toPeople/morgan');
  check(!!(kf4 && kf4.mapValue.fields[morganUid]) && tp.fields.pub.mapValue.fields.x.stringValue === mPub.x, 'the login is marked (its new key is published, as NLO Cases has it)');
  check((await fsDoc('toReq/' + mReq)).fields.pub.mapValue.fields.x.stringValue === mx0 && (await fsDoc('toMine/morgan')).fields.pubX.stringValue === tm0, 'her copies aren’t sealed again to the new key');
  check(await owner.evaluate(id => B.saveReq(id, () => { }, { a: 'rekey' }).then(() => 'ok', e => e.code), mReq) === 'ok', 'Dr. A saves her request again…');
  const mAfter = await fsDoc('toReq/' + mReq);
  check(mAfter.fields.pub.nullValue !== undefined && mAfter.fields.me.nullValue !== undefined, '…and there’s no copy sealed to the changed key');
  await owner.evaluate(() => B.putHR('morgan', d => { d.notes = 'checked'; }, 'edit'));
  check((await fsDoc('toMine/morgan')).fields.pubX.stringValue === tm0, 'her balances copy isn’t sealed to it either');
  const morgan2 = await newPage(browser, 'morgan2', errs);
  await signIn(morgan2, TO, 'morgan', 'Morgan-Pass-2026'); await morgan2.waitForFunction(() => /needs a reset/.test(document.querySelector('#lockCard').textContent), null, { timeout: 30000 }).catch(() => { });
  check(/key was changed outside NLO Cases/.test(await morgan2.textContent('#lockCard')), 'signing in with that login: “Login needs a reset — its key was changed outside NLO Cases”');

  check(!errs.length, 'no page errors' + (errs.length ? ':\n    ' + errs.join('\n    ') : ''));
  await browser.close();
  console.log('\n' + passes.length + ' passed, ' + fails.length + ' failed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
