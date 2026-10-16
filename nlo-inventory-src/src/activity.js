/* =====================================================================
   Activity — one timeline of who did what, and when: added to the cart,
   changed or took out of the cart, placed an order (and how), received
   it, reopened, backordered or voided it, used or counted stock.
   It's put together from the records themselves (cart lines, orders and
   their trails, the activity log), so nothing extra is stored for it.
   Older records from before trails existed show what they have: who
   ordered and received, and on which day.
   ===================================================================== */
/* {v} is the vendor */
const ORDER_WORDS = { ordered: 'placed the {v} order', received: 'received the {v} order', reopened: 'reopened the {v} order', backordered: 'marked the {v} order backordered', unbackordered: 'took the {v} order off backorder', voided: 'voided the {v} order', edited: 'changed the {v} order', invoice: 'matched the invoice to the {v} order', backorder: 'started a backorder for what didn’t come from {v}', note: 'added a note to the {v} order' };
function orderWords(k, vendor) { return esc(ORDER_WORDS[k] || k + ' the {v} order').replace('{v}', '<b>' + esc(vendor || 'vendor') + '</b>'); }
const HOW_WORDS = { online: 'online', call: 'by phone', phone: 'by phone', email: 'by email', text: 'by text', rep: 'through the rep', portal: 'online', other: '' };
function feedEvents(opt) {
  opt = opt || {}; const ev = [], D = S.D;
  const add = (o) => { if (!o.at) return; if (o.whoId) o.who = stampName(o.who, o.whoId); ev.push(o); };
  const vname = n => esc(n || 'a vendor');
  const lineTxt = l => '<b>' + esc(lineQtyLabel(l)) + '</b> of ' + esc(l.name || 'a supply');
  /* the cart */
  D.cart.forEach(c => {
    add({ at: msOf(c.addedAt), who: c.addedBy, whoId: c.addedById, kind: 'cart', icon: 'cart', html: 'added ' + lineTxt(Object.assign({}, c, { qty: firstQty(c) })) + ' to the cart', ref: { item: c.itemId }, where: 'In the cart' });
    listOf(c.trail).forEach(t => add(cartTrailEvent(c, t)));
  });
  /* orders */
  D.orders.forEach(o => {
    const sum = o.items.length + ' line' + (o.items.length === 1 ? '' : 's') + ' · ' + money(orderTotal(o));
    o.items.forEach(l => {
      if (l.addedAt) add({ at: msOf(l.addedAt), who: l.addedBy, whoId: l.addedById, kind: 'cart', icon: 'cart', html: 'added ' + lineTxt(Object.assign({}, l, { qty: firstQty(l) })) + ' to the cart', ref: { order: o.id }, where: 'Ordered from ' + (o.vendor || '—') });
      listOf(l.trail).forEach(t => add(Object.assign(cartTrailEvent(l, t), { ref: { order: o.id } })));
    });
    const tr = listOf(o.trail);
    if (tr.length) tr.forEach(t => {
      const how = t.t === 'ordered' && HOW_WORDS[t.how] ? ' ' + HOW_WORDS[t.how] : '';
      add({ at: msOf(t.at), who: t.by, whoId: t.byId, kind: t.t === 'received' ? 'recv' : t.t === 'voided' ? 'bad' : 'order', icon: t.t === 'received' ? 'receive' : t.t === 'voided' ? 'x' : 'truck',
        html: orderWords(t.t, o.vendor) + how + (t.note ? ' — ' + esc(t.note) : ''), amount: t.t === 'ordered' || t.t === 'received' ? orderTotal(o) : null, sub: sum, ref: { order: o.id } });
    });
    else {
      if (o.orderedBy || o.dateOrdered) add({ at: msOf(o.orderedAt || o.dateOrdered), dayOnly: !o.orderedAt, who: o.orderedBy || '', kind: 'order', icon: 'truck', html: orderWords('ordered', o.vendor), amount: orderTotal(o), sub: sum, ref: { order: o.id } });
      if (o.dateReceived) add({ at: msOf(o.dateReceived), who: o.receivedBy || '', kind: 'recv', icon: 'receive', html: orderWords('received', o.vendor), amount: orderTotal(o), sub: sum, ref: { order: o.id } });
      if (o.status === 'voided' && o.dateVoided) add({ at: msOf(o.dateVoided), who: o.voidedBy || '', kind: 'bad', icon: 'x', html: orderWords('voided', o.vendor), ref: { order: o.id } });
      if (o.dateBackordered) add({ at: msOf(o.dateBackordered), who: '', kind: 'order', icon: 'pause', html: 'the <b>' + vname(o.vendor) + '</b> order was marked backordered', ref: { order: o.id } });
    }
  });
  /* the log: stock steps, cart removals, receipts that didn't come through an order */
  D.log.forEach(e => {
    if (!e) return; const at = logTime(e), it = itemById(e.itemId), name = esc(e.itemName || (it && it.name) || 'a supply'), unit = (it && countUnit(it)) || e.unit || '';
    if (e.type === 'cart') add({ at, who: e.by, whoId: e.byId, kind: 'bad', icon: 'trash', html: 'took <b>' + esc(qtyUnit(e.qty || 0, e.unit || 'ea')) + '</b> of ' + name + ' out of the cart', sub: e.note ? plainText(e.note.replace(/^Taken out of the cart /, ''), 90) : '', ref: { item: e.itemId } });
    else if (e.type === 'receive' && !e.orderId) add({ at, who: e.by, whoId: e.byId, kind: 'recv', icon: 'receive', html: (Number(e.delta) < 0 ? 'took back ' : 'received ') + '<b>' + esc(qtyUnit(Math.abs(e.delta || 0), unit)) + '</b> of ' + name + (e.note ? ' <span class="muted">(' + esc(plainText(e.note, 60)) + ')</span>' : ''), amount: e.amount != null ? Number(e.amount) : null, ref: { item: e.itemId } });
    else if (e.type === 'use') add({ at, who: e.by, whoId: e.byId, kind: 'stock', icon: 'minus', html: 'used <b>' + esc(qtyUnit(Math.abs(e.delta || 0), unit)) + '</b> of ' + name, ref: { item: e.itemId } });
    else if (e.type === 'count') { const d = Number(e.delta) || 0; add({ at, who: e.by, whoId: e.byId, kind: 'stock', icon: 'count', html: 'counted ' + name + ' <span class="muted">(' + (d > 0 ? '+' : d < 0 ? '−' : '±') + esc(qtyUnit(Math.abs(d), unit)) + ')</span>', ref: { item: e.itemId } }); }
    else if (e.type === 'adjust' || e.type === 'scan') add({ at, who: e.by, whoId: e.byId, kind: 'stock', icon: Number(e.delta) < 0 ? 'minus' : 'plus', html: (Number(e.delta) < 0 ? 'took ' : 'added ') + '<b>' + esc(qtyUnit(Math.abs(e.delta || 0), unit)) + '</b> ' + (Number(e.delta) < 0 ? 'from ' : 'to ') + name + (e.note ? ' <span class="muted">(' + esc(plainText(e.note, 60)) + ')</span>' : ''), ref: { item: e.itemId } });
  });
  ev.sort((a, b) => b.at - a.at);
  return ev;
}
function firstQty(l) { const tr = listOf(l.trail); if (!tr.length) return l.qty; let q = Number(l.qty) || 0; for (let i = tr.length - 1; i >= 0; i--) { const t = tr[i]; if (t.t === 'more') q -= Number(t.qty) || 0; else if (t.t === 'qty') q = Number(t.from) || q; } return q > 0 ? q : l.qty; }
function cartTrailEvent(l, t) {
  const name = esc(l.name || 'a supply');
  if (t.t === 'more') return { at: msOf(t.at), who: t.by, whoId: t.byId, kind: 'cart', icon: 'plus', html: 'added <b>' + esc(qtyUnit(t.qty, l.unit)) + '</b> more of ' + name + ' to the cart', ref: { item: l.itemId } };
  if (t.t === 'qty') return { at: msOf(t.at), who: t.by, whoId: t.byId, kind: 'cart', icon: 'edit', html: 'changed ' + name + ' in the cart from ' + esc(qtyFmt(t.from)) + ' to <b>' + esc(qtyUnit(t.to, l.unit)) + '</b>', ref: { item: l.itemId } };
  if (t.t === 'unit') return { at: msOf(t.at), who: t.by, whoId: t.byId, kind: 'cart', icon: 'edit', html: 'changed ' + name + ' in the cart to <b>' + esc(unitWord(l.unit, 2)) + '</b>', ref: { item: l.itemId } };
  return { at: msOf(t.at), who: t.by, whoId: t.byId, kind: 'cart', icon: 'edit', html: 'changed ' + name + ' in the cart', ref: { item: l.itemId } };
}
function feedItemHTML(e, compact) {
  const who = e.who ? '<b>' + esc(e.who) + '</b> ' : '<span class="muted">Someone</span> ';
  const open = e.ref && e.ref.order ? ' data-act="openOrder" data-id="' + esc(e.ref.order) + '" role="button" tabindex="0" style="cursor:pointer"' : e.ref && e.ref.item && itemById(e.ref.item) ? ' data-act="openItem" data-id="' + esc(e.ref.item) + '" role="button" tabindex="0" style="cursor:pointer"' : '';
  return '<div class="fi"' + open + '><span class="ico k-' + e.kind + '">' + ic(e.icon, 15) + '</span><div class="grow"><div class="t">' + who + e.html + '</div>' +
    '<div class="w">' + (e.who ? avatarHTML(e.who, 'xs', e.whoId) : '') + '<span>' + (e.dayOnly ? fmtWhen(dayOf(e.at)) : fmtWhen(e.at)) + '</span>' + (!compact && e.sub ? '<span>· ' + esc(e.sub) + '</span>' : '') + (!compact && e.where ? '<span>· ' + esc(e.where) + '</span>' : '') + '</div></div>' +
    (e.amount != null && e.amount !== 0 ? '<span class="amt">' + money(e.amount) + '</span>' : '') + '</div>';
}

