// End-to-end checks of Cadence moving its data onto the NLO Cases system (Firestore), on the Firebase emulators. Made-up
// office, nothing live. See README.md.   NO_PROXY=localhost,127.0.0.1 node test_move.mjs
//   - before the new rules are published: Cadence on its old database as before; the Move page asks for the rules
//   - the move itself, with other screens open (one on the page as published before this change), and what it leaves
//   - after it: a device with no Google connection, two phones ticking one list, Lock, Dr. A's mirrors and edits, two
//     devices rolling the day, NLO Time Off's feed, the Staff Meeting copy; then moving back, and moving again
//   - what the review found: a page from before saving during the move, saves still waiting when the next person signs in,
//     a pause left behind, a clock a day behind, older rules published again after the move
process.env.TZ = 'America/New_York'; // the office's day (the rules refuse a day ahead of it)
const { chromium } = await import('playwright').catch(() => import('/opt/npm-tools/node_modules/playwright/index.mjs'));
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { j, seedCases, seedCadence, dbGet, dbPut, dbPatch, CAD_STAFF, PW } from './seed.mjs';

const BASE = process.env.CADENCE_URL || 'http://127.0.0.1:8765/cadence.html';
const OLD = process.env.CADENCE_OLD_URL || 'http://127.0.0.1:8765/cadence-login.html'; // the page as published before (eac0d28)
const MEET = process.env.MEETING_URL || 'http://127.0.0.1:8765/staff-meeting.html';
const SDK = process.env.FIREBASE_SDK_DIR || new URL('./node_modules/firebase/', import.meta.url).pathname;
const FSU = 'http://127.0.0.1:8080', DBU = 'http://127.0.0.1:9000', NS = 'nlo-inventory-default-rtdb';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
const DOCS = `${FSU}/v1/projects/nlo-cases/databases/(default)/documents`;
const REPO = new URL('../../', import.meta.url).pathname;
let pass = 0, fail = 0; const fails = [];
function ok(cond, what) { if (cond) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000, step = 250) { const end = Date.now() + ms; for (; ;) { try { const v = await fn(); if (v) return v; } catch (e) { } if (Date.now() > end) return null; await sleep(step); } }

// ---------- dates, the made-up office ----------
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = ymd(new Date()), YDAY = addDays(TODAY, -1);
const quarterOf = s => { const d = new Date(s + 'T00:00:00'); return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1); };
const officeDay = n => { let d = addDays(TODAY, n); for (; ;) { const w = new Date(d + 'T12:00:00').getDay(); if (w >= 1 && w <= 4) return d; d = addDays(d, 1); } };
const arrOf = x => Array.isArray(x) ? x.filter(v => v != null) : x && typeof x === 'object' ? Object.values(x).filter(v => v != null) : [];
const NAMES = Object.fromEntries(CAD_STAFF.map(([id, name]) => [id, name]));
const short = id => { const p = NAMES[id].split(' '); return p[0] + ' ' + p[p.length - 1][0] + '.'; };

// ---------- the rules: as live before (eac0d28) and with Cadence's block ----------
const RULES_NEW = fs.readFileSync(REPO + 'nlo-cases-src/firestore.rules', 'utf8');
let RULES_OLD;
try { RULES_OLD = execFileSync('git', ['show', 'eac0d28:nlo-cases-src/firestore.rules'], { cwd: REPO, encoding: 'utf8' }); }
catch { RULES_OLD = RULES_NEW.replace(/\n    \/\/ =+\n    \/\/ CADANCe[\s\S]*?match \/meta\/rules_cad_1 \{[\s\S]*?\}\n/, '\n'); }
if (RULES_OLD.includes('cadInst')) throw new Error('old rules still have Cadence');
async function rules(text) {
  await j(`${FSU}/emulator/v1/projects/nlo-cases:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: text.replace(/__OWNER_EMAIL__/g, 'akhavan.ak@gmail.com') }] } }) });
}

// ---------- Firestore through the emulator's back door ----------
function unfv(v) {
  if (!v || 'nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unfv);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, unfv(x)]));
  return v;
}
const fields = d => Object.fromEntries(Object.entries((d && d.fields) || {}).map(([k, x]) => [k, unfv(x)]));
function tofv(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(tofv) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tofv(x)])) } };
}
async function fsDoc(path) { const r = await fetch(`${DOCS}/${path}`, { headers: H }); if (r.status === 404) return null; if (!r.ok) throw new Error(path + ' ' + r.status); return fields(await r.json()); }
async function fsPut(path, obj) { return j(`${DOCS}/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: tofv(obj).mapValue.fields }) }); }
async function fsDel(path) { return j(`${DOCS}/${path}`, { method: 'DELETE', headers: H }); }
async function fsAll(coll) {
  const out = []; let tok = '';
  do {
    const r = await j(`${DOCS}/${coll}?pageSize=300` + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { headers: H });
    for (const d of r.documents || []) out.push(Object.assign({ _id: d.name.split('/').pop() }, fields(d)));
    tok = r.nextPageToken || '';
  } while (tok);
  return out;
}

// ---------- NLO Time Off's sealed feed (a made-up key and rows) ----------
const KEY = crypto.randomBytes(32), KEY_B64 = KEY.toString('base64');
let FEED = { ok: true, timeOff: [{ id: 'r1', employeeName: 'Eve Pavlova', start: officeDay(3), end: officeDay(3), hours: 'Full day' }], holidays: [] };
function sealed() {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  c.setAAD(Buffer.from('tofeed'));
  const ct = Buffer.concat([c.update(JSON.stringify(FEED), 'utf8'), c.final(), c.getAuthTag()]);
  return JSON.stringify({ fields: { iv: { stringValue: iv.toString('base64') }, ct: { stringValue: ct.toString('base64') } } });
}
let feedHits = 0;

