/* =====================================================================
   The steps people take — each one stamped with who and when — and the
   records they write. The money rules are the old app's (3.0.1):
   - a receipt books its dollars on a "receive" log entry tied to the
     order (orderId), so receiving the same order twice can't count twice
     and reopening it writes exact negative entries that cancel it
   - an order-level discount is spread over the lines in proportion
     (the last line takes the rounding)
   - shipping and tax get their own entries, once per order
   - free / points / sample receipts book a real $0
   New here: cart lines and orders carry their trail (who added it, who
   changed it, who ordered, received, reopened…), and stock steps carry
   who did them. Bought-bigger supplies (gloves: cases of 10 boxes) add
   qty × per counted units when received.
   ===================================================================== */

/* ---------- the trail ---------- */
function trailAdd(list, t, s, extra) { const out = listOf(list).slice(); out.push(Object.assign({ t }, s, extra || {})); return out.slice(-40); }
function logEntry(fields, s) { return Object.assign({ id: uid(), date: s.at, by: s.by, byId: s.byId || null }, fields); }

/* ---------- the cart ---------- */
/* every line has an id (a line from before 5.0 gets one made from what it carries: the same on every computer) */
function withLineId(c) { if (c && !c.lineId) c.lineId = 'c-' + (c.itemId || '') + '-' + (c.addedAt || ''); return c; }
/* Dr. A's OK (Amir, 16 Oct 2026: "they will just need to look up inventory, add items to the cart and if I approve them, they
   can place order"). It's kept by line id — { by, byId, at, n: how many counted units he OK'd, it: the supply } — and a line
   is OK'd while it's that supply and no more of it than he OK'd: more needs his OK again. His own adds and changes carry it
   from the start. Only he gives it (the rules see to that); the others place the OK'd lines. */
