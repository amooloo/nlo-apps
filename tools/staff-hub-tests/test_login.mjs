// End-to-end checks of Staff Hub's NLO Cases sign-in on the Firebase emulators (a made-up office; nothing live). README.md.
// node test_login.mjs [--quick]   (the idle-lock check waits ~1.5 min; --quick skips it)
import fs from 'node:fs';
import * as E from './seed.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.SH_BASE || 'http://127.0.0.1:8765/';
const PAGE = BASE + 'nlo-staff-hub.html', OLD = BASE + 'nlo-staff-hub-old.html';   // the new page, and the page as it was (main before this change)
const SDK = process.env.FIREBASE_SDK_DIR || new URL('./node_modules/firebase/', import.meta.url).pathname;   // 10.12.2 compat, served for gstatic
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0; const fails = [];
function ok(cond, what) { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// every Firebase app the page makes is pointed at the emulators; nothing else outside is reachable
const WIRE = `(() => {
  let fb;
  Object.defineProperty(window, 'firebase', { configurable: true, get() { return fb; }, set(v) {
    fb = v;
    if (v && v.initializeApp && !v.__emu) {
      const orig = v.initializeApp.bind(v);
      v.initializeApp = function (cfg, name) {
        const app = orig(cfg, name);
        try { app.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); } catch (e) { console.warn('emu auth', e); }
        if (cfg && cfg.databaseURL) { try { app.database().useEmulator('127.0.0.1', 9000); } catch (e) { console.warn('emu db', e); } }
        else { try { app.firestore().useEmulator('127.0.0.1', 8080); } catch (e) { console.warn('emu fs', e); } }
        return app;
      };
      v.__emu = true;
    }
  } });
})();`;

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
function watch(page, tag) {
  page.on('pageerror', e => { errors.push(tag + ': ' + String(e && e.stack || e)); console.log('  PAGEERROR', tag, String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED|identitytoolkit/.test(m.text())) { errors.push(tag + ': ' + m.text()); console.log('  console.error', tag, m.text().slice(0, 300)); } });
}
async function device(opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 }, acceptDownloads: true }, opts));
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage(); watch(page, 'page');
  return { ctx, page };
}
const isApp = () => typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex';
async function outcome(p, ms = 45000) {
  await p.waitForFunction(() => (typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex') ||
    (typeof NC !== 'undefined' && !NC.busy && !!document.querySelector('#authCard form') && !document.querySelector('#ncGo[disabled]')), null, { timeout: ms });
  return p.evaluate(() => (typeof S !== 'undefined' && !!S && document.getElementById('app').style.display === 'flex') ? 'app' : NC.mode);
}
async function signIn(p, user, pw) {
  await p.waitForSelector('#ncLoginForm', { timeout: 20000 });
  await p.fill('#ncUser', user); await p.fill('#ncPw', pw);
  await p.click('#ncGo');
  return outcome(p);
}
/* the sign-in card sits in the middle of the screen, and nothing is scrolled */
const centered = p => p.evaluate(() => { const w = document.getElementById('lockWrap'), r = document.getElementById('authCard').getBoundingClientRect();
  return Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4 && w.scrollLeft === 0 && r.top >= 0 ? true : JSON.stringify({ l: r.left, r: r.right, t: r.top, sl: w.scrollLeft, st: w.scrollTop, iw: window.innerWidth }); });
const errOf = p => p.evaluate(() => { const e = document.querySelector('#authCard .lockErr'); return e ? e.textContent.trim() : ''; });
const okOf = p => p.evaluate(() => { const e = document.querySelector('#authCard .lockOk'); return e ? e.textContent.trim() : ''; });
const casesUser = p => p.evaluate(() => !!(NC.auth && NC.auth.currentUser));
const hubUser = p => p.evaluate(() => !!(fbAuth && fbAuth.currentUser));
async function hubSignedOut(p, ms = 15000) { try { await p.waitForFunction(() => !fbAuth.currentUser, null, { timeout: ms }); return true; } catch { return false; } }
async function lock(p) { await p.click('#side [data-act=lockNow]'); await p.waitForSelector('#ncLoginForm'); }
async function staffNames(p) { return p.evaluate(() => (S && S.staff || []).map(x => x.name)); }
async function synced(p, ms = 20000) { try { await p.waitForFunction(() => typeof syncState !== 'undefined' && syncState === 'synced' && !fbWriteInFlight && !shDirty(), null, { timeout: ms }); return true; } catch { return false; } }

/* the record on Staff Hub's server, opened with Staff Hub's own password (as only its owner can) */
async function hubRecord(uid, pw) {
  const d = await E.fsGet('nlo-staff-hub', 'staffhub/' + uid);
  if (!d) return null;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(d.kdf.salt, 'base64'), iterations: d.kdf.iter || 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let st = null;
  try { st = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(d.data.iv, 'base64') }, key, Buffer.from(d.data.ct, 'base64')))); } catch { }
  return { rev: d.rev, salt: d.kdf.salt, st };
}

fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
process.chdir(new URL('./', import.meta.url).pathname);

// ---------- 0. the made-up office, and Staff Hub data made by the page as it is today ----------
console.log('0. seeding');
await E.loadRules();
const ownerUid = await E.seedOffice();
const HUB = { email: 'dr.hub@example.com', pw: 'Staff-Hub-Pass-1', pw2: 'Staff-Hub-Pass-2', pw3: 'Staff-Hub-Pass-3' };
let PW = E.PW; const PW2 = 'New-Cases-Pass-8', PW3 = 'Reset-Cases-Pass-9';
let hubUid, saltBefore;
const old = await device();
{
  const page = old.page;
  await page.goto(OLD);
  await page.waitForSelector('#authToggle', { timeout: 20000 });
  await page.click('#authToggle');
  await page.fill('#authEmail', HUB.email); await page.fill('#authPw', HUB.pw); await page.fill('#authPw2', HUB.pw); await page.check('#authAck');
  await page.click('#authGo');
  // (the emulator's first transaction after a wipe can take a while: the old page waits up to 25 s for its first save)
  try { await page.waitForFunction(isApp, null, { timeout: 90000 }); }
  catch (e) { console.log('  seeding: the page as it was didn’t open:', await page.evaluate(() => ({ err: (document.querySelector('#authErr') || {}).textContent, sync: typeof syncState !== 'undefined' && syncState }))); throw e; }
  hubUid = await page.evaluate(() => fbUser.uid);
  await page.evaluate(async () => {
    importStaffList([{ name: 'Gwen Rodis', role: 'Orthodontic Assistant' }, { name: 'Kaylee Doty', role: 'Orthodontic Assistant' }, { name: 'Sarah Betz', role: 'Office Coordinator' }]);
    const c = document.createElement('canvas'); c.width = 40; c.height = 30; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 40, 30);
    const img = c.toDataURL('image/jpeg', 0.8);
    S.certs.push({ id: 'cert1', staffId: S.staff[0].id, name: 'CPR / BLS', expires: '2027-05-01', hasPhoto: true, fileKind: 'image', thumb: img });
    await savePhotoDoc('cert1', img, 'image');
    persist();
  });
  ok(await synced(page), 'the page as it is today saved a made-up Staff Hub record');
  const rec = await hubRecord(hubUid, HUB.pw);
  ok(rec && rec.st && rec.st.staff.length === 3 && rec.st.certs.length === 1, 'record on the server: 3 staff, a certificate with a file');
  saltBefore = rec && rec.salt;
  await page.close();   // (its sign-in stays saved in this browser, as the old page kept it)
}

