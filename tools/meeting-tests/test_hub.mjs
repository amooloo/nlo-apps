// End-to-end: the Staff Meeting Hub before the move (office Google account, old database), Dr. A's move onto the NLO Cases
// system, and after it (NLO Cases logins, no Google step). Emulators only; a made-up office. README.md.
// node test_hub.mjs [--quick]
import fs from 'node:fs';
import * as E from './seed.mjs';
import { WIRE } from './wire.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.MTG_BASE || 'http://127.0.0.1:8766/';
const HUB = BASE + 'staff-meeting.html', ME = BASE + 'month-end.html';
const SDK = new URL('./node_modules/firebase/', import.meta.url).pathname;
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
const QUICK = process.argv.includes('--quick');
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
    const m = /gstatic\.com\/firebasejs\/10\.12\.\d+\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(tag + ': ' + String(e && e.stack || e)); console.log('  PAGEERROR', tag, String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED|identitytoolkit/.test(m.text())) { errors.push(tag + ': ' + m.text()); console.log('  console.error', tag, m.text().slice(0, 300)); } });
  return { ctx, page };
}
/* the office Google account on this browser (the emulator takes a made-up Google token) */
async function google(p, email) {
  await p.evaluate(async email => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name: email.split('@')[0] }));
    await firebase.auth().signInWithCredential(cred);
  }, email);
}
const appOpen = p => p.evaluate(() => !document.getElementById('app').hidden && document.getElementById('gate').hidden);
async function waitApp(p, ms = 30000) { try { await p.waitForFunction(() => !document.getElementById('app').hidden && document.getElementById('gate').hidden, null, { timeout: ms }); return true; } catch { return false; } }
async function fsSignIn(p, user, pw) {
  await p.waitForSelector('#ncForm', { timeout: 20000 });
  await p.fill('#ncUser', user); await p.fill('#ncPw', pw); await p.click('#ncGo');
  await p.waitForFunction(() => (!document.getElementById('app').hidden) || (document.getElementById('gateErr') && document.getElementById('gateErr').textContent.trim() && !document.querySelector('#ncGo[disabled]')), null, { timeout: 30000 });
  return (await appOpen(p)) ? 'app' : await p.textContent('#gateErr');
}
const inboxTexts = p => p.evaluate(() => Object.values(S.inbox || {}).map(x => x.text));
/* a Cadence screen: Cadence's "Staff meeting" add-on (its script and CSS, as in cadence.html) on a page where Gwen is
   signed in to Cadence with her NLO Cases login and no office Google account — what Cadence tells the add-on is faked */
const CAD = fs.readFileSync(new URL('../../cadence.html', import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) throw new Error('not in cadence.html: ' + a); const k = s.indexOf(b, i + a.length); return s.slice(i + a.length, k); };
const ADDON_JS = between(CAD, '<script id="nlo-meeting-addon">', '</script>'), ADDON_CSS = between(CAD, '<style id="nlo-meeting-addon-css">', '</style>');
async function cadenceScreen() {
  const C = await device('cadence');
  await C.page.goto(BASE + 'tools/meeting-tests/blank.html');
  await C.page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div class="staff-content" style="height:600px"></div>'); window.__nloCad = { me: 's_gwen', staff: [{ id: 's_gwen', name: 'Gwen Rodis', status: 'active' }], authed: false, cloud: true }; });
  await C.page.addStyleTag({ content: ADDON_CSS });
  await C.page.addScriptTag({ content: ADDON_JS });
  await C.page.evaluate(async pw => { await NLOM.signIn('gwen', pw); window.__nloCad.authed = true; window.dispatchEvent(new Event('nlo-cadence-user')); }, E.PW);
  return C;
}
const fabShown = p => p.evaluate(() => { const f = document.querySelector('.nlo-mtg-fab'); return !!(f && f.classList.contains('show')); });

console.log('0. the office, the Hub as it is today');
await E.loadRules();          // NLO Cases rules with the Hub's block; Staff Hub's
await E.seedOffice();
await E.loadRtdbRules();
await E.seedHub();