function lineCount(c) { return Math.round((Number(c && c.qty) || 0) * linePer(c) * 1000) / 1000; }
function okOf(c, ok) { const o = c && c.lineId ? (ok || S.D.cartOk || {})[c.lineId] : null; return o && o.it === (c.itemId || '') && lineCount(c) <= (Number(o.n) || 0) ? o : null; }
function okStamp(c, s) { return { by: s.by, byId: s.byId || '', at: s.at, n: lineCount(c), it: c.itemId || '' }; }
/* what an add tells everyone but Dr. A: it waits for his OK */
function okNote(n) { return isAdmin() ? '' : ' ' + (n === 1 ? 'It waits' : 'They wait') + ' for Dr. A’s OK.'; }
/* one cart line per supply; quick-order brackets and elastics come in as their own lines */
function cartLineFor(item, qty, s, opt) {
  opt = opt || {};
  const src = opt.source || sourceFor(item, opt.vendor);
  const per = perBuy(item);
  const price = opt.price != null ? round2(opt.price) : (src ? buyPriceOf(item, src) : null);
  const line = { lineId: 'c-' + uid(), itemId: item.id, name: item.name || 'Unnamed supply', sku: (src && src.sku) || item.sku || '', vendor: (src && src.vendor) || opt.vendor || '', price: price || 0, unit: buyUnit(item), qty: qty,
    addedBy: s.by, addedById: s.byId || null, addedAt: s.at };
  if (per > 1) { line.per = per; line.countUnit = countUnit(item); }
  if (opt.note || item.note && opt.keepNote) line.note = opt.note || item.note;
  if (item.cat && opt.pseudo) line.cat = item.cat;
  return line;
}
async function cartAdd(item, qty, opt) {
  qty = Number(qty) || 1; const s = stamp(), boss = isOwnerAccount(); let added = null;
  await B.cart((list, ok) => {
    const ex = list.find(c => c && c.itemId === item.id);
    if (ex && !(opt && opt.pseudo)) {
      /* the line may be from before the supply was bought bigger (2 boxes, now bought by the case): add in the line's own unit */
      const conv = linePer(ex) !== perBuy(item) ? perBuy(item) / linePer(ex) : 1, more = round2(qty * conv);
      ex.qty = round2((Number(ex.qty) || 0) + more); ex.trail = trailAdd(ex.trail, 'more', s, conv !== 1 ? { qty: more, as: qtyUnit(qty, buyUnit(item)) } : { qty }); added = ex;
    } else { added = cartLineFor(item, qty, s, opt); list.push(added); }
    if (boss) ok[added.lineId] = okStamp(added, s);
    return list;
  });
  B.alert([{ t: 'cart', at: Date.now(), by: s.by, lines: alertLines([Object.assign({}, cartLineFor(item, qty, s, opt), { vendor: added.vendor })]), inCart: S.D.cart.length }]);
  return added;
}
async function cartSetQty(itemId, qty) {
  qty = Math.max(0, Number(qty) || 0); const s = stamp(), boss = isOwnerAccount(); let was = 0, line = null;
  if (!qty) return cartRemove(itemId);
  await B.cart((list, ok) => { const c = list.find(x => x && x.itemId === itemId); if (!c) return list; was = Number(c.qty) || 0; if (was === qty) return list; c.qty = qty; c.trail = trailAdd(c.trail, 'qty', s, { from: was, to: qty }); line = c; if (boss) ok[c.lineId] = okStamp(c, s); return list; });
  if (line && qty > was) B.alert([{ t: 'cart', at: Date.now(), by: s.by, lines: alertLines([Object.assign({}, line, { qty: qty - was })]), inCart: S.D.cart.length }]);
}
async function cartPatch(itemId, patch, what) {
  const s = stamp(), boss = isOwnerAccount();
  await B.cart((list, ok) => { const c = list.find(x => x && x.itemId === itemId); if (c) { Object.assign(c, patch); c.trail = trailAdd(c.trail, what || 'edit', s); if (boss && (patch.qty != null || patch.per != null)) ok[c.lineId] = okStamp(c, s); } return list; });
}
/* Dr. A OKs lines (by line id, or 'all'): → how many */
async function cartApprove(lineIds) {
  if (!isOwnerAccount()) throw errCode('permission', 'Only Dr. A OKs the cart.');
  const s = stamp(); let n = 0;
  await B.cart((list, ok) => {
    n = 0;
    list.forEach(c => { if (c && (lineIds === 'all' || lineIds.includes(c.lineId)) && !okOf(c, ok)) { ok[c.lineId] = okStamp(c, s); c.trail = trailAdd(c.trail, 'ok', s); n++; } });
    return n ? list : undefined;
  });
  return n;
}
/* a line added before its supply was bought bigger (in boxes; now bought by the case): make it cases */
function lineInOldUnit(c, it) { return !!(it && buysBigger(it) && linePer(c) === 1 && String(c.unit || 'ea').toLowerCase() === countUnit(it).toLowerCase()); }
async function cartToBuyUnit(itemId, qty) {
  const it = itemById(itemId); if (!it) return;
  const src = sourceFor(it, (inCartLine(itemId) || {}).vendor), price = src ? buyPriceOf(it, src) : null;
  await cartPatch(itemId, { qty: Number(qty) || 1, unit: buyUnit(it), per: perBuy(it), countUnit: countUnit(it), price: price || 0 }, 'unit');
}
/* taken out of the cart (not ordered): the log keeps who took it out, since the line itself is gone */
async function cartRemove(itemId) {
  const s = stamp(); let gone = null;
  await B.cart(list => { const i = list.findIndex(x => x && x.itemId === itemId); if (i >= 0) gone = list.splice(i, 1)[0]; return list; });
  if (gone) await B.addLog([logEntry({ type: 'cart', action: 'removed', itemId: gone.itemId, itemName: gone.name, qty: gone.qty, unit: gone.unit, vendor: gone.vendor || '', note: 'Taken out of the cart (added by ' + (gone.addedBy || 'someone') + (gone.addedAt ? ', ' + fmtWhen(gone.addedAt) : '') + ')' }, s)]);
  return gone;
}

