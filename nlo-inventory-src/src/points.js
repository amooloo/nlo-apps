/* =====================================================================
   AO Partner Dollars — American Orthodontics' points (Amir, 17 Oct 2026: "can you see if you can somehow incoporate their
   point system in our invenvory?" … "this whole point sysstem is confusing as hell" … "you should APPROXIMATE our points going
   forward … if you have the price of each items which you do").
   How AO's points work (read from AO Direct, Oct 2026): brackets and tubes earn Partner Dollars (about 36% of AO's list
   price, which is about 45% of the office's own price — $1.28 on a $2.84 Mini Master bracket); everything else AO sells
   (wires, elastics, ties, buttons, supplies) can be paid with them dollar for dollar and earns nothing, and the office's
   account pays with them by default. They expire.
   - The balance AO Direct last showed is kept on the AO vendor's record: pts = { bal, exp, at, by }. Dr. A updates it from
     AO Direct → Partner detail (or Claude does, from his Chrome).
   - Each AO supply can say what it does, as AO Direct gave it: aoPts = { earn: dollars per counted unit } or { pay: true }
     (or { none: true }), with the day it was read. Without it: brackets and tubes earn about 45% of what's paid (AO Direct's
     figures for the office's price, Oct 2026), anything else is paid with points. Quick order brackets keep what one earns
     beside their price in the shared price memory (earn).
   - From that balance on, the page counts: every AO order received in Inventory and placed after the balance was read adds
     what its brackets and tubes earn, and takes off what its other lines cost (no more than there is). Orders that never
     pass through Inventory (the rep's, unless they're received here) and AO's kit-assembly charges aren't seen — so it's
     "about", and it says when the balance was last checked.
   - A supply's real cost after points: what's paid minus what it earns.
   Only Dr. A sees any of it.
   ===================================================================== */
const PTS_VENDOR = 'ao';
const PTS_EARN_GUESS = 0.45;
const PTS_STALE_DAYS = 45;
function isAoName(n) { return !!n && vendorNamesSimilar(n, 'American Orthodontics'); }
function aoSource(it) { return allSources(it).find(s => s && isAoName(s.vendor)) || null; }
function looksHardware(name, cat) { return cat === 'brackets-tubes' || /\b(BKTS?|BRACKETS?|TUBES?)\b/i.test(String(name || '')); }
/* the balance AO Direct last showed (null until there is one) */
function ptsAnchor() {
  const v = S.D.vendors.find(x => x && x.id === PTS_VENDOR), p = v && v.pts;
  return p && typeof p === 'object' && isFinite(Number(p.bal)) && Number(p.bal) >= 0 && msOf(p.at) ? p : null;
}
/* what an AO supply does with points: { earn: dollars per counted unit, guess } | { pay: true, guess } | null */
function ptsRule(it) {
  const src = it && aoSource(it); if (!src) return null;
  const r = it.aoPts && typeof it.aoPts === 'object' ? it.aoPts : null;
  if (r && Number(r.earn) > 0) return { earn: Number(r.earn) };
  if (r && r.pay) return { pay: true };
  if (r && r.none) return null;
  if (looksHardware(it.name, it.cat)) { const cp = countPrice(src); return cp ? { earn: round2(cp * PTS_EARN_GUESS), guess: true } : null; }
  return { pay: true, guess: true };
}
/* Quick order brackets (a set, or single teeth, of one system): the shared price memory keeps what one earns (earn), as
   AO Direct gives it, beside its price */