// ---------- 1. before the move ----------
console.log('1. before the move');
const A = await device('drA');
let pa = A.page;
await pa.goto(HUB);
await pa.waitForSelector('#gate .gbtn:not([hidden])', { timeout: 20000 });
ok(/office Google account/.test(await pa.textContent('#gate')), 'before the move: the office Google sign-in, as today');
await google(pa, 'akhavan.ak@gmail.com');
ok(await waitApp(pa), 'Dr. A’s Google account opens the Hub');
await pa.waitForFunction(() => Object.keys(S.inbox || {}).length >= 3, null, { timeout: 15000 }).catch(() => { });
ok((await inboxTexts(pa)).includes('Chart notes are piling up on Thursdays'), 'the Hub’s data from the old database');
await pa.evaluate(() => settingsSheet());
ok(await pa.isVisible('#mvOpen'), 'Settings: Dr. A sees “Move to the NLO Cases system”');
await pa.screenshot({ path: 'shots/01-settings-move.png', fullPage: true });
await pa.evaluate(() => closeSheet());
// a second computer, staff on the office account, Hub open
const B = await device('office');
const pb = B.page;
await pb.goto(HUB);
await pb.waitForSelector('#gate .gbtn:not([hidden])', { timeout: 20000 });
await google(pb, 'records@thenextlevelorthodontics.com');
ok(await waitApp(pb), 'the office account opens the Hub on another computer');
await pb.evaluate(() => settingsSheet());
ok(!(await pb.isVisible('#mvOpen')), '…and doesn’t see the move');
await pb.evaluate(() => closeSheet());
// Month-End before the move: as today
{
  const M0 = await device('monthEnd0');
  await M0.page.goto(ME + '#2026-09');
  await M0.page.waitForSelector('#gate .gbtn:not([hidden])', { timeout: 20000 });
  ok(/office Google account/.test(await M0.page.textContent('#gate')), 'Month-End before the move: the office Google sign-in, as today');
  await google(M0.page, 'records@thenextlevelorthodontics.com');
  await M0.page.waitForFunction(() => window.MEH && MEH.S.loaded && MEH.S.months['2026-09'], null, { timeout: 20000 }).catch(() => { });
  ok(await M0.page.evaluate(() => MEH.S.months['2026-09'].np === 14 && !isFs()), '…its numbers from the old database');
  await M0.ctx.close();
}
// a Cadence screen open all day: Gwen on her NLO Cases login, no office Google account on that computer
const CS = await cadenceScreen();
const pc = CS.page;
await sleep(2500);
ok(!(await fabShown(pc)), 'Cadence (NLO Cases login, no Google): no “Staff meeting” button before the move, as today');

