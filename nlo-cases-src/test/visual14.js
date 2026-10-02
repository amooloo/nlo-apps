// Delivery time (30-minute steps) and retainer / whitening tray labels that offer to complete the case — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };

  // ---- New case: the delivery time picker
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.fill('#cf-patient', 'Delia Timecheck');
  const opts = await p.$$eval('#cf-deliveryTime option', o => o.map(x => x.value + '|' + x.textContent));
  check(opts.length === 26 && opts[0] === '|Time (optional)' && opts[1] === '07:00|7:00 AM' && opts[2] === '07:30|7:30 AM' && opts[25] === '19:00|7:00 PM', 'delivery time: every 30 minutes, 7:00 AM to 7:00 PM (' + opts.length + ' choices)');
  await p.click('#ncForm [data-scan="0"]'); await p.waitForTimeout(100);
  const dd = await p.inputValue('#cf-deliveryDate');
  await p.selectOption('#cf-deliveryTime', '14:30');
  const sec = await p.$('#cf-deliveryTime'); await sec.scrollIntoViewIfNeeded(); await p.waitForTimeout(150);
  const g = await (await p.$('#cf-scanDate')).evaluate(el => { const b = el.closest('.cfSec').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await p.screenshot({ path: OUT + '/v14-form-dates.png', clip: { x: g.x - 10, y: g.y - 10, width: g.w + 20, height: g.h + 20 } });
  await p.click('#ncSave'); await p.waitForSelector('.toast:has-text("Case created")');
  const nc = await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Delia Timecheck'); return { d: c.deliveryDate, t: c.deliveryTime, id: c.id }; });
  check(nc.d === dd && nc.t === '14:30', 'saved: delivery ' + nc.d + ' at ' + nc.t);
  await p.evaluate(id => openDrawer(id), nc.id); await p.waitForSelector('#drawer .kv');
  const kvText = (await p.textContent('#drawer .kv')).replace(/\s+/g, ' ');
  check(/Delivery[A-Za-z]{3}, [A-Za-z]{3} \d+, 2:30 PM/.test(kvText), 'the case shows the delivery day and time');
  // edit: change the time; clearing the date clears the time
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-deliveryTime');
  check(await p.inputValue('#drawer #cf-deliveryTime') === '14:30', 'Edit opens with the saved time');
  await p.selectOption('#drawer #cf-deliveryTime', '09:00'); await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('.toast:has-text("Saved")');
  check(await p.evaluate(id => findCase(id).deliveryTime, nc.id) === '09:00', 'Edit changes the time (9:00 AM)');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-deliveryDate');
  await p.fill('#drawer #cf-deliveryDate', ''); await p.click('#drawer [data-act=saveEdit]'); await p.waitForTimeout(400);
  check(await p.evaluate(id => { const c = findCase(id); return !c.deliveryDate && !c.deliveryTime; }, nc.id), 'clearing the delivery date clears its time too');
  await p.click('#drawer [data-act=closeDrawer] >> nth=0');

  // ---- chips and sorting: same delivery day, different times
  const t = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoOf(d); });
  await p.evaluate(day => { const cs = openCases().filter(c => c.type === 'retainer').slice(0, 3); const tm = ['15:30', '08:30', '']; cs.forEach((c, i) => { c.deliveryDate = day; c.deliveryTime = tm[i]; }); queueRender(); return cs.map(c => c.patient); }, t);
  await p.click('#nav-list'); await p.selectOption('select[data-f=del]', 'tomorrow'); await p.waitForTimeout(200);
  const rows = await p.$$eval('#listBody tr.click', rs => rs.map(r => { const c = findCase(r.dataset.id); return (c.deliveryTime || '—') + ' ' + r.querySelector('td.hideM .due').textContent; }));
  console.log('   tomorrow:', rows.join(' | '));
  const times = rows.map(r => r.split(' ')[0]);
  check(times.indexOf('08:30') < times.indexOf('15:30') && times.indexOf('15:30') < times.indexOf('—'), 'sorted by time within the day (8:30 AM, 3:30 PM, then no time)');
  check(rows.some(r => /Delivery tomorrow 8:30 AM/.test(r)) && rows.some(r => /Delivery tomorrow 3:30 PM/.test(r)), 'chips: “Delivery tomorrow 8:30 AM”');
  await p.screenshot({ path: OUT + '/v14-list-times.png', clip: { x: 232, y: 0, width: 1128, height: 420 } });
  const later = await p.evaluate(() => { const c = openCases().find(x => x.deliveryTime && dayDiff(x.deliveryDate) > 3); return c ? delChip(c).replace(/<[^>]+>/g, '') : ''; });
  check(/· \d{1,2}:\d{2} [AP]M$/.test(later), 'later days show the time too: “' + later + '”');
  await p.selectOption('select[data-f=del]', ''); await p.waitForTimeout(100);

  // ---- export: delivery column carries the time
  check(await p.evaluate(() => { const c = openCases().find(x => x.deliveryTime); return caseToCSVRow(c).includes('"' + c.deliveryDate + ' ' + c.deliveryTime + '"'); }), 'export: the Delivery column has the date and time');

  // ---- retainer labels → offer to complete
  const rid = await p.evaluate(() => openCases().find(c => c.type === 'retainer').id);
  await p.evaluate(id => openDrawer(id), rid); await p.waitForSelector('#retLblBox [data-act=retLabels]');
  await p.click('#retLblBox [data-act=retLabels]'); await p.waitForSelector('#rl-prev .print-label');
  check((await p.locator('#rl-prev .print-label').count()) === 2 && /Print 2 labels/.test(await p.textContent('#rl-print')), 'U/L retainers and whitening trays → 2 labels, with a preview');
  const prev = (await p.textContent('#rl-prev')).replace(/\s+/g, ' ');
  check(/Upper & Lower/.test(prev) && /Retainers/.test(prev) && /Whitening trays/.test(prev) && /Wear retainers as directed/.test(prev), 'labels: patient, Upper & Lower, Retainers / Whitening trays, bottom line, date');
  await p.screenshot({ path: OUT + '/v14-ret-labels.png' });
  await p.uncheck('[data-rl-kind="1"]'); await p.uncheck('[data-rl-arch=Lower]'); await p.waitForTimeout(80);
  check((await p.locator('#rl-prev .print-label').count()) === 1 && /Upper/.test(await p.textContent('#rl-prev .p-set-type')) && (await p.textContent('#rl-prev .p-at-center')).trim() === 'Retainer', 'just the upper retainer → 1 label, “Retainer”');
  await p.check('[data-rl-kind="1"]'); await p.check('[data-rl-arch=Lower]');
  await p.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { n: document.querySelectorAll('#print-container .print-page').length, txt: document.querySelector('#print-container').textContent }; window.dispatchEvent(new Event('afterprint')); }; });
  await p.click('#rl-print'); await p.waitForFunction(() => window.__printed, null, { timeout: 10000 });
  const pr = await p.evaluate(() => window.__printed);
  check(pr.n === 2 && /Whitening trays/.test(pr.txt), 'Print sends 2 labels, one 2×4 page each');
  await p.waitForSelector('#cbYes'); const q = (await p.textContent('#modalWrap')).replace(/\s+/g, ' ');
  check(/Mark this case complete\?/.test(q) && /Not yet/.test(q), 'after printing it asks: Mark this case complete? (Mark complete / Not yet)');
  await p.screenshot({ path: OUT + '/v14-ret-complete.png' });
  await p.click('#cbNo'); await p.waitForTimeout(200);
  check(await p.evaluate(id => findCase(id).status, rid) === 'open' && await p.isVisible('#drawer'), '“Not yet” leaves it open');
  await p.click('#retLblBox [data-act=retLabels]'); await p.waitForSelector('#rl-print');
  await p.click('#rl-print'); await p.waitForSelector('#cbYes'); await p.click('#cbYes');
  await p.waitForSelector('.toast:has-text("marked complete")');
  check(await p.evaluate(id => !S.cases.has(id) || findCase(id).status === 'done', rid) && !(await p.isVisible('#drawer')), '“Mark complete” completes it (with Undo)');
  // other types don't get the retainer label
  const oid = await p.evaluate(() => openCases().find(c => c.type === 'oliv').id);
  await p.evaluate(id => openDrawer(id), oid); await p.waitForSelector('#drawer .kv');
  check(!(await p.isVisible('#retLblBox')), 'aligner cases don’t show the retainer label');
  await p.screenshot({ path: OUT + '/v14-drawer-oliv.png' });
  // phone: the form's dates and the label modal fit
  await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => closeDrawer(true));
  const rid2 = await p.evaluate(() => openCases().find(c => c.type === 'retainer').id);
  await p.evaluate(id => openDrawer(id), rid2); await p.click('#retLblBox [data-act=retLabels]'); await p.waitForSelector('#rl-prev .print-label');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: no sideways scrolling with the label window open');
  await p.screenshot({ path: OUT + '/v14-ret-labels-phone.png' });
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
