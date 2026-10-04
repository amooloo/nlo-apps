// Amir, 3 Oct 2026: "for initial cases, or additional cases that have this missing. allow Start and expected removal date.
// and based on that show a graph for each patient on where they are in treatment" — "this is only for IN HOUSE aligner cases" — demo
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
// dates here the same way the app does them (local, no time of day)
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return iso(x); };
const today = iso(new Date());
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  // the panel folded the usual way (no Expand all), to see the one-line summary first
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  // a change made here goes on every copy the app holds (open, closed, history) and on the demo's stored one
  const setCase = (id, o) => p.evaluate(([id, o]) => { casePool().filter(x => x.id === id).forEach(x => Object.assign(x, o)); Object.assign(DEMO.cases.get(id), JSON.parse(JSON.stringify(o))); queueRender(); }, [id, o]);
  const open = async id => { await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, id); await p.waitForSelector('#drawer .dsList'); await p.waitForTimeout(250); };
  const unfold = async () => { if (await p.getAttribute('#drawer .ds[data-ds=tx] .dsTg', 'aria-expanded') !== 'true') await p.click('#drawer .ds[data-ds=tx] .dsTg'); await p.waitForTimeout(120); };
  const graph = () => p.evaluate(() => { const sec = document.querySelector('#drawer .ds[data-ds=tx]'), svg = Array.from(sec.querySelectorAll('svg.txSvg')).find(s => s.getBoundingClientRect().width > 0);
    const num = (sel, a) => { const e = svg && svg.querySelector(sel); return e ? Number(e.getAttribute(a)) : null; };
    return { head: (sec.querySelector('.txHead') || {}).textContent || '', headOver: !!sec.querySelector('.txHead.over'), shown: svg ? svg.classList.contains('w') ? 'w' : 'n' : '', svgs: sec.querySelectorAll('svg.txSvg').length,
      labels: svg ? Array.from(svg.querySelectorAll('.set .ml')).map(t => t.textContent) : [], me: svg ? Array.from(svg.querySelectorAll('.set .mk')).map(c => c.classList.contains('me')) : [],
      titles: svg ? Array.from(svg.querySelectorAll('.set title')).map(t => t.textContent) : [], today: svg ? (svg.querySelector('.tl') || {}).textContent : '',
      bgX: num('.bg', 'x'), bgW: num('.bg', 'width'), fillW: num('.fill', 'width'), todayX: num('.today', 'x1'), over: !!(svg && svg.querySelector('.over')), due: !!(svg && svg.querySelector('.due')),
      months: svg ? Array.from(svg.querySelectorAll('.mo')).map(t => t.textContent) : [], aria: svg ? svg.getAttribute('aria-label') : '',
      ends: Array.from(sec.querySelectorAll('.txEnds span')).map(s => s.textContent), from: (sec.querySelector('.txFrom') || {}).textContent || '' }; });
  const fmt = s => p.evaluate(s => fmtDate(s), s);

  // ---- the demo's in-house patient on a refinement: the dates were entered on the initial set (finished, 102 days ago)
  const ref = await p.evaluate(() => openCases().find(c => c.chart === '15-1001').id);
  const al0 = await p.evaluate(() => { const a = DEMO.cases.get('demoAl0'); return { s: a.txStart, e: a.txEnd }; });
  check(al0.s === plus(today, -102) && al0.e === plus(al0.s, 548), 'demo: the initial set holds the patient’s Start (its delivery) and Expected removal (18 months on)');
  // expected numbers, worked out here: day 102 of 548
  const [sy, sm, sd] = al0.s.split('-').map(Number), n = new Date(), month = (n.getFullYear() - sy) * 12 + (n.getMonth() + 1 - sm) - (n.getDate() < sd ? 1 : 0) + 1;
  const want = 'Month ' + month + ' of 18 · 19% · 15 months left';
  await open(ref);
  const sum = await p.evaluate(() => { const s = document.querySelector('#dsS-tx'); return { text: s.textContent, bar: s.querySelector('.txMini i').style.width, order: Array.from(document.querySelectorAll('#drawer .ds')).map(x => x.dataset.ds).join(',') }; });
  console.log('   folded:', JSON.stringify(sum));
  check(sum.text === want && sum.bar === '19%', 'folded, the Treatment line reads “' + want + '” with a small bar 19% full');
  check(/details,tx,aligners/.test(sum.order), 'Treatment sits right under Details (before Aligners)');
  await unfold();
  const g = await graph(); console.log('   graph:', JSON.stringify(g));
  check(g.head === want && g.shown === 'w' && g.svgs === 2, 'open: the same line over the graph (the wide graph on a computer)');
  check(g.labels.join(',') === 'Initial,Ref 1' && g.me.join(',') === 'false,true', 'the patient’s sets on the bar: Initial, then Ref 1 (this set, filled in)');
  check(/^Initial · delivery /.test(g.titles[0]) && /^Refinement 1 \(this set\) · delivery /.test(g.titles[1]), 'pointing at a set says which it is and its delivery date');
  const frac = (g.todayX - g.bgX) / g.bgW;
  check(g.today === 'Today' && Math.abs(frac - 102 / 548) < 0.012 && Math.abs(g.fillW - (g.todayX - g.bgX)) < 1, 'Today is marked 19% along the treatment; the mint fill runs up to it (' + frac.toFixed(3) + ')');
  check(g.ends.join(' | ') === 'Start ' + await fmt(al0.s) + ' | Expected removal ' + await fmt(al0.e), 'under it: Start ' + await fmt(al0.s) + ' and Expected removal ' + await fmt(al0.e));
  check(/^Dates from the patient’s initial set/.test(g.from) && g.months.length >= 5 && /’\d\d$/.test(g.months[0]), 'it says the dates came from the initial set; month marks along the bottom (the first with its year)');
  check(g.aria.includes(want) && g.aria.includes('Initial') && g.aria.includes('Ref 1'), 'the graph has a text description for screen readers');
  await (await p.$('#drawer .ds[data-ds=tx]')).screenshot({ path: OUT + '/v24-treatment.png' });

  // ---- only in-house aligner cases have it
  const others = await p.evaluate(() => ['oliv', 'retainer', 'appliance', 'insmile'].map(t => (openCases().find(c => c.type === t) || {}).id));
  let none = true; for (const id of others) { await open(id); if (await p.$('#drawer .ds[data-ds=tx]')) none = false; }
  check(none, 'no Treatment section on Oliv, retainer, appliance or InSmile cases');

  // ---- Edit on the refinement: the patient already has dates, so one line says so (with Change)
  await open(ref); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-txWrap', { state: 'attached' });
  const fe = await p.evaluate(() => ({ wrap: getComputedStyle(document.querySelector('#cf-txWrap')).display, row: getComputedStyle(document.querySelector('#cf-txFromRow')).display, from: document.querySelector('#cf-txFrom').textContent }));
  check(fe.wrap === 'none' && fe.row !== 'none' && fe.from === 'Treatment ' + await fmt(al0.s) + ' → expected removal ' + await fmt(al0.e) + await p.evaluate(([s, e]) => { const n = txMonths(s, e); return n ? ' · ' + n + ' months' : ''; }, [al0.s, al0.e]) + ' (from the patient’s initial set).', 'Edit (refinement): no date boxes — “' + fe.from + '” with Change');
  const sec = await p.evaluateHandle(() => document.querySelector('#drawer #cf-txWrap').closest('.cfSec')); await sec.scrollIntoViewIfNeeded();
  await sec.screenshot({ path: OUT + '/v24-edit-refinement.png' });
  await p.click('#drawer #cf-txChange'); await p.waitForTimeout(80);
  const ch = await p.evaluate(() => ({ wrap: getComputedStyle(document.querySelector('#cf-txWrap')).display, row: getComputedStyle(document.querySelector('#cf-txFromRow')).display, s: document.querySelector('#cf-txStart').value, e: document.querySelector('#cf-txEnd').value, f: document.activeElement.id }));
  check(ch.wrap !== 'none' && ch.row === 'none' && ch.s === al0.s && ch.e === al0.e && ch.f === 'cf-txEnd', 'Change: the boxes open with the patient’s dates filled in, on Expected removal');
  await sec.screenshot({ path: OUT + '/v24-edit-change.png' });
  // checks before it saves
  const notice = async () => { await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(150); return { t: await p.evaluate(() => (document.querySelector('#drawerNotice') || {}).textContent || ''), editing: await p.evaluate(() => S.editing) }; };
  await p.fill('#drawer #cf-txEnd', plus(al0.s, -1));
  let r = await notice(); check(r.t === 'The expected removal has to be after the treatment start.' && r.editing, 'an expected removal before the start isn’t saved (it says why)');
  await p.fill('#drawer #cf-txEnd', '');
  r = await notice(); check(r.t === 'Enter both the treatment start and the expected removal (or leave both empty).' && r.editing, 'only one of the two isn’t saved either');
  const newEnd = plus(al0.s, 600);
  await p.fill('#drawer #cf-txEnd', newEnd); await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('#drawer .dsList'); await p.waitForTimeout(300);
  const saved = await p.evaluate(id => { const d = DEMO.cases.get(id), a = DEMO.cases.get('demoAl0'); return { s: d.txStart, e: d.txEnd, at: d.txAt, a0: a.txEnd }; }, ref);
  check(saved.s === al0.s && saved.e === newEnd && saved.at > Date.now() - 60e3 && saved.a0 === al0.e, 'saved on the refinement (with when), the initial set left as it was');
  await unfold(); const g2 = await graph();
  check(/ of 20 · 17% · /.test(g2.head) && /^Dates saved on this set/.test(g2.from) && g2.ends[1] === 'Expected removal ' + await fmt(newEnd), 'the graph now uses the newer dates: ' + g2.head + ' (“Dates saved on this set”)');
  const hist = await p.evaluate(async id => { S.history = await B.caseLog(id); return historyHTML(findCase(id)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }, ref);
  const hl = (/changed .*?expected removal/.exec(hist) || [''])[0]; console.log('   history:', hl);
  check(/changed (aligners, )?(Dr\. A’s instructions, )?treatment start, expected removal$/.test(hl), 'history: “changed … treatment start, expected removal” (not every field the demo case never had)');

  // ---- New case
  await p.evaluate(() => closeDrawer(true));
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(100);
  const vis = () => p.evaluate(() => ({ sec: getComputedStyle(document.querySelector('#ncForm #cf-txWrap').closest('.cfSec')).display, wrap: getComputedStyle(document.querySelector('#ncForm #cf-txWrap')).display, row: getComputedStyle(document.querySelector('#ncForm #cf-txFromRow')).display, from: document.querySelector('#ncForm #cf-txFrom').textContent }));
  let v = await vis(); check(v.sec !== 'none' && v.wrap !== 'none' && v.row === 'none', 'New case, in-house: Treatment asks for Start and Expected removal');
  await p.fill('#ncForm #cf-patient', 'Zed Fakename'); await p.fill('#ncForm #cf-chart', '15-1001'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.waitForTimeout(100);
  v = await vis(); check(v.wrap === 'none' && v.row !== 'none' && /from the patient’s earlier set/.test(v.from), 'a refinement for a patient who has dates: just the line (“' + v.from + '”)');
  await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(100);
  v = await vis(); check(v.wrap !== 'none' && v.row === 'none', 'an initial set asks again (a new treatment)');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(100);
  v = await vis(); check(v.sec === 'none', 'Oliv (not in-house): no Treatment section');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(100);
  await p.fill('#ncForm #cf-chart', '15-2002'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]'); await p.waitForTimeout(60);
  if ((await p.getAttribute('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]', 'aria-pressed')) !== 'true') await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  const s1 = plus(today, 7), e1 = plus(s1, 365);
  const ncErr = async () => { await p.click('#ncSave'); await p.waitForTimeout(150); return p.evaluate(() => (document.querySelector('#ncErr') || {}).textContent || ''); };
  await p.fill('#ncForm #cf-txStart', s1);
  check(await ncErr() === 'Enter both the treatment start and the expected removal (or leave both empty).', 'New case: only the start → “Enter both …”');
  await p.fill('#ncForm #cf-txEnd', plus(s1, -30));
  check(await ncErr() === 'The expected removal has to be after the treatment start.', 'New case: removal before the start → it says so');
  await p.fill('#ncForm #cf-txEnd', e1); await p.click('#ncSave');
  await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }).catch(() => {});
  const nid = await p.evaluate(() => (openCases().find(c => c.patient === 'Zed Fakename') || {}).id);
  const nc = await p.evaluate(id => { const d = DEMO.cases.get(id); return d && { s: d.txStart, e: d.txEnd, at: d.txAt }; }, nid);
  check(nc && nc.s === s1 && nc.e === e1 && nc.at > Date.now() - 60e3, 'New case saved with its Start and Expected removal');
  await open(nid);
  const ns = await p.evaluate(() => document.querySelector('#dsS-tx').textContent);
  check(ns === 'Starts ' + await fmt(s1) + ' (in 7 days)', 'before it starts: “' + ns + '”');
  await unfold(); const g3 = await graph();
  check(g3.labels.join() === 'Initial' && /^Dates saved on this set/.test(g3.from) && g3.todayX < g3.bgX, 'its graph: Today before the bar, the set on it');
  // the bar's colour near the end (by time left, so it means the same on short and long treatments): mint, then amber at
  // "3 months left", coral at "4 weeks left", dark red past the expected removal; a short treatment stays mint until halfway
  const MINT = 'rgb(52, 196, 158)', AMBER = 'rgb(246, 175, 36)', CORAL = 'rgb(250, 98, 77)', RED = 'rgb(216, 65, 46)';
  const colours = () => p.evaluate(() => { const svg = Array.from(document.querySelectorAll('#drawer .ds[data-ds=tx] svg.txSvg')).find(x => x.getBoundingClientRect().width > 0);
    return { fill: getComputedStyle(svg.querySelector('.fill')).fill, mini: getComputedStyle(document.querySelector('#dsS-tx .txMini i')).backgroundColor, head: document.querySelector('#drawer .txHead').textContent }; });
  const phases = [['on track: 12 months, 7 months left', -150, 215, MINT, 'mint', 'v24-phase-1.png'], ['3 months left (12-month treatment)', -270, 95, AMBER, 'amber', 'v24-phase-2.png'],
    ['4 weeks left', -337, 28, CORAL, 'coral', 'v24-phase-3.png'], ['a 4-month treatment, 1 month in (3 months left, not halfway)', -30, 90, MINT, 'mint', null],
    ['the same at halfway', -60, 60, AMBER, 'amber', null]];
  for (const [what, a, b, want, name, shot] of phases) {
    await setCase(nid, { txStart: plus(today, a), txEnd: plus(today, b), txAt: Date.now() });
    await open(nid); await unfold(); const c = await colours();
    check(c.fill === want && c.mini === want, what + ': the bar is ' + name + ' (“' + c.head + '”)');
    if (shot) await (await p.$('#drawer .ds[data-ds=tx]')).screenshot({ path: OUT + '/' + shot });
  }
  // past the expected removal: dark red, with the due date marked
  await setCase(nid, { txStart: plus(today, -400), txEnd: plus(today, -10), txAt: Date.now() });
  await open(nid); await unfold(); const g4 = await graph(), c4 = await colours();
  const s4 = await p.evaluate(() => ({ t: document.querySelector('#dsS-tx').textContent, over: !!document.querySelector('#dsS-tx b.txOver'), bar: document.querySelector('#dsS-tx .txMini.sOver i').style.width,
    past: getComputedStyle(Array.from(document.querySelectorAll('#drawer svg.txSvg')).find(x => x.getBoundingClientRect().width > 0).querySelector('.over')).fill }));
  check(g4.head === '10 days past expected removal' && g4.headOver && g4.over && g4.due && s4.over && s4.bar === '100%' && c4.fill === RED && c4.mini === RED && s4.past === RED, 'past the expected removal: “10 days past expected removal” in red, the whole bar dark red with the due date marked');
  await (await p.$('#drawer .ds[data-ds=tx]')).screenshot({ path: OUT + '/v24-overdue.png' });
  // a set with no dates (and none from the patient): it asks for them
  const bare = await p.evaluate(() => (openCases().find(c => c.type === 'nla' && c.initial === 'yes' && !c.chart && !txOf(c, casePool())) || {}).id);
  await open(bare);
  check(await p.textContent('#dsS-tx') === 'No start and expected removal yet', 'an in-house set without dates: “No start and expected removal yet”');
  await unfold(); check(/^Add the patient’s treatment Start and Expected removal with Edit/.test(await p.textContent('#drawer .ds[data-ds=tx] .dsBd')), 'opened, it says how to add them');

  // ---- export: two more columns
  check(await p.evaluate(id => caseToCSVRow(DEMO.cases.get(id)).endsWith(',"' + DEMO.cases.get(id).txStart + '","' + DEMO.cases.get(id).txEnd + '"'), ref), 'the CSV export row ends with Treatment start, Expected removal');
  check(/'Treatment start', 'Expected removal'\]/.test(fs.readFileSync(path.join(__dirname, '..', 'dist', 'nlo-cases.html'), 'utf8')), 'the export’s header names the two columns');

  // ---- phone: the narrow graph (writing stays readable), the folded line keeps the month and %
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  await open(ref);
  const ph = await p.evaluate(() => { const s = document.querySelector('#dsS-tx'), l = s.querySelector('.txLeft'); return { left: l ? getComputedStyle(l).display : 'missing', fits: s.scrollWidth <= s.clientWidth + 1 }; });
  check(ph.left === 'none' && ph.fits, 'phone, folded: “Month … of 20 · 17%” fits (the time left shows when it’s open)');
  await unfold(); const g5 = await graph();
  const wide = await p.evaluate(() => { const svg = document.querySelector('#drawer .txSvg.n'), r = svg.getBoundingClientRect(); return { w: Math.round(r.width), scale: r.width / 360, sw: document.documentElement.scrollWidth }; });
  check(g5.shown === 'n' && wide.scale > 0.85 && wide.scale < 1.3 && wide.sw <= 390, 'phone, open: the narrow graph at about its own size (' + wide.w + ' px), no sideways scrolling');
  check(/ of 20 · 17% · /.test(g5.head) && g5.labels.join(',') === 'Initial,Ref 1', 'phone: the same line, the sets on the bar');
  await (await p.$('#drawer .ds[data-ds=tx]')).screenshot({ path: OUT + '/v24-phone.png' });
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
