// Backups and growth, 4 Oct 2026 (Amir: "how can this app back it self up? I'm afraid, it won't be stable and all the data will be
// lost or data gets large enough that something bad will happen"). Demo (made-up patients): Team & security's Backups card, the
// download (a gzip JSON file), Today's monthly reminder and "Later", restoring a deleted case from the file (and not twice), a file
// that isn't a backup; patient history fetched by patient (not every completed case); the rules card when only the index waits.
const { chromium } = require('playwright');
const fs = require('fs'), zlib = require('zlib');
const { routes, watch } = require('./helpers');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  fs.mkdirSync('shots', { recursive: true });

  console.log('\n# Patient history by patient (not every completed case)');
  await p.click('#nav-list'); await p.waitForSelector('table.tbl');
  const ref = await p.evaluate(() => Array.from(S.cases.values()).find(c => c.type === 'nla' && c.chart === '15-1001'));
  await p.waitForFunction(n => /\d+ total/.test((Array.from(document.querySelectorAll('tr.click')).find(r => r.textContent.includes(n)) || {}).textContent || ''), ref.patient, { timeout: 10000 });
  const h = await p.evaluate(() => ({ all: S.histLoaded, keys: Array.from(S.histKeys), hist: (S.hist || []).map(c => c.id) }));
  check(!h.all && h.keys.includes('c:15-1001') && h.hist.includes('demoAl0') && !h.hist.includes('demoDone0'), 'the list fetches the in-house patients’ own completed sets (' + h.hist.length + '), not every completed case');
  check(/62 total/.test(await p.textContent('tr.click:has-text("' + ref.patient + '") .alMini')), 'and the refinement shows the patient total: 18 + 44 = 62');
  await p.evaluate(() => { S.settings.pidx = 0; histReset(); }); await p.click('#nav-today'); await p.click('#nav-list');
  await p.waitForFunction(() => S.histLoaded, null, { timeout: 10000 });
  check(true, 'an office not indexed yet loads every completed case once, as before');
  await p.evaluate(() => { S.settings.pidx = 1; histReset(); });

  console.log('\n# Team & security: Backups');
  await p.click('#nav-admin'); await p.waitForSelector('#backupCard');
  const card = (await p.textContent('#backupCard')).replace(/\s+/g, ' ');
  check(/every day for 14 weeks/.test(card) && /any minute in the past 7 days/.test(card) && /office server/.test(card) && /Last backup: .*37 cases/.test(card), 'the card: Google’s daily copies and 7-day rewind, yours on the office server, the last one (37 cases)');
  await p.screenshot({ path: 'shots/v42-backups.png', fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backupCard [data-act=backupNow]')]);
  const name = dl.suggestedFilename(), path = 'shots/' + name; await dl.saveAs(path);
  const raw = fs.readFileSync(path), file = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
  const n = await p.evaluate(() => DEMO.cases.size);
  check(/^nlo-cases-backup-\d{4}-\d\d-\d\d-\d{4}\.json\.gz$/.test(name) && raw[0] === 0x1f && raw[1] === 0x8b, 'downloads nlo-cases-backup-<date>-<time>.json.gz, compressed (' + name + ', ' + raw.length + ' bytes)');
  check(file.kind === 'nlo-cases-backup' && file.ver === 1 && file.cases.length === n && file.cases.some(c => c.status === 'done') && Array.isArray(file.roster) && file.settings, 'it holds every case (' + n + ', open and completed), the team list and the settings');
  await p.waitForFunction(() => S.settings.lastBackup && Date.now() - S.settings.lastBackup.at < 60000, null, { timeout: 5000 });
  check(/Last backup: .*\d+ cases/.test(await p.textContent('#bkLast')) && await p.evaluate(n => S.settings.lastBackup.cases === n, n), 'and the card shows it as the last backup');

  console.log('\n# Today asks for one after a month (Dr. A only)');
  await p.evaluate(() => { S.settings.lastBackup = { at: Date.now() - 40 * 864e5, cases: 30 }; try { localStorage.removeItem('nloCases.backupLater'); } catch (e) { } });
  await p.click('#nav-today'); await p.waitForSelector('#bkDue');
  check(/Time to download a backup\. The last one was 40 days ago/.test(await p.textContent('#bkDue')), 'Today: “Time to download a backup. The last one was 40 days ago.”');
  await p.screenshot({ path: 'shots/v42-today-backup.png' });
  await p.click('#bkDue [data-act=backupLater]'); await p.waitForSelector('#bkDue', { state: 'detached' });
  await p.click('#nav-board'); await p.click('#nav-today'); await p.waitForSelector('.tiles');
  check(!(await p.$('#bkDue')), '“Later”: not again for a week on this computer');
  await p.evaluate(() => { try { localStorage.removeItem('nloCases.backupLater'); } catch (e) { } S.settings.lastBackup = null; });
  await p.click('#nav-board'); await p.click('#nav-today'); await p.waitForSelector('#bkDue');
  check(/There isn’t one yet/.test(await p.textContent('#bkDue')), 'no backup yet: it says so');
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { role: 'staff' }); }); await p.click('#nav-board'); await p.click('#nav-today'); await p.waitForSelector('.tiles');
  check(!(await p.$('#bkDue')), 'staff don’t see it');
  await p.evaluate(() => { DEMO.me = Object.assign({}, DEMO.me, { role: 'owner' }); S.settings.lastBackup = { at: Date.now() - 864e5, cases: 37 }; });

  console.log('\n# Restore from the file: a deleted case comes back (once)');
  const gone = await p.evaluate(async () => { const c = Array.from(DEMO.cases.values()).find(x => x.status === 'open' && x.type === 'oliv'); await B.deleteCase(c.id); return c.patient; });
  const same = await p.evaluate(n => openCases().filter(c => c.patient === n).length, gone); // (another demo patient can share the name)
  await p.click('#nav-admin'); await p.click('#backupCard [data-act=backupRestore]'); await p.waitForSelector('#bkFile');
  await p.setInputFiles('#bkFile', path); await p.waitForSelector('#bkBox [data-act=bkBring]', { timeout: 10000 });
  const box = (await p.textContent('#bkBox')).replace(/\s+/g, ' ');
  check(/Not in NLO Cases now: 1/.test(box) && box.includes(gone) && /Bring back 1/.test(box), 'the deleted case is the one not in NLO Cases now (' + gone + ')');
  await p.screenshot({ path: 'shots/v42-restore.png' });
  await p.click('#bkBox [data-act=bkBring]'); await p.waitForSelector('#bkBox .lockOk', { timeout: 10000 });
  check(/Every case in this backup is in NLO Cases/.test(await p.textContent('#bkBox')) && await p.evaluate(n => openCases().some(c => c.patient === n), gone), 'Bring back: it’s an open case again, and nothing is left to bring back');
  await p.evaluate(() => closeModal());
  await p.click('#backupCard [data-act=backupRestore]'); await p.setInputFiles('#bkFile', path); await p.waitForSelector('#bkBox .lockOk', { timeout: 10000 });
  check(await p.evaluate(([n, k]) => openCases().filter(c => c.patient === n).length === k + 1, [gone, same]), 'the same file again: nothing to bring back (it’s back under a new id, not twice)');
  fs.writeFileSync('shots/not-a-backup.json', JSON.stringify({ hello: 'world' }));
  await p.setInputFiles('#bkFile', 'shots/not-a-backup.json'); await p.waitForSelector('#bkBox .lockErr', { timeout: 10000 });
  check(/isn’t an NLO Cases backup/.test(await p.textContent('#bkBox')), 'a file that isn’t a backup: says so');
  await p.evaluate(() => closeModal());

  console.log('\n# Deleted cases: one brought back isn’t offered again');
  await p.evaluate(async () => { const c = Array.from(DEMO.cases.values()).find(x => x.status === 'open' && x.type === 'angel'); await B.deleteCase(c.id); });
  await p.click('[data-act=loadDeleted]'); await p.waitForSelector('#delBox .row');
  await p.click('#delBox .row >> nth=0 >> [data-act=undelete]'); await p.waitForTimeout(400);
  check(!(await p.$('#delBox .row')), 'after Restore it leaves the list');

  console.log('\n# Security rules: only the patient index waiting');
  await p.evaluate(() => { S.rulesOld = false; S.rulesIdx = true; queueRender('team'); }); await p.waitForSelector('#rulesCard');
  check(/keep NLO Cases quick/.test(await p.textContent('#rulesCard')) && !(await p.evaluate(() => document.body.classList.contains('phOff'))), 'the card explains it’s for speed, and photos and email updates stay on meanwhile');
  await p.evaluate(() => { S.rulesIdx = false; queueRender('team'); });

  console.log('\n# Phone');
  await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => { S.view = 'admin'; renderNav(); renderView(); });
  await p.waitForSelector('#backupCard');
  check(await p.evaluate(() => { const r = document.getElementById('backupCard').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }), 'phone: the Backups card fits the screen');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
