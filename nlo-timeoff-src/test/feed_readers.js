/* The office calendar (nlo-calendar.html) and CADANCe (cadence.html) reading NLO Time Off's sealed feed, against a
   stand-in Firebase (test/fake-firebase.js) and a feed sealed exactly as NLO Time Off seals it. Made-up people only.
   Needs a static server on :8772 serving the repo root (python3 -m http.server 8772 --directory ..). Run: node test/feed_readers.js */
process.env.TZ = 'America/New_York';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { CHROME } = require('./helpers');
const { load } = require('./load');
const A = load(['core.js']);
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const BASE = 'http://127.0.0.1:8772/';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ok  ' : '  FAIL ') + m); };
const OLD_API = 'https://script.google.com/macros/s/AKfycbxvI_d6muf_OepqurNrxnV2O0bMaGjnyNH6SKKNqQcvXMzjN6ZBjc26aa5LkN3Grj2J/exec';
const FEED = 'https://firestore.googleapis.com/v1/projects/nlo-cases/databases/(default)/documents/toFeed/live';
const pad = n => String(n).padStart(2, '0'), iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const nextWd = (from, wd) => { const d = new Date(from); d.setDate(d.getDate() + 1); while (d.getDay() !== wd) d.setDate(d.getDate() + 1); return d; };
const mon = nextWd(new Date(), 1), tue = new Date(mon), wed = new Date(mon), thu = new Date(mon); tue.setDate(mon.getDate() + 1); wed.setDate(mon.getDate() + 2); thu.setDate(mon.getDate() + 3);
const D = { mon: iso(mon), tue: iso(tue), wed: iso(wed), thu: iso(thu) };
// what the old app sends, and what NLO Time Off's feed holds (made-up people)
const oldFeed = { ok: true, timeOff: [{ id: 'old1', employeeName: 'Riley Tester', start: D.thu, end: D.thu, hours: 'Full Day', requestType: 'Vacation', paidType: 'Paid' }], holidays: [] };
const newFeed = { v: 1, ok: true, pending: 2, syncedAt: new Date().toISOString(), holidays: [{ date: D.tue, label: 'Office closed (test)', source: 'custom' }],
  timeOff: [{ id: 'q' + 'a'.repeat(24), sid: 'riley', rid: '', employeeName: 'Riley Tester', start: D.mon, end: D.mon, hours: 'Full Day', part: 'full' },
    { id: 'q' + 'b'.repeat(24), sid: 'sam', rid: '', employeeName: 'Sam Tester', start: D.wed, end: D.wed, hours: 'Morning (AM)', part: 'am' },
    { id: 'q' + 'c'.repeat(24), sid: 'zed', rid: '', employeeName: 'Nobody Known', start: D.wed, end: D.wed, hours: 'Full Day', part: 'full' }] };
