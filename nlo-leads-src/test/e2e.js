/* End to end: the real built pages (NLO Cases for setting up the office, NLO Leads), the Firebase emulators
   (auth 9099, firestore 8080) and the receiving service running locally on :8090, posting the way the
   website's form does. Every person, number and email is made up.
   Needs: a static server on :8765 serving dist/ (with nlo-cases.html copied in), then
   NO_PROXY=localhost,127.0.0.1 npx firebase emulators:exec --only firestore,auth --project demo-nlo-cases "node test/e2e.js" */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { routes, watch } = require('./helpers');
const CASES = 'http://127.0.0.1:8765/nlo-cases.html?emu', LEADS = 'http://127.0.0.1:8765/nlo-leads.html?emu';
const FN = 'http://127.0.0.1:8090/';
const PROJECT = 'demo-nlo-cases';
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let SECTION = ''; const _log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('\n# ')) SECTION = a[0].trim(); _log(...a); };
const forbidden = [];
const enc = o => Object.keys(o).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
/* what Elementor Pro's Webhook action posts (Advanced Data on) */
function elementor(f) {
  const o = { 'form[id]': 'a1b2c3d', 'form[name]': 'Request an Appointment' };
  [['name', 'Patient Name', 'text', f.name], ['field_2', 'Parent Name', 'text', f.parent || ''], ['email', 'Email', 'email', f.email || ''], ['field_4', 'Phone', 'tel', f.phone || ''], ['message', 'Message', 'textarea', f.message || '']]
    .forEach(([id, title, type, v]) => { o['fields[' + id + '][id]'] = id; o['fields[' + id + '][type]'] = type; o['fields[' + id + '][title]'] = title; o['fields[' + id + '][value]'] = v; o['fields[' + id + '][raw_value]'] = v; });
  Object.assign(o, { 'meta[date][title]': 'Date', 'meta[date][value]': 'October 2, 2026', 'meta[page_url][title]': 'Page URL', 'meta[page_url][value]': 'https://thenextlevelorthodontics.com/request-an-appointment/', 'meta[remote_ip][title]': 'Remote IP', 'meta[remote_ip][value]': '198.51.100.23' });
  return enc(o);
}
async function post(url, body, ctype) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': ctype || 'application/x-www-form-urlencoded' }, body }); return r.status; }
    catch (e) { console.log('    (post retry: ' + ((e.cause && (e.cause.code || e.cause.message)) || e.message) + ')'); if (i >= 2) throw e; await sleep(500); }
  }
}
async function fsDump(cols) {
  const out = [];
  for (const col of cols || ['leads', 'leadLog', 'leadInbox', 'meta', 'members', 'roster', 'logins', 'cases', 'log']) {
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
  p.on('console', m => { if (/filed this website request first/.test(m.text())) global.__raced = (global.__raced || 0) + 1; });
  return p;
}
async function signIn(p, url, user, pw) { await p.goto(url); await p.waitForSelector('#lgUser'); await p.fill('#lgUser', user); await p.fill('#lgPw', pw); await p.click('#lgBtn'); }
async function waitApp(p) { await p.waitForSelector('#app:not(.hidden) .topBar', { timeout: 30000 }); }
async function addPerson(owner, name, username) {
  await owner.click('#nav-admin'); await owner.click('[data-act=addStaff]');
  await owner.fill('#asName', name); await owner.fill('#asUser', username); await owner.click('#asForm button[type=submit]');
  await owner.waitForSelector('.modal .kv', { timeout: 30000 });
  const temp = (await owner.locator('.modal .kv .v').nth(1).textContent()).trim();
  await owner.click('.modal [data-act=closeModal]');
  return temp;
}
const leadsNamed = (p, n) => p.evaluate(n => openLeads().filter(l => leadName(l) === n).length, n);
const waitLead = (p, n, ms) => p.waitForFunction(n => openLeads().some(l => leadName(l) === n), n, { timeout: ms || 30000 });
const leadOf = (p, n) => p.evaluate(n => { const l = Array.from(S.leads.values()).concat(S.closed || []).find(l => leadName(l) === n); return l && JSON.parse(JSON.stringify(l)); }, n);

(async () => {
  // the receiving service, running locally against the emulator (as Cloud Run runs it)
  const fnProc = spawn(process.execPath, [path.join(__dirname, '..', 'intake', 'server.js')],
    { env: Object.assign({}, process.env, { PORT: '8090', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GOOGLE_CLOUD_PROJECT: PROJECT, INTAKE_CACHE_MS: '500' }), stdio: ['ignore', 'pipe', 'pipe'] });
  global.__fnProc = fnProc; process.on('exit', () => { try { fnProc.kill(); } catch (e) { } });
  let fnLog = ''; global.__fnLog = () => fnLog; fnProc.stdout.on('data', d => { fnLog += d; }); fnProc.stderr.on('data', d => { fnLog += d; }); fnProc.on('exit', c => { if (c) console.log('    (receiving service stopped: exit ' + c + ')'); });
  for (let i = 0; i < 60; i++) { try { await fetch(FN); break; } catch (e) { await sleep(250); } }
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const OWNER_EMAIL = 'dr.test@example.com', OWNER_PW = 'Owner-Pass-123';

  console.log('\n# The office is set up in NLO Cases (same logins)');
  const ownerC = await newPage(browser, 'ownerCases', errs);
  await ownerC.goto(CASES + '#setup'); await ownerC.waitForSelector('#setupForm');
  await ownerC.fill('#suEmail', OWNER_EMAIL); await ownerC.fill('#suPw1', OWNER_PW); await ownerC.fill('#suPw2', OWNER_PW);
  await ownerC.click('#setupForm button[type=submit]'); await ownerC.waitForSelector('#verifyForm', { timeout: 30000 });
  await verifyEmail(OWNER_EMAIL); await ownerC.click('#verifyForm button[type=submit]');
  await ownerC.waitForSelector('#recShow', { timeout: 30000 }); await ownerC.check('#codeAck'); await ownerC.click('#codeDone'); await waitApp(ownerC);
  const savTemp = await addPerson(ownerC, 'Savannah Tester', 'savannah');
  const gwenTemp = await addPerson(ownerC, 'Gwen Tester', 'gwen');
  check(true, 'owner set up the office and added Savannah and Gwen');

  console.log('\n# Signing in to NLO Leads');
  const owner = await newPage(browser, 'owner', errs);
  await signIn(owner, LEADS, OWNER_EMAIL, OWNER_PW); await waitApp(owner);
  check(await owner.isVisible('#nav-settings'), 'owner signs in to Leads with the same login and sees Settings');
  const sav = await newPage(browser, 'savannah', errs);
  await signIn(sav, LEADS, 'savannah', savTemp); await sav.waitForSelector('#firstForm', { timeout: 30000 });
  await sav.fill('#fpw1', 'Savannah-Pass-2026'); await sav.fill('#fpw2', 'Savannah-Pass-2026'); await sav.click('#fBtn'); await waitApp(sav);
  check(!(await sav.isVisible('#nav-settings')), 'Savannah’s first sign-in works from Leads; staff don’t see Settings');
  const gwen = await newPage(browser, 'gwen', errs);
  await signIn(gwen, CASES, 'gwen', gwenTemp); await gwen.waitForSelector('#firstForm', { timeout: 30000 });
  await gwen.fill('#fpw1', 'Gwen-Pass-2026'); await gwen.fill('#fpw2', 'Gwen-Pass-2026'); await gwen.click('#fBtn'); await waitApp(gwen);
  await signIn(gwen, LEADS, 'gwen', 'Gwen-Pass-2026'); await waitApp(gwen);
  check(true, 'Gwen (set up in Cases) signs in to Leads with the same password');

  console.log('\n# Before the feed exists, a website post stores nothing');
  check(await post(FN + '?k=anything', elementor({ name: 'Early Bird', email: 'early@example.com' })) === 200, 'the website still gets its 200');
  await sleep(600);
  check((await fsDump(['leadInbox'])).length === 0, 'nothing stored');

  console.log('\n# Owner sets up the instant website feed (optional; folded away under Website requests)');
  await owner.click('#nav-settings'); await owner.waitForSelector('#instantFeed summary');
  check(!(await owner.isVisible('[data-act=setupFeed]')), 'the instant feed’s setup is folded away (email brings requests in without it)');
  await owner.click('#instantFeed summary'); await owner.waitForSelector('[data-act=setupFeed]');
  await owner.click('[data-act=setupFeed]'); await owner.click('#cbYes');
  await owner.waitForSelector('#feedStatus .feedSt:has-text("On")', { timeout: 20000 });
  const intake = (await fsDump(['meta'])).find(d => d.name.endsWith('/meta/intake'));
  check(!!intake && !!intake.fields.pub && !!intake.fields.priv, 'feed key made: public half in the clear, private half sealed');
  const secretDoc = (await fsDump(['meta'])).find(d => d.name.endsWith('/meta/intakeSecret'));
  check(!!secretDoc && /^[0-9a-f]{64}$/.test(secretDoc.fields.hash.stringValue), 'only the secret’s hash is readable to the server');
  // point the feed at the local function (the page only accepts Cloud Run addresses when typed in)
  await owner.evaluate(u => B.saveSettings({ leads: Object.assign({}, S.settings.leads || {}, { feedUrl: u }) }), FN);
  await owner.click('#nav-today'); await owner.click('#nav-settings'); await owner.waitForSelector('[data-act=showHook]');
  await owner.waitForFunction(() => S.feed && S.feed.secret, null, { timeout: 15000 });
  await owner.click('[data-act=showHook]');
  await owner.waitForFunction(() => /k=/.test(document.querySelector('#hookUrl').value), null, { timeout: 10000 });
  const HOOK = await owner.inputValue('#hookUrl');
  check(HOOK.startsWith(FN + '?k=') && HOOK.length > FN.length + 40, 'webhook address = service address + a long secret');
  check(!JSON.stringify(await fsDump(['meta'])).includes(HOOK.split('k=')[1]), 'the secret itself is not stored in readable form');

  console.log('\n# “Send a test request” from Settings');
  await owner.click('[data-act=testFeed]');
  await owner.waitForFunction(() => /was added/.test(document.querySelector('#testMsg').textContent), null, { timeout: 40000 });
  check(true, 'the test request went browser → service → sealed inbox → filed as a lead');
  const tl = await owner.evaluate(() => { const l = openLeads().find(l => l.src && l.src.test); return l && { flag: l.flag, kind: l.src.kind }; });
  check(tl && tl.flag === 'test' && tl.kind === 'website', 'it waits under Need a look as a test');

  console.log('\n# A real request from the website');
  check(await post(HOOK, elementor({ name: 'avery sample', parent: 'Jordan Sample', email: 'jordan.sample@example.com', phone: '(352) 555-0101', message: 'Consult for braces please — marker-q7' })) === 200, 'website gets 200');
  await waitLead(sav, 'Avery Sample'); await waitLead(owner, 'Avery Sample'); await waitLead(gwen, 'Avery Sample');
  check(true, 'it shows up on every signed-in computer without reloading');
  await sleep(2500);
  check(await leadsNamed(sav, 'Avery Sample') === 1 && await leadsNamed(owner, 'Avery Sample') === 1, 'filed exactly once, though three computers were signed in');
  check((await fsDump(['leadInbox'])).length === 0, 'the inbox is empty again');
  const av = await leadOf(sav, 'Avery Sample');
  check(av.parent === 'Jordan Sample' && av.phone === '(352) 555-0101' && av.src.kind === 'website' && av.steps.length === 5, 'name tidied, details and 5 attempts in place');
  const savSid = await sav.evaluate(() => meSid());
  check(av.assignee === savSid, 'assigned to Savannah automatically (as in Asana)');
  check(/NLO Leads/.test(await sav.title()), 'tab title: ' + await sav.title());
  let dump = JSON.stringify(await fsDump());
  check(!/Avery|Jordan|jordan\.sample|555-0101|marker-q7|198\.51\.100/.test(dump), 'nothing readable about the lead anywhere in Firestore');

  console.log('\n# Working the lead');
  await sav.click('#nav-today');
  await sav.evaluate(id => openDrawer(id), av.id); await sav.waitForSelector('#drawer .nowBox');
  await sav.click('#drawer [data-act=logRes][data-res=vm]');
  await sav.waitForFunction(id => { const l = findLead(id); return l && l.steps[0].res === 'vm' && !S.pend[id]; }, av.id, { timeout: 20000 });
  await gwen.waitForFunction(id => { const l = findLead(id); return l && l.steps[0].res === 'vm'; }, av.id, { timeout: 20000 });
  check(true, 'Savannah logs a voicemail; Gwen sees it live');
  await sav.evaluate(() => { const b = Array.from(document.querySelectorAll('.toast button')).pop(); if (b) b.click(); });
  await gwen.waitForFunction(id => { const l = findLead(id); return l && !l.steps[0].doneAt; }, av.id, { timeout: 20000 });
  check(true, 'Undo is saved too (Gwen sees the attempt taken back)');
  await sav.evaluate(id => openDrawer(id), av.id); await sav.waitForSelector('#drawer .nowBox');
  await sav.fill('#nowNote', 'Mom asked for a call after 3 — note-k2');
  await sav.click('#drawer [data-act=logRes][data-res=none]');
  await sav.waitForFunction(id => !S.pend[id] && findLead(id).steps[0].res === 'none', av.id, { timeout: 20000 });
  await sav.waitForSelector('#histBox .hist', { timeout: 20000 });
  await sav.evaluate(id => loadHistory(id), av.id); await sleep(800);
  check(/logged attempt 1: no answer/.test(await sav.textContent('#histBox')), 'history shows who logged what');
  dump = JSON.stringify(await fsDump());
  check(!/note-k2/.test(dump), 'notes are sealed too');

  console.log('\n# Two people logging the same attempt at once');
  const step = await sav.evaluate(id => curStep(findLead(id)), av.id);
  await gwen.evaluate(id => openDrawer(id), av.id); await gwen.waitForSelector('#drawer .nowBox');
  await sav.evaluate(id => openDrawer(id), av.id); await sav.waitForSelector('#drawer .nowBox');
  SECTION = 'race';
  await Promise.all([sav.click('#drawer [data-act=logRes][data-res=sent]'), gwen.click('#drawer [data-act=logRes][data-res=sent]')]);
  await sleep(4000);
  const after = await leadOf(owner, 'Avery Sample');
  check(after.steps.filter((s, i) => i === step && s.doneAt).length === 1 && after.steps.filter(s => s.doneAt).length === 2, 'the attempt is logged once, not twice');
  const msgs = (await sav.$$eval('.toast', t => t.map(x => x.textContent))).concat(await gwen.$$eval('.toast', t => t.map(x => x.textContent)));
  check(msgs.some(m => /already logged/.test(m)), 'the second person is told it was already logged');
  SECTION = '# after race';

  console.log('\n# Repeat requests and spam wait for a look');
  check(await post(HOOK, elementor({ name: 'Avery Sample', parent: 'Jordan Sample', email: 'other.address@example.com', phone: '352.555.0101', message: 'Sent it again' })) === 200, 'second request from the same family');
  check(await post(HOOK, elementor({ name: 'Cheap Followers www.example.com', email: 'promo@example.com', message: 'buy now' })) === 200, 'a spam post');
  await sav.waitForFunction(() => openLeads().filter(l => l.flag === 'dup').length === 1 && openLeads().some(l => l.flag === 'spam'), null, { timeout: 30000 });
  const dupL = await sav.evaluate(() => { const l = openLeads().find(l => l.flag === 'dup'); return { id: l.id, dupOf: l.dupOf, why: l.flagWhy }; });
  check(dupL.dupOf === av.id && /phone number/.test(dupL.why), 'the repeat is flagged as a possible duplicate of the first (' + dupL.why + ')');
  await sav.evaluate(id => openDrawer(id), dupL.id); await sav.waitForSelector('#drawer .flagBox');
  await sav.click('#drawer [data-act=flagDup]');
  await owner.waitForFunction(id => { const l = findLead(id); return l && (l.comments || []).some(c => /Sent another request/.test(c.text)); }, av.id, { timeout: 20000 });
  check(true, 'closed as a duplicate; the first lead gets a note about it');
  const spamId = await sav.evaluate(() => openLeads().find(l => l.flag === 'spam').id);
  await sav.evaluate(id => openDrawer(id), spamId); await sav.click('#drawer [data-act=flagSpam]');
  await owner.waitForFunction(id => !openLeads().some(l => l.id === id), spamId, { timeout: 20000 });
  check(true, 'spam closed');

  console.log('\n# Requests the service refuses');
  const before = (await fsDump(['leads'])).length;
  check(await post(FN + '?k=wrong-secret', elementor({ name: 'Wrong Key', email: 'wk@example.com' })) === 200, 'wrong address: the website still gets 200');
  check(await post(FN, elementor({ name: 'No Key', email: 'nk@example.com' })) === 200, 'no secret: 200');
  check((await (await fetch(HOOK)).status) === 405, 'GET is refused (405)');
  await sleep(1500);
  check((await fsDump(['leadInbox'])).length === 0 && (await fsDump(['leads'])).length === before, 'nothing stored for them');
  await owner.click('#nav-today'); await owner.click('#nav-settings'); await owner.waitForFunction(() => /wrong address/.test((document.querySelector('#feedStatus') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => { });
  const fst = (await owner.textContent('#feedStatus')).replace(/\s+/g, ' ');
  check(/refused .*\(wrong address\)/.test(fst), 'Settings shows the last refused request and why: …' + fst.slice(fst.indexOf('Last'), fst.indexOf('Last') + 90));
  await owner.click('#feedOnOff'); await owner.click('#cbYes'); await owner.waitForSelector('#feedOnOff:has-text("Turn the feed on")', { timeout: 15000 });
  await sleep(800);
  check(await post(HOOK, elementor({ name: 'While Off', email: 'off@example.com' })) === 200, 'with the feed off the website still gets 200');
  await sleep(1500);
  check((await fsDump(['leadInbox'])).length === 0 && !(await owner.evaluate(() => openLeads().some(l => l.name === 'While Off'))), 'and nothing comes in');
  await owner.click('#feedOnOff'); await owner.waitForSelector('#feedOnOff:has-text("Turn the feed off")', { timeout: 15000 });
  await owner.click('[data-act=newSecret]'); await owner.click('#cbYes');
  await owner.waitForFunction(old => document.querySelector('#hookUrl').value && document.querySelector('#hookUrl').value !== old && /k=/.test(document.querySelector('#hookUrl').value), HOOK, { timeout: 15000 });
  const HOOK2 = await owner.inputValue('#hookUrl'); await sleep(800);
  check(await post(HOOK, elementor({ name: 'Old Address', email: 'old@example.com' })) === 200, 'after a new address is made…');
  check(await post(HOOK2, elementor({ name: 'Riley Demo', email: 'riley.demo@example.com', phone: '352-555-0102' })) === 200, '…only the new one works');
  await waitLead(owner, 'Riley Demo');
  check(!(await owner.evaluate(() => openLeads().some(l => l.name === 'Old Address'))), 'the old address stores nothing');

  console.log('\n# Website requests by email: the NLO Cases email reader (nothing to set up in Leads)');
  await owner.click('#nav-today'); await owner.click('#nav-settings'); await owner.waitForSelector('#mailRoute .feedSt');
  check(/Not on yet/.test(await owner.textContent('#mailRoute .feedSt')), 'before NLO Cases’ email reader exists, Settings says it’s not on yet');
  // Dr. A sets up email updates in NLO Cases (done once, for the lab emails)
  await ownerC.click('#nav-admin'); await ownerC.waitForSelector('#mailAdmin [data-act=mailSetup]', { timeout: 20000 });
  await ownerC.click('#mailAdmin [data-act=mailSetup]'); await ownerC.click('#cbYes');
  await ownerC.waitForSelector('#mlScript', { timeout: 30000 });
  const mailScript = await ownerC.inputValue('#mlScript');
  await ownerC.click('.modal [data-act=closeModal]');
  const inboxMeta = (await fsDump(['meta'])).find(d => d.name.endsWith('/meta/inbox'));
  check(/thenextlevelorthodontics@orthohost\.com/.test(JSON.stringify(inboxMeta.fields.senders)), 'NLO Cases’ email reader is told to forward the website form’s emails too');
  await owner.waitForFunction(() => /On/.test(document.querySelector('#mailRoute .feedSt').textContent), null, { timeout: 15000 });
  check(true, 'Leads → Settings: website requests by email are On');
  // the real Gmail script (as NLO Cases hands it out), run in a stand-in for Google with made-up emails
  const { makeGas } = require(path.join(__dirname, '..', '..', 'nlo-cases-src', 'test', 'gas.js'));
  const webText = (n, p, e, ph, msg) => 'Patient Name: ' + n + '\nParent Name: ' + (p || '') + '\nEmail: ' + e + '\nPhone: ' + ph + '\nMessage: ' + msg +
    '\n\n---\n\nDate: October 2, 2026\nTime: 4:10 pm\nPage URL: https://thenextlevelorthodontics.com/request-an-appointment/\nUser Agent: Mozilla/5.0\nRemote IP: 198.51.100.44\nPowered by: Elementor';
  const now = Date.now();
  const reqA = { id: 'w1', date: now - 60000, from: 'thenextlevelorthodontics@orthohost.com', to: 'records@example.com, office@example.com', subject: 'Website Appointment Request - Sky',
    text: webText('Sky Madeup', 'Robin Madeup', 'robin.madeup@example.com', '3525550142', 'Consult for Invisalign please — marker-e5') };
  const asanaNote = { id: 'w2', date: now - 50000, from: 'Asana <no-reply@asana.com>', subject: 'Website Appointment Request - Sky', text: 'Error processing your incoming email. Your task was successfully created in Asana.' };
  const labMail = { id: 'w3', date: now - 40000, from: 'uLab Systems <noreply@ulabsystems.com>', subject: 'Your uLab order ZQ55 has shipped.', text: 'Order Number: ZQ55\nPatient Name: Lab Madeup' };
  const beforeGoLive = { id: 'w4', date: Date.UTC(2026, 9, 1, 15), from: 'thenextlevelorthodontics@orthohost.com', subject: 'Website Appointment Request - Earlier',
    text: webText('Earlier Madeup', '', 'earlier@example.com', '3525550143', 'Sent the day before go-live') };
  // the website's general contact form comes from the same address but isn't a lead (it never went to Asana either)
  const contactForm = { id: 'w7', date: now - 30000, from: 'thenextlevelorthodontics@orthohost.com', subject: 'Website Contact Submission',
    text: 'Name: Jobseeker Madeup\nEmail: jobs.madeup@example.com\nMessage: Are you hiring assistants?\n\n---\n\nDate: October 2, 2026' };
  const gasA = makeGas({ source: mailScript, messages: [reqA, asanaNote, labMail, beforeGoLive, contactForm], user: 'office@example.com' });
  const runA = gasA.ctx.setup();
  check(/5 emails sent/.test(runA), 'Dr. A’s Gmail: the reader seals the request, Asana’s notice in its thread, a lab email, an older request and a contact-form email (' + runA + ')');
  await waitLead(sav, 'Sky Madeup'); await waitLead(owner, 'Sky Madeup'); await waitLead(gwen, 'Sky Madeup');
  check(true, 'the website request shows up in Leads on every signed-in computer, by itself');
  for (let i = 0; i < 40 && (await fsDump(['inbox'])).length !== 1; i++) await sleep(500);
  const leftMail = await ownerC.evaluate(async () => (await B.inboxLoad()).map(d => d.mail && d.mail.subject));
  check(leftMail.length === 1 && /uLab order ZQ55/.test(leftMail[0]), 'Leads clears Asana’s notice, the pre-go-live request and the contact-form email; the lab email is left for NLO Cases (' + leftMail.join(' | ') + ')');
  check(!(await owner.evaluate(() => openLeads().some(l => l.name === 'Earlier Madeup'))), 'a request sent before go-live (already in Asana) is not added');
  check(!(await owner.evaluate(() => openLeads().some(l => /Jobseeker/.test(l.name || '')))), 'the website’s contact-form email is not a lead');
  const sky = await leadOf(sav, 'Sky Madeup');
  check(sky.parent === 'Robin Madeup' && sky.phone === '3525550142' && sky.email === 'robin.madeup@example.com' && /marker-e5/.test(sky.message) && sky.src.kind === 'website' && sky.src.via === 'email'
    && sky.steps.length === 5 && /^e[0-9a-f]{19}$/.test(sky.id) && !/Remote IP|198\.51/.test(sky.src.raw || ''), 'its details and five attempts are in place; the IP address isn’t kept (id ' + sky.id + ')');
  check(sky.assignee === savSid && !sky.flag, 'assigned to Savannah, nothing to check');
  await sleep(2000);
  check(await leadsNamed(owner, 'Sky Madeup') === 1 && await leadsNamed(gwen, 'Sky Madeup') === 1, 'filed once, though three computers were signed in');
  const gasR = makeGas({ source: mailScript, messages: [Object.assign({}, reqA, { id: 'r1', date: now - 20000 })], user: 'records@example.com' });
  check(/1 email sent/.test(gasR.ctx.setup()), 'records@: its reader forwards its own copy of the same email later');
  for (let i = 0; i < 40 && (await fsDump(['inbox'])).length !== 1; i++) await sleep(500);
  await sleep(1500);
  check(await leadsNamed(owner, 'Sky Madeup') === 1 && (await fsDump(['inbox'])).length === 1, 'the second copy is cleared without a second lead');
  gasA.messages.push({ id: 'w5', date: Date.now(), from: 'thenextlevelorthodontics@orthohost.com', subject: 'Website Appointment Request - Test', text: webText('Test Test', '', 'test@example.com', '3525550100', 'Trying the form') });
  check(/1 email sent/.test(gasA.ctx.checkMail()), 'a made-up test through the real form…');
  await sav.waitForFunction(() => openLeads().some(l => l.name === 'Test Test' && l.flag === 'test'), null, { timeout: 30000 });
  check(true, '…waits under Need a look as a test');
  check(await ownerC.evaluate(() => !MAILS.unread.length && MAILS.list.length === 1), 'NLO Cases shows only the lab email (no “format the app doesn’t read” note for website emails)');
  await owner.click('#nav-today'); await owner.click('#nav-settings'); await owner.evaluate(() => { S.beatsAt = 0; updateFeedStatus(); });
  await owner.waitForFunction(() => /office@example\.com: checked/.test(document.querySelector('#mailRoute').textContent) && /records@example\.com: checked/.test(document.querySelector('#mailRoute').textContent), null, { timeout: 15000 });
  check(true, 'Settings shows when each inbox’s reader last checked');
  // the instant feed is set up in this test too: the same request through both ways is one lead
  check(await post(HOOK2, elementor({ name: 'Twin Madeup', email: 'twin.madeup@example.com', phone: '352-555-0150', message: 'Sent once' })) === 200, 'a request through the instant feed…');
  await waitLead(owner, 'Twin Madeup');
  gasA.messages.push({ id: 'w8', date: Date.now(), from: 'thenextlevelorthodontics@orthohost.com', subject: 'Website Appointment Request - Twin', text: webText('Twin Madeup', '', 'twin.madeup@example.com', '(352) 555-0150', 'Sent once') });
  check(/1 email sent/.test(gasA.ctx.checkMail()), '…and its email a few minutes later…');
  for (let i = 0; i < 40 && (await fsDump(['inbox'])).length !== 1; i++) await sleep(500);
  await sleep(1500);
  check(await leadsNamed(owner, 'Twin Madeup') === 1 && (await fsDump(['inbox'])).length === 1, '…stay one lead (the email copy is cleared)');
  // an NLO Cases page opened before this update puts its older sender list back; Dr. A's Leads restores the website
  const inboxDoc = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/meta/inbox`;
  await fetch(inboxDoc + '?updateMask.fieldPaths=senders', { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { senders: { arrayValue: { values: ['ulabsystems.com', 'partnersdentalstudio.com', 'olivortho.com', 'angelaligner.com', 'angelalign.com'].map(s => ({ stringValue: s })) } } } }) });
  let back = false;
  for (let i = 0; i < 30 && !back; i++) { await sleep(500); back = /thenextlevelorthodontics@orthohost\.com/.test(JSON.stringify((await (await fetch(inboxDoc, { headers: { Authorization: 'Bearer owner' } })).json()).fields.senders)); }
  check(back, 'when an older NLO Cases page takes the website off the email reader’s list, Dr. A’s Leads puts it back');
  dump = JSON.stringify(await fsDump(['leads', 'leadLog', 'leadInbox', 'inbox', 'meta', 'mailbeat']));
  check(!/Sky|Robin|robin\.madeup|marker-e5|5550142|Earlier Madeup|198\.51\.100\.44|Lab Madeup|ZQ55|Jobseeker|Twin Madeup/.test(dump), 'nothing readable about any of it in Firestore (inbox, leads, history)');

  console.log('\n# Lead added by hand, closed with a reason, reopened');
  await gwen.evaluate(() => closeDrawer(true)); await sav.evaluate(() => closeDrawer(true));
  await gwen.click('.topBar [data-act=newLead]'); await gwen.waitForSelector('#nlForm');
  await gwen.fill('#nl-name', 'Quinn Example'); await gwen.fill('#nl-parent', 'Casey Example'); await gwen.fill('#nl-phone', '352-555-0103');
  await gwen.click('#nlSave'); await gwen.waitForSelector('#drawer .nowBox', { timeout: 20000 });
  await waitLead(sav, 'Quinn Example'); check(true, 'phone-call lead added by Gwen shows up for Savannah');
  const q = await leadOf(gwen, 'Quinn Example');
  await gwen.click('#drawer [data-act=closeLead]'); await gwen.click('#cwPick [data-why=notint]'); await gwen.fill('#cwNote', 'Went elsewhere'); await gwen.click('#cwOk');
  await sav.waitForFunction(id => !openLeads().some(l => l.id === id), q.id, { timeout: 20000 });
  await sav.click('#nav-closed'); await sav.waitForSelector('tr.click:has-text("Quinn Example")', { timeout: 20000 });
  check(true, 'closed lead is listed under Closed');
  await sav.click('tr.click:has-text("Quinn Example")'); await sav.waitForSelector('#drawer [data-act=reopen]'); await sav.click('#drawer [data-act=reopen]');
  await gwen.waitForFunction(id => openLeads().some(l => l.id === id), q.id, { timeout: 20000 });
  check(true, 'reopened — back on everyone’s list');

  console.log('\n# Results');
  await owner.click('#nav-results'); await owner.waitForSelector('.tiles .tile', { timeout: 20000 }); await sleep(500);
  const reqN = Number((await owner.textContent('.tiles .tile .n')).trim());
  check(reqN >= 3, 'results count real requests (' + reqN + '), not tests, spam or duplicates');

  console.log('\n# Removing Gwen in NLO Cases changes the office key; Leads re-seals and keeps working');
  const v1 = (await fsDump(['leads'])).map(d => d.fields.v.integerValue);
  check(v1.length > 0 && v1.every(v => v === '1'), 'leads on key version 1 (' + v1.length + ')');
  await ownerC.click('#nav-admin');
  await ownerC.click('tr:has-text("Gwen Tester") [data-act=removeStaff]'); await ownerC.click('#cbYes');
  await gwen.waitForSelector('#lockWrap:not(.hidden) .lockOk', { timeout: 30000 });
  check(true, 'Gwen is locked out of Leads at once');
  await ownerC.waitForSelector('.toast:has-text("Office key changed")', { timeout: 60000 });
  await owner.waitForFunction(() => true, null, { timeout: 1000 });
  for (let i = 0; i < 60; i++) { const vs = (await fsDump(['leads'])).map(d => d.fields.v.integerValue); if (vs.every(v => v === '2')) break; await sleep(1000); }
  const v2 = (await fsDump(['leads'])).map(d => d.fields.v.integerValue);
  check(v2.length === v1.length && v2.every(v => v === '2'), 'every lead re-sealed under key version 2 by the owner’s Leads page');
  const ik = (await fsDump(['meta'])).find(d => d.name.endsWith('/meta/intake'));
  check(ik.fields.priv.mapValue.fields.v.integerValue === '2', 'the feed’s private key re-sealed under version 2 too');
  check(await post(HOOK2, elementor({ name: 'Harper Testcase', parent: 'Morgan Testcase', email: 'morgan.t@example.com', phone: '352-555-0104' })) === 200, 'a request after the key change…');
  await waitLead(sav, 'Harper Testcase'); check(true, '…is opened and filed as usual');
  gasA.messages.push({ id: 'w6', date: Date.now(), from: 'thenextlevelorthodontics@orthohost.com', subject: 'Website Appointment Request - Avery Late', text: webText('Avery Late', 'Pat Late', 'pat.late@example.com', '3525550145', 'After the key change') });
  check(/1 email sent/.test(gasA.ctx.checkMail()), 'an emailed request after the key change…');
  await waitLead(sav, 'Avery Late'); check(true, '…comes in as usual too');
  const hp = await leadOf(sav, 'Harper Testcase');
  await sav.evaluate(id => openDrawer(id), hp.id); await sav.waitForSelector('#drawer .nowBox');
  await sav.click('#drawer [data-act=logRes][data-res=vm]');
  await owner.waitForFunction(id => { const l = findLead(id); return l && l.steps[0].res === 'vm'; }, hp.id, { timeout: 20000 });
  check(true, 'Savannah (signed in through the key change) keeps logging');
  await signIn(gwen, LEADS, 'gwen', 'Gwen-Pass-2026'); await gwen.waitForSelector('.lockErr', { timeout: 20000 });
  check(true, 'Gwen can no longer sign in: ' + (await gwen.textContent('.lockErr')).trim());
  dump = JSON.stringify(await fsDump());
  check(!/Avery|Jordan|Harper|Morgan|Riley|Quinn|Casey|example\.com|555-01|marker-q7|note-k2|Went elsewhere/.test(dump), 'still nothing readable anywhere in Firestore');

  console.log('\n# Phone, idle lock, export');
  const m = await newPage(browser, 'savannahPhone', errs, { width: 390, height: 844 });
  await signIn(m, LEADS, 'savannah', 'Savannah-Pass-2026'); await waitApp(m); await m.waitForSelector('.tiles');
  fs.mkdirSync('shots', { recursive: true }); await m.screenshot({ path: 'shots/e2e-phone-today.png', fullPage: true });
  check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 392, 'phone: no sideways scrolling');
  await m.evaluate(() => { S.lastAct = Date.now() - 11 * 60000; });
  await m.waitForSelector('#lockWrap:not(.hidden) .lockOk', { timeout: 25000 });
  check((await m.evaluate(() => S.leads.size)) === 0, 'idle lock wipes the opened leads from memory');
  await owner.click('#nav-import');
  const [dl] = await Promise.all([owner.waitForEvent('download', { timeout: 30000 }), (async () => { await owner.click('[data-act=exportCSV]'); await owner.click('#cbYes'); })()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check(/Avery Sample/.test(csv) && /Harper Testcase/.test(csv) && csv.split('\n')[0].includes('Last result'), 'export downloads every lead as a spreadsheet');

  // wrap up
  const realErrs = errs.filter(e => !/Failed to load resource.*(404|fonts)|net::ERR|status of 400|status of 403|identitytoolkit|INVALID_LOGIN_CREDENTIALS|permission|insufficient permissions/i.test(e));
  check(realErrs.length === 0, 'no unexpected page errors' + (realErrs.length ? ':\n' + realErrs.join('\n') : ''));
  // two computers may both try to file the same website request; the second one's save is refused by the rules (by design) and it moves on
  const raced = global.__raced || 0;
  const unexpected403 = forbidden.filter(f => !/@ race|Gwen is locked|Removing Gwen/.test(f));
  console.log('403s:\n' + forbidden.join('\n') + '\nfiling races lost (expected, harmless): ' + raced);
  check(unexpected403.length <= raced && unexpected403.every(f => /documents:commit/.test(f)), 'no request refused by the security rules in normal use (' + unexpected403.length + ' refused saves, all from ' + raced + ' filing race(s) a second computer lost)');
  check(!/Avery|Jordan|Harper|Riley|example\.com/.test(fnLog), 'the receiving service’s log holds nothing about anyone (' + fnLog.trim().split('\n').length + ' lines)');
  console.log('\nPASS ' + passes.length + '  FAIL ' + fails.length);
  await browser.close(); fnProc.kill();
  process.exit(fails.length ? 1 : 0);
})().catch(async e => { console.error('CRASH', e); try { for (const pg of (global.__pages || [])) console.error('PAGE', pg.l, (await pg.p.textContent('#lockCard').catch(() => '')).slice(0, 200), '|', (await pg.p.textContent('#view').catch(() => '')).slice(0, 200)); } catch (x) { } console.error('ERRS', (global.__errs || []).join('\n')); console.error('FNLOG', global.__fnLog ? global.__fnLog().slice(-3000) : ''); console.error('CAUSE', e && e.cause); process.exit(2); });
