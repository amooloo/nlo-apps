/* =====================================================================
   Products in sizes and types (5.3). Amir, 30 Oct 2026: "can you make it
   so items of similar nature that are only different in size for example
   are combined. So for example, mini screws from dentaurum are different
   by size and 2 different types. it will be much easier that way than
   entering a separate entry for each of them".
   - Every size is still a supply of its own — its own count, item #,
     price, minimum, cart and order lines, QR label and history — so
     ordering, receiving, the budget, Mari's List, AO points, the alert
     script's copy for Staff Meeting and AISA all work as before. What
     ties the sizes of one product together is on each of them:
       fam      the product's id ('fam-…')
       famName  the product's name, the same on every size
       famOpts  what tells its sizes apart, in order (["Type", "Length"])
       famVals  this size's own choices, in that order (["SD", "8 mm"])
       famPos   where it sits in the product's list
     and its name is made from them ("tomas-pin — SD · 8 mm"), so carts,
     orders, vendor emails and the activity log read as they always did.
   - Supplies shows one card per product (its photo, its sizes, what's in
     the cart, on order or low); the product's drawer lists every size
     with its count and price; one dialog adds several sizes to the cart,
     another counts them. New supply makes every size at once ("It comes
     in different sizes or types", editor.js); Edit on the product
     changes them all; Combine makes supplies already there one product,
     and Dr. A's Supplies points out the ones that look like sizes of
     each other.
   - No new rules: supplies take any fields.
   ===================================================================== */
const FAM_MAX = 60;                       // sizes in one product (they're saved in one step)
const FAM_SEP = ' — ', FAM_VSEP = ' · ';  // "tomas-pin — SD · 8 mm"
const FAM_OPT_NAMES = ['Size', 'Length', 'Diameter', 'Type', 'Color', 'Arch', 'Side', 'Shade', 'Thickness', 'Width', 'Shape', 'Head', 'Pack'];
/* a size's mark taken off: it's a supply of its own again (its count, prices and history stay; famWas — the name a supply had
   before Combine renamed it — comes back) */
const FAM_OFF = { fam: null, famName: null, famOpts: null, famVals: null, famPos: null, famWas: null };
function famOffPatch(m, s) { return Object.assign({}, FAM_OFF, m && m.famWas ? { name: m.famWas } : {}, { updatedBy: s.by, updatedAt: s.at }); }

function famId(i) { return i && i.fam ? String(i.fam) : ''; }
function famOptsOf(i) { return listOf(i && i.famOpts).map(x => String(x == null ? '' : x).trim()).slice(0, 3); }
function famValsOf(i) {
  const n = Math.max(famOptsOf(i).length, 1), v = listOf(i && i.famVals).map(x => String(x == null ? '' : x).trim());
  return Array.from({ length: n }, (x, k) => v[k] || '');
}
/* what tells a size apart: "SD · 8 mm" */
function famLabel(i) { return famValsOf(i).filter(Boolean).join(FAM_VSEP) || String((i && i.name) || ''); }
/* a size's whole name: "tomas-pin — SD · 8 mm" */
function famFullName(name, vals) {
  const v = listOf(vals).map(x => String(x == null ? '' : x).trim()).filter(Boolean).join(FAM_VSEP); name = String(name || '').trim();
  return v ? name + FAM_SEP + v : name;
}
const famNat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
function famCmp(a, b) {
  const pa = Number(a.famPos), pb = Number(b.famPos);
  if (isFinite(pa) && isFinite(pb) && pa !== pb) return pa - pb;
  return famNat(famLabel(a), famLabel(b));
}
/* a product's sizes in its order (all: the archived ones too) */
function famMembers(fid, all) { if (!fid) return []; return (all ? items() : activeItems()).filter(i => i.fam === fid).sort(famCmp); }
function famLead(fid) { return famMembers(fid)[0] || famMembers(fid, true)[0] || null; }
function famNameOf(fid) { const l = famLead(fid); return l ? String(l.famName || l.name || '') : ''; }
/* the photo a product shows: its first size that has one */
function famPhotoItem(ms) { return listOf(ms).find(m => photoOf(m)) || null; }
/* "6 sizes & types", "2 colors", "4 options" */
function famNoun(opts, n) {
  const kind = o => /size|length|diam|width|gauge|thick|dimension|\bmm\b|wire/i.test(o) ? 'size' : /colou?r|shade/i.test(o) ? 'color' : /arch|jaw/i.test(o) ? 'arch' : /side|hand/i.test(o) ? 'side' : /type|kind|style|model|head|shape/i.test(o) ? 'type' : 'option';
  const order = ['size', 'type', 'color', 'arch', 'side', 'option'];
  const u = Array.from(new Set(listOf(opts).map(kind))).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const pl = x => n === 1 ? x : x === 'arch' ? 'arches' : x + 's';
  if (!u.length) return pl('size');
  return u.length === 1 ? pl(u[0]) : u.length === 2 && !u.includes('option') ? pl(u[0]) + ' & ' + pl(u[1]) : pl('option');
}
function famCountLabel(ms) { return ms.length + ' ' + famNoun(famOptsOf(ms[0]), ms.length); }
/* the choices of one difference, in the product's order */
function famDistinct(ms, k) { const out = []; listOf(ms).forEach(m => { const v = famValsOf(m)[k]; if (v && !out.includes(v)) out.push(v); }); return out; }
/* "6, 8, 10 mm" (the unit once), "EP, SD" */
function famValsCompact(vs) {
  if (!vs.length) return '';
  const m = vs.map(v => String(v).match(/^(.*\d)\s*([a-zA-Z]{1,6}\.?)$/));
  if (vs.length > 1 && m.every(x => x) && m.every(x => x[2].toLowerCase() === m[0][2].toLowerCase())) {
    const nums = m.map(x => x[1].trim());
    return (nums.length > 5 ? nums[0] + '–' + nums[nums.length - 1] : nums.join(', ')) + ' ' + m[0][2];
  }
  return vs.length > 5 ? vs.slice(0, 4).join(', ') + ', …' : vs.join(', ');
}
/* "EP, SD · 6, 8, 10 mm" */
function famSummary(ms) { if (!ms.length) return ''; return famOptsOf(ms[0]).map((o, k) => famValsCompact(famDistinct(ms, k))).filter(Boolean).join(FAM_VSEP); }
/* the price of what's bought, lowest to highest across the sizes (usual vendor) */
function famPrice(ms) {
  const ps = ms.map(m => { const p = countPrice(primarySource(m)); return p == null ? null : p * perBuy(m); }).filter(p => p != null);
  if (!ps.length) return null;
  const lo = Math.min(...ps), hi = Math.max(...ps), one = hi - lo < 0.005;
  return { lo, hi, one, u: buyUnit(ms[0]), text: one ? money(lo) : money(lo) + '–' + money(hi), short: one ? money(lo) : 'from ' + money(lo) };
}
function famStock(ms) {
  const u = countUnit(ms[0]), same = ms.every(m => countUnit(m).toLowerCase() === u.toLowerCase());
  const sum = round2(ms.reduce((a, m) => a + (Number(m.qty) || 0), 0)) || 0, low = ms.filter(isLow).length, out = ms.filter(isOut).length;
  return { same, sum, u, low, out, text: same ? qtyFmt(sum) + ' ' + unitWord(u, sum) + ' on hand' : 'on hand in ' + plural(ms.length, 'size'),
    note: out ? out + ' out' + (low > out ? ', ' + (low - out) + ' low' : '') : low ? low + ' low' : '' };
}
/* every vendor a size is bought from (the first size's usual one first), with how many sizes and the prices */
function famVendors(ms) {
  const out = [];
  ms.forEach(m => allSources(m).forEach(s => {
    if (!s || !s.vendor) return;
    let v = out.find(x => x.vendor === s.vendor); if (!v) out.push(v = { vendor: s.vendor, n: 0, ps: [] });
    v.n++; const p = countPrice(s); if (p != null) v.ps.push(p * perBuy(m));
  }));
  return out;
}

/* ---------- the Supplies screen: one card per product ---------- */
/* the screen's list (filters and search applied) → its cards: a supply on its own ({ it }), or a product ({ fam, hits, ms }:
   the sizes the filters left, and the sizes it shows — all of them, or the archived ones under Archived) */