/* ---------- orders ---------- */
function orderLineFromCart(c, ok) {
  const l = { itemId: c.itemId || '', name: c.name || '', sku: c.sku || '', qty: Number(c.qty) || 0, price: Number(c.price) || 0, unit: c.unit || 'ea' };
  if (linePer(c) > 1) { l.per = linePer(c); l.countUnit = c.countUnit || 'ea'; }
  l.lineTotal = round2(l.qty * l.price);
  ['addedBy', 'addedById', 'addedAt', 'note', 'cat'].forEach(k => { if (c[k] != null && c[k] !== '') l[k] = c[k]; });
  const tr = listOf(c.trail); if (tr.length) l.trail = tr;
  if (ok) l.ok = { by: ok.by || '', byId: ok.byId || '', at: ok.at || '' };
  return l;
}
/* the cart lines for one vendor become an open order, stamped with who ordered it, how, and when — Dr. A's OK'd ones (he places
   any). The lines leave the shared cart and the order is saved in one step, so two people placing the same order at once can't
   make it twice. → the order, with .waiting: lines left in the cart for his OK */
async function placeOrder(vendor, itemIds, info) {
  info = info || {}; const s = stamp(), boss = isOwnerAccount(); let order = null, waiting = 0;
  await B.cart((list, ok, also) => {
    const want = list.filter(c => c && itemIds.includes(c.itemId)), claimed = want.filter(c => boss || okOf(c, ok));
    waiting = want.length - claimed.length; order = null;
    if (!claimed.length) return undefined;
    order = { id: 'order-' + uid(), vendor: vendor || '', items: claimed.map(c => orderLineFromCart(c, okOf(c, ok) || okStamp(c, s))), status: 'open', dateOrdered: todayISO(), orderedAt: s.at, orderedBy: s.by, orderedById: s.byId || null,
      method: info.method || 'other', trail: trailAdd([], 'ordered', s, { how: info.method || 'other' }) };
    if (info.orderNumber) order.orderNumber = String(info.orderNumber).trim();
    if (info.expected) order.expectedDelivery = info.expected;
    if (info.note) order.note = String(info.note).trim();
    also.orders = [order];
    return list.filter(c => !claimed.includes(c));
  });
  if (!order) throw new Error(waiting ? (waiting === 1 ? 'That line waits' : 'Those lines wait') + ' for Dr. A’s OK.' : 'Those cart lines are gone — someone may have just ordered them.');
  stampLastOrdered(order);
  B.alert([alertOrderEvent('ordered', order)]);
  return Object.assign(order, { waiting });
}
/* an order typed in by hand (or a reorder) */
async function createOrder(o) {
  const s = stamp();
  const order = Object.assign({ id: 'order-' + uid(), status: 'open', dateOrdered: todayISO(), orderedAt: s.at, orderedBy: s.by, orderedById: s.byId || null, method: o.method || 'other' }, o);
  order.items = listOf(order.items).map(l => Object.assign({}, l, { lineTotal: round2((Number(l.qty) || 0) * (Number(l.price) || 0)) }));
  order.trail = trailAdd(o.trail, 'ordered', s, { how: order.method, by: order.orderedBy, byId: order.orderedById });
  await B.putOrder(order); stampLastOrdered(order);
  B.alert([alertOrderEvent('ordered', order)]);
  return order;
}
function stampLastOrdered(order) {
  const v = vendorByName(order.vendor), t = Date.now();
  B.patchItems(order.items.filter(l => l.itemId && itemById(l.itemId)).map(l => [l.itemId, { lastOrderedVendorId: order.vendor || (v && v.name) || '', lastOrderedTimestamp: t }])).catch(() => { });
}
async function editOrder(id, patch, what) {
  const o = orderById(id); if (!o) return; const s = stamp();
  /* a received order's lines are what stock and the budget were counted from — reopen it first */
  if (o.status === 'received' && patch.items) throw new Error('This order was already received. Reopen it first to change its lines.');
  const p = Object.assign({}, patch);
  if (p.items) p.items = listOf(p.items).map(l => { const n = Object.assign({}, l); if (n.lineTotal == null || what === 'edited') n.lineTotal = round2(Math.max(0, (Number(n.qty) || 0) * (Number(n.price) || 0) - (Number(n.discount) || 0))); return n; });
  /* in one step, from the order as the database has it (its trail with it): two computers at once don't trip each other */
  await B.orderStep(id, cur => cur.status === 'received' && p.items ? undefined : Object.assign({}, p, { trail: trailAdd(cur.trail, what || 'edited', s) }));
}
async function backorderOrder(id) { const s = stamp(); await B.orderStep(id, cur => cur.status === 'open' ? { status: 'backordered', dateBackordered: s.at, trail: trailAdd(cur.trail, 'backordered', s) } : undefined); }
async function unbackorderOrder(id) { const s = stamp(); await B.orderStep(id, cur => cur.status === 'backordered' ? { status: 'open', trail: trailAdd(cur.trail, 'unbackordered', s) } : undefined); }
async function unvoidOrder(id) { const s = stamp(); await B.orderStep(id, cur => cur.status === 'voided' ? { status: 'open', trail: trailAdd(cur.trail, 'unvoided', s) } : undefined); }
async function voidOrder(id, why) { const s = stamp(); await B.orderStep(id, cur => cur.status === 'voided' ? undefined : { status: 'voided', dateVoided: s.at, voidedBy: s.by, voidedById: s.byId || null, trail: trailAdd(cur.trail, 'voided', s, why ? { note: why } : null) }); }
/* "by Pat L." without a second full stop */
function byWho(name, otherwise) { return name ? ' by ' + String(name).replace(/\.$/, '') : (otherwise || ''); }

