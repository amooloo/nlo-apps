// Amir, 22 Oct 2026: "The APPT time should always be visible on the card that pulls up on the right side of the screen when you
// click on the pt. It should be in the header very clearly." The case panel's header carries the delivery appt across its bottom —
// a calendar page, the day and the time in large type, how far off it is — never folded and never scrolled away; Add time /
// Set appt / Change set it from there. Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  // what the header should say, worked out here (not with the app's own helpers)
  const ampm = t => { const [h, m] = t.split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const iso = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const dayTxt = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, y !== new Date().getFullYear() ? { year: 'numeric' } : {})); };
  const daysTo = s => { const [y, m, d] = s.split('-').map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 864e5); };
  const relTxt = n => n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : Math.abs(n) < 14 ? (n > 0 ? 'In ' + n + ' days' : -n + ' days ago') : null;

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-US' }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(URL); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await p.waitForTimeout(400);
  const bar = () => p.evaluate(() => {
    const b = document.querySelector('#drawer #dAppt'); if (!b) return null; const q = s => { const e = b.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const btn = b.querySelector('.apEd');
    return { cls: b.className, k: q('.apK > span:first-child') || q('.apK'), rel: q('.apRel'), day: q('.apD'), tm: q('.apT'), no: q('.apNo'), cal: q('.apCal'), btn: btn ? btn.textContent.trim() : '', btnName: btn ? btn.getAttribute('aria-label') : '',
      inHd: !!b.closest('.dHd'), edit: !!b.closest('.dHd.dEdit') };
  });
  const open = async id => {
    await p.click('#nav-list'); await p.waitForSelector('#listBody');
    if (await p.$('#listBody tr[data-id="' + id + '"]')) await p.click('#listBody tr[data-id="' + id + '"]'); else await p.evaluate(id => openDrawer(id), id);
    await p.waitForSelector('#drawer #dAppt'); await p.waitForTimeout(150);
  };
  const close = async () => { if (await p.$('#drawer')) { await p.click('#drawer .dHd [data-act=closeDrawer]'); await p.waitForTimeout(120); } };
  const caseOf = id => p.evaluate(id => { const c = findCase(id); return c && { d: c.deliveryDate || '', t: c.deliveryTime || '', ship: !!c.shipToPatient, patient: c.patient }; }, id);
  const pick = await p.evaluate(() => {
    const cs = openCases(), dd = c => dayDiff(c.deliveryDate);
    const f = fn => (cs.find(fn) || {}).id || '';
    return {
      labLate: f(c => labDueOf(c) && dayDiff(labDueOf(c).d) < 0 && c.deliveryDate && c.deliveryTime && !c.shipToPatient),
      far: f(c => c.deliveryDate && c.deliveryTime && !c.shipToPatient && dd(c) > 3),
      soon: f(c => c.deliveryDate && !c.shipToPatient && dd(c) >= 0 && dd(c) <= 3),
      past: f(c => c.deliveryDate && !c.shipToPatient && dd(c) < 0),
      noTime: f(c => c.deliveryDate && !c.deliveryTime && !c.shipToPatient && dd(c) >= 0),
      noAppt: f(c => !c.deliveryDate && !c.dueDate),
      ship: f(c => c.shipToPatient && c.deliveryDate && (TYPE[c.type] || {}).aligner)
    };
  });
  console.log('cases:', JSON.stringify(pick));
  check(Object.values(pick).every(Boolean), 'the demo has every kind of case this needs');

  console.log('\n# A case whose lab date is late: the header shows its appointment, date and time');
  let c = await caseOf(pick.labLate); await open(pick.labLate); let b = await bar();
  check(b && b.inHd && !b.edit, 'the delivery appt is in the panel’s header');
  check(b.k === 'Delivery appt' && b.day === dayTxt(c.d) && b.tm === ampm(c.t), 'it reads “Delivery appt · ' + b.day + ' · ' + b.tm + '” (' + dayTxt(c.d) + ', ' + ampm(c.t) + ')');
  const [cy, cm, cd] = c.d.split('-').map(Number);
  check(b.cal.replace(/\s/g, '') === new Date(cy, cm - 1, cd).toLocaleDateString('en-US', { month: 'short' }) + cd, 'the calendar page shows the month and day (' + b.cal + ')');
  check(b.rel === relTxt(daysTo(c.d)) || (daysTo(c.d) >= 14 && /^In \d+ (weeks|months)$/.test(b.rel)), 'and how far off it is (' + b.rel + ')');
  check(b.btn === 'Change', 'Change is on it');
  check(/Lab (\d+ days? late|yesterday)/.test(await p.textContent('#drawer #dsS-details').catch(() => '')), 'the Details line keeps its lab chip (unchanged)');
  const hdH = await p.evaluate(() => document.querySelector('#drawer .dHd').getBoundingClientRect().height);
  check(hdH < 330, 'the header stays a sensible height (' + Math.round(hdH) + ' px)');
  await p.screenshot({ path: OUT + '/v62-labLate.png' });

  console.log('\n# Always in view: the case scrolled to the bottom (everything open) keeps it where it was');
  await p.click('#drawer [data-act=dsAll]'); await p.waitForTimeout(150);
  const y0 = (await (await p.$('#dAppt')).boundingBox()).y;
  await p.evaluate(() => { const bd = document.querySelector('#drawer .dBd'); bd.scrollTop = bd.scrollHeight; }); await p.waitForTimeout(150);
  const bb = await (await p.$('#dAppt')).boundingBox(), sc = await p.evaluate(() => document.querySelector('#drawer .dBd').scrollTop);
  check(sc > 200 && Math.abs(bb.y - y0) < 1 && bb.y + bb.height <= 900, 'scrolled ' + sc + ' px: the appointment hasn’t moved and is on screen');
  await p.click('#drawer [data-act=dsAll]'); await p.waitForTimeout(100); // (fold them back for the next cases)
  await close();

  console.log('\n# Colours: far off plain, within 3 days amber, passed coral');
  await open(pick.far); b = await bar(); c = await caseOf(pick.far);
  check(!/soon|over|none|done/.test(b.cls) && b.tm === ampm(c.t), 'more than 3 days off: plain (' + b.rel + ')'); await close();
  await open(pick.soon); b = await bar(); c = await caseOf(pick.soon);
  check(/\bsoon\b/.test(b.cls) && b.rel === relTxt(daysTo(c.d)), 'within 3 days: amber, “' + b.rel + '”'); await p.screenshot({ path: OUT + '/v62-soon.png' }); await close();
  await open(pick.past); b = await bar(); c = await caseOf(pick.past);
  check(/\bover\b/.test(b.cls) && b.rel === relTxt(daysTo(c.d)) && /ago$/.test(b.rel), 'passed, case still open: coral, “' + b.rel + '”'); await close();

  console.log('\n# No time yet: says so, and Add time sets it from the header');
  c = await caseOf(pick.noTime); await open(pick.noTime); b = await bar();
  check(b.day === dayTxt(c.d) && !b.tm && b.no === 'No time set' && b.btn === 'Add time', '“' + b.day + ' · No time set”, with Add time');
  await p.click('#dAppt .apEd'); await p.waitForSelector('#modalWrap #apDate');
  check(await p.textContent('#modalWrap h3') === 'Delivery appt' && await p.inputValue('#apDate') === c.d && !!(await p.$('#apTime')), 'the window: Delivery appt, its date filled in, and a time');
  check((await p.$$eval('#apTime option', os => os.map(o => o.value).filter(Boolean))).length === 25, 'the time is the form’s half hours, 7:00 AM to 7:00 PM');
  await p.selectOption('#apTime', '13:30'); await p.click('#apSave');
  await p.waitForFunction(() => /1:30 PM/.test((document.querySelector('#dAppt .apT') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
  b = await bar(); c = await caseOf(pick.noTime);
  check(c.t === '13:30' && b.tm === '1:30 PM' && b.btn === 'Change' && !b.no, 'saved: the header shows 1:30 PM, and Change');
  check(/Delivery appt set for .*1:30 PM/.test(await p.textContent('#toasts')), 'a toast says so');
  let log = await p.evaluate(id => B.caseLog(id), pick.noTime); let last = log[log.length - 1];
  check(last && last.a === 'edit' && JSON.stringify(last.fields) === '["deliveryTime"]', 'the history: an edit of the appt time');
  await close();

  console.log('\n# No appointment: Set appt');
  await open(pick.noAppt); b = await bar();
  check(/\bnone\b/.test(b.cls) && b.no === 'Not set yet' && b.btn === 'Set appt', '“Not set yet”, with Set appt');
  await p.screenshot({ path: OUT + '/v62-none.png' });
  await p.click('#dAppt .apEd'); await p.waitForSelector('#modalWrap #apDate');
  check(await p.isDisabled('#apSave') && !(await p.$('#apClear')), 'Save waits for a date; no Clear (nothing to clear)');
  const nd = iso(9); await p.fill('#apDate', nd); await p.selectOption('#apTime', '09:00');
  check(!(await p.isDisabled('#apSave')), 'with a date, Save is on'); await p.click('#apSave');
  await p.waitForFunction(() => !!document.querySelector('#dAppt .apT'), null, { timeout: 4000 }).catch(() => {});
  b = await bar(); c = await caseOf(pick.noAppt);
  check(c.d === nd && c.t === '09:00' && b.day === dayTxt(nd) && b.tm === '9:00 AM' && b.rel === 'In 9 days' && !/none/.test(b.cls), 'saved: ' + b.day + ' · ' + b.tm + ' · ' + b.rel);
  log = await p.evaluate(id => B.caseLog(id), pick.noAppt); last = log[log.length - 1];
  check(last && JSON.stringify(last.fields) === '["deliveryDate","deliveryTime"]', 'the history: delivery appt and appt time');
  console.log('\n# Change → Clear the appt');
  await p.click('#dAppt .apEd'); await p.waitForSelector('#modalWrap #apClear');
  check(await p.inputValue('#apDate') === nd && await p.inputValue('#apTime') === '09:00', 'the window opens with the saved date and time');
  await p.click('#apClear'); await p.waitForFunction(() => /none/.test((document.querySelector('#dAppt') || {}).className || ''), null, { timeout: 4000 }).catch(() => {});
  b = await bar(); c = await caseOf(pick.noAppt);
  check(!c.d && !c.t && b.no === 'Not set yet', 'cleared: back to “Not set yet”');
  console.log('\n# Cancel changes nothing');
  await p.click('#dAppt .apEd'); await p.fill('#apDate', iso(3)); await p.click('#modalWrap [data-act=closeModal]'); await p.waitForTimeout(150);
  check(!(await caseOf(pick.noAppt)).d && !(await p.$('#modalWrap')), 'still no appointment');
  await close();

  console.log('\n# Shipped to the patient: the expected delivery, no time');
  c = await caseOf(pick.ship); await open(pick.ship); b = await bar();
  check(b.k === 'Expected delivery' && b.day === dayTxt(c.d) && !b.tm && !b.no && b.btn === 'Change', '“Expected delivery · ' + b.day + '”, no time, Change');
  await p.click('#dAppt .apEd'); await p.waitForSelector('#modalWrap #apDate');
  check(await p.textContent('#modalWrap h3') === 'Expected delivery' && !(await p.$('#apTime')), 'its window asks the date only');
  await p.click('#modalWrap [data-act=closeModal]'); await close();

  console.log('\n# Edit: the header keeps it, without a button, following the form');
  c = await caseOf(pick.far); await open(pick.far);
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .dEdit #dAppt');
  b = await bar(); check(b.edit && b.day === dayTxt(c.d) && b.tm === ampm(c.t) && !b.btn, 'Editing: ' + b.day + ' · ' + b.tm + ', no button');
  const ed = iso(2); await p.fill('#cf-deliveryDate', ed); await p.selectOption('#cf-deliveryTime', '15:00'); await p.waitForTimeout(150);
  b = await bar(); check(b.day === dayTxt(ed) && b.tm === '3:00 PM' && /soon/.test(b.cls), 'changing the form’s date and time changes the header (' + b.day + ' · ' + b.tm + ')');
  await p.selectOption('#cf-deliveryTime', ''); await p.waitForTimeout(100);
  b = await bar(); check(!b.tm && b.no === 'No time set', 'taking the time off: No time set');
  await p.click('#drawer [data-act=cancelEdit]'); await p.waitForSelector('#drawer .dHd:not(.dEdit) #dAppt');
  b = await bar(); check(b.day === dayTxt(c.d) && b.tm === ampm(c.t) && b.btn === 'Change' && (await caseOf(pick.far)).d === c.d, 'Cancel: the saved appointment again, with Change');
  console.log('\n# Edit → Save moves it');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer .dEdit #dAppt');
  await p.fill('#cf-deliveryDate', ed); await p.selectOption('#cf-deliveryTime', '15:00'); await p.click('#drawer [data-act=saveEdit]');
  await p.waitForSelector('#drawer .dHd:not(.dEdit) #dAppt'); await p.waitForTimeout(150);
  b = await bar(); check(b.day === dayTxt(ed) && b.tm === '3:00 PM' && (await caseOf(pick.far)).t === '15:00', 'saved from Edit: the header shows ' + b.day + ' · ' + b.tm);
  check(await p.evaluate(() => { const d = document.querySelector('#drawer'); return !d._apOff; }), 'back from Edit: its listeners are gone');
  await close();

  console.log('\n# An older case with only a due date');
  await p.evaluate(id => { const x = S.cases.get(id); x.dueDate = x.deliveryDate; x.deliveryDate = ''; x.deliveryTime = ''; }, pick.labLate);
  await open(pick.labLate); b = await bar();
  check(b.k === 'Due (older case)' && !b.tm && !b.no && b.btn === 'Set appt', '“Due (older case)”, no time asked for, Set appt');
  await close();
  // (a date that isn't yyyy-mm-dd — never written by the app, but an old import could have one: shown as it is, no “NaN”)
  await p.evaluate(id => { const x = S.cases.get(id); x.dueDate = ''; x.deliveryDate = '10/27/2026'; }, pick.labLate);
  await open(pick.labLate); b = await bar();
  check(/raw/.test(b.cls) && b.day === '10/27/2026' && !/NaN|Invalid/.test(JSON.stringify(b)), 'an odd date from an old import shows as it is');
  await close();

  console.log('\n# A completed case: shown in grey, no button');
  await p.click('#nav-done'); await p.waitForSelector('tr.click'); await p.waitForTimeout(150); await p.click('tr.click >> nth=0');
  await p.waitForSelector('#drawer #dAppt'); b = await bar();
  check(/\bdone\b/.test(b.cls) && !b.btn && !!b.day, 'completed: ' + b.day + ', grey, no Change');
  await close();
  await p.evaluate(() => apptModal(findCase(openCases()[0].id))); // (the window by itself has no page errors either)
  await p.click('#modalWrap [data-act=closeModal]');

  console.log('\n# Phone');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' }); await routes(m);
  const mp = await m.newPage(); watch(mp, errs, 'phone');
  await mp.goto(URL); await mp.click('#lgBtn'); await mp.waitForSelector('.tiles'); await mp.waitForTimeout(300);
  for (const k of ['labLate', 'noAppt']) {
    const id = await mp.evaluate(k => { const cs = openCases(), dd = c => dayDiff(c.deliveryDate);
      return (k === 'labLate' ? cs.find(c => labDueOf(c) && dayDiff(labDueOf(c).d) < 0 && c.deliveryDate && c.deliveryTime && !c.shipToPatient) : cs.find(c => !c.deliveryDate && !c.dueDate)).id; }, k);
    await mp.evaluate(id => openDrawer(id), id); await mp.waitForSelector('#drawer #dAppt'); await mp.waitForTimeout(150);
    const r = await mp.evaluate(() => { const b = document.querySelector('#dAppt'), d = document.querySelector('#drawer'), r = e => e && e.getBoundingClientRect(), bt = b.querySelector('.apEd');
      return { w: r(b).width, right: r(b).right, dw: d.clientWidth, over: d.scrollWidth > d.clientWidth + 1, day: r(b.querySelector('.apD')), tm: r(b.querySelector('.apT')),
        t: bt ? getComputedStyle(bt.querySelector('.t')).display : '', name: bt ? bt.getAttribute('aria-label') : '', bh: r(b).height }; });
    if (k === 'labLate') check(r.tm && Math.abs(r.day.top - r.tm.top) < 8 && r.right <= r.dw && !r.over && r.t === 'none' && r.name === 'Change', 'phone: the day and the time on one line, inside the panel, Change as an icon (' + Math.round(r.bh) + ' px tall)');
    else check(r.right <= r.dw && !r.over && r.name === 'Set appt', 'phone: no appointment fits too (Set appt as an icon)');
    await mp.screenshot({ path: OUT + '/v62-phone-' + k + '.png' });
    await mp.click('#drawer .dHd [data-act=closeDrawer]'); await mp.waitForTimeout(100);
  }

  check(!errs.length, 'no page errors, no page-security refusals' + (errs.length ? ':\n' + errs.join('\n') : ''));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL OK');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
