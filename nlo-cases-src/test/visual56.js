// Not shipped → an email to the front desk (Amir, 8 Oct 2026: "when the case gets delayed (not shipped by the expected time) please
// also send a email to Questions@thenextlevelorthodontics.com to let the front desk know" — "want to make sure the email goes out
// automatically"). Demo, made-up patients: what the app hands the email script (DEMO.outbox) instead of a real email.
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
  await p.waitForFunction(() => S.rulesLv === 3, null, { timeout: 5000 }).catch(() => {});
  // the Email updates card (Team & security redraws as the mailboxes check in, so it's found afresh each time)
  const shotCard = async f => { await p.waitForTimeout(400); const r = await p.evaluate(() => { const c = document.querySelector('#nsBox').closest('.card'); c.scrollIntoView({ block: 'start' }); const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, innerHeight - b.y) }; });
    await p.screenshot({ path: OUT + '/' + f, clip: r }); };

  // a Herbst from Specialty, not shipped, its delivery appt the next business day (red), and one whose appt is 10 days out
  const ids = await p.evaluate(() => {
    const bizAfter = (iso, n) => { let d = iso; for (let i = 0; n > 0 && i < 30; i++) { d = addDays(d, 1); if (isBizDay(d)) n--; } return d; };
    const mk = (patient, days, extra) => { const c = openCases().find(x => x.type === 'appliance' && !shipWarn(x) && !x.__used && caseStages(x).some(s => s[0] === 'shipped') && stageIndex(x) < caseStages(x).findIndex(s => s[0] === 'shipped'));
      c.__used = true; const d = DEMO.cases.get(c.id); Object.assign(d, { patient, deliveryDate: bizAfter(todayISO(), days), deliveryTime: '14:00', chart: '55501', labRef: '4242', noshipMail: '' }, extra || {}); DEMO.emit(d); return c.id; };
    return { late: mk('Frida Frontdesk', 1), later: mk('Lars Later', 10) };
  });
  await p.waitForTimeout(300);
  check(await p.evaluate(id => (shipWarn(findCase(id)) || {}).lv === 'late', ids.late), 'a case not shipped the business day before its delivery appt is red Not shipped');
  check(await p.evaluate(() => DEMO.outbox.length) === 0, 'off: nothing goes to the front desk');

  console.log('\n# The owner turns it on (Team & security → Email updates)');
  await p.click('#nav-admin'); await p.waitForSelector('#nsBox');
  const sayOff = await p.textContent('#nsBox');
  check(/Off/.test(sayOff) && /once — by itself/.test(sayOff), 'the card says it’s off, and that once on it goes by itself');
  check(await p.inputValue('#nsTo') === 'Questions@thenextlevelorthodontics.com', 'the address starts as Questions@thenextlevelorthodontics.com');
  check(await p.$eval('#nsFrom', s => s.options[s.selectedIndex].textContent) === 'records@example.com', 'sent from records@ (the mailbox running the newer script; a gmail.com one comes last)');
  check(await p.isChecked('#nsNames'), 'with the patient’s name, to start with');
  await shotCard('v56-settings-off.png');
  await p.click('[data-act=nsSave]');
  await p.waitForFunction(() => DEMO.outbox.length > 0, null, { timeout: 8000 }).catch(() => {});
  const box = await p.evaluate(() => DEMO.outbox.map(o => ({ to: o.to, subject: o.msg.subject, text: o.msg.text })));
  const fr = box.find(o => /Frida Frontdesk/.test(o.subject));
  check(!!fr && fr.to === 'Questions@thenextlevelorthodontics.com', 'turned on: the red case’s email goes to the front desk by itself (' + box.length + ' in all)');
  check(!!fr && /^Not shipped: Frida Frontdesk - delivery appt /.test(fr.subject), 'subject: “' + (fr && fr.subject) + '”');
  check(!!fr && /isn't marked shipped yet/.test(fr.text) && /Delivery appt: .* at 2:00 PM/.test(fr.text) && /check with the lab, or reschedule/.test(fr.text) && /Chart #: 55501/.test(fr.text) && /4242/.test(fr.text), 'the email: who, what, from which lab, the appt and time, what to do, chart # and lab case #');
  console.log('      ---\n' + (fr ? fr.text : '').split('\n').map(l => '      ' + l).join('\n') + '\n      ---');
  check(!box.some(o => /Lars Later/.test(o.subject)), 'a case whose appt is days away isn’t emailed');
  check(await p.evaluate(id => findCase(id).noshipMail === shipWarn(findCase(id)).appt, ids.late), 'the case remembers it was emailed for that appt');
  const n1 = box.length;
  await p.evaluate(() => nsCheck()); await p.waitForTimeout(500); await p.evaluate(() => nsCheck()); await p.waitForTimeout(500);
  check(await p.evaluate(() => DEMO.outbox.length) === n1, 'checking again sends nothing twice');
  await shotCard('v56-settings-on.png');

  console.log('\n# On the case');
  await p.evaluate(id => openDrawer(id), ids.late); await p.waitForSelector('#drawer .notice.noship');
  check(/The front desk was emailed\./.test(await p.textContent('#drawer .notice.noship')), 'the red notice says the front desk was emailed');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=history]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=history] .dsTg');
  await p.waitForSelector('#histBox .hist:has-text("emailed the front desk")', { timeout: 4000 }).catch(() => {});
  const hrow = await p.textContent('#histBox .hist:has-text("emailed the front desk")').catch(() => '');
  check(/NLO Cases emailed the front desk \(Questions@thenextlevelorthodontics\.com\): not marked shipped, with the delivery appt on /.test(hrow), 'History: “' + hrow.replace(/\s+/g, ' ').trim() + '”');
  check(!(await p.$('#histBox .hist:has-text("emailed the front desk") .stkAdd')), 'no sticker smiley on a row NLO Cases made by itself');
  await p.screenshot({ path: OUT + '/v56-case.png', clip: { x: 800, y: 0, width: 560, height: 420 } });

  console.log('\n# The appt moves, and it’s late again: one more email');
  await p.evaluate(id => { const d = DEMO.cases.get(id); d.deliveryDate = addDays(d.deliveryDate, 1); while (!isBizDay(d.deliveryDate)) d.deliveryDate = addDays(d.deliveryDate, 1); DEMO.emit(d); }, ids.late);
  await p.waitForTimeout(300); await p.evaluate(() => nsCheck()); await p.waitForTimeout(800);
  const late2 = await p.evaluate(id => (shipWarn(findCase(id)) || {}).lv, ids.late);
  const n2 = await p.evaluate(() => DEMO.outbox.filter(o => /Frida Frontdesk/.test(o.msg.subject)).length);
  check(late2 === 'late' ? n2 === 2 : n2 === 1, 'a new appt that’s also late sends one more (' + late2 + ', ' + n2 + ' emails for her)');

  console.log('\n# Without names');
  await p.evaluate(() => closeDrawer()); await p.click('#nav-admin'); await p.waitForSelector('#nsBox');
  await p.uncheck('#nsNames'); await p.click('[data-act=nsSave]'); await p.waitForTimeout(300);
  await p.evaluate(id => { const d = DEMO.cases.get(id); d.noshipMail = ''; DEMO.emit(d); }, ids.late); await p.waitForTimeout(300);
  await p.evaluate(() => nsCheck()); await p.waitForTimeout(800);
  const last = await p.evaluate(() => DEMO.outbox[DEMO.outbox.length - 1].msg);
  check(!/Frida|Frontdesk|55501|4242/.test(last.subject + last.text) && /Not shipped: a case for the delivery appt on /.test(last.subject) && /Open NLO Cases/.test(last.text), 'no patient name, chart # or lab case # in it — “' + last.subject + '”');

  console.log('\n# Test email, and off');
  await p.click('[data-act=nsTest]'); await p.waitForTimeout(400);
  check(await p.evaluate(() => DEMO.outbox.some(o => o.test && o.to === 'Questions@thenextlevelorthodontics.com')), 'Send a test email hands the script a test note');
  await p.click('[data-act=nsOff]'); await p.waitForTimeout(300);
  const nOff = await p.evaluate(() => DEMO.outbox.length);
  await p.evaluate(id => { const d = DEMO.cases.get(id); d.noshipMail = ''; DEMO.emit(d); }, ids.late); await p.waitForTimeout(300);
  await p.evaluate(() => { NS.cfg = null; return nsCheck(); }); await p.waitForTimeout(600);
  check(await p.evaluate(() => DEMO.outbox.length) === nOff && /Off/.test(await p.textContent('#nsBox')), 'turned off: nothing more is sent');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