/* ---------- receiving ---------- */
/* what an order has already put into stock, per supply (a reopen nets it back to 0) */
function receivedSoFar(orderId) { const m = {}; S.D.log.forEach(l => { if (l && l.type === 'receive' && l.orderId === orderId) m[l.itemId] = (m[l.itemId] || 0) + (Number(l.delta) || 0); }); return m; }
function moneyBooked(orderId, type) { return S.D.log.reduce((a, l) => a + (l && l.type === type && l.orderId === orderId ? Number(l.amount) || 0 : 0), 0); }
/* opts: { lines: [{ qty, price, discount }] one per order line (blank = as ordered), discount, tax, shipping, reason: paid|discount|free|points|sample,
   makeBackorder (default true), count (false = mark received without touching stock), invoiceNumber,
   extraLines: [{ line, qty, price, discount }] lines that came but weren't on the order (a packing-slip scan),
   order: the order itself when it was only just written (so it's not looked up before it comes back), patch: more fields for the order,
   newIds: supplies added a moment ago by the same step (they get their stock even before they come back from the database) } */
async function receiveOrder(orderId, opts) {
  opts = opts || {}; const s = stamp();
  const order = opts.order || orderById(orderId); if (!order) throw new Error('That order is gone.');
  if (order.status === 'received') throw new Error('That order was already received' + byWho(order.receivedBy) + '.');
  const count = opts.count !== false;
  const reason = opts.reason || null, zeroCost = reason === 'free' || reason === 'points' || reason === 'sample';
  const extra = count && Array.isArray(opts.extraLines) ? opts.extraLines : [];
  const confirmed = count && Array.isArray(opts.lines) ? opts.lines.concat(extra.map(x => ({ qty: x.qty, price: x.price, discount: x.discount, extra: true }))) : null;
  let items = listOf(order.items).map(oi => Object.assign({}, oi)).concat(extra.map(x => Object.assign({}, x.line, { qty: x.qty }))); const backorder = [];
  if (confirmed) {
    items = items.map((oi, idx) => {
      const ln = confirmed[idx]; if (!ln) return oi;
      /* a typed-in line (no supply) that a packing slip tied to a supply */
      if (ln.link && ln.link.itemId && !oi.itemId) { oi = Object.assign({}, oi, { itemId: ln.link.itemId, unit: ln.link.unit || oi.unit }); delete oi.per; delete oi.countUnit; }
      /* ordered in boxes before the supply went by the case, and it came as cases: the line becomes cases (no backorder from the unit change) */
      const cit = ln.asCases && itemById(oi.itemId), asCases = !!(cit && buysBigger(cit));
      if (asCases) oi = Object.assign({}, oi, { unit: buyUnit(cit), per: perBuy(cit), countUnit: countUnit(cit), orderedAs: qtyUnit(oi.qty, oi.unit || 'ea') });
      const q = Math.max(0, Number(ln.qty) || 0), pr = Math.max(0, Number(ln.price) || 0), d = Math.max(0, Number(ln.discount) || 0), ordered = asCases ? q : Number(oi.qty) || 0;
      if (opts.makeBackorder !== false && !ln.extra && q < ordered) {
        const b = { name: oi.name || '', qty: round2(ordered - q), price: pr || oi.price || 0, itemId: oi.itemId || '', sku: oi.sku || '', unit: oi.unit || 'ea' };
        if (linePer(oi) > 1) { b.per = linePer(oi); b.countUnit = oi.countUnit || 'ea'; }
        backorder.push(b);
      }
      const n = Object.assign({}, oi, { qty: q, price: pr, discount: d > 0 ? round2(d) : null, lineTotal: zeroCost ? 0 : round2(Math.max(0, q * pr - d)) });
      if (ordered !== q) n.orderedQty = oi.orderedQty != null ? oi.orderedQty : ordered;
      return n;
    });
  }
  const ship = opts.shipping != null && opts.shipping !== '' ? (parseFloat(opts.shipping) || 0) : (Number(order.shipping) || 0);
  const patch = { status: 'received', dateReceived: s.at, countUpdated: count, receivedBy: s.by, receivedById: s.byId || null, shipping: ship };
  if (confirmed) {
    Object.assign(patch, { items, discount: (Number(opts.discount) || 0) > 0 ? round2(Number(opts.discount)) : null, invoiceTaxes: (Number(opts.tax) || 0) > 0 ? round2(Number(opts.tax)) : null,
      invoiceShipping: ship > 0 ? round2(ship) : null, receiveMethod: opts.method || 'manual' });
    if (reason) patch.costBasis = reason;
  }
  if (opts.invoiceNumber) patch.invoiceNumber = opts.invoiceNumber;
  if (opts.patch) Object.keys(opts.patch).forEach(k => { if (opts.patch[k] != null && opts.patch[k] !== '') patch[k] = opts.patch[k]; });
  const books = receiveBooks(order, orderId, opts, s, count, confirmed, items, backorder, reason, zeroCost, ship);
  /* all in one step — the order received, its backorder, its stock and dollars: it all happens or none of it, and if another
     computer is receiving the same order right now, only one of them goes on */
  const done = () => { B.alert([alertOrderEvent('received', Object.assign({}, order, patch))]); };
  try { await B.book(orderId, 'k' + uid(), cur => cur.status === 'received' ? undefined : Object.assign({}, patch, { trail: trailAdd(cur.trail, 'received', s, count ? null : { note: 'stock not counted' }) }), books); }
  catch (e) {
    if (e && e.code === 'aborted') { const o2 = orderById(orderId); throw new Error('That order was just received' + byWho(o2 && o2.receivedBy, ' on another computer') + '.'); }
    if (e && e.code === 'timeout' && e.late) e.late.then(x => { if (x) { done(); toast('The ' + (order.vendor || '') + ' order went through after all: it’s received, with its stock and dollars.', { ms: 8000 }); } }, () => { });
    throw e;
  }
  done();
}
/* what a receipt books, worked out before the step (from what this computer knows of the log): the backorder for what didn't
   come, the stock, the log entries (dollars), and for each supply what was paid this time */