(async () => {
  const keyB64 = A.b64(crypto.getRandomValues(new Uint8Array(32))), key = await A.Crypto.rawKey(keyB64);
  const box = await A.Crypto.sealJSON(key, newFeed, 'tofeed');   // exactly as NLO Time Off writes it
  const feedDoc = { name: 'projects/nlo-cases/databases/(default)/documents/toFeed/live', fields: { iv: { stringValue: box.iv }, ct: { stringValue: box.ct }, at: { timestampValue: new Date().toISOString() } } };
  const wrongKey = A.b64(crypto.getRandomValues(new Uint8Array(32)));
  const browser = await chromium.launch({ executablePath: CHROME });
  const hits = { old: 0, feed: 0 }; let feedStatus = 200;
  async function newPage(store, user) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
    await ctx.route(u => !u.href.startsWith(BASE), async r => {
      const u = r.request().url();
      if (u.startsWith('https://www.gstatic.com/firebasejs/')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE });
      if (u.startsWith(OLD_API)) { hits.old++; return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(oldFeed) }); }
      if (u.startsWith(FEED)) { hits.feed++; return r.fulfill({ status: feedStatus, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(feedStatus === 200 ? feedDoc : { error: { code: feedStatus } }) }); }
      return r.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
    await page.addInitScript(([s, u]) => { window.__FAKE = { store: s, user: u }; }, [store, user]);
    return { ctx, page, errs };
  }
  const owner = { uid: 'u-owner', email: 'akhavan.ak@gmail.com', displayName: 'Dr Test' };

  /* ================= the office calendar ================= */
  console.log('# The office calendar');
  {
    let { ctx, page, errs } = await newPage({}, owner);
    await page.goto(BASE + 'nlo-calendar.html'); await page.waitForFunction(() => S.sync && S.sync.at, null, { timeout: 15000 });
    const e1 = await page.evaluate(d => entriesFor(d, true).filter(e => e.synced).map(e => e.staffName + '|' + e.notes), D.thu);
    ok(await page.evaluate(() => S.sync.src) === 'old' && hits.old >= 1 && hits.feed === 0 && e1.length === 1 && /Riley Tester/.test(e1[0]) && /Paid · Full Day/.test(e1[0]), 'no key yet: time off from the old app, as before (' + e1.join() + ')');
    await page.evaluate(() => { S.admin = true; S.settingsOpen = true; render(); });
    ok(/NLO Time Off feed key/.test(await page.textContent('body')) && /from the old Time-Off Request app/.test(await page.textContent('body')), 'Admin settings → Time-Off sync: a place for NLO Time Off’s feed key; it says the old app is the source');
    await page.fill('#to-feed-key', 'not-a-key'); await page.click('[data-act=to-feed-save]'); await page.waitForTimeout(300);
    ok(/That isn’t the key|That isn't the key/.test(await page.textContent('body')) && !(await page.evaluate(() => window.__FAKE.store.nlo && window.__FAKE.store.nlo.cadence)), 'something that isn’t a key: refused, nothing saved');
    await page.fill('#to-feed-key', wrongKey); await page.click('[data-act=to-feed-save]'); await page.waitForTimeout(600);
    ok(/Not saved: the saved key doesn’t open NLO Time Off’s feed|Not saved: the saved key doesn't open/.test(await page.textContent('body')) && !(await page.evaluate(() => window.__FAKE.store.nlo && window.__FAKE.store.nlo.cadence)), 'a key that doesn’t open the feed: refused, nothing saved');
    feedStatus = 404; await page.fill('#to-feed-key', keyB64); await page.click('[data-act=to-feed-save]'); await page.waitForTimeout(600);
    ok(/hasn’t written its feed yet|hasn't written its feed yet/.test(await page.textContent('body')) && !(await page.evaluate(() => window.__FAKE.store.nlo && window.__FAKE.store.nlo.cadence)), 'before NLO Time Off has written its feed: not saved, and it says why');
    feedStatus = 200; await page.fill('#to-feed-key', keyB64); await page.click('[data-act=to-feed-save]');
    await page.waitForFunction(() => S.sync && S.sync.src === 'timeoff', null, { timeout: 10000 });
    const cfg = await page.evaluate(() => window.__FAKE.store.nlo.cadence.timeOffFeed);
    ok(cfg && cfg.key === keyB64 && typeof cfg.at === 'number' && cfg.by === owner.email && Object.keys(cfg).sort().join() === 'at,by,key', 'the right key: saved at nlo/cadence/timeOffFeed (key, when, by whom) — ' + /Saved — 3 approved requests/.test(await page.textContent('body')));
    const m = await page.evaluate(d => entriesFor(d, true).filter(e => e.synced).map(e => e.staffName + '|' + e.notes + '|' + e.title), D.mon), w = await page.evaluate(d => entriesFor(d, true).filter(e => e.synced).map(e => e.staffName + '|' + e.notes), D.wed), th = await page.evaluate(d => entriesFor(d, true).filter(e => e.synced).length, D.thu);
    ok(m.length === 1 && /^Riley Tester\|Full Day\|PTO$/.test(m[0]) && w.some(x => x === 'Sam Tester|Morning (AM)') && th === 0, 'the calendar now shows NLO Time Off’s approved time off (never the kind of time off) and drops the old app’s: ' + m.concat(w).join(' / '));
    ok(await page.evaluate(d => !!(holidayMap()[d] && /Office closed/.test(holidayMap()[d].label)), D.tue), '…and NLO Time Off’s office closures');
    await page.evaluate(() => { S.settingsOpen = true; render(); });
    ok(/read NLO Time Off/.test(await page.textContent('body')) && /Go back to the old Time-Off app/.test(await page.textContent('body')), 'Settings says it reads NLO Time Off, with a way back');
    // opened again with the key saved: straight to NLO Time Off
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.store))); await ctx.close();
    ({ ctx, page, errs } = await newPage(saved, owner));
    const before = hits.old; await page.goto(BASE + 'nlo-calendar.html'); await page.waitForFunction(() => S.sync && S.sync.at, null, { timeout: 15000 });
    ok(await page.evaluate(() => S.sync.src) === 'timeoff' && hits.old === before, 'opened again: NLO Time Off, without asking the old app');
    // a blip reading the key keeps NLO Time Off
    await page.evaluate(() => { window.__FAKE.deny = (p, how) => p === 'nlo/cadence/timeOffFeed' && how === 'read'; }); await page.evaluate(() => syncTimeOff()); await page.waitForTimeout(400);
    ok(await page.evaluate(() => S.sync.src) === 'timeoff' && hits.old === before, 'if the key can’t be read for a moment, it stays on NLO Time Off');
    await page.evaluate(() => { window.__FAKE.deny = null; S.admin = true; S.settingsOpen = true; render(); });
    await page.click('[data-act=to-feed-clear]'); await page.waitForFunction(() => S.sync && S.sync.src === 'old', null, { timeout: 10000 });
    ok(!(await page.evaluate(() => window.__FAKE.store.nlo && window.__FAKE.store.nlo.cadence && window.__FAKE.store.nlo.cadence.timeOffFeed)), '“Go back to the old Time-Off app” removes the key: the old app again');
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  /* ================= CADANCe ================= */
  console.log('# CADANCe (the Checklist app)');
  {
    // first run: let it write its starting state, then give it two made-up people
    let { ctx, page, errs } = await newPage({}, owner);
    await page.goto(BASE + 'cadence.html'); await page.waitForFunction(() => window.__FAKE.store.nlo && window.__FAKE.store.nlo.cadence && window.__FAKE.store.nlo.cadence.state, null, { timeout: 20000 });
    const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.store.nlo.cadence.state)));
    await ctx.close();
    st.staff = [{ id: 's_riley', name: 'Riley Tester', status: 'active', roleId: (st.roles && st.roles[0] && st.roles[0].id) || '' }, { id: 's_sam', name: 'Sam Tester', status: 'active', roleId: (st.roles && st.roles[0] && st.roles[0].id) || '' }];
    st.timeOff = []; st.instances = [];
    const tof = s => (s.timeOff || []).filter(o => String(o.id).startsWith('tof_')).map(o => o.staffId + '@' + o.date + ':' + o.scope + ':' + o.id.split('_')[1]).sort();
    // without a key: the old app
    hits.old = 0; hits.feed = 0;
    ({ ctx, page, errs } = await newPage({ nlo: { cadence: { state: st } } }, owner));
    await page.goto(BASE + 'cadence.html');
    await page.waitForFunction(() => { const s = window.__FAKE.store.nlo.cadence.state; return s && (s.timeOff || []).some(o => String(o.id).startsWith('tof_')); }, null, { timeout: 20000 });
    const t1 = tof(await page.evaluate(() => window.__FAKE.store.nlo.cadence.state));
    ok(hits.old >= 1 && hits.feed === 0 && JSON.stringify(t1) === JSON.stringify(['s_riley@' + D.thu + ':full:old1']), 'no key: time off from the old app, as before (' + t1.join() + ')');
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
    const st2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.store.nlo.cadence.state)));
    await ctx.close();
    // with the key the calendar saved: NLO Time Off
    hits.old = 0; hits.feed = 0;
    ({ ctx, page, errs } = await newPage({ nlo: { cadence: { state: st2, timeOffFeed: { key: keyB64, at: Date.now(), by: owner.email } } } }, owner));
    await page.goto(BASE + 'cadence.html');
    await page.waitForFunction(() => { const s = window.__FAKE.store.nlo.cadence.state; return s && (s.timeOff || []).some(o => String(o.id).startsWith('tof_q')); }, null, { timeout: 20000 });
    const t2 = tof(await page.evaluate(() => window.__FAKE.store.nlo.cadence.state));
    ok(hits.feed >= 1 && hits.old === 0 && JSON.stringify(t2) === JSON.stringify(['s_riley@' + D.mon + ':full:q' + 'a'.repeat(24), 's_sam@' + D.wed + ':am:q' + 'b'.repeat(24)].sort()),
      'with the key: NLO Time Off’s approved time off (morning/afternoon kept), the old app’s gone, nobody unknown added (' + t2.join() + ')');
    ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
    // a feed it can't open (a new key made in NLO Time Off): what it has stays, and it never falls back to the old app
    await page.evaluate(() => { window.__FAKE.store.nlo.cadence.timeOffFeed.key = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(32)))); });
    const h0 = hits.feed; await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(1500);
    const t3 = tof(await page.evaluate(() => window.__FAKE.store.nlo.cadence.state));
    ok(hits.feed > h0 && hits.old === 0 && JSON.stringify(t3) === JSON.stringify(t2), 'a key that no longer opens the feed: CADANCe keeps what it has and doesn’t go back to the old app');
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