// ---------- browsers ----------
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
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 }, acceptDownloads: true, timezoneId: 'America/New_York' }, opts));
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost') || u.startsWith('https://apis.google.com/') || u.startsWith('https://unpkg.com/material-components-web')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/10\.12\.0\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    if (u.startsWith('https://identitytoolkit.googleapis.com/')) return route.fulfill({ status: 404, body: '' });
    if (/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/nlo-cases\/databases\/(\(|%28)default(\)|%29)\/documents\/toFeed\/live/.test(u)) { feedHits++; return route.fulfill({ status: 200, contentType: 'application/json', body: sealed() }); }
    if (u.startsWith('https://script.google.com/')) { console.log('  (the old Time-Off app was asked)'); oldApp++; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"timeOff":[]}' }); }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => { errors.push(String(e && e.stack || e)); console.log('  PAGEERROR', String(e).slice(0, 300)); });
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource|ERR_BLOCKED/.test(m.text())) { errors.push(m.text()); console.log('  console.error', m.text().slice(0, 300)); } });
  return { ctx, page };
}
let oldApp = 0;
const hash = p => p.evaluate(() => location.hash);
async function waitHash(p, re, ms = 20000) { try { await p.waitForFunction(r => new RegExp(r).test(location.hash), re.source, { timeout: ms }); return true; } catch { return false; } }
async function connect(p, email = 'records@thenextlevelorthodontics.com') {
  await p.waitForFunction(() => window.firebase && firebase.apps && firebase.apps.some(a => a.name === '[DEFAULT]'), null, { timeout: 15000 });
  await p.evaluate(async em => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + em, email: em, email_verified: true, name: em }));
    await firebase.auth().signInWithCredential(cred);
  }, email);
}
async function signIn(p, user, pw = PW) {
  await p.waitForSelector('#nloUser', { timeout: 20000 });
  await p.fill('#nloUser', user); await p.fill('#nloPw', pw);
  await p.click('form button[type=submit]');
}
const mode = p => p.evaluate(() => window.__nloCad && window.__nloCad.mode).catch(() => null);
async function me(p) { try { await p.waitForFunction(() => window.__nloCad && window.__nloCad.me, null, { timeout: 3000 }); } catch { } return p.evaluate(() => window.__nloCad && window.__nloCad.me).catch(() => null); }
async function waitMode(p, m, ms = 20000) { return !!(await until(async () => (await mode(p)) === m, ms)); }
// open a list and tick its n-th item (0-based)
async function openList(p, id) { await me(p); await p.goto(BASE + '#/app/instance/' + id); await p.waitForSelector('.item-row', { timeout: 20000 }); } // (after the sign-in has landed: the address changes a moment before)
const checkedRows = p => p.$$eval('.item-row', rs => rs.map(r => r.classList.contains('item-row--checked')));
// a Google-connected device, signed in: the page (opened at url), after the sign-in landed
async function signedIn(user, { google = null, url = BASE, land = /#\/(app\/mine|admin\/dashboard)$/ } = {}) {
  const d = await device();
  await d.page.goto(url);
  if (google) await connect(d.page, google);
  await signIn(d.page, user);
  d.landed = await waitHash(d.page, land, 30000);
  return d;
}
const instOf = async (date, assignee) => (await fsAll('cadInst')).filter(x => x.date === date && (!assignee || x.assigneeId === assignee));

// ---------- setup: the office as it is before the move (Cadence on the old database) ----------
console.log('seeding');
await seedCases();
await rules(RULES_OLD);
await j(`${DBU}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: H, body: fs.readFileSync(new URL('./rtdb.rules.json', import.meta.url), 'utf8') });
await dbPut('nlo/cadence', null);
await dbPut('nlo/calendar/settings/closures', { [addDays(TODAY, 20)]: { reason: 'Closed (made up)' } });
await dbPut('nlo/cadence/timeOffFeed', { key: KEY_B64, at: Date.now(), by: 'akhavan.ak@gmail.com' });
{
  const { ctx, page } = await device();
  await page.goto(BASE);
  await connect(page);
  await until(async () => { const st = await dbGet('nlo/cadence/state'); return st && st.checklists; }, 15000);
  await ctx.close();
}
let ST = await dbGet('nlo/cadence/state');
await seedCadence(ST);
ST = await dbGet('nlo/cadence/state');
const CLS = arrOf(ST.checklists);
const DAILY = CLS.filter(c => c && !c.archived && c.schedule && c.schedule.kind !== 'event' && c.schedule.frequency === 'daily' && c.assignMode !== 'perPerson').slice(0, 5);
if (DAILY.length < 5) throw new Error('the starting state has fewer daily checklists than expected: ' + DAILY.length);
// two of them due today whatever the weekday (weekly, on today's weekday): the day's roll has lists to make
const WD = new Date(TODAY + 'T12:00:00').getDay();
DAILY.slice(3, 5).forEach(c => { c.schedule = Object.assign({}, c.schedule, { frequency: 'weekly', weekday: WD }); });
let seq = 0;
function mkInst(c, date, a, status, done, t) {
  seq++;
  return { id: 'inst_g' + t.toString(36) + seq.toString(36), checklistId: c.id, date, assigneeId: a,
    items: arrOf(c.items).map(it => ({ itemId: it.id, checked: done, claimedBy: null, doneBy: done ? short(a) : null, doneAt: done ? '9:1' + (seq % 10) + 'a' : null, subtasksDone: Object.fromEntries(arrOf(it.subtasks).map(s => [s.id, done])), photo: null })),
    status, certifiedBy: done ? a : null, certifiedAt: done ? '9:30a' : null, onTime: done ? true : null, inspection: null, triggeredAt: null };
}
{
  const who = ['s_gwen', 's_kaylee', 's_eve', 's_wila', 's_angelika'], inst = [], aud = [];
  for (let back = 60; back >= 1; back--) {
    const d = addDays(TODAY, -back), w = new Date(d + 'T12:00:00').getDay();
    if (w < 1 || w > 4) continue;
    DAILY.forEach((c, k) => {
      const a = who[(k + back) % who.length], done = (k + back) % 5 !== 0, t = Date.parse(d + 'T09:00:00') + k * 6e4;
      inst.push(mkInst(c, d, a, done ? 'certified' : 'in-progress', done, t));
      if (done) aud.push({ id: 'aud_' + (t + 18e5).toString(36) + '_' + seq.toString(36).padStart(4, '0'), tone: 'success', actor: NAMES[a], message: `<b>${NAMES[a]}</b> certified <b>${c.name}</b>`, detail: '9:30a · on time · ' + arrOf(c.items).length + '/' + arrOf(c.items).length, at: '9:30a' });
    });
  }
  DAILY.slice(0, 4).forEach((c, k) => inst.push(mkInst(c, TODAY, k < 3 ? 's_gwen' : 's_kaylee', 'pending', false, Date.now() - (4 - k) * 6e4)));
  ST.checklists = CLS; ST.instances = inst; ST.audit = aud.reverse();
  ST.timeOff = [{ id: 'to_m1', staffId: 's_eve', date: officeDay(7), scope: 'full' }, { id: 'to_m2', staffId: 's_kaylee', date: officeDay(9), scope: 'am' }];
  ST.today = TODAY; ST.currentQuarter = quarterOf(TODAY);
  await dbPut('nlo/cadence/state', ST);
}
const GW = ST.instances.filter(x => x.date === TODAY && x.assigneeId === 's_gwen').map(x => x.id); // Gwen's three lists today
const OLDEST = ST.instances[0];
fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });
process.chdir(new URL('./', import.meta.url).pathname);
console.log(`  (${ST.instances.length} lists over 60 days, ${ST.audit.length} log entries, today ${TODAY})`);

// ---------- 1. before the new rules: as before ----------
console.log('1. before the new rules are published');
const A = await signedIn('dr.owner@example.com', { google: 'akhavan.ak@gmail.com' });
ok(A.landed && /#\/admin\/dashboard$/.test(await hash(A.page)), 'Dr. A signs in as before (old database, his Google connection)');
ok(await waitMode(A.page, 'rtdb'), 'Cadence is on its old database (older rules refuse the move marker)');
await A.page.waitForSelector('.nlo-move-banner', { timeout: 10000 }).catch(() => { });
ok(await A.page.isVisible('.nlo-move-banner'), 'a banner on the admin pages: one step left');
ok(await A.page.isVisible('.admin-link:has-text("Move to NLO Cases")'), 'Admin → Move to NLO Cases in the menu');
await A.page.click('.nlo-move-banner button');
ok(await waitHash(A.page, /#\/admin\/move$/), 'the banner opens the Move page');
await A.page.waitForSelector('text=needs its updated rules first', { timeout: 15000 }).catch(() => { });
ok(await A.page.isVisible('text=needs its updated rules first'), 'the Move page asks for the new rules first');
ok(await A.page.isDisabled('button:has-text("Move it now")'), 'Move it now is off until they are live');
const rulesShown = await A.page.$eval('details textarea', t => t.value).catch(() => '');
ok(rulesShown.includes('match /cadInst/{id}') && rulesShown.includes('match /invItems/{id}') && rulesShown.includes("request.auth.token.email == 'dr.owner@example.com'"), 'the rules it gives are the whole shared file, with his sign-in email filled in');
ok(await A.page.isVisible('text=Lists (every day so far)') && (await A.page.textContent('.panel:has-text("2. Move it")')).includes(String(ST.instances.length)), 'it counts what it will move');
await A.page.screenshot({ path: 'shots/m01-move-page-rules.png', fullPage: true });
// staff on the old database, as before
const G = await signedIn('gwen', { google: 'records@thenextlevelorthodontics.com' });
ok(G.landed && (await mode(G.page)) === 'rtdb', 'Gwen signs in on a connected device (old database)');
await openList(G.page, GW[0]);
await G.page.click('.item-row:nth-child(1) .item-row__main');
ok(!!(await until(async () => { const i = arrOf((await dbGet('nlo/cadence/state/instances')) || []).find(x => x.id === GW[0]); return i && arrOf(i.items)[0].checked === true; })), 'a tick goes to the old database, as before');
await G.page.goto(BASE + '#/app/mine');
ok(!(await G.page.isVisible('.staff-content .picker__scoreboard')), 'no scoreboard on Mine before the move (it’s on the sign-in screen)');

// ---------- 2. the rules published, then the move ----------
console.log('2. the move');
await rules(RULES_NEW);
await A.page.click('button:has-text("Check again")');
await A.page.waitForSelector('text=The new rules are live.', { timeout: 15000 }).catch(() => { });
ok(await A.page.isVisible('text=The new rules are live.'), 'Check again: the new rules are live');
ok(!(await A.page.isDisabled('button:has-text("Move it now")')), 'Move it now is on');
const before0 = { amir: (arrOf((await dbGet('nlo/cadence/state')).staff).find(x => x && x.id === 's_amir') || {}).name };
// a Cadence page from before this version (it doesn't hear the pause) saves a tick while the move runs: nothing moves
{
  const idx = ST.instances.findIndex(x => x.date < TODAY && x.status === 'in-progress'); // (a list from before today no later check uses)
  const nAud = arrOf((await dbGet('nlo/cadence/state')).audit).length, oldEntry = 'aud_' + Date.now().toString(36) + '_oldp';
  const [d0] = await Promise.all([A.page.waitForEvent('download', { timeout: 30000 }).catch(() => null), A.page.click('button:has-text("Move it now")')]);
  if (d0) await dbPatch('nlo/cadence/state', { [`instances/${idx}/items/0/checked`]: true, [`instances/${idx}/items/0/doneBy`]: short(ST.instances[idx].assigneeId),
    [`audit/${nAud}`]: { id: oldEntry, tone: 'info', actor: 'Kaylee Doty', message: '<b>Kaylee Doty</b> ticked an item (on a page from before)', detail: '9:41a', at: '9:41a' } });
  await A.page.waitForSelector('text=saved something while this ran', { timeout: 60000 }).catch(() => { });
  ok(!!d0 && await A.page.isVisible('text=saved something while this ran'), 'a page from before saves a tick during the move: nothing moves, and it says why');
  const m0 = await fsDoc('cadMeta/moved'), o0 = await dbGet('nlo/cadence/state');
  ok(m0 && m0.on === false && m0.pause === false && (await dbGet('nlo/cadence/pause')) === null && (await dbGet('nlo/cadence/moved')) === null && arrOf(o0.staff).length === CAD_STAFF.length && o0.practiceName === ST.practiceName, '… Cadence stays on its old database, unpaused, its copy as it was');
  ok(!!(await until(async () => !(await G.page.isVisible('#nloOverlay')), 10000)) && (await mode(A.page)) === 'rtdb', '… and the screens carry on there');
  // Dr. A's screen took in what that page saved while it moved: his next change keeps it (the old database saves the log whole)
  const CX = CLS.find(c => c && !c.archived && !DAILY.some(d => d.id === c.id)) || CLS[CLS.length - 1]; // (one no later check uses)
  await A.page.goto(BASE + '#/admin/checklists/' + CX.id); await A.page.waitForSelector('.editor-meta input.input');
  await A.page.fill('.editor-meta input.input', CX.name + ' (edited)'); await A.page.click('button:has-text("Save checklist")');
  const kept = await until(async () => { const a = arrOf((await dbGet('nlo/cadence/state')).audit); return a.some(x => x && x.message === `<b>${before0.amir}</b> edited <b>${CX.name} (edited)</b>`) && a; });
  ok(!!kept && kept.some(x => x && x.id === oldEntry), '… and Dr. A’s next change keeps what the page from before saved meanwhile (its log entry too)');
  await A.page.goto(BASE + '#/admin/move'); await A.page.waitForSelector('button:has-text("Move it now"):not([disabled])', { timeout: 20000 }).catch(() => { });
}
// other screens open meanwhile: Gwen on Mine (this page), Kaylee on the page as published before, a sign-in screen
await G.page.goto(BASE + '#/app/mine'); await G.page.waitForSelector('.staff-content');
const K = await signedIn('kaylee', { google: 'records@thenextlevelorthodontics.com', url: OLD });
ok(K.landed, 'Kaylee signed in on the page as published before (old code)');
const P0 = await device(); await P0.page.goto(BASE); await connect(P0.page); await waitHash(P0.page, /#\/picker$/);
const K2 = await device(); await K2.page.goto(OLD); await connect(K2.page); await waitHash(K2.page, /#\/picker$/); // old code, at its sign-in
const before = { inst: ST.instances.length, aud: ST.audit.length };
let overlaySeen = false;
const watch = (async () => { for (let i = 0; i < 160 && !overlaySeen; i++) { overlaySeen = await G.page.isVisible('#nloOverlay:has-text("Dr. A is moving Cadence")').catch(() => false); await sleep(100); } })();
const [dl] = await Promise.all([A.page.waitForEvent('download', { timeout: 30000 }).catch(() => null), A.page.click('button:has-text("Move it now")')]);
ok(!!dl && /^cadence-before-the-move-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), 'it saves a copy to Downloads first (' + (dl && dl.suggestedFilename()) + ')');
if (dl) {
  const copy = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(copy.state && arrOf(copy.state.instances).length === before.inst && arrOf(copy.state.staff).length === CAD_STAFF.length, 'the copy is the whole old state');
  before.aud = arrOf(copy.state.audit).length; // (Staff Hub's names were applied on the old database meanwhile: one more log entry)
  before.amir = (arrOf(copy.state.staff).find(x => x.id === 's_amir') || {}).name;
}
await watch;
ok(overlaySeen, 'Gwen’s screen pauses while it moves');
const moved = await until(async () => { const m = await fsDoc('cadMeta/moved'); return m && m.on === true && m.pause === false && m; }, 60000);
ok(!!moved, 'the move marker says moved (and not paused)');
ok(await waitMode(A.page, 'fs', 30000), 'Dr. A’s screen opens again on the NLO Cases system');
ok(await waitHash(A.page, /#\/picker$/), '… at the sign-in');
ok(await waitHash(G.page, /#\/picker$/, 30000) && (await waitMode(G.page, 'fs')), 'Gwen’s screen starts over on the new system');
await G.page.waitForSelector('.nlo-signin [role=status]', { timeout: 10000 }).catch(() => { });
ok(/now runs on the NLO Cases system/.test(await G.page.textContent('.nlo-signin').catch(() => '')), '… and says why');
ok(await waitHash(P0.page, /#\/picker$/, 30000) && (await waitMode(P0.page, 'fs')), 'the open sign-in screen moves over too');
ok(!(await G.page.isVisible('.picker__scoreboard')), 'after the move the sign-in screen shows nothing of the office’s (no scoreboard)');
ok(await G.page.evaluate(() => localStorage.getItem('cadence:data:v1')) === null, 'and this browser no longer keeps a copy of Cadence');
await G.page.screenshot({ path: 'shots/m02-after-move-signin.png' });
// what's in the new database
const cfg = await fsDoc('cadState/config'), day = await fsDoc('cadState/day'), toff = await fsDoc('cadState/timeoff');
const insts = await fsAll('cadInst'), auds = await fsAll('cadAudit');
ok(cfg && arrOf(cfg.checklists).length === CLS.length && arrOf(cfg.staff).length === CAD_STAFF.length && cfg.practiceName === ST.practiceName && cfg.upBy === 'amir', 'the setup: every checklist and person, saved in Dr. A’s name');
ok(day && day.today === TODAY && day.currentQuarter === quarterOf(TODAY), 'the day and quarter');
ok(insts.length === before.inst, `every list (${insts.length}/${before.inst})`);
ok(auds.length === before.aud, `every log entry (${auds.length}/${before.aud})`);
const i0 = insts.find(x => x._id === GW[0]);
ok(i0 && i0.items && typeof i0.items === 'object' && !Array.isArray(i0.items) && Array.isArray(i0.itemOrder) && i0.itemOrder.length === Object.keys(i0.items).length && i0.items[i0.itemOrder[0]].checked === true, 'a list keeps its items by item id, in order, with Gwen’s tick from before');
const a0 = auds.find(x => x._id === ST.audit[0].id);
ok(a0 && a0.t0 === parseInt(ST.audit[0].id.split('_')[1], 36) && a0.by === 'amir', 'log entries keep when they happened');
ok(toff && toff.e && toff.e.to_m1 && toff.e.to_m2 && toff.e.to_m1.staffId === 's_eve', 'the out-of-office board');
ok(Object.keys(toff.e).some(k => /^tof_r1_/.test(k)), 'with NLO Time Off’s entries (the feed ran before the move)');
const ros = await fsDoc('cadMirror/roster'), clo = await fsDoc('cadMirror/closures'), tof = await fsDoc('cadMirror/tofeed');
ok(ros && arrOf(ros.people).length === CAD_STAFF.length + 1 && arrOf(ros.people).some(x => x.id === 's_bri' && x.end), 'Cadence’s copy of Staff Hub’s roster (who left included)');
ok(clo && arrOf(clo.days).join() === addDays(TODAY, 20), 'its copy of the office calendar’s closed days');
ok(tof && tof.key === KEY_B64, 'its copy of NLO Time Off’s feed key');
const info = await fsDoc('cadMeta/info');
ok(info && info.counts && info.counts.inst === before.inst && info.counts.audit === before.aud && info.movedBy === before.amir, 'what moved, and who moved it (' + (info && info.movedBy) + ')');
// what it left in the old database
const pre = await dbGet('nlo/cadence/premove'), oldSt = await dbGet('nlo/cadence/state');
ok(pre && arrOf(pre.staff).length === CAD_STAFF.length && pre.practiceName === ST.practiceName, 'the old staff list is set aside');
ok(oldSt && !oldSt.staff && oldSt.practiceName === 'Cadence has moved. Reload this page.' && arrOf(oldSt.instances).length === before.inst, 'the old copy: no staff list, a practice name that says it moved, the rest kept');
ok((await dbGet('nlo/cadence/moved') || {}).to === 'nlo-cases' && (await dbGet('nlo/cadence/pause')) === null, 'marked moved (and no longer paused)');
const fm = await dbGet('nlo/cadence/forMeeting'), fmMove = fm && fm.at;
ok(fm && typeof fm.at === 'number' && arrOf(fm.staff).length === CAD_STAFF.length && arrOf(fm.instances).every(x => x.date >= addDays(TODAY, -32)) && arrOf(fm.instances).length > 0, 'the Staff Meeting copy (the last month’s lists)');
// the page from before the move can't be used any more
await K.page.waitForTimeout(1500);
ok(!(await K.page.isVisible('.staff-shell')), 'the page from before: Kaylee’s screen empties (no staff list)');
await K.ctx.close();
await K2.page.waitForSelector('.auth__practice', { timeout: 15000 }).catch(() => { });
ok(/Cadence has moved\. Reload this page\./.test(await K2.page.textContent('.auth__practice').catch(() => '')), 'the page from before, at its sign-in: says to reload');
await signIn(K2.page, 'kaylee');
ok(!!(await K2.page.waitForSelector('.nlo-signin [role=alert]', { timeout: 20000 }).catch(() => null)) && /#\/picker$/.test(await hash(K2.page)), '… where nobody can sign in');
await K2.ctx.close();
// the Staff Meeting Hub reads Cadence's copy now
{
  const M = await device(); await M.page.goto(MEET); await connect(M.page, 'akhavan.ak@gmail.com');
  const r = await M.page.evaluate(async () => { const x = await readCadence(); return { n: x.length, staff: arrOf(x[0]).length, asOf: x[4] || 0, practice: computeCadence({ staff: arrOf(x[0]), checklists: arrOf(x[1]), instances: arrOf(x[2]), timeOff: arrOf(x[3]) }).practice }; }).catch(e => ({ err: String(e) }));
  ok(r.n === 5 && r.staff === CAD_STAFF.length && r.asOf > 0 && r.practice != null, 'the Staff Meeting Hub reads Cadence’s copy (' + JSON.stringify(r) + ')');
  ok(await M.page.evaluate(() => cadenceBlock({ practice: 80, top: [], most: [], asOf: Date.now() - 2 * 36e5 }).includes('As of')), '… and says how old its numbers are once they’re over an hour old');
  await M.ctx.close();
}

// ---------- 3. after the move: a device with no Google connection ----------
console.log('3. a staff device without Google');
const B = await device();
await B.page.goto(BASE);
ok(await waitHash(B.page, /#\/picker$/), 'a new device goes straight to signing in (no Google step)');
ok(!(await B.page.isVisible('text=Connect with Google')), 'no Connect with Google');
await signIn(B.page, 'gwen');
ok(await waitHash(B.page, /#\/app\/mine$/, 30000), 'Gwen signs in with just her NLO Cases login');
{ const w = await me(B.page), m = await mode(B.page); ok(w === 's_gwen' && m === 'fs', '… on the NLO Cases system (' + w + ', ' + m + ')'); }
await B.page.waitForSelector('.staff-content .picker__scoreboard', { timeout: 15000 }).catch(() => { });
ok(await B.page.isVisible('.staff-content .picker__scoreboard'), 'the team scoreboard is on Mine now');
ok(/Gwen Rodis/.test(await B.page.textContent('.staff-content .picker__scoreboard')), '… with the office’s people');
ok(new RegExp(DAILY[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(await B.page.textContent('.staff-content')), 'her lists for today');
await B.page.screenshot({ path: 'shots/m03-mine-fs.png', fullPage: true });
await openList(B.page, GW[1]);
await B.page.click('.item-row:nth-child(1) .item-row__main');
const t1 = await until(async () => { const d = await fsDoc('cadInst/' + GW[1]); const it = d && d.items && d.items[d.itemOrder[0]]; return it && it.checked === true && d; });
ok(!!t1 && t1.upBy === 'gwen' && /\d{4}-\d\d-\d\dT/.test(t1.up) && t1.status === 'in-progress' && t1.items[t1.itemOrder[0]].doneBy === short('s_gwen'), 'a tick is saved in the new database, in her name and the database’s time');
ok(Object.keys(t1.items).length === arrOf(DAILY[1].items).length, 'only that field changed (the other items are still there)');
ok(await B.page.evaluate(() => localStorage.getItem('cadence:data:v1')) === null, 'nothing of the office’s kept in this browser');

// ---------- 4. two phones ticking the same list ----------
console.log('4. two phones, one list');
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const C1 = await device(phone), C2 = await device(phone);
await Promise.all([C1, C2].map(async d => { await d.page.goto(BASE); await signIn(d.page, 'gwen'); await waitHash(d.page, /#\/app\/mine$/, 30000); }));
await Promise.all([openList(C1.page, GW[2]), openList(C2.page, GW[2])]);
await Promise.all([C1.page.click('.item-row:nth-child(2) .item-row__main'), C2.page.click('.item-row:nth-child(3) .item-row__main')]);
const both = await until(async () => { const d = await fsDoc('cadInst/' + GW[2]); return d && d.items[d.itemOrder[1]].checked && d.items[d.itemOrder[2]].checked && d; });
ok(!!both, 'both ticks are saved (neither undoes the other)');
ok(!!(await until(async () => { const a = await checkedRows(C1.page), b = await checkedRows(C2.page); return a[1] && a[2] && b[1] && b[2]; }, 10000)), 'both phones show both ticks');
await C1.page.click('.item-row:nth-child(2) .item-row__main');
ok(!!(await until(async () => { const d = await fsDoc('cadInst/' + GW[2]); return d && !d.items[d.itemOrder[1]].checked && d.items[d.itemOrder[2]].checked; })) && !!(await until(async () => { const b = await checkedRows(C2.page); return !b[1] && b[2]; }, 10000)), 'an untick on one phone shows on the other, the other tick stays');
await C1.page.screenshot({ path: 'shots/m04-phone-list.png' });

// ---------- 5. Lock ----------
console.log('5. Lock');
await B.page.goto(BASE + '#/app/mine'); await B.page.waitForSelector('.staff-rail');
await B.page.click('.staff-rail button:has-text("Lock")');
ok(await waitHash(B.page, /#\/picker$/), 'Lock → the sign-in');
ok(!!(await until(async () => (await B.page.evaluate(() => (window.__nloCad && window.__nloCad.staff || []).length)) === 0, 5000)), 'nothing of the office’s left on the screen');
ok(/Next Level Orthodontics/.test(await B.page.textContent('.auth__practice')), '… just the practice name');
await B.page.goto(BASE + '#/app/mine');
ok(await waitHash(B.page, /#\/picker$/), 'the staff screens need signing in again');
await C2.page.goto(BASE + '#/app/mine'); await C2.page.waitForSelector('.icon-btn.nlo-lock-btn', { timeout: 15000 }).catch(() => { });
await C2.page.click('.icon-btn.nlo-lock-btn').catch(() => { });
ok(await waitHash(C2.page, /#\/picker$/), 'a phone’s Lock button too');
// no internet: Gwen's tick waits; the next person signing in on that device waits for it
{
  const X = await device(); await X.page.goto(BASE); await signIn(X.page, 'gwen'); await waitHash(X.page, /#\/app\/mine$/, 30000);
  await openList(X.page, GW[0]);
  const k = (await checkedRows(X.page)).findIndex(v => !v);
  await X.ctx.setOffline(true);
  await X.page.click(`.item-row:nth-child(${k + 1}) .item-row__main`);
  await X.page.goto(BASE + '#/app/mine'); await X.page.waitForSelector('.staff-rail');
  X.page.once('dialog', dg => dg.accept()); // ("This device is offline… Lock anyway?")
  await X.page.click('.staff-rail button:has-text("Lock")'); await waitHash(X.page, /#\/picker$/);
  await signIn(X.page, 'kaylee');
  await X.page.waitForSelector('.nlo-signin [role=alert]', { timeout: 20000 }).catch(() => { });
  ok(/still being saved/.test(await X.page.textContent('.nlo-signin [role=alert]').catch(() => '')) && /#\/picker$/.test(await hash(X.page)), 'no internet, the last person’s tick not saved yet: the next sign-in waits (and says why)');
  await X.ctx.setOffline(false);
  ok(!!(await until(async () => { const d = await fsDoc('cadInst/' + GW[0]); return d && d.items[d.itemOrder[k]].checked === true && d.upBy === 'gwen'; }, 30000)), '… the internet back: it’s saved, in her name');
  await signIn(X.page, 'kaylee');
  ok(await waitHash(X.page, /#\/app\/mine$/, 30000) && (await me(X.page)) === 's_kaylee', '… then the next person signs in');
  await X.ctx.close();
}

// ---------- 5b. a move that didn't finish: its pause left behind ----------
console.log('5b. a pause left behind');
await fsPut('cadMeta/moved', { on: true, pause: true, at: new Date() });
const pauseNote = '.nlo-signin [role=status]:has-text("moving Cadence")';
await B.page.waitForSelector(pauseNote, { timeout: 15000 }).catch(() => { });
ok(await B.page.isVisible(pauseNote) && !(await B.page.isVisible('#nloOverlay')), 'the sign-in says Cadence is paused, without covering it');
await B.page.screenshot({ path: 'shots/m09-paused-signin.png' });
await signIn(B.page, 'gwen');
await B.page.waitForSelector('.nlo-signin [role=alert]', { timeout: 20000 }).catch(() => { });
ok(/moving Cadence/.test(await B.page.textContent('.nlo-signin [role=alert]').catch(() => '')) && /#\/picker$/.test(await hash(B.page)), 'staff can’t sign in meanwhile');
await signIn(A.page, 'dr.owner@example.com');
ok(await waitHash(A.page, /#\/admin\/move$/, 30000), 'Dr. A can: he lands on the Move page');
await A.page.waitForSelector('text=Cadence is paused for a move', { timeout: 15000 }).catch(() => { });
ok(!(await A.page.isVisible('#nloOverlay')) && await A.page.isVisible('text=Cadence is paused for a move') && !(await A.page.isVisible('button:has-text("let them carry on")')), '… which the pause doesn’t cover; a pause this fresh may be a move under way, so nothing ends it yet');
await A.page.goto(BASE + '#/admin/dashboard');
await A.page.waitForSelector('#nloOverlay .nlo-ov-btn', { timeout: 10000 }).catch(() => { });
ok(await A.page.isVisible('#nloOverlay .nlo-ov-btn'), 'elsewhere the pause covers his screen, with a way back to the Move page');
await A.page.screenshot({ path: 'shots/m10-paused-owner.png' });
await A.page.click('#nloOverlay .nlo-ov-btn');
ok(await waitHash(A.page, /#\/admin\/move$/), '… which opens it');
await fsPut('cadMeta/moved', { on: true, pause: true, at: new Date(Date.now() - 4 * 6e4) }); // (the move that paused them stopped 4 minutes ago)
await A.page.waitForSelector('button:has-text("let them carry on")', { timeout: 30000 }).catch(() => { });
ok(await A.page.isVisible('button:has-text("let them carry on")'), 'a pause minutes old: the Move page offers to end it');
await A.page.click('button:has-text("let them carry on")');
ok(!!(await until(async () => { const m = await fsDoc('cadMeta/moved'); return m && m.on === true && m.pause === false; })), 'let them carry on: the pause ends, and Cadence stays where it is');
ok(!!(await until(async () => !(await B.page.isVisible(pauseNote)), 10000)), '… and the sign-in stops saying it’s paused');
await A.page.click('.admin-nav button:has-text("Lock")'); await waitHash(A.page, /#\/picker$/);

// ---------- 6. Dr. A after the move: his Google connection keeps the copies up to date; his edits ----------
console.log('6. Dr. A after the move');
await signIn(A.page, 'dr.owner@example.com');
ok(await waitHash(A.page, /#\/admin\/dashboard$/, 30000), 'Dr. A signs in (new system)');
ok(!(await A.page.isVisible('.nlo-move-banner')) && await A.page.isVisible('.admin-link:has-text("Data on NLO Cases")'), 'no banner; the menu says Data on NLO Cases');
await dbPatch('nlo/cadence/roster/people/s_kaylee', { name: 'Kaylee Dotson', last: 'Dotson' });
ok(!!(await until(async () => { const r = await fsDoc('cadMirror/roster'); return r && arrOf(r.people).some(x => x.id === 's_kaylee' && x.name === 'Kaylee Dotson'); })), 'a rename in Staff Hub reaches Cadence’s copy of the roster');
ok(!!(await until(async () => { const c = await fsDoc('cadState/config'); return c && arrOf(c.staff).some(x => x.id === 's_kaylee' && x.name === 'Kaylee Dotson'); })), '… and Cadence’s staff list (Dr. A’s screen saves it)');
await dbPatch('nlo/calendar/settings/closures', { [addDays(TODAY, 30)]: { reason: 'Closed (made up)' } });
ok(!!(await until(async () => { const c = await fsDoc('cadMirror/closures'); return c && arrOf(c.days).includes(addDays(TODAY, 30)); })), 'a closed day added on the calendar reaches Cadence’s copy');
ok(!!(await until(async () => ((await dbGet('nlo/cadence/forMeeting')) || {}).at > fmMove || false, 20000)), 'his screen keeps the Staff Meeting copy up to date');
// a checklist renamed: saved, and the log says who
await A.page.goto(BASE + '#/admin/checklists/' + DAILY[0].id);
await A.page.waitForSelector('.editor-meta input.input');
await A.page.fill('.editor-meta input.input', DAILY[0].name + ' (renamed)');
await A.page.click('button:has-text("Save checklist")');
ok(!!(await until(async () => { const c = await fsDoc('cadState/config'); return c && arrOf(c.checklists).some(x => x.id === DAILY[0].id && x.name === DAILY[0].name + ' (renamed)') && c.upBy === 'amir'; })), 'Dr. A’s checklist change is saved');
ok(!!(await until(async () => (await fsAll('cadAudit')).some(x => x.message === `<b>${before.amir}</b> edited <b>${DAILY[0].name} (renamed)</b>` && x.by === 'amir'))), 'the log names him (not a demo name)');
await A.page.goto(BASE + '#/admin/move');
await A.page.waitForSelector('text=Only if something’s wrong', { timeout: 15000 }).catch(() => { });
{ const t = await A.page.textContent('.panel:has-text("Lists (every day so far)")').catch(() => ''); ok(/Moved \w{3} \d+/.test(t) && t.includes(String(before.inst)) && t.includes(String(before.aud)), 'the page now shows what moved'); }
await A.page.screenshot({ path: 'shots/m05-data-page.png', fullPage: true });
// a staff login can't change the setup (the database refuses it, whatever a page tries)
ok(await B.page.evaluate(async () => {
  const a = firebase.apps.find(x => x.name === 'nloCasesLogin'), au = a.auth();
  await au.signInWithEmailAndPassword('gwen.1@staff.thenextlevelorthodontics.com', 'Correct-Horse-7');
  try { await a.firestore().doc('cadState/config').update({ practiceName: 'Hacked', up: firebase.firestore.FieldValue.serverTimestamp(), upBy: 'gwen' }); return false; }
  catch (e) { return /permission/i.test(String(e.code || e.message)); } finally { await au.signOut(); }
}), 'a staff login can’t change the setup');

// ---------- 6b. the rules as Dr. A published them at the move (24 Oct, 11:27), then the updated ones ----------
console.log('6b. the rules published at the move, then the updated ones');
{
  let RULES_MOVE = '';
  try { RULES_MOVE = execFileSync('git', ['show', 'ef2e7ef:nlo-cases-src/firestore.rules'], { cwd: REPO, encoding: 'utf8' }); } catch { }
  if (!RULES_MOVE.includes('match /meta/rules_cad_1') || RULES_MOVE.includes('rules_cad_2')) throw new Error('the rules as published at the move are not where expected');
  await rules(RULES_MOVE);
  await A.page.reload(); await waitHash(A.page, /#\/picker$/);
  await signIn(A.page, 'dr.owner@example.com'); await waitHash(A.page, /#\/admin\/dashboard$/, 30000);
  await A.page.waitForSelector('.nlo-move-banner', { timeout: 15000 }).catch(() => { });
  ok(/updated database rules/.test(await A.page.textContent('.nlo-move-banner').catch(() => '')), 'with the rules as published at the move, his admin pages say one step is left (the updated rules)');
  await A.page.click('.nlo-move-banner button');
  ok(await waitHash(A.page, /#\/admin\/move$/), '… the banner opens the Data page');
  await A.page.waitForSelector('text=One step left: the updated database rules', { timeout: 15000 }).catch(() => { });
  const txt = await A.page.$eval('details textarea', t => t.value).catch(() => '');
  ok(await A.page.isVisible('text=One step left: the updated database rules') && txt.includes('match /meta/rules_cad_2') && txt.includes("request.auth.token.email == 'dr.owner@example.com'"), '… with the rules card (the whole file, his email filled in)');
  await A.page.screenshot({ path: 'shots/m12-updated-rules.png', fullPage: true });
  await rules(RULES_NEW);
  await A.page.click('button:has-text("Check again")');
  await A.page.waitForSelector('text=The updated rules are live.', { timeout: 15000 }).catch(() => { });
  ok(await A.page.isVisible('text=The updated rules are live.'), 'published: Check again says they’re live');
  await A.page.goto(BASE + '#/admin/dashboard'); await sleep(800);
  ok(!(await A.page.isVisible('.nlo-move-banner')), '… and the banner is gone');
}

// ---------- 7. two devices rolling the day ----------
console.log('7. the day rolls once');
// nobody else signed in (their screens would roll it too); today's lists of the two checklists due today go, Gwen's stay
await A.page.click('.admin-nav button:has-text("Lock")'); await waitHash(A.page, /#\/picker$/);
await C1.ctx.close(); await C2.ctx.close();
for (const x of await instOf(TODAY)) if (x.checklistId === DAILY[3].id || x.checklistId === DAILY[4].id) await fsDel('cadInst/' + x._id);
await fsPut('cadState/day', { today: YDAY, currentQuarter: quarterOf(YDAY), up: new Date(), upBy: 'amir' });
const R1 = await device(), R2 = await device();
await Promise.all([R1.page.goto(BASE), R2.page.goto(BASE)]);
await Promise.all([signIn(R1.page, 'gwen'), signIn(R2.page, 'sarah')]);
const rolled = await until(async () => { const d = await fsDoc('cadState/day'); return d && d.today === TODAY; }, 30000);
ok(!!rolled, 'the day rolled to today');
await sleep(2500);
const rollLog = (await fsAll('cadAudit')).filter(x => x.message === `<b>System</b> rolled the day to <b>${TODAY}</b>`);
ok(rollLog.length === 1, `once for the office (${rollLog.length} roll entries in the log)`);
const todays = await instOf(TODAY), keys = todays.map(x => x.checklistId + '|' + (x.assigneeId || ''));
ok(todays.length >= 2 && new Set(keys).size === keys.length, `today’s lists made once (${todays.length}, no doubles)`);
ok(todays.some(x => x.checklistId === DAILY[3].id) && todays.some(x => x.checklistId === DAILY[4].id), 'the checklists due today are among them');
ok(await waitHash(R1.page, /#\/app\/mine$/) && await waitHash(R2.page, /#\/(app\/mine|admin\/dashboard)$/), 'both people signed in');
const mineIds = async p => p.evaluate(() => document.querySelector('.staff-content') ? document.querySelector('.staff-content').textContent : '');
await R1.page.waitForTimeout(1500);
const gwenToday = todays.filter(x => x.assigneeId === 's_gwen').map(x => CLS.find(c => c.id === x.checklistId).name);
ok(gwenToday.every(n => (n && 1)) && (await mineIds(R1.page)).length > 0, 'Gwen’s screen shows the day’s lists');
await R2.ctx.close();
// a device whose clock is a day behind: it shows the office's day and never takes it back
{
  const R3 = await device();
  await R3.page.clock.setFixedTime(new Date(Date.now() - 864e5));
  await R3.page.goto(BASE); await signIn(R3.page, 'angie');
  ok(await waitHash(R3.page, /#\/app\/mine$/, 30000), 'a device whose clock is a day behind signs in');
  await sleep(3000);
  const d3 = await fsDoc('cadState/day'), t3 = await R3.page.evaluate(() => window.__nloCad && window.__nloCad.today).catch(() => null);
  ok(d3 && d3.today === TODAY && t3 === TODAY && !(await fsAll('cadAudit')).some(x => x.message === `<b>System</b> rolled the day to <b>${YDAY}</b>`), '… it shows the office’s day and doesn’t take it back (' + t3 + ')');
  await R3.ctx.close();
}

// ---------- 8. NLO Time Off's feed ----------
console.log('8. NLO Time Off’s feed');
const d8 = officeDay(5);
FEED = { ok: true, timeOff: FEED.timeOff.concat([{ id: 'r2', employeeName: 'Wila Jordan', start: d8, end: d8, hours: 'Morning' }]), holidays: [] };
const hits0 = feedHits;
const F = await device(); await F.page.goto(BASE); await signIn(F.page, 'angie'); await waitHash(F.page, /#\/app\/mine$/, 30000);
ok(!!(await until(async () => { const t = await fsDoc('cadState/timeoff'); return t && t.e && t.e['tof_r2_' + d8] && t.e['tof_r2_' + d8].scope === 'am' && t.e['tof_r2_' + d8].staffId === 's_wila'; }, 20000)), 'approved time off from the feed lands on the out-of-office board');
ok(feedHits > hits0, 'read with the key from Cadence’s copy (no Google connection on this device)');
ok(oldApp === 0, 'the old Time-Off app is never asked');
await F.ctx.close();

// ---------- 8b. older rules published again after the move ----------
console.log('8b. older rules after the move');
const oldRules = '.nlo-signin [role=alert]:has-text("older rules")';
await rules(RULES_OLD);
await A.page.reload(); await waitHash(A.page, /#\/picker$/);
await A.page.waitForSelector(oldRules, { timeout: 20000 }).catch(() => { });
ok((await mode(A.page)) === 'fs' && await A.page.isVisible(oldRules), 'a screen that has seen Cadence moved stays on the new system and says the rules are older');
await A.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
await signIn(A.page, 'dr.owner@example.com');
await A.page.waitForSelector('.nlo-signin button:has-text("Copy the rules")', { timeout: 30000 }).catch(() => { });
ok(await A.page.isVisible('.nlo-signin button:has-text("Copy the rules")') && /#\/picker$/.test(await hash(A.page)), 'Dr. A signing in there gets the rules to publish');
await A.page.screenshot({ path: 'shots/m11-rules-older.png' });
await A.page.click('.nlo-signin button:has-text("Copy the rules")');
const clip = await A.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
ok(clip.includes('match /cadInst/{id}') && clip.includes('match /invItems/{id}') && clip.includes("request.auth.token.email == 'dr.owner@example.com'"), '… the whole file, with his email filled in');
{
  const O = await device(); await O.page.goto(BASE); await connect(O.page); // Google, and it never saw the new system
  ok(await waitMode(O.page, 'fs', 30000) && !!(await O.page.waitForSelector(oldRules, { timeout: 30000 }).catch(() => null)), 'a device on the old database hears there that Cadence moved, and says the same');
  await O.ctx.close();
}
await rules(RULES_NEW);
for (const d of [A, R1]) await d.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => { }); // (their move-marker listeners try again now, not in a minute)
await signIn(A.page, 'dr.owner@example.com');
ok(await waitHash(A.page, /#\/admin\/dashboard$/, 30000), 'the rules published again: Dr. A signs in');
await A.page.click('.admin-nav button:has-text("Lock")'); await waitHash(A.page, /#\/picker$/);
ok(!(await A.page.isVisible(oldRules)), '… and the sign-in no longer says they’re older');

// ---------- 9. moving back ----------
console.log('9. moving back');
const gwenTick = await fsDoc('cadInst/' + GW[1]), nFs = (await fsAll('cadInst')).length, aFs = (await fsAll('cadAudit')).length;
await signIn(A.page, 'dr.owner@example.com'); await waitHash(A.page, /#\/admin\/dashboard$/, 30000);
await A.page.goto(BASE + '#/admin/move');
await A.page.waitForSelector('text=I want to move Cadence back');
ok(await A.page.isDisabled('button:has-text("Move it back")'), 'Move it back needs the tick box');
await A.page.check('input[type=checkbox]');
const [dl2] = await Promise.all([A.page.waitForEvent('download', { timeout: 30000 }).catch(() => null), A.page.click('button:has-text("Move it back")')]);
ok(!!dl2 && /^cadence-before-moving-back-/.test(dl2.suggestedFilename()), 'it saves a copy first');
let rtCounts = [];
const rtWatch = (async () => { for (let i = 0; i < 60; i++) { const v = await dbGet('nlo/cadence/state/instances').catch(() => null); const n = v ? arrOf(v).length : -1; if (rtCounts[rtCounts.length - 1] !== n) rtCounts.push(n); await sleep(200); } })();
if (dl2) { const c2 = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8')); ok(arrOf(c2.state.instances).length === nFs, `the copy holds every list (${arrOf(c2.state.instances).length}/${nFs})`); }
ok(!!(await until(async () => { const m = await fsDoc('cadMeta/moved'); return m && m.on === false && m.pause === false; }, 60000)), 'the marker says back');
ok(await waitMode(A.page, 'rtdb', 30000), 'Dr. A’s screen opens on the old database again');
const back = await dbGet('nlo/cadence/state');
ok(back && arrOf(back.staff).length === CAD_STAFF.length && back.practiceName === ST.practiceName, 'the old copy has its staff and practice name back');
const bi = arrOf(back.instances).find(x => x.id === GW[1]);
ok(bi && arrOf(bi.items)[0].checked === true && gwenTick && arrOf(bi.items).length === Object.keys(gwenTick.items).length, 'with every tick made on the new system');
ok(arrOf(back.instances).filter(x => x.date === TODAY).length === todays.length, 'and the day’s lists made there');
ok(arrOf(back.checklists).some(x => x.name === DAILY[0].name + ' (renamed)') && arrOf(back.staff).some(x => x.name === 'Kaylee Dotson'), 'and Dr. A’s changes');
ok(arrOf(back.instances).some(x => x.id === OLDEST.id), 'and the lists from before the screens’ window');
ok(arrOf(back.instances).length === nFs && arrOf(back.audit).length === aFs, `every list and log entry (${arrOf(back.instances).length}/${nFs}, ${arrOf(back.audit).length}/${aFs})`);
await rtWatch; console.log('  (the old database’s list count after moving back: ' + rtCounts.join(' → ') + ')');
await sleep(2000); // Dr. A's screen opens again on the old database: it must not write back what the new system's screen held
{ const b2 = await dbGet('nlo/cadence/state'); ok(arrOf(b2.instances).length === nFs && arrOf(b2.instances).some(x => x.id === OLDEST.id), `… and they stay there (${arrOf(b2.instances).length}/${nFs})`); }
ok((await dbGet('nlo/cadence/moved')) === null && (await dbGet('nlo/cadence/forMeeting')) === null, 'no longer marked moved (the Staff Meeting reads it there again)');
ok(await waitHash(R1.page, /#\/$/, 30000), 'a screen on the new system with no Google connection starts over at the device step');
await R1.ctx.close();
const G2 = await signedIn('gwen', { google: 'records@thenextlevelorthodontics.com' });
ok(G2.landed && (await mode(G2.page)) === 'rtdb', 'Gwen signs in on the old database again');
await G2.ctx.close();
{
  const M = await device(); await M.page.goto(MEET); await connect(M.page, 'akhavan.ak@gmail.com');
  const r = await M.page.evaluate(async () => { const x = await readCadence(); return { n: x.length, staff: arrOf(x[0]).length }; }).catch(e => ({ err: String(e) }));
  ok(r.n === 4 && r.staff === CAD_STAFF.length, 'the Staff Meeting Hub reads Cadence’s own data again (' + JSON.stringify(r) + ')');
  await M.ctx.close();
}

// ---------- 10. moving again ----------
console.log('10. moving again');
await A.page.goto(BASE + '#/admin/dashboard');
if (!/#\/admin/.test(await hash(A.page))) { await signIn(A.page, 'dr.owner@example.com'); await waitHash(A.page, /#\/admin\/dashboard$/, 30000); }
await A.page.goto(BASE + '#/admin/move');
await A.page.waitForSelector('button:has-text("Move it now"):not([disabled])', { timeout: 20000 }).catch(() => { });
const extra = 'inst_stale_' + Date.now().toString(36);
await fsPut('cadInst/' + extra, { id: extra, checklistId: DAILY[0].id, date: TODAY, status: 'pending', items: {}, up: new Date(), upBy: 'amir' }); // a list only the new database has
const nBack = arrOf((await dbGet('nlo/cadence/state')).instances).length, aBack = arrOf((await dbGet('nlo/cadence/state')).audit).length;
await Promise.all([A.page.waitForEvent('download', { timeout: 30000 }).catch(() => null), A.page.click('button:has-text("Move it now")')]);
ok(!!(await until(async () => { const m = await fsDoc('cadMeta/moved'); return m && m.on === true && m.pause === false; }, 60000)), 'moves again');
const insts2 = await fsAll('cadInst'), auds2 = await fsAll('cadAudit');
ok(insts2.length === nBack && nBack === nFs && !insts2.some(x => x._id === extra), `the lists are the old copy’s (${insts2.length}/${nBack}/${nFs}; one only the new database had is gone)`);
ok(auds2.length === aBack, `the log entries, each once (${auds2.length}/${aBack})`);
ok(await waitMode(A.page, 'fs', 30000), 'Dr. A’s screen on the new system again');

// ---------- done ----------
console.log('\npage errors: ' + errors.length);
errors.slice(0, 10).forEach(e => console.log('  ' + e.slice(0, 400)));
ok(errors.length === 0, 'no page errors');
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:'); fails.forEach(f => console.log('  - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
