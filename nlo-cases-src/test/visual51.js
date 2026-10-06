// Not shipped (Amir, 6 Oct 2026: "there should be separate label (possibly orange or red) that would appear if the case is from outside lab
// and the is not marked shipped 2 business days before appointment date" — "not sure if the 2 days is the best option"): orange from 4
// business days before the delivery appt, red from 2, both set in Team & security. Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };

  console.log('\n# Business days: Monday–Friday, the office holidays left out');
  const bd = await p.evaluate(() => [bizBefore('2026-10-08', 2), bizBefore('2026-10-12', 2), bizBefore('2026-10-08', 4), bizBefore('2026-11-30', 2), bizBefore('2027-01-04', 2), bizBefore('2026-09-08', 1)]);
  check(JSON.stringify(bd) === JSON.stringify(['2026-10-06', '2026-10-08', '2026-10-02', '2026-11-23', '2026-12-30', '2026-09-04']),
    '2 before Thu Oct 8 = Tue; 2 before Mon Oct 12 = Thu; 4 before Thu = the Friday before; Thanksgiving week and New Year’s skipped; Labor Day skipped (' + bd.join(', ') + ')');

  console.log('\n# Which cases, and when');
  const w = await p.evaluate(() => {
    const at = (o, today) => { const x = shipWarn(Object.assign({ id: 't', status: 'open', type: 'oliv', stage: 'mfg', deliveryDate: '2026-10-08' }, o), today); return x ? x.lv : '—'; };
    return {
      oliv: ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12'].map(t => at({}, t)).join(' '),
      shipped: at({ stage: 'shipped' }, '2026-10-07'), arrived: at({ stage: 'arrived' }, '2026-10-07'), submit: at({ stage: 'submit' }, '2026-10-07'),
      angel: at({ type: 'angel', stage: 'dra' }, '2026-10-07'), invisalign: at({ type: 'invisalign' }, '2026-10-07'), insmile: at({ type: 'insmile' }, '2026-10-07'),
      appliance: at({ type: 'appliance', stage: 'submitted' }, '2026-10-07'), applShipped: at({ type: 'appliance', stage: 'shipped' }, '2026-10-07'),
      marpe: at({ type: 'marpe', stage: 'approved' }, '2026-10-07'), inhouse: at({ type: 'nla', stage: 'wash' }, '2026-10-07'), retainer: at({ type: 'retainer', stage: 'print' }, '2026-10-07'),
      done: at({ status: 'done' }, '2026-10-07'), noAppt: at({ deliveryDate: '' }, '2026-10-07'), shipToPt: at({ shipToPatient: true }, '2026-10-07')
    };
  });
  check(w.oliv === '— soon soon late late late late', 'an Oliv case in Manufacturing, appt Thu Oct 8: nothing until Fri Oct 2, orange from then, red from Tue Oct 6 — and after the appt too (' + w.oliv + ')');
  check(w.shipped === '—' && w.arrived === '—' && w.submit === 'late', 'marked Shipped (or past it): no label; still To submit: red');
  check(w.angel === 'late' && w.invisalign === 'late' && w.insmile === 'late' && w.appliance === 'late' && w.applShipped === '—', 'every outside lab, and appliances (until Shipped)');
  check(w.marpe === '—' && w.inhouse === '—' && w.retainer === '—', 'not for MARPE, in-house sets or retainers (no Shipped step)');
  check(w.done === '—' && w.noAppt === '—' && w.shipToPt === 'late', 'not on completed cases or ones with no appt; shipped to the patient: counted back from the expected delivery');

  console.log('\n# The labels where the case shows');
  const setup = await p.evaluate(() => {
    const bizAfter = (iso, n) => { let d = iso; while (n > 0) { d = addDays(d, 1); if (isBizDay(d)) n--; } return d; };
    const set = (c, o) => { Object.assign(c, o); Object.assign(DEMO.cases.get(c.id), o); };
    const red = openCases().find(c => c.type === 'oliv' && c.stage === 'mfg'), orange = openCases().find(c => c.type === 'angel' && c.stage === 'mfg'), fine = openCases().find(c => c.type === 'appliance' && c.stage === 'mfg');
    set(red, { deliveryDate: bizAfter(todayISO(), 1), deliveryTime: '10:30' }); set(orange, { deliveryDate: bizAfter(todayISO(), 3) }); set(fine, { deliveryDate: bizAfter(todayISO(), 6) });
    queueRender(); return { red: red.id, orange: orange.id, fine: fine.id, redName: red.patient, orangeName: orange.patient };
  });
  await p.waitForTimeout(200);
  const flag = (sel, id) => p.evaluate(([sel, id]) => { const el = document.querySelector(sel.replace('ID', id)); const f = el && el.querySelector('.flag.noship'); return f ? f.className.replace('flag noship ', '') + ':' + f.textContent : ''; }, [sel, id]);
  check(await flag('#view .row[data-id="ID"]', setup.red) === 'late:Not shipped', 'Today: red “Not shipped” on ' + setup.redName + ' (appt the next business day)');
  check(await p.evaluate(id => { const r = document.querySelector('#view .row[data-id="' + id + '"]'); const n = r.querySelector('.pt').getBoundingClientRect(), f = r.querySelector('.flag.noship').getBoundingClientRect(); return f.top >= n.bottom - 1; }, setup.red), 'on its own line under the name (a narrow column doesn’t cut the name short)');
  await p.click('#nav-board'); await p.waitForSelector('.board');
  check(await flag('.kc[data-id="ID"]', setup.red) === 'late:Not shipped' && await flag('.kc[data-id="ID"]', setup.orange) === 'soon:Not shipped yet' && await flag('.kc[data-id="ID"]', setup.fine) === '',
    'Board: red on the next-business-day appt, orange 3 business days out, nothing 6 out');
  const tip = await p.evaluate(id => document.querySelector('.kc[data-id="' + id + '"] .flag.noship').title, setup.orange);
  check(/^Not marked shipped yet — the delivery appt is \w{3}, \w{3} \d+; it should ship by \w{3}, \w{3} \d+\.$/.test(tip), 'it says why on hover (' + tip + ')');
  await p.screenshot({ path: OUT + '/v51-board.png' });
  await p.click('[data-act=flow][data-k=appliance]'); await p.waitForSelector('.board');
  check(await flag('.kc[data-id="ID"]', setup.fine) === '', 'an appliance 6 business days out: nothing yet');
  await p.click('#nav-list'); await p.waitForSelector('#listBody');
  check(await flag('#listBody tr[data-id="ID"] td.stg', setup.red) === 'late:Not shipped' && await flag('#listBody tr[data-id="ID"] td.stg', setup.orange) === 'soon:Not shipped yet', 'All open cases: under the stage');
  // the filter: only while some case has the label
  const n = await p.evaluate(() => openCases().filter(c => shipWarn(c)).length);
  check(await p.textContent('[data-act=noshipF]') === 'Not shipped' + n, 'a Not shipped filter, with how many (' + n + ')');
  await p.click('[data-act=noshipF]'); await p.waitForTimeout(100);
  const only = await p.evaluate(() => Array.from(document.querySelectorAll('#listBody tr[data-id]')).map(r => !!r.querySelector('.flag.noship')));
  check(only.length === n && only.every(Boolean), 'tapping it: just those cases');
  await p.screenshot({ path: OUT + '/v51-list.png' });
  await p.click('[data-act=noshipF]'); await p.waitForTimeout(100);
  await p.evaluate(id => openDrawer(id), setup.red); await p.waitForSelector('#drawer .notice.noship');
  const nt = await p.textContent('#drawer .notice.noship');
  check(/^Not shipped — the delivery appt is (tomorrow|\w{3}, \w{3} \d+)\. Check with the lab, or reschedule\.$/.test(nt), 'the case panel says it at the top (' + nt + ')');
  await p.screenshot({ path: OUT + '/v51-panel.png', clip: { x: 800, y: 0, width: 560, height: 420 } });
  // contrast of the two labels
  const cr = await p.evaluate(() => {
    const L = s => { const m = s.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
    const c = el => { const s = getComputedStyle(el), a = L(s.color), b = L(s.backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
    return [c(document.querySelector('#drawer .notice.noship')), c(document.querySelector('#listBody .flag.noship.late')), c(document.querySelector('#listBody .flag.noship.soon'))];
  });
  check(cr.length === 3 && cr.every(x => x >= 4.5), 'the text on them is readable: the panel, red and orange (contrast ' + cr.map(x => x.toFixed(1)).join(', ') + ':1)');

  console.log('\n# Marked Shipped: the label goes');
  await p.evaluate(id => moveStage(id, 'shipped'), setup.red); await p.waitForTimeout(250);
  check(!(await p.$('#drawer .notice.noship')) && await p.evaluate(id => !shipWarn(findCase(id)), setup.red), 'moved to Shipped: gone from the panel');
  await p.evaluate(() => closeDrawer()); await p.click('#nav-board'); await p.click('[data-act=flow][data-k=outside]'); await p.waitForSelector('.board');
  check(await flag('.kc[data-id="ID"]', setup.red) === '', '…and from the board');

  console.log('\n# Team & security: when they show');
  await p.click('#nav-admin'); await p.waitForSelector('#shipWarnCard');
  check(await p.inputValue('#shipSoonSel') === '4' && await p.inputValue('#shipLateSel') === '2', 'Not shipped warning: orange from 4 business days before, red from 2');
  await p.selectOption('#shipLateSel', '4'); await p.waitForTimeout(150);
  await p.selectOption('#shipSoonSel', '0'); await p.waitForTimeout(150);
  check(await p.evaluate(() => DEMO.settings.shipLate === 4 && DEMO.settings.shipSoon === 0), 'saved (red 4, orange off)');
  await p.click('#nav-board'); await p.waitForSelector('.board');
  check(await flag('.kc[data-id="ID"]', setup.orange) === 'late:Not shipped' && !(await p.$('.flag.noship.soon')), 'red from 4: the case 3 business days out is red now, and no orange anywhere');
  await p.click('#nav-admin'); await p.waitForSelector('#shipWarnCard');
  await p.selectOption('#shipLateSel', '2'); await p.waitForTimeout(150); await p.selectOption('#shipSoonSel', '7'); await p.waitForTimeout(150);
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=appliance]'); await p.waitForSelector('.board');
  check(await flag('.kc[data-id="ID"]', setup.fine) === 'soon:Not shipped yet', 'orange from 7: the appliance 6 business days out turns orange');
  await p.click('#nav-admin'); await p.waitForSelector('#shipWarnCard'); await p.selectOption('#shipSoonSel', '4'); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('#shipWarnCard').scrollIntoView());
  await p.screenshot({ path: OUT + '/v51-setting.png' });

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('#mnav-board'); await p.click('[data-act=flow][data-k=outside]'); await p.waitForSelector('.board');
  const ph = await p.evaluate(id => { const f = document.querySelector('.kc[data-id="' + id + '"] .flag.noship'), k = f && f.closest('.kc'); return f ? { fits: f.getBoundingClientRect().right <= k.getBoundingClientRect().right, over: document.documentElement.scrollWidth - innerWidth } : null; }, setup.orange);
  check(ph && ph.fits && ph.over <= 0, 'phone: the label fits on its card');
  await p.screenshot({ path: OUT + '/v51-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
