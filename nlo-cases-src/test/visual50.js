// Workload (Amir, 5 Oct 2026: "can you give me a dashboard (maybe a separate tab) where I can monitor how much work each assistant is
// doing, how many cases, how many aligners, how long it takes for them on avg to enter a case for retainer and to make it....) what is
// their workload"). Demo: made-up patients and made-up history.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ready = () => p.waitForFunction(() => WK.log && !WK.busy && !document.querySelector('.wk.busy'), null, { timeout: 8000 }).catch(() => {});
  // what the page shows: the table's rows (by person) and the office row, and the tiles
  const shown = () => p.evaluate(() => {
    const row = tr => Object.fromEntries(Array.from(tr.querySelectorAll('td[data-c]')).map(td => [td.dataset.c, td.dataset.c === 'al' ? Number(td.firstChild.textContent) : /^(retLag|retMake)$/.test(td.dataset.c) ? td.textContent : Number(td.textContent.replace(/\D/g, '') || 0)]));
    const rows = {}; document.querySelectorAll('.wkTbl:not(.wkPlateTbl) tbody tr').forEach(tr => { rows[tr.dataset.k] = row(tr); });
    return { rows, all: row(document.querySelector('.wkTbl tfoot tr')), tiles: Object.fromEntries(Array.from(document.querySelectorAll('.wkT')).map(t => [t.dataset.t, t.querySelector('.n').textContent])) };
  });
  // the same numbers worked out here, straight from the demo's cases and history (an independent count of the rules on the page)
  const expect = days => p.evaluate(days => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - (days - 1)); const since = d0.getTime();
    const cs = new Map(Array.from(DEMO.cases.values()).map(c => [c.id, c])), out = {}, P = k => (out[k] = out[k] || { entered: 0, moved: 0, al: 0, sets: 0, retIn: 0, ret: 0, open: 0, late: 0 });
    cs.forEach(c => { if (c.createdAt >= since && !c.importedAt && c.createdBy) { P(c.createdBy).entered++; if (['retainer', 'mouthguard'].includes(c.type)) P(c.createdBy).retIn++; } });
    const ih = ['txp', 'txpok', 'fab', 'send', 'print', 'thermo', 'trim', 'polish', 'wash', 'pack', 'checkedin'], made = new Set();
    DEMO.logs.filter(l => l.at >= since).sort((a, b) => a.at - b.at).forEach(l => {
      const step = l.from && l.to && l.from !== l.to && (l.a === 'stage' || (l.a === 'edit' && (l.fields || []).includes('stage'))); if (!step) return;
      P(l.sid).moved++; const c = cs.get(l.caseId); if (!c || made.has(c.id)) return;
      if (c.type === 'nla' && ih.indexOf(l.to) >= 9 && ih.indexOf(l.from) < 9) { made.add(c.id); P(l.sid).sets++; P(l.sid).al += (Number(c.alU) || 0) + (Number(c.alL) || 0); }
      // (a retainer is made when it reaches Milestones, past To make and Printing — 6 Oct 2026)
      const rt = k => ['print', 'printing', 'milestones', 'pickup'].indexOf(k);
      if (['retainer', 'mouthguard'].includes(c.type) && rt(l.to) >= 2 && rt(l.from) < 2) { made.add(c.id); P(l.sid).ret++; }
    });
    openCases().forEach(c => { const x = P(c.assignee || ''); x.open++; if (dueBucket(c) === 'over') x.late++; });
    return out;
  }, days);
  const same = (got, want, keys) => keys.every(k => (got || {})[k] === ((want || {})[k] || 0));

  console.log('\n# The tab: Dr. A only');
  check(await p.isVisible('#nav-work') && (await p.textContent('#nav-work')).trim() === 'Workload', 'Dr. A has a Workload tab, under Office');
  await p.click('#nav-work'); await p.waitForSelector('.wkTbl'); await ready();
  check((await p.textContent('.topBar h2')) === 'Workload' && await p.isVisible('.wkDays .chip.on[data-d="30"]'), 'it opens on the last 30 days');

  console.log('\n# The numbers, by person (the last 30 days, and open cases now)');
  let s = await shown(), e = await expect(30);
  const keys = ['entered', 'moved', 'al', 'retIn', 'ret', 'open', 'late'];
  for (const k of ['sarah', 'angelika', 'gwen', 'kaylee', 'amir']) check(same(s.rows[k], e[k], keys), k + ': ' + keys.map(x => x + ' ' + (s.rows[k] || {})[x]).join(', ') + ' (worked out from the history: ' + keys.map(x => (e[k] || {})[x] || 0).join(', ') + ')');
  const sum = k => Object.values(s.rows).reduce((n, r) => n + (r[k] || 0), 0);
  check(keys.every(k => s.all[k] === sum(k)), 'the Office row adds up the people');
  check(Number(s.tiles.entered) === s.all.entered && Number(s.tiles.al) === s.all.al && Number(s.tiles.ret) === s.all.ret && Number(s.tiles.open) === s.all.open, 'the tiles say the same as the Office row (' + JSON.stringify(s.tiles) + ')');
  check(s.all.entered > 20 && s.all.moved > 50 && s.all.al > 0 && s.all.ret > 0, 'there is something to compare (entered ' + s.all.entered + ', moved ' + s.all.moved + ', aligners ' + s.all.al + ', retainers ' + s.all.ret + ')');
  check(/^(Same day|\d+(\.\d)? days?)$/.test(s.rows.gwen.retLag) && /^(Under 1 hour|\d+ hours?|\d+(\.\d)? days?)$/.test(s.rows.gwen.retMake), 'retainers: scan → entered (' + s.rows.gwen.retLag + ') and entered → made (' + s.rows.gwen.retMake + ') for each person');
  // the averages: worked out here from Gwen's retainers
  const g = await p.evaluate(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - 29); const since = d0.getTime(), day = iso => Math.round(isoDate(iso) / 864e5);
    const rc = Array.from(DEMO.cases.values()).filter(c => ['retainer', 'mouthguard'].includes(c.type));
    const lag = rc.filter(c => c.createdBy === 'gwen' && c.createdAt >= since && c.scanDate).map(c => Math.max(0, day(isoOf(new Date(c.createdAt))) - day(c.scanDate)));
    const rt = k => ['print', 'printing', 'milestones', 'pickup'].indexOf(k);
    const mk = DEMO.logs.filter(l => l.at >= since && l.a === 'stage' && rt(l.to) >= 2 && rt(l.from) < 2 && l.sid === 'gwen' && rc.some(c => c.id === l.caseId)).map(l => l.at - rc.find(c => c.id === l.caseId).createdAt);
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    return { lag: wkLagTxt(avg(lag)), make: wkSpanTxt(avg(mk)), nLag: lag.length, nMk: mk.length };
  });
  check(s.rows.gwen.retLag === g.lag && s.rows.gwen.retMake === g.make, 'Gwen’s averages match her ' + g.nLag + ' retainers entered and ' + g.nMk + ' made (' + g.lag + ', ' + g.make + ')');
  check(await p.evaluate(() => { const t = Array.from(document.querySelectorAll('.wkTbl:not(.wkPlateTbl) tbody tr')).map(r => r.dataset.k); return t.join(',') === 'angelika,gwen,kaylee,sarah,amir'; }), 'the assistants by name, then Dr. A');
  await p.screenshot({ path: OUT + '/v50-desk.png' });

  console.log('\n# Other periods');
  await p.click('[data-act=wkDays][data-d="7"]'); await ready();
  const s7 = await shown(), e7 = await expect(7);
  check(['sarah', 'angelika', 'gwen', 'kaylee'].every(k => same(s7.rows[k], e7[k], keys)), 'the last 7 days: every person’s numbers match the history');
  await p.click('[data-act=wkDays][data-d="90"]'); await ready();
  const s90 = await shown(), e90 = await expect(90);
  check(['sarah', 'angelika', 'gwen', 'kaylee'].every(k => same(s90.rows[k], e90[k], keys)), 'the last 90 days (the older part read when asked): every person’s numbers match');
  check(s7.all.entered <= s.all.entered && s.all.entered <= s90.all.entered && s7.all.moved <= s.all.moved && s.all.moved <= s90.all.moved, 'more days, more counted (' + [s7.all.entered, s.all.entered, s90.all.entered].join(' ≤ ') + ' entered)');
  check(s90.all.open === s.all.open, 'open cases now don’t depend on the period');
  await p.click('[data-act=wkDays][data-d="30"]'); await ready();

  console.log('\n# On each person’s plate: open cases now, by kind');
  const plate = await p.evaluate(() => Array.from(document.querySelectorAll('#wkPlate .wkRow')).map(r => ({ k: r.dataset.k, segs: Array.from(r.querySelectorAll('.wkSeg')).map(x => [x.dataset.l, Number(x.dataset.n)]), tot: (r.querySelector('.wkTot b') || {}).textContent })));
  const byKind = await p.evaluate(() => { const o = {}; openCases().forEach(c => { const k = c.assignee || ''; o[k] = o[k] || {}; const l = WK_KINDS.find(x => x.k === wkKind(c)).l; o[k][l] = (o[k][l] || 0) + 1; }); return o; });
  check(plate.length >= 5 && plate.every(r => r.segs.every(([l, n]) => (byKind[r.k] || {})[l] === n) && r.segs.reduce((a, [, n]) => a + n, 0) === Number(r.tot || 0)), 'each bar: the person’s open cases by kind, its total at the end');
  check(plate.map(r => Number(r.tot || 0)).every((n, i, a) => !i || a[i - 1] >= n), 'the most first');
  const order = await p.evaluate(() => Array.from(document.querySelectorAll('#wkPlate .wkLegend span')).map(x => x.textContent).join(' | '));
  check(order === 'Outside aligners & braces | In-house aligners | Appliances & MARPE | Retainers & mouthguards | Study models & other', 'a legend, in the bars’ order (' + order + ')');
  const geo = await p.evaluate(() => { const bars = Array.from(document.querySelectorAll('#wkPlate .wkBar')).map(b => ({ w: b.getBoundingClientRect().width, n: Number(b.parentElement.querySelector('.wkTot b').textContent) }));
    const seg = document.querySelector('#wkPlate .wkSeg'), before = getComputedStyle(seg, '::before'), segs = Array.from(document.querySelectorAll('#wkPlate .wkBar')).find(b => b.children.length > 1);
    const gap = segs ? segs.children[1].getBoundingClientRect().left - segs.children[0].getBoundingClientRect().right : 2;
    return { ratio: bars.map(b => b.w / b.n), h: seg.getBoundingClientRect().height - parseFloat(before.top) - parseFloat(before.bottom), gap }; });
  check(Math.max(...geo.ratio) / Math.min(...geo.ratio) < 1.25, 'bar lengths follow the totals');
  check(geo.h <= 24 && geo.h >= 12 && Math.abs(geo.gap - 2) < 0.6, 'thin bars (' + geo.h + 'px), 2px between the kinds');
  await p.hover('#wkPlate .wkRow[data-k=sarah] .wkSeg >> nth=0'); await p.waitForTimeout(120);
  const tip = await p.evaluate(() => { const t = document.querySelector('#wkTip'); return t && getComputedStyle(t).display !== 'none' ? Array.from(t.children).map(c => c.textContent) : null; });
  const s0 = plate.find(r => r.k === 'sarah').segs[0];
  check(tip && tip[0] === s0[1] + ' ' + s0[0] && tip[tip.length - 1] === 'Sarah', 'pointing at a part of a bar: the number first, the kind, whose it is (' + JSON.stringify(tip) + ')');
  await p.screenshot({ path: OUT + '/v50-tip.png', clip: { x: 240, y: 560, width: 1120, height: 440 } });
  await p.mouse.move(5, 5); await p.waitForTimeout(80);
  check(await p.evaluate(() => getComputedStyle(document.querySelector('#wkTip')).display) === 'none', 'and it goes away');
  await p.focus('#wkPlate .wkRow[data-k=gwen] .wkSeg'); await p.waitForTimeout(80);
  check(await p.evaluate(() => /Gwen$/.test(document.querySelector('#wkTip').textContent) && getComputedStyle(document.querySelector('#wkTip')).display !== 'none'), 'the keyboard gets the same readout');
  await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement.blur());
  // Table: the same numbers without the chart
  await p.click('#wkPlate [data-act=wkTbl]'); await p.waitForSelector('.wkPlateTbl');
  const tb = await p.evaluate(() => Array.from(document.querySelectorAll('.wkPlateTbl tbody tr')).map(r => ({ k: r.dataset.k, open: Number(r.querySelector('[data-c=open]').textContent),
    kinds: WK_KINDS.map(x => Number(r.querySelector('[data-c=' + x.k + ']').textContent)) })));
  check(tb.length === plate.length && tb.every(r => r.open === Number(plate.find(x => x.k === r.k).tot || 0) && r.kinds.reduce((a, b) => a + b, 0) === r.open), 'Table: the same numbers, a row per person');
  check(await p.evaluate(() => document.activeElement && document.activeElement.dataset.act === 'wkTbl' && document.activeElement.textContent.trim() === 'Chart'), 'the button now says Chart (and keeps the focus)');
  await p.screenshot({ path: OUT + '/v50-table.png', clip: { x: 240, y: 560, width: 1120, height: 440 } });
  await p.click('#wkPlate [data-act=wkTbl]'); await p.waitForSelector('#wkPlate .wkBars');

  console.log('\n# A number opens those cases');
  const sarahOpen = s.rows.sarah.open;
  await p.click('.wkTbl tr[data-k=sarah] [data-c=open] .linkBtn'); await p.waitForSelector('#listBody');
  const lst = await p.evaluate(() => ({ view: S.view, who: S.f.who, rows: document.querySelectorAll('#listBody tr[data-id]').length }));
  check(lst.view === 'list' && lst.who === 'sarah' && lst.rows === sarahOpen, 'Sarah’s Open (' + sarahOpen + ') → All open cases, assigned to Sarah (' + lst.rows + ' rows)');
  await p.click('#nav-work'); await p.waitForSelector('.wkTbl');
  const lateK = Object.keys(s.rows).find(k => s.rows[k].late);
  if (lateK) {
    await p.click('.wkTbl tr[data-k="' + lateK + '"] [data-c=late] .linkBtn'); await p.waitForSelector('#listBody');
    const ll = await p.evaluate(() => ({ who: S.f.who, due: S.f.due, rows: document.querySelectorAll('#listBody tr[data-id]').length }));
    check(ll.who === lateK && ll.due === 'over' && ll.rows === s.rows[lateK].late, 'Late → their late cases (' + ll.rows + ')');
    await p.click('#nav-work'); await p.waitForSelector('.wkTbl');
  } else check(false, 'a late case to try (the demo has some)');

  console.log('\n# Refresh: what\'s new since');
  await ready(); const before = (await shown()).rows.angelika;
  const rid = await p.evaluate(() => { const c = openCases().find(x => x.type === 'retainer' && x.stage === 'print'); return c && c.id; });
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { staffId: 'angelika' }); }); // (Angelika makes it: the demo's login, just for this move)
  await p.evaluate(id => moveStage(id, 'milestones'), rid); await p.waitForTimeout(200);
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { staffId: 'amir' }); });
  await p.click('.wkFilters [data-act=wkRefresh]'); await ready();
  const after = (await shown()).rows.angelika;
  check(after.ret === before.ret + 1 && after.moved === before.moved + 1, 'Angelika made a retainer: Refresh shows it (made ' + before.ret + ' → ' + after.ret + ', steps ' + before.moved + ' → ' + after.moved + ')');

  console.log('\n# Names are text, never markup');
  // (the page shows first names: the markup is the first word)
  await p.evaluate(() => { const r = S.roster.find(x => x.sid === 'kaylee'); r.name = '<img/src=x/onerror=window.__x=1>Kay Tester'; renderView(); });
  await p.waitForTimeout(150); await p.hover('#wkPlate .wkRow[data-k=kaylee] .wkSeg >> nth=0'); await p.waitForTimeout(100);
  check(await p.evaluate(() => !window.__x && !document.querySelector('#view img[src="x"], #wkTip img') && /<img\/src=x/.test(document.querySelector('.wkTbl tr[data-k=kaylee] .wkWho').textContent) && /<img\/src=x/.test(document.querySelector('#wkTip').textContent)), 'a name with markup in it shows as text, in the table and the readout');
  await p.evaluate(() => { const r = S.roster.find(x => x.sid === 'kaylee'); r.name = 'Kaylee (demo)'; renderView(); });

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  const ph = await p.evaluate(() => { const w = document.querySelector('.wkTblWrap'), card = document.querySelector('#wkPlate').getBoundingClientRect();
    const tots = Array.from(document.querySelectorAll('#wkPlate .wkTot')).map(t => t.getBoundingClientRect().right);
    return { over: document.documentElement.scrollWidth - innerWidth, tblScroll: w.scrollWidth > w.clientWidth, sticky: getComputedStyle(document.querySelector('.wkTbl td.wkWho')).position, fit: tots.every(r => r <= card.right - 8) }; });
  check(ph.over <= 0 && ph.tblScroll && ph.sticky === 'sticky' && ph.fit, 'phone: the page doesn’t scroll sideways; the table does, with the names kept in view; the bars and their labels fit (' + JSON.stringify(ph) + ')');
  await p.screenshot({ path: OUT + '/v50-phone.png', fullPage: true });
  await p.setViewportSize({ width: 1360, height: 1000 });

  console.log('\n# Not for staff; nothing kept after Lock');
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { role: 'staff', staffId: 'gwen' }); renderShell(); renderView(); });
  check(!(await p.$('#nav-work')) && !(await p.textContent('#view')).includes('By person'), 'a staff login has no Workload tab and can’t see the page');
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { role: 'owner', staffId: 'amir' }); renderShell(); renderView(); });
  await p.evaluate(() => lockOut()); await p.waitForTimeout(150);
  check(await p.evaluate(() => WK.log === null && WK.closed === null && !document.querySelector('#wkTip[style*="block"]')), 'Lock drops the history the page had read');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
