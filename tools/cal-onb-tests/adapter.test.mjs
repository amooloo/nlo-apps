// The Office Calendar's and Onboarding's old-database calls on the NLO Cases database (nlo-meeting-db.js, with each page's
// own setup read out of the page): every step is done to the old database (Realtime Database emulator) and through the new
// layer (Firestore emulator, the real rules), and what each path reads back must be the same. Plus what the rules let each
// login do, and what the Staff Meeting Hub reads of these two apps before and after their moves. A made-up office.
// node adapter.test.mjs   (emulators running: auth 9099, firestore 8080, database 9000; the repo served on 127.0.0.1:8766)
import fs from 'node:fs';
import * as E from './seed.mjs';
import { WIRE } from './wire.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.MTG_BASE || 'http://127.0.0.1:8766/';
const SDK = new URL('./node_modules/firebase/', import.meta.url).pathname;
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const fails = [];
function ok(c, what) { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* each page's own NLOM.forApp({...}) setup, read out of the page so the test runs the real one */
function setupOf(file, consts) {
  const src = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
  const i = src.indexOf('NLOM.forApp(');
  if (i < 0) throw new Error(file + ': no NLOM.forApp');
  let depth = 0, j = i + 'NLOM.forApp('.length - 1;
  for (; j < src.length; j++) { const c = src[j]; if (c === '(') depth++; else if (c === ')') { depth--; if (!depth) break; } }
  const ks = Object.keys(consts);
  return (ks.length ? 'const ' + ks.map(k => k + ' = ' + JSON.stringify(consts[k])).join(', ') + '; ' : '') + 'return ' + src.slice(i, j + 1) + ';';
}
const CAL_SETUP = setupOf('nlo-calendar.html', { CAL_ROOT: 'nlo/calendar' });
const ONB_SETUP = setupOf('onboarding.html', {});

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
async function device() {
  const ctx = await browser.newContext();
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/(?:10\.12|9\.23)\.\d+\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  PAGEERROR', String(e).slice(0, 300)));
  await page.goto(BASE + 'tools/cal-onb-tests/blank.html');
  await page.waitForFunction(() => !!window.NLOM);
  await page.evaluate(([a, b]) => { window.NLOC = new Function('NLOM', a)(NLOM); window.NLOO = new Function('NLOM', b)(NLOM); }, [CAL_SETUP, ONB_SETUP]);
  return { ctx, page };
}
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x);

