/* =====================================================================
   Receiving an order by hand (the standard way since Sept 2026; the
   packing-slip scanner is the other). Every line shows what was
   ordered; the boxes start empty with the ordered numbers as hints, so a
   delivery that matches is one tap. A short line starts a backorder for
   the rest. Bought-bigger lines say what they add to stock (2 cases =
   20 boxes). It's stamped with who received it and when.
   ===================================================================== */
/* the price hint for a line: what was paid (line total + discount ÷ qty), else the order's price, else the supply's price from this vendor */
function receivePlaceholderPrice(oi, order) {
  const q = Number(oi.qty) || 0;
  if (oi.lineTotal != null && q > 0 && Number(oi.lineTotal) > 0) return round2((Number(oi.lineTotal) + (Number(oi.discount) || 0)) / q);
  if (Number(oi.price) > 0) return round2(oi.price);
  const it = itemById(oi.itemId); if (!it) return null;
  const src = sourceFor(it, order.vendor); const cp = countPrice(src);
  return cp == null ? null : round2(cp * linePer(oi));
}
ACT.receive = t => {
  const o = orderById(t.dataset.id); if (!o) return;
  if (o.status === 'received') return toast('Already received' + (o.receivedBy ? ' by ' + o.receivedBy : '') + '.', { bad: true });
  withWho(() => openReceive(o), 'Who’s receiving this order?');
};
/* what the dialog was built from — if the order changes on another computer meanwhile, the boxes no longer line up */
function orderSig(o) { return (o.items || []).map(l => (l.itemId || l.name || '') + ':' + (l.qty || 0) + ':' + (l.unit || '')).join('|'); }
function openReceive(o) {
  S.ui.rcv = { id: o.id, reason: 'paid', back: true, sig: orderSig(o) };
  const w = whoNow();
  const rows = o.items.map((l, k) => {
    const pp = receivePlaceholderPrice(l, o), old = lineInOldUnit(l, itemById(l.itemId)), it = itemById(l.itemId);
    return '<tr><td class="n"><b>' + esc(l.name || '') + '</b><small>' + (l.sku ? '#' + esc(l.sku) + ' · ' : '') + 'ordered ' + esc(lineQtyLabel(l)) + (l.addedBy ? ' · added by ' + esc(firstName(l.addedBy)) : '') + '</small></td>' +
      '<td><input type="number" inputmode="decimal" min="0" step="any" placeholder="' + esc(qtyFmt(l.qty)) + '" data-rc="qty" data-k="' + k + '" data-inp="rcCalc" aria-label="Received"><span class="eq" id="rcEq' + k + '">' + (linePer(l) > 1 ? '= ' + esc(qtyUnit(l.qty * linePer(l), l.countUnit || '')) : esc(unitWord(l.unit, l.qty))) + '</span>' +
        (old ? '<label class="chk tiny"><input type="checkbox" data-rc="cases" data-k="' + k + '" data-chg="rcCases"> came as ' + esc(unitWord(buyUnit(it), 2)) + '</label>' : '') + '</td>' +
      '<td><input type="number" inputmode="decimal" min="0" step="0.01" placeholder="' + esc(pp != null ? pp.toFixed(2) : '0.00') + '" data-rc="price" data-k="' + k + '" data-inp="rcCalc" aria-label="Price each"><span class="eq" id="rcPu' + k + '">per ' + esc(l.unit || 'ea') + '</span></td>' +
      '<td><input type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" data-rc="disc" data-k="' + k + '" data-inp="rcCalc" aria-label="Line discount"></td>' +
      '<td class="lt" id="rcLt' + k + '"></td></tr>';
  }).join('');
  openModal('<h3>Receive the ' + esc(o.vendor || '') + ' order</h3><div class="lsub">Ordered by ' + esc(o.orderedBy || '—') + (o.orderedAt || o.dateOrdered ? ', ' + esc(fmtWhen(o.orderedAt || o.dateOrdered)) : '') + ' · receiving as <b>' + esc(w ? w.short : '') + '</b><br>Leave a box empty when it matches the grey number.</div>' +
    '<div class="tblWrap"><table class="rtable"><thead><tr><th>Supply</th><th>Received</th><th>Price each</th><th>Line discount</th><th class="right">Line</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="rsum">' + field('Order discount', '<input id="rcOD" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" data-inp="rcCalc">') + field('Sales tax', '<input id="rcTax" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" data-inp="rcCalc">') +
    field('Shipping', '<input id="rcShip" type="number" inputmode="decimal" min="0" step="0.01" placeholder="' + esc(num(o.shipping) ? Number(o.shipping).toFixed(2) : '0.00') + '" data-inp="rcCalc">') + field('Invoice # (optional)', '<input id="rcInv" value="' + esc(o.invoiceNumber || '') + '">') + '</div>' +
    '<div class="subH" style="margin-top:4px">What it cost</div><div class="pickRow">' + [['paid', 'Paid'], ['discount', 'Paid, with a discount'], ['points', 'Paid with points'], ['free', 'Free'], ['sample', 'Sample']].map(([k, l]) => '<button class="pick sm" data-act="rcReason" data-k="' + k + '" aria-pressed="' + (k === 'paid') + '">' + esc(l) + '</button>').join('') + '</div>' +
    '<label class="chk" style="margin-top:12px"><input type="checkbox" id="rcBack" checked> If something came short, keep the rest on order (a backorder)</label>' +
    '<div class="rtot" id="rcTot"></div>' +
    '<div class="mFt"><button class="btn btn-ghost" data-act="rcSlip" style="margin-right:auto">' + ic('camera', 15) + 'Scan the slip instead</button><button class="btn btn-ghost" data-act="rcNoCount">Mark received, don’t count</button><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" data-act="rcGo">' + ic('check', 16) + 'Received</button></div>', { cls: 'wide', noFocus: true });
  INP.rcCalc();
}
function rcValues() {
  const o = orderById(S.ui.rcv.id), zero = ['free', 'points', 'sample'].includes(S.ui.rcv.reason);
  const lines = o.items.map((l, k) => {
    const g = f => { const el = $('[data-rc="' + f + '"][data-k="' + k + '"]'); return el && el.value !== '' ? num(el.value) : null; };
    const cb = $('[data-rc="cases"][data-k="' + k + '"]'), asCases = !!(cb && cb.checked), it = itemById(l.itemId), m = asCases && it ? perBuy(it) : 1;
    const qty = g('qty'), price = g('price'), disc = g('disc'), pp0 = receivePlaceholderPrice(l, o), pp = pp0 != null ? round2(pp0 * m) : null;
    const q = qty != null ? qty : Number(l.qty) || 0, p = price != null ? price : (pp != null ? pp : 0), d = disc || 0;
    return { qty: q, price: p, discount: d, lineTotal: zero ? 0 : round2(Math.max(0, q * p - d)), priceEntered: price != null, asCases };
  });
  const sub = lines.reduce((a, l) => a + l.lineTotal, 0), od = zero ? 0 : num(val('rcOD')), tax = num(val('rcTax')), ship = val('rcShip') !== '' ? num(val('rcShip')) : num(o.shipping);
  return { o, lines, sub, od, tax, ship, total: round2(sub - od + tax + ship) };
}
/* "came as cases": that line's numbers are cases now (its price hint too) */
CHG.rcCases = t => {
  const k = Number(t.dataset.k), o = orderById(S.ui.rcv.id), l = o && o.items[k], it = l && itemById(l.itemId); if (!it) return;
  const pi = $('[data-rc="price"][data-k="' + k + '"]'), pp = receivePlaceholderPrice(l, o);
  if (pi && pp != null) pi.placeholder = (t.checked ? round2(pp * perBuy(it)) : pp).toFixed(2);
  const pu = $('#rcPu' + k); if (pu) pu.textContent = 'per ' + (t.checked ? buyUnit(it) : (l.unit || 'ea'));
  INP.rcCalc();
};
INP.rcCalc = () => {
  const r = rcValues(); if (!r.o) return;
  r.lines.forEach((l, k) => {
    const el = $('#rcLt' + k); if (el) el.textContent = money(l.lineTotal);
    const oi = r.o.items[k], eq = $('#rcEq' + k), it = itemById(oi.itemId);
    if (eq && linePer(oi) > 1) eq.textContent = '= ' + qtyUnit(l.qty * linePer(oi), oi.countUnit || '');
    else if (eq && l.asCases && it) eq.textContent = unitWord(buyUnit(it), l.qty) + ' = ' + qtyUnit(l.qty * perBuy(it), countUnit(it));
    else if (eq) eq.textContent = unitWord(oi.unit, l.qty);
  });
  const short = r.lines.some((l, k) => !l.asCases && l.qty < (Number(r.o.items[k].qty) || 0));
  $('#rcTot').innerHTML = (short ? '<span style="color:var(--amber-700);font-weight:700">Some lines came short</span>' : '') + '<span>Lines' + '<b>' + money(r.sub) + '</b></span><span>Total<b>' + money(r.total) + '</b></span>';
};
ACT.rcReason = t => { S.ui.rcv.reason = t.dataset.k; $$('.pick[data-act="rcReason"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); INP.rcCalc(); };
ACT.rcGo = t => {
  const r = rcValues(); if (!r.o) return closeModal(true);
  if (r.o.status === 'received') { closeModal(true); return toast('This order was just received' + (r.o.receivedBy ? ' by ' + r.o.receivedBy : '') + '.', { bad: true }); }
  if (orderSig(r.o) !== S.ui.rcv.sig) { toast('This order was just changed on another computer — here it is again with the change.', { bad: true }); return openReceive(r.o); }
  withWho(async () => {
    busyBtn(t, true, 'Saving…');
    const ok = await act(() => receiveOrder(r.o.id, { lines: r.lines, discount: r.od, tax: r.tax, shipping: val('rcShip') !== '' ? r.ship : '', reason: S.ui.rcv.reason, makeBackorder: $('#rcBack').checked, invoiceNumber: val('rcInv').trim() || null }));
    if (ok) { closeModal(true); toast('Received — ' + r.o.vendor + ', ' + money(r.total) + '. Stock and the budget are updated.'); } else busyBtn(t, false);
  }, 'Who’s receiving this order?');
};
ACT.rcNoCount = async t => {
  const o = orderById(S.ui.rcv.id); if (!o) return;
  if (!await confirmBox('Mark it received, without counting?', 'Nothing is added to stock or the budget. Use this when the stock was already counted some other way.', 'Mark received')) return openReceive(o);
  withWho(async () => { if (await act(() => receiveOrder(o.id, { count: false }), 'Marked received.')) closeModal(true); });
};
ACT.rcSlip = () => { const id = S.ui.rcv.id; closeModal(true); openSlipScanner(id); };
