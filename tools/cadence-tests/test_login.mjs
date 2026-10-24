// End-to-end checks of Cadence's NLO Cases sign-in on the Firebase emulators (made-up office, nothing live). See README.md.
// node test_login.mjs [--quick]   (the idle-lock checks wait ~3.5 min; --quick skips them)
const { chromium } = await import('playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'));
import fs from 'node:fs';
import { loadRules, seedCases, seedCadence, dbGet, dbPut, fsSet, fsGet, PW, PEOPLE } from './seed.mjs';

const BASE = process.env.CADENCE_URL || 'http://127.0.0.1:8765/cadence.html';
const SDK = process.env.FIREBASE_SDK_DIR || new URL('./node_modules/firebase/', import.meta.url).pathname; // the 10.12.0 compat files, served in place of gstatic
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0; const fails = [];
function ok(cond, what) { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }

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

const browser = await chromium.launch();
const errors = [];
async function device(opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, opts));
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost') || u.startsWith('https://apis.google.com/') || u.startsWith('https://unpkg.com/material-components-web')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/10\.12\.0\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    if (u.startsWith('https://identitytoolkit.googleapis.com/')) return route.fulfill({ status: 404, body: '' });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(String(e && e.stack || e)); console.log('  PAGEERROR', String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED/.test(m.text())) { errors.push(m.text()); console.log('  console.error', m.text().slice(0, 300)); } });
  return { ctx, page };
}
const hash = p => p.evaluate(() => location.hash);
async function waitHash(p, re, ms = 15000) { try { await p.waitForFunction(r => new RegExp(r).test(location.hash), re.source, { timeout: ms }); return true; } catch { return false; } }
async function connect(p, email = 'records@thenextlevelorthodontics.com') {
  await p.waitForFunction(() => window.firebase && firebase.apps && firebase.apps.some(a => a.name === '[DEFAULT]'), null, { timeout: 15000 });
  await p.evaluate(async em => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + em, email: em, email_verified: true, name: em }));
    await firebase.auth().signInWithCredential(cred);
  }, email);
}
async function signIn(p, user, pw = PW) {
  await p.waitForSelector('#nloUser', { timeout: 15000 });
  await p.fill('#nloUser', user); await p.fill('#nloPw', pw);
  await p.click('form button[type=submit]');
}
async function errText(p) { try { await p.waitForSelector('.nlo-signin [role=alert]', { timeout: 20000 }); return (await p.textContent('.nlo-signin [role=alert]')).trim(); } catch { return ''; } }
async function cad(p) { try { await p.waitForFunction(() => window.__nloCad && window.__nloCad.me, null, { timeout: 3000 }); } catch { } return p.evaluate(() => window.__nloCad && window.__nloCad.me); }

// ---------- setup ----------
console.log('seeding');
await loadRules();
const uids = await seedCases();
await dbPut('nlo/cadence', null); // (also what test_move.mjs leaves: Cadence marked moved, its copies)
{
  // a connected device on an empty database writes Cadence's starting state; the made-up staff go in after
  const { ctx, page } = await device();
  await page.goto(BASE);
  await connect(page);
  for (let i = 0; i < 50; i++) { const st = await dbGet('nlo/cadence/state'); if (st && st.checklists) break; await page.waitForTimeout(200); }
  const st = await dbGet('nlo/cadence/state');
  await seedCadence(st);
  await ctx.close();
}
fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
process.chdir(new URL('./', import.meta.url).pathname);