function supEntries(list, archived) {
  const out = [], seen = new Map();
  list.forEach(i => {
    const f = famId(i); if (!f) return out.push({ it: i });
    let e = seen.get(f);
    if (!e) { e = { fam: f, hits: [], ms: archived ? famMembers(f, true).filter(m => m.archived) : famMembers(f) }; seen.set(f, e); out.push(e); }
    e.hits.push(i);
  });
  out.forEach(e => { if (e.fam && !e.ms.length) e.ms = e.hits.slice(); });
  return out;
}
function famTagsHTML(ms, cls) {
  const t = cls === 'fl' ? 'fl' : 'ptag', sz = 11;
  const cart = ms.filter(m => inCartLine(m.id)), ord = ms.filter(m => openOrdersWith(m.id).length), back = ms.some(m => openOrdersWith(m.id).some(o => o.status === 'backordered'));
  const exp = ms.map(expDays).filter(d => d != null).sort((a, b) => a - b)[0], st = famStock(ms);
  return (cart.length ? '<span class="' + t + ' cart">' + ic('cart', sz) + 'In cart · ' + esc(cart.length === 1 ? famLabel(cart[0]) : plural(cart.length, 'size')) + '</span>' : '') +
    (ord.length ? '<span class="' + t + ' ' + (back ? 'back' : 'order') + '">' + ic('truck', sz) + (back ? 'Backordered' : 'On order') + (ord.length > 1 ? ' · ' + ord.length : '') + '</span>' : '') +
    (st.out ? '<span class="' + t + ' low">Out' + (st.out > 1 ? ' · ' + st.out : '') + '</span>' : st.low ? '<span class="' + t + ' low">Low' + (st.low > 1 ? ' · ' + st.low : '') + '</span>' : '') +
    (exp != null && exp < 90 ? '<span class="' + t + ' due">' + (exp < 0 ? 'Expired' : 'Expires soon') + '</span>' : '') +
    (ms.length && ms.every(m => m.archived) ? '<span class="' + t + ' arch">Archived</span>' : '');
}
function famCardHTML(e) {
  const ms = e.ms, lead = ms[0], pic = famPhotoItem(ms), src = primarySource(lead), pr = famPrice(ms), st = famStock(ms), tags = famTagsHTML(ms);
  const name = lead.famName || lead.name || 'Unnamed', cart = ms.some(m => inCartLine(m.id)), arch = ms.every(m => m.archived);
  return '<div class="pcard fam" data-act="openFam" data-fam="' + esc(e.fam) + '" role="button" tabindex="0" aria-label="' + esc(name + ', ' + famCountLabel(ms)) + '">' +
    '<div class="ph' + (pic ? '' : ' none') + '">' + (pic ? photoImgHTML(pic, false, true) : ic('box', 40) + '<span>No photo yet</span>') +
    (tags ? '<div class="ptags">' + tags + '</div>' : '') + '<span class="famBadge">' + ic('layers', 12) + esc(famCountLabel(ms)) + '</span>' +
    (pic ? '<button class="pzoom" data-act="viewPhoto" data-id="' + esc(pic.id) + '" aria-label="See the photo full size" title="See it full size">' + ic('zoom', 16) + '</button>' : '') + '</div>' +
    '<div class="pbd"><div class="nm">' + esc(name) + '</div><div class="famVals">' + esc(famSummary(ms)) + '</div>' +
    '<div class="vd">' + (src && src.vendor ? vlogoHTML(vendorObj(src.vendor)) + '<span>' + esc(src.vendor) + '</span>' : '<span class="muted">no vendor yet</span>') + '</div>' +
    '<div class="pft"><div style="min-width:0"><div class="pp"' + (pr && !pr.one ? ' title="' + esc(pr.text + ' per ' + pr.u) + '"' : '') + '>' + (pr ? esc(pr.short) + '<small>/' + esc(pr.u) + '</small>' : '<span class="muted">no price</span>') + '</div>' +
    '<div class="ps">' + esc(st.text) + (st.note ? ' · <span class="' + (st.out ? 'out' : 'low') + '">' + esc(st.note) + '</span>' : '') + '</div></div>' +
    (arch ? '' : '<button class="addBtn' + (cart ? ' in' : '') + '" data-act="famAdd" data-fam="' + esc(e.fam) + '" title="Add sizes to the cart">' + ic(cart ? 'check' : 'plus', 15) + (cart ? 'In cart' : 'Add') + '</button>') + '</div></div></div>';
}
function famRowHTML(e) {
  const ms = e.ms, lead = ms[0], pic = famPhotoItem(ms) || lead, src = primarySource(lead), pr = famPrice(ms), st = famStock(ms), tags = famTagsHTML(ms, 'fl');
  const cart = ms.some(m => inCartLine(m.id)), arch = ms.every(m => m.archived);
  return '<div class="irow fam" data-act="openFam" data-fam="' + esc(e.fam) + '" role="button" tabindex="0">' + thumbHTML(pic, '', true) +
    '<div style="min-width:0"><div class="nm">' + esc(lead.famName || lead.name) + ' <span class="famPill">' + ic('layers', 12) + esc(famCountLabel(ms)) + '</span></div><div class="sub">' +
    (src && src.vendor ? '<span class="v">' + vlogoHTML(vendorObj(src.vendor)) + esc(src.vendor) + '</span>' : '') + '<span>' + esc(famSummary(ms)) + '</span>' + (lead.location ? '<span>' + ic('pin', 12) + ' ' + esc(lead.location) + '</span>' : '') + '</div>' +
    (tags ? '<div class="flags">' + tags + '</div>' : '') + '</div>' +
    '<div class="act"><span class="price">' + (pr ? pr.text + '<small>per ' + esc(pr.u) + '</small>' : '<span class="muted">no price yet</span>') + '</span>' +
    '<span class="stock">' + (st.same ? esc(qtyFmt(st.sum)) + '<small>' + esc(unitWord(st.u, st.sum)) + ' on hand</small>' : esc(plural(ms.length, 'size')) + '<small>on hand</small>') + (st.note ? '<small class="' + (st.out ? 'out' : 'low') + '">' + esc(st.note) + '</small>' : '') + '</span>' +
    (arch ? '' : '<button class="addBtn' + (cart ? ' in' : '') + '" data-act="famAdd" data-fam="' + esc(e.fam) + '" title="Add sizes to the cart">' + ic(cart ? 'check' : 'plus', 15) + (cart ? 'In cart' : 'Add') + '</button>') + '</div></div>';
}
ACT.openFam = (t, e) => { if (e && e.target.closest('[data-act]') !== t) return; openDrawer('fam', t.dataset.fam); };

