// Case panel (Amir, 3 Oct 2026): every section folds to one line until tapped, Expand all (remembered on the computer),
// the patient's chief concern highlighted at the top, one IPR section drawing the IPR Tracker's chart, the chart note
// lower down with Copy on its folded heading — demo
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
const OUT = process.argv[2] || 'shots';
const URL0 = 'http://127.0.0.1:8765/nlo-cases.html?demo';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 }); await routes(ctx);
  const p = await ctx.newPage(); watch(p, errs, 'demo');
  await p.goto(URL0); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  let fails = 0; const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails++; };
  const state = () => p.$$eval('#drawer .ds', ss => ss.map(s => { const tg = s.querySelector('.dsTg'), bd = s.querySelector('.dsBd');
    return { k: s.dataset.ds, line: s.classList.contains('line'), open: s.classList.contains('open'), exp: tg.getAttribute('aria-expanded'), hidden: bd ? bd.hidden : null, vis: bd ? bd.offsetHeight > 0 : null, sum: (s.querySelector('.dsS') || {}).textContent || '' }; }));
  const allBtn = () => p.$eval('#drawer .dAll', b => ({ t: b.textContent.trim(), al: b.getAttribute('aria-label'), all: b.dataset.all }));
  const folded = st => st.filter(x => !x.line).every(x => !x.open && x.exp === 'false' && x.hidden === true && !x.vis);
  const opened = st => st.filter(x => !x.line).every(x => x.open && x.exp === 'true' && x.hidden === false && x.vis);
  const openCase = async id => { await p.evaluate(i => openDrawer(i), id); await p.waitForSelector('#drawer .dsList'); await p.waitForTimeout(120); };

  // the in-house refinement with a chart # (the demo's IPR Tracker answers for any chart #), with a chief concern and two comments
  // (set on the demo's stored copy too, so a save from the panel keeps them)
  const ref = await p.evaluate(() => { const c = openCases().find(x => x.chart === '15-1001');
    const x = { cc: 'Wants the gap between the front teeth closed', ipr: '', notes: 'Travels for work', comments: [{ id: 'k1', at: Date.now() - 7200e3, by: 'sarah', text: 'Submitted in the portal.' }, { id: 'k2', at: Date.now() - 600e3, by: 'gwen', text: 'Patient asked\nabout timing' }] };
    Object.assign(c, x); Object.assign(DEMO.cases.get(c.id), JSON.parse(JSON.stringify(x))); return c.id; });
  await openCase(ref);
  await p.waitForFunction(() => /visit ·/.test((document.querySelector('#dsS-ipr') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  let st = await state(); const sum = k => (st.find(x => x.k === k) || {}).sum || '';
  console.log('   sections:', st.map(x => x.k).join(' '));
  check(folded(st) && st.length === 9, 'a case opens with every section folded: heading only, aria-expanded=false, body hidden');
  check(st.map(x => x.k).join(',') === 'stage,details,aligners,instr,ipr,notes,comments,note,history', 'order: Stage, Details, Aligners, Dr. A’s instructions, IPR & spacing, Notes, Comments, Chart note (moved down), History');
  check(/^Thermoforming/.test(sum('stage')), 'Stage heading: the current stage (' + sum('stage') + ')');
  check(/^Assigned to \S+ · Lab /.test(sum('details')), 'Details heading: who it’s assigned to and the next date (' + sum('details') + ')');
  check(sum('aligners') === '18 aligners in this set (U 10 · L 8)', 'Aligners heading: this set’s count');
  check(sum('instr') === 'Close remaining spaces, improve bite.', 'Dr. A’s instructions heading: the instructions on one line');
  check(/^\w{3} \d{1,2} visit · IPR 0\.3 mm · 0\.8 mm so far · spaces 0\.5 mm · 2 black triangles$/.test(sum('ipr')), 'IPR heading: the latest visit in one line (' + sum('ipr') + ')');
  check(sum('notes') === 'Travels for work', 'Notes heading: the note');
  check(sum('comments') === '2 · Gwen: Patient asked about timing', 'Comments heading: how many, and the latest');
  check(/to paste into the patient’s chart/.test(sum('note')) && /^Last change /.test(sum('history')), 'Chart note and History headings');
  const cc = await p.evaluate(() => { const b = document.querySelector('#drawer .ccBox'), l = document.querySelector('#drawer .dsList');
    return b && { t: b.querySelector('.ccV').textContent, k: b.querySelector('.ccK').textContent, before: !!(b.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING), bg: getComputedStyle(b).backgroundColor, fs: parseFloat(getComputedStyle(b.querySelector('.ccV')).fontSize), h: b.offsetHeight, role: b.getAttribute('role') }; });
  check(cc && cc.h > 0 && cc.t === 'Wants the gap between the front teeth closed' && cc.before && cc.fs >= 16 && cc.bg === 'rgb(254, 242, 215)' && cc.role === 'note' && /chief concern/i.test(cc.k), 'the chief concern is highlighted at the top (pale yellow, larger type), above the sections, never folded');
  check(await p.evaluate(() => !/From the IPR Tracker|CC from last visit/.test(document.querySelector('#drawer').textContent) && !document.querySelector('#drawer .sec h5')), 'no separate “From the IPR Tracker” or old CC section any more');
  check(await p.isVisible('#drawer .dHd .sub .badge:has-text("Refinement")'), 'what the case is (Refinement) sits under the name, not in its own section');
  let ab = await allBtn(); check(ab.t === 'Expand all' && ab.al === 'Expand all sections' && ab.all === '0', 'header button: Expand all');
  // Copy works on the folded Chart note heading
  await p.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await p.click('#drawer .ds[data-ds=note] [data-act=copyNote]');
  await p.waitForFunction(() => window.__copied, null, { timeout: 3000 }).catch(() => {});
  check(await p.evaluate(id => window.__copied === chartNote(findCase(id)) && !document.querySelector('#drawer .ds[data-ds=note]').classList.contains('open'), ref), 'Copy on the folded Chart note heading copies the note without opening it');
  await p.screenshot({ path: OUT + '/v22-folded.png', clip: { x: 800, y: 0, width: 560, height: 1000 } });

  // IPR: one section, the IPR Tracker's chart
  await p.click('#drawer .ds[data-ds=ipr] .dsTg'); await p.waitForTimeout(150);
  const ipr = () => p.evaluate(() => { const s = document.querySelector('#drawer .ds[data-ds=ipr]'), ps = Array.from(s.querySelectorAll('.iprP'));
    return { open: s.classList.contains('open'), exp: s.querySelector('.dsTg').getAttribute('aria-expanded'), panels: ps.map(x => x.dataset.p), heads: ps.map(x => x.querySelector('.iprPH').textContent),
      svgs: ps.map(x => { const v = x.querySelector('svg'), r = v.getBoundingClientRect(), mid = v.querySelector('line.mid'), bt = Array.from(v.querySelectorAll('.bt'));
        return { w: r.width, h: r.height, vals: Array.from(v.querySelectorAll('text.v')).map(t => t.textContent), bt: bt.length, btX: bt.map(b => Number(b.getAttribute('points').split(/[ ,]/)[0])), midX: Number(mid.getAttribute('x1')), label: v.getAttribute('aria-label'), role: v.getAttribute('role'), teeth: v.querySelectorAll('path.tooth').length, nums: Array.from(v.querySelectorAll('text.tn')).map(t => t.textContent).join('') }; }),
      meta: (s.querySelector('.iprMeta') || {}).textContent || '', foot: (s.querySelector('.iprFoot') || {}).textContent || '', href: (s.querySelector('.iprFoot a') || {}).getAttribute ? s.querySelector('.iprFoot a').getAttribute('href') : '',
      w: s.getBoundingClientRect().width }; });
  let ir = await ipr(); console.log('   IPR panels:', ir.heads.join(' | '));
  check(ir.open && ir.exp === 'true' && (await state()).filter(x => x.k !== 'ipr').every(x => !x.open), 'tapping its heading opens just that section');
  check(/^Latest visit \w{3}, \w{3} \d{1,2} · 2 visits on file$/.test(ir.meta), 'latest visit and visits on file (' + ir.meta + ')');
  check(ir.panels.join(',') === 'visit,cum,space', 'panels: IPR this visit, IPR so far (2 visits), spaces & black triangles');
  check(ir.svgs.every(v => v.teeth === 28 && v.role === 'img' && v.nums === '7766554433221111223344556677' && v.w > 380 && v.h > 120), 'each panel draws all 28 teeth, numbered UR7…UL7 over LR7…LL7');
  check(ir.svgs[0].vals.join(' ') === '0.2 0.1' && /Lower 0\.3 mm · Total 0\.3 mm/.test(ir.heads[0]) && /Lower: LR3–LR2 0\.2mm, LL1–LL2 0\.1mm/.test(ir.svgs[0].label), 'this visit: the amounts at LR3–LR2 and LL1–LL2 (and in words for screen readers)');
  check(ir.svgs[1].vals.join(' ') === '0.2 0.2 0.2 0.1 0.1' && /2 visits/.test(ir.heads[1]) && /Total 0\.8 mm/.test(ir.heads[1]), 'so far: both visits added up');
  check(ir.svgs[2].vals.join(' ') === '0.3 0.2' && ir.svgs[2].bt === 2 && ir.svgs[2].btX.every(x => Math.abs(x - ir.svgs[2].midX) < 0.01) && /2 black triangles/.test(ir.heads[2]) && /Black triangles: UR1–UL1, LR1–LL1/.test(ir.svgs[2].label), 'spaces: 0.3 upper midline, 0.2 lower; ▼ at both midline contacts');
  check(/Add to the chart note/.test(ir.foot) && /Refresh/.test(ir.foot) && ir.href === 'IPR_Tracker.html', 'Add to the chart note, Refresh, Open IPR Tracker');
  await (await p.$('#drawer .ds[data-ds=ipr]')).screenshot({ path: OUT + '/v22-ipr.png' });
  await p.click('#drawer [data-act=iprUse]');
  await p.waitForFunction(id => /IPR & spacing: IPR THIS VISIT/.test(chartNote(findCase(id))), ref, { timeout: 5000 }).catch(() => {});
  await p.waitForSelector('#iprBox .stat:has-text("In the chart note")', { timeout: 5000 }).catch(() => {});
  ir = await ipr();
  check(/In the chart note/.test(ir.foot) && ir.open && /IPR & spacing: IPR THIS VISIT/.test(await p.textContent('#noteTxt')), '“Add to the chart note” puts the visit in the chart note; the section stays open');
  check((await state()).filter(x => x.k !== 'ipr').every(x => !x.open), 'the redraw after saving keeps the other sections folded');

  // keyboard
  await p.focus('#drawer .ds[data-ds=details] .dsTg'); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
  const kb1 = (await state()).find(x => x.k === 'details').open; await p.keyboard.press('Space'); await p.waitForTimeout(80);
  check(kb1 && !(await state()).find(x => x.k === 'details').open, 'Enter opens a section, Space folds it again (keyboard)');

  // a comment from this panel: Comments stays open through the redraw, and the new comment shows
  await p.click('#drawer .ds[data-ds=comments] .dsTg'); await p.fill('#cmtText', 'Called the lab'); await p.click('[data-act=addCmt]');
  await p.waitForSelector('#drawer .cmt:has-text("Called the lab")', { timeout: 5000 }).catch(() => {});
  st = await state();
  check(st.find(x => x.k === 'comments').open && await p.isVisible('#drawer .cmt:has-text("Called the lab")') && /^3 · /.test(st.find(x => x.k === 'comments').sum), 'after adding a comment the section stays open (and its heading counts 3)');

  // the next case opens folded again
  const mpRec = await p.evaluate(() => openCases().find(c => c.type === 'marpe' && c.stage === 'records').id);
  await openCase(mpRec); st = await state();
  check(folded(st) && (await allBtn()).t === 'Expand all', 'the next case opens folded again');
  check(st.find(x => x.k === 'marpe').sum === 'Needs CBCT · Zoom not set', 'MARPE heading: what’s missing and the Zoom call (' + st.find(x => x.k === 'marpe').sum + ')');
  check(await p.evaluate(() => !document.querySelector('#drawer .ds[data-ds=ipr]') && !document.querySelector('#drawer .ccBox')), 'no IPR section on a MARPE, no chief-concern box when there isn’t one');

  // Expand all: every section, remembered for the next case and after a reload, until Collapse all
  await p.click('#drawer [data-act=dsAll]'); await p.waitForTimeout(100);
  st = await state(); ab = await allBtn();
  check(opened(st) && ab.t === 'Collapse all' && ab.all === '1', 'Expand all opens every section and turns into Collapse all');
  check(await p.isVisible('#drawer #mpBox .pick[data-k=cbct]'), 'MARPE: the records can be ticked once it’s open');
  check(await p.evaluate(() => localStorage.getItem('nloCases.panelOpen')) === 'all', 'Expand all is remembered on this computer');
  const ret = await p.evaluate(() => openCases().find(c => c.type === 'retainer').id);
  await openCase(ret); st = await state();
  check(opened(st), 'the next case opens with everything open too');
  check(st.find(x => x.k === 'label').line && await p.isVisible('#retLblBox [data-act=retLabels]'), 'retainers: Print label is one tap on its own line');
  await p.click('#drawer .ds[data-ds=stage] .dsTg'); await p.waitForTimeout(60);
  check(!(await state()).find(x => x.k === 'stage').open && (await allBtn()).t === 'Expand all', 'folding one section by hand turns the button back into Expand all');
  await p.reload(); await p.click('#lgBtn'); await p.waitForSelector('.tiles');
  await openCase(ref);
  check(opened(await state()), 'after a reload, cases still open with everything open');
  await p.click('#drawer [data-act=dsAll]'); await p.waitForTimeout(100);
  check(folded(await state()) && await p.evaluate(() => localStorage.getItem('nloCases.panelOpen')) === null, 'Collapse all folds everything and forgets Expand all');
  await openCase(ret); st = await state();
  check(folded(st) && await p.isVisible('#retLblBox [data-act=retLabels]'), 'the next case is folded again — Print label still one tap');
  await p.click('#retLblBox [data-act=retLabels]'); await p.waitForSelector('#modalWrap .modal:has-text("Retainer labels")', { timeout: 3000 }).catch(() => {});
  check(await p.isVisible('#modalWrap .modal:has-text("Retainer labels")'), 'Print label opens the label window from the folded panel');
  await p.click('#modalWrap [data-act=closeModal]');

  // a chief concern of "None" stays quiet; an older case's typed IPR note shows when there's no chart # to read
  const old = await p.evaluate(() => { const c = openCases().find(x => x.type === 'oliv' && x.ipr && !x.chart); c.cc = 'None'; DEMO.cases.get(c.id).cc = 'None'; return c.id; });
  await openCase(old);
  const none = await p.evaluate(() => { const b = document.querySelector('#drawer .ccBox'); return b && { none: b.classList.contains('none'), t: b.querySelector('.ccV').textContent, bg: getComputedStyle(b).backgroundColor }; });
  check(none && none.none && none.t === 'None' && none.bg !== 'rgb(254, 242, 215)', 'a chief concern of “None” shows plainly (not highlighted)');
  st = await state();
  check(st.find(x => x.k === 'ipr').sum === 'UR2–UR1 0.1mm, UR1–UL1 0.1mm', 'no chart #: the IPR heading shows the note typed on the case');
  await p.click('#drawer .ds[data-ds=ipr] .dsTg');
  check(/Add the chart #/.test(await p.textContent('#iprBox')) && /IPR note saved on the case/.test(await p.textContent('#iprBox .iprSaved')), 'and the section says to add the chart #, with the saved note under it');

  // phone: no sideways scrolling, the button is just its icon, the diagram fits
  await p.setViewportSize({ width: 390, height: 844 }); await openCase(ref);
  await p.click('#drawer .ds[data-ds=ipr] .dsTg'); await p.waitForTimeout(150);
  const ph = await p.evaluate(() => { const d = document.querySelector('#drawer'), b = d.querySelector('.dAll'), sv = d.querySelector('.iprSvg').getBoundingClientRect(), bd = d.querySelector('.dBd');
    return { over: bd.scrollWidth - bd.clientWidth, docOver: document.documentElement.scrollWidth - 390, txt: getComputedStyle(b.querySelector('.t')).display, al: b.getAttribute('aria-label'), svR: sv.right, svW: sv.width, w: d.getBoundingClientRect().width }; });
  check(ph.over <= 0 && ph.docOver <= 0 && ph.svR <= ph.w && ph.svW > 300, 'phone: no sideways scrolling; the IPR chart fits (' + Math.round(ph.svW) + 'px)');
  check(ph.txt === 'none' && ph.al === 'Expand all sections', 'phone: Expand all is just its icon (still named for screen readers)');
  await p.screenshot({ path: OUT + '/v22-phone.png' });
  console.log(fails ? 'FAILURES: ' + fails : 'ALL OK');
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
