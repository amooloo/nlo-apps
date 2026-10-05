// The IPR Tracker's chart kept on the case, and every patient synced at once (Amir, 5 Oct 2026: "when you sync the IPR tracker, the
// graph doesn't stay. this should not be the case, In fact, can it be synced for all the pt. at once instead of individual basis?").
// Demo, made-up patients and a made-up IPR Tracker.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  await ctx.addInitScript(() => { try { localStorage.removeItem('nloCases.iprSyncAt'); } catch (e) { } });
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const snap = id => p.evaluate(id => { const c = findCase(id); return c && c.iprSnap ? { visits: c.iprSnap.visits, date: c.iprSnap.date, chart: c.iprSnap.chart, h: c.iprSnap.h, by: c.iprSnap.by } : null; }, id);

  console.log('\n# Every patient at once, by itself once the link is on');
  const ref = await p.evaluate(() => openCases().find(c => c.chart === '15-1001').id);
  await p.waitForFunction(id => !!(findCase(id) || {}).iprSnap, ref, { timeout: 8000 }).catch(() => {});
  const s1 = await snap(ref);
  check(s1 && s1.visits === 2 && s1.chart === '151001' && s1.by === 'amir', 'after signing in, the open aligner cases with a chart # get their IPR chart kept on the case (' + JSON.stringify(s1) + ')');
  check(!(await p.isVisible('.toast:has-text("IPR Tracker synced")')), 'quietly (no message for the sync that runs by itself)');
  // another case gets a chart # — synced without ever opening it
  const other = await p.evaluate(() => { const c = openCases().find(x => x.type === 'oliv' && !x.chart); c.chart = '15-2002'; DEMO.cases.get(c.id).chart = '15-2002'; return c.id; });
  await p.click('#nav-account'); await p.waitForSelector('[data-act=iprSyncAll]');
  check(/Every open aligner case with a chart # gets its latest IPR chart/.test(await p.textContent('#view')), 'My account: the IPR link says what it does');
  await p.click('[data-act=iprSyncAll]');
  await p.waitForSelector('.toast:has-text("IPR Tracker synced: 2 patients · 1 chart updated")', { timeout: 8000 }).catch(() => {});
  check(await p.isVisible('.toast:has-text("IPR Tracker synced: 2 patients · 1 chart updated")') && (await snap(other) || {}).visits === 2, 'Sync all patients now: both patients read, the new one kept (the first was already up to date)');
  check(/last synced from this computer/.test(await p.textContent('#view')), 'and it says when this computer last synced');
  const h0 = (await snap(ref)).h, rev0 = await p.evaluate(id => findCase(id).rev, ref);
  await p.click('[data-act=iprSyncAll]'); await p.waitForTimeout(600);
  check((await snap(ref)).h === h0 && await p.evaluate(id => findCase(id).rev, ref) === rev0, 'nothing new: nothing saved again');

  console.log('\n# The chart stays when the link is off');
  await p.evaluate(() => { IPR_DEMO._user = IPR_DEMO.user; IPR_DEMO.user = () => null; S.iprCache = {}; });
  await p.evaluate(id => openDrawer(id), ref); await p.waitForSelector('#drawer .ds[data-ds=ipr]');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=ipr]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=ipr] .dsTg');
  await p.waitForSelector('#iprBox .iprP svg', { timeout: 4000 }).catch(() => {});
  const box = await p.evaluate(() => ({ panels: Array.from(document.querySelectorAll('#iprBox .iprP')).map(x => x.dataset.p).join(','), meta: document.querySelector('#iprBox .iprMeta').textContent,
    btns: Array.from(document.querySelectorAll('#iprBox .iprFoot button, #iprBox .iprFoot a')).map(b => b.textContent.trim()), sum: document.querySelector('#dsS-ipr').textContent }));
  check(box.panels === 'visit,cum,space' && /2 visits on file · synced \w{3} \d+, /.test(box.meta), 'not connected: the chart still shows, from the case, with when it was synced (' + box.meta + ')');
  check(box.btns.includes('Connect to refresh') && !box.btns.includes('Sync all patients'), 'and offers Connect to refresh (' + box.btns.join(' | ') + ')');
  check(/visit · IPR 0\.3 mm/.test(box.sum), 'the folded heading sums it up too (' + box.sum + ')');
  await p.screenshot({ path: OUT + '/v49-kept.png', clip: { x: 800, y: 0, width: 560, height: 950 } });
  await p.click('#iprBox [data-act=iprUse]');
  await p.waitForFunction(id => /IPR THIS VISIT/.test(findCase(id).ipr || ''), ref, { timeout: 4000 }).catch(() => {});
  check(/IPR THIS VISIT/.test(await p.evaluate(id => findCase(id).ipr || '', ref)), '“Add to the chart note” works from the kept chart');
  // a completed case keeps showing it, without the buttons
  await p.evaluate(id => { const c = findCase(id); c.status = 'done'; }, ref); await p.evaluate(() => renderDrawer()); await p.waitForTimeout(100);
  const done = await p.evaluate(() => ({ panels: document.querySelectorAll('#iprBox .iprP').length, btns: document.querySelectorAll('#iprBox .iprFoot button').length }));
  check(done.panels === 3 && done.btns === 0, 'a completed case still shows its IPR chart (no buttons)');
  await p.evaluate(id => { findCase(id).status = 'open'; IPR_DEMO.user = IPR_DEMO._user; }, ref);

  console.log('\n# Connected: live, and the button to sync everyone');
  await p.evaluate(() => closeDrawer()); await p.evaluate(id => openDrawer(id), ref); await p.waitForSelector('#drawer .ds[data-ds=ipr]');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=ipr]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=ipr] .dsTg');
  await p.waitForSelector('#iprBox [data-act=iprSyncAll]', { timeout: 4000 }).catch(() => {});
  check(await p.isVisible('#iprBox [data-act=iprSyncAll]') && await p.isVisible('#iprBox [data-act=iprRefresh]') && !(await p.isVisible('#iprBox .iprSync')), 'connected: the live reading, with Refresh and Sync all patients');
  // a chart # changed: the kept chart (for the old one) isn't shown for the new one
  await p.evaluate(() => { IPR_DEMO.user = () => null; S.iprCache = {}; });
  await p.evaluate(id => { const c = findCase(id); c.chart = '99-9999'; renderDrawer(); }, ref); await p.waitForTimeout(100);
  check(!(await p.$('#iprBox .iprP')), 'a different chart # on the case: the chart kept for the old one isn’t shown');
  await p.evaluate(id => { findCase(id).chart = '15-1001'; IPR_DEMO.user = IPR_DEMO._user; }, ref);

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