/* ---------- the product's drawer: every size with its count and price ---------- */
/* the sizes, grouped by the first difference when there are two or more ("SD: 6, 8, 10 mm") */
function famGroups(ms) {
  const o = famOptsOf(ms[0]);
  if (o.length < 2) return [{ g: null, ms }];
  return famDistinct(ms, 0).map(g => ({ g, ms: ms.filter(m => famValsOf(m)[0] === g) })).concat(ms.some(m => !famValsOf(m)[0]) ? [{ g: '', ms: ms.filter(m => !famValsOf(m)[0]) }] : []);
}
function famSizeRowHTML(m, sub) {
  const src = primarySource(m), cp = countPrice(src), c = inCartLine(m.id), os = openOrdersWith(m.id), v = famValsOf(m);
  const label = (sub ? v.slice(1).filter(Boolean).join(FAM_VSEP) : '') || famLabel(m), ed = expDays(m);
  const tags = (c ? '<span class="fl cart">' + ic('cart', 11) + esc(lineQtyLabel(c)) + '</span>' : '') +
    os.map(o => '<span class="fl ' + (o.status === 'backordered' ? 'back' : 'order') + '">' + ic('truck', 11) + esc(lineQtyLabel(o.items.find(l => l.itemId === m.id))) + '</span>').join('') +
    (ed != null && ed < 90 ? '<span class="fl ' + (ed < 30 ? 'low' : 'due') + '">' + (ed < 0 ? 'Expired' : 'Expires ' + esc(fmtDate(m.exp))) + '</span>' : '') + (m.archived ? '<span class="fl arch">Archived</span>' : '') + (m.tag ? '<span class="fl due">' + esc(m.tag) + '</span>' : '');
  return '<div class="vrow" data-act="openItem" data-id="' + esc(m.id) + '" role="button" tabindex="0" title="Open this size">' +
    '<div class="vn"><b>' + esc(label) + '</b><span>' + (src && src.sku ? '#' + esc(src.sku) : m.sku ? '#' + esc(m.sku) : 'no item #') + '</span>' + (tags ? '<div class="flags">' + tags + '</div>' : '') + '</div>' +
    '<div class="vp">' + (cp == null ? '<span class="muted">—</span>' : esc(money(cp * perBuy(m))) + '<small>/' + esc(buyUnit(m)) + '</small>') + '</div>' +
    '<div class="vq' + (isOut(m) ? ' out' : isLow(m) ? ' low' : '') + '"' + (isLow(m) ? ' title="Below its minimum of ' + esc(qtyFmt(m.min)) + '"' : '') + '>' + esc(qtyFmt(m.qty || 0)) + '<small>' + esc(unitWord(countUnit(m), m.qty)) + '</small></div>' +
    (m.archived ? '<span></span>' : '<button class="vadd" data-act="famAddOne" data-id="' + esc(m.id) + '" title="Add to the cart" aria-label="Add ' + esc(label) + ' to the cart">' + ic('plus', 15) + '</button>') + '</div>';
}
function famSizesHTML(ms) {
  const two = famOptsOf(ms[0]).length >= 2, o = famOptsOf(ms[0]);
  return '<div class="vtbl">' + famGroups(ms).map(g => (g.g != null ? '<div class="vgrp">' + esc((o[0] ? o[0] + ': ' : '') + (g.g || '—')) + '</div>' : '') + g.ms.map(m => famSizeRowHTML(m, two)).join('')).join('') + '</div>';
}
DRAWERS.fam = fid => {
  const all = famMembers(fid, true); if (!all.length) return '';
  const live = all.filter(m => !m.archived), ms = live.length ? live : all, gone = live.length ? all.filter(m => m.archived) : [];
  const lead = ms[0], name = lead.famName || lead.name, pic = famPhotoItem(ms), ids = new Set(all.map(m => m.id));
  let h = '<div class="dHd">' + (pic ? '' : '<button class="thumb lg addPic" data-act="famEdit" data-fam="' + esc(fid) + '" title="Add a photo">' + ic('camera', 26) + '<span>Add a photo</span></button>') +
    '<div style="flex:1;min-width:0"><h3>' + esc(name) + '</h3><div class="sub"><span class="badge" style="background:' + catColor(lead.cat) + '22;color:' + catColor(lead.cat) + '">' + esc(catLabel(lead.cat)) + '</span>' +
    (lead.group ? '<span class="badge">' + esc(lead.group) + '</span>' : '') + (lead.location ? '<span class="badge">' + ic('pin', 12) + esc(lead.location) + '</span>' : '') +
    '<span class="badge famB">' + ic('layers', 12) + esc(famCountLabel(ms)) + '</span>' + (live.length ? '' : '<span class="badge">Archived</span>') + '</div></div><button class="iconBtn" data-act="closeDrawer" aria-label="Close">' + ic('x') + '</button></div><div class="dBd">' +
    (pic ? '<div class="dHero" data-act="viewPhoto" data-id="' + esc(pic.id) + '" role="button" tabindex="0" title="See it full size">' + photoImgHTML(pic, true) + '<span class="pzoom">' + ic('zoom', 16) + '</span></div>' : '');
  h += '<div class="btnRow" style="margin-top:0">' + (live.length ? '<button class="btn btn-teal" data-act="famAdd" data-fam="' + esc(fid) + '">' + ic('cart', 16) + 'Add to cart</button><button class="btn btn-sec" data-act="famCount" data-fam="' + esc(fid) + '">' + ic('count', 16) + 'Count</button>' : '') +
    '<button class="btn btn-ghost" data-act="famEdit" data-fam="' + esc(fid) + '">' + ic('edit', 15) + 'Edit</button></div>';
  /* what's in the cart and on order, size by size */
  const inCart = ms.map(m => [m, inCartLine(m.id)]).filter(x => x[1]);
  if (inCart.length) h += '<div class="notice info" style="margin-top:14px">In the cart: ' + inCart.map(([m, c]) => '<b>' + esc(famLabel(m)) + '</b> × ' + esc(lineQtyLabel(c)) + ' (' + esc(firstName(c.addedBy) || '—') + (c.addedAt ? ', ' + esc(fmtAgo(c.addedAt)) : '') + ')').join(' · ') + '</div>';
  S.D.orders.filter(o => (o.status === 'open' || o.status === 'backordered') && o.items.some(l => ids.has(l.itemId))).forEach(o => {
    const ls = o.items.filter(l => ids.has(l.itemId));
    h += '<div class="notice" style="margin-top:10px;cursor:pointer" data-act="openOrder" data-id="' + esc(o.id) + '">' + (o.status === 'backordered' ? 'Backordered' : 'On order') + ' from ' + esc(o.vendor || '—') + ': ' +
      ls.map(l => { const m = itemById(l.itemId); return '<b>' + esc(m ? famLabel(m) : l.name) + '</b> × ' + esc(lineQtyLabel(l)); }).join(' · ') + ' — ordered by ' + esc(o.orderedBy || '—') + ', ' + esc(fmtWhen(o.orderedAt || o.dateOrdered)) + (o.expectedDelivery ? ' · due ' + esc(fmtDate(o.expectedDelivery)) : '') + '</div>';
  });
  const st = famStock(ms);
  h += '<div class="sec"><h5>' + esc(cap1(famNoun(famOptsOf(lead), 2))) + ' · ' + ms.length + (st.same ? ' · ' + esc(st.text) : '') + '</h5>' + famSizesHTML(ms) +
    '<div class="hint">Tap a size for its own page: its count, vendors, Mari’s List and history.</div></div>';
  if (gone.length) h += '<details class="sec famGone"><summary>' + plural(gone.length, 'archived size') + '</summary>' + famSizesHTML(gone) + '</details>';
  /* buying */
  const vs = famVendors(ms);
  h += '<div class="sec"><h5>Buying</h5>' + (perBuy(lead) > 1 ? '<div class="boxNote" style="margin-bottom:8px">Counted in ' + esc(unitWord(countUnit(lead), 2)) + ' · bought by the ' + esc(buyUnit(lead)) + ' of ' + perBuy(lead) + '.</div>' : '') +
    (vs.length ? vs.map(v => { const lo = v.ps.length ? Math.min(...v.ps) : null, hi = v.ps.length ? Math.max(...v.ps) : null;
      return '<div class="srcRow">' + vlogoHTML(vendorObj(v.vendor)) + '<div style="min-width:0"><div class="v">' + esc(v.vendor) + '</div><div class="k">' + (v.n === ms.length ? 'every size' : v.n + ' of ' + ms.length + ' sizes') + '</div></div>' +
        '<div class="p">' + (lo == null ? '<span class="muted">—</span>' : esc(hi - lo < 0.005 ? money(lo) : money(lo) + '–' + money(hi)) + '<small>per ' + esc(buyUnit(lead)) + '</small>') + '</div></div>'; }).join('')
      : '<div class="muted small">No vendor or price yet. <button class="linkBtn" data-act="famEdit" data-fam="' + esc(fid) + '">Add one</button></div>') + '</div>';
  if (lead.note) h += '<div class="sec"><h5>Notes</h5><div class="txt">' + esc(lead.note) + '</div></div>';
  /* orders of any of its sizes */
  const ords = S.D.orders.filter(o => o.items.some(l => ids.has(l.itemId))).sort((a, b) => msOf(b.orderedAt || b.dateOrdered) - msOf(a.orderedAt || a.dateOrdered)).slice(0, 8);
  if (ords.length) h += '<div class="sec"><h5>Orders</h5>' + ords.map(o => '<div class="hist" style="cursor:pointer" data-act="openOrder" data-id="' + esc(o.id) + '"><time>' + esc(fmtDate(o.orderedAt || o.dateOrdered)) + '</time><span style="flex:1">' +
    o.items.filter(l => ids.has(l.itemId)).map(l => { const m = itemById(l.itemId); return esc((m ? famLabel(m) : l.name) + ' × ' + lineQtyLabel(l)); }).join(', ') + ' from ' + esc(o.vendor || '—') + ' · ' + (o.status === 'received' ? 'received' + (o.receivedBy ? ' by ' + esc(o.receivedBy) : '') : esc(o.status)) + (o.orderedBy ? ' · ordered by ' + esc(o.orderedBy) : '') + '</span></div>').join('') + '</div>';
  h += '<div class="sec"><h5>More</h5><div class="btnRow" style="margin-top:0">' + (live.length ? '<button class="btn btn-ghost" data-act="famLabels" data-fam="' + esc(fid) + '">' + ic('print', 15) + 'QR labels for every size</button>' +
    '<button class="btn btn-ghost" data-act="famCombineMore" data-fam="' + esc(fid) + '">' + ic('layers', 15) + 'Add other supplies to it</button>' : '') +
    '<button class="btn btn-ghost" data-act="famSplit" data-fam="' + esc(fid) + '">' + ic('grid', 15) + 'Split into separate supplies</button>' +
    (isAdmin() && live.length ? '<button class="btn btn-ghost" data-act="famArchive" data-fam="' + esc(fid) + '">' + ic('archive', 15) + 'Archive every size</button>' : '') + '</div>' +
    (lead.createdBy || lead.updatedBy ? '<div class="hint">' + (lead.createdBy ? 'Added by ' + esc(lead.createdBy) + ' ' + esc(fmtWhen(lead.createdAt)) : '') + (lead.updatedBy ? (lead.createdBy ? ' · ' : '') + 'last changed by ' + esc(lead.updatedBy) + ' ' + esc(fmtWhen(lead.updatedAt)) : '') + '</div>' : '') + '</div>';
  return h + '</div>';
};

