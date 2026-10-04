// Treatment time: tap the months and the expected removal fills in (Amir, 4 Oct 2026: "when you enter the start date for
// treatment, it should let you pick months"; "enter the date, pick 6 months treatmetn time, > it will put the date as exactly
// 6 months from taht day") — demo
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');

  // ---- the arithmetic: the same day that many months on; the month's last day when that month is shorter
  const m = await p.evaluate(() => ({
    a: addMonthsTx('2026-10-04', 6), b: addMonthsTx('2026-08-31', 6), c: addMonthsTx('2027-08-31', 6), d: addMonthsTx('2026-01-31', 1),
    e: addMonthsTx('2026-12-15', 18), f: addMonthsTx('2026-03-31', 24), g: addMonthsTx('2026-10-04', 3),
    n1: txMonths('2026-10-04', '2027-04-04'), n2: txMonths('2026-08-31', '2027-02-28'), n3: txMonths('2026-10-04', '2027-04-05'), n4: txMonths('2026-10-04', '2026-10-04'),
    n5: txMonths('0202-10-04', '2027-04-04'), n6: txMonths('2026-10-04', '2031-10-04'), n7: txMonths('2026-10-04', '2031-11-04'), n8: txMonths('2027-04-04', '2026-10-04'),
    ok: [txDateOk('2026-10-04'), txDateOk('0202-10-04'), txDateOk(''), txDateOk('2026-13-01')] }));
  check(m.a === '2027-04-04' && m.g === '2027-01-04', 'Oct 4, 2026 + 6 months = Apr 4, 2027 (exactly; + 3 = Jan 4)');
  check(m.b === '2027-02-28' && m.c === '2028-02-29' && m.d === '2026-02-28', 'a shorter month: Aug 31 + 6 = Feb 28 (Feb 29 in 2028); Jan 31 + 1 = Feb 28');
  check(m.e === '2028-06-15' && m.f === '2028-03-31', 'across years: Dec 15, 2026 + 18 = Jun 15, 2028; Mar 31, 2026 + 24 = Mar 31, 2028');
  check(m.n1 === 6 && m.n2 === 6 && m.n3 === 0 && m.n4 === 0 && m.n5 === 0 && m.n6 === 60 && m.n7 === 0 && m.n8 === 0,
    'whole months from two dates: 6 (and 6 for Aug 31 → Feb 28); none for a day off, the same day, a half-typed year, past 60, or backwards');
  check(m.ok.join() === 'true,false,false,false', 'only whole dates count (not a year still being typed, an empty box or month 13)');

  // ---- New case, in-house first set
  const st = (r) => p.evaluate(r => { const q = s => document.querySelector(r + ' ' + s);
    return { s: q('#cf-txStart').value, e: q('#cf-txEnd').value, on: Array.from(document.querySelectorAll(r + ' [data-txm][aria-pressed=true]')).map(b => b.dataset.txm).join(','),
      other: q('#cf-txMonths').value, otherOn: q('#cf-txMonths').classList.contains('on'), hint: q('#cf-txLenHint').textContent, bad: q('#cf-txLenHint').classList.contains('bad'),
      hintShown: getComputedStyle(q('#cf-txLenHint')).display !== 'none', focus: document.activeElement && document.activeElement.id }; }, r);
  const N = () => st('#ncForm');
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=nla]'); await p.fill('#cf-patient', 'Tina Timeline'); await p.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  let s = await N();
  const labels = await p.$$eval('#ncForm [data-txm]', bs => bs.map(b => b.textContent + '|' + b.getAttribute('aria-label')).join(' '));
  check(await p.isVisible('#ncForm #cf-txWrap .txLen') && labels === '3 mo|3 months 6 mo|6 months 9 mo|9 months 12 mo|12 months 15 mo|15 months 18 mo|18 months 24 mo|24 months' && await p.isVisible('#ncForm #cf-txMonths'),
    'in-house first set: “Treatment time” under Start and Expected removal — 3, 6, 9, 12, 15, 18, 24 mo (read out as months) and Other');
  check(s.on === '' && s.other === '' && !s.hintShown, '…nothing picked, no hint line yet');
  await p.fill('#cf-txStart', '2026-10-04'); await p.click('#ncForm [data-txm="6"]'); s = await N();
  check(s.e === '2027-04-04' && s.on === '6' && !s.hintShown, 'Start Oct 4, 2026, then 6 mo: Expected removal Apr 4, 2027 (exactly 6 months), 6 mo ticked');
  const sec = await p.evaluateHandle(() => document.querySelector('#ncForm #cf-txWrap').closest('.cfSec')); await sec.scrollIntoViewIfNeeded(); await p.mouse.move(5, 5);
  await sec.screenshot({ path: OUT + '/v40-1-six-months.png' });
  await p.fill('#cf-txStart', '2026-10-10'); s = await N();
  check(s.e === '2027-04-10' && s.on === '6', 'a new start keeps the 6 months: the expected removal moves to Apr 10, 2027');
  await p.click('#ncForm [data-txm="12"]'); s = await N();
  check(s.e === '2027-10-10' && s.on === '12', '12 mo: Oct 10, 2027');
  await p.click('#ncForm [data-txm="12"]'); s = await N();
  check(s.e === '2027-10-10' && s.on === '12', 'tapping the ticked one again leaves it as it is');
  // Other
  await p.fill('#cf-txMonths', '8'); s = await N();
  check(s.e === '2027-06-10' && s.on === '' && s.otherOn && s.other === '8', 'Other 8 (months): Jun 10, 2027 — no button ticked, the box marked');
  await p.press('#cf-txMonths', 'Enter'); s = await N();
  check(await p.isVisible('#ncForm') && s.other === '8' && s.otherOn && s.e === '2027-06-10', 'Enter in Other doesn’t create the case; 8 stays');
  await p.fill('#cf-txMonths', '6'); await p.press('#cf-txMonths', 'Tab'); s = await N();
  check(s.e === '2027-04-10' && s.on === '6' && s.other === '' && !s.otherOn, 'Other 6 is the 6 mo button: it ticks and the box empties');
  await p.fill('#cf-txMonths', '0'); s = await N();
  check(s.bad && s.hint === 'Enter 1 to 60 months.' && s.e === '2027-04-10' && s.on === '6', 'Other 0: “Enter 1 to 60 months.”; the date stays (still 6 months)');
  await p.fill('#cf-txMonths', '61'); s = await N();
  check(s.bad && s.hint === 'Enter 1 to 60 months.' && s.e === '2027-04-10', 'Other 61: the same');
  await p.press('#cf-txMonths', 'Tab'); s = await N();
  check(s.other === '' && !s.bad && s.on === '6', 'leaving the box: the stray number goes, 6 mo stays ticked');
  // an expected removal typed by hand
  await p.fill('#cf-txEnd', '2027-06-20'); s = await N();
  check(s.on === '' && s.other === '' && s.hint === 'About 8.5 months.' && !s.bad, 'an expected removal typed by hand, not whole months away: nothing ticked, “About 8.5 months.”');
  await p.mouse.move(5, 5); await sec.screenshot({ path: OUT + '/v40-2-typed.png' });
  await p.fill('#cf-txStart', '2026-10-12'); s = await N();
  check(s.e === '2027-06-20', '…and a new start then leaves that date alone');
  await p.fill('#cf-txEnd', '2027-07-12'); s = await N();
  check(s.on === '9' && !s.hintShown, 'typed by hand 9 months after the start: 9 mo ticks');
  await p.fill('#cf-txEnd', '2026-11-02'); s = await N();
  check(s.hint === 'About 3 weeks.' && s.on === '', 'three weeks after the start: “About 3 weeks.”');
  await p.fill('#cf-txEnd', '2026-10-01'); s = await N();
  check(s.bad && s.hint === 'The expected removal has to be after the start.' && s.on === '', 'before the start: “The expected removal has to be after the start.”');
  // the months first, then the start
  await p.fill('#cf-txStart', ''); await p.fill('#cf-txEnd', '');
  await p.click('#ncForm [data-txm="9"]'); s = await N();
  check(s.on === '9' && s.e === '' && s.hint === 'Now enter the start date — the expected removal will be 9 months after it.' && s.focus === 'cf-txStart',
    '9 mo before a start: it waits (“Now enter the start date …”), the cursor in Start');
  await p.mouse.move(5, 5); await sec.screenshot({ path: OUT + '/v40-3-months-first.png' });
  await p.fill('#cf-txStart', '2026-11-02'); s = await N();
  check(s.e === '2027-08-02' && s.on === '9' && !s.hintShown, '…then the start: Expected removal Aug 2, 2027');
  await p.click('#ncSave'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 8000 });
  const id = await p.evaluate(() => (openCases().find(c => c.patient === 'Tina Timeline') || {}).id);
  const saved = await p.evaluate(id => { const c = DEMO.cases.get(id); return c && { s: c.txStart, e: c.txEnd }; }, id);
  check(saved && saved.s === '2026-11-02' && saved.e === '2027-08-02', 'Create case saves Start Nov 2, 2026 and Expected removal Aug 2, 2027');

  // ---- Edit: the length shows from the saved dates and keeps following the start
  const D = () => st('#drawer');
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, id); await p.waitForSelector('#drawer .dsList');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-txMonths');
  s = await D();
  check(s.s === '2026-11-02' && s.e === '2027-08-02' && s.on === '9', 'Edit: 9 mo ticked from the saved dates');
  await p.fill('#drawer #cf-txStart', '2026-11-16'); s = await D();
  check(s.e === '2027-08-16' && s.on === '9', 'a later start there keeps the 9 months: Aug 16, 2027');
  await p.click('#drawer [data-act=saveEdit]'); await p.waitForSelector('#drawer .dsList'); await p.waitForTimeout(250);
  const ed = await p.evaluate(id => { const c = DEMO.cases.get(id); return { s: c.txStart, e: c.txEnd }; }, id);
  check(ed.s === '2026-11-16' && ed.e === '2027-08-16', 'saved: Nov 16, 2026 → Aug 16, 2027');
  // the second Edit (the panel keeps its element): one tap still ticks once
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-txMonths');
  await p.click('#drawer [data-txm="15"]'); s = await D();
  check(s.e === '2028-02-16' && s.on === '15', 'a second Edit: 15 mo → Feb 16, 2028 (the button works once per tap)');
  await p.click('#drawer [data-act=cancelEdit]').catch(() => p.evaluate(() => { S.editing = false; renderDrawer(); }));

  // ---- a refinement: the patient's dates come from the initial set (exactly 18 months here); Change opens them with 18 mo ticked
  const ref = await p.evaluate(() => openCases().find(c => c.chart === '15-1001').id);
  const al = await p.evaluate(() => { const a = DEMO.cases.get('demoAl0'), e = addMonthsTx(a.txStart, 18);
    casePool().filter(x => x.id === 'demoAl0').forEach(x => { x.txEnd = e; }); a.txEnd = e; return { s: a.txStart, e }; });
  await p.evaluate(id => { closeDrawer(true); openDrawer(id); }, ref); await p.waitForSelector('#drawer .dsList');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#drawer #cf-txFrom', { state: 'attached' });
  const fmt = x => p.evaluate(x => fmtDate(x), x);
  const from = await p.textContent('#drawer #cf-txFrom');
  check(from === 'Treatment ' + await fmt(al.s) + ' → expected removal ' + await fmt(al.e) + ' · 18 months (from the patient’s initial set).', 'refinement: “' + from + '”');
  await p.click('#drawer #cf-txChange'); s = await D();
  check(s.s === al.s && s.e === al.e && s.on === '18' && s.focus === 'cf-txEnd', 'Change: the dates open with 18 mo ticked');
  await p.click('#drawer [data-txm="24"]'); s = await D();
  check(s.e === await p.evaluate(x => addMonthsTx(x, 24), al.s) && s.on === '24', '24 mo there: 24 months after the patient’s start');
  const dsec = await p.evaluateHandle(() => document.querySelector('#drawer #cf-txWrap').closest('.cfSec')); await dsec.scrollIntoViewIfNeeded(); await p.mouse.move(5, 5);
  await dsec.screenshot({ path: OUT + '/v40-4-refinement.png' });
  await p.evaluate(() => { S.editing = false; closeDrawer(true); });

  // ---- phones: the buttons wrap; nothing sideways
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await routes(ph);
  const q = await ph.newPage(); watch(q, errs, 'phone');
  await q.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await q.click('#lgBtn'); await q.waitForSelector('.tiles');
  await q.click('#mobTop [data-act=newCase]').catch(() => q.click('[data-act=newCase] >> visible=true'));
  await q.waitForSelector('#ncForm'); await q.click('#ncForm .tt[data-tile=nla]'); await q.click('#ncForm .pickRow[data-g=initial] .pick[data-v=yes]');
  await q.fill('#cf-txStart', '2026-10-04'); await q.tap('#ncForm [data-txm="6"]');
  const pr = await q.evaluate(() => { const row = document.querySelector('#ncForm .txLen'), r = row.getBoundingClientRect(), modal = document.querySelector('#ncForm').getBoundingClientRect();
    const btns = Array.from(row.querySelectorAll('.pick, .txOther')).map(b => b.getBoundingClientRect());
    return { inside: btns.every(b => b.left >= modal.left - 1 && b.right <= modal.right + 1), lines: new Set(btns.map(b => Math.round(b.top))).size, wide: document.documentElement.scrollWidth <= innerWidth,
      e: document.querySelector('#cf-txEnd').value, rowW: r.width }; });
  check(pr.inside && pr.wide && pr.lines >= 2 && pr.e === '2027-04-04', 'phone: the buttons wrap onto ' + pr.lines + ' lines inside the form, no sideways scroll; 6 mo → Apr 4, 2027');
  const psec = await q.evaluateHandle(() => document.querySelector('#ncForm #cf-txWrap').closest('.cfSec')); await psec.scrollIntoViewIfNeeded();
  await psec.screenshot({ path: OUT + '/v40-5-phone.png' });
  await ph.close();

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