// ---------- 1. the new page in that same browser ----------
console.log('1. the new sign-in');
let page = await old.ctx.newPage(); watch(page, 'new');
await page.goto(PAGE);
await page.waitForSelector('#ncLoginForm', { timeout: 20000 });
{
  const card = await page.textContent('#authCard');
  ok(/Same username and password as NLO Cases/.test(card), 'sign-in says it is the NLO Cases login');
  ok(/Username/.test(card) && /Password/.test(card) && !/Create an account/.test(card) && !(await page.$('#authEmail')), 'Username + Password; no Staff Hub email sign-in or sign-up any more');
  ok(/NLO Cases login/.test(card), 'version line says NLO Cases login');
  ok(await hubSignedOut(page, 8000), 'the sign-in the old page kept in this browser is ended');
  ok((await page.evaluate(() => NC.hubEmail)) === HUB.email, '…and its email is kept for the one-time link');
  { const c = await centered(page); ok(c === true, 'card in the middle (01-signin.png)' + (c === true ? '' : ': ' + c)); }
  await page.screenshot({ path: 'shots/01-signin.png' });
}

// ---------- 2. who can't get in ----------
console.log('2. errors');
{
  ok(await signIn(page, 'nobody', PW) === 'login' && /No login with that username/.test(await errOf(page)), 'unknown username');
  ok(await signIn(page, E.OWNER.email, 'wrong-pass-1') === 'login' && /incorrect/.test(await errOf(page)), 'Dr. A, wrong password');
  ok(await signIn(page, 'gwen', PW) === 'login' && /only for Dr\. A/.test(await errOf(page)), 'a staff login is refused: Staff Hub is only for Dr. A');
  ok(!(await casesUser(page)) && !(await hubUser(page)), '…and left signed out of both');
  ok(await signIn(page, 'gone', PW) === 'login' && /turned off/.test(await errOf(page)), 'a turned-off login');
  ok(await signIn(page, 'newbie', PW) === 'login' && /only for Dr\. A/.test(await errOf(page)), 'a staff login still on its temporary password');
  const staffDocs = await E.fsList('nlo-cases', 'members');
  ok(staffDocs.every(d => !d.data.shLink), 'nothing written to anyone’s NLO Cases record');
}

// ---------- 3. Dr. A, first time: the one-time link ----------
console.log('3. first time: link');
{
  ok(await signIn(page, E.OWNER.email, PW) === 'link', 'Dr. A’s first sign-in asks for Staff Hub’s own password once');
  ok((await page.inputValue('#ncHubEmail')) === HUB.email, 'link step: Staff Hub email filled in from the old sign-in in this browser');
  ok(!(await E.fsGet('nlo-staff-hub', 'staffhub/' + ownerUid)), 'trying the NLO Cases password on Staff Hub (same email) created nothing');
  { const c = await centered(page); ok(c === true, 'card in the middle (02-link.png)' + (c === true ? '' : ': ' + c)); }
  await page.screenshot({ path: 'shots/02-link.png' });
  await page.fill('#ncHubPw', 'not-the-password'); await page.click('#ncGo');
  ok(await outcome(page) === 'link' && /don’t sign in to Staff Hub/.test(await errOf(page)), 'wrong Staff Hub password → said, still on the link step');
  await page.fill('#ncHubEmail', E.OWNER.email); await page.fill('#ncHubPw', PW); await page.click('#ncGo');
  ok(await outcome(page) === 'link' && /no Staff Hub data under/.test(await errOf(page)), 'an account with no Staff Hub data → said, nothing linked');
  ok(!((await E.fsGet('nlo-cases', 'members/' + ownerUid)).shLink), 'nothing linked yet');
  await page.fill('#ncHubEmail', HUB.email); await page.fill('#ncHubPw', HUB.pw); await page.click('#ncGo');
  ok(await outcome(page) === 'app', 'right Staff Hub password → Staff Hub opens');
  const names = await staffNames(page);
  ok(['Gwen Rodis', 'Kaylee Doty', 'Sarah Betz'].every(n => names.includes(n)), 'its data is all there');
  ok(/^data:image\/jpeg/.test(await page.evaluate(() => loadPhotoDoc('cert1'))), 'the certificate file still opens');
  const m = await E.fsGet('nlo-cases', 'members/' + ownerUid), rec = await E.fsGet('nlo-cases', 'meta/recovery');
  ok(m.shLink && m.shLink.v === 1 && m.shLink.box && m.shLink.box.epk && m.shLink.pubX === m.pub.x && m.shLink.uid === hubUid, 'link saved on Dr. A’s NLO Cases record, sealed to his key pair');
  ok(m.shLink.esc && m.shLink.recX === rec.pub.x, '…and a copy sealed to the office recovery key');
  ok(m.role === 'owner' && m.active === true && m.priv && m.ring, '…his record otherwise untouched');
  const c1 = await E.openLinkBox(PW), c2 = await E.openLinkEscrow(E.REC);
  ok(c1 && c1.email === HUB.email && c1.pw === HUB.pw && c1.uid === hubUid, 'Dr. A’s NLO Cases password opens the link');
  ok(c2 && c2.email === HUB.email && c2.pw === HUB.pw && c2.uid === hubUid, 'the recovery code opens the recovery copy');
  const r = await hubRecord(hubUid, HUB.pw);
  ok(r && r.st && r.salt === saltBefore, 'Staff Hub’s data was not re-encrypted (same key as before)');
  ok(!(await page.evaluate(() => NC.pw || (NC.priv ? 'priv' : '')) ), 'once open, the passwords and the key pair aren’t kept in memory');
  await page.screenshot({ path: 'shots/03-app.png' });
}

