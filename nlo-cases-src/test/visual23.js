// SUPERSEDED 7 Oct 2026 (Amir's staff: every case ends at Checked into Milestones, and only then is it complete; a case shipped to
// the patient goes Shipped > Checked into Milestones and no longer completes at Shipped). The checks below describe the 3 Oct rules;
// test/e2e.js covers the current ones. Kept for its screenshots and history only.
// Amir, 3 Oct 2026: "Delivery appt" (not "Delivery"); a case shipped to the patient ends at Shipped — reaching it completes
// the case, and its date is the expected delivery; and his upper / lower arch pictures on the arch choices — demo
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
  // a change made here goes on the demo's stored copy too, so a save from the app keeps it
  const setCase = (id, o) => p.evaluate(([id, o]) => { Object.assign(findCase(id), o); Object.assign(DEMO.cases.get(id), JSON.parse(JSON.stringify(o))); queueRender(); }, [id, o]);

  // ---- the arch pictures on the arch choices
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.waitForTimeout(120);
  const arch = g => p.$$eval('#ncForm .pickRow[data-g=' + g + '] .pick', bs => bs.map(b => ({ v: b.dataset.v, text: b.textContent.trim(), imgs: Array.from(b.querySelectorAll('img.archIc')).map(i => ({ k: i.dataset.logo, ok: i.complete && i.naturalWidth > 0, h: Math.round(i.getBoundingClientRect().height) })) })));
  const ta = await arch('treatArch'); console.log('   arches to treat:', ta.map(x => x.v + '=' + x.imgs.map(i => i.k + (i.ok ? '' : '!') + ':' + i.h).join('+')).join(' | '));
  check(ta.length === 3 && ta.map(x => x.text).join('|') === 'Upper & lower|Upper only|Lower only', 'Arches to treat keeps its three choices (names unchanged)');
  check(ta[1].imgs.length === 1 && ta[1].imgs[0].k === 'arch-U' && ta[2].imgs.length === 1 && ta[2].imgs[0].k === 'arch-L' && ta.every(x => x.imgs.every(i => i.ok)), 'Upper only shows the upper arch (∩), Lower only the lower (U); the pictures load');
  check(ta[0].imgs.map(i => i.k).join(',') === 'arch-U,arch-L' && ta[0].imgs.every(i => i.h === 13) && ta[1].imgs[0].h === 22, 'Upper & lower shows both, upper over lower; small (22 px, 13 px stacked)');
  const tr = await p.$('#ncForm .pickRow[data-g=treatArch]'); await tr.scrollIntoViewIfNeeded(); const trb = await tr.boundingBox();
  await p.screenshot({ path: OUT + '/v23-arches-to-treat.png', clip: { x: trb.x - 16, y: trb.y - 34, width: 640, height: trb.height + 50 } });
  // ---- the date: Delivery appt (with its time), or Expected delivery (no time) once Ship to patient is on
  check(await p.textContent('#cf-delLbl') === 'Delivery appt' && await p.isVisible('#cf-deliveryTime') && await p.getAttribute('#cf-deliveryTime', 'aria-label') === 'Appointment time', 'New case: the date reads “Delivery appt”, with its time');
  await p.click('#cf-ship'); await p.waitForTimeout(60);
  check(await p.textContent('#cf-delLbl') === 'Expected delivery' && !(await p.isVisible('#cf-deliveryTime')), 'Ship to patient: it reads “Expected delivery” and the time goes away (no appointment)');
  check(/Shipped, then Checked into Milestones/.test(await p.textContent('#cf-ship')), 'the Ship to patient switch says Shipped, then Checked into Milestones (7 Oct 2026; it used to complete once it shipped)');
  await p.click('#cf-ship'); await p.waitForTimeout(60);
  check(await p.textContent('#cf-delLbl') === 'Delivery appt' && await p.isVisible('#cf-deliveryTime'), 'switching it off brings back “Delivery appt” and the time');
  await p.click('#ncForm .tt[data-tile=retainer]'); await p.waitForTimeout(100);
  const ra = await arch('arches');
  check(ra.map(x => x.v + ':' + x.imgs.map(i => i.k).join()).join('|') === 'Upper:arch-U|Lower:arch-L' && ra.every(x => x.imgs.every(i => i.ok)), 'Retainers & mouthguards: Upper and Lower show the arch pictures too');
  await p.click('.modal [data-act=closeModal]');

  // ---- chips and the case: "Appt …"; a case shipped to the patient says "Expected delivery"
  const ids = await p.evaluate(() => { const o = openCases(); const f = fn => (o.find(fn) || {}).id;
    return { appt: f(c => c.type === 'retainer' && c.deliveryDate), shipOliv: f(c => c.type === 'oliv' && c.shipToPatient), mfg: f(c => ['oliv', 'angel', 'ulab'].includes(c.type) && c.stage === 'mfg' && !c.shipToPatient), inShip: f(c => c.type === 'nla' && c.shipToPatient) }; });
  check(await p.evaluate(id => /^Appt /.test(dueChip(findCase(id)).replace(/<[^>]+>/g, '')), ids.appt), 'chips read “Appt Oct 9 · 10:30 AM”');
  await p.evaluate(id => openDrawer(id), ids.appt); await p.waitForSelector('#drawer .kv');
  check(/Delivery appt/.test(await p.textContent('#drawer .kv')), 'the case’s Details say “Delivery appt”');
  await p.click('#drawer [data-act=closeDrawer] >> nth=0');
  // the demo's Oliv case shipped to the patient sits in Shipped: that's its last step now (✓ completes it)
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=outside]'); await p.waitForTimeout(150);
  const so = await p.$eval('section[aria-label="Shipped"] .kc[data-id="' + ids.shipOliv + '"]', k => ({ act: k.querySelector('.adv').dataset.act, title: k.querySelector('.adv').title, due: (k.querySelector('.due') || {}).textContent || '' }));
  check(so.act === 'complete' && so.title === 'Mark complete' && /^Expected delivery/.test(so.due), 'board: a case shipped to the patient in Shipped is at its last step (✓ Mark complete); its chip reads Expected delivery');
  await p.evaluate(id => openDrawer(id), ids.shipOliv); await p.waitForSelector('#drawer .stepper');
  check(await p.evaluate(() => Array.from(document.querySelectorAll('#drawer .stepper .step')).map(b => b.dataset.k).join(',')) === 'submit,dra,mfg,shipped' && /Expected delivery/.test(await p.textContent('#drawer .kv')), 'its steps end at Shipped; its date is the Expected delivery');
  await p.click('#drawer [data-act=closeDrawer] >> nth=0');

  // ---- the board arrow before Shipped ships it and completes the case; Undo puts it back
  await setCase(ids.mfg, { shipToPatient: true });
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=outside]'); await p.waitForTimeout(150);
  const card = 'section[aria-label="Manufacturing"] .kc[data-id="' + ids.mfg + '"]';
  check(await p.getAttribute(card + ' .adv', 'title') === 'Shipped to the patient — completes the case', 'the arrow before Shipped says it ships and completes the case');
  await p.click(card + ' .adv'); await p.waitForSelector('.toast:has-text("shipped to the patient — case complete")', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(200);
  const after = await p.evaluate(id => { const d = DEMO.cases.get(id); return { status: d.status, stage: d.stage, open: openCases().some(c => c.id === id) }; }, ids.mfg);
  check(after.status === 'done' && after.stage === 'shipped' && !after.open, 'tapping it: Shipped and complete (off the board)');
  await p.click('.toast:has-text("case complete") button'); await p.waitForTimeout(300);
  const undone = await p.evaluate(id => { const d = DEMO.cases.get(id); return { status: d.status, stage: d.stage }; }, ids.mfg);
  check(undone.status === 'open' && undone.stage === 'mfg', 'Undo reopens it in Manufacturing');
  const hist = await p.evaluate(async id => { S.history = await B.caseLog(id); return historyHTML(findCase(id) || DEMO.cases.get(id)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }, ids.mfg);
  check(/moved it to Shipped and marked it complete \(shipped to the patient\)/.test(hist), 'history: “moved it to Shipped and marked it complete (shipped to the patient)”');

  // ---- Edit: picking a step past Shipped on such a case ships and completes it
  await p.evaluate(id => openDrawer(id), ids.mfg); await p.waitForSelector('#drawer .stepper');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stage');
  await p.selectOption('#drawer #cf-stage', 'arrived'); await p.click('#drawer [data-act=saveEdit]');
  await p.waitForSelector('.toast:has-text("case complete")', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(200);
  const ed = await p.evaluate(id => { const d = DEMO.cases.get(id); return { status: d.status, stage: d.stage, drawer: !!document.querySelector('#drawer') }; }, ids.mfg);
  check(ed.status === 'done' && ed.stage === 'shipped' && !ed.drawer, 'Edit → Arrived on a case shipped to the patient: saved as Shipped and complete');
  await p.click('.toast:has-text("case complete") button'); await p.waitForTimeout(300);
  check(await p.evaluate(id => DEMO.cases.get(id).status === 'open' && DEMO.cases.get(id).stage === 'mfg', ids.mfg), 'Undo puts it back where it was');

  // ---- in-house shipped to the patient: the last step reads "Shipped to patient"
  await p.evaluate(id => openDrawer(id), ids.inShip); await p.waitForSelector('#drawer .stepper');
  const ih = await p.evaluate(() => { const s = Array.from(document.querySelectorAll('#drawer .stepper .step')); return s[s.length - 1].textContent; });
  check(/Shipped to patient$/.test(ih), 'in-house, shipped to the patient: the last step reads “Shipped to patient” (' + ih + ')');
  await p.click('#drawer [data-act=closeDrawer] >> nth=0');

  // ---- lab emails: "shipped" / "delivered" on a case shipped to the patient completes it; other cases as before
  const me = await p.evaluate(id => { const c = Object.assign({}, findCase(id), { stage: 'mfg', shipToPatient: true }), plain = Object.assign({}, c, { shipToPatient: '' });
    const r = (x, kind) => { const e = mailEffect(x, { kind, co: 'oliv' }); return (e.to || '-') + (e.close ? '+done' : ''); };
    return [r(c, 'shipped'), r(c, 'delivered'), r(plain, 'shipped'), r(plain, 'delivered')].join(' '); }, ids.mfg);
  check(me === 'shipped+done shipped+done shipped arrived', 'lab emails: shipped/delivered → Shipped and complete when shipped to the patient; Shipped / Arrived otherwise (' + me + ')');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