// ---------- 2. the move ----------
console.log('2. the move');
await E.loadOlderCasesRules();
await pa.evaluate(() => { settingsSheet(); });
await pa.click('#mvOpen');
await pa.waitForSelector('#mvForm');
await pa.fill('#mvUser', 'gwen'); await pa.fill('#mvPw', E.PW); await pa.click('#mvGo');
await pa.waitForSelector('#mvForm .hint[style*="coral"]', { timeout: 15000 }).catch(() => { });
ok(/Only Dr\. A’s NLO Cases login/.test(await pa.textContent('#mvBody')), 'a staff NLO Cases login can’t move it');
await pa.fill('#mvUser', E.OWNER.email); await pa.fill('#mvPw', E.PW); await pa.click('#mvGo');
await pa.waitForSelector('#mvCopy', { timeout: 20000 }).catch(() => { });
ok(await pa.isVisible('#mvCopy'), 'older rules: asks to publish the updated rules first');
await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
await pa.click('#mvCopy');
await pa.waitForFunction(() => /Copied|Couldn’t/.test(document.getElementById('mvCopied').textContent), null, { timeout: 10000 }).catch(() => { });
const clip = await pa.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok(/rules_mtg_1/.test(clip) && /akhavan\.ak@gmail\.com/.test(clip) && !/__OWNER_EMAIL__/.test(clip), 'Copy the new rules: the whole file, with Dr. A’s email filled in');
await pa.click('#mvCheck');
await pa.waitForFunction(() => /Not yet/.test((document.getElementById('mvRulesMsg') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => { });
ok(/Not yet/.test(await pa.textContent('#mvBody')), 'Check again before publishing: “Not yet”');
await E.loadRules();
await pa.click('#mvCheck');
await pa.waitForSelector('#mvNow', { timeout: 20000 });
const what = await pa.textContent('#mvBody');
ok(/Inbox items: 3/.test(what) && /Action items: 3/.test(what) && /Meetings: 2/.test(what) && /Month-End months: 1/.test(what), 'after publishing: what moves, counted');
await pa.screenshot({ path: 'shots/02-move.png' });
const [dl] = await Promise.all([pa.waitForEvent('download', { timeout: 30000 }), pa.click('#mvNow')]);
const copyFile = 'shots/before-move.json'; await dl.saveAs(copyFile);
const copy = JSON.parse(fs.readFileSync(copyFile, 'utf8'));
ok(copy.data && copy.data['nlo/staffMeeting/inbox'] && Object.keys(copy.data['nlo/staffMeeting/inbox']).length === 3, 'a copy of everything goes to Downloads first');
await pa.waitForFunction(() => /Switched over|Stopped/.test(document.getElementById('mvBody') ? document.getElementById('mvBody').textContent : ''), null, { timeout: 60000 }).catch(() => { });
ok(/Switched over/.test(await pa.textContent('#mvBody').catch(() => '')), 'moved and switched over');
const moved = await E.fsGet('nlo-cases', 'mtgMeta/moved');
ok(moved && moved.on === true, 'the NLO Cases database says the Hub has moved');
ok((await E.fsList('nlo-cases', 'mtgInbox')).length === 3 && (await E.fsList('nlo-cases', 'mtgMeetings')).length === 2 && (await E.fsList('nlo-cases', 'mtgTexts')).length === 1, 'its records: 3 inbox items, 2 meetings, 1 transcript');
const oldAfter = await E.dbGet('nlo/staffMeeting');
ok(oldAfter && oldAfter.inbox && Object.keys(oldAfter.inbox).length === 3 && oldAfter.movedTo && oldAfter.movedTo.to === 'nlo-cases', 'the old database keeps its copy, marked moved');

// ---------- 3. after the move ----------
console.log('3. after the move');
await pa.waitForSelector('#ncForm', { timeout: 20000 });
ok(/NLO Cases username and password/.test(await pa.textContent('#gate')) && !(await pa.isVisible('#gate .gbtn[data-act="sign-in"]')), 'Dr. A’s computer: the NLO Cases sign-in, no Google button');
await pb.waitForSelector('#ncForm', { timeout: 20000 }).catch(() => { });
ok(await pb.isVisible('#ncForm'), 'the other computer switched over by itself (NLO Cases sign-in)');
await pc.waitForFunction(() => { const f = document.querySelector('.nlo-mtg-fab'); return f && f.classList.contains('show'); }, null, { timeout: 20000 }).catch(() => { });
ok(await fabShown(pc) && /Staff meeting\s*1/.test(await pc.textContent('.nlo-mtg-fab')), 'the Cadence screen left open gets its “Staff meeting” button by itself (Gwen’s 1 to-do)');
ok((await fsSignIn(pb, 'gone', E.PW)) !== 'app' && /turned off/.test(await pb.textContent('#gateErr')), 'a turned-off login is refused');
ok((await fsSignIn(pb, 'newbie', E.PW)) !== 'app' && /Finish setting up/.test(await pb.textContent('#gateErr')), 'a login still on its temporary password: finish in NLO Cases first');
ok((await fsSignIn(pb, 'gwen', 'wrong-pw')) !== 'app' && /incorrect/.test(await pb.textContent('#gateErr')), 'wrong password');
ok(await fsSignIn(pb, 'gwen', E.PW) === 'app', 'Gwen signs in with her NLO Cases login');
await pb.waitForFunction(() => Object.keys(S.inbox || {}).length >= 3, null, { timeout: 15000 }).catch(() => { });
ok((await inboxTexts(pb)).length === 3, 'the same 3 inbox items');
ok(await pb.evaluate(() => S.userName === 'Gwen Rodis' && currentAuthor() && currentAuthor().id === 's_gwen'), 'notes are in her name (her login is linked to her Staff Hub person)');
ok(!(await pb.isVisible('[data-act="cap-author"]')), 'no “change who’s typing”');
await pb.evaluate(() => settingsSheet());
ok(!(await pb.isVisible('#mvBack')) && !(await pb.isVisible('#mvOpen')) && /Gwen Rodis/.test(await pb.textContent('#sheet')), 'her Settings: signed in as her, no Move back');
await pb.evaluate(() => closeSheet());
await pb.fill('#capText', 'The sterilizer is making a noise');
await pb.click('[data-act="cap-add"]');
let gnote = null;
for (let i = 0; i < 40 && !gnote; i++) { const l = await E.fsList('nlo-cases', 'mtgInbox'); gnote = l.find(d => d.data.text === 'The sterilizer is making a noise'); if (!gnote) await sleep(250); }
ok(gnote && gnote.data.personId === 's_gwen' && gnote.data._by === 'gwen', 'her note is saved in her name, stamped with her NLO Cases id');
await pb.screenshot({ path: 'shots/03-gwen.png' });
ok(await fsSignIn(pa, E.OWNER.email, E.PW) === 'app', 'Dr. A signs in');
await pa.waitForFunction(() => Object.values(S.inbox || {}).some(x => x.text === 'The sterilizer is making a noise'), null, { timeout: 15000 }).catch(() => { });
ok((await inboxTexts(pa)).includes('The sterilizer is making a noise'), '…and sees Gwen’s note at once');
ok(await pa.evaluate(() => S.isOwner && currentAuthor().id === 's_amir'), 'Dr. A is Dr. A');
await pa.evaluate(() => settingsSheet());
ok(await pa.isVisible('#mvBack') && !(await pa.isVisible('#mvOpen')), 'Settings: the data is on NLO Cases; “Move back” for Dr. A');
await pa.evaluate(() => closeSheet());
// Lock
await pb.click('[data-act="sign-out"]');
await pb.waitForSelector('#ncForm', { timeout: 20000 });
ok(/Locked/.test(await pb.textContent('#gate')) && (await pb.inputValue('#ncUser')) === 'gwen', 'Lock → the sign-in, “Locked”, username remembered');
ok(await pb.evaluate(() => !S.booted), 'nothing of the office’s left in memory (a fresh page)');

// ---------- 4. the agenda's numbers, the AI keys, running a meeting — on the NLO Cases system ----------
console.log('4. numbers, keys, a meeting');
{
  const auto = await pa.evaluate(async () => { S.auto = null; await loadAuto(true); return JSON.parse(JSON.stringify(S.auto || {})); });
  ok(auto.cadence && !auto.cadence.err, 'Cadence’s numbers come from Cadence’s own records' + (auto.cadence && auto.cadence.err ? ': ' + auto.cadence.err : ''));
  ok(auto.spend && !auto.spend.err && auto.spend.budget === 8500, 'supply spending comes from Inventory’s own records (its $8,500 budget)' + (auto.spend && auto.spend.err ? ': ' + auto.spend.err : ''));
  ok(await pa.evaluate(() => geminiKey().then(k => k, e => 'ERR ' + e.message)) === 'AIzaFAKE-gemini-key-0123456789', 'the office AI key (Inventory’s AI settings) is read');
  ok(await pa.evaluate(() => loadSharedAisa()) === 'aisa-shared-key-1', 'the shared AISA key moved');
  await pa.click('.tabbtn[data-tab="run"]');
  await pa.waitForSelector('#runStart', { timeout: 10000 });
  await pa.click('#runStart');
  const mid = await pa.evaluate(() => S.meetingId);
  let run = null;
  for (let i = 0; i < 60 && !(run && run.live); i++) { const m = await E.fsGet('nlo-cases', 'mtgMeetings/' + mid); run = m && m.run; if (!(run && run.live)) await sleep(250); }
  ok(run && run.live === true && Array.isArray(run.queue) && run.attendance && run.attendance.s_gwen === true, 'Start the meeting: saved (the queue, who’s here)');
  const snapDoc = await E.fsGet('nlo-cases', 'mtgMeetings/' + mid);
  ok(snapDoc && snapDoc.snapshot && snapDoc.meta.status === 'live', '…with the numbers it started with');
  await pa.screenshot({ path: 'shots/04-run.png' });
  const next = await pa.evaluate(() => { const d = new Date(Date.now() + 35 * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await pa.evaluate(n => endMeeting(n), next);
  let cur = null;
  for (let i = 0; i < 40 && cur !== next; i++) { const c = await E.fsGet('nlo-cases', 'mtgState/current'); cur = c && c.id; if (cur !== next) await sleep(250); }
  const ended = await E.fsGet('nlo-cases', 'mtgMeetings/' + mid);
  ok(cur === next && ended.meta.status === 'done' && ended.minutes && /Staff meeting/.test(ended.minutes.text), 'End the meeting: minutes saved, the next meeting set');
  await pa.evaluate(() => closeSheet());
  ok(await pa.evaluate(() => S.meetingId) === next, 'the Hub moves on to the next meeting');
}

// ---------- 5. Month-End on the NLO Cases system ----------
console.log('5. Month-End');
{
  const C = await device('monthEnd');
  const pm = C.page;
  await pm.goto(ME + '#2026-10');
  await pm.waitForSelector('#ncForm', { timeout: 20000 });
  ok(/NLO Cases username and password/.test(await pm.textContent('#gate')), 'Month-End: the NLO Cases sign-in');
  ok(await fsSignIn(pm, 'gwen', E.PW) === 'app', 'Gwen signs in to Month-End');
  await pm.waitForFunction(() => window.MEH && MEH.S.loaded, null, { timeout: 15000 }).catch(() => { });
  ok(await pm.evaluate(() => !!(MEH.S.months['2026-09'] && MEH.S.months['2026-09'].np === 14)), 'September’s numbers moved');
  ok(await pm.evaluate(() => author() && author().id === 's_gwen'), 'numbers are entered in her name');
  const box = 'input[data-f="tcs/s_sarah/np"]';
  await pm.waitForSelector(box, { timeout: 15000 });
  await pm.fill(box, '7'); await pm.press(box, 'Tab');
  const got = o => !!(o && o.tcs && o.tcs.s_sarah && o.tcs.s_sarah.np === 7 && o.totals && o.totals.np_total === 7);
  let oct = null;
  for (let i = 0; i < 40 && !got(oct); i++) { oct = await E.fsGet('nlo-cases', 'meMonths/2026-10'); if (!got(oct)) await sleep(250); }
  ok(oct && oct.tcs && oct.tcs.s_sarah && oct.tcs.s_sarah.np === 7 && oct._by === 'gwen' && oct.by && oct.by.np && oct.by.np.id === 's_gwen', 'October’s new patients typed in: saved in her name, stamped with her NLO Cases id');
  ok(got(oct), '…and its totals follow (the Hub reads those)');
  await pa.waitForFunction(() => S.me && S.me.months && S.me.months['2026-10'] && S.me.months['2026-10'].totals && S.me.months['2026-10'].totals.np_total === 7, null, { timeout: 15000 }).catch(() => { });
  ok(await pa.evaluate(() => !!(S.me.months['2026-10'] && S.me.months['2026-10'].totals && S.me.months['2026-10'].totals.np_total === 7)), 'the Hub sees it at once');
  await pm.screenshot({ path: 'shots/05-month-end.png' });
  await C.ctx.close();
}

// ---------- 5b. Cadence's Staff meeting button ----------
console.log('5b. Cadence’s Staff meeting button');
{
  await pc.click('.nlo-mtg-fab');
  await pc.waitForSelector('.nm-chk[data-nm="done"][data-id="-Nq0act0000000000003"]', { timeout: 10000 });
  ok(/Restock the bonding trays/.test(await pc.textContent('#nmList')), 'her to-do from the last meeting');
  await pc.click('.nm-chk[data-nm="done"][data-id="-Nq0act0000000000003"]');
  let a3 = null;
  for (let i = 0; i < 40 && !(a3 && a3.status === 'done'); i++) { a3 = await E.fsGet('nlo-cases', 'mtgActions/-Nq0act0000000000003'); if (!(a3 && a3.status === 'done')) await sleep(250); }
  ok(a3 && a3.status === 'done' && a3.doneVia === 'cadence' && a3.doneById === 's_gwen' && a3._by === 'gwen', 'ticked off in Cadence: done, stamped with her NLO Cases id');
  await pa.waitForFunction(() => S.actions['-Nq0act0000000000003'] && S.actions['-Nq0act0000000000003'].status === 'done', null, { timeout: 15000 }).catch(() => { });
  ok(await pa.evaluate(() => S.actions['-Nq0act0000000000003'] && S.actions['-Nq0act0000000000003'].status === 'done'), 'the Hub sees it done');
  await pc.click('.nm-chk[data-nm="undo"][data-id="-Nq0act0000000000003"]');
  for (let i = 0; i < 40 && !(a3 && a3.status === 'open'); i++) { a3 = await E.fsGet('nlo-cases', 'mtgActions/-Nq0act0000000000003'); if (!(a3 && a3.status === 'open')) await sleep(250); }
  ok(a3 && a3.status === 'open' && a3.completedAt == null && a3.doneVia == null, 'undo: open again');
  await pc.fill('#nmText', 'The autoclave door sticks');
  await pc.click('[data-nm="add"]');
  let raised = null;
  for (let i = 0; i < 40 && !raised; i++) { const l = await E.fsList('nlo-cases', 'mtgInbox'); raised = l.find(d => d.data.text === 'The autoclave door sticks'); if (!raised) await sleep(250); }
  // (_by is the last writer: an open Hub files a new item under a category at once, stamped with its own login)
  ok(raised && raised.data.via === 'cadence' && raised.data.personId === 's_gwen' && ['gwen', 'amir'].includes(raised.data._by), 'raised from Cadence: on the Hub’s list in her name');
  await pa.waitForFunction(() => Object.values(S.inbox || {}).some(x => x.text === 'The autoclave door sticks'), null, { timeout: 15000 }).catch(() => { });
  ok((await inboxTexts(pa)).includes('The autoclave door sticks'), 'the Hub sees it at once');
  await pc.screenshot({ path: 'shots/06-cadence.png' });
  await pc.click('[data-nm="close"]');
}

// ---------- 6. turned off while open ----------
console.log('6. turned off while open');
{
  ok(await fsSignIn(pb, 'gwen', E.PW) === 'app', 'Gwen signs in again');
  await E.fsSet('nlo-cases', 'members/' + E.STAFF[0].uid, { active: false }, ['active']);
  await pb.waitForSelector('#ncForm', { timeout: 20000 }).catch(() => { });
  ok(/access changed/.test(await pb.textContent('#gate').catch(() => '')), 'her login turned off in NLO Cases → locked out at once');
  await E.fsSet('nlo-cases', 'members/' + E.STAFF[0].uid, { active: true }, ['active']);
}

// ---------- 7. idle lock ----------
if (!QUICK) {
  console.log('7. idle lock (about 1.5 min)');
  await E.fsSet('nlo-cases', 'meta/settings', { idleMin: 1 }, ['idleMin']);
  ok(await fsSignIn(pb, 'gwen', E.PW) === 'app', 'signed in with NLO Cases’ idle time at 1 minute');
  await pb.waitForSelector('#ncForm', { timeout: 120000 }).catch(() => { });
  ok(/Locked after 1 minute without activity/.test(await pb.textContent('#gate').catch(() => '')), 'locks after NLO Cases’ idle minutes');
  await E.fsSet('nlo-cases', 'meta/settings', { idleMin: 10 }, ['idleMin']);
}

// ---------- 8. moving back (only if something's wrong) ----------
console.log('8. moving back');
{
  ok(await appOpen(pa) || (await fsSignIn(pa, E.OWNER.email, E.PW)) === 'app', 'Dr. A signed in (again, if the idle lock locked his screen too)');
  await pa.evaluate(() => firebase.auth().signOut());   // no office Google sign-in on this computer now
  await pa.evaluate(() => settingsSheet());
  await pa.click('#mvBack');
  await pa.waitForSelector('#mbGo');
  ok(await pa.isDisabled('#mbGo') && await pa.isVisible('#mbG'), 'moving back needs the office Google sign-in on this computer');
  await google(pa, 'akhavan.ak@gmail.com');
  await pa.evaluate(() => { closeSheet(); moveBackSheet(); });
  await pa.waitForSelector('#mbGo:not([disabled])');
  await pa.click('#mbGo');
  ok(/Tick “Yes, move it back” first/.test(await pa.textContent('#mbBody')), 'needs the “Yes, move it back” tick');
  await pa.check('#mbOk');
  const curMid = await pa.evaluate(() => S.meetingId);
  const [dl2] = await Promise.all([pa.waitForEvent('download', { timeout: 30000 }), pa.click('#mbGo')]);
  ok(!!dl2, 'a copy goes to Downloads first');
  await pa.waitForFunction(() => /Moved back|Stopped/.test((document.getElementById('mbBody') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => { });
  ok(/Moved back/.test(await pa.textContent('#mbBody').catch(() => '')), 'moved back');
  const back = await E.dbGet('nlo/staffMeeting');
  ok(back && Object.values(back.inbox || {}).some(x => x.text === 'The sterilizer is making a noise') && back.monthEnd.months['2026-10'].tcs.s_sarah.np === 7 && back.meetings[curMid] && !back.movedTo, 'the old database has everything done since the move (Gwen’s note, October’s numbers, the new meeting)');
  ok(!JSON.stringify(back).includes('"_by"') && !JSON.stringify(back).includes('"_up"'), '…without the NLO Cases stamps');
  ok((await E.fsGet('nlo-cases', 'mtgMeta/moved')).on === false, 'the NLO Cases database says it moved back');
  await pa.waitForFunction(() => typeof MODE !== 'undefined' && MODE === 'rtdb', null, { timeout: 20000 }).catch(() => { });
  ok(await waitApp(pa) && await pa.evaluate(() => MODE === 'rtdb' && !isFs()), 'this screen reloads onto the old database with Dr. A’s Google sign-in');
  await pa.waitForFunction(() => Object.values(S.inbox || {}).some(x => x.text === 'The sterilizer is making a noise'), null, { timeout: 15000 }).catch(() => { });
  ok(await pa.evaluate(() => Object.values(S.inbox || {}).some(x => x.text === 'The sterilizer is making a noise') && Object.values(S.inbox || {}).some(x => x.text === 'The autoclave door sticks')), '…and shows what was done on the NLO Cases system');
  await pb.waitForFunction(() => typeof MODE !== 'undefined' && MODE === 'rtdb', null, { timeout: 20000 }).catch(() => { });
  ok(await pb.evaluate(() => MODE === 'rtdb') && await waitApp(pb), 'the other computer (at the NLO Cases sign-in) goes back by itself: the office Google account it still has opens the Hub');
  await pc.waitForFunction(() => { const f = document.querySelector('.nlo-mtg-fab'); return f && !f.classList.contains('show'); }, null, { timeout: 15000 }).catch(() => { });
  ok(!(await fabShown(pc)), 'the Cadence screen (no Google there) puts its button away rather than keep using the NLO Cases copy');
}

await browser.close();
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