function receiveBooks(order, orderId, opts, s, count, confirmed, items, backorder, reason, zeroCost, ship) {
  const out = { stock: {}, log: [], orders: [], items: null };
  if (backorder.length) {
    out.orders.push({ id: 'order-' + uid(), vendor: order.vendor || '', items: backorder.map(b => Object.assign(b, { lineTotal: round2(b.qty * b.price) })), dateOrdered: order.dateOrdered || '', orderedAt: order.orderedAt || null,
      orderedBy: order.orderedBy || null, orderedById: order.orderedById || null, method: order.method || null, expectedDelivery: '', status: 'open',
      note: 'BACKORDERED — from order ' + (order.dateOrdered || ''), backorderOf: orderId, trail: trailAdd([], 'backorder', s, { from: orderId }) });
  }
  if (!count) return out;
  /* stock and dollars — skipping anything this order already put on the books */
  const already = receivedSoFar(orderId), onBooks = oi => (already[oi.itemId] || 0) > 0;
  const orderDisc = (confirmed && !zeroCost) ? Math.max(0, Number(opts.discount) || 0) : 0, share = {};
  if (orderDisc > 0) {
    const ls = items.map((oi, k) => [oi, k]).filter(([oi]) => oi.itemId && !onBooks(oi) && orderItemCost(oi) > 0), sum = ls.reduce((a, [oi]) => a + orderItemCost(oi), 0); let given = 0;
    ls.forEach(([oi, k], i) => { const sh = i === ls.length - 1 ? round2(Math.min(orderDisc, sum) - given) : round2(orderItemCost(oi) / sum * Math.min(orderDisc, sum)); given += sh; share[k] = sh; });
  }
  const paid = {};   // itemId → [[vendor, price per counted unit, sku]] (remembered in the same step, on the supply as it is then)
  items.forEach((oi, k) => {
    if (!oi.itemId || onBooks(oi)) return;
    const amt = zeroCost ? 0 : round2(Math.max(0, orderItemCost(oi) - (share[k] || 0)));
    const it = itemById(oi.itemId), delta = lineStockDelta(oi);
    const e = logEntry({ itemId: oi.itemId, itemName: (it && it.name) || oi.name || oi.itemId, delta, note: 'Order received: ' + (order.vendor || ''), type: 'receive', amount: zeroCost ? 0 : (amt > 0 ? amt : null), orderId }, s);
    if (linePer(oi) > 1) { e.unit = oi.countUnit || ''; e.bought = qtyUnit(oi.qty, oi.unit); }
    if (reason) e.amountReason = reason;
    out.log.push(e);
    /* quick-order lines (elasto-…, bracket-…) aren't supplies: only real ones, or ones this scan just added (opts.newIds), get stock */
    if (delta && (it || listOf(opts.newIds).includes(oi.itemId))) {
      out.stock[oi.itemId] = round2((out.stock[oi.itemId] || 0) + delta);
      const pr = Number(oi.price) || 0, list = paid[oi.itemId] || (paid[oi.itemId] = []);
      if (it && confirmed && !zeroCost && order.vendor && pr > 0) list.push([order.vendor, pr / linePer(oi), oi.sku]);
    }
  });
  const priorShip = moneyBooked(orderId, 'shipping'), priorTax = moneyBooked(orderId, 'tax'), tax = parseFloat(opts.tax);
  if (ship > 0 && priorShip <= 0) out.log.push(logEntry({ type: 'shipping', amount: round2(ship), note: 'Shipping: ' + (order.vendor || ''), orderId }, s));
  if (confirmed && isFinite(tax) && tax > 0 && priorTax <= 0) out.log.push(logEntry({ type: 'tax', amount: round2(tax), note: 'Sales tax: ' + (order.vendor || ''), orderId }, s));
  const day = todayISO();
  out.items = (id, it) => {
    const upd = { chk: s.at, chkBy: s.by };
    (paid[id] || []).forEach(([v, p, sku]) => { upd.sources = rememberPrice(Object.assign({}, it, upd.sources ? { sources: upd.sources } : {}), v, p, sku, day); });
    return upd;
  };
  return out;
}
function rememberPrice(item, vendor, countPriceVal, sku, day) {
  const srcs = allSources(item).map(x => Object.assign({}, x));
  const ex = srcs.find(x => x && x.vendor === vendor) || srcs.find(x => x && x.vendor && vendorNamesSimilar(x.vendor, vendor));
  const p = Math.round(countPriceVal * 10000) / 10000;
  if (ex) { ex.price = p; ex.lastDate = day; if (sku && !ex.sku) ex.sku = sku; }
  else srcs.push({ vendor, sku: sku || '', price: p, src: '', lastDate: day });
  return srcs;
}
/* undo a receive: the stock it added comes back out, and the exact dollars it booked (and its shipping and tax) are reversed —
   worked out from the log entries tied to this order, once per supply, so an edited order or two lines for the same supply
   can't reverse too much */
