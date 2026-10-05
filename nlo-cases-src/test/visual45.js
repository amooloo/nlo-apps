// The open-case list's Notes column (Amir, 5 Oct 2026: "in the column view there should be one for notes. so the last note would
// show there. for example I wrote a note for a pt. Sent to printing, it should show there and who wrote it"). Demo, made-up patients.
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } }); await routes(ctx);
  await ctx.addInitScript(() => { try { localStorage.removeItem('nloCases.noteAuth'); } catch (e) { } });
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto('http://127.0.0.1:8765/nlo-cases.html?demo'); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const row = name => 'tr.click:has-text("' + name + '")';
  const cell = async name => p.evaluate(sel => { const r = document.querySelector(sel); const td = r && r.querySelector('td.noteCol'); return td ? { t: (td.querySelector('.nTxt') || td).textContent.trim(), by: (td.querySelector('.nBy') || {}).textContent || '', title: (td.querySelector('.noteCell') || {}).title || '' } : null; },
    'tr.click[data-id="' + name + '"]');
  const list = async () => { await p.click('#nav-list'); await p.waitForSelector('.tbl tbody tr'); };

  console.log('\n# The column');
  await list();
  const heads = await p.$$eval('.tbl thead th', ths => ths.map(t => t.textContent.trim()));
  check(heads.includes('Notes') && heads.indexOf('Notes') === heads.indexOf('Stage') + 1, 'a Notes column, right after Stage, on screen on a laptop (' + heads.join(' | ') + ')');
  check(await p.evaluate(() => { const r = document.querySelector('.tbl th.noteCol').getBoundingClientRect(), w = document.querySelector('.tblWrap').getBoundingClientRect(); return r.right <= w.right; }), 'at 1360 wide the whole Notes column is in view without scrolling sideways');
  const withC = await p.evaluate(() => openCases().find(c => (c.comments || []).length && !c.notes).id);
  let c1 = await cell(withC);
  check(c1 && c1.t === 'Submitted in the portal.' && /^Sarah · \w{3} \d+, \d+:\d\d [AP]M$/.test(c1.by), 'a case with a comment: the comment and who wrote it, when (' + JSON.stringify(c1) + ')');
  const none = await p.evaluate(() => openCases().find(c => !(c.comments || []).length && !c.notes).id);
  check((await cell(none)).t === 'No notes', 'nothing written yet: No notes');
  await p.screenshot({ path: OUT + '/v45-list.png' });

  console.log('\n# Dr. A writes "Sent to printing" on a patient');
  const pt = await p.evaluate(() => openCases().find(c => c.type === 'retainer' && c.stage === 'print' && !(c.comments || []).length));
  await p.evaluate(id => openDrawer(id), pt.id); await p.waitForSelector('#drawer .dsList');
  if (!(await p.isVisible('#cmtText'))) await p.click('#drawer .ds[data-ds=comments] .dsTg');
  await p.fill('#cmtText', 'Sent to printing'); await p.click('[data-act=addCmt]');
  await p.waitForSelector('#drawer .cmt:has-text("Sent to printing")', { timeout: 5000 }).catch(() => {});
  await p.evaluate(() => closeDrawer()); await list();
  c1 = await cell(pt.id);
  check(c1 && c1.t === 'Sent to printing' && /^Dr\. A · /.test(c1.by), 'his comment shows in the row: “Sent to printing”, Dr. A, when (' + JSON.stringify(c1 && c1.by) + ')');
  check(/^Sent to printing\n— Dr\. A, /.test(c1.title), 'hovering shows the whole note with who and when');

  console.log('\n# The Notes field (Edit) counts too, with who wrote it');
  await p.evaluate(id => openDrawer(id), pt.id); await p.waitForSelector('#drawer .dsList');
  await p.click('#drawer [data-act=edit]'); await p.waitForSelector('#cf-notes', { state: 'attached' });
  await p.evaluate(() => { const d = document.querySelector('#drawer details.cfMore'); if (d) d.open = true; });
  await p.fill('#cf-notes', 'Patient will pick up Thursday'); await p.click('[data-act=saveEdit]');
  await p.waitForSelector('#drawer .ds[data-ds=notes]', { timeout: 5000 }).catch(() => {});
  const saved = await p.evaluate(id => { const c = findCase(id); return { by: c.notesBy, at: c.notesAt > Date.now() - 60e3, h: c.notesH === noteHash(c.notes) }; }, pt.id);
  check(saved.by === 'amir' && saved.at && saved.h, 'saving the Notes records who wrote it and when');
  if (!(await p.evaluate(() => document.querySelector('#drawer .ds[data-ds=notes]').classList.contains('open')))) await p.click('#drawer .ds[data-ds=notes] .dsTg');
  check(/^— Dr\. A, \w{3} \d+, /.test(await p.textContent('#dNoteBy')), 'the case’s Notes section says who wrote it (' + (await p.textContent('#dNoteBy')) + ')');
  await p.evaluate(() => closeDrawer()); await list();
  c1 = await cell(pt.id);
  check(c1.t === 'Patient will pick up Thursday' && /^Dr\. A · /.test(c1.by), 'the newer of the two shows: the Notes, written after the comment');

  console.log('\n# Notes written before today: who wrote it comes from the case’s history');
  const old = await p.evaluate(() => { const c = openCases().find(x => x.type === 'oliv' && !(x.comments || []).length && !x.notes);
    const at = Date.now() - 3 * 3600e3, set = x => Object.assign(x, { notes: 'Called pt — wants a morning appt', notesBy: '', notesAt: 0, notesH: '', comments: [{ id: 'k9', at: Date.now() - 5 * 3600e3, by: 'sarah', text: 'Scan uploaded' }] });
    set(c); set(DEMO.cases.get(c.id)); DEMO.logs.push({ caseId: c.id, a: 'edit', fields: ['notes'], at, sid: 'gwen' }); return c.id; });
  const imp = await p.evaluate(() => { const c = openCases().find(x => x.type === 'angel' && !(x.comments || []).length && !x.notes);
    const set = x => Object.assign(x, { notes: 'Asana: check attachments', notesBy: 'asana', notesAt: Date.now() - 20 * 86400e3, notesH: noteHash('Asana: check attachments'), importedAt: Date.now() - 20 * 86400e3 });
    set(c); set(DEMO.cases.get(c.id)); return c.id; });
  await p.click('#nav-today'); await list();
  await p.waitForFunction(id => /Gwen/.test((document.querySelector('tr.click[data-id="' + id + '"] td.noteCol .nBy') || {}).textContent || ''), old, { timeout: 5000 }).catch(() => {});
  c1 = await cell(old);
  check(c1.t === 'Called pt — wants a morning appt' && /^Gwen · /.test(c1.by), 'an older Notes: Gwen, found in the history — and newer than the comment on the case, so it’s the one shown (' + c1.by + ')');
  check(await p.evaluate(id => { const m = JSON.parse(localStorage.getItem('nloCases.noteAuth') || '{}'); return m[id] && m[id].by === 'gwen' && !/Called/.test(localStorage.getItem('nloCases.noteAuth')); }, old), 'remembered on this computer by case (no patient details)');
  c1 = await cell(imp);
  check(c1.t === 'Asana: check attachments' && /^from Asana · /.test(c1.by), 'notes brought in from Asana say so');

  console.log('\n# Sort, hide, bring back');
  await p.click('.tbl th button[data-k=notes]'); await p.waitForTimeout(100);
  const order = await p.$$eval('.tbl tbody tr', rs => rs.slice(0, 2).map(r => r.dataset.id));
  check(order[0] === pt.id, 'sorting by Notes puts the newest note first');
  await p.click('.tbl th:has-text("Notes") .thHide'); await p.waitForTimeout(100);
  check(!(await p.$('.tbl td.noteCol')), 'its eye hides the column');
  await p.click('[data-act=colMenu]'); await p.check('.colMenu input[data-col=notes]'); await p.waitForTimeout(100);
  check(!!(await p.$('.tbl td.noteCol')), 'Columns brings it back');
  await p.click('[data-act=colMenu]').catch(() => {});

  console.log('\n# My cases has it too; phones show it under the name');
  await p.click('#nav-mine'); await p.waitForFunction(() => S.view === 'mine' && document.querySelector('.tbl thead'), null, { timeout: 5000 }).catch(() => {});
  const mh = await p.evaluate(() => ({ v: S.view, h: Array.from(document.querySelectorAll('.tbl thead th')).map(t => t.textContent.trim()), hid: Array.from(hiddenCols()) }));
  check(mh.v === 'mine' && mh.h.some(x => /^Notes/.test(x)), 'My cases: Notes column (still sorted by it)');
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('#mnav-list'); await p.waitForSelector('.tbl tbody tr');
  const mob = await p.evaluate(id => { const r = document.querySelector('tr.click[data-id="' + id + '"] .nMob'); const b = r && r.getBoundingClientRect();
    return r && { t: r.textContent, vis: getComputedStyle(r).display !== 'none', fits: b.right <= innerWidth, over: document.documentElement.scrollWidth - innerWidth }; }, pt.id);
  check(mob && mob.vis && /^Dr\. A: Patient will pick up Thursday$/.test(mob.t) && mob.fits && mob.over <= 0, 'phone: “Dr. A: Patient will pick up Thursday” under the name, no sideways scrolling');
  await p.screenshot({ path: OUT + '/v45-phone.png' });

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
