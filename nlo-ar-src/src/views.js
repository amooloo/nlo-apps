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
    if (f.car && S.view === 'ins') { const c = carrierFor(a.key); if (f.car === '_none' ? !!c : !c || c.id !== f.car) return false; }
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
    (S.view === 'ins' && S.book && S.book.carriers.length ? '<select data-f="car" aria-label="Carrier"><option value="">Every carrier</option>' + S.book.carriers.map(c => '<option value="' + esc(c.id) + '"' + sel(c.id, f.car) + '>' + esc(c.name) + '</option>').join('') + '<option value="_none"' + sel('_none', f.car) + '>No carrier set</option></select>' : '') +
    (ppl.length > 1 ? '<select data-f="who" aria-label="Assigned to"><option value="">Anyone</option><option value="_me"' + sel('_me', f.who) + '>Assigned to me</option><option value="_none"' + sel('_none', f.who) + '>Unassigned</option>' + ppl.map(r => '<option value="' + esc(r.sid) + '"' + sel(r.sid, f.who) + '>' + esc(staffName(r.sid)) + '</option>').join('') + '</select>' : '') +
    ((f.src || f.work || f.who || f.car) ? '<button class="btn btn-ghost" data-act="clearF">Clear filters</button>' : '') +
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
  name: { k: 'name', l: 'Patient', td: a => { const L = ladFor(a); return '<div class="pt">' + esc(a.patient) + '</div><div class="ptSub">' + stsBadge(a) + (a.ins ? '<span class="badge s-ins" title="Insurance contract">Ins</span>' : '') + (L && L.hold ? '<span class="badge s-hold" title="Maintenance Hold — comfort visits only, no active tooth movement">Maint. Hold</span>' : '') + '<span class="small muted">' + esc(rpName(a)) + '</span></div>'; } },
  b0: { k: 'b0', l: '0–30', num: true, td: a => a.b0 ? money(a.b0, true) : '<span class="muted">—</span>' },
  b30: { k: 'b30', l: '31–60', num: true, td: a => a.b30 ? money(a.b30, true) : '<span class="muted">—</span>' },
  b60: { k: 'b60', l: '61–90', num: true, td: a => a.b60 ? money(a.b60, true) : '<span class="muted">—</span>' },
  b90: { k: 'b90', l: '91+', num: true, td: a => '<span class="big">' + money(a.b90, true) + '</span>' },
  pd: { k: 'pd', l: 'Past due', num: true, td: a => money(a.pd, true) },
  bal: { k: 'bal', l: '<span title="Contract balance">Balance</span>', num: true, cls: 'hideM', td: a => a.bal == null ? '—' : money(a.bal, true) },
  // insurance with nothing paid: the triage step says what to do (as on the Insurance page and in the downloaded list); patient accounts: the collections ladder
  sug: { l: 'Suggested', cls: 'hideM', td: a => a.months ? tierChip(a) : ladSug(a) || sugChip(pdAction(a, S.cfg), true) },
  days: { k: 'days', l: 'Days', num: true, cls: 'hideM', td: a => a.days == null ? '—' : esc(String(a.days)) },
  work: { k: 'follow', l: 'Work', td: a => workCell(a.key) },
  car: { l: 'Carrier', cls: 'hideM', td: a => { const c = carrierFor(a.key); return c ? '<span class="small">' + esc(c.name) + '</span>' : '<span class="small muted">—</span>'; } },
  // the ladder's list
  lday: { k: 'ladDay', l: '<span title="Days past due today (Edge’s Days, plus the days since the report)">Day</span>', num: true, td: a => '<span class="big">' + a.ladDay + '</span>' },
  lstep: { k: 'ladN', l: 'Step due', td: a => ladStepCell(a) }
};
/* the same column, left out on a phone (the account panel has it) */
const M = c => Object.assign({}, c, { cls: ((c.cls || '') + ' hideM').trim() });

