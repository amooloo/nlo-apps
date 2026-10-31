// Amir, 30 Oct 2026: "for the case tracker, can you add to the search on the top to be able to search by appointment day. so if I
// want to know cases needing delivery next week. I can do that or on thursday. etc." The search box also reads a day (today, Thursday,
// next week, 11/5, Nov 5 …), alone or with other words ("oliv next week"), and finds the cases whose delivery appt falls then — as
// well as whatever the words find on their own, as before. A line under the box says how it read it; the lists sort by the appt;
// Today groups them by day; board cards and Today's rows show the appt. Demo, made-up patients. (The day words themselves:
// test/appt_search.js.)
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  // the days, worked out here (not with the app's own helpers); weeks run Monday to Sunday
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const day0 = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }, T0 = day0(), wd = (T0.getDay() + 6) % 7;
  const plus = n => { const d = day0(); d.setDate(d.getDate() + n); return iso(d); };
  const nextMon = plus(7 - wd), nextSun = plus(13 - wd), lastMon = plus(-wd - 7), lastSun = plus(-wd - 1);
  const coming = w => plus((w - wd + 7) % 7); // the next such weekday (Monday = 0), today included
  const at = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayTxt = s => at(s).toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, at(s).getFullYear() !== T0.getFullYear() ? { year: 'numeric' } : {}));
  const grpTxt = s => s === plus(0) ? 'Today' : s === plus(1) ? 'Tomorrow' : s === plus(-1) ? 'Yesterday' : at(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-US' }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(URL); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await p.waitForTimeout(400);

  // a few cases put on known days (the demo's own lab emails reload cases from DEMO.cases now and then, so both copies change)
  const ids = await p.evaluate(a => {
    const all = openCases(), used = new Set(), pick = type => { const c = all.find(x => x.type === type && !used.has(x.id)); used.add(c.id); return c; };
    const put = (c, x) => { Object.assign(c, x); const d = DEMO.cases.get(c.id); if (d && d !== c) Object.assign(d, x); return c.id; };
    const r = {
      tue: put(pick('oliv'), { deliveryDate: a.tue, deliveryTime: '10:30', shipToPatient: '' }),
      thuA: put(pick('retainer'), { deliveryDate: a.thu, deliveryTime: '' }),
      thuB: put(pick('nla'), { deliveryDate: a.thu, deliveryTime: '09:00', shipToPatient: '', assignee: 'gwen' }),
      tom: put(pick('insmile'), { deliveryDate: a.tom, deliveryTime: '08:30' }),
      after: put(pick('appliance'), { deliveryDate: a.after, deliveryTime: '14:00' }),
      monica: put(pick('ulab'), { patient: 'Monica Placeholder', deliveryDate: a.far, deliveryTime: '' }),
      mon: put(pick('angel'), { deliveryDate: a.mon, deliveryTime: '11:00' }),
      wkThu: put(pick('oliv'), { deliveryDate: a.wkThu, deliveryTime: '14:00', shipToPatient: '' }),
      old: put(pick('models'), { patient: 'Olive Oldcase', deliveryDate: a.old, deliveryTime: '', labDate: '', scanDate: a.oldScan })
    };
    queueRender(); return r;
  }, { tue: plus(8 - wd), thu: plus(10 - wd), after: plus(14 - wd), far: plus(30), mon: coming(0), wkThu: coming(3), tom: plus(1), old: plus(-150), oldScan: plus(-155) });
  await p.waitForTimeout(200);
  // every open case as the search sees it: its delivery appt (else an older due date) and the words it can be found by
  const snap = () => p.evaluate(() => openCases().map(c => ({ id: c.id, patient: c.patient, type: c.type, d: c.deliveryDate || c.dueDate || '', tm: c.deliveryDate ? c.deliveryTime || '' : '',
    text: [c.patient, c.chart, c.detail, typeOf(c).l, stageLabel(c), staffName(c.assignee, c.assigneeName), c.labRef, c.tracking].map(x => String(x || '').toLowerCase()) })));
  const has = (c, w) => c.text.some(x => x.includes(w.toLowerCase()));
  const want = (cs, q, a, b, rest) => cs.filter(c => has(c, q) || (!!a && c.d >= a && c.d <= b && (!rest || rest.split(' ').every(w => has(c, w)))));
  const key = c => c.d ? c.d + 'T' + (c.tm || '24:00') : '9999';
  const byKey = (x, y) => key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : String(x.patient).localeCompare(String(y.patient));
  const search = async q => { await p.fill('#q', q); await p.waitForTimeout(220); };
  const rows = () => p.$$eval('#listBody tbody tr[data-id]', trs => trs.map(t => t.dataset.id));
  const hint = () => p.evaluate(() => { const h = document.querySelector('#qdHint'); return h ? h.textContent.replace(/\s+/g, ' ').trim() : null; });
  const arrow = () => p.evaluate(() => Array.from(document.querySelectorAll('#listBody thead button[data-act=sort]')).map(b => b.textContent.trim()).filter(t => /[↑↓]$/.test(t)).join(','));
  const name = async id => (await snap()).find(c => c.id === id).patient;

  console.log('\n# All open cases: “next week” — the cases whose delivery appt is next week, in appointment order');
  await p.click('#nav-list'); await p.waitForSelector('#listBody');
  let cs = await snap(), exp = want(cs, 'next week', nextMon, nextSun).sort(byKey);
  await search('next week'); let got = await rows();
  check(exp.length >= 3 && [ids.tue, ids.thuA, ids.thuB].every(id => exp.some(c => c.id === id)) && !exp.some(c => c.id === ids.after), 'the demo has cases next week (and one the Monday after, which isn’t)');
  check(JSON.stringify(got) === JSON.stringify(exp.map(c => c.id)), 'the list is exactly next week’s ' + exp.length + ' cases, earliest appt first (' + got.length + ' rows)');
  check(await hint() === 'Delivery appts next week · ' + dayTxt(nextMon) + ' – ' + dayTxt(nextSun), 'the line under the search reads “' + await hint() + '”');
  check(await arrow() === 'Delivery appt ↑', 'the Delivery appt heading shows the order (↑)');
  check(((await p.textContent('#listBody > .small')) || '').trim().startsWith(exp.length + ' case'), 'the count under the list says ' + exp.length);
  const iThu = got.indexOf(ids.thuB), iThuA = got.indexOf(ids.thuA);
  check(iThu >= 0 && iThuA === iThu + 1 || (iThuA > iThu && got.slice(iThu + 1, iThuA).every(id => (exp.find(c => c.id === id) || {}).d === plus(10 - wd))), 'on the same day the 9:00 AM appt comes before the one with no time');
  await p.screenshot({ path: OUT + '/v67-list-nextweek.png' });

  console.log('\n# Its order flips from the heading, and clearing the search puts the list back');
  await p.click('#listBody thead button[data-act=sort][data-k=appt]'); await p.waitForTimeout(150);
  got = await rows(); check(await arrow() === 'Delivery appt ↓' && JSON.stringify(got) === JSON.stringify(exp.slice().reverse().map(c => c.id)), 'Delivery appt ↓: latest first');
  await p.evaluate(() => { S.sort = { k: 'due', dir: 1 }; }); await search('');
  check(await hint() === null && await arrow() === '' && (await rows()).length === cs.length, 'no search: no line, no arrow, every open case (' + cs.length + ')');

  console.log('\n# A weekday: Thursday (the next one, today included)');
  cs = await snap(); exp = want(cs, 'thursday', coming(3), coming(3)).sort(byKey);
  await search('Thursday'); got = await rows();
  check(exp.length >= 1 && exp.some(c => c.id === ids.wkThu) && JSON.stringify(got) === JSON.stringify(exp.map(c => c.id)), '“Thursday” finds the ' + exp.length + ' case(s) on ' + dayTxt(coming(3)));
  check(await hint() === 'Delivery appts ' + dayTxt(coming(3)), 'the line reads “' + await hint() + '”');
  await search('thurs'); check(JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)), '“thurs” is Thursday too');
  await search('delivery appts on Thursday'); check(JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)), '“delivery appts on Thursday” reads the same (the words around the day are left out)');
  exp = want(cs, 'tomorrow', plus(1), plus(1)).sort(byKey); await search('tomorrow');
  check(exp.some(c => c.id === ids.tom) && JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)) && await hint() === 'Delivery appts tomorrow · ' + dayTxt(plus(1)), '“tomorrow”: ' + exp.length + ' case(s), “' + await hint() + '”');

  console.log('\n# A list: “Thursday and Friday” (the Friday after that Thursday)');
  { const thu = coming(3), f = at(thu); f.setDate(f.getDate() + 1); const fri = iso(f);
    exp = cs.filter(c => has(c, 'thursday and friday') || c.d === thu || c.d === fri).sort(byKey); await search('Thursday and Friday');
    check(exp.length >= 1 && JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)) && await hint() === 'Delivery appts ' + dayTxt(thu) + ' and ' + dayTxt(fri), '“Thursday and Friday”: ' + exp.length + ' case(s), “' + await hint() + '”');
    await search("what's due Thursday"); check(JSON.stringify(await rows()) === JSON.stringify(cs.filter(c => c.d === thu).sort(byKey).map(c => c.id)), '“what’s due Thursday”: just Thursday’s (the words that can’t narrow anything are left out)'); }

  console.log('\n# A date, and a stretch of days');
  const [, mm, dd] = plus(10 - wd).split('-').map(Number);
  exp = want(cs, mm + '/' + dd, plus(10 - wd), plus(10 - wd)).sort(byKey); await search(mm + '/' + dd);
  check(exp.length >= 2 && JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)), '“' + mm + '/' + dd + '” finds that day’s ' + exp.length + ' cases');
  exp = want(cs, 'monday to thursday', nextMon, plus(10 - wd)).sort(byKey); await search('next monday to thursday');
  check(JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)) && await hint() === 'Delivery appts ' + dayTxt(nextMon) + ' – ' + dayTxt(plus(10 - wd)), '“next monday to thursday”: ' + exp.length + ' cases, “' + await hint() + '”');

  console.log('\n# A day with other words: “oliv next week” — only Oliv’s, next week');
  exp = want(cs, 'oliv next week', nextMon, nextSun, 'oliv').sort(byKey); await search('oliv next week'); got = await rows();
  check(exp.length >= 1 && exp.every(c => c.type === 'oliv') && exp.some(c => c.id === ids.tue) && JSON.stringify(got) === JSON.stringify(exp.map(c => c.id)), 'Oliv cases next week: ' + exp.length + ' (no other kind)');
  check(await hint() === '“oliv” with a delivery appt next week · ' + dayTxt(nextMon) + ' – ' + dayTxt(nextSun), 'the line reads “' + await hint() + '”');
  exp = cs.filter(c => has(c, 'oliv and angel next week') || (c.d >= nextMon && c.d <= nextSun && (has(c, 'oliv') || has(c, 'angel')))).sort(byKey); await search('Oliv and Angel next week'); got = await rows();
  check(exp.some(c => c.type === 'oliv') && exp.some(c => c.type === 'angel') && JSON.stringify(got) === JSON.stringify(exp.map(c => c.id)) && /^“Oliv or Angel” with a delivery appt next week/.test(await hint()), '“Oliv and Angel next week”: either kind (' + exp.length + '), “' + await hint() + '”');
  const asg = await p.evaluate(id => staffName(findCase(id).assignee, ''), ids.thuB), first = asg.split(' ')[0]; // (Gwen)
  exp = want(cs, first + ' next week', nextMon, nextSun, first.toLowerCase()).sort(byKey); await search(first + ' next week');
  check(exp.some(c => c.id === ids.thuB) && JSON.stringify(await rows()) === JSON.stringify(exp.map(c => c.id)), '“' + first + ' next week”: the cases assigned to ' + first + ' next week (' + exp.length + ')');

  console.log('\n# Words alone search as before; a day only ever adds to them');
  const pt = await name(ids.tue); exp = cs.filter(c => has(c, pt)); await search(pt); got = await rows();
  check(await hint() === null && got.length === exp.length && exp.every(c => got.includes(c.id)), 'a patient’s name: no line, the same ' + exp.length + ' case(s) as before');
  exp = want(cs, 'Mon', coming(0), coming(0)); await search('Mon'); got = await rows();
  check(got.includes(ids.monica) && got.includes(ids.mon) && got.length === exp.length && exp.every(c => got.includes(c.id)), '“Mon”: Monica Placeholder (the words) and ' + dayTxt(coming(0)) + '’s appts (' + exp.length + ' in all)');
  await search('Moni'); got = await rows();
  check(await hint() === null && got.includes(ids.monica) && !got.includes(ids.mon), '“Moni”: just Monica again, no line');
  await search('nothing like this 123'); check(await hint() === null && (await rows()).length === 0, 'a search that’s neither: nothing, as before');

  console.log('\n# Typing it a key at a time (each key redraws the list) keeps every key and the cursor');
  await p.fill('#q', ''); await p.waitForTimeout(150); await p.click('#q'); await p.keyboard.type('next week', { delay: 35 }); await p.waitForTimeout(250);
  check(await p.inputValue('#q') === 'next week' && await p.evaluate(() => document.activeElement && document.activeElement.id === 'q') && /^Delivery appts next week/.test(await hint() || ''), 'the box says “next week”, still has the cursor, and the line is there');

  console.log('\n# Typing “thursday”: the line comes at “thu” and holds');
  await p.fill('#q', ''); await p.waitForTimeout(150); await p.click('#q'); const seen = [];
  for (const ch of 'thursday') { await p.keyboard.type(ch); await p.waitForTimeout(80); seen.push(await hint() !== null); }
  check(JSON.stringify(seen) === JSON.stringify([false, false, true, true, true, true, true, true]), 'the line, letter by letter: ' + seen.map(x => x ? '●' : '○').join(''));

  console.log('\n# The line sits under the box without covering anything');
  const box = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.bottom, r: r.right, w: r.width }; }, s);
  const sideways = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  let hb = await box('#qdHint'), ib = await box('#q'), fb = await box('#view .filters');
  check(hb && hb.y >= ib.b && hb.b <= fb.y, 'under the search box (' + Math.round(hb.y - ib.b) + ' px) and above the filters (' + Math.round(fb.y - hb.b) + ' px to spare)');
  const moves = async () => { await search('next wee'); const a = (await box('#view .filters')).y; await search('next week'); const b = (await box('#view .filters')).y; return [a, b]; };
  let mv = await moves(); check(Math.abs(mv[0] - mv[1]) < 0.5 && await hint() !== null, 'nothing below moves when it comes (filters at ' + Math.round(mv[0]) + ' px both times)');
  await p.setViewportSize({ width: 900, height: 700 }); await p.waitForTimeout(200);
  hb = await box('#qdHint span'); fb = await box('#view .filters');
  check(hb && hb.b <= fb.y && await sideways() <= 0, 'at 900 px wide too, and no sideways scroll');
  await p.setViewportSize({ width: 1360, height: 900 }); await p.waitForTimeout(150);

  console.log('\n# Today: the day’s appts by day (instead of Coming up), with appt chips');
  await p.click('#nav-today'); await p.waitForSelector('.tiles'); await p.waitForTimeout(200);
  cs = await snap(); exp = want(cs, 'next week', nextMon, nextSun).filter(c => c.d >= nextMon && c.d <= nextSun).sort(byKey);
  const today = await p.evaluate(() => { const card = document.querySelector('.qdCard'); if (!card) return null;
    return { h: card.querySelector('h3').textContent.trim(), sub: card.querySelector('.sub').textContent.trim(), grps: Array.from(card.querySelectorAll('.dueGrp')).map(g => ({ h: g.querySelector('h4').textContent.trim(), ids: Array.from(g.querySelectorAll('.row')).map(r => r.dataset.id), chips: Array.from(g.querySelectorAll('.row .due')).map(x => x.textContent.trim()) })),
      coming: Array.from(document.querySelectorAll('#view .cardHd h3')).some(h => h.textContent.trim() === 'Coming up') }; });
  const days = []; exp.forEach(c => { let g = days.find(x => x.d === c.d); if (!g) days.push(g = { d: c.d, ids: [] }); g.ids.push(c.id); });
  check(today && today.h === 'Delivery appts' && !today.coming, 'a Delivery appts card takes Coming up’s place');
  check(today && today.sub === 'next week · ' + dayTxt(nextMon) + ' – ' + dayTxt(nextSun) + ' · ' + exp.length + ' cases', 'it says which days and how many (“' + (today && today.sub) + '”)');
  check(today && JSON.stringify(today.grps.map(g => g.h)) === JSON.stringify(days.map(g => grpTxt(g.d) + ' · ' + g.ids.length)), 'one group per day: ' + (today ? today.grps.map(g => g.h).join(' | ') : '—'));
  check(today && JSON.stringify(today.grps.map(g => g.ids)) === JSON.stringify(days.map(g => g.ids)), 'each day’s cases, in appointment order');
  check(today && today.grps.every(g => g.chips.length === g.ids.length && g.chips.every(t => /^(Appt|Expected delivery) /.test(t))), 'every row shows its appt chip');
  await p.screenshot({ path: OUT + '/v67-today.png', fullPage: true });
  await search('');
  check(await p.evaluate(() => !document.querySelector('.qdCard') && Array.from(document.querySelectorAll('#view .cardHd h3')).some(h => h.textContent.trim() === 'Coming up')), 'search cleared: Coming up is back');

  console.log('\n# Clean up old cases (it ticks everything it lists) keeps to what the words find');
  { const [, om, od] = plus(-150).split('-').map(Number); await search(om + '/' + od);
    const cl = await p.evaluate(id => ({ inCard: !!document.querySelector('#cleanCard input[data-old="' + id + '"]'), inAppts: !!document.querySelector('.qdCard .row[data-id="' + id + '"]') }), ids.old);
    check(cl.inAppts && !cl.inCard, 'her old appt day (' + om + '/' + od + '): Olive Oldcase is under Delivery appts, not in Clean up old cases');
    await search('Olive'); check(await p.evaluate(id => !!document.querySelector('#cleanCard input[data-old="' + id + '"]'), ids.old), 'her name: she’s in Clean up old cases, as before');
    await search(''); }

  console.log('\n# Board: only next week’s cards, each with its appt');
  await p.click('#nav-board'); await p.waitForSelector('.board'); await search('next week');
  const bd = await p.evaluate(() => ({ tabs: Array.from(document.querySelectorAll('.boardTabs .chip .c')).reduce((n, x) => n + Number(x.textContent), 0),
    chips: Array.from(document.querySelectorAll('.board .kc .ft .due')).map(x => x.textContent.trim()) }));
  check(bd.tabs === exp.length, 'the tabs count ' + bd.tabs + ' cards in all (' + exp.length + ' next week)');
  check(bd.chips.length > 0 && bd.chips.every(t => /^(Appt|Expected delivery) /.test(t)), 'the cards on this tab show their appt (' + bd.chips.join(', ') + ')');
  await p.screenshot({ path: OUT + '/v67-board.png' });

  console.log('\n# Completed: “last week” — delivered last week, in appointment order');
  await p.click('#nav-done'); await p.waitForSelector('.doneTbl, #view .empty'); await p.waitForTimeout(300);
  // an older completed case with only a due date (last week's Thursday): found by it, and the column shows it
  const dueId = await p.evaluate(a => { const c = S.closed.find(x => x.deliveryDate && (x.closedAt || 0) >= Date.now() - 30 * 864e5); const x = { deliveryDate: '', deliveryTime: '', dueDate: a };
    Object.assign(c, x); const d = DEMO.cases.get(c.id); if (d && d !== c) Object.assign(d, x); return c.id; }, plus(-wd - 4));
  await search('last week');
  const closed = await p.evaluate(() => S.closed.filter(c => (c.closedAt || 0) >= Date.now() - 90 * 864e5).map(c => ({ id: c.id, patient: c.patient, d: c.deliveryDate || c.dueDate || '',
    text: [c.patient, c.chart, c.detail, typeOf(c).l, stageLabel(c), staffName(c.assignee, c.assigneeName), c.labRef, c.tracking].map(x => String(x || '').toLowerCase()) })));
  const dexp = closed.filter(c => has(c, 'last week') || (c.d >= lastMon && c.d <= lastSun));
  const drows = await p.$$eval('.doneTbl tbody tr[data-id]', trs => trs.map(t => t.dataset.id));
  check(dexp.length >= 1 && drows.length === dexp.length && dexp.every(c => drows.includes(c.id)), 'the ' + dexp.length + ' completed case(s) with an appt ' + lastMon + '…' + lastSun);
  const dueCell = await p.evaluate(id => { const tr = document.querySelector('.doneTbl tbody tr[data-id="' + id + '"]'); if (!tr) return null; const ths = Array.from(document.querySelectorAll('.doneTbl thead th')).map(t => t.textContent.replace(/[↑↓]/g, '').trim());
    return tr.children[ths.indexOf('Delivery appt')].textContent.trim(); }, dueId);
  check(dueCell === 'Due ' + at(plus(-wd - 4)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), 'an older case found by its due date shows it in the Delivery appt column (“' + dueCell + '”)');
  const dd2 = drows.map(id => closed.find(c => c.id === id).d);
  check(dd2.every((d, i) => !i || dd2[i - 1] <= d) && await p.evaluate(() => Array.from(document.querySelectorAll('.doneTbl thead button')).some(b => b.textContent.trim() === 'Delivery appt ↑')), 'earliest appt first (Delivery appt ↑)');
  await search('');
  check(await p.evaluate(() => Array.from(document.querySelectorAll('.doneTbl thead button')).some(b => b.textContent.trim() === 'Completed ↓')), 'search cleared: newest completed first again');

  console.log('\n# Phones');
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('#mnav-list'); await p.waitForSelector('#listBody'); await search('next week');
  hb = await box('#qdHint span'); ib = await box('#q'); fb = await box('#view .filters');
  check(hb && hb.y >= ib.b && hb.b <= fb.y && hb.r <= 390 && await sideways() <= 0, 'the line fits under the box, above the filters, with no sideways scroll');
  mv = await moves(); check(Math.abs(mv[0] - mv[1]) < 0.5, 'and nothing below moves when it comes (filters at ' + Math.round(mv[0]) + ' px both times)');
  cs = await snap(); exp = want(cs, 'next week', nextMon, nextSun);
  check((await rows()).length === exp.length, 'the same ' + exp.length + ' cases');
  await p.screenshot({ path: OUT + '/v67-phone.png' });

  console.log('\n# No page errors');
  check(!errs.length, errs.length ? errs.join('\n') : 'none');
  await browser.close();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})();
