// The 3D printer → NLO Cases (Amir, 8 Oct 2026: "why does it say this? 'Printing shows here once the Formlabs print feed is
// connected.'" — "isn't it connected already?"). Formlabs' Dashboard emails each print (Print Started / Finished / Aborted); the
// email script passes them on, sealed; the app reads them (prints.js). Demo, made-up patients; the parser on made-up names in the
// real emails' exact format.
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

  console.log('\n# Reading Formlabs’ emails (their exact format, made-up names)');
  const parsed = await p.evaluate(() => {
    const J = (n, ms) => ms.map(([k, a, t]) => n + ' - ' + k + ' - ' + (a === 'U' ? 'Maxilla' : 'Mandible') + (t ? ' (Template)' : '')).join(', ');
    const long = J('Jana Mossberg', [[0, 'L', 1], [0, 'U', 1], [1, 'L'], [1, 'U'], [2, 'L']]).slice(0, 128);
    const mk = (subject, text) => ({ from: 'Formlabs Dashboard <dashboard+no-reply@formlabs.com>', subject, text, html: '' });
    const out = {};
    out.start = prParse(mk('WiseTamarin | Print Started | ' + long, 'Print Started Hi Amir, Your print "' + long + '" on WiseTamarin has started printing in Fast Model Resin. It will be finished in 34 min. Visit dashboard.formlabs.com anytime'));
    out.startWhich = prWhich(out.start.groups[0].list, out.start.cut);
    // (Titan keeps a trailing space after a first or last name: "Kim Ngo  - 1 - Mandible")
    out.done = prParse(mk('WiseTamarin | Print Finished | Kim Ngo  - 1 - Mandible, Kim Ngo  - 2 - Mandible, Kim Ngo  - 3 - Mandible', '| # Print Finished |\n\n| Hi Amir, Print "Kim Ngo - 1 - Mandible, Kim N..." on WiseTamarin finished after 1 hr 5 min. |'));
    out.doneWhich = prWhich(out.done.groups[0].list, out.done.cut);
    out.fail = prParse(mk('WiseTamarin | Print Aborted | Ana Ruiz - 1 - Maxilla, Ana Ruiz - 1 - Mandible, Ana Ruiz - 2 - Maxilla', 'Print Aborted Hi Amir, Print "Ana Ruiz - 1 - Maxilla, Ana Ruiz - 1..." on WiseTamarin was aborted.'));
    out.scan = prParse(mk('WiseTamarin | Print Finished | 70000001_lprofile_occlusion_l, 70000001_lprofile_occlusion_u, Smith. K_lower, Smith. K_upper', 'finished after 19 min.'));
    out.two = prParse(mk('WiseTamarin | Print Started | Ann Leeway - 1 - Maxilla, Bo Parkhurst - 1 - Mandible', ''));
    out.hist = prParse(mk('Your Print History Export - 2026-10-07 02:12', 'Print History Export'));
    out.other = prParse(mk('WiseTamarin | Resin Low | Tank 2', ''));
    out.unknown = prParse(mk('Formlabs: what’s new in PreForm', 'news'));
    out.isFl = [prMail({ from: 'Formlabs Dashboard <dashboard+no-reply@formlabs.com>' }), prMail({ from: 'dashboard+no-reply@formlabs.com' }), prMail({ from: 'uLab <noreply@ulabsystems.com>' })];
    out.senders = MAIL_SENDERS.includes('dashboard+no-reply@formlabs.com') && !MAIL_SENDERS.includes('formlabs.com');
    return out;
  });
  check(parsed.start.pr === 'WiseTamarin' && parsed.start.st === 'run' && parsed.start.eta === 34 && parsed.start.cut && parsed.start.groups.length === 1 && parsed.start.groups[0].name === 'Jana Mossberg',
    'Print Started: the printer, “started”, about 34 min, one patient, the name cut at 128 characters');
  check(parsed.startWhich === 'U & L templates · L1…', 'its models — the last one cut off mid-name isn’t counted: “' + parsed.startWhich + '”');
  check(parsed.done.st === 'done' && parsed.done.min === 65 && !parsed.done.cut && parsed.doneWhich === 'L1–3' && parsed.done.groups.length === 1 && parsed.done.groups[0].name === 'Kim Ngo',
    'Print Finished (as plain text in a table, a name with Titan’s extra space): “finished after 1 hr 5 min” = 65, “' + parsed.doneWhich + '”');
  check(parsed.fail.st === 'fail' && parsed.fail.groups[0].list.length === 3, 'Print Aborted');
  check(parsed.scan.st === 'done' && parsed.scan.groups.length === 0, 'a scanner export’s print (“<number>_lprofile_occlusion_l”, “<name>_upper”) says whose it isn’t: no patient');
  check(parsed.two.groups.length === 2, 'two patients on one print: each gets it');
  check(parsed.hist && parsed.hist.skip && parsed.other && parsed.other.skip && parsed.unknown === null, 'the history download and a resin notice are nothing to do; an email in another format is kept for a newer app');
  check(parsed.isFl.join() === 'true,true,false' && parsed.senders, 'the email script’s sender list has Formlabs’ Dashboard address (only that one: its support emails stay out)');

  console.log('\n# One print, its emails in either order; a reprint after an abort');
  const seqs = await p.evaluate(() => {
    const t = Date.now() - 3 * 3600e3, M = 60e3, ev = (st, at, x) => Object.assign({ j: 'J1', pr: 'P', st, at, m: 'U1–4' }, x || {});
    const run = list => list.reduce((L, e) => prNext(L, e), []);
    const inOrder = run([ev('run', t, { eta: 30 }), ev('done', t + 32 * M, { min: 33 })]);
    const reversed = run([ev('done', t + 32 * M, { min: 33 }), ev('run', t + M / 2, { eta: 30 })]);
    const reprint = run([ev('fail', t), ev('fail', t + 2 * M), ev('run', t + 5 * M), ev('done', t + 22 * M, { min: 17 })]);
    const going = run([ev('run', Date.now() - 10 * M, { eta: 34 })]);
    const stale = run([ev('run', Date.now() - 13 * 3600e3)]);
    return { inOrder: inOrder.map(x => x.st + ':' + (x.s === t) + ':' + x.min), reversed: reversed.map(x => x.st + ':' + (x.s === t + M / 2) + ':' + x.min),
      reprint: reprint.map(x => x.st), live: [prLive(going[0]), prLive(stale[0])],
      sugg: [prSuggest({ prints: going }), prSuggest({ prints: inOrder }), prSuggest({ prints: run([ev('done', Date.now() - 30 * M, { min: 10 }), ev('fail', Date.now() - 2 * M)]) })].map(s => s ? s.to : '') };
  });
  check(seqs.inOrder.join() === 'done:true:33', 'started then finished: one print, its start and 33 min (' + seqs.inOrder + ')');
  check(seqs.reversed.join() === 'done:true:33', 'the finish read before the start: still one print, the start filled in (' + seqs.reversed + ')');
  check(seqs.reprint.join() === 'fail,fail,done', 'aborted twice, then printed: three prints (' + seqs.reprint + ')');
  check(seqs.live.join() === 'true,false', 'printing now: started, no end yet — not after half a day with no word');
  check(seqs.sugg.join() === 'print,thermo,', 'it offers Printing while a print is going, Thermoforming once the latest finished, nothing once the latest was aborted (' + seqs.sugg + ')');

  console.log('\n# The board: each in-house set’s newest print, and the step it’s ready for');
  await p.waitForFunction(() => openCases().filter(c => c.type === 'nla' && prList(c).length).length >= 4, null, { timeout: 8000 }).catch(() => {});
  const ids = await p.evaluate(() => {
    const nla = openCases().filter(c => c.type === 'nla'), by = k => nla.filter(c => prList(c).length && c.stage === k);
    return { live: (by('txpok')[0] || {}).id, done: (nla.find(c => c.stage === 'txp' && prList(c).some(x => x.st === 'done')) || {}).id,
      fail: (nla.find(c => c.stage === 'txp' && prList(c).some(x => x.st === 'fail')) || {}).id, th: (by('thermo')[0] || {}).id };
  });
  check(ids.live && ids.done && ids.fail && ids.th, 'the demo’s Formlabs emails reached four in-house sets (' + JSON.stringify(ids) + ')');
  await p.waitForFunction(() => !DEMO.mail.inbox.some(d => d.mail && prMail(d.mail)), null, { timeout: 8000 }).catch(() => {});
  check(await p.evaluate(() => !DEMO.mail.inbox.some(d => d.mail && prMail(d.mail))), 'and every one of them left the inbox (a moment after: another open app sees the claim)');
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=inhouse]'); await p.waitForSelector('.kc');
  const card = id => '.kc[data-id="' + id + '"]';
  const cl = await p.evaluate(ids => { const t = id => { const e = document.querySelector('.kc[data-id="' + id + '"] .labLn'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }; return { live: t(ids.live), done: t(ids.done), fail: t(ids.fail), th: t(ids.th) }; }, ids);
  check(/^Printing U & L templates · L1\S*…\s*Printing$/.test(cl.live) && await p.isVisible(card(ids.live) + ' .prC.run .lic-print.live') && !(await p.isVisible(card(ids.live) + ' .kstep .lic')),
    'a print going: “' + cl.live + '” — its printer moving, one printer on the card, and → Printing');
  check(/^Printed U1–4\s*Thermoforming$/.test(cl.done) && !(await p.isVisible(card(ids.done) + ' .prC .lic.live')), 'finished: “' + cl.done + '” → Thermoforming');
  check(/^Print aborted · L1–3$/.test(cl.fail) && await p.isVisible(card(ids.fail) + ' .prC.fail') && !(await p.isVisible(card(ids.fail) + ' .labGo')), 'aborted: “' + cl.fail + '”, in coral, nothing offered');
  check(await p.isVisible(card(ids.th) + ' .labM .lic-trim') && !(await p.isVisible(card(ids.th) + ' .prC')), 'a set with stickers printed keeps its Trim bar (its prints are in the case)');
  const later = await p.evaluate(id => { const c = Object.assign({}, findCase(id), { labOrd: '' }), at = st => Object.assign({}, c, { stage: st });
    const going = Object.assign({}, at('pack'), { prints: prList(c).concat([{ j: 'x', pr: 'CalmOtter', st: 'run', s: Date.now() - 60e3, m: 'U5' }]) });
    return [prCardLine(at('thermo')) !== '', prCardLine(at('trim')) === '', prCardLine(at('pack')) === '', /Printing U5/.test(prCardLine(going))]; }, ids.done);
  check(later.join() === 'true,true,true,true', 'past Thermoforming the card leaves the printing to the case — but a print going now (a reprint) still shows (' + later + ')');
  await p.evaluate(id => document.querySelector('.kc[data-id="' + id + '"]').scrollIntoView({ block: 'center' }), ids.live);
  await p.waitForTimeout(300);
  const colClip = await p.evaluate(id => { const col = document.querySelector('.kc[data-id="' + id + '"]').closest('.kcol, .col, [class*=col]') || document.querySelector('.board'); const b = col.getBoundingClientRect(); return { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: Math.min(b.width + 8, 1360), height: Math.min(b.height + 8, 950 - Math.max(0, b.y - 4)) }; }, ids.live);
  await p.screenshot({ path: OUT + '/v57-board.png', clip: colClip });
  await p.screenshot({ path: OUT + '/v57-board-full.png' });

  console.log('\n# The case: its Lab section');
  const openLab = async id => { await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .ds[data-ds=lab]');
    if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=lab]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=lab] .dsTg');
    await p.waitForTimeout(250); };
  const labShot = async (f) => { const r = await p.evaluate(() => { const s = document.querySelector('#drawer .ds[data-ds=lab]'); s.scrollIntoView({ block: 'start' }); const b = s.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 950 - b.y) }; }); await p.screenshot({ path: OUT + '/' + f, clip: r }); };
  await p.evaluate(id => openDrawer(id), ids.live); await p.waitForSelector('#drawer .ds[data-ds=lab]');
  const fold = (await p.textContent('#drawer .ds[data-ds=lab] .dsS')).replace(/\s+/g, ' ').trim();
  check(/^Printing now on CalmOtter · done about \d{1,2}:\d{2}/.test(fold), 'folded: “' + fold + '”');
  await openLab(ids.live);
  const box = (await p.textContent('#drawer .labBox')).replace(/\s+/g, ' ');
  check(/Printing\s*printing now\s*Printing now U & L templates · L1\S*…\s*on CalmOtter · started \d{1,2}:\d{2} [AP]M · done about \d/.test(box) && /STLs exported, no stickers printed yet \(38 aligners\)/.test(box) && !/Formlabs print feed is connected/.test(box),
    'open: the Printing row (printing now, what, where, when), then the export — and no “once the feed is connected” (' + box.slice(0, 160) + ')');
  await labShot('v57-case-live.png');
  await openLab(ids.done);
  check(/Printed U1–4\s*on CalmOtter · \d{1,2}:\d{2} [AP]M · 41 min/.test(await p.textContent('#drawer .labBox')) && await p.isVisible('#drawer .labBox .labGo:has-text("Thermoforming")'), 'printed: when, how long, and → Thermoforming');
  await labShot('v57-case-done.png');
  await openLab(ids.fail);
  check(/Aborted\s*L1–3/.test(await p.textContent('#drawer .labBox')) && !(await p.isVisible('#drawer .labBox .labMeta')) && await p.isVisible('#drawer .labPr.prRow.bad'),
    'aborted, on a set with no Ortho Factory order yet: the section shows its printing alone');
  await labShot('v57-case-fail.png');
  await openLab(ids.th);
  const thBox = (await p.textContent('#drawer .labBox')).replace(/\s+/g, ' ');
  const iL = thBox.indexOf('Printed L1'), iU = thBox.indexOf('Printed U1'), iT = thBox.indexOf('Trimmed');
  check(/Printing\s*2 prints/.test(thBox) && iL > 0 && iU > iL && iT > iU && /Printed L1\S*\s*on CalmOtter · yesterday \d{1,2}:\d{2} [AP]M · 39 min/.test(thBox),
    'a set further on: its two prints (newest first: the lower), then the trimming (' + thBox.slice(0, 200) + ')');
  await labShot('v57-case-th.png');

  console.log('\n# One tap: → Thermoforming, and what History says');
  await openLab(ids.done);
  await p.click('#drawer .labBox .labGo');
  await p.waitForFunction(id => findCase(id).stage === 'thermo', ids.done, { timeout: 5000 }).catch(() => {});
  if (await p.isVisible('#modalWrap')) { console.log('      (a window asked: ' + (await p.textContent('#modalWrap h3').catch(() => '')) + ')'); }
  check(await p.evaluate(id => findCase(id).stage === 'thermo', ids.done), 'the set moves to Thermoforming');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=history]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=history] .dsTg');
  await p.waitForSelector('#histBox .hist:has-text("Formlabs")', { timeout: 5000 }).catch(() => {});
  const hist = (await p.textContent('#histBox').catch(() => '')).replace(/\s+/g, ' ');
  check(/moved it to Thermoforming, as Formlabs suggested/.test(hist) && /Formlabs finished printing U1–4 on CalmOtter after 41 min/.test(hist) && !/started printing/.test(hist),
    'History: “Formlabs finished printing U1–4 on CalmOtter after 41 min”, the move “as Formlabs suggested” — and not each print starting');
  check(!(await p.isVisible('#histBox .hist:has-text("Formlabs finished") .stkAdd')), 'no sticker smiley on a row Formlabs made');

  console.log('\n# Team & security: is it coming through?');
  await p.evaluate(() => closeDrawer()); await p.click('#nav-admin'); await p.waitForSelector('#mailAdmin .prFeed', { timeout: 8000 }).catch(() => {});
  const feed = (await p.textContent('#mailAdmin .prFeed').catch(() => '')).replace(/\s+/g, ' ').trim();
  check(/^Formlabs’ print emails come through: the latest print on an in-house set was \d{1,2}:\d{2} [AP]M on CalmOtter\.$/.test(feed), 'Email updates: “' + feed + '”');
  check(/Formlabs’ emails about each print/.test(await p.textContent('#mailAdmin')) && /3D printing comes from Formlabs’ emails/.test(await p.textContent('#labAdmin').catch(() => '')), 'the how-it-works words say where printing comes from');
  const fr = await p.evaluate(() => { const s = document.querySelector('#mailAdmin .prFeed'); s.scrollIntoView({ block: 'center' }); const b = s.closest('.card').getBoundingClientRect(); return { x: b.x, y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, 950 - Math.max(0, b.y)) }; });
  await p.screenshot({ path: OUT + '/v57-admin.png', clip: fr });

  console.log('\n# Phone width');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#nav-board').catch(() => {}); await p.waitForTimeout(300);
  await p.evaluate(id => openDrawer(id), ids.th); await p.waitForSelector('#drawer .ds[data-ds=lab]');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=lab]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=lab] .dsTg');
  await p.waitForTimeout(250);
  const ov = await p.evaluate(() => { const b = document.querySelector('#drawer .labBox'), r = b.getBoundingClientRect(); return { w: r.width, over: Array.from(b.querySelectorAll('*')).some(e => e.getBoundingClientRect().right > r.right + 1) }; });
  check(!ov.over, 'phone: the Printing row fits (' + Math.round(ov.w) + 'px)');
  await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=lab]').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: OUT + '/v57-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