/* ---------- the goals (AISA handbook §19): patient and insurance delinquency, no more than 4% each ---------- */
function goalBox(k, label, what) {
  if (!k) return '';
  const r = k.rate || 0, g = k.goal, max = Math.max(g * 2.5, r * 1.15, 0.01), tone = k.ok ? 'ok' : r <= g * 1.5 ? 'near' : 'far';
  const pc = x => (x * 100).toFixed(x * 100 < 10 ? 1 : 0).replace(/\.0$/, '') + '%';
  return '<div class="goal ' + tone + '"><div class="gTop"><span class="gL">' + esc(label) + '</span><span class="gG">goal ≤ ' + pc(g) + '</span></div>' +
    '<div class="gMid"><span class="gV">' + (k.of ? pc(r) : '—') + '</span><span class="gBar" aria-hidden="true"><i style="width:' + Math.min(100, r / max * 100).toFixed(1) + '%"></i><b style="left:' + (g / max * 100).toFixed(1) + '%"></b></span>' +
    '<span class="gS">' + esc(k.ok ? 'Goal met' : k.of ? k.need + ' to go' : '') + '</span></div>' +
    '<div class="gD">' + esc(k.n + ' of ' + k.of + ' ' + what + (k.ok || !k.of ? '' : ' — ' + plural(k.need, 'account') + ' to bring current to reach ' + pc(g))) + '</div></div>';
}
/* both goals, from the newest full report */
function goalsHTML(inCard) {
  if (!S.rep) return '';
  const k = kpis(S.rep, S.cfg);
  if (!k) return inCard ? '<div class="small muted">The goals are measured from a full report: Subgroup None, insurance contracts included.</div>' : '';
  return '<div class="goals' + (inCard ? ' inCard' : '') + '">' +
    goalBox(k.pt, 'Patient accounts past due', 'active patient accounts ' + (k.from > 1 ? '30+ days past due' : 'past due')) +
    (k.ins ? goalBox(k.ins, 'Insurance past its payment window', 'insurance accounts more than ' + k.win + ' days past due') : '') + '</div>';
}
/* Summary: the goals, report by report, and how they're counted */
function goalsCardHTML() {
  const k = S.rep ? kpis(S.rep, S.cfg) : null;
  const how = k ? '<div class="gHow small"><div class="gHowT">How they’re counted</div><ul>' +
    '<li>Accounts, not dollars — from each week’s full report.</li>' +
    '<li><b>Patient:</b> accounts ' + (k.from > 1 ? '30 or more days past due' : 'with anything past due') + ' ÷ patient accounts on the report that aren’t Inactive in Edge.</li>' +
    '<li><b>Insurance:</b> accounts more than ' + k.win + ' days past due (the “monitor up to” days) ÷ insurance accounts with a balance.</li>' +
    '<li>Dr. A sets the goals in Settings.</li></ul></div>' : '';
  return '<div class="card goalsCard" style="margin-bottom:18px"><div class="cardHd"><h3>Goals</h3><span class="sub">Practice KPIs · handbook §19 · as of ' + esc(fmtDate(S.rep.asOf)) + '</span></div><div class="cardBd">' + goalsHTML(true) +
    (k ? '<div class="gLow">' + goalTrendHTML() + how + '</div>' : '<div style="margin-top:12px">' + goalTrendHTML() + '</div>') + '</div></div>';
}
/* the two rates, report by report, with the goals as dashed lines */
function goalTrendHTML() {
  const from30 = S.cfg.kpiFrom > 1;
  const pts = S.reports.filter(r => r.sum && r.sum.kp && r.sum.kp.ptOf).slice().sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : (a.at || 0) - (b.at || 0)));
  const byDay = new Map(); pts.forEach(r => byDay.set(r.asOf, r)); const P = Array.from(byDay.values()).slice(-26);
  if (P.length < 2) return '<div class="small muted">The week-by-week line shows up once there are two full reports.</div>';
  const pr = r => (from30 ? r.sum.kp.ptPd30 : r.sum.kp.ptPd) / r.sum.kp.ptOf, ir = r => (r.sum.kp.insOf ? r.sum.kp.insLate / r.sum.kp.insOf : null);
  const gp = S.cfg.goalPt / 100, gi = S.cfg.goalIns / 100;
  /* the top of the chart: a round number, with room for the goal line in the middle */
  const top = Math.max(gp * 2, gi * 2, ...P.map(r => Math.max(pr(r), ir(r) || 0))) * 1.08 || 0.1;
  const step = top <= 0.1 ? 0.02 : top <= 0.2 ? 0.05 : top <= 0.5 ? 0.1 : 0.25, max = Math.min(1, Math.ceil(top / step - 1e-9) * step);
  const narrow = innerWidth < 640, W = narrow ? 360 : 560, H = narrow ? 170 : 190, L = 40, R = 10, T = 10, Bm = 24;
  const x = i => L + (W - L - R) * (i / (P.length - 1)), y = v => T + (H - T - Bm) * (1 - v / max);
  const pc = v => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
  const line = (f, color) => { const d = P.map((r, i) => [i, f(r)]).filter(([, v]) => v != null).map(([i, v], j) => (j ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' '); return d ? '<path class="tl" stroke="' + color + '" d="' + d + '"/>' : ''; };
  const goals = gi === gp ? [gp] : [gp, gi];
  const goal = g => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" stroke="var(--mint-700)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
    '<text class="gt" x="' + (L - 6) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + pc(g) + '</text>';
  /* 0 and the top as grid lines; a label only where a goal's label isn't sitting */
  const clear = v => goals.every(g => Math.abs(y(g) - y(v)) > 13);
  const ticks = [0, max].map(v => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--grey-100)"/>' +
    (clear(v) ? '<text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + pc(v) + '</text>' : '')).join('');
  const lbl = P.map((r, i) => (i === 0 || i === P.length - 1 || P.length <= (narrow ? 5 : 8)) ? '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === P.length - 1 ? 'end' : 'middle') + '">' + esc(fmtDate(r.asOf)) + '</text>' : '').join('');
  return '<div class="trend gTrend"><div class="small" style="margin-bottom:4px"><span class="lg" style="background:var(--navy)"></span>Patient <span class="lg" style="background:var(--blue-500)"></span>Insurance <span class="lg dash"></span>Goal' + (goals.length > 1 ? 's' : '') + '</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Patient and insurance accounts past due, as a percent, over the last ' + P.length + ' reports, with the goals">' + ticks + goals.map(goal).join('') +
    line(pr, 'var(--navy)') + line(ir, 'var(--blue-500)') + lbl + '</svg></div>';
}

/* ---------- the collections ladder: shared bits ---------- */
const LAD_PAUSE = { plan: 'A payment plan (Alternative Arrangement) is in place', promise: 'They promised to pay by a day that hasn’t come yet', hold: 'The account is set to Paused', done: 'Resolved' };
/* the ladder's step as the suggestion; nothing due: what's next, or why it's paused */
function ladSug(a) {
  const L = ladFor(a); if (!L) return '';
  if (L.due) return ladChip(L.due);
  if (L.paused) return '<span class="sug" title="' + esc(LAD_PAUSE[L.paused] || '') + '">' + ic('pause', 12) + 'Paused</span>';
  if (L.fin) return '<span class="small muted" title="The last letter went out; the 30 days end then">Ends ' + esc(fmtDate(L.endOn)) + '</span>';
  if (L.next) return '<span class="small muted" title="' + esc(L.next.l) + '">Next: ' + esc(L.next.s) + ' · ' + esc(fmtDate(L.nextOn)) + '</span>';
  return '';
}
/* where a letter Dr. A signs stands */
function ladSignText(L, s) { return !s.dra || s.id === 'end' || s.id === 'endaa' ? '' : L.signed[s.id] ? 'Signed — send it' : L.asked === s.id ? 'Waiting for Dr. A to sign' : 'Dr. A signs'; }
function ladStepCell(a) {
  const L = ladFor(a); if (!L) return ''; if (!L.due) return ladSug(a);
  const s = L.due, sg = ladSignText(L, s);
  return ladChip(s) + '<div class="small muted ladSub">' + esc(s.l) + (sg ? ' · <b class="' + (L.signed[s.id] ? 'ok' : '') + '">' + esc(sg) + '</b>' : '') + '</div>';
}
/* the ladder's step due (patient accounts), else the worksheet's suggestion */
function ladOrSug(a) { const L = ladFor(a); return L && L.due ? L.due.s + ' due — ' + L.due.l : pdAction(a, S.cfg).l; }
function ladMeta(s) {
  if (s.id === 'end' || s.id === 'endaa') return '30 days after the last letter';
  if (s.id === 'aa') return 'Arrangement broken · Dr. A signs · certified';
  return 'Day ' + s.day + (s.dra ? ' · Dr. A signs' : '') + (s.send ? ' · ' + s.send.toLowerCase() : s.text ? ' · ' + s.text : '');
}
/* how many of each step are due, in ladder order */
function ladGroups(list) { const by = new Map(); list.forEach(a => { const id = ladFor(a).due.id; by.set(id, (by.get(id) || 0) + 1); }); return LAD_ALL.filter(s => by.has(s.id)).map(s => [s, by.get(s.id)]); }
function ladTodayHTML() {
  const LD = ladDueAccts().filter(matchesQ), G = ladGroups(LD);
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Collection steps due</h3><span class="sub">' + (LD.length ? plural(LD.length, 'account') + ' · handbook §14' : 'Handbook §14') + '</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="nav" data-v="pd" data-tab="lad">The ladder ' + ic('next', 14) + '</button></div><div class="cardBd">' +
    (G.length ? G.map(([s, n]) => '<button class="row ladRow" data-act="nav" data-v="pd" data-tab="lad" data-step="' + esc(s.id) + '">' + ladChip(s) + '<span class="grow"><span class="pt">' + esc(s.l) + '</span><span class="meta">' + esc(ladMeta(s)) + '</span></span><span class="ladCnt">' + n + '</span></button>').join('')
      : '<div class="empty">' + (S.q ? 'Nothing matches.' : 'No collection letters, texts or calls due. ✓') + '</div>') + '</div></div>';
}

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
/* the weekly report: a banner from its due day until it's imported — amber on the day, red once it's late */
function newestWeekly() { let m = ''; S.reports.forEach(r => { if ((!r.sum || !r.sum.cover || r.sum.cover.pastDue) && r.asOf > m) m = r.asOf; }); return m || null; }
function dueNow() { return S.reports.length ? reportDue(newestWeekly(), todayISO(), S.cfg.dueDay) : null; }
function dayLong(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
function staleHTML(noBtn) {
  const d = dueNow(); if (!d || d.state === 'ok') return '';
  const age = d.newest ? daysBetween(d.newest, todayISO()) : 0;
  const msg = (d.state === 'today' ? 'This week’s A/R report is due today.' : 'This week’s A/R report is late — it was due ' + dayLong(d.due) + (d.days ? ' (' + plural(d.days, 'day') + ' ago)' : '') + '.') +
    (d.newest ? ' The newest is from ' + fmtDate(d.newest) + (age >= 14 ? ', ' + Math.floor(age / 7) + ' weeks ago' : '') + '.' : '');
  return '<div class="staleBox wk ' + d.state + '" role="status">' + ic('clock', 18) + '<span>' + esc(msg) + '</span>' + (noBtn ? '' : '<button class="btn btn-sec btn-sm" data-act="nav" data-v="reports">' + ic('import', 15) + 'Import report</button>') + '</div>';
}
/* Reports: when this week's is due, or that it's in and when the next one is */
function dueLineHTML() {
  const d = dueNow(); if (!d) return '';
  return d.state === 'ok' ? '<div class="dueOk">' + ic('done', 15) + '<span>This week’s report is in (' + esc(fmtDate(d.newest)) + '). The next one is due ' + esc(dayLong(d.due)) + '.</span></div>' : staleHTML(true);
}
function viewToday() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (S.firstLoad && !S.demo) return '<div class="empty">Opening the latest report…</div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  const c = counts(), A = S.accts.filter(matchesQ), t = todayISO();
  const s91 = round2(S.accts.filter(a => a.bucket === '91').reduce((s, a) => s + a.b90, 0)), crw = S.accts.filter(a => a.credit > 0 && !a.prepay);
  const tile = (n, l, cls, act, sub) => '<button class="tile ' + cls + '" ' + act + '><span class="n' + (String(n).length > 6 ? ' sm' : '') + '">' + n + '</span><span class="l">' + l + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</button>';
  const toSign = ladDueAccts().filter(a => { const l = ladFor(a); return l.due.dra && !l.signed[l.due.id]; }).length;
  if (S.focus && S.rep) return tourOfferHTML() + staleHTML() + auditBannerHTML() + focusViewHTML();
  let h = tourOfferHTML() + staleHTML() + obBannerHTML() + auditBannerHTML() + (S.rep ? focusStripHTML(focusData()) : '') + goalsHTML() + '<div class="tiles">' +
    tile(c.due, 'Follow-ups due', c.late ? 'red' : 'amber', 'data-act="tileDue"', c.late ? c.late + ' late' : 'today') +
    tile(c.lad, 'Collection steps due', 'coral', 'data-act="nav" data-v="pd" data-tab="lad"', toSign ? toSign + ' for Dr. A to sign' : 'letters, texts & calls') +
    tile(money(s91), '91+ days past due', 'red', 'data-act="nav" data-v="pd" data-tab="91"', plural(c.n91, 'account')) +
    tile(c.chase, 'Insurance: chase now', 'coral', 'data-act="nav" data-v="ins" data-tab="chase"', 'nothing paid, ' + (S.cfg.tiers[0] + 1) + '–' + S.cfg.tiers[1] + ' days') +
    tile(money(crw.reduce((s, a) => s + a.credit, 0)), 'Credits to resolve', 'blue', 'data-act="nav" data-v="cr" data-tab="work"', plural(crw.length, 'account')) +
    (c.drA ? tile(c.drA, isOwner() ? 'Waiting for your OK' : 'Waiting for Dr. A', 'amber', 'data-act="tileDrA"', 'refunds, write-offs, letters') : '') +
    (c.cleared ? tile(c.cleared, 'Cleared in Edge', 'mint', 'data-act="tileCleared"', 'close these') : '') + '</div>';
  // left: what to do now
  const due = dueItems().filter(it => { const a = S.byKey.get(it.key); return !S.q || (a ? matchesQ(a) : String(it.name || '').toLowerCase().includes(S.q.toLowerCase())); }).sort((x, y) => x.follow < y.follow ? -1 : x.follow > y.follow ? 1 : 0);
  const fresh = list91(A).filter(a => workState(a.key) === 'new').slice(0, 10);
  const left = '<div class="card"><div class="cardHd"><h3>Follow-ups due</h3><span class="sub">' + (due.length ? plural(due.length, 'account') : 'Late and today') + '</span></div><div class="cardBd">' +
    (due.length ? due.map(it => itemRow(it)).join('') : '<div class="empty">' + (S.q ? 'Nothing matches.' : 'No follow-ups due. Start on the collection steps below.') + '</div>') + '</div></div>' +
    ladTodayHTML() +
    '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Top of the 91+ list</h3><span class="sub">Biggest first, not started yet</span><span style="flex:1"></span><button class="btn btn-ghost" data-act="nav" data-v="pd" data-tab="91">All 91+ ' + ic('next', 14) + '</button></div><div class="cardBd">' +
    (fresh.length ? fresh.map(a => acctRow(a, (isBack(itemFor(a.key)) ? 'On the list again · ' : '') + ladOrSug(a), '<span class="big">' + money(a.b90) + '</span>')).join('') : '<div class="empty">Every 91+ account has been started. ✓</div>') + '</div></div>';
  // right: Dr. A's queue, what changed, cleared
  let right = '';
  const drA = openItems().filter(it => it.drA);
  if (drA.length) right += '<div class="card" style="margin-bottom:18px"><div class="cardHd"><h3>' + (isOwner() ? 'Waiting for your OK' : 'Waiting for Dr. A') + '</h3><span class="sub">Refunds, write-offs, letters to sign</span></div><div class="cardBd">' + drA.map(it => itemRow(it, drAText(it))).join('') + '</div></div>';
  right += changesCardHTML();
  const cl = openItems().filter(isCleared);
  if (cl.length) right += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Cleared in Edge</h3><span class="sub">Not past due / in credit any more</span><span style="flex:1"></span><button class="btn btn-sec btn-sm" data-act="closeCleared">' + ic('done', 15) + 'Close all ' + cl.length + '</button></div><div class="cardBd">' +
    cl.map(it => itemRow(it, 'Not in the ' + fmtDate(S.rep.asOf) + ' report — paid or fixed in Edge', true)).join('') + '</div></div>';
  right += lastReportCardHTML();
  return h + '<div class="twoCol"><div>' + left + '</div><div>' + right + '</div></div>';
}
function lastLogText(it) { const e = lastLog(it); return e ? logLabel(e) + (e.note ? ': ' + e.note : '') + ' · ' + shortName(e.by) : ''; }
/* what Dr. A is being asked (a refund, a write-off, a letter to sign) */
function drAText(it) { const e = drAQuestion(it) || lastLog(it); return e ? logLabel(e) + (e.note && !e.step ? ': ' + e.note : '') + ' · ' + shortName(e.by) : ''; }
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
    '<div class="kvRow"><span>Imported</span><b>' + esc(fmtWhen(m.at)) + ' · ' + esc(shortName(m.sid)) + '</b></div>' +
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
    const holds = cl.filter(it => holdOf(it)).map(it => it.name || 'one account');
    if (!(await confirmBox('Close ' + plural(cl.length, 'account') + '?', 'They’re not past due or in credit in the ' + fmtDateLong(S.rep.asOf) + ' report any more, so they were paid or fixed in Edge. Each is marked “Cleared in Edge”; their notes stay.' +
      (holds.length ? ' On Maintenance Hold: ' + holds.join(', ') + ' — take the yellow box off in Edge and tell the clinical team.' : ''), 'Close them'))) return;
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
  const A = S.accts, l91 = withCum(list91(A)), l31 = list31(A), l0 = list0(A), all = A.filter(a => a.pd > 0), LD = ladDueAccts();
  const amt = (l, f) => l.reduce((s, a) => s + f(a), 0), tab = S.tab.pd;
  let h = staleHTML() + tabsHTML([['lad', 'Steps due', LD.length], ['91', '91+ days', l91.length, amt(l91, a => a.b90)], ['31', '31–90 days', l31.length, amt(l31, a => a.pd)], ['0', '0–30 days', l0.length, amt(l0, a => a.pd)], ['all', 'All past due', all.length, amt(all, a => a.pd)]]);
  if (tab === 'lad') return h + ladListHTML(A, LD);
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

/* the ladder's list: every patient account with a step due, the furthest along first */
function ladListHTML(A, LD) {
  const G = ladGroups(LD), held = A.filter(a => { const l = ladFor(a); return l && l.hold; });
  if (S.ladStep && S.ladStep !== '_hold' && !G.some(([s]) => s.id === S.ladStep)) S.ladStep = ''; // that step has nothing due any more: show every step
  const step = S.ladStep;
  let h = '<div class="listHd">' + ic('ladder', 16) + '<span><b>The collections ladder</b> (handbook §14): every patient account past due, at the step its days past due call for — letters, texts and calls from day 0 to day 120. <button class="linkBtn" data-act="ladHelp">How the ladder works</button></span></div>';
  const chip = (k, l, n) => '<button class="chip sm' + (step === k ? ' on' : '') + '" data-act="ladStep" data-s="' + esc(k) + '">' + esc(l) + '<span class="c">' + n + '</span></button>';
  h += '<div class="chips subChips">' + chip('', 'Every step', LD.length) + G.map(([s, n]) => chip(s.id, s.s, n)).join('') + (held.length ? chip('_hold', 'On Maintenance Hold', held.length) : '') + '</div>';
  const base = step === '_hold' ? held : step ? LD.filter(a => ladFor(a).due.id === step) : LD;
  const list = applyFilters(base).map(a => { const l = ladFor(a); return Object.assign({}, a, { ladDay: l.day, ladN: l.due ? LAD_RANK[l.due.id] : -1 }); });
  h += ladBatchHTML(step, list);
  return h + filtersHTML({ src: false }) + tableHTML([C.name, C.lday, C.lstep, C.pd, M(C.bal), C.work], sortBy(list, { k: 'ladN', dir: -1 }), { k: 'ladN', dir: -1 },
    { empty: step === '_hold' ? 'Nobody is on Maintenance Hold.' : LD.length ? 'No accounts match.' : 'No collection steps due. ✓' });
}
/* one step for many accounts at once — e.g. this week's Letter #2s, sent together from Edge */
function ladBatchHTML(step, list) {
  const s = own(LAD_BY, step) ? LAD_BY[step] : null; if (!s || !list.length) return '';
  const L = a => ladFor(a), n = l => l > 1 ? 'all ' + l : 'it';
  let btns = '';
  if (s.dra) {
    const unsigned = list.filter(a => !L(a).signed[s.id]), toAsk = unsigned.filter(a => L(a).asked !== s.id), signed = list.length - unsigned.length;
    if (isOwner() && unsigned.length) btns += '<button class="btn btn-mint btn-sm" data-act="ladBatch" data-m="sign" data-s="' + s.id + '">' + ic('sign', 15) + 'I signed ' + n(unsigned.length) + '</button>';
    if (!isOwner() && toAsk.length) btns += '<button class="btn btn-pri btn-sm" data-act="ladBatch" data-m="ask" data-s="' + s.id + '">' + ic('flag', 15) + 'Ask Dr. A to sign ' + n(toAsk.length) + '</button>';
    if (!isOwner() && unsigned.length > toAsk.length) btns += '<span class="small">' + (unsigned.length - toAsk.length) + ' waiting for Dr. A</span>';
    if (signed) btns += '<button class="btn btn-sec btn-sm" data-act="ladBatch" data-m="done" data-s="' + s.id + '">' + ic('done', 15) + 'Mark ' + (signed > 1 ? 'the ' + signed + ' signed letters' : 'the signed letter') + ' sent</button>';
  } else btns = '<button class="btn btn-pri btn-sm" data-act="ladBatch" data-m="done" data-s="' + s.id + '">' + ic('done', 15) + 'Mark ' + n(list.length) + ' ' + esc(s.btn.toLowerCase()) + '</button>';
  const how = [s.send, s.text ? 'text ' + s.text : '', s.call ? 'a call' : ''].filter(Boolean).join(' · ');
  return '<div class="batchBar"><span><b>' + esc(s.s) + (s.n ? ' · ' + esc(s.l) : '') + '</b>' + (how ? ' — ' + esc(how) : '') + '. ' + (s.dra ? (isOwner() ? 'Once you’ve signed them, mark them signed here — the FC sends them.' : 'Dr. A signs them first; then send them together from Edge and mark them here.') : s.n ? 'Send them together from Edge, then mark them here.' : 'Mark them here once done.') + '</span><span class="btnRow">' + btns + '</span></div>';
}
/* the whole ladder, for reference (and for training) */
function ladHelpHTML() {
  const how = s => [s.send, s.call ? 'a call' : ''].filter(Boolean).join(' + ') || (s.text ? 'a text' : 'a text');
  const row = s => '<tr><td class="num"><b>' + (s.id === 'aa' ? 'Off' : s.day) + '</b></td><td><b>' + esc(s.s) + '</b><div class="small muted">' + esc(s.l) + '</div></td><td class="small">' + esc(how(s)) + (s.dra ? '<div><b>Dr. A signs</b></div>' : '') + '</td><td class="small">' + esc(s.text || '—') + '</td></tr>';
  return '<h3>The collections ladder</h3><div class="lsub">AISA handbook §14 (Collections Protocol), with §16 (the FC’s duties) and §45 (Maintenance Hold). Days are days past due — Edge’s “Days” column. The FC starts at once, alongside OrthoBanc’s own ~90-day process; use the letters and Weave texts as written.</div>' +
    '<div class="tblWrap"><table class="tbl ladHelpTbl"><thead><tr><th class="num">Day</th><th>Step</th><th>How it goes out</th><th>Weave text</th></tr></thead><tbody>' + LADDER.concat([LAD_AA]).map(row).join('') + '</tbody></table></div>' +
    '<ul class="small helpList"><li><b>Maintenance Hold</b> — the FC’s call from 60 days: comfort visits only, no active tooth movement (Edge: the yellow box and a treatment note; tell the clinical team). It’s lifted once the past due is paid, or an arrangement is signed and its first payment is in.</li>' +
    '<li><b>A broken arrangement</b> — Letter #8 (Dr. A signs; certified); an appointment becomes Debond/Finish; 30 days for appliance removal and emergencies only; to restart treatment, the full remaining balance by Mastercard, Visa or Discover.</li>' +
    '<li><b>After Letter #7</b> — 30 days for appliance removal and emergencies; then the write-off, the collection agency, Inactive Financial (only the FC changes it), and the patient and family archived.</li>' +
    '<li><b>Hardship</b> (a job loss, a medical emergency) — talk it over with Dr. A before discontinuing.</li>' +
    '<li>A payment plan or a promise to pay pauses an account’s ladder; it picks up where the days are if the plan is broken or the day passes.</li>' +
    '<li class="muted">The handbook doesn’t name the day-75 text or give a day for “FC- Delinquent #8”: the app uses #7 (the between-letters text) on day 75, and #8 on day 104 — two weeks after Dr. A’s day-90 letter, which it mentions.</li></ul>' +
    '<div class="mFt"><button class="btn btn-pri" data-act="closeModal">Close</button></div>';
}
Object.assign(ACT, {
  ladHelp() { const w = openModal(ladHelpHTML()); const m = w && $('.modal', w); if (m) m.classList.add('ladM'); },
  ladStep(t) { S.ladStep = t.dataset.s || ''; S.sort = { k: '', dir: 1 }; renderView(); },
  async ladBatch(t) {
    const id = t.dataset.s, m = t.dataset.m, s = own(LAD_BY, id) ? LAD_BY[id] : null; if (!s) return;
    const list = (S.lastList || []).filter(x => {
      const l = ladFor(S.byKey.get(x.key)); if (!l || !l.due || l.due.id !== id) return false;
      return m === 'sign' ? !l.signed[id] : m === 'ask' ? !l.signed[id] && l.asked !== id : !s.dra || !!l.signed[id];
    });
    if (!list.length) return;
    const names = list.slice(0, 12).map(a => a.patient).join(', ') + (list.length > 12 ? ' and ' + (list.length - 12) + ' more' : '');
    const q = m === 'sign' ? 'You signed ' + s.s + ' for ' + plural(list.length, 'account') + '?' : m === 'ask' ? 'Ask Dr. A to sign ' + s.s + ' for ' + plural(list.length, 'account') + '?' : 'Mark ' + s.s + ' ' + s.btn.toLowerCase() + ' for ' + plural(list.length, 'account') + '?';
    if (!(await confirmBox(q, names + '.', m === 'ask' ? 'Ask him' : 'Yes, mark them'))) return;
    const now = Date.now(), by = meSid(); let ok = 0;
    for (const a of list) {
      const fn = m === 'sign' ? d => signStep(d, id, { by }, now) : m === 'ask' ? d => askSign(d, id, { by }, now) : d => { ladderLog(d, id, { by }, now); };
      if (await change(a.key, fn, m === 'done' ? { a: 'ladder', step: id } : m === 'ask' ? { a: 'drA', step: id } : { a: 'drAok', step: id })) ok++;
    }
    toast(m === 'sign' ? 'Signed ' + plural(ok, 'letter') + ' — ready to send' : m === 'ask' ? 'Asked — ' + plural(ok, 'letter') + ' on Dr. A’s Today' : s.s + ': ' + plural(ok, 'account') + ' marked ' + s.btn.toLowerCase());
  }
});

/* ---------- Insurance ---------- */
function viewIns() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  if (S.rep && !S.rep.cover.ins) return staleHTML() + '<div class="card"><div class="empty">The latest report was run with “Exclude Insurance Contracts” ticked, so it has no insurance accounts. Run it again with that box unticked.</div></div>';
  const A = S.accts, nev = listNever(A), partly = A.filter(a => a.ins && a.pd > 0 && !a.months).sort((x, y) => y.pd - x.pd);
  const sm = summarize(S.rep, S.cfg).never, by = t => nev.filter(a => a.tier === t);
  const tiers = S.cfg.tiers;
  const tabs = tabsHTML([['chase', '2 · Chase now', by('chase').length], ['investigate', '3 · Investigate', by('investigate').length], ['nofile', '4 · Never filed?', by('nofile').length], ['monitor', '1 · Monitor', by('monitor').length], ['all', 'All nothing paid', nev.length], ['partly', 'Partly paid, past due', partly.length], ['carriers', 'Carriers', S.book ? S.book.carriers.length : 0]]);
  if (S.tab.ins === 'carriers') return staleHTML() + tabs + carriersTabHTML();
  let h = staleHTML() + '<div class="ruleBox"><b>Insurance accounts where nothing has been paid.</b> When an insurance account’s past due is an exact multiple of ' + money(S.cfg.inst, true) + ' (the monthly instalment), the carrier has paid nothing at all: N × ' + money(S.cfg.inst, true) + ' = N untouched months. The aging report hides this, because it only ages the instalment.' +
    '<div class="rb2"><div><div class="n">' + sm.n + '</div><div class="l">accounts</div></div><div><div class="n">' + money(sm.pd) + '</div><div class="l">past due</div></div><div><div class="n">' + money(sm.contract) + '</div><div class="l">contract balance behind them' + (sm.pctBook != null ? ' (' + Math.round(sm.pctBook * 100) + '% of the insurance book)' : '') + '</div></div></div></div>';
  h += tabs;
  const tab = S.tab.ins;
  const why = { chase: 'Past due ' + (tiers[0] + 1) + '–' + tiers[1] + ' days with nothing paid: call the carrier now.', investigate: tiers[1] + 1 + '–' + tiers[2] + ' days with nothing paid: the claim is likely stuck or denied — investigate it.', nofile: 'Over ' + tiers[2] + ' days with nothing paid: the claim was probably never filed. Verify, then file it or write it off.', monitor: 'Up to ' + tiers[0] + ' days: the claim is likely still in flight.', all: 'Every insurance account where nothing has been paid, most urgent first.', partly: 'Insurance accounts past due where the carrier has paid something.' };
  h += '<div class="listHd">' + ic('info', 16) + '<span>' + esc(why[tab]) + '</span></div>';
  if (tab === 'partly') return h + filtersHTML({ src: false }) + tableHTML([C.name, C.car, M(C.b30), M(C.b60), M(C.b90), C.pd, C.bal, C.days, C.sug, C.work], sortBy(applyFilters(partly), { k: 'pd', dir: -1 }), { k: 'pd', dir: -1 }, { empty: 'None.' });
  const list = tab === 'all' ? nev : by(tab);
  return h + filtersHTML({ src: false }) + tableHTML([C.name, C.car, { k: 'months', l: 'Months unpaid', num: true, td: a => '<span class="big">' + a.months + '</span>' }, C.pd, { k: 'bal', l: 'Contract balance', num: true, cls: 'hideM', td: a => a.bal == null ? '—' : money(a.bal, true) }, C.days, { l: 'Triage', cls: 'hideM', td: a => tierChip(a) }, C.work],
    sortBy(applyFilters(list), tab === 'all' ? { k: 'days', dir: -1 } : { k: 'bal', dir: -1 }), tab === 'all' ? { k: 'days', dir: -1 } : { k: 'bal', dir: -1 }, { empty: 'None at this step.' });
}

/* ---------- Credits ---------- */
function viewCredits() {
  if (S.loadErr) return '<div class="card"><div class="empty">' + esc(S.loadErr) + '</div></div>';
  if (!S.reports.length) return noReportHTML();
  if (notOpenHTML()) return notOpenHTML();
  if (S.rep && !S.rep.cover.credit) return staleHTML() + '<div class="card"><div class="empty">The latest report doesn’t have credit balances in it (it was run for past due only).</div></div>';
  const all = listCredits(S.accts), work = all.filter(a => !a.prepay), pre = all.filter(a => a.prepay), amt = l => l.reduce((s, a) => s + a.credit, 0), tab = S.tab.cr;
  const aw = auditWindow(todayISO()), AD = aw.on ? auditData() : null;
  let h = staleHTML() + tabsHTML([['work', 'To resolve', work.length, amt(work)], ['pre', 'Prepayments', pre.length, amt(pre)], ['all', 'All credits', all.length, amt(all)], ['audit', aw.on ? 'December audit' : 'December audit (Dec 1)', AD ? AD.rev + ' of ' + AD.rows.length : work.length]]);
  if (tab === 'audit') return h + auditTabHTML();
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
  const head = ['Patient', 'Responsible party', 'Edge status', 'Pays', 'Home phone', 'Work phone', '0-30', '31-60', '61-90', '91+', 'Past due', 'Contract balance', 'Credit', 'Days', 'Last payment', 'Suggested', 'Collections step', 'Follow-up', 'Last note'];
  const rows = list.map(a => { const it = itemFor(a.key), e = it && lastLog(it), sug = a.credit > 0 && !(a.pd > 0) ? crAction(a).l : a.months ? TIERS[a.tier].l : pdAction(a, S.cfg).l, L = ladFor(a);
    const lad = !L ? '' : (L.due ? 'Day ' + L.day + ': ' + L.due.s + ' — ' + L.due.l + (L.due.dra ? ' (' + ladSignText(L, L.due) + ')' : '') : L.paused ? 'Paused — ' + (LAD_PAUSE[L.paused] || '') : L.fin ? 'Last letter sent; 30 days end ' + L.endOn : L.next ? 'Next: ' + L.next.s + ' on ' + L.nextOn : '') + (L.hold ? ' · on Maintenance Hold' : '');
    return [a.patient, a.rp, a.sts, a.ins ? 'Insurance' : 'Patient', a.home, a.work].map(csvCell).concat([a.b0, a.b30, a.b60, a.b90, a.pd, a.bal == null ? '' : a.bal, a.credit, a.days == null ? '' : a.days].map(n => String(n))).concat([a.recv, sug, lad, it ? it.follow || '' : '', e ? logLabel(e) + (e.note ? ': ' + e.note : '') : ''].map(csvCell)).join(','); });
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
  h += goalsCardHTML() + trendsCardHTML();
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
  const lad = ladSummaryHTML();
  h += '<div class="sumGrid"><div>' + aging + '<div style="height:18px"></div>' + (lad ? lad + '<div style="height:18px"></div>' : '') + conc + '<div style="height:18px"></div>' + nev + '</div><div>' + pvi + '<div style="height:18px"></div>' + bs + '<div style="height:18px"></div>' + crd + '</div></div>';
  h += '<div class="sumGrid" style="margin-top:18px"><div>' + trendHTML() + '</div><div>' + monthEndHTML(s) + '</div></div>';
  return h;
}
ACT.print = () => window.print();
/* where the patient accounts are on the collections ladder today */
function ladSummaryHTML() {
  if (!S.rep || !S.rep.cover.pastDue) return '';
  const all = Array.from(ladAll().values()), LD = ladDueAccts(), pdOf = l => l.reduce((t, a) => t + a.pd, 0), n = f => all.filter(f).length;
  const rows = ladGroups(LD).map(([s, k]) => '<tr><td>' + ladChip(s) + ' <span class="small muted">' + esc(s.id === 'end' || s.id === 'endaa' ? 'after the last letter' : s.id === 'aa' ? 'arrangement broken' : 'day ' + s.day + (s.dra ? ' · Dr. A signs' : '')) + '</span></td><td class="num">' + k + '</td><td class="num">' + money(pdOf(LD.filter(a => ladFor(a).due.id === s.id))) + '</td></tr>').join('');
  return '<div class="card"><div class="cardHd"><h3>Collections ladder</h3><span class="sub">Today · ' + plural(all.length, 'patient account') + ' on it</span></div><div class="cardBd">' +
    (rows ? '<table class="tbl"><thead><tr><th>Step due</th><th class="num">Accounts</th><th class="num">Past due</th></tr></thead><tbody>' + rows + '<tr><td><b>Total</b></td><td class="num"><b>' + LD.length + '</b></td><td class="num"><b>' + money(pdOf(LD)) + '</b></td></tr></tbody></table>' : '<div class="small muted">No steps due.</div>') +
    '<div style="margin-top:10px"><div class="kvRow"><span>On Maintenance Hold</span><b>' + n(l => l.hold) + '</b></div>' +
    '<div class="kvRow"><span>Paused — a payment plan, or a promise to pay</span><b>' + n(l => l.paused === 'plan' || l.paused === 'promise') + '</b></div>' +
    '<div class="kvRow"><span>Last letter sent — in the 30 days after it</span><b>' + n(l => l.fin && !l.due) + '</b></div></div></div></div>';
}
/* past due, 91+ and credits to resolve, report by report (from each report's sealed totals) */
function trendHTML() {
  const pts = S.reports.filter(r => r.sum && r.sum.cover && r.sum.cover.pastDue).slice().sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : (a.at || 0) - (b.at || 0)));
  const byDay = new Map(); pts.forEach(r => byDay.set(r.asOf, r)); const P = Array.from(byDay.values()).slice(-26);
  const head = '<div class="card trend"><div class="cardHd"><h3>Over time</h3><span class="sub"><span class="lg" style="background:var(--navy-500)"></span>Past due <span class="lg b90"></span>91+ <span class="lg" style="background:var(--blue-500)"></span>Credits to resolve</span></div><div class="cardBd">';
  if (P.length < 2) return head + '<div class="small muted">Shows up once there are two reports (import one each week).</div></div></div>';
  const narrow = innerWidth < 640, W = narrow ? 360 : 560, H = narrow ? 170 : 190, L = 54, R = 10, T = 10, Bm = 24, max = Math.max(...P.map(r => Math.max(r.sum.pd || 0, r.sum.crWork || 0))) || 1;
  const x = i => L + (W - L - R) * (P.length === 1 ? 0 : i / (P.length - 1)), y = v => T + (H - T - Bm) * (1 - v / max);
  const line = (f, color) => '<path class="tl" stroke="' + color + '" d="' + P.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(f(r) || 0).toFixed(1)).join(' ') + '"/>';
  const ticks = [0, 0.5, 1].map(f => '<text x="' + (L - 6) + '" y="' + (y(max * f) + 4) + '" text-anchor="end">' + money(max * f) + '</text><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '" stroke="var(--grey-100)"/>').join('');
  const lbl = P.map((r, i) => (i === 0 || i === P.length - 1 || P.length <= (narrow ? 5 : 8)) ? '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === P.length - 1 ? 'end' : 'middle') + '">' + esc(fmtDate(r.asOf)) + '</text>' : '').join('');
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
  let h = dueLineHTML() + '<div class="adminGrid"><div><div class="card"><div class="cardHd"><h3>Import a report</h3><span class="sub">Edge → Accounts Receivable Aging → Export → Excel</span></div><div class="cardBd">';
  if (imp && imp.files && imp.files.length) h += importPreviewHTML(imp);
  else h += '<div class="dropZone" id="dropZone" tabindex="0" role="button" aria-label="Choose the Edge report file">' + ic('import', 26) + '<b>Drop the Excel file here</b><span class="small">or click to choose it · .xls, .xlsx or .csv · one or more files</span></div>' +
    '<input type="file" id="arFile" accept=".xls,.xlsx,.csv,.txt,.htm,.html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" multiple class="hidden">' +
    '<div class="pasteBox" id="pasteBox" tabindex="0" role="textbox" aria-label="Paste the report here">Or open the export in Excel, select everything (Ctrl+A), copy (Ctrl+C), click here and paste (Ctrl+V).</div>' +
    (imp && imp.err ? '<div class="lockErr" style="margin-top:12px">' + esc(imp.err) + '</div>' : '') + edgeStepsHTML(!S.reports.length) +
    '<p class="small muted" style="margin-top:10px">OrthoBanc’s Failed Transaction Report (FailedTransactions.xls) can be dropped here too — it opens its own list.</p>' +
    '<p class="small muted" style="margin-top:6px">So can Edge’s <b>Insurance Aging</b> — it fills in each insurance account’s carrier (Insurance → Carriers).</p>' + iaStepsHTML(false) +
    '<p class="small muted" style="margin-top:6px">And Edge’s task list (<b>Upcoming and Overdue Tasks</b>, exported to Excel) — each task is added to its account, with its due date as the follow-up.</p>';
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
      '<div class="small muted">Imported ' + esc(fmtWhen(r.at)) + ' by ' + esc(shortName(r.sid)) + ' · ' + plural(r.n || 0, 'account') + '</div>' + (s.cover ? '<div style="margin-top:4px">' + coverHTML(s.cover) + '</div>' : '') + '</span>' +
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
    try {
      const g = html && /<table/i.test(html) ? readHTMLTables(html) : readGridText(text || ''), ob = obFromGrid(g);
      if (ob) { obPreview(Object.assign(ob, { name: 'Pasted from Excel', kind: 'text' })); return; } // OrthoBanc's failed-payment report
      const ia = insAgingFromGrid(g); if (ia) { insAgingPreview(Object.assign(ia, { name: 'Pasted from Excel', kind: 'text' })); return; } // Edge's Insurance Aging: carriers
      const et = edgeTasksFromGrid(g); if (et) { edgeTasksPreview(Object.assign(et, { name: 'Pasted from Excel', kind: 'text' })); return; } // Edge's task list
      addParsed([{ name: 'Pasted from Excel', p: edgeFromGrid(g, 'Pasted from Excel') }]);
    }
    catch (x) { S.imp = { files: [], err: errText(x) }; renderView(); }
  });
  paintPhotos();
}
async function addFiles(files) {
  const out = []; let ob = null, ia = null, et = null;
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) { out.push({ name: f.name, err: 'That file is too big to be an A/R report.' }); continue; }
    try {
      const p = await readReportFile(f.name, await f.arrayBuffer());
      if (p.ob) { ob = ob || p; continue; } // OrthoBanc's report goes its own way
      if (p.insAging) { ia = ia || p; continue; } // so does Edge's Insurance Aging (it only fills in carriers)
      if (p.edgeTasks) { et = et || p; continue; } // and Edge's task list (notes and follow-ups on the accounts)
      out.push({ name: f.name, p });
    } catch (x) { out.push({ name: f.name, err: errText(x) }); }
  }
  if (out.length) addParsed(out);
  if (ob) obPreview(ob); else if (ia) insAgingPreview(ia); else if (et) edgeTasksPreview(et);
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
      await B.saveReport(rep, reportTotals(rep, S.cfg, S.rep && S.rep.asOf < rep.asOf ? S.rep : null));
      S.imp = null; toast('Report saved — the lists now show ' + fmtDateLong(rep.asOf)); S.view = 'today'; renderNav(); renderView();
    } catch (x) { imp.busy = false; busyBtn(btn, false); toast(errText(x), { bad: true }); }
  },
  async delReport(t) {
    const r = S.reports.find(x => x.id === t.dataset.id); if (!r) return;
    if (!(await confirmBox('Delete the ' + fmtDateLong(r.asOf) + ' report?', 'The lists go back to the report before it. Notes and follow-ups on accounts are kept.', 'Delete', true))) return;
    act(() => B.deleteReport(r.id), 'Report deleted');
  }
});

