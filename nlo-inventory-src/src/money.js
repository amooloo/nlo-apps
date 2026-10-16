/* =====================================================================
   Money and the activity log — ported from Inventory 3.0.1 unchanged in
   meaning, because the Staff Meeting Hub keeps its own copy of the same
   spend arithmetic (staff-meeting.html computeSpending): if spending is
   counted differently here, change both.
   - Spend = receipts (log type "receive", the dollars stamped on the entry
     when it was received) + shipping + tax entries + received order lines
     not tied to a supply + manual expenses. Lab/3D has its own budget and
     is never counted.
   - An unpriced receipt counts as $0. Never rebuild a spend total from an
     item's current price × quantity (that produced phantom $27k months).
   ===================================================================== */

const CATEGORIES = [
  { id: 'brackets-tubes', label: 'Brackets & Tubes', color: '#1D3EA9', subs: ['Metal Brackets (MBT)', 'Metal Brackets (Roth)', 'Metal Brackets (Edgewise)', 'Ceramic/Clear Brackets', 'Self-Ligating Brackets', 'Buccal Tubes (Weldable)', 'Buccal Tubes (Bondable)'] },
  { id: 'archwires', label: 'Archwires', color: '#E29A14', subs: ['NiTi (Heat-Activated)', 'NiTi (Superelastic)', 'Stainless Steel (Solid)', 'Stainless Steel (Braided)', 'Beta Titanium (TMA)', 'Aesthetic/Coated Wires'] },
  { id: 'elastics', label: 'Elastics & Elastomerics', color: '#D9468F', subs: [] },
  { id: 'adhesives', label: 'Adhesives & Cements', color: '#EE4F3A', subs: ['Bracket Adhesives (Light Cure)', 'Bracket Adhesives (Chemical Cure)', 'Band Cements (Glass Ionomer)', 'Etch & Primers/Sealants', 'Porcelain/Metal Conditioners'] },
  { id: 'auxiliaries', label: 'Auxiliaries & Anchorage', color: '#7A5AC8', subs: ['Molar Bands', 'Hooks/Buttons/Cleats', 'Coil Springs (Open)', 'Coil Springs (Closed)', 'Bite Turbos/Bite Bumpers', 'TADs (Miniscrews)'] },
  { id: 'clinical-supplies', label: 'Clinical Supplies', color: '#1F9E7E', subs: ['Cotton & Sponges', 'Micro Applicators', 'Syringe Tips (A/W)', 'Saliva Ejectors', 'HVE & Surgical Tips', 'Dri-Angles', 'Tray Covers & Sleeves', 'Syringe Covers', 'Dappen Dishes'] },
  { id: 'burs', label: 'Burs & Discs', color: '#B4304E', subs: ['Carbide Burs', 'Diamond Burs', 'Finishing Burs', 'Adhesive Removing Burs', 'Polishing Discs', 'IPR Strips & Discs'] },
  { id: 'instruments', label: 'Instruments', color: '#5471A0', subs: ['Distal End Cutters', 'Ligature Cutters', 'Bird Beak Pliers', 'Weingart Pliers', 'Bracket Tweezers', 'Scalers', 'Band Pushers', 'Bite Sticks', 'Mirrors & Retractors', 'Gauges & Rulers'] },
  { id: 'lab-3d', label: 'Lab, Appliances & 3D Printing', color: '#8A5A2B', subs: ['3D Printer Resins (Draft/Model)', '3D Printer Resins (Splint/Nightguard)', '3D Printer Resins (Indirect Bonding Tray)', 'Aligner & Retainer Plastics', 'Lab Wire & Solder', 'IPA/Wash Solvents', 'Curing Unit Supplies', 'Resin Tank Replacements', 'Appliances (Herbst, MARA, Mouthguards, Retainers, Parts)'] },
  { id: 'infection-control', label: 'Infection Control & PPE', color: '#2E9D5B', subs: ['Gloves', 'Masks', 'Eyewear', 'Patient Bibs & Tray Covers', 'Sterilization Pouches & Wraps', 'Surface Disinfectants', 'Hand Sanitizers'] },
  { id: 'patient-care', label: 'Patient Care & Giveaways', color: '#1A8FB0', subs: ['Relief Wax/Silicone', 'Toothbrushes', 'Floss & Floss Threaders', 'Interdental Brushes', 'Retainer Cases', 'Chewies (Aligners)', 'Patient Kits'] },
  { id: 'misc', label: 'Misc / Uncategorized', color: '#969FAB', subs: [] }
];
/* old category ids → current ones */
const CAT_MIGRATION = {
  sterilization: 'infection-control', 'steril-liquid': 'infection-control', disposables: 'clinical-supplies', bonding: 'adhesives',
  elastics: 'elastics', ppe: 'infection-control', 'wire-ligature': 'auxiliaries', cleaning: 'infection-control', oties: 'elastics',
  chain: 'elastics', wires: 'archwires', burs: 'burs', lab: 'lab-3d', ipr: 'burs', gauges: 'instruments', aligners: 'lab-3d'
};
const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
function catOf(id) { if (id && CAT_MIGRATION[id]) id = CAT_MIGRATION[id]; return CAT_BY_ID[id] ? id : 'misc'; }
function catLabel(id) { return (CAT_BY_ID[catOf(id)] || CAT_BY_ID.misc).label; }
function catColor(id) { return (CAT_BY_ID[catOf(id)] || CAT_BY_ID.misc).color; }

