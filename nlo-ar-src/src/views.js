/* =====================================================================
   The screens: Today, Past due, Insurance, Credits, Summary, Reports.
   ===================================================================== */

/* ---------- shared: filters, sorting, one table for every list ---------- */
function applyFilters(list) {
  const f = S.f, me = meSid();
  return list.filter(a => {
    if (!matchesQ(a)) return false;
    if (f.src && a.src !== f.src) return false;
    if (f.work) { const w = workState(a.key); if (f.work === 'open' ? w === 'done' : w !== f.work) return false; }
    if (f.who) { const it = itemFor(a.key); const who = it && it.state === 'open' ? it.assignee : ''; if (f.who === '_me' ? who !== me : f.who === '_none' ? !!who : who !== f.who) return false; }
    return true;
  });
}
function sortBy(list, def) {
  const k = S.sort.k || def.k, dir = S.sort.k ? S.sort.dir : def.dir;
  const val = a => k === 'name' ? String(a.patient).toLowerCase() : k === 'follow' ? ((itemFor(a.key) || {}).follow || '9999') : k === 'recv' ? (a.recv || '') : (a[k] == null ? -Infinity : a[k]);
  return list.slice().sort((x, y) => { const p = val(x), q = val(y); return (p < q ? -1 : p > q ? 1 : 0) * dir || y.pd - x.pd || y.credit - x.credit; });
}
function filtersHTML(opt) {
  opt = opt || {}; const f = S.f, sel = (k, cur) => k === cur ? ' selected' : '';
  const ppl = arPeople();
  return '<div class="filters">' +
    (opt.src === false ? '' : '<select data-f="src" aria-label="Who pays"><option value="">Patients &amp; insurance</option><option value="pt"' + sel('pt', f.src) + '>Patient accounts</option><option value="ins"' + sel('ins', f.src) + '>Insurance accounts</option></select>') +
    '<select data-f="work" aria-label="Work"><option value="">Any work status</option>' + [['new', 'Not started'], ['open', 'Not resolved'], ['working', 'Being worked'], ['due', 'Follow-up due'], ['done', 'Resolved']].map(([k, l]) => '<option value="' + k + '"' + sel(k, f.work) + '>' + l + '</option>').join('') + '</select>' +
    (ppl.length > 1 ? '<select data-f="who" aria-label="Assigned to"><option value="">Anyone</option><option value="_me"' + sel('_me', f.who) + '>Assigned to me</option><option value="_none"' + sel('_none', f.who) + '>Unassigned</option>' + ppl.map(r => '<option value="' + esc(r.sid) + '"' + sel(r.sid, f.who) + '>' + esc(staffName(r.sid)) + '</option>').join('') + '</select>' : '') +
    ((f.src || f.work || f.who) ? '<button class="btn btn-ghost" data-act="clearF">Clear filters</button>' : '') +
    '<span style="flex:1"></span><button class="btn btn-ghost" data-act="csv">' + ic('download', 15) + 'Download list</button></div>';
}
/* cols: [{ k (sort key), l (label), num, cls, td(a, i) }] */
function tableHTML(cols, list, def, opt) {
  opt = opt || {};
  if (!list.length) return '<div class="card"><div class="empty">' + (opt.empty || 'Nothing here.') + '</div></div>';
  const k = S.sort.k || def.k, dir = S.sort.k ? S.sort.dir : def.dir;
  const th = c => '<th class="' + (c.num ? 'num ' : '') + (c.cls || '') + '">' + (c.k ? '<button data-act="sort" data-k="' + c.k + '"' + (c.num ? '' : ' data-d="asc"') + '>' + c.l + (k === c.k ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</button>' : c.l) + '</th>';
  S.lastList = list; S.lastCols = cols;
  return '<div class="card tblWrap"><table class="tbl lst"><thead><tr>' + cols.map(th).join('') + '</tr></thead><tbody>' +
    list.map((a, i) => { const w = workState(a.key); return '<tr class="click' + (w === 'done' ? ' done' : w === 'due' ? ' over' : '') + (opt.cut && opt.cut === i ? ' cut70' : '') + '" data-act="open" data-key="' + esc(a.key) + '" tabindex="0">' + cols.map(c => '<td class="' + (c.num ? 'num ' : '') + (c.cls || '') + '">' + c.td(a, i) + '</td>').join('') + '</tr>'; }).join('') +
    '</tbody></table></div><div class="small muted" style="margin-top:8px">' + plural(list.length, 'account') + (opt.foot ? ' · ' + opt.foot : '') + '</div>';
}
const C = {
  rank: { l: '#', cls: 'rank', td: (a, i) => String(i + 1) },
  name: { k: 'name', l: 'Patient', td: a => '<div class="pt">' + esc(a.patient) + '</div><div class="ptSub">' + stsBadge(a) + (a.ins ? '<span class="badge s-ins" title="Insurance contract">Ins</span>' : '') + '<span class="small muted">' + esc(rpName(a)) + '</span></div>' },
  b0: { k: 'b0', l: '0–30', num: true, td: a => a.b0 ? money(a.b0, true) : '<span class="muted">—</span>' },
  b30: { k: 'b30', l: '31–60', num: true, td: a => a.b30 ? money(a.b30, true) : '<span class="muted">—</span>' },
  b60: { k: 'b60', l: '61–90', num: true, td: a => a.b60 ? money(a.b60, true) : '<span class="muted">—</span>' },
  b90: { k: 'b90', l: '91+', num: true, td: a => '<span class="big">' + money(a.b90, true) + '</span>' },
  pd: { k: 'pd', l: 'Past due', num: true, td: a => money(a.pd, true) },
  bal: { k: 'bal', l: '<span title="Contract balance">Balance</span>', num: true, cls: 'hideM', td: a => a.bal == null ? '—' : money(a.bal, true) },
  // insurance with nothing paid: the triage step says what to do (as on the Insurance page and in the downloaded list)
  sug: { l: 'Suggested', cls: 'hideM', td: a => a.months ? tierChip(a) : sugChip(pdAction(a, S.cfg), true) },
  days: { k: 'days', l: 'Days', num: true, cls: 'hideM', td: a => a.days == null ? '—' : esc(String(a.days)) },
  work: { k: 'follow', l: 'Work', td: a => workCell(a.key) }
};
/* the same column, left out on a phone (the account panel has it) */
const M = c => Object.assign({}, c, { cls: ((c.cls || '') + ' hideM').trim() });

/* ---------- Today ---------- */
/* reports are saved but the newest isn't open yet (or can't be opened with this key) */
function notOpenHTML() {
  if (!S.reports.length || S.rep) return '';
  if (S.reports.some(r => !r.locked)) return '<div class="empty">Opening the latest report…</div>';
  return '<div class="card"><div class="empty">The saved reports can’t be opened with this A/R key yet. ' + (isOwner() ? 'Sign in again; if it stays, make a new A/R key in Settings.' : 'Ask Dr. A to open A/R once, then sign in again.') + '</div></div>';
}
function noReportHTML() {
  return '<div class="card" style="max-width:760px"><div class="cardHd"><h3>Import the first report</h3></div><div class="cardBd">' +
    '<p class="small" style="margin-bottom:10px">A/R works from Edge’s <b>Accounts Receivable Aging</b> report. Run it, export it to Excel and drop the file in — it’s read on this computer and saved sealed. Every list here (91+, insurance that hasn’t paid, credit balances) comes from it.</p>' +
    edgeStepsHTML(true) + '<div class="btnRow"><button class="btn btn-teal" data-act="nav" data-v="reports">' + ic('import', 16) + 'Import a report</button></div></div></div>';
}
function staleHTML() {
  const m = curRepMeta(); if (!S.rep || !m) return '';
  const age = daysBetween(S.rep.asOf, todayISO());
  if (age < S.cfg.staleDays) return '';
  return '<div class="staleBox">' + ic('clock', 18) + '<span>The newest report is from ' + esc(fmtDateLong(S.rep.asOf)) + ' — ' + age + ' days ago. Balances have moved since; import this week’s.</span><button class="btn btn-sec btn-sm" data-act="nav" data-v="reports">' + ic('import', 15) + 'Import report</button></div>';
}
function viewToday() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (S.firstLoad && !S.demo) return '<div class="empty">Opening the latest report…</div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  const c = counts(), A = S.accts.filter(matchesQ), t = todayISO();
  const s91 = round2(S.accts.filter(a => a.bucket === '91').reduce((s, a) => s + a.b90, 0)), crw = S.accts.filter(a => a.credit > 0 && !a.prepay);
  const tile = (n, l, cls, act, sub) => '<button class="tile ' + cls + '" ' + act + '><span class="n' + (String(n).length > 6 ? ' sm' : '') + '">' + n + '</span><span class="l">' + l + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</button>';
  let h = staleHTML() + '<div class="tiles">' +
    tile(c.due, 'Follow-ups due', c.late ? 'red' : 'amber', 'data-act="tileDue"', c.late ? c.late + ' late' : 'today') +
    tile(money(s91), '91+ days past due', 'red', 'data-act="nav" data-v="pd" data-tab="91"', plural(c.n91, 'account')) +
    tile(c.chase, 'Insurance: chase now', 'coral', 'data-act="nav" data-v="ins" data-tab="chase"', 'nothing paid, ' + (S.cfg.tiers[0] + 1) + '–' + S.cfg.tiers[1] + ' days') +
    tile(money(crw.reduce((s, a) => s + a.credit, 0)), 'Credits to resolve', 'blue', 'data-act="nav" data-v="cr" data-tab="work"', plural(crw.length, 'account')) +
    (c.drA ? tile(c.drA, isOwner() ? 'Waiting for your OK' : 'Waiting for Dr. A', 'amber', 'data-act="tileDrA"', 'refunds & write-offs') : '') +
    (c.cleared ? tile(c.cleared, 'Cleared in Edge', 'mint', 'data-act="tileCleared"', 'close these') : '') + '</div>';
  // left: what to do now
  const due = dueItems().filter(it => { const a = S.byKey.get(it.key); return !S.q || (a ? matchesQ(a) : String(it.name || '').toLowerCase().includes(S.q.toLowerCase())); }).sort((x, y) => x.follow < y.follow ? -1 : x.follow > y.follow ? 1 : 0);
  const fresh = list91(A).filter(a => workState(a.key) === 'new').slice(0, 10);
  const left = '<div class="card"><div class="cardHd"><h3>Follow-ups due</h3><span class="sub">' + (due.length ? plural(due.length, 'account') : 'Late and today') + '</span></div><div class="cardBd">' +
    (due.length ? due.map(it => itemRow(it)).join('') : '<div class="empty">' + (S.q ? 'Nothing matches.' : 'No follow-ups due. Start on the 91+ list below.') + '</div>') + '</div></div>' +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Top of the 91+ list</h3><span class="sub">Biggest first, not started yet</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="nav" data-v="pd" data-tab="91">All 91+ ' + ic('next', 14) + '</button></div><div class="cardBd">' +
    (fresh.length ? fresh.map(a => acctRow(a, (isBack(itemFor(a.key)) ? 'On the list again · ' : '') + pdAction(a, S.cfg).l, '<span class="big">' + money(a.b90) + '</span>')).join('') : '<div class="empty">Every 91+ account has been started. ✓</div>') + '</div></div>';
  // right: Dr. A's queue, what changed, cleared
  let right = '';
  const drA = openItems().filter(it => it.drA);
  if (drA.length) right += '<div class="card" style="margin-bottom:18px"><div class="cardHd"><h3>' + (isOwner() ? 'Waiting for your OK' : 'Waiting for Dr. A') + '</h3><span class="sub">Refunds and write-offs</span></div><div class="cardBd">' + drA.map(it => itemRow(it, lastLogText(it))).join('') + '</div></div>';
  right += changesCardHTML();
  const cl = openItems().filter(isCleared);
  if (cl.length) right += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Cleared in Edge</h3><span class="sub">Not past due / in credit any more</span><span style="flex:1"></span><button class="btn btn-sec btn-sm" data-act="closeCleared">' + ic('done', 15) + 'Close all ' + cl.length + '</button></div><div class="cardBd">' +
    cl.map(it => itemRow(it, 'Not in the ' + fmtDate(S.rep.asOf) + ' report — paid or fixed in Edge', true)).join('') + '</div></div>';
  right += lastReportCardHTML();
  return h + '<div class="twoCol"><div>' + left + '</div><div>' + right + '</div></div>';
}
function lastLogText(it) { const e = lastLog(it); return e ? logLabel(e) + (e.note ? ': ' + e.note : '') + ' · ' + firstName(staffName(e.by, e.by)) : ''; }
function acctRow(a, meta, right) {
  const it = itemFor(a.key);
  return '<button class="row" data-act="open" data-key="' + esc(a.key) + '">' + avatarHTML(it && it.assignee) +
    '<span class="grow"><span class="pt">' + esc(a.patient) + '<span class="par"> · ' + (a.ins ? 'Ins: ' : '') + esc(rpName(a)) + '</span></span><span class="meta">' + esc(meta || '') + '</span></span>' + (right || '') + '</button>';
}
function itemRow(it, meta, noFollow) {
  const a = S.byKey.get(it.key);
  return '<button class="row" data-act="open" data-key="' + esc(it.key) + '">' + avatarHTML(it.assignee) +
    '<span class="grow"><span class="pt">' + esc(it.name || (a && a.patient) || '') + '<span class="par"> · ' + esc(a ? (a.ins ? 'Ins: ' : '') + rpName(a) : String(it.rp || '').replace(/^\s*ins\s*:\s*/i, 'Ins: ')) + '</span></span>' +
    '<span class="meta">' + esc(meta != null ? meta : lastLogText(it) || STAGES[it.stage || '']) + '</span></span>' +
    (a ? '<span class="small big">' + money(a.credit > 0 && !(a.pd > 0) ? a.credit : a.pd) + '</span>' : '') + (noFollow ? '' : followChip(it.follow)) + '</button>';
}
function changesCardHTML() {
  const d = S.diff;
  if (!S.prev || !d) return '<div class="card"><div class="cardHd"><h3>Since the last report</h3></div><div class="cardBd small muted">Import another report next week and this shows what moved: new 91+ accounts, ones that were paid, new credits.</div></div>';
  const pick = keys => keys.map(k => S.byKey.get(k)).filter(Boolean);
  const prevBy = new Map(reportAccts(S.prev, S.cfg).map(a => [a.key, a]));
  const line = (n, label, amt, keys, cls) => n ? '<details class="help"><summary><b class="' + (cls || '') + '">' + n + '</b> ' + esc(Array.isArray(label) ? label[n === 1 ? 0 : 1] : label) + (amt != null ? ' · ' + money(amt) : '') + '</summary>' +
    keys.slice(0, 25).map(k => { const a = S.byKey.get(k) || prevBy.get(k); return a ? acctRow(a, a.sts + ' · ' + (a.ins ? 'insurance' : 'patient')) : ''; }).join('') + (keys.length > 25 ? '<div class="small muted">…and ' + (keys.length - 25) + ' more</div>' : '') + '</details>' : '';
  const n91 = pick(d.new91), cleared = d.cleared.map(k => prevBy.get(k)).filter(Boolean), nc = pick(d.newCredit);
  const body = line(n91.length, 'newly 91+ days past due', n91.reduce((s, a) => s + a.b90, 0), d.new91, 'bad') +
    line(d.newNever.length, ['insurance account newly with nothing paid', 'insurance accounts newly with nothing paid'], null, d.newNever) +
    line(d.worse.length, ['insurance account moved up a step (older, still unpaid)', 'insurance accounts moved up a step (older, still unpaid)'], null, d.worse, 'bad') +
    line(cleared.length, 'paid or no longer past due', cleared.reduce((s, a) => s + a.pd, 0), d.cleared, 'ok') +
    line(nc.length, ['new credit balance', 'new credit balances'], nc.reduce((s, a) => s + a.credit, 0), d.newCredit) +
    line(d.goneCredit.length, ['credit balance resolved', 'credit balances resolved'], null, d.goneCredit, 'ok');
  return '<div class="card"><div class="cardHd"><h3>Since the last report</h3><span class="sub">' + esc(fmtDate(S.prev.asOf)) + ' → ' + esc(fmtDate(S.rep.asOf)) + '</span></div><div class="cardBd small">' + (body || '<div class="muted">No changes between the two reports.</div>') + '</div></div>';
}
function lastReportCardHTML() {
  const m = curRepMeta(); if (!m || !S.rep) return '';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Latest report</h3></div><div class="cardBd small">' +
    '<div class="kvRow"><span>Edge A/R Aging as of</span><b>' + esc(fmtDateLong(S.rep.asOf)) + '</b></div>' +
    '<div class="kvRow"><span>Imported</span><b>' + esc(fmtWhen(m.at)) + ' · ' + esc(firstName(staffName(m.sid, m.sid))) + '</b></div>' +
    '<div class="kvRow"><span>Covers</span>' + coverHTML(S.rep.cover) + '</div>' +
    '<div class="kvRow"><span>Accounts past due or in credit</span><b>' + S.rep.rows.length + '</b></div></div></div>';
}
function coverHTML(c) {
  return '<span class="cov">' + [['pastDue', 'Past due'], ['credit', 'Credits'], ['ins', 'Insurance'], ['full', 'Whole book']].map(([k, l]) => '<span class="' + (c && c[k] ? '' : 'no') + '">' + l + '</span>').join('') + '</span>';
}
Object.assign(ACT, {
  tileDue() { S.view = 'pd'; S.tab.pd = 'all'; S.f = { src: '', work: 'due', who: '' }; renderNav(); renderView(); },
  tileDrA() { const it = openItems().find(x => x.drA); if (it) openDrawer(it.key); },
  tileCleared() { const el = $('[data-act=closeCleared]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  async closeCleared() {
    const cl = openItems().filter(isCleared); if (!cl.length) return;
    if (!(await confirmBox('Close ' + plural(cl.length, 'account') + '?', 'They’re not past due or in credit in the ' + fmtDateLong(S.rep.asOf) + ' report any more, so they were paid or fixed in Edge. Each is marked “Cleared in Edge”; their notes stay.', 'Close them'))) return;
    let n = 0;
    for (const it of cl) { if (await change(it.key, d => resolveItem(d, 'cleared', { by: meSid(), note: 'Not in the ' + fmtDate(S.rep.asOf) + ' report' }, Date.now()), { a: 'resolve', outcome: 'cleared' })) n++; }
    toast('Closed ' + plural(n, 'account'));
  }
});

/* ---------- Past due ---------- */
function tabsHTML(list) { return '<div class="chips" role="tablist">' + list.map(([k, l, n, amt]) => '<button class="chip' + (S.tab[S.view] === k ? ' on' : '') + '" role="tab" aria-selected="' + (S.tab[S.view] === k) + '" data-act="tab" data-t="' + k + '">' + esc(l) + '<span class="c">' + n + (amt != null ? ' · ' + money(amt) : '') + '</span></button>').join('') + '</div>'; }
function viewPastDue() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  if (S.rep && !S.rep.cover.pastDue) return staleHTML() + '<div class="card"><div class="empty">The latest report doesn’t have past-due accounts in it (it was run for credit balances only).</div></div>';
  const A = S.accts, l91 = withCum(list91(A)), l31 = list31(A), l0 = list0(A), all = A.filter(a => a.pd > 0);
  const amt = (l, f) => l.reduce((s, a) => s + f(a), 0), tab = S.tab.pd;
  let h = staleHTML() + tabsHTML([['91', '91+ days', l91.length, amt(l91, a => a.b90)], ['31', '31–90 days', l31.length, amt(l31, a => a.pd)], ['0', '0–30 days', l0.length, amt(l0, a => a.pd)], ['all', 'All past due', all.length, amt(all, a => a.pd)]]);
  if (tab === '91') {
    const s = summarize(S.rep, S.cfg).conc;
    h += '<div class="listHd">' + ic('info', 16) + '<span><b>' + plural(s.n, 'account') + ', ' + money(s.total) + '.</b> ' + (s.n > 25 ? 'The top 25 carry ' + pct(s.top25, s.total) + '% of it — w' : 'W') + 'ork down the list and stop where the return stops justifying the call. Under ' + money(S.cfg.writeOff) + ' is a write-off candidate.</span></div>';
    const list = applyFilters(l91), sorted = sortBy(list, { k: 'b90', dir: -1 });
    const cut = !S.sort.k && !S.f.src && !S.f.work && !S.f.who && !S.q ? l91.findIndex(a => a.cum >= 0.7) : -1;
    return h + filtersHTML() + tableHTML([C.rank, C.name, C.b90, { l: '<span title="Running share of the 91+ money, down the list">Share</span>', cls: 'hideM', td: a => '<span class="cum' + (a.cum > 0.7 ? ' past70' : '') + '"><i><b style="width:' + Math.round(a.cum * 100) + '%"></b></i>' + Math.round(a.cum * 100) + '%</span>' }, M(C.pd), C.bal, C.days, C.sug, C.work], sorted, { k: 'b90', dir: -1 },
      { empty: l91.length ? 'No 91+ accounts match.' : 'No accounts are 91+ days past due. ✓', cut: cut >= 0 ? cut : null, foot: cut >= 0 ? 'the dashed line marks 70% of the 91+ money' : '' });
  }
  if (tab === '31') {
    h += '<div class="listHd">' + ic('info', 16) + '<span><b>Catch these before they age.</b> 31–90 days past due with nothing at 91+ yet — this is where next month’s 91+ comes from.</span></div>';
    return h + filtersHTML() + tableHTML([C.name, M(C.b30), M(C.b60), C.pd, C.bal, C.days, C.sug, C.work], sortBy(applyFilters(l31), { k: 'pd', dir: -1 }), { k: 'pd', dir: -1 }, { empty: 'No accounts are 31–90 days past due.' });
  }
  if (tab === '0') {
    h += '<div class="listHd">' + ic('info', 16) + '<span><b>Up to 30 days late.</b> Usually a payment in process — Edge’s note says so when it is. A courtesy reminder is enough.</span></div>';
    return h + filtersHTML() + tableHTML([C.name, C.b0, C.bal, C.days, { l: 'Edge note', cls: 'hideM', td: a => '<span class="small muted">' + esc(a.note || '') + '</span>' }, C.sug, C.work], sortBy(applyFilters(l0), { k: 'pd', dir: -1 }), { k: 'pd', dir: -1 }, { empty: 'No accounts are 0–30 days past due.' });
  }
  return h + filtersHTML() + tableHTML([C.name, M(C.b0), M(C.b30), M(C.b60), M(C.b90), C.pd, C.days, C.work], sortBy(applyFilters(all), { k: 'pd', dir: -1 }), { k: 'pd', dir: -1 }, { empty: 'Nothing past due.' });
}

/* ---------- Insurance ---------- */
function viewIns() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  if (S.rep && !S.rep.cover.ins) return staleHTML() + '<div class="card"><div class="empty">The latest report was run with “Exclude Insurance Contracts” ticked, so it has no insurance accounts. Run it again with that box unticked.</div></div>';
  const A = S.accts, nev = listNever(A), partly = A.filter(a => a.ins && a.pd > 0 && !a.months).sort((x, y) => y.pd - x.pd);
  const sm = summarize(S.rep, S.cfg).never, by = t => nev.filter(a => a.tier === t);
  const tiers = S.cfg.tiers;
  let h = staleHTML() + '<div class="ruleBox"><b>Insurance accounts where nothing has been paid.</b> When an insurance account’s past due is an exact multiple of ' + money(S.cfg.inst, true) + ' (the monthly instalment), the carrier has paid nothing at all: N × ' + money(S.cfg.inst, true) + ' = N untouched months. The aging report hides this, because it only ages the instalment.' +
    '<div class="rb2"><div><div class="n">' + sm.n + '</div><div class="l">accounts</div></div><div><div class="n">' + money(sm.pd) + '</div><div class="l">past due</div></div><div><div class="n">' + money(sm.contract) + '</div><div class="l">contract balance behind them' + (sm.pctBook != null ? ' (' + Math.round(sm.pctBook * 100) + '% of the insurance book)' : '') + '</div></div></div></div>';
  h += tabsHTML([['chase', '2 · Chase now', by('chase').length], ['investigate', '3 · Investigate', by('investigate').length], ['nofile', '4 · Never filed?', by('nofile').length], ['monitor', '1 · Monitor', by('monitor').length], ['all', 'All nothing paid', nev.length], ['partly', 'Partly paid, past due', partly.length]]);
  const tab = S.tab.ins;
  const why = { chase: 'Past due ' + (tiers[0] + 1) + '–' + tiers[1] + ' days with nothing paid: call the carrier now.', investigate: tiers[1] + 1 + '–' + tiers[2] + ' days with nothing paid: the claim is likely stuck or denied — investigate it.', nofile: 'Over ' + tiers[2] + ' days with nothing paid: the claim was probably never filed. Verify, then file it or write it off.', monitor: 'Up to ' + tiers[0] + ' days: the claim is likely still in flight.', all: 'Every insurance account where nothing has been paid, most urgent first.', partly: 'Insurance accounts past due where the carrier has paid something.' };
  h += '<div class="listHd">' + ic('info', 16) + '<span>' + esc(why[tab]) + '</span></div>';
  if (tab === 'partly') return h + filtersHTML({ src: false }) + tableHTML([C.name, M(C.b30), M(C.b60), M(C.b90), C.pd, C.bal, C.days, C.sug, C.work], sortBy(applyFilters(partly), { k: 'pd', dir: -1 }), { k: 'pd', dir: -1 }, { empty: 'None.' });
  const list = tab === 'all' ? nev : by(tab);
  return h + filtersHTML({ src: false }) + tableHTML([C.name, { k: 'months', l: 'Months unpaid', num: true, td: a => '<span class="big">' + a.months + '</span>' }, C.pd, { k: 'bal', l: 'Contract balance', num: true, cls: 'hideM', td: a => a.bal == null ? '—' : money(a.bal, true) }, C.days, { l: 'Triage', cls: 'hideM', td: a => tierChip(a) }, C.work],
    sortBy(applyFilters(list), tab === 'all' ? { k: 'days', dir: -1 } : { k: 'bal', dir: -1 }), tab === 'all' ? { k: 'days', dir: -1 } : { k: 'bal', dir: -1 }, { empty: 'None at this step.' });
}