// ---------- 1. a device that isn't connected ----------
console.log('1. device not connected');
{
  const { ctx, page } = await device();
  await page.goto(BASE + '#/picker');
  ok(await waitHash(page, /^#\/$/), 'sign-in page without a connected device goes to the device step');
  await page.waitForSelector('text=Connect with Google');
  ok(await page.isVisible('text=This device isn’t connected to Cadence yet'), 'explains the one-time device connection');
  await page.goto(BASE + '#/app/mine'); ok(await waitHash(page, /^#\/$/), 'staff screens need the device connection');
  await page.goto(BASE + '#/admin/dashboard'); ok(await waitHash(page, /^#\/$/), 'admin needs the device connection');
  await page.screenshot({ path: 'shots/01-device.png' });
  // the real Connect button: the emulator's Google window
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('text=Connect with Google')]);
  await pop.waitForLoadState();
  try {
    await pop.click('text=Add new account', { timeout: 8000 });
    await pop.fill('#email-input', 'records@thenextlevelorthodontics.com');
    await pop.click('#sign-in');
  } catch (e) { console.log('  (popup flow)', String(e).slice(0, 200)); }
  ok(await waitHash(page, /^#\/picker$/, 20000), 'Connect with Google → the NLO Cases sign-in');
  await page.waitForSelector('#nloUser');
  ok(await page.isVisible('text=Same username and password as NLO Cases'), 'sign-in says it is the NLO Cases login');
  await page.waitForSelector('.picker__scoreboard', { timeout: 15000 }).catch(() => { });
  ok(await page.isVisible('.picker__scoreboard'), 'team scoreboard still shows on the sign-in screen');
  const board = await page.textContent('.picker__scoreboard');
  ok(/Gwen Rodis/.test(board) && !/Devon Brooks/.test(board), 'scoreboard shows the office’s people, not the demo');
  ok(!/Bri Brower/.test(board), 'someone who left is not on the scoreboard');
  await page.screenshot({ path: 'shots/02-signin.png', fullPage: true });
  // the Google session stays on this device: a reload goes straight to the sign-in
  await page.reload(); ok(await waitHash(page, /^#\/picker$/), 'connected device: reload lands on the sign-in');
  await ctx.close();
}

// ---------- 2. sign-in errors ----------
console.log('2. errors');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  const cases = [
    ['gwen', 'wrong-password-1', /incorrect/i, 'wrong password'],
    ['nobody', PW, /No login with that username/, 'unknown username'],
    ['newbie', PW, /Finish setting up your login in NLO Cases first/, 'temporary password → NLO Cases first'],
    ['gone', PW, /turned off/, 'turned-off login'],
    ['stranger', PW, /isn’t part of the office/, 'login with no member record'],
    ['alex', PW, /more than one Alex Morgan/, 'two people with the same name'],
    ['ghost', PW, /can’t tell whose checklists to open for Ghost Person: the NLO Cases login isn’t linked to Staff Hub.*Sign-in check/, 'unlinked login nobody in Cadence matches'],
    ['nina', PW, /Nina Newhire isn’t on Cadence’s staff list yet.*Sign-in check/, 'linked to Staff Hub, not in Cadence yet'],
    ['firsty', PW, /can’t tell whose checklists/, 'a first name alone never matches'],
    ['bri', PW, /no longer at the office.*Staff Hub/, 'Staff Hub says they left'],
    ['pinned', PW, /only his own login opens it/, 'a staff login never becomes Dr. A’s Cadence entry']
  ];
  for (const [u, pw, re, what] of cases) {
    await page.goto(BASE + '#/picker');
    await signIn(page, u, pw);
    const t = await errText(page);
    ok(re.test(t), what + ' — "' + t + '"');
    ok(/#\/picker$/.test(await hash(page)) && !(await cad(page)), what + ': stays signed out');
  }
  await page.screenshot({ path: 'shots/03-error.png' });
  await ctx.close();
}

// ---------- 3. staff ----------
console.log('3. staff (Gwen, by Staff Hub link)');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'Gwen');  // capital letters are fine, as in NLO Cases
  ok(await waitHash(page, /^#\/app\/mine$/), 'Gwen lands on her checklists');
  ok(await cad(page) === 's_gwen', 'signed in as Cadence’s Gwen (s_gwen)');
  await page.waitForSelector('.staff-topbar__greet');
  ok(/Gwen/.test(await page.textContent('.staff-topbar__greet')), 'greets Gwen');
  await page.screenshot({ path: 'shots/04-gwen.png' });
  await page.goto(BASE + '#/admin/dashboard'); ok(await waitHash(page, /^#\/app\/mine$/), 'Gwen can’t open the admin console');
  await page.goto(BASE + '#/admin/checklists'); ok(await waitHash(page, /^#\/app\/mine$/), 'Gwen can’t open the checklist editor');
  await page.goto(BASE + '#/admin/signins'); ok(await waitHash(page, /^#\/app\/mine$/), 'Gwen can’t open Sign-in check');
  await page.goto(BASE + '#/picker'); ok(await waitHash(page, /^#\/app\/mine$/), 'signed in: the sign-in page sends her back to her list');
  // Lock (rail)
  await page.click('.staff-rail button:has-text("Lock")');
  ok(await waitHash(page, /^#\/picker$/), 'Lock → sign-in');
  ok(await page.isVisible('text=Locked. Sign in to continue.'), 'says it locked');
  ok(!(await cad(page)), 'nobody signed in after Lock');
  ok((await page.inputValue('#nloUser')) === 'Gwen', 'username remembered on this computer');
  await page.goto(BASE + '#/app/mine'); ok(await waitHash(page, /^#\/picker$/), 'after Lock the checklists need a sign-in');
  // sign in again, then a reload signs out (as NLO Cases)
  await signIn(page, 'gwen'); await waitHash(page, /^#\/app\/mine$/);
  await page.reload(); ok(await waitHash(page, /^#\/picker$/), 'a reload means signing in again');
  ok(!(await cad(page)), 'no session survives the reload');
  await ctx.close();
}

console.log('4. name match, manager, Staff Hub link over name');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'kaylee'); await waitHash(page, /^#\/app\/mine$/);
  ok(await cad(page) === 's_kaylee', 'Kaylee matched by first + last name');
  await page.click('.nlo-lock-btn'); ok(await waitHash(page, /^#\/picker$/), 'top-bar lock button locks');
  await signIn(page, 'wila'); await waitHash(page, /^#\/app\/mine$/);
  ok(await cad(page) === 's_wila', 'Wila matched by her Staff Hub link though NLO Cases has another name');
  await page.click('.nlo-lock-btn'); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'angie'); await waitHash(page, /^#\/app\/mine$/);
  ok(await cad(page) === 's_angelika', 'Angie matched through Staff Hub’s chair name');
  await page.click('.nlo-lock-btn'); await waitHash(page, /^#\/picker$/);
  // a password filler that sets the boxes without the events React listens to
  await page.evaluate(pw => { const set = (el, v) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); set(document.querySelector('#nloUser'), 'kaylee'); set(document.querySelector('#nloPw'), pw); }, PW);
  await page.click('form button[type=submit]');
  ok(await waitHash(page, /^#\/app\/mine$/) && await cad(page) === 's_kaylee', 'a password filler that skips the input events still signs in');
  await page.click('.nlo-lock-btn'); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'sarah'); ok(await waitHash(page, /^#\/app\/mine$/), 'Sarah lands on her checklists');
  ok(await cad(page) === 's_sarah', 'Sarah = s_sarah');
  await page.goto(BASE + '#/admin/dashboard'); ok(await waitHash(page, /^#\/admin\/dashboard$/), 'Sarah (manager) can monitor the dashboard');
  await page.waitForSelector('.admin-nav');
  const nav = await page.textContent('.admin-nav');
  ok(!/Checklists|Settings|Rotations/.test(nav.replace('My checklists', '')), 'manager menu stays limited');
  await page.goto(BASE + '#/admin/settings'); ok(await waitHash(page, /^#\/admin\/dashboard$/), 'manager can’t open Settings');
  await page.goto(BASE + '#/admin/signins'); ok(await waitHash(page, /^#\/admin\/dashboard$/), 'manager can’t open Sign-in check');
  ok(!/Sign-in check/.test(await page.textContent('.admin-nav')), 'manager menu has no Sign-in check');
  await page.click('.admin-nav button:has-text("Lock")'); ok(await waitHash(page, /^#\/picker$/), 'admin-side Lock works');
  await ctx.close();
}

console.log('5. Dr. A');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'dr.owner@example.com');
  ok(await waitHash(page, /^#\/admin/), 'Dr. A’s login opens the admin console');
  ok(await cad(page) === 's_amir', 'Dr. A = s_amir');
  await page.goto(BASE + '#/admin/settings'); ok(await waitHash(page, /^#\/admin\/settings$/), 'Dr. A can open Settings (office Google account on this device)');
  await page.goto(BASE + '#/admin/checklists'); ok(await waitHash(page, /^#\/admin\/checklists$/), 'Dr. A can open the checklist editor');
  await page.screenshot({ path: 'shots/05-admin.png' });
  // Sign-in check: who can't sign in yet, and linking a login
  await page.waitForFunction(() => /Sign-in check \(\d+\)/.test(document.querySelector('.admin-nav').textContent), null, { timeout: 15000 }).catch(() => { });
  const navT = await page.textContent('.admin-nav');
  ok(/Sign-in check \(\d+\)/.test(navT), 'menu shows how many can’t sign in: ' + (/Sign-in check \(\d+\)/.exec(navT) || [''])[0]);
  await page.click('.admin-nav a:has-text("Sign-in check")');
  ok(await waitHash(page, /^#\/admin\/signins$/), 'Sign-in check opens');
  await page.waitForSelector('text=No NLO Cases login opens these checklists.', { timeout: 15000 }).catch(() => { });
  const body = await page.textContent('.admin-main');
  ok(/Gwen Rodis[\s\S]*gwen · Gwen Rodis/.test(body), 'Gwen’s row shows her login');
  ok(/Eve Pavlova[\s\S]*No NLO Cases login opens these checklists/.test(body), 'Eve (no login) is flagged');
  ok(/people can’t sign in to Cadence yet/.test(body), 'says how many can’t sign in');
  ok(/NLO Cases logins that open no one’s checklists/.test(body) && /ghost · Ghost Person/.test(body), 'lists the logins that open nobody');
  const names = await page.$$eval('.admin-main .panel', ps => ps[0] ? [...ps[0].children].map(r => (r.firstChild && r.firstChild.firstChild ? r.firstChild.firstChild.textContent : '')) : []);
  ok(names.length > 3 && !names.includes('Bri Brower'), 'someone who left isn’t listed as missing');
  const opts = await page.$$eval('.admin-main select option', os => os.map(o => o.value));
  ok(opts.includes('evie') && opts.includes('ghost') && !opts.includes('bri') && !opts.includes('nina'), 'only unlinked logins are offered for linking');
  await page.screenshot({ path: 'shots/09-signin-check.png', fullPage: true });
  page.once('dialog', d => d.accept());
  const eveRow = page.locator('.admin-main .panel > div', { hasText: 'Eve Pavlova' });
  await eveRow.locator('select').selectOption('evie');
  await page.waitForSelector('text=Linked: evie · Evie P → Eve Pavlova.', { timeout: 15000 }).catch(() => { });
  ok(await page.isVisible('text=Linked: evie · Evie P → Eve Pavlova.'), 'linking a login says so');
  const ro = await fsGet('roster/evie');
  ok(ro.fields && ro.fields.rid && ro.fields.rid.stringValue === 's_eve', 'the link is saved on the NLO Cases login (Staff Hub id)');
  await page.click('.admin-nav button:has-text("Lock")'); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'evie'); ok(await waitHash(page, /^#\/app\/mine$/) && await cad(page) === 's_eve', 'the linked login opens Eve’s checklists');
  // his login turned into a member record check: the members listener is live
  await ctx.close();
}

console.log('6. login turned off while signed in');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'gwen'); await waitHash(page, /^#\/app\/mine$/);
  await fsSet('members/' + uids.gwen, { staffId: 'gwen', username: 'gwen', name: 'Gwen Rodis', role: 'staff', active: false, mustSetup: false, gen: 1 });
  ok(await waitHash(page, /^#\/picker$/, 10000), 'turned off in NLO Cases → locked out at once');
  ok(await page.isVisible('text=Your access was turned off.'), 'says why');
  await signIn(page, 'gwen'); ok(/turned off/.test(await errText(page)), 'and can’t sign back in');
  await fsSet('members/' + uids.gwen, { staffId: 'gwen', username: 'gwen', name: 'Gwen Rodis', role: 'staff', active: true, mustSetup: false, gen: 1 });
  await ctx.close();
}

console.log('6b. page cache, Lock offline');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'gwen'); await waitHash(page, /^#\/app\/mine$/);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  ok(await waitHash(page, /^#\/picker$/), 'back from the browser’s page cache → locked');
  await signIn(page, 'gwen'); await waitHash(page, /^#\/app\/mine$/);
  await ctx.setOffline(true);
  await page.waitForTimeout(2500);
  ok(/#\/app\/mine$/.test(await hash(page)), 'going offline right after signing in doesn’t lock anyone out');
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('.nlo-lock-btn'); await page.waitForTimeout(500);
  ok(/offline/i.test(asked), 'Lock with no internet asks first');
  ok(/#\/app\/mine$/.test(await hash(page)), 'and stays signed in when told not to');
  page.once('dialog', d => d.accept());
  await page.click('.nlo-lock-btn');
  ok(await waitHash(page, /^#\/picker$/), 'and locks when told to');
  await ctx.setOffline(false);
  await ctx.close();
}

console.log('7. forgot password (Dr. A)');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await page.click('text=Dr. A: reset by email');
  await page.fill('#nloFe', 'dr.owner@example.com'); await page.click('form button[type=submit]');
  await page.waitForSelector('text=If that email has a login, a reset link is on its way.', { timeout: 10000 }).catch(() => { });
  ok(await page.isVisible('text=If that email has a login, a reset link is on its way.'), 'reset email sent (emulator)');
  await page.fill('#nloFe', 'nobody-here@example.com'); await page.click('form button[type=submit]');
  await page.waitForTimeout(1500);
  ok(!(await page.isVisible('.nlo-signin [role=alert]')), 'an email with no login gets the same answer');
  await page.click('text=Back to sign in'); ok(await page.isVisible('#nloUser'), 'back to sign in');
  await ctx.close();
}

console.log('8. phone');
{
  const { ctx, page } = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await page.waitForSelector('#nloUser');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: sign-in fits the width');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#nloUser')).fontSize === '16px'), 'phone: 16px boxes (no zoom-in)');
  await page.waitForFunction(() => document.documentElement.classList.contains('nlo-home-on'), null, { timeout: 8000 }).catch(() => { });
  ok(await page.evaluate(() => { const h = document.querySelector('nlo-home'), c = document.querySelector('.auth__card'); if (!h || !c) return false; return h.getBoundingClientRect().bottom <= c.getBoundingClientRect().top + 1; }), 'phone: the Apps button stays clear of the sign-in card');
  await page.screenshot({ path: 'shots/06-phone-signin.png' });
  await signIn(page, 'gwen'); await waitHash(page, /^#\/app\/mine$/);
  await page.waitForSelector('.nlo-lock-btn');
  ok(await page.isVisible('.nlo-lock-btn'), 'phone: Lock button in the top bar');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: checklists fit the width');
  await page.screenshot({ path: 'shots/07-phone-mine.png' });
  await page.tap('.nlo-lock-btn'); ok(await waitHash(page, /^#\/picker$/), 'phone: Lock works');
  await signIn(page, 'dr.owner@example.com'); ok(await waitHash(page, /^#\/admin/), 'phone: Dr. A opens admin');
  await page.screenshot({ path: 'shots/08-phone-admin.png' });
  await ctx.close();
}

console.log('9. Dr. A’s own phone (his Google account connects it)');
{
  const { ctx, page } = await device({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE); await connect(page, 'akhavan.ak@gmail.com'); ok(await waitHash(page, /^#\/picker$/), 'his Google account connects the device');
  await signIn(page, 'dr.owner@example.com'); ok(await waitHash(page, /^#\/admin/), 'and his login opens admin');
  await ctx.close();
}

console.log('10. a Google account that isn’t the office’s');
{
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page, 'someone@gmail.com');
  await page.waitForSelector('text=Access denied', { timeout: 10000 }).catch(() => { });
  ok(await page.isVisible('text=Access denied for someone@gmail.com'), 'outside Google account refused');
  ok(/^(#\/)?$/.test(await hash(page)), 'stays on the device step (' + await hash(page) + ')');
  await ctx.close();
}

if (!QUICK) {
  console.log('11. idle lock (NLO Cases idle minutes = 1; waits ~75 s)');
  await fsSet('meta/settings', { idleMin: 1 });
  const { ctx, page } = await device();
  await page.goto(BASE); await connect(page); await waitHash(page, /^#\/picker$/);
  await signIn(page, 'kaylee'); await waitHash(page, /^#\/app\/mine$/);
  const t0 = Date.now();
  await page.waitForSelector('.nlo-idle-warn', { state: 'visible', timeout: 15000 }).catch(() => { });
  ok(await page.isVisible('text=Cadence locks in under a minute. Tap anywhere to stay signed in.'), 'the last-minute warning shows');
  ok(await waitHash(page, /^#\/picker$/, 100000), 'locks after the office’s idle minutes (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  ok(await page.isVisible('text=Locked after 1 minutes without activity.'), 'says why');
  await ctx.close();
  console.log('12. idle with no internet: waits for it (~2 min)');
  const d2 = await device(); const p2 = d2.page;
  await p2.goto(BASE); await connect(p2); await waitHash(p2, /^#\/picker$/);
  await signIn(p2, 'kaylee'); await waitHash(p2, /^#\/app\/mine$/);
  await p2.waitForSelector('.nlo-idle-warn', { state: 'visible', timeout: 15000 }).catch(() => { });
  ok(await p2.isVisible('.nlo-idle-warn'), 'warns during the last minute');
  await d2.ctx.setOffline(true);
  await p2.waitForTimeout(80000);
  ok(/#\/app\/mine$/.test(await hash(p2)), 'no internet: stays signed in past the idle minutes');
  await d2.ctx.setOffline(false);
  ok(await waitHash(p2, /^#\/picker$/, 30000), 'internet back: locks');
  await fsSet('meta/settings', { idleMin: 10 });
  await d2.ctx.close();
}

await browser.close();
console.log('\npage errors:', errors.length); errors.slice(0, 10).forEach(e => console.log('  ' + e.slice(0, 400)));
console.log(`\n${pass} passed, ${fail} failed`); fails.forEach(f => console.log('  FAILED: ' + f));
process.exit(fail || errors.length ? 1 : 0);
