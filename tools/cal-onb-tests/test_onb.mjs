// End-to-end: Onboarding before the move (office Google account + name picker + PINs on office computers, personal links on
// phones, old database), Dr. A's move onto the NLO Cases system, and after it (everyone's own NLO Cases login everywhere,
// sign-offs by the signed-in trainer, managers he names, Lock), then the way back. Emulators only; a made-up office.
// node test_onb.mjs
import fs from 'node:fs';
import * as E from './seed.mjs';
import { WIRE } from './wire.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.MTG_BASE || 'http://127.0.0.1:8766/';
const ONB = BASE + 'onboarding.html';
const SDK = new URL('./node_modules/firebase/', import.meta.url).pathname;
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const fails = [];
function ok(c, what) { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
process.chdir(new URL('./', import.meta.url).pathname);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
async function device(tag, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 }, acceptDownloads: true }, opts));
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/(?:10\.12|9\.23)\.\d+\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(tag + ': ' + String(e && e.stack || e)); console.log('  PAGEERROR', tag, String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED|identitytoolkit|Could not reach Cloud Firestore backend/.test(m.text())) { errors.push(tag + ': ' + m.text()); console.log('  console.error', tag, m.text().slice(0, 300)); } });
  return { ctx, page };
}
/* the office Google account on this browser (the emulator takes a made-up Google token); the page starts over to pick it up */
async function google(p, email) {
  await p.waitForFunction(() => typeof firebase !== 'undefined' && firebase.apps && firebase.apps.some(a => a.name === '[DEFAULT]'), null, { timeout: 20000 });
  await p.evaluate(async email => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name: email.split('@')[0] }));
    await firebase.auth().signInWithCredential(cred);
  }, email);
  await p.reload();
}
const st = p => p.evaluate(() => ({ boot: NLO_ONB.S.boot, mode: NLO_ONB.S.mode, actor: NLO_ONB.S.actor, route: NLO_ONB.S.route && NLO_ONB.S.route.v, people: Object.keys(NLO_ONB.S.people || {}), mods: Object.keys((NLO_ONB.S.cat && NLO_ONB.S.cat.modules) || {}).length, roster: Object.keys(NLO_ONB.S.roster || {}), online: NLO_ONB.S.online }));
async function ready(p, ms = 30000) { try { await p.waitForFunction(() => window.NLO_ONB && NLO_ONB.S.boot === 'ready' && NLO_ONB.S.catLoaded, null, { timeout: ms }); return true; } catch { return false; } }
async function fsSignIn(p, user, pw) {
  await p.waitForSelector('#ncForm', { timeout: 20000 });
  await p.fill('#ncUser', user); await p.fill('#ncPw', pw); await p.click('#ncGo');
  await p.waitForFunction(() => (NLO_ONB.S.boot === 'ready') || (document.getElementById('ncErr') && document.getElementById('ncErr').style.display !== 'none' && !document.querySelector('#ncGo[disabled]')), null, { timeout: 30000 });
  return (await p.evaluate(() => NLO_ONB.S.boot === 'ready')) ? 'app' : await p.textContent('#ncErr');
}
const go = (p, r) => p.evaluate(r => NLO_ONB.go(r), r);
const toasts = p => p.evaluate(() => Array.from(document.querySelectorAll('.toast, [class*="toast"]')).map(x => x.textContent).join(' | '));

