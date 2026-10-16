/* =====================================================================
   The demo (?demo, and the stand-alone demo page): a made-up office in
   an in-memory database with the same shape as the real one, so every
   screen and every step runs the same code it runs for real. Nothing is
   saved; reloading starts over.
   ===================================================================== */
function MemDB(store) {
  this.store = store || {}; this.ls = [];
  const self = this, parts = p => String(p || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean), clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
  const tidy = v => { if (v == null || typeof v !== 'object') return v == null ? null : v; const o = Array.isArray(v) ? [] : {}; let n = 0; Object.keys(v).forEach(k => { const c = tidy(v[k]); if (c != null) { o[k] = c; n++; } }); if (!n) return null; if (Array.isArray(o)) return o.filter(x => x != null); return o; };
  const get = p => { if (String(p) === '.info/connected') return true; let o = self.store; for (const k of parts(p)) { if (o == null || typeof o !== 'object') return null; o = o[k]; } return o === undefined ? null : o; };
  const put = (p, v) => { v = tidy(clone(v)); const ks = parts(p); let o = self.store; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') { if (v == null) return; o[ks[i]] = {}; } o = o[ks[i]]; } if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v; };
  const rel = (a, b) => { a = parts(a).join('/'); b = parts(b).join('/'); return a === b || !a || !b || a.indexOf(b + '/') === 0 || b.indexOf(a + '/') === 0; };
  const fire = p => self.ls.slice().forEach(l => { if (rel(l.p, p)) setTimeout(() => { if (self.ls.includes(l)) l.cb(snap(l.p)); }, 0); });
  const snap = p => { const v = clone(get(p)); return { val: () => v, exists: () => v != null, key: parts(p).pop() || null }; };
  this.ref = p => {
    const r = {
      on(ev, cb) { const l = { p, cb }; self.ls.push(l); setTimeout(() => cb(snap(p)), 0); return cb; },
      off(ev, cb) { self.ls = self.ls.filter(l => !(l.p === p && (!cb || l.cb === cb))); },
      once() { return Promise.resolve(snap(p)); },
      set(v) { put(p, v); fire(p); return Promise.resolve(); },
      update(o) { Object.keys(o).forEach(k => put(p + '/' + k, o[k])); fire(p); return Promise.resolve(); },
      remove() { put(p, null); fire(p); return Promise.resolve(); },
      transaction(fn) { const next = fn(clone(get(p))); if (next === undefined) return Promise.resolve({ committed: false }); put(p, next); fire(p); return Promise.resolve({ committed: true, snapshot: snap(p) }); },
      push(v) { const k = 'd' + uid(); const c = self.ref(p + '/' + k); if (v !== undefined) c.set(v); return c; },
      child(c) { return self.ref(p + '/' + c); }
    };
    return r;
  };
}
const DEMO = {
  init() {
    FB.db = new MemDB(demoStore()); FB.user = { email: 'demo@example.com', emailVerified: true }; FB.alertsOn = false;
    FB.signOut = () => { location.reload(); return Promise.resolve(); };
    FB.getSetting = () => Promise.resolve(null);
    FB.uploadPhoto = (id, blob) => Promise.resolve({ url: URL.createObjectURL(blob), path: 'demo/' + id });
    FB.alert = () => { };
  }
};
/* ---------- the made-up office ---------- */
const DEMO_PEOPLE = {
  s_amir: { id: 's_amir', name: 'Dr. Avery Lane', short: 'Dr. L', title: 'Orthodontist / Owner', active: true },
  s_sarah: { id: 's_sarah', name: 'Mara Quinn', short: 'Mara Q.', title: 'Office Coordinator', active: true },
  s_gwen: { id: 's_gwen', name: 'Tessa Ruiz', short: 'Tessa R.', title: 'Clinical Assistant', active: true },
  s_kaylee: { id: 's_kaylee', name: 'Jordan Kim', short: 'Jordan K.', title: 'Clinical Assistant', active: true },
  s_angelika: { id: 's_angelika', name: 'Priya Shah', short: 'Priya S.', title: 'Clinical Assistant', active: true },
  s_savannah: { id: 's_savannah', name: 'Lena Ortiz', short: 'Lena O.', title: 'Scheduling Coordinator', active: true },
  s_wila: { id: 's_wila', name: 'Nina Park', short: 'Nina P.', title: 'Treatment Coordinator', active: true }
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
  const line = (it, q, who, d, h) => { const s = (it.sources || [])[0] || {}, per = perBuy(it); return { itemId: it.id, name: it.name, sku: s.sku || '', vendor: s.vendor || '', price: round2((s.price || 0) * per), unit: buyUnit(it), per: per > 1 ? per : null, countUnit: per > 1 ? it.unit : null, qty: q, addedBy: DEMO_PEOPLE[who].short, addedById: who, addedAt: iso(at(d, h, 12)), lineId: 'c' + it.id + d }; };
  const glove = Object.values(items).find(i => /Gloves Pulse Nitrile — SM/.test(i.name)) || pick(3);
  const cart = [line(glove, 2, 's_gwen', 0, 9), line(pick(5), 3, 's_kaylee', 1, 14), line(pick(11), 1, 's_angelika', 2, 10), line(pick(17), 2, 's_gwen', 0, 11)];
  cart[1].trail = [{ t: 'more', by: 'Mara Q.', byId: 's_sarah', at: iso(at(0, 8, 40)), qty: 1 }]; cart[1].qty = 4;
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
  const g0 = orders['d-o1'].items[0]; g0.price = round2(g0.price * 1.09); g0.lineTotal = round2(g0.price * g0.qty);
  const alt = Object.values(items).find(i => !/Gloves/i.test(i.name) && (i.sources[0].price || 0) > 5 && i.sources[0].vendor !== 'American Orthodontics');
  if (alt) alt.sources.push({ vendor: 'Benco Dental', sku: 'BD-' + String(alt.sources[0].sku || '1001').replace(/\D/g, '').slice(0, 6), price: round2(alt.sources[0].price * 0.86), src: '' });
  /* a few stock steps */
  [[pick(5), -1, 's_kaylee', 0, 8], [pick(8), -2, 's_gwen', 1, 16], [glove, -1, 's_angelika', 1, 7]].forEach(([it, dlt, who, d, h], k) => {
    const e = { id: 'u' + k, itemId: it.id, itemName: it.name, delta: dlt, type: 'use', note: 'Used', date: iso(at(d, h, 30)), by: DEMO_PEOPLE[who].short, byId: who }; log[e.id] = e;
  });
  const vendors = {};
  const budget = { monthly: 8000, categories: { 'brackets-tubes': 2500, archwires: 900, elastics: 800, 'infection-control': 1200, 'clinical-supplies': 900, adhesives: 600, misc: 500 },
    expenses: [{ id: 'x1', date: ymd(at(9, 12)), amount: 145.0, category: 'patient-care', vendor: 'Amazon Business', note: 'Retainer cases', by: 'Mara Q.' }], history: [] };
  return { nlo: { items, orders, vendors, log, cart, budget, bracketOrder: null, elastoPrices: {}, settings: { alertsOn: false, locations: ['Sterilization closet', 'Lab cabinet', 'Front desk drawer', 'Clinic bay'] }, cadence: { roster: { v: 1, people: DEMO_PEOPLE } } } };
}
