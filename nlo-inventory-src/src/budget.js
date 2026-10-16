/* =====================================================================
   Budget — what supplies cost each month against the supply budget
   (invState/budget: monthly, per-category allocations; invExpenses: the
   expenses bought outside an order, each in the name of whoever added it).
   Spend comes from what was received (money.js), never from stock
   counts. Lab, Appliances & 3D Printing has its own budget and isn't
   counted here, as before.
   ===================================================================== */
function budgetSummaryCard(mk, sp, budget, compact) {
  const pct = budget ? sp.total / budget : 0, now = new Date(), isCur = mk === monthKey(now.getTime());
  const days = new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0).getDate(), dayN = isCur ? now.getDate() : days, pace = dayN / days;
  const proj = isCur && dayN > 3 ? sp.total / pace : null;
  const cls = pct > 1 ? 'over' : pct > pace + 0.1 ? 'warn' : '';
  const cats = Object.keys(Object.assign({}, sp.auto, sp.manual)).map(c => [c, (sp.auto[c] || 0) + (sp.manual[c] || 0)]).sort((a, b) => b[1] - a[1]);
  let h = '<div class="card"><div class="cardHd"><h3>' + (compact ? 'Supply spending · ' + esc(monthLabel(mk)) : 'Spent in ' + esc(monthLabel(mk, true))) + '</h3><span style="flex:1"></span>' + (compact ? '<button class="btn btn-ghost" data-act="nav" data-v="budget">Budget</button>' : '') + '</div><div class="cardBd"><div class="bud">' +
    '<div class="budTop"><span class="big">' + money(sp.total, { whole: sp.total >= 1000 }) + '</span><span class="of">' + (budget ? 'of ' + money(budget, { whole: true }) + ' · ' + (sp.total <= budget ? money(budget - sp.total, { whole: true }) + ' left' : money(sp.total - budget, { whole: true }) + ' over') : 'no monthly budget set') + '</span></div>';
  if (budget) h += '<div class="bar ' + cls + '"><i style="width:' + Math.min(100, pct * 100).toFixed(1) + '%"></i>' + (isCur ? '<span class="pace" style="left:' + (pace * 100).toFixed(1) + '%" title="Where an even pace would be today"></span>' : '') + '</div>';
  h += '<div class="muted small">' + [isCur ? 'Day ' + dayN + ' of ' + days : '', proj != null ? 'on pace for about ' + money(proj, { whole: true }) : '', sp.shipping ? 'shipping ' + money(sp.shipping) : '', sp.tax ? 'tax ' + money(sp.tax) : ''].filter(Boolean).join(' · ') + '</div>';
  if (cats.length) {
    h += '<div class="catBars">' + cats.slice(0, compact ? 5 : 20).map(([c, v]) => {
      const alloc = Number((S.D.budget.categories || {})[c]) || 0, p = alloc ? v / alloc : (sp.total ? v / sp.total : 0);
      return '<div class="cb"><span class="nm"><i style="background:' + catColor(c) + '"></i>' + esc(catLabel(c)) + '</span><span class="val">' + money(v, { whole: v >= 1000 }) + (alloc ? ' <small>of ' + money(alloc, { whole: true }) + '</small>' : '') + '</span>' +
        '<div class="bar sm ' + (alloc && v > alloc ? 'over' : '') + '"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%;' + (alloc ? '' : 'background:' + catColor(c)) + '"></i></div></div>';
    }).join('') + '</div>';
  } else h += '<div class="empty" style="padding:14px 0">Nothing received yet this month.</div>';
  h += '</div></div></div>';
  return h;
}
function budgetMonthly() { return Number(S.D.budget && S.D.budget.monthly) || 8000; }
function monthsBack(n) { const out = [], cur = monthKey(Date.now()); for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(cur, -i)); return out; }
VIEWS.budget = {
  actions() { return '<button class="btn btn-sec" data-act="budgetEdit">' + ic('edit', 16) + 'Budget amounts</button>'; },
  render() {
    const u = S.ui.budget || (S.ui.budget = { mk: monthKey(Date.now()) });
    const D = S.D, budget = budgetMonthly(), sp = monthSpend(u.mk, D);
    const covers = logCoversFrom(D.log);
    let h = '<div class="filters"><div class="seg"><button data-act="bMonth" data-n="-1" aria-label="Month before">' + ic('back', 16) + '</button><button aria-pressed="true" style="min-width:150px;justify-content:center">' + esc(monthLabel(u.mk, true)) + '</button><button data-act="bMonth" data-n="1" aria-label="Month after"' + (u.mk >= monthKey(Date.now()) ? ' disabled' : '') + '>' + ic('next', 16) + '</button></div>' +
      (u.mk !== monthKey(Date.now()) ? '<button class="btn btn-ghost" data-act="bMonth" data-n="0">This month</button>' : '') + '<span style="flex:1"></span><button class="btn btn-sec btn-sm" data-act="budgetCsv">' + ic('download', 15) + 'Year as CSV</button></div>';
    if (covers && u.mk < covers) h += '<div class="notice">The activity log only keeps the newest receipts, and ' + esc(monthLabel(u.mk, true)) + ' is older than what it still holds in full — this month may read low.</div>';
    h += '<div class="twoCol"><div>' + budgetSummaryCard(u.mk, sp, budget, false);
    /* expenses entered by hand */
    const ex = listOf(D.expenses).filter(x => x && monthKey(x.date) === u.mk).sort((a, b) => msOf(b.date) - msOf(a.date));
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Other supply expenses</h3><span class="sub">bought outside an order</span><span style="flex:1"></span><button class="btn btn-sec btn-sm" data-act="expenseAdd">' + ic('plus', 15) + 'Add</button></div><div class="cardBd">';
    h += ex.length ? ex.map(x => '<div class="row" style="cursor:default"><div class="grow"><span class="pt">' + esc(x.vendor || x.description || x.note || catLabel(x.category)) + ' <span class="muted" style="font-weight:600">· ' + esc(catLabel(x.category)) + '</span></span><span class="meta">' + esc(fmtDate(x.date)) + (x.note && x.vendor ? ' · ' + esc(x.note) : '') + (x.by || x.byId ? ' · added by ' + esc(stampName(x.by, x.byId)) : '') + '</span></div><b class="nowrap">' + money(x.amount) + '</b>' +
      (isAdmin() || isMine(x.byId) ? '<button class="iconBtn" data-act="expenseDel" data-id="' + esc(x.id) + '" aria-label="Remove">' + ic('trash', 16) + '</button>' : '') + '</div>').join('') : '<div class="empty">None this month. Use <b>Add</b> for supplies bought on a card at a store, for example.</div>';
    h += '</div></div></div><div>';
    /* 12 months */
    const ms = monthsBack(12), vals = ms.map(k => monthSpend(k, D).total), max = Math.max(budget, ...vals, 1);
    const full = vals.slice(0, -1).filter(v => v > 0), avg = full.length ? full.reduce((a, b) => a + b, 0) / full.length : 0;
    h += '<div class="card"><div class="cardHd"><h3>Last 12 months</h3><span class="sub">' + (avg ? 'average ' + money(avg, { whole: true }) + ' a month' : '') + '</span></div><div class="cardBd"><div class="months">' +
      ms.map((k, i) => '<button class="m' + (k === u.mk ? ' cur' : '') + (budget && vals[i] > budget ? ' over' : '') + '" data-act="bPick" data-mk="' + k + '" title="' + esc(monthLabel(k, true) + ': ' + money(vals[i])) + '"><b>' + (vals[i] ? moneyK(vals[i]) : '') + '</b><i style="height:' + Math.max(2, vals[i] / max * 100).toFixed(1) + '%"></i><span>' + esc(monthLabel(k)) + '</span></button>').join('') +
      '</div>' + (budget ? '<div class="muted small" style="margin-top:6px">Budget ' + money(budget, { whole: true }) + ' a month · months over it are red.</div>' : '') + '</div></div>';
    /* where it went: vendors this month */
    const byV = {}; D.orders.forEach(o => { if (o.status === 'received' && monthKey(o.dateReceived) === u.mk) byV[o.vendor || '—'] = (byV[o.vendor || '—'] || 0) + orderTotal(o); });
    const vs = Object.entries(byV).sort((a, b) => b[1] - a[1]);
    h += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>By vendor</h3><span class="sub">orders received in ' + esc(monthLabel(u.mk)) + '</span></div><div class="cardBd">' +
      (vs.length ? vs.map(([v, amt]) => '<div class="kvRow"><span class="gap8">' + vlogoHTML(vendorObj(v)) + esc(v) + '</span><b>' + money(amt) + '</b></div>').join('') : '<div class="empty">No orders received this month.</div>') + '</div></div>';
    h += '</div></div>' + priceWatchHTML();
    h += '</div></div>';
    return h;
  }
};
/* prices: what went up since the last orders, and what's cheaper at another vendor (per counted unit) */
function priceWatch() {
  const obs = {};
  S.D.orders.forEach(o => { if (o.status === 'voided') return; const t = msOf(o.orderedAt || o.dateOrdered); if (!t) return;
    o.items.forEach(l => { const p = parseFloat(l.price); if (!l.itemId || !(p > 0)) return; const per = linePer(l), k = l.itemId + '|' + (o.vendor || '—'); (obs[k] = obs[k] || []).push({ t, p: p / per }); }); });
  const up = [];
  Object.keys(obs).forEach(k => {
    const [id, v] = k.split('|'), it = itemById(id); if (!it || it.archived || it.deleted) return;
    const a = obs[k].sort((x, y) => x.t - y.t); if (a.length < 2) return;
    const last = a[a.length - 1].p, prior = a.slice(0, -1).map(x => x.p).sort((x, y) => x - y), med = prior[Math.floor(prior.length / 2)];
    const diff = last - med, pct = diff / med * 100;
    if (diff * perBuy(it) >= 0.5 && pct >= 8) up.push({ it, v, from: med, to: last, pct });
  });
  up.sort((a, b) => b.pct - a.pct);
  const cheap = [];
  activeItems().forEach(it => {
    const srcs = allSources(it).filter(s => s && s.vendor && countPrice(s) != null); if (srcs.length < 2) return;
    const pri = srcs[0], best = srcs.reduce((a, b) => countPrice(b) < countPrice(a) ? b : a, srcs[0]);
    const save = countPrice(pri) - countPrice(best);
    if (best !== pri && save * perBuy(it) >= 0.5 && save / countPrice(pri) * 100 >= 5) cheap.push({ it, from: pri, to: best, pct: save / countPrice(pri) * 100 });
  });
  cheap.sort((a, b) => b.pct - a.pct);
  return { up: up.slice(0, 8), cheap: cheap.slice(0, 8) };
}
function priceWatchHTML() {
  const w = priceWatch(); if (!w.up.length && !w.cheap.length) return '';
  const each = (it, p) => money(p * perBuy(it)) + '/' + esc(buyUnit(it));
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Prices</h3><span class="sub">from orders and saved prices</span></div><div class="cardBd">' +
    (w.up.length ? '<div class="subH" style="margin-top:0">Went up</div>' + w.up.map(x => '<div class="kvRow" data-act="openItem" data-id="' + esc(x.it.id) + '" style="cursor:pointer"><span>' + esc(x.it.name) + ' <span class="muted small">· ' + esc(x.v) + '</span></span><b><s class="muted" style="font-weight:600">' + each(x.it, x.from) + '</s> ' + each(x.it, x.to) + ' <span style="color:var(--coral-700)">+' + x.pct.toFixed(0) + '%</span></b></div>').join('') : '') +
    (w.cheap.length ? '<div class="subH">Cheaper at another vendor</div>' + w.cheap.map(x => '<div class="kvRow" data-act="openItem" data-id="' + esc(x.it.id) + '" style="cursor:pointer"><span>' + esc(x.it.name) + '</span><b><span class="muted" style="font-weight:600">' + esc(x.from.vendor) + ' ' + each(x.it, countPrice(x.from)) + '</span> → ' + esc(x.to.vendor) + ' ' + each(x.it, countPrice(x.to)) + ' <span style="color:var(--mint-700)">−' + x.pct.toFixed(0) + '%</span></b></div>').join('') + '<div class="hint">Check the package sizes match before switching.</div>' : '') +
    '</div></div>';
}
ACT.bMonth = t => { const u = S.ui.budget, n = Number(t.dataset.n); u.mk = n === 0 ? monthKey(Date.now()) : shiftMonth(u.mk, n); if (u.mk > monthKey(Date.now())) u.mk = monthKey(Date.now()); renderView(true); };
ACT.bPick = t => { S.ui.budget.mk = t.dataset.mk; renderView(true); };
ACT.budgetCsv = () => {
  const D = S.D, y = S.ui.budget.mk.slice(0, 4), rows = [['Month', 'Supplies received', 'Other expenses', 'Shipping', 'Tax', 'Total', 'Budget'].concat(CATEGORIES.filter(c => c.id !== 'lab-3d').map(c => c.label))];
  for (let m = 1; m <= 12; m++) {
    const k = y + '-' + String(m).padStart(2, '0'); if (k > monthKey(Date.now())) break;
    const sp = monthSpend(k, D), sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    rows.push([monthLabel(k, true), sum(sp.auto).toFixed(2), sum(sp.manual).toFixed(2), sp.shipping.toFixed(2), sp.tax.toFixed(2), sp.total.toFixed(2), String(D.budget.monthly || '')].concat(CATEGORIES.filter(c => c.id !== 'lab-3d').map(c => ((sp.auto[c.id] || 0) + (sp.manual[c.id] || 0)).toFixed(2))));
  }
  downloadText('NLO supply spending ' + y + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
};
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function downloadText(name, text, type) { if (demoBlocked('download')) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

ACT.expenseAdd = () => withWho(() => {
  openModal('<h3>Add an expense</h3><div class="lsub">For supplies bought outside an order — it counts toward this month’s supply budget.</div>' +
    '<div class="grid2">' + field('Amount', '<input id="exAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00">') + field('Date', '<input id="exDate" type="date" value="' + todayISO() + '">') + '</div>' +
    field('Category', '<select id="exCat">' + CATEGORIES.filter(c => c.id !== 'lab-3d').map(c => '<option value="' + c.id + '"' + (c.id === 'misc' ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select>') +
    '<div class="grid2">' + field('Where from', '<input id="exVendor" placeholder="Amazon, Walmart…">') + field('What for', '<input id="exNote" placeholder="Retainer cases">') + '</div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="expenseSave">Add expense</button></div>', { cls: 'mid' });
}, 'Who’s adding this expense?');
ACT.expenseSave = async t => {
  const amt = round2(val('exAmt')); if (!(amt > 0)) return toast('Type the amount.', { bad: true });
  const s = stamp(), x = { id: uid(), date: val('exDate') || todayISO(), amount: amt, category: val('exCat') || 'misc', vendor: val('exVendor').trim(), note: val('exNote').trim(), by: s.by, byId: s.byId || null, addedAt: s.at };
  busyBtn(t, true, 'Saving…');
  if (await act(() => B.addExpense(x), 'Expense added.')) closeModal(true); else busyBtn(t, false);
};
ACT.expenseDel = async t => {
  const x = listOf(S.D.expenses).find(e => e && e.id === t.dataset.id); if (!x) return;
  if (!await confirmBox('Remove this expense?', money(x.amount) + (x.vendor ? ' from ' + x.vendor : '') + (x.note ? ' — ' + x.note : '') + '. It comes off the month’s spending.', 'Remove', true)) return;
  withWho(() => act(() => B.removeExpense(x.id), 'Expense removed.'));
};
ACT.budgetEdit = () => withAdmin(openBudgetEdit, 'Who’s changing the budget?', 'change budget amounts');
function openBudgetEdit() {
  const b = S.D.budget, cats = b.categories || {};
  openModal('<h3>Budget amounts</h3><div class="lsub">The monthly supply budget, and how much of it each category should take (optional).</div>' +
    field('Monthly supply budget', '<input id="bMonthly" type="number" inputmode="decimal" min="0" step="50" value="' + esc(b.monthly || '') + '">') +
    '<div class="subH">By category</div><div class="grid2">' + CATEGORIES.filter(c => c.id !== 'lab-3d').map(c => field(c.label, '<input data-bcat="' + c.id + '" type="number" inputmode="decimal" min="0" step="25" value="' + esc(cats[c.id] || '') + '" placeholder="—">')).join('') + '</div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="budgetSave">Save</button></div>', { cls: 'mid' });
}
ACT.budgetSave = t => withAdmin(async () => {
  const m = round2(val('bMonthly')), cats = {};
  $$('[data-bcat]').forEach(i => { const v = round2(i.value); if (v > 0) cats[i.dataset.bcat] = v; });
  busyBtn(t, true, 'Saving…');
  const s = stamp();
  if (await act(() => B.budget({ monthly: m || 0, categories: cats, changedBy: s.by, changedAt: s.at }), 'Budget saved.')) closeModal(true); else busyBtn(t, false);
}, 'Who’s changing the budget?', 'change budget amounts');
