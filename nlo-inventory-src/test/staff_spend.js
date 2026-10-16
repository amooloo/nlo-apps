/* extracted from staff-meeting.html (Staff Meeting Hub's own copy of the spend arithmetic) */
const pad = n => String(n).padStart(2, '0');
const ymdOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function arrOf(x) { if (Array.isArray(x)) return x.filter(v => v != null); if (x && typeof x === 'object') return Object.keys(x).sort((a, b) => (+a) - (+b)).map(k => x[k]).filter(v => v != null); return []; }
const valsOf = x => x && typeof x === 'object' ? Object.values(x).filter(v => v != null && typeof v === 'object') : [];
function num(v) { if (v == null || v === '') return null; const n = Number(String(v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : null; }
const INV_CATS = { 'brackets-tubes': 'Brackets & Tubes', archwires: 'Archwires', elastics: 'Elastics & Elastomerics', adhesives: 'Adhesives & Cements', auxiliaries: 'Auxiliaries & Anchorage', 'clinical-supplies': 'Clinical Supplies', burs: 'Burs & Discs', instruments: 'Instruments', 'lab-3d': 'Lab, Appliances & 3D Printing', 'infection-control': 'Infection Control & PPE', 'patient-care': 'Patient Care & Giveaways', misc: 'Misc / Uncategorized' };
const INV_CAT_MIGRATION = { sterilization: 'infection-control', 'steril-liquid': 'infection-control', disposables: 'clinical-supplies', bonding: 'adhesives', elastics: 'elastics', ppe: 'infection-control', 'wire-ligature': 'auxiliaries', cleaning: 'infection-control', oties: 'elastics', chain: 'elastics', wires: 'archwires', burs: 'burs', lab: 'lab-3d', ipr: 'burs', gauges: 'instruments', aligners: 'lab-3d' };
const invCat = c => { if (c && INV_CAT_MIGRATION[c]) c = INV_CAT_MIGRATION[c]; return c && INV_CATS[c] ? c : 'misc'; };
const invLineCat = oi => { if (oi && oi.cat) return oi.cat; const sku = String((oi && oi.sku) || ''); if (/^AO-BRACKET/.test(sku)) return 'brackets-tubes'; if (/^(854|000)-/.test(sku)) return 'elastics'; return 'misc'; };
const invLineCost = oi => (oi.lineTotal != null && isFinite(oi.lineTotal)) ? Number(oi.lineTotal) : (Number(oi.price) || 0) * (Number(oi.slipQty) || Number(oi.qty) || 0);
const invDate = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Date(d + 'T12:00:00') : new Date(d);
const cents = v => Math.round(v * 100) / 100;
function computeSpending(items, orders, log, budget) {
  const itemById = {}, orderById = {}, ords = valsOf(orders), lg = valsOf(log), bud = budget && typeof budget === 'object' ? budget : {};
  valsOf(items).forEach(i => { if (i.id != null) itemById[i.id] = i; });
  ords.forEach(o => { if (o.id != null) orderById[o.id] = o; });
  const entryCat = e => {
    const it = itemById[e.itemId]; if (it) return invCat(it.cat);
    const id = String(e.itemId || ''); if (/^elasto-/.test(id)) return 'elastics'; if (/^bracket-/.test(id)) return 'brackets-tubes';
    const o = e.orderId ? orderById[e.orderId] : null, oi = o && Array.isArray(o.items) ? o.items.find(x => x && x.itemId === e.itemId) : null;
    return invCat(oi ? invLineCat(oi) : 'misc');
  };
  const months = {};
  const bucket = d => { if (!(d instanceof Date) || isNaN(d.getTime())) return null; const k = d.getFullYear() + '-' + pad(d.getMonth() + 1); return months[k] || (months[k] = { total: 0, cats: {}, shipping: 0, tax: 0 }); };
  const add = (m, cat, amt) => { if (!m || !amt || !isFinite(amt) || cat === 'lab-3d') return; m.cats[cat] = (m.cats[cat] || 0) + amt; m.total += amt; };
  lg.forEach(e => {
    const m = bucket(new Date(e.date)); if (!m) return;
    if (e.type === 'receive') add(m, entryCat(e), e.amount != null && isFinite(e.amount) ? Number(e.amount) : 0);
    else if (e.type === 'shipping') { const v = Number(e.amount) || 0; m.shipping += v; m.total += v; }
    else if (e.type === 'tax') { const v = Number(e.amount) || 0; m.tax += v; m.total += v; }
  });
  ords.forEach(o => { if (o.status !== 'received' || !o.dateReceived) return; const m = bucket(new Date(o.dateReceived)); arrOf(o.items).forEach(oi => { if (!oi || oi.itemId) return; const amt = invLineCost(oi); if (amt > 0) add(m, invCat(invLineCat(oi)), amt); }); });
  valsOf(bud.expenses).forEach(x => add(bucket(invDate(x.date)), invCat(x.category), parseFloat(x.amount) || 0));
  Object.values(months).forEach(m => { m.total = cents(m.total); m.shipping = cents(m.shipping); m.tax = cents(m.tax); Object.keys(m.cats).forEach(k => { m.cats[k] = cents(m.cats[k]); }); });
  // Inventory keeps only its newest ~300 money entries, so once it is that full the oldest month in the log is incomplete
  const money = lg.filter(e => e.type === 'receive' || e.type === 'shipping' || e.type === 'tax').map(e => Date.parse(e.date)).filter(t => !isNaN(t));
  const partialThrough = money.length >= 290 ? ymdOf(new Date(Math.min.apply(null, money))).slice(0, 7) : null;
  const alloc = {}; Object.keys(bud.categories || {}).forEach(k => { const v = num(bud.categories[k]); if (v) alloc[invCat(k)] = v; });
  return { budget: num(bud.monthly) || 8000, alloc, months, partialThrough };
}
const data = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const sp = computeSpending(data.items, data.orders, data.log, data.budget);
console.log(JSON.stringify(sp.months));