// ---------- 4. changes save as before ----------
console.log('4. saving');
{
  const before = await hubRecord(hubUid, HUB.pw);
  await page.evaluate(() => { importStaffList([{ name: 'Wila Jordan', role: 'Treatment Coordinator' }]); });
  ok(await synced(page), 'a change saves');
  const after = await hubRecord(hubUid, HUB.pw);
  ok(after.rev === before.rev + 1 && after.st.staff.some(x => x.name === 'Wila Jordan'), 'server has it, as the next version');
}

// ---------- 5–7. Lock, sign in again, reload ----------
console.log('5. lock and back in');
{
  await lock(page);
  ok(/Locked\. Sign in to continue/.test(await okOf(page)), 'Lock → the sign-in, “Locked. Sign in to continue.”');
  ok((await page.inputValue('#ncUser')) === E.OWNER.email, 'username remembered');
  ok(await page.evaluate(() => S === null && cryptoKey === null), 'nothing open left in memory');
  ok(!(await casesUser(page)) && await hubSignedOut(page), 'signed out of NLO Cases and of Staff Hub’s own account');
  let sawLink = false; page.on('framenavigated', () => { });
  const t = setInterval(async () => { try { if (await page.$('#ncLinkForm')) sawLink = true; } catch { } }, 50);
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'signing in again opens Staff Hub straight away');
  clearInterval(t);
  ok(!sawLink, '…without the link step');
  ok((await staffNames(page)).includes('Wila Jordan'), '…with the latest data');
  await page.reload();
  await page.waitForSelector('#ncLoginForm');
  ok(!(await page.evaluate(isApp)) && (await page.inputValue('#ncUser')) === E.OWNER.email, 'a reload means signing in again (username remembered)');
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'and it opens');
}

// ---------- 7b. what lives under Staff Hub's own account still works: a color quiz link ----------
console.log('7b. a color quiz link');
{
  const sid = await page.evaluate(() => S.staff.find(x => x.name === 'Kaylee Doty').id);
  await page.evaluate(id => quizMakeFor(id, null), sid);
  let inv = [];
  for (let i = 0; i < 40 && !inv.length; i++) { inv = await E.fsList('nlo-staff-hub', 'staffhub/' + hubUid + '/colorQuiz'); if (!inv.length) await sleep(250); }
  ok(inv.length === 1 && inv[0].data.sid === sid && inv[0].data.first === 'Kaylee', 'a color quiz link is made under Staff Hub’s own account');
  ok(await synced(page) && (await hubRecord(hubUid, HUB.pw)).st.staff.find(x => x.id === sid).colorLink, '…and noted in the record');
  await page.evaluate(() => closeModal());
}