function planReopen(order) {
  const rec = {}, names = {}; let ship = 0, tax = 0;
  S.D.log.forEach(l => {
    if (!l || l.orderId !== order.id) return;
    if (l.type === 'receive') { const r = rec[l.itemId] || (rec[l.itemId] = { amt: 0, delta: 0, has: false }); if (l.amount != null && isFinite(l.amount)) { r.amt += Number(l.amount); r.has = true; } r.delta += Number(l.delta) || 0; names[l.itemId] = l.itemName; }
    else if (l.type === 'shipping') ship += Number(l.amount) || 0; else if (l.type === 'tax') tax += Number(l.amount) || 0;
  });
  return { rec, names, ship: round2(ship), tax: round2(tax) };
}
async function reopenOrder(orderId) {
  const order = orderById(orderId); if (!order) return; const s = stamp();
  if (order.status !== 'received') throw new Error('That order isn’t received, so there’s nothing to undo.');
  const P = planReopen(order), log = [], stock = {};
  Object.keys(P.rec).forEach(itemId => {
    const r = P.rec[itemId], delta = r.delta > 0 ? r.delta : 0, amt = round2(r.amt);
    if (!delta && !(r.has && amt)) return;
    const it = itemById(itemId);
    log.push(logEntry({ itemId, itemName: (it && it.name) || P.names[itemId] || itemId, delta: -delta, note: 'Order reopened (receive undone): ' + (order.vendor || ''), type: 'receive', amount: r.has && amt ? -amt : null, orderId }, s));
    if (it && delta) stock[itemId] = -delta;
  });
  if (P.ship > 0) log.push(logEntry({ type: 'shipping', amount: -P.ship, note: 'Order reopened (shipping undone): ' + (order.vendor || ''), orderId }, s));
  if (P.tax > 0) log.push(logEntry({ type: 'tax', amount: -P.tax, note: 'Order reopened (tax undone): ' + (order.vendor || ''), orderId }, s));
  /* all in one step — open again, its stock back out, its dollars reversed: two computers reopening at once can't take it
     out twice, and it never ends up half done */
  const done = () => { B.alert([alertOrderEvent('reopened', Object.assign({}, order, { status: 'open' }))]); };
  try { await B.book(orderId, 'k' + uid(), cur => cur.status === 'received' ? { status: 'open', dateReceived: null, countUpdated: false, trail: trailAdd(cur.trail, 'reopened', s) } : undefined, { stock, log }); }
  catch (e) {
    if (e && e.code === 'aborted') throw new Error('That order was just reopened on another computer.');
    if (e && e.code === 'timeout' && e.late) e.late.then(x => { if (x) { done(); toast('The ' + (order.vendor || '') + ' order was reopened after all: its stock and dollars are taken back.', { ms: 8000 }); } }, () => { });
    throw e;
  }
  done();
}
/* shipping and tax for an order that already came in (the paper invoice arrives later), once per order */
async function addCostEntries(orderId, vendor, ship, tax) {
  const s = stamp(), e = [], sh = parseFloat(ship), tx = parseFloat(tax);
  if (isFinite(sh) && sh > 0 && moneyBooked(orderId, 'shipping') <= 0) e.push(logEntry({ type: 'shipping', amount: round2(sh), note: 'Shipping: ' + (vendor || ''), orderId: orderId || null }, s));
  if (isFinite(tx) && tx > 0 && moneyBooked(orderId, 'tax') <= 0) e.push(logEntry({ type: 'tax', amount: round2(tx), note: 'Sales tax: ' + (vendor || ''), orderId: orderId || null }, s));
  if (e.length) await B.addLog(e);
}