/* ---------- Credits ---------- */
function viewCredits() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  if (S.rep && !S.rep.cover.credit) return staleHTML() + '<div class="card"><div class="empty">The latest report doesn’t have credit balances in it (it was run for past due only).</div></div>';
  const all = listCredits(S.accts), work = all.filter(a => !a.prepay), pre = all.filter(a => a.prepay), amt = l => l.reduce((s, a) => s + a.credit, 0), tab = S.tab.cr;
  let h = staleHTML() + tabsHTML([['work', 'To resolve', work.length, amt(work)], ['pre', 'Prepayments', pre.length, amt(pre)], ['all', 'All credits', all.length, amt(all)]]);
  h += '<div class="listHd">' + ic('info', 16) + '<span>' + (tab === 'pre' ? '<b>Paid before starting treatment.</b> Unearned, correctly parked — no action; listed for completeness.' : '<b>Oldest and most urgent first:</b> 3+ years, then inactive patients, then over a year. Before a refund, go through the checklist on the account (FC instructions): it’s often owed to the family’s own balance or a sibling instead.') + '</span></div>';
  const list = tab === 'pre' ? pre : tab === 'all' ? all : work;
  return h + filtersHTML() + tableHTML([C.name, { k: 'credit', l: 'Credit', num: true, td: a => '<span class="big">' + money(a.credit, true) + '</span>' },
    { k: 'recv', l: 'Last payment', cls: 'hideM', td: a => a.recv ? esc(fmtDate(a.recv)) + (a.lastAmt ? '<div class="small muted">' + money(a.lastAmt, true) + '</div>' : '') : '—' },
    { k: 'age', l: 'Age', num: true, td: a => a.age == null ? '—' : '<span title="' + a.age + ' days">' + esc(a.ageBucket) + '</span>' },
    { l: 'Suggested', cls: 'hideM', td: a => sugChip(crAction(a), true) }, C.work], S.sort.k ? sortBy(applyFilters(list), { k: 'credit', dir: -1 }) : applyFilters(list), { k: '', dir: 1 }, { empty: tab === 'pre' ? 'No prepayments.' : 'No credit balances to resolve. ✓' });
}