// ---------- 8–9. Settings, and restoring a backup ----------
console.log('8. settings and restore');
{
  await page.evaluate(() => go('settings'));
  await page.waitForSelector('#acctCard');
  const acct = await page.textContent('#acctCard');
  ok(/NLO Cases login/.test(acct) && /The same as NLO Cases/.test(acct), 'Account card: the NLO Cases login; the password is NLO Cases’');
  ok(!(await page.$('[data-act=fbChangePw]')), 'no Staff Hub “Change password” any more');
  ok(/After 10 minutes without activity, the same as NLO Cases/.test(await page.textContent('#main')), 'Auto-lock follows NLO Cases (10 minutes)');
  await page.screenshot({ path: 'shots/06-settings.png', fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=expEnc]')]);
  const file = 'shots/backup.json'; await dl.saveAs(file);
  const before = await hubRecord(hubUid, HUB.pw);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-act=restore]')]);
  await fc.setFiles(file);
  await page.waitForSelector('#rsGo');
  ok(!(await page.$('#rsPw')), 'restoring a backup made now asks for no password');
  await page.click('#rsGo');
  await page.waitForFunction(() => !document.querySelector('#rsGo'), null, { timeout: 30000 });
  ok(await synced(page), 'restored and saved');
  const after = await hubRecord(hubUid, HUB.pw);
  ok(after.rev === before.rev + 1 && after.st.staff.length === before.st.staff.length, 'server has the restored record as the next version');
  fs.unlinkSync(file);
}

// ---------- 10. Dr. A changes his NLO Cases password ----------
console.log('10. NLO Cases password changed');
{
  await lock(page);
  await E.casesChangePassword(PW, PW2);
  ok(await signIn(page, E.OWNER.email, PW) === 'login' && /incorrect/.test(await errOf(page)), 'the old NLO Cases password no longer works');
  ok(await signIn(page, E.OWNER.email, PW2) === 'app', 'the new one opens Staff Hub, nothing to re-link');
  PW = PW2;
}

// ---------- 11. reset by email + recovery code ----------
console.log('11. password reset + recovery code');
{
  await lock(page);
  await page.click('[data-act=ncForgot]');
  await page.waitForSelector('#ncForgotForm');
  ok((await page.inputValue('#ncFgEmail')) === E.OWNER.email, 'Reset by email: email filled in');
  await page.click('#ncGo');
  await page.waitForSelector('#authCard .lockOk');
  ok(/reset link is on its way/.test(await okOf(page)), 'reset link sent (emulator)');
  await page.click('[data-act=ncToLogin]');
  await E.setPassword(E.OWNER.email, PW, PW3);   // he picks a new password from the email...
  ok(await signIn(page, E.OWNER.email, PW3) === 'login' && /Sign in to NLO Cases with the new one first/.test(await errOf(page)), 'before NLO Cases has the recovery code: sent to NLO Cases first');
  ok(!(await casesUser(page)), '…signed out');
  const newPub = await E.casesRecover(PW3, E.REC);   // ...and NLO Cases takes his recovery code (a new key pair)
  ok(await signIn(page, E.OWNER.email, PW3) === 'recover', 'then Staff Hub asks for the recovery code once');
  { const c = await centered(page); ok(c === true, 'card in the middle (04-recover.png)' + (c === true ? '' : ': ' + c)); }
  await page.screenshot({ path: 'shots/04-recover.png' });
  await page.click('[data-act=ncUseOld]');
  ok(!!(await page.$('#ncLinkForm')), '“Use Staff Hub’s old password” → the link step');
  await page.click('[data-act=ncCancel]');
  let outOk = false; try { await page.waitForFunction(() => !!document.querySelector('#ncLoginForm') && !NC.auth.currentUser, null, { timeout: 5000 }); outOk = true; } catch { }
  ok(outOk, 'Cancel → back to sign-in, signed out');
  ok(await signIn(page, E.OWNER.email, PW3) === 'recover', 'recovery step again');
  await page.fill('#ncRecCode', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'); await page.click('#ncGo');
  ok(await outcome(page) === 'recover' && /didn’t work/.test(await errOf(page)), 'wrong code → said');
  await page.fill('#ncRecCode', E.REC.toLowerCase().replace(/-/g, ' ')); await page.click('#ncGo');
  ok(await outcome(page) === 'app', 'right code (typed loosely) → Staff Hub opens');
  const m = await E.fsGet('nlo-cases', 'members/' + ownerUid);
  ok(m.shLink.pubX === newPub.x, 'link sealed again to his new key pair');
  const c = await E.openLinkBox(PW3);
  ok(c && c.pw === HUB.pw && c.uid === hubUid, '…and opens with his new password');
  PW = PW3;
  await lock(page);
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'next time: straight in');
}

