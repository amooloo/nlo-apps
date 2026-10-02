// Staff photos from Staff Hub, staff photo tiles (Assistant, Assigned to), the edit header, and grouped email updates (demo)
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await p.click('#nav-admin'); await p.waitForSelector('.toast:has-text("staff photo")', { timeout: 15000 });
  console.log('import:', await p.textContent('.toast:has-text("staff photo")'));
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/v12-team-photos.png', clip: { x: 0, y: 0, width: 940, height: 900 } });
  console.log('roster photos:', await p.evaluate(() => S.roster.filter(r => r.photo).map(r => r.sid + ':' + r.photo.length).join(', ')));
  // a case: Assigned to as photo tiles
  await p.click('#nav-list'); await p.click('tr.click >> nth=0'); await p.waitForSelector('#drawer .dAssign .aTile');
  await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/v12-drawer-assign.png' });
  const before = await p.evaluate(() => findCase(S.openId).assignee);
  await p.click('#drawer .dAssign .aTile[data-v=gwen]'); await p.waitForSelector('.toast:has-text("Assigned to")');
  console.log('assigned:', before, '→', await p.evaluate(() => findCase(S.openId).assignee));
  // editing: the name stays big at the top
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#dEditName');
  await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/v12-edit-header.png' });
  await p.fill('#cf-patient', 'Renamed Example'); console.log('header follows typing:', await p.textContent('#dEditName'));
  await p.click('#drawer [data-act=cancelEdit]'); await p.click('[data-act=closeDrawer] >> nth=0');
  // New case: Assistant tiles
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm .staffRow[data-g=assistant] .sTile');
  await p.click('#ncForm .tt[data-tile=oliv]'); await p.fill('#cf-patient', 'Tilde Tilecheck');
  await p.click('#ncForm .staffRow[data-g=assistant] .sTile[data-v=gwen]');
  const sec = await p.$('#ncForm .staffRow[data-g=assistant]'); await sec.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/v12-newcase-assistant.png' });
  await p.click('#ncForm details.cfMore summary'); await p.click('#ncForm .aTiles .aTile[data-v=kaylee]');
  await p.click('#ncSave'); await p.waitForSelector('.toast:has-text("Case created")');
  console.log('new case:', JSON.stringify(await p.evaluate(() => { const c = openCases().find(x => x.patient === 'Tilde Tilecheck'); return { assistant: c.assistant, assignee: c.assignee }; })));
  // email updates: the same update in two emails is one row; Dismiss all
  await p.click('#nav-today'); await p.waitForSelector('#mailCard .mlRow');
  await p.evaluate(() => { const x = DEMO.mail.inbox.find(m => m.id === 'mdemo3'); DEMO.mail.inbox.push(Object.assign(JSON.parse(JSON.stringify(x)), { id: 'mdemo3b', mail: Object.assign({}, x.mail, { box: 'office@example.com' }) })); DEMO.h.inbox(); });
  await p.waitForTimeout(1500);
  console.log('rows:', await p.locator('#mailCard .mlRow').count(), '|', (await p.textContent('#mailCard .mlRow')).replace(/\s+/g, ' ').slice(0, 160));
  await p.screenshot({ path: OUT + '/v12-mail-grouped.png', clip: { x: 232, y: 280, width: 1128, height: 220 } });
  await p.click('#mailCard [data-act=mailSkip]'); await p.waitForTimeout(1200);
  console.log('after dismiss: card rows', await p.locator('#mailCard .mlRow').count(), '| inbox docs left', await p.evaluate(() => DEMO.mail.inbox.length), '| remembered', await p.evaluate(() => (localStorage.getItem('nloCases.mailGone') || '').length > 10));
  await p.evaluate(() => { DEMO.mail.inbox.push({ id: 'mdemo3c', at: Date.now(), done: [], mail: { box: 'records@example.com', from: 'general@partnersdentalstudio.com', subject: 'Daily Cases Received, Shipped, and Held', date: Date.now(), text: '', html: '<p>Cases Shipped Today</p><table><tr><th>Patient Name</th><th>Invoice Number</th><th>Tracking Number</th><th>Carrier</th></tr><tr><td>Robin T.</td><td>228700</td><td>1Z999AA10123456785</td><td>UPS</td></tr></table>' } }); DEMO.h.inbox(); });
  await p.waitForTimeout(1500);
  console.log('a later email with the same update:', await p.locator('#mailCard .mlRow').count(), 'rows (0 = stayed dismissed) | inbox docs left', await p.evaluate(() => DEMO.mail.inbox.length));
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
