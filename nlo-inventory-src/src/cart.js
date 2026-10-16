/* =====================================================================
   Cart — what's waiting to be ordered, one card per vendor. Each line
   shows who added it and when (and who changed it). Placing a vendor's
   order: pick how (their site, a call, an email, a text) — the app opens
   it with the order written out — then confirm it went through, and the
   lines become an open order stamped with who ordered it, how and when.
   Nothing leaves the cart until that confirmation.
   ===================================================================== */
const OFFICE = { name: 'Next Level Orthodontics', address: '320 NW 76th Drive, Gainesville, FL 32607', phone: '(352) 332-7466' };
const HOW = [
  ['online', 'Their website', 'web'], ['call', 'Phone call', 'call'], ['email', 'Email', 'email'], ['text', 'Text', 'text'], ['rep', 'Through the rep', 'user'], ['other', 'Some other way', 'doc']
];
function cartLinesFor(vendor) { return S.D.cart.filter(c => (c.vendor || '') === (vendor || '')); }
function cartLineHTML(c) {
  const it = itemById(c.itemId), tr = listOf(c.trail);
  return '<div class="cline">' + (it ? thumbHTML(it, 'sm') : '<span class="thumb sm">' + ic('bolt', 16) + '</span>') +
    '<div style="min-width:0"><div class="nm">' + (it ? '<a href="#" data-act="openItem" data-id="' + esc(it.id) + '" style="color:inherit;text-decoration:none">' + esc(c.name) + '</a>' : esc(c.name)) + (c.sku ? ' <small>#' + esc(c.sku) + '</small>' : '') + '</div>' +
    '<div class="stamps"><span class="stamp">' + avatarHTML(c.addedBy, 'xs', c.addedById) + '<span>Added by <b>' + esc(c.addedBy || 'someone') + '</b>' + (c.addedAt ? ' · ' + esc(fmtWhen(c.addedAt)) : '') + '</span></span>' +
    tr.slice(-2).map(t => '<span class="stamp">' + avatarHTML(t.by, 'xs', t.byId) + '<span>' + esc(t.t === 'more' ? '+' + qtyFmt(t.qty) + ' by ' : t.t === 'qty' ? qtyFmt(t.from) + ' → ' + qtyFmt(t.to) + ' by ' : t.t === 'note' ? 'note by ' : 'changed by ') + '<b>' + esc(t.by || '') + '</b> · ' + esc(fmtWhen(t.at)) + '</span></span>').join('') + '</div>' +
    (c.note ? '<div class="note">' + ic('text', 12) + ' ' + esc(c.note) + '</div>' : '') +
    (linePer(c) > 1 ? '<div class="note">' + esc(qtyUnit(c.qty, c.unit)) + ' = ' + esc(qtyUnit(c.qty * linePer(c), c.countUnit || '')) + '</div>' : '') +
    (lineInOldUnit(c, it) ? '<div class="oldUnit">' + ic('warn', 13) + '<span>Added as ' + esc(qtyUnit(c.qty, c.unit)) + ', but it’s bought by the ' + esc(buyUnit(it)) + ' now (' + esc(qtyUnit(perBuy(it), countUnit(it))) + ').</span><button class="linkBtn" data-act="cartToCases" data-id="' + esc(c.itemId) + '">Change to ' + esc(unitWord(buyUnit(it), 2)) + '</button></div>' : '') + '</div>' +
    '<div class="qty"><button data-act="cartStep" data-id="' + esc(c.itemId) + '" data-n="-1" aria-label="Less">−</button><input type="number" inputmode="decimal" min="0" value="' + esc(qtyFmt(c.qty)) + '" data-chg="cartQty" data-id="' + esc(c.itemId) + '" aria-label="Quantity"><span class="u">' + esc(unitWord(c.unit, c.qty)) + '</span><button data-act="cartStep" data-id="' + esc(c.itemId) + '" data-n="1" aria-label="More">+</button></div>' +
    '<div class="tot">' + (c.price ? money(c.price * c.qty) + '<small>' + money(c.price) + ' / ' + esc(c.unit || 'ea') + '</small>' : '<span class="muted">no price</span>') + '</div>' +
    '<button class="iconBtn rm" data-act="cartMenu" data-id="' + esc(c.itemId) + '" aria-label="More for this line">' + ic('edit', 16) + '</button></div>';
}
VIEWS.cart = {
  actions() { return '<button class="btn btn-teal" data-act="nav" data-v="supplies">' + ic('plus', 16) + 'Add supplies</button>'; },
  render() {
    const cart = S.D.cart;
    if (!cart.length) return '<div class="card"><div class="empty"><div class="big">🛒</div>The cart is empty.<br>Find what’s running low under <b>Supplies</b> (or <b>Quick order</b> for brackets and elastics) and tap <b>Add</b>.<br><br><button class="btn btn-teal" data-act="nav" data-v="supplies">' + ic('box', 16) + 'Find supplies</button></div></div>';
    let h = '<div class="hello">' + cart.length + ' line' + (cart.length === 1 ? '' : 's') + ' from ' + vendorsIn(cart).length + ' vendor' + (vendorsIn(cart).length === 1 ? '' : 's') + ' · about <b>' + money(cartValue()) + '</b>. Order one vendor at a time.</div>';
    vendorsIn(cart).forEach(vn => {
      const ls = cartLinesFor(vn), v = vendorByName(vn);
      h += '<div class="card vcard"><div class="cardHd">' + (vn ? vlogoHTML(v || { name: vn }, 'lg') : '<span class="vlogo lg none">' + ic('warn', 16) + '</span>') + '<div class="grow"><h3>' + esc(vn || 'No vendor yet') + '</h3>' +
        (v ? '<div class="vmeta">' + (v.acct ? '<span>Account ' + esc(v.acct) + '</span>' : '') + (v.portal ? '<a href="' + esc(v.portal) + '" target="_blank" rel="noopener">' + ic('web', 12) + ' Website</a>' : '') + (v.phone || v.tollFree ? '<a href="tel:' + esc(String(v.tollFree || v.phone).replace(/[^\d+]/g, '')) + '">' + ic('call', 12) + ' ' + esc(v.tollFree || v.phone) + '</a>' : '') + (v.rep ? '<span>Rep: ' + esc(v.rep) + '</span>' : '') + '</div>' : !vn ? '<div class="vmeta">Pick a vendor for these lines before ordering (the pencil on each line).</div>' : '') + '</div></div>' +
        ls.map(cartLineHTML).join('') +
        '<div class="vfoot"><span class="sum">' + ls.length + ' line' + (ls.length === 1 ? '' : 's') + ' · subtotal<b>' + money(cartValue(ls)) + '</b></span><span style="flex:1"></span>' +
        (vn ? '<button class="btn btn-pri" data-act="placeOrder" data-v="' + esc(vn) + '">' + ic('truck', 16) + 'Place this order</button>' : '') + '</div></div>';
    });
    return h;
  }
};
function confirmOut(c) { return confirmBox('Take it out of the cart?', c.name + ' (' + lineQtyLabel(c) + ', added by ' + (c.addedBy || '—') + '). Your name goes on the activity list.', 'Take it out', true); }
ACT.cartStep = async t => { const c = inCartLine(t.dataset.id); if (!c) return; const q = Math.max(0, (Number(c.qty) || 0) + Number(t.dataset.n)); if (!q && !await confirmOut(c)) return; withWho(() => act(() => cartSetQty(c.itemId, q)), 'Who’s changing the cart?'); };
CHG.cartQty = async t => { const c = inCartLine(t.dataset.id); if (!c) return; const q = num(t.value, -1); if (q < 0) return renderView(true); if (!q && !await confirmOut(c)) return renderView(true); withWho(() => act(() => cartSetQty(c.itemId, q)), 'Who’s changing the cart?'); };
ACT.cartMenu = t => {
  const c = inCartLine(t.dataset.id); if (!c) return; const it = itemById(c.itemId), srcs = it ? allSources(it) : [];
  const names = Array.from(new Set(srcs.map(s => s.vendor).filter(Boolean).concat(S.D.vendors.map(v => v.name)))).sort();
  openModal('<h3>' + esc(c.name) + '</h3><div class="lsub">' + esc(lineQtyLabel(c)) + ' · added by ' + esc(c.addedBy || '—') + (c.addedAt ? ', ' + esc(fmtWhen(c.addedAt)) : '') + '</div>' +
    field('Order it from', '<select id="cmVendor">' + (c.vendor ? '' : '<option value="">Pick a vendor…</option>') + names.map(n => '<option' + (n === c.vendor ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>', srcs.length > 1 ? 'Prices: ' + srcs.filter(s => countPrice(s) != null).map(s => esc(s.vendor) + ' ' + money(countPrice(s) * linePer(c))).join(' · ') : '') +
    '<div class="grid2">' + field('Price per ' + esc(c.unit || 'ea'), '<input id="cmPrice" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(c.price || '') + '">') + field('Note', '<input id="cmNote" value="' + esc(c.note || '') + '" placeholder="e.g. need by Thursday">') + '</div>' +
    '<div class="mFt"><button class="btn btn-ghost" data-act="cartRemove" data-id="' + esc(c.itemId) + '" style="color:var(--coral-700);margin-right:auto">' + ic('trash', 15) + 'Take out of the cart</button><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="cartMenuSave" data-id="' + esc(c.itemId) + '">Save</button></div>', { cls: 'mid', noFocus: true });
};
ACT.cartMenuSave = t => {
  const c = inCartLine(t.dataset.id); if (!c) return closeModal(true);
  const vendor = val('cmVendor'), price = round2(val('cmPrice')), note = val('cmNote').trim(), patch = {};
  if (vendor !== (c.vendor || '')) { patch.vendor = vendor; const it = itemById(c.itemId), src = it && allSources(it).find(s => s.vendor === vendor); if (src) { patch.sku = src.sku || c.sku || ''; if (val('cmPrice') === String(c.price || '')) patch.price = buyPriceOf(it, src) || c.price; } }
  if (price != null && price !== Number(c.price)) patch.price = price;
  if (note !== (c.note || '')) patch.note = note;
  if (!Object.keys(patch).length) return closeModal(true);
  withWho(async () => { if (await act(() => cartPatch(c.itemId, patch, patch.vendor !== undefined ? 'vendor' : patch.note !== undefined && Object.keys(patch).length === 1 ? 'note' : 'edit'), 'Saved.')) closeModal(true); }, 'Who’s changing the cart?');
};
ACT.cartToCases = async t => {
  const c = inCartLine(t.dataset.id), it = c && itemById(c.itemId); if (!it) return;
  const n = c.qty >= perBuy(it) ? Math.ceil(c.qty / perBuy(it)) : c.qty;
  const v = await confirmBox('How many ' + unitWord(buyUnit(it), 2) + '?', c.name + ' was added as ' + qtyUnit(c.qty, c.unit) + '. A ' + buyUnit(it) + ' is ' + qtyUnit(perBuy(it), countUnit(it)) + '.', 'Change it', false, { input: unitWord(buyUnit(it), 2), number: true, value: String(n) });
  if (v === false) return; const q = num(v); if (!(q > 0)) return toast('How many?', { bad: true });
  withWho(() => act(() => cartToBuyUnit(it.id, q), 'Now ' + qtyUnit(q, buyUnit(it)) + '.'), 'Who’s changing the cart?');
};
ACT.cartRemove = async t => { const c = inCartLine(t.dataset.id); if (!c) return; if (!await confirmOut(c)) return; withWho(async () => { if (await act(() => cartRemove(c.itemId), 'Taken out of the cart.')) closeModal(true); }, 'Who’s taking it out?'); };

/* ---------- placing an order ---------- */
function orderText(vn, lines, who) {
  const v = vendorByName(vn) || {};
  return 'Hello' + (v.rep ? ' ' + firstName(v.rep) : '') + ',\n\nPlease send the following to ' + OFFICE.name + (v.acct ? ' (account ' + v.acct + ')' : '') + ':\n\n' +
    lines.map(c => '• ' + qtyUnit(c.qty, c.unit) + ' — ' + c.name + (c.sku ? ' (#' + c.sku + ')' : '') + (c.price ? ' @ ' + money(c.price) : '')).join('\n') +
    '\n\nShip to: ' + OFFICE.address + '\nPhone: ' + OFFICE.phone + '\n\nPlease confirm the order and expected delivery. Thank you!\n' + (who ? firstName(who.name) + ', ' : '') + OFFICE.name;
}
ACT.placeOrder = t => withWho(w => {
  const vn = t.dataset.v, ls = cartLinesFor(vn), v = vendorByName(vn) || {};
  S.ui.place = { vendor: vn, ids: ls.map(c => c.itemId), how: v.portal ? 'online' : (v.email || v.repEmail) ? 'email' : (v.phone || v.tollFree) ? 'call' : 'other' };
  renderPlace();
}, 'Who’s placing this order?');
function renderPlace() {
  const P = S.ui.place, v = vendorByName(P.vendor) || { name: P.vendor }, w = whoNow(), ls = S.D.cart.filter(c => P.ids.includes(c.itemId));
  const text = orderText(P.vendor, ls, w), email = v.repEmail || v.email || '', phone = v.tollFree || v.phone || '', cell = v.repPhone || '';
  let detail = '';
  if (P.how === 'online') detail = v.portal ? '<a class="btn btn-act" href="' + esc(v.portal) + '" target="_blank" rel="noopener">' + ic('web', 16) + 'Open ' + esc(v.name) + '’s website</a><div class="hint">Add the lines below on their site and check out, then come back here.' + (v.acct ? ' Account: <b>' + esc(v.acct) + '</b>.' : '') + '</div>' : '<div class="notice">There’s no website saved for ' + esc(v.name) + '. Add it under Vendors.</div>';
  else if (P.how === 'call') detail = phone ? '<a class="btn btn-act" href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '">' + ic('call', 16) + 'Call ' + esc(phone) + '</a>' + (v.acct ? '<div class="hint">Account: <b>' + esc(v.acct) + '</b></div>' : '') : '<div class="notice">No phone number saved for ' + esc(v.name) + '.</div>';
  else if (P.how === 'email') detail = email ? '<a class="btn btn-act" href="mailto:' + esc(email) + '?subject=' + encodeURIComponent('Order — ' + OFFICE.name + (v.acct ? ' (acct ' + v.acct + ')' : '')) + '&body=' + encodeURIComponent(text) + '">' + ic('email', 16) + 'Write the email to ' + esc(email) + '</a><div class="hint">It opens in your email program with the order filled in.</div>' : '<div class="notice">No email saved for ' + esc(v.name) + '. Copy the order below into an email.</div>';
  else if (P.how === 'text') detail = cell ? '<a class="btn btn-act" href="sms:' + esc(cell.replace(/[^\d+]/g, '')) + '?&body=' + encodeURIComponent(text) + '">' + ic('text', 16) + 'Text ' + esc(v.rep || cell) + '</a>' : '<div class="notice">No mobile number saved for ' + esc(v.name) + '’s rep.</div>';
  openModal('<h3>Order from ' + esc(P.vendor) + '</h3><div class="lsub">' + ls.length + ' line' + (ls.length === 1 ? '' : 's') + ' · ' + money(cartValue(ls)) + ' · ordering as <b>' + esc(w ? w.short : '—') + '</b></div>' +
    '<div class="subH" style="margin-top:4px">How are you ordering?</div><div class="howGrid">' + HOW.map(([k, l, i]) => '<button class="how" data-act="placeHow" data-k="' + k + '" aria-pressed="' + (P.how === k) + '">' + ic(i, 20) + '<b>' + esc(l) + '</b><span>' + esc(k === 'online' ? (v.portal ? v.portal.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'no website saved') : k === 'call' ? (phone || 'no number saved') : k === 'email' ? (email || 'no email saved') : k === 'text' ? (cell || 'no mobile saved') : k === 'rep' ? (v.rep || 'no rep saved') : 'mark it ordered') + '</span></button>').join('') + '</div>' +
    detail +
    '<div class="subH">The order</div><div class="copyBox" id="orderTxt">' + esc(text) + '</div><div class="btnRow"><button class="btn btn-ghost" data-act="copyOrder">' + ic('copy', 15) + 'Copy</button></div>' +
    '<div class="subH">When it’s placed</div><div class="grid2">' + field('Their order or confirmation # (optional)', '<input id="poNum" placeholder="e.g. 4815162">') + field('Expected delivery (optional)', '<input id="poDate" type="date" min="' + todayISO() + '">') + '</div>' +
    field('Note (optional)', '<input id="poNote" placeholder="e.g. rep said gloves ship separately">') +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Not yet — keep it in the cart</button><button class="btn btn-pri" data-act="placeGo">' + ic('check', 16) + 'It’s ordered — move to On the way</button></div>', { cls: 'wide', noFocus: true });
}
ACT.placeHow = t => { S.ui.place.how = t.dataset.k; const n = val('poNum'), d = val('poDate'), x = val('poNote'); renderPlace(); $('#poNum').value = n; $('#poDate').value = d; $('#poNote').value = x; };
ACT.copyOrder = () => copyText($('#orderTxt').textContent);
ACT.placeGo = t => withWho(async () => {
  const P = S.ui.place; busyBtn(t, true, 'Saving…');
  try {
    const o = await placeOrder(P.vendor, P.ids, { method: P.how, orderNumber: val('poNum'), expected: val('poDate'), note: val('poNote') });
    closeModal(true); toast('Ordered from ' + P.vendor + ' — it’s under Orders → On the way.', { action: 'Show', onAction: () => { go('orders'); openDrawer('order', o.id); } });
  } catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
}, 'Who placed this order?');
