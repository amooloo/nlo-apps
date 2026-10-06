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
   past due from its first day past due (1, the handbook's wording) or from 31 days (the 30+ the Month-End numbers use);
   dueDay: the weekly report is due every Monday (1) … Thursday (4) — the handbook says weekly and names no day */
const AR_DEFAULTS = { inst: 11.11, writeOff: 100, tiers: [60, 120, 365], dueDay: 1, goalPt: 4, goalIns: 4, kpiFrom: 1 };
const DUE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'];
function arCfg(settings) {
  const a = (settings && settings.ar) || {};
  const num = (v, d) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : d), pctOf = (v, d) => (typeof v === 'number' && isFinite(v) && v > 0 && v <= 100 ? v : d);
  const tiers = Array.isArray(a.tiers) && a.tiers.length === 3 && a.tiers.every((n, i) => Number.isInteger(n) && n > 0 && (!i || n > a.tiers[i - 1])) ? a.tiers.slice() : AR_DEFAULTS.tiers.slice();
  return { inst: num(a.inst, AR_DEFAULTS.inst), writeOff: num(a.writeOff, AR_DEFAULTS.writeOff), tiers, dueDay: [1, 2, 3, 4].includes(a.dueDay) ? a.dueDay : AR_DEFAULTS.dueDay,
    goalPt: pctOf(a.goalPt, AR_DEFAULTS.goalPt), goalIns: pctOf(a.goalIns, AR_DEFAULTS.goalIns), kpiFrom: a.kpiFrom === 31 ? 31 : 1 };
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
function reportTotals(rep, cfg) {
  const s = summarize(rep, cfg), k1 = kpis(rep, Object.assign({}, cfg, { kpiFrom: 1 })), k30 = kpis(rep, Object.assign({}, cfg, { kpiFrom: 31 }));
  return { asOf: s.asOf, cover: s.cover, pd: s.pd.total, b90: s.pd.b90, b31: round2(s.pd.b30 + s.pd.b60), n91: s.conc.n, never: s.never.n, neverPd: s.never.pd, cr: s.cr.total, crWork: s.cr.work.total, crN: s.cr.work.n, bal: s.book ? s.book.bal : null,
    kp: k1 ? { ptOf: k1.pt.of, ptPd: k1.pt.n, ptPd30: k30.pt.n, insOf: k1.ins ? k1.ins.of : null, insLate: k1.ins ? k1.ins.n : null, win: k1.win } : null };
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
  return { asOf: isoOrBlank(s.asOf), cover: normCover(s.cover), pd: numOr0(s.pd), b90: numOr0(s.b90), b31: numOr0(s.b31), n91: i(s.n91), never: i(s.never), neverPd: numOr0(s.neverPd), cr: numOr0(s.cr), crWork: numOr0(s.crWork), crN: i(s.crN), bal: numOrNull(s.bal), kp };
}
const LOG_KINDS = new Set(Object.keys(LOGS).concat(['done', 'reopen', 'drA_ask', 'drA_ok', 'drA_no', 'ladder', 'aa_broken', 'mhold_on', 'mhold_off']));
function normLog(e) {
  e = e && typeof e === 'object' ? e : {};
  const o = { id: strOf(e.id, 40), at: numOr0(e.at), by: strOf(e.by, 60), k: LOG_KINDS.has(e.k) ? e.k : 'note', note: strOf(e.note, 2000) };
  if (o.k === 'done') o.outcome = own(OUTCOMES, e.outcome) ? e.outcome : 'other';
  if (own(LAD_BY, e.step)) o.step = e.step;
  if (o.k === 'reopen' && e.fresh === true) o.fresh = true;
  if (isoOrBlank(e.date)) o.date = e.date;
  if (numOrNull(e.amt) != null) o.amt = e.amt;
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
