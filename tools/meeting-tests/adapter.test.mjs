// The Staff Meeting Hub's old-database calls on the NLO Cases database (nlo-meeting-db.js): every step below is done to the
// old database (Realtime Database emulator) and through the new layer (Firestore emulator, the real rules), and what each
// path reads back must be the same. Plus what the rules let each login do. A made-up office; nothing live.
// node adapter.test.mjs   (emulators running: auth 9099, firestore 8080, database 9000; the repo served on 127.0.0.1:8766)
import fs from 'node:fs';
import * as E from '../staff-hub-tests/seed.mjs';
const { chromium } = await import('playwright');

const BASE = process.env.MTG_BASE || 'http://127.0.0.1:8766/';
const SDK = new URL('./node_modules/firebase/', import.meta.url).pathname;
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(p => fs.existsSync(p));
const RTNS = 'nlo-inventory-default-rtdb';
let pass = 0, fail = 0; const fails = [];
function ok(c, what) { if (c) { pass++; console.log('  ok  ' + what); } else { fail++; fails.push(what); console.log('  FAIL ' + what); } }

import { WIRE } from './wire.mjs';

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
async function device() {
  const ctx = await browser.newContext();
  await ctx.addInitScript(WIRE);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return route.continue();
    const m = /gstatic\.com\/firebasejs\/10\.12\.\d+\/(firebase-[a-z-]+\.js)/.exec(u);
    if (m) return route.fulfill({ path: SDK + m[1], contentType: 'text/javascript' });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  PAGEERROR', String(e).slice(0, 300)));
  await page.goto(BASE + 'tools/meeting-tests/blank.html');
  await page.waitForFunction(() => !!window.NLOM);
  return { ctx, page };
}

