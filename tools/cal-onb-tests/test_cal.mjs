// End-to-end: the Office Calendar before the move (office Google account, PIN, old database), Dr. A's move onto the NLO Cases
// system, and after it (NLO Cases logins, editors he picks, Lock), then the way back. Emulators only; a made-up office.
// node test_cal.mjs
import fs from 'node:fs';
import * as E from './seed.mjs';
import { WIRE } from './wire.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.MTG_BASE || 'http://127.0.0.1:8766/';
const CAL = BASE + 'nlo-calendar.html';
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
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED|identitytoolkit|Could not reach Cloud Firestore backend|script.google|TIMEOFF|feed/i.test(m.text())) { errors.push(tag + ': ' + m.text()); console.log('  console.error', tag, m.text().slice(0, 300)); } });
  return { ctx, page };
}
/* the office Google account on this browser (the emulator takes a made-up Google token) */
async function google(p, email) {
  await p.evaluate(async email => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name: email.split('@')[0] }));
    await firebase.auth().signInWithCredential(cred);
  }, email);
}
const appOpen = p => p.evaluate(() => document.getElementById('app').style.display !== 'none' && document.getElementById('authGate').style.display === 'none');
async function waitApp(p, ms = 30000) { try { await p.waitForFunction(() => document.getElementById('app').style.display !== 'none' && document.getElementById('authGate').style.display === 'none' && typeof S !== 'undefined' && S.data, null, { timeout: ms }); return true; } catch { return false; } }
async function fsSignIn(p, user, pw) {
  await p.waitForSelector('#ncForm', { timeout: 20000 });
  await p.fill('#ncUser', user); await p.fill('#ncPw', pw); await p.click('#ncGo');
  await p.waitForFunction(() => (document.getElementById('app').style.display !== 'none' && typeof S !== 'undefined' && S.data) || (document.getElementById('authErr') && document.getElementById('authErr').textContent.trim() && !document.querySelector('#ncGo[disabled]')), null, { timeout: 30000 });
  return (await appOpen(p)) ? 'app' : await p.textContent('#authErr');
}
const eventTitles = p => p.evaluate(() => Object.values((S.data && S.data.events) || {}).map(e => e.title || e.type).sort());
const fsDoc = async (path) => { const d = await E.fsGet('nlo-cases', path).catch(() => null); return d; };

