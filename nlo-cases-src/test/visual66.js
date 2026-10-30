// Amir, 30 Oct 2026: "the zoom invites got to akhavan.ak@gmail.com which is already connected to the app. can you use this to scan and
// add the zoom with relevant information to the case tracker?" — Partners' Airway Department's invites (made up, in their format: a
// Google Calendar invitation booked on their Calendly) put through the demo's inbox:
// 1. The demo's own invite names no patient: Today's Email updates row shows the call (day, time, the event's name), says it doesn't
//    name the patient and suggests the one MARPE case waiting for a Zoom date (picked already); MARPE cases come first in the menu.
//    Apply → that case gets the call's date, time and link (it stays at Records: its CBCT isn't on file), Join Zoom; the row goes.
// 2. An invite naming two patients: the one whose MARPE case is at Submitted to lab with both records → applied by itself (Zoom call
//    scheduled, the date, time and link; Join Zoom on its card; the history says the Partners email did it). The other is misspelled
//    → Today: "Matched on the last name only"; Apply → that case. The email leaves the inbox.
// 3. The same invite again (the other mailbox's copy): nothing changes, no row. A time changed by hand since isn't undone by a copy
//    that comes late.
// 4. A rescheduled call ("Updated invitation") → the new day, time and link.
// 4b. An invite sent before a call was set by hand (another day) waits on Today, saying what the case has; Apply puts it on. A name
//    with an initial is only suggested.
// 5. Phone width: the row fits. No page errors.
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const PAGE = (process.env.NLO_PAGE || 'http://127.0.0.1:8765/nlo-cases.html') + '?demo';
const W = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = k => { const d = new Date(Date.now() + k * 864e5), md = M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  let tz = 'EST'; try { tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(d).find(x => x.type === 'timeZoneName').value; } catch (e) { }
  return { iso: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), subj: W[d.getDay()].slice(0, 3) + ' ' + md, body: W[d.getDay()] + ' ' + md, tz }; };