console.log('setup');
await E.loadRules();
await E.seedOffice();
await E.j(`http://127.0.0.1:9000/.settings/rules.json?ns=${RTNS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ rules: { '.read': true, '.write': true } }) });
await E.j(`http://127.0.0.1:9000/.json?ns=${RTNS}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });

const A = await device();
const p = A.page;
await p.evaluate(async ([email, pw]) => {
  firebase.initializeApp({ apiKey: 'x', databaseURL: 'https://nlo-inventory-default-rtdb.firebaseio.com', projectId: 'nlo-inventory' });
  window.rt = firebase.database();
  await NLOM.signIn(email, pw);
  window.fsdb = NLOM.db(NLOM.fs, () => NLOM.me.sid, null);
}, [E.OWNER.email, E.PW]);
ok(await p.evaluate(() => !!NLOM.me && NLOM.me.role === 'owner' && NLOM.me.sid === 'amir'), 'Dr. A signs in with the NLO Cases login');

/* the same steps on both; then every place read back from both must be the same */
const P = (...a) => ['nlo/staffMeeting'].concat(a).join('/');
const STEPS = [
  ['an inbox item', `d.ref('${P('inbox', 'k1')}').set({ text: 'Charts are late', cat: 'issue', auto: true, personId: 's_gwen', name: 'Gwen Rodis', via: 'quick-note', status: 'open', star: false, parked: 0, createdAt: 1, trail: {} })`],
  ['a multi-path update across records', `d.ref().update({ '${P('inbox', 'k1', 'status')}': 'closed', '${P('inbox', 'k1', 'outcome')}': { type: 'action', meetingId: '2026-11-05', at: 2 }, '${P('actionItems', 'a1')}': { text: 'Fix charts', ownerId: 's_gwen', owner: 'Gwen', status: 'open', due: '2026-11-12', carried: 0, reviews: { m20261105: { at: 3 } } } })`],
  ['a field removed (null)', `d.ref().update({ '${P('inbox', 'k1', 'outcome')}': null, '${P('actionItems', 'a1', 'reviews', 'm20261105')}': null })`],
  ['a meeting and the current meeting', `d.ref().update({ '${P('meetings', '2026-11-05', 'meta')}': { date: '2026-11-05', title: 'Monthly Staff Meeting', status: 'collecting', createdAt: 4 }, '${P('currentMeetingId')}': '2026-11-05' })`],
  ['a deep field set', `d.ref('${P('meetings', '2026-11-05', 'run', 'attendance', 's_gwen')}').set(false)`],
  ['a deep field set (true)', `d.ref('${P('meetings', '2026-11-05', 'run', 'attendance', 's_kaylee')}').set(true)`],
  ['the run pointer', `d.ref('${P('meetings', '2026-11-05', 'run', 'cur')}').set('i:k1')`],
  ['a transcript (its own record)', `d.ref('${P('meetings', '2026-11-05', 'transcript')}').set({ text: 'Long transcript…', savedAt: 5 })`],
  ['the transcript analyzed', `d.ref('${P('meetings', '2026-11-05', 'transcript')}').update({ analysis: { decisions: [{ text: 'Do it', raisedBy: 'Dr. A' }], actionItems: [] }, analyzedAt: 6, model: 'g' })`],
  ['applied, deeper in the transcript', `d.ref().update({ '${P('meetings', '2026-11-05', 'transcript', 'applied')}': { at: 7, decisions: 1, actions: 0, questions: 0 }, '${P('decisions', 'd1')}': { text: 'Do it', meetingId: '2026-11-05', date: '2026-11-05' } })`],
  ['old pasted notes', `d.ref('${P('meetings', '2026-10-01', 'lastNotes')}').set({ text: 'old notes', analysis: '## Summary' })`],
  ['an older meeting', `d.ref('${P('meetings', '2026-10-01', 'meta')}').set({ date: '2026-10-01', status: 'done' })`],
  ['lists, a list in a list, empty things', `d.ref('${P('kpiDefs', 'kp1')}').set({ role: 'TC', label: 'Starts', goal: '20', goalNum: 20, enabled: true, order: 1, vals: [1, 2, 3], grid: [[1, 2], [3]], none: {}, gone: null })`],
  ['an update on a record', `d.ref('${P('kpiDefs', 'kp1')}').update({ goal: '25', goalNum: 25, 'deep/x': 1 })`],
  ['an empty object removes', `d.ref('${P('config', 'sources')}').set({})`],
  ['config', `d.ref('${P('config')}').update({ endpoint: 'https://aisa/ask', sources: { cadence: true, spend: false }, aisa: { on: true } })`],
  ['a record removed', `d.ref('${P('decisions', 'd1')}').remove()`],
  ['a whole meeting set (its texts apart)', `d.ref('${P('meetings', '2026-09-01')}').set({ meta: { date: '2026-09-01', status: 'done' }, transcript: { text: 'sept' }, kpis: { kp1: 18 } })`],
  ['a whole meeting removed', `d.ref('${P('meetings', '2026-09-01')}').remove()`],
  ['Month-End: a month', `d.ref('${P('monthEnd', 'months', '2026-10')}').set({ np: 12, starts: { ft: 3 }, final: { at: 8, id: 's_sarah', name: 'Sarah' }, totals: { np: 12, conv: 41.7 } })`],
  ['Month-End: a year goal', `d.ref('${P('monthEnd', 'years', '2026', 'goal_np')}').set(100)`],
  ['Month-End: setup list', `d.ref('${P('monthEnd', 'config', 'tcs')}').set([{ id: 's_wila', name: 'Wila' }])`],
  ['Month-End: reopened (field removed)', `d.ref('${P('monthEnd', 'months', '2026-10', 'final')}').remove()`],
  ['the shared AISA key (Dr. A)', `d.ref('nlo/settings/aisaAdminKey').set('aisa-123')`],
  ['legacy roster', `d.ref('${P('roster')}').set({ r1: { name: 'Gwen Rodis', role: 'OA' } })`],
  ['numbers and text edge values', `d.ref('${P('inbox', 'k2')}').set({ text: '', zero: 0, neg: -1.5, f: false, big: 1700000000000, s: 'a.b#c' })`],
];
const PLACES = [P('inbox'), P('actionItems'), P('decisions'), P('kpiDefs'), P('meetings'), P('config'), P('currentMeetingId'), P('roster'),
  P('monthEnd', 'months'), P('monthEnd', 'years'), P('monthEnd', 'config'), 'nlo/settings/aisaAdminKey',
  P('meetings', '2026-11-05'), P('meetings', '2026-11-05', 'transcript'), P('meetings', '2026-11-05', 'run'), P('inbox', 'k1'), P('kpiDefs', 'kp1', 'grid')];
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x);
for (const [what, code] of STEPS) {
  const r = await p.evaluate(async code => {
    const run = async d => { await (new Function('d', 'return ' + code))(d); };
    try { await run(rt); } catch (e) { return { err: 'old: ' + e.message }; }
    try { await run(fsdb); } catch (e) { return { err: 'new: ' + (e.code || '') + ' ' + e.message }; }
    return {};
  }, code);
  if (r.err) { ok(false, what + ' — ' + r.err); continue; }
  const diff = await p.evaluate(async ([places]) => {
    const out = [];
    for (const pl of places) {
      const a = (await rt.ref(pl).once('value')).val(), b = (await fsdb.ref(pl).once('value')).val();
      const c = x => JSON.stringify(x, (k, y) => y && typeof y === 'object' && !Array.isArray(y) ? Object.keys(y).sort().reduce((o, kk) => (o[kk] = y[kk], o), {}) : y);
      if (c(a) !== c(b)) out.push(pl + ': old ' + c(a).slice(0, 300) + ' | new ' + c(b).slice(0, 300));
    }
    return out;
  }, [PLACES]);
  ok(!diff.length, what + (diff.length ? '\n      ' + diff.join('\n      ') : ''));
}

