// Amir, 3 Oct 2026: "when a case reaches the last checklist then user should get a prompt to move it to complete. like if you
// mark the case as checked in milestones … this is true for all the appliances" — demo
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
  const st = id => p.evaluate(id => { const d = DEMO.cases.get(id); return { stage: d.stage, status: d.status }; }, id);
  const setCase = (id, o) => p.evaluate(([id, o]) => { Object.assign(findCase(id), o); Object.assign(DEMO.cases.get(id), JSON.parse(JSON.stringify(o))); queueRender(); }, [id, o]);
  const asked = async () => { await p.waitForSelector('#modalWrap h3', { timeout: 3000 }).catch(() => {}); return p.evaluate(() => { const h = document.querySelector('#modalWrap h3'); return h ? { title: h.textContent, text: (document.querySelector('#modalWrap .lsub') || {}).textContent || '', yes: (document.querySelector('#cbYes') || {}).textContent, no: (document.querySelector('#cbNo') || {}).textContent } : null; }); };
  const ids = await p.evaluate(() => { const o = openCases(); const f = fn => (o.find(fn) || {}).id;
    return { oliv: f(c => c.type === 'oliv' && c.stage === 'arrived'), appl: f(c => c.type === 'appliance' && c.stage === 'mfg'), marpe: f(c => c.type === 'marpe' && c.stage === 'approved'),
      ret: f(c => c.type === 'retainer' && c.stage === 'sarah'), models: f(c => c.type === 'models'), nla: f(c => c.type === 'nla' && c.stage === 'pack' && !c.shipToPatient) || f(c => c.type === 'nla' && c.stage === 'thermo'),
      ship: f(c => c.type === 'nla' && c.shipToPatient), mid: f(c => c.type === 'oliv' && c.stage === 'mfg' && !c.shipToPatient) }; });
  console.log('   ' + JSON.stringify(Object.keys(ids).filter(k => !ids[k])));

  // ---- Oliv: tapping Checked into Milestones in the case's steps asks; "Not yet" leaves it there
  await p.evaluate(id => openDrawer(id), ids.oliv); await p.waitForSelector('#drawer .stepper');
  await p.click('#drawer .step[data-k=milestones]');
  let q = await asked();
  check(q && q.title === 'Mark this case complete?' && /is at its last step, Checked into Milestones\./.test(q.text) && q.yes === 'Mark complete' && q.no === 'Not yet', 'Oliv → Checked into Milestones: “Mark this case complete?” (Mark complete / Not yet)');
  check(await p.$eval('#cbYes', b => b.classList.contains('btn-mint')), 'Mark complete is the mint button, like everywhere else');
  await p.screenshot({ path: OUT + '/v27-ask.png', clip: { x: 340, y: 0, width: 700, height: 360 } });
  await p.click('#cbNo'); await p.waitForTimeout(250);
  let s = await st(ids.oliv);
  check(s.stage === 'milestones' && s.status === 'open' && await p.isVisible('#drawer'), '“Not yet”: it stays open at Checked into Milestones');
  await p.evaluate(() => closeDrawer(true));

  // ---- Appliance: the board arrow from Shipped (the step before the last) asks; Mark complete finishes it, Undo reopens it
  await setCase(ids.appl, { stage: 'shipped' });
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=appliance]'); await p.waitForSelector('.kc[data-id="' + ids.appl + '"]');
  await p.click('.kc[data-id="' + ids.appl + '"] .adv');
  q = await asked();
  check(q && /last step, Checked into Milestones/.test(q.text), 'appliance: the board arrow onto Checked into Milestones asks too');
  await p.click('#cbYes'); await p.waitForSelector('.toast:has-text("marked complete")', { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(200);
  s = await st(ids.appl);
  check(s.stage === 'milestones' && s.status === 'done' && !(await p.isVisible('.kc[data-id="' + ids.appl + '"]')), '“Mark complete”: completed (off the board), at Checked into Milestones');
  await p.click('.toast:has-text("marked complete") button'); await p.waitForTimeout(300);
  check((await st(ids.appl)).status === 'open', 'Undo reopens it');

  // ---- MARPE (Delivered), retainers (Front desk pickup), study models (Ready), in-house (Checked in): all ask
  for (const [k, from, last, label, flow] of [['marpe', 'approved', 'delivered', 'Delivered', 'marpe'], ['ret', 'sarah', 'pickup', 'Front desk pickup', 'retainer'], ['models', 'print', 'ready', 'Ready', 'models'], ['nla', 'pack', 'checkedin', 'Checked in', 'inhouse']]) {
    const id = ids[k]; if (!id) { check(false, k + ': a demo case'); continue; }
    await setCase(id, { stage: from });
    await p.click('#nav-board'); await p.click('[data-act=flow][data-k=' + flow + ']'); await p.waitForSelector('.kc[data-id="' + id + '"]');
    await p.click('.kc[data-id="' + id + '"] .adv'); q = await asked();
    const ok = q && new RegExp('last step, ' + label + '\\.').test(q.text);
    await p.click('#cbNo'); await p.waitForTimeout(200);
    s = await st(id);
    check(ok && s.stage === last && s.status === 'open', label + ' (' + k + '): reaching the last step asks; “Not yet” keeps it open there');
  }

  // ---- Edit: picking the last step in the form and saving asks too
  await setCase(ids.oliv, { stage: 'arrived' });
  await p.evaluate(id => openDrawer(id), ids.oliv); await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-stage', { state: 'attached' });
  await p.selectOption('#drawer #cf-stage', 'milestones'); await p.click('#drawer [data-act=saveEdit]');
  q = await asked();
  check(q && /last step, Checked into Milestones/.test(q.text), 'Edit → Checked into Milestones → Save: it asks');
  await p.click('#cbYes'); await p.waitForTimeout(400);
  check((await st(ids.oliv)).status === 'done' && !(await p.isVisible('#drawer')), '… and Mark complete completes it (the case closes)');

  // ---- not asked: a move that isn't the last step, and a case shipped to the patient (completed when it ships)
  await p.evaluate(id => openDrawer(id), ids.mid); await p.waitForSelector('#drawer .stepper');
  await p.click('#drawer .step[data-k=shipped]'); await p.waitForTimeout(600);
  check(!(await p.isVisible('#modalWrap')) && (await st(ids.mid)).stage === 'shipped', 'a move to a middle step (Shipped) doesn’t ask');
  await p.evaluate(() => closeDrawer(true));
  if (ids.ship) {
    await p.click('#nav-board'); await p.click('[data-act=flow][data-k=inhouse]'); await p.waitForSelector('.kc[data-id="' + ids.ship + '"]');
    await p.click('.kc[data-id="' + ids.ship + '"] .adv'); await p.waitForTimeout(600);
    check(!(await p.isVisible('#modalWrap h3')) && (await st(ids.ship)).status === 'done', 'shipped to the patient: completed when it ships, no extra question');
  } else check(false, 'a ship-to-patient demo case');
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
