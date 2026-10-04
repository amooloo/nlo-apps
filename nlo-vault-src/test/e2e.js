// End-to-end: the real built page in Chromium, against the Firebase emulators (auth 9099, firestore 8080),
// served with the production security headers. Made-up logins only.
//   npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-nlo-vault "node test/e2e.js"
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, doc as fdoc, getDoc as fget, getDocs as fgetAll, writeBatch as fbatch, serverTimestamp as fts, updateDoc as fupdate, collection as fcol, query as fquery, where as fwhere } from 'firebase/firestore';
import * as C from '../src/crypto.js';

const PORT = 8770, URL0 = 'http://127.0.0.1:' + PORT + '/', PROJECT = 'demo-nlo-vault';
const OWNER = 'dr.test@example.com', OWNER_PW = 'maple river cocoa lamp desk';
const SHOTS = new URL('../shots/', import.meta.url).pathname; mkdirSync(SHOTS, { recursive: true });
const fails = [], passes = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errs = [];
const SECRETS = [];   // every made-up password/username/title we type: none may appear in the database in plain text

async function oob(email, type) {
  const r = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
  const codes = (r.oobCodes || []).filter(c => c.email === email && c.requestType === type);
  if (!codes.length) throw new Error('no ' + type + ' email for ' + email);
  return codes[codes.length - 1];
}
async function dumpDb() {
  const out = [];
  for (const col of ['meta', 'users', 'keys', 'logins', 'folders', 'grants', 'items', 'versions', 'log', 'prefs']) {
    const r = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${col}?pageSize=1000`, { headers: { Authorization: 'Bearer owner' } });
    const j = await r.json(); (j.documents || []).forEach(d => out.push(d));
  }
  return out;
}
async function newPage(browser, label, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1360, height: 860 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL0.slice(0, -1) });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ' pageerror: ' + e.message));
  // (Firestore's connection checker loads a Google pixel after a dropped request; the page's policy blocks it, as it should)
  p.on('console', m => { if (m.type() === 'error' && !/PERMISSION_DENIED|permission-denied|Missing or insufficient permissions|evaluation error at|false for '|400 \(Bad Request\)|status of 400|google\.com\/images\/cleardot\.gif/.test(m.text())) errs.push(label + ' console: ' + m.text()); });
  await p.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sample || '').slice(0, 60) + ' @' + (e.sourceFile || '') + ':' + e.lineNumber + ':' + e.columnNumber); }); });
  return p;
}
async function signIn(p, user, pw) {
  await p.goto(URL0); await p.waitForSelector('#liUser');
  await p.fill('#liUser', user); await p.fill('#liPw', pw); await p.click('#liBtn');
}
const waitVault = p => p.waitForSelector('#app .listHead', { timeout: 30000 });
const state = (p, fn, arg) => p.evaluate(fn, arg);
async function folderId(p, name) { return state(p, n => { const f = Array.from(window.__vault.V.folders.values()).find(x => x.name === n); return f ? f.id : null; }, name); }
async function itemByTitle(p, t) { return state(p, t => { const it = Array.from(window.__vault.V.items.values()).find(x => x.d && x.d.t === t && !x.del); return it ? { id: it.id, f: it.f, rev: it.rev, kv: it.kv, d: it.d } : null; }, t); }
async function waitFor(p, fn, arg, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) { if (await state(p, fn, arg)) return true; await sleep(150); }
  return false;
}
async function addItem(p, o) {
  await p.click('#newBtn'); await p.waitForSelector('#edForm');
  await p.fill('#edT', o.t);
  if (o.folder) await p.selectOption('#edF', { label: o.folder });
  if (o.url) await p.fill('#edUrl', o.url);
  if (o.u) await p.fill('#edU', o.u);
  if (o.p) await p.fill('#edP', o.p);
  if (o.totp) await p.fill('#edTotp', o.totp);
  if (o.n) await p.fill('#edN', o.n);
  await p.click('#edSave'); await p.waitForSelector('.modalWrap', { state: 'detached', timeout: 15000 });
  [o.t, o.u, o.p, o.n].filter(Boolean).forEach(s => SECRETS.push(s));
}
async function openItem(p, title) {
  await p.fill('#q', title);
  await p.waitForSelector('.row:has-text("' + title + '")', { timeout: 15000 });
  await p.click('.row:has-text("' + title + '")');
  await p.waitForSelector('.dTitle h2:has-text("' + title + '")');
}
async function clip(p) { return p.evaluate(() => navigator.clipboard.readText()); }
async function addPerson(owner, name, username, access) {
  await owner.click('[data-act=go][data-v=team]'); await owner.click('[data-act=addPerson]');
  await owner.fill('#apName', name); await owner.fill('#apUser', username);
  for (const [fname, role] of Object.entries(access || {})) {
    const fid = await folderId(owner, fname);
    await owner.selectOption('select[data-af="' + fid + '"]', role);
  }
  await owner.click('#apBtn');
  await owner.waitForSelector('#tmpPw', { timeout: 30000 });
  const temp = (await owner.textContent('#tmpPw')).trim();
  await owner.click('.modal .mfoot [data-close]');
  return temp;
}

(async () => {
  // start from an empty emulator (the rules tests may have run first)
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const srv = await serve(new URL('../dist-test/public', import.meta.url).pathname, new URL('../dist-test/headers.json', import.meta.url).pathname, PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  let owner, sarah;
  try {
    console.log('\n# The page itself');
    owner = await newPage(browser, 'owner');
    const resp = await owner.goto(URL0);
    const h = resp.headers();
    check(/frame-ancestors 'none'/.test(h['content-security-policy'] || '') && /require-trusted-types-for 'script'/.test(h['content-security-policy']), 'served with the strict security policy (no framing, Trusted Types)');
    check(h['x-frame-options'] === 'DENY' && h['referrer-policy'] === 'no-referrer' && h['cross-origin-opener-policy'] === 'same-origin', 'no-framing, no-referrer and window-isolation headers');
    await owner.waitForSelector('#liUser');
    check(await owner.evaluate(() => !!window.trustedTypes && document.querySelectorAll('script[src]').length === 0), 'no outside scripts on the page');
    const inj = await owner.evaluate(() => { try { document.body.insertAdjacentHTML('beforeend', '<img src=x>'); return 'allowed'; } catch (e) { return 'blocked'; } });
    check(inj === 'blocked', 'raw HTML can’t be injected (Trusted Types enforced)');
    await owner.evaluate(() => { window.__csp = []; });   // that violation was the test itself
    errs.length = 0;

    await owner.screenshot({ path: SHOTS + '00-sign-in.png' });
    console.log('\n# Dr. A sets up the vault');
    await owner.click('#liSetup'); await owner.waitForSelector('#suForm');
    await owner.screenshot({ path: SHOTS + '00b-setup.png' });
    await owner.fill('#suEmail', OWNER); await owner.fill('#suName', 'Dr. A');
    await owner.fill('#suPw', 'Summer2024!'); await owner.fill('#suPw2', 'Summer2024!'); await owner.click('#suBtn');
    check(/easy to guess|at least 12/i.test(await owner.textContent('#suErr')), 'a weak vault password is refused');
    await owner.fill('#suPw', OWNER_PW); await owner.fill('#suPw2', OWNER_PW); await owner.click('#suBtn');
    await owner.waitForSelector('#vfBtn', { timeout: 30000 });
    await owner.click('#vfBtn'); await owner.waitForSelector('#vfErr:not(.hidden)');
    check(/not confirmed/i.test(await owner.textContent('#vfErr')), 'Continue before clicking the email link says so');
    await fetch((await oob(OWNER, 'VERIFY_EMAIL')).oobLink);
    await owner.click('#vfBtn');
    await owner.waitForSelector('#rcCode', { timeout: 30000 });
    const code = (await owner.textContent('#rcCode')).trim();
    await owner.screenshot({ path: SHOTS + '00c-recovery-code.png' });
    check(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/.test(code), 'recovery code shown: ' + code.slice(0, 4) + '…');
    await owner.fill('#rcConfirm', 'ZZZZ'); await owner.click('#rcBtn');
    check(/isn’t the end/.test(await owner.textContent('#rcErr')), 'the wrong last four characters are refused');
    await owner.fill('#rcConfirm', code.slice(-4).toLowerCase()); await owner.click('#rcBtn');
    await waitVault(owner);
    await waitFor(owner, () => window.__vault.V.loaded && window.__vault.V.folders.size === 4);
    const fnames = await state(owner, () => window.__vault.S.folderList().map(f => f.name));
    check(fnames.join('|') === 'Dr. A only|Everyone|Front office|Clinical & lab', 'starting folders: ' + fnames.join(', '));
    await owner.screenshot({ path: SHOTS + '01-empty-vault.png' });

    console.log('\n# Adding logins by hand');
    await owner.click('[data-act=go][data-v^="folder:"]:has-text("Dr. A only")');
    await addItem(owner, { t: 'Chase business banking', url: 'https://secure.chase.com', u: 'nlo-owner-77', p: 'Ch@seBank-Zx81-Qp', n: 'Account ending 4417' });
    await addItem(owner, { t: 'Office Wi-Fi', folder: 'Everyone', u: 'NLO-Staff', p: 'braces-glow-orbit-tide', totp: '' });
    await addItem(owner, { t: 'Shimmin portal', folder: 'Front office', url: 'portal.shimmin.example', u: 'nlo@practice.test', p: 'Shim-9QxV!pL2', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' });
    const chase = await itemByTitle(owner, 'Chase business banking');
    check(chase && chase.d.p === 'Ch@seBank-Zx81-Qp' && chase.f === await folderId(owner, 'Dr. A only'), 'saved and read back (Dr. A only)');
    await openItem(owner, 'Shimmin portal');
    const totp1 = await owner.textContent('#totpVal');
    check(/^\d{3} \d{3}$/.test(totp1.trim()), '2-step code shown: ' + totp1.trim());
    await owner.click('[data-act=copy][data-k=p]');
    check(await clip(owner) === 'Shim-9QxV!pL2', 'copy password puts it on the clipboard');
    await owner.click('[data-act=reveal]');
    check((await owner.textContent('#pwVal')).replace(/\s/g, '') === 'Shim-9QxV!pL2', 'show password reveals it');
    await owner.screenshot({ path: SHOTS + '01b-detail.png' });
    await owner.click('[data-act=big]'); await owner.waitForSelector('.bigPw');
    check((await owner.$$('.bigPw .bc')).length === 'Shim-9QxV!pL2'.length, 'the big view shows one box per character');
    await sleep(400); await owner.screenshot({ path: SHOTS + '01c-big.png' });
    await owner.click('.modal .mfoot [data-close]');
    await owner.click('[data-act=copyTotp]');
    check(/^\d{6}$/.test(await clip(owner)), '2-step code copies');
    await owner.click('[data-act=edit]'); await owner.waitForSelector('#edForm');
    await owner.click('#edGen'); await owner.waitForSelector('#gVal');
    const g1 = (await owner.textContent('#gVal')).trim();
    await sleep(400); await owner.screenshot({ path: SHOTS + '01d-editor.png' });
    await owner.click('#gUse');
    check((await owner.inputValue('#edP')) === g1 && g1.length === 20, 'the generator fills a 20-character password');
    await owner.click('.modal .mfoot [data-close]');
    await owner.waitForSelector('.modal [data-yes]'); await owner.click('.modal [data-yes]');   // discard
    await owner.waitForSelector('.modalWrap', { state: 'detached' });
    check((await itemByTitle(owner, 'Shimmin portal')).d.p === 'Shim-9QxV!pL2', 'closing without saving keeps the old password');
    await owner.fill('#q', '');

    console.log('\n# Importing from a spreadsheet (pasted)');
    await owner.click('[data-act=go][data-v=import]'); await owner.waitForSelector('#pasteBox');
    const sheet = 'Account\tWebsite\tUsername\tPassword\tCategory\tNotes\n' +
      'Delta Dental provider\twww.deltadentalins.com\tnlo_front\tDdP-4471-x!\tFront office\tcall 800 number for ERA\n' +
      'OrthoBanc\torthobanc.com\tnlo-ob\tOb#Pay-2210\tFront office\t\n' +
      'Oliv portal\tportal.olivortho.com\tdra-oliv\tOl1v-Doc-88\tClinical & lab\t\n' +
      'iTero / MyiTero\tmyitero.com\tnlo.itero\tiT3ro-scan-551\tClinical & lab\tscanner login\n' +
      'Henry Schein\thenryschein.com\torders@practice.test\tHSchein!902\tSupplies\t\n' +
      'Office Wi-Fi\t\tNLO-Staff\tbraces-glow-orbit-tide\tEveryone\tduplicate of the one above\n';
    sheet.split('\n').slice(1).forEach(l => l.split('\t').slice(0, 4).filter(Boolean).forEach(s => SECRETS.push(s)));
    await owner.evaluate(t => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.querySelector('#pasteBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, sheet);
    await owner.waitForSelector('#impGo');
    const pv = await owner.textContent('#impPreview');
    check(!pv.includes('DdP-4471-x!') && pv.includes('••••••'), 'preview hides the passwords');
    check(/1 is already in the vault/.test(pv), 'the duplicate Wi-Fi row is spotted');
    check(/New folders will be made: Supplies/.test(pv), 'an unknown category becomes a new folder');
    check((await owner.textContent('#impGo')).includes('Import 5 logins'), 'five to import (duplicate skipped)');
    await owner.screenshot({ path: SHOTS + '02-import-preview.png', fullPage: true });
    await owner.click('#impGo');
    await owner.waitForSelector('.done h1', { timeout: 30000 });
    check(/Imported 5 logins/.test(await owner.textContent('.done h1')), 'imported 5');
    await waitFor(owner, () => Array.from(window.__vault.V.items.values()).filter(i => i.d && !i.del).length === 8);
    const delta = await itemByTitle(owner, 'Delta Dental provider');
    check(delta && delta.f === await folderId(owner, 'Front office') && delta.d.u === 'nlo_front' && delta.d.n === 'call 800 number for ERA' && delta.d.url === 'www.deltadentalins.com', 'Delta Dental landed in Front office with its fields');
    const hs = await itemByTitle(owner, 'Henry Schein');
    check(hs && hs.f === await folderId(owner, 'Supplies'), 'Henry Schein in the new Supplies folder');
    // document-style paste
    await owner.click('[data-act=go][data-v=import]'); await owner.waitForSelector('#pasteBox');
    const docText = 'Paychex Flex\nUsername: nlo-payroll\nPassword: Pay-Flex-7781!\nWebsite: myapps.paychex.com\nPIN: 4455\n\nSome notes about the office that are not a login.\n';
    SECRETS.push('Pay-Flex-7781!', 'nlo-payroll');
    await owner.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.querySelector('#pasteBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, docText);
    await owner.waitForSelector('#impGo');
    check(/Found 1 login/.test(await owner.textContent('#impPreview')), 'a pasted document: 1 login found, prose skipped');
    await owner.selectOption('#impTarget', { label: 'Dr. A only' });
    await owner.click('#impGo'); await owner.waitForSelector('.done h1', { timeout: 30000 });
    await waitFor(owner, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Paychex Flex'));
    const px = await itemByTitle(owner, 'Paychex Flex');
    check(px && px.d.p === 'Pay-Flex-7781!' && px.d.fx.some(f => f.l === 'PIN' && f.v === '4455' && f.h), 'Paychex read from the document, PIN kept as a hidden field');

    console.log('\n# Nothing readable is stored');
    const dump1 = JSON.stringify(await dumpDb());
    const leaks = SECRETS.filter(s => s.length >= 4 && dump1.includes(s));
    check(leaks.length === 0, 'no password, username, name or note appears in the database (checked ' + SECRETS.length + ')' + (leaks.length ? ': ' + leaks.join(', ') : ''));
    check(!dump1.includes(OWNER_PW) && !dump1.includes(code.replace(/-/g, '')) && !dump1.includes(code), 'the vault password and recovery code are not stored');
    check(!dump1.includes('Front office') && !dump1.includes('Dr. A only'), 'folder names are encrypted too');

    console.log('\n# Adding a person');
    const tempSarah = await addPerson(owner, 'Sarah B.', 'sarah', { 'Front office': 'edit', 'Everyone': 'view' });
    check(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tempSarah), 'temporary password made: ' + tempSarah.slice(0, 4) + '…');
    const tempGwen = await addPerson(owner, 'Gwen W.', 'gwen', { 'Clinical & lab': 'edit', 'Front office': 'view' });
    await owner.waitForSelector('.tbl td:has-text("sarah")');
    check(/Hasn’t signed in yet/.test(await owner.textContent('.tbl')), 'People shows they haven’t signed in yet');
    await owner.screenshot({ path: SHOTS + '03-people.png', fullPage: true });

    console.log('\n# Sarah signs in the first time');
    sarah = await newPage(browser, 'sarah');
    await signIn(sarah, 'Sarah', 'WRONG-PASSWORD-1');
    await sarah.waitForSelector('#liErr:not(.hidden)');
    check(/don’t match/.test(await sarah.textContent('#liErr')), 'wrong password refused');
    await sarah.fill('#liPw', tempSarah); await sarah.click('#liBtn');
    await sarah.waitForSelector('#fpForm', { timeout: 30000 });
    check(/Welcome, Sarah/.test(await sarah.textContent('h1')), 'asked to choose her own password');
    await sarah.fill('#fpPw', 'sarah1234567'); await sarah.fill('#fpPw2', 'sarah1234567'); await sarah.click('#fpBtn');
    check(/easy to guess/i.test(await sarah.textContent('#fpErr')), 'a password with her name in it is refused');
    const SARAH_PW = 'pebble harbor violet engine';
    await sarah.fill('#fpPw', SARAH_PW); await sarah.fill('#fpPw2', SARAH_PW); await sarah.click('#fpBtn');
    await waitVault(sarah);
    await waitFor(sarah, () => window.__vault.V.loaded && Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 3);
    const sf = await state(sarah, () => window.__vault.S.folderList().map(f => f.name + ':' + (window.__vault.S.canEdit(f.id) ? 'edit' : 'view')).sort());
    check(sf.join('|') === 'Everyone:view|Front office:edit', 'Sarah sees only her folders: ' + sf.join(', '));
    const st = await state(sarah, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).map(i => i.d.t).sort());
    check(!st.includes('Chase business banking') && !st.includes('Oliv portal') && st.includes('Delta Dental provider') && st.includes('Office Wi-Fi'), 'Sarah sees Front office + Everyone logins only (' + st.length + ')');
    await sarah.screenshot({ path: SHOTS + '04-staff-view.png' });
    // temp password no longer works
    const s2 = await newPage(browser, 'sarah-old');
    await signIn(s2, 'sarah', tempSarah); await s2.waitForSelector('#liErr:not(.hidden)', { timeout: 30000 });
    check(true, 'the temporary password stopped working');
    await s2.context().close();

    console.log('\n# Sarah uses it');
    await openItem(sarah, 'Delta Dental provider');
    await sarah.click('[data-act=copy][data-k=p]');
    check(await clip(sarah) === 'DdP-4471-x!', 'Sarah copies the Delta Dental password');
    await sarah.fill('#q', '');
    await openItem(sarah, 'Office Wi-Fi');
    check(await sarah.$('[data-act=edit]') === null, 'no Edit button in a view-only folder');
    await sarah.fill('#q', '');
    await openItem(sarah, 'OrthoBanc');
    await sarah.click('[data-act=edit]'); await sarah.waitForSelector('#edForm');
    await sarah.fill('#edP', 'Ob#Pay-2211-new'); SECRETS.push('Ob#Pay-2211-new');
    await sarah.click('#edSave'); await sarah.waitForSelector('.modalWrap', { state: 'detached', timeout: 15000 });
    await waitFor(owner, () => { const it = Array.from(window.__vault.V.items.values()).find(i => i.d && i.d.t === 'OrthoBanc'); return it && it.d.p === 'Ob#Pay-2211-new'; });
    const ob = await itemByTitle(owner, 'OrthoBanc');
    check(ob.d.p === 'Ob#Pay-2211-new' && ob.d.ph && ob.d.ph[0].p === 'Ob#Pay-2210', 'her change reaches Dr. A live, old password kept in its history');
    await sarah.fill('#q', '');

    console.log('\n# Activity and history (Dr. A)');
    await owner.click('[data-act=go][data-v=activity]');
    await owner.waitForSelector('#actList .act', { timeout: 15000 });
    await sleep(800); await owner.click('[data-act=actRefresh]'); await sleep(800);
    const act = await owner.textContent('#actList');
    check(/Sarah B\. copied the password of Delta Dental provider/.test(act), 'Activity: Sarah copied the Delta Dental password');
    check(/Sarah B\. changed OrthoBanc/.test(act), 'Activity: Sarah changed OrthoBanc');
    await owner.screenshot({ path: SHOTS + '05-activity.png', fullPage: true });
    await owner.click('[data-act=go][data-v=all]');
    await openItem(owner, 'OrthoBanc');
    await owner.click('[data-act=history]'); await owner.waitForSelector('.hist li', { timeout: 15000 });
    check(/Restore this version/.test(await owner.textContent('.hist')), 'History lists the earlier version');
    await owner.click('.hist [data-act=restoreVer]'); await owner.click('.modal [data-yes]');
    await waitFor(owner, () => { const it = Array.from(window.__vault.V.items.values()).find(i => i.d && i.d.t === 'OrthoBanc'); return it && it.d.p === 'Ob#Pay-2210'; });
    check((await itemByTitle(owner, 'OrthoBanc')).d.p === 'Ob#Pay-2210', 'an earlier version can be restored');
    await owner.fill('#q', '');

    console.log('\n# Gwen, then removing Sarah');
    const gwen = await newPage(browser, 'gwen');
    await signIn(gwen, 'gwen', tempGwen); await gwen.waitForSelector('#fpForm', { timeout: 30000 });
    await gwen.fill('#fpPw', 'copper lantern meadow quilt'); await gwen.fill('#fpPw2', 'copper lantern meadow quilt'); await gwen.click('#fpBtn');
    await waitVault(gwen);
    await waitFor(gwen, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 4);
    await owner.click('[data-act=go][data-v=team]');
    const sarahUid = await state(owner, () => Array.from(window.__vault.V.users.values()).find(u => u.username === 'sarah').uid);
    await owner.click('[data-act=removePerson][data-u="' + sarahUid + '"]');
    await owner.waitForSelector('#flagChg');
    await owner.click('.modal [data-yes]');
    await owner.waitForSelector('.toast:has-text("Done")', { timeout: 60000 });
    await sarah.waitForURL(/locked=removed/, { timeout: 20000 }).catch(() => { });
    await sarah.waitForSelector('#liUser', { timeout: 20000 });
    check(/access to the vault was turned off/.test(await sarah.textContent('.lockCard')), 'Sarah’s open vault locks itself the moment she’s removed');
    await signIn(sarah, 'sarah', SARAH_PW); await sarah.waitForSelector('#liErr:not(.hidden)', { timeout: 30000 });
    check(/turned off|don’t match/.test(await sarah.textContent('#liErr')), 'Sarah can’t sign in again');
    const fo = await state(owner, n => { const f = Array.from(window.__vault.V.folders.values()).find(x => x.name === n); return { kv: f.kv, rot: !!f.rot }; }, 'Front office');
    check(fo.kv === 2 && !fo.rot, 'Front office has a new key (version 2), key change finished');
    const flagged = await state(owner, () => Array.from(window.__vault.V.items.values()).filter(i => i.d && i.d.chg).map(i => i.d.t).sort());
    check(flagged.includes('Delta Dental provider') && flagged.includes('OrthoBanc') && flagged.includes('Office Wi-Fi') && !flagged.includes('Oliv portal') && !flagged.includes('Chase business banking'), 'passwords Sarah could see are flagged to change: ' + flagged.join(', '));
    await waitFor(gwen, () => { const it = Array.from(window.__vault.V.items.values()).find(i => i.d && i.d.t === 'Delta Dental provider'); return it && it.kv === 2 && it.d.chg; }, null, 20000);
    const gd = await itemByTitle(gwen, 'Delta Dental provider');
    check(gd && gd.kv === 2, 'Gwen (still in Front office) reads it under the new key');
    await owner.click('[data-act=go][data-v=health]');
    check(/Change these passwords/.test(await owner.textContent('.page')), 'Needs attention lists them');
    await owner.screenshot({ path: SHOTS + '06-needs-attention.png', fullPage: true });

    console.log('\n# Trash, favorites, folders');
    await owner.click('[data-act=go][data-v=all]');
    await openItem(owner, 'Henry Schein');
    await owner.click('[data-act=del]');
    await waitFor(owner, () => { const it = Array.from(window.__vault.V.items.values()).find(i => i.d && i.d.t === 'Henry Schein'); return it && it.del; });
    check(true, 'delete moves it to the trash');
    await owner.click('.toast .tact');   // Undo
    await waitFor(owner, () => { const it = Array.from(window.__vault.V.items.values()).find(i => i.d && i.d.t === 'Henry Schein'); return it && !it.del; });
    check(true, 'Undo puts it back');
    await owner.fill('#q', '');
    await openItem(owner, 'Oliv portal');
    await owner.click('[data-act=fav]');
    await waitFor(owner, () => (window.__vault.V.prefs.favs || []).length === 1);
    await owner.fill('#q', ''); await owner.click('[data-act=go][data-v=fav]');
    await owner.waitForSelector('.row:has-text("Oliv portal")');
    check((await owner.$$('.items .row')).length === 1, 'starred login shows in Favorites');
    await owner.click('[data-act=newFolder]'); await owner.waitForSelector('#fdForm');
    await owner.fill('#fdName', 'Insurance portals'); await owner.click('#fdSave');
    await owner.waitForSelector('.listHead h1:has-text("Insurance portals")');
    await owner.click('[data-act=editFolder]'); await owner.waitForSelector('#fdForm');
    await owner.fill('#fdName', 'Insurance'); await owner.click('.sw.fc-gold'); await owner.click('#fdSave');
    await waitFor(owner, () => Array.from(window.__vault.V.folders.values()).some(f => f.name === 'Insurance'));
    check(await folderId(owner, 'Insurance') !== null, 'folder made and renamed');
    await owner.click('[data-act=editFolder]'); await owner.waitForSelector('#fdDel');
    await owner.click('#fdDel'); await owner.click('.modal [data-yes]');
    await waitFor(owner, () => !Array.from(window.__vault.V.folders.values()).some(f => f.name === 'Insurance'));
    check(true, 'an empty folder can be deleted');

    console.log('\n# Taking Gwen out of one folder');
    await owner.click('[data-act=go][data-v=team]');
    const gwenUid = await state(owner, () => Array.from(window.__vault.V.users.values()).find(u => u.username === 'gwen' && u.active).uid);
    const clin = await folderId(owner, 'Clinical & lab');
    await owner.selectOption('select[data-acc="' + clin + '|' + gwenUid + '"]', '');
    await owner.waitForSelector('#flagChg'); 
    check(!(await owner.isChecked('#flagChg')), 'flagging is off by default when someone just changes jobs');
    await owner.click('.modal [data-yes]');
    await owner.waitForSelector('.toast:has-text("Done")', { timeout: 60000 });
    await waitFor(gwen, () => !Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Oliv portal'), null, 15000);
    const gt = await state(gwen, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).map(i => i.d.t));
    check(!gt.includes('Oliv portal') && gt.includes('Delta Dental provider'), 'Clinical disappears from Gwen’s open vault; Front office stays');
    const cl = await state(owner, n => Array.from(window.__vault.V.folders.values()).find(x => x.name === n).kv, 'Clinical & lab');
    check(cl === 2, 'Clinical got a new key');
    check(!(await itemByTitle(owner, 'Oliv portal')).d.chg, 'and its passwords were not flagged');

    console.log('\n# Gwen forgets her password: reissue');
    await gwen.goto(URL0); await gwen.waitForSelector('#liUser');
    await gwen.fill('#liUser', 'gwen'); await gwen.click('#liForgot');
    check(/reissue your login/.test(await gwen.textContent('.lockCard')), 'staff are told to ask Dr. A');
    await owner.click('[data-act=reissue][data-u="' + gwenUid + '"]'); await owner.click('.modal [data-yes]');
    await owner.waitForSelector('#tmpPw', { timeout: 30000 });
    const tempGwen2 = (await owner.textContent('#tmpPw')).trim();
    await owner.click('.modal .mfoot [data-close]');
    await signIn(gwen, 'gwen', 'copper lantern meadow quilt'); await gwen.waitForSelector('#liErr:not(.hidden)', { timeout: 30000 });
    check(true, 'her old password stopped working');
    await signIn(gwen, 'gwen', tempGwen2); await gwen.waitForSelector('#fpForm', { timeout: 30000 });
    await gwen.fill('#fpPw', 'saffron kettle glacier poem'); await gwen.fill('#fpPw2', 'saffron kettle glacier poem'); await gwen.click('#fpBtn');
    await waitVault(gwen);
    await waitFor(gwen, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 3);
    const gf = await state(gwen, () => window.__vault.S.folderList().map(f => f.name).sort());
    check(gf.join('|') === 'Everyone|Front office', 'the new login has the same folders: ' + gf.join(', '));
    await gwen.context().close();

    console.log('\n# Changing my own password');
    const kay = await addPerson(owner, 'Kaylee', 'kaylee', { 'Everyone': 'view' });
    const kp = await newPage(browser, 'kaylee');
    await signIn(kp, 'kaylee', kay); await kp.waitForSelector('#fpForm', { timeout: 30000 });
    await kp.fill('#fpPw', 'orchid tunnel basil frost'); await kp.fill('#fpPw2', 'orchid tunnel basil frost'); await kp.click('#fpBtn');
    await waitVault(kp);
    await kp.click('[data-act=go][data-v=settings]'); await kp.waitForSelector('#cpForm');
    await kp.fill('#cpCur', 'not my password'); await kp.fill('#cpNew', 'lemon parade cobalt wharf'); await kp.fill('#cpNew2', 'lemon parade cobalt wharf'); await kp.click('#cpBtn');
    await kp.waitForSelector('#cpErr:not(.hidden)', { timeout: 30000 });
    check(/current password isn’t right/.test(await kp.textContent('#cpErr')), 'the wrong current password is refused');
    await kp.fill('#cpCur', 'orchid tunnel basil frost'); await kp.click('#cpBtn');
    await kp.waitForSelector('.toast:has-text("Password changed")', { timeout: 30000 });
    await signIn(kp, 'kaylee', 'lemon parade cobalt wharf'); await waitVault(kp);
    await waitFor(kp, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 1);
    check((await itemByTitle(kp, 'Office Wi-Fi')).d.p === 'braces-glow-orbit-tide', 'signs in with the new password and still reads everything');
    await kp.context().close();

    console.log('\n# Encrypted backup and restore');
    await owner.click('[data-act=go][data-v=backup]'); await owner.waitForSelector('#bkForm');
    await owner.fill('#bkPw', 'tidal mosaic cedar velvet'); await owner.fill('#bkPw2', 'tidal mosaic cedar velvet');
    const [dl] = await Promise.all([owner.waitForEvent('download'), owner.click('#bkBtn')]);
    const bpath = await dl.path();
    const btext = readFileSync(bpath, 'utf8');
    check(/^NLO-Vault-backup-\d{4}-\d\d-\d\d\.nlovault$/.test(dl.suggestedFilename()), 'backup file downloaded: ' + dl.suggestedFilename());
    check(!SECRETS.some(x => x.length >= 4 && btext.includes(x)) && !btext.includes('Front office'), 'the backup file is encrypted (no names or passwords in it)');
    // lose a login, then bring it back from the backup
    const hs2 = await itemByTitle(owner, 'Henry Schein');
    await owner.evaluate(id => window.__vault.S.purgeItem(id), hs2.id);
    await waitFor(owner, () => !Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Henry Schein'));
    await owner.setInputFiles('#rsFile', bpath);
    await owner.fill('#rsPw', 'wrong backup password'); await owner.click('#rsOpen');
    await owner.waitForSelector('#rsErr:not(.hidden)', { timeout: 30000 });
    check(/doesn’t open this file/.test(await owner.textContent('#rsErr')), 'a wrong backup password is refused');
    await owner.fill('#rsPw', 'tidal mosaic cedar velvet'); await owner.click('#rsOpen');
    await owner.waitForSelector('#rsGo', { timeout: 30000 });
    check(/Add 1 login back/.test(await owner.textContent('#rsGo')), 'the backup offers back just the missing login');
    await owner.click('#rsGo');
    await waitFor(owner, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Henry Schein' && !i.del));
    const hs3 = await itemByTitle(owner, 'Henry Schein');
    check(hs3 && hs3.d.p === 'HSchein!902' && hs3.f === await folderId(owner, 'Supplies'), 'restored into its folder with its password');

    console.log('\n# Deleted for good can still be brought back');
    await owner.click('[data-act=go][data-v=all]');
    await openItem(owner, 'Henry Schein');
    await owner.click('[data-act=del]');
    await waitFor(owner, () => { const it = Array.from(window.__vault.V.items.values()).find(i => i.d && i.d.t === 'Henry Schein'); return it && it.del; });
    await owner.fill('#q', ''); await owner.click('[data-act=go][data-v=trash]');
    await owner.click('.row:has-text("Henry Schein")'); await owner.click('[data-act=purge]'); await owner.click('.modal [data-yes]');
    await waitFor(owner, () => !Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Henry Schein'));
    check(true, 'deleted for good from the trash');
    await owner.click('[data-act=deletedForGood]'); await owner.waitForSelector('[data-undel]', { timeout: 15000 });
    check(/Henry Schein/.test(await owner.textContent('.modal')), 'it’s listed under Logins deleted for good');
    await owner.click('[data-undel]');
    await waitFor(owner, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Henry Schein' && !i.del));
    const hs4 = await itemByTitle(owner, 'Henry Schein');
    check(hs4 && hs4.d.p === 'HSchein!902' && hs4.f === await folderId(owner, 'Supplies'), 'brought back into Supplies with its password');
    await owner.click('.modal .mfoot [data-close]');

    console.log('\n# Small things that matter');
    const users = (await dumpDb()).filter(d => /\/users\//.test(d.name));
    check(users.length > 0 && !JSON.stringify(users).includes(OWNER), 'Dr. A’s email isn’t in the people list staff can read');
    // a password change interrupted after the new key copy was saved but before sign-in changed: the old password must still work
    const kayUid = await state(owner, () => Array.from(window.__vault.V.users.values()).find(u => u.username === 'kaylee' && u.active).uid);
    const patch = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/keys/${kayUid}?updateMask.fieldPaths=next`, {
      method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { next: { mapValue: { fields: { iv: { stringValue: 'AAAAAAAAAAAAAAAA' }, ct: { stringValue: 'aGFsZi1maW5pc2hlZCBjaGFuZ2U=' } } } } } })
    });
    check(patch.ok, 'left a half-finished password change behind');
    const kp2 = await newPage(browser, 'kaylee2');
    await signIn(kp2, 'kaylee', 'lemon parade cobalt wharf'); await waitVault(kp2);
    await signIn(kp2, 'kaylee', 'lemon parade cobalt wharf'); await waitVault(kp2);
    await waitFor(kp2, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 1);
    check((await itemByTitle(kp2, 'Office Wi-Fi')) !== null, 'the old password keeps working (twice), nobody locked out');
    const kdoc = await (await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/keys/${kayUid}`, { headers: { Authorization: 'Bearer owner' } })).json();
    check(!('next' in (kdoc.fields || {})), 'the half-made copy was cleaned up');
    await kp2.context().close();
    // a removed person can be given a fresh login (starts with no folders)
    await owner.click('[data-act=go][data-v=team]');
    await owner.click('[data-act=rehire]'); await owner.click('.modal [data-yes]');
    await owner.waitForSelector('#tmpPw', { timeout: 30000 });
    const tempSarah2 = (await owner.textContent('#tmpPw')).trim();
    await owner.click('.modal .mfoot [data-close]');
    const sp2 = await newPage(browser, 'sarah-back');
    await signIn(sp2, 'sarah', tempSarah2); await sp2.waitForSelector('#fpForm', { timeout: 30000 });
    await sp2.fill('#fpPw', 'velvet canyon pickle orbit'); await sp2.fill('#fpPw2', 'velvet canyon pickle orbit'); await sp2.click('#fpBtn');
    await waitVault(sp2); await sleep(1500);
    check((await state(sp2, () => window.__vault.S.folderList().length)) === 0, 'a re-admitted person starts with no folders');
    await sp2.context().close();

    console.log('\n# Dr. A forgets his password (reset email + recovery code)');
    const ow2 = await newPage(browser, 'owner-reset');
    await ow2.goto(URL0); await ow2.waitForSelector('#liUser');
    await ow2.fill('#liUser', OWNER); await ow2.click('#liForgot');
    await ow2.waitForSelector('#foSend'); await ow2.click('#foSend');
    await ow2.waitForSelector('#foG2', { timeout: 15000 });
    const rc = await oob(OWNER, 'PASSWORD_RESET');
    // the link opens the vault itself (best case)
    await ow2.goto(URL0 + '?mode=resetPassword&oobCode=' + encodeURIComponent(rc.oobCode));
    await ow2.waitForSelector('#rlForm');
    const NEW_OWNER_PW = 'walnut fjord saddle comet ivory';
    await ow2.fill('#rlPw', NEW_OWNER_PW); await ow2.fill('#rlPw2', NEW_OWNER_PW); await ow2.fill('#rlCode', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
    await ow2.click('#rlBtn'); await ow2.waitForSelector('#rlErr:not(.hidden)', { timeout: 30000 });
    check(/recovery code doesn’t match/.test(await ow2.textContent('#rlErr')), 'a wrong recovery code is refused');
    // the reset already went through; signing in with the new password now asks for the code
    await signIn(ow2, OWNER, NEW_OWNER_PW);
    await ow2.waitForSelector('#rc2Code', { timeout: 30000 });
    await ow2.fill('#rc2Code', code.toLowerCase()); await ow2.click('#rc2Btn');
    await waitVault(ow2);
    await waitFor(ow2, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 8);
    check((await itemByTitle(ow2, 'Chase business banking')).d.p === 'Ch@seBank-Zx81-Qp', 'back in with the new password + recovery code; everything readable');
    await ow2.context().close();
    // the old password no longer opens it
    const ow3 = await newPage(browser, 'owner-old');
    await signIn(ow3, OWNER, OWNER_PW); await ow3.waitForSelector('#liErr:not(.hidden)', { timeout: 30000 });
    check(true, 'the old password stopped working');
    await signIn(ow3, OWNER, NEW_OWNER_PW); await waitVault(ow3);
    await waitFor(ow3, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 8);
    check(true, 'the new password works on its own afterwards');
    await ow3.context().close();

    // second way: the email link opened Google's own page and he set a new password there
    const ow4 = await newPage(browser, 'owner-google-reset');
    await ow4.goto(URL0); await ow4.waitForSelector('#liUser');
    await ow4.fill('#liUser', OWNER); await ow4.click('#liForgot'); await ow4.waitForSelector('#foSend');
    await ow4.click('#foSend'); await ow4.waitForSelector('#foG2', { timeout: 15000 });
    const rc2 = await oob(OWNER, 'PASSWORD_RESET');
    const RAW = 'harvest pillow neon gazebo';
    const rr = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: rc2.oobCode, newPassword: RAW }) });
    check(rr.ok, 'new password set on "Google’s page" (emulator)');
    await ow4.click('#foG2'); await ow4.waitForSelector('#rgForm');
    const FRESH = 'quarry lilac anvil harbor';
    await ow4.fill('#rgGoogle', RAW); await ow4.fill('#rgPw', RAW); await ow4.fill('#rgPw2', RAW); await ow4.fill('#rgCode', code); await ow4.click('#rgBtn');
    await ow4.waitForSelector('#rgErr:not(.hidden)');
    check(/different from the one you typed on Google/.test(await ow4.textContent('#rgErr')), 'the password Google saw can’t become the vault password');
    await ow4.fill('#rgPw', FRESH); await ow4.fill('#rgPw2', FRESH); await ow4.click('#rgBtn');
    await waitVault(ow4);
    await waitFor(ow4, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 8);
    check(true, 'unlocked with the Google-page password + recovery code, under a new vault password');
    await signIn(ow4, OWNER, RAW); await ow4.waitForSelector('#liErr:not(.hidden)', { timeout: 30000 });
    check(true, 'the password Google saw no longer opens anything');
    await signIn(ow4, OWNER, FRESH); await waitVault(ow4);
    check(true, 'the new vault password works for normal sign-in');
    await ow4.context().close();

    console.log('\n# Auto-lock');
    await owner.evaluate(() => { const real = Date.now; Date.now = () => real() + 61 * 60000; });
    await owner.waitForURL(/locked=idle|\/$/, { timeout: 15000 }).catch(() => { });
    await owner.waitForSelector('#liUser', { timeout: 15000 });
    check(/locked itself/.test(await owner.textContent('.lockCard')), 'locks itself after the idle time');

    console.log('\n# Phone');
    const phone = await newPage(browser, 'phone', { width: 390, height: 844 });
    await signIn(phone, 'gwen', 'saffron kettle glacier poem'); await waitVault(phone);
    await waitFor(phone, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 4);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!wide, 'no sideways scrolling on a phone');
    await phone.screenshot({ path: SHOTS + '07-phone-list.png' });
    await phone.click('.row >> nth=0'); await phone.waitForSelector('.app.detailOpen');
    await sleep(300); await phone.screenshot({ path: SHOTS + '08-phone-detail.png' });
    check(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'login details fit a phone');

    console.log('\n# Someone using Dr. A’s sign-in (but not his keys) tries to slip in a key of their own');
    const ownerB = await newPage(browser, 'owner-b');
    await signIn(ownerB, OWNER, FRESH); await waitVault(ownerB);
    await waitFor(ownerB, () => window.__vault.V.loaded && Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 8);
    const fFront = await folderId(ownerB, 'Front office');
    const gUid = await state(phone, () => window.__vault.V.uid);
    await ownerB.evaluate(([f, u]) => window.__vault.S.setAccess(f, u, 'edit'), [fFront, gUid]);
    await waitFor(phone, f => window.__vault.S.canEdit(f), fFront);
    const ownerUid = await state(ownerB, () => window.__vault.V.uid);
    const gPub = await state(ownerB, u => window.__vault.V.users.get(u).pub, gUid);
    const deltaB = await itemByTitle(ownerB, 'Delta Dental provider');
    // the attacker: Dr. A's Firebase sign-in on another computer, so the database rules treat them as Dr. A
    const aApp = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: 'attacker' }, 'attacker');
    const aAuth = initializeAuth(aApp, { persistence: inMemoryPersistence }); connectAuthEmulator(aAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const aDb = initializeFirestore(aApp, {}); connectFirestoreEmulator(aDb, '127.0.0.1', 8080);
    await signInWithEmailAndPassword(aAuth, OWNER, (await C.deriveMaster(FRESH, OWNER)).authPw);
    const fd = (await fget(fdoc(aDb, 'folders/' + fFront))).data();
    const nkv = fd.kv + 1, K = C.rnd(32), kK = await C.aesKey(K), forger = await C.newSignPair();
    const b1 = fbatch(aDb);
    b1.update(fdoc(aDb, 'folders/' + fFront), { kv: nkv, ['ks.' + nkv]: await C.signFolderKey(forger.privateKey, fFront, nkv, K), name: await C.sealJSON(kK, { n: 'Front office' }, C.AAD.folder(fFront, nkv)), at: fts(), by: ownerUid });
    b1.update(fdoc(aDb, 'grants/' + gUid + '_' + fFront), { ['keys.' + nkv]: await C.sealTo(gPub, K, C.AAD.grant(gUid, fFront, nkv)), at: fts(), by: ownerUid });
    await b1.commit();
    const plantId = C.newId(20), cur = (await fget(fdoc(aDb, 'items/' + deltaB.id))).data();
    const pBox = await C.sealJSON(kK, { t: 'Payroll portal (new)', u: 'nlo-pay', p: 'Planted-Pw-4417' }, C.AAD.item(plantId, fFront, nkv));
    const dBox = await C.sealJSON(kK, { t: 'Delta Dental provider', u: 'nlo_front', p: 'Attacker-Knows-8812' }, C.AAD.item(deltaB.id, fFront, nkv));
    const b2 = fbatch(aDb);
    b2.set(fdoc(aDb, 'items/' + plantId), { f: fFront, kv: nkv, iv: pBox.iv, ct: pBox.ct, rev: 1, at: fts(), cAt: fts(), by: ownerUid, del: false });
    b2.update(fdoc(aDb, 'items/' + deltaB.id), { kv: nkv, iv: dBox.iv, ct: dBox.ct, rev: cur.rev + 1, at: fts(), by: ownerUid });
    b2.set(fdoc(aDb, 'versions/' + deltaB.id + '_' + cur.rev), { i: deltaB.id, f: cur.f, kv: cur.kv, iv: cur.iv, ct: cur.ct, rev: cur.rev, del: cur.del, at: fts(), by: ownerUid });
    await b2.commit();
    check(true, 'the rules let them add a key of their own to Gwen’s copy, slip in a login and overwrite one');
    await waitFor(phone, f => window.__vault.S.keyTrouble(f) === 'unsigned', fFront, 20000);
    check(await state(phone, f => window.__vault.S.keyTrouble(f), fFront) === 'unsigned', 'Gwen’s vault refuses that key: it isn’t signed by Dr. A');
    const seen = await state(phone, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).map(i => i.d.p));
    check(!seen.includes('Planted-Pw-4417') && !seen.includes('Attacker-Knows-8812'), 'nothing locked with it is shown to her as real');
    check(await state(phone, id => window.__vault.S.untrusted(window.__vault.V.items.get(id)), deltaB.id), 'the overwritten login shows as locked with a key Dr. A didn’t make');
    const trySave = await phone.evaluate(f => window.__vault.S.saveItem(null, f, { t: 'Lab supply portal', p: 'Lab-Supply-5531!' }).then(() => 'saved', e => e.code || String(e)), fFront);
    check(trySave === 'no-key', 'she can’t save anything with it, so a new password never gets locked with their key (' + trySave + ')');
    if (await phone.isVisible('[data-act=back]')) await phone.click('[data-act=back]');
    await phone.click('[data-act=menu]'); await phone.click('[data-act=go][data-v="folder:' + fFront + '"]');
    await phone.waitForSelector('.callout.hot');
    check(/isn’t signed by Dr\. A/.test(await phone.textContent('.callout.hot')), 'her screen says so and tells her to tell Dr. A');
    await sleep(300); await phone.screenshot({ path: SHOTS + '09-phone-unsigned-key.png' });
    await waitFor(ownerB, f => window.__vault.S.keyTrouble(f) === 'missing', fFront, 20000);
    await ownerB.click('[data-act=go][data-v="folder:' + fFront + '"]');
    await ownerB.waitForSelector('.callout.hot [data-act=repairKey]');
    check(/wasn’t made by you/.test(await ownerB.textContent('.callout.hot')), 'Dr. A is told the folder’s key wasn’t made by him');
    await ownerB.screenshot({ path: SHOTS + '10-owner-new-key.png' });
    // he opens the vault fresh, so the folder's name (sealed with their key) can't be read, then makes a new key
    await signIn(ownerB, OWNER, FRESH); await waitVault(ownerB);
    await waitFor(ownerB, f => window.__vault.S.keyTrouble(f) === 'missing', fFront, 20000);
    check(await state(ownerB, f => !window.__vault.V.folders.get(f).named, fFront), 'opened fresh, the folder’s name can’t be read (their key sealed it)');
    await ownerB.click('[data-act=go][data-v="folder:' + fFront + '"]');
    await ownerB.waitForSelector('.callout.hot [data-act=repairKey]');
    await ownerB.click('[data-act=repairKey]'); await ownerB.waitForSelector('#rkName');
    await ownerB.click('.modal [data-yes]');
    check(/Type the folder’s name/.test(await ownerB.textContent('#rkErr')), 'so he is asked for it');
    await ownerB.fill('#rkName', 'Front office'); await ownerB.click('.modal [data-yes]');
    await ownerB.waitForSelector('.toast:has-text("Done")', { timeout: 60000 });
    const fb = await state(ownerB, f => { const x = window.__vault.V.folders.get(f); return { kv: x.kv, t: window.__vault.S.keyTrouble(f), rot: !!x.rot }; }, fFront);
    check(fb.kv === nkv + 1 && !fb.t && !fb.rot, 'one click gives the folder a new key he signed (version ' + fb.kv + ')');
    check(await folderId(ownerB, 'Front office') === fFront, 'with its name back');
    check(await state(ownerB, id => !window.__vault.V.rawItems.has(id), plantId), 'the slipped-in login is gone');
    const dB = await itemByTitle(ownerB, 'Delta Dental provider');
    check(dB && dB.d.p === 'DdP-4471-x!' && dB.kv === nkv + 1, 'the overwritten login is back to its last real version');
    check((await state(ownerB, id => Object.keys(window.__vault.V.grants.get(id).keys), gUid + '_' + fFront)).join() === String(nkv + 1), 'Gwen’s copy now holds only the new key');
    await waitFor(phone, ([f, id, v]) => { const it = window.__vault.V.items.get(id); return !window.__vault.S.keyTrouble(f) && it && it.d && it.kv === v; }, [fFront, deltaB.id, nkv + 1], 20000);
    check(((await itemByTitle(phone, 'Delta Dental provider')) || { d: {} }).d.p === 'DdP-4471-x!' && await folderId(phone, 'Front office') === fFront, 'Gwen reads it again (and sees the folder’s name)');
    const saved = await phone.evaluate(f => window.__vault.S.saveItem(null, f, { t: 'Lab supply portal', p: 'Lab-Supply-5531!' }).then(() => 'saved', e => e.code || String(e)), fFront);
    check(saved === 'saved', 'and she can save into the folder again');
    SECRETS.push('Lab-Supply-5531!');
    await waitFor(ownerB, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Lab supply portal'));
    check(true, 'Dr. A sees what she saved');
    await ownerB.context().close();

    console.log('\n# …nor add people or places of their own, block key changes, or touch Dr. A’s key');
    const ownerC = await newPage(browser, 'owner-c');
    await signIn(ownerC, OWNER, FRESH); await waitVault(ownerC);
    await waitFor(ownerC, () => window.__vault.V.loaded && Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 9);
    const fDra = await folderId(ownerC, 'Dr. A only'), fEvery = await folderId(ownerC, 'Everyone');
    const ownerPub = await state(ownerC, () => window.__vault.V.pub);
    const allF = await state(ownerC, () => window.__vault.S.folderList().map(f => f.id));
    // 1. a "person" of their own (their own account and key pair, named like a real staffer), with places in every folder
    const su = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'eve@evil.test', password: 'eve-password-123', returnSecureToken: true }) })).json();
    const EVE = su.localId, eve = await C.newPair(), evePub = await C.pubJwk(eve);
    const b3 = fbatch(aDb);
    b3.set(fdoc(aDb, 'users/' + EVE), { name: 'Gwen W.', username: 'gwenw', role: 'staff', active: true, pub: evePub, n: 1, at: fts(), by: ownerUid });
    for (const fid of allF) {
      const kvx = (await fget(fdoc(aDb, 'folders/' + fid))).data().kv;
      b3.set(fdoc(aDb, 'grants/' + EVE + '_' + fid), { uid: EVE, fid, role: 'view', keys: { [kvx]: await C.sealTo(evePub, C.rnd(32), C.AAD.grant(EVE, fid, kvx)) }, by: ownerUid, at: fts() });
    }
    // 2. a place for real staff in a folder Dr. A never gave her, and a fake "key change didn't finish" to get him to click
    const draKv = (await fget(fdoc(aDb, 'folders/' + fDra))).data().kv;
    b3.set(fdoc(aDb, 'grants/' + gUid + '_' + fDra), { uid: gUid, fid: fDra, role: 'view', keys: { [draKv]: await C.sealTo(gPub, C.rnd(32), C.AAD.grant(gUid, fDra, draKv)) }, by: ownerUid, at: fts() });
    b3.update(fdoc(aDb, 'folders/' + fDra), { rot: { from: draKv, to: draKv, why: '' }, at: fts(), by: ownerUid });
    await b3.commit();
    // 3. block Everyone's next key change (fill its next slots, or jump its version), and move a Dr. A only login into
    //    Everyone (as junk: they can't re-lock it with Everyone's key)
    const ed = (await fget(fdoc(aDb, 'folders/' + fEvery))).data();
    const blk = [
      await fupdate(fdoc(aDb, 'folders/' + fEvery), { ['ks.' + (ed.kv + 1)]: 'junk-signature', at: fts(), by: ownerUid }).then(() => 'written', e => e.code),
      await fupdate(fdoc(aDb, 'grants/' + ownerUid + '_' + fEvery), { ['keys.' + (ed.kv + 1)]: await C.sealTo(ownerPub, C.rnd(32), C.AAD.grant(ownerUid, fEvery, ed.kv + 1)), at: fts(), by: ownerUid }).then(() => 'written', e => e.code),
      await fupdate(fdoc(aDb, 'folders/' + fEvery), { kv: 9007199254740991, at: fts(), by: ownerUid }).then(() => 'written', e => e.code)];
    check(blk.every(x => x === 'permission-denied'), 'they can’t block a key change (pre-filled slots, a huge version number): ' + blk.join(', '));
    const pxId = (await itemByTitle(ownerC, 'Paychex Flex')).id, pcur = (await fget(fdoc(aDb, 'items/' + pxId))).data();
    const b4 = fbatch(aDb);
    b4.update(fdoc(aDb, 'items/' + pxId), { f: fEvery, kv: ed.kv, iv: 'AAAAAAAAAAAAAAAA', ct: C.b64(C.rnd(300)), rev: pcur.rev + 1, at: fts(), by: ownerUid });
    b4.set(fdoc(aDb, 'versions/' + pxId + '_' + pcur.rev), { i: pxId, f: pcur.f, kv: pcur.kv, iv: pcur.iv, ct: pcur.ct, rev: pcur.rev, del: pcur.del, at: fts(), by: ownerUid });
    await b4.commit();
    // …and steer "bring back": hide Dr. A only and put Everyone first
    await fupdate(fdoc(aDb, 'folders/' + fEvery), { order: -1, at: fts(), by: ownerUid });
    check(true, 'the rules let them add a person of their own, places in folders, a fake unfinished key change, and move a login');
    // 4. Dr. A's own key copy
    const kw = await fupdate(fdoc(aDb, 'keys/' + ownerUid), { wrap: { iv: 'AAAAAAAAAAAAAAAA', ct: 'anVuaw==' }, at: fts() }).then(() => 'written', e => e.code);
    check(kw === 'permission-denied', 'but they can’t overwrite Dr. A’s own key copy (no token from his password): ' + kw);
    const kw2 = await fupdate(fdoc(aDb, 'keys/' + ownerUid), { rec: { salt: 'c2FsdA==', iter: 100000, iv: 'AAAAAAAAAAAAAAAA', ct: 'anVuaw==' }, at: fts() }).then(() => 'written', e => e.code);
    check(kw2 === 'permission-denied', '…nor his recovery copy');
    await waitFor(phone, f => !!window.__vault.V.folders.get(f), fDra, 15000);
    check(await state(phone, f => { const x = window.__vault.V.folders.get(f); return x ? x.keys.size : 0; }, fDra) === 0, 'the place slipped into Gwen’s vault gives her no usable key');
    // what Dr. A sees
    await ownerC.click('[data-act=go][data-v=team]');
    await ownerC.waitForSelector('.badge.hot:has-text("Not added by you")', { timeout: 15000 });
    check((await ownerC.$$('.acc-bad')).length >= allF.length + 1, 'People & access flags the person and every place he didn’t give');
    check(/weren’t made by you|wasn’t made by you/.test(await ownerC.textContent('.callout.hot')), 'and says what to do');
    await ownerC.screenshot({ path: SHOTS + '11-not-added-by-you.png', fullPage: true });
    // he clicks "Finish now" on the fake unfinished key change
    await ownerC.waitForSelector('[data-act=resumeRot]', { timeout: 15000 });
    await ownerC.click('[data-act=resumeRot]');
    await ownerC.waitForSelector('.toast:has-text("Done")', { timeout: 60000 });
    const gl = await state(ownerC, ([a, b]) => [window.__vault.V.grants.has(a), window.__vault.V.grants.has(b)], [gUid + '_' + fDra, EVE + '_' + fDra]);
    check(!gl[0] && !gl[1], 'finishing it hands out nothing: the places he never gave are removed instead');
    await waitFor(phone, f => !window.__vault.S.folderList().some(x => x.id === f), fDra, 15000);
    check(true, 'Dr. A only disappears from Gwen’s vault again');
    // he takes Kaylee out of Everyone: a key change with a moved-in login in the way
    await ownerC.evaluate(([f, u]) => window.__vault.S.setAccess(f, u, null, {}), [fEvery, kayUid]);
    const ev2 = await state(ownerC, f => { const x = window.__vault.V.folders.get(f); return { kv: x.kv, rot: !!x.rot, t: window.__vault.S.keyTrouble(f) }; }, fEvery);
    check(ev2.kv === ed.kv + 1 && !ev2.rot && !ev2.t, 'the key change goes through (version ' + ed.kv + ' → ' + ev2.kv + ')');
    check(!(await state(ownerC, g => window.__vault.V.grants.has(g), kayUid + '_' + fEvery)), 'Kaylee’s place went in the same write');
    check(!(await state(ownerC, g => window.__vault.V.grants.has(g), EVE + '_' + fEvery)), 'the fake person gets no key: their place is removed');
    check(await state(ownerC, id => !window.__vault.V.rawItems.has(id), pxId), 'the moved login is taken out of Everyone, not re-locked there');
    check(!(await state(phone, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Paychex Flex'))), 'Everyone’s members never see it');
    const gone = await ownerC.evaluate(() => window.__vault.S.deletedItems());
    const pxe = gone.find(x => x.i === pxId);
    check(pxe && pxe.d && pxe.d.p === 'Pay-Flex-7781!' && pxe.f === fDra, 'Logins deleted for good shows its real last version, in Dr. A only');
    await fupdate(fdoc(aDb, 'folders/' + fDra), { gone: true, at: fts(), by: ownerUid });   // hidden just before he brings it back
    await waitFor(ownerC, f => window.__vault.V.folders.get(f).gone, fDra);
    await ownerC.evaluate(e => window.__vault.S.undelete(e), pxe);
    await waitFor(ownerC, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.t === 'Paychex Flex' && !i.del));
    const px2 = await itemByTitle(ownerC, 'Paychex Flex');
    check(px2 && px2.f === fDra && px2.d.p === 'Pay-Flex-7781!', 'and brings it back into Dr. A only (even hidden, with Everyone moved first)');
    check(await state(ownerC, () => { const p = window.__vault.S.privateFolder(); return p && p.name; }) === 'Dr. A only', 'new logins and imports still default to Dr. A only (sealed, not by order)');
    // nothing sealed to the fake person is a real key
    const realKeys = new Set(await state(ownerC, () => Array.from(window.__vault.V.folders.values()).flatMap(f => Array.from(f.raw.values()).map(r => Array.from(r).map(b => b.toString(16).padStart(2, '0')).join('')))));
    const eveGrants = (await fgetAll(fquery(fcol(aDb, 'grants'), fwhere('uid', '==', EVE)))).docs.map(x => x.data());
    let realOpened = 0;
    for (const g of eveGrants) for (const [kvx, box] of Object.entries(g.keys)) {
      try { const r = await C.openFrom(eve.privateKey, box, C.AAD.grant(EVE, g.fid, Number(kvx))); if (realKeys.has(Array.from(r).map(b => b.toString(16).padStart(2, '0')).join(''))) realOpened++; } catch (e) { }
    }
    check(realOpened === 0, 'not one real folder key was ever sealed to the fake person (' + eveGrants.length + ' places left to check)');
    // removing the fake person clears the warnings
    await ownerC.evaluate(u => window.__vault.S.removePerson(u, { flag: false }), EVE);
    await waitFor(ownerC, () => window.__vault.S.untrustedCount() === 0, null, 30000);
    check(await state(ownerC, () => window.__vault.S.untrustedCount()) === 0, 'removing the fake person clears every warning');

    console.log('\n# Edit → view gives the folder a new key');
    const fv0 = await state(ownerC, f => window.__vault.V.folders.get(f).kv, fFront);
    await ownerC.evaluate(([f, u]) => window.__vault.S.setAccess(f, u, 'view', {}), [fFront, gUid]);
    const fv1 = await state(ownerC, f => window.__vault.V.folders.get(f).kv, fFront);
    check(fv1 === fv0 + 1, 'Front office moved to key version ' + fv1 + ' (her old “edit” signature can’t be put back)');
    check(await state(ownerC, g => window.__vault.V.grants.get(g).role, gUid + '_' + fFront) === 'view', 'in the same write as her change to view');
    await waitFor(phone, f => !window.__vault.S.canEdit(f), fFront, 15000);
    check(!(await state(phone, f => window.__vault.S.canEdit(f), fFront)), 'Gwen is view-only in Front office');
    check(await state(ownerC, () => window.__vault.S.untrustedCount()) === 0, 'and her place is signed for the new version and role');

    console.log('\n# Dr. A changes his own password and recovery code');
    await ownerC.click('[data-act=go][data-v=settings]'); await ownerC.waitForSelector('#cpForm');
    const NEWEST = 'tundra pocket fennel marble';
    await ownerC.fill('#cpCur', FRESH); await ownerC.fill('#cpNew', NEWEST); await ownerC.fill('#cpNew2', NEWEST); await ownerC.click('#cpBtn');
    await ownerC.waitForSelector('.toast:has-text("Password changed")', { timeout: 30000 });
    check(true, 'password changed (his key copy updated with tokens from the old and new password)');
    await ownerC.click('[data-act=newCode]'); await ownerC.waitForSelector('#ncPw');
    await ownerC.fill('#ncPw', NEWEST); await ownerC.click('#ncBtn');
    await ownerC.waitForSelector('.modal #rcCode', { timeout: 30000 });
    const code2 = (await ownerC.textContent('.modal #rcCode')).trim();
    await ownerC.fill('.modal #rcConfirm', code2.slice(-4)); await ownerC.click('.modal #rcBtn');
    await ownerC.waitForSelector('.toast:has-text("New recovery code saved")', { timeout: 15000 });
    check(code2 !== code, 'a new recovery code was made');
    await ownerC.context().close();
    const ow5 = await newPage(browser, 'owner-newest');
    await signIn(ow5, OWNER, FRESH); await ow5.waitForSelector('#liErr:not(.hidden)', { timeout: 30000 });
    check(true, 'the old password no longer works');
    await signIn(ow5, OWNER, NEWEST); await waitVault(ow5);
    await waitFor(ow5, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 9);
    check((await itemByTitle(ow5, 'Chase business banking')).d.p === 'Ch@seBank-Zx81-Qp', 'the new one opens everything');
    // forgot it again: reset link + recovery code; the old code is refused, the new one works
    await ow5.goto(URL0); await ow5.waitForSelector('#liUser');
    await ow5.fill('#liUser', OWNER); await ow5.click('#liForgot'); await ow5.waitForSelector('#foSend'); await ow5.click('#foSend');
    await ow5.waitForSelector('#foG2', { timeout: 15000 });
    const rc3 = await oob(OWNER, 'PASSWORD_RESET');
    await ow5.goto(URL0 + '?mode=resetPassword&oobCode=' + encodeURIComponent(rc3.oobCode)); await ow5.waitForSelector('#rlForm');
    const LAST = 'violet harbor canyon sprout';
    await ow5.fill('#rlPw', LAST); await ow5.fill('#rlPw2', LAST); await ow5.fill('#rlCode', code); await ow5.click('#rlBtn');
    await ow5.waitForSelector('#rlErr:not(.hidden)', { timeout: 30000 });
    check(/recovery code doesn’t match/.test(await ow5.textContent('#rlErr')), 'the old recovery code no longer works');
    await signIn(ow5, OWNER, LAST); await ow5.waitForSelector('#rc2Code', { timeout: 30000 });
    await ow5.fill('#rc2Code', code2); await ow5.click('#rc2Btn');
    await waitVault(ow5);
    await waitFor(ow5, () => Array.from(window.__vault.V.items.values()).filter(i => i.d).length >= 9);
    check((await itemByTitle(ow5, 'Chase business banking')).d.p === 'Ch@seBank-Zx81-Qp', 'the new recovery code gets him back in');
    await ow5.context().close();
  } catch (e) {
    check(false, 'test crashed: ' + (e && e.stack || e));
    for (const [n, p] of [['owner', owner], ['sarah', sarah]]) if (p) try { await p.screenshot({ path: SHOTS + 'crash-' + n + '.png', fullPage: true }); } catch (x) { }
  }
  const csp = [];
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) try { csp.push(...(await p.evaluate(() => (window.__csp || []).filter(v => !/cleardot\.gif/.test(v))))); } catch (e) { }
  check(csp.length === 0, 'no security-policy violations' + (csp.length ? ': ' + csp.slice(0, 5).join(' | ') : ''));
  check(errs.length === 0, 'no page errors' + (errs.length ? ':\n    ' + errs.slice(0, 8).join('\n    ') : ''));
  await browser.close(); srv.close();
  console.log(`\n${passes.length} passed, ${fails.length} failed`);
  if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  '));
  process.exit(fails.length ? 1 : 0);
})();
