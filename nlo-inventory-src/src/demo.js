/* =====================================================================
   The demo (?demo, and the stand-alone demo page): a made-up office kept
   in memory, answering the same calls the real database does (backend.js),
   so every screen and every step runs the same code it runs for real.
   Nothing is saved; reloading starts over. "Sign in as" picks Dr. A (the
   whole app; he OKs the cart) or an assistant (the simple view).
   ===================================================================== */
const DEMO = {
  as: 'amir',
  AS: [['amir', 'Dr. A'], ['gwen', 'Assistant']],
  init() {
    const st = demoStore().nlo, ml = demoMarisList(), store = {
      items: st.items, orders: st.orders, vendors: st.vendors, log: st.log, cart: st.cart, cartOk: st.cartOk, bracketOrder: st.bracketOrder, budget: st.budget, expenses: st.expenses,
      elastoPrices: st.elastoPrices, settings: Object.assign({}, st.settings), ai: {}, pics: {}, push: { topic: '' }, mlInfo: ml.info, mlRows: ml.rows, mlMatch: ml.match
    };
    return DEMO.backend(store);
  },
  backend(store) {
    const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
    const roster = Object.values(DEMO_PEOPLE).map(p => ({ sid: p.sid, name: p.name, role: p.sid === 'amir' ? 'owner' : 'staff', active: true, rid: p.id, initials: initials(p.name) }));
    const M = {
      me: null, pending: 0, onSync: null, h: null, alertsOn: false, pushOn: false, store,
      isOwner() { return !!(M.me && M.me.role === 'owner'); }, isPerm: e => /permission/i.test((e && (e.code || e.message)) || ''),
      async signIn(as) { const r = roster.find(x => x.sid === as) || roster[0]; M.me = { uid: 'u-' + r.sid, staffId: r.sid, role: r.role, name: r.name, email: r.sid + '@example.com' }; return M.me; },
      async signOut() { M.stop(); M.me = null; },
      async sendReset() { throw errCode('demo', 'Not in the demo.'); },
      async open() { return { st: 'ready', moved: { at: Date.now() } }; },
      /* each change shows up a moment later, as a real one comes back from the database */
      emit(key) {
        const v = key === 'items' || key === 'orders' || key === 'vendors' || key === 'log' || key === 'expenses' ? Object.values(store[key]) : key === 'roster' ? roster : key === 'cases' ? { idleMin: 10 } : store[key];
        setTimeout(() => { if (M.h) M.h.data(key, clone(v)); }, 0);
      },
      start(h) { M.h = h; M.alertsOn = false; ['roster', 'cases', 'settings', 'items', 'orders', 'vendors', 'log', 'cartOk', 'cart', 'bracketOrder', 'budget', 'expenses', 'elastoPrices', 'mlInfo', 'mlMatch'].forEach(M.emit); },
      /* Mari's List: made-up vendors and prices (the real ones stay in the office database) */
      watchMl() { M.emit('mlInfo'); M.emit('mlMatch'); },
      async mlRows() { return clone(store.mlRows) || []; },
      async mlSave(set, onStep) { if (!M.isOwner()) throw errCode('permission'); set.parts.forEach((p, i) => onStep && onStep(i + 1, set.parts.length)); store.mlInfo = clone(set.info); store.mlRows = [].concat(...set.parts.map(p => JSON.parse(p))); store.mlMatch = clone(set.match) || {}; M.emit('mlInfo'); M.emit('mlMatch'); },
      async mlMatchSet(itemId, list) { if (!M.isOwner()) throw errCode('permission'); const m = Object.assign({}, store.mlMatch); if (list && list.length) m[itemId] = clone(list); else delete m[itemId]; store.mlMatch = m; M.emit('mlMatch'); },
      stop() { M.h = null; },
      patchOf(rec, patch) { Object.keys(patch || {}).forEach(k => { const v = patch[k] === undefined ? null : clone(patch[k]); if (v == null) delete rec[k]; else rec[k] = v; }); return rec; },
      async addStock(id, delta) { const it = store.items[id]; if (!it) throw errCode('not-found', 'That supply is gone.'); it.qty = Math.max(0, Math.round(((Number(it.qty) || 0) + delta) * 1000) / 1000); M.emit('items'); return it.qty; },
      async addStockMany(pairs) { (pairs || []).forEach(([id, d]) => { const it = store.items[id]; if (it && Number(d)) it.qty = Math.max(0, Math.round(((Number(it.qty) || 0) + Number(d)) * 1000) / 1000); }); M.emit('items'); },
      async patchItems(list) { (list || []).forEach(([id, patch]) => { if (store.items[id]) M.patchOf(store.items[id], patch); }); M.emit('items'); },
      async setStock(id, qty) { if (store.items[id]) store.items[id].qty = qty; M.emit('items'); },
      async patchItem(id, patch) { if (!store.items[id]) throw errCode('not-found', 'That supply is gone.'); M.patchOf(store.items[id], patch); M.emit('items'); },
      async putItem(item) { store.items[item.id] = clone(item); M.emit('items'); },
      async patchOrder(id, patch) { if (!store.orders[id]) throw errCode('not-found', 'That order is gone.'); M.patchOf(store.orders[id], patch); M.emit('orders'); },
      async putOrder(o) { store.orders[o.id] = clone(o); M.emit('orders'); },
      async claimOrder(id, fn, patchFn) { const o = store.orders[id]; const next = o ? fn(o.status) : undefined; if (next === undefined) throw errCode('aborted', 'That change didn’t go through. Try again.'); if (patchFn) M.patchOf(o, patchFn(clone(o))); o.status = next; M.emit('orders'); return next; },
      async orderStep(id, fn) { const o = store.orders[id]; if (!o) throw errCode('not-found', 'That order is gone.'); const p = fn(clone(o)); if (p === undefined) throw errCode('aborted', 'That order just changed on another computer. Look at it again.'); M.patchOf(o, p); M.emit('orders'); return p; },
      async book(id, claimId, claim, o) {
        o = o || {}; const cur = store.orders[id];
        if (cur && claimId && cur.claim === claimId) return { skip: true, mine: true };
        const p = cur ? claim(clone(cur)) : undefined; if (p === undefined) throw errCode('aborted', 'That change didn’t go through. Try again.');
        M.patchOf(cur, p); if (claimId) cur.claim = claimId;
        Object.keys(o.stock || {}).forEach(k => { const it = store.items[k]; if (!it || !Number(o.stock[k])) return; it.qty = Math.max(0, Math.round(((Number(it.qty) || 0) + Number(o.stock[k])) * 1000) / 1000); if (o.items) M.patchOf(it, o.items(k, clone(it)) || {}); });
        (o.log || []).filter(Boolean).forEach(e => { store.log[e.id] = clone(Object.assign({}, e, { byId: M.me.staffId })); });
        (o.orders || []).forEach(n => { store.orders[n.id] = clone(n); });
        ['orders', 'items', 'log'].forEach(M.emit); return { done: true };
      },
      async putVendor(v) { store.vendors[v.id] = clone(v); M.emit('vendors'); },
      async patchVendor(id, patch) { store.vendors[id] = M.patchOf(store.vendors[id] || { id }, patch); M.emit('vendors'); },
      async cart(fn) {
        const ok = clone(store.cartOk) || {}, also = {}, next = fn((clone(listOf(store.cart)) || []).map(withLineId), ok, also);
        if (next === undefined) return next;
        store.cart = clone(listOf(next));
        const live = new Set(store.cart.map(c => c && c.lineId)); Object.keys(ok).forEach(k => { if (!live.has(k)) delete ok[k]; });
        store.cartOk = ok; (also.orders || []).forEach(o => { store.orders[o.id] = clone(o); });
        M.emit('cartOk'); M.emit('cart'); if (also.orders) M.emit('orders');
        return next;
      },
      async addLog(entries) { (entries || []).filter(Boolean).forEach(e => { store.log[e.id] = clone(e); }); M.emit('log'); },
      async removeLog() { }, async trimLog() { },
      async budget(patch) { store.budget = M.patchOf(store.budget || {}, patch); M.emit('budget'); },
      async addExpense(x) { store.expenses[x.id] = clone(Object.assign({}, x, { byId: M.me.staffId })); M.emit('expenses'); },
      async removeExpense(id) { delete store.expenses[id]; M.emit('expenses'); },
      async setElastoPrice(sku, price) { store.elastoPrices = Object.assign({}, store.elastoPrices, { [fbKey(sku)]: { price: round2(price), date: todayISO() } }); M.emit('elastoPrices'); },
      async bracketOrder(v) { store.bracketOrder = clone(v); M.emit('bracketOrder'); },
      async setSetting(k, v) { if (k === 'geminiKey' || k === 'openaiKey') { store.ai[k] = v; return; } store.settings = M.patchOf(Object.assign({}, store.settings), { [k]: v }); M.emit('settings'); },
      async getSetting(k) { return k === 'geminiKey' || k === 'openaiKey' ? (store.ai[k] || null) : (store.settings[k] == null ? null : store.settings[k]); },
      async uploadPhoto(id, blob) { const pid = 'p' + uid(); store.pics[pid] = 'data:' + (blob.type || 'image/jpeg') + ';base64,' + await blobBase64(blob); return { url: 'pic:' + pid, path: 'pic:' + pid }; },
      async pic(ref) { return store.pics[String(ref || '').replace(/^pic:/, '')] || ''; },
      async dropPic(ref) { delete store.pics[String(ref || '').replace(/^pic:/, '')]; },
      alert() { },
      async getPush() { return { topic: store.push.topic || '', test: 0 }; },
      async timeClockTopic() { return 'nlo-office-demo'; },
      async setPush(topic) { if (topic) store.push.topic = topic; store.settings = M.patchOf(Object.assign({}, store.settings), { pushOn: !!topic }); M.emit('settings'); },
      async testPush() { throw errCode('demo', 'The alert script (which sends the pushes) isn’t part of the demo.'); },
      async makeBot() { throw errCode('demo', 'The alert script isn’t part of the demo.'); },
      async beat() { return null; },
      async havePics() { return new Set(); }
    };
    return M;
  }
};
/* ---------- made-up Mari's List vendors, deals and prices (made-up names: no real vendor's deal or price is in the demo) ---------- */
function demoMarisList() {
  const vendors = [
    { id: 'cedar', name: 'Cedar Dental Supply', cat: 'supplies', deal: 'Member prices on gloves, cotton and disposables; free shipping over $150.', how: 'Call or email and say you’re a Mari’s List member.', say: true, contacts: [{ k: 'phone', v: '555-0188', who: 'Dana' }, { k: 'email', v: 'orders@cedar.example' }] },
    { id: 'brightline', name: 'Brightline Ortho', cat: 'supplies', deal: '18% off brackets, wires, o-ties and chain online; free shipping over $250.', code: 'BRIGHT18', how: 'Order on their website with the code.', contacts: [{ k: 'phone', v: '555-0142' }] },
    { id: 'harbor', name: 'Harbor Instruments', cat: 'supplies', deal: '20% off pliers and cutters; repairs at half price.', code: 'HARBOR20', how: 'Call and give the code.', contacts: [{ k: 'phone', v: '555-0170', who: 'Sam' }] },
    { id: 'northwind', name: 'Northwind Lab', cat: 'lab', deal: '10% off retainers and appliances.', how: 'Email the Rx and say you’re a Mari’s List member.', say: true, contacts: [{ k: 'email', v: 'rx@northwind.example' }, { k: 'text', v: '555-0123' }] },
    { id: 'pebble', name: 'Pebble Kids Giveaways', cat: 'patients', deal: '15% off toothbrush kits and prizes.', how: 'Order on their website; prices show once you sign in.' },
    { id: 'summit', name: 'Summit Office Supply', cat: 'office', deal: 'Free next-day shipping; 12% off paper and toner.', how: 'Ask for the Mari’s List account.' },
    { id: 'tidewater', name: 'Tidewater HR', cat: 'services', deal: '15% off the HR package.', how: 'Mention Mari’s List when you sign up.', uses: true }
  ];
  const R = (v, n, d, u, p, r, s, note) => [v, n, d, u, p, r == null ? null : r, s || '', note || '', -1];
  const rows = [
    R('cedar', 'CD-1102', 'Nitrile exam gloves, powder-free, blue, Small', 'Box of 200', 13.2, 18.5, 'Gloves'), R('cedar', 'CD-1103', 'Nitrile exam gloves, powder-free, blue, Medium', 'Box of 200', 13.2, 18.5, 'Gloves'),
    R('cedar', 'CD-1104', 'Nitrile exam gloves, powder-free, blue, Large', 'Box of 200', 13.2, 18.5, 'Gloves'), R('cedar', 'CD-1110', 'Nitrile exam gloves, black, Large', 'Box of 100', 8.4, 11, 'Gloves'),
    R('cedar', 'CD-2201', 'Cotton rolls #2, medium, non-sterile', 'Box of 2000', 17.95, 24, 'Cotton'), R('cedar', 'CD-3310', 'Self-seal sterilization pouches 5.25" x 6.5"', 'Box of 200', 12.4, 16.99, 'Sterilization'),
    R('cedar', 'CD-3311', 'Self-seal sterilization pouches 3.5" x 9"', 'Box of 500', 24.9, 31, 'Sterilization'), R('cedar', 'CD-4100', 'Saliva ejectors, white with blue tip', 'Bag of 100', 2.95, 3.9, 'Disposables'),
    R('cedar', 'CD-4200', 'HVE evacuator tips, vented', 'Bag of 100', 5.4, 7.2, 'Disposables'), R('cedar', 'CD-5100', 'Earloop masks, level 1, blue', 'Box of 50', 6.25, 8.5, 'Masks'),
    R('brightline', 'BL-0140', 'Elastomeric ligatures (o-ties), 20-tie sticks, any color', 'Bag of 1000', 15.5, 21, 'Elastomerics'), R('brightline', 'BL-0150', 'Power chain, closed, 15 ft spool, any color', 'Spool', 14.9, 19.9, 'Elastomerics'),
    R('brightline', 'BL-0201-U', 'NiTi archwire, round .014, upper, ovoid', 'Pack of 10', 12.8, 17.5, 'Archwires'), R('brightline', 'BL-0201-L', 'NiTi archwire, round .014, lower, ovoid', 'Pack of 10', 12.8, 17.5, 'Archwires'),
    R('brightline', 'BL-0216-U', 'NiTi archwire, round .016, upper, ovoid', 'Pack of 10', 12.8, 17.5, 'Archwires'), R('brightline', 'BL-0216-L', 'NiTi archwire, round .016, lower, ovoid', 'Pack of 10', 12.8, 17.5, 'Archwires'),
    R('brightline', 'BL-0322-U', 'NiTi archwire, rectangular .016 x .022, upper', 'Pack of 10', 13.4, 18.2, 'Archwires'), R('brightline', 'BL-0510-U', 'Stainless steel archwire .016 x .022, upper', 'Pack of 10', 7.95, 10.5, 'Archwires'),
    R('brightline', 'BL-0900', 'Blue etch gel 37%, 5 g syringe with tips', 'Syringe', 11.6, 14.5, 'Bonding'),
    R('harbor', 'HI-210', 'Distal end cutter, tungsten carbide, long handle', 'Each', 112, 140, 'Cutters'), R('harbor', 'HI-220', 'Ligature cutter, tungsten carbide', 'Each', 98, 122.5, 'Cutters'),
    R('harbor', 'HI-310', 'Weingart utility plier', 'Each', 64, 80, 'Pliers'), R('harbor', 'HI-410', 'Bird beak plier', 'Each', 58, 72.5, 'Pliers'),
    R('northwind', 'NW-R1', 'Hawley retainer, standard', 'Each', 54, 60, 'Lab services'), R('northwind', 'NW-R2', 'Clear retainers, upper and lower', 'Set', 63, 70, 'Lab services'),
    R('northwind', 'NW-E1', 'Rapid palatal expander, banded', 'Each', 128.7, 143, 'Lab services'),
    R('pebble', 'PK-10', 'Kids toothbrush kit with timer', 'Case of 72', 86.4, 101.65, 'Giveaways'), R('pebble', 'PK-22', 'Glow-in-the-dark prize balls', 'Bag of 100', 17, 20, 'Giveaways'),
    R('summit', 'SO-100', 'Copy paper, 8.5 x 11, 10 reams', 'Case', 44, 50, 'Paper'), R('summit', 'SO-210', 'Toner cartridge, black, high yield', 'Each', 59, 89, 'Toner')
  ];
  vendors.forEach(v => { v.n = rows.filter(r => r[0] === v.id).length; });
  const keys = mlKeys(rows), at = k => keys[rows.findIndex(r => r[1] === k)];
  const link = (n, x) => { const r = rows.find(z => z[1] === n); return { k: at(n), x, s: 'similar', v: r[0], n: r[1], d: r[2], u: r[3], p: r[4], r: r[5], by: 'Dr. A' }; };
  const match = { 'ppe-1': [link('CD-1102', 2)], 'ppe-2': [link('CD-1104', 2)], 'ot-1': [link('BL-0140', 1)], 'w-1': [link('BL-0201-U', 1)], 'w-2': [link('BL-0201-L', 1)], 'st-2': [link('CD-3310', 1)], 'd-1': [link('CD-2201', 1)], 'bn-2': [link('BL-0900', 1)] };
  const day = 864e5;
  return { info: { ver: 'demo1', at: isoOf(new Date(Date.now() - 6 * day)), src: 'Made-up for the demo', vendors, parts: 1, rows: rows.length, loadedAt: new Date(Date.now() - 2 * day).toISOString(), loadedBy: 'Dr. A' }, rows, match };
}
/* made-up Quick order prices (and what a bracket earns in AO's points), so the Quick order shows prices in the demo */
function demoQuickPrices(day) {
  const p = {}, put = (k, price, earn) => { p[fbKey(k)] = Object.assign({ price, date: day }, earn ? { earn } : {}); };
  BRACKET_SYSTEMS.forEach((s, i) => { const one = [10.4, 19.5, 7.4, 3.1, 19.5][i] || 4; /* Empower 2, Empower Clear, Iconix, Mini Master, Radiance (made-up) */ put('AO-BRACKET-IND|' + s, one, round2(one * 0.45)); put('AO-BRACKET-SET|' + s, round2(one * 24), round2(one * 24 * 0.45)); });
  Object.values(ELASTO_CODES).forEach(m => Object.values(m).forEach(code => put(code, /^854-25/.test(code) ? 36 : 24)));
  WILDLIFE_ANIMALS.wlAll.forEach(a => put(a.code, a.pks === 100 ? 52 : 29));
  return p;
}
/* ---------- the made-up office ---------- */
const DEMO_PEOPLE = {
  s_amir: { id: 's_amir', sid: 'amir', name: 'Dr. Avery Lane', short: 'Dr. A', title: 'Orthodontist / Owner', active: true },
  s_sarah: { id: 's_sarah', sid: 'sarah', name: 'Mara Quinn', short: 'Mara Q.', title: 'Office Coordinator', active: true },
  s_gwen: { id: 's_gwen', sid: 'gwen', name: 'Tessa Ruiz', short: 'Tessa R.', title: 'Clinical Assistant', active: true },
  s_kaylee: { id: 's_kaylee', sid: 'kaylee', name: 'Jordan Kim', short: 'Jordan K.', title: 'Clinical Assistant', active: true },
  s_angelika: { id: 's_angelika', sid: 'angelika', name: 'Priya Shah', short: 'Priya S.', title: 'Clinical Assistant', active: true },
  s_savannah: { id: 's_savannah', sid: 'savannah', name: 'Lena Ortiz', short: 'Lena O.', title: 'Scheduling Coordinator', active: true },
  s_wila: { id: 's_wila', sid: 'wila', name: 'Nina Park', short: 'Nina P.', title: 'Treatment Coordinator', active: true }
};
function demoStore() {
  const day = 864e5, now = Date.now(), iso = ms => new Date(ms).toISOString(), ymd = ms => isoOf(new Date(ms));
  const at = (d, h, m) => { const x = new Date(now - d * day); x.setHours(h, m || 0, 0, 0); return x.getTime(); };
  const st = (who, d, h, m) => ({ by: DEMO_PEOPLE[who].short, byId: who, at: iso(at(d, h, m)) });
  /* supplies: the old app's starting list, with made-up stock, prices and vendors */
  const vend = { 'https://shop.americanortho.com': 'American Orthodontics', 'https://www.sunsurgical.com': 'SunSurgical' };
  const items = {};
  (typeof SEED !== 'undefined' ? SEED : []).forEach((s, i) => {
    const v = vendorFromSrc(s.src) || vend[s.src] || 'Henry Schein';
    const it = { id: s.id, name: s.name, cat: catOf(s.cat), unit: s.unit || 'ea', qty: (i * 7) % 9, min: s.min || 1, group: s.group || '', note: s.note || '',
      sources: [{ vendor: v, sku: s.sku || '', price: s.price || 0, src: s.src || '' }] };
    if (s.imgKey) it.imgKey = s.imgKey;
    /* gloves: counted in boxes, bought by the case of 10 — except one left "by the box", as the real list is before
       Settings → Bought by the case sets it up, so the demo shows that step too */
    if (/^Gloves/i.test(s.name)) { it.unit = 'box'; it.qty = 14; it.min = 10; it.location = 'Sterilization closet'; if (!/Black/i.test(s.name)) { it.buyUnit = 'case'; it.perBuy = 10; } }
    items[it.id] = it;
  });
  const I = id => items[id] || Object.values(items)[0];
  const ids = Object.keys(items), pick = n => I(ids[n % ids.length]);
  /* AO Partner Dollars (made-up): what each AO supply does with AO's points — its wires, ties and elastics are paid with them;
     three made-up brackets and tubes earn them (added after the picks above, so the rest of the demo stays as it was) */
  const ptsDay = ymd(at(20, 10));
  Object.values(items).forEach(i => { if ((i.sources[0] || {}).vendor === 'American Orthodontics') i.aoPts = { pay: true, at: ptsDay }; });
  [['d-bk1', 'Metal bracket .018 MBT, upper central (demo)', 2.84, 1.28, 260], ['d-bk2', 'Metal bracket .018 MBT, lower incisor (demo)', 2.84, 1.28, 180], ['d-tb1', 'Buccal tube .018, 1st molar, bondable (demo)', 5.04, 1.84, 64]]
    .forEach(([id, name, price, earn, qty]) => { items[id] = { id, name, cat: 'brackets-tubes', unit: 'each', qty, min: 40, group: 'Brackets & tubes (demo)', note: '', sources: [{ vendor: 'American Orthodontics', sku: '', price, src: 'https://shop.americanortho.com' }], aoPts: { earn, at: ptsDay } }; });
  const line = (it, q, who, d, h) => { const s = (it.sources || [])[0] || {}, per = perBuy(it); return { itemId: it.id, name: it.name, sku: s.sku || '', vendor: s.vendor || '', price: round2((s.price || 0) * per), unit: buyUnit(it), per: per > 1 ? per : null, countUnit: per > 1 ? it.unit : null, qty: q, addedBy: DEMO_PEOPLE[who].short, addedById: who, addedAt: iso(at(d, h, 12)), lineId: 'c' + it.id + d }; };
  const glove = Object.values(items).find(i => /Gloves Pulse Nitrile — SM/.test(i.name)) || pick(3);
  const cart = [line(glove, 2, 's_gwen', 0, 9), line(pick(5), 3, 's_kaylee', 1, 14), line(pick(11), 1, 's_angelika', 2, 10), line(pick(17), 2, 's_gwen', 0, 11)];
  cart[1].trail = [{ t: 'more', by: 'Mara Q.', byId: 's_sarah', at: iso(at(0, 8, 40)), qty: 1 }]; cart[1].qty = 4;
  /* Dr. A's OKs: two lines OK'd, one raised after his OK (he OK'd 3), one still waiting */
  const okd = (c, n, d, h) => ({ by: 'Dr. A', byId: 'amir', at: iso(at(d, h, 30)), n: n * linePer(c), it: c.itemId, v: c.vendor || '', p: round2(Number(c.price) || 0) });
  const cartOk = { [cart[0].lineId]: okd(cart[0], 2, 0, 9), [cart[1].lineId]: okd(cart[1], 3, 1, 15), [cart[3].lineId]: okd(cart[3], 2, 0, 11) };
  [0, 1, 3].forEach(k => { cart[k].trail = (cart[k].trail || []).concat([{ t: 'ok', by: 'Dr. A', byId: 'amir', at: cartOk[cart[k].lineId].at }]).sort((a, z) => String(a.at).localeCompare(String(z.at))); });
  /* orders */
  const orders = {}, log = {};
  const mkOrder = (id, vendorName, lines, o) => {
    const ord = Object.assign({ id, vendor: vendorName, items: lines.map(l => Object.assign({}, l, { lineTotal: round2(l.price * l.qty) })), status: 'open', dateOrdered: ymd(at(o.ordered, 10)), orderedAt: iso(at(o.ordered, 10, 5)), orderedBy: DEMO_PEOPLE[o.by].short, orderedById: o.by, method: o.method || 'online', trail: [] }, o.extra || {});
    ord.trail.push({ t: 'ordered', by: ord.orderedBy, byId: o.by, at: ord.orderedAt, how: ord.method });
    if (o.received != null) {
      ord.status = 'received'; ord.dateReceived = iso(at(o.received, 13, 20)); ord.receivedBy = DEMO_PEOPLE[o.rby].short; ord.receivedById = o.rby; ord.countUpdated = true; ord.receiveMethod = 'manual';
      ord.trail.push({ t: 'received', by: ord.receivedBy, byId: o.rby, at: ord.dateReceived });
      ord.items.forEach(l => { const e = { id: 'l' + id + l.itemId, itemId: l.itemId, itemName: l.name, delta: (l.qty || 0) * (l.per || 1), note: 'Order received: ' + vendorName, type: 'receive', date: ord.dateReceived, amount: l.lineTotal, orderId: id, by: ord.receivedBy, byId: o.rby }; log[e.id] = e; });
      if (o.ship) { const e = { id: 's' + id, type: 'shipping', amount: o.ship, note: 'Shipping: ' + vendorName, date: ord.dateReceived, orderId: id, by: ord.receivedBy }; log[e.id] = e; ord.invoiceShipping = o.ship; ord.shipping = o.ship; }
    }
    if (o.back) { ord.status = 'backordered'; ord.dateBackordered = iso(at(o.back, 9)); ord.trail.push({ t: 'backordered', by: 'Mara Q.', byId: 's_sarah', at: ord.dateBackordered }); }
    orders[id] = ord;
  };
  mkOrder('d-o1', 'SunSurgical', [line(glove, 3, 's_gwen', 3, 9), line(pick(8), 2, 's_kaylee', 3, 15)], { ordered: 2, by: 's_sarah', method: 'online', extra: { expectedDelivery: ymd(at(-2, 9)), orderNumber: 'SS-48211' } });
  mkOrder('d-o2', 'American Orthodontics', [line(pick(1), 4, 's_angelika', 6, 10), line(pick(2), 2, 's_angelika', 6, 10)], { ordered: 5, by: 's_amir', method: 'phone', extra: { expectedDelivery: ymd(at(1, 9)) } });
  mkOrder('d-o3', 'Henry Schein', [line(pick(20), 2, 's_kaylee', 12, 11)], { ordered: 11, by: 's_sarah', method: 'online', back: 4 });
  for (let m = 0; m < 6; m++) {
    const d = 10 + m * 30;
    mkOrder('d-r' + m + 'a', 'American Orthodontics', [line(pick(m * 3 + 1), 3 + m % 3, 's_gwen', d + 6, 9), line(pick(m * 3 + 2), 2, 's_kaylee', d + 6, 10), line(pick(m * 3 + 30), 6, 's_angelika', d + 5, 10)], { ordered: d + 4, by: 's_sarah', received: d, rby: 's_kaylee', ship: 18.5 });
    mkOrder('d-r' + m + 'b', 'SunSurgical', [line(glove, 2 + (m % 2), 's_gwen', d + 12, 9), line(pick(m * 5 + 7), 4, 's_angelika', d + 12, 14)], { ordered: d + 10, by: 's_sarah', received: d + 7, rby: 's_gwen' });
  }
  /* the newest glove order costs more than the ones before, and one supply is cheaper at another vendor, so Budget → Prices has something to show */
  /* an AO order placed after the made-up balance was read: its brackets and tubes earn, its wires are paid with points */
  mkOrder('d-pts', 'American Orthodontics', [line(items['d-bk1'], 40, 's_kaylee', 8, 9), line(items['d-tb1'], 8, 's_kaylee', 8, 9), line(I('w-3'), 2, 's_gwen', 8, 10)], { ordered: 7, by: 's_sarah', method: 'phone', received: 4, rby: 's_kaylee' });
  const g0 = orders['d-o1'].items[0]; g0.price = round2(g0.price * 1.09); g0.lineTotal = round2(g0.price * g0.qty);
  const alt = Object.values(items).find(i => !/Gloves/i.test(i.name) && (i.sources[0].price || 0) > 5 && i.sources[0].vendor !== 'American Orthodontics');
  if (alt) alt.sources.push({ vendor: 'Benco Dental', sku: 'BD-' + String(alt.sources[0].sku || '1001').replace(/\D/g, '').slice(0, 6), price: round2(alt.sources[0].price * 0.86), src: '' });
  /* a few stock steps */
  [[pick(5), -1, 's_kaylee', 0, 8], [pick(8), -2, 's_gwen', 1, 16], [glove, -1, 's_angelika', 1, 7]].forEach(([it, dlt, who, d, h], k) => {
    const e = { id: 'u' + k, itemId: it.id, itemName: it.name, delta: dlt, type: 'use', note: 'Used', date: iso(at(d, h, 30)), by: DEMO_PEOPLE[who].short, byId: who }; log[e.id] = e;
  });
  const vendors = { ao: { id: 'ao', pts: { bal: 1250, exp: ymd(now + 800 * day), at: iso(at(20, 10, 15)), by: 'Dr. A' } } };
  const budget = { monthly: 8000, categories: { 'brackets-tubes': 2500, archwires: 900, elastics: 800, 'infection-control': 1200, 'clinical-supplies': 900, adhesives: 600, misc: 500 }, history: [] };
  const expenses = { x1: { id: 'x1', date: ymd(at(9, 12)), amount: 145.0, category: 'patient-care', vendor: 'Amazon Business', note: 'Retainer cases', by: 'Mara Q.', byId: 's_sarah' } };
  return { nlo: { items, orders, vendors, log, cart, cartOk, budget, expenses, bracketOrder: null, elastoPrices: demoQuickPrices(ymd(now)), settings: { alertsOn: false, locations: ['Sterilization closet', 'Lab cabinet', 'Front desk drawer', 'Clinic bay'] }, cadence: { roster: { v: 1, people: DEMO_PEOPLE } } } };
}
