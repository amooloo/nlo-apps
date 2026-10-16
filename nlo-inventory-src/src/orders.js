/* =====================================================================
   Orders — On the way, Backordered, Received and Voided. Each order
   shows its trail at a glance: who added the lines to the cart, who
   placed it (how, and when), who received it. From here: receive it
   (by hand, or by scanning the packing slip), edit, backorder, void,
   reopen a mistaken receive, or order the same again.
   ===================================================================== */
const ORDER_TABS = [['open', 'On the way'], ['backordered', 'Backordered'], ['received', 'Received'], ['voided', 'Voided']];
function orderSearchText(o) { return [o.vendor, o.orderNumber, o.invoiceNumber, o.note, o.orderedBy, o.receivedBy, o.method].concat(o.items.map(l => (l.name || '') + ' ' + (l.sku || '') + ' ' + (l.addedBy || ''))).join(' '); }
function orderWhen(o) { return msOf(o.status === 'received' ? o.dateReceived : (o.orderedAt || o.dateOrdered)); }
/* the three steps: added to the cart → ordered → received */
function trailHTML(o) {
  const adders = []; o.items.forEach(l => { if (l.addedBy && !adders.some(a => (a.byId && a.byId === l.addedById) || a.by === l.addedBy)) adders.push({ by: l.addedBy, byId: l.addedById, at: l.addedAt }); });
  const firstAdd = o.items.map(l => msOf(l.addedAt)).filter(Boolean).sort((a, b) => a - b)[0];
  const tr = listOf(o.trail), last = k => tr.filter(t => t.t === k).slice(-1)[0];
  const ord = last('ordered'), rec = o.status === 'received' ? (last('received') || { by: o.receivedBy, at: o.dateReceived }) : null, back = o.status === 'backordered' ? last('backordered') || { at: o.dateBackordered } : null, vd = o.status === 'voided' ? last('voided') || { by: o.voidedBy, at: o.dateVoided } : null;
  /* who: one name, or a list of {by, byId} (several people can add to one order) */
  const step = (cls, icon, label, who, whoId, when, extra) => {
    const ppl = Array.isArray(who) ? who : who ? [{ by: who, byId: whoId }] : [];
    const names = ppl.slice(0, 2).map(p => stampName(p.by, p.byId)).join(', ') + (ppl.length > 2 ? ' +' + (ppl.length - 2) : '');
    return '<div class="tstep ' + cls + '"><span class="dot">' + ic(icon, 14) + '</span><div class="tx"><span class="l">' + esc(label) + '</span><b>' + (ppl.length ? '<span class="avs">' + ppl.slice(0, 2).map(p => avatarHTML(p.by, 'xs', p.byId)).join('') + '</span><span class="nm">' + esc(names) + '</span>' : '—') + '</b><span>' + esc(when || '') + (extra ? ' · ' + esc(extra) : '') + '</span></div></div>';
  };
  let h = '<div class="trail">';
  h += step(adders.length ? 'done' : '', 'cart', 'Added to cart', adders, '', firstAdd ? fmtWhen(firstAdd) : 'before trails were kept');
  h += step('done', 'truck', 'Ordered', (ord && ord.by) || o.orderedBy || '', (ord && ord.byId) || o.orderedById, o.orderedAt ? fmtWhen(o.orderedAt) : o.dateOrdered ? fmtWhen(o.dateOrdered) : '', HOW_WORDS[o.method] || '');
  if (vd) h += step('bad', 'x', 'Voided', vd.by || '', vd.byId, vd.at ? fmtWhen(vd.at) : '');
  else if (rec) h += step('done', 'receive', 'Received', rec.by || o.receivedBy || '', rec.byId || o.receivedById, rec.at ? fmtWhen(rec.at) : '', o.countUpdated === false ? 'stock not counted' : '');
  else if (back) h += step('bad', 'pause', 'Backordered', back.by || '', back.byId, back.at ? fmtWhen(back.at) : '');
  else h += step('now', 'receive', 'Received', '', '', orderAgeLabel(o) || 'waiting');
  return h + '</div>';
}
function orderCardHTML(o) {
  const tot = orderTotal(o), late = orderLate(o);
  let h = '<div class="card ocard"><div class="oHd">' + vlogoHTML(vendorObj(o.vendor), 'lg') + '<div class="grow"><h4>' + esc(o.vendor || 'Order') + ' <span class="st ' + esc(o.status) + '">' + esc((ORDER_TABS.find(x => x[0] === o.status) || [0, o.status])[1]) + '</span>' + (late ? '<span class="st late">' + esc(o.expectedDelivery ? 'late' : 'over 10 days') + '</span>' : '') + '</h4>' +
    '<div class="meta">' + (o.orderNumber ? '<span>Order #' + esc(o.orderNumber) + '</span>' : '') + (o.invoiceNumber ? '<span>Invoice #' + esc(o.invoiceNumber) + '</span>' : '') + (o.expectedDelivery && o.status === 'open' ? '<span>' + esc(orderAgeLabel(o)) + '</span>' : '') + (o.backorderOf ? '<span>rest of an earlier order</span>' : '') + '</div></div>' +
    '<div class="oAmt">' + money(tot) + '<small>' + o.items.length + ' line' + (o.items.length === 1 ? '' : 's') + ((o.invoiceShipping || o.shipping) ? ' · incl. shipping' : '') + '</small></div></div>';
  h += trailHTML(o);
  h += '<div class="olines">' + o.items.slice(0, 6).map(l => '<div class="oline"><span class="q">' + esc(lineQtyLabel(l)) + '</span><span class="n">' + esc(l.name || '') + (l.sku ? ' <small>#' + esc(l.sku) + '</small>' : '') + (l.orderedQty != null && Number(l.orderedQty) !== Number(l.qty) ? ' <small>(ordered ' + esc(qtyFmt(l.orderedQty)) + ')</small>' : '') + (l.addedBy ? ' <small>· ' + esc(firstName(l.addedBy)) + '</small>' : '') + '</span><span class="p">' + (orderItemCost(l) ? money(orderItemCost(l)) : '') + '</span></div>').join('') +
    (o.items.length > 6 ? '<div class="oline"><span class="muted">and ' + (o.items.length - 6) + ' more…</span></div>' : '') + '</div>';
  if (o.note) h += '<div class="olines"><div class="muted small">' + ic('text', 12) + ' ' + esc(o.note) + '</div></div>';
  h += '<div class="oFt">';
  if (o.status === 'open' || o.status === 'backordered') h += '<button class="btn btn-act btn-sm" data-act="receive" data-id="' + esc(o.id) + '">' + ic('receive', 15) + 'Receive</button><button class="btn btn-sec btn-sm" data-act="slipFor" data-id="' + esc(o.id) + '">' + ic('camera', 15) + 'Scan packing slip</button>';
  if (o.status === 'received' && isAdmin()) h += '<button class="btn btn-sec btn-sm" data-act="reorder" data-id="' + esc(o.id) + '">' + ic('refresh', 15) + 'Order again</button>';
  h += '<button class="btn btn-ghost btn-sm" data-act="openOrder" data-id="' + esc(o.id) + '">Details' + ic('next', 14) + '</button></div></div>';
  return h;
}
VIEWS.orders = {
  /* (an order typed in by hand skips the cart and Dr. A's OK: his alone) */
  actions() { return '<button class="btn btn-sec" data-act="slipNew">' + ic('camera', 16) + 'Scan a packing slip</button>' + (isAdmin() ? '<button class="btn btn-teal" data-act="orderNew">' + ic('plus', 16) + 'New order</button>' : ''); },
  render() {
    const u = S.ui.orders || (S.ui.orders = { tab: 'open', sort: '' });
    const cnt = k => S.D.orders.filter(o => o.status === k).length;
    let list = S.D.orders.filter(o => o.status === u.tab);
    if (S.q) list = S.D.orders.filter(o => matchesAll(orderSearchText(o), S.q) && (u.tab === 'all' || o.status === u.tab || S.q));
    const sort = u.sort || (u.tab === 'received' || u.tab === 'voided' ? 'new' : 'vendor');
    list.sort(sort === 'vendor' ? (a, b) => String(a.vendor || '').localeCompare(String(b.vendor || '')) || orderWhen(a) - orderWhen(b) : sort === 'old' ? (a, b) => orderWhen(a) - orderWhen(b) : (a, b) => orderWhen(b) - orderWhen(a));
    let h = '<div class="filters"><div class="seg">' + ORDER_TABS.map(([k, l]) => '<button data-act="ordTab" data-t="' + k + '" aria-pressed="' + (u.tab === k && !S.q) + '">' + esc(l) + ' (' + cnt(k) + ')</button>').join('') + '</div>' +
      '<select data-chg="ordSort" aria-label="Sort">' + [['', 'Usual order'], ['new', 'Newest first'], ['old', 'Oldest first'], ['vendor', 'By vendor']].map(([v, l]) => '<option value="' + v + '"' + (u.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      (S.q ? '<span class="muted small">' + list.length + ' found in every tab</span>' : '') + '</div>';
    if (!list.length) return h + '<div class="card"><div class="empty">' + (S.q ? 'No order matches “' + esc(S.q) + '”.' : u.tab === 'open' ? 'Nothing on the way. Orders placed from the cart show up here.' : 'None.') + '</div></div>';
    if (u.tab === 'received' && !S.q && list.length > 60) list = list.slice(0, 60);
    return h + list.map(orderCardHTML).join('') + (u.tab === 'received' && !S.q && cnt('received') > 60 ? '<div class="empty">Showing the newest 60. Search to find older orders.</div>' : '');
  }
};
ACT.ordTab = t => { S.ui.orders.tab = t.dataset.t; S.q = ''; renderView(); };
CHG.ordSort = t => { S.ui.orders.sort = t.value; renderView(true); };
ACT.openOrder = (t, e) => { if (e && t.classList.contains('fi') && e.target.closest('[data-act]') !== t) return; openDrawer('order', t.dataset.id); };

/* ---------- the order drawer ---------- */
DRAWERS.order = id => {
  const o = orderById(id); if (!o) return '';
  let h = '<div class="dHd">' + vlogoHTML(vendorObj(o.vendor), 'lg') + '<div style="flex:1;min-width:0"><h3>' + esc(o.vendor || 'Order') + '</h3><div class="sub"><span class="st ' + esc(o.status) + '">' + esc((ORDER_TABS.find(x => x[0] === o.status) || [0, o.status])[1]) + '</span>' + (o.orderNumber ? '<span class="badge">#' + esc(o.orderNumber) + '</span>' : '') + '<span class="badge">' + money(orderTotal(o)) + '</span></div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">';
  h += '<div class="card" style="box-shadow:none">' + trailHTML(o) + '</div>';
  h += '<div class="sec"><h5>Lines</h5><table class="tbl"><thead><tr><th>Qty</th><th>Supply</th><th class="right">Cost</th></tr></thead><tbody>' + o.items.map(l => '<tr><td class="nowrap"><b>' + esc(lineQtyLabel(l)) + '</b>' + (linePer(l) > 1 ? '<div class="muted small">' + esc(qtyUnit(l.qty * linePer(l), l.countUnit || '')) + '</div>' : '') + '</td><td>' + (l.itemId && itemById(l.itemId) ? '<a href="#" data-act="openItem" data-id="' + esc(l.itemId) + '">' + esc(l.name) + '</a>' : esc(l.name || '')) + (l.sku ? ' <span class="muted small">#' + esc(l.sku) + '</span>' : '') +
    '<div class="muted small">' + (l.addedBy ? 'added to the cart by ' + esc(l.addedBy) + (l.addedAt ? ', ' + esc(fmtWhen(l.addedAt)) : '') : '') + listOf(l.trail).map(t => ' · ' + esc(t.t === 'more' ? '+' + qtyFmt(t.qty) : t.t === 'qty' ? qtyFmt(t.from) + '→' + qtyFmt(t.to) : t.t === 'ok' ? 'OK’d' : 'changed') + ' by ' + esc(t.by) + ', ' + esc(fmtWhen(t.at))).join('') + (l.ok && !listOf(l.trail).some(t => t.t === 'ok') ? ' · OK’d by ' + esc(l.ok.by || 'Dr. A') : '') + (l.note ? ' · “' + esc(l.note) + '”' : '') + '</div></td>' +
    '<td class="right nowrap">' + (orderItemCost(l) ? money(orderItemCost(l)) : '—') + (l.price ? '<div class="muted small">' + money(l.price) + '/' + esc(l.unit || 'ea') + '</div>' : '') + '</td></tr>').join('') + '</tbody></table>' +
    '<div class="kvRow" style="margin-top:8px"><span>Lines</span><b>' + money(orderSubtotal(o)) + '</b></div>' + (num(o.discount) ? '<div class="kvRow"><span>Discount</span><b>−' + money(o.discount) + '</b></div>' : '') + (num(o.invoiceTaxes) ? '<div class="kvRow"><span>Tax</span><b>' + money(o.invoiceTaxes) + '</b></div>' : '') + (num(o.invoiceShipping != null ? o.invoiceShipping : o.shipping) ? '<div class="kvRow"><span>Shipping</span><b>' + money(o.invoiceShipping != null ? o.invoiceShipping : o.shipping) + '</b></div>' : '') + '<div class="kvRow"><span>Total</span><b>' + money(orderTotal(o)) + '</b></div></div>';
  h += '<div class="sec"><h5>Details</h5><div class="kv">' +
    '<div><div class="k">Ordered</div><div class="v">' + esc(o.orderedAt ? fmtWhen(o.orderedAt) : fmtDate(o.dateOrdered) || '—') + '</div></div><div><div class="k">By</div><div class="v">' + esc(o.orderedBy || '—') + (HOW_WORDS[o.method] ? ' · ' + esc(HOW_WORDS[o.method]) : '') + '</div></div>' +
    '<div><div class="k">Expected</div><div class="v">' + esc(o.expectedDelivery ? fmtDate(o.expectedDelivery) : '—') + '</div></div><div><div class="k">Received</div><div class="v">' + esc(o.dateReceived ? fmtWhen(o.dateReceived) + (o.receivedBy ? ' · ' + o.receivedBy : '') : '—') + '</div></div>' +
    (o.invoiceNumber ? '<div><div class="k">Invoice #</div><div class="v">' + esc(o.invoiceNumber) + '</div></div>' : '') + (o.costBasis && o.costBasis !== 'paid' ? '<div><div class="k">Cost</div><div class="v">' + esc(o.costBasis) + '</div></div>' : '') + '</div>' + (o.note ? '<div class="txt" style="margin-top:10px">' + esc(o.note) + '</div>' : '') + '</div>';
  const tr = listOf(o.trail);
  if (tr.length) h += '<div class="sec"><h5>Every step</h5>' + tr.slice().reverse().map(t => '<div class="hist"><time>' + esc(fmtWhen(t.at)) + '</time><span>' + esc(t.by || '') + ' ' + esc(ORDER_WORDS[t.t] || t.t) + (t.how && HOW_WORDS[t.how] ? ' ' + esc(HOW_WORDS[t.how]) : '') + (t.note ? ' — ' + esc(t.note) : '') + '</span></div>').join('') + '</div>';
  if (o.slipPhoto) h += '<div class="sec"><h5>Packing slip</h5><img data-src="' + esc(o.slipPhoto) + '" alt="Packing slip" style="max-width:100%;border-radius:12px;border:1px solid var(--grey-200)"></div>';
  h += '</div><div class="dFt">';
  /* (editing, voiding, reopening and ordering again are Dr. A's; everyone receives) */
  const boss = isAdmin();
  if (o.status === 'open' || o.status === 'backordered') h += '<button class="btn btn-act" data-act="receive" data-id="' + esc(o.id) + '">' + ic('receive', 16) + 'Receive</button><button class="btn btn-sec" data-act="slipFor" data-id="' + esc(o.id) + '">' + ic('camera', 15) + 'Scan slip</button>' + (boss ? '<button class="btn btn-ghost" data-act="orderEdit" data-id="' + esc(o.id) + '">' + ic('edit', 15) + 'Edit</button>' : '') +
    (o.status === 'open' ? '<button class="btn btn-ghost" data-act="orderBack" data-id="' + esc(o.id) + '">' + ic('pause', 15) + 'Backordered</button>' : '<button class="btn btn-ghost" data-act="orderUnback" data-id="' + esc(o.id) + '">Back to On the way</button>') + (boss ? '<button class="btn btn-ghost" data-act="orderVoid" data-id="' + esc(o.id) + '" style="color:var(--coral-700)">' + ic('x', 15) + 'Void</button>' : '');
  if (o.status === 'received' && boss) h += '<button class="btn btn-sec" data-act="reorder" data-id="' + esc(o.id) + '">' + ic('refresh', 15) + 'Order again</button><button class="btn btn-ghost" data-act="orderReopen" data-id="' + esc(o.id) + '">' + ic('undo', 15) + 'Reopen (undo the receive)</button>';
  if (o.status === 'voided' && boss) h += '<button class="btn btn-ghost" data-act="orderUnvoid" data-id="' + esc(o.id) + '">Bring it back</button>';
  return h + '</div>';
};
ACT.orderBack = t => withWho(() => act(() => backorderOrder(t.dataset.id), 'Marked backordered.'), 'Who’s marking it backordered?');
ACT.orderUnback = t => withWho(() => act(() => unbackorderOrder(t.dataset.id), 'Back under On the way.'));
/* a voided order back under On the way: for the people who void them */
ACT.orderUnvoid = t => withAdmin(() => act(() => unvoidOrder(t.dataset.id), 'Back under On the way.'), 'Who’s bringing it back?', 'bring back a voided order');
ACT.orderVoid = t => {
  const o = orderById(t.dataset.id); if (!o) return;
  withAdmin(async () => {
    const why = await confirmBox('Void the ' + (o.vendor || '') + ' order?', 'It moves to Voided and nothing from it is counted.', 'Void it', true, { input: 'Why (optional)', placeholder: 'e.g. ordered twice by mistake' });
    if (why === false) return;
    return act(() => voidOrder(o.id, String(why).trim()), 'Voided.');
  }, 'Who’s voiding it?', 'void orders');
};
ACT.orderReopen = t => {
  const o = orderById(t.dataset.id); if (!o) return;
  withAdmin(async () => {
    const msg = o.countUpdated !== false ? 'What it added to stock comes back out, and the ' + money(orderTotal(o)) + ' it booked to the budget is taken back. Receive it again when it’s right.' : 'It was marked received without changing stock, so only its status changes.';
    if (!await confirmBox('Reopen the ' + (o.vendor || '') + ' order?', msg, 'Reopen it', true)) return;
    return act(() => reopenOrder(o.id), 'Reopened — it’s back under On the way.');
  }, 'Who’s reopening it?', 'reopen received orders');
};
ACT.reorder = t => { const o = orderById(t.dataset.id); if (!o || !isAdmin()) return; openOrderEditor(null, { vendor: o.vendor, items: o.items.map(l => ({ itemId: l.itemId || '', name: l.name, sku: l.sku || '', qty: Number(l.orderedQty != null ? l.orderedQty : l.qty) || 1, price: Number(l.price) || 0, unit: l.unit || 'ea', per: l.per || null, countUnit: l.countUnit || null })), note: '' }); };
ACT.orderNew = () => withAdmin(() => openOrderEditor(null, { vendor: '', items: [], note: '' }), '', 'type in an order (everyone else orders from the cart)');
ACT.orderEdit = t => { const o = orderById(t.dataset.id); if (o) withAdmin(() => openOrderEditor(o.id, o), '', 'edit an order'); };

/* ---------- typing an order in by hand / editing one ---------- */
function openOrderEditor(id, o) {
  S.ui.oe = { id, vendor: o.vendor || '', items: listOf(o.items).map(l => Object.assign({}, l)), note: o.note || '', orderNumber: o.orderNumber || '', expected: o.expectedDelivery || '', method: o.method || 'online' };
  S.ui.oe.orig = oeSnap(S.ui.oe);
  renderOrderEditor();
}
/* closing asks first only when something was typed or changed */
function oeSnap(E) { return JSON.stringify([E.vendor, E.method, E.orderNumber, E.expected, E.note, E.items.map(l => [l.itemId || '', l.name || '', Number(l.qty) || 0, Number(l.price) || 0])]); }
function oeChanged() { if (!S.ui.oe || !$('#oeVendor')) return false; oeKeep(); return oeSnap(S.ui.oe) !== S.ui.oe.orig; }
function renderOrderEditor() {
  const E = S.ui.oe, names = Array.from(new Set(S.D.vendors.map(v => v.name).filter(Boolean))).sort();
  openModal('<h3>' + (E.id ? 'Edit the order' : 'New order') + '</h3><div class="lsub">' + (E.id ? 'Changes are saved with your name and the time.' : 'For an order placed outside the cart (a rep visit, a call). It goes under On the way.') + '</div>' +
    '<div class="grid2">' + field('Vendor', '<input id="oeVendor" list="oeVendors" value="' + esc(E.vendor) + '" placeholder="Pick or type a vendor"><datalist id="oeVendors">' + names.map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>') +
    field('How it was ordered', '<select id="oeHow">' + HOW.map(([k, l]) => '<option value="' + k + '"' + (E.method === k ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>') + '</div>' +
    '<div class="subH">Lines</div><table class="rtable"><thead><tr><th>Supply</th><th>Qty</th><th>Unit</th><th>Price each</th><th></th></tr></thead><tbody>' +
    E.items.map((l, k) => '<tr><td class="n"><b>' + esc(l.name || '') + '</b>' + (l.sku ? '<small>#' + esc(l.sku) + '</small>' : '') + '</td><td><input type="number" inputmode="decimal" min="0" value="' + esc(l.qty) + '" data-oe="qty" data-k="' + k + '"></td><td>' + esc(l.unit || 'ea') + '</td><td><input type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(l.price || '') + '" data-oe="price" data-k="' + k + '"></td><td><button class="iconBtn" data-act="oeDel" data-k="' + k + '" aria-label="Remove">' + ic('trash', 16) + '</button></td></tr>').join('') + '</tbody></table>' +
    '<div class="inRow" style="margin-top:10px;position:relative"><input class="inp" id="oeFind" placeholder="Add a supply — type to search" autocomplete="off" data-inp="oeFind"></div><div id="oeHits"></div>' +
    '<div class="grid3" style="margin-top:12px">' + field('Order # (optional)', '<input id="oeNum" value="' + esc(E.orderNumber) + '">') + field('Expected (optional)', '<input id="oeDate" type="date" value="' + esc(E.expected) + '">') + field('Note', '<input id="oeNote" value="' + esc(E.note) + '">') + '</div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="oeSave">' + (E.id ? 'Save changes' : 'Add the order') + '</button></div>', { cls: 'wide', noFocus: true, confirmClose: () => oeChanged() ? 'Close without saving the order?' : null });
}
function oeKeep() { const E = S.ui.oe; E.vendor = val('oeVendor'); E.method = val('oeHow'); E.orderNumber = val('oeNum'); E.expected = val('oeDate'); E.note = val('oeNote'); $$('[data-oe]').forEach(i => { const l = E.items[Number(i.dataset.k)]; if (l) l[i.dataset.oe] = num(i.value); }); }
INP.oeFind = t => {
  const q = t.value.trim(), box = $('#oeHits'); if (!q) { box.innerHTML = ''; return; }
  const hits = activeItems().filter(i => matchesAll(itemSearchText(i), q)).slice(0, 8);
  box.innerHTML = '<div class="card" style="margin-top:6px">' + (hits.length ? hits.map(i => '<button class="row" data-act="oeAdd" data-id="' + esc(i.id) + '"><span class="grow"><span class="pt">' + esc(i.name) + '</span><span class="meta">' + esc(buyLabel(i)) + (primarySource(i) ? ' · ' + esc(primarySource(i).vendor || '') : '') + '</span></span>' + ic('plus', 16) + '</button>').join('') : '<div class="empty">No supply matches. <button class="linkBtn" data-act="oeAddFree">Add “' + esc(q) + '” as a one-off line</button></div>') + '</div>';
};
ACT.oeAdd = t => { oeKeep(); const it = itemById(t.dataset.id), E = S.ui.oe, src = sourceFor(it, E.vendor); const l = { itemId: it.id, name: it.name, sku: (src && src.sku) || '', qty: 1, price: src ? buyPriceOf(it, src) || 0 : 0, unit: buyUnit(it) }; if (perBuy(it) > 1) { l.per = perBuy(it); l.countUnit = countUnit(it); } E.items.push(l); if (!E.vendor && src && src.vendor) E.vendor = src.vendor; renderOrderEditor(); };
ACT.oeAddFree = () => { oeKeep(); S.ui.oe.items.push({ itemId: '', name: val('oeFind').trim(), sku: '', qty: 1, price: 0, unit: 'ea' }); renderOrderEditor(); };
ACT.oeDel = t => { oeKeep(); S.ui.oe.items.splice(Number(t.dataset.k), 1); renderOrderEditor(); };
ACT.oeSave = t => {
  oeKeep(); const E = S.ui.oe;
  if (!E.vendor.trim()) return toast('Which vendor?', { bad: true });
  const lines = E.items.filter(l => Number(l.qty) > 0); if (!lines.length) return toast('Add at least one line.', { bad: true });
  withWho(async () => {
    busyBtn(t, true, 'Saving…');
    const ok = await act(async () => {
      if (E.id) await editOrder(E.id, { vendor: E.vendor.trim(), items: lines, note: E.note.trim(), orderNumber: E.orderNumber.trim() || null, expectedDelivery: E.expected || null, method: E.method });
      else await createOrder({ vendor: E.vendor.trim(), items: lines, note: E.note.trim(), orderNumber: E.orderNumber.trim() || undefined, expectedDelivery: E.expected || undefined, method: E.method });
      ensureVendors([E.vendor.trim()]);
    }, E.id ? 'Order saved.' : 'Order added under On the way.');
    if (ok) closeModal(true); else busyBtn(t, false);
  }, E.id ? 'Who’s changing the order?' : 'Who placed this order?');
};