console.log('0. the office, Onboarding as it is today');
await E.loadRules();
await E.seedOffice();
await E.linkRoster();
await E.loadRtdbRules();
await E.seedOld();
for (const c of ['onbPeople', 'onbTracks', 'onbMods', 'onbState', 'onbMeta', 'hubRoster', 'cadMirror']) {
  const docs = await E.fsList('nlo-cases', c).catch(() => []);
  for (const d of docs) await fetch(`${E.FS}/v1/projects/nlo-cases/databases/(default)/documents/${c}/${d.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}
await E.loadOlderCasesRules();   // the NLO Cases rules as live today (without Onboarding's part) until Dr. A publishes them in the move

/* ---------- 1. before the move ---------- */
console.log('1. before the move');
const A = await device('drA');
const pa = A.page;
await pa.goto(ONB);
await pa.waitForSelector('[data-act="signin"]', { timeout: 20000 });
ok(/office Google account/.test(await pa.textContent('.gate-card')), 'before the move: the office Google sign-in, as today');
await google(pa, 'akhavan.ak@gmail.com');
ok(await ready(pa), 'Dr. A’s Google account opens Onboarding');
let s = await st(pa);
ok(s.mode === 'staff' && s.actor === 's_amir' && s.route === 'dash' && s.people.includes('s_nora') && s.mods === 2 && s.roster.includes('s_gwen'), 'as today: office mode, Dr. A, Team progress; Nora’s training, the curriculum and Staff Hub’s roster from the old database — ' + JSON.stringify(s).slice(0, 160));
await go(pa, { v: 'settings' });
ok(await pa.isVisible('[data-act="moveOpen"]'), 'Settings → “Move to the NLO Cases system…” (Dr. A only)');
await pa.screenshot({ path: 'shots/onb-01-settings-move.png', fullPage: true });
// the office computer: the office account, the name picker
const B = await device('office');
const pb = B.page;
await pb.goto(ONB);
await pb.waitForSelector('[data-act="signin"]', { timeout: 20000 });
await google(pb, 'records@thenextlevelorthodontics.com');
ok(await ready(pb), 'the office account opens Onboarding on the office computer');
s = await st(pb);
await pb.waitForFunction(() => /Who’s here\?/.test(document.getElementById('app').textContent), null, { timeout: 15000 }).catch(() => { });
ok(s.mode === 'staff' && !s.actor && s.route === 'picker' && /Who’s here\?/.test(await pb.textContent('#app')), '…at the name picker (then a PIN), as today' + (s.route === 'picker' ? '' : ' — ' + JSON.stringify(s).slice(0, 160)));
ok(!(await pb.isVisible('[data-act="moveOpen"]')), '…and no move anywhere for staff');
// Nora's phone: her personal link
const C = await device('phone', { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
const pc = C.page;
await pc.goto(ONB + '#k=abcdefghjkmnpqrs');
ok(await ready(pc), 'Nora’s phone opens her personal link');
s = await st(pc);
ok(s.mode === 'device' && s.actor === 's_nora' && s.route === 'home', '…straight into her training, as today');
await pc.screenshot({ path: 'shots/onb-02-phone-link.png', fullPage: false });

/* ---------- 2. the move ---------- */
console.log('2. the move');
await pa.click('[data-act="moveOpen"]');
await pa.waitForSelector('#mvForm', { timeout: 10000 });
ok(await pa.isVisible('#mvUser'), 'step 1: Dr. A’s NLO Cases login');
await pa.fill('#mvUser', 'gwen'); await pa.fill('#mvPw', E.PW); await pa.click('#mvGo');
await pa.waitForFunction(() => /Only Dr\. A/.test(document.getElementById('mvBody').textContent), null, { timeout: 15000 }).catch(() => { });
{ const t = await pa.textContent('#mvBody'); ok(/Only Dr\. A’s NLO Cases login can move/.test(t), 'a staff login can’t move it' + (/Only Dr/.test(t) ? '' : ' — got: ' + t.replace(/\s+/g, ' ').slice(0, 200))); }
await pa.waitForSelector('#mvGo:not([disabled])', { timeout: 10000 });
await pa.fill('#mvUser', E.OWNER.email); await pa.fill('#mvPw', E.PW); await pa.click('#mvGo');
await pa.waitForSelector('#mvCopy', { timeout: 20000 });
ok(/publish the updated database rules/.test(await pa.textContent('#mvBody')), 'step 2: the NLO Cases rules don’t have Onboarding’s part yet → the rules card');
await pa.click('#mvCopy');
await pa.waitForFunction(() => /Copied|select it/.test(document.getElementById('mvCopied').textContent), null, { timeout: 10000 }).catch(() => { });
ok(/Copied ✓|select it from the box/.test(await pa.textContent('#mvCopied')), '“Copy the new rules” gets the shared rules file (with Onboarding’s part)');
await pa.click('#mvCheck');
await pa.waitForFunction(() => /Not yet/.test(document.getElementById('mvRulesMsg').textContent), null, { timeout: 10000 }).catch(() => { });
ok(/Not yet — the database still has the older rules/.test(await pa.textContent('#mvRulesMsg')), '“Check again” before publishing: not yet');
await pa.screenshot({ path: 'shots/onb-03-rules-card.png', fullPage: true });
// just after Publish, a part of the database can still have the older rules for a few minutes: the move page waits and
// tries again by itself
await E.loadRulesWithout('onbTracks/{id}');
await pa.click('#mvCheck');
await pa.waitForFunction(() => /still taking in the new rules/.test((document.getElementById('mvBody') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => { });
ok(/Trying again by itself/.test(await pa.textContent('#mvBody')), 'new rules not everywhere yet: it waits and tries again by itself');
await E.loadRules();   // Dr. A publishes the rules in the Firebase console
await pa.waitForSelector('#mvNow', { timeout: 40000 });
const what = await pa.textContent('#mvBody');
ok(/People[^:]*: 1/.test(what) && /Trainers & managers: 1/.test(what) && /Settings: 1/.test(what) && /Tracks: 2/.test(what) && /Modules: 2/.test(what) && /Curriculum version: 1/.test(what) && /Staff Hub’s roster \(a copy\): 1/.test(what) && /PINs, phone links and their devices stay behind/.test(what), 'step 3: what moves, counted; PINs and links stay behind — ' + what.replace(/\s+/g, ' ').slice(0, 140));
await pa.screenshot({ path: 'shots/onb-04-what-moves.png', fullPage: true });
const dl = pa.waitForEvent('download', { timeout: 30000 }).then(d => d.suggestedFilename(), () => '');
const reloadedA = pa.waitForNavigation({ timeout: 60000 }).then(() => true, () => false);
await pa.click('#mvNow');
await pb.waitForSelector('#nlomOverlay', { timeout: 15000 }).catch(() => { });
ok(/moving Onboarding to the NLO Cases system/.test(await pb.textContent('#nlomOverlay').catch(() => '')), 'the office computer’s screen pauses while it moves');
ok(/^onboarding-before-move-.*\.json$/.test(await dl), 'a copy of everything goes to Downloads first');
await pa.waitForFunction(() => /Switched over ✓/.test((document.getElementById('mvBody') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => { });
ok(/Checked: \d+ records written and read back the same ✓/.test(await pa.textContent('#mvBody').catch(() => '')) && /Switched over ✓/.test(await pa.textContent('#mvBody').catch(() => '')), 'step 4: written, checked, switched over');
await pa.screenshot({ path: 'shots/onb-05-moved.png', fullPage: true });
ok(await reloadedA, 'Dr. A’s screen reloads…');
await pa.waitForSelector('#ncForm', { timeout: 30000 });
ok(await pa.isVisible('#ncUser'), '…to the NLO Cases sign-in');
{
  const moved = await E.fsGet('nlo-cases', 'onbMeta/moved'), info = await E.fsGet('nlo-cases', 'onbMeta/info'), ros = await E.fsGet('nlo-cases', 'hubRoster/live');
  const ppl = await E.fsList('nlo-cases', 'onbPeople'), mods = await E.fsList('nlo-cases', 'onbMods'), roles = await E.fsGet('nlo-cases', 'onbState/roles');
  ok(moved && moved.on === true, 'onbMeta/moved says Onboarding is on the NLO Cases system');
  ok(info && info.counts && info.counts.people === 1 && info.by === 'akhavan.ak@gmail.com', 'onbMeta/info keeps what was moved and by whom');
  ok(ppl.length === 1 && ppl[0].id === 's_nora' && ppl[0].data.plan && ppl[0].data.progress && !('pins' in ppl[0].data), 'Nora’s record: plan, progress (no PIN)');
  ok(mods.length === 2 && roles && roles.trainers && roles.trainers.s_gwen === true, 'the curriculum and the roles');
  ok(ros && ros.people && ros.people.s_nora, 'Staff Hub’s roster copied in');
  const mark = await E.dbGet('nlo/onboarding/movedTo');
  ok(mark && mark.to === 'nlo-cases' && !(await E.dbGet('nlo/onboarding/moving')), 'the old database is marked as moved; the claim released');
  ok(!!(await E.dbGet('nlo/onboarding/pins')) && !!(await E.dbGet('nlo/onboarding/keys')), 'the PINs and phone links are left where they were');
}
await pb.waitForSelector('#ncForm', { timeout: 30000 }).catch(() => { });
ok(await pb.isVisible('#ncUser').catch(() => false), 'the office computer’s screen switches over to the NLO Cases sign-in by itself');
await pc.waitForSelector('#ncForm', { timeout: 40000 }).catch(() => { });
ok(await pc.isVisible('#ncUser').catch(() => false) && /Personal links aren’t used any more/.test(await pc.textContent('.gate-card').catch(() => '')), 'Nora’s phone (on her personal link) switches over too, and says links aren’t used any more');
await pc.screenshot({ path: 'shots/onb-06-phone-after.png', fullPage: false });

/* ---------- 3. after the move ---------- */
console.log('3. after the move');
ok(await fsSignIn(pa, E.OWNER.email, E.PW) === 'app' && await ready(pa), 'Dr. A signs in with his NLO Cases login');
s = await st(pa);
ok(s.mode === 'nc' && s.actor === 's_amir' && (s.route === 'dash' || s.route === 'settings') && s.people.includes('s_nora') && s.mods === 2 && s.roster.includes('s_gwen'), 'Team progress, Nora’s training, the curriculum and Staff Hub’s roster — now from the NLO Cases system — ' + JSON.stringify(s).slice(0, 160));
await go(pa, { v: 'access' });
const acc = await pa.textContent('#app');
ok(!/PIN/.test(acc.replace(/NLO Cases login/g, '')) && !/Phone link/.test(acc) && /Everyone signs in with their own NLO Cases login/.test(acc), 'People & access: no PIN or phone-link columns; how sign-in works now');
await pa.screenshot({ path: 'shots/onb-07-access.png', fullPage: true });
await go(pa, { v: 'settings' });
ok(await pa.isVisible('[data-act="moveBackOpen"]') && /follows NLO Cases’ idle minutes/.test(await pa.textContent('#app')), 'Settings: Data → “Move back…”; the idle lock follows NLO Cases');
// Nora: her login is still being set up in NLO Cases
ok(/Finish setting up your login in NLO Cases first/.test(await fsSignIn(pc, 'newbie', E.PW)), 'Nora’s phone: a login still on its temporary password is sent to NLO Cases first');
await E.fsSet('nlo-cases', 'members/' + E.STAFF[1].uid, { mustSetup: false }, ['mustSetup']);   // she finishes setting it up in NLO Cases
ok(await fsSignIn(pc, 'newbie', E.PW) === 'app' && await ready(pc), '…then she signs in on her phone');
s = await st(pc);
ok(s.mode === 'nc' && s.actor === 's_nora' && s.route === 'home', '…straight into her own training (her login is linked to her Staff Hub person)');
ok(!(await pc.$('[data-act="moveOpen"]')) && !(await pc.$('[data-act="moveBackOpen"]')), '…no move for staff');
await pc.screenshot({ path: 'shots/onb-08-phone-home.png', fullPage: false });
// she takes the quiz
await go(pc, { v: 'lesson', rid: 's_nora', mid: 'core-welcome', lid: 'l-quiz1' });
await pc.waitForSelector('[data-act="quizPick"]', { timeout: 10000 });
await pc.click('[data-act="quizPick"][data-q="0"][data-o="0"]');
await pc.click('[data-act="quizSubmit"]');
await sleep(1500);
let nora = await E.fsGet('nlo-cases', 'onbPeople/s_nora');
ok(nora && nora.progress['core-welcome']['l-quiz1'] && nora.progress['core-welcome']['l-quiz1'].best === 100 && nora._by === 'newbie', 'she passes a quiz: saved on the NLO Cases system, stamped with her staff id');
ok(await pa.evaluate(() => { const p = NLO_ONB.S.people.s_nora; return !!(p && p.progress['core-welcome'] && p.progress['core-welcome']['l-quiz1'] && p.progress['core-welcome']['l-quiz1'].best === 100); }), '…and Dr. A’s screen shows it');
// her skill: she can't sign herself off
await go(pc, { v: 'lesson', rid: 's_nora', mid: 'clinic-steri', lid: 'l-skill1' });
await pc.waitForSelector('.crit', { timeout: 10000 });
ok(!(await pc.$('[data-act="signoffStart"]')) && /Ready since/.test(await pc.textContent('#app')), 'her skill lesson: ready for sign-off, no sign-off button for herself');
// Gwen (trainer) on the office computer
ok(await fsSignIn(pb, 'gwen', E.PW) === 'app' && await ready(pb), 'Gwen signs in on the office computer');
s = await st(pb);
ok(s.mode === 'nc' && s.actor === 's_gwen' && s.route === 'signoffs', '…a trainer: straight to Sign-offs' + (s.route === 'signoffs' ? '' : ' — ' + JSON.stringify(s).slice(0, 160)));
await pb.waitForFunction(() => /Wrap an instrument tray/.test(document.getElementById('app').textContent), null, { timeout: 15000 }).catch(() => { });
ok(/Wrap an instrument tray/.test(await pb.textContent('#app')), '…Nora’s skill is waiting there');
await pb.click('[data-act="openLesson"][data-lid="l-skill1"]');
await pb.waitForSelector('[data-act="signoffStart"]', { timeout: 10000 });
ok(true, 'she opens it: “Trainer sign-off”');
await pb.click('[data-act="signoffStart"]');
await pb.waitForSelector('#soBy', { state: 'attached', timeout: 10000 });
ok(await pb.evaluate(() => document.getElementById('soBy').type === 'hidden' && document.getElementById('soBy').value === 's_gwen') && /Gwen Rodis.*signed in/.test(await pb.textContent('#modal')), 'the sign-off is by the signed-in trainer — no picking, no PIN');
await pb.click('[data-act="soSign"]');
await sleep(300);
ok(await pb.evaluate(() => document.getElementById('modal').innerHTML !== ''), 'every item must be checked first');
await pb.$$eval('.soCrit', els => els.forEach(e => { e.click(); }));
await pb.fill('#soNote', 'Great job');
await pb.click('[data-act="soSign"]');
await sleep(1500);
nora = await E.fsGet('nlo-cases', 'onbPeople/s_nora');
const so = nora && nora.signoffs && nora.signoffs['clinic-steri'] && nora.signoffs['clinic-steri']['l-skill1'];
ok(so && so.by === 's_gwen' && so.byName === 'Gwen Rodis' && so.note === 'Great job' && nora._by === 'gwen', 'signed off by Gwen (her Staff Hub id), stamped with her staff id');
await pc.waitForFunction(() => /Signed off by Gwen Rodis/.test(document.getElementById('app').textContent), null, { timeout: 15000 }).catch(() => { });
ok(/Signed off by Gwen Rodis/.test(await pc.textContent('#app')), 'Nora’s phone shows it at once');
await pc.screenshot({ path: 'shots/onb-09-signed-off.png', fullPage: false });
// managers: Gwen can't touch the curriculum until Dr. A names her a manager
ok(!(await pb.evaluate(() => NLO_ONB.S.roles.managers.s_gwen)) && await pb.evaluate(() => { NLO_ONB.go({ v: 'curriculum' }); return /This page is for managers/.test(document.getElementById('app').textContent); }), 'a trainer can’t open the curriculum');
await go(pa, { v: 'access' });
await pa.click('[data-act="roleToggle"][data-role="managers"][data-rid="s_gwen"]');
await pb.waitForFunction(() => NLO_ONB.S.roles.managers.s_gwen === true, null, { timeout: 15000 }).catch(() => { });
ok(await pb.evaluate(() => NLO_ONB.S.roles.managers.s_gwen === true), 'Dr. A names Gwen a manager: her screen knows at once');
await go(pb, { v: 'curriculum' });
ok(/Curriculum/.test(await pb.textContent('#app')) && !/This page is for managers/.test(await pb.textContent('#app')), '…and she can open the curriculum');
const tryB = code => pb.evaluate(async code => { try { await (new Function('d', 'return ' + code))(NLO_ONB.nloo.db(NLO_ONB.nloo.fs, () => NLO_ONB.nloo.me.sid, null)); return 'ok'; } catch (e) { return String(e.code || e.message); } }, code);
ok(await tryB(`d.ref('nlo/onboarding/catalog/tracks/core/desc').set('Everyone, first')`) === 'ok', '…the database lets her change it');
ok(/permission/.test(await tryB(`d.ref('nlo/onboarding/roles/managers/s_nora').set(true)`)), '…but not the roles');
await pa.click('[data-act="roleToggle"][data-role="managers"][data-rid="s_gwen"]');
await pb.waitForFunction(() => !NLO_ONB.S.roles.managers.s_gwen, null, { timeout: 15000 }).catch(() => { });
ok(/permission/.test(await tryB(`d.ref('nlo/onboarding/catalog/tracks/core/desc').set('x')`)), 'unticked: the database refuses her again');
// a login turned off
{
  const N = await device('gone');
  await N.page.goto(ONB);
  ok(/turned off/.test(await fsSignIn(N.page, 'gone', E.PW)), 'a login turned off: “This login has been turned off. Ask Dr. A.”');
  await N.ctx.close();
}
// Lock
const lockReload = pb.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
await pb.click('[data-act="ncLock"]');
ok(await lockReload, 'Lock: the screen starts over…');
await pb.waitForSelector('#ncForm', { timeout: 20000 });
ok(/Locked\. Sign in to continue\./.test(await pb.textContent('.gate-card')) && await pb.evaluate(() => document.getElementById('ncUser').value === 'gwen'), '…at the sign-in, with the last username filled in');
// the assign dialog offers no phone link now
await go(pa, { v: 'dash' });
await pa.evaluate(() => NLO_ONB.ACT.assign({ dataset: { rid: 's_nora' } }));
await pa.waitForSelector('#asRid', { state: 'attached', timeout: 10000 });
ok(!/Phone link/.test(await pa.textContent('#modal')), 'the plan dialog: no phone links');
await pa.evaluate(() => NLO_ONB.ACT.closeModal());

/* ---------- 4. the way back ---------- */
console.log('4. moving back');
await go(pa, { v: 'settings' });
await pa.click('[data-act="moveBackOpen"]');
await pa.waitForSelector('#mbGo', { timeout: 15000 });
ok(!(await pa.$('#mbG')) && !(await pa.$('#mbGo[disabled]')), 'this computer still has Dr. A’s office Google sign-in: no Google step');
await pa.click('#mbGo');
await sleep(300);
ok(/Tick “Yes, move it back” first/.test(await pa.textContent('#mbBody')), 'nothing happens without the tick');
await pa.check('#mbOk');
const dl2 = pa.waitForEvent('download', { timeout: 30000 }).then(d => d.suggestedFilename(), () => '');
const reloadedA2 = pa.waitForNavigation({ timeout: 60000 }).then(() => true, () => false);
await pa.click('#mbGo');
await pc.waitForSelector('#nlomOverlay', { timeout: 15000 }).catch(() => { });
ok(/moving Onboarding back to the old database/.test(await pc.textContent('#nlomOverlay').catch(() => '')), 'Nora’s phone pauses while it moves back');
ok(/^onboarding-before-move-back-.*\.json$/.test(await dl2), 'a copy goes to Downloads first');
await pa.waitForFunction(() => /Moved back ✓/.test((document.getElementById('mbBody') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => { });
ok(/Moved back ✓/.test(await pa.textContent('#mbBody').catch(() => '')), 'moved back');
ok(await reloadedA2, 'Dr. A’s screen reloads…');
ok(await ready(pa), '…and opens with the office Google sign-in it still has');
s = await st(pa);
ok(s.mode === 'staff' && s.actor === 's_amir', '…in office mode, on the old database');
const back = await E.dbGet('nlo/onboarding');
ok(back && back.people.s_nora.signoffs['clinic-steri']['l-skill1'].by === 's_gwen' && back.people.s_nora.progress['core-welcome']['l-quiz1'].best === 100 && back.catalog.tracks.core.desc === 'Everyone, first' && back.pins && back.keys && !back.movedTo && !back.moving, 'the old database has everything done meanwhile (sign-off, quiz, curriculum), its PINs and links still there, unmarked');
ok((await E.fsGet('nlo-cases', 'onbMeta/moved')).on === false, 'onbMeta/moved says not moved');
await pc.waitForFunction(() => window.NLO_ONB && NLO_ONB.S.boot === 'ready' && NLO_ONB.S.mode === 'device', null, { timeout: 40000 }).catch(() => { });
s = await st(pc);
ok(s.mode === 'device' && s.actor === 's_nora' && ['home', 'module', 'lesson'].includes(s.route), 'Nora’s phone goes back by itself — her personal link is still in the old database, so it opens her training again from the link (' + JSON.stringify(s).slice(0, 120) + ')');
await pa.screenshot({ path: 'shots/onb-10-back.png', fullPage: true });

await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
await browser.close();
const realErrors = errors.filter(e => !/Could not reach|ERR_|net::|identitytoolkit/i.test(e));
ok(!realErrors.length, 'no page errors' + (realErrors.length ? ':\n      ' + realErrors.slice(0, 8).join('\n      ') : ''));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
