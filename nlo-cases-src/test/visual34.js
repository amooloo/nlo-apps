// Amir, 4 Oct 2026: Specialty's "Warranty, Replacement, Refinement and Returns Policy" → "each Specialty case shows its remake
// deadlines and how to file a claim" (warranty.js), and new Hawley retainer cases go to Specialty — demo (made-up patients)
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ev = (fn, arg) => p.evaluate(fn, arg);
  const sum = () => p.textContent('#drawer #dsS-wty');
  const waitSum = re => p.waitForFunction(src => new RegExp(src).test((document.querySelector('#dsS-wty') || {}).textContent || ''), re.source, { timeout: 8000 }).then(() => true, () => false);
  const toastHas = re => p.evaluate(src => Array.from(document.querySelectorAll('.toast')).some(t => new RegExp(src).test(t.textContent)), re.source);
  const toastN = re => p.evaluate(src => Array.from(document.querySelectorAll('.toast')).filter(t => new RegExp(src).test(t.textContent)).length, re.source);
  const clearToasts = () => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keys = async s => { for (const k of s) { await p.keyboard.press(k); await p.waitForTimeout(25); } };
  const mdy = iso => iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(0, 4); // typed into a US date box: month, day, year
  const W = id => p.evaluate(id => (DEMO.cases.get(id) || {}).invDate || '', id);

  // ---- the dates
  check(await ev(() => wtyAddMonths('2026-08-31', 6) === '2027-02-28' && wtyAddMonths('2027-08-31', 6) === '2028-02-29' && wtyAddMonths('2026-01-15', 9) === '2026-10-15' && wtyAddMonths('2026-05-31', 9) === '2027-02-28'),
    'months count to the same day, or the month’s last day (Aug 31 + 6 months = Feb 28; Feb 29 in a leap year)');
  check(await ev(() => { const y = new Date().getFullYear(); return !/\d{4}/.test(wtyDay(y + '-11-03')) && new RegExp(String(y + 1)).test(wtyDay((y + 1) + '-04-04')); }), 'a date this year shows without the year; next year’s with it');
  const bounds = await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'shipped', status: 'open', appliances: ['MARA'] };
    const at = n => { const cc = Object.assign({}, c, { invDate: addDays(todayISO(), -n) }), d = wtyDates(cc, []); return wtySummary(cc, d, wtyWindows(cc, d)).split(' until ')[0]; };
    return [at(30), at(31), at(60), at(61)].join('|'); });
  check(bounds === 'Fit remake free|Fit remake half price|Fit remake half price|Free remake for defects', 'day 30 is free, day 31 half price, day 60 half price, day 61 full price (only defects left)');

  // ---- which cases have it
  const shows = await ev(() => {
    const ap = (lab, stage, x) => Object.assign({ id: 'x', type: 'appliance', lab, stage, status: 'open', appliances: ['MARA'] }, x || {});
    return [wtyShows(ap(LAB_SPEC, 'mfg')), wtyShows(ap(LAB_SPEC, 'shipped')), wtyShows(ap(LAB_SPEC, 'milestones')), wtyShows(ap(LAB_SPEC, 'mfg', { status: 'done' })), wtyShows(ap(LAB_SPEC, 'milestones', { status: 'done' })), wtyShows(ap(LAB_SPEC, 'submit', { invDate: '2026-09-01' })),
      wtyShows(ap(LAB_PART, 'shipped')), wtyShows(ap('Partner Dental Studios', 'shipped')), wtyShows(ap(LAB_IN, 'milestones')),
      wtyShows({ id: 'm', type: 'marpe', lab: LAB_SPEC, stage: 'approved', status: 'open' }), wtyShows({ id: 'm', type: 'marpe', lab: LAB_SPEC, stage: 'delivered', status: 'open' }),
      wtyShows({ id: 'o', type: 'oliv', lab: LAB_SPEC, stage: 'shipped', status: 'open' })].map(Number).join('');
  });
  check(shows === '011011000010', 'shown on a Specialty appliance from Shipped on (or with an invoice date) — not before, not completed before it shipped (cancelled), not for Partners (old name too) or in-house, a MARPE once delivered, never an aligner');
  const back = await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'mfg', status: 'open', appliances: ['MARA'] }, ago = n => Date.now() - n * 864e5;
    return [wtyShowsH(c, []), wtyShowsH(c, [{ a: 'stage', from: 'mfg', to: 'shipped', at: ago(20) }, { a: 'stage', from: 'shipped', to: 'mfg', at: ago(2) }])].map(Number).join(''); });
  check(back === '01', '… and on one moved back for a remake once its history shows it shipped');
  // the history: the last move forward to Shipped, the first move forward to a received step after it
  const hist = await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'milestones', status: 'open', appliances: ['MARA'] }, ago = n => Date.now() - n * 864e5, day = n => isoOf(new Date(ago(n)));
    const mis = wtyDates(c, [{ a: 'stage', from: 'mfg', to: 'shipped', at: ago(30) }, { a: 'stage', from: 'shipped', to: 'milestones', at: ago(26) }, { a: 'stage', from: 'milestones', to: 'shipped', at: ago(21) }, { a: 'stage', from: 'shipped', to: 'milestones', at: ago(21) + 6e4 }]);
    const re = wtyDates(Object.assign({}, c, { stage: 'shipped' }), [{ a: 'stage', from: 'mfg', to: 'shipped', at: ago(50) }, { a: 'stage', from: 'shipped', to: 'milestones', at: ago(45) }, { a: 'stage', from: 'milestones', to: 'mfg', at: ago(20) }, { a: 'email', from: 'mfg', to: 'shipped', at: ago(2) }]);
    return { mis: mis.shipped === day(30) && mis.recv === day(26), re: re.shipped === day(2) && re.recv === '' && re.from === 'shipped' }; });
  check(hist.mis, 'a step clicked back and forward again (Checked in → Shipped → Checked in) doesn’t restart anything: shipped and came in on the first days');
  check(hist.re, 'remade and shipped again (here by a lab email): counts from the new Shipped day, waiting for it to come in');
  check(await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'milestones', status: 'open', appliances: ['MARA'] }, ago = n => Date.now() - n * 864e5;
    const d = wtyDates(c, [{ a: 'stage', from: 'mfg', to: 'milestones', at: ago(60) }, { a: 'stage', from: 'milestones', to: 'submitted', at: ago(30) }, { a: 'stage', from: 'submitted', to: 'milestones', at: ago(5) }]);
    return d.recv === isoOf(new Date(ago(5))) && d.inv === d.recv && !d.shipped; }), 'remade with no Shipped steps (Checked in → back to Submitted → Checked in again): counts from the second check-in');

  // ---- a MARA Specialty made: shipped 44 days ago, checked in 4 days later (demo)
  await p.click('#nav-done'); await p.waitForSelector('#app tr.click');
  await p.fill('#q', 'Marlowe'); await p.click('tr.click:has-text("Marlowe Maraday")'); await p.waitForSelector('#drawer [data-ds=wty]');
  await p.waitForFunction(() => /the day it moved to Shipped/.test((document.querySelector('#wtyFrom') || {}).textContent || ''));
  const m = await ev(() => { const inv = isoOf(new Date(Date.now() - 44 * 864e5)), recv = isoOf(new Date(Date.now() - 40 * 864e5));
    return { inv, half: wtyDay(addDays(inv, 60)), free: wtyDay(addDays(inv, 30)), def: wtyDay(wtyAddMonths(inv, 6)), defDays: wtyDaysTo(wtyAddMonths(inv, 6)), arrive: wtyDay(addDays(recv, 10)), recv: wtyDay(recv), halfDays: wtyDaysTo(addDays(inv, 60)) }; });
  check(await sum() === 'Fit remake half price until about ' + m.half + ' · defects until about ' + m.def, 'its heading: “' + await sum() + '” (44 days in: half price for a refit; “about” until the invoice date is entered)');
  check(await p.textContent('#drawer [data-ds=wty] .dsT') === 'Specialty warranty' && /Until it’s entered, the dates are estimates, counted from the day it moved to Shipped/.test(await p.textContent('#wtyFrom')), 'until the invoice date is entered: estimates, counted from the day it moved to Shipped');
  const rows = await ev(() => Array.from(document.querySelectorAll('#wtyBox .wtyTbl tr')).map(r => ({ k: r.querySelector('th').textContent, v: r.querySelector('td').textContent, chip: (r.querySelector('.wtyChip') || {}).className || '', ct: (r.querySelector('.wtyChip') || {}).textContent || '' })));
  check(rows.map(r => r.k).join('|') === 'Something wrong when it arrives|Doesn’t fit|Defect|Anything else', 'rows: arrival, fit, defect (one: a MARA isn’t a Herbst), anything else');
  check(rows[0].v === 'Claim by ' + m.arrive + ' — 10 days after it came in (' + m.recv + ')' && rows[0].chip === 'wtyChip past' && rows[0].ct === 'past', 'arrival: claim by 10 days after it was checked in — past');
  check(rows[1].v === 'Free remake until about ' + m.free + '; half the price until about ' + m.half + '; full price after' && rows[1].chip === 'wtyChip half' && rows[1].ct === 'half price · about ' + m.halfDays + ' days left', 'fit: free to 30 days (past), half price to 60 — “half price · about ' + m.halfDays + ' days left”');
  check(rows[2].v === 'Free remake until about ' + m.def + ' — 6 months for any appliance or retainer; full price after' && rows[2].chip === 'wtyChip free' && rows[2].ct === 'free · about ' + m.defDays + ' days left', 'defect: free for 6 months — about ' + m.defDays + ' days left');
  check(rows[3].v === 'After 6 months, full price', 'anything else: full price after 6 months');
  check(/checked it into Milestones|moved it to Checked into Milestones/.test(await p.textContent('#histBox')) && /marked it complete/.test(await p.textContent('#histBox')) && !/shipped to the patient/.test(await p.textContent('#histBox')), 'its history: moved to Checked into Milestones, then marked complete (not “shipped to the patient”)');
  const claim = await ev(() => { const a = document.querySelector('#wtyBox .wtySteps a'); return { t: document.querySelector('#wtyBox .wtySteps').textContent, href: a.getAttribute('href'), tg: a.target, rel: a.rel, src: document.querySelector('#wtyBox .wty > .small.muted:last-child').textContent }; });
  check(/it has to reach them inside the window/.test(claim.t) && /customer service for one at \(800\) 522-4636,/.test(claim.t) && /4905 Hammond Industrial Dr\., Suite J, Cumming, GA 30041/.test(claim.t) && /updated scan/.test(claim.t) && /doesn’t repair/.test(claim.t),
    'how to claim: it has to reach Specialty in time (label, phone, address), an updated scan, remake not repair');
  check(claim.href === 'https://specialtyappliances.com/shipping-information/' && claim.tg === '_blank' && claim.rel === 'noopener noreferrer' && /Warranty, Replacement, Refinement and Returns Policy/.test(claim.src), '… the prepaid label link opens Specialty’s page in a new tab; the policy named as the source');
  await p.evaluate(() => document.querySelector('#drawer [data-ds=wty]').scrollIntoView()); await p.screenshot({ path: OUT + '/v34-wty-done.png' });

  // ---- the invoice date: saved when the box is left (Chrome reports every keystroke as a change), and the windows count from it
  const inv2 = await ev(() => addDays(todayISO(), -20)), m2 = await ev(d => ({ free: wtyDay(addDays(d, 30)), def: wtyDay(wtyAddMonths(d, 6)) }), inv2);
  const box = '#wtyBox [data-wty=inv]';
  await p.focus(box); await keys(mdy(inv2)); await p.waitForTimeout(100);
  check(await p.inputValue(box) === inv2 && !(await W('demoSpecW')) && !(await toastHas(/Invoice date/)), 'typing the date digit by digit saves nothing yet (no 0002-…, 0020-… along the way)');
  await clearToasts(); await p.press(box, 'Enter');
  check(await waitSum(new RegExp('^' + reEsc('Fit remake free until ' + m2.free + ' · defects until ' + m2.def) + '$')) && await toastHas(/Invoice date saved — the warranty counts from it/), 'Enter saves it: “Fit remake free until ' + m2.free + ' · defects until ' + m2.def + '” (no “about”)');
  const sv = await ev(() => { const c = DEMO.cases.get('demoSpecW'); return { inv: c.invDate, st: c.status, cl: c.closedAt, now: Date.now() }; });
  check(sv.inv === inv2 && sv.st === 'done' && sv.now - sv.cl > 39 * 864e5, '… on the case, which stays completed (same completion day)');
  check(/Counting from the date entered/.test(await p.textContent('#wtyFrom')) && await p.inputValue(box) === inv2 && !/about (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d+ day)/.test(await p.textContent('#wtyTbl')), '… “Counting from the date entered”, the date in the box, the dates and chips without “about”');
  await p.waitForFunction(() => /changed invoice date/.test((document.querySelector('#histBox') || {}).textContent || ''));
  check(true, 'history: “changed invoice date”');
  // correcting it part by part (Chrome reports each finished part as a change with nothing focused for a moment): one save, the right date
  const inv4 = await ev(() => addDays(todayISO(), -27));
  await clearToasts(); await p.focus(box); await keys(mdy(inv4)); await p.waitForTimeout(150);
  check(await W('demoSpecW') === inv2 && !(await toastHas(/Invoice date/)) && await p.inputValue(box) === inv4, 'retyping it (month, day, year) saves nothing along the way');
  await p.press(box, 'Enter');
  await p.waitForFunction(d => (DEMO.cases.get('demoSpecW') || {}).invDate === d, inv4); await p.waitForTimeout(250);
  check(await toastN(/Invoice date saved/) === 1 && await ev(() => DEMO.logs.filter(l => l.caseId === 'demoSpecW' && (l.fields || []).includes('invDate')).length) === 2, '… Enter: saved once, the corrected date');
  // one part rubbed out, a partial year, a date after today: not saved, the saved date put back
  await clearToasts(); await p.focus(box); await p.keyboard.press('Backspace'); await p.click('#drawer .dHd h3'); await p.waitForTimeout(200);
  check(await toastHas(/Enter the whole date from Specialty’s invoice/) && await W('demoSpecW') === inv4 && await p.inputValue(box) === inv4, 'one part rubbed out and the box left: “Enter the whole date…”, the saved date put back (not cleared)');
  await clearToasts(); await p.fill(box, '0202-08-20'); await p.click('#drawer .dHd h3'); await p.waitForTimeout(200);
  check(await toastHas(/Enter the whole date from Specialty’s invoice/) && await W('demoSpecW') === inv4 && await p.inputValue(box) === inv4, 'a partial year (0202) left in the box: the same');
  await clearToasts(); await p.fill(box, await ev(() => addDays(todayISO(), 9))); await p.press(box, 'Enter'); await p.waitForTimeout(200);
  check(await toastHas(/can’t be after today/) && await W('demoSpecW') === inv4, 'a date after today: “can’t be after today”, not saved');
  // a part still being typed when the box is left ("0" in the month, no month yet: Chrome would fill in January as it goes)
  await clearToasts(); await p.focus(box); await keys('0'); await p.press(box, 'Enter'); await p.waitForTimeout(200);
  check(await toastN(/Enter the whole date from Specialty’s invoice/) === 1 && await W('demoSpecW') === inv4 && await p.inputValue(box) === inv4 && !(await toastHas(/Invoice date saved/)), '“0” typed in the month and Enter: not saved as January — “Enter the whole date…”, the saved date put back');
  // saved, and back in the box before the save is through: the panel catches up once the box is left again
  const inv6 = await ev(() => addDays(todayISO(), -24)), m6 = await ev(d => wtyDay(addDays(d, 30)), inv6);
  await clearToasts(); await p.focus(box); await keys(mdy(inv6)); await p.press(box, 'Enter'); await p.focus(box); await p.waitForTimeout(250);
  check(await W('demoSpecW') === inv6 && await ev(() => S.wtyRedraw === true) && !(await sum()).includes(m6), 'saved, and the box focused again meanwhile: the panel waits (the heading not redrawn yet)');
  await p.press(box, 'Enter');
  check(await waitSum(new RegExp('^' + reEsc('Fit remake free until ' + m6))) && await ev(() => !S.wtyRedraw), '… left again: the panel catches up');
  // a live update while it's being typed waits until the box is left
  await clearToasts(); await p.focus(box); await keys(mdy(inv2).slice(0, 4));
  await ev(() => { document.querySelector('#wtyBox [data-wty=inv]').dataset.mark = '1'; return DEMO.mutateCase('demoSpecW', d => { d.notes = 'live update while typing'; }); });
  await p.waitForTimeout(250);
  check(await ev(() => { const i = document.querySelector('#wtyBox [data-wty=inv]'); return !!i && i.dataset.mark === '1' && document.activeElement === i; }) && !(await toastHas(/Invoice date/)), 'a live update while the date is being typed: the box stays as it is, focused');
  await keys(mdy(inv2).slice(4)); await p.press(box, 'Enter');
  await p.waitForFunction(d => (DEMO.cases.get('demoSpecW') || {}).invDate === d, inv2); await p.waitForTimeout(250);
  check(await ev(() => !document.querySelector('#wtyBox [data-wty=inv]').dataset.mark && !S.wtyRedraw) && await p.inputValue(box) === inv2, '… finished and Enter: saved, and the panel catches up');
  // cleared → back to the day it shipped
  await clearToasts(); await p.fill(box, ''); await p.press(box, 'Enter');
  check(await waitSum(new RegExp('^' + reEsc('Fit remake half price until about ' + m.half) + ' ·')) && await toastHas(/Invoice date cleared/) && !(await W('demoSpecW')), 'cleared: back to counting from the day it shipped');

  // ---- No Guarantee: no warranty
  await clearToasts(); await p.click('#wtyBox [data-wty=ng]');
  check(await waitSum(/^No Guarantee case: no warranty$/) && await toastHas(/Marked No Guarantee/) && await ev(() => DEMO.cases.get('demoSpecW').noGuarantee === true), 'ticking “No Guarantee”: the heading says no warranty; saved on the case');
  check(await p.isVisible('#wtyBox .wty.ng .wtyNg') && /no warranty or remake terms/.test(await p.textContent('#wtyBox .wtyNg')) && await p.isChecked('#wtyBox [data-wty=ng]') && !(await p.$('#wtyBox .wtyChip')), '… a notice, the deadlines greyed out without their “free” marks, the box stays ticked');
  await p.evaluate(() => document.querySelector('#drawer [data-ds=wty]').scrollIntoView()); await p.screenshot({ path: OUT + '/v34-wty-ng.png' });
  await clearToasts(); await p.click('#wtyBox [data-wty=ng]');
  check(await waitSum(/^Fit remake half price until/) && await toastHas(/No Guarantee taken off/) && await ev(() => DEMO.cases.get('demoSpecW').noGuarantee === ''), 'unticked: the warranty is back');
  // a whole date typed and the panel closed (×): saved; Esc puts the saved date back (Chrome would make a part being typed — "0" — January)
  const inv5 = await ev(() => addDays(todayISO(), -30));
  await clearToasts(); await p.focus(box); await keys(mdy(inv5)); await p.click('#drawer [data-act=closeDrawer] >> nth=0');
  await p.waitForSelector('#drawer', { state: 'detached' });
  await p.waitForFunction(d => (findCase('demoSpecW') || {}).invDate === d, inv5, { timeout: 5000 }).catch(() => {}); // (once the save is through)
  check(await W('demoSpecW') === inv5 && await toastHas(/Invoice date saved/), 'a whole date typed and the panel closed (×): saved');
  for (const typed of [mdy(await ev(() => addDays(todayISO(), -33))), '0']) {
    await ev(() => openDrawer('demoSpecW')); await p.waitForSelector('#drawer [data-ds=wty]'); await clearToasts();
    await p.focus(box); await keys(typed); await p.keyboard.press('Escape'); await p.waitForSelector('#drawer', { state: 'detached' }); await p.waitForTimeout(250);
    check(await W('demoSpecW') === inv5 && await ev(() => findCase('demoSpecW').invDate) === inv5 && !(await toastHas(/Invoice date/)), 'Esc with ' + (typed === '0' ? 'a part half typed' : 'a whole new date typed') + ': the panel closes, nothing saved');
  }

  // ---- the Herbst going to Specialty: none at Submit; moved to Shipped → 9 months for defects, half the Rx estimate for a refit
  const hid = await ev(() => Array.from(S.cases.values()).find(c => (c.appliances || []).includes('Herbst')).id);
  await ev(id => openDrawer(id), hid); await p.waitForSelector('#drawer [data-ds=rx]');
  check(!(await p.$('#drawer [data-ds=wty]')), 'the demo Herbst at Submit: no warranty yet');
  await p.click('#drawer [data-act=setStage][data-k=shipped]');
  const h = await ev(() => ({ free: wtyDay(addDays(todayISO(), 30)), def: wtyDay(wtyAddMonths(todayISO(), 9)) }));
  check(await waitSum(new RegExp('^' + reEsc('Fit remake free until about ' + h.free + ' · defects until about ' + h.def) + '$')), 'moved to Shipped: “Fit remake free until about ' + h.free + ' · defects until about ' + h.def + '” (9 months for a Herbst)');
  check(/moved it to Shipped/.test(await p.textContent('#histBox')), '… the move shows in its history right away');
  const hr = await ev(id => { const c = findCase(id), tot = rxEstimate(c.rx, c).total; return { half: money(tot / 2), tot: money(tot), rx: document.querySelector('#drawer [data-ds=rx]').textContent, rows: Array.from(document.querySelectorAll('#wtyBox .wtyTbl tr')).map(r => r.textContent) }; }, hid);
  check(hr.rx.includes(hr.tot) && hr.rows.some(r => r.includes('(about ' + hr.half + ' — half the Rx estimate)')) && hr.rows.some(r => /^Defect.*9 months for a Herbst/.test(r)) && hr.rows.some(r => /except a Herbst’s defect, to 9 months/.test(r)),
    'the fit row: about ' + hr.half + ' for a half-price remake (half its Rx estimate, ' + hr.tot + '); the defect row: 9 months');
  check(/the day it moved to Shipped/.test(await p.textContent('#wtyFrom')), 'counted from today, the day it moved to Shipped');
  // Edit keeps the invoice date; a step changed in Edit counts too
  const inv3 = await ev(() => addDays(todayISO(), -1));
  await p.fill('#wtyBox [data-wty=inv]', inv3); await p.press('#wtyBox [data-wty=inv]', 'Enter');
  await p.waitForFunction(d => findCase(d[0]).invDate === d[1], [hid, inv3]);
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#cf-notes'); await p.fill('#cf-notes', 'warranty edit check'); await p.click('[data-act=saveEdit]');
  await p.waitForSelector('#drawer [data-ds=wty]');
  check(await ev(d => { const c = DEMO.cases.get(d[0]); return c.invDate === d[1] && c.notes === 'warranty edit check'; }, [hid, inv3]), 'Edit → Save keeps the invoice date');
  check(await ev(() => { const hist = [{ a: 'edit', fields: ['stage'], from: 'mfg', to: 'shipped', at: Date.now() - 3 * 864e5 }]; return wtyDates({ id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'shipped', status: 'open' }, hist).shipped === addDays(todayISO(), -3); }),
    'a case moved to Shipped from Edit counts from that day (the edit is logged with where it went)');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#cf-stage'); await p.selectOption('#cf-stage', 'milestones'); await p.click('[data-act=saveEdit]');
  await p.waitForFunction(id => DEMO.logs.some(l => l.caseId === id && l.a === 'edit' && l.from === 'shipped' && l.to === 'milestones'), hid);
  check(true, '… Edit logs a step change with where it went (Shipped → Checked into Milestones)');
  await p.waitForSelector('#cbNo', { timeout: 3000 }).then(() => p.click('#cbNo')).catch(() => {}); // (its last step: “Mark complete?” — not yet)
  await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 3000 }).catch(() => {});
  // moved back for a remake (no invoice date entered): the warranty stays — its history shows it shipped
  await p.fill('#wtyBox [data-wty=inv]', ''); await p.press('#wtyBox [data-wty=inv]', 'Enter');
  await p.waitForFunction(id => !findCase(id).invDate && !DEMO.cases.get(id).invDate, hid); await p.waitForTimeout(200);
  await p.click('#drawer [data-act=setStage][data-k=mfg]'); await p.waitForTimeout(300);
  check(await ev(id => findCase(id).stage === 'mfg' && !wtyShows(findCase(id)), hid) && await p.isVisible('#drawer [data-ds=wty]') && /^Fit remake free until about/.test(await sum()), 'moved back to Manufacturing for a remake: the warranty stays (from its history)');
  await ev(() => closeDrawer(true)); await ev(id => openDrawer(id), hid);
  await p.waitForSelector('#drawer [data-ds=wty]', { timeout: 5000 }).catch(() => {});
  check(await p.isVisible('#drawer [data-ds=wty]'), '… and when the case is opened again (once its history is in)');
  // shipped again well after the invoice date: a line asks for the new invoice's date
  check(await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'shipped', status: 'open', appliances: ['MARA'], invDate: addDays(todayISO(), -40) }, d = wtyDates(c, [{ a: 'stage', from: 'mfg', to: 'shipped', at: Date.now() - 864e5 }]);
    return /moved to Shipped on .*, weeks after this invoice date — if Specialty sent a new invoice, enter its date/.test(wtyFromTxt(c, d)); }), 'shipped weeks after the invoice date entered: “if Specialty sent a new invoice, enter its date”');
  // someone else completes the case while a date is being typed: the panel closes, the whole date is saved (by the case's id)
  const inv7 = await ev(() => addDays(todayISO(), -3));
  await clearToasts(); await p.focus('#wtyBox [data-wty=inv]'); await keys(mdy(inv7));
  await ev(id => DEMO.mutateCase(id, () => 'done', { a: 'close' }), hid);
  await p.waitForSelector('#drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  await p.waitForFunction(d => (DEMO.cases.get(d[0]) || {}).invDate === d[1], [hid, inv7], { timeout: 5000 }).catch(() => {});
  check(await ev(d => { const c = DEMO.cases.get(d[0]); return c.status === 'done' && c.invDate === d[1]; }, [hid, inv7]) && !(await p.$('#drawer')), 'someone else completes the case while a date is being typed: the panel closes and the date is saved');
  await ev(() => closeDrawer(true));

  // ---- a Herbst and something else on one case: both defect windows; the heading names the sooner one, then the Herbst's
  const both = await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'shipped', status: 'open', appliances: ['Herbst', HAWLEY], invDate: todayISO() };
    const d = wtyDates(c, []), w = wtyWindows(c, d), div = document.createElement('div'); div.innerHTML = wtyTableHTML(c, d, w);
    const c7 = Object.assign({}, c, { invDate: wtyAddMonths(todayISO(), -7) }), d7 = wtyDates(c7, []);
    return { sum: wtySummary(c, d, w), rows: Array.from(div.querySelectorAll('th')).map(t => t.textContent).join('|'), six: wtyDay(wtyAddMonths(todayISO(), 6)), free: wtyDay(addDays(todayISO(), 30)),
      sum7: wtySummary(c7, d7, wtyWindows(c7, d7)), nine7: wtyDay(wtyAddMonths(c7.invDate, 9)) }; });
  check(both.rows === 'Something wrong when it arrives|Doesn’t fit|Defect (the Herbst)|Defect (the rest)|Anything else' && both.sum === 'Fit remake free until ' + both.free + ' · defects until ' + both.six,
    'a Herbst with Hawleys: a defect row for each (9 and 6 months); the heading gives the sooner (' + both.six + ')');
  check(both.sum7 === 'Free remake for Herbst defects until ' + both.nine7, '… 7 months in: “Free remake for Herbst defects until ' + both.nine7 + '” (only the Herbst is still covered)');
  const states = await ev(() => { const c = { id: 'x', type: 'appliance', lab: LAB_SPEC, stage: 'shipped', status: 'open', appliances: ['MARA'] };
    const s = (cc, hist) => { const d = wtyDates(cc, hist); return wtySummary(cc, d, wtyWindows(cc, d)); };
    const done = Object.assign({}, c, { stage: 'milestones', status: 'done', closedAt: Date.now() - 5 * 864e5 }), dd = wtyDates(done, []);
    return [s(c, null), s(c, []), s(Object.assign({}, c, { invDate: addDays(todayISO(), -400) }), []), s(Object.assign({}, c, { stage: 'milestones' }), [{ a: 'stage', from: 'shipped', to: 'milestones', at: Date.now() - 2 * 864e5 }]),
      dd.recvFrom === 'completed' && /counted from .*, the day the case was completed/.test(wtyTableHTML(done, dd, wtyWindows(done, dd))) && /the day the case was completed/.test(wtyFromTxt(done, dd))]; });
  check(states[0] === 'Loading…' && states[1] === 'Counts from the invoice date — add it' && states[2] === 'Past Specialty’s warranty: full price' && /^Fit remake free until about/.test(states[3]) && states[4] === true,
    'the heading while the history loads (“Loading…”), with nothing to count from (“add it”), long past (“full price”), checked in with no Shipped step (about, from that day); completed with no steps logged: from the completion day, said so');

  // ---- the Hawley at Manufacturing (Specialty): none yet; new Hawleys go to Specialty
  const hwid = await ev(() => Array.from(S.cases.values()).find(c => (c.appliances || []).includes(HAWLEY)).id);
  await ev(id => openDrawer(id), hwid); await p.waitForSelector('#drawer [data-ds=rxRet]'); await p.waitForTimeout(150);
  check(!(await p.$('#drawer [data-ds=wty]')), 'the demo Hawleys at Manufacturing: no warranty yet');
  await ev(() => closeDrawer(true));
  check(await ev(() => LAB_FOR[HAWLEY] === LAB_SPEC && LAB_FOR['Finger spring with no labial bow'] === LAB_SPEC), 'Hawley retainers and finger springs route to Specialty now');

  // ---- phone: it fits
  await p.setViewportSize({ width: 390, height: 844 });
  await ev(() => openDrawer('demoSpecW')); await p.waitForSelector('#drawer [data-ds=wty]');
  await p.waitForFunction(() => /Counting from the date entered/.test((document.querySelector('#wtyFrom') || {}).textContent || ''));
  await p.evaluate(() => document.querySelector('#drawer [data-ds=wty]').scrollIntoView());
  check(await ev(() => { const d = document.querySelector('#drawer'), t = document.querySelector('#wtyBox .wtyTbl').getBoundingClientRect(), dr = d.getBoundingClientRect(); return d.scrollWidth <= d.clientWidth + 1 && t.right <= dr.right + 1 && document.documentElement.scrollWidth <= 390; }), 'phone: the warranty fits (the deadlines stack)');
  await clearToasts(); await p.screenshot({ path: OUT + '/v34-wty-phone.png' });

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
