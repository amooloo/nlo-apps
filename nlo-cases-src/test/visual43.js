// Print labels in the case panel's header (Amir, 5 Oct 2026: "I could not find the print labels easily for cases. it should be
// clearly visible in the header for pts that (retainers and in house aligners)"). Demo, made-up patients; the panel opens folded.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const open = async id => { await p.evaluate(id => openDrawer(id), id); await p.waitForSelector('#drawer .dHd'); };
  const hdBtn = '#drawer .dHd #dLbl button';

  console.log('\n# In-house aligners');
  const nla = await p.evaluate(() => Array.from(S.cases.values()).find(c => c.type === 'nla' && alN(c)).id);
  await open(nla);
  check(await p.evaluate(() => !document.querySelector('#drawer .ds.open')), 'the panel opens folded');
  check(await p.isVisible(hdBtn + '[data-act=labels]') && !(await p.isDisabled(hdBtn + '[data-act=labels]')) && /Print labels/.test(await p.textContent(hdBtn)), 'Print labels is in the header, under the name, ready to tap');
  await p.screenshot({ path: 'shots/v43-nla.png' });
  await p.click(hdBtn + '[data-act=labels]'); await p.waitForSelector('#lb-list .lbRow');
  check(/Aligner labels/.test(await p.textContent('#modalWrap h3')) && (await p.locator('#lb-list .lbRow').count()) > 2, 'it opens the aligner labels, filled in from the case');
  await p.evaluate(() => closeModal());
  const none = await p.evaluate(() => { const c = Array.from(S.cases.values()).find(x => x.type === 'nla' && x.id !== S.openId); c.alU = c.alL = c.aligners = ''; return c.id; });
  await open(none);
  check(await p.isDisabled(hdBtn + '[data-act=labels]') && /once the aligner counts are in/.test(await p.textContent('#drawer #dLbl')), 'a set without its counts yet: the button is there, waiting for the counts (Edit)');

  console.log('\n# Retainers');
  const ret = await p.evaluate(() => openCases().find(c => c.type === 'retainer').id);
  await open(ret);
  check(await p.isVisible(hdBtn + '[data-act=retLabels]') && /then it offers the next step/.test(await p.textContent('#drawer #dLbl')), 'Print labels (the bag label) is in the header too');
  check(!(await p.$('#drawer .ds[data-ds=label]')), 'no second Print label further down');
  await p.screenshot({ path: 'shots/v43-retainer.png' });
  await p.click(hdBtn + '[data-act=retLabels]'); await p.waitForSelector('#modalWrap .modal:has-text("Retainer labels")');
  check(true, 'it opens the retainer labels');
  await p.evaluate(() => closeModal());

  console.log('\n# Other cases');
  const ol = await p.evaluate(() => openCases().find(c => c.type === 'oliv').id);
  await open(ol);
  check(!(await p.$('#drawer #dLbl')), 'an Oliv case has no Print labels');

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await open(ret);
  check(await p.evaluate(() => { const b = document.querySelector('#drawer #dLbl button').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top < 220 && document.documentElement.scrollWidth <= innerWidth; }), 'phone: the button sits at the top, on screen');
  await p.screenshot({ path: 'shots/v43-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
