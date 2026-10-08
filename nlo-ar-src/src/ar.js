/* =====================================================================
   The A/R rules — pure functions (no screen, no database), so they can
   be tested on their own. They are the rules of the two worklists made
   from Edge's A/R Aging report on 20 Sep 2026:
   - Past due: 91+ ranked by size (the top 25 carry ~70%), a 31–90 watch
     list, and insurance accounts where NOTHING has been paid — Dr. A's
     rule: insurance past due that's an exact multiple of the monthly
     instalment ($11.11) means N untouched months.
   - Credit balances: oldest first, 3+ years is a priority; Start
     Scheduled prepayments are parked (no action).
   ===================================================================== */
/* goalPt / goalIns: the delinquency goals (AISA handbook §19, both "no more than 4%"); kpiFrom: a patient account counts as
   past due from 31 days (the 30+ the Month-End numbers use; the usual — Dr. A, 6 Oct 2026: counting 0–30 days, under 4%
   is too hard to hold) or from its first day past due (1, the handbook's wording);
   dueDay: the weekly report is due every Monday (1) … Thursday (4); Tuesday by default, the day of the FC's weekly
   checklist in CADANCe (the handbook says weekly and names no day; Dr. A, 6 Oct 2026) */
const AR_DEFAULTS = { inst: 11.11, writeOff: 100, tiers: [60, 120, 365], dueDay: 2, goalPt: 4, goalIns: 4, kpiFrom: 31 };
const DUE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'];
function arCfg(settings) {
  const a = (settings && settings.ar) || {};
  const num = (v, d) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : d), pctOf = (v, d) => (typeof v === 'number' && isFinite(v) && v > 0 && v <= 100 ? v : d);
  const tiers = Array.isArray(a.tiers) && a.tiers.length === 3 && a.tiers.every((n, i) => Number.isInteger(n) && n > 0 && (!i || n > a.tiers[i - 1])) ? a.tiers.slice() : AR_DEFAULTS.tiers.slice();
  return { inst: num(a.inst, AR_DEFAULTS.inst), writeOff: num(a.writeOff, AR_DEFAULTS.writeOff), tiers, dueDay: [1, 2, 3, 4].includes(a.dueDay) ? a.dueDay : AR_DEFAULTS.dueDay,
    goalPt: pctOf(a.goalPt, AR_DEFAULTS.goalPt), goalIns: pctOf(a.goalIns, AR_DEFAULTS.goalIns), kpiFrom: [1, 31].includes(a.kpiFrom) ? a.kpiFrom : AR_DEFAULTS.kpiFrom };
}

/* ---------- the weekly report (AISA handbook §19: "Weekly: FC runs AR Aging") ----------
   Due every dueDay (Mon–Thu); a holiday moves it to the next office day. A week's report is in when the newest report is
   dated that week (Monday on), even before its due day. Until the due day comes, last week's report is the one that counts.
   → { state: 'ok' | 'today' | 'late', due (the day it's due, or for 'ok' the next one), days (late by), newest } */
function weekMon(iso) { const [y, m, d] = iso.split('-').map(Number); return addDays(iso, -((new Date(y, m - 1, d).getDay() + 6) % 7)); }
function reportDue(newest, today, dueDay) {
  const dd = [1, 2, 3, 4].includes(dueDay) ? dueDay : AR_DEFAULTS.dueDay, dueOf = w => nextOfficeDay(addDays(w, dd - 1));
  let w = weekMon(today);
  for (let i = 0; i < 3 && dueOf(w) > today; i++) w = addDays(w, -7);
  if (newest && newest >= w) {
    let n = addDays(newest > w ? weekMon(newest) : w, 7);
    while (dueOf(n) <= today) n = addDays(n, 7);
    return { state: 'ok', due: dueOf(n), days: 0, newest };
  }
  const due = dueOf(w);
  return { state: due === today ? 'today' : 'late', due, days: Math.max(0, daysBetween(due, today)), newest: newest || null };
}