// an invite as Google sends it for Partners' Calendly booking (names: one per line under the form's question; null: no such question)
const invite = o => { const d = o.day, link = o.link;
  return { box: o.box || 'office@example.com', from: 'Airway Department <airway@partnersdentalstudio.com>', date: o.date,
    subject: (o.pre || 'Invitation') + ': Amir Akhavan and Airway Department @ ' + d.subj + ' ' + o.from + ' - ' + o.to + ' (' + d.tz + ') (office@example.com)',
    text: 'Amir Akhavan and Airway Department\n' + d.body + ' ⋅ ' + o.from + ' – ' + o.to + '\nEastern Time - New York\n\nLocation\n' + link + '\t\nhttps://www.google.com/url?q=' + encodeURIComponent(link) + '&sa=D&source=calendar&usd=2\n\n' +
      'Event Name\n' + (o.title || 'CBCT Consultation') + '\n\nLocation: This is a Zoom web conference.\n\nYou can join this meeting from your computer, tablet, or smartphone.\n' + link + '\n\nPassword: 123456\n\n' +
      (o.names ? 'How many patients would you like to review? (maximum of 4 patients per\nmeeting): ' + o.names.length + '\n\nProvide first and last name for the patient(s):\n' + o.names.join('\n') + '\n\n' : '') +
      'Name of doctor and practice:\nDr. Amir Akhavan\nNext Level Orthodontics\n\nNeed to make changes to this event?\nCancel:\nhttps://calendly.com/cancellations/0000\n\nPowered by Calendly.com\n' }; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'en-US' }); await routes(ctx); await panelsOpen(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(PAGE); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  const caseOf = id => p.evaluate(id => { const c = findCase(id); return c ? JSON.parse(JSON.stringify(c)) : null; }, id);
  const make = o => p.evaluate(o => B.createCase(Object.assign({ type: 'marpe', lab: LAB_PART, detail: 'MARPE', comments: [], createdAt: Date.now(), createdBy: meSid() }, o)), o);
  const closeAll = () => p.evaluate(() => { if (S.editing) { S.editing = false; S.editWiz = null; } closeDrawer(true); const m = document.querySelector('#modalWrap'); if (m) m.remove(); });
  const today = async () => { await closeAll(); await p.click('#nav-today'); await p.waitForTimeout(150); };
  const open = async id => { await closeAll(); await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .dsList'); };
  // an email into the demo's inbox, as the script would send it; then the app's sync, and wait until it's dealt with or waiting on Today
  const deliver = async (id, mail) => { await p.evaluate(([id, m]) => { DEMO.mail.inbox.push({ id, at: Date.now(), done: [], mail: m }); DEMO.h.inbox(); }, [id, mail]);
    await p.waitForFunction(id => !MAILS.busy && (!DEMO.mail.inbox.some(d => d.id === id) || MAILS.list.some(g => g.items.some(it => it.d.id === id))), id, { timeout: 15000 }).catch(() => { });
    await p.waitForTimeout(300); };
  // (a row by what it's about: the case menus of other rows list "… · Zoom call scheduled" and every patient's name)
  const row = sel => '#mailCard .mlRow:has(.mlWhat:has-text("' + sel + '"))';
  const joinHref = async sel => { const a = p.locator(sel).first(); return (await a.count()) && await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel') || '') ? await a.getAttribute('href') : ''; };

  // ---- 1. the demo's invite with no patient
  console.log('\n# An invite that names no patient: Today asks which MARPE case (the demo’s own)');
  await p.click('#nav-today'); await p.waitForSelector(row('Zoom call'), { timeout: 15000 });
  const z0 = await p.evaluate(() => { const g = MAILS.list.find(x => x.ev.kind === 'zoom'); return g && { date: g.ev.zoomDate, time: g.ev.zoomTime, url: g.ev.zoomUrl, title: g.ev.title, cands: g.cands.map(c => c.id) }; });
  const r0 = (await p.textContent(row('Zoom call'))).replace(/\s+/g, ' ');
  const dayTxt = await p.evaluate(iso => fmtDay(iso), z0.date);
  check(z0.time === '10:30' && z0.url === 'https://zoom.us/test' && z0.title === 'CBCT Consult with Dr. Akhavan', 'read: the call’s day (' + z0.date + '), 10:30, the Zoom link and the event’s name');
  check(r0.includes('Partners Dental Solutions') && r0.includes('Zoom call') && r0.includes('The invite doesn’t name the patient') && r0.includes(dayTxt + ', 10:30 AM') && r0.includes('CBCT Consult with Dr. Akhavan'),
    'the row: Partners, Zoom call, “The invite doesn’t name the patient”, the day and time, the event’s name');
  check(r0.includes('The one MARPE case waiting for a Zoom date — check it’s this one') && z0.cands.join() === 'demo26' && await p.inputValue(row('Zoom call') + ' .mlSel') === 'demo26',
    'it suggests the one MARPE case waiting for a Zoom date (Riley Testcase, at Records), picked already');
  const groups = await p.locator(row('Zoom call') + ' .mlSel').evaluate(s => Array.from(s.querySelectorAll('optgroup')).map(g => g.label + ':' + g.children.length));
  check(groups.join() === 'MARPE cases:2', 'the menu offers only the MARPE cases whose call is still ahead (not the one past Design approved, nor other kinds of case) (' + groups.join(', ') + ')');
  await p.locator('#mailCard').scrollIntoViewIfNeeded(); await p.locator('#mailCard').screenshot({ path: OUT + '/z66-today-noname.png' });
  await p.click(row('Zoom call') + ' [data-act=mailApply]');
  await p.waitForSelector('.toast:has-text("Applied to Riley Testcase")', { timeout: 8000 }).catch(() => { });
  await p.waitForFunction(() => !MAILS.list.some(g => g.ev.kind === 'zoom'), null, { timeout: 8000 }).catch(() => { });
  let c = await caseOf('demo26');
  check(c.zoomDate === z0.date && c.zoomTime === '10:30' && c.zoomUrl === 'https://zoom.us/test' && c.stage === 'records' && c.zoomAt > 0,
    'Apply: Riley’s case has the call (day, 10:30, the link); it stays at Records, its CBCT isn’t on file (' + c.stage + ')');
  check(!(await p.locator(row('Zoom call')).count()), 'the row is gone');
  await open('demo26');
  check(await joinHref('#dZoom a[data-act=zoomJoin]') === 'https://zoom.us/test' && /Partners Dental Solutions email\s*saved the Zoom call, Zoom link/.test(await p.textContent('#histBox')),
    'the case: Join Zoom in its header; the history says the Partners email saved the Zoom call and link');

  // ---- 2. an invite naming two patients
  console.log('\n# An invite naming two patients');
  const wid = await make({ patient: 'Wendell Zoomer', stage: 'submitted', records: ['stl', 'cbct'] });
  const tid = await make({ patient: 'Tobias Quarrington', stage: 'records', records: ['stl'] });
  await p.waitForTimeout(300);
  const d1 = dayOf(21), L1 = 'https://us06web.zoom.us/j/81234500066?pwd=AbCdEf66.1', sent1 = Date.now() - 20 * 60e3;
  const inv1 = invite({ day: d1, from: '11:30am', to: '12:30pm', link: L1, names: ['Wendell Zoomer', 'Tobyas Quarrington'], date: sent1 });
  await today(); await deliver('mz1', inv1);
  c = await caseOf(wid);
  check(c.stage === 'zoom' && c.zoomDate === d1.iso && c.zoomTime === '11:30' && c.zoomUrl === L1 && c.zoomAt === sent1,
    'Wendell Zoomer (MARPE at Submitted to lab, both records): applied by itself — Zoom call scheduled, ' + c.zoomDate + ' at ' + c.zoomTime + ', the Zoom link');
  await p.waitForSelector(row('Tobyas Quarrington'), { timeout: 8000 }).catch(() => { });
  const r1 = (await p.textContent(row('Tobyas Quarrington')).catch(() => '')).replace(/\s+/g, ' ');
  check(r1.includes('Zoom call') && r1.includes(await p.evaluate(iso => fmtDay(iso), d1.iso) + ', 11:30 AM') && r1.includes('Matched on the last name only — check it’s this case') && await p.inputValue(row('Tobyas Quarrington') + ' .mlSel') === tid,
    'the misspelled one (Tobyas): on Today, “Matched on the last name only”, Tobias Quarrington’s case picked already');
  check(!(await p.locator(row('Wendell Zoomer')).count()), 'nothing on Today for Wendell (done)');
  await p.locator('#mailCard').screenshot({ path: OUT + '/z66-today-lastname.png' });
  await p.click(row('Tobyas Quarrington') + ' [data-act=mailApply]');
  await p.waitForSelector('.toast:has-text("Applied to Tobias Quarrington")', { timeout: 8000 }).catch(() => { });
  await p.waitForFunction(id => !DEMO.mail.inbox.some(d => d.id === id), 'mz1', { timeout: 8000 }).catch(() => { });
  c = await caseOf(tid);
  check(c.zoomDate === d1.iso && c.zoomTime === '11:30' && c.zoomUrl === L1 && c.stage === 'records', 'Apply: Tobias’s case has the call; it stays at Records (its CBCT isn’t on file)');
  check(await p.evaluate(() => !DEMO.mail.inbox.some(d => d.id === 'mz1')), 'the email leaves the inbox once both are dealt with');
  await p.click('#nav-board'); await p.fill('#q', ''); await p.click('[data-act=flow][data-k=marpe]'); await p.waitForTimeout(200);
  check(await p.isVisible('section[aria-label="Zoom call scheduled"] .kc[data-id="' + wid + '"]') && await joinHref('.kc[data-id="' + wid + '"] a.flag.zm') === L1, 'the board: Wendell’s card under Zoom call scheduled, with Join Zoom');
  await p.locator('.kc[data-id="' + wid + '"]').screenshot({ path: OUT + '/z66-board-card.png' });
  await open(wid);
  check(/Partners Dental Solutions email\s*moved it to Zoom call scheduled and saved the Zoom call, Zoom link/.test(await p.textContent('#histBox')), 'the history: the Partners email moved it to Zoom call scheduled and saved the Zoom call and link');

  // ---- 3. the same invite again; a time changed by hand since stays
  console.log('\n# The same invite again, and a change by hand since');
  const rev0 = (await caseOf(wid)).rev;
  await today(); await deliver('mz1b', Object.assign({}, inv1, { box: 'records@example.com' }));
  check((await caseOf(wid)).rev === rev0 && !(await p.locator(row('Zoom call')).count()), 'the other mailbox’s copy: Wendell’s case unchanged, nothing on Today');
  await open(wid); await p.click('#dZoom [data-act=zoomSet]'); await p.waitForSelector('#zmTime'); await p.fill('#zmTime', '14:00'); await p.click('#zmSave'); await p.waitForTimeout(300);
  c = await caseOf(wid);
  check(c.zoomTime === '14:00' && c.zoomAt > sent1, 'the time changed by hand in the Zoom call window (2 PM)');
  await today(); await deliver('mz1c', Object.assign({}, inv1, { box: 'records@example.com' }));
  c = await caseOf(wid);
  check(c.zoomTime === '14:00' && c.zoomDate === d1.iso && c.zoomUrl === L1, 'a copy of the first invite that comes late doesn’t put 11:30 back');

  // ---- 4. rescheduled
  console.log('\n# A rescheduled call');
  const d2 = dayOf(28), L2 = 'https://us06web.zoom.us/j/81234500067?pwd=GhIjKl67.1';
  await deliver('mz2', invite({ pre: 'Updated invitation', day: d2, from: '1pm', to: '2pm', link: L2, names: ['Wendell Zoomer'], date: Date.now() }));
  c = await caseOf(wid);
  check(c.zoomDate === d2.iso && c.zoomTime === '13:00' && c.zoomUrl === L2 && c.stage === 'zoom', '“Updated invitation”: Wendell’s call moves to ' + c.zoomDate + ' at 1 PM, with the new link');

  // ---- 4b. a call set by hand, and an invite sent before that; initials (independent review, 30 Oct 2026)
  console.log('\n# A call set by hand, an invite sent before it; initials');
  const d3 = dayOf(30), d4 = dayOf(31), L4 = 'https://us06web.zoom.us/j/81234500069?pwd=Op69.1';
  const hid = await make({ patient: 'Hattie Handset', stage: 'zoom', records: ['stl', 'cbct'], zoomDate: d3.iso, zoomTime: '09:00', zoomAt: Date.now() });
  await p.waitForTimeout(300);
  await today(); await deliver('mz4', invite({ day: d4, from: '11:30am', to: '12:30pm', link: L4, names: ['Hattie Handset'], date: Date.now() - 3600e3 }));
  await p.waitForSelector(row('Hattie Handset'), { timeout: 8000 }).catch(() => { });
  const r4 = (await p.textContent(row('Hattie Handset')).catch(() => '')).replace(/\s+/g, ' ');
  c = await caseOf(hid);
  check(c.zoomDate === d3.iso && c.zoomTime === '09:00' && !c.zoomUrl && r4.includes('Its Zoom call was set by hand to ' + await p.evaluate(iso => fmtDay(iso), d3.iso) + ', 9:00 AM — check before applying this invite'),
    'an invite sent before the call was set by hand (another day): nothing changes by itself; Today says the case’s call was set by hand, and to what');
  await p.locator(row('Hattie Handset')).screenshot({ path: OUT + '/z66-today-sethand.png' });
  await p.click(row('Hattie Handset') + ' [data-act=mailApply]'); await p.waitForTimeout(600);
  c = await caseOf(hid);
  check(c.zoomDate === d4.iso && c.zoomTime === '11:30' && c.zoomUrl === L4 && !(await p.locator(row('Hattie Handset')).count()), 'Apply there: the invite’s call goes on (day, 11:30, link), the row goes');
  await deliver('mz5', invite({ day: dayOf(32), from: '9am', to: '10am', link: 'https://us06web.zoom.us/j/81234500070?pwd=Qr70.1', names: ['W. Zoomer'], date: Date.now() }));
  await p.waitForSelector(row('W. Zoomer'), { timeout: 8000 }).catch(() => { });
  check(/Matched on the initials only — check it’s this case/.test(await p.textContent(row('W. Zoomer')).catch(() => '')) && (await caseOf(wid)).zoomDate === d2.iso,
    'a name with an initial (“W. Zoomer”): suggested on Today, Wendell’s call unchanged');
  await p.click(row('W. Zoomer') + ' [data-act=mailSkip]'); await p.waitForTimeout(500);

  // ---- 5. phone width
  console.log('\n# Phone width');
  await deliver('mz3', invite({ day: dayOf(35), from: '9am', to: '10am', link: 'https://us06web.zoom.us/j/81234500068?pwd=Mn68.1', title: 'CBCT Consult with Dr. Akhavan', date: Date.now() }));
  // (a phone's menu is folded away: Today the way its button opens it)
  await p.setViewportSize({ width: 390, height: 844 }); await closeAll(); await p.evaluate(() => { S.view = 'today'; renderNav(); renderView(); window.scrollTo(0, 0); });
  await p.waitForSelector(row('Zoom call'), { timeout: 8000 }).catch(() => { });
  const fit = await p.locator(row('Zoom call')).first().evaluate(r => r.getBoundingClientRect().right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1).catch(() => false);
  check(fit && /Pick the MARPE case it’s for/.test(await p.textContent(row('Zoom call'))), 'an invite with no name and no MARPE case waiting: “Pick the MARPE case it’s for”; the row fits a phone');
  // a case that changed since it was picked (here: an appliance case): Apply says so and the row stays
  const gz = await p.evaluate(() => (MAILS.list.find(g => g.ev.kind === 'zoom') || {}).id), aid = await p.evaluate(() => (openCases().find(c => c.type === 'appliance') || {}).id);
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await p.evaluate(([g, a]) => { MAILS.pick[g] = a; return mailResolve(g, 'apply'); }, [gz, aid]);
  check(await p.isVisible('.toast:has-text("A Zoom call goes on the patient’s MARPE case before its design is approved")') && await p.evaluate(g => MAILS.list.some(x => x.id === g), gz) && !(await caseOf(aid)).zoomDate,
    'Apply with a case that can’t take the call (not a MARPE case): it says so, nothing changes, the update stays');
  await p.evaluate(g => { delete MAILS.pick[g]; renderView(); }, gz);
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); // (the toasts from before, over the row)
  await p.locator(row('Zoom call')).scrollIntoViewIfNeeded(); await p.locator(row('Zoom call')).screenshot({ path: OUT + '/z66-phone-row.png' });

  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