/* ---------- stock ---------- */
/* type: use | adjust | count (count = set exactly to setTo) */
async function stockStep(item, delta, type, note, setTo, extra) {
  const s = stamp(); type = type || 'adjust';
  if (type === 'count') {
    const live = Number((itemById(item.id) || item).qty) || 0; setTo = Math.max(0, Number(setTo) || 0); delta = setTo - live;
    await B.setStock(item.id, setTo);
  } else await B.addStock(item.id, Number(delta) || 0);
  await B.patchItem(item.id, { chk: s.at, chkBy: s.by });
  await B.addLog([logEntry(Object.assign({ itemId: item.id, itemName: item.name, delta: round2(delta), note: note || null, type }, extra || {}), s)]);
}

/* ---------- supplies ---------- */
async function saveItem(item, isNew) {
  const s = stamp(); item = Object.assign({}, item);
  if (isNew) { item.id = item.id || 'custom-' + uid(); item.createdBy = s.by; item.createdAt = s.at; if (item.qty == null) item.qty = 0; if (item.min == null) item.min = 0; await B.putItem(item); }
  else { const patch = Object.assign({}, item, { updatedBy: s.by, updatedAt: s.at }); delete patch.id; await B.patchItem(item.id, patch); }
  ensureVendors(allSources(item).map(x => x.vendor));
  return item;
}
async function archiveItem(item, on) { const s = stamp(); await B.patchItem(item.id, { archived: !!on, archivedBy: on ? s.by : null, archivedAt: on ? s.at : null }); }
async function deleteItem(item) { const s = stamp(); await B.patchItem(item.id, { deleted: true, deletedAt: s.at, deletedBy: s.by }); }
/* a vendor typed on a supply that isn't in the directory yet gets added to it */
function ensureVendors(names) {
  const have = new Set(S.D.vendors.map(v => String(v.name || '').trim().toLowerCase()));
  names.map(n => String(n || '').trim()).filter(Boolean).forEach(n => { if (have.has(n.toLowerCase())) return; have.add(n.toLowerCase());
    B.putVendor({ id: 'v-' + uid(), name: n, acct: null, portal: null, phone: null, tollFree: null, email: null, rep: null, repEmail: null, repPhone: null, address: null, note: null }).catch(() => { }); });
}