/* ---------- one account ---------- */
function normName(s) { return String(s || '').toLowerCase().replace(/^\s*ins\s*:\s*/, '').replace(/\b(mr|mrs|ms|miss|dr)\.?\s+/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function isIns(r) { return /^\s*ins\s*:/i.test(r.rp || ''); }
function isInactive(r) { return /^inact/i.test(String(r.sts || '').trim()); }
function isPrepay(r) { return /^start\s*sch/i.test(String(r.sts || '').trim()); }
function rpName(r) { return String(r.rp || '').replace(/^\s*ins\s*:\s*/i, '').trim(); }
function creditOf(r) { return r.bal != null && r.bal < -0.004 ? round2(-r.bal) : r.due < -0.004 ? round2(-r.due) : 0; }
function pastDueOf(r) { return r.due > 0.004 ? round2(r.due) : 0; }
function over30(r) { return round2((r.b30 || 0) + (r.b60 || 0) + (r.b90 || 0)); }
/* Dr. A's rule: insurance past due that is an exact multiple of the monthly instalment = the carrier has paid nothing */
function neverPaidMonths(r, cfg) {
  if (!isIns(r)) return 0; const pd = pastDueOf(r); if (pd <= 0) return 0;
  const n = Math.round(pd / cfg.inst); return n >= 1 && Math.abs(round2(n * cfg.inst) - pd) < 0.005 ? n : 0;
}
/* account key: who the patient is + who pays (insurance and the family's own contract are separate accounts) */
function acctKey(r) { return normName(r.patient) + '|' + normName(rpName(r)) + '|' + (isIns(r) ? 'I' : 'P'); }
const TIERS = {
  monitor: { n: 1, l: 'Claim likely still in flight — monitor', s: 'Monitor', tone: 'grey' },
  chase: { n: 2, l: 'Chase now — call the carrier', s: 'Chase now', tone: 'red' },
  investigate: { n: 3, l: 'Likely stuck or denied — investigate the claim', s: 'Investigate', tone: 'amber' },
  nofile: { n: 4, l: 'Probably never filed — verify, then write off', s: 'Never filed?', tone: 'navy' }
};
function tierOf(days, cfg) { const d = Number(days) || 0; return d <= cfg.tiers[0] ? 'monitor' : d <= cfg.tiers[1] ? 'chase' : d <= cfg.tiers[2] ? 'investigate' : 'nofile'; }
/* credit age, from the last payment to the report's date */
const CR_AGES = [['0-90 d', 90], ['91-365 d', 365], ['1-2 yr', 730], ['2-3 yr', 1095], ['3+ yr', Infinity]];
function crAgeBucket(age) { if (age == null) return ''; return CR_AGES.find(([, max]) => age <= max)[0]; }
/* everything the lists need about one row of the report */
function acctOf(r, cfg, asOf) {
  const ins = isIns(r), pd = pastDueOf(r), credit = creditOf(r), months = neverPaidMonths(r, cfg);
  const b = r.b90 > 0.004 ? '91' : (r.b30 > 0.004 || r.b60 > 0.004) ? '31' : pd > 0 ? '0' : '';
  const age = r.recv && asOf ? daysBetween(r.recv, asOf) : null;
  return Object.assign({}, r, {
    key: r.key || acctKey(r), ins, src: ins ? 'ins' : 'pt', inactive: isInactive(r), prepay: isPrepay(r), pd, credit, o30: over30(r),
    bucket: b, months, tier: months ? tierOf(r.days, cfg) : '', age, ageBucket: credit ? crAgeBucket(age) : ''
  });
}
/* what to do about it (past due) */
function pdAction(a, cfg) {
  if (a.bucket === '91') {
    if (a.b90 < cfg.writeOff) return { k: 'wo', l: 'Write-off candidate (under ' + money(cfg.writeOff) + ')', s: 'Write-off?', tone: 'grey' };
    if (a.ins) return { k: 'claim', l: 'Claim follow-up — call the carrier', s: 'Call the carrier', tone: 'red' };
    if (a.inactive) return { k: 'coll', l: 'Collections or write-off (inactive)', s: 'Collections', tone: 'amber' };
    return { k: 'call', l: 'Patient collection call', s: 'Collection call', tone: 'red' };
  }
  if (a.bucket === '31') {
    if (a.ins) return { k: 'claim', l: 'Call the carrier — check the claim', s: 'Check the claim', tone: 'amber' };
    if (a.inactive) return { k: 'coll', l: 'Collections call (inactive)', s: 'Collections call', tone: 'amber' };
    return { k: 'remind', l: 'Reminder call or text', s: 'Reminder', tone: 'amber' };
  }
  if (a.bucket === '0') return a.ins ? { k: 'mon', l: 'Monitor — insurance timing', s: 'Monitor', tone: 'grey' } : { k: 'remind', l: 'Courtesy reminder', s: 'Courtesy reminder', tone: 'grey' };
  return { k: '', l: '', s: '', tone: 'grey' };
}
/* what to do about it (credit balance) */
function crAction(a) {
  if (a.prepay) return { k: 'prepay', l: 'No action — prepayment', s: 'No action', tone: 'grey' };
  if (a.age != null && a.age > 1095) return { k: 'prio', l: 'Priority — 3+ years, refund or escalate', s: 'Priority', tone: 'red' };
  if (a.inactive) return { k: 'inact', l: 'Refund or write off — patient inactive', s: 'Refund or write off', tone: 'amber' };
  if (a.age != null && a.age > 365) return { k: 'old', l: 'Investigate — aged over 1 year', s: 'Investigate', tone: 'amber' };
  return { k: 'timing', l: 'Review — likely timing', s: 'Review', tone: 'grey' };
}
const CR_RANK = { prio: 0, inact: 1, old: 2, timing: 3, prepay: 4 };

/* ---------- building a report from the file(s) dropped in ---------- */
/* what a file covers, from Edge's own lines above the columns */
function coverOf(meta) {
  const sg = String(meta.subgroup || '').trim().toLowerCase(), opt = String(meta.options || '').toLowerCase();
  const all = !sg || sg === 'none';
  return { full: all, pastDue: all || /past\s*due/.test(sg), credit: all || /credit/.test(sg), ins: !/exclude\s+insurance/.test(opt), zero: /exclude\s+zero/.test(opt) };
}
/* one report from one or more files of the same day (e.g. "Past Due" and "Credit Balance" run separately):
   the accounts that matter (past due or in credit), plus the whole book's totals when a file has every account */
function buildReport(files, opts) {
  opts = opts || {};
  const warn = [], dates = Array.from(new Set(files.map(f => f.meta.asOf).filter(Boolean)));
  if (dates.length > 1) warn.push('These files are from different days (' + dates.map(fmtDate).join(', ') + '). Import one day at a time.');
  const asOf = dates[0] || opts.asOf || todayISO();
  const cover = { full: false, pastDue: false, credit: false, ins: true };
  let book = null;
  const seen = new Map(), rows = [];
  // the file with every account first, so its rows win when an account is in two files
  files.slice().sort((a, b) => Number(coverOf(b.meta).full) - Number(coverOf(a.meta).full)).forEach(f => {
    const c = coverOf(f.meta);
    cover.full = cover.full || c.full; cover.pastDue = cover.pastDue || c.pastDue; cover.credit = cover.credit || c.credit;
    if (!c.ins) cover.ins = false;
    if (c.full && !book) {
      const pt = f.rows.filter(r => !isIns(r)), ins = f.rows.filter(isIns), sum = (l, k) => round2(l.reduce((s, r) => s + (Number(r[k]) || 0), 0));
      // act: accounts not Inactive in Edge — the goals' "active accounts" (the saved report keeps only the accounts past due or in credit)
      const act = l => l.filter(r => !isInactive(r)).length;
      book = { n: f.rows.length, bal: sum(f.rows, 'bal'), due: sum(f.rows, 'due'), pt: { n: pt.length, bal: sum(pt, 'bal'), act: act(pt) }, ins: { n: ins.length, bal: sum(ins, 'bal'), act: act(ins) } };
    }
    const fileKeys = new Map();
    f.rows.forEach(r => {
      if (pastDueOf(r) <= 0 && creditOf(r) <= 0) return;
      let k = acctKey(r);
      // the same patient and payer twice in one file (two contracts): keep both
      const n = (fileKeys.get(k) || 0) + 1; fileKeys.set(k, n); if (n > 1) k += '#' + n;
      if (seen.has(k)) return; seen.set(k, true);
      rows.push(Object.assign({}, r, { key: k }));
    });
  });
  if (!cover.ins) warn.push('Insurance contracts were left out of this report (“Exclude Insurance Contracts” was ticked), so the Insurance lists can’t be updated from it.');
  if (!cover.full && !(cover.pastDue && cover.credit)) warn.push(cover.pastDue ? 'Only past-due accounts are in this report — credit balances won’t be updated.' : cover.credit ? 'Only credit balances are in this report — past due won’t be updated.' : 'This report is a partial subgroup, so the lists may be incomplete.');
  return { asOf, cover, book, rows, warn, files: files.map(f => ({ name: f.name || '', kind: f.kind || '', subgroup: f.meta.subgroup || '', options: f.meta.options || '', edge: f.meta.edge || '', n: f.rows.length, ok: f.check ? f.check.ok : null })) };
}
/* the accounts of a saved report, worked out */
function reportAccts(rep, cfg) { return (rep && rep.rows || []).map(r => acctOf(r, cfg, rep.asOf)); }

/* ---------- the lists ---------- */
function list91(accts) { return accts.filter(a => a.bucket === '91').sort((x, y) => y.b90 - x.b90 || y.pd - x.pd); }
function list31(accts) { return accts.filter(a => a.bucket === '31').sort((x, y) => y.pd - x.pd); }
function list0(accts) { return accts.filter(a => a.bucket === '0').sort((x, y) => y.pd - x.pd); }
function listNever(accts) { return accts.filter(a => a.months > 0).sort((x, y) => TIERS[y.tier].n - TIERS[x.tier].n || y.months - x.months || (y.days || 0) - (x.days || 0)); }
function listCredits(accts) { return accts.filter(a => a.credit > 0).sort((x, y) => CR_RANK[crAction(x).k] - CR_RANK[crAction(y).k] || (y.age || 0) - (x.age || 0) || y.credit - x.credit); }
/* running share of the 91+ money, down the ranked list */
function withCum(list91s) { const tot = list91s.reduce((s, a) => s + a.b90, 0); let run = 0; return list91s.map(a => { run += a.b90; return Object.assign({}, a, { cum: tot ? run / tot : 0 }); }); }

/* ---------- the summary page (and the month-end numbers) ---------- */
function summarize(rep, cfg) {
  const A = reportAccts(rep, cfg), sum = (l, f) => round2(l.reduce((s, a) => s + f(a), 0));
  const pdl = A.filter(a => a.pd > 0), pt = pdl.filter(a => !a.ins), ins = pdl.filter(a => a.ins);
  const pd = { n: pdl.length, total: sum(pdl, a => a.pd), b0: sum(pdl, a => a.b0), b30: sum(pdl, a => a.b30), b60: sum(pdl, a => a.b60), b90: sum(pdl, a => a.b90),
    pt: { n: pt.length, total: sum(pt, a => a.pd), b90: sum(pt, a => a.b90) }, ins: { n: ins.length, total: sum(ins, a => a.pd), b90: sum(ins, a => a.b90) } };
  const l91 = list91(A), tot91 = sum(l91, a => a.b90), topN = n => sum(l91.slice(0, n), a => a.b90);
  let reach70 = 0, run = 0; for (const a of l91) { run += a.b90; reach70++; if (tot91 && run / tot91 >= 0.7) break; }
  const conc = { n: l91.length, total: tot91, top10: topN(10), top25: topN(25), top50: topN(50), reach70: l91.length ? reach70 : 0 };
  const bs = new Map(); pdl.forEach(a => { const k = a.sts || '—', x = bs.get(k) || { sts: k, n: 0, pd: 0 }; x.n++; x.pd = round2(x.pd + a.pd); bs.set(k, x); });
  const nev = listNever(A), tiers = {}; Object.keys(TIERS).forEach(t => { const l = nev.filter(a => a.tier === t); tiers[t] = { n: l.length, pd: sum(l, a => a.pd), contract: sum(l, a => a.bal || 0) }; });
  const never = { n: nev.length, pd: sum(nev, a => a.pd), contract: sum(nev, a => a.bal || 0), tiers };
  if (rep.book && rep.book.ins.bal > 0) never.pctBook = never.contract / rep.book.ins.bal;
  const crl = A.filter(a => a.credit > 0), pre = crl.filter(a => a.prepay), work = crl.filter(a => !a.prepay);
  const cbs = new Map(); crl.forEach(a => { const k = a.sts || '—', x = cbs.get(k) || { sts: k, n: 0, amt: 0 }; x.n++; x.amt = round2(x.amt + a.credit); cbs.set(k, x); });
  const cage = CR_AGES.map(([k]) => { const l = crl.filter(a => a.ageBucket === k); return { k, n: l.length, amt: sum(l, a => a.credit) }; });
  const cpt = crl.filter(a => !a.ins), cins = crl.filter(a => a.ins);
  const cr = { n: crl.length, total: sum(crl, a => a.credit), pt: { n: cpt.length, total: sum(cpt, a => a.credit) }, ins: { n: cins.length, total: sum(cins, a => a.credit) },
    prepay: { n: pre.length, total: sum(pre, a => a.credit) }, work: { n: work.length, total: sum(work, a => a.credit) },
    byStatus: Array.from(cbs.values()).sort((a, b) => b.amt - a.amt), byAge: cage };
  // Month-End Numbers (the "Accounts" section): totals only, as of this report's date
  const p30 = pdl.filter(a => !a.ins && a.o30 > 0), i30 = pdl.filter(a => a.ins && a.o30 > 0);
  const monthEnd = rep.cover && rep.cover.full && rep.cover.ins && rep.book ? {
    pt_ar: rep.book.pt.bal, pt_ar_n: rep.book.pt.n, ins_ar: rep.book.ins.bal, ins_ar_n: rep.book.ins.n, ar_total: rep.book.bal,
    pt_pd: sum(p30, a => a.o30), pt_pd_n: p30.length, ins_pd: sum(i30, a => a.o30), ins_pd_n: i30.length, cred_pt: cr.pt.total, cred_ins: cr.ins.total
  } : null;
  return { asOf: rep.asOf, cover: rep.cover, book: rep.book || null, pd, conc, byStatus: Array.from(bs.values()).sort((a, b) => b.pd - a.pd), never, cr,
    netDue: rep.book ? rep.book.due : round2(pd.total - cr.total), monthEnd };
}
/* ---------- the goals (AISA handbook §19, Practice KPIs) ----------
   Patient delinquency: patient accounts past due ÷ active patient accounts, no more than 4%.
   Insurance delinquency: insurance accounts past their expected payment window ÷ open insurance accounts, no more than 4%.
   Counts of accounts (not dollars), both from one full A/R Aging report (Subgroup None, insurance included). The handbook
   gives no window for insurance: the app uses the "monitor up to" days of the insurance triage (60 to start with).
   ---------------------------------------------------------------------------------------------------------------- */
function insLate(a, cfg) { const d = a.days != null ? a.days : a.b90 > 0.004 ? 91 : a.b60 > 0.004 ? 61 : a.b30 > 0.004 ? 31 : 1; return a.pd > 0 && d > cfg.tiers[0]; }
function kpis(rep, cfg) {
  if (!rep || !rep.book || !rep.cover || !rep.cover.full) return null;
  const A = reportAccts(rep, cfg), bk = rep.book;
  const ptOf = bk.pt.act != null ? bk.pt.act : bk.pt.n, ptN = A.filter(a => !a.ins && !a.inactive && (cfg.kpiFrom > 1 ? a.o30 > 0.004 : a.pd > 0)).length;
  const one = (n, of, goalPct) => { const goal = goalPct / 100; return { n, of, rate: of ? n / of : null, goal, ok: of ? n / of <= goal + 1e-9 : null, need: of ? Math.max(0, n - Math.floor(goal * of + 1e-9)) : null }; };
  return {
    pt: one(ptN, ptOf, cfg.goalPt),
    ins: rep.cover.ins ? one(A.filter(a => a.ins && insLate(a, cfg)).length, bk.ins.n, cfg.goalIns) : null,
    from: cfg.kpiFrom, win: cfg.tiers[0]
  };
}
/* a small summary kept with each saved report, for the trend charts (totals and counts only) */
/* prev: the report before it, when there is one (for what moved week over week) */
function reportTotals(rep, cfg, prev) {
  const s = summarize(rep, cfg), k1 = kpis(rep, Object.assign({}, cfg, { kpiFrom: 1 })), k30 = kpis(rep, Object.assign({}, cfg, { kpiFrom: 31 }));
  return { asOf: s.asOf, cover: s.cover, pd: s.pd.total, b90: s.pd.b90, b31: round2(s.pd.b30 + s.pd.b60), n91: s.conc.n, never: s.never.n, neverPd: s.never.pd, cr: s.cr.total, crWork: s.cr.work.total, crN: s.cr.work.n, bal: s.book ? s.book.bal : null,
    kp: k1 ? { ptOf: k1.pt.of, ptPd: k1.pt.n, ptPd30: k30.pt.n, insOf: k1.ins ? k1.ins.of : null, insLate: k1.ins ? k1.ins.n : null, win: k1.win } : null,
    fl: prev ? flowOf(rep, prev, cfg) : null };
}

/* ---------- what changed since the report before ---------- */
function diffReports(cur, prev, cfg) {
  const out = { new91: [], cleared: [], newCredit: [], goneCredit: [], worse: [], newNever: [] };
  if (!cur || !prev) return out;
  const P = new Map(reportAccts(prev, cfg).map(a => [a.key, a])), C = reportAccts(cur, cfg), Ck = new Set(C.map(a => a.key));
  const samePd = cur.cover.pastDue && prev.cover.pastDue, sameCr = cur.cover.credit && prev.cover.credit;
  C.forEach(a => {
    const p = P.get(a.key);
    if (samePd && a.bucket === '91' && (!p || p.bucket !== '91')) out.new91.push(a.key);
    if (samePd && a.months && (!p || !p.months)) out.newNever.push(a.key);
    else if (samePd && a.months && p && p.months && TIERS[a.tier].n > TIERS[p.tier].n) out.worse.push(a.key);
    if (sameCr && a.credit > 0 && !a.prepay && (!p || !(p.credit > 0))) out.newCredit.push(a.key);
  });
  P.forEach((p, k) => {
    const c = Ck.has(k) ? C.find(a => a.key === k) : null;
    if (samePd && p.pd > 0 && (!c || !(c.pd > 0)) && (cur.cover.ins || !p.ins)) out.cleared.push(k);
    if (sameCr && p.credit > 0 && !p.prepay && (!c || !(c.credit > 0)) && (cur.cover.ins || !p.ins)) out.goneCredit.push(k);
  });
  return out;
}

/* =====================================================================
   Working an account: what was done, who has it, when to look again.
   Saved (sealed) only once someone does something with an account.
   ===================================================================== */
const STAGES = {
  '': 'Not started', working: 'Working on it', waiting: 'Waiting to hear back', promise: 'Promised to pay', plan: 'Payment plan', hold: 'Paused'
};
const OUTCOMES = { paid: 'Paid', writeoff: 'Written off', refund: 'Refunded', transfer: 'Credit transferred', applied: 'Credit applied', cleared: 'Cleared in Edge', other: 'Resolved' };
/* one tap logs it; most set what happens next */
const LOGS = {
  // patient past due
  pt_vm: { g: 'pt', l: 'Called — left a voicemail', s: 'Left a voicemail', stage: 'waiting', next: 3 },
  pt_noans: { g: 'pt', l: 'Called — no answer', s: 'No answer', stage: 'working', next: 2 },
  pt_spoke: { g: 'pt', l: 'Called — spoke with them', s: 'Spoke with them', stage: 'working', next: 7 },
  pt_text: { g: 'pt', l: 'Texted', s: 'Texted', stage: 'waiting', next: 3 },
  pt_email: { g: 'pt', l: 'Emailed', s: 'Emailed', stage: 'waiting', next: 5 },
  pt_letter: { g: 'pt', l: 'Sent a letter', s: 'Sent a letter', stage: 'waiting', next: 14 },
  pt_promise: { g: 'pt', l: 'Promised to pay…', s: 'Promised to pay', stage: 'promise', ask: 'date' },
  pt_plan: { g: 'pt', l: 'Payment plan set up', s: 'Payment plan set up', stage: 'plan', next: 30 },
  // insurance
  ins_call: { g: 'ins', l: 'Called the carrier', s: 'Called the carrier', stage: 'waiting', next: 14 },
  ins_portal: { g: 'ins', l: 'Checked the portal', s: 'Checked the portal', stage: 'working', next: 14 },
  ins_filed: { g: 'ins', l: 'Claim filed / sent', s: 'Claim filed', stage: 'waiting', next: 30 },
  ins_resub: { g: 'ins', l: 'Claim resubmitted', s: 'Claim resubmitted', stage: 'waiting', next: 30 },
  ins_denied: { g: 'ins', l: 'Claim denied…', s: 'Claim denied', stage: 'working', next: 7, ask: 'note' },
  ins_appeal: { g: 'ins', l: 'Appeal sent', s: 'Appeal sent', stage: 'waiting', next: 30 },
  ins_pt: { g: 'ins', l: 'Billed to the family', s: 'Billed to the family', stage: 'waiting', next: 14 },
  // credit balances
  cr_review: { g: 'cr', l: 'Reviewed the ledger', s: 'Reviewed the ledger', stage: 'working', next: 7 },
  cr_hold: { g: 'cr', l: 'Holding — insurance not paid out yet', s: 'Holding for insurance', stage: 'hold', next: 60 },
  cr_refreq: { g: 'cr', l: 'Refund requested (needs Dr. A)', s: 'Refund requested', stage: 'waiting', next: 7, drA: true },
  // any account
  note: { g: 'any', l: 'Save note', s: 'Note' }
};
/* ways an account is finished */
const DONE = {
  pt: [['paid', 'Paid'], ['writeoff', 'Written off'], ['other', 'Resolved another way']],
  ins: [['paid', 'Carrier paid'], ['writeoff', 'Written off'], ['other', 'Resolved another way']],
  cr: [['refund', 'Refund issued'], ['transfer', 'Transferred to the family’s balance'], ['applied', 'Applied to a sibling / next phase'], ['writeoff', 'Written off'], ['other', 'Resolved another way']]
};
/* Before refunding a credit (FC report instructions, Credits & Refunds) */
const REFUND_CHECKS = [
  ['fee', 'We received the total treatment fee'],
  ['ins', 'We received all expected insurance benefits'],
  ['ltm', 'Checked whether the lifetime max increased since treatment started'],
  ['chg', 'Charged out every charge (late, breakage, no-show, retainers…)'],
  ['rpbal', 'The responsible party has no balance (if they do, transfer the credit to it)'],
  ['phase', 'No other phase of treatment to apply it to'],
  ['family', 'No family member in treatment with a balance'],
  ['moved', 'An insurance credit owed to the family was moved to their account first']
];
function blankItem(a) {
  return { key: a.key, name: a.patient, rp: a.rp, src: a.src, kind: a.credit > 0 && !(a.pd > 0) ? 'cr' : 'pd', state: 'open', stage: '', outcome: '', assignee: '', follow: '', drA: false, log: [], checks: {} };
}
/* log something on an account (mutates it). o: { by, note, date, amt, next } */
function applyLog(item, k, o, now) {
  const L = LOGS[k]; if (!L) throw errCode('bad-log');
  o = o || {}; const note = String(o.note || '').trim();
  if (L.ask === 'note' && !note) throw errCode('need-note', 'Add a note (the reason) first.');
  if (L.ask === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) throw errCode('need-date', 'Pick the day they promised to pay.');
  if (k === 'note' && !note) throw errCode('need-note', 'Write the note first.');
  const e = { id: uid8(), at: now, by: o.by || '', k, note, prev: { stage: item.stage, follow: item.follow, drA: !!item.drA } };
  if (o.amt != null && isFinite(o.amt)) e.amt = round2(o.amt);
  if (o.date) e.date = o.date;
  item.log = (item.log || []).concat([e]);
  if (L.stage) item.stage = L.stage;
  if (L.ask === 'date') item.follow = o.date;
  else if (o.next !== undefined) item.follow = o.next || '';
  else if (L.next) item.follow = nextOfficeDay(addDays(isoOf(new Date(now)), L.next));
  if (L.drA) item.drA = true;
  return e;
}
/* take back the last thing logged (only right after, and only if nothing else changed since) */
function canUndoLog(item) { const e = (item.log || [])[item.log.length - 1]; return !!(e && e.prev && item.state === 'open'); }
function undoLog(item) {
  const e = (item.log || [])[item.log.length - 1]; if (!e || !e.prev) throw errCode('nothing-to-undo');
  item.log = item.log.slice(0, -1); item.stage = e.prev.stage || ''; item.follow = e.prev.follow || ''; item.drA = !!e.prev.drA;
}
function resolveItem(item, outcome, o, now) {
  item.state = 'done'; item.outcome = outcome; item.resolvedAt = now; item.resolvedBy = (o && o.by) || ''; item.follow = ''; item.drA = false;
  const note = String((o && o.note) || '').trim();
  item.log = (item.log || []).concat([{ id: uid8(), at: now, by: (o && o.by) || '', k: 'done', outcome, note }]);
}
/* o.fresh: it's past due again after being resolved, so the collections ladder starts over */
function reopenItem(item, o, now) {
  item.state = 'open'; item.outcome = ''; delete item.resolvedAt; delete item.resolvedBy;
  const e = { id: uid8(), at: now, by: (o && o.by) || '', k: 'reopen', note: String((o && o.note) || '').trim() };
  if (o && o.fresh) e.fresh = true;
  item.log = (item.log || []).concat([e]);
}
/* the entry that put the account on Dr. A's list (a question, a refund request, a letter to sign) */
function drAQuestion(item) { return (item.log || []).slice().reverse().find(e => e.k === 'drA_ask' || (LOGS[e.k] && LOGS[e.k].drA)) || null; }
/* Dr. A's answer to a refund or write-off request, or to a letter waiting for his signature */
function answerDrA(item, ok, o, now) {
  const q = drAQuestion(item);
  item.drA = false;
  const e = { id: uid8(), at: now, by: (o && o.by) || '', k: ok ? 'drA_ok' : 'drA_no', note: String((o && o.note) || '').trim() };
  if (q && q.k === 'drA_ask' && own(LAD_BY, q.step)) e.step = q.step;
  item.log = (item.log || []).concat([e]);
  if (!ok && item.stage === 'waiting') item.stage = 'working';
}
function lastLog(item) { const l = (item && item.log || []).filter(e => e.k !== 'reopen'); return l[l.length - 1] || null; }
function logLabel(e) {
  if (!e) return '';
  const st = own(LAD_BY, e.step) ? LAD_BY[e.step] : null;
  if (e.k === 'done') return 'Resolved — ' + (OUTCOMES[e.outcome] || e.outcome || '').toLowerCase();
  if (e.k === 'reopen') return 'Reopened';
  if (e.k === 'drA_ask') return st ? 'Asked Dr. A to sign ' + st.s : 'Asked Dr. A';
  if (e.k === 'drA_ok') return st ? 'Dr. A signed ' + st.s : 'Dr. A OK’d it';
  if (e.k === 'drA_no') return st ? 'Dr. A: not yet (' + st.s + ')' : 'Dr. A said not yet';
  if (e.k === 'ladder') return st ? st.did : 'Collections step';
  if (e.k === 'edgetask') return 'Edge task' + (e.op ? ' (' + e.op + ')' : '') + (e.date ? ' · due ' + fmtDate(e.date) + ' in Edge' : '');
  if (e.k === 'aa_broken') return 'Arrangement broken';
  if (e.k === 'mhold_on') return 'Put on Maintenance Hold';
  if (e.k === 'mhold_off') return 'Maintenance Hold lifted';
  if (e.k === 'assign') return 'Assigned';
  if (e.k === 'follow') return 'Follow-up moved';
  const L = LOGS[e.k]; return L ? L.s : e.k;
}

/* =====================================================================
   The collections ladder — AISA handbook §14 (Collections Protocol:
   "Escalation timeline — 7-letter sequence"), §16 (FC duties) and §45
   (Maintenance Hold). A patient account past due goes up it by days past
   due: a text on day 0, letters #1–#7 at 14, 30, 45, 60, 90, 100 and 120
   days, calls at 45 and 75, a follow-up text after Dr. A's 90-day letter,
   Maintenance Hold from 60 days (the FC's call), and Letter #8 — off the
   sequence — when an Alternative Arrangement is broken. Dr. A signs #4,
   #5, #7 and #8; #5, #7 and #8 also go certified. The FC starts at once,
   alongside OrthoBanc's own ~90-day process. The day count is Edge's
   "Days" column (the most days past due of any unpaid charge on the
   contract, as of the report's date), carried on to today. The wording
   lives in Edge's letters and Weave's "FC- Delinquent" texts; the app
   says which one is due and keeps track of what went out.
   The handbook names no text for day 75 and no day for "FC- Delinquent
   #8": day 75 uses #7 (the between-letters text) and #8 goes on day 104,
   two weeks after Dr. A's day-90 letter, which it mentions.
   ===================================================================== */
const LADDER = [
  { id: 'd0', day: 0, s: 'First text', l: 'Text the family — the payment didn’t go through', btn: 'Texted', did: 'Texted the family (day 0)', tone: 'grey',
    do: ['Text the responsible party now (OrthoBanc’s failed-payment emails come about the 5th, 12th, 19th and 26th)', 'Note it in the patient’s chart in Edge', 'Set a 2-week task in Edge'] },
  { id: 'l1', day: 14, n: 1, s: 'Letter #1', l: 'FC- #1, Friendly Reminder', send: 'Mail or email · not certified', text: 'FC- Delinquent #1', btn: 'Sent', did: 'Letter #1 sent', tone: 'blue' },
  { id: 'l2', day: 30, n: 2, s: 'Letter #2', l: 'FC- #2 - FIRST Escalation', send: 'Mail or email · not certified', text: 'FC- Delinquent #2', btn: 'Sent', did: 'Letter #2 sent', tone: 'blue',
    do: ['Run the 30-day delinquency report in Edge'] },
  { id: 'l3', day: 45, n: 3, s: 'Letter #3 + call', l: 'FC- #3 - Stronger FC Notice', send: 'Mail or email · not certified', text: 'FC- Delinquent #3', btn: 'Sent + called', did: 'Letter #3 sent + called', tone: 'amber',
    call: 'Call the family — “Delinquent Account #2” script (document 26, Shimmin FC folder)' },
  { id: 'l4', day: 60, n: 4, s: 'Letter #4', l: 'FC- #4, Doctors First Letter', send: 'Mail and email · not certified', text: 'FC- Delinquent #4', btn: 'Sent', did: 'Letter #4 sent', tone: 'amber', dra: true, hold: true,
    do: ['It explains what’s needed to resume active treatment'] },
  { id: 'c75', day: 75, s: 'Day-75 call', l: 'Call + text — the hold, and what happens if it stays unpaid', text: 'FC- Delinquent #7', btn: 'Called + texted', did: 'Day-75 call + text', tone: 'amber',
    call: 'Call the family — reinforce the Maintenance Hold and what continued non-payment means' },
  { id: 'l5', day: 90, n: 5, s: 'Letter #5', l: 'FC- #5, Maint. Hold + Discont. Warning', send: 'Certified + regular mail + email', text: 'FC- Delinquent #5 &6', btn: 'Sent', did: 'Letter #5 sent (certified)', tone: 'red', dra: true, cert: true,
    do: ['Add a 30-day delinquency alert to the patient’s chart in Edge', 'Comfort visits only for the next 30 days', 'Keep the certified tracking number'] },
  { id: 'l6', day: 100, n: 6, s: 'Letter #6', l: 'FC- #6, FC Bridge Letter', send: 'Mail or email', text: 'FC- Delinquent #5 &6', btn: 'Sent', did: 'Letter #6 sent', tone: 'red',
    do: ['One more chance: treatment is on hold and the discontinuation deadline is near'] },
  { id: 't8', day: 104, s: 'Text #8', l: 'Follow-up text — Dr. A’s letter two weeks ago', text: 'FC- Delinquent #8', btn: 'Texted', did: 'Follow-up text sent (#8)', tone: 'red' },
  { id: 'l7', day: 120, n: 7, s: 'Letter #7', l: 'FC- #7, Discont. of TxP', send: 'Certified + regular mail + email', text: 'FC- Delinquent #9 (FINAL)', btn: 'Sent', did: 'Letter #7 sent (certified)', tone: 'navy', dra: true, cert: true, end: true,
    do: ['Treatment is discontinued: 30 days for appliance removal and emergencies only', 'Hardship (job loss, a medical emergency)? Talk it over with Dr. A before discontinuing', 'Keep the certified tracking number'] }
];
/* off the sequence: an Alternative Arrangement (a new payment contract) was broken */
const LAD_AA = { id: 'aa', n: 8, s: 'Letter #8', l: 'FC- #8, Broken Arrangement', send: 'Certified + regular mail + email', btn: 'Sent', did: 'Letter #8 sent (certified)', tone: 'navy', dra: true, cert: true, end: true,
  do: ['If they have an appointment, change it to Debond/Finish', '30 days for appliance removal and emergencies only — treatment doesn’t progress', 'To restart treatment: the full remaining balance, by Mastercard, Visa or Discover only', 'Keep the certified tracking number'] };
/* after the last letter's 30 days (not logged — resolving the account ends it) */
const LAD_END = { id: 'end', s: 'Write off', l: 'The 30 days are up — write it off', tone: 'navy',
  do: ['Write off the balance and send it to the collection agency', 'Edge: Inactive Financial (only the FC changes it); archive the patient and family'] };
const LAD_ENDAA = { id: 'endaa', s: 'Debond/Finish', l: 'The 30 days are up — Debond/Finish', tone: 'navy',
  do: ['No full payment: schedule the Debond/Finish appointment', 'Retainers at the non-patient retainer fee — cash or money order only, no insurance billing', 'Edge: Inactive Financial (only the FC changes it)'] };
const LAD_BY = Object.create(null); LADDER.concat([LAD_AA]).forEach(s => { LAD_BY[s.id] = s; });
const LAD_ALL = LADDER.concat([LAD_AA, LAD_END, LAD_ENDAA]);
const LAD_RANK = Object.create(null); LAD_ALL.forEach((s, i) => { LAD_RANK[s.id] = i; });

/* who it's for: patient accounts past due (insurance has its own steps; an inactive account is collections or a write-off) */
function onLadder(a) { return !!a && !a.ins && !a.inactive && a.pd > 0; }
/* days past due today: Edge's "Days" on the report's date plus the days since (without it, the first day of the oldest bucket) */
function ladDays(a, asOf, today) {
  const base = typeof a.days === 'number' && isFinite(a.days) && a.days >= 0 ? a.days : a.b90 > 0.004 ? 91 : a.b60 > 0.004 ? 61 : a.b30 > 0.004 ? 31 : 0;
  return base + (asOf && today ? Math.max(0, daysBetween(asOf, today)) : 0);
}
/* the office day the account reaches `day` days past due (today if it already has) */
function ladDate(a, asOf, today, day) { return nextOfficeDay(addDays(today, Math.max(0, day - ladDays(a, asOf, today)))); }
/* this round's entries: a round starts over when an account resolved before is past due again */
function ladEntries(it) {
  const L = (it && it.log) || []; let i = L.length;
  while (i-- > 0) if (L[i].k === 'reopen' && L[i].fresh) break;
  return L.slice(i + 1);
}
/* on Maintenance Hold: put on in this round, not lifted since, and not resolved since (paid or fixed in Edge ends it) */
function holdOf(it) { let h = null; ladEntries(it).forEach(e => { if (e.k === 'mhold_on') h = e; else if (e.k === 'mhold_off' || e.k === 'done') h = null; }); return h; }
/* where an account is on the ladder today. it: its record (null if none yet, or if it's back on the list after being resolved) */
function ladState(a, it, asOf, today) {
  if (!onLadder(a)) return null;
  const E = ladEntries(it), done = {}, signed = {}, hold = holdOf(it);
  let broke = null, plan = false;
  E.forEach(e => {
    if (e.k === 'ladder' && own(LAD_BY, e.step)) done[e.step] = e;
    else if (e.k === 'drA_ok' && own(LAD_BY, e.step)) signed[e.step] = e;
    else if (e.k === 'aa_broken') broke = e;
    else if (e.k === 'pt_plan') plan = true;
  });
  const q = it && it.drA ? drAQuestion(it) : null, asked = q && q.k === 'drA_ask' && own(LAD_BY, q.step) ? q.step : '';
  const day = ladDays(a, asOf, today);
  let reached = 0, last = -1;
  LADDER.forEach((s, i) => { if (day >= s.day) reached = i; if (done[s.id]) last = i; });
  const fin = done.aa || done.l7 || null, endOn = fin ? nextOfficeDay(addDays(isoOf(new Date(fin.at)), 30)) : '';
  const st = it && it.state === 'open' ? it.stage : '';
  const why = it && it.state === 'done' ? 'done' : st === 'plan' ? 'plan' : st === 'hold' ? 'hold' : st === 'promise' && it.follow && it.follow >= today ? 'promise' : '';
  const pip = /in\s*process/i.test(a.note || '');
  let due = null, paused = '';
  if (why === 'done') paused = 'done';
  else if (broke && !done.aa) due = LAD_AA;
  else if (fin) due = endOn <= today ? (done.aa ? LAD_ENDAA : LAD_END) : null;
  else if (why) paused = why;
  else if (reached > last && !(reached === 0 && pip)) due = LADDER[reached];
  const next = fin || (broke && !done.aa) ? null : LADDER[Math.max(reached, last) + 1] || null;
  return { day, done, signed, asked, hold, broke, plan, fin, endOn, pip, paused, due, next, nextOn: next ? ladDate(a, asOf, today, next.day) : '', reached, last };
}
/* a step done. o: { by, note } — the account's follow-up isn't moved: the next step comes due by itself */
function ladderLog(item, id, o, now) {
  const s = own(LAD_BY, id) ? LAD_BY[id] : null; if (!s) throw errCode('bad-step');
  if (ladEntries(item).some(e => e.k === 'ladder' && e.step === id)) throw errCode('step-done', s.s + ' is already recorded on this account.');
  o = o || {};
  const e = { id: uid8(), at: now, by: o.by || '', k: 'ladder', step: id, note: String(o.note || '').trim(), prev: { stage: item.stage, follow: item.follow, drA: !!item.drA } };
  const q = item.drA ? drAQuestion(item) : null;
  if (q && q.k === 'drA_ask' && q.step === id) item.drA = false; // signed outside the app and sent: it leaves Dr. A's list
  item.log = (item.log || []).concat([e]);
  item.stage = 'waiting';
  return e;
}
/* ask Dr. A to sign a letter (it shows on his Today until he answers) */
function askSign(item, id, o, now) {
  const s = own(LAD_BY, id) ? LAD_BY[id] : null; if (!s || !s.dra) throw errCode('bad-step');
  o = o || {};
  item.log = (item.log || []).concat([{ id: uid8(), at: now, by: o.by || '', k: 'drA_ask', step: id, note: String(o.note || '').trim(), prev: { stage: item.stage, follow: item.follow, drA: !!item.drA } }]);
  item.drA = true;
}
/* Dr. A signed it (answering the request, or on his own) */
function signStep(item, id, o, now) {
  const s = own(LAD_BY, id) ? LAD_BY[id] : null; if (!s || !s.dra) throw errCode('bad-step');
  const q = item.drA ? drAQuestion(item) : null;
  if (q && q.k === 'drA_ask' && q.step === id) return answerDrA(item, true, o, now);
  item.log = (item.log || []).concat([{ id: uid8(), at: now, by: (o && o.by) || '', k: 'drA_ok', step: id, note: String((o && o.note) || '').trim() }]);
}
/* Maintenance Hold on or off (in Edge: the yellow box and a treatment note; the FC tells the clinical team) */
function holdLog(item, on, o, now) {
  o = o || {};
  item.log = (item.log || []).concat([{ id: uid8(), at: now, by: o.by || '', k: on ? 'mhold_on' : 'mhold_off', note: String(o.note || '').trim(), prev: { stage: item.stage, follow: item.follow, drA: !!item.drA } }]);
}
/* the Alternative Arrangement was broken: Letter #8 comes next */
function breakArrangement(item, o, now) {
  o = o || {};
  item.log = (item.log || []).concat([{ id: uid8(), at: now, by: o.by || '', k: 'aa_broken', note: String(o.note || '').trim(), prev: { stage: item.stage, follow: item.follow, drA: !!item.drA } }]);
  item.stage = 'working';
}

/* =====================================================================
   What's read back from the database is checked before it's used:
   reports, their totals and account records are sealed by an office
   browser, but nothing in them is trusted to be the right type.
   ===================================================================== */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const numOr0 = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const numOrNull = v => (typeof v === 'number' && isFinite(v) ? v : null);
const strOf = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '').slice(0, max || 200);
const isoOrBlank = v => (typeof v === 'string' && ISO_RE.test(v) ? v : '');
function normCover(c) { c = c && typeof c === 'object' ? c : {}; return { full: c.full === true, pastDue: c.pastDue === true, credit: c.credit === true, ins: c.ins !== false }; }
function normRow(r) {
  r = r && typeof r === 'object' ? r : {};
  const days = numOrNull(r.days);
  return { patient: strOf(r.patient), sts: strOf(r.sts, 60), rp: strOf(r.rp), home: strOf(r.home, 60), work: strOf(r.work, 60),
    due: numOr0(r.due), b0: numOr0(r.b0), b30: numOr0(r.b30), b60: numOr0(r.b60), b90: numOr0(r.b90), days: days == null ? null : Math.round(days),
    bal: numOrNull(r.bal), lastAmt: numOrNull(r.lastAmt), recv: isoOrBlank(r.recv), note: strOf(r.note, 300), key: strOf(r.key, 400) };
}
function normReport(rep) {
  rep = rep && typeof rep === 'object' ? rep : {};
  const bk = x => { const o = { n: Math.max(0, Math.round(numOr0(x && x.n))), bal: numOr0(x && x.bal) }; if (x && numOrNull(x.act) != null) o.act = Math.max(0, Math.round(x.act)); return o; }, b = rep.book && typeof rep.book === 'object' ? rep.book : null;
  return {
    asOf: isoOrBlank(rep.asOf), cover: normCover(rep.cover),
    book: b ? Object.assign(bk(b), { due: numOr0(b.due), pt: bk(b.pt), ins: bk(b.ins) }) : null,
    rows: Array.isArray(rep.rows) ? rep.rows.map(normRow).filter(r => r.patient && r.key) : [],
    files: Array.isArray(rep.files) ? rep.files.slice(0, 10).map(f => ({ name: strOf(f && f.name), kind: strOf(f && f.kind, 10), subgroup: strOf(f && f.subgroup, 80), options: strOf(f && f.options), edge: strOf(f && f.edge, 40), n: Math.round(numOr0(f && f.n)), ok: f && typeof f.ok === 'boolean' ? f.ok : null })) : [],
    made: numOrNull(rep.made)
  };
}
function normSum(s) {
  if (!s || typeof s !== 'object') return null;
  const i = v => Math.max(0, Math.round(numOr0(v)));
  const kp = s.kp && typeof s.kp === 'object' ? { ptOf: i(s.kp.ptOf), ptPd: i(s.kp.ptPd), ptPd30: i(s.kp.ptPd30), insOf: numOrNull(s.kp.insOf) == null ? null : i(s.kp.insOf), insLate: numOrNull(s.kp.insLate) == null ? null : i(s.kp.insLate), win: i(s.kp.win) } : null;
  return { asOf: isoOrBlank(s.asOf), cover: normCover(s.cover), pd: numOr0(s.pd), b90: numOr0(s.b90), b31: numOr0(s.b31), n91: i(s.n91), never: i(s.never), neverPd: numOr0(s.neverPd), cr: numOr0(s.cr), crWork: numOr0(s.crWork), crN: i(s.crN), bal: numOrNull(s.bal), kp, fl: normFlow(s.fl) };
}
const LOG_KINDS = new Set(Object.keys(LOGS).concat(['done', 'reopen', 'drA_ask', 'drA_ok', 'drA_no', 'ladder', 'aa_broken', 'mhold_on', 'mhold_off', 'edgetask']));
function normLog(e) {
  e = e && typeof e === 'object' ? e : {};
  const o = { id: strOf(e.id, 40), at: numOr0(e.at), by: strOf(e.by, 60), k: LOG_KINDS.has(e.k) ? e.k : 'note', note: strOf(e.note, 2000) };
  if (o.k === 'done') o.outcome = own(OUTCOMES, e.outcome) ? e.outcome : 'other';
  if (own(LAD_BY, e.step)) o.step = e.step;
  if (o.k === 'reopen' && e.fresh === true) o.fresh = true;
  if (isoOrBlank(e.date)) o.date = e.date;
  if (numOrNull(e.amt) != null) o.amt = e.amt;
  if (o.k === 'edgetask') { if (/^t[0-9a-z]{4,14}$/.test(String(e.et || ''))) o.et = e.et; o.op = strOf(e.op, 60); }
  if (e.prev && typeof e.prev === 'object') o.prev = { stage: own(STAGES, e.prev.stage) ? e.prev.stage : '', follow: isoOrBlank(e.prev.follow), drA: e.prev.drA === true };
  return o;
}
function normItem(it) {
  if (!it || typeof it !== 'object' || it.locked) return it;
  const checks = {}; REFUND_CHECKS.forEach(([k]) => { if (it.checks && it.checks[k] === true) checks[k] = true; });
  return {
    id: strOf(it.id, 40), rev: numOr0(it.rev), v: numOr0(it.v), status: it.status === 'done' ? 'done' : 'open', by: strOf(it.by, 60), updatedAt: numOrNull(it.updatedAt), createdAtSrv: numOrNull(it.createdAtSrv),
    key: strOf(it.key, 400), name: strOf(it.name), rp: strOf(it.rp), src: it.src === 'ins' ? 'ins' : 'pt', kind: it.kind === 'cr' ? 'cr' : 'pd',
    state: it.state === 'done' ? 'done' : 'open', stage: own(STAGES, it.stage) ? it.stage : '', outcome: own(OUTCOMES, it.outcome) ? it.outcome : '',
    assignee: strOf(it.assignee, 60), follow: isoOrBlank(it.follow), drA: it.drA === true, checks,
    log: Array.isArray(it.log) ? it.log.slice(-500).map(normLog) : [],
    createdAt: numOr0(it.createdAt), createdBy: strOf(it.createdBy, 60), resolvedAt: numOrNull(it.resolvedAt), resolvedBy: strOf(it.resolvedBy, 60)
  };
}

/* =====================================================================
   Insurance carriers (6 Oct 2026). Edge's A/R Aging names the
   policyholder on an insurance row, not the carrier, so the office tags
   each insurance account with its carrier once. The carriers (phone,
   portal, payer ID, timely-filing limit, notes) and the tags live in
   one sealed record, "the carrier book", saved like an account's record
   (arItems, with its history) — so no new database rules were needed.
   ===================================================================== */
const BOOK_KEY = '\u0001carriers';
const CARRIER_ID = /^c[0-9a-f]{12}$/;
function emptyBook() { return { book: 1, key: '', name: '', rp: '', src: 'ins', kind: 'pd', state: 'open', stage: '', log: [], carriers: [], tags: {}, ob: [] }; }
function cleanUrl(u) { u = String(u || '').trim(); return u.length <= 300 && /^https?:\/\/[^\s<>"'`]+$/i.test(u) ? u : ''; }
function normCarrier(c) {
  c = c && typeof c === 'object' ? c : {};
  const tf = Number(c.tf);
  return { id: CARRIER_ID.test(c.id) ? c.id : '', name: strOf(c.name, 60).trim(), phone: strOf(c.phone, 40).trim(), portal: cleanUrl(c.portal), payer: strOf(c.payer, 40).trim(),
    fax: strOf(c.fax, 40).trim(), tf: Number.isInteger(tf) && tf > 0 && tf <= 1095 ? tf : 0, notes: strOf(c.notes, 1000), edge: edgeNames(c.edge) };
}
/* the names Edge's Insurance Aging uses for a carrier (as Edge prints them; matched without case, spaces or punctuation) */
function edgeName(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80); }
function edgeNames(l) { const seen = new Set(); return (Array.isArray(l) ? l : []).filter(x => typeof x === 'string').map(x => x.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(x => { const k = edgeName(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20); }
function normBook(b) {
  if (!b || typeof b !== 'object' || !b.book || b.locked) return null;
  const carriers = (Array.isArray(b.carriers) ? b.carriers.slice(0, 200) : []).map(normCarrier).filter(c => c.id && c.name);
  const ids = new Set(carriers.map(c => c.id)), tags = {};
  if (b.tags && typeof b.tags === 'object') Object.keys(b.tags).slice(0, 5000).forEach(k => { const v = b.tags[k]; if (k.length <= 400 && typeof v === 'string' && ids.has(v)) tags[k] = v; });
  const ob = (Array.isArray(b.ob) ? b.ob.slice(-60) : []).map(x => x && typeof x === 'object' ? { id: strOf(x.id, 20), at: numOr0(x.at), by: strOf(x.by, 60), for: isoOrBlank(x.for), n: Number.isInteger(x.n) && x.n >= 0 && x.n <= 500 ? x.n : null, note: strOf(x.note, 300) } : null).filter(x => x && x.for && x.at);
  // Edge's carrier for each insurance account (from its Insurance Aging): one carrier, or — the same patient and policyholder
  // under two carriers (two contracts) — each with its balance, to tell them apart
  const etags = {};
  if (b.etags && typeof b.etags === 'object' && !Array.isArray(b.etags)) Object.keys(b.etags).slice(0, 6000).forEach(k => {
    const v = b.etags[k], d = v && typeof v === 'object' ? isoOrBlank(v.d) : ''; if (k.length > 400 || !d) return;
    if (typeof v.c === 'string' && ids.has(v.c)) etags[k] = { c: v.c, d };
    else if (Array.isArray(v.m)) { const m = v.m.slice(0, 6).filter(x => x && typeof x.c === 'string' && ids.has(x.c)).map(x => ({ c: x.c, bal: numOrNull(x.bal), due: numOrNull(x.due) })); if (m.length) etags[k] = { m, d }; }
  });
  const e = b.edge && typeof b.edge === 'object' && isoOrBlank(b.edge.asOf) ? { asOf: b.edge.asOf, at: numOr0(b.edge.at), by: strOf(b.edge.by, 60), n: Number.isInteger(b.edge.n) && b.edge.n >= 0 ? b.edge.n : 0, groups: Number.isInteger(b.edge.groups) && b.edge.groups >= 0 ? b.edge.groups : 0 } : null;
  return { id: strOf(b.id, 40), rev: numOr0(b.rev), v: numOr0(b.v), updatedAt: numOrNull(b.updatedAt), carriers: carriers.sort((x, y) => x.name.localeCompare(y.name)), tags, ob, etags, edge: e };
}
/* an account's key without the "#2" the A/R report adds when the same patient and payer are on it twice */
function baseKey(key) { return String(key || '').replace(/#\d+$/, ''); }
/* Edge's carrier for an account (a: the account, to tell two contracts of one patient and policyholder apart by balance) */
function edgeIdOf(book, key, a) {
  const e = book && book.etags && book.etags[baseKey(key)]; if (!e) return '';
  if (e.c) return e.c;
  if (!a || a.bal == null || !Array.isArray(e.m)) return '';
  const hit = e.m.filter(x => x.bal != null && Math.abs(x.bal - a.bal) < 0.005);
  return hit.length && hit.every(x => x.c === hit[0].c) ? hit[0].c : '';
}
/* the account's carrier: the one set by hand, else Edge's */
function carrierOf(book, key, a) {
  if (!book) return null;
  const id = book.tags[key] || edgeIdOf(book, key, a);
  return id ? book.carriers.find(c => c.id === id) || null : null;
}
/* where it comes from: set by hand (and whether Edge has it under another carrier), or from Edge */
function carrierSrc(book, key, a) {
  const find = id => (id && book ? book.carriers.find(c => c.id === id) || null : null);
  const hand = book ? find(book.tags[key]) : null, edge = book ? find(edgeIdOf(book, key, a)) : null;
  return { c: hand || edge, hand, edge, differs: !!(hand && edge && hand.id !== edge.id) };
}
/* changes to the carrier book, made on its decrypted copy */
function bookFix(d) { if (!Array.isArray(d.carriers)) d.carriers = []; if (!d.tags || typeof d.tags !== 'object') d.tags = {}; if (!d.etags || typeof d.etags !== 'object' || Array.isArray(d.etags)) d.etags = {}; if (!Array.isArray(d.ob)) d.ob = []; Object.assign(d, { book: 1, key: '', state: 'open' }); return d; }
function carrierSave(d, f, o, now) {
  bookFix(d); f = f || {};
  const c = normCarrier(Object.assign({}, f, { id: f.id || 'c' + uid8() }));
  if (!c.name) throw errCode('need-name', 'Give the carrier a name.');
  if (String(f.portal || '').trim() && !c.portal) throw errCode('bad-url', 'The portal needs to be a web address starting with https://');
  if (d.carriers.some(x => x.id !== c.id && String(x.name || '').trim().toLowerCase() === c.name.toLowerCase())) throw errCode('dup', c.name + ' is already in the list.');
  const rec = Object.assign(c, { at: now, by: (o && o.by) || '' }), i = d.carriers.findIndex(x => x.id === c.id);
  if (f.edge === undefined && i >= 0) rec.edge = edgeNames(d.carriers[i].edge); // editing it keeps Edge's names for it
  if (i >= 0) d.carriers[i] = rec; else d.carriers.push(rec);
  return c.id;
}
function carrierRemove(d, id) {
  bookFix(d); d.carriers = d.carriers.filter(x => x.id !== id); Object.keys(d.tags).forEach(k => { if (d.tags[k] === id) delete d.tags[k]; });
  Object.keys(d.etags).forEach(k => { const v = d.etags[k]; if (!v || v.c === id) { delete d.etags[k]; return; } if (Array.isArray(v.m)) { v.m = v.m.filter(x => x && x.c !== id); if (!v.m.length) delete d.etags[k]; } });
}
function carrierTag(d, keys, id) {
  bookFix(d);
  if (id && !d.carriers.some(x => x.id === id)) throw errCode('gone', 'That carrier was just removed.');
  keys.forEach(k => { if (id) d.tags[k] = id; else delete d.tags[k]; });
}
/* the other insurance accounts under the same policyholder (brothers and sisters on a parent's plan) */
function sameHolder(accts, a) { const h = normName(rpName(a)); return h ? accts.filter(x => x.ins && x.key !== a.key && normName(rpName(x)) === h) : []; }
/* the same company twice (Edge often lists one under two names): its accounts, Edge's names for it and anything filled in on
   it move to `into`, and it's removed — so the next Insurance Aging puts those accounts on `into` too */
function carrierMerge(d, fromId, intoId) {
  bookFix(d);
  const from = d.carriers.find(x => x.id === fromId), into = d.carriers.find(x => x.id === intoId);
  if (!from || !into || from === into) throw errCode('gone', 'Those carriers just changed — try again.');
  into.edge = edgeNames((Array.isArray(into.edge) ? into.edge : []).concat(Array.isArray(from.edge) ? from.edge : []));
  ['phone', 'portal', 'payer', 'fax'].forEach(k => { if (!String(into[k] || '').trim() && String(from[k] || '').trim()) into[k] = from[k]; });
  if (!into.tf && from.tf) into.tf = from.tf;
  if (String(from.notes || '').trim()) into.notes = (String(into.notes || '').trim() ? into.notes + '\n' + from.notes : from.notes).slice(0, 1000);
  Object.keys(d.tags).forEach(k => { if (d.tags[k] === fromId) d.tags[k] = intoId; });
  Object.keys(d.etags).forEach(k => {
    const v = d.etags[k]; if (!v) return;
    if (v.c === fromId) v.c = intoId;
    if (Array.isArray(v.m)) { v.m.forEach(x => { if (x && x.c === fromId) x.c = intoId; }); if (v.m.length && v.m.every(x => x && x.c === v.m[0].c)) d.etags[k] = { c: v.m[0].c, d: v.d }; }
  });
  d.carriers = d.carriers.filter(x => x.id !== fromId);
}

/* =====================================================================
   Carriers from Edge's Insurance Aging (6 Oct 2026). That report groups
   the insurance accounts by carrier, so one import gives each insurance
   account its carrier, and each carrier Edge's phone number. Edge's say
   is kept by account (etags), apart from the carriers set by hand
   (tags): those always win and an import never changes them. Edge's
   carriers are matched to the book's by an earlier import's link, or by
   name — so a carrier the office renamed or merged stays as it is.
   p: the report (insAgingFromGrid); o: { by, today, idFor(name) → the id for a new carrier }.
   ===================================================================== */
function edgeCarriersApply(d, p, o, now) {
  bookFix(d); o = o || {};
  const asOf = isoOrBlank(p.asOf) || o.today || isoOf(new Date(now)), res = { added: [], linked: 0, phones: 0, accounts: 0, twice: 0, older: false, full: false };
  // 1. Edge's carriers → the book's; a carrier Edge lists twice under one name is one carrier
  const byEdge = new Map(), byName = new Map(), idOf = new Map();
  d.carriers.forEach(c => { edgeNames(c.edge).forEach(n => { if (!byEdge.has(edgeName(n))) byEdge.set(edgeName(n), c); }); const nn = edgeName(c.name); if (nn && !byName.has(nn)) byName.set(nn, c); });
  for (const g of p.groups || []) {
    const n = edgeName(g.name), phone = String(g.phone || '').trim().slice(0, 40); if (!n) continue;
    let c = byEdge.get(n) || byName.get(n);
    if (!c) {
      if (d.carriers.length >= 200) { res.full = true; continue; } // the carrier book's limit
      c = { id: (o.idFor && o.idFor(n)) || 'c' + uid8(), name: String(g.name).replace(/\s+/g, ' ').trim().slice(0, 60), phone, portal: '', payer: '', fax: '', tf: 0, notes: '', edge: [g.name], at: now, by: o.by || '' };
      d.carriers.push(c); res.added.push(c.name);
    } else {
      const names = edgeNames(c.edge);
      if (!names.some(x => edgeName(x) === n)) { c.edge = edgeNames(names.concat([g.name])); if (!idOf.has(n)) res.linked++; }
      if (!String(c.phone || '').trim() && phone) { c.phone = phone; res.phones++; }
    }
    byEdge.set(n, c); idOf.set(n, c.id);
  }
  // 2. each account (keyed like the A/R lists: patient + policyholder) gets Edge's carrier, unless a newer import already said
  const per = new Map();
  for (const r of p.rows || []) {
    const id = idOf.get(edgeName(r.carrier)); if (!id) continue;
    const k = acctKey(isIns(r) ? r : Object.assign({}, r, { rp: 'INS: ' + (r.rp || '') }));
    if (!per.has(k)) per.set(k, []);
    per.get(k).push({ c: id, bal: numOrNull(r.bal), due: numOrNull(r.due) });
  }
  per.forEach((l, k) => {
    const cur = d.etags[k]; if (cur && isoOrBlank(cur.d) > asOf) return;
    const one = l.every(x => x.c === l[0].c);
    d.etags[k] = one ? { c: l[0].c, d: asOf } : { m: l.slice(0, 6), d: asOf };
    res.accounts++; if (!one) res.twice++;
  });
  // 3. the date of the newest import; accounts not on any Insurance Aging for over a year are let go (the book stays small)
  if (d.edge && isoOrBlank(d.edge.asOf) > asOf) res.older = true;
  else d.edge = { asOf, at: now, by: o.by || '', n: (p.rows || []).length, groups: (p.groups || []).length };
  const cut = addDays(d.edge.asOf, -400);
  Object.keys(d.etags).forEach(k => { const v = d.etags[k]; if (!v || typeof v !== 'object' || !isoOrBlank(v.d) || v.d < cut) delete d.etags[k]; });
  return res;
}
/* what an import would do, for its preview: run on a copy of the book, then count the A/R report's insurance accounts */
function edgeCarriersPlan(bookRaw, p, accts, o, now) {
  const raw = JSON.parse(JSON.stringify(bookRaw || emptyBook())), before = normBook(Object.assign({}, raw, { book: 1 })), d = bookFix(raw);
  const res = edgeCarriersApply(d, p, o, now), after = normBook(d), ins = (accts || []).filter(a => a.ins);
  const has = (b, a) => !!carrierOf(b, a.key, a);
  return Object.assign(res, { ins: ins.length, got: ins.filter(a => has(after, a)).length, newly: ins.filter(a => !has(before, a) && has(after, a)).length,
    differ: ins.filter(a => carrierSrc(after, a.key, a).differs).length, without: ins.filter(a => !has(after, a)).length, carriers: after.carriers.length, book: after });
}

/* =====================================================================
   Edge tasks, imported (8 Oct 2026). Before A/R the FC kept her work as
   Edge tasks: a title with the patient's name in it ("LETTERS - Jane
   Doe", "AA MADE - …", "INS MetLife Questionnaire Jane Doe", "PT - …"),
   a due date and a running description. Each task is matched to its
   account on the A/R report and added to it as an "Edge task" entry.
   It only fills what's empty: the follow-up (the task's due date — an
   overdue one, the next office day unless asked otherwise), the stage
   (an "AA MADE" task: payment plan, which pauses the ladder) and who
   it's assigned to. Nothing already set in A/R changes, and a task
   already added isn't added again.
   ===================================================================== */
const NAME_SFX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
/* a name's words: lower case, accents, apostrophes, titles and Jr./III left out ("D'Testa" → "dtesta", "Testa-Fakewood" → "testa fakewood");
   camel: words run together split where a capital follows a small letter ("FakewellWaiting" → "fakewell waiting", "McKay" → "mc kay") */
function nameWords(s, camel) {
  let t = String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '');
  if (camel) t = t.replace(/([a-z])([A-Z])/g, '$1 $2');
  return t.toLowerCase().replace(/^\s*ins\s*:\s*/, '').replace(/\b(mr|mrs|ms|miss|dr)\.?\s+/g, '').split(/[^a-z]+/).filter(w => w && !NAME_SFX.has(w));
}
/* letters apart, a swapped pair counting once ("Robni" / "Robin" = 1) */
function nameDist(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(new Array(n).fill(0)));
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
function taskIsIns(title) { return /^\s*(ins\b|terminated\s+ins\b)/i.test(title || ''); }
function taskIsAA(title) { return /^\s*aa\s+made\b/i.test(title || ''); }
/* the same task (title, due date, text) always gets the same id, so importing again adds nothing new */
function taskId(t) {
  const s = nameWords(t.title).join(' ') + '|' + (t.due || '') + '|' + String(t.desc || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0; }
  return 't' + h1.toString(36) + h2.toString(36).slice(0, 4);
}
/* how a name's words w sit in a title's words tw: 3 = as written (a middle name or two between, or first and last run together),
   2 = the first or last name a letter or two off ("Robni Testfield"), 0 = not there */
function wordsFit(tw, w) {
  if (w.length < 2) return 0;
  const f = w[0], l = w[w.length - 1], tol = s => (s.length >= 6 ? 2 : 1);
  let best = 0;
  for (let i = 0; i < tw.length; i++) {
    const x = tw[i];
    if (x === f + l) return 3;
    if (x === f) for (let j = i + 1; j <= i + 3 && j < tw.length; j++) if (tw[j] === l) return 3;
    const y = tw[i + 1]; if (!y) continue;
    if (y === l && f.length >= 3 && x.length >= 3 && nameDist(x, f) <= tol(f)) best = 2;
    if (x === f && l.length >= 4 && nameDist(y, l) <= tol(l)) best = 2;
  }
  return best;
}
/* a name or title read both ways — as written, and with words run together split apart ("RobinTestfield", "FakewellWaiting"
   in a title; "McKay" in a title or a name) — each as its words and the set of them */
function nameForms(s) {
  const a = nameWords(s, false), b = nameWords(s, true), f = w => ({ w, set: new Set(w) });
  return a.join(' ') === b.join(' ') ? [f(a)] : [f(a), f(b)];
}
/* the best fit over both readings of each; a title without the first name, the last name or the two run together can't fit
   (wordsFit needs one of them as written), so it's passed over at once */
function formsFit(tf, nf) {
  let best = 0;
  for (const t of tf) for (const n of nf) {
    const w = n.w; if (w.length < 2) continue;
    const f = w[0], l = w[w.length - 1]; if (!t.set.has(f) && !t.set.has(l) && !t.set.has(f + l)) continue;
    best = Math.max(best, wordsFit(t.w, w)); if (best === 3) return 3;
  }
  return best;
}
/* how a name sits in a task title, so "Arden Demo" never fits "Arden Demoray" */
function nameFit(title, name) { return formsFit(nameForms(title), nameForms(name)); }
/* each account's names read once, for matching many tasks */
function nameIndex(accts) { return (accts || []).map(a => ({ a, pf: nameForms(a.patient), rf: nameForms(rpName(a)) })); }
/* the account a task belongs to: { how: 'exact' | 'close' | 'two' | 'none', a, why, cands }. An "INS …" task goes with the
   insurance account, the rest with the patient's own; only a name as written on the right kind of account is 'exact' —
   a name a letter off, the other kind of account or the responsible party's name is 'close' (to be ticked in the preview).
   ix: nameIndex(accts), when there are many tasks */
function taskMatch(accts, t, ix) {
  const wantIns = taskIsIns(t.title), tf = nameForms(t.title), hits = [];
  for (const x of ix || nameIndex(accts)) {
    const a = x.a, fit = formsFit(tf, x.pf), rp = fit ? 0 : formsFit(tf, x.rf);
    if (!fit && rp < 3) continue;
    const same = !!a.ins === wantIns;
    hits.push({ a, score: fit ? (fit === 3 ? 6 : 4) - (same ? 0 : 1) : 2,
      why: !fit ? 'by the responsible party’s name' : fit === 2 ? 'the name is spelled differently' : !same ? (a.ins ? 'the insurance account' : 'the patient’s own account') : '' });
  }
  if (!hits.length) return { how: 'none', a: null, why: '', cands: [] };
  const top = Math.max(...hits.map(h => h.score)), best = hits.filter(h => h.score === top);
  if (best.length > 1) return { how: 'two', a: null, why: 'more than one account fits', cands: best.map(h => h.a) };
  return { how: top === 6 ? 'exact' : 'close', a: best[0].a, why: best[0].why, cands: [best[0].a] };
}
/* the follow-up a task gives: its due date (on an office day); an overdue one the next office day, its own date (overdue 'edge'),
   or the account's day in the spread (overdue 'spread', spreadOn) */
function taskFollow(due, today, overdue, spreadOn) {
  if (!isoOrBlank(due)) return '';
  if (due >= today) return nextOfficeDay(due);
  return overdue === 'edge' ? due : overdue === 'spread' && isoOrBlank(spreadOn) ? spreadOn : nextOfficeDay(today);
}
/* a long list of overdue tasks spread over the next `days` office days instead of all on one day: the accounts whose earliest
   task is overdue, oldest first, about the same number each day → { key: date }. groups: [{ a, tasks }] (edgeTasksPlan's by) */
function spreadFollow(groups, today, days) {
  const late = (groups || []).map(g => ({ key: g.a.key, due: (g.tasks || []).map(t => isoOrBlank(t.due)).filter(Boolean).sort()[0] || '' }))
    .filter(x => x.due && x.due < today).sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
  const per = Math.max(1, Math.ceil(late.length / Math.max(1, days || 10))), out = {};
  let d = nextOfficeDay(today);
  late.forEach((x, i) => { if (i && i % per === 0) d = nextOfficeDay(addDays(d, 1)); out[x.key] = d; });
  return out;
}
/* the import: each task's account (the match, or the pick made in the preview: picks[i] = an account key or ''), whether it's
   already on that account, and per account the tasks to add. A task already on one of the accounts that fit (ticked in an
   import before) counts as added before, so it isn't asked about again. itemOf(key) → the account's record or null;
   matches: each task's taskMatch, if worked out already (the preview keeps them while it's open) */
function edgeTasksPlan(accts, itemOf, tasks, picks, matches) {
  const ix = matches ? null : nameIndex(accts), byKey = new Map((accts || []).map(a => [a.key, a]));
  const rows = (tasks || []).map((t, i) => {
    const id = taskId(t), m = matches ? matches[i] : taskMatch(accts, t, ix), has = a => { const it = a ? itemOf(a.key) : null; return !!(it && (it.log || []).some(e => e && e.et === id)); };
    const picked = !!picks && Object.prototype.hasOwnProperty.call(picks, i), before = picked ? null : (m.cands || []).find(has) || null;
    const p = picked ? picks[i] : before ? before.key : m.how === 'exact' ? m.a.key : '';
    const a = p ? byKey.get(p) || null : null;
    return { i, t, id, m, a, dupe: has(a) };
  });
  const by = new Map();
  rows.forEach(r => { if (!r.a || r.dupe) return; if (!by.has(r.a.key)) by.set(r.a.key, { a: r.a, tasks: [] }); by.get(r.a.key).tasks.push(Object.assign({ id: r.id }, r.t)); });
  return { rows, by };
}
/* add an account's tasks to its record (mutates it): one "Edge task" entry each; an empty follow-up gets the earliest one they
   give, an empty stage "payment plan" for an AA MADE task (o.aa), an empty assignee o.assign — never on a resolved account.
   o: { by, today, overdue: 'today' | 'edge' | 'spread', spreadOn: the account's day in the spread, aa, assign } → how many were added */
function edgeTasksApply(item, list, o, now) {
  o = o || {};
  const today = o.today || isoOf(new Date(now)), have = new Set((item.log || []).map(e => e && e.et).filter(Boolean)), add = (list || []).filter(t => t && t.id && !have.has(t.id));
  if (!add.length) return 0;
  const prev = { stage: item.stage || '', follow: item.follow || '', drA: !!item.drA };
  item.log = (item.log || []).concat(add.map(t => {
    const e = { id: uid8(), at: now, by: o.by || '', k: 'edgetask', note: (String(t.title || '') + (t.desc ? '\n' + t.desc : '')).slice(0, 2000), et: t.id, op: String(t.op || '').slice(0, 60), prev };
    if (isoOrBlank(t.due)) e.date = t.due;
    return e;
  }));
  if (item.state !== 'done') {
    if (!item.follow) { const f = add.map(t => taskFollow(t.due, today, o.overdue, o.spreadOn)).filter(Boolean).sort()[0]; if (f) item.follow = f; }
    if (!item.stage && o.aa && add.some(t => taskIsAA(t.title))) item.stage = 'plan';
    if (!item.assignee && o.assign) item.assignee = o.assign;
  }
  return add.length;
}

/* =====================================================================
   Focus (6 Oct 2026): what to do first today, as one list across the
   collections ladder, follow-ups, insurance, credits and Dr. A's OKs.
   Urgent: a promise to pay whose day passed; a letter waiting a week or
   more for Dr. A, or a step a week late; insurance near its carrier's
   filing limit or with nothing paid well past the chase window; an
   account about to reach day 90 or 120; a big balance new this week; a
   follow-up 3+ office days late. One line per account (its most urgent
   reason first, the rest listed with it).
   ===================================================================== */
const FOCUS_SEV = { promise: 1, signlate: 2, tf: 3, ladlate: 4, cross: 5, new: 6, insinv: 7, followlate: 8,
  sign: 10, lad: 11, drA: 12, follow: 13, chase: 14, claim: 15, end: 16, creditaudit: 17, credit: 20, nofile: 21, wait: 22 };
/* office days after `from`, up to and including `today` */
function officeDaysLate(from, today) { let n = 0, d = from; for (let i = 0; i < 400 && d < today; i++) { d = addDays(d, 1); if (nextOfficeDay(d) === d) n++; } return n; }
/* about how long a step takes, in minutes */
function stepMin(s) { return s.id === 'end' || s.id === 'endaa' ? 5 : (s.n ? (s.cert ? 7 : 4) : 2) + (s.call ? 5 : 0); }
/* ctx: { accts, asOf: the report's date, byKey, item(key) → its record (null if none, or back on the list), lad(a) → its ladder state, open: open records,
   cleared(it), today, owner, prevPd: keys past due in the report before (or null), book, auditStart: the December credit audit's first day, while it runs } */
function focusEntries(ctx) {
  const t = ctx.today, best = new Map();
  const put = e => { const cur = best.get(e.key); if (!cur) best.set(e.key, e); else if (e.sev < cur.sev) { e.also = [cur.why].concat(cur.also); best.set(e.key, e); } else cur.also.push(e.why); };
  const mk = (a, it, kind, why, act, min, amt) => { const sev = FOCUS_SEV[kind]; return { key: a ? a.key : it.key, a: a || null, it: it || null, kind, sev, cls: sev < 10 ? 'urgent' : sev < 20 ? 'today' : 'later', why, act, min, amt: amt != null ? amt : a ? (a.pd > 0 ? a.pd : a.credit) : 0, also: [] }; };
  const recent = (it, days) => !!it && (it.log || []).some(e => e.at && e.k !== 'edgetask' && daysBetween(isoOf(new Date(e.at)), t) <= days);
  const filed = it => !!it && ladEntries(it).some(e => e.k === 'ins_filed' || e.k === 'ins_resub' || e.k === 'ins_appeal');
  (ctx.accts || []).forEach(a => {
    const it = ctx.item(a.key);
    if (it && it.state === 'done') return; // resolved (and not past due or in credit again)
    if (onLadder(a)) {
      const L = ctx.lad(a);
      if (L && L.due) {
        // "late" only once an account is moving up the ladder (a step recorded this round): an account nobody had started on isn't late, it's next
        const s = L.due, over = s.day != null ? L.day - s.day : L.endOn ? Math.max(0, daysBetween(L.endOn, t)) : 0, late = L.last >= 0 && over >= 7 ? ' — ' + over + ' days late' : '';
        const q = it && it.drA ? drAQuestion(it) : null, askedOn = q && q.k === 'drA_ask' && q.step === s.id ? isoOf(new Date(q.at)) : '', waited = askedOn ? officeDaysLate(askedOn, t) : 0;
        if (s.dra && !L.signed[s.id]) {
          if (ctx.owner) put(mk(a, it, waited >= 3 ? 'signlate' : 'sign', s.s + ' needs your signature' + (waited >= 3 ? ' — asked ' + plural(waited, 'office day') + ' ago' : ''), 'Sign', 1));
          else if (L.asked === s.id) put(mk(a, it, waited >= 3 ? 'signlate' : 'wait', 'Waiting for Dr. A to sign ' + s.s + (waited >= 3 ? ' — asked ' + plural(waited, 'office day') + ' ago' : ''), waited >= 3 ? 'Remind Dr. A' : 'Waiting', 0));
          else put(mk(a, it, late ? 'signlate' : 'sign', 'Ask Dr. A to sign ' + s.s + late, 'Ask Dr. A', 1));
        } else if (s.id === 'end' || s.id === 'endaa') put(mk(a, it, 'end', s.l, 'Resolve', stepMin(s)));
        else put(mk(a, it, late ? 'ladlate' : 'lad', s.s + ' due' + late + (s.send ? ' · ' + s.send.split(' · ')[0].toLowerCase() : ''), s.btn, stepMin(s)));
      }
      if (L && !L.paused && !L.fin && !L.broke) {
        const goal = L.day >= 83 && L.day < 90 ? 90 : L.day >= 113 && L.day < 120 ? 120 : 0;
        if (goal && !recent(it, 7)) put(mk(a, it, 'cross', 'Reaches day ' + goal + ' on ' + fmtDay(nextOfficeDay(addDays(t, goal - L.day))) + ' — ' + (goal === 90 ? 'Dr. A’s certified letter is next' : 'the final letter is next'), 'Call', 5));
      }
      if (ctx.prevPd && !ctx.prevPd.has(a.key) && a.pd >= 500 && !(it && (it.log || []).length)) put(mk(a, it, 'new', 'New this week: ' + money(a.pd) + ' past due', 'Call', 5));
    }
    if (a.ins && a.pd > 0) {
      // days past due today: the report's, carried on to today
      const c = carrierOf(ctx.book, a.key, a), dn = a.days != null ? a.days + (ctx.asOf ? Math.max(0, daysBetween(ctx.asOf, t)) : 0) : null;
      if (c && c.tf && dn != null && dn >= c.tf - 30 && dn <= c.tf && !filed(it)) put(mk(a, it, 'tf', c.name + '’s filing limit (' + c.tf + ' days) is ' + (c.tf > dn ? 'in ' + plural(c.tf - dn, 'day') : 'today'), 'Call the carrier', 10));
      if (!it) {
        const who = c ? c.name : 'the carrier';
        if (a.tier === 'investigate') put(mk(a, it, 'insinv', 'Nothing paid in ' + dn + ' days — investigate the claim with ' + who, 'Call the carrier', 10));
        else if (a.tier === 'chase') put(mk(a, it, 'chase', 'Nothing paid in ' + dn + ' days — chase ' + who, 'Call the carrier', 10));
        else if (a.tier === 'nofile') put(mk(a, it, 'nofile', 'Nothing paid in ' + dn + ' days — probably never filed', 'Verify', 10));
        else if (!a.months && a.bucket === '91') put(mk(a, it, 'claim', 'Claim follow-up with ' + who + ' — ' + money(a.b90) + ' at 91+ days', 'Call the carrier', 10));
      }
    }
    if (a.credit > 0 && !(a.pd > 0) && !a.prepay) {
      const k = crAction(a).k, why = k === 'prio' ? 'over 3 years old: refund it or escalate' : k === 'inact' ? 'the patient is inactive: refund or write it off' : k === 'old' ? 'over a year old: find out why' : 'check whether it’s timing';
      if (ctx.auditStart) { if (!auditOf(it, ctx.auditStart).reviewed) put(mk(a, it, 'creditaudit', 'December audit: credit of ' + money(a.credit) + ' — ' + why, 'Review', 8, a.credit)); }
      else if (!it && (k === 'prio' || k === 'inact')) put(mk(a, it, 'credit', 'Credit of ' + money(a.credit) + ' — ' + why, 'Review', 8, a.credit));
    }
  });
  (ctx.open || []).forEach(it => {
    if (!it.key || ctx.cleared(it)) return;
    const a = ctx.byKey.get(it.key) || null;
    if (it.follow && it.follow <= t) {
      if (it.stage === 'promise') put(mk(a, it, it.follow < t ? 'promise' : 'follow', (it.follow < t ? 'Promised to pay by ' + fmtDate(it.follow) : 'Promised to pay today') + ' — check whether it came in', 'Check', 3));
      else { const late = officeDaysLate(it.follow, t), e = lastLog(it); put(mk(a, it, late >= 3 ? 'followlate' : 'follow', 'Follow-up ' + (late ? plural(late, 'office day') + ' late' : 'due today') + (e ? ' — last: ' + logLabel(e).toLowerCase() : ''), 'Follow up', 5)); }
    }
    if (ctx.owner && it.drA) { const q = drAQuestion(it); if (!(q && q.k === 'drA_ask' && q.step)) put(mk(a, it, 'drA', q ? logLabel(q) + (q.note ? ': ' + q.note : '') : 'Waiting for your OK', 'Answer', 2)); }
  });
  return Array.from(best.values()).sort((x, y) => x.sev - y.sev || y.amt - x.amt);
}

/* =====================================================================
   Week over week (6 Oct 2026): what moved between two reports —
   accounts that got current, ones newly past due, ones that slid to an
   older bucket (or into 91+) or got better, and the past due that went
   away (paid, or adjusted in Edge). Kept with each report's sealed
   totals (sum.fl) from now on.
   ===================================================================== */
function flowOf(cur, prev, cfg) {
  if (!cur || !prev || !cur.cover || !prev.cover || !cur.cover.pastDue || !prev.cover.pastDue || !(prev.asOf < cur.asOf)) return null;
  const both = cur.cover.ins && prev.cover.ins, keep = a => a.pd > 0 && (both || !a.ins);
  const P = new Map(reportAccts(prev, cfg).filter(keep).map(a => [a.key, a])), C = new Map(reportAccts(cur, cfg).filter(keep).map(a => [a.key, a]));
  const ord = { '0': 0, '31': 1, '91': 2 }, o = { from: prev.asOf, to: cur.asOf, cured: 0, curedAmt: 0, ptCured: 0, insCured: 0, newN: 0, newAmt: 0, rolled: 0, into91: 0, better: 0, cleared: 0 };
  P.forEach((p, k) => {
    const c = C.get(k);
    if (!c) { o.cured++; o.curedAmt += p.pd; o.cleared += p.pd; if (p.ins) o.insCured++; else o.ptCured++; return; }
    if (ord[c.bucket] > ord[p.bucket]) { o.rolled++; if (c.bucket === '91') o.into91++; } else if (ord[c.bucket] < ord[p.bucket]) o.better++;
    o.cleared += Math.max(0, p.pd - c.pd);
  });
  C.forEach((c, k) => { if (!P.has(k)) { o.newN++; o.newAmt += c.pd; } });
  ['curedAmt', 'newAmt', 'cleared'].forEach(k => { o[k] = round2(o[k]); });
  return o;
}
function normFlow(f) {
  if (!f || typeof f !== 'object') return null;
  const i = v => Math.max(0, Math.round(numOr0(v)));
  return { from: isoOrBlank(f.from), to: isoOrBlank(f.to), cured: i(f.cured), curedAmt: numOr0(f.curedAmt), ptCured: i(f.ptCured), insCured: i(f.insCured), newN: i(f.newN), newAmt: numOr0(f.newAmt), rolled: i(f.rolled), into91: i(f.into91), better: i(f.better), cleared: numOr0(f.cleared) };
}
/* the straight line through the last (up to) 8 weekly rates: when it reaches the goal at this pace.
   pts: [{ asOf, rate }] oldest first → null (under 3 reports) | { met } | { dir: 'up' | 'flat' } | { dir: 'down', weeks, date } */
function paceTo(pts, goal) {
  const P = (pts || []).filter(p => p && ISO_RE.test(p.asOf || '') && typeof p.rate === 'number' && isFinite(p.rate)).slice(-8);
  if (P.length < 3) return null;
  const X = P.map(p => daysBetween(P[0].asOf, p.asOf) / 7), Y = P.map(p => p.rate), n = P.length;
  const mx = X.reduce((s, v) => s + v, 0) / n, my = Y.reduce((s, v) => s + v, 0) / n, sxx = X.reduce((s, v) => s + (v - mx) * (v - mx), 0);
  if (!sxx) return null;
  const slope = X.reduce((s, v, i) => s + (v - mx) * (Y[i] - my), 0) / sxx, cur = Y[n - 1];
  if (cur <= goal + 1e-9) return { met: true, slope, cur };
  if (slope > -0.0005) return { met: false, slope, cur, dir: slope > 0.0005 ? 'up' : 'flat' };
  const weeks = (cur - goal) / -slope;
  return { met: false, slope, cur, dir: 'down', weeks, date: addDays(P[n - 1].asOf, Math.ceil(weeks * 7 - 1e-6)) };
}

/* =====================================================================
   The December credit audit (handbook §15): "Pull a full credit balance
   audit in December each year … By March, all refund checks are cut and
   sent, or money is moved/applied to other accounts." Refunds can go out
   a few at a time. The audit runs December 1 – March 31.
   ===================================================================== */
function auditWindow(today) {
  const [y, m] = today.split('-').map(Number);
  if (m === 12) return { on: true, start: y + '-12-01', end: (y + 1) + '-03-31' };
  if (m <= 3) return { on: true, start: (y - 1) + '-12-01', end: y + '-03-31' };
  return { on: false, start: y + '-12-01', end: (y + 1) + '-03-31' };
}
/* where one credit stands in the audit that started on `start` (anything logged or resolved since then counts as reviewed) */
function auditOf(it, start) {
  const [y, m, d] = start.split('-').map(Number), t0 = new Date(y, m - 1, d).getTime();
  if (!it) return { reviewed: false, done: false, refund: false, st: '' };
  if (it.state === 'done') return (it.resolvedAt || 0) >= t0 ? { reviewed: true, done: true, refund: it.outcome === 'refund', st: OUTCOMES[it.outcome] || 'Resolved' } : { reviewed: false, done: false, refund: false, st: '' };
  const E = (it.log || []).filter(e => (e.at || 0) >= t0 && e.k !== 'reopen' && e.k !== 'edgetask');
  if (!E.length) return { reviewed: false, done: false, refund: false, st: '' };
  const has = k => E.some(e => e.k === k), refund = has('cr_refreq');
  const st = refund ? (E.some(e => e.k === 'drA_ok') ? 'Refund OK’d — cut the check' : E.some(e => e.k === 'drA_no') ? 'Refund: Dr. A said not yet' : 'Refund requested — with Dr. A') :
    has('cr_hold') ? 'Holding for insurance (60 days at most)' : has('cr_review') ? 'Ledger reviewed' : logLabel(E[E.length - 1]);
  return { reviewed: true, done: false, refund, st };
}

/* =====================================================================
   OrthoBanc's failed-payment report (6 Oct 2026). Handbook §14, day 0:
   "OrthoBanc emails of failed payments arrive approximately on the 5th,
   12th, 19th, and 26th of each month. Send a text to the RP immediately
   when the failed payment notification arrives." The email only says the
   report is ready (no names), so the app reminds on those days — on the
   office day it lands on — until someone marks that report checked.
   The checks are kept in the office's sealed record with the carriers.
   ===================================================================== */
const OB_DAYS = [5, 12, 19, 26];
const OB_URL = 'https://www.orthobanc.com/providers/reports.aspx';
/* the reports around today: { date (the 5th, 12th…), due (the office day it's handled) } — the latest one due, and the next */
function obCycle(today) {
  const [y, m] = today.split('-').map(Number), all = [];
  for (let k = -1; k <= 1; k++) {
    let yy = y, mm = m + k; if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; }
    OB_DAYS.forEach(d => { const date = yy + '-' + String(mm).padStart(2, '0') + '-' + String(d).padStart(2, '0'); all.push({ date, due: nextOfficeDay(date) }); });
  }
  const past = all.filter(c => c.due <= today);
  return { cur: past[past.length - 1] || null, prev: past[past.length - 2] || null, next: all.find(c => c.due > today) || null };
}
/* where the reminder stands: due (the report whose day has come, not checked yet), missed (the one before it, not checked either);
   imported: the report days whose file was imported — that counts as checked too */
function obState(book, today, imported) {
  const C = obCycle(today), checks = (book && book.ob) || [], imp = imported || [], done = c => !!c && (checks.some(x => x.for === c.date) || imp.includes(c.date));
  return { cur: C.cur, next: C.next, due: C.cur && !done(C.cur) ? C.cur : null, missed: C.prev && !done(C.prev) && (checks.length || imp.length) ? C.prev : null, last: checks.length ? checks[checks.length - 1] : null };
}
function obCheck(d, o, now) {
  bookFix(d); o = o || {};
  if (!ISO_RE.test(o.for || '')) throw errCode('bad-date');
  const n = o.n === '' || o.n == null ? null : Number(o.n);
  if (n != null && !(Number.isInteger(n) && n >= 0 && n <= 500)) throw errCode('bad-n', 'How many failed payments: a whole number.');
  d.ob.push({ id: uid8(), at: now, by: o.by || '', for: o.for, n, note: String(o.note || '').trim().slice(0, 300) });
  if (d.ob.length > 60) d.ob = d.ob.slice(-60);
}

/* =====================================================================
   OrthoBanc's failed-payment report, imported (6 Oct 2026). Optional:
   the reminder and "Checked it" work as before. One sealed record per
   report day (the 5th, 12th, 19th, 26th), kept like an account's
   (arItems, key OB_KEY + the day) but not in the carrier book, so a tick
   doesn't copy the whole book into the history. Importing never changes
   an account — no note, follow-up or ladder step: the list is matched to
   accounts by name only to show the phone number and open the account.
   ===================================================================== */
const OB_KEY = '\u0001ob|';
/* the report day a file belongs to: the latest 5th, 12th, 19th or 26th on or before its date */
function obDayOf(iso) {
  if (!ISO_RE.test(iso || '')) return '';
  const [y, m, d] = iso.split('-').map(Number), on = OB_DAYS.filter(x => x <= d);
  if (on.length) return y + '-' + String(m).padStart(2, '0') + '-' + String(on[on.length - 1]).padStart(2, '0');
  return m === 1 ? (y - 1) + '-12-26' : y + '-' + String(m - 1).padStart(2, '0') + '-26';
}
function normOBRow(r) {
  r = r && typeof r === 'object' ? r : {};
  const n = v => (typeof v === 'number' && isFinite(v) ? round2(v) : null);
  return { ref: strOf(r.ref, 20).trim().toLowerCase(), acct: strOf(r.acct, 20).trim(), patient: strOf(r.patient, 80).trim(), rp: strOf(r.rp, 80).trim(), status: strOf(r.status, 20).trim(),
    amt: n(r.amt), bal: n(r.bal), reason: strOf(r.reason, 120).trim(), date: isoOrBlank(r.date), how: strOf(r.how, 30).trim(), hold: r.hold === true };
}
/* one failed draft: the plan, the day it was drafted and the amount (a re-import of the same report keeps its ticks) */
function obRowId(r) { return [r.ref || r.acct || normName(r.patient), r.date || '', r.amt == null ? '' : Number(r.amt).toFixed(2)].join('|'); }
function emptyOBRep(day) { return { obrep: 1, day, key: '', name: '', rp: '', src: 'pt', kind: 'pd', state: 'open', stage: '', log: [], asOf: '', rows: [], done: {}, file: '', at: 0, by: '', imports: [] }; }
function obFix(d, day) {
  if (!Array.isArray(d.rows)) d.rows = []; if (!d.done || typeof d.done !== 'object') d.done = {}; if (!Array.isArray(d.imports)) d.imports = [];
  Object.assign(d, { obrep: 1, key: '', state: 'open' }); if (day) d.day = day; return d;
}
/* save a read report into its day's record: its failed payments replace the ones there; ticks on the ones still on it stay */
function obImport(d, p, o, now) {
  o = o || {}; obFix(d, o.day);
  if (!ISO_RE.test(d.day || '')) throw errCode('bad-date');
  const rows = ((p && p.rows) || []).slice(0, 500).map(normOBRow).filter(r => r.patient || r.ref), ids = new Set(rows.map(obRowId)), done = {};
  Object.keys(d.done).forEach(k => { if (ids.has(k)) done[k] = d.done[k]; });
  Object.assign(d, { asOf: isoOrBlank(p && p.asOf), rows, done, file: strOf(p && p.name, 120), at: now, by: o.by || '' });
  d.imports = d.imports.concat([{ at: now, by: o.by || '', n: rows.length }]).slice(-10);
}
/* tick (or untick) families as texted — day 0, handbook §14 */
function obTick(d, ids, on, o, now) {
  obFix(d); const have = new Set(d.rows.map(obRowId));
  (ids || []).forEach(id => { if (!have.has(id)) return; if (on) d.done[id] = { at: now, by: (o && o.by) || '' }; else delete d.done[id]; });
}
function normOBRep(b) {
  if (!b || typeof b !== 'object' || !b.obrep || b.locked || !ISO_RE.test(b.day || '')) return null;
  const rows = (Array.isArray(b.rows) ? b.rows.slice(0, 500) : []).map(normOBRow), ids = new Set(rows.map(obRowId)), done = {};
  if (b.done && typeof b.done === 'object') Object.keys(b.done).forEach(k => { const v = b.done[k]; if (ids.has(k) && v && typeof v === 'object') done[k] = { at: numOr0(v.at), by: strOf(v.by, 60) }; });
  return { id: strOf(b.id, 40), rev: numOr0(b.rev), v: numOr0(b.v), day: b.day, asOf: isoOrBlank(b.asOf), rows, done, file: strOf(b.file, 120), at: numOr0(b.at), by: strOf(b.by, 60),
    imports: (Array.isArray(b.imports) ? b.imports.slice(-10) : []).map(x => ({ at: numOr0(x && x.at), by: strOf(x && x.by, 60), n: numOr0(x && x.n) })) };
}
/* how far along a report day's list is */
function obProgress(rep) {
  const rows = (rep && rep.rows) || [], left = rows.filter(r => !rep.done[obRowId(r)]);
  return { n: rows.length, left: left.length, holdLeft: left.filter(r => r.hold).length, hold: rows.filter(r => r.hold).length, amt: round2(rows.reduce((s, r) => s + (r.amt || 0), 0)) };
}
/* a person's name as words, however either system writes it: accents, titles (Mr., Mrs.), suffixes (Jr., III),
   apostrophes and hyphens don't count — "Mrs. Lucía Peña" and "Lucia Pena" are the same person */
const NAME_FOLD = { 'ł': 'l', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'ı': 'i', 'þ': 'th' };
function nameToks(s) {
  const t = String(s || '').replace(/^\s*ins\s*:\s*/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[łøæœßđıþ]/g, c => NAME_FOLD[c]).replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const w = t ? t.split(' ') : [];
  while (w.length > 1 && /^(mr|mrs|ms|miss|dr|mx)$/.test(w[0])) w.shift();
  while (w.length > 1 && /^(jr|sr|ii|iii|iv)$/.test(w[w.length - 1])) w.pop();
  return w;
}
/* 2: the same name; 1: the same first and last name (a middle name on one side only); 0: someone else */
function nameScore(a, b) {
  if (!a.length || !b.length) return 0;
  if (a.join('') === b.join('')) return 2;
  return a.length > 1 && b.length > 1 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1] ? 1 : 0;
}
/* the patient account on the A/R report a failed payment belongs to: the patient's name, and the responsible party's
   has to agree too (the same name, or at least the same last name) — a wrong phone number is worse than none,
   so it's no match rather than a guess */
function obMatch(accts, row) {
  const pts = (accts || []).filter(a => !a.ins), p = nameToks(row && row.patient), r = nameToks(row && row.rp), last = r[r.length - 1];
  if (!p.length) return null;
  const find = toks => {
    let best = 0, c = [];
    pts.forEach(a => { const s = nameScore(nameToks(a.patient), toks); if (!s) return; if (s > best) { best = s; c = [a]; } else if (s === best) c.push(a); });
    return c;
  };
  let c = find(p); if (!c.length && p.length === 2) c = find(p.slice().reverse()); // a name written without its comma, last name first
  if (r.length) c = c.filter(a => { const t = nameToks(rpName(a)); return nameScore(t, r) > 0 || t[t.length - 1] === last; });
  if (c.length > 1) { const pd = c.filter(a => a.pd > 0); if (pd.length === 1) c = pd; }
  return c.length === 1 ? c[0] : null;
}
/* earlier report days the same plan failed on (its OB reference #, or Edge's account #), newest first */
function obEarlier(reps, day, row) {
  const ref = row.ref, acct = String(row.acct || '').replace(/\s+/g, '');
  return (reps || []).filter(r => r.day < day && r.rows.some(x => (ref && x.ref === ref) || (acct && String(x.acct || '').replace(/\s+/g, '') === acct))).map(r => r.day).sort().reverse();
}
