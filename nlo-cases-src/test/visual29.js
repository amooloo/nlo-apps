// Amir, 3 Oct 2026: his pictures for Dr. A's instructions ("replace all the icons for dr's instructions with new logos"), five new
// tiles (deep curve of Spee, open bite, IPR lower, tooth size discrepancy — IPR to correct OJ, posterior crossbite), the Retainers
// picture with a green check for Active retention; the Maintain/Improve rows kept (Midline and Overbite get his pictures). Then:
// "remove AP correction and change attachment. Also … change tooth size discrepancy to Upper IPR" — a case that already has
// AP or Change attachments keeps them (shown when it's edited) — demo
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(150);
  const st = await p.evaluate(() => ({
    goals: Array.from(document.querySelectorAll('#ncForm .goal')).map(g => { const i = g.querySelector('.iPic img'); return g.querySelector('.goalB b').textContent + '=' + (i ? i.dataset.pic + (i.complete && i.naturalWidth > 0 ? '' : '!') : 'drawing'); }),
    tiles: Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=instrPicks] .pick.itile')).map(t => { const i = t.querySelector('.iPic img'); return t.querySelector('span:not(.iPic)').textContent + '=' + (i ? i.dataset.pic + (i.complete && i.naturalWidth > 0 ? '' : '!') : 'drawing'); }) }));
  console.log('   ' + JSON.stringify(st));
  check(st.goals.join('|') === 'Midline=instr-midline|Overbite=instr-deepbite', 'Maintain/Improve rows: Midline and Overbite with Amir’s pictures — no AP row');
  check(st.tiles.map(t => t.split('=')[0]).join('|') === 'Close spaces|Black triangles|Upper IPR|IPR lower|Deep curve of Spee|Open bite|Posterior crossbite|Settle posteriors|No posterior movement|Not tracking|Active retention', 'the tiles: Upper IPR (was Tooth size discrepancy) beside IPR lower; no Change attachments');
  check(st.tiles.join('|') === 'Close spaces=instr-spaces|Black triangles=instr-bt|Upper IPR=instr-tsd|IPR lower=instr-iprlower|Deep curve of Spee=instr-spee|Open bite=instr-openbite|Posterior crossbite=instr-xbite|Settle posteriors=instr-postob|No posterior movement=instr-lock|Not tracking=instr-track|Active retention=instr-retain', 'every tile has Amir’s picture (loaded); Upper IPR keeps the tooth size discrepancy one');
  const plate = await p.$eval('#ncForm .pick.itile .iPic', e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }; });
  check(plate.bg === 'rgb(255, 255, 255)' && plate.w === 76 && plate.h === 56, 'the pictures sit on a white plate (76 × 56) like the case-type pictures');
  // picking: new tiles save their wording; the picked plate gets the mint ring
  for (const v of ['IPR lower', 'Upper IPR', 'Level deep curve of Spee', 'Correct open bite', 'Correct posterior crossbite']) await p.click('#ncForm .pickRow[data-g=instrPicks] .pick[data-v="' + v + '"]');
  check(await p.$eval('#ncForm .pick[data-v="Correct open bite"] .iPic', e => getComputedStyle(e).boxShadow.includes('100, 244, 201')), 'a picked tile: navy, its picture ringed in mint');
  await (await p.evaluateHandle(() => document.querySelector('#ncForm .goalGrid').closest('.cfSec'))).evaluate(e => e.scrollIntoView({ block: 'start' })); await p.mouse.move(5, 5); await p.waitForTimeout(400);
  await (await p.evaluateHandle(() => document.querySelector('#ncForm .goalGrid').closest('.cfSec'))).screenshot({ path: OUT + '/v29-instructions.png' });
  const ins = await p.evaluate(() => readCaseForm(document.querySelector('.modal')).instructions);
  check(ins === 'Upper IPR; IPR lower; Level deep curve of Spee; Correct open bite; Correct posterior crossbite', 'what’s saved: “' + ins + '”');
  await p.fill('#ncForm #cf-patient', 'Ida Instructa'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=no]'); await p.click('#ncSave');
  await p.waitForSelector('#ncForm', { state: 'detached', timeout: 5000 }).catch(() => {});
  const nid = await p.evaluate(() => (openCases().find(c => c.patient === 'Ida Instructa') || {}).id);
  const note = await p.evaluate(id => chartNote(findCase(id)), nid);
  check(/Correct posterior crossbite/.test(note) && /Level deep curve of Spee/.test(note) && /Upper IPR; IPR lower/.test(note), 'the chart note carries the new instructions');
  // an older case saved with AP and Change attachments: the chart note keeps them; Edit shows them (to clear if you like); Save keeps them
  const OLD_ATT = 'Need to change attachment/hooks on one or more teeth';
  const oid = await p.evaluate(() => openCases().find(c => c.type === 'oliv').id);
  await p.evaluate(([id, att]) => { const o = { goals: { midline: 'maintain', ap: 'improve' }, instrPicks: [att], instrOther: '', instructions: 'Maintain midline; Improve AP; ' + att };
    Object.assign(findCase(id), JSON.parse(JSON.stringify(o))); Object.assign(DEMO.cases.get(id), o); queueRender(); }, [oid, OLD_ATT]);
  check(/Improve AP; Need to change attachment/.test(await p.evaluate(id => chartNote(findCase(id)), oid)), 'older case: its chart note still says “Improve AP; Need to change attachment…”');
  await p.evaluate(id => openDrawer(id), oid); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .goalGrid', { state: 'attached' });
  const ed = await p.evaluate(att => ({ goals: Array.from(document.querySelectorAll('#drawer .goal .goalB b')).map(b => b.textContent).join('|'),
    ap: (document.querySelector('#drawer .pickRow[data-g=goal_ap] .pick[aria-pressed=true]') || {}).dataset?.v,
    att: !!document.querySelector('#drawer .pickRow[data-g=instrPicks]:not(.itGrid) .pick[aria-pressed=true][data-v="' + att + '"]'),
    tile: !!document.querySelector('#drawer .itGrid .pick[data-v="' + att + '"]') }), OLD_ATT);
  check(ed.goals === 'Midline|AP|Overbite' && ed.ap === 'improve' && ed.att && !ed.tile, 'Edit: its AP row (Improve) and “Earlier choices on this case” with the attachment change, not a tile (' + JSON.stringify(ed) + ')');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(400);
  const kept = await p.evaluate(id => { const d = DEMO.cases.get(id); return { ap: (d.goals || {}).ap, picks: (d.instrPicks || []).join(), ins: d.instructions }; }, oid);
  check(kept.ap === 'improve' && kept.picks === OLD_ATT && kept.ins === 'Maintain midline; Improve AP; ' + OLD_ATT, 'Save keeps them as they were');
  await p.evaluate(() => closeDrawer(true));
  // InSmile (braces): the aligner-only tiles stay hidden; the new ones show
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=insmile]'); await p.waitForTimeout(120);
  const br = await p.evaluate(() => Array.from(document.querySelectorAll('#ncForm .pickRow[data-g=instrPicks] .pick.itile')).filter(t => t.offsetParent).map(t => t.querySelector('span:not(.iPic)').textContent));
  check(!br.includes('Not tracking') && !br.includes('Active retention') && br.includes('Posterior crossbite') && br.includes('Upper IPR') && br.includes('IPR lower'), 'InSmile: no aligner-only tiles; the new ones are there');
  await p.click('.modal [data-act=closeModal]');
  // phone: fits
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => newCaseModal()); await p.waitForSelector('#ncForm'); await p.click('#ncForm .tt[data-tile=oliv]'); await p.waitForTimeout(150);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390 && Array.from(document.querySelectorAll('#ncForm .iPic img')).every(i => i.complete && i.naturalWidth > 0)), 'phone: all the pictures load, no sideways scrolling');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
