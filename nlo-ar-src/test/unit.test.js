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
    const cfg1 = A.arCfg({ ar: { kpiFrom: 1 } }), k = A.kpis(RG, cfg1);
    eq([k.pt.n, k.pt.of, k.pt.rate, k.pt.ok, k.pt.need], [3, 50, 0.06, false, 1], 'patient, counting from day 1: 3 of 50 active accounts past due = 6% (goal 4%: 1 to bring current — 2 of 50 is 4%)');
    eq([k.ins.n, k.ins.of, k.ins.rate, k.ins.ok, k.ins.need], [1, 25, 0.04, true, 0], 'insurance: 1 of 25 accounts past the 60-day window = 4% — goal met (I2 at 10 days isn’t late yet)');
    const k30 = A.kpis(RG, cfg);
    eq([cfg.kpiFrom, k30.pt.n, k30.pt.rate, k30.pt.ok], [31, 2, 0.04, true], 'the usual count is from 31 days: P3 (0–30 only) isn’t counted — 2 of 50 = 4%, met');
    eq(A.kpis(RG, A.arCfg({ ar: { goalPt: 8, tiers: [120, 200, 365] } })).ins.n + '/' + A.kpis(RG, A.arCfg({ ar: { goalPt: 8 } })).pt.ok, '0/true', 'the insurance window follows “monitor up to”; the goal follows Settings');
    const RI = Object.assign({}, RG, { rows: RG.rows.concat([row({ patient: 'P4', sts: 'Inactive', due: 80, b90: 80, bal: 80 })].map(r => Object.assign(r, { key: A.acctKey(r) }))) });
    eq(A.kpis(RI, cfg1).pt.n, 3, 'an Inactive account past due isn’t one of the active accounts (collections, not the goal)');
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

  section('Insurance carriers (the carrier book)');
  {
    const bk = A.emptyBook(), t0 = Date.UTC(2026, 9, 6, 14);
    const id1 = A.carrierSave(bk, { name: 'Bayside Dental Plan', phone: '(800) 555-0142', portal: 'https://provider.example.com/bayside', payer: 'BDP01', tf: 365 }, { by: 'jamie' }, t0);
    ok(/^c[0-9a-f]{12}$/.test(id1), 'a carrier gets an id of its own');
    const bad = f => { try { A.carrierSave(bk, f, {}, t0); return ''; } catch (e) { return e.message; } };
    ok(/already in the list/.test(bad({ name: '  bayside dental plan ' })), 'the same name twice is refused');
    ok(/web address/.test(bad({ name: 'Odd Plan', portal: 'javascript:alert(1)' })) && /web address/.test(bad({ name: 'Odd Plan', portal: 'provider.example.com' })), 'a portal that isn’t an http(s) web address is refused');
    ok(/name/.test(bad({ name: '   ' })), 'a carrier needs a name');
    const id2 = A.carrierSave(bk, { name: 'Coastal Benefits', tf: 150 }, {}, t0);
    A.carrierTag(bk, ['k1|I', 'k2|I'], id1); A.carrierTag(bk, ['k3|I'], id2);
    let b = A.normBook(Object.assign({}, bk, { id: 'x', rev: 3 }));
    eq([b.carriers.map(c => c.name), A.carrierOf(b, 'k1|I').name, A.carrierOf(b, 'k3|I').tf, A.carrierOf(b, 'k9|I')], [['Bayside Dental Plan', 'Coastal Benefits'], 'Bayside Dental Plan', 150, null], 'accounts point at their carrier; the list is by name');
    A.carrierSave(bk, { id: id1, name: 'Bayside Dental Plan', phone: '(800) 555-0199', tf: 365 }, {}, t0 + 1);
    A.carrierTag(bk, ['k2|I'], '');
    b = A.normBook(bk);
    eq([b.carriers.length, A.carrierOf(b, 'k1|I').phone, A.carrierOf(b, 'k2|I')], [2, '(800) 555-0199', null], 'editing keeps the carrier (and its accounts); taking it off an account works');
    A.carrierRemove(bk, id2); b = A.normBook(bk);
    eq([b.carriers.map(c => c.name), A.carrierOf(b, 'k3|I')], [['Bayside Dental Plan'], null], 'removing a carrier takes it off its accounts');
    ok(/removed/.test((() => { try { A.carrierTag(bk, ['k4|I'], id2); return ''; } catch (e) { return e.message; } })()), 'a removed carrier can’t be set on an account');
    const raw = { book: 1, carriers: [{ id: 'c000000000001', name: 'Fine', tf: 5000, portal: 'ftp://x' }, { id: 'nope', name: 'Bad id' }, { id: 'c000000000002', name: '' }], tags: { a: 'c000000000001', b: 'c999999999999', c: 7 } };
    const nb = A.normBook(raw);
    eq([nb.carriers.length, nb.carriers[0].tf, nb.carriers[0].portal, Object.keys(nb.tags)], [1, 0, '', ['a']], 'what’s read back is checked: bad ids, names, limits, links and tags are dropped');
    ok(A.normBook({ book: 1, locked: true }) === null && A.normBook({ key: 'x' }) === null, 'a record that isn’t the book (or can’t be opened) isn’t taken for it');
    const fam = [{ key: 'a', ins: true, rp: 'INS: Mrs. Jordan Sample' }, { key: 'b', ins: true, rp: 'INS: Jordan Sample' }, { key: 'c', ins: false, rp: 'Jordan Sample' }, { key: 'd', ins: true, rp: 'INS: Alex Sample' }];
    eq(A.sameHolder(fam, fam[0]).map(x => x.key), ['b'], 'brothers and sisters on the same policy are found (insurance accounts, same policyholder)');
  }

  section('Focus: what to do first');
  {
    const T = '2026-10-06', asOfF = '2026-10-05', at = (iso, h) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, h || 10).getTime(); };
    const fa = o => A.acctOf(row(o), cfg, asOfF);
    const P1 = fa({ patient: 'Pat One', rp: 'Lee One', due: 300, b0: 150, b30: 150, days: 40, bal: 3000 });           // Letter #2 due, nothing recorded
    const P2 = fa({ patient: 'Pat Two', rp: 'Lee Two', due: 450, b0: 150, b30: 150, b60: 150, days: 85, bal: 3000 }); // reaches day 90 this week
    const I3 = fa({ patient: 'Pat Three', rp: 'INS: Lee Three', due: 44.44, b0: 11.11, b30: 11.11, b60: 11.11, b90: 11.11, days: 140, bal: 2000 }); // nothing paid, near the 150-day limit
    const C4 = fa({ patient: 'Pat Four', rp: 'Lee Four', due: -250, bal: -250, recv: '2022-01-10' });                // credit over 3 years old
    const P5 = fa({ patient: 'Pat Five', rp: 'Lee Five', due: 600, b0: 600, days: 10, bal: 4000 });                   // new this week, $600
    const P6 = fa({ patient: 'Pat Six', rp: 'Lee Six', due: 300, b0: 150, b30: 150, days: 40, bal: 3000 });           // Letter #2 due — #1 went out on day 14
    const P7 = fa({ patient: 'Pat Seven', rp: 'Lee Seven', due: 900, b0: 150, b30: 150, b60: 150, b90: 450, days: 94, bal: 3000 }); // Letter #5 (Dr. A signs), asked 4 office days ago
    const accts = [P1, P2, I3, C4, P5, P6, P7], byKey = new Map(accts.map(a => [a.key, a]));
    const it = (a, o) => Object.assign({ key: a.key, name: a.patient, rp: a.rp, src: a.src, kind: 'pd', state: 'open', stage: '', follow: '', drA: false, log: [] }, o);
    const items = new Map([
      [P1.key, it(P1, { stage: 'promise', follow: '2026-10-02', log: [{ id: 'e1', at: at('2026-09-28'), by: 'jamie', k: 'pt_promise', date: '2026-10-02' }] })],
      [P6.key, it(P6, { log: [{ id: 'e2', at: at('2026-09-04'), by: 'jamie', k: 'ladder', step: 'l1' }] })],
      [P7.key, it(P7, { drA: true, log: [{ id: 'e3', at: at('2026-09-29'), by: 'jamie', k: 'drA_ask', step: 'l5' }] })]
    ]);
    const late = it({ key: 'pat eight|lee eight|P', patient: 'Pat Eight', rp: 'Lee Eight', src: 'pt' }, { follow: '2026-09-29', log: [{ id: 'e4', at: at('2026-09-22'), by: 'jamie', k: 'pt_vm' }] });
    items.set(C4.key, it(C4, { kind: 'cr', drA: true, log: [{ id: 'e5', at: at('2026-10-05'), by: 'jamie', k: 'cr_refreq', note: 'OK to refund $250?' }] }));
    const book = A.emptyBook(), cid = A.carrierSave(book, { name: 'Summit Dental PPO', tf: 150 }, {}, 1); A.carrierTag(book, [I3.key], cid);
    const ctx = (o) => Object.assign({ accts, asOf: asOfF, byKey, item: k => items.get(k) || null, lad: a => A.ladState(a, items.get(a.key) || null, asOfF, T), open: Array.from(items.values()).concat([late]),
      cleared: () => false, today: T, owner: false, prevPd: new Set([P1.key, P2.key, I3.key, P6.key, P7.key]), book: A.normBook(book), auditStart: '' }, o || {});
    const F = A.focusEntries(ctx()), kinds = F.map(e => e.key.split('|')[0] + ':' + e.kind);
    eq(kinds, ['pat one:promise', 'pat seven:signlate', 'pat three:tf', 'pat six:ladlate', 'pat two:cross', 'pat five:new', 'pat eight:followlate'],
      'staff: a promise that passed, a letter waiting 4 office days for Dr. A, the filing limit, a step late once the account is moving, day 90 this week, a big new balance, a follow-up 4 office days late — urgent, in that order');
    ok(F.every(e => e.cls === 'urgent') && !F.some(e => e.key === C4.key), 'all urgent; the credit (worked: a refund asked) isn’t on the staff list');
    eq([F[0].why, F[1].act, F[2].why, F[3].why, F[6].why], ['Promised to pay by Oct 2 — check whether it came in', 'Remind Dr. A', 'Summit Dental PPO’s filing limit (150 days) is in 9 days', 'Letter #2 due — 11 days late · mail or email', 'Follow-up 4 office days late — last: left a voicemail'], 'each says why');
    ok(F[0].also.some(x => /^Letter #2 due/.test(x)) && F[2].also.some(x => /investigate the claim with Summit Dental PPO/.test(x)), 'the other reasons stay with the account (“also”)');
    const Fo = A.focusEntries(ctx({ owner: true })), ko = Fo.map(e => e.key.split('|')[0] + ':' + e.kind + ':' + e.cls);
    ok(ko.includes('pat seven:signlate:urgent') && ko.includes('pat four:drA:today') && /needs your signature — asked 4 office days ago/.test(Fo.find(e => e.kind === 'signlate').why), 'Dr. A: the letter waiting for his signature, and the refund to OK');
    const P1n = A.focusEntries(ctx({ item: k => (k === P1.key ? null : items.get(k) || null), lad: a => A.ladState(a, a.key === P1.key ? null : items.get(a.key) || null, asOfF, T), open: [] })).find(e => e.key === P1.key);
    ok(P1n.kind === 'lad' && P1n.cls === 'today' && P1n.why === 'Letter #2 due · mail or email', 'an account nobody has started on isn’t “late” — its step is simply due today');
    const noC = A.focusEntries(ctx({ item: () => null, lad: a => A.ladState(a, null, asOfF, T), open: [] }));
    ok(noC.find(e => e.key === C4.key).kind === 'credit' && noC.find(e => e.key === C4.key).cls === 'later', 'a 3+ year credit nobody has touched: later');
    const aud = A.focusEntries(ctx({ today: '2026-12-10', auditStart: '2026-12-01', item: () => null, lad: a => A.ladState(a, null, asOfF, '2026-12-10'), open: [] })).find(e => e.key === C4.key);
    ok(aud.kind === 'creditaudit' && aud.cls === 'today' && /^December audit/.test(aud.why), 'in the December audit, a credit not reviewed yet is for today');
    eq([A.officeDaysLate('2026-10-01', '2026-10-06'), A.officeDaysLate('2026-11-24', '2026-11-30'), A.officeDaysLate('2026-10-06', '2026-10-06')], [2, 1, 0], 'office days late: weekends and the Thanksgiving days skipped');
  }

  section('Week over week, the pace to the goals, the December audit');
  {
    const mk = (asOf, rows, cover) => ({ asOf, cover: Object.assign({ full: true, pastDue: true, credit: true, ins: true }, cover || {}), book: null, rows: rows.map(o => Object.assign(row(o), { key: A.acctKey(row(o)) })) });
    const prev = mk('2026-09-28', [{ patient: 'A Sample', due: 150, b0: 150 }, { patient: 'B Sample', due: 300, b30: 300 }, { patient: 'C Sample', due: 200, b0: 200 }, { patient: 'D Sample', due: -40, bal: -40 }]);
    const cur = mk('2026-10-05', [{ patient: 'B Sample', due: 450, b30: 150, b90: 300 }, { patient: 'C Sample', due: 100, b0: 100 }, { patient: 'E Sample', due: 175, b0: 175 }, { patient: 'D Sample', due: -40, bal: -40 }]);
    const f = A.flowOf(cur, prev, cfg);
    eq([f.cured, f.curedAmt, f.newN, f.newAmt, f.rolled, f.into91, f.better, f.cleared], [1, 150, 1, 175, 1, 1, 0, 250], 'got current 1 ($150), new 1 ($175), slid 1 (into 91+), past due gone $250 (A’s $150 + $100 off C)');
    ok(A.flowOf(prev, cur, cfg) === null && A.flowOf(cur, mk('2026-09-28', [], { pastDue: false }), cfg) === null, 'only from an earlier report that has past due in it');
    const tot = A.reportTotals(cur, cfg, prev);
    eq([tot.fl.cured, A.normSum(tot).fl.into91, A.reportTotals(cur, cfg).fl, A.normSum({}).fl], [1, 1, null, null], 'kept with the report’s sealed totals; older totals have none');
    const pts = (r) => r.map((x, i) => ({ asOf: A.addDays('2026-09-07', 7 * i), rate: x }));
    const down = A.paceTo(pts([0.10, 0.09, 0.08, 0.07]), 0.04);
    eq([down.dir, Math.round(down.weeks * 10) / 10, down.date], ['down', 3, '2026-10-19'], 'down 1 point a week from 7%: under 4% in 3 weeks');
    eq([A.paceTo(pts([0.05, 0.06, 0.07]), 0.04).dir, A.paceTo(pts([0.06, 0.06, 0.06]), 0.04).dir, A.paceTo(pts([0.06, 0.05, 0.03]), 0.04).met, A.paceTo(pts([0.06, 0.05]), 0.04)], ['up', 'flat', true, null], 'going up, flat, already there, and too few reports');
    eq([A.auditWindow('2026-10-06'), A.auditWindow('2026-12-15'), A.auditWindow('2027-02-01').start, A.auditWindow('2027-04-01').on],
      [{ on: false, start: '2026-12-01', end: '2027-03-31' }, { on: true, start: '2026-12-01', end: '2027-03-31' }, '2026-12-01', false], 'the audit runs December 1 to March 31');
    const at = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 10).getTime(); }, ci = o => Object.assign({ state: 'open', log: [] }, o);
    eq([A.auditOf(null, '2026-12-01').reviewed, A.auditOf(ci({ log: [{ k: 'cr_review', at: at('2026-11-20') }] }), '2026-12-01').reviewed, A.auditOf(ci({ log: [{ k: 'cr_review', at: at('2026-12-03') }] }), '2026-12-01').st,
      A.auditOf(ci({ log: [{ k: 'cr_refreq', at: at('2026-12-03') }, { k: 'drA_ok', at: at('2026-12-04') }] }), '2026-12-01').st, A.auditOf(ci({ state: 'done', outcome: 'refund', resolvedAt: at('2026-12-09') }), '2026-12-01').done,
      A.auditOf(ci({ state: 'done', outcome: 'refund', resolvedAt: at('2026-11-09') }), '2026-12-01').reviewed],
      [false, false, 'Ledger reviewed', 'Refund OK’d — cut the check', true, false], 'a credit counts as reviewed once something is logged or it’s resolved after December 1');
  }

  section('OrthoBanc’s failed-payment report (handbook §14, day 0)');
  {
    const c = d => { const x = A.obCycle(d); return [x.cur && x.cur.date, x.cur && x.cur.due, x.next && x.next.due]; };
    eq([c('2026-10-06'), c('2026-10-04'), c('2026-09-28'), c('2026-12-28')], [['2026-10-05', '2026-10-05', '2026-10-12'], ['2026-09-26', '2026-09-28', '2026-10-05'], ['2026-09-26', '2026-09-28', '2026-10-05'], ['2026-12-26', '2026-12-28', '2027-01-05']],
      'the 5th, 12th, 19th and 26th — on a weekend (Sep 26, Dec 26) it’s the next office day');
    const b = A.emptyBook();
    let st = A.obState(A.normBook(b), '2026-10-06');
    eq([st.due && st.due.date, st.missed], ['2026-10-05', null], 'not checked yet: due (and no “missed” nag before the first check ever)');
    A.obCheck(b, { for: '2026-09-26', n: '3', note: 'Texted all three', by: 'jamie' }, Date.UTC(2026, 8, 28, 14));
    st = A.obState(A.normBook(b), '2026-10-06');
    eq([st.due && st.due.date, st.missed, st.last.n], ['2026-10-05', null, 3], 'the one before was checked: only today’s is due');
    A.obCheck(b, { for: '2026-10-05', n: '', by: 'jamie' }, Date.UTC(2026, 9, 6, 14));
    st = A.obState(A.normBook(b), '2026-10-06');
    eq([st.due, A.normBook(b).ob.map(x => x.n)], [null, [3, null]], 'checked: no reminder until the next one (the count is optional)');
    eq(A.obState(A.normBook(b), '2026-10-20').missed.date, '2026-10-12', 'a report skipped is pointed out with the next one');
    ok(/whole number/.test((() => { try { A.obCheck(b, { for: '2026-10-12', n: '2.5' }, 1); return ''; } catch (e) { return e.message; } })()), 'the count has to be a whole number');
  }

  section('OrthoBanc’s failed-payment report, imported (optional; it never changes an account)');
  {
    const OBX = JSON.parse(fs.readFileSync(path.join(FX, 'ob-expected.json'), 'utf8')), OK = ['ref', 'status', 'acct', 'patient', 'rp', 'amt', 'hold', 'reason', 'date', 'how', 'bal'];
    const ob = await A.readReportFile('FailedTransactions.xls', fs.readFileSync(path.join(FX, 'ob-failed.xls')));
    ok(ob.ob === true && ob.kind === 'xls' && ob.asOf === OBX.asOf && ob.check.ok === true, 'OrthoBanc’s Failed Transaction Report is recognized (.xls), with its date (' + ob.asOf + ') — ' + ob.check.why);
    eq(ob.rows.map(r => { const o = {}; OK.forEach(k => { o[k] = r[k]; }); return o; }), OBX.rows, 'every failed payment: OB reference, Edge account #, patient and responsible (Last, First → First Last), amount, HOLD or not, reason, draft date, balance');
    ok(ob.rows.filter(r => r.hold).length === 2 && ob.rows[0].hold && ob.rows[1].hold && !ob.rows[2].hold, '“Action On Your Part Is Needed” is the accounts on HOLD; “No Action Required” the rest');
    const e = await A.readReportFile('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls')));
    ok(!e.ob && e.rows.length === EXP.full.rows.length, 'Edge’s A/R report dropped in the same place is still read as the A/R report');
    ok(/isn’t OrthoBanc’s/.test(await A.readOBFailed('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls'))).then(() => '', x => x.message)), 'an Edge file isn’t taken for OrthoBanc’s report');
    const g = { sheets: [[['OrthoBanc'], [], ['Failed Transaction Report'], [], [], ['Monday, October 5, 2026'], [], [], [null, '** No Action Required On Your Part **'], [], [null, 'Status *', null, null, null, 'OB Reference #'], [],
      [null, 'FAIL', null, null, null, 'ob04100011', null, null, null, null, '1', null, null, null, 'Sample, Avery', null, null, null, null, 'Sample, Jo', null, null, null, 12]]] };
    const dm = A.obFromGrid(g);
    ok(dm.rows.length === 1 && dm.check.ok === false && /without its reason line/.test(dm.check.why), 'a failed payment without its reason line is pointed out');
    eq(['2026-10-05', '2026-10-06', '2026-10-11', '2026-10-12', '2026-10-04', '2026-01-03', ''].map(A.obDayOf), ['2026-10-05', '2026-10-05', '2026-10-05', '2026-10-12', '2026-09-26', '2025-12-26', ''],
      'a report belongs to the latest 5th / 12th / 19th / 26th on or before its date');

    // names, however each system writes them
    eq([A.nameToks('Mrs. Lucía Peña'), A.nameToks("Avery O'Sample"), A.nameToks('Sam Demo-Ray Jr.'), A.nameToks('INS: Pat Łucja')], [['lucia', 'pena'], ['avery', 'osample'], ['sam', 'demo', 'ray'], ['pat', 'lucja']],
      'names: accents, titles, apostrophes, hyphens, suffixes and “INS:” don’t count');
    const acc = (patient, rp, o) => A.acctOf(row(Object.assign({ patient, rp, due: 175, b0: 175, bal: 1400 }, o || {})), cfg, '2026-10-05');
    const accts = [acc('Avery Sample', 'Mr. Jordan Sample'), acc('Ana De La Cruz', 'Maria De La Cruz'), acc("Avery O'Sample", "Robin O'Sample"), acc('José Peña', 'Mrs. Lucía Peña'), acc('Riley Demo', 'Lee Demo'),
      acc('Sam Demo-Ray', 'Pat Demo-Ray'), acc('Quinn Notreal', 'INS: Casey Notreal'), acc('Dana Mockley', 'Pat Mockley')];
    eq(ob.rows.map(r => { const a = A.obMatch(accts, r); return a ? a.patient : null; }), ['Avery Sample', 'Ana De La Cruz', "Avery O'Sample", 'José Peña', 'Riley Demo', 'Sam Demo-Ray', null, 'Dana Mockley'],
      'each failed payment finds its patient account: Last, First; accents; apostrophes; two-word and hyphenated last names; a middle name on one side — never an insurance account');
    const one = (pt, rp, list) => { const a = A.obMatch(list || accts, { patient: pt, rp }); return a ? a.patient + '|' + a.rp : null; };
    eq([one('Avery Sample', 'Kim Other'), one('Avery Sample', 'Kim Sample')], [null, 'Avery Sample|Mr. Jordan Sample'], 'the responsible party has to agree (at least the last name) — no phone number from someone else’s account');
    eq(one('Demo Riley', 'Lee Demo'), 'Riley Demo|Lee Demo', 'a name written last name first without its comma is still found');
    const twins = [acc('Taylor Twin', 'Chris Twin'), acc('Taylor Twin', 'Morgan Other')];
    eq([one('Taylor Twin', 'Chris Twin', twins), one('Taylor Twin', 'Morgan Other', twins), one('Taylor Twin', 'Nobody Else', twins)], ['Taylor Twin|Chris Twin', 'Taylor Twin|Morgan Other', null], 'two patients with the same name: the responsible party tells them apart, or it’s no match');
    const two = [acc('Kai Sample', 'Lee Sample', { due: 0, b0: 0, bal: -50 }), acc('Kai Sample', 'Lee Sample', { sts: 'Retention' })];
    ok(one('Kai Sample', 'Lee Sample', two) === 'Kai Sample|Lee Sample' && A.obMatch(two, { patient: 'Kai Sample', rp: 'Lee Sample' }).pd > 0, 'two accounts for the same family: the one past due');
    eq(A.obMatch(accts, { patient: '', rp: 'Lee Demo' }), null, 'no name, no match');

    // the import record: one per report day, sealed like an account's; ticking
    const day = A.obDayOf(ob.asOf), rec = A.emptyOBRep(day), t0 = Date.UTC(2026, 9, 6, 13);
    A.obImport(rec, ob, { day, by: 'jamie' }, t0);
    let R = A.normOBRep(Object.assign({ id: 'x' }, rec));
    const amt = A.round2(OBX.rows.reduce((s2, r) => s2 + r.amt, 0));
    eq([R.day, R.rows.length, Object.keys(R.done).length, R.imports.length, R.by, A.obProgress(R)], ['2026-10-05', 8, 0, 1, 'jamie', { n: 8, left: 8, holdLeft: 2, hold: 2, amt }], 'imported: the 8 failed payments, none ticked; 2 on HOLD; the total not drafted');
    const ids = R.rows.map(A.obRowId);
    ok(new Set(ids).size === 8, 'each failed payment has an id of its own');
    A.obTick(rec, [ids[0], ids[2]], true, { by: 'jamie' }, t0 + 60000);
    R = A.normOBRep(rec);
    eq([A.obProgress(R).left, A.obProgress(R).holdLeft, R.done[ids[0]].by], [6, 1, 'jamie'], 'two ticked as texted (one on HOLD): 6 left, 1 of them on HOLD');
    A.obTick(rec, [ids[2]], false, {}, t0 + 120000); A.obTick(rec, ['nope|x|1'], true, {}, t0);
    eq([A.obProgress(A.normOBRep(rec)).left, 'nope|x|1' in rec.done], [7, false], 'unticking one; a tick for a payment that isn’t on the report is ignored');
    const again = Object.assign({}, ob, { rows: ob.rows.slice(0, 5).concat([{ ref: 'ob04100012', acct: '12350', patient: 'New Person', rp: 'Pat Person', amt: 80, bal: 160, reason: 'Credit Card - Declined', date: '2026-10-02', how: 'Pmt', hold: false, status: 'FAIL' }]) });
    A.obImport(rec, again, { day, by: 'taylor' }, t0 + 3600000);
    R = A.normOBRep(rec);
    eq([R.rows.length, Object.keys(R.done), R.imports.map(x => x.by), R.by], [6, [ids[0]], ['jamie', 'taylor'], 'taylor'], 'imported again: the new list; the tick on the one still there stays; both imports remembered');
    ok(A.normOBRep({ obrep: 1, day: 'bad' }) === null && A.normOBRep({ book: 1 }) === null && A.normOBRep(null) === null && A.normOBRep({ obrep: 1, day: '2026-10-05', locked: true }) === null, 'only a real import record is read');
    const junk = A.normOBRep({ obrep: 1, day: '2026-10-05', rows: [{ ref: 5, patient: '<b>x</b>'.repeat(50), amt: 'lots', hold: 'yes', date: '10/02/2026' }], done: { zz: { at: 1 } } });
    ok(junk.rows[0].patient.length <= 80 && junk.rows[0].amt === null && junk.rows[0].hold === false && junk.rows[0].date === '' && !Object.keys(junk.done).length, 'odd values are cleaned up');

    // earlier failures; the reminder counts an imported report as checked
    const old = A.normOBRep(Object.assign(A.emptyOBRep('2026-09-26'), { rows: [ob.rows[0], Object.assign({}, ob.rows[3], { ref: 'ob99999999' }), Object.assign({}, ob.rows[5], { ref: 'ob99999998', acct: '' })] }));
    const older = A.normOBRep(Object.assign(A.emptyOBRep('2026-09-12'), { rows: [ob.rows[0]] }));
    eq(ob.rows.map(r => A.obEarlier([old, older, R], '2026-10-05', r).join(',')), ['2026-09-26,2026-09-12', '', '', '2026-09-26', '', '', '', ''], 'failed before: the same OB reference or the same Edge account #, newest first');
    const b = A.emptyBook();
    eq([A.obState(A.normBook(b), '2026-10-06', ['2026-10-05']).due, A.obState(A.normBook(b), '2026-10-06', []).due.date], [null, '2026-10-05'], 'an imported report counts as checked; without it the reminder stays');
    eq(A.obState(A.normBook(b), '2026-10-20', ['2026-10-05']).missed.date, '2026-10-12', 'a report day with neither a check nor an import is pointed out with the next one');
    ok(JSON.stringify(accts.map(a => a.key)) === JSON.stringify(accts.map(a => A.acctOf(a, cfg, '2026-10-05').key)), 'matching and importing leave the accounts as they were');
  }

  section('Office days and settings');
  eq(['2026-10-09', '2026-10-10', '2026-11-25', '2026-12-24', '2026-12-25', '2026-09-07'].map(A.nextOfficeDay), ['2026-10-12', '2026-10-12', '2026-11-30', '2026-12-24', '2026-12-28', '2026-09-08'],
    'office days: Mon–Thu, skipping Thanksgiving week, Christmas, Labor Day');
  eq(A.arCfg({ ar: { inst: 0, writeOff: -1, tiers: [90, 60, 365], dueDay: 6, goalPt: 0, goalIns: 140, kpiFrom: 7 } }), { inst: 11.11, writeOff: 100, tiers: [60, 120, 365], dueDay: 2, goalPt: 4, goalIns: 4, kpiFrom: 31 }, 'bad settings fall back to the usual numbers (report due Tuesday, goals 4% and 4%, counted from 31 days)');
  eq([A.arCfg({}).kpiFrom, A.arCfg({ ar: { kpiFrom: 1 } }).kpiFrom], [31, 1], 'the patient goal counts from 31 days unless Settings say from day 1');
  eq(A.arCfg({ ar: { inst: 12.5, writeOff: 50, tiers: [30, 90, 200], dueDay: 3, goalPt: 3.5, goalIns: 5, kpiFrom: 31 } }), { inst: 12.5, writeOff: 50, tiers: [30, 90, 200], dueDay: 3, goalPt: 3.5, goalIns: 5, kpiFrom: 31 }, 'good settings are used');
  eq(A.arCfg({ ar: { staleDays: 21 } }).dueDay, 2, 'an older settings record (report "old after N days") gets the usual Tuesday due day');

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
  eq(RD('2026-09-28', '2026-10-06', 9), ['today', '2026-10-06', 0], 'a bad due day means Tuesday, the usual');
  eq(RD('2026-09-28', '2026-10-07', undefined), ['late', '2026-10-06', 1], 'no due day: Tuesday — late on Wednesday');
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
