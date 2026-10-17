/* =====================================================================
   Supplies — the catalog. Find a supply, see at a glance whether it's
   already in the cart or on order (and who put it there), and add it.
   Tapping a supply opens its drawer: buying (vendors and prices, what
   it's bought in), stock, and its history with names and dates.
   Photos first (Amir, 16 Oct 2026: "I love high quality pro phtoos of
   the product … I'm very visual"): the catalog opens as a grid of big
   photo cards (List is one tap away, remembered on each computer), the
   drawer opens on the full-size photo, and a tap on it fills the screen.
   ===================================================================== */
function inCartLine(id) { return S.D.cart.find(c => c.itemId === id) || null; }
function openOrdersWith(id) { return S.D.orders.filter(o => (o.status === 'open' || o.status === 'backordered') && o.items.some(l => l.itemId === id)); }
function itemSearchText(i) { return [i.name, i.sku, i.group, i.note, i.location, i.manufacturer, i.tag, catLabel(i.cat)].concat(listOf(i.tags), allSources(i).map(s => (s.vendor || '') + ' ' + (s.sku || ''))).join(' '); }
function isLow(i) { return Number(i.min) > 0 && (Number(i.qty) || 0) < Number(i.min); }
function isOut(i) { return (Number(i.qty) || 0) <= 0 && Number(i.min) > 0; }
/* days until it expires (negative = expired), or null */
function expDays(i) { const e = String(i.exp || ''); if (!e) return null; const t = /^\d{4}-\d{2}-\d{2}$/.test(e) ? new Date(e + 'T23:59:59').getTime() : Date.parse(e); return isFinite(t) ? Math.floor((t - Date.now()) / 864e5) : null; }
function priceLine(i) {
  const src = primarySource(i), cp = countPrice(src);
  if (cp == null) return '<span class="price muted">no price yet</span>';
  if (buysBigger(i)) return '<span class="price">' + money(cp * perBuy(i)) + '<small>per ' + esc(buyUnit(i)) + ' · ' + money(cp) + '/' + esc(countUnit(i)) + '</small></span>';
  return '<span class="price">' + money(cp) + '<small>per ' + esc(countUnit(i)) + '</small></span>';
}
function itemFlags(i) {
  const c = inCartLine(i.id), os = openOrdersWith(i.id); let h = '';
  if (c) h += '<span class="fl cart">' + ic('cart', 12) + 'In cart · ' + esc(lineQtyLabel(c)) + ' · ' + esc(firstName(c.addedBy) || '?') + (c.addedAt ? ', ' + esc(fmtAgo(c.addedAt)) : '') + '</span>';
  os.forEach(o => { const l = o.items.find(x => x.itemId === i.id); h += '<span class="fl ' + (o.status === 'backordered' ? 'back' : 'order') + '">' + ic('truck', 12) + (o.status === 'backordered' ? 'Backordered · ' : 'On order · ') + esc(lineQtyLabel(l)) + (o.orderedBy ? ' · ' + esc(firstName(o.orderedBy)) : '') + (o.orderedAt || o.dateOrdered ? ', ' + esc(fmtAgo(o.orderedAt || o.dateOrdered)) : '') + '</span>'; });
  if (i.archived) h += '<span class="fl arch">' + ic('archive', 12) + 'Archived</span>';
  if (i.tag) h += '<span class="fl ' + (/discontinued/i.test(i.tag) ? 'low' : 'due') + '">' + esc(i.tag) + '</span>';
  const ed = expDays(i); if (ed != null && ed < 90) h += '<span class="fl ' + (ed < 30 ? 'low' : 'due') + '">' + (ed < 0 ? 'Expired ' + esc(fmtDate(i.exp)) : 'Expires ' + esc(fmtDate(i.exp))) + '</span>';
  return h ? '<div class="flags">' + h + '</div>' : '';
}
function itemRowHTML(i) {
  const src = primarySource(i), c = inCartLine(i.id);
  return '<div class="irow" data-act="openItem" data-id="' + esc(i.id) + '" role="button" tabindex="0">' + thumbHTML(i, '', true) +
    '<div style="min-width:0"><div class="nm">' + esc(i.name || 'Unnamed') + '</div><div class="sub">' +
    (src && src.vendor ? '<span class="v">' + vlogoHTML(vendorObj(src.vendor)) + esc(src.vendor) + '</span>' : '') + (src && src.sku ? '<span>#' + esc(src.sku) + '</span>' : '') + (i.location ? '<span>' + ic('pin', 12) + ' ' + esc(i.location) + '</span>' : '') +
    (buysBigger(i) ? '<span>' + esc(buyLabel(i)) + '</span>' : '') + '</div>' + itemFlags(i) + '</div>' +
    '<div class="act">' + priceLine(i) + '<span class="stock' + (isOut(i) ? ' out' : isLow(i) ? ' low' : '') + '"' + (isLow(i) ? ' title="Below its minimum of ' + esc(qtyFmt(i.min)) + '"' : '') + '>' + esc(qtyFmt(i.qty || 0)) + '<small>' + esc(unitWord(countUnit(i), i.qty)) + ' on hand</small></span>' +
    (i.archived ? '' : '<button class="addBtn' + (c ? ' in' : '') + '" data-act="quickAdd" data-id="' + esc(i.id) + '" title="Add to the cart">' + ic(c ? 'check' : 'plus', 15) + (c ? 'In cart' : 'Add') + '</button>') + '</div></div>';
}
/* a supply as a photo card: the photo big, what's going on with it on the photo, then name, vendor, price, stock and Add */
function itemCardHTML(i) {
  const src = primarySource(i), c = inCartLine(i.id), os = openOrdersWith(i.id), ed = expDays(i), has = !!photoOf(i);
  const tags = (c ? '<span class="ptag cart">' + ic('cart', 11) + 'In cart · ' + esc(lineQtyLabel(c)) + '</span>' : '') +
    (os.length ? '<span class="ptag ' + (os.some(o => o.status === 'backordered') ? 'back' : 'order') + '">' + ic('truck', 11) + (os.some(o => o.status === 'backordered') ? 'Backordered' : 'On order') + '</span>' : '') +
    (isOut(i) ? '<span class="ptag low">Out</span>' : isLow(i) ? '<span class="ptag low">Low</span>' : '') +
    (ed != null && ed < 90 ? '<span class="ptag due">' + (ed < 0 ? 'Expired' : 'Expires ' + esc(fmtDate(i.exp))) + '</span>' : '') +
    (i.archived ? '<span class="ptag arch">Archived</span>' : '') + (i.tag ? '<span class="ptag due">' + esc(i.tag) + '</span>' : '');
  const cp = countPrice(src);
  return '<div class="pcard" data-act="openItem" data-id="' + esc(i.id) + '" role="button" tabindex="0" aria-label="' + esc(i.name || 'Supply') + '">' +
    '<div class="ph' + (has ? '' : ' none') + '">' + (has ? photoImgHTML(i, false, true) : ic('box', 40) + '<span>No photo yet</span>') +
    (tags ? '<div class="ptags">' + tags + '</div>' : '') +
    (has ? '<button class="pzoom" data-act="viewPhoto" data-id="' + esc(i.id) + '" aria-label="See the photo full size" title="See it full size">' + ic('zoom', 16) + '</button>' : '') + '</div>' +
    '<div class="pbd"><div class="nm">' + esc(i.name || 'Unnamed') + '</div>' +
    '<div class="vd">' + (src && src.vendor ? vlogoHTML(vendorObj(src.vendor)) + '<span>' + esc(src.vendor) + '</span>' : '<span class="muted">no vendor yet</span>') + (src && src.sku ? '<span class="sku">#' + esc(src.sku) + '</span>' : '') + '</div>' +
    '<div class="pft"><div><div class="pp">' + (cp == null ? '<span class="muted">no price</span>' : buysBigger(i) ? money(cp * perBuy(i)) + '<small>/' + esc(buyUnit(i)) + '</small>' : money(cp) + '<small>/' + esc(countUnit(i)) + '</small>') + '</div>' +
    '<div class="ps' + (isOut(i) ? ' out' : isLow(i) ? ' low' : '') + '">' + esc(qtyFmt(i.qty || 0)) + ' ' + esc(unitWord(countUnit(i), i.qty)) + ' on hand</div></div>' +
    (i.archived ? '' : '<button class="addBtn' + (c ? ' in' : '') + '" data-act="quickAdd" data-id="' + esc(i.id) + '" title="Add to the cart">' + ic(c ? 'check' : 'plus', 15) + (c ? 'In cart' : 'Add') + '</button>') + '</div></div></div>';
}
/* Photos or List, remembered on this computer */
function supLook() { const u = S.ui.sup; if (!u.look) { let l = ''; try { l = localStorage.getItem('nloInv.supLook') || ''; } catch (e) { } u.look = l === 'list' ? 'list' : 'grid'; } return u.look; }
ACT.supLook = t => { S.ui.sup.look = t.dataset.l === 'list' ? 'list' : 'grid'; try { localStorage.setItem('nloInv.supLook', S.ui.sup.look); } catch (e) { } renderView(true); };
/* what the Supplies screen shows now (its filters and search), in its order */
function supVisible() {
  const u = S.ui.sup || (S.ui.sup = { cat: '', show: '', sort: 'cat' });
  let list = u.show === 'archived' ? items().filter(i => i.archived) : activeItems();
  if (u.cat) list = list.filter(i => i.cat === u.cat);
  if (u.show === 'cart') list = list.filter(i => inCartLine(i.id));
  else if (u.show === 'order') list = list.filter(i => openOrdersWith(i.id).length);
  else if (u.show === 'low') list = list.filter(isLow);
  else if (u.show === 'exp') list = list.filter(i => { const d = expDays(i); return d != null && d < 90; });
  if (S.view === 'supplies' && S.q) list = list.filter(i => matchesAll(itemSearchText(i), S.q));
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  if (u.sort === 'recent') list.sort((a, b) => (b.lastOrderedTimestamp || 0) - (a.lastOrderedTimestamp || 0) || byName(a, b));
  else if (u.sort === 'vendor') list.sort((a, b) => String((primarySource(a) || {}).vendor || '~').localeCompare(String((primarySource(b) || {}).vendor || '~')) || byName(a, b));
  else list.sort((a, b) => (u.sort === 'cat' ? CATEGORIES.findIndex(c => c.id === a.cat) - CATEGORIES.findIndex(c => c.id === b.cat) : 0) || String(a.group || '').localeCompare(String(b.group || '')) || byName(a, b));
  return list;
}
VIEWS.supplies = {
  actions() { return '<button class="btn btn-sec" data-act="printLabels" title="QR labels for the supplies shown">' + ic('print', 16) + 'Labels</button><button class="btn btn-teal" data-act="itemNew">' + ic('plus', 16) + 'New supply</button>'; },
  render() {
    const u = S.ui.sup || (S.ui.sup = { cat: '', show: '', sort: 'cat' });
    const list = supVisible();
    const counts = {}; activeItems().forEach(i => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    let h = '<div class="chips">' + '<button class="chip' + (!u.cat ? ' on' : '') + '" data-act="supCat" data-c="">All<span class="c">' + activeItems().length + '</span></button>' +
      CATEGORIES.filter(c => counts[c.id]).map(c => '<button class="chip' + (u.cat === c.id ? ' on' : '') + '" data-act="supCat" data-c="' + c.id + '">' + esc(c.label) + '<span class="c">' + counts[c.id] + '</span></button>').join('') + '</div>';
    const opt = (v, l) => '<option value="' + v + '"' + (u.show === v ? ' selected' : '') + '>' + l + '</option>';
    h += '<div class="filters"><select data-chg="supShow" aria-label="Show">' + opt('', 'Every supply') + opt('cart', 'In the cart') + opt('order', 'On order') + opt('low', 'Below its minimum') + opt('exp', 'Expiring soon') + opt('archived', 'Archived') + '</select>' +
      '<select data-chg="supSort" aria-label="Sort">' + ['cat:By category', 'name:A–Z', 'vendor:By vendor', 'recent:Recently ordered'].map(x => { const [v, l] = x.split(':'); return '<option value="' + v + '"' + (u.sort === v ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select>' +
      '<div class="seg" role="group" aria-label="Show as"><button data-act="supLook" data-l="grid" aria-pressed="' + (supLook() === 'grid') + '">' + ic('grid', 14) + 'Photos</button><button data-act="supLook" data-l="list" aria-pressed="' + (supLook() === 'list') + '">' + ic('list', 14) + 'List</button></div>' +
      '<span class="muted small">' + list.length + ' suppl' + (list.length === 1 ? 'y' : 'ies') + '</span></div>';
    if (u.show === 'low') h += '<div class="notice info">Stock counts aren’t always up to date, so treat this as a hint and check the shelf.</div>';
    if (!list.length) return h + '<div class="card"><div class="empty">' + (S.q ? 'Nothing matches “' + esc(S.q) + '”. <button class="linkBtn" data-act="itemNew">Add it as a new supply</button>' : 'Nothing here.') + '</div></div>';
    let body = '', cat = null, grp = null; const grid = supLook() === 'grid';
    list.slice(0, 600).forEach(i => {
      if (u.sort === 'cat' && i.cat !== cat) { cat = i.cat; grp = null; body += '<div class="catHead"><i style="background:' + catColor(cat) + '"></i>' + esc(catLabel(cat)) + '<span class="c">' + list.filter(x => x.cat === cat).length + '</span></div>'; }
      if (u.sort === 'cat' && i.group && i.group !== grp) { grp = i.group; body += '<div class="grpHead">' + esc(grp) + '</div>'; }
      body += grid ? itemCardHTML(i) : itemRowHTML(i);
    });
    return h + (grid ? '<div class="pgrid">' + body + '</div>' : '<div class="card">' + body + '</div>');
  }
};
ACT.supCat = t => { S.ui.sup.cat = t.dataset.c; renderView(true); };
CHG.supShow = t => { S.ui.sup.show = t.value; renderView(true); };
CHG.supSort = t => { S.ui.sup.sort = t.value; renderView(true); };
ACT.openItem = (t, e) => { if (e && e.target.closest('[data-act]') !== t) return; openDrawer('item', t.dataset.id); };

/* ---------- adding to the cart ---------- */
ACT.quickAdd = (t, e) => { if (e) e.stopPropagation(); const it = itemById(t.dataset.id); if (it) openAddToCart(it); };
function openAddToCart(it, qty) {
  const srcs = allSources(it), c = inCartLine(it.id), w = whoNow();
  S.ui.add = { id: it.id, vendor: (c && c.vendor) || (srcs[0] && srcs[0].vendor) || '' };
  const per = perBuy(it);
  /* got recently? (received in the last 10 days) — so nobody orders the same thing twice */
  const recent = S.D.orders.filter(o => o.status === 'received' && daysAgo(o.dateReceived) <= 10 && o.items.some(l => l.itemId === it.id)).sort((a, b) => msOf(b.dateReceived) - msOf(a.dateReceived))[0];
  openModal('<h3>Add to the cart</h3><div class="lsub">' + esc(it.name) + ' · <b>' + esc(qtyUnit(it.qty || 0, countUnit(it))) + '</b> on hand' + (num(it.min) ? ' · reorder below ' + esc(qtyFmt(it.min)) : '') + '</div>' +
    (recent ? '<div class="notice">Received ' + esc(fmtAgo(recent.dateReceived)) + ' from ' + esc(recent.vendor || '—') + ': ' + esc(lineQtyLabel(recent.items.find(l => l.itemId === it.id))) + (recent.receivedBy ? ', checked in by ' + esc(recent.receivedBy) : '') + '.</div>' : '') +
    (c ? '<div class="notice info">Already in the cart: ' + esc(lineQtyLabel(c)) + ', added by ' + esc(c.addedBy || '—') + (c.addedAt ? ' ' + esc(fmtWhen(c.addedAt)) : '') + '. This adds more.</div>' : '') +
    openOrdersWith(it.id).map(o => '<div class="notice">Already on order from ' + esc(o.vendor || '—') + ': ' + esc(lineQtyLabel(o.items.find(l => l.itemId === it.id))) + ', ordered by ' + esc(o.orderedBy || '—') + ' ' + esc(fmtWhen(o.orderedAt || o.dateOrdered)) + (o.status === 'backordered' ? ' (backordered)' : '') + '.</div>').join('') +
    '<div class="gap8" style="margin:6px 0 14px">' + thumbHTML(it, 'lg') + '<div class="qty lg"><button data-act="addStep" data-n="-1" aria-label="Less">−</button><input id="addQty" type="number" inputmode="decimal" min="0" step="1" value="' + esc(qty || 1) + '" data-enter="#addGo" data-inp="addQty"><span class="u" id="addU">' + esc(unitWord(buyUnit(it), qty || 1)) + '</span><button data-act="addStep" data-n="1" aria-label="More">+</button></div></div>' +
    (per > 1 ? '<div class="boxNote" id="addEq" style="margin-bottom:14px">' + esc(qtyUnit(qty || 1, buyUnit(it))) + ' = ' + esc(qtyUnit((qty || 1) * per, countUnit(it))) + '</div>' : '') +
    (srcs.length > 1 ? '<div class="subH">From</div><div class="pickRow">' + srcs.map((s, k) => '<button class="pick" data-act="addVendor" data-k="' + k + '" aria-pressed="' + (s.vendor === S.ui.add.vendor) + '">' + esc(s.vendor || 'Vendor ' + (k + 1)) + (countPrice(s) != null ? ' · ' + money(countPrice(s) * per) : '') + '</button>').join('') + '</div>' : '') +
    field('Note for whoever orders (optional)', '<input id="addNote" placeholder="e.g. need by Thursday" value="' + esc((c && c.note) || '') + '">') +
    '<div class="mFt"><span class="muted small" style="margin-right:auto;align-self:center">' + (w ? 'Adding as <b>' + esc(w.short) + '</b>' : '') + (isAdmin() ? '' : ' · Dr. A OKs it before it’s ordered') + '</span><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="addGo" data-act="addGo">' + ic('cart', 16) + 'Add to cart</button></div>', { cls: 'mid', focus: '#addQty' });
}
ACT.addStep = t => { const i = $('#addQty'); i.value = Math.max(1, (num(i.value) || 0) + Number(t.dataset.n)); INP.addQty(); };
INP.addQty = () => { const it = itemById(S.ui.add.id), q = num(val('addQty')); const u = $('#addU'); if (u) u.textContent = unitWord(buyUnit(it), q); const e = $('#addEq'); if (e) e.textContent = qtyUnit(q, buyUnit(it)) + ' = ' + qtyUnit(q * perBuy(it), countUnit(it)); };
ACT.addVendor = t => { const it = itemById(S.ui.add.id), s = allSources(it)[Number(t.dataset.k)]; S.ui.add.vendor = s ? s.vendor : ''; $$('.pick[data-act="addVendor"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); };
ACT.addGo = t => {
  const it = itemById(S.ui.add.id), q = num(val('addQty')), note = val('addNote').trim(); if (!it) return;
  if (!(q > 0)) return toast('How many?', { bad: true });
  withWho(async () => {
    busyBtn(t, true, 'Adding…');
    const ok = await act(async () => {
      const ex = inCartLine(it.id);
      await cartAdd(it, q, { vendor: S.ui.add.vendor, note });
      if (ex && note && note !== ex.note) await cartPatch(it.id, { note }, 'note');
    });
    if (ok) { closeModal(true); toast('Added ' + qtyUnit(q, buyUnit(it)) + ' of ' + plainText(it.name, 40) + ' to the cart.' + okNote(1), { action: 'Open cart', onAction: () => go('cart') }); } else busyBtn(t, false);
  }, 'Who’s adding this to the cart?');
};

/* ---------- the drawer ---------- */
DRAWERS.item = id => {
  const it = itemById(id); if (!it) return '';
  const srcs = allSources(it), c = inCartLine(id), os = openOrdersWith(id), per = perBuy(it);
  const hasPic = !!photoOf(it);
  let h = '<div class="dHd">' + (hasPic ? '' : '<button class="thumb lg addPic" data-act="itemEdit" data-id="' + esc(id) + '" title="Add a photo">' + ic('camera', 26) + '<span>Add a photo</span></button>') + '<div style="flex:1;min-width:0"><h3>' + esc(it.name) + '</h3><div class="sub"><span class="badge" style="background:' + catColor(it.cat) + '22;color:' + catColor(it.cat) + '">' + esc(catLabel(it.cat)) + '</span>' + (it.group ? '<span class="badge">' + esc(it.group) + '</span>' : '') + (it.location ? '<span class="badge">' + ic('pin', 12) + esc(it.location) + '</span>' : '') + (it.archived ? '<span class="badge">Archived</span>' : '') + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">' +
    (hasPic ? '<div class="dHero" data-act="viewPhoto" data-id="' + esc(id) + '" role="button" tabindex="0" title="See it full size">' + photoImgHTML(it, true) + '<span class="pzoom">' + ic('zoom', 16) + '</span></div>' : '');
  h += '<div class="btnRow" style="margin-top:0">' + (it.archived ? '' : '<button class="btn btn-teal" data-act="drawerAdd" data-id="' + esc(id) + '">' + ic('cart', 16) + (c ? 'Add more' : 'Add to cart') + '</button>') +
    '<button class="btn btn-sec" data-act="useOne" data-id="' + esc(id) + '">' + ic('minus', 16) + 'Used 1 ' + esc(countUnit(it)) + '</button><button class="btn btn-sec" data-act="countIt" data-id="' + esc(id) + '">' + ic('count', 16) + 'Count</button><button class="btn btn-ghost" data-act="itemEdit" data-id="' + esc(id) + '">' + ic('edit', 15) + 'Edit</button></div>';
  if (c) h += '<div class="notice info" style="margin-top:14px">In the cart: <b>' + esc(lineQtyLabel(c, true)) + '</b> — added by ' + esc(c.addedBy || '—') + (c.addedAt ? ', ' + esc(fmtWhen(c.addedAt)) : '') + listOf(c.trail).map(t => '; ' + esc(t.t === 'more' ? '+' + qtyFmt(t.qty) + ' by ' + t.by : t.t === 'qty' ? 'changed to ' + qtyFmt(t.to) + ' by ' + t.by : 'changed by ' + t.by) + ', ' + esc(fmtWhen(t.at))).join('') + (c.note ? '<br>Note: ' + esc(c.note) : '') + '</div>';
  os.forEach(o => { const l = o.items.find(x => x.itemId === id); h += '<div class="notice" style="margin-top:10px;cursor:pointer" data-act="openOrder" data-id="' + esc(o.id) + '">' + (o.status === 'backordered' ? 'Backordered' : 'On order') + ' from ' + esc(o.vendor || '—') + ': <b>' + esc(lineQtyLabel(l, true)) + '</b> — ordered by ' + esc(o.orderedBy || '—') + ', ' + esc(fmtWhen(o.orderedAt || o.dateOrdered)) + (o.expectedDelivery ? ' · due ' + esc(fmtDate(o.expectedDelivery)) : '') + '</div>'; });
  /* stock */
  h += '<div class="sec"><h5>Stock</h5><div class="kv"><div><div class="k">On hand</div><div class="v big2">' + esc(qtyFmt(it.qty || 0)) + ' <span style="font-size:14px;color:var(--grey-500)">' + esc(unitWord(countUnit(it), it.qty)) + '</span></div></div>' +
    '<div><div class="k">Reorder below</div><div class="v">' + (Number(it.min) ? esc(qtyUnit(it.min, countUnit(it))) : '—') + '</div></div>' +
    '<div><div class="k">Last counted</div><div class="v">' + (it.chk ? esc(fmtWhen(it.chk)) + (it.chkBy ? ' · ' + esc(it.chkBy) : '') : '—') + '</div></div>' +
    '<div><div class="k">Expires</div><div class="v">' + (it.exp ? esc(fmtDate(it.exp)) : '—') + '</div></div></div>' + (isLow(it) ? '<div class="hint">Below its minimum — if the count is right.</div>' : '') + '</div>';
  /* buying */
  h += '<div class="sec"><h5>Buying</h5>' + (per > 1 ? '<div class="boxNote" style="margin-bottom:8px">Counted in ' + esc(unitWord(countUnit(it), 2)) + ' · bought by the ' + esc(buyUnit(it)) + ' of ' + per + '. Receiving 1 ' + esc(buyUnit(it)) + ' adds ' + per + ' ' + esc(unitWord(countUnit(it), per)) + '.</div>' : '');
  if (!srcs.length) h += '<div class="muted small">No vendor or price yet. <button class="linkBtn" data-act="itemEdit" data-id="' + esc(id) + '">Add one</button></div>';
  const cheap = cheapestSource(it);
  srcs.forEach(s => {
    const cp = countPrice(s), url = vendorSearchUrl(s, it);
    h += '<div class="srcRow">' + vlogoHTML(vendorObj(s.vendor)) + '<div style="min-width:0"><div class="v">' + esc(s.vendor || 'Vendor') + (cheap && s === cheap && srcs.length > 1 ? ' <span class="pill" style="background:var(--mint-100);color:var(--mint-700)">lowest</span>' : '') + '</div><div class="k">' + (s.sku ? '#' + esc(s.sku) : 'no SKU') + (s.lastDate ? ' · last paid ' + esc(fmtDate(s.lastDate)) : '') + (url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener">find it ' + ic('link', 11) + '</a>' : '') + '</div></div>' +
      '<div class="p">' + (cp == null ? '<span class="muted">—</span>' : per > 1 ? money(cp * per) + '<small>per ' + esc(buyUnit(it)) + ' · ' + money(cp) + '/' + esc(countUnit(it)) + '</small>' : money(cp) + '<small>per ' + esc(countUnit(it)) + (perPieceLabel(it, cp) ? ' · ' + esc(perPieceLabel(it, cp)) : '') + '</small>') + '</div></div>';
  });
  h += '</div>';
  if (it.note) h += '<div class="sec"><h5>Notes</h5><div class="txt">' + esc(it.note) + '</div></div>';
  /* history: orders and stock steps, with names */
  const ords = S.D.orders.filter(o => o.items.some(l => l.itemId === id)).sort((a, b) => msOf(b.orderedAt || b.dateOrdered) - msOf(a.orderedAt || a.dateOrdered)).slice(0, 8);
  if (ords.length) {
    h += '<div class="sec"><h5>Orders</h5>' + ords.map(o => { const l = o.items.find(x => x.itemId === id);
      return '<div class="hist" style="cursor:pointer" data-act="openOrder" data-id="' + esc(o.id) + '"><time>' + esc(fmtDate(o.orderedAt || o.dateOrdered)) + '</time><span style="flex:1">' + esc(lineQtyLabel(l)) + ' from ' + esc(o.vendor || '—') + (l.price ? ' at ' + money(l.price) + '/' + esc(l.unit || '') : '') +
        ' · ' + (o.status === 'received' ? 'received' + (o.receivedBy ? ' by ' + esc(o.receivedBy) : '') : esc(o.status)) + (o.orderedBy ? ' · ordered by ' + esc(o.orderedBy) : '') + (l.addedBy ? ' · added by ' + esc(l.addedBy) : '') + '</span></div>'; }).join('') + '</div>';
  }
  const steps = S.D.log.filter(e => e.itemId === id && (e.type === 'use' || e.type === 'count' || e.type === 'adjust' || e.type === 'receive' && !e.orderId)).slice(0, 10);
  if (steps.length) h += '<div class="sec"><h5>Stock steps</h5>' + steps.map(e => '<div class="hist"><time>' + esc(fmtWhen(e.date)) + '</time><span style="flex:1">' + esc(e.type === 'count' ? 'Counted (' + (e.delta > 0 ? '+' : '') + qtyFmt(e.delta) + ')' : e.type === 'use' ? 'Used ' + qtyFmt(Math.abs(e.delta)) : (e.delta > 0 ? '+' : '') + qtyFmt(e.delta)) + (e.note ? ' · ' + esc(plainText(e.note, 60)) : '') + (e.by ? ' · ' + esc(e.by) : '') + '</span></div>').join('') + '</div>';
  h += '<div class="sec"><h5>More</h5><div class="btnRow" style="margin-top:0"><button class="btn btn-ghost" data-act="qrIt" data-id="' + esc(id) + '">' + ic('scan', 15) + 'QR label</button>' +
    (isAdmin() ? '<button class="btn btn-ghost" data-act="archiveIt" data-id="' + esc(id) + '">' + ic('archive', 15) + (it.archived ? 'Bring back' : 'Archive') + '</button><button class="btn btn-ghost" data-act="deleteIt" data-id="' + esc(id) + '" style="color:var(--coral-700)">' + ic('trash', 15) + 'Delete</button>' : '') + '</div>' +
    (it.createdBy || it.updatedBy ? '<div class="hint">' + (it.createdBy ? 'Added by ' + esc(it.createdBy) + ' ' + esc(fmtWhen(it.createdAt)) : '') + (it.updatedBy ? (it.createdBy ? ' · ' : '') + 'last changed by ' + esc(it.updatedBy) + ' ' + esc(fmtWhen(it.updatedAt)) : '') + '</div>' : '') + '</div>';
  return h + '</div>';
};
ACT.drawerAdd = t => { const it = itemById(t.dataset.id); if (it) openAddToCart(it); };
ACT.useOne = t => { const it = itemById(t.dataset.id); if (!it) return; withWho(() => act(() => stockStep(it, -1, 'use', 'Used'), 'Took 1 ' + countUnit(it) + ' off ' + plainText(it.name, 40) + '.'), 'Who used it?'); };
ACT.archiveIt = t => { const it = itemById(t.dataset.id); if (!it) return; withAdmin(() => act(() => archiveItem(it, !it.archived), it.archived ? 'Back in the list.' : 'Archived. It’s under Supplies → Archived.'), 'Who’s archiving it?', 'archive supplies'); };
ACT.deleteIt = t => { const it = itemById(t.dataset.id); if (!it) return; withAdmin(async () => { if (!await confirmBox('Delete “' + it.name + '”?', 'It leaves the list on every computer. Past orders and spending keep its name. Archiving instead keeps it findable.', 'Delete', true)) return; return act(async () => { await deleteItem(it); closeDrawer(); }, 'Deleted.'); }, 'Who’s deleting it?', 'delete supplies'); };
