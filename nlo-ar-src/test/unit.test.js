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

  section('Edge notes: what was done, as a line to paste into Edge');
  {
    const a = A.acctOf(row({ due: 300, b90: 300 }), cfg, '2026-10-05'), it = A.blankItem(a), at = (d, h) => new Date(2026, 9, d, h || 10).getTime();
    const who = s => ({ jamie: 'Jamie', amir: 'Dr. A' })[s] || '', note = e => A.edgeNoteOf(it, e, who, '');
    A.applyLog(it, 'pt_vm', { by: 'jamie' }, at(5));                                            // Monday → follow up Thursday the 8th
    A.applyLog(it, 'pt_text', { by: 'jamie', note: 'sent the payment link' }, at(8));           // Thursday → follow up Monday the 12th
    A.applyLog(it, 'pt_promise', { by: 'jamie', date: '2026-10-15', amt: 200 }, at(8, 11));
    A.applyLog(it, 'pt_spoke', { by: 'amir' }, at(8, 12));
    eq(it.log.map(note), ['10/05/26 Called RP, left voicemail. Next F/U 10/08/26. -Jamie', '10/08/26 Texted RP. Sent the payment link. Next F/U 10/12/26. -Jamie',
      '10/08/26 RP promised to pay $200.00 by 10/15/26. -Jamie', '10/08/26 Spoke with RP. Next F/U ' + A.mdy(it.follow) + '. -Dr. A'],
      'each log: the date, what was done (as the FC writes it in Edge), the note, the follow-up it set, who did it');
    A.resolveItem(it, 'paid', { by: 'jamie', note: 'paid by card' }, at(9));
    eq([note(it.log[3]), note(it.log[4])], ['10/08/26 Spoke with RP. -Dr. A', '10/09/26 Account resolved: paid. Paid by card. -Jamie'], 'resolved: the outcome; no follow-up left to give');
    const L = (k, o, x) => A.edgeNoteText(Object.assign({ at: at(6), k }, o || {}), x || {});
    eq([L('ladder', { step: 'l1' }, { who: 'Jamie' }), L('ladder', { step: 'l3' }), L('ladder', { step: 'l4' }), L('ladder', { step: 'l5', note: 'Certified #9407 1112' }, { who: 'Jamie' }),
      L('ladder', { step: 'd0' }), L('ladder', { step: 'c75' }), L('ladder', { step: 't8' }), L('ladder', { step: 'aa' })],
      ['10/06/26 Sent FC- #1, Friendly Reminder (mail or email); texted FC- Delinquent #1. -Jamie', '10/06/26 Sent FC- #3 - Stronger FC Notice (mail or email) and called RP; texted FC- Delinquent #3.',
        '10/06/26 Sent FC- #4, Doctors First Letter (mail and email); texted FC- Delinquent #4.',
        '10/06/26 Sent FC- #5, Maint. Hold + Discont. Warning (certified + regular mail + email); texted FC- Delinquent #5 &6. Certified #9407 1112. -Jamie',
        '10/06/26 Texted RP: the payment didn’t go through.', '10/06/26 Called and texted RP (FC- Delinquent #7) about the Maintenance Hold.', '10/06/26 Texted RP FC- Delinquent #8.',
        '10/06/26 Sent FC- #8, Broken Arrangement (certified + regular mail + email).'],
      'collection steps: the letter by Edge’s name, how it went, the text by Weave’s name, the certified tracking number');
    eq([L('ins_call', { note: 'claim in review' }, { carrier: 'Delta Dental', who: 'Taylor', follow: '2026-10-20' }), L('ins_call', { note: 'Called Delta Dental: claim in review' }, { carrier: 'Delta Dental' }),
      L('ins_denied', { note: 'over the age limit' }, { carrier: 'Delta Dental' }), L('ins_portal'), L('ins_pt'), L('cr_refreq'), L('cr_hold')],
      ['10/06/26 Called Delta Dental. Claim in review. Next F/U 10/20/26. -Taylor', '10/06/26 Called Delta Dental: claim in review.', '10/06/26 Claim denied by Delta Dental. Over the age limit.',
        '10/06/26 Checked the insurance portal.', '10/06/26 Billed the insurance balance to the family.', '10/06/26 Refund requested; waiting for Dr. A’s OK.', '10/06/26 Holding the credit until insurance pays out.'],
      'insurance: the carrier named when the account has one (a call logged for all of a carrier’s accounts isn’t said twice); credits');
    eq([L('drA_ask', { note: 'OK to refund $125 by check?' }, { who: 'Jamie' }), L('drA_ok', {}, { who: 'Dr. A' }), L('drA_no', { note: 'wait for the EOB' }), L('drA_ask', { step: 'l5' }), L('drA_ok', { step: 'l5' }),
      L('mhold_on'), L('mhold_off'), L('aa_broken'), L('note', { note: 'Mom will call Friday' }, { who: 'Jamie' })],
      ['10/06/26 Asked Dr. A: OK to refund $125 by check? -Jamie', '10/06/26 Dr. A approved. -Dr. A', '10/06/26 Dr. A: not yet. Wait for the EOB.',
        '10/06/26 Letter #5 (FC- #5, Maint. Hold + Discont. Warning) to Dr. A to sign.', '10/06/26 Dr. A signed Letter #5 (FC- #5, Maint. Hold + Discont. Warning).',
        '10/06/26 Placed on Maintenance Hold (comfort visits only).', '10/06/26 Maintenance Hold lifted.', '10/06/26 Alternative Arrangement broken; Letter #8 is next.', '10/06/26 Mom will call Friday. -Jamie'],
      'Dr. A’s OKs and signatures, Maintenance Hold, a broken arrangement, a note on its own');
    eq([L('edgetask', { note: 'LETTERS - x' }), L('reopen'), L('done', { outcome: 'cleared', note: 'Not in the Oct 5 report' }), A.edgeNoteText({ k: 'pt_vm' }, {}), A.edgeNoteOf(it, null, who, '')], ['', '', '', '', ''],
      'nothing for what came from Edge (an imported task, an account cleared in Edge) or a reopened account');
    eq([A.obEdgeNote({ amt: 175, date: '2026-10-02', reason: 'Credit Card - Declined Insufficient Funds', hold: true }, { at: at(5), by: 'jamie' }, 'Jamie'), A.obEdgeNote({ amt: 150, reason: '' }, { at: at(5) }, ''), A.obEdgeNote({ amt: 1 }, null, 'x')],
      ['10/05/26 Texted RP: OrthoBanc draft of $175.00 on 10/02/26 failed (Credit Card - Declined Insufficient Funds). OrthoBanc stopped drafting (on HOLD). -Jamie', '10/05/26 Texted RP: OrthoBanc draft of $150.00 failed.', ''],
      'a family ticked as texted on OrthoBanc’s failed-payment list: the chart note for day 0');
    ok(A.edgeNoteText({ at: at(6), k: 'note', note: 'x'.repeat(2000) }, {}).length === 1000 && A.mdy('2026-01-09') === '01/09/26' && A.mdy('') === '', 'a note stays a sensible length; dates as MM/DD/YY');
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

  section('Alternative Arrangements (Past due → Arrangements)');
  {
    const at = (y, m, d, h) => new Date(y, m - 1, d, h || 10).getTime(), T = o => A.aaTerms(o), yr = s => s.replace(/, 20\d\d/g, ''); // dates read the same in any year
    // the terms, as typed on the form or read back
    eq(A.aaTerms({ pay: '$1,175.50', n: '12', start: '2026-11-01', day: '5', down: '200' }), { pay: 1175.5, n: 12, start: '2026-11-01', day: 5, down: 200 }, 'terms as typed: an amount with $ and commas, whole months, a start date, the drafting day, a down payment');
    eq([A.aaTerms({}), A.aaTerms(null), A.aaTerms({ pay: 'abc', n: '0', start: '11/1/2026', day: '40', down: '-5' }), A.aaTerms({ n: 12.5, pay: 0 }), A.aaTerms({ n: 121, pay: 100000, day: 0 })], [null, null, null, null, null],
      'nothing sensible in it: no terms (each value checked, out-of-range ones dropped)');
    eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(A.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st'], 'the drafting day said as the 5th, the 12th…');
    // the payments' days
    eq([A.aaFirst(T({ start: '2026-11-01', day: 5 })), A.aaFirst(T({ start: '2026-10-20', day: 5 })), A.aaFirst(T({ start: '2026-10-20' })), A.aaFirst(T({ start: '2026-10-12', day: 12 })), A.aaFirst(T({ pay: 100 }))],
      ['2026-11-05', '2026-11-05', '2026-10-20', '2026-10-12', ''], 'the first payment: the drafting day on or after the start (that month, or the next) — the start itself with no day');
    const t31 = T({ start: '2027-01-31', day: 31, n: 4 });
    eq([1, 2, 3, 4].map(k => A.aaPayDate(t31, k)), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'], 'drafted on the 31st: the month’s last day when it’s shorter');
    const t12 = T({ pay: 175, n: 10, start: '2026-11-01', day: 12 });
    eq(A.aaSched(t12, '2026-10-22'), { first: '2026-11-12', last: '2027-08-12', n: 10, due: 0, next: { k: 1, date: '2026-11-12' } }, 'before the first payment: none due, the first is next');
    eq(A.aaSched(t12, '2026-12-13'), { first: '2026-11-12', last: '2027-08-12', n: 10, due: 2, next: { k: 3, date: '2027-01-12' } }, 'a month in: 2 were due, the 3rd is next');
    eq([A.aaSched(t12, '2026-12-12').next, A.aaSched(t12, '2027-09-01').next, A.aaSched(t12, '2027-09-01').due], [{ k: 2, date: '2026-12-12' }, null, 10], 'on a payment’s day that one is next; once all ten days have passed, none');
    eq(A.aaSched(T({ pay: 175, start: '2026-11-12', day: 12 }), '2030-01-20').next, { k: 40, date: '2030-02-12' }, 'the number of months not known: they go on');
    eq([A.aaFollow(t12, '2026-10-22'), A.aaFollow(t12, '2026-11-13'), A.aaFollow(t12, '2027-09-01')], ['2026-11-16', '2026-12-15', ''], 'look again a few days after the next payment, on an office day (Thu Nov 12 → Mon Nov 16; Sat Dec 12 → Tue Dec 15); none once they’re all past');
    eq(A.aaTermsSay(T({ pay: 175, n: 10, start: '2026-11-01', day: 12, down: 200 })), '$175.00 a month for 10 months, starting 11/12/26 (drafted on the 12th); $200.00 paid when it was made', 'the terms in words, for Edge');
    eq([A.aaTermsSay(T({ n: 6 })), A.aaTermsSay(T({ start: '2026-11-05' })), A.aaTermsSay(T({ down: 50 })), A.aaTermsSay(null)], ['6 monthly payments', 'payments starting 11/05/26', '$50.00 paid when it was made', ''], '…as much as was given');
    eq([A.aaTermsShort(t12), A.aaTermsShort(T({ pay: 175.5 })), A.aaTermsShort(T({ n: 6, day: 5 }))], ['$175/mo × 10 · the 12th', '$175.50/mo', '6 payments · the 5th'], 'and in a few words, for the list');

    // made, worked, its terms
    const pa = o => A.acctOf(row(Object.assign({ due: 350, b0: 175, b30: 175, days: 40, bal: 2100, recv: '2026-08-20', lastAmt: 175 }, o)), cfg, '2026-10-05');
    const it1 = A.blankItem(pa());
    const e1 = A.applyLog(it1, 'pt_plan', { by: 'sarah', note: 'Signed the Altered Arrangement', aa: { pay: '175', n: '10', start: '2026-11-01', day: '12', down: '' } }, at(2026, 10, 22));
    eq([it1.stage, it1.follow, e1.aa, A.logLabel(e1)], ['plan', '2026-11-16', { pay: 175, n: 10, start: '2026-11-01', day: 12 }, 'Payment plan (AA) made'], 'made with its terms: on an arrangement (Payment plan (AA)), followed up a few days after the first payment');
    const it0 = A.blankItem(pa()); A.applyLog(it0, 'pt_plan', { by: 'sarah' }, at(2026, 10, 22));
    eq([it0.stage, it0.follow, it0.log[0].aa], ['plan', '2026-11-23', undefined], '…without terms: followed up in 30 days (an office day)');
    A.applyLog(it1, 'pt_text', { by: 'sarah' }, at(2026, 10, 26)); A.applyLog(it1, 'pt_promise', { by: 'sarah', date: '2026-11-12' }, at(2026, 10, 27));
    eq([it1.stage, it1.follow], ['plan', '2026-11-12'], 'texts and promises logged on it keep it on the arrangement (a promise still sets its follow-up)');
    A.undoLog(it1); eq([it1.stage, it1.follow], ['plan', '2026-10-29'], 'undo puts the follow-up back');
    const itx = A.blankItem(pa()); A.applyLog(itx, 'pt_text', { by: 'sarah' }, at(2026, 10, 26)); eq(itx.stage, 'waiting', 'an account not on one: as before');
    A.applyLog(it1, 'aa_ok', { by: 'sarah', note: 'First payment posted' }, at(2026, 11, 13));
    eq([it1.stage, it1.follow, A.logLabel(it1.log[it1.log.length - 1])], ['plan', '2026-12-15', 'AA payment in'], 'a payment in: still on it, followed up after the next payment (Dec 12 → Tue Dec 15)');
    const itn = A.blankItem(pa()); A.applyLog(itn, 'pt_plan', { by: 'sarah' }, at(2026, 10, 22)); A.applyLog(itn, 'aa_ok', { by: 'sarah' }, at(2026, 11, 13));
    eq(itn.follow, '2026-12-14', '…with no terms: in 30 days');
    let err = null; try { A.applyLog(A.blankItem(pa()), 'aa_terms', { by: 'sarah', aa: { day: '' } }, 1); } catch (x) { err = x.code; }
    eq(err, 'need-terms', 'terms need something filled in');
    A.applyLog(it0, 'aa_terms', { by: 'sarah', aa: { pay: 150, n: 12, start: '2026-11-19', day: 19 } }, at(2026, 10, 23));
    eq([A.aaTermsOf(it0), it0.follow, it0.stage], [{ pay: 150, n: 12, start: '2026-11-19', day: 19 }, '2026-11-23', 'plan'], 'terms added later are the account’s terms (its follow-up and status stay)');
    A.applyLog(it0, 'pt_plan', { by: 'sarah' }, at(2026, 10, 24));
    eq(A.aaTermsOf(it0), null, 'a new arrangement without terms: the old ones don’t carry over');
    const n1 = A.normItem({ id: 'x', state: 'open', stage: 'plan', log: [{ k: 'pt_plan', at: 1, aa: { pay: '175', n: 10, start: '2026-11-01', day: 12, evil: '<x>' } }, { k: 'aa_terms', at: 2, aa: { pay: -1 } }, { k: 'pt_vm', at: 3, aa: { pay: 5 } }, { k: 'aa_ok', at: 4 }] });
    eq([n1.stage, n1.log.map(e => [e.k, e.aa || null])], ['plan', [['pt_plan', { pay: 175, n: 10, start: '2026-11-01', day: 12 }], ['aa_terms', null], ['pt_vm', null], ['aa_ok', null]]], 'read back: the terms only on the entries that carry them, each value checked');
    const who = s => ({ sarah: 'Sarah' })[s] || '', en = (it, e) => A.edgeNoteOf(it, e, who, '');
    eq([en(it1, it1.log[0]), en(it1, it1.log[it1.log.length - 1]), en(it0, it0.log[0]), en(it0, it0.log[1])],
      ['10/22/26 Alternative Arrangement (AA) made: $175.00 a month for 10 months, starting 11/12/26 (drafted on the 12th). Signed the Altered Arrangement. Next F/U 11/16/26. -Sarah',
        '11/13/26 AA payment received; the arrangement is on track. First payment posted. Next F/U 12/15/26. -Sarah', '10/22/26 Alternative Arrangement (AA) made. Next F/U 11/23/26. -Sarah',
        '10/23/26 AA terms: $150.00 a month for 12 months, starting 11/19/26 (drafted on the 19th). -Sarah'], 'Edge notes: made (with its terms), a payment in, terms added');

    // where an arrangement stands
    const AT = (it, a, p, o) => A.aaState(it, a, p, Object.assign({ asOf: '', prevAsOf: '', today: '2026-10-23', ob: [], lad: null }, o)), ks = s => (s ? s.why.map(w => w.k) : null);
    const mk = terms => { const it = A.blankItem(pa()); A.applyLog(it, 'pt_plan', { by: 'sarah', aa: terms }, at(2026, 10, 22, 15)); return it; }, TT = { pay: 175, n: 10, start: '2026-11-01', day: 12 };
    const iA = mk(TT), aNow = pa();
    let s = AT(iA, aNow, null, { asOf: '2026-10-22', prevAsOf: '2026-10-15' });
    eq([s.st, s.src, s.madeOn, s.by, ks(s), s.focus, s.sched.next], ['new', 'app', '2026-10-22', 'sarah', ['pd'], null, { k: 1, date: '2026-11-12' }], 'just made: New — past due on the report, the first payment next');
    s = AT(iA, aNow, A.acctOf(row({ due: 175, b0: 175, days: 10 }), cfg, '2026-10-15'), { asOf: '2026-10-22', prevAsOf: '2026-10-15' });
    ok(!ks(s).some(k => k === 'up' || k === 'again'), 'a report from before it was made isn’t held against it');
    eq([AT(A.blankItem(pa()), null, null, {}), (() => { const x = mk(null); A.resolveItem(x, 'paid', { by: 'sarah' }, 5); return AT(x, null, null, {}); })()], [null, null], 'not on one, or resolved: nothing');
    {
      const x = mk(TT); A.resolveItem(x, 'paid', { by: 'sarah' }, at(2026, 11, 2)); A.reopenItem(x, { by: 'sarah' }, at(2026, 11, 2, 11));
      const y = mk(TT); A.resolveItem(y, 'paid', { by: 'sarah' }, at(2026, 11, 2)); A.reopenItem(y, { by: 'sarah', note: 'On the list again', fresh: true }, at(2026, 11, 20)); A.applyLog(y, 'pt_vm', { by: 'sarah' }, at(2026, 11, 20, 11));
      eq([x.stage, AT(x, null, null, {}).st, y.stage, AT(y, null, null, {})], ['plan', 'new', 'waiting', null],
        'reopened by hand: still on it; past due again after being resolved (a new round): that arrangement is over, and logging works as on any account');
    }
    // OrthoBanc's failed drafts
    const ob = (date, o) => [{ day: '2026-11-12', row: Object.assign({ amt: 175, date, reason: 'Credit Card - Declined', hold: false }, o || {}) }];
    s = AT(iA, aNow, null, { asOf: '2026-11-09', today: '2026-11-13', ob: ob('2026-11-12') });
    eq([s.st, s.why[0].k, s.why[0].tone, s.focus.kind], ['check', 'ob', 'red', 'aamiss'], 'a draft that failed since it was made: Check — first, and urgent in Focus');
    ok(yr(s.why[0].t) === 'OrthoBanc: the $175.00 draft of Nov 12 failed (Credit Card - Declined)' && /^Arrangement — OrthoBanc/.test(s.focus.why), 'it says which draft and why: ' + s.why[0].t);
    ok(/OrthoBanc stopped drafting/.test(AT(iA, aNow, null, { today: '2026-11-13', ob: ob('2026-11-12', { hold: true }) }).why[0].t), 'on HOLD: it says OrthoBanc stopped drafting');
    ok(!ks(AT(iA, aNow, null, { today: '2026-11-13', ob: [{ day: '2026-10-12', row: { amt: 175, date: '2026-10-09' } }] })).includes('ob'), 'a draft that failed before it was made isn’t this arrangement’s');
    const iB = mk(TT); A.applyLog(iB, 'aa_ok', { by: 'sarah' }, at(2026, 11, 13));
    s = AT(iB, aNow, null, { today: '2026-11-14', ob: ob('2026-11-12') });
    ok(!ks(s).includes('ob') && s.ok && s.ok.k === 'aa_ok', '“Payment in — on track” logged after it: settled');
    // a payment the newest report should show
    const aR = r => pa({ recv: r });
    s = AT(iA, aR('2026-08-20'), null, { asOf: '2026-11-16', today: '2026-11-17' });
    eq([s.st, s.why[0].k, s.focus.kind], ['check', 'miss', 'aamiss'], 'the newest report doesn’t have the Nov 12 payment: Check (urgent)');
    ok(yr(s.why[0].t) === 'The Nov 12 payment isn’t on Edge’s Nov 16 report (last payment Aug 20)', s.why[0].t);
    eq([s.focus.since, AT(iA, aNow, null, { asOf: '2026-11-09', today: '2026-11-13', ob: ob('2026-11-12') }).focus.since], ['2026-11-16', '2026-11-12'], 'each reason keeps the day it was known: the report’s, the OrthoBanc report’s');
    eq(['2026-11-12', '2026-11-03', '2026-11-01'].map(r => ks(AT(iA, aR(r), null, { asOf: '2026-11-16', today: '2026-11-17' })).includes('miss')), [false, false, true], 'a payment on its day, or up to 10 days early, counts for it');
    ok(!ks(AT(iA, aR('2026-08-20'), null, { asOf: '2026-11-14', today: '2026-11-17' })).includes('miss'), 'a report from less than 3 days after the payment’s day: too early to tell');
    const iC = mk(TT); A.applyLog(iC, 'aa_ok', { by: 'sarah' }, at(2026, 11, 17));
    ok(!ks(AT(iC, aR('2026-08-20'), null, { asOf: '2026-11-16', today: '2026-11-18' })).includes('miss'), 'checked after that report ran (the payment came in after it): settled');
    // past due, against the report before
    const P = pd => (pd ? A.acctOf(row({ due: pd, b0: pd, days: 5, bal: 2000, recv: '2026-11-12' }), cfg, '2026-11-09') : null);
    const N = pd => A.acctOf(row({ due: pd, b0: pd, days: pd ? 5 : null, bal: 2000, recv: '2026-11-12' }), cfg, '2026-11-16');
    const cmpK = (n, p, prev) => ks(AT(iA, N(n), P(p), { asOf: '2026-11-16', prevAsOf: prev || '2026-11-09', today: '2026-11-17' }));
    eq([cmpK(175, 0), cmpK(350, 175), cmpK(175, 350), cmpK(0, 175), cmpK(175, 175), cmpK(175, 0, '2026-10-15')], [['again'], ['up'], ['down'], ['down'], ['pd'], ['pd']],
      'against the report before: past due again, up, down, caught up, the same — and nothing when that report is from before it was made');
    s = AT(iA, N(175), null, { asOf: '2026-11-16', prevAsOf: '2026-11-09', today: '2026-11-17' });
    ok(s.st === 'check' && s.focus.kind === 'aacheck' && yr(s.why[0].t) === 'Past due again: $175 on Nov 16, nothing on Nov 9', 'past due again: Check (for today, in Focus) — ' + s.why[0].t);
    ok(yr(AT(iA, N(0), P(175), { asOf: '2026-11-16', prevAsOf: '2026-11-09', today: '2026-11-17' }).why[0].t) === 'Caught up since Nov 9', 'caught up: says so');
    s = AT(iA, N(175), null, { asOf: '2026-11-16', prevAsOf: '2026-11-09', today: '2026-11-17', ob: ob('2026-11-12') });
    eq(s.why.map(w => w.tone), ['red', 'amber'], 'the most important first (red, then amber)');
    // current, paid off, every payment's day passed
    s = AT(iA, null, null, { asOf: '2026-11-16', today: '2026-11-17' });
    eq([s.st, ks(s)], ['ok', ['cur']], 'not past due on the newest report (current in Edge): On track');
    s = AT(iA, null, null, { asOf: '2026-11-16', full: true, today: '2026-11-17' });
    ok(s.st === 'check' && ks(s).join() === 'end' && s.focus.kind === 'aaend' && yr(s.why[0].t) === 'Not on Edge’s Nov 16 report, which leaves out $0 balances — paid off? Check Edge, then resolve it as paid',
      'not on a report that has every account with a balance and keeps the arrangements: a $0 balance — paid off? (Check) — ' + s.why[0].t);
    eq([ks(AT(iA, null, null, { asOf: '', today: '2026-11-17' })), ks(AT(iA, N(175), null, { asOf: '', prevAsOf: '', today: '2026-11-17' }))], [[], []], 'a newest report without the past-due accounts (credit balances only): nothing said from it');
    s = AT(iA, A.acctOf(row({ due: 0, bal: 0, recv: '2026-11-12' }), cfg, '2026-11-16'), null, { asOf: '2026-11-16', today: '2026-11-17' });
    eq([s.st, s.why[0].k, s.focus.kind], ['check', 'end', 'aaend'], 'a balance of $0 on the report: paid off — resolve it');
    s = AT(iA, null, null, { today: '2027-08-20' });
    ok(s.st === 'check' && ks(s).join() === 'end' && s.focus.kind === 'aaend' && s.sched.next === null && /^All 10 payments were due by Aug 12(, 2027)? — once the balance is paid, resolve it as paid$/.test(s.why[0].t), 'every payment’s day passed: resolve it once it’s paid — ' + s.why[0].t);
    // Maintenance Hold
    const iH = mk(TT); A.holdLog(iH, true, { by: 'sarah' }, at(2026, 10, 22, 16));
    eq(ks(AT(iH, null, null, { today: '2026-11-13' })), ['holdw'], 'on Maintenance Hold: until the first payment is in');
    s = AT(iH, null, null, { today: '2026-11-15' });
    eq([s.st, s.why[0].k, s.focus.kind], ['check', 'hold', 'aahold'], 'a few days after the first payment’s day: lift the hold once it’s in (Check)');
    eq(ks(AT(iH, null, null, { today: '2026-11-15', ob: ob('2026-11-12') })), ['ob', 'holdw'], '…not while a draft has failed');
    A.holdLog(iH, false, { by: 'sarah' }, at(2026, 11, 16)); ok(!AT(iH, null, null, { today: '2026-11-16' }).hold, 'lifted: gone');
    // no terms; from Edge; set by hand
    const iN = A.blankItem(pa()); A.applyLog(iN, 'pt_plan', { by: 'sarah' }, at(2026, 10, 22));
    eq([ks(AT(iN, null, null, {})), AT(iN, null, null, {}).st, AT(iN, null, null, { today: '2026-11-20' }).st], [['terms'], 'new', 'ok'], 'no terms: says so; New for two weeks, then On track while nothing’s flagged');
    const iE = A.blankItem(pa());
    A.edgeTasksApply(iE, [{ id: 'tabc12', title: 'AA MADE - Avery Sample', due: '2026-10-30', desc: '$40 every other Friday', op: 'Jamie' }], { by: 'jamie', today: '2026-10-08', aa: true }, at(2026, 10, 8));
    s = AT(iE, aNow, aNow, { asOf: '2026-10-22', prevAsOf: '2026-10-15' });
    eq([iE.stage, s.src, s.madeOn, s.st, ks(s)], ['plan', 'edge', '', 'ok', ['pd', 'terms']], 'an “AA MADE” task from Edge: on an arrangement, the day it was made not known');
    const iS = A.blankItem(pa()); iS.stage = 'plan'; eq(AT(iS, null, null, {}).src, 'status', 'its status set by hand: on one too');
    // broken — Letter #8, then the 30 days (as on the collections ladder); a new arrangement instead
    const a70 = A.acctOf(row({ due: 525, b0: 175, b30: 175, b60: 175, days: 70, bal: 2100 }), cfg, '2026-10-05');
    const iK = A.blankItem(a70); A.applyLog(iK, 'pt_plan', { by: 'sarah' }, at(2026, 9, 1)); A.breakArrangement(iK, { by: 'sarah' }, at(2026, 10, 5));
    const LK = d => A.ladState(a70, iK, '2026-10-05', d || '2026-10-05'), AK = d => AT(iK, a70, null, { asOf: '2026-10-05', today: d || '2026-10-05', lad: LK(d) });
    s = AK();
    ok(s.st === 'broken' && ks(s).join() === 'broken' && s.focus === null && iK.stage === 'working' && yr(s.why[0].t) === 'Broken Oct 5 — Letter #8 is due (Dr. A signs it)', 'broken: Broken — ' + s.why[0].t + ' (Focus has Letter #8 from the ladder)');
    A.askSign(iK, 'aa', { by: 'sarah' }, at(2026, 10, 5)); ok(/\(waiting for Dr\. A to sign\)$/.test(AK().why[0].t), 'waiting for his signature');
    A.answerDrA(iK, true, { by: 'amir' }, at(2026, 10, 5)); ok(/\(signed — send it\)$/.test(AK().why[0].t), 'signed: send it');
    A.ladderLog(iK, 'aa', { by: 'sarah', note: 'Certified #1' }, at(2026, 10, 6));
    ok(yr(AK('2026-10-07').why[0].t) === 'Broken Oct 5 — Letter #8 went out Oct 6; the 30 days end Nov 5' && /Debond\/Finish$/.test(AK('2026-11-05').why[0].t), 'sent: the 30 days, then Debond/Finish');
    A.applyLog(iK, 'pt_plan', { by: 'sarah', aa: { pay: 100, n: 6, start: '2026-11-05', day: 5 } }, at(2026, 10, 8));
    s = AK('2026-10-08');
    eq([s.st, !!s.broke, LK('2026-10-08').paused, LK('2026-10-08').fin, LK('2026-10-08').due], ['new', false, 'plan', null, null], 'a new arrangement made after Letter #8 (SOP-FO-003): on that one now — the 30 days stop, the ladder pauses');
    A.breakArrangement(iK, { by: 'sarah' }, at(2026, 10, 20));
    eq([LK('2026-10-20').due.id, AK('2026-10-20').st], ['aa', 'broken'], 'that one broken too: its own Letter #8 is due');
    A.ladderLog(iK, 'aa', { by: 'sarah' }, at(2026, 10, 21)); ok(!!LK('2026-10-21').fin, '…and can be recorded (one Letter #8 for each broken arrangement)');
    err = null; try { A.ladderLog(iK, 'aa', { by: 'sarah' }, at(2026, 10, 22)); } catch (x) { err = x.code; } eq(err, 'step-done', '…but not twice for the same one');
    // a new arrangement before Letter #8 went out: the request to sign it leaves Dr. A's list (and undo brings it back)
    const iQ = A.blankItem(a70); A.applyLog(iQ, 'pt_plan', { by: 's' }, 1); A.breakArrangement(iQ, { by: 's' }, 2); A.askSign(iQ, 'aa', { by: 's' }, 3);
    A.applyLog(iQ, 'pt_plan', { by: 's' }, 4);
    const lq = A.ladState(a70, iQ, '2026-10-05', '2026-10-05');
    eq([lq.due, lq.paused, !!lq.broke, iQ.drA], [null, 'plan', false, false], 'a new arrangement instead of Letter #8: none due, the request to sign it leaves Dr. A’s list, the ladder pauses');
    A.undoLog(iQ); eq([A.ladState(a70, iQ, '2026-10-05', '2026-10-05').due.id, iQ.drA], ['aa', true], 'undo: Letter #8 due again, waiting for him');

    // the import keeps the accounts on an arrangement even when they're current
    const F = (rows, sg) => ({ meta: { asOf: '2026-10-05', subgroup: sg || 'None', options: 'Exclude Zero Dollar Balances' }, rows });
    const cur = row({ patient: 'Avery Sample', rp: 'Jordan Sample', due: 0, bal: 1800, lastAmt: 175, recv: '2026-10-01' }), pdr = row({ patient: 'Blake Demo', rp: 'Pat Demo', due: 100, b0: 100, days: 10, bal: 900 });
    const kAv = A.acctKey(cur), keep = new Set([kAv]);
    eq([A.buildReport([F([cur, pdr])], { keep }).rows.map(r => r.key), A.buildReport([F([cur, pdr])]).rows.map(r => r.key)], [[A.acctKey(pdr), kAv], [A.acctKey(pdr)]], 'an account on an arrangement is kept when it’s current (and only then)');
    eq(A.buildReport([F([cur, Object.assign({}, cur, { bal: 500 }), pdr])], { keep }).rows.length, 1, 'two contracts under one name: neither current one is kept (they can’t be told apart)');
    eq(A.buildReport([F([Object.assign({}, cur, { due: 50, b0: 50, days: 5 }), cur])], { keep }).rows.map(r => [r.key, r.due]), [[kAv, 50]], 'one of them past due: it keeps the account’s key, the current one isn’t added');
    eq([A.buildReport([F([pdr], 'Past Due')], { keep: new Set([A.acctKey(pdr)]) }).rows.length, A.buildReport([F([row({ rp: 'INS: Jordan Sample', due: 0, bal: 400 })])], { keep: new Set([A.acctKey(row({ rp: 'INS: Jordan Sample' }))]) }).rows.length], [1, 0],
      'a subgroup file as before; never an insurance account');
    const rA = A.buildReport([F([cur, pdr])], { keep }), rB = A.buildReport([F([cur, pdr])]), sA = A.summarize(rA, cfg), sB = A.summarize(rB, cfg);
    ok(JSON.stringify([sA.pd, sA.cr, sA.book, sA.monthEnd, A.kpis(rA, cfg)]) === JSON.stringify([sB.pd, sB.cr, sB.book, sB.monthEnd, A.kpis(rB, cfg)]), 'kept, it changes no total, goal or Month-End number');
    ok(A.reportAccts(rA, cfg).filter(a => a.key === kAv).every(a => !a.bucket && !A.onLadder(a) && a.pd === 0 && a.credit === 0 && a.bal === 1800 && a.recv === '2026-10-01'), '…is on no list and not on the ladder — just its balance and last payment');
    eq([rA.aaKeep, A.buildReport([F([cur, pdr])], { keep: new Set() }).aaKeep, rB.aaKeep, A.buildReport([F([pdr], 'Past Due')], { keep }).aaKeep, A.normReport(rA).aaKeep, A.normReport(rB).aaKeep, A.normReport({ aaKeep: 'yes' }).aaKeep],
      [true, true, undefined, undefined, true, false, false], 'a full report imported this way says so (even with nobody on one yet), so one missing from it has a $0 balance; a subgroup file doesn’t; read back as is');

    // Focus
    const fctx = o => Object.assign({ accts: [], asOf: '2026-11-16', byKey: new Map(), item: () => null, lad: () => null, open: [], cleared: () => false, today: '2026-11-17', owner: false, prevPd: null, book: null, auditStart: '' }, o);
    const fe = A.focusEntries(fctx({ aa: [{ it: { key: 'k1' }, a: null, st: { focus: { kind: 'aamiss', why: 'Arrangement — x' } } }, { it: { key: 'k2' }, a: null, st: { focus: null } }, { it: { key: 'k3' }, a: null, st: { focus: { kind: 'aaend', why: 'Arrangement — y' } } }] }));
    eq(fe.map(e => [e.key, e.kind, e.cls, e.act]), [['k1', 'aamiss', 'urgent', 'Check'], ['k3', 'aaend', 'today', 'Resolve']], 'Focus: a missed payment is urgent, an arrangement all paid is for today; nothing flagged, nothing listed');
    const fe2 = A.focusEntries(fctx({ open: [{ key: 'k1', state: 'open', stage: 'plan', follow: '2026-11-17', log: [] }], aa: [{ it: { key: 'k1' }, a: null, st: { focus: { kind: 'aacheck', why: 'Arrangement — past due again' } } }] }));
    ok(fe2.length === 1 && fe2[0].kind === 'follow' && fe2[0].also.join() === 'Arrangement — past due again', 'one line per account: with its follow-up due too, the arrangement is under “Also”');
    const fit = (follow, d) => ({ key: 'k1', state: 'open', stage: 'plan', follow, log: d ? [{ k: 'pt_vm', at: at(2026, 11, d, 11) }] : [] });
    const fk = it => A.focusEntries(fctx({ open: [it], aa: [{ it, a: null, st: { focus: { kind: 'aamiss', why: 'Arrangement — x', since: '2026-11-16' } } }] })).map(e => e.kind).join();
    eq([fk(fit('2026-11-19', 17)), fk(fit('2026-11-17', 17)), fk(fit('2026-11-19', 15)), fk(fit('', 17))], ['', 'aamiss', 'aamiss', 'aamiss'],
      'worked after it came up, with a follow-up ahead: off Focus until that day, back on it then — and on it when it was worked before, or with no follow-up');
    const ip = A.blankItem(pa()); A.applyLog(ip, 'pt_plan', { by: 'sarah', aa: TT }, at(2026, 10, 22)); A.applyLog(ip, 'pt_promise', { by: 'sarah', date: '2026-11-13' }, at(2026, 11, 10));
    eq([ip.stage, A.focusEntries(fctx({ open: [ip] })).map(e => e.kind + ' ' + e.cls).join()], ['plan', 'promise urgent'], 'a promise made on an arrangement, its day passed: urgent, as on any account (the status stays on the arrangement)');
    const icr = A.blankItem(pa()); A.applyLog(icr, 'pt_plan', { by: 'sarah' }, 1); A.applyLog(icr, 'cr_review', { by: 'sarah' }, 2);
    eq(icr.stage, 'plan', 'a credit review logged on it keeps it on the arrangement too');
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

  section('Edge’s Insurance Aging: each insurance account’s carrier');
  {
    const IX = JSON.parse(fs.readFileSync(path.join(FX, 'ins-expected.json'), 'utf8'));
    const IKEYS = ['patient', 'acct', 'sts', 'rp', 'home', 'due', 'b0', 'b30', 'b60', 'b90', 'days', 'bal', 'lastAmt', 'recv', 'carrier', 'cphone'];
    const ipick = r => { const o = {}; IKEYS.forEach(k => { o[k] = r[k] === undefined ? null : r[k]; }); return o; };
    for (const [file, kind] of [['ins-aging.xls', 'xls'], ['ins-aging.tsv', 'text']]) {
      const p = await A.readReportFile(file, fs.readFileSync(path.join(FX, file)));
      ok(p.insAging === true && p.kind === kind && !p.ob, file + ': a file dropped on Reports is taken for the Insurance Aging (not an A/R report)');
      eq(p.rows.map(ipick), IX.rows, file + ': every account read, with its ID, “Recieved” date and carrier (' + p.rows.length + ')');
      eq(p.groups, IX.groups, file + ': the carrier lines — padded or short, a name with “ - ” in it, a broken phone, none at all');
      ok(p.check.ok === true && /each matching Edge’s count/.test(p.check.why) && /69 accounts/.test(p.check.why), file + ': adds up to Edge’s “(69 Total Patients)” line and each group to its “(N Patients)”: ' + p.check.why);
      ok(p.asOf === '2026-10-05' && p.meta.edge === '8.0.22.1003' && p.rows.every(r => !r.note), file + ': the date and Edge version; nothing left over as a note');
    }
    {
      // an account missing from a group (a damaged export) is caught by that group's own count
      const grid = (await A.readGridFile('x.xls', fs.readFileSync(path.join(FX, 'ins-aging.xls')))).sheets[0];
      const cut = grid.findIndex((r, i) => i > 9 && r && r[1] && /^99-/.test(String(r[1])));
      const p2 = A.insAgingFromGrid({ sheets: [grid.filter((r, i) => i !== cut)] });
      ok(p2.check.ok === false && /Bayou Dental Mutual: \d+ read, Edge says \d+/.test(p2.check.why), 'an account missing from a group is caught: ' + p2.check.why);
      const p3 = A.insAgingFromGrid({ sheets: [grid.filter(r => !(r && /^\(\d+ Total Patients\)$/.test(String(r[0]))))] });
      ok(p3.check.ok === false, 'so is a report cut off before Edge’s total line: ' + p3.check.why);
    }
    let notOurs = ''; try { await A.readInsAging('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls'))); } catch (e) { notOurs = e.message; }
    ok(/isn’t Edge’s Insurance Aging/.test(notOurs), 'the A/R Aging isn’t taken for the Insurance Aging');
    eq([['Aetna   -   8554966289'], ['Delta Dental - MA                                    -   (800) 872-0500            '], ['Delta Dental - MA'], ['Humana PPO'],
      ['Humana Comp Benefits                                 -   (800-943-6880       '], ['Delta Dental MI   -   1-800-448-3815'], ['Name   -   ']].map(([t]) => A.edgeCarrierLine(t)),
    [{ name: 'Aetna', phone: '8554966289' }, { name: 'Delta Dental - MA', phone: '(800) 872-0500' }, { name: 'Delta Dental - MA', phone: '' }, { name: 'Humana PPO', phone: '' },
      { name: 'Humana Comp Benefits', phone: '(800-943-6880' }, { name: 'Delta Dental MI', phone: '1-800-448-3815' }, { name: 'Name', phone: '' }], 'carrier lines: the name and phone, split at the last “ - ” before a phone number');
    // Edge v8's labels on the A/R Aging too: "ID", "Recieved", and "(N Total Patients)" as the total line (never an account)
    {
      const H = ['Patient', 'ID', null, 'Sts', 'Responsible Party', 'Home  Ph', 'Amt Due', '0-30', '31-60', '61-90', '91+', null, 'Days', null, 'Balance', null, 'Last Amt', 'Recieved'];
      const R = (pt, id, rp, due, b0, b90, days, bal, last, recv) => [pt, id, null, 'A-Comp Bra', rp, '(352) 555-0101', due, b0, 0, 0, b90, null, days, null, bal, null, last, recv];
      const grid = [['Accounts Receivable Aging', null, null, null, null, null, null, null, null, null, null, null, null, 46300.5], ['Accounts Receivable Aging'], ['Tuesday, October 6, 2026  Office: All,  Doctor: All'], ['Exclude Zero Dollar Balances'], ['Subgroup: None'], [], [], H,
        R('Avery Sample', '99-0001', 'Jordan Sample', 150, 150, 0, '12', 1950, 150, 46280), R('Riley Demo', '99-0002', 'INS: Alex Demo', -85, 0, 0, '0', -85, 85, 46100), R('Quinn Example', '99-0003', 'Pat Example', 400, 0, 400, '120', 400, null, null),
        ['(3 Total Patients)', null, null, null, null, null, 465, 150, 0, 0, 400, null, null, null, 2265], [], ['Edge v8.0.22.1003']];
      const p = A.edgeFromGrid({ sheets: [grid] }, 'v8.xls');
      eq([p.rows.length, p.rows.map(r => r.recv), p.rows.map(r => r.acct), p.rows.map(r => r.note), p.total && p.total.n, p.check.ok],
        [3, ['2026-09-15', '2026-03-19', ''], ['99-0001', '99-0002', '99-0003'], ['', '', ''], 3, true], 'A/R Aging with Edge v8’s labels: the “Recieved” dates and the IDs are read, and “(3 Total Patients)” is the total line, not an account');
    }
    // the carriers, filled in from it
    const rep = A.buildReport([await A.readEdgeAR('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls')))]), accts = A.reportAccts(rep, cfg), insA = accts.filter(a => a.ins);
    const p = await A.readInsAging('ins-aging.xls', fs.readFileSync(path.join(FX, 'ins-aging.xls')));
    const want = a => { const l = IX.rows.filter(r => A.normName(r.patient) === A.normName(a.patient) && A.normName(A.rpName(r)) === A.normName(A.rpName(a))); return (l.length > 1 ? l.find(r => Math.abs(r.bal - a.bal) < 0.005) : l[0] || {}).carrier || null; };
    const t1 = Date.UTC(2026, 9, 6, 13), ids = {}, idFor = n => ids[n] || (ids[n] = 'c' + String(Object.keys(ids).length + 1).padStart(12, '0'));
    const bk = A.emptyBook(), r1 = A.edgeCarriersApply(bk, p, { by: 'jamie', idFor }, t1);
    let b = A.normBook(bk);
    eq([b.carriers.map(c => c.name), b.carriers.map(c => c.phone)], [['Bayou Dental Mutual', 'Gator Benefits - FL', 'Heron Life Ins.', 'Manatee Concordia (Tricare)', 'Osprey Dental Plan', 'Pelican Dental', 'zz OLD - Heron Life'],
      ['(800) 555-0142', '1-800-555-0177', '', '(844)555-0199', '(800 555-0123', '8005550188', '8005550100']], 'Edge’s carriers are added with Edge’s phone numbers; one Edge lists twice (once without a phone) is one carrier');
    eq([r1.added.length, r1.accounts, r1.twice, b.edge && b.edge.asOf, b.edge && b.edge.n, b.edge && b.edge.by], [7, 68, 1, '2026-10-05', 69, 'jamie'], 'the import: 7 carriers, 68 accounts (one patient with two contracts at two carriers), its date and who');
    const got = insA.map(a => (A.carrierOf(b, a.key, a) || {}).name || null);
    ok(insA.length > 50 && insA.every((a, i) => got[i] === want(a)), 'every insurance account on the A/R report gets the carrier Edge lists it under (' + insA.length + ')');
    const tw = insA.find(a => A.normName(a.patient) === A.normName(IX.twice));
    ok(tw && A.carrierOf(b, tw.key, tw) && !A.carrierOf(b, tw.key) && A.carrierOf(b, tw.key, tw).name === want(tw), 'two contracts of one patient and policyholder at two carriers: told apart by the balance (' + (tw ? A.carrierOf(b, tw.key, tw).name : '') + ')');
    // a carrier set by hand always wins, and an import never changes it
    const h = insA.find(a => a !== tw && want(a) !== 'Pelican Dental'), pel = b.carriers.find(c => c.name === 'Pelican Dental').id;
    A.carrierTag(bk, [h.key], pel); b = A.normBook(bk);
    const s1 = A.carrierSrc(b, h.key, h);
    ok(s1.c.name === 'Pelican Dental' && s1.hand.name === 'Pelican Dental' && s1.edge.name === want(h) && s1.differs, 'set by hand: the hand-set carrier shows, and Edge’s is known (they differ)');
    A.edgeCarriersApply(bk, p, { by: 'sam', idFor }, t1 + 1000); b = A.normBook(bk);
    ok(A.carrierOf(b, h.key, h).name === 'Pelican Dental' && b.tags[h.key] === pel, 'importing again doesn’t touch it');
    A.carrierTag(bk, [h.key], ''); b = A.normBook(bk);
    ok(A.carrierOf(b, h.key, h).name === want(h) && !A.carrierSrc(b, h.key, h).hand, 'taking the hand-set carrier off goes back to Edge’s');
    // matched by name: a carrier the office added by hand is linked, its own details kept, a missing phone filled in
    const bk2 = A.emptyBook(), mine = A.carrierSave(bk2, { name: 'pelican   DENTAL', portal: 'https://provider.example.com/pelican', payer: 'PEL01' }, { by: 'jamie' }, t1);
    const own = A.carrierSave(bk2, { name: 'Bayou Dental Mutual', phone: '(800) 555-0000' }, { by: 'jamie' }, t1);
    let nx = 0; const r2 = A.edgeCarriersApply(bk2, p, { by: 'jamie', idFor: () => 'c' + String(++nx).padStart(12, 'e') }, t1); let b2 = A.normBook(bk2);
    const pc = b2.carriers.find(c => c.id === mine), bc = b2.carriers.find(c => c.id === own);
    eq([b2.carriers.length, r2.added.length, r2.linked, r2.phones, pc.name, pc.portal, pc.phone, pc.edge, bc.phone], [7, 5, 2, 1, 'pelican   DENTAL', 'https://provider.example.com/pelican', '8005550188', ['Pelican Dental'], '(800) 555-0000'],
      'a carrier already in the list is matched by name (case and spaces aside): linked, its portal and payer ID kept, its missing phone filled in, a phone it had kept');
    // renamed in the app: still Edge's carrier
    A.carrierSave(bk2, { id: own, name: 'Bayou (BDM)', phone: '(800) 555-0000' }, { by: 'jamie' }, t1 + 1);
    const r3 = A.edgeCarriersApply(bk2, p, { by: 'jamie' }, t1 + 2); b2 = A.normBook(bk2);
    ok(r3.added.length === 0 && b2.carriers.length === 7 && b2.carriers.find(c => c.id === own).edge[0] === 'Bayou Dental Mutual', 'a carrier renamed in the app keeps Edge’s name for it: the next import adds nothing');
    // merged: the old carrier's accounts — and Edge's name for it — go to the other one, for good
    const old = b2.carriers.find(c => c.name === 'zz OLD - Heron Life'), heron = b2.carriers.find(c => c.name === 'Heron Life Ins.');
    const oldAccts = insA.filter(a => (A.carrierOf(b2, a.key, a) || {}).id === old.id);
    A.carrierMerge(bk2, old.id, heron.id); b2 = A.normBook(bk2);
    const hr = b2.carriers.find(c => c.id === heron.id);
    ok(oldAccts.length > 0 && oldAccts.every(a => A.carrierOf(b2, a.key, a).id === heron.id) && !b2.carriers.some(c => c.id === old.id) && hr.phone === '8005550100' && hr.edge.join('|') === 'Heron Life Ins.|zz OLD - Heron Life',
      'merging “zz OLD - Heron Life” into “Heron Life Ins.”: its ' + oldAccts.length + ' accounts move, its phone fills the blank, Edge’s name for it goes along');
    const r4 = A.edgeCarriersApply(bk2, p, { by: 'jamie' }, t1 + 3); b2 = A.normBook(bk2);
    ok(r4.added.length === 0 && b2.carriers.length === 6 && oldAccts.every(a => A.carrierOf(b2, a.key, a).id === heron.id), 'and the next import keeps them there (nothing added back)');
    ok(/changed/.test((() => { try { A.carrierMerge(bk2, old.id, heron.id); return ''; } catch (e) { return e.message; } })()), 'merging a carrier that’s already gone is refused');
    // an older report never overrides a newer one; a year without an account lets it go
    const moved = insA[1], p12 = Object.assign({}, p, { asOf: '2026-10-12', rows: p.rows.map(r => A.normName(r.patient) === A.normName(moved.patient) ? Object.assign({}, r, { carrier: 'Gator Benefits - FL' }) : r) });
    const bk3 = A.emptyBook(); A.edgeCarriersApply(bk3, p12, { by: 'x' }, t1); const r5 = A.edgeCarriersApply(bk3, p, { by: 'x' }, t1 + 1); let b3 = A.normBook(bk3);
    ok(r5.older && b3.edge.asOf === '2026-10-12' && A.carrierOf(b3, moved.key, moved).name === 'Gator Benefits - FL', 'an older Insurance Aging imported after a newer one doesn’t undo it');
    bk3.etags['gone patient|someone|I'] = { c: bk3.carriers[0].id, d: '2025-08-01' };
    A.edgeCarriersApply(bk3, Object.assign({}, p, { asOf: '2026-10-19' }), { by: 'x' }, t1 + 2);
    ok(!bk3.etags['gone patient|someone|I'] && Object.keys(bk3.etags).length === 68, 'an account on no Insurance Aging for over a year is let go');
    // what's read back is checked; removing a carrier takes Edge's say about it too
    const nb2 = A.normBook({ book: 1, carriers: [{ id: 'c000000000001', name: 'Fine', edge: ['Fine', 'FINE', 7, 'Fine Co'] }], tags: {},
      etags: { a: { c: 'c000000000001', d: '2026-10-05' }, b: { c: 'c999999999999', d: '2026-10-05' }, c: { c: 'c000000000001', d: 'soon' }, d: { m: [{ c: 'c000000000001', bal: 5 }, { c: 'c999999999999', bal: 6 }], d: '2026-10-05' }, e: 'x' }, edge: { asOf: '2026-10-05', n: 3, groups: 'many' } });
    eq([nb2.carriers[0].edge, Object.keys(nb2.etags), nb2.etags.d.m.length, nb2.edge.n, nb2.edge.groups], [['Fine', 'Fine Co'], ['a', 'd'], 1, 3, 0], 'read back: Edge’s names deduplicated, links to carriers that aren’t there and bad dates dropped');
    const bk4 = A.emptyBook(); A.edgeCarriersApply(bk4, p, { by: 'x' }, t1); const gator = bk4.carriers.find(c => c.name === 'Gator Benefits - FL').id;
    A.carrierRemove(bk4, gator);
    ok(!Object.values(bk4.etags).some(v => v.c === gator || (v.m && v.m.some(x => x.c === gator))), 'removing a carrier drops Edge’s say about it');
    // the preview's numbers
    const bk5 = A.emptyBook(); A.carrierTag(A.bookFix(bk5), [], ''); const own5 = A.carrierSave(bk5, { name: 'Hand Picked Dental' }, {}, t1); A.carrierTag(bk5, [insA[0].key, insA[2].key], own5);
    const plan = A.edgeCarriersPlan(bk5, p, accts, { by: 'x' }, t1);
    eq([plan.ins, plan.got, plan.newly, plan.differ, plan.without, plan.added.length, plan.carriers], [insA.length, insA.length, insA.length - 2, 2, 0, 7, 8], 'the preview: every insurance account on the A/R report with a carrier, ' + (insA.length - 2) + ' getting one now, 2 set by hand that Edge has elsewhere');
    ok(JSON.stringify(bk5.etags) === '{}' && !bk5.edge, 'and the preview changes nothing');
    // focus sees a carrier from Edge (its filing limit)
    const bk6 = A.emptyBook(); A.edgeCarriersApply(bk6, p, { by: 'x' }, t1); const b6 = A.normBook(bk6);
    ok(insA.filter(a => A.carrierOf(b6, a.key, a)).length === insA.length, 'Focus and the lists see Edge’s carriers through the same lookup');
  }

  section('Edge’s task list: each task on its account');
  {
    const TX = JSON.parse(fs.readFileSync(path.join(FX, 'tasks-expected.json'), 'utf8')), TK = ['op', 'title', 'due', 'cat', 'creator', 'desc'];
    const tpick = t => { const o = {}; TK.forEach(k => { o[k] = t[k] === undefined ? null : t[k]; }); return o; };
    for (const [file, kind] of [['edge-tasks.xls', 'xls'], ['edge-tasks.tsv', 'text']]) {
      const p = await A.readReportFile(file, fs.readFileSync(path.join(FX, file)));
      ok(p.edgeTasks === true && p.kind === kind && !p.insAging && !p.ob, file + ': dropped on Reports, it’s taken for Edge’s task list');
      eq(p.tasks.map(tpick), TX.map(tpick), file + ': every task read — operator, title, due date, creator and the running description (its line breaks kept)');
      ok(p.check.ok === true && /18 tasks read \(Riley, Jamie\)/.test(p.check.why) && p.asOf === '2026-10-08', file + ': ' + p.check.why + ' · run ' + p.asOf);
    }
    let refused = ''; try { await A.readEdgeTasks('x', fs.readFileSync(path.join(FX, 'edge-full.xls'))); } catch (e) { refused = e.message; }
    ok(/isn’t Edge’s task list/.test(refused), 'the A/R Aging isn’t taken for a task list');
    eq([A.nameWords("Ja'Fakea Mockwell"), A.nameWords('Britt Testa-Fakewood'), A.nameWords('José Q Demo Jr'), A.nameDist('robni', 'robin'), A.nameDist('mockly', 'mockley'), A.nameDist('mockwell', 'mockwool')],
      [['jafakea', 'mockwell'], ['britt', 'testa', 'fakewood'], ['jose', 'q', 'demo'], 1, 1, 2], 'names: apostrophes, hyphens, accents and Jr. aside; two letters swapped count once');
    eq([A.nameWords('FakewellWaiting', true), A.nameWords('McKay', true), A.nameFit('PT - Robin McKay', 'Robin Mc Kay'), A.nameFit('PT - RobinMcKay', 'Robin McKay'),
      A.nameFit('INS MetLife Robin TestfieldWaiting for denial', 'Robin Testfield'), A.nameFit('PT - Robin Q Testfield', 'Robin Testfield'), A.nameFit('PT - Robni Testfield', 'Robin Testfield'),
      A.nameFit('INS TERMINATED Lane Fakewood', 'Lane Fake'), A.nameFit('LETTERS - Robin Testfield', 'Robin Testfeld'), A.nameFit('PT - Robin', 'Robin Testfield')],
      [['fakewell', 'waiting'], ['mc', 'kay'], 3, 3, 3, 3, 2, 0, 2, 0],
      'a name in a title: words run together split apart (either side), a middle initial between, a letter off; “Lane Fake” isn’t in “Lane Fakewood”, and a first name alone fits nobody');
    eq(['INS MetLife X', 'TERMINATED INS - X', 'PT INS PAID SUBSCRIBER X', 'AA MADE - X', 'LETTERS - X'].map(t => [A.taskIsIns(t), A.taskIsAA(t)]), [[true, false], [true, false], [false, false], [false, true], [false, false]],
      '“INS …” tasks go with the insurance account, the rest with the patient’s own; “AA MADE” means a payment plan');
    // matching against the made-up A/R report
    const rep = A.buildReport([await A.readEdgeAR('edge-full.xls', fs.readFileSync(path.join(FX, 'edge-full.xls')))]), accts = A.reportAccts(rep, cfg);
    const tasks = (await A.readEdgeTasks('edge-tasks.xls', fs.readFileSync(path.join(FX, 'edge-tasks.xls')))).tasks;
    const got = tasks.map(t => { const m = A.taskMatch(accts, t); return { how: m.how, patient: m.a ? m.a.patient : '', ins: m.a ? !!m.a.ins : false }; });
    eq(got, TX.map(t => t.want), 'each task finds its account: as written, with a middle initial, run into the next word, with accents; a letter off, by the responsible party, the other kind of account (to check); one not on the report');
    const items = new Map(), itemOf = k => items.get(k) || null, exactN = TX.filter(t => t.want.how === 'exact').length;
    let plan = A.edgeTasksPlan(accts, itemOf, tasks, {});
    ok(plan.rows.filter(r => r.a).length === exactN && plan.by.size === exactN - 1, 'only the ones as written are ready on their own (' + exactN + ' tasks, two of them on one account)');
    const picks = {}; got.forEach((g, i) => { if (g.how === 'close') picks[i] = A.taskMatch(accts, tasks[i]).a.key; });
    plan = A.edgeTasksPlan(accts, itemOf, tasks, picks);
    ok(plan.rows.filter(r => r.a).length === exactN + Object.keys(picks).length, 'ticked in the preview, the ones to check are added too');
    const t0 = Date.UTC(2026, 9, 8, 14), today = '2026-10-08', grp = n => plan.by.get(accts.find(a => a.patient === TX[n].want.patient && !!a.ins === TX[n].want.ins).key);
    const g0 = grp(0), it0 = A.blankItem(g0.a);
    const n0 = A.edgeTasksApply(it0, g0.tasks, { by: 'amir', today, overdue: 'today', aa: true, assign: 'riley' }, t0);
    eq([n0, it0.log.map(e => e.k), it0.log.map(e => e.date), it0.follow, it0.stage, it0.assignee, it0.log[0].op, /LETTER RETURNED\nReminder texted to the parent\.\nSecond reminder texted/.test(it0.log[0].note)],
      [2, ['edgetask', 'edgetask'], ['2026-09-03', '2026-10-30'], '2026-10-08', '', 'riley', 'Riley', true],
      'two tasks on one account: an “Edge task” entry each (due date, Riley’s, the title and the running log); the overdue one makes the follow-up the next office day; assigned to Riley');
    ok(A.edgeTasksApply(it0, g0.tasks, { by: 'amir', today }, t0 + 1) === 0 && it0.log.length === 2, 'importing again adds nothing');
    const it1 = A.blankItem(g0.a); A.edgeTasksApply(it1, g0.tasks, { by: 'amir', today, overdue: 'edge' }, t0);
    ok(it1.follow === '2026-09-03', 'or the follow-up keeps Edge’s date (late)');
    const sp = A.spreadFollow([{ a: { key: 'a' }, tasks: [{ due: '2026-09-01' }] }, { a: { key: 'b' }, tasks: [{ due: '2026-11-01' }, { due: '2026-08-01' }] }, { a: { key: 'c' }, tasks: [{ due: '2026-11-20' }] },
      { a: { key: 'd' }, tasks: [{ due: '2026-09-15' }] }, { a: { key: 'e' }, tasks: [{ due: '' }] }], today, 2), d1 = A.nextOfficeDay(today), d2 = A.nextOfficeDay(A.addDays(d1, 1));
    eq(sp, { b: d1, a: d1, d: d2 }, 'or spread: a long overdue list over the next office days, oldest first, the same number a day (' + d1 + ', ' + d2 + '); a task due later or with no date isn’t spread');
    const it2 = A.blankItem(g0.a); A.edgeTasksApply(it2, g0.tasks, { today, overdue: 'spread', spreadOn: d2 }, t0);
    const it3 = A.blankItem(g0.a); A.edgeTasksApply(it3, g0.tasks, { today, overdue: 'spread' }, t0);
    ok(it2.follow === d2 && it3.follow === A.nextOfficeDay(today), 'spread: the account’s follow-up is its day in the spread (without one, the next office day)');
    const gA = grp(1), itA = A.blankItem(gA.a), itB = Object.assign(A.blankItem(gA.a), { stage: 'waiting', follow: '2026-10-20', assignee: 'jamie' });
    const itC = Object.assign(A.blankItem(gA.a), { state: 'done', outcome: 'paid' }), itD = A.blankItem(gA.a);
    A.edgeTasksApply(itA, gA.tasks, { by: 'amir', today, aa: true }, t0); A.edgeTasksApply(itB, gA.tasks, { by: 'amir', today, aa: true, assign: 'riley' }, t0);
    A.edgeTasksApply(itC, gA.tasks, { by: 'amir', today, aa: true, assign: 'riley' }, t0); A.edgeTasksApply(itD, gA.tasks, { by: 'amir', today, aa: false }, t0);
    eq([itA.stage, itA.follow, [itB.stage, itB.follow, itB.assignee], [itC.state, itC.follow, itC.stage, itC.assignee, itC.log.length], itD.stage], ['plan', '2026-10-08', ['waiting', '2026-10-20', 'jamie'], ['done', '', '', '', 1], ''],
      '“AA MADE” → payment plan (when asked, and no stage yet); what was set in A/R is kept; a resolved account only gets the note');
    const gF = grp(3), itF = A.blankItem(gF.a); A.edgeTasksApply(itF, gF.tasks, { today }, t0);
    ok(itF.follow === A.nextOfficeDay('2026-11-12') && itF.log[0].date === '2026-11-12', 'a task due later: its own date, on an office day — ' + itF.follow);
    const nl = A.normItem(Object.assign({ id: 'x', rev: 1, v: 1 }, it0)).log[0];
    ok(nl.k === 'edgetask' && /^t[0-9a-z]+$/.test(nl.et) && nl.op === 'Riley' && nl.date === '2026-09-03' && /^Edge task \(Riley\) · due Sep 3(, 2026)? in Edge$/.test(A.logLabel(nl)),
      'read back: the entry keeps its task id, operator and due date, and shows as “' + A.logLabel(nl) + '”');
    items.set(g0.a.key, it0);
    const plan2 = A.edgeTasksPlan(accts, itemOf, tasks, picks);
    ok(plan2.rows.filter(r => r.dupe).length === 2 && !plan2.by.has(g0.a.key), 'tasks already on an account are marked as added before, and skipped');
    const ci = got.findIndex(g => g.how === 'close'), ca = A.taskMatch(accts, tasks[ci]).a, itc = A.blankItem(ca);
    A.edgeTasksApply(itc, [Object.assign({ id: A.taskId(tasks[ci]) }, tasks[ci])], { today }, t0); items.set(ca.key, itc);
    const r3 = A.edgeTasksPlan(accts, itemOf, tasks, {}).rows[ci];
    ok(r3.dupe && r3.a && r3.a.key === ca.key && r3.m.how === 'close', 'a task ticked in an import before is “added before” when the list comes again, with nothing ticked — it isn’t asked about twice');
    const a1 = accts.find(a => !a.ins && a.pd > 0), dup = Object.assign({}, a1, { key: a1.key + '#2', bal: (a1.bal || 0) + 100 }), m2 = A.taskMatch([a1, dup], { title: 'PT - ' + a1.patient });
    ok(m2.how === 'two' && m2.cands.length === 2, 'the same patient twice on the report (two contracts): both fit, so the preview asks which');
    ok(A.taskId(tasks[0]) === A.taskId(Object.assign({}, tasks[0])) && new Set(tasks.map(A.taskId)).size === tasks.length, 'each task has an id of its own, the same every time');
    const cr = A.blankItem(g0.a); A.edgeTasksApply(cr, g0.tasks, { today: '2026-12-10' }, Date.UTC(2026, 11, 10, 15));
    ok(A.auditOf(cr, '2026-12-01').reviewed === false, 'an imported task isn’t work done: it doesn’t count as reviewing a credit in the December audit');
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