/* ---------- the Activity screen ---------- */
VIEWS.activity = {
  render() {
    const u = S.ui.act || (S.ui.act = { who: '', kind: '', days: 30 });
    let ev = feedEvents();
    const since = Date.now() - u.days * 864e5;
    if (u.days) ev = ev.filter(e => e.at >= since);
    if (u.who) ev = ev.filter(e => (e.whoId && e.whoId === u.who) || (personByName(e.who) || {}).id === u.who || e.who === u.who);
    if (u.kind) ev = ev.filter(e => u.kind === 'stock' ? (e.kind === 'stock') : u.kind === 'order' ? (e.kind === 'order' || e.kind === 'bad' && e.ref && e.ref.order) : e.kind === u.kind);
    if (S.q) ev = ev.filter(e => matchesAll((e.who || '') + ' ' + e.html.replace(/<[^>]+>/g, ' ') + ' ' + (e.sub || ''), S.q));
    const people = new Map(); feedEvents().forEach(e => { if (e.who) { const p = (e.whoId && personById(e.whoId)) || personByName(e.who); const id = p ? p.id : e.who; if (!people.has(id)) people.set(id, p ? p.short : e.who); } });
    const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>';
    let h = '<div class="filters">' +
      '<select data-chg="actWho" aria-label="Person">' + opt('', 'Everyone', u.who) + Array.from(people).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => opt(id, n, u.who)).join('') + '</select>' +
      '<select data-chg="actKind" aria-label="What">' + opt('', 'Everything', u.kind) + opt('cart', 'Cart', u.kind) + opt('order', 'Orders', u.kind) + opt('recv', 'Receiving', u.kind) + opt('stock', 'Stock counts and use', u.kind) + opt('bad', 'Taken out / voided', u.kind) + '</select>' +
      '<select data-chg="actDays" aria-label="When">' + opt('7', 'Last 7 days', String(u.days)) + opt('30', 'Last 30 days', String(u.days)) + opt('90', 'Last 90 days', String(u.days)) + opt('0', 'All time', String(u.days)) + '</select>' +
      '<span class="muted small">' + ev.length + ' step' + (ev.length === 1 ? '' : 's') + '</span></div>';
    if (!ev.length) return h + '<div class="card"><div class="empty">Nothing here for those choices.</div></div>';
    let day = '', body = '';
    ev.slice(0, 400).forEach(e => { const d = dayOf(e.at); if (d !== day) { day = d; body += '<div class="dayHd">' + esc(d === todayISO() ? 'Today' : d === addDays(todayISO(), -1) ? 'Yesterday' : fmtDay(d)) + '</div>'; } body += feedItemHTML(e); });
    return h + '<div class="card"><div class="cardBd" style="padding-top:2px"><div class="feed">' + body + '</div>' + (ev.length > 400 ? '<div class="empty">Showing the newest 400. Narrow it down above to see older steps.</div>' : '') + '</div></div>';
  }
};
CHG.actWho = t => { S.ui.act.who = t.value; renderView(true); };
CHG.actKind = t => { S.ui.act.kind = t.value; renderView(true); };
CHG.actDays = t => { S.ui.act.days = Number(t.value) || 0; renderView(true); };