function ptsQuickEntry(l) {
  if (!l || !/^AO-BRACKET-(SET|IND)$/.test(l.sku || '')) return null;
  const v = (S.D.elastoPrices || {})[fbKey(l.sku + '|' + String(l.name || '').replace(/\s*\(single teeth\)$/, ''))];
  return v && typeof v === 'object' ? v : null;
}
/* one line of an AO order: what it earned and what points could pay for */
function ptsLine(l) {
  const it = l && l.itemId ? itemById(l.itemId) : null, r = it && it.aoPts && typeof it.aoPts === 'object' ? it.aoPts : null;
  const cost = Math.max(0, orderItemCost(l) || 0), q = it ? null : ptsQuickEntry(l);
  if (q && Number(q.earn) > 0) return { earn: (Number(l.slipQty) || Number(l.qty) || 0) * Number(q.earn), pay: 0 };
  if (r && Number(r.earn) > 0) return { earn: lineStockDelta(l) * Number(r.earn), pay: 0 };
  if (r && r.pay) return { earn: 0, pay: cost };
  if (r && r.none) return { earn: 0, pay: 0 };
  if (looksHardware(it ? it.name : l.name, it ? it.cat : lineCat(l))) return { earn: cost * PTS_EARN_GUESS, pay: 0 };
  return { earn: 0, pay: cost };
}
function ptsWhen(o) { return msOf(o.orderedAt || o.dateOrdered || o.dateReceived); }
/* the AO orders counted since the balance was read: received here, placed after it */
function ptsOrders(a) {
  const t0 = msOf(a.at);
  return S.D.orders.filter(o => o && o.status === 'received' && isAoName(o.vendor) && ptsWhen(o) > t0).sort((x, y) => ptsWhen(x) - ptsWhen(y));
}
/* the estimate now: { bal, was, at, exp, by, earned, used, orders } (null until a balance is in) */
function ptsNow() {
  const a = ptsAnchor(); if (!a) return null;
  const ords = ptsOrders(a); let bal = Number(a.bal), earned = 0, used = 0;
  ords.forEach(o => {
    let e = 0, p = 0; listOf(o.items).forEach(l => { if (!l) return; const x = ptsLine(l); e += x.earn; p += x.pay; });
    const u = Math.min(bal, p); bal = bal - u + e; used += u; earned += e;
  });
  return { bal: round2(bal), was: round2(Number(a.bal)), at: a.at, exp: a.exp || '', by: a.by || '', earned: round2(earned), used: round2(used), orders: ords.length };
}
/* a supply bought from AO that earns: what it really costs after the points it brings back (per counted unit) */
function ptsAfter(it) {
  const r = ptsRule(it); if (!r || !r.earn) return null;
  const cp = countPrice(aoSource(it)); if (cp == null) return null;
  return { earn: r.earn, after: Math.max(0, round2(cp - r.earn)), cp, guess: !!r.guess };
}
/* on a supply's card and row (Dr. A): "≈ $1.56 after AO points", when AO is where it's usually bought */
function ptsAfterHTML(it) {
  if (!isAdmin()) return '';
  const s = primarySource(it); if (!s || !isAoName(s.vendor)) return '';
  const x = ptsAfter(it); if (!x) return '';
  const per = buysBigger(it) ? perBuy(it) : 1;
  return '<span class="ptsAfter" title="Earns ' + (x.guess ? 'about ' : '') + esc(money(x.earn)) + ' in AO Partner Dollars per ' + esc(countUnit(it)) + '">≈ ' + money(x.after * per) + ' after AO points</span>';
}
/* Quick order (Dr. A): a bracket set's or a bracket's cost after the points it earns, beside its price */
function ptsQuickAfterHTML(key) {
  if (!isAdmin()) return '';
  const v = (S.D.elastoPrices || {})[fbKey(key)];
  if (!v || typeof v !== 'object' || !(Number(v.earn) > 0) || !(Number(v.price) > 0)) return '';
  return '<span class="ptsAfter inl"> · ≈ ' + money(Math.max(0, Number(v.price) - Number(v.earn))) + ' after AO points</span>';
}
/* in a supply's drawer (Dr. A): what it does with AO's points */
function ptsDrawerHTML(it) {
  if (!isAdmin()) return '';
  const r = ptsRule(it); if (!r) return '';
  const u = countUnit(it), per = /^(each|ea|ea\.)$/i.test(u) ? ' each' : ' per ' + esc(u);
  if (r.earn) {
    const x = ptsAfter(it);
    return '<div class="ptsNote">' + ic('dollar', 15) + '<span>AO Partner Dollars: earns ' + (r.guess ? 'about ' : '') + money(r.earn) + per + (x ? ' — <b>≈ ' + money(x.after) + per + ' after points</b>' : '') + '.</span></div>';
  }
  const p = ptsNow();
  return '<div class="ptsNote pay">' + ic('dollar', 15) + '<span>AO Partner Dollars: AO pays for this with your points first' + (p ? ' (about ' + money(p.bal, { whole: true }) + ' left)' : '') + '.</span></div>';
}
/* Dr. A's Home: the balance, as AO Direct last showed it plus what's come and gone since */
function ptsHomeCardHTML() {
  if (!isAdmin()) return '';
  const p = ptsNow();
  let h = '<div class="card ptsCard" style="margin-top:18px"><div class="cardHd">' + vlogoHTML(vendorObj('American Orthodontics')) + '<h3>AO Partner Dollars</h3><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-act="ptsEdit">' + ic('edit', 14) + (p ? 'Update' : 'Add') + '</button></div><div class="cardBd">';
  if (!p) return h + '<div class="muted small">AO’s points: brackets and tubes earn them, and AO pays for wires, elastics, ties and supplies with them first. Add the balance AO Direct shows, and Inventory keeps count from there.</div></div></div>';
  const old = daysAgo(p.at);
  h += '<div class="budTop"><span class="big">' + (p.orders ? '≈ ' : '') + money(p.bal, { whole: p.bal >= 1000 }) + '</span><span class="of">' + (p.exp ? 'expire ' + esc(fmtDate(p.exp)) : '') + '</span></div>';
  h += '<div class="muted small ptsSince">' + (p.orders
    ? 'AO Direct showed ' + money(p.was) + ' on ' + esc(fmtDate(p.at)) + ' · since then, ' + plural(p.orders, 'AO order') + ' received here: <b class="earn">+' + money(p.earned) + '</b> earned, <b class="use">−' + money(p.used) + '</b> spent'
    : 'As AO Direct showed it ' + esc(fmtWhen(p.at)) + (p.by ? ' (' + esc(p.by) + ')' : '')) + '</div>';
  h += '<div class="ptsHow">' + ic('info', 13) + '<span>Brackets and tubes earn them; AO takes wires, elastics, ties and supplies out of them first. AO orders count once they’re received here.</span></div>';
  if (old != null && old > PTS_STALE_DAYS) h += '<div class="hint">Last checked ' + old + ' days ago — worth updating it from AO Direct.</div>';
  return h + '</div></div>';
}
/* Dr. A types in what AO Direct shows */
ACT.ptsEdit = () => withAdmin(() => {
  const a = ptsAnchor(), p = ptsNow();
  openModal('<h3>AO Partner Dollars</h3><div class="lsub">Type what AO Direct shows: sign in at shop.americanortho.com → Home → <b>Partner detail</b>. Inventory counts from there.</div>' +
    field('Partner dollar balance', '<input id="ptsBal" type="number" inputmode="decimal" min="0" step="0.01" placeholder="' + esc(p ? p.bal.toFixed(2) : '0.00') + '" data-enter="#ptsGo">', p && p.orders ? 'Inventory’s estimate now: ' + money(p.bal) + '.' : '') +
    field('Partner dollar expiration', '<input id="ptsExp" type="date" value="' + esc(a && /^\d{4}-\d{2}-\d{2}$/.test(a.exp || '') ? a.exp : '') + '">') +
    '<div class="mFt"><a class="btn btn-ghost" href="https://shop.americanortho.com" target="_blank" rel="noopener" style="margin-right:auto">' + ic('link', 14) + 'Open AO Direct</a><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="ptsGo" data-act="ptsSave">Save</button></div>', { cls: 'mid', focus: '#ptsBal' });
}, '', 'update the AO points');
ACT.ptsSave = t => withAdmin(async () => {
  const raw = val('ptsBal').trim(), bal = round2(raw), exp = val('ptsExp');
  if (raw === '' || bal == null || bal < 0 || bal > 1000000) { toast('What does AO Direct show as the balance?', { bad: true }); return; }
  const s = stamp(); busyBtn(t, true, 'Saving…');
  const ok = await act(() => B.patchVendor(PTS_VENDOR, { pts: { bal, exp: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : '', at: s.at, by: s.by } }), 'Saved. Inventory counts from ' + money(bal) + '.');
  if (ok) closeModal(true); else busyBtn(t, false);
}, '', 'update the AO points');
