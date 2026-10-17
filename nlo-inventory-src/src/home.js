/* =====================================================================
   Home — what needs someone today: what's waiting in the cart (and who
   put it there), what's on the way (who ordered it, when, whether it's
   late), this month's supply spending against the budget, and the last
   few steps anyone took. Stock counts aren't the lead: they aren't kept
   up closely enough to steer by (Amir, Oct 2026). Everyone but Dr. A
   sees the cart, what's on the way, and what's low or expiring — not the
   spending or the activity.
   ===================================================================== */
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function cartValue(lines) { return (lines || S.D.cart).reduce((a, c) => a + (Number(c.price) || 0) * (Number(c.qty) || 0), 0); }
function orderLate(o) { if (!o || o.status !== 'open') return false; if (o.expectedDelivery) return o.expectedDelivery < todayISO(); const d = daysAgo(o.orderedAt || o.dateOrdered); return d != null && d > 10; }
function orderAgeLabel(o) {
  if (o.expectedDelivery) { const d = daysBetween(todayISO(), o.expectedDelivery); return d < 0 ? 'due ' + fmtDate(o.expectedDelivery) + ' — ' + (-d) + ' day' + (d === -1 ? '' : 's') + ' late' : d === 0 ? 'due today' : 'due ' + fmtDate(o.expectedDelivery); }
  const d = daysAgo(o.orderedAt || o.dateOrdered); return d == null ? '' : d === 0 ? 'ordered today' : 'ordered ' + d + ' day' + (d === 1 ? '' : 's') + ' ago';
}
VIEWS.home = {
  actions() { return '<button class="btn btn-teal" data-act="nav" data-v="supplies">' + ic('plus', 16) + 'Add to cart</button>'; },
  render() {
    const D = S.D, w = whoNow(), cart = D.cart, open = D.orders.filter(o => o.status === 'open').sort((a, b) => msOf(a.orderedAt || a.dateOrdered) - msOf(b.orderedAt || b.dateOrdered));
    const back = D.orders.filter(o => o.status === 'backordered'), late = open.filter(orderLate);
    const mk = monthKey(Date.now()), boss = isAdmin(), sp = boss ? monthSpend(mk, D) : null, budget = boss ? budgetMonthly() : 0, wait = cart.filter(c => !okOf(c)).length;
    let h = '<div class="hello">' + greeting() + (w ? ', <b>' + esc(firstName(w.name)) + '</b>' : '') + ' · ' + esc(fmtDay(Date.now())) + '</div>';
    if (boss && wait) h += '<div class="okBar">' + ic('check', 16) + '<span class="grow"><b>' + plural(wait, 'cart line') + '</b> ' + (wait === 1 ? 'needs' : 'need') + ' your OK.</span><button class="btn btn-act btn-sm" data-act="nav" data-v="cart">Look at the cart</button></div>';
    h += '<div class="tiles">' +
      '<button class="tile mint" data-act="nav" data-v="cart"><span class="n">' + cart.length + '</span><span class="l">In the cart</span><span class="s">' + (cart.length ? (wait ? '<span style="color:var(--amber-700)">' + wait + (boss ? ' need your OK' : ' wait for Dr. A') + '</span>' : 'about ' + money(cartValue(), { whole: true }) + ' · ' + vendorsIn(cart).length + ' vendor' + (vendorsIn(cart).length === 1 ? '' : 's')) : 'nothing waiting') + '</span></button>' +
      '<button class="tile blue" data-act="nav" data-v="orders"><span class="n">' + open.length + '</span><span class="l">On the way</span><span class="s">' + (late.length ? '<span style="color:var(--coral-700)">' + late.length + ' late</span>' : open.length ? 'none late' : 'no open orders') + '</span></button>' +
      '<button class="tile ' + (back.length ? 'amber' : '') + '" data-act="ordersTab" data-tab="backordered"><span class="n">' + back.length + '</span><span class="l">Backordered</span><span class="s">' + (back.length ? 'waiting on vendors' : 'none') + '</span></button>' +
      (boss ? '<button class="tile ' + (budget && sp.total > budget ? 'red' : '') + '" data-act="nav" data-v="budget"><span class="n">' + moneyK(sp.total) + '</span><span class="l">' + esc(monthLabel(mk, true)) + ' supplies</span><span class="s">' + (budget ? 'of ' + money(budget, { whole: true }) + ' budget' : 'no budget set') + '</span></button>' : '') + '</div>';
    /* the cart, by vendor */
    let left = '<div class="card" style="margin-bottom:18px"><div class="cardHd"><h3>Waiting to be ordered</h3><span class="sub">' + (cart.length ? cart.length + ' line' + (cart.length === 1 ? '' : 's') : '') + '</span><span style="flex:1"></span>' + (cart.length ? '<button class="btn btn-sec btn-sm" data-act="nav" data-v="cart">Open the cart</button>' : '') + '</div><div class="cardBd">';
    if (!cart.length) left += '<div class="empty">The cart is empty. Find a supply and tap <b>Add</b>.</div>';
    else vendorsIn(cart).forEach(v => {
      const ls = cart.filter(c => (c.vendor || '') === v);
      left += '<div class="grpHead" style="padding:8px 0 2px;display:flex;align-items:center;gap:8px">' + vlogoHTML({ name: v }) + esc(v || 'No vendor yet') + '<span class="muted" style="margin-left:auto;font-weight:600">' + money(cartValue(ls)) + '</span></div>';
      ls.slice(0, 6).forEach(c => { left += '<div class="row" data-act="nav" data-v="cart" style="cursor:pointer"><div class="grow"><span class="pt">' + esc(c.name) + '</span><span class="meta">' + esc(lineQtyLabel(c)) + ' · added by ' + esc(c.addedBy || '—') + (c.addedAt ? ', ' + esc(fmtWhen(c.addedAt)) : '') + (okOf(c) ? '' : ' · <span style="color:var(--amber-700)">' + (boss ? 'needs your OK' : 'waiting for Dr. A’s OK') + '</span>') + '</span></div>' + avatarHTML(c.addedBy, 'sm', c.addedById) + '</div>'; });
      if (ls.length > 6) left += '<div class="muted small" style="padding:6px 8px">and ' + (ls.length - 6) + ' more</div>';
    });
    left += '</div></div>';
    /* on the way */
    left += '<div class="card"><div class="cardHd"><h3>On the way</h3><span class="sub">' + (open.length ? open.length + ' open' : '') + '</span><span style="flex:1"></span>' + (open.length ? '<button class="btn btn-sec btn-sm" data-act="nav" data-v="orders">All orders</button>' : '') + '</div><div class="cardBd">';
    if (!open.length) left += '<div class="empty">No open orders.</div>';
    open.slice(0, 8).forEach(o => {
      left += '<div class="row" style="cursor:default">' + vlogoHTML(vendorObj(o.vendor), 'lg') + '<div class="grow"><span class="pt">' + esc(o.vendor || 'Order') + ' <span class="muted" style="font-weight:600">· ' + o.items.length + ' line' + (o.items.length === 1 ? '' : 's') + ' · ' + money(orderTotal(o)) + '</span></span>' +
        '<span class="meta">' + (o.orderedBy ? 'ordered by ' + esc(o.orderedBy) + (o.orderedAt ? ', ' + esc(fmtWhen(o.orderedAt)) : o.dateOrdered ? ', ' + esc(fmtDate(o.dateOrdered)) : '') : esc(orderAgeLabel(o))) + '</span></div>' +
        (orderLate(o) ? '<span class="st late">' + esc(o.expectedDelivery ? 'late' : 'over 10 days') + '</span>' : o.expectedDelivery ? '<span class="st open">' + esc(orderAgeLabel(o)) + '</span>' : '') +
        '<button class="btn btn-act btn-sm" data-act="receive" data-id="' + esc(o.id) + '">' + ic('receive', 15) + 'Receive</button></div>';
    });
    if (back.length) left += '<div class="notice" style="margin-top:12px;cursor:pointer" data-act="ordersTab" data-tab="backordered">' + back.length + ' order' + (back.length === 1 ? ' is' : 's are') + ' backordered: ' + esc(back.map(o => o.vendor).filter(Boolean).slice(0, 3).join(', ')) + '</div>';
    left += '</div></div>';
    /* spending, what's low (by the counts), what's expiring, and activity */
    let right = (boss ? budgetSummaryCard(mk, sp, budget, true) + mlHomeCardHTML() : '') + lowCardHTML() + expiringCardHTML();
    if (boss) {
      const ev = feedEvents().slice(0, 12);
      right += '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Latest steps</h3><span style="flex:1"></span><button class="btn btn-ghost" data-act="nav" data-v="activity">See all</button></div><div class="cardBd" style="padding-top:0"><div class="feed">' + (ev.length ? ev.map(e => feedItemHTML(e, true)).join('') : '<div class="empty">Nothing yet.</div>') + '</div></div></div>';
    }
    return h + (right ? '<div class="twoCol"><div>' + left + '</div><div>' + right + '</div></div>' : left);
  }
};
/* below the minimum — a hint, since counts aren't always kept up — with a one-tap add */
function lowItems() { return activeItems().filter(isLow).sort((a, b) => String((primarySource(a) || {}).vendor || '~').localeCompare(String((primarySource(b) || {}).vendor || '~')) || String(a.name).localeCompare(String(b.name))); }
function lowCardHTML() {
  const low = lowItems(); if (!low.length) return '';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Below the minimum</h3><span class="sub">' + low.length + ' · by the counts</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-act="printReorder">' + ic('print', 14) + 'Print</button></div><div class="cardBd" style="padding-top:0">' +
    low.slice(0, 6).map(i => { const c = inCartLine(i.id), os = openOrdersWith(i.id).length, need = Math.max(1, Math.ceil(((Number(i.min) || 0) - (Number(i.qty) || 0)) / perBuy(i)));
      return '<div class="row" data-act="openItem" data-id="' + esc(i.id) + '" style="cursor:pointer">' + thumbHTML(i, 'sm') + '<div class="grow"><span class="pt">' + esc(i.name) + '</span><span class="meta">' + esc(qtyFmt(i.qty || 0)) + ' of ' + esc(qtyUnit(i.min, countUnit(i))) + ((primarySource(i) || {}).vendor ? ' · ' + esc(primarySource(i).vendor) : '') + '</span></div>' +
        (c ? '<span class="fl cart">In cart</span>' : os ? '<span class="fl order">On order</span>' : '<button class="btn btn-teal btn-sm" data-act="lowAdd" data-id="' + esc(i.id) + '" data-n="' + need + '">' + ic('plus', 14) + qtyUnit(need, buyUnit(i)) + '</button>') + '</div>'; }).join('') +
    (low.length > 6 ? '<button class="btn btn-ghost btn-sm" data-act="supLow" style="margin-top:6px">All ' + low.length + '</button>' : '') + '</div></div>';
}
function expiringCardHTML() {
  const list = activeItems().map(i => [i, expDays(i)]).filter(([, d]) => d != null && d < 90).sort((a, b) => a[1] - b[1]); if (!list.length) return '';
  return '<div class="card" style="margin-top:18px"><div class="cardHd"><h3>Expiring soon</h3><span class="sub">' + list.length + '</span></div><div class="cardBd" style="padding-top:0">' +
    list.slice(0, 5).map(([i, d]) => '<div class="row" data-act="openItem" data-id="' + esc(i.id) + '" style="cursor:pointer"><div class="grow"><span class="pt">' + esc(i.name) + '</span><span class="meta">' + esc(fmtDate(i.exp)) + (i.location ? ' · ' + esc(i.location) : '') + '</span></div><span class="fl ' + (d < 30 ? 'low' : 'due') + '">' + (d < 0 ? 'Expired' : d === 0 ? 'Today' : d + ' day' + (d === 1 ? '' : 's')) + '</span></div>').join('') + '</div></div>';
}
ACT.lowAdd = (t, e) => { if (e) e.stopPropagation(); const it = itemById(t.dataset.id); if (it) openAddToCart(it, Number(t.dataset.n) || 1); };
ACT.supLow = () => { S.ui.sup = Object.assign(S.ui.sup || { cat: '', sort: 'cat' }, { show: 'low' }); go('supplies'); };
/* the reorder list, printed: by vendor, what's there and what's needed */
ACT.printReorder = (t, e) => {
  if (e) e.stopPropagation();
  const low = lowItems(); if (!low.length) return toast('Nothing is below its minimum.');
  if (demoBlocked('print')) return;
  const w = window.open('', '_blank', 'width=900,height=700'); if (!w) return toast('Allow pop-ups to print the list.', { bad: true });
  const d = w.document; d.write('<!doctype html><title>Reorder list</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#1B2F4C}h1{font-size:20px;margin:0 0 4px}p{color:#666;margin:0 0 16px;font-size:12px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#666}.r{text-align:right}</style><body></body>');
  const el = (tag, txt, cls) => { const x = d.createElement(tag); if (txt != null) x.textContent = txt; if (cls) x.className = cls; return x; };
  d.body.appendChild(el('h1', 'Reorder list — Next Level Orthodontics')); d.body.appendChild(el('p', 'Printed ' + fmtWhen(Date.now()) + (whoNow() ? ' by ' + whoNow().short : '') + ' · by the counts in Inventory, so check the shelf'));
  const by = {}; low.forEach(i => { const v = (primarySource(i) || {}).vendor || 'No vendor'; (by[v] = by[v] || []).push(i); });
  Object.keys(by).forEach(v => {
    d.body.appendChild(el('h2', v + ' — ' + by[v].length));
    const tb = el('table'), hr = el('tr'); ['Supply', 'SKU', 'Have', 'Minimum', 'Order', 'Price'].forEach((h, k) => hr.appendChild(el('th', h, k > 1 ? 'r' : ''))); tb.appendChild(hr);
    by[v].forEach(i => { const s = primarySource(i) || {}, need = Math.max(1, Math.ceil(((Number(i.min) || 0) - (Number(i.qty) || 0)) / perBuy(i))), cp = countPrice(s), tr = el('tr');
      [i.name, s.sku || i.sku || '', qtyUnit(i.qty || 0, countUnit(i)), qtyUnit(i.min, countUnit(i)), qtyUnit(need, buyUnit(i)) + (inCartLine(i.id) ? ' (in cart)' : ''), cp == null ? '' : money(cp * perBuy(i)) + '/' + buyUnit(i)].forEach((x, k) => tr.appendChild(el('td', x, k > 1 ? 'r' : ''))); tb.appendChild(tr); });
    d.body.appendChild(tb);
  });
  d.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (err) { } }, 300);
};
function vendorsIn(lines) { const seen = []; lines.forEach(c => { const v = c.vendor || ''; if (!seen.includes(v)) seen.push(v); }); return seen.sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b)); }
ACT.ordersTab = t => { S.ui.orders = Object.assign(S.ui.orders || {}, { tab: t.dataset.tab }); go('orders'); };
