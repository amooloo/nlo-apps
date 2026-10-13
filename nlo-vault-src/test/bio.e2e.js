// Face ID on Dr. A's phone, end to end: the real built page in Chromium dressed as an iPhone, with a virtual Face ID
// authenticator (passkeys with the PRF secret), against the Firebase emulators, served with the production headers.
// Made-up logins only.
//   npx firebase emulators:exec --config firebase.test.json --only firestore,auth --project demo-nlo-vault "node test/bio.e2e.js"
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { mkdirSync } from 'fs';
import * as C from '../src/crypto.js';

// passkeys need a real host name, so the page is opened on localhost (not 127.0.0.1)
const PORT = 8772, URL0 = 'http://localhost:' + PORT + '/', PROJECT = 'demo-nlo-vault';
const OWNER = 'dr.test@example.com', PW1 = 'maple river cocoa lamp desk', PW2 = 'harbor quilt meadow ember', PW3 = 'cobalt tundra fennel parade';
const SARAH_PW = 'pebble harbor violet engine';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const SHOTS = new URL('../shots/', import.meta.url).pathname; mkdirSync(SHOTS, { recursive: true });
const fails = [], passes = [], errs = [];
const check = (c, m) => { (c ? passes : fails).push(m); console.log((c ? '  ok  ' : '  FAIL') + ' ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
/* a browser tab: a computer, or an iPhone (optionally with Face ID that can or can't give out the PRF secret) */
async function newPage(browser, label, o) {
  o = o || {};
  const ctx = await browser.newContext(o.phone ? { viewport: { width: 390, height: 844 }, userAgent: IPHONE, hasTouch: true } : { viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ' pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/PERMISSION_DENIED|permission-denied|Missing or insufficient permissions|evaluation error at|false for '|400 \(Bad Request\)|status of 400|google\.com\/images\/cleardot\.gif/.test(m.text())) errs.push(label + ' console: ' + m.text()); });
  await p.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.sample || '').slice(0, 60)); }); });
  // test hooks around the browser's passkey calls (the real calls still run): count them, and when asked, act like
  // a person tapping Cancel, or like an iPhone that gives out the secret only when the passkey is used, not when made
  await p.addInitScript(() => {
    const c = navigator.credentials; if (!c) return;
    const og = c.get.bind(c), oc = c.create.bind(c);
    const n = k => +(sessionStorage.getItem(k) || 0), inc = k => sessionStorage.setItem(k, String(n(k) + 1));
    c.get = async o => {
      inc('__gets');
      if (n('__cancel') > 0) { sessionStorage.setItem('__cancel', String(n('__cancel') - 1)); throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'); }
      return og(o);
    };
    c.create = async o => {
      inc('__creates');
      const cr = await oc(o);
      if (cr && sessionStorage.getItem('__noPrfAtCreate') === '1') {
        const g = cr.getClientExtensionResults.bind(cr);
        Object.defineProperty(cr, 'getClientExtensionResults', { value: () => { const r = g(); if (r.prf) r.prf = { enabled: true }; return r; } });
      }
      return cr;
    };
  });
  if (o.faceId) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const r = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: o.faceId === 'qr' ? 'hybrid' : 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: o.faceId !== 'no-prf' } });
    p.cdp = cdp; p.authId = r.authenticatorId;
  }
  return p;
}
const passkeys = async p => (await p.cdp.send('WebAuthn.getCredentials', { authenticatorId: p.authId })).credentials;
/* the phone deletes a passkey a moment after it's asked to */
async function passkeyCount(p, want) { const end = Date.now() + 3000; let n; while ((n = (await passkeys(p)).length) !== want && Date.now() < end) await sleep(100); return n; }
const counts = p => p.evaluate(() => ({ gets: +(sessionStorage.getItem('__gets') || 0), creates: +(sessionStorage.getItem('__creates') || 0) }));
const setFlag = (p, k, v) => p.evaluate(([k, v]) => sessionStorage.setItem(k, v), [k, v]);
const rec = p => p.evaluate(() => localStorage.getItem('nloVault.bio'));
async function signIn(p, user, pw) {
  await p.goto(URL0); await p.waitForSelector('#liUser');
  await p.fill('#liUser', user); await p.fill('#liPw', pw); await p.click('#liBtn');
}
const waitVault = p => p.waitForSelector('#app .listHead', { timeout: 30000 });
const state = (p, fn, arg) => p.evaluate(fn, arg);
async function waitFor(p, fn, arg, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) { if (await state(p, fn, arg)) return true; await sleep(150); }
  return false;
}
async function folderId(p, name) { return state(p, n => { const f = Array.from(window.__vault.V.folders.values()).find(x => x.name === n); return f ? f.id : null; }, name); }
async function settings(p) {
  if (await p.isVisible('[data-act=menu]')) await p.click('[data-act=menu]');
  await p.click('[data-act=go][data-v=settings]'); await p.waitForSelector('#cpForm');
}
/* the lock button: the page reloads (nothing stays in memory) */
async function lockAndReload(p) {
  // (on a phone the side menu may be open over the top bar: then its own lock button)
  const sel = (await p.$('#app.sideOpen')) ? '.sideFoot [data-act=lock]' : '.lockBtn';
  await Promise.all([p.waitForEvent('load'), p.click(sel)]);
}
async function turnOn(p, pw) {
  await p.waitForSelector('#stBio:not(.hidden) #bioOnBtn'); await p.click('#bioOnBtn'); await p.waitForSelector('#boPw');
  await p.fill('#boPw', pw); await p.click('#boBtn');
}
async function addPerson(owner, name, username, access) {
  await owner.click('[data-act=go][data-v=team]'); await owner.click('[data-act=addPerson]');
  await owner.fill('#apName', name); await owner.fill('#apUser', username);
  for (const [fname, role] of Object.entries(access || {})) await owner.selectOption('select[data-af="' + await folderId(owner, fname) + '"]', role);
  await owner.click('#apBtn');
  await owner.waitForSelector('#tmpPw', { timeout: 30000 });
  const temp = (await owner.textContent('#tmpPw')).trim();
  await owner.click('.modal .mfoot [data-close]');
  return temp;
}