// ---------- 12. a new recovery code ----------
console.log('12. new recovery code');
let code2;
{
  await lock(page);
  code2 = await E.casesNewRecoveryCode();
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'signs in as usual');
  let fresh = false;
  for (let i = 0; i < 40 && !fresh; i++) { const m = await E.fsGet('nlo-cases', 'members/' + ownerUid), r = await E.fsGet('nlo-cases', 'meta/recovery'); fresh = m.shLink.recX === r.pub.x; if (!fresh) await sleep(250); }
  ok(fresh, 'the recovery copy follows the new code by itself');
  const c = await E.openLinkEscrow(code2);
  ok(c && c.pw === HUB.pw, '…and opens with it');
}

// ---------- 13. an older copy of Staff Hub changes Staff Hub's own password ----------
console.log('13. older Staff Hub changes its own password');
{
  // while this one is open: the prompt, then the link follows
  const o2 = await device(); const op = o2.page;
  await op.goto(OLD);
  await op.waitForSelector('#authEmail', { timeout: 20000 });
  await op.fill('#authEmail', HUB.email); await op.fill('#authPw', HUB.pw); await op.click('#authGo');
  await op.waitForFunction(isApp, null, { timeout: 90000 });
  await op.evaluate(() => H.fbChangePw());
  await op.fill('#cpOld', HUB.pw); await op.fill('#cpNew1', HUB.pw2); await op.fill('#cpNew2', HUB.pw2); await op.click('#cpGo');
  await op.waitForFunction(() => !document.querySelector('#cpGo'), null, { timeout: 30000 });
  await page.waitForSelector('[data-shrekey]', { timeout: 30000 });
  ok(/Staff Hub’s own password was changed/.test(await page.textContent('#modalWrap')), 'open Staff Hub asks for that new password');
  await page.fill('#rkPw', HUB.pw2); await page.click('#rkGo');
  await page.waitForFunction(() => !document.querySelector('[data-shrekey]'), null, { timeout: 30000 });
  let c = null;
  for (let i = 0; i < 40; i++) { c = await E.openLinkBox(PW); if (c && c.pw === HUB.pw2) break; await sleep(250); }
  ok(c && c.pw === HUB.pw2, '…and keeps it with the NLO Cases login');
  await lock(page);
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'next sign-in: straight in with the new one');
  await lock(page);
  // while this one is closed: the next sign-in asks for it once
  await op.evaluate(() => H.fbChangePw());
  await op.fill('#cpOld', HUB.pw2); await op.fill('#cpNew1', HUB.pw3); await op.fill('#cpNew2', HUB.pw3); await op.click('#cpGo');
  await op.waitForFunction(() => !document.querySelector('#cpGo'), null, { timeout: 30000 });
  await o2.ctx.close();
  ok(await signIn(page, E.OWNER.email, PW) === 'link' && /has changed since it was linked/.test(await errOf(page)), 'closed meanwhile: the next sign-in asks for it once');
  ok((await page.inputValue('#ncHubEmail')) === HUB.email, '…with the Staff Hub email filled in');
  await page.fill('#ncHubPw', HUB.pw3); await page.click('#ncGo');
  ok(await outcome(page) === 'app' && (await staffNames(page)).includes('Wila Jordan'), '…then opens with all the data');
  c = await E.openLinkBox(PW);
  ok(c && c.pw === HUB.pw3, 'link has the new one');
}