/* =====================================================================
   Focus mode (6 Oct 2026): what to do first today, most urgent first
   (focusEntries in ar.js). Today shows a one-line summary; Focus mode
   shows only the list, with what's been done today.
   ===================================================================== */
function focusCtx() {
  const t = todayISO(), aw = auditWindow(t), pk = S.prevId + '|' + S.repId;
  if (!S.prevPdMemo || S.prevPdMemo.k !== pk) S.prevPdMemo = { k: pk, set: S.prev && S.rep && S.prev.cover.pastDue && S.rep.cover.pastDue ? new Set(reportAccts(S.prev, S.cfg).filter(a => a.pd > 0).map(a => a.key)) : null };
  return { accts: S.rep ? S.accts : [], asOf: S.rep ? S.rep.asOf : t, byKey: S.byKey, item: k => { const it = itemFor(k); return it && !isBack(it) ? it : null; }, lad: a => ladFor(a), open: openItems(), cleared: isCleared,
    today: t, owner: isOwner(), prevPd: S.prevPdMemo.set, book: S.book, auditStart: aw.on && S.rep && S.rep.cover.credit ? aw.start : '' };
}
/* accounts somebody logged something on today */
function focusDoneToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); const t0 = d.getTime(), keys = new Set();
  S.items.forEach(it => { if (!it.locked && it.key && (it.log || []).some(e => (e.at || 0) >= t0 && e.k !== 'reopen' && e.k !== 'edgetask')) keys.add(it.key); });
  return keys;
}
function focusData() {
  const E = focusEntries(focusCtx()), U = E.filter(e => e.cls === 'urgent'), T = E.filter(e => e.cls === 'today'), L = E.filter(e => e.cls === 'later');
  // OrthoBanc's failed-payment report, on its days, until someone marks it checked
  const O = obState(S.book, todayISO(), obDays());
  if (O.due) U.unshift({ key: '_ob', special: 'obCheck', label: 'OrthoBanc failed-payment report', kind: 'ob', cls: 'urgent', sev: 0, why: 'The ' + fmtDate(O.due.date) + ' report: open it, text each family on it today (day 0), then mark it checked', act: 'Check it', min: 10, amt: 0, also: [] });
  else { // its file was imported: one line for the whole list (not one per family), until every family on it is ticked
    const rep = O.cur ? obRepFor(O.cur.date) : null, P = rep ? obProgress(rep) : null;
    if (P && P.left) (P.holdLeft ? U : T).unshift({ key: '_obl', special: 'obList', day: rep.day, label: 'OrthoBanc: ' + plural(P.left, 'family', 'families') + ' to text', kind: 'ob', cls: P.holdLeft ? 'urgent' : 'today', sev: 0,
      why: 'The ' + fmtDate(rep.day) + ' report' + (P.holdLeft ? ' · ' + P.holdLeft + ' on HOLD' : '') + ' — text each one (day 0), note the chart, set a 2-week Edge task, tick them off', act: 'Open the list', min: Math.min(60, 2 * P.left), amt: 0, also: [] });
  }
  return { E, U, T, L, cl: openItems().filter(isCleared), done: focusDoneToday(), min: U.concat(T).reduce((s, e) => s + e.min, 0) };
}
function fmtMin(m) { if (m < 1) return 'a minute or two'; if (m < 60) return 'about ' + m + ' min'; const mm = Math.round(m / 5) * 5, h = Math.floor(mm / 60), r = mm % 60; return 'about ' + h + ' h' + (r ? ' ' + r + ' min' : ''); }
function focusStripHTML(F) {
  const n = F.U.length + F.T.length;
  return '<div class="focusBar">' + ic('flag', 18) + '<span><b>Do these first:</b> ' + (F.U.length ? '<b class="fU">' + F.U.length + ' urgent</b> · ' : '') + (F.T.length ? plural(F.T.length, 'thing') + ' for today' : 'nothing else due today') +
    (n ? ' · ' + fmtMin(F.min) : '') + (F.done.size ? ' · ' + F.done.size + ' done today' : '') + '</span><button class="btn btn-pri btn-sm" data-act="focusOn">' + ic('next', 15) + 'Focus mode</button></div>';
}
function focusRowHTML(e) {
  if (e.special) return '<button class="frow ' + e.cls + '" data-act="' + esc(e.special) + '" data-kind="' + esc(e.kind) + '"' + (e.day ? ' data-day="' + esc(e.day) + '"' : '') + '><span class="fTag">' + (e.cls === 'urgent' ? 'Urgent' : e.cls === 'today' ? 'Today' : 'Later') + '</span><span class="grow"><span class="pt">' + esc(e.label) + '</span><span class="fWhy">' + esc(e.why) + '</span></span><span class="fAct">' + esc(e.act) + ic('next', 14) + '</span></button>';
  const a = e.a, it = e.it, name = a ? a.patient : (it && it.name) || '', rp = a ? (a.ins ? 'Ins: ' : '') + rpName(a) : String((it && it.rp) || '').replace(/^\s*ins\s*:\s*/i, 'Ins: ');
  return '<button class="frow ' + e.cls + '" data-act="open" data-key="' + esc(e.key) + '" data-kind="' + esc(e.kind) + '"><span class="fTag">' + (e.cls === 'urgent' ? 'Urgent' : e.cls === 'today' ? 'Today' : 'Later') + '</span>' +
    '<span class="grow"><span class="pt">' + esc(name) + '<span class="par"> · ' + esc(rp) + '</span></span><span class="fWhy">' + esc(e.why) + '</span>' + (e.also.length ? '<span class="fAlso">Also: ' + esc(e.also.join(' · ')) + '</span>' : '') + '</span>' +
    (e.amt ? '<span class="fAmt">' + money(e.amt) + '</span>' : '') + '<span class="fAct">' + esc(e.act) + ic('next', 14) + '</span></button>';
}
function focusViewHTML() {
  const F = focusData(), left = F.U.length + F.T.length, total = F.done.size + left, pctDone = total ? Math.round(F.done.size / total * 100) : 100;
  let h = '<div class="focusHd"><div><h3>' + ic('flag', 20) + 'Do these first</h3><div class="small muted">Most urgent first. Tap one to open it; once it’s logged it drops off the list.</div></div><button class="btn btn-ghost" data-act="focusOff">Show everything</button></div>' +
    '<div class="fProg"><div class="fBar"><i style="width:' + pctDone + '%"></i></div><span><b>' + F.done.size + '</b> done today · <b>' + left + '</b> to go' + (left ? ' · ' + fmtMin(F.min) : '') + '</span></div>';
  h += left ? '<div class="card"><div class="cardBd fList">' + F.U.concat(F.T).map(focusRowHTML).join('') + '</div></div>'
    : '<div class="card"><div class="empty">Nothing urgent and nothing else due today. ✓' + (F.L.length || F.cl.length ? ' When you have time, see below.' : '') + '</div></div>';
  if (F.L.length || F.cl.length) h += '<details class="help fLater"' + (left ? '' : ' open') + '><summary>When you have time · ' + (F.L.length + (F.cl.length ? 1 : 0)) + '</summary><div class="card"><div class="cardBd fList">' +
    (F.cl.length ? '<button class="frow later" data-act="closeCleared"><span class="fTag">Later</span><span class="grow"><span class="pt">' + plural(F.cl.length, 'account') + ' cleared in Edge</span><span class="fWhy">Paid or fixed in Edge since they were worked — close them in one go</span></span><span class="fAct">Close all' + ic('next', 14) + '</span></button>' : '') +
    F.L.map(focusRowHTML).join('') + '</div></div></details>';
  return h;
}
Object.assign(ACT, {
  focusOn() { S.focus = true; try { localStorage.setItem('nloAR.focus', '1'); } catch (e) { } renderView(); window.scrollTo(0, 0); },
  focusOff() { S.focus = false; try { localStorage.setItem('nloAR.focus', '0'); } catch (e) { } renderView(); window.scrollTo(0, 0); }
});

