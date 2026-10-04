// Email updates, lab hold / lab case #, chart note and Ship to patient defaults in the demo (made-up patients)
const { chromium } = require('playwright');
const { routes, watch, panelsOpen } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await routes(ctx); await panelsOpen(ctx); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8765' }); // panels open: the case panel folds by default (3 Oct 2026)
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await p.waitForSelector('#mailCard .mlRow', { timeout: 10000 });
  await p.screenshot({ path: OUT + '/v10-today-mail.png' });
  console.log('review rows:', await p.locator('#mailCard .mlRow').count(), '|', (await p.textContent('#mailCard')).replace(/\s+/g, ' ').slice(0, 200));
  const st = await p.evaluate(() => openCases().filter(c => (c.mailIds || []).length).map(c => ({ type: c.type, stage: c.stage, tracking: c.tracking || '', labRef: c.labRef || '', planUrl: c.planUrl || '' })));
  console.log('applied:', JSON.stringify(st));
  // the uLab case
  await p.click('#nav-list'); await p.fill('#q', 'DMO42'); await p.waitForSelector('tr.click');
  await p.click('tr.click >> nth=0'); await p.waitForSelector('#histBox .hist'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/v10-drawer-ulab.png' });
  console.log('history:', (await p.textContent('#histBox')).replace(/\s+/g, ' ').slice(0, 160));
  console.log('note:', JSON.stringify(await p.textContent('#noteTxt')));
  await p.click('#drawer [data-act=copyNote]'); await p.waitForSelector('.toast:has-text("Chart note copied")');
  console.log('clipboard:', JSON.stringify((await p.evaluate(() => navigator.clipboard.readText())).slice(0, 80)));
  await p.click('[data-act=closeDrawer] >> nth=0');
  // the Oliv case with its plan link
  await p.fill('#q', '590017'); await p.waitForSelector('tr.click'); await p.click('tr.click >> nth=0'); await p.waitForSelector('#drawer .portals');
  await p.screenshot({ path: OUT + '/v10-drawer-oliv.png' });
  await p.click('[data-act=closeDrawer] >> nth=0'); await p.fill('#q', '');
  // apply the unplaced Partners shipment to a case
  await p.click('#nav-today'); await p.waitForSelector('#mailCard .mlSel');
  const val = await p.evaluate(() => { const s = document.querySelector('#mailCard .mlSel'); const o = Array.from(s.options).find(x => x.value && /Appliance/.test(x.textContent)); return o ? o.value : ''; });
  await p.selectOption('#mailCard .mlSel', val); await p.click('#mailCard [data-act=mailApply]');
  await p.waitForSelector('.toast:has-text("Applied")'); await p.waitForTimeout(500);
  console.log('card after apply:', await p.locator('#mailCard').count());
  // Team & security
  await p.click('#nav-admin'); await p.waitForSelector('#mailAdmin .mlBeat');
  // Team & security redraws once more as its data comes in, which can swap the card out mid-scroll: try again (4 Oct 2026)
  for (let i = 0; ; i++) { try { await p.locator('#mailAdmin').scrollIntoViewIfNeeded({ timeout: 3000 }); break; } catch (e) { if (i >= 5) throw e; await p.waitForTimeout(250); } }
  await p.screenshot({ path: OUT + '/v10-admin-mail.png' });
  await p.click('#mailAdmin [data-act=mailScript]'); await p.waitForSelector('#mlScript');
  const sc = await p.inputValue('#mlScript');
  console.log('script ok:', sc.includes('"botEmail":"mailbot.demo@staff.example"') && !sc.includes('/*NLO_CONFIG*/null'), sc.length);
  await p.screenshot({ path: OUT + '/v10-script-modal.png' });
  await p.click('.modal [data-act=closeModal]');
  // New case: Ship to patient switches on No IPR and No attachments (all teeth)
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.click('#cf-ship');
  console.log('ship on → No IPR', await p.getAttribute('.rxTile[data-v="No IPR"]', 'aria-pressed'), '| noatt', await p.getAttribute('#cf-noatt', 'aria-pressed'), await p.textContent('#cf-noattSub'), '|', await p.textContent('#cf-teethSum'));
  const tg = await p.$('#cf-ship'); await tg.scrollIntoViewIfNeeded(); await p.screenshot({ path: OUT + '/v10-ship-defaults.png' });
  await p.click('#cf-ship');
  console.log('ship off → No IPR', await p.getAttribute('.rxTile[data-v="No IPR"]', 'aria-pressed'), '| noatt', await p.getAttribute('#cf-noatt', 'aria-pressed'), '|', await p.textContent('#cf-teethSum'));
  await p.click('.modal [data-act=closeModal]');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