/* the Lock button: the page reloads (nothing stays in memory) and waits for a tap — it doesn't ask for Face ID by itself */
async function lockThenTap(p) {
  const before = (await counts(p)).gets;
  await lockAndReload(p); await p.waitForSelector('#bioBtn'); await sleep(700);
  const asked = (await counts(p)).gets !== before;
  await p.click('#bioBtn'); await waitVault(p);
  return !asked;
}
async function nav(p, v) {
  if (await p.isVisible('[data-act=menu]')) await p.click('[data-act=menu]');
  await p.click('[data-act=go][data-v="' + v + '"]');
}
/* sign-in accounts in the emulator (to prove nothing was made) */
async function authCount() {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`,
    { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ returnUserInfo: false }) });
  return +((await r.json()).recordsCount);
}
const session = p => state(p, () => ({ sign: !!window.__vault.V.spriv, lock: !!(window.__vault.V._m && window.__vault.V._m.lockKey), wrap: !!(window.__vault.V._m && window.__vault.V._m.wrapKey), face: !!window.__vault.V.viaDevice }));

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const srv = await serve(new URL('../dist-test/public', import.meta.url).pathname, new URL('../dist-test/headers.json', import.meta.url).pathname, PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  let ph = null;
  try {
    console.log('\n# Dr. A sets up a vault (on a computer)');
    const desk = await newPage(browser, 'computer');
    await desk.goto(URL0); await desk.waitForSelector('#liUser');
    await desk.click('#liSetup'); await desk.waitForSelector('#suForm');
    await desk.fill('#suEmail', OWNER); await desk.fill('#suName', 'Dr. A');
    await desk.fill('#suPw', PW1); await desk.fill('#suPw2', PW1); await desk.click('#suBtn');
    await desk.waitForSelector('#vfBtn', { timeout: 30000 });
    await fetch((await oob(OWNER, 'VERIFY_EMAIL')).oobLink);
    await desk.click('#vfBtn'); await desk.waitForSelector('#rcCode', { timeout: 30000 });
    const code = (await desk.textContent('#rcCode')).trim();
    await desk.fill('#rcConfirm', code.slice(-4)); await desk.click('#rcBtn');
    await waitVault(desk);
    await waitFor(desk, () => window.__vault.V.loaded && window.__vault.V.folders.size === 4);
    const fDr = await folderId(desk, 'Dr. A only'), fFront = await folderId(desk, 'Front office');
    await desk.evaluate(f => window.__vault.S.saveItem(null, f, { t: 'Chase business banking', u: 'nlo-owner-77', p: 'Ch@seBank-Zx81-Qp' }), fDr);
    await desk.evaluate(f => window.__vault.S.saveItem(null, f, { t: 'Delta Dental provider', u: 'nlo_front', p: 'D3lta-Front-55!' }), fFront);
    const tempSarah = await addPerson(desk, 'Sarah B.', 'sarah', { 'Front office': 'edit' });
    check(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tempSarah), 'vault ready: two logins, and Sarah added (Front office)');
    await settings(desk); await sleep(800);
    await desk.waitForSelector('#stBio:not(.hidden) #bioOnBtn');
    check(/Unlock with your iPhone/.test(await desk.textContent('#stBio h2')) && !/Turn on Face ID/.test(await desk.textContent('#stBio')), 'on a computer, Dr. A’s Settings offer “Unlock with your iPhone” (not Face ID on the computer itself)');
    await desk.context().close();

    console.log('\n# An iPhone whose passkeys aren’t set up (no Face ID/passcode for them)');
    const bare = await newPage(browser, 'iphone-bare', { phone: true });
    await signIn(bare, OWNER, PW1); await waitVault(bare);
    await settings(bare); await sleep(800);
    check(await bare.isHidden('#stBio'), 'not offered there');
    await bare.context().close();

    console.log('\n# Dr. A turns on Face ID on his iPhone');
    ph = await newPage(browser, 'iphone', { phone: true, faceId: true });
    await signIn(ph, OWNER, PW1); await waitVault(ph);
    await settings(ph);
    await ph.waitForSelector('#stBio:not(.hidden) #bioOnBtn');
    const offer = await ph.textContent('#stBio');
    check(/^Face ID$/.test((await ph.textContent('#stBio h2')).trim()) && /Only on your own iPhone/.test(offer) && /not people, access or folder keys/.test(offer) && /Stolen Device Protection/.test(offer),
      'Settings offers Face ID for this iPhone, saying what someone with the phone could and couldn’t do');
    await sleep(300); await ph.screenshot({ path: SHOTS + 'bio-01-settings-off.png', fullPage: true });
    await turnOn(ph, 'not my password at all');
    await ph.waitForSelector('#boErr:not(.hidden)', { timeout: 30000 });
    check(/isn’t your vault password/.test(await ph.textContent('#boErr')) && !(await rec(ph)) && (await counts(ph)).creates === 0, 'a wrong password is refused before Face ID is even asked');
    const t0 = await counts(ph);
    await ph.fill('#boPw', PW1); await ph.click('#boBtn');
    await ph.waitForSelector('.toast:has-text("Face ID is on for this iPhone")', { timeout: 30000 });
    await ph.waitForSelector('#stBio .bioOn');
    const t1 = await counts(ph);
    check(/On for this iPhone/.test(await ph.textContent('#stBio')) && t1.creates === t0.creates + 1 && t1.gets === t0.gets + 1, 'turned on: one passkey made, then used once to check it works');
    await sleep(300); await ph.screenshot({ path: SHOTS + 'bio-02-settings-on.png', fullPage: true });
    const ownerUid = await state(ph, () => window.__vault.V.uid);
    const r1 = JSON.parse(await rec(ph));
    check(!!r1 && r1.v === 1 && r1.login === OWNER && r1.uid === ownerUid && r1.name === 'Dr. A' && !!r1.box && !!r1.salt && !!r1.id, 'the phone keeps a locked copy for Dr. A');
    const m1 = await C.deriveMaster(PW1, OWNER);
    check(!JSON.stringify(r1).includes(PW1) && !JSON.stringify(r1).includes(m1.authPw) && C.unb64(r1.box.ct).length === 272, '…sealed (no password or sign-in secret readable in it)');
    const pk1 = await passkeys(ph);
    check(pk1.length === 1 && pk1[0].rpId === 'localhost', 'one passkey on the phone, for the vault’s own address');
    const db1 = JSON.stringify(await dumpDb());
    check(!db1.includes(r1.id) && !db1.includes(r1.salt) && !db1.includes(r1.box.ct), 'nothing about it was saved in Firebase');

    console.log('\n# Opening the vault with Face ID');
    const c0 = await counts(ph);
    await ph.goto(URL0); await waitVault(ph);
    check((await counts(ph)).gets === c0.gets + 1 && await state(ph, () => window.__vault.V.uid) === ownerUid, 'opening the vault asks for Face ID by itself, once, and it opens — no password typed');
    check(await waitFor(ph, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.p === 'Ch@seBank-Zx81-Qp')), 'his logins open (the Chase password reads back)');
    const s0 = await session(ph);
    check(s0.face && !s0.sign && !s0.lock && !s0.wrap, 'this session has no signing key, no lock key and no wrap key (none of them are on the phone)');
    await ph.goto(URL0 + '?locked=idle'); await waitVault(ph);
    check((await counts(ph)).gets === c0.gets + 2, 'after locking itself (idle), the same: Face ID and it’s open');
    const before = (await counts(ph)).gets;
    await lockAndReload(ph); await ph.waitForSelector('#bioBtn'); await sleep(700);
    check((await counts(ph)).gets === before && /as Dr\. A/.test(await ph.textContent('.bioWho')), 'after pressing Lock it doesn’t ask by itself; the button says whose vault it opens');
    await ph.screenshot({ path: SHOTS + 'bio-03-sign-in.png' });
    await ph.click('#bioBtn'); await waitVault(ph);
    check(true, 'a tap on “Unlock with Face ID” opens it');

    console.log('\n# Changing who can open what still needs the password');
    const n0 = await authCount();
    const direct = await ph.evaluate(() => window.__vault.S.addPerson({ name: 'Mallory', username: 'mallory', access: {} }).then(() => 'added', e => e.code || String(e)));
    check(direct === 'need-password' && await authCount() === n0, 'adding a person straight from the page is refused before anything is made (' + direct + ', sign-in accounts ' + n0 + ')');
    const fLab = await folderId(ph, 'Clinical & lab');
    const others = await ph.evaluate(f => Promise.all([
      window.__vault.S.deleteFolder(f), window.__vault.S.updateFolder(f, { name: 'Renamed', color: 'gray', def: 'edit' }),
      window.__vault.S.saveSettings({ lockMax: 60 }), window.__vault.S.backupFile('a long enough backup password 42')
    ].map(p => p.then(() => 'done', e => e.code || String(e)))), fLab);
    check(others.every(x => x === 'need-password') && await ph.evaluate(f => !!window.__vault.V.folders.get(f), fLab),
      'deleting or changing a folder, the office lock limit and a backup are refused too (' + others.join(', ') + ')');
    await nav(ph, 'folder:' + fLab); await ph.click('[data-act=editFolder]'); await ph.waitForSelector('#okPw');
    check(!(await ph.$('#fdName')), 'a folder’s settings ask for the password first');
    await ph.click('.modal .mfoot [data-close]'); await sleep(300);
    await nav(ph, 'team'); await ph.click('[data-act=addPerson]');
    await ph.waitForSelector('#okPw');
    check(/opened the vault with Face ID/.test(await ph.textContent('.modal')), '“Add a person” asks for his password first');
    await sleep(400); await ph.screenshot({ path: SHOTS + 'bio-04-password-step.png' });
    await ph.click('.modal .mfoot [data-close]'); await sleep(400);
    check(!(await ph.$('#apName')), 'Cancel: nothing happens');
    await ph.click('[data-act=addPerson]'); await ph.waitForSelector('#okPw');
    await ph.fill('#okPw', 'not it'); await ph.click('#okBtn'); await ph.waitForSelector('#okErr:not(.hidden)', { timeout: 30000 });
    check(/isn’t your vault password/.test(await ph.textContent('#okErr')), 'a wrong password is refused');
    await ph.fill('#okPw', PW1); await ph.click('#okBtn');
    await ph.waitForSelector('#apName', { timeout: 30000 });
    await ph.fill('#apName', 'Gwen W.'); await ph.fill('#apUser', 'gwen'); await ph.click('#apBtn');
    await ph.waitForSelector('#tmpPw', { timeout: 30000 }); await ph.click('.modal .mfoot [data-close]');
    const s1 = await session(ph);
    check(s1.sign && s1.lock && !s1.face, 'with the password, he adds Gwen; his signing key is ready for the rest of this session');
    if (await ph.isVisible('[data-act=menu]')) await ph.click('[data-act=menu]');
    await ph.click('[data-act=newFolder]'); await ph.waitForSelector('#fdName');
    check(!(await ph.$('#okPw')), '…so a new folder doesn’t ask again');
    await ph.click('.modal .mfoot [data-close]');
    await lockThenTap(ph);
    check(!(await session(ph)).sign, 'after the next lock, a Face ID session is back to no signing key');

    console.log('\n# Face ID cancelled');
    await setFlag(ph, '__cancel', '1');
    await ph.goto(URL0);
    await ph.waitForSelector('#bioBtn'); await sleep(900);
    check(await ph.isHidden('#bioErr') && await ph.isHidden('#bioMore') && await ph.isEnabled('#bioBtn') && !(await ph.$('#app')), 'when the automatic Face ID is cancelled, the page just waits with the button (no error)');
    check(!!(await ph.$('#bioBtn svg')) && /^Unlock with Face ID$/.test((await ph.textContent('#bioBtn')).trim()), '…the button looks as before (Face ID symbol and words)');
    check(await ph.evaluate(() => document.activeElement && document.activeElement.id !== 'liPw'), '…and the password box doesn’t grab the focus (no keyboard popping up)');
    check(!/primary/.test(await ph.getAttribute('#liBtn', 'class')) && await ph.isVisible('#liPw'), 'the password is still there underneath');
    await setFlag(ph, '__cancel', '1');
    await ph.click('#bioBtn'); await ph.waitForSelector('#bioErr:not(.hidden)');
    check(/didn’t finish/.test(await ph.textContent('#bioErr')) && await ph.isVisible('#bioOff'), 'cancelled after tapping the button: it says so and offers to stop using Face ID here');
    await ph.screenshot({ path: SHOTS + 'bio-05-cancelled.png' });
    await ph.fill('#liUser', OWNER); await ph.fill('#liPw', PW1); await ph.click('#liBtn'); await waitVault(ph);
    const s2 = await session(ph);
    check(s2.sign && !s2.face, 'the password still opens it (a full session)');
    check(await lockThenTap(ph), 'and next time Face ID opens it again');

    console.log('\n# Someone else signed in with a password on this phone');
    await ph.evaluate(() => localStorage.setItem('nloVault.login', 'sarah'));
    const g2 = (await counts(ph)).gets;
    await ph.goto(URL0); await ph.waitForSelector('#bioBtn'); await sleep(800);
    check((await counts(ph)).gets === g2 && /as Dr\. A/.test(await ph.textContent('.bioWho')), 'Face ID doesn’t ask by itself for Dr. A then (the button still says whose it is)');
    await ph.evaluate(e => localStorage.setItem('nloVault.login', e), OWNER);
    await ph.click('#bioBtn'); await waitVault(ph);

    console.log('\n# Turning it off');
    await settings(ph); await ph.waitForSelector('#bioOffBtn'); await ph.click('#bioOffBtn'); await ph.click('.modal [data-yes]');
    await ph.waitForSelector('#stBio #bioOnBtn');
    check(!(await rec(ph)), 'the copy is gone from the phone');
    check(await passkeyCount(ph, 0) === 0, '…and the phone was asked to delete the passkey (it did)');
    const c1 = await counts(ph);
    await ph.goto(URL0); await ph.waitForSelector('#liUser'); await sleep(700);
    check(!(await ph.$('#bioBtn')) && /primary/.test(await ph.getAttribute('#liBtn', 'class')) && (await counts(ph)).gets === c1.gets, 'the sign-in page is back to the password only (Face ID not asked)');

    console.log('\n# An iPhone that gives out the secret only when the passkey is used (as iOS 18 does)');
    await ph.fill('#liUser', OWNER); await ph.fill('#liPw', PW1); await ph.click('#liBtn'); await waitVault(ph);
    await settings(ph); await setFlag(ph, '__noPrfAtCreate', '1');
    const c2 = await counts(ph);
    await turnOn(ph, PW1); await ph.waitForSelector('#stBio .bioOn', { timeout: 30000 });
    const c3 = await counts(ph);
    check(c3.creates === c2.creates + 1 && c3.gets === c2.gets + 1, 'turned on the same way (made, then used once)');
    await setFlag(ph, '__noPrfAtCreate', '0');
    check(await lockThenTap(ph), '…and Face ID opens the vault');

    console.log('\n# Changing the password switches Face ID off (the copy held the old sign-in secret)');
    await settings(ph);
    await ph.fill('#cpCur', PW1); await ph.fill('#cpNew', PW2); await ph.fill('#cpNew2', PW2); await ph.click('#cpBtn');
    await ph.waitForSelector('.toast:has-text("Turn Face ID on again")', { timeout: 30000 });
    await ph.waitForSelector('#stBio #bioOnBtn');
    check(!(await rec(ph)), 'the old copy is gone and Settings offers to turn it on again');
    await turnOn(ph, PW1); await ph.waitForSelector('#boErr:not(.hidden)', { timeout: 30000 });
    check(/isn’t your vault password/.test(await ph.textContent('#boErr')), 'the old password can’t turn it back on');
    await ph.fill('#boPw', PW2); await ph.click('#boBtn'); await ph.waitForSelector('#stBio .bioOn', { timeout: 30000 });
    check(await lockThenTap(ph), 'turned on again with the new password; Face ID opens the vault');

    console.log('\n# A second phone notices the password changed');
    const ph2 = await newPage(browser, 'iphone-2', { phone: true, faceId: true });
    await signIn(ph2, OWNER, PW2); await waitVault(ph2);
    await settings(ph2); await turnOn(ph2, PW2); await ph2.waitForSelector('#stBio .bioOn', { timeout: 30000 });
    await settings(ph);
    await ph.fill('#cpCur', PW2); await ph.fill('#cpNew', PW3); await ph.fill('#cpNew2', PW3); await ph.click('#cpBtn');
    await ph.waitForSelector('.toast:has-text("Turn Face ID on again")', { timeout: 30000 });
    await ph2.goto(URL0);
    await ph2.waitForSelector('.note.warn', { timeout: 30000 });
    check(/password or login changed/.test(await ph2.textContent('.note.warn')) && !(await rec(ph2)) && !(await ph2.$('#bioBtn')), 'its Face ID copy can’t sign in any more: it says why, forgets it, and asks for the password');
    await ph2.screenshot({ path: SHOTS + 'bio-06-password-changed.png' });
    await ph2.fill('#liUser', OWNER); await ph2.fill('#liPw', PW3); await ph2.click('#liBtn'); await waitVault(ph2);
    check(true, 'the new password works there');
    await ph2.context().close();

    console.log('\n# A changed, copied or broken record');
    await ph.waitForSelector('#stBio #bioOnBtn'); await turnOn(ph, PW3); await ph.waitForSelector('#stBio .bioOn', { timeout: 30000 });
    const good = await rec(ph);
    // copied to another iPhone: that phone doesn't have the passkey, so nothing opens
    const thief = await newPage(browser, 'other-iphone', { phone: true, faceId: true });
    await thief.goto(URL0); await thief.waitForSelector('#liUser');
    await thief.evaluate(([r, e]) => { localStorage.setItem('nloVault.bio', r); localStorage.setItem('nloVault.login', e); }, [good, OWNER]);
    await thief.goto(URL0); await thief.waitForSelector('#bioBtn'); await sleep(900);
    await thief.click('#bioBtn'); await thief.waitForSelector('#bioErr:not(.hidden)', { timeout: 30000 });
    check(!(await thief.$('#app')) && !(await state(thief, () => !!window.__vault.V.uid)), 'copied to another phone it opens nothing (that phone doesn’t have the passkey)');
    await thief.click('#bioOff'); await thief.waitForSelector('#liUser');
    check(!(await rec(thief)) && !(await thief.$('#bioBtn')), '“Stop using Face ID on this iPhone” forgets it');
    // junk where the record should be
    await thief.evaluate(() => localStorage.setItem('nloVault.bio', '{"v":1,"uid":"x","login":"dr.test@example.com","id":"%%%","salt":"nope"}'));
    await thief.goto(URL0); await thief.waitForSelector('.note.warn');
    check(/set up again/.test(await thief.textContent('.note.warn')) && !(await rec(thief)) && !(await thief.evaluate(() => localStorage.getItem('nloVault.bio'))), 'a broken record is noticed and cleared');
    await thief.context().close();
    // changed on the phone itself
    await ph.evaluate(() => { const r = JSON.parse(localStorage.getItem('nloVault.bio')); const b = atob(r.box.ct); r.box.ct = btoa(String.fromCharCode(b.charCodeAt(0) ^ 1) + b.slice(1)); localStorage.setItem('nloVault.bio', JSON.stringify(r)); });
    await ph.goto(URL0);
    await ph.waitForSelector('.note.warn', { timeout: 30000 });
    check(/set up again/.test(await ph.textContent('.note.warn')) && !(await rec(ph)) && !(await ph.$('#app')), 'a changed copy is refused and forgotten; nothing opens');
    await ph.fill('#liUser', OWNER); await ph.fill('#liPw', PW3); await ph.click('#liBtn'); await waitVault(ph);
    check(true, 'the password still works');

    console.log('\n# A phone whose passkeys can’t give out the secret');
    const np = await newPage(browser, 'iphone-no-prf', { phone: true, faceId: 'no-prf' });
    await signIn(np, OWNER, PW3); await waitVault(np); await settings(np);
    await turnOn(np, PW3); await np.waitForSelector('#boErr:not(.hidden)', { timeout: 30000 });
    check(/can’t do it: it needs iOS 18/.test(await np.textContent('#boErr')) && !(await rec(np)), 'it says the phone can’t do it, and keeps nothing');
    check(await passkeyCount(np, 0) === 0, '…and the passkey it just made is deleted again');
    await np.context().close();

    console.log('\n# On a computer: scan the code with the iPhone');
    const pc = await newPage(browser, 'computer-qr', { faceId: 'qr' });
    await signIn(pc, OWNER, PW3); await waitVault(pc);
    await settings(pc);
    await pc.waitForSelector('#stBio:not(.hidden) #bioOnBtn');
    const pcOffer = await pc.textContent('#stBio');
    check(/Unlock with your iPhone/.test(await pc.textContent('#stBio h2')) && /right next to this computer/.test(pcOffer) && /only scan a code the vault shows/.test(pcOffer) && /computers you trust/.test(pcOffer),
      'Settings explain it: the iPhone must be right next to the computer, use it on computers you trust, and only scan codes the vault shows where you sit');
    check(await pc.isVisible('#stBio .callout.warn') && /Bluetooth/.test(await pc.textContent('#stBio .callout.warn')), '…and warn when the computer seems to have no Bluetooth (as this test browser says)');
    await sleep(300); await pc.screenshot({ path: SHOTS + 'bio-07-computer-settings.png', fullPage: true });
    const k0 = await counts(pc);
    await turnOn(pc, PW3);
    await pc.waitForSelector('#stBio .bioOn', { timeout: 30000 });
    const k1 = await counts(pc), rc = JSON.parse(await rec(pc));
    check(rc.kind === 'computer' && rc.tr.includes('hybrid') && k1.creates === k0.creates + 1 && k1.gets === k0.gets + 1, 'set up with the code: a passkey saved on the iPhone, then used once to check it');
    const pkc = await passkeys(pc);
    check(pkc.length === 1 && pkc[0].rpId === 'localhost', '…one passkey, on the iPhone, for the vault’s own address');
    check(!(await rec(ph)) || JSON.parse(await rec(ph)).id !== rc.id, 'the computer has its own passkey (turning things off on one device doesn’t touch the other)');
    const k2 = (await counts(pc)).gets;
    await pc.goto(URL0); await pc.waitForSelector('#bioBtn'); await sleep(900);
    await pc.goto(URL0 + '?locked=idle'); await pc.waitForSelector('#bioBtn'); await sleep(900);
    check((await counts(pc)).gets === k2 && !(await pc.$('#app')), 'the computer never brings up the code by itself (not on opening, not after locking itself)');
    check(/Unlock with your iPhone/.test(await pc.textContent('#bioBtn')) && /scan the code with your iPhone/.test(await pc.textContent('.bioWho')) && /primary/.test(await pc.getAttribute('#bioBtn', 'class')),
      'the sign-in page shows “Unlock with your iPhone”, whose it is and what to do');
    await pc.screenshot({ path: SHOTS + 'bio-08-computer-sign-in.png' });
    await pc.click('#bioBtn'); await waitVault(pc);
    const s3 = await session(pc);
    check(s3.face && !s3.sign && !s3.lock && !s3.wrap, 'a click, the code and Face ID open it — with the same limits (no signing key on this computer)');
    check(await waitFor(pc, () => Array.from(window.__vault.V.items.values()).some(i => i.d && i.d.p === 'Ch@seBank-Zx81-Qp')), 'his logins open');
    await nav(pc, 'team'); await pc.click('[data-act=addPerson]'); await pc.waitForSelector('#okPw');
    check(/opened the vault with your iPhone/.test(await pc.textContent('.modal')), '“Add a person” still asks for the password');
    await pc.click('.modal .mfoot [data-close]'); await sleep(300);
    await setFlag(pc, '__cancel', '1');
    await lockAndReload(pc); await pc.waitForSelector('#bioBtn'); await pc.click('#bioBtn');
    await pc.waitForSelector('#bioErr:not(.hidden)');
    check(/Bluetooth has to be on/.test(await pc.textContent('#bioErr')) && !(await pc.$('#app')), 'if the code isn’t scanned (closed, or no Bluetooth), it says what to check; the password still works underneath');
    await pc.fill('#liUser', OWNER); await pc.fill('#liPw', PW3); await pc.click('#liBtn'); await waitVault(pc);

    console.log('\n# Staff');
    const sp = await newPage(browser, 'sarah-iphone', { phone: true, faceId: true });
    await signIn(sp, 'sarah', tempSarah); await sp.waitForSelector('#fpForm', { timeout: 30000 });
    await sp.fill('#fpPw', SARAH_PW); await sp.fill('#fpPw2', SARAH_PW); await sp.click('#fpBtn'); await waitVault(sp);
    await settings(sp); await sleep(800);
    check(await sp.isHidden('#stBio') && (await counts(sp)).creates === 0, 'Sarah’s Settings don’t offer Face ID (Dr. A only, for now)');
    await sp.context().close();
    // the same computer, shared: Sarah signs in there with her password
    await lockAndReload(pc); await pc.waitForSelector('#liUser');
    await pc.fill('#liUser', 'sarah'); await pc.fill('#liPw', SARAH_PW); await pc.click('#liBtn'); await waitVault(pc);
    await settings(pc); await sleep(800);
    check(await pc.isHidden('#stBio'), 'on the shared computer, her Settings don’t offer it either');
    const k3 = (await counts(pc)).gets;
    await lockAndReload(pc); await pc.waitForSelector('#bioBtn'); await sleep(700);
    check(!/primary/.test(await pc.getAttribute('#bioBtn', 'class')) && /primary/.test(await pc.getAttribute('#liBtn', 'class')) && (await counts(pc)).gets === k3,
      'after she signed in there, the password is the main button and Dr. A’s “Unlock with your iPhone” is second');
    await pc.screenshot({ path: SHOTS + 'bio-09-shared-computer.png' });
    await pc.fill('#liUser', OWNER); await pc.fill('#liPw', PW3); await pc.click('#liBtn'); await waitVault(pc);
    await settings(pc); await pc.waitForSelector('#bioOffBtn'); await pc.click('#bioOffBtn'); await pc.click('.modal [data-yes]');
    await pc.waitForSelector('#stBio #bioOnBtn');
    check(!(await rec(pc)), 'Dr. A turns it off on the computer: forgotten there');
    await pc.context().close();

    const db2 = JSON.stringify(await dumpDb());
    check(!/nloVault|"bio"|passkey/i.test(db2), 'still nothing about Face ID anywhere in Firebase');
  } catch (e) {
    check(false, 'test crashed: ' + (e && e.stack || e));
    if (ph) try { await ph.screenshot({ path: SHOTS + 'bio-crash.png', fullPage: true }); } catch (x) { }
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