// a listener sees the same as a read, and hears a change made elsewhere
{
  const r = await p.evaluate(async P1 => {
    let last = null, n = 0;
    fsdb.ref(P1).on('value', s => { last = s.val(); n++; });
    await new Promise(r => setTimeout(r, 400));
    await fsdb.ref(P1 + '/k3').set({ text: 'heard', status: 'open' });
    await new Promise(r => setTimeout(r, 400));
    const got = last && last.k3 && last.k3.text;
    fsdb.ref(P1).off();
    await fsdb.ref(P1 + '/k3').remove();
    await new Promise(r => setTimeout(r, 300));
    return { got, n, after: last && !!last.k3 };
  }, P('inbox'));
  ok(r.got === 'heard' && r.n >= 2, 'a listener hears changes');
  ok(r.after === true, 'off() stops it (it didn’t hear the removal)');
}
// a meeting listener includes its texts and hears them change
{
  const r = await p.evaluate(async P1 => {
    let last = null;
    fsdb.ref(P1).on('value', s => { last = s.val(); });
    await new Promise(r => setTimeout(r, 400));
    const t1 = last && last.transcript && last.transcript.text;
    await fsdb.ref(P1 + '/transcript/text').set('changed');
    await new Promise(r => setTimeout(r, 400));
    const t2 = last && last.transcript && last.transcript.text;
    fsdb.ref(P1).off();
    return { t1, t2 };
  }, P('meetings', '2026-11-05'));
  ok(r.t1 === 'Long transcript…' && r.t2 === 'changed', 'a meeting’s listener includes its transcript and hears it change');
}
// transaction: the migration claim (first claims, second doesn't)
{
  const r = await p.evaluate(async P1 => {
    const a = await fsdb.ref(P1).transaction(cur => cur ? undefined : { at: 1, by: 'x' });
    const b = await fsdb.ref(P1).transaction(cur => cur ? undefined : { at: 2, by: 'y' });
    return { a: a.committed, b: b.committed, v: (await fsdb.ref(P1).once('value')).val() };
  }, P('config', 'migratedV2'));
  ok(r.a === true && r.b === false && r.v && r.v.by === 'x', 'a transaction claims once (the migration claim)');
}
// push keys sort by time, as the old database's
ok(await p.evaluate(() => { const a = NLOM.pushKey(), b = NLOM.pushKey(); return a.length === 20 && b > a; }), 'push keys: 20 characters, in time order');
// a whole list can't be replaced; an ancestor and its child in one update are refused (as the old database)
ok(await p.evaluate(async P1 => { try { await fsdb.ref(P1).set(null); return false; } catch (e) { return true; } }, P('inbox')), 'a whole list can’t be replaced at once');
ok(await p.evaluate(async ([a, b]) => { try { await fsdb.ref().update({ [a]: { x: 1 }, [b]: 2 }); return false; } catch (e) { return /ancestor/.test(e.message); } }, [P('inbox', 'k9'), P('inbox', 'k9', 'y')]), 'an ancestor and its child in one update are refused');
// read-only places
ok(await p.evaluate(async () => { try { await fsdb.ref('nlo/settings/geminiKey').set('x'); return false; } catch (e) { return true; } }), 'the office AI key is read-only here');
// stamps: every record carries who and when; reads leave them out
{
  const r = await p.evaluate(async () => { const d = await NLOM.fs.doc('mtgInbox/k1').get(); const v = (await fsdb.ref('nlo/staffMeeting/inbox/k1').once('value')).val(); return { by: d.data()._by, up: !!d.data()._up, leak: '_by' in v || '_up' in v }; });
  ok(r.by === 'amir' && r.up && !r.leak, 'records are stamped with the NLO Cases staff id and time; reads leave the stamps out');
}

