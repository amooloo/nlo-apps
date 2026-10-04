// The lists' two date columns: Lab date and Delivery appt side by side (Amir, 4 Oct 2026: "if the lab date is past due,
// I'm not seeing what is the appointment date") — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const signIn = async () => { await p.click('#lgBtn'); await p.waitForSelector('.tiles'); };
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await signIn();

  // ---- the old "next date" is exactly the lab side, else the appointment side (the board and Today keep using it)
  const same = await p.evaluate(() => {
    const oldDueOf = c => { // dueOf as it was before the split (3 Oct 2026)
      const f = flowOf(c), at = k => f.stages.findIndex(s => s[0] === k), si = stageIndex(c), done = f.labDone ? at(f.labDone) : -1;
      if (c.zoomDate && f.zoomUntil && si < at(f.zoomUntil)) return { d: c.zoomDate, k: 'zoom' };
      if (c.labDate && (done < 0 || si < done)) return { d: c.labDate, k: 'lab' };
      if (c.deliveryDate) return { d: c.deliveryDate, k: 'delivery' };
      if (c.dueDate) return { d: c.dueDate, k: 'due' };
      return null;
    };
    let n = 0, bad = [];
    for (const t of TYPES) for (const st of FLOWS[t.flow].stages.map(s => s[0]).concat(['reset', 'nope'])) for (const lab of ['', '2026-10-01']) for (const del of ['', '2026-10-09'])
      for (const zoom of ['', '2026-10-05']) for (const due of ['', '2026-10-07']) {
        const c = { type: t.k, stage: st, labDate: lab, deliveryDate: del, zoomDate: zoom, dueDate: due }; n++;
        if (JSON.stringify(oldDueOf(c)) !== JSON.stringify(dueOf(c))) bad.push(t.k + ':' + st);
      }
    return { n, bad };
  });
  check(!same.bad.length, 'next date unchanged for the board and Today: ' + same.n + ' combinations of type, stage and dates' + (same.bad.length ? ' — differs: ' + same.bad.slice(0, 5).join(', ') : ''));

  // ---- known cases (made-up demo patients): Amir's case — lab late, appointment ahead; past the lab step; MARPE; ship to patient
  // (the demo's own lab emails move and reload cases now and then, so each case is picked by type, given its stage and dates
  // here, and changed in the demo's stored copy too; after a reload the same ids get the same again)
  const setup = prev => p.evaluate(prev => {
    const t = todayISO(), all = openCases(), used = new Set();
    const pick = (role, type, stage) => { const c = prev ? findCase(prev[role]) : all.find(x => x.type === type && x.stage === stage && !used.has(x.id)) || all.find(x => x.type === type && !used.has(x.id)); used.add(c.id); return c; };
    const put = (c, x) => { Object.assign(c, x); const d = DEMO.cases.get(c.id); if (d && d !== c) Object.assign(d, x); return c; };
    const late = put(pick('late', 'nla', 'txp'), { stage: 'txp', labDate: addDays(t, -2), deliveryDate: addDays(t, 5), deliveryTime: '10:30' });
    const mfg = put(pick('mfg', 'oliv', 'mfg'), { stage: 'mfg', labDate: addDays(t, -6), deliveryDate: addDays(t, 9), deliveryTime: '' });
    const zoom = put(pick('zoom', 'marpe', 'zoom'), { stage: 'zoom', zoomDate: addDays(t, 2), zoomTime: '12:30', deliveryDate: addDays(t, 20), deliveryTime: '' });
    const appr = put(pick('appr', 'marpe', 'approved'), { stage: 'approved', deliveryDate: addDays(t, 12) });
    const rec = put(pick('rec', 'marpe', 'records'), { stage: 'records', labDate: '', zoomDate: '', deliveryDate: '' });
    const ship = put(pick('ship', 'oliv', 'submit'), { stage: 'submit', shipToPatient: true, deliveryDate: '', deliveryTime: '' });
    const shipD = put(pick('shipD', 'ulab', 'submit'), { stage: 'submit', shipToPatient: true, deliveryDate: addDays(t, 8), deliveryTime: '' });
    queueRender();
    return { late: late.id, mfg: mfg.id, zoom: zoom.id, appr: appr.id, rec: rec.id, ship: ship.id, shipD: shipD.id, apptDay: fmtDate(addDays(t, 5)) };
  }, prev || null);
  const ids = await setup();
  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click'); await p.waitForTimeout(200);
  const heads = () => p.$$eval('#listBody thead th', ths => ths.map(t => t.textContent.replace(/[↑↓]/g, '').trim()));
  const h0 = await heads();
  console.log('   columns:', h0.join(' | '));
  check(h0.join('|') === 'Patient|Type|Stage|Lab date|Delivery appt|Tx progress|Shipping|Assigned|Updated', 'All open cases: Lab date and Delivery appt are two columns, side by side');
  const cell = (id, col) => p.evaluate(([id, col]) => { const td = document.querySelector('#listBody tr[data-id="' + id + '"] td.' + col); if (!td) return null; const d = td.querySelector('.due'), m = td.querySelector('.dueTm'); return { t: d ? d.textContent.trim() : '', tm: m ? m.textContent.trim() : '', cls: d ? d.className : '', tip: d ? d.getAttribute('title') || '' : '' }; }, [id, col]);
  let a = await cell(ids.late, 'labCol'), b = await cell(ids.late, 'apptCol');
  console.log('   lab late:', a.t, '|', b.t, '/', b.tm);
  check(a.t === 'Lab 2 days late' && /\bover\b/.test(a.cls), 'a late lab date stays red in Lab date (“' + a.t + '”)');
  check(b.t === 'Appt ' + ids.apptDay && b.tm === '10:30 AM' && /, 10:30 AM$/.test(b.tip) && !/\bover\b/.test(b.cls), 'and its appointment shows right next to it (“' + b.t + '”, the time “' + b.tm + '” on the line under it)');
  a = await cell(ids.mfg, 'labCol'); b = await cell(ids.mfg, 'apptCol');
  check(a.t === 'Done' && /\bdone\b/.test(a.cls) && /Past the lab step — lab date was/.test(a.tip) && /^Appt /.test(b.t), 'past the lab step (Oliv in Manufacturing): a quiet ✓ Done, the appt beside it (' + a.tip + ' | ' + b.t + ')');
  a = await cell(ids.zoom, 'labCol'); b = await cell(ids.zoom, 'apptCol');
  check(/^Zoom /.test(a.t) && a.tm === '12:30 PM' && /^Appt /.test(b.t), 'MARPE before the design is approved: the Zoom call under Lab date, the appt beside it (' + a.t + ' ' + a.tm + ' | ' + b.t + ')');
  a = await cell(ids.appr, 'labCol'); check(a.t === 'Done', 'MARPE with the design approved: Done');
  a = await cell(ids.rec, 'labCol'); b = await cell(ids.rec, 'apptCol');
  check(a.t === 'No lab date' && b.t === 'No delivery appt', 'no dates yet: “No lab date” and “No delivery appt”');
  b = await cell(ids.ship, 'apptCol'); const b2 = await cell(ids.shipD, 'apptCol');
  check(b.t === 'No expected delivery' && /^Expected delivery /.test(b2.t), 'shipped to the patient: expected delivery instead of an appt (' + b.t + ' | ' + b2.t + ')');
  await p.evaluate(id => document.querySelector('#listBody tr[data-id="' + id + '"]').scrollIntoView({ block: 'center' }), ids.late);
  await p.screenshot({ path: OUT + '/v37-list.png', clip: { x: 232, y: 0, width: 1128, height: 900 } });

  // ---- sorting by each column
  const order = k => p.evaluate(k => Array.from(document.querySelectorAll('#listBody tr.click')).map(r => (k === 'lab' ? labKeyOf : apptKeyOf)(findCase(r.dataset.id)) || '9999'), k);
  const sorted = (xs, dir) => xs.every((x, i) => !i || (dir > 0 ? xs[i - 1] <= x : xs[i - 1] >= x));
  const arrowOn = async () => (await p.$$eval('#listBody thead th', ths => ths.filter(t => /[↑↓]/.test(t.textContent)).map(t => t.textContent.trim()))).join(',');
  await p.click('#listBody th [data-act=sort][data-k=lab]'); await p.waitForTimeout(100);
  check(sorted(await order('lab'), 1) && /^Lab date ↑/.test(await arrowOn()), 'Lab date heading sorts by the lab date (soonest first, ↑)');
  await p.click('#listBody th [data-act=sort][data-k=lab]'); await p.waitForTimeout(100);
  check(sorted(await order('lab'), -1) && /^Lab date ↓/.test(await arrowOn()), 'again: latest first (↓)');
  await p.click('#listBody th [data-act=sort][data-k=appt]'); await p.waitForTimeout(100);
  check(sorted(await order('appt'), 1) && /^Delivery appt ↑/.test(await arrowOn()), 'Delivery appt heading sorts by the appointment');
  // filtered by delivery appt: the list is in appointment order, the arrow says so, and lab dates still show
  await p.evaluate(() => { S.sort = { k: 'due', dir: 1 }; renderView(); });
  check((await arrowOn()) === '', 'the default order (next date) marks no column');
  await p.selectOption('select[data-f=del]', 'all'); await p.waitForTimeout(150);
  check(/^Delivery appt ↑/.test(await arrowOn()) && sorted(await order('appt'), 1), '“All, sorted by delivery appt”: sorted by the appt, its heading shows ↑');
  check((await heads()).includes('Lab date') && (await cell(ids.late, 'labCol')).t === 'Lab 2 days late', 'while filtered by delivery appt the late lab date still shows');
  await p.click('#listBody th [data-act=sort][data-k=appt]'); await p.waitForTimeout(100);
  check(/^Delivery appt ↓/.test(await arrowOn()) && sorted(await order('appt'), -1), 'one click on that heading flips it (↓)');
  await p.click('[data-act=clearF]'); await p.waitForTimeout(100);
  await p.evaluate(() => { S.sort = { k: 'due', dir: 1 }; renderView(); });

  // ---- the lab-or-appt filter keeps working (Today's Late tile opens it)
  check((await p.$eval('select[data-f=due] option[value=""]', o => o.textContent)) === 'Any lab or appt date', 'the date filter reads “Any lab or appt date”');
  await p.selectOption('select[data-f=due]', 'over'); await p.waitForTimeout(100);
  const lateIds = await p.$$eval('#listBody tr.click', rs => rs.map(r => r.dataset.id));
  const wantLate = await p.evaluate(() => openCases().filter(c => dueBucket(c) === 'over').map(c => c.id));
  check(lateIds.includes(ids.late) && lateIds.length === wantLate.length && (await p.$$eval('#listBody tr.click', rs => rs.every(r => r.querySelector('.due.over')))), 'Late: ' + lateIds.length + ' cases, each with a red date in one of the two columns');
  await p.click('[data-act=clearF]'); await p.waitForTimeout(100);
  await p.click('#nav-today'); await p.waitForSelector('.tile.red'); await p.click('.tile.red'); await p.waitForSelector('#listBody tr.click');
  check((await p.inputValue('select[data-f=due]')) === 'over' && (await p.locator('#listBody tr.click').count()) === wantLate.length, 'Today’s Late tile still opens the same list');
  await p.click('[data-act=clearF]'); await p.waitForTimeout(100);

  // ---- hiding: each date column on its own; an old hidden "Next date" isn't carried over
  const cells = () => p.$$eval('#listBody tbody tr:first-child > td', tds => tds.length);
  await p.click('#listBody th [data-act=hideCol][data-k=lab]'); await p.waitForTimeout(150);
  let h = await heads();
  check(!h.includes('Lab date') && h.includes('Delivery appt') && (await cells()) === h.length && /“Lab date” column hidden/.test(await p.textContent('.toast')), 'the eye hides Lab date alone (Delivery appt stays)');
  await p.click('.colBtn'); await p.waitForSelector('.colMenu');
  const opts = await p.$$eval('.colMenu .colOpt', ls => ls.map(l => l.textContent.trim()));
  check(opts.join('|') === 'Type|Stage|Lab date|Delivery appt|Tx progress|Shipping|Assigned|Updated|Tx cost', 'the Columns menu lists both (' + opts.join(', ') + ')'); // + Tx progress, optional Tx cost (4 Oct 2026)
  await p.click('.colMenu [data-act=showCols]'); await p.waitForTimeout(100);
  check((await heads()).length === 9, 'Show all: all 9 columns (Tx cost stays optional)');
  await p.evaluate(() => localStorage.setItem('nloCases.hiddenCols', JSON.stringify(['due', 'type'])));
  await p.reload(); await signIn(); await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  h = await heads();
  check(!h.includes('Type') && h.includes('Lab date') && h.includes('Delivery appt'), 'a computer that had hidden “Next date” shows both new columns (Type stays hidden)');
  await p.click('.colBtn'); await p.click('.colMenu [data-act=showCols]'); await p.waitForTimeout(100);
  await p.click('#nav-mine'); await p.waitForSelector('#listBody tr.click, #listBody .empty');
  check((await heads()).join('|').includes('Lab date|Delivery appt'), 'My cases: the same two columns');

  // ---- phones: both dates under the stage; nothing sideways
  const ids2 = await setup(ids);
  await p.click('#nav-list'); await p.waitForSelector('#listBody tr.click');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  const mob = id => p.$$eval('#listBody tr[data-id="' + id + '"] td.stg .onlyM .due', ds => ds.filter(d => d.offsetParent).map(d => d.textContent.trim()));
  const ml = await mob(ids2.late), mm = await mob(ids2.mfg);
  console.log('   phone:', ml.join(' + '), '||', mm.join(' + '));
  check(ml.length === 2 && ml[0] === 'Lab 2 days late' && /^Appt /.test(ml[1]), 'phone: a late lab and its appt, both under the stage');
  check(mm.length === 1 && /^Appt /.test(mm[0]), 'phone: past the lab step, just the appt');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390) && !(await p.locator('#listBody td.labCol').first().isVisible()), 'phone: the date columns fold away, no sideways scrolling');
  await p.evaluate(id => document.querySelector('#listBody tr[data-id="' + id + '"]').scrollIntoView({ block: 'center' }), ids2.late);
  await p.screenshot({ path: OUT + '/v37-phone.png' });
  // a narrower PC window (1100 px): the table scrolls inside its card rather than the page
  await p.setViewportSize({ width: 1100, height: 800 }); await p.waitForTimeout(250);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 1100), '1100 px window: the page itself doesn’t scroll sideways');
  await p.screenshot({ path: OUT + '/v37-1100.png' });
  await p.setViewportSize({ width: 1920, height: 1000 }); await p.waitForTimeout(250);
  await p.evaluate(id => document.querySelector('#listBody tr[data-id="' + id + '"]').scrollIntoView({ block: 'center' }), ids2.late);
  await p.screenshot({ path: OUT + '/v37-1920.png' });

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
