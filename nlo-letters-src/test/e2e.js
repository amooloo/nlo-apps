/* End to end: the real built pages (NLO Cases for setting up the office, NLO Letters) against the Firebase
   emulators (auth 9099, firestore 8080). Every person, office, number and email is made up.
   Needs: a static server on :8765 serving dist/ (with nlo-cases.html copied in), then
   NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/e2e.js" */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const { routes, watch } = require('./helpers');
const CASES = 'http://127.0.0.1:8765/nlo-cases.html?emu', LETTERS = 'http://127.0.0.1:8765/nlo-letters.html?emu';
const PROJECT = 'demo-nlo-cases';
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fsDump(cols) {
  const out = [];
  for (const col of cols) {
    const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${col}?pageSize=1000`, { headers: { Authorization: 'Bearer owner' } });
    const j = await r.json(); (j.documents || []).forEach(d => out.push(d));
  }
  return out;
}
async function verifyEmail(email) {
  const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const codes = (r.oobCodes || []).filter(c => c.email === email && c.requestType === 'VERIFY_EMAIL');
  await fetch(codes[codes.length - 1].oobLink);
}
async function newPage(browser, label, errs) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  await routes(ctx); const p = await ctx.newPage(); watch(p, errs, label); return p;
}
async function signIn(p, url, user, pw) { await p.goto(url); await p.waitForSelector('#lgUser'); await p.fill('#lgUser', user); await p.fill('#lgPw', pw); await p.click('#lgBtn'); }
const waitApp = p => p.waitForSelector('#app:not(.hidden) .topBar', { timeout: 30000 });
const CSV = 'Type,Last,First,Practice,Address,City/State/Zip,Email,Phone,Edge note\r\n' +
  'Dentist,Sampleton,Jordan,Sampleton Family Dentistry,"100 Example Street, Suite B","Gainesville, FL 32608",office@sampleton.example.com,,\r\n' +
  'Dentist,Sampleton,Jordan,Sampleton Family Dentistry,"100 Example Street, Suite B","Gainesville, FL 32608",office@sampleton.example.com,,\r\n' +
  'Oral Surgery,Mockwell,Casey,Mockwell Oral Surgery,"1 Test Road","Ocala, FL 34471",,(352) 555-0100,\r\n' +
  'Periodontics,Demoson,Riley,Demoson Periodontics,"2 Test Road","Ocala, FL 34471",perio.example.com,,office does not use email\r\n' +
  Array.from({ length: 23 }, (_, i) => `Dentist,Fillerman${i},Pat,Filler Dental ${i},"${i + 10} Filler Street","Gainesville, FL 32607",f${i}@filler.example.com,,`).join('\r\n') + '\r\n';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const errs = []; const OWNER_EMAIL = 'dr.test@example.com', OWNER_PW = 'Owner-Pass-123';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'letters-')); const csvPath = path.join(tmp, 'doctors.csv'); fs.writeFileSync(csvPath, CSV);

  console.log('\n# The office is set up in NLO Cases (same logins)');
  const ownerC = await newPage(browser, 'ownerCases', errs);
  await ownerC.goto(CASES + '#setup'); await ownerC.waitForSelector('#setupForm');
  await ownerC.fill('#suEmail', OWNER_EMAIL); await ownerC.fill('#suPw1', OWNER_PW); await ownerC.fill('#suPw2', OWNER_PW);
  await ownerC.click('#setupForm button[type=submit]'); await ownerC.waitForSelector('#verifyForm', { timeout: 30000 });
  await verifyEmail(OWNER_EMAIL); await ownerC.click('#verifyForm button[type=submit]');
  await ownerC.waitForSelector('#recShow', { timeout: 30000 }); await ownerC.check('#codeAck'); await ownerC.click('#codeDone'); await waitApp(ownerC);
  await ownerC.click('#nav-admin'); await ownerC.click('text=Expand all'); await ownerC.click('[data-act=addStaff]');
  await ownerC.fill('#asName', 'Savannah Tester'); await ownerC.fill('#asUser', 'savannah'); await ownerC.click('#asForm button[type=submit]');
  await ownerC.waitForSelector('.modal .kv', { timeout: 30000 });
  const savTemp = (await ownerC.locator('.modal .kv .v').nth(1).textContent()).trim();
  check(!!savTemp, 'owner set up the office in Cases and added Savannah');

  console.log('\n# Owner: sign in, import the Edge list');
  const owner = await newPage(browser, 'owner', errs);
  await signIn(owner, LETTERS, OWNER_EMAIL, OWNER_PW); await waitApp(owner);
  check(await owner.isVisible('#nav-settings'), 'owner signs in to Letters with the Cases login and sees Settings');
  await owner.click('#nav-doctors'); await owner.waitForSelector('text=No doctors yet');
  await owner.click('[data-act=importDocs]'); await owner.setInputFiles('#impFile', csvPath);
  await owner.waitForSelector('.impNums');
  check((await owner.locator('.impNums b').allTextContents()).join() === '26,0,1,2', 'the import preview counts 26 new, 0 here, 1 repeated, 2 without email');
  await owner.click('#impGo'); await owner.waitForSelector('.tbl tbody tr', { timeout: 30000 });
  await owner.waitForFunction(() => liveDocs().length === 26, null, { timeout: 30000 });
  check(true, '26 doctors imported (27 rows, one repeat)');
  const stored = await fsDump(['refDocs']);
  check(stored.length === 26, '26 sealed records in the database');
  const raw = JSON.stringify(stored);
  check(!/Sampleton|Mockwell|Demoson|Fillerman|example\.com|Test Road|Ocala/i.test(raw), 'nothing readable is stored: no names, offices, addresses or emails');
  check(stored.every(d => Object.keys(d.fields).sort().join() === 'by,createdAt,ct,iv,rev,sid,updatedAt,v'), 'each record holds only the sealed box and who/when');
  await owner.click('[data-act=importDocs]'); await owner.setInputFiles('#impFile', csvPath); await owner.waitForSelector('.impNums');
  check((await owner.locator('.impNums b').allTextContents()).slice(0, 2).join() === '0,26' && await owner.isDisabled('#impGo'), 'importing the same file again finds nothing new');
  await owner.click('.modal [data-act=closeModal]');
  await owner.fill('#q', 'demoson'); await owner.waitForFunction(() => document.querySelectorAll('.tbl tbody tr').length === 1);
  check(await owner.locator('.tbl tbody tr .badge.t-retx').count() === 1, 'a doctor whose Edge email was not an email shows “No email”');

  console.log('\n# Owner: settings change every letter');
  await owner.click('#nav-settings'); await owner.fill('#st-records', 'reports@example.com'); await owner.selectOption('#st-notation', 'fdi');
  await owner.click('#setForm button[type=submit]'); await owner.waitForSelector('.toast:has-text("Saved")');
  const cfgDoc = (await fsDump(['refCfg']))[0];
  check(cfgDoc && !/reports@example\.com/.test(JSON.stringify(cfgDoc)), 'the settings are stored sealed');

  console.log('\n# Savannah: first sign-in from Letters, write an extraction letter');
  const sav = await newPage(browser, 'savannah', errs);
  await signIn(sav, LETTERS, 'savannah', savTemp); await sav.waitForSelector('#firstForm', { timeout: 30000 });
  await sav.fill('#fpw1', 'Savannah-Pass-2026'); await sav.fill('#fpw2', 'Savannah-Pass-2026'); await sav.click('#fBtn'); await waitApp(sav);
  check(!(await sav.isVisible('#nav-settings')), 'staff don’t see Settings');
  await sav.waitForFunction(() => liveDocs().length === 26, null, { timeout: 30000 });
  await sav.click('[data-act=pickLetter][data-id=extraction]');
  check(/Type the patient/.test(await sav.textContent('#probs')), 'an empty letter says what is missing');
  await sav.fill('#ptFirst', 'Avery'); await sav.fill('#ptLast', 'Madeup'); await sav.fill('#ptDob', '2013-04-09');
  await sav.fill('#docQ', 'mockwell'); await sav.click('.docHit');
  check(/No email on file/.test(await sav.textContent('#docPick')), 'a doctor without email is flagged for print/fax');
  for (const t of ['5', '12', 'C']) await sav.click('.tooth[data-id="' + t + '"]');
  await sav.click('.chip[data-k=reason][data-c=crowding]'); await sav.click('.chip[data-k=timing][data-c=before]');
  let paper = await sav.innerText('#paper');
  check(/Dr\. Casey Mockwell\nMockwell Oral Surgery\n1 Test Road\nOcala, FL 34471/.test(paper), 'address block');
  check(/RE: Avery Madeup/.test(paper) && /DOB: 04\/09\/2013/.test(paper) && /Subject: Referral for Extraction Request/.test(paper) && /Dear Dr\. Mockwell,/.test(paper), 'RE, DOB, subject and greeting');
  check(paper.includes('#14 (upper right first premolar), #24 (upper left first premolar) and #53 (primary upper right canine) to relieve crowding.'), 'teeth in order (permanent, then primary) with names, in the office’s numbering (FDI, from Settings)');
  check(paper.includes('reports@example.com') && !paper.includes('records@thenextlevelorthodontics.com'), 'the report address comes from Settings');
  await sav.click('[data-act=notation][data-v=universal]');
  paper = await sav.innerText('#paper');
  check(paper.includes('#5 (upper right first premolar), #12 (upper left first premolar) and #C (primary upper right canine)'), 'switching to 1–32 / A–T rewrites the numbers');
  check(/Ready to print/.test(await sav.textContent('#probs')), 'ready to print');
  await sav.fill('#ltText', (await sav.inputValue('#ltText')) + '\n\nThe family prefers a morning appointment.');
  check((await sav.innerText('#paper')).includes('The family prefers a morning appointment.') && await sav.isVisible('#resetText'), 'typed wording shows on the letter');
  await sav.click('.chip[data-k=reason][data-c=thirds]');
  check((await sav.innerText('#paper')).includes('The family prefers a morning appointment.'), 'clicking a choice after typing doesn’t throw the typing away');
  await sav.click('#resetText');
  check(!(await sav.innerText('#paper')).includes('morning appointment') && (await sav.innerText('#paper')).includes('third molars lack room'), '“Put the suggested wording back” does');
  await sav.click('[data-act=letterhead][data-v=side]');
  check(await sav.locator('#paper .lh-side img').count() === 1, 'letterhead switches');
  await sav.emulateMedia({ media: 'print' });
  const pdf = await sav.pdf({ format: 'Letter', preferCSSPageSize: true }); fs.writeFileSync(path.join(tmp, 'letter.pdf'), pdf);
  check(await sav.isHidden('.formCol') && await sav.isHidden('#side') && await sav.isVisible('#paper'), 'only the letter prints');
  await sav.emulateMedia({ media: 'screen' });
  console.log('    (PDF at ' + path.join(tmp, 'letter.pdf') + ')');

  console.log('\n# Savannah: add and correct doctors; she cannot delete or import');
  await sav.click('[data-act=changeDoc]'); await sav.click('[data-act=newDoc]');
  await sav.fill('#dc-first', 'Quinn'); await sav.fill('#dc-last', 'Brandnew'); await sav.fill('#dc-practice', 'Brandnew Dental'); await sav.fill('#dc-addr1', '5 New Street'); await sav.fill('#dc-city', 'Alachua, FL 32615'); await sav.fill('#dc-email', 'hello@brandnew.example.com');
  await sav.click('#docForm button[type=submit]'); await sav.waitForSelector('.docCard');
  check(/Dr\. Quinn Brandnew/.test(await sav.innerText('#paper')), 'a new doctor is added and used on the letter straight away');
  await owner.click('#nav-doctors'); await owner.fill('#q', 'brandnew');
  await owner.waitForFunction(() => document.querySelectorAll('.tbl tbody tr').length === 1 && /Brandnew/.test(document.querySelector('.tbl tbody tr').textContent), null, { timeout: 15000 });
  check(true, 'the owner’s screen shows Savannah’s new doctor without a refresh');
  await sav.click('#nav-doctors');
  check(!(await sav.isVisible('[data-act=importDocs]')), 'staff don’t see Import');
  await sav.fill('#q', 'sampleton'); await sav.click('.tbl tbody tr');
  check(!(await sav.isVisible('[data-act=delDoc]')), 'staff don’t see Delete');
  await sav.fill('#dc-email', 'new@sampleton.example.com'); await sav.check('#dc-off'); await sav.click('#docForm button[type=submit]');
  await sav.waitForFunction(() => document.querySelectorAll('.tbl tbody tr.click').length === 0, null, { timeout: 15000 });
  check(true, 'a hidden doctor leaves the list');
  await sav.check('[data-chg=showOff]'); await sav.waitForSelector('.tbl tbody tr.offRow');
  check(/new@sampleton\.example\.com/.test(await sav.textContent('.tbl tbody tr.offRow')), 'and comes back with “Show hidden”, with the corrected email');
  const sam = (await fsDump(['refDocs'])).filter(d => d.fields.rev.integerValue === '2');
  check(sam.length === 1 && !/sampleton/i.test(JSON.stringify(sam)), 'the correction is version 2 of that record, still sealed');
  await owner.fill('#q', 'brandnew'); await owner.click('.tbl tbody tr'); await owner.click('[data-act=delDoc]'); await owner.click('#cbYes');
  await owner.waitForFunction(() => liveDocs().length === 26, null, { timeout: 15000 });
  let left = 0; for (let i = 0; i < 40; i++) { left = (await fsDump(['refDocs'])).length; if (left === 26) break; await sleep(250); }
  check(left === 26, 'the owner can delete a doctor');

  console.log('\n# Locking wipes the letter in progress');
  await sav.click('#nav-write');
  check(await sav.inputValue('#ptLast') === 'Madeup', 'the letter is still there while signed in');
  await sav.click('[data-act=lock]'); await sav.waitForSelector('#loginForm');
  check(await sav.evaluate(() => !S.draft.first && !S.draft.last && !S.draft.dob && !document.querySelector('#paper') && !document.body.innerText.includes('Madeup')), 'after Lock the patient’s name is nowhere on the page or in memory');
  check(await sav.evaluate(() => { try { return !JSON.stringify(Object.assign({}, localStorage, sessionStorage)).includes('Madeup'); } catch (e) { return true; } }), 'and was never put in browser storage');
  await signIn(sav, LETTERS, 'savannah', 'Savannah-Pass-2026'); await waitApp(sav);
  check(await sav.isVisible('.ltGrid'), 'signing back in starts with a clean page');

  console.log('\n# Nothing about the patient ever reached the database');
  const everything = JSON.stringify(await fsDump(['refDocs', 'refCfg', 'meta', 'members', 'roster', 'logins', 'cases', 'log']));
  check(!/Madeup|Avery|2013-04-09|04\/09\/2013/.test(everything), 'no patient name or birth date anywhere in Firestore');
  check(errs.length === 0, 'no page errors' + (errs.length ? ' :: ' + errs.slice(0, 5).join(' | ') : ''));

  console.log('\nPASS ' + passes.length + '  FAIL ' + fails.length); fails.forEach(f => console.log('  FAILED: ' + f));
  await browser.close(); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
