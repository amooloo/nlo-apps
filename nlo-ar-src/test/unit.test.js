/* Unit tests: the Edge report reader (made-up .xls/.xlsx/clipboard exports, see make_fixtures.py), the worklist rules,
   the summary and "what changed" numbers, working an account, office days, and the sealing helpers.
   Run: node test/unit.test.js */
const fs = require('fs'), path = require('path');
const { load } = require('./load');
const A = load(['core.js', 'edge.js', 'ar.js']);
const FX = path.join(__dirname, 'fixtures'), EXP = JSON.parse(fs.readFileSync(path.join(FX, 'expected.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : '\n       got      ' + JSON.stringify(a) + '\n       expected ' + JSON.stringify(b)));
const section = s => console.log('# ' + s);
const ROWKEYS = ['patient', 'sts', 'rp', 'home', 'work', 'due', 'b0', 'b30', 'b60', 'b90', 'days', 'bal', 'lastAmt', 'recv', 'note'];
const pick = r => { const o = {}; ROWKEYS.forEach(k => { o[k] = r[k] === undefined ? null : r[k]; }); return o; };
const row = o => Object.assign({ patient: 'Avery Sample', sts: 'A-Comp Bra', rp: 'Jordan Sample', home: '', work: '', due: 0, b0: 0, b30: 0, b60: 0, b90: 0, days: null, bal: 0, lastAmt: null, recv: '', note: '' }, o);
const cfg = A.arCfg({});

(async () => {
  section('Reading Edge exports');
  for (const [file, kind] of [['edge-full.xls', 'xls'], ['edge-full.xlsx', 'xlsx'], ['edge-full.tsv', 'text'], ['edge-full.html', 'text']]) {
    const p = await A.readEdgeAR(file, fs.readFileSync(path.join(FX, file)));
    ok(p.kind === kind, file + ': read as ' + kind + ' (got ' + p.kind + ')');
    ok(p.rows.length === EXP.full.rows.length, file + ': ' + p.rows.length + ' accounts read of ' + EXP.full.rows.length);
    let bad = 0, first = '';
    EXP.full.rows.forEach((e, i) => { const g = pick(p.rows[i] || {}); ROWKEYS.forEach(k => { if (JSON.stringify(g[k]) !== JSON.stringify(e[k])) { bad++; if (!first) first = 'row ' + i + ' ' + k + ': ' + JSON.stringify(g[k]) + ' ≠ ' + JSON.stringify(e[k]); } }); });
    ok(bad === 0, file + ': every field of every account matches (' + bad + ' differ' + (first ? '; first: ' + first : '') + ')');
    ok(p.meta.asOf === '2026-10-05' && p.meta.subgroup === 'None' && p.meta.options === 'Exclude Zero Dollar Balances' && p.meta.edge === '7.2.3.20006', file + ': date, subgroup, options, Edge version: ' + JSON.stringify(p.meta));
    if (kind === 'xls' || kind === 'xlsx') ok(p.meta.stamp === '2026-10-05', file + ': the run time on the title line is read as a date');
    ok(p.check.ok === true, file + ': adds up to Edge’s total line — ' + p.check.why);
  }
  {
    const p = await A.readEdgeAR('edge-pastdue-noins.xls', fs.readFileSync(path.join(FX, 'edge-pastdue-noins.xls')));
    eq(p.rows.map(pick), EXP.pastdue.rows, 'second export (Past Due subgroup, no insurance): every account');
    const c = A.coverOf(p.meta);
    eq([c.full, c.pastDue, c.credit, c.ins], [false, true, false, false], 'it covers past due only, without insurance');
  }
  // a damaged total: the check says so
  {
    const p = await A.readEdgeAR('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls')));
    p.rows.pop(); const c = A.checkTotals(p);
    ok(c.ok === false && /319 accounts read, Edge says 320/.test(c.why), 'a missing account is caught by Edge’s total line: ' + c.why);
  }
  // not a report / a PDF
  try { await A.readEdgeAR('x.csv', new TextEncoder().encode('Name,Phone\nA,1\n')); ok(false, 'a random CSV is refused'); } catch (e) { ok(e.code === 'not-ar', 'a random CSV is refused (' + e.code + ')'); }
  try { await A.readEdgeAR('x.pdf', new TextEncoder().encode('%PDF-1.4 ...')); ok(false, 'a PDF is refused'); } catch (e) { ok(e.code === 'pdf', 'a PDF is refused with a hint to export to Excel'); }
  // a shifted note never becomes an amount or a date
  {
    const grid = [['Accounts Receivable Aging'], ['Monday, October 5, 2026  Office: All'], [],
      ['Patient', 'Sts', 'Responsible Party', null, 'Home Ph', 'Work Ph', 'Amt Due', '0-30', '31-60', '61-90', '91+', null, 'Days', null, 'Balance', null, 'Last Amt', 'Received'],
      ['Avery Sample', 'A-Comp Bra', null, 'Jordan Sample', '(352) 555-0101', null, '22.22', '11.11', '11.11', '0', '0', null, '33', null, '400.00', null, null, null, 'Payment in process'],
      ['(1 Patients)', null, null, null, null, null, '22.22', '11.11', '11.11', '0', '0', null, null, null, '400.00']];
    const p = A.parseARGrid(grid, false);
    eq([p.rows[0].rp, p.rows[0].recv, p.rows[0].note, p.rows[0].days], ['Jordan Sample', '', 'Payment in process', 33], 'a value one column right of its heading is kept; a note past the last heading stays a note');
    ok(A.checkTotals(p).ok === true, 'and the totals still check');
  }
  eq(['$1,234.50', '(12.00)', '12.00-', '−5', '', 'abc', 7].map(A.toNum), [1234.5, -12, -12, -5, null, null, 7], 'amounts: $, commas, (negative), trailing minus');
  eq([46300, '10/5/2026', '2026-10-05', '10/5/26'].map(v => A.toISODate(v)), ['2026-10-05', '2026-10-05', '2026-10-05', '2026-10-05'], 'dates: Excel serial, M/D/YYYY, ISO, M/D/YY');

  section('Building the saved report');
  const full = await A.readEdgeAR('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls')));
  const rep = A.buildReport([full]);
  const keep = EXP.full.rows.filter(r => r.due > 0.004 || r.bal < -0.004);
  ok(rep.rows.length === keep.length, 'only accounts past due or in credit are kept: ' + rep.rows.length + ' of ' + full.rows.length);
  eq(rep.cover, { full: true, pastDue: true, credit: true, ins: true }, 'a full report covers everything');
  const sum = (l, k) => A.round2(l.reduce((s, r) => s + (r[k] || 0), 0)), ins = EXP.full.rows.filter(r => /^\s*ins\s*:/i.test(r.rp));
  const actN = l => l.filter(r => !/^inact/i.test(String(r.sts || '').trim())).length, ptRows = EXP.full.rows.filter(r => !/^\s*ins\s*:/i.test(r.rp));
  eq(rep.book, { n: 320, bal: sum(EXP.full.rows, 'bal'), due: sum(EXP.full.rows, 'due'), pt: { n: 320 - ins.length, bal: A.round2(sum(EXP.full.rows, 'bal') - sum(ins, 'bal')), act: actN(ptRows) }, ins: { n: ins.length, bal: sum(ins, 'bal'), act: actN(ins) } },
    'the whole book’s totals are kept (all 320 accounts, and how many aren’t Inactive)');
  ok(new Set(rep.rows.map(r => r.key)).size === rep.rows.length, 'every account has its own key');
  ok(rep.warn.length === 0, 'no warnings for a full report');
  {
    const meta = (sg, opt, d) => ({ title: 'Accounts Receivable Aging', asOf: d || '2026-10-05', subgroup: sg, options: opt || 'Exclude Zero Dollar Balances' });
    const pdF = { meta: meta('Past Due'), rows: [row({ patient: 'Quinn Example', due: 50, b0: 50, bal: 500 }), row({ patient: 'Quinn Example', due: 75, b0: 75, bal: 700 })] };
    const crF = { meta: meta('Credit Balance'), rows: [row({ patient: 'Riley Demo', due: -40, bal: -40 }), row({ patient: 'Quinn Example', due: 50, b0: 50, bal: 500 })] };
    const r2 = A.buildReport([pdF, crF]);
    eq(r2.cover, { full: false, pastDue: true, credit: true, ins: true }, 'Past Due + Credit Balance files together cover both lists');
    eq(r2.rows.map(r => r.key), ['quinn example|jordan sample|P', 'quinn example|jordan sample|P#2', 'riley demo|jordan sample|P'], 'two contracts for the same patient and payer stay two accounts; one in both files counts once');
    ok(r2.book === null && r2.warn.length === 0, 'no whole-book totals from subgroups, no warnings');
    const r3 = A.buildReport([pdF, { meta: meta('Credit Balance', '', '2026-10-01'), rows: [] }]);
    ok(r3.warn.some(w => /different days/.test(w)), 'files from different days: warned');
    const r4 = A.buildReport([{ meta: meta('None', 'Exclude Zero Dollar Balances, Exclude Insurance Contracts'), rows: [row({ due: 20, b0: 20 })] }]);
    ok(r4.cover.ins === false && r4.warn.some(w => /Insurance contracts were left out/.test(w)), 'insurance left out: warned, and the insurance lists won’t use it');
    const r5 = A.buildReport([pdF]);
    ok(r5.warn.some(w => /credit balances won’t be updated/.test(w)), 'past due only: warned that credits won’t update');
  }

  section('One account: Dr. A’s rule and the suggestions');
  const ia = o => A.acctOf(row(Object.assign({ rp: 'INS: Jordan Sample' }, o)), cfg, '2026-10-05');
  eq([ia({ due: 44.44, b90: 11.11 }).months, ia({ due: 44.45 }).months, ia({ due: 11.11 }).months, ia({ due: 0 }).months, A.acctOf(row({ due: 44.44 }), cfg, '2026-10-05').months],
    [4, 0, 1, 0, 0], 'insurance past due = N × $11.11 → N months with nothing paid (only insurance, only exact)');
  eq(A.acctOf(row({ rp: 'INS: X', due: 37.5 }), A.arCfg({ ar: { inst: 12.5 } }), '2026-10-05').months, 3, 'the instalment can be changed in Settings');
  eq([60, 61, 120, 121, 365, 366].map(d => A.tierOf(d, cfg)), ['monitor', 'chase', 'chase', 'investigate', 'investigate', 'nofile'], 'triage by days: ≤60 monitor, ≤120 chase, ≤365 investigate, older never filed');
  eq([row({ due: 10, b90: 10 }), row({ due: 10, b60: 10 }), row({ due: 10, b30: 10 }), row({ due: 10, b0: 10 }), row({ bal: -5, due: -5 })].map(r => A.acctOf(r, cfg, '2026-10-05').bucket), ['91', '31', '31', '0', ''], 'buckets: 91+, 31–90, 0–30, none');
  eq([A.creditOf(row({ bal: -50, due: 0 })), A.creditOf(row({ bal: null, due: -20 })), A.creditOf(row({ bal: 10, due: 5 }))], [50, 20, 0], 'credit from the balance, else from Amt Due');
  const pa = o => A.pdAction(A.acctOf(row(o), cfg, '2026-10-05'), cfg).k;
  eq([pa({ due: 99.99, b90: 99.99 }), pa({ due: 300, b90: 300, rp: 'INS: X' }), pa({ due: 300, b90: 300, sts: 'Inactive' }), pa({ due: 300, b90: 300 }), pa({ due: 50, b30: 50, rp: 'INS: X' }), pa({ due: 50, b30: 50 }), pa({ due: 50, b0: 50 })],
    ['wo', 'claim', 'coll', 'call', 'claim', 'remind', 'remind'], 'past-due suggestions (as in the 20 Sep worksheet)');
  const ca = o => A.crAction(A.acctOf(row(Object.assign({ due: -40, bal: -40 }, o)), cfg, '2026-10-05')).k;
  eq([ca({ sts: 'Start Sche', recv: '2020-01-01' }), ca({ recv: '2023-01-01' }), ca({ sts: 'Inactive', recv: '2026-09-01' }), ca({ recv: '2025-06-01' }), ca({ recv: '2026-09-01' })],
    ['prepay', 'prio', 'inact', 'old', 'timing'], 'credit suggestions: prepayment parked, 3+ years first, inactive, over a year, timing');
  ok(A.pdAction(A.acctOf(row({ due: 300, b90: 300 }), cfg, '2026-10-05'), cfg).s === 'Collection call', 'every suggestion has a short label for the tables');

  section('Summary and Month-End numbers');
  {
    const R = { asOf: '2026-10-05', cover: { full: true, pastDue: true, credit: true, ins: true },
      book: { n: 10, bal: 10000, due: 905, pt: { n: 7, bal: 8000 }, ins: { n: 3, bal: 2000 } },
      rows: [row({ patient: 'P1', due: 600, b0: 100, b30: 100, b60: 100, b90: 300, bal: 3000 }), row({ patient: 'P2', due: 200, b0: 100, b30: 100, bal: 1000 }), row({ patient: 'P3', due: 50, b0: 50, bal: 500 }),
        row({ patient: 'I1', rp: 'INS: A', due: 44.44, b0: 11.11, b30: 11.11, b60: 11.11, b90: 11.11, days: 100, bal: 800 }), row({ patient: 'I2', rp: 'INS: B', due: 60.56, b0: 60.56, days: 10, bal: 600 }),
        row({ patient: 'C1', due: -30, bal: -30, recv: '2022-01-01' }), row({ patient: 'C2', rp: 'INS: C', due: -20, bal: -20, recv: '2026-09-01' }), row({ patient: 'C3', sts: 'Start Sche', due: -500, bal: -500, recv: '2026-09-20' })].map(r => Object.assign(r, { key: A.acctKey(r) }))
    };
    const s = A.summarize(R, cfg);
    eq([s.pd.n, s.pd.total, s.pd.b0, s.pd.b30, s.pd.b60, s.pd.b90], [5, 955, 321.67, 211.11, 111.11, 311.11], 'past due by bucket');
    eq([s.pd.pt.total, s.pd.ins.total, s.pd.ins.b90], [850, 105, 11.11], 'patient vs insurance past due');
    eq([s.conc.n, s.conc.total, s.conc.top10, s.conc.reach70], [2, 311.11, 311.11, 1], '91+ concentration: 1 call reaches 70%');
    eq([s.never.n, s.never.pd, s.never.contract, s.never.tiers.chase.n, Math.round(s.never.pctBook * 100)], [1, 44.44, 800, 1, 40], 'insurance with nothing paid: 1 account, 40% of the insurance book behind it');
    eq([s.cr.n, s.cr.total, s.cr.prepay.total, s.cr.work.total, s.cr.pt.total, s.cr.ins.total], [3, 550, 500, 50, 530, 20], 'credits: total, parked prepayments, to resolve, patient vs insurance');
    eq(s.cr.byAge.map(x => x.n), [2, 0, 0, 0, 1], 'credits by age of last payment');
    eq(s.netDue, 905, 'net due now comes from the book');
    eq(s.monthEnd, { pt_ar: 8000, pt_ar_n: 7, ins_ar: 2000, ins_ar_n: 3, ar_total: 10000, pt_pd: 600, pt_pd_n: 2, ins_pd: 33.33, ins_pd_n: 1, cred_pt: 530, cred_ins: 20 }, 'Month-End “Accounts” numbers (30+ = 31–60, 61–90 and 91+)');
    const t = A.reportTotals(R, cfg);
    eq([t.pd, t.b90, t.n91, t.never, t.cr, t.crWork, t.crN, t.bal], [955, 311.11, 2, 1, 550, 50, 2, 10000], 'the small sealed totals kept with each report (for the trend)');
    ok(A.summarize(Object.assign({}, R, { cover: { full: false, pastDue: true, credit: false, ins: true }, book: null }), cfg).monthEnd === null, 'no Month-End numbers from a partial report');

    section('The goals (handbook §19)');
    // 50 active patient accounts (P1–P3 past due: 2 of them 30+), 25 insurance accounts (I1 100 days past due, I2 10 days)
    const RG = Object.assign({}, R, { book: { n: 80, bal: 10000, due: 905, pt: { n: 55, bal: 8000, act: 50 }, ins: { n: 25, bal: 2000, act: 25 } } });
    const k = A.kpis(RG, cfg);
    eq([k.pt.n, k.pt.of, k.pt.rate, k.pt.ok, k.pt.need], [3, 50, 0.06, false, 1], 'patient: 3 of 50 active accounts past due = 6% (goal 4%: 1 to bring current — 2 of 50 is 4%)');
    eq([k.ins.n, k.ins.of, k.ins.rate, k.ins.ok, k.ins.need], [1, 25, 0.04, true, 0], 'insurance: 1 of 25 accounts past the 60-day window = 4% — goal met (I2 at 10 days isn’t late yet)');
    const k30 = A.kpis(RG, A.arCfg({ ar: { kpiFrom: 31 } }));
    eq([k30.pt.n, k30.pt.rate, k30.pt.ok], [2, 0.04, true], 'counting from 31 days: P3 (0–30 only) isn’t counted — 2 of 50 = 4%, met');
    eq(A.kpis(RG, A.arCfg({ ar: { goalPt: 8, tiers: [120, 200, 365] } })).ins.n + '/' + A.kpis(RG, A.arCfg({ ar: { goalPt: 8 } })).pt.ok, '0/true', 'the insurance window follows “monitor up to”; the goal follows Settings');
    const RI = Object.assign({}, RG, { rows: RG.rows.concat([row({ patient: 'P4', sts: 'Inactive', due: 80, b90: 80, bal: 80 })].map(r => Object.assign(r, { key: A.acctKey(r) }))) });
    eq(A.kpis(RI, cfg).pt.n, 3, 'an Inactive account past due isn’t one of the active accounts (collections, not the goal)');
    ok(A.kpis(Object.assign({}, RG, { cover: { full: false, pastDue: true, credit: true, ins: true } }), cfg) === null && A.kpis(Object.assign({}, RG, { cover: Object.assign({}, RG.cover, { ins: false }) }), cfg).ins === null, 'no goals from a partial report; no insurance goal without insurance contracts');
    eq(A.kpis(R, cfg).pt.of, 7, 'an older report without the active count uses the patient account count');
    eq(A.reportTotals(RG, cfg).kp, { ptOf: 50, ptPd: 3, ptPd30: 2, insOf: 25, insLate: 1, win: 60 }, 'each saved report keeps the goal counts (both ways of counting) for the trend');
    eq(A.normSum(A.reportTotals(RG, cfg)).kp, { ptOf: 50, ptPd: 3, ptPd30: 2, insOf: 25, insLate: 1, win: 60 }, '…and they’re read back checked');

    section('What changed since the report before');
    const prev = { asOf: '2026-09-28', cover: R.cover, rows: [row({ patient: 'P2', due: 100, b0: 100, bal: 1100 }), row({ patient: 'P9', due: 75, b0: 75 }), row({ patient: 'I1', rp: 'INS: A', due: 33.33, b0: 11.11, b30: 11.11, b60: 11.11, days: 60 }),
      row({ patient: 'C1', due: -30, bal: -30, recv: '2022-01-01' }), row({ patient: 'C9', due: -15, bal: -15 }), row({ patient: 'P1', due: 500, b0: 100, b30: 100, b60: 100, b90: 200 })].map(r => Object.assign(r, { key: A.acctKey(r) })) };
    const d = A.diffReports(R, prev, cfg), K = n => A.acctKey(row({ patient: n, rp: /^I|C2/.test(n) ? 'INS: ' + ({ I1: 'A', I2: 'B', C2: 'C' }[n]) : 'Jordan Sample' }));
    eq(d.new91, [K('I1')], 'I1 is newly 91+ (P1 was already)');
    eq(d.cleared, [K('P9')], 'P9 paid (gone from the report)');
    eq(d.newCredit, [K('C2')], 'C2 is a new credit (C3 is a prepayment, not counted)');
    eq(d.goneCredit, [A.acctKey(row({ patient: 'C9' }))], 'C9’s credit was resolved');
    eq(d.worse, [K('I1')], 'I1 moved up a step (60 → 100 days, still nothing paid)');
    eq(d.newNever, [], 'no insurance account is newly unpaid');
    const d2 = A.diffReports(Object.assign({}, R, { cover: Object.assign({}, R.cover, { ins: false }), rows: R.rows.filter(r => !/^INS/.test(r.rp)) }), prev, cfg);
    ok(!d2.cleared.includes(K('I1')), 'a report without insurance doesn’t call insurance accounts paid');
  }

  section('Working an account');
  {
    const a = A.acctOf(row({ due: 300, b90: 300 }), cfg, '2026-10-05');
    const it = A.blankItem(a), mon = new Date(2026, 9, 5, 10).getTime(); // Monday
    A.applyLog(it, 'pt_vm', { by: 'jamie', note: 'left a message' }, mon);
    eq([it.stage, it.follow, it.log.length, it.log[0].by], ['waiting', '2026-10-08', 1, 'jamie'], 'voicemail → waiting, follow up in 3 days (Thursday)');
    A.applyLog(it, 'pt_noans', { by: 'jamie' }, new Date(2026, 9, 8, 10).getTime()); // Thursday + 2 → Saturday → Monday
    eq(it.follow, '2026-10-12', 'a follow-up that lands on Friday–Sunday moves to Monday');
    A.undoLog(it);
    eq([it.stage, it.follow, it.log.length], ['waiting', '2026-10-08', 1], 'undo puts the stage and follow-up back exactly');
    let e1 = null; try { A.applyLog(it, 'pt_promise', { by: 'j' }, mon); } catch (e) { e1 = e.code; }
    let e2 = null; try { A.applyLog(it, 'ins_denied', { by: 'j' }, mon); } catch (e) { e2 = e.code; }
    eq([e1, e2], ['need-date', 'need-note'], 'a promise needs a day; a denial needs the reason');
    A.applyLog(it, 'pt_promise', { by: 'j', date: '2026-10-15', amt: 200 }, mon);
    eq([it.stage, it.follow, it.log[it.log.length - 1].amt], ['promise', '2026-10-15', 200], 'promise to pay: follow up that day, amount kept');
    A.applyLog(it, 'cr_refreq', { by: 'j' }, mon);
    ok(it.drA === true, 'a refund request waits for Dr. A');
    A.answerDrA(it, true, { by: 'amir' }, mon);
    eq([it.drA, A.logLabel(it.log[it.log.length - 1])], [false, 'Dr. A OK’d it'], 'Dr. A’s OK is logged');
    eq(A.logLabel({ k: 'drA_ask' }), 'Asked Dr. A', 'asking Dr. A has its own entry');
    A.resolveItem(it, 'paid', { by: 'j', note: 'card' }, mon);
    eq([it.state, it.outcome, it.follow, A.canUndoLog(it)], ['done', 'paid', '', false], 'resolved: no follow-up, nothing to undo');
    A.reopenItem(it, { by: 'j' }, mon);
    eq([it.state, it.outcome, A.lastLog(it).k], ['open', '', 'done'], 'reopened (the reopen entry doesn’t count as the last thing done)');
    ok(A.blankItem(A.acctOf(row({ due: -50, bal: -50 }), cfg, '2026-10-05')).kind === 'cr', 'a credit account is a credit item');
  }

  section('The collections ladder (handbook §14)');
  {
    const asOf = '2026-10-05', T = '2026-10-05', at = (y, m, d) => new Date(y, m - 1, d, 10).getTime();
    const pa = o => A.acctOf(row(Object.assign({ due: 300, b0: 100, b30: 100, b90: 100, bal: 2000 }, o)), cfg, asOf);
    const st = (a, it, today) => A.ladState(a, it || null, asOf, today || T);
    eq([A.onLadder(pa({ days: 40 })), A.onLadder(pa({ days: 40, rp: 'INS: X' })), A.onLadder(pa({ days: 40, sts: 'Inactive' })), A.onLadder(A.acctOf(row({ due: -40, bal: -40 }), cfg, asOf))],
      [true, false, false, false], 'on the ladder: patient accounts past due (not insurance, not inactive, not credits)');
    eq([A.ladDays(pa({ days: 50 }), '2026-10-01', T), A.ladDays(pa({ days: null }), '2026-10-01', T), A.ladDays(pa({ days: null, b90: 0 }), asOf, T), A.ladDays(pa({ days: null, b90: 0, b30: 0, b60: 20 }), asOf, T), A.ladDays(pa({ days: null, b90: 0, b30: 0 }), asOf, T)],
      [54, 95, 31, 61, 0], 'days past due today = Edge’s Days + the days since the report (no Days: the oldest bucket’s first day)');
    const dueAt = d => { const s = st(pa({ days: d })); return s.due ? s.due.id : ''; };
    eq([0, 13, 14, 29, 30, 44, 45, 60, 74, 75, 90, 100, 103, 104, 120, 400].map(dueAt), ['d0', 'd0', 'l1', 'l1', 'l2', 'l2', 'l3', 'l4', 'l4', 'c75', 'l5', 'l6', 'l6', 't8', 'l7', 'l7'],
      'the step due follows days past due: text day 0, letters at 14/30/45/60, call 75, letters 90/100, text 104, letter 120');
    eq([A.LAD_BY.l4.dra, A.LAD_BY.l5.dra && A.LAD_BY.l5.cert, A.LAD_BY.l7.dra && A.LAD_BY.l7.cert, A.LAD_AA.dra && A.LAD_AA.cert, !!A.LAD_BY.l1.dra, !!A.LAD_BY.l4.cert, A.LAD_BY.l4.hold],
      [true, true, true, true, false, false, true], 'Dr. A signs #4, #5, #7, #8; #5, #7, #8 go certified; Maintenance Hold comes up at #4');
    eq(['l1', 'l2', 'l3', 'l4', 'c75', 'l5', 'l6', 't8', 'l7'].map(k => A.LAD_BY[k].text), ['FC- Delinquent #1', 'FC- Delinquent #2', 'FC- Delinquent #3', 'FC- Delinquent #4', 'FC- Delinquent #7', 'FC- Delinquent #5 &6', 'FC- Delinquent #5 &6', 'FC- Delinquent #8', 'FC- Delinquent #9 (FINAL)'], 'each step names its Weave text');
    {
      const s = st(pa({ days: 5, note: 'Payment in process' }));
      ok(s.due === null && s.pip === true, 'Edge says a payment is in process: no day-0 text');
      ok(st(pa({ days: 20, note: 'Payment in process' })).due.id === 'l1', '…but from day 14 the letter is due all the same');
    }
    // record steps: the next one comes due by itself
    {
      const a = pa({ days: 20 }), it = A.blankItem(a);
      A.ladderLog(it, 'l1', { by: 'sarah' }, at(2026, 10, 5));
      let s = st(a, it);
      eq([s.due, s.next && s.next.id, s.nextOn, it.stage, it.follow], [null, 'l2', '2026-10-15', 'waiting', ''], 'Letter #1 sent: nothing due; Letter #2 next on day 30 (Thu Oct 15); the follow-up isn’t touched');
      eq(st(a, it, '2026-10-15').due.id, 'l2', 'on day 30 Letter #2 comes due');
      let e = null; try { A.ladderLog(it, 'l1', { by: 'sarah' }, at(2026, 10, 5)); } catch (x) { e = x.code; }
      eq(e, 'step-done', 'a step can’t be recorded twice in one round');
      ok(A.canUndoLog(it), 'a ladder step can be undone');
      A.undoLog(it); s = st(a, it);
      eq([s.due.id, it.stage, it.log.length], ['l1', '', 0], 'undo: Letter #1 is due again, the stage is back');
      eq(A.logLabel({ k: 'ladder', step: 'l3' }), 'Letter #3 sent + called', 'the log says what went out');
    }
    // far along with nothing recorded: the step for today's day count, the earlier ones are passed
    {
      const a = pa({ days: 95 }), it = A.blankItem(a), s0 = st(a, it);
      eq([s0.due.id, s0.reached], ['l5', 6], 'day 95, nothing recorded: Letter #5 is due (not #1)');
      A.ladderLog(it, 'l5', { by: 'sarah', note: 'Certified #9407 1112' }, at(2026, 10, 5));
      const s1 = st(a, it);
      eq([s1.due, s1.next.id, s1.nextOn], [null, 'l6', '2026-10-12'], 'after #5, #6 comes on day 100 (Sat → Mon Oct 12)');
    }
    // Dr. A signs: asked, signed, sent
    {
      const a = pa({ days: 62 }), it = A.blankItem(a);
      A.askSign(it, 'l4', { by: 'sarah' }, at(2026, 10, 5));
      let s = st(a, it);
      eq([it.drA, s.asked, !!s.signed.l4, A.logLabel(it.log[0])], [true, 'l4', false, 'Asked Dr. A to sign Letter #4'], 'asking Dr. A to sign puts it on his list');
      A.answerDrA(it, true, { by: 'amir' }, at(2026, 10, 5));
      s = st(a, it);
      eq([it.drA, !!s.signed.l4, it.log[1].step, A.logLabel(it.log[1])], [false, true, 'l4', 'Dr. A signed Letter #4'], 'he signs: it leaves his list, marked signed');
      A.ladderLog(it, 'l4', { by: 'sarah' }, at(2026, 10, 5));
      eq(st(a, it).due, null, 'then the FC sends it');
      const b = A.blankItem(a); A.askSign(b, 'l4', { by: 'sarah' }, at(2026, 10, 5)); A.ladderLog(b, 'l4', { by: 'sarah' }, at(2026, 10, 5));
      ok(b.drA === false, 'signed outside the app and sent: the request leaves his list');
      const c = A.blankItem(a); A.signStep(c, 'l4', { by: 'amir' }, at(2026, 10, 5));
      ok(c.log.length === 1 && c.log[0].k === 'drA_ok' && st(a, c).signed.l4, 'Dr. A can sign without being asked');
      let e = null; try { A.askSign(c, 'l1', { by: 'sarah' }, 1); } catch (x) { e = x.code; } eq(e, 'bad-step', 'only his letters can be sent to him to sign');
      // a refund request after an old letter request: his OK isn't taken as a signature
      const d = A.blankItem(a); A.askSign(d, 'l4', { by: 'sarah' }, 1); A.answerDrA(d, true, { by: 'amir' }, 2); A.applyLog(d, 'cr_refreq', { by: 'sarah' }, 3); A.answerDrA(d, true, { by: 'amir' }, 4);
      ok(d.log[3].k === 'drA_ok' && d.log[3].step === undefined, 'an OK to a refund request isn’t taken as signing a letter');
    }
    // paused: a payment plan, a promise to pay; a broken arrangement brings Letter #8
    {
      const a = pa({ days: 70 }), it = A.blankItem(a);
      A.applyLog(it, 'pt_plan', { by: 'sarah' }, at(2026, 10, 5));
      let s = st(a, it);
      eq([s.paused, s.due, s.plan], ['plan', null, true], 'a payment plan pauses the ladder');
      A.breakArrangement(it, { by: 'sarah' }, at(2026, 10, 6)); s = st(a, it);
      eq([s.due.id, it.stage, s.next], ['aa', 'working', null], 'the arrangement broken: Letter #8 is due, off the ladder');
      A.askSign(it, 'aa', { by: 'sarah' }, at(2026, 10, 6)); A.answerDrA(it, true, { by: 'amir' }, at(2026, 10, 6)); A.ladderLog(it, 'aa', { by: 'sarah' }, at(2026, 10, 6));
      s = st(a, it, '2026-10-07');
      eq([s.due, !!s.fin, s.endOn], [null, true, '2026-11-05'], 'Letter #8 sent: 30 days for appliance removal and emergencies (to Nov 5)');
      eq(st(a, it, '2026-11-05').due.id, 'endaa', 'after the 30 days: Debond/Finish');
      const p = A.blankItem(a); A.applyLog(p, 'pt_promise', { by: 'sarah', date: '2026-10-08' }, at(2026, 10, 5));
      eq([st(a, p).paused, st(a, p, '2026-10-09').due.id], ['promise', 'l4'], 'a promise pauses it until the day passes (then Letter #4, day 74)');
      const h = A.blankItem(a); A.applyLog(h, 'pt_vm', { by: 'sarah' }, 1); h.stage = 'hold';
      eq(st(a, h).paused, 'hold', 'the status “Paused” pauses it');
    }
    // the last letter, then 30 days, then the write-off
    {
      const a = pa({ days: 125 }), it = A.blankItem(a);
      A.signStep(it, 'l7', { by: 'amir' }, at(2026, 10, 5)); A.ladderLog(it, 'l7', { by: 'sarah' }, at(2026, 10, 5));
      eq([st(a, it).due, st(a, it, '2026-11-04').due && st(a, it, '2026-11-04').due.id, st(a, it, '2026-11-05').due.id], [null, 'end', 'end'], 'Letter #7: nothing due for 30 days, then the write-off (Nov 4 is the first office day after)');
    }
    // Maintenance Hold
    {
      const a = pa({ days: 64 }), it = A.blankItem(a);
      A.holdLog(it, true, { by: 'sarah' }, at(2026, 10, 5));
      ok(!!st(a, it).hold && !!A.holdOf(it), 'put on Maintenance Hold');
      A.undoLog(it); ok(!A.holdOf(it), 'undo takes it back');
      A.holdLog(it, true, { by: 'sarah' }, 1); A.holdLog(it, false, { by: 'sarah' }, 2);
      ok(!A.holdOf(it), 'lifted');
      A.holdLog(it, true, { by: 'sarah' }, 3); A.resolveItem(it, 'paid', { by: 'sarah' }, 4);
      ok(!A.holdOf(it) && st(a, it).paused === 'done' && st(a, it).due === null, 'paid (resolved): the hold ends and nothing is due');
      eq([A.logLabel({ k: 'mhold_on' }), A.logLabel({ k: 'mhold_off' }), A.logLabel({ k: 'aa_broken' })], ['Put on Maintenance Hold', 'Maintenance Hold lifted', 'Arrangement broken'], 'their log labels');
    }
    // a new round when it's past due again after being resolved; a plain reopen carries on
    {
      const a = pa({ days: 40 }), it = A.blankItem(a);
      A.ladderLog(it, 'l1', { by: 'sarah' }, 1); A.ladderLog(it, 'l2', { by: 'sarah' }, 2); A.holdLog(it, true, { by: 'sarah' }, 3);
      A.resolveItem(it, 'other', { by: 'sarah' }, 4); A.reopenItem(it, { by: 'sarah' }, 5);
      ok(!!st(a, it).done.l2 && st(a, it).due === null, 'reopened by hand: the steps already sent still count');
      A.resolveItem(it, 'paid', { by: 'sarah' }, 6); A.reopenItem(it, { by: 'sarah', note: 'On the list again', fresh: true }, 7);
      const s = st(a, it);
      eq([Object.keys(s.done).length, s.due.id, !!s.hold, it.log[it.log.length - 1].fresh], [0, 'l2', false, true], 'past due again after being paid: a new round (nothing sent yet, no hold)');
    }
    // what's read back from the database
    {
      const n = A.normItem({ id: 'x', state: 'open', log: [{ k: 'ladder', step: 'l5', at: 1, by: 's', note: 'Certified #1', prev: { stage: '', follow: '', drA: false } }, { k: 'reopen', fresh: true, at: 2 }, { k: 'reopen', fresh: 'yes', at: 3 }, { k: 'ladder', step: '__proto__', at: 4 }, { k: 'drA_ok', step: 'toString', at: 5 }, { k: 'mhold_on', at: 6 }, { k: 'aa_broken', at: 7 }] });
      eq(n.log.map(e => [e.k, e.step || '', e.fresh || false]), [['ladder', 'l5', false], ['reopen', '', true], ['reopen', '', false], ['ladder', '', false], ['drA_ok', '', false], ['mhold_on', '', false], ['aa_broken', '', false]],
        'read back: known steps and kinds are kept, anything else is dropped (no prototype names)');
      const ls = A.ladState(pa({ days: 40 }), n, asOf, T);
      eq([Object.keys(ls.done), Object.keys(ls.signed), !!ls.hold, ls.due.id], [[], [], true, 'aa'], 'and on the ladder: the round starts after the new-round reopen; the dropped steps count for nothing');
    }
    ok(A.ladState(pa({ days: 40, rp: 'INS: X' }), null, asOf, T) === null && A.ladState(pa({ days: 40, sts: 'Inactive' }), null, asOf, T) === null, 'insurance and inactive accounts have no ladder');
  }

  section('Office days and settings');
  eq(['2026-10-09', '2026-10-10', '2026-11-25', '2026-12-24', '2026-12-25', '2026-09-07'].map(A.nextOfficeDay), ['2026-10-12', '2026-10-12', '2026-11-30', '2026-12-24', '2026-12-28', '2026-09-08'],
    'office days: Mon–Thu, skipping Thanksgiving week, Christmas, Labor Day');
  eq(A.arCfg({ ar: { inst: 0, writeOff: -1, tiers: [90, 60, 365], dueDay: 6, goalPt: 0, goalIns: 140, kpiFrom: 7 } }), { inst: 11.11, writeOff: 100, tiers: [60, 120, 365], dueDay: 1, goalPt: 4, goalIns: 4, kpiFrom: 1 }, 'bad settings fall back to the usual numbers (report due Monday, goals 4% and 4%)');
  eq(A.arCfg({ ar: { inst: 12.5, writeOff: 50, tiers: [30, 90, 200], dueDay: 3, goalPt: 3.5, goalIns: 5, kpiFrom: 31 } }), { inst: 12.5, writeOff: 50, tiers: [30, 90, 200], dueDay: 3, goalPt: 3.5, goalIns: 5, kpiFrom: 31 }, 'good settings are used');
  eq(A.arCfg({ ar: { staleDays: 21 } }).dueDay, 1, 'an older settings record (report "old after N days") gets the Monday due day');

  section('The weekly report (handbook §19: weekly)');
  const RD = (n, t, d) => { const r = A.reportDue(n, t, d); return [r.state, r.due, r.days]; };
  eq(RD('2026-10-05', '2026-10-06', 1), ['ok', '2026-10-12', 0], 'due Monday, in on Monday: fine on Tuesday, the next one due Monday Oct 12');
  eq(RD('2026-09-28', '2026-10-06', 1), ['late', '2026-10-05', 1], 'due Monday, still last week’s on Tuesday: late by a day');
  eq(RD('2026-09-28', '2026-10-05', 1), ['today', '2026-10-05', 0], 'on the Monday itself: due today');
  eq(RD('2026-09-29', '2026-10-05', 2), ['ok', '2026-10-06', 0], 'due Tuesday: on Monday last week’s still counts; due tomorrow');
  eq(RD('2026-10-05', '2026-10-05', 2), ['ok', '2026-10-13', 0], 'due Tuesday, imported a day early: this week’s is in');
  eq(RD('2026-10-05', '2026-10-10', 1), ['ok', '2026-10-12', 0], 'the weekend: in, next one Monday');
  eq(RD('2026-09-14', '2026-10-06', 1), ['late', '2026-10-05', 1], 'weeks behind: late since this week’s due day');
  eq(RD(null, '2026-10-06', 1), ['late', '2026-10-05', 1], 'no report at all: late');
  eq(RD('2026-09-28', '2026-10-06', 9), ['late', '2026-10-05', 1], 'a bad due day means Monday');
  eq([RD('2026-09-01', '2026-09-08', 1), RD('2026-09-01', '2026-09-09', 1)], [['today', '2026-09-08', 0], ['late', '2026-09-08', 1]], 'Labor Day moves Monday’s report to Tuesday');
  eq([RD('2026-11-19', '2026-11-27', 4), RD('2026-11-19', '2026-11-30', 4), RD('2026-11-24', '2026-11-30', 4)], [['ok', '2026-11-30', 0], ['today', '2026-11-30', 0], ['ok', '2026-12-03', 0]],
    'Thanksgiving week: Thursday’s report is due the Monday after (or in early, and the next one is Thursday)');
  eq(['=1+1', '+A', '-5', '@x', 'Avery', 'say "hi"'].map(A.csvCell), ['"\'=1+1"', '"\'+A"', '"\'-5"', '"\'@x"', '"Avery"', '"say ""hi"""'], 'downloaded lists can’t carry spreadsheet formulas');

  section('Sealing');
  {
    const ring = { '1': A.Crypto.newRingKey(), '2': A.Crypto.newRingKey() }, keys = await A.Crypto.ringKeys(ring);
    const big = await A.Crypto.sealBig(keys['2'], rep, 'arrep:r1');
    eq((await A.Crypto.openBig(keys['2'], big, 'arrep:r1')).rows.length, rep.rows.length, 'a whole report seals (gzip + AES-GCM) and opens');
    ok(big.ct.length < JSON.stringify(rep).length, 'and is smaller sealed than plain (' + big.ct.length + ' vs ' + JSON.stringify(rep).length + ')');
    let bad = false; try { await A.Crypto.openBig(keys['2'], big, 'arrep:r2'); } catch (e) { bad = true; }
    ok(bad, 'a sealed report can’t be passed off as another one (bound to its id)');
    const i1 = A.b64url(await A.Crypto.hmac(await A.Crypto.idxKey(ring), 'avery sample|jordan sample|P'));
    const i2 = A.b64url(await A.Crypto.hmac(await A.Crypto.idxKey({ '1': ring['1'], '3': A.Crypto.newRingKey() }), 'avery sample|jordan sample|P'));
    ok(i1 === i2 && i1.length >= 22, 'an account’s record id doesn’t change when the A/R key does');
    const pair = await A.Crypto.newPair(), pub = await A.Crypto.pubJwk(pair), priv = await A.Crypto.importPriv(await A.Crypto.privBytes(pair));
    const box = await A.Crypto.sealTo(pub, A.Crypto.ringBytes(ring), 'arring:u1');
    eq(A.Crypto.ringFrom(await A.Crypto.openFrom(priv, box, 'arring:u1')), ring, 'a copy of the A/R key sealed to one person opens only with their key');
    let bad2 = false; try { await A.Crypto.openFrom(priv, box, 'arring:u2'); } catch (e) { bad2 = true; }
    ok(bad2, 'and only as theirs');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