/* ---------- order lines ---------- */
/* what one order line cost: its stamped lineTotal (qty × price − discount), else price × qty for older orders */
function orderItemCost(oi) {
  if (oi.lineTotal != null && isFinite(oi.lineTotal)) return Number(oi.lineTotal);
  return (Number(oi.price) || 0) * (Number(oi.slipQty) || Number(oi.qty) || 0);
}
function orderSubtotal(o) { return (o && Array.isArray(o.items) ? o.items : listOf(o && o.items)).reduce((s, oi) => s + (oi ? orderItemCost(oi) : 0), 0); }
/* what the order came to, with its discount, tax and shipping when they were entered */
function orderTotal(o) {
  if (!o) return 0;
  const ship = num(o.invoiceShipping != null ? o.invoiceShipping : o.shipping), tax = num(o.invoiceTaxes), disc = num(o.discount);
  return round2(orderSubtotal(o) - disc + tax + ship) || 0;
}
/* the category of an order line that isn't tied to a supply (quick-order brackets and elastomerics) */
function lineCat(oi) {
  if (oi && oi.cat) return oi.cat;
  const sku = (oi && oi.sku) || '';
  if (/^AO-BRACKET/.test(sku)) return 'brackets-tubes';
  if (/^(854|000)-/.test(String(sku))) return 'elastics';
  return 'misc';
}
/* a price from the shared quick-order price memory (nlo/elastoPrices) */
function getElastoPrice(map, sku) {
  if (!map || !sku) return null;
  const v = map[fbKey(sku)];
  if (v && typeof v.price === 'number') return v.price;
  if (typeof v === 'number') return v;
  return null;
}

/* ---------- receipts ---------- */
/* Recorded-only: the dollars stamped on the entry when it was received. No stamp counts as $0 — never price × quantity. */
function receiveEntryAmount(entry) {
  if (entry && entry.amount != null && isFinite(entry.amount)) return Number(entry.amount);
  return 0;
}

/* ---------- the activity log (nlo/log) ----------
   Kept newest first. Receipts, shipping and tax (what the budget is built from) outrank everything else when it's trimmed. */