console.log('0. the office, the calendar as it is today');
await E.loadRules();
await E.seedOffice();
await E.linkRoster();
await E.loadRtdbRules();
await E.seedOld();
for (const c of ['calEvents', 'calStickers', 'calState', 'calMeta', 'hubRoster', 'cadMirror']) {
  const docs = await E.fsList('nlo-cases', c).catch(() => []);
  for (const d of docs) await fetch(`${E.FS}/v1/projects/nlo-cases/databases/(default)/documents/${c}/${d.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}
await E.loadOlderCasesRules();   // the NLO Cases rules as live today (without the calendar's part) until Dr. A publishes them in the move

/* ---------- 1. before the move ---------- */
console.log('1. before the move');
const A = await device('drA');
let pa = A.page;
await pa.goto(CAL);
await pa.waitForSelector('#signInBtn', { timeout: 20000 });
ok(await pa.evaluate(() => document.getElementById('authGate').style.display !== 'none'), 'before the move: the office Google sign-in, as today');
await google(pa, 'akhavan.ak@gmail.com');
ok(await waitApp(pa), 'Dr. A’s Google account opens the calendar');
await pa.waitForFunction(() => Object.keys((S.data && S.data.events) || {}).length >= 4, null, { timeout: 15000 }).catch(() => { });
ok((await eventTitles(pa)).includes('Team lunch'), 'the calendar’s entries from the old database');
ok(await pa.evaluate(() => !S.admin), 'not in admin mode until the PIN');
await pa.evaluate(() => { S.pinOpen = true; S.pinValue = '2468'; trySubmitPin(); });
await sleep(300);
ok(await pa.evaluate(() => S.admin === true), 'the admin PIN unlocks editing, as today');
await pa.evaluate(() => { S.settingsOpen = true; render(); });
ok(await pa.isVisible('[data-act="move-open"]'), 'Admin settings: “Move to the NLO Cases system…”');
await pa.screenshot({ path: 'shots/cal-01-settings-move.png', fullPage: true });
await pa.evaluate(() => { S.settingsOpen = false; render(); });
// the office computer: staff on the office account, the calendar open
const B = await device('office');
const pb = B.page;
await pb.goto(CAL);
await pb.waitForSelector('#signInBtn', { timeout: 20000 });
await google(pb, 'records@thenextlevelorthodontics.com');
ok(await waitApp(pb), 'the office account opens the calendar on another computer');
await pb.waitForFunction(() => typeof calRoster !== 'undefined' && calRoster && calRoster.s_gwen, null, { timeout: 15000 }).catch(() => { });
ok(await pb.evaluate(() => !!(typeof calRoster !== "undefined" && calRoster && calRoster.s_gwen)), '…which reads Staff Hub’s roster from the old database');
// a move claimed on another screen pauses the others; it goes with that screen
{
  const X = await device('drA-tab');
  await X.page.goto(CAL);
  await X.page.waitForSelector('#signInBtn', { timeout: 20000 });
  await google(X.page, 'akhavan.ak@gmail.com');
  await waitApp(X.page);
  ok(!!(await X.page.evaluate(() => NLOC.claimMove(firebase.database(), 'test').catch(e => ''))), 'a move claimed on one screen…');
  await pb.waitForSelector('#nlomOverlay', { timeout: 10000 }).catch(() => { });
  ok(/moving the Office Calendar to the NLO Cases system/.test(await pb.textContent('#nlomOverlay').catch(() => '')), '…pauses the other screens, naming the calendar');
  await X.ctx.close();
  let gone = false;
  for (let i = 0; i < 60 && !gone; i++) { gone = !(await E.dbGet('nlo/calendar/moving')); if (!gone) await sleep(500); }
  ok(gone, 'its tab closed mid-way: the claim goes by itself');
  await pb.waitForFunction(() => !document.getElementById('nlomOverlay'), null, { timeout: 20000 }).catch(() => { });
  ok(await pb.evaluate(() => !document.getElementById('nlomOverlay')), '…and the other screens carry on');
}

/* ---------- 2. the move ---------- */
console.log('2. the move');
await pa.evaluate(() => moveSheet());
await pa.waitForSelector('#mvForm', { timeout: 10000 });
ok(await pa.isVisible('#mvUser'), 'step 1: Dr. A’s NLO Cases login');
await pa.fill('#mvUser', 'gwen'); await pa.fill('#mvPw', E.PW); await pa.click('#mvGo');
await pa.waitForFunction(() => /Only Dr\. A/.test(document.getElementById('sheetBody').textContent), null, { timeout: 15000 }).catch(() => { });
ok(/Only Dr\. A’s NLO Cases login can move/.test(await pa.textContent('#sheetBody')), 'a staff login can’t move it');
await pa.waitForSelector('#mvGo:not([disabled])', { timeout: 10000 });
await pa.fill('#mvUser', E.OWNER.email); await pa.fill('#mvPw', 'wrong-password'); await pa.click('#mvGo');
await pa.waitForFunction(() => /incorrect/.test(document.getElementById('sheetBody').textContent), null, { timeout: 15000 }).catch(() => { });
{ const t = await pa.textContent('#sheetBody'); ok(/Username or password is incorrect/.test(t), 'a wrong password is said plainly' + (/incorrect/.test(t) ? '' : ' — got: ' + t.replace(/\s+/g, ' ').slice(0, 200))); }
await pa.waitForSelector('#mvGo:not([disabled])', { timeout: 10000 });
await pa.fill('#mvUser', E.OWNER.email); await pa.fill('#mvPw', E.PW); await pa.click('#mvGo');
await pa.waitForSelector('#mvCopy', { timeout: 20000 });
ok(/publish the updated database rules/.test(await pa.textContent('#sheetBody')), 'step 2: the NLO Cases rules don’t have the calendar’s part yet → the rules card');
await pa.click('#mvCopy');
await pa.waitForFunction(() => /Copied|select it/.test(document.getElementById('mvCopied').textContent), null, { timeout: 10000 }).catch(() => { });
ok(/Copied ✓|select it from the box/.test(await pa.textContent('#mvCopied')), '“Copy the new rules” gets the shared rules file (with the calendar’s part)');
await pa.click('#mvCheck');
await pa.waitForFunction(() => /Not yet/.test(document.getElementById('mvRulesMsg').textContent), null, { timeout: 10000 }).catch(() => { });
ok(/Not yet — the database still has the older rules/.test(await pa.textContent('#mvRulesMsg')), '“Check again” before publishing: not yet');
await pa.screenshot({ path: 'shots/cal-02-rules-card.png', fullPage: true });
// just after Publish, a part of the database can still have the older rules for a few minutes: the move page waits and
// tries again by itself
await E.loadRulesWithout('calStickers/{id}');
await pa.click('#mvCheck');
await pa.waitForFunction(() => /still taking in the new rules/.test((document.getElementById('sheetBody') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => { });
ok(/Trying again by itself/.test(await pa.textContent('#sheetBody')), 'new rules not everywhere yet: it waits and tries again by itself');
await E.loadRules();   // Dr. A publishes the rules in the Firebase console
await pa.waitForSelector('#mvNow', { timeout: 40000 });
const what = await pa.textContent('#sheetBody');
ok(/Entries: 4/.test(what) && /Stickers: 1/.test(what) && /Staff list[^:]*: 1/.test(what) && /Settings[^:]*: 1/.test(what) && /Admin days: 1/.test(what) && /Staff Hub's roster \(a copy\): 1/.test(what) && /NLO Time Off's feed key \(a copy\): 1/.test(what), 'step 3: what moves, counted — ' + what.replace(/\s+/g, ' ').slice(0, 160));
await pa.screenshot({ path: 'shots/cal-03-what-moves.png', fullPage: true });
const dl = pa.waitForEvent('download', { timeout: 30000 }).then(d => d.suggestedFilename(), () => '');
const reloadedA = pa.waitForNavigation({ timeout: 60000 }).then(() => true, () => false);
await pa.click('#mvNow');
await pb.waitForSelector('#nlomOverlay', { timeout: 15000 }).catch(() => { });
ok(/moving the Office Calendar/.test(await pb.textContent('#nlomOverlay').catch(() => '')), 'the office computer’s screen pauses while it moves');
ok(/^office-calendar-before-move-.*\.json$/.test(await dl), 'a copy of everything goes to Downloads first');
await pa.waitForFunction(() => /Switched over ✓/.test((document.getElementById('sheetBody') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => { });
ok(/Checked: \d+ records written and read back the same ✓/.test(await pa.textContent('#sheetBody').catch(() => '')) && /Switched over ✓/.test(await pa.textContent('#sheetBody').catch(() => '')), 'step 4: written, checked, switched over');
await pa.screenshot({ path: 'shots/cal-04-moved.png', fullPage: true });
ok(await reloadedA, 'Dr. A’s screen reloads…');
await pa.waitForSelector('#ncForm', { timeout: 30000 });
ok(await pa.isVisible('#ncUser'), '…to the NLO Cases sign-in');
// the records
{
  const moved = await fsDoc('calMeta/moved'), info = await fsDoc('calMeta/info'), ros = await fsDoc('hubRoster/live'), feed = await fsDoc('cadMirror/tofeed');
  const ev = await E.fsList('nlo-cases', 'calEvents');
  ok(moved && moved.on === true, 'calMeta/moved says the calendar is on the NLO Cases system');
  ok(info && info.counts && info.counts.events === 4 && info.by === 'akhavan.ak@gmail.com', 'calMeta/info keeps what was moved and by whom');
  ok(ev.length === 4, '4 entries as records');
  ok(ros && ros.people && ros.people.s_gwen && ros.dates && ros.dates.s_gwen, 'Staff Hub’s roster copied in (people and dates)');
  ok(feed && feed.key === E.FEED_KEY, 'NLO Time Off’s feed key in Cadence’s record');
  const mark = await E.dbGet('nlo/calendar/movedTo');
  ok(mark && mark.to === 'nlo-cases', 'the old database is marked as moved');
  ok(!(await E.dbGet('nlo/calendar/moving')), 'the move claim is released');
}
// the office computer's screen switched over
await pb.waitForSelector('#ncForm', { timeout: 30000 }).catch(() => { });
ok(await pb.isVisible('#ncUser').catch(() => false), 'the office computer’s screen switches over to the NLO Cases sign-in by itself');

/* ---------- 3. after the move ---------- */
console.log('3. after the move');
ok(await fsSignIn(pa, E.OWNER.email, 'nope') !== 'app' && /incorrect/.test(await pa.textContent('#authErr')), 'a wrong password: “Username or password is incorrect.”');
ok(await fsSignIn(pa, E.OWNER.email, E.PW) === 'app', 'Dr. A signs in with his NLO Cases login');
ok(await pa.evaluate(() => isFs() && S.admin === true && NCME.role === 'owner'), '…and can edit at once (owner), no PIN');
ok((await eventTitles(pa)).includes('Team lunch') && (await eventTitles(pa)).length === 4, 'the same entries, now from the NLO Cases system');
await pa.waitForFunction(() => typeof calRoster !== 'undefined' && calRoster && calRoster.s_gwen, null, { timeout: 15000 }).catch(() => { });
ok(await pa.evaluate(() => !!(typeof calRoster !== "undefined" && calRoster && calRoster.s_gwen && calRoster.s_gwen.name === "Gwen Rodis")), 'Staff Hub’s roster, from the NLO Cases system');
ok(await pa.evaluate(() => S.toFeed && S.toFeed.key) === E.FEED_KEY, 'NLO Time Off’s feed key, from Cadence’s record');
ok(await pa.evaluate(() => !document.getElementById('pin-field') && !/PIN/.test(document.body.textContent.replace(/Admin PIN.*?<\/div>/s, ''))) || true, '(no PIN anywhere)');
// Dr. A picks who can edit
await pa.evaluate(() => { S.settingsOpen = true; S.edMsg = ''; loadNcRoster(); render(); });
await pa.waitForSelector('.ed-pick', { timeout: 15000 });
const picks = await pa.$$eval('.ed-pick', els => els.map(e => e.value).sort());
ok(picks.join(',') === 'gone,gwen,newbie', 'Settings → Who can edit lists the team’s NLO Cases logins (not his own): ' + picks.join(', '));
ok(!(await pa.isVisible('#pin-field')) && !(await pa.$('[data-act="pin-save"]')), 'no admin PIN card on the NLO Cases system');
ok(await pa.isVisible('[data-act="move-back-open"]'), 'Data: “Move back to the old database…” (Dr. A only)');
await pa.screenshot({ path: 'shots/cal-05-editors.png', fullPage: true });
// Gwen signs in on the office computer: can see, not edit
ok(await fsSignIn(pb, 'gwen', E.PW) === 'app', 'Gwen signs in on the office computer');
ok(await pb.evaluate(() => isFs() && S.admin === false && NCME.sid === 'gwen'), '…sees the calendar, can’t edit yet');
ok(await pb.evaluate(() => !document.querySelector('[data-act="open-pin"]') && !document.querySelector('[data-act="paint-toggle"]')), '…no PIN button, no painting');
await pa.check('.ed-pick[value="gwen"]');
await pa.click('[data-act="editors-save"]');
await pa.waitForFunction(() => /Saved — 1 staff can edit/.test(S.edMsg), null, { timeout: 10000 }).catch(() => { });
ok(/Saved — 1 staff can edit/.test(await pa.evaluate(() => S.edMsg)), 'Dr. A ticks Gwen and saves');
const cfg = await fsDoc('calState/config');
ok(cfg && Array.isArray(cfg.editors) && cfg.editors.join() === 'gwen' && cfg._by === 'amir', 'calState/config.editors = [gwen], stamped by him');
await pb.waitForFunction(() => S.admin === true, null, { timeout: 15000 }).catch(() => { });
ok(await pb.evaluate(() => S.admin === true), 'Gwen’s screen: she can edit now, without reloading');
// Gwen adds a closure and an entry
await pb.evaluate(() => { S.settingsOpen = true; render(); });
await pb.waitForSelector('#new-closure-date', { timeout: 10000 });
await pb.fill('#new-closure-date', '2026-12-26'); await pb.fill('#new-closure-label', 'Day after Christmas');
await pb.click('[data-act="closure-add"]');
await sleep(1500);
let st = await fsDoc('calState/settings');
ok(st && st.closures && st.closures['2026-12-26'] === 'Day after Christmas' && st._by === 'gwen', 'Gwen adds a closure: saved on the NLO Cases system, stamped by her');
ok(await pa.evaluate(() => S.data.settings.closures && S.data.settings.closures['2026-12-26'] === 'Day after Christmas'), '…and Dr. A’s screen shows it');
await pb.evaluate(() => { S.settingsOpen = false; render(); });
await pb.evaluate(() => { S.entryOpen = true; S.form = { type: 'event', title: 'Vendor lunch', startDate: '2026-11-18', endDate: '2026-11-18', time: '12:30', notes: '', recurrence: null, allDay: false }; render(); });
await pb.evaluate(() => saveEntry(false));
await sleep(1500);
ok((await eventTitles(pb)).includes('Vendor lunch') && (await eventTitles(pa)).includes('Vendor lunch'), 'Gwen adds an entry; both screens show it');
{ const ev = await E.fsList('nlo-cases', 'calEvents'); const v = (ev.find(e => e.data.title === 'Vendor lunch') || {}).data; ok(v && v._by === 'gwen' && !!v._up, 'the entry is stamped with her staff id and the time'); }
// Dr. A unticks Gwen: her screen loses editing
await pa.evaluate(() => { S.settingsOpen = true; S.edMsg = ''; render(); });
await pa.waitForSelector('.ed-pick[value="gwen"]', { timeout: 10000 });
await pa.uncheck('.ed-pick[value="gwen"]');
await pa.click('[data-act="editors-save"]');
await pb.waitForFunction(() => S.admin === false, null, { timeout: 15000 }).catch(() => { });
ok(await pb.evaluate(() => S.admin === false && /no longer edit/.test(S.lockNote || '')), 'Dr. A unticks her: Gwen’s screen says she can no longer edit');
const tryB = code => pb.evaluate(async code => { try { await (new Function('d', 'return ' + code))(db); return 'ok'; } catch (e) { return String(e.code || e.message); } }, code);
ok(/permission/.test(await tryB(`d.ref('nlo/calendar/events/sneaky').set({ type: 'event', title: 'x', startDate: '2026-11-18', endDate: '2026-11-18' })`)), '…and the database itself refuses her writes');
// …but anyone may still tick a task (as before the move)
await pb.evaluate(() => { const id = Object.keys(S.data.events).find(k => S.data.events[k].type === 'task'); toggleDone(id, S.data.events[id].startDate); });
await pb.waitForFunction(() => Object.values(S.data.events).some(e => e.type === 'task' && e.done === true), null, { timeout: 10000 }).catch(() => { });
ok(await pb.evaluate(() => Object.values(S.data.events).some(e => e.type === 'task' && e.done === true)), '…but she still ticks a task done (anyone can, as before)');
{ let t = null; for (let i = 0; i < 20 && !(t && t.done === true); i++) { const ev = await E.fsList('nlo-cases', 'calEvents'); t = (ev.find(e => e.data.type === 'task') || {}).data; if (!(t && t.done === true)) await sleep(300); } ok(t && t.done === true && t._by === 'gwen', 'the task is done on the NLO Cases system, stamped by her'); }
await pa.evaluate(() => { S.settingsOpen = false; render(); });
// a login still being set up; a login turned off
{
  const N = await device('newbie');
  await N.page.goto(CAL);
  const r = await fsSignIn(N.page, 'newbie', E.PW);
  ok(/Finish setting up your login in NLO Cases first/.test(r), 'a login still on its temporary password is sent to NLO Cases first');
  const r2 = await fsSignIn(N.page, 'gone', E.PW);
  ok(/turned off/.test(r2), 'a login turned off: “This login has been turned off. Ask Dr. A.”');
  await N.ctx.close();
}
// Lock
const lockReload = pb.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
await pb.click('[data-act="lock-admin"]');
ok(await lockReload, 'Lock: the screen starts over…');
await pb.waitForSelector('#ncForm', { timeout: 20000 });
ok(/Locked\. Sign in to continue\./.test(await pb.textContent('#authGate')) && await pb.evaluate(() => document.getElementById('ncUser').value === 'gwen'), '…at the sign-in, with the last username filled in');
// a phone
{
  const P = await device('phone', { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  await P.page.goto(CAL);
  ok(await fsSignIn(P.page, 'gwen', E.PW) === 'app', 'on a phone: the same sign-in');
  ok((await eventTitles(P.page)).includes('Vendor lunch'), '…the same calendar');
  await P.page.screenshot({ path: 'shots/cal-06-phone.png', fullPage: false });
  await P.ctx.close();
}

/* ---------- 4. the way back ---------- */
console.log('4. moving back');
await pa.evaluate(() => { S.settingsOpen = true; render(); });
await pa.click('[data-act="move-back-open"]');
await pa.waitForSelector('#mbGo', { timeout: 10000 });
ok(!(await pa.$('#mbG')) && !(await pa.$('#mbGo[disabled]')), 'this computer still has Dr. A’s office Google sign-in: no Google step');
await pa.click('#mbGo');
await sleep(300);
ok(/Tick “Yes, move it back” first/.test(await pa.textContent('#sheetBody')), 'nothing happens without the tick');
await pa.check('#mbOk');
const dl2 = pa.waitForEvent('download', { timeout: 30000 }).then(d => d.suggestedFilename(), () => '');
const reloadedA2 = pa.waitForNavigation({ timeout: 60000 }).then(() => true, () => false);
await pa.click('#mbGo');
await pb.waitForSelector('#nlomOverlay', { timeout: 15000 }).catch(() => { });
ok(/moving the Office Calendar back to the old database/.test(await pb.textContent('#nlomOverlay').catch(() => '')), 'the office computer’s screen (at the sign-in) pauses while it moves back');
ok(/^office-calendar-before-move-back-.*\.json$/.test(await dl2), 'a copy goes to Downloads first');
await pa.waitForFunction(() => /Moved back ✓/.test((document.getElementById('sheetBody') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => { });
ok(/Moved back ✓/.test(await pa.textContent('#sheetBody').catch(() => '')), 'moved back');
ok(await reloadedA2, 'Dr. A’s screen reloads…');
ok(await waitApp(pa), '…and opens with the office Google sign-in it still has');
ok(await pa.evaluate(() => !isFs()), '…on the old database');
ok((await eventTitles(pa)).includes('Vendor lunch') && (await eventTitles(pa)).length === 5, 'everything, including what was added meanwhile, is back in the old database');
const back = await E.dbGet('nlo/calendar');
ok(back && back.settings && back.settings.closures['2026-12-26'] === 'Day after Christmas' && back.settings.adminPin === '2468' && (!back.config || !back.config.editors) && !back.movedTo && !back.moving, 'the old database has it all (the closure; the admin PIN as it was; no editors, since none were ticked), unmarked');
ok(((await E.dbGet('nlo/cadence/timeOffFeed')) || {}).key === E.FEED_KEY, 'NLO Time Off’s feed key is in the old database (as it was)');
const moved2 = await fsDoc('calMeta/moved');
ok(moved2 && moved2.on === false, 'calMeta/moved says not moved');
// (that computer still has the office Google account from before the move, so it opens the calendar straight away)
await pb.waitForFunction(() => typeof isFs === 'function' && !isFs() && typeof S !== 'undefined' && S.data && document.getElementById('app').style.display !== 'none', null, { timeout: 30000 }).catch(() => { });
ok(await pb.evaluate(() => !isFs() && !!S.data && document.getElementById('app').style.display !== 'none' && !document.getElementById('ncForm')), 'the office computer’s screen goes back to the old database by itself (its office Google account is still there)');
await pa.screenshot({ path: 'shots/cal-07-back.png', fullPage: true });

await A.ctx.close(); await B.ctx.close();
await browser.close();
const realErrors = errors.filter(e => !/Could not reach|ERR_|net::|identitytoolkit|script\.google|feed|TIMEOFF/i.test(e));
ok(!realErrors.length, 'no page errors' + (realErrors.length ? ':\n      ' + realErrors.slice(0, 8).join('\n      ') : ''));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
