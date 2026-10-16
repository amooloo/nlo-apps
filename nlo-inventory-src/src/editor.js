/* =====================================================================
   A supply: add a new one, or change one (Edit in its drawer).
   - What it is: name, category and group, maker and maker's part #,
     search words, where it's kept, notes, expiry, photo.
   - Counting and buying: what's counted on the shelf (box), and — when
     it's bought bigger — what it's bought in and how many each holds
     (gloves: counted in boxes, bought by the case of 10). Prices are
     typed per what's bought (the case) and kept per what's counted (the
     box), the way every price has always been kept.
   - Where it's bought: one row per vendor; the first row is the usual
     one ("Make usual" moves a row up).
   - Pieces in a box (100 gloves) only show a price per piece.
   Saving changes only these fields (never the count, which has its own
   steps), stamped with who and when. A copy ("Make a copy") is saved
   only when its own Save is pressed. Archive and Delete are for Dr. A
   and the people he picks.
   Also here: the stock steps (count, add by hand, used some) and the AI
   label reader and photo clean-up.
   ===================================================================== */
const COUNT_UNITS = ['box', 'pack', 'pkg', 'bag', 'bottle', 'canister', 'carton', 'case', 'container', 'each', 'gallon', 'jug', 'kit', 'pouch', 'roll', 'set', 'sheet', 'strip', 'syringe', 'tube'];
const BUY_UNITS = ['case', 'box', 'carton', 'pack', 'bag', 'bundle', 'roll'];
/* the old app's piece names (what's inside one counted unit) */
const BASE_UNITS = ['Application', 'Bag', 'Bib', 'Bottle', 'Bracket', 'Burr', 'Cartridge', 'cc', 'cm', 'Container', 'Count', 'Cup', 'Disc', 'Each', 'fl oz', 'ft', 'Gallon', 'Glove', 'Gram', 'Inch', 'kg', 'lb', 'Liter', 'Mask', 'mL', 'mm', 'Oz', 'Pair', 'Pieces', 'Pouch', 'Roll', 'Sheet', 'Sleeve', 'Spool', 'Square', 'Stick', 'Strip', 'Syringe', 'Tablet', 'Tip', 'Tube', 'Unit', 'Wire'];
const ORDER_UNITS = ['Bag', 'Bottle', 'Box', 'Canister', 'Carton', 'Case', 'Container', 'Each', 'Gallon', 'Jug', 'Pack', 'Pkg', 'Roll', 'Set', 'Syringe', 'Tube'];
function _canonical(value, list) {
  if (!value) return '';
  const v = String(value).trim().toLowerCase();
  for (const opt of list) { if (opt.toLowerCase() === v) return opt; }
  for (const opt of list) { if (opt.toLowerCase().startsWith(v) || v.startsWith(opt.toLowerCase())) return opt; }
  return '';
}
/* photos: a small one for lists (and the drawer) and a big one, both WebP */
const IMG_THUMB_MAX = 400, IMG_FULL_MAX = 1600, IMG_QUALITY = 0.85;
function resizeToWebp(srcDataUrl, maxDim, quality) {
  return new Promise(resolve => {
    if (!srcDataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1), w = Math.max(1, Math.round(img.width * ratio)), h = Math.max(1, Math.round(img.height * ratio));
        const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h; cvs.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cvs.toDataURL('image/webp', quality));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = srcDataUrl;
  });
}
function makeThumbAndFull(src) { return Promise.all([resizeToWebp(src, IMG_THUMB_MAX, IMG_QUALITY), resizeToWebp(src, IMG_FULL_MAX, IMG_QUALITY)]).then(p => ({ thumb: p[0], full: p[1] })); }
function readFileAsDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('That file couldn’t be read.')); r.readAsDataURL(file); }); }
/* a file picker that resolves with the chosen file (or null) */
function pickFile(accept) {
  return new Promise(res => {
    const old = $('#pickFileInp'); if (old) old.remove();
    const i = document.createElement('input'); i.type = 'file'; i.id = 'pickFileInp'; i.accept = accept || 'image/*'; i.style.display = 'none';
    i.onchange = () => { const f = i.files && i.files[0]; i.remove(); res(f || null); };
    document.body.appendChild(i); i.click();
  });
}
function tagsOf(s) { const out = []; String(s || '').split(/[,\n]/).map(t => t.trim()).filter(Boolean).forEach(t => { if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t); }); return out; }

