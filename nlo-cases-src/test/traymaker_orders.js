// The Tray Maker's orders as the lab PC reports them (20 Oct 2026 — Amir: "orders that go from tray maker/bleaching tray to
// orthofactory gets flagged in case tracker as orders that don't match anyone ... The point is to automatically move them to
// printing"). Demo mode, made-up patients: the Tray Maker's retainers, whitening trays and mouthguards never wait on Today, the
// case waiting at To make for them moves to Printing once (the Tray Maker's note, or the lab PC seeing its order; its window's
// message only notes the models), and in-house aligner orders are asked about - and matched - as before.
// Run with a static server on :8765 serving dist/:  node test/traymaker_orders.js
const { chromium } = require('playwright');
const { routes, watch } = require('./helpers');
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await routes(ctx);
  const page = await ctx.newPage(); watch(page, errs, 'demo');
  await page.goto('http://127.0.0.1:8765/nlo-cases.html?demo');
  await page.click('#lgBtn'); await page.waitForSelector('.tiles');
  await page.waitForFunction(() => !MAILS.busy && typeof LABS !== 'undefined', null, { timeout: 10000 });

  // ---------- the cases (made up), then one lab PC message with the orders
  const ids = await page.evaluate(async () => {
    const mk = o => B.createCase(Object.assign({ comments: [], createdAt: Date.now() - 3600e3, createdBy: meSid(), scanDate: todayISO(), assignee: meSid() }, o));
    const ret = (patient, kinds, extra) => mk(Object.assign({ type: 'retainer', patient, arches: ['Upper', 'Lower'], retKinds: kinds, stage: 'print' }, extra || {}));
    const T0 = Date.now() - 60e3; // (the old tab message's note, saved a minute ago)
    const out = {
      wendy: await ret('Wendy Whitener', ['WT’s']),
      rita: await ret('Rita Retainer', ['TT’s']),
      milo: await mk({ type: 'mouthguard', patient: 'Milo Guard', arches: ['Upper'], retKinds: [], stage: 'print' }),
      noraNla: await mk({ type: 'nla', patient: 'Nora Both', initial: 'yes', stage: 'txpok' }),
      noraRet: await ret('Nora Both', ['TT’s', 'WT’s'], { stage: 'printing' }),
      paulNla: await mk({ type: 'nla', patient: 'Paul Aligner', initial: 'yes', stage: 'txpok' }),
      kim: await ret('Kim Kinds', ['TT’s']),
      tia1: await ret('Tia Twin', ['WT’s']), tia2: await ret('Tia Twin', ['WT’s']),
      lee: await ret('Lee Legacy', ['WT’s'], { btModels: { at: T0, models: ['upper WT'] } }),          // noted by the old tab message, never moved
      bea: await ret('Bea Backagain', ['WT’s'], { btModels: { at: T0, models: ['upper WT'], how: 'orthofactory' } }), // moved back by hand
      tab1: await ret('Tab First', ['WT’s']), note1: await ret('Note First', ['WT’s']), same: await ret('Same Sync', ['WT’s']),
      hank: await ret('Hank Handback', ['WT’s']),                                                       // saved after the order was exported
      niaNla: await mk({ type: 'nla', patient: 'Nia Inhouse', initial: 'yes', stage: 'txpok' }), niaRet: await ret('Nia Inhouse', ['TT’s', 'WT’s']),
      tabOnly: await ret('Tabby Only', ['WT’s'])
    };
    out.T0 = T0; return out;
  });
  await page.waitForFunction(ids => Object.entries(ids).every(([k, id]) => k === 'T0' || S.cases.has(id)), ids, { timeout: 10000 });

  const orders = await page.evaluate(async ({ T0 }) => {
    const iso = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
    const cnt = (n, at, tr) => ({ n, atTrimmer: at || 0, trimmed: tr || 0 }), now = Date.now();
    // the lab PC's reading of an order: names, number, pieces (lv: one character per piece number, '-' for none)
    const o = (key, pid, first, last, lv, extra) => {
      const count = s => Array.from(s || '').filter(ch => ch !== '-').length;
      const au = count(lv.au), al = count(lv.al), tu = count(lv.tu), tl = count(lv.tl);
      return Object.assign({ key, pid, rev: key.slice(-1), first, last, ordered: iso(now - 60e3), due: '', au, al, tu, tl, a: cnt(au + al), t: cnt(tu + tl), lv, act: now - 30e3 }, extra || {});
    };
    const list = [
      o('125310001A', '125310001', 'Wendy', 'Whitener', { tu: '0', tl: '0' }),               // whitening trays, the Tray Maker's number
      o('80123B', '80123', 'Rita', 'Retainer', { al: '-0' }),                                    // a lower retainer under the Edge ID typed in
      o('125310003A', '125310003', 'Milo', 'Guard', { tu: '--0' }),                              // a mouthguard
      o('125310004A', '125310004', 'Nobody', 'Here', { tu: '0' }),                               // nobody's: not asked about
      o('77001A', '77001', 'Ian', 'Inhouse', { au: '-0000', al: '-0000' }),                       // an in-house set nobody has: asked about
      o('77002A', '77002', 'Tina', 'Templates', { tu: '0' }),                                    // templates alone (Titan), no retainer case: asked about
      o('125310007A', '125310007', 'Nora', 'Both', { au: '-0', tu: '0' }),                       // the Tray Maker's, the patient also has an in-house set
      o('125310008A', '125310008', 'Paul', 'Aligner', { tu: '0' }),                              // the Tray Maker's, only an in-house set here
      o('125310009A', '125310009', 'Kim', 'Kinds', { tu: '0' }),                                 // whitening, the case makes retainers: not moved
      o('125310010A', '125310010', 'Tia', 'Twin', { tu: '0' }),                                  // two cases it could be: not moved
      o('125310011A', '125310011', 'Lee', 'Legacy', { tu: '0' }, { ordered: iso(T0 - 30e3) }),   // the send the old tab message noted
      o('125310012A', '125310012', 'Bea', 'Backagain', { tu: '0' }, { ordered: iso(T0 - 30e3) }), // noted the new way, then moved back
      o('2610201130A', '2610201130', 'Wendy', 'Whitener', { tu: '0' }),                          // the Tray Maker's numbers before 19 Oct
      o('125310013A', '125310013', 'Hank', 'Handback', { tu: '0' }, { ordered: iso(now - 10 * 60e3) }), // exported before the case was last saved
      o('77003A', '77003', 'Nia', 'Inhouse', { au: '-0', al: '-0', tu: '0', tl: '0' })            // one aligner a side + templates: the in-house set's
    ];
    DEMO.mail.inbox.push({ id: 'mlabTM', at: now - 5000, done: [], mail: { lab: 1, v: 2, src: 'Lab PC', pc: 'LAB', ver: '2.1', at: now, orders: list.map(x => Object.assign(x, { at: now - 5000 })) } });
    return list.map(x => x.key);
  }, { T0: ids.T0 });

  const sync = () => page.evaluate(async () => { await mailSync(); for (let i = 0; i < 100 && (MAILS.busy || MAILS.again); i++) await new Promise(r => setTimeout(r, 50)); await new Promise(r => setTimeout(r, 300)); });
  await sync();
  const st = await page.evaluate(ids => {
    const c = id => findCase(id) || {}, logs = id => DEMO.logs.filter(l => l.caseId === id && l.a === 'bt');
    return { wait: LABS.list.map(x => x.o.key), stage: Object.fromEntries(Object.entries(ids).filter(([k]) => k !== 'T0').map(([k, id]) => [k, c(id).stage])),
      bt: Object.fromEntries(Object.entries(ids).filter(([k]) => k !== 'T0').map(([k, id]) => [k, logs(id)])), wendyBt: c(ids.wendy).btModels, noraNla: c(ids.noraNla).labOrd || null, paulNla: c(ids.paulNla).labOrd || null, niaNla: c(ids.niaNla).labOrd || null,
      left: (DEMO.mail.inbox.find(d => d.id === 'mlabTM') || { done: [] }).done.slice().sort((x, y) => x - y) };
  }, ids);
  const tm = ['125310001A', '80123B', '125310003A', '125310004A', '125310007A', '125310008A', '125310009A', '125310010A', '125310011A', '125310012A', '2610201130A', '125310013A'];
  check(!st.wait.some(k => tm.includes(k)), 'Today: none of the Tray Maker’s orders asks which case it is (' + st.wait.join(', ') + ')');
  check(st.wait.includes('77001A') && st.wait.includes('77002A'), 'Today: an in-house set nobody has, and templates alone with no retainer case, are still asked about');
  check(st.stage.wendy === 'printing' && st.stage.milo === 'printing', 'whitening trays and a mouthguard under the Tray Maker’s numbers: their cases moved from To make to Printing (' + [st.stage.wendy, st.stage.milo] + ')');
  check(st.stage.rita === 'print' && st.bt.rita.length === 0, 'a retainer under an Edge ID typed in (could be Titan’s one aligner): let go without asking, and nothing moves on it');
  check(st.stage.hank === 'print', 'an order exported before the case was last saved (moved on and put back, or a remake) doesn’t move it');
  check(st.niaNla && st.niaNla.key === '77003A' && st.stage.niaRet === 'print' && st.bt.niaRet.length === 0, 'one aligner a side + templates under a few-digit number: the patient’s in-house set takes it, as before; her retainer case isn’t touched');
  check(st.bt.wendy.length === 1 && st.bt.wendy[0].lab === 1 && st.bt.wendy[0].to === 'printing' && JSON.stringify(st.bt.wendy[0].models) === '["upper WT","lower WT"]', 'history: one Lab PC entry for Wendy — the models it saw, moved to Printing (' + JSON.stringify(st.bt.wendy) + ')');
  check(st.wendyBt && st.wendyBt.how === 'orthofactory' && st.wendyBt.key === '125310001A', 'the case notes the models (in OrthoFactory, the order #) — the second Wendy order (old numbering) changed nothing more');
  check(!st.noraNla && !st.paulNla, 'the Tray Maker’s orders never land on an in-house aligner case (Nora also has a retainer case, Paul only an in-house set)');
  check(st.stage.noraRet === 'printing' && st.bt.noraRet.length === 0, 'a retainer case already at Printing isn’t touched');
  check(st.stage.kim === 'print' && st.stage.tia1 === 'print' && st.stage.tia2 === 'print', 'not moved: a case that makes something else (Kim), two cases it could be (Tia)');
  check(st.stage.lee === 'printing' && st.bt.lee.length === 1, 'a case the old tab message noted without moving (Lee) moves on with its own order');
  check(st.stage.bea === 'print' && st.bt.bea.length === 0, 'a case noted the new way and then put back at To make by hand (Bea) stays where it was put');
  check(JSON.stringify(st.left) === JSON.stringify([0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14]), 'the lab PC’s message: every Tray Maker order in it is done; it stays only for the two waiting on Today (' + JSON.stringify(st.left) + ')');

  // ---------- the Tray Maker window's message (Make models) only notes the models; the note, or the lab PC, moves the case - once
  const race = await page.evaluate(async ids => {
    const tabMsg = id => window.dispatchEvent(new MessageEvent('message', { origin: 'http://lab:8765', data: { nlo: 'bleachtray', event: 'sent', case: id, models: ['upper WT', 'lower WT'] } }));
    const note = (id, at) => DEMO.mail.inbox.push({ id: 'mbt' + id + at, at: Date.now(), done: [], mail: { bt: 1, v: 1, case: id, patient: '', models: ['upper WT', 'lower WT'], at, pc: 'LAB', how: 'orthofactory' } });
    const settle = async () => { await new Promise(r => setTimeout(r, 400)); await mailSync(); for (let i = 0; i < 100 && (MAILS.busy || MAILS.again); i++) await new Promise(r => setTimeout(r, 50)); await new Promise(r => setTimeout(r, 300)); };
    const now = Date.now();
    tabMsg(ids.tab1); await settle(); const tabStage = (findCase(ids.tab1) || {}).stage; note(ids.tab1, now - 3000); await settle(); // the window first, then the note (a little older)
    note(ids.note1, Date.now() - 1000); await settle(); tabMsg(ids.note1); await settle(); // the note first, then the tab
    // the note and the lab PC's report of the same order in one look: the note's move, nothing from the lab PC
    note(ids.same, Date.now() - 2000);
    const d = new Date(Date.now() - 60e3), p = n => String(n).padStart(2, '0'), ordered = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    DEMO.mail.inbox.push({ id: 'mlabSame', at: Date.now(), done: [], mail: { lab: 1, v: 2, src: 'Lab PC', pc: 'LAB', ver: '2.1', at: Date.now(), orders: [{ key: '125310020A', pid: '125310020', rev: 'A', first: 'Same', last: 'Sync', ordered, au: 0, al: 0, tu: 1, tl: 1, a: { n: 0, atTrimmer: 0, trimmed: 0 }, t: { n: 2, atTrimmer: 0, trimmed: 0 }, lv: { tu: '0', tl: '0' }, act: Date.now(), at: Date.now() }] } });
    await settle();
    // no Tray Maker link: the window's message notes the models, and the lab PC seeing the order (that very send) moves the case
    tabMsg(ids.tabOnly); await settle(); const tabAt = ((findCase(ids.tabOnly) || {}).btModels || {}).at || Date.now();
    const d2 = new Date(tabAt - 30e3), ordered2 = d2.getFullYear() + '-' + p(d2.getMonth() + 1) + '-' + p(d2.getDate()) + 'T' + p(d2.getHours()) + ':' + p(d2.getMinutes()) + ':' + p(d2.getSeconds());
    DEMO.mail.inbox.push({ id: 'mlabTab', at: Date.now(), done: [], mail: { lab: 1, v: 2, src: 'Lab PC', pc: 'LAB', ver: '2.1', at: Date.now(), orders: [{ key: '125310021A', pid: '125310021', rev: 'A', first: 'Tabby', last: 'Only', ordered: ordered2, au: 0, al: 0, tu: 1, tl: 0, a: { n: 0, atTrimmer: 0, trimmed: 0 }, t: { n: 1, atTrimmer: 0, trimmed: 0 }, lv: { tu: '0' }, act: Date.now(), at: Date.now() }] } });
    await settle();
    const c = id => findCase(id) || {}, logs = id => DEMO.logs.filter(l => l.caseId === id && l.a === 'bt');
    return { tab1: [c(ids.tab1).stage, logs(ids.tab1), c(ids.tab1).btModels, tabStage], note1: [c(ids.note1).stage, logs(ids.note1)], same: [c(ids.same).stage, logs(ids.same)],
      tabOnly: [c(ids.tabOnly).stage, logs(ids.tabOnly)], left: DEMO.mail.inbox.filter(x => /^mbt|^mlabSame|^mlabTab/.test(x.id)).length, wait: LABS.list.map(x => x.o.key) };
  }, ids);
  check(race.tab1[3] === 'print' && race.tab1[0] === 'printing' && race.tab1[1].length === 2 && race.tab1[1][0].tab === 1 && !race.tab1[1][0].to && race.tab1[1][1].to === 'printing' && !race.tab1[2].tab,
    'Make models: the window’s message only notes the models; the Tray Maker’s note right after (a little older) still moves the case to Printing — the bug was that it was dropped (' + JSON.stringify(race.tab1[1].map(l => [l.tab || 0, l.to || ''])) + ')');
  check(race.note1[0] === 'printing' && race.note1[1].length === 1 && !race.note1[1][0].lab, 'the note first, then the window’s message: moved once, by the note; the message adds nothing');
  check(race.tabOnly[0] === 'printing' && race.tabOnly[1].length === 2 && race.tabOnly[1][1].lab === 1 && race.tabOnly[1][1].to === 'printing', 'no Tray Maker link: the window’s message notes the models, then the lab PC seeing that order moves the case to Printing');
  check(race.same[0] === 'printing' && race.same[1].length === 1 && !race.same[1][0].lab && !race.wait.includes('125310020A'), 'the note and the lab PC’s report in one look: the note moves it; the report adds nothing and isn’t asked about');
  check(race.left === 0, 'the notes and the lab PC’s messages have all left the inbox');
  check(!race.wait.includes('125310021A'), 'and none of them is asked about on Today');

  // ---------- what the case shows: the history line, and the activity list
  await page.evaluate(id => openDrawer(id), ids.wendy).catch(() => { });
  await page.waitForSelector('#histBox .hist', { timeout: 10000 }).catch(() => { });
  const hist = await page.textContent('#histBox').catch(() => '');
  check(/Lab PC saw the Tray Maker’s models in OrthoFactory \(upper WT, lower WT\) and moved it to Printing/.test(hist), 'Wendy’s history: “Lab PC saw the Tray Maker’s models in OrthoFactory (upper WT, lower WT) and moved it to Printing”');
  const mark = await page.evaluate(() => { const b = document.querySelector('#drawer .step[data-k=printing] .stWhen'); return b ? b.textContent : null; });
  check(mark !== null && /Lab PC/.test(mark), 'the case’s steps: Printing is dated and says “Lab PC” (' + JSON.stringify(mark) + ')');

  // ---------- the pure parts: which orders are the Tray Maker's
  const kinds = await page.evaluate(() => {
    const k = (pid, lv) => tmKind({ pid, lv });
    return [k('125300000', { tu: '0' }), k('80010', { tu: '0' }), k('80010', { al: '-0' }), k('80010', { au: '---0' }), k('80010', { tu: '--0' }), k('2610191015', { au: '-0', tu: '0' }),
      k('80010', { au: '-00', al: '-00' }), k('80010', { au: '-0000000000', tu: '0', tl: '0' }), k('125300000', { au: '-00' }), k('80010', {}), k('80010', { tu: '-0' })];
  });
  check(JSON.stringify(kinds) === JSON.stringify(['yes', 'maybe', 'maybe', 'maybe', 'yes', 'yes', '', '', '', '', '']), 'tmKind: the Tray Maker’s own numbers or a mouthguard are its for sure; its other pieces under a few-digit number only maybe; a set of aligners or a template at 1 never (' + JSON.stringify(kinds) + ')');

  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  if (errs.length) fails++;
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