/* =====================================================================
   Insurance carriers (6 Oct 2026): the Carriers tab, the carrier on
   each insurance account, calling a carrier once about all its accounts
   ===================================================================== */
function carrierStats(c) {
  const mine = S.accts.filter(a => a.ins && (carrierFor(a.key) || {}).id === c.id), pd = mine.filter(a => a.pd > 0);
  let last = null; mine.forEach(a => { const it = itemFor(a.key); ((it && it.log) || []).forEach(e => { if (/^ins_/.test(e.k) && (!last || e.at > last.at)) last = e; }); });
  const days = pd.map(a => a.days).filter(d => d != null);
  return { all: mine, pd, pdAmt: round2(pd.reduce((s, a) => s + a.pd, 0)), never: pd.filter(a => a.months > 0).length, oldest: days.length ? Math.max(...days) : null,
    avg: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null, credit: round2(mine.filter(a => a.credit > 0).reduce((s, a) => s + a.credit, 0)),
    paid: S.diff && S.prev ? S.diff.cleared.filter(k => (carrierOf(S.book, k) || {}).id === c.id).length : null, last, near: c.tf ? pd.filter(a => a.days != null && a.days >= c.tf - 30 && a.days <= c.tf).length : 0 };
}
/* src: carrierSrc(…) for the account (null: none yet). With Edge's carrier, the first choice is "Edge's" — picking another sets it by hand. */
function carrierSelect(key, src, chg) {
  const list = S.book ? S.book.carriers : [], hand = src && src.hand, edge = src && src.edge;
  const first = edge ? '<option value=""' + (hand ? '' : ' selected') + '>Edge: ' + esc(edge.name) + '</option>' : '<option value="">' + (hand ? 'No carrier' : 'Pick the carrier…') + '</option>';
  return '<select class="inp carSel" data-chg="' + chg + '" data-key="' + esc(key) + '" aria-label="Insurance carrier">' + first +
    list.map(x => '<option value="' + esc(x.id) + '"' + (hand && hand.id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '<option value="_new">New carrier…</option></select>';
}
function carriersTabHTML() {
  const list = S.book ? S.book.carriers : [], untagged = S.accts.filter(a => a.ins && a.pd > 0 && !carrierFor(a.key)), e = S.book && S.book.edge;
  const differ = S.accts.filter(a => a.ins && carrierSrc(S.book, a.key, a).differs);
  let h = '<div class="listHd">' + ic('shield', 16) + '<span><b>Insurance carriers.</b> Edge’s A/R Aging shows the policyholder, not the carrier. Drop Edge’s <b>Insurance Aging</b> on Reports and every insurance account gets its carrier, with Edge’s phone number for it — or set one by hand (brothers and sisters on the same policy get it too); a carrier set by hand is never changed by an import. Then the carrier’s phone, portal and payer ID are on the account, slow payers stand out, and one call can cover all of a carrier’s accounts.</span></div>';
  h += '<div class="iaLine">' + ic('import', 16) + '<span>' + (e ? 'From Edge’s Insurance Aging of <b>' + esc(fmtDateLong(e.asOf)) + '</b> · ' + plural(e.n, 'account') + ' · imported by ' + esc(shortName(e.by)) + ', ' + esc(fmtWhen(e.at)) : 'Edge’s Insurance Aging hasn’t been imported yet — one import gives every insurance account its carrier.') + '</span>' +
    '<button class="btn btn-sec btn-sm" data-act="iaPick">' + ic('import', 15) + (e ? 'Import a newer one' : 'Import Insurance Aging') + '</button></div>' + (e ? '' : iaStepsHTML(true));
  h += '<div class="btnRow" style="margin-bottom:14px"><button class="btn btn-pri btn-sm" data-act="carrierNew">' + ic('plus', 15) + 'Add a carrier</button>' + (untagged.length ? '<button class="btn btn-ghost" data-act="scrollUntagged">' + plural(untagged.length, 'account') + ' without a carrier</button>' : '') + '</div>';
  if (!list.length) h += '<div class="card"><div class="empty">No carriers yet. Import Edge’s Insurance Aging, or add the ones you bill most — their provider phone line, portal and payer ID — then set them on the accounts below.</div></div>';
  else {
    // a card for each carrier with something past due or in credit, and the ones added by hand; Edge's other carriers in a short list
    const R = list.map(c => Object.assign({ c }, carrierStats(c))), card = r => r.pd.length || r.credit || !(r.c.edge && r.c.edge.length), rest = R.filter(r => !card(r));
    h += '<div class="carGrid">' + R.filter(card).sort((x, y) => y.pdAmt - x.pdAmt || x.c.name.localeCompare(y.c.name)).map(carrierCardHTML).join('') + '</div>';
    if (rest.length) h += '<details class="help carRest"><summary>' + plural(rest.length, 'more carrier') + ' from Edge — nothing past due or in credit</summary>' +
      rest.sort((x, y) => x.c.name.localeCompare(y.c.name)).map(r => '<div class="carRow"><b>' + esc(r.c.name) + '</b><span class="small muted">' + esc(r.c.phone ? phoneTxt(r.c.phone) : 'no phone') + (r.all.length ? ' · ' + plural(r.all.length, 'account') + ' on the report' : '') + '</span>' +
        '<button class="btn btn-ghost btn-sm" data-act="carrierEdit" data-id="' + esc(r.c.id) + '">Edit</button></div>').join('') + '</details>';
  }
  if (differ.length) h += '<div class="card" id="carDiffer" style="margin-top:18px"><div class="cardHd"><h3>Set by hand — Edge has another carrier</h3><span class="sub">' + plural(differ.length, 'account') + '</span><span style="flex:1"></span>' +
    '<button class="btn btn-sec btn-sm" data-act="carrierUseEdgeAll">Use Edge’s for all ' + differ.length + '</button></div><div class="cardBd">' +
    differ.map(a => { const s2 = carrierSrc(S.book, a.key, a); return '<div class="tagRow"><button class="linkBtn" data-act="open" data-key="' + esc(a.key) + '"><b>' + esc(a.patient) + '</b> <span class="muted">· ' + esc(rpName(a)) + '</span></button>' +
      '<span class="small">Set: <b>' + esc(s2.hand.name) + '</b> · Edge: <b>' + esc(s2.edge.name) + '</b></span><button class="btn btn-ghost btn-sm" data-act="carrierUseEdge" data-key="' + esc(a.key) + '">Use Edge’s</button></div>'; }).join('') + '</div></div>';
  h += '<div class="card" id="untagged" style="margin-top:18px"><div class="cardHd"><h3>Insurance accounts without a carrier</h3><span class="sub">' + plural(untagged.length, 'account') + ' past due</span></div><div class="cardBd">' +
    (untagged.length ? untagged.sort((x, y) => (y.days || 0) - (x.days || 0)).map(a => '<div class="tagRow"><button class="linkBtn" data-act="open" data-key="' + esc(a.key) + '"><b>' + esc(a.patient) + '</b> <span class="muted">· ' + esc(rpName(a)) + '</span></button>' +
      '<span class="small muted">' + money(a.pd) + (a.days != null ? ' · ' + a.days + ' days' : '') + (a.months ? ' · nothing paid' : '') + '</span>' + carrierSelect(a.key, null, 'tagRow') + '</div>').join('')
      : '<div class="empty">Every insurance account past due has its carrier. ✓</div>') + '</div></div>';
  return h;
}
function carrierCardHTML(r) {
  const c = r.c, tel = telHref(c.phone);
  const facts = [plural(r.pd.length, 'account') + ' past due' + (r.pd.length ? ' · ' + money(r.pdAmt) : ''), r.never ? r.never + ' with nothing paid' : '', r.oldest != null ? 'oldest ' + r.oldest + ' days' : '',
    r.avg != null ? 'average ' + r.avg + ' days' : '', r.paid ? r.paid + ' paid since ' + fmtDate(S.prev.asOf) : '', r.credit ? money(r.credit) + ' in credits' : ''].filter(Boolean);
  const meta = ['Last call: ' + (r.last ? fmtDate(isoOf(new Date(r.last.at))) + ' (' + shortName(r.last.by) + ')' : 'none logged'), c.tf ? 'filing limit ' + c.tf + ' days' : '', c.payer ? 'payer ID ' + c.payer : ''].filter(Boolean);
  return '<div class="card carCard" data-car="' + esc(c.id) + '"><div class="cardHd"><h3>' + esc(c.name) + '</h3>' + (r.near ? '<span class="sug red">' + r.near + ' near the filing limit</span>' : '') + '<span style="flex:1"></span><button class="btn btn-ghost" data-act="carrierEdit" data-id="' + esc(c.id) + '">Edit</button></div><div class="cardBd">' +
    '<div class="small carFacts">' + esc(facts.join(' · ')) + '</div><div class="small muted">' + esc(meta.join(' · ')) + '</div>' +
    '<div class="btnRow" style="margin-top:10px">' + (tel ? '<a class="btn btn-act btn-sm" href="' + esc(tel) + '">' + ic('call', 15) + esc(phoneTxt(c.phone)) + '</a>' : '') + (c.portal ? '<a class="btn btn-sec btn-sm" href="' + esc(c.portal) + '" target="_blank" rel="noopener noreferrer">Portal</a>' : '') +
    (r.pd.length ? '<button class="btn btn-sec btn-sm" data-act="carrierCallAll" data-id="' + esc(c.id) + '">' + ic('done', 15) + 'Called about ' + (r.pd.length > 1 ? 'all ' + r.pd.length : 'it') + '</button>' : '') + '</div>' +
    (r.pd.length ? '<details class="help"><summary>The ' + plural(r.pd.length, 'account') + '</summary>' + r.pd.slice().sort((x, y) => (y.days || 0) - (x.days || 0)).map(a => acctRow(a, (a.months ? 'Nothing paid · ' : '') + (a.days != null ? a.days + ' days' : '') + (workState(a.key) === 'new' ? ' · not started' : ''), '<span class="small big">' + money(a.pd) + '</span>')).join('') + '</details>' : '') +
    (c.notes ? '<div class="small muted carNotes">' + esc(c.notes) + '</div>' : '') + '</div></div>';
}
function carrierFormHTML(c, tagKey) {
  c = c || {};
  const f = (id, l, v, ph, type) => '<div class="field"><label for="' + id + '">' + l + '</label><input id="' + id + '" class="inp"' + (type ? ' type="' + type + '"' : '') + ' autocomplete="off" value="' + esc(v == null ? '' : String(v)) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>';
  return '<h3>' + (c.id ? esc(c.name) : 'Add a carrier') + '</h3><div class="lsub">Shared with everyone who has A/R, and sealed like the accounts.' + (tagKey ? ' It’s set on this account when you save.' : '') + '</div>' +
    f('carName', 'Name', c.name, 'e.g. the plan on the EOB') + '<div class="grid2">' + f('carPhone', 'Provider phone line', c.phone, '(800) 555-…', 'tel') + f('carFax', 'Fax', c.fax) + '</div>' +
    f('carPortal', 'Provider portal (web address)', c.portal, 'https://…', 'url') + '<div class="grid2">' + f('carPayer', 'Payer ID', c.payer) + f('carTf', 'Timely filing limit (days)', c.tf || '', 'e.g. 365', 'number') + '</div>' +
    '<div class="field"><label for="carNotes">Notes — claims address, who to ask for, what they need</label><textarea id="carNotes" class="inp" rows="3">' + esc(c.notes || '') + '</textarea></div>' +
    (c.edge && c.edge.length ? '<div class="small muted" style="margin:-4px 0 10px">In Edge’s Insurance Aging as ' + c.edge.map(n => '“' + esc(n) + '”').join(', ') + '.</div>' : '') +
    (c.id && S.book && S.book.carriers.length > 1 ? '<details class="help mergeBox"><summary>Same company as another carrier? Merge them</summary><div class="small muted" style="margin:4px 0 8px">Edge often lists one company under two names. Merging moves this one’s accounts — and Edge’s name for it — to the carrier you pick, so the next Insurance Aging puts them there too; anything filled in here that the other one lacks goes with it. Then this one is removed.</div>' +
      '<div class="btnRow"><select id="carMergeInto" class="inp carSel" aria-label="Merge into"><option value="">Merge into…</option>' + S.book.carriers.filter(x => x.id !== c.id).map(x => '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>').join('') + '</select>' +
      '<button class="btn btn-sec btn-sm" data-act="carrierMerge" data-id="' + esc(c.id) + '">Merge</button></div></details>' : '') +
    '<div class="mFt">' + (c.id ? '<button class="btn btn-ghost" data-act="carrierDel" data-id="' + esc(c.id) + '" style="margin-right:auto;color:var(--coral-700)">Remove</button>' : '') +
    '<button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="carrierSave" data-id="' + esc(c.id || '') + '" data-tag="' + esc(tagKey || '') + '">Save</button></div>';
}
/* the account and the other untagged insurance accounts under the same policyholder */
function tagKeysFor(key) { const a = S.byKey.get(key); return a ? [key].concat(sameHolder(S.accts, a).filter(x => !carrierFor(x.key)).map(x => x.key)) : [key]; }
async function setCarrier(key, val) {
  if (!key) return;
  if (val === '_new') { openModal(carrierFormHTML(null, key)); queueRender(); if (S.openKey) refreshDrawer(); return; }
  const keys = val ? tagKeysFor(key) : [key], c = val && S.book ? S.book.carriers.find(x => x.id === val) : null, ed = !val && carrierSrc(S.book, key, S.byKey.get(key)).edge;
  await bookChange(d => carrierTag(d, keys, val), { a: 'carrier', op: 'tag', n: keys.length }, val ? (c ? c.name : 'Carrier') + ' set' + (keys.length > 1 ? ' on ' + plural(keys.length, 'account') + ' (same policyholder)' : '') : ed ? 'Back to Edge’s carrier: ' + ed.name : 'Carrier taken off');
}
Object.assign(CHG, { carrierPick(t) { setCarrier(t.dataset.key || S.openKey, t.value); }, tagRow(t) { setCarrier(t.dataset.key, t.value); } });
Object.assign(ACT, {
  carrierNew() { openModal(carrierFormHTML(null, '')); },
  carrierEdit(t) { const c = S.book && S.book.carriers.find(x => x.id === t.dataset.id); if (c) openModal(carrierFormHTML(c, '')); },
  async carrierSave(t) {
    const v = id => (($('#' + id) || {}).value || '').trim(), edit = t.dataset.id || '', id = edit || 'c' + uid8(), tagKey = t.dataset.tag || '';
    const f = { id, name: v('carName'), phone: v('carPhone'), fax: v('carFax'), portal: v('carPortal'), payer: v('carPayer'), tf: v('carTf') ? Number(v('carTf')) : 0, notes: v('carNotes') };
    if (f.tf && !(Number.isInteger(f.tf) && f.tf > 0 && f.tf <= 1095)) { toast('Use whole days for the filing limit (up to 1095).', { bad: true }); return; }
    // check it first (a name, a real web address), so the form stays open with what was typed
    try { carrierSave(bookFix(JSON.parse(JSON.stringify(S.bookRaw || emptyBook()))), f, { by: meSid() }, Date.now()); } catch (e) { toast(errText(e), { bad: true }); return; }
    closeModal();
    const keys = tagKey ? tagKeysFor(tagKey) : [];
    await bookChange((d, now) => { carrierSave(d, f, { by: meSid() }, now); if (keys.length) carrierTag(d, keys, id); }, { a: 'carrier', op: edit ? 'edit' : 'add', name: f.name },
      (edit ? 'Saved ' : 'Added ') + f.name + (keys.length ? ' — set on ' + plural(keys.length, 'account') : ''));
  },
  async carrierDel(t) {
    const c = S.book && S.book.carriers.find(x => x.id === t.dataset.id); if (!c) return;
    const n = Object.keys(S.book.tags).filter(k => S.book.tags[k] === c.id).length, ne = Object.keys(S.book.etags).filter(k => { const v = S.book.etags[k]; return v.c === c.id || (v.m && v.m.some(x => x.c === c.id)); }).length;
    closeModal();
    const why = (n || ne ? 'It’s on ' + plural(n + ne, 'account') + (ne ? ' (' + ne + ' from Edge’s Insurance Aging)' : '') + '; they’ll have no carrier.' : 'No accounts have it.') +
      (c.edge && c.edge.length ? ' The next Insurance Aging adds it back — to fold it into another carrier, use Merge instead.' : '');
    if (!(await confirmBox('Remove ' + c.name + '?', why, 'Remove', true))) return;
    await bookChange(d => carrierRemove(d, c.id), { a: 'carrier', op: 'remove', name: c.name }, 'Removed ' + c.name);
  },
  async carrierMerge(t) {
    const from = S.book && S.book.carriers.find(x => x.id === t.dataset.id), into = S.book && S.book.carriers.find(x => x.id === (($('#carMergeInto') || {}).value || ''));
    if (!from) return; if (!into) { toast('Pick the carrier to merge it into.', { bad: true }); return; }
    const n = carrierStats(from).all.length;
    closeModal();
    if (!(await confirmBox('Merge ' + from.name + ' into ' + into.name + '?', (n ? 'Its ' + plural(n, 'account') + ' on the report move to ' + into.name + '. ' : '') + 'From now on Edge’s ' + (from.edge && from.edge.length ? from.edge.map(x => '“' + x + '”').join(', ') : 'name for it') + ' lands on ' + into.name + ', and ' + from.name + ' is removed.', 'Merge'))) return;
    await bookChange(d => carrierMerge(d, from.id, into.id), { a: 'carrier', op: 'merge', name: from.name, into: into.name }, 'Merged ' + from.name + ' into ' + into.name);
  },
  async carrierUseEdge(t) {
    const key = t.dataset.key, a = S.byKey.get(key), src = carrierSrc(S.book, key, a); if (!src.hand || !src.edge) return;
    await bookChange(d => carrierTag(d, [key], ''), { a: 'carrier', op: 'tag', n: 1 }, 'Back to Edge’s carrier: ' + src.edge.name);
  },
  async carrierUseEdgeAll() {
    const keys = S.accts.filter(a => a.ins && carrierSrc(S.book, a.key, a).differs).map(a => a.key); if (!keys.length) return;
    if (!(await confirmBox('Use Edge’s carrier on ' + plural(keys.length, 'account') + '?', 'The carriers set by hand on them are taken off, so each shows the carrier Edge’s Insurance Aging lists it under.', 'Use Edge’s'))) return;
    await bookChange(d => carrierTag(d, keys, ''), { a: 'carrier', op: 'tag', n: keys.length }, 'Edge’s carrier on ' + plural(keys.length, 'account'));
  },
  carrierCallAll(t) {
    const c = S.book && S.book.carriers.find(x => x.id === t.dataset.id); if (!c) return;
    const list = carrierStats(c).pd; if (!list.length) return;
    openModal('<h3>Called ' + esc(c.name) + '</h3><div class="lsub">Logs “Called the carrier” on ' + plural(list.length, 'account') + ' — ' + esc(list.slice(0, 8).map(a => a.patient).join(', ') + (list.length > 8 ? ' and ' + (list.length - 8) + ' more' : '')) + ' — each with a follow-up in two weeks.</div>' +
      '<div class="field"><label for="callNote">What did they say? (saved on each account)</label><input id="callNote" class="inp" autocomplete="off"></div>' +
      '<div class="mFt"><button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="carrierCallSave" data-id="' + esc(c.id) + '">Log it on ' + plural(list.length, 'account') + '</button></div>');
  },
  async carrierCallSave(t) {
    const c = S.book && S.book.carriers.find(x => x.id === t.dataset.id); if (!c) return;
    const note = (($('#callNote') || {}).value || '').trim(), list = carrierStats(c).pd, now = Date.now(), by = meSid(); closeModal();
    let n = 0; for (const a of list) if (await change(a.key, d => { applyLog(d, 'ins_call', { by, note: 'Called ' + c.name + (note ? ': ' + note : '') }, now); }, { a: 'log', k: 'ins_call' })) n++;
    toast('Logged the call on ' + plural(n, 'account'));
  },
  scrollUntagged() { const el = $('#untagged'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
/* the carrier on an insurance account's panel: pick it, call it, open its portal */
function carrierBoxHTML(a) {
  const src = carrierSrc(S.book, a.key, a), c = src.c, e = S.book && S.book.edge;
  let h = '<div class="carBox"><div class="carHd">' + ic('shield', 16) + '<b>Carrier</b>' + carrierSelect(a.key, src.c ? src : null, 'carrierPick') + '</div>';
  if (src.differs) h += '<div class="notice info carSrc" style="margin:10px 0 0">Set by hand. Edge’s Insurance Aging' + (e ? ' (' + esc(fmtDate(e.asOf)) + ')' : '') + ' has this account under <b>' + esc(src.edge.name) + '</b>. <button class="linkBtn" data-act="carrierUseEdge" data-key="' + esc(a.key) + '">Use Edge’s</button></div>';
  else if (c && !src.hand) h += '<div class="small muted carSrc">From Edge’s Insurance Aging' + (e ? ' of ' + esc(fmtDate(e.asOf)) : '') + '</div>';
  if (c) {
    const left = c.tf && a.days != null && a.pd > 0 ? c.tf - a.days : null;
    h += '<div class="carInfo">' + (telHref(c.phone) ? '<a class="btn btn-act btn-sm" href="' + esc(telHref(c.phone)) + '">' + ic('call', 15) + 'Call ' + esc(phoneTxt(c.phone)) + '</a>' : '') +
      (c.portal ? '<a class="btn btn-sec btn-sm" href="' + esc(c.portal) + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Portal</a>' : '') +
      (c.payer ? '<span class="small">Payer ID <b>' + esc(c.payer) + '</b> <button class="linkBtn" data-act="copyVal" data-v="' + esc(c.payer) + '">Copy</button></span>' : '') + (c.fax ? '<span class="small">Fax ' + esc(c.fax) + '</span>' : '') + '</div>' +
      (left != null && left <= 30 ? '<div class="notice ' + (left < 0 ? 'bad' : '') + '" style="margin:10px 0 0">' + esc(left >= 0 ? c.name + '’s timely-filing limit (' + c.tf + ' days) is ' + (left ? 'in ' + plural(left, 'day') : 'today') + '.' : 'Past ' + c.name + '’s timely-filing limit (' + c.tf + ' days) by ' + plural(-left, 'day') + '.') + '</div>' : '') +
      (c.notes ? '<div class="small muted carNotes">' + esc(c.notes) + '</div>' : '');
  } else if (S.book && S.book.carriers.length) h += '<div class="small muted">Set it once — brothers and sisters on the same policy get it too.' + (S.book.edge ? ' It wasn’t on the ' + esc(fmtDate(S.book.edge.asOf)) + ' Insurance Aging.' : ' Or drop Edge’s Insurance Aging on Reports to fill in every account’s.') + '</div>';
  return h + '</div>';
}

/* =====================================================================
   Edge's Insurance Aging, imported (6 Oct 2026): read on this computer,
   it gives each insurance account its carrier (and each carrier Edge's
   phone number). Only that is kept — sealed in the carrier book; the
   file isn't. A carrier set by hand is never changed.
   ===================================================================== */
function iaStepsHTML(open) {
  return '<details class="help"' + (open ? ' open' : '') + '><summary>How to export the Insurance Aging from Edge</summary><ol class="steps small">' +
    '<li>In Edge: <b>Home</b> → <b>Reporting</b>, type <b>Insurance</b> in the search box at the top and open the insurance aging report (it prints as “Insurance Accounts Receivable Aging”).</li>' +
    '<li>Leave the date on <b>Today</b>, tick <b>Exclude Zero Dollar Balances</b>, <b>Subgroup: None</b> — then <b>View</b>.</li>' +
    '<li><b>Export ▾</b> → <b>Excel</b>, drop the file on Reports (or here), then delete it from Downloads.</li></ol>' +
    '<p class="small muted">Run it the same day as the A/R Aging, so every account on the lists is on it.</p></details>';
}
async function iaReadFiles(files) {
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) { toast('That file is too big to be the Insurance Aging.', { bad: true }); continue; }
    try { insAgingPreview(await readInsAging(f.name, await f.arrayBuffer())); return; }
    catch (x) { toast(errText(x), { bad: true }); }
  }
}
function insAgingPreview(p) {
  const t = todayISO(), e = S.book && S.book.edge, plan = edgeCarriersPlan(S.bookRaw, p, S.accts, { by: meSid(), today: t }, Date.now()), notes = [];
  if (!p.asOf) notes.push(['bad', 'There’s no date in the file, so it’s saved as today’s.']);
  if (p.check.ok === false) notes.push(['bad', p.check.why + ' — check the whole report was exported.']);
  if (plan.older) notes.push(['info', 'A newer Insurance Aging (' + fmtDate(e.asOf) + ') was imported before: this one only fills in the accounts it didn’t have.']);
  if (S.rep && p.asOf && p.asOf !== S.rep.asOf) notes.push(['info', 'The lists show the ' + fmtDate(S.rep.asOf) + ' A/R report; this Insurance Aging is from ' + fmtDate(p.asOf) + '. Run both on the same day for the best match.']);
  if (plan.differ) notes.push(['info', plural(plan.differ, 'account') + ' set by hand ' + (plan.differ === 1 ? 'is' : 'are') + ' under another carrier in Edge — kept as set; Insurance → Carriers lists ' + (plan.differ === 1 ? 'it' : 'them') + ' to check.']);
  if (plan.twice) notes.push(['info', plural(plan.twice, 'patient') + ' ' + (plan.twice === 1 ? 'has' : 'have') + ' two insurance contracts under the same policyholder with different carriers — each is matched by its balance.']);
  if (plan.full) notes.push(['bad', 'The carrier list is full (200) — some of Edge’s carriers weren’t added.']);
  if (!S.rep) notes.push(['info', 'No A/R report yet — the carriers are ready for the accounts when the first one comes in.']);
  // Edge's carrier lines, the same name put together (as they'll be in the list)
  const gm = new Map(); (p.groups || []).forEach(g => { const k = edgeName(g.name); if (!k) return; const x = gm.get(k) || { name: g.name, phones: [], n: 0 }; if (g.phone && !x.phones.includes(g.phone)) x.phones.push(g.phone); x.n += g.n; gm.set(k, x); });
  const groups = Array.from(gm.values()).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
  S.iaImp = { p };
  openModal('<h3>Insurance Aging · ' + esc(fmtDateLong(p.asOf || t)) + '</h3>' +
    '<div class="lsub">Read on this computer. Only which carrier each insurance account is with (and Edge’s phone number for each carrier) is kept, sealed — not the file. A carrier set by hand is never changed.</div>' +
    '<div class="prevGrid">' + obStat(p.rows.length, 'insurance accounts in Edge') + obStat(plan.carriers, 'carriers' + (plan.added.length ? ' · ' + plan.added.length + ' new' : '')) +
      (S.rep ? obStat(plan.got + ' of ' + plan.ins, 'insurance accounts on the ' + fmtDate(S.rep.asOf) + ' A/R report with a carrier · ' + plan.newly + ' getting one now') : obStat(plan.accounts, 'accounts with a carrier')) + '</div>' +
    (p.check.ok ? '<div class="chk ok">' + ic('done', 14) + esc(p.check.why) + '</div>' : '') +
    notes.map(([k, n]) => '<div class="notice ' + k + '" style="margin-top:8px">' + esc(n) + '</div>').join('') +
    '<details class="help"><summary>Edge’s carriers (' + groups.length + ')</summary><div class="iaGroups">' + groups.map(g => '<div class="carRow"><b>' + esc(g.name) + '</b><span class="small muted">' + esc(g.phones.length ? g.phones.map(phoneTxt).join(' or ') : 'no phone in Edge') + ' · ' + plural(g.n, 'account') + '</span></div>').join('') + '</div></details>' +
    '<div class="mFt" style="margin-top:14px"><button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn btn-teal" data-act="iaSave" id="iaSave">' + ic('lock', 15) + 'Save the carriers (sealed)</button></div>');
}
Object.assign(ACT, {
  iaPick() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.xls,.xlsx,.csv,.txt,.htm,.html'; i.className = 'hidden';
    i.onchange = () => { const fs = Array.from(i.files || []); i.remove(); if (fs.length) iaReadFiles(fs); };
    document.body.appendChild(i); i.click();
  },
  async iaSave() {
    const I = S.iaImp; if (!I) return; const btn = $('#iaSave'); busyBtn(btn, true, 'Sealing and saving…');
    const ids = {}, o = { by: meSid(), today: todayISO(), idFor: n => ids[n] || (ids[n] = 'c' + uid8()) }; // the same new ids both times bookChange runs it
    let res = null;
    const ok = await bookChange((d, now) => { res = edgeCarriersApply(d, I.p, o, now); }, { a: 'carrier', op: 'edge', asOf: I.p.asOf || '', n: I.p.rows.length },
      'Carriers saved from Edge’s Insurance Aging of ' + fmtDate(I.p.asOf || todayISO()));
    if (!ok) { busyBtn(btn, false); return; }
    S.iaImp = null; closeModal();
    // on to the carriers — unless an A/R report dropped in with it is still waiting on Reports to be saved
    if (!(S.view === 'reports' && S.imp && S.imp.files && S.imp.files.length)) { S.view = 'ins'; S.tab.ins = 'carriers'; renderNav(); renderView(); window.scrollTo(0, 0); }
  }
});

/* =====================================================================
   Edge's task list, imported (8 Oct 2026): each of the FC's Edge tasks
   goes on its account as an "Edge task" entry — its due date fills an
   empty follow-up, "AA MADE" an empty stage (payment plan), the task's
   operator an empty "assigned to". A preview first: what's ready, what
   to check (a name a letter off, the other kind of account, two that
   fit), what isn't on the A/R report. Nothing set in A/R changes, and
   importing the list again adds nothing twice.
   ===================================================================== */
/* the person the tasks belong to (their operator in Edge, e.g. "Riley"), if exactly one person with A/R goes by that name */
function etAssignee(ops) {
  if (!ops || ops.length !== 1) return '';
  const n = String(ops[0]).trim().toLowerCase(); if (!n) return '';
  const hits = arPeople().filter(r => { const nm = String(r.name || '').trim().toLowerCase(); return nm === n || nm.split(/\s+/)[0] === n; });
  return hits.length === 1 ? hits[0].sid : '';
}
const ET_SPREAD_DAYS = 10; // a long overdue list: its follow-ups spread over the next two weeks
function edgeTasksPreview(p) {
  const sid = etAssignee(p.ops), t = todayISO(), late = p.tasks.filter(x => x.due && x.due < t).length;
  S.etImp = { p, picks: {}, sid, o: { overdue: late > ET_SPREAD_DAYS ? 'spread' : 'today', aa: true, assign: sid }, busy: '' };
  openModal('<div id="etBox">' + etBoxHTML() + '</div>');
}
/* the plan for the preview; each task's match is worked out once (again only if the accounts change — a new report) */
function etPlan() {
  const I = S.etImp, accts = S.rep ? S.accts : [];
  if (!I.mm || I.mmFor !== accts) { const ix = nameIndex(accts); I.mm = I.p.tasks.map(t => taskMatch(accts, t, ix)); I.mmFor = accts; }
  return edgeTasksPlan(accts, k => itemFor(k), I.p.tasks, I.picks, I.mm);
}
/* each account's day when the overdue follow-ups are spread (only accounts whose follow-up is empty — or that will be reopened) */
function etSpread(plan) {
  const groups = Array.from(plan.by.values()).filter(g => { const it = itemFor(g.a.key); return !(it && !isBack(it) && (it.follow || it.state === 'done')); });
  return spreadFollow(groups, todayISO(), ET_SPREAD_DAYS);
}
function etBoxHTML() {
  const I = S.etImp; if (!I) return '';
  const p = I.p, plan = etPlan(), t = todayISO(), R = plan.rows, rep = S.rep ? fmtDate(S.rep.asOf) + ' ' : '';
  const ready = R.filter(r => r.a && !r.dupe), check = R.filter(r => (r.m.how === 'close' || r.m.how === 'two') && !r.dupe), none = R.filter(r => r.m.how === 'none'), dupes = R.filter(r => r.dupe);
  const nAcc = plan.by.size, overdue = p.tasks.filter(x => x.due && x.due < t).length, aa = ready.filter(r => taskIsAA(r.t.title)).length, nClose = check.filter(r => r.m.how === 'close').length;
  const when = d => (d ? fmtDate(d) : 'no date'), carr = a => { const c = a.ins ? carrierFor(a.key) : null; return c && c.name ? ' (' + c.name + ')' : ''; };
  const kindOf = a => (a.ins ? 'insurance' + carr(a) : a.credit > 0 && !(a.pd > 0) ? 'credit' : 'patient');
  const acctTxt = a => esc(a.patient) + ' <span class="muted">· ' + esc(rpName(a) || '—') + ' · ' + esc(kindOf(a)) + (a.pd > 0 ? ' · ' + money(a.pd) + ' past due' : a.credit > 0 ? ' · ' + money(a.credit) + ' credit' : '') + '</span>';
  let h = '<h3>' + esc(p.ops && p.ops.length ? p.ops.join(', ') + '’s' : 'Edge') + ' Edge tasks · ' + plural(p.tasks.length, 'task') + '</h3>' +
    '<div class="lsub">Read on this computer. Each task goes on its account as an “Edge task” note, sealed, and its due date fills an empty follow-up. Nothing already set in A/R changes, and importing the list again adds nothing twice.</div>' +
    '<div class="prevGrid">' + obStat(ready.length, 'ready, on ' + plural(nAcc, 'account')) + obStat(check.length, 'to check — tick the right ones') + obStat(none.length, 'not on the ' + rep + 'A/R report') + (dupes.length ? obStat(dupes.length, 'added before') : '') + '</div>' +
    (p.check.ok ? '<div class="chk ok">' + ic('done', 14) + esc(p.check.why) + '</div>' : '<div class="notice bad">' + esc(p.check.why) + '</div>') +
    (!S.rep ? '<div class="notice info" style="margin-top:8px">No A/R report yet — import this week’s A/R Aging first, so the tasks have accounts to go on.</div>' :
      S.imp && S.imp.files && S.imp.files.some(f => !f.err) ? '<div class="notice info" style="margin-top:8px">A new A/R report is waiting on Reports. These tasks are matched to the ' + esc(rep) + 'report — save the new one first, then drop the task list again, to match them to it.</div>' : '');
  const nSp = Object.keys(etSpread(plan)).length, perDay = Math.max(1, Math.ceil(nSp / ET_SPREAD_DAYS)), opt = (v, txt) => '<option value="' + v + '"' + (I.o.overdue === v ? ' selected' : '') + '>' + esc(txt) + '</option>';
  h += '<div class="etOpts">' + (overdue ? '<div><label for="etOverdue" style="display:block;margin-bottom:4px">' + plural(overdue, 'task is', 'tasks are') + ' overdue in Edge. Their follow-up:</label>' +
    '<select id="etOverdue" class="inp" data-chg="etOpt">' + opt('today', (nextOfficeDay(t) === t ? 'Today' : 'The next office day') + ' (' + fmtDay(nextOfficeDay(t)) + ') — all of them') +
    opt('spread', 'Spread over the next 2 weeks, oldest first (about ' + plural(perDay, 'account') + ' a day)') + opt('edge', 'Keep Edge’s dates (they show as late)') + '</select></div>' : '') +
    (aa ? '<label><input type="checkbox" id="etAA" data-chg="etOpt"' + (I.o.aa ? ' checked' : '') + '><span>“AA MADE” (' + aa + '): mark the account as on a payment plan — that pauses its collections ladder (only where no stage is set yet)</span></label>' : '') +
    (I.sid ? '<label><input type="checkbox" id="etAssign" data-chg="etOpt"' + (I.o.assign ? ' checked' : '') + '><span>Assign the accounts to ' + esc(shortName(I.sid)) + ' (only ones nobody has)</span></label>' : '') + '</div>';
  if (check.length) h += '<details class="help" open><summary>Check these (' + check.length + ') — tick the ones that are right</summary><div class="etList">' + check.map(r => {
    const i = r.i, has = Object.prototype.hasOwnProperty.call(I.picks, i), picked = has ? I.picks[i] : '';
    if (r.m.how === 'two') return '<div class="etRow"><div class="grow"><div class="etT">' + esc(r.t.title) + '</div><div class="small muted">Due ' + esc(when(r.t.due)) + ' · ' + esc(r.m.why) + '</div>' +
      '<select class="inp" data-chg="etPick" data-i="' + i + '" aria-label="Which account" style="margin-top:4px"><option value="">Skip it</option>' + r.m.cands.map(a => '<option value="' + esc(a.key) + '"' + (picked === a.key ? ' selected' : '') + '>' + esc(a.patient + ' · ' + (rpName(a) || '—') + ' · ' + kindOf(a) + (a.pd > 0 ? ' · ' + money(a.pd) + ' past due' : a.credit > 0 ? ' · ' + money(a.credit) + ' credit' : '')) + '</option>').join('') + '</select></div></div>';
    return '<label class="etRow"><input type="checkbox" data-chg="etPick" data-i="' + i + '" data-key="' + esc(r.m.a.key) + '"' + (picked ? ' checked' : '') + '><span class="grow"><span class="etT">' + esc(r.t.title) + '</span><br><span class="small etA">→ ' + acctTxt(r.m.a) + '</span><br><span class="small muted">Due ' + esc(when(r.t.due)) + ' · ' + esc(r.m.why) + '</span></span></label>';
  }).join('') + '</div>' + (nClose > 1 ? '<div class="btnRow" style="margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="etTickAll">Tick all ' + nClose + '</button></div>' : '') + '</details>';
  if (none.length) h += '<details class="help"><summary>Not on the A/R report (' + none.length + ') — nothing is added for these</summary><div class="small muted" style="margin:4px 0 6px">Their account isn’t past due or in credit on the ' + rep + 'report, or the name in the task isn’t on it. Keep them in Edge, or import the list again after a newer report.</div><div class="etList">' +
    none.map(r => '<div class="etRow"><div class="grow"><div class="etT">' + esc(r.t.title) + '</div><div class="small muted">Due ' + esc(when(r.t.due)) + '</div></div></div>').join('') + '</div></details>';
  if (ready.length) h += '<details class="help"><summary>Ready: ' + plural(ready.length, 'task') + ' on ' + plural(nAcc, 'account') + '</summary><div class="etList">' + Array.from(plan.by.values()).map(g => '<div class="etRow"><div class="grow"><div class="etA">' + acctTxt(g.a) + '</div>' +
    g.tasks.map(x => '<div class="small muted">• ' + esc(x.title) + ' (due ' + esc(when(x.due)) + ')</div>').join('') + '</div></div>').join('') + '</div></details>';
  if (dupes.length) h += '<div class="small muted" style="margin-top:6px">' + plural(dupes.length, 'task was', 'tasks were') + ' added before — skipped.</div>';
  return h + '<div class="mFt" style="margin-top:14px"><button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn btn-teal" data-act="etSave" id="etSave"' + (ready.length && !I.busy ? '' : ' disabled') + '>' + ic('lock', 15) +
    '<span>' + esc(I.busy || 'Add ' + plural(ready.length, 'task') + ' to ' + plural(nAcc, 'account') + ' (sealed)') + '</span></button></div>';
}
/* redraw the preview, keeping which lists are open and where it's scrolled */
function refreshET() {
  const box = $('#etBox'); if (!box) return;
  const w = $('#modalWrap'), top = w ? w.scrollTop : 0, open = $$('details', box).map(d => d.open);
  box.innerHTML = etBoxHTML(); $$('details', box).forEach((d, i) => { if (open[i] != null) d.open = open[i]; }); if (w) w.scrollTop = top;
}
Object.assign(CHG, {
  etOpt() { const I = S.etImp; if (!I) return; const ov = $('#etOverdue'), aa = $('#etAA'), as = $('#etAssign'); if (ov) I.o.overdue = ov.value === 'edge' || ov.value === 'spread' ? ov.value : 'today'; if (aa) I.o.aa = aa.checked; if (as) I.o.assign = as.checked ? I.sid : ''; refreshET(); },
  etPick(t) { const I = S.etImp; if (!I) return; I.picks[Number(t.dataset.i)] = t.type === 'checkbox' ? (t.checked ? t.dataset.key || '' : '') : t.value; refreshET(); }
});
Object.assign(ACT, {
  etTickAll() { const I = S.etImp; if (!I) return; etPlan().rows.forEach(r => { if (r.m.how === 'close') I.picks[r.i] = r.m.a.key; }); refreshET(); },
  async etSave() {
    const I = S.etImp; if (!I || I.busy) return;
    const plan = etPlan(), groups = Array.from(plan.by.values()); if (!groups.length) return;
    const o = Object.assign({ by: meSid(), today: todayISO() }, I.o), total = groups.length, sp = o.overdue === 'spread' ? etSpread(plan) : {};
    let done = 0, okN = 0, added = 0;
    const busy = s => { I.busy = s; const b = $('#etSave'); if (b) { b.disabled = true; const sp = $('span', b); if (sp) sp.textContent = s; } };
    busy('Adding… 0 of ' + plural(total, 'account'));
    // a few accounts at a time: each is its own sealed save, with its history
    for (let i = 0; i < groups.length; i += 3) {
      await Promise.all(groups.slice(i, i + 3).map(async g => {
        const now = Date.now(), og = Object.assign({}, o, { spreadOn: sp[g.a.key] || '' }), r = await change(g.a.key, d => { edgeTasksApply(d, g.tasks, og, now); }, { a: 'edgetask', n: g.tasks.length });
        done++; if (r) { okN++; added += g.tasks.length; } busy('Adding… ' + done + ' of ' + plural(total, 'account'));
      }));
    }
    S.etImp = null; closeModal();
    toast('Added ' + plural(added, 'task') + ' to ' + plural(okN, 'account') + (okN < total ? ' — ' + (total - okN) + ' couldn’t be saved; import the list again to add them' : ''), okN < total ? { bad: true, ms: 9000 } : { ms: 6000 });
    // on to Today (the follow-ups) — unless an A/R report dropped in with it is still waiting on Reports to be saved
    if (!(S.view === 'reports' && S.imp && S.imp.files && S.imp.files.length)) { S.view = 'today'; renderNav(); renderView(); window.scrollTo(0, 0); } else renderView();
  }
});

/* =====================================================================
   Trends (6 Oct 2026): week over week, the pace to the goals, who did
   what — and a weekly brief from AISA, written from the totals only
   ===================================================================== */
function sumOf(id) { const r = S.reports.find(x => x.id === id); return r && r.sum; }
function kpiSeries(which) {
  const from30 = S.cfg.kpiFrom > 1, byDay = new Map();
  S.reports.filter(r => r.sum && r.sum.kp && r.sum.kp.ptOf).slice().sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : (a.at || 0) - (b.at || 0))).forEach(r => byDay.set(r.asOf, r));
  return Array.from(byDay.values()).map(r => ({ asOf: r.asOf, rate: which === 'pt' ? (from30 ? r.sum.kp.ptPd30 : r.sum.kp.ptPd) / r.sum.kp.ptOf : r.sum.kp.insOf ? r.sum.kp.insLate / r.sum.kp.insOf : null })).filter(p => p.rate != null);
}
function paceText(p, goal) {
  const pc = x => (x * 100).toFixed(1).replace(/\.0$/, '') + '%', pts = x => Math.abs(x * 100).toFixed(1) + ' points';
  if (!p) return 'needs 3 weekly reports';
  if (p.met) return 'at or under ' + pc(goal) + ' — keep it there';
  if (p.dir === 'up') return 'moving away from ' + pc(goal) + ' (up ' + pts(p.slope) + ' a week)';
  if (p.dir === 'flat') return 'flat — not getting closer to ' + pc(goal);
  return p.weeks > 104 ? 'down ' + pts(p.slope) + ' a week — more than two years to ' + pc(goal) + ' at this pace' : 'under ' + pc(goal) + ' around ' + fmtDate(p.date) + ' at this pace (down ' + pts(p.slope) + ' a week)';
}
/* what each person logged in the last 7 days */
const ACT_KIND = { pt_vm: 'calls', pt_noans: 'calls', pt_spoke: 'calls', pt_text: 'texts', pt_email: 'letters', pt_letter: 'letters', done: 'done' };
function weekActivity() {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); const t0 = d.getTime(), by = new Map();
  const one = sid => { if (!by.has(sid)) by.set(sid, { sid, calls: 0, texts: 0, letters: 0, ins: 0, done: 0, all: 0 }); return by.get(sid); };
  S.items.forEach(it => {
    if (it.locked) return;
    (it.log || []).forEach(e => {
      if ((e.at || 0) < t0 || !e.by || e.k === 'reopen' || e.k === 'edgetask') return; // an imported Edge task isn't work done this week
      const r = one(e.by); r.all++;
      if (e.k === 'ladder' && own(LAD_BY, e.step)) { const s = LAD_BY[e.step]; if (s.n) r.letters++; else r.texts++; if (s.call) r.calls++; if (s.id === 'c75') r.texts++; }
      else if (/^ins_/.test(e.k)) r.ins++;
      else if (ACT_KIND[e.k]) r[ACT_KIND[e.k]]++;
    });
  });
  return Array.from(by.values()).sort((x, y) => y.all - x.all);
}
function trendsCardHTML() {
  const F = S.rep && S.prev ? flowOf(S.rep, S.prev, S.cfg) : null, k = S.rep ? kpis(S.rep, S.cfg) : null;
  let h = '<div class="card trendsCard" style="margin-bottom:18px"><div class="cardHd"><h3>Trends</h3><span class="sub">' + (F ? 'Week over week · ' + esc(fmtDate(F.from)) + ' → ' + esc(fmtDate(F.to)) : 'Week over week') + '</span></div><div class="cardBd">';
  if (!F) h += '<div class="small muted">Shows up with the second report: what got current, what’s newly past due, what slid into an older bucket.</div>';
  else {
    const cs = sumOf(S.repId), ps = sumOf(S.prevId), net = cs && ps ? round2(cs.pd - ps.pd) : null;
    const st = (n, l, s, cls) => '<div class="tStat ' + (cls || '') + '"><b>' + n + '</b><span>' + l + '</span>' + (s ? '<i>' + s + '</i>' : '') + '</div>';
    h += '<div class="tStats">' + st(F.cured, 'got current', money(F.curedAmt), 'ok') + st(F.newN, 'newly past due', money(F.newAmt), F.newN > F.cured ? 'bad' : '') +
      st(F.rolled, 'slid to an older bucket', F.into91 ? F.into91 + ' into 91+' : '', F.rolled ? 'bad' : '') + st(F.better, 'got better', 'a younger bucket') +
      st(money(F.cleared), 'of past due went away', 'paid or adjusted', 'ok') + (net != null ? st((net > 0 ? '+' : net < 0 ? '−' : '') + money(Math.abs(net)), 'change in past due', 'every account', net > 0 ? 'bad' : 'ok') : '') + '</div>';
  }
  if (k) h += '<div class="kvRow"><span>Patient goal (' + (k.pt.goal * 100).toFixed(1).replace(/\.0$/, '') + '%) · now ' + (k.pt.rate * 100).toFixed(1) + '%</span><b>' + esc(paceText(paceTo(kpiSeries('pt'), k.pt.goal), k.pt.goal)) + '</b></div>' +
    (k.ins ? '<div class="kvRow"><span>Insurance goal (' + (k.ins.goal * 100).toFixed(1).replace(/\.0$/, '') + '%) · now ' + (k.ins.rate * 100).toFixed(1) + '%</span><b>' + esc(paceText(paceTo(kpiSeries('ins'), k.ins.goal), k.ins.goal)) + '</b></div>' : '');
  const W = weekActivity();
  h += '<h4 class="tH">Who did what · last 7 days</h4>' + (W.length ? '<div class="tblWrap"><table class="tbl actTbl"><thead><tr><th>Person</th><th class="num">Calls</th><th class="num">Texts</th><th class="num">Letters &amp; emails</th><th class="num">Insurance</th><th class="num">Resolved</th><th class="num">Everything</th></tr></thead><tbody>' +
    W.map(r => '<tr><td>' + esc(staffName(r.sid, r.sid)) + '</td><td class="num">' + r.calls + '</td><td class="num">' + r.texts + '</td><td class="num">' + r.letters + '</td><td class="num">' + r.ins + '</td><td class="num">' + r.done + '</td><td class="num"><b>' + r.all + '</b></td></tr>').join('') + '</tbody></table></div>'
    : '<div class="small muted">Nothing logged in the last 7 days.</div>');
  h += '<h4 class="tH">This week’s brief</h4><div class="briefBox" id="briefBox">' + briefHTML() + '</div>';
  return h + '</div></div>';
}
function briefHTML() {
  const b = S.brief && S.brief.rep === S.repId ? S.brief : null;
  if (b && b.loading) return '<div class="small muted">AISA is reading this week’s numbers…</div>';
  if (b && b.text) return '<div class="briefTxt">' + mdLite(b.text) + '</div><div class="small muted" style="margin-top:8px">Written by AISA from the totals on this page — no names or accounts were sent · ' + esc(fmtWhen(b.at)) + '. Check it before acting on it.</div>' +
    '<div class="btnRow" style="margin-top:8px"><button class="btn btn-ghost" data-act="briefCopy">' + ic('copy', 15) + 'Copy</button><button class="btn btn-ghost" data-act="brief">' + ic('refresh', 15) + 'Write it again</button></div>';
  return '<button class="btn btn-sec btn-sm" data-act="brief">' + ic('note', 15) + 'Write this week’s brief (AI)</button>' + (b && b.err ? '<div class="small" style="color:var(--coral-700);margin-top:6px">' + esc(b.err) + '</div>' : '') +
    '<div class="small muted" style="margin-top:6px">AISA reads only the totals on this page — no names, no accounts — and says what to focus on, from the handbook.</div>';
}
/* **bold**, numbered and bulleted lines, short headings — everything else is plain text */
function mdLite(t) {
  const lines = String(t || '').replace(/\r/g, '').split('\n'); let h = '', list = '';
  const inl = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const close = () => { if (list) { h += '</' + list + '>'; list = ''; } };
  lines.forEach(l => {
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(l), ul = /^\s*[-*•]\s+(.*)$/.exec(l), hd = /^\s*#{1,4}\s+(.*)$/.exec(l);
    if (ol || ul) { const want = ol ? 'ol' : 'ul'; if (list !== want) { close(); h += '<' + want + '>'; list = want; } h += '<li>' + inl((ol || ul)[1]) + '</li>'; return; }
    close();
    if (hd) h += '<p><b>' + inl(hd[1]) + '</b></p>'; else if (l.trim()) h += '<p>' + inl(l.trim()) + '</p>';
  });
  close(); return h;
}
/* the numbers AISA gets: totals and counts only — never a patient's name or account */
function briefFacts() {
  const s = summarize(S.rep, S.cfg), k = kpis(S.rep, S.cfg), F = S.prev ? flowOf(S.rep, S.prev, S.cfg) : null, c = counts(), pc = x => (x * 100).toFixed(1) + '%', L = [];
  L.push('A/R aging report of ' + fmtDateLong(S.rep.asOf) + (S.prev ? ' (the one before it: ' + fmtDateLong(S.prev.asOf) + ')' : '') + '.');
  L.push('Past due: ' + money(s.pd.total) + ' across ' + s.pd.n + ' accounts (patients ' + money(s.pd.pt.total) + ', insurance ' + money(s.pd.ins.total) + '); 91+ days: ' + money(s.pd.b90) + ' (' + s.conc.n + ' accounts).');
  if (k) {
    const pp = paceTo(kpiSeries('pt'), k.pt.goal), pi = k.ins ? paceTo(kpiSeries('ins'), k.ins.goal) : null;
    L.push('Goals (handbook §19, no more than ' + pc(k.pt.goal) + ' each): patient accounts past due ' + pc(k.pt.rate) + ' (' + k.pt.n + ' of ' + k.pt.of + (k.pt.need ? '; ' + k.pt.need + ' to bring current to reach the goal' : '') + '; ' + paceText(pp, k.pt.goal) + ')' +
      (k.ins ? '; insurance past its ' + k.win + '-day window ' + pc(k.ins.rate) + ' (' + k.ins.n + ' of ' + k.ins.of + '; ' + paceText(pi, k.ins.goal) + ')' : '') + '.');
  }
  if (F) L.push('Since the report before: ' + F.cured + ' accounts got current (' + money(F.curedAmt) + '), ' + F.newN + ' newly past due (' + money(F.newAmt) + '), ' + F.rolled + ' slid to an older bucket (' + F.into91 + ' into 91+), ' + F.better + ' got better; ' + money(F.cleared) + ' of past due was paid or adjusted.');
  const LD = ladDueAccts(), by = new Map(); LD.forEach(a => { const st = ladFor(a).due; by.set(st.s, (by.get(st.s) || 0) + 1); });
  const held = S.accts.filter(a => { const l = ladFor(a); return l && l.hold; }).length;
  L.push('Collections ladder (handbook §14): ' + LD.length + ' steps due' + (by.size ? ' — ' + Array.from(by.entries()).map(([n, x]) => x + ' × ' + n).join(', ') : '') + '; ' + held + ' on Maintenance Hold.');
  const T = s.never.tiers;
  L.push('Insurance with nothing paid: ' + s.never.n + ' accounts, ' + money(s.never.pd) + ' (chase now ' + T.chase.n + ', investigate ' + T.investigate.n + ', probably never filed ' + T.nofile.n + ', monitor ' + T.monitor.n + ').');
  if (S.book && S.book.carriers.length) {
    const top = S.book.carriers.map(x => Object.assign({ c: x }, carrierStats(x))).filter(r => r.pd.length).sort((x, y) => y.pdAmt - x.pdAmt).slice(0, 5);
    if (top.length) L.push('Insurance carriers with the most past due: ' + top.map(r => r.c.name + ' ' + plural(r.pd.length, 'account') + ' ' + money(r.pdAmt) + (r.avg != null ? ', average ' + r.avg + ' days' : '') + (r.paid ? ', ' + r.paid + ' paid since last week' : '')).join('; ') + '.');
    const un = S.accts.filter(a => a.ins && a.pd > 0 && !carrierFor(a.key)).length; if (un) L.push(un + ' insurance accounts past due have no carrier set yet.');
  }
  L.push('Credit balances: ' + money(s.cr.total) + ' (' + s.cr.n + ' accounts); to resolve ' + money(s.cr.work.total) + ' (' + s.cr.work.n + '), ' + S.accts.filter(a => a.credit > 0 && !a.prepay && a.age != null && a.age > 1095).length + ' over 3 years old.');
  const Fd = focusData();
  L.push('Today: ' + Fd.U.length + ' urgent items and ' + Fd.T.length + ' others due; follow-ups due ' + c.due + ' (' + c.late + ' late); ' + c.drA + ' waiting for Dr. A.');
  const W = weekActivity(), tot = k2 => W.reduce((x, r) => x + r[k2], 0);
  L.push('Work logged in the last 7 days: ' + plural(tot('calls'), 'call') + ', ' + plural(tot('texts'), 'text') + ', ' + plural(tot('letters'), 'letter or email', 'letters and emails') + ', ' + plural(tot('ins'), 'insurance action') + ', ' + plural(tot('done'), 'account') + ' resolved.');
  return L.join('\n');
}
const AISA_URL = 'https://aisa-worker.akhavan-ak.workers.dev/ask';
Object.assign(ACT, {
  async brief() {
    if (!S.rep) return;
    const rep = S.repId, q = 'Write a short weekly A/R brief for Dr. Akhavan and the financial coordinator at Next Level Orthodontics. Use only the numbers below (there are no patient names). Start with 2–3 sentences: what changed since last week and whether we are on track for the delinquency goals. Then the 3 most important things to do this week, each tied to our collections, insurance or credit procedures. Under 180 words, plain language.\n\nNumbers:\n' + briefFacts();
    S.brief = { rep, loading: true }; const bx = $('#briefBox'); if (bx) bx.innerHTML = briefHTML();
    try {
      const r = await fetch(AISA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history: [] }) });
      if (!r.ok) throw errCode('aisa', 'AISA didn’t answer (' + r.status + '). Try again in a minute.');
      const j = await r.json(), text = j && typeof j.answer === 'string' ? j.answer.slice(0, 6000) : '';
      if (!text) throw errCode('aisa', 'AISA sent back nothing. Try again in a minute.');
      S.brief = { rep, text, at: Date.now() };
    } catch (e) { S.brief = { rep, err: e && e.code === 'aisa' ? e.message : 'Couldn’t reach AISA — check the internet connection and try again.' }; }
    const b2 = $('#briefBox'); if (b2) b2.innerHTML = briefHTML();
  },
  briefCopy() { const b = S.brief; if (!b || !b.text) return; copyText(b.text).then(ok => toast(ok ? 'Copied' : 'Couldn’t copy', ok ? {} : { bad: true })); }
});

