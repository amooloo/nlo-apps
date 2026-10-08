// Stickers (Amir, 7 Oct 2026: "it would be cool to be able to add stickers in the form of emoji's to each other in different
// sections" — on notes, on "steps that someone does. like moving something from Polishing to packaging etc.", on any section,
// and in the other person's Messages). Demo, made-up patients.
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
  const cnt = () => p.evaluate(() => { const e = document.querySelector('#nav-msgs .cnt'); return e && !e.classList.contains('hidden') ? +e.textContent : 0; });

  console.log('\n# Messages: stickers sent to you, with the notes that tag you');
  check(await cnt() === 4, 'Messages: 4 new — two notes that tag you, two stickers (' + await cnt() + ')');
  await p.click('#nav-msgs'); await p.waitForSelector('.msgRow');
  const rows = await p.$$eval('.msgRow', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  const stkRows = rows.filter(t => /sent you a sticker/.test(t));
  check(stkRows.length === 2 && stkRows.some(t => /Gwen sent you a sticker/.test(t) && /On your move to /.test(t)) && stkRows.some(t => /Sarah sent you a sticker/.test(t) && /In Details/.test(t)),
    'two sticker rows: Gwen’s on your move, Sarah’s in Details (' + JSON.stringify(stkRows) + ')');
  check(await p.textContent('.msgCard .cardHd h3') === 'Notes and stickers for you', 'the card says “Notes and stickers for you”');
  await p.screenshot({ path: OUT + '/v55-messages.png' });

  console.log('\n# Opening one: the case, at the step, flashed');
  await p.click('.msgRow.stkMsg:has-text("Gwen")');
  await p.waitForSelector('#drawer .stepStk .stk', { timeout: 5000 }).catch(() => {});
  const mv = await p.evaluate(() => { const c = findCase(S.openId), s = stkList(c).find(x => x.id === 'ds2'); return { k: s && s.k, stage: c.stage }; });
  check(mv.k === mv.stage && await p.isVisible('#drawer .stepStk[data-k="' + mv.k + '"] .stk:has-text("Gwen")'), 'the stage opens, and Gwen’s 🎉 sits under the step it was for');
  check(await cnt() === 3, 'opening it marks it read (3 left)');
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/v55-step.png', clip: { x: 800, y: 0, width: 560, height: 700 } });

  console.log('\n# Sending one on a step: the smiley beside it, a sticker picked');
  const kHover = await p.evaluate(() => { const c = findCase(S.openId), m = stageMarks(c); return Object.keys(m).find(k => k !== c.stage && m[k].by && staff(m[k].by)) || c.stage; });
  await p.hover('#drawer .step[data-k="' + kHover + '"]'); await p.waitForTimeout(300); // (it fades in)
  const op = await p.evaluate(k => getComputedStyle(document.querySelector('#drawer .stkSlot[data-k="' + k + '"] .stkAdd')).opacity, kHover);
  check(op === '1', 'pointing at a step shows its smiley (opacity ' + op + ')');
  await p.click('#drawer .stkSlot[data-k="' + kHover + '"] .stkAdd'); await p.waitForSelector('#stkPick');
  check((await p.$$('#stkPick .stkOpt')).length === 8 && /gets it in Messages|stays here/.test(await p.textContent('#stkPick .stkTo')), 'the stickers: eight to pick, and who gets it (' + (await p.textContent('#stkPick .stkTo')) + ')');
  check(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('stkOpt')), 'the first sticker has the focus (arrows move, Enter picks)');
  await p.screenshot({ path: OUT + '/v55-picker.png', clip: { x: 800, y: 0, width: 560, height: 700 } });
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); // 🎉
  await p.waitForSelector('#drawer .stepStk[data-k="' + kHover + '"] .stk.mine', { timeout: 3000 }).catch(() => {});
  check(await p.isVisible('#drawer .stepStk[data-k="' + kHover + '"] .stk.mine:has-text("You")') && !(await p.$('#stkPick')), 'picked: 🎉 “You” under that step, the stickers closed');
  check(await p.evaluate(() => !!document.querySelector('#drawer .stk.pop')), 'it pops on');
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/v55-step-sent.png', clip: { x: 800, y: 0, width: 560, height: 700 } });
  await p.click('#drawer .stepStk[data-k="' + kHover + '"] .stk.mine');
  await p.waitForFunction(k => !document.querySelector('#drawer .stepStk[data-k="' + k + '"] .stk.mine'), kHover, { timeout: 3000 }).catch(() => {});
  check(!(await p.$('#drawer .stepStk[data-k="' + kHover + '"] .stk.mine')), 'a tap on yours takes it back');

  console.log('\n# On a note');
  await p.evaluate(() => closeDrawer());
  const nid = await p.evaluate(() => openCases().find(c => (c.comments || []).some(x => x.id === 'dn0')).id);
  await p.evaluate(id => openDrawer(id), nid); await p.waitForSelector('#drawer [data-note="dn0"]');
  check(await p.isVisible('#drawer [data-note="dn0"] .stkRow .stk:has-text("Sarah")'), 'Sarah’s 👍 under Gwen’s note');
  await p.hover('#drawer [data-note="dn0"]'); await p.click('#drawer [data-note="dn0"] .stkAdd'); await p.waitForSelector('#stkPick');
  check(/Gwen\s*gets it in Messages/.test(await p.textContent('#stkPick .stkTo')), 'on Gwen’s note: “Gwen gets it in Messages”');
  await p.click('#stkPick .stkOpt[data-e="❤️"]');
  await p.waitForSelector('#drawer [data-note="dn0"] .stk.mine', { timeout: 3000 }).catch(() => {});
  const nsk = await p.evaluate(() => { const c = findCase(S.openId); return stkList(c).filter(s => s.on === 'n:dn0').map(s => s.e + (s.by === meSid() ? '(me→' + s.to + ')' : '')).join(' '); });
  check(/❤️\(me→gwen\)/.test(nsk), 'my ❤️ goes to Gwen (' + nsk + ')');
  await p.click('#drawer [data-note="dn0"] .stk:has-text("Sarah")'); // the same as Sarah's: one from me too
  await p.waitForFunction(() => document.querySelectorAll('#drawer [data-note="dn0"] .stk.mine').length === 2, null, { timeout: 3000 }).catch(() => {});
  check(await p.textContent('#drawer [data-note="dn0"] .stk:has-text("👍")') === '👍You, Sarah', 'a tap on Sarah’s 👍: “👍 You, Sarah”');
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/v55-note.png', clip: { x: 800, y: 0, width: 560, height: 950 } });

  console.log('\n# On a section, for someone you pick');
  await p.hover('#drawer .ds[data-ds=details] .dsHd'); await p.click('#drawer .ds[data-ds=details] .dsHd .stkAdd'); await p.waitForSelector('#stkPick #stkToSel');
  const def = await p.$eval('#stkToSel', s => s.value);
  check(!!def, 'a section: “For” someone to start with (' + def + ')');
  await p.selectOption('#stkToSel', 'kaylee'); await p.click('#stkPick .stkOpt[data-e="💪"]');
  await p.waitForSelector('#drawer .ds[data-ds=details] .dsHd .stk.mine', { timeout: 3000 }).catch(() => {});
  check(await p.evaluate(() => stkList(findCase(S.openId)).some(s => s.on === 's:details' && s.e === '💪' && s.to === 'kaylee' && s.l === 'Details')), 'the 💪 on Details goes to Kaylee');
  await p.screenshot({ path: OUT + '/v55-section.png', clip: { x: 800, y: 0, width: 560, height: 950 } });

  console.log('\n# History: a step someone did');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=history]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=history] .dsTg');
  await p.waitForSelector('#histBox .hist', { timeout: 4000 });
  const hRow = await p.evaluate(() => { const r = Array.from(document.querySelectorAll('#histBox .hist')).find(x => x.querySelector('.stkAdd')); return r ? r.dataset.w : ''; });
  check(!!hRow, 'a history row someone did has a smiley (' + hRow + ')');
  check(await p.evaluate(() => !Array.from(document.querySelectorAll('#histBox .hist')).some(r => /Lab PC|email/.test(r.querySelector('b').textContent) && r.querySelector('.stkAdd'))), 'the lab PC’s and lab emails’ rows don’t');
  if (hRow) {
    await p.hover('#histBox .hist[data-w="' + hRow + '"]'); await p.click('#histBox .hist[data-w="' + hRow + '"] .stkAdd'); await p.waitForSelector('#stkPick');
    await p.click('#stkPick .stkOpt[data-e="🙏"]');
    await p.waitForSelector('#histBox .hist[data-w="' + hRow + '"] .stk.mine', { timeout: 4000 }).catch(() => {});
    check(await p.isVisible('#histBox .hist[data-w="' + hRow + '"] .stk.mine'), 'its 🙏 sits on the row');
  }
  check(await p.evaluate(() => !Array.from(document.querySelectorAll('#histBox .hist')).some(r => /sticker/.test(r.textContent))), 'stickers aren’t rows of their own in History');
  await p.screenshot({ path: OUT + '/v55-history.png', clip: { x: 800, y: 300, width: 560, height: 650 } });

  console.log('\n# Escape closes the stickers, not the case');
  await p.hover('#drawer [data-note="dn0"]'); await p.click('#drawer [data-note="dn0"] .stkAdd'); await p.waitForSelector('#stkPick');
  await p.keyboard.press('Escape');
  check(!(await p.$('#stkPick')) && await p.isVisible('#drawer'), 'Escape: the stickers close, the case stays open');
  check(await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-note="dn0"] .stkAdd')), 'and the focus goes back to the smiley');

  console.log('\n# A sticker that arrives while the case is open pops on, and stays read');
  const before = await cnt();
  await p.evaluate(() => DEMO.mutateCase(S.openId, d => { d.stickers = (d.stickers || []).concat([{ id: 'live1', at: Date.now(), by: 'angelika', e: '😂', on: 'n:dn0', to: meSid() }]); }, { a: 'sticker', e: '😂', on: 'n:dn0' }));
  await p.waitForSelector('#drawer [data-note="dn0"] .stk.pop:has-text("Angelika")', { timeout: 3000 }).catch(() => {});
  check(await p.isVisible('#drawer [data-note="dn0"] .stk.pop:has-text("Angelika")'), 'Angelika’s 😂 pops on');
  check(await cnt() === before, 'and isn’t counted as new (you’re looking at it)');

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  await p.evaluate(() => renderDrawer());
  const ph = await p.evaluate(() => { const d = document.querySelector('#drawer .dBd'); return { over: d.scrollWidth - d.clientWidth }; });
  check(ph.over <= 0, 'phone: nothing runs off the side (' + ph.over + ')');
  await p.click('#drawer [data-note="dn0"] .stkAdd', { force: true }); await p.waitForSelector('#stkPick');
  const pk = await p.evaluate(() => { const r = document.querySelector('#stkPick').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  check(pk.l >= 8 && pk.r <= pk.w - 8, 'phone: the stickers fit the screen (' + JSON.stringify(pk) + ')');
  await p.screenshot({ path: OUT + '/v55-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