/* ---------- adding several sizes to the cart in one go ---------- */
ACT.famAdd = (t, e) => { if (e) e.stopPropagation(); openFamAdd(t.dataset.fam); };
ACT.famAddOne = (t, e) => { if (e) e.stopPropagation(); const it = itemById(t.dataset.id); if (!it) return; if (famId(it)) openFamAdd(it.fam, it.id); else openAddToCart(it); };
function openFamAdd(fid, oneId) {
  const ms = famMembers(fid); if (!ms.length) return toast('That product has no sizes to order.', { bad: true });
  const vs = famVendors(ms), had = ms.map(m => inCartLine(m.id)).find(Boolean), w = whoNow();
  S.ui.fadd = { fid, vendor: (had && had.vendor) || (vs[0] && vs[0].vendor) || '', q: {} };
  if (oneId) S.ui.fadd.q[oneId] = 1;
  const lead = ms[0];
  openModal('<h3>Add to the cart</h3><div class="lsub">' + esc(lead.famName || lead.name) + ' · how many of each? Leave the others at 0.</div>' +
    (vs.length > 1 ? '<div class="subH">From</div><div class="pickRow" style="margin-bottom:12px">' + vs.map((v, k) => '<button class="pick" data-act="faVendor" data-k="' + k + '" aria-pressed="' + (v.vendor === S.ui.fadd.vendor) + '">' + esc(v.vendor) + (v.n < ms.length ? ' · ' + v.n + ' of ' + ms.length : '') + '</button>').join('') + '</div>' : '') +
    '<div id="faRows">' + famAddRowsHTML() + '</div>' +
    field('Note for whoever orders (optional)', '<input id="faNote" placeholder="e.g. need by Thursday">') +
    '<div class="mFt"><span class="muted small" id="faSum" style="margin-right:auto;align-self:center">' + famAddSum() + '</span><span class="muted small" style="align-self:center">' + (w ? 'Adding as <b>' + esc(w.short) + '</b>' : '') + (isAdmin() ? '' : ' · Dr. A OKs it before it’s ordered') + '</span>' +
    '<button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="faGo" data-act="faGo">' + ic('cart', 16) + 'Add to cart</button></div>', { cls: 'wide famAddM', focus: oneId ? '#faq-' + CSS.escape(oneId) : null, noFocus: !oneId });
}
function famAddRowsHTML() {
  const F = S.ui.fadd, ms = famMembers(F.fid), two = famOptsOf(ms[0]).length >= 2, o = famOptsOf(ms[0]);
  return '<div class="vtbl faTbl">' + famGroups(ms).map(g => (g.g != null ? '<div class="vgrp">' + esc((o[0] ? o[0] + ': ' : '') + (g.g || '—')) + '</div>' : '') + g.ms.map(m => {
    const src = sourceFor(m, F.vendor), p = src ? buyPriceOf(m, src) : null, c = inCartLine(m.id), os = openOrdersWith(m.id), v = famValsOf(m);
    const label = (two ? v.slice(1).filter(Boolean).join(FAM_VSEP) : '') || famLabel(m);
    const got = S.D.orders.filter(x => x.status === 'received' && daysAgo(x.dateReceived) <= 10 && x.items.some(l => l.itemId === m.id)).sort((a, b) => msOf(b.dateReceived) - msOf(a.dateReceived))[0];
    const q = Number(F.q[m.id]) || 0;
    return '<div class="farow' + (q > 0 ? ' on' : '') + '" id="far-' + esc(m.id) + '"><div class="vn"><b>' + esc(label) + '</b><span>' + (src && src.sku ? '#' + esc(src.sku) + ' · ' : '') + (p != null ? esc(money(p)) + '/' + esc(buyUnit(m)) + ' · ' : '') + esc(qtyUnit(m.qty || 0, countUnit(m))) + ' on hand</span>' +
      (c || os.length || got ? '<div class="flags">' + (c ? '<span class="fl cart">' + ic('cart', 11) + 'in the cart: ' + esc(lineQtyLabel(c)) + '</span>' : '') + os.map(x => '<span class="fl ' + (x.status === 'backordered' ? 'back' : 'order') + '">' + ic('truck', 11) + 'on order: ' + esc(lineQtyLabel(x.items.find(l => l.itemId === m.id))) + '</span>').join('') + (got ? '<span class="fl due">got ' + esc(lineQtyLabel(got.items.find(l => l.itemId === m.id))) + ' ' + esc(fmtAgo(got.dateReceived)) + '</span>' : '') + '</div>' : '') + '</div>' +
      '<div class="qty"><button data-act="faStep" data-id="' + esc(m.id) + '" data-n="-1" aria-label="Less">−</button><input id="faq-' + esc(m.id) + '" type="number" inputmode="decimal" min="0" step="1" value="' + esc(q) + '" data-inp="faQty" data-id="' + esc(m.id) + '" data-enter="#faGo" aria-label="How many ' + esc(label) + '"><span class="u">' + esc(unitWord(buyUnit(m), q === 1 ? 1 : 2)) + '</span><button data-act="faStep" data-id="' + esc(m.id) + '" data-n="1" aria-label="More">+</button></div></div>';
  }).join('')).join('') + '</div>';
}
function famAddSum() {
  const F = S.ui.fadd; if (!F) return '';
  const ls = famMembers(F.fid).map(m => [m, Number(F.q[m.id]) || 0]).filter(x => x[1] > 0);
  if (!ls.length) return 'Nothing yet';
  const tot = ls.reduce((a, [m, q]) => { const src = sourceFor(m, F.vendor), p = src ? buyPriceOf(m, src) : null; return a + (p || 0) * q; }, 0);
  return plural(ls.length, 'size') + (tot ? ' · about <b>' + money(tot) + '</b>' : '');
}
ACT.faVendor = t => { const F = S.ui.fadd, v = famVendors(famMembers(F.fid))[Number(t.dataset.k)]; F.vendor = v ? v.vendor : ''; $$('.pick[data-act="faVendor"]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); const r = $('#faRows'); if (r) { r.innerHTML = famAddRowsHTML(); hydrateImages(r); } const s = $('#faSum'); if (s) s.innerHTML = famAddSum(); };
ACT.faStep = t => { const i = $('#faq-' + CSS.escape(t.dataset.id)); if (!i) return; i.value = Math.max(0, (num(i.value) || 0) + Number(t.dataset.n)); INP.faQty(i); };
INP.faQty = t => {
  const F = S.ui.fadd; if (!F) return; const q = Math.max(0, num(t.value)); F.q[t.dataset.id] = q;
  const row = $('#far-' + CSS.escape(t.dataset.id)); if (row) { row.classList.toggle('on', q > 0); const u = $('.u', row), m = itemById(t.dataset.id); if (u && m) u.textContent = unitWord(buyUnit(m), q === 1 ? 1 : 2); }
  const s = $('#faSum'); if (s) s.innerHTML = famAddSum();
};
ACT.faGo = t => {
  const F = S.ui.fadd; if (!F) return closeModal(true);
  $$('#faRows input[data-inp="faQty"]').forEach(i => { F.q[i.dataset.id] = Math.max(0, num(i.value)); });
  const ms = famMembers(F.fid), pairs = ms.map(m => [m, Number(F.q[m.id]) || 0]).filter(x => x[1] > 0), note = val('faNote').trim();
  if (!pairs.length) return toast('How many of which size?', { bad: true });
  withWho(async () => {
    busyBtn(t, true, 'Adding…');
    const ok = await act(() => cartAddMany(pairs, { vendor: F.vendor, note }));
    if (ok) {
      closeModal(true);
      toast('Added ' + (pairs.length === 1 ? qtyUnit(pairs[0][1], buyUnit(pairs[0][0])) + ' of ' + plainText(pairs[0][0].name, 50) : plural(pairs.length, 'size') + ' of ' + plainText(famNameOf(F.fid), 40)) + ' to the cart.' + okNote(pairs.length), { action: 'Open cart', onAction: () => go('cart') });
    } else busyBtn(t, false);
  });
};

/* ---------- counting every size at once ---------- */
ACT.famCount = t => openFamCount(t.dataset.fam);
function openFamCount(fid) {
  const ms = famMembers(fid); if (!ms.length) return;
  const two = famOptsOf(ms[0]).length >= 2, o = famOptsOf(ms[0]);
  S.ui.fcnt = { fid };
  openModal('<h3>Count</h3><div class="lsub">' + esc(ms[0].famName || ms[0].name) + ' · type what’s on the shelf for each size you count. Sizes left empty keep their number.</div>' +
    '<div class="vtbl fcTbl">' + famGroups(ms).map(g => (g.g != null ? '<div class="vgrp">' + esc((o[0] ? o[0] + ': ' : '') + (g.g || '—')) + '</div>' : '') + g.ms.map(m => {
      const v = famValsOf(m), label = (two ? v.slice(1).filter(Boolean).join(FAM_VSEP) : '') || famLabel(m);
      return '<div class="farow"><div class="vn"><b>' + esc(label) + '</b><span>The app has ' + esc(qtyUnit(m.qty || 0, countUnit(m))) + (m.chk ? ' · counted ' + esc(fmtAgo(m.chk)) + (m.chkBy ? ' by ' + esc(m.chkBy) : '') : '') + '</span></div>' +
        '<span class="small fcd" id="fcd-' + esc(m.id) + '"></span><div class="qty"><input type="number" inputmode="decimal" min="0" step="any" placeholder="' + esc(qtyFmt(m.qty || 0)) + '" data-inp="fcInp" data-id="' + esc(m.id) + '" data-enter="#fcGo" aria-label="Count of ' + esc(label) + '"><span class="u">' + esc(unitWord(countUnit(m), 2)) + '</span></div></div>';
    }).join('')).join('') + '</div>' +
    field('Note (optional)', '<input id="fcNote" placeholder="e.g. counted the lab drawer too">') +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="fcGo" data-act="fcGo">Save the counts</button></div>', { cls: 'wide famAddM', focus: '.fcTbl input' });
}
INP.fcInp = t => {
  const m = itemById(t.dataset.id), el = $('#fcd-' + CSS.escape(t.dataset.id)); if (!m || !el) return;
  if (t.value === '') { el.textContent = ''; return; }
  const d = round2(num(t.value) - (Number(m.qty) || 0));
  el.textContent = !d ? 'same' : (d > 0 ? '+' : '−') + qtyFmt(Math.abs(d)); el.style.color = !d ? 'var(--grey-500)' : d > 0 ? 'var(--mint-700)' : 'var(--amber-700)';
};
ACT.fcGo = t => {
  const F = S.ui.fcnt; if (!F) return closeModal(true);
  const pairs = $$('.fcTbl input[data-inp="fcInp"]').filter(i => i.value !== '').map(i => [itemById(i.dataset.id), num(i.value, -1)]).filter(x => x[0]);
  if (!pairs.length) return toast('Type the count of at least one size.', { bad: true });
  if (pairs.some(x => !(x[1] >= 0))) return toast('A count can’t be below 0.', { bad: true });
  const note = val('fcNote').trim();
  withWho(async () => {
    busyBtn(t, true, 'Saving…');
    const ok = await act(() => countMany(pairs, note), 'Saved ' + plural(pairs.length, 'count') + '.');
    if (ok) closeModal(true); else busyBtn(t, false);
  });
};

/* ---------- taking sizes out, splitting, archiving, labels ---------- */
/* ids leave their products; a product left with one size is no product any more (that one goes back to being a supply on its own) */
function famOutPatches(ids, s) {
  const out = new Set(ids), touched = new Set(), patches = [];
  ids.forEach(id => { const it = itemById(id); if (it && famId(it)) { touched.add(it.fam); patches.push([id, famOffPatch(it, s)]); } });
  touched.forEach(f => { const left = famMembers(f, true).filter(m => !out.has(m.id)); if (left.length === 1) patches.push([left[0].id, famOffPatch(left[0], s)]); });
  return patches;
}
ACT.famOut = t => {
  const it = itemById(t.dataset.id); if (!it || !famId(it)) return;
  const name = it.famName || '', left = famMembers(it.fam, true).length - 1;
  withWho(async () => {
    if (!await confirmBox('Take it out of “' + name + '”?', 'It becomes a supply of its own again, with its count, prices and history' + (it.famWas ? ' (and its name before it was combined: “' + it.famWas + '”)' : '') + '.' + (left === 1 ? ' That leaves one size, so “' + name + '” goes back to being a single supply too.' : ''), 'Take it out')) return;
    await act(() => B.patchItems(famOutPatches([it.id], stamp())), 'Taken out. It’s a supply of its own again.');
  });
};
ACT.famSplit = t => {
  const fid = t.dataset.fam, ms = famMembers(fid, true); if (!ms.length) return;
  withWho(async () => {
    if (!await confirmBox('Split “' + (ms[0].famName || '') + '” into separate supplies?', 'Each of its ' + ms.length + ' sizes becomes a supply of its own again. Their counts, prices and history stay (sizes that were combined get back the names they had), and they can be combined again any time.', 'Split it')) return;
    const ok = await act(() => B.patchItems(famOutPatches(ms.map(m => m.id), stamp())), 'Split into ' + plural(ms.length, 'supply', 'supplies') + '.');
    if (ok) closeDrawer();
  });
};
ACT.famArchive = t => {
  const fid = t.dataset.fam, ms = famMembers(fid); if (!ms.length) return;
  withAdmin(async () => {
    if (!await confirmBox('Archive “' + (ms[0].famName || '') + '”?', 'Its ' + plural(ms.length, 'size') + ' leave the list (they’re under Supplies → Archived, and can be brought back one by one).', 'Archive')) return;
    const s = stamp(), ok = await act(() => B.patchItems(ms.map(m => [m.id, { archived: true, archivedBy: s.by, archivedAt: s.at }])), 'Archived. It’s under Supplies → Archived.');
    if (ok) closeDrawer();
  }, '', 'archive supplies');
};
ACT.famLabels = t => printLabelsFor(famMembers(t.dataset.fam), t);
ACT.famEdit = (t, e) => {
  if (e) e.stopPropagation();
  /* (from a size's own editor: what was typed there isn't thrown away) */
  if (S.ui.ed && S.ui.ed.dirty && $('#modalWrap')) return toast('Save this size first (or Cancel), then edit the product.', { bad: true });
  S.ui.ed = null; closeModal(true); openFamEditor(t.dataset.fam);
};

/* ---------- combining supplies that are already there ---------- */
/* the words of a name, punctuation that stands alone dropped */
function famWords(s) { return String(s || '').trim().split(/\s+/).filter(Boolean); }
const FAM_SEPWORD = /^[—–\-:,·|/]+$/;
function famTrimSep(ws) { ws = ws.slice(); while (ws.length && FAM_SEPWORD.test(ws[ws.length - 1])) ws.pop(); while (ws.length && FAM_SEPWORD.test(ws[0])) ws.shift(); return ws; }
/* what tells sizes apart. Strong: numbers, sizes (SM, large, mini…), upper/lower, left/right, tooth surfaces, colors, shapes and
   other plain sizes; weak (only beside a strong one): short codes (SD, EP), roman numerals, units and filler words. A suggestion's
   supplies must differ by strong words — "Transbond XT" / "Plus", "Fuji II" / "IX" and "Wire SS" / "TMA" are different products. */
const FAM_COLORS = 'clear white black blue green red yellow pink purple orange grey gray silver gold teal navy lime aqua coral rose lilac pearl lavender burgundy brown tan ivory natural';
const FAM_STRONG = new Set(('xs s sm small m md med medium l lg large xl xxl xxxl mini micro maxi petite x-small x-large short long wide narrow thin thick fine coarse extra ' +
  'upper lower u ul ur ll lr max mand maxillary mandibular left right r lt rt ant post anterior posterior facial lingual buccal occlusal palatal ' +
  'soft firm hard light heavy single double triple open closed round rect rectangular square oval circle double-sided single-sided ' + FAM_COLORS).split(/\s+/));
const FAM_WEAK = new Set('i ii iii iv v vi ix x size sizes no # mm cm in inch ft ml g oz ct pk pc pcs gal pack bag box roll count both one side sides sided tip tips assorted regular reg std standard'.split(/\s+/));
function famWordKind(w) {
  const x = String(w || '').toLowerCase().replace(/[()",.;]+$/g, '').replace(/^[(]+/, '');
  if (!x || FAM_SEPWORD.test(x)) return 'sep';
  if (/\d/.test(x) || FAM_STRONG.has(x)) return 'strong';
  if (FAM_WEAK.has(x) || /^[A-Z]{1,3}$/.test(String(w).replace(/[()",.;]+$/g, ''))) return 'weak';
  return '';
}
function famSizeWord(w) { return !!famWordKind(w); }
const FAM_ARCH = { upper: 'Upper', lower: 'Lower', u: 'Upper', max: 'Upper', mand: 'Lower', maxillary: 'Upper', mandibular: 'Lower' };
const FAM_SIDE = { left: 'Left', right: 'Right', lt: 'Left', rt: 'Right', r: 'Right' };
/* a first guess at a product from supplies: its name (the words they share), what differs and each one's choices */
function famGuess(list) {
  list = listOf(list).filter(Boolean); if (!list.length) return { name: '', opts: ['Size'], vals: {} };
  const ws = list.map(i => famWords(i.name));
  let n = 0;
  if (list.length === 1) {
    /* one supply: its name's last words that look like a size ("NT3 NiTi" + ".014 Upper"); none: all of it is the product's name */
    const w = ws[0]; let k = w.length; while (k > 1 && famSizeWord(w[k - 1])) k--;
    n = k;
  } else while (ws.every(w => w.length > n + 1 && w[n].toLowerCase() === ws[0][n].toLowerCase())) n++;
  const name = famTrimSep(ws[0].slice(0, n)).filter(w => !/^[—–]$/.test(w)).join(' ') || String(list[0].name || '');
  const rest = ws.map(w => famTrimSep(w.slice(n)));
  const low = rest.map(r => r.map(x => x.toLowerCase().replace(/[(),.;]+$/g, '')));
  /* upper/lower (or left/right) in every one: a second difference of its own */
  const side = low.some(r => r.some(x => x === 'right' || x === 'left' || x === 'rt' || x === 'lt' || x === 'r')) && !low.some(r => r.some(x => x === 'upper' || x === 'lower' || x === 'u'));
  const map = side ? Object.assign({ l: 'Left' }, FAM_SIDE) : Object.assign({ l: 'Lower' }, FAM_ARCH);
  const hit = low.map(r => r.reduce((a, x, k) => map[x] ? a.concat([k]) : a, []));
  const vals = {};
  if (list.length > 1 && hit.every(h => h.length === 1)) {
    const firsts = rest.map((r, k) => r.filter((x, j) => j !== hit[k][0]).join(' ').trim());
    const two = firsts.some(Boolean);
    list.forEach((i, k) => { const a = map[low[k][hit[k][0]]]; vals[i.id] = two ? [firsts[k], a] : [a]; });
    const kind = side ? 'Side' : 'Arch';
    return { name, opts: two ? [famKindOf(firsts.filter(Boolean)), kind] : [kind], vals };
  }
  list.forEach((i, k) => { vals[i.id] = [rest[k].join(' ')]; });
  return { name, opts: [famKindOf(list.map(i => vals[i.id][0]).filter(Boolean))], vals };
}
function famKindOf(vs) {
  const w = vs.join(' ').toLowerCase();
  if (vs.every(v => /\d/.test(v)) || /\b(xs|sm|small|md|med|medium|lg|large|xl)\b/.test(w)) return 'Size';
  const colors = new Set(FAM_COLORS.split(' '));
  if (vs.length && vs.every(v => famWords(v).length && famWords(v).every(x => colors.has(x.toLowerCase())))) return 'Color';
  return 'Type';
}
/* supplies that look like sizes of one product: in the same category, sharing the start of their names, and differing only in
   sizes, upper/lower, colors and short codes — the most of them a shared start gives (→ [{ key, name, ids, opts, vals }]) */
function famSuggest() {
  if (S.famSugg && S.famSugg.items === S.D.items) return S.famSugg.out;
  const pool = activeItems().filter(i => !famId(i) && i.name), byCat = {};
  pool.forEach(i => (byCat[i.cat] = byCat[i.cat] || []).push(i));
  const out = [];
  Object.keys(byCat).forEach(cat => {
    const its = byCat[cat]; if (its.length < 2) return;
    const cands = new Map();
    its.forEach(i => {
      const w = famWords(i.name);
      for (let k = 1; k < w.length; k++) {
        const pre = famTrimSep(w.slice(0, k)), key = pre.join(' ').toLowerCase(); if (!key) continue;   // ("Gloves Pulse Nitrile —" is "Gloves Pulse Nitrile")
        let c = cands.get(key); if (!c) cands.set(key, c = { pre, ids: new Set() }); c.ids.add(i.id);
      }
    });
    const ok = [];
    cands.forEach((c, key) => {
      if (c.ids.size < 2 || !/[a-z]{2}/i.test(key) || key.replace(/[^a-z0-9]/gi, '').length < 2) return;
      const ms = its.filter(i => c.ids.has(i.id)), n = c.pre.length;
      const tails = ms.map(i => famTrimSep(famWords(i.name).slice(n)));
      if (tails.some(t => !t.length || t.filter(w => !FAM_SEPWORD.test(w)).length > 5 || !t.every(famSizeWord) || !t.some(w => famWordKind(w) === 'strong'))) return;
      if (new Set(tails.map(t => t.join(' ').toLowerCase())).size !== tails.length) return;
      ok.push({ key: cat + '|' + key, ms, n });
    });
    ok.sort((a, b) => b.ms.length - a.ms.length || a.n - b.n);
    const used = new Set();
    ok.forEach(c => {
      const ms = c.ms.filter(i => !used.has(i.id)); if (ms.length < 2 || ms.length !== c.ms.length) return;
      ms.forEach(i => used.add(i.id));
      const sorted = ms.slice().sort((a, b) => famNat(a.name, b.name)), g = famGuess(sorted);
      out.push({ key: c.key, cat, name: g.name, ids: sorted.map(i => i.id), opts: g.opts, vals: g.vals });
    });
  });
  out.sort((a, b) => b.ids.length - a.ids.length || famNat(a.name, b.name));
  S.famSugg = { items: S.D.items, out };
  return out;
}
function famSkipped() { try { return JSON.parse(localStorage.getItem('nloInv.famSkip') || '[]'); } catch (e) { return []; } }
function famSuggestShown() { const skip = new Set(famSkipped()); return famSuggest().filter(x => !skip.has(x.key)); }
/* Dr. A's hint on Supplies (once a visit, until he's looked) */
function famHintHTML() {
  if (!isAdmin() || S.ui.famHintOff) return '';
  const sg = famSuggestShown(); if (!sg.length) return '';
  const names = sg.slice(0, 3).map(x => x.name).filter(Boolean), more = sg.length - names.length;
  return '<div class="famHint">' + ic('layers', 18) + '<span class="grow"><b>Sizes of the same product?</b> ' + (sg.length === 1 ? 'One group' : sg.length + ' groups') + ' of supplies look like one product in different sizes' + (names.length ? ' (' + esc(names.join(', ')) + (more > 0 ? ' and ' + more + ' more' : '') + ')' : '') + '. Combine each to see one card for it.</span>' +
    '<button class="btn btn-sec btn-sm" data-act="famReview">Review</button><button class="iconBtn" data-act="famHintOff" aria-label="Not now" title="Not now">' + ic('x', 16) + '</button></div>';
}
ACT.famHintOff = () => { S.ui.famHintOff = true; renderView(true); };
ACT.famReview = () => {
  const sg = famSuggestShown(); if (!sg.length) { closeModal(true); return toast('Nothing left to combine.'); }
  openModal('<h3>Sizes of the same product?</h3><div class="lsub">These look like one product in different sizes or types. Combine each to see it as one card — every size keeps its own count, item #, price and history.</div>' +
    '<div class="famSugList">' + sg.map((x, k) => {
      const ms = x.ids.map(itemById).filter(Boolean);
      return '<div class="famSug"><div class="grow"><b>' + esc(x.name || ms[0].name) + '</b><span class="muted small"> · ' + esc(plural(ms.length, 'supply', 'supplies')) + ' · ' + esc(catLabel(x.cat)) + '</span>' +
        '<div class="small" style="color:var(--grey-600);margin-top:3px">' + esc(ms.slice(0, 5).map(m => m.name).join(' · ') + (ms.length > 5 ? ' · +' + (ms.length - 5) + ' more' : '')) + '</div></div>' +
        '<div class="btnRow" style="margin:0;flex:none"><button class="btn btn-ghost btn-sm" data-act="famSugSkip" data-k="' + k + '">Not the same</button><button class="btn btn-pri btn-sm" data-act="famSugGo" data-k="' + k + '">' + ic('layers', 14) + 'Combine…</button></div></div>';
    }).join('') + '</div><div class="mFt"><button class="btn btn-sec" data-act="closeModal">Close</button></div>', { cls: 'wide', noFocus: true });
};
ACT.famSugSkip = t => { const x = famSuggestShown()[Number(t.dataset.k)]; if (!x) return; try { localStorage.setItem('nloInv.famSkip', JSON.stringify(famSkipped().concat([x.key]).slice(-300))); } catch (e) { } ACT.famReview(); renderView(true); };
ACT.famSugGo = t => { const x = famSuggestShown()[Number(t.dataset.k)]; if (!x) return; openCombine(x.ids, { name: x.name, opts: x.opts, vals: x.vals, from: 'review' }); };
ACT.famCombine = t => openCombine([t.dataset.id]);
ACT.famCombineMore = t => { const ms = famMembers(t.dataset.fam); if (ms.length) openCombine(ms.map(m => m.id), { fid: t.dataset.fam }); };
/* the combine dialog: pick the supplies, name the product, say what tells them apart and each one's choice */
function openCombine(ids, pre) {
  pre = pre || {};
  const list = listOf(ids).map(itemById).filter(Boolean); if (!list.length) return;
  const fid = pre.fid || (list.find(i => famId(i)) || {}).fam || null, lead = fid ? famLead(fid) : null;
  const C = S.ui.cmb = { sel: list.map(i => i.id), fid, from: pre.from || null, q: '', name: '', opts: [], vals: {}, nameSet: !!(pre.name || lead), optsSet: !!(pre.opts || lead), valSet: {}, orig: fid ? famMembers(fid, true).map(m => m.id) : [] };
  if (lead) { C.name = lead.famName || ''; C.opts = famOptsOf(lead); list.forEach(i => { if (i.fam === fid) { C.vals[i.id] = famValsOf(i); C.valSet[i.id] = true; } }); }
  if (pre.name) C.name = pre.name;
  if (pre.opts) C.opts = pre.opts.slice();
  if (pre.vals) Object.keys(pre.vals).forEach(id => { C.vals[id] = pre.vals[id].slice(); C.valSet[id] = true; });
  cmbGuess(); renderCombine();
}
/* fill in what hasn't been typed from a fresh guess (as supplies are picked) */
function cmbGuess() {
  const C = S.ui.cmb, sel = C.sel.map(itemById).filter(Boolean), g = famGuess(sel);
  if (!C.nameSet) C.name = g.name;
  if (!C.optsSet) C.opts = g.opts.slice();
  if (!C.opts.length) C.opts = ['Size'];
  sel.forEach(i => {
    if (C.valSet[i.id] && C.vals[i.id]) { C.vals[i.id] = Array.from({ length: C.opts.length }, (x, k) => C.vals[i.id][k] || ''); return; }
    const gv = g.vals[i.id] || [''];
    C.vals[i.id] = Array.from({ length: C.opts.length }, (x, k) => gv.length === C.opts.length ? gv[k] || '' : k === 0 ? gv.join(' ') : '');
  });
}
function cmbCands() {
  const C = S.ui.cmb, sel = new Set(C.sel), first = itemById(C.sel[0]);
  if (C.q.trim()) return activeItems().filter(i => !sel.has(i.id) && matchesAll(itemSearchText(i), C.q)).slice(0, 8);
  if (!first) return [];
  const w0 = (famWords(first.famName || first.name)[0] || '').toLowerCase();
  return activeItems().filter(i => !sel.has(i.id) && i.cat === first.cat && (!famId(i) || i.fam !== C.fid))
    .map(i => ({ i, s: (i.group && i.group === first.group ? 2 : 0) + ((famWords(i.name)[0] || '').toLowerCase() === w0 ? 3 : 0) + ((primarySource(i) || {}).vendor && (primarySource(i) || {}).vendor === (primarySource(first) || {}).vendor ? 1 : 0) }))
    .filter(x => x.s >= 3).sort((a, b) => b.s - a.s || famNat(a.i.name, b.i.name)).slice(0, 10).map(x => x.i);
}
function cmbRowsHTML() {
  const C = S.ui.cmb;
  return '<div class="cmbTbl" style="--copts:' + C.opts.length + '"><div class="cth"><span></span><span>Supply now</span>' + C.opts.map(o => '<span>' + esc(o || 'Choice') + '</span>').join('') + '<span>Its new name</span></div>' +
    C.sel.map((id, r) => {
      const i = itemById(id); if (!i) return '';
      const v = C.vals[id] || [], other = famId(i) && i.fam !== C.fid;
      return '<div class="ctr"><button class="iconBtn" data-act="cmbDrop" data-id="' + esc(id) + '" aria-label="Leave it out" title="Leave it out">' + ic('x', 15) + '</button><span class="cnow">' + esc(i.name) + (other ? '<small>moves from “' + esc(i.famName || '') + '”</small>' : '') + '</span>' +
        C.opts.map((o, k) => '<input data-cv="' + k + '" data-id="' + esc(id) + '" data-inp="cmbVal" value="' + esc(v[k] || '') + '" aria-label="' + esc((o || 'Choice') + ' of ' + i.name) + '">').join('') +
        '<span class="cnew" id="cnew-' + r + '">' + esc(famFullName(C.name, v)) + '</span></div>';
    }).join('') + '</div>';
}
function cmbCandsHTML() {
  const cs = cmbCands();
  return cs.length ? '<div class="pickRow">' + cs.map(i => '<button class="pick sm" data-act="cmbPick" data-id="' + esc(i.id) + '">' + ic('plus', 12) + esc(i.name) + '</button>').join('') + '</div>' : '<div class="muted small">' + (S.ui.cmb.q.trim() ? 'Nothing else matches.' : 'Search for any other supply to add.') + '</div>';
}
function renderCombine(focusSel) {
  const C = S.ui.cmb, editing = !!C.fid;
  const w = openModal('<h3>' + (editing ? 'Add supplies to “' + esc(C.name) + '”' : 'Combine into one product') + '</h3><div class="lsub">Each keeps its own count, item #, price and history. Supplies shows them as one card.</div>' +
    '<div class="grid2">' + field('Product name', '<input id="cmbName" value="' + esc(C.name) + '" data-inp="cmbName" placeholder="e.g. tomas-pin mini screw" autocomplete="off">') +
    field('What tells them apart', '<div class="inRow">' + C.opts.map((o, k) => '<input data-co="' + k + '" data-inp="cmbOpt" list="famOptNames" value="' + esc(o) + '" placeholder="' + (k ? 'e.g. Type' : 'e.g. Size') + '" aria-label="What differs">').join('') +
      (C.opts.length < 3 ? '<button class="btn btn-ghost btn-sm" data-act="cmbOptAdd" title="Another difference">' + ic('plus', 14) + '</button>' : '') + (C.opts.length > 1 ? '<button class="btn btn-ghost btn-sm" data-act="cmbOptDel" title="One difference fewer">' + ic('x', 14) + '</button>' : '') + '</div>' +
      '<datalist id="famOptNames">' + FAM_OPT_NAMES.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>') + '</div>' +
    '<div id="cmbRows">' + cmbRowsHTML() + '</div>' +
    '<div class="subH" style="margin-top:14px">Add more</div><input id="cmbQ" class="inp" placeholder="Search supplies…" value="' + esc(C.q) + '" data-inp="cmbQ" autocomplete="off" style="margin-bottom:8px"><div id="cmbCands">' + cmbCandsHTML() + '</div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="' + (C.from === 'review' ? 'famReview' : 'closeModal') + '">' + (C.from === 'review' ? 'Back' : 'Cancel') + '</button><button class="btn btn-pri" data-act="cmbGo" id="cmbGo">' + ic('layers', 16) + (editing ? 'Save' : 'Combine ' + C.sel.length) + '</button></div>', { cls: 'wide', focus: focusSel || '#cmbName', noFocus: !!C.from && !focusSel });
  return w;
}
function cmbKeep() {
  const C = S.ui.cmb; if (!C || !$('#cmbName')) return;
  C.name = val('cmbName').trim() ? val('cmbName') : C.name;
  $$('[data-co]').forEach(i => { C.opts[Number(i.dataset.co)] = i.value; });
  $$('[data-cv]').forEach(i => { const v = C.vals[i.dataset.id] || (C.vals[i.dataset.id] = []); v[Number(i.dataset.cv)] = i.value; });
}
function cmbRefresh(keepFocus) {
  const a = document.activeElement, id = a && a.id, cv = a && a.dataset && a.dataset.cv, cid = a && a.dataset && a.dataset.id, pos = a && a.selectionStart;
  const r = $('#cmbRows'); if (r) r.innerHTML = cmbRowsHTML();
  const c = $('#cmbCands'); if (c) c.innerHTML = cmbCandsHTML();
  const g = $('#cmbGo'); if (g && !S.ui.cmb.fid) g.innerHTML = ic('layers', 16) + 'Combine ' + S.ui.cmb.sel.length;
  if (keepFocus && cv != null) { const i = $('[data-cv="' + cv + '"][data-id="' + CSS.escape(cid) + '"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { } } }
  else if (keepFocus && id) { const i = $('#' + id); if (i) i.focus(); }
}
INP.cmbName = t => { const C = S.ui.cmb; C.name = t.value; C.nameSet = true; C.sel.forEach((id, r) => { const el = $('#cnew-' + r); if (el) el.textContent = famFullName(C.name, C.vals[id] || []); }); };
INP.cmbOpt = t => { const C = S.ui.cmb; C.opts[Number(t.dataset.co)] = t.value; C.optsSet = true; const hs = $$('#cmbRows .cth span'); const h = hs[2 + Number(t.dataset.co)]; if (h) h.textContent = t.value || 'Choice'; };
INP.cmbVal = t => { const C = S.ui.cmb, v = C.vals[t.dataset.id] || (C.vals[t.dataset.id] = []); v[Number(t.dataset.cv)] = t.value; C.valSet[t.dataset.id] = true; const r = C.sel.indexOf(t.dataset.id), el = $('#cnew-' + r); if (el) el.textContent = famFullName(C.name, v); };
INP.cmbQ = t => { S.ui.cmb.q = t.value; const c = $('#cmbCands'); if (c) c.innerHTML = cmbCandsHTML(); };
ACT.cmbPick = t => { const C = S.ui.cmb; cmbKeep(); if (!C.sel.includes(t.dataset.id)) C.sel.push(t.dataset.id); cmbGuess(); cmbRefresh(); const q = $('#cmbQ'); if (q && C.q) q.focus(); };
ACT.cmbDrop = t => { const C = S.ui.cmb; cmbKeep(); C.sel = C.sel.filter(x => x !== t.dataset.id); delete C.valSet[t.dataset.id]; cmbGuess(); cmbRefresh(); };
ACT.cmbOptAdd = () => { const C = S.ui.cmb; cmbKeep(); if (C.opts.length >= 3) return; C.opts.push(C.opts.some(o => /type/i.test(o)) ? 'Size' : 'Type'); C.optsSet = true; Object.keys(C.vals).forEach(id => C.vals[id].push('')); renderCombine('[data-co="' + (C.opts.length - 1) + '"]'); };
ACT.cmbOptDel = () => { const C = S.ui.cmb; cmbKeep(); if (C.opts.length < 2) return; C.opts.pop(); C.optsSet = true; Object.keys(C.vals).forEach(id => { const v = C.vals[id]; if (v.length > C.opts.length) { const last = v.splice(C.opts.length); v[C.opts.length - 1] = [v[C.opts.length - 1]].concat(last).filter(Boolean).join(' '); } }); renderCombine('[data-co="' + (C.opts.length - 1) + '"]'); };
/* a size's choices fitted to fewer or more differences (one fewer: its last ones joined, as One fewer does in the dialog) */
function famFitVals(ov, n) { const v = listOf(ov).map(x => String(x || '')).slice(0, n); if (ov.length > n && n > 0) v[n - 1] = [v[n - 1]].concat(listOf(ov).slice(n)).filter(Boolean).join(' '); while (v.length < n) v.push(''); return v; }
ACT.cmbGo = t => {
  const C = S.ui.cmb; if (!C) return closeModal(true); cmbKeep();
  const name = String(C.name || '').trim(), opts = C.opts.map((o, k) => String(o || '').trim() || 'Choice ' + (k + 1));
  const sel = C.sel.map(itemById).filter(Boolean);
  if (!name) { toast('The product needs a name.', { bad: true }); const n = $('#cmbName'); if (n) n.focus(); return; }
  if (sel.length < 2) return toast(C.fid ? 'A product keeps at least two sizes — to make them separate supplies, use Split on the product’s page.' : 'Pick at least two supplies to combine.', { bad: true });
  if (sel.length > FAM_MAX) return toast('That’s more than ' + FAM_MAX + ' sizes for one product.', { bad: true });
  /* the sizes of one product are counted and bought the same way (the product's Edit prices them all by one package) */
  const how = i => countUnit(i).toLowerCase() + (perBuy(i) > 1 ? ' by the ' + buyUnit(i).toLowerCase() + ' of ' + perBuy(i) : '');
  const odd = sel.find(i => how(i) !== how(sel[0]));
  if (odd) return toast('They’re not counted the same way: “' + plainText(sel[0].name, 40) + '” is counted in ' + unitWord(countUnit(sel[0]), 2) + (perBuy(sel[0]) > 1 ? ' (bought by the ' + buyUnit(sel[0]) + ' of ' + perBuy(sel[0]) + ')' : '') + ', “' + plainText(odd.name, 40) + '” in ' + unitWord(countUnit(odd), 2) + (perBuy(odd) > 1 ? ' (bought by the ' + buyUnit(odd) + ' of ' + perBuy(odd) + ')' : '') + '. Make them the same first (Edit on each).', { bad: true, ms: 9000 });
  const vals = {}; sel.forEach(i => { vals[i.id] = opts.map((o, k) => String((C.vals[i.id] || [])[k] || '').trim()); });
  const empty = sel.find(i => !vals[i.id].some(Boolean)); if (empty) return toast('Say what makes “' + plainText(empty.name, 40) + '” different (its ' + opts[0].toLowerCase() + ').', { bad: true });
  const seen = {}; for (const i of sel) { const k = vals[i.id].join('\u0001').toLowerCase(); if (seen[k]) return toast('Two of them would both be “' + famFullName(name, vals[i.id]) + '”. Give each its own ' + opts.map(o => o.toLowerCase()).join(' or ') + '.', { bad: true }); seen[k] = 1; }
  withWho(async () => {
    busyBtn(t, true, 'Saving…');
    const s = stamp(), fid = C.fid || 'fam-' + uid(), keep = new Set(sel.map(i => i.id));
    /* (a supply joining its first product keeps the name it had, famWas, for when it leaves) */
    const patches = sel.map((i, k) => { const nm = famFullName(name, vals[i.id]); return [i.id, Object.assign({ fam: fid, famName: name, famOpts: opts, famVals: vals[i.id], famPos: k, name: nm, updatedBy: s.by, updatedAt: s.at }, !famId(i) && nm !== i.name ? { famWas: i.name } : {})]; });
    /* this product's sizes left out of the dialog leave it (only those it had when the dialog opened); its archived sizes keep up */
    if (C.fid) famMembers(C.fid, true).filter(m => !keep.has(m.id)).forEach(m => {
      if (m.archived) { const v = famFitVals(famValsOf(m), opts.length); patches.push([m.id, { famName: name, famOpts: opts, famVals: v, name: famFullName(name, v), updatedBy: s.by, updatedAt: s.at }]); }
      else if (C.orig.includes(m.id)) patches.push([m.id, famOffPatch(m, s)]);
    });
    /* another product a size moved from, left with one size, goes back to a single supply */
    const others = new Set(sel.filter(i => famId(i) && i.fam !== fid).map(i => i.fam));
    others.forEach(f => { const left = famMembers(f, true).filter(m => !keep.has(m.id)); if (left.length === 1) patches.push([left[0].id, famOffPatch(left[0], s)]); });
    const ok = await act(() => B.patchItems(patches));
    if (!ok) return busyBtn(t, false);
    const back = C.from === 'review';
    S.ui.cmb = null; closeModal(true); S.famSugg = null;
    toast((C.fid ? 'Saved: ' : 'Combined into ') + plainText(name, 50) + ' (' + plural(sel.length, 'size') + ').');
    if (back && famSuggestShown().filter(x => !x.ids.some(id => keep.has(id))).length) setTimeout(() => { S.famSugg = null; ACT.famReview(); }, 350);
    else setTimeout(() => openDrawer('fam', fid), 50);
  });
};