/* =====================================================================
   The December credit audit (handbook §15) — Credits → December audit,
   and a line on Today from December 1 to March 31
   ===================================================================== */
function ageText(d) { return d < 60 ? plural(d, 'day') : d < 365 ? plural(Math.round(d / 30.4), 'month') : (Math.round(d / 36.5) / 10).toString().replace(/\.0$/, '') + ' years'; }
function auditData() {
  const t = todayISO(), w = auditWindow(t), cr = listCredits(S.accts), work = cr.filter(a => !a.prepay);
  const rows = work.map(a => { const it = itemFor(a.key); return Object.assign({ a }, auditOf(it && !isBack(it) ? it : null, w.start)); });
  return { w, rows, pre: cr.filter(a => a.prepay), rev: rows.filter(r => r.reviewed).length, refunds: rows.filter(r => r.refund && !r.done).length, days: daysBetween(t, w.end) };
}
function auditBannerHTML() {
  if (!S.rep || !S.rep.cover.credit) return '';
  const D = auditData(); if (!D.w.on || !D.rows.length) return '';
  return '<div class="staleBox audit" role="status">' + ic('wallet', 18) + '<span>December credit audit: ' + D.rev + ' of ' + D.rows.length + ' credits reviewed' + (D.refunds ? ' · ' + plural(D.refunds, 'refund') + ' to cut' : '') +
    ' · every refund out by ' + esc(dayLong(D.w.end)) + ' (' + plural(Math.max(0, D.days), 'day') + ').</span><button class="btn btn-sec btn-sm" data-act="nav" data-v="cr" data-tab="audit">Open the audit</button></div>';
}
function auditTabHTML() {
  const D = auditData(), pct = D.rows.length ? Math.round(D.rev / D.rows.length * 100) : 100, todo = D.rows.filter(r => !r.reviewed), done = D.rows.filter(r => r.reviewed);
  let h = '<div class="listHd">' + ic('wallet', 16) + '<span><b>December credit audit</b> (handbook §15): pull every credit balance in December; by March 31 every refund check is cut and sent, or the money is moved to the family’s balance or applied to another account. Refunds can go out a few at a time. Holding a credit for insurance or upcoming treatment is fine with a reason.</span></div>';
  h += D.w.on ? '<div class="fProg"><div class="fBar"><i style="width:' + pct + '%"></i></div><span><b>' + D.rev + '</b> of <b>' + D.rows.length + '</b> reviewed since ' + esc(fmtDate(D.w.start)) + (D.refunds ? ' · <b>' + D.refunds + '</b> ' + (D.refunds === 1 ? 'refund' : 'refunds') + ' to cut' : '') + ' · ' + plural(Math.max(0, D.days), 'day') + ' to ' + esc(fmtDate(D.w.end)) + '</span></div>'
    : '<div class="fProg"><span>The next audit starts <b>' + esc(fmtDateLong(D.w.start)) + '</b> and runs to ' + esc(fmtDate(D.w.end)) + '. Until then, this lists every credit to plan it.</span></div>';
  const row = r => { const a = r.a; return '<button class="row" data-act="open" data-key="' + esc(a.key) + '"><span class="aChk' + (r.reviewed ? ' on' : '') + '" aria-label="' + (r.reviewed ? 'Reviewed' : 'Not reviewed yet') + '">' + (r.reviewed ? ic('done', 14) : '') + '</span>' +
    '<span class="grow"><span class="pt">' + esc(a.patient) + '<span class="par"> · ' + (a.ins ? 'Ins: ' : '') + esc(rpName(a)) + '</span></span><span class="meta">' + esc((r.reviewed ? r.st : crAction(a).l) + (a.age != null ? ' · last paid ' + ageText(a.age) + ' before the report' : '')) + '</span></span><span class="small big">' + money(a.credit, true) + '</span></button>'; };
  const main = D.w.on ? todo : D.rows;
  h += '<div class="card"><div class="cardHd"><h3>' + (D.w.on ? 'Still to review' : 'Every credit') + '</h3><span class="sub">' + plural(main.length, 'account') + ' · ' + money(main.reduce((s, r) => s + r.a.credit, 0)) + '</span></div><div class="cardBd">' + (main.map(row).join('') || '<div class="empty">Every credit has been reviewed. ✓</div>') + '</div></div>';
  if (D.w.on && done.length) h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Reviewed</h3><span class="sub">' + plural(done.length, 'account') + '</span></div><div class="cardBd">' + done.map(row).join('') + '</div></div>';
  if (D.pre.length) h += '<p class="small muted" style="margin-top:10px">' + plural(D.pre.length, 'prepayment') + ' (Start Scheduled, ' + money(D.pre.reduce((s, a) => s + a.credit, 0)) + ') aren’t part of the audit — they’re for treatment that hasn’t started.</p>';
  return h;
}

