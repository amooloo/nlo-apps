// Patient photos in the demo (drawn cartoon faces, made-up patients): list, board, Today, case, editor, hide, new case
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await p.waitForSelector('.row .pav.on', { timeout: 10000 }); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/v11-today.png' });
  console.log('Today photos shown:', await p.locator('.row .pav.on').count(), 'of', await p.locator('.row .pav').count());
  await p.click('#nav-board'); await p.waitForSelector('.kc .pav'); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/v11-board.png' });
  await p.click('#nav-list'); await p.waitForSelector('tr.click .pav'); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/v11-list.png' });
  console.log('List photos shown:', await p.locator('tr.click .pav.on').count(), 'of', await p.locator('tr.click .pav').count(), '(only rows on screen load)');
  // a case with a photo
  await p.click('tr.click:has(.pav.on) >> nth=0'); await p.waitForSelector('#drawer .dPh .pav.on'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/v11-drawer.png' });
  // a test picture (drawn in the page) → the editor
  const b64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 1200; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 1200); gr.addColorStop(0, '#9fd3c7'); gr.addColorStop(1, '#385686'); g.fillStyle = gr; g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#e8b894'; g.beginPath(); g.ellipse(450, 470, 190, 240, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#3b2a1e'; g.beginPath(); g.ellipse(450, 300, 200, 120, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#1b2f4c'; g.beginPath(); g.arc(380, 450, 18, 0, 7); g.arc(520, 450, 18, 0, 7); g.fill(); g.strokeStyle = '#9c4a3a'; g.lineWidth = 10; g.beginPath(); g.arc(450, 540, 70, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = '#fa624d'; g.fillRect(250, 820, 400, 380); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  const pic = { name: 'test-face.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
  await p.click('#drawer .dPh'); await p.waitForSelector('#phWrap .phDrop');
  await p.screenshot({ path: OUT + '/v11-editor-pick.png' });
  await p.setInputFiles('#phFile', pic); await p.waitForSelector('#phCrop:not([hidden])');
  const st = await p.$('#phStage'); const bb = await st.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 + 10, bb.y + bb.height / 2 + 30, { steps: 5 }); await p.mouse.up();
  await p.fill('#phZ', '1.4'); await p.dispatchEvent('#phZ', 'input'); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/v11-editor-crop.png' });
  await p.click('#phWrap [data-ph=save]'); await p.waitForSelector('.toast:has-text("Photo changed")'); await p.waitForTimeout(400);
  console.log('toast:', await p.textContent('.toast >> nth=-1'));
  await p.screenshot({ path: OUT + '/v11-drawer-after.png' });
  console.log('history:', (await p.textContent('#histBox')).replace(/\s+/g, ' ').slice(-120));
  await p.click('[data-act=closeDrawer] >> nth=0');
  // blur on this computer
  await p.click('.topBar [data-act=phHide]'); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + '/v11-list-hidden.png' });
  console.log('hidden:', await p.evaluate(() => document.body.classList.contains('phHide')), '| saved:', await p.evaluate(() => localStorage.getItem('nloCases.hidePhotos')));
  await p.click('.topBar [data-act=phHide]');
  // New case for a patient who already has a photo: it comes along
  const who = await p.evaluate(() => openCases().find(c => c.photo).patient);
  await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm #cf-photo');
  await p.click('#ncForm .tt[data-tile=retainer]'); await p.fill('#cf-patient', who);
  await p.waitForSelector('#cf-photo.set', { timeout: 5000 });
  console.log('reuse label:', await p.textContent('#cf-photo .phSlotL'));
  await p.screenshot({ path: OUT + '/v11-newcase-reuse.png' });
  // pasting a picture into the form opens the editor with it
  await p.evaluate(async b => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'shot.jpg', { type: 'image/jpeg' }));
    document.querySelector('#cf-patient').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, b64);
  await p.waitForSelector('#phCrop:not([hidden])'); await p.click('#phWrap [data-ph=save]'); await p.waitForSelector('#phWrap', { state: 'detached' });
  console.log('after paste label:', await p.textContent('#cf-photo .phSlotL'));
  await p.click('#ncSave'); await p.waitForSelector('.toast:has-text("Case created")'); await p.waitForTimeout(300);
  const made = await p.evaluate(w => openCases().filter(c => c.patient === w).map(c => ({ type: c.type, photo: !!c.photo })), who);
  console.log('cases for that patient:', JSON.stringify(made));
  // phone width
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('#mnav-today'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/v11-phone-today.png' });
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
