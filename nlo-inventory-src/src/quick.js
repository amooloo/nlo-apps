/* =====================================================================
   Quick order — American Orthodontics elastomerics (o-ties, power
   chain, memory chain), Wildlife elastics, and bracket kits by system
   (sets or single teeth). Each pick becomes its own cart line, with its
   AO catalog code and the remembered price (nlo/elastoPrices, shared by
   every computer), so it counts in the budget when it's received.
   ===================================================================== */
const AO = 'American Orthodontics';
function quickPseudo(id, name, sku, unit, price, note) {
  return { id, name, cat: /^bracket/.test(id) ? 'brackets-tubes' : 'elastics', unit, sources: [{ vendor: AO, sku, price: price != null ? price : 0, src: 'https://shop.americanortho.com' }], note };
}
VIEWS.quick = {
  render() {
    const u = S.ui.quick || (S.ui.quick = { tab: 'elasto', product: 'oties', format: 'uniStick', qty: {}, system: '', mode: 'sets', sets: {}, teeth: {} });
    let h = '<div class="filters"><div class="seg"><button data-act="qTab" data-t="elasto" aria-pressed="' + (u.tab === 'elasto') + '">O-ties & chain</button><button data-act="qTab" data-t="wild" aria-pressed="' + (u.tab === 'wild') + '">Wildlife elastics</button><button data-act="qTab" data-t="brackets" aria-pressed="' + (u.tab === 'brackets') + '">Brackets</button></div><span class="muted small">American Orthodontics · each pick becomes a cart line</span></div>';
    if (S.denied.elastoPrices) h += '<div class="notice">Prices for these picks can’t be saved yet (the office database doesn’t allow it). Type the price when the order is received, so it counts in the budget.</div>';
    if (u.tab === 'brackets') return h + bracketsHTML(u);
    const isWild = u.tab === 'wild';
    const product = ELASTO_PRODUCTS.find(p => p.id === (isWild ? 'wildlife' : u.product)) || ELASTO_PRODUCTS[0];
    const format = product.formats.find(f => f.key === u.format) || product.formats[0];
    const unit = isWild ? 'box' : 'pkg';
    let grid = [];
    if (isWild) grid = (WILDLIFE_ANIMALS[format.key] || []).map(a => ({ name: a.name, code: a.code, emoji: a.emoji, sub: a.size + ' · ' + a.force + ' · ' + a.pks + ' packs/box', size: a.size, force: a.force }));
    else { const map = ELASTO_CODES[format.key] || {}; grid = ELASTO_COLORS.filter(c => map[c.name]).map(c => ({ name: c.name, code: map[c.name], hex: c.hex, light: c.light })); }
    if (!isWild) h += '<div class="chips">' + ELASTO_PRODUCTS.filter(p => p.id !== 'wildlife').map(p => '<button class="chip' + (p.id === product.id ? ' on' : '') + '" data-act="qProduct" data-p="' + p.id + '">' + esc(p.label) + '</button>').join('') + '</div>';
    if (product.formats.length > 1) h += '<div class="pickRow" style="margin-bottom:14px">' + product.formats.map(f => '<button class="pick sm" data-act="qFormat" data-f="' + f.key + '" aria-pressed="' + (f.key === format.key) + '">' + esc(f.label) + ' <span class="muted" style="font-weight:500">· ' + esc(f.note) + '</span></button>').join('') + '</div>';
    if (product.id === 'memchain') h += '<div class="hint" style="margin:-6px 0 12px">Memory chain comes only in grey and clear.</div>';
    if (isWild) h += '<div class="hint" style="margin:-6px 0 12px">Each animal is one force and size. Latex — check patient allergies.</div>';
    const sel = Object.keys(u.qty).filter(k => u.qty[k] > 0), pkgs = sel.reduce((a, k) => a + u.qty[k], 0), est = sel.reduce((a, k) => a + (getElastoPrice(S.D.elastoPrices, (grid.find(g => g.name === k) || {}).code) || 0) * u.qty[k], 0);
    h += '<div class="card"><div class="cardBd" style="padding-top:16px">' + (isWild ? grid.map(g => {
      const q = u.qty[g.name] || 0, pv = getElastoPrice(S.D.elastoPrices, g.code);
      return '<div class="animal"><span class="e">' + g.emoji + '</span><div><b>' + esc(g.name) + '</b><small>' + esc(g.sub) + ' · #' + esc(g.code) + ' · <button class="linkBtn" data-act="qPrice" data-code="' + esc(g.code) + '" data-label="' + esc(g.name) + '" data-unit="box">' + (pv != null ? money(pv) + '/box' : 'set the price') + '</button></small></div>' +
        '<div class="qty"><button data-act="qBump" data-n="-1" data-k="' + esc(g.name) + '">−</button><input value="' + q + '" readonly aria-label="Boxes"><button data-act="qBump" data-n="1" data-k="' + esc(g.name) + '">+</button></div></div>';
    }).join('') : '<div class="swatches">' + grid.map(g => {
      const q = u.qty[g.name] || 0, pv = getElastoPrice(S.D.elastoPrices, g.code);
      return '<button class="sw' + (q ? ' on' : '') + '" data-act="qBump" data-n="1" data-k="' + esc(g.name) + '" title="#' + esc(g.code) + (pv != null ? ' · ' + money(pv) + '/pkg' : '') + '"><i style="background:' + g.hex + '"></i><span>' + esc(g.name) + '</span>' + (q ? '<span class="q">' + q + '</span>' : '') + '</button>';
    }).join('') + '</div>' + (sel.length ? '<div class="btnRow">' + sel.map(k => '<span class="pill">' + esc(k) + ' × ' + u.qty[k] + ' <button class="linkBtn" data-act="qBump" data-n="-1" data-k="' + esc(k) + '" aria-label="One less">−</button></span>').join('') + '</div>' : '') +
      '<div class="hint">Tap a color to add a ' + unit + '. Prices: ' + grid.filter(g => getElastoPrice(S.D.elastoPrices, g.code) != null).length + ' of ' + grid.length + ' set · <button class="linkBtn" data-act="qPriceAll">set the price for these</button></div>') + '</div>' +
      '<div class="vfoot"><span class="sum">' + (sel.length ? sel.length + ' pick' + (sel.length === 1 ? '' : 's') + ' · ' + qtyUnit(pkgs, unit) + (est ? ' · about ' + money(est) : '') : 'Nothing picked yet') + '</span><span style="flex:1"></span>' +
      (sel.length ? '<button class="btn btn-ghost" data-act="qClear">Clear</button>' : '') + '<button class="btn btn-pri" data-act="qAdd"' + (sel.length ? '' : ' disabled') + '>' + ic('cart', 16) + 'Add to cart</button></div></div>';
    return h;
  }
};
function bracketsHTML(u) {
  let h = '<div class="card"><div class="cardBd" style="padding-top:16px">' + field('Bracket system', '<select data-chg="qSystem"><option value="">Pick a system…</option>' + BRACKET_SYSTEMS.map(s => '<option' + (s === u.system ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>');
  if (!u.system) return h + '</div></div>';
  h += '<div class="seg" style="margin-bottom:14px"><button data-act="qMode" data-m="sets" aria-pressed="' + (u.mode === 'sets') + '">By sets</button><button data-act="qMode" data-m="ind" aria-pressed="' + (u.mode === 'ind') + '">Single teeth</button></div>';
  if (u.mode === 'sets') {
    const key = 'AO-BRACKET-SET|' + u.system, pv = getElastoPrice(S.D.elastoPrices, key), total = BRACKET_SET_TYPES.reduce((a, t) => a + (u.sets[t.key] || 0), 0);
    h += BRACKET_SET_TYPES.map(t => '<div class="animal" style="grid-template-columns:minmax(0,1fr) auto"><div><b>' + esc(t.label) + '</b><small>' + esc(t.desc) + '</small></div><div class="qty"><button data-act="qSet" data-k="' + t.key + '" data-n="-1">−</button><input value="' + (u.sets[t.key] || 0) + '" readonly><button data-act="qSet" data-k="' + t.key + '" data-n="1">+</button></div></div>').join('') +
      '<div class="hint"><button class="linkBtn" data-act="qPrice" data-code="' + esc(key) + '" data-label="a set of ' + esc(u.system) + '" data-unit="set">' + (pv != null ? 'Price ' + money(pv) + ' a set · change' : 'Set the price per set (so these count in the budget)') + '</button></div></div>' +
      '<div class="vfoot"><span class="sum">' + (total ? qtyUnit(total, 'set') + (pv ? ' · about ' + money(pv * total) : '') : 'Nothing picked yet') + '</span><span style="flex:1"></span><button class="btn btn-pri" data-act="qAddSets"' + (total ? '' : ' disabled') + '>' + ic('cart', 16) + 'Add to cart</button></div></div>';
  } else {
    const key = 'AO-BRACKET-IND|' + u.system, pv = getElastoPrice(S.D.elastoPrices, key), total = Object.values(u.teeth).reduce((a, b) => a + b, 0);
    h += '<div class="teeth">' + BRACKET_QUADS.map(q => '<div class="quad"><h5>' + esc(q.label) + '</h5><div class="tg">' + [1, 2, 3, 4, 5, 6, 7].map(n => '<label>' + n + '<input type="number" min="0" inputmode="numeric" value="' + (u.teeth[q.prefix + n] || '') + '" placeholder="0" data-chg="qTooth" data-k="' + q.prefix + n + '" aria-label="' + esc(q.label + ' ' + n) + '"></label>').join('') + '</div></div>').join('') + '</div>' +
      '<div class="hint"><button class="linkBtn" data-act="qPrice" data-code="' + esc(key) + '" data-label="one ' + esc(u.system) + ' bracket" data-unit="bracket">' + (pv != null ? 'Price ' + money(pv) + ' a bracket · change' : 'Set the price per bracket (so these count in the budget)') + '</button></div></div>' +
      '<div class="vfoot"><span class="sum">' + (total ? qtyUnit(total, 'bracket') + (pv ? ' · about ' + money(pv * total) : '') : 'Nothing picked yet') + '</span><span style="flex:1"></span><button class="btn btn-pri" data-act="qAddTeeth"' + (total ? '' : ' disabled') + '>' + ic('cart', 16) + 'Add to cart</button></div></div>';
  }
  return h;
}
ACT.qTab = t => { const u = S.ui.quick; u.tab = t.dataset.t; u.qty = {}; if (u.tab === 'wild') u.format = 'wlAll'; else if (u.tab === 'elasto') { u.product = 'oties'; u.format = 'uniStick'; } renderView(true); };
ACT.qProduct = t => { const u = S.ui.quick, p = ELASTO_PRODUCTS.find(x => x.id === t.dataset.p); u.product = p.id; u.format = p.formats[0].key; u.qty = {}; renderView(true); };
ACT.qFormat = t => { S.ui.quick.format = t.dataset.f; S.ui.quick.qty = {}; renderView(true); };
ACT.qBump = t => { const u = S.ui.quick, k = t.dataset.k; u.qty[k] = Math.max(0, (u.qty[k] || 0) + Number(t.dataset.n)); if (!u.qty[k]) delete u.qty[k]; renderView(true); };
ACT.qClear = () => { S.ui.quick.qty = {}; renderView(true); };
ACT.qPrice = async t => {
  if (S.denied.elastoPrices) return toast('Prices for these picks can’t be saved yet — type the price when the order is received.', { bad: true });
  const cur = getElastoPrice(S.D.elastoPrices, t.dataset.code);
  const v = await confirmBox('Price for ' + t.dataset.label, 'Saved for every computer; used for the cart’s estimate.', 'Save', false, { input: 'Price per ' + t.dataset.unit, number: true, value: cur != null ? String(cur) : '' }); if (v === false) return;
  const p = parseFloat(v); if (!isFinite(p) || p < 0) return toast('That isn’t a price.', { bad: true });
  act(() => B.setElastoPrice(t.dataset.code, p), 'Price saved for every computer.');
};
ACT.qPriceAll = async () => {
  if (S.denied.elastoPrices) return toast('Prices for these picks can’t be saved yet — type the price when the order is received.', { bad: true });
  const u = S.ui.quick, product = ELASTO_PRODUCTS.find(p => p.id === u.product) || ELASTO_PRODUCTS[0], format = product.formats.find(f => f.key === u.format) || product.formats[0], map = ELASTO_CODES[format.key] || {};
  const v = await confirmBox('One price for every color', product.label.replace(/\s*\(.*\)$/, '') + ' · ' + format.label + ' — saved for every computer.', 'Save', false, { input: 'Price per package', number: true }); if (v === false) return;
  const p = parseFloat(v); if (!isFinite(p) || p < 0) return toast('That isn’t a price.', { bad: true });
  act(() => Promise.all(Object.values(map).map(code => B.setElastoPrice(code, p))), 'Saved ' + money(p) + ' for ' + Object.keys(map).length + ' colors.');
};
ACT.qAdd = t => {
  const u = S.ui.quick, isWild = u.tab === 'wild', product = ELASTO_PRODUCTS.find(p => p.id === (isWild ? 'wildlife' : u.product)), format = product.formats.find(f => f.key === u.format) || product.formats[0];
  const picks = Object.keys(u.qty).filter(k => u.qty[k] > 0); if (!picks.length) return;
  withWho(async () => {
    busyBtn(t, true, 'Adding…');
    const ok = await act(async () => {
      for (const name of picks) {
        let code, lineName;
        if (isWild) { const a = (WILDLIFE_ANIMALS[format.key] || []).find(x => x.name === name) || {}; code = a.code; lineName = 'Wildlife Elastics — ' + name + ' (' + (a.size || '') + ', ' + (a.force || '') + ')'; }
        else { code = (ELASTO_CODES[format.key] || {})[name]; lineName = product.label.replace(/\s*\(.*\)$/, '') + ' ' + format.label + ' — ' + name; }
        const pseudo = quickPseudo('elasto-' + format.key + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uid(), lineName, code, isWild ? 'box' : 'pkg', getElastoPrice(S.D.elastoPrices, code));
        await cartAdd(pseudo, u.qty[name], { pseudo: true });
      }
    });
    if (ok) { u.qty = {}; toast(picks.length + ' line' + (picks.length === 1 ? '' : 's') + ' added to the cart.' + okNote(picks.length), { action: 'Open cart', onAction: () => go('cart') }); renderView(true); } else busyBtn(t, false);
  }, 'Who’s adding these to the cart?');
};
CHG.qSystem = t => { const u = S.ui.quick; u.system = t.value; u.sets = {}; u.teeth = {}; renderView(true); };
ACT.qMode = t => { S.ui.quick.mode = t.dataset.m; renderView(true); };
ACT.qSet = t => { const u = S.ui.quick; u.sets[t.dataset.k] = Math.max(0, (u.sets[t.dataset.k] || 0) + Number(t.dataset.n)); renderView(true); };
CHG.qTooth = t => { const u = S.ui.quick, n = Math.max(0, Math.round(num(t.value))); if (n) u.teeth[t.dataset.k] = n; else delete u.teeth[t.dataset.k]; renderView(true); };
ACT.qAddSets = t => {
  const u = S.ui.quick, total = BRACKET_SET_TYPES.reduce((a, s) => a + (u.sets[s.key] || 0), 0); if (!total) return;
  const note = BRACKET_SET_TYPES.filter(s => u.sets[s.key]).map(s => u.sets[s.key] + '× ' + s.label.replace(/ sets$/, ' set' + (u.sets[s.key] > 1 ? 's' : ''))).join(', ');
  const pseudo = quickPseudo('bracket-set-' + u.system.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + uid(), u.system, 'AO-BRACKET-SET', 'set', getElastoPrice(S.D.elastoPrices, 'AO-BRACKET-SET|' + u.system), note);
  withWho(async () => { busyBtn(t, true, 'Adding…'); if (await act(() => cartAdd(pseudo, total, { pseudo: true, note }))) { u.sets = {}; toast('Added ' + qtyUnit(total, 'set') + ' to the cart.' + okNote(1), { action: 'Open cart', onAction: () => go('cart') }); renderView(true); } else busyBtn(t, false); }, 'Who’s adding these to the cart?');
};
ACT.qAddTeeth = t => {
  const u = S.ui.quick, total = Object.values(u.teeth).reduce((a, b) => a + b, 0); if (!total) return;
  const note = 'Teeth: ' + Object.keys(u.teeth).map(k => k + ':' + u.teeth[k]).join(', ');
  const pseudo = quickPseudo('bracket-ind-' + u.system.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() + '-' + uid(), u.system + ' (single teeth)', 'AO-BRACKET-IND', 'bracket', getElastoPrice(S.D.elastoPrices, 'AO-BRACKET-IND|' + u.system), note);
  withWho(async () => { busyBtn(t, true, 'Adding…'); if (await act(() => cartAdd(pseudo, total, { pseudo: true, note }))) { u.teeth = {}; toast('Added ' + qtyUnit(total, 'bracket') + ' to the cart.' + okNote(1), { action: 'Open cart', onAction: () => go('cart') }); renderView(true); } else busyBtn(t, false); }, 'Who’s adding these to the cart?');
};
