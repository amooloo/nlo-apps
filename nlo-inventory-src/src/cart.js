/* =====================================================================
   Cart — what's waiting to be ordered, one card per vendor. Each line
   shows who added it and when (and who changed it). Placing a vendor's
   order: pick how (their site, a call, an email, a text) — the app opens
   it with the order written out — then confirm it went through, and the
   lines become an open order stamped with who ordered it, how and when.
   Nothing leaves the cart until that confirmation.
   Dr. A OKs what goes out (Amir, 16 Oct 2026: "if I approve them, they
   can place order"): a line someone else adds waits for his OK; the
   others place the OK'd lines, he places any.
   ===================================================================== */
const OFFICE = { name: 'Next Level Orthodontics', address: '320 NW 76th Drive, Gainesville, FL 32607', phone: '(352) 332-7466' };
const HOW = [
  ['online', 'Their website', 'web'], ['call', 'Phone call', 'call'], ['email', 'Email', 'email'], ['text', 'Text', 'text'], ['rep', 'Through the rep', 'user'], ['other', 'Some other way', 'doc']
];
function cartLinesFor(vendor) { return S.D.cart.filter(c => (c.vendor || '') === (vendor || '')); }
/* where a line stands with Dr. A: his OK, or waiting for it (and what he OK'd, when it changed after) */
function okRowHTML(c) {
  const o = okOf(c), why = okWhy(c), had = why ? ' (' + why + ')' : '';
  if (o) return '<div class="okRow"><span class="stat ok" title="' + esc(fmtWhen(o.at)) + '">' + ic('check', 12) + (isAdmin() ? 'OK’d' : 'OK’d by Dr. A') + '</span></div>';
  if (isAdmin()) return '<div class="okRow"><span class="stat wait">Needs your OK' + esc(had) + '</span><button class="btn btn-act btn-sm" data-act="cartOk" data-line="' + esc(c.lineId) + '">' + ic('check', 14) + 'OK</button></div>';
  return '<div class="okRow"><span class="stat wait">Waiting for Dr. A’s OK' + esc(had) + '</span></div>';
}
function cartLineHTML(c) {
  const it = itemById(c.itemId), tr = listOf(c.trail);
  return '<div class="cline">' + (it ? thumbHTML(it, 'md', true) : '<span class="thumb md">' + ic('bolt', 20) + '</span>') +
    '<div style="min-width:0"><div class="nm">' + (it ? '<a href="#" data-act="openItem" data-id="' + esc(it.id) + '" style="color:inherit;text-decoration:none">' + esc(c.name) + '</a>' : esc(c.name)) + (c.sku ? ' <small>#' + esc(c.sku) + '</small>' : '') + '</div>' +
    '<div class="stamps"><span class="stamp">' + avatarHTML(c.addedBy, 'xs', c.addedById) + '<span>Added by <b>' + esc(c.addedBy || 'someone') + '</b>' + (c.addedAt ? ' · ' + esc(fmtWhen(c.addedAt)) : '') + '</span></span>' +
    tr.slice(-2).map(t => '<span class="stamp">' + avatarHTML(t.by, 'xs', t.byId) + '<span>' + esc(t.t === 'more' ? '+' + qtyFmt(t.qty) + ' by ' : t.t === 'qty' ? qtyFmt(t.from) + ' → ' + qtyFmt(t.to) + ' by ' : t.t === 'note' ? 'note by ' : t.t === 'ok' ? 'OK’d by ' : 'changed by ') + '<b>' + esc(t.by || '') + '</b> · ' + esc(fmtWhen(t.at)) + '</span></span>').join('') + '</div>' +
    okRowHTML(c) +
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
    const boss = isAdmin(), wait = cart.filter(c => !okOf(c));
    let h = '<div class="hello">' + cart.length + ' line' + (cart.length === 1 ? '' : 's') + ' from ' + vendorsIn(cart).length + ' vendor' + (vendorsIn(cart).length === 1 ? '' : 's') + ' · about <b>' + money(cartValue()) + '</b>. Order one vendor at a time.</div>';
    if (wait.length) h += boss ? '<div class="okBar">' + ic('check', 16) + '<span class="grow"><b>' + plural(wait.length, 'line') + '</b> ' + (wait.length === 1 ? 'needs' : 'need') + ' your OK before anyone else can order ' + (wait.length === 1 ? 'it' : 'them') + '.</span><button class="btn btn-act btn-sm" data-act="cartOkAll">OK ' + (wait.length === 1 ? 'it' : 'all ' + wait.length) + '</button></div>'
      : '<div class="okBar wait">' + ic('clock', 16) + '<span class="grow"><b>' + plural(wait.length, 'line') + '</b> ' + (wait.length === 1 ? 'waits' : 'wait') + ' for Dr. A’s OK.' + (wait.length < cart.length ? ' The OK’d ones can be ordered now.' : '') + '</span></div>';
    vendorsIn(cart).forEach(vn => {
      const ls = cartLinesFor(vn), v = vendorByName(vn), lsOk = ls.filter(c => okOf(c)), lsWait = ls.length - lsOk.length;
      h += '<div class="card vcard"><div class="cardHd">' + (vn ? vlogoHTML(v || { name: vn }, 'lg') : '<span class="vlogo lg none">' + ic('warn', 16) + '</span>') + '<div class="grow"><h3>' + esc(vn || 'No vendor yet') + '</h3>' +
        (v ? '<div class="vmeta">' + (v.acct ? '<span>Account ' + esc(v.acct) + '</span>' : '') + (webUrl(v.portal) ? '<a href="' + esc(webUrl(v.portal)) + '" target="_blank" rel="noopener">' + ic('web', 12) + ' Website</a>' : '') + (v.phone || v.tollFree ? '<a href="tel:' + esc(String(v.tollFree || v.phone).replace(/[^\d+]/g, '')) + '">' + ic('call', 12) + ' ' + esc(v.tollFree || v.phone) + '</a>' : '') + (v.rep ? '<span>Rep: ' + esc(v.rep) + '</span>' : '') + '</div>' : !vn ? '<div class="vmeta">Pick a vendor for these lines before ordering (the pencil on each line).</div>' : '') + '</div></div>' +
        ls.map(cartLineHTML).join('') +
        '<div class="vfoot"><span class="sum">' + ls.length + ' line' + (ls.length === 1 ? '' : 's') + ' · subtotal<b>' + money(cartValue(ls)) + '</b></span><span style="flex:1"></span>' +
        (boss && lsWait ? '<button class="btn btn-sec" data-act="cartOkAll" data-v="' + esc(vn) + '">' + ic('check', 16) + 'OK ' + (lsWait === 1 ? 'it' : 'these ' + lsWait) + '</button>' : '') +
        (!vn ? '' : boss || !lsWait ? '<button class="btn btn-pri" data-act="placeOrder" data-v="' + esc(vn) + '">' + ic('truck', 16) + 'Place this order</button>'
          : lsOk.length ? '<span class="muted small">' + lsWait + ' wait' + (lsWait === 1 ? 's' : '') + ' for Dr. A’s OK</span><button class="btn btn-pri" data-act="placeOrder" data-v="' + esc(vn) + '">' + ic('truck', 16) + 'Order the ' + (lsOk.length === 1 ? 'OK’d line' : lsOk.length + ' OK’d lines') + '</button>'
          : '<button class="btn btn-pri" disabled title="Dr. A OKs these first">' + ic('clock', 16) + 'Waiting for Dr. A’s OK</button>') + '</div></div>';
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
/* Dr. A's OK: one line, a vendor's lines, or all of them — as he sees them on the screen (a line changed since isn't OK'd) */
ACT.cartOk = t => okLines(S.D.cart.filter(c => c.lineId === t.dataset.line && !okOf(c)));
ACT.cartOkAll = t => { const vn = t.dataset.v; okLines(S.D.cart.filter(c => !okOf(c) && (vn == null || (c.vendor || '') === vn))); };
function okLines(lines) {
  withAdmin(async () => {
    if (!lines.length) return;
    let r = null;
    if (!await act(async () => { r = await cartApprove(lines.map(okSeen)); })) return;
    const msg = ((r.n ? (r.n === 1 ? 'OK’d.' : 'OK’d ' + r.n + ' lines.') : '') + (r.changed ? ' ' + plural(r.changed, 'line') + ' changed while you looked — look again.' : '')).trim();
    if (msg) toast(msg, r.changed ? { bad: true } : {});
  }, '', 'OK the cart');
}
ACT.cartRemove = async t => { const c = inCartLine(t.dataset.id); if (!c) return; if (!await confirmOut(c)) return; withWho(async () => { if (await act(() => cartRemove(c.itemId), 'Taken out of the cart.')) closeModal(true); }, 'Who’s taking it out?'); };

/* ---------- placing an order ---------- */
/* Tapping how you're ordering opens it there and then, with the order written out (Amir, 16 Oct 2026: "I used to be able to
   select email and it would automatically open up the email with the message in it. same thing with text"): Email opens the
   email program, Text opens Messages, Their website opens in a new tab, and on a phone Phone call dials. A computer that can't
   send a text ("it would not be able to send a text via pc") shows the text as a QR code instead: the phone's camera opens it
   in Messages, ready to send. Nothing is marked ordered until "It's ordered". */
function orderText(vn, lines, who) {
  const v = vendorByName(vn) || {};
  return 'Hello' + (v.rep ? ' ' + firstName(v.rep) : '') + ',\n\nPlease send the following to ' + OFFICE.name + (v.acct ? ' (account ' + v.acct + ')' : '') + ':\n\n' +
    lines.map(c => '• ' + qtyUnit(c.qty, c.unit) + ' — ' + c.name + (c.sku ? ' (#' + c.sku + ')' : '') + (c.price ? ' @ ' + money(c.price) : '')).join('\n') +
    '\n\nShip to: ' + OFFICE.address + '\nPhone: ' + OFFICE.phone + '\n\nPlease confirm the order and expected delivery. Thank you!\n' + (who ? firstName(who.name) + ', ' : '') + OFFICE.name;
}
/* the text message: short, in plain characters (so every phone, and the QR code, reads it the same) */
function orderSms(vn, lines, who) {
  const v = vendorByName(vn) || {};
  return plainText('Hi' + (v.rep ? ' ' + firstName(v.rep) : '') + ', please send ' + OFFICE.name + (v.acct ? ' (acct ' + v.acct + ')' : '') + ':\n' +
    lines.map(c => qtyUnit(c.qty, c.unit) + ' - ' + c.name + (c.sku ? ' #' + c.sku : '')).join('\n') +
    '\nShip to ' + OFFICE.address + '. Please confirm. Thanks!' + (who ? ' - ' + firstName(who.name) : ''));
}
function plainText(s) {
  return String(s).normalize('NFKD').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[‐-―−•·]/g, '-').replace(/⁄/g, '/').replace(/×/g, 'x').replace(/[   ]/g, ' ')
    .replace(/[^\n\x20-\x7e]/g, '');
}
/* a number as a call or a text needs it: digits, +1 in front of a US number; a call keeps the extension after a pause
   ("800-555-0100 x12" → tel:+18005550100,12) */
function dialable(n) {
  const [main, ext] = String(n || '').split(/\s*(?:x|ext\.?|#)\s*/i), d = String(main || '').replace(/[^\d+]/g, '');
  return { num: /^\d{10}$/.test(d) ? '+1' + d : /^1\d{10}$/.test(d) ? '+' + d : d, ext: String(ext || '').replace(/\D/g, '') };
}
/* what this device opens by itself: Messages on a phone, an iPad or a Mac; a call only on a phone */
function devKind() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua))) return 'phone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  return /Macintosh|Mac OS X/.test(ua) ? 'mac' : 'pc';
}
const QR_MAX = 1200;   // past this a text's QR code gets too fine to scan off a screen
/* everything the dialog can open, for this vendor and these lines */
function placeLinks(vn, ls, w) {
  const v = vendorByName(vn) || { name: vn }, text = orderText(vn, ls, w), smsText = orderSms(vn, ls, w);
  const email = v.repEmail || v.email || '', phone = v.tollFree || v.phone || '', textTo = v.repPhone || v.phone || '';
  const subject = 'Order — ' + OFFICE.name + (v.acct ? ' (acct ' + v.acct + ')' : ''), call = dialable(phone), to = dialable(textTo).num;
  return {
    v, text, smsText, email, phone, textTo, web: webUrl(v.portal),
    toWho: v.rep && v.repPhone ? firstName(v.rep) + ' (' + textTo + ')' : textTo,
    mailto: email ? 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) : '',
    gmail: email ? 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(email) + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) : '',
    tel: call.num ? 'tel:' + call.num + (call.ext ? ',' + call.ext : '') : '',
    smsUrl: to ? 'sms:' + to + '?&body=' + encodeURIComponent(smsText) : '',
    qr: to ? 'SMSTO:' + to + ':' + smsText : ''
  };
}
/* what a tap on one of the ways opens on this device ('' = nothing to open: the dialog just shows it) */
function launchUrl(k, L, dk) {
  return k === 'email' ? L.mailto : k === 'text' ? (dk === 'pc' ? '' : L.smsUrl) : k === 'call' ? (dk === 'phone' ? L.tel : '') : k === 'online' ? L.web : '';
}
/* opened from the tap itself (a link the tap clicks), so the browser lets it through */
function openExternal(url, newTab) {
  const a = document.createElement('a'); a.href = url; a.style.display = 'none';
  if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
  document.body.appendChild(a); a.click(); a.remove();
}
ACT.placeOrder = t => withWho(w => {
  const vn = t.dataset.v, ls = cartLinesFor(vn).filter(c => isAdmin() || okOf(c)), v = vendorByName(vn) || {};
  if (!ls.length) return toast('These wait for Dr. A’s OK.', { bad: true });
  /* what's ordered is what the dialog shows: the lines as they are now, whatever changes in the cart while it's open */
  S.ui.place = { vendor: vn, snap: placeSnap(ls), how: webUrl(v.portal) ? 'online' : (v.email || v.repEmail) ? 'email' : (v.phone || v.tollFree) ? 'call' : 'other' };
  renderPlace();
}, 'Who’s placing this order?');
function renderPlace() {
  const P = S.ui.place, w = whoNow(), ls = P.snap, dk = devKind(), L = placeLinks(P.vendor, ls, w), v = L.v;
  const opened = P.opened === P.how, then = ' Send it, then press <b>It’s ordered</b> below.';
  const qrHere = P.how === 'text' && !!L.qr && dk !== 'phone', qrFits = L.qr.length <= QR_MAX;
  let detail = '';
  if (P.how === 'online') detail = L.web ? '<a class="btn btn-act" href="' + esc(L.web) + '" target="_blank" rel="noopener">' + ic('web', 16) + 'Open ' + esc(v.name) + '’s website</a><div class="hint">' + (opened ? 'It opened in a new tab. ' : '') + 'Add the lines below on their site and check out, then come back here.' + (v.acct ? ' Account: <b>' + esc(v.acct) + '</b>.' : '') + '</div>' : '<div class="notice">There’s no website saved for ' + esc(v.name) + '. ' + (isAdmin() ? 'Add it under Vendors.' : 'Dr. A can add it under Vendors.') + '</div>';
  else if (P.how === 'call') detail = L.tel ? '<a class="btn btn-act" href="' + esc(L.tel) + '">' + ic('call', 16) + 'Call ' + esc(L.phone) + '</a>' + (v.acct ? '<div class="hint">Account: <b>' + esc(v.acct) + '</b></div>' : '') : '<div class="notice">No phone number saved for ' + esc(v.name) + '.</div>';
  else if (P.how === 'email') detail = L.mailto ? '<a class="btn btn-act" href="' + esc(L.mailto) + '">' + ic('email', 16) + 'Write the email to ' + esc(L.email) + '</a><div class="hint">' + (opened ? 'Your email opened with the order written out.' + then : 'It opens your email with the order written out.') + (dk === 'pc' || dk === 'mac' ? ' Didn’t open? <a href="' + esc(L.gmail) + '" target="_blank" rel="noopener">Write it in Gmail</a>.' : '') + '</div>' : '<div class="notice">No email saved for ' + esc(v.name) + '. Copy the order below into an email.</div>';
  else if (P.how === 'text') detail = !L.smsUrl ? '<div class="notice">No mobile number saved for ' + esc(v.name) + (v.rep ? '’s rep' : '') + '.</div>' :
    (dk === 'pc' ? '' : '<a class="btn btn-act" href="' + esc(L.smsUrl) + '">' + ic('text', 16) + 'Text ' + esc(L.toWho) + '</a><div class="hint">' + (opened ? 'Messages opened with the order written out.' + then : 'It opens Messages with the order written out.') + '</div>') +
    (!qrHere ? '' : !qrFits ? (dk === 'pc' ? '<div class="notice">This order is too long to send as a text from here. Email it, or copy the text below.</div>' : '') :
      '<div class="smsQr' + (dk === 'pc' ? '' : ' alt') + '"><div id="smsQr" class="qrBox" role="img" aria-label="QR code for a text to ' + esc(L.toWho) + ' with the order"></div><div class="qrSay">' +
      (dk === 'pc' ? '<b>Scan this with your phone’s camera.</b> It opens a text to ' + esc(L.toWho) + ' with the order written out.' + then : 'Or text it from your phone: scan this with its camera.') + '</div></div>');
  const shown = P.how === 'text' ? L.smsText : L.text;
  openModal('<h3>Order from ' + esc(P.vendor) + '</h3><div class="lsub">' + ls.length + ' line' + (ls.length === 1 ? '' : 's') + ' · ' + money(cartValue(ls)) + ' · ordering as <b>' + esc(w ? w.short : '—') + '</b></div>' +
    '<div class="subH" style="margin-top:4px">How are you ordering?</div><div class="howGrid">' + HOW.map(([k, l, i]) => '<button class="how" data-act="placeHow" data-k="' + k + '" aria-pressed="' + (P.how === k) + '">' + ic(i, 20) + '<b>' + esc(l) + '</b><span>' + esc(k === 'online' ? (v.portal ? v.portal.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'no website saved') : k === 'call' ? (L.phone || 'no number saved') : k === 'email' ? (L.email || 'no email saved') : k === 'text' ? (L.textTo || 'no mobile saved') : k === 'rep' ? (v.rep || 'no rep saved') : 'mark it ordered') + '</span></button>').join('') + '</div>' +
    detail +
    '<div class="subH">' + (P.how === 'text' ? 'The text' : 'The order') + '</div><div class="copyBox" id="orderTxt">' + esc(shown) + '</div><div class="btnRow"><button class="btn btn-ghost" data-act="copyOrder">' + ic('copy', 15) + 'Copy</button></div>' +
    '<div class="subH">When it’s placed</div><div class="grid2">' + field('Their order or confirmation # (optional)', '<input id="poNum" placeholder="e.g. 4815162">') + field('Expected delivery (optional)', '<input id="poDate" type="date" min="' + todayISO() + '">') + '</div>' +
    field('Note (optional)', '<input id="poNote" placeholder="e.g. rep said gloves ship separately">') +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Not yet — keep it in the cart</button><button class="btn btn-pri" data-act="placeGo">' + ic('check', 16) + 'It’s ordered — move to On the way</button></div>', { cls: 'wide', noFocus: true });
  if (qrHere && qrFits) drawTextQr(L.qr, dk === 'pc' ? (L.qr.length > 600 ? 320 : 260) : 170);
}
/* the text as a QR code (the library the QR labels use); a dialog redrawn meanwhile draws its own */
async function drawTextQr(payload, size) {
  const box = $('#smsQr'); if (!box) return;
  try { await loadLib('qrcode'); } catch (e) { if (box.isConnected) box.textContent = errText(e); return; }
  if (!box.isConnected) return;
  try { new QRCode(box, { text: payload, width: size, height: size, correctLevel: QRCode.CorrectLevel.L }); }
  catch (e) { box.textContent = 'Too long for a QR code — copy the text below.'; }
}
ACT.placeHow = t => {
  const P = S.ui.place, k = t.dataset.k, url = launchUrl(k, placeLinks(P.vendor, P.snap, whoNow()), devKind());
  const n = val('poNum'), d = val('poDate'), x = val('poNote');
  P.how = k; P.opened = url ? k : '';
  if (url) openExternal(url, k === 'online');
  renderPlace(); $('#poNum').value = n; $('#poDate').value = d; $('#poNote').value = x;
};
ACT.copyOrder = () => copyText($('#orderTxt').textContent);
ACT.placeGo = t => withWho(async () => {
  const P = S.ui.place; busyBtn(t, true, 'Saving…');
  /* (the vendor's lines that wait for Dr. A's OK stay in the cart: the toast says how many) */
  const mine = new Set(P.snap.map(c => c.lineId)), left = isAdmin() ? 0 : cartLinesFor(P.vendor).filter(c => !okOf(c) && !mine.has(c.lineId)).length;
  try {
    const o = await placeOrder(P.vendor, P.snap, { method: P.how, orderNumber: val('poNum'), expected: val('poDate'), note: val('poNote') }), n = left;
    closeModal(true); toast('Ordered from ' + P.vendor + ' — it’s under Orders → On the way.' + (n ? ' ' + plural(n, 'line') + ' still wait' + (n === 1 ? 's' : '') + ' for Dr. A’s OK.' : ''), { action: 'Show', onAction: () => { go('orders'); openDrawer('order', o.id); } });
  } catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
}, 'Who placed this order?');