/* =====================================================================
   OrthoBanc's failed-payment report (handbook §14, day 0): a reminder
   on the 5th, 12th, 19th and 26th until someone marks it checked
   ===================================================================== */
function obBannerHTML() {
  if (S.arState !== 'ok' || !S.reports.length) return '';
  const O = obState(S.book, todayISO(), obDays());
  if (O.due) {
    const late = O.due.due < todayISO();
    return '<div class="staleBox ob' + (late ? ' late' : '') + '" role="status">' + ic('mail', 18) + '<span>OrthoBanc’s failed-payment report for ' + esc(fmtDate(O.due.date)) + (late ? ' hasn’t been marked checked' : ' comes today') +
      ': open it, text each family on it right away (day 0 of the ladder), then mark it checked — or import its file here.' + (O.missed ? ' The ' + esc(fmtDate(O.missed.date)) + ' one wasn’t marked checked either.' : '') + '</span>' +
      '<span class="btnRow"><a class="btn btn-sec btn-sm" href="' + OB_URL + '" target="_blank" rel="noopener noreferrer">Open OrthoBanc</a><button class="btn btn-sec btn-sm" data-act="obPick">' + ic('import', 15) + 'Import its file</button><button class="btn btn-pri btn-sm" data-act="obCheck">Checked it</button></span></div>';
  }
  // the latest report's imported list, until every family on it is ticked
  const rep = O.cur ? obRepFor(O.cur.date) : null, P = rep ? obProgress(rep) : null;
  if (!P || !P.left) return '';
  return '<div class="staleBox ob" role="status">' + ic('mail', 18) + '<span>OrthoBanc, ' + esc(fmtDate(rep.day)) + ': ' + plural(P.n, 'failed payment') + (P.hold ? ' (' + P.hold + ' on HOLD)' : '') + ' — ' + (P.n - P.left) + ' of ' + P.n + ' texted.</span>' +
    '<span class="btnRow"><button class="btn btn-pri btn-sm" data-act="obList" data-day="' + esc(rep.day) + '">Open the list</button></span></div>';
}
Object.assign(ACT, {
  obCheck() {
    const O = obState(S.book, todayISO(), obDays()), c = O.due || O.cur; if (!c) return;
    const hist = ((S.book && S.book.ob) || []).slice(-6).reverse();
    openModal('<h3>OrthoBanc report · ' + esc(fmtDate(c.date)) + '</h3><div class="lsub">Handbook §14, day 0: text the responsible party on each failed payment right away, note it in the patient’s chart in Edge, and set a 2-week task. The next weekly report puts them on the ladder.</div>' +
      '<div class="btnRow" style="margin-bottom:12px"><a class="btn btn-sec btn-sm" href="' + OB_URL + '" target="_blank" rel="noopener noreferrer">' + ic('next', 15) + 'Open the report in OrthoBanc</a><button class="btn btn-sec btn-sm" data-act="obPick">' + ic('import', 15) + 'Or import its file</button></div>' +
      '<div class="grid2"><div class="field"><label for="obN">Failed payments on it</label><input id="obN" class="inp" type="number" min="0" max="500" step="1" inputmode="numeric" placeholder="e.g. 3"></div></div>' +
      '<div class="field"><label for="obNote">Note (optional)</label><input id="obNote" class="inp" autocomplete="off" placeholder="e.g. texted all three families"></div>' +
      (hist.length ? '<div class="small muted" style="margin:4px 0 8px"><b>Checked before:</b> ' + hist.map(x => esc(fmtDate(x.for)) + ' (' + esc(shortName(x.by)) + (x.n != null ? ', ' + plural(x.n, 'failed payment') : '') + ')').join(' · ') + '</div>' : '') +
      '<div class="mFt"><button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="obSave" data-for="' + esc(c.date) + '">Mark it checked</button></div>');
  },
  async obSave(t) {
    const n = (($('#obN') || {}).value || '').trim(), note = (($('#obNote') || {}).value || '').trim(), f = t.dataset.for;
    try { obCheck(bookFix(JSON.parse(JSON.stringify(S.bookRaw || emptyBook()))), { for: f, n, note }, Date.now()); } catch (e) { toast(errText(e), { bad: true }); return; }
    closeModal();
    await bookChange((d, now) => obCheck(d, { for: f, n, note, by: meSid() }, now), { a: 'obcheck', for: f, n: n === '' ? null : Number(n) }, 'OrthoBanc report for ' + fmtDate(f) + ' marked checked');
  }
});