console.log('setup');
await E.loadRules();
await E.seedOffice();
await E.linkRoster();
await E.j(`${E.DBU}/.settings/rules.json?ns=${E.NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ rules: { '.read': true, '.write': true } }) });
await E.j(`${E.DBU}/.json?ns=${E.NS}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
for (const c of ['calEvents', 'calStickers', 'calState', 'calMeta', 'onbPeople', 'onbTracks', 'onbMods', 'onbState', 'onbMeta', 'hubRoster', 'cadMirror']) {
  const docs = await E.fsList('nlo-cases', c).catch(() => []);
  for (const d of docs) await fetch(`${E.FS}/v1/projects/nlo-cases/databases/(default)/documents/${c}/${d.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}

const A = await device();
const p = A.page;
await p.evaluate(async ([email, pw]) => {
  firebase.initializeApp({ apiKey: 'x', databaseURL: 'https://nlo-inventory-default-rtdb.firebaseio.com', projectId: 'nlo-inventory' });
  window.rt = firebase.database();
  await NLOC.signIn(email, pw);
  window.cal = NLOC.db(NLOC.fs, () => NLOC.me.sid, null);
  await NLOO.signIn(email, pw);   // (the same NLO Cases app under the hood)
  window.onb = NLOO.db(NLOO.fs, () => NLOO.me.sid, null);
}, [E.OWNER.email, E.PW]);
ok(await p.evaluate(() => !!NLOC.me && NLOC.me.role === 'owner' && NLOC.me.sid === 'amir' && NLOC.me.rid === 's_amir'), 'Dr. A signs in with the NLO Cases login; his Staff Hub id comes along');
ok(await p.evaluate(() => NLOC.NAME === 'the Office Calendar' && NLOC.KEY === 'nloCal' && NLOO.NAME === 'Onboarding' && NLOO.KEY === 'nloOnb' && NLOC !== NLOO && NLOC.ROOT === 'nlo/calendar' && NLOO.ROOT === 'nlo/onboarding'), 'each page has its own layer (name, storage key, root)');

/* the same steps on both; then every place read back from both must be the same */
async function same(dbName, steps, places) {
  for (const [what, code] of steps) {
    const r = await p.evaluate(async ([code, dbName]) => {
      const run = async d => { await (new Function('d', 'return ' + code))(d); };
      try { await run(rt); } catch (e) { return { err: 'old: ' + e.message }; }
      try { await run(window[dbName]); } catch (e) { return { err: 'new: ' + (e.code || '') + ' ' + e.message }; }
      return {};
    }, [code, dbName]);
    if (r.err) { ok(false, what + ' — ' + r.err); continue; }
    const diff = await p.evaluate(async ([places, dbName]) => {
      const out = [];
      for (const pl of places) {
        const a = (await rt.ref(pl).once('value')).val(), b = (await window[dbName].ref(pl).once('value')).val();
        const c = x => JSON.stringify(x, (k, y) => y && typeof y === 'object' && !Array.isArray(y) ? Object.keys(y).sort().reduce((o, kk) => (o[kk] = y[kk], o), {}) : y);
        if (c(a) !== c(b)) out.push(pl + ': old ' + c(a).slice(0, 300) + ' | new ' + c(b).slice(0, 300));
      }
      return out;
    }, [places, dbName]);
    ok(!diff.length, what + (diff.length ? '\n      ' + diff.join('\n      ') : ''));
  }
}

console.log('the Office Calendar: the same steps on both databases');
const C = (...a) => ['nlo/calendar'].concat(a).join('/');
await same('cal', [
  ['an entry', `d.ref('${C('events', 'e1700000000001')}').set({ type: 'event', title: 'Team lunch', startDate: '2026-11-03', endDate: '2026-11-03', time: '12:00', notes: 'Tacos', recurrence: null })`],
  ['a task done on a day (deep set)', `d.ref('${C('events', 'e1700000000001', 'doneDates', '2026-11-03')}').set(1761900000000)`],
  ['…and undone (deep remove)', `d.ref('${C('events', 'e1700000000001', 'doneDates', '2026-11-03')}').remove()`],
  ['a task marked done (update)', `d.ref('${C('events', 'e1700000000001')}').update({ done: true, doneAt: 1761900001000 })`],
  ['…and not (nulls in an update)', `d.ref('${C('events', 'e1700000000001')}').update({ done: null, doneAt: null })`],
  ['time off', `d.ref('${C('events', 'e1700000000002')}').set({ type: 'pto', staffId: 's_gwen', staffName: 'Gwen Rodis', startDate: '2026-11-10', endDate: '2026-11-11', time: null, notes: '' })`],
  ['a sticker', `d.ref('${C('stickers', 'kabc123')}').set({ date: '2026-11-03', emoji: '🌮', label: 'Taco day', yearly: false, at: 1761900002000 })`],
  ['an admin day painted', `d.ref('${C('adminDays', '2026-11-04')}').set('admin')`],
  ['…and unpainted', `d.ref('${C('adminDays', '2026-11-04')}').remove()`],
  ['another admin day', `d.ref('${C('adminDays', '2026-11-05')}').set('admin')`],
  ['a closure', `d.ref('${C('settings', 'closures', '2026-12-25')}').set('Christmas')`],
  ['a blackout date', `d.ref('${C('settings', 'blackoutDates', '2026-12-31')}').set(true)`],
  ['the PIN (old pages only; kept)', `d.ref('${C('settings', 'adminPin')}').set('2468')`],
  ['a setting removed', `d.ref('${C('settings', 'hrReviewsAdminOnly')}').set(null)`],
  ['the calendar’s staff list seeded whole', `d.ref('${C('staff')}').set({ s_amir: { name: 'Dr. Akhavan', active: true, birthday: '1985-06-14' }, s_gwen: { name: 'Gwen (OA)', active: true, birthday: '1996-02-02', hireDate: '2025-03-10' } })`],
  ['a staff member added', `d.ref('${C('staff', 's1761900003000')}').set({ name: 'Savannah (AC)', active: true, birthday: '1999-11-20' })`],
  ['a staff member edited', `d.ref('${C('staff', 's_gwen')}').update({ name: 'Gwen Rodis', hireDate: '2025-03-11' })`],
  ['a staff member turned off', `d.ref('${C('staff', 's_gwen', 'active')}').set(false)`],
  ['the editors (a list)', `d.ref('${C('config', 'editors')}').set(['gwen', 'sarah'])`],
  ['no editors', `d.ref('${C('config', 'editors')}').set([])`],
  ['editors again', `d.ref('${C('config', 'editors')}').set(['gwen'])`],
  ['an entry removed', `d.ref('${C('events', 'e1700000000002')}').remove()`],
  ['a sticker removed', `d.ref('${C('stickers', 'kabc123')}').remove()`],
  ['a staff member removed', `d.ref('${C('staff', 's1761900003000')}').remove()`]
], [C('events'), C('stickers'), C('staff'), C('settings'), C('adminDays'), C('config'), C('events', 'e1700000000001'), C('settings', 'closures'), C('config', 'editors')]);
// the places this page only reads
ok(await p.evaluate(async () => { try { await cal.ref('nlo/cadence/roster/people/s_x').set({ name: 'x' }); return false; } catch (e) { return /permission/.test(e.code); } }), 'Staff Hub’s roster is read-only here');
ok(await p.evaluate(async () => { try { await cal.ref('nlo/cadence/timeOffFeed/key').set('k'); return false; } catch (e) { return /permission/.test(e.code); } }), 'NLO Time Off’s feed key is read-only through this layer (the page writes Cadence’s record itself)');
ok(await p.evaluate(async () => { try { await cal.ref('nlo/onboarding/people').once('value'); return false; } catch (e) { return /not-available/.test(e.code); } }), 'a path of another app isn’t here');

console.log('Onboarding: the same steps on both databases');
const O = (...a) => ['nlo/onboarding'].concat(a).join('/');
const MOD = JSON.stringify(E.onboardingData(1761900000000).catalog.modules['core-welcome']);
await same('onb', [
  ['a plan assigned', `d.ref('${O('people', 's_nora', 'plan')}').set({ tracks: { core: true, clinic: true }, start: '2026-10-23', lead: 's_gwen', status: 'active', name: 'Nora Newman', title: 'Orthodontic Assistant', assignedAt: 1, assignedBy: 's_amir', updatedAt: 1, updatedBy: 's_amir' })`],
  ['a lesson opened (deep set)', `d.ref('${O('people', 's_nora', 'progress', 'core-welcome', 'l-read1', 'opened')}').set(2)`],
  ['a lesson done (deep update)', `d.ref('${O('people', 's_nora', 'progress', 'core-welcome', 'l-read1')}').update({ done: 3, by: 's_nora' })`],
  ['a quiz score', `d.ref('${O('people', 's_nora', 'progress', 'core-welcome', 'l-quiz1')}').set({ opened: 4, done: 5, score: 100, tries: 1, by: 's_nora' })`],
  ['a skill ready for sign-off', `d.ref('${O('people', 's_nora', 'progress', 'clinic-steri', 'l-skill1')}').set({ opened: 6, ready: 7 })`],
  ['a log line (a push key)', `d.ref('${O('people', 's_nora', 'log', '-Nx000000000000000a9')}').set({ at: 8, t: 'done', m: 'core-welcome', l: 'l-read1', by: 's_nora' })`],
  ['a sign-off', `d.ref('${O('people', 's_nora', 'signoffs', 'clinic-steri', 'l-skill1')}').set({ at: 9, by: 's_gwen', byName: 'Gwen Rodis', note: 'Great job', criteria: [true, true] })`],
  ['…and the skill done', `d.ref('${O('people', 's_nora', 'progress', 'clinic-steri', 'l-skill1')}').update({ done: 9, ready: null })`],
  ['a multi-path update across records', `d.ref().update({ '${O('people', 's_nora', 'plan', 'status')}': 'done', '${O('people', 's_nora', 'plan', 'doneAt')}': 10, '${O('roles', 'trainers', 's_gwen')}': true })`],
  ['the roles', `d.ref('${O('roles')}').set({ trainers: { s_gwen: true, s_amir: true }, managers: { s_gwen: true } })`],
  ['a role removed', `d.ref('${O('roles', 'managers', 's_gwen')}').remove()`],
  ['the settings', `d.ref('${O('settings')}').set({ officeDays: [1, 2, 3, 4], pass: 80, aisa: true, idleMin: 10 })`],
  ['a setting changed', `d.ref('${O('settings', 'idleMin')}').set(15)`],
  ['a track', `d.ref('${O('catalog', 'tracks', 'core')}').set({ id: 'core', name: 'NLO Foundations', short: 'Core', desc: 'Everyone', color: 'navy', icon: 'star', order: 1 })`],
  ['a module (lessons: a list of records with lists inside)', `d.ref('${O('catalog', 'modules', 'core-welcome')}').set(${MOD})`],
  ['the catalog’s version', `d.ref('${O('catalog', 'meta')}').set({ version: '1761900000000-x', updatedAt: 11, by: 's_amir' })`],
  ['a module edited', `d.ref('${O('catalog', 'modules', 'core-welcome')}').update({ title: 'Welcome!', minutes: 25 })`],
  ['a module removed', `d.ref('${O('catalog', 'modules', 'clinic-steri')}').remove()`],
  ['a second person', `d.ref('${O('people', 's_bri', 'plan')}').set({ tracks: { core: true }, start: '2026-09-01', status: 'active', name: 'Bri Brower' })`],
  ['a person removed', `d.ref('${O('people', 's_bri')}').remove()`]
], [O('people'), O('people', 's_nora'), O('people', 's_nora', 'progress'), O('people', 's_nora', 'log'), O('roles'), O('settings'), O('catalog', 'tracks'), O('catalog', 'modules'), O('catalog', 'meta'), O('catalog', 'modules', 'core-welcome', 'lessons')]);
ok(await p.evaluate(async () => { try { await onb.ref('nlo/onboarding/pins/s_gwen').set({ h: 'x' }); return false; } catch (e) { return /not-available/.test(e.code); } }), 'PINs have no place on the NLO Cases system');
ok(await p.evaluate(async () => { try { await onb.ref('nlo/onboarding/keys/abc').set({ rid: 's_nora' }); return false; } catch (e) { return /not-available/.test(e.code); } }), '…nor phone links');
// Onboarding's "replace" import: every record of the catalog removed in one update, then the new ones
{
  const r = await p.evaluate(async () => {
    const cur = (await onb.ref('nlo/onboarding/catalog/tracks').once('value')).val() || {};
    const u = {}; Object.keys(cur).forEach(id => { u['nlo/onboarding/catalog/tracks/' + id] = null; });
    u['nlo/onboarding/catalog/tracks/new1'] = { id: 'new1', name: 'New track', order: 1 };
    await onb.ref().update(u);
    return (await onb.ref('nlo/onboarding/catalog/tracks').once('value')).val();
  });
  ok(r && Object.keys(r).length === 1 && r.new1 && r.new1.name === 'New track', 'an import that replaces the catalog: old records removed, the new ones in, one update');
}
// stamps
{
  const r = await p.evaluate(async () => {
    const a = (await NLOC.fs.doc('calEvents/e1700000000001').get()).data(), b = (await NLOO.fs.doc('onbPeople/s_nora').get()).data();
    const v = (await cal.ref('nlo/calendar/events/e1700000000001').once('value')).val();
    return { a: a._by === 'amir' && !!a._up, b: b._by === 'amir' && !!b._up, leak: '_by' in v || '_up' in v };
  });
  ok(r.a && r.b && !r.leak, 'records are stamped with the NLO Cases staff id and time; reads leave the stamps out');
}

/* ---------- the move's record making ---------- */
console.log('the moves: old values → records → read back the same');
await E.seedOld();
await p.evaluate(async () => {   // (a push through the layer, for the key)
  const k = onb.ref('nlo/onboarding/people/s_nora/log').push({ at: 12, t: 'ready', m: 'clinic-steri', l: 'l-skill1', by: 's_nora' });
  await k; return k.key;
}).then(k => ok(/^-[A-Za-z0-9_-]{19}$/.test(k), 'a push through the layer makes a push key: ' + k));
async function wipeNew() {
  for (const c of ['calEvents', 'calStickers', 'calState', 'onbPeople', 'onbTracks', 'onbMods', 'onbState', 'hubRoster', 'cadMirror']) {
    const docs = await E.fsList('nlo-cases', c).catch(() => []);
    for (const d of docs) await fetch(`${E.FS}/v1/projects/nlo-cases/databases/(default)/documents/${c}/${d.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  }
}
await wipeNew();   // a first move: nothing of either app's, Staff Hub's or Cadence's on the NLO Cases side yet
// the Office Calendar
{
  const r = await p.evaluate(async () => {
    const old = await NLOC.readOld(rt);
    const recs = NLOC.recordsOf(old);
    const res = await NLOC.writeRecords(NLOC.fs, NLOC.me.sid, recs);
    const back = await NLOC.readNew(NLOC.fs);
    const diffs = Object.keys(back).filter(k => NLOC.fpr(old[k]) !== NLOC.fpr(back[k]));
    const ros = (await NLOC.fs.doc('hubRoster/live').get()).data(), feed = (await NLOC.fs.doc('cadMirror/tofeed').get()).data();
    const viaLayer = (await cal.ref('nlo/cadence/roster/people').once('value')).val(), key = (await cal.ref('nlo/cadence/timeOffFeed/key').once('value')).val();
    return { n: recs.length, res, diffs, counts: NLOC.counts(old), bad: NLOC.badIds(recs), ros, feed, viaLayer, key };
  });
  ok(!r.res.missing.length && !r.res.differ.length && !r.res.left.length, 'the calendar’s old data written as records reads back the same (' + r.n + ' records; ' + JSON.stringify(r.res).slice(0, 200) + ')');
  ok(!r.diffs.length, 'every old place of the calendar’s reads back the same through the new layer' + (r.diffs.length ? ': ' + r.diffs.join(', ') : ''));
  ok(!r.bad.length, 'every record id is one the rules take');
  ok(r.counts.events === 4 && r.counts.stickers === 1 && r.counts.staff === 1 && r.counts.settings === 1 && r.counts.adminDays === 1 && r.counts['nlo/cadence/roster'] === 1 && r.counts['nlo/cadence/timeOffFeed'] === 1, 'the counts the move page shows: ' + JSON.stringify(r.counts));
  ok(r.ros && r.ros.source === 'staff-hub' && r.ros.people && r.ros.people.s_gwen && r.ros.people.s_gwen.name === 'Gwen Rodis' && r.ros._by === 'amir' && r.ros.dates && r.ros.dates.s_gwen, 'Staff Hub’s roster copied in (not there yet): people and dates, stamped');
  ok(r.viaLayer && r.viaLayer.s_nora && r.viaLayer.s_nora.title === 'Orthodontic Assistant', '…and read back through the old path nlo/cadence/roster/people');
  ok(r.feed && r.feed.key === E.FEED_KEY && r.feed.upBy === 'amir' && !!r.feed.up && !('_by' in r.feed), 'NLO Time Off’s feed key copied into Cadence’s record with Cadence’s stamps (up, upBy)');
  ok(r.key === E.FEED_KEY, '…and read back through nlo/cadence/timeOffFeed/key');
  const again = await p.evaluate(async () => { const old = await NLOC.readOld(rt); return NLOC.writeRecords(NLOC.fs, NLOC.me.sid, NLOC.recordsOf(old)); });
  ok(again.written === 8 && !again.removed && !again.missing.length && !again.differ.length && !again.left.length, 'run again (nothing changed): the same records, the copied-in ones left alone, nothing flagged (' + JSON.stringify(again).slice(0, 120) + ')');
}
// a second move (a re-run, or Onboarding's move after the calendar's) leaves a roster that is already there alone
{
  await E.dbPatch('nlo/cadence/roster/people/s_gwen', { title: 'Lead Assistant (old copy)' });
  await E.fsSet('nlo-cases', 'hubRoster/live', { source: 'staff-hub', updatedAt: 1761990000000, people: { s_gwen: { id: 's_gwen', name: 'Gwen Rodis', title: 'Lead Orthodontic Assistant' } } });
  const r = await p.evaluate(async () => {
    const old = await NLOO.readOld(rt);
    const recs = NLOO.recordsOf(old);
    const res = await NLOO.writeRecords(NLOO.fs, NLOO.me.sid, recs);
    const back = await NLOO.readNew(NLOO.fs);
    const diffs = Object.keys(back).filter(k => NLOO.fpr(old[k]) !== NLOO.fpr(back[k]));
    const ros = (await NLOO.fs.doc('hubRoster/live').get()).data();
    const people = (await onb.ref('nlo/cadence/roster/people').once('value')).val();
    return { n: recs.length, res, diffs, counts: NLOO.counts(old), bad: NLOO.badIds(recs), ros, people, nora: (await onb.ref('nlo/onboarding/people/s_nora').once('value')).val() };
  });
  ok(!r.res.missing.length && !r.res.differ.length && !r.res.left.length, 'Onboarding’s old data written as records reads back the same (' + r.n + ' records; ' + JSON.stringify(r.res).slice(0, 200) + ')');
  ok(!r.diffs.length, 'every old place of Onboarding’s reads back the same through the new layer' + (r.diffs.length ? ': ' + r.diffs.join(', ') : ''));
  ok(!r.bad.length, 'every record id is one the rules take');
  ok(r.counts.people === 1 && r.counts.roles === 1 && r.counts.settings === 1 && r.counts['catalog/tracks'] === 2 && r.counts['catalog/modules'] === 2 && r.counts['catalog/meta'] === 1 && r.counts['nlo/cadence/roster'] === 1, 'the counts the move page shows: ' + JSON.stringify(r.counts));
  ok(r.ros && r.ros.people.s_gwen.title === 'Lead Orthodontic Assistant' && r.ros.updatedAt === 1761990000000, 'a roster already on the NLO Cases system (Staff Hub’s) is left alone — not written over with the old copy');
  ok(r.people && r.people.s_gwen.title === 'Lead Orthodontic Assistant', '…and that is what the page reads');
  ok(r.nora && r.nora.plan && r.nora.plan.lead === 's_gwen' && r.nora.progress['clinic-steri']['l-skill1'].ready && Object.keys(r.nora.log).length === 2 && !('pins' in r.nora), 'a person’s record: plan, progress, log (pins, keys and devices left behind)');
  ok(await p.evaluate(async () => { const o = await NLOO.readOld(rt); return !('nlo/onboarding/pins' in o) && !('nlo/onboarding/keys' in o) && !('nlo/onboarding/devices' in o); }), 'the move doesn’t read the PINs, phone links or devices at all');
  await E.fsSet('nlo-cases', 'hubRoster/live', E.ROSTER);
}

/* ---------- the rules ---------- */
console.log('rules: the Office Calendar');
const G = await device();
await G.page.evaluate(async ([user, pw]) => { await NLOC.signIn(user, pw); window.cal = NLOC.db(NLOC.fs, () => NLOC.me.sid, null); window.onb = NLOO.db(NLOC.fs, () => NLOC.me.sid, null); }, ['gwen', E.PW]);
ok(await G.page.evaluate(() => NLOC.me && NLOC.me.role === 'staff' && NLOC.me.sid === 'gwen' && NLOC.me.rid === 's_gwen'), 'Gwen signs in (staff; her Staff Hub id s_gwen)');
const tryG = code => G.page.evaluate(async code => { try { await (new Function('d', 'o', 'fs', 'return ' + code))(cal, onb, NLOC.fs); return 'ok'; } catch (e) { return String(e.code || e.message); } }, code);
const tryA = code => p.evaluate(async code => { try { await (new Function('d', 'o', 'fs', 'return ' + code))(cal, onb, NLOC.fs); return 'ok'; } catch (e) { return String(e.code || e.message); } }, code);
await tryA(`d.ref('nlo/calendar/config/editors').set([])`);
ok(await G.page.evaluate(async () => { const v = (await cal.ref('nlo/calendar/events').once('value')).val(); return v && Object.keys(v).length === 4; }), 'everyone signed in reads the calendar');
ok(await G.page.evaluate(async () => { const v = (await cal.ref('nlo/cadence/roster/people').once('value')).val(); return v && v.s_gwen && v.s_gwen.name === 'Gwen Rodis'; }), '…and Staff Hub’s roster');
ok(/permission/.test(await tryG(`d.ref('nlo/calendar/events/g1').set({ type: 'event', title: 'x', startDate: '2026-11-03', endDate: '2026-11-03' })`)), 'not an editor: can’t add an entry');
ok(/permission/.test(await tryG(`d.ref('nlo/calendar/settings/closures/2026-12-26').set('x')`)), 'not an editor: can’t add a closure');
ok(/permission/.test(await tryG(`d.ref('nlo/calendar/adminDays/2026-11-06').set('admin')`)), 'not an editor: can’t paint an admin day');
ok(/permission/.test(await tryG(`d.ref('nlo/calendar/stickers/g1').set({ date: '2026-11-03', emoji: '🎉', at: 1 })`)), 'not an editor: can’t add a sticker');
ok(/permission/.test(await tryG(`d.ref('nlo/calendar/config/editors').set(['gwen'])`)), 'staff can’t make themselves an editor');
ok(await tryA(`d.ref('nlo/calendar/config/editors').set(['gwen'])`) === 'ok', 'Dr. A picks Gwen as an editor');
ok(await tryG(`d.ref('nlo/calendar/events/g1').set({ type: 'event', title: 'x', startDate: '2026-11-03', endDate: '2026-11-03' })`) === 'ok', 'an editor: adds an entry');
ok(await tryG(`d.ref('nlo/calendar/events/g1/doneDates/2026-11-03').set(1)`) === 'ok', 'an editor: a deep change');
ok(await tryG(`d.ref('nlo/calendar/settings/closures/2026-12-26').set('Day after')`) === 'ok', 'an editor: a closure');
ok(await tryG(`d.ref('nlo/calendar/adminDays/2026-11-06').set('admin')`) === 'ok', 'an editor: an admin day');
ok(await tryG(`d.ref('nlo/calendar/stickers/g1').set({ date: '2026-11-03', emoji: '🎉', at: 1 })`) === 'ok', 'an editor: a sticker');
ok(await tryG(`d.ref('nlo/calendar/staff/s_gwen/active').set(true)`) === 'ok', 'an editor: the calendar’s staff list');
ok(await tryG(`d.ref('nlo/calendar/events/g1').remove()`) === 'ok', 'an editor: removes an entry');
ok(/permission/.test(await tryG(`d.ref('nlo/calendar/config/editors').set(['gwen', 'sarah'])`)), 'an editor still can’t change who edits');
ok(/permission/.test(await tryG(`fs.doc('calEvents/g2').set({ title: 'x', _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'amir' })`)), 'a record stamped with someone else’s id is refused');
ok(/permission/.test(await tryG(`fs.doc('calEvents/g3').set({ title: 'x', _up: 5, _by: 'gwen' })`)), 'a record stamped with a made-up time is refused');
ok(/permission/.test(await tryG(`fs.doc('calEvents/bad.id').set({ title: 'x', _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'gwen' })`)), 'odd record ids are refused');
ok(/permission/.test(await tryG(`fs.doc('calMeta/moved').set({ on: false, at: firebase.firestore.FieldValue.serverTimestamp() })`)), 'staff can’t say where the data is');
ok(/permission/.test(await tryG(`fs.doc('calState/settings').delete()`)), 'the settings can’t be deleted');
ok(/permission/.test(await tryG(`fs.doc('hubRoster/live').set({ people: {}, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'gwen' })`)), 'staff can’t write Staff Hub’s roster');
ok(/permission/.test(await tryA(`fs.doc('hubRoster/live').set({ people: {}, extra: 1, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'amir' })`)), 'the roster record takes only its own fields (even from Dr. A)');
ok(/permission/.test(await tryA(`fs.doc('hubRoster/other').set({ people: {}, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'amir' })`)), '…and only the one record, live');
ok(await tryA(`fs.doc('hubRoster/live').set({ v: 1, source: 'staff-hub', updatedAt: 1, people: { s_gwen: { name: 'Gwen Rodis' } }, _up: firebase.firestore.FieldValue.serverTimestamp() })`) === 'ok', 'Dr. A (Staff Hub) writes the roster, with or without _by');
await E.fsSet('nlo-cases', 'hubRoster/live', E.ROSTER);
ok(await tryA(`fs.doc('calMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp() })`) === 'ok', 'Dr. A marks the calendar moved');
ok(await G.page.evaluate(async () => (await NLOC.moved()).mode) === 'fs', '…and everyone sees it');
ok(await tryA(`fs.doc('calMeta/moved').set({ on: false, at: firebase.firestore.FieldValue.serverTimestamp() })`) === 'ok', '…and back');
ok(/permission/.test(await tryA(`fs.doc('calMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp(), who: 'x' })`)), 'the moved record holds nothing else');
// not signed in / a login still being set up
{
  const N = await device();
  ok(/permission/.test(await N.page.evaluate(async () => { NLOC.init(); try { await NLOC.fs.collection('calEvents').get(); return 'ok'; } catch (e) { return String(e.code); } })), 'not signed in: nothing readable');
  ok(await N.page.evaluate(async () => { NLOC.init(); try { await NLOC.fs.doc('calMeta/moved').get(); await NLOC.fs.doc('onbMeta/moved').get(); return true; } catch (e) { return String(e.code); } }) === true, 'not signed in: where the data is, only (both apps)');
  ok(await N.page.evaluate(async () => (await NLOC.moved()).mode === 'rtdb' && (await NLOO.moved()).mode === 'rtdb'), 'before the moves: the pages use the old database');
  const r = await N.page.evaluate(async pw => {
    NLOC.init(); await NLOC.auth.signInWithEmailAndPassword('newbie.1@staff.example.com', pw);
    const t = async f => { try { await f(); return 'ok'; } catch (e) { return String(e.code || e.message); } };
    return { cal: await t(() => NLOC.fs.collection('calEvents').get()), onb: await t(() => NLOC.fs.collection('onbPeople').get()), ros: await t(() => NLOC.fs.doc('hubRoster/live').get()) };
  }, E.PW);
  ok(/permission/.test(r.cal) && /permission/.test(r.onb), 'a login still on its temporary password: nothing of the calendar’s or Onboarding’s');
  await N.ctx.close();
}

console.log('rules: Onboarding');
await tryA(`o.ref('nlo/onboarding/roles').set({ trainers: { s_gwen: true }, managers: {} })`);
ok(await G.page.evaluate(async () => { const v = (await onb.ref('nlo/onboarding/people').once('value')).val(); return v && v.s_nora && v.s_nora.plan.lead === 's_gwen'; }), 'everyone signed in reads the training records');
ok(await G.page.evaluate(async () => { const v = (await onb.ref('nlo/onboarding/catalog/modules').once('value')).val(); return v && Object.keys(v).length === 2; }), '…and the curriculum');
ok(await tryG(`o.ref('nlo/onboarding/people/s_nora/progress/core-welcome/l-quiz1').set({ opened: 1, done: 2, score: 100, by: 's_nora' })`) === 'ok', 'a member saves training progress');
ok(await tryG(`o.ref('nlo/onboarding/people/s_nora/log').push({ at: 3, t: 'done', m: 'core-welcome', l: 'l-quiz1', by: 's_nora' })`) === 'ok', '…a log line');
ok(await tryG(`o.ref('nlo/onboarding/people/s_nora/signoffs/clinic-steri/l-skill1').set({ at: 4, by: 's_gwen', byName: 'Gwen Rodis' })`) === 'ok', '…a sign-off (the page makes sure it’s the signed-in trainer)');
ok(await tryG(`o.ref('nlo/onboarding/people/s_nora/plan/status').set('done')`) === 'ok', '…and a plan (assigning is any member’s, as before)');
ok(/permission/.test(await tryG(`fs.doc('onbPeople/s_nora').set({ plan: {}, pins: { h: 'x' }, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'gwen' })`)), 'a person’s record takes only plan, progress, sign-offs and log');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/people/s_nora').remove()`)), 'not a manager: can’t remove a person');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/catalog/tracks/core/name').set('x')`)), 'not a manager: can’t change the curriculum');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/catalog/modules/m9').set({ id: 'm9', title: 'x', lessons: [] })`)), '…nor add a module');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/catalog/meta/version').set('x')`)), '…nor the catalog’s version');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/settings/idleMin').set(5)`)), '…nor the settings');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/roles/managers/s_gwen').set(true)`)), 'staff can’t make themselves a manager');
ok(await tryA(`o.ref('nlo/onboarding/roles/managers/s_gwen').set(true)`) === 'ok', 'Dr. A names Gwen a manager');
ok(await tryG(`o.ref('nlo/onboarding/catalog/tracks/core/name').set('NLO Basics')`) === 'ok', 'a manager: changes the curriculum');
ok(await tryG(`o.ref('nlo/onboarding/catalog/modules/m9').set({ id: 'm9', title: 'x', lessons: [{ id: 'l1', kind: 'read', body: 'b' }] })`) === 'ok', '…adds a module');
ok(await tryG(`o.ref('nlo/onboarding/catalog/modules/m9').remove()`) === 'ok', '…removes one');
ok(await tryG(`o.ref('nlo/onboarding/catalog/meta').set({ version: 'v2', updatedAt: 5, by: 's_gwen' })`) === 'ok', '…the catalog’s version');
ok(await tryG(`o.ref('nlo/onboarding/settings/idleMin').set(5)`) === 'ok', '…the settings');
ok(await tryG(`o.ref('nlo/onboarding/people/s_bri').set({ plan: { tracks: { core: true }, status: 'active', name: 'Bri' } })`) === 'ok' && await tryG(`o.ref('nlo/onboarding/people/s_bri').remove()`) === 'ok', '…removes a person');
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/roles/trainers/s_nora').set(true)`)), 'a manager still can’t change the roles');
ok(/permission/.test(await tryA(`fs.doc('onbState/roles').set({ trainers: {}, managers: {}, other: 1, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'amir' })`)), 'the roles record holds trainers and managers only');
// a manager whose NLO Cases login isn't linked to a Staff Hub person: the rules can't tell, so not a manager
await E.fsSet('nlo-cases', 'roster/gwen', { rid: '' }, ['rid']);
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/catalog/tracks/core/name').set('x')`)), 'a manager whose login has no Staff Hub link: not a manager to the rules');
ok(await tryG(`o.ref('nlo/onboarding/people/s_nora/progress/core-welcome/l-ack1').set({ done: 6 })`) === 'ok', '…but still saves training progress');
await E.fsSet('nlo-cases', 'roster/gwen', { rid: 's_gwen' }, ['rid']);
await tryA(`o.ref('nlo/onboarding/roles/managers/s_gwen').remove()`);
ok(/permission/.test(await tryG(`fs.doc('onbMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp() })`)), 'staff can’t say where Onboarding’s data is');
ok(await tryA(`fs.doc('onbMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp() })`) === 'ok' && await tryA(`fs.doc('onbMeta/moved').set({ on: false, at: firebase.firestore.FieldValue.serverTimestamp() })`) === 'ok', 'Dr. A marks Onboarding moved, and back');
// turned off → refused
await E.fsSet('nlo-cases', 'members/' + E.STAFF[0].uid, { active: false }, ['active']);
ok(/permission/.test(await tryG(`o.ref('nlo/onboarding/people/s_nora/progress/core-welcome/l-ack1/done').set(7)`)) && /permission/.test(await tryG(`d.ref('nlo/calendar/adminDays/2026-11-07').set('admin')`)), 'a login turned off can’t write either app');
await E.fsSet('nlo-cases', 'members/' + E.STAFF[0].uid, { active: true }, ['active']);

