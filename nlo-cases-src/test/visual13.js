// Delivery date filter on the lists, and the stage progress (circles joined by a line) — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const TAG = process.argv[3] || 'v13';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await p.click('#nav-list'); await p.waitForSelector('tr.click');
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/' + TAG + '-list.png', clip: { x: 232, y: 0, width: 1128, height: 560 } });
  // the delivery filter: each option against the cases' own delivery dates
  const res = await p.evaluate(() => {
    const iso = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return isoOf(d); };
    const all = openCases(), t = iso(0);
    const want = {
      all: all.length, past: all.filter(c => c.deliveryDate && c.deliveryDate < t).length, today: all.filter(c => c.deliveryDate === t).length,
      tomorrow: all.filter(c => c.deliveryDate === iso(1)).length, week: all.filter(c => c.deliveryDate >= t && c.deliveryDate <= iso(6)).length,
      '14': all.filter(c => c.deliveryDate >= t && c.deliveryDate <= iso(14)).length, none: all.filter(c => !c.deliveryDate).length
    };
    return { want, labFirst: all.filter(c => (dueOf(c) || {}).k === 'lab' && c.deliveryDate).length };
  });
  console.log('expected counts:', JSON.stringify(res.want), '| cases whose next date is the lab date but have a delivery date:', res.labFirst);
  const rows = () => p.locator('#listBody tr.click').count();
  for (const k of ['all', 'past', 'today', 'tomorrow', 'week', '14', 'none']) {
    await p.selectOption('select[data-f=del]', k); await p.waitForTimeout(80);
    const n = await rows(), head = (await p.textContent('#listBody thead')).replace(/\s+/g, ' ');
    console.log('del=' + k, n, n === res.want[k] ? 'OK' : 'MISMATCH (want ' + res.want[k] + ')', '| header has Delivery:', /Delivery/.test(head));
  }
  // sorted soonest delivery first, and the column shows delivery dates (not the lab date)
  await p.selectOption('select[data-f=del]', 'all'); await p.waitForTimeout(80);
  const order = await p.evaluate(() => Array.from(document.querySelectorAll('#listBody tr.click')).map(r => findCase(r.dataset.id).deliveryDate || '9999'));
  console.log('sorted by delivery:', order.every((d, i) => !i || order[i - 1] <= d) ? 'OK' : 'NO', '| chips:', (await p.locator('#listBody td.hideM .due').allTextContents()).slice(0, 4).join(' / '));
  console.log('lab chips while filtered by delivery:', await p.locator('#listBody td.hideM .due:has-text("Lab ")').count());
  await p.selectOption('select[data-f=del]', 'week'); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/' + TAG + '-delivery-week.png', clip: { x: 232, y: 0, width: 1128, height: 560 } });
  // a chosen day: the date box appears with today; picking a day redraws the list only
  await p.selectOption('select[data-f=del]', 'day'); await p.waitForSelector('#fDelDay');
  console.log('date box focused:', await p.evaluate(() => document.activeElement && document.activeElement.id === 'fDelDay'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100); // closes the calendar that opens with it
  const pick = await p.evaluate(() => { const c = openCases().filter(x => x.deliveryDate).sort((a, b) => a.deliveryDate < b.deliveryDate ? -1 : 1)[0]; return { d: c.deliveryDate, n: openCases().filter(x => x.deliveryDate === c.deliveryDate).length }; });
  console.log('day box starts on today:', (await p.inputValue('#fDelDay')) === (await p.evaluate(() => todayISO())));
  await p.evaluate(() => { document.getElementById('fDelDay').dataset.keep = '1'; });
  await p.fill('#fDelDay', pick.d); await p.dispatchEvent('#fDelDay', 'change'); await p.waitForTimeout(100);
  console.log('on ' + pick.d + ':', await rows(), 'rows (want ' + pick.n + ') | same date box kept:', await p.evaluate(() => document.getElementById('fDelDay').dataset.keep === '1'));
  await p.screenshot({ path: OUT + '/' + TAG + '-delivery-day.png', clip: { x: 232, y: 0, width: 1128, height: 400 } });
  // with another filter: type + delivery
  await p.selectOption('select[data-f=del]', '14'); await p.selectOption('select[data-f=type]', 'oliv'); await p.waitForTimeout(80);
  const both = await p.evaluate(() => { const iso = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return isoOf(d); }; return openCases().filter(c => c.type === 'oliv' && c.deliveryDate >= iso(0) && c.deliveryDate <= iso(14)).length; });
  console.log('Oliv + next 14 days:', await rows(), '(want ' + both + ')');
  await p.click('[data-act=clearF]'); await p.waitForTimeout(80);
  console.log('clear filters → delivery select back to any:', (await p.inputValue('select[data-f=del]')) === '', '| header:', (await p.textContent('#listBody thead th:nth-child(4)')).trim());
  // My cases has it too
  await p.click('#nav-mine'); await p.waitForSelector('select[data-f=del]'); console.log('My cases has the delivery filter: yes');
  // stage progress on the board (in-house: the In fabrication steps) and in the case
  await p.click('#nav-board'); await p.click('.boardTabs [data-k=inhouse]'); await p.waitForSelector('.kc .kstep');
  await p.waitForTimeout(200);
  const kc = await p.$('.col.grp .kc'); await kc.screenshot({ path: OUT + '/' + TAG + '-board-card.png' });
  await p.click('#nav-list'); await p.waitForSelector('td.stg');
  const st = await p.$('#listBody tbody'); const bb = await st.boundingBox();
  await p.screenshot({ path: OUT + '/' + TAG + '-stage-col.png', clip: { x: bb.x, y: bb.y, width: Math.min(760, bb.width), height: 330 } });
  // phone width
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/' + TAG + '-phone.png' });
  await p.selectOption('select[data-f=del]', 'all'); await p.waitForTimeout(200);
  const tb = await p.$('#listBody'); await tb.scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '/' + TAG + '-phone-delivery.png' });
  console.log('phone: date shown under the stage:', await p.locator('#listBody td.stg .onlyM .due').first().isVisible(), '| date column hidden:', !(await p.locator('#listBody td.hideM .due').first().isVisible()));
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
