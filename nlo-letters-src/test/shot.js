/* Opens the built page in demo mode and saves, for looking at: the pick screen, the builder, and each of the seven
   letters as a PDF with every choice picked (made-up people only).
   Needs a static server on :8765 serving dist/.   CHROME=<chrome> node test/shot.js <folder> */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { routes, watch } = require('./helpers');
(async () => {
  const out = process.argv[2] || '/tmp/letters-shots'; fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); await routes(ctx);
  const p = await ctx.newPage(); const errs = []; watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-letters.html?demo'); await p.click('#lgBtn');
  await p.waitForSelector('.ltGrid'); await p.screenshot({ path: path.join(out, '1-pick.png') });
  const ids = await p.evaluate(() => LETTERS.map(l => l.id));
  for (const id of ids) {
    await p.click('[data-act=pickLetter][data-id=' + id + ']');
    if (id === ids[0]) { await p.fill('#ptFirst', 'Avery'); await p.fill('#ptLast', 'Sample'); await p.fill('#ptDob', '2013-04-09'); await p.fill('#ptRp', '(352) 555-0142'); await p.fill('#docQ', 'mock'); await p.click('.docHit'); }
    if (await p.locator('.tooth').count()) for (const t of ['6', '11']) await p.click('.tooth[data-set=teeth][data-id="' + t + '"]');
    if (await p.locator('.tooth[data-set=teeth2]').count()) for (const t of ['C', 'H']) await p.click('.tooth[data-set=teeth2][data-id="' + t + '"]');
    if (id === 'exposure') await p.screenshot({ path: path.join(out, '5-exposure.png'), fullPage: true });
    if (await p.locator('.sDot').count()) for (const s of ['B:3-4', 'L:13-14', 'B:30-29']) await p.click('.sDot[data-id="' + s + '"]');
    for (const key of await p.evaluate(() => letterById(S.draft.letter).opts.map(o => o.key).filter(k => !(k === 'count' && letterById(S.draft.letter).sites)))) { // the TAD count follows the marked spots
      const chips = p.locator('.chip[data-k=' + key + ']'); const multi = await p.evaluate(k => letterById(S.draft.letter).opts.find(o => o.key === k).multi, key);
      const n = multi ? Math.min(3, await chips.count()) : 1; for (let i = 0; i < n; i++) await chips.nth(i).click();
    }
    if (id === 'radiographic') {
      // a made-up "x-ray" (a grey box) to check the enclosure page
      const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#333'; g.fillRect(0, 0, 900, 500); g.fillStyle = '#bbb'; g.font = '40px sans-serif'; g.fillText('made-up x-ray', 300, 260); return c.toDataURL('image/png').split(',')[1]; });
      await p.setInputFiles('#imgFile', { name: 'pano.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await p.waitForSelector('.imgChip');
    }
    if (id === ids[0]) await p.screenshot({ path: path.join(out, '2-builder.png'), fullPage: true });
    if (id === 'tads') await p.screenshot({ path: path.join(out, '6-tads.png'), fullPage: true });
    await p.emulateMedia({ media: 'print' });
    await p.pdf({ path: path.join(out, id + '.pdf'), format: 'Letter', preferCSSPageSize: true });
    await p.emulateMedia({ media: 'screen' });
    await p.click('[data-act=startOver]'); await p.click('#cbYes'); await p.waitForSelector('.ltGrid');
  }
  await p.click('[data-act=nav][data-v=doctors]'); await p.waitForSelector('.tbl'); await p.screenshot({ path: path.join(out, '3-doctors.png') });
  await p.click('[data-act=nav][data-v=settings]'); await p.waitForSelector('#setForm'); await p.screenshot({ path: path.join(out, '4-settings.png') });
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})().catch(e => { console.log('CRASH ' + (e.stack || e)); process.exit(1); });