const LOG_CAP = 450;
const LOG_MONEY_KEEP = 300;
function logTime(e) { const t = e && e.date ? Date.parse(e.date) : NaN; return isNaN(t) ? 0 : t; }
function sortLogNewestFirst(list) {
  return (Array.isArray(list) ? list : []).filter(Boolean).slice().sort((a, b) => {
    const d = logTime(b) - logTime(a); if (d) return d;
    const ia = String(a.id || ''), ib = String(b.id || ''); return ia < ib ? 1 : ia > ib ? -1 : 0;
  });
}
function isMoneyEntry(e) { return !!e && (e.type === 'receive' || e.type === 'shipping' || e.type === 'tax'); }
/* which entries to keep (newest first): never drops more than ~40% in one go */
function pruneLog(list) {
  const sorted = sortLogNewestFirst(list);
  const cap = Math.max(LOG_CAP, Math.ceil(sorted.length * 0.6));
  if (sorted.length <= cap) return sorted;
  const keep = new Array(sorted.length); let money = 0, i;
  for (i = 0; i < sorted.length && money < LOG_MONEY_KEEP; i++) if (isMoneyEntry(sorted[i])) { keep[i] = true; money++; }
  let room = cap - money;
  for (i = 0; i < sorted.length && room > 0; i++) if (!keep[i]) { keep[i] = true; room--; }
  return sorted.filter((e, k) => keep[k]);
}

/* ---------- spend ---------- */
function budgetCat(cat) { return catOf(cat && cat !== 'all' ? cat : 'misc'); }
function spendIndex(items, orders) {
  const itemById = {}, orderById = {};
  (items || []).forEach(i => { if (i && i.id != null) itemById[i.id] = i; });
  (orders || []).forEach(o => { if (o && o.id != null) orderById[o.id] = o; });
  return { itemById, orderById };
}
function entryCat(entry, idx) {
  const it = idx.itemById[entry.itemId];
  if (it) return budgetCat(it.cat);
  const id = String(entry.itemId || '');
  if (/^elasto-/.test(id)) return 'elastics';
  if (/^bracket-/.test(id)) return 'brackets-tubes';
  const o = entry.orderId ? idx.orderById[entry.orderId] : null;
  const oi = o && Array.isArray(o.items) ? o.items.find(x => x && x.itemId === entry.itemId) : null;
  return budgetCat(oi ? lineCat(oi) : 'misc');
}
/* everything spent between two Dates: { auto: {cat: $}, manual: {cat: $}, shipping, tax, total } */
function spendBetween(start, end, log, orders, expenses, idx) {
  const auto = {}, manual = {}; let shipping = 0, tax = 0, total = 0;
  const inRange = d => d instanceof Date && !isNaN(d.getTime()) && d >= start && d <= end;
  function add(bucket, cat, amt) { if (!amt || !isFinite(amt) || cat === 'lab-3d') return; bucket[cat] = (bucket[cat] || 0) + amt; total += amt; }
  (log || []).forEach(e => {
    if (!e || !inRange(new Date(e.date))) return;
    if (e.type === 'receive') add(auto, entryCat(e, idx), receiveEntryAmount(e));
    else if (e.type === 'shipping') { const sh = Number(e.amount) || 0; shipping += sh; total += sh; }
    else if (e.type === 'tax') { const tx = Number(e.amount) || 0; tax += tx; total += tx; }
  });
  /* order lines not tied to any supply never reach the log — counted here */
  (orders || []).forEach(o => {
    if (!o || o.status !== 'received' || !o.dateReceived || !inRange(new Date(o.dateReceived))) return;
    listOf(o.items).forEach(oi => { if (!oi || oi.itemId) return; const amt = orderItemCost(oi); if (amt > 0) add(auto, budgetCat(lineCat(oi)), amt); });
  });
  (expenses || []).forEach(x => { if (!x || !inRange(parseDateLocal(x.date))) return; add(manual, budgetCat(x.category), parseFloat(x.amount) || 0); });
  return { auto, manual, shipping, tax, total };
}
function monthSpend(key, D) { return spendBetween(monthStart(key), monthEnd(key), D.log, D.orders, D.expenses ? listOf(D.expenses) : (D.budget && listOf(D.budget.expenses)) || [], spendIndex(D.items, D.orders)); }
/* the oldest month the log still fully covers (older months may be missing receipts that were trimmed) */
function logCoversFrom(log) {
  const money = (log || []).filter(isMoneyEntry);
  if (money.length < LOG_MONEY_KEEP - 10) return '';
  const oldest = money.reduce((m, e) => Math.min(m, logTime(e) || Infinity), Infinity);
  return isFinite(oldest) ? shiftMonth(monthKey(oldest), 1) : '';
}