/* ---------- the rules ---------- */
console.log('rules');
// a staff login: uses everything but the AISA key
const G = await device();
await G.page.evaluate(async ([email, pw]) => { await NLOM.signIn(email, pw); window.fsdb = NLOM.db(NLOM.fs, () => NLOM.me.sid, null); }, ['gwen', E.PW]);
ok(await G.page.evaluate(() => NLOM.me && NLOM.me.role === 'staff' && NLOM.me.sid === 'gwen'), 'a staff login signs in (by username)');
const tryG = code => G.page.evaluate(async code => { try { await (new Function('d', 'fs', 'return ' + code))(fsdb, NLOM.fs); return 'ok'; } catch (e) { return String(e.code || e.message); } }, code);
ok(await tryG(`d.ref('nlo/staffMeeting/inbox/g1').set({ text: 'from Gwen', status: 'open' })`) === 'ok', 'staff: adds to the inbox');
ok(await tryG(`d.ref('nlo/staffMeeting/actionItems/a1/status').set('done')`) === 'ok', 'staff: marks an action item done');
ok(await tryG(`d.ref('nlo/staffMeeting/monthEnd/months/2026-10/np').set(13)`) === 'ok', 'staff: enters Month-End numbers');
ok(await tryG(`d.ref('nlo/staffMeeting/meetings/2026-11-05/run/attendance/s_sarah').set(true)`) === 'ok', 'staff: runs the meeting');
ok(await tryG(`d.ref('nlo/staffMeeting/config/endpoint').set('https://x/ask')`) === 'ok', 'staff: changes settings (as before the move)');
ok(/permission/.test(await tryG(`d.ref('nlo/settings/aisaAdminKey').set('mine')`)), 'staff: can’t change the shared AISA key');
ok(await G.page.evaluate(async () => (await fsdb.ref('nlo/settings/aisaAdminKey').once('value')).val()) === 'aisa-123', 'staff: reads the shared AISA key');
ok(/permission/.test(await tryG(`fs.doc('mtgInbox/g2').set({ text: 'x', _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'amir' })`)), 'a record stamped with someone else’s id is refused');
ok(/permission/.test(await tryG(`fs.doc('mtgInbox/g3').set({ text: 'x', _up: 5, _by: 'gwen' })`)), 'a record stamped with a made-up time is refused');
ok(/permission/.test(await tryG(`fs.doc('mtgInbox/g4').set({ text: 'x' })`)), 'an unstamped record is refused');
ok(/permission/.test(await tryG(`fs.doc('mtgState/other').set({ x: 1, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'gwen' })`)), 'no other single records');
ok(/permission/.test(await tryG(`fs.doc('mtgInbox/bad.id').set({ x: 1, _up: firebase.firestore.FieldValue.serverTimestamp(), _by: 'gwen' })`)), 'odd record ids are refused');
ok(/permission/.test(await tryG(`fs.doc('mtgMeta/moved').set({ on: false, at: firebase.firestore.FieldValue.serverTimestamp() })`)), 'staff: can’t say where the data is');
ok(/permission/.test(await tryG(`fs.doc('meState/config').delete()`)), 'Month-End’s setup can’t be deleted');
ok(await G.page.evaluate(async () => { try { await NLOM.fs.doc('mtgMeta/moved').get(); return true; } catch (e) { return false; } }), 'anyone signed in reads where the data is');
// turned off → refused; not signed in → only mtgMeta/moved
await E.fsSet('nlo-cases', 'members/' + E.STAFF[0].uid, { active: false }, ['active']);
ok(/permission/.test(await tryG(`d.ref('nlo/staffMeeting/inbox/g5').set({ text: 'after off' })`)), 'a login turned off can’t write');
ok(/permission/.test(await G.page.evaluate(async () => { try { await NLOM.fs.collection('mtgInbox').get(); return 'ok'; } catch (e) { return String(e.code); } })), '…or read');
await E.fsSet('nlo-cases', 'members/' + E.STAFF[0].uid, { active: true }, ['active']);
const N = await device();
ok(/permission/.test(await N.page.evaluate(async () => { NLOM.init(); try { await NLOM.fs.collection('mtgInbox').get(); return 'ok'; } catch (e) { return String(e.code); } })), 'not signed in: nothing readable');
ok(await N.page.evaluate(async () => { NLOM.init(); try { await NLOM.fs.doc('mtgMeta/moved').get(); return true; } catch (e) { return String(e.code); } }) === true, 'not signed in: where the data is, only');
ok(await N.page.evaluate(async () => (await NLOM.moved()).mode) === 'rtdb', 'before the move: the pages use the old database');

/* ---------- the move's record making: old values → records → read back the same ---------- */
console.log('records');
{
  const r = await p.evaluate(async () => {
    const old = await NLOM.readOld(rt);
    const recs = NLOM.recordsOf(old);
    const res = await NLOM.writeRecords(NLOM.fs, NLOM.me.sid, recs);
    const back = await NLOM.readNew(NLOM.fs);
    const diffs = Object.keys(old).filter(k => NLOM.fpr(old[k]) !== NLOM.fpr(back[k]));
    return { n: recs.length, res, diffs, counts: NLOM.counts(old), bad: NLOM.badIds(recs) };
  });
  ok(!r.res.missing.length && !r.res.differ.length && !r.res.left.length, 'the old data written as records reads back the same (' + r.n + ' records; ' + JSON.stringify(r.res).slice(0, 200) + ')');
  ok(!r.diffs.length, 'every old place reads back the same through the new layer' + (r.diffs.length ? ': ' + r.diffs.join(', ') : ''));
  ok(!r.bad.length, 'every record id is one the rules take');
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