/* ---------- the editor ---------- */
ACT.itemNew = () => openEditor(null, S.q && S.view === 'supplies' ? { name: S.q } : null);
ACT.itemEdit = t => { const it = itemById(t.dataset.id); if (it) openEditor(it.id); };
function openEditor(id, prefill) {
  const it = id ? itemById(id) : null;
  const base = it || Object.assign({ cat: (S.ui.sup && S.ui.sup.cat) || 'misc', unit: 'box' }, prefill || {});
  const per = it ? perBuy(it) : (base.buyUnit && Number(base.perBuy) > 1 ? Math.round(Number(base.perBuy)) : 1);
  const srcs = (it ? allSources(it) : listOf(base.sources)).filter(s => s && (s.vendor || s.sku || countPrice(s) != null))
    .map(s => ({ vendor: s.vendor || '', sku: s.sku || '', price: countPrice(s) != null ? (countPrice(s) * per).toFixed(2) : '', src: s.src || '', lastDate: s.lastDate || '' }));
  S.ui.ed = {
    id: it ? it.id : null, copyOf: (prefill && prefill.copyOf) || null,
    f: {
      name: base.name || '', cat: base.cat || 'misc', group: base.group || '', manufacturer: base.manufacturer || '', sku: base.sku || '', tags: listOf(base.tags).join(', '), location: base.location || '', note: base.note || '', exp: base.exp || '',
      unit: countUnit(base), big: per > 1, buyUnit: per > 1 ? (base.buyUnit || 'case') : 'case', perBuy: per > 1 ? String(per) : '10',
      pieces: Number(base.baseUnitsPerOrderUnit) > 1 ? String(base.baseUnitsPerOrderUnit) : '', piece: base.baseUnitName && base.baseUnitName !== 'Unit' ? base.baseUnitName : '',
      min: base.min != null && base.min !== '' ? String(base.min) : '', qty: it ? '' : (base.qty != null && base.qty !== '' ? String(base.qty) : '')
    },
    sources: srcs.length ? srcs : [{ vendor: '', sku: '', price: '', src: '', lastDate: '' }],
    photo: { img: base.img || null, imgFull: base.imgFull || null, thumb: null, full: null, changed: false, ai: false },
    dirty: !!(prefill && prefill.copyOf), busy: '', ai: null
  };
  if (prefill && prefill.photo) Object.assign(S.ui.ed.photo, prefill.photo);
  renderEditor();
  aiKeys().then(k => { if (!S.ui.ed) return; S.ui.ed.ai = k; const r = $('#edAiRow'); if (r) r.outerHTML = edAiRowHTML(); const p = $('#edPhotoRow'); if (p) { p.outerHTML = edPhotoHTML(); hydrateImages($('#modalWrap')); } }).catch(() => { });
}
function edAiRowHTML() {
  const E = S.ui.ed, k = E && E.ai, can = !!(k && (k.gemini || k.proxy));
  return '<div id="edAiRow">' + (can ? '<div class="aiFill">' + ic('spark', 18) + '<div class="grow"><b>Read a label</b><span>Take a photo of the box or label and the AI fills in what it can.</span></div><button class="btn btn-sec btn-sm" data-act="edLabel"' + (E.busy ? ' disabled' : '') + '>' + (E.busy === 'label' ? 'Reading…' : ic('camera', 15) + 'Scan the label') + '</button></div>' : '') + '</div>';
}
function edPhotoHTML() {
  const E = S.ui.ed, P = E.photo, src = P.thumb || P.img, k = E.ai, canAi = !!(k && resolveOpenAIKey(k.openai, ''));
  return '<div id="edPhotoRow" class="photoEd">' + (src ? '<img alt="" data-src="' + esc(src) + '">' : '<span class="ph">' + ic('camera', 22) + '</span>') +
    '<div class="grow"><b>Photo</b><span>' + (src ? (P.ai ? 'Cleaned up by AI — saved with the supply' : P.changed ? 'New photo — saved with the supply' : 'Shown in the list and on labels') : 'A photo helps people find the right box.') + '</span>' +
    '<div class="btnRow" style="margin-top:6px"><button class="btn btn-sec btn-sm" data-act="edPhoto">' + ic('upload', 14) + (src ? 'Change' : 'Add a photo') + '</button>' + (src ? '<button class="btn btn-ghost btn-sm" data-act="edPhotoOff">Remove</button>' : '') +
    (src && canAi && !P.ai ? '<button class="btn btn-ghost btn-sm" data-act="edPhotoAi"' + (E.busy ? ' disabled' : '') + '>' + ic('spark', 14) + (E.busy === 'photo' ? 'Working… (up to a minute)' : 'Clean it up with AI') + '</button>' : '') + '</div></div></div>';
}
function renderEditor() {
  const E = S.ui.ed, F = E.f, it = E.id ? itemById(E.id) : null;
  const cat = CATEGORIES.find(c => c.id === F.cat) || CATEGORIES[CATEGORIES.length - 1];
  const groups = Array.from(new Set((cat.subs || []).concat(items().filter(i => i.cat === F.cat && i.group).map(i => i.group)))).sort((a, b) => a.localeCompare(b));
  const mfrs = Array.from(new Set(items().map(i => i.manufacturer).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const tagsAll = Array.from(new Set([].concat(...items().map(i => listOf(i.tags))).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  const vnames = Array.from(new Set(S.D.vendors.map(v => v.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const locs = listOf(S.settings.locations);
  const priceUnit = F.big ? (F.buyUnit || 'case') : (F.unit || 'unit'), per = F.big ? Math.max(2, Math.round(num(F.perBuy) || 0)) : 1;
  const dl = (id, list) => '<datalist id="' + id + '">' + list.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist>';
  let h = '<h3>' + (E.id ? 'Edit supply' : E.copyOf ? 'New supply (a copy)' : 'New supply') + '</h3><div class="lsub">' + (E.id ? esc(it ? it.name : '') + ' · changes are saved with your name and the time' : 'It shows up for everyone as soon as it’s saved.') + '</div>' + edAiRowHTML();
  /* what it is */
  h += '<div class="edSec"><h5>What it is</h5>' + field('Name', '<input id="edName" value="' + esc(F.name) + '" placeholder="e.g. Gloves Pulse Nitrile — SM" autocomplete="off">') +
    '<div class="grid2">' + field('Category', '<select id="edCat" data-chg="edCat">' + CATEGORIES.map(c => '<option value="' + c.id + '"' + (c.id === F.cat ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('') + '</select>') +
    field('Group', '<input id="edGroup" list="edGroups" value="' + esc(F.group) + '" placeholder="' + esc(groups[0] ? 'e.g. ' + groups[0] : 'optional') + '">' + dl('edGroups', groups)) + '</div>' +
    '<div class="grid2">' + field('Made by', '<input id="edMfr" list="edMfrs" value="' + esc(F.manufacturer) + '" placeholder="e.g. 3M, Ormco (optional)">' + dl('edMfrs', mfrs)) +
    field('Maker’s part #', '<input id="edSku" value="' + esc(F.sku) + '" placeholder="optional" autocomplete="off">') + '</div>' +
    '<div class="grid2">' + field('Kept in', '<select id="edLoc"><option value="">—</option>' + locs.map(l => '<option' + (l === F.location ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + (F.location && !locs.includes(F.location) ? '<option selected value="' + esc(F.location) + '">' + esc(F.location) + ' (not on the list)</option>' : '') + '</select>', locs.length ? '' : 'Storage places are added under Settings.') +
    field('Expires', '<input id="edExp" type="date" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(F.exp) ? F.exp : '') + '">', F.exp && !/^\d{4}-\d{2}-\d{2}$/.test(F.exp) ? 'Saved as “' + esc(F.exp) + '”' : '') + '</div>' +
    field('Search words', '<input id="edTags" list="edTagList" value="' + esc(F.tags) + '" placeholder="e.g. hve, suction, chairside (commas between)">' + dl('edTagList', tagsAll)) +
    field('Notes', '<textarea id="edNote" rows="2" placeholder="Shade, size, which patients, how to order…">' + esc(F.note) + '</textarea>') + edPhotoHTML() + '</div>';
  /* counting and buying */
  h += '<div class="edSec"><h5>Counting and buying</h5><div class="grid3">' +
    field('Counted on the shelf in', '<input id="edUnit" list="edUnits" value="' + esc(F.unit) + '" data-inp="edUnitInp" autocomplete="off">' + dl('edUnits', COUNT_UNITS)) +
    field('Reorder below', '<input id="edMin" type="number" inputmode="numeric" min="0" step="1" value="' + esc(F.min) + '" placeholder="0">', 'in ' + esc(unitWord(F.unit || 'unit', 2))) +
    (E.id ? '<div class="field"><label>On hand</label><div class="stockNow"><b>' + esc(qtyFmt((it && it.qty) || 0)) + '</b> ' + esc(unitWord(F.unit || 'unit', it && it.qty)) + ' · <button class="linkBtn" data-act="stockOpen" data-id="' + esc(E.id) + '">count it</button></div></div>' :
      field('On hand now', '<input id="edQty" type="number" inputmode="decimal" min="0" step="any" value="' + esc(F.qty) + '" placeholder="0">', 'in ' + esc(unitWord(F.unit || 'unit', 2)))) + '</div>' +
    '<label class="chk" style="margin:4px 0 8px"><input type="checkbox" id="edBig" data-chg="edBig"' + (F.big ? ' checked' : '') + '> We buy it by a bigger package (like a case of boxes)</label>' +
    (F.big ? '<div class="bigRow">Bought by the <input id="edBuyU" list="edBuyUnits" value="' + esc(F.buyUnit) + '" data-inp="edUnitInp" class="sm" aria-label="Package">' + dl('edBuyUnits', BUY_UNITS) + ' of <input id="edPer" type="number" inputmode="numeric" min="2" step="1" value="' + esc(F.perBuy) + '" data-inp="edUnitInp" class="xs" aria-label="How many in one"> <span id="edPerU">' + esc(unitWord(F.unit || 'unit', 2)) + '</span></div>' +
      '<div class="hint" id="edBigHint">The cart and orders go by the ' + esc(F.buyUnit || 'case') + '; receiving 1 ' + esc(F.buyUnit || 'case') + ' adds ' + per + ' ' + esc(unitWord(F.unit || 'unit', per)) + ' to the count.</div>' : '') +
    '<div class="grid2" style="margin-top:8px">' + field('Pieces in one ' + (F.unit || 'unit') + ' (optional)', '<div class="inRow"><input id="edPcs" type="number" inputmode="decimal" min="0" step="any" value="' + esc(F.pieces) + '" placeholder="e.g. 100" class="xs" aria-label="How many pieces"><input id="edPc" list="edPieces" value="' + esc(F.piece) + '" placeholder="gloves" aria-label="Piece">' + dl('edPieces', BASE_UNITS) + '</div>', 'Only for the price per piece; it never changes a count.') + '</div></div>';
  /* where it's bought */
  h += '<div class="edSec"><h5>Where it’s bought</h5><div class="hint" style="margin:-4px 0 10px">The first one is the usual vendor. Prices are per <b id="edPu">' + esc(priceUnit) + '</b>.</div>' +
    E.sources.map((s, k) => {
      const p = num(s.price), each = F.big && p > 0 ? '= ' + money(p / per) + ' a ' + esc(F.unit || 'unit') : '';
      return '<div class="srcEd"><div class="srcTop">' + (k === 0 ? '<span class="pill usual">Usual vendor</span>' : '<button class="linkBtn" data-act="edSrcTop" data-k="' + k + '">Make this the usual vendor</button>') + '<span style="flex:1"></span>' +
        (E.sources.length > 1 ? '<button class="iconBtn" data-act="edSrcDel" data-k="' + k + '" aria-label="Remove this vendor">' + ic('trash', 15) + '</button>' : '') + '</div>' +
        '<div class="grid4">' + field('Vendor', '<input data-ed="vendor" data-k="' + k + '" list="edVendors" value="' + esc(s.vendor) + '" placeholder="Pick or type">') + field('Their SKU', '<input data-ed="sku" data-k="' + k + '" value="' + esc(s.sku) + '" autocomplete="off">') +
        field('Price per ' + priceUnit, '<input data-ed="price" data-k="' + k + '" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(s.price) + '" data-inp="edPriceInp">', '<span id="edEach' + k + '">' + each + '</span>') +
        field('Product link', '<input data-ed="src" data-k="' + k + '" value="' + esc(s.src) + '" placeholder="https:// (optional)">') + '</div></div>';
    }).join('') + dl('edVendors', vnames) +
    '<button class="btn btn-ghost btn-sm" data-act="edSrcAdd">' + ic('plus', 14) + 'Another vendor</button></div>';
  h += '<div class="mFt">' + (E.id ? '<button class="btn btn-ghost" data-act="edCopy" style="margin-right:auto">' + ic('copy', 15) + 'Make a copy</button>' : '<span style="margin-right:auto"></span>') +
    '<button class="btn btn-sec" data-act="edClose">Cancel</button><button class="btn btn-pri" data-act="edSave"' + (E.busy ? ' disabled' : '') + '>' + (E.id ? 'Save changes' : 'Add the supply') + '</button></div>';
  const keep = $('#modalWrap .modal.edModal'), y = keep ? keep.scrollTop : 0, wy = $('#modalWrap') ? $('#modalWrap').scrollTop : 0;
  const w = openModal(h, { cls: 'wide edModal', noFocus: !!E.id || !!keep, focus: '#edName', confirmClose: E.dirty ? 'Close without saving your changes?' : null });
  const m = $('.modal', w); if (m && y) m.scrollTop = y; if (wy) w.scrollTop = wy;
  w.addEventListener('input', () => { if (!S.ui.ed) return; S.ui.ed.dirty = true; if (S.modal) S.modal.confirmClose = 'Close without saving your changes?'; });
  w.addEventListener('change', () => { if (!S.ui.ed) return; S.ui.ed.dirty = true; if (S.modal) S.modal.confirmClose = 'Close without saving your changes?'; });
}
/* everything typed so far goes back into the editor's state (before it's drawn again) */
function edKeep() {
  const E = S.ui.ed; if (!E || !$('#edName')) return; const F = E.f;
  F.name = val('edName'); F.cat = val('edCat') || F.cat; F.group = val('edGroup'); F.manufacturer = val('edMfr'); F.sku = val('edSku'); F.location = val('edLoc');
  F.exp = val('edExp') || (F.exp && !/^\d{4}-\d{2}-\d{2}$/.test(F.exp) && $('#edExp') && !$('#edExp').dataset.cleared ? F.exp : '');
  F.tags = val('edTags'); F.note = val('edNote'); F.unit = val('edUnit').trim(); F.min = val('edMin'); if ($('#edQty')) F.qty = val('edQty');
  F.big = !!($('#edBig') && $('#edBig').checked); if ($('#edBuyU')) F.buyUnit = val('edBuyU').trim(); if ($('#edPer')) F.perBuy = val('edPer'); F.pieces = val('edPcs'); F.piece = val('edPc').trim();
  $$('[data-ed]').forEach(i => { const s = E.sources[Number(i.dataset.k)]; if (s) s[i.dataset.ed] = i.value; });
}
CHG.edCat = () => { edKeep(); S.ui.ed.dirty = true; renderEditor(); };
CHG.edBig = () => {
  const E = S.ui.ed, was = E.f.big; edKeep(); E.dirty = true;
  /* the typed prices follow the unit they're typed in: per box <-> per case */
  const per = Math.max(2, Math.round(num(E.f.perBuy) || 10));
  E.sources.forEach(s => { const p = num(s.price); if (p > 0) s.price = (E.f.big && !was ? p * per : !E.f.big && was ? p / per : p).toFixed(2); });
  renderEditor();
};
INP.edUnitInp = () => {
  const u = val('edUnit').trim() || 'unit', b = $('#edBuyU') ? val('edBuyU').trim() || 'case' : '', per = Math.max(2, Math.round(num(val('edPer')) || 0));
  const pu = $('#edPerU'); if (pu) pu.textContent = unitWord(u, 2);
  const hint = $('#edBigHint'); if (hint && b) hint.textContent = 'The cart and orders go by the ' + b + '; receiving 1 ' + b + ' adds ' + per + ' ' + unitWord(u, per) + ' to the count.';
  const p = $('#edPu'); if (p) p.textContent = b || u;
  INP.edPriceInp();
};
INP.edPriceInp = () => {
  const big = !!($('#edBig') && $('#edBig').checked), per = big ? Math.max(2, Math.round(num(val('edPer')) || 0)) : 1, u = val('edUnit').trim() || 'unit';
  $$('[data-ed="price"]').forEach(i => { const e = $('#edEach' + i.dataset.k); if (e) { const p = num(i.value); e.textContent = big && p > 0 ? '= ' + money(p / per) + ' a ' + u : ''; } });
};
ACT.edSrcAdd = () => { edKeep(); S.ui.ed.sources.push({ vendor: '', sku: '', price: '', src: '', lastDate: '' }); S.ui.ed.dirty = true; renderEditor(); };
ACT.edSrcDel = t => { edKeep(); S.ui.ed.sources.splice(Number(t.dataset.k), 1); S.ui.ed.dirty = true; renderEditor(); };
ACT.edSrcTop = t => { edKeep(); const E = S.ui.ed, k = Number(t.dataset.k), s = E.sources.splice(k, 1)[0]; E.sources.unshift(s); E.dirty = true; renderEditor(); };
ACT.edClose = () => closeModal();
/* a copy for another size or color: nothing is saved until its own Save */
ACT.edCopy = () => {
  edKeep(); const E = S.ui.ed, F = E.f, per = F.big ? Math.max(2, Math.round(num(F.perBuy) || 10)) : 1;
  const pre = { copyOf: E.id, name: '', cat: F.cat, group: F.group, manufacturer: F.manufacturer, sku: '', tags: tagsOf(F.tags), location: F.location, note: F.note, exp: F.exp, unit: F.unit, min: F.min,
    buyUnit: F.big ? F.buyUnit : null, perBuy: F.big ? per : null, baseUnitsPerOrderUnit: num(F.pieces) || null, baseUnitName: F.piece || null,
    sources: E.sources.map(s => ({ vendor: s.vendor, sku: '', price: num(s.price) > 0 ? num(s.price) / per : null, src: s.src })),
    img: E.photo.img, imgFull: E.photo.imgFull, photo: E.photo.changed ? { thumb: E.photo.thumb, full: E.photo.full, changed: true } : null };
  closeModal(true); openEditor(null, pre); toast('A copy — give it its own name, then save it.');
};
/* the photo */
ACT.edPhoto = async () => {
  const E = S.ui.ed, f = await pickFile('image/*'); if (!f || S.ui.ed !== E) return;
  try {
    const d = await readFileAsDataUrl(f), r = await makeThumbAndFull(d);
    if (!r.thumb) return toast('That picture couldn’t be used. Try a JPG or PNG.', { bad: true });
    edKeep(); Object.assign(E.photo, { thumb: r.thumb, full: r.full || r.thumb, changed: true, ai: false }); E.dirty = true; renderEditor();
  } catch (e) { toast(errText(e), { bad: true }); }
};
ACT.edPhotoOff = () => { edKeep(); Object.assign(S.ui.ed.photo, { img: null, imgFull: null, thumb: null, full: null, changed: true, ai: false }); S.ui.ed.dirty = true; renderEditor(); };
ACT.edPhotoAi = async () => {
  const E = S.ui.ed, key = resolveOpenAIKey(E.ai && E.ai.openai, ''); if (!key) return toast('The photo clean-up needs the OpenAI key (Settings → AI).', { bad: true });
  edKeep();
  let src = E.photo.full || E.photo.thumb || E.photo.imgFull || E.photo.img;
  E.busy = 'photo'; renderEditor();
  try {
    if (src && !/^data:/.test(src)) src = await urlToDataUrl(src);
    const out = await aiGenerateProductPhoto(src, E.f.name || 'dental supply product', key);
    if (!out || !/^data:image\//.test(out)) throw new Error('The AI didn’t send a picture back. Try again.');
    const r = await makeThumbAndFull(out);
    Object.assign(E.photo, { thumb: r.thumb || out, full: r.full || out, changed: true, ai: true }); E.dirty = true;
  } catch (e) { toast('Photo clean-up: ' + errText(e), { bad: true }); }
  E.busy = ''; if (S.ui.ed === E && $('#edName')) renderEditor();
};
/* a saved photo (Cloud Storage, or one just picked) as a data URL, for the AI */
async function urlToDataUrl(u) {
  if (/^blob:/.test(u) || /^https:\/\/firebasestorage\.googleapis\.com\//.test(u)) {
    const r = await fetch(u); if (!r.ok) throw new Error('The saved photo couldn’t be loaded.');
    const b = await r.blob(); return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('The saved photo couldn’t be read.')); fr.readAsDataURL(b); });
  }
  throw new Error('That photo can’t be sent to the AI. Add the photo again first.');
}
/* the AI label reader: fills in what it can read (the brand goes under "Made by", never as the vendor) */
ACT.edLabel = async () => {
  const E = S.ui.ed, k = E.ai || {}; if (!k.gemini && !k.proxy) return;
  const f = await pickFile('image/*'); if (!f || S.ui.ed !== E) return;
  edKeep(); E.busy = 'label'; renderEditor();
  try {
    const d = await readFileAsDataUrl(f), r = await aiReadProductLabel(d, k.gemini, k.proxy), F = E.f, got = [];
    const s = v => (v == null ? '' : String(v).trim());
    if (s(r.name)) { F.name = s(r.name); got.push('name'); }
    if (s(r.sku)) { F.sku = s(r.sku); got.push('part #'); }
    if (s(r.vendor)) { F.manufacturer = s(r.vendor); got.push('maker'); }
    const pk = _canonical(s(r.packaging), ORDER_UNITS); if (pk && pk.toLowerCase() !== 'case') { F.unit = pk.toLowerCase(); got.push('unit'); }
    const pc = _canonical(s(r.unit), BASE_UNITS); if (pc && pc.toLowerCase() !== F.unit) F.piece = pc;
    if (Number(r.unitsPerPkg) > 1) { F.pieces = String(Number(r.unitsPerPkg)); got.push('pieces'); }
    if (Number(r.pkgsPerCase) > 1 && !F.big) { F.big = true; F.buyUnit = 'case'; F.perBuy = String(Math.round(Number(r.pkgsPerCase))); E.sources.forEach(x => { const p = num(x.price); if (p > 0) x.price = String(round2(p * Number(F.perBuy))); }); got.push('case size'); }
    if (s(r.note)) { F.note = F.note ? F.note + (F.note.includes(s(r.note)) ? '' : ' · ' + s(r.note)) : s(r.note); got.push('notes'); }
    /* the label's photo is a fine first photo */
    if (!E.photo.thumb && !E.photo.img) { const ph = await makeThumbAndFull(d); if (ph.thumb) Object.assign(E.photo, { thumb: ph.thumb, full: ph.full || ph.thumb, changed: true }); }
    E.dirty = true; toast(got.length ? 'Filled in: ' + got.join(', ') + '. Check it before saving.' : 'The AI couldn’t read much from that photo.', got.length ? {} : { bad: true });
  } catch (e) { toast('Label: ' + errText(e), { bad: true }); }
  E.busy = ''; if (S.ui.ed === E && $('#edName')) renderEditor();
};
/* save */
ACT.edSave = t => {
  edKeep(); const E = S.ui.ed, F = E.f;
  const name = F.name.trim(); if (!name) { toast('The supply needs a name.', { bad: true }); const n = $('#edName'); if (n) n.focus(); return; }
  const unit = (F.unit || 'unit').trim().toLowerCase(), big = F.big && Math.round(num(F.perBuy)) > 1, per = big ? Math.round(num(F.perBuy)) : 1;
  if (F.big && !big) return toast('How many ' + unitWord(unit, 2) + ' are in one ' + (F.buyUnit || 'case') + '?', { bad: true });
  const buyU = big ? (F.buyUnit || 'case').trim().toLowerCase() : null;
  if (big && buyU === unit) return toast('The bigger package needs its own name (like “case”).', { bad: true });
  const minRaw = String(F.min).trim(), min = minRaw === '' ? 0 : Math.max(0, Math.round(num(minRaw)));
  const old = E.id ? itemById(E.id) : null, oldSrcs = old ? allSources(old) : [];
  const sources = E.sources.filter(s => String(s.vendor).trim() || String(s.sku).trim() || num(s.price) > 0).map(s => {
    const p = num(s.price), prev = oldSrcs.find(o => o && o.vendor && o.vendor === s.vendor.trim());
    const out = { vendor: s.vendor.trim() || null, sku: s.sku.trim(), price: p > 0 ? Math.round(p / per * 10000) / 10000 : null, src: s.src.trim(), lastDate: s.lastDate || (prev && prev.lastDate) || '' };
    if (out.src && !/^https?:\/\//i.test(out.src)) out.src = 'https://' + out.src;
    return out;
  });
  if (sources.some(s => !s.vendor)) return toast('Each SKU or price needs a vendor (or clear that row).', { bad: true });
  const pieces = num(F.pieces);
  const rec = {
    name, cat: F.cat || 'misc', group: F.group.trim() || null, manufacturer: F.manufacturer.trim() || null, sku: F.sku.trim(), tags: tagsOf(F.tags).length ? tagsOf(F.tags) : null,
    location: F.location || null, note: F.note.trim() || null, exp: F.exp || '', min,
    unit, orderUnitName: cap1(unit), buyUnit: buyU, perBuy: big ? per : null,
    baseUnitName: pieces > 1 ? (F.piece || 'Unit') : null, baseUnitsPerOrderUnit: pieces > 1 ? pieces : 1, baseUnitQty: null,
    sources, vendorOrderPrice: sources[0] && sources[0].price != null ? round2(sources[0].price) : null
  };
  withWho(async () => {
    busyBtn(t, true, 'Saving…');
    try {
      const id = E.id || 'custom-' + uid();
      /* a new photo goes to Cloud Storage first; the record keeps its address */
      if (E.photo.changed) {
        if (E.photo.thumb) {
          const a = await B.uploadPhoto(id, dataUrlToBlob(E.photo.thumb), 'thumb');
          const b = E.photo.full && E.photo.full !== E.photo.thumb ? await B.uploadPhoto(id, dataUrlToBlob(E.photo.full), 'full') : a;
          rec.img = a.url; rec.imgFull = b.url;
        } else { rec.img = E.photo.img || null; rec.imgFull = E.photo.imgFull || null; }
      } else if (!E.id) { rec.img = E.photo.img || null; rec.imgFull = E.photo.imgFull || null; }
      if (E.id) await saveItem(Object.assign({ id }, rec), false);
      else {
        const q = num(F.qty);
        const item = await saveItem(Object.assign(rec, { id, qty: q > 0 ? q : 0, chk: q > 0 ? nowISO() : null, tag: null }), true);
        if (q > 0) await B.addLog([logEntry({ itemId: item.id, itemName: item.name, delta: q, note: 'Starting count', type: 'count' }, stamp())]);
      }
      S.ui.ed = null; closeModal(true);
      toast(E.id ? 'Saved.' : 'Added ' + plainText(name, 40) + '.');
      openDrawer('item', id);
    } catch (e) { busyBtn(t, false); toast(errText(e), { bad: true }); }
  }, E.id ? 'Who’s changing this supply?' : 'Who’s adding this supply?');
};

/* ---------- stock steps: count, add by hand, used some ---------- */
ACT.stockOpen = t => { const it = itemById(t.dataset.id); if (!it) return; if (S.ui.ed) { S.ui.ed = null; closeModal(true); } openStock(it, t.dataset.mode || 'count'); };
ACT.countIt = t => { const it = itemById(t.dataset.id); if (it) openStock(it, 'count'); };
function openStock(it, mode) {
  S.ui.stk = { id: it.id, mode };
  const u = countUnit(it), q = Number(it.qty) || 0;
  const tabs = [['count', 'Count'], ['add', 'Add'], ['use', 'Used']];
  openModal('<h3>' + esc(it.name) + '</h3><div class="lsub"><b>' + esc(qtyUnit(q, u)) + '</b> on hand' + (it.chk ? ' · last counted ' + esc(fmtWhen(it.chk)) + (it.chkBy ? ' by ' + esc(it.chkBy) : '') : '') + '</div>' +
    '<div class="seg" style="margin-bottom:14px">' + tabs.map(([k, l]) => '<button data-act="stkMode" data-m="' + k + '" aria-pressed="' + (mode === k) + '">' + l + '</button>').join('') + '</div>' +
    '<div class="hint" id="stkHelp" style="margin:-4px 0 10px">' + stkHelp(it, mode) + '</div>' +
    '<div class="gap8" style="margin-bottom:6px;flex-wrap:wrap"><div class="qty lg"><button data-act="stkStep" data-n="-1" aria-label="Less">−</button><input id="stkQty" type="number" inputmode="decimal" min="0" step="any" value="' + (mode === 'count' ? esc(qtyFmt(q)) : '1') + '" data-enter="#stkGo" data-inp="stkInp" aria-label="How many"><span class="u">' + esc(unitWord(u, 2)) + '</span><button data-act="stkStep" data-n="1" aria-label="More">+</button></div><span class="small" id="stkDiff" style="font-weight:600"></span></div>' +
    (perBuy(it) > 1 ? '<div class="hint" style="margin-bottom:10px">In ' + esc(unitWord(u, 2)) + ', not ' + esc(unitWord(buyUnit(it), 2)) + ' (a ' + esc(buyUnit(it)) + ' is ' + perBuy(it) + ').</div>' : '') +
    '<div class="grid2">' + field('Note (optional)', '<input id="stkNote" placeholder="' + (mode === 'add' ? 'e.g. samples from the rep' : mode === 'use' ? 'e.g. used in the lab' : 'e.g. found a box in the lab') + '">') +
    field('Expires (optional)', '<input id="stkExp" type="date" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(it.exp || '') ? it.exp : '') + '">') + '</div>' +
    '<div id="stkCostRow"' + (mode === 'add' ? '' : ' style="display:none"') + '>' + field('Paid (optional)', '<input id="stkCost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">', 'Counts toward this month’s supply spending. Leave it empty for free samples.') + '</div>' +
    '<div class="mFt"><button class="btn btn-sec" data-act="closeModal">Cancel</button><button class="btn btn-pri" id="stkGo" data-act="stkGo">' + stkLabel(mode) + '</button></div>', { cls: 'mid', focus: '#stkQty' });
  INP.stkInp();
}
function stkHelp(it, m) { const u = unitWord(countUnit(it), 2); return m === 'count' ? 'How many ' + esc(u) + ' are on the shelf right now?' : m === 'add' ? 'Came in without an order (a sample, a store run)? Add it here. Orders are received under Orders.' : 'How many ' + esc(u) + ' were used or thrown out?'; }
function stkLabel(m) { return m === 'count' ? 'Save the count' : m === 'add' ? 'Add to stock' : 'Take off stock'; }
ACT.stkMode = t => {
  const it = itemById(S.ui.stk.id), m = t.dataset.m; if (!it) return; S.ui.stk.mode = m;
  $$('[data-act="stkMode"]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
  $('#stkHelp').innerHTML = stkHelp(it, m); $('#stkGo').textContent = stkLabel(m); $('#stkCostRow').style.display = m === 'add' ? '' : 'none';
  $('#stkQty').value = m === 'count' ? qtyFmt(Number(it.qty) || 0) : '1';
  const n = $('#stkNote'); if (n) n.placeholder = m === 'add' ? 'e.g. samples from the rep' : m === 'use' ? 'e.g. used in the lab' : 'e.g. found a box in the lab';
  INP.stkInp();
};
ACT.stkStep = t => { const i = $('#stkQty'); i.value = Math.max(0, (num(i.value) || 0) + Number(t.dataset.n)); INP.stkInp(); };
INP.stkInp = () => {
  const it = itemById(S.ui.stk.id), el = $('#stkDiff'); if (!it || !el) return;
  const n = num(val('stkQty')), q = Number(it.qty) || 0, m = S.ui.stk.mode;
  if (m === 'count') { const d = round2(n - q); el.textContent = val('stkQty') === '' || !d ? '' : (d > 0 ? '+' : '−') + qtyUnit(Math.abs(d), countUnit(it)) + ' from what the app had'; el.style.color = d > 0 ? 'var(--mint-700)' : 'var(--amber-700)'; }
  else { el.textContent = n > 0 ? '→ ' + qtyUnit(Math.max(0, round2(m === 'add' ? q + n : q - n)), countUnit(it)) + ' on hand' : ''; el.style.color = 'var(--grey-500)'; }
};
ACT.stkGo = t => {
  const it = itemById(S.ui.stk.id), m = S.ui.stk.mode, n = num(val('stkQty'), -1); if (!it) return closeModal(true);
  if (m === 'count' ? n < 0 || val('stkQty') === '' : !(n > 0)) return toast(m === 'count' ? 'Type the count.' : 'How many?', { bad: true });
  const note = val('stkNote').trim(), exp = val('stkExp'), cost = num(val('stkCost'));
  withWho(async () => {
    busyBtn(t, true, 'Saving…');
    const ok = await act(async () => {
      if (m === 'count') await stockStep(it, 0, 'count', note || 'Counted', n);
      else if (m === 'use') { const live = Number((itemById(it.id) || it).qty) || 0; await stockStep(it, -Math.min(n, live), 'use', note || null); }
      else await stockStep(it, n, 'receive', note || 'Added by hand', null, cost > 0 ? { amount: round2(cost), amountReason: 'paid' } : null);
      const was = /^\d{4}-\d{2}-\d{2}$/.test(it.exp || '') ? it.exp : '';
      if (exp !== was && (exp || was)) await B.patchItem(it.id, { exp: exp || '' });
    }, m === 'count' ? 'Saved: ' + qtyUnit(n, countUnit(it)) + '.' : m === 'add' ? 'Added ' + qtyUnit(n, countUnit(it)) + '.' : 'Took ' + qtyUnit(n, countUnit(it)) + ' off.');
    if (ok) closeModal(true); else busyBtn(t, false);
  }, m === 'count' ? 'Who counted?' : m === 'add' ? 'Who’s adding it?' : 'Who used it?');
};
