// Team & security: every card is a toggle (Amir, 10 Oct 2026: "the setting for some of these apps are overwhelming. each section
// should be a toggle. Lets do that for the nlo case tracker"). All the cards start folded (a heading and the grey line beside it,
// nothing else); a tap on the heading opens one; Expand all / Collapse all; what's open is remembered on this computer
// (nloCases.adminOpen); the case panel's "Team & security → Chart note" link and the tour open the card they point at; the
// one-time rules card isn't a toggle. Demo, made-up patients. (The older tests start with Expand all remembered: helpers.adminOpen.)
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const KEY = 'nloCases.adminOpen', CARD = '#view .adminGrid > div > .card', BASE = 'http://127.0.0.1:8765/nlo-cases.html';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(BASE + '?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const ls = () => p.evaluate(k => localStorage.getItem(k), KEY);
  const openSet = () => p.$$eval(CARD + '.fold', cs => cs.filter(c => c.classList.contains('open')).map(c => c.dataset.fold));
  const all = () => p.$$eval(CARD, cs => cs.length);
  const label = async () => (await p.textContent('.fdAll')).replace(/\s+/g, ' ').trim();
  const hd = k => CARD + '.fold[data-fold="' + k + '"] > .cardHd', btn = k => CARD + '.fold[data-fold="' + k + '"] .fdBtn';
  const goAdmin = async () => { await p.click('#nav-admin'); await p.waitForSelector(CARD + '.fold'); };
  const fits = () => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, off: Array.from(document.querySelectorAll('#view .adminGrid .card')).filter(c => c.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || c.getBoundingClientRect().left < -1).length }));

  console.log('\n# Folded until tapped');
  await goAdmin();
  const n = await all();
  check(n === 14 && (await p.$$(CARD + '.fold')).length === 14 && (await openSet()).length === 0, 'all ' + n + ' cards are toggles, and they all start folded');
  const heads = await p.$$eval(CARD + '.fold', cs => cs.map(c => ({ k: c.dataset.fold, h: c.querySelector(':scope > .cardHd h3').textContent.trim(), ex: c.querySelector('.fdBtn').getAttribute('aria-expanded'),
    body: Array.from(c.children).filter(x => !x.classList.contains('cardHd')).every(x => x.getBoundingClientRect().height === 0), tall: Math.round(c.querySelector(':scope > .cardHd').getBoundingClientRect().height) })));
  check(heads.every(x => x.k === x.h && x.ex === 'false' && x.body), 'each one shows its heading only: the body is hidden, aria-expanded is false (' + heads.map(x => x.k).join(', ') + ')');
  check(heads.every(x => x.tall >= 52 && x.tall <= 70), 'a heading is a comfortable touch target (' + Math.min(...heads.map(x => x.tall)) + '–' + Math.max(...heads.map(x => x.tall)) + ' px tall)');
  check(await p.isVisible(hd('Team') + ' .sub') && /signs in with their own login/.test(await p.textContent(hd('Team') + ' .sub')), 'the grey line beside the heading stays, so you know what’s inside (“Everyone signs in with their own login”)');
  const hidden = await Promise.all(['#alPer', '#idleSel', '#shipSoonSel', '[data-act=addStaff]', '[data-act=loadActivity]', '[data-act=loadDeleted]', '#backupCard [data-act=backupNow]', '#mailAdmin .cardBd'].map(s => p.isVisible(s)));
  check(hidden.every(v => !v), 'nothing inside is on the page: no aligner cost, lock timer, Add person, Load, Backups button…');
  check(await label() === 'Expand all' && /Tap a heading to open it/.test(await p.textContent('.fdBar')) && (await ls()) === null, 'Expand all at the top, a line saying how it works, nothing remembered yet');
  await p.screenshot({ path: OUT + '/v59-folded.png' });

  console.log('\n# Tap a heading: it opens; tap again: it folds');
  await p.click(btn('In-house aligner cost'));
  check(JSON.stringify(await openSet()) === '["In-house aligner cost"]' && await p.isVisible('#alPer') && (await p.getAttribute(btn('In-house aligner cost'), 'aria-expanded')) === 'true', 'the title opens its card (and only that one)');
  check((await ls()) === '["In-house aligner cost"]' && await label() === 'Expand all', 'remembered on this computer; the button still says Expand all');
  await p.click(hd('Security') + ' .fdCh');
  check((await openSet()).join() === 'In-house aligner cost,Security' && await p.isVisible('#idleSel') && !(await p.isVisible('#backupCard [data-act=backupNow]')), 'the arrow opens one too (Security); the others stay folded');
  await p.click(hd('Security'), { position: { x: 420, y: 22 } });
  check(!(await p.isVisible('#idleSel')) && (await openSet()).join() === 'In-house aligner cost', 'the empty part of the heading row folds it again');
  await p.click(hd('In-house aligner cost') + ' .sub');
  check((await openSet()).length === 0 && !(await p.isVisible('#alPer')) && (await ls()) === null, 'so does the grey line; with nothing open, nothing is remembered');

  console.log('\n# The keyboard');
  await p.focus(btn('Backups')); await p.keyboard.press('Enter');
  check(await p.isVisible('#backupCard [data-act=backupNow]') && await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('fdBtn')), 'Enter on a heading opens it, and the keyboard stays on the heading');
  await p.keyboard.press('Space');
  check(!(await p.isVisible('#backupCard [data-act=backupNow]')) && (await p.getAttribute(btn('Backups'), 'aria-expanded')) === 'false', 'Space folds it again');
  await p.keyboard.press('Tab');
  check(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('fdBtn') && document.activeElement.textContent !== 'Backups'), 'Tab goes on to the next heading (a folded card has nothing else to stop on)');

  console.log('\n# Expand all / Collapse all');
  await p.click('.fdAll');
  check((await openSet()).length === n && await label() === 'Collapse all' && (await ls()) === 'all', 'Expand all opens all ' + n + ' and the button turns into Collapse all');
  check(await p.isVisible('#alPer') && await p.isVisible('#idleSel') && await p.isVisible('[data-act=addStaff]') && await p.isVisible('[data-act=loadActivity]') && await p.isVisible('#mailAdmin .cardBd'), 'everything is there, Add person and Load included');
  await p.screenshot({ path: OUT + '/v59-open.png', fullPage: true });
  await p.click('.fdAll');
  check((await openSet()).length === 0 && await label() === 'Expand all' && (await ls()) === null, 'Collapse all folds them all, and forgets');
  await p.click('.fdAll'); await p.click(btn('Lab PC'));
  const rest = await openSet(), kept = await ls();
  check(rest.length === n - 1 && !rest.includes('Lab PC') && await label() === 'Expand all', 'after Expand all, folding one leaves the other ' + (n - 1) + ' open');
  check(Array.isArray(JSON.parse(kept)) && JSON.parse(kept).length === n - 1 && !JSON.parse(kept).includes('Lab PC'), 'and that’s what’s remembered: the ' + (n - 1) + ' open ones');
  await p.click('.fdAll'); await p.click('.fdAll');

  console.log('\n# Remembered on this computer; a redraw keeps it');
  await p.click(btn('Team')); await p.click(btn('Backups'));
  check((await openSet()).join() === 'Team,Backups' && (await ls()) === '["Team","Backups"]', 'Team and Backups open');
  await p.click('[data-act=addStaff]'); await p.waitForSelector('#asName');
  check(await p.isVisible('#asName'), 'Add person works from the open Team card (the button in the heading doesn’t fold it)');
  await p.click('#asForm [data-act=closeModal]'); await p.waitForSelector('#asName', { state: 'detached' });
  check((await openSet()).join() === 'Team,Backups', 'closing it leaves the cards as they were');
  await p.evaluate(() => { queueRender('team'); }); await p.waitForTimeout(200);
  check((await openSet()).join() === 'Team,Backups' && (await p.$$('.fdBar')).length === 1 && (await p.$$('.fdAll')).length === 1, 'a redraw of the page (a live update) keeps them open, and doesn’t double the Expand all bar');
  await p.click('#nav-today'); await p.waitForSelector('.tiles'); await goAdmin();
  check((await openSet()).join() === 'Team,Backups', 'leaving the page and coming back: the same two');
  await p.reload(); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await goAdmin();
  check((await openSet()).join() === 'Team,Backups' && await label() === 'Expand all', 'a new visit on this computer (reload): the same two');
  await p.click('.fdAll'); await p.reload(); await p.click('#lgBtn'); await p.waitForSelector('.tiles'); await goAdmin();
  check((await openSet()).length === n && await label() === 'Collapse all', 'Expand all is remembered too');
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx2);
  const q = await ctx2.newPage(); watch(q, errs, 'other computer');
  await q.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await q.click('#lgBtn'); await q.waitForSelector('.tiles'); await q.click('#nav-admin'); await q.waitForSelector(CARD + '.fold');
  check((await q.$$eval(CARD + '.fold.open', c => c.length)) === 0, 'another computer starts folded: it’s a setting of this computer, not of the office');
  await ctx2.close();
  await p.click('.fdAll');

  console.log('\n# A Load button works, and the card stays open');
  await p.click(btn('Recent activity'));
  await p.click('[data-act=loadActivity]'); await p.waitForFunction(() => !/Click Load/.test((document.getElementById('actBox') || {}).textContent || 'Click Load'), null, { timeout: 5000 }).catch(() => {});
  check((await openSet()).join() === 'Recent activity' && !/Click Load/.test(await p.textContent('#actBox')), 'Load fills the card; the card stays open (' + (await p.textContent('#actBox')).replace(/\s+/g, ' ').trim().slice(0, 50) + '…)');
  await p.click(btn('Recent activity'));

  console.log('\n# The Chart note link in a case opens that card');
  const ref = await p.evaluate(() => openCases().find(c => c.type === 'nla' && c.initial === 'no').id);
  await p.evaluate(id => openDrawer(id), ref); await p.waitForSelector('#drawer .ds[data-ds=note]');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=note]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=note] .dsTg');
  await p.click('#drawer .noteFrom [data-act=niGo]'); await p.waitForSelector('#niCard');
  check(await p.evaluate(() => !document.querySelector('#drawer') && S.view === 'admin'), 'Team & security opens');
  check((await openSet()).join() === 'Chart note' && await p.isVisible('#niRow-alR') && await p.evaluate(() => document.querySelector('#niRow-alR').open && document.activeElement.id === 'ni-alR-scan'), 'with Chart note open (the others folded) at Refinement, its scan box ready to type in');
  await p.screenshot({ path: OUT + '/v59-chartnote.png' });
  await p.click(btn('Chart note'));

  console.log('\n# The tour opens what it points at, without remembering it');
  await p.evaluate(() => { fdReveal('Email updates', true); fdReveal('In-house aligner cost', true); });
  check((await openSet()).join() === 'In-house aligner cost,Email updates' && await p.isVisible('#mailAdmin .cardBd') && (await ls()) === null, 'Email updates and the aligner cost are open for the tour; nothing is saved');
  await p.evaluate(() => { queueRender('team'); }); await p.waitForTimeout(200);
  check((await openSet()).join() === 'In-house aligner cost,Email updates', 'a redraw keeps them open meanwhile');
  await p.click('.fdAll'); await p.click('.fdAll');
  check((await openSet()).length === 0, 'Collapse all folds those too');
  const o = await ctx.newPage(); watch(o, errs, 'owner tour');
  await o.goto(BASE + '?demo&tour=owner');
  await o.waitForFunction(() => TOUR.on && TOUR.steps[TOUR.i].id === 'hi', null, { timeout: 10000 });
  await o.evaluate(() => tourGo(TOUR.steps.findIndex(s => s.id === 'admin')));
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'admin');
  await o.click('#nav-admin');
  await o.waitForFunction(() => TOUR.steps[TOUR.i].id === 'team' && !TOUR.okAt, null, { timeout: 8000 });
  check(JSON.stringify(await o.$$eval(CARD + '.fold.open', c => c.map(x => x.dataset.fold))) === '["Team"]', 'Dr. A’s practice tour reaches Team & security: only the Team card is open');
  const want = { team: 'Team', cost: 'In-house aligner cost', mail: 'Email updates' };
  for (const id of ['team', 'cost', 'mail']) {
    await o.waitForFunction(id => TOUR.steps[TOUR.i].id === id && !TOUR.okAt, id, { timeout: 8000 });
    // (the page scrolls smoothly down to it first)
    const r = await o.waitForFunction(() => { const st = TOUR.steps[TOUR.i], el = st.at && st.at(), ring = document.getElementById('tourRing'); if (!el || ring.hidden) return false;
      const a = el.getBoundingClientRect(), b = ring.getBoundingClientRect(); return a.height > 100 && Math.abs(b.top - (a.top - 6)) < 2 && Math.abs(b.left - (a.left - 6)) < 2; }, null, { timeout: 4000 }).then(() => true, () => false);
    const isOpen = await o.evaluate(k => { const c = document.querySelector('#view .adminGrid .card.fold[data-fold="' + k + '"]'); return !!c && c.classList.contains('open'); }, want[id]);
    check(r && isOpen, 'tour step “' + id + '”: the ' + want[id] + ' card is open, with the ring around the whole card');
    if (id === 'cost') await o.screenshot({ path: OUT + '/v59-tour-cost.png' });
    await o.click('#tourCard [data-tour=next]');
  }
  // (the made-up office keeps its settings under nloDemo.*, and “forgotten” is a marker there; reading a key as a property gives what's really stored)
  const rawKeep = await o.evaluate(() => ({ real: localStorage['nloCases.adminOpen'] || null, demo: localStorage['nloDemo.nloCases.adminOpen'] || null }));
  check(rawKeep.real === null && (rawKeep.demo === null || rawKeep.demo === '\u0000gone'), 'and the tour remembers nothing: no list of open cards is stored (' + JSON.stringify(rawKeep) + ')');
  await o.close();

  console.log('\n# The one-time security rules card stays as it is');
  await p.evaluate(() => { S.rulesOld = false; S.rulesIdx = true; queueRender('team'); }); await p.waitForSelector('#rulesCard');
  check(await p.isVisible('#rulesCard .cardBd') && !(await p.$('#rulesCard.fold')) && (await all()) === 14 && (await p.$$(CARD + '.fold')).length === 14, 'it isn’t a toggle (it’s a to-do): its steps are showing above the folded cards');
  await p.evaluate(() => { S.rulesIdx = false; S.rulesOld = true; queueRender('team'); }); await p.waitForSelector('#rulesCard');
  const n2 = await all();
  check(n2 === 12 && (await p.$$(CARD + '.fold')).length === 12 && !(await p.$('#mailAdmin')), 'while the rules are old, Email updates and Lab PC aren’t offered: ' + n2 + ' toggles');
  await p.click('.fdAll');
  check((await openSet()).length === n2 && await label() === 'Collapse all', 'Expand all counts the ones that are there');
  await p.click('.fdAll');
  await p.evaluate(() => { S.rulesOld = false; queueRender('team'); }); await p.waitForFunction(() => !document.getElementById('rulesCard'));

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
  let f = await fits();
  check(f.sw <= f.cw && f.off === 0, 'folded: no sideways scrolling, every card fits (' + f.sw + '/' + f.cw + ')');
  const ph = await p.evaluate(() => { const b = document.querySelector('.fdAll'), r = b.getBoundingClientRect(), t = b.querySelector('.t'), hs = Array.from(document.querySelectorAll('#view .adminGrid > div > .card.fold > .cardHd')).map(h => h.getBoundingClientRect().height);
    return { vis: r.width > 0, w: Math.round(r.width), h: Math.round(r.height), txt: t && getComputedStyle(t).display, aria: b.getAttribute('aria-label'), minHd: Math.round(Math.min(...hs)), hdTop: Math.round(document.querySelector('.fdBar').getBoundingClientRect().top) }; });
  check(ph.vis && ph.h >= 44 && ph.w >= 44 && ph.txt === 'none' && /Expand all sections/.test(ph.aria), 'the Expand all button is just its icon (' + ph.w + '×' + ph.h + ' px), named for screen readers (“' + ph.aria + '”)');
  check(ph.minHd >= 52, 'headings are at least ' + ph.minHd + ' px tall');
  await p.screenshot({ path: OUT + '/v59-phone.png', fullPage: true });
  await p.click(btn('Security')); await p.click(btn('Backups')); await p.click(btn('In-house aligner cost')); await p.click(btn('Who gets new cases'));
  f = await fits();
  check(f.sw <= f.cw && f.off === 0 && await p.isVisible('#idleSel') && await p.isVisible('#alPer'), 'four open: still no sideways scrolling (' + f.sw + '/' + f.cw + ')');
  await p.screenshot({ path: OUT + '/v59-phone-open.png', fullPage: true });
  await p.click('.fdAll'); await p.click('.fdAll');
  f = await fits();
  check((await openSet()).length === 0 && f.sw <= f.cw, 'folded again');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