/* ---------- OrthoBanc's report file, imported (optional) ----------
   Read on this computer, saved sealed (one record per report day), shown as a list to text and tick off.
   It never changes an account: no note, follow-up or ladder step — the FC's own records stay as she left them. */
async function obReadFiles(files) {
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { toast('That file is too big to be OrthoBanc’s report.', { bad: true }); continue; }
    try { obPreview(await readOBFailed(f.name, await f.arrayBuffer())); return; }
    catch (x) { toast(errText(x), { bad: true }); }
  }
}
function obStat(n, l) { return '<div><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
function obPreview(p) {
  const t = todayISO(), day = obDayOf(p.asOf || t), had = obRepFor(day), O = obState(S.book, t, obDays());
  const rows = p.rows.map(normOBRow), P = obProgress({ rows, done: {} }), matched = rows.filter(r => obMatch(S.accts, r)).length;
  const reps = Array.from(S.obReps.values()), before = rows.filter(r => obEarlier(reps, day, r).length).length, notes = [];
  if (!p.asOf) notes.push(['bad', 'There’s no date in the file, so it’s saved as the ' + fmtDate(day) + ' report.']);
  if (p.check.ok === false) notes.push(['bad', p.check.why]);
  if (O.cur && day < O.cur.date) notes.push(['info', 'This is the ' + fmtDate(day) + ' report — the latest one is ' + fmtDate(O.cur.date) + '. It’s kept for the history.']);
  if (had) notes.push(['info', 'The ' + fmtDate(day) + ' report was imported before (' + shortName(had.by) + ', ' + fmtWhen(had.at) + '). This replaces its list; the families already ticked stay ticked.']);
  if (before) notes.push(['info', plural(before, 'family', 'families') + ' failed on an earlier report too.']);
  S.obImp = { p, day };
  openModal('<h3>OrthoBanc failed payments · ' + esc(fmtDateLong(day)) + '</h3>' +
    '<div class="lsub">Read on this computer; saved sealed, like the A/R report. It doesn’t change any account — it’s a list to text each family from (day 0) and tick off.</div>' +
    '<div class="prevGrid">' + obStat(P.n, 'failed payments') + obStat(money(P.amt), 'not drafted') + obStat(P.hold, 'on HOLD — action needed') + obStat(matched + ' of ' + P.n, 'on the A/R report') + '</div>' +
    notes.map(([k, n]) => '<div class="notice ' + k + '" style="margin-top:8px">' + esc(n) + '</div>').join('') +
    '<div class="mFt" style="margin-top:14px"><button class="btn btn-ghost" data-act="closeModal">Cancel</button><button class="btn btn-teal" data-act="obSaveImp" id="obSaveImp">' + ic('lock', 15) + 'Save (sealed)</button></div>');
}
/* the list: on HOLD first (OrthoBanc stopped drafting), then the rest; the phone number when the account is on the A/R report */
function obListHTML(day) {
  const rep = obRepFor(day); if (!rep) return '<div class="empty">That report isn’t here any more.</div>';
  const P = obProgress(rep), reps = Array.from(S.obReps.values());
  const row = r => {
    const id = obRowId(r), d = rep.done[id], a = obMatch(S.accts, r), early = obEarlier(reps, rep.day, r), ph = a ? String(a.home || a.work || '').trim() : '';
    return '<div class="obRow' + (d ? ' done' : '') + '"><button class="obTick" data-act="obTick" data-day="' + esc(day) + '" data-id="' + esc(id) + '" aria-pressed="' + (d ? 'true' : 'false') + '" title="' + (d ? 'Texted — tap to untick' : 'Tick when texted') + '">' + (d ? ic('tick', 18) : '') + '</button>' +
      '<div class="grow"><div class="obWho"><b>' + esc(r.patient) + '</b>' + (r.acct ? '<span class="obAcct">Edge #' + esc(r.acct) + '</span>' : '') + (r.hold ? '<span class="obHold">HOLD</span>' : '') + '</div>' +
      '<div class="small">' + esc(r.rp) + (ph ? ' · <a href="tel:' + esc(ph.replace(/[^\d+]/g, '')) + '">' + esc(ph) + '</a>' : '') + '</div>' +
      '<div class="small muted">' + (r.amt != null ? money(r.amt, true) + ' · ' : '') + esc(r.reason || 'No reason given') + (r.date ? ' · drafted ' + esc(fmtDate(r.date)) : '') + (/online/i.test(r.how) ? ' (online payment)' : '') + '</div>' +
      (early.length ? '<div class="small obRep">Failed before: ' + early.slice(0, 4).map(x => esc(fmtDate(x))).join(', ') + '</div>' : '') +
      (d ? '<div class="small muted">Texted · ' + esc(shortName(d.by)) + ', ' + esc(fmtWhen(d.at)) + '</div>' : '') +
      (!a ? '<div class="small muted">Not on the ' + (S.rep ? esc(fmtDate(S.rep.asOf)) + ' ' : '') + 'A/R report — find them in Edge' + (r.acct ? ' by the account #' : '') + '</div>' : '') + '</div>' +
      (a ? '<button class="btn btn-ghost btn-sm" data-act="obOpen" data-key="' + esc(a.key) + '">Account ' + ic('next', 13) + '</button>' : '') + '</div>';
  };
  const hold = rep.rows.filter(r => r.hold), other = rep.rows.filter(r => !r.hold);
  return '<div class="obTop"><span><b>' + (P.n - P.left) + ' of ' + P.n + '</b> texted' + (P.amt ? ' · ' + money(P.amt) + ' not drafted' : '') + '</span>' + (P.left ? '<button class="btn btn-sec btn-sm" data-act="obTickAll" data-day="' + esc(day) + '">Mark all texted</button>' : '') + '</div>' +
    (hold.length ? '<div class="obGrp">On HOLD · OrthoBanc stopped drafting and asks the office to help · ' + hold.length + '</div>' + hold.map(row).join('') : '') +
    (other.length ? '<div class="obGrp">OrthoBanc is contacting them too · ' + other.length + '</div>' + other.map(row).join('') : '') +
    (rep.rows.length ? '' : '<div class="empty">No failed payments on this report. ✓</div>');
}
function refreshOBList() {
  const box = $('#obListBox'); if (!box) return;
  const w = $('#modalWrap'), top = w ? w.scrollTop : 0;
  box.innerHTML = obListHTML(box.dataset.day); if (w) w.scrollTop = top;
}
/* on the account panel: the latest failed draft (read-only; the account's own notes and steps stay hers) */
function obBoxHTML(a) {
  const hits = obIndex().get(a.key); if (!hits || !hits.length) return '';
  const h = hits[0], r = h.row;
  return '<div class="obBox"><div class="obBoxHd">' + ic('mail', 15) + '<b>OrthoBanc</b><span class="small muted">' + esc(fmtDate(h.day)) + ' report</span></div>' +
    '<div class="small">' + (r.amt != null ? money(r.amt, true) + ' ' : '') + 'draft failed' + (r.date ? ' ' + esc(fmtDate(r.date)) : '') + (r.reason ? ' — ' + esc(r.reason) : '') + (r.hold ? ' · <b>on HOLD</b> (OrthoBanc stopped drafting)' : '') + '</div>' +
    '<div class="small muted">' + (h.done ? 'Texted · ' + esc(shortName(h.done.by)) + ', ' + esc(fmtWhen(h.done.at)) : 'Not ticked as texted yet') + (hits.length > 1 ? ' · failed before: ' + hits.slice(1, 4).map(x => esc(fmtDate(x.day))).join(', ') : '') +
    ' · <button class="linkBtn" data-act="obList" data-day="' + esc(h.day) + '">The list</button></div></div>';
}
/* account key → its failed drafts on the reports of the last 120 days, newest first */
function obIndex() {
  if (S.obIdx && S.obIdx.v === S.obVer && S.obIdx.r === S.repId) return S.obIdx.m;
  const m = new Map(), since = addDays(todayISO(), -120);
  Array.from(S.obReps.values()).filter(r => r.day >= since).sort((x, y) => y.day.localeCompare(x.day)).forEach(rep => rep.rows.forEach(row => {
    const a = obMatch(S.accts, row); if (!a) return;
    if (!m.has(a.key)) m.set(a.key, []);
    m.get(a.key).push({ day: rep.day, row, done: rep.done[obRowId(row)] || null });
  }));
  S.obIdx = { v: S.obVer, r: S.repId, m }; return m;
}
Object.assign(ACT, {
  obPick() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.xls,.xlsx,.csv,.txt,.htm,.html'; i.className = 'hidden';
    i.onchange = () => { const fs = Array.from(i.files || []); i.remove(); if (fs.length) obReadFiles(fs); };
    document.body.appendChild(i); i.click();
  },
  async obSaveImp() {
    const I = S.obImp; if (!I) return; const btn = $('#obSaveImp'); busyBtn(btn, true, 'Sealing and saving…');
    const ok = await obChange(I.day, (d, now) => obImport(d, I.p, { day: I.day, by: meSid() }, now), { a: 'obimport', day: I.day, n: I.p.rows.length }, 'OrthoBanc’s ' + fmtDate(I.day) + ' report saved');
    if (!ok) { busyBtn(btn, false); return; }
    S.obImp = null; ACT.obList({ dataset: { day: I.day } });
  },
  obList(t) {
    const day = (t && t.dataset && t.dataset.day) || ''; if (!day || !obRepFor(day)) return;
    openModal('<h3>OrthoBanc failed payments · ' + esc(fmtDate(day)) + '</h3><div class="lsub">Day 0 (handbook §14): text the responsible party (Weave FC-Delinquent — never ask for $ in a text), note it in the patient’s chart in Edge, and set a 2-week Edge task. Tick each family here once it’s done — ticking changes nothing in the account.</div>' +
      '<div id="obListBox" data-day="' + esc(day) + '">' + obListHTML(day) + '</div><div class="mFt" style="margin-top:14px"><button class="btn btn-pri" data-act="closeModal">Done</button></div>');
  },
  async obTick(t) {
    const day = t.dataset.day, id = t.dataset.id, rep = obRepFor(day); if (!rep) return;
    const on = !rep.done[id];
    await obChange(day, (d, now) => obTick(d, [id], on, { by: meSid() }, now), { a: 'obtick', day, n: 1, on });
  },
  async obTickAll(t) {
    const day = t.dataset.day, rep = obRepFor(day); if (!rep) return;
    const ids = rep.rows.map(obRowId).filter(id => !rep.done[id]); if (!ids.length) return;
    await obChange(day, (d, now) => obTick(d, ids, true, { by: meSid() }, now), { a: 'obtick', day, n: ids.length, on: true }, plural(ids.length, 'family', 'families') + ' marked texted');
  },
  obOpen(t) { closeModal(); openDrawer(t.dataset.key); }
});