/* ---------- download the list on screen ---------- */
ACT.csv = async () => {
  const list = S.lastList || [];
  if (!list.length) return;
  if (!(await confirmBox('Download this list?', 'The file has patients’ names, phone numbers and balances. Keep it on an office computer and delete it when you’re done.', 'Download'))) return;
  const head = ['Patient', 'Responsible party', 'Edge status', 'Pays', 'Home phone', 'Work phone', '0-30', '31-60', '61-90', '91+', 'Past due', 'Contract balance', 'Credit', 'Days', 'Last payment', 'Suggested', 'Follow-up', 'Last note'];
  const rows = list.map(a => { const it = itemFor(a.key), e = it && lastLog(it), sug = a.credit > 0 && !(a.pd > 0) ? crAction(a).l : a.months ? TIERS[a.tier].l : pdAction(a, S.cfg).l;
    return [a.patient, a.rp, a.sts, a.ins ? 'Insurance' : 'Patient', a.home, a.work].map(csvCell).concat([a.b0, a.b30, a.b60, a.b90, a.pd, a.bal == null ? '' : a.bal, a.credit, a.days == null ? '' : a.days].map(n => String(n))).concat([a.recv, sug, it ? it.follow || '' : '', e ? logLabel(e) + (e.note ? ': ' + e.note : '') : ''].map(csvCell)).join(','); });
  const blob = new Blob(['﻿' + head.map(csvCell).join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nlo-ar-' + (TITLES[S.view] || 'list').toLowerCase().replace(/\W+/g, '-') + '-' + S.tab[S.view] + '-' + todayISO() + '.csv'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

/* ---------- Summary ---------- */
function viewSummary() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  const s = summarize(S.rep, S.cfg), b = s.book;
  const tile = (n, l, cls, sub) => '<div class="tile static ' + (cls || '') + '"><span class="n sm">' + n + '</span><span class="l">' + l + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</div>';
  let h = '<div class="filters noPrint"><span class="small muted">Edge A/R Aging as of <b>' + esc(fmtDateLong(s.asOf)) + '</b></span> ' + coverHTML(s.cover) + '<span style="flex:1"></span><button class="btn btn-ghost" data-act="print">' + ic('print', 15) + 'Print</button></div>';
  h += '<div class="tiles">' + (b ? tile(money(b.bal), 'Total contract balance', '', plural(b.n, 'account')) : '') +
    tile(money(s.pd.total), 'Past due', 'red', b ? pct(s.pd.total, b.bal) + '% of the balance' : plural(s.pd.n, 'account')) +
    tile(money(s.netDue), 'Net due now', 'amber', 'past due less credits') +
    tile(money(s.pd.b90), '91+ days', 'red', pct(s.pd.b90, s.pd.total) + '% of past due') +
    tile(money(s.cr.total), 'Credit balances', 'blue', plural(s.cr.n, 'account')) + '</div>';
  const max = Math.max(1, s.pd.b0, s.pd.b30, s.pd.b60, s.pd.b90);
  const hb = (l, v, mx, cls, val) => '<div class="hb"><span class="hl" title="' + esc(l) + '">' + esc(l) + '</span><span class="ht"><i class="' + (cls || '') + '" style="width:' + Math.max(1, Math.round(v / mx * 100)) + '%"></i></span><span class="hv">' + (val || money(v)) + '</span></div>';
  const aging = '<div class="card"><div class="cardHd"><h3>Aging buckets</h3><span class="sub">Past due ' + money(s.pd.total) + '</span></div><div class="cardBd"><div class="hbars">' +
    hb('0–30 days', s.pd.b0, max, 'b0') + hb('31–60 days', s.pd.b30, max, 'b30') + hb('61–90 days', s.pd.b60, max, 'b60') + hb('91+ days', s.pd.b90, max, 'b90') + '</div></div></div>';
  const insShareBal = b && b.bal ? pct(b.ins.bal, b.bal) : null, insShare91 = pct(s.pd.ins.b90, s.pd.b90);
  const pvi = '<div class="card"><div class="cardHd"><h3>Patient vs insurance</h3></div><div class="cardBd"><table class="tbl"><thead><tr><th></th>' + (b ? '<th class="num">Accounts</th><th class="num">Balance</th>' : '') + '<th class="num">Past due</th><th class="num">91+</th></tr></thead><tbody>' +
    [['Patient', b && b.pt, s.pd.pt], ['Insurance', b && b.ins, s.pd.ins]].map(([l, bk, p]) => '<tr><td><b>' + l + '</b></td>' + (b ? '<td class="num">' + bk.n + '</td><td class="num">' + money(bk.bal) + '</td>' : '') + '<td class="num">' + money(p.total) + '</td><td class="num">' + money(p.b90) + '</td></tr>').join('') + '</tbody></table>' +
    (insShareBal != null && s.pd.b90 ? '<div class="insight">Insurance is ' + insShareBal + '% of the balance but ' + insShare91 + '% of the 91+ bucket.</div>' : '') + '</div></div>';
  const cc = s.conc;
  const conc = '<div class="card"><div class="cardHd"><h3>91+ concentration</h3><span class="sub">' + plural(cc.n, 'account') + ' hold it all</span></div><div class="cardBd"><div class="hbars">' +
    [['Top 10', cc.top10], ['Top 25', cc.top25], ['Top 50', cc.top50]].map(([l, v]) => hb(l, v, cc.total || 1, '', money(v) + ' · ' + pct(v, cc.total) + '%')).join('') + '</div>' +
    (cc.reach70 ? '<div class="insight">' + plural(cc.reach70, 'phone call') + ' reach 70% of the aged money.</div>' : '') + '</div></div>';
  const bs = '<div class="card"><div class="cardHd"><h3>Past due by treatment status</h3></div><div class="cardBd"><table class="tbl"><thead><tr><th>Edge status</th><th class="num">Accounts</th><th class="num">Past due</th></tr></thead><tbody>' +
    s.byStatus.map(x => '<tr><td>' + esc(x.sts) + '</td><td class="num">' + x.n + '</td><td class="num">' + money(x.pd) + '</td></tr>').join('') + '</tbody></table></div></div>';
  const nv = s.never;
  const nev = '<div class="card"><div class="cardHd"><h3>Insurance: nothing paid</h3><span class="sub">Past due = N × ' + money(S.cfg.inst, true) + '</span></div><div class="cardBd"><table class="tbl"><thead><tr><th>Step</th><th class="num">Accounts</th><th class="num">Past due</th><th class="num">Contract</th></tr></thead><tbody>' +
    ['chase', 'investigate', 'nofile', 'monitor'].map(t => '<tr><td>' + TIERS[t].n + ' · ' + esc(TIERS[t].s) + '</td><td class="num">' + nv.tiers[t].n + '</td><td class="num">' + money(nv.tiers[t].pd) + '</td><td class="num">' + money(nv.tiers[t].contract) + '</td></tr>').join('') +
    '<tr><td><b>Total</b></td><td class="num"><b>' + nv.n + '</b></td><td class="num"><b>' + money(nv.pd) + '</b></td><td class="num"><b>' + money(nv.contract) + '</b></td></tr></tbody></table>' +
    (nv.pctBook != null ? '<div class="insight">' + money(nv.contract) + ' of contract balance — ' + Math.round(nv.pctBook * 100) + '% of the whole insurance book — sits behind accounts where nothing has been paid.</div>' : '') + '</div></div>';
  const cr = s.cr, cmax = Math.max(1, ...cr.byAge.map(x => x.amt));
  const crd = '<div class="card"><div class="cardHd"><h3>Credit balances</h3><span class="sub">' + money(cr.total) + ' · ' + plural(cr.n, 'account') + '</span></div><div class="cardBd">' +
    '<div class="subH" style="margin-top:0">By age of last payment</div><div class="hbars">' + cr.byAge.map(x => hb(x.k + ' (' + x.n + ')', x.amt, cmax, '')).join('') + '</div>' +
    '<div class="subH">By source</div><div class="kvRow"><span>Insurance</span><b>' + money(cr.ins.total) + ' · ' + cr.ins.n + '</b></div><div class="kvRow"><span>Patient</span><b>' + money(cr.pt.total) + ' · ' + cr.pt.n + '</b></div>' +
    '<div class="kvRow"><span>Of which prepayments (no action)</span><b>' + money(cr.prepay.total) + ' · ' + cr.prepay.n + '</b></div>' +
    '<div class="subH">By status</div>' + cr.byStatus.map(x => '<div class="kvRow"><span>' + esc(x.sts) + '</span><b>' + money(x.amt) + ' · ' + x.n + '</b></div>').join('') + '</div></div>';
  h += '<div class="sumGrid"><div>' + aging + '<div style="height:18px"></div>' + conc + '<div style="height:18px"></div>' + nev + '</div><div>' + pvi + '<div style="height:18px"></div>' + bs + '<div style="height:18px"></div>' + crd + '</div></div>';
  h += '<div class="sumGrid" style="margin-top:18px"><div>' + trendHTML() + '</div><div>' + monthEndHTML(s) + '</div></div>';
  return h;
}
ACT.print = () => window.print();
/* past due, 91+ and credits to resolve, report by report (from each report's sealed totals) */
function trendHTML() {
  const pts = S.reports.filter(r => r.sum && r.sum.cover && r.sum.cover.pastDue).slice().sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : (a.at || 0) - (b.at || 0)));
  const byDay = new Map(); pts.forEach(r => byDay.set(r.asOf, r)); const P = Array.from(byDay.values()).slice(-26);
  const head = '<div class="card trend"><div class="cardHd"><h3>Over time</h3><span class="sub"><span class="lg" style="background:var(--navy-500)"></span>Past due <span class="lg b90"></span>91+ <span class="lg" style="background:var(--blue-500)"></span>Credits to resolve</span></div><div class="cardBd">';
  if (P.length < 2) return head + '<div class="small muted">Shows up once there are two reports (import one each week).</div></div></div>';
  const W = 560, H = 190, L = 54, R = 10, T = 10, Bm = 24, max = Math.max(...P.map(r => Math.max(r.sum.pd || 0, r.sum.crWork || 0))) || 1;
  const x = i => L + (W - L - R) * (P.length === 1 ? 0 : i / (P.length - 1)), y = v => T + (H - T - Bm) * (1 - v / max);
  const line = (f, color) => '<path class="tl" stroke="' + color + '" d="' + P.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(f(r) || 0).toFixed(1)).join(' ') + '"/>';
  const ticks = [0, 0.5, 1].map(f => '<text x="' + (L - 6) + '" y="' + (y(max * f) + 4) + '" text-anchor="end">' + money(max * f) + '</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '" stroke="var(--grey-100)"/>').join('');
  const lbl = P.map((r, i) => (i === 0 || i === P.length - 1 || P.length <= 8) ? '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === P.length - 1 ? 'end' : 'middle') + '">' + esc(fmtDate(r.asOf)) + '</text>' : '').join('');
  return head + '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Past due, 91+ and credits over the last ' + P.length + ' reports">' + ticks + line(r => r.sum.pd, 'var(--navy-500)') + line(r => r.sum.b90, 'var(--coral-700)') + line(r => r.sum.crWork, 'var(--blue-500)') + lbl + '</svg></div></div>';
}
/* the numbers Month-End asks for in its "Accounts" section (totals only) */
function monthEndHTML(s) {
  const me = s.monthEnd;
  const head = '<div class="card"><div class="cardHd"><h3>For Month-End Numbers</h3><span class="sub">Accounts section</span></div><div class="cardBd">';
  if (!me) return head + '<div class="small muted">Needs a full report (Subgroup: None, insurance contracts included) — then this lists the insurance and patient A/R, 30+ days past due and credits for Month-End.</div></div></div>';
  const row = (l, amt, n) => '<span>' + l + '</span><b>' + money(amt, true) + '</b><span class="r">' + (n != null ? n + ' acct' + (n === 1 ? '' : 's') : '') + '</span>';
  const txt = ['Insurance accounts: ' + money(me.ins_ar, true) + ' (' + me.ins_ar_n + ')', 'Insurance 30+ past due: ' + money(me.ins_pd, true) + ' (' + me.ins_pd_n + ')', 'Patient accounts: ' + money(me.pt_ar, true) + ' (' + me.pt_ar_n + ')', 'Patient 30+ past due: ' + money(me.pt_pd, true) + ' (' + me.pt_pd_n + ')', 'Total A/R: ' + money(me.ar_total, true), 'Patient credits: ' + money(me.cred_pt, true), 'Insurance credits: ' + money(me.cred_ins, true)].join('\n');
  return head + '<div class="meGrid"><span class="h"></span><span class="h" style="text-align:right">Dollars</span><span class="h" style="text-align:right">Accounts</span>' +
    row('Insurance accounts', me.ins_ar, me.ins_ar_n) + row('Insurance 30+ days past due', me.ins_pd, me.ins_pd_n) + row('Patient accounts', me.pt_ar, me.pt_ar_n) + row('Patient 30+ days past due', me.pt_pd, me.pt_pd_n) +
    row('Total A/R', me.ar_total) + row('Patient credits', me.cred_pt) + row('Insurance credits', me.cred_ins) + '</div>' +
    '<p class="small muted" style="margin-top:10px">As of ' + esc(fmtDateLong(s.asOf)) + '. For month-end, import the report run on the last day of the month. 30+ days = the 31–60, 61–90 and 91+ columns.</p>' +
    '<div class="btnRow noPrint"><button class="btn btn-sec btn-sm" data-act="copyVal" data-v="' + esc(txt) + '">' + ic('copy', 15) + 'Copy the numbers</button><a class="btn btn-ghost" href="month-end.html" target="_blank" rel="noopener">Open Month-End ' + ic('next', 14) + '</a></div></div></div>';
}

/* ---------- Reports: import from Edge, and the ones saved ---------- */
function edgeStepsHTML(open) {
  return '<details class="help"' + (open ? ' open' : '') + '><summary>How to export it from Edge</summary><ol class="steps small">' +
    '<li>In Edge: <b>Home</b> → <b>Reporting</b> → <b>Financial</b> → double-click <b>Accounts Receivable Aging</b>.</li>' +
    '<li>Leave the date on <b>Today</b> (for month-end, the last day of the month). Tick <b>Exclude Zero Dollar Balances</b>. Leave <b>Exclude Insurance Contracts unticked</b> — the insurance lists need those accounts. <b>Subgroup: None</b> (every account).</li>' +
    '<li>Press <b>View</b> and wait for it to finish (a few minutes for the whole office).</li>' +
    '<li><b>Export ▾</b> → <b>Excel</b>, and save it (Downloads is fine).</li>' +
    '<li>Drop the file here. It’s read on this computer — only the sealed report is saved. Then delete the file from Downloads.</li></ol>' +
    '<p class="small muted">Ran “Past Due” and “Credit Balance” as two subgroups instead? Drop both files in together.</p></details>';
}
function viewReports() {
  const imp = S.imp;
  let h = '<div class="adminGrid"><div><div class="card"><div class="cardHd"><h3>Import a report</h3><span class="sub">Edge → Accounts Receivable Aging → Export → Excel</span></div><div class="cardBd">';
  if (imp && imp.files && imp.files.length) h += importPreviewHTML(imp);
  else h += '<div class="dropZone" id="dropZone" tabindex="0" role="button" aria-label="Choose the Edge report file">' + ic('import', 26) + '<b>Drop the Excel file here</b><span class="small">or click to choose it · .xls, .xlsx or .csv · one or more files</span></div>' +
    '<input type="file" id="arFile" accept=".xls,.xlsx,.csv,.txt,.htm,.html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" multiple class="hidden">' +
    '<div class="pasteBox" id="pasteBox" tabindex="0" role="textbox" aria-label="Paste the report here">Or open the export in Excel, select everything (Ctrl+A), copy (Ctrl+C), click here and paste (Ctrl+V).</div>' +
    (imp && imp.err ? '<div class="lockErr" style="margin-top:12px">' + esc(imp.err) + '</div>' : '') + edgeStepsHTML(!S.reports.length);
  h += '</div></div></div><div>' + reportListHTML() + '</div></div>';
  return h;
}
function reportListHTML() {
  if (!S.reports.length) return '<div class="card"><div class="cardHd"><h3>Saved reports</h3></div><div class="cardBd small muted">None yet.</div></div>';
  const me = B.uid || (B.me && B.me.uid);
  return '<div class="card"><div class="cardHd"><h3>Saved reports</h3><span class="sub">The newest is what the lists show</span></div><div class="cardBd">' + S.reports.map((r, i) => {
    const s = r.sum || {}, canDel = isOwner() || (r.by === me && Date.now() - (r.at || 0) < 86400000);
    return '<div class="fileRow"><span class="fi">' + ic('file', 18) + '</span><span class="fb"><b>' + esc(fmtDateLong(r.asOf)) + '</b>' + (i === 0 ? ' <span class="badge t-ok">Showing</span>' : '') +
      '<div class="small muted">' + (r.locked ? 'Can’t be opened with this key' : 'Past due ' + money(s.pd) + ' · 91+ ' + money(s.b90) + ' · credits ' + money(s.cr)) + '</div>' +
      '<div class="small muted">Imported ' + esc(fmtWhen(r.at)) + ' by ' + esc(firstName(staffName(r.sid, r.sid))) + ' · ' + plural(r.n || 0, 'account') + '</div>' + (s.cover ? '<div style="margin-top:4px">' + coverHTML(s.cover) + '</div>' : '') + '</span>' +
      (canDel ? '<button class="btn btn-ghost" data-act="delReport" data-id="' + esc(r.id) + '" style="color:var(--coral-700)" title="Delete this report">' + ic('trash', 15) + '</button>' : '') + '</div>';
  }).join('') + '</div></div>';
}
function importPreviewHTML(imp) {
  let h = '<div class="flabel">Files</div>' + imp.files.map((f, i) => '<div class="fileRow"><span class="fi">' + ic('file', 18) + '</span><span class="fb"><b>' + esc(f.name) + '</b>' +
    (f.err ? '<div class="small bad">' + esc(f.err) + '</div>' : '<div class="small muted">' + esc([f.p.meta.title || 'A/R report', f.p.meta.asOf ? 'as of ' + fmtDateLong(f.p.meta.asOf) : 'no date in the file', f.p.meta.subgroup ? 'Subgroup: ' + f.p.meta.subgroup : 'Subgroup: None', plural(f.p.rows.length, 'account')].join(' · ')) + '</div>' +
      (f.p.meta.options ? '<div class="small muted">' + esc(f.p.meta.options) + '</div>' : '') +
      '<div class="chk ' + (f.p.check.ok ? 'ok' : f.p.check.ok === false ? 'bad' : 'unk') + '">' + ic(f.p.check.ok ? 'done' : 'info', 14) + esc(f.p.check.why) + '</div>') + '</span>' +
    '<button class="btn btn-ghost" data-act="impDrop" data-i="' + i + '" title="Remove this file">' + ic('x', 15) + '</button></div>').join('');
  const good = imp.files.filter(f => !f.err);
  if (!good.length) return h + '<div class="btnRow"><button class="btn btn-sec btn-sm" data-act="impReset">Start over</button></div>';
  const rep = imp.rep, s = summarize(rep, S.cfg), A = reportAccts(rep, S.cfg);
  h += '<div class="flabel" style="margin-top:14px">As of ' + esc(fmtDateLong(rep.asOf)) + '</div><div class="prevGrid">' +
    '<div><div class="n">' + money(s.pd.total) + '</div><div class="l">past due · ' + plural(s.pd.n, 'account') + '</div></div>' +
    '<div><div class="n">' + money(s.pd.b90) + '</div><div class="l">91+ days · ' + plural(s.conc.n, 'account') + '</div></div>' +
    '<div><div class="n">' + s.never.n + '</div><div class="l">insurance, nothing paid</div></div>' +
    '<div><div class="n">' + money(s.cr.work.total) + '</div><div class="l">credits to resolve · ' + s.cr.work.n + '</div></div>' + '</div>' +
    '<div class="small" style="margin-bottom:6px">Covers ' + coverHTML(rep.cover) + '</div>';
  const same = S.reports.filter(r => r.asOf === rep.asOf).length, newer = S.reports.find(r => r.asOf > rep.asOf);
  const notes = rep.warn.slice();
  if (same) notes.push('There’s already a report for ' + fmtDateLong(rep.asOf) + '. Saving this one replaces it on the lists (the older one stays under Saved reports).');
  if (newer) notes.push('A newer report (' + fmtDateLong(newer.asOf) + ') is already saved, so the lists keep showing that one. This one is kept for the trend.');
  if (good.some(f => f.p.check.ok === false)) notes.push('One file doesn’t add up to Edge’s own totals — check it was exported whole before saving.');
  if (S.rep && !newer) {
    const d = diffReports(rep, S.rep, S.cfg);
    if (S.rep.asOf < rep.asOf) notes.push('Since ' + fmtDate(S.rep.asOf) + ': ' + d.new91.length + ' newly 91+, ' + d.cleared.length + ' paid or no longer past due, ' + d.newCredit.length + ' new credits.');
  }
  h += notes.map(n => '<div class="notice' + (/doesn’t add up|different days|left out/.test(n) ? ' bad' : ' info') + '" style="margin-top:8px">' + esc(n) + '</div>').join('');
  h += '<details class="help"><summary>Check a few rows</summary><div class="tblWrap"><table class="tbl histTbl"><thead><tr><th>Patient</th><th>Status</th><th class="num">Past due</th><th class="num">91+</th><th class="num">Balance</th></tr></thead><tbody>' +
    A.slice(0, 6).map(a => '<tr><td>' + esc(a.patient) + '<div class="small muted">' + esc(a.rp) + '</div></td><td>' + esc(a.sts) + '</td><td class="num">' + money(a.pd, true) + '</td><td class="num">' + money(a.b90, true) + '</td><td class="num">' + (a.bal == null ? '—' : money(a.bal, true)) + '</td></tr>').join('') + '</tbody></table></div></details>';
  h += '<div class="btnRow" style="margin-top:14px"><button class="btn btn-teal" data-act="impSave" id="impSave"' + (imp.busy ? ' disabled' : '') + '>' + ic('lock', 15) + 'Save report (sealed)</button><button class="btn btn-sec btn-sm" data-act="impMore">Add another file</button><button class="btn btn-ghost" data-act="impReset">Cancel</button></div>' +
    '<input type="file" id="arFile" accept=".xls,.xlsx,.csv,.txt,.htm,.html" multiple class="hidden">' +
    '<p class="small muted" style="margin-top:8px">Only accounts past due or in credit are kept, plus the book’s totals. Nothing leaves this computer until it’s sealed.</p>';
  return h;
}
/* wire the drop zone, the file chooser and the paste box after each render */
function afterReports() {
  const dz = $('#dropZone'), fi = $('#arFile'), pb = $('#pasteBox');
  if (fi) fi.onchange = e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) addFiles(fs); };
  if (dz) {
    dz.onclick = () => fi && fi.click();
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (fs.length) addFiles(fs); };
  }
  if (pb) pb.addEventListener('paste', e => {
    e.preventDefault(); const cd = e.clipboardData; if (!cd) return;
    const html = cd.getData('text/html'), text = cd.getData('text/plain');
    try { const p = edgeFromGrid(html && /<table/i.test(html) ? readHTMLTables(html) : readGridText(text || ''), 'Pasted from Excel'); addParsed([{ name: 'Pasted from Excel', p }]); }
    catch (x) { S.imp = { files: [], err: errText(x) }; renderView(); }
  });
  paintPhotos();
}
async function addFiles(files) {
  const out = [];
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) { out.push({ name: f.name, err: 'That file is too big to be an A/R report.' }); continue; }
    try { out.push({ name: f.name, p: await readEdgeAR(f.name, await f.arrayBuffer()) }); }
    catch (x) { out.push({ name: f.name, err: errText(x) }); }
  }
  addParsed(out);
}
function addParsed(list) {
  const files = ((S.imp && S.imp.files) || []).concat(list);
  const good = files.filter(f => !f.err);
  S.imp = { files, rep: good.length ? buildReport(good.map(f => f.p)) : null, busy: false };
  renderView();
}
Object.assign(ACT, {
  impReset() { S.imp = null; renderView(); },
  impMore() { const fi = $('#arFile'); if (fi) fi.click(); },
  impDrop(t) { const files = S.imp.files.filter((f, i) => i !== Number(t.dataset.i)); S.imp = null; if (files.length) addParsed(files); else renderView(); },
  async impSave() {
    const imp = S.imp; if (!imp || !imp.rep || imp.busy) return;
    imp.busy = true; const btn = $('#impSave'); busyBtn(btn, true, 'Sealing and saving…');
    try {
      const rep = Object.assign({}, imp.rep, { made: Date.now() }); delete rep.warn;
      await B.saveReport(rep, reportTotals(rep, S.cfg));
      S.imp = null; toast('Report saved — the lists now show ' + fmtDateLong(rep.asOf)); S.view = 'today'; renderNav(); renderView();
    } catch (x) { imp.busy = false; busyBtn(btn, false); toast(errText(x), { bad: true }); }
  },
  async delReport(t) {
    const r = S.reports.find(x => x.id === t.dataset.id); if (!r) return;
    if (!(await confirmBox('Delete the ' + fmtDateLong(r.asOf) + ' report?', 'The lists go back to the report before it. Notes and follow-ups on accounts are kept.', 'Delete', true))) return;
    act(() => B.deleteReport(r.id), 'Report deleted');
  }
});
