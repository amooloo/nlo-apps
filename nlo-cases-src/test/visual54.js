// Duplicates, and names with the eye (Amir, 6 Oct 2026: "how do we prevent double entries for the same case? Also can the names fill
// up as you type the name … like a search during the entry with photos so if the pt is already in there you can just select them?
// Also if there is a double created accidently. How can it be removed or archived?" — and "when you click on the eye icon to make it
// like to hide the faces, can you make the names just to show them just the initials … Or maybe first name and last name initial?").
// Demo, made-up patients.
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
  const txt = s => p.$eval(s, el => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const openNew = async tile => { await p.click('.topBar [data-act=newCase]'); await p.waitForSelector('#ncForm'); if (tile) await p.click('#ncForm .tt[data-tile=' + tile + ']'); };
  const count = name => p.evaluate(n => openCases().filter(c => c.patient === n).length, name);
  const clearToasts = () => p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); });

  console.log('\n# New case: the name looks up the patients already in');
  await openNew('retainer');
  await p.click('#cf-patient'); await p.keyboard.type('Bl', { delay: 20 }); await p.waitForTimeout(250);
  const l1 = await p.$$eval('#cf-ptList .ptOpt .ptoNm', o => o.map(x => x.textContent));
  check(l1.some(t => t.startsWith('Blake Sample')), 'typing “Bl”: Blake Sample is listed (' + l1.join(', ') + ')');
  const o1 = await p.$eval('#cf-ptList .ptOpt', o => ({ b: (o.querySelector('.ptoNm b') || {}).textContent, t: o.textContent }));
  check(o1.b === 'Bl' && /Open: Retainers & whitening \(To make\)/.test(o1.t), 'the typed letters in bold, and their open case with its step');
  await p.waitForFunction(() => !!document.querySelector('#cf-ptList .ptOpt .pav.on img'), null, { timeout: 4000 }).catch(() => {});
  check(!!(await p.$('#cf-ptList .ptOpt .pav.on img')), 'with their photo');
  check(await p.getAttribute('#cf-patient', 'role') === 'combobox' && await p.getAttribute('#cf-patient', 'aria-expanded') === 'true', 'the name box is a combobox and says its list is open');
  await p.screenshot({ path: OUT + '/v54-search.png' });
  await p.keyboard.press('ArrowDown');
  check(await p.getAttribute('#cf-patient', 'aria-activedescendant') === 'cf-pto0' && !!(await p.$('#cf-pto0.on')), '↓ picks out the first one');
  await p.keyboard.press('Enter'); await p.waitForTimeout(450);
  check(await p.inputValue('#cf-patient') === 'Blake Sample' && await p.$eval('#cf-ptFind', b => b.hidden), 'Enter: the name exactly as on file, and the list goes away');
  check(await p.isVisible('#ncForm'), '(Enter didn’t create the case)');
  await p.waitForFunction(() => { const s = document.querySelector('#cf-photo'); return s && s.classList.contains('set'); }, null, { timeout: 4000 }).catch(() => {});
  check(await p.$eval('#cf-photo', s => s.classList.contains('set')), 'their photo comes along');
  const w1 = await p.$eval('#cf-ptInfo', b => ({ warn: !!b.querySelector('.ptInfo.warn'), t: b.textContent, btn: (b.querySelector('[data-act=ptOpen]') || {}).textContent }));
  check(w1.warn && /Blake Sample already has an open Retainers & whitening case/.test(w1.t) && w1.btn === 'Open that case', 'under the name, in amber: “Blake Sample already has an open Retainers & whitening case” — Open that case');
  await p.click('#ncForm .tt[data-tile=mouthguard]'); await p.waitForTimeout(250);
  const w2 = await p.$eval('#cf-ptInfo', b => ({ warn: !!b.querySelector('.ptInfo.warn'), t: b.textContent }));
  check(!w2.warn && /Blake Sample is already in the app with an open case/.test(w2.t), 'a mouthguard instead: no warning, their open case is just listed');
  await p.click('#ncForm .tt[data-tile=retainer]'); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + '/v54-warn.png' });

  console.log('\n# Create case asks first');
  const n0 = await count('Blake Sample');
  await p.click('#ncSave'); await p.waitForSelector('#ncDup .dupAsk', { timeout: 4000 }).catch(() => {});
  check(!!(await p.$('#ncDup .dupAsk')) && await p.isVisible('#ncForm') && await count('Blake Sample') === n0, 'Create case: it asks, nothing is created yet');
  check(/Blake Sample already has an open Retainers & whitening case/.test(await txt('#ncDup')) && /If it’s the same case, open it instead of making a second one/.test(await txt('#ncDup')), 'what it says: ' + (await txt('#ncDup .daHd')));
  await p.screenshot({ path: OUT + '/v54-ask.png' });
  await p.click('#ncDup [data-act=ptOpen]'); await p.waitForSelector('#drawer h3', { timeout: 4000 }).catch(() => {});
  check(!(await p.$('#modalWrap')) && await p.evaluate(() => (findCase(S.openId) || {}).patient) === 'Blake Sample' && await count('Blake Sample') === n0, 'Open that case: the form closes, their case opens, still one case');
  await p.evaluate(() => closeDrawer(true));
  await openNew('retainer'); await p.fill('#cf-patient', 'Blake Sample'); await p.waitForTimeout(300);
  check(await p.$eval('#cf-ptInfo', b => !!b.querySelector('.ptInfo.warn')), 'the name typed out in full (not picked): the same warning');
  await p.click('#ncSave'); await p.waitForSelector('#ncDup .dupAsk', { timeout: 4000 }).catch(() => {});
  await p.click('#ncDupOk'); await p.waitForSelector('#modalWrap', { state: 'detached', timeout: 5000 }).catch(() => {});
  const two = await p.evaluate(() => openCases().filter(c => c.patient === 'Blake Sample').sort((a, b) => a.createdAt - b.createdAt).map(c => ({ id: c.id, nd: c.notDup || [] })));
  check(two.length === n0 + 1 && two[1].nd.includes(two[0].id), 'Create a second case anyway: made, and noted as not a duplicate of the first');
  check(await p.evaluate(ids => ids.every(id => !dupsOf(findCase(id)).length), two.map(x => x.id)), 'so neither is flagged');

  console.log('\n# Esc puts the list away, not the form');
  await openNew('nla'); await p.click('#cf-patient'); await p.keyboard.type('Ave', { delay: 20 }); await p.waitForTimeout(250);
  const av = await txt('#cf-ptList .ptOpt');
  check(/Avery Sample/.test(av) && /2 open:/.test(av), 'Avery Sample, with both her open cases: ' + av.slice(0, 90));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  check(await p.$eval('#cf-ptFind', b => b.hidden) && await p.isVisible('#ncForm'), 'Esc: the list goes, the form stays');
  await p.keyboard.type('r', { delay: 20 }); await p.waitForTimeout(250);
  check(!(await p.$eval('#cf-ptFind', b => b.hidden)), 'typing on brings it back');
  await p.fill('#cf-patient', 'Zz Nobody'); await p.waitForTimeout(250);
  check(await p.$eval('#cf-ptFind', b => b.hidden) && (await txt('#cf-ptInfo')) === '', 'a new patient: no list, nothing under the name');
  await p.evaluate(() => closeModal());

  console.log('\n# Doubles already in: flagged');
  // Gwen entered Logan Testcase's retainers again (made up), with a comment and a note
  const keepId = await p.evaluate(() => openCases().find(c => c.patient === 'Logan Testcase' && c.type === 'retainer').id);
  const dupId = await p.evaluate(async kid => { const o = JSON.parse(JSON.stringify(findCase(kid))); delete o.id;
    return B.createCase(Object.assign(o, { stage: 'print', comments: [{ id: 'cx1', at: Date.now() - 6e4, by: 'gwen', text: 'Patient wants them by Friday.' }], notes: 'Upper only if the lower is still fine.', notesBy: 'gwen', notesAt: Date.now() - 5e4, createdAt: Date.now(), createdBy: 'gwen' })); }, keepId);
  // and Peyton Example's, which really is a second set (marked Not a duplicate below)
  const pId = await p.evaluate(async () => { const o = JSON.parse(JSON.stringify(openCases().find(c => c.patient === 'Peyton Example'))); delete o.id; return B.createCase(Object.assign(o, { stage: 'print', comments: [], createdAt: Date.now(), createdBy: 'kaylee' })); });
  await p.waitForTimeout(250);
  await p.click('#nav-list'); await p.waitForSelector('[data-act=dupsF]', { timeout: 4000 }).catch(() => {});
  check(/^Possible duplicates\s*4$/.test(await txt('[data-act=dupsF]')), 'All open cases: a Possible duplicates filter (' + (await txt('[data-act=dupsF]')) + ')');
  await p.click('[data-act=dupsF]'); await p.waitForTimeout(250);
  const rows = await p.$$eval('#listBody tbody tr', r => r.map(x => x.querySelector('.pt').textContent + (x.querySelector('.flag.dupF') ? ' ⚑' : '')));
  check(rows.length === 4 && rows.every(r => r.endsWith('⚑')) && rows[0].startsWith('Logan') === rows[1].startsWith('Logan'), 'filtered: the 4, flagged, side by side by name (' + rows.join(', ') + ')');
  await p.screenshot({ path: OUT + '/v54-list.png' });
  await p.click('[data-act=dupsF]');
  await p.click('#nav-board'); await p.click('[data-act=flow][data-k=retainer]'); await p.waitForSelector('.board');
  check(await p.$$eval('.kc .flag.dupF', f => f.length) === 4, 'the board flags them too');
  await p.evaluate(id => openDrawer(id), pId); await p.waitForSelector('#drawer .notice.dupN');
  check(/Possible duplicate — Peyton Example has another open Retainers & whitening case/.test(await txt('#drawer .notice.dupN')), 'the case panel says which case it looks like');
  await p.click('#drawer .notice.dupN [data-act=notDup]'); await p.waitForTimeout(300);
  check(!(await p.$('#drawer .notice.dupN')) && await p.evaluate(() => openCases().filter(c => c.patient === 'Peyton Example').every(c => !dupsOf(c).length)), 'Not a duplicate: the flag goes from both');
  await p.evaluate(() => closeDrawer(true));

  console.log('\n# Remove duplicate');
  await clearToasts();
  await p.evaluate(id => openDrawer(id), dupId); await p.waitForSelector('#drawer .notice.dupN');
  await p.screenshot({ path: OUT + '/v54-panel.png' });
  await p.click('#drawer .notice.dupN [data-act=dupRemove]'); await p.waitForSelector('#dkGo');
  const dlg = await p.evaluate(() => ({ picked: (document.querySelector('input[name=dupKeep]:checked') || {}).value, copy: (document.querySelector('.dkCopy') || {}).textContent || '', go: document.querySelector('#dkGo').disabled }));
  check(dlg.picked === keepId && !dlg.go, 'the one that looks the same is picked to keep');
  check(/Copy its comment and Notes to the case you keep/.test(dlg.copy), 'offers to copy its comment and Notes over');
  await p.screenshot({ path: OUT + '/v54-remove.png' });
  await p.click('#dkGo'); await p.waitForTimeout(700);
  const r1 = await p.evaluate(([id, kid]) => { const d = DEMO.cases.get(id), k = DEMO.cases.get(kid);
    return { st: d.status, of: (d.dup || {}).of, was: (d.dup || {}).was, by: (d.dup || {}).by, cm: (k.comments || []).map(x => x.text), open: S.openId }; }, [dupId, keepId]);
  check(r1.st === 'done' && r1.of === keepId && r1.was === 'open' && r1.by === 'amir', 'it’s closed as a duplicate of the one kept (nothing deleted)');
  check(r1.cm.includes('Patient wants them by Friday.') && r1.cm.includes('Notes from the duplicate case: Upper only if the lower is still fine.'), 'its comment and Notes are on the case kept');
  check(r1.open === keepId, 'and the case kept opens');
  check(/Duplicate removed — kept Logan Testcase’s Retainers & whitening case \(2 comments copied to it\)/.test(await txt('#toasts')), 'toast: ' + (await txt('#toasts')).slice(0, 110));
  check(await p.evaluate(() => !document.querySelector('#view .flag.dupF')), 'no more flags');
  await p.evaluate(() => { const b = document.querySelector('#drawer [data-ds=history] [data-act=dsTg]'); if (b) b.click(); }); await p.waitForTimeout(300);
  check(/copied 2 comments from a duplicate case/.test(await txt('#histBox')), 'the kept case’s history says so');
  check(await p.evaluate(id => DEMO.logs.some(l => l.caseId === id && l.a === 'dup'), dupId), 'and the duplicate’s history: removed as a duplicate');
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-done'); await p.waitForSelector('#view .tbl, #view .empty', { timeout: 4000 }).catch(() => {});
  check(await p.evaluate(id => !document.querySelector('#view tr[data-id="' + id + '"]') && !S.closed.some(c => c.id === id) && !(S.hist || []).some(c => c.id === id), dupId), 'not in Completed, nor in the patient’s history');
  await p.click('.toast .linkBtn'); await p.waitForTimeout(600); // Undo
  const r2 = await p.evaluate(([id, kid]) => ({ st: DEMO.cases.get(id).status, dup: !!DEMO.cases.get(id).dup, cm: DEMO.cases.get(kid).comments.length }), [dupId, keepId]);
  check(r2.st === 'open' && !r2.dup && r2.cm === 1, 'Undo: it’s back, and what was copied comes off the kept case');

  console.log('\n# From the case’s own button; Dr. A brings it back');
  await clearToasts();
  await p.evaluate(id => openDrawer(id), dupId); await p.waitForSelector('#drawer .dFt [data-act=dupRemove]');
  await p.click('#drawer .dFt [data-act=dupRemove]'); await p.waitForSelector('#dkGo');
  await p.click('#dkCopy'); await p.click('#dkGo'); await p.waitForTimeout(600);
  check(await p.evaluate(([id, kid]) => DEMO.cases.get(id).status === 'done' && DEMO.cases.get(kid).comments.length === 1, [dupId, keepId]), 'removed again — nothing copied when unticked');
  await p.evaluate(() => closeDrawer(true));
  await p.click('#nav-admin'); await p.waitForSelector('[data-act=loadDups]'); await p.waitForTimeout(400);
  await p.click('[data-act=loadDups]'); await p.waitForSelector('#dupBox [data-act=undup]', { timeout: 4000 }).catch(() => {});
  check(/Logan Testcase/.test(await txt('#dupBox')) && /removed .* by Akhavan/.test(await txt('#dupBox')), 'Team & security → Removed duplicates: ' + (await txt('#dupBox')).slice(0, 120));
  await p.$eval('#dupBox', b => b.scrollIntoView({ block: 'center' })); await p.screenshot({ path: OUT + '/v54-admin.png' });
  await p.click('#dupBox [data-act=undup]'); await p.waitForTimeout(600);
  check(await p.evaluate(id => DEMO.cases.get(id).status === 'open' && !DEMO.cases.get(id).dup, dupId) && /No duplicates removed/.test(await txt('#dupBox')), 'Bring back: open again, and off the list');

  console.log('\n# A double spelled differently: found by searching');
  const tyId = await p.evaluate(async () => { const o = JSON.parse(JSON.stringify(openCases().find(c => c.patient === 'Jamie Demo'))); delete o.id; return B.createCase(Object.assign(o, { patient: 'Jamey Demo', comments: [], createdAt: Date.now(), createdBy: 'gwen' })); });
  await p.click('#nav-list'); await p.waitForTimeout(200);
  await p.evaluate(id => openDrawer(id), tyId); await p.waitForSelector('#drawer .dFt [data-act=dupRemove]');
  check(!(await p.$('#drawer .notice.dupN')), '(another spelling isn’t flagged)');
  await p.click('#drawer .dFt [data-act=dupRemove]'); await p.waitForSelector('#dkGo');
  check(/No other case for Jamey Demo/.test(await txt('#dkList')) && await p.$eval('#dkGo', b => b.disabled), 'nothing to keep yet — Remove duplicate waits');
  await p.fill('#dkQ', 'Jamie'); await p.waitForTimeout(250);
  const found = await p.$$eval('#dkList .dkRow', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
  check(found.some(t => /Jamie Demo · Retainers & whitening/.test(t)), 'searching “Jamie” finds Jamie Demo’s retainers (' + found.length + ')');
  await p.click('#dkList .dkRow:has-text("Jamie Demo") input'); await p.click('#dkGo'); await p.waitForTimeout(600);
  check(await p.evaluate(id => DEMO.cases.get(id).status === 'done' && DEMO.cases.get(id).dup.of === openCases().find(c => c.patient === 'Jamie Demo').id, tyId), 'removed, as a duplicate of Jamie Demo’s');
  await p.evaluate(() => closeDrawer(true));

  console.log('\n# Workload: a removed duplicate isn’t counted as entered');
  await p.click('#nav-work'); await p.waitForFunction(() => WK.log && !WK.busy, null, { timeout: 8000 }).catch(() => {});
  const wk = await p.evaluate(() => { const since = wkSince(WK.days); const n = Array.from(DEMO.cases.values()).filter(c => c.createdBy === 'gwen' && (c.createdAt || 0) >= since && !c.dup && !c.importedAt && !c.locked).length; return { n, got: (wkStats().get('gwen') || {}).entered }; });
  check(wk.got === wk.n, 'Gwen: ' + wk.got + ' entered (the Jamey Demo she removed isn’t among them; expected ' + wk.n + ')');

  console.log('\n# The eye: photos blurred, names shortened');
  check(await p.evaluate(() => [['Jane Doe', 'Jane D.'], ['Mary Ann Smith', 'Mary S.'], ['John Smith Jr.', 'John S.'], ['Doe, Jane', 'Jane D.'], ['Madonna', 'Madonna'], ['Ana (Annie) López', 'Ana L.'], ["D'Angelo O'Neil", "D'Angelo O."], ['Jean-Luc Picard', 'Jean-Luc P.'], ['  ', '']].every(([a, b]) => shortName(a) === b)), 'first name and last initial: Jane D., Mary S., John S. (no Jr.), “Doe, Jane” → Jane D., Madonna, Ana L., Jean-Luc P.');
  await p.click('#nav-list'); await p.waitForSelector('#listBody tbody tr');
  await p.click('.topBar [data-act=phHide]'); await p.waitForTimeout(250);
  const nm = await p.$eval('#listBody tbody tr .pt .pnm', el => ({ full: el.textContent, after: getComputedStyle(el, '::after').content, hid: getComputedStyle(el.querySelector('.pnF')).display }));
  check(nm.after === '"' + (await p.evaluate(n => shortName(n), nm.full)) + '"' && nm.hid === 'none', 'the list shows “' + nm.after.replace(/"/g, '') + '” for ' + nm.full);
  check(await p.$eval('#listBody tbody tr .pav.on img', i => /blur/.test(getComputedStyle(i).filter)).catch(() => false), 'and the photos are blurred');
  await p.hover('#listBody tbody tr .pt .pnm'); await p.waitForTimeout(100);
  check(await p.$eval('#listBody tbody tr .pt .pnm', el => getComputedStyle(el.querySelector('.pnF')).display !== 'none' && getComputedStyle(el, '::after').content === 'none'), 'hovering over a name shows it in full');
  await p.screenshot({ path: OUT + '/v54-hidden.png' });
  await p.click('#nav-board'); await p.waitForSelector('.kc');
  check(await p.$eval('.kc .pt .pnm', el => getComputedStyle(el.querySelector('.pnF')).display === 'none'), 'the board too');
  const cid = await p.evaluate(() => openCases().find(c => c.patient === 'Taylor Mockley').id);
  await p.evaluate(id => openDrawer(id), cid); await p.waitForSelector('#drawer h3 .pnm');
  check(await p.$eval('#drawer h3 .pnm', el => getComputedStyle(el, '::after').content) === '"Taylor M."', 'and the case panel: Taylor M.');
  await clearToasts(); await p.click('#drawer [data-act=complete]'); await p.waitForTimeout(400);
  check(/^Taylor M\. marked complete/.test(await txt('#toasts .toast')), 'a toast names them the same way: ' + (await txt('#toasts .toast')).slice(0, 40));
  await p.click('#toasts .toast .linkBtn'); await p.waitForTimeout(300);
  await p.evaluate(() => closeDrawer(true));
  await openNew(null); await p.click('#cf-patient'); await p.keyboard.type('Tay', { delay: 20 }); await p.waitForTimeout(250);
  check(await p.$eval('#cf-ptList .ptoNm .pnm', el => getComputedStyle(el, '::after').content) === '"Taylor M."', 'New case’s patient list: Taylor M.');
  await p.evaluate(() => closeModal());
  await p.click('.topBar [data-act=phHide]'); await p.waitForTimeout(200);
  check(await p.$eval('.kc .pt .pnm', el => getComputedStyle(el.querySelector('.pnF')).display !== 'none' && getComputedStyle(el, '::after').content === 'none'), 'the eye again: full names back');

  const bad = errs.filter(e => !/Failed to load resource/.test(e));
  console.log(fails ? 'FAILURES' : 'ALL OK'); console.log('ERRORS: ' + (bad.length ? bad.join('\n') : 'none'));
  await browser.close(); process.exit(fails || bad.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