// ---------- 14. the login turned off while open ----------
console.log('14. turned off while open');
{
  await E.fsSet('nlo-cases', 'members/' + ownerUid, { active: false }, ['active']);
  try { await page.waitForSelector('#ncLoginForm', { timeout: 15000 }); } catch { }
  ok(/Your access changed/.test(await okOf(page)) && !(await page.evaluate(isApp)), 'locked out at once');
  await E.fsSet('nlo-cases', 'members/' + ownerUid, { active: true }, ['active']);
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'back on: signs in');
}

// ---------- 15. idle lock follows NLO Cases ----------
if (!QUICK) {
  console.log('15. idle lock (about 1.5 min)');
  await lock(page);
  await E.fsSet('nlo-cases', 'meta/settings', { idleMin: 1 }, ['idleMin']);
  ok(await signIn(page, E.OWNER.email, PW) === 'app', 'signed in with NLO Cases’ idle time at 1 minute');
  try { await page.waitForSelector('#ncLoginForm', { timeout: 120000 }); } catch { }
  ok(/Locked after 1 minute without activity/.test(await okOf(page)), 'locks after NLO Cases’ idle minutes');
  ok(!(await casesUser(page)) && await hubSignedOut(page), '…signed out of both');
  await E.fsSet('nlo-cases', 'meta/settings', { idleMin: 10 }, ['idleMin']);
}

// ---------- 16. same password for both: links by itself ----------
console.log('16. same password: links by itself');
{
  await page.evaluate(() => { if (typeof S !== 'undefined' && S) lockNow(); });
  await E.fsDelField('nlo-cases', 'members/' + ownerUid, 'shLink');
  // Staff Hub data under Dr. A's own email with the same password (the page as it is today makes it)
  const o3 = await device(); const op = o3.page;
  await op.goto(OLD);
  await op.waitForSelector('#authEmail', { timeout: 20000 });
  await op.fill('#authEmail', E.OWNER.email); await op.fill('#authPw', PW); await op.click('#authGo');
  await op.waitForFunction(isApp, null, { timeout: 90000 });
  await op.evaluate(() => { importStaffList([{ name: 'Auto Person', role: 'Assistant' }]); });
  ok(await synced(op), 'a Staff Hub record under Dr. A’s own email');
  await o3.ctx.close();
  const { ctx, page: p2 } = await device();
  watch(p2, 'p2');
  await p2.goto(PAGE);
  ok(await signIn(p2, E.OWNER.email, PW) === 'app', 'no link step: opens by itself');
  ok((await staffNames(p2)).includes('Auto Person'), '…that record');
  const m = await E.fsGet('nlo-cases', 'members/' + ownerUid);
  ok(m.shLink && m.shLink.uid === ownerUid, '…and the link is saved');
  await ctx.close();
}

// ---------- 17. phone ----------
console.log('17. phone');
{
  const { ctx, page: ph } = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ph.goto(PAGE);
  await ph.waitForSelector('#ncLoginForm');
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= 390), 'sign-in fits a phone (no sideways scroll)');
  { const c = await centered(ph); ok(c === true, 'card in the middle (05-phone.png)' + (c === true ? '' : ': ' + c)); }
  await ph.screenshot({ path: 'shots/05-phone.png' });
  ok(await signIn(ph, E.OWNER.email, PW) === 'app', 'signs in on a phone');
  await ctx.close();
}

await old.ctx.close();
await browser.close();
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
