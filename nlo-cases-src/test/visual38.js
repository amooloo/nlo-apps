// The lists' Tx progress column and the optional Tx cost column (Amir, 4 Oct 2026: "I would like to see a column with tx
// progress as well"; "add an optional column for total cost per tx so far") — demo, made-up patients
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const signIn = async () => { await p.click('#lgBtn'); await p.waitForSelector('.tiles'); };
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await signIn();

  // made-up in-house patients at each point of treatment, as new cases in the demo (its own copy too, so its live updates keep them)
  const seed = () => p.evaluate(() => {
    const t = todayISO(), base = openCases().find(c => c.type === 'nla');
    const mk = (id, x) => { const c = Object.assign(JSON.parse(JSON.stringify(base)), { id, status: 'open', stage: 'txp', variant: '', txAt: Date.now(), createdAt: Date.now() }, x);
      S.cases.set(id, c); DEMO.cases.set(id, JSON.parse(JSON.stringify(c))); return id; };
    const ids = {
      steady: mk('tx-steady', { patient: 'Txtest Steady', chart: 'TX-A', initial: 'yes', alU: 20, alL: 20, scanDate: addDays(t, -70), txStart: addDays(t, -60), txEnd: addDays(t, 300) }),
      steady2: mk('tx-steady2', { patient: 'Txtest Steady', chart: 'TX-A', initial: 'no', alU: 6, alL: 6, scanDate: addDays(t, -3), txStart: '', txEnd: '' }),
      amber: mk('tx-amber', { patient: 'Txtest Amber', chart: 'TX-B', initial: 'yes', alU: 22, alL: 22, txStart: addDays(t, -300), txEnd: addDays(t, 60) }),
      coral: mk('tx-coral', { patient: 'Txtest Coral', chart: 'TX-C', initial: 'yes', alU: 18, alL: 16, txStart: addDays(t, -330), txEnd: addDays(t, 20) }),
      over: mk('tx-over', { patient: 'Txtest Over', chart: 'TX-D', initial: 'yes', alU: 24, alL: 24, txStart: addDays(t, -400), txEnd: addDays(t, -21) }),
      soon: mk('tx-soon', { patient: 'Txtest Soon', chart: 'TX-E', initial: 'yes', alU: 14, alL: 14, txStart: addDays(t, 6), txEnd: addDays(t, 370) }),
      none: mk('tx-none', { patient: 'Txtest Nodates', chart: 'TX-F', initial: 'yes', alU: '', alL: '', aligners: '', txStart: '', txEnd: '' })
    };
    ids.oliv = openCases().find(c => c.type === 'oliv').id;
    ids.startDay = fmtDate(addDays(t, 6));
    queueRender(); return ids;
  });
  const ids = await seed();
  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click'); await p.waitForFunction(() => openCases().filter(c => c.type === 'nla').every(histReady)); await p.waitForTimeout(250); // (the patients' earlier sets: fetched by patient, 4 Oct 2026)
  const heads = () => p.$$eval('#listBody thead th', ths => ths.map(t => t.textContent.replace(/[↑↓]/g, '').trim()));
  let h = await heads();
  console.log('   columns:', h.join(' | '));
  check(h.join('|') === 'Patient|Type|Stage|Lab date|Delivery appt|Tx progress|Shipping|Assigned|Updated', 'Tx progress is a column (after Delivery appt); Tx cost is off to start');
  check(!/hidden/.test(await p.textContent('.colBtn')), 'the Columns button doesn’t count the optional Tx cost as hidden');

  // ---- Tx progress cells
  const tx = id => p.evaluate(id => { const td = document.querySelector('#listBody tr[data-id="' + id + '"] td.txCol'); if (!td) return null;
    const cell = td.querySelector('.txCell'), bar = td.querySelector('.txMini'), i = bar && bar.querySelector('i'), b = td.querySelector('b'), sub = td.querySelector('.txSub');
    return { text: td.textContent.trim(), over: !!cell && cell.classList.contains('over'), phase: bar ? (bar.className.match(/\b(s1|s3|sOver)\b/) || [''])[0] : null, w: i ? i.style.width : '',
      pct: b ? b.textContent : '', sub: sub ? sub.textContent : '', tip: cell ? cell.getAttribute('title') : '', none: !!td.querySelector('.due.none') }; }, id);
  const want = await p.evaluate(ids => Object.fromEntries(Object.entries(ids).filter(([k]) => k !== 'startDay').map(([k, id]) => { const c = findCase(id); const t = c && c.type === 'nla' && txOf(c, casePool()); return [k, t ? txText(txProgress(t), t) : '']; })), ids);
  let x = await tx(ids.steady);
  console.log('   steady:', x.pct, '|', x.sub, '|', x.tip);
  check(/^\d+%$/.test(x.pct) && Math.abs(parseInt(x.pct) - 17) <= 1 && /^Month \d+ of 12$/.test(x.sub) && x.phase === '' && x.tip === want.steady, 'on track: the mint bar, ' + x.pct + ', “' + x.sub + '”, the whole line on hover');
  x = await tx(ids.steady2);
  check(x.pct === (await tx(ids.steady)).pct && x.tip === want.steady, 'the patient’s refinement shows the same treatment (dates from the initial set)');
  x = await tx(ids.amber); check(x.phase === 's3' && x.pct === '83%', 'two months left: amber (' + x.pct + ', ' + x.sub + ')');
  x = await tx(ids.coral); check(x.phase === 's1' && x.pct === '94%', 'under a month left: coral (' + x.pct + ')');
  x = await tx(ids.over); check(x.phase === 'sOver' && x.over && x.w === '100%' && x.sub === '3 weeks past removal', 'past the expected removal: dark red, “' + x.sub + '”');
  x = await tx(ids.soon); check(x.pct === '0%' && x.sub === 'Starts ' + ids.startDay && x.w === '0%', 'not started yet: “' + x.sub + '”');
  x = await tx(ids.none); check(x.none && x.text === 'No tx dates', 'an in-house set without the dates says so');
  x = await tx(ids.oliv); check(x && x.text === '', 'other cases (Oliv) leave it empty');

  // ---- sorting: by how far along; cases with nothing to sort by stay at the bottom either way
  const ratios = () => p.evaluate(() => Array.from(document.querySelectorAll('#listBody tr.click')).map(r => txRatio(findCase(r.dataset.id))));
  const okOrder = (r, dir) => { const vals = r.filter(v => v !== null), firstNull = r.indexOf(null); return (firstNull < 0 || r.slice(firstNull).every(v => v === null)) && vals.every((v, i) => !i || (dir > 0 ? vals[i - 1] <= v : vals[i - 1] >= v)); };
  await p.click('#listBody th [data-act=sort][data-k=tx]'); await p.waitForTimeout(120);
  let r = await ratios();
  check(okOrder(r, 1) && r[0] !== null, 'Tx progress heading: least far along first, cases without dates last');
  await p.click('#listBody th [data-act=sort][data-k=tx]'); await p.waitForTimeout(120);
  r = await ratios();
  check(okOrder(r, -1) && (await p.evaluate(id => document.querySelector('#listBody tr.click').dataset.id === id, ids.over)), 'again: furthest along first (the overdue patient on top), cases without dates still last');
  await p.screenshot({ path: OUT + '/v38-tx.png', clip: { x: 232, y: 0, width: 1688, height: 760 } });

  // ---- the optional Tx cost column
  await p.click('.colBtn'); await p.waitForSelector('.colMenu');
  const menu = await p.$$eval('.colMenu .colOpt, .colMenu .colOptHd', es => es.map(e => e.textContent.trim() + (e.querySelector('input') ? (e.querySelector('input').checked ? '[x]' : '[ ]') : '')));
  console.log('   menu:', menu.join(' | '));
  check(menu.join('|') === 'Type[x]|Stage[x]|Lab date[x]|Delivery appt[x]|Tx progress[x]|Shipping[x]|Assigned[x]|Updated[x]|Optional|Tx cost[ ]', 'the Columns menu: Tx progress ticked, Tx cost under “Optional”, unticked');
  await p.check('.colMenu input[data-col=cost]'); await p.waitForTimeout(150);
  h = await heads();
  check(h.join('|') === 'Patient|Type|Stage|Lab date|Delivery appt|Tx progress|Tx cost|Shipping|Assigned|Updated', 'ticking Tx cost adds it after Tx progress');
  await p.click('h2'); await p.waitForTimeout(80);
  const cost = id => p.evaluate(id => { const td = document.querySelector('#listBody tr[data-id="' + id + '"] td.costCol'); if (!td) return null; const cell = td.querySelector('.costCell');
    return { text: td.textContent.trim(), b: cell ? cell.querySelector('b').textContent : '', sub: cell ? cell.querySelector('.txSub').textContent : '', tip: cell ? cell.getAttribute('title') : '' }; }, id);
  let cA = await cost(ids.steady), cA2 = await cost(ids.steady2);
  console.log('   cost:', cA.b, '|', cA.sub, '|', cA.tip);
  check(cA.b === '$234.00' && cA.sub === '52 aligners · 2 sets' && /Initial 40 · Refinement 1 12/.test(cA.tip) && cA2.b === '$234.00', 'a two-set patient: 52 aligners × $4.50 = $234.00 on both sets, the sets in the tooltip');
  check((await cost(ids.amber)).b === '$198.00' && (await cost(ids.amber)).sub === '44 aligners · 1 set', 'one set: 44 aligners = $198.00');
  check((await cost(ids.none)).text === 'No aligner counts' && (await cost(ids.oliv)).text === '', 'no counts yet says so; other cases stay empty');
  const panel = await p.evaluate(id => { const c = findCase(id); return alignerTotalHTML(c).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }, ids.steady);
  check(/Patient total: 52 aligners est\. \$234\.00/.test(panel), 'the same total the case’s Aligners box shows (' + (panel.match(/Patient total:[^—]*?\$[\d.,]+/) || [''])[0] + ')');
  await p.click('#listBody th [data-act=sort][data-k=cost]'); await p.waitForTimeout(120);
  const costs = await p.evaluate(() => Array.from(document.querySelectorAll('#listBody tr.click')).map(r => costKey(findCase(r.dataset.id))));
  check(okOrder(costs, 1), 'Tx cost heading: cheapest first, cases without a cost last');
  await p.evaluate(() => { S.settings.alPerAligner = 0; S.settings.alPerSet = 0; renderView(); });
  check((await cost(ids.steady)).text === 'No cost set', 'before Dr. A enters the costs: “No cost set”');
  await p.evaluate(() => { S.settings.alPerAligner = 4.5; S.settings.alPerSet = 25; renderView(); });
  check((await cost(ids.steady)).b === '$284.00', 'with a per-set cost too: 2 × $25 + 52 × $4.50 = $284.00');
  await p.evaluate(() => { S.settings.alPerSet = 0; renderView(); });
  await p.evaluate(id => document.querySelector('#listBody tr[data-id="' + id + '"]').scrollIntoView({ block: 'center' }), ids.steady);
  await p.screenshot({ path: OUT + '/v38-cost.png', clip: { x: 232, y: 0, width: 1688, height: 1000 } });

  // ---- remembered on this computer; Show all leaves the optional column as it is
  await p.click('#listBody th [data-act=hideCol][data-k=updated]'); await p.waitForTimeout(100);
  check(/1 hidden/.test(await p.textContent('.colBtn')), 'hiding Updated: “1 hidden” (Tx cost on, not counted)');
  await p.reload(); await signIn(); await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  h = await heads();
  check(h.includes('Tx cost') && !h.includes('Updated'), 'after a reload: Tx cost still on, Updated still hidden');
  await p.click('.colBtn'); await p.click('.colMenu [data-act=showCols]'); await p.waitForTimeout(120);
  h = await heads();
  check(h.includes('Updated') && h.includes('Tx cost') && h.length === 10, 'Show all brings Updated back and leaves Tx cost on');
  await p.click('.colBtn'); await p.uncheck('.colMenu input[data-col=cost]'); await p.waitForTimeout(100); await p.click('h2');
  await p.reload(); await signIn(); await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  h = await heads();
  check(!h.includes('Tx cost') && h.includes('Tx progress') && h.length === 9, 'unticked, Tx cost stays off after a reload');
  await p.click('#listBody th [data-act=hideCol][data-k=tx]'); await p.waitForTimeout(100);
  check(!(await heads()).includes('Tx progress') && /“Tx progress” column hidden/.test(await p.textContent('.toast')), 'the eye hides Tx progress like any column');
  await p.click('.colBtn'); await p.click('.colMenu [data-act=showCols]'); await p.waitForTimeout(100);
  await p.click('#nav-mine'); await p.waitForSelector('#listBody tr.click, #listBody .empty');
  check((await heads()).includes('Tx progress') || (await p.locator('#listBody .empty').count()) > 0, 'My cases: the same columns');

  // ---- phones: the columns fold away
  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(250);
  check(!(await p.locator('#listBody td.txCol').first().isVisible()) && await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: the Tx columns fold away, no sideways scrolling');
  // how wide the table gets (Tx progress on, Tx cost off / on)
  for (const w of [1536, 1680, 1920]) {
    await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(200);
    console.log('   width ' + w + ': table overflows its card by', await p.evaluate(() => { const wr = document.querySelector('#listBody .tblWrap'); return wr.scrollWidth - wr.clientWidth; }), 'px');
  }
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