/* ---------- what the Staff Meeting Hub reads of the two apps: the old database until each moves, then the records ---------- */
console.log('the Hub’s view of the calendar and Onboarding');
{
  const r = await p.evaluate(async () => {
    NLOM.init();   // the Hub's layer: the same NLO Cases app (Dr. A's session) under the hood
    const hub = NLOM.db(NLOM.fs, () => 'amir', () => rt);   // a Hub screen with the office Google sign-in too
    const hubNoRt = NLOM.db(NLOM.fs, () => 'amir', null);                             // one without it
    await NLOM.fs.doc('calEvents/onlyNew').set({ type: 'event', title: 'Only on the NLO Cases side', startDate: '2026-11-20', endDate: '2026-11-20', _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'amir' });
    const before = (await hub.ref('nlo/calendar/events').once('value')).val();
    const beforeNoRt = (await hubNoRt.ref('nlo/calendar/events').once('value')).val();
    const beforeOnb = (await hubNoRt.ref('nlo/onboarding/people').once('value')).val();
    const beforeOnbRt = (await hub.ref('nlo/onboarding/people').once('value')).val();
    await NLOM.fs.doc('calMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp() });
    const after = (await hub.ref('nlo/calendar/events').once('value')).val();
    const afterNoRt = (await hubNoRt.ref('nlo/calendar/events').once('value')).val();
    const settings = (await hubNoRt.ref('nlo/calendar/settings').once('value')).val();
    await NLOM.fs.doc('onbMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp() });
    const afterOnb = (await hubNoRt.ref('nlo/onboarding/people').once('value')).val();
    const mods = (await hubNoRt.ref('nlo/onboarding/catalog/modules').once('value')).val();
    const roster = (await hubNoRt.ref('nlo/cadence/roster/people').once('value')).val();
    await NLOM.fs.doc('calMeta/moved').set({ on: false, at: firebase.firestore.FieldValue.serverTimestamp() });
    await NLOM.fs.doc('onbMeta/moved').set({ on: false, at: firebase.firestore.FieldValue.serverTimestamp() });
    await NLOM.fs.doc('calEvents/onlyNew').delete();
    return { before: before && !before.onlyNew && Object.keys(before).length === 4, beforeNoRt, beforeOnb, beforeOnbRt: beforeOnbRt && !!beforeOnbRt.s_nora, after: after && !!after.onlyNew, afterNoRt: afterNoRt && !!afterNoRt.onlyNew, settings: settings && settings.closures && Object.keys(settings.closures).length >= 1 && settings.adminPin === '2468', afterOnb: afterOnb && !!afterOnb.s_nora, mods: mods && Object.keys(mods).length === 2, roster: roster && roster.s_gwen && roster.s_gwen.name === 'Gwen Rodis' };
  });
  ok(r.before && r.beforeOnbRt, 'before the moves, a Hub screen with the office Google sign-in reads both apps from the old database');
  ok(r.beforeNoRt === null && r.beforeOnb === null, '…one without it reads nothing of them (no error)');
  ok(r.after && r.afterNoRt && r.settings, 'once the calendar has moved, every Hub screen reads its records on the NLO Cases system' + (r.after && r.afterNoRt && r.settings ? '' : ' ' + JSON.stringify([r.after, r.afterNoRt, r.settings])));
  ok(r.afterOnb && r.mods, 'once Onboarding has moved, likewise');
  ok(r.roster, 'the Hub reads Staff Hub’s roster from the NLO Cases system');
}
// Staff Hub's roster: the Hub falls back to Cadence's copy when Staff Hub hasn't put its own there
{
  ok(await p.evaluate(async () => { try { await NLOM.fs.doc('hubRoster/live').delete(); return false; } catch (e) { return /permission/.test(e.code); } }), 'Staff Hub’s roster record can’t be deleted (even by Dr. A)');
  await fetch(`${E.FS}/v1/projects/nlo-cases/databases/(default)/documents/hubRoster/live`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  const r = await p.evaluate(async () => {
    await NLOM.fs.doc('cadMirror/roster').set({ people: [{ id: 's_kaylee', name: 'Kaylee Doty' }], up: firebase.firestore.FieldValue.serverTimestamp(), upBy: 'amir' });
    const hub = NLOM.db(NLOM.fs, () => 'amir', null);
    const v = (await hub.ref('nlo/cadence/roster/people').once('value')).val();
    return v;
  });
  ok(Array.isArray(r) && r[0] && r[0].name === 'Kaylee Doty', 'without Staff Hub’s record, the Hub reads Cadence’s roster copy');
  await E.fsSet('nlo-cases', 'hubRoster/live', E.ROSTER);
}

/* ---------- a screen on the old database during a move: the right words for each app ---------- */
console.log('a screen during a move');
{
  const W = await device();
  const pw = W.page;
  await pw.evaluate(async ([email, pwd]) => {
    firebase.initializeApp({ apiKey: 'x', databaseURL: 'https://nlo-inventory-default-rtdb.firebaseio.com', projectId: 'nlo-inventory' });
    window.rt = firebase.database();
    await NLOC.signIn(email, pwd);
    window.clears = 0;
    NLOC.watchOldDb(rt, () => false, () => { window.clears++; });
  }, [E.OWNER.email, E.PW]);
  await pw.waitForFunction(() => window.clears >= 1, null, { timeout: 10000 }).catch(() => { });
  await pw.evaluate(() => rt.ref('nlo/calendar/moving').set({ at: firebase.database.ServerValue.TIMESTAMP, by: 'test', token: 't1' }));
  await pw.waitForSelector('#nlomOverlay', { timeout: 10000 }).catch(() => { });
  ok(/moving the Office Calendar to the NLO Cases system/.test(await pw.textContent('#nlomOverlay').catch(() => '')), 'a calendar move under way: its screens pause, naming the calendar');
  const c0 = await pw.evaluate(() => window.clears);
  await pw.evaluate(() => rt.ref('nlo/calendar/moving').remove());
  await pw.waitForFunction(c => window.clears > c && !document.getElementById('nlomOverlay'), c0, { timeout: 20000 }).catch(() => { });
  ok(await pw.evaluate(c => window.clears > c && !document.getElementById('nlomOverlay'), c0), 'the pause ends and the NLO Cases database says not moved: it carries on');
  await pw.evaluate(() => rt.ref('nlo/calendar/moving').set({ at: firebase.database.ServerValue.TIMESTAMP, by: 'test', token: 't2' }));
  await pw.waitForSelector('#nlomOverlay', { timeout: 10000 }).catch(() => { });
  await pw.evaluate(() => NLOC.fs.doc('calMeta/moved').set({ on: true, at: firebase.firestore.FieldValue.serverTimestamp() }));
  const reloaded = pw.waitForNavigation({ timeout: 20000 }).then(() => true, () => false);
  await pw.evaluate(() => rt.ref('nlo/calendar/moving').remove());
  ok(await reloaded, 'the pause ends and the NLO Cases database says moved: it switches over');
  ok(await pw.evaluate(() => localStorage.getItem('nloCal.fs')) === '1' && await pw.evaluate(() => localStorage.getItem('nloOnb.fs')) !== '1', '…and remembers that for its next load, for the calendar only');
  await E.fsSet('nlo-cases', 'calMeta/moved', { on: false, at: new Date() });
  await W.ctx.close();
}

await G.ctx.close();
await A.ctx.close();
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