/* ---------- the alert emails (the "NLO Inventory Alerts" script reads these; same shape as before) ---------- */
function alertStr(v, max) { v = v == null ? '' : String(v); return v.length > max ? v.slice(0, max - 1) + '…' : v; }
function alertNum(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function alertLines(list) {
  return listOf(list).filter(Boolean).slice(0, 60).map(l => {
    const o = { n: alertStr(l.name || l.itemName || l.itemId || 'Item', 80), q: alertNum(l.qty) };
    if (l.unit) o.u = alertStr(l.unit, 16);
    const hasLine = l.lineTotal != null && l.lineTotal !== '' && isFinite(Number(l.lineTotal));
    const p = alertNum(hasLine ? l.lineTotal : (Number(l.price) || 0) * (Number(l.qty) || 0)); if (p) o.p = p;
    if (l.vendor) o.v = alertStr(l.vendor, 60);
    return o;
  });
}
function alertOrderEvent(t, o) {
  const lines = alertLines(o.items); let total = lines.reduce((a, l) => a + (l.p || 0), 0);
  if (t === 'received') total += (Number(o.invoiceTaxes) || 0) + (Number(o.shipping) || 0) - (Number(o.discount) || 0);
  const by = t === 'received' ? o.receivedBy : t === 'ordered' ? o.orderedBy : (whoNow() || {}).short;
  const e = { t, at: Date.now(), id: alertStr(o.id, 64), vendor: alertStr(o.vendor || '', 80), by: alertStr(by || '', 40), lines, total: alertNum(Math.max(0, total)) };
  if (o.note) e.note = alertStr(o.note, 160);
  if (o.dateOrdered) e.ordered = alertStr(o.dateOrdered, 24);
  if (o.method && t === 'ordered') e.how = alertStr(o.method, 20);
  if (t === 'received' && o.countUpdated === false) e.noCount = true;
  return e;
}
